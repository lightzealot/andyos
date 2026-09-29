import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { titleFrom } from '../src/ideas.js';

const SECRET = 'i'.repeat(40);
const cfg = {
  password: 'pw-de-prueba', sessionSecret: 'x'.repeat(40),
  webOrigin: 'http://localhost:3000', secureCookie: false, inboxSecret: SECRET,
};

let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;

beforeEach(async () => {
  app = await buildApp(openDb(':memory:'), cfg);
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: cfg.password } });
  cookie = (res.headers['set-cookie'] as string).split(';')[0];
});

const hook = (payload: object, secret: string | null = SECRET) =>
  app.inject({ method: 'POST', url: '/webhooks/inbox', payload, headers: secret ? { 'x-webhook-secret': secret } : {} });
const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { cookie } });

describe('webhook /webhooks/inbox', () => {
  it('rechaza sin secreto o con secreto incorrecto', async () => {
    expect((await hook({ text: 'x' }, null)).statusCode).toBe(401);
    expect((await hook({ text: 'x' }, 'incorrecto')).statusCode).toBe(401);
    expect((await call('GET', '/ideas')).json().ideas).toHaveLength(0);
  });

  it('no acepta la cookie de sesión como sustituto del secreto', async () => {
    const r = await app.inject({ method: 'POST', url: '/webhooks/inbox', payload: { text: 'x' }, headers: { cookie } });
    expect(r.statusCode).toBe(401);
  });

  it('crea una idea con título de la primera línea', async () => {
    const r = await hook({ text: '\nReel sobre n8n\nDetalle largo', source_id: '42' });
    expect(r.statusCode).toBe(201);
    const ideas = (await call('GET', '/ideas')).json().ideas;
    expect(ideas).toHaveLength(1);
    expect(ideas[0]).toMatchObject({ title: 'Reel sobre n8n', status: 'nueva', source: 'telegram', source_id: '42' });
    expect(ideas[0].notes).toContain('Detalle largo');
  });

  it('es idempotente por source_id (reintentos de Telegram/n8n)', async () => {
    const a = (await hook({ text: 'idea', source_id: '7' })).json();
    const b = await hook({ text: 'idea', source_id: '7' });
    expect(b.statusCode).toBe(200);
    expect(b.json()).toMatchObject({ id: a.id, duplicate: true });
    expect((await call('GET', '/ideas')).json().ideas).toHaveLength(1);
  });

  it('valida entrada', async () => {
    expect((await hook({ text: '   ' })).statusCode).toBe(400);
    expect((await hook({ text: 'x'.repeat(5001) })).statusCode).toBe(400);
    expect((await hook({ text: 'x', source: 'instagram' })).statusCode).toBe(400);
  });

  it('las ideas no aparecen en el pipeline de contenido', async () => {
    await hook({ text: 'idea suelta' });
    expect((await call('GET', '/items?type=content')).json().items).toHaveLength(0);
  });
});

describe('ideas', () => {
  it('captura manual, edición de etiquetas y descarte', async () => {
    const created = (await call('POST', '/ideas', { text: 'Idea web', tags: ['ia'] })).json();
    expect(created).toMatchObject({ source: 'web', tags: ['ia'] });
    const p = await call('PATCH', `/ideas/${created.id}`, { tags: ['ia', 'n8n'], status: 'descartada' });
    expect(p.json()).toMatchObject({ tags: ['ia', 'n8n'], status: 'descartada' });
  });

  it('promover crea contenido en estado idea y enlaza ambos', async () => {
    const idea = (await hook({ text: 'Reel API Meta\nnotas' })).json();
    const r = await call('POST', `/ideas/${idea.id}/promote`, { platform: 'instagram', format: 'reel' });
    expect(r.statusCode).toBe(200);
    const { content_id, idea: after } = r.json();
    expect(after).toMatchObject({ status: 'promovida', promoted_to: content_id });
    const item = (await call('GET', `/items/${content_id}`)).json();
    expect(item).toMatchObject({ title: 'Reel API Meta', status: 'idea', platform: 'instagram', approved_at: null });
    expect((await call('POST', `/ideas/${idea.id}/promote`)).statusCode).toBe(409);
    expect((await call('PATCH', `/ideas/${idea.id}`, { notes: 'x' })).statusCode).toBe(409);
  });

  it('exige sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/ideas' })).statusCode).toBe(401);
  });
});

describe('titleFrom', () => {
  it('recorta títulos largos', () => {
    expect(titleFrom('a'.repeat(200))).toHaveLength(118);
    expect(titleFrom('a'.repeat(200)).endsWith('…')).toBe(true);
  });
});
