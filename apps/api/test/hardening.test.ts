import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';

const base = {
  password: 'pw', sessionSecret: 'x'.repeat(40), webOrigin: 'http://localhost:3000',
  secureCookie: false, inboxSecret: 'i'.repeat(40),
};
async function setup(extra = {}, db = openDb(':memory:')) {
  const app = await buildApp(db, { ...base, ...extra });
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'pw' } });
  const cookie = (res.headers['set-cookie'] as string).split(';')[0];
  return { app, db, call: (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => app.inject({ method, url, payload, headers: { cookie } }) };
}

describe('URLs solo http(s) en contenido', () => {
  it('rechaza javascript:, data: y ftp: en published_url y asset_links', async () => {
    const { call } = await setup();
    const id = (await call('POST', '/items', { title: 't' })).json().id;
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'ftp://a.com/x']) {
      expect((await call('PATCH', `/items/${id}`, { published_url: bad })).statusCode).toBe(400);
      expect((await call('PATCH', `/items/${id}`, { asset_links: [bad] })).statusCode).toBe(400);
      expect((await call('POST', '/items', { title: 'x', published_url: bad })).statusCode).toBe(400);
    }
  });
  it('acepta https y http', async () => {
    const { call } = await setup();
    const id = (await call('POST', '/items', { title: 't' })).json().id;
    const r = await call('PATCH', `/items/${id}`, { published_url: 'https://instagram.com/p/abc', asset_links: ['http://a.com/x', 'https://b.com/y'] });
    expect(r.statusCode).toBe(200);
    expect(r.json().published_url).toBe('https://instagram.com/p/abc');
  });
});

describe('errores del servidor', () => {
  it('un fallo interno no filtra mensajes de la base de datos', async () => {
    const { call, db } = await setup();
    db.close(); // fuerza un error de SQLite en la siguiente consulta
    const r = await call('GET', '/items?type=content');
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: 'internal_error' });
    expect(r.body).not.toMatch(/sqlite|database|statement|SELECT/i);
  });
  it('los errores del cliente siguen siendo 4xx sin detalles internos', async () => {
    const { app } = await setup();
    const r = await app.inject({ method: 'POST', url: '/auth/login', payload: 'no-es-json', headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: 'bad_request' });
  });
});

describe('n8n: no sigue redirecciones (los secretos van en cabeceras propias)', () => {
  let redirector: Server, target: Server;
  let targetHits: { url: string; headers: Record<string, unknown> }[] = [];
  let redirectorBase = '';

  beforeAll(async () => {
    target = createServer((req, res) => { targetHits.push({ url: req.url!, headers: req.headers }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const targetBase = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
    redirector = createServer((req, res) => { res.writeHead(302, { location: `${targetBase}${req.url}` }); res.end(); });
    await new Promise<void>((r) => redirector.listen(0, '127.0.0.1', r));
    redirectorBase = `http://127.0.0.1:${(redirector.address() as AddressInfo).port}`;
  });
  afterAll(() => { redirector.close(); target.close(); });

  it('ante un 302 devuelve n8n_unavailable y no reenvía la clave al destino', async () => {
    targetHits = [];
    const { call } = await setup({ n8n: { baseUrl: redirectorBase, apiKey: 'k'.repeat(30), triggerSecret: 't'.repeat(40) } });
    const r = await call('GET', '/n8n/workflows');
    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({ error: 'n8n_unavailable' });
    expect(targetHits).toHaveLength(0);
  });
});

describe('CORS: todos los métodos que usa la web están permitidos (un navegador bloquea el resto)', () => {
  // Las pruebas con inject() no pasan por CORS; este es el único sitio donde se comprueba.
  const routes: [string, string][] = [
    ['GET', '/items'], ['POST', '/items'], ['PATCH', '/items/x'], ['DELETE', '/items/x'],
    ['PUT', '/voice'], ['POST', '/voice/examples'], ['DELETE', '/voice/examples/x'],
  ];
  it.each(routes)('%s %s', async (method, url) => {
    const { app } = await setup();
    const r = await app.inject({ method: 'OPTIONS', url, headers: { origin: 'http://localhost:3000', 'access-control-request-method': method } });
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(String(r.headers['access-control-allow-methods']).split(',').map((m) => m.trim())).toContain(method);
    expect(r.headers['access-control-allow-credentials']).toBe('true');
  });
  it('un origen ajeno no recibe permiso', async () => {
    const { app } = await setup();
    const r = await app.inject({ method: 'OPTIONS', url: '/voice', headers: { origin: 'https://evil.example', 'access-control-request-method': 'PUT' } });
    expect(r.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
});
