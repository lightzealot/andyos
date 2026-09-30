import type { ErrorClass, UsageSnapshot } from './classify.js';

export interface ClaimedJob {
  id: string; task: string; provider: 'claude' | 'codex'; system: string; prompt: string;
  json_schema: unknown; attempt: number; timeout_s: number;
}

export type Outcome =
  | { ok: true; output: unknown; provider: 'claude' | 'codex'; model?: string; usage?: Record<string, unknown>; snapshot?: UsageSnapshot }
  | { ok: false; provider: 'claude' | 'codex'; error_class: ErrorClass; error: string; reset_at?: number; snapshot?: UsageSnapshot };
