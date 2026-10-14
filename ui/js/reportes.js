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

// ---------------------------------------------------------------------------
// Reportes de bodega (preparaciones, errores, salidas, reposiciones, correcciones, pendientes, actividad)
// ---------------------------------------------------------------------------

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_CORTOS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DIAS_LARGOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const dia = (fecha) => Number(fecha.slice(8, 10));
const mes = (fecha) => MESES[Number(fecha.slice(5, 7)) - 1];
const semanaDe = (fecha) => new Date(`${fecha}T12:00:00Z`).getUTCDay();

// "3,1 %" (el servidor manda el número con un decimal).
export const porcentajeDecimal = (n) => `${Number(n).toLocaleString("es-HN", { maximumFractionDigits: 1 })} %`;

// Duración de segundos a "7:40" (minutos:segundos) o "1:05:20" con horas. null → "—".
export function duracion(segundos) {
  if (segundos === null || segundos === undefined) return "—";
  const s = Math.round(segundos);
  const dos = (n) => String(n).padStart(2, "0");
  const horas = Math.floor(s / 3600), minutos = Math.floor((s % 3600) / 60);
  return horas ? `${horas}:${dos(minutos)}:${dos(s % 60)}` : `${minutos}:${dos(s % 60)}`;
}

// Días del período (AAAA-MM-DD): "Del 7 al 13 de octubre", "Del 28 de septiembre al 4 de octubre", "Martes 13 de octubre".
export function textoRango(desde, hasta) {
  if (desde === hasta) return `${conMayusculaInicial(DIAS_LARGOS[semanaDe(desde)])} ${dia(desde)} de ${mes(desde)}`;
  if (desde.slice(0, 7) === hasta.slice(0, 7)) return `Del ${dia(desde)} al ${dia(hasta)} de ${mes(hasta)}`;
  return `Del ${dia(desde)} de ${mes(desde)} al ${dia(hasta)} de ${mes(hasta)}`;
}
const conMayusculaInicial = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

// Rótulo del día en el gráfico: "Mié 7".
export const diaCorto = (fecha) => `${DIAS_CORTOS[semanaDe(fecha)]} ${dia(fecha)}`;

// Cuánto hace: "hoy", "hace 1 día", "hace 5 días". null (sin fecha) → "—".
export const haceDias = (dias) => (dias === null || dias === undefined ? "—" : dias === 0 ? "hoy" : dias === 1 ? "hace 1 día" : `hace ${dias} días`);

// Para cuántos días alcanza lo de la 02: texto y tono (error: menos de 1 día; alerta: menos de 3; ok: más).
export function alcanza(dias) {
  if (dias === null || dias === undefined) return { texto: "—", tono: "gris" };
  if (dias < 1) return { texto: "Menos de 1 día", tono: "error" };
  return { texto: dias === 1 ? "1 día" : `${dias} días`, tono: dias < 3 ? "alerta" : "ok" };
}

// Documento: "Factura 10452", "Traslado 2219 · a la C64".
export function textoDocumentoReporte({ fuente, docNum, almacenDestino = null }) {
  const nombre = fuente === "traslado" ? "Traslado" : fuente === "pedido" ? "Pedido" : "Factura";
  return `${nombre} ${docNum ?? "—"}${fuente === "traslado" && almacenDestino ? ` · a la ${almacenDestino}` : ""}`;
}

// Estado de una preparación en los reportes.
export const ESTADO_PREPARACION = {
  completo: { texto: "Completa", tono: "ok" },
  con_diferencias: { texto: "Con diferencias", tono: "alerta" },
  requiere_revision: { texto: "En revisión", tono: "rol" },
  anulada: { texto: "Anulada", tono: "error" },
};

// Motivo de una lectura rechazada (detalle de una preparación).
export const MOTIVO_LECTURA = {
  equivocado: "No va en este documento", deMas: "Ya estaba completo", noRegistrado: "Código no registrado",
  codigoCaja: "Es el código de la caja", cambioSap: "Cambió en SAP mientras se preparaba", otro: "Rechazada",
};

// Qué cambió en Correcciones.
export const TIPO_CAMBIO = {
  conteo: { texto: "Conteo editado", tono: "alerta" }, lote: { texto: "Lote cambiado", tono: "rol" },
  anulada: { texto: "Anulada", tono: "error" }, codigo: { texto: "Código quitado", tono: "gris" },
};

// Pendientes atrasados: cada clase con su nombre y adónde lleva su botón (pestaña de Pendientes del inventario).
export const CLASE_PENDIENTE = {
  faltaGuardar: { texto: "Falta guardar", boton: "Guardar", pestana: "ubicar" },
  faltaMarcarSalida: { texto: "Falta marcar salida", boton: "Marcar salida", pestana: "descontar" },
  traspasosPorAceptar: { texto: "Traspaso por aceptar", boton: "Revisar y aceptar", pestana: "pasar" },
};

// Acción de Actividad por operador.
export const TIPO_ACCION = {
  preparacion: { texto: "Preparación", tono: "ok" }, reposicion: { texto: "Reposición", tono: "alerta" },
  recepcion: { texto: "Recepción", tono: "rol" }, conteo: { texto: "Conteo", tono: "gris" }, codigo: { texto: "Código", tono: "gris" },
  salida: { texto: "Salida marcada", tono: "rol" }, correccion: { texto: "Corrección", tono: "error" },
};

// Nombre del PDF de un reporte: Reporte-Preparaciones-2026-10-13-1520.pdf.
export function nombreArchivoReporte(nombre, iso) {
  const d = new Date(iso);
  const dos = (n) => String(n).padStart(2, "0");
  const limpio = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `Reporte-${limpio}-${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}.pdf`;
}

// Horas a mostrar en el gráfico de actividad: de la primera a la última con algo (al menos de 7 a 16).
export function horasConActividad(porHora) {
  const con = porHora.filter((x) => x.cantidad > 0).map((x) => x.hora);
  const desde = Math.min(7, ...con), hasta = Math.max(16, ...con);
  return porHora.filter((x) => x.hora >= desde && x.hora <= hasta);
}

// Semana ISO de un día ("2026-10-13" → 42).
export function numeroSemana(fecha) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
}

// Preparaciones por día para el gráfico: hasta 14 días, un día por columna ("Mié 7"); más, una columna por semana ("S42").
export function columnasPorDia(porDia) {
  if (porDia.length <= 14) return porDia.map((x) => ({ rotulo: diaCorto(x.fecha), completas: x.completas, conDiferencias: x.conDiferencias }));
  const semanas = new Map();
  for (const x of porDia) {
    const s = `S${numeroSemana(x.fecha)}`;
    const actual = semanas.get(s) ?? { rotulo: s, completas: 0, conDiferencias: 0 };
    actual.completas += x.completas; actual.conDiferencias += x.conDiferencias;
    semanas.set(s, actual);
  }
  return [...semanas.values()];
}

// Vencimientos: tono de cada tramo, fecha "20/11/2026" y mes "nov 26".
export const TRAMO_VENCIMIENTO = { vencido: { tono: "error" }, en30: { tono: "alerta" }, en60: { tono: "rol" }, en90: { tono: "gris" }, mas: { tono: "gris" } };
export const textoVencimiento = (fecha) => (fecha ? `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)}` : "—");
export const mesCorto = (mes) => `${MESES[Number(mes.slice(5, 7)) - 1].slice(0, 3)} ${mes.slice(2, 4)}`;
