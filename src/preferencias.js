// Preferencias del equipo (pantalla completa, inicio con Windows y tamaño de letra), guardadas en un archivo
// JSON dentro de la carpeta de datos de la app. Un archivo dañado o ausente vuelve a los valores iniciales.
import fs from "node:fs";
import path from "node:path";

export const PREFERENCIAS_INICIALES = Object.freeze({ pantallaCompleta: false, iniciarConWindows: false, zoom: 1 });
export const ZOOM_MINIMO = 0.7;
export const ZOOM_MAXIMO = 1.6;

export function normalizarPreferencias(valor) {
  const origen = valor && typeof valor === "object" ? valor : {};
  const zoom = Number(origen.zoom);
  return {
    pantallaCompleta: origen.pantallaCompleta === true,
    iniciarConWindows: origen.iniciarConWindows === true,
    zoom: Number.isFinite(zoom) ? Math.round(Math.min(ZOOM_MAXIMO, Math.max(ZOOM_MINIMO, zoom)) * 10) / 10 : 1,
  };
}

export function crearPreferencias(archivo) {
  function leer() {
    try {
      return normalizarPreferencias(JSON.parse(fs.readFileSync(archivo, "utf8")));
    } catch {
      return { ...PREFERENCIAS_INICIALES };
    }
  }

  // Solo se aceptan las claves conocidas; el archivo se reemplaza de una vez para no dejarlo a medias.
  function guardar(cambios) {
    const permitidos = Object.fromEntries(Object.entries(cambios ?? {}).filter(([clave]) => Object.hasOwn(PREFERENCIAS_INICIALES, clave)));
    const nuevas = normalizarPreferencias({ ...leer(), ...permitidos });
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    const temporal = `${archivo}.${process.pid}.tmp`;
    fs.writeFileSync(temporal, JSON.stringify(nuevas, null, 2));
    fs.renameSync(temporal, archivo);
    return nuevas;
  }

  return { leer, guardar };
}
