"use strict";

const SUPABASE_URL = "https://qoxrjknanizdniyirvkm.supabase.co";
const SUPABASE_KEY = "sb_publishable_-hX2WYrbjBC6h3NPwJYdpw_yH3IvLiH"; // clave pública; la seguridad la da RLS

const ETAPAS = ["idea", "guion", "grabado", "editado", "publicado"];
const ETAPA_LABEL = { idea: "Idea", guion: "Guion", grabado: "Grabado", editado: "Editado", publicado: "Publicado" };

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);

const state = { piezas: [], weekStart: mondayOf(new Date()), view: "semana", editing: null, etapa: "idea", tag: "" };

/* ---------- utilidades ---------- */
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseYmd(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) el.append(kid);
  return el;
}
function showStatus(msg, isErr = false) {
  const s = $("status");
  if (!msg) { s.hidden = true; return; }
  s.textContent = msg;
  s.className = "status" + (isErr ? " err" : "");
  s.hidden = false;
}
function fail(err, what) {
  console.error(err);
  showStatus(`${what}: ${err.message || err}`, true);
}

/* ---------- datos ---------- */
async function cargar() {
  const { data, error } = await sb.from("piezas").select("*").order("creada_en", { ascending: false });
  if (error) return fail(error, "No se pudieron cargar las piezas");
  state.piezas = data;
  showStatus("");
  render();
}
async function guardar(id, campos) {
  const q = id ? sb.from("piezas").update(campos).eq("id", id) : sb.from("piezas").insert(campos);
  const { data, error } = await q.select().single();
  if (error) { fail(error, "No se pudo guardar"); return false; }
  const i = state.piezas.findIndex((p) => p.id === data.id);
  if (i >= 0) state.piezas[i] = data; else state.piezas.unshift(data);
  render();
  return true;
}
async function borrar(id) {
  const { error } = await sb.from("piezas").delete().eq("id", id);
  if (error) { fail(error, "No se pudo borrar"); return false; }
  state.piezas = state.piezas.filter((p) => p.id !== id);
  render();
  return true;
}
async function avanzar(p) {
  const i = ETAPAS.indexOf(p.etapa);
  if (i < ETAPAS.length - 1) await guardar(p.id, { etapa: ETAPAS[i + 1] });
}

/* ---------- tarjetas ---------- */
function tarjeta(p) {
  const meta = h("div", { class: "meta" }, h("span", { class: `chip ${p.etapa}` }, ETAPA_LABEL[p.etapa]));
  if (p.funciono) meta.append(h("span", { class: "star", title: "Funcionó" }, "★"));
  for (const t of p.etiquetas) meta.append(h("span", { class: "tag" }, `#${t}`));
  if (p.etapa !== "publicado") {
    const sig = ETAPA_LABEL[ETAPAS[ETAPAS.indexOf(p.etapa) + 1]];
    meta.append(h("button", {
      class: "adv", type: "button", title: `Pasar a ${sig}`,
      onclick: (e) => { e.stopPropagation(); avanzar(p); },
    }, `→ ${sig}`));
  }
  const open = () => abrir(p);
  return h("div", {
    class: "card", role: "button", tabindex: "0", onclick: open,
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } },
  }, h("div", { class: "t" }, p.titulo), meta);
}
function poblar(cont, piezas, vacio) {
  cont.replaceChildren();
  if (!piezas.length) { if (vacio) cont.append(h("div", { class: "empty" }, vacio)); return; }
  for (const p of piezas) cont.append(tarjeta(p));
}

