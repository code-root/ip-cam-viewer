import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { camerasApi } from '../api/client';

interface Props {
  cameraId: string;
  cameraName: string;
  canManage: boolean;
  onReconnect?: () => void;
  onDeleted?: () => void;
  onRenamed?: () => void;
}

export function CameraQuickActions({
  cameraId,
  cameraName,
  canManage,
  onReconnect,
  onDeleted,
  onRenamed,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const rename = async () => {
    const next = window.prompt(t('renameCameraPrompt'), cameraName);
    if (!next || next.trim() === cameraName) return;
    setBusy(true);
    try {
      await camerasApi.update(cameraId, { name: next.trim() });
      onRenamed?.();
      setOpen(false);
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(t('deleteCameraConfirm', { name: cameraName }))) return;
    setBusy(true);
    try {
      await camerasApi.delete(cameraId);
      onDeleted?.();
      setOpen(false);
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="camera-quick-actions" ref={rootRef}>
      <button
        type="button"
        className="btn btn-ghost btn-sm camera-quick-actions__trigger"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        disabled={busy}
        title={t('quickActions')}
        aria-expanded={open}
      >
        ⋮
      </button>
      {open && (
        <div className="camera-quick-actions__menu" role="menu" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onReconnect?.();
              setOpen(false);
            }}
          >
            {t('reconnectStream')}
          </button>
          {canManage && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  navigate(`/settings?edit=${cameraId}`);
                }}
              >
                {t('editCamera')}
              </button>
              <button type="button" role="menuitem" onClick={rename}>
                {t('renameCamera')}
              </button>
              <button type="button" role="menuitem" className="camera-quick-actions__danger" onClick={remove}>
                {t('delete')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
