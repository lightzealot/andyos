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
