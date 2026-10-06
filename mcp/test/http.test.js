import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const TOKEN = "t".repeat(40);
let base, srv;
before(async () => {
  Object.assign(process.env, { SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_KEY: "k", PANEL_EMAIL: "a@b.c", PANEL_PASSWORD: "x", MCP_TOKEN: TOKEN });
  const m = await import("../server.js");
  srv = m.servidor;
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

const H = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const rpc = (method, params, id = 1) => JSON.stringify({ jsonrpc: "2.0", id, method, params });

test("/health responde sin token", async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
});
test("sin token o con token incorrecto da 401", async () => {
  assert.equal((await fetch(`${base}/mcp`, { method: "POST", headers: H, body: rpc("tools/list") })).status, 401);
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { ...H, authorization: "Bearer " + "x".repeat(40) }, body: rpc("tools/list") });
  assert.equal(r.status, 401);
});
test("rutas desconocidas dan 404 y GET con token da 405", async () => {
  assert.equal((await fetch(`${base}/otra`)).status, 404);
  assert.equal((await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 405);
});
test("JSON inválido da 400", async () => {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { ...H, authorization: `Bearer ${TOKEN}` }, body: "{no" });
  assert.equal(r.status, 400);
});
test("con token, initialize y tools/list funcionan", async () => {
  const auth = { ...H, authorization: `Bearer ${TOKEN}` };
  const init = await fetch(`${base}/mcp`, { method: "POST", headers: auth, body: rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } }) });
  assert.equal(init.status, 200);
  assert.match(await init.text(), /panel-contenido/);
  const list = await fetch(`${base}/mcp`, { method: "POST", headers: auth, body: rpc("tools/list", {}, 2) });
  const txt = await list.text();
  for (const n of ["listar_piezas", "crear_pieza", "crear_piezas", "actualizar_pieza"]) assert.match(txt, new RegExp(n));
});
