// Textos de un pedido ya preparado en la lista. El pedido sigue abierto hasta que SAP registra la entrega y lo
// cierra; entonces sale solo de la lista. No se quita por tiempo: pasadas HORAS_SIN_ENTREGA se avisa para revisar
// la entrega en SAP.
export const HORAS_SIN_ENTREGA = 24;
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
  const horas = conFecha ? Math.floor((ahora - fin) / HORA) : null;
  return {
    completo,
    estado: completo ? "Preparado" : "Preparado con diferencias",
    quien: [preparado.operador && `Preparado por ${preparado.operador}`, conFecha && cuando(fin, ahora)].filter(Boolean).join(" · "),
    unidades: `${numero(preparado.unidadesPreparadas)} de ${numero(preparado.unidadesPedidas)} ${preparado.unidadesPedidas === 1 ? "unidad" : "unidades"}`
      + (faltan === 0 ? "" : faltan === 1 ? " · faltó 1" : ` · faltaron ${numero(faltan)}`),
    aviso: horas !== null && horas >= HORAS_SIN_ENTREGA
      ? `Sin entrega en SAP hace ${horas < 48 ? `${horas} h` : `${Math.floor(horas / 24)} días`}`
      : null,
  };
}
