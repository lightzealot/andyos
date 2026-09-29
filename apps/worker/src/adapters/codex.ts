import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyMessage } from '../classify.js';
import type { Config } from '../config.js';
import { runCommand } from '../proc.js';
import type { ClaimedJob, Outcome } from '../types.js';

export const codexArgs = (schemaFile: string, job: ClaimedJob): string[] => [
  'exec', '--json', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules',
  '-s', 'read-only', '--output-schema', schemaFile,
  // codex no tiene bandera de system prompt: se antepone al prompt
  `${job.system}\n\n${job.prompt}`,
];

const fail = (error_class: 'quota' | 'billing' | 'auth' | 'transient' | 'permanent', error: string): Outcome =>
  ({ ok: false, provider: 'codex', error_class, error: error.slice(0, 500) });

export async function runCodex(job: ClaimedJob, cfg: Config): Promise<Outcome> {
  const tmp = join(cfg.workDir, 'tmp');
  await mkdir(tmp, { recursive: true, mode: 0o700 });
  const schemaFile = join(tmp, `${job.id}.schema.json`);
  await writeFile(schemaFile, JSON.stringify(job.json_schema), { mode: 0o600 });
  try {
    const r = await runCommand(cfg.codexBin, codexArgs(schemaFile, job), { cwd: cfg.workDir, timeoutMs: job.timeout_s * 1000 });
    if (r.timedOut) return fail('transient', `Tiempo agotado tras ${job.timeout_s} s`);

    let message: string | undefined; let usage: Record<string, unknown> | undefined; let errText: string | undefined;
    for (const line of r.stdout.split('\n')) {
      if (!line.trim()) continue;
      let ev: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && typeof ev.item.text === 'string') message = ev.item.text;
      else if (ev.type === 'turn.completed') usage = ev.usage;
      else if (ev.type === 'turn.failed') errText = String(ev.error?.message ?? 'turn.failed');
    }
    if (errText || (r.code !== 0 && !message)) {
      const text = errText ?? (r.stderr || `codex terminó con código ${r.code}`);
      return fail(classifyMessage(text).error_class, text);
    }
    let output: unknown;
    try { output = JSON.parse(message ?? ''); } catch { return fail('permanent', 'La respuesta de codex no es JSON'); }
    if (output == null || typeof output !== 'object') return fail('permanent', 'La respuesta de codex no es un objeto');
    return { ok: true, output, provider: 'codex', usage };
  } finally {
    await rm(schemaFile, { force: true });
  }
}
