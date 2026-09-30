import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import type { Db } from './db.js';
import { makeSession, passwordMatches, sessionValid } from './auth.js';
import { insertContent } from './content.js';
import { registerIdeas } from './ideas.js';
import { registerReferences } from './references.js';
import { registerN8n, type N8nConfig } from './n8n.js';
import { registerBackup } from './backup.js';
import { registerAi } from './ai.js';
import { registerVoice } from './voice-routes.js';
import { makeNotifier } from './notify.js';
import { APPROVAL_FIELDS, CreateItem, GATED, PatchItem, STATUSES } from './model.js';

export interface Config {
  password: string;
  sessionSecret: string;
  webOrigin: string;
  cookieDomain?: string;
  secureCookie: boolean;
  inboxSecret: string;
  /** true solo si la API está detrás de un proxy de confianza (Easypanel/Traefik). */
  trustProxy?: boolean;
  /** Panel de n8n; ausente = módulo desactivado. */
  n8n?: N8nConfig;
  /** Secreto del endpoint de respaldo; ausente = endpoint desactivado. */
  backupSecret?: string;
  /** Cola de IA: sin workerToken el módulo no existe. */
  workerToken?: string;
  /** Webhook de n8n para avisos (Telegram). */
  alert?: { url: string; secret: string };
  /** Reloj inyectable (tests). */
  now?: () => number;
}

const COOKIE = 'andyos_session';
const CONTENT_COLS = [
  'platform', 'format', 'pillar', 'hook', 'script', 'caption', 'scheduled_at',
  'published_at', 'published_url', 'asset_links', 'cta_keyword',
] as const;
const JSON_COLS = new Set(['script', 'asset_links']);

const SELECT = `
  SELECT w.id, w.type, w.title, w.status, w.notes, w.tags, w.created_at, w.updated_at,
         c.platform, c.format, c.pillar, c.hook, c.script, c.caption, c.scheduled_at,
         c.published_at, c.published_url, c.asset_links, c.cta_keyword, c.approved_at, c.ai_generated
  FROM work_items w LEFT JOIN content_details c ON c.work_item_id = w.id`;

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Item = Record<string, any>;
const parse = (r: Row): Item => ({
  ...r,
  tags: JSON.parse(r.tags as string),
  script: r.script ? JSON.parse(r.script as string) : {},
  asset_links: r.asset_links ? JSON.parse(r.asset_links as string) : [],
  ai_generated: Boolean(r.ai_generated),
});

