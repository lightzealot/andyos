import { classifyMessage, snapshotFromEvent, type UsageSnapshot } from '../classify.js';
import type { Config } from '../config.js';
import { runCommand } from '../proc.js';
import type { ClaimedJob, Outcome } from '../types.js';

/** Configuración mínima verificada en el spike: sin herramientas, MCP, skills ni hooks, y sin escribir sesiones. */
export const claudeArgs = (job: ClaimedJob): string[] => [
  '-p', job.prompt,
  '--tools', '',
  '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
  '--disable-slash-commands', '--setting-sources', 'project',
  '--permission-mode', 'dontAsk', '--no-session-persistence',
  '--system-prompt', job.system,
  '--output-format', 'stream-json', '--verbose',
  '--json-schema', JSON.stringify(job.json_schema),
];

const fail = (error_class: 'quota' | 'billing' | 'auth' | 'transient' | 'permanent', error: string, extra: { reset_at?: number; snapshot?: UsageSnapshot } = {}): Outcome =>
  ({ ok: false, provider: 'claude', error_class, error: error.slice(0, 500), ...extra });

export async function runClaude(job: ClaimedJob, cfg: Config): Promise<Outcome> {
  const r = await runCommand(cfg.claudeBin, claudeArgs(job), { cwd: cfg.workDir, timeoutMs: job.timeout_s * 1000 });
  if (r.timedOut) return fail('transient', `Tiempo agotado tras ${job.timeout_s} s`);

  let result: Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  let snapshot: UsageSnapshot | undefined;
  let streamError: { message: string; status?: number } | undefined;
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    let ev: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'result') result = ev;
    else if (ev.type === 'rate_limit_event') snapshot = snapshotFromEvent(ev) ?? snapshot;
    else if (ev.type === 'error' && ev.error) streamError = { message: String(ev.error.message ?? ''), status: ev.error.status };
  }

  const windowReset = (w?: 'five_hour' | 'seven_day') => (w && snapshot?.[w]?.resetsAt) || undefined;

  const failFrom = (text: string, status?: number | null) => {
    const c = classifyMessage(text, status);
    return fail(c.error_class, text, { reset_at: c.error_class === 'quota' ? windowReset(c.window) : undefined, snapshot });
  };

  if (streamError) return failFrom(streamError.message, streamError.status);
  if (!result) return failFrom(r.stderr || r.stdout || `El proceso terminó sin resultado (código ${r.code})`);
  // OJO: un error llega como is_error:true con subtype "success" (verificado); no basta con mirar subtype.
  if (result.is_error) return failFrom(String(result.result ?? 'error desconocido'), result.api_error_status);

  let output: unknown = result.structured_output;
  if (output == null && typeof result.result === 'string') {
    try { output = JSON.parse(result.result); } catch { /* sin salida estructurada */ }
  }
  if (output == null || typeof output !== 'object') return fail('permanent', 'La respuesta no contiene salida estructurada', { snapshot });

  const u = result.usage ?? {};
  return {
    ok: true, output, provider: 'claude', snapshot,
    model: Object.keys(result.modelUsage ?? {})[0],
    usage: {
      input_tokens: u.input_tokens, output_tokens: u.output_tokens,
      cache_creation_input_tokens: u.cache_creation_input_tokens, cache_read_input_tokens: u.cache_read_input_tokens,
      cost_usd_estimate: result.total_cost_usd, duration_ms: result.duration_ms,
    },
  };
}
