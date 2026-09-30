# Cola de IA: contrato de la API (módulo 2.1)

Estado: implementado y probado (25 tests de la cola + mutaciones). El worker (módulo 2.2) aún no existe.

## Modelo
- `ai_jobs`: tarea, entrada congelada (snapshot), estado (`queued|running|done|failed|canceled`), intentos, `not_before` (backoff), `lease_until`, salida (borrador), proveedor y modelo reales, uso, `error_class`, `accepted_at`.
- `queue_state` (una fila): pausa (`manual`, `quota`, `auth`, `billing`, `usage_*`), `paused_until`, límites diario/semanal, concurrencia (1-2), umbrales de uso real (5 h 0,8; semana 0,85) y última instantánea de uso.

## Usuario (cookie de sesión)
`GET/PATCH /ai/queue` · `POST/GET /ai/jobs` · `GET /ai/jobs/:id` · `POST /ai/jobs/:id/cancel` · `POST /ai/jobs/:id/accept`
Aceptar es la **acción humana** que aplica el borrador (p. ej. fusiona etiquetas en la idea). Hasta entonces la salida no toca nada.

## Worker (`Authorization: Bearer WORKER_TOKEN`)
- `POST /worker/claim {providers}` → `{job:{id,task,provider,system,prompt,json_schema,attempt,timeout_s}}` o `{job:null,reason,until?}` con `reason ∈ paused|usage_high|limit_day|limit_week|concurrency|empty`.
- `POST /worker/jobs/:id/result {output,provider,model,usage,usage_snapshot?}`
- `POST /worker/jobs/:id/failure {error_class,error,reset_at?}` con `error_class ∈ quota|billing|auth|transient|permanent`.
- `POST /worker/usage {five_hour:{utilization,resetsAt}, seven_day:{…}}`

## Reglas
- Reclamo atómico (transacción) con *lease* de 180 s; un trabajo huérfano vuelve a la cola con backoff y falla tras 3 intentos.
- Límites móviles de 24 h y 7 días sobre trabajos iniciados; tope de 50 en cola; deduplicación por objetivo.
- `transient`: backoff 1, 5 y 20 min (máx. 3 intentos). `permanent`: falla. Salida que no cumple el esquema: falla.
- `quota`: el trabajo vuelve a la cola sin gastar intento; pausa hasta `reset_at` (o 1 h); aviso una sola vez; reanuda sola.
- `auth` / `billing`: pausa indefinida, aviso; solo se reanuda a mano.
- Uso real: si una ventana supera su umbral, pausa hasta su reinicio y avisa. Datos de ventanas ya vencidas se ignoran.
- Avisos: la API llama a `ALERT_WEBHOOK_URL` (n8n → Telegram); es de mejor esfuerzo y nunca rompe la cola. No sigue redirecciones.
- Seguridad: la cookie no vale para `/worker/*` ni el token para `/ai/*` ni para el resto de la API. El texto de una idea viaja delimitado como **dato**, no como instrucción.

## Módulo 2.3: etiquetado automático de ideas
- Al crear una idea (web o Telegram) la API encola sola un trabajo `tag_idea` si la cola está habilitada (`WORKER_TOKEN`) y el ajuste `auto_tag` está activo (defecto sí; se cambia en el Inbox o con `PATCH /ai/queue {auto_tag}`). **Nunca bloquea el guardado**: cola llena, IA pausada o error al encolar → la idea se guarda igual.
- `GET /ideas` añade `suggestion` (`queued|running|done|failed`, con `tags` cuando está lista). Solo se muestra lo accionable: una sugerencia aceptada o ignorada desaparece.
- `POST /ai/jobs/:id/accept` acepta un cuerpo opcional `{"tags":[…]}` para aplicar **solo** las elegidas; se rechaza cualquier etiqueta que la IA no propuso o una lista vacía. `POST /ai/jobs/:id/dismiss` descarta el borrador sin tocar la idea. Aceptar/ignorar dos veces o tras decidir → 409.
- Interfaz: el Inbox muestra el borrador rotulado como «Borrador de IA», con las etiquetas marcadas por defecto para que las desmarques.
- **Migración segura:** `auto_tag` (queue_state) y `dismissed_at` (ai_jobs) se añaden con `ALTER TABLE` si faltan, sin recrear tablas ni perder datos (probado con una base del esquema anterior).
- Coste: cada idea nueva gasta un trabajo (< 1 % de la ventana de 5 h medido). Si no lo quieres, desactiva el ajuste.

