# Variables de entorno: qué va dónde

Nunca se suben al repo (`.env` está en `.gitignore`). Solo `.env.example` (sin valores reales) está versionado.

> **Atajo:** en tu máquina hay un archivo `.env.production` (ignorado por git, permisos 600) con los secretos ya generados y todas las variables de abajo. Ábrelo con un editor y copia los valores; no lo subas ni lo pegues en chats.

## 1. API — Easypanel (servicio `andyos-api`, pestaña *Environment*)
| Variable | Valor | Obligatoria |
|---|---|---|
| `ANDYOS_PASSWORD` | Contraseña de login (larga, única) | Sí |
| `SESSION_SECRET` | `openssl rand -hex 32` (≥32 caracteres). Cambiarlo cierra todas las sesiones | Sí |
| `INBOX_WEBHOOK_SECRET` | `openssl rand -hex 32` (≥32). **El mismo valor** va en n8n (credencial Header Auth) | Sí |
| `WEB_ORIGIN` | `https://os.andresgomez.store` (origen exacto permitido por CORS, sin barra final) | Sí |
| `COOKIE_DOMAIN` | **No la definas.** Sin ella la cookie de sesión queda ligada solo a `api.andresgomez.store` (más seguro: no viaja a `n8n.andresgomez.store` ni a otros subdominios) y funciona igual desde `os.` por ser del mismo sitio | No |
| `TRUST_PROXY` | `true` (ya viene en el Dockerfile; necesario tras el proxy de Easypanel) | Ya incluida |
| `NODE_ENV` | `production` (ya viene en el Dockerfile; activa cookie `Secure`) | Ya incluida |
| `DB_PATH` | `/data/andyos.db` (ya viene en el Dockerfile) | Ya incluida |
| `HOST` | `0.0.0.0` (ya viene en el Dockerfile) | Ya incluida |
| `PORT` | Lo define Easypanel (`80`); el Dockerfile trae `8787` por defecto solo para uso fuera de Easypanel | No |

**Panel n8n (opcional; o defines las tres o ninguna, si defines solo algunas la API no arranca):**
| Variable | Valor |
|---|---|
| `N8N_BASE_URL` | `https://n8n.andresgomez.store` (sin barra final; `http://` solo para localhost) |
| `N8N_API_KEY` | Clave de n8n con alcances `workflow:list` y `execution:list` (solo lectura) |
| `N8N_TRIGGER_SECRET` | `openssl rand -hex 32` (≥32). Mismo valor que la credencial Header Auth «AndyOS Trigger Secret» en n8n |

**Respaldo diario (opcional; sin ella el endpoint no existe):**
| Variable | Valor |
|---|---|
| `BACKUP_WEBHOOK_SECRET` | `openssl rand -hex 32` (≥32, **distinto** de `INBOX_WEBHOOK_SECRET`). Mismo valor que la credencial Header Auth «AndyOS Backup Secret» en n8n |

**Cola de IA (Fase 2, opcional; sin `WORKER_TOKEN` el módulo no existe). No las añadas hasta que exista el worker (módulo 2.2):**
| Variable | Valor |
|---|---|
| `WORKER_TOKEN` | `openssl rand -hex 32` (≥32, distinto de los demás secretos). Lo usa el worker como `Authorization: Bearer` |
| `ALERT_WEBHOOK_URL` | `https://n8n.andresgomez.store/webhook/andyos-alerta` (https obligatorio) |
| `ALERT_WEBHOOK_SECRET` | `openssl rand -hex 32`. Mismo valor que la credencial Header Auth «AndyOS Alert Secret» en n8n. Las dos `ALERT_*` van juntas o ninguna |

**Resumen diario por Telegram (opcional, necesita `ALERT_WEBHOOK_*`):**

| Variable | Valor |
|---|---|
| `DIGEST_TZ` | Tu zona horaria IANA, p. ej. `America/Mexico_City`. **Sin ella el resumen no existe** (no adivino tu zona). Un valor inválido impide arrancar la API |
| `DIGEST_HOUR` | Hora local (0–23) a partir de la cual se envía; defecto `9` |

**Publicar en Instagram vía Windsor (opcional, módulo apagado si falta `PUBLIC_API_URL`):**

