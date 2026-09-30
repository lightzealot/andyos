'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, FORMATS, Idea, PLATFORMS } from '@/lib/api';
import { Nav } from './Nav';

type Tab = Idea['status'];
const TABS: [Tab, string][] = [['nueva', 'Nuevas'], ['descartada', 'Descartadas'], ['promovida', 'En pipeline']];
const input = 'rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm';

/** Borrador de etiquetas de la IA: el usuario elige cuáles aceptar. Nada se aplica sin su clic. */
function Suggestion({ idea, onChange }: { idea: Idea; onChange: () => void }) {
  const s = idea.suggestion;
  const [selected, setSelected] = useState<string[]>(s?.tags ?? []);
  const [busy, setBusy] = useState(false);
  // Por defecto quedan marcadas TODAS las etiquetas propuestas. Se recalcula cuando llegan (la sugerencia pasa
  // de "pendiente" a "lista" con el mismo job_id, así que la clave incluye las etiquetas).
  const tagsKey = (s?.tags ?? []).join('|');
  useEffect(() => { setSelected(s?.tags ?? []); }, [s?.job_id, tagsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); onChange(); } finally { setBusy(false); }
  };
  const ask = () => act(() => api('/ai/jobs', { method: 'POST', body: JSON.stringify({ task: 'tag_idea', input: { idea_id: idea.id } }) }));
  const toggle = (t: string) => setSelected((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  if (!s) {
    return <button onClick={ask} disabled={busy} className="text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-50">✨ Sugerir etiquetas con IA</button>;
  }
  if (s.status === 'queued' || s.status === 'running') {
    return <p role="status" data-suggestion="pending" className="text-sm text-zinc-500">✨ Sugiriendo etiquetas…</p>;
  }
  if (s.status === 'failed') {
    return (
      <p data-suggestion="failed" className="text-sm text-zinc-500">
        La IA no pudo sugerir etiquetas. <button onClick={ask} disabled={busy} className="underline hover:text-zinc-300">Reintentar</button>
      </p>
    );
  }
  return (
    <div data-suggestion="done" className="space-y-2 rounded-md border border-orange-900/60 bg-orange-950/20 p-2">
      <p className="text-xs text-orange-300">Borrador de IA · elige las etiquetas que quieres conservar</p>
      <div className="flex flex-wrap gap-1.5">
        {(s.tags ?? []).map((t) => {
          const on = selected.includes(t);
          return (
            <button
              key={t} type="button" onClick={() => toggle(t)} aria-pressed={on} data-chip
              className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-orange-500 bg-orange-500/20 text-orange-200' : 'border-zinc-700 text-zinc-500 line-through'}`}
            >{t}</button>
          );
        })}
      </div>
      <div className="flex items-center gap-3 text-sm">
        <button
          disabled={busy || selected.length === 0}
          onClick={() => act(() => api(`/ai/jobs/${s.job_id}/accept`, { method: 'POST', body: JSON.stringify({ tags: selected }) }))}
          className="rounded-md bg-orange-500 px-3 py-1 font-medium text-black disabled:opacity-40"
        >Aceptar {selected.length}</button>
        <button disabled={busy} onClick={() => act(() => api(`/ai/jobs/${s.job_id}/dismiss`, { method: 'POST' }))} className="text-zinc-400 hover:text-zinc-200">Ignorar</button>
      </div>
    </div>
  );
}

function IdeaRow({ idea, ai, onChange }: { idea: Idea; ai: boolean; onChange: () => void }) {
  const [tags, setTags] = useState(idea.tags.join(', '));
  const [platform, setPlatform] = useState('');
  const [format, setFormat] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setTags(idea.tags.join(', ')); }, [idea.tags.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

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
          {ai && <Suggestion idea={idea} onChange={onChange} />}
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
  // Módulo de IA: null = desconocido, false = no disponible (la cola no está activada en la API)
  const [ai, setAi] = useState<{ auto_tag: boolean } | false | null>(null);

  const load = useCallback(async () => {
    try {
      setIdeas((await api<{ ideas: Idea[] }>('/ideas')).ideas);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) window.location.href = '/login/';
      else setMessage('No se pudo cargar el inbox.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    api<{ state: { auto_tag: boolean } }>('/ai/queue').then((q) => setAi({ auto_tag: q.state.auto_tag })).catch(() => setAi(false));
  }, []);

  // Mientras alguna sugerencia esté pendiente, refresca cada pocos segundos
  const pending = (ideas ?? []).some((i) => i.suggestion?.status === 'queued' || i.suggestion?.status === 'running');
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [pending, load]);

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

  async function toggleAuto() {
    if (!ai) return;
    try {
      const r = await api<{ state: { auto_tag: boolean } }>('/ai/queue', { method: 'PATCH', body: JSON.stringify({ auto_tag: !ai.auto_tag }) });
      setAi({ auto_tag: r.state.auto_tag });
    } catch { setMessage('No se pudo cambiar el ajuste.'); }
  }

  const shown = (ideas ?? []).filter((i) => i.status === tab);
  const count = (t: Tab) => (ideas ?? []).filter((i) => i.status === t).length;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-4">
      <header className="flex items-center gap-3">
        <Nav current="/inbox/" /><h1 className="sr-only">Inbox de ideas</h1>
        {ai && (
          <label className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={ai.auto_tag} onChange={toggleAuto} aria-label="Etiquetado automático con IA" />
            Etiquetar ideas nuevas con IA
          </label>
        )}
      </header>
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
          {shown.map((i) => <IdeaRow key={i.id} idea={i} ai={ai !== false && ai !== null} onChange={load} />)}
          {shown.length === 0 && <p className="text-sm text-zinc-500">Nada aquí.</p>}
        </ul>
      )}
    </div>
  );
}
