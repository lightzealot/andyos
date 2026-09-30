import type { Item } from './api';

/** Estados del Pipeline de CarruselOS (solo seguimiento; no aprueban ni publican nada en AndyOS). */
export const CAROUSEL_STATES = ['enfoque', 'narrativa', 'cta', 'borradores', 'preview', 'aprobado', 'exportado', 'publicado'] as const;
export type CarouselState = (typeof CAROUSEL_STATES)[number];

export const FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Nombre de carpeta sugerido: AAAA-MM-DD-titulo-sin-acentos (el mismo estilo que ya usas en CarruselOS). */
export function suggestFolder(title: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const slug = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return slug ? `${date}-${slug}` : date;
}

const PARTS = [['hook', 'Hook'], ['contexto', 'Contexto'], ['cambio', 'Cambio'], ['aplicacion', 'Aplicación / Demo'], ['resultado', 'Resultado'], ['cta', 'CTA']] as const;

/** Prompt para pegar en Claude Code dentro de CarruselOS. Solo texto: no ejecuta ni aprueba nada. */
export function startPrompt(item: Pick<Item, 'title' | 'hook' | 'caption' | 'notes' | 'script'>, folder: string): string {
  const script: Record<string, string> = { ...item.script, ...(item.hook ? { hook: item.hook } : {}) };
  const parts = PARTS.filter(([k]) => script[k]?.trim()).map(([k, l]) => `- ${l}: ${script[k].trim()}`);
  return [
    'Quiero empezar un carrusel nuevo en CarruselOS con el flujo de tu CLAUDE.md (todo en texto y con mi confirmación antes de generar ninguna imagen).',
    '',
    `Tema: ${item.title}`,
    folder ? `Carpeta: proyectos/${folder}` : 'Carpeta: (propónmela con el formato AAAA-MM-DD-tema)',
    parts.length ? `\nMaterial que ya tengo en AndyOS (bórralo o ajústalo si no sirve):\n${parts.join('\n')}` : '',
    item.caption.trim() ? `\nCaption borrador: ${item.caption.trim()}` : '',
    item.notes.trim() ? `\nNotas: ${item.notes.trim()}` : '',
    '',
    'Empieza preguntándome lo que falte (número de slides, tipo de CTA, referencia y sujeto). No generes imágenes ni publiques nada sin mi OK.',
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim();
}
