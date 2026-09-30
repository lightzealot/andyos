'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, Job, QueueInfo } from '@/lib/api';

const TASK_LABEL: Record<string, string> = {
  tag_idea: 'Etiquetar idea', hooks: 'Hooks', script: 'Guion', caption: 'Caption', humanize: 'Humanizar',
};
const STATUS_LABEL: Record<string, string> = {
  queued: 'En cola', running: 'Ejecutando', done: 'Hecho', failed: 'Falló', canceled: 'Cancelado',
};
const STATUS_STYLE: Record<string, string> = {
  queued: 'bg-amber-900 text-amber-300', running: 'bg-sky-900 text-sky-300', done: 'bg-emerald-900 text-emerald-300',
  failed: 'bg-red-900 text-red-300', canceled: 'bg-zinc-800 text-zinc-400',
};
const ERROR_LABEL: Record<string, string> = {
  quota: 'cuota agotada', billing: 'facturación', auth: 'sesión de Claude', transient: 'error temporal', permanent: 'error permanente',
};
/** Por qué está pausada y si se reanuda sola. */
function pauseInfo(reason: string | null, until: string | null): { text: string; auto: boolean } {
  const hasta = until ? ` hasta ${when(until)}` : '';
  if (reason === 'manual') return { text: 'Pausada a mano.', auto: false };
  if (reason === 'usage_five_hour') return { text: `Pausa automática: cuota de 5 h alta${hasta}.`, auto: true };
  if (reason === 'usage_seven_day') return { text: `Pausa automática: cuota semanal alta${hasta}.`, auto: true };
  if (reason === 'quota') return { text: `Pausa automática: Claude avisó de límite de uso${hasta}.`, auto: true };
  if (reason === 'auth') return { text: 'Pausada: la sesión de Claude del worker no es válida. Vuelve a iniciar sesión en el Mac mini y reanuda a mano.', auto: false };
  if (reason === 'billing') return { text: 'Pausada: problema de facturación o crédito. Revísalo y reanuda a mano.', auto: false };
  return { text: `Pausada${reason ? ` (${reason})` : ''}.`, auto: Boolean(until) };
}
const when = (iso: string | number | null | undefined) =>
  (iso ? new Date(typeof iso === 'number' ? iso * 1000 : iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const dur = (a?: string | null, b?: string | null) => {
  if (!a || !b) return null;
  const s = Math.round((Date.parse(b) - Date.parse(a)) / 1000);
  return s >= 0 ? `${s} s` : null;
};
const tokens = (u: Job['usage']) => {
  if (!u) return null;
  const n = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : 0);
  const t = n('input_tokens') + n('output_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens');
  return t > 0 ? `${t.toLocaleString('es')} tokens` : null;
};

function Meter({ label, w, threshold }: { label: string; w?: { utilization: number; resetsAt: number }; threshold?: number }) {
  const expired = w ? w.resetsAt * 1000 <= Date.now() : false;
  const pct = w && !expired ? Math.round(w.utilization * 100) : null;
  const limit = threshold ? Math.round(threshold * 100) : null;
  const hot = pct !== null && limit !== null && pct >= limit;
  return (
    <div data-meter={label} className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-zinc-300">{label}</span>
        <span className={hot ? 'text-red-400' : 'text-zinc-400'}>{pct === null ? 'sin dato vigente' : `${pct} %`}{limit !== null && ` · pausa al ${limit} %`}</span>
      </div>
      <div className="relative h-2 rounded bg-zinc-800">
        {pct !== null && <div className={`h-2 rounded ${hot ? 'bg-red-500' : 'bg-emerald-600'}`} style={{ width: `${Math.min(pct, 100)}%` }} />}
        {limit !== null && <div className="absolute top-[-2px] h-3 w-px bg-zinc-400" style={{ left: `${limit}%` }} />}
      </div>
      {w && !expired && <p className="text-xs text-zinc-500">Se reinicia {when(w.resetsAt)}</p>}
    </div>
  );
}

export function QueuePanel() {
  const [q, setQ] = useState<QueueInfo | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState('');
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ day: string; week: string; five: string; seven: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [qi, js] = await Promise.all([
        api<QueueInfo>('/ai/queue'),
        api<{ jobs: Job[] }>(`/ai/jobs?limit=50${filter ? `&status=${filter}` : ''}`),
      ]);
      setQ(qi); setJobs(js.jobs); setFailed(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) window.location.href = '/login/';
      else setFailed(true);
    }
  }, [filter]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  // El formulario de ajustes se rellena una vez (y se rearma tras guardar), no en cada refresco.
  useEffect(() => {
    if (q && !form) {
      const s = q.state;
      setForm({ day: String(s.max_per_day), week: String(s.max_per_week),
        five: String(Math.round((s.five_hour_pause_at ?? 0.8) * 100)), seven: String(Math.round((s.seven_day_pause_at ?? 0.85) * 100)) });
    }
  }, [q, form]);

  async function patch(body: Record<string, unknown>, ok: string) {
    setBusy(true); setNotice('');
    try {
      await api('/ai/queue', { method: 'PATCH', body: JSON.stringify(body) });
      setNotice(ok); await load();
      return true;
    } catch (err) {
      setNotice(err instanceof ApiError && err.code === 'invalid' ? 'Valores fuera de rango.' : 'No se pudo guardar.');
      return false;
    } finally { setBusy(false); }
  }

  async function saveLimits() {
    if (!form) return;
    const n = { day: Number(form.day), week: Number(form.week), five: Number(form.five), seven: Number(form.seven) };
    if (![n.day, n.week, n.five, n.seven].every(Number.isFinite)) { setNotice('Escribe solo números.'); return; }
    const done = await patch({ max_per_day: n.day, max_per_week: n.week, five_hour_pause_at: n.five / 100, seven_day_pause_at: n.seven / 100 },
      'Límites guardados.');
    if (done) setForm(null);
  }

  async function cancel(j: Job) {
    try { await api(`/ai/jobs/${j.id}/cancel`, { method: 'POST' }); setNotice('Trabajo cancelado.'); }
    catch { setNotice('Ese trabajo ya no está en cola (quizá ya empezó).'); }
    await load();
  }

  const st = q?.state;
  const pi = st?.paused ? pauseInfo(st.paused_reason, st.paused_until) : null;
  const snap = st?.usage_snapshot;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-bold">Cola de IA</h1>
        <button onClick={() => void load()} className="ml-auto text-sm text-zinc-400 hover:text-zinc-200">Actualizar</button>
      </header>
      {failed && <p className="rounded-md bg-red-950 px-3 py-2 text-sm text-red-300">No se pudo leer la cola. ¿Está la API disponible y tiene <code>WORKER_TOKEN</code>?</p>}
      {notice && <p className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-zinc-200">{notice}</p>}
      {!q && !failed && <p className="text-zinc-400">Cargando…</p>}
      {q && st && (
        <>
          <section data-queue-state className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <span className={`h-2.5 w-2.5 rounded-full ${st.paused ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">{st.paused ? 'Cola pausada' : 'Cola activa'}</p>
              <p className="text-zinc-400">{pi ? `${pi.text}${pi.auto ? ' Se reanuda sola.' : ''}` : 'El worker toma trabajos según los límites de abajo.'}</p>
            </div>
            <button
              disabled={busy} onClick={() => void patch({ paused: !st.paused }, st.paused ? 'Cola reanudada.' : 'Cola pausada.')}
              className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50"
            >{st.paused ? 'Reanudar' : 'Pausar'}</button>
          </section>

          <section className="grid gap-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:grid-cols-2">
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-zinc-300">Cuota de Claude (medida por el worker)</h2>
              <Meter label="Ventana de 5 h" w={snap?.five_hour} threshold={st.five_hour_pause_at} />
              <Meter label="Semana" w={snap?.seven_day} threshold={st.seven_day_pause_at} />
              <p className="text-xs text-zinc-500">
                {st.usage_snapshot_at ? `Última lectura: ${when(st.usage_snapshot_at)}.` : 'Aún no hay ninguna lectura.'} Es la cuota de tu suscripción, compartida con lo que uses a mano.
              </p>
            </div>
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-zinc-300">Trabajos</h2>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md bg-zinc-950 p-2"><dt className="text-xs text-zinc-500">Últimas 24 h</dt><dd data-count="day">{q.counters.day} / {st.max_per_day}</dd></div>
                <div className="rounded-md bg-zinc-950 p-2"><dt className="text-xs text-zinc-500">Últimos 7 días</dt><dd data-count="week">{q.counters.week} / {st.max_per_week}</dd></div>
                <div className="rounded-md bg-zinc-950 p-2"><dt className="text-xs text-zinc-500">En cola</dt><dd data-count="queued">{q.counters.queued}</dd></div>
                <div className="rounded-md bg-zinc-950 p-2"><dt className="text-xs text-zinc-500">Ejecutando</dt><dd data-count="running">{q.counters.running}</dd></div>
              </dl>
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input type="checkbox" checked={st.auto_tag} disabled={busy}
                  onChange={(e) => void patch({ auto_tag: e.target.checked }, e.target.checked ? 'Etiquetado automático activado.' : 'Etiquetado automático desactivado.')} />
                Etiquetar ideas nuevas con IA
              </label>
            </div>
          </section>

          <details className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm">
            <summary className="cursor-pointer font-semibold text-zinc-300">Límites</summary>
            {form && (
              <form className="mt-3 grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void saveLimits(); }}>
                {([['day', 'Máx. por 24 h'], ['week', 'Máx. por 7 días'], ['five', 'Pausar 5 h al (%)'], ['seven', 'Pausar semana al (%)']] as const).map(([k, label]) => (
                  <label key={k} className="space-y-1 text-xs text-zinc-400">{label}
                    <input inputMode="numeric" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100" />
                  </label>
                ))}
                <button disabled={busy} className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700 disabled:opacity-50 sm:col-span-4 sm:w-fit">Guardar límites</button>
              </form>
            )}
            <p className="mt-2 text-xs text-zinc-500">Rangos: 1–500 por día, 1–2000 por semana, 10–100 % de umbral. Menos margen para el worker = más para ti a mano.</p>
          </details>

          <section>
            <div className="mb-2 flex items-center gap-3">
              <h2 className="text-sm font-semibold text-zinc-300">Historial</h2>
              <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar por estado"
                className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-300">
                <option value="">Todos</option>
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <ul className="space-y-1">
              {jobs.map((j) => {
                const tk = tokens(j.usage); const d = dur(j.started_at, j.finished_at);
                return (
                  <li key={j.id} data-job className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[j.status]}`}>{STATUS_LABEL[j.status]}</span>
                      <span className="font-medium">{TASK_LABEL[j.task] ?? j.task}</span>
                      {j.error_class && <span className="text-xs text-red-400">{ERROR_LABEL[j.error_class] ?? j.error_class}</span>}
                      {j.accepted_at && <span className="text-xs text-emerald-400">aceptado</span>}
                      {j.dismissed_at && <span className="text-xs text-zinc-500">ignorado</span>}
                      <span className="ml-auto text-xs text-zinc-500">{when(j.created_at)}</span>
                      {j.status === 'queued' && <button onClick={() => void cancel(j)} className="text-xs text-zinc-400 underline hover:text-zinc-200">Cancelar</button>}
                      {(j.error || j.input) && <button onClick={() => setOpen(open === j.id ? null : j.id)} className="text-xs text-zinc-400 hover:text-zinc-200">{open === j.id ? 'Cerrar' : 'Detalle'}</button>}
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {[j.provider && `${j.provider}${j.model ? ` · ${j.model}` : ''}`, j.attempts ? `${j.attempts} intento(s)` : null, d, tk,
                        j.review?.revised ? 'segunda pasada' : null].filter(Boolean).join(' · ') || 'sin ejecutar todavía'}
                    </p>
                    {open === j.id && (
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 text-xs text-zinc-400">
                        {j.error ? `Error: ${j.error}\n\n` : ''}{`Entrada: ${JSON.stringify({ ...j.input, prev: undefined, feedback: undefined }, null, 2).slice(0, 1500)}`}
                      </pre>
                    )}
                  </li>
                );
              })}
              {jobs.length === 0 && <p className="text-sm text-zinc-500">Sin trabajos.</p>}
            </ul>
            <p className="mt-2 text-xs text-zinc-500">Se muestran los 50 más recientes. Solo se cancelan los que siguen en cola.</p>
          </section>
        </>
      )}
    </div>
  );
}
