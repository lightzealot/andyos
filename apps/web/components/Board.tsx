'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  DndContext, DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { api, ApiError, FORMATS, Item, PLATFORMS, Status, STATUSES, STATUS_LABEL } from '@/lib/api';
import { ItemDialog } from './ItemDialog';

function Card({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <div
      ref={setNodeRef} style={style} {...listeners} {...attributes} onClick={onOpen}
      className={`cursor-grab rounded-lg border border-zinc-700 bg-zinc-800 p-3 text-sm shadow ${isDragging ? 'z-10 opacity-80' : ''}`}
    >
      <p className="font-medium">{item.title}</p>
      <div className="mt-2 flex flex-wrap gap-1 text-xs text-zinc-400">
        {item.platform && <span className="rounded bg-zinc-700 px-1.5 py-0.5">{item.platform}</span>}
        {item.format && <span className="rounded bg-zinc-700 px-1.5 py-0.5">{item.format}</span>}
        {item.carousel_state && <span data-carousel-state className="rounded bg-indigo-900 px-1.5 py-0.5 text-indigo-300" title="Estado en CarruselOS">🎠 {item.carousel_state}</span>}
        {item.approved_at && <span className="rounded bg-emerald-900 px-1.5 py-0.5 text-emerald-300">aprobado</span>}
      </div>
    </div>
  );
}

function Column({ status, items, onOpen }: { status: Status; items: Item[]; onOpen: (i: Item) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col rounded-xl border bg-zinc-900 p-2 ${isOver ? 'border-orange-500' : 'border-zinc-800'}`}
    >
      <h2 className="mb-2 flex justify-between px-1 text-sm font-semibold text-zinc-300">
        {STATUS_LABEL[status]} <span className="text-zinc-500">{items.length}</span>
      </h2>
      <div className="flex min-h-24 flex-col gap-2">
        {items.map((i) => <Card key={i.id} item={i} onOpen={() => onOpen(i)} />)}
      </div>
    </section>
  );
}

export function Board() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [message, setMessage] = useState('');
  const [platform, setPlatform] = useState('');
  const [format, setFormat] = useState('');
  const [title, setTitle] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Item[] }>('/items?type=content')).items);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) window.location.href = '/login/';
      else setMessage('No se pudo cargar el tablero.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function onDragEnd(e: DragEndEvent) {
    const item = items?.find((i) => i.id === e.active.id);
    const to = e.over?.id as Status | undefined;
    if (!item || !to || item.status === to) return;
    setMessage('');
    try {
      const updated = await api<Item>(`/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: to }) });
      setItems((cur) => cur!.map((i) => (i.id === updated.id ? updated : i)));
    } catch (err) {
      setMessage(err instanceof ApiError && err.code === 'approval_required'
        ? 'Requiere aprobación humana: llévalo a Aprobación, ábrelo y pulsa «Aprobar».'
        : 'No se pudo mover la tarjeta.');
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await api('/items', {
      method: 'POST',
      body: JSON.stringify({ title, platform: platform || null, format: format || null }),
    });
    setTitle('');
    await load();
  }

  const visible = (items ?? []).filter(
    (i) => (!platform || i.platform === platform) && (!format || i.format === format),
  );

  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-[30rem] flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 p-3">
        <h1 className="text-xl font-bold">Pipeline de contenido</h1>
        <form onSubmit={create} className="flex gap-2">
          <input
            value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nueva idea…"
            className="w-64 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm"
          />
          <button className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-black">Añadir</button>
        </form>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm">
          <option value="">Plataforma: todas</option>
          {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select value={format} onChange={(e) => setFormat(e.target.value)} className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm">
          <option value="">Formato: todos</option>
          {FORMATS.map((f) => <option key={f}>{f}</option>)}
        </select>
        <button
          onClick={async () => { await api('/auth/logout', { method: 'POST' }); window.location.href = '/login/'; }}
          className="ml-auto text-sm text-zinc-400 hover:text-zinc-200"
        >Salir</button>
      </header>
      {message && <p className="bg-amber-950 px-3 py-2 text-sm text-amber-200">{message}</p>}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <main className="flex flex-1 gap-3 overflow-x-auto p-3">
          {items === null ? <p className="text-zinc-400">Cargando…</p> : STATUSES.map((s) => (
            <Column key={s} status={s} items={visible.filter((i) => i.status === s)} onOpen={setSelected} />
          ))}
        </main>
      </DndContext>
      {selected && (
        <ItemDialog
          item={selected}
          onClose={() => setSelected(null)}
          onSaved={(u) => { setItems((cur) => cur!.map((i) => (i.id === u.id ? u : i))); setSelected(u); }}
          onDeleted={() => { setSelected(null); void load(); }}
        />
      )}
    </div>
  );
}
