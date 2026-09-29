import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';

const BACKUP = 'b'.repeat(40);
const cfg = {
  password: 'pw', sessionSecret: 'x'.repeat(40), webOrigin: 'http://localhost:3000',
  secureCookie: false, inboxSecret: 'i'.repeat(40), backupSecret: BACKUP,
};
let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;
const dbFile = () => join(mkdtempSync(join(tmpdir(), 'andyos-test-')), 'db.sqlite');

beforeEach(async () => {
  app = await buildApp(openDb(dbFile()), cfg);
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: cfg.password } });
  cookie = (res.headers['set-cookie'] as string).split(';')[0];
});
const get = (headers: Record<string, string> = {}) => app.inject({ method: 'GET', url: '/webhooks/backup', headers });

describe('respaldo', () => {
  it('rechaza sin secreto, con secreto incorrecto y con la cookie de sesión', async () => {
    expect((await get()).statusCode).toBe(401);
    expect((await get({ 'x-webhook-secret': 'incorrecto' })).statusCode).toBe(401);
    expect((await get({ cookie })).statusCode).toBe(401);
    expect((await get({ 'x-webhook-secret': cfg.inboxSecret })).statusCode).toBe(401); // el secreto del Inbox no sirve
  });

  it('no existe si no hay BACKUP_WEBHOOK_SECRET', async () => {
    const off = await buildApp(openDb(dbFile()), { ...cfg, backupSecret: undefined });
    expect((await off.inject({ method: 'GET', url: '/webhooks/backup', headers: { 'x-webhook-secret': BACKUP } })).statusCode).toBe(404);
  });

  it('devuelve una copia gzip que se puede restaurar con todos los datos', async () => {
    const call = (method: 'POST', url: string, payload: object) => app.inject({ method, url, payload, headers: { cookie } });
    await call('POST', '/items', { title: 'Tarjeta A', hook: 'h' });
    await call('POST', '/items', { title: 'Tarjeta B' });
    await call('POST', '/ideas', { text: 'Idea X', tags: ['ia'] });
    await call('POST', '/references', { title: 'Ref Y', why_it_works: 'porque sí' });

    const r = await get({ 'x-webhook-secret': BACKUP });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/gzip');
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="andyos-\d{4}-\d{2}-\d{2}\.db\.gz"$/);

    // Restauración: descomprimir, abrir como base independiente y comparar
    const restored = join(mkdtempSync(join(tmpdir(), 'andyos-restore-')), 'restored.db');
    writeFileSync(restored, gunzipSync(r.rawPayload));
    const db = new Database(restored, { readonly: true });
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    const titles = (db.prepare('SELECT title FROM work_items ORDER BY title').all() as { title: string }[]).map((x) => x.title);
    expect(titles).toEqual(['Idea X', 'Ref Y', 'Tarjeta A', 'Tarjeta B']);
    expect((db.prepare('SELECT hook FROM content_details WHERE hook != ?').get('') as { hook: string }).hook).toBe('h');
    expect((db.prepare('SELECT why_it_works FROM reference_details').get() as { why_it_works: string }).why_it_works).toBe('porque sí');
    db.close();
  });

  it('el respaldo no contiene la cookie ni depende de escrituras posteriores', async () => {
    const r = await get({ 'x-webhook-secret': BACKUP });
    const restored = join(mkdtempSync(join(tmpdir(), 'andyos-restore-')), 'r.db');
    writeFileSync(restored, gunzipSync(r.rawPayload));
    const db = new Database(restored, { readonly: true });
    expect((db.prepare('SELECT COUNT(*) c FROM work_items').get() as { c: number }).c).toBe(0);
    db.close();
  });
});
