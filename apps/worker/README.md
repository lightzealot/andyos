# Worker de IA

Programa Node que corre en este Mac mini, consulta la cola de la API por *pull* (solo conexiones salientes), ejecuta el CLI y devuelve el resultado como **borrador**. Diseño: `docs/02-plan-fase-2.md`, verificaciones: `docs/03-spike-2-0.md`, contrato de la cola: `docs/04-cola-de-ia.md`.

## Qué hace (y qué no)
- Reclama un trabajo (`POST /worker/claim`), ejecuta `claude -p` con la configuración mínima del spike (sin herramientas, MCP, skills ni hooks; `--no-session-persistence`) o `codex exec` **solo si el trabajo lo pide y `ENABLE_CODEX=true`**, clasifica el resultado y lo reporta con la cuota real que observó.
- Los errores se clasifican en `quota`, `billing`, `auth`, `transient` y `permanent`; la API decide reintentos, pausa y aviso.
- Nunca usa `--bare` ni `bypassPermissions`. No lee el repo ni tus archivos: el CLI corre en `~/.andyos-worker/work` y con un entorno filtrado (`PATH`, `HOME`, `USER`, `LANG`, `TMPDIR`…).
- **Se niega a arrancar** si el entorno tiene `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_*`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` o `CODEX_API_KEY` (cobro por token), o si `claude` no está autenticado con la **suscripción** (`authMethod: claude.ai`).
- No registra prompts, salidas ni el token.

## Variables (archivo `~/.andyos-worker/worker.env`, permisos 600)
| Variable | Valor |
|---|---|
| `API_URL` | `https://api.andresgomez.store` (https obligatorio; http solo localhost) |
| `WORKER_TOKEN` | El mismo que la variable de la API (≥32 caracteres) |
| `CLAUDE_BIN` / `CODEX_BIN` | Rutas absolutas (el script de instalación las detecta) |
| `ENABLE_CODEX` | `true` para permitir trabajos con `codex` (por defecto `false`) |
| `WORK_DIR` | Directorio de trabajo aislado (`~/.andyos-worker/work`) |
| `POLL_INTERVAL_S` | Sondeo sin trabajo, 2-600 (defecto 15) |

## Instalar como servicio (LaunchAgent)
```
apps/worker/scripts/install-launchd.sh --dry-run   # genera y valida el plist, no instala
apps/worker/scripts/install-launchd.sh             # instala e inicia
apps/worker/scripts/uninstall-launchd.sh           # lo detiene y elimina
tail -f ~/.andyos-worker/logs/worker.log
```
Requisitos verificados: bajo `launchd` con entorno mínimo, `claude` encuentra la sesión de suscripción en el llavero y hace llamadas reales.
**Limitación:** es un LaunchAgent del usuario, así que arranca cuando `andyai` inicia sesión. Si el Mac se reinicia (p. ej. corte de luz) sin inicio de sesión automático, el worker no arranca hasta que inicies sesión. Activa *Configuración → Usuarios y grupos → Inicio de sesión automático* si quieres que se recupere solo. Mientras el Mac esté en suspensión el worker no trabaja: desactiva la suspensión en *Batería/Energía*.

## Pruebas
`npm test -w apps/worker` (78 tests): configuración, clasificador con **textos reales** capturados y de la documentación, adaptadores contra CLI simulados y contra **salidas reales** guardadas en `test/fixtures`, e integración con la API real en memoria (éxito, cuota, sesión caducada, transitorio, permanente, esquema inválido, uso alto, fallos de red).
Comprobado con mutaciones: romper el filtro de entorno, el timeout, la clasificación de cuota o el control de sesión hace fallar las pruebas.

## Qué no está verificado
- El texto exacto de la **cuota agotada** de Claude (solo la documentación) ni el de Codex Plus.
- El evento `rate_limit_event` no está documentado: puede cambiar; si falta, la API usa solo los contadores.
