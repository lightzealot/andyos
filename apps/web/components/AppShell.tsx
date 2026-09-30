import Link from 'next/link';
import type { ReactNode } from 'react';

export const ORANGE = '#ee6c2b';

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
      <span className="hidden text-lg font-black lg:block" style={{ color: ORANGE }} title="FactoryOS · Todo tu contenido, en piloto automático">▸</span>
      <div className="flex min-w-0 flex-1 items-center justify-around gap-1 lg:mt-4 lg:flex-none lg:flex-col lg:justify-start lg:gap-2">
        {NAV.map(([icon, href, label]) => (
          <Link key={href} href={href} aria-label={label} data-nav={label}
            className={`group relative grid h-9 w-9 shrink-0 place-items-center sm:h-11 sm:w-11 rounded-2xl transition ${current === href ? 'text-white shadow-lg' : 'text-white/55 hover:bg-white/10 hover:text-white'}`}
            style={current === href ? { background: ORANGE } : undefined}>
            <Icon name={icon} />
            <span aria-hidden className="pointer-events-none absolute left-full top-1/2 z-30 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-full bg-zinc-900/95 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-xl transition group-hover:opacity-100 lg:block">{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}


/**
 * Marco común de TODAS las pantallas (menos login/privacidad): fondo cálido, barra lateral de iconos y panel de cristal.
 * Los colores `zinc-*`, `orange-*` y los radios se re-mapean dentro de `.skin` (globals.css), así que el contenido
 * escrito con las utilidades de siempre hereda el diseño. Ver docs/05-diseno-visual.md.
 */
export function AppShell({ current, children, aside }: { current: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="dash-bg skin min-h-screen p-3 text-zinc-100 sm:p-5">
      <div className={`mx-auto grid max-w-[1500px] gap-4 lg:min-h-[calc(100vh-2.5rem)] ${aside ? 'lg:grid-cols-[76px_minmax(0,1fr)_330px]' : 'lg:grid-cols-[76px_minmax(0,1fr)]'}`}>
        <SideNav current={current} />
        <main className="glass min-w-0 rounded-[2rem] p-4 sm:p-6">{children}</main>
        {aside}
      </div>
    </div>
  );
}
