import React, { useState } from 'react';
import { FolderOpen, FolderTree, ShieldCheck, Sparkles } from 'lucide-react';
import type { AppSettings } from '../../../shared/types';
import { FaktumSelect } from './FaktumSelect';

interface SettingsViewProps {
  settings: AppSettings;
  encryptionAvailable: boolean;
  onChange: (partial: Partial<AppSettings>) => Promise<void>;
  onChooseDir: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  encryptionAvailable,
  onChange,
  onChooseDir,
}) => {
  const [reorgMsg, setReorgMsg] = useState('');
  const [reorgBusy, setReorgBusy] = useState(false);

  const handleReorganize = async () => {
    setReorgBusy(true);
    setReorgMsg('');
    try {
      const res = await window.faktum.reorganizeDownloadedFiles();
      setReorgMsg(res.message);
    } finally {
      setReorgBusy(false);
    }
  };

  return (
    <div className="page-scroll">
      <div className="page-header">
        <div>
          <h1>Configuración</h1>
          <p>Personaliza carpetas, velocidad de descarga contra el SRI y automatizaciones.</p>
        </div>
      </div>

      <div className="card">
        <div className="settings-row">
          <div>
            <h3>Carpeta destino de comprobantes</h3>
            <p className="mono" style={{ marginTop: 6 }}>
              {settings.outputDir}
            </p>
            <p>
              Estructura automática:{' '}
              <strong>Razón Social (Tu RUC) / Año / Mes / XML, PDF o Excel / Tipo</strong>
            </p>
            {reorgMsg && (
              <div className="badge badge-success" style={{ marginTop: 8 }}>
                {reorgMsg}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn"
              disabled={reorgBusy}
              title="Mueve tus archivos anteriores a la nueva estructura por Razón Social y tipo de archivo"
              onClick={() => void handleReorganize()}
            >
              <FolderTree size={14} aria-hidden="true" />
              {reorgBusy ? 'Reorganizando...' : 'Reorganizar existentes'}
            </button>
            <button type="button" className="btn" onClick={() => void onChooseDir()}>
              Cambiar carpeta
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void window.faktum.openPathInExplorer(settings.outputDir)}
            >
              <FolderOpen size={14} aria-hidden="true" />
              Abrir
            </button>
          </div>
        </div>

        <div className="settings-row">
          <div>
            <h3>Velocidad de descarga (conexiones simultáneas al SRI)</h3>
            <p>
              Recomendado: 10 (descarga ~100 comprobantes en pocos segundos). Puedes subir hasta 20 si
              tienes buena conexión.
            </p>
          </div>
          <FaktumSelect
            ariaLabel="Descargas simultáneas"
            name="concurrency"
            minWidth={210}
            value={String(settings.concurrency)}
            options={[4, 6, 8, 10, 15, 20].map((n) => ({
              value: String(n),
              label:
                n === 10
                  ? '10 (Recomendado · Rápido)'
                  : n === 20
                    ? '20 (Máxima velocidad)'
                    : `${n} simultáneas`,
            }))}
            onChange={(val) => void onChange({ concurrency: Number(val) })}
          />
        </div>

        <div className="settings-row">
          <div>
            <h3>Formatos predeterminados al descargar</h3>
            <p>
              Elige qué archivos vienen marcados por defecto en el selector (siempre podrás cambiarlos en
              cada descarga).
            </p>
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.defaultDownloadXml}
                onChange={(e) => void onChange({ defaultDownloadXml: e.target.checked })}
              />
              XML (original SRI)
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.defaultDownloadPdf}
                onChange={(e) => void onChange({ defaultDownloadPdf: e.target.checked })}
              />
              PDF / RIDE (original SRI)
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.autoExportExcel}
                onChange={(e) => void onChange({ autoExportExcel: e.target.checked })}
              />
              Excel resumen (.xlsx)
            </label>
          </div>
        </div>

        <div className="settings-row">
          <div>
            <h3>Captura automática al consultar en el SRI</h3>
            <p>
              Apenas pulsas «Consultar» en el portal, Faktum captura el listado
              completo en memoria sin que tengas que descargar archivos `.txt`.
            </p>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.autoTriggerReportAfterSearch}
              onChange={(e) => void onChange({ autoTriggerReportAfterSearch: e.target.checked })}
            />
            Activado
          </label>
        </div>

        <div className="settings-row">
          <div>
            <h3>Almacenamiento cifrado de credenciales</h3>
            <p>
              {encryptionAvailable
                ? 'Activo mediante el llavero seguro nativo del sistema operativo (macOS Keychain / Windows DPAPI).'
                : 'El cifrado nativo del sistema no está disponible en este entorno; se usa almacenamiento local.'}
            </p>
          </div>
          <span className={`badge ${encryptionAvailable ? 'badge-success' : 'badge-warn'}`}>
            <ShieldCheck size={13} aria-hidden="true" />
            {encryptionAvailable ? 'Protegido' : 'Local'}
          </span>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Sparkles size={16} aria-hidden="true" style={{ color: 'var(--brand)' }} />
          <h3 style={{ margin: 0, fontSize: 15 }}>Próximas mejoras planificadas para Faktum</h3>
        </div>
        <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--muted)', fontSize: 13, lineHeight: 1.7 }}>
          <li>
            <strong>v2 (Incluido) — Generador automático de RIDE (PDF):</strong> elige XML, PDF (RIDE)
            y/o Excel en cada descarga o ábrelos directo desde Comprobantes.
          </li>
          <li>
            <strong>v3 — Sincronización por correo (Gmail / Outlook / IMAP):</strong> captura
            desatendida de facturas recibidas por email y cruce contra el SRI.
          </li>
          <li>
            <strong>v4 — Exportación para ATS y clasificación automática de gastos.</strong>
          </li>
        </ul>
      </div>
    </div>
  );
};
