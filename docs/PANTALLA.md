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

Arriba de cada pantalla principal están las secciones **Pedidos**, **Inventario** y, para el supervisor, **Panel del supervisor**. El número junto a Inventario cuenta los productos por ubicar y por descontar.

## Inventario

Dos cuartos: la **bodega grande**, con las cajas de cada lote, y la **bodega pequeña**, con las unidades sueltas que se entregan. SAP manda: la app nunca escribe en SAP. SAP no tiene lotes ni cajas; esos datos existen solo en la app. El inventario compara contra lo que SAP tiene en los almacenes que el supervisor marcó como de esta bodega (**Panel → Almacenes**); hasta que los marque, no se compara ni se puede recibir.

1. **Inicio**: lector (la etiqueta de una caja abre la caja; el código de un producto abre el producto), las acciones **Recibir mercadería**, **Reponer** y **Consultar**, los pendientes (**Por ubicar**, **Por descontar**, **Por vencer**, **Sin contar**), las cifras de cada bodega y los últimos movimientos.
2. **Recibir / Ubicar / Contar**: el mismo formulario. **En cajas**: cantidad de cajas, unidades por caja (sugiere la de la última vez), lote y vencimiento (mes y año, se guarda el último día del mes); cada caja recibe un código **CJ-000123** y se imprime su etiqueta. **Suelto**: a la pequeña, o a la grande como un bulto con etiqueta. Si se recibe más de lo que SAP tiene por ubicar, pregunta **¿Llegó antes que SAP?** y lo anota; cuando SAP lo registra, la diferencia se cierra sola.
3. **Etiquetas**: una por caja, con producto, artículo, lote, vencimiento, unidades, número de caja y fecha, y el código de barras Code 128 de la caja. **Imprimir** abre el diálogo de impresión de Windows y solo salen las etiquetas (90 mm de ancho). Se pueden reimprimir desde la caja.
4. **Reponer**: se escanea la etiqueta de la caja, se escribe cuántas unidades pasan a la pequeña y listo. Si conviene usar antes otra caja (abierta, o de un lote que vence antes), lo avisa.
5. **Producto**: frente a SAP (en SAP, grande, pequeña, preparado sin entregar y la diferencia), la bodega grande por lote con sus cajas, la pequeña, los códigos de barras, los documentos recientes de SAP (entradas, salidas, devoluciones) y los movimientos.
6. **Por descontar**: lo que SAP descontó (salida de mercancías, devolución al proveedor, ajustes) y la bodega todavía no marcó. Se elige de qué lotes salió (la lista empieza por los vencidos y sigue por el que vence antes) o de la pequeña, hasta completar el total exacto. Al confirmar muestra qué cajas sacar del estante. **Descuentos hechos** guarda el historial; el supervisor puede **Cambiar lote** (queda anotado quién, cuándo y cuál era el anterior).
7. **Por vencer**: lotes que vencen en los próximos 30, 60, 90 o 180 días; los vencidos siempre, en rojo.
8. **Sin contar**: productos que SAP tiene y todavía no se cargaron en el inventario (conteo inicial), con buscador.

Reglas:
- **Pedidos**: al finalizar una preparación, lo escaneado sale de la bodega pequeña (solo de productos que ya están en el inventario). Hasta que SAP registra la entrega cuenta como "preparado sin entregar".
- **Cambios recientes en SAP**: después de un cambio de existencias o de la entrega de un pedido preparado, el producto espera 15 minutos antes de avisar ("SAP actualizándose"), porque las existencias y los pedidos llegan en recorridos distintos del puente.
- **No hay "dar de baja"** en la app: lo vencido o dañado se registra primero en SAP y después aparece en Por descontar.
- **Solo el supervisor**: cambiar el lote de un descuento, contar la bodega pequeña y corregir las unidades de una caja. Esas correcciones quedan como diferencia con SAP si no coinciden.

## Panel del supervisor

Solo para quien ingresó con rol supervisor (**Menú → Panel del supervisor** o la sección del mismo nombre). Cinco pestañas, cada una con un número de lo que espera atención:

