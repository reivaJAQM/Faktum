import { XMLParser } from 'fast-xml-parser';
import {
  SRI_DOC_TYPES,
  type ParsedComprobante,
  type ParsedDetailItem,
  type ParsedRetencionItem,
  type SriDocCode,
} from '../../shared/types';
import { decodeClaveAcceso } from './claveAcceso';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
});

const FORMA_PAGO_MAP: Record<string, string> = {
  '01': 'Sin utilización del sistema financiero',
  '15': 'Compensación de deudas',
  '16': 'Tarjeta de débito',
  '17': 'Dinero electrónico',
  '18': 'Tarjeta prepago',
  '19': 'Tarjeta de crédito',
  '20': 'Otros con utilización del sistema financiero',
  '21': 'Endoso de títulos',
};

const IMPUESTO_RETENCION_MAP: Record<string, string> = {
  '1': 'Renta',
  '2': 'IVA',
  '6': 'ISD',
};

function toArray<T>(val: T | T[] | undefined | null): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function toNum(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (typeof val === 'string') {
    const cleaned = val.replace(',', '.').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toStr(val: unknown): string {
  if (val === undefined || val === null) return '';
  return String(val).trim();
}

function ddmmyyyyToIso(fecha: string): string {
  const m = fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return fecha;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function extractImpuestosTotals(totalConImpuestosNode: Record<string, unknown> | undefined) {
  const items = toArray(
    (totalConImpuestosNode as { totalImpuesto?: Record<string, unknown> | Record<string, unknown>[] } | undefined)
      ?.totalImpuesto
  );
  let subtotal0 = 0;
  let subtotalIva = 0;
  let subtotalNoObjeto = 0;
  let subtotalExento = 0;
  let iva = 0;
  let ice = 0;

  for (const imp of items) {
    const codigo = toStr(imp?.codigo);
    const codPorc = toStr(imp?.codigoPorcentaje);
    const base = toNum(imp?.baseImponible);
    const valor = toNum(imp?.valor);

    if (codigo === '2') {
      // IVA
      if (codPorc === '0') {
        subtotal0 += base;
      } else if (codPorc === '6') {
        subtotalNoObjeto += base;
      } else if (codPorc === '7') {
        subtotalExento += base;
      } else {
        // 2=12%, 3=14%, 4=15%, 5=5%, 8=8%, 10=13%
        subtotalIva += base;
        iva += valor;
      }
    } else if (codigo === '3') {
      ice += valor;
    }
  }

  return { subtotal0, subtotalIva, subtotalNoObjeto, subtotalExento, iva, ice };
}

function extractPagos(pagosNode: Record<string, unknown> | undefined): string {
  const list = toArray(
    (pagosNode as { pago?: Record<string, unknown> | Record<string, unknown>[] } | undefined)?.pago
  );
  if (list.length === 0) return '';
  return list
    .map((p) => {
      const code = toStr(p?.formaPago);
      return FORMA_PAGO_MAP[code] ?? code;
    })
    .filter(Boolean)
    .join(', ');
}

function extractDetalles(
  detallesNode: Record<string, unknown> | undefined,
  header: {
    claveAcceso: string;
    numeroComprobante: string;
    fechaEmision: string;
    rucEmisor: string;
    razonSocialEmisor: string;
    tipoComprobante: string;
  }
): ParsedDetailItem[] {
  const list = toArray(
    (detallesNode as { detalle?: Record<string, unknown> | Record<string, unknown>[] } | undefined)?.detalle
  );
  return list.map((d) => {
    const impuestos = toArray(
      (d?.impuestos as { impuesto?: Record<string, unknown> | Record<string, unknown>[] } | undefined)?.impuesto
    );
    const ivaImp = impuestos.find((i) => toStr(i?.codigo) === '2');
    return {
      ...header,
      codigoPrincipal: toStr(d?.codigoPrincipal ?? d?.codigoInterno),
      codigoAuxiliar: toStr(d?.codigoAuxiliar ?? d?.codigoAdicional),
      descripcion: toStr(d?.descripcion),
      cantidad: toNum(d?.cantidad),
      precioUnitario: toNum(d?.precioUnitario),
      descuento: toNum(d?.descuento),
      precioTotalSinImpuesto: toNum(d?.precioTotalSinImpuesto),
      ivaValor: ivaImp ? toNum(ivaImp.valor) : 0,
      ivaTarifa: ivaImp ? `${toStr(ivaImp.tarifa)}%` : '0%',
    };
  });
}

export function unwrapSriAuthorizedXml(rawXml: string): {
  innerXml: string;
  estado?: string;
  fechaAutorizacion?: string;
  ambiente?: string;
} {
  const trimmed = rawXml.trim();
  if (!/<autorizacion[\s>]/i.test(trimmed)) {
    return { innerXml: trimmed };
  }
  const parsed = xmlParser.parse(trimmed) as {
    autorizacion?: {
      estado?: unknown;
      fechaAutorizacion?: unknown;
      ambiente?: unknown;
      comprobante?: unknown;
    };
  };
  const aut = parsed?.autorizacion;
  if (!aut || typeof aut.comprobante !== 'string') {
    return { innerXml: trimmed };
  }
  let inner = aut.comprobante.trim();
  if (inner.startsWith('&lt;')) {
    inner = inner
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }
  return {
    innerXml: inner,
    estado: toStr(aut.estado) || undefined,
    fechaAutorizacion: toStr(aut.fechaAutorizacion) || undefined,
    ambiente: toStr(aut.ambiente) || undefined,
  };
}

export function parseSriComprobanteXml(params: {
  innerXml: string;
  profileId: string;
  ownerRuc: string;
  xmlPath: string;
  estado?: string;
  fechaAutorizacion?: string;
  ambiente?: string;
}): ParsedComprobante {
  const unwrapped = unwrapSriAuthorizedXml(params.innerXml);
  const parsed = xmlParser.parse(unwrapped.innerXml) as Record<string, Record<string, unknown>>;

  const rootKey = Object.keys(parsed).find((k) => !k.startsWith('?')) ?? 'factura';
  const doc = parsed[rootKey] ?? {};
  const infoTributaria = (doc.infoTributaria ?? {}) as Record<string, unknown>;

  const claveAcceso = toStr(infoTributaria.claveAcceso);
  const decoded = decodeClaveAcceso(claveAcceso);

  const codDoc = (toStr(infoTributaria.codDoc) || decoded?.tipoCodigo || '00') as SriDocCode;
  const docMeta = SRI_DOC_TYPES[codDoc];
  const tipoNombre = docMeta?.label ?? decoded?.tipoNombre ?? rootKey;

  const estab = toStr(infoTributaria.estab);
  const ptoEmi = toStr(infoTributaria.ptoEmi);
  const secuencial = toStr(infoTributaria.secuencial);
  const numeroComprobante =
    estab && ptoEmi && secuencial
      ? `${estab}-${ptoEmi}-${secuencial}`
      : decoded?.numeroComprobante ?? '';

  const rucEmisor = toStr(infoTributaria.ruc) || decoded?.rucEmisor || '';
  const razonSocialEmisor = toStr(infoTributaria.razonSocial);
  const nombreComercialEmisor = toStr(infoTributaria.nombreComercial);

  let fechaEmision = decoded?.fechaEmision ?? '';
  let identificacionReceptor = '';
  let razonSocialReceptor = '';
  let subtotal0 = 0;
  let subtotalIva = 0;
  let subtotalNoObjeto = 0;
  let subtotalExento = 0;
  let totalSinImpuestos = 0;
  let totalDescuento = 0;
  let iva = 0;
  let ice = 0;
  let propina = 0;
  let importeTotal = 0;
  let formaPago = '';
  let docModificado = '';
  let motivo = '';
  let detalles: ParsedDetailItem[] = [];
  const retenciones: ParsedRetencionItem[] = [];

  if (rootKey === 'factura' && doc.infoFactura) {
    const info = doc.infoFactura as Record<string, unknown>;
    fechaEmision = toStr(info.fechaEmision) || fechaEmision;
    identificacionReceptor = toStr(info.identificacionComprador);
    razonSocialReceptor = toStr(info.razonSocialComprador);
    totalSinImpuestos = toNum(info.totalSinImpuestos);
    totalDescuento = toNum(info.totalDescuento);
    propina = toNum(info.propina);
    importeTotal = toNum(info.importeTotal);
    formaPago = extractPagos(info.pagos as Record<string, unknown> | undefined);
    const taxes = extractImpuestosTotals(info.totalConImpuestos as Record<string, unknown> | undefined);
    ({ subtotal0, subtotalIva, subtotalNoObjeto, subtotalExento, iva, ice } = taxes);
    detalles = extractDetalles(doc.detalles as Record<string, unknown> | undefined, {
      claveAcceso,
      numeroComprobante,
      fechaEmision,
      rucEmisor,
      razonSocialEmisor,
      tipoComprobante: tipoNombre,
    });
  } else if (rootKey === 'liquidacionCompra' && doc.infoLiquidacionCompra) {
    const info = doc.infoLiquidacionCompra as Record<string, unknown>;
    fechaEmision = toStr(info.fechaEmision) || fechaEmision;
    identificacionReceptor = toStr(info.identificacionProveedor);
    razonSocialReceptor = toStr(info.razonSocialProveedor);
    totalSinImpuestos = toNum(info.totalSinImpuestos);
    totalDescuento = toNum(info.totalDescuento);
    importeTotal = toNum(info.importeTotal);
    formaPago = extractPagos(info.pagos as Record<string, unknown> | undefined);
    const taxes = extractImpuestosTotals(info.totalConImpuestos as Record<string, unknown> | undefined);
    ({ subtotal0, subtotalIva, subtotalNoObjeto, subtotalExento, iva, ice } = taxes);
    detalles = extractDetalles(doc.detalles as Record<string, unknown> | undefined, {
      claveAcceso,
      numeroComprobante,
      fechaEmision,
      rucEmisor,
      razonSocialEmisor,
      tipoComprobante: tipoNombre,
    });
  } else if (rootKey === 'notaCredito' && doc.infoNotaCredito) {
    const info = doc.infoNotaCredito as Record<string, unknown>;
    fechaEmision = toStr(info.fechaEmision) || fechaEmision;
    identificacionReceptor = toStr(info.identificacionComprador);
    razonSocialReceptor = toStr(info.razonSocialComprador);
    totalSinImpuestos = toNum(info.totalSinImpuestos);
    importeTotal = toNum(info.valorModificacion);
    docModificado = toStr(info.numDocModificado);
    motivo = toStr(info.motivo);
    const taxes = extractImpuestosTotals(info.totalConImpuestos as Record<string, unknown> | undefined);
    ({ subtotal0, subtotalIva, subtotalNoObjeto, subtotalExento, iva, ice } = taxes);
    detalles = extractDetalles(doc.detalles as Record<string, unknown> | undefined, {
      claveAcceso,
      numeroComprobante,
      fechaEmision,
      rucEmisor,
      razonSocialEmisor,
      tipoComprobante: tipoNombre,
    });
  } else if (rootKey === 'notaDebito' && doc.infoNotaDebito) {
    const info = doc.infoNotaDebito as Record<string, unknown>;
    fechaEmision = toStr(info.fechaEmision) || fechaEmision;
    identificacionReceptor = toStr(info.identificacionComprador);
    razonSocialReceptor = toStr(info.razonSocialComprador);
    totalSinImpuestos = toNum(info.totalSinImpuestos);
    importeTotal = toNum(info.valorTotal);
    docModificado = toStr(info.numDocModificado);
    const motivos = toArray(
      (doc.motivos as { motivo?: Record<string, unknown> | Record<string, unknown>[] } | undefined)?.motivo
    );
    motivo = motivos.map((m) => toStr(m?.razon)).filter(Boolean).join('; ');
    const impuestos = toArray(
      (info.impuestos as { impuesto?: Record<string, unknown> | Record<string, unknown>[] } | undefined)?.impuesto
    );
    for (const imp of impuestos) {
      if (toStr(imp?.codigo) === '2') {
        if (toStr(imp?.codigoPorcentaje) === '0') subtotal0 += toNum(imp?.baseImponible);
        else {
          subtotalIva += toNum(imp?.baseImponible);
          iva += toNum(imp?.valor);
        }
      }
    }
  } else if (rootKey === 'comprobanteRetencion' && doc.infoCompRetencion) {
    const info = doc.infoCompRetencion as Record<string, unknown>;
    fechaEmision = toStr(info.fechaEmision) || fechaEmision;
    identificacionReceptor = toStr(info.identificacionSujetoRetenido);
    razonSocialReceptor = toStr(info.razonSocialSujetoRetenido);

    // Format v1.0.0: <impuestos><impuesto>
    const v1List = toArray(
      (doc.impuestos as { impuesto?: Record<string, unknown> | Record<string, unknown>[] } | undefined)?.impuesto
    );
    for (const r of v1List) {
      const val = toNum(r?.valorRetenido);
      importeTotal += val;
      retenciones.push({
        claveAcceso,
        numeroComprobante,
        fechaEmision,
        rucEmisor,
        razonSocialEmisor,
        impuesto: IMPUESTO_RETENCION_MAP[toStr(r?.codigo)] ?? toStr(r?.codigo),
        codigoRetencion: toStr(r?.codigoRetencion),
        baseImponible: toNum(r?.baseImponible),
        porcentajeRetener: toNum(r?.porcentajeRetener),
        valorRetenido: val,
        docSustentoTipo: toStr(r?.codDocSustento),
        docSustentoNumero: toStr(r?.numDocSustento),
        docSustentoFecha: toStr(r?.fechaEmisionDocSustento),
      });
    }

    // Format v2.0.0: <docsSustento><docSustento><retenciones><retencion>
    const docsSustento = toArray(
      (doc.docsSustento as { docSustento?: Record<string, unknown> | Record<string, unknown>[] } | undefined)
        ?.docSustento
    );
    for (const ds of docsSustento) {
      const rets = toArray(
        (ds?.retenciones as { retencion?: Record<string, unknown> | Record<string, unknown>[] } | undefined)?.retencion
      );
      for (const r of rets) {
        const val = toNum(r?.valorRetenido);
        importeTotal += val;
        retenciones.push({
          claveAcceso,
          numeroComprobante,
          fechaEmision,
          rucEmisor,
          razonSocialEmisor,
          impuesto: IMPUESTO_RETENCION_MAP[toStr(r?.codigo)] ?? toStr(r?.codigo),
          codigoRetencion: toStr(r?.codigoRetencion),
          baseImponible: toNum(r?.baseImponible),
          porcentajeRetener: toNum(r?.porcentajeRetener),
          valorRetenido: val,
          docSustentoTipo: toStr(ds?.codDocSustento),
          docSustentoNumero: toStr(ds?.numDocSustento),
          docSustentoFecha: toStr(ds?.fechaEmisionDocSustento),
        });
      }
    }
    totalSinImpuestos = importeTotal;
  } else if (rootKey === 'guiaRemision' && doc.infoGuiaRemision) {
    const info = doc.infoGuiaRemision as Record<string, unknown>;
    fechaEmision = toStr(info.fechaIniTransporte) || fechaEmision;
    identificacionReceptor = toStr(info.rucTransportista);
    razonSocialReceptor = toStr(info.razonSocialTransportista);
  }

  return {
    claveAcceso,
    profileId: params.profileId,
    ownerRuc: params.ownerRuc,
    tipoCodigo: codDoc,
    tipoNombre,
    numeroComprobante,
    fechaEmision,
    fechaEmisionIso: ddmmyyyyToIso(fechaEmision),
    fechaAutorizacion: params.fechaAutorizacion || unwrapped.fechaAutorizacion || '',
    estado: params.estado || unwrapped.estado || 'AUTORIZADO',
    ambiente: params.ambiente || unwrapped.ambiente || 'PRODUCCIÓN',
    rucEmisor,
    razonSocialEmisor,
    nombreComercialEmisor,
    identificacionReceptor,
    razonSocialReceptor,
    subtotal0,
    subtotalIva,
    subtotalNoObjeto,
    subtotalExento,
    totalSinImpuestos,
    totalDescuento,
    iva,
    ice,
    propina,
    importeTotal,
    formaPago,
    docModificado,
    motivo,
    xmlPath: params.xmlPath,
    downloadedAt: new Date().toISOString(),
    detalles,
    retenciones,
  };
}
