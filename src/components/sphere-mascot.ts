import type { CursorState } from "./CursorAvatar";

export type MascotMood = "idle" | "working" | "done";

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

/** Where the face points and what the eyes look like, in units of the sphere radius. */
export interface EyePose {
  yaw: number;
  pitch: number;
  roll: number;
  /** How much the eyes collapse into ovals as the face turns away: 1 for glances, 0 for the resting pose. */
  shrink: number;
  length: number;
  width: number;
  spread: number;
  open: number;
  smile: number;
}

const DEG = Math.PI / 180;

/** Eyes ride a sphere a little smaller than the body, so even a sideways glance keeps them inside it. */
export const EYE_SPHERE = 0.7;
const spreadFor = (halfGap: number) => Math.asin(halfGap / EYE_SPHERE);

export const FRONT_POSE: EyePose = { yaw: 0, pitch: 0, roll: 0, shrink: 1, length: 0.89, width: 0.32, spread: spreadFor(0.31), open: 1, smile: 0 };
export const IDLE_POSE: EyePose = { yaw: 46 * DEG, pitch: 23 * DEG, roll: 21 * DEG, shrink: 0, length: 0.38, width: 0.17, spread: spreadFor(0.35), open: 1, smile: 0 };
export const HOVER_POSE: EyePose = { yaw: 0, pitch: 0, roll: 0, shrink: 1, length: 0.3, width: 0.3, spread: spreadFor(0.34), open: 1, smile: 0 };
export const HAPPY_POSE: EyePose = { yaw: 0, pitch: 0, roll: 0, shrink: 1, length: 0.89, width: 0.32, spread: spreadFor(0.34), open: 1, smile: 1 };

export interface Glance {
  pose: EyePose;
  weight: number;
  holdMs: [number, number];
}

const glance = (yawDeg: number, pitchDeg: number, extra: Partial<EyePose> = {}): EyePose => ({
  ...FRONT_POSE,
  yaw: yawDeg * DEG,
  pitch: pitchDeg * DEG,
  ...extra,
  roll: (extra.roll ?? 0) * DEG,
});

export const WORKING_GLANCES: readonly Glance[] = [
  { pose: FRONT_POSE, weight: 4, holdMs: [900, 2200] },
  { pose: glance(0, 12), weight: 2, holdMs: [800, 1800] },
  { pose: glance(8, -6, { roll: -22, length: 0.55, width: 0.26 }), weight: 1.5, holdMs: [700, 1500] },
  { pose: glance(-38, -4), weight: 1.5, holdMs: [700, 1500] },
  { pose: glance(38, 2), weight: 1.5, holdMs: [700, 1500] },
  { pose: glance(-25, -38), weight: 1.5, holdMs: [700, 1500] },
  { pose: glance(30, 38), weight: 1.5, holdMs: [700, 1500] },
  { pose: glance(40, 30, { shrink: 0.3, length: 0.7, width: 0.26 }), weight: 1, holdMs: [600, 1300] },
  { pose: glance(0, 45), weight: 1.5, holdMs: [700, 1400] },
  { pose: glance(-22, 42), weight: 1, holdMs: [600, 1300] },
  { pose: glance(0, 8, { length: 1.0, width: 0.36 }), weight: 1, holdMs: [500, 1000] },
  { pose: glance(160, 12), weight: 0.6, holdMs: [500, 900] },
];

export function pickGlance(random: () => number, previous: Glance | null): Glance {
  const options = WORKING_GLANCES.filter((g) => g !== previous);
  const total = options.reduce((sum, g) => sum + g.weight, 0);
  let remaining = random() * total;
  for (const option of options) {
    remaining -= option.weight;
    if (remaining <= 0) return option;
  }
  return options[options.length - 1];
}

type Vec3 = [number, number, number];

/** Near the rim an eye would thin to a hairline; it never reads thinner than this share of its width. */
const MIN_WIDTH_SQUEEZE = 0.9;

/** An SVG `matrix(a b c d e f)` mapping eye-local units onto the projected sphere, plus how far the eye faces the viewer. */
export interface EyePlacement {
  matrix: [number, number, number, number, number, number];
  depth: number;
}

