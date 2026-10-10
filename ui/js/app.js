import { crearApi } from "./api.js";
import { crearColaLecturas } from "./lecturas.js";
import { icono } from "./iconos.js";
import { HORAS_EN_LISTA, datosLinea, pedidoConNombres, sigueEnLista, textosPreparado } from "./preparados.js";
import { NOMBRES_DATOS, estadoDatos, estadoOperador, puedeSerUnidad, quienConfirmo, textoCambio, textoRevision, textoSinEntrega, textoUnidad } from "./supervisor.js";
import { ESTADOS, TEXTO_SIN_COMPARACION, armarAsignaciones, agruparEtiquetas, armarConteo, armarConteoCajas, conteoGuardadoAlmacen, conteoGuardadoGrande, cuerpoEdicionGrande, armarGrupos, armarLotesDespacho, armarLotesPequena, avanceConteo,
  cantidadMovimiento, diasParaVencer, esCodigoCaja, pareceCodigoBarras, estadoFila, estadoSap, filtrosBodega, filtrosExistencias, finDeMes, nombreBodega, nombreOpcion, opcionesDescuento,
  pasosPuestaEnMarcha, quien, filasTraspaso, resumenTraspaso, cajasDeLaGrande, cajasEscaneadas, lotesParaEscanear, venceDespues, resumenRecepcion, revisarDespacho, sugerirAsignacion, textoAsignacion, textoContado, textoDocumento, textoEstado, textoLoteBodega,
  textoMovimiento, textoPorVencer, textoVencimiento, unidadesPorProducto } from "./inventario.js";
import { conSigno, destacadosCuadre, nombreArchivoCuadre, notaCuadre, porcentaje, unidadesConSigno } from "./reportes.js";
import { crearOperacion } from "./operaciones.js";
import { barras } from "./code128.js";

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

// Datos del equipo guardados en el navegador. Si el almacenamiento no está disponible, la pantalla sigue
// funcionando, pero hay que volver a configurar el equipo al recargar.
const guardado = {
  leer(clave) { try { return JSON.parse(localStorage.getItem(`bodega.${clave}`)); } catch { return null; } },
  escribir(clave, valor) { try { localStorage.setItem(`bodega.${clave}`, JSON.stringify(valor)); } catch { /* sin almacenamiento */ } },
  borrar(clave) { try { localStorage.removeItem(`bodega.${clave}`); } catch { /* sin almacenamiento */ } },
};

// Crea elementos con texto seguro: los datos de SAP nunca se insertan como HTML.
function h(etiqueta, atributos = {}, ...hijos) {
  const elemento = document.createElement(etiqueta);
  for (const [nombre, valor] of Object.entries(atributos)) {
    if (valor === false || valor === null || valor === undefined) continue;
    if (nombre.startsWith("on")) elemento.addEventListener(nombre.slice(2), valor);
    else if (nombre === "class") elemento.className = valor;
    else if (valor === true) elemento.setAttribute(nombre, "");
    else elemento.setAttribute(nombre, valor);
  }
  for (const hijo of hijos.flat()) {
    if (hijo !== null && hijo !== undefined && hijo !== false) elemento.append(hijo instanceof Node ? hijo : String(hijo));
  }
  return elemento;
}

// Como replaceChildren, pero sin mostrar las partes condicionales (a && h(...)) que vienen como false, null o undefined.
function poner(elemento, ...hijos) {
  elemento.replaceChildren(...hijos.flat().filter((hijo) => hijo !== false && hijo !== null && hijo !== undefined));
}

function hace(fechaIso) {
  const minutos = Math.round((Date.now() - Date.parse(fechaIso)) / 60000);
  if (!Number.isFinite(minutos)) return "fecha desconocida";
  if (minutos < 1) return "hace menos de 1 minuto";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return horas < 24 ? `hace ${horas} h` : `hace ${Math.floor(horas / 24)} d`;
}
// Las fechas de SAP son de calendario (sin hora): se muestran en UTC para no correrse un día.
const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString("es-HN", { timeZone: "UTC" }) : "—");
// Las horas de la preparación sí son momentos exactos: se muestran en la hora del equipo.
const fechaHora = (iso) => new Date(iso).toLocaleString("es-HN", { dateStyle: "short", timeStyle: "short" });
const pendientesTexto = (n) => (n === 0 ? "Todas las líneas completas" : n === 1 ? "1 línea pendiente" : `${n} líneas pendientes`);
const cantidad = (valor) => (Number.isFinite(Number(valor)) ? Number(valor).toLocaleString("es-HN") : "—");
// Aviso (no bloqueo) cuando los datos del pedido tienen más de una hora: la regla definitiva está pendiente.
const MINUTOS_DATOS_VIEJOS = 60;
const datosViejos = (iso) => Date.now() - Date.parse(iso) > MINUTOS_DATOS_VIEJOS * 60000;
// Con la lista de pedidos abierta se vuelve a pedir sola: el puente trae los cambios de SAP cada pocos minutos.
const MINUTOS_REFRESCO = 5;
const horaCorta = (momento) => new Date(momento).toLocaleTimeString("es-HN", { hour: "numeric", minute: "2-digit" });

let audio = null;
function sonar(tipo) {
  try {
    audio ??= new AudioContext();
    const tonos = tipo === "ok" ? [[880, 0.12]] : [[260, 0.18], [180, 0.28]];
    let inicio = audio.currentTime;
    for (const [frecuencia, duracion] of tonos) {
      const oscilador = audio.createOscillator();
      const volumen = audio.createGain();
      oscilador.frequency.value = frecuencia;
      volumen.gain.value = 0.15;
      oscilador.connect(volumen).connect(audio.destination);
      oscilador.start(inicio);
      oscilador.stop(inicio + duracion);
      inicio += duracion + 0.05;
    }
  } catch { /* equipo sin sonido */ }
  if (tipo !== "ok") navigator.vibrate?.(300);
}

// ---------------------------------------------------------------------------
// Estado de la pantalla
// ---------------------------------------------------------------------------

// La versión 1.0.0 guardaba dirección, clave y nombre en el equipo: ya no se usan.
for (const viejo of ["clave", "servidor", "operador"]) guardado.borrar(viejo);

// La dirección del servidor la fija la app; la sesión es la del operador que ingresó con su PIN.
const preferencias = await window.escritorio?.obtenerPreferencias().catch(() => null);
const estado = {
  servidor: preferencias?.servidor ?? null,
  ingreso: guardado.leer("ingreso"), // { token, expiraEn, operador: { id, nombre } }
  sesion: guardado.leer("sesion"), // { pickingId, docEntry, docNum }
  pendientesInventario: 0, // por ubicar + por descontar, para la insignia de la sección Inventario
  desdeLista: null, // { buscar, filtro, pagina } si la ficha del producto se abrió desde la lista de productos
  desdeBodegas: null, // { almacen, buscar, pagina } si se abrió desde la sección Bodegas
  desdeConteo: null, // "grande", "pequena" o { almacen } si la ficha se abrió desde el modo conteo
  bodegas: undefined, // { grande, pequena }: el almacén de SAP de cada bodega ({ almacen, nombre } o null), al cargar el inventario
};
const ingresoVigente = (ingreso) => Boolean(ingreso?.token && Date.parse(ingreso.expiraEn) > Date.now());
let api = estado.servidor && ingresoVigente(estado.ingreso) ? crearApi({ token: estado.ingreso.token, base: estado.servidor }) : null;
let limpiezas = [];
// Una sola cola de lecturas por preparación, aunque se salga y se vuelva a entrar a la pantalla de escaneo:
// así las lecturas pendientes no se envían desde dos colas a la vez.
let lecturas = null; // { pickingId, cola, alCambiar }
function colaDe(pickingId) {
  if (lecturas?.pickingId !== pickingId) {
    const registro = { pickingId, alCambiar: () => {} };
    registro.cola = crearColaLecturas({
      enviar: (lectura) => api.escanear(pickingId, lectura.codigo, lectura.operacionId),
      guardar: (pendientes) => guardado.escribir(`cola.${pickingId}`, pendientes),
      pendientes: guardado.leer(`cola.${pickingId}`) ?? [],
      alCambiar: (evento) => registro.alCambiar(evento),
    });
    lecturas = registro;
  }
  return lecturas;
}

const vista = document.getElementById("vista");
const dialogo = document.getElementById("dialogo");

// Cambia de vista y retira los escuchadores de la anterior.
function mostrar(...nodos) {
  for (const limpiar of limpiezas) limpiar();
  limpiezas = [];
  delete vista.dataset.ancho;
  // Las partes condicionales (a && h(...)) pueden venir como false o null: no se muestran.
  vista.replaceChildren(...nodos.flat().filter((nodo) => nodo instanceof Node));
  window.scrollTo(0, 0);
}
// Vistas con varias columnas en PC (lista de pedidos y escaneo).
function mostrarAmplio(...nodos) {
  mostrar(...nodos);
  vista.dataset.ancho = "amplio";
}
function escuchar(objetivo, evento, funcion) {
  objetivo.addEventListener(evento, funcion);
  limpiezas.push(() => objetivo.removeEventListener(evento, funcion));
}
const cargando = (texto) => h("p", { class: "cargando" }, texto);
const tituloPedido = (docNum) => h("h1", {}, h("span", { class: "rotulo" }, "Pedido"), " ", String(docNum));
const boton = (clase, nombreIcono, texto, atributos = {}) =>
  h("button", { class: `boton ${clase}`.trim(), type: "button", ...atributos }, nombreIcono && icono(nombreIcono), texto);

// Aviso con ícono: el color nunca es la única señal.
const ICONO_AVISO = { error: "rechazada", alerta: "alerta", ok: "aceptada", info: "info" };
function aviso(tipo, texto, atributos = {}, ...extra) {
  const { class: clase = "", ...resto } = atributos;
  return h("div", { class: `aviso aviso--${tipo} ${clase}`.trim(), ...resto },
    icono(ICONO_AVISO[tipo]), h("span", { class: "aviso__texto" }, texto), ...extra);
}
const textoAviso = (elemento, texto) => { elemento.querySelector(".aviso__texto").textContent = texto; };

function guardarSesion(sesion) {
  estado.sesion = sesion;
  if (sesion) guardado.escribir("sesion", sesion); else guardado.borrar("sesion");
}

// El panel del supervisor solo se ofrece a quien ingresó con rol supervisor; el servidor también lo exige.
const esSupervisor = () => Boolean(api) && estado.ingreso?.operador?.rol === "supervisor";

function actualizarBarra() {
  const operador = document.getElementById("operador");
  const nombre = api ? estado.ingreso?.operador?.nombre : null;
  operador.hidden = !nombre;
  operador.replaceChildren(...(nombre ? [icono(esSupervisor() ? "escudo" : "operador"), h("span", {}, `${esSupervisor() ? "Supervisor" : "Operador"}: ${nombre}`)] : []));
}

// Secciones principales: pedidos, inventario y, para el supervisor, su panel.
function navegacion(actual) {
  const secciones = [
    { id: "pedidos", icono: "lista", texto: "Pedidos", ir: () => vistaPedidos() },
    { id: "inventario", icono: "bodega", texto: "Inventario", ir: () => vistaInventario(), n: estado.pendientesInventario },
    { id: "bodegas", icono: "capas", texto: "Bodegas", ir: () => vistaBodegas() },
    esSupervisor() && { id: "panel", icono: "escudo", texto: "Panel del supervisor", ir: () => vistaSupervisor() },
  ].filter(Boolean);
  return h("nav", { class: "secciones", "aria-label": "Secciones" }, secciones.map((s) =>
    h("button", { class: "seccion", type: "button", "aria-current": s.id === actual ? "page" : null, onclick: s.ir },
      icono(s.icono), s.texto, s.n > 0 && h("span", { class: "contador contador--alerta", "aria-label": `${s.n} pendientes` }, String(s.n)))));
}

// Termina la sesión en este equipo. Las lecturas pendientes quedan guardadas y se envían al volver a ingresar.
function olvidarIngreso() {
  estado.ingreso = null;
  guardado.borrar("ingreso");
  api = null;
  actualizarBarra();
}

// Error al cargar una vista: la sesión vencida lleva al ingreso; el resto ofrece reintentar.
function mostrarError(error, reintentar) {
  if (error?.status === 401) {
    olvidarIngreso();
    return vistaIngreso("Tu sesión terminó. Volvé a ingresar con tu PIN.");
  }
  return mostrar(api && navegacion(null), h("div", { class: "tarjeta" },
    aviso("error", error?.mensaje ?? "Ocurrió un error inesperado", { role: "alert" }),
    h("div", { class: "fila" },
      boton("boton--principal", "actualizar", "Reintentar", { onclick: reintentar }),
      boton("", "volver", "Volver a pedidos", { onclick: () => vistaPedidos() }))));
}

// Diálogo de confirmación: resuelve true o false.
function confirmar({ titulo, texto, aceptar = "Aceptar", peligro = false }) {
  return new Promise((resolver) => {
    const cerrar = (valor) => { dialogo.close(); resolver(valor); };
    dialogo.replaceChildren(
      h("div", { class: "dialogo__cuerpo" }, h("h2", {}, titulo), ...[].concat(texto).map((t) => h("p", {}, t))),
      h("div", { class: "dialogo__acciones" },
        h("button", { class: "boton", type: "button", onclick: () => cerrar(false) }, "Cancelar"),
        h("button", { class: `boton ${peligro ? "boton--peligro" : "boton--principal"}`, type: "button", onclick: () => cerrar(true) }, aceptar)));
    dialogo.onclose = () => resolver(false);
    dialogo.showModal();
  });
}

// Mensaje de una operación que falló. Si fue temporal, reintentar lo mismo no la registra dos veces.
const textoFalla = (error) => (error.temporal ? `${error.mensaje}. Probá de nuevo: no se va a registrar dos veces.` : error.mensaje);

// Diálogo informativo con un solo botón.
function informar({ titulo, texto }) {
  return new Promise((resolver) => {
    dialogo.replaceChildren(
      h("div", { class: "dialogo__cuerpo" }, h("h2", {}, titulo), ...[].concat(texto).map((t) => h("p", {}, t))),
      h("div", { class: "dialogo__acciones" }, h("button", { class: "boton boton--principal", type: "button", onclick: () => dialogo.close() }, "Entendido")));
    dialogo.onclose = () => resolver();
    dialogo.showModal();
  });
}

// ---------------------------------------------------------------------------
// Ingreso con nombre y PIN
// ---------------------------------------------------------------------------

function mensajeIngreso(respuesta) {
  if (respuesta.status === 0 && respuesta.codigo !== "SIN_CLAVE_INGRESO") return "Sin conexión con el servidor. Revisá la red y probá de nuevo.";
  if (respuesta.codigo === "PIN_INCORRECTO") return "PIN incorrecto. Probá de nuevo.";
  if (respuesta.status === 401 || respuesta.status === 403) {
    return respuesta.codigo ? respuesta.mensaje : "Esta instalación no tiene una clave de ingreso válida. Avisá al supervisor.";
  }
  return respuesta.mensaje ?? "No se pudo ingresar";
}

async function vistaIngreso(mensaje = "") {
  if (!window.escritorio) {
    return mostrar(h("div", { class: "tarjeta" }, aviso("error", "Esta pantalla funciona solo dentro de la app Bodega Cosprobell.")));
  }
  mostrar(cargando("Cargando operadores…"));
  const respuesta = await window.escritorio.operadores().catch(() => ({ ok: false, status: 0 }));
  if (!respuesta.ok) {
    return mostrar(h("section", { class: "tarjeta ingreso" },
      aviso("error", mensajeIngreso(respuesta), { role: "alert" }),
      boton("boton--principal", "actualizar", "Reintentar", { onclick: () => vistaIngreso(mensaje) })));
  }
  const operadores = respuesta.data ?? [];
  mostrar(h("section", { class: "ingreso", "aria-labelledby": "titulo-ingreso" },
    h("h1", { id: "titulo-ingreso" }, "¿Quién va a preparar?"),
    h("p", { class: "ingreso__ayuda suave" }, "Tocá tu nombre y escribí tu PIN."),
    mensaje && aviso("alerta", mensaje),
    operadores.length === 0
      ? aviso("alerta", "Todavía no hay operadores. Pedile al supervisor que te dé de alta.")
      : h("ul", { class: "operadores" }, operadores.map((operador) => h("li", {},
        h("button", { class: "operador", type: "button", onclick: () => vistaPin(operador) },
          h("span", { class: "operador__inicial", "aria-hidden": "true" }, operador.nombre.trim().charAt(0).toUpperCase()),
          h("span", { class: "operador__nombre" }, operador.nombre)))))));
}

function vistaPin(operador) {
  let pin = "";
  let enviando = false;
  const puntos = h("div", { class: "pin__puntos", "aria-hidden": "true" }, [0, 1, 2, 3].map(() => h("span", {})));
  const progreso = h("p", { class: "pin__progreso", "aria-live": "polite" });
  const error = aviso("error", "", { role: "alert", hidden: true });
  const teclas = [];
  const tecla = (texto, accion, clase = "", etiqueta = null) => {
    const b = h("button", { class: `pin__tecla ${clase}`.trim(), type: "button", "aria-label": etiqueta, onclick: accion }, texto);
    teclas.push(b);
    return b;
  };

  function pintar() {
    [...puntos.children].forEach((punto, i) => punto.classList.toggle("lleno", i < pin.length));
    progreso.textContent = pin.length ? `${pin.length} de 4 números` : "Escribí tu PIN de 4 números";
    for (const b of teclas) b.disabled = enviando;
  }
  async function enviar() {
    enviando = true; pintar();
    const respuesta = await window.escritorio.ingresar(operador.id, pin).catch(() => ({ ok: false, status: 0 }));
    if (respuesta.ok) {
      estado.ingreso = respuesta.data;
      guardado.escribir("ingreso", respuesta.data);
      api = crearApi({ token: respuesta.data.token, base: estado.servidor });
      actualizarBarra();
      return estado.sesion ? vistaEscaneo() : vistaPedidos();
    }
    pin = ""; enviando = false;
    textoAviso(error, mensajeIngreso(respuesta)); error.hidden = false;
    pintar();
    sonar("error");
  }
  function agregar(digito) {
    if (enviando || pin.length >= 4) return;
    pin += digito; error.hidden = true; pintar();
    if (pin.length === 4) enviar();
  }
  function borrar() { if (!enviando) { pin = pin.slice(0, -1); pintar(); } }

  mostrar(h("section", { class: "ingreso", "aria-labelledby": "titulo-pin" },
    boton("boton--volver", "volver", "Otro nombre", { onclick: () => vistaIngreso() }),
    h("div", { class: "tarjeta pin" },
      h("span", { class: "rotulo" }, "Operador"),
      h("h1", { id: "titulo-pin" }, operador.nombre),
      h("p", { class: "pin__ayuda suave" }, icono("candado"), "Escribí tu PIN de 4 números"),
      puntos, progreso, error,
      h("div", { class: "pin__teclado" },
        ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => tecla(d, () => agregar(d))),
        tecla("Limpiar", () => { if (!enviando) { pin = ""; pintar(); } }, "pin__tecla--texto"),
        tecla("0", () => agregar("0")),
        tecla(icono("borrar"), borrar, "pin__tecla--texto", "Borrar el último número")))));
  // También se puede escribir con el teclado de la PC.
  escuchar(document, "keydown", (evento) => {
    if (dialogo.open || evento.ctrlKey || evento.altKey || evento.metaKey) return;
    if (/^\d$/.test(evento.key)) { evento.preventDefault(); agregar(evento.key); }
    else if (evento.key === "Backspace") { evento.preventDefault(); borrar(); }
    else if (evento.key === "Escape") vistaIngreso();
  });
  pintar();
}

// ---------------------------------------------------------------------------
// Menú: cambiar de operador y opciones del equipo
// ---------------------------------------------------------------------------

async function abrirMenu() {
  const escritorio = window.escritorio;
  const inicioWindows = h("input", { id: "menu-inicio", type: "checkbox" });
  const pantallaCompleta = h("input", { id: "menu-pantalla", type: "checkbox" });
  const version = h("p", { class: "version" });
  const guardarOpciones = () => escritorio?.guardarPreferencias({ iniciarConWindows: inicioWindows.checked, pantallaCompleta: pantallaCompleta.checked }).catch(() => {});
  inicioWindows.addEventListener("change", guardarOpciones);
  pantallaCompleta.addEventListener("change", guardarOpciones);
  escritorio?.obtenerPreferencias().then((p) => {
    inicioWindows.checked = p.iniciarConWindows;
    pantallaCompleta.checked = p.pantallaCompleta;
    version.textContent = `Bodega Cosprobell · versión ${p.version}`;
  }).catch(() => {});

  const nombre = api ? estado.ingreso?.operador?.nombre : null;
  dialogo.replaceChildren(
    h("div", { class: "dialogo__cuerpo menu" },
      h("h2", {}, "Menú"),
      nombre && h("div", { class: "menu__operador" }, icono(esSupervisor() ? "escudo" : "operador"),
        h("div", {}, h("span", { class: "rotulo" }, esSupervisor() ? "Supervisor" : "Operador"), h("strong", {}, nombre))),
      esSupervisor() && boton("boton--principal boton--ancho menu__panel", "escudo", "Panel del supervisor", { onclick: () => { dialogo.close(); vistaSupervisor(); } }),
      nombre && boton("boton--ancho", "salir", "Cambiar de operador", { onclick: cambiarOperador }),
      escritorio && h("fieldset", { class: "opciones" }, h("legend", {}, "Este equipo"),
        h("label", { class: "opcion", for: "menu-inicio" }, inicioWindows, "Abrir la app al iniciar Windows"),
        h("label", { class: "opcion", for: "menu-pantalla" }, pantallaCompleta, "Pantalla completa (F11 para cambiar)")),
      escritorio && version),
    h("div", { class: "dialogo__acciones" }, boton("", null, "Cerrar", { onclick: () => dialogo.close() })));
  dialogo.onclose = null;
  dialogo.showModal();
}

async function cambiarOperador() {
  dialogo.close();
  const pendientes = lecturas?.cola.pendientes ?? 0;
  if (pendientes > 0 && !(await confirmar({ titulo: "Hay lecturas sin enviar",
    texto: [`${pendientes} ${pendientes === 1 ? "lectura queda" : "lecturas quedan"} guardadas en este equipo y se enviarán cuando alguien vuelva a ingresar.`],
    aceptar: "Cambiar de operador" }))) return;
  // Cierra la sesión también en el servidor; si no hay red, vence sola al final del turno.
  api?.cerrarSesion().catch(() => {});
  olvidarIngreso();
  vistaIngreso();
}

// ---------------------------------------------------------------------------
// Lista de pedidos abiertos
// ---------------------------------------------------------------------------

async function vistaPedidos() {
  mostrarAmplio(navegacion("pedidos"), cargando("Cargando pedidos abiertos…"));
  const pedidos = [];
  let cursor = null, paginas = 1, actualizadaEn = Date.now(), falloEn = null;
  try {
    const respuesta = await api.pedidos();
    pedidos.push(...respuesta.data); cursor = respuesta.siguienteCursor;
  } catch (error) { return mostrarError(error, vistaPedidos); }

  const buscador = h("input", { class: "buscador__campo", type: "search", placeholder: "Buscar por número o cliente", "aria-label": "Buscar pedido" });
  const lista = h("ul", { class: "pedidos" });
  const masBoton = boton("boton--ancho", null, "Cargar más pedidos");
  const vacio = h("p", { class: "suave vacio" });
  const contador = h("span", { class: "contador" });
  const actualizado = h("p", { class: "actualizado" });
  // Los pedidos ya preparados van aparte, al final, hasta que SAP los cierra o pasan HORAS_EN_LISTA.
  const listaPreparados = h("ul", { class: "pedidos" });
  const contadorPreparados = h("span", { class: "contador" });
  const seccionPreparados = h("section", { class: "preparados", "aria-labelledby": "titulo-preparados" },
    h("div", { class: "separador" }, h("h2", { id: "titulo-preparados" }, "Preparados"), contadorPreparados,
      h("p", {}, `Salen de la lista cuando SAP cierra el pedido o ${HORAS_EN_LISTA} horas después de prepararse.`)),
    listaPreparados);

  const tarjetaPendiente = (p) => h("li", {},
    h("button", { class: "pedido", type: "button", onclick: () => vistaPedido(p.docEntry) },
      h("div", { class: "pedido__cabeza" },
        h("div", { class: "pedido__numero" }, h("span", { class: "rotulo" }, "Pedido"), " ", String(p.docNum)),
        icono("siguiente", "icono pedido__flecha")),
      h("div", { class: "pedido__cuerpo" },
        h("div", { class: "pedido__cliente" }, p.cliente?.cardName ?? p.cardCode),
        h("div", { class: "pedido__meta" }, `Fecha ${fecha(p.docDate)} · Entrega ${fecha(p.docDueDate)}`),
        h("div", { class: "pedido__meta", "data-sap": p.sincronizadoEn }, `Datos de SAP ${hace(p.sincronizadoEn)}`))));
  function tarjetaPreparado(p) {
    const textos = textosPreparado(p.preparado);
    return h("li", {},
      h("button", { class: `pedido ${textos.completo ? "pedido--preparado" : "pedido--diferencias"}`, type: "button", onclick: () => verResumen(p) },
        h("div", { class: "pedido__cabeza" },
          h("div", { class: "pedido__numero" }, h("span", { class: "rotulo" }, "Pedido"), " ", String(p.docNum)),
          h("span", { class: "pedido__ver" }, "Ver resumen", icono("siguiente"))),
        h("div", { class: "pedido__cuerpo" },
          h("div", { class: "pedido__estado" }, h("span", { class: `insignia ${textos.completo ? "insignia--ok" : "insignia--alerta"}` },
            icono(textos.completo ? "completa" : "alerta"), textos.estado)),
          h("div", { class: "pedido__cliente" }, p.cliente?.cardName ?? p.cardCode),
          textos.quien && h("div", { class: "pedido__quien" }, textos.quien),
          h("div", { class: "pedido__meta" }, textos.unidades))));
  }

  const enLista = (p) => !p.preparado || sigueEnLista(p.preparado);
  let vencidosPintados = 0;
  function pintar() {
    const filtro = buscador.value.trim().toLowerCase();
    const vigentes = pedidos.filter(enLista);
    vencidosPintados = pedidos.length - vigentes.length;
    const visibles = vigentes.filter((p) => !filtro || String(p.docNum).includes(filtro) || (p.cliente?.cardName ?? "").toLowerCase().includes(filtro));
    const pendientes = visibles.filter((p) => !p.preparado);
    const preparados = visibles.filter((p) => p.preparado);
    lista.replaceChildren(...pendientes.map(tarjetaPendiente));
    listaPreparados.replaceChildren(...preparados.map(tarjetaPreparado));
    lista.hidden = pendientes.length === 0;
    seccionPreparados.hidden = preparados.length === 0;
    contadorPreparados.textContent = String(preparados.length);
    contadorPreparados.setAttribute("aria-label", `${preparados.length} pedidos preparados`);
    contador.textContent = `${vigentes.length}${cursor === null ? "" : "+"}`;
    contador.setAttribute("aria-label", `${contador.textContent} pedidos cargados`);
    vacio.textContent = !vigentes.length ? "No hay pedidos abiertos."
      : !visibles.length ? "Ningún pedido coincide con la búsqueda."
        : !pendientes.length && !filtro ? "Todos los pedidos abiertos ya están preparados." : "";
    vacio.hidden = !vacio.textContent;
    masBoton.hidden = cursor === null;
    pintarActualizado();
  }

  // Cuándo se pidió la lista y cuándo llegaron los últimos datos de SAP (el puente actualiza sincronizadoEn de
  // cada pedido abierto en cada recorrido, aunque no haya cambiado).
  function pintarActualizado() {
    const sap = pedidos.reduce((ultimo, p) => Math.max(ultimo, Date.parse(p.sincronizadoEn) || 0), 0);
    const sapViejo = sap > 0 && datosViejos(new Date(sap).toISOString());
    poner(actualizado,
      falloEn === null
        ? h("span", {}, icono("actualizar"), `Actualizada a las ${horaCorta(actualizadaEn)} · se actualiza sola cada ${MINUTOS_REFRESCO} min`)
        : h("span", { class: "actualizado__alerta" }, icono("alerta"),
          `No se pudo actualizar a las ${horaCorta(falloEn)}: se muestra la lista de las ${horaCorta(actualizadaEn)}`),
      sap > 0 && h("span", sapViejo ? { class: "actualizado__alerta" } : {}, sapViejo && icono("alerta"),
        `Datos de SAP ${hace(new Date(sap).toISOString())}`));
  }

  // Una sola carga a la vez: la actualización automática y "Cargar más" no se pisan.
  let ocupado = false, vigente = true;
  async function recargar() {
    if (ocupado) return;
    ocupado = true;
    try {
      const nuevos = [];
      let siguiente = null;
      for (let pagina = 0; pagina < paginas; pagina++) {
        const respuesta = await api.pedidos(siguiente);
        nuevos.push(...respuesta.data); siguiente = respuesta.siguienteCursor;
        if (siguiente === null) break;
      }
      if (!vigente) return;
      pedidos.splice(0, pedidos.length, ...nuevos); cursor = siguiente;
      actualizadaEn = Date.now(); falloEn = null;
      pintar();
    } catch (error) {
      if (!vigente) return;
      if (error.status === 401) return mostrarError(error);
      falloEn = Date.now(); pintarActualizado();
    } finally { ocupado = false; }
  }

  buscador.addEventListener("input", pintar);
  masBoton.addEventListener("click", async () => {
    if (ocupado) return;
    ocupado = true; masBoton.disabled = true;
    try {
      const respuesta = await api.pedidos(cursor);
      pedidos.push(...respuesta.data); cursor = respuesta.siguienteCursor; paginas++;
      pintar();
    } catch (error) { if (error.status === 401) return mostrarError(error); }
    finally { ocupado = false; masBoton.disabled = false; }
  });

  const abierta = estado.sesion && aviso("alerta", `Tenés una preparación abierta: pedido ${estado.sesion.docNum ?? estado.sesion.docEntry}.`, {},
    boton("boton--principal", "escaner", "Continuar", { onclick: () => vistaEscaneo() }));

  mostrarAmplio(navegacion("pedidos"),
    h("div", { class: "encabezado" },
      h("div", {}, h("div", { class: "encabezado__titulo" }, h("h1", {}, "Pedidos abiertos"), contador), actualizado),
      boton("", "actualizar", "Actualizar", { onclick: () => vistaPedidos() })),
    abierta, h("label", { class: "buscador" }, icono("buscar"), buscador), vacio, lista, seccionPreparados, masBoton);
  pintar();
  // Cada minuto: un preparado que cumplió las horas sale (solo se repinta la lista si cambió algo) y se
  // actualiza el "hace N min". Cada MINUTOS_REFRESCO se vuelve a pedir la lista al servidor.
  const reloj = setInterval(() => {
    if (pedidos.length - pedidos.filter(enLista).length !== vencidosPintados) return pintar();
    pintarActualizado();
    for (const meta of lista.querySelectorAll("[data-sap]")) meta.textContent = `Datos de SAP ${hace(meta.dataset.sap)}`;
  }, 60_000);
  const refresco = setInterval(recargar, MINUTOS_REFRESCO * 60_000);
  limpiezas.push(() => { vigente = false; clearInterval(reloj); clearInterval(refresco); });
}

// Un pedido ya preparado abre su resumen; no se puede empezar otra preparación hasta que SAP lo cierre.
async function verResumen(p) {
  mostrar(cargando("Cargando resumen…"));
  try {
    const [pedido, sesion] = await Promise.all([api.pedido(p.docEntry).then(pedidoConNombres), api.sesion(p.preparado.pickingId).then((r) => r.data)]);
    vistaResumen(sesion, pedido);
  } catch (error) { mostrarError(error, () => verResumen(p)); }
}

// ---------------------------------------------------------------------------
// Detalle del pedido e inicio de la preparación
// ---------------------------------------------------------------------------

// Hasta esta cantidad se dibuja una casilla por unidad; con más, basta el número.
const MAXIMO_CASILLAS = 24;

function tarjetaLinea(linea, nombre, { pedida, escaneada = null, reciente = false }) {
  const completa = escaneada !== null && escaneada >= pedida;
  const casillas = escaneada !== null && pedida <= MAXIMO_CASILLAS &&
    h("div", { class: "unidades", "aria-hidden": "true" },
      Array.from({ length: pedida }, (_, i) => h("span", { class: i < escaneada ? "lleno" : null })));
  return h("li", { class: `linea${completa ? " linea--completa" : ""}${reciente ? " linea--reciente" : ""}`, "data-linea": linea },
    h("div", { class: "linea__nombre" }, nombre.itemName ?? nombre.itemCode),
    h("div", { class: "linea__detalle" }, h("span", { class: "codigo" }, nombre.itemCode),
      [nombre.uomCode && `Unidad ${nombre.uomCode}`, nombre.warehouseCode && `Bodega ${nombre.warehouseCode}`].filter(Boolean).join(" · ")),
    nombre.combo && h("div", { class: "linea__combo" }, icono("combo"), `Del combo ${nombre.combo}`),
    h("div", { class: "linea__cantidad" },
      escaneada === null ? cantidad(pedida) : [cantidad(escaneada), h("span", { class: "linea__total" }, ` / ${cantidad(pedida)}`)],
      completa ? h("span", { class: "insignia insignia--ok" }, icono("completa"), "Completa")
        : h("small", {}, escaneada === null ? "a preparar" : `faltan ${cantidad(pedida - escaneada)}`)),
    casillas);
}

