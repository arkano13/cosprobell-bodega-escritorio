// Identificador de operación del inventario (operacionId). Uno por acción: si se reintenta lo mismo (por ejemplo,
// después de perder la conexión), se reenvía con el mismo identificador y el servidor no lo cuenta dos veces. Si
// cambian los datos, es otra acción y lleva otro. Después de una respuesta correcta, la próxima acción lleva uno nuevo.
import { nuevoUuid } from "./uuid.js";

export function crearOperacion(generar = nuevoUuid) {
  let actual = null; // { id, firma }
  return {
    // Devuelve el cuerpo con su operacionId.
    para(cuerpo) {
      const firma = JSON.stringify(cuerpo);
      if (!actual || actual.firma !== firma) actual = { id: generar(), firma };
      return { operacionId: actual.id, ...cuerpo };
    },
    terminar() { actual = null; },
  };
}
