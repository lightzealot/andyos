import { describe, expect, it } from 'vitest';
import { FORBIDDEN_ENV, loadConfig } from '../src/config.js';

const ok = { API_URL: 'https://api.example.com/', WORKER_TOKEN: 't'.repeat(40) };

describe('loadConfig', () => {
  it('acepta una configuración válida y normaliza la URL', () => {
    const c = loadConfig(ok);
    expect(c.apiUrl).toBe('https://api.example.com'); expect(c.pollMs).toBe(15_000); expect(c.enableCodex).toBe(false);
  });
  it.each(FORBIDDEN_ENV)('se niega a arrancar si existe %s', (name) => {
    expect(() => loadConfig({ ...ok, [name]: 'x' })).toThrow(/no permitido/);
  });
  it('valida URL, token y sondeo', () => {
    expect(() => loadConfig({ ...ok, API_URL: 'http://api.example.com' })).toThrow(/https/);
    expect(() => loadConfig({ ...ok, API_URL: undefined })).toThrow(/https/);
    expect(loadConfig({ ...ok, API_URL: 'http://localhost:8787' }).apiUrl).toBe('http://localhost:8787');
    expect(() => loadConfig({ ...ok, WORKER_TOKEN: 'corto' })).toThrow(/WORKER_TOKEN/);
    expect(() => loadConfig({ ...ok, POLL_INTERVAL_S: '0' })).toThrow(/POLL/);
  });
  it('codex solo se habilita explícitamente', () => {
    expect(loadConfig({ ...ok, ENABLE_CODEX: 'true' }).enableCodex).toBe(true);
    expect(loadConfig({ ...ok, ENABLE_CODEX: '1' }).enableCodex).toBe(false);
  });
});
