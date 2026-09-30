import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyMessage, snapshotFromEvent } from '../src/classify.js';

describe('classifyMessage', () => {
  const cases: [string, number | null | undefined, string][] = [
    // observados en uso real (spike)
    ['Not logged in · Please run /login', null, 'auth'],
    ["There's an issue with the selected model (x). It may not exist or you may not have access to it.", 404, 'permanent'],
    ["The 'x' model is not supported when using Codex with a ChatGPT account.", 400, 'permanent'],
    ['unexpected status 401 Unauthorized: Missing bearer or basic authentication in header', undefined, 'auth'],
    // textos de la documentación oficial (cuota real aún sin observar)
    ["You've hit your session limit · resets 3:45pm", null, 'quota'],
    ["You've hit your weekly limit · resets Mon 12:00am", null, 'quota'],
    ["You've hit your Opus limit · resets 3:45pm", null, 'quota'],
    ["You've hit your Sonnet limit · resets 3:45pm", null, 'quota'],
    ["You've hit your monthly spend limit · raise it at claude.ai/settings/usage", null, 'billing'],
    ["You've hit your org's monthly spend limit · visit claude.ai/admin-settings/usage", null, 'billing'],
    ['Credit balance is too low', null, 'billing'],
    ['Login expired · Please run /login', null, 'auth'],
    ['OAuth token revoked', null, 'auth'],
    ['Invalid API key · Fix external API key', null, 'auth'],
    ['API Error: Request rejected (429) · this may be a temporary capacity issue.', 429, 'transient'],
    ['API Error: Server is temporarily limiting requests (not your usage limit)', null, 'transient'],
    ['API Error: Repeated 529 Overloaded errors. The API is at capacity', 529, 'transient'],
    ['API Error: 500 Internal server error.', 500, 'transient'],
    // el mismo texto SIN código de estado (la documentación dice que puede llegar solo como texto)
    ['API Error: Repeated 529 Overloaded errors. The API is at capacity', null, 'transient'],
    ['Opus is experiencing high load, please use /model to switch to Sonnet', null, 'transient'],
    ['API Error: 500 Internal server error. This is a server-side issue', undefined, 'transient'],
    ['API Error: Request rejected (429) · this may be a temporary capacity issue.', null, 'transient'],
    ['Request timed out', null, 'transient'],
    ['API Error: No response from API (waited 3m, then 10m on the retry).', null, 'transient'],
    ['Reconnecting... 2/5 (unexpected status 502)', null, 'transient'],
    ['algo totalmente inesperado', null, 'permanent'],
  ];
  it.each(cases)('%s → %s', (text, status, expected) => {
    expect(classifyMessage(text, status).error_class).toBe(expected);
  });
  it('la cuota semanal apunta a la ventana semanal; la de sesión, a la de 5 h', () => {
    expect(classifyMessage("You've hit your weekly limit · resets Mon 12:00am")).toEqual({ error_class: 'quota', window: 'seven_day' });
    expect(classifyMessage("You've hit your session limit · resets 3:45pm")).toEqual({ error_class: 'quota', window: 'five_hour' });
  });
  it('el estrangulamiento del servidor NO es cuota del usuario', () => {
    expect(classifyMessage('Server is temporarily limiting requests (not your usage limit)').error_class).toBe('transient');
  });
});

describe('snapshotFromEvent (evento real capturado)', () => {
  const line = readFileSync(join(import.meta.dirname, 'fixtures/claude-success.jsonl'), 'utf8').split('\n').map((l) => l && JSON.parse(l)).find((e) => e?.type === 'rate_limit_event');
  it('extrae ambas ventanas', () => {
    const s = snapshotFromEvent(line)!;
    expect(s.five_hour!.utilization).toBeGreaterThan(0); expect(s.seven_day!.utilization).toBeGreaterThan(0.3);
    expect(typeof s.five_hour!.resetsAt).toBe('number');
  });
  it('ignora eventos ausentes o mal formados', () => {
    expect(snapshotFromEvent(undefined)).toBeUndefined();
    expect(snapshotFromEvent({ rate_limit_info: {} })).toBeUndefined();
    expect(snapshotFromEvent({ rate_limit_info: { unifiedWindows: { five_hour: { utilization: 7, resetsAt: 1 } } } })).toBeUndefined();
    expect(snapshotFromEvent({ rate_limit_info: { unifiedWindows: { five_hour: { utilization: 'x', resetsAt: 1 } } } })).toBeUndefined();
  });
});
