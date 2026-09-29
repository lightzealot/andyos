import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_MS = 7 * 24 * 3600 * 1000;

const digest = (s: string) => createHash('sha256').update(s).digest();

export function passwordMatches(input: string, expected: string): boolean {
  return timingSafeEqual(digest(input), digest(expected));
}

const sign = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url');

export function makeSession(secret: string, now = Date.now()): string {
  const payload = String(now + SESSION_MS);
  return `${payload}.${sign(payload, secret)}`;
}

export function sessionValid(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const good = sign(payload, secret);
  if (sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
  return Number(payload) > now;
}
