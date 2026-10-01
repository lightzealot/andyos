# FactoryOS — documento de revisión técnica

> «Todo tu contenido, en piloto automático.» Nombre anterior: AndyOS (los identificadores internos siguen siendo `andyos`).
> Estado a 2026-09-30. Pensado para que un desarrollador externo revise la arquitectura, la seguridad y las decisiones, no solo el código.

## 1. Qué es y qué no es
Panel **personal (un solo usuario)** para producir contenido de redes: captura ideas, las lleva por un pipeline de 9 estados, genera borradores con IA (hooks, guion, caption) con la voz del autor, y publica carruseles/fotos en Instagram con doble confirmación. **No es multiusuario, no es SaaS, no hay roles.** Principio rector: **toda salida de IA es un borrador; nada sale al exterior sin una acción humana explícita.**

## 2. Arquitectura y despliegue
```
 Navegador ──HTTPS──> Netlify  (apps/web: Next.js, export ESTÁTICO)  os.<dominio>
     │  fetch + cookie de sesión (CORS con credenciales, mismo "site")
     └────────────────> Easypanel/Docker (apps/api: Fastify + SQLite)   api.<dominio>
                              │  volumen /data (SQLite WAL + /data/media)
        ┌─────────────────────┼───────────────────────────────┐
   Mac mini (apps/worker)   n8n (self-hosted)             Windsor.ai (MCP)
   pull de la cola, ejecuta  Telegram↔Inbox, alertas,     publica en Instagram
   `claude -p` (suscripción) respaldo diario, panel       (execute_action)
```
- **Monorepo npm workspaces**: `apps/web`, `apps/api`, `apps/worker`, más `n8n/` (workflows exportados), `docs/`.
- **Web**: SPA estática; **sin SSR ni route handlers**. Toda la lógica vive en la API; la URL de la API se fija en build (`NEXT_PUBLIC_API_URL`).
- **API**: Node 24, Fastify 5, `better-sqlite3`, `zod`. Imagen Docker propia (compila `better-sqlite3` con node-gyp). Un solo proceso, un solo volumen.
- **Worker**: LaunchAgent en un Mac mini siempre encendido. **Solo conexiones salientes** (pull). Ejecuta el CLI `claude -p` con la suscripción Pro del autor, en configuración mínima (sin herramientas, MCP, skills ni hooks).
- **n8n**: integra Telegram (entrada de ideas, avisos) y el respaldo diario. La API le habla por webhooks con secretos en cabecera.
- **Windsor.ai**: servicio externo (MCP por HTTP, clave de API como Bearer) para publicar en Instagram.

Tamaño: ~2.850 líneas de API, ~2.900 de web, ~370 del worker; 65 commits. Dependencias de runtime deliberadamente pocas (API: fastify, cookie, cors, rate-limit, better-sqlite3, zod, tsx; web: next, react, @dnd-kit).

## 3. Modelo de datos (SQLite, WAL, `foreign_keys=ON`)
- `work_items` (genérica: `type` = idea | content | task | reference) + tablas de detalle `content_details`, `idea_details`, `reference_details`; `item_links` (relaciones, p. ej. `inspired_by`).
- `ai_jobs` (cola: tarea, entrada **congelada**, estado, intentos, `not_before`, `lease_until`, salida, uso, error) y `queue_state` (fila única: pausa, límites, umbrales, última lectura de cuota).
- `voice_profile` / `voice_examples` (la «voz» del autor).
- Publicación: `media_assets`, `publications` (auditoría), `publish_confirms` (confirmaciones de un solo uso).
- `app_meta` (clave/valor; p. ej. último día del resumen enviado).
**Migraciones**: no hay herramienta; `CREATE TABLE IF NOT EXISTS` + `ensureColumn()` aditivo (5 usos). Probado con una base del esquema anterior. No hay versionado ni rollback.

