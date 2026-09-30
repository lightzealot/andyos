import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../api/src/app.js';
import { openDb } from '../../api/src/db.js';
import { ApiClient } from '../src/api.js';
import type { Config } from '../src/config.js';
import { healthCheck, loop, processOne } from '../src/worker.js';
import { job as sampleJob, makeCfg, setMode } from './helpers.js';

const TOKEN = 't'.repeat(40);
let alertServer: Server;
let alertUrl = '';
let alerts: { type: string; message: string }[] = [];

beforeAll(async () => {
  alertServer = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => { alerts.push(JSON.parse(b)); res.writeHead(200); res.end('{}'); });
  });
  await new Promise<void>((r) => alertServer.listen(0, '127.0.0.1', r));
  alertUrl = `http://127.0.0.1:${(alertServer.address() as AddressInfo).port}/a`;
});
afterAll(() => { alertServer.close(); });

type Ctx = Awaited<ReturnType<typeof setup>>;
let ctx: Ctx;

async function setup() {
  const app = await buildApp(openDb(':memory:'), {
    password: 'pw', sessionSecret: 'x'.repeat(40), webOrigin: 'http://localhost:3000', secureCookie: false,
    inboxSecret: 'i'.repeat(40), workerToken: TOKEN, alert: { url: alertUrl, secret: 'a'.repeat(40) },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'pw' } });
  const cookie = (login.headers['set-cookie'] as string).split(';')[0];
  const user = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => app.inject({ method, url, payload, headers: { cookie } });
  // Estas pruebas encolan a mano: sin el etiquetado automático de ideas nuevas.
  await user('PATCH', '/ai/queue', { auto_tag: false });
  const cfg: Config = makeCfg({ apiUrl: `http://127.0.0.1:${port}`, token: TOKEN });
  const ideaJob = async (text = 'Reel sobre n8n y la API de Meta', provider?: string) => {
    const idea = (await user('POST', '/ideas', { text })).json().id as string;
    const j = (await user('POST', '/ai/jobs', { task: 'tag_idea', input: { idea_id: idea }, provider })).json().job;
    return { idea, jobId: j.id as string };
  };
  return { app, user, cfg, api: new ApiClient(cfg), ideaJob };
}
const flush = () => new Promise((r) => setTimeout(r, 80));

beforeEach(async () => { alerts = []; ctx = await setup(); });

