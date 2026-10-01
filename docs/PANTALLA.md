# La pantalla de bodega

Pantalla para quien prepara los pedidos. Vive en `ui/` y la app de escritorio la muestra en su ventana. Todos los datos se piden al backend con la sesión del operador que ingresó.

## Qué hace

1. **Ingreso**: "¿Quién va a preparar?" muestra los nombres de los operadores activos. Cada uno toca su nombre y escribe su PIN de 4 números en el teclado de la pantalla o en el de la PC. La sesión dura el turno; **Menú → Cambiar de operador** la cierra.
2. **Pedidos abiertos**: número, cliente, fechas y hace cuánto llegaron los datos de SAP. Buscador por número o cliente.
   - Con la lista abierta, se vuelve a pedir sola cada 5 minutos, sin perder lo escrito en el buscador. **Actualizar** la pide en el momento.
   - Debajo del título: a qué hora se actualizó la lista y hace cuánto llegaron los últimos datos de SAP. Si los datos de SAP tienen más de 1 hora (por ejemplo, el puente no está corriendo), se muestran en ámbar con ícono de alerta. Si no hay conexión, avisa "No se pudo actualizar" y deja la lista anterior hasta el próximo intento.
   - Los pedidos ya preparados quedan abajo, en la sección **Preparados**: en verde ("Preparado") o en ámbar ("Preparado con diferencias"), con quién lo preparó, a qué hora y cuántas unidades. Tocarlos abre su resumen; no se puede empezar otra preparación.
   - Salen de la lista cuando SAP registra la entrega y cierra el pedido, o 24 horas después de prepararse, lo que pase primero. Con la lista abierta salen solos al cumplir las 24 horas. Si SAP todavía no lo cerró, el supervisor lo sigue viendo en su panel (**Revisiones → Preparados sin entrega en SAP**), con su resumen.
3. **Detalle del pedido**: productos y cantidades pendientes. Si el pedido no se puede preparar (cerrado, cancelado, sin unidad de medida, etc.), lo explica y no deja empezar. La unidad **Manual** de SAP (la que usa Cosprobell) cuenta como la unidad del artículo: cada lectura de un código confirmado como unidad suma 1.
4. **Escaneo**: el panel del lector queda a la izquierda y las líneas a la derecha. Cada lectura responde en grande, en verde con ícono de aceptada (producto y cuántas lleva) o en rojo con ícono de rechazada (motivo), con sonido distinto. Las líneas pendientes quedan arriba; las completas, en verde al final.
5. **Ver lecturas**: historial de la preparación (aceptadas y rechazadas).
6. **Finalizar**: si faltan productos, muestra cuáles y pide confirmar "Finalizar con diferencias". Al terminar, un resumen con estado, unidades preparadas, líneas completas, operador y horas de inicio y fin.

Si se sale de una preparación sin finalizarla, la lista ofrece **Continuar** donde quedó.

Si SAP cambia el pedido mientras se prepara, la preparación queda **en revisión**: la pantalla deja de aceptar lecturas y pide avisar al supervisor. Cuando el supervisor la reinicia desde su panel, quien la tenía abierta ve "El supervisor reinició la preparación del pedido N…" y la empieza de nuevo desde la lista, con el pedido actual.

## Panel del supervisor

Solo para quien ingresó con rol supervisor (**Menú → Panel del supervisor**). Cuatro pestañas, cada una con un número de lo que espera atención:

- **Etiquetas**: códigos de barras por confirmar como unidad. Los de unidad Manual se confirman todos juntos; si mientras tanto llega uno nuevo, el servidor lo rechaza y la pantalla pide revisar otra vez. Buscador que acepta una lectura del lector y filtro **Cambiaron en SAP**.
- **Operadores**: agregar, cambiar PIN (con repetición y aviso de PIN fácil), desbloquear, desactivar y activar.
- **Revisiones**: preparaciones en revisión con lo que cambió en SAP (antes y ahora) y **Reiniciar con los datos nuevos**; finalizados con diferencias de las últimas 24 h; preparados sin entrega en SAP hace más de 24 h. Desde cada uno se ven las lecturas o el resumen.
- **Sincronización**: última recepción y cantidad de registros por tipo de dato de SAP. Aviso si los pedidos pasan más de 1 h sin datos o el resto más de 24 h.

## El lector de códigos

- Debe funcionar **como teclado** y terminar cada lectura con **Enter**.
- El campo de lectura tiene siempre el foco; si se toca un botón, vuelve solo. El panel indica **"Listo para leer"** cuando el campo tiene el foco y **"Tocá el campo para leer"** cuando no.
- En un equipo táctil aparece un botón de teclado para escribir un código a mano; con mouse y teclado físico no hace falta.

## Sin conexión y reintentos

- Cada lectura recibe un identificador propio (operacionId) al escanearse. Si la respuesta no llega, se reintenta con el **mismo** identificador: el servidor no cuenta la unidad dos veces.
- Si la red no vuelve, la pantalla avisa "Sin conexión. N lecturas pendientes" y las guarda en el equipo. Se envían solas al volver la red (o con **Reintentar ahora**), en el mismo orden, incluso si se cerró la app.
- Sin conexión no se pueden consultar pedidos ni empezar preparaciones.

## Diseño

Identidad de Cosprobell en tono formal: morado de referencia (**#362F44**) en la barra y el panel del lector, acciones en violeta **#5B3FA0**, números en letra condensada y códigos en letra monoespaciada.

- **Líneas**: una casilla por unidad (hasta 24) e insignia "Completa" al terminar.
- **Accesibilidad**: verde para lo aceptado, completo o preparado; rojo solo para lo rechazado; ámbar para diferencias y avisos; siempre con ícono y texto; contraste de texto de al menos 4.5:1 (WCAG AA); botones de 48 px o más; foco visible; respeta "reducir movimiento".
- **Letras**: Barlow, Barlow Condensed y JetBrains Mono, en `ui/fuentes/` (SIL OFL 1.1). **Íconos**: Lucide (ISC) en `ui/js/iconos.js`.

## Pendiente (reglas de Cosprobell)

- Cuánto tiempo sin actualizar se acepta: hoy avisa si los datos del pedido tienen más de una hora; los límites del panel se ajustan cuando se definan las frecuencias del puente.
- Quién puede finalizar con diferencias: hoy cualquier equipo con clave puede hacerlo.
