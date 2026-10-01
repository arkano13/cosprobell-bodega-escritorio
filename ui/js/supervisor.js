// Textos y estados del panel del supervisor, sin acceso al DOM (se prueban en test/ui.test.js).
const numero = (valor) => Number(valor).toLocaleString("es-HN");
const hora = (iso) => new Date(iso).toLocaleTimeString("es-HN", { hour: "numeric", minute: "2-digit" });

export const NOMBRES_DATOS = {
  pedidos: "Pedidos", clientes: "Clientes", productos: "Productos", unidades: "Unidades de medida", codigosBarras: "Códigos de barras",
};

// Pedidos: la bodega necesita datos de menos de una hora (la app ya avisa en cada pedido). El resto cambia poco.
export const MINUTOS_PARA_AVISO = { pedidos: 60 };
const MINUTOS_PARA_AVISO_RESTO = 24 * 60;

export function estadoDatos({ entidad, ultimaRecepcion }, ahora = Date.now()) {
  const momento = Date.parse(ultimaRecepcion);
  if (!Number.isFinite(momento)) return { tipo: "sin_datos", texto: "Sin datos todavía" };
  const limite = MINUTOS_PARA_AVISO[entidad] ?? MINUTOS_PARA_AVISO_RESTO;
  if ((ahora - momento) / 60000 <= limite) return { tipo: "ok", texto: "Al día" };
  return { tipo: "alerta", texto: limite < 120 ? "Más de 1 h sin datos" : "Más de 24 h sin datos" };
}

export function textoUnidad(etiqueta) {
  if (etiqueta.unidad?.code) return etiqueta.unidad.nombre ? `${etiqueta.unidad.code} · ${etiqueta.unidad.nombre}` : etiqueta.unidad.code;
  if (etiqueta.uomEntry === -1) return "Manual (unidad del artículo)";
  return "Sin unidad en SAP";
}

// Sin unidad en SAP no se puede confirmar como unidad individual; "Manual" (-1) sí.
export const puedeSerUnidad = (etiqueta) => Number.isInteger(etiqueta.uomEntry) && etiqueta.uomEntry >= -1;

// confirmadaPor guarda la aplicación o "operador:Nombre".
export const quienConfirmo = (confirmadaPor) => (confirmadaPor ?? "").replace(/^operador:/, "") || "otra aplicación";

export function estadoOperador(o) {
  if (o.estado === "inactivo") return { tipo: "gris", texto: "Inactivo", detalle: "No aparece en la lista de ingreso" };
  if (o.estado === "bloqueado") return { tipo: "error", texto: "Bloqueado", detalle: `${numero(o.intentosFallidos)} PIN incorrectos seguidos` };
  if (o.estado === "pausa") return { tipo: "alerta", texto: `En pausa hasta ${hora(o.pausaHasta)}`, detalle: `${numero(o.intentosFallidos)} PIN incorrectos` };
  return { tipo: "ok", texto: "Activo", detalle: o.intentosFallidos ? `${numero(o.intentosFallidos)} PIN incorrectos` : "" };
}

export function textoRevision(r) {
  if (r.motivo === "CAMBIOS_EN_SAP" || r.motivo === "SIN_CAMBIOS") {
    const avance = `llevaba ${numero(r.unidadesPreparadas)} de ${numero(r.unidadesPedidas)} unidades`;
    const quien = r.operador ? `mientras ${r.operador} lo preparaba` : "mientras se preparaba";
    return r.motivo === "CAMBIOS_EN_SAP" ? `SAP cambió el pedido ${quien} (${avance}).`
      : `SAP actualizó el pedido ${quien} (${avance}), sin cambios en lo que hay que preparar.`;
  }
  return r.mensaje ?? "La preparación quedó en revisión.";
}

export function textoCambio(c) {
  if (c.ahora === null) return "Quitado del pedido";
  if (c.antes === null) return `Agregado: ${numero(c.ahora)}`;
  return `${numero(c.ahora)}${c.cambioUnidad ? " (otra unidad)" : ""}`;
}

export function textoSinEntrega(horas) {
  return horas < 48 ? `${numero(horas)} h` : `${numero(Math.floor(horas / 24))} días`;
}
