import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb, type Db } from '../src/db.js';
import { jpegInfo, purgeMedia, ratioOk } from '../src/media.js';
import { extractIds, parseRpc, windsorListTools } from '../src/windsor.js';

const KEY = 'k'.repeat(40);
const PUBLIC = 'https://api.test';
const T0 = Date.parse('2026-10-05T15:00:00Z');

/** JPEG mínimo con las dimensiones pedidas (suficiente para leer su cabecera). */
const jpeg = (w: number, h: number, pad = 0) => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]),
  Buffer.alloc(pad), Buffer.from([0xff, 0xd9]),
]);

interface Call { method: string; body: any; headers: Record<string, string> }
type CallHandler = (body: any) => Response | Promise<Response>;
const okCall = (payload: unknown = { id: '1789', permalink: 'https://www.instagram.com/p/ABC123/' }): Response =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } }), { headers: { 'content-type': 'application/json' } });

function mockWindsor(onCall: CallHandler = () => okCall(), failInit?: () => Response | never) {
  const calls: Call[] = [];
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ method: body.method, body, headers: init.headers as Record<string, string> });
    if (body.method === 'initialize') return failInit ? failInit() : new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' } });
    if (body.method === 'notifications/initialized') return new Response('', { status: 202 });
    return onCall(body);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl, toolCalls: () => calls.filter((c) => c.method === 'tools/call') };
}

let clock = T0;
async function setup(opts: { real?: boolean; windsor?: ReturnType<typeof mockWindsor> } = {}) {
  const db = openDb(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'fos-media-'));
  const w = opts.windsor ?? mockWindsor();
  const app = await buildApp(db, {
    password: 'pw', sessionSecret: 'x'.repeat(40), webOrigin: 'http://localhost:3000', secureCookie: false, inboxSecret: 'i'.repeat(40), now: () => clock,
    publish: {
      cfg: { enabled: Boolean(opts.real), windsor: opts.real ? { url: 'https://mcp.test/', key: KEY, fetchImpl: w.fetchImpl, timeoutMs: 2000 } : undefined, accountId: '1784', accountName: 'andyontrade' },
      media: { dir, publicUrl: PUBLIC },
    },
  });
  const cookie = ((await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'pw' } })).headers['set-cookie'] as string).split(';')[0];
  type M = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  const user = (method: M, url: string, payload?: object) => app.inject({ method, url, payload, headers: { cookie } });
  const upload = (id: string, buf: Buffer, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url: `/items/${id}/media`, payload: buf, headers: { cookie, 'content-type': 'image/jpeg', ...headers } });
  /** Tarjeta lista: aprobada, Instagram, con caption, y n imágenes válidas. */
  const ready = async (n = 2, extra: object = {}) => {
    const id = (await user('POST', '/items', { title: 'Mi carrusel', format: 'carousel', hook: 'Hook', caption: 'Un caption listo para publicar.', status: 'aprobacion', ...extra })).json().id as string;
    await user('POST', `/items/${id}/approve`);
    for (let i = 0; i < n; i++) await upload(id, jpeg(1080, 1350, i));
    return id;
  };
  const preview = (id: string) => user('POST', `/items/${id}/publish/preview`);
  const confirm = (id: string, token: string) => user('POST', `/items/${id}/publish/confirm`, { confirm_token: token });
  const go = async (id: string) => confirm(id, (await preview(id)).json().confirm_token);
  const item = async (id: string) => (await user('GET', `/items/${id}`)).json();
  return { app, db, dir, w, user, upload, ready, preview, confirm, go, item, cookie };
}
let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { clock = T0; ctx = await setup(); });