export async function buildApp(db: Db, cfg: Config) {
  const app = Fastify({ logger: false, trustProxy: cfg.trustProxy ?? false });

  // Los errores del servidor no devuelven mensajes internos (SQL, rutas, etc.); el detalle solo va al log.
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) {
      console.error('[error]', err.message);
      return reply.code(500).send({ error: 'internal_error' });
    }
    return reply.code(status).send({ error: status === 429 ? 'rate_limited' : 'bad_request' });
  });
  await app.register(cookie);
  await app.register(cors, { origin: cfg.webOrigin, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
  await app.register(rateLimit, { global: false });

  const getItem = (id: string) => {
    const r = db.prepare(`${SELECT} WHERE w.id = ? AND w.type = 'content' AND w.archived_at IS NULL`).get(id) as Row | undefined;
    return r ? parse(r) : undefined;
  };

  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/auth/login') || req.url === '/health' || req.url.startsWith('/webhooks/') || req.url.startsWith('/worker/')) return;
    if (req.method === 'OPTIONS') return;
    if (!sessionValid(req.cookies[COOKIE], cfg.sessionSecret)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/health', async () => ({ ok: true }));

  app.post('/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ password: z.string().max(200) }).safeParse(req.body);
    if (!body.success || !passwordMatches(body.data.password, cfg.password)) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    reply.setCookie(COOKIE, makeSession(cfg.sessionSecret), {
      httpOnly: true, sameSite: 'lax', secure: cfg.secureCookie, path: '/',
      domain: cfg.cookieDomain, maxAge: 7 * 24 * 3600,
    });
    return { ok: true };
  });

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/', domain: cfg.cookieDomain });
    return { ok: true };
  });

  app.get('/auth/me', async () => ({ ok: true }));

  app.get('/items', async (req) => {
    const { type } = z.object({ type: z.enum(['content']).optional() }).parse(req.query);
    const rows = (type
      ? db.prepare(`${SELECT} WHERE w.archived_at IS NULL AND w.type = ? ORDER BY w.updated_at DESC`).all(type)
      : db.prepare(`${SELECT} WHERE w.archived_at IS NULL ORDER BY w.updated_at DESC`).all()) as Row[];
    return { items: rows.map(parse), statuses: STATUSES };
  });

  app.post('/items', async (req, reply) => {
    const body = CreateItem.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid', details: body.error.flatten() });
    const d = body.data;
    if ((GATED as readonly string[]).includes(d.status)) {
      return reply.code(409).send({ error: 'approval_required' });
    }
    const id = insertContent(db, d);
    return reply.code(201).send(getItem(id));
  });

  app.get('/items/:id', async (req, reply) => {
    const item = getItem((req.params as { id: string }).id);
    return item ?? reply.code(404).send({ error: 'not_found' });
  });

  app.patch('/items/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = getItem(id);
    if (!current) return reply.code(404).send({ error: 'not_found' });
    const body = PatchItem.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid', details: body.error.flatten() });
    const d = body.data as Record<string, unknown>;

    const touchesApproved = APPROVAL_FIELDS.some((f) => f in d && JSON.stringify(d[f]) !== JSON.stringify(current[f]));
    let status = (d.status ?? current.status) as string;
    let approvedAt = current.approved_at as string | null;
    if (touchesApproved && approvedAt) {
      approvedAt = null; // editar contenido aprobado invalida la aprobación
      if ((GATED as readonly string[]).includes(status)) status = 'aprobacion';
    }
    if ((GATED as readonly string[]).includes(status) && !approvedAt) {
      return reply.code(409).send({ error: 'approval_required' });
    }
    if (d.status && !(GATED as readonly string[]).includes(status) && STATUSES.indexOf(status as never) < STATUSES.indexOf('aprobacion')) {
      approvedAt = null; // retroceder antes de Aprobación retira la aprobación
    }

    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`UPDATE work_items SET title = ?, status = ?, notes = ?, tags = ?, updated_at = ? WHERE id = ?`)
        .run((d.title as string) ?? current.title, status, (d.notes as string) ?? current.notes,
          JSON.stringify(d.tags ?? current.tags), now, id);
      const sets: string[] = ['approved_at = ?'];
      const vals: unknown[] = [approvedAt];
      for (const col of CONTENT_COLS) {
        if (col in d) {
          sets.push(`${col} = ?`);
          vals.push(JSON_COLS.has(col) ? JSON.stringify(d[col]) : d[col]);
        }
      }
      db.prepare(`UPDATE content_details SET ${sets.join(', ')} WHERE work_item_id = ?`).run(...vals, id);
    })();
    return getItem(id);
  });

  // Aprobación humana explícita: único camino para habilitar Programado/Publicado.
  app.post('/items/:id/approve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = getItem(id);
    if (!item) return reply.code(404).send({ error: 'not_found' });
    if (item.status !== 'aprobacion') return reply.code(409).send({ error: 'not_in_approval_stage' });
    const now = new Date().toISOString();
    db.prepare('UPDATE content_details SET approved_at = ? WHERE work_item_id = ?').run(now, id);
    db.prepare('UPDATE work_items SET updated_at = ? WHERE id = ?').run(now, id);
    return getItem(id);
  });

  app.delete('/items/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const now = new Date().toISOString();
    const r = db.prepare('UPDATE work_items SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL').run(now, now, id);
    return r.changes ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  registerIdeas(app, db, cfg.inboxSecret, cfg.workerToken ? { now: cfg.now ?? Date.now } : undefined);
  registerReferences(app, db);
  registerN8n(app, cfg.n8n ?? null);
  registerBackup(app, db, cfg.backupSecret);
  registerVoice(app, db, cfg.now ?? Date.now);
  if (cfg.workerToken) {
    registerAi(app, db, { workerToken: cfg.workerToken, notify: makeNotifier(cfg.alert), now: cfg.now ?? Date.now });
  }

  return app;
}
