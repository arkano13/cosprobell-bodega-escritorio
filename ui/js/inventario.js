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
};

export function textoEstado(estado) {
  if (!estado) return "Falta elegir los almacenes de SAP";
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

// Opciones para elegir de dónde salió lo que SAP descontó: los lotes de la bodega grande (vencidos primero,
// después del que vence antes) y la bodega pequeña. "devolver" suma lo que un descuento ya había restado,
// para cambiar su lote.
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
  let pequena = Math.max(0, producto.pequena ?? 0);
  for (const a of devolver) {
    if (a.tipo === "pequena") { pequena += a.unidades; continue; }
    const clave = `lote:${a.lote ?? ""}`;
    const actual = lotes.get(clave) ?? { clave, tipo: "lote", lote: a.lote ?? null, vencimiento: null, unidades: 0, cajas: [] };
    actual.unidades += a.unidades;
    lotes.set(clave, actual);
  }
  const vence = (o) => (o.vencimiento ? Date.parse(o.vencimiento) : Infinity);
  const lista = [...lotes.values()].filter((o) => o.unidades > 0)
    .map((o) => ({ ...o, vencido: o.vencimiento !== null && diasParaVencer(o.vencimiento, hoy) < 0 }))
    .sort((a, b) => vence(a) - vence(b) || String(a.lote ?? "").localeCompare(String(b.lote ?? "")));
  lista.push({ clave: "pequena", tipo: "pequena", lote: null, vencimiento: null, unidades: pequena, cajas: [], vencido: false });
  return lista;
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

// Valida lo elegido y arma el cuerpo para el servidor. Devuelve { problema } o { asignaciones }.
export function armarAsignaciones(opciones, asignado, total) {
  const elegidas = opciones.filter((o) => (asignado[o.clave] ?? 0) > 0);
  for (const o of elegidas) {
    const n = asignado[o.clave];
    if (!Number.isInteger(n)) return { problema: "Las cantidades tienen que ser números enteros." };
    if (n > o.unidades) return { problema: `${o.tipo === "pequena" ? "La bodega pequeña" : `El lote ${o.lote ?? "sin lote"}`} tiene ${unidades(o.unidades)}.` };
  }
  const suma = elegidas.reduce((t, o) => t + asignado[o.clave], 0);
  if (suma !== total) return { problema: `Asignaste ${numero(suma)} de ${numero(total)}: tienen que ser exactamente ${numero(total)}.`, suma };
  return { suma, asignaciones: elegidas.map((o) => (o.tipo === "pequena"
    ? { tipo: "pequena", unidades: asignado[o.clave] }
    : { tipo: "lote", lote: o.lote, unidades: asignado[o.clave] })) };
}

export function textoAsignacion(asignacion) {
  return asignacion.map((a) => `${a.tipo === "pequena" ? "pequeña" : a.lote ?? "sin lote"}: ${numero(a.unidades)}`).join(" · ");
}

// Tarjeta "Por vencer" del inicio: lotes vencidos y lotes que vencen en los próximos días.
export function textoPorVencer({ vencidos, proximos }, dias = 60) {
  const partes = [vencidos > 0 && `${numero(vencidos)} ${vencidos === 1 ? "lote vencido" : "lotes vencidos"}`,
    proximos > 0 && `${numero(proximos)} ${proximos === 1 ? "vence" : "vencen"} en ${dias} días`].filter(Boolean);
  return partes.length ? partes.join(" y ") : `ningún lote vence en ${dias} días`;
}