/** Orthographic projection of an eye painted on a sphere: x right, y up, z toward the viewer. */
export function placeEyes(pose: EyePose, cx: number, cy: number, bodyRadius: number): [EyePlacement, EyePlacement] {
  const radius = bodyRadius * EYE_SPHERE;
  const facing = Math.cos(pose.yaw) * Math.cos(pose.pitch);
  const spread = pose.spread * (1 - pose.shrink * 0.45 * (1 - Math.max(0, facing) ** 4));
  const cr = Math.cos(pose.roll);
  const sr = Math.sin(pose.roll);
  const cy0 = Math.cos(pose.yaw);
  const sy0 = Math.sin(pose.yaw);
  const cp = Math.cos(pose.pitch);
  const sp = Math.sin(pose.pitch);
  const forward: Vec3 = [sy0 * cp, sp, cy0 * cp];
  const right: Vec3 = [cy0, 0, -sy0];
  const up: Vec3 = [-sy0 * sp, cp, -cy0 * sp];
  const place = (side: -1 | 1): EyePlacement => {
    const s = Math.sin(spread) * side;
    const c = Math.cos(spread);
    const at: Vec3 = [forward[0] * c + right[0] * s, forward[1] * c + right[1] * s, forward[2] * c + right[2] * s];
    const across: Vec3 = [right[0] * c - forward[0] * s, right[1] * c - forward[1] * s, right[2] * c - forward[2] * s];
    const roll = (v: Vec3): [number, number] => [v[0] * cr - v[1] * sr, v[0] * sr + v[1] * cr];
    const [rawX, rawY] = roll(across);
    const squeeze = Math.hypot(rawX, rawY);
    const widen = squeeze < MIN_WIDTH_SQUEEZE ? MIN_WIDTH_SQUEEZE / Math.max(squeeze, 1e-6) : 1;
    const [ax, ay] = [rawX * widen, rawY * widen];
    const [ux, uy] = roll(up);
    const [px, py] = roll(at);
    return {
      matrix: [bodyRadius * ax, -bodyRadius * ay, -bodyRadius * ux, bodyRadius * uy, cx + radius * px, cy - radius * py],
      depth: at[2],
    };
  };
  const eyes = [place(-1), place(1)];
  const reach = eyes.map((eye) => 0.5 + 0.5 * Math.max(eye.depth, 0));
  const mean = (reach[0] + reach[1]) / 2;
  for (const [i, eye] of eyes.entries()) {
    const k = reach[i] / mean;
    eye.matrix[2] *= k;
    eye.matrix[3] *= k;
  }
  return [eyes[0], eyes[1]];
}

/** Turned away from the viewer, an eye's long axis collapses faster than plain foreshortening would. */
export function eyeLengthScale(pose: EyePose): number {
  const facing = Math.max(0, Math.cos(pose.yaw) * Math.cos(pose.pitch));
  return 1 - pose.shrink * 0.7 * (1 - facing ** 8);
}

export function eyeOpacity(depth: number): number {
  return Math.max(0, Math.min(1, (depth - 0.04) / 0.14));
}

const fmt = (n: number) => (Math.abs(n) < 1e-6 ? "0" : n.toFixed(4));

/** A pill centred on the origin; a pill as wide as it is tall is a dot. */
export function pillPath(width: number, height: number): string {
  const w = Math.max(width, 0.001);
  const h = Math.max(height, 0.001);
  const r = Math.min(w, h) / 2;
  const x = w / 2;
  const y = h / 2;
  return [
    `M${fmt(-x + r)} ${fmt(-y)}`,
    `H${fmt(x - r)}`,
    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x)} ${fmt(-y + r)}`,
    `V${fmt(y - r)}`,
    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x - r)} ${fmt(y)}`,
    `H${fmt(-x + r)}`,
    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(-x)} ${fmt(y - r)}`,
    `V${fmt(-y + r)}`,
    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(-x + r)} ${fmt(-y)}`,
    "Z",
  ].join("");
}

export const SMILE_RADIUS = 0.14;
export const SMILE_STROKE = 0.18;

