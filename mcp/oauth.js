import crypto from "node:crypto";
import { InvalidTokenError, InvalidGrantError, InvalidClientMetadataError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

const b64 = (b) => Buffer.from(b).toString("base64url");
const ahora = () => Math.floor(Date.now() / 1000);
const iguales = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const DURACION = { acceso: 3600, refresco: 30 * 86400, codigo: 300, formulario: 600 };

/**
 * Proveedor OAuth sin estado para un solo usuario.
 * Todo (client_id, códigos, tokens) son cadenas firmadas con HMAC derivado de `secreto` (MCP_TOKEN),
 * así sobreviven a reinicios y rotar MCP_TOKEN invalida todo. La «clave de aprobación» es el propio MCP_TOKEN.
 */
export function crearOAuth(secreto) {
  const clave = crypto.createHmac("sha256", secreto).update("panel-mcp-oauth-v1").digest();
  const firmar = (datos) => {
    const cuerpo = b64(JSON.stringify(datos));
    return `${cuerpo}.${b64(crypto.createHmac("sha256", clave).update(cuerpo).digest())}`;
  };
  const leer = (token, tipo) => {
    if (typeof token !== "string") return null;
    const [cuerpo, firma] = token.split(".");
    if (!cuerpo || !firma) return null;
    const esperada = b64(crypto.createHmac("sha256", clave).update(cuerpo).digest());
    if (!iguales(firma, esperada)) return null;
    let d;
    try { d = JSON.parse(Buffer.from(cuerpo, "base64url").toString()); } catch { return null; }
    if (d.t !== tipo) return null;
    if (d.exp && d.exp < ahora()) return null;
    return d;
  };
  const secretoDe = (clientId) => crypto.createHmac("sha256", clave).update("cs:" + clientId).digest("hex");
  const usados = new Map(); // jti -> exp, evita reutilizar un código
  const limpiarUsados = () => { const t = ahora(); for (const [k, v] of usados) if (v < t) usados.delete(k); };

  const clientsStore = {
    getClient(id) {
      const d = leer(id, "cl");
      if (!d) return undefined;
      const info = {
        client_id: id,
        redirect_uris: d.ru,
        client_name: d.n,
        token_endpoint_auth_method: d.m,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      };
      if (d.m !== "none") { info.client_secret = secretoDe(id); info.client_secret_expires_at = 0; }
      return info;
    },
    registerClient(meta) {
      const uris = meta.redirect_uris.map(String);
      if (uris.length === 0 || uris.length > 5 || uris.some((u) => u.length > 300)) throw new InvalidClientMetadataError("redirect_uris inválidas");
      const m = meta.token_endpoint_auth_method === "none" ? "none" : "client_secret_post";
      const id = firmar({ t: "cl", ru: uris, n: String(meta.client_name || "").slice(0, 80), m });
      const info = { ...meta, redirect_uris: uris, token_endpoint_auth_method: m, client_id: id, client_id_issued_at: ahora() };
      if (m === "none") { delete info.client_secret; delete info.client_secret_expires_at; }
      else { info.client_secret = secretoDe(id); info.client_secret_expires_at = 0; }
      return info;
    },
  };

  const pagina = (blob, nombre, error) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Aprobar acceso</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070d0f;color:#e4f3f8;font:16px/1.5 system-ui,sans-serif;padding:16px}
form{width:100%;max-width:400px;background:#0d1315;border:1px solid #20282c;border-radius:16px;padding:28px}
h1{font-size:1.25rem;margin:0 0 8px}p{color:#92a6ad;margin:0 0 16px}input{width:100%;padding:11px 13px;border:1px solid #20282c;border-radius:9px;background:#12191b;color:inherit;font:inherit}
button{width:100%;margin-top:12px;padding:11px;border:0;border-radius:9px;background:#cf7f42;color:#1c0f05;font:inherit;font-weight:600;cursor:pointer}.e{color:#dd6b58}</style></head>
<body><form method="post" action="/aprobar"><h1>Aprobar acceso</h1>
<p><b>${esc(nombre || "Una aplicación")}</b> quiere acceder a tu panel de contenido. Escribe tu clave para aprobarlo.</p>
${error ? `<p class="e">${esc(error)}</p>` : ""}
<input type="hidden" name="blob" value="${esc(blob)}">
<input type="password" name="clave" placeholder="Clave de acceso" autocomplete="current-password" required autofocus>
<button type="submit">Aprobar</button></form></body></html>`;

  const provider = {
    clientsStore,

    // La página de aprobación; el formulario envía a POST /aprobar.
    async authorize(client, params, res) {
      const blob = firmar({
        t: "ap", cid: client.client_id, ru: params.redirectUri, cc: params.codeChallenge,
        st: params.state, rs: params.resource?.href, exp: ahora() + DURACION.formulario,
      });
      res.set({ "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" });
      res.type("html").send(pagina(blob, client.client_name));
    },

    async challengeForAuthorizationCode(client, code) {
      const d = leer(code, "c");
      if (!d || d.cid !== client.client_id) throw new InvalidGrantError("Código inválido o caducado");
      return d.cc;
    },

    async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
      const d = leer(code, "c");
      if (!d || d.cid !== client.client_id) throw new InvalidGrantError("Código inválido o caducado");
      if (redirectUri && redirectUri !== d.ru) throw new InvalidGrantError("redirect_uri no coincide");
      limpiarUsados();
      if (usados.has(d.jti)) throw new InvalidGrantError("Código ya utilizado");
      usados.set(d.jti, d.exp);
      return emitir(client.client_id, d.rs);
    },

    async exchangeRefreshToken(client, refreshToken) {
      const d = leer(refreshToken, "r");
      if (!d || d.cid !== client.client_id) throw new InvalidGrantError("Token de refresco inválido o caducado");
      return emitir(client.client_id, d.rs);
    },

    async verifyAccessToken(token) {
      if (iguales(token, secreto)) return { token, clientId: "token-fijo", scopes: [], expiresAt: ahora() + 3600 };
      const d = leer(token, "a");
      if (!d) throw new InvalidTokenError("Token inválido o caducado");
      return { token, clientId: d.cid, scopes: [], expiresAt: d.exp, resource: d.rs ? new URL(d.rs) : undefined };
    },
  };

  function emitir(cid, rs) {
    return {
      access_token: firmar({ t: "a", cid, rs, exp: ahora() + DURACION.acceso }),
      token_type: "Bearer",
      expires_in: DURACION.acceso,
      refresh_token: firmar({ t: "r", cid, rs, exp: ahora() + DURACION.refresco, n: crypto.randomUUID() }),
    };
  }

  /** Valida la clave del formulario y devuelve la URL de redirección con el código, o un error. */
  function aprobar(blob, claveIntroducida) {
    const d = leer(blob, "ap");
    if (!d) return { error: "El formulario caducó. Vuelve a iniciar la conexión desde Claude." };
    if (!iguales(claveIntroducida || "", secreto)) return { error: "Clave incorrecta.", blob, d };
    const codigo = firmar({ t: "c", cid: d.cid, ru: d.ru, cc: d.cc, rs: d.rs, jti: crypto.randomUUID(), exp: ahora() + DURACION.codigo });
    const url = new URL(d.ru);
    url.searchParams.set("code", codigo);
    if (d.st) url.searchParams.set("state", d.st);
    return { redirect: url.href };
  }

  return { provider, aprobar, pagina, clientNameDe: (blob) => { const d = leer(blob, "ap"); return d ? leer(d.cid, "cl")?.n : ""; } };
}
