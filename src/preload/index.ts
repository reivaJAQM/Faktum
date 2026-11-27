import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  BoundsRect,
  CapturedBatchEvent,
  DateRangeRequest,
  DownloadProgressEvent,
  FaktumApi,
  PortalStatusEvent,
  RangeProgressEvent,
  RucProfileInput,
  SriQueryFilter,
} from '../shared/types';

const api: FaktumApi = {
  listProfiles: () => ipcRenderer.invoke('faktum:profiles:list'),
  saveProfile: (input: RucProfileInput) => ipcRenderer.invoke('faktum:profiles:save', input),
  deleteProfile: (id: string) => ipcRenderer.invoke('faktum:profiles:delete', id),
  isEncryptionAvailable: () => ipcRenderer.invoke('faktum:encryption:available'),

  getSettings: () => ipcRenderer.invoke('faktum:settings:get'),
  updateSettings: (partial: Partial<AppSettings>) =>
    ipcRenderer.invoke('faktum:settings:update', partial),
  chooseOutputDir: () => ipcRenderer.invoke('faktum:settings:choose-dir'),

  openPortal: (filter: SriQueryFilter, bounds: BoundsRect) =>
    ipcRenderer.invoke('faktum:portal:open', filter, bounds),
  consultMonth: (filter: SriQueryFilter, bounds: BoundsRect) =>
    ipcRenderer.invoke('faktum:portal:consult-month', filter, bounds),
  updatePortalBounds: (bounds: BoundsRect, visible: boolean) =>
    ipcRenderer.invoke('faktum:portal:bounds', bounds, visible),
  closePortal: () => ipcRenderer.invoke('faktum:portal:close'),
  clearPortalSession: (profileId: string) =>
    ipcRenderer.invoke('faktum:portal:clear-session', profileId),
  applyPortalFilters: (filter: SriQueryFilter) =>
    ipcRenderer.invoke('faktum:portal:filters', filter),
  captureFromPortal: () => ipcRenderer.invoke('faktum:portal:capture'),
  reloadPortal: () => ipcRenderer.invoke('faktum:portal:reload'),

  startDateRange: (req: DateRangeRequest, bounds: BoundsRect) =>
    ipcRenderer.invoke('faktum:range:start', req, bounds),
  skipRangeMonth: () => ipcRenderer.invoke('faktum:range:skip'),
  cancelDateRange: () => ipcRenderer.invoke('faktum:range:cancel'),

  startSelectedDownload: (params) => ipcRenderer.invoke('faktum:download:start-selected', params),
  generatePdfForComprobante: (claveAcceso: string) =>
    ipcRenderer.invoke('faktum:pdf:generate', claveAcceso),
  reorganizeDownloadedFiles: () => ipcRenderer.invoke('faktum:files:reorganize'),
  downloadManualKeys: (profileId: string, rawText: string, year?: number, month?: number) =>
    ipcRenderer.invoke('faktum:download:manual-keys', profileId, rawText, year, month),
  cancelDownload: () => ipcRenderer.invoke('faktum:download:cancel'),
  listComprobantes: (filter) => ipcRenderer.invoke('faktum:history:list', filter),
  exportExcel: (keys: string[], title?: string) =>
    ipcRenderer.invoke('faktum:excel:export', keys, title),
  openPathInExplorer: (targetPath: string) => ipcRenderer.invoke('faktum:shell:open', targetPath),
  deleteComprobanteRecord: (claveAcceso: string) =>
    ipcRenderer.invoke('faktum:history:delete', claveAcceso),

  onPortalStatus: (cb: (event: PortalStatusEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, data: PortalStatusEvent) => cb(data);
    ipcRenderer.on('faktum:portal-status', listener);
    return () => ipcRenderer.removeListener('faktum:portal-status', listener);
  },
  onCapturedBatch: (cb: (event: CapturedBatchEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, data: CapturedBatchEvent) => cb(data);
    ipcRenderer.on('faktum:captured-batch', listener);
    return () => ipcRenderer.removeListener('faktum:captured-batch', listener);
  },
  onDownloadProgress: (cb: (event: DownloadProgressEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, data: DownloadProgressEvent) => cb(data);
    ipcRenderer.on('faktum:download-progress', listener);
    return () => ipcRenderer.removeListener('faktum:download-progress', listener);
  },
  onRangeProgress: (cb: (event: RangeProgressEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, data: RangeProgressEvent) => cb(data);
    ipcRenderer.on('faktum:range-progress', listener);
    return () => ipcRenderer.removeListener('faktum:range-progress', listener);
  },
};

contextBridge.exposeInMainWorld('faktum', api);
