// The whip: a joke gesture while the agent works. A whip cracks on the mascot three times, each hit squashing
// it a different way (from above it goes flat, from the side it is squeezed and pushed, on the diagonal it
// bends), its eyes go "> <" at each crack, it ends dizzy with spiral eyes and stars, then shakes it off.
// Everything here is in body radii, centred on the body, y down; the whip and its sparks stay inside the
// mascot's own square (1.13 radii from the centre) so they never cover the text beside it; only the sparks of
// a crack reach a little past its edge.

type Point = readonly [number, number];

export type WhipHit = { at: number; kind: "top" | "side" | "diagonal"; target: Point; windUp: Point };

export const WHIP_HITS: readonly WhipHit[] = [
  { at: 820, kind: "top", target: [0.07, -0.98], windUp: [-0.3, -1.0] },
  { at: 1620, kind: "side", target: [0.97, -0.1], windUp: [1.0, -0.45] },
  { at: 2400, kind: "diagonal", target: [0.69, -0.72], windUp: [1.0, -1.0] },
];
const DIZZY_END = 3300;
const SHAKE_MS = 350;
export const WHIP_MS = 3800;
/** The hand that holds the whip, just off the mascot's top right corner. */
const HAND: Point = [1.0, -1.0];
const STRIKE_MS = 170;
const RECOIL_MS = 260;
const HURT_MS = 380;
const SPARK_MS = 360;

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (t: number) => {
  const k = clamp(t);
  return k * k * (3 - 2 * k);
};
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const along = (p: Point, q: Point, t: number): Point => [mix(p[0], q[0], t), mix(p[1], q[1], t)];
const f = (n: number) => n.toFixed(3);

/** Jelly: the squash rings and settles. */
function wobble(dt: number): number {
  if (dt < 0) return 0;
  const s = dt / 1000;
  return Math.exp(-7.5 * s) * Math.cos(20 * s);
}

export type WhipPose = {
  stretchX: number;
  stretchY: number;
  /** Sideways push, in radii (x right). */
  x: number;
  /** Lean, in degrees, and shear, in degrees. */
  tilt: number;
  skew: number;
  /** "> <" eyes, 0 to 1. */
  hurt: number;
  /** Spiral eyes and stars, 0 to 1. */
  dizzy: number;
};

/** How the body is squashed `elapsed` ms into the gesture. */
export function whipPose(elapsed: number): WhipPose {
  let stretchX = 1, stretchY = 1, x = 0, tilt = 0, skew = 0;
  for (const hit of WHIP_HITS) {
    const dt = elapsed - hit.at;
    if (dt < -60 || dt > 1400) continue;
    const brace = dt < 0 ? ease((dt + 60) / 60) * 0.06 : 0; // it flinches just before the crack
    const m = wobble(dt);
    if (hit.kind === "top") {
      stretchY *= 1 - 0.42 * m - brace;
      stretchX *= 1 + 0.36 * m + brace;
    } else if (hit.kind === "side") {
      stretchX *= 1 - 0.34 * m - brace;
      stretchY *= 1 + 0.22 * m;
      x += dt >= 0 ? -0.29 * Math.exp(-dt / 260) : 0;
      tilt += -10 * m;
    } else {
      skew += -24 * m;
      stretchY *= 1 - 0.22 * m;
      stretchX *= 1 + 0.12 * m;
      tilt += 8 * m;
    }
  }
  const shaking = elapsed - DIZZY_END;
  if (shaking >= 0 && shaking < SHAKE_MS) x += 0.067 * Math.sin((shaking / SHAKE_MS) * Math.PI * 6) * (1 - shaking / SHAKE_MS);
  const hurt = Math.max(0, ...WHIP_HITS.map((hit) => {
    const dt = elapsed - hit.at;
    return dt < -40 || dt > HURT_MS ? 0 : clamp((dt + 40) / 40) * clamp((HURT_MS - dt) / 60);
  }));
  const last = WHIP_HITS[WHIP_HITS.length - 1].at + HURT_MS;
  const dizzy = elapsed < last || elapsed > DIZZY_END ? 0 : clamp((elapsed - last) / 60) * clamp((DIZZY_END - elapsed) / 80);
  return { stretchX, stretchY, x, tilt, skew, hurt, dizzy };
}

/** Where the tip of the lash is, and how fast it moves (0 to 1), or null while the whip is away. */
function tip(elapsed: number): { at: Point; speed: number } | null {
  for (let i = 0; i < WHIP_HITS.length; i++) {
    const hit = WHIP_HITS[i];
    const from = i ? WHIP_HITS[i - 1].at + RECOIL_MS : 150;
    if (elapsed < from || elapsed > hit.at + RECOIL_MS) continue;
    const armed = hit.at - STRIKE_MS;
    if (elapsed < armed) return { at: along(HAND, hit.windUp, ease((elapsed - from) / (armed - from))), speed: 0.2 };
    if (elapsed < hit.at) {
      const k = (elapsed - armed) / STRIKE_MS;
      return { at: along(hit.windUp, hit.target, k * k), speed: 1 };
    }
    const k = (elapsed - hit.at) / RECOIL_MS;
    return { at: along(hit.target, [mix(hit.target[0], HAND[0], 0.5), mix(hit.target[1], HAND[1], 0.6)], easeOut(k)), speed: 1 - k };
  }
  return null;
}

