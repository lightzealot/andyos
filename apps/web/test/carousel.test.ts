import { describe, expect, it } from 'vitest';
import { FOLDER_RE, startPrompt, suggestFolder } from '../lib/carousel';

describe('carrusel', () => {
  it('sugiere una carpeta válida sin acentos ni símbolos', () => {
    const f = suggestFolder('¿Cómo pedir MEJOR a la IA? · 5 pasos', new Date(2026, 8, 30));
    expect(f).toBe('2026-09-30-como-pedir-mejor-a-la-ia-5-pasos');
    expect(FOLDER_RE.test(f)).toBe(true);
  });
  it('un título sin letras deja solo la fecha y un título largo no rompe el límite', () => {
    expect(suggestFolder('¿¿??', new Date(2026, 0, 5))).toBe('2026-01-05');
    const f = suggestFolder('a'.repeat(300), new Date(2026, 0, 5));
    expect(f.length).toBeLessThanOrEqual(100);
    expect(FOLDER_RE.test(f)).toBe(true);
  });
  it('el prompt lleva el material disponible y la regla de no generar sin OK', () => {
    const p = startPrompt({ title: 'Tema X', hook: 'Un hook', caption: '', notes: '', script: { cta: 'Guarda esto' } }, '2026-09-30-tema-x');
    expect(p).toContain('proyectos/2026-09-30-tema-x');
    expect(p).toContain('- Hook: Un hook');
    expect(p).toContain('- CTA: Guarda esto');
    expect(p).not.toContain('Caption borrador');
    expect(p).toMatch(/No generes imágenes ni publiques nada sin mi OK/);
  });
});
