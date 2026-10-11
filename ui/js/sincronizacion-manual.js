const enCurso = solicitud => ["pendiente", "sincronizando"].includes(solicitud?.estado);

export function presentacionManual({ datos, consultando, enviando, incierto, error }) {
  const s = datos?.solicitud;
  let texto = "Consultando disponibilidad…", tipo = "info";
  if (datos) {
    texto = "Podés actualizar productos, pedidos y existencias de los almacenes seleccionados.";
    if (!datos.entidades?.length) texto = "Falta actualizar y ejecutar el puente para habilitar esta función.";
    if (s?.estado === "pendiente") texto = "Solicitud guardada. Esperando al puente.";
    if (s?.estado === "sincronizando") texto = `Actualizando: ${s.completas.length} de ${s.entidades.length} entidades completas. Puede continuar en varias ejecuciones.`;
    if (s?.estado === "completado") { texto = "Actualización completada."; tipo = "ok"; }
    if (s?.estado === "error") { texto = `La actualización no terminó. Código: ${s.error ?? "ERROR_DESCONOCIDO"}.`; tipo = "error"; }
  }
  if (incierto) { texto = "No pudimos confirmar la solicitud. Estamos consultando su estado antes de permitir otro intento."; tipo = "alerta"; }
  if (error?.status === 404) { texto = "Falta actualizar el backend para habilitar esta función."; tipo = "alerta"; }
  return { texto, tipo, deshabilitado: consultando || enviando || incierto || !datos?.entidades?.length || enCurso(s) || Boolean(error),
    boton: enviando ? "Solicitando…" : enCurso(s) ? "Actualización en curso" : "Actualizar productos, pedidos y existencias" };
}

// Solo consultas mientras la vista está abierta. El POST no se reintenta solo:
// tras perder la respuesta, primero se averigua si el backend guardó la solicitud.
export function crearActualizacionManual({ api, alCambiar, alCompletar = async () => {}, alSalir = () => {},
  programar = setTimeout, cancelar = clearTimeout, intervalo = 8000 }) {
  let vivo = true, temporizador, completada = null;
  let estado = { datos: null, consultando: false, enviando: false, incierto: false, error: null };
  const emitir = () => { if (vivo) alCambiar({ ...estado }); };
  function detener() { vivo = false; cancelar(temporizador); }
  function fallo(error) {
    estado.error = error;
    if ([401, 403].includes(error?.status)) { detener(); alSalir(error); }
  }
  function siguiente() {
    cancelar(temporizador);
    if (vivo) temporizador = programar(consultar, intervalo);
  }
  async function consultar() {
    if (!vivo || estado.consultando || estado.enviando) return;
    cancelar(temporizador); estado.consultando = true; emitir();
    try {
      const { data } = await api.solicitudSincronizacion();
      if (!vivo) return;
      estado.datos = data; estado.error = null; estado.incierto = false;
      const s = data.solicitud;
      if (s?.estado === "completado" && completada !== s.id) {
        await alCompletar(); if (!vivo) return; completada = s.id;
      }
    } catch (error) { if (vivo) fallo(error); }
    finally { estado.consultando = false; emitir(); siguiente(); }
  }
  async function solicitar() {
    if (!vivo || presentacionManual(estado).deshabilitado) return;
    cancelar(temporizador); estado.enviando = true; estado.error = null; emitir();
    try {
      const { data } = await api.actualizarTodo();
      if (!vivo) return;
      estado.datos = { ...estado.datos, solicitud: data };
    } catch (error) {
      if (!vivo) return;
      estado.incierto = !error.status || error.status >= 500;
      fallo(error);
    } finally { estado.enviando = false; emitir(); siguiente(); }
  }
  return { iniciar: consultar, solicitar, detener };
}
