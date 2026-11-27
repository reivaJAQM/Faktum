import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  CalendarRange,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FolderOpen,
  ListChecks,
  LogOut,
  PlugZap,
  Plus,
  RefreshCw,
  RotateCcw,
  SkipForward,
  X,
  XCircle,
} from 'lucide-react';
import {
  SRI_DOC_TYPES,
  type DownloadFormats,
  type DownloadProgressEvent,
  type PortalStatusEvent,
  type RangeProgressEvent,
  type RucProfile,
} from '../../../shared/types';
import { FaktumDatePicker } from './FaktumDatePicker';
import { FaktumSelect } from './FaktumSelect';

const MONTHS = [
  { value: 1, label: 'Enero' },
  { value: 2, label: 'Febrero' },
  { value: 3, label: 'Marzo' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Mayo' },
  { value: 6, label: 'Junio' },
  { value: 7, label: 'Julio' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Septiembre' },
  { value: 10, label: 'Octubre' },
  { value: 11, label: 'Noviembre' },
  { value: 12, label: 'Diciembre' },
];

type QueryMode = 'month' | 'year' | 'range';

function buildYearRange(year: number): { fromDate: string; toDate: string } {
  return { fromDate: `${year}-01-01`, toDate: `${year}-12-31` };
}

function countMonthsBetween(fromIso: string, toIso: string): number {
  const m1 = fromIso.match(/^(\d{4})-(\d{2})-\d{2}$/);
  const m2 = toIso.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m1 || !m2) return 0;
  const total1 = Number(m1[1]) * 12 + (Number(m1[2]) - 1);
  const total2 = Number(m2[1]) * 12 + (Number(m2[2]) - 1);
  return Math.abs(total2 - total1) + 1;
}

interface PortalWorkspaceProps {
  isActive: boolean;
  anyModalOpen: boolean;
  profiles: RucProfile[];
  selectedProfileId: string;
  onSelectProfile: (id: string) => void;
  onOpenNewProfile: () => void;
  portalStatus: PortalStatusEvent;
  downloadProgress: DownloadProgressEvent | null;
  rangeProgress: RangeProgressEvent | null;
  onClearRangeProgress: () => void;
  defaultFormats: DownloadFormats;
  capturedCount: number;
  comprobantesCount: number;
  outputDir: string;
  onOpenCapturedSelector: () => void;
  onOpenHistory: () => void;
}

export const PortalWorkspace: React.FC<PortalWorkspaceProps> = ({
  isActive,
  anyModalOpen,
  profiles,
  selectedProfileId,
  onSelectProfile,
  onOpenNewProfile,
  portalStatus,
  downloadProgress,
  rangeProgress,
  onClearRangeProgress,
  defaultFormats,
  capturedCount,
  comprobantesCount,
  outputDir,
  onOpenCapturedSelector,
  onOpenHistory,
}) => {
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const defaultFromIso = `${now.getFullYear()}-01-01`;

  const [mode, setMode] = useState<QueryMode>('month');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [day, setDay] = useState(0);
  const [fromDate, setFromDate] = useState(defaultFromIso);
  const [toDate, setToDate] = useState(todayIso);
  const [rangeXml, setRangeXml] = useState(defaultFormats.xml);
  const [rangePdf, setRangePdf] = useState(defaultFormats.pdf);
  const [rangeExcel, setRangeExcel] = useState(defaultFormats.excel);
  const [docType, setDocType] = useState('ALL');
  const [portalOpen, setPortalOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [openDropdowns, setOpenDropdowns] = useState(0);
  const [openCalendars, setOpenCalendars] = useState(0);

  useEffect(() => {
    setRangeXml(defaultFormats.xml);
    setRangePdf(defaultFormats.pdf);
    setRangeExcel(defaultFormats.excel);
  }, [defaultFormats.xml, defaultFormats.pdf, defaultFormats.excel]);

  const handleDropdownOpenChange = useCallback((isOpen: boolean) => {
    setOpenDropdowns((prev) => Math.max(0, prev + (isOpen ? 1 : -1)));
  }, []);

  const handleCalendarOpenChange = useCallback((isOpen: boolean) => {
    setOpenCalendars((prev) => Math.max(0, prev + (isOpen ? 1 : -1)));
  }, []);

  const stageRef = useRef<HTMLDivElement>(null);
  const years = Array.from({ length: 8 }, (_, i) => now.getFullYear() - i);

  const effectiveRange = useMemo(() => {
    if (mode === 'year') return buildYearRange(year);
    return { fromDate, toDate };
  }, [mode, year, fromDate, toDate]);

  const rangeMonthsCount = useMemo(
    () => countMonthsBetween(effectiveRange.fromDate, effectiveRange.toDate),
    [effectiveRange.fromDate, effectiveRange.toDate]
  );

  const syncBounds = useCallback(() => {
    if (!portalOpen) return;
    const shouldShow = isActive && !anyModalOpen;
    if (!shouldShow || !stageRef.current) {
      void window.faktum.updatePortalBounds({ x: 0, y: 0, width: 0, height: 0 }, false);
      return;
    }
    const r = stageRef.current.getBoundingClientRect();
    const neededClearance = openCalendars > 0 ? 430 : openDropdowns > 0 ? 280 : 0;
    const dropOffset =
      neededClearance > 0 ? Math.min(neededClearance, Math.max(0, r.height - 60)) : 0;
    void window.faktum.updatePortalBounds(
      {
        x: r.left,
        y: r.top + dropOffset,
        width: r.width,
        height: Math.max(0, r.height - dropOffset),
      },
      true
    );
  }, [portalOpen, isActive, anyModalOpen, openDropdowns, openCalendars]);

  useEffect(() => {
    syncBounds();
  }, [
    syncBounds,
    downloadProgress?.status,
    downloadProgress?.errors.length,
    portalStatus.state,
    portalStatus.message,
    feedback,
    capturedCount,
    rangeProgress?.status,
    rangeProgress?.active,
    mode,
  ]);

  useEffect(() => {
    setFeedback('');
  }, [portalStatus.message, portalStatus.state]);

  const getStageBounds = useCallback(() => {
    const r = stageRef.current?.getBoundingClientRect() ?? {
      left: 232,
      top: 150,
      width: 900,
      height: 600,
    };
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, []);

  const isDownloading = downloadProgress?.status === 'running';
  const anyRangeFormat = rangeXml || rangePdf || rangeExcel;

  // Automatically sync single-month filters to the SRI portal whenever changed
  const isFirstFilterRender = useRef(true);
  useEffect(() => {
    if (isFirstFilterRender.current) {
      isFirstFilterRender.current = false;
      return;
    }
    if (mode !== 'month' || !portalOpen || !selectedProfileId) return;
    void window.faktum.applyPortalFilters({
      profileId: selectedProfileId,
      year,
      month,
      day,
      docType,
    });
  }, [mode, portalOpen, selectedProfileId, year, month, day, docType]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => syncBounds());
    ro.observe(el);
    window.addEventListener('resize', syncBounds);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', syncBounds);
    };
  }, [syncBounds]);

  const handleOpenPortal = async (overrideProfileId?: string) => {
    const targetProfileId = overrideProfileId ?? selectedProfileId;
    if (!targetProfileId) {
      if (profiles.length === 0) {
        onOpenNewProfile();
      } else {
        setFeedback('Primero selecciona un RUC / Empresa para conectar al SRI.');
      }
      return;
    }
    if (overrideProfileId && overrideProfileId !== selectedProfileId) {
      onSelectProfile(overrideProfileId);
    }
    setFeedback('');
    setPortalOpen(true);

    try {
      await window.faktum.openPortal(
        {
          profileId: targetProfileId,
          year,
          month,
          day,
          docType,
        },
        getStageBounds()
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'No se pudo abrir el portal del SRI.');
    }
  };

  // Explicit "Descargar Facturas": only starts the multi-month orchestration when the user
  // has finished choosing the year/date range and formats.
  const handleStartRange = async () => {
    if (!selectedProfileId) {
      if (profiles.length === 0) {
        onOpenNewProfile();
      } else {
        setFeedback('Primero selecciona un RUC / Empresa para descargar.');
      }
      return;
    }
    if (!anyRangeFormat) {
      setFeedback('Marca al menos un formato (XML, PDF o Excel) para descargar.');
      return;
    }
    setFeedback('');
    try {
      const res = await window.faktum.startDateRange(
        {
          profileId: selectedProfileId,
          fromDate: effectiveRange.fromDate,
          toDate: effectiveRange.toDate,
          docType,
          formats: { xml: rangeXml, pdf: rangePdf, excel: rangeExcel },
        },
        getStageBounds()
      );
      if (res.ok) {
        setPortalOpen(true);
      } else if (res.message) {
        setFeedback(res.message);
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'No se pudo iniciar la descarga.');
    }
  };

  // Explicit "Descargar Facturas" for "Por mes": connects if needed, applies the month filter
  // and presses «Consultar» in the SRI for you. The captured list then opens the file selector.
  const handleDownloadMonth = async () => {
    if (!selectedProfileId) {
      if (profiles.length === 0) {
        onOpenNewProfile();
      } else {
        setFeedback('Primero selecciona un RUC / Empresa para descargar.');
      }
      return;
    }
    setFeedback('');
    try {
      const res = await window.faktum.consultMonth(
        { profileId: selectedProfileId, year, month, day, docType },
        getStageBounds()
      );
      if (res.ok) {
        setPortalOpen(true);
      } else if (res.message) {
        setFeedback(res.message);
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'No se pudo iniciar la descarga del mes.');
    }
  };

  const handleModeChange = (nextMode: QueryMode) => {
    if (nextMode === mode) return;
    setFeedback('');
    if (rangeProgress?.active) {
      void window.faktum.cancelDateRange();
    }
    onClearRangeProgress();
    setMode(nextMode);
  };

  const handleClosePortal = async () => {
    await window.faktum.closePortal();
    onClearRangeProgress();
    setPortalOpen(false);
    setFeedback('');
  };

  const progressPercent =
    downloadProgress && downloadProgress.total > 0
      ? Math.round((downloadProgress.processed / downloadProgress.total) * 100)
      : 0;

  // Show a single unified status strip below the toolbar (never two stacked conflicting banners)
  const isPeriodRange = mode === 'year' || mode === 'range';
  const showRangeStrip = isPeriodRange;
  const bannerMessage = feedback || portalStatus.message;
  const hasBannerAction = capturedCount > 0 && mode === 'month';
  const showPortalBanner = !showRangeStrip && (Boolean(bannerMessage) || hasBannerAction);
  const rangeActive = Boolean(rangeProgress?.active);
  const rangeFinished = Boolean(rangeProgress && !rangeProgress.active);
  const hideStaleRangeProgress = Boolean(
    rangeProgress?.active &&
      rangeProgress.status === 'waiting_consult' &&
      downloadProgress?.status === 'completed' &&
      downloadProgress.errors.length === 0
  );
  const showProgressStrip = Boolean(downloadProgress && !hideStaleRangeProgress);
  const activeRangeMonthLabel = rangeProgress
    ? (MONTHS[rangeProgress.currentMonth - 1]?.label ?? String(rangeProgress.currentMonth))
    : '';

  return (
    <div className="portal-workspace">
      <div className="portal-toolbar">
        <div className="toolbar-field toolbar-field-ruc">
          <label htmlFor="sri-ruc-select">RUC / Empresa</label>
          <div className="toolbar-ruc-row">
            <div className="toolbar-ruc-select-wrap">
              <FaktumSelect
                id="sri-ruc-select"
                name="ruc"
                value={selectedProfileId}
                placeholder={profiles.length === 0 ? 'Sin perfiles RUC' : '— Seleccionar RUC —'}
                options={[
                  {
                    value: '',
                    label: profiles.length === 0 ? 'Sin perfiles RUC' : '— Seleccionar RUC —',
                  },
                  ...profiles.map((p) => ({
                    value: p.id,
                    label: p.alias,
                    hint: p.ruc,
                  })),
                ]}
                onOpenChange={handleDropdownOpenChange}
                onChange={(nextId) => {
                  onSelectProfile(nextId);
                  onClearRangeProgress();
                  if (!nextId && portalOpen) {
                    void handleClosePortal();
                  } else if (nextId && portalOpen) {
                    void handleOpenPortal(nextId);
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="btn btn-icon"
              title="Agregar nuevo RUC"
              aria-label="Agregar nuevo perfil RUC"
              onClick={onOpenNewProfile}
            >
              <Plus size={15} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="toolbar-field">
          <label>Período</label>
          <div className="segmented-control" role="group" aria-label="Modo de período">
            <button
              type="button"
              className={mode === 'month' ? 'is-active' : ''}
              onClick={() => handleModeChange('month')}
            >
              Por mes
            </button>
            <button
              type="button"
              className={mode === 'year' ? 'is-active' : ''}
              onClick={() => handleModeChange('year')}
            >
              Por año
            </button>
            <button
              type="button"
              className={mode === 'range' ? 'is-active' : ''}
              onClick={() => handleModeChange('range')}
            >
              Rango
            </button>
          </div>
        </div>

        {mode === 'month' ? (
          <>
            <div className="toolbar-field">
              <label htmlFor="sri-year">Año</label>
              <FaktumSelect
                id="sri-year"
                name="year"
                minWidth={78}
                value={String(year)}
                options={years.map((y) => ({ value: String(y), label: String(y) }))}
                onOpenChange={handleDropdownOpenChange}
                onChange={(val) => setYear(Number(val))}
              />
            </div>

            <div className="toolbar-field">
              <label htmlFor="sri-month">Mes</label>
              <FaktumSelect
                id="sri-month"
                name="month"
                minWidth={112}
                value={String(month)}
                options={MONTHS.map((m) => ({ value: String(m.value), label: m.label }))}
                onOpenChange={handleDropdownOpenChange}
                onChange={(val) => setMonth(Number(val))}
              />
            </div>

            <div className="toolbar-field">
              <label htmlFor="sri-day">Día</label>
              <FaktumSelect
                id="sri-day"
                name="day"
                minWidth={74}
                value={String(day)}
                options={[
                  { value: '0', label: 'Todos' },
                  ...Array.from({ length: 31 }, (_, i) => i + 1).map((d) => ({
                    value: String(d),
                    label: String(d).padStart(2, '0'),
                  })),
                ]}
                onOpenChange={handleDropdownOpenChange}
                onChange={(val) => setDay(Number(val))}
              />
            </div>
          </>
        ) : mode === 'year' ? (
          <div className="toolbar-field">
            <label htmlFor="sri-year-mode">Año</label>
            <FaktumSelect
              id="sri-year-mode"
              name="yearOnly"
              minWidth={94}
              value={String(year)}
              disabled={isDownloading || rangeActive}
              options={years.map((y) => ({ value: String(y), label: String(y) }))}
              onOpenChange={handleDropdownOpenChange}
              onChange={(val) => setYear(Number(val))}
            />
          </div>
        ) : (
          <>
            <div className="toolbar-field">
              <label htmlFor="sri-from-date">Desde</label>
              <FaktumDatePicker
                id="sri-from-date"
                ariaLabel="Fecha desde"
                value={fromDate}
                rangeStart={fromDate}
                rangeEnd={toDate}
                activeEndpoint="start"
                disabled={isDownloading || rangeActive}
                onOpenChange={handleCalendarOpenChange}
                onChange={(nextFrom) => {
                  setFromDate(nextFrom);
                  if (nextFrom > toDate) {
                    setToDate(nextFrom);
                  }
                }}
                onSelectRange={(nextFrom, nextTo) => {
                  setFromDate(nextFrom);
                  setToDate(nextTo);
                }}
              />
            </div>

            <div className="toolbar-field">
              <label htmlFor="sri-to-date">Hasta</label>
              <FaktumDatePicker
                id="sri-to-date"
                ariaLabel="Fecha hasta"
                value={toDate}
                rangeStart={fromDate}
                rangeEnd={toDate}
                activeEndpoint="end"
                disabled={isDownloading || rangeActive}
                onOpenChange={handleCalendarOpenChange}
                onChange={(nextTo) => {
                  setToDate(nextTo);
                  if (nextTo < fromDate) {
                    setFromDate(nextTo);
                  }
                }}
                onSelectRange={(nextFrom, nextTo) => {
                  setFromDate(nextFrom);
                  setToDate(nextTo);
                }}
              />
            </div>
          </>
        )}

        <div className="toolbar-field toolbar-field-doctype">
          <label htmlFor="sri-doctype">Comprobante</label>
          <FaktumSelect
            id="sri-doctype"
            name="docType"
            value={docType}
            options={Object.entries(SRI_DOC_TYPES).map(([key, meta]) => ({
              value: key,
              label: meta.label,
            }))}
            onOpenChange={handleDropdownOpenChange}
            onChange={setDocType}
          />
        </div>

        <div className="toolbar-utils">
          {isPeriodRange && (
            <button
              type="button"
              className="btn btn-primary toolbar-connect-btn"
              disabled={
                (!selectedProfileId && profiles.length > 0) ||
                !anyRangeFormat ||
                rangeActive ||
                isDownloading
              }
              onClick={() => void handleStartRange()}
            >
              <Download size={15} aria-hidden="true" />
              {rangeFinished ? 'Descargar de nuevo' : 'Descargar Facturas'}
            </button>
          )}

          {!isPeriodRange && (
            <>
              <button
                type="button"
                className="btn btn-primary toolbar-connect-btn"
                disabled={(!selectedProfileId && profiles.length > 0) || isDownloading}
                onClick={() => void handleDownloadMonth()}
              >
                <Download size={15} aria-hidden="true" />
                Descargar Facturas
              </button>
              {!portalOpen && (
                <button
                  type="button"
                  className="btn toolbar-connect-btn"
                  title="Abrir el portal del SRI sin iniciar la descarga"
                  disabled={!selectedProfileId && profiles.length > 0}
                  onClick={() => void handleOpenPortal()}
                >
                  <PlugZap size={15} aria-hidden="true" />
                  Conectar
                </button>
              )}
            </>
          )}

          {portalOpen && (
            <>
              {capturedCount > 0 && mode === 'month' && (
                <button
                  type="button"
                  className="btn"
                  style={{ height: 36 }}
                  onClick={onOpenCapturedSelector}
                >
                  <ListChecks size={15} aria-hidden="true" />
                  Elegir archivos ({capturedCount})
                </button>
              )}
              <button
                type="button"
                className="btn btn-icon"
                title="Recargar página del SRI"
                aria-label="Recargar portal SRI"
                onClick={() => void window.faktum.reloadPortal()}
              >
                <RefreshCw size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-icon"
                title="Reiniciar sesión del SRI (limpiar cookies de este RUC)"
                aria-label="Reiniciar sesión del SRI"
                onClick={() => {
                  if (!selectedProfileId) return;
                  setFeedback('');
                  void window.faktum.clearPortalSession(selectedProfileId);
                }}
              >
                <LogOut size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-icon"
                title="Cerrar vista del portal SRI"
                aria-label="Cerrar portal SRI"
                onClick={() => void handleClosePortal()}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Unified Contextual Strip: Range Strip (when in Range mode) OR Portal Banner (when in Month mode / connecting) */}
      {showRangeStrip ? (
        <div className="range-strip" role="region" aria-label="Estado del rango de fechas">
          <div className="progress-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <CalendarRange size={16} aria-hidden="true" style={{ color: 'var(--brand)' }} />
              {!rangeProgress ? (
                <span>
                  <strong>
                    {mode === 'year'
                      ? `Año ${year} · 12 meses`
                      : `Rango de ${rangeMonthsCount} ${rangeMonthsCount === 1 ? 'mes' : 'meses'}`}
                  </strong>{' '}
                  ({effectiveRange.fromDate} → {effectiveRange.toDate}) ·{' '}
                  {mode === 'year'
                    ? 'Faktum descargará todos los meses del año.'
                    : 'Elige las fechas, marca los formatos y pulsa «Descargar Facturas».'}{' '}
                  La consulta y descarga de cada mes es automática.
                  {portalStatus.message && (
                    <span style={{ color: 'var(--muted)', marginLeft: 6 }}>
                      · {portalStatus.message}
                    </span>
                  )}
                </span>
              ) : rangeProgress.active ? (
                <>
                  <strong>
                    Mes {Math.min(rangeProgress.currentIndex + 1, rangeProgress.totalMonths)} de{' '}
                    {rangeProgress.totalMonths} · {activeRangeMonthLabel} {rangeProgress.currentYear}
                  </strong>
                  <span
                    className={`range-step-pill ${
                      rangeProgress.status === 'waiting_consult'
                        ? 'is-waiting'
                        : rangeProgress.status === 'consulting'
                          ? 'is-consulting'
                          : 'is-downloading'
                    }`}
                  >
                    {rangeProgress.status === 'waiting_consult' ? (
                      <>
                        <ArrowDown size={13} aria-hidden="true" className="range-step-arrow" />
                        <span>
                          {rangeProgress.completedMonths > 0
                            ? `Siguiente paso: haz clic en «Consultar» abajo en el SRI para descargar ${activeRangeMonthLabel}`
                            : `Haz clic en «Consultar» abajo en el SRI para iniciar la descarga de ${activeRangeMonthLabel}`}
                        </span>
                      </>
                    ) : rangeProgress.status === 'consulting' ? (
                      <>
                        <RefreshCw size={13} aria-hidden="true" className="range-step-spin" />
                        <span>Consultando {activeRangeMonthLabel} automáticamente en el SRI...</span>
                      </>
                    ) : (
                      <span>Descargando comprobantes de {activeRangeMonthLabel}...</span>
                    )}
                  </span>
                  <span className="badge badge-success">
                    {rangeProgress.totalComprobantes} acumulados
                  </span>
                  {portalStatus.message && (
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                      {portalStatus.message}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <strong style={{ color: 'var(--success)' }}>
                    {mode === 'year' ? 'Año' : 'Rango'} {rangeProgress.fromDate} →{' '}
                    {rangeProgress.toDate}{' '}
                    {rangeProgress.status === 'completed' ? 'completado' : 'detenido'}
                  </strong>
                  <span className="badge badge-success">
                    {rangeProgress.totalComprobantes} comprobantes
                  </span>
                </>
              )}
              {feedback && <span style={{ color: 'var(--danger)', fontWeight: 500 }}>{feedback}</span>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div className="range-formats-pills" role="group" aria-label="Formatos a descargar">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={rangeXml}
                    disabled={isDownloading || rangeActive}
                    onChange={(e) => setRangeXml(e.target.checked)}
                  />
                  XML
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={rangePdf}
                    disabled={isDownloading || rangeActive}
                    onChange={(e) => setRangePdf(e.target.checked)}
                  />
                  PDF
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={rangeExcel}
                    disabled={isDownloading || rangeActive}
                    onChange={(e) => setRangeExcel(e.target.checked)}
                  />
                  Excel
                </label>
              </div>

              {!rangeProgress && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={(!selectedProfileId && profiles.length > 0) || !anyRangeFormat}
                  onClick={() => void handleStartRange()}
                >
                  <Download size={13} aria-hidden="true" />
                  Descargar Facturas
                </button>
              )}

              {rangeProgress?.active && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm"
                    title="Saltar este mes si el SRI no tiene comprobantes"
                    onClick={() => void window.faktum.skipRangeMonth()}
                  >
                    <SkipForward size={13} aria-hidden="true" />
                    Saltar mes
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => void window.faktum.cancelDateRange()}
                  >
                    <XCircle size={13} aria-hidden="true" />
                    Detener
                  </button>
                </>
              )}

              {rangeProgress && !rangeProgress.active && (
                <>
                  {rangeProgress.rangeExcelPath && (
                    <button
                      type="button"
                      className="btn btn-sm btn-success"
                      onClick={() =>
                        void window.faktum.openPathInExplorer(rangeProgress.rangeExcelPath!)
                      }
                    >
                      <FileSpreadsheet size={13} aria-hidden="true" />
                      Abrir Excel
                    </button>
                  )}
                  {rangeProgress.outputFolder && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() =>
                        void window.faktum.openPathInExplorer(rangeProgress.outputFolder!)
                      }
                    >
                      <FolderOpen size={13} aria-hidden="true" />
                      Abrir carpeta
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={!anyRangeFormat || isDownloading}
                    onClick={() => void handleStartRange()}
                  >
                    <RotateCcw size={13} aria-hidden="true" />
                    Descargar de nuevo
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    title="Ocultar aviso"
                    aria-label="Ocultar aviso de rango"
                    onClick={onClearRangeProgress}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : showPortalBanner ? (
        <div className={`portal-banner state-${portalStatus.state}`}>
          <div className="portal-banner-msg">
            <span>{bannerMessage}</span>
          </div>
          <div className="portal-banner-actions">
            {hasBannerAction && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={onOpenCapturedSelector}
              >
                <ListChecks size={13} aria-hidden="true" />
                Elegir comprobantes ({capturedCount})
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* Live download progress bar */}
      {showProgressStrip && downloadProgress && (
        <div className="progress-strip" role="region" aria-label="Progreso de descarga masiva">
          <div className="progress-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {downloadProgress.status === 'running' ? (
                <strong>
                  Descargando {downloadProgress.processed} / {downloadProgress.total} ({progressPercent}%)
                </strong>
              ) : downloadProgress.status === 'completed' ? (
                <strong style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  Descarga completada ({downloadProgress.downloaded} nuevos, {downloadProgress.skipped} ya
                  existentes
                  {downloadProgress.failed > 0 ? `, ${downloadProgress.failed} con error` : ''})
                </strong>
              ) : (
                <strong style={{ color: 'var(--warn)' }}>
                  Descarga {downloadProgress.status === 'cancelled' ? 'cancelada' : 'finalizada con alertas'}
                </strong>
              )}
              {downloadProgress.currentEmitter && (
                <span className="badge">{downloadProgress.currentEmitter}</span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {downloadProgress.status === 'running' && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => void window.faktum.cancelDownload()}
                >
                  <XCircle size={13} aria-hidden="true" />
                  Cancelar
                </button>
              )}
              {downloadProgress.excelPath && (
                <button
                  type="button"
                  className="btn btn-sm btn-success"
                  onClick={() => void window.faktum.openPathInExplorer(downloadProgress.excelPath!)}
                >
                  <FileSpreadsheet size={13} aria-hidden="true" />
                  Abrir Excel
                </button>
              )}
              {downloadProgress.outputFolder && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void window.faktum.openPathInExplorer(downloadProgress.outputFolder!)}
                >
                  <FolderOpen size={13} aria-hidden="true" />
                  Abrir carpeta
                </button>
              )}
            </div>
          </div>

          <div className="progress-bar-track" aria-hidden="true">
            <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
          </div>

          {downloadProgress.errors.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--danger)' }}>
              Detalle del error ({downloadProgress.errors.length}): {downloadProgress.errors[0].reason}
            </div>
          )}
        </div>
      )}

      {/* Embedded SRI Portal Container */}
      <div className="portal-stage" ref={stageRef}>
        {!portalOpen && (
          <div className="action-launchpad">
            <div className="launchpad-section">
              <div className="launchpad-actions-grid">
                <button
                  type="button"
                  className="action-tile action-tile-primary"
                  disabled={
                    (!selectedProfileId && profiles.length > 0) ||
                    (isPeriodRange && !anyRangeFormat)
                  }
                  onClick={() =>
                    isPeriodRange ? void handleStartRange() : void handleDownloadMonth()
                  }
                >
                  <Download size={22} aria-hidden="true" />
                  <div>
                    <strong>
                      {profiles.length === 0 ? 'Agregar primer RUC' : 'Descargar Facturas'}
                    </strong>
                    <span>
                      {profiles.length === 0
                        ? 'Registra un RUC para comenzar'
                        : !selectedProfileId
                          ? 'Elige un RUC arriba o abajo'
                          : isPeriodRange
                            ? mode === 'year'
                              ? `Año ${year} · 12 meses · ${SRI_DOC_TYPES[docType]?.label ?? 'Todos'}`
                              : `${rangeMonthsCount} ${rangeMonthsCount === 1 ? 'mes' : 'meses'} · ${effectiveRange.fromDate} → ${effectiveRange.toDate}`
                            : `${MONTHS.find((m) => m.value === month)?.label ?? month} ${year} · ${SRI_DOC_TYPES[docType]?.label ?? 'Todos'}`}
                    </span>
                  </div>
                </button>

                {capturedCount > 0 && mode === 'month' && (
                  <button
                    type="button"
                    className="action-tile action-tile-accent"
                    onClick={onOpenCapturedSelector}
                  >
                    <ListChecks size={22} aria-hidden="true" />
                    <div>
                      <strong>Elegir archivos ({capturedCount})</strong>
                      <span>XML, PDF (RIDE) y Excel</span>
                    </div>
                  </button>
                )}

                <button
                  type="button"
                  className="action-tile"
                  onClick={onOpenHistory}
                >
                  <FileSpreadsheet size={20} aria-hidden="true" />
                  <div>
                    <strong>
                      {selectedProfileId ? `Comprobantes (${comprobantesCount})` : 'Comprobantes'}
                    </strong>
                    <span>
                      {selectedProfileId
                        ? 'Ver, abrir PDF/XML o exportar Excel'
                        : 'Selecciona un RUC para ver sus datos'}
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  className="action-tile"
                  onClick={() => outputDir && void window.faktum.openPathInExplorer(outputDir)}
                >
                  <FolderOpen size={20} aria-hidden="true" />
                  <div>
                    <strong>Abrir carpeta</strong>
                    <span>Ir directo a tus descargas</span>
                  </div>
                </button>
              </div>
            </div>

            <div className="launchpad-section">
              <div className="launchpad-section-head">
                <h2>Acceso rápido por RUC</h2>
                <button type="button" className="btn btn-sm" onClick={onOpenNewProfile}>
                  <Plus size={14} aria-hidden="true" />
                  Nuevo RUC
                </button>
              </div>

              {profiles.length === 0 ? (
                <button
                  type="button"
                  className="action-tile"
                  style={{ maxWidth: 320 }}
                  onClick={onOpenNewProfile}
                >
                  <Plus size={20} aria-hidden="true" />
                  <div>
                    <strong>Agregar perfil RUC</strong>
                    <span>Guarda tus credenciales cifradas</span>
                  </div>
                </button>
              ) : (
                <div className="ruc-quick-grid">
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`ruc-quick-card ${p.id === selectedProfileId ? 'is-selected' : ''}`}
                      onClick={() => void handleOpenPortal(p.id)}
                    >
                      <div className="ruc-quick-top">
                        <strong>{p.alias}</strong>
                        <span className="badge badge-success">Conectar →</span>
                      </div>
                      <span className="mono" style={{ color: 'var(--muted)' }}>
                        {p.ruc}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
