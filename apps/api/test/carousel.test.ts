import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
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
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => app.inject({ method, url, payload, headers: { cookie } });
const make = async (extra: object = {}) => (await call('POST', '/items', { title: 'Carrusel', format: 'carousel', ...extra })).json();

describe('seguimiento de CarruselOS (2.6)', () => {
  it('una tarjeta nueva no tiene carpeta ni estado', async () => {
    const it = await make();
    expect(it.carousel_folder).toBeNull();
    expect(it.carousel_state).toBeNull();
  });

  it('se puede crear y editar carpeta y estado', async () => {
    const it = await make({ carousel_folder: '2026-09-29-formula-buen-prompt', carousel_state: 'borradores' });
    expect(it).toMatchObject({ carousel_folder: '2026-09-29-formula-buen-prompt', carousel_state: 'borradores' });
    const r = await call('PATCH', `/items/${it.id}`, { carousel_state: 'exportado' });
    expect(r.json()).toMatchObject({ carousel_folder: '2026-09-29-formula-buen-prompt', carousel_state: 'exportado' });
    const clr = await call('PATCH', `/items/${it.id}`, { carousel_folder: null, carousel_state: null });
    expect(clr.json()).toMatchObject({ carousel_folder: null, carousel_state: null });
  });

  it.each(['../secreto', 'a/b', 'a b', '.oculta', '', '..', 'x'.repeat(101), 'a\\b'])('rechaza carpeta %j', async (folder) => {
    const it = await make();
    expect((await call('PATCH', `/items/${it.id}`, { carousel_folder: folder })).statusCode).toBe(400);
    expect((await call('POST', '/items', { title: 'x', carousel_folder: folder })).statusCode).toBe(400);
  });

  it('rechaza un estado que no existe', async () => {
    const it = await make();
    expect((await call('PATCH', `/items/${it.id}`, { carousel_state: 'listo' })).statusCode).toBe(400);
  });

  it('cambiar el estado del carrusel NO aprueba ni publica en AndyOS', async () => {
    const it = await make({ hook: 'Un hook' });
    await call('PATCH', `/items/${it.id}`, { carousel_state: 'aprobado' });
    const r = await call('PATCH', `/items/${it.id}`, { carousel_state: 'publicado' });
    expect(r.json()).toMatchObject({ status: 'idea', approved_at: null });
    // y no puede saltarse la compuerta de AndyOS
    expect((await call('PATCH', `/items/${it.id}`, { status: 'programado', carousel_state: 'publicado' })).statusCode).toBe(409);
  });

  it('cambiar el estado no retira una aprobación ya dada (no es contenido)', async () => {
    const it = await make({ hook: 'Un hook', status: 'aprobacion' });
    expect((await call('POST', `/items/${it.id}/approve`)).statusCode).toBe(200);
    const r = await call('PATCH', `/items/${it.id}`, { carousel_state: 'preview', carousel_folder: 'proyecto-1' });
    expect(r.json().approved_at).not.toBeNull();
  });

  it('migración: una base anterior sin las columnas se actualiza sin perder datos', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'andyos-')), 'old.db');
    const a = openDb(file);
    a.prepare("INSERT INTO work_items (id, type, title, status, created_at, updated_at) VALUES ('1','content','Viejo','idea','t','t')").run();
    a.prepare("INSERT INTO content_details (work_item_id, hook) VALUES ('1','hook viejo')").run();
    a.close();
    const raw = new Database(file);
    raw.exec('ALTER TABLE content_details DROP COLUMN carousel_folder; ALTER TABLE content_details DROP COLUMN carousel_state;');
    raw.close();
    const b = openDb(file);
    const row = b.prepare('SELECT hook, carousel_folder, carousel_state FROM content_details WHERE work_item_id = ?').get('1');
    expect(row).toEqual({ hook: 'hook viejo', carousel_folder: null, carousel_state: null });
    b.close();
  });
});
