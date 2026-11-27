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
| Pruebas | Vitest |

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

## Requisitos previos

- **Node.js 20 o superior** (recomendado **Node.js 22 LTS**).
- **npm 10 o superior** (incluido con Node.js).
- **Git**.

## Instalación y ejecución por línea de comandos

### Windows (PowerShell o CMD)

1. Instala **Git** y **Node.js 22 LTS** desde la terminal con `winget`:
   ```powershell
   winget install --id Git.Git -e
   winget install --id OpenJS.NodeJS.LTS -e
   ```
   *(Reinicia PowerShell/CMD tras la instalación para que `git`, `node` y `npm` queden disponibles en el `PATH`.)*

2. Clona el repositorio, instala dependencias e inicia la aplicación:
   ```powershell
   git clone https://github.com/reivaJAQM/Faktum.git
   cd Faktum
   npm install
   npm start
   ```

---

### macOS (Terminal)

1. Instala **Git** y **Node.js** (con [Homebrew](https://brew.sh/)):
   ```bash
   brew install git node@22
   ```
   *(Si ya tienes `git` y Node.js 20+ mediante `nvm` o `fnm`, omite este paso.)*

2. Clona el repositorio, instala dependencias e inicia la aplicación:
   ```bash
   git clone https://github.com/reivaJAQM/Faktum.git
   cd Faktum
   npm install
   npm start
   ```

---

### Linux (Terminal)

1. Instala **Git**, **Node.js 20+** y las librerías base requeridas por Electron y el llavero seguro:
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
   > Si tu distribución incluye una versión anterior de Node.js, instala **Node.js 22 LTS** con [nvm](https://github.com/nvm-sh/nvm) o [NodeSource](https://nodesource.com/).

2. Clona el repositorio, instala dependencias e inicia la aplicación:
   ```bash
   git clone https://github.com/reivaJAQM/Faktum.git
   cd Faktum
   npm install
   npm start
   ```

3. *(Opcional)* Si tu distribución restringe el sandbox de Chromium en Electron, ejecuta:
   ```bash
   npm run build && npx electron . --no-sandbox
   ```

---

## Modo desarrollo

Inicia el servidor de desarrollo de Vite con recarga en vivo junto con la ventana de Electron (Windows, macOS y Linux):

```bash
npm run dev
```

## Pruebas automatizadas

```bash
npm test
```

## Actualizar a la última versión

Desde la carpeta del proyecto:

```bash
git pull origin main
npm install
npm start
```

## Seguridad y privacidad

- Las credenciales del SRI se cifran utilizando `safeStorage` de Electron sobre el llavero seguro del sistema operativo y nunca se transmiten a servidores externos distintos al portal oficial del SRI.
- Cada perfil de RUC opera en una partición aislada (`persist:sri-<RUC>`).
- Los archivos locales de registro (`sri-trace.log`), variables de entorno y salidas de compilación están excluidos del control de versiones mediante `.gitignore`.

---

Desarrollado por **SystMa**.
