# AndyOS — Diseño base (Fase 0, desde cero)

Estado: BORRADOR para aprobación. Sin código de features. Fecha: 2026-09-28.
Lo marcado **[VERIFICAR]** no está confirmado en documentación oficial y no se diseña sobre ello hasta comprobarlo.

## 1. Qué es
Dashboard personal (Next.js + TS + Tailwind) que gestiona el Content Engine:
Concepto → Mercado → Formato → Guion → Publicación → Datos → nuevos conceptos.
Guion: Hook → Contexto → Cambio → Aplicación/Demo → Resultado → CTA.

## 2. Arquitectura acordada (v2)

Monorepo único `AndyOS`: `apps/web` (Next.js con export estático, en Netlify), `apps/api` (Fastify/Hono + Drizzle + SQLite, en VPS/Easypanel), `apps/worker` (homelab, Fase 2), `n8n/` (workflows JSON), `docs/`.
- Frontend: `os.<dominio>` (Netlify). API: `api.<dominio>` (VPS). Mismo dominio padre para cookie httpOnly de sesión.
- n8n: `n8n.andresgomez.store` (confirmado). Frontend `os.andresgomez.net`, API `api.andresgomez.net` (confirmados). Repo: github.com/lightzealot/andyos.
- La API es el único punto expuesto: login, rate limit, CORS restringido, webhooks con HMAC.
- Base de datos: SQLite en volumen persistente.
Lo de abajo (diagrama v1) se mantiene salvo que "AndyOS" = `apps/web` + `apps/api`.

## 2b. Arquitectura propuesta v1 (mínima)

```
Navegador ──> AndyOS (Next.js, homelab, solo red privada)
                 │  route handlers (servidor, NO el navegador)
                 ▼  webhook + secreto compartido (HMAC)
              n8n (VPS n8n.andresgomez.store)
                 ▲  worker hace POLL saliente (pull)
              Worker IA (homelab) ── CLI de suscripción, dir aislado, permisos mínimos
```

Decisiones de diseño y crítica:
- **Pull, no push, hacia el worker.** n8n está en el VPS y el CLI en el homelab. Si n8n "llamara" al worker, tendrías que exponer el homelab a Internet (viola el principio 6). El worker consulta una cola por HTTPS saliente. Alternativa: Tailscale entre VPS y homelab.
- **La cola vive en n8n/AndyOS, no en un servicio nuevo** (sin Redis). Tabla `ai_jobs` + un worker de ~100 líneas. Concurrencia, límites y backoff se implementan ahí.
- **"El dashboard nunca llama a APIs externas"**: se cumple con route handlers de servidor que solo hablan con n8n. Para el panel n8n (listar workflows/ejecuciones) hará falta guardar una API key de n8n en el servidor de AndyOS: acotada y solo lectura + disparar. Es la única excepción y hay que aceptarla explícitamente.
- **Aprobación humana**: estado `approved_at/approved_by` obligatorio para pasar a `scheduled`/`published`. Ningún flujo n8n de publicación se ejecuta sin ese campo.

## 3. Decisión de base de datos (recomendación)
| Opción | Pro | Contra |
|---|---|---|
| **SQLite (Drizzle)** ← recomendada | 1 archivo, backup trivial, cero servicios que operar, suficiente para 1 usuario | Sin multiusuario/realtime; migrar luego a Postgres es viable con Drizzle |
| Postgres local (Docker) | Más robusto, JSONB | Un servicio más que operar |
| Supabase | Auth/realtime listos | Autohospedado son ~10 contenedores; cloud sube datos a terceros. Excesivo para 1 usuario |

Recomendación: SQLite ahora. Solo pasar a Postgres si aparece necesidad real (multiusuario, concurrencia de escritura). "Preparado para Supabase" no se implementa.

## 4. Esquema de datos
Modelo genérico `work_items` + tabla de detalle de contenido (evita columnas nulas por tipo).

**work_items** (genérico): `id, type (idea|content|task|reference), title, status, notes, tags(json), created_at, updated_at, archived_at`

**content_details** (1:1 con work_items donde type=content):
`work_item_id, platform (instagram|tiktok|youtube|linkedin|x), format (reel|carousel|short|post|video|story),
pillar/tema, hook, script (json: hook, contexto, cambio, aplicacion, resultado, cta),
caption, scheduled_at, published_at, published_url, asset_links (json),
cta_keyword (para embudo), approved_at, approved_by, ai_generated (bool)`

**Estados del kanban** (`status`): idea → hook → guion → produccion → edicion → aprobacion → programado → publicado → analizado.

**metrics** (N por contenido): `id, work_item_id, captured_at, views, likes, comments, saves, shares, watch_time, follows, source`

**item_links** (relaciones): `from_id, to_id, kind (derived_from|inspired_by|repurposed_from)` → une contenido con referencias e ideas.

**references_meta**: `work_item_id, url, creator, platform, why_it_works, hook_pattern`

**ai_jobs** (Fase 2): `id, task, input(json), schema, status (queued|running|done|failed|paused_quota), attempts, provider, model, output(json), error, created_at, finished_at`
Toda salida de IA guarda `provider` y `model`, y queda como borrador hasta aprobación.

**funnel_events** (Fase 3): `post_id, keyword, comment_id, dm_sent_at, resource_id, converted`

