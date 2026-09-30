import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Db } from './db.js';

/** Límites de Instagram para fotos de feed y carruseles (vía Windsor): JPEG, máx. 8 MB, proporción entre 4:5 y 1,91:1, 2 a 10 imágenes. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES = 10;
export const MIN_RATIO = 0.8;   // 4:5
export const MAX_RATIO = 1.91;

export interface JpegInfo { width: number; height: number }

/** Lee las dimensiones de un JPEG sin decodificarlo. null si no es un JPEG válido. */
export function jpegInfo(buf: Buffer): JpegInfo | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = buf.readUInt16BE(i + 5); const width = buf.readUInt16BE(i + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

export const ratioOk = (w: number, h: number) => { const r = w / h; return r >= MIN_RATIO - 1e-9 && r <= MAX_RATIO + 1e-9; };

export interface Asset { id: string; item_id: string; token: string; filename: string; size: number; width: number; height: number; position: number; created_at: string }
export const listAssets = (db: Db, itemId: string) =>
  db.prepare('SELECT * FROM media_assets WHERE item_id = ? ORDER BY position, created_at').all(itemId) as Asset[];

const TOKEN_RE = /^[a-f0-9]{48}$/;
export const fileOf = (dir: string, token: string) => join(dir, `${token}.jpg`);

export interface MediaCfg { dir: string; publicUrl: string }
export const publicUrlOf = (cfg: MediaCfg, token: string) => `${cfg.publicUrl.replace(/\/+$/, '')}/m/${token}.jpg`;

export function registerMedia(app: FastifyInstance, db: Db, cfg: MediaCfg, sessionOk: (cookie: string | undefined) => boolean) {
  mkdirSync(cfg.dir, { recursive: true });
  const contentExists = (id: string) => db.prepare("SELECT 1 FROM work_items WHERE id = ? AND type = 'content' AND archived_at IS NULL").get(id);
  const assetsView = (itemId: string) => listAssets(db, itemId).map((a) => ({ ...a, url: publicUrlOf(cfg, a.token), ok: ratioOk(a.width, a.height) }));

  // El cuerpo llega como bytes JPEG crudos (sin multipart): más simple y sin dependencias nuevas.
  app.addContentTypeParser('image/jpeg', { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES + 1024 }, (_req, body, done) => done(null, body));

  app.post('/items/:id/media', {
    bodyLimit: MAX_IMAGE_BYTES + 1024,
    // La sesión se comprueba ANTES de aceptar hasta 8 MB de cuerpo.
    onRequest: async (req, reply) => { if (!sessionOk(req.cookies?.andyos_session)) return reply.code(401).send({ error: 'unauthorized' }); },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!contentExists(id)) return reply.code(404).send({ error: 'not_found' });
    const body = req.body;
    if (!Buffer.isBuffer(body)) return reply.code(415).send({ error: 'only_jpeg' });
    if (body.length > MAX_IMAGE_BYTES) return reply.code(413).send({ error: 'too_large' });
    const info = jpegInfo(body);
    if (!info) return reply.code(400).send({ error: 'not_a_jpeg' });
    if (!ratioOk(info.width, info.height)) return reply.code(400).send({ error: 'bad_ratio', width: info.width, height: info.height });
    if (listAssets(db, id).length >= MAX_IMAGES) return reply.code(409).send({ error: 'too_many' });
    const rawName = typeof req.headers['x-filename'] === 'string' ? req.headers['x-filename'] : 'imagen.jpg';
    let filename = 'imagen.jpg';
    try { filename = decodeURIComponent(rawName).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 100) || filename; } catch { /* nombre ilegible: se usa el genérico */ }
    const token = randomBytes(24).toString('hex');
    const aid = randomUUID();
    const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM media_assets WHERE item_id = ?').get(id) as { p: number }).p;
    writeFileSync(fileOf(cfg.dir, token), body);
    db.prepare('INSERT INTO media_assets (id, item_id, token, filename, size, width, height, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(aid, id, token, filename, body.length, info.width, info.height, pos, new Date().toISOString());
    return reply.code(201).send({ assets: assetsView(id) });
  });

  app.get('/items/:id/media', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!contentExists(id)) return reply.code(404).send({ error: 'not_found' });
    return { assets: assetsView(id) };
  });

  app.put('/items/:id/media/order', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!contentExists(id)) return reply.code(404).send({ error: 'not_found' });
    const b = z.object({ ids: z.array(z.string().min(1).max(64)).max(MAX_IMAGES) }).strict().safeParse(req.body);
    const current = listAssets(db, id).map((a) => a.id);
    // tiene que ser una permutación exacta de las imágenes actuales
    if (!b.success || b.data.ids.length !== current.length || new Set(b.data.ids).size !== current.length || !b.data.ids.every((x) => current.includes(x))) {
      return reply.code(400).send({ error: 'invalid' });
    }
    db.transaction(() => b.data.ids.forEach((aid, i) => db.prepare('UPDATE media_assets SET position = ? WHERE id = ?').run(i, aid)))();
    return { assets: assetsView(id) };
  });

  app.delete('/media/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(id) as Asset | undefined;
    if (!a) return reply.code(404).send({ error: 'not_found' });
    db.prepare('DELETE FROM media_assets WHERE id = ?').run(id);
    rmSync(fileOf(cfg.dir, a.token), { force: true });
    listAssets(db, a.item_id).forEach((x, i) => db.prepare('UPDATE media_assets SET position = ? WHERE id = ?').run(i, x.id)); // sin huecos
    return { ok: true };
  });

  // PÚBLICO (Instagram/Windsor tiene que poder leerlo): el token de 192 bits no se puede adivinar.
  app.get('/m/:file', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { file } = req.params as { file: string };
    const token = file.endsWith('.jpg') ? file.slice(0, -4) : '';
    if (!TOKEN_RE.test(token) || !db.prepare('SELECT 1 FROM media_assets WHERE token = ?').get(token)) return reply.code(404).send({ error: 'not_found' });
    const path = fileOf(cfg.dir, token);
    if (!existsSync(path)) return reply.code(404).send({ error: 'not_found' });
    return reply.header('content-type', 'image/jpeg').header('x-content-type-options', 'nosniff')
      .header('cache-control', 'public, max-age=3600').send(readFileSync(path));
  });
}

/** Borra las imágenes de contenido ya publicado hace más de `days` días y los archivos huérfanos. */
export function purgeMedia(db: Db, dir: string, now: number, days = 14): number {
  const cutoff = new Date(now - days * 86_400_000).toISOString();
  const old = db.prepare(`SELECT a.id, a.token FROM media_assets a
    WHERE EXISTS (SELECT 1 FROM publications p WHERE p.item_id = a.item_id AND p.status IN ('published','resolved_published') AND p.finished_at < ?)
      AND NOT EXISTS (SELECT 1 FROM publications p WHERE p.item_id = a.item_id AND p.status IN ('publishing','unknown'))`).all(cutoff) as { id: string; token: string }[];
  for (const a of old) { db.prepare('DELETE FROM media_assets WHERE id = ?').run(a.id); rmSync(fileOf(dir, a.token), { force: true }); }
  return old.length;
}
