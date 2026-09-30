import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Garantiza que toda pantalla nueva use el marco de diseño común (docs/05-diseno-visual.md).
 * Una página puede usar <AppShell> directamente o a través de su componente.
 * Solo login y privacidad (sin sesión / sin menú) están exentas.
 */
const EXEMPT = new Set(['login', 'privacy']);
const root = join(__dirname, '..', 'app');

function pages(dir: string, rel = ''): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return pages(p, join(rel, f));
    return f === 'page.tsx' ? [rel] : [];
  });
}

describe('marco de diseño', () => {
  it('todas las páginas usan AppShell salvo las exentas', () => {
    const list = pages(root);
    expect(list.length).toBeGreaterThanOrEqual(9);
    const bad = list.filter((rel) => {
      if (EXEMPT.has(rel)) return false;
      const page = readFileSync(join(root, rel, 'page.tsx'), 'utf8');
      if (page.includes('AppShell')) return false;
      // el componente que renderiza puede traer su propio AppShell (p. ej. Dashboard)
      const comp = /from '@\/components\/(\w+)'/.exec(page)?.[1];
      return !(comp && readFileSync(join(__dirname, '..', 'components', `${comp}.tsx`), 'utf8').includes('AppShell'));
    });
    expect(bad).toEqual([]);
  });

  it('las exentas usan el fondo y el skin de todos modos', () => {
    for (const rel of EXEMPT) {
      const page = readFileSync(join(root, rel, 'page.tsx'), 'utf8');
      expect(page).toContain('dash-bg');
      expect(page).toContain('skin');
    }
  });

  it('cada ruta con página aparece en la barra lateral', () => {
    const nav = readFileSync(join(__dirname, '..', 'components', 'AppShell.tsx'), 'utf8');
    for (const rel of pages(root)) {
      if (EXEMPT.has(rel)) continue;
      const href = rel === '' ? "'/'" : `'/${rel}/'`;
      expect(nav, `falta ${href} en NAV`).toContain(href);
    }
  });
});
