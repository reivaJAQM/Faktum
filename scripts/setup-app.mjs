#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const args = new Set(process.argv.slice(2));
const isUninstall = args.has('--uninstall');
const useNoSandbox = args.has('--no-sandbox');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
const APP_VERSION = pkg.version || '1.0.0';
const APP_NAME = 'Faktum';
const MAC_BUNDLE_ID = 'com.faktum.sri.launcher';

function readInstalledElectronBinary(electronDir) {
  const pathFile = path.join(electronDir, 'path.txt');
  if (!fs.existsSync(pathFile)) return null;
  const relPath = fs.readFileSync(pathFile, 'utf-8').trim();
  if (!relPath) return null;
  const candidate = path.resolve(electronDir, 'dist', relPath);
  return fs.existsSync(candidate) ? candidate : null;
}

function resolveElectronBinary() {
  const electronDir = path.join(ROOT_DIR, 'node_modules', 'electron');
  if (!fs.existsSync(electronDir)) {
    throw new Error(
      'No se encontró Electron en node_modules. Ejecuta primero "npm install".'
    );
  }

  let binPath = readInstalledElectronBinary(electronDir);
  if (!binPath) {
    const installScript = path.join(electronDir, 'install.js');
    if (fs.existsSync(installScript)) {
      console.log('Descargando binario de Electron...');
      execFileSync(process.execPath, [installScript], {
        cwd: electronDir,
        stdio: 'inherit',
      });
      binPath = readInstalledElectronBinary(electronDir);
    }
  }

  if (!binPath) {
    try {
      const resolved = require('electron');
      if (typeof resolved === 'string' && fs.existsSync(resolved)) {
        binPath = path.resolve(resolved);
      }
    } catch {
      // handled below
    }
  }

  if (!binPath) {
    throw new Error(
      'No se pudo descargar o localizar el binario de Electron. Ejecuta "node node_modules/electron/install.js" e intenta de nuevo.'
    );
  }

  return binPath;
}

function assertBuilt() {
  const mainEntry = path.join(ROOT_DIR, 'dist', 'main', 'index.js');
  const rendererEntry = path.join(ROOT_DIR, 'dist', 'renderer', 'index.html');
  if (!fs.existsSync(mainEntry) || !fs.existsSync(rendererEntry)) {
    throw new Error(
      'Falta compilar el proyecto (carpeta dist/). Ejecuta "npm run build" o "npm run setup".'
    );
  }
}

function shSingleQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escapeDesktopExecArg(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')}"`;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ===========================
 * macOS (.app bundle)
 * =========================== */
function getMacAppDir() {
  const systemApps = '/Applications';
  try {
    fs.accessSync(systemApps, fs.constants.W_OK);
    return path.join(systemApps, `${APP_NAME}.app`);
  } catch {
    const userApps = path.join(os.homedir(), 'Applications');
    fs.mkdirSync(userApps, { recursive: true });
    return path.join(userApps, `${APP_NAME}.app`);
  }
}

function installMac(electronBinary) {
  // Brand the local Electron.app bundle first so Dock/Cmd+Tab show "Faktum"
  const brandScript = path.join(ROOT_DIR, 'scripts', 'brand-mac-dev.sh');
  if (fs.existsSync(brandScript)) {
    try {
      execFileSync('bash', [brandScript], { stdio: 'ignore' });
    } catch {
      // non-fatal
    }
  }

  const appDir = getMacAppDir();
  const contentsDir = path.join(appDir, 'Contents');
  const macOsDir = path.join(contentsDir, 'MacOS');
  const resourcesDir = path.join(contentsDir, 'Resources');

  fs.mkdirSync(macOsDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });

  const iconSrc = path.join(ROOT_DIR, 'build', 'icon.icns');
  const iconDst = path.join(resourcesDir, 'icon.icns');
  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, iconDst);
  }

  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${xmlEscape(APP_NAME)}</string>
  <key>CFBundleDisplayName</key>
  <string>${xmlEscape(APP_NAME)}</string>
  <key>CFBundleIdentifier</key>
  <string>${xmlEscape(MAC_BUNDLE_ID)}</string>
  <key>CFBundleVersion</key>
  <string>${xmlEscape(APP_VERSION)}</string>
  <key>CFBundleShortVersionString</key>
  <string>${xmlEscape(APP_VERSION)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>${xmlEscape(APP_NAME)}</string>
  <key>CFBundleIconFile</key>
  <string>icon.icns</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;
  fs.writeFileSync(path.join(contentsDir, 'Info.plist'), infoPlist, 'utf-8');

  const launcherPath = path.join(macOsDir, APP_NAME);
  const launcherScript = `#!/usr/bin/env bash
cd ${shSingleQuote(ROOT_DIR)} || exit 1
exec ${shSingleQuote(electronBinary)} ${shSingleQuote(ROOT_DIR)} "$@"
`;
  fs.writeFileSync(launcherPath, launcherScript, { mode: 0o755 });
  fs.chmodSync(launcherPath, 0o755);

  // Refresh Finder / LaunchServices icon and Spotlight metadata
  try {
    const now = new Date();
    fs.utimesSync(appDir, now, now);
    const lsregister =
      '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
    if (fs.existsSync(lsregister)) {
      execFileSync(lsregister, ['-f', appDir], { stdio: 'ignore' });
    }
  } catch {
    // non-fatal
  }

  console.log(`✓ ${APP_NAME} instalado en: ${appDir}`);
  console.log('  Puedes abrirlo desde Aplicaciones, Launchpad o Spotlight (Cmd + Espacio) sin abrir la terminal.');
  console.log('  Nota: no elimines esta carpeta del repositorio, ya que la aplicación se ejecuta desde aquí.');
}

