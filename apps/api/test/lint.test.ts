import { describe, expect, it } from 'vitest';
import { feedbackFor, isStrong, lintText, needsRetry, norm, pendingMarkers } from '../src/lint.js';
import { DEFAULT_BANNED, SEED_EXAMPLES } from '../src/voice.js';

const lint = (text: string, source = '', extra: Partial<Parameters<typeof lintText>[1]> = {}) =>
  lintText(text, { banned: DEFAULT_BANNED, source, ...extra });
const types = (text: string, source = '', extra = {}) => lint(text, source, extra).map((i) => i.type);

describe('frases de relleno y arranques de IA', () => {
  it.each([
    'En el mundo de hoy, la IA lo cambia todo.',
    'Descubre cómo automatizar tu contenido.',
    'Es importante destacar que funciona.',
    'Sumérgete en la automatización.',
    'Esto va a revolucionar tu forma de trabajar.',
    'SIN DUDA ALGUNA es la mejor opción',
    'Lleva tu contenido al siguiente nivel.',
    'Es crucial entenderlo.',
  ])('detecta: %s', (t) => expect(types(t)).toContain('banned_phrase'));
  it('ignora mayúsculas y tildes', () => {
    expect(types('DESCUBRE COMO hacerlo')).toContain('banned_phrase');
    expect(norm('Sumérgete')).toBe('sumergete');
  });
  it('detecta arranques típicos', () => {
    expect(types('¿Sabías que la IA no es gratis?')).toContain('ai_opener');
    expect(types('Imagina un mundo sin límites')).toContain('ai_opener');
    expect(types('Hoy en día todos usan IA')).toEqual(expect.arrayContaining(['ai_opener', 'banned_phrase']));
  });
  it('NO marca su propia voz (falsos positivos): los captions reales que aprobó salen limpios', () => {
    for (const e of SEED_EXAMPLES) {
      const strong = lint(e.text, e.text, { noHashtags: e.kind === 'caption' }).filter(isStrong);
      expect(strong, `«${e.text.slice(0, 40)}…» → ${JSON.stringify(strong)}`).toEqual([]);
    }
  });
  it('las frases del usuario en la lista prohibida propia también se detectan', () => {
    expect(lintText('Esto es un puro humo, mira', { banned: ['puro humo'], source: '' }).map((i) => i.type)).toEqual(['banned_phrase']);
  });
});

describe('cifras inventadas', () => {
  it('marca una cifra que no viene del material de origen', () => {
    expect(lint('Ahorré 47 horas al mes', 'Automaticé mis respuestas').map((i) => i.detail)).toContain('47');
    expect(types('Subí un 300% en una semana', 'nada de cifras')).toContain('invented_number');
  });
  it('acepta las cifras que sí vienen de tus datos', () => {
    expect(types('Tenía 89 mil seguidores', 'Llegó a 89 mil seguidores')).not.toContain('invented_number');
    expect(types('Alcancé 10,441 personas', 'reach 10,441')).not.toContain('invented_number');
  });
  it('lo marcado como [DATO] no cuenta como inventado', () => {
    expect(types('Ahorré [DATO] horas al mes')).not.toContain('invented_number');
    expect(types('Pasé de [DATO 12] a [DATO 40]')).not.toContain('invented_number');
  });
  it('los números pequeños de estructura no cuentan ("5 partes", "3 pasos") pero con unidad sí', () => {
    expect(types('La fórmula tiene 5 partes y 3 pasos')).not.toContain('invented_number');
    expect(types('Tardaba 5 horas', 'sin datos')).toContain('invented_number');
    expect(types('Subió 5%', 'sin datos')).toContain('invented_number');
    expect(types('Con 5 minutos basta', 'sin datos')).toContain('invented_number');
  });
});

