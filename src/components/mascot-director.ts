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

type Gesture = MascotClipName | "dots";

/** Which of Grok's measured gestures fit each kind of work. */
export const REPERTOIRE: Readonly<Record<Exclude<MascotActivity, "idle">, readonly Gesture[]>> = {
  thinking: ["dots", "downScanA", "downScanB", "downScanC", "ovalPonder", "shrinkPeek", "glanceLeft", "peekLeft"],
  reading: ["downScanA", "downScanB", "downScanC", "glanceLeft", "peekLeft", "ovalPonder"],
  command: ["attentive", "glanceUp", "frontBlink", "glanceUpAgain", "rollThrough", "glanceUpLater", "rollDown", "squintGlance", "dropAndBack"],
  writing: ["frontBlink", "attentive", "downScanA", "downScanC", "squintGlance"],
  looking: ["rollAway", "lookUpRight", "glanceUpLeft", "glanceUp", "squintGlance", "glanceLeft"],
};

type Act =
  | { kind: "clip"; name: MascotClipName }
  | { kind: "fold" }
  | { kind: "dots"; ms: number }
  | { kind: "unfold" }
  | { kind: "hold"; face: Face; ms: number };

const FADE_MS = 250;
const FOLD_EYES_MS = 300;
const FOLD_MS = 650;
const UNFOLD_MS = 350;
/** Grok keeps its dots up while it is "Refletindo"; past this it moves on to other thinking gestures. */
const OPENING_DOTS_MS = 3 * DOT_CYCLE_MS;
const DOTS_GESTURE_MS = 2 * DOT_CYCLE_MS;
const FRONT_HOLD_MS = 5000;
const UNREPEATED = 3;

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
      return trackDurationMs(MASCOT_CLIPS[act.name]);
    case "fold":
      return FOLD_MS;
    case "unfold":
      return UNFOLD_MS;
    default:
      return act.ms;
  }
}

const FINALE_ACTS: readonly Act[] = [
  { kind: "clip", name: "celebrate" },
  { kind: "hold", face: FRONT_FACE, ms: FRONT_HOLD_MS },
  { kind: "clip", name: "settle" },
];

/** How long the mascot performs after its work ends: typing, the smile and hops, facing front, settling. */
export const FINALE_MS = actMs({ kind: "clip", name: "typing" }) + FINALE_ACTS.reduce((sum, act) => sum + actMs(act), 0);

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
    return this.act.kind === "clip" ? this.act.name : this.act.kind;
  }

  setActivity(next: MascotActivity, now: number, shown: Face): void {
    if (next === this.activity) return;
    const was = this.activity;
    this.activity = next;
    if (next === "idle") {
      if (was !== "idle") this.finale(now, shown, true);
      return;
    }
    this.inFinale = false;
    const opening = was === "idle" && next === "thinking";
    this.cut(opening ? [{ kind: "fold" }, { kind: "dots", ms: OPENING_DOTS_MS }, { kind: "unfold" }] : this.pick(next), now, shown);
  }

  /** Plays the smile and hops on request; a finale already under way is left to finish. */
  celebrate(now: number, shown: Face): void {
    if (!this.inFinale) this.finale(now, shown, false);
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

  private finale(now: number, shown: Face, typed: boolean): void {
    this.inFinale = true;
    this.cut([...(typed ? [{ kind: "clip", name: "typing" } as const] : []), ...FINALE_ACTS], now, shown);
  }

  private pick(activity: Exclude<MascotActivity, "idle">): Act[] {
    const repertoire = REPERTOIRE[activity];
    const fresh = repertoire.filter((gesture) => !this.recent.includes(gesture));
    const choices = fresh.length > 0 ? fresh : repertoire;
    const gesture = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
    this.recent = [gesture, ...this.recent].slice(0, UNREPEATED);
    return gesture === "dots"
      ? [{ kind: "fold" }, { kind: "dots", ms: DOTS_GESTURE_MS }, { kind: "unfold" }]
      : [{ kind: "clip", name: gesture }];
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
    if (act?.kind === "clip") return clipFaceAt(act.name, 0);
    if (act?.kind === "hold") return act.face;
    return FRONT_FACE;
  }

  private faceAt(act: Act, elapsed: number): Face {
    const fade = ease(elapsed / FADE_MS);
    switch (act.kind) {
      case "clip":
        return mixFace(this.from, clipFaceAt(act.name, elapsed), fade);
      case "hold":
        return mixFace(this.from, act.face, fade);
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
