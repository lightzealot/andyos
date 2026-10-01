import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from './db.js';
import { pendingMarkers } from './lint.js';
import { listAssets, MAX_IMAGES, publicUrlOf, ratioOk, type Asset, type MediaCfg } from './media.js';
import { extractIds, windsorExecute, type WindsorCfg } from './windsor.js';

export interface PublishCfg {
  /** PUBLISHING_ENABLED: sin esto, nada se envía nunca a Instagram (solo modo de prueba). */
  enabled: boolean;
  /** Conexión con Windsor; sin clave solo hay modo de prueba. */
  windsor?: WindsorCfg;
  /** Id de la cuenta de Instagram en Windsor (get_connectors). */
  accountId: string;
  /** Nombre visible de la cuenta (solo para mostrarlo en la confirmación). */
  accountName: string;
}

export const CONFIRM_TTL_S = 300;
const STALE_PUBLISHING_MS = 10 * 60_000;
const CAPTION_MAX = 2200;

/** Motivos por los que no se puede publicar (el texto para el usuario lo pone la pantalla). */
export type PublishError =
  | 'platform_not_instagram' | 'not_approved' | 'no_images' | 'too_many_images' | 'bad_ratio'
  | 'caption_too_long' | 'pending_placeholders' | 'publication_in_progress' | 'needs_resolution' | 'already_published';

interface ItemRow { id: string; title: string; status: string; platform: string | null; format: string | null; caption: string; approved_at: string | null }