async function vistaPedido(docEntry) {
  mostrar(cargando("Cargando pedido…"));
  let respuesta;
  try { respuesta = await api.pedido(docEntry); } catch (error) { return mostrarError(error, () => vistaPedido(docEntry)); }
  const { preparacion } = respuesta;
  const pedido = pedidoConNombres(respuesta);
  const problema = aviso("error", preparacion.message ?? "", { role: "alert", hidden: preparacion.datosValidos });
  const empezar = boton("boton--principal boton--ancho boton--grande", "escaner", "Empezar preparación", { disabled: !preparacion.datosValidos });
  empezar.addEventListener("click", async () => {
    empezar.disabled = true; problema.hidden = true;
    try {
      const { data: sesion } = await api.iniciar(pedido.docEntry);
      guardarSesion({ pickingId: sesion.id, docEntry: pedido.docEntry, docNum: pedido.docNum });
      vistaEscaneo();
    } catch (error) {
      if (error.status === 401) return mostrarError(error);
      textoAviso(problema, error.mensaje); problema.hidden = false; empezar.disabled = false;
    }
  });
  const lineasPorNumero = new Map(pedido.lineas.map((l) => [l.lineNum, l]));
  const aPreparar = preparacion.datosValidos ? preparacion.lineas : [];
  mostrar(
    boton("boton--volver", "volver", "Pedidos", { onclick: () => vistaPedidos() }),
    h("div", { class: "encabezado" }, tituloPedido(pedido.docNum)),
    h("div", { class: "tarjeta detalle-pedido" }, h("span", { class: "rotulo" }, "Cliente"),
      h("div", { class: "pedido__cliente" }, pedido.cliente?.cardName ?? pedido.cardCode),
      h("div", { class: "pedido__meta" }, `Fecha ${fecha(pedido.docDate)} · Entrega ${fecha(pedido.docDueDate)}`),
      h("div", { class: "pedido__meta" }, `Datos de SAP ${hace(pedido.sincronizadoEn)}`)),
    datosViejos(pedido.sincronizadoEn) && aviso("alerta",
      "Los datos de este pedido tienen más de una hora sin actualizarse desde SAP. Confirmá con el supervisor antes de preparar."),
    problema,
    aPreparar.length > 0 && h("h2", {}, "A preparar"),
    h("ul", { class: "lineas" }, aPreparar.map((l) =>
      tarjetaLinea(l.pedidoLineNum, datosLinea(l, lineasPorNumero, pedido.nombres), { pedida: l.cantidadPedida }))),
    empezar);
}

// ---------------------------------------------------------------------------
// Escaneo
// ---------------------------------------------------------------------------

async function vistaEscaneo() {
  const { pickingId, docEntry } = estado.sesion;
  mostrar(cargando("Abriendo preparación…"));
  let pedido, sesion;
  try {
    [pedido, sesion] = await Promise.all([api.pedido(docEntry).then(pedidoConNombres), api.sesion(pickingId).then((r) => r.data)]);
  } catch (error) {
    if (error.status === 404) { guardarSesion(null); return vistaPedidos(); }
    return mostrarError(error, vistaEscaneo);
  }
  if (sesion.estado === "completo" || sesion.estado === "con_diferencias") {
    guardarSesion(null);
    return vistaResumen(sesion, pedido);
  }
  if (sesion.estado === "anulada") {
    guardarSesion(null);
    guardado.borrar(`cola.${pickingId}`);
    lecturas = null;
    return mostrar(h("div", { class: "tarjeta" },
      aviso("alerta", `El supervisor reinició la preparación del pedido ${pedido.docNum} porque SAP cambió el pedido. Empezala de nuevo desde la lista.`),
      boton("boton--principal", "lista", "Ver pedidos", { onclick: () => vistaPedidos() })));
  }
  guardarSesion({ ...estado.sesion, docNum: pedido.docNum });
  const lineasPedido = new Map(pedido.lineas.map((l) => [l.lineNum, l]));
  let lineaReciente = null;

  const resultado = h("div", { class: "resultado", role: "status", "aria-live": "assertive" });
  const envio = h("div", { class: "envio" });
  const barra = h("div", { class: "progreso__barra" });
  const progreso = h("div", { class: "progreso", role: "progressbar", "aria-label": "Avance de la preparación",
    "aria-valuemin": "0", "aria-valuemax": "100" }, barra);
  const resumen = h("div", { class: "fila fila--entre resumen" });
  const bloqueo = aviso("error", "", { role: "alert", hidden: true });
  const desconexion = h("div", { class: "aviso aviso--alerta", hidden: true });
  const lista = h("ul", { class: "lineas" });
  const entrada = h("input", { class: "entrada-escaneo", inputmode: "none", autocomplete: "off", autocapitalize: "off",
    spellcheck: "false", enterkeyhint: "send", "aria-label": "Código escaneado", placeholder: "Esperando lectura…" });
  const teclado = boton("boton--teclado", "teclado", h("span", { class: "boton__texto" }, "Teclado"), { title: "Mostrar u ocultar el teclado en pantalla" });
  teclado.addEventListener("click", () => {
    entrada.setAttribute("inputmode", entrada.getAttribute("inputmode") === "none" ? "text" : "none");
    entrada.blur(); entrada.focus();
  });

  function pintar() {
    const lineas = [...sesion.lineas].sort((a, b) => a.pedidoLineNum - b.pedidoLineNum);
    const total = lineas.reduce((s, l) => s + l.cantidadPedida, 0);
    const hechas = lineas.reduce((s, l) => s + Math.min(l.cantidadEscaneada, l.cantidadPedida), 0);
    const porcentaje = total ? Math.round((hechas / total) * 100) : 0;
    barra.style.transform = `scaleX(${porcentaje / 100})`;
    progreso.setAttribute("aria-valuenow", String(porcentaje));
    progreso.classList.toggle("progreso--completo", porcentaje === 100);
    resumen.replaceChildren(
      h("strong", {}, `${cantidad(hechas)} de ${cantidad(total)} unidades`),
      h("span", { class: "suave" }, pendientesTexto(lineas.filter((l) => l.cantidadEscaneada < l.cantidadPedida).length)));
    // Primero las pendientes; las completas quedan al final.
    const orden = [...lineas].sort((a, b) => (a.cantidadEscaneada >= a.cantidadPedida) - (b.cantidadEscaneada >= b.cantidadPedida));
    lista.replaceChildren(...orden.map((l) => tarjetaLinea(l.pedidoLineNum, datosLinea(l, lineasPedido, pedido.nombres),
      { pedida: l.cantidadPedida, escaneada: l.cantidadEscaneada, reciente: l.id === lineaReciente })));
    const activa = sesion.estado === "en_proceso";
    entrada.disabled = !activa;
    bloqueo.hidden = activa;
    if (sesion.estado === "requiere_revision") {
      textoAviso(bloqueo, "SAP modificó este pedido mientras se preparaba. No se puede seguir escaneando: avisá al supervisor.");
    } else if (!activa) {
      textoAviso(bloqueo, `La preparación está en estado "${sesion.estado}".`);
    }
  }

  // Cada lectura cambia el recuadro con un destello breve: dos rechazos iguales seguidos también se notan.
  const movimientoReducido = matchMedia("(prefers-reduced-motion: reduce)");
  function mostrarResultado(tipo, titulo, detalle = "") {
    resultado.className = `resultado resultado--${tipo ?? "espera"}`;
    resultado.replaceChildren(tipo ? icono(tipo === "ok" ? "aceptada" : "rechazada") : h("span", { class: "resultado__laser" }, icono("escaner")),
      h("div", { class: "resultado__texto" }, h("span", { class: "resultado__titulo" }, titulo), detalle && h("small", {}, detalle)));
    if (tipo) {
      resultado.animate?.(movimientoReducido.matches
        ? [{ opacity: 0.6 }, { opacity: 1 }]
        : [{ opacity: 0.6, transform: "scale(0.98)" }, { opacity: 1, transform: "none" }], { duration: 180, easing: "ease-out" });
    }
  }
  mostrarResultado(null, "Escaneá el primer producto.");

  async function refrescarSesion() {
    try { sesion = (await api.sesion(pickingId)).data; pintar(); } catch { /* se reintenta en la próxima lectura */ }
  }

  function nombreDe(linea) {
    return datosLinea(linea, lineasPedido, pedido.nombres).itemName ?? linea.itemCode;
  }

  const registro = colaDe(pickingId);
  const cola = registro.cola;
  function alCambiar(evento) {
      const { tipo, lectura, enCola } = evento;
      if (tipo === "enviando") envio.textContent = `Enviando ${lectura.codigo}…${enCola > 1 ? ` (${enCola - 1} en espera)` : ""}`;
      if (tipo === "reintentando") envio.textContent = `Sin respuesta; reintento ${evento.intento} de ${lectura.codigo}…`;
      if (tipo === "aceptada" || tipo === "rechazada") envio.textContent = enCola ? `${enCola} lecturas en espera` : "";
      if (tipo === "aceptada") {
        const linea = evento.respuesta.data;
        sesion.lineas = sesion.lineas.map((l) => (l.id === linea.id ? { ...l, ...linea } : l));
        lineaReciente = linea.id;
        desconexion.hidden = true;
        pintar();
        mostrarResultado("ok", nombreDe(linea),
          `${cantidad(linea.cantidadEscaneada)} de ${cantidad(linea.cantidadPedida)}${linea.cantidadEscaneada >= linea.cantidadPedida ? " · línea completa" : ""}`);
        sonar("ok");
      }
      if (tipo === "rechazada") {
        mostrarResultado("error", evento.error.mensaje, `Código ${lectura.codigo}`);
        sonar("error");
        refrescarSesion();
      }
      if (tipo === "detenida") {
        if (evento.error?.status === 401) return mostrarError(evento.error);
        desconexion.hidden = false;
        desconexion.replaceChildren(icono("sinRed"),
          h("span", { class: "aviso__texto" }, `Sin conexión. ${enCola} ${enCola === 1 ? "lectura pendiente" : "lecturas pendientes"}: se enviarán al reconectar, sin contarse dos veces.`),
          boton("", "actualizar", "Reintentar ahora", { onclick: () => cola.reanudar() }));
        sonar("error");
      }
  }

  const formulario = h("form", { class: "fila formulario-escaneo", onsubmit: (evento) => {
    evento.preventDefault();
    const codigo = entrada.value.trim();
    entrada.value = "";
    if (codigo) cola.agregar(codigo);
  } }, h("div", { class: "crecer campo-escaneo" }, icono("escaner"), entrada), teclado);
  const cabezaLector = h("div", { class: "escaneo__cabeza" }, h("span", { class: "rotulo" }, "Lector"),
    h("span", { class: "escaneo__estado escaneo__estado--listo" }, "Listo para leer"),
    h("span", { class: "escaneo__estado escaneo__estado--sin-foco" }, "Tocá el campo para leer"));

  // El lector escribe como un teclado: la entrada debe tener el foco salvo que haya un diálogo abierto.
  const enfocar = () => { if (!dialogo.open && !entrada.disabled && document.activeElement !== entrada) entrada.focus({ preventScroll: true }); };
  // Vuelve enseguida: si el foco queda en un botón, el Enter del lector lo activaría.
  entrada.addEventListener("blur", () => setTimeout(enfocar, 0));

  const verLecturas = () => mostrarLecturas(pickingId);
  async function finalizar() {
    if (cola.pendientes > 0) {
      mostrarResultado("error", "Hay lecturas sin enviar", "Esperá a que se envíen antes de finalizar.");
      return;
    }
    const faltantes = sesion.lineas.filter((l) => l.cantidadEscaneada < l.cantidadPedida);
    const unidades = faltantes.reduce((s, l) => s + (l.cantidadPedida - l.cantidadEscaneada), 0);
    const ok = await confirmar(faltantes.length === 0
      ? { titulo: "Finalizar preparación", texto: "Todas las líneas están completas.", aceptar: "Finalizar" }
      : { titulo: "Finalizar con faltantes", peligro: true, aceptar: "Finalizar con diferencias",
          texto: [`Faltan ${cantidad(unidades)} unidades en ${faltantes.length} ${faltantes.length === 1 ? "línea" : "líneas"}.`,
            ...faltantes.map((l) => `• ${nombreDe(l)}: faltan ${cantidad(l.cantidadPedida - l.cantidadEscaneada)}`)] });
    if (!ok) return enfocar();
    // Lo preparado sale de la bodega pequeña al finalizar: tiene que estar registrado ahí y, si hay varios lotes,
    // se indica de cuál salió cada unidad.
    const despacho = await prepararDespacho(sesion.lineas);
    if (!despacho) return enfocar();
    try {
      const { data } = await api.finalizar(pickingId, despacho.lotes);
      guardarSesion(null);
      guardado.borrar(`cola.${pickingId}`);
      lecturas = null;
      vistaResumen(data, pedido);
    } catch (error) {
      if (error.status === 401) return mostrarError(error);
      mostrarResultado("error", error.mensaje);
      refrescarSesion();
    }
  }

  mostrarAmplio(
    h("div", { class: "encabezado" }, h("div", {},
      tituloPedido(pedido.docNum),
      h("div", { class: "encabezado__sub" }, pedido.cliente?.cardName ?? pedido.cardCode))),
    datosViejos(pedido.sincronizadoEn) && aviso("alerta",
      `Datos de SAP ${hace(pedido.sincronizadoEn)}. Confirmá con el supervisor si el pedido sigue igual.`),
    bloqueo, desconexion,
    h("div", { class: "escaneo-layout" },
      h("section", { class: "escaneo", "aria-label": "Lectura de códigos" }, cabezaLector, formulario, resultado, envio, progreso, resumen),
      h("section", { "aria-label": "Líneas del pedido" },
        lista,
        h("div", { class: "acciones" },
          boton("", "lista", "Ver lecturas", { onclick: verLecturas }),
          boton("boton--principal", "finalizar", "Finalizar", { onclick: finalizar }),
          boton("", "salir", "Salir", { onclick: () => vistaPedidos() })))));
  pintar();
  // Escuchadores de esta vista: se retiran al cambiar de vista (mostrar()).
  registro.alCambiar = alCambiar;
  limpiezas.push(() => { registro.alCambiar = () => {}; });
  // Mientras no haya conexión se reintenta solo cada 15 segundos y al volver la red.
  const vigilante = setInterval(() => { if (cola.detenida) cola.reanudar(); }, 15000);
  limpiezas.push(() => clearInterval(vigilante));
  escuchar(window, "online", () => cola.reanudar());
  escuchar(document, "click", (evento) => { if (!evento.target.closest("button, a, input")) enfocar(); });
  enfocar();
  if (cola.pendientes) envio.textContent = `${cola.pendientes} lecturas pendientes de enviar…`;
  cola.reanudar();
}

// Antes de cerrar una preparación: revisa la bodega pequeña de cada producto escaneado. Devuelve { lotes } para
// enviar al finalizar, o null si falta mercadería o se canceló la elección de lotes.
async function prepararDespacho(lineas) {
  const porProducto = unidadesPorProducto(lineas);
  if (!porProducto.size) return { lotes: [] };
  let fichas;
  try {
    fichas = new Map((await Promise.all([...porProducto.keys()].map((itemCode) => api.producto(itemCode).then((r) => r.data))))
      .map((p) => [p.itemCode, p]));
  } catch (error) {
    if (error.status === 401) { mostrarError(error); return null; }
    return { lotes: [] }; // Sin poder revisar, el servidor decide al finalizar.
  }
  const { faltantes, elegir } = revisarDespacho(porProducto, fichas);
  if (faltantes.length) {
    const de = bodegaNombre("grande", { corto: true }), a = bodegaNombre("pequena", { corto: true });
    // Si SAP ya registró el traspaso y falta aceptarlo, alcanza con aceptarlo; si no, falta el traspaso en SAP.
    const porAceptar = (f) => fichas.get(f.itemCode)?.porPasar ?? 0;
    await informar({ titulo: `Falta mercadería en ${a}`, texto: [
      `No se puede finalizar hasta que ${a} tenga lo necesario:`,
      ...faltantes.map((f) => `• ${f.itemName}: hay ${cantidad(f.hay)} en ${a} y se necesitan ${cantidad(f.necesarias)}. `
        + (porAceptar(f) > 0 ? `SAP ya pasó ${cantidad(porAceptar(f))} desde ${de}: aceptalo en Inventario → Traspasos por aceptar.`
          : `Falta el traspaso en SAP de ${de} a ${a}.`)),
      "La preparación queda abierta con lo escaneado." ] });
    return null;
  }
  return elegir.length ? elegirLotesDespacho(elegir) : { lotes: [] };
}

// Varios lotes en la pequeña: la persona que preparó indica de cuál sacó cada unidad (el código de barras no lo dice).
function elegirLotesDespacho(elegir) {
  return new Promise((resolver) => {
    let resuelto = false;
    const cerrar = (valor) => { resuelto = true; dialogo.close(); resolver(valor); };
    const error = aviso("error", "", { role: "alert", hidden: true });
    const entradas = [];
    const bloques = elegir.map((p) => h("fieldset", { class: "despacho-producto" },
      h("legend", {}, `${p.itemName} · salen ${cantidad(p.necesarias)}`),
      h("ul", { class: "despacho-lotes" }, p.lotes.map((l) => {
        const id = `despacho-${entradas.length}`;
        const entrada = h("input", { id, class: "campo campo--numero", type: "number", min: "0", max: String(l.unidades), inputmode: "numeric", placeholder: "0" });
        entradas.push({ itemCode: p.itemCode, loteId: l.id, entrada });
        return h("li", {}, h("label", { for: id }, h("strong", {}, l.lote ? `Lote ${l.lote}` : "Sin lote"),
          h("span", { class: "suave" }, `${textoVencimiento(l.vencimiento)} · hay ${cantidad(l.unidades)}`)), entrada);
      }))));
    const leer = () => {
      const asignado = {};
      for (const e of entradas) (asignado[e.itemCode] ??= {})[e.loteId] = e.entrada.value === "" ? 0 : Number(e.entrada.value);
      return asignado;
    };
    dialogo.replaceChildren(h("form", { class: "dialogo__formulario", onsubmit: (evento) => {
      evento.preventDefault();
      const r = armarLotesDespacho(elegir, leer());
      if (r.problema) { textoAviso(error, r.problema); error.hidden = false; return; }
      cerrar(r);
    } },
    h("div", { class: "dialogo__cuerpo" }, h("h2", {}, "¿De qué lote salieron?"),
      h("p", {}, `Estos productos tienen más de un lote en ${bodegaNombre("pequena", { corto: true })}. Escribí cuántas unidades tomaste de cada lote.`),
      error, bloques),
    h("div", { class: "dialogo__acciones" },
      h("button", { class: "boton", type: "button", onclick: () => cerrar(null) }, "Cancelar"),
      h("button", { class: "boton boton--principal", type: "submit" }, "Finalizar"))));
    dialogo.onclose = () => { if (!resuelto) resolver(null); };
    dialogo.showModal();
    entradas[0]?.entrada.focus();
  });
}

// Historial de lecturas de una preparación (escaneo y panel del supervisor).
async function mostrarLecturas(pickingId) {
  dialogo.replaceChildren(h("div", { class: "dialogo__cuerpo" }, cargando("Cargando lecturas…")));
  dialogo.showModal();
  const lecturas = [];
  try {
    let despuesDe = null;
    do {
      const pagina = await api.escaneos(pickingId, despuesDe);
      lecturas.push(...pagina.data); despuesDe = pagina.siguienteCursor;
    } while (despuesDe !== null);
  } catch (error) {
    dialogo.replaceChildren(h("div", { class: "dialogo__cuerpo" }, aviso("error", error.mensaje)),
      h("div", { class: "dialogo__acciones" }, boton("", null, "Cerrar", { onclick: () => dialogo.close() })));
    return;
  }
  dialogo.replaceChildren(
    h("div", { class: "dialogo__cuerpo" }, h("h2", {}, `Lecturas (${lecturas.length})`),
      lecturas.length === 0 ? h("p", { class: "suave" }, "Todavía no hay lecturas.") :
        h("ul", { class: "historial" }, lecturas.reverse().map((l) => h("li", {},
          l.resultado === "aceptado" ? icono("aceptada", "icono historial__ok") : icono("rechazada", "icono historial__error"),
          h("span", {}, `${l.resultado === "aceptado" ? "Aceptada" : "Rechazada"} · ${new Date(l.creadoEn).toLocaleTimeString("es-HN")} · ${l.codigo}`),
          h("div", { class: "suave" }, l.resultado === "aceptado"
            ? `${l.itemCode ?? ""} · quedó en ${cantidad(l.cantidadDespues)}` : (l.errorMessage ?? "Rechazada")))))),
    h("div", { class: "dialogo__acciones" }, boton("", null, "Cerrar", { onclick: () => dialogo.close() })));
}

// ---------------------------------------------------------------------------
// Resumen al finalizar
// ---------------------------------------------------------------------------

function vistaResumen(sesion, pedido, volver = { texto: "Volver a pedidos", accion: () => vistaPedidos() }) {
  const lineasPedido = new Map(pedido.lineas.map((l) => [l.lineNum, l]));
  const faltantes = sesion.lineas.filter((l) => l.cantidadEscaneada < l.cantidadPedida);
  const completo = sesion.estado === "completo";
  const pedidas = sesion.lineas.reduce((s, l) => s + l.cantidadPedida, 0);
  const preparadas = sesion.lineas.reduce((s, l) => s + Math.min(l.cantidadEscaneada, l.cantidadPedida), 0);
  const dato = (titulo, valor, cifra = false) => h("div", {}, h("dt", {}, titulo), h("dd", { class: cifra ? "datos__cifra" : null }, valor));
  mostrar(
    h("div", { class: "encabezado" }, h("div", {}, tituloPedido(pedido.docNum),
      h("div", { class: "encabezado__sub" }, pedido.cliente?.cardName ?? pedido.cardCode))),
    h("section", { class: `tarjeta cierre ${completo ? "cierre--completo" : "cierre--diferencias"}`, "aria-label": "Resumen de la preparación" },
      h("div", { class: "cierre__cabeza" },
        h("div", { class: "cierre__icono" }, icono(completo ? "aceptada" : "alerta")),
        h("div", {},
          h("div", { class: "cierre__estado" }, h("span", { class: "rotulo" }, "Estado de la preparación"),
            h("span", { class: `insignia ${completo ? "insignia--ok" : "insignia--alerta"}` }, completo ? "Completa" : "Con diferencias")),
          h("p", { class: "cierre__titulo" }, completo ? "Preparación completa." : "Preparación finalizada con diferencias."))),
      h("dl", { class: "datos" },
        dato("Unidades preparadas", `${cantidad(preparadas)} de ${cantidad(pedidas)}`, true),
        dato("Líneas completas", `${sesion.lineas.length - faltantes.length} de ${sesion.lineas.length}`, true),
        sesion.usuarioId && dato("Operador", sesion.usuarioId),
        sesion.fechaInicio && dato("Inicio", fechaHora(sesion.fechaInicio)),
        sesion.fechaFin && dato("Fin", fechaHora(sesion.fechaFin)))),
    faltantes.length > 0 && h("div", { class: "tarjeta" }, h("h2", {}, "Faltantes"),
      h("ul", { class: "lineas" }, faltantes.map((l) => tarjetaLinea(l.pedidoLineNum, datosLinea(l, lineasPedido, pedido.nombres),
        { pedida: l.cantidadPedida, escaneada: l.cantidadEscaneada })))),
    boton("boton--principal boton--ancho boton--grande", "volver", volver.texto, { onclick: volver.accion }));
}

// ---------------------------------------------------------------------------
// Panel del supervisor: etiquetas, operadores, revisiones, sincronización, almacenes y reportes
// ---------------------------------------------------------------------------

const numero = (valor) => Number(valor).toLocaleString("es-HN");

// Formulario en el diálogo. Resuelve los datos escritos o null si se cancela.
function pedirDatos({ titulo, texto = null, campos, aceptar, validar = () => null }) {
  return new Promise((resolver) => {
    let resuelto = false;
    const cerrar = (valor) => { resuelto = true; dialogo.close(); resolver(valor); };
    const error = aviso("error", "", { role: "alert", hidden: true });
    const entradas = campos.map((c) => ({ ...c, el: c.tipo === "casilla"
      ? h("input", { id: `campo-${c.nombre}`, type: "checkbox" })
      : h("input", { id: `campo-${c.nombre}`, class: "campo", type: c.tipo ?? "text", inputmode: c.inputmode, maxlength: c.maxlength,
        autocomplete: "off", spellcheck: "false" }) }));
    const leer = () => Object.fromEntries(entradas.map((c) => [c.nombre, c.tipo === "casilla" ? c.el.checked : c.el.value.trim()]));
    dialogo.replaceChildren(h("form", { class: "dialogo__formulario", onsubmit: (evento) => {
      evento.preventDefault();
      const datos = leer();
      const problema = validar(datos);
      if (problema) { textoAviso(error, problema); error.hidden = false; return; }
      cerrar(datos);
    } },
    h("div", { class: "dialogo__cuerpo" }, h("h2", {}, titulo), texto && h("p", {}, texto), error,
      entradas.map((c) => (c.tipo === "casilla"
        ? h("label", { class: "opcion", for: c.el.id }, c.el, c.etiqueta)
        : h("label", { class: "campo-etiqueta", for: c.el.id }, h("span", {}, c.etiqueta), c.el, c.ayuda && h("small", { class: "suave" }, c.ayuda))))),
    h("div", { class: "dialogo__acciones" },
      h("button", { class: "boton", type: "button", onclick: () => cerrar(null) }, "Cancelar"),
      h("button", { class: "boton boton--principal", type: "submit" }, aceptar))));
    dialogo.onclose = () => { if (!resuelto) resolver(null); };
    dialogo.showModal();
    entradas[0]?.el.focus();
  });
}

const PESTANAS = [
  { id: "etiquetas", icono: "etiqueta", texto: "Etiquetas", contar: (r) => r.etiquetas.sinConfirmar + r.etiquetas.desactualizadas },
  { id: "operadores", icono: "personas", texto: "Operadores", contar: (r) => r.operadores.bloqueados },
  { id: "revisiones", icono: "alerta", texto: "Revisiones", contar: (r) => r.revisiones.enRevision + r.revisiones.conDiferencias + r.revisiones.sinEntrega },
  { id: "sincronizacion", icono: "sincronizar", texto: "Sincronización" },
  { id: "almacenes", icono: "bodega", texto: "Almacenes", contar: (r) => (r.almacenes?.elegidos === 0 ? 1 : 0) },
  { id: "reportes", icono: "lista", texto: "Reportes" },
];

async function vistaSupervisor(pestana = "etiquetas") {
  if (!esSupervisor()) return vistaPedidos();
  const nav = h("nav", { class: "pestanas", "aria-label": "Secciones del panel" });
  const mensaje = h("div", { class: "panel__mensaje", "aria-live": "polite" });
  const contenido = h("div", { class: "panel" }, cargando("Cargando…"));
  let resumen = null;
  function pintarPestanas() {
    nav.replaceChildren(...PESTANAS.map((p) => {
      const n = resumen && p.contar ? p.contar(resumen) : 0;
      return h("button", { class: "pestana", type: "button", "aria-current": p.id === pestana ? "page" : null, onclick: () => vistaSupervisor(p.id) },
        icono(p.icono), p.texto, n > 0 && h("span", { class: "contador contador--alerta", "aria-label": `${n} pendientes` }, numero(n)));
    }));
  }
  // Mensaje de la última acción (éxito o problema) arriba del contenido.
  const avisar = (tipo, texto, extra = null) => mensaje.replaceChildren(texto ? aviso(tipo, texto, { role: tipo === "error" ? "alert" : "status" }) : "", extra ?? "");
  const panel = {
    contenido, avisar,
    async refrescar() {
      try { resumen = (await api.resumenSupervisor()).data; pintarPestanas(); } catch (error) { panel.fallo(error); }
      return resumen;
    },
    // Sesión vencida o sin permiso: fuera del panel. El resto, aviso en el panel.
    fallo(error, reintentar = null) {
      if (error?.status === 401 || error?.status === 403) return mostrarError(error);
      avisar("error", error?.mensaje ?? "Ocurrió un error inesperado",
        reintentar && boton("", "actualizar", "Reintentar", { onclick: () => { avisar(null, ""); reintentar(); } }));
      return null;
    },
  };
  pintarPestanas();
  mostrarAmplio(navegacion("panel"),
    h("div", { class: "encabezado" }, h("h1", {}, "Panel del supervisor")), nav, mensaje, contenido);
  await panel.refrescar();
  const secciones = { etiquetas: panelEtiquetas, operadores: panelOperadores, revisiones: panelRevisiones, sincronizacion: panelSincronizacion,
    almacenes: panelAlmacenes, reportes: panelReportes };
  await secciones[pestana](panel);
}

const insignia = (tipo, nombreIcono, texto) => h("span", { class: `insignia insignia--${tipo}` }, nombreIcono && icono(nombreIcono), texto);

function filaAdmin({ clase = "", nombre, detalle = [], dato, acciones = [], nota = null }) {
  return h("li", { class: `fila-admin ${clase}`.trim() },
    h("div", {}, h("div", { class: "fila-admin__nombre" }, nombre), h("div", { class: "fila-admin__detalle" }, detalle)),
    h("div", { class: "fila-admin__dato" }, dato),
    h("div", { class: "fila-admin__acciones" }, acciones),
    nota && h("p", { class: "fila-admin__nota" }, icono("info"), nota));
}
const dato = (rotulo, valor, extra = null) => [h("span", { class: "rotulo" }, rotulo), h("strong", {}, valor), extra && h("span", { class: "suave" }, extra)];

