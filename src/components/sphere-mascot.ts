import type { CursorState } from "./CursorAvatar";
import { TRACK_STEP_MS, type TrackSample } from "./mascot-tracks";

/** What the mascot is acting out; each kind of work has its own repertoire of measured gestures. */
export type MascotActivity = "idle" | "thinking" | "reading" | "command" | "writing" | "looking";

const ACTIVITY_BY_STATE: Partial<Record<CursorState, MascotActivity>> = {
  thinking: "thinking",
  listening: "thinking",
  waking: "thinking",
  humming: "thinking",
  spawning: "thinking",
  loading: "thinking",
  searching: "reading",
  receiving: "reading",
  writing: "writing",
  dictating: "writing",
  sending: "writing",
  uploading: "writing",
  radar: "looking",
  dragging: "looking",
  orbit: "looking",
  working: "command",
  progress: "command",
  bouncing: "command",
};

export function activityForState(state: CursorState): MascotActivity {
  return ACTIVITY_BY_STATE[state] ?? "idle";
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
  /** Where the body has moved, in resting radii (y up). */
  x: number;
  y: number;
  eyes: readonly [Eye, Eye];
  smile: number;
  /** How far the body has collapsed into three dots: 0 is a whole body, 1 is only the dots. */
  dots: number;
  /** How lit each dot is, left to right. */
  beat: readonly [number, number, number];
}

const eye = (x: number, y: number, length: number, width: number, angle: number): Eye => ({ x, y, length, width, angle });

const still = (left: Eye, right: Eye): Face => ({
  scale: 1,
  stretchX: 1,
  stretchY: 1,
  x: 0,
  y: 0,
  eyes: [left, right],
  smile: 0,
  dots: 0,
  beat: [0, 0, 0],
});

export const IDLE_FACE: Face = still(eye(0.108, 0.325, 0.576, 0.283, 55), eye(0.571, 0.532, 0.567, 0.185, 52));

/** Facing the viewer: the hover face, and the pose Grok holds after it celebrates. */
export const FRONT_FACE: Face = still(eye(-0.305, 0, 0.592, 0.285, 90), eye(0.305, 0, 0.592, 0.285, 90));

/** The working face to hold when it may not move: eyes front and wide, as Grok's sits between glances. */
export const STILL_WORKING_FACE: Face = still(eye(-0.326, 0, 0.865, 0.428, 90), eye(0.327, 0, 0.864, 0.429, 90));

/** The round-eyed look Grok gives just before it folds into its thinking dots. */
export const DOTS_FACE: Face = still(eye(-0.337, 0.005, 0.437, 0.414, 90), eye(0.342, 0.004, 0.441, 0.413, 90));

export function faceFromSample(sample: TrackSample): Face {
  const at = (i: number) => eye(sample[i], sample[i + 1], sample[i + 2], sample[i + 3], sample[i + 4]);
  return {
    scale: sample[0],
    stretchX: sample[1],
    stretchY: sample[2],
    x: sample[14] ?? 0,
    y: sample[15] ?? 0,
    eyes: [at(3), at(8)],
    smile: sample[13],
    dots: 0,
    beat: [0, 0, 0],
  };
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
    x: mix(a.x, b.x, k),
    y: mix(a.y, b.y, k),
    eyes: [mixEye(a.eyes[0], b.eyes[0], k), mixEye(a.eyes[1], b.eyes[1], k)],
    smile: mix(a.smile, b.smile, k),
    dots: mix(a.dots, b.dots, k),
    beat: [mix(a.beat[0], b.beat[0], k), mix(a.beat[1], b.beat[1], k), mix(a.beat[2], b.beat[2], k)],
  };
}

export function faceDistance(a: Face, b: Face): number {
  let d = Math.max(
    Math.abs(a.scale - b.scale),
    Math.abs(a.stretchX - b.stretchX),
    Math.abs(a.stretchY - b.stretchY),
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.smile - b.smile),
    Math.abs(a.dots - b.dots),
    ...a.beat.map((v, i) => Math.abs(v - b.beat[i])),
  );
  for (const i of [0, 1]) {
    const p = a.eyes[i];
    const q = b.eyes[i];
    d = Math.max(d, Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.length - q.length), Math.abs(p.width - q.width), Math.abs(angleStep(p.angle, q.angle)) / 90);
  }
  return d;
}

