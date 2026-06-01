import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const root = path.resolve(__dirname, '../..');

function resolveFromRoot(p: string | undefined, fallback: string): string {
  const value = p || fallback;
  return path.isAbsolute(value) ? value : path.join(root, value);
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
  encryptionKey: process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef',
  go2rtcBin: resolveFromRoot(process.env.GO2RTC_BIN, 'bin/go2rtc'),
  go2rtcApi: process.env.GO2RTC_API || 'http://127.0.0.1:1984',
  go2rtcConfig: resolveFromRoot(process.env.GO2RTC_CONFIG, 'config/go2rtc.yaml'),
  recordingsPath: process.env.RECORDINGS_PATH || path.join(root, 'data/recordings'),
  snapshotsPath: process.env.SNAPSHOTS_PATH || path.join(root, 'data/snapshots'),
  maxConcurrentStreams: parseInt(process.env.MAX_CONCURRENT_STREAMS || '8', 10),
  idleTimeoutMinutes: parseInt(process.env.IDLE_TIMEOUT_MINUTES || '30', 10),
  siteName: process.env.SITE_NAME || 'IP Camera Viewer',
  facesPath: process.env.FACES_PATH || path.join(root, 'data/faces'),
  faceModelsPath: process.env.FACE_MODELS_PATH || path.join(root, 'server/models/face-api'),
  faceScanIntervalSec: parseInt(process.env.FACE_SCAN_INTERVAL_SEC || '3', 10),
  faceDetectTimeoutSec: parseInt(process.env.FACE_DETECT_TIMEOUT_SEC || '90', 10),
  faceScanMaxBackoffSec: parseInt(process.env.FACE_SCAN_MAX_BACKOFF_SEC || '20', 10),
  faceTrackTtlSec: parseInt(process.env.FACE_TRACK_TTL_SEC || '75', 10),
  faceGlobalTrackTtlSec: parseInt(process.env.FACE_GLOBAL_TRACK_TTL_SEC || '600', 10),
  /** Link frames to same track when descriptor distance is below this. */
  faceTrackMatchThreshold: parseFloat(process.env.FACE_TRACK_MATCH_THRESHOLD || '0.48'),
  /** Never merge two local tracks above this face-distance even if boxes overlap. */
  faceTrackHardMaxDistance: parseFloat(process.env.FACE_TRACK_HARD_MAX_DISTANCE || '0.65'),
  /** Link the same unknown person across cameras before auto-enrollment. */
  faceGlobalTrackMatchThreshold: parseFloat(process.env.FACE_GLOBAL_TRACK_MATCH_THRESHOLD || '0.54'),
  /** Max distance to attach unknown track to existing employee on auto-enroll. */
  faceAutoEnrollMatchThreshold: parseFloat(process.env.FACE_AUTO_ENROLL_MATCH_THRESHOLD || '0.5'),
  /** Scans before auto-creating employee from an unknown track. */
  faceTrackEnrollMinHits: parseInt(process.env.FACE_TRACK_ENROLL_MIN_HITS || '4', 10),
  faceMatchThreshold: parseFloat(process.env.FACE_MATCH_THRESHOLD || '0.55'),
  /** Looser match for attendance logs only (not live overlay). */
  faceMatchThresholdCctv: parseFloat(process.env.FACE_MATCH_THRESHOLD_CCTV || '0.62'),
  /** Minimum match confidence (0–1) before showing a live name tag. */
  faceMinLiveConfidence: parseFloat(process.env.FACE_MIN_LIVE_CONFIDENCE || '0.45'),
  /** Minimum detection quality from Python (0–1). */
  faceMinDetectionScore: parseFloat(process.env.FACE_MIN_DETECTION_SCORE || '0.22'),
  /** Consecutive scans with same person before showing their name tag. */
  faceConfirmScans: parseInt(process.env.FACE_CONFIRM_SCANS || '2', 10),
  /** Reject match if second-best employee is within this distance of the best. */
  faceMatchMargin: parseFloat(process.env.FACE_MATCH_MARGIN || '0.07'),
  /** Stream quality used for face scan snapshots (should match dashboard: sub). */
  faceScanStreamQuality: (process.env.FACE_SCAN_QUALITY === 'main' ? 'main' : 'sub') as 'main' | 'sub',
  facePersonDetect: process.env.FACE_PERSON_DETECT !== 'false',
  /** Draw blue person boxes on live view (off = face labels only, cleaner). */
  faceShowPersonBoxes: process.env.FACE_SHOW_PERSON_BOXES === 'true',
  faceMinPersonScore: parseFloat(process.env.FACE_MIN_PERSON_SCORE || '0.25'),
  faceModelsDir: resolveFromRoot(process.env.FACE_MODELS_DIR, 'server/models'),
  faceAbsenceCloseSec: parseInt(process.env.FACE_ABSENCE_CLOSE_SEC || '180', 10),
  onvifDiscoverTimeoutMs: parseInt(process.env.ONVIF_DISCOVER_TIMEOUT_MS || '12000', 10),
  onvifDiscoverSubnetScan: process.env.ONVIF_DISCOVER_SUBNET_SCAN !== 'false',
  onvifDiscoverSubnet: process.env.ONVIF_DISCOVER_SUBNET || '',
  onvifDiscoverPerHostMs: parseInt(process.env.ONVIF_DISCOVER_PER_HOST_MS || '450', 10),
  onvifDiscoverConcurrency: parseInt(process.env.ONVIF_DISCOVER_CONCURRENCY || '48', 10),
  faceScanEnabled: process.env.FACE_SCAN_ENABLED !== 'false',
  /** Create employee + face profile when an unknown face is detected. */
  faceAutoEnrollUnknown: process.env.FACE_AUTO_ENROLL_UNKNOWN !== 'false',
  faceAutoEnrollNamePrefix: process.env.FACE_AUTO_ENROLL_NAME_PREFIX || 'شخص ',
  /** Python for face_recognition (default: auto-detect .venv then python3). */
  pythonBin: process.env.PYTHON_BIN ? resolveFromRoot(process.env.PYTHON_BIN, '') : '',
  root,
};
