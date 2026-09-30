import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';

export interface VoiceProfile {
  guide: string;
  facts: string[];
  banned: string[];
  examples: { kind: string; text: string }[];
}

/**
 * Guía de voz extraída de los carruseles y captions que Andrés aprobó y publicó (CarruselOS).
 * Es un punto de partida editable: mejora con los textos que él edite y guarde como "ejemplos de mi voz".
 */
export const DEFAULT_GUIDE = `Escribes como Andrés: primera persona, tuteo, español latino natural. Habla como a un amigo, no como una marca.
- Frases CORTAS. Una idea por frase; muchas de 4 a 10 palabras. Ej.: «Y sí, me dio miedo.»
- Confesión y giro: admite un error o algo que creía, y luego lo cambia. Ej.: «Creí que la IA era gratis. Me equivoqué durante meses.»
- Contraste directo. Ej.: «No es que la IA sea mala. Es que le hablas mal.»
- Comparaciones de la vida diaria (un martillo, un café al día, un mapa) en lugar de jerga técnica.
- Datos PROPIOS y concretos (qué pasó, cuánto tardó, qué cambió). Nunca cifras genéricas ni inventadas.
- Vulnerabilidad medida (miedo, duda) sin dramatizar. Lo personal es lo que mejor le funciona.
- Opinión clara, directa, un poco cortante si hace falta («sin filtros», «hablar claro»).
- Cierres simples y concretos: «Comenta PALABRA y te envío…», «Guarda este post», «Sígueme si…».
- Emojis: cero o uno, siempre al final. Sin hashtags. Casi sin exclamaciones.
- Prohibido sonar a folleto: nada de frases de relleno, ni listas de tres perfectamente paralelas, ni moralejas.
- Si no tienes un dato real, escribe [DATO] para que Andrés lo complete. No lo inventes.`;

/** Hechos verdaderos sobre Andrés que la IA puede usar. Editables: quita los que no quieras hacer públicos. */
export const DEFAULT_FACTS = [
  'Es ingeniero de sistemas, con foco en ciberseguridad e inteligencia artificial.',
  'Su cuenta es @andyontrade y ahora enseña IA aplicada.',
  'Antes hacía contenido de gym, pareja y vida diaria, y llegó a 89 mil seguidores.',
  'Dejó ese contenido porque sentía que no construía nada suyo y quería enseñar algo útil.',
  'Empezar de cero en IA le dio miedo: alcance bajo, un algoritmo que no lo conocía en este tema y dudas casi a diario.',
  'Tiene un homelab con Ubuntu y Docker en casa.',
  'Tiene su propio n8n en un VPS.',
  'Construyó su propia plataforma de automatización de Instagram con n8n y la API oficial de Meta: alguien comenta una palabra clave y recibe un DM con un recurso.',
  'Creó CarruselOS, su sistema para producir carruseles con IA, y AndyOS, su panel para producir contenido.',
  'Paga planes de IA (Claude Pro y ChatGPT Plus) y cree que la IA gratis se queda corta.',
  'Planifica su contenido en Notion.',
];

/** Frases de relleno típicas de textos generados por IA en español. Se comparan sin tildes ni mayúsculas. */
export const DEFAULT_BANNED = [
  'en el mundo de hoy', 'en el mundo actual', 'en la era digital', 'en la era de la inteligencia artificial', 'hoy en día',
  'en un mundo cada vez más', 'sumérgete', 'descubre cómo', 'descubre el poder', 'desbloquea', 'libera el potencial',
  'desbloquear el potencial', 'revoluciona', 'revolucionar', 'revolucionario', 'transforma tu vida', 'al siguiente nivel',
  'cambia las reglas del juego', 'game changer', 'es importante destacar', 'cabe destacar', 'vale la pena mencionar',
  'en conclusión', 'en resumen', 'sin lugar a dudas', 'sin duda alguna', 'un sinfín de', 'un abanico de',
  'te invito a', 'no esperes más', 'no te lo pierdas', 'imperdible', 'herramienta poderosa', 'potente herramienta',
  'de manera efectiva', 'aprovecha al máximo', 'optimiza tu flujo de trabajo', 'es crucial', 'es fundamental',
  'juega un papel clave', 'juega un papel crucial', 'panorama de la ia', 'tapiz',
];

/** Textos que Andrés aprobó y publicó (captions de sus carruseles), tal cual. */
export const SEED_EXAMPLES: { kind: 'caption' | 'hook'; text: string }[] = [
  { kind: 'caption', text: 'Mi ChatGPT me aplaudía hasta las ideas más estúpidas. Cambié el prompt y ahora me da criterio, no aplausos.\n\nComenta "OBJETIVO" y te paso el prompt exacto que uso yo. 👉 Guarda este post.' },
  { kind: 'caption', text: 'Todos muestran resultados increíbles con IA "sin pagar nada."\n\nYo también lo creí, hasta que el plan gratis me hizo perder más tiempo del que me ahorraba.\n\nEsto fue lo que cambió cuando pagué el plan básico.' },
  { kind: 'caption', text: 'Creí que la IA era gratis. Me equivoqué durante meses 🙃' },
  { kind: 'caption', text: 'Dejé de usar la IA para que me aplaudiera. Ahora la uso para que me diga la verdad.\n\nComenta la palabra "OBJETIVO" y te mando el prompt exacto: cópialo y pégalo en tu ChatGPT (o cualquier IA que uses).' },
  { kind: 'caption', text: 'Si la IA te responde genérico, el problema no es la IA: es el prompt. Con estas 5 partes el resultado cambia por completo. Comenta PROMPT y te envío la plantilla.' },
  { kind: 'caption', text: 'Usar una sola IA para todo es como usar un martillo para todo. Aquí va qué usar para escribir, crear imágenes, video, investigar y automatizar. Guárdalo 📌' },
  { kind: 'hook', text: 'Dejé lo que ya funcionaba para empezar de cero. Y sí, me dio miedo.' },
  { kind: 'hook', text: 'No es que la IA sea mala. Es que le hablas mal.' },
  { kind: 'hook', text: '¿Tu IA también te dice que sí a todo?' },
];

export function seedVoice(db: Db) {
  const now = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO voice_profile (id, guide, facts, banned, updated_at) VALUES (1, ?, ?, ?, ?)')
    .run(DEFAULT_GUIDE, JSON.stringify(DEFAULT_FACTS), JSON.stringify(DEFAULT_BANNED), now);
  const n = (db.prepare('SELECT COUNT(*) c FROM voice_examples').get() as { c: number }).c;
  if (n === 0) {
    const ins = db.prepare("INSERT INTO voice_examples (id, kind, text, source, created_at) VALUES (?, ?, ?, 'semilla', ?)");
    for (const e of SEED_EXAMPLES) ins.run(randomUUID(), e.kind, e.text, now);
  }
}

/** Perfil vigente. Los ejemplos del propio usuario van primero (más recientes primero) y luego la semilla. */
export function getVoice(db: Db, maxExamples = 8): VoiceProfile {
  const p = db.prepare('SELECT guide, facts, banned FROM voice_profile WHERE id = 1').get() as { guide: string; facts: string; banned: string };
  const examples = db.prepare(`SELECT kind, text FROM voice_examples
                               ORDER BY (source = 'usuario') DESC, created_at DESC LIMIT ?`).all(maxExamples) as { kind: string; text: string }[];
  return { guide: p.guide, facts: JSON.parse(p.facts), banned: JSON.parse(p.banned), examples };
}
