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

const app = await buildApp(openDb(dbPath), {
  password: required('ANDYOS_PASSWORD'),
  sessionSecret: secret,
  webOrigin: required('WEB_ORIGIN'),
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  secureCookie: process.env.NODE_ENV === 'production',
});

const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
console.log(`andyos-api escuchando en :${port}`);
