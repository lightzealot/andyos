'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, FORMATS, PLATFORMS, Reference } from '@/lib/api';
import { Nav } from './Nav';

const input = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm';

interface Draft {
  title: string; url: string; creator: string; platform: string; format: string;
  why_it_works: string; hook_pattern: string; tags: string;
}
const toDraft = (r?: Reference): Draft => ({
  title: r?.title ?? '', url: r?.url ?? '', creator: r?.creator ?? '', platform: r?.platform ?? '',
  format: r?.format ?? '', why_it_works: r?.why_it_works ?? '', hook_pattern: r?.hook_pattern ?? '',
  tags: r?.tags.join(', ') ?? '',
});
const toBody = (d: Draft) => ({
  title: d.title, url: d.url.trim() || null, creator: d.creator, platform: d.platform || null,
  format: d.format || null, why_it_works: d.why_it_works, hook_pattern: d.hook_pattern,
  tags: d.tags.split(',').map((t) => t.trim()).filter(Boolean),
});

function RefForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial?: Reference; submitLabel: string; onSubmit: (d: Draft) => Promise<void>; onCancel?: () => void;
}) {
  const [d, setD] = useState<Draft>(toDraft(initial));
  const [error, setError] = useState('');
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setD({ ...d, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try { await onSubmit(d); if (!initial) setD(toDraft()); } catch { setError('No se pudo guardar. Revisa que la URL sea http(s).'); }
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <input className={input} placeholder="Título (obligatorio)" value={d.title} onChange={set('title')} aria-label="Título" />
      <div className="grid grid-cols-2 gap-2">
        <input className={input} placeholder="URL https://…" value={d.url} onChange={set('url')} aria-label="URL" />
        <input className={input} placeholder="Creador (@usuario)" value={d.creator} onChange={set('creator')} aria-label="Creador" />
        <select className={input} value={d.platform} onChange={set('platform')} aria-label="Plataforma">
          <option value="">Plataforma</option>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select className={input} value={d.format} onChange={set('format')} aria-label="Formato">
          <option value="">Formato</option>{FORMATS.map((f) => <option key={f}>{f}</option>)}
        </select>
      </div>
      <textarea className={input} rows={3} placeholder="¿Por qué funciona? (gancho, estructura, emoción, prueba…)" value={d.why_it_works} onChange={set('why_it_works')} aria-label="Por qué funciona" />
      <input className={input} placeholder="Patrón de hook (ej. cifra + promesa)" value={d.hook_pattern} onChange={set('hook_pattern')} aria-label="Patrón de hook" />
      <input className={input} placeholder="Etiquetas separadas por coma" value={d.tags} onChange={set('tags')} aria-label="Etiquetas" />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-black">{submitLabel}</button>
        {onCancel && <button type="button" onClick={onCancel} className="text-sm text-zinc-400">Cancelar</button>}
      </div>
    </form>
  );
}

function RefCard({ r, onChange, onNotice }: { r: Reference; onChange: () => void; onNotice: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3" data-ref>
      {editing ? (
        <RefForm
          initial={r} submitLabel="Guardar" onCancel={() => setEditing(false)}
          onSubmit={async (d) => { await api(`/references/${r.id}`, { method: 'PATCH', body: JSON.stringify(toBody(d)) }); setEditing(false); onChange(); }}
        />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-medium">{r.title}</h3>
            <div className="flex shrink-0 gap-1 text-xs text-zinc-400">
              {r.platform && <span className="rounded bg-zinc-800 px-1.5 py-0.5">{r.platform}</span>}
              {r.format && <span className="rounded bg-zinc-800 px-1.5 py-0.5">{r.format}</span>}
            </div>
          </div>
          {(r.creator || r.url) && (
            <p className="text-sm text-zinc-400">
              {r.creator}{r.creator && r.url && ' · '}
              {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-orange-400 underline">abrir</a>}
            </p>
          )}
          {r.why_it_works && <p className="whitespace-pre-line text-sm"><span className="text-zinc-500">Por qué funciona: </span>{r.why_it_works}</p>}
          {r.hook_pattern && <p className="text-sm"><span className="text-zinc-500">Patrón: </span>{r.hook_pattern}</p>}
          {r.tags.length > 0 && <p className="text-xs text-zinc-500">{r.tags.join(' · ')}</p>}
          <div className="flex items-center gap-3 pt-1 text-sm">
            <button
              onClick={async () => { await api(`/references/${r.id}/derive`, { method: 'POST' }); onNotice(`Contenido creado en Pipeline → Idea, basado en «${r.title}».`); onChange(); }}
              className="rounded-md bg-orange-500 px-3 py-1 font-medium text-black"
            >Crear contenido inspirado</button>
            {r.derived_count > 0 && <span className="text-zinc-500">{r.derived_count} derivado(s)</span>}
            <button onClick={() => setEditing(true)} className="ml-auto text-zinc-400 hover:text-zinc-200">Editar</button>
            <button
              onClick={async () => { if (confirm('¿Archivar esta referencia?')) { await api(`/items/${r.id}`, { method: 'DELETE' }); onChange(); } }}
              className="text-zinc-400 hover:text-red-400"
            >Archivar</button>
          </div>
        </>
      )}
    </li>
  );
}

export function References() {
  const [refs, setRefs] = useState<Reference[] | null>(null);
  const [q, setQ] = useState('');
  const [platform, setPlatform] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setRefs((await api<{ references: Reference[] }>('/references')).references);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) window.location.href = '/login/';
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const term = q.trim().toLowerCase();
  const shown = (refs ?? []).filter((r) =>
    (!platform || r.platform === platform) &&
    (!term || [r.title, r.creator, r.why_it_works, r.hook_pattern, r.tags.join(' ')].join(' ').toLowerCase().includes(term)));

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-4">
      <header className="flex items-center gap-3"><Nav current="/references/" /><h1 className="sr-only">Referencias</h1></header>
      <div className="flex gap-2">
        <input className={input} placeholder="Buscar en título, creador, por qué funciona, etiquetas…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        <select className={`${input} w-44`} value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Filtrar plataforma">
          <option value="">Todas</option>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}
        </select>
        <button onClick={() => setAdding(!adding)} className="shrink-0 rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-black">
          {adding ? 'Cerrar' : 'Nueva referencia'}
        </button>
      </div>
      {adding && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <RefForm submitLabel="Añadir" onSubmit={async (d) => { await api('/references', { method: 'POST', body: JSON.stringify(toBody(d)) }); setAdding(false); await load(); }} />
        </div>
      )}
      {notice && <p className="rounded-md bg-emerald-950 px-3 py-2 text-sm text-emerald-300">{notice}</p>}
      {refs === null ? <p className="text-zinc-400">Cargando…</p> : (
        <ul className="space-y-2">
          {shown.map((r) => <RefCard key={r.id} r={r} onChange={load} onNotice={setNotice} />)}
          {shown.length === 0 && <p className="text-sm text-zinc-500">Sin referencias que mostrar.</p>}
        </ul>
      )}
    </div>
  );
}
