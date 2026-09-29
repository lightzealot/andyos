import { loadConfig } from './config.js';
import { log } from './log.js';
import { healthCheck, loop } from './worker.js';

async function main() {
  const cfg = loadConfig();
  await healthCheck(cfg);
  log('info', 'worker iniciado', { api: cfg.apiUrl, codex: cfg.enableCodex, workDir: cfg.workDir });
  const signal = { stop: false };
  for (const s of ['SIGTERM', 'SIGINT'] as const) {
    process.on(s, () => { log('info', 'apagando: se termina el trabajo en curso', { signal: s }); signal.stop = true; });
  }
  await loop(cfg, signal);
  log('info', 'worker detenido');
}

main().catch((e: Error) => { log('error', 'no se pudo iniciar', { error: e.message }); process.exit(1); });
