'use client';
import { useEffect, useRef, useState } from 'react';
import { api, Issue, Job } from '@/lib/api';

export const box = 'rounded-lg border border-zinc-800 bg-zinc-900 p-3';
export const inputCls = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm';
export const btnPrimary = 'rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40';
export const btnGhost = 'text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-40';

/** Resalta los marcadores que la IA deja donde falta un dato o una vivencia real. */
export function Marked({ text }: { text: string }) {
  const parts = text.split(/(\[(?:DATO|VIVENCIA|CONFIRMAR)[^\]]*\])/i);
  return (
    <>
      {parts.map((p, i) => (/^\[(DATO|VIVENCIA|CONFIRMAR)/i.test(p)
        ? <mark key={i} data-marker className="rounded bg-amber-500/25 px-1 text-amber-200">{p}</mark>
        : <span key={i}>{p}</span>))}
    </>
  );
}

const FIELD_LABEL: Record<string, string> = {
  hook: 'hook', contexto: 'contexto', cambio: 'cambio', aplicacion: 'aplicación', resultado: 'resultado', cta: 'CTA',
  caption: 'caption', 'caption corta': 'caption corta', 'caption gancho': 'caption gancho', 'caption cta': 'caption cta',
};
const fieldName = (f: string) => {
  const m = /^v(\d+) (.+)$/.exec(f); // paquete: «v2 caption» → «versión 2 · caption»
  return m ? `versión ${m[1]} · ${FIELD_LABEL[m[2]] ?? m[2]}` : FIELD_LABEL[f] ?? f;
};
const where = (i: Issue) => (i.field ? ` (${fieldName(i.field)})` : '');

export function issueText(i: Issue): string {
  switch (i.type) {
    case 'banned_phrase': return `Frase de relleno: «${i.detail}»${where(i)}`;
    case 'ai_opener': return `Arranque típico de IA: «${i.detail}…»${where(i)}`;
    case 'invented_number': return `Cifra que no viene de tus datos: ${i.detail}${where(i)}`;
    case 'hashtags': return `Lleva hashtags (tu estilo no los usa)${where(i)}`;
    case 'invented_quote': return `Cita que parece inventada (no viene de tus datos): «${i.detail}…»${where(i)}`;
    case 'copied_reference': return `Repite casi literal una frase de una referencia de otro creador: «${i.detail}…»${where(i)}`;
    case 'copied_example': return `Copia casi literal uno de tus ejemplos: «${i.detail}…»${where(i)}`;
    case 'em_dash': return `Demasiadas rayas largas${where(i)}`;
    case 'exclamations': return `Demasiadas exclamaciones${where(i)}`;
    case 'emoji': return `Demasiados emojis${where(i)}`;
    case 'long_sentence': return `Frase muy larga${where(i)}`;
    default: return i.detail;
  }
}

/** Qué comprobó el Estudio sobre un borrador y qué te falta por completar. */
export function ReviewInfo({ review }: { review: Job['review'] }) {
  if (!review) return null;
  const issues = review.issues.filter((i) => i.type !== 'pending');
  const pending = review.issues.filter((i) => i.type === 'pending').reduce((n, i) => n + (parseInt(i.detail, 10) || 1), 0);
  return (
    <div data-review className="space-y-1 text-xs">
      {review.revised && <p data-revised className="text-sky-300">↻ Se reescribió una vez automáticamente para corregir defectos.</p>}
      {issues.length === 0
        ? <p className="text-emerald-400">✓ Sin avisos de estilo.</p>
        : <ul className="list-inside list-disc text-amber-300">{issues.map((i, n) => <li key={n}>{issueText(i)}</li>)}</ul>}
      {pending > 0 && <p data-pending className="text-amber-300">✎ Faltan {pending} dato(s) o vivencia(s) por completar (marcados en ámbar): son cosas que solo tú sabes.</p>}
    </div>
  );
}

export function Pending({ job }: { job: Job }) {
  return (
    <p role="status" data-draft="pending" className="text-sm text-zinc-500">
      ✨ {job.status === 'running' ? 'Escribiendo' : 'En cola'}… suele tardar unos segundos.
    </p>
  );
}

