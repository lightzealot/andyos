import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'FactoryOS', description: 'Todo tu contenido, en piloto automático', robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
