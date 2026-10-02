import test from "node:test";
import assert from "node:assert/strict";
import { crearApi, ErrorApi } from "../ui/js/api.js";
import { crearColaLecturas } from "../ui/js/lecturas.js";
import { nuevoUuid } from "../ui/js/uuid.js";
import { HORAS_EN_LISTA, sigueEnLista, textosPreparado } from "../ui/js/preparados.js";
import { estadoDatos, estadoOperador, puedeSerUnidad, quienConfirmo, textoCambio, textoRevision, textoSinEntrega, textoUnidad } from "../ui/js/supervisor.js";

const sinEspera = async () => {};
const temporal = () => new ErrorApi({ mensaje: "Sin conexión con el servidor", temporal: true });

test("uuid: formato v4 válido para operacionId y distinto en cada lectura", () => {
  const a = nuevoUuid(), b = nuevoUuid();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, b);
});

test("api: envía la sesión del operador, arma rutas y normaliza los dos formatos de error", async () => {
  const pedidos = [];
  const respuestas = [
    Response.json({ data: [], siguienteCursor: null }),
    Response.json({ error: "Ese producto no pertenece a este pedido" }, { status: 409 }),
    Response.json({ error: { code: "PEDIDO_NO_ENCONTRADO", message: "Pedido no encontrado" } }, { status: 404 }),
    new Response("sin json", { status: 503 }),
  ];
  const api = crearApi({ token: "token-sesion", fetchImpl: async (url, opciones) => { pedidos.push([url, opciones]); return respuestas.shift(); } });
  await api.pedidos(15);
  assert.equal(pedidos[0][0], "/pedidos?estado=abiertos&limit=25&cursor=15");
  assert.equal(pedidos[0][1].headers.Authorization, "Bearer token-sesion");
  assert.equal(pedidos[0][1].headers["X-API-Key"], undefined);
  await assert.rejects(api.escanear(7, "740", "uuid"), (e) => e instanceof ErrorApi && e.status === 409 && e.mensaje === "Ese producto no pertenece a este pedido" && !e.temporal);
  assert.deepEqual(JSON.parse(pedidos[1][1].body), { codigo: "740", operacionId: "uuid" });
  await assert.rejects(api.pedido(9), (e) => e.codigo === "PEDIDO_NO_ENCONTRADO" && e.mensaje === "Pedido no encontrado");
  await assert.rejects(api.sesion(1), (e) => e.status === 503 && e.temporal === true);
});