function uninstallMac() {
  const candidates = [
    path.join('/Applications', `${APP_NAME}.app`),
    path.join(os.homedir(), 'Applications', `${APP_NAME}.app`),
  ];
  let removed = 0;
  for (const appDir of candidates) {
    const plistPath = path.join(appDir, 'Contents', 'Info.plist');
    if (fs.existsSync(plistPath)) {
      const content = fs.readFileSync(plistPath, 'utf-8');
      if (content.includes(MAC_BUNDLE_ID)) {
        fs.rmSync(appDir, { recursive: true, force: true });
        console.log(`✓ Eliminado: ${appDir}`);
        removed++;
      }
    }
  }
  if (removed === 0) {
    console.log('No se encontraron accesos directos instalados de Faktum en macOS.');
  }
}

/* ===========================
 * Windows (.lnk shortcuts)
 * =========================== */
function installWindows(electronBinary) {
  const iconPath = path.join(ROOT_DIR, 'build', 'icon.ico');
  const psScript = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Faktum.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Faktum.lnk')
)
foreach ($lnkPath in $targets) {
  $dir = Split-Path -Parent $lnkPath
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $sc = $shell.CreateShortcut($lnkPath)
  $sc.TargetPath = $env:FAKTUM_ELECTRON
  $sc.Arguments = '"' + $env:FAKTUM_ROOT + '"'
  $sc.WorkingDirectory = $env:FAKTUM_ROOT
  $sc.Description = 'Faktum — Comprobantes electronicos del SRI'
  if (Test-Path $env:FAKTUM_ICON) {
    $sc.IconLocation = $env:FAKTUM_ICON + ',0'
  }
  $sc.Save()
  Write-Output $lnkPath
}
`;

  const output = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    {
      encoding: 'utf-8',
      env: {
        ...process.env,
        FAKTUM_ELECTRON: electronBinary,
        FAKTUM_ROOT: ROOT_DIR,
        FAKTUM_ICON: iconPath,
      },
    }
  );

  for (const line of output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    console.log(`✓ Acceso directo creado: ${line}`);
  }
  console.log('  Puedes abrir Faktum desde el Escritorio o el Menú Inicio sin abrir la terminal.');
  console.log('  Nota: no elimines esta carpeta del repositorio, ya que la aplicación se ejecuta desde aquí.');
}

function uninstallWindows() {
  const psScript = `
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Faktum.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Faktum.lnk')
)
foreach ($lnkPath in $targets) {
  if (Test-Path $lnkPath) {
    Remove-Item -LiteralPath $lnkPath -Force
    Write-Output $lnkPath
  }
}
`;
  const output = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    { encoding: 'utf-8' }
  );
  const removed = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (removed.length === 0) {
    console.log('No se encontraron accesos directos de Faktum en Windows.');
  } else {
    for (const p of removed) console.log(`✓ Eliminado: ${p}`);
  }
}

/* ===========================
 * Linux (.desktop entries)
 * =========================== */
function getLinuxDesktopDir() {
  try {
    const out = execFileSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf-8' }).trim();
    if (out && out !== os.homedir() && fs.existsSync(out)) return out;
  } catch {
    // ignore
  }
  const fallback = path.join(os.homedir(), 'Desktop');
  return fs.existsSync(fallback) ? fallback : null;
}

function installLinux(electronBinary) {
  const appsDir = path.join(os.homedir(), '.local', 'share', 'applications');
  fs.mkdirSync(appsDir, { recursive: true });

  const iconPath = path.join(ROOT_DIR, 'build', 'icon.png');
  const execLine = [
    escapeDesktopExecArg(electronBinary),
    escapeDesktopExecArg(ROOT_DIR),
    ...(useNoSandbox ? ['--no-sandbox'] : []),
    '%U',
  ].join(' ');

  const desktopEntry = `[Desktop Entry]