async function panelEtiquetas(panel) {
  let filtro = "sin_confirmar", buscar = "", cursor = null, filas = [], conteo = null;
  const cabecera = h("div");
  const buscador = h("input", { class: "buscador__campo", type: "search", placeholder: "Escaneá o escribí un código o un producto",
    "aria-label": "Buscar código o producto", autocomplete: "off", spellcheck: "false" });
  const filtros = h("div", { class: "filtros", role: "group", "aria-label": "Filtrar etiquetas" });
  const lista = h("ul", { class: "filas" });
  const vacio = h("p", { class: "suave vacio", hidden: true });
  const mas = boton("boton--ancho", null, "Cargar más", { hidden: true, onclick: () => cargar(true) });

  function pintarCabecera() {
    const c = conteo ?? { sinConfirmar: 0, desactualizadas: 0, confirmadas: 0, manualSinConfirmar: 0 };
    const pendientes = c.sinConfirmar + c.desactualizadas;
    cabecera.replaceChildren(
      pendientes > 0
        ? aviso("alerta", `${numero(pendientes)} ${pendientes === 1 ? "código espera" : "códigos esperan"} confirmación. Hasta confirmarlos, la bodega no puede escanearlos.`)
        : aviso("ok", "Todos los códigos de barras están confirmados."),
      c.manualSinConfirmar > 0 ? h("div", { class: "tarjeta masiva" },
        h("div", {}, h("strong", {}, `${numero(c.manualSinConfirmar)} ${c.manualSinConfirmar === 1 ? "código" : "códigos"} con unidad Manual sin confirmar`),
          h("p", { class: "suave" }, "En SAP se venden de a una unidad del artículo: se pueden confirmar todos juntos. Los de otras unidades se revisan de a uno.")),
        boton("boton--principal", "completa", `Confirmar todos como unidad (${numero(c.manualSinConfirmar)})`, { onclick: confirmarTodos })) : "");
    filtros.replaceChildren(...[["sin_confirmar", "Sin confirmar", c.sinConfirmar], ["desactualizadas", "Cambiaron en SAP", c.desactualizadas],
      ["confirmadas", "Confirmadas", c.confirmadas]].map(([id, texto, n]) => h("button", { class: "filtro", type: "button", "aria-pressed": String(id === filtro),
      onclick: () => { filtro = id; cargar(); } }, id === "desactualizadas" && icono("alerta"), texto, h("span", { class: "n" }, numero(n)))));
  }

  function fila(e) {
    const confirmable = e.estado === "sin_confirmar" || e.estado === "desactualizada";
    const insignias = { desactualizada: insignia("alerta", "alerta", "Cambió en SAP"), unidad_individual: insignia("ok", "completa", "Es una unidad"),
      no_es_unidad: insignia("gris", null, "No es una unidad") };
    const confirmacion = e.confirmacion && `${quienConfirmo(e.confirmacion.confirmadaPor)} el ${fechaHora(e.confirmacion.confirmadaEn)}`;
    let nota = null;
    if (confirmable && !puedeSerUnidad(e)) nota = "No se puede confirmar como unidad: el código no tiene unidad de medida en SAP.";
    else if (e.estado === "desactualizada") nota = `Cambió en SAP después de confirmarse${confirmacion ? ` (lo confirmó ${confirmacion})` : ""}. Revisalo de nuevo.`;
    return filaAdmin({
      clase: e.estado === "desactualizada" ? "fila-admin--alerta" : e.estado === "no_es_unidad" ? "fila-admin--apagada" : "",
      nombre: e.itemName ?? e.itemCode,
      detalle: [h("span", { class: "codigo" }, e.itemCode), h("span", { class: "codigo" }, e.codigo), insignias[e.estado] ?? ""],
      dato: dato("Unidad en SAP", textoUnidad(e), !confirmable && confirmacion ? `Confirmado por ${confirmacion}` : null),
      acciones: confirmable
        ? [boton("boton--principal", "completa", "Es una unidad", { disabled: !puedeSerUnidad(e), onclick: () => decidir(e, true) }),
          boton("", null, "No es una unidad", { onclick: () => decidir(e, false) })]
        : [boton("", null, "Quitar confirmación", { onclick: () => quitar(e) })],
      nota,
    });
  }

  function pintarLista() {
    lista.replaceChildren(...filas.map(fila));
    vacio.textContent = filas.length ? "" : buscar ? "Ningún código coincide con la búsqueda." : "No hay códigos en esta lista.";
    vacio.hidden = filas.length > 0;
    mas.hidden = cursor === null;
  }

  async function cargar(siguiente = false) {
    if (!siguiente) { cursor = null; filas = []; lista.replaceChildren(cargando("Cargando códigos…")); vacio.hidden = true; mas.hidden = true; }
    pintarCabecera();
    try {
      const r = await api.etiquetasSupervisor({ estado: filtro, buscar, cursor });
      filas.push(...r.data); cursor = r.siguienteCursor;
      pintarLista();
    } catch (error) { lista.replaceChildren(); panel.fallo(error, () => cargar()); }
  }
  async function recargar() {
    conteo = (await panel.refrescar())?.etiquetas ?? conteo;
    await cargar();
  }

  async function decidir(e, esUnidad) {
    try {
      await api.confirmarEtiqueta(e.id, esUnidad);
      panel.avisar("ok", `${e.codigo}: ${esUnidad ? "confirmado como unidad" : "marcado como que no es una unidad"}.`);
      await recargar();
    } catch (error) { panel.fallo(error); }
  }
  async function quitar(e) {
    if (!(await confirmar({ titulo: "Quitar confirmación", texto: [`${e.codigo} vuelve a "Sin confirmar" y la bodega no puede escanearlo hasta que alguien lo confirme de nuevo.`], aceptar: "Quitar" }))) return;
    try { await api.quitarConfirmacion(e.id); panel.avisar("ok", `${e.codigo}: confirmación quitada.`); await recargar(); } catch (error) { panel.fallo(error); }
  }
  async function confirmarTodos() {
    // Se confirma exactamente el conjunto que vio el supervisor: misma cantidad y misma versión.
    const cantidadEsperada = conteo?.manualSinConfirmar ?? 0;
    const versionEsperada = conteo?.versionManual;
    if (!(await confirmar({ titulo: "Confirmar todos como unidad", aceptar: `Confirmar ${numero(cantidadEsperada)}`,
      texto: [`Se van a confirmar ${numero(cantidadEsperada)} códigos con unidad Manual como unidad individual: cada lectura cuenta 1 unidad del producto.`,
        "Si alguno es de una caja, después lo podés cambiar a \"No es una unidad\" desde Confirmadas."] }))) return;
    try {
      const { data } = await api.confirmarManual(cantidadEsperada, versionEsperada);
      panel.avisar("ok", `${numero(data.confirmadas)} códigos confirmados como unidad.`);
    } catch (error) {
      if (error.codigo === "ETIQUETAS_CAMBIARON" || error.codigo === "CANTIDAD_CAMBIO") {
        panel.avisar("alerta", "Los códigos cambiaron mientras los revisabas. Se actualizó la lista: revisala y confirmá de nuevo.");
      } else panel.fallo(error);
    }
    await recargar();
  }

  let espera = null;
  buscador.addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(() => { buscar = buscador.value.trim(); cargar(); }, 350); });
  limpiezas.push(() => clearTimeout(espera));
  const formulario = h("form", { class: "buscador", role: "search", onsubmit: (evento) => {
    evento.preventDefault(); clearTimeout(espera); buscar = buscador.value.trim(); buscador.select(); cargar();
  } }, icono("escaner"), buscador);

  const registrar = h("div", { class: "fila fila--entre panel__intro" },
    h("p", { class: "suave" }, "¿Un producto no tiene código de barras en SAP? Escanealo y elegí el producto: queda confirmado como unidad."),
    boton("boton--principal", "mas", "Registrar un código", { onclick: async () => {
      const registrado = await registrarCodigo();
      if (registrado) { panel.avisar("ok", `${registrado.codigo} quedó registrado para ${registrado.itemName}.`); await recargar(); }
    } }));
  panel.contenido.replaceChildren(registrar, cabecera, formulario, filtros, lista, vacio, mas);
  conteo = (await panel.refrescar())?.etiquetas ?? null;
  await cargar();
  buscador.focus();
}

async function panelOperadores(panel) {
  const lista = h("ul", { class: "filas" });
  const propio = estado.ingreso?.operador?.id;
  const VALIDAR_PIN = (pin) => (/^\d{4}$/.test(pin) ? null : "El PIN tiene que tener exactamente 4 números.");

  function fila(o) {
    const e = estadoOperador(o);
    const trabado = o.estado === "bloqueado" || o.estado === "pausa";
    return filaAdmin({
      clase: o.estado === "inactivo" ? "fila-admin--apagada" : trabado ? "fila-admin--alerta" : "",
      nombre: o.id === propio ? `${o.nombre} (vos)` : o.nombre,
      detalle: [o.rol === "supervisor" ? insignia("rol", "escudo", "Supervisor") : "",
        insignia(e.tipo, e.tipo === "ok" ? "completa" : e.tipo === "gris" ? null : e.tipo === "error" ? "candado" : "alerta", e.texto), e.detalle],
      dato: dato("Último ingreso", o.ultimoIngreso ? fechaHora(o.ultimoIngreso) : "Nunca"),
      acciones: [
        trabado && boton("boton--principal", "abierto", "Desbloquear", { onclick: () => accion(() => api.desbloquear(o.id), `${o.nombre} ya puede ingresar.`) }),
        o.activo && boton("", "candado", "Cambiar PIN", { onclick: () => cambiarPin(o) }),
        o.activo && o.id !== propio && boton("", null, "Desactivar", { onclick: () => desactivar(o) }),
        !o.activo && boton("boton--principal", null, "Activar", { onclick: () => accion(() => api.cambiarActivo(o.id, true), `${o.nombre} vuelve a aparecer en la lista de ingreso.`) }),
      ].filter(Boolean),
    });
  }
  async function cargar() {
    try { lista.replaceChildren(...(await api.operadoresSupervisor()).data.map(fila)); } catch (error) { panel.fallo(error, cargar); }
  }
  async function accion(llamada, texto) {
    try {
      const { data } = await llamada();
      panel.avisar("ok", texto, data?.advertencia ? aviso("alerta", data.advertencia) : null);
      await Promise.all([cargar(), panel.refrescar()]);
    } catch (error) { panel.fallo(error); }
  }
  async function cambiarPin(o) {
    const datos = await pedirDatos({ titulo: `Cambiar el PIN de ${o.nombre}`, aceptar: "Cambiar PIN",
      texto: o.id === propio ? "Tu sesión en este equipo sigue abierta; las demás se cierran." : "Se cierran sus sesiones abiertas.",
      campos: [{ nombre: "pin", etiqueta: "PIN nuevo de 4 números", tipo: "password", inputmode: "numeric", maxlength: 4 },
        { nombre: "repetir", etiqueta: "Repetir el PIN", tipo: "password", inputmode: "numeric", maxlength: 4 }],
      validar: (d) => VALIDAR_PIN(d.pin) ?? (d.pin === d.repetir ? null : "Los dos PIN no coinciden.") });
    if (datos) await accion(() => api.cambiarPin(o.id, datos.pin), `PIN de ${o.nombre} cambiado.`);
  }
  async function desactivar(o) {
    if (!(await confirmar({ titulo: `Desactivar a ${o.nombre}`, peligro: true, aceptar: "Desactivar",
      texto: ["Ya no va a aparecer en la lista de ingreso y se cierran sus sesiones. Lo podés activar de nuevo cuando quieras."] }))) return;
    await accion(() => api.cambiarActivo(o.id, false), `${o.nombre} quedó desactivado.`);
  }
  async function agregar() {
    const datos = await pedirDatos({ titulo: "Agregar persona", aceptar: "Agregar",
      campos: [{ nombre: "nombre", etiqueta: "Nombre y apellido", maxlength: 60 },
        { nombre: "pin", etiqueta: "PIN de 4 números", tipo: "password", inputmode: "numeric", maxlength: 4, ayuda: "Lo usa para ingresar. Evitá 1234 o 0000." },
        { nombre: "supervisor", etiqueta: "Es supervisor (puede usar este panel)", tipo: "casilla" }],
      validar: (d) => (d.nombre.length < 2 ? "Escribí el nombre." : VALIDAR_PIN(d.pin)) });
    if (datos) {
      await accion(() => api.crearOperador({ nombre: datos.nombre, pin: datos.pin, rol: datos.supervisor ? "supervisor" : "operador" }),
        `${datos.nombre} ya puede ingresar con su PIN.`);
    }
  }
  panel.contenido.replaceChildren(
    h("div", { class: "fila fila--entre panel__intro" },
      h("p", { class: "suave" }, "Cada persona ingresa con su nombre y un PIN de 4 números. Cambiar el PIN o desactivar cierra sus sesiones abiertas."),
      boton("boton--principal", "mas", "Agregar persona", { onclick: agregar })),
    lista);
  await cargar();
}

async function panelRevisiones(panel) {
  let datos;
  try { datos = (await api.revisiones()).data; } catch (error) { panel.contenido.replaceChildren(); return panel.fallo(error, () => vistaSupervisor("revisiones")); }
  const { enRevision, conDiferencias, sinEntrega } = datos;
  const bloque = (titulo, n, ...hijos) => h("section", { class: "bloque" }, h("h2", {}, titulo, h("span", { class: "contador" }, numero(n))), ...hijos);
  const cuandoYQuien = (f) => [f.operador, f.fechaFin && fechaHora(f.fechaFin)].filter(Boolean).join(" · ");
  const pedidoTexto = (f) => `Pedido ${f.pedido.docNum ?? f.pedido.docEntry}${f.pedido.cliente ? ` · ${f.pedido.cliente}` : ""}`;

  async function verResumen(f) {
    mostrar(cargando("Cargando resumen…"));
    try {
      const [pedido, sesion] = await Promise.all([api.pedido(f.pedido.docEntry).then(pedidoConNombres), api.sesion(f.pickingId).then((r) => r.data)]);
      vistaResumen(sesion, pedido, { texto: "Volver al panel", accion: () => vistaSupervisor("revisiones") });
    } catch (error) { mostrarError(error, () => verResumen(f)); }
  }
  async function anular(r) {
    const docNum = r.pedido.docNum ?? r.pedido.docEntry;
    if (!(await confirmar({ titulo: r.pedidoAbierto ? `Reiniciar el pedido ${docNum}` : `Cerrar la revisión del pedido ${docNum}`,
      aceptar: r.pedidoAbierto ? "Reiniciar" : "Cerrar la revisión",
      texto: [r.pedidoAbierto ? "La preparación empieza de nuevo con el pedido actual de SAP. Las lecturas anteriores quedan en el historial."
        : "SAP ya no tiene el pedido abierto. La preparación queda en el historial con sus lecturas."] }))) return;
    try {
      await api.anularRevision(r.pickingId);
      panel.avisar("ok", r.pedidoAbierto ? `Listo: el pedido ${docNum} se puede volver a preparar.` : `Revisión del pedido ${docNum} cerrada.`);
    } catch (error) { panel.fallo(error); }
    await panel.refrescar();
    await panelRevisiones(panel);
  }

  const tarjetaRevision = (r) => h("div", { class: "tarjeta revision" },
    h("div", { class: "fila fila--entre" },
      h("div", {}, h("span", { class: "rotulo" }, "Pedido"), h("div", { class: "revision__numero" }, String(r.pedido.docNum ?? r.pedido.docEntry)),
        r.pedido.cliente && h("div", { class: "encabezado__sub" }, r.pedido.cliente)),
      h("div", { class: "fila-admin__acciones" },
        boton("", "lista", "Ver lecturas", { onclick: () => mostrarLecturas(r.pickingId) }),
        boton("boton--principal", "actualizar", r.pedidoAbierto ? "Reiniciar con los datos nuevos" : "Cerrar la revisión", { onclick: () => anular(r) }))),
    h("p", { class: "revision__texto" }, textoRevision(r)),
    r.cambios.length > 0 && h("table", { class: "cambio" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Producto"), h("th", { scope: "col" }, "Antes"), h("th", { scope: "col" }, "Ahora"))),
      h("tbody", {}, r.cambios.map((c) => h("tr", {}, h("td", {}, c.itemName ?? c.itemCode), h("td", {}, c.antes === null ? "—" : numero(c.antes)),
        h("td", { class: "cambio__nuevo" }, textoCambio(c)))))),
    h("p", { class: "suave revision__nota" }, r.pedidoAbierto
      ? "Al reiniciar, la preparación empieza de nuevo con el pedido actual. Las lecturas anteriores quedan en el historial."
      : "Al cerrar la revisión, la preparación queda en el historial."));

  const filaFinalizada = (f, extra) => filaAdmin({ clase: "fila-admin--alerta", nombre: pedidoTexto(f), detalle: [cuandoYQuien(f)],
    dato: extra, acciones: [boton("", "siguiente", "Ver resumen", { onclick: () => verResumen(f) })] });

  const nada = !enRevision.length && !conDiferencias.length && !sinEntrega.length;
  panel.contenido.replaceChildren(
    nada ? aviso("ok", "No hay nada para revisar.") : "",
    enRevision.length ? bloque("En revisión", enRevision.length, ...enRevision.map(tarjetaRevision)) : "",
    conDiferencias.length ? bloque("Finalizados con diferencias", conDiferencias.length,
      h("ul", { class: "filas" }, conDiferencias.map((f) => filaFinalizada(f,
        dato("Unidades", `${numero(f.unidadesPreparadas)} de ${numero(f.unidadesPedidas)} · faltaron ${numero(f.unidadesPedidas - f.unidadesPreparadas)}`))))) : "",
    sinEntrega.length ? bloque("Preparados sin entrega en SAP (más de 24 h)", sinEntrega.length,
      h("ul", { class: "filas" }, sinEntrega.map((f) => filaFinalizada(f, dato("Sin entrega hace", textoSinEntrega(f.horasSinEntrega)))))) : "");
}

async function panelSincronizacion(panel) {
  let datos;
  try { datos = (await api.sincronizacion()).data; } catch (error) { panel.contenido.replaceChildren(); return panel.fallo(error, () => vistaSupervisor("sincronizacion")); }
  const pedidos = datos.entidades.find((e) => e.entidad === "pedidos");
  const estadoPedidos = estadoDatos(pedidos);
  const INSIGNIAS = { ok: ["ok", "completa"], alerta: ["alerta", "alerta"], sin_datos: ["gris", null] };
  panel.contenido.replaceChildren(
    estadoPedidos.tipo === "ok" ? aviso("ok", `El puente está enviando datos. Últimos pedidos de SAP ${hace(pedidos.ultimaRecepcion)}.`)
      : estadoPedidos.tipo === "alerta" ? aviso("alerta", `Los últimos pedidos de SAP llegaron ${hace(pedidos.ultimaRecepcion)}. Revisá que el puente esté funcionando.`)
        : aviso("alerta", "Todavía no llegaron datos de SAP."),
    h("table", { class: "tabla" },
      h("thead", {}, h("tr", {}, ["Datos de SAP", "Última recepción", "Registros", "Estado"].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", {}, datos.entidades.map((e) => {
        const s = estadoDatos(e);
        return h("tr", {}, h("th", { scope: "row" }, NOMBRES_DATOS[e.entidad] ?? e.entidad),
          h("td", {}, e.ultimaRecepcion ? hace(e.ultimaRecepcion) : "—"),
          h("td", { class: "tabla__numero" }, e.entidad === "pedidos" ? `${numero(e.registros)} abiertos`
            : e.entidad === "existencias" ? `${numero(e.registros)} productos` : numero(e.registros)),
          h("td", {}, insignia(INSIGNIAS[s.tipo][0], INSIGNIAS[s.tipo][1], s.texto)));
      }))),
    h("p", { class: "suave panel__nota" }, `${datos.empresa ? `Sociedad de SAP: ${datos.empresa}. ` : ""}Aviso si los pedidos pasan más de 1 hora sin datos, y el resto más de 24 horas. Los límites se ajustan cuando se definan las frecuencias del puente.`));
}

// Reportes: cuadre con SAP de lo ya contado, en pantalla y en PDF.
async function panelReportes(panel) {
  let r;
  try { r = (await api.reporteCuadre()).data; } catch (error) {
    panel.contenido.replaceChildren();
    if (["ALMACENES_SIN_ELEGIR", "BODEGAS_SIN_ALMACEN"].includes(error?.codigo)) return panel.contenido.replaceChildren(aviso("alerta", error.mensaje),
      boton("", "bodega", "Ir a Almacenes", { onclick: () => vistaSupervisor("almacenes") }));
    return panel.fallo(error, () => vistaSupervisor("reportes"));
  }
  recordarBodegas(r.bodegas);
  const descargar = boton("boton--principal", "impresora", "Descargar PDF", { onclick: async () => {
    panel.avisar(null, "");
    descargar.disabled = true;
    const resultado = await guardarCuadrePdf(r);
    descargar.disabled = false;
    if (resultado.ok) panel.avisar("ok", `Reporte guardado: ${resultado.archivo}`);
    else if (resultado.motivo === "ocupado") panel.avisar("error", "No se pudo guardar: el archivo está abierto en otro programa. Cerralo o elegí otro nombre.");
    else if (!resultado.cancelado) panel.avisar("error", "No se pudo guardar el PDF. Probá de nuevo.");
  } });
  if (!window.escritorio?.guardarPdf) descargar.hidden = true;
  panel.contenido.replaceChildren(
    h("div", { class: "reporte__encabezado" },
      h("div", {}, h("h2", {}, "Cuadre con SAP"), h("p", { class: "suave" }, textoMomentoCuadre(r))),
      h("div", { class: "fila" }, boton("", "actualizar", "Actualizar", { onclick: () => vistaSupervisor("reportes") }), descargar)),
    ...contenidoCuadre(r));
}

const textoMomentoCuadre = (r) => `Generado el ${fechaHora(r.generadoEn)}${r.existenciasSapAl ? ` · existencias de SAP del ${fechaHora(r.existenciasSapAl)}` : ""}`;

// El mismo contenido en pantalla y en el PDF (la hoja de estilos lo acomoda para imprimir).
function contenidoCuadre(r) {
  const { resumen } = r;
  const corto = (bodega) => bodegaNombre(bodega, { corto: true });
  const cifra = (tipo, valor, texto, detalle) => h("div", { class: `reporte-cifra reporte-cifra--${tipo}` },
    h("strong", {}, numero(valor)), h("span", { class: "reporte-cifra__texto" }, texto), h("span", { class: "suave" }, detalle));
  const seccion = (tipo, titulo, lista, bajada) => h("section", { class: `reporte-seccion reporte-seccion--${tipo}` },
    h("h3", {}, `${titulo} · ${numero(lista.length)} ${lista.length === 1 ? "producto" : "productos"}`),
    h("p", { class: "suave" }, bajada),
    lista.length ? tablaCuadre(lista) : h("p", { class: "reporte-vacio" }, "Ninguno."));
  return [
    h("div", { class: "reporte-cifras" },
      cifra("ok", resumen.cuadran, "Cuadran", `${porcentaje(resumen.cuadran, resumen.contados)} % de los ${numero(resumen.contados)} contados`),
      cifra("menos", resumen.menos.productos, "Con menos que SAP", unidadesConSigno(resumen.menos.unidades)),
      cifra("mas", resumen.mas.productos, "Con más que SAP", unidadesConSigno(resumen.mas.unidades))),
    h("ul", { class: "reporte-destacados" }, destacadosCuadre(r, { grande: corto("grande"), pequena: corto("pequena") }).map((t) => h("li", {}, t))),
    h("p", { class: "reporte-lectura" }, h("strong", {}, "Cómo leer las tablas: "),
      `todo está en unidades. Diferencia = contado − SAP: negativa (en rojo), en la bodega hay menos que en SAP; positiva (en naranja), hay más. `,
      `${conMayuscula(corto("pequena"))} cuenta lo preparado en pedidos sin entregar en SAP.`),
    seccion("menos", "Con menos que SAP", r.menos, "De mayor a menor faltante. En Pendientes aparecen como Falta guardar."),
    seccion("mas", "Con más que SAP", r.mas, "De mayor a menor sobrante. En Pendientes aparecen como Falta marcar salida."),
    h("p", { class: "suave reporte-nota" }, notaCuadre(resumen)),
    ...(r.almacenes ?? []).map(seccionAlmacen),
  ];
}

// Almacén solo para contar (la 03, la 04): lo contado frente a lo que SAP tiene ahora en ese almacén.
function seccionAlmacen(a) {
  const { resumen } = a;
  const cajas = a.tipo === "cajas";
  const tabla = (lista) => (lista.length ? h("div", { class: "tabla-envoltura" }, h("table", { class: "tabla tabla-cuadre tabla-cuadre--almacen" },
    h("thead", {}, h("tr", {}, ["Código", "Producto", "Contado", "SAP", "Diferencia"].map((t, i) => h("th", { scope: "col", class: i >= 2 ? "tabla__numero" : null }, t)))),
    h("tbody", {}, lista.map((x) => h("tr", {},
      h("td", { class: "codigo" }, x.itemCode), h("th", { scope: "row" }, x.itemName),
      h("td", { class: "tabla__numero" }, numero(x.contado), cajas && x.cajas ? h("small", { class: "suave" }, ` en ${numero(x.cajas)} ${x.cajas === 1 ? "caja" : "cajas"}`) : ""),
      h("td", { class: "tabla__numero suave" }, numero(x.sap)),
      h("td", { class: `tabla__numero dif dif--total dif--${x.diferencia < 0 ? "menos" : "mas"}` }, conSigno(x.diferencia)))))))
    : h("p", { class: "reporte-vacio" }, "Ninguno."));
  return h("section", { class: "reporte-almacen" },
    h("h3", {}, `La ${a.almacen} · ${a.nombre}`),
    h("p", { class: "suave" }, `Solo conteo, ${cajas ? "por cajas" : "por lote"}. Se compara con lo que SAP tiene ahora en la ${a.almacen}: si SAP se movió después de contar, hay que recontar ese producto.`),
    h("p", { class: "reporte-almacen__cifras" },
      h("strong", { class: "reporte-almacen__ok" }, `${numero(resumen.cuadran)} ${resumen.cuadran === 1 ? "cuadra" : "cuadran"}`), " · ",
      h("strong", { class: "dif--menos" }, `${numero(resumen.menos.productos)} con menos${resumen.menos.productos ? ` (${unidadesConSigno(resumen.menos.unidades)})` : ""}`), " · ",
      h("strong", { class: "dif--mas" }, `${numero(resumen.mas.productos)} con más${resumen.mas.productos ? ` (${unidadesConSigno(resumen.mas.unidades)})` : ""}`),
      resumen.pendientes ? ` · ${numero(resumen.pendientes)} sin contar` : ""),
    h("h4", {}, "Con menos que SAP"), tabla(a.menos),
    h("h4", {}, "Con más que SAP"), tabla(a.mas));
}

function tablaCuadre(lista) {
  const dif = (n, total = false) => h("td", { class: `tabla__numero dif dif--${n < 0 ? "menos" : n > 0 ? "mas" : "cero"}${total ? " dif--total" : ""}` }, conSigno(n));
  const num = (n, extra = "") => h("td", { class: `tabla__numero${extra}` }, numero(n));
  const grupo = (bodega) => h("th", { scope: "colgroup", colspan: "3", class: "tabla-cuadre__grupo" }, bodegaNombre(bodega, { corto: true }).replace(/^la /, "Bodega "));
  return h("div", { class: "tabla-envoltura" }, h("table", { class: "tabla tabla-cuadre" },
    h("thead", {},
      h("tr", {}, h("th", { colspan: "2" }), grupo("grande"), grupo("pequena"), h("th")),
      h("tr", {}, ["Código", "Producto", "Contado", "SAP", "Dif.", "Contado", "SAP", "Dif.", "Total"].map((t, i) =>
        h("th", { scope: "col", class: i >= 2 ? "tabla__numero" : null }, t)))),
    h("tbody", {}, lista.map((x) => h("tr", {},
      h("td", { class: "codigo" }, x.itemCode), h("th", { scope: "row" }, x.itemName),
      num(x.grande.contado), num(x.grande.sap, " suave"), dif(x.grande.diferencia),
      h("td", { class: "tabla__numero" }, numero(x.pequena.contado), x.pequena.sinEntrega ? h("small", { class: "suave" }, ` +${numero(x.pequena.sinEntrega)} sin entregar`) : ""),
      num(x.pequena.sap, " suave"), dif(x.pequena.diferencia), dif(x.diferencia, true))))));
}

// Arma la hoja del PDF en la zona de impresión y la guarda (la app pregunta dónde).
async function guardarCuadrePdf(r) {
  const hoja = h("div", { class: "hoja-reporte" },
    h("header", { class: "hoja-reporte__portada" },
      h("p", { class: "hoja-reporte__marca" }, "Bodega · Conteo físico"),
      h("h1", {}, "Cuadre de inventario"),
      h("p", { class: "hoja-reporte__sub" }, "Productos ya contados: qué cuadró con SAP, qué tiene menos y qué tiene más"),
      h("p", { class: "hoja-reporte__fecha" }, `${textoMomentoCuadre(r)} · ${bodegaNombre("grande")} y ${bodegaNombre("pequena")}`)),
    ...contenidoCuadre(r));
  const zona = zonaImpresion();
  zona.replaceChildren(hoja);
  try {
    await document.fonts.ready;
    return await window.escritorio.guardarPdf({ nombre: nombreArchivoCuadre(r.generadoEn), pie: `Bodega Cosprobell · Cuadre con SAP · ${fechaHora(r.generadoEn)}` });
  } catch {
    return { ok: false, motivo: "error" };
  } finally {
    zona.replaceChildren();
  }
}

// ---------------------------------------------------------------------------
// Inventario: bodega grande (cajas por lote) y bodega pequeña (unidades sueltas)
// ---------------------------------------------------------------------------

const unidadesTexto = (n) => `${numero(n)} ${Math.abs(n) === 1 ? "unidad" : "unidades"}`;
// Fecha del día en el equipo (la recepción es un momento exacto, no una fecha de SAP).
const fechaLocal = (iso) => (iso ? new Date(iso).toLocaleDateString("es-HN") : "—");
const volverA = (texto, accion) => boton("boton--volver", "volver", texto, { onclick: accion });
const volverInventario = () => volverA("Inventario", () => vistaInventario());
const enteroPositivo = (valor, minimo = 1) => Number.isInteger(valor) && valor >= minimo && valor <= 1_000_000;
const ICONO_MOVIMIENTO = { recepcion: "caja", reposicion: "mover", traspaso: "mover", picking: "lista", descuento: "restar", reasignacion: "actualizar",
  conteo: "contar", correccion: "contar" };

function mostrarInventario(...nodos) { mostrarAmplio(navegacion("inventario"), ...nodos); }
function mostrarBodegas(...nodos) { mostrarAmplio(navegacion("bodegas"), ...nodos); }

// Cada bodega con el nombre que conoce la gente ("01 · Almacén Principal", corto "la 01"). Hasta que se carga el
// inventario, o si no tiene almacén asignado, "Bodega grande" y "Bodega pequeña".
const bodegaNombre = (bodega, opciones) => nombreBodega(estado.bodegas, bodega, opciones);
const conMayuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);
function recordarBodegas(bodegas) { if (bodegas) estado.bodegas = bodegas; }

// Barra de avance: "123 de 544 contados" y cuántos faltan.
function barraAvance(avance, etiqueta, { texto = null } = {}) {
  const a = avanceConteo(avance);
  if (!a) return null;
  const relleno = h("span", { class: "avance__relleno" });
  relleno.style.transform = `scaleX(${a.porcentaje / 100})`;
  return h("div", { class: `avance${a.completo ? " avance--completo" : ""}` },
    h("div", { class: "avance__texto" }, h("strong", {}, texto ?? a.texto), h("span", {}, a.completo ? "Completo" : `faltan ${numero(a.faltan)}`)),
    h("div", { class: "avance__barra", role: "progressbar", "aria-label": etiqueta, "aria-valuemin": "0", "aria-valuemax": "100",
      "aria-valuenow": String(a.porcentaje), "aria-valuetext": texto ?? a.texto }, relleno));
}

// Campo para el lector: escribe como un teclado y termina con Enter. También se puede escribir a mano. Con alEscribir,
// lo escrito queda en el campo (para filtrar una lista) y alLeer decide si se borra.
function campoLector({ etiqueta = "Lector", placeholder, ayuda = null, alLeer, alEscribir = null }) {
  const entrada = h("input", { class: "entrada-escaneo", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    enterkeyhint: "search", "aria-label": placeholder, placeholder });
  const formulario = h("form", { class: "fila formulario-escaneo", onsubmit: (evento) => {
    evento.preventDefault();
    const texto = entrada.value.trim();
    if (!alEscribir) entrada.value = "";
    if (texto) alLeer(texto);
  } }, h("div", { class: "crecer campo-escaneo" }, icono("escaner"), entrada));
  if (alEscribir) entrada.addEventListener("input", () => alEscribir(entrada.value.trim()));
  const seccion = h("section", { class: "escaneo lector", "aria-label": etiqueta },
    h("div", { class: "escaneo__cabeza" }, h("span", { class: "rotulo" }, etiqueta),
      h("span", { class: "escaneo__estado escaneo__estado--listo" }, "Listo para leer"),
      h("span", { class: "escaneo__estado escaneo__estado--sin-foco" }, "Tocá el campo para leer")),
    formulario, ayuda && h("p", { class: "lector__ayuda" }, ayuda));
  return { seccion, entrada };
}

// Código de barras impreso en la caja del proveedor (no el de la unidad): se registra al contar la 01 y se escanea al
// pasar cajas a la 02. Es opcional; si el producto ya tiene uno, se muestra. registrar() lo guarda si se escribió uno
// nuevo y devuelve el error, si hubo.
function campoCodigoCaja(p) {
  const entrada = h("input", { id: "conteo-codigo-caja", class: "campo codigo", maxlength: "64", autocomplete: "off", spellcheck: "false",
    placeholder: p.codigosCaja?.length ? "Escaneá otro si la caja trae uno distinto" : "Escaneá el código de barras de la caja" });
  // El lector termina con Enter: no tiene que guardar el conteo.
  entrada.addEventListener("keydown", (evento) => { if (evento.key === "Enter") { evento.preventDefault(); entrada.blur(); } });
  const registrados = h("p", { class: "suave" });
  const pintar = () => poner(registrados, p.codigosCaja?.length
    ? [icono("caja"), " Registrado: ", ...p.codigosCaja.flatMap((c, i) => [i > 0 ? ", " : null, h("span", { class: "codigo" }, c.codigo)])]
    : "Opcional. Es el que viene impreso de fábrica en la caja (distinto del de la unidad); se escanea al pasar cajas a la 02.");
  pintar();
  return {
    elemento: h("div", { class: "codigo-caja" }, h("label", { class: "campo-etiqueta", for: "conteo-codigo-caja" }, h("span", {}, "Código de barras de la caja"), entrada), registrados),
    async registrar() {
      const codigo = entrada.value.trim();
      if (!codigo || p.codigosCaja?.some((c) => c.codigo === codigo)) return null;
      try {
        const { data } = await api.registrarCodigoCaja(codigo, p.itemCode);
        p.codigosCaja = [...(p.codigosCaja ?? []), { id: data.id, codigo: data.codigo }];
        entrada.value = "";
        pintar();
        return null;
      } catch (error) { return error; }
    },
  };
}

function tablaMovimientos(movimientos, { conProducto = true } = {}) {
  if (!movimientos.length) return h("p", { class: "suave vacio" }, "Todavía no hay movimientos.");
  return h("div", { class: "tabla-envoltura" }, h("table", { class: "tabla tabla--movimientos" },
    h("thead", {}, h("tr", {}, ["Cuándo", "Movimiento", conProducto && "Producto", "Lote", "Cantidad", "Quién"].filter(Boolean)
      .map((t) => h("th", { scope: "col", class: t === "Cantidad" ? "tabla__numero" : null }, t)))),
    h("tbody", {}, movimientos.map((m) => h("tr", {},
      h("td", { class: "tabla__fecha" }, fechaHora(m.creadoEn)),
      h("td", {}, h("span", { class: "movimiento" }, icono(ICONO_MOVIMIENTO[m.tipo] ?? "lista"), textoMovimiento(m)),
        m.observacion && h("small", { class: "movimiento__nota" }, m.observacion)),
      conProducto && h("td", {}, h("button", { class: "enlace", type: "button", onclick: () => vistaProducto(m.itemCode) }, m.itemName ?? m.itemCode)),
      h("td", { class: "codigo" }, m.lotes > 1 ? `${m.lotes} lotes` : m.lote ?? "—"),
      h("td", { class: "tabla__numero" }, cantidadMovimiento(m, estado.bodegas)),
      h("td", {}, quien(m.hechoPor)))))));
}

// Lo escaneado en el inventario: la etiqueta de una caja abre la caja; un código o texto busca el producto.
async function leerEnInventario(texto, proposito = null) {
  if (esCodigoCaja(texto) && proposito !== "recibir") return vistaCaja(texto.toUpperCase());
  let resultados;
  try { resultados = (await api.buscarProductos(texto)).data; } catch (error) { return mostrarError(error, () => vistaInventario()); }
  const exactos = resultados.filter((p) => p.itemCode === texto || p.codigos.includes(texto) || p.codigosCaja?.includes(texto));
  if (exactos.length === 1) return proposito === "recibir" ? vistaRecibir(exactos[0].itemCode) : vistaProducto(exactos[0].itemCode);
  return vistaBuscar({ texto, resultados, proposito });
}

