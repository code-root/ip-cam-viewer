import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { camerasApi, type Camera } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { TestStreamPreview } from '../components/TestStreamPreview';
import { CameraEditForm } from '../components/CameraEditForm';
import { CameraQuickActions } from '../components/CameraQuickActions';
import { useUrlQuery } from '../hooks/useUrlQuery';
import '../components/CameraQuickActions.css';

type DiscoveredDevice = Awaited<ReturnType<typeof camerasApi.discover>>['devices'][number];

export function Settings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const url = useUrlQuery();
  const editId = url.get('edit');
  const { data } = useQuery({ queryKey: ['cameras'], queryFn: camerasApi.list });
  const [form, setForm] = useState({ name: '', host: '', onvifPort: 80, username: 'admin', password: '', rtspOverride: '' });
  const [discovering, setDiscovering] = useState(false);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [discoverSubnet, setDiscoverSubnet] = useState('');
  const [discoverMeta, setDiscoverMeta] = useState<{ scannedSubnets: string[]; durationMs: number } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    details?: string[];
    warning?: string;
  } | null>(null);
  const [previewStream, setPreviewStream] = useState<string | null>(null);
  const canManage = user?.role === 'admin';

  useEffect(() => {
    setTestResult(null);
    setPreviewStream(null);
  }, [form.host, form.onvifPort, form.username, form.password, form.rtspOverride]);

  useEffect(() => {
    if (!canManage) return;
    camerasApi
      .discoverSubnets()
      .then((r) => {
        if (r.subnets[0]) setDiscoverSubnet((prev) => prev || r.subnets[0]);
      })
      .catch(() => {});
  }, [canManage]);

  const create = useMutation({
    mutationFn: () => camerasApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cameras'] });
      setForm({ name: '', host: '', onvifPort: 80, username: 'admin', password: '', rtspOverride: '' });
      void refreshDiscoveryLinks();
    },
  });

  const discoverOpts = () => ({
    subnet: discoverSubnet.trim() || undefined,
    timeout: 12000,
    subnetScan: true,
  });

  /** Instant update of linked/new badges — no network rescan. */
  const refreshDiscoveryLinks = async () => {
    if (devices.length === 0) return;
    try {
      const r = await camerasApi.reconcileDiscovery(
        devices.map((d) => ({
          host: d.host,
          port: d.port,
          name: d.name,
          manufacturer: d.manufacturer,
          source: d.source,
        }))
      );
      setDevices(r.devices);
    } catch {
      /* keep previous list */
    }
  };

  const discover = async () => {
    setDiscovering(true);
    setDiscoverMeta(null);
    try {
      const r = await camerasApi.discover(discoverOpts());
      setDevices(r.devices);
      setDiscoverMeta({ scannedSubnets: r.scannedSubnets, durationMs: r.durationMs });
    } catch (e) {
      alert(String(e));
    } finally {
      setDiscovering(false);
    }
  };

  const applyDevice = (d: DiscoveredDevice) => {
    if (d.linkStatus === 'exact') return;
    setForm({ ...form, host: d.host, onvifPort: d.port, name: d.name || d.host });
    setTestResult(null);
    setPreviewStream(null);
  };

  const testFormConnection = async () => {
    if (!form.host.trim()) {
      setTestResult({ ok: false, message: t('testNeedsHost') });
      return;
    }
    setTesting(true);
    setTestResult(null);
    setPreviewStream(null);
    try {
      const r = await camerasApi.testConnection({
        host: form.host.trim(),
        onvifPort: form.onvifPort || 80,
        username: form.username,
        password: form.password || undefined,
        rtspOverride: form.rtspOverride || undefined,
      });
      const info = r.info;
      const details: string[] = [];
      if (r.auth) {
        if (!r.auth.required) details.push(t('testAuthNotRequired'));
        else if (r.auth.credentialsUsed) details.push(t('testAuthUsed'));
        else details.push(t('testAuthRequired'));
      }
      if (info?.manufacturer || info?.model) {
        details.push(`${t('testManufacturer')}: ${[info.manufacturer, info.model].filter(Boolean).join(' ')}`);
      }
      if (info?.rtspMain) details.push(`${t('testRtspMain')}: ${info.rtspMain}`);
      if (info?.rtspSub) details.push(`${t('testRtspSub')}: ${info.rtspSub}`);
      if (info?.supportsPtz) details.push(`${t('testPtz')}: ✓`);
      if (r.preview?.streamName) {
        setPreviewStream(r.preview.streamName);
      } else if (r.previewError) {
        details.push(`${t('testPreviewFailed')}: ${r.previewError}`);
      }
      setTestResult({
        ok: true,
        message: t('testConnectionOk'),
        details: details.length ? details : undefined,
        warning: r.warning,
      });
    } catch (e) {
      setPreviewStream(null);
      const err = e as Error & { message?: string };
      const msg = err.message || String(e);
      const details: string[] = [msg];
      if (
        msg.includes('AUTH_REQUIRED') ||
        /requires login/i.test(msg) ||
        (/authority failure/i.test(msg) && !form.password)
      ) {
        details.unshift(t('testAuthRequired'), t('testAuthRequiredHint'));
      } else if (
        msg.includes('AUTH_FAILED') ||
        /invalid username/i.test(msg) ||
        /authority failure/i.test(msg)
      ) {
        details.unshift(t('testAuthFailed'), t('testOnvifPortHint'));
      }
      setTestResult({ ok: false, message: t('testConnectionFail'), details });
    } finally {
      setTesting(false);
    }
  };

  const discoverStatus =
    discovering
      ? t('discoverScanning')
      : discoverMeta
        ? t('discoverFound', {
            count: devices.length,
            sec: (discoverMeta.durationMs / 1000).toFixed(1),
          })
        : null;

  return (
    <div>
      <h2>{t('settings')}</h2>
      {canManage && (
        <>
          <div className="card add-camera-card" style={{ marginBottom: '1rem' }}>
            <h3>{t('addCamera')}</h3>
            <div className="add-camera-grid">
              <div className="add-camera-form">
                <div className="form-group">
                  <label>Name</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Host</label>
                  <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>ONVIF Port</label>
                  <input type="number" value={form.onvifPort} onChange={(e) => setForm({ ...form, onvifPort: parseInt(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>{t('username')}</label>
                  <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>{t('password')}</label>
                  <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                  <p className="form-hint">{t('passwordOptionalForTest')}</p>
                </div>
                <div className="form-group">
                  <label>RTSP Override (optional)</label>
                  <input value={form.rtspOverride} onChange={(e) => setForm({ ...form, rtspOverride: e.target.value })} placeholder="rtsp://..." />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                  <button type="button" className="btn" onClick={() => create.mutate()} disabled={create.isPending}>
                    {t('save')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={testFormConnection}
                    disabled={testing || !form.host.trim()}
                  >
                    {testing ? t('testingConnection') : t('testConnection')}
                  </button>
                </div>
                {testResult && (
                  <div
                    className={`test-result ${testResult.ok ? 'test-result--ok' : 'test-result--fail'}`}
                    role="status"
                  >
                    <strong>{testResult.message}</strong>
                    {testResult.warning && (
                      <p className="form-hint">
                        {t('testWarning')}: {testResult.warning}
                      </p>
                    )}
                    {testResult.details?.map((line) => (
                      <p key={line} className="form-hint" dir="ltr" style={{ wordBreak: 'break-all' }}>
                        {line}
                      </p>
                    ))}
                  </div>
                )}
              </div>
              {(previewStream || testing) && (
                <div className="add-camera-preview">
                  {testing && !previewStream ? (
                    <div className="test-preview-panel">
                      <h4 className="test-preview-title">{t('testPreview')}</h4>
                      <div className="test-preview-box test-preview-box--loading">
                        <span>{t('testingConnection')}</span>
                      </div>
                    </div>
                  ) : (
                    <TestStreamPreview streamName={previewStream} />
                  )}
                </div>
              )}
            </div>
            <div className="form-group" style={{ marginTop: '0.75rem' }}>
              <label>{t('discoverSubnet')}</label>
              <input
                value={discoverSubnet}
                onChange={(e) => setDiscoverSubnet(e.target.value)}
                placeholder="192.168.1.0/24"
                dir="ltr"
              />
              <p className="form-hint">{t('discoverSubnetHint')}</p>
              <p className="form-hint">{t('discoverExpanded')}</p>
            </div>
            <button type="button" className="btn btn-ghost" style={{ marginRight: '0.5rem' }} onClick={discover} disabled={discovering}>
              {discovering ? t('discoverScanning') : t('discover')}
            </button>
            {discoverStatus && <p className="form-hint" style={{ marginTop: '0.5rem' }}>{discoverStatus}</p>}
          </div>
          {devices.length > 0 && (
            <div className="card" style={{ marginBottom: '1rem' }}>
              <h4>{t('discovered')}</h4>
              {discoverMeta?.scannedSubnets.length ? (
                <p className="form-hint" dir="ltr">
                  {discoverMeta.scannedSubnets.join(', ')}
                </p>
              ) : null}
              <ul className="discover-list">
                {devices.map((d) => (
                  <DiscoveredRow key={`${d.host}:${d.port}`} device={d} onApply={() => applyDevice(d)} t={t} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="card">
        <h3>{t('cameras')}</h3>
        <ul style={{ listStyle: 'none' }}>
          {data?.cameras.map((c) => (
            <CameraRow
              key={c.id}
              camera={c}
              canManage={!!canManage}
              editing={editId === c.id}
              onEdit={() => url.set({ edit: c.id })}
              onCloseEdit={() => url.set({ edit: null })}
              onDelete={async (cameraId) => {
                await camerasApi.delete(cameraId);
                if (editId === cameraId) url.set({ edit: null });
                await qc.invalidateQueries({ queryKey: ['cameras'] });
                await refreshDiscoveryLinks();
              }}
              onSaved={async () => {
                url.set({ edit: null });
                await qc.invalidateQueries({ queryKey: ['cameras'] });
                await refreshDiscoveryLinks();
              }}
              t={t}
            />
          ))}
        </ul>
      </div>
      <ThemeToggle />
    </div>
  );
}

function linkBadge(device: DiscoveredDevice, t: (k: string) => string) {
  if (device.linkStatus === 'exact') {
    return <span className="badge badge-linked">{t('deviceLinked')}</span>;
  }
  if (device.linkStatus === 'host') {
    return <span className="badge badge-linked-port">{t('deviceLinkedOtherPort')}</span>;
  }
  return <span className="badge badge-new">{t('deviceNew')}</span>;
}

function DiscoveredRow({
  device: d,
  onApply,
  t,
}: {
  device: DiscoveredDevice;
  onApply: () => void;
  t: (k: string) => string;
}) {
  const isExact = d.linkStatus === 'exact';
  const matches = d.exactMatches.length > 0 ? d.exactMatches : d.linkedCameras;

  return (
    <li className={`discover-item ${isExact ? 'discover-item--linked' : ''}`}>
      <div className="discover-item__main">
        <span className="discover-item__title">{d.name || d.host}</span>
        <span className="discover-item__addr">
          {d.host}:{d.port}
        </span>
        {linkBadge(d, t)}
      </div>
      {matches.length > 0 && (
        <p className="discover-item__meta">
          {t('deviceLinkedAs')}{' '}
          {matches.map((c) => `${c.name} (${c.onvifPort})`).join(' · ')}
        </p>
      )}
      {isExact ? (
        <p className="discover-item__hint">{t('alreadyLinkedHint')}</p>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onApply}>
          {t('fillForm')}
        </button>
      )}
    </li>
  );
}

function CameraRow({
  camera: c,
  canManage,
  editing,
  onEdit,
  onCloseEdit,
  onDelete,
  onSaved,
  t,
}: {
  camera: Camera;
  canManage: boolean;
  editing: boolean;
  onEdit: () => void;
  onCloseEdit: () => void;
  onDelete: (cameraId: string) => Promise<void>;
  onSaved: () => void;
  t: (k: string) => string;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  const [testing, setTesting] = useState(false);
  const [previewStream, setPreviewStream] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (editing) rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [editing]);

  const runTest = async () => {
    setTesting(true);
    setPreviewStream(null);
    setTestResult(null);
    try {
      const r = await camerasApi.test(c.id);
      if (r.preview?.streamName) setPreviewStream(r.preview.streamName);
      setTestResult({ ok: true, message: t('testConnectionOk') });
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <li ref={rowRef} className={`camera-row ${editing ? 'camera-row--editing' : ''}`}>
      <div className="camera-row__header">
        <span>
          {c.name} — {c.host}
          <span className="discover-item__addr" style={{ marginRight: '0.5rem' }}>
            :{c.onvifPort}
          </span>
        </span>
        <span className="camera-row__actions">
          <button type="button" className="btn btn-ghost" onClick={runTest} disabled={testing}>
            {testing ? t('testingConnection') : t('testConnection')}
          </button>
          <CameraQuickActions
            cameraId={c.id}
            cameraName={c.name}
            canManage={canManage}
            onReconnect={() => setReloadKey((k) => k + 1)}
            onDeleted={() => onDelete(c.id)}
            onRenamed={onSaved}
          />
        </span>
      </div>
      {editing && canManage && (
        <div className="camera-row__edit">
          <h4>{t('editCamera')}</h4>
          <CameraEditForm camera={c} onSaved={onSaved} onCancel={onCloseEdit} />
        </div>
      )}
      {!editing && canManage && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: '0.35rem' }} onClick={onEdit}>
          {t('editCamera')}
        </button>
      )}
      {testResult && (
        <p className={`form-hint ${testResult.ok ? 'test-result--ok-inline' : 'test-result--fail-inline'}`}>
          {testResult.message}
        </p>
      )}
      {previewStream && (
        <div className="camera-row__preview">
          <TestStreamPreview streamName={previewStream} reloadKey={reloadKey} />
        </div>
      )}
    </li>
  );
}

function ThemeToggle() {
  const { t } = useTranslation();
  const toggle = () => {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    html.setAttribute('data-theme', next === 'light' ? 'light' : '');
    localStorage.setItem('theme', next);
  };
  return (
    <button type="button" className="btn btn-ghost" style={{ marginTop: '1rem' }} onClick={toggle}>
      {t('theme')}
    </button>
  );
}
