import { crearApi } from "./api.js";
import { crearColaLecturas } from "./lecturas.js";
import { icono } from "./iconos.js";
import { HORAS_EN_LISTA, sigueEnLista, textosPreparado } from "./preparados.js";
import { NOMBRES_DATOS, estadoDatos, estadoOperador, puedeSerUnidad, quienConfirmo, textoCambio, textoRevision, textoSinEntrega, textoUnidad } from "./supervisor.js";
import { ESTADOS, armarAsignaciones, cantidadMovimiento, diasParaVencer, esCodigoCaja, finDeMes, opcionesDescuento, quien, resumenRecepcion,
  sugerirAsignacion, textoAsignacion, textoDocumento, textoEstado, textoMovimiento, textoPorVencer, textoVencimiento } from "./inventario.js";
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
    actualizado.replaceChildren(
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
    const [pedido, sesion] = await Promise.all([api.pedido(p.docEntry).then((r) => r.data), api.sesion(p.preparado.pickingId).then((r) => r.data)]);
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
  const { data: pedido, preparacion } = respuesta;
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
      tarjetaLinea(l.pedidoLineNum, { ...lineasPorNumero.get(l.pedidoLineNum), uomCode: l.uomCode }, { pedida: l.cantidadPedida }))),
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
    [pedido, sesion] = await Promise.all([api.pedido(docEntry).then((r) => r.data), api.sesion(pickingId).then((r) => r.data)]);
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
    lista.replaceChildren(...orden.map((l) => tarjetaLinea(l.pedidoLineNum,
      { ...lineasPedido.get(l.pedidoLineNum), itemCode: l.itemCode, uomCode: l.uomCode },
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
    return lineasPedido.get(linea.pedidoLineNum)?.itemName ?? linea.itemCode;
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
    try {
      const { data } = await api.finalizar(pickingId);
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
      h("ul", { class: "lineas" }, faltantes.map((l) => tarjetaLinea(l.pedidoLineNum,
        { ...lineasPedido.get(l.pedidoLineNum), itemCode: l.itemCode, uomCode: l.uomCode },
        { pedida: l.cantidadPedida, escaneada: l.cantidadEscaneada })))),
    boton("boton--principal boton--ancho boton--grande", "volver", volver.texto, { onclick: volver.accion }));
}

// ---------------------------------------------------------------------------
// Panel del supervisor: etiquetas, operadores, revisiones y sincronización
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
    almacenes: panelAlmacenes };
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
    const cantidadEsperada = conteo?.manualSinConfirmar ?? 0;
    if (!(await confirmar({ titulo: "Confirmar todos como unidad", aceptar: `Confirmar ${numero(cantidadEsperada)}`,
      texto: [`Se van a confirmar ${numero(cantidadEsperada)} códigos con unidad Manual como unidad individual: cada lectura cuenta 1 unidad del producto.`,
        "Si alguno es de una caja, después lo podés cambiar a \"No es una unidad\" desde Confirmadas."] }))) return;
    try {
      const { data } = await api.confirmarManual(cantidadEsperada);
      panel.avisar("ok", `${numero(data.confirmadas)} códigos confirmados como unidad.`);
    } catch (error) { panel.fallo(error); }
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
      const [pedido, sesion] = await Promise.all([api.pedido(f.pedido.docEntry).then((r) => r.data), api.sesion(f.pickingId).then((r) => r.data)]);
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

// ---------------------------------------------------------------------------
// Inventario: bodega grande (cajas por lote) y bodega pequeña (unidades sueltas)
// ---------------------------------------------------------------------------

const unidadesTexto = (n) => `${numero(n)} ${Math.abs(n) === 1 ? "unidad" : "unidades"}`;
// Fecha del día en el equipo (la recepción es un momento exacto, no una fecha de SAP).
const fechaLocal = (iso) => (iso ? new Date(iso).toLocaleDateString("es-HN") : "—");
const volverA = (texto, accion) => boton("boton--volver", "volver", texto, { onclick: accion });
const volverInventario = () => volverA("Inventario", () => vistaInventario());
const enteroPositivo = (valor, minimo = 1) => Number.isInteger(valor) && valor >= minimo && valor <= 1_000_000;
const ICONO_MOVIMIENTO = { recepcion: "caja", reposicion: "mover", picking: "lista", descuento: "restar", reasignacion: "actualizar",
  conteo: "contar", correccion: "contar" };

function mostrarInventario(...nodos) { mostrarAmplio(navegacion("inventario"), ...nodos); }

// Campo para el lector: escribe como un teclado y termina con Enter. También se puede escribir a mano.
function campoLector({ etiqueta = "Lector", placeholder, ayuda = null, alLeer }) {
  const entrada = h("input", { class: "entrada-escaneo", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    enterkeyhint: "search", "aria-label": placeholder, placeholder });
  const formulario = h("form", { class: "fila formulario-escaneo", onsubmit: (evento) => {
    evento.preventDefault();
    const texto = entrada.value.trim();
    entrada.value = "";
    if (texto) alLeer(texto);
  } }, h("div", { class: "crecer campo-escaneo" }, icono("escaner"), entrada));
  const seccion = h("section", { class: "escaneo lector", "aria-label": etiqueta },
    h("div", { class: "escaneo__cabeza" }, h("span", { class: "rotulo" }, etiqueta),
      h("span", { class: "escaneo__estado escaneo__estado--listo" }, "Listo para leer"),
      h("span", { class: "escaneo__estado escaneo__estado--sin-foco" }, "Tocá el campo para leer")),
    formulario, ayuda && h("p", { class: "lector__ayuda" }, ayuda));
  return { seccion, entrada };
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
      h("td", { class: "tabla__numero" }, cantidadMovimiento(m)),
      h("td", {}, quien(m.hechoPor)))))));
}

// Lo escaneado en el inventario: la etiqueta de una caja abre la caja; un código o texto busca el producto.
async function leerEnInventario(texto, proposito = null) {
  if (esCodigoCaja(texto) && proposito !== "recibir") return vistaCaja(texto.toUpperCase());
  let resultados;
  try { resultados = (await api.buscarProductos(texto)).data; } catch (error) { return mostrarError(error, () => vistaInventario()); }
  const exactos = resultados.filter((p) => p.itemCode === texto || p.codigos.includes(texto));
  if (exactos.length === 1) return proposito === "recibir" ? vistaRecibir(exactos[0].itemCode) : vistaProducto(exactos[0].itemCode);
  return vistaBuscar({ texto, resultados, proposito });
}

