// Textos y cálculos del inventario, sin acceso al DOM (se prueban en test/ui.test.js).
const numero = (valor) => Number(valor).toLocaleString("es-HN");
const unidades = (n) => `${numero(n)} ${Math.abs(n) === 1 ? "unidad" : "unidades"}`;

// Estado de un producto frente a SAP (lo calcula el servidor).
export const ESTADOS = {
  al_dia: { tipo: "ok", texto: "Cuadra con SAP" },
  por_ubicar: { tipo: "alerta", texto: "Por ubicar" },
  por_descontar: { tipo: "alerta", texto: "Por descontar" },
  actualizando: { tipo: "gris", texto: "SAP actualizándose" },
  conteo_inicial: { tipo: "gris", texto: "Sin contar" },
  sin_comparacion_sap: { tipo: "gris", texto: "Sin comparación con SAP" },
};

// Sin almacenes elegidos o sin existencias recientes de SAP, el inventario de la bodega funciona igual,
// pero no se compara con SAP (la falta de datos no significa cero).
export const TEXTO_SIN_COMPARACION = "La comparación con SAP no está disponible: faltan los almacenes de esta bodega o datos recientes de existencias. "
  + "Recibir, reponer y contar funcionan igual.";

export function textoEstado(estado) {
  if (!estado || estado.estado === "sin_comparacion_sap") return "Sin comparación con SAP por ahora. El inventario de la bodega funciona igual.";
  const d = estado.diferencia;
  if (estado.estado === "por_ubicar") return `SAP tiene ${unidades(d)} que todavía no se ubicaron.`;
  if (estado.estado === "por_descontar") return `SAP descontó ${unidades(-d)}: falta elegir de qué lote salieron.`;
  if (estado.estado === "conteo_inicial") return `Todavía no se contó. SAP tiene ${unidades(d)}.`;
  if (estado.estado === "actualizando") return "SAP cambió hace poco: se espera unos minutos a que llegue todo antes de avisar.";
  return estado.faltaEnSap > 0 ? `Cuadra. ${unidades(estado.faltaEnSap)} se recibieron antes que SAP las registre.` : "Cuadra con SAP.";
}

export const esCodigoCaja = (texto) => /^CJ-\d{6,}$/i.test(String(texto).trim());

// Vencimiento: las cajas traen mes y año ("03/2027"); se guarda el último día de ese mes.
export function finDeMes(mes) {
  const m = /^(\d{4})-(\d{2})$/.exec(mes ?? "");
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
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
  recepcion: "Entrada", reposicion: "Reposición", picking: "Salida por pedido", descuento: "Descuento de SAP",
  reasignacion: "Cambio de lote", conteo: "Conteo de la pequeña", correccion: "Corrección de caja",
};
export function textoMovimiento(m) {
  const nombre = NOMBRES_MOVIMIENTO[m.tipo] ?? m.tipo;
  return m.tipo === "picking" && m.docNum ? `${nombre} ${m.docNum}` : nombre;
}
// Cantidad que mostró el movimiento: la reposición pasa de una bodega a la otra (no cambia el total).
export function cantidadMovimiento(m) {
  if (m.tipo === "reposicion") return `${numero(m.pequena)} u. a la pequeña`;
  // Cambiar el lote devuelve unidades a un lugar y las resta de otro: el total no cambia.
  if (m.tipo === "reasignacion") return "No cambia el total";
  if (m.tipo === "recepcion" && m.cajas > 0 && m.grande > 0) return `${numero(m.cajas)} ${m.cajas === 1 ? "caja" : "cajas"} · ${numero(m.grande)} u.`;
  const total = (m.grande ?? 0) + (m.pequena ?? 0);
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

// Lo que entra en una recepción: total de unidades y frase para confirmar.
export function resumenRecepcion({ modo, cajas, unidadesPorCaja, unidades: sueltas, destino, lote }) {
  const total = modo === "cajas" ? cajas * unidadesPorCaja : sueltas;
  if (!Number.isInteger(total) || total <= 0) return { total: 0, texto: "" };
  const deLote = lote ? ` del lote ${lote}` : "";
  const texto = modo === "cajas"
    ? `Entran ${numero(cajas)} ${cajas === 1 ? "caja" : "cajas"} · ${unidades(total)}${deLote} a la bodega grande.`
    : `Entran ${unidades(total)} sueltas${deLote} a la bodega ${destino === "pequena" ? "pequeña" : "grande"}.`;
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

export const nombreOpcion = (o) => (o.tipo === "pequena" ? `Pequeña · ${o.lote ? `lote ${o.lote}` : "sin lote"}` : `Lote ${o.lote ?? "sin lote"}`);

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
export function armarAsignaciones(opciones, asignado, total) {
  const elegidas = opciones.filter((o) => (asignado[o.clave] ?? 0) > 0);
  for (const o of elegidas) {
    const n = asignado[o.clave];
    if (!Number.isInteger(n)) return { problema: "Las cantidades tienen que ser números enteros." };
    if (n > o.unidades) return { problema: `${nombreOpcion(o)} tiene ${unidades(o.unidades)}.` };
  }
  const suma = elegidas.reduce((t, o) => t + asignado[o.clave], 0);
  if (suma !== total) return { problema: `Asignaste ${numero(suma)} de ${numero(total)}: tienen que ser exactamente ${numero(total)}.`, suma };
  const asignaciones = elegidas.filter((o) => o.tipo === "lote").map((o) => ({ tipo: "lote", lote: o.lote, unidades: asignado[o.clave] }));
  const dePequena = elegidas.filter((o) => o.tipo === "pequena");
  if (dePequena.length) {
    asignaciones.push({ tipo: "pequena", unidades: dePequena.reduce((t, o) => t + asignado[o.clave], 0),
      lotes: dePequena.map((o) => ({ pequenaLoteId: o.pequenaLoteId, unidades: asignado[o.clave] })) });
  }
  return { suma, asignaciones, texto: elegidas.map((o) => `${nombreOpcion(o)}: ${numero(asignado[o.clave])}`).join(" · ") };
}

// Texto de la asignación de un descuento ya hecho (como la devuelve el servidor).
export function textoAsignacion(asignacion) {
  return asignacion.flatMap((a) => (a.tipo === "pequena" && a.lotesPequena?.length
    ? a.lotesPequena.map((l) => `pequeña ${l.lote ?? "sin lote"}: ${numero(l.unidades)}`)
    : [`${a.tipo === "pequena" ? "pequeña" : a.lote ?? "sin lote"}: ${numero(a.unidades)}`])).join(" · ");
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
export function filtrosExistencias({ conteos = {}, almacenes = [], comparacionDisponible = false }) {
  return [["todos", "Todos"], ["grande", "Bodega grande"], ["pequena", "Bodega pequeña"],
    almacenes.length > 0 && ["solo_sap", "Solo en SAP"], comparacionDisponible && ["diferencia", "Con diferencia"]]
    .filter(Boolean).map(([id, texto]) => ({ id, texto, n: conteos[id] ?? 0 }));
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
