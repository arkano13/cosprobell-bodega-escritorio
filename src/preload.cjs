// Puente mínimo entre la pantalla y la app: preferencias del equipo, lista de operadores, ingreso con PIN,
// impresión de las etiquetas de las cajas, reportes en PDF y la versión nueva lista para instalar.
// La página no tiene acceso a Node ni a Electron, ni ve la clave de ingreso.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("escritorio", {
  obtenerPreferencias: () => ipcRenderer.invoke("preferencias:obtener"),
  guardarPreferencias: (cambios) => ipcRenderer.invoke("preferencias:guardar", cambios),
  operadores: () => ipcRenderer.invoke("ingreso:operadores"),
  ingresar: (operadorId, pin) => ipcRenderer.invoke("ingreso:iniciar", { operadorId, pin }),
  imprimir: () => ipcRenderer.invoke("imprimir"),
  // datos: { nombre, pie }. Guarda en PDF lo que la página dejó en su zona de impresión.
  guardarPdf: (datos) => ipcRenderer.invoke("reporte:pdf", datos),
  actualizacionPendiente: () => ipcRenderer.invoke("actualizacion:pendiente"),
  alActualizacionLista: (avisar) => { ipcRenderer.on("actualizacion:lista", (_evento, datos) => avisar(datos)); },
  instalarActualizacion: () => ipcRenderer.invoke("actualizacion:instalar"),
});
