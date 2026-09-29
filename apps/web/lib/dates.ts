/** Utilidades de fechas en hora local. Claves de día: "YYYY-MM-DD". */

const pad = (n: number) => String(n).padStart(2, '0');

export const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseKey = (k: string): Date => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Lunes de la semana de `d`. */
export const startOfWeek = (d: Date): Date => addDays(d, -((d.getDay() + 6) % 7));

export function weekDays(anchor: Date): Date[] {
  const s = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

/** Cuadrícula del mes: semanas completas (lunes a domingo) que cubren el mes de `anchor`. */
export function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const start = startOfWeek(first);
  const end = addDays(startOfWeek(last), 6);
  const out: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Offset local en formato ISO, p. ej. "-05:00". */
function offset(d: Date): string {
  const m = -d.getTimezoneOffset();
  const sign = m >= 0 ? '+' : '-';
  return `${sign}${pad(Math.floor(Math.abs(m) / 60))}:${pad(Math.abs(m) % 60)}`;
}

/** ISO con offset local para `key` conservando la hora de `previous` (o 09:00 si no había). */
export function moveToDay(key: string, previous: string | null): string {
  const base = previous ? new Date(previous) : null;
  const h = base ? base.getHours() : 9;
  const min = base ? base.getMinutes() : 0;
  const d = parseKey(key);
  d.setHours(h, min, 0, 0);
  return `${key}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${offset(d)}`;
}

/** Para <input type="datetime-local">. */
export function toInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromInputValue(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return `${v.length === 16 ? `${v}:00` : v}${offset(d)}`;
}
