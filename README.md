# Faktum

Aplicación de escritorio multiplataforma (**Windows**, **macOS** y **Linux**) para la descarga masiva, organización y consolidación contable de comprobantes electrónicos recibidos del Servicio de Rentas Internas (SRI) de Ecuador.

## Funcionalidades principales

- **Gestión multi-RUC con sesiones aisladas:** Permite administrar múltiples contribuyentes o empresas desde una sola aplicación. Cada perfil mantiene su propia partición de sesión de navegador y almacena sus credenciales cifradas localmente mediante el llavero nativo del sistema operativo (Windows DPAPI, macOS Keychain o Secret Service / Keyring en Linux).
- **Integración directa con SRI en Línea:** Incorpora el portal oficial del SRI dentro de la aplicación, aplica automáticamente los filtros de período y tipo de comprobante, e intercepta el listado de comprobantes en memoria sin requerir descargas manuales de archivos `.txt`.
- **Descarga por mes o por rango de fechas:** Soporta consultas de un período puntual (año, mes y día) o rangos continuos entre dos fechas con avance secuencial por mes y generación de un resumen consolidado del rango.
- **Obtención de XML oficial y PDF RIDE:**
  - Descarga el XML autorizado a través del servicio web SOAP oficial del SRI (`AutorizacionComprobantesOffline`) con respaldo directo desde el portal del SRI para comprobantes históricos.
  - Descarga el PDF RIDE original directamente desde el portal del SRI con serialización de peticiones, paginación automática y generación local de RIDE de respaldo a partir del XML autorizado en caso de indisponibilidad puntual del servidor.
- **Exportación a Excel (`.xlsx`):** Genera libros estructurados listos para trabajo contable con tres hojas:
  1. **Resumen Comprobantes:** Datos del emisor, fechas, clave de acceso, subtotales (0 %, IVA, no objeto, exento), descuentos, impuestos (IVA, ICE), propina, total y fila de totales.
  2. **Detalle de Ítems:** Desglose línea por línea de productos o servicios facturados.
  3. **Retenciones:** Soporte para comprobantes de retención en versiones 1.0.0 y 2.0.0 del SRI.
- **Historial local y control de duplicados:** Indexa los comprobantes descargados por clave de acceso para evitar descargas redundantes y permite consultar, filtrar, abrir archivos o reexportar reportes desde la aplicación.

## Organización de archivos generados

Los archivos descargados se estructuran automáticamente por empresa/RUC, año, mes, formato y tipo de comprobante, utilizando nombres seguros compatibles con macOS y Windows:

```text
<CarpetaDestino>/
└── <Razón Social (RUC)>/
    ├── Rangos/
    │   └── Faktum_Rango_<RUC>_<YYYY-MM-DD>_a_<YYYY-MM-DD>.xlsx
    └── <YYYY>/
        └── <MM_Mes>/
            ├── Excel/
            │   └── Faktum_Resumen_<RUC>_<YYYY-MM>.xlsx
            ├── XML/
            │   ├── Facturas/
            │   ├── Notas_Credito/
            │   ├── Notas_Debito/
            │   ├── Retenciones/
            │   ├── Liquidaciones_Compra/
            │   └── Guias_Remision/
            └── PDF/
                └── <TipoComprobante>/
                    └── <YYYY-MM-DD>_<NumeroComprobante>_<Emisor>.pdf
```

## Arquitectura y pila tecnológica

| Capa | Tecnologías |
| --- | --- |
| Escritorio y proceso principal | Electron 33, TypeScript, Node.js |
| Interfaz de usuario | React 18, Vite 6, CSS moderno (modo claro y oscuro) |
| Procesamiento de comprobantes | `fast-xml-parser`, `exceljs`, `pdfkit` |
| Pruebas y empaquetado | Vitest, `electron-builder`, GitHub Actions |

Estructura principal del proyecto:

```text
src/
├── main/
│   ├── index.ts                  # Ciclo de vida de Electron y manejadores IPC
│   └── services/
│       ├── claveAcceso.ts        # Decodificación, validación módulo 11 y lectura de reportes
│       ├── dateRange.ts          # Expansión de rangos mensuales y filtrado por fecha
│       ├── downloadManager.ts    # Cola concurrente de descargas y control de duplicados
│       ├── excelExporter.ts      # Generación de libros .xlsx multi-hoja
│       ├── pathLayout.ts         # Estructura determinista de directorios y nombres
│       ├── portalManager.ts      # Vista embebida del SRI, paginación y captura nativa
│       ├── rideGenerator.ts      # Generación local de RIDE PDF de respaldo
│       ├── sriSoap.ts            # Cliente SOAP para AutorizacionComprobantesOffline
│       ├── store.ts              # Persistencia local cifrada e historial
│       └── xmlParser.ts          # Parser de comprobantes electrónicos del SRI
├── preload/
│   └── index.ts                  # Puente seguro contextBridge
├── renderer/
│   └── src/                      # Componentes React, selector de fechas y estilos
└── shared/
    └── types.ts                  # Tipos compartidos entre main y renderer
tests/
└── sri.test.ts                   # Pruebas unitarias de servicios núcleo
```

## Requisitos previos (instalación desde código fuente)

- **Node.js 20 o superior** (recomendado **Node.js 22 LTS**).
- **npm 10 o superior** (incluido con Node.js).
- **Git** para clonar el repositorio.

## Instalación por sistema operativo

### Windows (10 / 11 — 64 bits)

