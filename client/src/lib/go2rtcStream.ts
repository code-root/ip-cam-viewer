/**
 * Minimal go2rtc WebSocket player (webrtc → mse → mjpeg).
 * Based on go2rtc video-rtc.js (MIT).
 */

export type Go2rtcStreamCallbacks = {
  onOnline?: () => void;
  onOffline?: () => void;
};

/** Target live edge buffer (seconds) for MSE fallback — minimal = lower latency. */
const MSE_LIVE_BUFFER_SEC = 0.35;
/** HTTP JPEG poll interval when WebRTC/MSE unavailable (ms). */
const HTTP_FALLBACK_MS = 120;
const WS_CONNECT_TIMEOUT_MS = 2500;
const RECONNECT_MS = 800;

/** Vite's WebSocket proxy to go2rtc is unreliable — use direct go2rtc in dev. */
function resolveGo2rtcHttpBase(): string {
  const env = import.meta.env.VITE_GO2RTC_URL as string | undefined;
  if (env) return env.replace(/\/$/, '');
  if (import.meta.env.DEV) return 'http://127.0.0.1:1984';
  return `${location.origin}/go2rtc`;
}

function resolveGo2rtcWsBase(): string {
  const env = import.meta.env.VITE_GO2RTC_WS as string | undefined;
  if (env) return env.replace(/\/$/, '');
  if (import.meta.env.DEV) return 'ws://127.0.0.1:1984';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/go2rtc`;
}

export class Go2rtcStream {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private mseCodecs = '';
  private ondata: ((data: ArrayBuffer) => void) | null = null;
  private onmessage: Record<string, (msg: { type: string; value: string }) => void> = {};
  private connectTs = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsConnectTimer: ReturnType<typeof setTimeout> | null = null;
  private httpFallbackTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private liveViaRtc = false;
  private useHttpFallback = false;
  private wsEverOpened = false;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly streamName: string,
    private readonly callbacks: Go2rtcStreamCallbacks = {}
  ) {}

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.liveViaRtc = false;
    this.useHttpFallback = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.wsConnectTimer) clearTimeout(this.wsConnectTimer);
    if (this.httpFallbackTimer) clearInterval(this.httpFallbackTimer);
    this.disconnect();
  }

  /** Capture current video frame to an <img> for freeze-on-disconnect. */
  static captureToImage(video: HTMLVideoElement, target: HTMLImageElement) {
    if (video.videoWidth === 0 || video.videoHeight === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    try {
      target.src = canvas.toDataURL('image/jpeg', 0.88);
    } catch {
      /* ignore */
    }
  }

  private wsUrl() {
    return `${resolveGo2rtcWsBase()}/api/ws?src=${encodeURIComponent(this.streamName)}`;
  }

  private connect() {
    if (this.stopped) return;
    if (this.useHttpFallback) {
      this.startHttpFallback();
      return;
    }
    if (this.ws) return;
    this.connectTs = Date.now();
    this.wsEverOpened = false;
    const ws = new WebSocket(this.wsUrl());
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    this.wsConnectTimer = setTimeout(() => {
      if (!this.wsEverOpened && !this.stopped) {
        this.startHttpFallback();
      }
    }, WS_CONNECT_TIMEOUT_MS);

    ws.addEventListener('open', () => {
      this.wsEverOpened = true;
      if (this.wsConnectTimer) clearTimeout(this.wsConnectTimer);
      this.onWsOpen();
    });
    ws.addEventListener('close', () => this.onWsClose());
    ws.addEventListener('error', () => {
      if (!this.wsEverOpened && !this.stopped) {
        this.startHttpFallback();
      } else {
        this.callbacks.onOffline?.();
      }
    });
  }

  /** Fast JPEG polling when WebSocket/WebRTC path is unavailable. */
  private startHttpFallback() {
    if (this.stopped || this.useHttpFallback) return;
    this.useHttpFallback = true;
    this.disconnect();
    const freeze = this.freezeTarget();
    const url = `${resolveGo2rtcHttpBase()}/api/frame.jpeg?src=${encodeURIComponent(this.streamName)}`;

    const tick = () => {
      if (this.stopped) return;
      const probe = new Image();
      probe.onload = () => {
        freeze.src = probe.src;
        freeze.style.opacity = '1';
        this.video.style.opacity = '0';
        this.callbacks.onOnline?.();
      };
      probe.onerror = () => {
        /* keep last frame — do not clear freeze.src */
        this.callbacks.onOffline?.();
      };
      probe.src = `${url}&t=${Date.now()}`;
    };

    tick();
    this.httpFallbackTimer = setInterval(tick, HTTP_FALLBACK_MS);
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private onWsOpen() {
    if (this.httpFallbackTimer) {
      clearInterval(this.httpFallbackTimer);
      this.httpFallbackTimer = null;
    }
    this.useHttpFallback = false;
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
    if (this.stopped || this.liveViaRtc) return;
    if (!this.wsEverOpened) {
      this.startHttpFallback();
      return;
    }
    Go2rtcStream.captureToImage(this.video, this.freezeTarget());
    this.callbacks.onOffline?.();
    const delay = Math.max(RECONNECT_MS * 2 - (Date.now() - this.connectTs), RECONNECT_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.disconnectPc();
      this.useHttpFallback = false;
      this.connect();
    }, delay);
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

  private async startWebRtc() {
    const pc = new RTCPeerConnection({
      bundlePolicy: 'max-bundle',
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
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
        this.applyLowLatencyVideoHints();
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
        Go2rtcStream.captureToImage(this.video, this.freezeTarget());
        this.callbacks.onOffline?.();
        this.disconnectPc();
        if (!this.stopped) {
          const delay = RECONNECT_MS;
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
          }, delay);
        }
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
    pc.addTransceiver('audio', { direction: 'recvonly' });
    const offer = await pc.createOffer();
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
      const bytes = new Uint8Array(data);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const poster = 'data:image/jpeg;base64,' + btoa(binary);
      const freeze = this.freezeTarget();
      freeze.src = poster;
      freeze.style.opacity = '1';
      this.video.style.opacity = '0';
      this.callbacks.onOnline?.();
    };
    this.send({ type: 'mjpeg' });
  }
}