// Inicio del inventario: el lector, lo que hay que hacer hoy y las dos bodegas. Todo tiene su lugar fijo: si falta
// un dato (por ejemplo, SAP sin datos recientes), la tarjeta queda con "—" en lugar de desaparecer.
async function vistaInventario() {
  estado.desdeLista = null; estado.desdeConteo = null; estado.desdeBodegas = null;
  mostrarInventario(cargando("Cargando inventario…"));
  let r, supervisor = null;
  try {
    [r, supervisor] = await Promise.all([api.inventario().then((x) => x.data),
      esSupervisor() ? api.resumenSupervisor().then((x) => x.data).catch(() => null) : null]);
  } catch (error) { return mostrarError(error, () => vistaInventario()); }
  recordarBodegas(r.bodegas);
  const p = r.pendientes;
  // Sin comparación con SAP no hay pendientes que calcular: el inventario de la bodega funciona igual.
  const comparar = r.comparacionDisponible === true;
  estado.pendientesInventario = comparar ? p.porUbicar + p.porDescontar + (p.porPasar ?? 0) : 0;
  const lector = campoLector({ placeholder: "Escaneá la etiqueta de una caja o el código de un producto", alLeer: (t) => leerEnInventario(t) });
  // Una tarea de hoy: n null muestra "—" (sin datos para calcularla).
  const tarea = (nombreIcono, titulo, n, texto, onclick, tipo = "alerta") => h("button", {
    class: `pendiente${n === null ? " pendiente--gris" : n > 0 ? ` pendiente--${tipo}` : ""}`, type: "button", onclick },
  h("span", { class: "pendiente__cabeza" }, icono(nombreIcono), titulo), h("span", { class: "pendiente__n" }, n === null ? "—" : numero(n)),
  h("span", { class: "pendiente__texto" }, texto));
  const accion = (nombreIcono, titulo, onclick) => h("button", { class: "accion-inventario accion-inventario--chica", type: "button", onclick },
    icono(nombreIcono), h("strong", {}, titulo));
  const cifra = (n, texto) => h("div", { class: "cifra" }, h("strong", {}, numero(n)), h("span", {}, texto));
  const vencen = r.porVencer.vencidos + r.porVencer.proximos;
  const avances = ["grande", "pequena"].map((b) => avanceConteo(r.conteo?.[b])).filter(Boolean);
  const faltaContar = avances.length ? avances.reduce((t, a) => t + a.faltan, 0) : null;
  const conDatos = (texto) => (comparar ? texto : "Sin datos recientes de SAP");
  const tarjetaBodega = (bodega, nombreIcono, cifras) => h("section", { class: "tarjeta bodega" },
    h("div", { class: "fila fila--entre" }, h("h2", {}, icono(nombreIcono), bodegaNombre(bodega)),
      boton("", "siguiente", "Ver lo que hay", { onclick: () => vistaProductos({ vista: bodega }) })),
    h("div", { class: "cifras" }, cifras),
    r.bodegas?.[bodega] ? h("div", { class: "fila fila--entre bodega__conteo" },
      barraAvance(r.conteo?.[bodega], `Avance del conteo de ${bodegaNombre(bodega, { corto: true })}`),
      boton("", "contar", "Contar", { onclick: () => vistaConteo({ bodega }), "aria-label": `Contar ${bodegaNombre(bodega, { corto: true })}` }))
      : h("p", { class: "suave bodega__conteo" }, "Falta elegir su almacén de SAP para contarla."));
  mostrarInventario(
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, "Inventario"),
      h("p", { class: "encabezado__sub" }, "Escaneá una caja o un producto, o elegí qué hacer.")), chipSap(r)),
    supervisor && puestaEnMarcha(r, supervisor),
    r.pequena.negativos > 0 && aviso("alerta", `${numero(r.pequena.negativos)} ${r.pequena.negativos === 1 ? "producto tiene" : "productos tienen"} un saldo negativo antiguo en ${bodegaNombre("pequena", { corto: true })}: el supervisor tiene que contarlos por lote antes de moverlos.`),
    lector.seccion,
    h("h2", { class: "titulo-seccion" }, "Hoy"),
    h("div", { class: "pendientes" },
      tarea("contar", "Falta contar", faltaContar, faltaContar === null ? "Falta elegir el almacén de cada bodega" : "productos por contar entre las dos bodegas",
        () => vistaConteo(), "gris"),
      tarea("caja", "Falta guardar", comparar ? p.porUbicar : null,
        conDatos(`llegó en SAP y falta guardarlo en la bodega${p.actualizando > 0 ? ` · ${numero(p.actualizando)} actualizándose` : ""}`), () => vistaPendientes("ubicar")),
      tarea("mover", "Traspasos por aceptar", comparar && r.bodegas?.grande && r.bodegas?.pequena ? p.porPasar ?? 0 : null,
        !comparar ? conDatos("") : r.bodegas?.grande && r.bodegas?.pequena
          ? `SAP pasó de ${bodegaNombre("grande", { corto: true })} a ${bodegaNombre("pequena", { corto: true })}: aceptá de qué lotes` : "Falta elegir el almacén de cada bodega",
        () => vistaPendientes("pasar")),
      tarea("restar", "Falta marcar salida", comparar ? p.porDescontar : null, conDatos("salió en SAP y falta marcar de qué lote"), () => vistaPendientes("descontar")),
      tarea("calendario", "Por vencer", vencen, textoPorVencer(r.porVencer), () => vistaPorVencer(), r.porVencer.vencidos ? "error" : "alerta")),
    h("div", { class: "acciones-inventario" },
      accion("contar", "Contar", () => vistaConteo()),
      accion("caja", "Recibir", () => vistaBuscar({ proposito: "recibir" })),
      accion("lista", "Productos", () => vistaProductos())),
    h("div", { class: "bodegas" },
      tarjetaBodega("grande", "caja", [cifra(r.grande.cajas, "cajas"), cifra(r.grande.abiertas, "abiertas"), cifra(r.grande.productos, "productos"),
        cifra(r.grande.unidades, "unidades")]),
      tarjetaBodega("pequena", "capas", [cifra(r.pequena.unidades, "unidades"), cifra(r.pequena.productos, "productos")])),
    h("div", { class: "fila fila--entre titulo-seccion" }, h("h2", {}, "Últimos movimientos"),
      boton("", "lista", "Ver todos", { onclick: () => vistaMovimientos() })),
    tablaMovimientos(r.movimientos));
  lector.entrada.focus();
}

// Indicador chico y fijo del estado de SAP (no mueve la pantalla): verde al día, gris sin datos recientes.
function chipSap(r) {
  const s = estadoSap(r);
  return h("p", { class: `chip-sap chip-sap--${s.tipo}`, role: "status" },
    icono(s.tipo === "ok" ? "aceptada" : s.tipo === "alerta" ? "alerta" : "sincronizar"),
    h("span", {}, h("strong", {}, s.texto), h("span", { class: "chip-sap__detalle" }, s.detalle)),
    s.tipo === "alerta" && esSupervisor() && boton("boton--chico", null, "Elegir", { onclick: () => vistaSupervisor("almacenes"), "aria-label": "Elegir almacenes" }));
}

// Puesta en marcha (solo el supervisor): los pasos para dejar el inventario funcionando. Desaparece al completarse.
function puestaEnMarcha(r, supervisor) {
  const { pasos, hechos, completo } = pasosPuestaEnMarcha(r, supervisor?.etiquetas?.sinConfirmar ?? null);
  if (completo) return null;
  const ir = (paso) => (paso.id === "codigos" ? () => vistaSupervisor("etiquetas")
    : paso.bodega && r.bodegas?.[paso.bodega] ? () => vistaConteo({ bodega: paso.bodega }) : () => vistaSupervisor("almacenes"));
  return h("section", { class: "tarjeta puesta", "aria-labelledby": "puesta-titulo" },
    h("div", { class: "fila fila--entre" }, h("h2", { id: "puesta-titulo" }, icono("escudo"), "Puesta en marcha"),
      h("span", { class: "puesta__cuenta" }, `${hechos} de ${pasos.length} listos`)),
    barraAvance({ total: pasos.length, contados: hechos }, "Avance de la puesta en marcha", { texto: `${hechos} de ${pasos.length} pasos` }),
    h("ol", { class: "puesta__pasos" }, pasos.map((paso, i) => h("li", { class: `puesta__paso${paso.hecho ? " puesta__paso--hecho" : ""}` },
      paso.hecho ? h("span", { class: "puesta__marca" }, icono("completa")) : h("span", { class: "puesta__marca puesta__numero" }, String(i + 1)),
      h("div", {}, h("strong", {}, paso.texto), paso.detalle && h("span", { class: "suave" }, paso.detalle)),
      paso.hecho ? h("span", { class: "visualmente-oculto" }, "Listo")
        : boton("", "siguiente", "Hacer", { onclick: ir(paso), "aria-label": `${paso.texto}: hacer` })))));
}

// Buscar un producto por código de barras, código de artículo o nombre. proposito "recibir" lleva a recibirlo.
function vistaBuscar({ texto = "", resultados = null, proposito = null } = {}) {
  const recibir = proposito === "recibir";
  const lista = h("ul", { class: "filas" });
  const vacio = h("p", { class: "suave vacio", hidden: true });
  const elegir = (p) => (recibir ? vistaRecibir(p.itemCode) : vistaProducto(p.itemCode));
  function pintar(filas) {
    lista.replaceChildren(...filas.map((p) => filaAdmin({ nombre: p.itemName,
      detalle: [h("span", { class: "codigo" }, p.itemCode), ...p.codigos.slice(0, 3).map((c) => h("span", { class: "codigo codigo--barras" }, c))],
      acciones: [boton("boton--principal", recibir ? "caja" : "siguiente", recibir ? "Recibir" : "Ver", { onclick: () => elegir(p) })] })));
    vacio.textContent = filas.length ? "" : `Ningún producto coincide con "${texto}".`;
    vacio.hidden = filas.length > 0;
  }
  async function buscar(t) {
    texto = t;
    if (esCodigoCaja(t) && !recibir) return vistaCaja(t.toUpperCase());
    lista.replaceChildren(cargando("Buscando…")); vacio.hidden = true;
    try {
      const filas = (await api.buscarProductos(t)).data;
      const exactos = filas.filter((p) => p.itemCode === t || p.codigos.includes(t));
      if (exactos.length === 1) return elegir(exactos[0]);
      pintar(filas);
    } catch (error) {
      if (error.status === 401) return mostrarError(error);
      lista.replaceChildren(aviso("error", error.mensaje, { role: "alert" }));
    }
  }
  const lector = campoLector({ etiqueta: "Buscar producto", placeholder: "Escaneá un código o escribí el nombre o el código del artículo",
    ayuda: "Escribí y apretá Enter para buscar.", alLeer: buscar });
  mostrarInventario(volverInventario(),
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, recibir ? "Recibir mercadería" : "Consultar un producto"),
      h("p", { class: "encabezado__sub" }, recibir ? "Elegí el producto que llegó." : "Elegí el producto para ver cuánto hay en cada bodega."))),
    lector.seccion, lista, vacio);
  if (resultados) pintar(resultados);
  lector.entrada.focus();
}

// Ficha de un producto: arriba lo que hay que hacer y lo que hay en cada bodega frente a SAP; el detalle (cajas, lotes,
// códigos, documentos y movimientos) queda plegado.
async function vistaProducto(itemCode, mensaje = null) {
  mostrarInventario(cargando("Cargando producto…"));
  let p;
  try { p = (await api.producto(itemCode)).data; } catch (error) { return mostrarError(error, () => vistaProducto(itemCode)); }
  recordarBodegas(p.bodegas);
  const e = p.estado && p.estado.estado !== "sin_comparacion_sap" ? p.estado : null;
  const info = ESTADOS[e?.estado ?? "sin_comparacion_sap"];
  const supervisor = esSupervisor();
  const enGrande = p.lotes.reduce((t, l) => t + l.unidades, 0);
  const cajasGrande = p.lotes.reduce((t, l) => t + l.cajas.filter((c) => c.unidades > 0).length, 0);
  const lotesPequena = (p.lotesPequena ?? []).filter((l) => l.unidades > 0);
  const contadoEn = p.contadoEn ?? { grande: true, pequena: true };
  // Falta contarlo en una bodega si SAP dice que ahí hay y todavía no se contó.
  const faltaContar = (bodega) => !contadoEn[bodega] && (p.sapPorBodega?.[bodega] ?? 0) > 0;
  const contar = (bodega) => faltaContar(bodega)
    && boton(e?.estado === "conteo_inicial" ? "boton--principal" : "", "contar", `Contar en ${bodegaNombre(bodega, { corto: true })}`,
      { onclick: () => vistaConteo({ bodega, itemCode }) });
  const acciones = [
    e?.estado === "por_ubicar" && boton("boton--principal", "caja", "Guardar lo que llegó", { onclick: () => vistaRecibir(itemCode) }),
    e?.estado === "por_descontar" && boton("boton--principal", "restar", "Marcar salida", { onclick: () => vistaDescontar(itemCode) }),
    contar("grande"), contar("pequena"),
    e?.estado !== "por_ubicar" && boton("", "caja", "Recibir", { onclick: () => vistaRecibir(itemCode) }),
    p.porPasar > 0 && boton("boton--principal", "mover", `Aceptar traspaso a ${bodegaNombre("pequena", { corto: true })} (${numero(p.porPasar)})`,
      { onclick: () => vistaTraspaso(itemCode, { desde: "producto" }) }),
    supervisor && contadoEn.grande && boton("", "contar", `Editar conteo de ${bodegaNombre("grande", { corto: true })}`,
      { onclick: () => vistaConteo({ bodega: "grande", itemCode, editar: true }) }),
    supervisor && contadoEn.pequena && boton("", "contar", `Editar conteo de ${bodegaNombre("pequena", { corto: true })}`, { onclick: () => contarPequena(p) }),
  ].filter(Boolean);

  const vencido = (iso) => { const dias = diasParaVencer(iso); return dias !== null && dias < 0; };
  const resumenLotes = (lotes, conCajas) => (lotes.length ? h("ul", { class: "lotes-celda" }, lotes.slice(0, 3).map((l) =>
    h("li", {}, textoLoteBodega({ ...l, cajas: l.cajas?.length ?? 0 }, { conCajas }), vencido(l.vencimiento) && h("span", {}, " ", insignia("error", "alerta", "Vencido")))),
  lotes.length > 3 && h("li", { class: "suave" }, `y ${numero(lotes.length - 3)} lotes más`)) : null);
  // Tarjeta de una bodega: cuánto hay, cuánto dice SAP de su almacén y si falta contarla.
  const tarjeta = (bodega, nombreIcono, unidades, detalle, lotes) => {
    const sap = p.sapPorBodega?.[bodega];
    return h("section", { class: `tarjeta bodega-producto${faltaContar(bodega) ? " bodega-producto--sin-contar" : ""}`, "aria-label": bodegaNombre(bodega) },
      h("div", { class: "fila fila--entre" }, h("h2", {}, icono(nombreIcono), bodegaNombre(bodega)),
        faltaContar(bodega) && insignia("gris", null, "Falta contar")),
      h("p", { class: "bodega-producto__cifra" }, h("strong", {}, numero(unidades)), " ", detalle,
        h("span", { class: "bodega-producto__sap" }, sap === null || sap === undefined ? "SAP —" : `SAP ${numero(sap)}`)),
      lotes);
  };

  const tablaCajas = p.lotes.length === 0 ? h("p", { class: "suave" }, `No hay cajas de este producto en ${bodegaNombre("grande", { corto: true })}.`)
    : h("div", { class: "tabla-envoltura" }, h("table", { class: "tabla" },
      h("thead", {}, h("tr", {}, ["Lote", "Vence", "Cajas", "Unidades"].map((t) => h("th", { scope: "col", class: t === "Unidades" ? "tabla__numero" : null }, t)))),
      h("tbody", {}, p.lotes.map((l) => h("tr", {},
        h("th", { scope: "row", class: "codigo" }, l.lote ?? "Sin lote"),
        h("td", {}, textoVencimiento(l.vencimiento), vencido(l.vencimiento) && h("span", {}, " ", insignia("error", "alerta", "Vencido"))),
        h("td", {}, h("div", {}, [l.cerradas && `${numero(l.cerradas)} cerradas`, l.abiertas && `${numero(l.abiertas)} abiertas`].filter(Boolean).join(" · ")),
          h("div", { class: "cajas-lote" }, l.cajas.map((c) => h("button", { class: `chip-caja${c.abierta ? " chip-caja--abierta" : ""}`, type: "button",
            onclick: () => vistaCaja(c.codigo), title: `Abrir ${c.codigo}` }, c.codigo, h("span", {}, `${numero(c.unidades)}/${numero(c.unidadesIniciales)}`))))),
        h("td", { class: "tabla__numero" }, h("strong", {}, numero(l.unidades))))))));
  const tablaLotesPequena = lotesPequena.length === 0 ? h("p", { class: "suave" }, `No hay unidades de este producto en ${bodegaNombre("pequena", { corto: true })}.`)
    : h("div", { class: "tabla-envoltura" }, h("table", { class: "tabla" },
      h("thead", {}, h("tr", {}, ["Lote", "Vence", "Unidades"].map((t) => h("th", { scope: "col", class: t === "Unidades" ? "tabla__numero" : null }, t)))),
      h("tbody", {}, lotesPequena.map((l) => h("tr", {}, h("th", { scope: "row", class: "codigo" }, l.lote ?? "Sin lote"),
        h("td", {}, textoVencimiento(l.vencimiento), vencido(l.vencimiento) && h("span", {}, " ", insignia("error", "alerta", "Vencido"))),
        h("td", { class: "tabla__numero" }, h("strong", {}, numero(l.unidades))))))));
  // Detalle plegado: se abre tocando el título.
  const plegado = (nombreIcono, titulo, n, ...contenido) => h("details", { class: "plegado" },
    h("summary", {}, icono(nombreIcono), h("span", {}, titulo), n !== null && h("span", { class: "contador" }, numero(n))), h("div", { class: "plegado__cuerpo" }, contenido));

  const ORIGEN = { sap: "SAP", ficha: "Ficha del artículo", app: "Registrado en la app" };
  const { desdeLista, desdeConteo, desdeBodegas } = estado;
  const volver = desdeBodegas ? volverA("Bodegas", () => vistaBodegas(desdeBodegas))
    : desdeLista ? volverA("Productos", () => vistaProductos(desdeLista))
    : desdeConteo?.almacen ? volverA(`Contar la ${desdeConteo.almacen}`, () => vistaConteo({ almacen: desdeConteo.almacen }))
    : desdeConteo ? volverA(`Contar ${bodegaNombre(desdeConteo, { corto: true })}`, () => vistaConteo({ bodega: desdeConteo }))
      : volverInventario();
  (desdeBodegas ? mostrarBodegas : mostrarInventario)(volver,
    h("div", { class: "encabezado" }, h("div", {}, h("span", { class: "rotulo" }, "Producto"), h("h1", {}, p.itemName),
      h("p", { class: "encabezado__sub" }, h("span", { class: "codigo" }, p.itemCode), " ",
        info && insignia(info.tipo, info.tipo === "ok" ? "completa" : info.tipo === "gris" ? null : "alerta", info.texto)))),
    mensaje && aviso(mensaje.tipo, mensaje.texto, { role: "status" }),
    h("div", { class: "fila acciones-producto" }, acciones),
    h("p", { class: "estado-producto__texto" }, textoEstado(e),
      e?.sinEntrega > 0 ? ` Hay ${unidadesTexto(e.sinEntrega)} preparadas sin entregar.` : "",
      p.porPasar > 0 ? ` SAP pasó ${unidadesTexto(p.porPasar)} a ${bodegaNombre("pequena", { corto: true })}: falta aceptar de qué lotes.` : ""),
    h("div", { class: "bodegas ficha-bodegas" },
      tarjeta("grande", "caja", enGrande, cajasGrande ? `en ${numero(cajasGrande)} ${cajasGrande === 1 ? "caja" : "cajas"}` : "", resumenLotes(p.lotes, true)),
      tarjeta("pequena", "capas", p.pequena, Math.abs(p.pequena) === 1 ? "unidad" : "unidades",
        [p.pequena < 0 && aviso("alerta", "Hay un saldo negativo antiguo. Hasta que el supervisor la cuente por lote no se puede pasar ni recibir ahí."),
          resumenLotes(lotesPequena, false)])),
    p.codigos.length === 0 && aviso("alerta", "Este producto no tiene código de barras: no se puede escanear en pedidos. Escanealo del envase para registrarlo.", {},
      boton("", "escaner", "Registrar código", { onclick: () => registrarCodigoEnFicha(p) })),
    plegado("caja", `Cajas de ${bodegaNombre("grande", { corto: true })}`, cajasGrande, tablaCajas),
    plegado("capas", `Lotes de ${bodegaNombre("pequena", { corto: true })}`, lotesPequena.length, tablaLotesPequena,
      lotesPequena.some((l) => !l.lote) && h("p", { class: "suave nota" }, icono("info"),
        "«Sin lote» incluye lo que había antes del control por lotes. Al contarla de nuevo se puede repartir en sus lotes.")),
    plegado("escaner", "Códigos de barras", p.codigos.length + (p.codigosCaja?.length ?? 0),
      p.codigos.length > 0 && h("ul", { class: "codigos" }, p.codigos.map((c) => h("li", {}, h("span", { class: "codigo" }, c.codigo),
        h("span", { class: "suave" }, c.origen === "app" && c.registradoPor ? `Registrado por ${c.registradoPor}` : ORIGEN[c.origen] ?? c.origen),
        c.confirmado ? insignia("ok", "completa", "Confirmado") : insignia("alerta", "alerta", "Sin confirmar"),
        supervisor && c.origen === "app" && boton("", "borrar", "Quitar", { onclick: () => quitarCodigoEnFicha(p, c), "aria-label": `Quitar el código ${c.codigo}` })))),
      boton("", "mas", "Registrar un código", { onclick: () => registrarCodigoEnFicha(p) }),
      h("h3", { class: "codigos__titulo" }, "De la caja"),
      p.codigosCaja?.length ? h("ul", { class: "codigos" }, p.codigosCaja.map((c) => h("li", {}, h("span", { class: "codigo" }, c.codigo),
        h("span", { class: "suave" }, c.registradoPor ? `Registrado por ${c.registradoPor}` : "Caja del proveedor"),
        supervisor && boton("", "borrar", "Quitar", { onclick: () => quitarCodigoCajaEnFicha(p, c), "aria-label": `Quitar el código de caja ${c.codigo}` }))))
        : h("p", { class: "suave" }, `Sin código de caja. Se registra al contar ${bodegaNombre("grande", { corto: true })}.`)),
    plegado("lista", "Documentos recientes de SAP", p.documentos.length,
      p.documentos.length ? h("ul", { class: "documentos" }, p.documentos.map((d) => h("li", {}, h("strong", {}, textoDocumento(d)),
        h("span", {}, `${fecha(d.docDate)} · ${numero(d.cantidad)} u.`), d.comentarios && h("span", { class: "suave" }, d.comentarios))))
        : h("p", { class: "suave" }, "No hay documentos de los últimos 60 días.")),
    plegado("actualizar", "Movimientos", p.movimientos.length, tablaMovimientos(p.movimientos, { conProducto: false })));
}

// Registrar un código desde la ficha (cualquiera) y quitar uno registrado desde la app (supervisor).
async function registrarCodigoEnFicha(p) {
  const registrado = await registrarCodigo({ producto: p });
  if (registrado) vistaProducto(p.itemCode, { tipo: "ok", texto: `${registrado.codigo} quedó registrado y confirmado como unidad.` });
}
async function quitarCodigoEnFicha(p, c) {
  if (!(await confirmar({ titulo: `¿Quitar el código ${c.codigo}?`, aceptar: "Quitar", peligro: true,
    texto: [`Deja de ser de ${p.itemName}: al escanearlo en un pedido ya no se reconoce.`, "Si era de otro producto, después registralo para ese."] }))) return;
  try {
    await api.quitarCodigo(c.id);
    vistaProducto(p.itemCode, { tipo: "ok", texto: `Se quitó el código ${c.codigo}.` });
  } catch (error) {
    if (error.status === 401) return mostrarError(error);
    vistaProducto(p.itemCode, { tipo: "error", texto: textoFalla(error) });
  }
}

async function quitarCodigoCajaEnFicha(p, c) {
  if (!(await confirmar({ titulo: `¿Quitar el código de caja ${c.codigo}?`, aceptar: "Quitar", peligro: true,
    texto: [`Deja de reconocerse como caja de ${p.itemName} al pasar cajas a ${bodegaNombre("pequena", { corto: true })}.`] }))) return;
  try {
    await api.quitarCodigoCaja(c.id);
    vistaProducto(p.itemCode, { tipo: "ok", texto: `Se quitó el código de caja ${c.codigo}.` });
  } catch (error) {
    if (error.status === 401) return mostrarError(error);
    vistaProducto(p.itemCode, { tipo: "error", texto: textoFalla(error) });
  }
}

// Volver a contar la bodega de despacho por lote (supervisor): una fila por lote que el sistema conoce y las que se
// agreguen. Reemplaza lo que había. Se manda el detalle siempre, así cada unidad conserva su lote.
function contarPequena(p, { alTerminar = (texto) => vistaProducto(p.itemCode, { tipo: "ok", texto }) } = {}) {
  const operacion = crearOperacion();
  const error = aviso("error", "", { role: "alert", hidden: true });
  const total = h("p", { class: "conteo__total", "aria-live": "polite" });
  const lista = h("ul", { class: "conteo-lotes" });
  const filas = [];
  let n = 0;
  function agregar(lote = null) {
    const id = `conteo-${n++}`;
    const unidades = h("input", { id: `${id}-u`, class: "campo campo--numero", type: "number", min: "0", inputmode: "numeric",
      placeholder: lote ? `sistema: ${numero(lote.unidades)}` : "0" });
    const fila = { lote, unidades };
    if (lote) {
      // Precargado con lo que hay: solo se cambia lo que no coincide.
      unidades.value = String(lote.unidades);
      // La fecha se puede corregir; si no se cambia el mes, vuelve la fecha guardada tal cual.
      fila.vence = h("input", { id: `${id}-v`, class: "campo", type: "month" });
      ponerMes(fila.vence, lote.vencimiento ? String(lote.vencimiento).slice(0, 10) : null);
      lista.append(h("li", { class: "conteo-lotes__nuevo" },
        h("div", { class: "conteo-lotes__nombre" }, h("strong", {}, lote.lote ? `Lote ${lote.lote}` : "Sin lote"),
          h("span", { class: "suave" }, `Sistema: ${unidadesTexto(lote.unidades)}`)),
        h("label", { for: `${id}-v` }, h("span", {}, "Vence"), fila.vence),
        h("label", { for: `${id}-u` }, h("span", {}, "Unidades"), unidades)));
    } else {
      fila.nombre = h("input", { id: `${id}-l`, class: "campo codigo", maxlength: "60", autocomplete: "off", spellcheck: "false", placeholder: "Sin lote" });
      fila.vence = h("input", { id: `${id}-v`, class: "campo", type: "month" });
      lista.append(h("li", { class: "conteo-lotes__nuevo" },
        h("label", { for: `${id}-l` }, h("span", {}, "Lote"), fila.nombre),
        h("label", { for: `${id}-v` }, h("span", {}, "Vence"), fila.vence),
        h("label", { for: `${id}-u` }, h("span", {}, "Unidades"), unidades)));
    }
    filas.push(fila);
    pintar();
    return unidades;
  }
  function leer() {
    const vacios = filas.some((f) => f.unidades.value === "" && (f.lote || f.nombre.value.trim()));
    if (vacios) return { problema: "Escribí cuántas unidades hay de cada lote (0 si no hay ninguna)." };
    // Las filas en 0 no se mandan: el conteo reemplaza todo lo que había en la 02.
    const conUnidades = filas.filter((f) => f.unidades.value !== "" && Number(f.unidades.value) !== 0);
    if (conUnidades.some((f) => f.vence.value && !finDeMes(f.vence.value))) return { problema: "Un vencimiento no es válido: el año va completo, por ejemplo 2028." };
    return armarConteo(conUnidades.map((f) => ({
      lote: f.lote ? f.lote.lote ?? null : f.nombre.value.trim() || null,
      vencimiento: f.vence.value ? mesGuardado(f.vence) : null,
      unidades: Number(f.unidades.value) })));
  }
  function pintar() {
    const r = leer();
    total.textContent = r.problema ? "" : `Total contado: ${unidadesTexto(r.unidades)} (el sistema tiene ${numero(p.pequena)}).`;
  }
  const existentes = (p.lotesPequena ?? []).filter((l) => l.unidades > 0);
  for (const l of existentes) agregar(l);
  if (!existentes.length) agregar();
  const guardar = h("button", { class: "boton boton--principal", type: "submit" }, "Guardar conteo");
  dialogo.replaceChildren(h("form", { class: "dialogo__formulario", oninput: pintar, onsubmit: async (evento) => {
    evento.preventDefault();
    const r = leer();
    if (r.problema) { textoAviso(error, r.problema); error.hidden = false; return; }
    error.hidden = true; guardar.disabled = true;
    try {
      const { data } = await api.contarPequena(p.itemCode, operacion.para({ unidades: r.unidades, lotes: r.lotes }));
      operacion.terminar();
      dialogo.close();
      alTerminar(data.cambio === 0 ? "Conteo guardado: el total coincide con el sistema."
        : `${conMayuscula(bodegaNombre("pequena", { corto: true }))} quedó con ${unidadesTexto(data.pequena)} (${data.cambio > 0 ? "+" : ""}${numero(data.cambio)}).`);
    } catch (e) {
      guardar.disabled = false;
      if (e.status === 401) { dialogo.close(); return mostrarError(e); }
      textoAviso(error, textoFalla(e)); error.hidden = false;
    }
  } },
  h("div", { class: "dialogo__cuerpo" }, h("h2", {}, `Editar conteo de ${bodegaNombre("pequena", { corto: true })}`),
    h("p", {}, `${p.itemName}. Contá cada lote por separado. Si encontrás un lote que no está en la lista, agregalo.`),
    error, lista,
    h("button", { class: "boton", type: "button", onclick: () => agregar().focus() }, icono("mas"), "Agregar un lote"),
    total),
  h("div", { class: "dialogo__acciones" },
    h("button", { class: "boton", type: "button", onclick: () => dialogo.close() }, "Cancelar"), guardar)));
  dialogo.onclose = null;
  dialogo.showModal();
  filas[0]?.unidades.focus();
}

