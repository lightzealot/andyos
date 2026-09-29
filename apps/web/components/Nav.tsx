import Link from 'next/link';

const LINKS = [
  { href: '/', label: 'Pipeline' },
  { href: '/calendar/', label: 'Calendario' },
];

export function Nav({ current }: { current: string }) {
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((l) => (
        <Link
          key={l.href} href={l.href}
          className={`rounded-md px-2.5 py-1 text-sm ${current === l.href ? 'bg-zinc-800 font-semibold' : 'text-zinc-400 hover:text-zinc-200'}`}
        >{l.label}</Link>
      ))}
    </nav>
  );
}
