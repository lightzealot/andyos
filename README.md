# Panel de contenido

Web estática (HTML + CSS + JS, sin build) para organizar la creación de contenido. Sin API propia: habla directo con Supabase (proyecto «AndyOS Web», tabla `piezas`, RLS por usuario). Login por enlace al correo.

- Vistas: Semana (con «Para hoy» y bandeja «Sin fecha»), Todas (por etapa y etiqueta) y Funcionaron.
- Etapas: Idea → Guion → Grabado → Editado → Publicado.
- Despliegue: Netlify publica `web/` (`netlify.toml`). Dominio previsto: `os.andresgomez.store`.
- Local: `cd web && python3 -m http.server 8000` y abre http://localhost:8000 (añade esa URL en Supabase → Authentication → URL Configuration).
- El código anterior (API + worker + web Next.js) está en la rama `archivo-andyos`.
