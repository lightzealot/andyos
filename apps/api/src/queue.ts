import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import type { Notify } from './notify.js';
import { feedbackFor, needsRetry } from './lint.js';
import { TASKS, TaskError } from './tasks.js';
import { getVoice } from './voice.js';

export const LEASE_S = 180;        // tiempo que un trabajo reclamado se reserva al worker
export const JOB_TIMEOUT_S = 120;  // tiempo máximo que se le pide al worker por trabajo
export const MAX_QUEUED = 50;      // tope de trabajos en cola (evita bucles desbocados)
const BACKOFF_S = [60, 300, 1200];

export const ERROR_CLASSES = ['quota', 'billing', 'auth', 'transient', 'permanent'] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

const iso = (ms: number) => new Date(ms).toISOString();

export class QueueError extends Error {
  constructor(public code: 'queue_full' | 'unknown_task' | 'not_found' | 'conflict' | 'invalid') { super(code); }
}

/* ---------- estado y ajustes ---------- */
export interface QueueState {
  paused: boolean; paused_reason: string | null; paused_until: string | null; auto_tag: boolean;
  max_per_day: number; max_per_week: number; concurrency: number;
  five_hour_pause_at: number; seven_day_pause_at: number;
  usage_snapshot: UsageSnapshot | null; usage_snapshot_at: string | null;
}
export interface UsageSnapshot {
  five_hour?: { utilization: number; resetsAt: number };
  seven_day?: { utilization: number; resetsAt: number };
}

export function getState(db: Db): QueueState {
  const r = db.prepare('SELECT * FROM queue_state WHERE id = 1').get() as Record<string, unknown>;
  return {
    paused: Boolean(r.paused), paused_reason: r.paused_reason as string | null, paused_until: r.paused_until as string | null,
    auto_tag: Boolean(r.auto_tag),
    max_per_day: r.max_per_day as number, max_per_week: r.max_per_week as number, concurrency: r.concurrency as number,
    five_hour_pause_at: r.five_hour_pause_at as number, seven_day_pause_at: r.seven_day_pause_at as number,
    usage_snapshot: r.usage_snapshot ? JSON.parse(r.usage_snapshot as string) : null,
    usage_snapshot_at: r.usage_snapshot_at as string | null,
  };
}

export function counters(db: Db, now: number) {
  const n = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { c: number }).c;
  return {
    day: n('SELECT COUNT(*) c FROM ai_jobs WHERE started_at >= ?', iso(now - 86_400_000)),
    week: n('SELECT COUNT(*) c FROM ai_jobs WHERE started_at >= ?', iso(now - 7 * 86_400_000)),
    queued: n("SELECT COUNT(*) c FROM ai_jobs WHERE status = 'queued'"),
    running: n("SELECT COUNT(*) c FROM ai_jobs WHERE status = 'running'"),
  };
}

export interface Settings {
  paused?: boolean; auto_tag?: boolean; max_per_day?: number; max_per_week?: number; concurrency?: number;
  five_hour_pause_at?: number; seven_day_pause_at?: number;
}
export function updateSettings(db: Db, patch: Settings, now: number): QueueState {
  const cur = getState(db);
  const next = { ...cur, ...patch };
  const inRange = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;
  if (!inRange(next.max_per_day, 1, 500) || !inRange(next.max_per_week, 1, 2000) || !Number.isInteger(next.concurrency)
    || !inRange(next.concurrency, 1, 2) || !inRange(next.five_hour_pause_at, 0.1, 1) || !inRange(next.seven_day_pause_at, 0.1, 1)) {
    throw new QueueError('invalid');
  }
  // pausa/reanudación manual
  const paused = patch.paused ?? cur.paused;
  const reason = patch.paused === true && !cur.paused ? 'manual' : patch.paused === false ? null : cur.paused_reason;
  const until = patch.paused === undefined ? cur.paused_until : null;
  db.prepare(`UPDATE queue_state SET paused = ?, paused_reason = ?, paused_until = ?, max_per_day = ?, max_per_week = ?,
              concurrency = ?, five_hour_pause_at = ?, seven_day_pause_at = ?, updated_at = ?, auto_tag = ? WHERE id = 1`)
    .run(paused ? 1 : 0, paused ? reason : null, paused ? until : null, next.max_per_day, next.max_per_week,
      next.concurrency, next.five_hour_pause_at, next.seven_day_pause_at, iso(now), next.auto_tag ? 1 : 0);
  return getState(db);
}

