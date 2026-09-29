import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { triggerPath } from '../src/n8n.js';

const KEY = 'k'.repeat(30);
const TRIGGER = 't'.repeat(40);

const hookNode = (over: Record<string, unknown> = {}) => ({
  type: 'n8n-nodes-base.webhook',
  parameters: { httpMethod: 'POST', authentication: 'headerAuth', path: 'andyos-ping', token: 'SECRET_TOKEN_IN_NODE', ...over },
});
const WORKFLOWS = [
  { id: '1', name: 'Ping', active: true, updatedAt: '2026-09-01T00:00:00Z', tags: [{ name: 'andyos-trigger' }], nodes: [hookNode()] },
  { id: '2', name: 'Sin auth', active: true, tags: [{ name: 'andyos-trigger' }], nodes: [hookNode({ authentication: 'none' })] },
  { id: '3', name: 'Sin etiqueta', active: true, tags: [], nodes: [hookNode()] },
  { id: '4', name: 'Inactivo', active: false, tags: [{ name: 'andyos-trigger' }], nodes: [hookNode()] },
  { id: '5', name: 'Archivado', active: true, isArchived: true, tags: [], nodes: [] },
  { id: '6', name: 'Ruta rara', active: true, tags: [{ name: 'andyos-trigger' }], nodes: [hookNode({ path: '../admin' })] },
];
const EXECUTIONS = [
  { id: 30, workflowId: '1', status: 'error', mode: 'trigger', startedAt: '2026-09-28T10:00:00Z', stoppedAt: '2026-09-28T10:00:01Z', data: 'DATOS_SENSIBLES' },
  { id: 20, workflowId: '1', status: 'success', mode: 'trigger', startedAt: '2026-09-27T10:00:00Z', stoppedAt: '2026-09-27T10:00:01Z' },
  { id: 10, workflowId: '3', status: 'success', mode: 'webhook', startedAt: '2026-09-26T10:00:00Z', stoppedAt: '2026-09-26T10:00:01Z' },
];

let mock: Server;
let base: string;
let seen: { url: string; headers: Record<string, unknown>; body: string }[] = [];
let mode: 'ok' | 'down' | 'webhook401' = 'ok';

beforeAll(async () => {
  mock = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url!, headers: req.headers, body });
      const send = (code: number, obj: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (mode === 'down') return send(500, { message: 'boom' });
      if (req.url!.startsWith('/webhook/')) {
        if (mode === 'webhook401' || req.headers['x-webhook-secret'] !== TRIGGER) return send(401, {});
        return send(200, { started: true });
      }
      if (req.headers['x-n8n-api-key'] !== KEY) return send(401, { message: 'Unauthorized' });
      if (req.url!.startsWith('/api/v1/workflows')) return send(200, { data: WORKFLOWS, nextCursor: null });
      if (req.url!.startsWith('/api/v1/executions')) {
        const u = new URL(req.url!, 'http://x');
        const st = u.searchParams.get('status'); const wf = u.searchParams.get('workflowId');
        return send(200, { data: EXECUTIONS.filter((e) => (!st || e.status === st) && (!wf || e.workflowId === wf)), nextCursor: null });
      }
      send(404, {});
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
});
afterAll(() => { mock.close(); });

const baseCfg = {
  password: 'pw', sessionSecret: 'x'.repeat(40), webOrigin: 'http://localhost:3000',
  secureCookie: false, inboxSecret: 'i'.repeat(40),
};
async function setup(withN8n = true) {
  const app = await buildApp(openDb(':memory:'), { ...baseCfg, n8n: withN8n ? { baseUrl: base, apiKey: KEY, triggerSecret: TRIGGER } : undefined });
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'pw' } });
  const cookie = (res.headers['set-cookie'] as string).split(';')[0];
  return { app, call: (method: 'GET' | 'POST', url: string, payload?: object) => app.inject({ method, url, payload, headers: { cookie } }) };
}
beforeEach(() => { seen = []; mode = 'ok'; });

describe('triggerPath', () => {
  it('exige activo, etiqueta, POST y Header Auth', () => {
    expect(triggerPath(WORKFLOWS[0])).toBe('andyos-ping');
    for (const i of [1, 2, 3, 4, 5]) expect(triggerPath(WORKFLOWS[i])).toBeNull();
  });
});

