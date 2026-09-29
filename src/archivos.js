// Archivos de la pantalla servidos por el protocolo app://bodega. Nunca se sirve nada fuera de la carpeta ui/.
import path from "node:path";

export const ORIGEN = "app://bodega";

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// La pantalla solo ejecuta sus propios archivos y solo se conecta al servidor de la app.
export function politicaContenido(servidor) {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    `connect-src ${new URL(servidor).origin}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// Devuelve la ruta del archivo pedido dentro de raiz, o null si no corresponde servirlo.
export function resolverArchivo(raiz, direccion) {
  let url;
  try { url = new URL(direccion); } catch { return null; }
  if (`${url.protocol}//${url.host}` !== ORIGEN) return null;
  let ruta;
  try { ruta = decodeURIComponent(url.pathname); } catch { return null; }
  if (ruta === "/" || ruta === "") ruta = "/index.html";
  if (ruta.includes("\0")) return null;
  const base = path.resolve(raiz);
  const archivo = path.resolve(base, `.${ruta}`);
  if (!archivo.startsWith(base + path.sep)) return null;
  if (!Object.hasOwn(TIPOS, path.extname(archivo).toLowerCase())) return null;
  return archivo;
}

export function cabeceras(archivo, servidor) {
  return {
    "Content-Type": TIPOS[path.extname(archivo).toLowerCase()],
    "Content-Security-Policy": politicaContenido(servidor),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };
}
