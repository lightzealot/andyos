import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from './db.js';
import { passwordMatches } from './auth.js';
import { FORMATS, PLATFORMS } from './model.js';
import { insertContent } from './content.js';
import { enqueue, getState, tagSuggestions } from './queue.js';

export const IDEA_STATUSES = ['nueva', 'descartada', 'promovida'] as const;

const SELECT = `
  SELECT w.id, w.title, w.status, w.notes, w.tags, w.created_at, w.updated_at,
         i.source, i.source_id, i.promoted_to
  FROM work_items w JOIN idea_details i ON i.work_item_id = w.id
  WHERE w.type = 'idea' AND w.archived_at IS NULL`;

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (r: Row): Record<string, any> => ({ ...r, tags: JSON.parse(r.tags as string) });

const Tags = z.array(z.string().trim().min(1).max(50)).max(30);
const Text = z.string().trim().min(1).max(5000);

/** Título = primera línea no vacía, recortada. */
export const titleFrom = (text: string): string => {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? text;
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
};

/** `ai` presente = la cola de IA está habilitada: cada idea nueva pide sus etiquetas (borrador). */
export function registerIdeas(app: FastifyInstance, db: Db, inboxSecret: string, ai?: { now: () => number }) {
  const getIdea = (id: string) => {
    const r = db.prepare(`${SELECT} AND w.id = ?`).get(id) as Row | undefined;
    return r ? parse(r) : undefined;
  };

  function createIdea(text: string, source: string, sourceId: string | null, tags: string[] = []) {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`INSERT INTO work_items (id, type, title, status, notes, tags, created_at, updated_at)
                  VALUES (?, 'idea', ?, 'nueva', ?, ?, ?, ?)`)
        .run(id, titleFrom(text), text, JSON.stringify(tags), now, now);
      db.prepare('INSERT INTO idea_details (work_item_id, source, source_id) VALUES (?, ?, ?)')
        .run(id, source, sourceId);
    })();
    // Etiquetado automático: mejor esfuerzo. Que la IA esté caída, pausada o llena NUNCA impide guardar la idea.
    if (ai && getState(db).auto_tag) {
      try { enqueue(db, { task: 'tag_idea', input: { idea_id: id } }, ai.now()); } catch { /* cola llena u otro problema: se ignora */ }
    }
    return id;
  }

  // Webhook de entrada (n8n → FactoryOS). Autenticado con secreto compartido, no con cookie.
  app.post('/webhooks/inbox', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const secret = req.headers['x-webhook-secret'];
    if (typeof secret !== 'string' || !passwordMatches(secret, inboxSecret)) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
    const body = z.object({
      text: Text,
      source: z.enum(['telegram', 'api']).default('telegram'),
      source_id: z.string().max(100).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: 'invalid' });
    const { text, source, source_id } = body.data;

    if (source_id) {
      const dup = db.prepare('SELECT work_item_id AS id FROM idea_details WHERE source = ? AND source_id = ?')
        .get(source, source_id) as { id: string } | undefined;
      if (dup) return { ok: true, id: dup.id, duplicate: true };
    }
    const id = createIdea(text, source, source_id ?? null);
    return reply.code(201).send({ ok: true, id, title: getIdea(id)!.title });
  });

  app.get('/ideas', async () => {
    const rows = (db.prepare(`${SELECT} ORDER BY w.created_at DESC`).all() as Row[]).map(parse);
    const sug = tagSuggestions(db, rows.filter((r) => r.status === 'nueva').map((r) => r.id as string));
    return { ideas: rows.map((r) => ({ ...r, suggestion: sug.get(r.id as string) ?? null })) };
  });

  app.post('/ideas', async (req, reply) => {
    const body = z.object({ text: Text, tags: Tags.default([]) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid' });
    return reply.code(201).send(getIdea(createIdea(body.data.text, 'web', null, body.data.tags)));
  });

  app.patch('/ideas/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const cur = getIdea(id);
    if (!cur) return reply.code(404).send({ error: 'not_found' });
    const body = z.object({
      title: z.string().trim().min(1).max(300),
      notes: z.string().max(10000),
      tags: Tags,
      status: z.enum(['nueva', 'descartada']),
    }).partial().strict().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid' });
    if (cur.status === 'promovida') return reply.code(409).send({ error: 'already_promoted' });
    const d = body.data;
    db.prepare('UPDATE work_items SET title = ?, notes = ?, tags = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(d.title ?? cur.title, d.notes ?? cur.notes, JSON.stringify(d.tags ?? cur.tags),
        d.status ?? cur.status, new Date().toISOString(), id);
    return getIdea(id);
  });

  // Pasa la idea al pipeline como contenido en estado «idea». No publica nada.
  app.post('/ideas/:id/promote', async (req, reply) => {
    const { id } = req.params as { id: string };
    const cur = getIdea(id);
    if (!cur) return reply.code(404).send({ error: 'not_found' });
    if (cur.status !== 'nueva') return reply.code(409).send({ error: 'not_new' });
    const body = z.object({
      platform: z.enum(PLATFORMS).nullable().optional(),
      format: z.enum(FORMATS).nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'invalid' });
    let contentId = '';
    db.transaction(() => {
      contentId = insertContent(db, {
        title: cur.title as string, status: 'idea', notes: cur.notes as string,
        tags: cur.tags as string[], platform: body.data.platform ?? null, format: body.data.format ?? null,
      });
      db.prepare("UPDATE work_items SET status = 'promovida', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), id);
      db.prepare('UPDATE idea_details SET promoted_to = ? WHERE work_item_id = ?').run(contentId, id);
    })();
    return { idea: getIdea(id), content_id: contentId };
  });
}
