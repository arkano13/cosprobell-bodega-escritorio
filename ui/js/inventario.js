// Textos y cálculos del inventario, sin acceso al DOM (se prueban en test/ui.test.js).
const numero = (valor) => Number(valor).toLocaleString("es-HN");
const unidades = (n) => `${numero(n)} ${Math.abs(n) === 1 ? "unidad" : "unidades"}`;

// Estado de un producto frente a SAP (lo calcula el servidor), en palabras de la bodega.
export const ESTADOS = {
  al_dia: { tipo: "ok", texto: "Cuadra con SAP" },
  por_ubicar: { tipo: "alerta", texto: "Falta guardar" },
  por_descontar: { tipo: "alerta", texto: "Falta marcar salida" },
  actualizando: { tipo: "gris", texto: "SAP actualizándose" },
  conteo_inicial: { tipo: "gris", texto: "Falta contar" },
  sin_comparacion_sap: { tipo: "gris", texto: "Sin datos de SAP" },
};

// Las bodegas con el nombre que conoce la gente: el almacén de SAP asignado ("01 · Almacén Principal"), o
// "Bodega grande" / "Bodega pequeña" si todavía no se asignó. corto: "la 01" / "la grande".
const POR_DEFECTO = { grande: { largo: "Bodega grande", corto: "la grande" }, pequena: { largo: "Bodega pequeña", corto: "la pequeña" } };
export function nombreBodega(bodegas, bodega, { corto = false } = {}) {
  const b = bodegas?.[bodega];
  if (!b) return POR_DEFECTO[bodega][corto ? "corto" : "largo"];
  return corto ? `la ${b.almacen}` : `${b.almacen} · ${b.nombre}`;
}

// "hace 5 min", "hace 2 h", "hace 3 d".
export function haceTiempo(iso, ahora = Date.now()) {
  const minutos = Math.round((ahora - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutos)) return "fecha desconocida";
  if (minutos < 1) return "hace menos de 1 minuto";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return horas < 24 ? `hace ${horas} h` : `hace ${Math.floor(horas / 24)} d`;
}

// Indicador chico del estado de SAP: { tipo, texto, detalle }.
export function estadoSap({ almacenes = [], comparacionDisponible = false, existenciasSapAl = null }, ahora = Date.now()) {
  const llegada = existenciasSapAl ? `existencias ${haceTiempo(existenciasSapAl, ahora)}` : "todavía no llegaron existencias";
  if (!almacenes.length) return { tipo: "alerta", texto: "SAP sin configurar", detalle: "Falta elegir los almacenes de esta bodega" };
  if (comparacionDisponible) return { tipo: "ok", texto: "SAP al día", detalle: llegada };
  return { tipo: "gris", texto: "Sin datos recientes de SAP", detalle: `${llegada}. Lo de la bodega funciona igual.` };
}

// Avance del conteo de una bodega: { texto, porcentaje, faltan, completo }.
export function avanceConteo(avance) {
  if (!avance) return null;
  const { total, contados } = avance;
  const porcentaje = total ? Math.round((contados / total) * 100) : 100;
  return { texto: `${numero(contados)} de ${numero(total)} contados`, porcentaje, faltan: total - contados, completo: total > 0 && contados >= total };
}

// Pasos para poner en marcha el inventario (supervisor). datos: resumen del inventario + códigos sin confirmar.
export function pasosPuestaEnMarcha({ almacenes = [], bodegas = {}, conteo = {} }, sinConfirmar = null) {
  const contar = (bodega) => {
    const a = avanceConteo(conteo?.[bodega]);
    return { id: `contar-${bodega}`, texto: `Contar ${nombreBodega(bodegas, bodega, { corto: true })}`, hecho: Boolean(a?.completo),
      detalle: a ? a.texto : "Primero elegí su almacén", bodega };
  };
  const pasos = [
    { id: "almacenes", texto: "Marcar los almacenes de esta bodega", hecho: almacenes.length > 0,
      detalle: almacenes.length ? almacenes.join(" y ") : "Panel del supervisor → Almacenes" },
    { id: "bodegas", texto: "Elegir cuál almacén es cada bodega", hecho: Boolean(bodegas?.grande && bodegas?.pequena),
      detalle: bodegas?.grande && bodegas?.pequena ? `${nombreBodega(bodegas, "grande")} y ${nombreBodega(bodegas, "pequena")}` : "Grande (cajas) y pequeña (despacho)" },
    { id: "codigos", texto: "Confirmar los códigos de barras", hecho: sinConfirmar === 0,
      detalle: sinConfirmar === null ? "" : sinConfirmar === 0 ? "Todos confirmados" : `${numero(sinConfirmar)} sin confirmar` },
    contar("grande"), contar("pequena"),
  ];
  return { pasos, hechos: pasos.filter((p) => p.hecho).length, completo: pasos.every((p) => p.hecho) };
}