## 5. Fases y módulos (sin cambios respecto a tu plan, con matices)
- F1: Kanban, Calendario, Inbox (Telegram→n8n→webhook), Referencias, Panel n8n.
- F2: Gateway IA + Estudio de guiones + CarruselOS (el skill local ya exige aprobación explícita; se integra como enlace/estado, no se reescribe).
- F3: Embudo, analytics, lead magnets.

## 6. Lo que necesito de ti
1. **Confirmar SQLite** (o elegir otra) y que el hosting objetivo es el homelab Ubuntu + Docker (este Mac no tiene Docker: desarrollo local con Node, despliegue con Docker en homelab).
2. **Conectividad VPS↔homelab**: ¿Tailscale/WireGuard ya existe? Si no, se usa el modelo pull.
3. **Versión de n8n** y si su API pública está habilitada; crear una API key de mínimo privilegio [VERIFICAR qué expone tu versión].
4. **Telegram**: token de un bot nuevo (solo para ti, restringido a tu chat id).
5. **Proveedor IA principal**: candidatos `claude` (2.1.284, sesión claude.ai) y `codex` (0.158.0, sesión ChatGPT). Falta [VERIFICAR] en docs oficiales: uso programático con suscripción, facturación vigente, límites, JSON de salida. Riesgo a evitar: `--bare` / `ANTHROPIC_API_KEY` en el entorno del worker pueden cambiar a facturación por token.
6. **Voz de marca**: 5–10 guiones/captions tuyos reales para el contexto del estudio de guiones.
7. **Estado de tu plataforma de Instagram** (repo/n8n): para el embudo de Fase 3 solo necesito saber dónde guarda los eventos.
8. **Nombre del repo/carpeta**: propongo `~/Documents/claude/AndyOS` (ya creada, con solo esta nota). Rama por fase; git aún no iniciado.

## 7. Riesgos
- Términos/facturación del uso programático de CLIs de suscripción (cambiantes).
- Publicación automática en Instagram/TikTok/YouTube: permisos y límites de API [VERIFICAR]; lo no automatizable queda como paso manual asistido.
- Cuota agotada: la cola debe pausar y avisar, no fallar en silencio.
- Cada módulo nuevo es operación adicional: no se añade nada sin uso claro.

## 8. Resultados de las pruebas de CLIs (2026-09-28)

Fuentes: code.claude.com/docs/en/headless, /authentication, /agent-sdk/overview; support.claude.com artículo 15036540; developers.openai.com/codex/noninteractive.

**Facturación (verificado)**
- `claude -p` con login de suscripción: hoy sigue descontando de los límites del plan. Anthropic anunció (15-jun-2026) pasarlo a un crédito mensual aparte (Pro $20, Max 5x $100, Max 20x $200) y luego lo **pausó**; puede volver. Sin crédito y sin "usage credits" activados, las peticiones se detienen; con ellos activados, cobra a tarifa API.
- `--bare` NO usa la suscripción (exige `ANTHROPIC_API_KEY`): prohibido en el worker. Si `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` existe en el entorno, `-p` lo usa siempre → cobro por token. El worker debe arrancar con esas variables eliminadas. (En esta máquina no estaban definidas.)
- Términos: Anthropic no permite a terceros ofrecer login/límites de claude.ai en sus productos. Uso personal propio no está prohibido en lo leído, pero **no hay garantía escrita** de que una cola automática 24/7 con suscripción sea uso aceptado. Riesgo asumido y documentado.
- Codex: la doc recomienda API key en CI; el login ChatGPT se menciona para enterprise. En la prueba funcionó con login ChatGPT personal. Términos para automatización: NO verificado.

**Rendimiento medido (mismo prompt de 5 hooks)**
| Config | Tiempo | Tokens de contexto | Coste estimado* |
|---|---|---|---|
| `claude -p` por defecto (carga MCPs, skills, hooks) | 12-20 s | 350k-630k | 1.4-2.5 USD |
| `claude -p` mínimo | 4 s | ~1.1k | 0.008 USD |
| `codex exec` | 12 s | ~19.9k | n/d |
*estimación cliente, no factura real.
Config mínima de claude usada: `--tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --disable-slash-commands --setting-sources project --system-prompt "..." --permission-mode dontAsk --output-format json --json-schema <schema>` con `</dev/null`. Salida en `.structured_output`. `codex exec` requiere `</dev/null` (si no, se cuelga esperando stdin), `--skip-git-repo-check -s read-only --output-schema f.json --output-last-message out.json`.

**Calidad (hooks, guion, caption)**: Claude produjo texto más específico y en voz directa, con estructura correcta y JSON válido en 3/3. Debilidad: **inventa cifras/afirmaciones** ("6 nodos", "3 segundos", "cero herramientas de pago") → toda salida requiere revisión humana (ya es requisito). Codex: JSON válido, texto más genérico y menos afilado; solo probé hooks (1/3 tareas).

## 9. Decisiones tomadas
- Base de datos: SQLite (Drizzle). Arquitectura: opción A (web estática en Netlify + `andyos-api` en VPS + worker pull en homelab). Dominios: `os.` / `api.andresgomez.net`; n8n en `n8n.andresgomez.store`.
- Proveedor IA principal: `claude -p` en configuración mínima. Respaldo: `codex exec`. (Confirmado 2026-09-28.)
- Reglas del worker: sin `--bare`, sin `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` en el entorno, directorio aislado, nunca bypassPermissions.
- Riesgo de facturación/términos de `claude -p` aceptado y informe de Fase 0 aprobado por Andrés (2026-09-28).
