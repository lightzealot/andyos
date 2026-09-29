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
