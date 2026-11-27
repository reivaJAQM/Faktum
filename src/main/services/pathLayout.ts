import path from 'node:path';
import { SRI_DOC_TYPES, type SriDocCode } from '../../shared/types';

export const MONTH_NAMES = [
  '01_Enero',
  '02_Febrero',
  '03_Marzo',
  '04_Abril',
  '05_Mayo',
  '06_Junio',
  '07_Julio',
  '08_Agosto',
  '09_Septiembre',
  '10_Octubre',
  '11_Noviembre',
  '12_Diciembre',
];

/**
 * Sanitizes a folder/file name so it is 100% valid on BOTH macOS and Windows
 * (removes reserved characters <>:"/\|?*, control chars, and trailing dots/spaces).
 */
export function sanitizeReadableSegment(value: string, fallback = 'SinNombre', maxLen = 70): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, maxLen)
    .replace(/[. ]+$/g, '');
  return cleaned || fallback;
}

export function sanitizeSlugSegment(value: string, fallback = 'SinNombre', maxLen = 40): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^[._-]+|[._-]+$/g, '')
      .slice(0, maxLen)
      .replace(/[._-]+$/g, '') || fallback
  );
}

export function getMonthFolderName(monthNumber: number): string {
  const idx = Math.max(0, Math.min(11, Math.round(monthNumber) - 1));
  return MONTH_NAMES[idx] ?? String(monthNumber).padStart(2, '0');
}

export function getOwnerFolderName(ownerAlias: string, ownerRuc: string): string {
  const cleanAlias = sanitizeReadableSegment(ownerAlias, 'Empresa', 60);
  const cleanRuc = (ownerRuc || '').replace(/\D/g, '');
  return cleanRuc ? `${cleanAlias} (${cleanRuc})` : cleanAlias;
}

export interface ComprobanteFilePaths {
  ownerRootDir: string;
  periodRootDir: string;
  excelDir: string;
  xmlDir: string;
  pdfDir: string;
  xmlPath: string;
  pdfPath: string;
}

/**
 * Organized directory layout (1 folder per active RUC/person, then grouped by file format & doc type):
 * <outputDir>/<Razón Social Activa (RUC)>/<YYYY>/<MM_Mes>/
 *   ├── Excel/
 *   ├── XML/<TipoComprobante>/<YYYY-MM-DD>_<Numero>_<Emisor>.xml
 *   └── PDF/<TipoComprobante>/<YYYY-MM-DD>_<Numero>_<Emisor>.pdf
 */
export function buildComprobantePaths(params: {
  outputDir: string;
  ownerRuc: string;
  ownerAlias: string;
  year: string;
  month: number;
  rucEmisor: string;
  razonSocialEmisor: string;
  tipoCodigo: SriDocCode | string;
  fechaEmisionIso: string;
  numeroComprobante: string;
  claveAcceso: string;
}): ComprobanteFilePaths {
  const ownerFolder = getOwnerFolderName(params.ownerAlias, params.ownerRuc);
  const monthFolder = getMonthFolderName(params.month);
  const ownerRootDir = path.join(params.outputDir, ownerFolder);
  const periodRootDir = path.join(ownerRootDir, params.year, monthFolder);

  const docMeta = SRI_DOC_TYPES[params.tipoCodigo];
  const typeFolder = docMeta?.folder ?? 'Otros';

  const excelDir = path.join(periodRootDir, 'Excel');
  const xmlDir = path.join(periodRootDir, 'XML', typeFolder);
  const pdfDir = path.join(periodRootDir, 'PDF', typeFolder);

  const safeDate = sanitizeSlugSegment(params.fechaEmisionIso || 'sin_fecha', 'sin_fecha', 20);
  const safeNum = sanitizeSlugSegment(
    params.numeroComprobante || params.claveAcceso.slice(-15),
    params.claveAcceso.slice(-15),
    25
  );
  const emitterTag = sanitizeSlugSegment(
    params.razonSocialEmisor || params.rucEmisor || 'SRI',
    params.rucEmisor || 'SRI',
    32
  );
  const baseName = `${safeDate}_${safeNum}_${emitterTag}`;

  return {
    ownerRootDir,
    periodRootDir,
    excelDir,
    xmlDir,
    pdfDir,
    xmlPath: path.join(xmlDir, `${baseName}.xml`),
    pdfPath: path.join(pdfDir, `${baseName}.pdf`),
  };
}
