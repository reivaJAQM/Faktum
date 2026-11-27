import ExcelJS from 'exceljs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decodeClaveAcceso,
  decodeSriBuffer,
  extractKeysFromReportText,
  validateModulo11,
} from '../src/main/services/claveAcceso';
import { expandMonthsInRange, isEntryWithinDateRange } from '../src/main/services/dateRange';
import { exportComprobantesToExcel } from '../src/main/services/excelExporter';
import { buildComprobantePaths } from '../src/main/services/pathLayout';
import { generateRidePdf } from '../src/main/services/rideGenerator';
import { parseSriSoapResponse } from '../src/main/services/sriSoap';
import { parseSriComprobanteXml } from '../src/main/services/xmlParser';

function makeValidClave49(base48: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = 47; i >= 0; i--) {
    sum += Number(base48[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod === 10 ? 1 : mod;
  return `${base48}${check}`;
}

const SAMPLE_CLAVE_FACTURA = makeValidClave49(
  '15112026' + '01' + '1790016919001' + '2' + '001002' + '000012345' + '12345678' + '1'
);
const SAMPLE_CLAVE_RETENCION = makeValidClave49(
  '20112026' + '07' + '1791234567001' + '2' + '001001' + '000000099' + '87654321' + '1'
);

const SAMPLE_FACTURA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<factura id="comprobante" version="1.1.0">
  <infoTributaria>
    <ambiente>2</ambiente>
    <tipoEmision>1</tipoEmision>
    <razonSocial>CORPORACION EJEMPLO S.A.</razonSocial>
    <nombreComercial>EJEMPLO SUPERMERCADOS</nombreComercial>
    <ruc>1790016919001</ruc>
    <claveAcceso>${SAMPLE_CLAVE_FACTURA}</claveAcceso>
    <codDoc>01</codDoc>
    <estab>001</estab>
    <ptoEmi>002</ptoEmi>
    <secuencial>000012345</secuencial>
  </infoTributaria>
  <infoFactura>
    <fechaEmision>15/11/2026</fechaEmision>
    <razonSocialComprador>MI EMPRESA DEMO CIA LTDA</razonSocialComprador>
    <identificacionComprador>1792223334001</identificacionComprador>
    <totalSinImpuestos>150.00</totalSinImpuestos>
    <totalDescuento>5.00</totalDescuento>
    <totalConImpuestos>
      <totalImpuesto>
        <codigo>2</codigo>
        <codigoPorcentaje>0</codigoPorcentaje>
        <baseImponible>50.00</baseImponible>
        <valor>0.00</valor>
      </totalImpuesto>
      <totalImpuesto>
        <codigo>2</codigo>
        <codigoPorcentaje>4</codigoPorcentaje>
        <baseImponible>100.00</baseImponible>
        <valor>15.00</valor>
      </totalImpuesto>
    </totalConImpuestos>
    <propina>0.00</propina>
    <importeTotal>165.00</importeTotal>
    <pagos>
      <pago>
        <formaPago>20</formaPago>
        <total>165.00</total>
      </pago>
    </pagos>
  </infoFactura>
  <detalles>
    <detalle>
      <codigoPrincipal>PROD-01</codigoPrincipal>
      <descripcion>Suministros de oficina</descripcion>
      <cantidad>2.00</cantidad>
      <precioUnitario>50.00</precioUnitario>
      <descuento>0.00</descuento>
      <precioTotalSinImpuesto>100.00</precioTotalSinImpuesto>
      <impuestos>
        <impuesto>
          <codigo>2</codigo>
          <codigoPorcentaje>4</codigoPorcentaje>
          <tarifa>15</tarifa>
          <baseImponible>100.00</baseImponible>
          <valor>15.00</valor>
        </impuesto>
      </impuestos>
    </detalle>
    <detalle>
      <codigoPrincipal>PROD-02</codigoPrincipal>
      <descripcion>Alimentos básicos 0%</descripcion>
      <cantidad>1.00</cantidad>
      <precioUnitario>50.00</precioUnitario>
      <descuento>0.00</descuento>
      <precioTotalSinImpuesto>50.00</precioTotalSinImpuesto>
      <impuestos>
        <impuesto>
          <codigo>2</codigo>
          <codigoPorcentaje>0</codigoPorcentaje>
          <tarifa>0</tarifa>
          <baseImponible>50.00</baseImponible>
          <valor>0.00</valor>
        </impuesto>
      </impuestos>
    </detalle>
  </detalles>
</factura>`;

const SAMPLE_RETENCION_V2_XML = `<?xml version="1.0" encoding="UTF-8"?>
<comprobanteRetencion id="comprobante" version="2.0.0">
  <infoTributaria>
    <razonSocial>CLIENTE RETENEDOR S.A.</razonSocial>
    <ruc>1791234567001</ruc>
    <claveAcceso>${SAMPLE_CLAVE_RETENCION}</claveAcceso>
    <codDoc>07</codDoc>
    <estab>001</estab>
    <ptoEmi>001</ptoEmi>
    <secuencial>000000099</secuencial>
  </infoTributaria>
  <infoCompRetencion>
    <fechaEmision>20/11/2026</fechaEmision>
    <razonSocialSujetoRetenido>MI EMPRESA DEMO CIA LTDA</razonSocialSujetoRetenido>
    <identificacionSujetoRetenido>1792223334001</identificacionSujetoRetenido>
  </infoCompRetencion>
  <docsSustento>
    <docSustento>
      <codDocSustento>01</codDocSustento>
      <numDocSustento>001001000000555</numDocSustento>
      <fechaEmisionDocSustento>18/11/2026</fechaEmisionDocSustento>
      <retenciones>
        <retencion>
          <codigo>1</codigo>
          <codigoRetencion>312</codigoRetencion>
          <baseImponible>200.00</baseImponible>
          <porcentajeRetener>1.75</porcentajeRetener>
          <valorRetenido>3.50</valorRetenido>
        </retencion>
      </retenciones>
    </docSustento>
  </docsSustento>
</comprobanteRetencion>`;

describe('Faktum SRI Core Services', () => {
  it('decodes and validates a 49-digit Clave de Acceso', () => {
    expect(validateModulo11(SAMPLE_CLAVE_FACTURA)).toBe(true);
    const decoded = decodeClaveAcceso(SAMPLE_CLAVE_FACTURA);
    expect(decoded).not.toBeNull();
    expect(decoded?.fechaEmision).toBe('15/11/2026');
    expect(decoded?.fechaEmisionIso).toBe('2026-11-15');
    expect(decoded?.tipoCodigo).toBe('01');
    expect(decoded?.rucEmisor).toBe('1790016919001');
    expect(decoded?.numeroComprobante).toBe('001-002-000012345');
  });

  it('extracts keys from SRI Latin-1 TXT report text', () => {
    const rawReport =
      'RUC_EMISOR\tRAZÓN_SOCIAL_EMISOR\tTIPO_COMPROBANTE\tSERIE_COMPROBANTE\tCLAVE_ACCESO\tFECHA_AUTORIZACION\tFECHA_EMISION\tIMPORTE_TOTAL\n' +
      `1790016919001\tCORPORACIÓN EJEMPLO S.A.\tFactura\t001-002-000012345\t${SAMPLE_CLAVE_FACTURA}\t15/11/2026 10:00:00\t15/11/2026\t165.00\n`;
    const latin1Buffer = Buffer.from(rawReport, 'latin1');
    const decodedText = decodeSriBuffer(latin1Buffer);
    const entries = extractKeysFromReportText(decodedText);
    expect(entries).toHaveLength(1);
    expect(entries[0].claveAcceso).toBe(SAMPLE_CLAVE_FACTURA);
    expect(entries[0].razonSocialEmisor).toContain('CORPORACIÓN EJEMPLO');
    expect(entries[0].importeTotal).toBe(165);
  });

  it('parses SRI SOAP AutorizacionComprobantesOffline response choosing AUTORIZADO', () => {
    const soap = `<?xml version="1.0" encoding="UTF-8"?>
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body>
          <ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion">
            <RespuestaAutorizacionComprobante>
              <autorizaciones>
                <autorizacion>
                  <estado>NO AUTORIZADO</estado>
                  <numeroAutorizacion>${SAMPLE_CLAVE_FACTURA}</numeroAutorizacion>
                </autorizacion>
                <autorizacion>
                  <estado>AUTORIZADO</estado>
                  <numeroAutorizacion>${SAMPLE_CLAVE_FACTURA}</numeroAutorizacion>
                  <fechaAutorizacion>2026-11-15T10:05:00-05:00</fechaAutorizacion>
                  <ambiente>PRODUCCIÓN</ambiente>
                  <comprobante><![CDATA[${SAMPLE_FACTURA_XML}]]></comprobante>
                </autorizacion>
              </autorizaciones>
            </RespuestaAutorizacionComprobante>
          </ns2:autorizacionComprobanteResponse>
        </soap:Body>
      </soap:Envelope>`;

    const result = parseSriSoapResponse(soap, SAMPLE_CLAVE_FACTURA);
    expect(result.ok).toBe(true);
    expect(result.estado).toBe('AUTORIZADO');
    expect(result.innerXml).toContain('<factura');
    expect(result.authorizedWrapperXml).toContain('<estado>AUTORIZADO</estado>');
  });

  it('parses Factura (IVA 15% + 0%) and Retención v2.0.0 XMLs and exports Excel workbook', async () => {
    const factura = parseSriComprobanteXml({
      innerXml: SAMPLE_FACTURA_XML,
      profileId: 'p1',
      ownerRuc: '1792223334001',
      xmlPath: '/tmp/factura.xml',
      estado: 'AUTORIZADO',
      fechaAutorizacion: '2026-11-15T10:05:00-05:00',
    });

    expect(factura.subtotal0).toBe(50);
    expect(factura.subtotalIva).toBe(100);
    expect(factura.iva).toBe(15);
    expect(factura.importeTotal).toBe(165);
    expect(factura.formaPago).toContain('sistema financiero');
    expect(factura.detalles).toHaveLength(2);

    const retencion = parseSriComprobanteXml({
      innerXml: SAMPLE_RETENCION_V2_XML,
      profileId: 'p1',
      ownerRuc: '1792223334001',
      xmlPath: '/tmp/retencion.xml',
    });

    expect(retencion.tipoCodigo).toBe('07');
    expect(retencion.retenciones).toHaveLength(1);
    expect(retencion.retenciones[0].valorRetenido).toBe(3.5);
    expect(retencion.importeTotal).toBe(3.5);

    const outPath = path.join(os.tmpdir(), `faktum-test-${Date.now()}.xlsx`);
    await exportComprobantesToExcel([factura, retencion], outPath);
    expect(fs.existsSync(outPath)).toBe(true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(outPath);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Resumen Comprobantes',
      'Detalle de Ítems',
      'Retenciones',
    ]);
    expect(wb.getWorksheet('Resumen Comprobantes')?.rowCount).toBe(4); // header + 2 rows + totals
    expect(wb.getWorksheet('Detalle de Ítems')?.rowCount).toBe(3); // header + 2 items
    expect(wb.getWorksheet('Retenciones')?.rowCount).toBe(2); // header + 1 retencion

    const pdfFacturaPath = path.join(os.tmpdir(), `faktum-ride-fac-${Date.now()}.pdf`);
    const pdfRetPath = path.join(os.tmpdir(), `faktum-ride-ret-${Date.now()}.pdf`);
    await generateRidePdf(factura, pdfFacturaPath);
    await generateRidePdf(retencion, pdfRetPath);

    const facBuf = fs.readFileSync(pdfFacturaPath);
    const retBuf = fs.readFileSync(pdfRetPath);
    expect(facBuf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(retBuf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(facBuf.length).toBeGreaterThan(1500);
    expect(retBuf.length).toBeGreaterThan(1500);

    fs.unlinkSync(outPath);
    fs.unlinkSync(pdfFacturaPath);
    fs.unlinkSync(pdfRetPath);
  });

  it('organizes XML, PDF, and Excel paths by active Razón Social (owner RUC), period, and file format safely for macOS and Windows', () => {
    const paths = buildComprobantePaths({
      outputDir: '/tmp/Faktum_SRI',
      ownerRuc: '1307567279001',
      ownerAlias: 'Javier Quijije Palma.:/',
      year: '2026',
      month: 11,
      rucEmisor: '1790016919001',
      razonSocialEmisor: 'CORPORACION FAVORITA C.A.',
      tipoCodigo: '01',
      fechaEmisionIso: '2026-11-15',
      numeroComprobante: '001-002-000012345',
      claveAcceso: SAMPLE_CLAVE_FACTURA,
    });

    expect(paths.ownerRootDir).toBe(
      path.join('/tmp/Faktum_SRI', 'Javier Quijije Palma (1307567279001)')
    );
    expect(paths.excelDir).toBe(
      path.join('/tmp/Faktum_SRI', 'Javier Quijije Palma (1307567279001)', '2026', '11_Noviembre', 'Excel')
    );
    expect(paths.xmlPath).toBe(
      path.join(
        '/tmp/Faktum_SRI',
        'Javier Quijije Palma (1307567279001)',
        '2026',
        '11_Noviembre',
        'XML',
        'Facturas',
        '2026-11-15_001-002-000012345_CORPORACION_FAVORITA_C.A.xml'
      )
    );
    expect(paths.pdfPath).toBe(
      path.join(
        '/tmp/Faktum_SRI',
        'Javier Quijije Palma (1307567279001)',
        '2026',
        '11_Noviembre',
        'PDF',
        'Facturas',
        '2026-11-15_001-002-000012345_CORPORACION_FAVORITA_C.A.pdf'
      )
    );
  });

  it('expands multi-year date ranges into months and filters entries accurately by exact day bounds', () => {
    const months = expandMonthsInRange('2025-11-10', '2026-02-05');
    expect(months).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ]);

    // Future months strictly after reference date are discarded
    const currentYearMonths = expandMonthsInRange(
      '2026-01-01',
      '2026-12-31',
      new Date(2026, 10, 27) // 2026-11-27
    );
    expect(currentYearMonths).toHaveLength(11);
    expect(currentYearMonths[0]).toEqual({ year: 2026, month: 1 });
    expect(currentYearMonths[10]).toEqual({ year: 2026, month: 11 });

    // Past years keep all 12 months
    const pastYearMonths = expandMonthsInRange(
      '2025-01-01',
      '2025-12-31',
      new Date(2026, 10, 27)
    );
    expect(pastYearMonths).toHaveLength(12);

    // Purely future ranges return empty
    expect(
      expandMonthsInRange('2026-12-01', '2026-12-31', new Date(2026, 10, 27))
    ).toEqual([]);

    expect(
      isEntryWithinDateRange(
        { claveAcceso: SAMPLE_CLAVE_FACTURA, fechaEmision: '15/11/2026' },
        '2026-11-01',
        '2026-11-20'
      )
    ).toBe(true);
    expect(
      isEntryWithinDateRange(
        { claveAcceso: SAMPLE_CLAVE_FACTURA, fechaEmision: '15/11/2026' },
        '2026-11-16',
        '2026-11-30'
      )
    ).toBe(false);
    const wrappedPortalXml = `<?xml version="1.0" encoding="UTF-8"?>
<autorizacion>
  <estado>AUTORIZADO</estado>
  <numeroAutorizacion>${SAMPLE_CLAVE_FACTURA}</numeroAutorizacion>
  <fechaAutorizacion>2026-01-15T10:05:00-05:00</fechaAutorizacion>
  <ambiente>PRODUCCIÓN</ambiente>
  <comprobante><![CDATA[${SAMPLE_FACTURA_XML}]]></comprobante>
</autorizacion>`;

    const fromPortalXml = parseSriComprobanteXml({
      innerXml: wrappedPortalXml,
      profileId: 'p1',
      ownerRuc: '1792223334001',
      xmlPath: '/tmp/factura_portal.xml',
    });
    expect(fromPortalXml.razonSocialEmisor).toBe('CORPORACION EJEMPLO S.A.');
    expect(fromPortalXml.importeTotal).toBe(165);
    expect(fromPortalXml.fechaAutorizacion).toBe('2026-01-15T10:05:00-05:00');
  });
});
