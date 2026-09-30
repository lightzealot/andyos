export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

export const STATUSES = [
  'idea', 'hook', 'guion', 'produccion', 'edicion',
  'aprobacion', 'programado', 'publicado', 'analizado',
] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  idea: 'Idea', hook: 'Hook', guion: 'Guion', produccion: 'Producción', edicion: 'Edición',
  aprobacion: 'Aprobación', programado: 'Programado', publicado: 'Publicado', analizado: 'Analizado',
};

export const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'linkedin', 'x'] as const;
export const FORMATS = ['reel', 'carousel', 'short', 'post', 'video', 'story'] as const;

export interface Item {
  id: string;
  title: string;
  status: Status;
  notes: string;
  tags: string[];
  platform: string | null;
  format: string | null;
  hook: string;
  caption: string;
  script: Record<string, string>;
  scheduled_at: string | null;
  approved_at: string | null;
  ai_generated: boolean;
  updated_at: string;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    credentials: 'include',
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? 'error');
  return data as T;
}

export interface Idea {
  id: string;
  title: string;
  status: 'nueva' | 'descartada' | 'promovida';
  notes: string;
  tags: string[];
  source: string;
  created_at: string;
  /** Borrador de etiquetas de la IA (nunca se aplica sin aceptarlo). null si no hay nada pendiente. */
  suggestion: { job_id: string; status: 'queued' | 'running' | 'done' | 'failed'; tags?: string[]; error_class?: string } | null;
}

export interface Reference {
  id: string;
  title: string;
  url: string | null;
  creator: string;
  platform: string | null;
  format: string | null;
  why_it_works: string;
  hook_pattern: string;
  notes: string;
  tags: string[];
  derived_count: number;
}

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  tags: string[];
  last: { status: string; started_at: string | null; stopped_at: string | null } | null;
  recent_errors: number;
  triggerable: boolean;
}

export interface N8nExecution {
  id: string;
  workflow_id: string;
  workflow_name: string;
  status: string;
  mode: string | null;
  started_at: string | null;
  stopped_at: string | null;
}

export interface Issue { type: string; detail: string; field?: string }

/** Un trabajo de IA (borrador). `output` depende de la tarea. */
export interface Job {
  id: string;
  task: 'hooks' | 'script' | 'caption' | 'humanize' | 'tag_idea';
  status: 'queued' | 'running' | 'done' | 'failed' | 'canceled';
  input: Record<string, unknown>;
  output: unknown;
  review: { issues: Issue[]; revised: boolean } | null;
  error_class: string | null;
  accepted_at: string | null;
  dismissed_at: string | null;
  provider: string | null;
  model: string | null;
  created_at: string;
}

export interface QueueInfo {
  state: {
    paused: boolean; paused_reason: string | null; paused_until: string | null; auto_tag: boolean;
    max_per_day: number; max_per_week: number;
    usage_snapshot: { five_hour?: { utilization: number }; seven_day?: { utilization: number } } | null;
  };
  counters: { day: number; week: number; queued: number; running: number };
}

export interface Voice {
  guide: string;
  facts: string[];
  banned: string[];
  examples: { id: string; kind: 'hook' | 'script' | 'caption'; text: string; source: 'semilla' | 'usuario'; created_at: string }[];
  updated_at: string;
}

export const SCRIPT_PARTS = [
  ['hook', 'Hook'], ['contexto', 'Contexto'], ['cambio', 'Cambio'],
  ['aplicacion', 'Aplicación / Demo'], ['resultado', 'Resultado'], ['cta', 'CTA'],
] as const;
