'use client';
import type { ReactNode } from 'react';
import { smoothPath } from '@/lib/dashboard';

import { ORANGE } from './AppShell';

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