| Variable | Valor |
|---|---|
| `PUBLIC_API_URL` | `https://api.andresgomez.store` (https obligatorio; `http://localhost…` solo en local). Instagram lee las imágenes desde esta URL, así que tiene que ser pública. **Su presencia activa el módulo** (subida de imágenes y modo de prueba) |
| `WINDSOR_API_KEY` | Tu clave de Windsor: **onboard.windsor.ai → «Hello [tu correo]» (arriba a la derecha) → Settings → pestaña Account → API Access → icono del ojo/copiar**. Es una clave de cuenta completa (puede leer tus datos de Windsor): guárdala solo aquí, nunca en el chat, y róntala en Windsor si se filtra |
| `WINDSOR_IG_ACCOUNT_ID` | Id de tu cuenta de Instagram en Windsor (la de `andyontrade` es `17841400336240228`; se ve con `get_connectors`) |
| `IG_ACCOUNT_NAME` | Nombre que se muestra en la confirmación, p. ej. `andyontrade` |
| `PUBLISHING_ENABLED` | **No la definas al principio.** Sin ella todo funciona en **MODO DE PRUEBA** (se ve la vista previa y lo que se enviaría, pero no se envía nada). Solo `true` activa la publicación real; con `true` la API **se niega a arrancar** si falta `WINDSOR_API_KEY` o `WINDSOR_IG_ACCOUNT_ID` |
| `WINDSOR_MCP_URL` | Opcional. Por defecto `https://mcp.windsor.ai/` |
| `MEDIA_DIR` | Opcional. Por defecto `<carpeta de la base>/media` (en Easypanel `/data/media`, dentro del volumen persistente) |

Además en Easypanel: **volumen persistente montado en `/data`**, dominio `api.andresgomez.store` con HTTPS. **Puerto del dominio: `80`**: Easypanel inyecta `PORT=80` en el contenedor y la app escucha en ese puerto (verifícalo en el log: `andyos-api escuchando en :80`). Si el puerto del dominio no coincide con el del log, da 502.

## 2. Web — Netlify (*Site configuration → Environment variables*)
| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.andresgomez.store` |

Se incrusta **al compilar**: si la cambias hay que volver a desplegar. `NODE_VERSION=24` ya está en `netlify.toml`. Dominio `os.andresgomez.store` en Netlify.
`NEXT_PUBLIC_*` es visible en el navegador: nunca pongas secretos en la web.

## 3. n8n — credenciales (no son variables de entorno)
| Credencial | Tipo | Contenido |
|---|---|---|
| «Telegram AndyOS» | Telegram API | Token de @BotFather |
| «AndyOS Inbox Secret» | Header Auth | *Name* `X-Webhook-Secret`, *Value* = `INBOX_WEBHOOK_SECRET` |
| «AndyOS Backup Secret» | Header Auth | *Name* `X-Webhook-Secret`, *Value* = `BACKUP_WEBHOOK_SECRET` |
| «AndyOS Alert Secret» | Header Auth | *Name* `X-Webhook-Secret`, *Value* = `ALERT_WEBHOOK_SECRET` |
| «AndyOS Trigger Secret» | Header Auth | *Name* `X-Webhook-Secret`, *Value* = `N8N_TRIGGER_SECRET` (distinto del secreto del Inbox) |
| Clave de API (Settings → n8n API) | API key | Alcances `workflow:list` y `execution:list`; su valor va en `N8N_API_KEY` |

Y en el nodo *Telegram Trigger* → *Chat IDs*: tu chat id.

## 4. Desarrollo local (`.env` en la raíz, copiado de `.env.example`)
`ANDYOS_PASSWORD`, `SESSION_SECRET`, `INBOX_WEBHOOK_SECRET`, `WEB_ORIGIN=http://localhost:3000`, `DB_PATH=./data/andyos.db`, `PORT=8787`. La web usa `NEXT_PUBLIC_API_URL=http://localhost:8787` (variable de shell al lanzar `dev:web`).

## 5. DNS
- `os.andresgomez.store` → el destino que indique Netlify (CNAME).
- `api.andresgomez.store` → IP del VPS (registro A), servido por Easypanel.
