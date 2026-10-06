import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const TOKEN = "k".repeat(40);
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
let base, srv;
before(async () => {
  Object.assign(process.env, { SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_KEY: "k", PANEL_EMAIL: "a@b.c", PANEL_PASSWORD: "x", MCP_TOKEN: TOKEN, PUBLIC_URL: "https://mcp.example.test" });
  const m = await import("../server.js");
  srv = m.servidor;
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

const b64 = (b) => Buffer.from(b).toString("base64url");
const verifier = b64(crypto.randomBytes(32));
const challenge = b64(crypto.createHash("sha256").update(verifier).digest());
const J = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const rpc = (method, params, id = 1) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const post = (path, body, headers = {}) => fetch(base + path, { method: "POST", redirect: "manual", headers, body });
const form = (o) => new URLSearchParams(o).toString();
const FORM = { "content-type": "application/x-www-form-urlencoded" };

let clientId, tokens;

async function autorizar(clave) {
  const url = `${base}/authorize?` + form({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "xyz" });
  const page = await fetch(url, { redirect: "manual" });
  assert.equal(page.status, 200);
  const html = await page.text();
  const blob = /name="blob" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(blob, "la página trae el formulario");
  const csp = page.headers.get("content-security-policy") || "";
  assert.ok(!/form-action/.test(csp), "form-action bloquearía la redirección a claude.ai tras aprobar");
  return post("/aprobar", form({ blob, clave }), FORM);
}

test("metadatos OAuth publicados", async () => {
  const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.equal(as.issuer, "https://mcp.example.test/");
  assert.ok(as.registration_endpoint && as.token_endpoint && as.authorization_endpoint);
  assert.ok(as.code_challenge_methods_supported.includes("S256"));
  const pr = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
  assert.equal(pr.status, 200);
});

test("sin token, /mcp da 401 con WWW-Authenticate hacia los metadatos", async () => {
  const r = await post("/mcp", rpc("tools/list"), J);
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate") || "", /resource_metadata=/);
});

test("registro dinámico de cliente (público, PKCE)", async () => {
  const r = await post("/register", JSON.stringify({ redirect_uris: [REDIRECT], client_name: "Claude", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }), { "content-type": "application/json" });
  assert.equal(r.status, 201);
  const c = await r.json();
  clientId = c.client_id;
  assert.ok(clientId);
  assert.equal(c.client_secret, undefined);
});

test("aprobación con clave incorrecta no entrega código", async () => {
  const r = await autorizar("clave-mala");
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("location"), null);
});

test("aprobación con la clave correcta redirige con código y state", async () => {
  const r = await autorizar(TOKEN);
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get("location"));
  assert.equal(loc.origin + loc.pathname, REDIRECT);
  assert.equal(loc.searchParams.get("state"), "xyz");
  globalThis.__code = loc.searchParams.get("code");
  assert.ok(globalThis.__code);
});

test("el intercambio exige el verifier PKCE correcto", async () => {
  const mal = await post("/token", form({ grant_type: "authorization_code", client_id: clientId, code: globalThis.__code, redirect_uri: REDIRECT, code_verifier: b64(crypto.randomBytes(32)) }), FORM);
  assert.equal(mal.status, 400);
});

test("el código se canjea una sola vez", async () => {
  const body = form({ grant_type: "authorization_code", client_id: clientId, code: globalThis.__code, redirect_uri: REDIRECT, code_verifier: verifier });
  const r1 = await post("/token", body, FORM);
  assert.equal(r1.status, 200);
  tokens = await r1.json();
  assert.ok(tokens.access_token && tokens.refresh_token);
  assert.equal(tokens.token_type, "Bearer");
  const r2 = await post("/token", body, FORM);
  assert.equal(r2.status, 400);
});

test("el access token OAuth permite usar el MCP", async () => {
  const h = { ...J, authorization: `Bearer ${tokens.access_token}` };
  const init = await post("/mcp", rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } }), h);
  assert.equal(init.status, 200);
  const list = await (await post("/mcp", rpc("tools/list", {}, 2), h)).text();
  assert.match(list, /crear_pieza/);
});

test("el refresh token emite un par nuevo", async () => {
  const r = await post("/token", form({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token }), FORM);
  assert.equal(r.status, 200);
  const t = await r.json();
  const ok = await post("/mcp", rpc("tools/list"), { ...J, authorization: `Bearer ${t.access_token}` });
  assert.equal(ok.status, 200);
});

test("un token manipulado o de otro tipo da 401", async () => {
  const [c, f] = tokens.access_token.split(".");
  for (const malo of [`${c}.${f.slice(0, -2)}AA`, tokens.refresh_token, "basura", `${b64('{"t":"a","exp":9999999999}')}.${f}`]) {
    const r = await post("/mcp", rpc("tools/list"), { ...J, authorization: `Bearer ${malo}` });
    assert.equal(r.status, 401, malo.slice(0, 20));
  }
});

test("el token fijo (Claude Code) sigue funcionando", async () => {
  const r = await post("/mcp", rpc("tools/list"), { ...J, authorization: `Bearer ${TOKEN}` });
  assert.equal(r.status, 200);
});

test("el formulario con datos alterados o caducados se rechaza", async () => {
  const r = await post("/aprobar", form({ blob: "falso.firma", clave: TOKEN }), FORM);
  assert.equal(r.status, 400);
  assert.equal(r.headers.get("location"), null);
});

test("la página de aprobación escapa el nombre del cliente", async () => {
  const reg = await (await post("/register", JSON.stringify({ redirect_uris: [REDIRECT], client_name: '<script>alert(1)</script>', token_endpoint_auth_method: "none" }), { "content-type": "application/json" })).json();
  const url = `${base}/authorize?` + form({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256" });
  const html = await (await fetch(url)).text();
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("redirect_uri no registrada es rechazada en /authorize", async () => {
  const url = `${base}/authorize?` + form({ response_type: "code", client_id: clientId, redirect_uri: "https://evil.example/cb", code_challenge: challenge, code_challenge_method: "S256" });
  const r = await fetch(url, { redirect: "manual" });
  assert.equal(r.status, 400);
});

test("tras 10 claves incorrectas se bloquea (429)", async () => {
  let ultimo;
  for (let i = 0; i < 12; i++) ultimo = await autorizar("mala" + i);
  assert.equal(ultimo.status, 429);
  const buena = await autorizar(TOKEN);
  assert.equal(buena.status, 429, "bloqueado también con la clave buena mientras dura el límite");
});
