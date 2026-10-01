'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { API, api, Item, MediaAsset, Publication, PublishPreview, PublishStatus } from '@/lib/api';
import { checkFile, PUBLICATION_LABEL, PUBLISH_ERROR, UPLOAD_ERROR } from '@/lib/publish';

const badge = 'rounded-full px-2 py-0.5 text-xs';

/** Publicar en Instagram (vía Windsor): imágenes → vista previa → DOBLE confirmación. Nada sale sin tu clic final. */
export function PublishPanel({ item, onItemChanged }: { item: Item; onItemChanged: () => void }) {
  const [status, setStatus] = useState<PublishStatus | null | false>(null); // false = módulo no activo en la API
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [pubs, setPubs] = useState<Publication[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [result, setResult] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string; link?: string | null } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [check, setCheck] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, m, p] = await Promise.all([
        api<PublishStatus>('/publish/status'),
        api<{ assets: MediaAsset[] }>(`/items/${item.id}/media`),
        api<{ publications: Publication[] }>(`/items/${item.id}/publications`),
      ]);
      setStatus(s); setAssets(m.assets); setPubs(p.publications);
    } catch { setStatus(false); }
  }, [item.id]);
  useEffect(() => { void load(); }, [load]);

  async function uploadFiles(files: File[]) {
    setBusy(true); setNotice(''); setErrors([]); setResult(null);
    const problems: string[] = [];
    for (const f of files) {
      const pre = checkFile(f);
      if (pre) { problems.push(`${f.name}: ${pre}`); continue; }
      try {
        const res = await fetch(`${API}/items/${item.id}/media`, {
          method: 'POST', credentials: 'include', body: f,
          headers: { 'content-type': 'image/jpeg', 'x-filename': encodeURIComponent(f.name) },
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})) as { error?: string }; problems.push(`${f.name}: ${UPLOAD_ERROR[d.error ?? ''] ?? 'no se pudo subir'}`); }
      } catch { problems.push(`${f.name}: no se pudo subir`); }
    }
    setErrors(problems); await load(); setBusy(false);
  }

  async function move(i: number, dir: -1 | 1) {
    const ids = assets.map((a) => a.id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { const r = await api<{ assets: MediaAsset[] }>(`/items/${item.id}/media/order`, { method: 'PUT', body: JSON.stringify({ ids }) }); setAssets(r.assets); } catch { setNotice('No se pudo reordenar.'); }
  }
  async function remove(a: MediaAsset) {
    try { await api(`/media/${a.id}`, { method: 'DELETE' }); await load(); } catch { setNotice('No se pudo quitar la imagen.'); }
  }

  async function review() {
    setBusy(true); setNotice(''); setErrors([]); setResult(null);
    try {
      const res = await fetch(`${API}/items/${item.id}/publish/preview`, { method: 'POST', credentials: 'include' });
      const d = await res.json().catch(() => ({})) as PublishPreview & { errors?: string[] };
      if (res.ok) setPreview(d);
      else if (res.status === 422) setErrors((d.errors ?? []).map((c) => PUBLISH_ERROR[c] ?? c));
      else setNotice('No se pudo preparar la publicación.');
    } catch { setNotice('No se pudo preparar la publicación.'); }
    finally { setBusy(false); }
  }

  async function publishNow() {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/items/${item.id}/publish/confirm`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm_token: preview.confirm_token }),
      });
      const d = await res.json().catch(() => ({})) as { status?: string; permalink?: string | null; error?: string; errors?: string[] };
      if (res.ok && d.status === 'published') setResult({ tone: 'ok', text: 'Publicada en Instagram.', link: d.permalink });
      else if (res.ok && d.status === 'dry_run') setResult({ tone: 'warn', text: 'Simulación completada: NO se envió nada a Instagram.' });
      else if (res.status === 202) setResult({ tone: 'warn', text: 'Envié la orden pero no sé si Instagram la recibió. NO la repitas: mira tu perfil y márcalo abajo.' });
      else if (res.status === 502) setResult({ tone: 'bad', text: `No se publicó: ${d.error ?? 'error de Windsor'}. Puedes volver a intentarlo.` });
      else if (res.status === 409 && d.error === 'content_changed') setResult({ tone: 'bad', text: 'Cambió el texto o las imágenes después de la vista previa. Revísalo de nuevo.' });
      else if (res.status === 410) setResult({ tone: 'bad', text: 'La confirmación caducó (5 min). Vuelve a revisar.' });
      else if (res.status === 422) setResult({ tone: 'bad', text: (d.errors ?? []).map((c) => PUBLISH_ERROR[c] ?? c).join(' ') });
      else setResult({ tone: 'bad', text: 'No se pudo completar la publicación.' });
    } catch { setResult({ tone: 'warn', text: 'Se cortó la conexión al publicar. No la repitas sin comprobar: mira tu perfil de Instagram.' }); }
    setPreview(null); await load(); onItemChanged(); setBusy(false);
  }

  /** Prueba de SOLO LECTURA desde el servidor: usa la clave que ya tiene la API y no publica nada. */
  async function testConnection() {
    setCheck('Probando…');
    try {
      const res = await fetch(`${API}/publish/check`, { credentials: 'include' });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; can_publish?: boolean; error?: string };
      if (res.ok && d.ok) setCheck(d.can_publish ? '✓ Conexión con Windsor correcta; puede publicar.' : '✗ Conecta, pero Windsor no ofrece la acción de publicar.');
      else setCheck(`✗ ${d.error === 'windsor_not_configured' ? 'Falta WINDSOR_API_KEY en la API.' : d.error ?? 'No se pudo conectar con Windsor.'}`);
    } catch { setCheck('✗ No se pudo conectar con la API.'); }
  }

  async function resolve(p: Publication, outcome: 'published' | 'not_published') {
    let url: string | undefined;
    if (outcome === 'published') {
      const u = prompt('Pega el enlace de la publicación en Instagram (opcional):') ?? '';
      if (u.trim()) url = u.trim();
    }
    try { await api(`/publications/${p.id}/resolve`, { method: 'POST', body: JSON.stringify({ outcome, ...(url && { url }) }) }); await load(); onItemChanged(); }
    catch { setNotice('No se pudo registrar (¿el enlace es de instagram.com?).'); }
  }

  if (status === null) return null;
  if (status === false) return null; // módulo no activo en la API: no se muestra
  const dry = status.mode === 'dry_run';
  const box = 'rounded-lg border border-zinc-700 bg-zinc-950 p-3';
  return (
    <section data-publish className={`${box} space-y-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-zinc-300">Publicar en Instagram <span className="font-normal text-zinc-500">· {status.account}</span></p>
        <span data-mode={status.mode} className={`${badge} ${dry ? 'bg-amber-900 text-amber-300' : 'bg-emerald-900 text-emerald-300'}`}>
          {dry ? 'MODO DE PRUEBA: no se envía nada' : 'Publicación real'}
        </span>
        {status.windsor_configured && <button data-check onClick={() => void testConnection()} className="text-xs text-zinc-400 underline hover:text-zinc-200">Probar conexión</button>}
        {check && <span data-check-result className="text-xs text-zinc-300">{check}</span>}
      </div>

      <div
        data-dropzone onClick={() => fileInput.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void uploadFiles([...e.dataTransfer.files]); }}
        className={`grid cursor-pointer place-items-center rounded-lg border-2 border-dashed p-4 text-center text-xs ${drag ? 'border-orange-500 bg-orange-500/10' : 'border-zinc-700 text-zinc-400'}`}
      >
        Arrastra aquí las imágenes (JPG, máx. 8 MB, hasta {status.max_images}) o haz clic
        <input ref={fileInput} type="file" accept="image/jpeg" multiple hidden data-file-input
          onChange={(e) => { void uploadFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </div>
      {errors.length > 0 && <ul data-errors className="space-y-0.5 text-xs text-red-300">{errors.map((x, i) => <li key={i}>• {x}</li>)}</ul>}

      {assets.length > 0 && (
        <ol className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {assets.map((a, i) => (
            <li key={a.id} data-asset className="relative overflow-hidden rounded-md border border-zinc-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={`Imagen ${i + 1}`} className="aspect-[4/5] w-full object-cover" />
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 text-[10px]">{i + 1}</span>
              <div className="flex justify-between bg-black/60 px-1 text-xs">
                <button aria-label={`Mover imagen ${i + 1} a la izquierda`} disabled={i === 0} onClick={() => void move(i, -1)} className="disabled:opacity-30">◀</button>
                <button aria-label={`Quitar imagen ${i + 1}`} onClick={() => void remove(a)} className="text-red-300">✕</button>
                <button aria-label={`Mover imagen ${i + 1} a la derecha`} disabled={i === assets.length - 1} onClick={() => void move(i, 1)} className="disabled:opacity-30">▶</button>
              </div>
              {!a.ok && <p className="bg-red-950 px-1 text-[10px] text-red-300">proporción no válida</p>}
            </li>
          ))}
        </ol>
      )}
      {assets.length > 0 && <p className="text-xs text-zinc-500">{assets.length === 1 ? 'Se publicará como foto.' : `Se publicará como carrusel de ${assets.length} imágenes, en este orden.`} Usa el caption de la tarjeta.</p>}

      {errors.length === 0 && notice && <p role="status" className="text-xs text-zinc-300">{notice}</p>}
      {result && (
        <p data-result className={`rounded-md px-3 py-2 text-sm ${result.tone === 'ok' ? 'bg-emerald-950 text-emerald-300' : result.tone === 'warn' ? 'bg-amber-950 text-amber-200' : 'bg-red-950 text-red-300'}`}>
          {result.text} {result.link && <a href={result.link} target="_blank" rel="noopener noreferrer" className="underline">Abrir</a>}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button data-review disabled={busy || assets.length === 0} onClick={() => void review()} className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40">
          Revisar y publicar…
        </button>
        <span className="text-xs text-zinc-500">No se publica nada sin que confirmes en la ventana siguiente.</span>
      </div>

      {pubs.length > 0 && (
        <ul className="space-y-1 border-t border-zinc-800 pt-2 text-xs">
          {pubs.slice(0, 5).map((p) => (
            <li key={p.id} data-pub={p.status} className="flex flex-wrap items-center gap-2">
              <span className={`${badge} ${p.status === 'published' || p.status === 'resolved_published' ? 'bg-emerald-900 text-emerald-300' : p.status === 'unknown' ? 'bg-amber-900 text-amber-300' : p.status === 'failed' ? 'bg-red-900 text-red-300' : 'bg-zinc-800 text-zinc-300'}`}>{PUBLICATION_LABEL[p.status]}</span>
              <span className="text-zinc-500">{new Date(p.created_at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })} · {p.kind === 'carousel' ? 'carrusel' : 'foto'}</span>
              {p.permalink && <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="text-orange-400 underline">ver</a>}
              {p.error && <span className="text-red-300" title={p.error}>{p.status === 'unknown' ? p.error : 'con error'}</span>}
              {p.status === 'unknown' && (<>
                <button onClick={() => void resolve(p, 'published')} className="underline">Sí salió</button>
                <button onClick={() => void resolve(p, 'not_published')} className="underline">No salió</button>
              </>)}
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <div data-preview-modal className="modal-overlay fixed inset-0 z-30 grid place-items-center p-4" onClick={() => !busy && setPreview(null)}>
          <div className="modal-panel max-h-[92vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-[1.6rem] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Confirmar publicación</h3>
            {preview.preview.mode === 'dry_run'
              ? <p className="rounded-md bg-amber-950 px-3 py-2 text-sm text-amber-200">Modo de prueba: no se publicará nada. Verás lo que se enviaría.</p>
              : <p className="rounded-md bg-red-950 px-3 py-2 text-sm text-red-200">Esto se publicará DE VERDAD en <b>{preview.preview.account}</b> y no se puede borrar desde FactoryOS.</p>}
            <p className="text-sm text-zinc-300">{preview.preview.kind === 'carousel' ? `Carrusel de ${preview.preview.images.length} imágenes` : 'Foto'} en <b>{preview.preview.account}</b></p>
            <div className="grid grid-cols-5 gap-1.5">
              {preview.preview.images.map((im, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={im.id} src={im.url} alt={`Imagen ${i + 1}`} className="aspect-[4/5] w-full rounded object-cover" />
              ))}
            </div>
            <div className="rounded-md border border-zinc-700 p-2 text-sm">
              <p className="text-xs text-zinc-500">Caption</p>
              <p data-caption className="whitespace-pre-wrap">{preview.preview.caption || <i className="text-zinc-500">(sin caption)</i>}</p>
            </div>
            {preview.warnings.includes('empty_caption') && <p className="text-xs text-amber-300">Esta publicación no tiene caption.</p>}
            <p className="text-xs text-zinc-500">La confirmación caduca en {Math.round(preview.expires_in_s / 60)} minutos.</p>
            <div className="flex items-center gap-3">
              <button data-confirm disabled={busy} onClick={() => void publishNow()} className={`rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50 ${preview.preview.mode === 'dry_run' ? 'bg-zinc-700' : 'bg-orange-500 text-black'}`}>
                {busy ? 'Enviando…' : preview.preview.mode === 'dry_run' ? 'Simular publicación' : 'Publicar ahora en Instagram'}
              </button>
              <button disabled={busy} onClick={() => setPreview(null)} className="text-sm text-zinc-400">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
