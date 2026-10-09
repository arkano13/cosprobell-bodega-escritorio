// Reportes en PDF: la página deja el reporte en su zona de impresión y la app lo guarda donde elija el supervisor.
// No recibe HTML de la página: solo el nombre sugerido del archivo y el texto del pie, que se limpian acá.
import path from "node:path";

const NOMBRE_POR_DEFECTO = "Reporte.pdf";
const LARGO_PIE = 120;

// Solo letras, números, guiones, puntos y espacios, y terminado en .pdf (sin carpetas).
export function nombreSeguro(nombre) {
  if (typeof nombre !== "string") return NOMBRE_POR_DEFECTO;
  const limpio = nombre.trim().split(/[\\/]/).pop().replace(/[^\p{L}\p{N} ._-]/gu, "").replace(/^\.+/, "").slice(0, 80);
  if (!limpio) return NOMBRE_POR_DEFECTO;
  return /\.pdf$/i.test(limpio) ? limpio : `${limpio}.pdf`;
}

const escapar = (texto) => texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Pie de cada página: el texto de la página (escapado) y "Página 3 de 8".
export function piePagina(texto) {
  const limpio = escapar(typeof texto === "string" ? texto.slice(0, LARGO_PIE) : "");
  return `<div style="width:100%;font:8pt Arial,sans-serif;color:#5f5870;padding:0 12mm;display:flex;justify-content:space-between">`
    + `<span>${limpio}</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`;
}

// contenido: el webContents de la ventana; elegirArchivo(ruta sugerida) resuelve la ruta elegida o null si se cancela.
export async function guardarPdf({ contenido, datos, carpeta, elegirArchivo, escribir, abrir }) {
  const ruta = await elegirArchivo(path.join(carpeta, nombreSeguro(datos?.nombre)));
  if (!ruta) return { ok: false, cancelado: true };
  try {
    const pdf = await contenido.printToPDF({ printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
      headerTemplate: "<span></span>", footerTemplate: piePagina(datos?.pie) });
    await escribir(ruta, pdf);
  } catch (error) {
    return { ok: false, motivo: error?.code === "EBUSY" || error?.code === "EPERM" ? "ocupado" : "error" };
  }
  await abrir(ruta);
  return { ok: true, archivo: path.basename(ruta) };
}
