import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ORIGEN, politicaContenido, cabeceras, resolverArchivo } from "../src/archivos.js";
import { SERVIDOR_PRODUCCION, elegirServidor } from "../src/servidor.js";
import { crearIngreso, datosIngresoValidos, leerClaveIngreso } from "../src/ingreso.js";
import { PREFERENCIAS_INICIALES, crearPreferencias, normalizarPreferencias } from "../src/preferencias.js";

const UI = path.resolve("ui");

test("archivos: sirve solo lo que está dentro de ui/", () => {
  assert.equal(resolverArchivo(UI, `${ORIGEN}/`), path.join(UI, "index.html"));
  assert.equal(resolverArchivo(UI, `${ORIGEN}/js/app.js?v=1`), path.join(UI, "js", "app.js"));
  assert.equal(resolverArchivo(UI, `${ORIGEN}/fuentes/barlow-latin-500-normal.woff2`), path.join(UI, "fuentes", "barlow-latin-500-normal.woff2"));
  // Intentos de salir de la carpeta, otros orígenes y tipos que la pantalla no usa.
  // La dirección normaliza "..": queda dentro de ui/ (ese archivo no existe y responde 404).
  assert.equal(resolverArchivo(UI, `${ORIGEN}/%2e%2e/src/main.js`), path.join(UI, "src", "main.js"));
  assert.equal(resolverArchivo(UI, `${ORIGEN}/..%2fpackage.json`), null);
  assert.equal(resolverArchivo(UI, `${ORIGEN}/%2e%2e%5c%2e%2e%5cpackage.json`), null);
  assert.equal(resolverArchivo(UI, "app://otro/index.html"), null);
  assert.equal(resolverArchivo(UI, "https://bodega/index.html"), null);
  assert.equal(resolverArchivo(UI, `${ORIGEN}/js/app.map`), null);
  assert.equal(resolverArchivo(UI, `${ORIGEN}/%E0%A4%A`), null);
  assert.equal(resolverArchivo(UI, `${ORIGEN}/index.html%00.js`), null);
  assert.equal(resolverArchivo(UI, "no es una dirección"), null);
});

test("archivos: tipo de contenido y política de seguridad en cada respuesta", () => {
  const html = cabeceras(path.join(UI, "index.html"), SERVIDOR_PRODUCCION);
  const politica = politicaContenido(SERVIDOR_PRODUCCION);
  assert.equal(html["Content-Type"], "text/html; charset=utf-8");
  assert.equal(html["Content-Security-Policy"], politica);
  assert.equal(html["X-Content-Type-Options"], "nosniff");
  assert.equal(cabeceras("x.js", SERVIDOR_PRODUCCION)["Content-Type"], "text/javascript; charset=utf-8");
  assert.equal(cabeceras("x.woff2", SERVIDOR_PRODUCCION)["Content-Type"], "font/woff2");
  assert.match(politica, /script-src 'self'/);
  // Solo se conecta al servidor de la app, a ningún otro sitio.
  assert.match(politica, /connect-src https:\/\/cosprobell-backend-production\.up\.railway\.app;/);
  assert.match(politicaContenido("http://127.0.0.1:3995"), /connect-src http:\/\/127\.0\.0\.1:3995;/);
  assert.doesNotMatch(politica, /unsafe|https: /);
});

test("todos los archivos de la pantalla tienen un tipo de contenido conocido", () => {
  const recorrer = (carpeta) => fs.readdirSync(carpeta, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? recorrer(path.join(carpeta, e.name)) : [path.join(carpeta, e.name)]));
  for (const archivo of recorrer(UI)) {
    const relativo = path.relative(UI, archivo).split(path.sep).join("/");
    assert.equal(resolverArchivo(UI, `${ORIGEN}/${relativo}`), archivo, relativo);
  }
});

test("preferencias: valores iniciales, límites y archivo dañado", (t) => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "bodega-"));
  t.after(() => fs.rmSync(carpeta, { recursive: true, force: true }));
  const archivo = path.join(carpeta, "sub", "preferencias.json");
  const preferencias = crearPreferencias(archivo);
  assert.deepEqual(preferencias.leer(), PREFERENCIAS_INICIALES);
  assert.deepEqual(preferencias.guardar({ pantallaCompleta: true, zoom: 1.25, otra: "x", __proto__: { iniciarConWindows: true } }),
    { pantallaCompleta: true, iniciarConWindows: false, zoom: 1.3 });
  assert.deepEqual(JSON.parse(fs.readFileSync(archivo, "utf8")), { pantallaCompleta: true, iniciarConWindows: false, zoom: 1.3 });
  assert.equal(preferencias.guardar({ zoom: 9 }).zoom, 1.6);
  assert.equal(preferencias.guardar({ zoom: 0.1 }).zoom, 0.7);
  assert.equal(preferencias.guardar({ iniciarConWindows: "sí" }).iniciarConWindows, false);
  assert.equal(preferencias.leer().pantallaCompleta, true);
  fs.writeFileSync(archivo, "{ dañado");
  assert.deepEqual(preferencias.leer(), PREFERENCIAS_INICIALES);
  assert.deepEqual(normalizarPreferencias(null), PREFERENCIAS_INICIALES);
  assert.deepEqual(fs.readdirSync(path.dirname(archivo)), ["preferencias.json"]);
});

