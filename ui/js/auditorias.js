// Textos y cálculos de la auditoría de bodega, sin el DOM (se prueban en test/ui.test.js).

// Nombre de un almacén para la auditoría: "Bodega 01", "Almacén 03 (solo conteo)" o el código con su nombre de SAP.
export function nombreAlmacen(a) {
  if (a.tipo === "grande" || a.tipo === "pequena") return `Bodega ${a.almacen}`;
  if (a.tipo === "conteo") return `Almacén ${a.almacen} (solo conteo)`;
  return a.nombre && a.nombre !== a.almacen ? `${a.almacen} · ${a.nombre}` : `Almacén ${a.almacen}`;
}

// Qué es el almacén, para la tarjeta: "Bodega grande · Almacén", "Solo conteo · Muestras" o su nombre de SAP.
export function descripcionAlmacen(a) {
  const nombre = a.nombre && a.nombre !== a.almacen ? a.nombre : null;
  const tipo = { grande: "Bodega grande", pequena: "Bodega pequeña", conteo: "Solo conteo" }[a.tipo];
  if (!tipo) return nombre ?? `Almacén ${a.almacen}`;
  return nombre ? `${tipo} · ${nombre}` : tipo;
}

// Contra qué compara el resultado de ese almacén.
export const textoComparacion = (a) => (a.comparaApp ? "Se compara con la app y con SAP" : "Se compara solo con SAP");

const unidades = (n) => `${Number(n).toLocaleString("es-HN")} ${n === 1 ? "unidad" : "unidades"}`;
const productos = (n) => `${Number(n).toLocaleString("es-HN")} ${n === 1 ? "producto" : "productos"}`;

// "312 unidades · 47 productos".
export const textoAvance = (total, cuantos) => `${unidades(total)} · ${productos(cuantos)}`;

// Una diferencia como se muestra: "Cumple", "−6", "+2"; null sin contra qué comparar.
export function textoDiferencia(d) {
  if (d === null || d === undefined) return null;
  if (d === 0) return "Cumple";
  return d > 0 ? `+${d.toLocaleString("es-HN")}` : `−${Math.abs(d).toLocaleString("es-HN")}`;
}

// Resumen contra la app o contra SAP: "6 productos · 19 unidades".
export function textoGrupo(g) {
  return g.productos ? `${productos(g.productos)} · ${unidades(g.unidades)}` : "Ninguno";
}

// Filas con alguna diferencia (contra la app o contra SAP).
export const conDiferencia = (filas) => filas.filter((f) => (f.diferenciaApp ?? 0) !== 0 || (f.diferenciaSap ?? 0) !== 0);

// Estado de una línea de la auditoría (escaneadas / esperadas), como en un pedido.
export function estadoLineaAuditoria({ unidades: n, esperadas }) {
  if (n === esperadas) return { tipo: "completa", texto: "Completa" };
  if (n > esperadas) return { tipo: "sobra", texto: esperadas === 0 ? "No esperado" : `Sobran ${(n - esperadas).toLocaleString("es-HN")}` };
  return { tipo: "falta", texto: `faltan ${(esperadas - n).toLocaleString("es-HN")}` };
}

// Lo que dice el lector después de una lectura: "Van 3 de 5", "Completo: 5 de 5", "Sobra: 6 de 5" o "No se esperaba".
export function textoLecturaAuditoria(n, esperadas, fuente) {
  if (!fuente) return `Van ${n.toLocaleString("es-HN")} de este producto`;
  if (esperadas === 0) return `No se esperaba en este almacén · van ${n.toLocaleString("es-HN")}`;
  if (n === esperadas) return `Completo: ${n.toLocaleString("es-HN")} de ${esperadas.toLocaleString("es-HN")}`;
  if (n > esperadas) return `Sobra: van ${n.toLocaleString("es-HN")} de ${esperadas.toLocaleString("es-HN")}`;
  return `Van ${n.toLocaleString("es-HN")} de ${esperadas.toLocaleString("es-HN")}`;
}