export function trackDurationMs(track: readonly TrackSample[]): number {
  return (track.length - 1) * TRACK_STEP_MS;
}

/** The face `elapsed` ms into a track, held on its last sample once it is over. */
export function trackFaceAt(track: readonly TrackSample[], elapsed: number): Face {
  const t = Math.max(0, Math.min(elapsed, trackDurationMs(track)));
  const i = Math.min(Math.floor(t / TRACK_STEP_MS), track.length - 1);
  if (i === track.length - 1) return faceFromSample(track[i]);
  return mixFace(faceFromSample(track[i]), faceFromSample(track[i + 1]), (t - i * TRACK_STEP_MS) / TRACK_STEP_MS);
}

export function scaleEyes(face: Face, k: number): Face {
  const sized = (e: Eye): Eye => ({ ...e, length: e.length * k, width: e.width * k });
  return { ...face, eyes: [sized(face.eyes[0]), sized(face.eyes[1])] };
}

/** How far the eyes travel, in body radii, when the pointer is off to one side, and above or below. */
export const LOOK_REACH_X = 0.31;
export const LOOK_REACH_Y = 0.23;
/** The pointer distance, in body radii, at which the eyes reach the edge of their travel. */
const LOOK_SPAN = 1.2;

/**
 * The face turned toward a pointer `dx`, `dy` body radii from the centre, in screen axes. Grok follows the
 * pointer on each axis separately, so one far along a row still turns the eyes fully that way, and the eye on
 * the side it turns toward narrows a little as it rounds the sphere.
 */
export function lookToward(face: Face, dx: number, dy: number): Face {
  const kx = Math.max(-1, Math.min(1, dx / LOOK_SPAN));
  const ky = Math.max(-1, Math.min(1, -dy / LOOK_SPAN));
  const turned = (e: Eye): Eye => ({
    ...e,
    x: e.x * (1 - 0.05 * Math.abs(kx)) + kx * LOOK_REACH_X,
    y: e.y + ky * LOOK_REACH_Y,
    width: e.width * (1 - 0.12 * Math.max(0, Math.sign(e.x) * kx)),
  });
  return { ...face, eyes: [turned(face.eyes[0]), turned(face.eyes[1])] };
}

/** Grok's thinking dots: centres across the face, in body radii, and the beat that walks left to right. */
export const DOT_SPACING = 0.8;
export const DOT_STEP_MS = 470;
export const DOT_CYCLE_MS = 3 * DOT_STEP_MS;
const DOT_PEAK_MS = 110;
const DOT_FADE_MS = 420;

function dotLight(sincePeak: number): number {
  const half = DOT_CYCLE_MS / 2;
  const d = Math.abs(((((sincePeak + half) % DOT_CYCLE_MS) + DOT_CYCLE_MS) % DOT_CYCLE_MS) - half);
  if (d <= DOT_PEAK_MS) return 1;
  if (d >= DOT_PEAK_MS + DOT_FADE_MS) return 0;
  return 0.5 + 0.5 * Math.cos((Math.PI * (d - DOT_PEAK_MS)) / DOT_FADE_MS);
}

/** How lit each dot is `elapsed` ms after the middle one peaks: the middle, then the right, then the left. */
export function dotBeat(elapsed: number): [number, number, number] {
  return [dotLight(elapsed - 2 * DOT_STEP_MS), dotLight(elapsed), dotLight(elapsed - DOT_STEP_MS)];
}

/** A dot's radius (body radii), opacity and rise (body radii, up) for how lit it is. */
export function dotPose(lit: number): { radius: number; opacity: number; lift: number } {
  return { radius: 0.245 + 0.065 * lit, opacity: 0.6 + 0.4 * lit, lift: 0.015 + 0.115 * lit };
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
