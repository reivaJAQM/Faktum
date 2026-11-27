import React, { useEffect, useId, useRef, useState } from 'react';
import { Lock, X } from 'lucide-react';
import type { RucProfile, RucProfileInput } from '../../../shared/types';

interface ProfileModalProps {
  open: boolean;
  editing: RucProfile | null;
  encryptionAvailable: boolean;
  onClose: () => void;
  onSaved: (profile: RucProfile) => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  open,
  editing,
  encryptionAvailable,
  onClose,
  onSaved,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const rucId = useId();
  const rucHintId = useId();
  const rucErrId = useId();
  const aliasId = useId();
  const aliasHintId = useId();
  const aliasErrId = useId();
  const passId = useId();
  const passHintId = useId();

  const [ruc, setRuc] = useState('');
  const [alias, setAlias] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      setRuc(editing?.ruc ?? '');
      setAlias(editing?.alias ?? '');
      setPassword('');
      setSubmitError('');
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open, editing]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      onClose();
    };
    dialog.addEventListener('close', handleClose);

    // Light-dismiss fallback when native `closedby` is unsupported (Chromium < 134)
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
        if (pressedOutside && isOutside(e)) {
          dialog.close();
        }
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

  const syncAriaValidity = (el: HTMLInputElement) => {
    const invalid = el.matches(':user-invalid');
    el.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    const errId = el.dataset.error;
    if (!errId) return;
    const baseHint = el.dataset.hint ?? '';
    const ids = [baseHint, invalid ? errId : ''].filter(Boolean);
    if (ids.length > 0) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError('');

    const form = e.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    setSaving(true);
    try {
      const payload: RucProfileInput = {
        id: editing?.id,
        ruc: ruc.trim(),
        alias: alias.trim(),
        password: password || undefined,
      };
      const saved = await window.faktum.saveProfile(payload);
      onSaved(saved);
      dialogRef.current?.close();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Error al guardar el perfil.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="dialog-header">
        <h1 id={titleId}>{editing ? 'Editar perfil RUC' : 'Agregar perfil RUC'}</h1>
        <button
          type="button"
          className="btn btn-sm"
          aria-label="Cerrar diálogo"
          onClick={() => dialogRef.current?.close()}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div className="dialog-body">
          <div className="field">
            <label htmlFor={rucId}>Número de RUC</label>
            <span id={rucHintId} className="hint">
              13 dígitos numéricos del contribuyente (termina en 001).
            </span>
            <input
              id={rucId}
              type="text"
              inputMode="numeric"
              required
              pattern="\d{13}"
              minLength={13}
              maxLength={13}
              placeholder="1790012345001"
              value={ruc}
              autoFocus
              aria-invalid="false"
              aria-describedby={rucHintId}
              data-hint={rucHintId}
              data-error={rucErrId}
              onChange={(e) => {
                setRuc(e.target.value.replace(/\D/g, '').slice(0, 13));
                syncAriaValidity(e.currentTarget);
              }}
              onBlur={(e) => syncAriaValidity(e.currentTarget)}
            />
            <div id={rucErrId} className="error-msg">
              <span role="img" aria-label="Error">
                ⚠️
              </span>{' '}
              Ingresa un RUC válido de exactamente 13 dígitos numéricos.
            </div>
          </div>

          <div className="field">
            <label htmlFor={aliasId}>Nombre o Razón Social</label>
            <span id={aliasHintId} className="hint">
              Se usará para identificar este RUC y nombrar su carpeta de descargas.
            </span>
            <input
              id={aliasId}
              type="text"
              required
              minLength={2}
              placeholder="Ej. Mi Empresa S.A. / Cliente Principal"
              value={alias}
              aria-invalid="false"
              aria-describedby={aliasHintId}
              data-hint={aliasHintId}
              data-error={aliasErrId}
              onChange={(e) => {
                setAlias(e.target.value);
                syncAriaValidity(e.currentTarget);
              }}
              onBlur={(e) => syncAriaValidity(e.currentTarget)}
            />
            <div id={aliasErrId} className="error-msg">
              <span role="img" aria-label="Error">
                ⚠️
              </span>{' '}
              Ingresa un nombre de al menos 2 caracteres.
            </div>
          </div>

          <div className="field">
            <label htmlFor={passId}>
              Clave de acceso SRI en Línea{' '}
              {editing?.hasPassword ? '(dejar vacío para mantener la actual)' : '(opcional)'}
            </label>
            <span id={passHintId} className="hint">
              {encryptionAvailable
                ? 'Se cifra localmente con el llavero seguro del sistema operativo (Keychain / DPAPI).'
                : 'Se guarda localmente solo en tu equipo para autocompletar el acceso al SRI.'}
            </span>
            <input
              id={passId}
              type="password"
              autoComplete="current-password"
              placeholder={editing?.hasPassword ? '••••••••••••' : 'Tu clave del portal SRI'}
              value={password}
              aria-describedby={passHintId}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="badge badge-success" style={{ alignSelf: 'flex-start' }}>
            <Lock size={12} aria-hidden="true" />
            Credenciales 100 % locales — nunca se envían fuera de tu equipo
          </div>

          {submitError && (
            <div className="badge badge-danger" role="alert">
              {submitError}
            </div>
          )}
        </div>

        <div className="dialog-footer">
          <button
            type="button"
            className="btn"
            onClick={() => dialogRef.current?.close()}
          >
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Guardar perfil'}
          </button>
        </div>
      </form>
    </dialog>
  );
};
