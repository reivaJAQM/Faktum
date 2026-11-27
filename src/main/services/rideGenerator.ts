import fs from 'node:fs';
import path from 'node:path';
import type PDFDocumentType from 'pdfkit';
import type { ParsedComprobante } from '../../shared/types';

type PdfDocCtor = typeof PDFDocumentType;
let cachedPdfDocCtor: PdfDocCtor | null = null;

async function loadPdfDocumentCtor(): Promise<PdfDocCtor> {
  if (cachedPdfDocCtor) return cachedPdfDocCtor;
  // Electron 33 runs Node 20 (CJS main), whereas pdfkit 0.21 depends on ESM fontkit.
  // Native dynamic import() loads pdfkit's ESM entry cleanly in Electron Node 20,
  // with fallback to bundler/Vitest import() inside VM test environments.
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string
    ) => Promise<{ default: PdfDocCtor }>;
    const mod = await dynamicImport('pdfkit');
    cachedPdfDocCtor = mod.default;
  } catch {
    const mod = await import('pdfkit');
    cachedPdfDocCtor =
      (mod as unknown as { default?: PdfDocCtor }).default ?? (mod as unknown as PdfDocCtor);
  }
  return cachedPdfDocCtor;
}

function money(val: number): string {
  return `$${(Number.isFinite(val) ? val : 0).toFixed(2)}`;
}

/**
 * Draws a crisp decorative visual barcode representation for the 49-digit Clave de Acceso
 * so the RIDE matches the familiar Ecuador SRI layout without external font/canvas deps.
 */
function drawClaveBarcode(
  doc: PDFKit.PDFDocument,
  clave: string,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const digits = clave.replace(/\D/g, '') || '0000000000';
  // Deterministic bar pattern encoding each digit into 4 bars/spaces
  const patterns: Record<string, string> = {
    '0': '10100110',
    '1': '11001010',
    '2': '10110010',
    '3': '11010010',
    '4': '10011010',
    '5': '11001100',
    '6': '10101100',
    '7': '10010110',
    '8': '11011000',
    '9': '10110100',
  };
  let bits = '110100';
  for (const ch of digits) {
    bits += patterns[ch] ?? '10100110';
  }
  bits += '110011';

  const moduleWidth = width / bits.length;
  doc.save();
  doc.fillColor('#0f172a');
  let runStart = -1;
  for (let i = 0; i <= bits.length; i++) {
    const bit = bits[i];
    if (bit === '1' && runStart === -1) {
      runStart = i;
    } else if (bit !== '1' && runStart !== -1) {
      doc.rect(x + runStart * moduleWidth, y, (i - runStart) * moduleWidth, height).fill();
      runStart = -1;
    }
  }
  doc.restore();
}

