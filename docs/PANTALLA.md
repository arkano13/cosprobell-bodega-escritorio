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
6. **Finalizar**: si faltan productos, muestra cuáles y pide confirmar "Finalizar con diferencias". Lo escaneado sale de la bodega de despacho (la 02), así que antes de cerrar revisa que esté registrado ahí:
   - Si a algún producto no le alcanza lo que hay en la 02, avisa **Falta mercadería en la 02** con cuánto hay y cuánto se necesita, y no finaliza: primero se pasan unidades desde la 01. La preparación queda abierta con lo escaneado.
   - Si un producto tiene más de un lote en la 02, pregunta **¿De qué lote salieron?** y se escribe cuántas unidades se tomaron de cada uno, hasta completar lo escaneado. Con un solo lote no pregunta.
   - Al terminar, un resumen con estado, unidades preparadas, líneas completas, operador y horas de inicio y fin.

Si se sale de una preparación sin finalizarla, la lista ofrece **Continuar** donde quedó.

Si SAP cambia el pedido mientras se prepara, la preparación queda **en revisión**: la pantalla deja de aceptar lecturas y pide avisar al supervisor. Cuando el supervisor la reinicia desde su panel, quien la tenía abierta ve "El supervisor reinició la preparación del pedido N…" y la empieza de nuevo desde la lista, con el pedido actual.

Arriba de cada pantalla principal están las secciones **Pedidos**, **Inventario** y, para el supervisor, **Panel del supervisor**. El número junto a Inventario cuenta los productos en **Falta guardar** y **Falta marcar salida**.

## Inventario

Dos bodegas: la de **cajas completas** (cajas por lote, cada una con su etiqueta) y la de **despacho** (unidades sueltas por lote, de donde salen los pedidos). Cada una se llama como su almacén de SAP, por ejemplo **01 · Principal** y **02 · Despacho** ("la 01", "la 02"); hasta que el supervisor la asigna en **Panel → Almacenes** se ve como "la grande" y "la pequeña". SAP manda: la app nunca escribe en SAP. SAP no tiene lotes ni cajas; esos datos existen solo en la app.

Una palabra por cosa, en toda la app:

| Palabra | Qué es |
| --- | --- |
| **Falta contar** | SAP dice que hay y en esa bodega todavía no se contó. |
| **Falta guardar** | SAP registró una entrada y falta guardarla en la bodega (antes "por ubicar"). |
| **Falta marcar salida** | SAP registró una salida y falta marcar de qué lote salió (antes "por descontar"). |
| **Salidas marcadas** | El historial de salidas ya marcadas (antes "descuentos hechos"). |
| **Traspasos por aceptar** | SAP ya registró un traspaso de la 01 a la 02 (solo la cantidad) y falta aceptar de qué lotes salió. |
| **Cuadra con SAP** | Lo de las dos bodegas coincide con SAP. |

**Sin datos recientes de SAP**: si faltan los almacenes o el puente no mandó almacenes y existencias en los últimos 30 minutos, el indicador de SAP queda en gris (la falta de datos no significa cero). Recibir, pasar, contar, consultar, por vencer y las salidas marcadas funcionan igual; **Falta guardar** y **Falta marcar salida** muestran "—" hasta que vuelvan los datos.

1. **Inicio**, siempre con el mismo orden (nada aparece ni desaparece según los datos; lo que no se puede calcular muestra "—"):
   - Arriba a la derecha, el **indicador de SAP**: "SAP al día · existencias hace 5 min" en verde, "Sin datos recientes de SAP" en gris o "SAP sin configurar" (con **Elegir** para el supervisor).
   - **Puesta en marcha** (solo el supervisor): los pasos para dejar el inventario funcionando, con su avance: marcar los almacenes, elegir cuál es cada bodega, confirmar los códigos de barras (cuántos faltan) y contar la 01 y la 02. Cada paso pendiente tiene **Hacer**. Desaparece cuando están todos listos.
   - El **lector**: la etiqueta de una caja abre la caja; el código de un producto abre el producto.
   - **Hoy**: **Falta contar**, **Falta guardar**, **Traspasos por aceptar**, **Falta marcar salida** y **Por vencer**, cada uno con su número; se tocan para ir a la lista.
   - Las acciones **Contar**, **Recibir** y **Productos**.
   - Cada bodega con sus cifras, **Ver lo que hay**, el avance del conteo ("123 de 544 contados") y **Contar**. Después, los últimos movimientos.
