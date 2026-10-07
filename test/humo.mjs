// Prueba rápida del programa ya armado: arranca el ejecutable, se conecta a su ventana y comprueba que abra el
// ingreso de operadores (la lista o, sin conexión, el aviso), que la página no acceda a Node y que no haya errores.
// Uso: node test/humo.mjs "<ruta al ejecutable>" [argumentos extra]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const [ejecutable, ...extra] = process.argv.slice(2);
if (!ejecutable) {
  console.error('Uso: node test/humo.mjs "<ruta al ejecutable>"');
  process.exit(2);
}
const puerto = 9300 + Math.floor(Math.random() * 500);
const datos = mkdtempSync(path.join(os.tmpdir(), "bodega-humo-"));
const programa = spawn(ejecutable, [`--remote-debugging-port=${puerto}`, `--user-data-dir=${datos}`, ...extra], { stdio: "ignore" });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const fallar = (texto) => { throw new Error(texto); };

let navegador;
try {
  for (let intento = 0; !navegador && intento < 60; intento++) {
    navegador = await chromium.connectOverCDP(`http://127.0.0.1:${puerto}`).catch(() => null);
    if (!navegador) await esperar(500);
  }
  if (!navegador) fallar("El programa no abrió su ventana a tiempo");
  let pagina;
  for (let intento = 0; !pagina && intento < 60; intento++) {
    pagina = navegador.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("app://bodega/"));
    if (!pagina) await esperar(500);
  }
  if (!pagina) fallar("No apareció la pantalla de bodega");
  const errores = [];
  pagina.on("pageerror", (e) => errores.push(e.message));
  await pagina.waitForSelector(".ingreso", { timeout: 40000 });
  const estado = await pagina.evaluate(() => ({
    titulo: document.title,
    require: typeof require,
    process: typeof process,
    puente: Object.keys(window.escritorio ?? {}).sort().join(","),
  }));
  const esperado = { titulo: "Bodega · Cosprobell", require: "undefined", process: "undefined", puente: "actualizacionPendiente,alActualizacionLista,guardarPreferencias,imprimir,ingresar,instalarActualizacion,obtenerPreferencias,operadores" };
  if (JSON.stringify(estado) !== JSON.stringify(esperado)) fallar(`Estado inesperado: ${JSON.stringify(estado)}`);
  const servidor = (await pagina.evaluate(() => window.escritorio.obtenerPreferencias())).servidor;
  await pagina.click("#btn-menu");
  await pagina.waitForFunction(() => document.querySelector(".version")?.textContent.includes("versión"), null, { timeout: 10000 });
  console.log(`${await pagina.locator(".version").textContent()}: abre el ingreso de operadores, servidor ${servidor}, sin acceso a Node.`);
  if (errores.length) fallar(`Errores de página: ${errores.join("; ")}`);
  console.log("PRUEBA RÁPIDA APROBADA.");
} catch (error) {
  console.error("FALLÓ:", error.message);
  process.exitCode = 1;
} finally {
  await navegador?.close().catch(() => {});
  programa.kill();
  await esperar(1000);
  try { rmSync(datos, { recursive: true, force: true, maxRetries: 5 }); } catch { /* Windows puede tardar en soltar la carpeta */ }
}
