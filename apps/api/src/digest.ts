import type { Db } from './db.js';
import type { Notify } from './notify.js';

export interface DigestCfg { tz: string; hour: number }

const DAY = 86_400_000;
export const STALE_APPROVAL_DAYS = 3; // días esperando tu aprobación antes de avisar
export const NEAR_DAYS = 2;           // avisar de fechas objetivo que vencen en ≤ N días (o ya vencidas)
const MAX_PER_SECTION = 5;
const DONE = ['programado', 'publicado', 'analizado'];

/** Fecha (AAAA-MM-DD) y hora locales de un instante en una zona IANA. */
export function localParts(ms: number, tz: string): { date: string; hour: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(ms).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
const dayNum = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) / DAY; };

/** Comprueba que una zona IANA existe (para fallar al arrancar y no en silencio). */
export function validTz(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true; } catch { return false; }
}

const short = (t: string) => (t.length > 60 ? `${t.slice(0, 57)}…` : t);
const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

function section(title: string, lines: string[]): string {
  const shown = lines.slice(0, MAX_PER_SECTION).map((l) => `• ${l}`);
  if (lines.length > MAX_PER_SECTION) shown.push(`… y ${lines.length - MAX_PER_SECTION} más`);
  return `${title} (${lines.length})\n${shown.join('\n')}`;
}

/** Texto del resumen o null si no hay nada que avisar. Solo lee. */
export function buildDigest(db: Db, nowMs: number, tz: string): string | null {
  const today = dayNum(localParts(nowMs, tz).date);
  const rows = db.prepare(`
    SELECT w.title, w.status, w.updated_at, c.scheduled_at, c.approved_at
    FROM work_items w JOIN content_details c ON c.work_item_id = w.id
    WHERE w.type = 'content' AND w.archived_at IS NULL`).all() as
    { title: string; status: string; updated_at: string; scheduled_at: string | null; approved_at: string | null }[];

  const near: { d: number; line: string }[] = [];
  const waiting: { age: number; line: string }[] = [];
  const passed: { d: number; line: string }[] = [];
  for (const r of rows) {
    const sched = r.scheduled_at ? Date.parse(r.scheduled_at) : NaN;
    if (!DONE.includes(r.status) && Number.isFinite(sched)) {
      const d = dayNum(localParts(sched, tz).date) - today;
      if (d <= NEAR_DAYS) {
        const when = d < 0 ? `vencida hace ${plural(-d, 'día', 'días')}` : d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`;
        near.push({ d, line: `${short(r.title)}: fecha objetivo ${when} (está en ${r.status})` });
      }
    }
    if (r.status === 'aprobacion' && !r.approved_at) {
      const age = Math.floor((nowMs - Date.parse(r.updated_at)) / DAY);
      if (age >= STALE_APPROVAL_DAYS) waiting.push({ age, line: `${short(r.title)}: lleva ${plural(age, 'día', 'días')} esperando tu aprobación` });
    }
    if (r.status === 'programado' && Number.isFinite(sched) && sched < nowMs) {
      const d = today - dayNum(localParts(sched, tz).date);
      passed.push({ d, line: `${short(r.title)}: su fecha ya pasó${d > 0 ? ` (hace ${plural(d, 'día', 'días')})` : ''}; si salió, márcala como publicada` });
    }
  }
  const parts = [
    near.length && section('⏰ Fechas objetivo cerca', near.sort((a, b) => a.d - b.d).map((x) => x.line)),
    waiting.length && section('📝 Esperando tu aprobación', waiting.sort((a, b) => b.age - a.age).map((x) => x.line)),
    passed.length && section('📅 Programadas que ya pasaron', passed.sort((a, b) => b.d - a.d).map((x) => x.line)),
  ].filter(Boolean) as string[];
  return parts.length ? `Resumen del día\n\n${parts.join('\n\n')}` : null;
}

export type DigestOutcome = 'sent' | 'empty' | 'not_due' | 'already_done';

/**
 * Como mucho un resumen por día local, cuando ya pasó la hora configurada.
 * Se marca el día ANTES de enviar: un aviso perdido no se repite (el aviso es de mejor esfuerzo).
 */
export function runDigestIfDue(db: Db, cfg: DigestCfg, notify: Notify, nowMs: number): DigestOutcome {
  const { date, hour } = localParts(nowMs, cfg.tz);
  if (hour < cfg.hour) return 'not_due';
  const last = (db.prepare("SELECT value FROM app_meta WHERE key = 'digest_last'").get() as { value: string } | undefined)?.value;
  if (last === date) return 'already_done';
  db.prepare("INSERT INTO app_meta (key, value) VALUES ('digest_last', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(date);
  const text = buildDigest(db, nowMs, cfg.tz);
  if (!text) return 'empty';
  notify({ type: 'digest', message: text });
  return 'sent';
}

/** Comprobación cada 10 min; sobrevive a reinicios porque el día ya enviado se guarda en la base. */
export function startDigest(db: Db, cfg: DigestCfg, notify: Notify, now: () => number = Date.now): NodeJS.Timeout {
  const tick = () => { try { runDigestIfDue(db, cfg, notify, now()); } catch (e) { console.error('[digest]', (e as Error).message); } };
  tick();
  const t = setInterval(tick, 10 * 60_000);
  t.unref();
  return t;
}
