import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';
import { passwordMatches } from './auth.js';
import type { Notify } from './notify.js';
import {
  accept, cancel, dismiss, claim, complete, counters, enqueue, ERROR_CLASSES, fail, getJob, getState, listJobs,
  QueueError, recordUsage, updateSettings,
} from './queue.js';
import { TASKS, TaskError } from './tasks.js';

const Window = z.object({ utilization: z.number().min(0).max(1), resetsAt: z.number() });
const Snapshot = z.object({ five_hour: Window.optional(), seven_day: Window.optional() }).strict();

/**
 * Cola de IA. Rutas de usuario (sesión) y del worker (Bearer WORKER_TOKEN).
 * El worker es un cliente de solo salida: pregunta por trabajos y devuelve resultados.
 */
export function registerAi(app: FastifyInstance, db: Db, opts: { workerToken: string; notify: Notify; now: () => number }) {
  const { notify, now } = opts;

  const send = (reply: import('fastify').FastifyReply, err: unknown) => {
    if (err instanceof QueueError) {
      const status = { queue_full: 429, unknown_task: 400, not_found: 404, conflict: 409, invalid: 400 }[err.code];
      return reply.code(status).send({ error: err.code });
    }
    if (err instanceof TaskError) return reply.code(err.code === 'not_found' ? 404 : 400).send({ error: err.code });
    throw err;
  };

  /* ---------- usuario (cookie de sesión, ya exigida por el hook global) ---------- */
  app.get('/ai/queue', async () => ({
    state: getState(db), counters: counters(db, now()), tasks: Object.keys(TASKS),
  }));

  app.patch('/ai/queue', async (req, reply) => {
    const b = z.object({
      paused: z.boolean(), auto_tag: z.boolean(), max_per_day: z.number(), max_per_week: z.number(), concurrency: z.number(),
      five_hour_pause_at: z.number(), seven_day_pause_at: z.number(),
    }).partial().strict().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    try { return { state: updateSettings(db, b.data, now()) }; } catch (e) { return send(reply, e); }
  });

  app.post('/ai/jobs', async (req, reply) => {
    const b = z.object({ task: z.string().max(50), input: z.unknown(), provider: z.enum(['claude', 'codex']).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    try {
      const r = enqueue(db, { task: b.data.task, input: b.data.input, provider: b.data.provider }, now());
      return reply.code(r.duplicate ? 200 : 201).send({ job: r.job, duplicate: r.duplicate });
    } catch (e) { return send(reply, e); }
  });

  app.get('/ai/jobs', async (req, reply) => {
    const q = z.object({
      status: z.enum(['queued', 'running', 'done', 'failed', 'canceled']).optional(),
      target_id: z.string().min(1).max(64).optional(),
      task: z.string().max(200).optional(), // lista separada por comas
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid' });
    const task = q.data.task?.split(',').map((t) => t.trim()).filter((t) => t in TASKS);
    if (q.data.task && !task?.length) return { jobs: [] };
    return { jobs: listJobs(db, { status: q.data.status, target_id: q.data.target_id, task }, q.data.limit) };
  });

  app.get('/ai/jobs/:id', async (req, reply) => {
    const job = getJob(db, (req.params as { id: string }).id);
    return job ?? reply.code(404).send({ error: 'not_found' });
  });

  app.post('/ai/jobs/:id/cancel', async (req, reply) => {
    try { cancel(db, (req.params as { id: string }).id, now()); return { ok: true }; } catch (e) { return send(reply, e); }
  });

  // Aceptación humana explícita: solo aquí el borrador tiene efecto.
  app.post('/ai/jobs/:id/accept', async (req, reply) => {
    try {
      const id = (req.params as { id: string }).id;
      // Cuerpo opcional: aceptar solo una parte del borrador (p. ej. {"tags":["n8n"]})
      accept(db, id, now(), req.body && Object.keys(req.body as object).length ? req.body : undefined);
      return { job: getJob(db, id) };
    } catch (e) { return send(reply, e); }
  });

  // Rechazo humano del borrador: no cambia ningún dato.
  app.post('/ai/jobs/:id/dismiss', async (req, reply) => {
    try { dismiss(db, (req.params as { id: string }).id, now()); return { ok: true }; } catch (e) { return send(reply, e); }
  });

  /* ---------- worker (Bearer) ---------- */
  app.register(async (w) => {
    w.addHook('preHandler', async (req, reply) => {
      const h = req.headers.authorization;
      const tok = typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : '';
      if (!tok || !passwordMatches(tok, opts.workerToken)) return reply.code(401).send({ error: 'unauthorized' });
    });

    w.post('/worker/claim', async (req, reply) => {
      const b = z.object({ providers: z.array(z.enum(['claude', 'codex'])).max(2).default(['claude']) }).safeParse(req.body ?? {});
      if (!b.success) return reply.code(400).send({ error: 'invalid' });
      return claim(db, b.data.providers, now(), notify);
    });

    w.post('/worker/jobs/:id/result', async (req, reply) => {
      const b = z.object({
        output: z.unknown(), provider: z.enum(['claude', 'codex']), model: z.string().max(100).optional(),
        usage: z.record(z.string(), z.unknown()).optional(), usage_snapshot: Snapshot.optional(),
      }).safeParse(req.body);
      if (!b.success) return reply.code(400).send({ error: 'invalid' });
      try {
        const id = (req.params as { id: string }).id;
        complete(db, id, b.data, now(), notify);
        return { ok: true, status: getJob(db, id)?.status };
      } catch (e) { return send(reply, e); }
    });

    w.post('/worker/jobs/:id/failure', async (req, reply) => {
      const b = z.object({
        error_class: z.enum(ERROR_CLASSES), error: z.string().max(2000),
        reset_at: z.union([z.number(), z.string().max(40)]).optional(),
      }).safeParse(req.body);
      if (!b.success) return reply.code(400).send({ error: 'invalid' });
      try {
        const id = (req.params as { id: string }).id;
        fail(db, id, b.data, now(), notify);
        return { ok: true, status: getJob(db, id)?.status };
      } catch (e) { return send(reply, e); }
    });

    w.post('/worker/usage', async (req, reply) => {
      const b = Snapshot.safeParse(req.body);
      if (!b.success) return reply.code(400).send({ error: 'invalid' });
      recordUsage(db, b.data, now(), notify);
      return { ok: true, state: getState(db) };
    });
  });
}
