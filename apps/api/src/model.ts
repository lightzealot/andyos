import { z } from 'zod';

// Solo http(s): evita esquemas como javascript: si alguna vista renderiza el enlace.
const HttpUrl = z.string().max(2000).url().refine((u) => /^https?:\/\//i.test(u), 'solo http(s)');

export const STATUSES = [
  'idea', 'hook', 'guion', 'produccion', 'edicion',
  'aprobacion', 'programado', 'publicado', 'analizado',
] as const;
export type Status = (typeof STATUSES)[number];

/** Estados que exigen aprobación humana explícita previa. */
export const GATED: readonly Status[] = ['programado', 'publicado', 'analizado'];

export const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'linkedin', 'x'] as const;
/** Estados del Pipeline de CarruselOS (solo seguimiento: no aprueba ni publica nada en FactoryOS). */
export const CAROUSEL_STATES = ['enfoque', 'narrativa', 'cta', 'borradores', 'preview', 'aprobado', 'exportado', 'publicado'] as const;

export const FORMATS = ['reel', 'carousel', 'short', 'post', 'video', 'story'] as const;

const Script = z.object({
  hook: z.string(), contexto: z.string(), cambio: z.string(),
  aplicacion: z.string(), resultado: z.string(), cta: z.string(),
}).partial();

const Content = {
  platform: z.enum(PLATFORMS).nullable(),
  format: z.enum(FORMATS).nullable(),
  pillar: z.string().max(200).nullable(),
  hook: z.string().max(2000),
  script: Script,
  caption: z.string().max(5000),
  scheduled_at: z.string().datetime({ offset: true }).nullable(),
  published_at: z.string().datetime({ offset: true }).nullable(),
  published_url: HttpUrl.nullable(),
  asset_links: z.array(HttpUrl).max(50),
  cta_keyword: z.string().max(50).nullable(),
  // Nombre de carpeta en CarruselOS/proyectos (solo texto: la API nunca toca el disco).
  carousel_folder: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/).nullable(),
  carousel_state: z.enum(CAROUSEL_STATES).nullable(),
};

export const CreateItem = z.object({
  title: z.string().min(1).max(300),
  status: z.enum(STATUSES).default('idea'),
  notes: z.string().max(10000).default(''),
  tags: z.array(z.string().max(50)).max(30).default([]),
}).extend(Object.fromEntries(Object.entries(Content).map(([k, v]) => [k, v.optional()])) as {
  [K in keyof typeof Content]: z.ZodOptional<(typeof Content)[K]>;
});

export const PatchItem = z.object({
  title: z.string().min(1).max(300),
  status: z.enum(STATUSES),
  notes: z.string().max(10000),
  tags: z.array(z.string().max(50)).max(30),
}).extend(Content).partial().strict();

/** Campos cuyo cambio invalida una aprobación previa. */
export const APPROVAL_FIELDS = ['hook', 'script', 'caption', 'asset_links'] as const;
