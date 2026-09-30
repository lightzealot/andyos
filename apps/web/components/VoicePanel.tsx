'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, Voice } from '@/lib/api';
import { box, btnGhost, btnPrimary, inputCls } from './StudioParts';

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

/** Tu voz: lo que la IA sabe de cómo escribes. Todo es editable. */
export function VoicePanel({ notice }: { notice: (m: string) => void }) {
  const [voice, setVoice] = useState<Voice | null>(null);
  const [guide, setGuide] = useState('');
  const [facts, setFacts] = useState('');
  const [banned, setBanned] = useState('');
  const [newKind, setNewKind] = useState<'caption' | 'hook' | 'script'>('caption');
  const [newText, setNewText] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const v = await api<Voice>('/voice');
    setVoice(v); setGuide(v.guide); setFacts(v.facts.join('\n')); setBanned(v.banned.join('\n'));
  }, []);
  useEffect(() => { load().catch(() => setError('No se pudo cargar tu voz.')); }, [load]);

  async function save() {
    setError('');
    try {
      await api('/voice', { method: 'PUT', body: JSON.stringify({ guide, facts: lines(facts), banned: lines(banned) }) });
      notice('Voz guardada. Los próximos borradores la usarán.');
      await load();
    } catch { setError('No se pudo guardar (la guía necesita al menos 20 caracteres).'); }
  }
  async function addExample() {
    if (newText.trim().length < 3) return;
    try {
      await api('/voice/examples', { method: 'POST', body: JSON.stringify({ kind: newKind, text: newText }) });
      setNewText(''); await load();
    } catch { setError('No se pudo guardar el ejemplo.'); }
  }
  async function removeExample(id: string) {
    await api(`/voice/examples/${id}`, { method: 'DELETE' }); await load();
  }

  if (!voice) return <p className="text-sm text-zinc-500">Cargando tu voz…</p>;
  return (
    <div className="space-y-4" data-voice>
      <p className="text-sm text-zinc-400">
        Aquí está lo que la IA sabe de cómo escribes. Nació de los carruseles y captions que aprobaste; mejora cada vez que
        guardas un texto tuyo como ejemplo. Revisa los hechos: la IA puede usarlos en tus textos.
      </p>
      <label className="block text-xs text-zinc-400">Guía de estilo
        <textarea aria-label="Guía de estilo" className={`${inputCls} mt-0.5`} rows={9} value={guide} onChange={(e) => setGuide(e.target.value)} />
      </label>
      <label className="block text-xs text-zinc-400">Hechos verdaderos sobre ti (uno por línea)
        <textarea aria-label="Hechos" className={`${inputCls} mt-0.5`} rows={7} value={facts} onChange={(e) => setFacts(e.target.value)} />
      </label>
      <label className="block text-xs text-zinc-400">Frases que nunca quieres ver (una por línea)
        <textarea aria-label="Frases prohibidas" className={`${inputCls} mt-0.5`} rows={5} value={banned} onChange={(e) => setBanned(e.target.value)} />
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button onClick={save} className={btnPrimary}>Guardar mi voz</button>

      <div className={`${box} space-y-3`}>
        <h3 className="text-sm font-semibold">Ejemplos de tu voz <span className="text-zinc-500">{voice.examples.length}</span></h3>
        <div className="flex gap-2">
          <select className={`${inputCls} w-32`} value={newKind} onChange={(e) => setNewKind(e.target.value as typeof newKind)} aria-label="Tipo de ejemplo">
            <option value="caption">caption</option><option value="hook">hook</option><option value="script">guion</option>
          </select>
          <textarea className={inputCls} rows={2} placeholder="Pega un texto tuyo que te represente…" value={newText} onChange={(e) => setNewText(e.target.value)} aria-label="Nuevo ejemplo" />
          <button onClick={addExample} className={btnPrimary}>Añadir</button>
        </div>
        <ul className="space-y-2">
          {voice.examples.map((e) => (
            <li key={e.id} data-example className="flex items-start gap-2 rounded-md bg-zinc-950 p-2 text-sm">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${e.source === 'usuario' ? 'bg-orange-500/20 text-orange-300' : 'bg-zinc-800 text-zinc-400'}`}>
                {e.source === 'usuario' ? 'tuyo' : 'semilla'} · {e.kind}
              </span>
              <span className="flex-1 whitespace-pre-line">{e.text}</span>
              <button onClick={() => removeExample(e.id)} className={btnGhost} aria-label="Quitar ejemplo">✕</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
