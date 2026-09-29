// Dirección del backend. La app instalada usa siempre la de producción; solo en desarrollo se puede cambiar con
// la variable BODEGA_SERVIDOR (por ejemplo, un backend en este mismo equipo).
export const SERVIDOR_PRODUCCION = "https://cosprobell-backend-production.up.railway.app";
const LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function elegirServidor({ empaquetada, variable }) {
  if (empaquetada || !variable) return SERVIDOR_PRODUCCION;
  const url = new URL(variable);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCALES.has(url.hostname))) {
    throw new Error("BODEGA_SERVIDOR debe usar https:// (o http:// hacia este mismo equipo)");
  }
  return url.origin;
}
