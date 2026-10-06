import http from "node:http";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { crearServidor } from "./tools.js";

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`Falta la variable de entorno ${k}`); process.exit(1); }
  return v;
};
const SUPABASE_URL = need("SUPABASE_URL");
const SUPABASE_KEY = need("SUPABASE_KEY"); // clave pública (publishable)
const EMAIL = need("PANEL_EMAIL");
const PASSWORD = need("PANEL_PASSWORD");
const MCP_TOKEN = need("MCP_TOKEN");
const PORT = Number(process.env.PORT || 3000);
if (MCP_TOKEN.length < 32) { console.error("MCP_TOKEN debe tener al menos 32 caracteres"); process.exit(1); }

const hash = (s) => crypto.createHash("sha256").update(s).digest();
const TOKEN_HASH = hash(MCP_TOKEN);

/* ---- sesión de Supabase como tu usuario (RLS sigue aplicando) ---- */
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: true } });
let entrando = null;
async function getDb() {
  const { data } = await sb.auth.getSession();
  if (data.session) return sb;
  entrando ??= sb.auth
    .signInWithPassword({ email: EMAIL, password: PASSWORD })
    .then(({ error }) => { if (error) throw new Error(`Login en Supabase falló: ${error.message}`); })
    .finally(() => { entrando = null; });
  await entrando;
  return sb;
}

/* ---- límite simple de intentos fallidos ---- */
let fallos = [];
const bloqueado = () => { const t = Date.now() - 60_000; fallos = fallos.filter((x) => x > t); return fallos.length >= 20; };

function autorizado(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  return !!m && crypto.timingSafeEqual(hash(m[1]), TOKEN_HASH);
}
function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
}
function leerCuerpo(req, max = 1_000_000) {
  return new Promise((resolve, reject) => {
    let n = 0; const partes = [];
    req.on("data", (c) => { n += c.length; if (n > max) { reject(new Error("cuerpo demasiado grande")); req.destroy(); } else partes.push(c); });
    req.on("end", () => resolve(Buffer.concat(partes).toString()));
    req.on("error", reject);
  });
}

export const servidor = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://x");
    if (pathname === "/health") return json(res, 200, { ok: true });
    if (pathname !== "/mcp") return json(res, 404, { error: "no encontrado" });

    if (bloqueado()) return json(res, 429, { error: "demasiados intentos" });
    if (!autorizado(req)) { fallos.push(Date.now()); return json(res, 401, { error: "no autorizado" }); }
    if (req.method !== "POST") return json(res, 405, { error: "usa POST" });

    let cuerpo;
    try { cuerpo = JSON.parse(await leerCuerpo(req)); } catch { return json(res, 400, { error: "JSON inválido" }); }

    const mcp = crearServidor(getDb);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, cuerpo);
  } catch (e) {
    console.error("error:", e.message);
    if (!res.headersSent) json(res, 500, { error: "error interno" });
  }
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  servidor.listen(PORT, () => console.log(`MCP del panel escuchando en :${PORT}/mcp`));
}