// Conteo de la 02: unidades sueltas por lote. filas: [{ lote, vencimiento, unidades }] (las vacías no cuentan).
export function armarLotesPequena(filas) {
  const lotes = [], vistos = new Set();
  for (const [i, f] of filas.entries()) {
    if (f.unidades === null && !f.lote) continue;
    const cual = filas.length > 1 ? ` (fila ${i + 1})` : "";
    if (!Number.isInteger(f.unidades) || f.unidades < 1) return { problema: `Escribí cuántas unidades hay${cual}.` };
    const clave = JSON.stringify([f.lote || null, f.vencimiento ?? null]);
    if (vistos.has(clave)) return { problema: `El lote ${f.lote || "sin lote"} está repetido.` };
    vistos.add(clave);
    lotes.push({ unidades: f.unidades, lote: f.lote || null, vencimiento: f.vencimiento ?? null });
  }
  if (!lotes.length) return { problema: "Escribí cuántas unidades hay, o tocá «No hay»." };
  return { lotes, total: lotes.reduce((t, l) => t + l.unidades, 0) };
}

// Sin almacenes elegidos o sin existencias recientes de SAP, el inventario de la bodega funciona igual,
// pero no se compara con SAP (la falta de datos no significa cero).
export const TEXTO_SIN_COMPARACION = "La comparación con SAP no está disponible: faltan los almacenes de esta bodega o datos recientes de existencias. "
  + "Recibir, reponer y contar funcionan igual.";

export function textoEstado(estado) {
  if (!estado || estado.estado === "sin_comparacion_sap") return "Sin datos recientes de SAP. Lo de la bodega funciona igual.";
  const d = estado.diferencia;
  if (estado.estado === "por_ubicar") return `SAP registró ${unidades(d)} que todavía no se guardaron en la bodega.`;
  if (estado.estado === "por_descontar") return `${-d === 1 ? "Salió" : "Salieron"} ${unidades(-d)} en SAP: falta marcar de qué lote.`;
  if (estado.estado === "conteo_inicial") return `Falta contar. SAP tiene ${unidades(d)}.`;
  if (estado.estado === "actualizando") return "SAP cambió hace poco: se espera unos minutos a que llegue todo antes de avisar.";
  return estado.faltaEnSap > 0 ? `Cuadra. ${unidades(estado.faltaEnSap)} se recibieron antes que SAP las registre.` : "Cuadra con SAP.";
}

export const esCodigoCaja = (texto) => /^CJ-\d{6,}$/i.test(String(texto).trim());
// Lo que deja el lector al escanear un envase (EAN-8, UPC, EAN-13, ITF-14…): solo números. Un nombre o un código de
// artículo escrito a mano no se toma por código de barras.
export const pareceCodigoBarras = (texto) => /^\d{6,20}$/.test(String(texto).trim());

