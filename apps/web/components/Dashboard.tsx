'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, Idea, Item, QueueInfo, STATUS_LABEL, Status } from '@/lib/api';
import { dayKey, daysBetween, greeting, perDay, summarize, whenLabel } from '@/lib/dashboard';
import { ActivityChart, Gauge, Icon, MiniBars, ORANGE, Pulse, SideNav, StatCard } from './DashboardParts';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fmtShort = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });

export function Dashboard() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [queue, setQueue] = useState<QueueInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<7 | 30>(7);
  const [month, setMonth] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; });
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const [i, d, q] = await Promise.allSettled([
      api<{ items: Item[] }>('/items?type=content'), api<{ ideas: Idea[] }>('/ideas'), api<QueueInfo>('/ai/queue'),
    ]);
    if ([i, d].some((r) => r.status === 'rejected' && r.reason instanceof ApiError && r.reason.status === 401)) { window.location.href = '/login/'; return; }
    if (i.status === 'fulfilled') { setItems(i.value.items); setFailed(false); } else setFailed(true);
    if (d.status === 'fulfilled') setIdeas(d.value.ideas);
    setQueue(q.status === 'fulfilled' ? q.value : null); // sin cola configurada: las tarjetas de IA muestran «—»
    setNow(Date.now());
  }, []);

  useEffect(() => { void load(); const t = setInterval(() => void load(), 60_000); return () => clearInterval(t); }, [load]);

  const s = useMemo(() => summarize(items ?? [], ideas, queue, now, range), [items, ideas, queue, now, range]);
  const labels = useMemo(() => perDay([], range, now).map((x) => x.key.slice(5).replace('-', '/')), [range, now]);

  async function capture() {
    const t = text.trim();
    if (!t) return;
    try { await api('/ideas', { method: 'POST', body: JSON.stringify({ text: t }) }); setText(''); setNotice('Idea guardada en el Inbox.'); void load(); }
    catch { setNotice('No se pudo guardar la idea.'); }
    setTimeout(() => setNotice(''), 3500);
  }

  // calendario del mes visible
  const first = new Date(month.y, month.m, 1);
  const lead = (first.getDay() + 6) % 7; // semana desde lunes
  const dim = new Date(month.y, month.m + 1, 0).getDate();
  const cells = Array.from({ length: lead + dim }, (_, i) => (i < lead ? null : i - lead + 1));
  const today = dayKey(now);
  const hour = new Date(now).getHours();
  const q = s.queue;

  return (
    <div className="dash-bg min-h-screen p-3 text-white sm:p-5">
      <div className="mx-auto grid max-w-[1400px] gap-4 lg:grid-cols-[76px_minmax(0,1fr)_330px]">
        <SideNav current="/dashboard/" />

        {/* ---------- centro ---------- */}
        <main className="glass min-w-0 space-y-4 rounded-[2rem] p-4 sm:p-6">
          <header className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold">{greeting(hour)}, Andrés <span aria-hidden>👋</span></h1>
              <p data-subtitle className="text-sm text-white/55">
                {items === null ? 'Cargando…' : s.attention > 0 ? `${s.attention} cosa(s) piden tu atención hoy` : 'Todo al día. Buen momento para crear.'}
              </p>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); void capture(); }} className="flex w-full items-center gap-2 rounded-full bg-black/35 px-4 py-2 sm:w-80">
              <Icon name="inbox" className="h-4 w-4 text-white/50" />
              <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} aria-label="Capturar una idea" placeholder="Captura una idea y pulsa Enter…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/40" />
            </form>
            <span className="relative grid h-10 w-10 place-items-center rounded-full bg-black/35" title={`${s.attention} pendientes`} aria-label="Avisos">
              <Icon name="queue" className="h-4 w-4 text-white/70" />{s.attention > 0 && <span data-bell className="absolute right-2 top-2 h-2 w-2 rounded-full" style={{ background: ORANGE }} />}
            </span>
          </header>
          {(notice || failed) && <p role="status" className={`rounded-xl px-3 py-2 text-sm ${failed ? 'bg-red-900/70 text-red-200' : 'bg-white/10 text-white/80'}`}>{failed ? 'No se pudo leer la API. Reintentando cada minuto.' : notice}</p>}

          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard id="ideas" label="Ideas nuevas" dot="#ee6c2b" value={s.ideasNew} unit="por procesar"><MiniBars vals={s.ideasPerDay} color="#ee6c2b" /></StatCard>
            <StatCard id="waiting" label="En aprobación" dot="#d6336c" value={s.waiting} unit={s.waitingOldestDays !== null ? `esperan · la más vieja ${s.waitingOldestDays === 0 ? 'de hoy' : `${s.waitingOldestDays} d`}` : 'esperan tu OK'}>
              <Pulse vals={s.activityPerDay.slice(-10)} color="#d6336c" />
            </StatCard>
            <StatCard id="queue" label="Cola de IA" dot="#2f9e44" value={q ? `${q.day}/${q.max}` : '—'} unit={q ? (q.paused ? 'trabajos 24 h · pausada' : 'trabajos en 24 h') : 'sin cola'}>
              <div className="grid place-items-center"><Gauge ratio={q ? q.day / q.max : 0} color={q?.paused ? '#f59f00' : '#2f9e44'} /></div>
            </StatCard>
            <StatCard id="quota" label="Cuota Claude" dot="#3b5bdb" value={q?.five != null ? `${q.five}%` : '—'} unit={q?.week != null ? `5 h · semana ${q.week}%` : q?.five != null ? 'ventana de 5 h' : 'sin lectura'}>
              <MiniBars vals={[q?.five ?? 0, q?.week ?? 0]} color="#3b5bdb" />
            </StatCard>
          </section>

          <section className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="rounded-[1.4rem] bg-white p-4 text-zinc-900 shadow-lg">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="font-bold">Actividad</h2>
                <select aria-label="Rango" value={range} onChange={(e) => setRange(Number(e.target.value) as 7 | 30)} className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-600">
                  <option value={7}>Semanal</option><option value={30}>Mensual</option>
                </select>
              </div>
              <ActivityChart vals={s.activityPerDay} labels={labels} />
              <p className="mt-1 text-[10px] text-zinc-400">Ideas creadas + tarjetas modificadas por día.</p>
            </div>
            <div data-next className="relative overflow-hidden rounded-[1.4rem] bg-white p-4 text-zinc-900 shadow-lg">
              <div className="absolute inset-y-0 right-0 w-2/5" style={{ background: `linear-gradient(135deg, ${ORANGE}, #7a2d0c 70%, #1c1917)` }} aria-hidden />
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Próxima publicación</p>
              {s.next ? (
                <div className="relative z-10 mt-1 w-3/5">
                  <h2 className="line-clamp-3 text-lg font-bold leading-tight">{s.next.title}</h2>
                  <p className="mt-3 text-3xl font-extrabold" style={{ color: ORANGE }}>{whenLabel(s.next.days)}</p>
                  <p className="text-xs text-zinc-500">{fmtShort(s.next.scheduled_at)} · {STATUS_LABEL[s.next.status as Status] ?? s.next.status}</p>
                </div>
              ) : <p className="relative z-10 mt-3 w-3/5 text-sm text-zinc-500">No hay nada con fecha por delante. Ponle fecha objetivo a una tarjeta en el Pipeline.</p>}
              <div className="relative z-10 mt-4 w-3/5 border-t border-zinc-100 pt-2 text-xs text-zinc-500">
                <b className="text-zinc-800">{s.overdue}</b> con fecha vencida · <b className="text-zinc-800">{s.totals.published}</b> publicadas
              </div>
              <div className="pointer-events-none absolute bottom-3 right-4 text-right text-white"><p className="text-4xl font-black leading-none">{s.upcoming.length}</p><p className="text-[11px] opacity-80">con fecha por delante</p></div>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between"><h2 className="border-l-[3px] pl-2 text-sm font-bold" style={{ borderColor: ORANGE }}>En el pipeline</h2><Link href="/" className="text-xs text-white/55 hover:text-white">ver todo</Link></div>
            <div className="grid gap-3 sm:grid-cols-3">
              {s.pipeline.map((it, i) => (
                <Link key={it.id} href="/" data-pipe className={`rounded-[1.2rem] p-4 shadow-lg transition hover:-translate-y-0.5 ${i === 0 ? 'text-white' : 'bg-white text-zinc-900'}`} style={i === 0 ? { background: ORANGE } : undefined}>
                  <p className="line-clamp-2 min-h-10 text-sm font-bold leading-tight">{it.title}</p>
                  <p className={`mt-1 text-xs ${i === 0 ? 'text-white/80' : 'text-zinc-500'}`}>{it.format ?? 'sin formato'}{it.carousel_state ? ` · 🎠 ${it.carousel_state}` : ''}</p>
                  <span className={`mt-3 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${i === 0 ? 'bg-white text-zinc-900' : 'bg-zinc-100 text-zinc-600'}`}>{STATUS_LABEL[it.status as Status]}</span>
                </Link>
              ))}
              {items !== null && s.pipeline.length === 0 && <p className="text-sm text-white/55 sm:col-span-3">No hay tarjetas en marcha. Promueve una idea del Inbox.</p>}
            </div>
          </section>
        </main>

        {/* ---------- derecha ---------- */}
        <aside className="glass space-y-3 rounded-[2rem] p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-full text-sm font-black" style={{ background: ORANGE }} aria-hidden>AG</span>
            <div className="min-w-0 flex-1"><p className="font-semibold leading-tight">Andrés Gómez</p><p className="text-xs text-white/50">@andyontrade</p></div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-white/10 rounded-2xl bg-black/25 py-2 text-center">
            {[[s.totals.cards, 'Tarjetas'], [s.totals.ideas, 'Ideas'], [s.totals.published, 'Publicadas']].map(([v, l]) => <div key={l}><p className="text-base font-bold">{v}</p><p className="text-[10px] text-white/45">{l}</p></div>)}
          </div>

          <div className="rounded-2xl bg-black/25 p-3">
            <div className="mb-2 flex items-center justify-between text-sm font-semibold">
              <span className="capitalize">{MONTHS[month.m]} {month.y}</span>
              <span className="flex gap-1">
                <button aria-label="Mes anterior" onClick={() => setMonth((m) => (m.m === 0 ? { y: m.y - 1, m: 11 } : { ...m, m: m.m - 1 }))} className="h-6 w-6 rounded-full bg-white/10 hover:bg-white/20">‹</button>
                <button aria-label="Mes siguiente" onClick={() => setMonth((m) => (m.m === 11 ? { y: m.y + 1, m: 0 } : { ...m, m: m.m + 1 }))} className="h-6 w-6 rounded-full bg-white/10 hover:bg-white/20">›</button>
              </span>
            </div>
            <div className="grid grid-cols-7 gap-y-1 text-center text-[11px]">
              {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => <span key={d} className="text-white/35">{d}</span>)}
              {cells.map((d, i) => {
                if (d === null) return <span key={i} />;
                const k = dayKey(new Date(month.y, month.m, d));
                const kind = s.calendar.get(k);
                const bg = kind === 'today' ? ORANGE : kind === 'overdue' ? '#d6336c' : kind === 'scheduled' ? '#2f9e44' : undefined;
                return <span key={i} data-day={k} data-kind={kind ?? ''} className={`mx-auto grid h-7 w-7 place-items-center rounded-full ${bg ? 'font-bold text-white' : 'text-white/70'}`} style={bg ? { background: bg } : undefined}>{d}</span>;
              })}
            </div>
            <p className="mt-2 flex flex-wrap gap-x-3 text-[10px] text-white/45"><span><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: ORANGE }} />hoy</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#2f9e44]" />con fecha</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#d6336c]" />vencida</span></p>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between"><h2 className="border-l-[3px] pl-2 text-sm font-bold" style={{ borderColor: ORANGE }}>Programado</h2><Link href="/calendar/" className="text-xs text-white/55 hover:text-white">ver todo</Link></div>
            <ul className="space-y-2">
              {s.upcoming.slice(0, 4).map((u) => (
                <li key={u.id} data-up className="rounded-2xl bg-black/25 p-3">
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">{u.format ?? 'contenido'}</span>
                  <p className="mt-1 line-clamp-2 text-sm font-semibold leading-tight">{u.title}</p>
                  <p className="text-[11px] text-white/45">{fmtShort(u.scheduled_at)} · {whenLabel(daysBetween(today, dayKey(u.scheduled_at)))}</p>
                </li>
              ))}
              {items !== null && s.upcoming.length === 0 && <li className="text-sm text-white/45">Sin fechas próximas.</li>}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
