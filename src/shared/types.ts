export type SriDocCode = '01' | '03' | '04' | '05' | '06' | '07' | '00';

export const SRI_DOC_TYPES: Record<string, { code: SriDocCode; label: string; folder: string; sriSelectValue: string }> = {
  ALL: { code: '00', label: 'Todos los comprobantes', folder: 'Todos', sriSelectValue: '0' },
  '01': { code: '01', label: 'Factura', folder: 'Facturas', sriSelectValue: '1' },
  '03': { code: '03', label: 'Liquidación de Compra', folder: 'Liquidaciones_Compra', sriSelectValue: '2' },
  '04': { code: '04', label: 'Nota de Crédito', folder: 'Notas_Credito', sriSelectValue: '3' },
  '05': { code: '05', label: 'Nota de Débito', folder: 'Notas_Debito', sriSelectValue: '4' },
  '06': { code: '06', label: 'Guía de Remisión', folder: 'Guias_Remision', sriSelectValue: '5' },
  '07': { code: '07', label: 'Comprobante de Retención', folder: 'Retenciones', sriSelectValue: '6' },
};

/**
 * Exact document types offered by the SRI "Comprobantes electrónicos recibidos" dropdown.
 * (`ALL` and `06` Guía de Remisión are kept in `SRI_DOC_TYPES` for History filtering and XML parsing.)
 */
export const SRI_PORTAL_RECIBIDOS_DOC_CODES = ['01', '03', '04', '05', '07'] as const;

export interface RucProfile {
  id: string;
  ruc: string;
  alias: string;
  hasPassword: boolean;
  createdAt: string;
  lastSyncAt?: string;
}

export interface RucProfileInput {
  id?: string;
  ruc: string;
  alias: string;
  password?: string;
}

export interface DownloadFormats {
  xml: boolean;
  pdf: boolean;
  excel: boolean;
}

export interface AppSettings {
  outputDir: string;
  concurrency: number;
  autoExportExcel: boolean;
  defaultDownloadXml: boolean;
  defaultDownloadPdf: boolean;
  autoTriggerReportAfterSearch: boolean;
}

export interface SriQueryFilter {
  profileId: string;
  year: number;
  month: number; // 1..12
  day: number; // 0 = todos
  docType: string; // 'ALL' | '01' | '03' | '04' | '05' | '06' | '07'
}

export interface CapturedKeyEntry {
  claveAcceso: string;
  rowIndex?: number;
  rucEmisor?: string;
  razonSocialEmisor?: string;
  tipoComprobante?: string;
  serieComprobante?: string;
  fechaEmision?: string;
  fechaAutorizacion?: string;
  importeTotal?: number;
  alreadyDownloaded?: boolean;
}

export interface CapturedBatchEvent {
  profileId: string;
  ownerRuc: string;
  periodYear: number;
  periodMonth: number;
  entries: CapturedKeyEntry[];
}

export interface ParsedDetailItem {
  claveAcceso: string;
  numeroComprobante: string;
  fechaEmision: string;
  rucEmisor: string;
  razonSocialEmisor: string;
  tipoComprobante: string;
  codigoPrincipal: string;
  codigoAuxiliar: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  precioTotalSinImpuesto: number;
  ivaValor: number;
  ivaTarifa: string;
}

export interface ParsedRetencionItem {
  claveAcceso: string;
  numeroComprobante: string;
  fechaEmision: string;
  rucEmisor: string;
  razonSocialEmisor: string;
  impuesto: string;
  codigoRetencion: string;
  baseImponible: number;
  porcentajeRetener: number;
  valorRetenido: number;
  docSustentoTipo: string;
  docSustentoNumero: string;
  docSustentoFecha: string;
}

export interface ParsedComprobante {
  claveAcceso: string;
  profileId: string;
  ownerRuc: string;
  tipoCodigo: SriDocCode;
  tipoNombre: string;
  numeroComprobante: string;
  fechaEmision: string; // dd/MM/yyyy
  fechaEmisionIso: string; // yyyy-MM-dd
  fechaAutorizacion: string;
  estado: string;
  ambiente: string;
  rucEmisor: string;
  razonSocialEmisor: string;
  nombreComercialEmisor: string;
  identificacionReceptor: string;
  razonSocialReceptor: string;
  subtotal0: number;
  subtotalIva: number;
  subtotalNoObjeto: number;
  subtotalExento: number;
  totalSinImpuestos: number;
  totalDescuento: number;
  iva: number;
  ice: number;
  propina: number;
  importeTotal: number;
  formaPago: string;
  docModificado: string;
  motivo: string;
  xmlPath: string;
  pdfPath?: string;
  pdfSource?: 'sri' | 'local';
  downloadedAt: string;
  detalles: ParsedDetailItem[];
  retenciones: ParsedRetencionItem[];
}

