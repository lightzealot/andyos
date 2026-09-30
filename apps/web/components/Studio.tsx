'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, Item, Job, QueueInfo, Reference, SCRIPT_PARTS, STATUS_LABEL } from '@/lib/api';
import { RefPicker } from './RefPicker';
import {
  box, btnGhost, btnPrimary, DraftFrame, FieldEditor, inputCls, Marked, Pending,
} from './StudioParts';
import { VoicePanel } from './VoicePanel';

type Tab = 'pack' | 'hooks' | 'script' | 'caption' | 'voice';
const TABS: [Tab, string][] = [['pack', 'Paquete'], ['hooks', 'Hooks'], ['script', 'Guion'], ['caption', 'Caption'], ['voice', 'Mi voz']];
const TASK_OF: Record<Exclude<Tab, 'voice'>, Job['task']> = { pack: 'pack', hooks: 'hooks', script: 'script', caption: 'caption' };
const MAX_VERSIONS = 5;
const SECTIONS = [['hook', 'Hook'], ['script', 'Guion'], ['caption', 'Caption']] as const;
const PACK_PARTS = SCRIPT_PARTS.filter(([k]) => k !== 'hook');
interface PackVersion { angle: string; hook: string; caption: string; [k: string]: string }
const CAPTION_LABEL: Record<string, string> = { corta: 'Corta', gancho: 'Gancho', cta: 'CTA directo' };
const ALL_PARTS = SCRIPT_PARTS.map(([k]) => k as string);

/** Títulos de las referencias con las que se pidió el borrador. */
const refsOf = (j: Job) => ((j.input.references as { title: string }[] | undefined) ?? []).map((r) => r.title);

/** ¿Sigue esperando una decisión humana? Un borrador aceptado, ignorado o cancelado ya no se muestra. */
const actionable = (j: Job) => !j.accepted_at && !j.dismissed_at && j.status !== 'canceled';