test("servidor: la app instalada usa siempre producción; en desarrollo se puede cambiar", () => {
  assert.equal(SERVIDOR_PRODUCCION, "https://cosprobell-backend-production.up.railway.app");
  assert.equal(elegirServidor({ empaquetada: true, variable: "http://127.0.0.1:3000" }), SERVIDOR_PRODUCCION);
  assert.equal(elegirServidor({ empaquetada: false, variable: undefined }), SERVIDOR_PRODUCCION);
  assert.equal(elegirServidor({ empaquetada: false, variable: "http://127.0.0.1:3995/x" }), "http://127.0.0.1:3995");
  assert.equal(elegirServidor({ empaquetada: false, variable: "https://otro.ejemplo.com" }), "https://otro.ejemplo.com");
  assert.throws(() => elegirServidor({ empaquetada: false, variable: "http://otro.ejemplo.com" }), /https/);
});

test("ingreso: clave desde el archivo armado por GitHub Actions o la variable de desarrollo", async (t) => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "bodega-clave-"));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  assert.equal(await leerClaveIngreso({ raiz, empaquetada: true }), null);
  fs.mkdirSync(path.join(raiz, "recursos"));
  fs.writeFileSync(path.join(raiz, "recursos", "clave-ingreso.json"), JSON.stringify({ clave: "clave-armada" }));
  assert.equal(await leerClaveIngreso({ raiz, empaquetada: true, variable: "ignorada" }), "clave-armada");
  assert.equal(await leerClaveIngreso({ raiz, empaquetada: false, variable: "clave-dev" }), "clave-dev");
  fs.writeFileSync(path.join(raiz, "recursos", "clave-ingreso.json"), JSON.stringify({ clave: null }));
  assert.equal(await leerClaveIngreso({ raiz, empaquetada: true }), null);
});

test("ingreso: manda la clave solo al servidor de la app y no lanza errores a la página", async () => {
  const envios = [];
  const respuestas = [
    Response.json({ data: [{ id: 7, nombre: "Ana López" }] }),
    Response.json({ error: { code: "PIN_INCORRECTO", message: "PIN incorrecto" } }, { status: 401 }),
    Response.json({ data: { token: "t", operador: { id: 7, nombre: "Ana López" } } }, { status: 201 }),
  ];
  const ingreso = crearIngreso({ servidor: "https://srv.ejemplo.com", clave: "clave-ingreso",
    fetchImpl: async (url, opciones) => { envios.push([url, opciones]); return respuestas.shift(); } });
  assert.deepEqual(await ingreso.operadores(), { ok: true, data: [{ id: 7, nombre: "Ana López" }] });
  assert.deepEqual([envios[0][0], envios[0][1].headers["X-API-Key"]], ["https://srv.ejemplo.com/ingreso/operadores", "clave-ingreso"]);
  assert.deepEqual(await ingreso.iniciar({ operadorId: 7, pin: "0000" }), { ok: false, status: 401, codigo: "PIN_INCORRECTO", mensaje: "PIN incorrecto" });
  assert.deepEqual(JSON.parse(envios[1][1].body), { operadorId: 7, pin: "0000" });
  assert.equal((await ingreso.iniciar({ operadorId: 7, pin: "4827" })).data.token, "t");

  const sinRed = crearIngreso({ servidor: "https://srv.ejemplo.com", clave: "c", fetchImpl: async () => { throw new TypeError("sin red"); } });
  assert.deepEqual(await sinRed.operadores(), { ok: false, status: 0, codigo: null, mensaje: "Sin conexión con el servidor" });
  const sinClave = crearIngreso({ servidor: "https://srv.ejemplo.com", clave: null, fetchImpl: async () => assert.fail("no debe pedir nada") });
  assert.equal((await sinClave.operadores()).codigo, "SIN_CLAVE_INGRESO");
  const lento = crearIngreso({ servidor: "https://srv.ejemplo.com", clave: "c", tiempoMs: 20,
    fetchImpl: (_u, { signal }) => new Promise((_r, rechazar) => signal.addEventListener("abort", () => rechazar(new Error("abortado")))) });
  assert.equal((await lento.operadores()).status, 0);
});

test("ingreso: solo se reenvían un operador y un PIN de 4 números", () => {
  assert.equal(datosIngresoValidos({ operadorId: 7, pin: "4827" }), true);
  for (const malo of [{ operadorId: "7", pin: "4827" }, { operadorId: 0, pin: "4827" }, { operadorId: 7, pin: "482" },
    { operadorId: 7, pin: 4827 }, { operadorId: 7, pin: "48a7" }, undefined]) assert.equal(datosIngresoValidos(malo), false, JSON.stringify(malo));
});