2. **Contar** (modo conteo): se elige la bodega y se cuenta producto por producto con el avance a la vista. En la PC, el formulario (izquierda) y la lista (derecha) ocupan la pantalla debajo del lector y cada uno se baja con su propia barra; al abrir un producto la página sube sola hasta dejarlos a la vista. La lista muestra **Falta contar** (con lo que SAP tiene), **Contados** y **Sin código** (los que no tienen código de barras, con **Registrar código**); en las otras pestañas esos productos llevan la insignia **Sin código**. Escribir en el lector filtra la lista.
   - **Códigos de barras al contar** (operador o supervisor): el producto abierto muestra su código en el encabezado; si no tiene, avisa y ofrece **Registrar código** (se escanea el envase). Si se escanea un código que no es de ningún producto, avisa y ofrece **Es de …** (el producto abierto, con un toque) o **Elegir de qué producto es** (con el código ya cargado; al registrarlo se abre ese producto para contarlo). Queda confirmado como unidad, con quién lo registró, y desde ese momento se puede escanear en pedidos. No cambia nada en SAP.
   - **Código de barras de la caja** (en la 01, opcional): el que viene impreso en la caja del proveedor (no el de la unidad). Se escanea en ese apartado del formulario (el Enter del lector no guarda el conteo) y queda registrado al guardar; si es el código de la unidad, avisa y no guarda. Sirve para pasar cajas a la 02 escaneando.
   - Se escanea el producto (o **Contar** en la lista) y se abre el formulario de esa bodega: en la **01**, cajas por lote (cajas, unidades por caja, lote y vencimiento; **Agregar otro lote**) y **¿Sobraron unidades sueltas?** como un bulto con etiqueta; en la **02**, unidades por lote. Muestra lo contado y lo que SAP tiene en esa bodega.
   - **Guardar** registra el conteo y abre solo el siguiente que falta. **No hay** (con confirmación) lo deja contado en 0. Si se cuenta más de lo que SAP tiene, pregunta **Contaste más de lo que SAP tiene** y se puede guardar igual (la diferencia queda anotada).
   - **Imprimir las etiquetas al guardar**: marcado, cada conteo de la 01 manda sus etiquetas a la impresora; desmarcado, quedan en una cola de este equipo y **Imprimir N etiquetas pendientes** las imprime todas juntas.
   - Un producto ya contado no se vuelve a contar desde acá (sumaría dos veces). Si se cerró antes de tiempo (faltó un lote, una fecha está mal), el supervisor toca **Editar conteo**: en la 01 se abre este mismo formulario con lo guardado (cajas por lote, fecha y bulto) para corregir o agregar; en la 02, el conteo por lotes. Al guardar la 01, las cajas que no cambian conservan su etiqueta, las nuevas se imprimen y un diálogo dice qué etiquetas retirar de las que quedaron anuladas. Si alguna caja ya se usó (se abrió o se movió), se corrige desde el producto. El operador ve que tiene que avisarle al supervisor.
   - "Contado" en una bodega: tiene unidades ahí, o tuvo una entrada o un conteo ahí (incluido **No hay**).
