import React, { useEffect, useId, useRef, useState } from 'react';
import { Lock, Pencil, PlugZap, Plus, Trash2, Unlock } from 'lucide-react';
import type { RucProfile } from '../../../shared/types';

interface ProfilesViewProps {
  profiles: RucProfile[];
  encryptionAvailable: boolean;
  onAdd: () => void;
  onEdit: (profile: RucProfile) => void;
  onUseInPortal: (profile: RucProfile) => void;
  onDeleted: () => void;
  onConfirmModalChange: (open: boolean) => void;
}

export const ProfilesView: React.FC<ProfilesViewProps> = ({
  profiles,
  encryptionAvailable,
  onAdd,
  onEdit,
  onUseInPortal,
  onDeleted,
  onConfirmModalChange,
}) => {
  const [confirmTarget, setConfirmTarget] = useState<RucProfile | null>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);
  const confirmTitleId = useId();

  useEffect(() => {
    const isOpen = Boolean(confirmTarget);
    onConfirmModalChange(isOpen);
    const dialog = confirmDialogRef.current;
    if (!dialog) return;
    if (isOpen) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [confirmTarget, onConfirmModalChange]);

  useEffect(() => {
    const dialog = confirmDialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      const choice = dialog.returnValue;
      dialog.returnValue = '';
      const target = confirmTarget;
      setConfirmTarget(null);
      if (choice === 'delete' && target) {
        void window.faktum.deleteProfile(target.id).then(onDeleted);
      }
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [confirmTarget, onDeleted]);

  return (
    <div className="page-scroll">
      <div className="page-header">
        <div>
          <h1>Perfiles Multi-RUC</h1>
          <p>
            Administra todos tus RUC o empresas en un solo lugar. Cada perfil mantiene su propia sesión
            del SRI y carpetas independientes.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onAdd}>
          <Plus size={15} aria-hidden="true" />
          Nuevo perfil RUC
        </button>
      </div>

      {profiles.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 36 }}>
          <h2 style={{ marginTop: 0 }}>Aún no tienes perfiles registrados</h2>
          <p style={{ color: 'var(--muted)', maxWidth: 460, margin: '8px auto 18px' }}>
            Agrega tu primer RUC y su clave de acceso del SRI para empezar a descargar facturas
            masivamente.
          </p>
          <button type="button" className="btn btn-primary" onClick={onAdd}>
            <Plus size={15} aria-hidden="true" />
            Agregar mi primer RUC
          </button>
        </div>
      ) : (
        <div className="profiles-grid">
          {profiles.map((p) => (
            <div key={p.id} className="card profile-card">
              <div className="profile-card-head">
                <div>
                  <h2>{p.alias}</h2>
                  <div className="profile-ruc">RUC: {p.ruc}</div>
                </div>
                {p.hasPassword ? (
                  <span className="badge badge-success">
                    <Lock size={11} aria-hidden="true" />
                    {encryptionAvailable ? 'Clave cifrada' : 'Clave guardada'}
                  </span>
                ) : (
                  <span className="badge badge-warn">
                    <Unlock size={11} aria-hidden="true" />
                    Sin clave
                  </span>
                )}
              </div>

              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Última descarga:{' '}
                {p.lastSyncAt
                  ? new Date(p.lastSyncAt).toLocaleString('es-EC')
                  : 'Sin descargas todavía'}
              </div>

              <div className="profile-actions">
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => onUseInPortal(p)}
                >
                  <PlugZap size={13} aria-hidden="true" />
                  Usar en SRI
                </button>
                <button type="button" className="btn btn-sm" onClick={() => onEdit(p)}>
                  <Pencil size={13} aria-hidden="true" />
                  Editar
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  aria-label={`Eliminar perfil ${p.alias}`}
                  onClick={() => setConfirmTarget(p)}
                >
                  <Trash2 size={13} aria-hidden="true" />
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Native confirmation modal with autofocus on the safe action (Cancel) */}
      <dialog ref={confirmDialogRef} aria-labelledby={confirmTitleId}>
        <div className="dialog-header">
          <h1 id={confirmTitleId}>¿Eliminar este perfil RUC?</h1>
        </div>
        <div className="dialog-body">
          <p style={{ margin: 0, fontSize: 14 }}>
            Se eliminarán el perfil <strong>{confirmTarget?.alias}</strong> ({confirmTarget?.ruc}) y su
            clave cifrada de Faktum. Los archivos XML y Excel ya descargados en tu disco no se borran.
          </p>
        </div>
        <form method="dialog" className="dialog-footer">
          <button type="submit" value="cancel" className="btn" autoFocus>
            Cancelar
          </button>
          <button type="submit" value="delete" className="btn btn-danger">
            Eliminar perfil
          </button>
        </form>
      </dialog>
    </div>
  );
};
