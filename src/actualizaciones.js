// Actualización automática del programa instalado. Las versiones se publican como Releases del repositorio de la app
// (privado); el backend las sirve en /actualizaciones a quien presente la clave de ingreso, así la app no lleva ningún
// token de GitHub. Revisa al abrir y cada 2 horas, descarga en segundo plano y avisa a la pantalla: se instala al tocar
// «Reiniciar y actualizar» o, si nadie lo toca, al cerrar el programa.
export const REVISAR_CADA_MS = 2 * 60 * 60_000;
export const PRIMERA_REVISION_MS = 30_000;

// autoUpdater: el de electron-updater (se pasa para poder probarlo). avisar({ version }): cuando la versión nueva ya
// está descargada. Devuelve null si no hay clave (la app tampoco podría ingresar).
export function iniciarActualizaciones({ autoUpdater, servidor, clave, avisar, registrar = () => {}, programar = setTimeout, repetir = setInterval,
  primeraMs = PRIMERA_REVISION_MS, cadaMs = REVISAR_CADA_MS }) {
  if (!clave) return null;
  let lista = null;
  autoUpdater.setFeedURL({ provider: "generic", url: `${servidor}/actualizaciones` });
  autoUpdater.requestHeaders = { "X-API-Key": clave };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // El backend transmite el instalador entero (no atiende pedidos por partes).
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.logger = null;
  autoUpdater.on("update-downloaded", (info) => { lista = { version: info.version }; avisar(lista); });
  autoUpdater.on("error", (error) => registrar(`No se pudo revisar si hay una versión nueva: ${error?.message ?? error}`));
  // Si la revisión falla, electron-updater también emite "error" (ya registrado arriba).
  const revisar = () => autoUpdater.checkForUpdates().catch(() => {});
  programar(revisar, primeraMs);
  repetir(revisar, cadaMs);
  return {
    revisar,
    // La versión ya descargada, si hay (para la pantalla que se abre después del aviso).
    pendiente: () => lista,
    // Cierra, instala sin preguntar y vuelve a abrir el programa.
    instalar: () => { if (lista) autoUpdater.quitAndInstall(true, true); return Boolean(lista); },
  };
}
