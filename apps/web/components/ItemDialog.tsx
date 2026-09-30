'use client';
import { useEffect, useState } from 'react';
import { fromInputValue, toInputValue } from '@/lib/dates';
import { api, ApiError, FORMATS, Item, PLATFORMS, Reference, STATUSES, STATUS_LABEL } from '@/lib/api';
import { CAROUSEL_STATES, FOLDER_RE, startPrompt, suggestFolder } from '@/lib/carousel';

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
    scheduled: toInputValue(item.scheduled_at),
    folder: item.carousel_folder ?? '', cstate: item.carousel_state ?? '',
  });
  const [copied, setCopied] = useState('');
  // Referencias en las que se inspira esta tarjeta («Crear contenido inspirado»); si falla, simplemente no se muestran
  const [inspired, setInspired] = useState<Reference[]>([]);
  useEffect(() => {
    let alive = true;
    api<{ references: Reference[] }>(`/references?content_id=${item.id}`)
      .then((r) => { if (alive) setInspired(r.references.filter((x) => x.linked)); })
      .catch(() => { if (alive) setInspired([]); });
    return () => { alive = false; };
  }, [item.id]);
  const [script, setScript] = useState<Record<string, string>>(item.script ?? {});
  const [error, setError] = useState('');

  async function run(fn: () => Promise<Item>) {
    setError('');
    try { onSaved(await fn()); } catch (e) {
      setError(e instanceof ApiError && e.code === 'approval_required'
        ? 'Requiere aprobación humana previa.' : 'No se pudo guardar.');
    }
  }

  const folderOk = !f.folder.trim() || FOLDER_RE.test(f.folder.trim());
  async function copyStart() {
    const text = startPrompt({ title: f.title, hook: f.hook, caption: f.caption, notes: f.notes, script }, f.folder.trim());
    try { await navigator.clipboard.writeText(text); setCopied('Copiado. Pégalo en Claude Code, dentro de la carpeta CarruselOS.'); }
    catch { setCopied('No se pudo copiar automáticamente: selecciona el texto de abajo.'); }
    setPromptText(text);
  }
  const [promptText, setPromptText] = useState('');
  const save = () => folderOk ? run(() => api<Item>(`/items/${item.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title: f.title, status: f.status, hook: f.hook, caption: f.caption, notes: f.notes,
      platform: f.platform || null, format: f.format || null, script: f.hook !== item.hook ? { ...script, hook: f.hook } : script,
      scheduled_at: fromInputValue(f.scheduled),
      carousel_folder: f.folder.trim() || null, carousel_state: f.cstate || null,
    }),
  })) : setError('Carpeta no válida: solo letras, números, punto, guion y guion bajo (sin espacios ni barras).');
  const approve = () => run(() => api<Item>(`/items/${item.id}/approve`, { method: 'POST' }));

  const input = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm';
  return (
    <div className="modal-overlay fixed inset-0 z-20 grid place-items-center p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto modal-panel rounded-[1.6rem] p-5" onClick={(e) => e.stopPropagation()}>
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
        {inspired.length > 0 && (
          <p data-inspired className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            Inspirado en:
            {inspired.map((r) => (
              <a key={r.id} href="/references/" title={[r.creator, r.hook_pattern].filter(Boolean).join(' · ')} className="rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-200 hover:underline">{r.title}{r.creator ? ` · ${r.creator}` : ''}</a>
            ))}
          </p>
        )}
        {f.format === 'carousel' && (
          <section data-carousel className="space-y-2 rounded-lg border border-zinc-700 bg-zinc-950 p-3">
            <p className="text-xs font-semibold text-zinc-300">CarruselOS <span className="font-normal text-zinc-500">· solo seguimiento: aprobar, generar y publicar siguen siendo cosa tuya</span></p>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-zinc-400">Carpeta en <code>proyectos/</code>
                <input className={`${input} ${folderOk ? '' : 'border-red-500'}`} value={f.folder} placeholder="2026-09-30-tema"
                  onChange={(e) => setF({ ...f, folder: e.target.value })} />
              </label>
              <label className="block text-xs text-zinc-400">Estado en CarruselOS
                <select className={input} value={f.cstate} onChange={(e) => setF({ ...f, cstate: e.target.value })}>
                  <option value="">Sin empezar</option>{CAROUSEL_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {!f.folder.trim() && <button type="button" onClick={() => setF({ ...f, folder: suggestFolder(f.title) })} className="text-zinc-400 underline hover:text-zinc-200">Sugerir carpeta</button>}
              <button type="button" onClick={() => void copyStart()} className="rounded-md bg-zinc-800 px-2.5 py-1 hover:bg-zinc-700">Copiar prompt de arranque</button>
              {copied && <span className="text-zinc-400">{copied}</span>}
            </div>
            {promptText && <textarea readOnly rows={6} className={`${input} text-xs text-zinc-400`} value={promptText} onFocus={(e) => e.currentTarget.select()} />}
            <p className="text-xs text-zinc-500">El estado lo actualizas tú a mano: AndyOS no ve tu disco. El de aquí y el de la aprobación del Pipeline son independientes.</p>
          </section>
        )}
        <label className="block text-xs text-zinc-400">Fecha objetivo de publicación
          <input type="datetime-local" className={input} value={f.scheduled} onChange={(e) => setF({ ...f, scheduled: e.target.value })} />
        </label>
        {SCRIPT_PARTS.map(([k, label]) => (
          <label key={k} className="block text-xs text-zinc-400">{label}
            <textarea className={input} rows={2} value={k === 'hook' ? f.hook : script[k] ?? ''}
              onChange={(e) => (k === 'hook' ? setF({ ...f, hook: e.target.value }) : setScript({ ...script, [k]: e.target.value }))} />
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
          <a href={`/studio/?id=${item.id}`} className="text-sm text-orange-400 hover:underline">✨ Abrir en el Estudio</a>
          <button onClick={onClose} className="text-sm text-zinc-400">Cerrar</button>
        </div>
      </div>
    </div>
  );
}