export const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function registerPublish(app: FastifyInstance, db: Db, pcfg: PublishCfg, mcfg: MediaCfg, now: () => number) {
  const real = () => pcfg.enabled && Boolean(pcfg.windsor?.key);
  const iso = (ms = now()) => new Date(ms).toISOString();

  const itemOf = (id: string) => db.prepare(`SELECT w.id, w.title, w.status, c.platform, c.format, c.caption, c.approved_at
    FROM work_items w JOIN content_details c ON c.work_item_id = w.id
    WHERE w.id = ? AND w.type = 'content' AND w.archived_at IS NULL`).get(id) as ItemRow | undefined;

  const snapshotHash = (item: ItemRow, assets: Asset[]) =>
    sha(JSON.stringify({ id: item.id, caption: item.caption.trim(), account: pcfg.accountId, assets: assets.map((a) => [a.token, a.size]) }));

  /** Una publicación que quedó «en curso» más de 10 minutos se considera interrumpida: pudo haberse publicado. */
  const markStale = () => db.prepare("UPDATE publications SET status = 'unknown', error = 'Interrumpida: el servidor se reinició o tardó demasiado. Comprueba en Instagram si salió.', finished_at = ? WHERE status = 'publishing' AND created_at < ?")
    .run(iso(), iso(now() - STALE_PUBLISHING_MS));

  function evaluate(itemId: string) {
    markStale();
    const item = itemOf(itemId);
    if (!item) return null;
    const assets = listAssets(db, itemId);
    const errors: PublishError[] = [];
    const warnings: string[] = [];
    // Instagram es el destino predeterminado: una tarjeta sin plataforma se publica ahí; solo se bloquea si eligió otra
    if (item.platform && item.platform !== 'instagram') errors.push('platform_not_instagram');
    if (!item.approved_at) errors.push('not_approved');
    if (assets.length === 0) errors.push('no_images');
    if (assets.length > MAX_IMAGES) errors.push('too_many_images');
    if (assets.some((a) => !ratioOk(a.width, a.height))) errors.push('bad_ratio');
    const caption = item.caption.trim();
    if (caption.length > CAPTION_MAX) errors.push('caption_too_long');
    if (pendingMarkers(caption).length) errors.push('pending_placeholders'); // nunca se publica un texto con [DATO]/[VIVENCIA] sin completar
    if (!caption) warnings.push('empty_caption');
    if (item.format && !['carousel', 'post'].includes(item.format)) warnings.push('format_not_image');
    const open = db.prepare("SELECT status FROM publications WHERE item_id = ? AND status IN ('publishing','unknown') ORDER BY created_at DESC LIMIT 1").get(itemId) as { status: string } | undefined;
    if (open?.status === 'publishing') errors.push('publication_in_progress');
    if (open?.status === 'unknown') errors.push('needs_resolution');
    const hash = snapshotHash(item, assets);
    const done = db.prepare("SELECT 1 FROM publications WHERE item_id = ? AND snapshot_hash = ? AND status IN ('published','resolved_published')").get(itemId, hash);
    if (done) errors.push('already_published');
    const kind: 'image' | 'carousel' = assets.length >= 2 ? 'carousel' : 'image';
    return { item, assets, errors, warnings, kind, hash, caption };
  }

  app.get('/publish/status', async () => ({
    mode: real() ? 'real' : 'dry_run', enabled: pcfg.enabled, windsor_configured: Boolean(pcfg.windsor?.key),
    account: pcfg.accountName, max_images: MAX_IMAGES,
  }));

  app.post('/items/:id/publish/preview', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ev = evaluate(id);
    if (!ev) return reply.code(404).send({ error: 'not_found' });
    if (ev.errors.length) return reply.code(422).send({ ok: false, errors: ev.errors });
    const token = randomBytes(24).toString('hex');
    db.prepare('INSERT INTO publish_confirms (token_hash, item_id, snapshot_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha(token), id, ev.hash, iso(now() + CONFIRM_TTL_S * 1000));
    return {
      ok: true, confirm_token: token, expires_in_s: CONFIRM_TTL_S, warnings: ev.warnings,
      preview: {
        mode: real() ? 'real' : 'dry_run', account: pcfg.accountName, kind: ev.kind, caption: ev.caption, title: ev.item.title,
        images: ev.assets.map((a) => ({ id: a.id, url: publicUrlOf(mcfg, a.token), width: a.width, height: a.height })),
      },
    };
  });

  app.post('/items/:id/publish/confirm', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ confirm_token: z.string().length(48) }).strict().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid' });
    const row = db.prepare('SELECT * FROM publish_confirms WHERE token_hash = ?').get(sha(body.data.confirm_token)) as
      { token_hash: string; item_id: string; snapshot_hash: string; expires_at: string; used_at: string | null } | undefined;
    if (!row || row.item_id !== id) return reply.code(400).send({ error: 'invalid_token' });
    if (row.used_at) return reply.code(409).send({ error: 'token_used' });
    if (row.expires_at < iso()) return reply.code(410).send({ error: 'token_expired' });
    // de un solo uso: se marca ANTES de hacer nada más
    const used = db.prepare('UPDATE publish_confirms SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').run(iso(), row.token_hash);
    if (used.changes !== 1) return reply.code(409).send({ error: 'token_used' });

    const ev = evaluate(id);
    if (!ev) return reply.code(404).send({ error: 'not_found' });
    if (ev.errors.length) return reply.code(422).send({ ok: false, errors: ev.errors });
    if (ev.hash !== row.snapshot_hash) return reply.code(409).send({ error: 'content_changed' }); // cambió el texto o las imágenes tras la vista previa

    const pid = randomUUID();
    const isReal = real();
    const params: Record<string, unknown> = ev.kind === 'carousel'
      ? { image_urls: ev.assets.map((a) => publicUrlOf(mcfg, a.token)), caption: ev.caption || null }
      : { image_url: publicUrlOf(mcfg, ev.assets[0].token), caption: ev.caption || null };
    const action = ev.kind === 'carousel' ? 'create_carousel_post' : 'create_image_post';
    db.prepare(`INSERT INTO publications (id, item_id, platform, kind, status, caption, asset_ids, snapshot_hash, dry_run, created_at)
                VALUES (?, ?, 'instagram', ?, ?, ?, ?, ?, ?, ?)`)
      .run(pid, id, ev.kind, isReal ? 'publishing' : 'dry_run', ev.caption, JSON.stringify(ev.assets.map((a) => a.id)), ev.hash, isReal ? 0 : 1, iso());

    if (!isReal) {
      db.prepare('UPDATE publications SET finished_at = ? WHERE id = ?').run(iso(), pid);
      return { ok: true, status: 'dry_run', publication_id: pid, would_send: { connector: 'instagram', action, account: pcfg.accountId, params } };
    }

    const r = await windsorExecute(pcfg.windsor!, { connector: 'instagram', action, account: pcfg.accountId, params });
    const t = iso();
    if (r.outcome === 'ok') {
      const { externalId, permalink } = extractIds(r.json, r.text);
      db.transaction(() => {
        db.prepare("UPDATE publications SET status = 'published', response = ?, external_id = ?, permalink = ?, finished_at = ? WHERE id = ?")
          .run(r.text.slice(0, 4000), externalId, permalink, t, pid);
        db.prepare("UPDATE work_items SET status = 'publicado', updated_at = ? WHERE id = ?").run(t, id);
        db.prepare('UPDATE content_details SET published_at = ?, published_url = ? WHERE work_item_id = ?').run(t, permalink, id);
      })();
      return { ok: true, status: 'published', publication_id: pid, permalink, external_id: externalId };
    }
    const status = r.outcome === 'unknown' ? 'unknown' : 'failed';
    db.prepare('UPDATE publications SET status = ?, error = ?, finished_at = ? WHERE id = ?').run(status, r.error, t, pid);
    // fallo seguro (definitivo o no enviado): 502 y se puede volver a intentar; dudoso: queda bloqueado hasta que lo resuelvas
    return reply.code(status === 'unknown' ? 202 : 502).send({ ok: false, status, publication_id: pid, error: r.error });
  });

  app.get('/items/:id/publications', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!itemOf(id)) return reply.code(404).send({ error: 'not_found' });
    markStale();
    const rows = db.prepare('SELECT id, kind, status, dry_run, error, permalink, external_id, created_at, finished_at FROM publications WHERE item_id = ? ORDER BY created_at DESC LIMIT 20').all(id);
    return { publications: rows };
  });

  // Un intento dudoso (no se sabe si salió) lo resuelves tú tras mirar Instagram.
  app.post('/publications/:id/resolve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ outcome: z.enum(['published', 'not_published']), url: z.string().url().max(500).regex(/^https:\/\/(www\.)?instagram\.com\//).optional() }).strict().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    markStale();
    const p = db.prepare('SELECT id, item_id, status FROM publications WHERE id = ?').get(id) as { id: string; item_id: string; status: string } | undefined;
    if (!p) return reply.code(404).send({ error: 'not_found' });
    if (p.status !== 'unknown') return reply.code(409).send({ error: 'not_unknown' });
    const t = iso();
    db.transaction(() => {
      db.prepare('UPDATE publications SET status = ?, permalink = ?, finished_at = ? WHERE id = ?')
        .run(b.data.outcome === 'published' ? 'resolved_published' : 'resolved_not_published', b.data.url ?? null, t, id);
      if (b.data.outcome === 'published') {
        db.prepare("UPDATE work_items SET status = 'publicado', updated_at = ? WHERE id = ?").run(t, p.item_id);
        db.prepare('UPDATE content_details SET published_at = ?, published_url = COALESCE(?, published_url) WHERE work_item_id = ?').run(t, b.data.url ?? null, p.item_id);
      }
    })();
    return { ok: true };
  });
}
