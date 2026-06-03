export type Bbox = { x: number; y: number; width: number; height: number };

export type SmoothTrackState = {
  target: Bbox;
  display: Bbox;
  targetAt: number;
  vx: number;
  vy: number;
  vw: number;
  vh: number;
};

const MAX_PREDICT_MS = 1400;
const LERP = 0.42;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function lerpBbox(a: Bbox, b: Bbox, t: number): Bbox {
  const u = clamp(t, 0, 1);
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    width: a.width + (b.width - a.width) * u,
    height: a.height + (b.height - a.height) * u,
  };
}

export function updateSmoothTarget(track: SmoothTrackState, next: Bbox, now: number) {
  const dtMs = now - track.targetAt;
  if (dtMs > 40) {
    const sec = dtMs / 1000;
    track.vx = (next.x - track.target.x) / sec;
    track.vy = (next.y - track.target.y) / sec;
    track.vw = (next.width - track.target.width) / sec;
    track.vh = (next.height - track.target.height) / sec;
  }
  track.target = next;
  track.targetAt = now;
}

export function stepSmoothDisplay(track: SmoothTrackState, now: number, frameW: number, frameH: number): Bbox {
  const elapsed = now - track.targetAt;
  let goal = track.target;
  if (elapsed > 0 && elapsed < MAX_PREDICT_MS && (Math.abs(track.vx) > 1 || Math.abs(track.vy) > 1)) {
    const sec = elapsed / 1000;
    goal = {
      x: track.target.x + track.vx * sec,
      y: track.target.y + track.vy * sec,
      width: Math.max(8, track.target.width + track.vw * sec),
      height: Math.max(8, track.target.height + track.vh * sec),
    };
    goal.x = clamp(goal.x, 0, Math.max(0, frameW - goal.width));
    goal.y = clamp(goal.y, 0, Math.max(0, frameH - goal.height));
  }
  track.display = lerpBbox(track.display, goal, LERP);
  return track.display;
}

export function initSmoothTrack(bbox: Bbox, now: number): SmoothTrackState {
  return {
    target: bbox,
    display: { ...bbox },
    targetAt: now,
    vx: 0,
    vy: 0,
    vw: 0,
    vh: 0,
  };
}
