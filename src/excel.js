// Reportes en Excel (.xlsx) sin dependencias: un .xlsx es un zip con unas pocas hojas XML. La página manda solo datos
// (título, subtítulo, encabezados y filas de texto o números), que se validan y se escapan acá.
import path from "node:path";
import { deflateRawSync } from "node:zlib";

const NOMBRE_POR_DEFECTO = "Reporte.xlsx";
const MAX_FILAS = 20000, MAX_COLUMNAS = 20, LARGO_CELDA = 500;

// Solo letras, números, guiones, puntos y espacios, y terminado en .xlsx (sin carpetas).
export function nombreSeguroXlsx(nombre) {
  if (typeof nombre !== "string") return NOMBRE_POR_DEFECTO;
  const limpio = nombre.trim().split(/[\\/]/).pop().replace(/[^\p{L}\p{N} ._-]/gu, "").replace(/^\.+/, "").slice(0, 80);
  if (!limpio) return NOMBRE_POR_DEFECTO;
  return /\.xlsx$/i.test(limpio) ? limpio : `${limpio}.xlsx`;
}

// Una celda: un número finito queda como número; lo demás, como texto (sin caracteres de control).
const celdaValida = (v) => (typeof v === "number" && Number.isFinite(v) ? v
  : String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, LARGO_CELDA));

// Lo que llega de la página: { titulo, sub, encabezados: [...], filas: [[...]], total?: [...] }. null si no sirve.
export function datosHojaValidos(datos) {
  if (!datos || !Array.isArray(datos.encabezados) || !Array.isArray(datos.filas)) return null;
  if (!datos.encabezados.length || datos.encabezados.length > MAX_COLUMNAS || datos.filas.length > MAX_FILAS) return null;
  const ancho = datos.encabezados.length;
  if (datos.filas.some((f) => !Array.isArray(f) || f.length > ancho) || (datos.total && (!Array.isArray(datos.total) || datos.total.length > ancho))) return null;
  return { titulo: celdaValida(datos.titulo), sub: celdaValida(datos.sub), encabezados: datos.encabezados.map(celdaValida),
    filas: datos.filas.map((f) => f.map(celdaValida)), total: datos.total ? datos.total.map(celdaValida) : null };
}

const escapar = (texto) => texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const columna = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
// Estilos: 0 normal, 1 negrita, 2 título grande.
const celda = (v, ref, estilo = 0) => (typeof v === "number"
  ? `<c r="${ref}"${estilo ? ` s="${estilo}"` : ""}><v>${v}</v></c>`
  : `<c r="${ref}" t="inlineStr"${estilo ? ` s="${estilo}"` : ""}><is><t xml:space="preserve">${escapar(v)}</t></is></c>`);
const fila = (n, valores, estilo) => `<row r="${n}">${valores.map((v, i) => celda(v, `${columna(i)}${n}`, estilo)).join("")}</row>`;

// La hoja: título, subtítulo, una fila vacía, los encabezados (en negrita y fijos al bajar), las filas y el total.
function hojaXml({ titulo, sub, encabezados, filas, total }) {
  const anchos = encabezados.map((e, i) => Math.min(60, Math.max(10, ...[e, ...filas.map((f) => f[i])].map((v) => String(v ?? "").length + 2))));
  const filasXml = [fila(1, [titulo], 2), fila(2, [sub]), fila(4, encabezados, 1), ...filas.map((f, i) => fila(5 + i, f))];
  if (total) filasXml.push(fila(5 + filas.length, total, 1));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    + `<sheetData>${filasXml.join("")}</sheetData></worksheet>`;
}

const ARCHIVOS_FIJOS = {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
    + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>`
    + `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
    + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>`
    + `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
};

const workbookXml = (nombreHoja) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
  + `<sheets><sheet name="${escapar(nombreHoja)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(datos) {
  let c = 0xffffffff;
  for (const b of datos) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Zip con cada archivo comprimido (deflate).
function zip(archivos) {
  const locales = [], centrales = [];
  let desplazamiento = 0;
  for (const [nombre, contenido] of archivos) {
    const nombreBytes = Buffer.from(nombre, "utf8"), datos = Buffer.from(contenido, "utf8");
    const comprimido = deflateRawSync(datos), crc = crc32(datos);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comprimido.length, 18); local.writeUInt32LE(datos.length, 22); local.writeUInt16LE(nombreBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(comprimido.length, 20); central.writeUInt32LE(datos.length, 24); central.writeUInt16LE(nombreBytes.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    locales.push(local, nombreBytes, comprimido); centrales.push(central, nombreBytes);
    desplazamiento += local.length + nombreBytes.length + comprimido.length;
  }
  const directorio = Buffer.concat(centrales), fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(directorio.length, 12); fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, directorio, fin]);
}

// El .xlsx de una hoja ya validada (datosHojaValidos).
export function crearXlsx(hoja, nombreHoja = "Conteo") {
  return zip([...Object.entries(ARCHIVOS_FIJOS), ["xl/workbook.xml", workbookXml(nombreHoja.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Hoja1")],
    ["xl/worksheets/sheet1.xml", hojaXml(hoja)]]);
}

// Como guardarPdf: elegirArchivo(ruta sugerida) resuelve la ruta elegida o null si se cancela.
export async function guardarExcel({ datos, carpeta, elegirArchivo, escribir, abrir }) {
  const hoja = datosHojaValidos(datos);
  if (!hoja) return { ok: false, motivo: "datos" };
  const ruta = await elegirArchivo(path.join(carpeta, nombreSeguroXlsx(datos.nombre)));
  if (!ruta) return { ok: false, cancelado: true };
  try {
    await escribir(ruta, crearXlsx(hoja, datos.hoja ?? "Conteo"));
  } catch (error) {
    return { ok: false, motivo: error?.code === "EBUSY" || error?.code === "EPERM" ? "ocupado" : "error" };
  }
  await abrir(ruta);
  return { ok: true, archivo: path.basename(ruta) };
}
