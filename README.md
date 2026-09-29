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

## Reglas de aprobación
Ningún contenido pasa a Programado/Publicado/Analizado sin pulsar «Aprobar» en la etapa Aprobación; editar hook, guion, caption o enlaces de un contenido aprobado retira la aprobación.
