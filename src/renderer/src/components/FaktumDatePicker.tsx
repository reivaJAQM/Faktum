import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

const MONTH_NAMES_ES = [
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

const MONTH_SHORT_ES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

const WEEKDAYS_ES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

type PickerView = 'days' | 'months' | 'years';

export interface FaktumDatePickerProps {
  id?: string;
  ariaLabel?: string;
  value: string; // YYYY-MM-DD
  rangeStart?: string; // YYYY-MM-DD
  rangeEnd?: string; // YYYY-MM-DD
  activeEndpoint?: 'start' | 'end';
  disabled?: boolean;
  onChange: (isoDate: string) => void;
  onSelectRange?: (fromIso: string, toIso: string) => void;
  onOpenChange?: (open: boolean) => void;
}

function parseIsoDate(iso: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatDisplayDate(iso: string): string {
  const p = parseIsoDate(iso);
  if (!p) return 'Seleccionar fecha';
  return `${String(p.day).padStart(2, '0')} ${MONTH_SHORT_ES[p.month - 1]} ${p.year}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function buildCalendarGrid(year: number, month: number) {
  // Monday-first grid (Ecuador / ISO-8601 standard)
  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7; // 0 = Mon .. 6 = Sun
  const daysInCur = getDaysInMonth(year, month);

  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const daysInPrev = getDaysInMonth(prevYear, prevMonth);

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  const cells: Array<{
    iso: string;
    day: number;
    inCurrentMonth: boolean;
  }> = [];

  for (let i = firstDow - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    cells.push({
      iso: toIsoDate(prevYear, prevMonth, d),
      day: d,
      inCurrentMonth: false,
    });
  }

  for (let d = 1; d <= daysInCur; d++) {
    cells.push({
      iso: toIsoDate(year, month, d),
      day: d,
      inCurrentMonth: true,
    });
  }

  // Always fill full weeks (35 or 42 cells) cleanly
  const totalCells = cells.length <= 35 ? 35 : 42;
  let nextDay = 1;
  while (cells.length < totalCells) {
    cells.push({
      iso: toIsoDate(nextYear, nextMonth, nextDay),
      day: nextDay,
      inCurrentMonth: false,
    });
    nextDay++;
  }

  return cells;
}

function shiftIsoDays(iso: string, deltaDays: number): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  const d = new Date(p.year, p.month - 1, p.day + deltaDays);
  return toIsoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export const FaktumDatePicker: React.FC<FaktumDatePickerProps> = ({
  id,
  ariaLabel,
  value,
  rangeStart,
  rangeEnd,
  activeEndpoint,
  disabled = false,
  onChange,
  onSelectRange,
  onOpenChange,
}) => {
  const autoId = useId();
  const controlId = id ?? `faktum-dp-${autoId}`;
  const popoverId = `${controlId}-popover`;
  const anchorName = `--faktum-dp-${autoId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const today = useMemo(() => {
    const n = new Date();
    return {
      year: n.getFullYear(),
      month: n.getMonth() + 1,
      day: n.getDate(),
      iso: toIsoDate(n.getFullYear(), n.getMonth() + 1, n.getDate()),
    };
  }, []);

  const parsedValue = useMemo(() => parseIsoDate(value), [value]);

  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<PickerView>('days');
  const [viewYear, setViewYear] = useState(parsedValue?.year ?? today.year);
  const [viewMonth, setViewMonth] = useState(parsedValue?.month ?? today.month);
  const [focusedIso, setFocusedIso] = useState(value || today.iso);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  const notifyOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (wasOpenRef.current === nextOpen) return;
      wasOpenRef.current = nextOpen;
      setIsOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange]
  );

  // Cleanup open count if unmounted while open
  useEffect(() => {
    return () => {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        onOpenChange?.(false);
      }
    };
  }, [onOpenChange]);

  const closePopover = useCallback(
    (restoreFocus = false) => {
      const pop = popoverRef.current as (HTMLDivElement & { hidePopover?: () => void }) | null;
      if (pop && typeof pop.hidePopover === 'function') {
        try {
          pop.hidePopover();
        } catch {
          // already closed
        }
      }
      notifyOpenChange(false);
      if (restoreFocus) {
        triggerRef.current?.focus();
      }
    },
    [notifyOpenChange]
  );

  // Apply explicit per-instance CSS anchor properties cleanly across React 18 / Chromium
  useEffect(() => {
    triggerRef.current?.style.setProperty('anchor-name', anchorName);
    popoverRef.current?.style.setProperty('position-anchor', anchorName);
  }, [anchorName]);

  // Wire native Popover API beforetoggle / toggle events + non-anchor-positioning fallback
  useEffect(() => {
    const pop = popoverRef.current;
    if (!pop) return;

    const handleBeforeToggle = (ev: Event) => {
      const toggleEv = ev as Event & { newState?: string };
      if (toggleEv.newState === 'open') {
        const cur = parseIsoDate(value);
        setView('days');
        setViewYear(cur?.year ?? today.year);
        setViewMonth(cur?.month ?? today.month);
        setFocusedIso(value || today.iso);

        // Fallback positioning when CSS Anchor Positioning (`position-area`) is unavailable
        const supportsAnchorPos =
          typeof CSS !== 'undefined' &&
          typeof CSS.supports === 'function' &&
          CSS.supports('position-area: block-end') &&
          CSS.supports('anchor-name: --a');

        if (!supportsAnchorPos) {
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) {
            const popWidth = 312;
            const left = Math.max(12, Math.min(rect.left, window.innerWidth - popWidth - 12));
            const top = Math.min(rect.bottom + 6, window.innerHeight - 380);
            pop.style.left = `${left}px`;
            pop.style.top = `${Math.max(12, top)}px`;
          }
        }
        notifyOpenChange(true);
      }
    };

    const handleToggle = (ev: Event) => {
      const toggleEv = ev as Event & { newState?: string };
      if (toggleEv.newState === 'open') {
        notifyOpenChange(true);
      } else {
        notifyOpenChange(false);
      }
    };

    pop.addEventListener('beforetoggle', handleBeforeToggle);
    pop.addEventListener('toggle', handleToggle);
    return () => {
      pop.removeEventListener('beforetoggle', handleBeforeToggle);
      pop.removeEventListener('toggle', handleToggle);
    };
  }, [value, today.year, today.month, today.iso, notifyOpenChange]);

  const cells = useMemo(() => buildCalendarGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const yearBlockStart = Math.floor(viewYear / 12) * 12;
  const yearList = useMemo(
    () => Array.from({ length: 12 }, (_, i) => yearBlockStart + i),
    [yearBlockStart]
  );

  const normalizedRange = useMemo(() => {
    if (!rangeStart || !rangeEnd) return null;
    return rangeStart <= rangeEnd
      ? { start: rangeStart, end: rangeEnd }
      : { start: rangeEnd, end: rangeStart };
  }, [rangeStart, rangeEnd]);

  const handleStepPrev = () => {
    if (view === 'days') {
      if (viewMonth === 1) {
        setViewMonth(12);
        setViewYear((y) => y - 1);
      } else {
        setViewMonth((m) => m - 1);
      }
    } else if (view === 'months') {
      setViewYear((y) => y - 1);
    } else {
      setViewYear((y) => y - 12);
    }
  };

  const handleStepNext = () => {
    if (view === 'days') {
      if (viewMonth === 12) {
        setViewMonth(1);
        setViewYear((y) => y + 1);
      } else {
        setViewMonth((m) => m + 1);
      }
    } else if (view === 'months') {
      setViewYear((y) => y + 1);
    } else {
      setViewYear((y) => y + 12);
    }
  };

  const handlePickDay = (iso: string, restoreFocus = false) => {
    onChange(iso);
    closePopover(restoreFocus);
  };

  const handleApplyPreset = (preset: 'this_month' | 'prev_month' | 'last_3m' | 'this_year' | 'prev_year') => {
    const y = today.year;
    const m = today.month;
    let from = today.iso;
    let to = today.iso;

    if (preset === 'this_month') {
      from = toIsoDate(y, m, 1);
      to = today.iso;
    } else if (preset === 'prev_month') {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      from = toIsoDate(py, pm, 1);
      to = toIsoDate(py, pm, getDaysInMonth(py, pm));
    } else if (preset === 'last_3m') {
      const startDate = new Date(y, m - 3, 1);
      from = toIsoDate(startDate.getFullYear(), startDate.getMonth() + 1, 1);
      to = today.iso;
    } else if (preset === 'this_year') {
      from = toIsoDate(y, 1, 1);
      to = today.iso;
    } else if (preset === 'prev_year') {
      from = toIsoDate(y - 1, 1, 1);
      to = toIsoDate(y - 1, 12, 31);
    }

    if (onSelectRange) {
      onSelectRange(from, to);
    } else {
      onChange(activeEndpoint === 'end' ? to : from);
    }
    closePopover(true);
  };

  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (view !== 'days') return;
    let delta = 0;
    if (e.key === 'ArrowRight') delta = 1;
    else if (e.key === 'ArrowLeft') delta = -1;
    else if (e.key === 'ArrowDown') delta = 7;
    else if (e.key === 'ArrowUp') delta = -7;
    else if (e.key === 'PageUp') {
      e.preventDefault();
      handleStepPrev();
      return;
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      handleStepNext();
      return;
    } else if (e.key === 'Enter' || e.key === ' ') {
      if ((e.target as HTMLElement).classList.contains('faktum-cal-day')) {
        e.preventDefault();
        handlePickDay(focusedIso, true);
      }
      return;
    }

    if (delta !== 0) {
      e.preventDefault();
      const nextIso = shiftIsoDays(focusedIso, delta);
      setFocusedIso(nextIso);
      const parsed = parseIsoDate(nextIso);
      if (parsed && (parsed.year !== viewYear || parsed.month !== viewMonth)) {
        setViewYear(parsed.year);
        setViewMonth(parsed.month);
      }
      window.requestAnimationFrame(() => {
        const btn = popoverRef.current?.querySelector<HTMLButtonElement>(
          `button[data-iso="${nextIso}"]`
        );
        btn?.focus();
      });
    }
  };

  const headerTitle =
    view === 'days'
      ? `${MONTH_NAMES_ES[viewMonth - 1]} ${viewYear}`
      : view === 'months'
        ? String(viewYear)
        : `${yearBlockStart} – ${yearBlockStart + 11}`;

  return (
    <div className={`faktum-datepicker ${isOpen ? 'is-open' : ''}`}>
      <button
        ref={triggerRef}
        id={controlId}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-controls={popoverId}
        className="faktum-datepicker-trigger"
        style={{ anchorName } as React.CSSProperties}
        {...({ popovertarget: popoverId } as Record<string, string>)}
      >
        <span className="faktum-datepicker-value">{formatDisplayDate(value)}</span>
        <Calendar size={15} className="faktum-datepicker-icon" aria-hidden="true" />
      </button>

      <div
        ref={popoverRef}
        id={popoverId}
        role="dialog"
        aria-label={ariaLabel ? `Calendario: ${ariaLabel}` : 'Selector de fecha Faktum'}
        className="faktum-datepicker-popover"
        style={{ positionAnchor: anchorName } as React.CSSProperties}
        {...({ popover: 'auto' } as Record<string, string>)}
      >
        {/* Characteristic Faktum dual-tone brand stripe */}
        <div className="faktum-cal-brand-bar" aria-hidden="true" />

        {/* Header: prev / month-year switcher / next */}
        <div className="faktum-cal-header">
          <button
            type="button"
            className="faktum-cal-nav-btn"
            aria-label={
              view === 'days' ? 'Mes anterior' : view === 'months' ? 'Año anterior' : 'Década anterior'
            }
            onClick={handleStepPrev}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="faktum-cal-title-btn"
            aria-label="Cambiar mes o año"
            onClick={() =>
              setView((v) => (v === 'days' ? 'months' : v === 'months' ? 'years' : 'days'))
            }
          >
            <span>{headerTitle}</span>
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`faktum-cal-title-caret ${view !== 'days' ? 'is-rotated' : ''}`}
            />
          </button>

          <button
            type="button"
            className="faktum-cal-nav-btn"
            aria-label={
              view === 'days' ? 'Mes siguiente' : view === 'months' ? 'Año siguiente' : 'Década siguiente'
            }
            onClick={handleStepNext}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Body: Days grid OR Months grid OR Years grid */}
        {view === 'days' && (
          <div className="faktum-cal-body" onKeyDown={handleGridKeyDown}>
            <div className="faktum-cal-weekdays" aria-hidden="true">
              {WEEKDAYS_ES.map((wd) => (
                <span key={wd} className="faktum-cal-weekday">
                  {wd}
                </span>
              ))}
            </div>

            <div className="faktum-cal-grid" role="grid" aria-label={headerTitle}>
              {cells.map((cell) => {
                const isSelected = cell.iso === value;
                const isToday = cell.iso === today.iso;
                const isRangeStart = normalizedRange?.start === cell.iso;
                const isRangeEnd = normalizedRange?.end === cell.iso;
                const isInRange = Boolean(
                  normalizedRange &&
                    cell.iso > normalizedRange.start &&
                    cell.iso < normalizedRange.end
                );
                const isOtherEndpoint = !isSelected && (isRangeStart || isRangeEnd);

                const cls = [
                  'faktum-cal-day',
                  !cell.inCurrentMonth && 'is-outside',
                  isToday && 'is-today',
                  isInRange && 'is-in-range',
                  isRangeStart && 'is-range-start',
                  isRangeEnd && 'is-range-end',
                  isOtherEndpoint && 'is-other-endpoint',
                  isSelected && 'is-selected',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <button
                    key={cell.iso}
                    type="button"
                    data-iso={cell.iso}
                    aria-pressed={isSelected}
                    aria-label={formatDisplayDate(cell.iso)}
                    className={cls}
                    onClick={() => handlePickDay(cell.iso, true)}
                  >
                    <span>{cell.day}</span>
                    {isToday && <span className="faktum-cal-today-dot" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {view === 'months' && (
          <div className="faktum-cal-body">
            <div className="faktum-cal-subgrid">
              {MONTH_NAMES_ES.map((name, idx) => {
                const mNum = idx + 1;
                const isCurrentSelected =
                  parsedValue?.year === viewYear && parsedValue?.month === mNum;
                const isThisMonth = today.year === viewYear && today.month === mNum;
                return (
                  <button
                    key={name}
                    type="button"
                    className={`faktum-cal-subcell ${isCurrentSelected ? 'is-selected' : ''} ${
                      isThisMonth ? 'is-today' : ''
                    }`}
                    onClick={() => {
                      setViewMonth(mNum);
                      setView('days');
                    }}
                  >
                    {name.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {view === 'years' && (
          <div className="faktum-cal-body">
            <div className="faktum-cal-subgrid">
              {yearList.map((yr) => {
                const isCurrentSelected = parsedValue?.year === yr;
                const isThisYear = today.year === yr;
                return (
                  <button
                    key={yr}
                    type="button"
                    className={`faktum-cal-subcell ${isCurrentSelected ? 'is-selected' : ''} ${
                      isThisYear ? 'is-today' : ''
                    }`}
                    onClick={() => {
                      setViewYear(yr);
                      setView('months');
                    }}
                  >
                    {yr}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Quick SRI accounting presets */}
        {onSelectRange && (
          <div className="faktum-cal-presets" role="group" aria-label="Atajos de período">
            <button
              type="button"
              className="faktum-cal-preset-chip"
              onClick={() => handleApplyPreset('this_month')}
            >
              Este mes
            </button>
            <button
              type="button"
              className="faktum-cal-preset-chip"
              onClick={() => handleApplyPreset('prev_month')}
            >
              Mes anterior
            </button>
            <button
              type="button"
              className="faktum-cal-preset-chip"
              onClick={() => handleApplyPreset('last_3m')}
            >
              3 meses
            </button>
            <button
              type="button"
              className="faktum-cal-preset-chip"
              onClick={() => handleApplyPreset('this_year')}
            >
              Este año
            </button>
            <button
              type="button"
              className="faktum-cal-preset-chip"
              onClick={() => handleApplyPreset('prev_year')}
            >
              {today.year - 1}
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="faktum-cal-footer">
          <span className="faktum-cal-footer-hint">
            {activeEndpoint === 'start'
              ? 'Inicio del rango'
              : activeEndpoint === 'end'
                ? 'Fin del rango'
                : 'Faktum SRI'}
          </span>
          <button
            type="button"
            className="faktum-cal-today-btn"
            onClick={() => handlePickDay(today.iso, true)}
          >
            Hoy
          </button>
        </div>
      </div>
    </div>
  );
};
