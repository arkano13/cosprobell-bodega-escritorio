// Reportes de bodega del panel del supervisor (además del Cuadre con SAP): cada uno con sus filtros, tarjetas, frases
// destacadas, gráficos y tablas, en pantalla y en PDF. Los textos sin DOM están en reportes.js (con pruebas).
import { ESTADO_PREPARACION, MOTIVO_LECTURA, TIPO_CAMBIO, CLASE_PENDIENTE, TIPO_ACCION, TRAMO_VENCIMIENTO, alcanza, columnasPorDia, duracion, haceDias,
  mesCorto, textoVencimiento,
  horasConActividad, nombreArchivoReporte, porcentajeDecimal, textoDocumentoReporte, textoRango } from "./reportes.js";

export const REPORTES = [
  { id: "cuadre", texto: "Cuadre con SAP" },
  { id: "preparaciones", texto: "Preparaciones", titulo: "Preparaciones" },
  { id: "errores", texto: "Errores evitados", titulo: "Errores evitados" },
  { id: "salidas", texto: "Más salen", titulo: "Productos que más salen" },
  { id: "reposiciones", texto: "Reposiciones", titulo: "Reposiciones de la 01 a la 02" },
  { id: "correcciones", texto: "Correcciones", titulo: "Correcciones y ajustes" },
  { id: "pendientes", texto: "Pendientes atrasados", titulo: "Pendientes que se atrasan" },
  { id: "actividad", texto: "Actividad", titulo: "Actividad por operador" },
  { id: "vencimientos", texto: "Vencimientos", titulo: "Vencimientos" },
];

const PERIODOS = { hoy: "Hoy", "7d": "7 días", "30d": "30 días", "60d": "60 días", "90d": "90 días", mes: "Este mes" };
const numero = (valor) => Number(valor ?? 0).toLocaleString("es-HN");
const plural = (n, uno, varios) => `${numero(n)} ${n === 1 ? uno : varios}`;

