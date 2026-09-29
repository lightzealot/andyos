#!/usr/bin/env node
// CLI simulado de `claude`. El modo se lee de ./mode.txt (el entorno del hijo está filtrado a propósito).
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mode = (() => { try { return readFileSync('mode.txt', 'utf8').trim(); } catch { return 'ok'; } })();
appendFileSync('calls.jsonl', JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), envKeys: Object.keys(process.env) }) + '\n');
const out = (o) => console.log(JSON.stringify(o));
const now = Math.floor(Date.now() / 1000);

if (process.argv[2] === 'auth') { // claude auth status --json
  if (mode === 'loggedout') out({ loggedIn: false, authMethod: 'none' });
  else if (mode === 'apikey') out({ loggedIn: true, authMethod: 'api-key' });
  else out({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' });
  process.exit(0);
}

const win = (five, seven) => ({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', resetsAt: now + 7200,
  unifiedWindows: { five_hour: { utilization: five, resetsAt: now + 7200 }, seven_day: { utilization: seven, resetsAt: now + 3 * 86400 } } } });
const usage = { input_tokens: 2, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const okResult = (extra = {}) => ({ type: 'result', subtype: 'success', is_error: false, result: '{"tags":["ia","n8n"]}', stop_reason: 'tool_use',
  api_error_status: null, duration_ms: 4000, total_cost_usd: 0.008, usage, modelUsage: { 'claude-sonnet-5-5': {} }, structured_output: { tags: ['ia', 'n8n'] }, ...extra });
const errResult = (text, status = null) => ({ type: 'result', subtype: 'success', is_error: true, result: text, api_error_status: status, terminal_reason: 'api_error', usage, modelUsage: {} });

if (mode.startsWith('fixture:')) { // reproduce una salida REAL capturada
  const [, name, code] = mode.split(':');
  process.stdout.write(readFileSync(join(here, `${name}.jsonl`), 'utf8'));
  process.exit(Number(code ?? 0));
}
switch (mode) {
  case 'ok': out({ type: 'system', subtype: 'init' }); out(win(0.05, 0.4)); out(okResult()); break;
  case 'ok_hot': out(win(0.9, 0.4)); out(okResult()); break;
  case 'badtags': out(okResult({ structured_output: { tags: [] } })); break;
  case 'text_json': out(okResult({ structured_output: undefined })); break;
  case 'nostructured': out(okResult({ structured_output: undefined, result: 'no soy json' })); break;
  case 'quota': out(win(1.0, 0.4)); out(errResult("You've hit your session limit · resets 3:45pm")); process.exit(1); break;
  case 'quota_weekly': out(win(0.3, 1.0)); out(errResult("You've hit your weekly limit · resets Mon 12:00am")); process.exit(1); break;
  case 'spend': out(errResult("You've hit your monthly spend limit · raise it at claude.ai/settings/usage")); process.exit(1); break;
  case 'overloaded': out(errResult('API Error: Repeated 529 Overloaded errors. The API is at capacity', 529)); process.exit(1); break;
  case 'throttle': out(errResult('API Error: Server is temporarily limiting requests (not your usage limit)')); process.exit(1); break;
  case 'doc_error': out({ type: 'error', error: { type: 'usage_limit_error', message: "You've hit your session limit · resets 3:45pm" } }); process.exit(1); break;
  case 'crash': console.error('boom: fallo inesperado'); process.exit(2); break;
  case 'hang': setInterval(() => {}, 1000); break;
  default: out(okResult());
}
