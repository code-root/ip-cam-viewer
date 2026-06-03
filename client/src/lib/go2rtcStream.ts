/**
 * Minimal go2rtc WebSocket player (webrtc → mse → mjpeg).
 * Based on go2rtc video-rtc.js (MIT).
 */

export type Go2rtcStreamCallbacks = {
  onOnline?: () => void;
  onOffline?: () => void;
};

/** Target live edge buffer (seconds) for MSE fallback — minimal = lower latency. */
const MSE_LIVE_BUFFER_SEC = 0.12;
/** If playback lags behind live edge by more than this, jump forward (WebRTC/MSE). */
const LIVE_EDGE_MAX_LAG_SEC = 0.25;
const LIVE_EDGE_SYNC_MS = 400;
const WS_CONNECT_TIMEOUT_MS = 8000;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;
const FREEZE_CAPTURE_MIN_MS = 4000;
const MJPEG_FRAME_MIN_MS = 250;

const freezeLastCapture = new WeakMap<HTMLImageElement, number>();
const freezeBlobUrl = new WeakMap<HTMLImageElement, string>();

/** LAN: skip STUN for faster WebRTC setup; use STUN on remote hosts. */
function iceServersForHost(): RTCIceServer[] {
  const h = location.hostname;
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    /^192\.168\./.test(h) ||
    /^10\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  ) {
    return [];
  }
  return [{ urls: ['stun:stun.l.google.com:19302'] }];
}

