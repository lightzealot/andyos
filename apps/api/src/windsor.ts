/**
 * Cliente mínimo del servidor MCP de Windsor (Streamable HTTP, JSON-RPC) con clave de API como Bearer.
 * Solo se usa para `execute_action`. Es determinista: no interviene ningún modelo.
 *
 * Regla de oro: una vez enviada la orden de publicar, cualquier duda (corte, tiempo agotado, respuesta ilegible)
 * NO es un fallo seguro: pudo publicarse. Por eso se distingue `not_sent` (seguro reintentar) de `unknown`.
 */
export interface WindsorCfg { url: string; key: string; fetchImpl?: typeof fetch; timeoutMs?: number }

export type WindsorResult =
  | { outcome: 'ok'; json: unknown; text: string }
  | { outcome: 'failed'; error: string }    // Windsor respondió con un error definitivo
  | { outcome: 'not_sent'; error: string }  // falló antes de enviar la orden: reintentar es seguro
  | { outcome: 'unknown'; error: string };  // la orden pudo llegar: NO reintentar sin comprobar

const PROTOCOL = '2025-03-26';

/** Extrae el mensaje JSON-RPC de una respuesta JSON o de un flujo SSE. */
export function parseRpc(contentType: string, text: string, id: number): Record<string, unknown> | null {
  const tryParse = (s: string) => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? (v as Record<string, unknown>) : null; } catch { return null; } };
  if (contentType.includes('text/event-stream')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      const m = data ? tryParse(data) : null;
      if (m && m.id === id) return m;
    }
    return null;
  }
  const m = tryParse(text);
  return m && (m.id === id || m.id === undefined) ? m : null;
}

const scrub = (s: string, key: string) => (key ? s.split(key).join('***') : s).slice(0, 500);

export async function windsorExecute(cfg: WindsorCfg, args: { connector: string; action: string; account: string; params: Record<string, unknown> }): Promise<WindsorResult> {
  const f = cfg.fetchImpl ?? fetch;
  const timeout = cfg.timeoutMs ?? 60_000;
  const base = { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  let session: string | null = null;
  const post = (body: unknown, extra: Record<string, string> = {}) =>
    f(cfg.url, { method: 'POST', headers: { ...base, ...(session ? { 'mcp-session-id': session } : {}), ...extra }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(timeout) });

  // 1) Handshake: si falla aquí, todavía no se ha enviado ninguna orden.
  try {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'factoryos', version: '1.0' } } });
    const txt = await r.text();
    if (r.status === 401 || r.status === 403) return { outcome: 'not_sent', error: 'Windsor rechazó la clave de API (revisa WINDSOR_API_KEY).' };
    if (!r.ok) return { outcome: 'not_sent', error: scrub(`Windsor respondió ${r.status} al iniciar la conexión.`, cfg.key) };
    session = r.headers.get('mcp-session-id');
    const msg = parseRpc(r.headers.get('content-type') ?? '', txt, 1);
    if (!msg || msg.error) return { outcome: 'not_sent', error: 'Windsor no completó el saludo inicial.' };
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }).then((x) => x.text()).catch(() => undefined);
  } catch (e) {
    return { outcome: 'not_sent', error: scrub(`No se pudo conectar con Windsor: ${(e as Error).message}`, cfg.key) };
  }

  // 2) La orden de publicar. A partir de aquí, la duda se trata como «desconocido».
  let res: Response; let txt: string;
  try {
    res = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'execute_action', arguments: args } });
    txt = await res.text();
  } catch (e) {
    return { outcome: 'unknown', error: scrub(`Se envió la orden pero no llegó respuesta (${(e as Error).message}).`, cfg.key) };
  }
  if (res.status === 401 || res.status === 403) return { outcome: 'failed', error: 'Windsor rechazó la clave de API.' };
  if (res.status >= 400 && res.status < 500) return { outcome: 'failed', error: scrub(`Windsor rechazó la petición (${res.status}): ${txt}`, cfg.key) };
  if (!res.ok) return { outcome: 'unknown', error: scrub(`Windsor respondió ${res.status} tras recibir la orden.`, cfg.key) };
  const msg = parseRpc(res.headers.get('content-type') ?? '', txt, 2);
  if (!msg) return { outcome: 'unknown', error: 'La respuesta de Windsor no se pudo leer.' };
  if (msg.error) return { outcome: 'failed', error: scrub(`Windsor devolvió un error: ${JSON.stringify(msg.error)}`, cfg.key) };
  const result = (msg.result ?? {}) as { isError?: boolean; content?: { type?: string; text?: string }[] };
  const text = (result.content ?? []).map((c) => c.text ?? '').join('\n');
  if (result.isError) return { outcome: 'failed', error: scrub(text || 'Windsor devolvió un error sin detalle.', cfg.key) };
  let json: unknown = null; try { json = JSON.parse(text); } catch { /* texto libre */ }
  return { outcome: 'ok', json, text: scrub(text, cfg.key) };
}

/** Busca un id de publicación y un enlace en la respuesta de Windsor, sea cual sea su forma. */
export function extractIds(json: unknown, text: string): { externalId: string | null; permalink: string | null } {
  let externalId: string | null = null; let permalink: string | null = null;
  const walk = (v: unknown, depth = 0) => {
    if (depth > 5 || v == null) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const lk = k.toLowerCase();
        if (!permalink && lk.includes('permalink') && typeof val === 'string' && /^https:\/\/(www\.)?instagram\.com\//.test(val)) permalink = val;
        if (!externalId && (lk === 'media_id' || lk === 'id' || lk === 'post_id' || lk === 'request_id') && (typeof val === 'string' || typeof val === 'number')) externalId = String(val);
        walk(val, depth + 1);
      }
    }
  };
  walk(json);
  if (!permalink) { const m = /https:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/?/.exec(text); if (m) permalink = m[0]; }
  return { externalId, permalink };
}

/** Comprobación de SOLO LECTURA: abre la conexión con la clave y lista las herramientas del servidor. No publica nada. */
export async function windsorListTools(cfg: WindsorCfg): Promise<{ ok: true; tools: string[] } | { ok: false; error: string }> {
  const f = cfg.fetchImpl ?? fetch;
  const timeout = cfg.timeoutMs ?? 30_000;
  const base = { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  let session: string | null = null;
  const post = (body: unknown) => f(cfg.url, { method: 'POST', headers: { ...base, ...(session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(timeout) });
  try {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'factoryos-check', version: '1.0' } } });
    const txt = await r.text();
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'Windsor rechazó la clave de API.' };
    if (!r.ok) return { ok: false, error: `Windsor respondió ${r.status} al iniciar la conexión.` };
    session = r.headers.get('mcp-session-id');
    if (!parseRpc(r.headers.get('content-type') ?? '', txt, 1)) return { ok: false, error: 'La respuesta de Windsor al saludo no se pudo leer.' };
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }).then((x) => x.text()).catch(() => undefined);
    const l = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const msg = parseRpc(l.headers.get('content-type') ?? '', await l.text(), 2);
    const tools = ((msg?.result as { tools?: { name?: string }[] } | undefined)?.tools ?? []).map((t) => t.name ?? '').filter(Boolean);
    return tools.length ? { ok: true, tools } : { ok: false, error: 'Windsor no devolvió la lista de herramientas.' };
  } catch (e) { return { ok: false, error: scrub(`No se pudo conectar con Windsor: ${(e as Error).message}`, cfg.key) }; }
}
