# Spike 2.0: verificación de los CLIs (2026-09-29)

Método: llamadas reales desde este Mac mini, directorio de trabajo vacío, `</dev/null`, sin claves de API en el entorno. Fuentes oficiales: code.claude.com/docs (errors, headless, authentication), support.claude.com (artículo 15036540).
**Verificado** = observado en una ejecución real. **Documentado** = solo en la documentación oficial. **No verificado** = supuesto.

## 1. Facturación (verificado en documentación, hoy)
`claude -p`, el Agent SDK y apps de terceros **siguen consumiendo los límites de la suscripción**. El cambio a un crédito mensual aparte (Pro: 20 USD) está **pausado** desde el 15-jun-2026 y Anthropic dice que avisará antes de aplicarlo. El worker debe revisar este estado antes de cada fase de trabajo largo y tratar como riesgo un cambio de facturación.

## 2. `claude -p` mínimo
Invocación (verificada, exit 0):
```
claude -p "<prompt>" --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --disable-slash-commands --setting-sources project --permission-mode dontAsk \
  --no-session-persistence --system-prompt "<sistema>" \
  --output-format stream-json --verbose --json-schema '<esquema>'   < /dev/null
```
| Medida (verificado) | Valor |
|---|---|
| Contexto por llamada | ~470 tokens de entrada (el modo por defecto cargaba 350 000+) |
| Tiempo por tarea | 4,5 s (caption), 5,6 s (hooks), 7,2 s (guion) |
| Salida estructurada | `structured_output` presente con `--json-schema`, también en `stream-json` |
| Modelo registrado | `modelUsage` → `claude-sonnet-5-5` |
| Coste de cuota | < 0,5 % de la ventana de 5 h por trabajo (la ventana pasó de 1 % a 2 % tras ~6 llamadas) |
`total_cost_usd` es una estimación del cliente, no factura.

## 3. Telemetría de cuota (verificado; campo no documentado)
En `stream-json` el CLI emite un evento `rate_limit_event`:
```
rate_limit_info: { status:"allowed", rateLimitType:"five_hour", resetsAt:<epoch>,
  overageStatus:"rejected", isUsingOverage:false,
  unifiedWindows:{ five_hour:{utilization:0.02,resetsAt}, seven_day:{utilization:0.40,resetsAt} } }
```
- Da el **uso real** de las ventanas de 5 h y semanal (fracción 0-1, granularidad ~1 %) y cuándo se reinician.
- Estado medido hoy: 5 h ≈ 2 %, **semana ≈ 40 %**. La cuota es compartida con tu uso interactivo (incluida esta sesión de desarrollo).
- **Diseño:** el worker lee el evento tras cada trabajo y lo publica en la API. La cola se autolimita por **uso real** (umbrales configurables, propuesta: pausa si 5 h ≥ 80 % o semana ≥ 85 %), y los contadores diarios/semanales de trabajos quedan como segunda barrera. Como el campo no está documentado, se trata como **opcional**: si falta, solo rigen los contadores.
- `/usage` **no** funciona en `-p` ("isn't available in this environment").

## 4. Errores de `claude -p` (verificado con errores reales; cuota **no verificado**)
Observado (exit **1**): la respuesta sigue siendo un `result` con `is_error:true`, y **`subtype:"success"`** (trampa: no basta con mirar `subtype`), `terminal_reason:"api_error"`, `api_error_status` (404 con modelo inexistente, `null` sin sesión) y el texto en `result`:
- Sin sesión: `Not logged in · Please run /login`.
- Modelo inexistente: `There's an issue with the selected model (...)`.
Documentado (no provocable sin agotar la cuota): `You've hit your session limit · resets 3:45pm`, `…weekly limit · resets Mon 12:00am`, `…Opus/Sonnet limit`, `…monthly spend limit`, `Credit balance is too low`, `API Error: Request rejected (429)`, `Server is temporarily limiting requests (not your usage limit)`, `Request timed out`, `Repeated 529 Overloaded`, `Login expired`, `OAuth token expired/revoked`. La documentación describe además una forma `{"type":"error","error":{"type":"usage_limit_error",...}}` que **no se observó**; el clasificador debe aceptar ambas.

