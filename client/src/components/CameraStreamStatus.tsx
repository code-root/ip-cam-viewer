import { useTranslation } from 'react-i18next';
import './CameraStreamStatus.css';

interface Props {
  online: boolean;
}

/** Wi‑Fi + live broadcast indicators (replaces online/offline text). */
export function CameraStreamStatus({ online }: Props) {
  const { t } = useTranslation();
  const label = online ? t('online') : t('offline');

  return (
    <span
      className={`stream-status ${online ? 'stream-status--online' : 'stream-status--offline'}`}
      title={label}
      aria-label={label}
      role="status"
    >
      <svg className="stream-status__wifi" viewBox="0 0 24 24" width="18" height="18" aria-hidden>
        <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M2 8.5c4.5-4 11.5-4 16 0" />
          <path d="M5.5 12c3-2.5 7.5-2.5 10.5 0" />
          <path d="M9 15.5c1.5-1.2 3.5-1.2 5 0" />
          <circle cx="12" cy="19" r="1.25" fill="currentColor" stroke="none" />
          {!online && <path d="M4 4l16 16" />}
        </g>
      </svg>
      {online && (
        <span className="stream-status__live" aria-hidden>
          <span className="stream-status__ring stream-status__ring--1" />
          <span className="stream-status__ring stream-status__ring--2" />
          <span className="stream-status__live-dot" />
        </span>
      )}
    </span>
  );
}