function pause(db: Db, reason: string, untilMs: number | null, now: number, notify: Notify, message: string) {
  const st = getState(db);
  if (st.paused) return; // ya pausada: no repetir avisos
  const until = untilMs ? iso(untilMs) : null;
  db.prepare('UPDATE queue_state SET paused = 1, paused_reason = ?, paused_until = ?, updated_at = ? WHERE id = 1')
    .run(reason, until, iso(now));
  notify({ type: 'queue_paused', message, until });
}

function autoResume(db: Db, now: number) {
  const st = getState(db);
  if (st.paused && st.paused_until && st.paused_until <= iso(now)) {
    db.prepare('UPDATE queue_state SET paused = 0, paused_reason = NULL, paused_until = NULL, updated_at = ? WHERE id = 1').run(iso(now));
  }
}

/** Devuelve la ventana que supera su umbral (ignorando datos ya vencidos), si la hay. */
function usageBreach(st: QueueState, now: number): { window: string; untilMs: number; pct: number } | null {
  const snap = st.usage_snapshot;
  if (!snap) return null;
  for (const [key, thr] of [['five_hour', st.five_hour_pause_at], ['seven_day', st.seven_day_pause_at]] as const) {
    const w = snap[key];
    if (w && typeof w.utilization === 'number' && w.resetsAt * 1000 > now && w.utilization >= thr) {
      return { window: key, untilMs: w.resetsAt * 1000, pct: Math.round(w.utilization * 100) };
    }
  }
  return null;
}

export function recordUsage(db: Db, snap: UsageSnapshot, now: number, notify: Notify) {
  db.prepare('UPDATE queue_state SET usage_snapshot = ?, usage_snapshot_at = ?, updated_at = ? WHERE id = 1')
    .run(JSON.stringify(snap), iso(now), iso(now));
  const b = usageBreach(getState(db), now);
  if (b) {
    const label = b.window === 'five_hour' ? 'de 5 horas' : 'semanal';
    pause(db, `usage_${b.window}`, b.untilMs, now, notify,
      `Cola de IA pausada: tu cuota ${label} de Claude va al ${b.pct} %. Se reanuda sola al reiniciarse la ventana.`);
  }
}

/* ---------- trabajos ---------- */
type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Job = Record<string, any>;
const parseJob = (r: Row): Job => ({
  ...r,
  input: JSON.parse(r.input as string),
  output: r.output ? JSON.parse(r.output as string) : null,
  usage: r.usage ? JSON.parse(r.usage as string) : null,
  review: r.review ? JSON.parse(r.review as string) : null,
});
export const getJob = (db: Db, id: string) => {
  const r = db.prepare('SELECT * FROM ai_jobs WHERE id = ?').get(id) as Row | undefined;
  return r ? parseJob(r) : undefined;
};
export function listJobs(db: Db, f: { status?: string; target_id?: string; task?: string[] }, limit: number) {
  const where: string[] = []; const args: unknown[] = [];
  if (f.status) { where.push('status = ?'); args.push(f.status); }
  if (f.target_id) { where.push('target_id = ?'); args.push(f.target_id); }
  if (f.task?.length) { where.push(`task IN (${f.task.map(() => '?').join(',')})`); args.push(...f.task); }
  const sql = `SELECT * FROM ai_jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`;
  return (db.prepare(sql).all(...args, limit) as Row[]).map(parseJob);
}

