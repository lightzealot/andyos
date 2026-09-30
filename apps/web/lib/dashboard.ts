import type { Idea, Item, QueueInfo } from './api';

/** Fecha local AAAA-MM-DD (el día del usuario, no el del servidor). */
export const dayKey = (d: Date | number | string) => {
  const x = new Date(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};
const DAY = 86_400_000;
const num = (k: string) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
/** Días completos entre dos fechas locales (b - a). */
export const daysBetween = (a: string, b: string) => num(b) - num(a);

const DONE = ['programado', 'publicado', 'analizado'];
const PUBLISHED = ['publicado', 'analizado'];

/** Últimos `n` días (el último es hoy) con la cantidad de fechas que caen en cada uno. */
export function perDay(dates: (string | undefined | null)[], n: number, now: number): { key: string; count: number }[] {
  const keys = Array.from({ length: n }, (_, i) => dayKey(now - (n - 1 - i) * DAY));
  const map = new Map(keys.map((k) => [k, 0]));
  for (const d of dates) { if (!d) continue; const k = dayKey(d); if (map.has(k)) map.set(k, map.get(k)! + 1); }
  return keys.map((key) => ({ key, count: map.get(key)! }));
}

export interface UpcomingItem { id: string; title: string; format: string | null; scheduled_at: string; days: number; status: string }

export interface Summary {
  ideasNew: number;
  ideasPerDay: number[];
  waiting: number;               // en Aprobación, sin aprobar
  waitingOldestDays: number | null;
  activityPerDay: number[];      // ideas creadas + tarjetas modificadas
  overdue: number;               // fecha objetivo vencida y sin programar
  upcoming: UpcomingItem[];      // con fecha desde hoy, aún no publicadas, por fecha
  next: UpcomingItem | null;
  pipeline: Item[];              // hasta 3 tarjetas más avanzadas sin cerrar
  totals: { cards: number; ideas: number; published: number };
  calendar: Map<string, 'today' | 'scheduled' | 'overdue'>;
  queue: { day: number; max: number; five: number | null; week: number | null; paused: boolean } | null;
  attention: number;             // cosas que piden acción (para el punto de la campana)
}

const ORDER = ['aprobacion', 'edicion', 'produccion', 'guion', 'hook'];

export function summarize(items: Item[], ideas: Idea[], queue: QueueInfo | null, now: number, days = 30): Summary {
  const today = dayKey(now);
  const live = items.filter((i) => !PUBLISHED.includes(i.status));
  const ideasNew = ideas.filter((i) => i.status === 'nueva');

  const waitingItems = items.filter((i) => i.status === 'aprobacion' && !i.approved_at);
  const ages = waitingItems.map((i) => Math.floor((now - Date.parse(i.updated_at)) / DAY));

  const upcoming: UpcomingItem[] = [];
  let overdue = 0;
  const calendar = new Map<string, 'today' | 'scheduled' | 'overdue'>();
  for (const i of items) {
    if (!i.scheduled_at) continue;
    const k = dayKey(i.scheduled_at);
    const d = daysBetween(today, k);
    const pub = PUBLISHED.includes(i.status);
    if (!pub && !DONE.includes(i.status) && d < 0) overdue++;
    if (!pub && d >= 0) upcoming.push({ id: i.id, title: i.title, format: i.format, scheduled_at: i.scheduled_at, days: d, status: i.status });
    // el calendario marca todas las fechas; «vencida» pisa a «programada»
    const kind = !pub && !DONE.includes(i.status) && d < 0 ? 'overdue' : 'scheduled';
    if (calendar.get(k) !== 'overdue') calendar.set(k, kind);
  }
  upcoming.sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
  calendar.set(today, calendar.get(today) === 'overdue' ? 'overdue' : 'today');

  const pipeline = [...live].filter((i) => ORDER.includes(i.status))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || (a.scheduled_at ?? '9').localeCompare(b.scheduled_at ?? '9')).slice(0, 3);

  const st = queue?.state;
  const q = queue && st ? {
    day: queue.counters.day, max: st.max_per_day, paused: st.paused,
    // una ventana ya vencida no cuenta
    five: st.usage_snapshot?.five_hour && st.usage_snapshot.five_hour.resetsAt * 1000 > now ? Math.round(st.usage_snapshot.five_hour.utilization * 100) : null,
    week: st.usage_snapshot?.seven_day && st.usage_snapshot.seven_day.resetsAt * 1000 > now ? Math.round(st.usage_snapshot.seven_day.utilization * 100) : null,
  } : null;

  return {
    ideasNew: ideasNew.length,
    ideasPerDay: perDay(ideas.map((i) => i.created_at), 10, now).map((x) => x.count),
    waiting: waitingItems.length,
    waitingOldestDays: ages.length ? Math.max(...ages) : null,
    activityPerDay: perDay([...ideas.map((i) => i.created_at), ...items.map((i) => i.updated_at)], days, now).map((x) => x.count),
    overdue, upcoming, next: upcoming[0] ?? null, pipeline,
    totals: { cards: items.length, ideas: ideasNew.length, published: items.filter((i) => PUBLISHED.includes(i.status)).length },
    calendar, queue: q,
    attention: overdue + waitingItems.length,
  };
}

/** Puntos de una curva suave (Catmull-Rom → Bézier) para el gráfico de actividad. */
export function smoothPath(vals: number[], w: number, h: number, pad = 8): { line: string; area: string; pts: { x: number; y: number }[] } {
  const max = Math.max(1, ...vals);
  const pts = vals.map((v, i) => ({ x: pad + (i * (w - 2 * pad)) / Math.max(1, vals.length - 1), y: h - pad - (v / max) * (h - 2 * pad) }));
  if (pts.length < 2) return { line: '', area: '', pts };
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return { line: d, area: `${d} L${pts[pts.length - 1].x},${h} L${pts[0].x},${h} Z`, pts };
}

export const greeting = (hour: number) => (hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches');
export const whenLabel = (days: number) => (days === 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} días`);