// Una sola lista de productos con tres pestañas: las dos bodegas juntas (con lo que SAP tiene en los almacenes
// marcados) y cada bodega por lote (con lo que SAP tiene en su almacén). Los filtros y las columnas están siempre; lo
// que no aplica queda deshabilitado o con "—". Escribir filtra la lista; un código leído con Enter abre el producto.
// vista "almacen" (desde el panel del supervisor): lo que SAP tiene en un almacén.
async function vistaProductos({ vista = "todos", buscar = "", filtro = "todos", pagina = 0, almacen = null } = {}) {
  estado.desdeLista = null; estado.desdeConteo = null; estado.desdeBodegas = null;
  // Los nombres de las bodegas para las pestañas, si todavía no se cargó el inventario.
  if (estado.bodegas === undefined && vista !== "almacen") {
    mostrarInventario(cargando("Cargando productos…"));
    try { recordarBodegas((await api.inventario()).data.bodegas); } catch (error) { if (error.status === 401) return mostrarError(error); }
  }
  const deAlmacen = vista === "almacen";
  const abrir = (itemCode) => { estado.desdeLista = { vista, buscar, filtro, pagina, almacen }; vistaProducto(itemCode); };
  let almacenesSap = null; // la lista para elegir, se pide una vez
  const buscador = h("input", { class: "buscador__campo", type: "search", value: buscar, autocomplete: "off", spellcheck: "false",
    placeholder: "Buscar por nombre o código, o escaneá el producto", "aria-label": "Buscar producto" });
  const vistas = [["todos", "Las dos"], ["grande", bodegaNombre("grande")], ["pequena", bodegaNombre("pequena")]];
  const pestanas = !deAlmacen && h("nav", { class: "pestanas", "aria-label": "Qué bodega" }, vistas.map(([id, texto]) =>
    h("button", { class: "pestana", type: "button", "aria-current": id === vista ? "page" : null,
      onclick: () => vistaProductos({ vista: id, buscar: buscador.value.trim() }) }, texto)));
  const filtros = h("div", { class: "filtros", role: "group", "aria-label": "Mostrar" });
  const nota = h("div", {});
  const contenido = h("div", { "aria-live": "polite" });
  const pie = h("div", { class: "fila fila--entre" });
  let vez = 0, espera = null;
  // Los filtros que no aplican quedan a la vista, deshabilitados, con el motivo abajo.
  function pintarFiltros(lista) {
    const motivos = lista.filter((f) => f.motivo);
    poner(filtros, lista.map((f) => h("button", { class: "filtro", type: "button", disabled: Boolean(f.motivo), title: f.motivo ?? null,
      "aria-pressed": String(f.id === filtro), onclick: () => { filtro = f.id; pagina = 0; cargar(); } },
    f.texto, h("span", { class: "n" }, f.motivo ? "—" : numero(f.n)))),
    motivos.length > 0 && h("p", { class: "filtros__motivo suave" }, motivos.map((f) => `${f.texto}: ${f.motivo.charAt(0).toLowerCase()}${f.motivo.slice(1)}.`).join(" ")));
  }
  const llegada = (r) => (r.existenciasSapAl ? `existencias de SAP ${hace(r.existenciasSapAl)}` : "todavía no llegaron existencias de SAP");
  const vacio = () => aviso("info", buscar ? `Ningún producto coincide con "${buscar}".`
    : filtro !== "todos" ? "No hay productos en este filtro." : vista === "todos" ? "Todavía no hay productos en las bodegas." : "Todavía no hay nada en esta bodega.");
  const nombreProducto = (v) => h("th", { scope: "row" }, h("button", { class: "enlace", type: "button", onclick: () => abrir(v.itemCode) }, v.itemName),
    h("div", { class: "codigo suave" }, v.itemCode, v.porVencer && h("span", {}, " ", insignia("alerta", "calendario", "Por vencer"))));
  const tabla = (columnas, filas) => h("div", { class: "tabla-envoltura" }, h("table", { class: "tabla tabla--productos" },
    h("thead", {}, h("tr", {}, columnas.map(([t, numerica]) => h("th", { scope: "col", class: numerica ? "tabla__numero" : null }, t)))),
    h("tbody", {}, filas)));
  const sinElegir = (texto) => aviso("info", texto, {}, esSupervisor() && boton("", "bodega", "Elegir almacenes", { onclick: () => vistaSupervisor("almacenes") }));

  function pintarTodos(r) {
    const conSap = r.almacenes.length > 0, comparar = r.comparacionDisponible === true;
    pintarFiltros(filtrosExistencias(r));
    const en = r.almacenes.length === 1 ? `el almacén ${r.almacenes[0]}` : `los almacenes ${r.almacenes.slice(0, -1).join(", ")} y ${r.almacenes.at(-1)}`;
    poner(nota, !conSap ? sinElegir("Para ver lo que tiene SAP, el supervisor marca los almacenes de esta bodega.")
      : h("p", { class: "suave nota" }, icono("info"), `"En SAP" es lo que SAP tiene en ${en} (${llegada(r)}).`,
        comparar ? "" : " Sin datos recientes, no se compara."));
    if (!r.data.length) return contenido.replaceChildren(vacio());
    contenido.replaceChildren(tabla([["Producto"], [`En ${bodegaNombre("grande", { corto: true })}`, true], [`En ${bodegaNombre("pequena", { corto: true })}`, true],
      ["En SAP", true], ["Estado"]],
    r.data.map((v) => {
      const e = estadoFila(v);
      return h("tr", {}, nombreProducto(v),
        h("td", { class: "tabla__numero" }, h("strong", {}, numero(v.grande)),
          v.cajas > 0 && h("div", { class: "suave" }, `${numero(v.cajas)} ${v.cajas === 1 ? "caja" : "cajas"}`)),
        h("td", { class: "tabla__numero" }, h("strong", {}, numero(v.pequena))),
        h("td", { class: "tabla__numero" }, v.sap === null ? h("span", { class: "suave" }, "—") : numero(v.sap)),
        h("td", {}, e ? insignia(e.tipo, e.tipo === "ok" ? "completa" : e.tipo === "gris" ? null : "alerta", e.texto) : insignia("gris", null, "Sin datos")));
    })));
  }

  function pintarBodega(r) {
    const grande = vista === "grande";
    pintarFiltros(filtrosBodega(r));
    const cifras = `${numero(r.resumen.productos)} ${r.resumen.productos === 1 ? "producto" : "productos"} · ${unidadesTexto(r.resumen.unidades)}`
      + (grande ? ` en ${numero(r.resumen.cajas)} ${r.resumen.cajas === 1 ? "caja" : "cajas"}` : "");
    poner(nota, h("p", { class: "cifras-bodega" }, h("strong", {}, cifras)),
      r.almacen ? h("p", { class: "suave nota" }, icono("info"), `"En SAP" es lo que SAP tiene en el almacén ${r.almacen} (${llegada(r)}).`)
        : sinElegir("Para ver lo que SAP tiene en esta bodega, el supervisor elige su almacén en Panel del supervisor → Almacenes."));
    if (!r.data.length) return contenido.replaceChildren(vacio());
    contenido.replaceChildren(tabla([["Producto"], ["Lotes"], grande && ["Cajas", true], ["Unidades", true], ["En SAP", true]].filter(Boolean),
      r.data.map((v) => h("tr", { class: v.contado === false ? "fila--sin-registrar" : null }, nombreProducto(v),
        h("td", {}, v.lotes.length ? h("ul", { class: "lotes-celda" }, v.lotes.map((l) => {
          const dias = diasParaVencer(l.vencimiento);
          return h("li", {}, textoLoteBodega(l, { conCajas: grande }), dias !== null && dias < 0 && h("span", {}, " ", insignia("error", "alerta", "Vencido")));
        })) : v.contado === false ? insignia("gris", null, "Falta contar") : h("span", { class: "suave" }, "No hay")),
        grande && h("td", { class: "tabla__numero" }, numero(v.cajas)),
        h("td", { class: "tabla__numero" }, h("strong", {}, numero(v.unidades))),
        h("td", { class: "tabla__numero" }, v.sap === null ? h("span", { class: "suave" }, "—") : numero(v.sap))))));
  }

  // Lo que SAP tiene en un almacén: se elige el almacén y se ve producto por producto.
  async function pedirAlmacen() {
    almacenesSap ??= (await api.almacenesSap()).data;
    if (!almacenesSap.some((a) => a.warehouseCode === almacen)) almacen = almacenesSap[0]?.warehouseCode ?? null;
    return almacen ? api.productosDeAlmacen(almacen, { buscar, pagina }) : null;
  }
  function pintarAlmacen(r) {
    const selector = h("select", { id: "productos-almacen", class: "campo", onchange: (evento) => { almacen = evento.target.value; pagina = 0; cargar(); } },
      almacenesSap.map((a) => h("option", { value: a.warehouseCode }, `${a.warehouseCode} · ${a.warehouseName}${a.bodega ? ` (${a.bodega === "grande" ? "bodega de cajas" : "bodega de despacho"})` : ""}`)));
    selector.value = almacen;
    filtros.replaceChildren(h("label", { class: "campo-etiqueta selector-almacen", for: "productos-almacen" }, h("span", {}, "Almacén de SAP"), selector));
    poner(nota, h("p", { class: "cifras-bodega" }, h("strong", {}, `${numero(r.resumen.productos)} ${r.resumen.productos === 1 ? "producto" : "productos"} · ${numero(r.resumen.unidades)} unidades en stock`)),
      h("p", { class: "suave nota" }, icono("info"), `Lo que SAP tiene en el almacén ${r.almacen.warehouseCode} · ${r.almacen.warehouseName} (${llegada(r)}).`,
        " Disponible = en stock − comprometido en pedidos + pedido a proveedores."));
    if (!r.data.length) return contenido.replaceChildren(aviso("info", buscar ? `Ningún producto coincide con "${buscar}".` : "SAP no tiene productos en este almacén."));
    contenido.replaceChildren(tabla([["Producto"], ["En stock", true], ["Comprometido", true], ["Pedido", true], ["Disponible", true]],
      r.data.map((v) => h("tr", {}, nombreProducto(v),
        h("td", { class: "tabla__numero" }, h("strong", {}, numero(v.enStock))),
        h("td", { class: "tabla__numero" }, numero(v.comprometido)),
        h("td", { class: "tabla__numero" }, numero(v.pedido)),
        h("td", { class: "tabla__numero" }, numero(v.disponible))))));
  }

  async function cargar() {
    const esta = ++vez;
    contenido.replaceChildren(cargando("Cargando productos…"));
    let r;
    try {
      r = vista === "todos" ? await api.existencias({ buscar, filtro, pagina })
        : deAlmacen ? await pedirAlmacen() : await api.bodega(vista, { buscar, filtro, pagina });
    } catch (error) {
      if (error.status === 401) return mostrarError(error);
      return contenido.replaceChildren(aviso("error", error.mensaje, { role: "alert" }));
    }
    if (esta !== vez) return; // ya se pidió otra búsqueda
    if (!r) {
      filtros.replaceChildren(); pie.replaceChildren();
      return contenido.replaceChildren(aviso("info", "Todavía no llegaron almacenes con existencias de SAP. Revisá en Panel → Sincronización que el puente esté enviando almacenes y existencias."));
    }
    if (vista === "todos") pintarTodos(r); else if (deAlmacen) pintarAlmacen(r); else pintarBodega(r);
    const paginas = Math.max(1, Math.ceil(r.total / 50));
    pie.replaceChildren(h("span", { class: "suave" }, `${numero(r.total)} ${r.total === 1 ? "producto" : "productos"} · página ${pagina + 1} de ${paginas}`),
      h("div", { class: "fila" },
        boton("", "volver", "Anterior", { disabled: pagina === 0, onclick: () => { pagina--; cargar(); } }),
        boton("", "siguiente", "Siguiente", { disabled: pagina + 1 >= paginas, onclick: () => { pagina++; cargar(); } })));
  }
  buscador.addEventListener("input", () => {
    clearTimeout(espera);
    espera = setTimeout(() => { buscar = buscador.value.trim(); pagina = 0; cargar(); }, 350);
  });
  // El lector termina con Enter: una caja o un código exacto abre directo; si no, queda la lista filtrada.
  buscador.addEventListener("keydown", async (evento) => {
    if (evento.key !== "Enter") return;
    evento.preventDefault();
    clearTimeout(espera);
    const t = buscador.value.trim();
    if (!t) return;
    if (esCodigoCaja(t)) return vistaCaja(t.toUpperCase());
    try {
      const exactos = (await api.buscarProductos(t)).data.filter((p) => p.itemCode === t || p.codigos.includes(t) || p.codigosCaja?.includes(t));
      if (exactos.length === 1) return abrir(exactos[0].itemCode);
    } catch (error) { if (error.status === 401) return mostrarError(error); }
    buscar = t; pagina = 0; cargar();
  });
  limpiezas.push(() => clearTimeout(espera));
  const subtitulo = { todos: "Lo que hay en las dos bodegas y lo que dice SAP. Tocá un producto para ver sus lotes, cajas y movimientos.",
    grande: "Las cajas de esta bodega, por lote.", pequena: "Lo suelto de esta bodega, por lote.",
    almacen: "Lo que SAP tiene en cada almacén (solo lectura)." }[vista];
  mostrarInventario(deAlmacen ? volverA("Panel del supervisor", () => vistaSupervisor("almacenes")) : volverInventario(),
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, deAlmacen ? "Almacén de SAP" : "Productos"), h("p", { class: "encabezado__sub" }, subtitulo))),
    pestanas, h("label", { class: "buscador" }, icono("buscar"), buscador), filtros, nota, contenido, pie);
  buscador.focus();
  cargar();
}

// Bodegas: lo que tiene cada almacén marcado de esta bodega. Una pestaña por almacén con lo que SAP tiene ahí (en
// stock, comprometido, pedido y disponible) y, en la de cajas y la de despacho, lo registrado en la app. Escribir filtra
// la lista; un código leído con Enter abre el producto.
async function vistaBodegas({ almacen = null, buscar = "", pagina = 0 } = {}) {
  estado.desdeLista = null; estado.desdeConteo = null; estado.desdeBodegas = null;
  mostrarBodegas(cargando("Cargando bodegas…"));
  let almacenes;
  // Primero la bodega de cajas, después la de despacho y el resto por código.
  const orden = (a) => (a.bodega === "grande" ? 0 : a.bodega === "pequena" ? 1 : 2);
  try {
    almacenes = (await api.almacenesSap()).data.filter((a) => a.deEstaBodega)
      .sort((a, b) => orden(a) - orden(b) || a.warehouseCode.localeCompare(b.warehouseCode));
  } catch (error) {
    return mostrarError(error, () => vistaBodegas({ almacen, buscar, pagina }));
  }
  const encabezado = h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, "Bodegas"),
    h("p", { class: "encabezado__sub" }, "Lo que tiene cada almacén de esta bodega: lo que dice SAP y, en la bodega de cajas y la de despacho, lo registrado en la app.")));
  if (!almacenes.length) {
    return mostrarBodegas(encabezado, aviso("info", "Todavía no hay almacenes marcados. El supervisor los marca en Panel del supervisor → Almacenes.", {},
      esSupervisor() && boton("", "bodega", "Elegir almacenes", { onclick: () => vistaSupervisor("almacenes") })));
  }
  if (!almacenes.some((a) => a.warehouseCode === almacen)) almacen = (almacenes.find((a) => a.bodega === "grande") ?? almacenes[0]).warehouseCode;
  const actual = almacenes.find((a) => a.warehouseCode === almacen);
  const deApp = actual.bodega !== null;
  const abrir = (itemCode) => { estado.desdeBodegas = { almacen, buscar, pagina }; vistaProducto(itemCode); };
  const PAPEL = { grande: "Bodega de cajas completas", pequena: "Bodega de despacho (de donde salen los pedidos)" };

  const pestanas = h("nav", { class: "pestanas", "aria-label": "Qué almacén" }, almacenes.map((a) =>
    h("button", { class: "pestana", type: "button", "aria-current": a.warehouseCode === almacen ? "page" : null,
      onclick: () => vistaBodegas({ almacen: a.warehouseCode }) },
    `${a.warehouseCode} · ${a.warehouseName}`, h("span", { class: "contador", "aria-label": `${numero(a.productos)} productos` }, numero(a.productos)))));
  const buscador = h("input", { class: "buscador__campo", type: "search", value: buscar, autocomplete: "off", spellcheck: "false",
    placeholder: "Buscar por nombre o código, o escaneá el producto", "aria-label": "Buscar producto" });
  const nota = h("div", {});
  const contenido = h("div", { "aria-live": "polite" });
  const pie = h("div", { class: "fila fila--entre" });
  let vez = 0, espera = null;

  function pintar(r) {
    const cifras = `${numero(r.resumen.productos)} ${r.resumen.productos === 1 ? "producto" : "productos"} · ${unidadesTexto(r.resumen.unidades)} en stock según SAP`
      + (deApp ? ` · ${unidadesTexto(r.resumen.enBodega ?? 0)} registradas en la app` : "");
    poner(nota, h("div", { class: "fila fila--entre" },
      h("div", {}, h("p", { class: "rotulo" }, actual.bodega ? PAPEL[actual.bodega] : "Almacén marcado, sin bodega asignada"),
        h("p", { class: "cifras-bodega" }, h("strong", {}, cifras))),
      deApp && boton("", "siguiente", "Ver por lote", { onclick: () => vistaProductos({ vista: actual.bodega }) })),
    h("p", { class: "suave nota" }, icono("info"), `SAP: ${r.existenciasSapAl ? `existencias ${hace(r.existenciasSapAl)}` : "todavía no llegaron existencias"}.`,
      " Disponible = en stock − comprometido en pedidos + pedido a proveedores.",
      deApp ? ` "En la bodega" es lo registrado en la app en ${bodegaNombre(actual.bodega, { corto: true })}.` : ""));
    if (!r.data.length) return contenido.replaceChildren(aviso("info", buscar ? `Ningún producto coincide con "${buscar}".` : "No hay productos en este almacén."));
    const columnas = [["Producto"], ["En stock", true], ["Comprometido", true], ["Pedido", true], ["Disponible", true], deApp && ["En la bodega", true]].filter(Boolean);
    contenido.replaceChildren(h("div", { class: "tabla-envoltura" }, h("table", { class: "tabla tabla--productos" },
      h("thead", {}, h("tr", {}, columnas.map(([t, numerica]) => h("th", { scope: "col", class: numerica ? "tabla__numero" : null }, t)))),
      h("tbody", {}, r.data.map((v) => h("tr", {},
        h("th", { scope: "row" }, h("button", { class: "enlace", type: "button", onclick: () => abrir(v.itemCode) }, v.itemName),
          h("div", { class: "codigo suave" }, v.itemCode)),
        h("td", { class: "tabla__numero" }, h("strong", {}, numero(v.enStock))),
        h("td", { class: "tabla__numero" }, numero(v.comprometido)),
        h("td", { class: "tabla__numero" }, numero(v.pedido)),
        h("td", { class: "tabla__numero" }, numero(v.disponible)),
        deApp && h("td", { class: "tabla__numero" }, h("strong", {}, numero(v.enBodega ?? 0)),
          v.cajas > 0 && h("div", { class: "suave" }, `${numero(v.cajas)} ${v.cajas === 1 ? "caja" : "cajas"}`))))))));
  }
  async function cargar() {
    const esta = ++vez;
    contenido.replaceChildren(cargando("Cargando productos…"));
    let r;
    try { r = await api.productosDeAlmacen(almacen, { buscar, pagina }); } catch (error) {
      if (error.status === 401) return mostrarError(error);
      return contenido.replaceChildren(aviso("error", error.mensaje, { role: "alert" }));
    }
    if (esta !== vez) return;
    pintar(r);
    const paginas = Math.max(1, Math.ceil(r.total / 50));
    pie.replaceChildren(h("span", { class: "suave" }, `${numero(r.total)} ${r.total === 1 ? "producto" : "productos"} · página ${pagina + 1} de ${paginas}`),
      h("div", { class: "fila" },
        boton("", "volver", "Anterior", { disabled: pagina === 0, onclick: () => { pagina--; cargar(); } }),
        boton("", "siguiente", "Siguiente", { disabled: pagina + 1 >= paginas, onclick: () => { pagina++; cargar(); } })));
  }
  buscador.addEventListener("input", () => {
    clearTimeout(espera);
    espera = setTimeout(() => { buscar = buscador.value.trim(); pagina = 0; cargar(); }, 350);
  });
  buscador.addEventListener("keydown", async (evento) => {
    if (evento.key !== "Enter") return;
    evento.preventDefault();
    clearTimeout(espera);
    const t = buscador.value.trim();
    if (!t) return;
    if (esCodigoCaja(t)) return vistaCaja(t.toUpperCase());
    try {
      const exactos = (await api.buscarProductos(t)).data.filter((p) => p.itemCode === t || p.codigos.includes(t) || p.codigosCaja?.includes(t));
      if (exactos.length === 1) return abrir(exactos[0].itemCode);
    } catch (error) { if (error.status === 401) return mostrarError(error); }
    buscar = t; pagina = 0; cargar();
  });
  limpiezas.push(() => clearTimeout(espera));
  mostrarBodegas(encabezado, pestanas, h("label", { class: "buscador" }, icono("buscar"), buscador), nota, contenido, pie);
  buscador.focus();
  cargar();
}

function vistaReponer() {
  const lector = campoLector({ etiqueta: "Caja", placeholder: "Escaneá la etiqueta de la caja que vas a abrir",
    ayuda: "Si la caja no tiene etiqueta, buscá el producto y tocá «Pasar» en su ficha.", alLeer: (t) => leerEnInventario(t) });
  mostrarInventario(volverInventario(),
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, `Pasar a ${bodegaNombre("pequena", { corto: true })}`),
      h("p", { class: "encabezado__sub" }, `Unidades de una caja de ${bodegaNombre("grande", { corto: true })} a ${bodegaNombre("pequena", { corto: true })}.`))),
    lector.seccion);
  lector.entrada.focus();
}

// Aceptar un traspaso de la grande a la pequeña que SAP ya registró. SAP solo dice cuántas unidades pasaron. Se elige el
// lote y vencimiento que dicen las cajas (viene marcado el que vence primero; si se elige uno que vence después, avisa)
// y se escanea el código de barras de cada caja (el de la caja del proveedor, igual en todas). Solo cajas enteras. El supervisor puede
// aceptar sin escanear: la sugerencia por lote o eligiendo otros lotes. Al aceptar se restan de las cajas de la grande y
// se suman a la pequeña con su lote y vencimiento.
async function vistaTraspaso(itemCode, { desde = "pendientes" } = {}) {
  mostrarInventario(cargando("Cargando producto…"));
  let p;
  try { p = (await api.producto(itemCode)).data; } catch (error) { return mostrarError(error, () => vistaTraspaso(itemCode, { desde })); }
  recordarBodegas(p.bodegas);
  const de = bodegaNombre("grande", { corto: true }), a = bodegaNombre("pequena", { corto: true });
  const volver = desde === "producto" ? volverA(p.itemName, () => vistaProducto(itemCode)) : volverA("Traspasos por aceptar", () => vistaPendientes("pasar"));
  const encabezado = h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, `Traspaso a ${a}`),
    h("p", { class: "encabezado__sub" }, p.itemName, " · ", h("span", { class: "codigo" }, p.itemCode))));
  const total = p.traspaso?.unidades ?? 0;
  if (!total) {
    return mostrarInventario(volver, encabezado, aviso("ok", `No hay un traspaso de SAP por aceptar de este producto.`),
      boton("", "siguiente", "Ver el producto", { onclick: () => vistaProducto(itemCode) }));
  }
  const filas = filasTraspaso(p.lotes, p.traspaso.sugerencia);
  const operacion = crearOperacion();
  let eligiendo = !p.traspaso.sugerencia;
  let modo = "escanear";
  const cajas = cajasDeLaGrande(p.lotes);
  let escaneadas = [];
  const arriba = h("div", {});
  const cuerpo = h("div", {});
  const problema = aviso("error", "", { role: "alert", hidden: true });
  const mostrarProblema = (texto) => { textoAviso(problema, texto); problema.hidden = false; };
  const loteTexto = (f) => `Lote ${f.lote ?? "sin lote"} · vence ${textoVencimiento(f.vencimiento)}`;

  // eleccion: { lotes } (supervisor, sin escanear) o { cajas } (las escaneadas).
  async function aceptar(eleccion, control) {
    control.disabled = true; problema.hidden = true;
    try {
      const { data } = await api.traspasar(operacion.para({ itemCode, unidades: total, ...eleccion }));
      operacion.terminar();
      const vacias = data.cajas.filter((c) => c.entera).map((c) => c.codigo);
      vistaProducto(itemCode, { tipo: "ok", texto: `Listo: ${unidadesTexto(data.unidades)} pasaron a ${a} (${data.lotes.map((l) => `${l.lote ?? "sin lote"}: ${numero(l.unidades)}`).join(" · ")}).`
        + (vacias.length ? ` ${vacias.length === 1 ? "Quedó vacía la caja" : "Quedaron vacías las cajas"} ${vacias.join(", ")}.` : "") });
    } catch (error) {
      control.disabled = false;
      if (error.status === 401) return mostrarError(error);
      if (error.codigo === "CANTIDAD_CAMBIO") {
        return poner(cuerpo, aviso("alerta", error.mensaje, { role: "alert" }),
          boton("boton--principal", "actualizar", "Ver de nuevo", { onclick: () => vistaTraspaso(itemCode, { desde }) }));
      }
      mostrarProblema(textoFalla(error));
    }
  }

  function pintarSugerencia() {
    const sugeridas = p.traspaso.sugerencia;
    const aceptarBoton = boton("boton--principal boton--grande", "completa", "Aceptar", {
      onclick: () => aceptar({ lotes: sugeridas.map((l) => ({ lote: l.lote ?? null, unidades: l.unidades })) }, aceptarBoton) });
    poner(cuerpo, h("section", { class: "tarjeta" }, h("h2", {}, "Sugerido"),
      h("p", { class: "suave" }, `Lo que vence primero en ${de}, en cajas enteras cuando se puede.`),
      h("ul", { class: "traspaso-lotes" }, sugeridas.map((l) => h("li", {}, icono("caja"),
        h("span", { class: "traspaso-lotes__datos" }, h("strong", {}, loteTexto(l)),
          h("span", { class: "suave" }, `${numero(l.cajas)} ${l.cajas === 1 ? "caja" : "cajas"}`)),
        h("strong", { class: "traspaso-lotes__unidades" }, unidadesTexto(l.unidades))))),
      problema,
      h("div", { class: "fila" }, aceptarBoton,
        boton("", "lista", "Elegir otros lotes", { onclick: () => { eligiendo = true; pintar(); } }),
        boton("", "escaner", "Volver a escanear", { onclick: () => { modo = "escanear"; pintar(); } }))));
    aceptarBoton.focus();
  }

  function pintarEleccion() {
    const campos = filas.map((f, i) => h("input", { id: `traspaso-lote-${i}`, class: "campo campo--numero", type: "number", min: "0",
      max: String(f.disponibles), step: "1", inputmode: "numeric", value: f.sugeridas ? String(f.sugeridas) : "" }));
    const resumen = h("div", { "aria-live": "polite" });
    const aceptarBoton = boton("boton--principal boton--grande", "completa", "Aceptar", { type: "submit" });
    const leer = () => resumenTraspaso(filas.map((f, i) => ({ lote: f.lote, disponibles: f.disponibles,
      unidades: campos[i].value === "" ? 0 : Number(campos[i].value) })), total);
    const actualizar = () => { const r = leer(); poner(resumen, aviso(r.tipo, r.texto)); aceptarBoton.disabled = !r.listo; };
    poner(cuerpo, h("form", { class: "tarjeta", oninput: actualizar, onsubmit: (evento) => {
      evento.preventDefault();
      const r = leer();
      if (r.listo) aceptar({ lotes: r.lotes }, aceptarBoton);
    } },
    h("h2", {}, "¿De qué lotes salió?"),
    h("p", { class: "suave" }, `Escribí cuántas unidades de cada lote pasaron a ${a}. Tienen que sumar ${unidadesTexto(total)}.`),
    !p.traspaso.sugerencia && aviso("alerta", `En ${de} hay menos de lo que pasó SAP: revisá el conteo de ${de}.`),
    filas.length ? h("ul", { class: "traspaso-lotes traspaso-lotes--elegir" }, filas.map((f, i) => h("li", {},
      h("label", { class: "traspaso-lotes__datos", for: `traspaso-lote-${i}` }, h("strong", {}, loteTexto(f)),
        h("span", { class: "suave" }, `Hay ${unidadesTexto(f.disponibles)} en ${de}`)),
      campos[i])))
      : aviso("alerta", `No hay cajas con unidades de este producto en ${de}.`),
    resumen, problema,
    h("div", { class: "fila" }, aceptarBoton,
      p.traspaso.sugerencia && boton("", "volver", "Volver a lo sugerido", { onclick: () => { eligiendo = false; pintar(); } }),
      boton("", "escaner", "Volver a escanear", { onclick: () => { modo = "escanear"; pintar(); } }))));
    actualizar();
    campos[0]?.focus();
  }

  // Escaneando: primero el lote y la fecha que dicen las cajas (el que vence primero viene marcado) y después se escanea
  // cada caja. Varias cajas tienen el mismo código: cada lectura suma una caja entera del lote elegido.
  const textoSugerencia = (lotes) => lotes.map((l) => `${l.cajas} ${l.cajas === 1 ? "caja" : "cajas"} del lote ${l.lote ?? "sin lote"} (vence ${textoVencimiento(l.vencimiento)})`).join(" y ");
  const mismoLote = (x, y) => Boolean(x && y) && (x.lote ?? null) === (y.lote ?? null) && (x.vencimiento ?? null) === (y.vencimiento ?? null);
  let loteElegido = lotesParaEscanear(cajas, [])[0] ?? null;
  function pintarEscaneo() {
    const elegidas = cajasEscaneadas(cajas, escaneadas);
    const suma = elegidas.reduce((t, c) => t + (c?.unidades ?? 0), 0);
    const listo = suma === total;
    const lotes = lotesParaEscanear(cajas, escaneadas);
    if (!lotes.some((l) => mismoLote(l, loteElegido))) loteElegido = null;
    const lector = campoLector({ etiqueta: "Cajas", alLeer: leerCaja,
      placeholder: loteElegido ? `Escaneá cada caja del lote ${loteElegido.lote ?? "sin lote"}` : "Primero elegí el lote" });
    const aceptarBoton = boton("boton--principal boton--grande", "completa", `Aceptar traspaso (${unidadesTexto(total)})`,
      { disabled: !listo, onclick: () => aceptar({ cajas: escaneadas }, aceptarBoton) });
    const opcionLote = (l, i) => h("button", { class: `boton lote-caja${mismoLote(l, loteElegido) ? " boton--principal" : ""}`, type: "button",
      "aria-pressed": mismoLote(l, loteElegido) ? "true" : "false", onclick: () => elegirLote(l, lotes[0]) },
      h("span", {}, loteTexto(l)),
      h("span", { class: "lote-caja__nota" }, `${i === 0 ? "Recomendado · " : venceDespues(l, lotes[0]) ? "Vence después · " : ""}${l.cajas} ${l.cajas === 1 ? "caja" : "cajas"} de ${numero(l.unidades)}`));
    poner(cuerpo,
      aviso("info", p.traspaso.sugerencia
        ? `SAP pasó ${unidadesTexto(total)} de ${de} a ${a}. Pasá ${textoSugerencia(p.traspaso.sugerencia)}: vencen primero.`
        : `SAP pasó ${unidadesTexto(total)} de ${de} a ${a}, pero en ${de} hay menos registrado: avisale al supervisor.`),
      h("p", { class: "traspaso-avance" }, `${escaneadas.length} ${escaneadas.length === 1 ? "caja" : "cajas"} · ${numero(suma)} de ${unidadesTexto(total)}`),
      escaneadas.length > 0 && h("ul", { class: "traspaso-cajas" }, elegidas.map((c, i) => h("li", {}, icono("completa"),
        h("span", {}, h("strong", {}, `Caja ${i + 1}`), h("span", { class: "suave" }, `${loteTexto(c)} · ${unidadesTexto(c.unidades)}`))))),
      problema,
      listo ? aviso("ok", `Listo: ${numero(suma)} unidades, lo que pasó SAP.`) : [
        h("section", { class: "tarjeta traspaso-paso", "aria-labelledby": "traspaso-paso-1" },
          h("h2", { id: "traspaso-paso-1" }, "1. ¿Qué lote y vencimiento dicen las cajas?"),
          lotes.length ? h("div", { class: "lotes-caja" }, lotes.map(opcionLote),
            boton("", null, "Otro lote o fecha…", { onclick: () => mostrarProblema(`Ese lote no está registrado en ${de}: avisale al supervisor (puede editar el conteo de ${de}).`) }))
            : aviso("alerta", `No quedan cajas de este producto en ${de}. Avisale al supervisor.`)),
        h("section", { class: "traspaso-paso", "aria-labelledby": "traspaso-paso-2" },
          h("h2", { id: "traspaso-paso-2" }, loteElegido ? `2. Escaneá cada caja del lote ${loteElegido.lote ?? "sin lote"} (vence ${textoVencimiento(loteElegido.vencimiento)})` : "2. Escaneá cada caja"),
          !p.codigosCaja?.length && aviso("alerta", `Este producto no tiene registrado el código de barras de la caja: la primera vez que lo escanees te pregunta si es de ${p.itemName}.`),
          lector.seccion)],
      h("div", { class: "fila" }, aceptarBoton,
        escaneadas.length > 0 && boton("", "borrar", "Quitar la última caja", { onclick: () => { escaneadas = escaneadas.slice(0, -1); problema.hidden = true; pintar(); } }),
        esSupervisor() && boton("", "lista", "Aceptar sin escanear", { onclick: () => { modo = "lotes"; problema.hidden = true; pintar(); } })));
    if (listo) aceptarBoton.focus(); else lector.entrada.focus();

    async function elegirLote(l, recomendado) {
      problema.hidden = true;
      if (mismoLote(l, loteElegido)) return lector.entrada.focus();
      if (venceDespues(l, recomendado) && !(await confirmar({ titulo: "Ese lote vence después", aceptar: "Usar este lote", texto: [
        `El recomendado es el lote ${recomendado.lote ?? "sin lote"}, que vence ${textoVencimiento(recomendado.vencimiento)}: conviene pasar primero lo que vence antes.`,
        `¿Pasás cajas del lote ${l.lote ?? "sin lote"} (vence ${textoVencimiento(l.vencimiento)})?`] }))) return pintar();
      loteElegido = { lote: l.lote, vencimiento: l.vencimiento };
      pintar();
    }
    async function leerCaja(codigo) {
      problema.hidden = true;
      if (p.codigos.some((c) => c.codigo === codigo)) return mostrarProblema("Ese es el código de la unidad. Escaneá el código de barras de la caja.");
      if (!loteElegido) return mostrarProblema("Primero elegí el lote y el vencimiento que dicen las cajas.");
      if (!p.codigosCaja?.some((c) => c.codigo === codigo)) {
        const ok = await confirmar({ titulo: "¿Es la caja de este producto?", aceptar: "Sí, registrarlo", texto: [
          `El código ${codigo} no está registrado como caja.`, `Si es la caja de ${p.itemName}, queda registrado y la próxima vez se reconoce solo.`] });
        if (!ok) return pintar();
        try {
          const { data } = await api.registrarCodigoCaja(codigo, p.itemCode);
          p.codigosCaja = [...(p.codigosCaja ?? []), { id: data.id, codigo: data.codigo }];
        } catch (error) {
          if (error.status === 401) return mostrarError(error);
          pintar();
          return mostrarProblema(textoFalla(error));
        }
      }
      const nuevas = [...escaneadas, { lote: loteElegido.lote, vencimiento: loteElegido.vencimiento }];
      const elegidasNuevas = cajasEscaneadas(cajas, nuevas);
      if (!elegidasNuevas.at(-1)) {
        pintar();
        return mostrarProblema(`No quedan más cajas del lote ${loteElegido.lote ?? "sin lote"} en ${de}. Elegí otro lote o avisale al supervisor.`);
      }
      const unidades = elegidasNuevas.reduce((t, c) => t + (c?.unidades ?? 0), 0);
      if (unidades > total) {
        pintar();
        return mostrarProblema(`Con esta caja serían ${numero(unidades)} unidades y SAP pasó ${numero(total)}. Solo se pasan cajas enteras: avisale al supervisor.`);
      }
      escaneadas = nuevas;
      pintar();
    }
  }

  const pintar = () => {
    poner(arriba, modo === "escanear" ? null
      : aviso("info", `SAP pasó ${unidadesTexto(total)} de ${de} a ${a}. Sin escanear (supervisor): revisá la sugerencia y aceptá.`));
    return modo === "escanear" ? pintarEscaneo() : eligiendo ? pintarEleccion() : pintarSugerencia();
  };
  mostrarInventario(volver, encabezado, arriba, cuerpo);
  pintar();
}

