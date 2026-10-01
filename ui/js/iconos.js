// Íconos de Lucide (https://lucide.dev), lucide-static 1.48.0. Se dibujan como SVG en el documento, sin archivos
// externos, y toman el color del texto que los rodea.
//
// ISC License. Copyright (c) 2026 Lucide Icons and Contributors.
// Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby
// granted, provided that the above copyright notice and this permission notice appear in all copies.
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING
// ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL,
// DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
// WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE
// OR PERFORMANCE OF THIS SOFTWARE.

const SVG = "http://www.w3.org/2000/svg";
const circulo = { circle: { cx: 12, cy: 12, r: 10 } };

const TRAZOS = {
  aceptada: [circulo, "m16 9-5.5 5.5L8 12"], // circle-check
  rechazada: [circulo, "m15 9-6 6", "m9 9 6 6"], // circle-x
  alerta: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"], // triangle-alert
  info: [circulo, "M12 16v-4", "M12 8h.01"],
  escaner: ["M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2",
    "M8 7v10", "M12 7v10", "M17 7v10"], // scan-barcode
  volver: ["m12 19-7-7 7-7", "M19 12H5"], // arrow-left
  actualizar: ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5",
    "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"], // refresh-cw
  lista: ["M3 5h.01", "M3 12h.01", "M3 19h.01", "M8 5h13", "M8 12h13", "M8 19h13"], // list
  buscar: ["m21 21-4.34-4.34", { circle: { cx: 11, cy: 11, r: 8 } }], // search
  menu: ["M4 5h16", "M4 12h16", "M4 19h16"],
  teclado: ["M10 8h.01", "M12 12h.01", "M14 8h.01", "M16 12h.01", "M18 8h.01", "M6 8h.01", "M7 16h10", "M8 12h.01",
    { rect: { width: 20, height: 16, x: 2, y: 4, rx: 2 } }], // keyboard
  operador: ["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", { circle: { cx: 12, cy: 7, r: 4 } }], // user
  salir: ["m16 17 5-5-5-5", "M21 12H9", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"], // log-out
  siguiente: ["m9 18 6-6-6-6"], // chevron-right
  finalizar: ["M18 6 7 17l-5-5", "m22 10-7.5 7.5L13 16"], // check-check
  completa: ["M20 6 9 17l-5-5"], // check
  borrar: ["M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z",
    "m12 9 6 6", "m18 9-6 6"], // delete
  candado: [{ rect: { width: 18, height: 11, x: 3, y: 11, rx: 2, ry: 2 } }, "M7 11V7a5 5 0 0 1 10 0v4"], // lock
  equipo: ["M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
    { circle: { cx: 12, cy: 12, r: 3 } }], // settings
  escudo: ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
    "m9 12 2 2 4-4"], // shield-check
  etiqueta: ["M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z",
    { circle: { cx: 7.5, cy: 7.5, r: 0.5 } }], // tag
  personas: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", { circle: { cx: 9, cy: 7, r: 4 } }, "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"], // users
  sincronizar: ["M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5", "M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16", "M16 16h5v5"], // refresh-ccw
  mas: ["M5 12h14", "M12 5v14"], // plus
  abierto: [{ rect: { width: 18, height: 11, x: 3, y: 11, rx: 2, ry: 2 } }, "M7 11V7a5 5 0 0 1 9.9-1"], // lock-open
  sinRed: ["M12 20h.01", "M8.5 16.429a5 5 0 0 1 7 0", "M5 12.859a10 10 0 0 1 5.17-2.69", "M19 12.859a10 10 0 0 0-2.007-1.523",
    "M2 8.82a15 15 0 0 1 4.177-2.643", "M22 8.82a15 15 0 0 0-11.288-3.764", "m2 2 20 20"], // wifi-off
};

// Devuelve un <svg> decorativo: el significado siempre lo da el texto que lo acompaña.
export function icono(nombre, clase = "icono") {
  const svg = document.createElementNS(SVG, "svg");
  for (const [atributo, valor] of Object.entries({ class: clase, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) {
    svg.setAttribute(atributo, valor);
  }
  for (const trazo of TRAZOS[nombre] ?? []) {
    const [etiqueta, atributos] = typeof trazo === "string" ? ["path", { d: trazo }] : Object.entries(trazo)[0];
    const parte = document.createElementNS(SVG, etiqueta);
    for (const [atributo, valor] of Object.entries(atributos)) parte.setAttribute(atributo, valor);
    svg.append(parte);
  }
  return svg;
}
