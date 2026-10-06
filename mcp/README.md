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

### Claude Desktop y claude.ai (Settings → Connectors) — OAuth
1. **Settings → Connectors → Add custom connector**.
2. URL: `https://mcp.andresgomez.store/mcp`. Deja vacíos el ID y el secreto de cliente (se registran solos).
3. Claude abre una página del servidor, «Aprobar acceso». Escribe tu clave: es el valor de `MCP_TOKEN`.
4. Listo: aparecen las 4 herramientas. Los conectores personalizados suelen ligarse a la cuenta, así que también valen en claude.ai web y en el celular.

### Claude Code — token fijo
```
claude mcp add --transport http panel https://mcp.andresgomez.store/mcp --header "Authorization: Bearer TU_TOKEN"
```

## Cómo funciona la seguridad
- `/mcp` solo acepta un token Bearer: el token fijo (`MCP_TOKEN`) o un token OAuth firmado (acceso 1 h, refresco 30 días).
- OAuth sin estado: client_id, códigos y tokens son cadenas firmadas con HMAC derivadas de `MCP_TOKEN`. No hay base de datos y sobreviven a reinicios.
- Los códigos de autorización duran 5 min, son de un solo uso y exigen PKCE (S256). Las `redirect_uri` deben coincidir con las registradas.
- La clave de aprobación es `MCP_TOKEN`; tras 10 intentos fallidos en 15 min la página se bloquea.
- **Rotar `MCP_TOKEN` en Easypanel invalida todas las sesiones OAuth y el token fijo.** Tendrás que reconectar los clientes.
- Variable opcional `PUBLIC_URL` (por defecto `https://mcp.andresgomez.store`): debe coincidir con el dominio público.
- Si cambias la contraseña del panel, actualiza `PANEL_PASSWORD`.

## Pruebas
`cd mcp && npm ci && npm test`