describe('JPEG y proporción', () => {
  it('lee las dimensiones y rechaza lo que no es JPEG', () => {
    expect(jpegInfo(jpeg(1080, 1350))).toEqual({ width: 1080, height: 1350 });
    expect(jpegInfo(Buffer.from('%PNG....'))).toBeNull();
    expect(jpegInfo(Buffer.alloc(0))).toBeNull();
    expect(jpegInfo(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
  it('proporción entre 4:5 y 1,91:1', () => {
    expect([ratioOk(1080, 1350), ratioOk(1080, 1080), ratioOk(1910, 1000), ratioOk(1000, 1251), ratioOk(1920, 1000), ratioOk(1080, 1920)]).toEqual([true, true, true, false, false, false]);
  });
});

describe('subir imágenes', () => {
  it('sube un JPEG válido y devuelve su enlace público', async () => {
    const id = (await ctx.user('POST', '/items', { title: 'A' })).json().id;
    const r = await ctx.upload(id, jpeg(1080, 1350), { 'x-filename': encodeURIComponent('slide 01.jpg') });
    expect(r.statusCode).toBe(201);
    const a = r.json().assets[0];
    expect(a).toMatchObject({ filename: 'slide 01.jpg', width: 1080, height: 1350, position: 0, ok: true });
    expect(a.url).toMatch(/^https:\/\/api\.test\/m\/[a-f0-9]{48}\.jpg$/);
  });
  it.each([['PNG disfrazado', Buffer.from('\x89PNG\r\n\x1a\n' + 'x'.repeat(50)), 400, 'not_a_jpeg'], ['demasiado alta (1:2)', jpeg(1000, 2000), 400, 'bad_ratio'],
    ['demasiado ancha (3:1)', jpeg(3000, 1000), 400, 'bad_ratio'], ['apenas fuera de 4:5', jpeg(1000, 1251), 400, 'bad_ratio']])('rechaza %s', async (_n, buf, status, error) => {
    const id = (await ctx.user('POST', '/items', { title: 'A' })).json().id;
    const r = await ctx.upload(id, buf as Buffer);
    expect([r.statusCode, r.json().error]).toEqual([status, error]);
  });
  it('rechaza más de 8 MB, otro tipo de contenido, y la 11.ª imagen', async () => {
    const id = (await ctx.user('POST', '/items', { title: 'A' })).json().id;
    expect((await ctx.upload(id, jpeg(1080, 1350, 8 * 1024 * 1024 + 10))).statusCode).toBe(413);
    expect((await ctx.app.inject({ method: 'POST', url: `/items/${id}/media`, payload: jpeg(1080, 1350), headers: { cookie: ctx.cookie, 'content-type': 'image/png' } })).statusCode).toBe(415);
    for (let i = 0; i < 10; i++) expect((await ctx.upload(id, jpeg(1080, 1350, i))).statusCode).toBe(201);
    expect((await ctx.upload(id, jpeg(1080, 1350, 99))).statusCode).toBe(409);
  });
  it('exige sesión ANTES de aceptar el archivo y un contenido existente', async () => {
    const id = (await ctx.user('POST', '/items', { title: 'A' })).json().id;
    expect((await ctx.app.inject({ method: 'POST', url: `/items/${id}/media`, payload: jpeg(1080, 1350), headers: { 'content-type': 'image/jpeg' } })).statusCode).toBe(401);
    // un desconocido que manda un archivo enorme recibe 401, no 413: la sesión se mira antes de procesar el cuerpo
    expect((await ctx.app.inject({ method: 'POST', url: `/items/${id}/media`, payload: jpeg(1080, 1350, 9 * 1024 * 1024), headers: { 'content-type': 'image/jpeg' } })).statusCode).toBe(401);
    expect((await ctx.upload('no-existe', jpeg(1080, 1350))).statusCode).toBe(404);
    const ref = (await ctx.user('POST', '/references', { title: 'r' })).json().id;
    expect((await ctx.upload(ref, jpeg(1080, 1350))).statusCode).toBe(404); // una referencia no es contenido
  });
  it('reordena (permutación exacta) y borra sin dejar huecos', async () => {
    const id = await ctx.ready(3);
    const [a, b, c] = (await ctx.user('GET', `/items/${id}/media`)).json().assets.map((x: { id: string }) => x.id);
    expect((await ctx.user('PUT', `/items/${id}/media/order`, { ids: [c, a, b] })).json().assets.map((x: { id: string }) => x.id)).toEqual([c, a, b]);
    for (const bad of [[a, b], [a, a, b], [a, b, 'otra'], [a, b, c, c]]) expect((await ctx.user('PUT', `/items/${id}/media/order`, { ids: bad })).statusCode).toBe(400);
    expect((await ctx.user('DELETE', `/media/${a}`)).statusCode).toBe(200);
    const left = (await ctx.user('GET', `/items/${id}/media`)).json().assets;
    expect(left.map((x: { id: string; position: number }) => [x.id, x.position])).toEqual([[c, 0], [b, 1]]);
    expect((await ctx.user('DELETE', `/media/${a}`)).statusCode).toBe(404);
  });
});

describe('enlace público de la imagen', () => {
  it('lo lee cualquiera con el token (Instagram), pero solo ese archivo', async () => {
    const id = await ctx.ready(1);
    const a = (await ctx.user('GET', `/items/${id}/media`)).json().assets[0];
    const path = new URL(a.url).pathname;
    const r = await ctx.app.inject({ method: 'GET', url: path }); // sin sesión
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/jpeg');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(r.rawPayload, jpeg(1080, 1350, 0))).toBe(0);
    expect((await ctx.app.inject({ method: 'GET', url: '/items' })).statusCode).toBe(401); // el resto sigue privado
  });
  it.each(['/m/abc.jpg', `/m/${'a'.repeat(48)}.jpg`, `/m/${'a'.repeat(48)}`, '/m/..%2f..%2fetc%2fpasswd', '/m/%2e%2e%2f%2e%2e%2fdata%2fandyos.db.jpg'])('no sirve %s', async (url) => {
    expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(404);
  });
  it('al borrar la imagen el enlace deja de funcionar y el archivo desaparece', async () => {
    const id = await ctx.ready(1);
    const a = (await ctx.user('GET', `/items/${id}/media`)).json().assets[0];
    const token = /m\/([a-f0-9]{48})/.exec(a.url)![1];
    expect(existsSync(join(ctx.dir, `${token}.jpg`))).toBe(true);
    await ctx.user('DELETE', `/media/${a.id}`);
    expect(existsSync(join(ctx.dir, `${token}.jpg`))).toBe(false);
    expect((await ctx.app.inject({ method: 'GET', url: `/m/${token}.jpg` })).statusCode).toBe(404);
  });
});

describe('vista previa: cuándo NO se puede publicar', () => {
  it('modo de prueba por defecto y nunca expone la clave', async () => {
    const s = (await ctx.user('GET', '/publish/status')).json();
    expect(s).toMatchObject({ mode: 'dry_run', enabled: false, windsor_configured: false, account: 'andyontrade' });
    const real = await setup({ real: true });
    const r = (await real.user('GET', '/publish/status')).json();
    expect(r).toMatchObject({ mode: 'real', enabled: true, windsor_configured: true });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
  it('sin aprobar, sin imágenes, otra plataforma, caption con [DATO] o muy largo', async () => {
    const id = (await ctx.user('POST', '/items', { title: 'A', caption: 'ok' })).json().id;
    expect((await ctx.preview(id)).json().errors).toEqual(expect.arrayContaining(['not_approved', 'no_images']));
    const tt = await ctx.ready(2, { platform: 'tiktok' });
    expect((await ctx.preview(tt)).json().errors).toContain('platform_not_instagram');
    const pend = await ctx.ready(2, { caption: 'Mi resultado fue [DATO]' });
    expect((await ctx.preview(pend)).json().errors).toContain('pending_placeholders');
    const viv = await ctx.ready(2, { caption: 'Una vez [VIVENCIA] pasó' });
    expect((await ctx.preview(viv)).json().errors).toContain('pending_placeholders');
    const long = await ctx.ready(2, { caption: 'x'.repeat(2201) });
    expect((await ctx.preview(long)).json().errors).toContain('caption_too_long');
    expect((await ctx.preview('no-existe')).statusCode).toBe(404);
  });
  it('editar la tarjeta después de aprobar retira la aprobación y bloquea la publicación', async () => {
    const id = await ctx.ready(2);
    await ctx.user('PATCH', `/items/${id}`, { caption: 'Caption cambiado después de aprobar' });
    expect((await ctx.preview(id)).json().errors).toContain('not_approved');
  });
  it('vista previa correcta: 1 imagen = imagen; 2 o más = carrusel; avisa si falta caption', async () => {
    const one = await ctx.ready(1);
    const p1 = (await ctx.preview(one)).json();
    expect(p1).toMatchObject({ ok: true, preview: { kind: 'image', mode: 'dry_run', account: 'andyontrade', caption: 'Un caption listo para publicar.' } });
    expect(p1.confirm_token).toHaveLength(48);
    expect(p1.preview.images[0].url).toMatch(/^https:\/\/api\.test\/m\//);
    const three = await ctx.ready(3, { caption: '' });
    const p3 = (await ctx.preview(three)).json();
    expect(p3.preview.kind).toBe('carousel'); expect(p3.preview.images).toHaveLength(3); expect(p3.warnings).toContain('empty_caption');
  });
});

describe('confirmar: modo de prueba', () => {
  it('no envía nada a Windsor ni cambia la tarjeta; muestra exactamente lo que enviaría', async () => {
    const id = await ctx.ready(2);
    const r = (await ctx.go(id)).json();
    expect(r).toMatchObject({ ok: true, status: 'dry_run', would_send: { connector: 'instagram', action: 'create_carousel_post', account: '1784' } });
    expect(r.would_send.params.image_urls).toHaveLength(2);
    expect(r.would_send.params.caption).toBe('Un caption listo para publicar.');
    expect(ctx.w.calls).toHaveLength(0);
    const it = await ctx.item(id);
    expect([it.status, it.published_at, it.published_url]).toEqual(['aprobacion', null, null]);
    expect((await ctx.user('GET', `/items/${id}/publications`)).json().publications[0]).toMatchObject({ status: 'dry_run', dry_run: 1 });
  });
  it('una imagen usa create_image_post', async () => {
    const id = await ctx.ready(1);
    const r = (await ctx.go(id)).json();
    expect(r.would_send).toMatchObject({ action: 'create_image_post', params: { image_url: expect.stringMatching(/^https:\/\/api\.test\/m\//) } });
  });
  it('el modo de prueba se puede repetir (no cuenta como publicado)', async () => {
    const id = await ctx.ready(2);
    expect((await ctx.go(id)).statusCode).toBe(200);
    expect((await ctx.preview(id)).statusCode).toBe(200);
  });
});

describe('confirmar: la confirmación de un solo uso', () => {
  it('no se puede reutilizar, ni usar en otra tarjeta, ni inventar', async () => {
    const a = await ctx.ready(2); const b = await ctx.ready(2);
    const tok = (await ctx.preview(a)).json().confirm_token;
    expect((await ctx.confirm(a, tok)).statusCode).toBe(200);
    expect((await ctx.confirm(a, tok)).statusCode).toBe(409);
    const tokB = (await ctx.preview(b)).json().confirm_token;
    expect((await ctx.confirm(a, tokB)).statusCode).toBe(400);
    expect((await ctx.confirm(a, 'f'.repeat(48))).statusCode).toBe(400);
    expect((await ctx.user('POST', `/items/${a}/publish/confirm`, {})).statusCode).toBe(400);
    expect((await ctx.user('POST', `/items/${a}/publish/confirm`, { confirm_token: tokB, extra: 1 })).statusCode).toBe(400);
  });
  it('caduca a los 5 minutos', async () => {
    const id = await ctx.ready(2);
    const tok = (await ctx.preview(id)).json().confirm_token;
    clock = T0 + 5 * 60_000 + 1000;
    expect((await ctx.confirm(id, tok)).statusCode).toBe(410);
  });
  it('si cambia el caption o las imágenes tras la vista previa, hay que revisar de nuevo', async () => {
    const r = await setup({ real: true });
    const a = await r.ready(2);
    const tok = (await r.preview(a)).json().confirm_token;
    await r.user('PATCH', `/items/${a}`, { caption: 'Otro texto distinto' });
    await r.user('POST', `/items/${a}/approve`).catch(() => undefined);
    expect([409, 422]).toContain((await r.confirm(a, tok)).statusCode);
    const b = await r.ready(2);
    const tokB = (await r.preview(b)).json().confirm_token;
    await r.upload(b, jpeg(1080, 1350, 77));
    expect((await r.confirm(b, tokB)).statusCode).toBe(409);
    expect((await r.confirm(b, tokB)).json().error).toBe('token_used');
    expect(r.w.toolCalls()).toHaveLength(0); // nada se envió
  });
  it('dos clics a la vez publican UNA sola vez', async () => {
    const slow = mockWindsor(async () => { await new Promise((res) => setTimeout(res, 50)); return okCall(); });
    const r = await setup({ real: true, windsor: slow });
    const id = await r.ready(2);
    const t1 = (await r.preview(id)).json().confirm_token; const t2 = (await r.preview(id)).json().confirm_token;
    const [x, y] = await Promise.all([r.confirm(id, t1), r.confirm(id, t2)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 422]);
    expect(slow.toolCalls()).toHaveLength(1);
    expect(y.json().errors).toContain('publication_in_progress');
  });
});

describe('publicar de verdad (Windsor simulado)', () => {
  it('envía la orden correcta, guarda el enlace y marca la tarjeta como publicada', async () => {
    const r = await setup({ real: true });
    const id = await r.ready(3);
    const res = await r.go(id);
    expect(res.json()).toMatchObject({ ok: true, status: 'published', permalink: 'https://www.instagram.com/p/ABC123/', external_id: '1789' });
    const [init, , call] = r.w.calls;
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call.headers['mcp-session-id']).toBe('sess-1');
    expect(call.body).toMatchObject({ method: 'tools/call', params: { name: 'execute_action', arguments: { connector: 'instagram', action: 'create_carousel_post', account: '1784' } } });
    const urls = call.body.params.arguments.params.image_urls as string[];
    expect(urls).toHaveLength(3); expect(new Set(urls).size).toBe(3);
    const it = await r.item(id);
    expect([it.status, it.published_url]).toEqual(['publicado', 'https://www.instagram.com/p/ABC123/']);
    expect(it.published_at).not.toBeNull();
    expect((await r.preview(id)).json().errors).toContain('already_published'); // mismo contenido: no se publica dos veces
    await r.user('PATCH', `/items/${id}`, { caption: 'Versión nueva distinta' });
    expect((await r.preview(id)).json().errors).not.toContain('already_published');
  });
  it('respeta el orden de las imágenes', async () => {
    const r = await setup({ real: true });
    const id = await r.ready(3);
    const ids = (await r.user('GET', `/items/${id}/media`)).json().assets.map((x: { id: string }) => x.id);
    const rev = [...ids].reverse();
    const reordered = (await r.user('PUT', `/items/${id}/media/order`, { ids: rev })).json().assets.map((x: { url: string }) => x.url);
    await r.go(id);
    expect(r.w.toolCalls()[0].body.params.arguments.params.image_urls).toEqual(reordered);
  });
  it('entiende respuestas en formato de flujo (SSE)', async () => {
    const sse = mockWindsor(() => new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'Publicado: https://www.instagram.com/p/XYZ999/' }] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
    const r = await setup({ real: true, windsor: sse });
    const res = (await r.go(await r.ready(2))).json();
    expect(res).toMatchObject({ status: 'published', permalink: 'https://www.instagram.com/p/XYZ999/' });
  });
  it('un error definitivo de Windsor NO marca publicado y permite reintentar', async () => {
    let n = 0;
    const w = mockWindsor(() => (++n === 1
      ? new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { isError: true, content: [{ type: 'text', text: 'Invalid image URL' }] } }), { headers: { 'content-type': 'application/json' } })
      : okCall()));
    const r = await setup({ real: true, windsor: w });
    const id = await r.ready(2);
    const bad = await r.go(id);
    expect([bad.statusCode, bad.json().status]).toEqual([502, 'failed']);
    expect((await r.item(id)).status).not.toBe('publicado');
    expect((await r.go(id)).json().status).toBe('published'); // reintento seguro
  });
  it('la clave rechazada o un fallo ANTES de enviar es seguro y no se guarda la clave', async () => {
    const w = mockWindsor(() => okCall(), () => new Response('no', { status: 401 }));
    const r = await setup({ real: true, windsor: w });
    const id = await r.ready(2);
    const res = await r.go(id);
    expect([res.statusCode, res.json().status]).toEqual([502, 'failed']);
    expect(w.toolCalls()).toHaveLength(0);
    const dbDump = JSON.stringify(r.db.prepare('SELECT * FROM publications').all());
    expect(dbDump).not.toContain(KEY);
    const net = mockWindsor(() => okCall(), () => { throw new Error(`fetch failed to ${KEY}`); });
    const r2 = await setup({ real: true, windsor: net });
    const res2 = await r2.go(await r2.ready(2));
    expect(res2.json().status).toBe('failed');
    expect(JSON.stringify(res2.json())).not.toContain(KEY);
  });
  it('si hay DUDA tras enviar la orden, queda bloqueado hasta que lo resuelvas (nunca reintenta solo)', async () => {
    const w = mockWindsor(() => { throw new Error('socket hang up'); });
    const r = await setup({ real: true, windsor: w });
    const id = await r.ready(2);
    const res = await r.go(id);
    expect([res.statusCode, res.json().status]).toEqual([202, 'unknown']);
    expect((await r.item(id)).status).not.toBe('publicado');
    expect((await r.preview(id)).json().errors).toContain('needs_resolution');
    expect(w.toolCalls()).toHaveLength(1);
    const pid = res.json().publication_id;
    expect((await r.user('POST', `/publications/${pid}/resolve`, { outcome: 'not_published' })).statusCode).toBe(200);
    expect((await r.preview(id)).statusCode).toBe(200); // desbloqueado
    expect((await r.user('POST', `/publications/${pid}/resolve`, { outcome: 'published' })).statusCode).toBe(409); // ya resuelta
  });
  it('un 500 tras recibir la orden también es dudoso; resolver «sí salió» marca la tarjeta', async () => {
    const w = mockWindsor(() => new Response('boom', { status: 500 }));
    const r = await setup({ real: true, windsor: w });
    const id = await r.ready(2);
    const pid = (await r.go(id)).json().publication_id;
    expect((await r.user('POST', `/publications/${pid}/resolve`, { outcome: 'published', url: 'https://www.instagram.com/p/MANUAL1/' })).statusCode).toBe(200);
    const it = await r.item(id);
    expect([it.status, it.published_url]).toEqual(['publicado', 'https://www.instagram.com/p/MANUAL1/']);
    expect((await r.user('POST', `/publications/${pid}/resolve`, { outcome: 'published', url: 'https://www.instagram.com/p/OTRO/' })).statusCode).toBe(409); // ya resuelta
  });
  it('resolver solo acepta enlaces de Instagram', async () => {
    const w = mockWindsor(() => { throw new Error('x'); });
    const r = await setup({ real: true, windsor: w });
    const pid = (await r.go(await r.ready(2))).json().publication_id;
    expect((await r.user('POST', `/publications/${pid}/resolve`, { outcome: 'published', url: 'https://evil.example/p/1' })).statusCode).toBe(400);
    expect((await r.user('POST', `/publications/${pid}/resolve`, { outcome: 'otro' })).statusCode).toBe(400);
  });
  it('un intento «en curso» que quedó colgado más de 10 minutos pasa a dudoso', async () => {
    const r = await setup({ real: true });
    const id = await r.ready(2);
    r.db.prepare("INSERT INTO publications (id, item_id, platform, kind, status, caption, asset_ids, snapshot_hash, created_at) VALUES ('p1', ?, 'instagram', 'carousel', 'publishing', 'c', '[]', 'h', ?)").run(id, new Date(T0).toISOString());
    expect((await r.preview(id)).json().errors).toContain('publication_in_progress');
    clock = T0 + 11 * 60_000;
    expect((await r.preview(id)).json().errors).toContain('needs_resolution');
  });
});

describe('servicios auxiliares', () => {
  it('parseRpc entiende JSON y SSE y descarta lo que no es suyo', () => {
    expect(parseRpc('application/json', '{"jsonrpc":"2.0","id":2,"result":{}}', 2)).toMatchObject({ id: 2 });
    expect(parseRpc('text/event-stream', 'data: {"id":1}\n\ndata: {"id":2,"result":1}\n\n', 2)).toMatchObject({ result: 1 });
    expect(parseRpc('text/event-stream', 'data: {"id":1}\n\n', 2)).toBeNull();
    expect(parseRpc('application/json', 'no es json', 2)).toBeNull();
  });
  it('extractIds solo acepta enlaces de instagram.com', () => {
    expect(extractIds({ data: { media_id: 99, permalink: 'https://www.instagram.com/p/A1/' } }, '')).toEqual({ externalId: '99', permalink: 'https://www.instagram.com/p/A1/' });
    expect(extractIds({ permalink: 'https://evil.example/p/A1/' }, '').permalink).toBeNull();
    expect(extractIds(null, 'mira https://instagram.com/reel/Zz9_-/ ok').permalink).toBe('https://instagram.com/reel/Zz9_-/');
  });
  it('purga solo las imágenes de contenido publicado hace más de 14 días y sin intentos abiertos', async () => {
    const r = await setup({ real: true });
    const old = await r.ready(1); const recent = await r.ready(1); const pending = await r.ready(1);
    for (const [id, when] of [[old, '2026-09-01T00:00:00.000Z'], [recent, '2026-10-01T00:00:00.000Z']] as const) {
      r.db.prepare("INSERT INTO publications (id, item_id, platform, kind, status, caption, asset_ids, snapshot_hash, created_at, finished_at) VALUES (?, ?, 'instagram', 'image', 'published', 'c', '[]', 'h', ?, ?)").run(`p-${id}`, id, when, when);
    }
    expect(purgeMedia(r.db, r.dir, T0)).toBe(1);
    expect((await r.user('GET', `/items/${old}/media`)).json().assets).toHaveLength(0);
    expect((await r.user('GET', `/items/${recent}/media`)).json().assets).toHaveLength(1);
    expect((await r.user('GET', `/items/${pending}/media`)).json().assets).toHaveLength(1);
  });
});

describe('sin configurar', () => {
  it('sin publish en la configuración las rutas no existen', async () => {
    const app = await buildApp(openDb(':memory:'), { password: 'pw', sessionSecret: 'x'.repeat(40), webOrigin: 'http://localhost:3000', secureCookie: false, inboxSecret: 'i'.repeat(40) });
    const cookie = ((await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'pw' } })).headers['set-cookie'] as string).split(';')[0];
    expect((await app.inject({ method: 'GET', url: '/publish/status', headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/m/${'a'.repeat(48)}.jpg` })).statusCode).toBe(404);
  });
});

describe('comprobación de solo lectura', () => {
  it('lista las herramientas sin ejecutar ninguna acción', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body)); calls.push(b.method);
      if (b.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 's' } });
      if (b.method === 'tools/list') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'get_data' }, { name: 'execute_action' }] } }), { headers: { 'content-type': 'application/json' } });
      return new Response('', { status: 202 });
    }) as unknown as typeof fetch;
    expect(await windsorListTools({ url: 'https://mcp.test/', key: KEY, fetchImpl })).toEqual({ ok: true, tools: ['get_data', 'execute_action'] });
    expect(calls).not.toContain('tools/call'); // nunca ejecuta nada
  });
  it('clave rechazada o error de red: mensaje claro y sin filtrar la clave', async () => {
    const bad = (async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
    expect(await windsorListTools({ url: 'https://mcp.test/', key: KEY, fetchImpl: bad })).toMatchObject({ ok: false, error: expect.stringMatching(/clave/) });
    const boom = (async () => { throw new Error(`fallo con ${KEY}`); }) as unknown as typeof fetch;
    const r = await windsorListTools({ url: 'https://mcp.test/', key: KEY, fetchImpl: boom });
    expect(r.ok).toBe(false); expect(JSON.stringify(r)).not.toContain(KEY);
  });
});

describe('GET /publish/check (solo lectura, desde el servidor)', () => {
  const listTools = (tools: string[]) => (async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    if (b.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 's' } });
    if (b.method === 'tools/list') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: tools.map((name) => ({ name })) } }), { headers: { 'content-type': 'application/json' } });
    return new Response('', { status: 202 });
  }) as unknown as typeof fetch;
  const withFetch = async (f: typeof fetch) => {
    const app = await buildApp(openDb(':memory:'), { password: 'pw', sessionSecret: 'x'.repeat(40), webOrigin: 'http://localhost:3000', secureCookie: false, inboxSecret: 'i'.repeat(40),
      publish: { cfg: { enabled: false, windsor: { url: 'https://mcp.test/', key: KEY, fetchImpl: f }, accountId: '1', accountName: 'x' }, media: { dir: mkdtempSync(join(tmpdir(), 'fos-')), publicUrl: PUBLIC } } });
    const cookie = ((await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'pw' } })).headers['set-cookie'] as string).split(';')[0];
    return { app, cookie };
  };
  it('exige sesión, lista las herramientas y dice si se puede publicar, sin mostrar la clave', async () => {
    const { app, cookie } = await withFetch(listTools(['get_data', 'execute_action']));
    expect((await app.inject({ method: 'GET', url: '/publish/check' })).statusCode).toBe(401);
    const r = await app.inject({ method: 'GET', url: '/publish/check', headers: { cookie } });
    expect(r.json()).toEqual({ ok: true, tools: ['get_data', 'execute_action'], can_publish: true, mode: 'dry_run' });
    expect(r.body).not.toContain(KEY);
  });
  it('avisa si falta «execute_action» o si la clave es rechazada', async () => {
    const a = await withFetch(listTools(['get_data']));
    expect((await a.app.inject({ method: 'GET', url: '/publish/check', headers: { cookie: a.cookie } })).json().can_publish).toBe(false);
    const b = await withFetch((async () => new Response('no', { status: 401 })) as unknown as typeof fetch);
    const r = await b.app.inject({ method: 'GET', url: '/publish/check', headers: { cookie: b.cookie } });
    expect([r.statusCode, r.json().ok]).toEqual([502, false]); expect(r.body).toMatch(/clave/); expect(r.body).not.toContain(KEY);
  });
  it('sin clave configurada: 409', async () => {
    const r = await ctx.user('GET', '/publish/check');
    expect([r.statusCode, r.json().error]).toEqual([409, 'windsor_not_configured']);
  });
});
