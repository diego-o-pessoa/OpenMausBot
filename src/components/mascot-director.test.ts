import { describe, expect, it } from "vitest";

import { MASCOT_CLIPS } from "./mascot-clips";
import { FINALE_MS, IDLE_GESTURES, MascotDirector, QUILL_MS, REPERTOIRE, SPIN_MS, leaseDirector, stagedFace } from "./mascot-director";
import { IDLE_FACE, trackDurationMs, trackFaceAt } from "./sphere-mascot";

const sequence = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

/** Steps a director through `ms` and lists every gesture it played, in order. */
function watch(director: MascotDirector, from: number, ms: number): string[] {
  const seen: string[] = [];
  for (let t = from; t <= from + ms; t += 50) {
    director.frame(t);
    const now = director.current;
    if (now && seen[seen.length - 1] !== now) seen.push(now);
  }
  return seen;
}

describe("MascotDirector", () => {
  it("rests until there is work, and opens a turn of thinking by folding into its dots", () => {
    const director = new MascotDirector(sequence([0]));
    expect(director.frame(0)).toBeNull();
    director.setActivity("thinking", 0, IDLE_FACE);
    expect(director.current).toBe("fold");
    const folded = director.frame(700)!;
    expect(folded.dots).toBe(1);
    expect(director.current).toBe("dots");
  });

  it("plays only gestures that fit the work, never one of the last three again", () => {
    const director = new MascotDirector(sequence([0.1, 0.5, 0.9, 0.3, 0.7]));
    director.setActivity("reading", 0, IDLE_FACE);
    const played = watch(director, 0, 60_000);
    expect(played.length).toBeGreaterThan(6);
    for (const gesture of played) expect(REPERTOIRE.reading).toContain(gesture);
    for (let i = 1; i < played.length; i++) expect(played.slice(Math.max(0, i - 3), i)).not.toContain(played[i]);
  });

  it("switches gesture as soon as the work changes", () => {
    const director = new MascotDirector(sequence([0]));
    director.setActivity("reading", 0, IDLE_FACE);
    director.frame(100);
    director.setActivity("command", 200, director.frame(200)!);
    expect(REPERTOIRE.command).toContain(director.current);
  });

  it("unfolds its dots before moving on when the work changes mid-thought", () => {
    const director = new MascotDirector(sequence([0]));
    director.setActivity("thinking", 0, IDLE_FACE);
    const dotted = director.frame(1000)!;
    director.setActivity("command", 1000, dotted);
    expect(director.current).toBe("unfold");
    expect(director.frame(1500)!.dots).toBe(0);
    expect(REPERTOIRE.command).toContain(director.current);
  });

  it("finishes a turn as Grok does: typing, the smile and hops, facing front, then settling, then rests", () => {
    const director = new MascotDirector(sequence([0.4]));
    director.setActivity("command", 0, IDLE_FACE);
    director.frame(500);
    director.setActivity("idle", 500, director.frame(500)!);
    expect(watch(director, 500, FINALE_MS + 200)).toEqual(["typing", "celebrate", "hold", "settle"]);
    expect(director.frame(500 + FINALE_MS + 300)).toBeNull();
  });

  it("goes straight from its dots into typing when a short reply arrives", () => {
    const director = new MascotDirector(sequence([0]));
    director.setActivity("thinking", 0, IDLE_FACE);
    director.setActivity("idle", 1500, director.frame(1500)!);
    expect(watch(director, 1500, 2000).slice(0, 3)).toEqual(["unfold", "typing", "celebrate"]);
  });

  it("does not restart a celebration already under way", () => {
    const director = new MascotDirector(sequence([0]));
    director.setActivity("command", 0, IDLE_FACE);
    director.setActivity("idle", 100, director.frame(100)!);
    const typingMs = trackDurationMs(MASCOT_CLIPS.typing);
    director.frame(100 + typingMs + 500);
    director.celebrate(100 + typingMs + 500, IDLE_FACE);
    expect(director.current).toBe("celebrate");
    expect(director.frame(100 + FINALE_MS + 100)).toBeNull();
  });
});

describe("leaseDirector", () => {
  it("gives every mascot of one agent the same director until the last lets go", () => {
    const a = leaseDirector("bot-1");
    const b = leaseDirector("bot-1");
    expect(b.director).toBe(a.director);
    expect(leaseDirector("bot-2").director).not.toBe(a.director);
    a.release();
    expect(leaseDirector("bot-1").director).toBe(b.director);
    b.release();
    expect(leaseDirector(undefined).director).not.toBe(leaseDirector(undefined).director);
  });
});

describe("the low scans", () => {
  it("draw their eyes a little smaller than measured", () => {
    const director = new MascotDirector(() => 0);
    director.setActivity("reading", 0, IDLE_FACE);
    expect(director.current).toBe("downScanA");
    const drawn = director.frame(1000)!;
    const measured = trackFaceAt(MASCOT_CLIPS.downScanA, 1000);
    expect(drawn.eyes[0].length).toBeCloseTo(measured.eyes[0].length * 0.85, 3);
  });
});

describe("the new gestures", () => {
  it("turns into a quill as soon as it starts writing, writes its line, then is itself again", () => {
    const director = new MascotDirector(sequence([0.5]));
    director.setActivity("writing", 0, IDLE_FACE);
    expect(director.current).toBe("quill");
    const writing = director.frame(QUILL_MS / 2)!;
    expect(writing.quill).toBe(1);
    expect(writing.ink).toBeGreaterThan(0.3);
    expect(writing.ink).toBeLessThan(0.7);
    expect(stagedFace("quill", QUILL_MS).quill).toBe(0);
    expect(stagedFace("quill", QUILL_MS).ink).toBe(1);
  });

  it("spins a whole turn, fastest in the middle, with the wind behind it, and ends facing front", () => {
    const up = [0, SPIN_MS / 4, SPIN_MS / 2, (3 * SPIN_MS) / 4].map((t) => stagedFace("spinUp", t));
    expect(up.map((face) => face.roll)).toEqual(up.map((face) => face.roll).sort((a, b) => a - b));
    expect(up[2].roll).toBeCloseTo(0.5, 5);
    expect(up[2].wind).toBeCloseTo(1, 5);
    expect(up.every((face) => face.yaw === 0)).toBe(true);
    const right = stagedFace("spinRight", SPIN_MS / 2);
    expect(right).toMatchObject({ roll: 0, wind: -1 });
    expect(right.yaw).toBeCloseTo(0.5, 5);
    for (const gesture of ["spinUp", "spinRight"] as const) expect(stagedFace(gesture, SPIN_MS)).toMatchObject({ roll: 0, yaw: 0, wind: 0 });
  });

  it("names a spin by its direction while it plays", () => {
    const director = new MascotDirector(sequence([0.99]));
    director.setActivity("looking", 0, IDLE_FACE);
    expect(director.current).toBe("spinRight");
  });

  it("stirs now and then while resting, but never over work", () => {
    const resting = new MascotDirector(sequence([0]));
    resting.stir(0, IDLE_FACE);
    expect(IDLE_GESTURES).toContain(resting.current);
    const working = new MascotDirector(sequence([0]));
    working.setActivity("reading", 0, IDLE_FACE);
    const before = working.current;
    working.stir(10, IDLE_FACE);
    expect(working.current).toBe(before);
  });
});
