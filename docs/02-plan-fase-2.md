# Plan de la Fase 2: IA y contenido

Estado: PROPUESTA para aprobación. Sin código. Fecha: 2026-09-29.
Base: decisiones de `00-diseno-base.md` (proveedor principal `claude -p` mínimo, respaldo `codex exec`, worker por *pull*, nada se publica sin aprobación humana).

## 1. Arquitectura

```
Dashboard (web) ──> API ──> tabla ai_jobs (cola en SQLite)
n8n (Inbox, alertas) ──> API (crea trabajos / recibe avisos)
Worker (máquina con el CLI) ──HTTPS saliente──> API: claim → ejecuta CLI → devuelve resultado
                                  └─> claude -p (principal)  |  codex exec (respaldo, opt-in)
```

- **Interfaz única del gateway** (`tarea`, `entrada`, `esquema de salida JSON`) = `POST /ai/jobs`. La usan el dashboard (sesión) y n8n (secreto). Un trabajo guarda: tarea, entrada, esquema, estado, intentos, proveedor, modelo, salida, uso (tokens), error, marcas de tiempo.
- **Desviación respecto al prompt original:** el prompt pedía el gateway "en n8n". n8n (VPS) no puede llamar al worker sin exponer el homelab, así que **la cola vive en la API** y n8n orquesta alrededor (crear trabajos desde el Inbox, enviar alertas a Telegram). Se mantiene la regla clave: el navegador nunca llama a modelos ni APIs externas.
- **Toda salida de IA es borrador.** Se guarda en `ai_jobs.output` y solo pasa al contenido cuando el usuario pulsa "Usar". Al usarla se marca `ai_generated` y se aplica la regla existente (editar retira la aprobación).

## 2. Worker y seguridad
- Proceso Node pequeño (~200 líneas), usuario del sistema dedicado, directorio de trabajo aislado y vacío, sin acceso al repo.
- Invocación mínima ya probada: `claude -p --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --disable-slash-commands --setting-sources project --system-prompt … --permission-mode dontAsk --output-format json --json-schema …` con `</dev/null`. **Sin herramientas**: solo genera texto. Nunca `bypassPermissions`, nunca `--bare`.
- Se niega a arrancar si el entorno tiene `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` o similares (cobro por token).
- Autenticación headless: `claude setup-token` (token OAuth de suscripción, `CLAUDE_CODE_OAUTH_TOKEN`). **[VERIFICAR en el spike]** que su uso programático sigue permitido y cómo se factura.
- Entrada no confiable (texto del Inbox/Telegram) → el modelo no tiene herramientas, la salida se valida contra el esquema y se muestra escapada; nunca se ejecuta.
- Token propio del worker (`WORKER_TOKEN`) para `/worker/*`; el worker solo hace conexiones salientes.

## 3. Cola: límites, reintentos y cuota agotada
- Concurrencia máxima configurable (defecto 1; máx. 2). Reclamo atómico con *lease*: un trabajo "running" sin latido se devuelve a la cola.
- Límites de uso diario y semanal configurables (`queue_settings`), comprobados al encolar y al reclamar. Propuesta de defectos: 30/día, 150/semana (ajustar a tu plan).
- Reintentos con backoff exponencial (p. ej. 1, 5, 20 min; máx. 3) solo para errores transitorios; los errores de validación de esquema no se reintentan a ciegas.
- **Cuota agotada:** al detectarla (se define en el spike), la cola pasa a `paused`, los trabajos siguen en `queued`, se avisa por Telegram (API → webhook de n8n → bot de AndyOS) y se reanuda solo tras `paused_until` o a mano. Nunca falla en silencio.
- Registro por trabajo de proveedor y modelo (`modelUsage` del JSON del CLI).
- Respaldo `codex exec`: **solo si lo activas** por tarea; no hay cambio automático de proveedor (gastaría otra suscripción sin avisar).

## 4. Módulos (uno a la vez, con tu OK entre cada uno)
| # | Módulo | Contenido | Necesita de ti |
|---|---|---|---|
| 2.0 | **Spike de verificación** | Facturación vigente de `claude -p`; formato exacto del error de cuota y del límite en `--output-format json`; `codex exec` con esquema; tiempos; `setup-token` en la máquina del worker. Resultado en un documento | Máquina del worker con el CLI instalado; consumo pequeño de cuota |
| 2.1 | **Núcleo de la cola (API)** | Tablas `ai_jobs`, `queue_settings`; endpoints de trabajos y `/worker/*`; límites, backoff, pausa y aviso; tests con un CLI simulado | — |
| 2.2 | **Worker** | Adaptador `claude` + adaptador `codex`; sandbox; servicio (systemd o Docker); README | Dónde corre |
| 2.3 | **Primera tarea: etiquetar ideas** | El Inbox encola al recibir una idea; sugerencias visibles con "Aceptar" | — |
| 2.4 | **Estudio de guiones** | Hook → Contexto → Cambio → Aplicación → Resultado → CTA, hooks y caption; ejemplos de tu voz como contexto (sin RAG) | 5–10 textos tuyos reales |
| 2.5 | **Panel de la cola** | Estado, pausa/reanudar, contadores de uso, historial con proveedor/modelo | — |
| 2.6 | **CarruselOS (ligero)** | Ver decisión C | Tu OK |
Opcionales posteriores, **solo si lo pides**: repurposing con transcripción y RAG con Qdrant.

## 5. Decisiones que necesito
- **A. Dónde corre el worker:** homelab Ubuntu (recomendado por aislamiento) o este Mac mini. Requiere CLI instalado y autenticado allí, y que esté encendido.
- **B. Gateway en la API en vez de n8n** (sección 1).
- **C. CarruselOS:** es una habilidad interactiva de Claude con aprobación explícita y generación de imágenes; automatizarla por cola rompería esa compuerta. Propuesta: integración **ligera** (el contenido de formato carrusel guarda la carpeta del proyecto y refleja su estado; AndyOS te da el arranque, pero no lo ejecuta ni lo aprueba).
- **D. Tu plan de Claude** (Pro / Max 5x / Max 20x) para fijar límites reales.
- **E. Respaldo `codex`:** ¿solo manual por tarea (recomendado) o automático?
- **F. Alertas:** reutilizar el bot «AndyOS» de Telegram.

## 6. Riesgos
- Facturación/términos de `claude -p` con suscripción (cambiantes; hoy: pausado el cambio de crédito aparte).
- Formato del error de cuota sin verificar hasta el spike.
- Disponibilidad de la máquina del worker (si está apagada, la cola espera).
- El contenido se envía a Anthropic al procesarse (inherente al proveedor elegido).