/** Explica que es un borrador y ofrece Ignorar. */
export function DraftFrame({ job, onIgnore, busy, children }: { job: Job; onIgnore: () => void; busy: boolean; children: React.ReactNode }) {
  return (
    <div data-draft="done" className="space-y-3 rounded-md border border-orange-900/60 bg-orange-950/20 p-3">
      <p className="text-xs text-orange-300">
        Borrador de IA · nada se guarda hasta que pulses «Usar»
        {job.model && <span className="text-zinc-500"> · {job.model}</span>}
      </p>
      {children}
      <ReviewInfo review={job.review} />
      <button onClick={onIgnore} disabled={busy} className={btnGhost}>Ignorar borrador</button>
    </div>
  );
}

/** Campo editable del contenido actual, con avisos de estilo, «Humanizar» y «Guardar como mi voz». */
export function FieldEditor({ label, value, kind, source, canHumanize, humanizeDraft, onSave, onHumanize, onDecision, notice }: {
  label: string; value: string; kind: 'hook' | 'script' | 'caption'; source: string; canHumanize: boolean;
  humanizeDraft: Job | null;
  onSave: (v: string) => Promise<void>;
  onHumanize: () => Promise<void>;
  onDecision: (job: Job, accept: boolean) => Promise<void>;
  notice: (m: string) => void;
}) {
  const [text, setText] = useState(value);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(value); }, [value]);

  // Avisos de estilo del texto actual (sin IA, gratis)
  const seq = useRef(0);
  useEffect(() => {
    if (!value.trim()) { setIssues([]); return; }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      api<{ issues: Issue[] }>('/voice/lint', { method: 'POST', body: JSON.stringify({ text: value, source, caption: kind === 'caption' }) })
        .then((r) => { if (mine === seq.current) setIssues(r.issues); }).catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [value, source, kind]);

  const strong = issues.filter((i) => i.type !== 'pending');
  const pending = issues.filter((i) => i.type === 'pending').length;
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <div data-field={label} className="space-y-1.5">
      <label className="block text-xs text-zinc-400">{label}
        <textarea
          className={`${inputCls} mt-0.5`} rows={2} value={text} aria-label={label}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { if (text !== value) void run(() => onSave(text)); }}
        />
      </label>
      {(strong.length > 0 || pending > 0) && (
        <ul data-field-issues className="list-inside list-disc text-xs text-amber-300">
          {strong.map((i, n) => <li key={n}>{issueText(i)}</li>)}
          {pending > 0 && <li>Tiene marcadores por completar ([DATO] / [VIVENCIA])</li>}
        </ul>
      )}
      <div className="flex flex-wrap gap-3 text-xs">
        {canHumanize && value.trim() && <button disabled={busy} onClick={() => run(onHumanize)} className={btnGhost}>✨ Humanizar</button>}
        {value.trim() && (
          <button
            disabled={busy}
            onClick={() => run(async () => { await api('/voice/examples', { method: 'POST', body: JSON.stringify({ kind, text: value }) }); notice('Guardado como ejemplo de tu voz.'); })}
            className={btnGhost}
          >★ Guardar como mi voz</button>
        )}
      </div>
      {humanizeDraft?.status === 'done' && (
        <div data-humanize className="space-y-2 rounded-md border border-orange-900/60 bg-orange-950/20 p-2 text-sm">
          <p className="text-xs text-orange-300">Propuesta de IA para «{label}»</p>
          <p className="whitespace-pre-line"><Marked text={(humanizeDraft.output as { text: string }).text} /></p>
          <ReviewInfo review={humanizeDraft.review} />
          <div className="flex gap-3">
            <button disabled={busy} onClick={() => run(() => onDecision(humanizeDraft, true))} className={btnPrimary}>Usar</button>
            <button disabled={busy} onClick={() => run(() => onDecision(humanizeDraft, false))} className={btnGhost}>Ignorar</button>
          </div>
        </div>
      )}
      {humanizeDraft && (humanizeDraft.status === 'queued' || humanizeDraft.status === 'running') && (
        <p role="status" data-humanize-pending className="text-xs text-zinc-500">✨ Reescribiendo…</p>
      )}
    </div>
  );
}
