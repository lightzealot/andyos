import Link from 'next/link';

const LINKS = [
  { href: '/dashboard/', label: 'Dashboard' },
  { href: '/inbox/', label: 'Inbox' },
  { href: '/', label: 'Pipeline' },
  { href: '/calendar/', label: 'Calendario' },
  { href: '/studio/', label: 'Estudio' },
  { href: '/references/', label: 'Referencias' },
  { href: '/queue/', label: 'Cola IA' },
  { href: '/n8n/', label: 'n8n' },
];

export function Nav({ current }: { current: string }) {
  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-1">
      {LINKS.map((l) => (
        <Link
          key={l.href} href={l.href}
          className={`rounded-md px-2.5 py-1 text-sm ${current === l.href ? 'bg-zinc-800 font-semibold' : 'text-zinc-400 hover:text-zinc-200'}`}
        >{l.label}</Link>
      ))}
    </nav>
  );
}