export function Studio() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('pack');
  const [queue, setQueue] = useState<QueueInfo | false | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState('');
  const [angle, setAngle] = useState('');
  const [pickHook, setPickHook] = useState<Record<string, number>>({});
  const [pickCaption, setPickCaption] = useState<Record<string, number>>({});
  const [pickParts, setPickParts] = useState<Record<string, string[]>>({});
  const [versions, setVersions] = useState(3);
  const [refs, setRefs] = useState<Reference[] | null>(null);
  const [pickRefs, setPickRefs] = useState<string[]>([]);
  const [pickPack, setPickPack] = useState<Record<string, { version?: number; sections: string[] }>>({});

  const item = useMemo(() => items?.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  const loadItems = useCallback(async () => {
    try {
      const list = (await api<{ items: Item[] }>('/items?type=content')).items;
      setItems(list);
      setSelectedId((cur) => {
        if (cur && list.some((i) => i.id === cur)) return cur;
        const wanted = new URLSearchParams(window.location.search).get('id');
        return list.find((i) => i.id === wanted)?.id ?? list[0]?.id ?? null;
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) window.location.href = '/login/';
    }
  }, []);
  const loadQueue = useCallback(async () => {
    try { setQueue(await api<QueueInfo>('/ai/queue')); } catch { setQueue(false); }
  }, []);
  const loadJobs = useCallback(async (id: string) => {
    try {
      setJobs((await api<{ jobs: Job[] }>(`/ai/jobs?target_id=${id}&task=pack,hooks,script,caption,humanize&limit=60`)).jobs);
    } catch { setJobs([]); }
  }, []);
  const refreshItem = useCallback(async (id: string) => {
    const fresh = await api<Item>(`/items/${id}`);
    setItems((cur) => cur?.map((i) => (i.id === id ? fresh : i)) ?? cur);
    return fresh;
  }, []);

  useEffect(() => { void loadItems(); void loadQueue(); }, [loadItems, loadQueue]);
  useEffect(() => {
    if (!selectedId || queue === false) { setJobs([]); return; }
    void loadJobs(selectedId);
    window.history.replaceState(null, '', `?id=${selectedId}`);
  }, [selectedId, queue, loadJobs]);

  // Referencias disponibles; se preseleccionan las ya enlazadas a este contenido (máx. 3)
  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    setRefs(null); setPickRefs([]);
    api<{ references: Reference[] }>(`/references?content_id=${selectedId}`)
      .then((r) => { if (alive) { setRefs(r.references); setPickRefs(r.references.filter((x) => x.linked).slice(0, 3).map((x) => x.id)); } })
      .catch(() => { if (alive) setRefs([]); });
    return () => { alive = false; };
  }, [selectedId]);

  // Mientras haya un trabajo en marcha se consulta cada pocos segundos
  const working = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    if (!working || !selectedId) return;
    const t = setInterval(() => { void loadJobs(selectedId); void loadQueue(); }, 3000);
    return () => clearInterval(t);
  }, [working, selectedId, loadJobs, loadQueue]);

  const latest = (task: Job['task']) => jobs.find((j) => j.task === task); // ya vienen de más nuevo a más viejo
  const draftOf = (task: Job['task']) => { const j = latest(task); return j && actionable(j) ? j : null; };
  const humanizeOf = (field: string) => {
    const j = jobs.find((x) => x.task === 'humanize' && x.input.field === field);
    return j && actionable(j) && j.status !== 'failed' ? j : null;
  };

  async function generate(task: Job['task'], input: Record<string, unknown>) {
    if (!selectedId) return;
    setBusy(true); setNotice('');
    try {
      await api('/ai/jobs', { method: 'POST', body: JSON.stringify({ task, input: { content_id: selectedId, ...input } }) });
      await loadJobs(selectedId); await loadQueue();
    } catch (e) {
      setNotice(e instanceof ApiError && e.code === 'queue_full' ? 'La cola está llena; espera a que termine algo.' : 'No se pudo pedir el borrador.');
    } finally { setBusy(false); }
  }

  /** Aceptar (con la selección) o ignorar. Avisa si el cambio retiró una aprobación. */
  async function decide(job: Job, accept: boolean, body?: object) {
    if (!selectedId) return;
    const before = item?.approved_at;
    setBusy(true); setNotice('');
    try {
      await api(`/ai/jobs/${job.id}/${accept ? 'accept' : 'dismiss'}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      const fresh = await refreshItem(selectedId); await loadJobs(selectedId);
      if (accept) setNotice(before && !fresh.approved_at ? 'Listo. Como cambió el contenido, se retiró su aprobación: vuelve a estar en Aprobación.' : 'Listo, guardado en el contenido.');
    } catch { setNotice('No se pudo aplicar el borrador.'); }
    finally { setBusy(false); }
  }

  async function saveField(patch: object) {
    if (!selectedId) return;
    const before = item?.approved_at;
    const saved = await api<Item>(`/items/${selectedId}`, { method: 'PATCH', body: JSON.stringify(patch) });
    setItems((cur) => cur?.map((i) => (i.id === saved.id ? saved : i)) ?? cur);
    setNotice(before && !saved.approved_at ? 'Guardado. Como cambiaste el contenido, se retiró su aprobación.' : 'Guardado.');
  }

  const paused = queue && queue.state.paused;
  const canAsk = Boolean(queue) && !paused;

  const askForm = (task: Exclude<Tab, 'voice'>, label: string) => (
    <div className="space-y-2">
      <input className={inputCls} placeholder="Tema o enfoque (opcional)" aria-label="Tema o enfoque" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={500} />
      <input className={inputCls} placeholder="Ángulo (opcional): confesión, error común…" aria-label="Ángulo" value={angle} onChange={(e) => setAngle(e.target.value)} maxLength={300} />
      <RefPicker refs={refs} picked={pickRefs} onChange={setPickRefs} />
      {task === 'pack' && (
        <label className="flex items-center gap-2 text-sm text-zinc-300">Versiones
          <select className={`${inputCls} w-20`} aria-label="Número de versiones" value={versions} onChange={(e) => setVersions(Number(e.target.value))}>
            {Array.from({ length: MAX_VERSIONS }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="text-xs text-zinc-500">una sola llamada; hasta {MAX_VERSIONS}</span>
        </label>
      )}
      <button
        disabled={busy || !canAsk} data-generate={task}
        onClick={() => generate(TASK_OF[task], { ...(topic.trim() && { topic: topic.trim() }), ...(angle.trim() && { angle: angle.trim() }), ...(task === 'pack' && { versions }), ...(pickRefs.length > 0 && { reference_ids: pickRefs }) })}
        className={btnPrimary}
      >✨ {task === 'pack' ? `Generar paquete (${versions} ${versions === 1 ? 'versión' : 'versiones'})` : label}</button>
    </div>
  );

  function panel(task: Exclude<Tab, 'voice'>, label: string, render: (job: Job) => React.ReactNode) {
    const job = draftOf(TASK_OF[task]);
    return (
      <div className="space-y-3" data-panel={task}>
        {(!job || job.status === 'failed') && askForm(task, label)}
        {job && (job.status === 'queued' || job.status === 'running') && <Pending job={job} />}
        {job?.status === 'failed' && (
          <p data-draft="failed" className="text-sm text-red-300">
            No se pudo generar ({job.error_class ?? 'error'}). Puedes reintentarlo.
            <button className="ml-2 underline" disabled={busy} onClick={() => decide(job, false)}>Descartar aviso</button>
          </p>
        )}
        {job?.status === 'done' && (
          <DraftFrame job={job} busy={busy} onIgnore={() => decide(job, false)}>
            {refsOf(job).length > 0 && <p data-used-refs className="mb-2 text-xs text-zinc-500">Con la estructura de: {refsOf(job).join(' · ')}</p>}
            {render(job)}
          </DraftFrame>
        )}
      </div>
    );
  }

  const FIELDS = [
    { key: 'hook', label: 'Hook', kind: 'hook' as const, humanize: 'hook', value: item ? item.hook || item.script.hook || '' : '' },
    ...SCRIPT_PARTS.filter(([k]) => k !== 'hook').map(([k, l]) => ({ key: k as string, label: l as string, kind: 'script' as const, humanize: `script.${k}`, value: item?.script[k] ?? '' })),
    { key: 'caption', label: 'Caption', kind: 'caption' as const, humanize: 'caption', value: item?.caption ?? '' },
  ];
  const patchFor = (key: string, v: string) => {
    if (!item) return {};
    if (key === 'caption') return { caption: v };
    if (key === 'hook') return { hook: v, script: { ...item.script, hook: v } };
    return { script: { ...item.script, [key]: v } };
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Estudio de guiones</h1>
        {items && items.length > 0 && (
          <select className={`${inputCls} w-72`} aria-label="Contenido" value={selectedId ?? ''} onChange={(e) => { setSelectedId(e.target.value); setNotice(''); }}>
            {items.map((i) => <option key={i.id} value={i.id}>{i.title} · {STATUS_LABEL[i.status]}</option>)}
          </select>
        )}
        {queue && (
          <span className="ml-auto text-xs text-zinc-500" data-queue>
            {paused ? `⏸ Cola pausada (${queue.state.paused_reason})` : `Trabajos hoy ${queue.counters.day}/${queue.state.max_per_day}`}
            {queue.state.usage_snapshot?.five_hour && ` · cuota 5 h ${Math.round(queue.state.usage_snapshot.five_hour.utilization * 100)} %`}
            {queue.state.usage_snapshot?.seven_day && ` · semana ${Math.round(queue.state.usage_snapshot.seven_day.utilization * 100)} %`}
          </span>
        )}
      </header>

      {queue === false && (
        <p className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-zinc-400" data-noai>
          La cola de IA no está activada en la API (falta <code>WORKER_TOKEN</code>). Puedes editar tu voz y tus textos, pero no generar borradores.
        </p>
      )}
      {paused && <p className="rounded-md bg-amber-950 px-3 py-2 text-sm text-amber-200" data-paused>La cola de IA está pausada ({queue && queue.state.paused_reason}); no se pueden pedir borradores hasta que se reanude.</p>}
      {notice && <p role="status" data-notice className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-zinc-200">{notice}</p>}

      {items === null ? <p className="text-zinc-400">Cargando…</p>
        : items.length === 0 ? <p className="text-sm text-zinc-500">No hay contenido en el Pipeline. Crea una idea y pásala al Pipeline para trabajarla aquí.</p>
        : item && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
            <section className={`${box} space-y-3`}>
              <div className="flex gap-1">
                {TABS.map(([t, l]) => (
                  <button key={t} onClick={() => setTab(t)} data-tab={t}
                    className={`rounded-md px-3 py-1 text-sm ${tab === t ? 'bg-zinc-800 font-semibold' : 'text-zinc-400'}`}>{l}</button>
                ))}
              </div>

              {tab === 'pack' && panel('pack', 'Generar paquete', (job) => {
                const out = job.output as { versions: PackVersion[] };
                const pk = pickPack[job.id] ?? { sections: SECTIONS.map(([k]) => k) as string[] };
                const setPk = (p: Partial<typeof pk>) => setPickPack({ ...pickPack, [job.id]: { ...pk, ...p } });
                const toggle = (k: string) => setPk({ sections: pk.sections.includes(k) ? pk.sections.filter((x) => x !== k) : [...pk.sections, k] });
                return (
                  <div className="space-y-3" data-pack>
                    {out.versions.map((v, i) => (
                      <label key={i} data-version={i} className={`block cursor-pointer space-y-1.5 rounded-lg border p-3 text-sm ${pk.version === i ? 'border-orange-500 bg-orange-500/10' : 'border-zinc-800'}`}>
                        <span className="flex items-center gap-2">
                          <input type="radio" name={`pack-${job.id}`} checked={pk.version === i} onChange={() => setPk({ version: i })} aria-label={`Versión ${i + 1}`} />
                          <b>Versión {i + 1}</b><span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{v.angle}</span>
                        </span>
                        <span className="block"><span className="text-xs text-zinc-500">Hook</span><br /><Marked text={v.hook} /></span>
                        <details className="text-zinc-300">
                          <summary className="cursor-pointer text-xs text-zinc-500">Guion (5 partes)</summary>
                          <span className="mt-1 block space-y-1">
                            {PACK_PARTS.map(([k, l]) => <span key={k} className="block"><span className="text-xs text-zinc-500">{l}: </span><Marked text={v[k]} /></span>)}
                          </span>
                        </details>
                        <span className="block"><span className="text-xs text-zinc-500">Caption</span><br /><span className="whitespace-pre-line"><Marked text={v.caption} /></span></span>
                      </label>
                    ))}
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="text-xs text-zinc-500">Aplicar:</span>
                      {SECTIONS.map(([k, l]) => (
                        <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={pk.sections.includes(k)} onChange={() => toggle(k)} aria-label={`Aplicar ${l}`} />{l}</label>
                      ))}
                    </div>
                    <button disabled={busy || pk.version === undefined || pk.sections.length === 0} data-use className={btnPrimary}
                      onClick={() => decide(job, true, { version: pk.version, sections: pk.sections })}>
                      {pk.version === undefined ? 'Elige una versión' : `Usar la versión ${pk.version + 1}`}
                    </button>
                  </div>
                );
              })}

              {tab === 'hooks' && panel('hooks', 'Generar 5 hooks', (job) => {
                const out = job.output as { hooks: { text: string; angle: string }[] };
                const pick = pickHook[job.id];
                return (
                  <div className="space-y-2">
                    {out.hooks.map((h, i) => (
                      <label key={i} data-option className={`flex cursor-pointer gap-2 rounded-md border p-2 text-sm ${pick === i ? 'border-orange-500 bg-orange-500/10' : 'border-zinc-800'}`}>
                        <input type="radio" name={`hook-${job.id}`} checked={pick === i} onChange={() => setPickHook({ ...pickHook, [job.id]: i })} aria-label={`Hook ${i + 1}`} />
                        <span><span className="text-xs text-zinc-500">{h.angle}</span><br /><Marked text={h.text} /></span>
                      </label>
                    ))}
                    <button disabled={busy || pick === undefined} onClick={() => decide(job, true, { index: pick })} className={btnPrimary} data-use>Usar este hook</button>
                  </div>
                );
              })}

              {tab === 'script' && panel('script', 'Generar guion completo', (job) => {
                const out = job.output as Record<string, string>;
                const sel = pickParts[job.id] ?? ALL_PARTS; // por defecto, todas las partes
                const toggle = (k: string) => setPickParts({ ...pickParts, [job.id]: sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k] });
                return (
                  <div className="space-y-2">
                    {SCRIPT_PARTS.map(([k, l]) => (
                      <label key={k} data-part={k} className={`flex cursor-pointer gap-2 rounded-md border p-2 text-sm ${sel.includes(k) ? 'border-orange-500/60' : 'border-zinc-800 opacity-60'}`}>
                        <input type="checkbox" checked={sel.includes(k)} onChange={() => toggle(k)} aria-label={l} />
                        <span><span className="text-xs text-zinc-500">{l}</span><br /><Marked text={out[k]} /></span>
                      </label>
                    ))}
                    <button disabled={busy || sel.length === 0} onClick={() => decide(job, true, { parts: sel })} className={btnPrimary} data-use>Usar {sel.length} parte(s)</button>
                  </div>
                );
              })}

              {tab === 'caption' && panel('caption', 'Generar 3 captions', (job) => {
                const out = job.output as { options: { label: string; text: string }[] };
                const pick = pickCaption[job.id];
                return (
                  <div className="space-y-2">
                    {out.options.map((o, i) => (
                      <label key={i} data-option className={`flex cursor-pointer gap-2 rounded-md border p-2 text-sm ${pick === i ? 'border-orange-500 bg-orange-500/10' : 'border-zinc-800'}`}>
                        <input type="radio" name={`cap-${job.id}`} checked={pick === i} onChange={() => setPickCaption({ ...pickCaption, [job.id]: i })} aria-label={`Caption ${CAPTION_LABEL[o.label] ?? o.label}`} />
                        <span><span className="text-xs text-zinc-500">{CAPTION_LABEL[o.label] ?? o.label}</span><br /><span className="whitespace-pre-line"><Marked text={o.text} /></span></span>
                      </label>
                    ))}
                    <button disabled={busy || pick === undefined} onClick={() => decide(job, true, { index: pick })} className={btnPrimary} data-use>Usar este caption</button>
                  </div>
                );
              })}

              {tab === 'voice' && <VoicePanel notice={setNotice} />}
            </section>

            <section className={`${box} space-y-4`} data-current>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Contenido actual</h2>
                <span className="text-xs text-zinc-500">
                  {STATUS_LABEL[item.status]}{item.approved_at ? ' · aprobado' : ''}{item.ai_generated ? ' · con texto de IA' : ''}
                </span>
              </div>
              {FIELDS.map((f) => (
                <FieldEditor
                  key={`${item.id}-${f.key}`} label={f.label} value={f.value} kind={f.kind}
                  source={`${item.title}\n${item.notes}`} canHumanize={canAsk}
                  humanizeDraft={humanizeOf(f.humanize)}
                  onSave={(v) => saveField(patchFor(f.key, v))}
                  onHumanize={() => generate('humanize', { field: f.humanize })}
                  onDecision={(job, accept) => decide(job, accept)}
                  notice={setNotice}
                />
              ))}
              <p className="text-xs text-zinc-500">Editar aquí cambia el contenido de verdad. Si estaba aprobado, se retira la aprobación.</p>
            </section>
          </div>
        )}
    </div>
  );
}