export async function generateRidePdf(
  comp: ParsedComprobante,
  outputPdfPath: string
): Promise<string> {
  const PDFDocument = await loadPdfDocumentCtor();
  fs.mkdirSync(path.dirname(outputPdfPath), { recursive: true });

  return new Promise<string>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 32,
      info: {
        Title: `${comp.tipoNombre} ${comp.numeroComprobante}`,
        Author: comp.razonSocialEmisor || 'Faktum',
        Subject: `RIDE SRI - Clave ${comp.claveAcceso}`,
      },
    });

    const stream = fs.createWriteStream(outputPdfPath);
    stream.on('finish', () => resolve(outputPdfPath));
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    const pageWidth = doc.page.width - 64; // 595 - 64 = 531
    const leftX = 32;
    const colGap = 12;
    const leftColW = 248;
    const rightColW = pageWidth - leftColW - colGap;
    const rightX = leftX + leftColW + colGap;

    const topY = 32;
    const headerH = 166;

    // Left Header Box (Emisor)
    doc.roundedRect(leftX, topY, leftColW, headerH, 6).lineWidth(0.8).strokeColor('#cbd5e1').stroke();
    doc
      .fillColor('#1e3a5f')
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(comp.razonSocialEmisor || 'EMISOR ELECTRÓNICO', leftX + 12, topY + 14, {
        width: leftColW - 24,
      });

    if (comp.nombreComercialEmisor && comp.nombreComercialEmisor !== comp.razonSocialEmisor) {
      doc
        .fillColor('#475569')
        .font('Helvetica')
        .fontSize(9)
        .text(comp.nombreComercialEmisor, leftX + 12, doc.y + 4, { width: leftColW - 24 });
    }

    doc
      .fillColor('#334155')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('RUC Emisor:', leftX + 12, topY + 96)
      .font('Helvetica')
      .text(comp.rucEmisor || '—', leftX + 76, topY + 96);

    doc
      .font('Helvetica-Bold')
      .text('Estado SRI:', leftX + 12, topY + 114)
      .fillColor('#15803d')
      .text(comp.estado || 'AUTORIZADO', leftX + 76, topY + 114);

    doc
      .fillColor('#64748b')
      .font('Helvetica')
      .fontSize(7.5)
      .text('RIDE — Representación Impresa de Documento Electrónico', leftX + 12, topY + 140, {
        width: leftColW - 24,
      });

    // Right Header Box (Autorización + Clave de Acceso)
    doc.roundedRect(rightX, topY, rightColW, headerH, 6).lineWidth(0.8).strokeColor('#cbd5e1').stroke();
    let ry = topY + 10;

    doc
      .fillColor('#0f172a')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(`R.U.C.: ${comp.rucEmisor}`, rightX + 12, ry, { width: rightColW - 24 });
    ry += 15;

    doc
      .fillColor('#1e3a5f')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(comp.tipoNombre.toUpperCase(), rightX + 12, ry, { width: rightColW - 24 });
    ry += 16;

    doc
      .fillColor('#0f172a')
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .text(`No. ${comp.numeroComprobante}`, rightX + 12, ry, { width: rightColW - 24 });
    ry += 16;

    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor('#475569')
      .text('NÚMERO DE AUTORIZACIÓN', rightX + 12, ry);
    ry += 10;
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#0f172a')
      .text(comp.claveAcceso, rightX + 12, ry, { width: rightColW - 24 });
    ry += 12;

    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor('#475569')
      .text(`FECHA AUTORIZACIÓN: `, rightX + 12, ry, { continued: true })
      .font('Helvetica')
      .fillColor('#0f172a')
      .text(comp.fechaAutorizacion || comp.fechaEmision || '—');
    ry += 12;

    doc
      .font('Helvetica-Bold')
      .fillColor('#475569')
      .text(`AMBIENTE: `, rightX + 12, ry, { continued: true })
      .font('Helvetica')
      .fillColor('#0f172a')
      .text(`${comp.ambiente || 'PRODUCCIÓN'}   |   EMISIÓN: NORMAL`);
    ry += 14;

    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor('#475569')
      .text('CLAVE DE ACCESO', rightX + 12, ry);
    ry += 10;

    drawClaveBarcode(doc, comp.claveAcceso, rightX + 12, ry, rightColW - 24, 24);
    ry += 27;
    doc
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor('#334155')
      .text(comp.claveAcceso, rightX + 12, ry, { width: rightColW - 24, align: 'center' });

    // Buyer / Recipient Box
    let y = topY + headerH + 12;
    const buyerH = comp.docModificado || comp.motivo ? 64 : 48;
    doc.roundedRect(leftX, y, pageWidth, buyerH, 6).lineWidth(0.8).strokeColor('#cbd5e1').stroke();

    doc
      .fillColor('#334155')
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text('Razón Social / Nombres:', leftX + 12, y + 10)
      .font('Helvetica')
      .fillColor('#0f172a')
      .text(comp.razonSocialReceptor || '—', leftX + 125, y + 10, { width: 245 });

    doc
      .fillColor('#334155')
      .font('Helvetica-Bold')
      .text('Identificación:', leftX + 378, y + 10)
      .font('Helvetica')
      .fillColor('#0f172a')
      .text(comp.identificacionReceptor || comp.ownerRuc || '—', leftX + 446, y + 10, { width: 78 });

    doc
      .fillColor('#334155')
      .font('Helvetica-Bold')
      .text('Fecha de Emisión:', leftX + 12, y + 27)
      .font('Helvetica')
      .fillColor('#0f172a')
      .text(comp.fechaEmision || '—', leftX + 125, y + 27);

    if (comp.docModificado || comp.motivo) {
      doc
        .fillColor('#334155')
        .font('Helvetica-Bold')
        .text('Doc. Modificado / Motivo:', leftX + 12, y + 44)
        .font('Helvetica')
        .fillColor('#0f172a')
        .text([comp.docModificado, comp.motivo].filter(Boolean).join(' — '), leftX + 125, y + 44, {
          width: pageWidth - 138,
        });
    }

    y += buyerH + 12;

    // Helper for table headers + pagination
    const ensureSpace = (needed: number) => {
      if (y + needed > doc.page.height - 56) {
        doc.addPage();
        y = 36;
      }
    };

    if (comp.retenciones.length > 0) {
      // Retenciones table
      const cols = [
        { label: 'Impuesto', x: leftX, w: 60, align: 'left' as const },
        { label: 'Cód. Ret.', x: leftX + 60, w: 55, align: 'left' as const },
        { label: 'Doc. Sustento', x: leftX + 115, w: 120, align: 'left' as const },
        { label: 'Fecha', x: leftX + 235, w: 68, align: 'left' as const },
        { label: 'Base Imp.', x: leftX + 303, w: 78, align: 'right' as const },
        { label: '% Ret.', x: leftX + 381, w: 60, align: 'right' as const },
        { label: 'Valor Retenido', x: leftX + 441, w: 90, align: 'right' as const },
      ];

      doc.rect(leftX, y, pageWidth, 20).fill('#1e3a5f');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
      for (const c of cols) {
        doc.text(c.label, c.x + 5, y + 6, { width: c.w - 10, align: c.align });
      }
      y += 20;

      for (let i = 0; i < comp.retenciones.length; i++) {
        const r = comp.retenciones[i];
        ensureSpace(20);
        if (i % 2 === 1) {
          doc.rect(leftX, y, pageWidth, 18).fill('#f8fafc');
        }
        doc.fillColor('#0f172a').font('Helvetica').fontSize(8);
        doc.text(r.impuesto, cols[0].x + 5, y + 5, { width: cols[0].w - 10 });
        doc.text(r.codigoRetencion, cols[1].x + 5, y + 5, { width: cols[1].w - 10 });
        doc.text(r.docSustentoNumero || '—', cols[2].x + 5, y + 5, { width: cols[2].w - 10 });
        doc.text(r.docSustentoFecha || '—', cols[3].x + 5, y + 5, { width: cols[3].w - 10 });
        doc.text(money(r.baseImponible), cols[4].x + 5, y + 5, { width: cols[4].w - 10, align: 'right' });
        doc.text(`${r.porcentajeRetener}%`, cols[5].x + 5, y + 5, { width: cols[5].w - 10, align: 'right' });
        doc.text(money(r.valorRetenido), cols[6].x + 5, y + 5, { width: cols[6].w - 10, align: 'right' });
        y += 18;
      }
    } else if (comp.detalles.length > 0) {
      // Invoice / Credit Note / Liquidacion Details table
      const cols = [
        { label: 'Código', x: leftX, w: 66, align: 'left' as const },
        { label: 'Descripción', x: leftX + 66, w: 220, align: 'left' as const },
        { label: 'Cant.', x: leftX + 286, w: 48, align: 'right' as const },
        { label: 'P. Unit.', x: leftX + 334, w: 64, align: 'right' as const },
        { label: 'Desc.', x: leftX + 398, w: 55, align: 'right' as const },
        { label: 'Total', x: leftX + 453, w: 78, align: 'right' as const },
      ];

      doc.rect(leftX, y, pageWidth, 20).fill('#1e3a5f');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
      for (const c of cols) {
        doc.text(c.label, c.x + 5, y + 6, { width: c.w - 10, align: c.align });
      }
      y += 20;

      for (let i = 0; i < comp.detalles.length; i++) {
        const d = comp.detalles[i];
        doc.font('Helvetica').fontSize(7.8);
        const descH = Math.max(
          16,
          doc.heightOfString(d.descripcion || '—', { width: cols[1].w - 10 }) + 7
        );
        ensureSpace(descH + 4);

        if (i % 2 === 1) {
          doc.rect(leftX, y, pageWidth, descH).fill('#f8fafc');
        }
        doc
          .moveTo(leftX, y + descH)
          .lineTo(leftX + pageWidth, y + descH)
          .lineWidth(0.4)
          .strokeColor('#e2e8f0')
          .stroke();

        doc.fillColor('#0f172a').font('Helvetica').fontSize(7.8);
        doc.text(d.codigoPrincipal || '—', cols[0].x + 5, y + 4, {
          width: cols[0].w - 10,
          ellipsis: true,
        });
        doc.text(d.descripcion || '—', cols[1].x + 5, y + 4, { width: cols[1].w - 10 });
        doc.text(String(d.cantidad), cols[2].x + 5, y + 4, { width: cols[2].w - 10, align: 'right' });
        doc.text(money(d.precioUnitario), cols[3].x + 5, y + 4, {
          width: cols[3].w - 10,
          align: 'right',
        });
        doc.text(money(d.descuento), cols[4].x + 5, y + 4, {
          width: cols[4].w - 10,
          align: 'right',
        });
        doc.text(money(d.precioTotalSinImpuesto), cols[5].x + 5, y + 4, {
          width: cols[5].w - 10,
          align: 'right',
        });
        y += descH;
      }
    }

    y += 14;
    ensureSpace(148);

    // Bottom Section: Payment Info (left) + Totals Box (right)
    const totalsW = 216;
    const totalsX = leftX + pageWidth - totalsW;
    const infoW = pageWidth - totalsW - 14;

    doc.roundedRect(leftX, y, infoW, 88, 6).lineWidth(0.8).strokeColor('#cbd5e1').stroke();
    doc
      .fillColor('#1e3a5f')
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text('Información de Pago y Referencia', leftX + 10, y + 10);
    doc
      .fillColor('#334155')
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('Forma de Pago:', leftX + 10, y + 28)
      .font('Helvetica')
      .fillColor('#0f172a')
      .text(comp.formaPago || 'No especificada', leftX + 82, y + 28, { width: infoW - 92 });

    doc
      .fillColor('#334155')
      .font('Helvetica-Bold')
      .text('RUC Receptor:', leftX + 10, y + 54)
      .font('Helvetica')
      .fillColor('#0f172a')
      .text(comp.ownerRuc || comp.identificacionReceptor || '—', leftX + 82, y + 54);

    // Totals Table
    const totalRows: Array<{ label: string; value: string; bold?: boolean }> = [
      { label: 'SUBTOTAL IVA', value: money(comp.subtotalIva) },
      { label: 'SUBTOTAL 0%', value: money(comp.subtotal0) },
      { label: 'SUBTOTAL NO OBJETO IVA', value: money(comp.subtotalNoObjeto) },
      { label: 'SUBTOTAL EXENTO IVA', value: money(comp.subtotalExento) },
      { label: 'SUBTOTAL SIN IMPUESTOS', value: money(comp.totalSinImpuestos) },
      { label: 'TOTAL DESCUENTO', value: money(comp.totalDescuento) },
      { label: 'ICE', value: money(comp.ice) },
      { label: 'IVA', value: money(comp.iva) },
      { label: 'VALOR TOTAL', value: money(comp.importeTotal), bold: true },
    ];

    const rowH = 15.5;
    const boxH = totalRows.length * rowH + 4;
    doc.roundedRect(totalsX, y, totalsW, boxH, 6).lineWidth(0.8).strokeColor('#cbd5e1').stroke();

    let ty = y + 3;
    for (const r of totalRows) {
      if (r.bold) {
        doc.rect(totalsX + 1, ty - 1, totalsW - 2, rowH + 1).fill('#e2e8f0');
      }
      doc
        .fillColor(r.bold ? '#0f172a' : '#334155')
        .font(r.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(r.bold ? 8.5 : 7.8)
        .text(r.label, totalsX + 8, ty + 3, { width: 132 });
      doc
        .fillColor('#0f172a')
        .font(r.bold ? 'Helvetica-Bold' : 'Helvetica')
        .text(r.value, totalsX + 140, ty + 3, { width: 68, align: 'right' });
      ty += rowH;
    }

    // Footer
    doc
      .fillColor('#94a3b8')
      .font('Helvetica')
      .fontSize(7)
      .text(
        'RIDE generado localmente por Faktum a partir del comprobante XML autorizado del SRI.',
        leftX,
        doc.page.height - 28,
        { width: pageWidth, align: 'center' }
      );

    doc.end();
  });
}
