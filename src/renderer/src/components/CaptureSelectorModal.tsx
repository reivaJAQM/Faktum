import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, Search, X } from 'lucide-react';
import type { CapturedBatchEvent, CapturedKeyEntry, DownloadFormats } from '../../../shared/types';

interface CaptureSelectorModalProps {
  open: boolean;
  batch: CapturedBatchEvent | null;
  defaultFormats: DownloadFormats;
  onClose: () => void;
  onConfirmDownload: (entries: CapturedKeyEntry[], formats: DownloadFormats) => Promise<void>;
}

function fmtMoney(n?: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const CaptureSelectorModal: React.FC<CaptureSelectorModalProps> = ({
  open,
  batch,
  defaultFormats,
  onClose,
  onConfirmDownload,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const searchId = useId();

  const [query, setQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [downloadXml, setDownloadXml] = useState(defaultFormats.xml);
  const [downloadPdf, setDownloadPdf] = useState(defaultFormats.pdf);
  const [downloadExcel, setDownloadExcel] = useState(defaultFormats.excel);
  const [starting, setStarting] = useState(false);

  // Initialize selection when a new batch opens: default to pending (not yet downloaded) items, or all if all are already downloaded
  useEffect(() => {
    if (!batch) return;
    const pending = batch.entries.filter((e) => !e.alreadyDownloaded).map((e) => e.claveAcceso);
    if (pending.length > 0) {
      setSelectedKeys(new Set(pending));
    } else {
      setSelectedKeys(new Set(batch.entries.map((e) => e.claveAcceso)));
    }
    setQuery('');
    setDownloadXml(defaultFormats.xml);
    setDownloadPdf(defaultFormats.pdf);
    setDownloadExcel(defaultFormats.excel);
  }, [batch, defaultFormats.xml, defaultFormats.pdf, defaultFormats.excel]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && batch) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open, batch]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      onClose();
    };
    dialog.addEventListener('close', handleClose);

    // Light-dismiss fallback when native `closedby` is unsupported
    let cleanupBackdrop: (() => void) | undefined;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (e: PointerEvent) => {
        const rect = dialog.getBoundingClientRect();
        return (
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
        );
      };
      const onDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      const onUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e)) dialog.close();
      };
      dialog.addEventListener('pointerdown', onDown);
      dialog.addEventListener('pointerup', onUp);
      cleanupBackdrop = () => {
        dialog.removeEventListener('pointerdown', onDown);
        dialog.removeEventListener('pointerup', onUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      cleanupBackdrop?.();
    };
  }, [onClose]);

  const entries = batch?.entries ?? [];

  const visibleEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      return (
        (e.razonSocialEmisor ?? '').toLowerCase().includes(q) ||
        (e.rucEmisor ?? '').includes(q) ||
        (e.serieComprobante ?? '').toLowerCase().includes(q) ||
        (e.tipoComprobante ?? '').toLowerCase().includes(q) ||
        (e.fechaEmision ?? '').includes(q) ||
        e.claveAcceso.includes(q)
      );
    });
  }, [entries, query]);

  const selectedEntries = useMemo(
    () => entries.filter((e) => selectedKeys.has(e.claveAcceso)),
    [entries, selectedKeys]
  );

  const selectedTotal = useMemo(
    () => selectedEntries.reduce((acc, e) => acc + (e.importeTotal ?? 0), 0),
    [selectedEntries]
  );

  const pendingCount = useMemo(
    () => entries.filter((e) => !e.alreadyDownloaded).length,
    [entries]
  );

  const toggleOne = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const e of visibleEntries) next.add(e.claveAcceso);
      return next;
    });
  };

  const selectOnlyPending = () => {
    setSelectedKeys(new Set(entries.filter((e) => !e.alreadyDownloaded).map((e) => e.claveAcceso)));
  };

  const clearSelection = () => {
    setSelectedKeys(new Set());
  };

  const anyFormatSelected = downloadXml || downloadPdf || downloadExcel;

  const handleConfirm = async () => {
    if (selectedEntries.length === 0 || !anyFormatSelected) return;
    setStarting(true);
    try {
      await onConfirmDownload(selectedEntries, {
        xml: downloadXml,
        pdf: downloadPdf,
        excel: downloadExcel,
      });
      dialogRef.current?.close();
    } finally {
      setStarting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog-wide"
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="dialog-header">
        <div>
          <h1 id={titleId}>
            Seleccionar comprobantes para descargar ({entries.length} encontrados)
          </h1>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
            RUC {batch?.ownerRuc} · {pendingCount} pendientes · {entries.length - pendingCount} ya
            descargados
          </div>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          aria-label="Cerrar selector"
          onClick={() => dialogRef.current?.close()}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="dialog-body" style={{ gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 240, display: 'flex', alignItems: 'center' }}>
            <Search
              size={14}
              aria-hidden="true"
              style={{ position: 'absolute', left: 10, color: 'var(--muted)' }}
            />
            <input
              id={searchId}
              type="search"
              autoFocus
              aria-label="Filtrar comprobantes capturados"
              placeholder="Filtrar por proveedor, RUC, número, fecha o tipo..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                width: '100%',
                height: 34,
                padding: '0 10px 0 32px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                fontSize: 13,
              }}
            />
          </div>

          <button type="button" className="btn btn-sm" onClick={selectAllVisible}>
            Marcar visibles ({visibleEntries.length})
          </button>
          <button type="button" className="btn btn-sm" onClick={selectOnlyPending}>
            Solo pendientes ({pendingCount})
          </button>
          <button type="button" className="btn btn-sm" onClick={clearSelection}>
            Limpiar
          </button>
        </div>

        <div className="selector-table-wrap">
          <table className="data-table" style={{ minInlineSize: 720 }}>
            <thead>
              <tr>
                <th scope="col" style={{ width: 40, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    aria-label="Seleccionar o deseleccionar todos los visibles"
                    checked={
                      visibleEntries.length > 0 &&
                      visibleEntries.every((e) => selectedKeys.has(e.claveAcceso))
                    }
                    onChange={(ev) => {
                      if (ev.target.checked) selectAllVisible();
                      else {
                        setSelectedKeys((prev) => {
                          const next = new Set(prev);
                          for (const e of visibleEntries) next.delete(e.claveAcceso);
                          return next;
                        });
                      }
                    }}
                  />
                </th>
                <th scope="col">Fecha</th>
                <th scope="col">Tipo</th>
                <th scope="col">Emisor</th>
                <th scope="col">Número</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Total
                </th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
                    Ningún comprobante coincide con «{query}».
                  </td>
                </tr>
              ) : (
                visibleEntries.map((entry) => {
                  const checked = selectedKeys.has(entry.claveAcceso);
                  return (
                    <tr
                      key={entry.claveAcceso}
                      onClick={() => toggleOne(entry.claveAcceso)}
                      style={{
                        cursor: 'pointer',
                        background: checked ? 'var(--surface-2)' : undefined,
                      }}
                    >
                      <td
                        style={{ textAlign: 'center' }}
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${entry.razonSocialEmisor || entry.rucEmisor || entry.claveAcceso}`}
                          checked={checked}
                          onChange={() => toggleOne(entry.claveAcceso)}
                        />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{entry.fechaEmision || '—'}</td>
                      <td>
                        <span className="badge">{entry.tipoComprobante || 'Comprobante'}</span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>
                          {entry.razonSocialEmisor || 'Emisor SRI'}
                        </div>
                        <div className="mono" style={{ color: 'var(--muted)' }}>
                          {entry.rucEmisor || ''}
                        </div>
                      </td>
                      <td className="mono">{entry.serieComprobante || '—'}</td>
                      <td className="num-cell" style={{ fontWeight: 600 }}>
                        {fmtMoney(entry.importeTotal)}
                      </td>
                      <td>
                        {entry.alreadyDownloaded ? (
                          <span className="badge badge-success">
                            <CheckCircle2 size={11} aria-hidden="true" />
                            Descargado
                          </span>
                        ) : (
                          <span className="badge badge-warn">Pendiente</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="dialog-footer" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>Formatos:</span>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={downloadXml}
                onChange={(e) => setDownloadXml(e.target.checked)}
              />
              XML (original SRI)
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={downloadPdf}
                onChange={(e) => setDownloadPdf(e.target.checked)}
              />
              PDF / RIDE (original SRI)
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={downloadExcel}
                onChange={(e) => setDownloadExcel(e.target.checked)}
              />
              Excel resumen (.xlsx)
            </label>
          </div>
          <span style={{ fontSize: 12, color: anyFormatSelected ? 'var(--muted)' : 'var(--danger)' }}>
            {anyFormatSelected ? (
              <>
                Seleccionados: <strong>{selectedEntries.length}</strong>
                {selectedTotal > 0 ? ` · Total aprox. ${fmtMoney(selectedTotal)}` : ''}
              </>
            ) : (
              'Marca al menos un formato (XML, PDF o Excel) para descargar.'
            )}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="btn"
            onClick={() => dialogRef.current?.close()}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={selectedEntries.length === 0 || !anyFormatSelected || starting}
            onClick={() => void handleConfirm()}
          >
            <Download size={14} aria-hidden="true" />
            {starting
              ? 'Iniciando...'
              : `Descargar seleccionados (${selectedEntries.length})`}
          </button>
        </div>
      </div>
    </dialog>
  );
};
