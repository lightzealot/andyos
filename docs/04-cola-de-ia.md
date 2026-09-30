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
