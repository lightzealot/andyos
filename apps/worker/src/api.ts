import type { UsageSnapshot } from './classify.js';
import type { Config } from './config.js';
import type { ClaimedJob, Outcome } from './types.js';

export type ClaimResponse =
  | { job: ClaimedJob }
  | { job: null; reason: 'paused' | 'usage_high' | 'limit_day' | 'limit_week' | 'concurrency' | 'empty'; until?: string | null };

export class ApiClient {
  constructor(private cfg: Config) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.cfg.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.token}` },
      body: JSON.stringify(body),
      redirect: 'error', // el token va en una cabecera propia: nunca seguir redirecciones
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new ApiHttpError(res.status, path);
    return (await res.json()) as T;
  }

  claim(providers: string[]) { return this.post<ClaimResponse>('/worker/claim', { providers }); }

  report(jobId: string, o: Outcome) {
    if (o.ok) {
      return this.post(`/worker/jobs/${jobId}/result`, {
        output: o.output, provider: o.provider, model: o.model, usage: o.usage, usage_snapshot: o.snapshot,
      });
    }
    return this.post(`/worker/jobs/${jobId}/failure`, { error_class: o.error_class, error: o.error, reset_at: o.reset_at });
  }

  usage(snapshot: UsageSnapshot) { return this.post('/worker/usage', snapshot); }
}

export class ApiHttpError extends Error {
  constructor(public status: number, path: string) { super(`API ${status} en ${path}`); }
}
