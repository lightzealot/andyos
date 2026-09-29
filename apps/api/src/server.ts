import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildApp } from './app.js';
import { openDb } from './db.js';

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

const app = await buildApp(openDb(dbPath), {
  password: required('ANDYOS_PASSWORD'),
  sessionSecret: secret,
  webOrigin: required('WEB_ORIGIN'),
  inboxSecret,
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  secureCookie: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === 'true',
  n8n,
});

const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
console.log(`andyos-api escuchando en :${port}`);
