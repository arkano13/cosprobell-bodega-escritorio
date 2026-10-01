// Textos de un pedido ya preparado en la lista. Sale de la lista cuando SAP registra la entrega y cierra el pedido,
// o HORAS_EN_LISTA después de prepararse; a partir de ahí lo sigue viendo el supervisor en su panel (Revisiones).
export const HORAS_EN_LISTA = 24;
const HORA = 3_600_000;
const numero = (valor) => Number(valor).toLocaleString("es-HN");

function inicioDelDia(momento) {
  const dia = new Date(momento);
  return new Date(dia.getFullYear(), dia.getMonth(), dia.getDate()).getTime();
}

// "2:32 p. m." si fue hoy, "ayer 11:48 a. m." o "28/9 9:05 a. m.", en la hora del equipo.
function cuando(fin, ahora) {
  const hora = new Date(fin).toLocaleTimeString("es-HN", { hour: "numeric", minute: "2-digit" });
  const dias = Math.round((inicioDelDia(ahora) - inicioDelDia(fin)) / (24 * HORA));
  if (dias <= 0) return hora;
  if (dias === 1) return `ayer ${hora}`;
  return `${new Date(fin).toLocaleDateString("es-HN", { day: "numeric", month: "numeric" })} ${hora}`;
}

export function textosPreparado(preparado, ahora = Date.now()) {
  const completo = preparado.estado === "completo";
  const fin = Date.parse(preparado.fechaFin);
  const conFecha = Number.isFinite(fin);
  const faltan = Math.max(0, preparado.unidadesPedidas - preparado.unidadesPreparadas);
  return {
    completo,
    estado: completo ? "Preparado" : "Preparado con diferencias",
    quien: [preparado.operador && `Preparado por ${preparado.operador}`, conFecha && cuando(fin, ahora)].filter(Boolean).join(" · "),
    unidades: `${numero(preparado.unidadesPreparadas)} de ${numero(preparado.unidadesPedidas)} ${preparado.unidadesPedidas === 1 ? "unidad" : "unidades"}`
      + (faltan === 0 ? "" : faltan === 1 ? " · faltó 1" : ` · faltaron ${numero(faltan)}`),
  };
}

// Sin hora de fin no se puede saber cuándo vence: se deja en la lista.
export function sigueEnLista(preparado, ahora = Date.now()) {
  const fin = Date.parse(preparado.fechaFin);
  return !Number.isFinite(fin) || ahora - fin < HORAS_EN_LISTA * HORA;
}
