'use client';
import Link from 'next/link';
import type { Reference } from '@/lib/api';

export const MAX_REFS = 3;

/** Elige hasta 3 referencias de otros creadores como modelo de ESTRUCTURA. El modelo solo ve tu análisis, nunca sus palabras. */
export function RefPicker({ refs, picked, onChange }: { refs: Reference[] | null; picked: string[]; onChange: (ids: string[]) => void }) {
  if (refs === null) return null;
  const toggle = (id: string) => onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(0, MAX_REFS));
  return (
    <details data-refs className="rounded-md border border-zinc-800 p-2 text-sm">
      <summary className="cursor-pointer text-zinc-300">
        Referencias de estructura <span className="text-zinc-500" data-refs-count>({picked.length} de {MAX_REFS})</span>
      </summary>
      {refs.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">Aún no tienes referencias. Guárdalas en <Link href="/references/" className="text-orange-400 underline">Referencias</Link> y aquí podrás usarlas como modelo.</p>
      ) : (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-zinc-500">Se usa solo tu análisis (patrón de hook y «por qué funciona») para copiar la mecánica; nunca sus palabras ni su voz. Si el texto repite frases de la referencia, el Estudio lo corrige antes de mostrártelo.</p>
          {refs.map((r) => {
            const on = picked.includes(r.id);
            return (
              <label key={r.id} data-ref-option className={`flex cursor-pointer items-start gap-2 rounded-md p-1.5 ${on ? 'bg-orange-500/10' : ''} ${!on && picked.length >= MAX_REFS ? 'opacity-40' : ''}`}>
                <input type="checkbox" checked={on} disabled={!on && picked.length >= MAX_REFS} onChange={() => toggle(r.id)} aria-label={`Referencia ${r.title}`} className="mt-1" />
                <span className="min-w-0">
                  <span className="font-medium">{r.title}</span>{r.linked && <span className="ml-1 rounded-full bg-zinc-800 px-1.5 text-[10px] text-zinc-300">enlazada</span>}
                  <span className="block truncate text-xs text-zinc-500">{[r.creator, r.hook_pattern].filter(Boolean).join(' · ') || 'sin patrón anotado'}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </details>
  );
}
