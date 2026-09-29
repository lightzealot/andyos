import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import type { Db } from './db.js';
import { passwordMatches } from './auth.js';

/**
 * GET /webhooks/backup: copia consistente de la base (API de respaldo de SQLite, segura con escrituras
 * concurrentes), verificada con quick_check y comprimida. Autenticada solo con secreto propio (no cookie).
 * Sin BACKUP_WEBHOOK_SECRET el endpoint no existe.
 */
export function registerBackup(app: FastifyInstance, db: Db, secret: string | undefined) {
  if (!secret) return;

  app.get('/webhooks/backup', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
    const given = req.headers['x-webhook-secret'];
    if (typeof given !== 'string' || !passwordMatches(given, secret)) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }

    const tmp = join(tmpdir(), `andyos-backup-${randomUUID()}.db`);
    const cleanup = () => unlink(tmp).catch(() => undefined);
    try {
      await db.backup(tmp);
      const copy = new Database(tmp, { readonly: true, fileMustExist: true });
      let check: unknown;
      try { check = copy.pragma('quick_check', { simple: true }); } finally { copy.close(); }
      if (check !== 'ok') {
        await cleanup();
        return reply.code(500).send({ ok: false, error: 'backup_integrity_failed' });
      }
    } catch (err) {
      await cleanup();
      app.log.error(err);
      return reply.code(500).send({ ok: false, error: 'backup_failed' });
    }

    const stream = createReadStream(tmp).pipe(createGzip());
    stream.on('close', () => void cleanup());
    const day = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'application/gzip')
      .header('content-disposition', `attachment; filename="andyos-${day}.db.gz"`)
      .header('cache-control', 'no-store')
      .send(stream);
  });
}
