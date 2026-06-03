const API = '/api';

function getToken() {
  return localStorage.getItem('accessToken');
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      headers.Authorization = `Bearer ${getToken()}`;
      const retry = await fetch(`${API}${path}`, { ...options, headers });
      if (!retry.ok) {
        const retryText = await retry.text();
        let retryErr = retry.statusText;
        try {
          if (retryText.trim()) retryErr = JSON.parse(retryText).error || retryErr;
        } catch { /* ignore */ }
        throw new Error(retryErr);
      }
      const retryText = await retry.text();
      if (!retryText.trim()) return {} as T;
      return JSON.parse(retryText) as T;
    }
    localStorage.clear();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  const text = await res.text();

  const parseJson = (): unknown => {
    if (!text.trim()) {
      if (!res.ok) {
        throw new Error(
          res.status === 502 || res.status === 503
            ? 'السيرفر غير متاح — شغّل npm run dev من مجلد المشروع'
            : `Empty response (HTTP ${res.status})`
        );
      }
      return {};
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Invalid server response (HTTP ${res.status})`);
    }
  };

  const body = parseJson() as Record<string, unknown>;

  if (!res.ok) {
    throw new Error(
      String(body.message || body.error || res.statusText || `HTTP ${res.status}`)
    );
  }

  return body as T;
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return false;
  try {
    const data = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).then((r) => r.json());
    if (data.accessToken) {
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

export const authApi = {
  login: (body: { username: string; password: string; totpCode?: string }) =>
    api<{ accessToken: string; refreshToken: string; user: { id: string; username: string; role: string }; idleTimeoutMinutes: number; requires2FA?: boolean }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify(body) }
    ),
  me: () => api<{ user: { id: string; username: string; role: string }; idleTimeoutMinutes: number }>('/auth/me'),
};

export interface Camera {
  id: string;
  name: string;
  host: string;
  onvifPort: number;
  username: string;
  rtspMain?: string;
  rtspSub?: string;
  supportsPtz: boolean;
  privacyMasks?: string;
  videoTransform?: string;
  enabled: boolean;
}

export const camerasApi = {
  list: () => api<{ cameras: Camera[] }>('/cameras'),
  get: (id: string) => api<{ camera: Camera }>(`/cameras/${id}`),
  create: (body: object) => api<{ camera: Camera }>('/cameras', { method: 'POST', body: JSON.stringify(body) }),
  testConnection: (body: {
    host: string;
    onvifPort: number;
    username: string;
    password?: string;
    rtspOverride?: string;
  }) =>
    api<{
      ok: boolean;
      info?: {
        manufacturer?: string;
        model?: string;
        rtspMain?: string;
        rtspSub?: string;
        supportsPtz: boolean;
        supportsAudio: boolean;
        note?: string;
      };
      auth?: { required: boolean; credentialsUsed: boolean };
      warning?: string;
      error?: string;
      message?: string;
      preview?: { streamName: string; streamToken: string };
      previewError?: string;
    }>('/cameras/test', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: object) => api<{ camera: Camera }>(`/cameras/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (id: string) => api(`/cameras/${id}`, { method: 'DELETE' }),
  discoverSubnets: () => api<{ subnets: string[] }>('/cameras/discover/subnets'),
  discover: (opts?: { subnet?: string; timeout?: number; subnetScan?: boolean }) => {
    const q = new URLSearchParams();
    if (opts?.subnet) q.set('subnet', opts.subnet);
    if (opts?.timeout) q.set('timeout', String(opts.timeout));
    if (opts?.subnetScan === false) q.set('subnetScan', 'false');
    const qs = q.toString();
    return api<{
      devices: Array<{
        host: string;
        port: number;
        name?: string;
        manufacturer?: string;
        source?: string;
        alreadyLinked: boolean;
        linkStatus: 'none' | 'exact' | 'host';
        linkedCameras: Array<{ id: string; name: string; onvifPort: number }>;
        exactMatches: Array<{ id: string; name: string; onvifPort: number }>;
      }>;
      scannedSubnets: string[];
      durationMs: number;
      subnetScan: boolean;
    }>(`/cameras/discover${qs ? `?${qs}` : ''}`);
  },
  reconcileDiscovery: (devices: Array<{ host: string; port: number; name?: string; manufacturer?: string; source?: string }>) =>
    api<{
      devices: Array<{
        host: string;
        port: number;
        name?: string;
        manufacturer?: string;
        source?: string;
        alreadyLinked: boolean;
        linkStatus: 'none' | 'exact' | 'host';
        linkedCameras: Array<{ id: string; name: string; onvifPort: number }>;
        exactMatches: Array<{ id: string; name: string; onvifPort: number }>;
      }>;
    }>('/cameras/discover/reconcile', { method: 'POST', body: JSON.stringify({ devices }) }),
  test: (id: string) =>
    api<{
      ok: boolean;
      info?: {
        manufacturer?: string;
        model?: string;
        rtspMain?: string;
        rtspSub?: string;
        supportsPtz: boolean;
        supportsAudio: boolean;
      };
      preview?: { streamName: string; streamToken: string };
      previewError?: string;
      error?: string;
    }>(`/cameras/${id}/test`, { method: 'POST' }),
  ptz: (id: string, body: object) => api(`/cameras/${id}/ptz`, { method: 'POST', body: JSON.stringify(body) }),
  presets: (id: string) => api<{ presets: Array<{ token: string; name?: string }> }>(`/cameras/${id}/presets`),
  gotoPreset: (id: string, token: string) =>
    api(`/cameras/${id}/presets`, { method: 'POST', body: JSON.stringify({ token }) }),
  snapshotUrl: (id: string) => `${API}/cameras/${id}/snapshot?token=${getToken()}`,
};

export const streamsApi = {
  start: (cameraId: string, quality: 'main' | 'sub' = 'sub') =>
    api<{ streamName: string; streamToken: string; urls: { hls: string; mjpeg: string; frame?: string; webrtc: string } }>(
      `/streams/${cameraId}/start`,
      { method: 'POST', body: JSON.stringify({ quality }) }
    ),
  stop: (cameraId: string) => api(`/streams/${cameraId}/stop`, { method: 'POST' }),
  health: (cameraId: string) => api<{ online: boolean }>(`/streams/${cameraId}/health`),
};

export type FaceAnalysisMode = 'people_only' | 'people_and_objects';

export const systemApi = {
  getFaceAnalysis: () => api<{ mode: FaceAnalysisMode }>('/system/face-analysis'),
  setFaceAnalysis: (mode: FaceAnalysisMode) =>
    api<{ mode: FaceAnalysisMode; ok: boolean }>('/system/face-analysis', {
      method: 'PUT',
      body: JSON.stringify({ mode }),
    }),
};

export const recordingsApi = {
  list: (cameraId?: string) => api<{ recordings: Array<{ id: string; filename: string; startedAt: string; camera: { name: string } }> }>(
    `/recordings${cameraId ? `?cameraId=${cameraId}` : ''}`
  ),
  start: (cameraId: string) => api(`/recordings/${cameraId}/start`, { method: 'POST' }),
  stop: (cameraId: string) => api(`/recordings/${cameraId}/stop`, { method: 'POST' }),
  status: (cameraId: string) => api<{ recording: boolean }>(`/recordings/${cameraId}/status`),
  streamUrl: (id: string) => `${API}/recordings/file/${id}/stream`,
};