3. **Recibir / Guardar lo que llegó**: **En cajas**: una fila por lote con cantidad de cajas, unidades por caja (sugiere la de la última vez), lote y vencimiento (mes y año, se guarda el último día del mes); si dentro de un lote hay cajas con distinta cantidad va una fila por cada cantidad; lo que sobra queda como un bulto con su etiqueta. Cada caja (y el bulto) recibe un código **CJ-000123** y se imprime su etiqueta. **Suelto**: a la 02 (con su lote y vencimiento) o a la 01 como un bulto con etiqueta. Si se recibe más de lo que SAP tiene por guardar, pregunta **¿Llegó antes que SAP?** y lo anota; cuando SAP lo registra, la diferencia se cierra sola. Sin datos recientes de SAP no pregunta.
4. **Etiquetas**: una por caja, con producto, artículo, lote, vencimiento, unidades, número de caja y fecha, y el código de barras Code 128 de la caja. **Imprimir** abre el diálogo de impresión de Windows y solo salen las etiquetas (90 mm de ancho). Se pueden reimprimir desde la caja.
5. **Traspasos por aceptar**: el traspaso de la 01 a la 02 lo registra otra persona en SAP antes de mover la mercadería. SAP no tiene lotes ni cajas: solo dice "se movieron 25".
   - La app lo detecta comparando cada bodega con su almacén de SAP: si SAP tiene de más en la 02 y de menos en la 01, aparece en **Traspasos por aceptar** (Hoy, Pendientes y la ficha, con la cantidad) y en el número de la pestaña Inventario. La comparación general suma las dos bodegas, así que un traspaso no se ve como diferencia.
   - **Revisar y aceptar** dice qué pasar ("Pasá 2 cajas del lote L2 (vence 12/2026): vencen primero"). **1.** Se elige el **lote y vencimiento** que dicen las cajas: viene marcado el **Recomendado** (el que vence primero); si se elige uno que **vence después**, avisa y se puede usar igual. **Otro lote o fecha…** avisa que ese lote no está en la 01 (lo corrige el supervisor). **2.** Se **escanea cada caja** (el código de barras de la caja del proveedor, el mismo en todas): cada lectura suma una caja entera de ese lote. **Quitar la última caja** deshace. **Aceptar traspaso** se habilita cuando suman justo lo que pasó SAP; si con cajas enteras no da justo, o no quedan cajas de ese lote, avisa.
   - Si se escanea el código de la unidad, avisa que hay que escanear el de la caja. Si el código de la caja todavía no está registrado, pregunta si es de ese producto y lo registra.
   - **Aceptar sin escanear** (solo el supervisor): la sugerencia por lote, con **Aceptar**, o **Elegir otros lotes**.
   - **Elegir otros lotes**: una fila por lote de la 01 con lo que tiene; se escribe cuántas unidades salieron de cada uno. **Aceptar** se habilita cuando suman justo lo que pasó SAP y ningún lote pasa de lo que tiene.
   - Si mientras tanto SAP cambia la cantidad, avisa y pide verlo de nuevo.
   - Al terminar un pedido, si falta mercadería en la 02 y hay un traspaso sin aceptar de ese producto, el aviso lo dice; si no lo hay, avisa que falta el traspaso en SAP.
   - Desde una caja (escaneando su etiqueta CJ- en Inventario) se puede seguir pasando unidades a mano, para casos fuera de lo común.
6. **Productos**: una sola lista, en tres pestañas: **Las dos** (cada producto con lo que hay en la 01 y cuántas cajas, en la 02, en SAP y su estado) y una por bodega (cada producto con sus lotes, cajas, unidades y lo que SAP tiene en su almacén). Los filtros están siempre: **Todo**, **Falta contar**, **Diferencias** (falta guardar o falta marcar salida) y **Por vencer** (en cada bodega, sin Diferencias); el que no aplica queda gris con el motivo abajo. Las columnas también están siempre: sin datos de SAP muestran "—". Escribir filtra; un código leído con el lector abre el producto. Desde el producto, **Productos** vuelve a la lista como estaba.
7. **Producto** (ficha): arriba las acciones que corresponden (**Guardar lo que llegó**, **Marcar salida**, **Contar en la 01/02** si falta contarlo ahí, **Recibir**, **Aceptar traspaso a la 02**; el supervisor, **Editar conteo de la 01** y **Editar conteo de la 02**) y una frase con su estado frente a SAP. Dos tarjetas, una por bodega: cuánto hay (en cuántas cajas), lo que SAP tiene en su almacén, los primeros lotes y **Falta contar** si corresponde. Plegados, para abrir cuando hace falta: cajas de la 01, lotes de la 02, códigos de barras, documentos recientes de SAP y movimientos. **Sin lote** en la 02 incluye lo que había antes del control por lotes; al editar su conteo se puede repartir en sus lotes. En **Códigos de barras** también figura el de **la caja** (con quién lo registró; el supervisor lo puede quitar). En **Editar conteo de la 02** cada lote viene con sus unidades y su fecha de vencimiento precargadas, y las dos se pueden cambiar; el año va completo (por ejemplo 2028), y si no, avisa antes de guardar.
8. **Pendientes**: **Falta guardar** (con **Guardar**), **Traspasos por aceptar** (con **Revisar y aceptar**), **Falta marcar salida** (con **Marcar salida**) y **Salidas marcadas**. Marcar salida: se elige de qué lotes salió, primero los de la 01 y después los de la 02, cada grupo empezando por los vencidos y siguiendo por el que vence antes, hasta completar el total exacto; al confirmar muestra qué cajas sacar del estante. En **Salidas marcadas** el supervisor puede **Cambiar lote** (queda anotado quién, cuándo y cuál era el anterior).
9. **Por vencer**: lotes de las dos bodegas que vencen en los próximos 30, 60, 90 o 180 días, con lo que hay en cada una; los vencidos siempre, en rojo.