Version=1.0
Type=Application
Name=${APP_NAME}
Comment=Descargador masivo de comprobantes electrónicos del SRI
Exec=${execLine}
Path=${ROOT_DIR}
Icon=${iconPath}
Terminal=false
Categories=Office;Finance;
StartupNotify=true
StartupWMClass=${APP_NAME}
`;

  const menuFile = path.join(appsDir, 'faktum.desktop');
  fs.writeFileSync(menuFile, desktopEntry, { mode: 0o755 });
  fs.chmodSync(menuFile, 0o755);
  console.log(`✓ Acceso directo en menú de aplicaciones: ${menuFile}`);

  const desktopDir = getLinuxDesktopDir();
  if (desktopDir) {
    const desktopFile = path.join(desktopDir, 'Faktum.desktop');
    fs.writeFileSync(desktopFile, desktopEntry, { mode: 0o755 });
    fs.chmodSync(desktopFile, 0o755);
    console.log(`✓ Acceso directo en el escritorio: ${desktopFile}`);
  }

  try {
    execFileSync('update-desktop-database', [appsDir], { stdio: 'ignore' });
  } catch {
    // non-fatal
  }

  console.log('  Puedes abrir Faktum desde tu menú de aplicaciones sin abrir la terminal.');
  console.log('  Nota: no elimines esta carpeta del repositorio, ya que la aplicación se ejecuta desde aquí.');
}

function uninstallLinux() {
  const candidates = [path.join(os.homedir(), '.local', 'share', 'applications', 'faktum.desktop')];
  const desktopDir = getLinuxDesktopDir();
  if (desktopDir) {
    candidates.push(path.join(desktopDir, 'Faktum.desktop'));
  }
  let removed = 0;
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`✓ Eliminado: ${file}`);
      removed++;
    }
  }
  if (removed === 0) {
    console.log('No se encontraron accesos directos de Faktum en Linux.');
  }
}

/* ===========================
 * Main
 * =========================== */
try {
  if (isUninstall) {
    if (process.platform === 'darwin') uninstallMac();
    else if (process.platform === 'win32') uninstallWindows();
    else if (process.platform === 'linux') uninstallLinux();
    else throw new Error(`Sistema operativo no soportado: ${process.platform}`);
    process.exit(0);
  }

  assertBuilt();
  const electronBinary = resolveElectronBinary();

  if (process.platform === 'darwin') installMac(electronBinary);
  else if (process.platform === 'win32') installWindows(electronBinary);
  else if (process.platform === 'linux') installLinux(electronBinary);
  else throw new Error(`Sistema operativo no soportado: ${process.platform}`);
} catch (err) {
  console.error(`Error configurando ${APP_NAME}:`, err instanceof Error ? err.message : String(err));
  process.exit(1);
}
