import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { crearServidor } from "../tools.js";

// Base de datos falsa: registra la cadena de llamadas y devuelve lo que se le indique.
function fakeDb(resultado) {
  const llamadas = [];
  const q = new Proxy({}, {
    get: (_, nombre) => {
      if (nombre === "then") return (ok) => ok(resultado);
      return (...args) => { llamadas.push([nombre, ...args]); return q; };
    },
  });
  return { db: { from: (t) => { llamadas.push(["from", t]); return q; } }, llamadas };
}
async function cliente(db) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = crearServidor(async () => db);
  await server.connect(a);
  const c = new Client({ name: "t", version: "1" });
  await c.connect(b);
  return c;
}

test("expone las 4 herramientas", async () => {
  const c = await cliente(fakeDb({ data: [], error: null }).db);
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["actualizar_pieza", "crear_pieza", "crear_piezas", "listar_piezas"]);
});

test("crear_pieza normaliza etiquetas y envía el insert", async () => {
  const { db, llamadas } = fakeDb({ data: { id: "1" }, error: null });
  const c = await cliente(db);
  const r = await c.callTool({ name: "crear_pieza", arguments: { titulo: "Idea", etiquetas: ["#IA", "ia", " Reel "], tipo: "reel" } });
  assert.ok(!r.isError);
  const ins = llamadas.find((l) => l[0] === "insert")[1];
  assert.deepEqual(ins.etiquetas, ["ia", "reel"]);
  assert.equal(ins.tipo, "reel");
});

test("rechaza etapa, tipo y fecha inválidos", async () => {
  const c = await cliente(fakeDb({ data: [], error: null }).db);
  for (const args of [{ titulo: "x", etapa: "otra" }, { titulo: "x", tipo: "podcast" }, { titulo: "x", fecha: "10/10/2026" }, { titulo: "" }]) {
    const r = await c.callTool({ name: "crear_pieza", arguments: args }).catch((e) => ({ isError: true, e }));
    assert.ok(r.isError, JSON.stringify(args));
  }
});

test("actualizar_pieza sin campos da error y con null quita la fecha", async () => {
  const { db, llamadas } = fakeDb({ data: [{ id: "a" }], error: null });
  const c = await cliente(db);
  const id = "11111111-1111-4111-8111-111111111111";
  const vacio = await c.callTool({ name: "actualizar_pieza", arguments: { id } });
  assert.ok(vacio.isError);
  const r = await c.callTool({ name: "actualizar_pieza", arguments: { id, fecha: null } });
  assert.ok(!r.isError);
  assert.deepEqual(llamadas.find((l) => l[0] === "update")[1], { fecha: null });
});

test("actualizar_pieza avisa si el id no existe", async () => {
  const c = await cliente(fakeDb({ data: [], error: null }).db);
  const r = await c.callTool({ name: "actualizar_pieza", arguments: { id: "11111111-1111-4111-8111-111111111111", etapa: "guion" } });
  assert.ok(r.isError);
});

test("listar_piezas aplica filtros", async () => {
  const { db, llamadas } = fakeDb({ data: [], error: null });
  const c = await cliente(db);
  await c.callTool({ name: "listar_piezas", arguments: { etapa: "idea", tipo: "reel", desde: "2026-10-05", sin_fecha: true, texto: "50%" } });
  const nombres = llamadas.map((l) => l[0]);
  for (const n of ["eq", "gte", "is", "ilike", "limit"]) assert.ok(nombres.includes(n), n);
  assert.ok(llamadas.find((l) => l[0] === "ilike")[2].includes("\\%"), "escapa % en la búsqueda");
});

test("un error de la base de datos llega como isError", async () => {
  const c = await cliente(fakeDb({ data: null, error: { message: "boom" } }).db);
  const r = await c.callTool({ name: "crear_pieza", arguments: { titulo: "x" } });
  assert.ok(r.isError);
  assert.match(r.content[0].text, /boom/);
});