## Módulo 2.4a: motor del Estudio de guiones (voz + detector)
**Tareas nuevas** (`POST /ai/jobs`): `hooks` (5 hooks con ángulos distintos), `script` (Hook → Contexto → Cambio → Aplicación → Resultado → CTA), `caption` (3 opciones: corta, gancho, cta; sin hashtags) y `humanize` (reescribe un campo). Entrada: `{content_id, topic?, angle?}`; `humanize`: `{content_id, field, text?}`.

**Tu voz** (`/voice`): guía de estilo, hechos verdaderos sobre ti, frases prohibidas y ejemplos. Nace sembrada con lo extraído de los carruseles y captions que aprobaste (CarruselOS) y se edita con `PUT /voice`. `POST /voice/examples` guarda un texto tuyo como ejemplo (los tuyos van antes que la semilla); `POST /voice/lint` comprueba cualquier texto sin coste de IA.

**Cómo se evita sonar a IA / inventar** (probado con mutaciones):
1. El prompt lleva la guía, los hechos, ejemplos reales y las frases prohibidas; prohíbe inventar anécdotas (usa `[VIVENCIA]`/`[DATO]`) y copiar los ejemplos.
2. Detector determinista (`lint.ts`): frases de relleno, arranques típicos, cifras que no vienen de tus datos, hashtags en captions, rayas/exclamaciones/emojis en exceso, frases de más de 30 palabras, **copia de 5+ palabras seguidas de tus ejemplos** y marcadores pendientes.
3. **Segunda pasada automática, una sola vez:** si hay un defecto fuerte (o 3 débiles) el trabajo vuelve a la cola con la lista de defectos y el borrador anterior, antes de mostrártelo. El resultado guarda `review: {issues, revised}`.
4. Aceptar (`POST /ai/jobs/:id/accept`) exige elegir: `{index}` para hooks y captions, `{parts:[…]}` opcional para el guion. Escribe con las reglas del editor: **cambiar contenido aprobado retira la aprobación**, salvo que el texto sea idéntico.

**Límites conocidos** (el detector no puede saberlo todo): una vivencia plausible pero inventada («antes respondía a mano») puede pasar; los `[DATO]`/`[VIVENCIA]` son la red de seguridad, pero la revisión humana sigue siendo obligatoria.

## Módulo 2.4b: pantalla del Estudio (`/studio/`)
- Se abre con `?id=<tarjeta>` (hay un enlace «Abrir en el Estudio» en el detalle de cada tarjeta del Pipeline).
- **Izquierda:** pestañas Hooks · Guion · Caption · Mi voz. Cada una pide un borrador (con tema y ángulo opcionales), muestra su estado y, al llegar, el borrador rotulado como tal con lo que comprobó el Estudio (segunda pasada, avisos de estilo, datos por completar en ámbar). Hooks y captions exigen **elegir uno** (no hay elección por defecto); el guion llega con todas las partes marcadas y puedes desmarcar. Ignorar no toca nada. Los borradores pendientes sobreviven a recargar.
- **Derecha:** el contenido actual, editable campo a campo, con avisos de estilo en vivo (sin IA), «✨ Humanizar» (propuesta que aceptas o ignoras) y «★ Guardar como mi voz».
- **Mi voz:** guía, hechos, frases prohibidas y ejemplos (los tuyos se distinguen de la semilla).
- Aceptar o editar sobre un contenido aprobado **retira la aprobación** y la pantalla lo dice.
- API: `GET /ai/jobs` admite `target_id` y `task` (lista separada por comas). CORS admite ahora `PUT`.

## Detección de citas inventadas
Prueba real en producción: el guion incluyó *«un seguidor que me escribe "oye, no me llegó nada"»*, una cita que no consta en tus datos. `lint.ts` marca ahora como defecto fuerte (`invented_quote`) toda cita de 4+ palabras entre comillas que no aparezca en el título, las notas, el tema, los hechos o tus ejemplos; las palabras clave cortas de los CTA («AUTOMATIZA») no cuentan. Provoca la segunda pasada, con la instrucción de quitarla o escribir `[VIVENCIA]`. Sigue siendo una red parcial: una inferencia plausible sin comillas puede pasar, por lo que la revisión humana es obligatoria.