/** The lash as one filled shape that tapers from the hand to the tip, bent by how fast it moves. */
function lashPath(end: Point, speed: number): string {
  const [ax, ay] = HAND;
  const [tx, ty] = end;
  const dx = tx - ax, dy = ty - ay;
  const length = Math.hypot(dx, dy) || 1;
  const bend = (0.12 + 0.3 * speed) * Math.min(1, length);
  const mid: Point = [ax + dx * 0.45, ay + dy * 0.45];
  const normal: Point = [-dy / length, dx / length];
  const inward = normal[0] * -mid[0] + normal[1] * -mid[1] >= 0 ? 1 : -1;
  const c: Point = [mid[0] + normal[0] * bend * inward, mid[1] + normal[1] * bend * inward];
  const points: [number, number, number][] = [];
  for (let i = 0; i <= 16; i++) {
    const u = i / 16;
    points.push([
      (1 - u) * (1 - u) * ax + 2 * (1 - u) * u * c[0] + u * u * tx,
      (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * c[1] + u * u * ty,
      mix(0.085, 0.018, u),
    ]);
  }
  const left: string[] = [], right: string[] = [];
  points.forEach(([x, y, w], i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
    left.push(`${f(x + (nx * w) / 2)} ${f(y + (ny * w) / 2)}`);
    right.push(`${f(x - (nx * w) / 2)} ${f(y - (ny * w) / 2)}`);
  });
  return `M${left.join("L")}L${right.reverse().join("L")}Z`;
}

function star(x: number, y: number, outer: number, inner: number, points: number, turn = -Math.PI / 2): string {
  const corners: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = turn + (i * Math.PI) / points;
    corners.push(`${f(x + Math.cos(a) * r)} ${f(y + Math.sin(a) * r)}`);
  }
  return `M${corners.join("L")}Z`;
}

export type WhipDrawing = {
  lash: string;
  /** The crack: a ring opening out, a flash and sparks flying off, each with its opacity. */
  ring: { cx: number; cy: number; r: number; width: number; opacity: number } | null;
  flash: { d: string; opacity: number } | null;
  sparks: { d: string; opacity: number } | null;
  /** Stars circling the head while it is dizzy. */
  stars: string;
};

export function whipDrawing(elapsed: number): WhipDrawing {
  const end = tip(elapsed);
  let ring: WhipDrawing["ring"] = null, flash: WhipDrawing["flash"] = null, sparks: WhipDrawing["sparks"] = null;
  for (const hit of WHIP_HITS) {
    const dt = elapsed - hit.at;
    if (dt < 0 || dt > SPARK_MS) continue;
    const k = dt / SPARK_MS;
    const [x, y] = hit.target;
    ring = { cx: x, cy: y, r: 0.06 + 0.26 * easeOut(k), width: 0.05 * (1 - k), opacity: 1 - k };
    if (k < 0.45) flash = { d: star(x, y, 0.05 + 0.18 * (1 - 0.5 * k), 0.05 + 0.06 * (1 - 0.5 * k), 8, 0.3), opacity: 1 - k / 0.45 };
    const lines: string[] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.2;
      const d0 = 0.2 + 0.14 * easeOut(k), d1 = d0 + 0.1 * (1 - k);
      lines.push(`M${f(x + Math.cos(a) * d0)} ${f(y + Math.sin(a) * d0)}L${f(x + Math.cos(a) * d1)} ${f(y + Math.sin(a) * d1)}`);
    }
    sparks = { d: lines.join(""), opacity: 1 - k };
  }
  let stars = "";
  const pose = whipPose(elapsed);
  if (pose.dizzy > 0) {
    const turn = ((elapsed - WHIP_HITS[WHIP_HITS.length - 1].at) / 1000) * 4;
    for (let i = 0; i < 3; i++) {
      const a = turn + i * 2.094;
      stars += star(Math.cos(a) * 0.6, -0.9 + Math.sin(a) * 0.08, 0.11 * pose.dizzy, 0.045 * pose.dizzy, 5);
    }
  }
  return { lash: end ? lashPath(end.at, end.speed) : "", ring, flash, sparks, stars };
}

/** The "> <" eyes, one stroke each, at the front-facing eyes' places. */
export const HURT_EYES = "M-0.44 -0.18L-0.2 0L-0.44 0.18M0.44 -0.18L0.2 0L0.44 0.18";

/** A spiral for each eye; the mascot turns them while it is dizzy. */
export const DIZZY_EYE = "M0 0m-0.02 0a0.02 0.02 0 1 1 0.04 0a0.07 0.07 0 1 1 -0.14 0a0.12 0.12 0 1 1 0.24 0a0.16 0.16 0 1 1 -0.32 0";