async function vistaCaja(codigo, mensaje = null) {
  mostrarInventario(cargando("Buscando la caja…"));
  let c;
  try { c = (await api.caja(codigo)).data; } catch (error) {
    if (error.status === 404) {
      return mostrarInventario(volverInventario(), aviso("error", `No hay una caja con el código ${codigo}.`, { role: "alert" }),
        boton("", "mover", "Escanear otra caja", { onclick: () => vistaReponer() }));
    }
    return mostrarError(error, () => vistaCaja(codigo));
  }
  const producto = { itemCode: c.itemCode, itemName: c.itemName ?? c.itemCode };
  const vacia = c.unidades === 0;
  const cantidadCampo = h("input", { id: "reponer-unidades", class: "campo campo--numero", type: "number", min: "1", max: String(c.unidades),
    value: String(c.unidades), inputmode: "numeric", disabled: vacia });
  const problema = aviso("error", "", { role: "alert", hidden: true });
  const despacho = bodegaNombre("pequena", { corto: true });
  const pasar = boton("boton--principal boton--grande", "mover", `Pasar a ${despacho}`, { type: "submit", disabled: vacia });
  // Un reintento con la misma cantidad reusa la operación: el servidor no la repite.
  const reposicion = crearOperacion(), correccion = crearOperacion();
  async function reponer(evento) {
    evento.preventDefault();
    const n = Number(cantidadCampo.value);
    if (!enteroPositivo(n) || n > c.unidades) {
      textoAviso(problema, `Escribí cuántas unidades sacaste: entre 1 y ${numero(c.unidades)}.`); problema.hidden = false; return;
    }
    pasar.disabled = true; problema.hidden = true;
    try {
      const { data } = await api.reponer(reposicion.para({ caja: c.codigo, unidades: n }));
      reposicion.terminar();
      vistaCaja(c.codigo, { tipo: "ok", texto: `Pasaron ${unidadesTexto(n)} a ${despacho}. La caja quedó con ${numero(data.caja.unidades)} y ${despacho} tiene ${numero(data.pequena)}.` });
    } catch (error) {
      if (error.status === 401) return mostrarError(error);
      textoAviso(problema, textoFalla(error)); problema.hidden = false; pasar.disabled = false;
    }
  }
  async function corregir() {
    const datos = await pedirDatos({ titulo: `Corregir la caja ${c.codigo}`, aceptar: "Guardar",
      texto: `El sistema tiene ${unidadesTexto(c.unidades)}. Escribí cuántas tiene de verdad. La diferencia queda como diferencia con SAP.`,
      campos: [{ nombre: "unidades", etiqueta: "Unidades en la caja", inputmode: "numeric", maxlength: 7 }],
      validar: (d) => (/^\d+$/.test(d.unidades) ? null : "Escribí un número entero, sin puntos ni comas.") });
    if (!datos) return;
    const unidades = Number(datos.unidades);
    try {
      await api.corregirCaja(c.id, correccion.para({ unidades }));
      correccion.terminar();
      vistaCaja(c.codigo, { tipo: "ok", texto: `La caja quedó con ${unidadesTexto(unidades)}.` });
    } catch (error) {
      if (error.status === 401) return mostrarError(error);
      // Si se vuelve a guardar el mismo número, va la misma operación: no se aplica dos veces.
      informar({ titulo: "No se guardó la corrección", texto: textoFalla(error) });
    }
  }
  const antes = c.usarAntes;
  mostrarInventario(volverA("Escanear otra caja", () => vistaReponer()),
    h("div", { class: "encabezado" }, h("div", {}, h("span", { class: "rotulo" }, "Caja"), h("h1", { class: "codigo-titulo" }, c.codigo),
      h("p", { class: "encabezado__sub" }, producto.itemName))),
    mensaje && aviso(mensaje.tipo, mensaje.texto, { role: "status" }),
    antes && !vacia && aviso("alerta", `Conviene usar antes la caja ${antes.codigo}: ${antes.abierta ? `ya está abierta (${unidadesTexto(antes.unidades)})` : `vence ${textoVencimiento(antes.vencimiento)}`}.`, {},
      boton("", "siguiente", "Ir a esa caja", { onclick: () => vistaCaja(antes.codigo) })),
    h("div", { class: "caja-layout" },
      h("section", { class: "tarjeta" }, h("span", { class: "rotulo" }, "Etiqueta"), etiquetaCaja(c, producto),
        boton("boton--ancho", "impresora", "Reimprimir la etiqueta", { onclick: () => imprimirEtiquetas([c], producto) })),
      h("section", { class: "tarjeta" },
        h("dl", { class: "datos" },
          h("div", {}, h("dt", {}, "Quedan"), h("dd", { class: "datos__cifra" }, `${numero(c.unidades)} de ${numero(c.unidadesIniciales)}`)),
          h("div", {}, h("dt", {}, "Lote"), h("dd", { class: "codigo" }, c.lote ?? "Sin lote")),
          h("div", {}, h("dt", {}, "Vence"), h("dd", {}, textoVencimiento(c.vencimiento))),
          h("div", {}, h("dt", {}, `En ${despacho}`), h("dd", {}, unidadesTexto(c.pequena)))),
        vacia ? aviso("ok", "La caja está vacía.")
          : h("form", { class: "formulario-reponer", onsubmit: reponer },
            h("label", { class: "campo-etiqueta", for: "reponer-unidades" }, h("span", {}, `¿Cuántas unidades pasás a ${despacho}?`), cantidadCampo),
            problema, pasar),
        h("div", { class: "fila" },
          boton("", "siguiente", "Ver el producto", { onclick: () => vistaProducto(c.itemCode) }),
          esSupervisor() && boton("", "contar", "Corregir unidades", { onclick: corregir })))));
  if (!vacia) cantidadCampo.select();
}

// Campos de los formularios de recepción y conteo.
const campoCon = (id, etiqueta, entrada, ayuda = null) => h("label", { class: "campo-etiqueta", for: id }, h("span", {}, etiqueta), entrada,
  ayuda && h("small", { class: "suave" }, ayuda));
const numeroCampo = (id, valor = "") => h("input", { id, class: "campo campo--numero", type: "number", min: "1", inputmode: "numeric", value: valor });
const textoCampo = (id) => h("input", { id, class: "campo codigo", maxlength: "60", autocomplete: "off", spellcheck: "false" });
const mesCampo = (id) => h("input", { id, class: "campo", type: "month" });
const mes = (entrada) => (entrada.value ? finDeMes(entrada.value) : null);
// Al editar lo guardado: el mes se muestra y, si no se cambia, vuelve la fecha exacta que tenía (así la caja no cambia).
const ponerMes = (entrada, fecha) => { entrada.value = fecha ? String(fecha).slice(0, 7) : ""; entrada.dataset.guardado = fecha ?? ""; };
const mesGuardado = (entrada) => (entrada.value && entrada.dataset.guardado?.startsWith(entrada.value) ? entrada.dataset.guardado : mes(entrada));
const numeroDe = (entrada) => (entrada.value === "" ? null : Number(entrada.value));
// Quitar una fila cambia el total: se avisa al formulario como si se hubiera escrito.
const avisarCambio = (elemento) => elemento.dispatchEvent(new Event("input", { bubbles: true }));

// Cajas por lote (bodega de cajas): una fila por lote, o por cantidad distinta dentro de un lote, y lo que sobra
// suelto por lote (todo en un bulto con una sola etiqueta). Los id llevan el prefijo: rec-cajas, rec-por-caja, rec-lote,
// rec-vence, rec-g1-cajas…, y lo suelto rec-bulto, rec-bulto-lote, rec-bulto-vence, rec-s1-bulto… cajas: lo que trae
// escrito la primera fila. valores: lo ya guardado ({ filas, bultos }, de conteoGuardadoGrande), para editar el conteo.
function formularioCajas({ prefijo, sugerencia = null, cajas = "1", valores = null, conEtiquetas = true }) {
  const filas = [];
  const lista = h("ol", { class: "grupos-cajas" });
  let siguiente = 0;
  function agregar() {
    const n = siguiente++;
    const id = (nombre) => (n === 0 ? `${prefijo}-${nombre}` : `${prefijo}-g${n}-${nombre}`);
    const anterior = filas.at(-1);
    const f = { cajas: numeroCampo(id("cajas"), n === 0 ? cajas : "1"), lote: textoCampo(id("lote")), vence: mesCampo(id("vence")),
      porCaja: numeroCampo(id("por-caja"), anterior ? anterior.porCaja.value : sugerencia?.unidadesPorCaja ? String(sugerencia.unidadesPorCaja) : "") };
    f.elemento = h("li", { class: "grupo-cajas" },
      campoCon(id("cajas"), "Cajas", f.cajas), campoCon(id("por-caja"), "Unidades por caja", f.porCaja),
      campoCon(id("lote"), "Lote", f.lote), campoCon(id("vence"), "Vence", f.vence),
      n > 0 && boton("grupo-cajas__quitar", "borrar", "Quitar", { "aria-label": `Quitar la fila ${filas.length + 1}`,
        onclick: () => { filas.splice(filas.indexOf(f), 1); f.elemento.remove(); avisarCambio(lista); filas.at(-1).cajas.focus(); } }));
    filas.push(f);
    lista.append(f.elemento);
    return f;
  }
  for (const v of valores?.filas?.length ? valores.filas : [null]) {
    const f = agregar();
    if (v) { f.cajas.value = String(v.cajas); f.porCaja.value = String(v.unidadesPorCaja); f.lote.value = v.lote ?? ""; ponerMes(f.vence, v.vencimiento); }
  }
  // Unidades sueltas, una fila por lote (por ejemplo una caja de tintes con varios colores y lotes mezclados).
  const sueltas = [];
  const listaSueltas = h("ol", { class: "grupos-cajas grupos-sueltas" });
  let siguienteSuelta = 0;
  function agregarSuelta() {
    const n = siguienteSuelta++;
    const id = (nombre) => (n === 0 ? `${prefijo}-bulto${nombre}` : `${prefijo}-s${n}-bulto${nombre}`);
    const f = { unidades: h("input", { id: id(""), class: "campo campo--numero", type: "number", min: "1", inputmode: "numeric", placeholder: "0" }),
      lote: textoCampo(id("-lote")), vence: mesCampo(id("-vence")) };
    f.elemento = h("li", { class: "grupo-cajas grupo-lotes" },
      campoCon(id(""), "Unidades", f.unidades), campoCon(id("-lote"), "Lote", f.lote), campoCon(id("-vence"), "Vence", f.vence),
      n > 0 && boton("grupo-cajas__quitar", "borrar", "Quitar", { "aria-label": `Quitar las sueltas de la fila ${sueltas.length + 1}`,
        onclick: () => { sueltas.splice(sueltas.indexOf(f), 1); f.elemento.remove(); avisarCambio(listaSueltas); sueltas.at(-1).unidades.focus(); } }));
    sueltas.push(f);
    listaSueltas.append(f.elemento);
    return f;
  }
  const guardadas = valores?.bultos ?? (valores?.bulto ? [valores.bulto] : []);
  for (const v of guardadas.length ? guardadas : [null]) {
    const f = agregarSuelta();
    if (v) { f.unidades.value = String(v.unidades); f.lote.value = v.lote ?? ""; ponerMes(f.vence, v.vencimiento); }
  }
  const elemento = h("div", {},
    h("p", { class: "suave" }, "Una fila por cada lote. Si dentro de un lote hay cajas con distinta cantidad, poné una fila por cada cantidad.",
      sugerencia ? ` La última vez vino en cajas de ${numero(sugerencia.unidadesPorCaja)}.` : ""),
    lista,
    boton("", "mas", "Agregar otro lote", { onclick: () => { agregar().cajas.focus(); avisarCambio(lista); } }),
    h("fieldset", { class: "bulto" }, h("legend", {}, "¿Hay unidades sueltas?"),
      h("p", { class: "suave" }, conEtiquetas
        ? "Lo que no está en cajas enteras (por ejemplo una caja con varios colores mezclados): una fila por cada lote. Todo lo suelto lleva una sola etiqueta. Si no hay, dejalo vacío."
        : "Lo que no está en cajas enteras (por ejemplo una caja con varios colores mezclados): una fila por cada lote. Si no hay, dejalo vacío."),
      listaSueltas,
      boton("", "mas", "Agregar otro lote suelto", { onclick: () => { agregarSuelta().unidades.focus(); avisarCambio(listaSueltas); } })));
  const leerSueltas = () => sueltas.filter((f) => f.unidades.value !== "" || f.lote.value.trim() || f.vence.value)
    .map((f) => ({ unidades: f.unidades.value === "" ? null : Number(f.unidades.value), lote: f.lote.value.trim() || null, vencimiento: mesGuardado(f.vence) }));
  return {
    elemento,
    // { filas: [{ cajas, unidadesPorCaja, lote, vencimiento }], bultos: [{ unidades, lote, vencimiento }] } con null en lo que está vacío.
    leer: () => ({
      filas: filas.map((f) => ({ cajas: numeroDe(f.cajas), unidadesPorCaja: numeroDe(f.porCaja), lote: f.lote.value.trim() || null, vencimiento: mesGuardado(f.vence) })),
      bultos: leerSueltas(),
    }),
    meses: () => [...filas.map((f) => f.vence), ...sueltas.map((f) => f.vence)],
    enfocar: () => filas[0].cajas.focus(),
  };
}

// Unidades sueltas por lote (bodega de despacho): una fila por lote. Los id: conteo-l0-unidades, conteo-l0-lote…
function formularioLotes({ prefijo, valores = null }) {
  const filas = [];
  const lista = h("ol", { class: "grupos-cajas" });
  let siguiente = 0;
  function agregar() {
    const n = siguiente++;
    const id = (nombre) => `${prefijo}-l${n}-${nombre}`;
    const f = { unidades: h("input", { id: id("unidades"), class: "campo campo--numero", type: "number", min: "1", inputmode: "numeric", placeholder: "0" }),
      lote: textoCampo(id("lote")), vence: mesCampo(id("vence")) };
    f.elemento = h("li", { class: "grupo-cajas grupo-lotes" },
      campoCon(id("unidades"), "Unidades", f.unidades), campoCon(id("lote"), "Lote", f.lote), campoCon(id("vence"), "Vence", f.vence),
      n > 0 && boton("grupo-cajas__quitar", "borrar", "Quitar", { "aria-label": `Quitar la fila ${filas.length + 1}`,
        onclick: () => { filas.splice(filas.indexOf(f), 1); f.elemento.remove(); avisarCambio(lista); filas.at(-1).unidades.focus(); } }));
    filas.push(f);
    lista.append(f.elemento);
    return f;
  }
  // valores: [{ unidades, lote, vencimiento }] para editar lo que se guardó.
  for (const v of valores?.length ? valores : [null]) {
    const f = agregar();
    if (v) { f.unidades.value = String(v.unidades); f.lote.value = v.lote ?? ""; ponerMes(f.vence, v.vencimiento); }
  }
  const elemento = h("div", {},
    h("p", { class: "suave" }, "Una fila por cada lote. Si no tiene lote, dejá el lote vacío."),
    lista,
    boton("", "mas", "Agregar otro lote", { onclick: () => { agregar().unidades.focus(); avisarCambio(lista); } }));
  return {
    elemento,
    leer: () => filas.map((f) => ({ unidades: numeroDe(f.unidades), lote: f.lote.value.trim() || null, vencimiento: mes(f.vence) })),
    meses: () => filas.map((f) => f.vence),
    enfocar: () => filas[0].unidades.focus(),
  };
}

// Recepción: cajas por lote a la bodega de cajas (y lo que sobra suelto como un bulto con etiqueta), o unidades
// sueltas a cualquiera de las dos.
async function vistaRecibir(itemCode) {
  mostrarInventario(cargando("Cargando producto…"));
  let p;
  try { p = (await api.producto(itemCode)).data; } catch (error) { return mostrarError(error, () => vistaRecibir(itemCode)); }
  recordarBodegas(p.bodegas);
  // Sin comparación con SAP se recibe igual, sin controlar contra lo que SAP tiene por guardar.
  const e = p.estado && p.estado.estado !== "sin_comparacion_sap" ? p.estado : null;
  const porUbicar = e ? Math.max(0, e.diferencia) : 0;
  const inicial = e?.estado === "conteo_inicial";
  const operacion = crearOperacion();
  let modo = "cajas";
  const cajas = formularioCajas({ prefijo: "rec", sugerencia: p.sugerencia });
  const sueltas = numeroCampo("rec-unidades", porUbicar ? String(porUbicar) : "");
  const sueltoLote = textoCampo("rec-suelto-lote"), sueltoVence = mesCampo("rec-suelto-vence");
  const aPequena = h("input", { id: "rec-pequena", type: "radio", name: "destino", value: "pequena", checked: true });
  const aGrande = h("input", { id: "rec-grande", type: "radio", name: "destino", value: "grande" });
  const resumen = h("div", { class: "resumen-recepcion", "aria-live": "polite" });
  const problema = aviso("error", "", { role: "alert", hidden: true });
  const guardar = boton("boton--principal boton--grande", "impresora", "Guardar", { type: "submit" });
  const botonModo = (id, nombreIcono, texto) => h("button", { class: "segmento", type: "button", "aria-pressed": String(id === modo),
    onclick: () => { modo = id; pintar(); if (id === "cajas") cajas.enfocar(); else sueltas.focus(); } }, icono(nombreIcono), texto);
  const modos = h("div", { class: "segmentos", role: "group", "aria-label": "¿Cómo vino?" });
  const grupoCajas = h("div", {}, cajas.elemento);
  const grupoSuelto = h("div", {}, campoCon("rec-unidades", "Unidades", sueltas),
    h("fieldset", { class: "destino" }, h("legend", {}, "¿Dónde se guardan?"),
      h("label", { class: "opcion", for: "rec-pequena" }, aPequena, `En ${bodegaNombre("pequena", { corto: true })}`),
      h("label", { class: "opcion", for: "rec-grande" }, aGrande, `En ${bodegaNombre("grande", { corto: true })}, como un bulto con etiqueta`)),
    h("div", { class: "rejilla-campos" }, campoCon("rec-suelto-lote", "Lote", sueltoLote, "Como figura en el producto. Si no tiene, dejalo vacío."),
      campoCon("rec-suelto-vence", "Vencimiento", sueltoVence, "Mes y año, si lo trae.")));

  function leer() {
    if (modo === "cajas") {
      const { filas, bultos } = cajas.leer();
      return { modo: "grupos", grupos: filas.filter((f) => f.cajas !== null || f.lote || f.vencimiento), bultos };
    }
    return { modo: "suelto", unidades: Number(sueltas.value), destino: aPequena.checked ? "pequena" : "grande",
      lote: sueltoLote.value.trim() || null, vencimiento: mes(sueltoVence) };
  }
  const meses = () => (modo === "cajas" ? cajas.meses() : [sueltoVence]);
  function pintar() {
    modos.replaceChildren(botonModo("cajas", "caja", "En cajas"), botonModo("suelto", "capas", "Suelto"));
    grupoCajas.hidden = modo !== "cajas"; grupoSuelto.hidden = modo !== "suelto";
    const d = leer();
    const r = resumenRecepcion(d, estado.bodegas);
    const g = d.modo === "grupos" ? armarGrupos(d.grupos, d.bultos) : null;
    const etiquetas = g ? (g.problema ? 0 : g.etiquetas) : d.destino === "grande" ? 1 : 0;
    guardar.replaceChildren(icono(etiquetas ? "impresora" : "completa"),
      etiquetas ? `Guardar e imprimir ${numero(etiquetas)} ${etiquetas === 1 ? "etiqueta" : "etiquetas"}` : "Guardar");
    if (!r.total) return resumen.replaceChildren();
    if (!e) return resumen.replaceChildren(aviso("info", r.texto));
    const falta = inicial ? "por contar" : "por guardar";
    if (porUbicar === 0) return resumen.replaceChildren(aviso("alerta", `${r.texto} SAP todavía no registró que llegó: si llegó antes que SAP, se puede recibir igual.`));
    if (r.total > porUbicar) return resumen.replaceChildren(aviso("alerta", `${r.texto} Son ${numero(r.total - porUbicar)} más de lo que SAP tiene ${falta} (${numero(porUbicar)}).`));
    resumen.replaceChildren(aviso(r.total === porUbicar ? "ok" : "info", r.total === porUbicar ? `${r.texto} ${inicial ? "Queda todo contado." : "Queda todo guardado."}`
      : `${r.texto} SAP tiene ${numero(porUbicar)} ${falta}. Quedan ${numero(porUbicar - r.total)} ${falta}.`));
  }

  async function enviar(evento, adelantar = false) {
    evento?.preventDefault();
    const d = leer();
    let cuerpo;
    if (d.modo === "grupos") {
      const g = armarGrupos(d.grupos, d.bultos);
      if (g.problema) { textoAviso(problema, g.problema); problema.hidden = false; return; }
      cuerpo = { itemCode, modo: "grupos", grupos: g.grupos, bultos: g.bultos, adelantar };
    } else {
      if (!enteroPositivo(d.unidades)) { textoAviso(problema, "Escribí cuántas unidades llegaron."); problema.hidden = false; return; }
      cuerpo = { itemCode, modo: "suelto", unidades: d.unidades, destino: d.destino, lote: d.lote, vencimiento: d.vencimiento, adelantar };
    }
    if (meses().some((m) => m.value && !finDeMes(m.value))) { textoAviso(problema, "Un vencimiento no es válido."); problema.hidden = false; return; }
    problema.hidden = true; guardar.disabled = true;
    try {
      const { data } = await api.recibir(operacion.para(cuerpo));
      operacion.terminar();
      if (data.cajas.length) return vistaEtiquetas(data.cajas, p);
      vistaProducto(itemCode, { tipo: "ok", texto: `Se guardaron ${unidadesTexto(data.unidades)} sueltas en ${bodegaNombre("pequena", { corto: true })}.` });
    } catch (error) {
      guardar.disabled = false;
      if (error.status === 401) return mostrarError(error);
      if (error.codigo === "EXCEDE_POR_UBICAR" && !adelantar) {
        const seguir = await confirmar({ titulo: "¿Llegó antes que SAP?", aceptar: "Recibir igual",
          texto: [error.mensaje, "Se recibe igual y queda anotado como recibido antes que SAP. Cuando SAP lo registre, la diferencia se cierra sola."] });
        if (seguir) return enviar(null, true);
        return;
      }
      textoAviso(problema, textoFalla(error)); problema.hidden = false;
    }
  }

  const entradas = p.documentos.filter((d) => d.tipo.startsWith("entrada") || d.tipo === "devolucionCliente");
  const encabezadoAviso = !e ? aviso("info", "Sin datos recientes de SAP: se registra lo que llegó, sin controlarlo contra SAP.")
    : e.estado === "por_ubicar"
    ? aviso("alerta", `SAP registró ${unidadesTexto(porUbicar)} de ${p.itemName} que todavía no se guardaron${entradas[0] ? ` (${textoDocumento(entradas[0])}, ${fecha(entradas[0].docDate)})` : ""}.`)
    : inicial ? aviso("info", `Falta contar este producto: SAP tiene ${unidadesTexto(porUbicar)}. Para contarlo, mejor usá «Contar» en cada bodega.`)
      : null;
  mostrarInventario(volverA(p.itemName, () => vistaProducto(itemCode)),
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, e?.estado === "por_ubicar" ? "Guardar lo que llegó" : "Recibir"),
      h("p", { class: "encabezado__sub" }, p.itemName, " · ", h("span", { class: "codigo" }, p.itemCode)))),
    encabezadoAviso,
    h("form", { class: "tarjeta formulario-recepcion", onsubmit: (evento) => enviar(evento), oninput: pintar, onchange: pintar },
      h("h2", {}, "¿Cómo vino?"), modos, grupoCajas, grupoSuelto,
      resumen, problema,
      h("div", { class: "fila" }, guardar, boton("", null, "Cancelar", { onclick: () => vistaProducto(itemCode) }))));
  pintar();
  cajas.enfocar();
}

function vistaEtiquetas(cajas, producto) {
  const rango = cajas.length === 1 ? cajas[0].codigo : `${cajas[0].codigo} a ${cajas.at(-1).codigo}`;
  const resultado = h("div", { "aria-live": "polite" });
  const cantidad = agruparEtiquetas(cajas).length;
  const enteras = cajas.filter((c) => !c.suelto).length, sueltas = cajas.length - enteras;
  const registrado = [enteras && `${numero(enteras)} ${enteras === 1 ? "caja" : "cajas"}`,
    sueltas && (sueltas === 1 ? "1 bulto suelto" : `lo suelto de ${numero(sueltas)} lotes`)].filter(Boolean).join(" y ");
  const texto = `Imprimir ${numero(cantidad)} ${cantidad === 1 ? "etiqueta" : "etiquetas"}`;
  const imprimir = boton("boton--principal boton--grande", "impresora", texto, { onclick: async () => {
    imprimir.disabled = true;
    const r = await imprimirEtiquetas(cajas, producto);
    imprimir.disabled = false;
    resultado.replaceChildren(r.ok ? aviso("ok", "Se mandaron a la impresora.") : r.motivo === "cancelled" ? ""
      : aviso("error", "No se pudo imprimir. Revisá que la impresora esté encendida y probá de nuevo.", { role: "alert" }));
  } });
  mostrarInventario(
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, "Etiquetas de las cajas"), h("p", { class: "encabezado__sub" }, producto.itemName))),
    aviso("ok", `Se registr${registrado.startsWith("1 ") ? "ó" : "aron"} ${registrado} (${rango}) en ${bodegaNombre("grande", { corto: true })}. Pegá cada etiqueta en su caja${sueltas > 1 ? "; lo suelto lleva una sola" : ""}.`),
    h("div", { class: "fila" }, imprimir,
      boton("", "siguiente", "Ver el producto", { onclick: () => vistaProducto(producto.itemCode) }),
      boton("", "bodega", "Volver al inventario", { onclick: () => vistaInventario() })),
    resultado,
    h("div", { class: "etiquetas" }, etiquetasDeCajas(cajas, producto)));
  imprimir.focus();
}

// La cola de etiquetas ([{ caja, producto }]), producto por producto: lo suelto de cada uno va en una sola etiqueta.
function etiquetasDeCola(pendientes) {
  const porProducto = new Map();
  for (const { caja, producto } of pendientes) {
    if (!porProducto.has(producto.itemCode)) porProducto.set(producto.itemCode, { producto, cajas: [] });
    porProducto.get(producto.itemCode).cajas.push(caja);
  }
  return [...porProducto.values()].flatMap(({ producto, cajas }) => etiquetasDeCajas(cajas, producto));
}

// Las etiquetas de lo registrado: una por caja entera y una sola para todo lo suelto (aunque sean varios lotes).
function etiquetasDeCajas(cajas, producto) {
  const grupos = agruparEtiquetas(cajas);
  const enteras = grupos.filter((g) => g.caja && !g.caja.suelto).length;
  let n = 0;
  return grupos.map((g) => (g.sueltas ? etiquetaSueltas(g.sueltas, producto)
    : etiquetaCaja(g.caja, producto, grupos.length > 1 && !g.caja.suelto ? { numero: ++n, de: enteras } : null)));
}

// Etiqueta de lo suelto de varios lotes: cada lote con sus unidades, vencimiento y su código (cada lote queda registrado
// aparte). Sin código de barras: escanearlo abriría un solo lote.
function etiquetaSueltas(sueltas, producto) {
  const fila = (rotulo, valor) => h("div", { class: "etiqueta__fila" }, h("span", { class: "etiqueta__rotulo" }, rotulo), h("span", {}, valor));
  const total = sueltas.reduce((t, c) => t + c.unidadesIniciales, 0);
  return h("article", { class: "etiqueta-caja etiqueta-sueltas", "aria-label": `Etiqueta de las sueltas de ${producto.itemName}` },
    h("div", { class: "etiqueta__nombre" }, producto.itemName),
    fila("Artículo", producto.itemCode), fila("Sueltas", `${unidadesTexto(total)} de ${numero(sueltas.length)} lotes`),
    h("ul", { class: "etiqueta__lotes" }, sueltas.map((c) => h("li", {},
      h("strong", {}, c.lote ?? "Sin lote"), ` · ${unidadesTexto(c.unidadesIniciales)} · ${textoVencimiento(c.vencimiento)} · `, h("span", { class: "codigo" }, c.codigo)))),
    fila("Recibido", fechaLocal(sueltas[0].recibidaEn)));
}

// Etiqueta de una caja: datos para leer a simple vista y el código CJ-000123 para escanear.
function etiquetaCaja(c, producto, posicion = null) {
  const fila = (rotulo, valor) => h("div", { class: "etiqueta__fila" }, h("span", { class: "etiqueta__rotulo" }, rotulo), h("span", {}, valor));
  return h("article", { class: "etiqueta-caja", "aria-label": `Etiqueta de la caja ${c.codigo}` },
    h("div", { class: "etiqueta__nombre" }, producto.itemName),
    fila("Artículo", producto.itemCode), fila("Lote", c.lote ?? "Sin lote"), fila("Vence", textoVencimiento(c.vencimiento)),
    fila("Trae", unidadesTexto(c.unidadesIniciales)),
    fila("Caja", `${posicion ? `${posicion.numero} de ${posicion.de} · ` : ""}recibida ${fechaLocal(c.recibidaEn)}`),
    codigoBarras(c.codigo));
}

function codigoBarras(texto) {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const { barras: lista, modulos } = barras(texto);
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [atributo, valor] of Object.entries({ class: "etiqueta__barras", viewBox: `0 0 ${modulos} 40`, preserveAspectRatio: "none",
    "shape-rendering": "crispEdges", role: "img", "aria-label": `Código de barras ${texto}` })) svg.setAttribute(atributo, valor);
  for (const b of lista) {
    const rect = document.createElementNS(SVG_NS, "rect");
    for (const [atributo, valor] of Object.entries({ x: b.x, y: 0, width: b.ancho, height: 40 })) rect.setAttribute(atributo, valor);
    svg.append(rect);
  }
  return h("div", { class: "etiqueta__codigo" }, svg, h("span", { class: "codigo" }, texto));
}

// Imprime solo las etiquetas: se dibujan en una zona que la hoja de estilos muestra únicamente al imprimir.
const imprimirEtiquetas = (cajas, producto) => imprimirZona(etiquetasDeCajas(cajas, producto));
function zonaImpresion() {
  let zona = document.getElementById("impresion");
  if (!zona) { zona = h("div", { id: "impresion", class: "impresion", "aria-hidden": "true" }); document.body.append(zona); }
  return zona;
}
async function imprimirZona(etiquetas) {
  const zona = zonaImpresion();
  zona.replaceChildren(...etiquetas);
  try {
    if (window.escritorio?.imprimir) return await window.escritorio.imprimir();
    window.print();
    return { ok: true };
  } catch {
    return { ok: false, motivo: "error" };
  } finally {
    zona.replaceChildren();
  }
}