describe('otras señales de estilo', () => {
  it('rayas largas, exclamaciones y emojis en exceso', () => {
    expect(types('a — b — c — d')).toContain('em_dash');
    expect(types('¡Increíble! ¡Guárdalo! ¡Ya!')).toContain('exclamations');
    expect(types('Mira 🚀🔥🎉 esto')).toContain('emoji');
    expect(types('Guárdalo 📌')).toEqual([]);
  });
  it('hashtags solo se marcan en captions', () => {
    expect(types('Buen post #ia #n8n', '', { noHashtags: true })).toContain('hashtags');
    expect(types('Buen post #ia', '')).not.toContain('hashtags');
    expect(types('La fórmula #1 de mi mes', '', { noHashtags: true })).not.toContain('hashtags');
  });
  it('frases de más de 30 palabras', () => {
    const long = Array.from({ length: 34 }, (_, i) => `palabra${i}`).join(' ') + '.';
    expect(types(long)).toContain('long_sentence');
    expect(types('Corto. Muy corto. Así habla.')).toEqual([]);
  });
});

describe('reintento y retroalimentación', () => {
  it('un defecto fuerte pide segunda pasada; uno o dos débiles, no; tres débiles, sí', () => {
    expect(needsRetry(lint('Descubre cómo hacerlo'))).toBe(true);
    expect(needsRetry(lint('¡a! ¡b!'))).toBe(false);
    expect(needsRetry([{ type: 'emoji', detail: '' }, { type: 'em_dash', detail: '' }, { type: 'exclamations', detail: '' }])).toBe(true);
    expect(needsRetry([])).toBe(false);
  });
  it('la retroalimentación nombra cada defecto y el campo', () => {
    const fb = feedbackFor(lintText('Descubre cómo ahorrar 900 horas', { banned: DEFAULT_BANNED, source: '', field: 'hook' }));
    expect(fb).toMatch(/descubre c.mo/i); expect(fb).toContain('900'); expect(fb).toContain('«hook»');
  });
});

describe('copiar tus ejemplos', () => {
  const examples = ['Creí que la IA era gratis. Me equivoqué durante meses 🙃', 'No es que la IA sea mala. Es que le hablas mal.'];
  const t = (text: string) => lintText(text, { banned: [], source: '', examples }).map((i) => i.type);
  it('marca 5 palabras seguidas iguales a un ejemplo (ignorando tildes, mayúsculas y signos)', () => {
    expect(t('Y ahora: creí que la IA era gratis, pero no.')).toContain('copied_example');
    expect(t('NO ES QUE LA IA SEA mala, ojo')).toContain('copied_example');
  });
  it('no marca la misma idea dicha con otras palabras, ni giros cortos sueltos', () => {
    expect(t('Pensé que la inteligencia artificial no costaba nada. Fallé por meses.')).not.toContain('copied_example');
    expect(t('Me equivoqué. Y sí, me dio miedo.')).not.toContain('copied_example');
  });
  it('sin ejemplos no hay comparación y es defecto fuerte', () => {
    expect(lintText('Creí que la IA era gratis', { banned: [], source: '' })).toEqual([]);
    expect(isStrong({ type: 'copied_example', detail: 'x' })).toBe(true);
    expect(feedbackFor([{ type: 'copied_example', detail: 'creí que la ia era', field: 'hook' }])).toMatch(/propias palabras/);
  });
});

describe('marcadores pendientes ([DATO], [VIVENCIA])', () => {
  it('se cuentan, no son un defecto y no piden segunda pasada', () => {
    const issues = lintText('Ahorro [DATO] horas. Un día [VIVENCIA: cuándo pasó] cambió todo. [CONFIRMAR]', { banned: [], source: '' });
    expect(issues.map((i) => i.type)).toEqual(['pending']);
    expect(needsRetry(issues)).toBe(false);
    expect(feedbackFor(issues)).toBe('');
    expect(pendingMarkers('a [DATO] b [vivencia] c [DATO 12]')).toHaveLength(3);
  });
  it('no cuentan como cifra inventada ni como texto normal', () => {
    expect(lintText('Pasé de [DATO 12] a [DATO 40]', { banned: [], source: '' }).map((i) => i.type)).toEqual(['pending']);
  });
});