export function enqueue(db: Db, p: { task: string; input: unknown; provider?: 'claude' | 'codex' }, now: number) {
  const def = TASKS[p.task];
  if (!def) throw new QueueError('unknown_task');
  const prepared = def.prepare(db, p.input); // puede lanzar TaskError
  const c = counters(db, now);
  if (c.queued + c.running >= MAX_QUEUED) throw new QueueError('queue_full');
  if (prepared.target_id) {
    const dup = db.prepare("SELECT id FROM ai_jobs WHERE task = ? AND target_id = ? AND status IN ('queued','running')")
      .get(p.task, prepared.target_id) as { id: string } | undefined;
    if (dup) return { job: getJob(db, dup.id)!, duplicate: true };
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO ai_jobs (id, task, input, target_id, status, requested_provider, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`)
    .run(id, p.task, JSON.stringify(prepared.input), prepared.target_id, p.provider ?? 'claude', iso(now), iso(now));
  return { job: getJob(db, id)!, duplicate: false };
}

export function cancel(db: Db, id: string, now: number) {
  const r = db.prepare("UPDATE ai_jobs SET status = 'canceled', updated_at = ?, finished_at = ? WHERE id = ? AND status = 'queued'")
    .run(iso(now), iso(now), id);
  if (!r.changes) throw new QueueError(getJob(db, id) ? 'conflict' : 'not_found');
}

export function accept(db: Db, id: string, now: number, selection?: unknown) {
  const job = getJob(db, id);
  if (!job) throw new QueueError('not_found');
  if (job.status !== 'done' || job.accepted_at || job.dismissed_at) throw new QueueError('conflict');
  const def = TASKS[job.task as string];
  let output = job.output;
  if (selection !== undefined) {
    if (!def?.select) throw new QueueError('invalid');
    try { output = def.select(job.output, selection); } catch (e) { throw e instanceof TaskError ? new QueueError('invalid') : e; }
  }
  db.transaction(() => {
    def?.apply(db, job.input as Record<string, unknown>, output, iso(now));
    db.prepare('UPDATE ai_jobs SET accepted_at = ?, updated_at = ? WHERE id = ?').run(iso(now), iso(now), id);
  })();
}

/** Descartar un borrador: el humano dice "no". No tiene efecto sobre los datos. */
export function dismiss(db: Db, id: string, now: number) {
  const r = db.prepare("UPDATE ai_jobs SET dismissed_at = ?, updated_at = ? WHERE id = ? AND status = 'done' AND accepted_at IS NULL AND dismissed_at IS NULL")
    .run(iso(now), iso(now), id);
  if (!r.changes) throw new QueueError(getJob(db, id) ? 'conflict' : 'not_found');
}

export interface Suggestion { job_id: string; status: 'queued' | 'running' | 'done' | 'failed'; tags?: string[]; error_class?: string }

/** Última sugerencia de etiquetas por idea; solo devuelve lo accionable (pendiente, listo sin decidir, o fallido). */
export function tagSuggestions(db: Db, ideaIds: string[]): Map<string, Suggestion> {
  const out = new Map<string, Suggestion>();
  if (!ideaIds.length) return out;
  const rows = db.prepare(`SELECT * FROM ai_jobs WHERE task = 'tag_idea' AND target_id IN (${ideaIds.map(() => '?').join(',')})
                           ORDER BY created_at DESC`).all(...ideaIds) as Row[];
  const seen = new Set<string>();
  for (const r of rows) {
    const t = r.target_id as string;
    if (seen.has(t)) continue; // solo el más reciente
    seen.add(t);
    const status = r.status as string;
    if (status === 'queued' || status === 'running') out.set(t, { job_id: r.id as string, status });
    else if (status === 'done' && !r.accepted_at && !r.dismissed_at) {
      out.set(t, { job_id: r.id as string, status: 'done', tags: (JSON.parse(r.output as string) as { tags: string[] }).tags });
    } else if (status === 'failed') out.set(t, { job_id: r.id as string, status: 'failed', error_class: r.error_class as string });
  }
  return out;
}

/* ---------- lado del worker ---------- */
function reclaimExpired(db: Db, now: number) {
  const rows = db.prepare("SELECT id, attempts, max_attempts FROM ai_jobs WHERE status = 'running' AND lease_until < ?")
    .all(iso(now)) as { id: string; attempts: number; max_attempts: number }[];
  for (const r of rows) {
    if (r.attempts >= r.max_attempts) {
      db.prepare("UPDATE ai_jobs SET status = 'failed', error_class = 'transient', error = 'lease_expired', lease_until = NULL, finished_at = ?, updated_at = ? WHERE id = ?")
        .run(iso(now), iso(now), r.id);
    } else {
      const wait = BACKOFF_S[Math.min(r.attempts - 1, BACKOFF_S.length - 1)] * 1000;
      db.prepare("UPDATE ai_jobs SET status = 'queued', lease_until = NULL, not_before = ?, updated_at = ? WHERE id = ?")
        .run(iso(now + wait), iso(now), r.id);
    }
  }
}

export type ClaimResult =
  | { job: null; reason: 'paused' | 'usage_high' | 'limit_day' | 'limit_week' | 'concurrency' | 'empty'; until?: string | null }
  | { job: { id: string; task: string; provider: string; system: string; prompt: string; json_schema: unknown; attempt: number; timeout_s: number } };

export function claim(db: Db, providers: string[], now: number, notify: Notify): ClaimResult {
  return db.transaction((): ClaimResult => {
    autoResume(db, now);
    reclaimExpired(db, now);
    let st = getState(db);
    if (st.paused) return { job: null, reason: 'paused', until: st.paused_until };

    const b = usageBreach(st, now);
    if (b) {
      recordUsage(db, st.usage_snapshot!, now, notify); // pausa y avisa
      st = getState(db);
      return { job: null, reason: 'usage_high', until: st.paused_until };
    }
    const c = counters(db, now);
    if (c.day >= st.max_per_day) return { job: null, reason: 'limit_day' };
    if (c.week >= st.max_per_week) return { job: null, reason: 'limit_week' };
    const running = (db.prepare("SELECT COUNT(*) c FROM ai_jobs WHERE status = 'running' AND lease_until >= ?").get(iso(now)) as { c: number }).c;
    if (running >= st.concurrency) return { job: null, reason: 'concurrency' };
    if (!providers.length) return { job: null, reason: 'empty' };

    const ph = providers.map(() => '?').join(',');
    const row = db.prepare(`SELECT * FROM ai_jobs WHERE status = 'queued' AND requested_provider IN (${ph})
                            AND (not_before IS NULL OR not_before <= ?) ORDER BY created_at LIMIT 1`)
      .get(...providers, iso(now)) as Row | undefined;
    if (!row) return { job: null, reason: 'empty' };

    db.prepare(`UPDATE ai_jobs SET status = 'running', attempts = attempts + 1, lease_until = ?, provider = requested_provider,
                started_at = COALESCE(started_at, ?), not_before = NULL, updated_at = ? WHERE id = ?`)
      .run(iso(now + LEASE_S * 1000), iso(now), iso(now), row.id);
    const def = TASKS[row.task as string];
    const built = def.build(JSON.parse(row.input as string), getVoice(db));
    return {
      job: {
        id: row.id as string, task: row.task as string, provider: row.requested_provider as string,
        system: built.system, prompt: built.prompt, json_schema: def.outputSchema,
        attempt: (row.attempts as number) + 1, timeout_s: JOB_TIMEOUT_S,
      },
    };
  })();
}

function requireRunning(db: Db, id: string) {
  const job = getJob(db, id);
  if (!job) throw new QueueError('not_found');
  if (job.status !== 'running') throw new QueueError('conflict');
  return job;
}

export interface JobResult {
  output: unknown; provider: string; model?: string; usage?: unknown; usage_snapshot?: UsageSnapshot;
}
export function complete(db: Db, id: string, res: JobResult, now: number, notify: Notify) {
  const job = requireRunning(db, id);
  const def = TASKS[job.task as string];
  if (!def.validateOutput(res.output)) {
    // Salida que no cumple el esquema: fallo permanente (no se reintenta a ciegas)
    return fail(db, id, { error_class: 'permanent', error: 'La salida no cumple el esquema esperado' }, now, notify);
  }
  // Revisión de estilo/datos: si el borrador es defectuoso se pide UNA segunda pasada con la lista de defectos.
  const issues = def.review?.(res.output, job.input, getVoice(db)) ?? [];
  const revised = Boolean(job.input.__revised);
  if (issues.length && !revised && needsRetry(issues) && (job.attempts as number) < (job.max_attempts as number)) {
    const input = { ...job.input, __revised: true, feedback: feedbackFor(issues), prev: res.output };
    db.prepare("UPDATE ai_jobs SET status = 'queued', input = ?, lease_until = NULL, not_before = NULL, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(input), iso(now), id);
    if (res.usage_snapshot) recordUsage(db, res.usage_snapshot, now, notify);
    return;
  }
  db.prepare(`UPDATE ai_jobs SET status = 'done', output = ?, provider = ?, model = ?, usage = ?, review = ?, lease_until = NULL,
              error_class = NULL, error = NULL, finished_at = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(res.output), res.provider, res.model ?? null, res.usage ? JSON.stringify(res.usage) : null,
      JSON.stringify({ issues, revised }), iso(now), iso(now), id);
  if (res.usage_snapshot) recordUsage(db, res.usage_snapshot, now, notify);
}

export interface JobFailure { error_class: ErrorClass; error: string; reset_at?: number | string }
export function fail(db: Db, id: string, f: JobFailure, now: number, notify: Notify) {
  const job = requireRunning(db, id);
  const attempts = job.attempts as number;
  const text = f.error.slice(0, 500);
  const finish = (status: 'failed' | 'queued', notBefore: number | null, undoAttempt = false) => {
    db.prepare(`UPDATE ai_jobs SET status = ?, attempts = ?, not_before = ?, lease_until = NULL, error_class = ?, error = ?,
                finished_at = ?, updated_at = ? WHERE id = ?`)
      .run(status, undoAttempt ? attempts - 1 : attempts, notBefore ? iso(notBefore) : null, f.error_class, text,
        status === 'failed' ? iso(now) : null, iso(now), id);
  };
  switch (f.error_class) {
    case 'permanent':
      return finish('failed', null);
    case 'transient':
      return attempts >= (job.max_attempts as number)
        ? finish('failed', null)
        : finish('queued', now + BACKOFF_S[Math.min(attempts - 1, BACKOFF_S.length - 1)] * 1000);
    case 'quota': {
      finish('queued', null, true); // el trabajo no se pierde ni gasta un intento
      const resetMs = typeof f.reset_at === 'number' ? f.reset_at * 1000 : f.reset_at ? Date.parse(f.reset_at) : NaN;
      const until = Number.isFinite(resetMs) && resetMs > now ? resetMs : now + 3_600_000;
      return pause(db, 'quota', until, now, notify, `Cola de IA pausada: se agotó la cuota de Claude (${text.slice(0, 120)}). Se reanuda sola al reiniciarse.`);
    }
    case 'billing':
    case 'auth':
      finish('queued', null, true);
      return pause(db, f.error_class, null, now, notify,
        `Cola de IA pausada (${f.error_class}): ${text.slice(0, 160)}. Requiere tu acción; reanúdala desde el panel al resolverlo.`);
  }
}