## Módulo 2.5: panel de la cola (`/queue/`, «Cola IA» en el menú)
Solo web: usa `GET/PATCH /ai/queue`, `GET /ai/jobs` y `POST /ai/jobs/:id/cancel`; la API no cambia. Se refresca cada 15 s.
- **Estado y pausa:** «Cola activa/pausada», con el motivo en claro (manual, cuota 5 h/semanal, límite de Claude, sesión, facturación) y si se **reanuda sola** o solo a mano (`auth`/`billing`/manual). Botón Pausar/Reanudar.
- **Cuota de Claude:** barras de la ventana de 5 h y de la semana con la marca del umbral de pausa y la hora de reinicio. Un dato ya vencido se muestra como «sin dato vigente», no como un porcentaje viejo. Es la cuota compartida de tu suscripción (la mide el worker).
- **Contadores:** 24 h y 7 días frente a su límite, en cola y ejecutando. Interruptor «Etiquetar ideas nuevas con IA» (`auto_tag`).
- **Límites:** máximo por 24 h / 7 días y umbrales de pausa (%), con los rangos que valida la API.
- **Historial** (50 más recientes, filtro por estado): tarea, estado, proveedor y modelo reales, intentos, duración, tokens si el worker los reporta, «segunda pasada», aceptado/ignorado y la clase de error; «Detalle» muestra el error y la entrada. Solo se cancelan los trabajos en cola.
- Prueba: e2e con navegador real (estado, pausa/reanudar, medidores, historial, filtro, cancelar, límites válidos e inválidos, auto_tag, móvil). El menú ganó una séptima entrada y ahora hace salto de línea en pantallas estrechas.

## Módulo 2.6: CarruselOS ligero (solo seguimiento)
Decisión C del plan, en su versión mínima. **AndyOS no ejecuta, aprueba ni publica carruseles**: la API corre en Easypanel y no ve tu carpeta local, así que el estado lo anotas tú.
- **Datos:** dos columnas nuevas en `content_details` (`carousel_folder`, `carousel_state`), añadidas con `ALTER TABLE` si faltan (migración probada sobre una base sin ellas, sin perder datos). Aceptadas en `POST/PATCH /items`.
- **Validación:** la carpeta debe ser un nombre simple (`^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`: sin `/`, `..`, espacios ni punto inicial); la API nunca toca el disco. El estado es uno de `enfoque → narrativa → cta → borradores → preview → aprobado → exportado → publicado`, los mismos del Pipeline de Notion/CarruselOS.
- **Independiente de la aprobación:** cambiar carpeta o estado no aprueba, no retira una aprobación ya dada y no salta la compuerta de Programado/Publicado (409 igual que antes). El «aprobado» de CarruselOS y la aprobación humana de AndyOS son cosas distintas.
- **Web:** en el detalle de una tarjeta con formato **carousel** aparece la sección «CarruselOS»: carpeta (con «Sugerir carpeta» = `AAAA-MM-DD-titulo`), estado y «Copiar prompt de arranque», un texto para pegar en Claude Code dentro de CarruselOS con el tema, la carpeta y el material que ya tengas (hook, guion, caption, notas). Ese prompt pide expresamente preguntar lo que falte y no generar imágenes ni publicar sin tu OK. El tablero muestra una insignia 🎠 con el estado.
- **Fuera de alcance (a propósito):** sincronizar el estado leyendo `brief.md` desde el Mac mini con el worker. Sería una vía nueva (lectura local + endpoint); solo si lo pides.

## Resumen diario por Telegram
Reutiliza el aviso que ya existe (API → webhook `andyos-alerta` de n8n → tu Telegram); **no hay workflow nuevo**. Se activa solo con `DIGEST_TZ` (y opcionalmente `DIGEST_HOUR`, defecto 9); ver `docs/variables-de-entorno.md`.
- **Qué avisa** (solo si hay algo; si no, no manda nada):
  1. ⏰ Tarjetas de contenido **sin programar** cuya fecha objetivo ya venció o vence en ≤ 2 días.
  2. 📝 Tarjetas **en Aprobación sin aprobar** desde hace ≥ 3 días.
  3. 📅 Tarjetas **Programadas** cuya fecha ya pasó (por si olvidaste marcarlas como publicadas).
  Máximo 5 líneas por sección («… y N más»), ordenadas por urgencia. Ignora archivadas e ideas.