// Vencimiento: las cajas traen mes y año ("03/2027"); se guarda el último día de ese mes.
export function finDeMes(mes) {
  const m = /^(\d{4})-(\d{2})$/.exec(mes ?? "");
  // Año completo y razonable: un "09/8" quedaba guardado como el año 8.
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[1]) < 2000 || Number(m[1]) > 2099) return null;
  const ultimo = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(ultimo).padStart(2, "0")}`;
}
export function textoVencimiento(iso) {
  if (!iso) return "Sin vencimiento";
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return d === ultimo ? `${String(m).padStart(2, "0")}/${a}` : `${d}/${m}/${a}`;
}
// Días hasta el vencimiento contados en fechas de calendario (null sin vencimiento).
export function diasParaVencer(iso, hoy = new Date()) {
  if (!iso) return null;
  const inicio = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - inicio) / 86_400_000);
}

export const NOMBRES_MOVIMIENTO = {
  recepcion: "Entrada", reposicion: "Reposición", traspaso: "Traspaso de SAP", picking: "Salida por pedido", descuento: "Descuento de SAP",
  reasignacion: "Cambio de lote", conteo: "Conteo", correccion: "Corrección de caja",
};
export function textoMovimiento(m) {
  const nombre = NOMBRES_MOVIMIENTO[m.tipo] ?? m.tipo;
  return m.tipo === "picking" && m.docNum ? `${nombre} ${m.docNum}` : nombre;
}
// Cantidad que mostró el movimiento: la reposición pasa de una bodega a la otra (no cambia el total).
export function cantidadMovimiento(m, bodegas = null) {
  if (m.tipo === "reposicion" || m.tipo === "traspaso") return `${numero(m.pequena)} u. a ${nombreBodega(bodegas, "pequena", { corto: true })}`;
  // Cambiar el lote devuelve unidades a un lugar y las resta de otro: el total no cambia.
  if (m.tipo === "reasignacion") return "No cambia el total";
  if (m.tipo === "recepcion" && m.cajas > 0 && m.grande > 0) return `${numero(m.cajas)} ${m.cajas === 1 ? "caja" : "cajas"} · ${numero(m.grande)} u.`;
  const total = (m.grande ?? 0) + (m.pequena ?? 0);
  // "No hay": se contó y no había ninguno.
  if (m.tipo === "conteo" && total === 0 && /no hay/i.test(m.observacion ?? "")) return "No hay";
  // Un conteo que solo reparte la pequeña entre sus lotes deja el total igual.
  if (m.tipo === "conteo" && total === 0) return "No cambia el total";
  return `${total > 0 ? "+" : ""}${numero(total)} u.`;
}

// "operador:Ana López" → "Ana López"; una aplicación queda con su nombre.
export const quien = (hechoPor) => (hechoPor ?? "").replace(/^operador:/, "") || "—";

export const NOMBRES_DOCUMENTO = {
  entradaCompra: "Entrada por compra", entradaInventario: "Entrada de mercancías", salidaInventario: "Salida de mercancías",
  devolucionProveedor: "Devolución al proveedor", devolucionCliente: "Devolución de cliente",
};
export const textoDocumento = (d) => `${NOMBRES_DOCUMENTO[d.tipo] ?? d.tipo} ${d.docNum}`;

// Conteo de la bodega de cajas. filas: [{ cajas (null si está vacío), unidadesPorCaja, lote, vencimiento }]; las filas
// sin cajas, lote ni vencimiento no cuentan. Si solo hay unidades sueltas, van como un bulto con etiqueta. Devuelve
// { cuerpo, total, cajas, etiquetas } (cuerpo para POST /inventario/recepciones, sin itemCode) o { problema }.
export function armarConteoCajas(filas, bulto = null) {
  const llenas = filas.filter((f) => f.cajas !== null || f.lote || f.vencimiento);
  if (!llenas.length) {
    if (!bulto) return { problema: "Escribí cuántas cajas hay, o tocá «No hay»." };
    if (!Number.isInteger(bulto.unidades) || bulto.unidades < 1) return { problema: "Escribí cuántas unidades sueltas hay." };
    return { cuerpo: { modo: "suelto", destino: "grande", unidades: bulto.unidades, lote: bulto.lote || null, vencimiento: bulto.vencimiento ?? null },
      total: bulto.unidades, cajas: 0, etiquetas: 1 };
  }
  const g = armarGrupos(llenas, bulto);
  if (g.problema) return g;
  return { cuerpo: { modo: "grupos", grupos: g.grupos, bulto: g.bulto }, total: g.total, cajas: g.cajas, etiquetas: g.etiquetas };
}

// Lo guardado en la grande, para editar el conteo (supervisor): una fila por lote, vencimiento y unidades por caja, y
// el bulto. lotes: los de la ficha ([{ cajas: [{ lote, vencimiento, unidades, unidadesIniciales, suelto }] }]). Solo con
// cajas sin usar, y con un bulto como mucho (el formulario tiene uno). Devuelve { filas, bulto } o { problema }.
export function conteoGuardadoGrande(lotes) {
  const cajas = lotes.flatMap((l) => l.cajas ?? []).filter((c) => c.unidades > 0);
  if (cajas.some((c) => c.unidades !== c.unidadesIniciales)) {
    return { problema: "Ya se sacaron unidades de alguna caja de este producto: corregí esa caja desde el producto." };
  }
  const bultos = cajas.filter((c) => c.suelto);
  if (bultos.length > 1) return { problema: "Este producto tiene más de un bulto en la grande: corregí las cajas desde el producto." };
  const filas = new Map();
  for (const c of cajas.filter((c) => !c.suelto)) {
    const clave = JSON.stringify([c.lote ?? null, c.vencimiento ?? null, c.unidades]);
    if (!filas.has(clave)) filas.set(clave, { cajas: 0, unidadesPorCaja: c.unidades, lote: c.lote ?? null, vencimiento: c.vencimiento ?? null });
    filas.get(clave).cajas += 1;
  }
  const b = bultos[0];
  return { filas: [...filas.values()], bulto: b ? { unidades: b.unidades, lote: b.lote ?? null, vencimiento: b.vencimiento ?? null } : null };
}

// Cuerpo de la edición del conteo de la grande ({ grupos, bulto }) a partir de lo que armó armarConteoCajas.
export const cuerpoEdicionGrande = (cuerpo) => (cuerpo.modo === "suelto"
  ? { grupos: [], bulto: { unidades: cuerpo.unidades, lote: cuerpo.lote ?? null, vencimiento: cuerpo.vencimiento ?? null } }
  : { grupos: cuerpo.grupos, bulto: cuerpo.bulto ?? null });

// "77 en 5 cajas y un bulto", "14 unidades".
export function textoContado({ total, cajas = 0, etiquetas = 0 }) {
  const bulto = etiquetas > cajas;
  if (!cajas) return bulto ? `${unidades(total)} sueltas en un bulto` : unidades(total);
  return `${unidades(total)} en ${numero(cajas)} ${cajas === 1 ? "caja" : "cajas"}${bulto ? " y un bulto" : ""}`;
}

// Traspaso de la 01 a la 02 que SAP ya registró (SAP no tiene lotes): la bodega acepta de qué lotes salió. Una fila por
// lote de la grande, con lo que tiene y lo sugerido, del que vence primero al último. lotes: los de la ficha
// ([{ lote, vencimiento, unidades }]); sugerencia: [{ lote, unidades }] o null.
const venceEn = (l) => (l.vencimiento ? Date.parse(String(l.vencimiento).slice(0, 10)) : Infinity);
// Traspaso escaneando cajas: cada caja escaneada es una caja entera de la 01 del lote y vencimiento que dice. Igual que el
// servidor (elegirCajas): por cada una, la primera caja libre de ese lote y fecha, primero las enteras y después la más
// antigua. lotes: los de la ficha ({ lote, vencimiento, cajas: [{ id, unidades, unidadesIniciales }] }).
const diaDe = (v) => (v ? String(v).slice(0, 10) : null);
export function cajasDeLaGrande(lotes) {
  return (lotes ?? []).flatMap((l) => l.cajas.filter((c) => c.unidades > 0).map((c) => ({ ...c, lote: l.lote ?? null, vencimiento: diaDe(l.vencimiento) })))
    .sort((a, b) => Number(b.unidades === b.unidadesIniciales) - Number(a.unidades === a.unidadesIniciales) || a.id - b.id);
}
export function cajasEscaneadas(cajas, escaneadas) {
  const usadas = new Set();
  return escaneadas.map((e) => {
    const caja = cajas.find((c) => !usadas.has(c.id) && c.lote === (e.lote ?? null) && c.vencimiento === diaDe(e.vencimiento));
    if (caja) usadas.add(caja.id);
    return caja ?? null;
  });
}
// Los lotes que todavía tienen una caja libre, el que vence primero adelante (el recomendado), con cuántas cajas quedan.
export function lotesParaEscanear(cajas, escaneadas) {
  const usadas = new Set(cajasEscaneadas(cajas, escaneadas).filter(Boolean).map((c) => c.id));
  const lotes = new Map();
  for (const c of cajas) {
    if (usadas.has(c.id)) continue;
    const clave = JSON.stringify([c.lote, c.vencimiento]);
    if (!lotes.has(clave)) lotes.set(clave, { lote: c.lote, vencimiento: c.vencimiento, cajas: 0, unidades: c.unidades });
    lotes.get(clave).cajas += 1;
  }
  const vence = (l) => (l.vencimiento ? Date.parse(l.vencimiento) : Infinity);
  return [...lotes.values()].sort((a, b) => vence(a) - vence(b));
}
// ¿Esta caja vence después que la recomendada? (para avisar antes de pasarla)
export function venceDespues(elegido, recomendado) {
  if (!recomendado) return false;
  const vence = (l) => (l.vencimiento ? Date.parse(l.vencimiento) : Infinity);
  return vence(elegido) > vence(recomendado);
}

export function filasTraspaso(lotes, sugerencia = null) {
  const porLote = new Map();
  for (const l of lotes) {
    if (!(l.unidades > 0)) continue;
    const clave = l.lote ?? "";
    const fila = porLote.get(clave) ?? { lote: l.lote ?? null, vencimiento: l.vencimiento ?? null, disponibles: 0, sugeridas: 0 };
    fila.disponibles += l.unidades;
    if (l.vencimiento && (!fila.vencimiento || venceEn(l) < venceEn(fila))) fila.vencimiento = l.vencimiento;
    porLote.set(clave, fila);
  }
  for (const s of sugerencia ?? []) { const fila = porLote.get(s.lote ?? ""); if (fila) fila.sugeridas = s.unidades; }
  return [...porLote.values()].sort((a, b) => venceEn(a) - venceEn(b) || String(a.lote ?? "").localeCompare(String(b.lote ?? "")));
}

// Lo elegido frente a lo que pasó SAP. elegidos: [{ lote, unidades, disponibles }]. Devuelve { tipo, texto, listo, lotes }:
// listo solo si suma justo lo que pasó SAP y ningún lote pasa de lo que tiene.
export function resumenTraspaso(elegidos, total) {
  const usados = elegidos.filter((e) => e.unidades !== 0);
  const invalido = usados.find((e) => !Number.isInteger(e.unidades) || e.unidades < 0);
  if (invalido) return { tipo: "error", texto: `Revisá el lote ${invalido.lote ?? "sin lote"}: escribí un número entero.`, listo: false, lotes: [] };
  const excede = usados.find((e) => e.unidades > e.disponibles);
  if (excede) return { tipo: "error", texto: `El lote ${excede.lote ?? "sin lote"} tiene ${unidades(excede.disponibles)}.`, listo: false, lotes: [] };
  const suma = usados.reduce((t, e) => t + e.unidades, 0);
  const lotes = usados.map((e) => ({ lote: e.lote ?? null, unidades: e.unidades }));
  if (suma === total) return { tipo: "ok", texto: `${unidades(total)}: justo lo que pasó SAP.`, listo: true, lotes };
  return { tipo: "alerta", listo: false, lotes, texto: suma < total ? `Elegiste ${numero(suma)} de ${numero(total)}: faltan ${numero(total - suma)}.`
    : `Elegiste ${numero(suma)}: son ${numero(suma - total)} más de lo que pasó SAP (${numero(total)}).` };
}

// Lo que entra en una recepción: total de unidades y frase para confirmar.
// Cajas por grupos (cada grupo con su lote) y lo que sobra como un bulto en la grande. filas: [{ cajas,
// unidadesPorCaja, lote, vencimiento }], bulto: { unidades, lote, vencimiento } o null. Devuelve el cuerpo con sus
// totales ({ grupos, bulto, cajas, total, etiquetas }) o { problema }.
// Hasta 2000 cajas por fila (un lote) y 3000 por vez: lo mismo que acepta el servidor.
const MAX_CAJAS_FILA = 2000, MAX_CAJAS = 3000;
export function armarGrupos(filas, bulto = null) {
  const grupos = [];
  for (const [i, f] of filas.entries()) {
    const cual = filas.length > 1 ? ` (fila ${i + 1})` : "";
    if (!Number.isInteger(f.cajas) || f.cajas < 1 || f.cajas > MAX_CAJAS_FILA) return { problema: `Escribí la cantidad de cajas, de 1 a ${MAX_CAJAS_FILA}${cual}.` };
    if (!Number.isInteger(f.unidadesPorCaja) || f.unidadesPorCaja < 1) return { problema: `Escribí cuántas unidades trae cada caja${cual}.` };
    grupos.push({ cajas: f.cajas, unidadesPorCaja: f.unidadesPorCaja, lote: f.lote || null, vencimiento: f.vencimiento ?? null });
  }
  if (!grupos.length) return { problema: "Agregá al menos una fila de cajas." };
  const cajas = grupos.reduce((t, g) => t + g.cajas, 0);
  if (cajas > MAX_CAJAS) return { problema: `Hasta ${MAX_CAJAS} cajas por vez.` };
  if (bulto && (!Number.isInteger(bulto.unidades) || bulto.unidades < 1)) return { problema: "Escribí cuántas unidades sueltas sobraron, o dejalo vacío." };
  const enCajas = grupos.reduce((t, g) => t + g.cajas * g.unidadesPorCaja, 0);
  return { grupos, bulto: bulto ? { unidades: bulto.unidades, lote: bulto.lote || null, vencimiento: bulto.vencimiento ?? null } : null,
    cajas, enCajas, total: enCajas + (bulto?.unidades ?? 0), etiquetas: cajas + (bulto ? 1 : 0) };
}

export function resumenRecepcion({ modo, cajas, unidadesPorCaja, unidades: sueltas, destino, lote, grupos, bulto }, bodegas = null) {
  const a = (bodega) => `a ${nombreBodega(bodegas, bodega, { corto: true })}`;
  if (modo === "grupos") {
    const r = armarGrupos(grupos ?? [], bulto ?? null);
    if (r.problema) return { total: 0, texto: "" };
    const lotes = new Set(r.grupos.map((g) => g.lote ?? ""));
    const deLotes = lotes.size > 1 ? ` de ${numero(lotes.size)} lotes` : r.grupos[0].lote ? ` del lote ${r.grupos[0].lote}` : "";
    const extra = r.bulto ? ` Más un bulto suelto de ${unidades(r.bulto.unidades)}.` : "";
    return { total: r.total, texto: `Entran ${numero(r.cajas)} ${r.cajas === 1 ? "caja" : "cajas"} · ${unidades(r.enCajas)}${deLotes} ${a("grande")}.${extra}` };
  }
  const total = modo === "cajas" ? cajas * unidadesPorCaja : sueltas;
  if (!Number.isInteger(total) || total <= 0) return { total: 0, texto: "" };
  const deLote = lote ? ` del lote ${lote}` : "";
  const texto = modo === "cajas"
    ? `Entran ${numero(cajas)} ${cajas === 1 ? "caja" : "cajas"} · ${unidades(total)}${deLote} ${a("grande")}.`
    : `Entran ${unidades(total)} sueltas${deLote} ${a(destino === "pequena" ? "pequena" : "grande")}.`;
  return { total, texto };
}

// Opciones para elegir de dónde salió lo que SAP descontó: los lotes de la bodega grande y los de la bodega
// pequeña, cada grupo del que vence antes al último (vencidos primero). "devolver" suma lo que un descuento ya
// había restado, para cambiar su lote.
const isoDia = (valor) => (valor ? String(valor).slice(0, 10) : null);
export function opcionesDescuento(producto, devolver = [], hoy = new Date()) {
  const lotes = new Map();
  for (const l of producto.lotes ?? []) {
    const clave = `lote:${l.lote ?? ""}`;
    const actual = lotes.get(clave) ?? { clave, tipo: "lote", lote: l.lote ?? null, vencimiento: l.vencimiento ?? null, unidades: 0, cajas: [] };
    actual.unidades += l.unidades;
    actual.cajas.push(...(l.cajas ?? []));
    if (l.vencimiento && (!actual.vencimiento || l.vencimiento < actual.vencimiento)) actual.vencimiento = l.vencimiento;
    lotes.set(clave, actual);
  }
  const pequena = new Map();
  for (const l of producto.lotesPequena ?? []) {
    pequena.set(`pequena:${l.id}`, { clave: `pequena:${l.id}`, tipo: "pequena", pequenaLoteId: l.id, lote: l.lote ?? null,
      vencimiento: isoDia(l.vencimiento), unidades: l.unidades, cajas: [] });
  }
  for (const a of devolver) {
    if (a.tipo === "pequena") {
      // Un descuento anterior al control por lotes no identifica el lote: el servidor lo rechaza.
      for (const lp of a.lotesPequena ?? []) {
        if (!lp.pequenaLoteId) continue;
        const clave = `pequena:${lp.pequenaLoteId}`;
        const actual = pequena.get(clave) ?? { clave, tipo: "pequena", pequenaLoteId: lp.pequenaLoteId, lote: lp.lote ?? null, vencimiento: null, unidades: 0, cajas: [] };
        actual.unidades += lp.unidades;
        pequena.set(clave, actual);
      }
      continue;
    }
    const clave = `lote:${a.lote ?? ""}`;
    const actual = lotes.get(clave) ?? { clave, tipo: "lote", lote: a.lote ?? null, vencimiento: null, unidades: 0, cajas: [] };
    actual.unidades += a.unidades;
    lotes.set(clave, actual);
  }
  const vence = (o) => (o.vencimiento ? Date.parse(o.vencimiento) : Infinity);
  const ordenar = (lista) => lista.filter((o) => o.unidades > 0)
    .map((o) => ({ ...o, vencido: o.vencimiento !== null && diasParaVencer(o.vencimiento, hoy) < 0 }))
    .sort((a, b) => vence(a) - vence(b) || String(a.lote ?? "").localeCompare(String(b.lote ?? "")));
  return [...ordenar([...lotes.values()]), ...ordenar([...pequena.values()])];
}

// Con las bodegas asignadas: "02 · lote L1" y "01 · lote L1"; si no, "Pequeña · lote L1" y "Lote L1".
export function nombreOpcion(o, bodegas = null) {
  const lote = o.lote ? `lote ${o.lote}` : "sin lote";
  if (o.tipo === "pequena") return `${bodegas?.pequena?.almacen ?? "Pequeña"} · ${lote}`;
  return bodegas?.grande ? `${bodegas.grande.almacen} · ${lote}` : `Lote ${o.lote ?? "sin lote"}`;
}

// Primera propuesta: completar en el orden de la lista (lo que vence primero sale primero).
export function sugerirAsignacion(opciones, total) {
  let faltan = total;
  const asignado = {};
  for (const o of opciones) {
    const toma = Math.min(o.unidades, faltan);
    asignado[o.clave] = toma;
    faltan -= toma;
  }
  return asignado;
}

// Valida lo elegido y arma el cuerpo para el servidor. Devuelve { problema } o { asignaciones, texto }. Lo que sale
// de la pequeña va en una sola asignación con el detalle de sus lotes.
export function armarAsignaciones(opciones, asignado, total, bodegas = null) {
  const elegidas = opciones.filter((o) => (asignado[o.clave] ?? 0) > 0);
  for (const o of elegidas) {
    const n = asignado[o.clave];
    if (!Number.isInteger(n)) return { problema: "Las cantidades tienen que ser números enteros." };
    if (n > o.unidades) return { problema: `${nombreOpcion(o, bodegas)} tiene ${unidades(o.unidades)}.` };
  }
  const suma = elegidas.reduce((t, o) => t + asignado[o.clave], 0);
  if (suma !== total) return { problema: `Asignaste ${numero(suma)} de ${numero(total)}: tienen que ser exactamente ${numero(total)}.`, suma };
  const asignaciones = elegidas.filter((o) => o.tipo === "lote").map((o) => ({ tipo: "lote", lote: o.lote, unidades: asignado[o.clave] }));
  const dePequena = elegidas.filter((o) => o.tipo === "pequena");
  if (dePequena.length) {
    asignaciones.push({ tipo: "pequena", unidades: dePequena.reduce((t, o) => t + asignado[o.clave], 0),
      lotes: dePequena.map((o) => ({ pequenaLoteId: o.pequenaLoteId, unidades: asignado[o.clave] })) });
  }
  return { suma, asignaciones, texto: elegidas.map((o) => `${nombreOpcion(o, bodegas)}: ${numero(asignado[o.clave])}`).join(" · ") };
}

// Texto de la asignación de un descuento ya hecho (como la devuelve el servidor).
export function textoAsignacion(asignacion, bodegas = null) {
  const pequena = bodegas?.pequena?.almacen ?? "pequeña";
  return asignacion.flatMap((a) => (a.tipo === "pequena" && a.lotesPequena?.length
    ? a.lotesPequena.map((l) => `${pequena} ${l.lote ?? "sin lote"}: ${numero(l.unidades)}`)
    : [`${a.tipo === "pequena" ? pequena : a.lote ?? "sin lote"}: ${numero(a.unidades)}`])).join(" · ");
}

// Conteo de la pequeña por lote. filas: [{ lote, vencimiento ("AAAA-MM-DD" o null), unidades }]. Devuelve el cuerpo
// { unidades, lotes } o { problema }.
export function armarConteo(filas) {
  const vistas = new Set();
  for (const f of filas) {
    if (!Number.isInteger(f.unidades) || f.unidades < 0) return { problema: "Escribí números enteros, sin puntos ni comas." };
    const clave = JSON.stringify([f.lote ?? null, f.vencimiento ?? null]);
    if (vistas.has(clave)) return { problema: `El lote ${f.lote ?? "sin lote"} está repetido.` };
    vistas.add(clave);
  }
  return { unidades: filas.reduce((t, f) => t + f.unidades, 0),
    lotes: filas.map((f) => ({ lote: f.lote ?? null, vencimiento: f.vencimiento ?? null, unidades: f.unidades })) };
}

// Despacho: unidades escaneadas por producto en una preparación.
export function unidadesPorProducto(lineas) {
  const porProducto = new Map();
  for (const l of lineas) {
    if (l.cantidadEscaneada > 0) porProducto.set(l.itemCode, (porProducto.get(l.itemCode) ?? 0) + l.cantidadEscaneada);
  }
  return porProducto;
}

// Revisa cada producto contra la bodega pequeña. fichas: Map itemCode → { itemName, lotesPequena }.
// Devuelve los faltantes (no se puede finalizar) y los productos que necesitan elegir lote (más de un lote).
export function revisarDespacho(porProducto, fichas) {
  const faltantes = [], elegir = [];
  for (const [itemCode, necesarias] of porProducto) {
    const ficha = fichas.get(itemCode);
    const lotes = (ficha?.lotesPequena ?? []).filter((l) => l.unidades > 0);
    const hay = lotes.reduce((t, l) => t + l.unidades, 0);
    if (hay < necesarias) faltantes.push({ itemCode, itemName: ficha?.itemName ?? itemCode, hay, necesarias });
    else if (lotes.length > 1) elegir.push({ itemCode, itemName: ficha?.itemName ?? itemCode, necesarias, lotes });
  }
  return { faltantes, elegir };
}

// Arma la selección de lotes para finalizar. asignado: { [pequenaLoteId]: unidades } por producto.
export function armarLotesDespacho(elegir, asignado) {
  const lotes = [];
  for (const p of elegir) {
    const filas = p.lotes.map((l) => ({ pequenaLoteId: l.id, unidades: asignado[p.itemCode]?.[l.id] ?? 0, disponibles: l.unidades, lote: l.lote }))
      .filter((f) => f.unidades !== 0);
    for (const f of filas) {
      if (!Number.isInteger(f.unidades) || f.unidades < 0) return { problema: `${p.itemName}: escribí números enteros.` };
      if (f.unidades > f.disponibles) return { problema: `${p.itemName}: en ${f.lote ? `el lote ${f.lote}` : "«Sin lote»"} hay ${unidades(f.disponibles)}.` };
    }
    const suma = filas.reduce((t, f) => t + f.unidades, 0);
    if (suma !== p.necesarias) return { problema: `${p.itemName}: asignaste ${numero(suma)} de ${numero(p.necesarias)}.` };
    lotes.push({ itemCode: p.itemCode, lotes: filas.map(({ pequenaLoteId, unidades: n }) => ({ pequenaLoteId, unidades: n })) });
  }
  return { lotes };
}

// Lista de productos: los filtros que tienen sentido según haya almacenes de SAP marcados y comparación disponible.
// Los filtros están siempre (la pantalla no cambia sola); los que no aplican quedan deshabilitados con su motivo.
export function filtrosExistencias({ conteos = {}, almacenes = [], comparacionDisponible = false }) {
  const sinSap = !almacenes.length ? "Falta elegir los almacenes de esta bodega" : null;
  return [
    { id: "todos", texto: "Todo", n: conteos.todos ?? 0 },
    { id: "solo_sap", texto: "Falta contar", n: conteos.solo_sap ?? 0, motivo: sinSap },
    { id: "diferencia", texto: "Diferencias", n: conteos.diferencia ?? 0, motivo: sinSap ?? (comparacionDisponible ? null : "Sin datos recientes de SAP") },
    { id: "por_vencer", texto: "Por vencer", n: conteos.por_vencer ?? 0 },
  ];
}

// Vista de una bodega: "Falta contar" necesita el almacén de SAP asignado a la bodega.
export function filtrosBodega({ conteos = {}, almacen = null }) {
  return [
    { id: "todos", texto: "Todo", n: conteos.todos ?? 0 },
    { id: "sin_registrar", texto: "Falta contar", n: conteos.sin_registrar ?? 0, motivo: almacen ? null : "Falta elegir el almacén de esta bodega" },
    { id: "por_vencer", texto: "Por vencer", n: conteos.por_vencer ?? 0 },
  ];
}

// Un lote dentro de una bodega: "L2408-090 · vence 09/2026 · 3 cajas · 60 unidades".
export function textoLoteBodega(l, { conCajas = false } = {}) {
  return [l.lote ?? "Sin lote", l.vencimiento && `vence ${textoVencimiento(l.vencimiento)}`,
    conCajas && `${numero(l.cajas)} ${l.cajas === 1 ? "caja" : "cajas"}`, unidades(l.unidades)].filter(Boolean).join(" · ");
}

// Estado de una fila frente a SAP para su insignia ({ tipo, texto }), o null sin comparación.
export function estadoFila({ estado, diferencia }) {
  if (!estado || estado === "sin_comparacion_sap") return null;
  const info = ESTADOS[estado] ?? { tipo: "gris", texto: estado };
  const n = Math.abs(diferencia ?? 0);
  return { tipo: info.tipo, texto: (estado === "por_ubicar" || estado === "por_descontar") && n ? `${info.texto}: ${numero(n)}` : info.texto };
}

// Tarjeta "Por vencer" del inicio: lotes vencidos y lotes que vencen en los próximos días.
export function textoPorVencer({ vencidos, proximos }, dias = 60) {
  const partes = [vencidos > 0 && `${numero(vencidos)} ${vencidos === 1 ? "lote vencido" : "lotes vencidos"}`,
    proximos > 0 && `${numero(proximos)} ${proximos === 1 ? "vence" : "vencen"} en ${dias} días`].filter(Boolean);
  return partes.length ? partes.join(" y ") : `ningún lote vence en ${dias} días`;
}
