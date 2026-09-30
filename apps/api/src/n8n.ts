import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

export interface N8nConfig {
  baseUrl: string;       // p. ej. https://n8n.andresgomez.store (sin barra final)
  apiKey: string;        // clave de solo lectura: alcances workflow:list y execution:list
  triggerSecret: string; // se envía como X-Webhook-Secret a los webhooks disparables
}

export const TRIGGER_TAG = 'andyos-trigger';
const CACHE_MS = 10_000;
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9_\-/]{0,100}$/;

interface N8nNode { type?: string; parameters?: Record<string, unknown> }
interface N8nWorkflow {
  id: string; name: string; active: boolean; isArchived?: boolean; updatedAt?: string;
  tags?: { name: string }[]; nodes?: N8nNode[];
}
interface N8nExecution {
  id: string | number; workflowId: string; status: string; mode?: string;
  startedAt?: string | null; stoppedAt?: string | null;
}

/** Ruta del webhook si el workflow es disparable desde FactoryOS; si no, null. */
export function triggerPath(w: N8nWorkflow): string | null {
  if (!w.active || w.isArchived) return null;
  if (!w.tags?.some((t) => t.name === TRIGGER_TAG)) return null;
  const node = w.nodes?.find((n) => n.type === 'n8n-nodes-base.webhook'
    && n.parameters?.httpMethod === 'POST' && n.parameters?.authentication === 'headerAuth');
  const path = node?.parameters?.path;
  return typeof path === 'string' && SAFE_PATH.test(path) ? path : null;
}

export function registerN8n(app: FastifyInstance, cfg: N8nConfig | null) {
  const cache = new Map<string, { at: number; value: unknown }>();

  async function api<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const key = path + JSON.stringify(query);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
    const url = new URL(`${cfg!.baseUrl}/api/v1${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { 'X-N8N-API-KEY': cfg!.apiKey }, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`n8n ${res.status}`);
    const value = (await res.json()) as T;
    cache.set(key, { at: Date.now(), value });
    return value;
  }

  const workflows = async () =>
    (await api<{ data: N8nWorkflow[] }>('/workflows', { limit: '250', excludePinnedData: 'true' })).data
      .filter((w) => !w.isArchived);

  const fail = (reply: FastifyReply, err: unknown) => {
    app.log.error(err);
    return reply.code(502).send({ error: 'n8n_unavailable' });
  };
  const notConfigured = (reply: FastifyReply) => reply.code(503).send({ error: 'n8n_not_configured' });

  app.get('/n8n/status', async () => ({ configured: cfg !== null }));

  app.get('/n8n/workflows', async (_req, reply) => {
    if (!cfg) return notConfigured(reply);
    try {
      const [wfs, execs] = await Promise.all([
        workflows(),
        api<{ data: N8nExecution[] }>('/executions', { limit: '100' }),
      ]);
      const byWf = new Map<string, N8nExecution[]>();
      for (const e of execs.data) byWf.set(e.workflowId, [...(byWf.get(e.workflowId) ?? []), e]);
      const time = (e: N8nExecution) => Date.parse(e.startedAt ?? '') || 0;
      return {
        workflows: wfs.map((w) => {
          const list = (byWf.get(w.id) ?? []).sort((a, b) => time(b) - time(a));
          const last = list[0];
          return {
            id: w.id, name: w.name, active: w.active, updated_at: w.updatedAt ?? null,
            tags: (w.tags ?? []).map((t) => t.name),
            last: last ? { status: last.status, started_at: last.startedAt ?? null, stopped_at: last.stoppedAt ?? null } : null,
            recent_errors: list.filter((e) => e.status === 'error' || e.status === 'crashed').length,
            triggerable: triggerPath(w) !== null,
          };
        }),
      };
    } catch (e) { return fail(reply, e); }
  });

  app.get('/n8n/executions', async (req, reply) => {
    if (!cfg) return notConfigured(reply);
    const q = z.object({
      status: z.enum(['canceled', 'crashed', 'error', 'new', 'running', 'success', 'waiting']).optional(),
      workflowId: z.string().regex(/^[\w-]{1,64}$/).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid' });
    try {
      const query: Record<string, string> = { limit: String(q.data.limit) }; // sin includeData: nunca se piden datos
      if (q.data.status) query.status = q.data.status;
      if (q.data.workflowId) query.workflowId = q.data.workflowId;
      const [execs, wfs] = await Promise.all([api<{ data: N8nExecution[] }>('/executions', query), workflows()]);
      const names = new Map(wfs.map((w) => [w.id, w.name]));
      return {
        executions: execs.data.map((e) => ({
          id: String(e.id), workflow_id: e.workflowId, workflow_name: names.get(e.workflowId) ?? e.workflowId,
          status: e.status, mode: e.mode ?? null, started_at: e.startedAt ?? null, stopped_at: e.stoppedAt ?? null,
        })),
      };
    } catch (e) { return fail(reply, e); }
  });

  // Dispara un workflow por su webhook. Solo los marcados con la etiqueta y con Header Auth.
  app.post('/n8n/workflows/:id/trigger', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!cfg) return notConfigured(reply);
    const { id } = req.params as { id: string };
    const body = z.object({ payload: z.record(z.string(), z.unknown()).default({}) }).safeParse(req.body ?? {});
    if (!body.success || JSON.stringify(body.data.payload).length > 10_000) return reply.code(400).send({ error: 'invalid' });
    try {
      const wf = (await workflows()).find((w) => w.id === id);
      const path = wf ? triggerPath(wf) : null;
      if (!wf || !path) return reply.code(404).send({ error: 'not_triggerable' });
      const res = await fetch(`${cfg.baseUrl}/webhook/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-secret': cfg.triggerSecret },
        body: JSON.stringify({ source: 'andyos', payload: body.data.payload }),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      cache.clear(); // que la siguiente lista muestre la ejecución nueva
      if (res.status === 401 || res.status === 403) return reply.code(502).send({ error: 'webhook_rejected' });
      if (!res.ok) return reply.code(502).send({ error: 'webhook_failed', status: res.status });
      return { ok: true, status: res.status };
    } catch (e) { return fail(reply, e); }
  });
}
