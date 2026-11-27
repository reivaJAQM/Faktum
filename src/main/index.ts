import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AppSettings,
  BoundsRect,
  CapturedBatchEvent,
  CapturedKeyEntry,
  DateRangeRequest,
  DownloadFormats,
  DownloadProgressEvent,
  PortalStatusEvent,
  RangeProgressEvent,
  RucProfileInput,
  SriQueryFilter,
} from '../shared/types';
import { extractKeysFromReportText } from './services/claveAcceso';
import { DownloadManager } from './services/downloadManager';
import { exportComprobantesToExcel } from './services/excelExporter';
import { buildComprobantePaths } from './services/pathLayout';
import { SriPortalManager } from './services/portalManager';
import { generateRidePdf } from './services/rideGenerator';
import { FaktumStore } from './services/store';

let mainWindow: BrowserWindow | null = null;
let store: FaktumStore;
let downloadManager: DownloadManager;
let portalManager: SriPortalManager | null = null;

function sendToRenderer<T>(channel: string, payload: T) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function resolveAppIconPath(): string | undefined {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const candidates = [
    path.join(app.getAppPath(), 'build', iconFile),
    path.join(__dirname, '../../build', iconFile),
    path.join(process.resourcesPath, iconFile),
    path.join(app.getAppPath(), 'build', 'icon.png'),
    path.join(__dirname, '../../build/icon.png'),
    path.join(process.resourcesPath, 'icon.png'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function createMainWindow() {
  const iconPath = resolveAppIconPath();

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: 'Faktum',
    backgroundColor: '#0f172a',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWindow?.setTitle('Faktum');
  });

  portalManager = new SriPortalManager(
    mainWindow,
    store,
    downloadManager,
    (event: PortalStatusEvent) => sendToRenderer('faktum:portal-status', event),
    (batch: CapturedBatchEvent) => sendToRenderer('faktum:captured-batch', batch),
    (rangeEv: RangeProgressEvent) => sendToRenderer('faktum:range-progress', rangeEv)
  );
  downloadManager.setOriginalPdfFetcher((params) => portalManager!.downloadOriginalSriPdf(params));
  downloadManager.setOriginalXmlFetcher((params) => portalManager!.downloadOriginalSriXml(params));

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    void mainWindow.loadURL('http://localhost:5173');
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    downloadManager.setOriginalPdfFetcher(null);
    downloadManager.setOriginalXmlFetcher(null);
    portalManager?.close();
    portalManager = null;
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  // Profiles
  ipcMain.handle('faktum:profiles:list', () => store.listProfiles());
  ipcMain.handle('faktum:profiles:save', (_e, input: RucProfileInput) => store.saveProfile(input));
  ipcMain.handle('faktum:profiles:delete', (_e, id: string) => store.deleteProfile(id));
  ipcMain.handle('faktum:encryption:available', () => store.isEncryptionAvailable());

  // Settings
  ipcMain.handle('faktum:settings:get', () => store.getSettings());
  ipcMain.handle('faktum:settings:update', (_e, partial: Partial<AppSettings>) =>
    store.updateSettings(partial)
  );
  ipcMain.handle('faktum:settings:choose-dir', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecciona la carpeta destino para tus comprobantes del SRI',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const chosen = res.filePaths[0];
    store.updateSettings({ outputDir: chosen });
    return chosen;
  });

  // Portal SRI
  ipcMain.handle('faktum:portal:open', async (_e, filter: SriQueryFilter, bounds: BoundsRect) => {
    if (!portalManager) throw new Error('Ventana principal no inicializada.');
    await portalManager.open(filter, bounds);
  });
  ipcMain.handle(
    'faktum:portal:consult-month',
    async (_e, filter: SriQueryFilter, bounds: BoundsRect) => {
      if (!portalManager) return { ok: false, message: 'Portal no inicializado.' };
      return portalManager.consultMonth(filter, bounds);
    }
  );
  ipcMain.handle('faktum:portal:bounds', (_e, bounds: BoundsRect, visible: boolean) => {
    portalManager?.setBounds(bounds, visible);
  });
  ipcMain.handle('faktum:portal:close', () => {
    portalManager?.close();
  });
  ipcMain.handle('faktum:portal:clear-session', async (_e, profileId: string) => {
    await portalManager?.clearSession(profileId);
  });
  ipcMain.handle('faktum:portal:filters', async (_e, filter: SriQueryFilter) => {
    if (!portalManager) return { ok: false, message: 'Portal no inicializado.' };
    return portalManager.applyFilters(filter);
  });
  ipcMain.handle('faktum:portal:capture', async () => {
    if (!portalManager) return { ok: false, message: 'Portal no inicializado.' };
    return portalManager.captureFromPortal();
  });
  ipcMain.handle('faktum:portal:reload', async () => {
    await portalManager?.reload();
  });

  // Multi-month Date Range Orchestration
  ipcMain.handle('faktum:range:start', async (_e, req: DateRangeRequest, bounds: BoundsRect) => {
    if (!portalManager) return { ok: false, message: 'Portal no inicializado.' };
    return portalManager.startDateRange(req, bounds);
  });
  ipcMain.handle('faktum:range:skip', async () => {
    await portalManager?.skipRangeMonth();
  });
  ipcMain.handle('faktum:range:cancel', async () => {
    await portalManager?.cancelDateRange();
  });

  // Downloads & History
  ipcMain.handle(
    'faktum:download:start-selected',
    async (
      _e,
      params: {
        profileId: string;
        entries: CapturedKeyEntry[];
        periodYear?: number;
        periodMonth?: number;
        formats?: DownloadFormats;
        exportExcel?: boolean;
      }
    ) => {
      if (downloadManager.isBusy()) {
        return { ok: false, message: 'Ya hay una descarga en progreso.' };
      }
      if (!params.entries || params.entries.length === 0) {
        return { ok: false, message: 'Selecciona al menos un comprobante para descargar.' };
      }
      void downloadManager.runBatch(params);
      return { ok: true };
    }
  );
  ipcMain.handle('faktum:pdf:generate', async (_e, claveAcceso: string) => {
    const comp = store.getComprobanteByKey(claveAcceso);
    if (!comp) {
      return { ok: false, message: 'No se encontró el comprobante en el historial.' };
    }
    if (comp.pdfPath && comp.pdfSource === 'sri' && fs.existsSync(comp.pdfPath)) {
      return { ok: true, pdfPath: comp.pdfPath };
    }
    const profileInfo = store.getProfileWithPassword(comp.profileId);
    const [yStr, mStr] = (comp.fechaEmisionIso || '').split('-');
    const paths = buildComprobantePaths({
      outputDir: store.getSettings().outputDir,
      ownerRuc: comp.ownerRuc || profileInfo?.profile.ruc || 'SRI',
      ownerAlias: profileInfo?.profile.alias || 'Empresa',
      year: yStr && /^\d{4}$/.test(yStr) ? yStr : String(new Date().getFullYear()),
      month: mStr && /^\d{2}$/.test(mStr) ? Number(mStr) : new Date().getMonth() + 1,
      rucEmisor: comp.rucEmisor,
      razonSocialEmisor: comp.razonSocialEmisor,
      tipoCodigo: comp.tipoCodigo,
      fechaEmisionIso: comp.fechaEmisionIso,
      numeroComprobante: comp.numeroComprobante,
      claveAcceso: comp.claveAcceso,
    });

    if (portalManager && portalManager.isOnRecibidosPage()) {
      const res = await portalManager.downloadOriginalSriPdf({
        claveAcceso: comp.claveAcceso,
        numeroComprobante: comp.numeroComprobante,
        rucEmisor: comp.rucEmisor,
      });
      if (res.ok && res.buffer) {
        fs.mkdirSync(paths.pdfDir, { recursive: true });
        await fs.promises.writeFile(paths.pdfPath, res.buffer);
        store.upsertComprobantes([{ ...comp, pdfPath: paths.pdfPath, pdfSource: 'sri' }]);
        return { ok: true, pdfPath: paths.pdfPath };
      }
    }

    if (comp.pdfPath && fs.existsSync(comp.pdfPath)) {
      return { ok: true, pdfPath: comp.pdfPath };
    }

    try {
      fs.mkdirSync(paths.pdfDir, { recursive: true });
      await generateRidePdf(comp, paths.pdfPath);
      store.upsertComprobantes([{ ...comp, pdfPath: paths.pdfPath, pdfSource: 'local' }]);
      return { ok: true, pdfPath: paths.pdfPath };
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo obtener ni generar el PDF RIDE de este comprobante.',
      };
    }
  });
  ipcMain.handle('faktum:files:reorganize', async () => {
    const settings = store.getSettings();
    const profiles = new Map(store.listProfiles().map((p) => [p.id, p]));
    const all = store.listComprobantes();
    const updated: typeof all = [];
    const touchedOldDirs = new Set<string>();
    let moved = 0;

    const moveSafe = (src: string, dest: string): boolean => {
      if (!src || !fs.existsSync(src)) return false;
      if (path.resolve(src) === path.resolve(dest)) return false;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        fs.renameSync(src, dest);
      } catch {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
      }
      touchedOldDirs.add(path.dirname(src));
      return true;
    };

    for (const c of all) {
      const profile = profiles.get(c.profileId);
      const [yStr, mStr] = (c.fechaEmisionIso || '').split('-');
      const paths = buildComprobantePaths({
        outputDir: settings.outputDir,
        ownerRuc: c.ownerRuc || profile?.ruc || 'SRI',
        ownerAlias: profile?.alias || 'Empresa',
        year: yStr && /^\d{4}$/.test(yStr) ? yStr : String(new Date().getFullYear()),
        month: mStr && /^\d{2}$/.test(mStr) ? Number(mStr) : new Date().getMonth() + 1,
        rucEmisor: c.rucEmisor,
        razonSocialEmisor: c.razonSocialEmisor,
        tipoCodigo: c.tipoCodigo,
        fechaEmisionIso: c.fechaEmisionIso,
        numeroComprobante: c.numeroComprobante,
        claveAcceso: c.claveAcceso,
      });

      let changed = false;
      const next = { ...c };

      if (c.xmlPath && fs.existsSync(c.xmlPath) && moveSafe(c.xmlPath, paths.xmlPath)) {
        next.xmlPath = paths.xmlPath;
        moved++;
        changed = true;
      }
      if (c.pdfPath && fs.existsSync(c.pdfPath) && moveSafe(c.pdfPath, paths.pdfPath)) {
        next.pdfPath = paths.pdfPath;
        moved++;
        changed = true;
      }
      if (changed) updated.push(next);
    }

    if (updated.length > 0) {
      store.upsertComprobantes(updated);
    }

    // Clean up now-empty legacy folders (up to 3 levels up within outputDir)
    const rootResolved = path.resolve(settings.outputDir);
    for (const startDir of touchedOldDirs) {
      let cur = path.resolve(startDir);
      for (let depth = 0; depth < 3; depth++) {
        if (cur === rootResolved || !cur.startsWith(rootResolved)) break;
        try {
          if (fs.existsSync(cur) && fs.readdirSync(cur).length === 0) {
            fs.rmdirSync(cur);
            cur = path.dirname(cur);
          } else {
            break;
          }
        } catch {
          break;
        }
      }
    }

    return {
      ok: true,
      moved,
      message:
        moved > 0
          ? `Se reorganizaron ${moved} archivo(s) en carpetas por Razón Social activa → Año / Mes → XML / PDF.`
          : 'Tus archivos ya estaban organizados con la nueva estructura.',
    };
  });
  ipcMain.handle(
    'faktum:download:manual-keys',
    async (_e, profileId: string, rawText: string, year?: number, month?: number) => {
      const entries = extractKeysFromReportText(rawText);
      if (entries.length === 0) {
        return {
          ok: false,
          count: 0,
          message: 'No se encontraron claves de acceso válidas de 49 dígitos.',
        };
      }
      void downloadManager.runBatch({
        profileId,
        entries,
        periodYear: year,
        periodMonth: month,
      });
      return {
        ok: true,
        count: entries.length,
        message: `Descargando ${entries.length} comprobantes desde el Web Service oficial del SRI...`,
      };
    }
  );
  ipcMain.handle('faktum:download:cancel', () => {
    downloadManager.cancel();
  });
  ipcMain.handle(
    'faktum:history:list',
    (
      _e,
      filter?: { profileId?: string; year?: number; month?: number; tipoCodigo?: string; search?: string }
    ) => store.listComprobantes(filter)
  );
  ipcMain.handle('faktum:history:delete', (_e, claveAcceso: string) => {
    store.deleteComprobanteRecord(claveAcceso);
  });
  ipcMain.handle('faktum:excel:export', async (_e, keys: string[], title?: string) => {
    if (!mainWindow) return { ok: false, message: 'Ventana no disponible.' };
    const items = store.getComprobantesByKeys(keys);
    if (items.length === 0) {
      return { ok: false, message: 'No hay comprobantes seleccionados para exportar.' };
    }
    const defaultName = `${title || 'Faktum_Comprobantes'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const saveRes = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar Excel consolidado',
      defaultPath: path.join(store.getSettings().outputDir, defaultName),
      filters: [{ name: 'Libro de Excel', extensions: ['xlsx'] }],
    });
    if (saveRes.canceled || !saveRes.filePath) {
      return { ok: false, message: 'Exportación cancelada.' };
    }
    const filePath = await exportComprobantesToExcel(items, saveRes.filePath);
    return { ok: true, filePath };
  });
  ipcMain.handle('faktum:shell:open', async (_e, targetPath: string) => {
    const fallbackDir = store.getSettings().outputDir;
    let resolved = targetPath || fallbackDir;

    if (!fs.existsSync(resolved)) {
      // If a specific file or month folder doesn't exist yet, walk up to the nearest existing folder or create outputDir
      const hasFileExt = /\.(xml|pdf|xlsx|csv|txt)$/i.test(resolved);
      let candidate = hasFileExt ? path.dirname(resolved) : resolved;
      while (candidate && candidate !== path.dirname(candidate) && !fs.existsSync(candidate)) {
        candidate = path.dirname(candidate);
      }
      if (candidate && fs.existsSync(candidate)) {
        resolved = candidate;
      } else {
        fs.mkdirSync(fallbackDir, { recursive: true });
        resolved = fallbackDir;
      }
    }

    await shell.openPath(resolved);
  });
}

function setupApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Faktum',
      submenu: [
        { role: 'about', label: 'Acerca de Faktum' },
        { type: 'separator' },
        { role: 'services', label: 'Servicios' },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar Faktum' },
        { role: 'hideOthers', label: 'Ocultar otros' },
        { role: 'unhide', label: 'Mostrar todo' },
        { type: 'separator' },
        { role: 'quit', label: 'Salir de Faktum' },
      ],
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
    {
      label: 'Ventana',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        { role: 'close', label: 'Cerrar ventana' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  app.setName('Faktum');
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.faktum.sri');
  }
  app.setAboutPanelOptions({ applicationName: 'Faktum', applicationVersion: app.getVersion() });
  setupApplicationMenu();
  const iconPath = resolveAppIconPath();
  if (process.platform === 'darwin' && iconPath && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(iconPath));
  }
  store = new FaktumStore();
  downloadManager = new DownloadManager(store, (event: DownloadProgressEvent) =>
    sendToRenderer('faktum:download-progress', event)
  );
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
