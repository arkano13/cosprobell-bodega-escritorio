// Textos y datos de los conteos con nombre, sin el DOM (se prueban en test/ui.test.js).

const unidades = (n) => `${Number(n).toLocaleString("es-HN")} ${n === 1 ? "unidad" : "unidades"}`;
const productos = (n) => `${Number(n).toLocaleString("es-HN")} ${n === 1 ? "producto" : "productos"}`;

// "12 unidades · 3 productos".
export const textoTotalConteo = (c) => `${unidades(c.unidades)} · ${productos(c.productos?.length ?? c.productos ?? 0)}`;

// Nombre del archivo: "Conteo-Devolucion-cliente-X-2026-11-04.pdf" (sin acentos ni signos, para cualquier carpeta).
export function nombreArchivoConteo(c, extension) {
  const nombre = String(c.nombre ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 40);
  return `Conteo-${nombre || c.id}-${String(c.terminadoEn ?? c.iniciadoEn).slice(0, 10)}.${extension}`;
}

// La hoja de Excel de un conteo finalizado: código, producto y unidades, con el total al final.
export function hojaConteo(c, sub) {
  return { nombre: nombreArchivoConteo(c, "xlsx"), hoja: "Conteo", titulo: `Conteo · ${c.nombre}`, sub,
    encabezados: ["Código", "Producto", "Unidades"], filas: c.productos.map((p) => [p.itemCode, p.itemName ?? p.itemCode, p.unidades]),
    total: ["", "Total", c.unidades] };
}
