import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PRIMERA_REVISION_MS, REVISAR_CADA_MS, iniciarActualizaciones } from "../src/actualizaciones.js";
import { revisarLatest } from "./revisar-latest.mjs";

// Un autoUpdater de electron-updater de mentira: registra lo que se le pide.
function actualizadorFalso({ falla = null } = {}) {
  const a = new EventEmitter();
  a.revisiones = 0;
  a.instalaciones = [];
  a.setFeedURL = (opciones) => { a.feed = opciones; };
  a.checkForUpdates = async () => { a.revisiones += 1; if (falla) { a.emit("error", falla); throw falla; } return null; };
  a.quitAndInstall = (...argumentos) => a.instalaciones.push(argumentos);
  return a;
}

function iniciar(opciones = {}) {
  const autoUpdater = actualizadorFalso(opciones);
  const avisos = [];
  const registros = [];
  const programados = [];
  const repetidos = [];
  const control = iniciarActualizaciones({
    autoUpdater, servidor: "https://servidor.test", clave: "clave-de-ingreso", avisar: (d) => avisos.push(d),
    registrar: (t) => registros.push(t), programar: (f, ms) => programados.push({ f, ms }), repetir: (f, ms) => repetidos.push({ f, ms }),
  });
  return { autoUpdater, avisos, registros, programados, repetidos, control };
}

test("actualizaciones: busca en el backend con la clave de ingreso, al abrir y cada 2 horas", async () => {
  const { autoUpdater, programados, repetidos } = iniciar();
  assert.deepEqual(autoUpdater.feed, { provider: "generic", url: "https://servidor.test/actualizaciones" });
  assert.deepEqual(autoUpdater.requestHeaders, { "X-API-Key": "clave-de-ingreso" });
  assert.equal(autoUpdater.autoDownload, true);
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);
  assert.equal(autoUpdater.disableDifferentialDownload, true);
  assert.deepEqual(programados.map((p) => p.ms), [PRIMERA_REVISION_MS]);
  assert.deepEqual(repetidos.map((p) => p.ms), [REVISAR_CADA_MS]);
  assert.equal(REVISAR_CADA_MS, 7_200_000);
  await programados[0].f();
  await repetidos[0].f();
  assert.equal(autoUpdater.revisiones, 2);
});

test("actualizaciones: avisa la versión descargada y la instala solo si hay una", () => {
  const { autoUpdater, avisos, control } = iniciar();
  assert.equal(control.pendiente(), null);
  assert.equal(control.instalar(), false);
  assert.deepEqual(autoUpdater.instalaciones, []);
  autoUpdater.emit("update-downloaded", { version: "1.9.1", files: [] });
  assert.deepEqual(avisos, [{ version: "1.9.1" }]);
  assert.deepEqual(control.pendiente(), { version: "1.9.1" });
  assert.equal(control.instalar(), true);
  // Instala sin preguntar y vuelve a abrir el programa.
  assert.deepEqual(autoUpdater.instalaciones, [[true, true]]);
});

test("actualizaciones: una falla se registra una vez y no corta nada", async () => {
  const { programados, registros, avisos } = iniciar({ falla: new Error("HTTP 503") });
  await programados[0].f();
  assert.deepEqual(registros, ["No se pudo revisar si hay una versión nueva: HTTP 503"]);
  assert.deepEqual(avisos, []);
});

test("actualizaciones: sin clave de ingreso no se busca nada", () => {
  const autoUpdater = actualizadorFalso();
  assert.equal(iniciarActualizaciones({ autoUpdater, servidor: "https://servidor.test", clave: null, avisar: () => {} }), null);
  assert.equal(autoUpdater.feed, undefined);
});

test("latest.yml: versión, etiqueta e instalador con su sha512", (t) => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "bodega-latest-"));
  t.after(() => fs.rmSync(carpeta, { recursive: true, force: true }));
  const instalador = "Bodega-Cosprobell-1.9.1-instalador.exe";
  const contenido = Buffer.from("instalador de prueba");
  const sha512 = createHash("sha512").update(contenido).digest("base64");
  fs.writeFileSync(path.join(carpeta, instalador), contenido);
  const escribir = (version, sha = sha512) => fs.writeFileSync(path.join(carpeta, "latest.yml"),
    `version: ${version}\nfiles:\n  - url: ${instalador}\n    sha512: ${sha}\n    size: ${contenido.length}\npath: ${instalador}\nsha512: ${sha}\nreleaseDate: '2026-10-07T12:00:00.000Z'\n`);

  assert.throws(() => revisarLatest({ carpeta, version: "1.9.1" }), /No se armó/);
  escribir("1.9.1");
  assert.deepEqual(revisarLatest({ carpeta, version: "1.9.1" }), { version: "1.9.1", instalador });
  assert.deepEqual(revisarLatest({ carpeta, version: "1.9.1", etiqueta: "v1.9.1" }), { version: "1.9.1", instalador });
  assert.throws(() => revisarLatest({ carpeta, version: "1.9.1", etiqueta: "v1.9.2" }), /La etiqueta v1.9.2 no coincide/);
  assert.throws(() => revisarLatest({ carpeta, version: "1.9.2" }), /latest.yml dice 1.9.1 y package.json 1.9.2/);
  escribir("1.9.1", "otro");
  assert.throws(() => revisarLatest({ carpeta, version: "1.9.1" }), /El sha512 de latest.yml no es el de/);
  fs.rmSync(path.join(carpeta, instalador));
  escribir("1.9.1");
  assert.throws(() => revisarLatest({ carpeta, version: "1.9.1" }), /que no está en/);
});
