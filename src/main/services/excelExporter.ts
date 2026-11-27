import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import type { ParsedComprobante } from '../../shared/types';

const CURRENCY_FMT = '$#,##0.00';

function styleHeaderRow(row: ExcelJS.Row) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A5F' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });
}

export async function exportComprobantesToExcel(
  comprobantes: ParsedComprobante[],
  outputFilePath: string
): Promise<string> {
  fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Faktum';
  workbook.created = new Date();

  // Sheet 1: Resumen Contable
  const summary = workbook.addWorksheet('Resumen Comprobantes', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  summary.columns = [
    { header: 'Fecha Emisión', key: 'fechaEmision', width: 14 },
    { header: 'Tipo', key: 'tipoNombre', width: 22 },
    { header: 'Número Comprobante', key: 'numeroComprobante', width: 20 },
    { header: 'RUC Emisor', key: 'rucEmisor', width: 16 },
    { header: 'Razón Social Emisor', key: 'razonSocialEmisor', width: 34 },
    { header: 'Subtotal 0%', key: 'subtotal0', width: 14 },
    { header: 'Subtotal IVA', key: 'subtotalIva', width: 14 },
    { header: 'No Objeto IVA', key: 'subtotalNoObjeto', width: 14 },
    { header: 'Exento IVA', key: 'subtotalExento', width: 13 },
    { header: 'Descuento', key: 'totalDescuento', width: 13 },
    { header: 'IVA', key: 'iva', width: 13 },
    { header: 'ICE', key: 'ice', width: 12 },
    { header: 'Total', key: 'importeTotal', width: 15 },
    { header: 'Forma de Pago', key: 'formaPago', width: 26 },
    { header: 'Doc. Modificado', key: 'docModificado', width: 18 },
    { header: 'Estado', key: 'estado', width: 13 },
    { header: 'Fecha Autorización', key: 'fechaAutorizacion', width: 22 },
    { header: 'Clave de Acceso', key: 'claveAcceso', width: 52 },
  ];

  styleHeaderRow(summary.getRow(1));

  const sorted = [...comprobantes].sort((a, b) => a.fechaEmisionIso.localeCompare(b.fechaEmisionIso));

  for (const c of sorted) {
    const row = summary.addRow({
      fechaEmision: c.fechaEmision,
      tipoNombre: c.tipoNombre,
      numeroComprobante: c.numeroComprobante,
      rucEmisor: c.rucEmisor,
      razonSocialEmisor: c.razonSocialEmisor,
      subtotal0: c.subtotal0,
      subtotalIva: c.subtotalIva,
      subtotalNoObjeto: c.subtotalNoObjeto,
      subtotalExento: c.subtotalExento,
      totalDescuento: c.totalDescuento,
      iva: c.iva,
      ice: c.ice,
      importeTotal: c.importeTotal,
      formaPago: c.formaPago,
      docModificado: c.docModificado,
      estado: c.estado,
      fechaAutorizacion: c.fechaAutorizacion,
      claveAcceso: c.claveAcceso,
    });

    for (const colIdx of [6, 7, 8, 9, 10, 11, 12, 13]) {
      row.getCell(colIdx).numFmt = CURRENCY_FMT;
    }
    row.getCell(4).numFmt = '@';
    row.getCell(18).numFmt = '@';
  }

  if (sorted.length > 0) {
    const lastDataRow = sorted.length + 1;
    const totalRow = summary.addRow({
      fechaEmision: 'TOTALES',
      subtotal0: { formula: `SUM(F2:F${lastDataRow})` },
      subtotalIva: { formula: `SUM(G2:G${lastDataRow})` },
      subtotalNoObjeto: { formula: `SUM(H2:H${lastDataRow})` },
      subtotalExento: { formula: `SUM(I2:I${lastDataRow})` },
      totalDescuento: { formula: `SUM(J2:J${lastDataRow})` },
      iva: { formula: `SUM(K2:K${lastDataRow})` },
      ice: { formula: `SUM(L2:L${lastDataRow})` },
      importeTotal: { formula: `SUM(M2:M${lastDataRow})` },
    });
    totalRow.font = { bold: true };
    totalRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    };
    for (const colIdx of [6, 7, 8, 9, 10, 11, 12, 13]) {
      totalRow.getCell(colIdx).numFmt = CURRENCY_FMT;
    }
    summary.autoFilter = {
      from: 'A1',
      to: `R${lastDataRow}`,
    };
  }

  // Sheet 2: Detalle de Ítems
  const allDetails = sorted.flatMap((c) => c.detalles);
  const detailsSheet = workbook.addWorksheet('Detalle de Ítems', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  detailsSheet.columns = [
    { header: 'Fecha Emisión', key: 'fechaEmision', width: 14 },
    { header: 'Tipo', key: 'tipoComprobante', width: 18 },
    { header: 'Número Comprobante', key: 'numeroComprobante', width: 20 },
    { header: 'RUC Emisor', key: 'rucEmisor', width: 16 },
    { header: 'Razón Social Emisor', key: 'razonSocialEmisor', width: 32 },
    { header: 'Código', key: 'codigoPrincipal', width: 16 },
    { header: 'Descripción', key: 'descripcion', width: 44 },
    { header: 'Cantidad', key: 'cantidad', width: 12 },
    { header: 'Precio Unitario', key: 'precioUnitario', width: 15 },
    { header: 'Descuento', key: 'descuento', width: 13 },
    { header: 'Subtotal Línea', key: 'precioTotalSinImpuesto', width: 15 },
    { header: 'Tarifa IVA', key: 'ivaTarifa', width: 12 },
    { header: 'IVA Línea', key: 'ivaValor', width: 13 },
    { header: 'Clave de Acceso', key: 'claveAcceso', width: 52 },
  ];

  styleHeaderRow(detailsSheet.getRow(1));

  for (const d of allDetails) {
    const row = detailsSheet.addRow(d);
    for (const colIdx of [9, 10, 11, 13]) {
      row.getCell(colIdx).numFmt = CURRENCY_FMT;
    }
    row.getCell(4).numFmt = '@';
    row.getCell(14).numFmt = '@';
  }

  if (allDetails.length > 0) {
    detailsSheet.autoFilter = {
      from: 'A1',
      to: `N${allDetails.length + 1}`,
    };
  }

  // Sheet 3: Retenciones (only if present)
  const allRetenciones = sorted.flatMap((c) => c.retenciones);
  if (allRetenciones.length > 0) {
    const retSheet = workbook.addWorksheet('Retenciones', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    retSheet.columns = [
      { header: 'Fecha Emisión', key: 'fechaEmision', width: 14 },
      { header: 'Número Retención', key: 'numeroComprobante', width: 20 },
      { header: 'RUC Emisor', key: 'rucEmisor', width: 16 },
      { header: 'Razón Social Emisor', key: 'razonSocialEmisor', width: 32 },
      { header: 'Impuesto', key: 'impuesto', width: 12 },
      { header: 'Cód. Retención', key: 'codigoRetencion', width: 15 },
      { header: 'Base Imponible', key: 'baseImponible', width: 15 },
      { header: '% Retención', key: 'porcentajeRetener', width: 13 },
      { header: 'Valor Retenido', key: 'valorRetenido', width: 15 },
      { header: 'Doc. Sustento', key: 'docSustentoNumero', width: 20 },
      { header: 'Fecha Sustento', key: 'docSustentoFecha', width: 14 },
      { header: 'Clave de Acceso', key: 'claveAcceso', width: 52 },
    ];

    styleHeaderRow(retSheet.getRow(1));

    for (const r of allRetenciones) {
      const row = retSheet.addRow(r);
      row.getCell(7).numFmt = CURRENCY_FMT;
      row.getCell(9).numFmt = CURRENCY_FMT;
      row.getCell(3).numFmt = '@';
      row.getCell(12).numFmt = '@';
    }
  }

  await workbook.xlsx.writeFile(outputFilePath);
  return outputFilePath;
}
