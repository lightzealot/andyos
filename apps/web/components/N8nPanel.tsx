'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, N8nExecution, N8nWorkflow } from '@/lib/api';
import { Nav } from './Nav';

const STATUS_STYLE: Record<string, string> = {
  success: 'bg-emerald-900 text-emerald-300', error: 'bg-red-900 text-red-300', crashed: 'bg-red-900 text-red-300',
  running: 'bg-sky-900 text-sky-300', waiting: 'bg-amber-900 text-amber-300', new: 'bg-zinc-800 text-zinc-300',
  canceled: 'bg-zinc-800 text-zinc-400',
};
const Badge = ({ status }: { status: string }) => (
  <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[status] ?? 'bg-zinc-800 text-zinc-300'}`}>{status}</span>
);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export function N8nPanel() {
  const [state, setState] = useState<'loading' | 'unconfigured' | 'unavailable' | 'ok'>('loading');
  const [workflows, setWorkflows] = useState<N8nWorkflow[]>([]);
  const [execs, setExecs] = useState<N8nExecution[]>([]);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const st = await api<{ configured: boolean }>('/n8n/status');
      if (!st.configured) { setState('unconfigured'); return; }
      const [w, e] = await Promise.all([
        api<{ workflows: N8nWorkflow[] }>('/n8n/workflows'),
        api<{ executions: N8nExecution[] }>(`/n8n/executions?limit=30${onlyErrors ? '&status=error' : ''}`),
      ]);
      setWorkflows(w.workflows); setExecs(e.executions); setState('ok');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) window.location.href = '/login/';
      else setState('unavailable');
    }
  }, [onlyErrors]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function trigger(w: N8nWorkflow) {
    if (!confirm(`¿Disparar «${w.name}» ahora? Ejecutará el workflow en n8n.`)) return;
    setBusy(w.id); setNotice('');
    try {
      await api(`/n8n/workflows/${w.id}/trigger`, { method: 'POST', body: JSON.stringify({}) });
      setNotice(`«${w.name}» disparado. Actualizando…`);
      setTimeout(() => void load(), 2000);
    } catch (err) {
      setNotice(err instanceof ApiError && err.code === 'webhook_rejected'
        ? 'n8n rechazó el secreto: revisa N8N_TRIGGER_SECRET y la credencial Header Auth del workflow.'
        : 'No se pudo disparar el workflow.');
    } finally { setBusy(null); }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 p-4">
      <header className="flex items-center gap-3">
        <Nav current="/n8n/" /><h1 className="sr-only">Panel n8n</h1>
        <button onClick={() => void load()} className="ml-auto text-sm text-zinc-400 hover:text-zinc-200">Actualizar</button>
      </header>
      {state === 'loading' && <p className="text-zinc-400">Cargando…</p>}
      {state === 'unavailable' && <p className="rounded-md bg-red-950 px-3 py-2 text-sm text-red-300">No se pudo conectar con n8n. Revisa N8N_BASE_URL y N8N_API_KEY.</p>}
      {state === 'unconfigured' && (
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm">
          <p className="font-medium">Panel n8n sin configurar</p>
          <p className="text-zinc-400">Define en la API las variables <code>N8N_BASE_URL</code>, <code>N8N_API_KEY</code> (solo lectura: alcances <code>workflow:list</code> y <code>execution:list</code>) y <code>N8N_TRIGGER_SECRET</code>. Detalle en <code>docs/variables-de-entorno.md</code>.</p>
        </div>
      )}
      {notice && <p className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-zinc-200">{notice}</p>}
      {state === 'ok' && (
        <>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-300">Workflows <span className="text-zinc-500">{workflows.length}</span></h2>
            <ul className="space-y-2">
              {workflows.map((w) => (
                <li key={w.id} data-wf className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm">
                  <span className={`h-2 w-2 rounded-full ${w.active ? 'bg-emerald-500' : 'bg-zinc-600'}`} title={w.active ? 'activo' : 'inactivo'} />
                  <span className="font-medium">{w.name}</span>
                  {w.tags.map((t) => <span key={t} className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">{t}</span>)}
                  <span className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
                    {w.recent_errors > 0 && <span className="text-red-400">{w.recent_errors} error(es) recientes</span>}
                    {w.last ? <><Badge status={w.last.status} />{when(w.last.started_at)}</> : 'sin ejecuciones'}
                  </span>
                  {w.triggerable && (
                    <button
                      onClick={() => trigger(w)} disabled={busy === w.id}
                      className="rounded-md bg-orange-500 px-3 py-1 text-xs font-medium text-black disabled:opacity-50"
                    >{busy === w.id ? 'Disparando…' : 'Disparar'}</button>
                  )}
                </li>
              ))}
              {workflows.length === 0 && <p className="text-sm text-zinc-500">No hay workflows.</p>}
            </ul>
            <p className="mt-2 text-xs text-zinc-500">Solo se pueden disparar desde aquí los workflows activos con la etiqueta <code>andyos-trigger</code> y un Webhook POST con Header Auth.</p>
          </section>
          <section>
            <div className="mb-2 flex items-center gap-3">
              <h2 className="text-sm font-semibold text-zinc-300">Ejecuciones recientes</h2>
              <label className="flex items-center gap-1 text-xs text-zinc-400">
                <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> solo errores
              </label>
            </div>
            <ul className="space-y-1">
              {execs.map((x) => (
                <li key={x.id} data-exec className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm">
                  <Badge status={x.status} /><span>{x.workflow_name}</span>
                  <span className="ml-auto text-xs text-zinc-500">#{x.id} · {x.mode ?? ''} · {when(x.started_at)}</span>
                </li>
              ))}
              {execs.length === 0 && <p className="text-sm text-zinc-500">Sin ejecuciones.</p>}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
