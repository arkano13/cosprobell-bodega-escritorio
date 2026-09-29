# Bodega Cosprobell — app de escritorio

App de Windows para preparar pedidos en bodega con lector de códigos de barras. Muestra los pedidos abiertos, guía la lectura de cada producto y registra el avance en el backend de Cosprobell (repositorio `cosprobell-backend`), con el que se comunica por HTTPS. La dirección del backend viene fija dentro de la app: `https://cosprobell-backend-production.up.railway.app`.

La pantalla viene dentro de la app: no se descarga de internet. Cómo funciona la pantalla (lecturas, reintentos, diseño): [docs/PANTALLA.md](docs/PANTALLA.md).

## Instalar en una PC de bodega

1. Conseguir el instalador `Bodega-Cosprobell-X.Y.Z-instalador.exe` (ver [Obtener el instalador](#obtener-el-instalador)).
2. Abrirlo. Como el instalador no está firmado, Windows puede mostrar **"Windows protegió su PC"**: elegir **Más información → Ejecutar de todas formas**.
3. Se instala para el usuario actual, sin permisos de administrador. Crea accesos directos en el escritorio y en el menú Inicio, y abre la app.
4. No hay nada que configurar: la app abre en **¿Quién va a preparar?**. Cada persona toca su nombre y escribe su **PIN de 4 números**, que le asigna el supervisor (ver [Operadores y PIN](#operadores-y-pin)).
5. Opcional, desde **Menú → Este equipo**: **Abrir la app al iniciar Windows** y **Pantalla completa**.

## Operadores y PIN

- El supervisor da de alta a cada persona y le asigna su PIN desde el backend: `node scripts/operadores.js crear "Ana López" 4827`. También cambia PIN, desbloquea y desactiva (guía `docs/INGRESO_OPERADORES.md` del backend).
- La sesión dura el turno (12 horas). **Menú → Cambiar de operador** la cierra para que ingrese otra persona; una preparación abierta se puede continuar.
- Cada 5 PIN incorrectos seguidos la persona queda en pausa 15 minutos; a los 10, bloqueada hasta que el supervisor la desbloquee.
- Queda registrado quién prepara cada pedido y quién hizo cada lectura.

## Uso diario

- El lector debe funcionar **como teclado** y terminar cada lectura con **Enter** (configuración de fábrica habitual).
- Atajos:

  | Tecla | Acción |
  |---|---|
  | F11 | Pantalla completa (se recuerda) |
  | Ctrl + / Ctrl - / Ctrl 0 | Tamaño de letra (se recuerda) |
  | F5 | Recargar la pantalla |

- **Menú** (arriba a la derecha): cambiar de operador y opciones del equipo.
- Si se cierra la app a mitad de una preparación, al abrirla de nuevo continúa donde quedó (con la sesión del turno).
- Si la sesión vence, la app vuelve a pedir el PIN; las lecturas que quedaron sin enviar se envían al volver a ingresar.
- Solo se puede abrir una ventana: abrirla otra vez muestra la que ya está abierta.

## Actualizar o desinstalar

- **Actualizar**: abrir el instalador de la versión nueva. Conserva la configuración y la preparación abierta.
- **Desinstalar**: Configuración de Windows → Aplicaciones → Bodega Cosprobell. Las preferencias y la sesión del turno quedan en `%APPDATA%\Bodega Cosprobell`; borrar esa carpeta para eliminarlas.

## Obtener el instalador

**Clave de ingreso (una sola vez).** La app lleva adentro una clave que solo sirve para ver la lista de nombres e intentar el PIN; no ve datos. Se crea en el backend con `node scripts/crear-api-key.js app-bodega --solo-ingreso` y se guarda en este repositorio como secreto **`BODEGA_CLAVE_INGRESO`** (**Settings → Secrets and variables → Actions → New repository secret**). Sin ese secreto el instalador se arma igual pero no puede ingresar, y una versión oficial (etiqueta) no se publica.

**Automático (GitHub Actions).** Cada cambio subido a GitHub arma el instalador en una máquina Windows, corre las pruebas y prueba el programa armado:

1. Pestaña **Actions** → **Instalador de Windows** → la ejecución más reciente.
2. Abajo, en **Artifacts**, descargar `instalador-windows` (un `.zip` con el `.exe`). Se guarda 30 días.

**Versión oficial.** Para publicar una versión en **Releases**:

1. Cambiar `"version"` en `package.json` (por ejemplo `1.0.1`) y subir el cambio.
2. Crear la etiqueta con la misma versión: en GitHub, **Releases → Draft a new release → Choose a tag → `v1.0.1`** (o con git: `git tag v1.0.1` y `git push origin v1.0.1`).
3. GitHub Actions arma el instalador y lo agrega a esa versión.

**En una PC con Windows.** Con Node.js 22: `npm ci` y luego `npm run dist`. El instalador queda en `dist\`.

## Seguridad

- La pantalla está dentro de la app y solo puede conectarse al backend de la app (la política de seguridad de contenido lo impone).
- No navega a otros sitios ni abre ventanas. La página no tiene acceso a Node ni al sistema: solo puede leer y guardar sus preferencias, ver la lista de operadores e intentar el PIN.
- La clave de ingreso queda en el proceso principal de la app: la página nunca la ve. Aunque alguien la extraiga del programa, solo sirve para intentar PIN (con pausa y bloqueo); los datos piden la sesión de un operador.
- El ejecutable tiene desactivadas las opciones de Electron que permitirían usarlo para correr otro código (`electronFuses` en `package.json`).
- No se descarga nada de internet por su cuenta: ni diccionarios ni actualizaciones automáticas.
- La sesión del turno queda en la carpeta de datos del usuario de Windows y vence a las 12 horas. Si se pierde un equipo, desactivar a los operadores que lo usaron o cambiar sus PIN cierra sus sesiones.
- El instalador no está firmado. Para quitar el aviso de Windows hace falta un certificado de firma de código; se configura en el workflow con los secretos `CSC_LINK` y `CSC_KEY_PASSWORD`.

## Desarrollo

```bash
npm ci
npm test          # pruebas de la pantalla y de la app
npm start         # abre la app contra el backend de producción
BODEGA_SERVIDOR=http://localhost:3000 BODEGA_CLAVE_INGRESO=<clave> npm start   # contra un backend local
npm run dist      # instalador de Windows (en Windows)
```

| Carpeta | Contenido |
|---|---|
| `src/` | Proceso principal: ventana, protocolo `app://bodega`, preferencias, atajos y seguridad |
| `ui/` | La pantalla: HTML, CSS, módulos JavaScript, íconos y fuentes |
| `build/` | Ícono de la app |
| `test/` | Pruebas (`*.test.js`) y prueba rápida del programa armado (`humo.mjs`) |

`BODEGA_SERVIDOR` y `BODEGA_CLAVE_INGRESO` solo se usan en desarrollo; el programa instalado usa siempre la dirección fija y la clave armada por GitHub Actions.

Para probar sin SAP, en el backend (base de desarrollo, nunca producción): `node scripts/datos-demo-bodega.js`, `node scripts/crear-api-key.js app-bodega-dev --solo-ingreso`, `node scripts/operadores.js crear "Prueba" 4827` y `npm run dev`. El script de datos muestra los códigos para escanear.

## Licencias de terceros

- Íconos: [Lucide](https://lucide.dev), licencia ISC (aviso dentro de `ui/js/iconos.js`).
- Fuentes: Barlow, Barlow Condensed y JetBrains Mono, licencia SIL OFL 1.1 (`ui/fuentes/OFL-*.txt`).
- Electron y Chromium: sus licencias se incluyen en el programa instalado.
