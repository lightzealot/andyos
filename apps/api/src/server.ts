import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildApp } from './app.js';
import { openDb } from './db.js';
import { startDigest, validTz } from './digest.js';
import { makeNotifier } from './notify.js';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name} (ver .env.example)`);
  return v;
}

const dbPath = process.env.DB_PATH ?? './data/andyos.db';
mkdirSync(dirname(dbPath), { recursive: true });

const secret = required('SESSION_SECRET');
if (secret.length < 32) throw new Error('SESSION_SECRET debe tener al menos 32 caracteres');

const inboxSecret = required('INBOX_WEBHOOK_SECRET');
if (inboxSecret.length < 32) throw new Error('INBOX_WEBHOOK_SECRET debe tener al menos 32 caracteres');

const n8nVars = ['N8N_BASE_URL', 'N8N_API_KEY', 'N8N_TRIGGER_SECRET'] as const;
const n8nSet = n8nVars.filter((k) => process.env[k]);
// Módulo opcional: una configuración incompleta desactiva el panel (con aviso) en vez de tumbar toda la API.
if (n8nSet.length > 0 && n8nSet.length < n8nVars.length) {
  const missing = n8nVars.filter((k) => !process.env[k]).join(', ');
  console.warn(`AVISO: panel n8n DESACTIVADO, falta(n): ${missing}. Define las tres variables o ninguna.`);
}
let n8n;
if (n8nSet.length === n8nVars.length) {
  const baseUrl = process.env.N8N_BASE_URL!.replace(/\/+$/, '');
  if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl)) {
    throw new Error('N8N_BASE_URL debe ser https:// (http solo para localhost)');
  }
  const triggerSecret = process.env.N8N_TRIGGER_SECRET!;
  if (triggerSecret.length < 32) throw new Error('N8N_TRIGGER_SECRET debe tener al menos 32 caracteres');
  n8n = { baseUrl, apiKey: process.env.N8N_API_KEY!, triggerSecret };
}

const backupSecret = process.env.BACKUP_WEBHOOK_SECRET || undefined;
if (backupSecret && backupSecret.length < 32) throw new Error('BACKUP_WEBHOOK_SECRET debe tener al menos 32 caracteres');
if (backupSecret && backupSecret === inboxSecret) throw new Error('BACKUP_WEBHOOK_SECRET debe ser distinto de INBOX_WEBHOOK_SECRET');

const workerToken = process.env.WORKER_TOKEN || undefined;
if (workerToken) {
  if (workerToken.length < 32) throw new Error('WORKER_TOKEN debe tener al menos 32 caracteres');
  if (new Set([workerToken, inboxSecret, backupSecret ?? '', secret]).size < (backupSecret ? 4 : 3)) {
    throw new Error('WORKER_TOKEN debe ser distinto de los demás secretos');
  }
}
const alertVars = [process.env.ALERT_WEBHOOK_URL, process.env.ALERT_WEBHOOK_SECRET];
if (alertVars.some(Boolean) && !alertVars.every(Boolean)) {
  console.warn('AVISO: avisos de la cola DESACTIVADOS; define ALERT_WEBHOOK_URL y ALERT_WEBHOOK_SECRET juntas.');
}
let alert;
if (alertVars.every(Boolean)) {
  const url = process.env.ALERT_WEBHOOK_URL!;
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) {
    throw new Error('ALERT_WEBHOOK_URL debe ser https:// (http solo para localhost)');
  }
  alert = { url, secret: process.env.ALERT_WEBHOOK_SECRET! };
}

let digest;
if (process.env.DIGEST_TZ) {
  const tz = process.env.DIGEST_TZ;
  const hour = Number(process.env.DIGEST_HOUR ?? 9);
  if (!validTz(tz)) throw new Error('DIGEST_TZ no es una zona horaria válida (ej. America/Mexico_City)');
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('DIGEST_HOUR debe ser un entero de 0 a 23');
  if (!alert) console.warn('AVISO: resumen diario sin ALERT_WEBHOOK_*: se puede previsualizar pero no se enviará.');
  digest = { tz, hour };
}

const db = openDb(dbPath);
const app = await buildApp(db, {
  password: required('ANDYOS_PASSWORD'),
  sessionSecret: secret,
  webOrigin: required('WEB_ORIGIN'),
  inboxSecret,
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  secureCookie: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === 'true',
  n8n,
  backupSecret,
  workerToken,
  alert,
  digest,
});
if (digest && alert) startDigest(db, digest, makeNotifier(alert));

const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
console.log(`andyos-api escuchando en :${port}`);
