import { MASCOT_CLIPS, type MascotClipName } from "./mascot-clips";
import {
  DOTS_FACE,
  DOT_CYCLE_MS,
  FRONT_FACE,
  dotBeat,
  mixFace,
  scaleEyes,
  trackDurationMs,
  trackFaceAt,
  type Face,
  type MascotActivity,
} from "./sphere-mascot";

type Spin = "spinUp" | "spinRight";
type Gesture = MascotClipName | "dots" | Spin | "quill";

/** Which of Grok's measured gestures fit each kind of work. */
export const REPERTOIRE: Readonly<Record<Exclude<MascotActivity, "idle">, readonly Gesture[]>> = {
  thinking: ["dots", "downScanA", "downScanB", "downScanC", "ovalPonder", "shrinkPeek", "glanceLeft", "peekLeft", "spinUp"],
  reading: ["downScanA", "downScanB", "downScanC", "glanceLeft", "peekLeft", "ovalPonder"],
  command: ["attentive", "glanceUp", "frontBlink", "glanceUpAgain", "glanceUpLater", "squintGlance", "spinUp", "spinRight"],
  writing: ["quill", "frontBlink", "attentive", "quill", "downScanA", "squintGlance"],
  looking: ["lookUpRight", "glanceUpLeft", "glanceUp", "squintGlance", "glanceLeft", "spinRight"],
};

type Act =
  | { kind: "clip"; name: MascotClipName; from?: number; to?: number }
  | { kind: "fold" }
  | { kind: "dots"; ms: number }
  | { kind: "unfold" }
  | { kind: "hold"; face: Face; ms: number }
  | { kind: "spin"; name: Spin }
  | { kind: "quill" };

const FADE_MS = 250;
const FOLD_EYES_MS = 300;
const FOLD_MS = 650;
const UNFOLD_MS = 350;
/** Grok keeps its dots up while it is "Refletindo"; past this it moves on to other thinking gestures. */
const OPENING_DOTS_MS = 3 * DOT_CYCLE_MS;
const DOTS_GESTURE_MS = 2 * DOT_CYCLE_MS;
const FRONT_HOLD_MS = 1200;
const UNREPEATED = 3;
export const SPIN_MS = 950;
const QUILL_IN_MS = 420;
const QUILL_WRITE_MS = 2100;
const QUILL_OUT_MS = 420;
export const QUILL_MS = QUILL_IN_MS + QUILL_WRITE_MS + QUILL_OUT_MS;

const ease = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

/** Eyes drawn smaller than measured, by the owner's choice: the low left-to-right scans. */
const EYE_SIZE: Partial<Record<MascotClipName, number>> = { downScanA: 0.85, downScanB: 0.85, downScanC: 0.85 };

function clipFaceAt(name: MascotClipName, elapsed: number): Face {
  const face = trackFaceAt(MASCOT_CLIPS[name], elapsed);
  const size = EYE_SIZE[name];
  return size ? scaleEyes(face, size) : face;
}

function actMs(act: Act): number {
  switch (act.kind) {
    case "clip":
      return (act.to ?? trackDurationMs(MASCOT_CLIPS[act.name])) - (act.from ?? 0);
    case "fold":
      return FOLD_MS;
    case "unfold":
      return UNFOLD_MS;
    case "spin":
      return SPIN_MS;
    case "quill":
      return QUILL_MS;
    default:
      return act.ms;
  }
}

/** glanceUp ends in a blink that only pretends the sphere turned over; the real turn is spinUp. */
const CLIP_WINDOWS: Partial<Record<MascotClipName, { from?: number; to?: number }>> = { glanceUp: { to: 2600 } };

/** The hops of Grok's celebration: before and after them it only holds its smile. */
const HOPS = { from: 2200, to: 4600 };

const FINALE_ACTS: readonly Act[] = [
  { kind: "clip", name: "celebrate", ...HOPS },
  { kind: "hold", face: FRONT_FACE, ms: FRONT_HOLD_MS },
  { kind: "clip", name: "settle" },
];

/** How long the mascot performs after its work ends: the smile and hops, a moment facing front, settling. */
export const FINALE_MS = FINALE_ACTS.reduce((sum, act) => sum + actMs(act), 0);

