import type { CursorState } from "./CursorAvatar";
import { TRACK_STEP_MS, type TrackSample } from "./mascot-tracks";

export type MascotMood = "idle" | "working";

const WORKING_STATES: ReadonlySet<CursorState> = new Set<CursorState>([
  "working",
  "thinking",
  "searching",
  "listening",
  "loading",
  "writing",
  "sending",
  "receiving",
  "uploading",
  "dictating",
  "humming",
  "orbit",
  "radar",
  "progress",
  "spawning",
  "dragging",
  "bouncing",
  "waking",
]);

export function moodForState(state: CursorState): MascotMood {
  return WORKING_STATES.has(state) ? "working" : "idle";
}

/** One eye in body radii from the centre (y up); `angle` is its long axis in screen degrees. */
export interface Eye {
  x: number;
  y: number;
  length: number;
  width: number;
  angle: number;
}

export interface Face {
  scale: number;
  stretchX: number;
  stretchY: number;
  eyes: readonly [Eye, Eye];
  smile: number;
}

const eye = (x: number, y: number, length: number, width: number, angle: number): Eye => ({ x, y, length, width, angle });

export const IDLE_FACE: Face = {
  scale: 1,
  stretchX: 1,
  stretchY: 1,
  eyes: [eye(0.105, 0.326, 0.551, 0.268, 55), eye(0.577, 0.545, 0.534, 0.17, 54)],
  smile: 0,
};

export const HOVER_FACE: Face = {
  scale: 1,
  stretchX: 1,
  stretchY: 1,
  eyes: [eye(-0.348, 0, 0.36, 0.319, 90), eye(0.348, 0, 0.36, 0.319, 90)],
  smile: 0,
};

/** The working face to hold when it may not move: eyes front, as Grok's sits between glances. */
export const STILL_WORKING_FACE: Face = {
  scale: 1,
  stretchX: 1,
  stretchY: 1,
  eyes: [eye(-0.311, -0.003, 0.555, 0.242, 90), eye(0.312, -0.008, 0.555, 0.241, 90)],
  smile: 0,
};

export function faceFromSample(sample: TrackSample): Face {
  const at = (i: number) => eye(sample[i], sample[i + 1], sample[i + 2], sample[i + 3], sample[i + 4]);
  return { scale: sample[0], stretchX: sample[1], stretchY: sample[2], eyes: [at(3), at(8)], smile: sample[13] };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Long axes have no head or tail, so angles wrap every 180 degrees. */
function angleStep(a: number, b: number): number {
  let d = (((b - a) % 180) + 180) % 180;
  if (d > 90) d -= 180;
  return d;
}

function mixEye(a: Eye, b: Eye, t: number): Eye {
  if (a.length <= 0 && b.length <= 0) return a;
  if (a.length <= 0) return { ...b, length: b.length * t, width: b.width * t };
  if (b.length <= 0) return { ...a, length: a.length * (1 - t), width: a.width * (1 - t) };
  return {
    x: mix(a.x, b.x, t),
    y: mix(a.y, b.y, t),
    length: mix(a.length, b.length, t),
    width: mix(a.width, b.width, t),
    angle: a.angle + angleStep(a.angle, b.angle) * t,
  };
}

export function mixFace(a: Face, b: Face, t: number): Face {
  const k = Math.max(0, Math.min(1, t));
  return {
    scale: mix(a.scale, b.scale, k),
    stretchX: mix(a.stretchX, b.stretchX, k),
    stretchY: mix(a.stretchY, b.stretchY, k),
    eyes: [mixEye(a.eyes[0], b.eyes[0], k), mixEye(a.eyes[1], b.eyes[1], k)],
    smile: mix(a.smile, b.smile, k),
  };
}

export function faceDistance(a: Face, b: Face): number {
  let d = Math.max(Math.abs(a.scale - b.scale), Math.abs(a.stretchX - b.stretchX), Math.abs(a.stretchY - b.stretchY), Math.abs(a.smile - b.smile));
  for (const i of [0, 1]) {
    const p = a.eyes[i];
    const q = b.eyes[i];
    d = Math.max(d, Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.length - q.length), Math.abs(p.width - q.width), Math.abs(angleStep(p.angle, q.angle)) / 90);
  }
  return d;
}