## 4. API (54 rutas)
- **Contenido**: `/items` (CRUD, aprobación `/items/:id/approve`), `/ideas` (+ promover), `/references` (+ `derive`), `/voice`.
- **IA (usuario)**: `/ai/queue` (estado/ajustes), `/ai/jobs` (crear, listar, aceptar, ignorar, cancelar).
- **IA (worker, Bearer)**: `/worker/claim`, `/worker/jobs/:id/result|failure`, `/worker/usage`.
- **Publicación**: `/items/:id/media` (subida), `/items/:id/publish/preview|confirm`, `/publications/:id/resolve`, `/publish/status|check`, y **público** `/m/:file`.
- **Integraciones**: `/webhooks/inbox` (n8n→API), `/webhooks/backup`, `/n8n/*` (panel), `/digest`.
- Autenticación por **tres vías distintas y excluyentes**: cookie de sesión (usuario), `Authorization: Bearer WORKER_TOKEN` (worker), `X-Webhook-Secret` (n8n). Una no sirve para las otras.

## 5. Seguridad (decisiones y límites)
- **Login**: contraseña única (`ANDYOS_PASSWORD`), comparación en tiempo constante (SHA-256 + `timingSafeEqual`), límite de 5 intentos/min.
- **Sesión**: cookie `httpOnly`, `sameSite=lax`, `secure` en producción, token `exp.HMAC-SHA256`, 7 días. **Sin almacén de sesiones**: no se puede revocar una sesión concreta (solo rotar `SESSION_SECRET`; `logout` solo borra la cookie). `COOKIE_DOMAIN` se deja sin definir a propósito (cookie solo del host de la API).
- **Hook global**: todo exige sesión salvo `/auth/login`, `/health`, `/webhooks/*`, `/worker/*` y `/m/*`.
- **CORS** con origen exacto (`WEB_ORIGIN`) y credenciales; **rate limits** por ruta (login, subida, confirmación, respaldo, imágenes públicas); `trustProxy` configurable para IP real tras Traefik.
- **Validación** con `zod` estricto (rechaza campos desconocidos); SQL **solo con sentencias preparadas**; el manejador de errores no devuelve internos en 5xx.
- **Secretos**: ≥32 caracteres y **distintos entre sí** (validado al arrancar); módulos opcionales **fallan cerrados** (p. ej. `PUBLISHING_ENABLED=true` sin clave impide arrancar).
- **Worker**: se niega a arrancar si hay variables que cambiarían la facturación o el destino (`ANTHROPIC_API_KEY`, `*_BASE_URL`, etc.) o si no está autenticado por suscripción; entorno filtrado; no lee el repo; no registra prompts ni salidas.
- **IA**: el texto del usuario y de las referencias se envía **delimitado como dato** (comillas triples saneadas) con la orden de ignorar instrucciones; el modelo **no tiene herramientas**. Riesgo residual de *prompt injection* aceptado porque la salida es un borrador revisado por una persona.
- **Superficie pública no autenticada**: `/health`, `/m/<token>.jpg` (token de 192 bits, no adivinable, necesaria para que Instagram lea las imágenes) y los webhooks (con secreto).

## 6. Control humano (compuertas)
1. **Aprobación de contenido**: `programado/publicado/analizado` exigen `approved_at`; editar hook/guion/caption/enlaces de algo aprobado **retira la aprobación** (lo hace la API, no la interfaz).
2. **IA = borrador**: el efecto (aplicar etiquetas, escribir hook, etc.) solo ocurre al **aceptar** (`/accept`); ignorar no toca nada.
3. **Publicar**: ver §9 (doble confirmación, un solo uso, modo de prueba por defecto).

## 7. Cola de IA y worker
- Cola en SQLite (sin Redis): reclamo **atómico en transacción** con *lease*; huérfanos vuelven a la cola con *backoff* (1, 5, 20 min; máx. 3 intentos).
- Clasificación de errores (`quota | billing | auth | transient | permanent`): cuota → pausa hasta el reinicio de la ventana y reanuda sola; sesión/facturación → pausa hasta intervención manual.
- **Control de cuota**: el worker informa del uso real (ventanas de 5 h y semanal); la API pausa al 80 %/85 % y avisa por Telegram (mejor esfuerzo). Límites móviles de 24 h/7 d, tope de 50 en cola, deduplicación por objetivo.
- Salida validada contra **JSON Schema** (el mismo que recibe el CLI) y con `zod`; una salida inválida es fallo permanente.
- Esquema y tiempo límite **dinámicos por tarea** (p. ej. el «paquete» pide N versiones; el *lease* siempre cubre el tiempo pedido + margen).

