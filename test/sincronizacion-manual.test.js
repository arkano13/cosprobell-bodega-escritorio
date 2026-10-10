import test from "node:test";
import assert from "node:assert/strict";
import { crearApi } from "../ui/js/api.js";
import { crearActualizacionManual, presentacionManual } from "../ui/js/sincronizacion-manual.js";

function preparar(api, extra = {}) {
  let estado, reloj;
  const c = crearActualizacionManual({ api, alCambiar: e => { estado = e; },
    programar: fn => { reloj = fn; return 1; }, cancelar: () => { reloj = null; }, ...extra });
  return { c, estado: () => estado, tick: async () => { const fn = reloj; reloj = null; await fn?.(); }, reloj: () => reloj };
}
const libre = { solicitud: null, entidades: ["productos"], ultimaConexion: "2026-10-07T12:00:00Z" };
const trabajo = estado => ({ id: "uno", estado, entidades: ["productos"], completas: estado === "completado" ? ["productos"] : [] });

test("API usa sesión del supervisor para consultar y solicitar sin credenciales SAP", async () => {
  const llamadas = [];
  const api = crearApi({ token: "sesion", fetchImpl: async (ruta, opciones) => {
    llamadas.push({ ruta, ...opciones }); return Response.json({ data: libre });
  } });
  await api.solicitudSincronizacion(); await api.actualizarTodo();
  assert.deepEqual(llamadas.map(l => [l.ruta, l.method]), [
    ["/supervisor/sincronizacion/solicitud", "GET"], ["/supervisor/sincronizacion/solicitud", "POST"],
  ]);
  assert.equal(llamadas[1].headers.Authorization, "Bearer sesion");
  assert.equal(llamadas[1].body, "{}");
});

test("doble clic envía una sola solicitud y bloquea mientras está pendiente", async () => {
  let resolver, posts = 0;
  const f = preparar({ solicitudSincronizacion: async () => ({ data: libre }), actualizarTodo: () => {
    posts++; return new Promise(r => { resolver = r; });
  } });
  await f.c.iniciar();
  const envio = f.c.solicitar(); await f.c.solicitar();
  assert.equal(posts, 1); assert.equal(presentacionManual(f.estado()).deshabilitado, true);
  resolver({ data: trabajo("pendiente") }); await envio; await f.c.solicitar();
  assert.equal(posts, 1); assert.match(presentacionManual(f.estado()).texto, /Esperando/);
  f.c.detener();
});

test("respuesta perdida no repite POST; consulta y recupera la solicitud creada", async () => {
  let creada = false, posts = 0;
  const f = preparar({ solicitudSincronizacion: async () => ({ data: { ...libre, solicitud: creada ? trabajo("sincronizando") : null } }),
    actualizarTodo: async () => { creada = true; posts++; throw { status: 0, mensaje: "Sin red" }; } });
  await f.c.iniciar(); await f.c.solicitar(); await f.c.solicitar();
  assert.equal(f.estado().incierto, true); assert.equal(posts, 1);
  await f.tick(); assert.equal(f.estado().incierto, false);
  assert.equal(f.estado().datos.solicitud.estado, "sincronizando");
  assert.equal(presentacionManual(f.estado()).deshabilitado, true);
  f.c.detener();
});

test("al completar refresca datos una vez, y al salir cancela el temporizador", async () => {
  let veces = 0;
  const f = preparar({ solicitudSincronizacion: async () => ({ data: { ...libre, solicitud: trabajo("completado") } }) },
    { alCompletar: async () => { veces++; } });
  await f.c.iniciar(); await f.tick(); assert.equal(veces, 1);
  assert.equal(presentacionManual(f.estado()).tipo, "ok");
  f.c.detener(); assert.equal(f.reloj(), null);
});

test("una respuesta tardía tras salir no modifica pantalla ni programa consultas", async () => {
  let resolver, pinturas = 0;
  const f = preparar({ solicitudSincronizacion: () => new Promise(r => { resolver = r; }) }, { alCambiar: () => { pinturas++; } });
  const consulta = f.c.iniciar(); f.c.detener();
  resolver({ data: libre }); await consulta;
  assert.equal(pinturas, 1); assert.equal(f.reloj(), null);
});

test("sesión vencida abandona panel y backend antiguo deja botón deshabilitado", async () => {
  let salidas = 0;
  const f = preparar({ solicitudSincronizacion: async () => { throw { status: 401 }; } }, { alSalir: () => { salidas++; } });
  await f.c.iniciar(); assert.equal(salidas, 1); assert.equal(f.reloj(), null);
  const viejo = preparar({ solicitudSincronizacion: async () => { throw { status: 404 }; } });
  await viejo.c.iniciar();
  assert.match(presentacionManual(viejo.estado()).texto, /actualizar el backend/);
  assert.equal(presentacionManual(viejo.estado()).deshabilitado, true); viejo.c.detener();
});

test("un fallo de lectura conserva el avance, sin anunciar que la sincronización falló", async () => {
  let fallo = false;
  const f = preparar({ solicitudSincronizacion: async () => {
    if (fallo) throw { status: 0 }; return { data: { ...libre, solicitud: trabajo("sincronizando") } };
  } });
  await f.c.iniciar(); fallo = true; await f.tick();
  assert.equal(f.estado().datos.solicitud.estado, "sincronizando");
  assert.equal(presentacionManual(f.estado()).deshabilitado, true); f.c.detener();
});
