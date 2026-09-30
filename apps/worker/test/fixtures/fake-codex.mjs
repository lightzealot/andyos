#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mode = (() => { try { return readFileSync('mode.txt', 'utf8').trim(); } catch { return 'ok'; } })();
const argv = process.argv.slice(2);
const schemaIdx = argv.indexOf('--output-schema');
appendFileSync('calls.jsonl', JSON.stringify({ argv, cwd: process.cwd(), schemaFileExisted: schemaIdx >= 0 && existsSync(argv[schemaIdx + 1]) }) + '\n');
const out = (o) => console.log(JSON.stringify(o));

if (argv[0] === 'login') { // codex login status
  if (mode === 'loggedout') { console.error('Not logged in'); process.exit(1); }
  console.log('Logged in using ChatGPT'); process.exit(0);
}
if (mode.startsWith('fixture:')) {
  const [, name, code] = mode.split(':');
  process.stdout.write(readFileSync(join(here, `${name}.jsonl`), 'utf8')); process.exit(Number(code ?? 0));
}
if (mode === 'hang') setInterval(() => {}, 1000);
else if (mode === 'notjson') { out({ type: 'item.completed', item: { type: 'agent_message', text: 'hola, no soy json' } }); out({ type: 'turn.completed', usage: {} }); }
else {
  out({ type: 'thread.started', thread_id: 'x' }); out({ type: 'turn.started' });
  out({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: JSON.stringify({ tags: ['ia', 'seguridad'] }) } });
  out({ type: 'turn.completed', usage: { input_tokens: 14513, output_tokens: 20 } });
}
