import type { CapturedKeyEntry } from '../../shared/types';
import { decodeClaveAcceso } from './claveAcceso';

export interface YearMonth {
  year: number;
  month: number; // 1..12
}

/**
 * Expands an inclusive ISO date range (YYYY-MM-DD .. YYYY-MM-DD) into an ordered list
 * of { year, month } periods to query in the SRI portal.
 */
export function expandMonthsInRange(fromIso: string, toIso: string): YearMonth[] {
  const m1 = fromIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const m2 = toIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m1 || !m2) return [];

  let startY = Number(m1[1]);
  let startM = Number(m1[2]);
  let endY = Number(m2[1]);
  let endM = Number(m2[2]);

  if (startY > endY || (startY === endY && startM > endM)) {
    [startY, endY] = [endY, startY];
    [startM, endM] = [endM, startM];
  }

  const months: YearMonth[] = [];
  let y = startY;
  let m = startM;
  let guard = 0;

  while ((y < endY || (y === endY && m <= endM)) && guard < 120) {
    months.push({ year: y, month: m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    guard++;
  }

  return months;
}

export function extractEntryIsoDate(entry: CapturedKeyEntry): string | null {
  if (entry.fechaEmision) {
    const dm = entry.fechaEmision.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dm) return `${dm[3]}-${dm[2]}-${dm[1]}`;
    const iso = entry.fechaEmision.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return entry.fechaEmision.trim();
  }
  const decoded = decodeClaveAcceso(entry.claveAcceso);
  return decoded?.fechaEmisionIso ?? null;
}

export function isEntryWithinDateRange(
  entry: CapturedKeyEntry,
  fromIso: string,
  toIso: string
): boolean {
  const dateIso = extractEntryIsoDate(entry);
  if (!dateIso) return true;
  const [minDate, maxDate] = fromIso <= toIso ? [fromIso, toIso] : [toIso, fromIso];
  return dateIso >= minDate && dateIso <= maxDate;
}