async function vistaInventario() {
  mostrarInventario(cargando("Cargando inventario…"));
  let r;
  try { r = (await api.inventario()).data; } catch (error) { return mostrarError(error, () => vistaInventario()); }
  const p = r.pendientes;
  estado.pendientesInventario = p.porUbicar + p.porDescontar;
  const sinAlmacenes = r.almacenes.length === 0;
  const lector = campoLector({ placeholder: "Escaneá la etiqueta de una caja o el código de un producto", alLeer: (t) => leerEnInventario(t) });
  const accion = (nombreIcono, titulo, texto, onclick, deshabilitado = false) => h("button", { class: "accion-inventario", type: "button", onclick,
    disabled: deshabilitado }, icono(nombreIcono), h("strong", {}, titulo), h("span", {}, texto));
  const pendiente = (nombreIcono, titulo, n, texto, onclick, tipo = "alerta") => h("button", {
    class: `pendiente${n > 0 ? ` pendiente--${tipo}` : ""}`, type: "button", onclick },
  h("span", { class: "pendiente__cabeza" }, icono(nombreIcono), titulo), h("span", { class: "pendiente__n" }, numero(n)),
  h("span", { class: "pendiente__texto" }, texto));
  const cifra = (n, texto) => h("div", { class: "cifra" }, h("strong", {}, numero(n)), h("span", {}, texto));
  const vencen = r.porVencer.vencidos + r.porVencer.proximos;
  mostrarInventario(
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, "Inventario"),
      h("p", { class: "encabezado__sub" }, "Escaneá una caja o un producto, o elegí qué querés hacer."))),
    sinAlmacenes && aviso("alerta", "Falta elegir los almacenes de SAP de esta bodega. Hasta entonces el inventario no se compara con SAP y no se puede recibir mercadería.", {},
      esSupervisor() ? boton("boton--principal", "bodega", "Elegir almacenes", { onclick: () => vistaSupervisor("almacenes") })
        : h("strong", {}, "Avisá al supervisor.")),
    lector.seccion,
    h("div", { class: "acciones-inventario" },
      accion("caja", "Recibir mercadería", "Llegaron cajas o unidades: se registran con su lote y se imprime la etiqueta de cada caja.",
        () => vistaBuscar({ proposito: "recibir" }), sinAlmacenes),
      accion("mover", "Reponer", "Sacás unidades de una caja de la bodega grande y las pasás a la pequeña.", () => vistaReponer()),
      accion("buscar", "Consultar", "Cuánto hay de un producto en cada bodega, por lote y por caja.", () => vistaBuscar({}))),
    !sinAlmacenes && h("div", { class: "pendientes" },
      pendiente("caja", "Por ubicar", p.porUbicar, "productos que SAP registró y falta ubicar", () => vistaPendientes("ubicar")),
      pendiente("restar", "Por descontar", p.porDescontar, "productos que SAP descontó: falta elegir el lote", () => vistaPendientes("descontar")),
      pendiente("calendario", "Por vencer", vencen, textoPorVencer(r.porVencer),
        () => vistaPorVencer(), r.porVencer.vencidos ? "error" : "alerta"),
      pendiente("contar", "Sin contar", p.conteoInicial, "productos que SAP tiene y todavía no se contaron", () => vistaPendientes("inicial"), "gris")),
    p.actualizando > 0 && h("p", { class: "suave nota" }, icono("info"),
      `${numero(p.actualizando)} ${p.actualizando === 1 ? "producto tuvo" : "productos tuvieron"} cambios recientes en SAP: se revisan cuando termine de llegar todo (unos 15 minutos).`),
    h("div", { class: "bodegas" },
      h("section", { class: "tarjeta bodega" }, h("h2", {}, icono("caja"), "Bodega grande"),
        h("div", { class: "cifras" }, cifra(r.grande.cajas, "cajas"), cifra(r.grande.abiertas, "abiertas"), cifra(r.grande.productos, "productos"),
          cifra(r.grande.lotes, "lotes"), cifra(r.grande.unidades, "unidades"))),
      h("section", { class: "tarjeta bodega" }, h("h2", {}, icono("capas"), "Bodega pequeña"),
        h("div", { class: "cifras" }, cifra(r.pequena.unidades, "unidades"), cifra(r.pequena.productos, "productos"),
          r.pequena.negativos > 0 && cifra(r.pequena.negativos, "con faltante")))),
    h("div", { class: "fila fila--entre titulo-seccion" }, h("h2", {}, "Últimos movimientos"),
      boton("", "lista", "Ver todos", { onclick: () => vistaMovimientos() })),
    tablaMovimientos(r.movimientos));
  lector.entrada.focus();
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

