// Puente mínimo entre la pantalla y la app: solo leer y guardar las preferencias del equipo.
// La página no tiene acceso a Node ni a Electron.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("escritorio", {
  obtenerPreferencias: () => ipcRenderer.invoke("preferencias:obtener"),
  guardarPreferencias: (cambios) => ipcRenderer.invoke("preferencias:guardar", cambios),
});
