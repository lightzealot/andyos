import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  apiUrl: string;
  token: string;
  pollMs: number;
  workDir: string;
  claudeBin: string;
  codexBin: string;
  enableCodex: boolean;
}

/** Variables que cambiarían la facturación (cobro por token) o el destino de las peticiones. */
export const FORBIDDEN_ENV = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY',
] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const present = FORBIDDEN_ENV.filter((k) => env[k]);
  if (present.length) {
    throw new Error(`Entorno no permitido (cobro por token o proxy): ${present.join(', ')}. Elimínalas y reinicia el worker.`);
  }
  const apiUrl = (env.API_URL ?? '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(apiUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(apiUrl)) {
    throw new Error('API_URL debe ser https:// (http solo para localhost)');
  }
  const token = env.WORKER_TOKEN ?? '';
  if (token.length < 32) throw new Error('WORKER_TOKEN falta o tiene menos de 32 caracteres');
  const pollS = Number(env.POLL_INTERVAL_S ?? 15);
  if (!Number.isFinite(pollS) || pollS < 2 || pollS > 600) throw new Error('POLL_INTERVAL_S debe estar entre 2 y 600');
  return {
    apiUrl, token, pollMs: pollS * 1000,
    workDir: env.WORK_DIR ?? join(homedir(), '.andyos-worker', 'work'),
    claudeBin: env.CLAUDE_BIN ?? 'claude',
    codexBin: env.CODEX_BIN ?? 'codex',
    enableCodex: env.ENABLE_CODEX === 'true',
  };
}
