'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, FORMATS, Idea, PLATFORMS } from '@/lib/api';
import { Nav } from './Nav';

type Tab = Idea['status'];
const TABS: [Tab, string][] = [['nueva', 'Nuevas'], ['descartada', 'Descartadas'], ['promovida', 'En pipeline']];
const input = 'rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm';

function IdeaRow({ idea, onChange }: { idea: Idea; onChange: () => void }) {
  const [tags, setTags] = useState(idea.tags.join(', '));
  const [platform, setPlatform] = useState('');
  const [format, setFormat] = useState('');
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try { await fn(); onChange(); } catch { setError('No se pudo completar la acción.'); }
  };
  const saveTags = () => {
    const next = tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (JSON.stringify(next) === JSON.stringify(idea.tags)) return;
    void run(() => api(`/ideas/${idea.id}`, { method: 'PATCH', body: JSON.stringify({ tags: next }) }));
  };

  return (
    <li className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3" data-idea>
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{idea.title}</p>
        <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">{idea.source}</span>
      </div>
      {idea.notes !== idea.title && <p className="whitespace-pre-line text-sm text-zinc-400">{idea.notes}</p>}
      {idea.status === 'nueva' ? (
        <>
          <input
            value={tags} onChange={(e) => setTags(e.target.value)} onBlur={saveTags}
            placeholder="etiquetas separadas por coma" className={`${input} w-full`} aria-label="Etiquetas"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={input} aria-label="Plataforma">
              <option value="">Plataforma</option>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}
            </select>
            <select value={format} onChange={(e) => setFormat(e.target.value)} className={input} aria-label="Formato">
              <option value="">Formato</option>{FORMATS.map((f) => <option key={f}>{f}</option>)}
            </select>
            <button
              onClick={() => run(() => api(`/ideas/${idea.id}/promote`, {
                method: 'POST', body: JSON.stringify({ platform: platform || null, format: format || null }),
              }))}
              className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-black"
            >Pasar al pipeline</button>
            <button
              onClick={() => run(() => api(`/ideas/${idea.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'descartada' }) }))}
              className="ml-auto text-sm text-zinc-400 hover:text-red-400"
            >Descartar</button>
          </div>
        </>
      ) : idea.tags.length > 0 && <p className="text-xs text-zinc-500">{idea.tags.join(' · ')}</p>}
      {idea.status === 'descartada' && (
        <button
          onClick={() => run(() => api(`/ideas/${idea.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'nueva' }) }))}
          className="text-sm text-zinc-400 hover:text-zinc-200"
        >Restaurar</button>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </li>
  );
}

export function Inbox() {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [tab, setTab] = useState<Tab>('nueva');
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      setIdeas((await api<{ ideas: Idea[] }>('/ideas')).ideas);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) window.location.href = '/login/';
      else setMessage('No se pudo cargar el inbox.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function capture(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await api('/ideas', { method: 'POST', body: JSON.stringify({ text }) });
      setText('');
      setTab('nueva');
      await load();
    } catch { setMessage('No se pudo guardar la idea.'); }
  }

  const shown = (ideas ?? []).filter((i) => i.status === tab);
  const count = (t: Tab) => (ideas ?? []).filter((i) => i.status === t).length;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-4">
      <header className="flex items-center gap-3"><Nav current="/inbox/" /><h1 className="sr-only">Inbox de ideas</h1></header>
      <form onSubmit={capture} className="flex gap-2">
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Captura una idea… (también por Telegram)"
          className={`${input} flex-1`} aria-label="Nueva idea"
        />
        <button className="self-start rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-black">Guardar</button>
      </form>
      {message && <p className="text-sm text-amber-300">{message}</p>}
      <div className="flex gap-1">
        {TABS.map(([t, label]) => (
          <button
            key={t} onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 text-sm ${tab === t ? 'bg-zinc-800 font-semibold' : 'text-zinc-400'}`}
          >{label} <span className="text-zinc-500">{count(t)}</span></button>
        ))}
      </div>
      {ideas === null ? <p className="text-zinc-400">Cargando…</p> : (
        <ul className="space-y-2">
          {shown.map((i) => <IdeaRow key={i.id} idea={i} onChange={load} />)}
          {shown.length === 0 && <p className="text-sm text-zinc-500">Nada aquí.</p>}
        </ul>
      )}
    </div>
  );
}
