import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';

const cfg = {
  password: 'pw-de-prueba', sessionSecret: 'x'.repeat(40),
  webOrigin: 'http://localhost:3000', secureCookie: false, inboxSecret: 'i'.repeat(40),
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

describe('referencias', () => {
  it('exige sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/references' })).statusCode).toBe(401);
  });

  it('crea con nota de por qué funciona y la lista', async () => {
    const r = await call('POST', '/references', {
      title: 'Reel de Rafa', url: 'https://instagram.com/reel/abc', creator: '@rafa', platform: 'instagram',
      format: 'reel', why_it_works: 'Abre con una cifra y promete demo', hook_pattern: 'cifra + promesa', tags: ['hook'],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ why_it_works: 'Abre con una cifra y promete demo', derived_count: 0, tags: ['hook'] });
    expect((await call('GET', '/references')).json().references).toHaveLength(1);
  });

  it('rechaza URLs que no sean http(s) y campos desconocidos', async () => {
    expect((await call('POST', '/references', { title: 'x', url: 'javascript:alert(1)' })).statusCode).toBe(400);
    expect((await call('POST', '/references', { title: 'x', url: 'ftp://a.com/f' })).statusCode).toBe(400);
    expect((await call('POST', '/references', { title: 'x', extra: 1 })).statusCode).toBe(400);
    expect((await call('POST', '/references', { title: '' })).statusCode).toBe(400);
  });

  it('edita parcialmente sin perder el resto', async () => {
    const id = (await call('POST', '/references', { title: 'A', why_it_works: 'porque sí', creator: '@c' })).json().id;
    const r = await call('PATCH', `/references/${id}`, { why_it_works: 'nuevo motivo' });
    expect(r.json()).toMatchObject({ title: 'A', creator: '@c', why_it_works: 'nuevo motivo' });
    expect((await call('PATCH', '/references/no-existe', { title: 'x' })).statusCode).toBe(404);
  });

  it('derivar crea contenido en «idea», lo enlaza y cuenta derivados', async () => {
    const id = (await call('POST', '/references', { title: 'Ref', platform: 'tiktok', format: 'short' })).json().id;
    const r = await call('POST', `/references/${id}/derive`);
    expect(r.statusCode).toBe(200);
    expect(r.json().reference.derived_count).toBe(1);
    const item = (await call('GET', `/items/${r.json().content_id}`)).json();
    expect(item).toMatchObject({ title: 'Basado en: Ref', status: 'idea', platform: 'tiktok', approved_at: null });
    // archivar el contenido derivado ya no lo cuenta
    await call('DELETE', `/items/${r.json().content_id}`);
    expect((await call('GET', '/references')).json().references[0].derived_count).toBe(0);
  });

  it('archivar la referencia la oculta y las referencias no salen en el pipeline', async () => {
    const id = (await call('POST', '/references', { title: 'R' })).json().id;
    expect((await call('GET', '/items?type=content')).json().items).toHaveLength(0);
    expect((await call('DELETE', `/items/${id}`)).statusCode).toBe(200);
    expect((await call('GET', '/references')).json().references).toHaveLength(0);
  });
});