function resolveGo2rtcWsBase(): string {
  const env = import.meta.env.VITE_GO2RTC_WS as string | undefined;
  if (env) return env.replace(/\/$/, '');
  // Same host as the UI (Vite /go2rtc proxy in dev, reverse proxy in prod).
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/go2rtc`;
}

export class Go2rtcStream {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private mseCodecs = '';
  private ondata: ((data: ArrayBuffer) => void) | null = null;
  private onmessage: Record<string, (msg: { type: string; value: string }) => void> = {};
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsConnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private liveViaRtc = false;
  private wsEverOpened = false;
  private failCount = 0;
  private mjpegLastAt = 0;
  private mjpegBlobUrl: string | null = null;
  private liveEdgeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly streamName: string,
    private readonly callbacks: Go2rtcStreamCallbacks = {}
  ) {}

  start() {
    this.stopped = false;
    this.failCount = 0;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.liveViaRtc = false;
    this.failCount = 0;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.wsConnectTimer) clearTimeout(this.wsConnectTimer);
    if (this.mjpegBlobUrl) {
      URL.revokeObjectURL(this.mjpegBlobUrl);
      this.mjpegBlobUrl = null;
    }
    this.stopLiveEdgeSync();
    this.disconnect();
  }

  /** Capture current video frame to freeze <img> (throttled; blob URL, not base64). */
  static captureToImage(
    video: HTMLVideoElement,
    target: HTMLImageElement,
    options?: { force?: boolean }
  ) {
    if (video.videoWidth === 0 || video.videoHeight === 0) return;
    const now = Date.now();
    const last = freezeLastCapture.get(target) ?? 0;
    if (!options?.force && now - last < FREEZE_CAPTURE_MIN_MS) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const prev = freezeBlobUrl.get(target);
        if (prev) URL.revokeObjectURL(prev);
        const url = URL.createObjectURL(blob);
        freezeBlobUrl.set(target, url);
        freezeLastCapture.set(target, Date.now());
        target.src = url;
      },
      'image/jpeg',
      0.82
    );
  }

  private wsUrl() {
    return `${resolveGo2rtcWsBase()}/api/ws?src=${encodeURIComponent(this.streamName)}`;
  }

  private connect() {
    if (this.stopped) return;
    if (this.ws) return;
    this.wsEverOpened = false;
    const ws = new WebSocket(this.wsUrl());
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    this.wsConnectTimer = setTimeout(() => {
      if (!this.wsEverOpened && !this.stopped) {
        ws.close();
      }
    }, WS_CONNECT_TIMEOUT_MS);

    ws.addEventListener('open', () => {
      this.wsEverOpened = true;
      this.failCount = 0;
      if (this.wsConnectTimer) clearTimeout(this.wsConnectTimer);
      this.onWsOpen();
    });
    ws.addEventListener('close', () => this.onWsClose());
    ws.addEventListener('error', () => ws.close());
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.failCount += 1;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** (this.failCount - 1),
      RECONNECT_MAX_MS
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.disconnectPc();
      this.connect();
    }, delay);
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private onWsOpen() {
    this.ondata = null;
    this.onmessage = {};

    const modes: string[] = [];

    if ('RTCPeerConnection' in window) {
      modes.push('webrtc');
      this.startWebRtc();
    } else if ('MediaSource' in window || 'ManagedMediaSource' in window) {
      modes.push('mse');
      this.startMse();
    } else {
      modes.push('mjpeg');
      this.startWsMjpeg();
    }

    if (modes.length > 1) {
      this.onmessage.fallback = (msg) => {
        if (msg.type !== 'error') return;
        if (msg.value.indexOf(modes[0]) !== 0) return;
        if (modes.includes('mse') && !this.pc) this.startMse();
        else if (modes.includes('mjpeg')) this.startWsMjpeg();
      };
    }

    this.ws!.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') {
        const msg = JSON.parse(ev.data) as { type: string; value: string };
        for (const key of Object.keys(this.onmessage)) {
          this.onmessage[key](msg);
        }
      } else if (this.ondata) {
        this.ondata(ev.data as ArrayBuffer);
      }
    });
  }

  private onWsClose() {
    this.ws = null;
    if (this.wsConnectTimer) clearTimeout(this.wsConnectTimer);
    if (this.stopped || this.liveViaRtc) return;
    Go2rtcStream.captureToImage(this.video, this.freezeTarget(), { force: true });
    this.callbacks.onOffline?.();
    this.scheduleReconnect();
  }

  private freezeTarget(): HTMLImageElement {
    let img = this.video.parentElement?.querySelector('img.stream-freeze') as HTMLImageElement | null;
    if (!img) {
      img = document.createElement('img');
      img.className = 'stream-freeze';
      img.alt = '';
      this.video.parentElement?.insertBefore(img, this.video);
    }
    return img;
  }

  private disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.disconnectPc();
  }

  private disconnectPc() {
    if (this.pc) {
      this.pc.getSenders().forEach((s) => s.track?.stop());
      this.pc.close();
      this.pc = null;
    }
  }

  private startLiveEdgeSync() {
    this.stopLiveEdgeSync();
    this.liveEdgeTimer = setInterval(() => this.syncToLiveEdge(), LIVE_EDGE_SYNC_MS);
  }

  private stopLiveEdgeSync() {
    if (this.liveEdgeTimer) {
      clearInterval(this.liveEdgeTimer);
      this.liveEdgeTimer = null;
    }
  }

  /** Keep `<video>` at the live edge (minimal glass-to-glass delay). */
  private syncToLiveEdge() {
    const v = this.video;
    if (v.paused || v.readyState < 2) return;
    const buf = v.buffered;
    if (buf.length > 0) {
      const end = buf.end(buf.length - 1);
      const lag = end - v.currentTime;
      if (lag > LIVE_EDGE_MAX_LAG_SEC) {
        v.currentTime = Math.max(buf.start(0), end - 0.03);
      }
    }
  }

  private applyWebRtcLowLatency(pc: RTCPeerConnection) {
    for (const receiver of pc.getReceivers()) {
      const r = receiver as RTCRtpReceiver & { playoutDelayHint?: number };
      if ('playoutDelayHint' in r) r.playoutDelayHint = 0;
    }
  }

  private async startWebRtc() {
    const pc = new RTCPeerConnection({
      bundlePolicy: 'max-bundle',
      iceServers: iceServersForHost(),
      iceCandidatePoolSize: 0,
    });
    this.pc = pc;

    pc.addEventListener('icecandidate', (ev) => {
      const candidate = ev.candidate ? ev.candidate.toJSON().candidate : '';
      this.send({ type: 'webrtc/candidate', value: candidate });
    });

    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected') {
        this.liveViaRtc = true;
        const tracks = pc
          .getTransceivers()
          .filter((tr) => tr.currentDirection === 'recvonly')
          .map((tr) => tr.receiver.track);
        const stream = new MediaStream(tracks);
        this.video.srcObject = stream;
        this.video.style.opacity = '1';
        const freeze = this.video.parentElement?.querySelector('img.stream-freeze') as HTMLImageElement;
        if (freeze) freeze.style.opacity = '0';
        this.applyWebRtcLowLatency(pc);
        this.applyLowLatencyVideoHints();
        this.startLiveEdgeSync();
        void this.video.play().catch(() => {
          this.video.muted = true;
          void this.video.play();
        });
        this.callbacks.onOnline?.();
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.liveViaRtc = false;
        this.stopLiveEdgeSync();
        Go2rtcStream.captureToImage(this.video, this.freezeTarget(), { force: true });
        this.callbacks.onOffline?.();
        this.disconnectPc();
        if (!this.stopped) this.scheduleReconnect();
      }
    });

    this.onmessage.webrtc = (msg) => {
      if (msg.type === 'webrtc/candidate') {
        pc.addIceCandidate({ candidate: msg.value, sdpMid: '0' }).catch(() => {});
      } else if (msg.type === 'webrtc/answer') {
        pc.setRemoteDescription({ type: 'answer', sdp: msg.value }).catch(() => {});
      } else if (msg.type === 'error' && msg.value.includes('webrtc/offer')) {
        this.disconnectPc();
      }
    };

    pc.addTransceiver('video', { direction: 'recvonly' });
    const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    this.send({ type: 'webrtc/offer', value: offer.sdp || '' });
  }

  private applyLowLatencyVideoHints() {
    this.video.muted = true;
    const v = this.video as HTMLVideoElement & { latencyHint?: string };
    if ('latencyHint' in v) v.latencyHint = 'realtime';
  }

  private codecs(supported: (t: string) => boolean) {
    const list = ['avc1.640029', 'hvc1.1.6.L153.B0', 'mp4a.40.2', 'opus'];
    return list.filter((c) => supported(`video/mp4; codecs="${c}"`)).join();
  }

  private startMse() {
    const MS = (
      'ManagedMediaSource' in window
        ? (window as Window & { ManagedMediaSource: typeof MediaSource }).ManagedMediaSource
        : MediaSource
    );
    const ms = new MS();
    ms.addEventListener(
      'sourceopen',
      () => {
        this.send({ type: 'mse', value: this.codecs((t) => MS.isTypeSupported(t)) });
      },
      { once: true }
    );

    if ('ManagedMediaSource' in window) {
      this.video.srcObject = ms;
    } else {
      this.video.src = URL.createObjectURL(ms);
    }
    void this.video.play().catch(() => {});

    this.onmessage.mse = (msg) => {
      if (msg.type !== 'mse') return;
      this.mseCodecs = msg.value;
      const sb = ms.addSourceBuffer(msg.value);
      sb.mode = 'segments';
      let buf = new Uint8Array(2 * 1024 * 1024);
      let bufLen = 0;

      sb.addEventListener('updateend', () => {
        if (!sb.updating && bufLen > 0) {
          sb.appendBuffer(buf.slice(0, bufLen));
          bufLen = 0;
        }
        if (!sb.updating && sb.buffered.length) {
          const end = sb.buffered.end(sb.buffered.length - 1);
          const start = Math.max(end - MSE_LIVE_BUFFER_SEC, sb.buffered.start(0));
          if (sb.buffered.start(0) < start - 0.05) {
            try {
              sb.remove(sb.buffered.start(0), start);
            } catch {
              /* ignore */
            }
          }
          if (this.video.currentTime < start - 0.15 || this.video.currentTime > end) {
            this.video.currentTime = Math.max(start, end - 0.05);
          }
          this.applyLowLatencyVideoHints();
          this.startLiveEdgeSync();
          this.callbacks.onOnline?.();
        }
      });

      this.ondata = (data) => {
        const b = new Uint8Array(data);
        if (sb.updating || bufLen > 0) {
          buf.set(b, bufLen);
          bufLen += b.byteLength;
        } else {
          try {
            sb.appendBuffer(b);
          } catch {
            /* ignore */
          }
        }
      };
    };
  }

  private startWsMjpeg() {
    this.ondata = (data) => {
      const now = Date.now();
      if (now - this.mjpegLastAt < MJPEG_FRAME_MIN_MS) return;
      this.mjpegLastAt = now;
      const blob = new Blob([data], { type: 'image/jpeg' });
      if (this.mjpegBlobUrl) URL.revokeObjectURL(this.mjpegBlobUrl);
      this.mjpegBlobUrl = URL.createObjectURL(blob);
      const freeze = this.freezeTarget();
      freeze.src = this.mjpegBlobUrl;
      freeze.style.opacity = '1';
      this.video.style.opacity = '0';
      this.callbacks.onOnline?.();
    };
    this.send({ type: 'mjpeg' });
  }
}