- **Etiquetas**: códigos de barras por confirmar como unidad. Los de unidad Manual se confirman todos juntos; si mientras tanto llega uno nuevo, el servidor lo rechaza y la pantalla pide revisar otra vez. Buscador que acepta una lectura del lector y filtro **Cambiaron en SAP**.
- **Operadores**: agregar, cambiar PIN (con repetición y aviso de PIN fácil), desbloquear, desactivar y activar.
- **Revisiones**: preparaciones en revisión con lo que cambió en SAP (antes y ahora) y **Reiniciar con los datos nuevos**; finalizados con diferencias de las últimas 24 h; preparados sin entrega en SAP hace más de 24 h. Desde cada uno se ven las lecturas o el resumen.
- **Sincronización**: última recepción y cantidad de registros por tipo de dato de SAP, incluidos almacenes, existencias por almacén y entradas, salidas y devoluciones. Aviso si los pedidos o las existencias pasan más de 1 h sin datos, o el resto más de 24 h.
- **Almacenes**: los almacenes de SAP con cuántos productos, unidades y líneas de pedidos abiertos tiene cada uno. Se marcan los de esta bodega; los que no tienen existencia ni pedidos quedan ocultos detrás de **Mostrar todos**. Opción **En Pedidos, mostrar solo los pedidos que salen de los almacenes marcados**.
- **Registrar un código** (en Etiquetas y en la ficha del producto): se escanea el envase y se elige el producto. Queda con la unidad Manual y confirmado como unidad; si el código ya es de otro producto, lo rechaza. No cambia nada en SAP.

## El lector de códigos

- Debe funcionar **como teclado** y terminar cada lectura con **Enter**.
- El campo de lectura tiene siempre el foco; si se toca un botón, vuelve solo. El panel indica **"Listo para leer"** cuando el campo tiene el foco y **"Tocá el campo para leer"** cuando no.
- En un equipo táctil aparece un botón de teclado para escribir un código a mano; con mouse y teclado físico no hace falta.

## Sin conexión y reintentos

- Cada lectura recibe un identificador propio (operacionId) al escanearse. Si la respuesta no llega, se reintenta con el **mismo** identificador: el servidor no cuenta la unidad dos veces.
- Si la red no vuelve, la pantalla avisa "Sin conexión. N lecturas pendientes" y las guarda en el equipo. Se envían solas al volver la red (o con **Reintentar ahora**), en el mismo orden, incluso si se cerró la app.
- Sin conexión no se pueden consultar pedidos ni empezar preparaciones.

## Impresión de etiquetas

La app imprime con el diálogo de Windows (impresora común o de etiquetas). Cada etiqueta ocupa 90 mm de ancho; el código de barras es Code 128 con su zona en blanco, probado con un decodificador. Si la impresora es de etiquetas, elegir en el diálogo el tamaño de su rollo.

## Diseño

Identidad de Cosprobell en tono formal: morado de referencia (**#362F44**) en la barra y el panel del lector, acciones en violeta **#5B3FA0**, números en letra condensada y códigos en letra monoespaciada.

- **Líneas**: una casilla por unidad (hasta 24) e insignia "Completa" al terminar.
- **Accesibilidad**: verde para lo aceptado, completo o preparado; rojo solo para lo rechazado; ámbar para diferencias y avisos; siempre con ícono y texto; contraste de texto de al menos 4.5:1 (WCAG AA); botones de 48 px o más; foco visible; respeta "reducir movimiento".
- **Letras**: Barlow, Barlow Condensed y JetBrains Mono, en `ui/fuentes/` (SIL OFL 1.1). **Íconos**: Lucide (ISC) en `ui/js/iconos.js`.

## Pendiente (reglas de Cosprobell)

- Cuánto tiempo sin actualizar se acepta: hoy avisa si los datos del pedido tienen más de una hora; los límites del panel se ajustan cuando se definan las frecuencias del puente.
- Quién puede finalizar con diferencias: hoy cualquier equipo con clave puede hacerlo.