// d: utilidades de la app (h, boton, aviso, icono, cargando, insignia, api, fechaHora, horaCorta, guardarPdf, irAPendientes).
export function crearReportesBodega(d) {
  const { h, boton, aviso, icono, cargando, insignia, api, fechaHora, horaCorta } = d;
  // Filtros elegidos de cada reporte (se conservan al cambiar de reporte y al actualizar).
  const filtros = {
    preparaciones: { periodo: "7d", operador: "", documento: "todos" }, errores: { periodo: "30d", operador: "" },
    salidas: { periodo: "30d", limite: 20 }, reposiciones: { periodo: "60d", como: "todas" },
    correcciones: { periodo: "30d", tipo: "todos", persona: "" }, pendientes: { minDias: 3 }, actividad: { dia: "", persona: "" },
    vencimientos: { dias: 90, donde: "todas" },
  };

  // ---------- Piezas comunes ----------
  const chip = (texto, activo, onclick, n = null) => h("button", { class: "filtro", type: "button", "aria-pressed": activo ? "true" : "false", onclick },
    texto, n !== null && h("span", { class: "n" }, numero(n)));
  const grupo = (rotulo, ...controles) => h("div", { class: "reporte-filtro" }, h("span", { class: "reporte-filtro__rotulo" }, rotulo),
    h("div", { class: "filtros", role: "group", "aria-label": rotulo }, ...controles));
  const periodos = (id, opciones, alCambiar) => grupo("Período", ...opciones.map((p) =>
    chip(PERIODOS[p], filtros[id].periodo === p, () => alCambiar({ periodo: p }))));
  const selector = (rotulo, valor, opciones, alCambiar) => {
    const id = `filtro-${rotulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]+/g, "-")}`;
    const campo = h("select", { id, class: "campo campo--select", onchange: (e) => alCambiar(e.target.value) },
      opciones.map(([v, texto]) => h("option", { value: v, selected: String(v) === String(valor) ? true : null }, texto)));
    return h("div", { class: "reporte-filtro" }, h("label", { class: "reporte-filtro__rotulo", for: id }, rotulo), campo);
  };
  const operadoresOpciones = (lista, todos = "Todos") => [["", todos], ...(lista ?? []).map((o) => [o.nombre, o.nombre])];
  const cifra = (tono, valor, texto, detalle = null) => h("div", { class: `reporte-cifra reporte-cifra--${tono}` },
    h("strong", {}, valor), h("span", { class: "reporte-cifra__texto" }, texto), detalle && h("span", { class: "suave" }, detalle));
  const cifras = (...lista) => h("div", { class: `reporte-cifras reporte-cifras--${lista.length}` }, ...lista);
  const destacados = (frases) => (frases?.length ? h("ul", { class: "reporte-destacados" }, frases.map((t) => h("li", {}, t))) : null);
  const seccion = (tono, titulo, bajada, ...contenido) => h("section", { class: `reporte-seccion reporte-seccion--${tono}` },
    h("header", { class: "reporte-seccion__titulo" }, h("h3", {}, titulo), bajada && h("p", { class: "suave" }, bajada)), ...contenido);
  const vacio = (texto = "Nada en este período.") => h("p", { class: "reporte-vacio" }, texto);
  const tono = (t, texto) => insignia(t, null, texto);
  const codigo = (texto) => h("td", { class: "codigo" }, texto ?? "—");
  const num = (valor, clase = "") => h("td", { class: `tabla__numero ${clase}`.trim() }, typeof valor === "number" ? numero(valor) : valor ?? "—");
  function tabla(columnas, filas, clase = "") {
    return h("div", { class: "tabla-envoltura" }, h("table", { class: `tabla tabla-reporte ${clase}`.trim() },
      h("thead", {}, h("tr", {}, columnas.map((c) => h("th", { scope: "col", class: c.numero ? "tabla__numero" : null }, c.texto ?? c)))),
      h("tbody", {}, filas)));
  }
  // Barra horizontal proporcional (el ancho se pone por JS: la política de contenido no permite estilos en línea).
  function medidor(valor, maximo, t = "accion") {
    const relleno = h("span", { class: `medidor__relleno medidor__relleno--${t}` });
    relleno.style.width = `${maximo > 0 ? Math.max(0, Math.min(100, (valor * 100) / maximo)) : 0}%`;
    return h("span", { class: "medidor", "aria-hidden": "true" }, relleno);
  }
  // Gráfico de columnas: columnas = [{ rotulo, partes: [{ valor, tono }], etiqueta }]; la altura es la suma de las partes.
  function columnas(lista, { leyenda = [], descripcion }) {
    const maximo = Math.max(1, ...lista.map((c) => c.partes.reduce((t, p) => t + p.valor, 0)));
    return h("figure", { class: "grafico" },
      leyenda.length > 0 && h("ul", { class: "grafico__leyenda" }, leyenda.map(([t, texto]) => h("li", {}, h("span", { class: `grafico__muestra grafico__muestra--${t}` }), texto))),
      h("div", { class: "grafico__columnas", role: "img", "aria-label": descripcion }, lista.map((c) => {
        const total = c.partes.reduce((t, p) => t + p.valor, 0);
        const pila = h("div", { class: "grafico__pila" }, c.partes.filter((p) => p.valor > 0).map((p) => {
          const parte = h("span", { class: `grafico__parte grafico__parte--${p.tono}` });
          parte.style.height = `${(p.valor * 100) / maximo}%`;
          return parte;
        }));
        return h("div", { class: "grafico__columna" }, h("span", { class: "grafico__valor" }, c.etiqueta ?? numero(total)), pila,
          h("span", { class: "grafico__rotulo" }, c.rotulo));
      })));
  }
  const momento = (r) => `${r.desde && r.hasta ? textoRango(r.desde, r.hasta) : "Ahora"} · generado el ${fechaHora(r.generadoEn)}`;

  // ---------- 1. Preparaciones ----------
  const preparaciones = {
    cargar: () => api.reporte("preparaciones", filtros.preparaciones),
    sub: (r) => momento(r),
    filtros: (r, cambiar) => [periodos("preparaciones", ["hoy", "7d", "30d", "mes"], cambiar),
      selector("Operador", filtros.preparaciones.operador, operadoresOpciones(r.filtros?.operadores), (v) => cambiar({ operador: v })),
      selector("Documento", filtros.preparaciones.documento, [["todos", "Facturas y traslados"], ["facturas", "Solo facturas"], ["traslados", "Solo traslados"]],
        (v) => cambiar({ documento: v }))],
    contenido(r, { pdf, verDetalle }) {
      const s = r.resumen;
      const cola = r.sinPreparar;
      const maxRitmo = Math.max(1, ...r.porOperador.map((o) => o.ritmo ?? 0));
      return [
        cifras(cifra("accion", numero(s.preparaciones), "Preparaciones", `${plural(s.facturas, "factura", "facturas")} · ${plural(s.traslados, "traslado", "traslados")}`),
          cifra("accion", numero(s.unidades), "Unidades preparadas", `${numero(s.unidadesPorPreparacion)} por preparación`),
          cifra("ok", duracion(s.segundosPromedio), "Tiempo promedio", "minutos por preparación"),
          cifra("mas", numero(s.conDiferencias), "Con diferencias", `${porcentajeDecimal(s.porcentajeConDiferencias)} de las preparaciones`)),
        destacados(r.destacados),
        h("div", { class: "reporte-dos" },
          seccion("accion", r.porDia.length > 14 ? "Por semana" : "Por día", null, columnas(columnasPorDia(r.porDia).map((x) => ({ rotulo: x.rotulo,
            partes: [{ valor: x.completas, tono: "accion" }, { valor: x.conDiferencias, tono: "alerta" }] })),
          { leyenda: [["accion", "Completas"], ["alerta", "Con diferencias"]], descripcion: "Preparaciones terminadas en el período" })),
          seccion("alerta", `Sin preparar · ${numero(cola.total)}`, null,
            h("div", { class: "reporte-antiguedad" },
              h("div", { class: "reporte-antiguedad__caja" }, h("span", {}, "Hoy"), h("strong", {}, numero(cola.hoy))),
              h("div", { class: "reporte-antiguedad__caja reporte-antiguedad__caja--alerta" }, h("span", {}, "1 a 2 días"), h("strong", {}, numero(cola.unoADos))),
              h("div", { class: "reporte-antiguedad__caja reporte-antiguedad__caja--error" }, h("span", {}, "3 días o más"), h("strong", {}, numero(cola.tresOMas)))),
            cola.lista.length ? h("ul", { class: "reporte-cola" }, cola.lista.map((x) => h("li", {},
              h("span", {}, h("strong", {}, textoDocumentoReporte(x)), ` · ${plural(x.lineas, "línea", "líneas")}`),
              tono(x.dias >= 3 ? "error" : x.dias >= 1 ? "alerta" : "rol", haceDias(x.dias).toUpperCase())))) : vacio("No hay documentos esperando."))),
        seccion("accion", "Por operador", "El ritmo son unidades por hora de preparación. Las preparaciones abiertas más de 4 horas no cuentan en el tiempo.",
          r.porOperador.length ? tabla([{ texto: "Operador" }, { texto: "Preparaciones", numero: true }, { texto: "Unidades", numero: true },
            { texto: "Tiempo promedio", numero: true }, { texto: "Con diferencias", numero: true }, { texto: "Ritmo" }],
          r.porOperador.map((o) => h("tr", {}, h("th", { scope: "row" }, o.operador), num(o.preparaciones), num(o.unidades),
            num(duracion(o.segundosPromedio)), num(o.conDiferencias),
            h("td", { class: "tabla-reporte__medidor" }, medidor(o.ritmo ?? 0, maxRitmo), h("strong", {}, o.ritmo === null ? "—" : numero(o.ritmo)))))) : vacio()),
        seccion("alerta", `Con diferencias, en revisión o anuladas · ${numero(r.atencion.length)}`,
          pdf ? "Las preparaciones sin novedad no se listan." : "Las preparaciones sin novedad no se listan. Tocá Ver para ver sus lecturas.",
          r.atencion.length ? tabla(["Documento", "Operador", "Terminó", { texto: "Preparado / pedido", numero: true }, "Estado", ...(pdf ? [] : [""])],
            r.atencion.map((x) => h("tr", {}, h("th", { scope: "row" }, textoDocumentoReporte(x)), h("td", {}, x.operador ?? "—"),
              h("td", { class: "codigo" }, fechaHora(x.fecha)), num(`${numero(x.preparadas)} / ${numero(x.pedidas)}`),
              h("td", {}, tono(ESTADO_PREPARACION[x.estado]?.tono ?? "gris", ESTADO_PREPARACION[x.estado]?.texto ?? x.estado)),
              !pdf && h("td", {}, boton("boton--chico", null, "Ver", { onclick: () => verDetalle(x.pickingId) }))))) : vacio("Ninguna.")),
      ];
    },
  };

  // ---------- 3. Detalle de una preparación ----------
  function contenidoDetalle(r) {
    const estadoP = ESTADO_PREPARACION[r.estado] ?? { texto: r.estado, tono: "gris" };
    const falta = r.faltan.unidades > 0;
    const datoD = (rotulo, valor) => h("div", { class: "reporte-dato" }, h("span", { class: "rotulo" }, rotulo), h("strong", {}, valor));
    return [
      h("div", { class: `reporte-ficha reporte-ficha--${estadoP.tono}` },
        h("div", { class: "reporte-ficha__titulo" }, h("h2", {}, textoDocumentoReporte(r.documento).toUpperCase()), tono(estadoP.tono, estadoP.texto.toUpperCase())),
        h("p", { class: "reporte-ficha__bajada" }, falta ? `Faltaron ${plural(r.faltan.unidades, "unidad", "unidades")} de ${plural(r.faltan.productos, "producto", "productos")}.`
          : r.estado === "anulada" ? `La anuló ${r.anuladoPor?.persona ?? "el supervisor"}${r.anuladoPor ? ` el ${fechaHora(r.anuladoPor.fecha)}` : ""}.` : "Se preparó todo lo pedido."),
        h("div", { class: "reporte-ficha__datos" }, datoD("Operador", r.operador ?? "—"), datoD("Unidades", `${numero(r.unidades.preparadas)} de ${numero(r.unidades.pedidas)}`),
          datoD("Líneas completas", `${numero(r.lineasCompletas)} de ${numero(r.lineasTotal)}`), datoD("Inicio", fechaHora(r.inicio)),
          datoD("Fin", r.fin ? fechaHora(r.fin) : "—"), datoD("Duración", r.segundos === null ? "—" : `${duracion(r.segundos)} min`))),
      h("div", { class: "reporte-dos" },
        seccion("accion", "Productos", null, h("ul", { class: "reporte-productos" }, r.productos.map((p) => h("li", { class: `reporte-producto${p.falta ? " reporte-producto--falta" : ""}` },
          h("div", {}, h("strong", {}, p.itemName ?? p.itemCode), h("div", {}, h("span", { class: "codigo codigo--barras" }, p.codigo ?? p.itemCode), " ", h("span", { class: "suave" }, p.uomCode ?? "")),
            p.combo && h("small", { class: "suave" }, `Del combo ${p.combo.itemName ?? p.combo.itemCode}`)),
          h("div", { class: "reporte-producto__cuenta" }, h("strong", {}, numero(p.preparada)), ` / ${numero(p.pedida)}`,
            p.falta > 0 && h("small", {}, `Faltan ${numero(p.falta)}`)))))),
        seccion("accion", `Lecturas · ${numero(r.lecturas.total)}`, `${plural(r.lecturas.aceptadas, "aceptada", "aceptadas")} · ${plural(r.lecturas.rechazadas, "rechazada", "rechazadas")}. Las más recientes primero.`,
          r.lecturas.lista.length ? h("ul", { class: "reporte-lecturas" }, r.lecturas.lista.map((l) => h("li", { class: `reporte-leida reporte-leida--${l.resultado}` },
            icono(l.resultado === "aceptado" ? "aceptada" : "rechazada"),
            h("div", {}, h("strong", {}, l.itemName ?? `Código ${l.codigo}`),
              h("small", {}, l.resultado === "aceptado" ? `Lleva ${numero(l.lleva)}${l.de ? ` de ${numero(l.de)}` : ""}${l.combo ? ` · del combo ${l.combo}` : ""}`
                : MOTIVO_LECTURA[l.motivo] ?? l.mensaje ?? "Rechazada")),
            h("span", { class: "codigo" }, horaCorta(l.hora))))) : vacio("Sin lecturas."))),
    ];
  }

  // ---------- 2. Errores evitados ----------
  const errores = {
    cargar: () => api.reporte("errores", filtros.errores),
    sub: (r) => momento(r),
    filtros: (r, cambiar) => [periodos("errores", ["hoy", "7d", "30d", "mes"], cambiar),
      selector("Operador", filtros.errores.operador, operadoresOpciones(r.filtros?.operadores), (v) => cambiar({ operador: v }))],
    contenido(r) {
      const s = r.resumen;
      const maxMotivo = Math.max(1, ...r.motivos.map((m) => m.cantidad));
      const maxTasa = Math.max(1, ...r.porOperador.map((o) => o.tasa));
      return [
        cifras(cifra("accion", numero(s.lecturas), "Lecturas", `en ${plural(s.preparaciones, "preparación", "preparaciones")}`),
          cifra("menos", numero(s.rechazadas), "Rechazadas", `${porcentajeDecimal(s.porcentajeRechazadas)} de las lecturas`),
          cifra("mas", numero(s.equivocado), "Producto equivocado", "no iba en el documento"),
          cifra("ok", porcentajeDecimal(s.tasaSemana), "Esta semana", s.tasaHace8Semanas === null ? "sin datos de hace 8 semanas" : `venía de ${porcentajeDecimal(s.tasaHace8Semanas)} hace 8 semanas`)),
        destacados(r.destacados),
        h("div", { class: "reporte-dos" },
          seccion("menos", "Por motivo", null, h("ul", { class: "reporte-motivos" }, r.motivos.map((m) => h("li", {},
            h("div", { class: "reporte-motivos__fila" }, h("span", {}, h("strong", {}, m.titulo), ` · ${m.detalle}`), h("strong", {}, numero(m.cantidad))),
            medidor(m.cantidad, maxMotivo, "error"))))),
          seccion("accion", "Por semana", "Porcentaje de lecturas rechazadas.", columnas(r.porSemana.map((x) => ({ rotulo: `S${x.numero}`,
            partes: [{ valor: x.tasa, tono: "accion" }], etiqueta: porcentajeDecimal(x.tasa) })), { descripcion: "Porcentaje de lecturas rechazadas por semana" }))),
        seccion("accion", "Por operador", null, r.porOperador.length ? tabla([{ texto: "Operador" }, { texto: "Lecturas", numero: true },
          { texto: "Rechazadas", numero: true }, { texto: "Producto equivocado", numero: true }, { texto: "De más", numero: true },
          { texto: "Código no registrado", numero: true }, { texto: "Tasa de error" }],
        r.porOperador.map((o) => h("tr", {}, h("th", { scope: "row" }, o.operador), num(o.lecturas), num(o.rechazadas), num(o.equivocado), num(o.deMas),
          num(o.noRegistrado + o.codigoCaja), h("td", { class: "tabla-reporte__medidor" }, medidor(o.tasa, maxTasa, o.tasa >= 6 ? "error" : "alerta"),
            h("strong", {}, porcentajeDecimal(o.tasa)))))) : vacio()),
        seccion("alerta", "Productos que más se escanean sin ir", "Si uno se repite, revisá dónde está ubicado o si su empaque se parece a otro.",
          r.productos.length ? tabla(["Código", "Producto", { texto: "Veces", numero: true }, "Se confunde más con"],
            r.productos.map((p) => h("tr", {}, codigo(p.codigo), h("th", { scope: "row" }, p.itemName ?? "Producto sin nombre"), num(p.veces),
              h("td", {}, p.seConfundeCon ? p.seConfundeCon.itemName ?? p.seConfundeCon.itemCode : "—")))) : vacio("Ninguno."),
          h("p", { class: "suave reporte-nota" }, "\"Se confunde más con\": el producto que se leyó bien justo después en esa preparación, es decir, el que había que tomar.")),
      ];
    },
  };

  // ---------- 4. Más salen ----------
  const salidas = {
    cargar: () => api.reporte("salidas", filtros.salidas),
    sub: (r) => `${momento(r)} · lo preparado en facturas y traslados desde la 02`,
    filtros: (_r, cambiar) => [periodos("salidas", ["7d", "30d", "90d"], cambiar),
      selector("Mostrar", filtros.salidas.limite, [[10, "Los 10 que más salen"], [20, "Los 20 que más salen"], [50, "Los 50 que más salen"]], (v) => cambiar({ limite: Number(v) }))],
    contenido(r) {
      const s = r.resumen;
      const maxParte = Math.max(1, ...r.productos.map((p) => p.parte));
      return [
        cifras(cifra("accion", numero(s.unidades), "Unidades preparadas", `${numero(s.porDiaHabil)} por día hábil`),
          cifra("accion", numero(s.productos), "Productos distintos", "salieron al menos una vez"),
          cifra("mas", numero(s.alcanzanParaPoco), "Alcanzan para poco", "menos de 3 días en la 02"),
          cifra("gris", numero(s.sinSalidas), "Sin salidas", "tienen unidades en la 02")),
        destacados(r.destacados),
        seccion("accion", "Los que más salen", "\"Alcanza para\" = lo que hay hoy en la 02 ÷ lo que sale por día hábil (de lunes a sábado).",
          r.productos.length ? tabla(["#", "Código", "Producto", { texto: "Unidades", numero: true }, "Parte del total", { texto: "En cuántos documentos", numero: true },
            { texto: "Por día", numero: true }, { texto: "En la 02", numero: true }, "Alcanza para"],
          r.productos.map((p, i) => { const a = alcanza(p.alcanzaDias);
            return h("tr", {}, num(i + 1), codigo(p.codigo ?? p.itemCode), h("th", { scope: "row" }, p.itemName ?? p.itemCode), num(p.unidades),
              h("td", { class: "tabla-reporte__medidor" }, medidor(p.parte, maxParte), h("span", {}, porcentajeDecimal(p.parte))), num(p.documentos),
              num(p.porDia), num(p.en02), h("td", {}, tono(a.tono, a.texto.toUpperCase()))); })) : vacio()),
        seccion("gris", `Con unidades en la 02 y sin salidas · ${numero(r.sinSalidas.length)}`, "Candidatos a volver a la 01 o a revisar si siguen a la venta.",
          r.sinSalidas.length ? tabla(["Código", "Producto", { texto: "En la 02", numero: true }, "Última salida", "Vence primero"],
            r.sinSalidas.map((p) => h("tr", {}, codigo(p.codigo ?? p.itemCode), h("th", { scope: "row" }, p.itemName ?? p.itemCode), num(p.en02),
              h("td", {}, p.diasSinSalir === null ? "Nunca en la app" : haceDias(p.diasSinSalir)),
              h("td", { class: "codigo" }, p.vencePrimero ? `${p.vencePrimero.slice(5, 7)}/${p.vencePrimero.slice(0, 4)}` : "—")))) : vacio("Ninguno.")),
      ];
    },
  };

  // ---------- 5. Reposiciones ----------
  const reposiciones = {
    cargar: () => api.reporte("reposiciones", filtros.reposiciones),
    sub: (r) => `${momento(r)} · traspasos aceptados y cajas pasadas a mano`,
    filtros: (_r, cambiar) => [periodos("reposiciones", ["30d", "60d", "90d"], cambiar),
      selector("Cómo se pasaron", filtros.reposiciones.como, [["todas", "Todas"], ["sap", "Traspasos de SAP aceptados"], ["mano", "Pasadas a mano"]], (v) => cambiar({ como: v }))],
    contenido(r) {
      const s = r.resumen;
      const vence = (x) => (x.loteVencePrimero ? `${x.loteVencePrimero.lote ?? "sin lote"}${x.loteVencePrimero.vencimiento ? ` · ${x.loteVencePrimero.vencimiento.slice(5, 7)}/${x.loteVencePrimero.vencimiento.slice(0, 4)}` : ""}` : "—");
      return [
        cifras(cifra("accion", numero(s.reposiciones), "Reposiciones", `${s.porSemana.toLocaleString("es-HN")} por semana`),
          cifra("accion", numero(s.cajas), "Cajas pasadas", plural(s.unidades, "unidad", "unidades")),
          cifra("accion", numero(s.productos), "Productos repuestos", "al menos una vez"),
          cifra("mas", numero(s.reponerPronto), "Reponer pronto", "la 02 alcanza para menos de 3 días")),
        destacados(r.destacados),
        seccion("accion", "Por semana", null, columnas(r.porSemana.map((x) => ({ rotulo: `S${x.numero}`,
          partes: [{ valor: x.sap, tono: "accion" }, { valor: x.mano, tono: "lila" }] })),
        { leyenda: [["accion", "Traspaso de SAP aceptado"], ["lila", "Pasada a mano"]], descripcion: "Reposiciones por semana" })),
        seccion("alerta", `Reponer pronto · ${numero(r.reponerPronto.length)}`, "Lo que hay en la 02 ÷ lo que sale por día (últimos 30 días).",
          r.reponerPronto.length ? tabla(["Código", "Producto", { texto: "En la 02", numero: true }, { texto: "Sale por día", numero: true }, "Alcanza para",
            { texto: "Cajas en la 01", numero: true }, "Lote que vence primero"],
          r.reponerPronto.map((p) => { const a = alcanza(p.alcanzaDias);
            return h("tr", {}, codigo(p.codigo ?? p.itemCode), h("th", { scope: "row" }, p.itemName ?? p.itemCode), num(p.en02), num(p.salePorDia),
              h("td", {}, tono(a.tono, a.texto.toUpperCase())), num(p.cajasEnGrande), h("td", { class: "codigo" }, vence(p))); })) : vacio("Ninguno.")),
        seccion("accion", "Los que más se reponen", null, r.masSeReponen.length ? tabla(["Código", "Producto", { texto: "Veces", numero: true },
          { texto: "Cajas", numero: true }, { texto: "Unidades", numero: true }, { texto: "Cajas por vez", numero: true }, "Cada cuánto", "Última"],
        r.masSeReponen.map((p) => h("tr", {}, codigo(p.codigo ?? p.itemCode), h("th", { scope: "row" }, p.itemName ?? p.itemCode), num(p.veces), num(p.cajas),
          num(p.unidades), num(p.cajasPorVez), h("td", {}, p.cadaDias === null ? "—" : `Cada ${plural(p.cadaDias, "día", "días")}`),
          h("td", { class: "codigo" }, new Date(p.ultima).toLocaleDateString("es-HN", { day: "2-digit", month: "2-digit" }))))) : vacio()),
      ];
    },
  };

  // ---------- 6. Correcciones ----------
  const correcciones = {
    cargar: () => api.reporte("correcciones", filtros.correcciones),
    sub: (r) => `${momento(r)} · todo lo que se cambió después de guardado, con quién y qué había antes`,
    filtros: (r, cambiar) => [periodos("correcciones", ["7d", "30d", "90d", "mes"], cambiar),
      grupo("Qué cambió", ...[["todos", "Todos"], ["conteo", "Conteos editados"], ["lote", "Lotes cambiados"], ["anulada", "Anuladas"], ["codigo", "Códigos quitados"]]
        .map(([v, texto]) => chip(texto, filtros.correcciones.tipo === v, () => cambiar({ tipo: v }), r.resumen[v]))),
      selector("Quién", filtros.correcciones.persona, [["", "Todos"], ...r.personas.map((p) => [p, p])], (v) => cambiar({ persona: v }))],
    contenido(r) {
      const s = r.resumen;
      return [
        cifras(cifra("mas", numero(s.conteo), "Conteos editados", s.unidadesConteo ? `${s.unidadesConteo > 0 ? "+" : "−"}${numero(Math.abs(s.unidadesConteo))} unidades en total` : "sin cambio de unidades"),
          cifra("mas", numero(s.lote), "Lotes cambiados", "en salidas marcadas"),
          cifra("menos", numero(s.anulada), "Preparaciones anuladas", "por el supervisor"),
          cifra("accion", numero(s.codigo), "Códigos quitados", "de barras o de caja")),
        destacados(r.destacados),
        seccion("alerta", `Cambios · ${numero(r.cambios.length)}`, "El más reciente primero.",
          r.cambios.length ? tabla(["Cuándo", "Quién", "Qué", "Sobre", "Antes → ahora"],
            r.cambios.map((c) => h("tr", {}, h("td", { class: "codigo" }, fechaHora(c.fecha)), h("td", {}, c.persona ?? "—"),
              h("td", {}, tono(TIPO_CAMBIO[c.tipo]?.tono ?? "gris", (TIPO_CAMBIO[c.tipo]?.texto ?? c.tipo).toUpperCase())),
              h("th", { scope: "row" }, c.titulo ?? "—", h("small", { class: "suave" }, c.detalle ?? "")),
              h("td", { class: "reporte-cambio" }, h("del", {}, c.antes ?? "—"), h("strong", {}, c.ahora ?? "—"))))) : vacio("No hubo cambios."),
          h("p", { class: "suave reporte-nota" }, "Solo cambios hechos en la app. Nada de esto se escribe en SAP.")),
      ];
    },
  };

  // ---------- 7. Pendientes atrasados ----------
  const pendientes = {
    cargar: () => api.reporte("pendientes", filtros.pendientes),
    sub: (r) => `Ahora · desde cuándo espera cada pendiente del inventario · generado el ${fechaHora(r.generadoEn)}`,
    filtros: (_r, cambiar) => [grupo("Mostrar en la lista los que esperan", ...[[0, "Todos"], [1, "1 día o más"], [3, "3 días o más"], [7, "7 días o más"]]
      .map(([v, texto]) => chip(texto, filtros.pendientes.minDias === v, () => cambiar({ minDias: v }))))],
    contenido(r, { pdf }) {
      const tarjeta = (clave) => {
        const t = r.resumen[clave];
        const caja = (texto, n, extra = "") => h("div", { class: `reporte-antiguedad__caja${extra}` }, h("strong", {}, numero(n)), h("span", {}, texto));
        return h("div", { class: "reporte-pendiente" }, h("div", { class: "reporte-pendiente__titulo" }, h("h3", {}, CLASE_PENDIENTE[clave].texto), h("strong", {}, numero(t.total))),
          h("div", { class: "reporte-antiguedad reporte-antiguedad--4" }, caja("Hoy", t.hoy), caja("1–2 días", t.unoADos),
            caja("3–6 días", t.tresASeis, " reporte-antiguedad__caja--alerta"), caja("7+ días", t.sieteOMas + t.sinFecha, " reporte-antiguedad__caja--error")),
          h("p", { class: "suave" }, t.masViejo ? `El más viejo: ${t.masViejo.itemName ?? t.masViejo.itemCode} · ${haceDias(t.masViejo.dias)}` : "Nada pendiente."));
      };
      const titulo = r.minDias === 0 ? "Todos los pendientes" : `Esperan ${plural(r.minDias, "día", "días")} o más`;
      return [
        h("div", { class: "reporte-pendientes" }, tarjeta("faltaGuardar"), tarjeta("faltaMarcarSalida"), tarjeta("traspasosPorAceptar")),
        destacados(r.destacados),
        seccion("menos", `${titulo} · ${numero(r.lista.length)}`, "Del más viejo al más nuevo. \"Desde\" es cuando SAP registró el último movimiento del producto.",
          r.lista.length ? tabla(["Pendiente", "Código", "Producto", { texto: "Unidades", numero: true }, "Desde", "Espera", ...(pdf ? [] : [""])],
            r.lista.map((p) => h("tr", {}, h("td", {}, tono("rol", CLASE_PENDIENTE[p.clase].texto.toUpperCase())), codigo(p.codigo ?? p.itemCode),
              h("th", { scope: "row" }, p.itemName ?? p.itemCode), num(p.unidades), h("td", { class: "codigo" }, p.desde ? fechaHora(p.desde) : "—"),
              h("td", {}, tono(p.dias === null || p.dias >= 7 ? "error" : p.dias >= 3 ? "alerta" : "gris", p.dias === null ? "SIN FECHA" : plural(p.dias, "día", "días").toUpperCase())),
              !pdf && h("td", {}, boton("boton--chico", null, CLASE_PENDIENTE[p.clase].boton, { onclick: () => d.irAPendientes(CLASE_PENDIENTE[p.clase].pestana) }))))) : vacio("Nada espera tanto."),
          !pdf && h("p", { class: "suave reporte-nota" }, "Cada botón lleva a la misma pantalla de Pendientes del inventario.")),
      ];
    },
  };

  // ---------- 8. Actividad por operador ----------
  const actividad = {
    cargar: () => api.reporte("actividad", filtros.actividad),
    sub: (r) => `${textoRango(r.dia, r.dia)} · todo lo que hizo cada persona en la app`,
    filtros(r, cambiar) {
      const dia = h("input", { id: "filtro-dia", class: "campo", type: "date", value: r.dia, max: new Date().toLocaleDateString("en-CA"),
        onchange: (e) => e.target.value && cambiar({ dia: e.target.value }) });
      return [h("div", { class: "reporte-filtro" }, h("label", { class: "reporte-filtro__rotulo", for: "filtro-dia" }, "Día"), dia),
        r.personas.length ? grupo("Ver el detalle de", ...r.personas.map((p) => chip(p.persona, filtros.actividad.persona === p.persona,
          () => cambiar({ persona: filtros.actividad.persona === p.persona ? "" : p.persona })))) : null];
    },
    contenido(r) {
      const rango = (p) => (p.primera ? `${horaCorta(p.primera)} – ${horaCorta(p.ultima)}` : "—");
      const n = (v) => num(v ? v : "—");
      const det = r.detalle;
      const horas = det ? horasConActividad(det.porHora) : [];
      return [
        seccion("accion", "Todos en el día", null, r.personas.length ? tabla(["Operador", "Primera y última", { texto: "Preparaciones", numero: true },
          { texto: "Unidades preparadas", numero: true }, { texto: "Recepciones", numero: true }, { texto: "Productos contados", numero: true },
          { texto: "Reposiciones", numero: true }, { texto: "Salidas marcadas", numero: true }, { texto: "Códigos registrados", numero: true }],
        r.personas.map((p) => h("tr", { class: det?.persona === p.persona ? "tabla-reporte__elegida" : null }, h("th", { scope: "row" }, p.persona),
          h("td", { class: "codigo" }, rango(p)), n(p.preparaciones), n(p.unidades), n(p.recepciones), n(p.productosContados), n(p.reposiciones),
          n(p.salidasMarcadas), n(p.codigosRegistrados)))) : vacio("Nadie usó la app ese día.")),
        det ? h("div", { class: "reporte-dos" },
          h("section", { class: "reporte-ficha reporte-ficha--accion" },
            h("h3", {}, det.persona.toUpperCase()), h("p", { class: "suave" }, `Primera acción ${det.primera ? horaCorta(det.primera) : "—"} · última ${det.ultima ? horaCorta(det.ultima) : "—"}`),
            h("div", { class: "reporte-mini" },
              h("div", {}, h("strong", {}, numero(det.preparaciones)), h("span", {}, `Preparaciones · ${plural(det.unidades, "unidad", "unidades")}`)),
              h("div", {}, h("strong", {}, numero(det.recepciones)), h("span", {}, "Recepciones")),
              h("div", {}, h("strong", {}, numero(det.productosContados)), h("span", {}, "Productos contados")),
              h("div", {}, h("strong", {}, numero(det.reposiciones)), h("span", {}, "Reposiciones a la 02"))),
            columnas(horas.map((x) => ({ rotulo: `${x.hora} h`, partes: [{ valor: x.cantidad, tono: "accion" }], etiqueta: x.cantidad ? numero(x.cantidad) : "" })),
              { descripcion: `Acciones por hora de ${det.persona}` }),
            h("p", { class: "suave reporte-nota" }, "Acciones por hora: lecturas, conteos y movimientos.")),
          seccion("accion", "Lo que hizo", "Lo más reciente primero.", det.acciones.length ? h("ul", { class: "reporte-acciones" }, det.acciones.map((a) => h("li", {},
            h("span", { class: "codigo" }, horaCorta(a.hora)), h("span", {}, h("strong", {}, a.titulo), a.detalle ? ` · ${a.detalle}` : ""),
            tono(TIPO_ACCION[a.tipo]?.tono ?? "gris", (TIPO_ACCION[a.tipo]?.texto ?? a.tipo).toUpperCase())))) : vacio("Solo lecturas de preparación.")))
          : h("p", { class: "suave" }, "Elegí una persona para ver el detalle de lo que hizo."),
      ];
    },
  };

  // ---------- 9. Vencimientos ----------
  const vencimientos = {
    cargar: () => api.reporte("vencimientos", filtros.vencimientos),
    sub: (r) => `Ahora · lotes vencidos y los que vencen en los próximos ${numero(r.filtros.dias)} días · generado el ${fechaHora(r.generadoEn)}`,
    filtros: (r, cambiar) => [grupo("Vencen en", ...[[30, "30 días"], [60, "60 días"], [90, "90 días"], [180, "6 meses"], [365, "1 año"]]
      .map(([v, texto]) => chip(texto, filtros.vencimientos.dias === v, () => cambiar({ dias: v })))),
    selector("Dónde", filtros.vencimientos.donde, [["todas", "Todas las bodegas"], ...r.filtros.lugares.map((a) => [a, `La ${a}`])], (v) => cambiar({ donde: v }))],
    contenido(r) {
      const s = r.resumen;
      const tabla_ = (lista) => tabla(["Vence", "Código", "Producto", "Dónde", "Lote", { texto: "Cajas", numero: true }, { texto: "Unidades", numero: true }, "Falta"],
        lista.map((l) => { const t = TRAMO_VENCIMIENTO[l.tramo];
          return h("tr", {}, h("td", { class: "codigo" }, textoVencimiento(l.vencimiento)), codigo(l.codigo ?? l.itemCode), h("th", { scope: "row" }, l.itemName ?? l.itemCode,
            l.contadoEn && h("small", { class: "suave" }, `Según el conteo del ${new Date(l.contadoEn).toLocaleDateString("es-HN")}`)),
          h("td", {}, `La ${l.almacen}`), h("td", { class: "codigo" }, l.lote ?? "Sin lote"), num(l.enCajas && l.cajas ? l.cajas : "—"), num(l.unidades),
          h("td", {}, tono(t.tono, (l.dias < 0 ? `Venció hace ${plural(-l.dias, "día", "días")}` : l.dias === 0 ? "Vence hoy" : `${plural(l.dias, "día", "días")}`).toUpperCase()))); }));
      return [
        cifras(cifra("menos", numero(s.vencido.unidades), "Vencidas", plural(s.vencido.lotes, "lote", "lotes")),
          cifra("mas", numero(s.en30.unidades), "Vencen en 30 días", plural(s.en30.lotes, "lote", "lotes")),
          cifra("accion", numero(s.en60.unidades + s.en90.unidades + s.mas.unidades), "Más adelante", `${plural(s.en60.lotes + s.en90.lotes + s.mas.lotes, "lote", "lotes")} dentro del plazo`),
          cifra("gris", numero(s.sinFecha.unidades), "Sin fecha", `${plural(s.sinFecha.productos, "producto", "productos")} sin vencimiento cargado`)),
        destacados(r.destacados),
        seccion("accion", "Por mes de vencimiento", "Unidades que vencen cada mes.", columnas(r.porMes.map((m) => ({ rotulo: m.mes === "vencido" ? "Vencido" : mesCorto(m.mes),
          partes: [{ valor: m.unidades, tono: m.mes === "vencido" ? "error" : "accion" }] })), { descripcion: "Unidades que vencen por mes" })),
        seccion("menos", `Vencidos · ${numero(r.vencidos.length)}`, "Del más viejo al más nuevo. Hay que sacarlos de la venta.", r.vencidos.length ? tabla_(r.vencidos) : vacio("Ninguno.")),
        seccion("alerta", `Por vencer · ${numero(r.porVencer.length)}`, "Del más próximo al más lejano.", r.porVencer.length ? tabla_(r.porVencer) : vacio("Nada vence en este plazo.")),
        r.pasarPrimero.length > 0 && seccion("accion", `Pasar primero a la 02 · ${numero(r.pasarPrimero.length)}`, "En estos productos la 01 tiene un lote que vence antes que todos los de la 02.",
          tabla(["Producto", "Lote en la 01", "Vence", "Lote en la 02", "Vence"], r.pasarPrimero.map((p) => h("tr", {}, h("th", { scope: "row" }, p.itemName ?? p.itemCode),
            h("td", { class: "codigo" }, p.loteGrande ?? "Sin lote"), h("td", { class: "codigo" }, textoVencimiento(p.venceGrande)),
            h("td", { class: "codigo" }, p.lotePequena ?? "Sin lote"), h("td", { class: "codigo" }, textoVencimiento(p.vencePequena)))))),
        r.sinFecha.length > 0 && h("p", { class: "suave reporte-nota" }, `Sin fecha de vencimiento: ${r.sinFecha.map((x) => `la ${x.almacen}, ${plural(x.unidades, "unidad", "unidades")}`).join(" · ")}. Se carga al contar o recibir.`),
      ];
    },
  };

  const DEFINICIONES = { preparaciones, errores, salidas, reposiciones, correcciones, pendientes, actividad, vencimientos };

  // Muestra un reporte en el contenedor. alVolver: para el detalle de una preparación.
  async function mostrar(contenedor, id, panel) {
    const def = DEFINICIONES[id];
    const meta = REPORTES.find((x) => x.id === id);
    contenedor.replaceChildren(cargando("Cargando el reporte…"));
    let r;
    try { r = (await def.cargar()).data; } catch (error) {
      contenedor.replaceChildren();
      if (["ALMACENES_SIN_ELEGIR", "COMPARACION_SAP_NO_DISPONIBLE"].includes(error?.codigo)) return contenedor.replaceChildren(aviso("alerta", error.mensaje));
      return panel.fallo(error, () => mostrar(contenedor, id, panel));
    }
    if (!contenedor.isConnected) return;
    const cambiar = (cambios) => { Object.assign(filtros[id], cambios); mostrar(contenedor, id, panel); };
    const verDetalle = (pickingId) => mostrarDetalle(contenedor, pickingId, panel, () => mostrar(contenedor, id, panel));
    const descargar = boton("boton--principal", "impresora", "Descargar PDF", { onclick: async () => {
      panel.avisar(null, "");
      descargar.disabled = true;
      const resultado = await d.guardarPdf({ titulo: meta.titulo, sub: def.sub(r), nodos: def.contenido(r, { pdf: true }),
        nombre: nombreArchivoReporte(meta.texto, r.generadoEn), pie: `Bodega Cosprobell · ${meta.titulo} · ${fechaHora(r.generadoEn)}` });
      descargar.disabled = false;
      avisarPdf(panel, resultado);
    } });
    if (!window.escritorio?.guardarPdf) descargar.hidden = true;
    contenedor.replaceChildren(
      h("div", { class: "reporte__encabezado" },
        h("div", {}, h("h2", {}, meta.titulo), h("p", { class: "suave" }, def.sub(r))),
        h("div", { class: "fila" }, boton("", "actualizar", "Actualizar", { onclick: () => mostrar(contenedor, id, panel) }), descargar)),
      h("div", { class: "reporte-filtros" }, ...def.filtros(r, cambiar).filter(Boolean)),
      ...def.contenido(r, { pdf: false, verDetalle }).filter(Boolean));
  }

  async function mostrarDetalle(contenedor, pickingId, panel, volver) {
    contenedor.replaceChildren(cargando("Cargando la preparación…"));
    let r;
    try { r = (await api.reportePreparacion(pickingId)).data; } catch (error) {
      contenedor.replaceChildren();
      return panel.fallo(error, volver);
    }
    if (!contenedor.isConnected) return;
    const descargar = boton("boton--principal", "impresora", "Descargar PDF", { onclick: async () => {
      panel.avisar(null, "");
      descargar.disabled = true;
      const titulo = textoDocumentoReporte(r.documento);
      const resultado = await d.guardarPdf({ titulo, sub: `Detalle de la preparación · ${r.operador ?? ""}`, nodos: contenidoDetalle(r),
        nombre: nombreArchivoReporte(`Preparacion ${titulo}`, new Date().toISOString()), pie: `Bodega Cosprobell · ${titulo}` });
      descargar.disabled = false;
      avisarPdf(panel, resultado);
    } });
    if (!window.escritorio?.guardarPdf) descargar.hidden = true;
    contenedor.replaceChildren(
      h("div", { class: "reporte__encabezado" },
        h("button", { class: "boton boton--volver", type: "button", onclick: volver }, icono("volver"), "Reportes · Preparaciones"),
        h("div", { class: "fila" }, descargar)),
      ...contenidoDetalle(r));
  }

  function avisarPdf(panel, resultado) {
    if (resultado.ok) panel.avisar("ok", `Reporte guardado: ${resultado.archivo}`);
    else if (resultado.motivo === "ocupado") panel.avisar("error", "No se pudo guardar: el archivo está abierto en otro programa. Cerralo o elegí otro nombre.");
    else if (!resultado.cancelado) panel.avisar("error", "No se pudo guardar el PDF. Probá de nuevo.");
  }

  return { mostrar };
}