Reglas:
- **Pedidos**: al finalizar una preparación, lo escaneado sale de la 02, del lote elegido. Tiene que estar registrado ahí: si no alcanza, no se puede finalizar. Hasta que SAP registra la entrega cuenta como "preparado sin entregar".
- **Saldo negativo antiguo**: lo que quedó negativo en la 02 antes del control por lotes no deja pasar ni recibir ahí ese producto hasta que el supervisor la cuente de nuevo por lote.
- **Una operación, una vez**: recibir, contar, "no hay", pasar, marcar salida, cambiar lote y corregir llevan un identificador propio (operacionId). Si se corta la red y se vuelve a guardar lo mismo, el servidor no lo registra dos veces.
- **Cambios recientes en SAP**: después de un cambio de existencias o de la entrega de un pedido preparado, el producto espera 15 minutos antes de avisar ("SAP actualizándose"), porque las existencias y los pedidos llegan en recorridos distintos del puente.
- **No hay "dar de baja"** en la app: lo vencido o dañado se registra primero en SAP y después aparece en Falta marcar salida.
- **Solo el supervisor**: cambiar el lote de una salida, editar el conteo de la 01 (el formulario del conteo con lo guardado) y de la 02 (por lote: una fila por cada lote que el sistema conoce y **Agregar un lote** para los que no están), corregir las unidades de una caja y ver lo que SAP tiene en cualquier almacén (**Panel → Almacenes → Ver productos**: en stock, comprometido, pedido y disponible). Las correcciones quedan como diferencia con SAP si no coinciden. Una salida de antes del control por lotes que salió de la 02 no se puede cambiar de lote.

## Bodegas

Sección propia (arriba, junto a Pedidos e Inventario), para operadores y supervisor: lo que tiene cada almacén marcado de esta bodega.

- Una pestaña por almacén marcado en **Panel → Almacenes**, con cuántos productos tiene en SAP: primero la bodega de cajas, después la de despacho y el resto por código. Sin almacenes marcados, lo avisa (el supervisor tiene **Elegir almacenes**).
- Encima de la lista: qué es ese almacén (bodega de cajas completas, bodega de despacho, o marcado sin bodega asignada), cuántos productos y unidades tiene según SAP y, en la de cajas y la de despacho, cuántas unidades hay registradas en la app. Dice de cuándo son las existencias de SAP.
- La lista, producto por producto: **En stock**, **Comprometido** (en pedidos), **Pedido** (a proveedores) y **Disponible** de SAP; en la de cajas y la de despacho, además **En la bodega** (lo registrado en la app, con sus cajas en la 01), incluidos los productos que SAP no tiene en ese almacén.
- Buscador (sin distinguir tildes ni mayúsculas); un código leído con el lector abre el producto. Desde la ficha, **Bodegas** vuelve a la misma pestaña con la búsqueda. En la de cajas y la de despacho, **Ver por lote** abre la lista de Productos de esa bodega.

## Panel del supervisor

Solo para quien ingresó con rol supervisor (**Menú → Panel del supervisor** o la sección del mismo nombre). Cinco pestañas, cada una con un número de lo que espera atención:

- **Etiquetas**: códigos de barras por confirmar como unidad. Los de unidad Manual se confirman todos juntos; si mientras tanto cambia alguno o llega uno nuevo, el servidor lo rechaza y la pantalla pide revisar otra vez. Buscador que acepta una lectura del lector y filtro **Cambiaron en SAP**.
- **Operadores**: agregar, cambiar PIN (con repetición y aviso de PIN fácil), desbloquear, desactivar y activar.
- **Revisiones**: preparaciones en revisión con lo que cambió en SAP (antes y ahora) y **Reiniciar con los datos nuevos**; finalizados con diferencias de las últimas 24 h; preparados sin entrega en SAP hace más de 24 h. Desde cada uno se ven las lecturas o el resumen.
- **Sincronización**: última recepción y cantidad de registros por tipo de dato de SAP, incluidos almacenes, existencias por almacén y entradas, salidas y devoluciones. Aviso si los pedidos o las existencias pasan más de 1 h sin datos, o el resto más de 24 h.
- **Almacenes**: los almacenes de SAP con cuántos productos, unidades y líneas de pedidos abiertos tiene cada uno. Se marcan los de esta bodega y se elige cuál es la **bodega de cajas completas** y cuál la **de despacho** (de donde salen los pedidos): cada bodega toma el nombre de su almacén y se cuenta contra lo que SAP tiene ahí. **Ver productos** muestra lo que SAP tiene en un almacén; los que no tienen existencia ni pedidos quedan ocultos detrás de **Mostrar todos**. Opción **En Pedidos, mostrar solo los pedidos que salen de los almacenes marcados**.
- **Reportes**: **Cuadre con SAP**, con la misma diferencia de Pendientes pero solo de los productos ya contados en las dos bodegas. Arriba, cuántos cuadran (y qué parte de lo contado), cuántos tienen menos que SAP (en Pendientes, **Falta guardar**) y cuántos más (**Falta marcar salida**), con las unidades; después, en frases cortas, qué no cuadra en la 01, el faltante y el sobrante más grandes. Dos tablas, de mayor a menor diferencia, con lo contado, lo de SAP y la diferencia de cada bodega y el total (contado − SAP: negativo en rojo, positivo en naranja). Lo que falta contar y lo recibido antes que SAP no entran; la nota al pie dice cuántos quedaron afuera. **Actualizar** lo vuelve a calcular y **Descargar PDF** lo guarda en tamaño carta (portada, resumen, una hoja por tabla y número de página) y lo abre.
- **Registrar un código** (en Etiquetas y en la ficha del producto; también lo hace un operador desde la ficha y al contar): se escanea el envase y se elige el producto. Queda con la unidad Manual, confirmado como unidad y con quién lo registró; si el código ya es de otro producto, lo rechaza. No cambia nada en SAP.
- **Quitar** (solo el supervisor, en la ficha del producto → Códigos de barras): saca un código registrado desde la app, por ejemplo si se asignó al producto equivocado. Los que vienen de SAP se cambian en SAP.

## El lector de códigos

- Debe funcionar **como teclado** y terminar cada lectura con **Enter**.
- El campo de lectura tiene siempre el foco; si se toca un botón, vuelve solo. El panel indica **"Listo para leer"** cuando el campo tiene el foco y **"Tocá el campo para leer"** cuando no.
- En un equipo táctil aparece un botón de teclado para escribir un código a mano; con mouse y teclado físico no hace falta.

## Sin conexión y reintentos

- Cada lectura recibe un identificador propio (operacionId) al escanearse. Si la respuesta no llega, se reintenta con el **mismo** identificador: el servidor no cuenta la unidad dos veces.
- Si la red no vuelve, la pantalla avisa "Sin conexión. N lecturas pendientes" y las guarda en el equipo. Se envían solas al volver la red (o con **Reintentar ahora**), en el mismo orden, incluso si se cerró la app.
- Sin conexión no se pueden consultar pedidos ni empezar preparaciones.

## Versión nueva

Cuando la app ya descargó una versión nueva, la barra de arriba muestra **Actualizar a X.Y.Z** (en lila, junto al nombre del operador), también en la pantalla de ingreso. Al tocarlo pide confirmar: **Reiniciar y actualizar** cierra la app, instala la versión nueva y la vuelve a abrir; **Cancelar** deja todo como estaba. Conviene terminar antes lo que se esté cargando en un formulario; las lecturas sin enviar quedan guardadas en el equipo. Si nadie lo toca, la versión nueva se instala la próxima vez que se cierre la app. Cómo se publican las versiones: [README](../README.md#obtener-el-instalador).

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