async function vistaPendientes(pestana = "ubicar") {
  if (pestana === "inicial") return vistaConteo();
  mostrarInventario(cargando("Cargando pendientes…"));
  let d;
  try { d = (await api.pendientes()).data; } catch (error) {
    if (SIN_COMPARACION.includes(error.codigo)) return pendientesSinComparacion(error);
    return mostrarError(error, () => vistaPendientes(pestana));
  }
  const porPasar = d.porPasar ?? [];
  estado.pendientesInventario = d.porUbicar.length + d.porDescontar.length + porPasar.length;
  const pestanas = [["ubicar", "Falta guardar", d.porUbicar.length], ["pasar", "Traspasos por aceptar", porPasar.length],
    ["descontar", "Falta marcar salida", d.porDescontar.length], ["historial", "Salidas marcadas", 0]];
  const nav = h("nav", { class: "pestanas", "aria-label": "Pendientes del inventario" }, pestanas.map(([id, texto, n]) =>
    h("button", { class: "pestana", type: "button", "aria-current": id === pestana ? "page" : null, onclick: () => vistaPendientes(id) },
      texto, n > 0 && h("span", { class: "contador contador--alerta", "aria-label": `${n} pendientes` }, numero(n)))));
  const contenido = h("div", {});
  const documentos = (v) => (v.documentos?.length ? h("span", {}, v.documentos.map((x) => `${textoDocumento(x)} (${fecha(x.docDate)})`).join(" · ")) : null);
  mostrarInventario(volverInventario(), h("div", { class: "encabezado" }, h("h1", {}, "Pendientes")), nav,
    d.actualizando.length > 0 && pestana !== "historial" && h("p", { class: "suave nota" }, icono("info"),
      `${numero(d.actualizando.length)} ${d.actualizando.length === 1 ? "producto tuvo" : "productos tuvieron"} cambios recientes en SAP: aparecen acá cuando termine de llegar todo (unos 15 minutos).`),
    contenido);
  if (pestana === "ubicar") {
    poner(contenido,
      d.porUbicar.length ? h("ul", { class: "filas" }, d.porUbicar.map((v) => filaAdmin({ nombre: v.itemName,
        detalle: [h("span", { class: "codigo" }, v.itemCode), documentos(v)], dato: dato("Falta guardar", unidadesTexto(v.diferencia)),
        acciones: [boton("boton--principal", "caja", "Guardar", { onclick: () => vistaRecibir(v.itemCode) }),
          boton("", "siguiente", "Ver", { onclick: () => vistaProducto(v.itemCode) })] })))
        : aviso("ok", "No falta guardar nada."),
      d.faltaEnSap.length > 0 && h("section", { class: "bloque" }, h("h2", {}, "Recibido antes que SAP"),
        h("p", { class: "suave" }, "Se recibió en la bodega y SAP todavía no lo registró. Se cierra solo cuando llegue la entrada de SAP."),
        h("ul", { class: "filas" }, d.faltaEnSap.map((v) => filaAdmin({ nombre: v.itemName, detalle: [h("span", { class: "codigo" }, v.itemCode)],
          dato: dato("Falta en SAP", unidadesTexto(v.faltaEnSap)), acciones: [boton("", "siguiente", "Ver", { onclick: () => vistaProducto(v.itemCode) })] })))));
  } else if (pestana === "pasar") {
    const de = bodegaNombre("grande", { corto: true }), a = bodegaNombre("pequena", { corto: true });
    poner(contenido,
      h("p", { class: "suave" }, `Traspasos que SAP ya registró de ${de} a ${a} (SAP no dice de qué lotes). La app sugiere los lotes de las cajas que vencen primero: revisalos y aceptá.`),
      porPasar.length ? h("ul", { class: "filas" }, porPasar.map((v) => filaAdmin({ nombre: v.itemName,
        detalle: [h("span", { class: "codigo" }, v.itemCode), `SAP: ${numero(v.sapGrande)} en ${de} · ${numero(v.sapPequena)} en ${a}`],
        dato: dato(`Pasó a ${a}`, unidadesTexto(v.unidades)),
        acciones: [boton("boton--principal", "mover", "Revisar y aceptar", { onclick: () => vistaTraspaso(v.itemCode) }),
          boton("", "siguiente", "Ver", { onclick: () => vistaProducto(v.itemCode) })] })))
        : aviso("ok", "No hay traspasos por aceptar."));
  } else if (pestana === "descontar") {
    contenido.replaceChildren(d.porDescontar.length
      ? h("ul", { class: "filas" }, d.porDescontar.map((v) => filaAdmin({ clase: "fila-admin--alerta", nombre: v.itemName,
        detalle: [h("span", { class: "codigo" }, v.itemCode), documentos(v)], dato: dato("Salieron en SAP", unidadesTexto(-v.diferencia)),
        acciones: [boton("boton--principal", "restar", "Marcar salida", { onclick: () => vistaDescontar(v.itemCode) })] })))
      : aviso("ok", "No falta marcar ninguna salida."));
  } else {
    await listaDescuentos(contenido);
  }
}

// Sin almacenes o sin datos recientes de SAP no hay pendientes que calcular; el historial de descuentos sigue.
const SIN_COMPARACION = ["ALMACENES_SIN_ELEGIR", "COMPARACION_SAP_NO_DISPONIBLE"];
async function pendientesSinComparacion(error) {
  estado.pendientesInventario = 0;
  const contenido = h("div", {});
  mostrarInventario(volverInventario(), h("div", { class: "encabezado" }, h("h1", {}, "Salidas marcadas")),
    aviso("info", `${error.mensaje} "Falta guardar" y "Falta marcar salida" vuelven cuando haya datos recientes de SAP.`, {},
      error.codigo === "ALMACENES_SIN_ELEGIR" && esSupervisor() && boton("", "bodega", "Elegir almacenes", { onclick: () => vistaSupervisor("almacenes") })),
    contenido);
  await listaDescuentos(contenido);
}


async function listaDescuentos(contenedor) {
  const filas = [];
  let cursor = null;
  const lista = h("ul", { class: "filas" });
  const mas = boton("boton--ancho", null, "Cargar más", { hidden: true, onclick: () => cargar() });
  const fila = (d) => filaAdmin({ nombre: d.itemName ?? d.itemCode,
    detalle: [fechaHora(d.creadoEn), d.documentos ?? "Sin documento de SAP identificado", `Confirmó ${quien(d.hechoPor)}`],
    dato: dato("Salió de", textoAsignacion(d.asignacion, estado.bodegas) || "—", unidadesTexto(d.unidades)),
    acciones: esSupervisor() ? [boton("", "actualizar", "Cambiar lote", { onclick: () => vistaDescontar(d.itemCode, { descuento: d }) })] : [],
    nota: d.corregidoEn ? `Lote cambiado por ${quien(d.corregidoPor)} el ${fechaHora(d.corregidoEn)}. Antes: ${d.anterior}.` : null });
  async function cargar() {
    try {
      const r = await api.descuentos(cursor);
      filas.push(...r.data); cursor = r.siguienteCursor;
      lista.replaceChildren(...filas.map(fila));
      if (!filas.length) lista.replaceChildren(h("p", { class: "suave vacio" }, "Todavía no se marcó ninguna salida."));
      mas.hidden = cursor === null;
    } catch (error) { if (error.status === 401) return mostrarError(error); lista.replaceChildren(aviso("error", error.mensaje, { role: "alert" })); }
  }
  contenedor.replaceChildren(h("p", { class: "suave" }, esSupervisor()
    ? "Las salidas de SAP y de qué lote salió cada una. Si se eligió mal, cambiá el lote: el total no cambia."
    : "Las salidas de SAP y de qué lote salió cada una. Solo el supervisor puede cambiar el lote."), lista, mas);
  await cargar();
}

// Marcar salida: de qué lotes (de una bodega o de la otra) salió lo que SAP descontó. Con "descuento", cambia el lote
// de una salida ya marcada.
async function vistaDescontar(itemCode, { descuento = null } = {}) {
  mostrarInventario(cargando("Cargando producto…"));
  let p;
  try { p = (await api.producto(itemCode)).data; } catch (error) { return mostrarError(error, () => vistaDescontar(itemCode, { descuento })); }
  recordarBodegas(p.bodegas);
  const volver = volverA(descuento ? "Salidas marcadas" : "Falta marcar salida", () => vistaPendientes(descuento ? "historial" : "descontar"));
  const total = descuento ? descuento.unidades : Math.max(0, -(p.estado?.diferencia ?? 0));
  if (!descuento && p.estado?.estado !== "por_descontar") {
    const actualizando = p.estado?.estado === "actualizando";
    const sinComparar = !p.estado || p.estado.estado === "sin_comparacion_sap";
    return mostrarInventario(volver, h("div", { class: "encabezado" }, h("h1", {}, p.itemName)),
      sinComparar ? aviso("info", TEXTO_SIN_COMPARACION)
        : aviso(actualizando ? "alerta" : "ok", actualizando ? "SAP se está actualizando para este producto. Probá en unos minutos." : "Ya no falta marcar ninguna salida de este producto."),
      boton("", "siguiente", "Ver el producto", { onclick: () => vistaProducto(itemCode) }));
  }
  // Un descuento anterior al control por lotes no dice de qué lote de la pequeña salió: no se puede cambiar desde acá.
  if (descuento?.asignacion.some((a) => a.tipo === "pequena" && (a.lotesPequena ?? []).some((l) => !l.pequenaLoteId))) {
    return mostrarInventario(volver, h("div", { class: "encabezado" }, h("h1", {}, "Cambiar lote")),
      aviso("alerta", `Esta salida es de antes del control por lotes y no dice de qué lote de ${bodegaNombre("pequena", { corto: true })} salió. No se puede cambiar el lote; si hace falta, el supervisor la cuenta de nuevo por lote.`),
      boton("", "siguiente", "Ver el producto", { onclick: () => vistaProducto(itemCode) }));
  }
  const operacion = crearOperacion();
  const opciones = opcionesDescuento(p, descuento?.asignacion ?? []);
  const asignado = sugerirAsignacion(opciones, total);
  const resumen = h("div", { "aria-live": "polite" });
  const problema = aviso("error", "", { role: "alert", hidden: true });
  const confirmarBoton = boton("boton--principal boton--grande", descuento ? "actualizar" : "restar", descuento ? "Guardar el lote nuevo" : "Marcar la salida", { type: "submit" });
  const campos = new Map();
  const filas = opciones.map((o) => {
    const id = `asignar-${o.clave.replace(/[^a-z0-9]/gi, "_")}`;
    const entrada = h("input", { id, class: "campo campo--numero", type: "number", min: "0", max: String(o.unidades), inputmode: "numeric", value: String(asignado[o.clave] ?? 0) });
    campos.set(o.clave, entrada);
    const nombre = nombreOpcion(o, estado.bodegas);
    const detalle = [o.vencimiento && !o.vencido && `Vence ${textoVencimiento(o.vencimiento)}`,
      o.tipo === "pequena" ? `Sueltas en ${bodegaNombre("pequena", { corto: true })}` : `${numero(o.cajas.length)} ${o.cajas.length === 1 ? "caja" : "cajas"} en ${bodegaNombre("grande", { corto: true })}`].filter(Boolean).join(" · ");
    return h("li", { class: `opcion-lote${o.vencido ? " opcion-lote--vencida" : ""}` },
      h("div", {}, h("div", { class: "opcion-lote__nombre" }, nombre, o.vencido && insignia("error", "alerta", `Venció ${textoVencimiento(o.vencimiento)}`)),
        h("div", { class: "suave" }, detalle)),
      h("div", { class: "opcion-lote__disponible" }, h("strong", {}, numero(o.unidades)), h("span", {}, "disponibles")),
      h("label", { class: "opcion-lote__campo", for: id }, h("span", {}, "Salieron"), entrada));
  });
  const leer = () => Object.fromEntries([...campos].map(([clave, entrada]) => [clave, entrada.value === "" ? 0 : Number(entrada.value)]));
  function pintar() {
    const r = armarAsignaciones(opciones, leer(), total, estado.bodegas);
    resumen.replaceChildren(r.problema ? aviso("alerta", r.problema) : aviso("ok", `${numero(total)} de ${numero(total)} asignadas: ${r.texto}.`));
    confirmarBoton.disabled = Boolean(r.problema);
  }
  async function enviar(evento) {
    evento.preventDefault();
    const r = armarAsignaciones(opciones, leer(), total, estado.bodegas);
    if (r.problema) return pintar();
    confirmarBoton.disabled = true; problema.hidden = true;
    try {
      if (descuento) {
        await api.cambiarLote(descuento.id, operacion.para({ asignaciones: r.asignaciones }));
        operacion.terminar();
        return vistaPendientes("historial");
      }
      const { data } = await api.descontar(operacion.para({ itemCode, unidades: total, asignaciones: r.asignaciones }));
      operacion.terminar();
      vistaRetirar(p, data.retirar, r.texto);
    } catch (error) {
      if (error.status === 401) return mostrarError(error);
      textoAviso(problema, error.codigo === "CANTIDAD_CAMBIO" ? `${error.mensaje} Volvé a abrir el producto para ver la cantidad actual.`
        : ["LOTE_INSUFICIENTE", "PEQUENA_INSUFICIENTE"].includes(error.codigo) ? `${error.mensaje} Volvé a abrir el producto para ver lo que hay ahora.`
          : textoFalla(error));
      problema.hidden = false; confirmarBoton.disabled = false;
    }
  }
  const salidas = p.documentos.filter((d) => d.tipo === "salidaInventario" || d.tipo === "devolucionProveedor");
  const textoSap = descuento
    ? `Cambiar el lote de la salida de ${unidadesTexto(total)} (${descuento.documentos ?? "sin documento identificado"}). Hoy está así: ${textoAsignacion(descuento.asignacion, estado.bodegas)}.`
    : `Salieron ${unidadesTexto(total)} de ${p.itemName} en SAP y falta marcar de qué lote${salidas.length ? ` (${salidas.map((d) => `${textoDocumento(d)}, ${fecha(d.docDate)}${d.comentarios ? `: "${d.comentarios}"` : ""}`).join(" · ")})` : ""}.`;
  mostrarInventario(volver,
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, descuento ? "Cambiar lote" : "Marcar salida"),
      h("p", { class: "encabezado__sub" }, p.itemName, " · ", h("span", { class: "codigo" }, p.itemCode)))),
    aviso("alerta", textoSap),
    h("form", { class: "tarjeta", onsubmit: enviar, oninput: pintar },
      h("h2", {}, "¿De qué lote salió?"),
      h("p", { class: "suave" }, `SAP no maneja lotes: elegí de cuáles salió. Primero están los lotes de ${bodegaNombre("grande", { corto: true })} y después los de ${bodegaNombre("pequena", { corto: true })}, cada uno del que vence primero al último. Si salió de varios lugares, repartí hasta llegar al total.`),
      h("ul", { class: "opciones-lote" }, filas), resumen, problema,
      h("div", { class: "fila" }, confirmarBoton, boton("", null, "Cancelar", { onclick: () => vistaPendientes(descuento ? "historial" : "descontar") }))));
  pintar();
}

function vistaRetirar(p, retirar, asignacion) {
  mostrarInventario(
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, "Salida marcada"), h("p", { class: "encabezado__sub" }, p.itemName))),
    aviso("ok", `Salió de: ${asignacion}.`),
    retirar.length > 0 && h("section", { class: "tarjeta" }, h("h2", {}, icono("caja"), "Sacá estas cajas del estante"),
      h("p", { class: "suave" }, "Son las unidades que SAP ya descontó. Si una caja queda vacía, retirala."),
      h("ul", { class: "filas" }, retirar.map((r) => filaAdmin({ nombre: r.codigo, detalle: [r.lote ? `Lote ${r.lote}` : "Sin lote"],
        dato: dato("Unidades", numero(r.unidades)), acciones: [boton("", "siguiente", "Ver caja", { onclick: () => vistaCaja(r.codigo) })] })))),
    h("div", { class: "fila" },
      boton("boton--principal", "restar", "Volver a falta marcar salida", { onclick: () => vistaPendientes("descontar") }),
      boton("", "siguiente", "Ver el producto", { onclick: () => vistaProducto(p.itemCode) })));
}

async function vistaPorVencer(dias = 60) {
  mostrarInventario(cargando("Cargando lotes por vencer…"));
  let lotes;
  try { lotes = (await api.porVencer(dias)).data; } catch (error) { return mostrarError(error, () => vistaPorVencer(dias)); }
  const filtros = h("div", { class: "filtros", role: "group", "aria-label": "Plazo" }, [30, 60, 90, 180].map((n) =>
    h("button", { class: "filtro", type: "button", "aria-pressed": String(n === dias), onclick: () => vistaPorVencer(n) }, `Próximos ${n} días`)));
  const vencidos = lotes.filter((l) => l.vencido).length;
  mostrarInventario(volverInventario(),
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, "Por vencer"),
      h("p", { class: "encabezado__sub" }, "Lotes de las dos bodegas, del que vence primero al último. Lo vencido aparece siempre."))),
    filtros,
    vencidos > 0 && aviso("error", `${numero(vencidos)} ${vencidos === 1 ? "lote está vencido" : "lotes están vencidos"}. Para sacarlos, primero se registra la salida en SAP; después aparecen en "Falta marcar salida".`),
    lotes.length === 0 ? aviso("ok", `Ningún lote vence en los próximos ${dias} días.`)
      : h("div", { class: "tabla-envoltura" }, h("table", { class: "tabla" },
        h("thead", {}, h("tr", {}, ["Producto", "Lote", "Vence", "Cajas", `En ${bodegaNombre("grande", { corto: true })}`, `En ${bodegaNombre("pequena", { corto: true })}`].map((t, i) => h("th", { scope: "col", class: i >= 3 ? "tabla__numero" : null }, t)))),
        h("tbody", {}, lotes.map((l) => h("tr", { class: l.vencido ? "fila--vencida" : null },
          h("td", {}, h("button", { class: "enlace", type: "button", onclick: () => vistaProducto(l.itemCode) }, l.itemName)),
          h("td", { class: "codigo" }, l.lote ?? "Sin lote"),
          h("td", {}, textoVencimiento(l.vencimiento), " ", l.vencido ? insignia("error", "alerta", "Vencido")
            : h("span", { class: "suave" }, l.dias === 0 ? "· hoy" : `· en ${numero(l.dias)} ${l.dias === 1 ? "día" : "días"}`)),
          h("td", { class: "tabla__numero" }, numero(l.cajas)),
          h("td", { class: "tabla__numero" }, numero(l.unidades)),
          h("td", { class: "tabla__numero" }, numero(l.pequena))))))));
}

async function vistaMovimientos() {
  mostrarInventario(cargando("Cargando movimientos…"));
  const filas = [];
  let cursor = null;
  try { const r = await api.movimientos(); filas.push(...r.data); cursor = r.siguienteCursor; } catch (error) { return mostrarError(error, () => vistaMovimientos()); }
  const contenedor = h("div", {}, tablaMovimientos(filas));
  const mas = boton("boton--ancho", null, "Cargar más", { hidden: cursor === null, onclick: async () => {
    mas.disabled = true;
    try {
      const r = await api.movimientos({ antesDe: cursor });
      filas.push(...r.data); cursor = r.siguienteCursor;
      contenedor.replaceChildren(tablaMovimientos(filas));
      mas.hidden = cursor === null;
    } catch (error) { if (error.status === 401) return mostrarError(error); }
    mas.disabled = false;
  } });
  mostrarInventario(volverInventario(), h("div", { class: "encabezado" }, h("h1", {}, "Movimientos del inventario")), contenedor, mas);
}

// ---------------------------------------------------------------------------
// Modo conteo: una bodega por vez, producto por producto, con el avance a la vista
// ---------------------------------------------------------------------------

// Etiquetas de cajas que quedaron para imprimir juntas (en este equipo): [{ caja, producto }].
const etiquetasPendientes = () => guardado.leer("etiquetasPendientes") ?? [];
const imprimirAlGuardar = () => guardado.leer("imprimirAlGuardar") !== false;
const etiquetasTexto = (n) => `${numero(n)} ${n === 1 ? "etiqueta" : "etiquetas"}`;

// Elegir qué bodega contar, con el avance de cada una.
async function elegirConteo() {
  estado.desdeLista = null; estado.desdeConteo = null; estado.desdeBodegas = null;
  mostrarInventario(cargando("Cargando el conteo…"));
  let r;
  try { r = (await api.inventario()).data; } catch (error) { return mostrarError(error, () => elegirConteo()); }
  recordarBodegas(r.bodegas);
  const tarjeta = (bodega) => {
    const asignada = r.bodegas?.[bodega];
    const a = avanceConteo(r.conteo?.[bodega]);
    return h("section", { class: "tarjeta bodega" },
      h("h2", {}, icono(bodega === "grande" ? "caja" : "capas"), `Contar ${bodegaNombre(bodega, { corto: true })}`),
      h("p", { class: "suave" }, asignada ? `${bodegaNombre(bodega)} · ${bodega === "grande" ? "se cuentan las cajas de cada lote" : "se cuentan las unidades de cada lote"}`
        : "Falta elegir el almacén de SAP de esta bodega."),
      barraAvance(r.conteo?.[bodega], `Avance del conteo de ${bodegaNombre(bodega, { corto: true })}`),
      asignada ? boton("boton--principal boton--grande", "contar", a?.completo ? "Ver lo contado" : "Contar", { onclick: () => vistaConteo({ bodega }) })
        : esSupervisor() ? boton("", "bodega", "Elegir almacenes", { onclick: () => vistaSupervisor("almacenes") })
          : aviso("info", "El supervisor elige el almacén de cada bodega en su panel."));
  };
  mostrarInventario(volverInventario(),
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, "Contar"),
      h("p", { class: "encabezado__sub" }, "Elegí qué bodega vas a contar. Se cuenta producto por producto y el avance queda guardado."))),
    h("div", { class: "bodegas" }, tarjeta("grande"), tarjeta("pequena"),
      (r.soloConteo ?? []).map((a) => {
        const av = avanceConteo(a.avance);
        return h("section", { class: "tarjeta bodega" },
          h("h2", {}, icono(a.tipo === "cajas" ? "caja" : "capas"), `Contar la ${a.almacen}`),
          h("p", { class: "suave" }, `${a.almacen} · ${a.nombre} · ${a.tipo === "cajas" ? "se cuentan las cajas de cada lote" : "se cuentan las unidades de cada lote"}. Solo conteo.`),
          barraAvance(a.avance, `Avance del conteo de la ${a.almacen}`),
          boton("boton--principal boton--grande", "contar", av?.completo ? "Ver lo contado" : "Contar", { onclick: () => vistaConteo({ almacen: a.almacen }) }));
      })));
}