async function vistaProducto(itemCode, mensaje = null) {
  mostrarInventario(cargando("Cargando producto…"));
  let p;
  try { p = (await api.producto(itemCode)).data; } catch (error) { return mostrarError(error, () => vistaProducto(itemCode)); }
  const e = p.estado;
  const info = e ? ESTADOS[e.estado] : null;
  const supervisor = esSupervisor();
  const datoCifra = (titulo, valor) => h("div", {}, h("dt", {}, titulo), h("dd", { class: "datos__cifra" }, valor));
  const acciones = [
    e?.estado === "por_ubicar" && boton("boton--principal", "caja", "Ubicar lo que llegó", { onclick: () => vistaRecibir(itemCode) }),
    e?.estado === "conteo_inicial" && boton("boton--principal", "contar", "Contar este producto", { onclick: () => vistaRecibir(itemCode) }),
    e?.estado === "por_descontar" && boton("boton--principal", "restar", "Elegir de qué lote salió", { onclick: () => vistaDescontar(itemCode) }),
    e && !["por_ubicar", "conteo_inicial"].includes(e.estado) && boton("", "caja", "Recibir mercadería", { onclick: () => vistaRecibir(itemCode) }),
    supervisor && p.enInventario && boton("", "contar", "Contar la pequeña", { onclick: () => contarPequena(p) }),
  ].filter(Boolean);

  const lotes = p.lotes.length === 0 ? h("p", { class: "suave" }, "No hay cajas de este producto en la bodega grande.")
    : h("div", { class: "tabla-envoltura" }, h("table", { class: "tabla" },
      h("thead", {}, h("tr", {}, ["Lote", "Vence", "Cajas", "Unidades"].map((t) => h("th", { scope: "col", class: t === "Unidades" ? "tabla__numero" : null }, t)))),
      h("tbody", {}, p.lotes.map((l) => {
        const dias = diasParaVencer(l.vencimiento);
        return h("tr", {},
          h("th", { scope: "row", class: "codigo" }, l.lote ?? "Sin lote"),
          h("td", {}, textoVencimiento(l.vencimiento), dias !== null && dias < 0 && h("span", {}, " ", insignia("error", "alerta", "Vencido"))),
          h("td", {}, h("div", {}, [l.cerradas && `${numero(l.cerradas)} cerradas`, l.abiertas && `${numero(l.abiertas)} abiertas`].filter(Boolean).join(" · ")),
            h("div", { class: "cajas-lote" }, l.cajas.map((c) => h("button", { class: `chip-caja${c.abierta ? " chip-caja--abierta" : ""}`, type: "button",
              onclick: () => vistaCaja(c.codigo), title: `Abrir ${c.codigo}` }, c.codigo, h("span", {}, `${numero(c.unidades)}/${numero(c.unidadesIniciales)}`))))),
          h("td", { class: "tabla__numero" }, h("strong", {}, numero(l.unidades))));
      }))));

  const ORIGEN = { sap: "SAP", ficha: "Ficha del artículo", app: "Registrado en la app" };
  mostrarInventario(volverInventario(),
    h("div", { class: "encabezado" }, h("div", {}, h("span", { class: "rotulo" }, "Producto"), h("h1", {}, p.itemName),
      h("p", { class: "encabezado__sub" }, h("span", { class: "codigo" }, p.itemCode)))),
    mensaje && aviso(mensaje.tipo, mensaje.texto, { role: "status" }),
    h("section", { class: `tarjeta estado-producto${info ? ` estado-producto--${info.tipo}` : ""}`, "aria-label": "Comparación con SAP" },
      h("div", { class: "fila fila--entre" },
        h("div", {}, h("span", { class: "rotulo" }, "Frente a SAP"), info && insignia(info.tipo, info.tipo === "ok" ? "completa" : info.tipo === "gris" ? null : "alerta", info.texto)),
        h("div", { class: "fila-admin__acciones" }, acciones)),
      h("p", { class: "estado-producto__texto" }, textoEstado(e)),
      e && h("dl", { class: "datos" },
        datoCifra("En SAP", numero(e.enSap)), datoCifra("Bodega grande", numero(e.grande)), datoCifra("Bodega pequeña", numero(e.pequena)),
        e.sinEntrega > 0 && datoCifra("Preparado sin entregar", numero(e.sinEntrega)),
        e.diferencia !== 0 && datoCifra(e.diferencia > 0 ? "Por ubicar" : "Por descontar", numero(Math.abs(e.diferencia))))),
    h("section", { class: "bloque" }, h("h2", {}, icono("caja"), "Bodega grande, por lote"), lotes),
    h("section", { class: "bloque" }, h("h2", {}, icono("capas"), "Bodega pequeña"),
      h("p", { class: "cifra-grande" }, h("strong", {}, numero(p.pequena)), " ", Math.abs(p.pequena) === 1 ? "unidad" : "unidades"),
      p.pequena < 0 && aviso("alerta", "Salieron más unidades de las que se registraron en la pequeña: falta registrar una reposición o contar la pequeña.")),
    h("section", { class: "bloque" }, h("div", { class: "fila fila--entre" }, h("h2", {}, icono("escaner"), "Códigos de barras"),
      supervisor && boton("", "mas", "Registrar un código", { onclick: async () => {
        const registrado = await registrarCodigo({ producto: p });
        if (registrado) vistaProducto(itemCode, { tipo: "ok", texto: `${registrado.codigo} quedó registrado y confirmado como unidad.` });
      } })),
    p.codigos.length === 0 ? aviso("alerta", "Este producto no tiene código de barras: no se puede escanear en pedidos. El supervisor lo puede registrar.")
      : h("ul", { class: "codigos" }, p.codigos.map((c) => h("li", {}, h("span", { class: "codigo" }, c.codigo), h("span", { class: "suave" }, ORIGEN[c.origen] ?? c.origen),
        c.confirmado ? insignia("ok", "completa", "Confirmado") : insignia("alerta", "alerta", "Sin confirmar"))))),
    p.documentos.length > 0 && h("section", { class: "bloque" }, h("h2", {}, icono("lista"), "Documentos recientes de SAP"),
      h("ul", { class: "documentos" }, p.documentos.map((d) => h("li", {}, h("strong", {}, textoDocumento(d)),
        h("span", {}, `${fecha(d.docDate)} · ${numero(d.cantidad)} u.`), d.comentarios && h("span", { class: "suave" }, d.comentarios))))),
    h("section", { class: "bloque" }, h("h2", {}, icono("actualizar"), "Movimientos"), tablaMovimientos(p.movimientos, { conProducto: false })));
}

async function contarPequena(p) {
  const datos = await pedirDatos({ titulo: "Contar la bodega pequeña", aceptar: "Guardar conteo",
    texto: `${p.itemName}: el sistema tiene ${unidadesTexto(p.pequena)} en la pequeña. Escribí cuántas contaste.`,
    campos: [{ nombre: "unidades", etiqueta: "Unidades contadas", inputmode: "numeric", maxlength: 7 }],
    validar: (d) => (/^\d+$/.test(d.unidades) ? null : "Escribí un número entero, sin puntos ni comas.") });
  if (!datos) return;
  try {
    const { data } = await api.contarPequena(p.itemCode, Number(datos.unidades));
    vistaProducto(p.itemCode, { tipo: "ok", texto: data.cambio === 0 ? "El conteo coincide con el sistema." : `La pequeña quedó en ${unidadesTexto(data.pequena)} (${data.cambio > 0 ? "+" : ""}${numero(data.cambio)}).` });
  } catch (error) { mostrarError(error, () => vistaProducto(p.itemCode)); }
}

function vistaReponer() {
  const lector = campoLector({ etiqueta: "Caja", placeholder: "Escaneá la etiqueta de la caja que vas a abrir",
    ayuda: "Si la caja no tiene etiqueta, buscá el producto y elegí la caja en su lista.", alLeer: (t) => leerEnInventario(t) });
  mostrarInventario(volverInventario(),
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, "Reponer"),
      h("p", { class: "encabezado__sub" }, "De una caja de la bodega grande a la bodega pequeña."))),
    lector.seccion);
  lector.entrada.focus();
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
  const pasar = boton("boton--principal boton--grande", "mover", "Pasar a la pequeña", { type: "submit", disabled: vacia });
  async function reponer(evento) {
    evento.preventDefault();
    const n = Number(cantidadCampo.value);
    if (!enteroPositivo(n) || n > c.unidades) {
      textoAviso(problema, `Escribí cuántas unidades sacaste: entre 1 y ${numero(c.unidades)}.`); problema.hidden = false; return;
    }
    pasar.disabled = true; problema.hidden = true;
    try {
      const { data } = await api.reponer(c.codigo, n);
      vistaCaja(c.codigo, { tipo: "ok", texto: `Pasaron ${unidadesTexto(n)} a la bodega pequeña. La caja quedó con ${numero(data.caja.unidades)} y la pequeña tiene ${numero(data.pequena)}.` });
    } catch (error) {
      if (error.status === 401) return mostrarError(error);
      textoAviso(problema, error.mensaje); problema.hidden = false; pasar.disabled = false;
    }
  }
  async function corregir() {
    const datos = await pedirDatos({ titulo: `Corregir la caja ${c.codigo}`, aceptar: "Guardar",
      texto: `El sistema tiene ${unidadesTexto(c.unidades)}. Escribí cuántas tiene de verdad. La diferencia queda como diferencia con SAP.`,
      campos: [{ nombre: "unidades", etiqueta: "Unidades en la caja", inputmode: "numeric", maxlength: 7 }],
      validar: (d) => (/^\d+$/.test(d.unidades) ? null : "Escribí un número entero, sin puntos ni comas.") });
    if (!datos) return;
    try {
      await api.corregirCaja(c.id, Number(datos.unidades));
      vistaCaja(c.codigo, { tipo: "ok", texto: `La caja quedó con ${unidadesTexto(Number(datos.unidades))}.` });
    } catch (error) { mostrarError(error, () => vistaCaja(c.codigo)); }
  }
  const antes = c.usarAntes;
  mostrarInventario(volverA("Reponer", () => vistaReponer()),
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
          h("div", {}, h("dt", {}, "En la pequeña"), h("dd", {}, unidadesTexto(c.pequena)))),
        vacia ? aviso("ok", "La caja está vacía.")
          : h("form", { class: "formulario-reponer", onsubmit: reponer },
            h("label", { class: "campo-etiqueta", for: "reponer-unidades" }, h("span", {}, "¿Cuántas unidades pasás a la pequeña?"), cantidadCampo),
            problema, pasar),
        h("div", { class: "fila" },
          boton("", "siguiente", "Ver el producto", { onclick: () => vistaProducto(c.itemCode) }),
          esSupervisor() && boton("", "contar", "Corregir unidades", { onclick: corregir })))));
  if (!vacia) cantidadCampo.select();
}

