import { SRI_DOC_TYPES, type CapturedKeyEntry, type SriDocCode } from '../../shared/types';

export interface DecodedClaveAcceso {
  claveAcceso: string;
  fechaEmision: string; // dd/MM/yyyy
  fechaEmisionIso: string; // yyyy-MM-dd
  year: string;
  month: string;
  tipoCodigo: SriDocCode;
  tipoNombre: string;
  rucEmisor: string;
  ambiente: '1' | '2';
  serie: string; // 001-001
  secuencial: string; // 000000001
  numeroComprobante: string; // 001-001-000000001
  isValidCheckDigit: boolean;
}

export function validateModulo11(clave49: string): boolean {
  if (!/^\d{49}$/.test(clave49)) return false;
  let factor = 2;
  let sum = 0;
  for (let i = 47; i >= 0; i--) {
    sum += Number(clave49[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const mod = 11 - (sum % 11);
  const expected = mod === 11 ? 0 : mod === 10 ? 1 : mod;
  return Number(clave49[48]) === expected;
}

export function decodeClaveAcceso(raw: string): DecodedClaveAcceso | null {
  const clave = raw.replace(/\D/g, '');
  if (clave.length !== 49) return null;

  const dd = clave.slice(0, 2);
  const mm = clave.slice(2, 4);
  const yyyy = clave.slice(4, 8);
  const tipoRaw = clave.slice(8, 10) as SriDocCode;
  const rucEmisor = clave.slice(10, 23);
  const ambiente = (clave.slice(23, 24) === '1' ? '1' : '2') as '1' | '2';
  const estab = clave.slice(24, 27);
  const ptoEmi = clave.slice(27, 30);
  const secuencial = clave.slice(30, 39);

  const docMeta = SRI_DOC_TYPES[tipoRaw];
  const tipoCodigo: SriDocCode = docMeta ? docMeta.code : '00';
  const tipoNombre = docMeta ? docMeta.label : `Comprobante (${tipoRaw})`;

  return {
    claveAcceso: clave,
    fechaEmision: `${dd}/${mm}/${yyyy}`,
    fechaEmisionIso: `${yyyy}-${mm}-${dd}`,
    year: yyyy,
    month: mm,
    tipoCodigo,
    tipoNombre,
    rucEmisor,
    ambiente,
    serie: `${estab}-${ptoEmi}`,
    secuencial,
    numeroComprobante: `${estab}-${ptoEmi}-${secuencial}`,
    isValidCheckDigit: validateModulo11(clave),
  };
}

/**
 * Decodes an SRI TXT report buffer (which is frequently Latin-1/Windows-1252 or UTF-8)
 * and extracts every unique 49-digit access key along with optional metadata columns.
 */
export function decodeSriBuffer(buffer: Buffer): string {
  // Detect UTF-8 replacement character when decoded as utf-8; fallback to latin1 if needed
  const utf8 = buffer.toString('utf-8');
  if (!utf8.includes('\uFFFD')) {
    return utf8;
  }
  return buffer.toString('latin1');
}

function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function extractKeysFromReportText(text: string): CapturedKeyEntry[] {
  const byKey = new Map<string, CapturedKeyEntry>();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length === 0) return [];

  // Attempt structured TSV parsing first (official SRI report format)
  const firstCols = lines[0].split('\t').map(normalizeHeader);
  const claveIdx = firstCols.findIndex((c) => c.includes('CLAVE') && c.includes('ACCESO'));

  if (claveIdx >= 0) {
    const rucIdx = firstCols.findIndex((c) => c.includes('RUC') && c.includes('EMISOR'));
    const razonIdx = firstCols.findIndex((c) => c.includes('RAZON_SOCIAL'));
    const tipoIdx = firstCols.findIndex((c) => c.includes('TIPO_COMPROBANTE'));
    const serieIdx = firstCols.findIndex((c) => c.includes('SERIE_COMPROBANTE'));
    const fechaEmiIdx = firstCols.findIndex((c) => c.includes('FECHA_EMISION'));
    const fechaAutIdx = firstCols.findIndex((c) => c.includes('FECHA_AUTORIZACION'));
    const totalIdx = firstCols.findIndex((c) => c.includes('IMPORTE_TOTAL'));

    let rowIdx = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split('\t');
      const rawKey = (cols[claveIdx] ?? '').replace(/\D/g, '');
      if (rawKey.length === 49) {
        const parsedTotal = totalIdx >= 0 ? Number((cols[totalIdx] ?? '').replace(',', '.')) : undefined;
        byKey.set(rawKey, {
          claveAcceso: rawKey,
          rowIndex: rowIdx++,
          rucEmisor: rucIdx >= 0 ? cols[rucIdx]?.trim() : undefined,
          razonSocialEmisor: razonIdx >= 0 ? cols[razonIdx]?.trim() : undefined,
          tipoComprobante: tipoIdx >= 0 ? cols[tipoIdx]?.trim() : undefined,
          serieComprobante: serieIdx >= 0 ? cols[serieIdx]?.trim() : undefined,
          fechaEmision: fechaEmiIdx >= 0 ? cols[fechaEmiIdx]?.trim() : undefined,
          fechaAutorizacion: fechaAutIdx >= 0 ? cols[fechaAutIdx]?.trim() : undefined,
          importeTotal: Number.isFinite(parsedTotal) ? parsedTotal : undefined,
        });
      }
    }
  }

  // Fallback regex extraction for any 49-digit key anywhere in text (handles HTML, pasted keys, CSV, changed headers)
  const matches = text.match(/\b\d{49}\b/g) ?? [];
  for (const key of matches) {
    if (!byKey.has(key)) {
      const decoded = decodeClaveAcceso(key);
      if (decoded && decoded.isValidCheckDigit) {
        byKey.set(key, {
          claveAcceso: key,
          rucEmisor: decoded.rucEmisor,
          tipoComprobante: decoded.tipoNombre,
          serieComprobante: decoded.numeroComprobante,
          fechaEmision: decoded.fechaEmision,
        });
      }
    }
  }

  return Array.from(byKey.values());
}
