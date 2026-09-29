// Dirección del servidor de bodega. Se exige conexión segura (HTTPS); HTTP solo hacia este mismo equipo,
// para pruebas. Si se escribe sin "https://", se agrega.
const LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function normalizarServidor(texto) {
  const valor = String(texto ?? "").trim();
  if (!valor) return { error: "Escribí la dirección del servidor." };
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(valor) ? valor : `https://${valor}`);
  } catch {
    return { error: "La dirección no es válida. Ejemplo: https://nombre.up.railway.app" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "La dirección debe empezar con https://" };
  if (url.protocol === "http:" && !LOCALES.has(url.hostname)) return { error: "La dirección debe usar conexión segura (https://)." };
  if (url.username || url.password) return { error: "La dirección no debe incluir usuario ni contraseña." };
  return { servidor: url.origin };
}