// En la de cajas se cuentan las cajas de cada lote y lo suelto como un bulto; en la de despacho, las unidades de cada
// lote. Al guardar (o con «No hay») pasa solo al siguiente producto que falta contar. itemCode abre ese producto.
// almacen: un almacén solo para contar (la 03, la 04), por cajas o por lote según cómo lo eligió el supervisor; se
// guarda lo contado sin movimientos ni etiquetas y un conteo ya guardado lo corrige el supervisor.
async function vistaConteo({ bodega = null, almacen = null, itemCode = null, editar: editarAlAbrir = false } = {}) {
  if (!bodega && !almacen) return elegirConteo();
  estado.desdeLista = null; estado.desdeConteo = null; estado.desdeBodegas = null;
  mostrarInventario(cargando("Cargando el conteo…"));
  const listar = (opciones) => (almacen ? api.conteoAlmacen(almacen, opciones) : api.conteo(bodega, opciones));
  let primera;
  try { primera = await listar(); } catch (error) {
    if (error.codigo !== "BODEGA_SIN_ALMACEN" && error.codigo !== "ALMACEN_NO_ES_DE_CONTEO") return mostrarError(error, () => vistaConteo({ bodega, almacen, itemCode }));
    return mostrarInventario(volverA("Contar", () => elegirConteo()),
      h("div", { class: "encabezado" }, h("h1", {}, `Contar ${almacen ? `la ${almacen}` : bodegaNombre(bodega, { corto: true })}`)),
      aviso("info", error.mensaje, {}, esSupervisor() && boton("", "bodega", "Elegir almacenes", { onclick: () => vistaSupervisor("almacenes") })));
  }
  // Almacén solo para contar: { almacen, nombre, tipo }.
  const extra = almacen ? primera.almacen : null;
  const grande = extra ? extra.tipo === "cajas" : bodega === "grande";
  if (!extra) recordarBodegas({ ...(estado.bodegas ?? {}), [bodega]: primera.almacen });
  const corto = extra ? `la ${extra.almacen}` : bodegaNombre(bodega, { corto: true });
  const otra = grande ? "pequena" : "grande";
  let lista = "falta", buscar = "", pagina = 0, filas = [], actual = null, vez = 0, vezPanel = 0, espera = null, repintar = null;

  const avance = h("div", { class: "conteo__avance" });
  const mensaje = h("div", { class: "conteo__mensaje", "aria-live": "polite" });
  const panel = h("section", { class: "tarjeta conteo__panel", "aria-label": "Producto que se está contando" });
  let enPantallaAncha = () => false;
  const pestanas = h("nav", { class: "pestanas conteo__pestanas", "aria-label": "Qué mostrar" });
  const filasLista = h("ul", { class: "conteo__lista" });
  const pie = h("div", { class: "fila fila--entre conteo__pie" });
  const cola = h("div", { class: "conteo__etiquetas" });
  const avisar = (tipo, texto) => poner(mensaje, texto && aviso(tipo, texto, { role: tipo === "error" ? "alert" : "status" }));

  // El lector: escribir filtra la lista; un código leído con Enter abre ese producto.
  const lector = campoLector({ placeholder: "Escaneá el producto o escribí para buscar en la lista", alLeer: leer,
    ayuda: "Con el producto en la mano, escanealo: se abre para contarlo.",
    alEscribir: (texto) => { clearTimeout(espera); espera = setTimeout(() => { buscar = texto; pagina = 0; cargar(); }, 350); } });
  limpiezas.push(() => clearTimeout(espera));
  async function leer(texto) {
    clearTimeout(espera);
    if (esCodigoCaja(texto)) {
      lector.entrada.value = "";
      return avisar("alerta", `${texto.toUpperCase()} es la etiqueta de una caja que ya está registrada. Escaneá el código del producto.`);
    }
    try {
      const exactos = (await api.buscarProductos(texto)).data.filter((p) => p.itemCode === texto || p.codigos.includes(texto) || p.codigosCaja?.includes(texto));
      if (exactos.length === 1) {
        lector.entrada.value = "";
        if (buscar) { buscar = ""; pagina = 0; cargar(); }
        return abrir(exactos[0].itemCode);
      }
      if (!exactos.length && pareceCodigoBarras(texto)) {
        lector.entrada.value = "";
        if (buscar) { buscar = ""; pagina = 0; cargar(); }
        return codigoDesconocido(texto);
      }
    } catch (error) { if (error.status === 401) return mostrarError(error); }
    buscar = texto; pagina = 0; cargar();
  }

  // Un código de barras que no es de ningún producto: se registra para el que se está contando o se elige el producto.
  function codigoDesconocido(codigo) {
    const enPanel = actual;
    const registrarAca = enPanel && boton("boton--principal", "completa", `Es de ${enPanel.itemName}`, { onclick: async () => {
      registrarAca.disabled = true;
      try {
        const { data } = await api.registrarCodigo(codigo, enPanel.itemCode);
        codigoRegistrado(data);
      } catch (error) {
        registrarAca.disabled = false;
        if (error.status === 401) return mostrarError(error);
        avisar("error", textoFalla(error));
      }
    } });
    poner(mensaje, aviso("alerta", `El código ${codigo} no es de ningún producto.`, { role: "status", class: "lectura-desconocida" },
      h("div", { class: "fila" }, registrarAca,
        boton(enPanel ? "" : "boton--principal", "buscar", enPanel ? "Es de otro producto" : "Elegir de qué producto es", { onclick: async () => {
          const data = await registrarCodigo({ codigo });
          if (!data) return;
          codigoRegistrado(data);
          if (actual?.itemCode !== data.itemCode) abrir(data.itemCode);
        } }))));
  }
  // Después de registrar un código: el producto abierto lo muestra y la lista se actualiza (sale de «Sin código»).
  function codigoRegistrado(data) {
    avisar("ok", `${data.codigo} quedó registrado para ${data.itemName}: ya se puede escanear.`);
    if (actual?.itemCode === data.itemCode && !actual.codigos.some((c) => c.codigo === data.codigo)) {
      actual.codigos.push({ id: data.id, codigo: data.codigo, origen: data.origen, confirmado: true });
      pintarCodigos?.();
    }
    cargar();
    lector.entrada.focus();
  }
  async function registrarPara(producto) {
    const data = await registrarCodigo({ producto });
    if (data) codigoRegistrado(data);
  }

  function pintarAvance(r) {
    const a = r.avance;
    poner(avance, barraAvance(a, `Avance del conteo de ${corto}`));
    const falta = a.total - a.contados;
    const opciones = [["falta", "Falta contar", falta], ["contados", "Contados", a.contados]];
    if (r.sinCodigo !== undefined) opciones.push(["sin_codigo", "Sin código", r.sinCodigo]);
    pestanas.replaceChildren(...opciones.map(([id, texto, n]) =>
      h("button", { class: "pestana", type: "button", "aria-current": id === lista ? "page" : null,
        onclick: () => { lista = id; pagina = 0; cargar(); } }, texto, h("span", { class: "contador" }, numero(n)))));
  }
  function pintarCola() {
    if (!grande || extra) return;
    const pendientes = etiquetasPendientes();
    const casilla = h("input", { id: "conteo-imprimir", type: "checkbox", checked: imprimirAlGuardar(),
      onchange: (evento) => { guardado.escribir("imprimirAlGuardar", evento.target.checked); repintar?.(); } });
    poner(cola, h("label", { class: "opcion", for: "conteo-imprimir" }, casilla, "Imprimir las etiquetas al guardar"),
      pendientes.length > 0 && boton("", "impresora", `Imprimir ${etiquetasTexto(etiquetasDeCola(pendientes).length)} pendientes`, { onclick: imprimirCola }));
  }
  async function imprimirCola() {
    const etiquetas = etiquetasDeCola(etiquetasPendientes());
    const r = await imprimirZona(etiquetas);
    if (r.ok) { guardado.borrar("etiquetasPendientes"); avisar("ok", `Se mandaron ${etiquetasTexto(etiquetas.length)} a la impresora.`); }
    else if (r.motivo !== "cancelled") avisar("error", "No se pudo imprimir. Revisá que la impresora esté encendida y probá de nuevo.");
    pintarCola();
  }
  // Etiquetas de lo que se acaba de contar: a la impresora o a la cola. Devuelve la frase para el aviso.
  async function etiquetasDe(cajas, p) {
    const producto = { itemCode: p.itemCode, itemName: p.itemName };
    const n = agruparEtiquetas(cajas).length;
    if (imprimirAlGuardar()) {
      const r = await imprimirEtiquetas(cajas, producto);
      if (r.ok) return ` ${n === 1 ? "Se mandó 1 etiqueta" : `Se mandaron ${etiquetasTexto(n)}`} a la impresora.`;
    }
    guardado.escribir("etiquetasPendientes", [...etiquetasPendientes(), ...cajas.map((caja) => ({ caja, producto }))]);
    pintarCola();
    return ` ${n === 1 ? "1 etiqueta quedó" : `${etiquetasTexto(n)} quedaron`} para imprimir.`;
  }

  const textoHay = (v) => (v.unidades === 0 ? "No hay" : grande ? textoContado({ total: v.unidades, cajas: v.cajas, etiquetas: v.cajas, lotesSueltos: v.sueltos ?? 0 })
    : unidadesTexto(v.unidades));
  function pintarLista(r) {
    if (!r.data.length) {
      return poner(filasLista, h("li", { class: "conteo__vacio" }, buscar ? `Ningún producto coincide con "${buscar}".`
        : lista === "falta" ? `No falta nada por contar en ${corto}.` : lista === "sin_codigo" ? `Todos los productos de ${corto} tienen código de barras.`
          : "Todavía no se contó ningún producto."));
    }
    const acciones = (v) => {
      if (lista === "sin_codigo") {
        return [boton("boton--principal", "escaner", "Registrar código", { onclick: () => registrarPara(v), "aria-label": `Registrar el código de ${v.itemName}` }),
          boton("", v.contado ? "siguiente" : "contar", v.contado ? "Ver" : "Contar", { onclick: () => abrir(v.itemCode), "aria-label": `${v.contado ? "Ver" : "Contar"} ${v.itemName}` })];
      }
      return lista === "falta"
        ? [boton("boton--principal", "contar", "Contar", { onclick: () => abrir(v.itemCode), "aria-label": `Contar ${v.itemName}` }),
          boton("", null, "No hay", { onclick: () => noHay(v), "aria-label": `No hay ${v.itemName}` })]
        : boton("", "siguiente", "Ver", { onclick: () => abrir(v.itemCode), "aria-label": `Ver ${v.itemName}` });
    };
    poner(filasLista, r.data.map((v) => h("li", { class: `conteo__fila${actual?.itemCode === v.itemCode ? " conteo__fila--actual" : ""}`, "data-item": v.itemCode },
      h("div", { class: "conteo__producto" }, h("strong", {}, v.itemName),
        h("span", {}, h("span", { class: "codigo" }, v.itemCode), v.codigos === 0 && lista !== "sin_codigo" && [" ", insignia("alerta", null, "Sin código")])),
      h("div", { class: "conteo__dato" }, lista === "contados" || (lista === "sin_codigo" && v.contado) ? textoHay(v) : `SAP ${numero(v.sap)}`),
      h("div", { class: "conteo__acciones" }, acciones(v)))));
  }
  const marcarActual = () => {
    for (const fila of filasLista.querySelectorAll(".conteo__fila")) fila.classList.toggle("conteo__fila--actual", fila.dataset.item === actual?.itemCode);
  };
  function pintarPie(r) {
    const paginas = Math.max(1, Math.ceil(r.total / 50));
    pie.replaceChildren(h("span", { class: "suave" }, `${numero(r.total)} ${r.total === 1 ? "producto" : "productos"} · página ${pagina + 1} de ${paginas}`),
      h("div", { class: "fila" },
        boton("", "volver", "Anterior", { disabled: pagina === 0, onclick: () => { pagina--; cargar(); } }),
        boton("", "siguiente", "Siguiente", { disabled: pagina + 1 >= paginas, onclick: () => { pagina++; cargar(); } })));
  }
  function pintar(r) { filas = r.data; pintarAvance(r); pintarLista(r); pintarPie(r); }
  async function cargar() {
    const esta = ++vez;
    let r;
    try { r = await listar({ estado: lista, buscar, pagina }); } catch (error) {
      if (error.status === 401) return mostrarError(error);
      poner(filasLista, h("li", {}, aviso("error", error.mensaje, { role: "alert" })));
      return null;
    }
    if (esta !== vez) return null;
    pintar(r);
    return r;
  }

  const sapEn = (p) => (extra ? p.sap ?? null : p.sapPorBodega?.[bodega] ?? null);
  // Los códigos de barras del producto abierto van en la línea del encabezado; sin ninguno, un aviso para registrarlo
  // ahí mismo escaneando el envase.
  let pintarCodigos = null;
  function cabeza(p) {
    const enLinea = h("span", { class: "conteo__codigos" });
    const zona = h("div", { class: "conteo__codigos-zona" });
    pintarCodigos = () => {
      poner(enLinea, p.codigos.length > 0 && [" · ", icono("escaner"), `${p.codigos.length === 1 ? "Código" : "Códigos"}: `,
        ...p.codigos.flatMap((c, i) => [i > 0 ? ", " : null, h("span", { class: "codigo" }, c.codigo)])]);
      poner(zona, p.codigos.length === 0 && aviso("alerta", "No tiene código de barras: no se va a poder escanear en los pedidos. Escanealo del envase para registrarlo.", {},
        boton("boton--principal", "escaner", "Registrar código", { onclick: () => registrarPara(p) })));
    };
    pintarCodigos();
    return [h("div", { class: "conteo__cabeza" }, h("span", { class: "rotulo" }, `Contando en ${corto}`),
      h("h2", {}, p.itemName),
      h("p", {}, h("span", { class: "codigo" }, p.itemCode), sapEn(p) !== null && ` · SAP tiene ${numero(sapEn(p))} en ${corto}`, enLinea)), zona];
  }
  function panelVacio() {
    actual = null; repintar = null; pintarCodigos = null; marcarActual();
    poner(panel, h("div", { class: "conteo__cabeza" }, h("span", { class: "rotulo" }, `Contando en ${corto}`), h("h2", {}, "¿Qué producto contás?")),
      h("p", { class: "suave" }, "Escaneá el producto con el lector o tocá «Contar» en la lista. Al guardar, pasa solo al siguiente que falta."),
      filas.length > 0 && lista === "falta" && boton("boton--principal", "contar", `Empezar por ${filas[0].itemName}`, { onclick: () => abrir(filas[0].itemCode) }));
  }
  async function abrir(codigo, { editarlo = false } = {}) {
    const esta = ++vezPanel;
    poner(panel, cargando("Cargando producto…"));
    let p;
    try { p = (await (extra ? api.productoConteoAlmacen(almacen, codigo) : api.producto(codigo))).data; } catch (error) {
      if (error.status === 401) return mostrarError(error);
      return poner(panel, aviso("error", error.mensaje, { role: "alert" }));
    }
    if (esta !== vezPanel) return;
    actual = p; repintar = null;
    marcarActual();
    if (enPantallaAncha()) window.scrollTo({ top: document.documentElement.scrollHeight });
    if (extra ? p.contado : p.contadoEn?.[bodega]) return editarlo && esSupervisor() ? editar(p) : yaContado(p);
    formulario(p);
  }
  function verProducto(itemCode) { estado.desdeConteo = extra ? { almacen } : bodega; vistaProducto(itemCode); }
  function yaContado(p) {
    const unidadesEn = extra ? p.unidades : grande ? p.lotes.reduce((t, l) => t + l.unidades, 0) : p.pequena;
    const enLa01 = grande && !extra ? p.lotes.flatMap((l) => l.cajas).filter((c) => c.unidades > 0) : [];
    const cajas = extra ? p.cajas : enLa01.filter((c) => !c.suelto).length;
    const lotesSueltos = extra ? (grande ? p.lineas.filter((l) => l.cajas === null).length : 0) : enLa01.filter((c) => c.suelto).length;
    const proximo = filas.find((v) => lista === "falta" && v.itemCode !== p.itemCode);
    poner(panel, cabeza(p),
      aviso("ok", `Ya está contado en ${corto}: ${unidadesEn ? textoContado({ total: unidadesEn, cajas, etiquetas: cajas, lotesSueltos }) : "no hay"}.`
        + (extra && p.contadoPor ? ` Lo contó ${p.contadoPor}${p.actualizadoPor && p.actualizadoPor !== p.contadoPor ? `; lo corrigió ${p.actualizadoPor}` : ""}.` : "")),
      h("p", { class: "suave" }, esSupervisor() ? "Si faltó un lote o una fecha está mal, editá el conteo: se abre con lo que se guardó."
        : "Si faltó algo, avisale al supervisor: él puede editar el conteo."),
      h("div", { class: "fila" },
        esSupervisor() && boton("boton--principal", "contar", "Editar conteo", { onclick: () => editar(p) }),
        boton("", "siguiente", "Ver el producto", { onclick: () => verProducto(p.itemCode) }),
        proximo && boton("boton--principal", "contar", "Siguiente que falta", { onclick: () => abrir(proximo.itemCode) })));
  }

  // Editar un conteo ya cerrado (supervisor). La grande abre este mismo formulario con lo guardado; la pequeña, el
  // conteo por lotes con sus lotes. Si alguna caja ya se usó, se corrige desde el producto.
  function editar(p) {
    if (extra) return formulario(p, { edicion: grande ? conteoGuardadoAlmacen(p.lineas) : { lotes: p.lineas } });
    if (!grande) return contarPequena(p, { alTerminar: (texto) => despuesDeEditar(p, texto) });
    const guardado = conteoGuardadoGrande(p.lotes);
    if (guardado.problema) {
      return poner(panel, cabeza(p), aviso("alerta", guardado.problema, { role: "alert" }),
        h("div", { class: "fila" }, boton("", "siguiente", "Ver el producto", { onclick: () => verProducto(p.itemCode) })));
    }
    formulario(p, { edicion: guardado });
  }
  async function despuesDeEditar(p, texto) {
    await cargar();
    avisar("ok", texto);
    return abrir(p.itemCode);
  }

  function formulario(p, { edicion = null } = {}) {
    const operacion = crearOperacion();
    const sap = sapEn(p);
    const campos = grande ? formularioCajas({ prefijo: "conteo", sugerencia: p.sugerencia, cajas: "", valores: edicion, conEtiquetas: !extra })
      : formularioLotes({ prefijo: "conteo", valores: edicion?.lotes });
    const total = h("p", { class: "conteo__total", "aria-live": "polite" });
    const problema = aviso("error", "", { role: "alert", hidden: true });
    const guardar = boton("boton--principal boton--grande", "completa", "Guardar", { type: "submit" });
    const mostrarProblema = (texto) => { textoAviso(problema, texto); problema.hidden = false; };
    const codigoCaja = grande ? campoCodigoCaja(p) : null;
    function leerConteo() {
      if (grande) { const { filas: grupos, bultos } = campos.leer(); return armarConteoCajas(grupos, bultos); }
      const r = armarLotesPequena(campos.leer());
      return r.problema ? r : { cuerpo: { modo: "lotes", lotes: r.lotes }, total: r.total, cajas: 0, etiquetas: 0 };
    }
    function pintarFormulario() {
      const r = leerConteo();
      // Al editar, solo las cajas nuevas llevan etiqueta (se informa al guardar): el botón no cuenta las que ya tienen.
      const etiquetas = r.problema || edicion || extra ? 0 : r.etiquetas;
      guardar.replaceChildren(icono(etiquetas ? "impresora" : "completa"), !etiquetas ? (edicion ? "Guardar cambios" : "Guardar")
        : imprimirAlGuardar() ? `Guardar e imprimir ${etiquetasTexto(etiquetas)}` : `Guardar (${etiquetasTexto(etiquetas)} a la cola)`);
      total.textContent = r.problema ? "" : `Contaste ${textoContado(r)}.${sap !== null ? ` SAP tiene ${numero(sap)} en ${corto}.` : ""}`;
    }
    repintar = pintarFormulario;
    async function enviar(evento, adelantar = false) {
      evento?.preventDefault();
      const r = leerConteo();
      if (r.problema) return mostrarProblema(r.problema);
      if (campos.meses().some((m) => m.value && !finDeMes(m.value))) return mostrarProblema("Un vencimiento no es válido.");
      problema.hidden = true; guardar.disabled = true;
      if (codigoCaja) {
        const falla = await codigoCaja.registrar();
        if (falla) { guardar.disabled = false; if (falla.status === 401) return mostrarError(falla); return mostrarProblema(textoFalla(falla)); }
      }
      if (extra) return guardarEnAlmacen(r);
      if (edicion) return guardarEdicion(r);
      try {
        const { data } = await api.recibir(operacion.para({ itemCode: p.itemCode, ...r.cuerpo, adelantar }));
        operacion.terminar();
        const etiquetas = data.cajas.length ? await etiquetasDe(data.cajas, p) : "";
        await siguiente(p, `${p.itemName}: ${textoContado(r)} en ${corto}.${etiquetas}`);
      } catch (error) {
        guardar.disabled = false;
        if (error.status === 401) return mostrarError(error);
        if (error.codigo === "EXCEDE_POR_UBICAR" && !adelantar) {
          const seguir = await confirmar({ titulo: "Contaste más de lo que SAP tiene", aceptar: "Guardar igual",
            texto: [error.mensaje,
              "Si contaste bien, guardalo igual: la diferencia queda anotada para revisarla con SAP."] });
          return seguir ? enviar(null, true) : undefined;
        }
        mostrarProblema(textoFalla(error));
      }
    }
    // Almacén solo para contar: se guarda lo contado (o se reemplaza, al editar), sin aviso si pasa de SAP.
    async function guardarEnAlmacen(r) {
      try {
        const cuerpo = grande ? cuerpoEdicionGrande(r.cuerpo) : { lotes: r.cuerpo.lotes };
        const { data } = await api.guardarConteoAlmacen(almacen, p.itemCode, operacion.para(cuerpo));
        operacion.terminar();
        const texto = `${p.itemName}: ${textoContado(r)} en ${corto}.${sap !== null && sap !== r.total ? ` SAP tiene ${numero(sap)}: queda la diferencia para revisarla.` : ""}`;
        if (edicion) {
          const cambio = data.antes === null ? 0 : data.unidades - data.antes;
          return despuesDeEditar(p, `${p.itemName}: conteo editado, ${unidadesTexto(data.unidades)} en ${corto}${cambio ? ` (${cambio > 0 ? "+" : ""}${numero(cambio)})` : ""}.`);
        }
        await siguiente(p, texto);
      } catch (error) {
        guardar.disabled = false;
        if (error.status === 401) return mostrarError(error);
        mostrarProblema(textoFalla(error));
      }
    }
    // Edición: el formulario dice cómo queda todo en la grande. Las cajas que no cambian conservan su etiqueta; las nuevas
    // se imprimen y las anuladas hay que retirarlas (se avisa con un diálogo para que no pase de largo).
    async function guardarEdicion(r) {
      try {
        const { data } = await api.editarConteoGrande(p.itemCode, operacion.para(cuerpoEdicionGrande(r.cuerpo)));
        operacion.terminar();
        if (data.anuladas.length) {
          await informar({ titulo: data.anuladas.length === 1 ? "Retirá esta etiqueta" : "Retirá estas etiquetas", texto: [
            `Estas cajas ya no figuran en ${corto}: sacales la etiqueta (o la caja, si no existe).`,
            data.anuladas.join(", "),
            data.cajas.length ? "Las que reemplazan a estas tienen etiqueta nueva." : ""].filter(Boolean) });
        }
        const etiquetas = data.cajas.length ? await etiquetasDe(data.cajas, p) : "";
        const cambio = data.unidades - data.antes;
        await despuesDeEditar(p, `${p.itemName}: conteo editado, ${unidadesTexto(data.unidades)} en ${corto}`
          + `${cambio ? ` (${cambio > 0 ? "+" : ""}${numero(cambio)})` : ""}.${etiquetas}`);
      } catch (error) {
        guardar.disabled = false;
        if (error.status === 401) return mostrarError(error);
        mostrarProblema(textoFalla(error));
      }
    }
    poner(panel, cabeza(p),
      h("form", { class: "formulario-recepcion formulario-conteo", onsubmit: (evento) => enviar(evento), oninput: pintarFormulario, onchange: pintarFormulario },
        edicion && aviso("info", extra ? `Editando el conteo guardado: dejá todo como está realmente en ${corto}.`
          : "Editando el conteo guardado: dejá todo como está realmente en la bodega. Las cajas que no cambian conservan su etiqueta."),
        h("h3", {}, grande ? "¿Cuántas cajas hay de cada lote?" : "¿Cuántas unidades hay de cada lote?"),
        campos.elemento, codigoCaja?.elemento, total, problema,
        h("div", { class: "fila" }, guardar,
          !edicion && boton("", null, "No hay", { onclick: () => noHay(p), "aria-label": `No hay ${p.itemName} en ${corto}` }),
          boton("", null, "Cancelar", { onclick: () => (edicion ? yaContado(p) : panelVacio()) }))));
    pintarFormulario();
    campos.enfocar();
  }

  // Se registra que se contó y no había. Un reintento del mismo producto reusa su operación.
  const operacionesNoHay = new Map();
  async function noHay(producto) {
    const ok = await confirmar({ titulo: `¿No hay ${producto.itemName} en ${corto}?`, aceptar: "Sí, no hay",
      texto: ["Queda contado en 0 y pasa al siguiente.", producto.sap > 0 || sapEn(producto) > 0 ? `SAP dice que hay ${numero(producto.sap ?? sapEn(producto))}: la diferencia queda para revisarla.` : ""].filter(Boolean) });
    if (!ok) return;
    const operacion = operacionesNoHay.get(producto.itemCode) ?? crearOperacion();
    operacionesNoHay.set(producto.itemCode, operacion);
    try {
      if (extra) await api.guardarConteoAlmacen(almacen, producto.itemCode, operacion.para(grande ? { grupos: [], bultos: [] } : { lotes: [] }));
      else await api.sinExistencia(producto.itemCode, operacion.para({ bodega }));
      operacion.terminar();
      operacionesNoHay.delete(producto.itemCode);
      await siguiente(producto, `${producto.itemName}: no hay en ${corto}.`);
    } catch (error) {
      if (error.status === 401) return mostrarError(error);
      avisar("error", textoFalla(error));
    }
  }

  // Después de guardar: se actualiza la lista y se abre el siguiente que falta contar. Un «No hay» tocado en la lista
  // mientras se cuenta otro producto no cierra ese formulario.
  async function siguiente(p, texto) {
    if (actual && actual.itemCode !== p.itemCode) { await cargar(); return avisar("ok", texto); }
    const r = await cargar();
    const proximo = r && lista === "falta" ? filas.find((v) => v.itemCode !== p.itemCode) : null;
    avisar("ok", proximo ? `${texto} Sigue: ${proximo.itemName}.` : r && lista === "falta" && !buscar && !r.total ? `${texto} No falta nada por contar en ${corto}.` : texto);
    if (proximo) return abrir(proximo.itemCode);
    panelVacio();
    lector.entrada.focus();
  }

  mostrarInventario(volverInventario(),
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, `Contar ${corto}`),
      h("p", { class: "encabezado__sub" }, extra ? `${extra.almacen} · ${extra.nombre}` : bodegaNombre(bodega), " · ",
        grande ? "cajas de cada lote; lo suelto, como un bulto" : "unidades sueltas de cada lote", extra ? " · solo conteo" : "")),
      extra ? boton("", "volver", "Elegir otra bodega", { onclick: () => elegirConteo() })
        : boton("", grande ? "capas" : "caja", `Contar ${bodegaNombre(otra, { corto: true })}`, { onclick: () => vistaConteo({ bodega: otra }) })),
    h("div", { class: "conteo__barra" }, avance, cola),
    lector.seccion, mensaje,
    h("div", { class: "conteo-layout" }, panel,
      h("section", { class: "conteo__columna", "aria-label": "Productos de la bodega" }, pestanas, filasLista, pie)));
  // En la PC las dos columnas ocupan lo que queda de la pantalla y cada una tiene su propia barra: el formulario se baja
  // sin mover la lista ni la página, y el lector queda siempre a la vista.
  // El alto es lo que queda debajo del lector cuando queda fijo arriba; al abrir un producto la página sube hasta ahí.
  const layout = panel.parentElement;
  const medirAlto = () => {
    const fijo = parseFloat(getComputedStyle(lector.seccion).top) || 0;
    const abajo = parseFloat(getComputedStyle(layout.parentElement).paddingBottom) || 0;
    // 32: el margen debajo del lector y un poco de aire.
    layout.style.setProperty("--alto-conteo", `${Math.max(420, window.innerHeight - fijo - lector.seccion.offsetHeight - abajo - 32)}px`);
  };
  enPantallaAncha = () => window.matchMedia("(min-width: 1100px)").matches;
  const observador = new ResizeObserver(medirAlto);
  for (const e of [lector.seccion, mensaje, layout.previousElementSibling]) if (e) observador.observe(e);
  escuchar(window, "resize", medirAlto);
  limpiezas.push(() => observador.disconnect());
  medirAlto();
  pintar(primera);
  pintarCola();
  if (itemCode) abrir(itemCode, { editarlo: editarAlAbrir });
  else { panelVacio(); lector.entrada.focus(); }
}

// ---------------------------------------------------------------------------
// Panel del supervisor: almacenes de esta bodega y registro de códigos
// ---------------------------------------------------------------------------

async function panelAlmacenes(panel) {
  let datos;
  try { datos = (await api.almacenes()).data; } catch (error) { panel.contenido.replaceChildren(); return panel.fallo(error, () => vistaSupervisor("almacenes")); }
  const original = new Set(datos.almacenes.filter((a) => a.deEstaBodega).map((a) => a.warehouseCode));
  const marcados = new Set(original);
  let todos = false;
  const filtrar = h("input", { id: "almacenes-filtrar", type: "checkbox", checked: datos.pedidosSoloDeEstaBodega });
  // Qué almacén marcado es la bodega grande y cuál la pequeña (para ver en cada bodega lo que SAP tiene en su almacén).
  const asignado = { grande: datos.almacenGrande ?? null, pequena: datos.almacenPequena ?? null };
  const vigente = (codigo) => (codigo && marcados.has(codigo) ? codigo : null);
  const selectores = { grande: h("select", { id: "almacen-grande", class: "campo" }), pequena: h("select", { id: "almacen-pequena", class: "campo" }) };
  const nombreAlmacen = (codigo) => datos.almacenes.find((a) => a.warehouseCode === codigo)?.warehouseName ?? "";
  function pintarBodegas() {
    for (const [bodega, select] of Object.entries(selectores)) {
      select.replaceChildren(h("option", { value: "" }, "Sin asignar"),
        ...[...marcados].sort().map((codigo) => h("option", { value: codigo }, `${codigo} · ${nombreAlmacen(codigo)}`)));
      select.value = vigente(asignado[bodega]) ?? "";
    }
  }
  for (const [bodega, select] of Object.entries(selectores)) {
    select.addEventListener("change", () => {
      asignado[bodega] = select.value || null;
      const otra = bodega === "grande" ? "pequena" : "grande";
      if (asignado[otra] === asignado[bodega]) asignado[otra] = null;
      pintarBodegas();
      guardar.disabled = !cambiado();
    });
  }
  // Almacenes solo para contar (por ejemplo la 03 y la 04): no se marcan como de esta bodega, así no entran en la
  // comparación de la 01 y la 02; se cuentan y se comparan aparte, cada uno contra lo que SAP tiene en él.
  const conteoOriginal = JSON.stringify(datos.soloConteo ?? []);
  let soloConteo = (datos.soloConteo ?? []).map((a) => ({ ...a }));
  const listaConteo = h("div", { class: "solo-conteo" });
  const libres = (actual = null) => datos.almacenes.map((a) => a.warehouseCode)
    .filter((c) => !marcados.has(c) && (c === actual || !soloConteo.some((x) => x.almacen === c))).sort();
  const agregarConteo = boton("", "mas", "Agregar un almacén para contar", { onclick: () => {
    const libre = libres()[0];
    if (!libre) return;
    soloConteo.push({ almacen: libre, tipo: "sueltas" });
    pintarConteo();
    guardar.disabled = !cambiado();
    listaConteo.querySelector(".solo-conteo__fila:last-child select")?.focus();
  } });
  function pintarConteo() {
    soloConteo = soloConteo.filter((a) => !marcados.has(a.almacen));
    poner(listaConteo, soloConteo.length ? soloConteo.map((a, i) => {
      const almacen = h("select", { id: `conteo-almacen-${i}`, class: "campo", onchange: (evento) => {
        a.almacen = evento.target.value; pintarConteo(); guardar.disabled = !cambiado();
      } }, libres(a.almacen).map((c) => h("option", { value: c }, `${c} · ${nombreAlmacen(c)}`)));
      almacen.value = a.almacen;
      const tipo = h("select", { id: `conteo-tipo-${i}`, class: "campo", onchange: (evento) => { a.tipo = evento.target.value; guardar.disabled = !cambiado(); } },
        h("option", { value: "cajas" }, "Por cajas, como la 01"),
        h("option", { value: "sueltas" }, "Sueltas por lote, como la 02"));
      tipo.value = a.tipo;
      return h("div", { class: "rejilla-campos solo-conteo__fila" },
        h("label", { class: "campo-etiqueta", for: almacen.id }, h("span", {}, "Almacén"), almacen),
        h("label", { class: "campo-etiqueta", for: tipo.id }, h("span", {}, "Cómo se cuenta"), tipo),
        boton("solo-conteo__quitar", "borrar", "Quitar", { "aria-label": `Quitar la ${a.almacen} de los almacenes para contar`,
          onclick: () => { soloConteo.splice(i, 1); pintarConteo(); guardar.disabled = !cambiado(); } }));
    }) : h("p", { class: "suave" }, "Ninguno."));
    agregarConteo.disabled = !libres().length || soloConteo.length >= 10;
  }
  const cuerpo = h("tbody");
  const guardar = boton("boton--principal", "completa", "Guardar", { disabled: true });
  const mostrarTodos = boton("", null, "", { onclick: () => { todos = !todos; pintar(); } });
  const conDatos = (a) => a.productos > 0 || a.lineasAbiertas > 0 || original.has(a.warehouseCode);
  const ocultos = datos.almacenes.filter((a) => !conDatos(a)).length;
  const cambiado = () => filtrar.checked !== datos.pedidosSoloDeEstaBodega || marcados.size !== original.size || [...marcados].some((c) => !original.has(c))
    || vigente(asignado.grande) !== (datos.almacenGrande ?? null) || vigente(asignado.pequena) !== (datos.almacenPequena ?? null)
    || JSON.stringify(soloConteo) !== conteoOriginal;
  function pintar() {
    const visibles = datos.almacenes.filter((a) => todos || conDatos(a) || marcados.has(a.warehouseCode));
    cuerpo.replaceChildren(...visibles.map((a) => {
      const id = `almacen-${a.warehouseCode.replace(/[^a-z0-9]/gi, "_")}`;
      const casilla = h("input", { id, type: "checkbox", checked: marcados.has(a.warehouseCode), onchange: (evento) => {
        if (evento.target.checked) marcados.add(a.warehouseCode); else marcados.delete(a.warehouseCode);
        pintarBodegas();
        pintarConteo();
        guardar.disabled = !cambiado();
        evento.target.closest("tr").classList.toggle("fila--marcada", evento.target.checked);
      } });
      return h("tr", { class: marcados.has(a.warehouseCode) ? "fila--marcada" : null },
        h("td", { class: "tabla__casilla" }, casilla),
        h("th", { scope: "row" }, h("label", { for: id }, h("strong", {}, `${a.warehouseCode} · ${a.warehouseName}`)),
          a.productos > 0 && h("button", { class: "enlace almacen__ver", type: "button", onclick: () => vistaProductos({ vista: "almacen", almacen: a.warehouseCode }) },
            "Ver productos"),
          h("div", { class: "suave" }, a.inactive ? insignia("gris", null, "Inactivo en SAP") : "",
            a.lineasAbiertas > 0 ? ` Salen de acá ${numero(a.lineasAbiertas)} ${a.lineasAbiertas === 1 ? "línea" : "líneas"} de pedidos abiertos` : " Sin pedidos abiertos")),
        h("td", { class: "tabla__numero" }, numero(a.productos)),
        h("td", { class: "tabla__numero" }, numero(a.unidades)),
        h("td", { class: "tabla__numero" }, numero(a.lineasAbiertas)));
    }));
    mostrarTodos.textContent = todos ? "Ocultar los que no tienen existencia ni pedidos" : `Mostrar todos (${numero(ocultos)} sin existencia ni pedidos)`;
    mostrarTodos.hidden = ocultos === 0;
  }
  filtrar.addEventListener("change", () => { guardar.disabled = !cambiado(); });
  guardar.addEventListener("click", async () => {
    guardar.disabled = true;
    try {
      await api.elegirAlmacenes([...marcados], filtrar.checked, { almacenGrande: vigente(asignado.grande), almacenPequena: vigente(asignado.pequena),
        soloConteo: soloConteo.map(({ almacen, tipo }) => ({ almacen, tipo })) });
      panel.avisar("ok", marcados.size ? `Listo: el inventario compara contra ${numero(marcados.size)} ${marcados.size === 1 ? "almacén" : "almacenes"} de SAP.`
        : "Listo: no hay almacenes elegidos; el inventario no se compara con SAP.");
      await panel.refrescar();
      await panelAlmacenes(panel);
    } catch (error) { guardar.disabled = false; panel.fallo(error); }
  });
  if (!datos.almacenes.length) {
    return panel.contenido.replaceChildren(aviso("alerta", "Todavía no llegaron los almacenes de SAP. Revisá en Sincronización que el puente esté enviando \"Almacenes\"."));
  }
  panel.contenido.replaceChildren(
    h("p", { class: "suave" }, "Almacenes de SAP. Marcá los que son de esta bodega: el inventario compara solo contra lo que SAP tiene en ellos. Después elegí cuál es la bodega de cajas y cuál la de despacho."),
    h("div", { class: "tabla-envoltura" }, h("table", { class: "tabla tabla--almacenes" },
      h("thead", {}, h("tr", {}, ["Esta bodega", "Almacén de SAP", "Productos con existencia", "Unidades en SAP", "Líneas de pedidos abiertos"]
        .map((t, i) => h("th", { scope: "col", class: i >= 2 ? "tabla__numero" : null }, t)))),
      cuerpo)),
    h("div", { class: "fila fila--entre" }, mostrarTodos),
    h("fieldset", { class: "tarjeta bodegas-almacen" }, h("legend", {}, "¿Qué almacén es cada bodega?"),
      h("p", { class: "suave" }, "Entre los marcados. Cada bodega toma el nombre de su almacén (por ejemplo, «01 · Principal») y se cuenta contra lo que SAP tiene ahí."),
      h("div", { class: "rejilla-campos" },
        h("label", { class: "campo-etiqueta", for: "almacen-grande" }, h("span", {}, "Bodega de cajas completas"), selectores.grande),
        h("label", { class: "campo-etiqueta", for: "almacen-pequena" }, h("span", {}, "Bodega de despacho (de donde salen los pedidos)"), selectores.pequena))),
    h("fieldset", { class: "tarjeta bodegas-almacen" }, h("legend", {}, "Almacenes solo para contar"),
      h("p", { class: "suave" }, "Por ejemplo la 03 y la 04: se cuentan y se comparan con lo que SAP tiene en cada uno, pero no se reciben ni se mueven cosas y no entran en Pendientes ni en los pedidos. No los marques arriba."),
      listaConteo, agregarConteo),
    h("label", { class: "opcion tarjeta opcion--tarjeta", for: "almacenes-filtrar" }, filtrar, "En Pedidos, mostrar solo los pedidos que salen de los almacenes marcados"),
    h("div", { class: "fila" }, guardar),
    h("p", { class: "suave panel__nota" }, "Los nombres y cantidades salen de SAP (solo lectura). Cambiar la selección no mueve mercadería: solo cambia contra qué se compara el inventario."));
  pintar();
  pintarBodegas();
  pintarConteo();
}

// Registrar un código de barras que SAP no tiene: se escanea el envase y se elige el producto. Resuelve lo
// registrado o null si se cancela. codigo: uno ya leído (el lector lo dejó en otra pantalla).
function registrarCodigo({ producto = null, codigo: leido = "" } = {}) {
  return new Promise((resolver) => {
    let resuelto = false, elegido = producto, espera = null;
    const cerrar = (valor) => { resuelto = true; clearTimeout(espera); dialogo.close(); resolver(valor); };
    const error = aviso("error", "", { role: "alert", hidden: true });
    const codigo = h("input", { id: "registro-codigo", class: "campo codigo", autocomplete: "off", spellcheck: "false", maxlength: "64", value: leido || null });
    const buscar = h("input", { id: "registro-buscar", class: "campo", type: "search", autocomplete: "off", placeholder: "Nombre o código del artículo" });
    const resultados = h("ul", { class: "resultados-producto" });
    const elegidoTexto = h("p", { class: "registro__elegido" });
    const pintarElegido = () => poner(elegidoTexto, elegido ? [icono("completa"), h("strong", {}, elegido.itemName), " ", h("span", { class: "codigo" }, elegido.itemCode)] : "Todavía no elegiste el producto.");
    async function cargar() {
      const texto = buscar.value.trim();
      if (texto.length < 2) return resultados.replaceChildren();
      try {
        const { data } = await api.buscarProductos(texto);
        resultados.replaceChildren(...data.map((p) => h("li", {}, h("button", { class: "resultado-producto", type: "button",
          "aria-pressed": String(elegido?.itemCode === p.itemCode), onclick: () => { elegido = p; pintarElegido(); cargar(); } },
        h("strong", {}, p.itemName), h("span", { class: "codigo" }, p.itemCode)))));
        if (!data.length) resultados.replaceChildren(h("li", { class: "suave" }, "Ningún producto coincide."));
      } catch (e) { textoAviso(error, e.mensaje); error.hidden = false; }
    }
    buscar.addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(cargar, 300); });
    // El Enter del lector en el campo del código pasa al buscador en lugar de enviar el formulario.
    codigo.addEventListener("keydown", (evento) => { if (evento.key === "Enter" && !producto) { evento.preventDefault(); buscar.focus(); } });
    const formulario = h("form", { class: "dialogo__formulario", onsubmit: async (evento) => {
      evento.preventDefault();
      const valor = codigo.value.trim();
      if (!valor) { textoAviso(error, "Escaneá o escribí el código de barras."); error.hidden = false; return codigo.focus(); }
      if (!elegido) { textoAviso(error, "Elegí el producto."); error.hidden = false; return buscar.focus(); }
      error.hidden = true;
      try {
        const { data } = await api.registrarCodigo(valor, elegido.itemCode);
        cerrar(data);
      } catch (e) {
        if (e.status === 401) { cerrar(null); return mostrarError(e); }
        textoAviso(error, e.mensaje); error.hidden = false;
      }
    } },
    h("div", { class: "dialogo__cuerpo" }, h("h2", {}, "Registrar un código de barras"),
      h("p", {}, "Queda guardado con la unidad del artículo y confirmado: cada lectura cuenta 1 unidad. No se cambia nada en SAP."),
      error,
      h("label", { class: "campo-etiqueta", for: "registro-codigo" }, h("span", {}, "Código de barras"), codigo,
        h("small", { class: "suave" }, "Escanealo del envase.")),
      producto ? h("p", { class: "registro__elegido" }, icono("completa"), h("strong", {}, producto.itemName), " ", h("span", { class: "codigo" }, producto.itemCode))
        : [h("label", { class: "campo-etiqueta", for: "registro-buscar" }, h("span", {}, "Producto"), buscar), resultados, elegidoTexto]),
    h("div", { class: "dialogo__acciones" },
      h("button", { class: "boton", type: "button", onclick: () => cerrar(null) }, "Cancelar"),
      h("button", { class: "boton boton--principal", type: "submit" }, "Registrar")));
    dialogo.replaceChildren(formulario);
    dialogo.onclose = () => { if (!resuelto) { clearTimeout(espera); resolver(null); } };
    pintarElegido();
    dialogo.showModal();
    (leido && !producto ? buscar : codigo).focus();
  });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

// Versión nueva ya descargada por la app: un botón en la barra la instala reiniciando. Si nadie lo usa, se instala
// sola al cerrar la app.
function avisoDeActualizacion() {
  const escritorio = window.escritorio;
  if (!escritorio?.actualizacionPendiente) return;
  const botonActualizar = document.getElementById("btn-actualizacion");
  let version = null;
  const pintar = (datos) => {
    if (!datos?.version) return;
    version = datos.version;
    document.getElementById("texto-actualizacion").textContent = `Actualizar a ${version}`;
    botonActualizar.hidden = false;
  };
  botonActualizar.addEventListener("click", async () => {
    const ok = await confirmar({ titulo: `Versión ${version} lista`, aceptar: "Reiniciar y actualizar", texto: [
      "La app se cierra, instala la versión nueva y se vuelve a abrir sola.",
      "Terminá antes lo que estés cargando. Las lecturas sin enviar quedan guardadas en este equipo.",
      "Si no la instalás ahora, se instala sola la próxima vez que se cierre la app.",
    ] });
    if (ok) await escritorio.instalarActualizacion();
  });
  escritorio.alActualizacionLista(pintar);
  escritorio.actualizacionPendiente().then(pintar).catch(() => {});
}

for (const lugar of document.querySelectorAll("[data-icono]")) lugar.replaceWith(icono(lugar.dataset.icono));
document.getElementById("btn-inicio").addEventListener("click", () => (api ? vistaPedidos() : vistaIngreso()));
document.getElementById("btn-menu").addEventListener("click", abrirMenu);
const conexion = document.getElementById("estado-conexion");
const pintarConexion = () => { conexion.hidden = navigator.onLine; };
window.addEventListener("online", pintarConexion);
window.addEventListener("offline", pintarConexion);
pintarConexion();
actualizarBarra();
avisoDeActualizacion();

if (!api) vistaIngreso();
else if (estado.sesion) vistaEscaneo();
else vistaPedidos();
