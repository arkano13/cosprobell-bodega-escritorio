# Bodega Cosprobell — app de escritorio

App de Windows para preparar pedidos en bodega con lector de códigos de barras. Muestra los pedidos abiertos, guía la lectura de cada producto y registra el avance en el backend de Cosprobell (repositorio `cosprobell-backend`), con el que se comunica por HTTPS.

La pantalla viene dentro de la app: no se descarga de internet. Cómo funciona la pantalla (lecturas, reintentos, diseño): [docs/PANTALLA.md](docs/PANTALLA.md).

## Instalar en una PC de bodega

1. Conseguir el instalador `Bodega-Cosprobell-X.Y.Z-instalador.exe` (ver [Obtener el instalador](#obtener-el-instalador)).
2. Abrirlo. Como el instalador no está firmado, Windows puede mostrar **"Windows protegió su PC"**: elegir **Más información → Ejecutar de todas formas**.
3. Se instala para el usuario actual, sin permisos de administrador. Crea accesos directos en el escritorio y en el menú Inicio, y abre la app.
4. En el primer uso, completar:
   - **Dirección del servidor**: la del backend, con `https://`.
   - **Clave del equipo**: una API key creada en el backend con `node scripts/crear-api-key.js escaner-bodega-1`. Conviene una clave por equipo, para poder desactivarlas por separado. No debe estar en `ETIQUETAS_APPS_AUTORIZADAS`.
   - **Nombre de quien escanea**.
   - Opcional: **Abrir la app al iniciar Windows** y **Pantalla completa**.

## Uso diario

- El lector debe funcionar **como teclado** y terminar cada lectura con **Enter** (configuración de fábrica habitual).
- Atajos:

  | Tecla | Acción |
  |---|---|
  | F11 | Pantalla completa (se recuerda) |
  | Ctrl + / Ctrl - / Ctrl 0 | Tamaño de letra (se recuerda) |
  | F5 | Recargar la pantalla |

- **Menú** (arriba a la derecha) permite cambiar la dirección del servidor, la clave o el nombre de quien escanea.
- Si se cierra la app a mitad de una preparación, al abrirla de nuevo continúa donde quedó.
- Solo se puede abrir una ventana: abrirla otra vez muestra la que ya está abierta.

## Actualizar o desinstalar

- **Actualizar**: abrir el instalador de la versión nueva. Conserva la configuración y la preparación abierta.
- **Desinstalar**: Configuración de Windows → Aplicaciones → Bodega Cosprobell. La configuración queda en `%APPDATA%\Bodega Cosprobell`; borrar esa carpeta para eliminarla (incluye la clave del equipo).

## Obtener el instalador

**Automático (GitHub Actions).** Cada cambio subido a GitHub arma el instalador en una máquina Windows, corre las pruebas y prueba el programa armado:

1. Pestaña **Actions** → **Instalador de Windows** → la ejecución más reciente.
2. Abajo, en **Artifacts**, descargar `instalador-windows` (un `.zip` con el `.exe`). Se guarda 30 días.

**Versión oficial.** Para publicar una versión en **Releases**:

1. Cambiar `"version"` en `package.json` (por ejemplo `1.0.1`) y subir el cambio.
2. Crear la etiqueta con la misma versión: en GitHub, **Releases → Draft a new release → Choose a tag → `v1.0.1`** (o con git: `git tag v1.0.1` y `git push origin v1.0.1`).
3. GitHub Actions arma el instalador y lo agrega a esa versión.

**En una PC con Windows.** Con Node.js 22: `npm ci` y luego `npm run dist`. El instalador queda en `dist\`.

## Seguridad

- La pantalla está dentro de la app y solo se conecta al servidor configurado: exige `https://`, salvo `http://localhost` o `http://127.0.0.1`, que solo sirven para pruebas en el mismo equipo.
- No navega a otros sitios ni abre ventanas. La página no tiene acceso a Node ni al sistema: solo puede leer y guardar sus preferencias. Rige una política de seguridad de contenido (solo sus propios archivos).
- El ejecutable tiene desactivadas las opciones de Electron que permitirían usarlo para correr otro código (`electronFuses` en `package.json`).
- No se descarga nada de internet por su cuenta: ni diccionarios ni actualizaciones automáticas.
- La clave del equipo queda en la carpeta de datos del usuario de Windows: cualquiera con acceso a ese usuario puede usarla. Si se pierde un equipo, desactivar su API key en el backend (`activa = false` en `api_keys`).
- El instalador no está firmado. Para quitar el aviso de Windows hace falta un certificado de firma de código; se configura en el workflow con los secretos `CSC_LINK` y `CSC_KEY_PASSWORD`.

## Desarrollo

```bash
npm ci
npm test          # pruebas de la pantalla y de la app
npm start         # abre la app (necesita un backend accesible)
npm run dist      # instalador de Windows (en Windows)
```

| Carpeta | Contenido |
|---|---|
| `src/` | Proceso principal: ventana, protocolo `app://bodega`, preferencias, atajos y seguridad |
| `ui/` | La pantalla: HTML, CSS, módulos JavaScript, íconos y fuentes |
| `build/` | Ícono de la app |
| `test/` | Pruebas (`*.test.js`) y prueba rápida del programa armado (`humo.mjs`) |

Para probar sin SAP, en el backend (base de desarrollo, nunca producción): `node scripts/datos-demo-bodega.js`, crear una API key y `npm run dev`. En la app, servidor `http://localhost:3000`. El script del backend muestra los códigos para escanear.

## Licencias de terceros

- Íconos: [Lucide](https://lucide.dev), licencia ISC (aviso dentro de `ui/js/iconos.js`).
- Fuentes: Barlow, Barlow Condensed y JetBrains Mono, licencia SIL OFL 1.1 (`ui/fuentes/OFL-*.txt`).
- Electron y Chromium: sus licencias se incluyen en el programa instalado.
