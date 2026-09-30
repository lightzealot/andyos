import { describe, expect, it } from 'vitest';
import type { Idea, Item, QueueInfo } from '../lib/api';
import { dayKey, greeting, perDay, smoothPath, summarize, whenLabel } from '../lib/dashboard';

const NOW = new Date(2026, 9, 5, 9, 0).getTime(); // lunes 5 oct 2026, hora local
const at = (d: number, h = 12) => new Date(2026, 9, d, h).toISOString();
const item = (o: Partial<Item>): Item => ({
  id: Math.random().toString(36).slice(2), title: 'T', status: 'idea', notes: '', tags: [], platform: null, format: null, hook: '', caption: '',
  script: {}, scheduled_at: null, approved_at: null, ai_generated: false, carousel_folder: null, carousel_state: null, updated_at: at(5), ...o,
});
const idea = (o: Partial<Idea>): Idea => ({ id: 'i', title: 'x', status: 'nueva', notes: '', tags: [], source: 'web', created_at: at(5), suggestion: null, ...o });
const queue = (o: Partial<QueueInfo['state']> = {}, c: Partial<QueueInfo['counters']> = {}): QueueInfo => ({
  state: { paused: false, paused_reason: null, paused_until: null, auto_tag: true, max_per_day: 15, max_per_week: 60, usage_snapshot: null, ...o },
  counters: { day: 4, week: 9, queued: 0, running: 0, ...c },
});

describe('dashboard', () => {
  it('usa el día local y cuenta por día', () => {
    expect(dayKey(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
    const r = perDay([at(5), at(5), at(4), at(1)], 3, NOW);
    expect(r.map((x) => x.key)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05']);
    expect(r.map((x) => x.count)).toEqual([0, 1, 2]);
  });

  it('cuenta ideas nuevas, aprobaciones esperando y la más antigua', () => {
    const s = summarize([
      item({ status: 'aprobacion', updated_at: at(1) }), item({ status: 'aprobacion', updated_at: at(4) }),
      item({ status: 'aprobacion', approved_at: at(2) }),
    ], [idea({}), idea({ status: 'descartada' }), idea({ status: 'promovida' })], null, NOW);
    expect(s.ideasNew).toBe(1);
    expect(s.waiting).toBe(2);
    expect(s.waitingOldestDays).toBe(3);
    expect(s.queue).toBeNull();
  });

  it('próximas, vencidas y calendario', () => {
    const s = summarize([
      item({ title: 'Vencida', status: 'guion', scheduled_at: at(3) }),
      item({ title: 'Mañana', status: 'edicion', scheduled_at: at(6) }),
      item({ title: 'Hoy tarde', status: 'programado', approved_at: at(1), scheduled_at: at(5, 20) }),
      item({ title: 'Publicada', status: 'publicado', approved_at: at(1), scheduled_at: at(2) }),
      item({ title: 'Programada pasada', status: 'programado', approved_at: at(1), scheduled_at: at(4) }),
    ], [], null, NOW);
    expect(s.overdue).toBe(1);                       // solo la que no está programada ni publicada
    expect(s.upcoming.map((u) => u.title)).toEqual(['Hoy tarde', 'Mañana']);
    expect(s.next?.title).toBe('Hoy tarde');
    expect(s.calendar.get('2026-10-03')).toBe('overdue');
    expect(s.calendar.get('2026-10-06')).toBe('scheduled');
    expect(s.calendar.get('2026-10-05')).toBe('today');
    expect(s.attention).toBe(1);
  });

  it('pipeline: lo más avanzado primero, sin publicadas, máximo 3', () => {
    const s = summarize([item({ title: 'a', status: 'hook' }), item({ title: 'b', status: 'aprobacion' }), item({ title: 'c', status: 'edicion' }),
      item({ title: 'd', status: 'guion' }), item({ title: 'p', status: 'publicado' })], [], null, NOW);
    expect(s.pipeline.map((i) => i.title)).toEqual(['b', 'c', 'd']);
  });

  it('cola: cuota vigente sí, ventana vencida no', () => {
    const fut = Math.floor(NOW / 1000) + 3600, past = Math.floor(NOW / 1000) - 60;
    const s = summarize([], [], queue({ paused: true, usage_snapshot: { five_hour: { utilization: 0.35, resetsAt: fut }, seven_day: { utilization: 0.9, resetsAt: past } } }), NOW);
    expect(s.queue).toEqual({ day: 4, max: 15, paused: true, five: 35, week: null });
  });

  it('curva suave: sin datos no rompe y con datos genera puntos dentro del lienzo', () => {
    expect(smoothPath([], 100, 50).line).toBe('');
    const p = smoothPath([0, 5, 2, 8], 300, 100);
    expect(p.pts).toHaveLength(4);
    expect(p.pts.every((q) => q.x >= 0 && q.x <= 300 && q.y >= 0 && q.y <= 100)).toBe(true);
    expect(p.line.startsWith('M')).toBe(true);
    expect(smoothPath([0, 0, 0], 300, 100).pts.every((q) => Number.isFinite(q.y))).toBe(true); // todo cero: sin NaN
  });

  it('saludo y etiquetas', () => {
    expect([greeting(7), greeting(15), greeting(22)]).toEqual(['Buenos días', 'Buenas tardes', 'Buenas noches']);
    expect([whenLabel(0), whenLabel(1), whenLabel(4)]).toEqual(['hoy', 'mañana', 'en 4 días']);
  });
});