test("api: sin red o sin respuesta a tiempo es un error temporal", async () => {
  const sinRed = crearApi({ token: "x", fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(sinRed.pedidos(), (e) => e.temporal === true && e.status === 0);
  const lenta = crearApi({ token: "x", tiempoMs: 20, fetchImpl: (_url, { signal }) => new Promise((_r, rechazar) => signal.addEventListener("abort", () => rechazar(new Error("abortado")))) });
  await assert.rejects(lenta.pedidos(), (e) => e.temporal === true);
});

test("cola: envía en orden, de a una, y conserva el operacionId en los reintentos", async () => {
  const enviados = []; let fallar = 2; let enVuelo = 0, maxEnVuelo = 0;
  const cola = crearColaLecturas({ esperar: sinEspera, enviar: async (l) => {
    enVuelo++; maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
    await new Promise((r) => setTimeout(r, 1));
    enVuelo--; enviados.push([l.codigo, l.operacionId]);
    if (l.codigo === "A" && fallar-- > 0) throw temporal();
    return { data: l.codigo };
  } });
  const a = cola.agregar("A"); const b = cola.agregar("B"); cola.agregar("C");
  await cola.procesar();
  assert.deepEqual(enviados.map(([c]) => c), ["A", "A", "A", "B", "C"]);
  assert.ok(enviados.filter(([c]) => c === "A").every(([, op]) => op === a.operacionId));
  assert.notEqual(a.operacionId, b.operacionId);
  assert.equal(maxEnVuelo, 1);
  assert.equal(cola.pendientes, 0);
});

test("cola: una lectura rechazada se descarta y la siguiente continúa", async () => {
  const eventos = [];
  const cola = crearColaLecturas({ esperar: sinEspera, alCambiar: (e) => eventos.push(e.tipo),
    enviar: async (l) => { if (l.codigo === "MAL") throw new ErrorApi({ status: 409, mensaje: "no" }); return { data: 1 }; } });
  cola.agregar("MAL"); cola.agregar("BIEN");
  await cola.procesar();
  assert.deepEqual(eventos.filter((t) => ["aceptada", "rechazada"].includes(t)), ["rechazada", "aceptada"]);
});

test("cola: sin conexión persistente se detiene, guarda las lecturas y las reanuda sin duplicar", async () => {
  let guardado = []; let conectado = false; const recibidos = new Map();
  const enviar = async (l) => {
    if (!conectado) throw temporal();
    recibidos.set(l.operacionId, (recibidos.get(l.operacionId) ?? 0) + 1);
    return { data: l.codigo };
  };
  const cola = crearColaLecturas({ esperar: sinEspera, reintentos: 2, enviar, guardar: (p) => { guardado = p; } });
  const a = cola.agregar("A"); cola.agregar("B");
  await cola.procesar();
  assert.equal(cola.detenida, true);
  assert.deepEqual(guardado.map((l) => l.codigo), ["A", "B"]);
  assert.equal(guardado[0].operacionId, a.operacionId);
  // Se recarga la página: una cola nueva retoma las lecturas guardadas con sus mismos operacionId.
  conectado = true;
  const nueva = crearColaLecturas({ esperar: sinEspera, enviar, guardar: (p) => { guardado = p; }, pendientes: guardado });
  await nueva.procesar();
  assert.deepEqual([...recibidos.keys()][0], a.operacionId);
  assert.deepEqual([...recibidos.values()], [1, 1]);
  assert.deepEqual(guardado, []);
});

test("cola: una sesión vencida detiene la cola sin perder la lectura", async () => {
  const cola = crearColaLecturas({ esperar: sinEspera, enviar: async () => { throw new ErrorApi({ status: 401, mensaje: "sesión vencida" }); } });
  cola.agregar("A");
  await cola.procesar();
  assert.equal(cola.detenida, true);
  assert.equal(cola.pendientes, 1);
});

test("api: usa la dirección del servidor como base", async () => {
  const urls = [];
  const envios = [];
  const api = crearApi({ token: "t", base: "https://bodega.ejemplo.com", fetchImpl: async (url, opciones) => {
    urls.push(url); envios.push(opciones); return Response.json({ data: [], siguienteCursor: null }); } });
  await api.pedidos();
  assert.equal(urls[0], "https://bodega.ejemplo.com/pedidos?estado=abiertos&limit=25");
  // Al iniciar una preparación no se manda el preparador: lo pone el servidor desde la sesión.
  await api.iniciar(9);
  assert.deepEqual(JSON.parse(envios[1].body), { pedidoDocEntry: 9 });
  await api.cerrarSesion();
  assert.deepEqual([urls[2], envios[2].method], ["https://bodega.ejemplo.com/ingreso/sesion", "DELETE"]);
});

test("preparados: estado, quién y cuándo, unidades y salida de la lista a las 24 h", () => {
  const ahora = new Date(2026, 8, 30, 12, 0).getTime();
  const hoy = textosPreparado({ estado: "completo", operador: "Ana López", fechaFin: new Date(2026, 8, 30, 9, 15).toISOString(),
    unidadesPreparadas: 14, unidadesPedidas: 14 }, ahora);
  assert.equal(hoy.completo, true);
  assert.equal(hoy.estado, "Preparado");
  assert.match(hoy.quien, /^Preparado por Ana López · 9:15/);
  assert.equal(hoy.unidades, "14 de 14 unidades");

  const ayer = textosPreparado({ estado: "con_diferencias", operador: "Luis Pérez", fechaFin: new Date(2026, 8, 29, 13, 48).toISOString(),
    unidadesPreparadas: 9, unidadesPedidas: 11 }, ahora);
  assert.equal(ayer.completo, false);
  assert.equal(ayer.estado, "Preparado con diferencias");
  assert.match(ayer.quien, /^Preparado por Luis Pérez · ayer 1:48/);
  assert.equal(ayer.unidades, "9 de 11 unidades · faltaron 2");

  const hora = 3_600_000;
  const base = { estado: "con_diferencias", operador: null, unidadesPreparadas: 5, unidadesPedidas: 6 };
  assert.equal(HORAS_EN_LISTA, 24);
  assert.equal(sigueEnLista({ ...base, fechaFin: new Date(ahora - 24 * hora + 1000).toISOString() }, ahora), true, "le falta 1 s");
  assert.equal(sigueEnLista({ ...base, fechaFin: new Date(ahora - 24 * hora).toISOString() }, ahora), false, "cumplió 24 h");
  assert.equal(sigueEnLista({ ...base, fechaFin: new Date(ahora - 75 * hora).toISOString() }, ahora), false);
  assert.equal(sigueEnLista({ ...base, estado: "completo", fechaFin: new Date(ahora - 30 * hora).toISOString() }, ahora), false, "también los completos");
  assert.equal(sigueEnLista({ ...base, fechaFin: null }, ahora), true, "sin hora de fin no vence");
  const sinDatos = textosPreparado({ ...base, fechaFin: null }, ahora);
  assert.equal(sinDatos.quien, "");
  assert.equal(sinDatos.unidades, "5 de 6 unidades · faltó 1");
  assert.equal("aviso" in sinDatos, false, "ya no hay aviso de entrega en la lista");
  assert.equal(textosPreparado({ ...base, unidadesPreparadas: 1, unidadesPedidas: 1, fechaFin: null }, ahora).unidades, "1 de 1 unidad");
});

test("supervisor: estado de los datos de SAP (pedidos 1 h, resto 24 h)", () => {
  const ahora = Date.parse("2026-10-02T12:00:00Z");
  const hace = (min) => new Date(ahora - min * 60000).toISOString();
  assert.equal(estadoDatos({ entidad: "pedidos", ultimaRecepcion: hace(59) }, ahora).tipo, "ok");
  assert.deepEqual(estadoDatos({ entidad: "pedidos", ultimaRecepcion: hace(61) }, ahora), { tipo: "alerta", texto: "Más de 1 h sin datos" });
  assert.equal(estadoDatos({ entidad: "clientes", ultimaRecepcion: hace(23 * 60) }, ahora).tipo, "ok");
  assert.deepEqual(estadoDatos({ entidad: "codigosBarras", ultimaRecepcion: hace(25 * 60) }, ahora), { tipo: "alerta", texto: "Más de 24 h sin datos" });
  assert.equal(estadoDatos({ entidad: "unidades", ultimaRecepcion: null }, ahora).tipo, "sin_datos");
});

test("supervisor: unidad de una etiqueta, Manual se puede confirmar y quién confirmó", () => {
  assert.equal(textoUnidad({ unidad: { code: "CJ6", nombre: "Caja de 6" }, uomEntry: 3 }), "CJ6 · Caja de 6");
  assert.equal(textoUnidad({ unidad: null, uomEntry: -1 }), "Manual (unidad del artículo)");
  assert.equal(textoUnidad({ unidad: null, uomEntry: null }), "Sin unidad en SAP");
  assert.deepEqual([-1, 0, 5, null, -2, undefined].map((uomEntry) => puedeSerUnidad({ uomEntry })), [true, true, true, false, false, false]);
  assert.equal(quienConfirmo("operador:Carmen Díaz"), "Carmen Díaz");
  assert.equal(quienConfirmo("supervisor-etiquetas"), "supervisor-etiquetas");
  assert.equal(quienConfirmo(null), "otra aplicación");
});

test("supervisor: estado de cada operador", () => {
  assert.deepEqual(estadoOperador({ estado: "activo", intentosFallidos: 0 }), { tipo: "ok", texto: "Activo", detalle: "" });
  assert.equal(estadoOperador({ estado: "bloqueado", intentosFallidos: 10 }).detalle, "10 PIN incorrectos seguidos");
  const pausa = estadoOperador({ estado: "pausa", intentosFallidos: 5, pausaHasta: new Date(2026, 9, 2, 10, 42).toISOString() });
  assert.equal(pausa.tipo, "alerta"); assert.match(pausa.texto, /^En pausa hasta 10:42/);
  assert.equal(estadoOperador({ estado: "inactivo" }).texto, "Inactivo");
});

test("supervisor: textos de revisiones", () => {
  const base = { unidadesPreparadas: 5, unidadesPedidas: 14 };
  assert.equal(textoRevision({ ...base, motivo: "CAMBIOS_EN_SAP", operador: "Ana López" }),
    "SAP cambió el pedido mientras Ana López lo preparaba (llevaba 5 de 14 unidades).");
  assert.equal(textoRevision({ ...base, motivo: "CAMBIOS_EN_SAP", operador: null }), "SAP cambió el pedido mientras se preparaba (llevaba 5 de 14 unidades).");
  assert.equal(textoRevision({ ...base, motivo: "PEDIDO_CERRADO", mensaje: "El pedido está cerrado" }), "El pedido está cerrado");
  assert.equal(textoCambio({ antes: 2, ahora: null }), "Quitado del pedido");
  assert.equal(textoCambio({ antes: null, ahora: 5 }), "Agregado: 5");
  assert.equal(textoCambio({ antes: 4, ahora: 6 }), "6");
  assert.equal(textoSinEntrega(26), "26 h");
  assert.equal(textoSinEntrega(75), "3 días");
});

import { PATRONES, simbolos, anchos, barras, MARGEN } from "../ui/js/code128.js";
import { ESTADOS, armarAsignaciones, armarConteo, armarLotesDespacho, cantidadMovimiento, diasParaVencer, esCodigoCaja, finDeMes, nombreOpcion,
  opcionesDescuento, quien, resumenRecepcion, revisarDespacho, sugerirAsignacion, textoAsignacion, textoDocumento, textoEstado, textoMovimiento,
  textoPorVencer, textoVencimiento, unidadesPorProducto } from "../ui/js/inventario.js";
import { crearOperacion } from "../ui/js/operaciones.js";

test("code128: cada símbolo mide 11 módulos (el fin 13), sin repetidos, y el dígito de control es el del estándar", () => {
  assert.equal(PATRONES.length, 107);
  PATRONES.forEach((p, i) => assert.equal([...p].reduce((s, n) => s + Number(n), 0), i === 106 ? 13 : 11, `símbolo ${i}`));
  assert.equal(new Set(PATRONES).size, 107);
  // Inicio B (104), los caracteres y el control: (104 + Σ valor × posición) mod 103.
  assert.deepEqual(simbolos("CJ-1"), [104, 35, 42, 13, 17, 21, 106]);
  const { barras: lista, modulos } = barras("CJ-000123");
  assert.equal(modulos, MARGEN * 2 + (1 + 9 + 1) * 11 + 13);
  assert.equal(lista[0].x, MARGEN);
  assert.equal(anchos("CJ-000123").length, (1 + 9 + 1) * 6 + 7);
  assert.throws(() => simbolos("ñ"), /letras, números/);
  assert.throws(() => simbolos(""), /letras, números/);
});

test("inventario: vencimiento por mes y año, días para vencer y código de caja", () => {
  assert.equal(finDeMes("2027-02"), "2027-02-28");
  assert.equal(finDeMes("2028-02"), "2028-02-29");
  assert.equal(finDeMes("2027-13"), null);
  assert.equal(textoVencimiento("2027-03-31"), "03/2027");
  assert.equal(textoVencimiento("2027-03-15"), "15/3/2027");
  assert.equal(textoVencimiento(null), "Sin vencimiento");
  assert.equal(diasParaVencer("2026-10-11", new Date(2026, 9, 1, 23, 50)), 10);
  assert.equal(diasParaVencer("2026-09-30", new Date(2026, 9, 1)), -1);
  assert.ok(esCodigoCaja(" cj-000123 ") && !esCodigoCaja("7401234567890") && !esCodigoCaja("CJ-12"));
});

test("inventario: textos del estado frente a SAP, movimientos y documentos", () => {
  assert.equal(ESTADOS.por_descontar.tipo, "alerta");
  assert.equal(textoEstado({ estado: "por_ubicar", diferencia: 100, faltaEnSap: 0 }), "SAP tiene 100 unidades que todavía no se ubicaron.");
  assert.equal(textoEstado({ estado: "por_descontar", diferencia: -1, faltaEnSap: 0 }), "SAP descontó 1 unidad: falta elegir de qué lote salieron.");
  assert.equal(textoEstado({ estado: "al_dia", diferencia: 0, faltaEnSap: 20 }), "Cuadra. 20 unidades se recibieron antes que SAP las registre.");
  // Sin comparación con SAP (sin almacenes o sin existencias recientes) no hay estado, y no significa cero.
  assert.match(textoEstado(null), /Sin comparación con SAP/);
  assert.match(textoEstado({ estado: "sin_comparacion_sap", diferencia: null }), /funciona igual/);
  assert.equal(ESTADOS.sin_comparacion_sap.tipo, "gris");
  assert.equal(cantidadMovimiento({ tipo: "conteo", grande: 0, pequena: 0, cajas: 0 }), "No cambia el total");
  assert.equal(cantidadMovimiento({ tipo: "conteo", grande: 0, pequena: -3, cajas: 0 }), "-3 u.");
  assert.equal(textoMovimiento({ tipo: "picking", docNum: 91004 }), "Salida por pedido 91004");
  assert.equal(cantidadMovimiento({ tipo: "reposicion", grande: -24, pequena: 24 }), "24 u. a la pequeña");
  assert.equal(cantidadMovimiento({ tipo: "recepcion", grande: 1000, pequena: 0, cajas: 50 }), "50 cajas · 1,000 u.");
  assert.equal(cantidadMovimiento({ tipo: "picking", grande: 0, pequena: -6, cajas: 0 }), "-6 u.");
  assert.equal(cantidadMovimiento({ tipo: "reasignacion", grande: 20, pequena: -20, cajas: 1 }), "No cambia el total");
  assert.equal(textoPorVencer({ vencidos: 1, proximos: 0 }), "1 lote vencido");
  assert.equal(textoPorVencer({ vencidos: 2, proximos: 1 }), "2 lotes vencidos y 1 vence en 60 días");
  assert.equal(textoPorVencer({ vencidos: 0, proximos: 0 }), "ningún lote vence en 60 días");
  assert.equal(quien("operador:Ana López"), "Ana López");
  assert.equal(textoDocumento({ tipo: "salidaInventario", docNum: 1377 }), "Salida de mercancías 1377");
});

test("inventario: resumen de una recepción en cajas o suelta", () => {
  assert.deepEqual(resumenRecepcion({ modo: "cajas", cajas: 5, unidadesPorCaja: 20, lote: "L2410-033" }),
    { total: 100, texto: "Entran 5 cajas · 100 unidades del lote L2410-033 a la bodega grande." });
  assert.equal(resumenRecepcion({ modo: "suelto", unidades: 1, destino: "pequena" }).texto, "Entran 1 unidad sueltas a la bodega pequeña.");
  assert.equal(resumenRecepcion({ modo: "cajas", cajas: 0, unidadesPorCaja: 20 }).total, 0);
});

test("inventario: opciones para descontar, grande y después pequeña por lote, vencidos primero; propuesta y validación", () => {
  const hoy = new Date(2026, 9, 1);
  const producto = { pequena: 30, lotes: [
    { lote: "L2409-118", vencimiento: "2027-03-31", unidades: 180, cajas: [{}, {}] },
    { lote: "L2408-090", vencimiento: "2026-09-30", unidades: 100, cajas: [{}] },
    { lote: null, vencimiento: null, unidades: 4, cajas: [{}] },
  ], lotesPequena: [
    { id: 8, lote: null, vencimiento: null, unidades: 10 },
    { id: 7, lote: "L2409-118", vencimiento: "2027-03-31T00:00:00.000Z", unidades: 20 },
    { id: 9, lote: "L0", vencimiento: null, unidades: 0 },
  ] };
  const opciones = opcionesDescuento(producto, [], hoy);
  assert.deepEqual(opciones.map((o) => [o.clave, o.unidades, o.vencido]),
    [["lote:L2408-090", 100, true], ["lote:L2409-118", 180, false], ["lote:", 4, false], ["pequena:7", 20, false], ["pequena:8", 10, false]]);
  assert.equal(opciones[3].vencimiento, "2027-03-31");
  assert.deepEqual(opciones.map(nombreOpcion), ["Lote L2408-090", "Lote L2409-118", "Lote sin lote", "Pequeña · lote L2409-118", "Pequeña · sin lote"]);
  const propuesta = sugerirAsignacion(opciones, 120);
  assert.deepEqual(propuesta, { "lote:L2408-090": 100, "lote:L2409-118": 20, "lote:": 0, "pequena:7": 0, "pequena:8": 0 });
  assert.deepEqual(armarAsignaciones(opciones, propuesta, 120).asignaciones,
    [{ tipo: "lote", lote: "L2408-090", unidades: 100 }, { tipo: "lote", lote: "L2409-118", unidades: 20 }]);
  // Lo que sale de la pequeña va en una sola asignación, con el detalle de cada lote.
  const conPequena = armarAsignaciones(opciones, { "lote:": 4, "pequena:7": 20, "pequena:8": 6 }, 30);
  assert.deepEqual(conPequena.asignaciones, [{ tipo: "lote", lote: null, unidades: 4 },
    { tipo: "pequena", unidades: 26, lotes: [{ pequenaLoteId: 7, unidades: 20 }, { pequenaLoteId: 8, unidades: 6 }] }]);
  assert.equal(conPequena.texto, "Lote sin lote: 4 · Pequeña · lote L2409-118: 20 · Pequeña · sin lote: 6");
  assert.match(armarAsignaciones(opciones, { ...propuesta, "pequena:8": 5 }, 120).problema, /Asignaste 125 de 120/);
  assert.match(armarAsignaciones(opciones, { "pequena:8": 11 }, 11).problema, /Pequeña · sin lote tiene 10 unidades/);
  assert.match(armarAsignaciones(opciones, { "lote:L2408-090": 1.5 }, 1.5).problema, /enteros/);
  // Cambiar el lote: lo que el descuento ya restó vuelve a estar disponible, aunque el lote haya quedado vacío.
  const cambio = opcionesDescuento({ pequena: 0, lotes: [], lotesPequena: [] }, [{ tipo: "lote", lote: "L1", unidades: 35 },
    { tipo: "pequena", unidades: 5, lotesPequena: [{ pequenaLoteId: 3, lote: "L1", unidades: 5 }] }], hoy);
  assert.deepEqual(cambio.map((o) => [o.clave, o.unidades, o.pequenaLoteId ?? null]), [["lote:L1", 35, null], ["pequena:3", 5, 3]]);
  assert.equal(textoAsignacion([{ tipo: "lote", lote: "L1", unidades: 1000 }, { tipo: "pequena", unidades: 5 }]), "L1: 1,000 · pequeña: 5");
  assert.equal(textoAsignacion([{ tipo: "pequena", unidades: 5, lotesPequena: [{ lote: "L1", unidades: 3 }, { lote: null, unidades: 2 }] }]),
    "pequeña L1: 3 · pequeña sin lote: 2");
});

test("inventario: conteo de la pequeña por lote", () => {
  assert.deepEqual(armarConteo([{ lote: "L1", vencimiento: "2027-03-31", unidades: 12 }, { lote: null, vencimiento: null, unidades: 0 }]),
    { unidades: 12, lotes: [{ lote: "L1", vencimiento: "2027-03-31", unidades: 12 }, { lote: null, vencimiento: null, unidades: 0 }] });
  assert.deepEqual(armarConteo([]), { unidades: 0, lotes: [] });
  assert.match(armarConteo([{ lote: "L1", unidades: 1 }, { lote: "L1", vencimiento: null, unidades: 2 }]).problema, /L1 está repetido/);
  assert.match(armarConteo([{ lote: "L1", unidades: -1 }]).problema, /enteros/);
  // Mismo lote con otro vencimiento es otra fila.
  assert.equal(armarConteo([{ lote: "L1", vencimiento: "2027-01-31", unidades: 1 }, { lote: "L1", vencimiento: "2027-02-28", unidades: 1 }]).unidades, 2);
});

test("inventario: al finalizar, faltantes en la pequeña y elección de lotes", () => {
  const porProducto = unidadesPorProducto([{ itemCode: "A", cantidadEscaneada: 4 }, { itemCode: "B", cantidadEscaneada: 0 },
    { itemCode: "A", cantidadEscaneada: 2 }, { itemCode: "C", cantidadEscaneada: 3 }, { itemCode: "D", cantidadEscaneada: 1 }]);
  assert.deepEqual([...porProducto], [["A", 6], ["C", 3], ["D", 1]]);
  const fichas = new Map([
    ["A", { itemName: "Alfa", lotesPequena: [{ id: 1, lote: "L1", unidades: 4 }, { id: 2, lote: null, unidades: 5 }, { id: 3, lote: "L0", unidades: 0 }] }],
    ["C", { itemName: "Ce", lotesPequena: [{ id: 4, lote: "L4", unidades: 2 }] }],
    ["D", { itemName: "De", lotesPequena: [{ id: 5, lote: "L5", unidades: 9 }] }],
  ]);
  const { faltantes, elegir } = revisarDespacho(porProducto, fichas);
  assert.deepEqual(faltantes, [{ itemCode: "C", itemName: "Ce", hay: 2, necesarias: 3 }]);
  // Un solo lote lo elige el servidor; con varios, la persona indica de cuál salió.
  assert.deepEqual(elegir.map((p) => [p.itemCode, p.necesarias, p.lotes.map((l) => l.id)]), [["A", 6, [1, 2]]]);
  assert.deepEqual(armarLotesDespacho(elegir, { A: { 1: 4, 2: 2 } }), { lotes: [{ itemCode: "A", lotes: [{ pequenaLoteId: 1, unidades: 4 }, { pequenaLoteId: 2, unidades: 2 }] }] });
  assert.deepEqual(armarLotesDespacho(elegir, { A: { 1: 1, 2: 5 } }), { lotes: [{ itemCode: "A", lotes: [{ pequenaLoteId: 1, unidades: 1 }, { pequenaLoteId: 2, unidades: 5 }] }] });
  assert.match(armarLotesDespacho(elegir, { A: { 2: 6 } }).problema, /en «Sin lote» hay 5 unidades/);
  assert.match(armarLotesDespacho(elegir, { A: { 1: 4 } }).problema, /Alfa: asignaste 4 de 6/);
  assert.match(armarLotesDespacho(elegir, { A: { 1: 6 } }).problema, /en el lote L1 hay 4 unidades/);
  assert.match(armarLotesDespacho(elegir, { A: { 1: 5.5, 2: 0.5 } }).problema, /enteros/);
  // Sin ficha (producto que no está en el inventario) es un faltante.
  assert.deepEqual(revisarDespacho(new Map([["Z", 1]]), new Map()).faltantes, [{ itemCode: "Z", itemName: "Z", hay: 0, necesarias: 1 }]);
});

test("operaciones: el mismo contenido reusa el operacionId hasta terminar; otro contenido usa uno nuevo", () => {
  let n = 0;
  const operacion = crearOperacion(() => `uuid-${++n}`);
  assert.deepEqual(operacion.para({ caja: "CJ-000001", unidades: 5 }), { operacionId: "uuid-1", caja: "CJ-000001", unidades: 5 });
  // Reintento después de una falla temporal: misma operación, el servidor no la repite.
  assert.equal(operacion.para({ caja: "CJ-000001", unidades: 5 }).operacionId, "uuid-1");
  // Cambió lo que se manda: otra operación (el servidor rechazaría el mismo id con otro contenido).
  assert.equal(operacion.para({ caja: "CJ-000001", unidades: 6 }).operacionId, "uuid-2");
  operacion.terminar();
  assert.equal(operacion.para({ caja: "CJ-000001", unidades: 6 }).operacionId, "uuid-3");
  assert.match(crearOperacion().para({}).operacionId, /^[0-9a-f-]{36}$/);
});

test("api: cuerpos de finalizar, confirmación masiva y operaciones del inventario", async () => {
  const pedidos = [];
  const api = crearApi({ token: "t", fetchImpl: async (url, opciones) => { pedidos.push([url, opciones.method, opciones.body && JSON.parse(opciones.body)]); return Response.json({ data: {} }); } });
  await api.finalizar(5);
  await api.finalizar(6, [{ itemCode: "A", lotes: [{ pequenaLoteId: 1, unidades: 2 }] }]);
  await api.confirmarManual(3, "a".repeat(64));
  await api.reponer({ operacionId: "u1", caja: "CJ-000001", unidades: 2 });
  await api.contarPequena("A/1", { operacionId: "u2", unidades: 0, lotes: [] });
  await api.corregirCaja(9, { operacionId: "u3", unidades: 4 });
  await api.cambiarLote(4, { operacionId: "u4", asignaciones: [] });
  assert.deepEqual(pedidos, [
    ["/picking/5/finalizar", "POST", { lotes: [] }],
    ["/picking/6/finalizar", "POST", { lotes: [{ itemCode: "A", lotes: [{ pequenaLoteId: 1, unidades: 2 }] }] }],
    ["/supervisor/etiquetas/confirmacion-manual", "POST", { cantidadEsperada: 3, versionEsperada: "a".repeat(64) }],
    ["/inventario/reposiciones", "POST", { operacionId: "u1", caja: "CJ-000001", unidades: 2 }],
    ["/inventario/productos/A%2F1/pequena", "PUT", { operacionId: "u2", unidades: 0, lotes: [] }],
    ["/inventario/cajas/9/unidades", "PUT", { operacionId: "u3", unidades: 4 }],
    ["/inventario/descuentos/4/reasignacion", "POST", { operacionId: "u4", asignaciones: [] }],
  ]);
});
