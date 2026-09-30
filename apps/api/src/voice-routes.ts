import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from './db.js';
import { lintText } from './lint.js';
import { getVoice } from './voice.js';

const MAX_EXAMPLES = 200;

/** Tu voz: guía, hechos verdaderos, frases prohibidas y ejemplos. Se edita desde la web. */
export function registerVoice(app: FastifyInstance, db: Db, now: () => number) {
  const iso = () => new Date(now()).toISOString();

  const profile = () => {
    const v = getVoice(db, 0);
    const examples = db.prepare('SELECT id, kind, text, source, created_at FROM voice_examples ORDER BY created_at DESC').all();
    const updated = (db.prepare('SELECT updated_at FROM voice_profile WHERE id = 1').get() as { updated_at: string }).updated_at;
    return { guide: v.guide, facts: v.facts, banned: v.banned, examples, updated_at: updated };
  };

  app.get('/voice', async () => profile());

  app.put('/voice', async (req, reply) => {
    const b = z.object({
      guide: z.string().trim().min(20).max(6000),
      facts: z.array(z.string().trim().min(1).max(300)).max(60),
      banned: z.array(z.string().trim().min(1).max(80)).max(200),
    }).partial().strict().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    const cur = getVoice(db, 0);
    db.prepare('UPDATE voice_profile SET guide = ?, facts = ?, banned = ?, updated_at = ? WHERE id = 1')
      .run(b.data.guide ?? cur.guide, JSON.stringify(b.data.facts ?? cur.facts), JSON.stringify(b.data.banned ?? cur.banned), iso());
    return profile();
  });

  // "Guardar como ejemplo de mi voz": los textos que editas y apruebas son la fuente real de tu voz.
  app.post('/voice/examples', async (req, reply) => {
    const b = z.object({ kind: z.enum(['hook', 'script', 'caption']), text: z.string().trim().min(3).max(3000) }).strict().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    const n = (db.prepare('SELECT COUNT(*) c FROM voice_examples').get() as { c: number }).c;
    if (n >= MAX_EXAMPLES) return reply.code(409).send({ error: 'too_many_examples' });
    const id = randomUUID();
    db.prepare("INSERT INTO voice_examples (id, kind, text, source, created_at) VALUES (?, ?, ?, 'usuario', ?)").run(id, b.data.kind, b.data.text, iso());
    return reply.code(201).send({ id });
  });

  app.delete('/voice/examples/:id', async (req, reply) => {
    const r = db.prepare('DELETE FROM voice_examples WHERE id = ?').run((req.params as { id: string }).id);
    return r.changes ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  // Comprueba cualquier texto contra el detector (sin coste: no usa IA).
  app.post('/voice/lint', async (req, reply) => {
    const b = z.object({ text: z.string().max(5000), source: z.string().max(5000).optional(), caption: z.boolean().optional() }).strict().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    const v = getVoice(db, 0);
    return { issues: lintText(b.data.text, { banned: v.banned, source: `${b.data.source ?? ''}\n${v.facts.join('\n')}`, noHashtags: b.data.caption }) };
  });
}
