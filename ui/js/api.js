// Cliente de la API para la pantalla de bodega. Toda respuesta con error se convierte en ErrorApi.
export class ErrorApi extends Error {
  constructor({ status = 0, mensaje, codigo = null, temporal = false }) {
    super(mensaje);
    this.name = "ErrorApi";
    this.mensaje = mensaje;
    this.status = status;
    this.codigo = codigo;
    // temporal: conviene reintentar la misma solicitud (sin conexión, tiempo agotado o falla del servidor).
    this.temporal = temporal;
  }
}

const TEMPORALES = [408, 429, 500, 502, 503, 504];

// token: la sesión del operador que ingresó con su PIN.
export function crearApi({ token, base = "", fetchImpl = (...args) => globalThis.fetch(...args), tiempoMs = 15000 }) {
  async function pedir(metodo, ruta, cuerpo) {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), tiempoMs);
    let respuesta;
    try {
      respuesta = await fetchImpl(`${base}${ruta}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, ...(cuerpo === undefined ? {} : { "Content-Type": "application/json" }) },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal: control.signal,
      });
    } catch {
      throw new ErrorApi({ mensaje: "Sin conexión con el servidor", temporal: true });
    } finally {
      clearTimeout(temporizador);
    }
    let datos = null;
    try { datos = await respuesta.json(); } catch { /* cuerpo vacío o que no es JSON */ }
    if (!respuesta.ok) {
      // Picking responde { error: "mensaje" }; el resto, { error: { code, message } }.
      const error = datos?.error;
      const mensaje = typeof error === "string" ? error : error?.message ?? `Error del servidor (${respuesta.status})`;
      const codigo = error && typeof error === "object" ? error.code ?? null : null;
      throw new ErrorApi({ status: respuesta.status, mensaje, codigo, temporal: TEMPORALES.includes(respuesta.status) });
    }
    return datos;
  }

  return {
    pedidos: (cursor = null) => pedir("GET", `/pedidos?estado=abiertos&limit=25${cursor === null ? "" : `&cursor=${cursor}`}`),
    pedido: (docEntry) => pedir("GET", `/pedidos/${docEntry}`),
    // El preparador lo pone el servidor: es el operador de la sesión.
    iniciar: (pedidoDocEntry) => pedir("POST", "/picking", { pedidoDocEntry }),
    sesion: (id) => pedir("GET", `/picking/${id}`),
    escanear: (id, codigo, operacionId) => pedir("POST", `/picking/${id}/escanear`, { codigo, operacionId }),
    escaneos: (id, despuesDe = null) => pedir("GET", `/picking/${id}/escaneos?limit=100${despuesDe === null ? "" : `&despuesDe=${despuesDe}`}`),
    // lotes: [{ itemCode, lotes: [{ pequenaLoteId, unidades }] }] para los productos con varios lotes en la pequeña.
    finalizar: (id, lotes = []) => pedir("POST", `/picking/${id}/finalizar`, { lotes }),
    cerrarSesion: () => pedir("DELETE", "/ingreso/sesion"),
    // Panel del supervisor (solo con rol supervisor).
    resumenSupervisor: () => pedir("GET", "/supervisor/resumen"),
    etiquetasSupervisor: ({ estado, buscar = "", cursor = null }) => pedir("GET", `/supervisor/etiquetas?${new URLSearchParams({
      estado, limit: "50", ...(buscar ? { buscar } : {}), ...(cursor === null ? {} : { cursor: String(cursor) }) })}`),
    confirmarEtiqueta: (id, esUnidadIndividual) => pedir("PUT", `/supervisor/etiquetas/${id}/confirmacion`, { esUnidadIndividual }),
    quitarConfirmacion: (id) => pedir("DELETE", `/supervisor/etiquetas/${id}/confirmacion`),
    // Cantidad y versión del conjunto que revisó el supervisor (manualSinConfirmar y versionManual del resumen).
    confirmarManual: (cantidadEsperada, versionEsperada) => pedir("POST", "/supervisor/etiquetas/confirmacion-manual", { cantidadEsperada, versionEsperada }),
    operadoresSupervisor: () => pedir("GET", "/supervisor/operadores"),
    crearOperador: (datos) => pedir("POST", "/supervisor/operadores", datos),
    cambiarPin: (id, pin) => pedir("PUT", `/supervisor/operadores/${id}/pin`, { pin }),
    desbloquear: (id) => pedir("POST", `/supervisor/operadores/${id}/desbloqueo`),
    cambiarActivo: (id, activo) => pedir("PUT", `/supervisor/operadores/${id}/activo`, { activo }),
    revisiones: () => pedir("GET", "/supervisor/revisiones"),
    anularRevision: (pickingId) => pedir("POST", `/supervisor/revisiones/${pickingId}/anulacion`),
    sincronizacion: () => pedir("GET", "/supervisor/sincronizacion"),
    almacenes: () => pedir("GET", "/supervisor/almacenes"),
    // porBodega: { almacenGrande, almacenPequena }, qué almacén marcado es cada bodega (null: sin asignar).
    elegirAlmacenes: (almacenes, pedidosSoloDeEstaBodega, porBodega = {}) => pedir("PUT", "/supervisor/almacenes",
      { almacenes, pedidosSoloDeEstaBodega, ...porBodega }),
    registrarCodigo: (codigo, itemCode) => pedir("POST", "/supervisor/codigos", { codigo, itemCode }),
    // Inventario de las dos bodegas.
    inventario: () => pedir("GET", "/inventario/resumen"),
    buscarProductos: (buscar) => pedir("GET", `/inventario/productos?${new URLSearchParams({ buscar, limit: "20" })}`),
    producto: (itemCode) => pedir("GET", `/inventario/productos/${encodeURIComponent(itemCode)}`),
    pendientes: () => pedir("GET", "/inventario/pendientes"),
    conteoInicial: ({ buscar = "", pagina = 0 } = {}) => pedir("GET", `/inventario/pendientes/inicial?${new URLSearchParams({
      pagina: String(pagina), limit: "50", ...(buscar ? { buscar } : {}) })}`),
    // Todos los productos de las bodegas. filtro: todos, grande, pequena, solo_sap o diferencia.
    existencias: ({ buscar = "", filtro = "todos", pagina = 0 } = {}) => pedir("GET", `/inventario/existencias?${new URLSearchParams({
      filtro, pagina: String(pagina), limit: "50", ...(buscar ? { buscar } : {}) })}`),
    // Lo que hay en la bodega grande o la pequeña, por lote. filtro: todos, registrados o sin_registrar.
    bodega: (bodega, { buscar = "", filtro = "todos", pagina = 0 } = {}) => pedir("GET", `/inventario/bodegas/${bodega}?${new URLSearchParams({
      filtro, pagina: String(pagina), limit: "50", ...(buscar ? { buscar } : {}) })}`),
    // Almacenes de SAP (marcados y con existencia) y los productos que SAP tiene en uno.
    almacenesSap: () => pedir("GET", "/inventario/almacenes"),
    productosDeAlmacen: (codigo, { buscar = "", pagina = 0 } = {}) => pedir("GET", `/inventario/almacenes/${encodeURIComponent(codigo)}/productos?${new URLSearchParams({
      pagina: String(pagina), limit: "50", ...(buscar ? { buscar } : {}) })}`),
    // Conteo de una bodega (grande o pequena): lo que falta contar o lo contado, con el avance.
    conteo: (bodega, { estado = "falta", buscar = "", pagina = 0 } = {}) => pedir("GET", `/inventario/conteo/${bodega}?${new URLSearchParams({
      estado, pagina: String(pagina), limit: "50", ...(buscar ? { buscar } : {}) })}`),
    // "No hay": se contó en esa bodega y no había ninguno. cuerpo: { operacionId, bodega }.
    sinExistencia: (itemCode, cuerpo) => pedir("POST", `/inventario/productos/${encodeURIComponent(itemCode)}/sin-existencia`, cuerpo),
    caja: (codigo) => pedir("GET", `/inventario/cajas/${encodeURIComponent(codigo)}`),
    porVencer: (dias) => pedir("GET", `/inventario/por-vencer?dias=${dias}`),
    movimientos: ({ itemCode = null, antesDe = null } = {}) => pedir("GET", `/inventario/movimientos?${new URLSearchParams({
      limit: "30", ...(itemCode ? { itemCode } : {}), ...(antesDe === null ? {} : { antesDe: String(antesDe) }) })}`),
    descuentos: (antesDe = null) => pedir("GET", `/inventario/descuentos?limit=30${antesDe === null ? "" : `&antesDe=${antesDe}`}`),
    // Operaciones físicas: el cuerpo lleva su operacionId (ver operaciones.js). Reintentar lo mismo no lo cuenta dos veces.
    recibir: (cuerpo) => pedir("POST", "/inventario/recepciones", cuerpo),
    reponer: (cuerpo) => pedir("POST", "/inventario/reposiciones", cuerpo),
    descontar: (cuerpo) => pedir("POST", "/inventario/descuentos", cuerpo),
    cambiarLote: (id, cuerpo) => pedir("POST", `/inventario/descuentos/${id}/reasignacion`, cuerpo),
    contarPequena: (itemCode, cuerpo) => pedir("PUT", `/inventario/productos/${encodeURIComponent(itemCode)}/pequena`, cuerpo),
    corregirCaja: (id, cuerpo) => pedir("PUT", `/inventario/cajas/${id}/unidades`, cuerpo),
  };
}
