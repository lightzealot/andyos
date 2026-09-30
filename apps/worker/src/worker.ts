import { mkdir } from 'node:fs/promises';
import { ApiClient, type ClaimResponse } from './api.js';
import { runClaude } from './adapters/claude.js';
import { runCodex } from './adapters/codex.js';
import type { Config } from './config.js';
import { log } from './log.js';
import { runCommand } from './proc.js';
import type { ClaimedJob, Outcome } from './types.js';

export type Step =
  | { kind: 'job'; jobId: string; task: string; ok: boolean; error_class?: string; ms: number }
  | { kind: 'wait'; reason: string; seconds: number };

/** Verificaciones de arranque: sesión de suscripción (no API key) de cada CLI habilitado. */
export async function healthCheck(cfg: Config): Promise<void> {
  await mkdir(cfg.workDir, { recursive: true, mode: 0o700 });
  const a = await runCommand(cfg.claudeBin, ['auth', 'status', '--json'], { cwd: cfg.workDir, timeoutMs: 20_000 });
  let st: { loggedIn?: boolean; authMethod?: string } = {};
  try { st = JSON.parse(a.stdout); } catch { /* se trata abajo */ }
  if (!st.loggedIn) throw new Error('claude no tiene sesión iniciada (ejecuta `claude auth login`)');
  if (st.authMethod !== 'claude.ai') throw new Error(`claude usa "${st.authMethod}", se esperaba la suscripción (claude.ai)`);
  if (cfg.enableCodex) {
    const c = await runCommand(cfg.codexBin, ['login', 'status'], { cwd: cfg.workDir, timeoutMs: 20_000 });
    if (c.code !== 0 || !/ChatGPT/i.test(c.stdout + c.stderr)) throw new Error('codex no tiene sesión de ChatGPT (ejecuta `codex login`)');
  }
}

const providersOf = (cfg: Config) => (cfg.enableCodex ? ['claude', 'codex'] : ['claude']);

function waitFor(r: Extract<ClaimResponse, { job: null }>, cfg: Config, now: number): number {
  switch (r.reason) {
    case 'paused': case 'usage_high': {
      const until = r.until ? Date.parse(r.until) - now : NaN;
      return Number.isFinite(until) ? Math.min(Math.max(until / 1000, 15), 300) : 60;
    }
    case 'limit_day': case 'limit_week': return 300;
    case 'concurrency': return 10;
    default: return cfg.pollMs / 1000;
  }
}

/** Una iteración: reclama, ejecuta y reporta. Es la unidad que se prueba. */
export async function processOne(cfg: Config, api: ApiClient, run: (job: ClaimedJob) => Promise<Outcome> = (j) => (j.provider === 'codex' ? runCodex(j, cfg) : runClaude(j, cfg)), now = Date.now()): Promise<Step> {
  const c = await api.claim(providersOf(cfg));
  if (!c.job) return { kind: 'wait', reason: c.reason, seconds: waitFor(c, cfg, now) };
  const job = c.job;
  const t0 = Date.now();
  const outcome = await run(job).catch((e: Error): Outcome => ({ ok: false, provider: job.provider, error_class: 'transient', error: `Fallo interno del worker: ${e.message}` }));
  await api.report(job.id, outcome);
  if (outcome.snapshot) await api.usage(outcome.snapshot).catch(() => undefined); // mejor esfuerzo
  return { kind: 'job', jobId: job.id, task: job.task, ok: outcome.ok, error_class: outcome.ok ? undefined : outcome.error_class, ms: Date.now() - t0 };
}

export async function loop(cfg: Config, signal: { stop: boolean }, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {
  const api = new ApiClient(cfg);
  let apiBackoff = 5;
  while (!signal.stop) {
    try {
      const step = await processOne(cfg, api);
      apiBackoff = 5;
      if (step.kind === 'job') {
        log(step.ok ? 'info' : 'warn', 'trabajo procesado', { job: step.jobId, task: step.task, ok: step.ok, error_class: step.error_class, ms: step.ms });
        continue; // con trabajo pendiente no hace falta esperar
      }
      log('info', 'sin trabajo', { reason: step.reason, wait_s: Math.round(step.seconds) });
      await sleep(step.seconds * 1000);
    } catch (e) {
      log('error', 'fallo hablando con la API', { error: (e as Error).message, retry_s: apiBackoff });
      await sleep(apiBackoff * 1000);
      apiBackoff = Math.min(apiBackoff * 2, 60);
    }
  }
}
