# MCP del panel de contenido

Servidor MCP (HTTP) para leer y rellenar las piezas del panel desde Claude Code o Claude Desktop. Entra a Supabase **con tu usuario** (RLS activa), nunca con `service_role`.

Herramientas: `listar_piezas`, `crear_pieza`, `crear_piezas` (hasta 50), `actualizar_pieza`. No borra.

## Variables de entorno (Easypanel → servicio → Environment)
| Variable | Valor |
|---|---|
| `SUPABASE_URL` | `https://qoxrjknanizdniyirvkm.supabase.co` |
| `SUPABASE_KEY` | clave pública (publishable) del proyecto |
| `PANEL_EMAIL` | correo de tu usuario del panel |
| `PANEL_PASSWORD` | contraseña de ese usuario |
| `MCP_TOKEN` | token largo para conectarte (`openssl rand -hex 32`, mínimo 32 caracteres) |

El token y la contraseña solo viven en Easypanel y en tu cliente. No los pegues en chats ni en el repo.

## Despliegue en Easypanel
1. Servicio **App** desde el repo `lightzealot/andyos`, rama `main`.
2. Build: **Dockerfile**, ruta `mcp/Dockerfile`, contexto en la raíz del repo.
3. Variables de arriba.
4. Dominio (por ejemplo `mcp.andresgomez.store`), puerto **80** (Easypanel define `PORT=80`; sin esa variable el servidor usa 3000), protocolo HTTP (Easypanel pone el HTTPS).
5. Comprobar: `curl https://mcp.andresgomez.store/health` → `{"ok":true}`.

## Conectar clientes
Claude Code:
```
claude mcp add --transport http panel https://mcp.andresgomez.store/mcp --header "Authorization: Bearer TU_TOKEN"
```
Claude Desktop (puente `mcp-remote`, en `claude_desktop_config.json`):
```json
{ "mcpServers": { "panel": {
  "command": "npx",
  "args": ["-y", "mcp-remote", "https://mcp.andresgomez.store/mcp", "--header", "Authorization:${PANEL_AUTH}"],
  "env": { "PANEL_AUTH": "Bearer TU_TOKEN" }
} } }
```
No funciona en claude.ai web ni en el celular (exigen OAuth).

## Seguridad
- `/mcp` exige `Authorization: Bearer` (comparación en tiempo constante) y bloquea tras 20 intentos fallidos por minuto.
- Rota el token cambiando `MCP_TOKEN` en Easypanel y en tus clientes.
- Si cambias la contraseña del panel, actualiza `PANEL_PASSWORD`.

## Pruebas
`cd mcp && npm ci && npm test`
