// Proceso principal de la app de escritorio: una sola ventana con la pantalla de bodega.
// La página no accede a Node, no abre otras ventanas y no navega fuera de sus propios archivos.
import { app, BrowserWindow, Menu, ipcMain, net, protocol, session } from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ORIGEN, cabeceras, resolverArchivo } from "./archivos.js";
import { crearPreferencias } from "./preferencias.js";
import { elegirServidor } from "./servidor.js";
import { crearIngreso, datosIngresoValidos, leerClaveIngreso } from "./ingreso.js";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI = path.join(RAIZ, "ui");

// Solo para pruebas: carpeta de datos separada, así no se mezcla con la del equipo.
if (!app.isPackaged && process.env.BODEGA_DATOS) app.setPath("userData", process.env.BODEGA_DATOS);

// Controles del sistema (mes y año del vencimiento, diálogo de impresión) en español.
app.commandLine.appendSwitch("lang", "es-419");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let ventana = null;
let preferencias = null;
let servidor = null;
let ingreso = null;

app.on("web-contents-created", (_evento, contenido) => {
  const soloPropios = (evento, url) => { if (!url.startsWith(`${ORIGEN}/`)) evento.preventDefault(); };
  contenido.setWindowOpenHandler(() => ({ action: "deny" }));
  contenido.on("will-navigate", soloPropios);
  contenido.on("will-redirect", soloPropios);
  contenido.on("will-attach-webview", (evento) => evento.preventDefault());
});
app.on("window-all-closed", () => app.quit());

// Una sola ventana: si se abre la app otra vez, se muestra la que ya está abierta.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!ventana) return;
    if (ventana.isMinimized()) ventana.restore();
    ventana.focus();
  });
  app.whenReady().then(iniciar);
}

async function iniciar() {
  preferencias = crearPreferencias(path.join(app.getPath("userData"), "preferencias.json"));
  servidor = elegirServidor({ empaquetada: app.isPackaged, variable: process.env.BODEGA_SERVIDOR });
  const clave = await leerClaveIngreso({ raiz: RAIZ, empaquetada: app.isPackaged, variable: process.env.BODEGA_CLAVE_INGRESO });
  ingreso = crearIngreso({ servidor, clave, fetchImpl: (...args) => net.fetch(...args) });
  Menu.setApplicationMenu(null);
  protocol.handle("app", servirArchivo);
  // La pantalla no necesita cámara, micrófono, notificaciones ni otros permisos.
  session.defaultSession.setPermissionRequestHandler((_contenido, _permiso, responder) => responder(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // Sin corrector ortográfico: evita que se descarguen diccionarios de internet.
  session.defaultSession.setSpellCheckerEnabled(false);

  ipcMain.handle("preferencias:obtener", (evento) => {
    validarRemitente(evento);
    return { ...preferencias.leer(), version: app.getVersion(), servidor };
  });
  ipcMain.handle("ingreso:operadores", (evento) => {
    validarRemitente(evento);
    return ingreso.operadores();
  });
  ipcMain.handle("ingreso:iniciar", (evento, datos) => {
    validarRemitente(evento);
    if (!datosIngresoValidos(datos)) return { ok: false, status: 400, codigo: "DATOS_INVALIDOS", mensaje: "Elegí tu nombre y escribí un PIN de 4 números" };
    return ingreso.iniciar(datos);
  });
  // Etiquetas de las cajas: abre el diálogo de impresión de Windows con lo que la página dejó para imprimir.
  ipcMain.handle("imprimir", (evento) => {
    validarRemitente(evento);
    return new Promise((resolver) => {
      evento.sender.print({ printBackground: true }, (ok, motivo) => resolver({ ok, motivo: ok ? null : String(motivo ?? "") }));
    });
  });
  ipcMain.handle("preferencias:guardar", (evento, cambios) => {
    validarRemitente(evento);
    const nuevas = preferencias.guardar(cambios);
    aplicar(nuevas);
    return { ...nuevas, version: app.getVersion(), servidor };
  });

  aplicarInicioConWindows(preferencias.leer());
  crearVentana();
}

async function servirArchivo(solicitud) {
  const archivo = resolverArchivo(UI, solicitud.url);
  if (!archivo) return new Response("No encontrado", { status: 404 });
  try {
    return new Response(await readFile(archivo), { status: 200, headers: cabeceras(archivo, servidor) });
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
}

function validarRemitente(evento) {
  if (!evento.senderFrame?.url.startsWith(`${ORIGEN}/`)) throw new Error("Remitente no permitido");
}

function crearVentana() {
  const inicial = preferencias.leer();
  ventana = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: "Bodega · Cosprobell",
    backgroundColor: "#f4f2f8",
    fullscreen: inicial.pantallaCompleta,
    // En Windows la ventana usa el ícono del programa instalado.
    icon: process.platform === "win32" ? undefined : path.join(RAIZ, "build", "icon.png"),
    webPreferences: {
      preload: path.join(RAIZ, "src", "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  ventana.once("ready-to-show", () => {
    if (!inicial.pantallaCompleta) ventana.maximize();
    ventana.show();
  });
  ventana.webContents.on("did-finish-load", () => ventana?.webContents.setZoomFactor(preferencias.leer().zoom));
  ventana.webContents.on("before-input-event", atajos);
  ventana.on("closed", () => { ventana = null; });
  ventana.loadURL(`${ORIGEN}/index.html`);
}

// F11 pantalla completa; F5 o Ctrl+R recarga; Ctrl + / Ctrl - / Ctrl 0 tamaño de letra.
function atajos(evento, entrada) {
  if (entrada.type !== "keyDown" || !ventana) return;
  const control = entrada.control || entrada.meta;
  const tecla = entrada.key;
  let manejada = true;
  if (tecla === "F11") aplicar(preferencias.guardar({ pantallaCompleta: !ventana.isFullScreen() }));
  else if (tecla === "F5" || (control && tecla.toLowerCase() === "r")) ventana.webContents.reload();
  else if (control && (tecla === "+" || tecla === "=")) aplicar(preferencias.guardar({ zoom: preferencias.leer().zoom + 0.1 }));
  else if (control && tecla === "-") aplicar(preferencias.guardar({ zoom: preferencias.leer().zoom - 0.1 }));
  else if (control && tecla === "0") aplicar(preferencias.guardar({ zoom: 1 }));
  else manejada = false;
  if (manejada) evento.preventDefault();
}

function aplicar(nuevas) {
  if (ventana) {
    if (ventana.isFullScreen() !== nuevas.pantallaCompleta) ventana.setFullScreen(nuevas.pantallaCompleta);
    ventana.webContents.setZoomFactor(nuevas.zoom);
  }
  aplicarInicioConWindows(nuevas);
}

// Solo en el programa instalado: en desarrollo registraría el ejecutable de Electron.
function aplicarInicioConWindows(actuales) {
  if (process.platform === "win32" && app.isPackaged) app.setLoginItemSettings({ openAtLogin: actuales.iniciarConWindows });
}
