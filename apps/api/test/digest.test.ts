import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { insertContent } from '../src/content.js';
import { openDb, type Db } from '../src/db.js';
import { buildDigest, localParts, runDigestIfDue, validTz } from '../src/digest.js';
import type { AlertEvent } from '../src/notify.js';

const TZ = 'America/Mexico_City'; // UTC-6 todo el año
const at = (iso: string) => Date.parse(iso);
const NOW = at('2026-10-05T15:00:00Z'); // lunes 09:00 local
let db: Db;
let sent: AlertEvent[];
const notify = (e: AlertEvent) => { sent.push(e); };
const cfg = { tz: TZ, hour: 9 };

const card = (title: string, status: string, extra: { scheduled_at?: string; updated?: string; approved?: boolean; archived?: boolean; type?: string } = {}) => {
  const id = insertContent(db, { title, status, notes: '', tags: [], scheduled_at: extra.scheduled_at ?? null });
  if (extra.updated) db.prepare('UPDATE work_items SET updated_at = ? WHERE id = ?').run(extra.updated, id);
  if (extra.approved) db.prepare('UPDATE content_details SET approved_at = ? WHERE work_item_id = ?').run('2026-10-01T00:00:00Z', id);
  if (extra.archived) db.prepare('UPDATE work_items SET archived_at = ? WHERE id = ?').run('2026-10-01T00:00:00Z', id);
  if (extra.type) db.prepare('UPDATE work_items SET type = ? WHERE id = ?').run(extra.type, id);
  return id;
};
beforeEach(() => { db = openDb(':memory:'); sent = []; });

describe('zona horaria', () => {
  it('calcula fecha y hora locales (no las del servidor)', () => {
    expect(localParts(at('2026-10-05T04:30:00Z'), TZ)).toEqual({ date: '2026-10-04', hour: 22 });
    expect(localParts(at('2026-10-05T15:00:00Z'), TZ)).toEqual({ date: '2026-10-05', hour: 9 });
    expect(localParts(at('2026-10-05T00:00:00Z'), 'UTC')).toEqual({ date: '2026-10-05', hour: 0 });
  });
  it('valida zonas IANA', () => { expect(validTz(TZ)).toBe(true); expect(validTz('Marte/Olimpo')).toBe(false); });
});

describe('contenido del resumen', () => {
  it('sin nada que avisar → null', () => {
    card('Lejos', 'idea', { scheduled_at: '2026-11-30T18:00:00Z' });
    card('Sin fecha', 'guion');
    expect(buildDigest(db, NOW, TZ)).toBeNull();
  });

  it('fechas objetivo: vencida, hoy, mañana, en 2 días; no las de 3+ días', () => {
    card('Vencida', 'guion', { scheduled_at: '2026-10-03T18:00:00Z' });
    card('De hoy', 'edicion', { scheduled_at: '2026-10-05T23:00:00Z' });
    card('De mañana', 'hook', { scheduled_at: '2026-10-06T18:00:00Z' });
    card('En dos', 'idea', { scheduled_at: '2026-10-07T18:00:00Z' });
    card('En tres', 'idea', { scheduled_at: '2026-10-08T18:00:00Z' });
    const t = buildDigest(db, NOW, TZ)!;
    expect(t).toContain('vencida hace 2 días');
    expect(t).toMatch(/De hoy: fecha objetivo hoy/);
    expect(t).toMatch(/De mañana: fecha objetivo mañana/);
    expect(t).toMatch(/En dos: fecha objetivo en 2 días/);
    expect(t).not.toContain('En tres');
    expect(t.indexOf('Vencida')).toBeLessThan(t.indexOf('De hoy')); // ordenadas por urgencia
  });

  it('usa el día LOCAL: 22:00 del domingo local es «vencida», aunque en UTC ya sea lunes', () => {
    card('Cerca de medianoche', 'guion', { scheduled_at: '2026-10-05T04:30:00Z' }); // domingo 22:30 local
    expect(buildDigest(db, NOW, TZ)).toContain('vencida hace 1 día');
  });

  it('las ya programadas/publicadas no cuentan como «fecha cerca»', () => {
    card('Ya programada', 'programado', { scheduled_at: '2026-10-06T18:00:00Z', approved: true });
    card('Ya publicada', 'publicado', { scheduled_at: '2026-10-03T18:00:00Z', approved: true });
    expect(buildDigest(db, NOW, TZ)).toBeNull();
  });

  it('esperando aprobación: solo tras 3 días y sin aprobar', () => {
    card('Vieja', 'aprobacion', { updated: '2026-10-01T15:00:00Z' });
    card('Reciente', 'aprobacion', { updated: '2026-10-04T15:00:00Z' });
    card('Ya aprobada', 'aprobacion', { updated: '2026-10-01T15:00:00Z', approved: true });
    const t = buildDigest(db, NOW, TZ)!;
    expect(t).toContain('Vieja: lleva 4 días esperando tu aprobación');
    expect(t).not.toContain('Reciente');
    expect(t).not.toContain('Ya aprobada');
  });

  it('programadas cuya fecha ya pasó', () => {
    card('Salió?', 'programado', { scheduled_at: '2026-10-03T18:00:00Z', approved: true });
    card('Futura', 'programado', { scheduled_at: '2026-10-09T18:00:00Z', approved: true });
    const t = buildDigest(db, NOW, TZ)!;
    expect(t).toContain('Salió?: su fecha ya pasó (hace 2 días)');
    expect(t).not.toContain('Futura');
  });

  it('ignora archivadas y tarjetas que no son contenido', () => {
    card('Archivada', 'guion', { scheduled_at: '2026-10-03T18:00:00Z', archived: true });
    card('Una idea', 'idea', { scheduled_at: '2026-10-03T18:00:00Z', type: 'idea' });
    expect(buildDigest(db, NOW, TZ)).toBeNull();
  });

  it('limita cada sección a 5 líneas y recorta títulos largos', () => {
    for (let i = 0; i < 8; i++) card(`T${i} ${'x'.repeat(100)}`, 'guion', { scheduled_at: '2026-10-03T18:00:00Z' });
    const t = buildDigest(db, NOW, TZ)!;
    expect(t.split('\n').filter((l) => l.startsWith('• ')).length).toBe(5);
    expect(t).toContain('… y 3 más');
    expect(t).toContain('…: fecha');
  });
});