#### Opción A: Usando el instalador o versión portable
1. Descarga desde la sección **Releases** o **Actions** del repositorio:
   - `Faktum-Setup-<version>-x64.exe` (instalador clásico con acceso directo en Escritorio y Menú Inicio), o
   - `Faktum-Portable-<version>-x64.exe` (ejecutable directo sin instalación).
2. Ejecuta el archivo `.exe`.
   > Si Windows Defender SmartScreen muestra una advertencia por aplicación sin firma comercial, haz clic en **Más información** → **Ejecutar de todas formas**.

#### Opción B: Desde el código fuente
1. Instala [Git for Windows](https://git-scm.com/download/win) y [Node.js LTS](https://nodejs.org/).
2. Abre **PowerShell** o **Símbolo del sistema (CMD)** y ejecuta:
   ```powershell
   git clone https://github.com/reivaJAQM/Faktum.git
   cd Faktum
   npm install
   npm start
   ```
3. *(Opcional)* Para generar tus propios ejecutables `.exe` en la carpeta `release/`:
   ```powershell
   npm run dist:win
   ```

---

### macOS (Apple Silicon y Intel)

#### Opción A: Usando el instalador `.dmg` o `.zip`
1. Descarga `Faktum-<version>-arm64.dmg` (o `.zip`) desde **Releases** / **Actions**.
2. Abre el `.dmg` y arrastra **Faktum** a la carpeta **Aplicaciones**.
3. Si macOS indica que la app proviene de un desarrollador no identificado (Gatekeeper), quita el atributo de cuarentena desde **Terminal**:
   ```bash
   xattr -cr /Applications/Faktum.app
   ```
   Luego abre **Faktum** normalmente.

#### Opción B: Desde el código fuente
1. Instala [Node.js LTS](https://nodejs.org/) (o con Homebrew: `brew install node git`).
2. Abre **Terminal** y ejecuta:
   ```bash
   git clone https://github.com/reivaJAQM/Faktum.git
   cd Faktum
   npm install
   npm start
   ```
3. **Inicio rápido con doble clic:** El repositorio incluye el lanzador ejecutable `Iniciar Faktum.command`. Al abrirlo desde Finder, detecta automáticamente tu entorno de Node.js (`fnm`, `nvm` o Homebrew), compila si hay cambios pendientes en `src/` e inicia la aplicación.
4. *(Opcional)* Para generar los instaladores `.dmg` y `.zip` en `release/`:
   ```bash
   npm run dist:mac
   ```

---

### Linux (Ubuntu, Debian, Fedora, Arch, etc.)

Actualmente Linux se instala y ejecuta desde el código fuente (con posibilidad de generar paquetes locales mediante `electron-builder`).

1. **Instala Git, Node.js 20+ y las dependencias base de escritorio / llavero seguro:**
   - **Ubuntu / Debian:**
     ```bash
     sudo apt update
     sudo apt install -y git curl libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 gnome-keyring
     ```
     *(En versiones anteriores a Ubuntu 24.04 usa `libasound2` en lugar de `libasound2t64`.)*
   - **Fedora:**
     ```bash
     sudo dnf install -y git nodejs npm nss atk at-spi2-atk cups-libs libdrm libxkbcommon libXcomposite libXdamage libXfixes libXrandr mesa-libgbm alsa-lib gnome-keyring
     ```
   - **Arch Linux:**
     ```bash
     sudo pacman -S --needed git nodejs npm nss gtk3 libxss alsa-lib gnome-keyring
     ```
   > Si tu distribución trae una versión antigua de Node.js, instala **Node.js 22 LTS** con [nvm](https://github.com/nvm-sh/nvm) o [NodeSource](https://nodesource.com/).

2. **Clona el repositorio, instala dependencias y ejecuta Faktum:**
   ```bash
   git clone https://github.com/reivaJAQM/Faktum.git
   cd Faktum
   npm install
   npm start
   ```

3. *(Opcional)* Si tu sistema restringe el sandbox de Chromium en Electron, puedes ejecutar:
   ```bash
   npm run build && npx electron . --no-sandbox
   ```

4. *(Opcional)* Para empaquetar una versión local en Linux (por ejemplo `AppImage`):
   ```bash
   npm run build && npx electron-builder --linux AppImage --publish never
   ```

---

## Modo desarrollo

Inicia el servidor de desarrollo de Vite con recarga en vivo junto con la ventana de Electron (funciona en Windows, macOS y Linux):

```bash
npm run dev
```

## Pruebas automatizadas

```bash
npm test
```

## Empaquetado e instaladores

Compilación local mediante `electron-builder`:

```bash
# macOS (.dmg y .zip)
npm run dist:mac

# Windows (instalador NSIS y ejecutable portable)
npm run dist:win

# macOS y Windows
npm run dist:all
```

El repositorio incluye el flujo `.github/workflows/build.yml` configurado para compilar los instaladores de macOS y Windows automáticamente en GitHub Actions al publicar etiquetas `v*` o mediante ejecución manual (`workflow_dispatch`).

## Seguridad y privacidad

- Las credenciales del SRI se cifran utilizando `safeStorage` de Electron sobre el llavero seguro del sistema operativo y nunca se transmiten a servidores externos distintos al portal oficial del SRI.
- Cada perfil de RUC opera en una partición aislada (`persist:sri-<RUC>`).
- Los archivos locales de registro (`sri-trace.log`), variables de entorno y salidas de compilación están excluidos del control de versiones mediante `.gitignore`.

---

Desarrollado por **SystMa**.