// Recepción: cajas iguales a la bodega grande (cada una con su etiqueta) o unidades sueltas.
async function vistaRecibir(itemCode) {
  mostrarInventario(cargando("Cargando producto…"));
  let p;
  try { p = (await api.producto(itemCode)).data; } catch (error) { return mostrarError(error, () => vistaRecibir(itemCode)); }
  const e = p.estado;
  if (!e) return vistaInventario();
  const porUbicar = Math.max(0, e.diferencia);
  const inicial = e.estado === "conteo_inicial";
  let modo = "cajas";
  const campo = (id, etiqueta, entrada, ayuda = null) => h("label", { class: "campo-etiqueta", for: id }, h("span", {}, etiqueta), entrada,
    ayuda && h("small", { class: "suave" }, ayuda));
  const numeroCampo = (id, valor = "") => h("input", { id, class: "campo campo--numero", type: "number", min: "1", inputmode: "numeric", value: valor });
  const cajas = numeroCampo("rec-cajas", "1");
  const porCaja = numeroCampo("rec-por-caja", p.sugerencia?.unidadesPorCaja ? String(p.sugerencia.unidadesPorCaja) : "");
  const sueltas = numeroCampo("rec-unidades", porUbicar ? String(porUbicar) : "");
  const lote = h("input", { id: "rec-lote", class: "campo codigo", maxlength: "60", autocomplete: "off", spellcheck: "false" });
  const vence = h("input", { id: "rec-vence", class: "campo", type: "month" });
  const aPequena = h("input", { id: "rec-pequena", type: "radio", name: "destino", value: "pequena", checked: true });
  const aGrande = h("input", { id: "rec-grande", type: "radio", name: "destino", value: "grande" });
  const resumen = h("div", { class: "resumen-recepcion", "aria-live": "polite" });
  const problema = aviso("error", "", { role: "alert", hidden: true });
  const guardar = boton("boton--principal boton--grande", "impresora", "Guardar", { type: "submit" });
  const botonModo = (id, nombreIcono, texto) => h("button", { class: "segmento", type: "button", "aria-pressed": String(id === modo),
    onclick: () => { modo = id; pintar(); (id === "cajas" ? cajas : sueltas).focus(); } }, icono(nombreIcono), texto);
  const modos = h("div", { class: "segmentos", role: "group", "aria-label": "¿Cómo vino?" });
  const grupoCajas = h("div", { class: "rejilla-campos" }, campo("rec-cajas", "Cantidad de cajas", cajas),
    campo("rec-por-caja", "Unidades por caja", porCaja, p.sugerencia ? `La última vez vino en cajas de ${numero(p.sugerencia.unidadesPorCaja)}.` : null));
  const grupoSuelto = h("div", {}, campo("rec-unidades", "Unidades", sueltas),
    h("fieldset", { class: "destino" }, h("legend", {}, "¿Dónde se ponen?"),
      h("label", { class: "opcion", for: "rec-pequena" }, aPequena, "En la bodega pequeña"),
      h("label", { class: "opcion", for: "rec-grande" }, aGrande, "En la bodega grande, como un bulto con etiqueta")));

  function leer() {
    return { modo, cajas: Number(cajas.value), unidadesPorCaja: Number(porCaja.value), unidades: Number(sueltas.value),
      destino: aPequena.checked ? "pequena" : "grande", lote: lote.value.trim() || null, vencimiento: vence.value ? finDeMes(vence.value) : null };
  }
  function pintar() {
    modos.replaceChildren(botonModo("cajas", "caja", "En cajas"), botonModo("suelto", "capas", "Suelto"));
    grupoCajas.hidden = modo !== "cajas"; grupoSuelto.hidden = modo !== "suelto";
    const d = leer();
    const r = resumenRecepcion(d);
    const etiquetas = modo === "cajas" ? (enteroPositivo(d.cajas) ? d.cajas : 0) : d.destino === "grande" ? 1 : 0;
    guardar.replaceChildren(icono(etiquetas ? "impresora" : "completa"),
      etiquetas ? `Guardar e imprimir ${numero(etiquetas)} ${etiquetas === 1 ? "etiqueta" : "etiquetas"}` : "Guardar");
    if (!r.total) return resumen.replaceChildren();
    const base = inicial ? `SAP tiene ${numero(porUbicar)} sin contar.` : `SAP tiene ${numero(porUbicar)} por ubicar.`;
    if (porUbicar === 0) return resumen.replaceChildren(aviso("alerta", `${r.texto} SAP todavía no registró mercadería por ubicar de este producto: si llegó antes que SAP, se puede recibir igual.`));
    if (r.total > porUbicar) return resumen.replaceChildren(aviso("alerta", `${r.texto} Son ${numero(r.total - porUbicar)} más de lo que SAP tiene ${inicial ? "sin contar" : "por ubicar"} (${numero(porUbicar)}).`));
    resumen.replaceChildren(aviso(r.total === porUbicar ? "ok" : "info", r.total === porUbicar ? `${r.texto} ${inicial ? "Queda todo contado." : "Queda todo ubicado."}`
      : `${r.texto} ${base} Quedan ${numero(porUbicar - r.total)} ${inicial ? "sin contar" : "por ubicar"}.`));
  }

  async function enviar(evento, adelantar = false) {
    evento?.preventDefault();
    const d = leer();
    const malo = modo === "cajas"
      ? (!enteroPositivo(d.cajas) || d.cajas > 200 ? "Escribí la cantidad de cajas (de 1 a 200)." : !enteroPositivo(d.unidadesPorCaja) ? "Escribí cuántas unidades trae cada caja." : null)
      : (!enteroPositivo(d.unidades) ? "Escribí cuántas unidades llegaron." : null);
    if (malo) { textoAviso(problema, malo); problema.hidden = false; return; }
    if (vence.value && !d.vencimiento) { textoAviso(problema, "El vencimiento no es válido."); problema.hidden = false; return; }
    problema.hidden = true; guardar.disabled = true;
    const cuerpo = modo === "cajas"
      ? { itemCode, modo, cajas: d.cajas, unidadesPorCaja: d.unidadesPorCaja, lote: d.lote, vencimiento: d.vencimiento, adelantar }
      : { itemCode, modo, unidades: d.unidades, destino: d.destino, lote: d.lote, vencimiento: d.vencimiento, adelantar };
    try {
      const { data } = await api.recibir(cuerpo);
      if (data.cajas.length) return vistaEtiquetas(data.cajas, p);
      vistaProducto(itemCode, { tipo: "ok", texto: `Se recibieron ${unidadesTexto(data.unidades)} sueltas en la bodega pequeña.` });
    } catch (error) {
      guardar.disabled = false;
      if (error.status === 401) return mostrarError(error);
      if (error.codigo === "EXCEDE_POR_UBICAR" && !adelantar) {
        const seguir = await confirmar({ titulo: "¿Llegó antes que SAP?", aceptar: "Recibir igual",
          texto: [error.mensaje, "Se recibe igual y queda anotado como recibido antes que SAP. Cuando SAP lo registre, la diferencia se cierra sola."] });
        if (seguir) return enviar(null, true);
        return;
      }
      textoAviso(problema, error.mensaje); problema.hidden = false;
    }
  }

  const entradas = p.documentos.filter((d) => d.tipo.startsWith("entrada") || d.tipo === "devolucionCliente");
  const encabezadoAviso = e.estado === "por_ubicar"
    ? aviso("alerta", `SAP registró ${unidadesTexto(porUbicar)} de ${p.itemName} que todavía no se ubicaron${entradas[0] ? ` (${textoDocumento(entradas[0])}, ${fecha(entradas[0].docDate)})` : ""}.`)
    : inicial ? aviso("info", `Conteo inicial: SAP tiene ${unidadesTexto(porUbicar)}. Registrá las cajas con su lote y lo que esté suelto; lo que falte cargar queda "sin contar".`)
      : null;
  mostrarInventario(volverA(p.itemName, () => vistaProducto(itemCode)),
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, inicial ? "Contar" : e.estado === "por_ubicar" ? "Ubicar lo que llegó" : "Recibir mercadería"),
      h("p", { class: "encabezado__sub" }, p.itemName, " · ", h("span", { class: "codigo" }, p.itemCode)))),
    encabezadoAviso,
    h("form", { class: "tarjeta formulario-recepcion", onsubmit: (evento) => enviar(evento), oninput: pintar, onchange: pintar },
      h("h2", {}, "¿Cómo vino?"), modos, grupoCajas, grupoSuelto,
      h("div", { class: "rejilla-campos" }, campo("rec-lote", "Lote", lote, "Como figura en la caja. Si no tiene, dejalo vacío."),
        campo("rec-vence", "Vencimiento", vence, "Mes y año, si la caja lo trae.")),
      resumen, problema,
      h("div", { class: "fila" }, guardar, boton("", null, "Cancelar", { onclick: () => vistaProducto(itemCode) }))));
  pintar();
  (modo === "cajas" ? cajas : sueltas).focus();
}

