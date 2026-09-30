import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from './db.js';
import { insertContent } from './content.js';
import { FORMATS, PLATFORMS } from './model.js';

const SELECT = `
  SELECT w.id, w.title, w.notes, w.tags, w.created_at, w.updated_at,
         r.url, r.creator, r.platform, r.format, r.why_it_works, r.hook_pattern,
         (SELECT COUNT(*) FROM item_links l JOIN work_items c ON c.id = l.from_id
           WHERE l.to_id = w.id AND l.kind = 'inspired_by' AND c.archived_at IS NULL) AS derived_count
  FROM work_items w JOIN reference_details r ON r.work_item_id = w.id
  WHERE w.type = 'reference' AND w.archived_at IS NULL`;

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (r: Row): Record<string, any> => ({ ...r, tags: JSON.parse(r.tags as string) });

// Solo http(s): evita esquemas como javascript: al renderizar el enlace.
const Url = z.string().trim().max(2000).url().refine((u) => /^https?:\/\//i.test(u), 'solo http(s)');

const Fields = {
  title: z.string().trim().min(1).max(300),
  url: Url.nullable(),
  creator: z.string().trim().max(200),
  platform: z.enum(PLATFORMS).nullable(),
  format: z.enum(FORMATS).nullable(),
  why_it_works: z.string().max(5000),
  hook_pattern: z.string().max(1000),
  notes: z.string().max(10000),
  tags: z.array(z.string().trim().min(1).max(50)).max(30),
};

const Create = z.object(Fields).partial().required({ title: true }).strict();
const Patch = z.object(Fields).partial().strict();

export function registerReferences(app: FastifyInstance, db: Db) {
  const getRef = (id: string) => {
    const r = db.prepare(`${SELECT} AND w.id = ?`).get(id) as Row | undefined;
    return r ? parse(r) : undefined;
  };

  // Con ?content_id=X cada referencia trae `linked`: ya la enlazaste a ese contenido con «Crear contenido inspirado».
  app.get('/references', async (req) => {
    const { content_id } = z.object({ content_id: z.string().min(1).max(64).optional() }).parse(req.query);
    const rows = db.prepare(`${SELECT} ORDER BY w.updated_at DESC`).all() as Row[];
    if (!content_id) return { references: rows.map(parse) };
    const linked = new Set((db.prepare("SELECT to_id FROM item_links WHERE from_id = ? AND kind = 'inspired_by'").all(content_id) as { to_id: string }[]).map((r) => r.to_id));
    return { references: rows.map((r) => ({ ...parse(r), linked: linked.has(r.id as string) })) };
  });

  app.post('/references', async (req, reply) => {
    const body = Create.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid', details: body.error.flatten() });
    const d = body.data;
    const id = randomUUID();
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`INSERT INTO work_items (id, type, title, status, notes, tags, created_at, updated_at)
                  VALUES (?, 'reference', ?, 'guardada', ?, ?, ?, ?)`)
        .run(id, d.title, d.notes ?? '', JSON.stringify(d.tags ?? []), now, now);
      db.prepare(`INSERT INTO reference_details (work_item_id, url, creator, platform, format, why_it_works, hook_pattern)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, d.url ?? null, d.creator ?? '', d.platform ?? null, d.format ?? null,
          d.why_it_works ?? '', d.hook_pattern ?? '');
    })();
    return reply.code(201).send(getRef(id));
  });

  app.patch('/references/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const cur = getRef(id);
    if (!cur) return reply.code(404).send({ error: 'not_found' });
    const body = Patch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid', details: body.error.flatten() });
    const d = { ...cur, ...body.data };
    db.transaction(() => {
      db.prepare('UPDATE work_items SET title = ?, notes = ?, tags = ?, updated_at = ? WHERE id = ?')
        .run(d.title, d.notes, JSON.stringify(d.tags), new Date().toISOString(), id);
      db.prepare(`UPDATE reference_details SET url = ?, creator = ?, platform = ?, format = ?,
                  why_it_works = ?, hook_pattern = ? WHERE work_item_id = ?`)
        .run(d.url, d.creator, d.platform, d.format, d.why_it_works, d.hook_pattern, id);
    })();
    return getRef(id);
  });

  // Crea contenido en estado «idea» inspirado en la referencia y los enlaza. No publica nada.
  app.post('/references/:id/derive', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ref = getRef(id);
    if (!ref) return reply.code(404).send({ error: 'not_found' });
    const contentId = db.transaction(() => {
      const cid = insertContent(db, {
        title: `Basado en: ${ref.title}`.slice(0, 300), status: 'idea', notes: '',
        tags: ref.tags, platform: ref.platform, format: ref.format,
      });
      db.prepare("INSERT INTO item_links (from_id, to_id, kind) VALUES (?, ?, 'inspired_by')").run(cid, id);
      return cid;
    })();
    return { content_id: contentId, reference: getRef(id) };
  });
}