- **Una vez al día:** cuando pasa la hora local configurada; el día se guarda en la base (`app_meta`), así que reiniciar la API no duplica. El día se marca **antes** de enviar: si el aviso se pierde, no se reintenta ese día (el aviso es de mejor esfuerzo, como los de la cola).
- **Rutas (sesión):** `GET /digest` muestra lo que se enviaría ahora (no envía ni marca nada); `POST /digest/send` manda un mensaje de prueba a Telegram (no cuenta como el del día; si no hay nada pendiente manda un texto de prueba). Ambas existen solo si `DIGEST_TZ` está definida.
- **Límite conocido:** el nodo de Telegram antepone «AndyOS: » al mensaje y lo envía como texto plano; los títulos de tus tarjetas viajan tal cual.
- Pruebas: 16 tests (zona horaria y día local, cada categoría, límites, una vez al día, reinicio, día vacío, rutas y secreto) con 3 mutaciones detectadas, más una prueba con el proceso real contra un webhook falso.

## Dashboard (`/dashboard/`) · ver también `05-diseno-visual.md`
Pantalla nueva con el diseño «glassy» de `Dash1.PNG` (Drive) adaptado a AndyOS: barra lateral de iconos, panel central y panel derecho de cristal oscuro sobre fondo cálido, tarjetas blancas y acento naranja. **Solo web: no cambia la API**; usa `GET /items?type=content`, `GET /ideas` y `GET /ai/queue` y se refresca cada 60 s.
- **Tarjetas:** ideas nuevas (con barras de los últimos 10 días), en aprobación (cuántas y la más antigua), cola de IA (trabajos de 24 h frente al límite) y cuota de Claude (5 h y semana; una ventana vencida se muestra «—»). Sin `WORKER_TOKEN` las de IA muestran «—».
- **Actividad:** curva de ideas creadas + tarjetas modificadas por día (semanal o mensual). Es una aproximación: una tarjeta solo cuenta en el día de su **última** modificación.
- **Próxima publicación**, **En el pipeline** (las 3 más avanzadas sin cerrar, la primera destacada) y a la derecha **calendario** (hoy, con fecha, vencida) y **Programado**.
- **Captura rápida** en la cabecera: escribe una idea y Enter la guarda en el Inbox (`POST /ideas`).
- Los iconos laterales enlazan a todas las pantallas; también hay «Dashboard» en el menú superior. Zona horaria: la del navegador.
- **No hay métricas de Instagram** (alcance, likes, seguidores): AndyOS no las guarda. Eso requeriría integrar la API de Instagram (o Windsor) y sería otro módulo.
- Pruebas: 7 unitarias de la lógica de datos y e2e en navegador real (datos, calendario, captura, navegación, móvil sin scroll horizontal). No se probó en producción.

## Paquete completo: hook + guion + caption en una sola llamada, con N versiones
Tarea nueva `pack` (`POST /ai/jobs {task:'pack', input:{content_id, topic?, angle?, versions?}}`), pestaña **Paquete** del Estudio (la primera). Las pestañas Hooks, Guion y Caption siguen para trabajar una pieza suelta.
- **Una llamada, N versiones (1 a 5, defecto 3):** cada versión trae `angle`, `hook`, las 5 partes del guion (`contexto, cambio, aplicacion, resultado, cta`) y `caption`. El hook va **una sola vez** (no puede contradecirse con el guion). Cuenta como **un** trabajo de la cola (límites diario/semanal) aunque pidas 5, pero escribe más texto, es decir, gasta algo más de cuota que un hook suelto.
- **Por qué máximo 5:** más versiones = más texto por llamada, más cuota y más riesgo de tiempo agotado; además a partir de 5 se reparecen entre sí. Se puede subir en `MAX_VERSIONS` (`tasks.ts`).
- **Esquema y tiempo dinámicos:** el esquema JSON que recibe el worker exige exactamente N versiones; el tiempo límite es 90 s + 30 s por versión (120 s para 1, 240 s para 5) y la reserva (lease) del trabajo siempre cubre ese tiempo + 60 s. Si el modelo devuelve otra cantidad, el trabajo falla como `permanent` (no se acepta a medias). Las tareas anteriores no cambian.
- **Distintas de verdad:** el prompt exige ángulo, arranque y estructura distintos por versión y prohíbe repetir arranques.
- **Detector de siempre, por versión:** revisa hook, cada parte y caption de cada versión (`v2 caption`, `v3 resultado`…). Un defecto fuerte en cualquiera provoca **una** segunda pasada que conserva N. `[DATO]`/`[VIVENCIA]` se avisan como «por completar» pero **no** provocan segunda pasada (son tuyos).
- **Aceptar:** `POST /ai/jobs/:id/accept {version, sections?}` con `sections ⊆ {hook, script, caption}` (defecto: las tres). Todo o nada en un solo write, con las reglas del editor (cambiar contenido aprobado retira la aprobación). Sin elegir versión, versión fuera de rango, secciones vacías/desconocidas o campos de más → 400 sin cambiar nada. En la pantalla no hay versión elegida por defecto.
- **Prueba real (1 llamada, 2026-09-30):** 5 versiones en 17 s, 2.016 tokens de salida, esquema y número correctos, solo avisos `[DATO]` en «resultado», sin cifras ni anécdotas inventadas. Es una sola muestra, no una garantía de calidad.
- **Límite conocido:** la deduplicación por contenido sigue igual: si ya hay un paquete en cola para esa tarjeta, otro pedido devuelve el existente (con el N original).
- Pruebas: 31 de API (validación, esquema/tiempo/lease, todo o nada, secciones, segunda pasada, aprobación) con 4 mutaciones detectadas, y e2e en navegador real (versiones 1–4, elegir, secciones, ignorar, móvil).

