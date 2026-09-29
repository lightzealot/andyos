# AndyOS

Personal & Creator OS. Monorepo: `apps/web` (Next.js estático → Netlify), `apps/api` (Fastify + SQLite → VPS/Easypanel). Diseño y decisiones: [`docs/00-diseno-base.md`](docs/00-diseno-base.md).

## Desarrollo local
Requisitos: Node 24 LTS (probado también en 26) y npm.

```bash
npm install
cp .env.example .env            # edita ANDYOS_PASSWORD y SESSION_SECRET (openssl rand -hex 32)
npm run dev:api                 # http://localhost:8787
NEXT_PUBLIC_API_URL=http://localhost:8787 npm run dev:web   # http://localhost:3000
npm test                        # tests de la API
```
El frontend y la API deben compartir sitio (localhost sirve; en producción `os.` y `api.` bajo el mismo dominio padre, con `COOKIE_DOMAIN=.andresgomez.net`).

## Despliegue
- **API (Easypanel):** servicio App desde este repo, Dockerfile `apps/api/Dockerfile` con contexto en la raíz. Monta un volumen persistente en `/data` (ahí vive el `.db`). Variables: `ANDYOS_PASSWORD`, `SESSION_SECRET`, `WEB_ORIGIN=https://os.andresgomez.net`, `COOKIE_DOMAIN=.andresgomez.net`. Dominio `api.andresgomez.net` con HTTPS.
- **Web (Netlify):** `netlify.toml` ya define build y `apps/web/out`. Variable `NEXT_PUBLIC_API_URL=https://api.andresgomez.net`. Dominio `os.andresgomez.net`.
- El Dockerfile no se ha probado (no hay Docker en la máquina de desarrollo).

## Módulos
- **Pipeline** (`/`): kanban de 9 estados con drag & drop.
- **Calendario** (`/calendar/`): vista mensual y semanal, filtros por plataforma y formato; arrastra tarjetas entre días o al panel «Sin fecha». La fecha (`scheduled_at`) es un objetivo de planificación: no salta la aprobación.

Tests: `npm test` (API) y `npm test -w apps/web` (fechas).

- **Inbox** (`/inbox/`): ideas capturadas por Telegram (webhook desde n8n) o a mano; etiquetas, descartar y «Pasar al pipeline». Workflow en [`n8n/`](n8n/README.md).

Variables nuevas de la API: `INBOX_WEBHOOK_SECRET` (mín. 32 caracteres; el mismo valor va en la credencial Header Auth de n8n).

- **Referencias** (`/references/`): biblioteca con nota de *por qué funciona* y patrón de hook; «Crear contenido inspirado» genera una tarjeta en el pipeline enlazada a la referencia. La URL solo se guarda como enlace: el servidor nunca la visita.

## Reglas de aprobación
Ningún contenido pasa a Programado/Publicado/Analizado sin pulsar «Aprobar» en la etapa Aprobación; editar hook, guion, caption o enlaces de un contenido aprobado retira la aprobación.
