# Diseño visual de AndyOS (estilo «glassy»)

Origen: `Dash1.PNG` (Drive), adaptado. Vale para **todas** las pantallas actuales y las que vengan.

## Reglas para una pantalla nueva
1. **Marco:** la página se envuelve en `<AppShell current="/ruta/">` (`components/AppShell.tsx`). Da el fondo cálido, la barra lateral de iconos y el panel de cristal. Con panel lateral derecho: `aside={…}` (ver `Dashboard.tsx`).
2. **Barra lateral:** añade la ruta al arreglo `NAV` de `AppShell.tsx` (icono, ruta con `/` final, etiqueta). Un test (`test/shell.test.ts`) falla si una página no usa `AppShell` o si su ruta no está en `NAV`. Solo `login` y `privacy` están exentas (sin sesión), y aun así usan `dash-bg` + `skin`.
3. **Título:** un `<h1 className="text-xl font-bold">` visible arriba (el menú superior ya no existe).
4. **Contenido:** escríbelo con las utilidades de siempre (`bg-zinc-900`, `border-zinc-800`, `bg-orange-500`, `rounded-lg`…). Dentro de `.skin` (`globals.css`) los grises son superficies translúcidas, el naranja es `#ee6c2b` y los radios son más redondeados, así que hereda el diseño solo. No metas colores fijos nuevos ni `bg-black` a pelo.
5. **Tarjetas destacadas** (cifras, próxima publicación): blancas, `bg-white text-zinc-900 rounded-[1.4rem] shadow-lg`, con el valor grande en un color de acento (naranja `#ee6c2b`, rosa `#d6336c`, verde `#2f9e44`, azul `#3b5bdb`). Para gráficos usa SVG propio (`DashboardParts.tsx`) y la función `smoothPath`.
6. **Modales:** overlay `modal-overlay` y panel `modal-panel` (cristal casi opaco; con el skin translúcido el texto no se leería).
7. **Ancho:** el contenido va `mx-auto w-full max-w-…` dentro del panel; nada de `min-h-screen`/`h-screen` propios (usa `h-[calc(100vh-8.5rem)]` si necesitas altura fija).
8. **Móvil:** la barra lateral pasa a fila superior; comprueba que no haya scroll horizontal a 390 px.

## Piezas
- `AppShell.tsx`: `AppShell`, `SideNav`, `NAV`, `Icon`, `ORANGE`.
- `DashboardParts.tsx`: `StatCard`, `MiniBars`, `Pulse`, `Gauge`, `ActivityChart`.
- `globals.css`: `.dash-bg` (fondo), `.glass` (panel), `.skin` (re-mapeo de colores/radios/foco), `.modal-*`.

## Límites conocidos
- La mayoría de pantallas conservan su estructura (listas y formularios); solo el Dashboard usa tarjetas blancas de cifras. Rediseñar cada una a ese nivel sería trabajo por pantalla.
- Las tarjetas del Pipeline y el Calendario heredan el cristal oscuro, no el blanco de la referencia (a propósito, por legibilidad de columnas densas).
- No hay modo claro.