describe('worker ↔ API (integración)', () => {
  it('éxito: el trabajo queda como BORRADOR (no toca la idea) hasta que un humano lo acepta', async () => {
    const { cfg, api, user, ideaJob } = ctx; setMode(cfg, 'ok');
    const { idea, jobId } = await ideaJob();
    expect(await processOne(cfg, api)).toMatchObject({ kind: 'job', ok: true });
    const j = (await user('GET', `/ai/jobs/${jobId}`)).json();
    expect(j).toMatchObject({ status: 'done', provider: 'claude', model: 'claude-sonnet-5-5', output: { tags: ['ia', 'n8n'] }, accepted_at: null });
    expect(j.usage).toMatchObject({ output_tokens: 40 });
    expect((await user('GET', '/ideas')).json().ideas.find((i: { id: string }) => i.id === idea).tags).toEqual([]); // sin efecto todavía
    expect((await user('POST', `/ai/jobs/${jobId}/accept`)).statusCode).toBe(200);
    expect((await user('GET', '/ideas')).json().ideas.find((i: { id: string }) => i.id === idea).tags).toEqual(['ia', 'n8n']);
  });

  it('publica el uso real de la cuota que observa el CLI', async () => {
    const { cfg, api, user, ideaJob } = ctx; setMode(cfg, 'ok'); await ideaJob(); await processOne(cfg, api);
    const s = (await user('GET', '/ai/queue')).json().state;
    expect(s.usage_snapshot.five_hour.utilization).toBe(0.05); expect(s.usage_snapshot.seven_day.utilization).toBe(0.4);
  });

  it('si el CLI informa de uso alto (90 % de 5 h), la cola se pausa y avisa', async () => {
    const { cfg, api, user, ideaJob } = ctx; setMode(cfg, 'ok_hot'); await ideaJob(); await processOne(cfg, api); await flush();
    expect((await user('GET', '/ai/queue')).json().state).toMatchObject({ paused: true, paused_reason: 'usage_five_hour' });
    expect(alerts).toHaveLength(1); expect(alerts[0].message).toMatch(/90 %/);
  });

  it('cuota agotada: el trabajo NO se pierde, la cola se pausa una vez, avisa y el worker espera', async () => {
    const { cfg, api, user, ideaJob } = ctx; setMode(cfg, 'quota');
    const { jobId } = await ideaJob();
    expect(await processOne(cfg, api)).toMatchObject({ kind: 'job', ok: false, error_class: 'quota' }); await flush();
    expect((await user('GET', `/ai/jobs/${jobId}`)).json()).toMatchObject({ status: 'queued', attempts: 0 });
    expect((await user('GET', '/ai/queue')).json().state).toMatchObject({ paused: true, paused_reason: 'quota' });
    expect(alerts).toHaveLength(1); expect(alerts[0].message).toMatch(/cuota/i);
    const next = await processOne(cfg, api);
    expect(next).toMatchObject({ kind: 'wait', reason: 'paused' });
    expect((next as { seconds: number }).seconds).toBeGreaterThanOrEqual(15);
    expect(alerts).toHaveLength(1); // sin avisos repetidos
  });

  it('sesión caducada (salida REAL de claude): pausa indefinida, avisa, requiere acción humana', async () => {
    const { cfg, api, user, ideaJob } = ctx; setMode(cfg, 'fixture:claude-nologin:1'); await ideaJob();
    expect(await processOne(cfg, api)).toMatchObject({ ok: false, error_class: 'auth' }); await flush();
    expect((await user('GET', '/ai/queue')).json().state).toMatchObject({ paused: true, paused_reason: 'auth', paused_until: null });
    expect(alerts[0].message).toMatch(/auth/);
  });

  it('error transitorio: vuelve a la cola con espera (backoff) y el worker no lo reintenta de inmediato', async () => {
    const { cfg, api, user, ideaJob } = ctx; setMode(cfg, 'overloaded');
    const { jobId } = await ideaJob();
    expect(await processOne(cfg, api)).toMatchObject({ ok: false, error_class: 'transient' });
    expect((await user('GET', `/ai/jobs/${jobId}`)).json()).toMatchObject({ status: 'queued', attempts: 1 });
    expect(await processOne(cfg, api)).toMatchObject({ kind: 'wait', reason: 'empty' });
  });

  it('error permanente (modelo inexistente, salida REAL): el trabajo falla sin reintentos', async () => {
    const { cfg, api, user, ideaJob } = ctx; setMode(cfg, 'fixture:claude-badmodel:1');
    const { jobId } = await ideaJob(); await processOne(cfg, api);
    expect((await user('GET', `/ai/jobs/${jobId}`)).json()).toMatchObject({ status: 'failed', error_class: 'permanent', attempts: 1 });
  });

  it('salida que no cumple el esquema: la API la rechaza y NO queda como borrador', async () => {
    const { cfg, api, user, ideaJob } = ctx; setMode(cfg, 'badtags');
    const { jobId } = await ideaJob(); await processOne(cfg, api);
    expect((await user('GET', `/ai/jobs/${jobId}`)).json()).toMatchObject({ status: 'failed', error_class: 'permanent', accepted_at: null });
  });

  it('sin trabajo espera el intervalo de sondeo', async () => {
    expect(await processOne(ctx.cfg, ctx.api)).toMatchObject({ kind: 'wait', reason: 'empty', seconds: 15 });
  });

  it('un trabajo de codex solo se procesa si codex está habilitado y usa su adaptador', async () => {
    const { cfg, api, user, ideaJob } = ctx; setMode(cfg, 'ok');
    const { jobId } = await ideaJob('idea para codex', 'codex');
    expect(await processOne(cfg, api)).toMatchObject({ kind: 'wait', reason: 'empty' });       // codex deshabilitado
    const on: Config = { ...cfg, enableCodex: true };
    expect(await processOne(on, new ApiClient(on))).toMatchObject({ kind: 'job', ok: true });
    expect((await user('GET', `/ai/jobs/${jobId}`)).json()).toMatchObject({ status: 'done', provider: 'codex', output: { tags: ['ia', 'seguridad'] } });
  });

  it('un fallo interno del adaptador se reporta como transitorio y no tumba el worker', async () => {
    const { cfg, api, user, ideaJob } = ctx; const { jobId } = await ideaJob();
    const step = await processOne(cfg, api, async () => { throw new Error('reventó'); });
    expect(step).toMatchObject({ ok: false, error_class: 'transient' });
    expect((await user('GET', `/ai/jobs/${jobId}`)).json().status).toBe('queued');
  });

  it('un token incorrecto es un error de API, no un trabajo perdido', async () => {
    const bad = { ...ctx.cfg, token: 'x'.repeat(40) };
    await expect(processOne(bad, new ApiClient(bad))).rejects.toThrow(/401/);
  });
});

describe('bucle y arranque', () => {
  it('si la API no responde, espera con retroceso exponencial (5, 10, 20 s…) y sigue vivo', async () => {
    const cfg = makeCfg({ apiUrl: 'http://127.0.0.1:1' });
    const sleeps: number[] = []; const signal = { stop: false };
    await loop(cfg, signal, async (ms) => { sleeps.push(ms); if (sleeps.length === 4) signal.stop = true; });
    expect(sleeps).toEqual([5000, 10_000, 20_000, 40_000]);
  });
  it('healthCheck: exige sesión de suscripción (no API key) y, si se habilita, sesión de ChatGPT', async () => {
    const cfg = makeCfg();
    setMode(cfg, 'ok'); await expect(healthCheck(cfg)).resolves.toBeUndefined();
    setMode(cfg, 'loggedout'); await expect(healthCheck(cfg)).rejects.toThrow(/sesión/);
    setMode(cfg, 'apikey'); await expect(healthCheck(cfg)).rejects.toThrow(/claude\.ai/);
    setMode(cfg, 'ok'); await expect(healthCheck({ ...cfg, enableCodex: true })).resolves.toBeUndefined();
  });
});

void sampleJob;