**Clasificación propuesta** (probada solo con fixtures hasta que ocurra un límite real):
| Clase | Señal | Acción |
|---|---|---|
| `quota` | `hit your (session\|weekly\|… ) limit` / `usage_limit_error` | Pausar la cola hasta `resetsAt` (del evento o del texto), avisar, no reintentar |
| `billing` | `spend limit`, `Credit balance is too low` | Pausar indefinidamente, avisar (requiere acción tuya) |
| `auth` | `Not logged in`, `Login expired`, `OAuth token …` | Pausar, avisar, no reintentar |
| `transient` | 429/5xx/529, `Request timed out`, `No response from API`, `temporarily limiting` | Reintentar con backoff (1, 5, 20 min; máx. 3) |
| `permanent` | 404 modelo, esquema inválido, otro | Fallar el trabajo sin reintento |
Un `is_error:false` con `structured_output` que no valida el esquema → `permanent` (un reintento como máximo con el error en el prompt).

## 5. Comprobación de salud previa (verificado)
`claude auth status --json` → `{"loggedIn": true, "authMethod":"claude.ai", ...}` (exit 0), o `loggedIn:false, authMethod:"none"` sin sesión. El worker lo ejecuta al arrancar y ante cualquier error `auth`. Variables peligrosas (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, `CODEX_API_KEY`): 0 presentes hoy; el worker se niega a arrancar si aparece alguna.

## 6. Aislamiento
`CLAUDE_CONFIG_DIR` vacío ⇒ sin sesión (verificado): un directorio propio exigiría un login propio (`claude auth login`, interactivo, lo haces tú). Con `--setting-sources project`, `--strict-mcp-config` y `--tools ""`, el `claude` normal **ya no carga** tus hooks, MCP ni skills (verificado por el contexto de ~470 tokens), y `--no-session-persistence` evita escribir sesiones.
**Decisión:** empezar con la configuración de usuario normal + estas banderas (sin login adicional); pasar a `CLAUDE_CONFIG_DIR` propio solo si aparece un problema. Un timeout por trabajo (propuesta 120 s) con SIGTERM; la doc indica exit 143.

## 7. `codex exec` (verificado)
```
codex exec --json --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules \
  -s read-only --output-schema <archivo> "<prompt>"   < /dev/null
```
- Sesión ChatGPT activa. Eventos: `thread.started`, `turn.started`, `item.completed`, `turn.completed{usage}`. 10,6 s; ~14 500 tokens de entrada por llamada (unas 30 veces más que `claude` mínimo). **Sin información de cuota** en los eventos.
- Errores (exit 1): evento `turn.failed{error.message}`. Sin sesión (`CODEX_HOME` vacío): 10 reintentos de reconexión (~40 s) antes de fallar con 401 ⇒ el adaptador debe comprobar `codex login status` antes y aplicar un timeout corto. Modelo inválido: `The 'X' model is not supported when using Codex with a ChatGPT account.`
- Sin telemetría de límites: solo contadores de trabajos (propuesta: máx. 5/día, solo manual por tarea, plan Plus).
- **No verificado:** límites de Codex en Plus y el mensaje de cuota agotada.

## 8. Cambios al plan (`02-plan-fase-2.md`)
1. La cola se autolimita por **uso real** (evento de cuota), no solo por conteo.
2. Clasificador de errores por texto/estado con fixtures; cuota real sin verificar hasta que ocurra.
3. Sin `CLAUDE_CONFIG_DIR` propio al inicio (menos pasos para ti).
4. Módulo 2.1 (núcleo de la cola) puede empezar: no hay bloqueos.

## 9. Riesgos que persisten
- El campo `rate_limit_event` no está documentado: puede cambiar sin aviso.
- La cuota semanal ya está al 40 % por el desarrollo; el worker convive con ella.
- El texto exacto del límite real, sin verificar.