function vistaEtiquetas(cajas, producto) {
  const rango = cajas.length === 1 ? cajas[0].codigo : `${cajas[0].codigo} a ${cajas.at(-1).codigo}`;
  const resultado = h("div", { "aria-live": "polite" });
  const texto = `Imprimir ${numero(cajas.length)} ${cajas.length === 1 ? "etiqueta" : "etiquetas"}`;
  const imprimir = boton("boton--principal boton--grande", "impresora", texto, { onclick: async () => {
    imprimir.disabled = true;
    const r = await imprimirEtiquetas(cajas, producto);
    imprimir.disabled = false;
    resultado.replaceChildren(r.ok ? aviso("ok", "Se mandaron a la impresora.") : r.motivo === "cancelled" ? ""
      : aviso("error", "No se pudo imprimir. Revisá que la impresora esté encendida y probá de nuevo.", { role: "alert" }));
  } });
  mostrarInventario(
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, "Etiquetas de las cajas"), h("p", { class: "encabezado__sub" }, producto.itemName))),
    aviso("ok", `Se registraron ${numero(cajas.length)} ${cajas.length === 1 ? "caja" : "cajas"} (${rango}) en la bodega grande. Pegá cada etiqueta en su caja.`),
    h("div", { class: "fila" }, imprimir,
      boton("", "siguiente", "Ver el producto", { onclick: () => vistaProducto(producto.itemCode) }),
      boton("", "bodega", "Volver al inventario", { onclick: () => vistaInventario() })),
    resultado,
    h("div", { class: "etiquetas" }, cajas.map((c, i) => etiquetaCaja(c, producto, { numero: i + 1, de: cajas.length }))));
  imprimir.focus();
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
async function imprimirEtiquetas(cajas, producto) {
  let zona = document.getElementById("impresion");
  if (!zona) { zona = h("div", { id: "impresion", class: "impresion", "aria-hidden": "true" }); document.body.append(zona); }
  zona.replaceChildren(...cajas.map((c, i) => etiquetaCaja(c, producto, cajas.length > 1 ? { numero: i + 1, de: cajas.length } : null)));
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
  mostrarInventario(cargando("Cargando pendientes…"));
  let d;
  try { d = (await api.pendientes()).data; } catch (error) {
    if (error.codigo === "ALMACENES_SIN_ELEGIR") return vistaInventario();
    return mostrarError(error, () => vistaPendientes(pestana));
  }
  estado.pendientesInventario = d.porUbicar.length + d.porDescontar.length;
  const pestanas = [["ubicar", "Por ubicar", d.porUbicar.length], ["descontar", "Por descontar", d.porDescontar.length],
    ["inicial", "Sin contar", d.conteoInicial.productos], ["historial", "Descuentos hechos", 0]];
  const nav = h("nav", { class: "pestanas", "aria-label": "Pendientes del inventario" }, pestanas.map(([id, texto, n]) =>
    h("button", { class: "pestana", type: "button", "aria-current": id === pestana ? "page" : null, onclick: () => vistaPendientes(id) },
      texto, n > 0 && h("span", { class: "contador contador--alerta", "aria-label": `${n} pendientes` }, numero(n)))));
  const contenido = h("div", {});
  const documentos = (v) => (v.documentos?.length ? h("span", {}, v.documentos.map((x) => `${textoDocumento(x)} (${fecha(x.docDate)})`).join(" · ")) : null);
  mostrarInventario(volverInventario(), h("div", { class: "encabezado" }, h("h1", {}, "Pendientes del inventario")), nav,
    d.actualizando.length > 0 && pestana !== "historial" && h("p", { class: "suave nota" }, icono("info"),
      `${numero(d.actualizando.length)} ${d.actualizando.length === 1 ? "producto tuvo" : "productos tuvieron"} cambios recientes en SAP: aparecen acá cuando termine de llegar todo (unos 15 minutos).`),
    contenido);
  if (pestana === "ubicar") {
    contenido.replaceChildren(
      d.porUbicar.length ? h("ul", { class: "filas" }, d.porUbicar.map((v) => filaAdmin({ nombre: v.itemName,
        detalle: [h("span", { class: "codigo" }, v.itemCode), documentos(v)], dato: dato("Por ubicar", unidadesTexto(v.diferencia)),
        acciones: [boton("boton--principal", "caja", "Ubicar", { onclick: () => vistaRecibir(v.itemCode) }),
          boton("", "siguiente", "Ver", { onclick: () => vistaProducto(v.itemCode) })] })))
        : aviso("ok", "No hay mercadería por ubicar."),
      d.faltaEnSap.length > 0 && h("section", { class: "bloque" }, h("h2", {}, "Recibido antes que SAP"),
        h("p", { class: "suave" }, "Se recibió en la bodega y SAP todavía no lo registró. Se cierra solo cuando llegue la entrada de SAP."),
        h("ul", { class: "filas" }, d.faltaEnSap.map((v) => filaAdmin({ nombre: v.itemName, detalle: [h("span", { class: "codigo" }, v.itemCode)],
          dato: dato("Falta en SAP", unidadesTexto(v.faltaEnSap)), acciones: [boton("", "siguiente", "Ver", { onclick: () => vistaProducto(v.itemCode) })] })))));
  } else if (pestana === "descontar") {
    contenido.replaceChildren(d.porDescontar.length
      ? h("ul", { class: "filas" }, d.porDescontar.map((v) => filaAdmin({ clase: "fila-admin--alerta", nombre: v.itemName,
        detalle: [h("span", { class: "codigo" }, v.itemCode), documentos(v)], dato: dato("SAP descontó", unidadesTexto(-v.diferencia)),
        acciones: [boton("boton--principal", "restar", "Elegir lote", { onclick: () => vistaDescontar(v.itemCode) })] })))
      : aviso("ok", "No hay nada por descontar."));
  } else if (pestana === "inicial") {
    await listaConteoInicial(contenido);
  } else {
    await listaDescuentos(contenido);
  }
}