## 8. Estudio de guiones (IA aplicada)
Tareas: etiquetar ideas, hooks, guion, caption, **paquete (hook+guion+caption, 1–5 versiones en una llamada)**, humanizar. Se apoya en:
- **Voz** del autor (guía, hechos verdaderos, frases prohibidas, ejemplos reales) en el prompt.
- **Detector determinista** (`lint.ts`, sin coste): frases de relleno, arranques típicos, cifras que no vienen de los datos, citas inventadas, hashtags, copia de ≥5 palabras de ejemplos o **referencias de otros creadores**. Un defecto fuerte provoca **una segunda pasada automática** con la lista de defectos.
- **Referencias** como modelo de *estructura* (solo el análisis del autor, nunca la URL ni el contenido ajeno).
Se probó con muestras reales del CLI (una llamada por caso), no con evaluación sistemática de calidad.

## 9. Publicación en Instagram (vía Windsor)
Alcance: carruseles (2–10 JPEG) y foto suelta; publicación **manual**.
- Imágenes subidas a la API (`/data/media`), con URL pública de 192 bits; se borran al quitarlas y 14 días tras publicar.
- **Vista previa → confirmación de un solo uso (5 min) ligada a un *hash* del contenido**: si cambian caption o imágenes, hay que revisar de nuevo. Bloqueos de servidor: sin aprobación, plataforma ≠ Instagram, marcadores `[DATO]/[VIVENCIA]/[CONFIRMAR]` sin completar, caption >2.200, publicación en curso/dudosa, mismo contenido ya publicado.
- **Semántica de fallos**: error definitivo o antes de enviar → se puede reintentar; **duda tras enviar** (corte, 5xx, respuesta ilegible) → estado `unknown`, **bloquea reintentos** hasta que el usuario compruebe Instagram y lo resuelva. Un intento «en curso» de >10 min pasa a `unknown`.
- Modo de prueba por defecto (`PUBLISHING_ENABLED` sin definir): no se envía nada; queda registrado.
- **Verificado** con Windsor real: conexión, clave y existencia de `execute_action`. **No verificado**: la llamada de publicar (formato de respuesta, permiso de escritura de la cuenta, si devuelve el enlace). Windsor no ofrece borrar → una publicación de prueba es permanente.

## 10. Integraciones n8n / Telegram
Workflows exportados en `n8n/`: Inbox desde Telegram, alertas de la cola, respaldo diario (03:00, `/webhooks/backup`: copia consistente con la API de respaldo de SQLite + `quick_check`, gzip). **Resumen diario** (fechas cercanas, aprobaciones paradas, programadas vencidas) lo genera la propia API con un temporizador en proceso y lo envía por el webhook de alertas; el día se persiste en `app_meta` para no duplicar tras reinicios. Las credenciales de n8n se referencian por nombre; los nombres antiguos «AndyOS …» se conservan a propósito.

## 11. Frontend
Next.js (export estático), React, Tailwind v4, `@dnd-kit` (calendario/kanban). Diseño «glassy»: un `AppShell` común + un *skin* CSS que re-mapea las variables de color/radio de Tailwind dentro de `.skin`, de modo que todo el contenido hereda el estilo. Un test falla si una página nueva no usa `AppShell` o falta en la navegación. Datos: `fetch` con credenciales y sondeos cortos; sin capa de caché. Hay componentes grandes (p. ej. Estudio ≈ 350 líneas) sin dividir.

## 12. Pruebas y calidad
- **API 278 tests** (Vitest, `app.inject`, base en memoria), **worker 78**, **web 21** (lógica pura y un test de «contrato» que cruza texto de UI con códigos de error de la API).
- **Mutaciones manuales** sobre las protecciones críticas (aprobación, confirmación de un solo uso, semántica de duda, filtro de entorno del worker, validación de proporciones…): se rompe a propósito y se comprueba que algún test falla; varias veces reveló huecos reales.
- **E2E en navegador real** (Playwright + Chrome) hechos durante el desarrollo, **pero los scripts viven fuera del repositorio** (no versionados).
- **No hay CI**. `npm test` en la raíz ejecuta API y worker, **no** la web.
- Lo no probado de verdad: calidad de los textos de IA a escala, el comportamiento de la cuota en un día real, la publicación real en Instagram.