/**
 * Plans what the mascot acts out. While it works it plays one measured gesture after another from the
 * repertoire for the work at hand, never one it played in the last few, and switches as soon as the work
 * changes; when the work ends it plays Grok's finale and then hands the face back.
 */
export class MascotDirector {
  private activity: MascotActivity = "idle";
  private act: Act | null = null;
  private queue: Act[] = [];
  private start = 0;
  private from: Face = FRONT_FACE;
  private last: Face = FRONT_FACE;
  private dotsSince = 0;
  private recent: Gesture[] = [];
  private inFinale = false;

  constructor(private readonly random: () => number = Math.random) {}

  /** The gesture playing now, for tests and previews. */
  get current(): string | null {
    if (!this.act) return null;
    return this.act.kind === "clip" || this.act.kind === "spin" ? this.act.name : this.act.kind;
  }

  setActivity(next: MascotActivity, now: number, shown: Face): void {
    if (next === this.activity) return;
    const was = this.activity;
    this.activity = next;
    if (next === "idle") {
      if (was !== "idle") this.finale(now, shown);
      return;
    }
    this.inFinale = false;
    const opening = was === "idle" && next === "thinking";
    const plan: Act[] = opening
      ? [{ kind: "fold" }, { kind: "dots", ms: OPENING_DOTS_MS }, { kind: "unfold" }]
      : next === "writing" ? this.planOf("quill") : this.pick(next);
    this.cut(plan, now, shown);
  }

  /** Plays the smile and hops on request; a finale already under way is left to finish. */
  celebrate(now: number, shown: Face): void {
    if (!this.inFinale) this.finale(now, shown);
  }

  /** The face to draw at `now`, or null when there is nothing to perform. */
  frame(now: number): Face | null {
    if (!this.act) {
      if (this.activity === "idle") return null;
      this.begin(this.pick(this.activity), now, this.last);
    }
    while (this.act && now - this.start >= actMs(this.act)) {
      const end = this.start + actMs(this.act);
      const settled = this.faceAt(this.act, actMs(this.act));
      if (this.queue.length === 0 && this.activity !== "idle") this.queue = this.pick(this.activity);
      const next = this.queue.shift();
      if (!next) {
        this.act = null;
        this.inFinale = false;
        this.last = settled;
        return null;
      }
      this.enter(next, end, settled);
    }
    if (!this.act) return null;
    this.last = this.faceAt(this.act, now - this.start);
    return this.last;
  }

  private finale(now: number, shown: Face): void {
    this.inFinale = true;
    this.cut([...FINALE_ACTS], now, shown);
  }

  private pick(activity: Exclude<MascotActivity, "idle">): Act[] {
    return this.planOf(this.choose(REPERTOIRE[activity]));
  }

  private choose(repertoire: readonly Gesture[]): Gesture {
    const fresh = repertoire.filter((gesture) => !this.recent.includes(gesture));
    const choices = fresh.length > 0 ? fresh : repertoire;
    const gesture = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
    this.recent = [gesture, ...this.recent].slice(0, UNREPEATED);
    return gesture;
  }

  private planOf(gesture: Gesture): Act[] {
    if (gesture === "dots") return [{ kind: "fold" }, { kind: "dots", ms: DOTS_GESTURE_MS }, { kind: "unfold" }];
    if (gesture === "spinUp" || gesture === "spinRight") return [{ kind: "spin", name: gesture }];
    if (gesture === "quill") return [{ kind: "quill" }];
    return [{ kind: "clip", name: gesture, ...CLIP_WINDOWS[gesture] }];
  }

  private cut(plan: Act[], now: number, shown: Face): void {
    const folded = this.act?.kind === "fold" || this.act?.kind === "dots";
    if (folded && plan[0]?.kind === "fold") {
      this.queue = plan.slice(1);
      return;
    }
    if (folded || shown.dots > 0.01) {
      this.queue = plan;
      this.enter({ kind: "unfold" }, now, shown);
      return;
    }
    this.begin(plan, now, shown);
  }

  private begin(plan: Act[], now: number, shown: Face): void {
    this.queue = plan.slice(1);
    this.enter(plan[0], now, shown);
  }

  private enter(act: Act, now: number, from: Face): void {
    this.act = act;
    this.start = now;
    this.from = from;
    if (act.kind === "fold") this.dotsSince = now + FOLD_MS;
    if (act.kind === "unfold" && this.queue.length === 0 && this.activity !== "idle") this.queue = this.pick(this.activity);
  }