async function listaConteoInicial(contenedor) {
  let pagina = 0, buscar = "";
  const lista = h("ul", { class: "filas" });
  const pie = h("div", { class: "fila fila--entre" });
  const buscador = h("input", { class: "buscador__campo", type: "search", placeholder: "Buscar por nombre o código", "aria-label": "Buscar producto sin contar" });
  async function cargar() {
    lista.replaceChildren(cargando("Cargando…"));
    try {
      const r = await api.conteoInicial({ buscar, pagina });
      lista.replaceChildren(...r.data.map((v) => filaAdmin({ nombre: v.itemName, detalle: [h("span", { class: "codigo" }, v.itemCode)],
        dato: dato("En SAP", unidadesTexto(v.enSap)), acciones: [boton("boton--principal", "contar", "Contar", { onclick: () => vistaRecibir(v.itemCode) })] })));
      if (!r.data.length) lista.replaceChildren(aviso("ok", buscar ? "Ningún producto sin contar coincide con la búsqueda." : "Todos los productos que SAP tiene ya se contaron."));
      const paginas = Math.max(1, Math.ceil(r.total / 50));
      pie.replaceChildren(h("span", { class: "suave" }, `${numero(r.total)} productos · página ${pagina + 1} de ${paginas}`),
        h("div", { class: "fila" },
          boton("", "volver", "Anterior", { disabled: pagina === 0, onclick: () => { pagina--; cargar(); } }),
          boton("", "siguiente", "Siguiente", { disabled: pagina + 1 >= paginas, onclick: () => { pagina++; cargar(); } })));
    } catch (error) { if (error.status === 401) return mostrarError(error); lista.replaceChildren(aviso("error", error.mensaje, { role: "alert" })); }
  }
  let espera = null;
  buscador.addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(() => { buscar = buscador.value.trim(); pagina = 0; cargar(); }, 350); });
  limpiezas.push(() => clearTimeout(espera));
  contenedor.replaceChildren(
    h("p", { class: "suave" }, "Productos que SAP tiene en los almacenes de esta bodega y todavía no se cargaron en el inventario. Al contarlos se registran sus cajas (con lote) y lo suelto."),
    h("label", { class: "buscador" }, icono("buscar"), buscador), lista, pie);
  await cargar();
}

async function listaDescuentos(contenedor) {
  const filas = [];
  let cursor = null;
  const lista = h("ul", { class: "filas" });
  const mas = boton("boton--ancho", null, "Cargar más", { hidden: true, onclick: () => cargar() });
  const fila = (d) => filaAdmin({ nombre: d.itemName ?? d.itemCode,
    detalle: [fechaHora(d.creadoEn), d.documentos ?? "Sin documento de SAP identificado", `Confirmó ${quien(d.hechoPor)}`],
    dato: dato("Se restó de", textoAsignacion(d.asignacion) || "—", unidadesTexto(d.unidades)),
    acciones: esSupervisor() ? [boton("", "actualizar", "Cambiar lote", { onclick: () => vistaDescontar(d.itemCode, { descuento: d }) })] : [],
    nota: d.corregidoEn ? `Lote cambiado por ${quien(d.corregidoPor)} el ${fechaHora(d.corregidoEn)}. Antes: ${d.anterior}.` : null });
  async function cargar() {
    try {
      const r = await api.descuentos(cursor);
      filas.push(...r.data); cursor = r.siguienteCursor;
      lista.replaceChildren(...filas.map(fila));
      if (!filas.length) lista.replaceChildren(h("p", { class: "suave vacio" }, "Todavía no se hizo ningún descuento."));
      mas.hidden = cursor === null;
    } catch (error) { if (error.status === 401) return mostrarError(error); lista.replaceChildren(aviso("error", error.mensaje, { role: "alert" })); }
  }
  contenedor.replaceChildren(h("p", { class: "suave" }, esSupervisor()
    ? "Lo que SAP descontó y de qué lotes se restó. Si se eligió mal, cambiá el lote: el total no cambia."
    : "Lo que SAP descontó y de qué lotes se restó. Solo el supervisor puede cambiar el lote."), lista, mas);
  await cargar();
}

