# Botón Actualizar todo

Disponible para supervisores en Panel del supervisor → Sincronización.
Solicita al puente un recorrido de todos los datos habilitados y muestra espera,
avance por entidad, finalización o error. La tabla se refresca al completar.

Requiere publicar primero el backend con las rutas
`GET/POST /supervisor/sincronizacion/solicitud` y actualizar el puente para consultar
`POST /integracion/solicitud/consultar` y confirmar `/integracion/solicitud/progreso`.
No requiere migraciones nuevas. El puente debe ejecutar una vez para registrar sus entidades.

El botón no escribe en SAP ni cambia sus frecuencias. Con el disparo del puente cada
cinco minutos, puede esperar ese tiempo antes de iniciar y necesitar varias ejecuciones.
Si el puente está apagado o su sesión Windows se cerró, queda pendiente.

No se reenvía automáticamente una solicitud cuyo resultado se perdió: primero se consulta
el estado. Los clics repetidos comparten el trabajo activo. Las consultas a la pantalla
ocurren cada ocho segundos, solo mientras está abierta, y se detienen al salir.

Validación:

```powershell
npm test
node test/sincronizacion.humo.mjs
```

La prueba de pantalla utiliza Microsoft Edge sin ventana y una API simulada local;
no usa credenciales reales ni consulta SAP/Railway. Genera `dist/actualizacion-manual.png`.

Para distribuir, generar el instalador con el flujo habitual del proyecto. Los cambios
de código locales no actualizan automáticamente las aplicaciones ya instaladas.