  private firstFaceOf(act: Act | undefined): Face {
    if (act?.kind === "clip") return clipFaceAt(act.name, act.from ?? 0);
    if (act?.kind === "hold") return act.face;
    return FRONT_FACE;
  }

  private faceAt(act: Act, elapsed: number): Face {
    const fade = ease(elapsed / FADE_MS);
    switch (act.kind) {
      case "clip":
        return mixFace(this.from, clipFaceAt(act.name, (act.from ?? 0) + elapsed), fade);
      case "hold":
        return mixFace(this.from, act.face, fade);
      case "spin":
        return spinFace(this.from, act.name, elapsed);
      case "quill":
        return quillFace(this.from, elapsed);
      case "fold":
        if (elapsed < FOLD_EYES_MS) return mixFace(this.from, DOTS_FACE, ease(elapsed / FOLD_EYES_MS));
        return { ...DOTS_FACE, dots: ease((elapsed - FOLD_EYES_MS) / (FOLD_MS - FOLD_EYES_MS)), beat: [0, 1, 0] };
      case "dots":
        return { ...DOTS_FACE, dots: 1, beat: dotBeat(this.start + elapsed - this.dotsSince) };
      case "unfold":
        return {
          ...this.firstFaceOf(this.queue[0]),
          dots: this.from.dots * (1 - ease(elapsed / UNFOLD_MS)),
          beat: dotBeat(this.start + elapsed - this.dotsSince),
        };
    }
  }
}

/**
 * A full turn of the sphere, fast in the middle, with speed lines trailing it. The turn itself is never faded
 * in from the previous face: blending a turn would run it the short way round, backwards.
 */
function spinFace(from: Face, name: Spin, elapsed: number): Face {
  const t = Math.min(1, elapsed / SPIN_MS);
  const turn = t >= 1 ? 0 : ease(t);
  const rush = t >= 1 ? 0 : Math.sin(Math.PI * t);
  const up = name === "spinUp";
  const front = mixFace(from, FRONT_FACE, ease(elapsed / FADE_MS));
  return {
    ...front,
    stretchX: front.stretchX * (up ? 1 - 0.05 * rush : 1 + 0.07 * rush),
    stretchY: front.stretchY * (up ? 1 + 0.07 * rush : 1 - 0.05 * rush),
    y: front.y + (up ? 0.16 * rush : 0),
    x: front.x + (up ? 0 : 0.1 * rush),
    roll: up ? turn : 0,
    yaw: up ? 0 : turn,
    wind: rush === 0 ? 0 : up ? rush : -rush,
  };
}

/** A gesture the director stages itself, `elapsed` ms in, starting from the front face: for previews and tests. */
export function stagedFace(gesture: Spin | "quill", elapsed: number): Face {
  return gesture === "quill" ? quillFace(FRONT_FACE, elapsed) : spinFace(FRONT_FACE, gesture, elapsed);
}

/** The body narrows into a quill, writes a line, and swells back into itself. */
function quillFace(from: Face, elapsed: number): Face {
  const front = mixFace(from, FRONT_FACE, ease(elapsed / FADE_MS));
  const into = ease(elapsed / QUILL_IN_MS);
  const back = ease((elapsed - QUILL_IN_MS - QUILL_WRITE_MS) / QUILL_OUT_MS);
  return {
    ...front,
    quill: into * (1 - back),
    ink: Math.max(0, Math.min(1, (elapsed - QUILL_IN_MS) / QUILL_WRITE_MS)),
  };
}

const shared = new Map<string, { director: MascotDirector; users: number }>();

/**
 * The director for one agent, shared by every mascot that shows it (sidebar row, chat header, chat), so all
 * of them play the same gesture at the same moment. Without a key the mascot gets its own.
 */
export function leaseDirector(key: string | undefined): { director: MascotDirector; release: () => void } {
  if (!key) return { director: new MascotDirector(), release: () => {} };
  const entry = shared.get(key) ?? { director: new MascotDirector(), users: 0 };
  entry.users += 1;
  shared.set(key, entry);
  let released = false;
  return {
    director: entry.director,
    release: () => {
      if (released) return;
      released = true;
      entry.users -= 1;
      if (entry.users === 0 && shared.get(key) === entry) shared.delete(key);
    },
  };
}
