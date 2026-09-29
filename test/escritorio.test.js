import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ORIGEN, POLITICA_CONTENIDO, cabeceras, resolverArchivo } from "../src/archivos.js";
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
  const html = cabeceras(path.join(UI, "index.html"));
  assert.equal(html["Content-Type"], "text/html; charset=utf-8");
  assert.equal(html["Content-Security-Policy"], POLITICA_CONTENIDO);
  assert.equal(html["X-Content-Type-Options"], "nosniff");
  assert.equal(cabeceras("x.js")["Content-Type"], "text/javascript; charset=utf-8");
  assert.equal(cabeceras("x.woff2")["Content-Type"], "font/woff2");
  assert.match(POLITICA_CONTENIDO, /script-src 'self'/);
  assert.match(POLITICA_CONTENIDO, /connect-src https: /);
  assert.doesNotMatch(POLITICA_CONTENIDO, /unsafe/);
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
