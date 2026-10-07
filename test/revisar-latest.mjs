// Revisa el latest.yml que arma electron-builder junto al instalador: que diga la versión de package.json (y la de la
// etiqueta, si se publica una) y que el instalador que nombra exista con el mismo sha512. Es lo que leen las apps
// instaladas para saber si hay una versión nueva y comprobar lo que descargan.
// Uso: node test/revisar-latest.mjs <carpeta dist> [etiqueta vX.Y.Z]
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const valor = (texto, clave) => texto.match(new RegExp(`^${clave}:\\s*['"]?([^'"\\r\\n]+?)['"]?\\s*$`, "m"))?.[1] ?? null;

export function revisarLatest({ carpeta, version, etiqueta = "" }) {
  const archivo = path.join(carpeta, "latest.yml");
  if (!existsSync(archivo)) throw new Error(`No se armó ${archivo}: revisá "publish" en package.json`);
  const texto = readFileSync(archivo, "utf8");
  const enLatest = valor(texto, "version");
  if (enLatest !== version) throw new Error(`latest.yml dice ${enLatest} y package.json ${version}`);
  if (etiqueta && etiqueta !== `v${version}`) throw new Error(`La etiqueta ${etiqueta} no coincide con la versión ${version} de package.json`);
  const instalador = valor(texto, "path");
  if (!instalador || instalador.includes("/") || instalador.includes("\\")) throw new Error("latest.yml no nombra el instalador");
  const ruta = path.join(carpeta, instalador);
  if (!existsSync(ruta)) throw new Error(`latest.yml nombra ${instalador}, que no está en ${carpeta}`);
  const sha512 = createHash("sha512").update(readFileSync(ruta)).digest("base64");
  if (valor(texto, "sha512") !== sha512) throw new Error(`El sha512 de latest.yml no es el de ${instalador}`);
  return { version, instalador };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [carpeta = "dist", etiqueta = ""] = process.argv.slice(2);
  const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { version } = JSON.parse(readFileSync(path.join(raiz, "package.json"), "utf8"));
  try {
    const { instalador } = revisarLatest({ carpeta, version, etiqueta });
    console.log(`latest.yml correcto: versión ${version}, ${instalador}`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
