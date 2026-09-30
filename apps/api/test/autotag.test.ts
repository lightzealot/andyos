import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { MAX_QUEUED } from '../src/queue.js';

const WORKER = 'w'.repeat(40);
const INBOX = 'i'.repeat(40);
let ctx: Awaited<ReturnType<typeof setup>>;

async function setup(withAi = true) {
  const db = openDb(':memory:');
  const app = await buildApp(db, {
    password: 'pw', sessionSecret: 'x'.repeat(40), webOrigin: 'http://localhost:3000', secureCookie: false,
    inboxSecret: INBOX, workerToken: withAi ? WORKER : undefined,
  });
  const cookie = ((await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'pw' } })).headers['set-cookie'] as string).split(';')[0];
  type M = 'GET' | 'POST' | 'PATCH';
  const user = (method: M, url: string, payload?: object) => app.inject({ method, url, payload, headers: { cookie } });
  const worker = (url: string, payload: object = {}) => app.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${WORKER}` } });
  const telegram = (text: string, id: string) => app.inject({ method: 'POST', url: '/webhooks/inbox', payload: { text, source_id: id }, headers: { 'x-webhook-secret': INBOX } });
  const ideas = async () => (await user('GET', '/ideas')).json().ideas as { id: string; tags: string[]; suggestion: null | { job_id: string; status: string; tags?: string[]; error_class?: string } }[];
  /** Simula al worker: reclama el trabajo y devuelve un resultado o un fallo. */
  const work = async (out: { tags: string[] } | { fail: string }) => {
    const c = (await worker('/worker/claim', { providers: ['claude'] })).json();
    if ('fail' in out) await worker(`/worker/jobs/${c.job.id}/failure`, { error_class: out.fail, error: 'x' });
    else await worker(`/worker/jobs/${c.job.id}/result`, { output: out, provider: 'claude', model: 'claude-sonnet-5-5' });
    return c.job.id as string;
  };
  return { app, db, user, worker, telegram, ideas, work };
}
beforeEach(async () => { ctx = await setup(); });

describe('etiquetado automático de ideas', () => {
  it('una idea nueva (web o Telegram) encola sola su sugerencia', async () => {
    await ctx.user('POST', '/ideas', { text: 'idea web' });
    await ctx.telegram('idea telegram', '1:1');
    const q = (await ctx.user('GET', '/ai/queue')).json();
    expect(q.counters.queued).toBe(2);
    expect((await ctx.ideas()).every((i) => i.suggestion?.status === 'queued')).toBe(true);
  });
  it('un reintento de Telegram (mismo mensaje) NO encola dos veces', async () => {
    await ctx.telegram('idea', '7:7'); await ctx.telegram('idea', '7:7');
    expect((await ctx.user('GET', '/ai/queue')).json().counters.queued).toBe(1);
  });
  it('se puede desactivar y volver a activar', async () => {
    expect((await ctx.user('PATCH', '/ai/queue', { auto_tag: false })).json().state.auto_tag).toBe(false);
    await ctx.user('POST', '/ideas', { text: 'sin ia' });
    expect((await ctx.user('GET', '/ai/queue')).json().counters.queued).toBe(0);
    await ctx.user('PATCH', '/ai/queue', { auto_tag: true });
    await ctx.user('POST', '/ideas', { text: 'con ia' });
    expect((await ctx.user('GET', '/ai/queue')).json().counters.queued).toBe(1);
  });
  it('sin el módulo de IA las ideas se guardan igual y no hay sugerencias', async () => {
    const off = await setup(false);
    expect((await off.user('POST', '/ideas', { text: 'x' })).statusCode).toBe(201);
    expect((await off.ideas())[0].suggestion).toBeNull();
  });
  it('con la cola llena o la IA pausada, la idea SE GUARDA de todos modos', async () => {
    for (let i = 0; i < MAX_QUEUED; i++) await ctx.user('POST', '/ideas', { text: `idea ${i}` });
    const r = await ctx.telegram('una más', '9:9');
    expect(r.statusCode).toBe(201);
    expect((await ctx.ideas()).length).toBe(MAX_QUEUED + 1);
    const c2 = await setup(); await c2.user('PATCH', '/ai/queue', { paused: true });
    expect((await c2.user('POST', '/ideas', { text: 'x' })).statusCode).toBe(201);
  });
  it('un fallo al encolar no rompe la creación (base con la tabla de la cola inutilizable)', async () => {
    ctx.db.exec('DROP TABLE ai_jobs');
    expect((await ctx.user('POST', '/ideas', { text: 'sigo guardándome' })).statusCode).toBe(201);
  });
});

describe('sugerencia → decisión humana', () => {
  it('ciclo de vida visible: en cola → lista con etiquetas → (nada tras decidir)', async () => {
    await ctx.user('POST', '/ideas', { text: 'Reel de n8n' });
    expect((await ctx.ideas())[0].suggestion).toMatchObject({ status: 'queued' });
    const jobId = await ctx.work({ tags: ['n8n', 'instagram', 'automatizacion'] });
    const sug = (await ctx.ideas())[0].suggestion!;
    expect(sug).toMatchObject({ job_id: jobId, status: 'done', tags: ['n8n', 'instagram', 'automatizacion'] });
    expect((await ctx.ideas())[0].tags).toEqual([]);                       // borrador: la idea no cambia
  });
  it('aceptar todo aplica las etiquetas y la sugerencia desaparece', async () => {
    await ctx.user('POST', '/ideas', { text: 'x' }); const j = await ctx.work({ tags: ['a', 'b'] });
    expect((await ctx.user('POST', `/ai/jobs/${j}/accept`)).statusCode).toBe(200);
    const i = (await ctx.ideas())[0]; expect(i.tags).toEqual(['a', 'b']); expect(i.suggestion).toBeNull();
  });
  it('aceptar solo las etiquetas elegidas', async () => {
    await ctx.user('POST', '/ideas', { text: 'x' }); const j = await ctx.work({ tags: ['a', 'b', 'c'] });
    expect((await ctx.user('POST', `/ai/jobs/${j}/accept`, { tags: ['a', 'c'] })).statusCode).toBe(200);
    expect((await ctx.ideas())[0].tags).toEqual(['a', 'c']);
  });
  it('no se puede colar una etiqueta que la IA no propuso, ni una selección vacía', async () => {
    await ctx.user('POST', '/ideas', { text: 'x' }); const j = await ctx.work({ tags: ['a', 'b'] });
    expect((await ctx.user('POST', `/ai/jobs/${j}/accept`, { tags: ['a', 'inventada'] })).statusCode).toBe(400);
    expect((await ctx.user('POST', `/ai/jobs/${j}/accept`, { tags: [] })).statusCode).toBe(400);
    expect((await ctx.user('POST', `/ai/jobs/${j}/accept`, { tags: ['a'], extra: 1 })).statusCode).toBe(400);
    expect((await ctx.ideas())[0].tags).toEqual([]);                       // nada se aplicó
  });
  it('ignorar descarta el borrador sin tocar la idea; no se puede aceptar después ni decidir dos veces', async () => {
    await ctx.user('POST', '/ideas', { text: 'x' }); const j = await ctx.work({ tags: ['a'] });
    expect((await ctx.user('POST', `/ai/jobs/${j}/dismiss`)).statusCode).toBe(200);
    const i = (await ctx.ideas())[0]; expect(i.tags).toEqual([]); expect(i.suggestion).toBeNull();
    expect((await ctx.user('POST', `/ai/jobs/${j}/accept`)).statusCode).toBe(409);
    expect((await ctx.user('POST', `/ai/jobs/${j}/dismiss`)).statusCode).toBe(409);
  });
  it('no se puede ignorar algo ya aceptado, ni aceptar dos veces', async () => {
    await ctx.user('POST', '/ideas', { text: 'x' }); const j = await ctx.work({ tags: ['a'] });
    await ctx.user('POST', `/ai/jobs/${j}/accept`);
    expect((await ctx.user('POST', `/ai/jobs/${j}/dismiss`)).statusCode).toBe(409);
    expect((await ctx.user('POST', `/ai/jobs/${j}/accept`)).statusCode).toBe(409);
  });
  it('si la IA falla, se ve como fallido y se puede pedir de nuevo (sin duplicar mientras haya uno pendiente)', async () => {
    await ctx.user('POST', '/ideas', { text: 'x' }); await ctx.work({ fail: 'permanent' });
    const i = (await ctx.ideas())[0];
    expect(i.suggestion).toMatchObject({ status: 'failed', error_class: 'permanent' });
    const again = await ctx.user('POST', '/ai/jobs', { task: 'tag_idea', input: { idea_id: i.id } });
    expect(again.statusCode).toBe(201);
    expect((await ctx.user('POST', '/ai/jobs', { task: 'tag_idea', input: { idea_id: i.id } })).json().duplicate).toBe(true);
    expect((await ctx.ideas())[0].suggestion).toMatchObject({ status: 'queued' });
  });
  it('solo se sugiere para ideas nuevas; una promovida ya no muestra sugerencia', async () => {
    await ctx.user('POST', '/ideas', { text: 'x' }); await ctx.work({ tags: ['a'] });
    const id = (await ctx.ideas())[0].id;
    await ctx.user('POST', `/ideas/${id}/promote`, {});
    expect((await ctx.ideas())[0].suggestion).toBeNull();
  });
  it('exige sesión para aceptar/ignorar y el token del worker no vale', async () => {
    await ctx.user('POST', '/ideas', { text: 'x' }); const j = await ctx.work({ tags: ['a'] });
    expect((await ctx.app.inject({ method: 'POST', url: `/ai/jobs/${j}/accept` })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'POST', url: `/ai/jobs/${j}/dismiss`, headers: { authorization: `Bearer ${WORKER}` } })).statusCode).toBe(401);
  });
});

describe('migración de la base existente (producción ya tiene datos)', () => {
  it('añade las columnas nuevas sin perder datos ni fallar si se repite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'andyos-mig-'));
    const file = join(dir, 'old.db');
    // Esquema ANTERIOR: sin auto_tag ni dismissed_at, con datos
    const old = new Database(file);
    old.exec(`CREATE TABLE work_items (id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'content', title TEXT NOT NULL, status TEXT NOT NULL,
              notes TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT);
              CREATE TABLE queue_state (id INTEGER PRIMARY KEY CHECK (id = 1), paused INTEGER NOT NULL DEFAULT 0, paused_reason TEXT, paused_until TEXT,
              max_per_day INTEGER NOT NULL DEFAULT 15, max_per_week INTEGER NOT NULL DEFAULT 60, concurrency INTEGER NOT NULL DEFAULT 1,
              five_hour_pause_at REAL NOT NULL DEFAULT 0.8, seven_day_pause_at REAL NOT NULL DEFAULT 0.85, usage_snapshot TEXT, usage_snapshot_at TEXT, updated_at TEXT);
              INSERT INTO queue_state (id, max_per_day) VALUES (1, 7);
              CREATE TABLE ai_jobs (id TEXT PRIMARY KEY, task TEXT NOT NULL, input TEXT NOT NULL, target_id TEXT, status TEXT NOT NULL,
              requested_provider TEXT NOT NULL DEFAULT 'claude', provider TEXT, model TEXT, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
              not_before TEXT, lease_until TEXT, output TEXT, usage TEXT, error_class TEXT, error TEXT, accepted_at TEXT, created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT);
              INSERT INTO work_items (id, title, status, created_at, updated_at) VALUES ('keep-me', 'dato existente', 'idea', 'x', 'x');`);
    old.close();
    const db = openDb(file);   // migra
    const db2 = openDb(file);  // idempotente
    const cols = (t: string) => (db2.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols('queue_state')).toContain('auto_tag'); expect(cols('ai_jobs')).toContain('dismissed_at');
    expect(db.prepare('SELECT title FROM work_items WHERE id = ?').get('keep-me')).toEqual({ title: 'dato existente' });
    expect(db.prepare('SELECT max_per_day, auto_tag FROM queue_state').get()).toEqual({ max_per_day: 7, auto_tag: 1 });
  });
});
