'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DndContext, DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { api, ApiError, FORMATS, Item, PLATFORMS } from '@/lib/api';
import { addDays, dayKey, monthGrid, moveToDay, weekDays } from '@/lib/dates';
import { ItemDialog } from './ItemDialog';
import { Nav } from './Nav';

type View = 'month' | 'week';
const NO_DATE = 'day:none';
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function Chip({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const time = item.scheduled_at
    ? new Date(item.scheduled_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div
      ref={setNodeRef} style={style} {...listeners} {...attributes} onClick={onOpen} data-chip
      className={`cursor-grab truncate rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-xs ${isDragging ? 'z-10 opacity-80' : ''}`}
      title={item.title}
    >
      {time && <span className="mr-1 text-zinc-500">{time}</span>}
      {item.platform && <span className="mr-1 text-orange-400">{item.platform.slice(0, 2).toUpperCase()}</span>}
      {item.title}
    </div>
  );
}

function Day({ date, inMonth, items, onOpen, tall }: {
  date: Date; inMonth: boolean; items: Item[]; onOpen: (i: Item) => void; tall: boolean;
}) {
  const key = dayKey(date);
  const { setNodeRef, isOver } = useDroppable({ id: `day:${key}` });
  const today = key === dayKey(new Date());
  return (
    <div
      ref={setNodeRef} data-day={key}
      className={`flex flex-col gap-1 rounded-lg border p-1.5 ${tall ? 'min-h-96' : 'min-h-28'} ${isOver ? 'border-orange-500' : 'border-zinc-800'} ${inMonth ? 'bg-zinc-900' : 'bg-zinc-950 opacity-60'}`}
    >
      <span className={`text-xs ${today ? 'w-fit rounded-full bg-orange-500 px-1.5 font-semibold text-black' : 'text-zinc-400'}`}>{date.getDate()}</span>
      {items.map((i) => <Chip key={i.id} item={i} onOpen={() => onOpen(i)} />)}
    </div>
  );
}

function Unscheduled({ items, onOpen }: { items: Item[]; onOpen: (i: Item) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: NO_DATE });
  return (
    <aside ref={setNodeRef} data-day="none" className={`w-56 shrink-0 space-y-1.5 rounded-xl border bg-zinc-900 p-2 ${isOver ? 'border-orange-500' : 'border-zinc-800'}`}>
      <h2 className="px-1 text-sm font-semibold text-zinc-300">Sin fecha <span className="text-zinc-500">{items.length}</span></h2>
      {items.map((i) => <Chip key={i.id} item={i} onOpen={() => onOpen(i)} />)}
    </aside>
  );
}

export function Calendar() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [platform, setPlatform] = useState('');
  const [format, setFormat] = useState('');
  const [selected, setSelected] = useState<Item | null>(null);
  const [message, setMessage] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Item[] }>('/items?type=content')).items);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) window.location.href = '/login/';
      else setMessage('No se pudo cargar el calendario.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(
    () => (items ?? []).filter((i) => (!platform || i.platform === platform) && (!format || i.format === format)),
    [items, platform, format],
  );
  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of visible) {
      if (!i.scheduled_at) continue;
      const k = dayKey(new Date(i.scheduled_at));
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    for (const list of m.values()) list.sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!));
    return m;
  }, [visible]);
  const unscheduled = visible.filter((i) => !i.scheduled_at);

  const days = view === 'month' ? monthGrid(anchor) : weekDays(anchor);
  const step = (dir: number) => setAnchor((a) => (view === 'month'
    ? new Date(a.getFullYear(), a.getMonth() + dir, 1) : addDays(a, 7 * dir)));
  const title = view === 'month'
    ? `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
    : `${weekDays(anchor)[0].getDate()} ${MONTHS[weekDays(anchor)[0].getMonth()]} – ${weekDays(anchor)[6].getDate()} ${MONTHS[weekDays(anchor)[6].getMonth()]} ${weekDays(anchor)[6].getFullYear()}`;

  async function onDragEnd(e: DragEndEvent) {
    const item = items?.find((i) => i.id === e.active.id);
    const over = e.over?.id as string | undefined;
    if (!item || !over) return;
    const scheduled_at = over === NO_DATE ? null : moveToDay(over.slice(4), item.scheduled_at);
    if (scheduled_at === item.scheduled_at) return;
    setMessage('');
    try {
      const u = await api<Item>(`/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ scheduled_at }) });
      setItems((cur) => cur!.map((i) => (i.id === u.id ? u : i)));
    } catch {
      setMessage('No se pudo cambiar la fecha.');
    }
  }

  const sel = 'rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm';
  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 p-3">
        <Nav current="/calendar/" />
        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} aria-label="Anterior" className={sel}>‹</button>
          <button onClick={() => setAnchor(new Date())} className={sel}>Hoy</button>
          <button onClick={() => step(1)} aria-label="Siguiente" className={sel}>›</button>
        </div>
        <h1 className="w-56 font-semibold capitalize" data-title>{title}</h1>
        <select value={view} onChange={(e) => setView(e.target.value as View)} className={sel} aria-label="Vista">
          <option value="month">Mes</option><option value="week">Semana</option>
        </select>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={sel}>
          <option value="">Plataforma: todas</option>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select value={format} onChange={(e) => setFormat(e.target.value)} className={sel}>
          <option value="">Formato: todos</option>{FORMATS.map((f) => <option key={f}>{f}</option>)}
        </select>
      </header>
      {message && <p className="bg-amber-950 px-3 py-2 text-sm text-amber-200">{message}</p>}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <main className="flex flex-1 gap-3 overflow-auto p-3">
          {items === null ? <p className="text-zinc-400">Cargando…</p> : (
            <>
              <Unscheduled items={unscheduled} onOpen={setSelected} />
              <div className="flex-1">
                <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs text-zinc-500">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
                <div className="grid grid-cols-7 gap-1">
                  {days.map((d) => (
                    <Day
                      key={dayKey(d)} date={d} tall={view === 'week'}
                      inMonth={view === 'week' || d.getMonth() === anchor.getMonth()}
                      items={byDay.get(dayKey(d)) ?? []} onOpen={setSelected}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </main>
      </DndContext>
      {selected && (
        <ItemDialog
          item={selected} onClose={() => setSelected(null)}
          onSaved={(u) => { setItems((cur) => cur!.map((i) => (i.id === u.id ? u : i))); setSelected(u); }}
          onDeleted={() => { setSelected(null); void load(); }}
        />
      )}
    </div>
  );
}