// Elegir de qué lotes (o de la pequeña) salió lo que SAP descontó. Con "descuento", cambia el lote de uno ya hecho.
async function vistaDescontar(itemCode, { descuento = null } = {}) {
  mostrarInventario(cargando("Cargando producto…"));
  let p;
  try { p = (await api.producto(itemCode)).data; } catch (error) { return mostrarError(error, () => vistaDescontar(itemCode, { descuento })); }
  const volver = volverA(descuento ? "Descuentos hechos" : "Por descontar", () => vistaPendientes(descuento ? "historial" : "descontar"));
  const total = descuento ? descuento.unidades : Math.max(0, -(p.estado?.diferencia ?? 0));
  if (!descuento && p.estado?.estado !== "por_descontar") {
    const actualizando = p.estado?.estado === "actualizando";
    return mostrarInventario(volver, h("div", { class: "encabezado" }, h("h1", {}, p.itemName)),
      aviso(actualizando ? "alerta" : "ok", actualizando ? "SAP se está actualizando para este producto. Probá en unos minutos." : "Ya no hay nada por descontar de este producto."),
      boton("", "siguiente", "Ver el producto", { onclick: () => vistaProducto(itemCode) }));
  }
  const opciones = opcionesDescuento(p, descuento?.asignacion ?? []);
  const asignado = sugerirAsignacion(opciones, total);
  const resumen = h("div", { "aria-live": "polite" });
  const problema = aviso("error", "", { role: "alert", hidden: true });
  const confirmarBoton = boton("boton--principal boton--grande", descuento ? "actualizar" : "restar", descuento ? "Guardar el lote nuevo" : "Confirmar el descuento", { type: "submit" });
  const campos = new Map();
  const filas = opciones.map((o) => {
    const id = `asignar-${o.clave.replace(/[^a-z0-9]/gi, "_")}`;
    const entrada = h("input", { id, class: "campo campo--numero", type: "number", min: "0", max: String(o.unidades), inputmode: "numeric", value: String(asignado[o.clave] ?? 0) });
    campos.set(o.clave, entrada);
    const nombre = o.tipo === "pequena" ? "Bodega pequeña" : `Lote ${o.lote ?? "sin lote"}`;
    const detalle = o.tipo === "pequena" ? "Unidades sueltas"
      : [o.vencimiento && !o.vencido && `Vence ${textoVencimiento(o.vencimiento)}`, `${numero(o.cajas.length)} ${o.cajas.length === 1 ? "caja" : "cajas"} en la bodega grande`].filter(Boolean).join(" · ");
    return h("li", { class: `opcion-lote${o.vencido ? " opcion-lote--vencida" : ""}` },
      h("div", {}, h("div", { class: "opcion-lote__nombre" }, nombre, o.vencido && insignia("error", "alerta", `Venció ${textoVencimiento(o.vencimiento)}`)),
        h("div", { class: "suave" }, detalle)),
      h("div", { class: "opcion-lote__disponible" }, h("strong", {}, numero(o.unidades)), h("span", {}, "disponibles")),
      h("label", { class: "opcion-lote__campo", for: id }, h("span", {}, "Salieron"), entrada));
  });
  const leer = () => Object.fromEntries([...campos].map(([clave, entrada]) => [clave, entrada.value === "" ? 0 : Number(entrada.value)]));
  function pintar() {
    const r = armarAsignaciones(opciones, leer(), total);
    resumen.replaceChildren(r.problema ? aviso("alerta", r.problema) : aviso("ok", `${numero(total)} de ${numero(total)} asignadas: ${textoAsignacion(r.asignaciones)}.`));
    confirmarBoton.disabled = Boolean(r.problema);
  }
  async function enviar(evento) {
    evento.preventDefault();
    const r = armarAsignaciones(opciones, leer(), total);
    if (r.problema) return pintar();
    confirmarBoton.disabled = true; problema.hidden = true;
    try {
      if (descuento) {
        await api.cambiarLote(descuento.id, r.asignaciones);
        return vistaPendientes("historial");
      }
      const { data } = await api.descontar(itemCode, total, r.asignaciones);
      vistaRetirar(p, data.retirar, textoAsignacion(r.asignaciones));
    } catch (error) {
      if (error.status === 401) return mostrarError(error);
      textoAviso(problema, error.codigo === "CANTIDAD_CAMBIO" ? `${error.mensaje} Volvé a abrir el producto para ver la cantidad actual.` : error.mensaje);
      problema.hidden = false; confirmarBoton.disabled = false;
    }
  }
  const salidas = p.documentos.filter((d) => d.tipo === "salidaInventario" || d.tipo === "devolucionProveedor");
  const textoSap = descuento
    ? `Cambiar el lote del descuento de ${unidadesTexto(total)} (${descuento.documentos ?? "sin documento identificado"}). Hoy está así: ${textoAsignacion(descuento.asignacion)}.`
    : `SAP descontó ${unidadesTexto(total)} de ${p.itemName} y la bodega todavía no lo marcó${salidas.length ? ` (${salidas.map((d) => `${textoDocumento(d)}, ${fecha(d.docDate)}${d.comentarios ? `: "${d.comentarios}"` : ""}`).join(" · ")})` : ""}.`;
  mostrarInventario(volver,
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, descuento ? "Cambiar lote" : "Por descontar"),
      h("p", { class: "encabezado__sub" }, p.itemName, " · ", h("span", { class: "codigo" }, p.itemCode)))),
    aviso("alerta", textoSap),
    h("form", { class: "tarjeta", onsubmit: enviar, oninput: pintar },
      h("h2", {}, "¿De dónde salió?"),
      h("p", { class: "suave" }, "SAP no maneja lotes: elegí de cuáles salió. La lista va del que vence primero al último. Si salió de varios lugares, repartí hasta llegar al total."),
      h("ul", { class: "opciones-lote" }, filas), resumen, problema,
      h("div", { class: "fila" }, confirmarBoton, boton("", null, "Cancelar", { onclick: () => vistaPendientes(descuento ? "historial" : "descontar") }))));
  pintar();
}