export type PortalState =
  | 'idle'
  | 'loading'
  | 'login_ready'
  | 'consult_ready'
  | 'results_detected'
  | 'downloading'
  | 'error';

export interface PortalStatusEvent {
  state: PortalState;
  url: string;
  message: string;
  hasReportButton?: boolean;
  detectedKeysCount?: number;
}

export interface DownloadProgressEvent {
  jobId: string;
  status: 'running' | 'completed' | 'cancelled' | 'error';
  total: number;
  processed: number;
  downloaded: number;
  skipped: number;
  failed: number;
  currentKey?: string;
  currentEmitter?: string;
  excelPath?: string;
  outputFolder?: string;
  errors: Array<{ claveAcceso: string; reason: string }>;
}

export interface DateRangeRequest {
  profileId: string;
  fromDate: string; // yyyy-MM-dd
  toDate: string; // yyyy-MM-dd
  docType: string;
  formats: DownloadFormats;
}

export interface RangeProgressEvent {
  active: boolean;
  fromDate: string;
  toDate: string;
  currentIndex: number;
  totalMonths: number;
  currentYear: number;
  currentMonth: number;
  completedMonths: number;
  totalComprobantes: number;
  status: 'waiting_consult' | 'consulting' | 'downloading_month' | 'completed' | 'cancelled';
  rangeExcelPath?: string;
  outputFolder?: string;
}

export interface BoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaktumApi {
  // Profiles
  listProfiles(): Promise<RucProfile[]>;
  saveProfile(input: RucProfileInput): Promise<RucProfile>;
  deleteProfile(id: string): Promise<void>;
  isEncryptionAvailable(): Promise<boolean>;

  // Settings
  getSettings(): Promise<AppSettings>;
  updateSettings(partial: Partial<AppSettings>): Promise<AppSettings>;
  chooseOutputDir(): Promise<string | null>;

  // Portal SRI embedded WebContentsView
  openPortal(filter: SriQueryFilter, bounds: BoundsRect): Promise<void>;
  consultMonth(filter: SriQueryFilter, bounds: BoundsRect): Promise<{ ok: boolean; message?: string }>;
  updatePortalBounds(bounds: BoundsRect, visible: boolean): Promise<void>;
  closePortal(): Promise<void>;
  clearPortalSession(profileId: string): Promise<void>;
  applyPortalFilters(filter: SriQueryFilter): Promise<{ ok: boolean; message: string }>;
  captureFromPortal(): Promise<{ ok: boolean; message: string; triggeredDownload?: boolean; count?: number }>;
  reloadPortal(): Promise<void>;

  // Date Range Multi-Month Orchestration
  startDateRange(req: DateRangeRequest, bounds: BoundsRect): Promise<{ ok: boolean; message?: string }>;
  skipRangeMonth(): Promise<void>;
  cancelDateRange(): Promise<void>;

  // Downloads & History
  startSelectedDownload(params: {
    profileId: string;
    entries: CapturedKeyEntry[];
    periodYear?: number;
    periodMonth?: number;
    formats?: DownloadFormats;
    exportExcel?: boolean;
  }): Promise<{ ok: boolean; message?: string }>;
  generatePdfForComprobante(claveAcceso: string): Promise<{ ok: boolean; pdfPath?: string; message?: string }>;
  reorganizeDownloadedFiles(): Promise<{ ok: boolean; moved: number; message: string }>;
  downloadManualKeys(profileId: string, rawText: string, year?: number, month?: number): Promise<{ ok: boolean; count: number; message: string }>;
  cancelDownload(): Promise<void>;
  listComprobantes(filter?: { profileId?: string; year?: number; month?: number; tipoCodigo?: string; search?: string }): Promise<ParsedComprobante[]>;
  exportExcel(comprobanteKeys: string[], title?: string): Promise<{ ok: boolean; filePath?: string; message?: string }>;
  openPathInExplorer(targetPath: string): Promise<void>;
  deleteComprobanteRecord(claveAcceso: string): Promise<void>;

  // Events
  onPortalStatus(cb: (event: PortalStatusEvent) => void): () => void;
  onCapturedBatch(cb: (event: CapturedBatchEvent) => void): () => void;
  onDownloadProgress(cb: (event: DownloadProgressEvent) => void): () => void;
  onRangeProgress(cb: (event: RangeProgressEvent) => void): () => void;
}
