import { BrowserWindow, WebContentsView, app, session } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SRI_DOC_TYPES,
  type BoundsRect,
  type CapturedBatchEvent,
  type CapturedKeyEntry,
  type DateRangeRequest,
  type DownloadFormats,
  type ParsedComprobante,
  type PortalStatusEvent,
  type RangeProgressEvent,
  type SriQueryFilter,
} from '../../shared/types';
import { decodeSriBuffer, extractKeysFromReportText } from './claveAcceso';
import { expandMonthsInRange, isEntryWithinDateRange, type YearMonth } from './dateRange';
import type { DownloadManager } from './downloadManager';
import { exportComprobantesToExcel } from './excelExporter';
import { getOwnerFolderName } from './pathLayout';
import type { FaktumStore } from './store';

interface PendingNativeDocDownload {
  kind: 'pdf' | 'xml';
  resolve: (res: { ok: boolean; buffer?: Buffer; reason?: string }) => void;
  timer: NodeJS.Timeout;
}

interface ActiveRangeSession {
  profileId: string;
  ownerRuc: string;
  ownerAlias: string;
  fromDate: string;
  toDate: string;
  docType: string;
  formats: DownloadFormats;
  months: YearMonth[];
  currentIndex: number;
  completedMonths: number;
  collected: Map<string, ParsedComprobante>;
}

const MONTH_LABELS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const SRI_PORTAL_ENTRY_URL = 'https://srienlinea.sri.gob.ec/sri-en-linea/contribuyente/perfil';
const SRI_RECIBIDOS_URL =
  'https://srienlinea.sri.gob.ec/comprobantes-electronicos-internet/pages/consultas/recibidos/comprobantesRecibidos.jsf';

function getStandardChromeUserAgent(rawUa: string): string {
  const cleaned = rawUa
    .replace(/\s+faktum\/[^\s]+/gi, '')
    .replace(/\s+Electron\/[^\s]+/gi, '')
    .trim();
  return (
    cleaned ||
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  );
}

function sanitizeUrlForLog(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const safeParams = new URLSearchParams();
    for (const [k, v] of u.searchParams.entries()) {
      if (['redireccion', 'idGrupo', 'urlAplicacion', 'client_id', 'error'].includes(k)) {
        safeParams.set(k, v.slice(0, 120));
      } else {
        safeParams.set(k, '<redacted>');
      }
    }
    const qs = safeParams.toString();
    return `${u.origin}${u.pathname}${qs ? `?${qs}` : ''}`;
  } catch {
    return rawUrl.slice(0, 120);
  }
}

export class SriPortalManager {
  private view: WebContentsView | null = null;
  private currentFilter: SriQueryFilter | null = null;
  private currentPartition: string | null = null;
  private lastBounds: BoundsRect = { x: 0, y: 0, width: 0, height: 0 };
  private isVisible = false;
  private hookedPartitions = new Set<string>();
  private pollTimer: NodeJS.Timeout | null = null;
  private lastAutoCapturedSignature = '';
  private lastRangeKeysFingerprint = '';
  private hasAttemptedAutoLogin = false;
  private hasNavigatedFromProfile = false;
  private menuNavInFlight = false;
  private portalDocBusy = false;
  private portalDocWaiters: Array<{
    rowIndex: number;
    resolve: () => void;
  }> = [];
  private lastActiveTablePage = 1;
  private preferNativeClick = false;
  private pendingNativeDocDownload: PendingNativeDocDownload | null = null;
  private lastPortalDocFetchAt = 0;
  private knownTablePageSize = 50;
  private activeRange: ActiveRangeSession | null = null;
  private autoConsultMonthKey = '';
  private autoConsultClickedAt = 0;
  private rangeAdvanceInFlight = false;
  private pendingMonthConsult = false;
  private awaitingMonthConsult = false;
  private monthConsultPreSignature = '';
  private monthConsultAt = 0;
  private readonly traceLogPath: string;

  constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly store: FaktumStore,
    private readonly downloadManager: DownloadManager,
    private readonly onPortalStatus: (event: PortalStatusEvent) => void,
    private readonly onCapturedBatch: (batch: CapturedBatchEvent) => void,
    private readonly onRangeProgress: (event: RangeProgressEvent) => void
  ) {
    // Write trace log inside project directory in dev/local or userData when packaged
    const cwdLog = path.join(process.cwd(), 'sri-trace.log');
    this.traceLogPath = fs.existsSync(path.join(process.cwd(), 'package.json'))
      ? cwdLog
      : path.join(app.getPath('userData'), 'sri-trace.log');
  }

  private trace(tag: string, detail: string) {
    try {
      const line = `[${new Date().toISOString()}] ${tag}: ${detail}\n`;
      fs.appendFileSync(this.traceLogPath, line, 'utf-8');
    } catch {
      // ignore logging errors
    }
  }

  private emitStatus(event: PortalStatusEvent) {
    this.onPortalStatus(event);
  }

  private async safeLoadUrl(url: string): Promise<void> {
    if (!this.view) return;
    this.trace('LOAD_URL', sanitizeUrlForLog(url));
    try {
      await this.view.webContents.loadURL(url);
    } catch (err) {
      const code = (err as { code?: string; errno?: number })?.code;
      const errno = (err as { errno?: number })?.errno;
      if (code === 'ERR_ABORTED' || errno === -3) return;
      this.trace('LOAD_ERR', `${code ?? errno}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  public async open(filter: SriQueryFilter, bounds: BoundsRect): Promise<void> {
    const profileData = this.store.getProfileWithPassword(filter.profileId);
    if (!profileData) {
      throw new Error('Selecciona un perfil de RUC válido antes de abrir el portal del SRI.');
    }

    const partition = `persist:sri-${profileData.profile.ruc}`;
    this.currentFilter = filter;
    this.lastBounds = bounds;
    this.lastAutoCapturedSignature = '';
    this.hasAttemptedAutoLogin = false;
    this.hasNavigatedFromProfile = false;
    this.menuNavInFlight = false;
    this.pendingMonthConsult = false;
    this.awaitingMonthConsult = false;

    this.trace('OPEN_PORTAL', `ruc=${profileData.profile.ruc} hasPass=${profileData.profile.hasPassword}`);

    if (!this.view || this.currentPartition !== partition) {
      this.destroyView();
      const sriSession = session.fromPartition(partition);
      const chromeUa = getStandardChromeUserAgent(sriSession.getUserAgent());
      sriSession.setUserAgent(chromeUa);
      this.attachDownloadInterceptor(sriSession, partition);

      this.view = new WebContentsView({
        webPreferences: {
          partition,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      this.view.webContents.setUserAgent(chromeUa);
      this.currentPartition = partition;
      this.mainWindow.contentView.addChildView(this.view);
      this.wireWebContentsEvents(this.view);
    }

    this.setBounds(bounds, true);
    this.emitStatus({
      state: 'loading',
      url: SRI_PORTAL_ENTRY_URL,
      message: `Conectando con SRI en Línea para ${profileData.profile.alias} (${profileData.profile.ruc})...`,
    });

    // Always enter through the official SRI portal entry so Keycloak & Angular initialize session cleanly
    await this.safeLoadUrl(SRI_PORTAL_ENTRY_URL);
  }

  public async startDateRange(
    req: DateRangeRequest,
    bounds: BoundsRect
  ): Promise<{ ok: boolean; message?: string }> {
    const profileData = this.store.getProfileWithPassword(req.profileId);
    if (!profileData) {
      return { ok: false, message: 'Selecciona un perfil de RUC válido antes de iniciar el rango.' };
    }
    const months = expandMonthsInRange(req.fromDate, req.toDate);
    if (months.length === 0) {
      return { ok: false, message: 'El rango de fechas seleccionado no es válido.' };
    }

    const [fromDate, toDate] =
      req.fromDate <= req.toDate ? [req.fromDate, req.toDate] : [req.toDate, req.fromDate];

    this.activeRange = {
      profileId: profileData.profile.id,
      ownerRuc: profileData.profile.ruc,
      ownerAlias: profileData.profile.alias,
      fromDate,
      toDate,
      docType: req.docType,
      formats: req.formats,
      months,
      currentIndex: 0,
      completedMonths: 0,
      collected: new Map<string, ParsedComprobante>(),
    };

    const first = months[0];
    const firstFilter: SriQueryFilter = {
      profileId: req.profileId,
      year: first.year,
      month: first.month,
      day: 0,
      docType: req.docType,
    };

    const partition = `persist:sri-${profileData.profile.ruc}`;
    this.lastRangeKeysFingerprint = '';
    this.autoConsultMonthKey = '';
    this.autoConsultClickedAt = 0;
    this.rangeAdvanceInFlight = false;
    this.emitRangeProgress('waiting_consult');

    if (this.view && this.currentPartition === partition && this.isOnRecibidosPage()) {
      this.setBounds(bounds, true);
      // Preserve lastAutoCapturedSignature so any previous table currently on screen
      // isn't mistakenly re-captured as Month 1 before the new query completes.
      await this.applyFilters(firstFilter, true);
      await this.autoConsultCurrentMonth();
    } else {
      await this.open(firstFilter, bounds);
    }

    return { ok: true };
  }

  /**
   * Single-month automatic download entry point used by the "Descargar Facturas" button in
   * "Por mes" mode. Connects if needed, applies the month filters and clicks «Consultar» for you.
   */
  public async consultMonth(
    filter: SriQueryFilter,
    bounds: BoundsRect
  ): Promise<{ ok: boolean; message?: string }> {
    const profileData = this.store.getProfileWithPassword(filter.profileId);
    if (!profileData) {
      return { ok: false, message: 'Selecciona un perfil de RUC válido antes de descargar.' };
    }

    const partition = `persist:sri-${profileData.profile.ruc}`;
    this.currentFilter = filter;
    this.awaitingMonthConsult = false;
    this.pendingMonthConsult = false;

    if (this.view && this.currentPartition === partition && this.isOnRecibidosPage()) {
      this.setBounds(bounds, true);
      await this.applyFilters(filter, false);
      this.pendingMonthConsult = true;
      await this.triggerPendingMonthConsult();
      return { ok: true };
    }

    await this.open(filter, bounds);
    // Arm the query for when the Comprobantes Recibidos page finishes loading (post login).
    this.pendingMonthConsult = true;
    if (this.isOnRecibidosPage()) {
      await this.triggerPendingMonthConsult();
    }
    return { ok: true };
  }

  private async triggerPendingMonthConsult(): Promise<void> {
    if (!this.pendingMonthConsult || !this.currentFilter || !this.view) return;
    if (this.activeRange || !this.isOnRecibidosPage()) return;

    this.pendingMonthConsult = false;
    const filter = this.currentFilter;
    const mLabel = MONTH_LABELS_ES[filter.month - 1] ?? String(filter.month);

    await new Promise((resolve) => setTimeout(resolve, 450));

    let res = await this.clickConsultar();
    if (!res.clicked && !res.captcha && (res.reason === 'no_button' || res.reason === 'disabled')) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      res = await this.clickConsultar();
    }

    this.trace(
      'MONTH_CONSULT',
      `month=${filter.year}-${filter.month} day=${filter.day} clicked=${res.clicked} reason=${res.reason ?? ''} captcha=${Boolean(res.captcha)}`
    );

    if (res.clicked) {
      this.awaitingMonthConsult = true;
      this.monthConsultPreSignature = res.signature ?? '';
      this.monthConsultAt = Date.now();
      this.emitStatus({
        state: 'downloading',
        url: this.view.webContents.getURL(),
        message: `Consultando ${mLabel} ${filter.year} automáticamente en el SRI...`,
      });
      return;
    }

    this.emitStatus({
      state: 'consult_ready',
      url: this.view.webContents.getURL(),
      message: res.captcha
        ? `El SRI pidió un CAPTCHA para consultar ${mLabel} ${filter.year}. Complétalo y pulsa «Consultar».`
        : `Haz clic en «Consultar» en el SRI para descargar ${mLabel} ${filter.year}.`,
    });
  }

  private emitRangeProgress(
    status: RangeProgressEvent['status'],
    extra?: { rangeExcelPath?: string; outputFolder?: string }
  ) {
    const r = this.activeRange;
    if (!r) return;
    const cur = r.months[Math.min(r.currentIndex, r.months.length - 1)] ?? r.months[0];
    this.onRangeProgress({
      active:
        status === 'waiting_consult' ||
        status === 'consulting' ||
        status === 'downloading_month',
      fromDate: r.fromDate,
      toDate: r.toDate,
      currentIndex: r.currentIndex,
      totalMonths: r.months.length,
      currentYear: cur.year,
      currentMonth: cur.month,
      completedMonths: r.completedMonths,
      totalComprobantes: r.collected.size,
      status,
      rangeExcelPath: extra?.rangeExcelPath,
      outputFolder: extra?.outputFolder,
    });
  }

  public async skipRangeMonth(): Promise<void> {
    if (!this.activeRange || this.rangeAdvanceInFlight) return;
    this.activeRange.completedMonths++;
    this.activeRange.currentIndex++;
    this.autoConsultMonthKey = '';
    this.autoConsultClickedAt = Date.now();
    await this.advanceOrFinishRange();
  }

  private async skipEmptyRangeMonth(): Promise<void> {
    const r = this.activeRange;
    if (!r || this.rangeAdvanceInFlight) return;
    this.rangeAdvanceInFlight = true;
    try {
      const cur = r.months[r.currentIndex];
      this.trace('RANGE_EMPTY_MONTH', `month=${cur?.year}-${cur?.month}`);
      r.completedMonths++;
      r.currentIndex++;
      // Reset the auto-consult guards right away so a stale poll can't skip twice.
      this.autoConsultMonthKey = '';
      this.autoConsultClickedAt = Date.now();
      await this.advanceOrFinishRange();
    } finally {
      this.rangeAdvanceInFlight = false;
    }
  }

  private async clickConsultar(): Promise<{
    clicked: boolean;
    captcha?: boolean;
    reason?: string;
    signature?: string;
  }> {
    if (!this.view || !this.isOnRecibidosPage()) {
      return { clicked: false, reason: 'not_on_recibidos' };
    }
    try {
      const result = await this.view.webContents.executeJavaScript(`
        (() => {
          const norm = (s) => (s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().trim();
          const scope = document.querySelector('#frmPrincipal') || document;
          const visible = (el) => {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          };

          const btn =
            document.querySelector('[id="frmPrincipal:btnConsultar"]') ||
            scope.querySelector('input[id*="btnConsultar"], button[id*="btnConsultar"], a[id*="btnConsultar"]') ||
            Array.from(scope.querySelectorAll('input[type="submit"], button, a')).find(
              (el) => norm(el.value || el.textContent) === 'consultar'
            );

          const captchaInput = document.querySelector(
            '#frmPrincipal input[id*="captcha" i], input[id*="captcha" i][type="text"], input[name*="captcha" i]'
          );
          const captchaImg = document.querySelector('img[src*="captcha" i], img[id*="captcha" i]');
          const hasCaptcha = visible(captchaInput) || visible(captchaImg);

          // Snapshot the table currently on screen so we can detect when the new query result arrives.
          const rows = document.querySelectorAll('#frmPrincipal\\\\:tablaCompRecibidos_data tr, table[id*="tablaCompRecibidos"] tbody tr');
          const firstText = rows[0]?.textContent?.trim() || '';
          const lastText = rows[rows.length - 1]?.textContent?.trim() || '';
          const hasData = rows.length > 0 && !/no existen datos/i.test(firstText);
          const signature = hasData
            ? rows.length + ':' + firstText.slice(0, 80) + '|' + lastText.slice(0, 80)
            : '';

          if (!visible(btn)) return { clicked: false, reason: 'no_button', signature };
          if (hasCaptcha) return { clicked: false, captcha: true, reason: 'captcha', signature };

          const disabled =
            btn.disabled ||
            btn.getAttribute('aria-disabled') === 'true' ||
            /ui-state-disabled/.test(btn.className || '');
          if (disabled) return { clicked: false, reason: 'disabled', signature };

          btn.click();
          return { clicked: true, signature, id: btn.id || btn.getAttribute('name') || '' };
        })();
      `);
      return result ?? { clicked: false, reason: 'unknown' };
    } catch (err) {
      return { clicked: false, reason: err instanceof Error ? err.message : 'execute_error' };
    }
  }

  private async autoConsultCurrentMonth(): Promise<void> {
    const r = this.activeRange;
    if (!r || !this.view) return;
    const cur = r.months[Math.min(r.currentIndex, r.months.length - 1)];
    if (!cur) return;

    const mLabel = MONTH_LABELS_ES[cur.month - 1] ?? String(cur.month);
    const key = `${r.profileId}|${cur.year}|${cur.month}|${r.docType}`;
    // Already auto-clicked (or reserved) for this exact month — don't double query on repeated page loads.
    if (this.autoConsultMonthKey === key) return;

    // Reserve the month synchronously so overlapping did-finish-load handlers can't double-click.
    this.autoConsultMonthKey = key;

    // Give the SRI form a beat to settle after the month dropdowns change.
    await new Promise((resolve) => setTimeout(resolve, 450));
    if (this.activeRange !== r) {
      if (this.autoConsultMonthKey === key) this.autoConsultMonthKey = '';
      return;
    }

    let res = await this.clickConsultar();
    // The JSF form can still be rendering right after navigation — retry once before falling back.
    if (!res.clicked && !res.captcha && (res.reason === 'no_button' || res.reason === 'disabled')) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (this.activeRange !== r) {
        if (this.autoConsultMonthKey === key) this.autoConsultMonthKey = '';
        return;
      }
      res = await this.clickConsultar();
    }
    this.trace(
      'AUTO_CONSULT',
      `month=${cur.year}-${cur.month} clicked=${res.clicked} reason=${res.reason ?? ''} captcha=${Boolean(res.captcha)}`
    );

    if (res.clicked) {
      this.autoConsultClickedAt = Date.now();
      this.emitRangeProgress('consulting');
      this.emitStatus({
        state: 'downloading',
        url: this.view.webContents.getURL(),
        message: `Consultando ${mLabel} ${cur.year} automáticamente en el SRI...`,
      });
      return;
    }

    // Could not click: release the reservation so a later load/manual action can retry.
    if (this.autoConsultMonthKey === key) this.autoConsultMonthKey = '';

    // Fallback: leave the manual «Consultar» step available (e.g. CAPTCHA requested by SRI).
    this.emitRangeProgress('waiting_consult');
    this.emitStatus({
      state: 'consult_ready',
      url: this.view.webContents.getURL(),
      message: res.captcha
        ? `Mes ${r.currentIndex + 1} de ${r.months.length} (${mLabel} ${cur.year}): el SRI pidió un CAPTCHA. Complétalo y pulsa «Consultar» para continuar con el rango.`
        : `Mes ${r.currentIndex + 1} de ${r.months.length} (${mLabel} ${cur.year}) listo. Haz clic en «Consultar» en el SRI para continuar.`,
    });
  }

  public async cancelDateRange(): Promise<void> {
    if (!this.activeRange) return;
    this.downloadManager.cancel();
    await this.finalizeRange('cancelled');
  }

  private async advanceOrFinishRange(): Promise<void> {
    const r = this.activeRange;
    if (!r) return;

    if (r.currentIndex >= r.months.length) {
      await this.finalizeRange('completed');
      return;
    }

    const next = r.months[r.currentIndex];
    const mLabel = MONTH_LABELS_ES[next.month - 1] ?? String(next.month);
    // CRITICAL: Do NOT clear lastAutoCapturedSignature here!
    // Changing the SRI <select> dropdowns leaves the previous month's table visible on screen
    // until the user actually clicks «Consultar». Keeping the previous signature prevents pollTimer
    // from re-capturing the old month's rows before the user queries the new month.
    await this.applyFilters(
      {
        profileId: r.profileId,
        year: next.year,
        month: next.month,
        day: 0,
        docType: r.docType,
      },
      true
    );
    this.emitRangeProgress('waiting_consult');
    this.emitStatus({
      state: 'consult_ready',
      url: this.view?.webContents.getURL() ?? '',
      message: `Preparando ${mLabel} ${next.year} (Mes ${r.currentIndex + 1} de ${r.months.length})...`,
    });
    await this.autoConsultCurrentMonth();
  }

  private async finalizeRange(finalStatus: 'completed' | 'cancelled'): Promise<void> {
    const r = this.activeRange;
    if (!r) return;

    const settings = this.store.getSettings();
    const ownerFolder = path.join(settings.outputDir, getOwnerFolderName(r.ownerAlias, r.ownerRuc));
    let rangeExcelPath: string | undefined;

    if (r.formats.excel && r.collected.size > 0) {
      const rangesDir = path.join(ownerFolder, 'Rangos');
      fs.mkdirSync(rangesDir, { recursive: true });
      rangeExcelPath = path.join(
        rangesDir,
        `Faktum_Rango_${r.ownerRuc}_${r.fromDate}_a_${r.toDate}.xlsx`
      );
      await exportComprobantesToExcel(Array.from(r.collected.values()), rangeExcelPath);
    }

    this.emitRangeProgress(finalStatus, {
      rangeExcelPath,
      outputFolder: ownerFolder,
    });

    this.emitStatus({
      state: 'consult_ready',
      url: this.view?.webContents.getURL() ?? '',
      message:
        finalStatus === 'completed'
          ? `Rango ${r.fromDate} a ${r.toDate} completado: ${r.collected.size} comprobantes procesados.`
          : `Rango detenido (${r.collected.size} comprobantes acumulados).`,
    });

    this.activeRange = null;
  }

  public async clearSession(profileId: string): Promise<void> {
    const profileData = this.store.getProfileWithPassword(profileId);
    if (!profileData) return;
    const partition = `persist:sri-${profileData.profile.ruc}`;
    const sriSession = session.fromPartition(partition);
    await sriSession.clearStorageData();
    await sriSession.clearCache();
    this.lastAutoCapturedSignature = '';
    this.hasAttemptedAutoLogin = false;
    this.hasNavigatedFromProfile = false;
    this.menuNavInFlight = false;
    this.trace('CLEAR_SESSION', `ruc=${profileData.profile.ruc}`);

    if (this.view && this.currentPartition === partition) {
      this.emitStatus({
        state: 'loading',
        url: SRI_PORTAL_ENTRY_URL,
        message: 'Sesión SRI limpiada. Iniciando acceso nuevo...',
      });
      await this.safeLoadUrl(SRI_PORTAL_ENTRY_URL);
    }
  }

  public setBounds(bounds: BoundsRect, visible: boolean): void {
    this.lastBounds = bounds;
    this.isVisible = visible;
    if (!this.view) return;
    if (!visible || bounds.width <= 0 || bounds.height <= 0) {
      this.view.setVisible(false);
      this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    } else {
      this.view.setVisible(true);
      this.view.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      });
    }
  }

  public close(): void {
    this.activeRange = null;
    this.pendingMonthConsult = false;
    this.awaitingMonthConsult = false;
    this.destroyView();
    this.emitStatus({
      state: 'idle',
      url: '',
      message: 'Portal del SRI cerrado.',
    });
  }

  public async reload(): Promise<void> {
    if (!this.view) return;
    this.lastAutoCapturedSignature = '';
    this.hasNavigatedFromProfile = false;
    this.view.webContents.reload();
  }

  private destroyView(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.view) {
      try {
        this.mainWindow.contentView.removeChildView(this.view);
      } catch {
        // ignore
      }
      try {
        this.view.webContents.close();
      } catch {
        // ignore
      }
      this.view = null;
      this.currentPartition = null;
      this.isVisible = false;
    }
  }

  private attachDownloadInterceptor(sriSession: Electron.Session, partition: string): void {
    if (this.hookedPartitions.has(partition)) return;
    this.hookedPartitions.add(partition);

    sriSession.on('will-download', (_event, item) => {
      const filename = item.getFilename() || 'reporte.txt';
      const lower = filename.toLowerCase();
      const mime = (item.getMimeType() || '').toLowerCase();

      // 1. If a native click fallback download (XML or PDF) is pending, capture it cleanly
      if (this.pendingNativeDocDownload && !lower.endsWith('.txt')) {
        const pending = this.pendingNativeDocDownload;
        this.pendingNativeDocDownload = null;
        clearTimeout(pending.timer);

        const ext = pending.kind === 'pdf' ? 'pdf' : 'xml';
        const tmpPath = path.join(os.tmpdir(), `faktum-sri-doc-${crypto.randomUUID()}.${ext}`);
        item.setSavePath(tmpPath);
        this.trace('WILL_DOWNLOAD_DOC', `kind=${pending.kind} filename=${filename} mime=${mime}`);

        item.once('done', (_doneEvent, state) => {
          try {
            if (state !== 'completed' || !fs.existsSync(tmpPath)) {
              pending.resolve({
                ok: false,
                reason: `Descarga nativa del SRI interrumpida (${state}).`,
              });
              return;
            }
            const buffer = fs.readFileSync(tmpPath);
            try {
              fs.unlinkSync(tmpPath);
            } catch {
              // ignore cleanup errors
            }

            if (pending.kind === 'pdf') {
              const isPdf =
                buffer.length > 100 &&
                buffer[0] === 0x25 &&
                buffer[1] === 0x50 &&
                buffer[2] === 0x44 &&
                buffer[3] === 0x46;
              if (!isPdf) {
                pending.resolve({
                  ok: false,
                  reason: `El archivo descargado del SRI no es un PDF válido (${buffer.length} bytes).`,
                });
                return;
              }
            } else {
              const preview = buffer.subarray(0, 400).toString('utf-8').trim();
              const isXml =
                buffer.length > 80 &&
                (preview.startsWith('<?xml') ||
                  preview.includes('<autorizacion') ||
                  preview.includes('<factura') ||
                  preview.includes('<notaCredito') ||
                  preview.includes('<comprobanteRetencion') ||
                  preview.includes('<liquidacionCompra'));
              if (!isXml) {
                pending.resolve({
                  ok: false,
                  reason: `El archivo descargado del SRI no es un XML válido (${buffer.length} bytes).`,
                });
                return;
              }
            }

            pending.resolve({ ok: true, buffer });
          } catch (err) {
            pending.resolve({
              ok: false,
              reason: err instanceof Error ? err.message : 'Error leyendo archivo descargado del SRI.',
            });
          }
        });
        return;
      }

      this.trace('WILL_DOWNLOAD', `filename=${filename}`);

      if (lower.endsWith('.txt') || lower.includes('comprobantes') || lower.includes('reporte')) {
        const tmpPath = path.join(os.tmpdir(), `faktum-sri-${crypto.randomUUID()}.txt`);
        item.setSavePath(tmpPath);

        this.emitStatus({
          state: 'downloading',
          url: this.view?.webContents.getURL() ?? '',
          message: 'Reporte capturado automáticamente del SRI. Leyendo claves de acceso...',
        });

        item.once('done', async (_doneEvent, state) => {
          try {
            if (state !== 'completed' || !fs.existsSync(tmpPath)) {
              this.emitStatus({
                state: 'error',
                url: this.view?.webContents.getURL() ?? '',
                message: 'No se pudo completar la captura del reporte del SRI.',
              });
              return;
            }

            const buffer = fs.readFileSync(tmpPath);
            const text = decodeSriBuffer(buffer);
            const entries = extractKeysFromReportText(text);
            this.preferNativeClick = false;
            this.lastActiveTablePage = 1;
            this.trace('REPORT_PARSED', `keys=${entries.length}`);

            try {
              fs.unlinkSync(tmpPath);
            } catch {
              // ignore
            }

            if (entries.length === 0) {
              this.emitStatus({
                state: 'consult_ready',
                url: this.view?.webContents.getURL() ?? '',
                message: 'El reporte capturado no contiene claves de acceso para ese período.',
              });
              return;
            }

            await this.deliverCapturedBatch(entries);
          } catch (err) {
            this.emitStatus({
              state: 'error',
              url: this.view?.webContents.getURL() ?? '',
              message: err instanceof Error ? err.message : 'Error al procesar el reporte del SRI.',
            });
          }
        });
      }
    });
  }

  private async deliverCapturedBatch(entries: CapturedKeyEntry[]): Promise<void> {
    if (!this.currentFilter) return;

    // Multi-month Date Range Mode: filter to exact [fromDate, toDate], download this month's XML + original SRI PDF right away, and advance automatically!
    if (this.activeRange) {
      const r = this.activeRange;
      const curMonth = r.months[r.currentIndex];
      const keysFingerprint =
        entries.length > 0
          ? `${entries.length}:${entries[0].claveAcceso}:${entries[entries.length - 1].claveAcceso}`
          : '';

      // Guard against capturing the exact same previous month's report twice before the user clicks «Consultar» for the next month
      if (keysFingerprint && keysFingerprint === this.lastRangeKeysFingerprint) {
        const mLabel = curMonth ? MONTH_LABELS_ES[curMonth.month - 1] ?? String(curMonth.month) : '';
        this.emitStatus({
          state: 'consult_ready',
          url: this.view?.webContents.getURL() ?? '',
          message: `Esos resultados son del mes anterior. Haz clic en «Consultar» en el SRI para cargar ${mLabel} ${curMonth?.year ?? ''}.`,
        });
        return;
      }
      this.lastRangeKeysFingerprint = keysFingerprint;

      const filteredEntries = entries.filter((e) =>
        isEntryWithinDateRange(e, r.fromDate, r.toDate)
      );

      this.emitRangeProgress('downloading_month');

      if (filteredEntries.length > 0 && !this.downloadManager.isBusy()) {
        const res = await this.downloadManager.runBatch({
          profileId: r.profileId,
          entries: filteredEntries,
          periodYear: curMonth?.year,
          periodMonth: curMonth?.month,
          formats: {
            xml: r.formats.xml,
            pdf: r.formats.pdf,
            excel: false, // Master consolidated Excel is generated once at the end of the range
          },
        });
        for (const comp of res.collected) {
          r.collected.set(comp.claveAcceso, comp);
        }
        if (res.status === 'cancelled') {
          await this.finalizeRange('cancelled');
          return;
        }
      }

      if (!this.activeRange) return;
      r.completedMonths++;
      r.currentIndex++;
      await this.advanceOrFinishRange();
      return;
    }

    const profileData = this.store.getProfileWithPassword(this.currentFilter.profileId);
    const ownerRuc = profileData?.profile.ruc ?? '';

    // Annotate each captured entry so the selector shows which invoices are already on disk
    const annotated: CapturedKeyEntry[] = entries.map((e) => ({
      ...e,
      alreadyDownloaded: Boolean(this.store.hasDownloadedComprobante(e.claveAcceso)),
    }));

    this.onCapturedBatch({
      profileId: this.currentFilter.profileId,
      ownerRuc,
      periodYear: this.currentFilter.year,
      periodMonth: this.currentFilter.month,
      entries: annotated,
    });

    this.emitStatus({
      state: 'results_detected',
      url: this.view?.webContents.getURL() ?? '',
      message: `${annotated.length} comprobantes capturados. Elige cuáles descargar en la ventana de selección.`,
      hasReportButton: true,
      detectedKeysCount: annotated.length,
    });
  }

  private parseUrlSafe(rawUrl: string): { pathname: string; search: string; hash: string; host: string } | null {
    try {
      const parsed = new URL(rawUrl);
      return {
        pathname: parsed.pathname,
        search: parsed.search,
        hash: parsed.hash,
        host: parsed.host,
      };
    } catch {
      return null;
    }
  }

  private isGeneraTokenUrl(url: string): boolean {
    const p = this.parseUrlSafe(url);
    return Boolean(p && (p.pathname.includes('GeneraToken') || p.pathname.includes('accederAplicacion')));
  }

  private isKeycloakLoginUrl(url: string): boolean {
    const p = this.parseUrlSafe(url);
    return Boolean(p && (p.pathname.includes('/auth/realms/') || p.pathname.includes('login-actions')));
  }

  private isRecibidosUrl(url: string): boolean {
    const p = this.parseUrlSafe(url);
    return Boolean(p && p.pathname.includes('comprobantesRecibidos'));
  }

  private isInsideSriAngularPortal(url: string): boolean {
    const p = this.parseUrlSafe(url);
    if (!p || !p.host.includes('srienlinea.sri.gob.ec')) return false;
    return p.pathname.startsWith('/sri-en-linea/');
  }

  private isSettledAngularProfileUrl(url: string): boolean {
    const p = this.parseUrlSafe(url);
    if (!p || !p.host.includes('srienlinea.sri.gob.ec')) return false;
    if (
      p.search.includes('code=') ||
      p.search.includes('state=') ||
      p.hash.includes('code=') ||
      p.hash.includes('state=') ||
      p.hash.includes('session_state=')
    ) {
      return false;
    }
    return p.pathname.includes('/sri-en-linea/contribuyente/perfil');
  }

  private wireWebContentsEvents(view: WebContentsView): void {
    const wc = view.webContents;

    // Keep any target="_blank" SRI menu links inside the same session & WebContentsView
    wc.setWindowOpenHandler(({ url }) => {
      this.trace('WINDOW_OPEN', sanitizeUrlForLog(url));
      if (url && url.includes('sri.gob.ec')) {
        void this.safeLoadUrl(url);
      }
      return { action: 'deny' };
    });

    wc.on('did-redirect-navigation', (_event, url) => {
      this.trace('REDIRECT', sanitizeUrlForLog(url));
    });

    wc.on('did-navigate', (_event, url) => {
      this.trace('NAVIGATE', sanitizeUrlForLog(url));
    });

    wc.on('did-navigate-in-page', async (_event, url) => {
      this.trace('NAV_IN_PAGE', sanitizeUrlForLog(url));
      await this.inspectAndAssistPage(url);
    });

    wc.on('did-start-loading', () => {
      const url = wc.getURL();
      if (this.isGeneraTokenUrl(url)) {
        this.emitStatus({
          state: 'loading',
          url,
          message: 'Validando sesión SSO con el SRI...',
        });
      } else {
        this.emitStatus({
          state: 'loading',
          url,
          message: 'Cargando página del SRI...',
        });
      }
    });

    wc.on('did-finish-load', async () => {
      const url = wc.getURL();
      this.trace('FINISH_LOAD', sanitizeUrlForLog(url));
      await this.inspectAndAssistPage(url);
    });

    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return;
      this.trace('FAIL_LOAD', `${errorCode} ${errorDescription} ${sanitizeUrlForLog(validatedURL)}`);
      this.emitStatus({
        state: 'error',
        url: validatedURL,
        message: `Error al cargar el SRI (${errorDescription}). Verifica tu conexión.`,
      });
    });

    wc.on('console-message', (_event, level, message) => {
      if (level >= 2) {
        this.trace('CONSOLE_ERR', message.slice(0, 240));
      }
    });

    this.pollTimer = setInterval(() => {
      if (!this.view || !this.isVisible || this.downloadManager.isBusy()) return;
      const url = this.view.webContents.getURL();
      if (this.isRecibidosUrl(url)) {
        void this.checkForResultsInDom();
      } else if (
        this.isSettledAngularProfileUrl(url) &&
        !this.hasNavigatedFromProfile &&
        !this.menuNavInFlight
      ) {
        void this.navigateFromProfileToRecibidos();
      }
    }, 1500);
  }

  /**
   * Finds and clicks the real "Comprobantes electrónicos recibidos" link inside SRI's Angular sidebar
   * (e.g. /tuportal-internet/accederAplicacion.jspa?redireccion=...) so SRI preserves the session cleanly.
   */
  private async clickRecibidosInSriMenu(): Promise<boolean> {
    if (!this.view) return false;
    try {
      const probe = await this.view.webContents.executeJavaScript(`
        (async () => {
          const norm = (s) => (s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().trim();

          const findRecibidosLink = () => {
            const links = Array.from(document.querySelectorAll('a'));
            return links.find((a) => {
              const t = norm(a.textContent);
              const href = (a.getAttribute('href') || '').toLowerCase();
              return (
                (t.includes('comprobantes') && t.includes('recibidos')) ||
                href.includes('comprobantesrecibidos')
              );
            });
          };

          // 1. Check if already present in DOM (Angular PrimeNG PanelMenu renders nested <a> items in DOM)
          let target = findRecibidosLink();

          // 2. If not found yet, open sidebar menu and expand "Facturación Electrónica"
          if (!target) {
            const menuBtn = document.querySelector('#sri-menu, button[title*="Menú"], .topbar-menu-button, a.menu-button, button.sri-menu-btn');
            if (menuBtn) menuBtn.click();
            await new Promise((r) => setTimeout(r, 300));

            const factItem = Array.from(document.querySelectorAll('a, button, span, li')).find((el) => {
              const t = norm(el.textContent);
              return t === 'facturacion electronica' || (t.includes('facturacion electronica') && t.length < 40);
            });
            if (factItem) {
              factItem.click();
              await new Promise((r) => setTimeout(r, 450));
            }
            target = findRecibidosLink();
          }

          if (target) {
            const href = target.getAttribute('href') || '';
            const text = (target.textContent || '').trim();
            target.removeAttribute('target');
            target.click();
            return { found: true, href, text };
          }

          // Collect visible menu links for diagnostic trace
          const sampleLinks = Array.from(document.querySelectorAll('a'))
            .map((a) => ({ text: (a.textContent || '').trim().slice(0, 40), href: (a.getAttribute('href') || '').slice(0, 90) }))
            .filter((x) => x.text || x.href)
            .slice(0, 25);

          return { found: false, sampleLinks };
        })();
      `);

      this.trace('MENU_PROBE', JSON.stringify(probe).slice(0, 600));

      if (probe?.found) {
        this.emitStatus({
          state: 'loading',
          url: this.view.webContents.getURL(),
          message: 'Abriendo Comprobantes Electrónicos Recibidos desde el menú del SRI...',
        });
        return true;
      }
      return false;
    } catch (err) {
      this.trace('MENU_PROBE_ERR', err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  private async navigateFromProfileToRecibidos(): Promise<void> {
    if (!this.view || this.menuNavInFlight || this.hasNavigatedFromProfile) return;
    this.menuNavInFlight = true;

    try {
      await new Promise((resolve) => setTimeout(resolve, 1400));
      if (!this.view) return;

      const currentUrl = this.view.webContents.getURL();
      if (!this.isSettledAngularProfileUrl(currentUrl)) return;

      // Wait until the SRI Angular menu has actually loaded (not still fetching /menu/privado/principal)
      const ready = await this.view.webContents.executeJavaScript(`
        (() => {
          const text = document.body?.innerText || '';
          const hasLogin = Boolean(document.querySelector('#kc-form-login, #usuario, input[type="password"]'));
          const menuLinks = document.querySelectorAll('a[href*="accederAplicacion"], a[href*="comprobantes"], .layout-menu a, nav a').length;
          return {
            hasProfile: !hasLogin && (/cambio de clave/i.test(text) || /obligaciones tributarias/i.test(text)),
            menuLinks,
          };
        })();
      `);

      this.trace('PROFILE_READY', JSON.stringify(ready));
      if (!ready?.hasProfile) return;

      this.hasNavigatedFromProfile = true;

      // Navigate via SRI's own menu item so SRI's internal bridge (accederAplicacion.jspa) runs intact!
      const clicked = await this.clickRecibidosInSriMenu();
      if (!clicked) {
        this.emitStatus({
          state: 'consult_ready',
          url: currentUrl,
          message:
            'Sesión iniciada. Abre el menú izquierdo → Facturación Electrónica → Comprobantes electrónicos recibidos.',
        });
      }
    } catch (err) {
      this.trace('PROFILE_NAV_ERR', err instanceof Error ? err.message : String(err));
    } finally {
      this.menuNavInFlight = false;
    }
  }

  private async inspectAndAssistPage(url: string): Promise<void> {
    if (!this.view || !this.currentFilter) return;

    // 1. Keycloak Login page (check pathname FIRST so `?redirect_uri=...` never shadows login!)
    if (this.isKeycloakLoginUrl(url)) {
      this.hasNavigatedFromProfile = false;
      const allowAutoSubmit = !this.hasAttemptedAutoLogin;
      this.hasAttemptedAutoLogin = true;

      await new Promise((resolve) => setTimeout(resolve, 750));
      if (!this.view) return;

      const filled = await this.fillCredentials(this.currentFilter.profileId, allowAutoSubmit);
      this.trace('LOGIN_ASSIST', `ok=${filled.ok} autoSubmitted=${Boolean(filled.autoSubmitted)} msg=${filled.message}`);
      if (filled.autoSubmitted) {
        this.emitStatus({
          state: 'loading',
          url,
          message: 'Ingresando automáticamente al SRI con tus credenciales guardadas...',
        });
      } else {
        this.emitStatus({
          state: 'login_ready',
          url,
          message: filled.message,
        });
      }
      return;
    }

    // 2. Never interfere with SRI's internal token/bridge redirects (GeneraToken.jsp / accederAplicacion.jspa)
    if (this.isGeneraTokenUrl(url)) {
      this.emitStatus({
        state: 'loading',
        url,
        message: 'Completando inicio de sesión SSO en el SRI...',
      });
      return;
    }

    // 3. Comprobantes Recibidos page (target destination!)
    if (this.isRecibidosUrl(url)) {
      if (this.downloadManager.isBusy()) return;
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (!this.view || !this.currentFilter || this.downloadManager.isBusy()) return;
      await this.applyFilters(this.currentFilter);
      if (this.activeRange) {
        await this.autoConsultCurrentMonth();
      } else if (this.pendingMonthConsult) {
        await this.triggerPendingMonthConsult();
      } else {
        this.emitStatus({
          state: 'consult_ready',
          url,
          message: '',
        });
      }
      return;
    }

    // 4. Angular profile page after login — click SRI's native menu link to Comprobantes Recibidos
    if (this.isSettledAngularProfileUrl(url) && !this.hasNavigatedFromProfile) {
      void this.navigateFromProfileToRecibidos();
    }
  }

  private async fillCredentials(
    profileId: string,
    allowAutoSubmit = false
  ): Promise<{ ok: boolean; message: string; autoSubmitted?: boolean }> {
    if (!this.view) return { ok: false, message: 'El portal del SRI no está abierto.' };
    const data = this.store.getProfileWithPassword(profileId);
    if (!data) return { ok: false, message: 'Perfil de RUC no encontrado.' };

    const rucJson = JSON.stringify(data.profile.ruc);
    const passJson = JSON.stringify(data.password ?? '');
    const canAutoSubmit = Boolean(allowAutoSubmit && data.password && data.password.length > 0);

    try {
      const result = await this.view.webContents.executeJavaScript(`
        (() => {
          const setVal = (el, val) => {
            if (!el || !val) return false;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (setter) setter.call(el, val);
            else el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          };
          const userInput = document.querySelector('#usuario, input[name="usuario"]');
          const passInput = document.querySelector('#password, input[name="password"]');
          const uOk = setVal(userInput, ${rucJson});
          const pOk = setVal(passInput, ${passJson});
          const loginBtn = document.querySelector('#kc-login');

          const hasCaptcha = Boolean(
            document.querySelector('iframe[src*="recaptcha"], .g-recaptcha, [data-sitekey], iframe[src*="hcaptcha"], iframe[src*="turnstile"]')
          );
          const errorEl = document.querySelector('.alert-error, .alert-danger, .kc-feedback-text, .ui-messages-error');
          const hasAuthError = Boolean(errorEl && errorEl.textContent && errorEl.textContent.trim().length > 0);
          const hasValidator = typeof window.validarUsuario === 'function';

          let autoSubmitted = false;
          if (${JSON.stringify(canAutoSubmit)} && uOk && pOk && loginBtn && hasValidator && !hasCaptcha && !hasAuthError) {
            loginBtn.click();
            autoSubmitted = true;
          } else if (uOk && pOk && loginBtn) {
            loginBtn.focus();
          }
          return { uOk, pOk, autoSubmitted, hasAuthError, hasCaptcha, hasValidator };
        })();
      `);
      if (result?.autoSubmitted) {
        return {
          ok: true,
          autoSubmitted: true,
          message: 'Ingresando automáticamente al SRI...',
        };
      }
      if (result?.hasAuthError) {
        return {
          ok: false,
          message: 'El SRI indicó un error de credenciales. Revisa tu RUC y clave en «Perfiles RUC».',
        };
      }
      if (result?.uOk) {
        return {
          ok: true,
          message: result.pOk
            ? 'RUC y clave completados. Haz clic en «Ingresar» en el portal.'
            : 'Este perfil no tiene clave guardada. Edítalo en «Perfiles RUC» para entrar automáticamente.',
        };
      }
      return { ok: false, message: 'No se detectó el formulario de acceso del SRI en esta pantalla.' };
    } catch {
      return { ok: false, message: 'No fue posible rellenar el formulario del SRI.' };
    }
  }

  public async applyFilters(
    filter: SriQueryFilter,
    preserveCapturedSignature = false
  ): Promise<{ ok: boolean; message: string }> {
    const prev = this.currentFilter;
    const filterChanged =
      !prev ||
      prev.profileId !== filter.profileId ||
      prev.year !== filter.year ||
      prev.month !== filter.month ||
      prev.day !== filter.day ||
      prev.docType !== filter.docType;
    this.currentFilter = filter;
    if (filterChanged && !preserveCapturedSignature && !this.activeRange) {
      this.lastAutoCapturedSignature = '';
    }
    if (!this.view) return { ok: false, message: 'El portal del SRI no está abierto.' };

    const docMeta = SRI_DOC_TYPES[filter.docType] ?? SRI_DOC_TYPES.ALL;

    try {
      const applied = await this.view.webContents.executeJavaScript(`
        (() => {
          const selectByMatch = (selectors, targetVal, targetText) => {
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (!el || el.tagName !== 'SELECT') continue;
              const opts = Array.from(el.options);
              let match = opts.find((o) => o.value === String(targetVal));
              if (!match && targetText) {
                const norm = (s) => s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().trim();
                match = opts.find((o) => norm(o.textContent || '').includes(norm(targetText)));
              }
              if (match) {
                el.value = match.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
            }
            return false;
          };

          const yOk = selectByMatch(['#frmPrincipal\\\\:ano', 'select[id$=":ano"]'], ${JSON.stringify(String(filter.year))}, ${JSON.stringify(String(filter.year))});
          const mOk = selectByMatch(['#frmPrincipal\\\\:mes', 'select[id$=":mes"]'], ${JSON.stringify(String(filter.month))}, '');
          const dOk = selectByMatch(['#frmPrincipal\\\\:dia', 'select[id$=":dia"]'], ${JSON.stringify(String(filter.day))}, ${filter.day === 0 ? '"Todos"' : JSON.stringify(String(filter.day))});
          const tOk = selectByMatch(
            ['#frmPrincipal\\\\:cmbTipoComprobante', 'select[id*="TipoComprobante"]'],
            ${JSON.stringify(docMeta.sriSelectValue)},
            ${JSON.stringify(filter.docType === 'ALL' ? 'Todos' : docMeta.label)}
          );

          const form = document.querySelector('#frmPrincipal');
          if (form) {
            form.scrollIntoView({ behavior: 'instant', block: 'start' });
          }

          return { yOk, mOk, dOk, tOk };
        })();
      `);

      const anyApplied = Boolean(applied?.yOk || applied?.mOk || applied?.tOk);
      return {
        ok: anyApplied,
        message: anyApplied
          ? 'Período aplicado en Comprobantes Recibidos. Pulsa «Consultar».'
          : 'Abre Comprobantes Recibidos para aplicar los filtros.',
      };
    } catch {
      return { ok: false, message: 'No se pudieron aplicar los filtros en el portal.' };
    }
  }

  private async checkForResultsInDom(): Promise<void> {
    if (!this.view) return;
    try {
      const probe = await this.view.webContents.executeJavaScript(`
        (() => {
          const reportLink =
            document.querySelector('#frmPrincipal\\\\:lnkTxtlistado') ||
            document.querySelector('a[id*="lnkTxtlistado"]') ||
            Array.from(document.querySelectorAll('a, button')).find((el) =>
              /descargar\\s+reporte/i.test(el.textContent || '')
            );
          const isVisible = (el) => {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          };
          const tableRows = document.querySelectorAll('#frmPrincipal\\\\:tablaCompRecibidos_data tr, table[id*="tablaCompRecibidos"] tbody tr');
          const firstRowText = tableRows[0]?.textContent?.trim() || '';
          const lastRowText = tableRows[tableRows.length - 1]?.textContent?.trim() || '';
          const hasData = tableRows.length > 0 && !/no existen datos/i.test(firstRowText);
          const bodyText = document.body?.innerText || '';
          const noData =
            /no existen datos/i.test(firstRowText) ||
            (/no existen datos/i.test(bodyText) && tableRows.length === 0);
          const isLoading = Boolean(
            document.querySelector('.ui-blockui, .ui-widget-overlay, .p-blockui, .ui-state-loading')
          );
          const signature = hasData
            ? tableRows.length + ':' + firstRowText.slice(0, 80) + '|' + lastRowText.slice(0, 80)
            : '';
          return {
            hasReportButton: isVisible(reportLink),
            hasData,
            noData,
            isLoading,
            signature,
          };
        })();
      `);

      // Single-month "Descargar Facturas": wait for the new query result, then capture even if
      // the same month was queried before (same table signature).
      if (this.awaitingMonthConsult && !this.activeRange) {
        if (probe?.isLoading) return;
        const elapsed = Date.now() - this.monthConsultAt;
        const changed =
          Boolean(probe?.signature) && probe.signature !== this.monthConsultPreSignature;
        // Wait for the table to change, or fall back to a timeout when re-querying the same month.
        if (!changed && elapsed < 8000) return;
        this.awaitingMonthConsult = false;
        if (probe?.hasData) {
          if (probe.signature) this.lastAutoCapturedSignature = probe.signature;
          await this.captureFromPortal();
        } else {
          this.emitStatus({
            state: 'consult_ready',
            url: this.view.webContents.getURL(),
            message: 'El período consultado no tiene comprobantes.',
          });
        }
        return;
      }

      if (probe?.hasReportButton && probe?.hasData) {
        // Already captured this exact table — do NOT overwrite the status banner or re-trigger!
        if (probe.signature && probe.signature === this.lastAutoCapturedSignature) {
          return;
        }
        const settings = this.store.getSettings();
        // In Date Range mode always capture automatically so the whole range runs unassisted.
        const autoTrigger = this.activeRange
          ? true
          : settings.autoTriggerReportAfterSearch;
        if (autoTrigger && probe.signature) {
          this.lastAutoCapturedSignature = probe.signature;
          await this.captureFromPortal();
        } else {
          this.emitStatus({
            state: 'results_detected',
            url: this.view.webContents.getURL(),
            message: 'Resultados listos en el SRI. Haz clic en «Capturar lista».',
            hasReportButton: true,
          });
        }
        return;
      }

      // Date Range mode: a month with no comprobantes must be skipped automatically so the
      // range keeps moving without manual intervention.
      if (this.activeRange && probe?.noData && !probe.isLoading) {
        if (this.autoConsultClickedAt === 0) return;
        // Give the SRI AJAX query time to finish before trusting the "no data" message.
        if (Date.now() - this.autoConsultClickedAt < 2500) return;
        await this.skipEmptyRangeMonth();
      }
    } catch {
      // ignore transient navigation errors
    }
  }

  public isOnRecibidosPage(): boolean {
    if (!this.view) return false;
    return this.isRecibidosUrl(this.view.webContents.getURL());
  }

  private async execJsWithTimeout<T>(code: string, timeoutMs: number, label: string): Promise<T> {
    if (!this.view) {
      throw new Error('El portal del SRI no está abierto.');
    }
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        this.view.webContents.executeJavaScript(code) as Promise<T>,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => {
            this.trace('EXEC_JS_TIMEOUT', `label=${label} timeoutMs=${timeoutMs}`);
            reject(new Error(`Tiempo de espera agotado en el portal del SRI (${label}).`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async withPortalDocLock<T>(
    fn: () => Promise<T>,
    opts?: { rowIndex?: number; signal?: AbortSignal }
  ): Promise<T> {
    const rowIndex = typeof opts?.rowIndex === 'number' && opts.rowIndex >= 0 ? opts.rowIndex : Number.MAX_SAFE_INTEGER;
    const signal = opts?.signal;

    if (signal?.aborted) {
      throw new Error('Descarga cancelada.');
    }

    if (this.portalDocBusy) {
      await new Promise<void>((resolve, reject) => {
        const entry = { rowIndex, resolve };
        const onAbort = () => {
          const idx = this.portalDocWaiters.indexOf(entry);
          if (idx >= 0) {
            this.portalDocWaiters.splice(idx, 1);
            reject(new Error('Descarga cancelada.'));
          }
        };
        entry.resolve = () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        this.portalDocWaiters.push(entry);
      });
    }
    this.portalDocBusy = true;

    const releaseNext = () => {
      if (this.portalDocWaiters.length === 0) {
        this.portalDocBusy = false;
        return;
      }
      const pageSize = this.knownTablePageSize || 50;
      // Prefer any waiter on the currently active table page to eliminate Page 1 <-> Page 2 thrashing
      let bestIdx = 0;
      let bestSamePage = false;
      for (let i = 0; i < this.portalDocWaiters.length; i++) {
        const w = this.portalDocWaiters[i];
        const wPage =
          w.rowIndex < Number.MAX_SAFE_INTEGER ? Math.floor(w.rowIndex / pageSize) + 1 : this.lastActiveTablePage;
        const samePage = wPage === this.lastActiveTablePage;
        const curBest = this.portalDocWaiters[bestIdx];
        if (
          (samePage && !bestSamePage) ||
          (samePage === bestSamePage && w.rowIndex < curBest.rowIndex)
        ) {
          bestIdx = i;
          bestSamePage = samePage;
        }
      }
      const [next] = this.portalDocWaiters.splice(bestIdx, 1);
      next.resolve();
    };

    try {
      if (signal?.aborted) {
        throw new Error('Descarga cancelada.');
      }
      // Small breathing gap between serialized JSF POSTs to avoid PrimeFaces/WildFly ViewState contention
      const elapsed = Date.now() - this.lastPortalDocFetchAt;
      if (elapsed < 85) {
        await new Promise((r) => setTimeout(r, 85 - elapsed));
      }
      if (signal?.aborted) {
        throw new Error('Descarga cancelada.');
      }
      const res = await fn();
      this.lastPortalDocFetchAt = Date.now();
      return res;
    } finally {
      releaseNext();
    }
  }

  private async tryFetchPortalDocOnce(params: {
    kind: 'pdf' | 'xml';
    claveAcceso: string;
    rowIndex?: number;
    numeroComprobante?: string;
    rucEmisor?: string;
    requireDomMatch?: boolean;
  }): Promise<{
    ok: boolean;
    buffer?: Buffer;
    reason?: string;
    sriMessage?: string;
    diag?: string;
    foundInDom?: boolean;
    pageSize?: number;
    currentPage?: number;
    notOnCurrentPage?: boolean;
    isSessionExpired?: boolean;
  }> {
    if (!this.view || !this.isOnRecibidosPage()) {
      return {
        ok: false,
        reason: 'El portal del SRI no está abierto en Comprobantes Recibidos.',
      };
    }

    const result = await this.execJsWithTimeout<any>(
      `
      (async () => {
        const kind = ${JSON.stringify(params.kind)};
        const clave = ${JSON.stringify(params.claveAcceso)};
        const rowIndex = ${JSON.stringify(typeof params.rowIndex === 'number' ? params.rowIndex : -1)};
        const numComp = ${JSON.stringify(params.numeroComprobante ?? '')};
        const rucEmisor = ${JSON.stringify(params.rucEmisor ?? '')};
        const requireDomMatch = ${JSON.stringify(Boolean(params.requireDomMatch))};
        const fallbackPageSize = ${JSON.stringify(this.knownTablePageSize)};

        const form = document.querySelector('#frmPrincipal') || document.querySelector('form');
        if (!form) return { ok: false, reason: 'Formulario #frmPrincipal no encontrado.' };

        const rows = Array.from(
          document.querySelectorAll('#frmPrincipal\\\\:tablaCompRecibidos_data tr, table[id*="tablaCompRecibidos"] tbody tr')
        );

        const activePageEl = document.querySelector(
          '#frmPrincipal\\\\:tablaCompRecibidos .ui-paginator-page.ui-state-active, .ui-paginator-page.ui-state-active, .rf-ds-act, .rf-ds-nmb-btn.rf-ds-act, [class*="paginator"] [aria-current="page"], .ui-paginator-page.ui-state-highlight'
        );
        let currentPage = Number((activePageEl?.textContent || '').trim()) || 0;
        if (!currentPage) {
          const curTxt = document.querySelector('.ui-paginator-current, [class*="paginator-current"]')?.textContent || '';
          const pm = /\\b(\\d+)\\s*(?:de|of|[/])\\s*\\d+/i.exec(curTxt);
          currentPage = pm ? Number(pm[1]) : 1;
        }
        const rppSelect = document.querySelector(
          '#frmPrincipal\\\\:tablaCompRecibidos select.ui-paginator-rpp-options, select.ui-paginator-rpp-options'
        );
        const hasNextPage = Boolean(
          document.querySelector(
            '#frmPrincipal\\\\:tablaCompRecibidos .ui-paginator-next:not(.ui-state-disabled), .ui-paginator-next:not(.ui-state-disabled), a.rf-ds-btn-next:not(.rf-ds-dis), .rf-ds-btn-next:not(.rf-ds-dis), [id$="_ds_next"]:not(.rf-ds-dis)'
          )
        );
        const linkSel =
          kind === 'xml'
            ? 'a[id*="lnkXml"], a[id*="Xml"], a[onclick*="lnkXml"]'
            : 'a[id*="lnkPdf"], a[id*="Pdf"], a[onclick*="lnkPdf"]';

        const visibleLinkIds = rows
          .map((tr) => tr.querySelector(linkSel)?.id || '')
          .filter(Boolean);
        const extractIdx = (idStr) => {
          const mm = /:(\\d+):[^:]+$/.exec(idStr || '');
          return mm ? Number(mm[1]) : -1;
        };
        const firstVisIdx = visibleLinkIds.length > 0 ? extractIdx(visibleLinkIds[0]) : -1;
        const lastVisIdx = visibleLinkIds.length > 0 ? extractIdx(visibleLinkIds[visibleLinkIds.length - 1]) : -1;
        const visibleCount = visibleLinkIds.length || rows.length;

        let pageSize = Number(rppSelect?.value || 0);
        if (!pageSize || !Number.isFinite(pageSize)) {
          if (currentPage === 1 && (hasNextPage || visibleCount > 0) && visibleCount > 0) {
            pageSize = visibleCount;
          } else if (visibleCount > 0 && hasNextPage) {
            pageSize = visibleCount;
          } else if (firstVisIdx > 0 && currentPage > 1) {
            pageSize = Math.round(firstVisIdx / (currentPage - 1)) || fallbackPageSize || 50;
          } else {
            pageSize = fallbackPageSize || 50;
          }
        }

        // 1. Match exact row rendered in the current DOM page (strictest match first)
        let targetLink = null;
        if (clave) {
          for (const tr of rows) {
            const txt = (tr.textContent || '') + ' ' + (tr.innerHTML || '');
            if (txt.includes(clave)) {
              targetLink = tr.querySelector(linkSel);
              if (targetLink) break;
            }
          }
        }
        if (!targetLink && numComp && rucEmisor) {
          for (const tr of rows) {
            const txt = tr.textContent || '';
            if (txt.includes(rucEmisor) && txt.includes(numComp)) {
              targetLink = tr.querySelector(linkSel);
              if (targetLink) break;
            }
          }
        }
        if (!targetLink && numComp) {
          for (const tr of rows) {
            const txt = tr.textContent || '';
            if (txt.includes(numComp)) {
              targetLink = tr.querySelector(linkSel);
              if (targetLink) break;
            }
          }
        }
        if (!targetLink && rowIndex >= 0) {
          for (const tr of rows) {
            const riAttr = tr.getAttribute('data-ri');
            const lnk = tr.querySelector(linkSel);
            const lnkIdx = lnk ? extractIdx(lnk.id) : -1;
            const trIdxMatch = new RegExp(':' + rowIndex + '$').test(tr.id || '');
            if (
              (riAttr !== null && Number(riAttr) === rowIndex) ||
              lnkIdx === rowIndex ||
              trIdxMatch
            ) {
              if (lnk) {
                targetLink = lnk;
                break;
              }
            }
          }
        }

        if (!targetLink && requireDomMatch) {
          return {
            ok: false,
            notOnCurrentPage: true,
            pageSize,
            currentPage,
            reason: 'La fila aún no está visible en la página actual de la tabla del SRI.',
          };
        }

        // 2. Determine target JSF component ID (either from matched DOM row or by template + rowIndex)
        const sampleLink =
          targetLink ||
          document.querySelector('#frmPrincipal\\\\:tablaCompRecibidos_data ' + linkSel) ||
          document.querySelector(linkSel);

        if (!sampleLink) {
          return {
            ok: false,
            reason: 'No se encontró enlace ' + kind.toUpperCase() + ' en la tabla del SRI.',
            pageSize,
            currentPage,
          };
        }

        let targetId = targetLink ? targetLink.id : '';
        let targetName = targetLink ? targetLink.getAttribute('name') || targetLink.id : '';

        if (!targetId && rowIndex >= 0) {
          targetId = sampleLink.id.replace(/:(\\d+):([^:]+)$/, ':' + rowIndex + ':$2');
          targetName = (sampleLink.getAttribute('name') || sampleLink.id).replace(
            /:(\\d+):([^:]+)$/,
            ':' + rowIndex + ':$2'
          );
        }

        if (!targetId) {
          return {
            ok: false,
            reason: 'No se pudo determinar la fila para ' + kind.toUpperCase() + '.',
            pageSize,
            currentPage,
          };
        }

        const fd = new FormData(form);
        const body = new URLSearchParams();
        let latestViewState = '';
        for (const [k, v] of fd.entries()) {
          if (typeof v !== 'string') continue;
          if (k === 'javax.faces.ViewState') {
            if (v) latestViewState = v;
            continue;
          }
          body.append(k, v);
        }
        const vsInputs = Array.from(form.querySelectorAll('input[name="javax.faces.ViewState"]'));
        for (const inp of vsInputs) {
          if (inp.value) latestViewState = inp.value;
        }
        if (!latestViewState) {
          const globalVs = document.querySelector('input[name="javax.faces.ViewState"]');
          if (globalVs && globalVs.value) latestViewState = globalVs.value;
        }
        if (latestViewState) {
          body.set('javax.faces.ViewState', latestViewState);
        }

        const onclickAttr = (targetLink || sampleLink).getAttribute('onclick') || '';
        const pairRegex = /['"]([^'"]+)['"]\\s*:\\s*['"]([^'"]*)['"]/g;
        let m;
        while ((m = pairRegex.exec(onclickAttr)) !== null) {
          let k = m[1];
          let v = m[2];
          if (!targetLink && rowIndex >= 0) {
            k = k.replace(/:(\\d+):([^:]+)$/, ':' + rowIndex + ':$2');
            v = v.replace(/:(\\d+):([^:]+)$/, ':' + rowIndex + ':$2');
          }
          body.set(k, v);
        }

        body.set(targetName || targetId, targetId);

        const actionUrl = form.getAttribute('action')
          ? new URL(form.getAttribute('action'), window.location.href).toString()
          : window.location.href;

        const ac = new AbortController();
        const fetchTimer = setTimeout(() => ac.abort(), 16000);
        let resp;
        let bytes;
        try {
          resp = await fetch(actionUrl, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
            signal: ac.signal,
          });
          bytes = new Uint8Array(await resp.arrayBuffer());
        } catch (fetchErr) {
          return {
            ok: false,
            reason: ac.signal.aborted
              ? 'Tiempo de espera agotado al descargar ' + kind.toUpperCase() + ' del SRI (16s).'
              : 'Error de red al descargar ' + kind.toUpperCase() + ': ' + (fetchErr?.message || String(fetchErr)),
            pageSize,
            currentPage,
          };
        } finally {
          clearTimeout(fetchTimer);
        }

        const ct = (resp.headers.get('content-type') || '').toLowerCase();

        const inspectHtmlFailure = () => {
          const text = new TextDecoder('utf-8').decode(bytes.subarray(0, 65536));
          const respUrl = (resp.url || '').toLowerCase();
          const isSessionExpired =
            respUrl.includes('/auth/realms') ||
            respUrl.includes('login') ||
            /ViewExpiredException|sesi[oó]n\\s+(ha\\s+)?expirad|id=["']usuario["']/i.test(text);
          let sriMessage = '';
          let title = '';
          try {
            const doc = new DOMParser().parseFromString(text, 'text/html');
            title = (doc.title || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
            const msgEls = Array.from(
              doc.querySelectorAll(
                '.ui-messages-error-summary, .ui-messages-error-detail, .ui-messages-warn-summary, .ui-message-error-detail, .ui-growl-title, .ui-growl-message, .ui-messages-fatal-summary'
              )
            );
            const parts = Array.from(
              new Set(
                msgEls
                  .map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim())
                  .filter(Boolean)
              )
            );
            sriMessage = parts.join(' — ').slice(0, 220);
          } catch {
            // ignore DOMParser issues
          }
          const diag =
            'dom=' +
            Boolean(targetLink) +
            ' curPage=' +
            currentPage +
            ' ps=' +
            pageSize +
            ' rows=' +
            visibleCount +
            ' vis=' +
            firstVisIdx +
            '..' +
            lastVisIdx +
            ' id=' +
            targetId +
            ' vs=' +
            vsInputs.length +
            ' len=' +
            bytes.length +
            (title ? ' title=' + JSON.stringify(title) : '');
          return { sriMessage, isSessionExpired, diag };
        };

        if (kind === 'pdf') {
          const isPdfMagic =
            bytes.length > 100 &&
            bytes[0] === 0x25 &&
            bytes[1] === 0x50 &&
            bytes[2] === 0x44 &&
            bytes[3] === 0x46;
          if (!isPdfMagic) {
            const { sriMessage, isSessionExpired, diag } = inspectHtmlFailure();
            const baseReason = isSessionExpired
              ? 'Sesión del SRI expirada; vuelve a conectar al portal.'
              : sriMessage
                ? 'SRI: ' + sriMessage
                : 'El SRI no devolvió un PDF (HTTP ' + resp.status + ', ' + (ct || 'sin tipo') + ').';
            return {
              ok: false,
              reason: baseReason,
              sriMessage,
              diag,
              foundInDom: Boolean(targetLink),
              isSessionExpired,
              pageSize,
              currentPage,
            };
          }
        } else {
          const preview = new TextDecoder('utf-8').decode(bytes.subarray(0, 400)).trim();
          const isXmlDoc =
            bytes.length > 80 &&
            (preview.startsWith('<?xml') ||
              preview.includes('<autorizacion') ||
              preview.includes('<factura') ||
              preview.includes('<notaCredito') ||
              preview.includes('<comprobanteRetencion') ||
              preview.includes('<liquidacionCompra'));
          if (!isXmlDoc) {
            const { sriMessage, isSessionExpired, diag } = inspectHtmlFailure();
            const baseReason = isSessionExpired
              ? 'Sesión del SRI expirada; vuelve a conectar al portal.'
              : sriMessage
                ? 'SRI: ' + sriMessage
                : 'El SRI no devolvió un XML (HTTP ' + resp.status + ', ' + (ct || 'sin tipo') + ').';
            return {
              ok: false,
              reason: baseReason,
              sriMessage,
              diag,
              foundInDom: Boolean(targetLink),
              isSessionExpired,
              pageSize,
              currentPage,
            };
          }
        }

        let bin = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
        }
        return { ok: true, base64: btoa(bin), pageSize, currentPage, foundInDom: Boolean(targetLink) };
      })();
    `,
      22_000,
      `fetch-${params.kind}`
    );

    if (typeof result?.pageSize === 'number' && result.pageSize > 0) {
      this.knownTablePageSize = result.pageSize;
    }
    if (typeof result?.currentPage === 'number' && result.currentPage > 0) {
      this.lastActiveTablePage = result.currentPage;
    }

    if (result?.ok && typeof result.base64 === 'string') {
      return {
        ok: true,
        buffer: Buffer.from(result.base64, 'base64'),
        pageSize: result.pageSize,
        currentPage: result.currentPage,
        foundInDom: Boolean(result.foundInDom),
      };
    }
    return {
      ok: false,
      reason: result?.reason || `No se pudo descargar el ${params.kind.toUpperCase()} original del SRI.`,
      sriMessage: result?.sriMessage,
      diag: result?.diag,
      foundInDom: Boolean(result?.foundInDom),
      pageSize: result?.pageSize,
      currentPage: result?.currentPage,
      notOnCurrentPage: Boolean(result?.notOnCurrentPage),
      isSessionExpired: Boolean(result?.isSessionExpired),
    };
  }

  /**
   * Native fallback: clicks the actual PrimeFaces/JSF download link in the visible table row
   * and captures the resulting download via Electron's `will-download` interceptor.
   * This lets PrimeFaces submit its exact internal form state/ViewState on page 2+.
   */
  private async tryNativeClickPortalDoc(params: {
    kind: 'pdf' | 'xml';
    claveAcceso: string;
    rowIndex?: number;
    numeroComprobante?: string;
    rucEmisor?: string;
    signal?: AbortSignal;
  }): Promise<{ ok: boolean; buffer?: Buffer; reason?: string }> {
    if (!this.view || !this.isOnRecibidosPage()) {
      return { ok: false, reason: 'El portal del SRI no está abierto en Comprobantes Recibidos.' };
    }
    if (params.signal?.aborted) {
      return { ok: false, reason: 'Descarga cancelada.' };
    }

    // Cancel any stale pending download just in case
    if (this.pendingNativeDocDownload) {
      clearTimeout(this.pendingNativeDocDownload.timer);
      this.pendingNativeDocDownload.resolve({ ok: false, reason: 'Descarga reemplazada.' });
      this.pendingNativeDocDownload = null;
    }

    let resolveDownload!: (res: { ok: boolean; buffer?: Buffer; reason?: string }) => void;
    const downloadPromise = new Promise<{ ok: boolean; buffer?: Buffer; reason?: string }>((resolve) => {
      resolveDownload = resolve;
    });
    const pendingEntry: PendingNativeDocDownload = {
      kind: params.kind,
      resolve: resolveDownload,
      timer: setTimeout(() => {
        if (this.pendingNativeDocDownload === pendingEntry) {
          this.pendingNativeDocDownload = null;
        }
        resolveDownload({
          ok: false,
          reason: `El SRI no inició la descarga nativa de ${params.kind.toUpperCase()} tras pulsar el enlace.`,
        });
      }, 9000),
    };
    this.pendingNativeDocDownload = pendingEntry;

    const clicked = await this.execJsWithTimeout<{ clicked: boolean; id?: string }>(
      `
      (() => {
        const kind = ${JSON.stringify(params.kind)};
        const clave = ${JSON.stringify(params.claveAcceso)};
        const rowIndex = ${JSON.stringify(typeof params.rowIndex === 'number' ? params.rowIndex : -1)};
        const numComp = ${JSON.stringify(params.numeroComprobante ?? '')};
        const rucEmisor = ${JSON.stringify(params.rucEmisor ?? '')};

        const rows = Array.from(
          document.querySelectorAll('#frmPrincipal\\\\:tablaCompRecibidos_data tr, table[id*="tablaCompRecibidos"] tbody tr')
        );
        const linkSel =
          kind === 'xml'
            ? 'a[id*="lnkXml"], a[id*="Xml"], a[onclick*="lnkXml"]'
            : 'a[id*="lnkPdf"], a[id*="Pdf"], a[onclick*="lnkPdf"]';

        let targetLink = null;
        if (clave) {
          for (const tr of rows) {
            const txt = (tr.textContent || '') + ' ' + (tr.innerHTML || '');
            if (txt.includes(clave)) {
              targetLink = tr.querySelector(linkSel);
              if (targetLink) break;
            }
          }
        }
        if (!targetLink && numComp && rucEmisor) {
          for (const tr of rows) {
            const txt = tr.textContent || '';
            if (txt.includes(rucEmisor) && txt.includes(numComp)) {
              targetLink = tr.querySelector(linkSel);
              if (targetLink) break;
            }
          }
        }
        if (!targetLink && numComp) {
          for (const tr of rows) {
            const txt = tr.textContent || '';
            if (txt.includes(numComp)) {
              targetLink = tr.querySelector(linkSel);
              if (targetLink) break;
            }
          }
        }
        if (!targetLink && rowIndex >= 0) {
          for (const tr of rows) {
            const riAttr = tr.getAttribute('data-ri');
            const lnk = tr.querySelector(linkSel);
            const mm = /:(\\d+):[^:]+$/.exec(lnk?.id || '');
            const lnkIdx = mm ? Number(mm[1]) : -1;
            const trIdxMatch = new RegExp(':' + rowIndex + '$').test(tr.id || '');
            if (
              (riAttr !== null && Number(riAttr) === rowIndex) ||
              lnkIdx === rowIndex ||
              trIdxMatch
            ) {
              if (lnk) {
                targetLink = lnk;
                break;
              }
            }
          }
        }

        if (!targetLink) return { clicked: false };
        targetLink.click();
        return { clicked: true, id: targetLink.id || '' };
      })();
    `,
      8_000,
      `click-${params.kind}`
    );

    if (!clicked?.clicked) {
      if (pendingEntry) {
        clearTimeout(pendingEntry.timer);
        if (this.pendingNativeDocDownload === pendingEntry) {
          this.pendingNativeDocDownload = null;
        }
      }
      return {
        ok: false,
        reason: `No se encontró el enlace ${params.kind.toUpperCase()} visible en la tabla del SRI.`,
      };
    }

    return downloadPromise;
  }

  private async navigateTableToPage(targetPageOneBased: number): Promise<boolean> {
    if (!this.view || !this.isOnRecibidosPage()) return false;
    try {
      const navResult = await this.execJsWithTimeout<any>(
        `
        (async () => {
          const targetNum = ${JSON.stringify(targetPageOneBased)};
          const target = String(targetNum);

          const getFirstRowSig = () => {
            const tr = document.querySelector('#frmPrincipal\\\\:tablaCompRecibidos_data tr, table[id*="tablaCompRecibidos"] tbody tr');
            if (!tr) return '';
            const lnk = tr.querySelector('a[id*="lnkXml"], a[id*="lnkPdf"], a[id*="Xml"], a[id*="Pdf"]');
            return (lnk?.id || tr.id || '') + '|' + (tr.textContent || '').trim().slice(0, 80);
          };

          const getActiveNum = () => {
            const active = document.querySelector(
              '#frmPrincipal\\\\:tablaCompRecibidos .ui-paginator-page.ui-state-active, .ui-paginator-page.ui-state-active, .ui-paginator-page.ui-state-highlight, .rf-ds-act, .rf-ds-nmb-btn.rf-ds-act, [class*="paginator"] [aria-current="page"]'
            );
            const n = Number((active?.textContent || '').trim());
            if (n > 0) return n;
            const curTxt = document.querySelector('.ui-paginator-current, [class*="paginator-current"]')?.textContent || '';
            const pm = /\\b(\\d+)\\s*(?:de|of|[/])\\s*\\d+/i.exec(curTxt);
            return pm ? Number(pm[1]) : 1;
          };

          const waitForPageChange = async (beforeSig, expectedNum) => {
            for (let i = 0; i < 40; i++) {
              await new Promise((r) => setTimeout(r, 150));
              const isLoading = Boolean(
                document.querySelector('.ui-blockui, .ui-widget-overlay, .rf-st-start, .ui-state-loading')
              );
              const curNum = getActiveNum();
              const afterSig = getFirstRowSig();
              if (!isLoading && afterSig && afterSig !== beforeSig && (curNum === expectedNum || expectedNum <= 0)) {
                await new Promise((r) => setTimeout(r, 180));
                return true;
              }
            }
            return getActiveNum() === expectedNum || getFirstRowSig() !== beforeSig;
          };

          const findPageButtons = () => {
            const explicit = Array.from(
              document.querySelectorAll(
                '#frmPrincipal\\\\:tablaCompRecibidos .ui-paginator-page, .ui-paginator-page, a.rf-ds-nmb-btn, span.rf-ds-nmb-btn, [id*="tablaCompRecibidos"] [class*="ds"] a, [class*="rf-ds"] a, [class*="paginator"] a, [class*="paginator"] button, [id*="ds_ds_"]'
              )
            );
            return explicit.filter((el) => /^\\d+$/.test((el.textContent || '').trim()));
          };

          const findStepButton = (forward) => {
            const sels = forward
              ? [
                  '#frmPrincipal\\\\:tablaCompRecibidos .ui-paginator-next:not(.ui-state-disabled)',
                  '.ui-paginator-next:not(.ui-state-disabled)',
                  'a.rf-ds-btn-next:not(.rf-ds-dis)',
                  '.rf-ds-btn-next:not(.rf-ds-dis)',
                  '[id$="_ds_next"]:not(.rf-ds-dis)',
                  'a[title*="Siguiente"]:not(.ui-state-disabled)',
                  'button[aria-label*="Next"]:not(:disabled)',
                ]
              : [
                  '#frmPrincipal\\\\:tablaCompRecibidos .ui-paginator-prev:not(.ui-state-disabled)',
                  '.ui-paginator-prev:not(.ui-state-disabled)',
                  'a.rf-ds-btn-prev:not(.rf-ds-dis)',
                  '.rf-ds-btn-prev:not(.rf-ds-dis)',
                  '[id$="_ds_prev"]:not(.rf-ds-dis)',
                  'a[title*="Anterior"]:not(.ui-state-disabled)',
                  'button[aria-label*="Previous"]:not(:disabled)',
                ];
            for (const s of sels) {
              const el = document.querySelector(s);
              if (el) return el;
            }
            return null;
          };

          const triggerClick = (el) => {
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            el.click();
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          };

          if (getActiveNum() === targetNum) {
            return { ok: true, curPage: targetNum, method: 'already' };
          }

          // Handle both directly visible page buttons and sliding paginator windows (>10 pages)
          for (let hop = 0; hop < 15; hop++) {
            const curNum = getActiveNum();
            if (curNum === targetNum) return { ok: true, curPage: curNum, method: 'loop' };

            const pages = findPageButtons();
            const directBtn = pages.find((el) => (el.textContent || '').trim() === target);
            const beforeSig = getFirstRowSig();

            if (directBtn) {
              triggerClick(directBtn);
              const changed = await waitForPageChange(beforeSig, targetNum);
              return { ok: changed, curPage: getActiveNum(), method: 'direct:' + (directBtn.className || directBtn.id || directBtn.tagName) };
            }

            // Target page is outside current paginator window — step toward it
            const stepBtn = findStepButton(targetNum > curNum);
            if (!stepBtn) {
              // Capture diagnostic summary of any paginator-like elements near the table
              const diagEls = Array.from(
                document.querySelectorAll('[class*="pagin"], [class*="rf-ds"], [id*="ds"], [id*="tablaCompRecibidos"] tfoot a, [id*="tablaCompRecibidos"] tfoot span')
              )
                .slice(0, 12)
                .map((e) => e.tagName + '#' + (e.id || '') + '.' + String(e.className || '').replace(/\\s+/g, '.') + '[' + (e.textContent || '').trim().slice(0, 20) + ']');
              return { ok: false, curPage: curNum, method: 'none', diag: diagEls.join(' | ') };
            }
            triggerClick(stepBtn);
            await waitForPageChange(beforeSig, targetNum > curNum ? curNum + 1 : curNum - 1);
          }

          return { ok: getActiveNum() === targetNum, curPage: getActiveNum(), method: 'exhausted' };
        })();
      `,
        16_000,
        `paginate-${targetPageOneBased}`
      );
      if (navResult?.ok) {
        this.lastActiveTablePage = navResult.curPage || targetPageOneBased;
        this.trace('PAGINATOR_NAV', `target=${targetPageOneBased} cur=${this.lastActiveTablePage} method=${navResult.method}`);
        return true;
      }
      this.trace(
        'PAGINATOR_MISS',
        `target=${targetPageOneBased} cur=${navResult?.curPage ?? '?'} method=${navResult?.method ?? 'err'} diag=${navResult?.diag ?? ''}`
      );
      return false;
    } catch {
      return false;
    }
  }

  private async downloadOriginalSriDocument(
    kind: 'pdf' | 'xml',
    params: {
      claveAcceso: string;
      rowIndex?: number;
      numeroComprobante?: string;
      rucEmisor?: string;
      signal?: AbortSignal;
    }
  ): Promise<{ ok: boolean; buffer?: Buffer; reason?: string }> {
    try {
      return await this.withPortalDocLock(async () => {
        const retryDelaysMs = [0, 450, 1100];
        let lastRes: {
          ok: boolean;
          buffer?: Buffer;
          reason?: string;
          sriMessage?: string;
          diag?: string;
          foundInDom?: boolean;
          pageSize?: number;
          currentPage?: number;
          notOnCurrentPage?: boolean;
          isSessionExpired?: boolean;
        } = { ok: false, reason: `No se pudo descargar el ${kind.toUpperCase()} original del SRI.` };

        const hasRowIndex = typeof params.rowIndex === 'number' && params.rowIndex >= 0;
        let lastTargetPage = this.lastActiveTablePage || 1;

        // If a previous page 2+ fetch required native click, navigate to target page and use native click directly
        if (this.preferNativeClick) {
          if (hasRowIndex) {
            const targetPage = Math.floor((params.rowIndex as number) / (this.knownTablePageSize || 50)) + 1;
            lastTargetPage = targetPage;
            if (targetPage !== this.lastActiveTablePage) {
              await this.navigateTableToPage(targetPage);
            }
          }
          const nativeFast = await this.tryNativeClickPortalDoc({ kind, ...params });
          if (nativeFast.ok && nativeFast.buffer) {
            return { ok: true, buffer: nativeFast.buffer };
          }
          lastRes = nativeFast;
        }

        for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
          if (params.signal?.aborted) {
            return { ok: false, reason: 'Descarga cancelada.' };
          }

          if (retryDelaysMs[attempt] > 0) {
            await new Promise((r) => setTimeout(r, retryDelaysMs[attempt]));
            if (params.signal?.aborted) {
              return { ok: false, reason: 'Descarga cancelada.' };
            }
          }

          // First attempt: require DOM match when rowIndex is known so we paginate cleanly BEFORE posting
          let res = await this.tryFetchPortalDocOnce({
            kind,
            claveAcceso: params.claveAcceso,
            rowIndex: params.rowIndex,
            numeroComprobante: params.numeroComprobante,
            rucEmisor: params.rucEmisor,
            requireDomMatch: hasRowIndex && attempt === 0,
          });

          if (res.ok && res.buffer) {
            return { ok: true, buffer: res.buffer };
          }

          if (res.isSessionExpired) {
            lastRes = res;
            break;
          }

          // If row isn't on the active page, switch PrimeFaces paginator to its page and fetch
          if (hasRowIndex && (res.notOnCurrentPage || attempt === 0)) {
            const pageSize = res.pageSize && res.pageSize > 0 ? res.pageSize : this.knownTablePageSize || 50;
            const targetPage = Math.floor((params.rowIndex as number) / pageSize) + 1;
            lastTargetPage = targetPage;

            if (res.notOnCurrentPage || res.currentPage !== targetPage) {
              const paged = await this.navigateTableToPage(targetPage);
              if (paged && !params.signal?.aborted) {
                res = await this.tryFetchPortalDocOnce({
                  kind,
                  claveAcceso: params.claveAcceso,
                  rowIndex: params.rowIndex,
                  numeroComprobante: params.numeroComprobante,
                  rucEmisor: params.rucEmisor,
                  requireDomMatch: false,
                });
                if (res.ok && res.buffer) {
                  return { ok: true, buffer: res.buffer };
                }
                if (res.isSessionExpired) {
                  lastRes = res;
                  break;
                }
              }
            }
          }

          // Fallback: if fetch() returned HTML despite the row being on screen (e.g. PrimeFaces AJAX ViewState quirk on page 2+),
          // click the real link in the DOM and capture the file via Electron's `will-download` handler!
          if (!res.ok && !res.isSessionExpired && attempt === 0 && !params.signal?.aborted) {
            const nativeRes = await this.tryNativeClickPortalDoc({ kind, ...params });
            if (nativeRes.ok && nativeRes.buffer) {
              this.preferNativeClick = true;
              this.trace(
                `SRI_${kind.toUpperCase()}_NATIVE_OK`,
                `row=${params.rowIndex ?? -1} page=${lastTargetPage} switched_to_native=true`
              );
              return { ok: true, buffer: nativeRes.buffer };
            }
          }

          lastRes = res;
        }

        this.trace(
          `SRI_${kind.toUpperCase()}_ERR`,
          `row=${params.rowIndex ?? -1} page=${lastTargetPage} clave=${params.claveAcceso.slice(-12)} ${lastRes.diag ?? ''} reason=${lastRes.reason ?? 'unknown'}`
        );
        return { ok: false, reason: lastRes.reason };
      }, { rowIndex: params.rowIndex, signal: params.signal });
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : `No se pudo descargar el ${kind.toUpperCase()} original del SRI.`,
      };
    }
  }

  /**
   * Downloads the 100% ORIGINAL PDF (RIDE) directly from the SRI portal (`lnkPdf`)
   * using the user's active authenticated session on comprobantesRecibidos.jsf.
   */
  public async downloadOriginalSriPdf(params: {
    claveAcceso: string;
    rowIndex?: number;
    numeroComprobante?: string;
    rucEmisor?: string;
    signal?: AbortSignal;
  }): Promise<{ ok: boolean; buffer?: Buffer; reason?: string }> {
    return this.downloadOriginalSriDocument('pdf', params);
  }

  /**
   * Downloads the 100% ORIGINAL XML directly from the SRI portal (`lnkXml`),
   * essential for historical months where AutorizacionComprobantesOffline SOAP no longer retains data.
   */
  public async downloadOriginalSriXml(params: {
    claveAcceso: string;
    rowIndex?: number;
    numeroComprobante?: string;
    rucEmisor?: string;
    signal?: AbortSignal;
  }): Promise<{ ok: boolean; buffer?: Buffer; reason?: string }> {
    return this.downloadOriginalSriDocument('xml', params);
  }

  public async captureFromPortal(): Promise<{
    ok: boolean;
    message: string;
    triggeredDownload?: boolean;
    count?: number;
  }> {
    if (!this.view || !this.currentFilter) {
      return { ok: false, message: 'Primero abre el portal del SRI y consulta un período.' };
    }
    if (this.downloadManager.isBusy()) {
      return { ok: false, message: 'Ya hay una descarga masiva en curso.' };
    }

    try {
      const clickedReport = await this.view.webContents.executeJavaScript(`
        (() => {
          const reportLink =
            document.querySelector('#frmPrincipal\\\\:lnkTxtlistado') ||
            document.querySelector('a[id*="lnkTxtlistado"]') ||
            Array.from(document.querySelectorAll('a, button')).find((el) =>
              /descargar\\s+reporte/i.test(el.textContent || '')
            );
          if (reportLink) {
            const rect = reportLink.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              reportLink.click();
              return true;
            }
          }
          return false;
        })();
      `);

      if (clickedReport) {
        return {
          ok: true,
          triggeredDownload: true,
          message: 'Capturando listado completo del período automáticamente...',
        };
      }

      const domText: string = await this.view.webContents.executeJavaScript(`
        (() => document.body ? document.body.innerHTML : '')();
      `);
      const entries = extractKeysFromReportText(domText);

      if (entries.length === 0) {
        return {
          ok: false,
          message:
            'No se encontraron comprobantes aún. Haz clic en «Consultar» en el portal del SRI.',
        };
      }

      void this.deliverCapturedBatch(entries);
      return {
        ok: true,
        count: entries.length,
        message: `Se detectaron ${entries.length} comprobantes. Elige cuáles deseas descargar.`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'Error al capturar datos del portal del SRI.',
      };
    }
  }
}