## Referencias conectadas al Estudio
Las referencias que guardas en `/references/` ahora sirven de **modelo de estructura** al generar. Aplica a Paquete, Hooks, Guion y Caption (no a Humanizar).
- **Qué ve el modelo de cada referencia:** solo **tu análisis**: título, creador, plataforma/formato, «patrón de hook» y «por qué funciona». **No** la URL ni el contenido del otro creador (la app nunca lo descarga). El bloque va delimitado como DATO, con la orden expresa de tomar solo la mecánica (tipo de hook, ritmo, orden) y **nunca** sus frases, datos ni su voz. Las comillas triples dentro de una referencia se neutralizan para que no rompan ese delimitador.
- **Cuáles:** hasta 3 por generación (`reference_ids` en `POST /ai/jobs`). En la pantalla, desplegable «Referencias de estructura» con la lista; **vienen preseleccionadas las ya enlazadas** al contenido con «Crear contenido inspirado» (`GET /references?content_id=X` añade `linked`). Sin ninguna elegida, el prompt no cambia. Un id inexistente, archivado o que no sea una referencia → 404 y no se encola nada.
- **Foto congelada:** editar la referencia después no cambia lo ya pedido. El borrador muestra «Con la estructura de: …».
- **Protección contra copiar:** aviso nuevo `copied_reference` (fuerte): si un texto repite 5 palabras seguidas de una referencia, se hace la **segunda pasada** automática antes de mostrártelo, con un mensaje propio. Inspirarse (mismas ideas, otras palabras) no se marca.
- **Coste:** ninguno extra en trabajos; el prompt es algo más largo (unos cientos de tokens por referencia).
- **Prueba real (1 llamada, 2026-09-30, 3 versiones, 2 referencias):** 12 s, 1.295 tokens de salida; una versión adoptó la mecánica de «señales verificables» y otra la de confesión; sin copias ni avisos salvo `[DATO]`. Es una muestra, no una garantía.
- **Límites conocidos:** el detector solo ve copias de 5+ palabras seguidas, no imitaciones de estilo ni de estructura más sutiles (que es justo lo que se pide imitar). Si la referencia no tiene «patrón» ni «por qué funciona» anotados, aporta poco: el análisis lo escribes tú. Una vivencia plausible pero inventada («a mí también me pasa») puede pasar el detector; la revisión humana sigue siendo obligatoria.
- Pruebas: 14 de API (snapshot, prompt, validación, copias, `linked`) con 5 mutaciones detectadas, y e2e en navegador real (selector, máximo 3, preselección, prompt, móvil).

**En la tarjeta del Pipeline:** el detalle de una tarjeta muestra «Inspirado en: <título> · <creador>» cuando la enlazaste a una referencia con «Crear contenido inspirado» (enlaza a `/references/`). Es solo web: usa `GET /references?content_id=` y filtra las `linked`. Si falla la consulta o no hay enlaces, la línea no aparece.

## Plataforma predeterminada: Instagram
Todo contenido **nuevo** sin plataforma (crear en el tablero, promover una idea, «Crear contenido inspirado» desde una referencia sin plataforma) sale con `platform = instagram` (`DEFAULT_PLATFORM` en `content.ts`). Una plataforma elegida o heredada de la referencia se respeta, y se puede cambiar después en la tarjeta. **Las tarjetas que ya existían sin plataforma no se tocan** (no hay migración).