function vistaRetirar(p, retirar, asignacion) {
  mostrarInventario(
    h("div", { class: "encabezado" }, h("div", {}, h("h1", {}, "Descuento registrado"), h("p", { class: "encabezado__sub" }, p.itemName))),
    aviso("ok", `Se descontó: ${asignacion}.`),
    retirar.length > 0 && h("section", { class: "tarjeta" }, h("h2", {}, icono("caja"), "Sacá estas cajas del estante"),
      h("p", { class: "suave" }, "Son las unidades que SAP ya descontó. Si una caja queda vacía, retirala."),
      h("ul", { class: "filas" }, retirar.map((r) => filaAdmin({ nombre: r.codigo, detalle: [r.lote ? `Lote ${r.lote}` : "Sin lote"],
        dato: dato("Unidades", numero(r.unidades)), acciones: [boton("", "siguiente", "Ver caja", { onclick: () => vistaCaja(r.codigo) })] })))),
    h("div", { class: "fila" },
      boton("boton--principal", "restar", "Volver a por descontar", { onclick: () => vistaPendientes("descontar") }),
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
      h("p", { class: "encabezado__sub" }, "Lotes de la bodega grande, del que vence primero al último. Lo vencido aparece siempre."))),
    filtros,
    vencidos > 0 && aviso("error", `${numero(vencidos)} ${vencidos === 1 ? "lote está vencido" : "lotes están vencidos"}. Para sacarlos, primero se registra la salida en SAP; después aparecen en "Por descontar".`),
    lotes.length === 0 ? aviso("ok", `Ningún lote vence en los próximos ${dias} días.`)
      : h("div", { class: "tabla-envoltura" }, h("table", { class: "tabla" },
        h("thead", {}, h("tr", {}, ["Producto", "Lote", "Vence", "Cajas", "En la grande", "En la pequeña"].map((t, i) => h("th", { scope: "col", class: i >= 3 ? "tabla__numero" : null }, t)))),
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
// Panel del supervisor: almacenes de esta bodega y registro de códigos
// ---------------------------------------------------------------------------

async function panelAlmacenes(panel) {
  let datos;
  try { datos = (await api.almacenes()).data; } catch (error) { panel.contenido.replaceChildren(); return panel.fallo(error, () => vistaSupervisor("almacenes")); }
  const original = new Set(datos.almacenes.filter((a) => a.deEstaBodega).map((a) => a.warehouseCode));
  const marcados = new Set(original);
  let todos = false;
  const filtrar = h("input", { id: "almacenes-filtrar", type: "checkbox", checked: datos.pedidosSoloDeEstaBodega });
  const cuerpo = h("tbody");
  const guardar = boton("boton--principal", "completa", "Guardar", { disabled: true });
  const mostrarTodos = boton("", null, "", { onclick: () => { todos = !todos; pintar(); } });
  const conDatos = (a) => a.productos > 0 || a.lineasAbiertas > 0 || original.has(a.warehouseCode);
  const ocultos = datos.almacenes.filter((a) => !conDatos(a)).length;
  const cambiado = () => filtrar.checked !== datos.pedidosSoloDeEstaBodega || marcados.size !== original.size || [...marcados].some((c) => !original.has(c));
  function pintar() {
    const visibles = datos.almacenes.filter((a) => todos || conDatos(a) || marcados.has(a.warehouseCode));
    cuerpo.replaceChildren(...visibles.map((a) => {
      const id = `almacen-${a.warehouseCode.replace(/[^a-z0-9]/gi, "_")}`;
      const casilla = h("input", { id, type: "checkbox", checked: marcados.has(a.warehouseCode), onchange: (evento) => {
        if (evento.target.checked) marcados.add(a.warehouseCode); else marcados.delete(a.warehouseCode);
        guardar.disabled = !cambiado();
        evento.target.closest("tr").classList.toggle("fila--marcada", evento.target.checked);
      } });
      return h("tr", { class: marcados.has(a.warehouseCode) ? "fila--marcada" : null },
        h("td", { class: "tabla__casilla" }, casilla),
        h("th", { scope: "row" }, h("label", { for: id }, h("strong", {}, `${a.warehouseCode} · ${a.warehouseName}`)),
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
      await api.elegirAlmacenes([...marcados], filtrar.checked);
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
    h("p", { class: "suave" }, "Almacenes de SAP. Marcá los que son de esta bodega: el inventario compara solo contra lo que SAP tiene en ellos. La bodega grande y la pequeña están dentro de los marcados."),
    h("div", { class: "tabla-envoltura" }, h("table", { class: "tabla tabla--almacenes" },
      h("thead", {}, h("tr", {}, ["Esta bodega", "Almacén de SAP", "Productos con existencia", "Unidades en SAP", "Líneas de pedidos abiertos"]
        .map((t, i) => h("th", { scope: "col", class: i >= 2 ? "tabla__numero" : null }, t)))),
      cuerpo)),
    h("div", { class: "fila fila--entre" }, mostrarTodos),
    h("label", { class: "opcion tarjeta opcion--tarjeta", for: "almacenes-filtrar" }, filtrar, "En Pedidos, mostrar solo los pedidos que salen de los almacenes marcados"),
    h("div", { class: "fila" }, guardar),
    h("p", { class: "suave panel__nota" }, "Los nombres y cantidades salen de SAP (solo lectura). Cambiar la selección no mueve mercadería: solo cambia contra qué se compara el inventario."));
  pintar();
}

// Registrar un código de barras que SAP no tiene: se escanea el envase y se elige el producto. Resuelve lo
// registrado o null si se cancela.
function registrarCodigo({ producto = null } = {}) {
  return new Promise((resolver) => {
    let resuelto = false, elegido = producto, espera = null;
    const cerrar = (valor) => { resuelto = true; clearTimeout(espera); dialogo.close(); resolver(valor); };
    const error = aviso("error", "", { role: "alert", hidden: true });
    const codigo = h("input", { id: "registro-codigo", class: "campo codigo", autocomplete: "off", spellcheck: "false", maxlength: "64" });
    const buscar = h("input", { id: "registro-buscar", class: "campo", type: "search", autocomplete: "off", placeholder: "Nombre o código del artículo" });
    const resultados = h("ul", { class: "resultados-producto" });
    const elegidoTexto = h("p", { class: "registro__elegido" });
    const pintarElegido = () => elegidoTexto.replaceChildren(elegido ? [icono("completa"), h("strong", {}, elegido.itemName), " ", h("span", { class: "codigo" }, elegido.itemCode)] : "Todavía no elegiste el producto.");
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
    codigo.focus();
  });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

for (const lugar of document.querySelectorAll("[data-icono]")) lugar.replaceWith(icono(lugar.dataset.icono));
document.getElementById("btn-inicio").addEventListener("click", () => (api ? vistaPedidos() : vistaIngreso()));
document.getElementById("btn-menu").addEventListener("click", abrirMenu);
const conexion = document.getElementById("estado-conexion");
const pintarConexion = () => { conexion.hidden = navigator.onLine; };
window.addEventListener("online", pintarConexion);
window.addEventListener("offline", pintarConexion);
pintarConexion();
actualizarBarra();

if (!api) vistaIngreso();
else if (estado.sesion) vistaEscaneo();
else vistaPedidos();
