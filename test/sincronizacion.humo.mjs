// Prueba de pantalla con API simulada; nunca conecta con SAP ni Railway.
// Requiere Microsoft Edge y npm install. Ejecutar: node test/sincronizacion.humo.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const raiz = resolve("ui");
const tipos = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const archivo = resolve(raiz, "." + (new URL(req.url, "http://local").pathname === "/" ? "/index.html" : new URL(req.url, "http://local").pathname));
  if (!archivo.startsWith(raiz + sep)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { "Content-Type": tipos[extname(archivo)] ?? "application/octet-stream" }).end(await readFile(archivo)); }
  catch { res.writeHead(404).end(); }
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = []; page.on("pageerror", e => errores.push(e.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.addInitScript(base => {
    window.escritorio = { obtenerPreferencias: async () => ({ servidor: base + "/api" }) };
    localStorage.setItem("bodega.ingreso", JSON.stringify({ token: "prueba-local", expiraEn: new Date(Date.now() + 3600000).toISOString(), operador: { id: 1, nombre: "Prueba", rol: "supervisor" } }));
  }, base);
  const entidades = ["clientes", "productos", "unidades", "codigosBarras", "pedidos", "almacenes", "existencias"];
  let solicitud = null, posts = 0, consultas = 0, tablas = 0;
  await page.route(base + "/api/**", async route => {
    const ruta = new URL(route.request().url()).pathname;
    let data;
    if (ruta.endsWith("/solicitud")) {
      if (route.request().method() === "POST") {
        posts++; solicitud = { id: "prueba", estado: "pendiente", entidades, completas: [] };
        data = solicitud;
      } else { consultas++; data = { entidades, solicitud, ultimaConexion: new Date().toISOString() }; }
    } else if (ruta.endsWith("/sincronizacion")) {
      tablas++; data = { empresa: "PRUEBA LOCAL", entidades: entidades.map(entidad => ({ entidad, registros: 12, ultimaRecepcion: new Date().toISOString() })) };
    } else if (ruta.endsWith("/supervisor/resumen")) data = { etiquetas: { sinConfirmar: 0, desactualizadas: 0 }, revisiones: { enRevision: 0, conDiferencias: 0, sinEntrega: 0 }, operadores: { bloqueados: 0 }, almacenes: { elegidos: 2 } };
    else data = [];
    await route.fulfill({ json: { data, siguienteCursor: null } });
  });
  await page.goto(base);
  await page.getByRole("button", { name: "Panel del supervisor", exact: true }).click();
  await page.getByRole("button", { name: "Sincronización", exact: true }).click();
  await page.getByRole("button", { name: "Actualizar todo", exact: true }).click();
  await page.getByText("Solicitud guardada. Esperando al puente.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Actualización en curso" }).isDisabled(), true);
  solicitud = { ...solicitud, estado: "sincronizando", completas: ["productos", "clientes"] };
  await page.getByText(/Actualizando: 2 de 7/).waitFor({ timeout: 12000 });
  await mkdir("dist", { recursive: true });
  await page.screenshot({ path: "dist/actualizacion-manual.png", fullPage: true });
  solicitud = { ...solicitud, estado: "completado", completas: entidades, finalizadaEn: new Date().toISOString() };
  const antes = tablas;
  await page.getByText("Actualización completada.", { exact: true }).waitFor({ timeout: 12000 });
  assert.ok(tablas > antes); assert.equal(posts, 1);
  await page.getByRole("button", { name: "Pedidos", exact: true }).click();
  const alSalir = consultas;
  await page.waitForTimeout(8500);
  assert.equal(consultas, alSalir);
  assert.deepEqual(errores, []);
  console.log("APROBADO: botón, espera, progreso, fin, refresco y salida de pantalla; sin consultas reales.");
} finally {
  await browser?.close(); server.close(); server.closeAllConnections();
}