describe('envío una vez al día', () => {
  beforeEach(() => { card('Vencida', 'guion', { scheduled_at: '2026-10-03T18:00:00Z' }); });

  it('antes de la hora no envía; después envía una vez; no repite ese día; sí al día siguiente', () => {
    expect(runDigestIfDue(db, cfg, notify, at('2026-10-05T14:59:00Z'))).toBe('not_due'); // 08:59 local
    expect(runDigestIfDue(db, cfg, notify, NOW)).toBe('sent');
    expect(runDigestIfDue(db, cfg, notify, NOW + 3_600_000)).toBe('already_done');
    expect(runDigestIfDue(db, cfg, notify, NOW + 5 * 3_600_000)).toBe('already_done');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'digest' });
    expect(sent[0].message).toContain('Vencida');
    expect(runDigestIfDue(db, cfg, notify, NOW + 86_400_000)).toBe('sent');
    expect(sent).toHaveLength(2);
  });

  it('un reinicio del proceso el mismo día no duplica (el día se guarda en la base)', () => {
    runDigestIfDue(db, cfg, notify, NOW);
    expect(runDigestIfDue(db, cfg, notify, NOW + 60_000)).toBe('already_done'); // «proceso nuevo», misma base
    expect(sent).toHaveLength(1);
  });

  it('si no hay nada, no envía nada (y no insiste ese día)', () => {
    db.prepare("UPDATE work_items SET archived_at = 'x'").run();
    expect(runDigestIfDue(db, cfg, notify, NOW)).toBe('empty');
    card('Aparece luego', 'guion', { scheduled_at: '2026-10-03T18:00:00Z' });
    expect(runDigestIfDue(db, cfg, notify, NOW + 3_600_000)).toBe('already_done');
    expect(sent).toHaveLength(0);
  });
});

describe('rutas', () => {
  const base = { password: 'pw-de-prueba', sessionSecret: 'x'.repeat(40), webOrigin: 'http://localhost:3000', secureCookie: false, inboxSecret: 'i'.repeat(40) };
  const login = async (app: Awaited<ReturnType<typeof buildApp>>) =>
    ((await app.inject({ method: 'POST', url: '/auth/login', payload: { password: base.password } })).headers['set-cookie'] as string).split(';')[0];

  it('sin DIGEST no existen; con él exigen sesión', async () => {
    const off = await buildApp(openDb(':memory:'), base);
    expect((await off.inject({ method: 'GET', url: '/digest', headers: { cookie: await login(off) } })).statusCode).toBe(404);
    const on = await buildApp(openDb(':memory:'), { ...base, digest: cfg, now: () => NOW });
    expect((await on.inject({ method: 'GET', url: '/digest' })).statusCode).toBe(401);
    expect((await on.inject({ method: 'POST', url: '/digest/send' })).statusCode).toBe(401);
  });

  it('vista previa sin enviar; envío de prueba pide avisos configurados', async () => {
    const d = openDb(':memory:');
    insertContent(d, { title: 'Vencida', status: 'guion', notes: '', tags: [], scheduled_at: '2026-10-03T18:00:00Z' });
    const app = await buildApp(d, { ...base, digest: cfg, now: () => NOW });
    const cookie = await login(app);
    const g = (await app.inject({ method: 'GET', url: '/digest', headers: { cookie } })).json();
    expect(g.text).toContain('Vencida');
    expect((await app.inject({ method: 'POST', url: '/digest/send', headers: { cookie } })).statusCode).toBe(409);
  });

  it('envío de prueba manda el aviso al webhook con el secreto y sin marcar el día', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, i) => { calls.push({ url: String(u), init: i ?? {} }); return new Response('ok'); });
    try {
      const d = openDb(':memory:');
      const app = await buildApp(d, { ...base, digest: cfg, now: () => NOW, alert: { url: 'https://n8n.example/webhook/x', secret: 's'.repeat(32) } });
      const r = await app.inject({ method: 'POST', url: '/digest/send', headers: { cookie: await login(app) } });
      expect(r.statusCode).toBe(200);
      await new Promise((res) => setTimeout(res, 20));
      const hit = calls.find((c) => c.url === 'https://n8n.example/webhook/x')!;
      expect((hit.init.headers as Record<string, string>)['x-webhook-secret']).toBe('s'.repeat(32));
      expect(JSON.parse(hit.init.body as string)).toMatchObject({ source: 'andyos', type: 'digest' });
      expect(d.prepare("SELECT COUNT(*) c FROM app_meta WHERE key = 'digest_last'").get()).toEqual({ c: 0 });
    } finally { spy.mockRestore(); }
  });
});
