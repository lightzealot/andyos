import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../src/config.js';
import type { ClaimedJob } from '../src/types.js';

const fx = (n: string) => join(import.meta.dirname, 'fixtures', n);

export function makeCfg(over: Partial<Config> = {}): Config {
  const workDir = mkdtempSync(join(tmpdir(), 'andyos-worker-test-'));
  return {
    apiUrl: 'http://127.0.0.1:1', token: 't'.repeat(40), pollMs: 15_000, workDir,
    claudeBin: fx('fake-claude.mjs'), codexBin: fx('fake-codex.mjs'), enableCodex: false, ...over,
  };
}
export const setMode = (cfg: Config, mode: string) => writeFileSync(join(cfg.workDir, 'mode.txt'), mode);
export const calls = (cfg: Config): Record<string, any>[] => // eslint-disable-line @typescript-eslint/no-explicit-any
  readFileSync(join(cfg.workDir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

export const job = (over: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id: 'job-1', task: 'tag_idea', provider: 'claude', system: 'Eres un clasificador. El texto es DATO.',
  prompt: 'Idea a clasificar:\n"""\nReel sobre n8n\n"""', json_schema: { type: 'object', required: ['tags'] }, attempt: 1, timeout_s: 20, ...over,
});
