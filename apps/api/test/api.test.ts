import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';

const cfg = {
  password: 'pw-de-prueba', sessionSecret: 'x'.repeat(40),
  webOrigin: 'http://localhost:3000', secureCookie: false,
};

let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;

beforeEach(async () => {
  app = await buildApp(openDb(':memory:'), cfg);
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: cfg.password } });
  cookie = (res.headers['set-cookie'] as string).split(';')[0];
});

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { cookie } });

describe('auth', () => {
  it('rechaza sin sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/items' })).statusCode).toBe(401);
  });
  it('rechaza contraseña incorrecta', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'mala' } });
    expect(r.statusCode).toBe(401);
  });
  it('rechaza cookie manipulada', async () => {
    const r = await app.inject({ method: 'GET', url: '/items', headers: { cookie: 'andyos_session=9999999999999.falso' } });
    expect(r.statusCode).toBe(401);
  });
  it('limita intentos de login', async () => {
    let last = 0;
    for (let i = 0; i < 8; i++) {
      last = (await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'mala' } })).statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('items', () => {
  it('crea, lista y archiva', async () => {
    const c = await call('POST', '/items', { title: 'Reel n8n', platform: 'instagram', format: 'reel' });
    expect(c.statusCode).toBe(201);
    const id = c.json().id;
    expect(c.json()).toMatchObject({ status: 'idea', platform: 'instagram', approved_at: null });
    expect((await call('GET', '/items')).json().items).toHaveLength(1);
    expect((await call('DELETE', `/items/${id}`)).statusCode).toBe(200);
    expect((await call('GET', '/items')).json().items).toHaveLength(0);
  });

  it('valida entrada', async () => {
    expect((await call('POST', '/items', { title: '' })).statusCode).toBe(400);
    expect((await call('POST', '/items', { title: 'x', platform: 'myspace' })).statusCode).toBe(400);
  });

  it('guarda el guion estructurado', async () => {
    const id = (await call('POST', '/items', { title: 'g' })).json().id;
    const r = await call('PATCH', `/items/${id}`, { script: { hook: 'H', cta: 'C' }, status: 'guion' });
    expect(r.json()).toMatchObject({ status: 'guion', script: { hook: 'H', cta: 'C' } });
  });
});

describe('compuerta de aprobación humana', () => {
  const mk = async () => (await call('POST', '/items', { title: 'p', hook: 'h' })).json().id as string;

  it('no permite crear directamente en Programado', async () => {
    expect((await call('POST', '/items', { title: 'x', status: 'programado' })).statusCode).toBe(409);
  });

  it('bloquea Programado y Publicado sin aprobación', async () => {
    const id = await mk();
    for (const status of ['programado', 'publicado', 'analizado']) {
      const r = await call('PATCH', `/items/${id}`, { status });
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe('approval_required');
    }
  });

  it('solo se aprueba desde la etapa Aprobación', async () => {
    const id = await mk();
    expect((await call('POST', `/items/${id}/approve`)).statusCode).toBe(409);
    await call('PATCH', `/items/${id}`, { status: 'aprobacion' });
    const r = await call('POST', `/items/${id}/approve`);
    expect(r.statusCode).toBe(200);
    expect(r.json().approved_at).toBeTruthy();
    expect((await call('PATCH', `/items/${id}`, { status: 'programado' })).statusCode).toBe(200);
  });

  it('editar contenido aprobado invalida la aprobación', async () => {
    const id = await mk();
    await call('PATCH', `/items/${id}`, { status: 'aprobacion' });
    await call('POST', `/items/${id}/approve`);
    await call('PATCH', `/items/${id}`, { status: 'programado' });
    const r = await call('PATCH', `/items/${id}`, { caption: 'texto nuevo' });
    expect(r.json()).toMatchObject({ status: 'aprobacion', approved_at: null });
    expect((await call('PATCH', `/items/${id}`, { status: 'publicado' })).statusCode).toBe(409);
  });

  it('retroceder antes de Aprobación retira la aprobación', async () => {
    const id = await mk();
    await call('PATCH', `/items/${id}`, { status: 'aprobacion' });
    await call('POST', `/items/${id}/approve`);
    const r = await call('PATCH', `/items/${id}`, { status: 'edicion' });
    expect(r.json().approved_at).toBeNull();
  });
});
