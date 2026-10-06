import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const ETAPAS = ["idea", "guion", "grabado", "editado", "publicado"];
export const TIPOS = ["reel", "carrusel", "foto", "story", "video", "otro"];

const etapa = z.enum(ETAPAS);
const tipo = z.enum(TIPOS);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "formato AAAA-MM-DD");
const etiquetas = z.array(z.string().trim().min(1).max(40)).max(20);

const campos = {
  titulo: z.string().trim().min(1).max(300),
  notas: z.string().max(20000),
  etapa,
  tipo,
  fecha,
  etiquetas,
  funciono: z.boolean(),
};

const COLUMNAS = "id,titulo,notas,etapa,tipo,fecha,etiquetas,funciono,creada_en,actualizada_en";

const limpiarEtiquetas = (e) => [...new Set(e.map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean))];

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function fallo(msg) {
  return { isError: true, content: [{ type: "text", text: msg }] };
}
async function consulta(fn) {
  try {
    const { data, error } = await fn();
    if (error) return fallo(`Error de la base de datos: ${error.message}`);
    return ok(data);
  } catch (e) {
    return fallo(`No se pudo completar la operación: ${e.message}`);
  }
}

/** getDb: async () => cliente de Supabase ya autenticado como el usuario (RLS activa). */
export function crearServidor(getDb) {
  const server = new McpServer({ name: "panel-contenido", version: "1.0.0" });

  server.registerTool(
    "listar_piezas",
    {
      title: "Listar piezas",
      description:
        "Lista piezas de contenido del panel. Filtros opcionales por etapa, tipo, rango de fechas (AAAA-MM-DD), etiqueta o texto en el título. Orden: fecha ascendente (las sin fecha al final).",
      inputSchema: {
        etapa: etapa.optional(),
        tipo: tipo.optional(),
        desde: fecha.optional(),
        hasta: fecha.optional(),
        etiqueta: z.string().trim().min(1).max(40).optional(),
        texto: z.string().trim().min(1).max(100).optional(),
        sin_fecha: z.boolean().optional().describe("true: solo piezas sin fecha"),
        funciono: z.boolean().optional(),
        limite: z.number().int().min(1).max(200).default(50),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      consulta(async () => {
        const db = await getDb();
        let q = db.from("piezas").select(COLUMNAS);
        if (a.etapa) q = q.eq("etapa", a.etapa);
        if (a.tipo) q = q.eq("tipo", a.tipo);
        if (a.desde) q = q.gte("fecha", a.desde);
        if (a.hasta) q = q.lte("fecha", a.hasta);
        if (a.sin_fecha) q = q.is("fecha", null);
        if (a.funciono !== undefined) q = q.eq("funciono", a.funciono);
        if (a.etiqueta) q = q.contains("etiquetas", [a.etiqueta.toLowerCase().replace(/^#/, "")]);
        if (a.texto) q = q.ilike("titulo", `%${a.texto.replace(/[%_]/g, "\\$&")}%`);
        return q.order("fecha", { ascending: true, nullsFirst: false }).order("creada_en", { ascending: false }).limit(a.limite);
      }),
  );

  server.registerTool(
    "crear_pieza",
    {
      title: "Crear pieza",
      description: "Crea una pieza de contenido. Solo el título es obligatorio; la etapa por defecto es «idea».",
      inputSchema: {
        titulo: campos.titulo,
        notas: campos.notas.optional(),
        etapa: etapa.optional(),
        tipo: tipo.optional(),
        fecha: fecha.optional(),
        etiquetas: etiquetas.optional(),
        funciono: campos.funciono.optional(),
      },
    },
    async (a) =>
      consulta(async () => {
        const db = await getDb();
        const fila = { ...a };
        if (a.etiquetas) fila.etiquetas = limpiarEtiquetas(a.etiquetas);
        return db.from("piezas").insert(fila).select(COLUMNAS).single();
      }),
  );

  server.registerTool(
    "crear_piezas",
    {
      title: "Crear varias piezas",
      description: "Crea hasta 50 piezas de una vez (por ejemplo, un lote de ideas). Todo o nada: si una falla, no se crea ninguna.",
      inputSchema: {
        piezas: z
          .array(
            z.object({
              titulo: campos.titulo,
              notas: campos.notas.optional(),
              etapa: etapa.optional(),
              tipo: tipo.optional(),
              fecha: fecha.optional(),
              etiquetas: etiquetas.optional(),
              funciono: campos.funciono.optional(),
            }),
          )
          .min(1)
          .max(50),
      },
    },
    async ({ piezas }) =>
      consulta(async () => {
        const db = await getDb();
        const filas = piezas.map((p) => (p.etiquetas ? { ...p, etiquetas: limpiarEtiquetas(p.etiquetas) } : p));
        return db.from("piezas").insert(filas).select(COLUMNAS);
      }),
  );

  server.registerTool(
    "actualizar_pieza",
    {
      title: "Actualizar pieza",
      description:
        "Modifica una pieza por su id. Solo cambia los campos que envíes. Para quitar la fecha o el tipo, envía null. No borra piezas.",
      inputSchema: {
        id: z.string().uuid(),
        titulo: campos.titulo.optional(),
        notas: campos.notas.optional(),
        etapa: etapa.optional(),
        tipo: tipo.nullable().optional(),
        fecha: fecha.nullable().optional(),
        etiquetas: etiquetas.optional(),
        funciono: campos.funciono.optional(),
      },
    },
    async ({ id, ...cambios }) => {
      if (Object.keys(cambios).length === 0) return fallo("No enviaste ningún campo para cambiar.");
      if (cambios.etiquetas) cambios.etiquetas = limpiarEtiquetas(cambios.etiquetas);
      return consulta(async () => {
        const db = await getDb();
        const r = await db.from("piezas").update(cambios).eq("id", id).select(COLUMNAS);
        if (!r.error && r.data.length === 0) return { data: null, error: { message: "No existe una pieza con ese id." } };
        return { data: r.data?.[0], error: r.error };
      });
    },
  );

  return server;
}
