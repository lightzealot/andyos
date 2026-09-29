'use client';
import { useState } from 'react';
import { api, ApiError, FORMATS, Item, PLATFORMS, STATUSES, STATUS_LABEL } from '@/lib/api';

const SCRIPT_PARTS = [
  ['hook', 'Hook'], ['contexto', 'Contexto'], ['cambio', 'Cambio'],
  ['aplicacion', 'Aplicación / Demo'], ['resultado', 'Resultado'], ['cta', 'CTA'],
] as const;

interface Props {
  item: Item;
  onClose: () => void;
  onSaved: (i: Item) => void;
  onDeleted: () => void;
}

export function ItemDialog({ item, onClose, onSaved, onDeleted }: Props) {
  const [f, setF] = useState({
    title: item.title, status: item.status, platform: item.platform ?? '', format: item.format ?? '',
    hook: item.hook, caption: item.caption, notes: item.notes,
  });
  const [script, setScript] = useState<Record<string, string>>(item.script ?? {});
  const [error, setError] = useState('');

  async function run(fn: () => Promise<Item>) {
    setError('');
    try { onSaved(await fn()); } catch (e) {
      setError(e instanceof ApiError && e.code === 'approval_required'
        ? 'Requiere aprobación humana previa.' : 'No se pudo guardar.');
    }
  }

  const save = () => run(() => api<Item>(`/items/${item.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...f, platform: f.platform || null, format: f.format || null, script }),
  }));
  const approve = () => run(() => api<Item>(`/items/${item.id}/approve`, { method: 'POST' }));

  const input = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm';
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-5" onClick={(e) => e.stopPropagation()}>
        <input className={`${input} text-base font-semibold`} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <div className="grid grid-cols-3 gap-2">
          <select className={input} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Item['status'] })}>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select className={input} value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>
            <option value="">Plataforma</option>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}
          </select>
          <select className={input} value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}>
            <option value="">Formato</option>{FORMATS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <label className="block text-xs text-zinc-400">Hook
          <textarea className={input} rows={2} value={f.hook} onChange={(e) => setF({ ...f, hook: e.target.value })} />
        </label>
        {SCRIPT_PARTS.map(([k, label]) => (
          <label key={k} className="block text-xs text-zinc-400">{label}
            <textarea className={input} rows={2} value={script[k] ?? ''} onChange={(e) => setScript({ ...script, [k]: e.target.value })} />
          </label>
        ))}
        <label className="block text-xs text-zinc-400">Caption
          <textarea className={input} rows={3} value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} />
        </label>
        <label className="block text-xs text-zinc-400">Notas
          <textarea className={input} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex items-center gap-2">
          <button onClick={save} className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-black">Guardar</button>
          {item.status === 'aprobacion' && !item.approved_at && (
            <button onClick={approve} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium">Aprobar contenido</button>
          )}
          {item.approved_at && <span className="text-sm text-emerald-400">Aprobado {new Date(item.approved_at).toLocaleString()}</span>}
          <button
            onClick={async () => { if (confirm('¿Archivar esta tarjeta?')) { await api(`/items/${item.id}`, { method: 'DELETE' }); onDeleted(); } }}
            className="ml-auto text-sm text-red-400"
          >Archivar</button>
          <button onClick={onClose} className="text-sm text-zinc-400">Cerrar</button>
        </div>
      </div>
    </div>
  );
}
