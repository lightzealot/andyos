'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { smoothPath } from '@/lib/dashboard';

export const ORANGE = '#ee6c2b';

/* ---------- barra lateral de iconos ---------- */
const ICONS: Record<string, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  inbox: <><path d="M3 13l3-8h12l3 8v6H3z" /><path d="M3 13h5l1 3h6l1-3h5" /></>,
  pipeline: <><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="10" rx="1.5" /><rect x="17" y="4" width="4" height="13" rx="1.5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  studio: <><path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z" /><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" /></>,
  references: <><path d="M6 3h12v18l-6-4-6 4z" /></>,
  queue: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  n8n: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.5 12H12l4-5M12 12l4 5" /></>,
};
export const NAV = [
  ['dashboard', '/dashboard/', 'Dashboard'], ['inbox', '/inbox/', 'Inbox'], ['pipeline', '/', 'Pipeline'], ['calendar', '/calendar/', 'Calendario'],
  ['studio', '/studio/', 'Estudio'], ['references', '/references/', 'Referencias'], ['queue', '/queue/', 'Cola IA'], ['n8n', '/n8n/', 'n8n'],
] as const;

export function Icon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>{ICONS[name]}</svg>;
}

export function SideNav({ current }: { current: string }) {
  return (
    <nav aria-label="Principal" className="glass flex min-w-0 items-center gap-2 rounded-[1.75rem] p-2 lg:flex-col lg:py-5">
      <span className="hidden text-lg font-black lg:block" style={{ color: ORANGE }} aria-hidden>▸</span>
      <div className="flex min-w-0 flex-1 items-center justify-around gap-1 lg:mt-4 lg:flex-none lg:flex-col lg:justify-start lg:gap-2">
        {NAV.map(([icon, href, label]) => (
          <Link key={href} href={href} aria-label={label} data-nav={label}
            className={`group relative grid h-9 w-9 shrink-0 place-items-center sm:h-11 sm:w-11 rounded-2xl transition ${current === href ? 'text-white shadow-lg' : 'text-white/55 hover:bg-white/10 hover:text-white'}`}
            style={current === href ? { background: ORANGE } : undefined}>
            <Icon name={icon} />
            <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-full bg-zinc-900/95 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-xl transition group-hover:opacity-100 lg:block">{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

/* ---------- minigráficos de las tarjetas blancas ---------- */
export function MiniBars({ vals, color }: { vals: number[]; color: string }) {
  const max = Math.max(1, ...vals);
  return (
    <svg viewBox="0 0 100 30" className="h-8 w-full" aria-hidden preserveAspectRatio="none">
      {vals.map((v, i) => { const h = Math.max(2, (v / max) * 28); const w = 100 / vals.length; return <rect key={i} x={i * w + w * 0.2} y={30 - h} width={w * 0.6} height={h} rx="1.5" fill={color} opacity={v ? 0.9 : 0.25} />; })}
    </svg>
  );
}
export function Pulse({ vals, color }: { vals: number[]; color: string }) {
  const max = Math.max(1, ...vals);
  const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * 100) / Math.max(1, vals.length - 1)},${28 - (v / max) * 24}`).join(' ');
  return <svg viewBox="0 0 100 30" className="h-8 w-full" aria-hidden preserveAspectRatio="none"><path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>;
}
export function Gauge({ ratio, color }: { ratio: number; color: string }) {
  const r = Math.min(1, Math.max(0, ratio));
  const L = Math.PI * 30;
  return (
    <svg viewBox="0 0 80 46" className="h-9" aria-hidden>
      <path d="M10 40a30 30 0 0 1 60 0" fill="none" stroke="#e5e7eb" strokeWidth="7" strokeLinecap="round" />
      <path d="M10 40a30 30 0 0 1 60 0" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${L * r} ${L}`} />
    </svg>
  );
}

export function StatCard({ label, dot, value, unit, children, id }: { label: string; dot: string; value: ReactNode; unit: string; children: ReactNode; id: string }) {
  return (
    <div data-stat={id} className="flex flex-col justify-between rounded-[1.4rem] bg-white p-4 text-zinc-900 shadow-lg">
      <div className="flex items-center justify-between text-sm font-semibold">
        <span>{label}</span><span className="grid h-6 w-6 place-items-center rounded-full" style={{ background: `${dot}22` }}><span className="h-2 w-2 rounded-full" style={{ background: dot }} /></span>
      </div>
      <div className="my-2 min-h-8">{children}</div>
      <p className="flex items-baseline gap-1"><span className="text-2xl font-extrabold leading-none" style={{ color: dot }}>{value}</span><span className="text-xs text-zinc-500">{unit}</span></p>
    </div>
  );
}

/* ---------- curva de actividad ---------- */
export function ActivityChart({ vals, labels }: { vals: number[]; labels: string[] }) {
  const W = 520, H = 170;
  const { line, area, pts } = smoothPath(vals, W, H, 10);
  const peak = vals.indexOf(Math.max(...vals));
  const P = pts[peak];
  const shown = labels.filter((_, i) => i % Math.ceil(labels.length / 8) === 0);
  return (
    <div className="overflow-hidden">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label="Actividad por día" preserveAspectRatio="none">
          <defs><linearGradient id="act" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={ORANGE} stopOpacity=".28" /><stop offset="1" stopColor={ORANGE} stopOpacity="0" /></linearGradient></defs>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#e5e7eb" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />)}
          {line && <><path d={area} fill="url(#act)" /><path d={line} fill="none" stroke={ORANGE} strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></>}
        </svg>
        {P && vals[peak] > 0 && (
          <span data-peak className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold"
            style={{ left: `${Math.min(88, Math.max(12, (P.x / W) * 100))}%`, top: `${Math.max(2, (P.y / H) * 100 + 4)}%`, borderColor: ORANGE, color: ORANGE, background: '#fff' }}>{vals[peak]} mov.</span>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-400">{shown.map((l, i) => <span key={i}>{l}</span>)}</div>
    </div>
  );
}