export const TRACK_WRAP_MS = 400;

export function trackDurationMs(track: readonly TrackSample[], loop: boolean): number {
  return (track.length - 1) * TRACK_STEP_MS + (loop ? TRACK_WRAP_MS : 0);
}

/** The face `elapsed` ms into a track; a looping track eases from its last sample back to its first. */
export function trackFaceAt(track: readonly TrackSample[], elapsed: number, loop: boolean): Face {
  const total = trackDurationMs(track, loop);
  const t = loop ? ((elapsed % total) + total) % total : Math.max(0, Math.min(elapsed, total));
  const last = track.length - 1;
  const spanEnd = last * TRACK_STEP_MS;
  if (t >= spanEnd) {
    if (!loop) return faceFromSample(track[last]);
    return mixFace(faceFromSample(track[last]), faceFromSample(track[0]), (t - spanEnd) / TRACK_WRAP_MS);
  }
  const i = Math.floor(t / TRACK_STEP_MS);
  return mixFace(faceFromSample(track[i]), faceFromSample(track[i + 1]), (t - i * TRACK_STEP_MS) / TRACK_STEP_MS);
}

export const POINTER_REACH = 0.26;

/** The face turned toward a pointer `dx`, `dy` body radii from the centre, in screen axes. */
export function lookToward(face: Face, dx: number, dy: number): Face {
  const reach = Math.min(Math.hypot(dx, dy), 1);
  const k = reach > 0 ? reach / Math.hypot(dx, dy) : 0;
  const ox = dx * k * POINTER_REACH;
  const oy = -dy * k * POINTER_REACH;
  const turned = (e: Eye): Eye => ({ ...e, x: e.x * (1 - 0.15 * reach) + ox, y: e.y + oy, width: e.width * (1 - 0.18 * reach) });
  return { ...face, eyes: [turned(face.eyes[0]), turned(face.eyes[1])] };
}

export const BLINK_MS = 160;

export function blinkOpenness(elapsed: number): number {
  if (elapsed < 0 || elapsed >= BLINK_MS) return 1;
  const half = BLINK_MS / 2;
  const closed = 0.12;
  return elapsed < half ? 1 - (1 - closed) * (elapsed / half) : closed + (1 - closed) * ((elapsed - half) / half);
}

export function eyeOpacity(e: Eye): number {
  return Math.max(0, Math.min(1, e.length / 0.06));
}

const fmt = (n: number) => (Math.abs(n) < 1e-6 ? "0" : n.toFixed(4));

/**
 * The measured sizes are four standard deviations of each eye's pixels, which overstates a pill's true
 * length and width by up to 15% as it narrows; a dot is measured exactly.
 */
function pillGain(length: number, width: number): number {
  const long = Math.max(length, width);
  return long > 0 ? 1 - 0.14 * (1 - Math.min(length, width) / long) : 1;
}

/** A pill centred on the origin with its long axis along x, sized as measured; equal sides make a dot. */
export function pillPath(length: number, width: number): string {
  const gain = pillGain(length, width);
  const w = Math.max(length, width, 0.001) * gain;
  const h = Math.max(Math.min(length, width), 0.001) * gain;
  const r = h / 2;
  const x = w / 2;
  return [
    `M${fmt(-x + r)} ${fmt(-r)}`,
    `H${fmt(x - r)}`,
    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x - r)} ${fmt(r)}`,
    `H${fmt(-x + r)}`,
    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(-x + r)} ${fmt(-r)}`,
    "Z",
  ].join("");
}

export const SMILE_RADIUS = 0.152;
export const SMILE_STROKE = 0.215;
const SMILE_LIFT = 0.025;

/** The closed-eye "∩" of a happy face, centred on its own centroid. */
export function smilePath(): string {
  const lift = (2 * SMILE_RADIUS) / Math.PI - SMILE_LIFT;
  return `M${fmt(-SMILE_RADIUS)} ${fmt(lift)}A${fmt(SMILE_RADIUS)} ${fmt(SMILE_RADIUS)} 0 0 1 ${fmt(SMILE_RADIUS)} ${fmt(lift)}`;
}
