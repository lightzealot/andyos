import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { crearServidor } from "./tools.js";
import { crearOAuth } from "./oauth.js";

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
const PUBLIC_URL = (process.env.PUBLIC_URL || "https://mcp.andresgomez.store").replace(/\/$/, "");
if (MCP_TOKEN.length < 32) { console.error("MCP_TOKEN debe tener al menos 32 caracteres"); process.exit(1); }

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

/* ---- OAuth (para Settings → Connectors) y token fijo (para Claude Code) ---- */
const oauth = crearOAuth(MCP_TOKEN);
const recursoUrl = new URL(`${PUBLIC_URL}/mcp`);
const metadataUrl = getOAuthProtectedResourceMetadataUrl(recursoUrl);

/* límite de intentos fallidos de la clave de aprobación */
let fallos = [];
const bloqueado = () => { const t = Date.now() - 15 * 60_000; fallos = fallos.filter((x) => x > t); return fallos.length >= 10; };

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use(
  mcpAuthRouter({
    provider: oauth.provider,
    issuerUrl: new URL(PUBLIC_URL),
    resourceServerUrl: recursoUrl,
    resourceName: "Panel de contenido",
    clientRegistrationOptions: { clientIdGeneration: false },
  }),
);

app.post("/aprobar", express.urlencoded({ extended: false, limit: "10kb" }), (req, res) => {
  res.set({ "Cache-Control": "no-store", "X-Frame-Options": "DENY" });
  if (bloqueado()) return res.status(429).type("text").send("Demasiados intentos. Espera unos minutos.");
  const r = oauth.aprobar(String(req.body.blob || ""), String(req.body.clave || ""));
  if (r.redirect) return res.redirect(302, r.redirect);
  if (r.blob) fallos.push(Date.now());
  res.status(r.blob ? 401 : 400).type("html").send(oauth.pagina(r.blob || "", oauth.clientNameDe(r.blob || ""), r.error));
});

app.post(
  "/mcp",
  requireBearerAuth({ verifier: oauth.provider, resourceMetadataUrl: metadataUrl }),
  express.json({ limit: "1mb" }),
  async (req, res) => {
    const mcp = crearServidor(getDb);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
  },
);
app.all("/mcp", (_req, res) => res.status(405).set("Allow", "POST").json({ error: "usa POST" }));

app.use((_req, res) => res.status(404).json({ error: "no encontrado" }));
app.use((err, _req, res, _next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "JSON inválido" });
  console.error("error:", err.message);
  if (!res.headersSent) res.status(500).json({ error: "error interno" });
});

export const servidor = http.createServer(app);

if (process.argv[1] === new URL(import.meta.url).pathname) {
  servidor.listen(PORT, () => console.log(`MCP del panel escuchando en :${PORT}/mcp`));
}