describe('panel n8n', () => {
  it('sin configuración responde 503 y lo indica en /n8n/status', async () => {
    const { call } = await setup(false);
    expect((await call('GET', '/n8n/status')).json()).toEqual({ configured: false });
    expect((await call('GET', '/n8n/workflows')).statusCode).toBe(503);
    expect((await call('POST', '/n8n/workflows/1/trigger')).statusCode).toBe(503);
  });

  it('exige sesión', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/n8n/workflows' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/n8n/workflows/1/trigger' })).statusCode).toBe(401);
  });

  it('lista workflows con estado, errores recientes y si son disparables', async () => {
    const { call } = await setup();
    const { workflows } = (await call('GET', '/n8n/workflows')).json();
    expect(workflows.map((w: { id: string }) => w.id)).toEqual(['1', '2', '3', '4', '6']); // sin el archivado
    const ping = workflows.find((w: { id: string }) => w.id === '1');
    expect(ping).toMatchObject({ name: 'Ping', active: true, recent_errors: 1, triggerable: true, tags: ['andyos-trigger'] });
    expect(ping.last).toMatchObject({ status: 'error', started_at: '2026-09-28T10:00:00Z' }); // la más reciente
    expect(workflows.filter((w: { triggerable: boolean }) => w.triggerable).map((w: { id: string }) => w.id)).toEqual(['1']);
    expect(workflows.find((w: { id: string }) => w.id === '4').last).toBeNull();
  });

  it('no filtra nodos, tokens ni datos de ejecución; usa la clave y no pide datos', async () => {
    const { call } = await setup();
    const raw = (await call('GET', '/n8n/workflows')).body + (await call('GET', '/n8n/executions')).body;
    expect(raw).not.toContain('SECRET_TOKEN_IN_NODE');
    expect(raw).not.toContain('DATOS_SENSIBLES');
    expect(raw).not.toContain('andyos-ping'); // la ruta del webhook tampoco sale al navegador
    expect(seen.every((r) => r.url.startsWith('/webhook/') || r.headers['x-n8n-api-key'] === KEY)).toBe(true);
    expect(seen.some((r) => r.url.includes('includeData'))).toBe(false);
  });

  it('lista ejecuciones con nombre de workflow y filtra por estado', async () => {
    const { call } = await setup();
    const all = (await call('GET', '/n8n/executions')).json().executions;
    expect(all).toHaveLength(3);
    expect(all[0]).toMatchObject({ id: '30', workflow_name: 'Ping', status: 'error' });
    const errs = (await call('GET', '/n8n/executions?status=error')).json().executions;
    expect(errs.map((e: { id: string }) => e.id)).toEqual(['30']);
    expect((await call('GET', '/n8n/executions?status=hackeado')).statusCode).toBe(400);
    expect((await call('GET', '/n8n/executions?workflowId=../x')).statusCode).toBe(400);
    expect((await call('GET', '/n8n/executions?limit=9999')).statusCode).toBe(400);
  });

  it('dispara solo workflows habilitados, enviando el secreto por cabecera', async () => {
    const { call } = await setup();
    const r = await call('POST', '/n8n/workflows/1/trigger', { payload: { tema: 'prueba' } });
    expect(r.json()).toEqual({ ok: true, status: 200 });
    const hook = seen.find((s) => s.url === '/webhook/andyos-ping')!;
    expect(hook.headers['x-webhook-secret']).toBe(TRIGGER);
    expect(JSON.parse(hook.body)).toEqual({ source: 'andyos', payload: { tema: 'prueba' } });
    for (const id of ['2', '3', '4', '5', '6', '999']) {
      expect((await call('POST', `/n8n/workflows/${id}/trigger`)).statusCode).toBe(404);
    }
    expect(seen.filter((s) => s.url.startsWith('/webhook/'))).toHaveLength(1); // los rechazados nunca llegaron a n8n
  });

  it('valida el payload y el tamaño', async () => {
    const { call } = await setup();
    expect((await call('POST', '/n8n/workflows/1/trigger', { payload: 'texto' })).statusCode).toBe(400);
    expect((await call('POST', '/n8n/workflows/1/trigger', { payload: { x: 'a'.repeat(20_000) } })).statusCode).toBe(400);
  });

  it('avisa si n8n rechaza el secreto o no está disponible', async () => {
    const { call } = await setup();
    mode = 'webhook401';
    expect((await call('POST', '/n8n/workflows/1/trigger')).json()).toMatchObject({ error: 'webhook_rejected' });
    const s2 = await setup();
    mode = 'down';
    expect((await s2.call('GET', '/n8n/workflows')).json()).toEqual({ error: 'n8n_unavailable' });
  });
});
