// Textos del reporte de cuadre con SAP (panel del supervisor), sin acceso al DOM (se prueban en test/ui.test.js).
// El servidor manda la diferencia con el signo de la bodega: negativa, en la bodega hay menos que en SAP; positiva, hay más.
const numero = (valor) => Number(valor).toLocaleString("es-HN");
const mayuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);
const productos = (n) => `${numero(n)} ${n === 1 ? "producto" : "productos"}`;

// "+15", "−18" (signo menos tipográfico) y "0".
export const conSigno = (n) => (n > 0 ? `+${numero(n)}` : n < 0 ? `−${numero(-n)}` : "0");
export const porcentaje = (parte, total) => (total > 0 ? Math.round((parte * 100) / total) : 0);

// Unidades del resumen: "−711 unidades", "+1 unidad".
export const unidadesConSigno = (n) => `${conSigno(n)} ${Math.abs(n) === 1 ? "unidad" : "unidades"}`;

// Lo más importante del reporte, en frases cortas. nombres: { grande: "la 01", pequena: "la 02" } (como se dicen en la bodega).
export function destacadosCuadre(r, nombres) {
  const { resumen, menos, mas } = r;
  if (resumen.contados === 0) return ["Todavía no hay productos contados en las dos bodegas."];
  if (!menos.length && !mas.length) return [`Todo lo contado cuadra con SAP (${productos(resumen.cuadran)}).`];
  const frases = [];
  const enGrande = [...menos, ...mas].filter((x) => x.grande.diferencia !== 0);
  if (!enGrande.length) frases.push(`${mayuscula(nombres.grande)} cuadra con SAP en todos los productos contados: las diferencias están en ${nombres.pequena}.`);
  else {
    const lista = enGrande.slice(0, 4).map((x) => `${x.itemName} (${conSigno(x.grande.diferencia)})`).join(", ");
    const resto = enGrande.length > 4 ? ` y ${productos(enGrande.length - 4)} más` : "";
    frases.push(`En ${nombres.grande} no ${enGrande.length === 1 ? "cuadra 1 producto" : `cuadran ${productos(enGrande.length)}`}: ${lista}${resto}.`);
  }
  if (menos.length) {
    const x = menos[0];
    frases.push(`El faltante más grande es ${x.itemName}: ${conSigno(x.diferencia)} (contado ${numero(x.grande.contado + x.pequena.contado)}, SAP ${numero(x.grande.sap + x.pequena.sap)}).`);
  }
  if (mas.length) frases.push(`El sobrante más grande es ${mas[0].itemName}: ${conSigno(mas[0].diferencia)}.`);
  return frases;
}

// Lo que el reporte deja afuera, para la nota al pie.
export function notaCuadre(resumen) {
  const partes = ["Solo incluye los productos ya contados en las dos bodegas"];
  if (resumen.pendientes) partes.push(`no incluye ${productos(resumen.pendientes)} que todavía falta contar`);
  if (resumen.actualizando) partes.push(`${productos(resumen.actualizando)} se ${resumen.actualizando === 1 ? "está" : "están"} actualizando desde SAP y quedan afuera hasta el próximo reporte`);
  return `${partes.join("; ")}. Lo recibido antes que SAP no cuenta como sobrante mientras SAP no lo registre. Lo preparado en pedidos y todavía sin entregar en SAP cuenta como que ya salió.`;
}

// Nombre del PDF con la fecha y hora del equipo: Cuadre-SAP-2026-10-09-1530.pdf.
export function nombreArchivoCuadre(iso) {
  const d = new Date(iso);
  const dos = (n) => String(n).padStart(2, "0");
  return `Cuadre-SAP-${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}.pdf`;
}
