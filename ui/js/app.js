import { crearApi } from "./api.js";
import { crearColaLecturas } from "./lecturas.js";
import { icono } from "./iconos.js";
import { textosPreparado } from "./preparados.js";
import { NOMBRES_DATOS, estadoDatos, estadoOperador, puedeSerUnidad, quienConfirmo, textoCambio, textoRevision, textoSinEntrega, textoUnidad } from "./supervisor.js";

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
const ICONO_AVISO = { error: "rechazada", alerta: "alerta", ok: "aceptada" };
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
  return mostrar(h("div", { class: "tarjeta" },
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
  mostrar(cargando("Cargando pedidos abiertos…"));
  const pedidos = [];
  let cursor = null;
  try {
    const respuesta = await api.pedidos();
    pedidos.push(...respuesta.data); cursor = respuesta.siguienteCursor;
  } catch (error) { return mostrarError(error, vistaPedidos); }

  const buscador = h("input", { class: "buscador__campo", type: "search", placeholder: "Buscar por número o cliente", "aria-label": "Buscar pedido" });
  const lista = h("ul", { class: "pedidos" });
  const masBoton = boton("boton--ancho", null, "Cargar más pedidos");
  const vacio = h("p", { class: "suave vacio" });
  const contador = h("span", { class: "contador" });
  // Los pedidos ya preparados van aparte, al final: siguen abiertos en SAP hasta que se registra la entrega.
  const listaPreparados = h("ul", { class: "pedidos" });
  const contadorPreparados = h("span", { class: "contador" });
  const seccionPreparados = h("section", { class: "preparados", "aria-labelledby": "titulo-preparados" },
    h("div", { class: "separador" }, h("h2", { id: "titulo-preparados" }, "Preparados"), contadorPreparados,
      h("p", {}, "Salen de la lista cuando SAP cierra el pedido.")),
    listaPreparados);

  const tarjetaPendiente = (p) => h("li", {},
    h("button", { class: "pedido", type: "button", onclick: () => vistaPedido(p.docEntry) },
      h("div", { class: "pedido__cabeza" },
        h("div", { class: "pedido__numero" }, h("span", { class: "rotulo" }, "Pedido"), " ", String(p.docNum)),
        icono("siguiente", "icono pedido__flecha")),
      h("div", { class: "pedido__cuerpo" },
        h("div", { class: "pedido__cliente" }, p.cliente?.cardName ?? p.cardCode),
        h("div", { class: "pedido__meta" }, `Fecha ${fecha(p.docDate)} · Entrega ${fecha(p.docDueDate)}`),
        h("div", { class: "pedido__meta" }, `Datos de SAP ${hace(p.sincronizadoEn)}`))));
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
          h("div", { class: "pedido__meta" }, textos.unidades),
          textos.aviso && h("div", { class: "pedido__aviso" }, icono("alerta"), textos.aviso))));
  }

  function pintar() {
    const filtro = buscador.value.trim().toLowerCase();
    const visibles = pedidos.filter((p) => !filtro || String(p.docNum).includes(filtro) || (p.cliente?.cardName ?? "").toLowerCase().includes(filtro));
    const pendientes = visibles.filter((p) => !p.preparado);
    const preparados = visibles.filter((p) => p.preparado);
    lista.replaceChildren(...pendientes.map(tarjetaPendiente));
    listaPreparados.replaceChildren(...preparados.map(tarjetaPreparado));
    lista.hidden = pendientes.length === 0;
    seccionPreparados.hidden = preparados.length === 0;
    contadorPreparados.textContent = String(preparados.length);
    contadorPreparados.setAttribute("aria-label", `${preparados.length} pedidos preparados`);
    contador.textContent = `${pedidos.length}${cursor === null ? "" : "+"}`;
    contador.setAttribute("aria-label", `${contador.textContent} pedidos cargados`);
    vacio.textContent = !pedidos.length ? "No hay pedidos abiertos."
      : !visibles.length ? "Ningún pedido coincide con la búsqueda."
        : !pendientes.length && !filtro ? "Todos los pedidos abiertos ya están preparados." : "";
    vacio.hidden = !vacio.textContent;
    masBoton.hidden = cursor === null;
  }
  buscador.addEventListener("input", pintar);
  masBoton.addEventListener("click", async () => {
    masBoton.disabled = true;
    try {
      const respuesta = await api.pedidos(cursor);
      pedidos.push(...respuesta.data); cursor = respuesta.siguienteCursor;
      pintar();
    } catch (error) { if (error.status === 401) return mostrarError(error); }
    masBoton.disabled = false;
  });

  const abierta = estado.sesion && aviso("alerta", `Tenés una preparación abierta: pedido ${estado.sesion.docNum ?? estado.sesion.docEntry}.`, {},
    boton("boton--principal", "escaner", "Continuar", { onclick: () => vistaEscaneo() }));

  mostrarAmplio(
    h("div", { class: "encabezado" }, h("div", { class: "encabezado__titulo" }, h("h1", {}, "Pedidos abiertos"), contador),
      boton("", "actualizar", "Actualizar", { onclick: () => vistaPedidos() })),
    abierta, h("label", { class: "buscador" }, icono("buscar"), buscador), vacio, lista, seccionPreparados, masBoton);
  pintar();
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
  mostrarAmplio(boton("boton--volver", "volver", "Volver a pedidos", { onclick: () => vistaPedidos() }),
    h("div", { class: "encabezado" }, h("h1", {}, "Panel del supervisor")), nav, mensaje, contenido);
  await panel.refrescar();
  const secciones = { etiquetas: panelEtiquetas, operadores: panelOperadores, revisiones: panelRevisiones, sincronizacion: panelSincronizacion };
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

  panel.contenido.replaceChildren(cabecera, formulario, filtros, lista, vacio, mas);
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
          h("td", { class: "tabla__numero" }, e.entidad === "pedidos" ? `${numero(e.registros)} abiertos` : numero(e.registros)),
          h("td", {}, insignia(INSIGNIAS[s.tipo][0], INSIGNIAS[s.tipo][1], s.texto)));
      }))),
    h("p", { class: "suave panel__nota" }, `${datos.empresa ? `Sociedad de SAP: ${datos.empresa}. ` : ""}Aviso si los pedidos pasan más de 1 hora sin datos, y el resto más de 24 horas. Los límites se ajustan cuando se definan las frecuencias del puente.`));
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
