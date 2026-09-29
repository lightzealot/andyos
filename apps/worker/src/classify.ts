export type ErrorClass = 'quota' | 'billing' | 'auth' | 'transient' | 'permanent';

export interface Classified { error_class: ErrorClass; window?: 'five_hour' | 'seven_day' }

/**
 * Clasifica un mensaje de error de los CLI. Los textos vienen de la documentación oficial de Claude Code
 * (errors) y de errores reales observados; el de cuota agotada NO se ha visto aún en uso real.
 */
export function classifyMessage(text: string, apiStatus?: number | null): Classified {
  const t = text || '';
  if (/spend limit|monthly spend|Credit balance is too low|usage credits required|team's shared budget/i.test(t)) return { error_class: 'billing' };
  if (/Not logged in|Login expired|OAuth token (expired|revoked)|JWT refresh failed|login expired|Invalid API key|Authentication required|authentication_error|401 Unauthorized|Unauthorized/i.test(t)) return { error_class: 'auth' };
  if (/Server is temporarily limiting|not your usage limit/i.test(t)) return { error_class: 'transient' };
  const hit = /hit your (session|weekly|opus|sonnet|[\w. ]+?) limit/i.exec(t);
  if (hit || /usage_limit_error|usage limit|rate limit reached|too many requests/i.test(t)) {
    const kind = (hit?.[1] ?? '').toLowerCase();
    return { error_class: 'quota', window: kind === 'weekly' ? 'seven_day' : 'five_hour' };
  }
  if ((apiStatus && [408, 429, 500, 502, 503, 504, 529].includes(apiStatus))
    || /Request rejected \(429\)|Overloaded|Request timed out|No response from API|API Error: 5\d\d|high load|ECONNRESET|ETIMEDOUT|fetch failed|Reconnecting|timed out|timeout/i.test(t)) {
    return { error_class: 'transient' };
  }
  return { error_class: 'permanent' };
}

export interface UsageSnapshot {
  five_hour?: { utilization: number; resetsAt: number };
  seven_day?: { utilization: number; resetsAt: number };
}

/** Convierte el `rate_limit_event` del stream de Claude (campo no documentado) en una instantánea opcional. */
export function snapshotFromEvent(ev: unknown): UsageSnapshot | undefined {
  const w = (ev as { rate_limit_info?: { unifiedWindows?: Record<string, { utilization?: unknown; resetsAt?: unknown }> } })?.rate_limit_info?.unifiedWindows;
  if (!w) return undefined;
  const out: UsageSnapshot = {};
  for (const k of ['five_hour', 'seven_day'] as const) {
    const v = w[k];
    if (v && typeof v.utilization === 'number' && v.utilization >= 0 && v.utilization <= 1 && typeof v.resetsAt === 'number') {
      out[k] = { utilization: v.utilization, resetsAt: v.resetsAt };
    }
  }
  return Object.keys(out).length ? out : undefined;
}