## 13. Operación
- Despliegue: la rama `main` de GitHub; web en Netlify (build `npm ci && npm run build -w apps/web`), API en Easypanel (Dockerfile). Se sigue un PR por módulo.
- Variables de entorno (nombres; los valores nunca se versionan): `ANDYOS_PASSWORD, SESSION_SECRET, INBOX_WEBHOOK_SECRET, WEB_ORIGIN, BACKUP_WEBHOOK_SECRET, WORKER_TOKEN, ALERT_WEBHOOK_URL/SECRET, N8N_BASE_URL/API_KEY/TRIGGER_SECRET, DIGEST_TZ/HOUR, PUBLIC_API_URL, PUBLISHING_ENABLED, WINDSOR_API_KEY, WINDSOR_IG_ACCOUNT_ID, WINDSOR_MCP_URL, IG_ACCOUNT_NAME, MEDIA_DIR, DB_PATH, PORT, TRUST_PROXY`. Detalle en `docs/variables-de-entorno.md`.
- Observabilidad: logs de proceso; avisos por Telegram (cola pausada, resumen diario); panel de la cola en la web. Sin métricas ni trazas.
- Respaldo: diario por n8n (`docs/respaldo.md`). Restauración documentada, no ensayada periódicamente.

## 14. Riesgos y deuda conocida (sin adornos)
1. **Un solo nodo y un solo escritor** (SQLite). Los temporizadores en proceso (resumen diario, purga de imágenes) **se duplicarían** si se ejecutaran dos instancias; el límite de peticiones es en memoria por proceso.
2. **Migraciones artesanales** (sin versionado ni rollback).
3. **Sesiones sin revocación individual** y contraseña única sin segundo factor.
4. **Sin CI**, tests de web fuera del script raíz y E2E sin versionar → riesgo de regresiones silenciosas.
5. **El worker depende de un Mac mini** (LaunchAgent del usuario: no arranca tras un reinicio sin sesión; suspensión = sin trabajo) y **de una suscripción de consumo usada de forma automatizada**: conviene que un revisor valore si los términos del proveedor lo permiten a largo plazo.
6. **Publicación**: parte del protocolo con Windsor sin verificar con una publicación real; plan de Windsor en periodo de prueba; irreversible desde la app; las imágenes son públicas (aunque no adivinables) durante su vida útil. No se contrasta con Instagram tras publicar (idea pendiente: lectura de verificación).
7. **IA**: el detector solo ve copias literales de ≥5 palabras y cifras/citas obvias; una vivencia plausible pero inventada puede pasar. La revisión humana es obligatoria.
8. **Acoplamiento operativo con n8n**: credenciales por nombre; el conector MCP de n8n ha asignado credenciales equivocadas al crear workflows.
9. **Secretos en logs de build**: Easypanel imprime las variables como `--build-arg`; no se comparten registros de despliegue.
10. Zonas horarias: el panel usa la del navegador; el resumen diario usa `DIGEST_TZ`.

## 15. Preguntas concretas para el revisor
1. ¿Es razonable SQLite + un solo proceso para este uso, o migrarías ya a Postgres/cola dedicada? ¿Qué umbral lo justificaría?
2. ¿Sesión firmada sin estado (HMAC) es suficiente para un panel personal expuesto a Internet, o añadirías revocación/2FA/IP allowlist?
3. La semántica de publicación (`unknown` bloqueante + resolución manual + confirmación ligada a *hash*): ¿ves condiciones de carrera o casos que se me escapan?
4. ¿Qué CI mínima pondrías (tests, typecheck, build, auditoría de dependencias)?
5. ¿Cómo evaluarías de forma sistemática la calidad de las salidas de IA (más allá de un detector heurístico)?
6. ¿Algún riesgo en servir imágenes con URL pública no adivinable en el mismo servidor que la API?
7. ¿Ves problemas en usar una suscripción de consumo desde un worker automatizado?