/* ---------- render ---------- */
function render() {
  if (state.view === "semana") renderSemana();
  else if (state.view === "todas") renderTodas();
  else renderFuncionaron();
}
function renderSemana() {
  const hoy = ymd(new Date());
  const ini = state.weekStart;
  const fin = addDays(ini, 6);
  const fmt = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" });
  $("weeklabel").textContent = `${fmt.format(ini)} – ${fmt.format(fin)}`;

  const paraHoy = state.piezas.filter((p) => p.fecha === hoy && p.etapa !== "publicado");
  $("hoy-wrap").hidden = paraHoy.length === 0;
  poblar($("hoy"), paraHoy);

  const week = $("week");
  week.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const d = addDays(ini, i);
    const key = ymd(d);
    const del = state.piezas.filter((p) => p.fecha === key);
    const dia = h("div", { class: "day" + (key === hoy ? " today" : "") });
    dia.append(h("h3", {}, new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric" }).format(d)));
    const list = h("div", { class: "list" });
    for (const p of del) list.append(tarjeta(p));
    dia.append(list, h("button", { class: "add", type: "button", "aria-label": `Añadir el ${key}`, onclick: () => abrir(null, key) }, "+"));
    week.append(dia);
  }

  const sinFecha = state.piezas.filter((p) => !p.fecha && p.etapa !== "publicado");
  $("inbox-count").textContent = sinFecha.length ? `(${sinFecha.length})` : "";
  poblar($("inbox"), sinFecha, "Sin ideas pendientes. Anota una arriba.");
}
function renderTodas() {
  const tags = [...new Set(state.piezas.flatMap((p) => p.etiquetas))].sort();
  const sel = $("tagfilter");
  sel.replaceChildren(h("option", { value: "" }, "Todas las etiquetas"), ...tags.map((t) => h("option", { value: t }, `#${t}`)));
  if (!tags.includes(state.tag)) state.tag = "";
  sel.value = state.tag;
  const cont = $("todas");
  cont.replaceChildren();
  for (const e of ETAPAS) {
    const ps = state.piezas.filter((p) => p.etapa === e && (!state.tag || p.etiquetas.includes(state.tag)));
    const g = h("div", { class: "stage-group" }, h("h2", {}, `${ETAPA_LABEL[e]} (${ps.length})`));
    const list = h("div", { class: "list" });
    poblar(list, ps);
    g.append(list);
    cont.append(g);
  }
}
function renderFuncionaron() {
  poblar($("funciono"), state.piezas.filter((p) => p.funciono), "Aún no has marcado ninguna como «funcionó».");
}
function setView(v) {
  state.view = v;
  for (const b of $("tabs").children) b.classList.toggle("on", b.dataset.view === v);
  for (const name of ["semana", "todas", "funciono"]) $("v-" + name).hidden = name !== v;
  render();
}

/* ---------- diálogo ---------- */
function pintarEtapas() {
  const cont = $("f-etapa");
  cont.replaceChildren();
  for (const e of ETAPAS) {
    cont.append(h("button", {
      type: "button", class: e === state.etapa ? "on" : "",
      onclick: () => { state.etapa = e; pintarEtapas(); },
    }, ETAPA_LABEL[e]));
  }
}
function abrir(p, fecha = "") {
  state.editing = p;
  state.etapa = p ? p.etapa : "idea";
  $("f-titulo").value = p ? p.titulo : "";
  $("f-notas").value = p ? p.notas : "";
  $("f-fecha").value = p ? p.fecha || "" : fecha;
  $("f-etiquetas").value = p ? p.etiquetas.join(", ") : "";
  $("f-funciono").checked = p ? p.funciono : false;
  $("f-borrar").hidden = !p;
  pintarEtapas();
  $("dlg").showModal();
  $("f-titulo").focus();
}
function parseTags(s) {
  return [...new Set(s.split(",").map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean))];
}

/* ---------- eventos ---------- */
$("tabs").addEventListener("click", (e) => { if (e.target.dataset.view) setView(e.target.dataset.view); });
$("prev").onclick = () => { state.weekStart = addDays(state.weekStart, -7); render(); };
$("next").onclick = () => { state.weekStart = addDays(state.weekStart, 7); render(); };
$("today").onclick = () => { state.weekStart = mondayOf(new Date()); render(); };
$("tagfilter").onchange = (e) => { state.tag = e.target.value; renderTodas(); };
$("logout").onclick = () => sb.auth.signOut();

$("capture").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("capture-input");
  const titulo = input.value.trim();
  if (!titulo) return;
  input.disabled = true;
  const ok = await guardar(null, { titulo });
  input.disabled = false;
  if (ok) input.value = "";
  input.focus();
});

$("dlg-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ok = await guardar(state.editing ? state.editing.id : null, {
    titulo: $("f-titulo").value.trim(),
    notas: $("f-notas").value,
    etapa: state.etapa,
    fecha: $("f-fecha").value || null,
    etiquetas: parseTags($("f-etiquetas").value),
    funciono: $("f-funciono").checked,
  });
  if (ok) $("dlg").close();
});
$("f-cancelar").onclick = () => $("dlg").close();
$("f-borrar").onclick = async () => {
  if (state.editing && confirm("¿Borrar esta pieza? No se puede deshacer.")) {
    if (await borrar(state.editing.id)) $("dlg").close();
  }
};

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("login-msg");
  msg.textContent = "Enviando…";
  const { error } = await sb.auth.signInWithOtp({
    email: $("login-email").value.trim(),
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  msg.textContent = error ? `No se pudo enviar: ${error.message}` : "Listo. Revisa tu correo y abre el enlace.";
});

/* ---------- sesión ---------- */
let usuarioActual = null;
function aplicarSesion(session) {
  $("login").hidden = !!session;
  $("app").hidden = !session;
  const id = session ? session.user.id : null;
  if (id === usuarioActual) return; // evita recargar en cada refresco de token
  usuarioActual = id;
  if (id) cargar(); else { state.piezas = []; render(); }
}
sb.auth.onAuthStateChange((_evt, session) => aplicarSesion(session));
sb.auth.getSession().then(({ data }) => aplicarSesion(data.session));
