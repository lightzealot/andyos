/**
 * Detector de "estilo de IA" y de datos inventados. Determinista y sin coste (no llama a ningún modelo).
 * Se aplica a lo que genera la IA para devolverle una lista concreta de defectos y para avisar al usuario.
 */
export type IssueType =
  | 'banned_phrase' | 'ai_opener' | 'invented_number' | 'hashtags' | 'copied_example' | 'copied_reference' | 'invented_quote'   // fuertes
  | 'em_dash' | 'exclamations' | 'emoji' | 'long_sentence'                              // débiles
  | 'pending';                                                                           // informativo: [DATO] / [VIVENCIA] por completar

export interface LintIssue { type: IssueType; detail: string; field?: string }

const STRONG: IssueType[] = ['banned_phrase', 'ai_opener', 'invented_number', 'hashtags', 'copied_example', 'copied_reference', 'invented_quote'];
export const isStrong = (i: LintIssue) => STRONG.includes(i.type);

/** Minúsculas y sin tildes, para comparar sin depender de acentos. */
export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const OPENERS = /^\s*[¿"“]?(sabias que|imagina (que|un mundo)|en un mundo|en el mundo|hoy en dia|en la era)/;
const UNIT = /^\s*(%|x\b|k\b|mil\b|millones|segundos|minutos|min\b|horas|dias|semanas|meses|anos|veces|usd|dolares|seguidores|\$)/;

export interface LintOptions {
  banned: string[];
  /** Texto del que pueden salir las cifras (tema, notas, hechos). Una cifra fuera de aquí se considera inventada. */
  source: string;
  field?: string;
  /** Solo captions: tu estilo no usa hashtags. */
  noHashtags?: boolean;
  /** Tus textos de ejemplo: copiarlos casi literalmente es un defecto (5 palabras seguidas iguales). */
  examples?: string[];
  /** Textos de referencias de OTROS creadores: repetir 5 palabras seguidas es copiar. */
  references?: string[];
}

const SHINGLE = 5;
const shingles = (s: string): string[] => {
  const w = norm(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return w.length < SHINGLE ? [] : Array.from({ length: w.length - SHINGLE + 1 }, (_, i) => w.slice(i, i + SHINGLE).join(' '));
};

/** Marcadores que la IA deja donde falta un dato o una vivencia real tuya. */
export const pendingMarkers = (text: string): string[] => [...text.matchAll(/\[(DATO|VIVENCIA|CONFIRMAR)[^\]]*\]/gi)].map((m) => m[0]);

export function lintText(text: string, o: LintOptions): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (type: IssueType, detail: string) => issues.push({ type, detail, field: o.field });
  const n = norm(text);

  for (const p of o.banned) {
    const np = norm(p).trim();
    if (np && n.includes(np)) add('banned_phrase', p);
  }
  if (OPENERS.test(n)) add('ai_opener', text.trim().split(/\s+/).slice(0, 5).join(' '));

  const dashes = (text.match(/[—–]/g) ?? []).length;
  if (dashes > 2) add('em_dash', `${dashes} rayas largas`);
  const bangs = (text.match(/!/g) ?? []).length;
  if (bangs > 1) add('exclamations', `${bangs} exclamaciones`);
  const emojis = (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  if (emojis > 2) add('emoji', `${emojis} emojis`);
  if (o.noHashtags && /(^|\s)#\p{L}/u.test(text)) add('hashtags', 'hashtags (tu estilo no los usa)');

  for (const sentence of text.split(/(?<=[.!?…])\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    if (words.length > 30) add('long_sentence', `${words.length} palabras: «${words.slice(0, 7).join(' ')}…»`);
  }

  if (o.examples?.length) {
    const own = new Set(shingles(text));
    for (const ex of o.examples) {
      const hit = shingles(ex).find((sh) => own.has(sh));
      if (hit) { add('copied_example', hit); break; }
    }
  }
  if (o.references?.length) {
    const own = new Set(shingles(text));
    for (const ref of o.references) {
      const hit = shingles(ref).find((sh) => own.has(sh));
      if (hit) { add('copied_reference', hit); break; }
    }
  }
  // Citas inventadas: alguien "dijo" algo que no consta en tus datos (p. ej. un seguidor que te escribió).
  // Las citas cortas (una palabra clave como "AUTOMATIZA") no cuentan.
  for (const m of text.matchAll(/[«“"]([^»”"\n]{10,}?)[»”"]/g)) {
    const q = m[1].trim();
    if (q.split(/\s+/).length < 4) continue;
    const nq = norm(q);
    if (!norm(o.source).includes(nq) && !(o.examples ?? []).some((e) => norm(e).includes(nq))) add('invented_quote', q.slice(0, 60));
  }
  const pend = pendingMarkers(text);
  if (pend.length) add('pending', `${pend.length} por completar`);

  // Cifras inventadas: no aparecen en el material de origen ni están marcadas como [DATO]
  const src = norm(o.source);
  const scrubbed = text.replace(/\[[^\]]*\]/g, ' '); // lo que va entre corchetes ya es un marcador
  for (const m of scrubbed.matchAll(/\d[\d.,]*/g)) {
    const tok = m[0].replace(/[.,]+$/, '');
    const value = Number(tok.replace(/[.,]/g, ''));
    const after = scrubbed.slice((m.index ?? 0) + m[0].length);
    if (value <= 10 && !UNIT.test(norm(after))) continue; // "5 partes", "3 pasos": estructura, no dato
    const digits = tok.replace(/[.,]/g, '');
    if (!src.replace(/[.,]/g, '').includes(digits)) add('invented_number', tok);
  }
  return issues;
}

/** ¿Merece una segunda pasada automática? Cualquier defecto fuerte, o tres o más débiles. */
export const needsRetry = (issues: LintIssue[]) =>
  issues.some(isStrong) || issues.filter((i) => i.type !== 'pending').length >= 3;

export function feedbackFor(issues: LintIssue[]): string {
  const lines = issues.filter((i) => i.type !== 'pending').map((i) => {
    const where = i.field ? ` (en «${i.field}»)` : '';
    switch (i.type) {
      case 'banned_phrase': return `- Usaste la frase de relleno «${i.detail}»${where}. Quítala o dilo de forma concreta.`;
      case 'ai_opener': return `- Empieza con un arranque típico de IA («${i.detail}…»)${where}. Empieza directo, con algo concreto.`;
      case 'invented_number': return `- La cifra «${i.detail}»${where} no viene de los datos que te di. Quítala o pon [DATO].`;
      case 'copied_example': return `- Copias casi literal una frase de sus ejemplos («${i.detail}…»)${i.field ? ` en «${i.field}»` : ''}. Dila con tus propias palabras.`;
      case 'copied_reference': return `- Repites casi literal una frase de una REFERENCIA de otro creador («${i.detail}…»)${i.field ? ` en «${i.field}»` : ''}. De las referencias solo se toma la mecánica (tipo de hook, ritmo, orden), nunca sus palabras: dilo con tus propias palabras.`;
      case 'invented_quote': return `- La cita «${i.detail}»${where} parece inventada: no viene de tus datos. Quítala o escribe [VIVENCIA] para que la complete Andrés.`;
      case 'pending': return '';
      case 'hashtags': return `- Sin hashtags${where}: este estilo no los usa.`;
      case 'em_dash': return `- Demasiadas rayas largas${where}. Usa puntos y frases cortas.`;
      case 'exclamations': return `- Demasiadas exclamaciones${where}. Una como máximo.`;
      case 'emoji': return `- Demasiados emojis${where}. Cero o uno, al final.`;
      case 'long_sentence': return `- Frase demasiado larga${where}: ${i.detail}. Pártela en frases cortas.`;
    }
  });
  return lines.join('\n');
}
