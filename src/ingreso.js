// Lista de operadores e inicio de sesión con PIN, hechos desde el proceso principal: la clave de solo ingreso
// nunca llega a la página. Esa clave solo permite ver nombres e intentar el PIN; los datos piden la sesión.
import { readFile } from "node:fs/promises";
import path from "node:path";

// La clave viene en recursos/clave-ingreso.json, que GitHub Actions arma desde un secreto al empaquetar.
// En desarrollo también se puede pasar con la variable BODEGA_CLAVE_INGRESO.
export async function leerClaveIngreso({ raiz, empaquetada, variable }) {
  if (!empaquetada && variable) return variable;
  try {
    const { clave } = JSON.parse(await readFile(path.join(raiz, "recursos", "clave-ingreso.json"), "utf8"));
    return typeof clave === "string" && clave ? clave : null;
  } catch {
    return null;
  }
}

export const datosIngresoValidos = ({ operadorId, pin } = {}) =>
  Number.isInteger(operadorId) && operadorId > 0 && typeof pin === "string" && /^\d{4}$/.test(pin);

// Cada respuesta es { ok: true, data } o { ok: false, status, mensaje, codigo }: la página no recibe excepciones.
export function crearIngreso({ servidor, clave, fetchImpl, tiempoMs = 15000 }) {
  async function pedir(metodo, ruta, cuerpo) {
    if (!clave) {
      return { ok: false, status: 0, codigo: "SIN_CLAVE_INGRESO", mensaje: "Esta instalación no tiene la clave de ingreso. Avisá al supervisor para instalar una versión correcta." };
    }
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), tiempoMs);
    let respuesta;
    try {
      respuesta = await fetchImpl(`${servidor}${ruta}`, {
        method: metodo,
        headers: { "X-API-Key": clave, ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: control.signal,
      });
    } catch {
      return { ok: false, status: 0, codigo: null, mensaje: "Sin conexión con el servidor" };
    } finally {
      clearTimeout(temporizador);
    }
    let datos = null;
    try { datos = await respuesta.json(); } catch { /* cuerpo vacío o que no es JSON */ }
    if (!respuesta.ok) {
      const error = datos?.error;
      const mensaje = typeof error === "string" ? error : error?.message ?? `Error del servidor (${respuesta.status})`;
      return { ok: false, status: respuesta.status, codigo: error && typeof error === "object" ? error.code ?? null : null, mensaje };
    }
    return { ok: true, data: datos?.data ?? null };
  }

  return {
    operadores: () => pedir("GET", "/ingreso/operadores"),
    iniciar: ({ operadorId, pin }) => pedir("POST", "/ingreso/sesion", { operadorId, pin }),
  };
}
