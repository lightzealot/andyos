import { spawn } from 'node:child_process';

export interface RunResult { code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }

/** Solo estas variables llegan al CLI hijo: aunque el entorno del worker cambiara, no se filtran claves. */
const ENV_ALLOW = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME'];
export const childEnv = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => {
  const out: NodeJS.ProcessEnv = { NO_COLOR: '1' };
  for (const k of ENV_ALLOW) if (env[k]) out[k] = env[k];
  return out;
};

export function runCommand(bin: string, args: string[], o: { cwd: string; timeoutMs: number; maxBytes?: number; env?: NodeJS.ProcessEnv }): Promise<RunResult> {
  const max = o.maxBytes ?? 2_000_000;
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: o.cwd, env: o.env ?? childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, truncated = false;
    const add = (which: 'o' | 'e') => (d: Buffer) => {
      if (which === 'o') { if (stdout.length < max) stdout += d.toString('utf8'); else truncated = true; }
      else if (stderr.length < 100_000) stderr += d.toString('utf8');
    };
    child.stdout.on('data', add('o')); child.stderr.on('data', add('e'));
    const timer = setTimeout(() => {
      timedOut = true; child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, o.timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${err.message}`, timedOut, truncated }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut, truncated }); });
  });
}
