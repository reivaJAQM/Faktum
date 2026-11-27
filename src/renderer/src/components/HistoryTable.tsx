import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, FolderOpen, Search, Trash2 } from 'lucide-react';
import {
  SRI_DOC_TYPES,
  type ParsedComprobante,
  type RucProfile,
} from '../../../shared/types';
import { FaktumSelect } from './FaktumSelect';

interface HistoryTableProps {
  profiles: RucProfile[];
  selectedProfileId: string;
  onSelectProfile: (id: string) => void;
  comprobantes: ParsedComprobante[];
  outputDir: string;
  onRefresh: () => void;
}

type SortDir = 'ascending' | 'descending';
const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const HistoryTable: React.FC<HistoryTableProps> = ({
  profiles,
  selectedProfileId,
  onSelectProfile,
  comprobantes,
  outputDir,
  onRefresh,
}) => {
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [exportMsg, setExportMsg] = useState('');
  const [sortCol, setSortCol] = useState<number>(0);
  const [sortDir, setSortDir] = useState<SortDir>('descending');
  const [statusAnnouncement, setStatusAnnouncement] = useState('');

  const tableRef = useRef<HTMLTableElement>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const captionId = useId();

  const filtered = useMemo(() => {
    if (!selectedProfileId) return [];
    let list = comprobantes.filter((c) => c.profileId === selectedProfileId);
    if (typeFilter !== 'ALL') {
      list = list.filter((c) => c.tipoCodigo === typeFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.razonSocialEmisor.toLowerCase().includes(q) ||
          c.rucEmisor.includes(q) ||
          c.numeroComprobante.toLowerCase().includes(q) ||
          c.claveAcceso.includes(q)
      );
    }
    return list;
  }, [comprobantes, selectedProfileId, typeFilter, search]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, c) => {
        acc.subtotal += c.totalSinImpuestos;
        acc.iva += c.iva;
        acc.total += c.importeTotal;
        return acc;
      },
      { subtotal: 0, iva: 0, total: 0 }
    );
  }, [filtered]);

  // Reorder existing <tr> nodes in <tbody> using moveBefore (with appendChild fallback)
  // so DOM node identity and focus/state inside rows are preserved on sort.
  const applyDomSort = (colIndex: number, type: 'text' | 'number', direction: SortDir, label: string) => {
    const tbody = tbodyRef.current;
    if (!tbody) return;
    const rows = Array.from(tbody.rows);
    const factor = direction === 'ascending' ? 1 : -1;

    const getVal = (row: HTMLTableRowElement) => {
      const cell = row.cells[colIndex];
      return cell?.dataset.value ?? cell?.textContent?.trim() ?? '';
    };

    rows.sort((a, b) => {
      const va = getVal(a);
      const vb = getVal(b);
      if (type === 'number') {
        return factor * (Number(va) - Number(vb));
      }
      return factor * collator.compare(va, vb);
    });

    const moveFn = (container: HTMLTableSectionElement, row: HTMLTableRowElement) => {
      const parentWithMove = container as HTMLTableSectionElement & {
        moveBefore?: (node: Node, child: Node | null) => void;
      };
      if (typeof parentWithMove.moveBefore === 'function') {
        parentWithMove.moveBefore(row, null);
      } else {
        container.appendChild(row);
      }
    };

    for (const row of rows) {
      moveFn(tbody, row);
    }

    setStatusAnnouncement(
      `Ordenado por ${label}, ${direction === 'ascending' ? 'ascendente' : 'descendente'}, ${rows.length} filas`
    );
  };

  useEffect(() => {
    const headers = tableRef.current?.tHead?.rows[0]?.cells;
    if (!headers || !headers[sortCol]) return;
    const th = headers[sortCol] as HTMLTableCellElement;
    const colType = (th.dataset.type as 'text' | 'number') ?? 'text';
    const label = th.textContent?.trim() ?? 'Fecha';
    applyDomSort(sortCol, colType, sortDir, label);
  }, [filtered, sortCol, sortDir]);

  const handleSortClick = (colIndex: number) => {
    if (sortCol === colIndex) {
      setSortDir((prev) => (prev === 'ascending' ? 'descending' : 'ascending'));
    } else {
      setSortCol(colIndex);
      setSortDir('ascending');
    }
  };

  const handleExportExcel = async () => {
    setExportMsg('');
    const keys = filtered.map((c) => c.claveAcceso);
    const res = await window.faktum.exportExcel(keys, 'Faktum_Historial');
    if (res.ok && res.filePath) {
      setExportMsg(`Excel guardado en: ${res.filePath}`);
      await window.faktum.openPathInExplorer(res.filePath);
    } else if (res.message) {
      setExportMsg(res.message);
    }
  };

  const handleOpenPdf = async (claveAcceso: string) => {
    const res = await window.faktum.generatePdfForComprobante(claveAcceso);
    if (res.ok && res.pdfPath) {
      await window.faktum.openPathInExplorer(res.pdfPath);
      onRefresh();
    } else if (res.message) {
      setExportMsg(res.message);
    }
  };

  const handleDelete = async (claveAcceso: string) => {
    await window.faktum.deleteComprobanteRecord(claveAcceso);
    onRefresh();
  };

  return (
    <div className="page-scroll">
      <div className="page-header">
        <div>
          <h1>Comprobantes descargados</h1>
          <p>Consulta, filtra, ordena y exporta a Excel todos tus XML oficiales del SRI.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            onClick={() => void window.faktum.openPathInExplorer(outputDir)}
          >
            <FolderOpen size={15} aria-hidden="true" />
            Abrir carpeta XML
          </button>
          <button
            type="button"
            className="btn btn-success"
            disabled={filtered.length === 0}
            onClick={handleExportExcel}
          >
            <FileSpreadsheet size={15} aria-hidden="true" />
            Exportar a Excel ({filtered.length})
          </button>
        </div>
      </div>

      {exportMsg && <div className="badge badge-success">{exportMsg}</div>}

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Comprobantes</div>
          <div className="kpi-value">{filtered.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Subtotal sin impuestos</div>
          <div className="kpi-value">{fmtMoney(totals.subtotal)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total IVA</div>
          <div className="kpi-value">{fmtMoney(totals.iva)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Importe Total</div>
          <div className="kpi-value">{fmtMoney(totals.total)}</div>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="toolbar-field" style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="hist-search">Buscar proveedor, RUC, número o clave</label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search
              size={14}
              aria-hidden="true"
              style={{ position: 'absolute', left: 10, color: 'var(--muted)' }}
            />
            <input
              id="hist-search"
              type="search"
              placeholder="Ej. Corporación Favorita, 179..., 001-002-..."
              style={{ width: '100%', paddingLeft: 32 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="toolbar-field">
          <label htmlFor="hist-ruc">RUC / Empresa</label>
          <FaktumSelect
            id="hist-ruc"
            name="histRuc"
            minWidth={230}
            value={selectedProfileId}
            placeholder="— Seleccionar RUC —"
            options={[
              { value: '', label: '— Seleccionar RUC —' },
              ...profiles.map((p) => ({ value: p.id, label: p.alias, hint: p.ruc })),
            ]}
            onChange={onSelectProfile}
          />
        </div>

        <div className="toolbar-field">
          <label htmlFor="hist-type">Tipo</label>
          <FaktumSelect
            id="hist-type"
            name="histType"
            minWidth={205}
            value={typeFilter}
            options={Object.entries(SRI_DOC_TYPES).map(([k, m]) => ({
              value: k,
              label: m.label,
            }))}
            onChange={setTypeFilter}
          />
        </div>
      </div>

      <div role="status" className="visually-hidden">
        {statusAnnouncement}
      </div>

      <div className="table-region" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table className="data-table" ref={tableRef}>
          <caption id={captionId}>
            Listado de comprobantes electrónicos ({filtered.length})
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                data-type="text"
                aria-sort={sortCol === 0 ? sortDir : undefined}
              >
                <button type="button" onClick={() => handleSortClick(0)}>
                  <span>Fecha</span>
                  <span className="sort-indicator" aria-hidden="true" />
                </button>
              </th>
              <th
                scope="col"
                data-type="text"
                aria-sort={sortCol === 1 ? sortDir : undefined}
              >
                <button type="button" onClick={() => handleSortClick(1)}>
                  <span>Tipo</span>
                  <span className="sort-indicator" aria-hidden="true" />
                </button>
              </th>
              <th
                scope="col"
                data-type="text"
                aria-sort={sortCol === 2 ? sortDir : undefined}
              >
                <button type="button" onClick={() => handleSortClick(2)}>
                  <span>Emisor</span>
                  <span className="sort-indicator" aria-hidden="true" />
                </button>
              </th>
              <th
                scope="col"
                data-type="text"
                aria-sort={sortCol === 3 ? sortDir : undefined}
              >
                <button type="button" onClick={() => handleSortClick(3)}>
                  <span>Número</span>
                  <span className="sort-indicator" aria-hidden="true" />
                </button>
              </th>
              <th
                scope="col"
                data-type="number"
                aria-sort={sortCol === 4 ? sortDir : undefined}
              >
                <button type="button" onClick={() => handleSortClick(4)}>
                  <span>Subtotal</span>
                  <span className="sort-indicator" aria-hidden="true" />
                </button>
              </th>
              <th
                scope="col"
                data-type="number"
                aria-sort={sortCol === 5 ? sortDir : undefined}
              >
                <button type="button" onClick={() => handleSortClick(5)}>
                  <span>IVA</span>
                  <span className="sort-indicator" aria-hidden="true" />
                </button>
              </th>
              <th
                scope="col"
                data-type="number"
                aria-sort={sortCol === 6 ? sortDir : undefined}
              >
                <button type="button" onClick={() => handleSortClick(6)}>
                  <span>Total</span>
                  <span className="sort-indicator" aria-hidden="true" />
                </button>
              </th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                  {!selectedProfileId
                    ? 'Selecciona un RUC / Empresa arriba para ver los comprobantes de esa cuenta.'
                    : 'Todavía no hay comprobantes en esta vista. Descarga un período desde «Portal SRI».'}
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.claveAcceso}>
                  <td data-value={c.fechaEmisionIso} style={{ whiteSpace: 'nowrap' }}>
                    <time dateTime={c.fechaEmisionIso}>{c.fechaEmision}</time>
                  </td>
                  <td>
                    <span className="badge">{c.tipoNombre}</span>
                  </td>
                  <td data-value={c.razonSocialEmisor}>
                    <div style={{ fontWeight: 600 }}>{c.razonSocialEmisor || 'Sin razón social'}</div>
                    <div className="mono" style={{ color: 'var(--muted)' }}>
                      {c.rucEmisor}
                    </div>
                  </td>
                  <td className="mono" data-value={c.numeroComprobante}>
                    {c.numeroComprobante}
                  </td>
                  <td className="num-cell" data-value={String(c.totalSinImpuestos)}>
                    {fmtMoney(c.totalSinImpuestos)}
                  </td>
                  <td className="num-cell" data-value={String(c.iva)}>
                    {fmtMoney(c.iva)}
                  </td>
                  <td className="num-cell" style={{ fontWeight: 700 }} data-value={String(c.importeTotal)}>
                    {fmtMoney(c.importeTotal)}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {c.xmlPath && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          title="Abrir archivo XML oficial"
                          onClick={() => void window.faktum.openPathInExplorer(c.xmlPath)}
                        >
                          XML
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm"
                        title="Abrir PDF original del SRI (o bajarlo si el período está abierto)"
                        onClick={() => void handleOpenPdf(c.claveAcceso)}
                      >
                        PDF
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        title="Quitar del historial"
                        aria-label={`Quitar comprobante ${c.numeroComprobante} del historial`}
                        onClick={() => void handleDelete(c.claveAcceso)}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
