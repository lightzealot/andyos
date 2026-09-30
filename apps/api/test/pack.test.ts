import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';

const WORKER = 'w'.repeat(40);
let ctx: Awaited<ReturnType<typeof setup>>;

async function setup() {
  const db = openDb(':memory:');
  const app = await buildApp(db, { password: 'pw', sessionSecret: 'x'.repeat(40), webOrigin: 'http://localhost:3000', secureCookie: false, inboxSecret: 'i'.repeat(40), workerToken: WORKER });
  const cookie = ((await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'pw' } })).headers['set-cookie'] as string).split(';')[0];
  type M = 'GET' | 'POST' | 'PATCH';
  const user = (method: M, url: string, payload?: object) => app.inject({ method, url, payload, headers: { cookie } });
  const worker = (url: string, payload: object = {}) => app.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${WORKER}` } });
  const content = async (extra: object = {}) => (await user('POST', '/items', { title: 'Cómo reviso mi n8n', platform: 'instagram', format: 'reel', ...extra })).json().id as string;
  const claim = async () => (await worker('/worker/claim', { providers: ['claude'] })).json();
  const finish = async (id: string, output: unknown) => (await worker(`/worker/jobs/${id}/result`, { output, provider: 'claude', model: 'claude-sonnet-5-5' })).json();
  const item = async (id: string) => (await user('GET', `/items/${id}`)).json();
  const getJob = async (id: string) => (await user('GET', `/ai/jobs/${id}`)).json();
  const ask = (input: object) => user('POST', '/ai/jobs', { task: 'pack', input });
  return { app, db, user, worker, content, claim, finish, item, getJob, ask };
}

const version = (i: number) => ({
  angle: ['confesión', 'contraste', 'pregunta'][i % 3],
  hook: `Mi n8n se cayó un viernes, versión ${i + 1}.`,
  contexto: `Lo tengo en mi propio VPS, caso ${i + 1}.`,
  cambio: 'Ahora reviso los logs cada mañana.',
  aplicacion: 'Abro el panel, miro las ejecuciones con error y las reintento.',
  resultado: 'Ya no me entero de las caídas por un cliente.',
  cta: 'Comenta N8N y te paso mi checklist.',
  caption: `Creí que mi automatización funcionaba (${i + 1}).\n\nLlevaba días fallando sin avisarme.\n\nComenta N8N.`,
});
const pack = (n: number) => ({ versions: Array.from({ length: n }, (_, i) => version(i)) });

/** Encola un pack, lo reclama y devuelve el trabajo con la respuesta del worker. */
async function done(n: number, output: unknown = pack(n)) {
  const id = await ctx.content();
  const enq = (await ctx.ask({ content_id: id, versions: n })).json();
  const c = await ctx.claim();
  const r = await ctx.finish(c.job.id, output);
  return { id, jobId: enq.job.id as string, c, r };
}
beforeEach(async () => { ctx = await setup(); });

describe('pedir el paquete (hook + guion + caption en una sola llamada)', () => {
  it('por defecto pide 3 versiones y guarda el número en la entrada congelada', async () => {
    const id = await ctx.content();
    const r = await ctx.ask({ content_id: id });
    expect(r.statusCode).toBe(201);
    expect(r.json().job.input.versions).toBe(3);
  });

  it.each([0, 6, 2.5, -1, '3'])('rechaza versions = %j', async (v) => {
    const id = await ctx.content();
    expect((await ctx.ask({ content_id: id, versions: v })).statusCode).toBe(400);
  });

  it('rechaza campos desconocidos y contenido inexistente', async () => {
    const id = await ctx.content();
    expect((await ctx.ask({ content_id: id, extra: 1 })).statusCode).toBe(400);
    expect((await ctx.ask({ content_id: 'no-existe' })).statusCode).toBe(404);
  });

  it('es UNA sola tarea en la cola aunque pidas 5 versiones', async () => {
    const id = await ctx.content();
    await ctx.ask({ content_id: id, versions: 5 });
    expect((await ctx.user('GET', '/ai/queue')).json().counters.queued).toBe(1);
  });
});

describe('lo que recibe el worker', () => {
  it.each([[1, 120], [3, 180], [5, 240]])('con %i versión(es): esquema exacto y tiempo %i s', async (n, timeout) => {
    const id = await ctx.content();
    await ctx.ask({ content_id: id, versions: n });
    const c = (await ctx.claim()).job;
    expect(c.task).toBe('pack');
    expect(c.timeout_s).toBe(timeout);
    expect(c.json_schema.properties.versions).toMatchObject({ minItems: n, maxItems: n });
    expect(c.json_schema.properties.versions.items.required).toEqual(['angle', 'hook', 'contexto', 'cambio', 'aplicacion', 'resultado', 'cta', 'caption']);
    expect(c.prompt).toContain('Cómo reviso mi n8n');
    expect(c.system).toMatch(n === 1 ? /1 VERSIÓN COMPLETA/ : new RegExp(`${n} VERSIONES COMPLETAS`));
    expect(c.system).not.toMatch(/VERSIÓNES/); // ortografía del prompt
    if (n > 1) expect(c.system).toMatch(/DISTINTAS de verdad/);
  });

  it('la reserva (lease) cubre el tiempo pedido más margen, incluso con 5 versiones', async () => {
    const id = await ctx.content();
    const enq = (await ctx.ask({ content_id: id, versions: 5 })).json();
    const before = Date.now();
    await ctx.claim();
    const row = ctx.db.prepare('SELECT lease_until FROM ai_jobs WHERE id = ?').get(enq.job.id) as { lease_until: string };
    expect(Date.parse(row.lease_until) - before).toBeGreaterThanOrEqual((240 + 60) * 1000 - 2000);
  });

  it('las tareas anteriores siguen con su tiempo y su esquema de siempre', async () => {
    const id = await ctx.content();
    await ctx.user('POST', '/ai/jobs', { task: 'hooks', input: { content_id: id } });
    const c = (await ctx.claim()).job;
    expect(c.timeout_s).toBe(120);
    expect(c.json_schema.properties.hooks).toBeDefined();
  });
});

describe('validación de la respuesta', () => {
  it('acepta exactamente las versiones pedidas', async () => {
    const { jobId } = await done(3);
    expect(await ctx.getJob(jobId)).toMatchObject({ status: 'done', review: { issues: [], revised: false } });
  });

  it('una cantidad distinta a la pedida es un fallo permanente (no se acepta a medias)', async () => {
    const { jobId } = await done(3, pack(2));
    expect(await ctx.getJob(jobId)).toMatchObject({ status: 'failed', error_class: 'permanent' });
  });

  it('falta un campo o sobra uno → fallo permanente', async () => {
    const bad = pack(2); delete (bad.versions[1] as Partial<ReturnType<typeof version>>).caption;
    expect((await ctx.getJob((await done(2, bad)).jobId)).status).toBe('failed');
    const extra = pack(2); (extra.versions[0] as Record<string, unknown>).nota = 'x';
    expect((await ctx.getJob((await done(2, extra)).jobId)).status).toBe('failed');
  });
});

describe('aceptar una versión', () => {
  it('por defecto aplica hook, guion y caption JUNTOS, con el hook igual en sus dos sitios', async () => {
    const { id, jobId } = await done(3);
    const r = await ctx.user('POST', `/ai/jobs/${jobId}/accept`, { version: 1 });
    expect(r.statusCode).toBe(200);
    const it = await ctx.item(id);
    expect(it.hook).toBe('Mi n8n se cayó un viernes, versión 2.');
    expect(it.script).toMatchObject({ hook: it.hook, contexto: 'Lo tengo en mi propio VPS, caso 2.', cta: 'Comenta N8N y te paso mi checklist.' });
    expect(Object.keys(it.script).sort()).toEqual(['aplicacion', 'cambio', 'contexto', 'cta', 'hook', 'resultado']);
    expect(it.caption).toContain('(2)');
    expect(it.ai_generated).toBe(true);
    expect((await ctx.getJob(jobId)).accepted_at).not.toBeNull();
  });

  it('solo las secciones elegidas: aceptar solo el caption no toca hook ni guion', async () => {
    const id = await ctx.content({ hook: 'Mi hook', script: { contexto: 'Mi contexto' } });
    const enq = (await ctx.ask({ content_id: id, versions: 2 })).json();
    await ctx.finish((await ctx.claim()).job.id, pack(2));
    await ctx.user('POST', `/ai/jobs/${enq.job.id}/accept`, { version: 0, sections: ['caption'] });
    const it = await ctx.item(id);
    expect(it.caption).toContain('(1)');
    expect(it.hook).toBe('Mi hook');
    expect(it.script).toEqual({ contexto: 'Mi contexto' });
  });

  it('solo el guion conserva el hook actual', async () => {
    const id = await ctx.content({ hook: 'Mi hook', script: { hook: 'Mi hook' } });
    const enq = (await ctx.ask({ content_id: id, versions: 1 })).json();
    await ctx.finish((await ctx.claim()).job.id, pack(1));
    await ctx.user('POST', `/ai/jobs/${enq.job.id}/accept`, { version: 0, sections: ['script'] });
    const it = await ctx.item(id);
    expect(it.hook).toBe('Mi hook');
    expect(it.script).toMatchObject({ hook: 'Mi hook', contexto: 'Lo tengo en mi propio VPS, caso 1.' });
    expect(it.caption).toBe('');
  });

  it.each([
    ['sin elegir versión', {}],
    ['versión fuera de rango', { version: 3 }],
    ['versión negativa', { version: -1 }],
    ['secciones vacías', { version: 0, sections: [] }],
    ['sección desconocida', { version: 0, sections: ['todo'] }],
    ['campos de más', { version: 0, tags: ['x'] }],
  ])('rechaza %s y NO cambia nada (todo o nada)', async (_n, body) => {
    const id = await ctx.content({ hook: 'Original' });
    const enq = (await ctx.ask({ content_id: id, versions: 3 })).json();
    await ctx.finish((await ctx.claim()).job.id, pack(3));
    const r = await ctx.user('POST', `/ai/jobs/${enq.job.id}/accept`, body);
    expect(r.statusCode).toBe(400);
    expect((await ctx.item(id)).hook).toBe('Original');
    expect((await ctx.getJob(enq.job.id)).accepted_at).toBeNull();
  });

  it('aceptar dos veces → 409', async () => {
    const { jobId } = await done(2);
    expect((await ctx.user('POST', `/ai/jobs/${jobId}/accept`, { version: 0 })).statusCode).toBe(200);
    expect((await ctx.user('POST', `/ai/jobs/${jobId}/accept`, { version: 1 })).statusCode).toBe(409);
  });

  it('ignorar no toca el contenido', async () => {
    const { id, jobId } = await done(2);
    await ctx.user('POST', `/ai/jobs/${jobId}/dismiss`);
    expect((await ctx.item(id)).hook).toBe('');
  });

  it('editar algo aprobado retira la aprobación, como el editor', async () => {
    const id = await ctx.content({ hook: 'Aprobado', status: 'aprobacion' });
    await ctx.user('POST', `/items/${id}/approve`);
    expect((await ctx.item(id)).approved_at).not.toBeNull();
    const enq = (await ctx.ask({ content_id: id, versions: 1 })).json();
    await ctx.finish((await ctx.claim()).job.id, pack(1));
    await ctx.user('POST', `/ai/jobs/${enq.job.id}/accept`, { version: 0 });
    expect((await ctx.item(id)).approved_at).toBeNull();
  });
});

describe('detector de estilo sobre el paquete', () => {
  it('un defecto en cualquier versión provoca UNA segunda pasada que nombra la versión y el campo', async () => {
    const dirty = pack(3);
    dirty.versions[1].caption = 'En el mundo de hoy, todo cambia. Comenta N8N.';
    const { jobId } = await done(3, dirty);
    expect((await ctx.getJob(jobId)).status).toBe('queued'); // vuelve a la cola antes de mostrártelo
    const c2 = await ctx.claim();
    expect(c2.job.prompt).toContain('v2 caption');
    expect(c2.job.json_schema.properties.versions.minItems).toBe(3); // la segunda pasada conserva N
    await ctx.finish(c2.job.id, pack(3));
    expect(await ctx.getJob(jobId)).toMatchObject({ status: 'done', review: { revised: true, issues: [] } });
  });

  it('un [DATO] pendiente se avisa pero NO provoca segunda pasada (es una tarea tuya)', async () => {
    const withGap = pack(1);
    withGap.versions[0].resultado = 'Ya no me entero de las caídas. [DATO]';
    const { jobId } = await done(1, withGap);
    const j = await ctx.getJob(jobId);
    expect(j.status).toBe('done');
    expect(j.review.revised).toBe(false);
    expect(j.review.issues).toEqual([expect.objectContaining({ type: 'pending', field: 'v1 resultado' })]);
  });

  it('las cifras inventadas en el guion también se marcan', async () => {
    const dirty = pack(1);
    dirty.versions[0].resultado = 'Ahorré 900 horas al mes.';
    const { jobId } = await done(1, dirty);
    expect((await ctx.getJob(jobId)).status).toBe('queued');
  });
});
