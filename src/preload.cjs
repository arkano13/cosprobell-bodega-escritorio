// Puente mínimo entre la pantalla y la app: preferencias del equipo, lista de operadores, ingreso con PIN e
// impresión de las etiquetas de las cajas.
// La página no tiene acceso a Node ni a Electron, ni ve la clave de ingreso.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("escritorio", {
  obtenerPreferencias: () => ipcRenderer.invoke("preferencias:obtener"),
  guardarPreferencias: (cambios) => ipcRenderer.invoke("preferencias:guardar", cambios),
  operadores: () => ipcRenderer.invoke("ingreso:operadores"),
  ingresar: (operadorId, pin) => ipcRenderer.invoke("ingreso:iniciar", { operadorId, pin }),
  imprimir: () => ipcRenderer.invoke("imprimir"),
});
