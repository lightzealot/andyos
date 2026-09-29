import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeArgs, runClaude } from '../src/adapters/claude.js';
import { codexArgs, runCodex } from '../src/adapters/codex.js';
import { calls, job, makeCfg, setMode } from './helpers.js';

const run = async (mode: string, j = job()) => { const cfg = makeCfg(); setMode(cfg, mode); return { cfg, o: await runClaude(j, cfg) }; };

describe('claudeArgs (configuración mínima verificada en el spike)', () => {
  const a = claudeArgs(job());
  it('sin herramientas, MCP, skills, hooks de usuario ni sesiones persistentes', () => {
    expect(a[a.indexOf('--tools') + 1]).toBe('');
    expect(a).toEqual(expect.arrayContaining(['--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']));
    expect(a[a.indexOf('--setting-sources') + 1]).toBe('project');
    expect(a[a.indexOf('--permission-mode') + 1]).toBe('dontAsk');
  });
  it('nunca usa --bare ni bypassPermissions (cobro por token / sin salvaguardas)', () => {
    expect(a).not.toContain('--bare');
    expect(a.join(' ')).not.toMatch(/bypassPermissions|dangerously/i);
  });
  it('pide salida estructurada en stream-json con el esquema del trabajo', () => {
    expect(a[a.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(JSON.parse(a[a.indexOf('--json-schema') + 1])).toEqual(job().json_schema);
  });
});

describe('runClaude', () => {
  it('éxito: salida estructurada, modelo, uso e instantánea de cuota', async () => {
    const { o } = await run('ok');
    expect(o).toMatchObject({ ok: true, provider: 'claude', model: 'claude-sonnet-5-5', output: { tags: ['ia', 'n8n'] } });
    if (o.ok) { expect(o.snapshot?.five_hour?.utilization).toBe(0.05); expect(o.usage).toMatchObject({ output_tokens: 40 }); }
  });
  it('ejecuta en el directorio de trabajo aislado y con el entorno filtrado', async () => {
    process.env.SECRETO_DE_PRUEBA_XYZ = 'no-debe-llegar';
    const { cfg } = await run('ok');
    delete process.env.SECRETO_DE_PRUEBA_XYZ;
    const c = calls(cfg)[0];
    expect(c.cwd.replace('/private', '')).toBe(cfg.workDir.replace('/private', ''));
    expect(c.envKeys).not.toContain('SECRETO_DE_PRUEBA_XYZ');
    expect(c.envKeys.filter((k: string) => /ANTHROPIC|OPENAI|API_KEY|TOKEN/.test(k))).toEqual([]);
  });
  it('acepta JSON en el texto cuando no hay structured_output', async () => {
    expect((await run('text_json')).o).toMatchObject({ ok: true, output: { tags: ['ia', 'n8n'] } });
  });
  it('sin salida estructurada → permanente', async () => {
    expect((await run('nostructured')).o).toMatchObject({ ok: false, error_class: 'permanent' });
  });

  describe('errores', () => {
    it('cuota de sesión: quota con reinicio de la ventana de 5 h', async () => {
      const { o } = await run('quota');
      expect(o).toMatchObject({ ok: false, error_class: 'quota' });
      if (!o.ok) { expect(o.reset_at).toBeGreaterThan(Date.now() / 1000); expect(o.snapshot?.five_hour?.utilization).toBe(1); expect(o.error).toMatch(/session limit/); }
    });
    it('cuota semanal: usa el reinicio de la ventana semanal', async () => {
      const { o } = await run('quota_weekly');
      expect(o).toMatchObject({ ok: false, error_class: 'quota' });
      if (!o.ok) expect(o.reset_at! - Date.now() / 1000).toBeGreaterThan(86_400);
    });
    it('formato de error descrito en la documentación (sin evento result) también se reconoce', async () => {
      expect((await run('doc_error')).o).toMatchObject({ ok: false, error_class: 'quota' });
    });
    it('límite de gasto → billing', async () => { expect((await run('spend')).o).toMatchObject({ error_class: 'billing' }); });
    it('529 y estrangulamiento del servidor → transitorio', async () => {
      expect((await run('overloaded')).o).toMatchObject({ error_class: 'transient' });
      expect((await run('throttle')).o).toMatchObject({ error_class: 'transient' });
    });
    it('proceso que se cae sin resultado → clasificado por su stderr (permanente)', async () => {
      expect((await run('crash')).o).toMatchObject({ ok: false, error_class: 'permanent' });
    });
    it('tiempo agotado: mata el proceso y es transitorio', async () => {
      const t0 = Date.now();
      const { o } = await run('hang', job({ timeout_s: 1 }));
      expect(o).toMatchObject({ ok: false, error_class: 'transient' });
      expect(Date.now() - t0).toBeLessThan(8000);
    });
  });

  describe('contra SALIDAS REALES capturadas de claude', () => {
    it('sin sesión → auth', async () => {
      expect((await run('fixture:claude-nologin:1')).o).toMatchObject({ ok: false, error_class: 'auth', error: expect.stringMatching(/Not logged in/) });
    });
    it('modelo inexistente (404) → permanente', async () => {
      expect((await run('fixture:claude-badmodel:1')).o).toMatchObject({ ok: false, error_class: 'permanent' });
    });
    it('éxito real → salida estructurada, modelo real e instantánea', async () => {
      const { o } = await run('fixture:claude-success:0');
      expect(o).toMatchObject({ ok: true, model: 'claude-sonnet-5-5' });
      if (o.ok) { expect(Array.isArray((o.output as { hooks: unknown[] }).hooks)).toBe(true); expect(o.snapshot?.seven_day).toBeTruthy(); }
    });
  });
});

describe('runCodex', () => {
  const go = async (mode: string, j = job({ provider: 'codex' })) => { const cfg = makeCfg(); setMode(cfg, mode); return { cfg, o: await runCodex(j, cfg) }; };
  it('argumentos: solo lectura, sin config de usuario, con esquema', () => {
    const a = codexArgs('/tmp/s.json', job({ provider: 'codex' }));
    expect(a).toEqual(expect.arrayContaining(['exec', '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules']));
    expect(a[a.indexOf('-s') + 1]).toBe('read-only');
    expect(a.join(' ')).not.toMatch(/danger-full-access|bypass/i);
  });
  it('éxito: parsea el mensaje del agente y el uso; borra el esquema temporal', async () => {
    const { cfg, o } = await go('ok');
    expect(o).toMatchObject({ ok: true, provider: 'codex', output: { tags: ['ia', 'seguridad'] } });
    expect(calls(cfg)[0].schemaFileExisted).toBe(true);
    const tmp = join(cfg.workDir, 'tmp');
    expect(existsSync(tmp) ? readdirSync(tmp) : []).toEqual([]);
  });
  it('respuesta que no es JSON → permanente', async () => { expect((await go('notjson')).o).toMatchObject({ ok: false, error_class: 'permanent' }); });
  it('tiempo agotado → transitorio', async () => { expect((await go('hang', job({ provider: 'codex', timeout_s: 1 }))).o).toMatchObject({ error_class: 'transient' }); });
  it('SALIDAS REALES: sin sesión → auth; modelo no soportado → permanente; éxito real → JSON', async () => {
    expect((await go('fixture:codex-nologin:1')).o).toMatchObject({ ok: false, error_class: 'auth' });
    expect((await go('fixture:codex-badmodel:1')).o).toMatchObject({ ok: false, error_class: 'permanent' });
    expect((await go('fixture:codex-success:0')).o).toMatchObject({ ok: true, provider: 'codex', usage: { input_tokens: 14513 } });
  });
});
