import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';

const cfg = { password: 'pw-de-prueba', sessionSecret: 'x'.repeat(40), webOrigin: 'http://localhost:3000', secureCookie: false, inboxSecret: 'i'.repeat(40) };
let app: Awaited<ReturnType<typeof buildApp>>; let cookie: string;
beforeEach(async () => {
  app = await buildApp(openDb(':memory:'), cfg);
  cookie = ((await app.inject({ method: 'POST', url: '/auth/login', payload: { password: cfg.password } })).headers['set-cookie'] as string).split(';')[0];
});
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => app.inject({ method, url, payload, headers: { cookie } });

describe('plataforma predeterminada: Instagram', () => {
  it('una tarjeta nueva sin plataforma sale para Instagram', async () => {
    expect((await call('POST', '/items', { title: 'A' })).json().platform).toBe('instagram');
  });
  it('null explícito (el tablero lo envía cuando no eliges) también', async () => {
    expect((await call('POST', '/items', { title: 'A', platform: null })).json().platform).toBe('instagram');
  });
  it('una plataforma elegida se respeta', async () => {
    expect((await call('POST', '/items', { title: 'A', platform: 'tiktok' })).json().platform).toBe('tiktok');
  });
  it('promover una idea sin plataforma → Instagram; con plataforma, la elegida', async () => {
    const i1 = (await call('POST', '/ideas', { text: 'idea uno' })).json().id;
    const i2 = (await call('POST', '/ideas', { text: 'idea dos' })).json().id;
    const c1 = (await call('POST', `/ideas/${i1}/promote`, {})).json().content_id;
    const c2 = (await call('POST', `/ideas/${i2}/promote`, { platform: 'youtube' })).json().content_id;
    expect((await call('GET', `/items/${c1}`)).json().platform).toBe('instagram');
    expect((await call('GET', `/items/${c2}`)).json().platform).toBe('youtube');
  });
  it('«Crear contenido inspirado» hereda la plataforma de la referencia o usa Instagram', async () => {
    const r1 = (await call('POST', '/references', { title: 'sin plataforma' })).json().id;
    const r2 = (await call('POST', '/references', { title: 'de youtube', platform: 'youtube' })).json().id;
    const c1 = (await call('POST', `/references/${r1}/derive`)).json().content_id;
    const c2 = (await call('POST', `/references/${r2}/derive`)).json().content_id;
    expect((await call('GET', `/items/${c1}`)).json().platform).toBe('instagram');
    expect((await call('GET', `/items/${c2}`)).json().platform).toBe('youtube');
  });
  it('se puede cambiar o quitar después en la tarjeta (PATCH)', async () => {
    const id = (await call('POST', '/items', { title: 'A' })).json().id;
    expect((await call('PATCH', `/items/${id}`, { platform: 'linkedin' })).json().platform).toBe('linkedin');
    expect((await call('PATCH', `/items/${id}`, { platform: null })).json().platform).toBeNull();
  });
});