/** The closed-eye "∩" of a happy face. */
export function smilePath(): string {
  const a = 0.02;
  const x = SMILE_RADIUS * Math.cos(a);
  const y = SMILE_RADIUS * Math.sin(a) + 0.05;
  return `M${fmt(-x)} ${fmt(y)}A${fmt(SMILE_RADIUS)} ${fmt(SMILE_RADIUS)} 0 1 1 ${fmt(x)} ${fmt(y)}`;
}

export function mixPose(from: EyePose, to: EyePose, t: number): EyePose {
  const k = Math.max(0, Math.min(1, t));
  const mix = (a: number, b: number) => a + (b - a) * k;
  return {
    yaw: mix(from.yaw, to.yaw),
    pitch: mix(from.pitch, to.pitch),
    roll: mix(from.roll, to.roll),
    shrink: mix(from.shrink, to.shrink),
    length: mix(from.length, to.length),
    width: mix(from.width, to.width),
    spread: mix(from.spread, to.spread),
    open: mix(from.open, to.open),
    smile: mix(from.smile, to.smile),
  };
}

export function poseDistance(a: EyePose, b: EyePose): number {
  return Math.max(
    Math.abs(a.yaw - b.yaw),
    Math.abs(a.pitch - b.pitch),
    Math.abs(a.roll - b.roll),
    Math.abs(a.shrink - b.shrink),
    Math.abs(a.length - b.length),
    Math.abs(a.width - b.width),
    Math.abs(a.spread - b.spread),
    Math.abs(a.open - b.open),
    Math.abs(a.smile - b.smile),
  );
}

export const BLINK_MS = 160;

/** How open the eyes are `elapsed` ms into a blink. */
export function blinkOpenness(elapsed: number): number {
  if (elapsed < 0 || elapsed >= BLINK_MS) return 1;
  const half = BLINK_MS / 2;
  const closed = 0.08;
  return elapsed < half ? 1 - (1 - closed) * (elapsed / half) : closed + (1 - closed) * ((elapsed - half) / half);
}

export interface BodyPose {
  scaleX: number;
  scaleY: number;
  lift: number;
}

export const REST_BODY: BodyPose = { scaleX: 1, scaleY: 1, lift: 0 };

const HOP_MS = 620;
export const DONE_HOPS_MS = [250, 2650];
export const DONE_SMILE_MS = 5600;
export const DONE_FRONT_MS = 1500;
export const DONE_MS = DONE_SMILE_MS + DONE_FRONT_MS;

/** Squash, stretch and settle of one celebratory hop, `t` ms after it starts. Lift is in sphere radii. */
export function hopAt(t: number): BodyPose {
  if (t < 0 || t >= HOP_MS) return REST_BODY;
  const ease = (x: number) => 0.5 - Math.cos(Math.PI * Math.max(0, Math.min(1, x))) / 2;
  if (t < 120) {
    const k = ease(t / 120);
    return { scaleX: 1 + 0.14 * k, scaleY: 1 - 0.16 * k, lift: 0 };
  }
  if (t < 300) {
    const k = ease((t - 120) / 180);
    return { scaleX: 1.14 - 0.24 * k, scaleY: 0.84 + 0.28 * k, lift: 0.04 * k };
  }
  const k = ease((t - 300) / (HOP_MS - 300));
  const wobble = Math.sin(k * Math.PI * 2) * 0.03 * (1 - k);
  return { scaleX: 0.9 + 0.1 * k + wobble, scaleY: 1.12 - 0.12 * k - wobble, lift: 0.04 * (1 - k) };
}

export function doneBodyAt(elapsed: number): BodyPose {
  for (const start of DONE_HOPS_MS) {
    const t = elapsed - start;
    if (t >= 0 && t < HOP_MS) return hopAt(t);
  }
  return REST_BODY;
}

export function donePoseAt(elapsed: number): EyePose | null {
  if (elapsed < 0 || elapsed >= DONE_MS) return null;
  return elapsed < DONE_SMILE_MS ? HAPPY_POSE : FRONT_POSE;
}

/** The gentle breathing of a working body. */
export function workingBreathAt(now: number): number {
  return 1 + Math.sin((now / 1700) * Math.PI * 2) * 0.025;
}
