import { describe, expect, it } from "vitest";

import { MASCOT_CLIPS } from "./mascot-clips";
import { PRESS_TRACK, TRACK_STEP_MS } from "./mascot-tracks";
import {
  BLINK_MS,
  DOT_STEP_MS,
  FRONT_FACE,
  IDLE_FACE,
  LOOK_REACH_X,
  LOOK_REACH_Y,
  activityForState,
  blinkOpenness,
  dotBeat,
  dotPose,
  eyeOpacity,
  faceFromSample,
  lookToward,
  mixFace,
  pillPath,
  trackDurationMs,
  trackFaceAt,
} from "./sphere-mascot";

describe("activityForState", () => {
  it("sorts busy states by the kind of work and everything else into idle", () => {
    expect(activityForState("thinking")).toBe("thinking");
    expect(activityForState("searching")).toBe("reading");
    expect(activityForState("working")).toBe("command");
    expect(activityForState("writing")).toBe("writing");
    expect(activityForState("radar")).toBe("looking");
    for (const state of ["idle", "happy", "sleeping", "angry", "celebrate", "notifying", "alerting", "proud"] as const) {
      expect(activityForState(state)).toBe("idle");
    }
  });
});

describe("the measured clips", () => {
  it("carry at least fourteen numbers per sample and keep the eyes inside the body", () => {
    for (const track of [...Object.values(MASCOT_CLIPS), PRESS_TRACK]) {
      expect(track.length).toBeGreaterThan(1);
      for (const sample of track) {
        expect(sample.length).toBeGreaterThanOrEqual(14);
        for (const eye of faceFromSample(sample).eyes) expect(Math.hypot(eye.x, eye.y)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("smile through the celebration and land on the resting face when they settle", () => {
    const celebrate = MASCOT_CLIPS.celebrate;
    expect(trackFaceAt(celebrate, 1000).smile).toBe(1);
    expect(trackFaceAt(celebrate, trackDurationMs(celebrate)).smile).toBe(0);
    const end = trackFaceAt(MASCOT_CLIPS.settle, trackDurationMs(MASCOT_CLIPS.settle));
    for (const i of [0, 1]) {
      expect(end.eyes[i].x).toBeCloseTo(IDLE_FACE.eyes[i].x, 1);
      expect(end.eyes[i].y).toBeCloseTo(IDLE_FACE.eyes[i].y, 1);
    }
  });

  it("hop: the body leaves the ground during the celebration", () => {
    expect(Math.max(...MASCOT_CLIPS.celebrate.map((sample) => sample[15] ?? 0))).toBeGreaterThan(0.25);
  });

  it("scan low from left to right while reading", () => {
    const xs = MASCOT_CLIPS.downScanA.map((sample) => faceFromSample(sample).eyes[0].x);
    expect(Math.min(...xs)).toBeLessThan(-0.4);
    expect(Math.max(...xs)).toBeGreaterThan(0.05);
    expect(MASCOT_CLIPS.downScanA.every((sample) => faceFromSample(sample).eyes[1].y < 0.1)).toBe(true);
  });

  it("ducks when pressed", () => {
    expect(Math.min(...PRESS_TRACK.map((sample) => sample[0]))).toBeLessThan(0.75);
  });
});

describe("trackFaceAt", () => {
  it("lands on each sample, blends between neighbours and holds the last", () => {
    const track = MASCOT_CLIPS.glanceUp;
    const a = faceFromSample(track[3]);
    const b = faceFromSample(track[4]);
    expect(trackFaceAt(track, 3 * TRACK_STEP_MS).eyes[0].x).toBeCloseTo(a.eyes[0].x, 6);
    expect(trackFaceAt(track, 3.5 * TRACK_STEP_MS).eyes[0].x).toBeCloseTo((a.eyes[0].x + b.eyes[0].x) / 2, 6);
    expect(trackFaceAt(track, 1e9)).toEqual(faceFromSample(track[track.length - 1]));
  });

  it("reads where the body has moved, and a still body from a sample without it", () => {
    const face = faceFromSample([1, 1, 1, 0, 0, 0.5, 0.3, 90, 0, 0, 0.5, 0.3, 90, 0, 0.1, -0.2]);
    expect([face.x, face.y]).toEqual([0.1, -0.2]);
    expect([faceFromSample(PRESS_TRACK[0]).x, faceFromSample(PRESS_TRACK[0]).y]).toEqual([0, 0]);
  });
});

describe("mixFace", () => {
  it("turns an eye the short way round, since a pill has no head or tail", () => {
    const a = { ...FRONT_FACE, eyes: [{ ...FRONT_FACE.eyes[0], angle: 89 }, FRONT_FACE.eyes[1]] as const };
    const b = { ...FRONT_FACE, eyes: [{ ...FRONT_FACE.eyes[0], angle: -89 }, FRONT_FACE.eyes[1]] as const };
    expect(mixFace(a, b, 0.5).eyes[0].angle).toBeCloseTo(90, 6);
  });

  it("fades an eye in where it appears rather than sliding it across the face", () => {
    const hidden = { ...FRONT_FACE, eyes: [{ ...FRONT_FACE.eyes[0], length: 0, width: 0, x: 0, y: 0 }, FRONT_FACE.eyes[1]] as const };
    const half = mixFace(hidden, FRONT_FACE, 0.5).eyes[0];
    expect(half.x).toBe(FRONT_FACE.eyes[0].x);
    expect(half.length).toBeCloseTo(FRONT_FACE.eyes[0].length / 2, 6);
  });
});

describe("lookToward", () => {
  it("follows the pointer on each axis, so a pointer far along the row turns the eyes fully that way", () => {
    const right = lookToward(FRONT_FACE, 12, 0.2);
    expect(right.eyes[0].x - FRONT_FACE.eyes[0].x).toBeCloseTo(LOOK_REACH_X + 0.05 * -FRONT_FACE.eyes[0].x, 3);
    expect(right.eyes[0].y).toBeLessThan(0);
    const below = lookToward(FRONT_FACE, 0, 5);
    expect(below.eyes[0].y).toBeCloseTo(-LOOK_REACH_Y, 6);
    expect(lookToward(FRONT_FACE, 0, 0).eyes).toEqual(FRONT_FACE.eyes);
  });

  it("narrows the eye on the side it turns toward", () => {
    const right = lookToward(FRONT_FACE, 5, 0);
    expect(right.eyes[1].width).toBeLessThan(right.eyes[0].width);
  });

  it("uses Grok's tall pills, not dots", () => {
    for (const e of FRONT_FACE.eyes) expect(e.length / e.width).toBeGreaterThan(1.8);
  });
});

describe("the thinking dots", () => {
  it("light the middle, then the right, then the left, one step apart", () => {
    const lit = (elapsed: number) => dotBeat(elapsed).map((v) => (v === 1 ? "on" : v < 0.1 ? "off" : "fading"));
    expect(lit(0)).toEqual(["off", "on", "off"]);
    expect(lit(DOT_STEP_MS)).toEqual(["off", "off", "on"]);
    expect(lit(2 * DOT_STEP_MS)).toEqual(["on", "off", "off"]);
    expect(lit(3 * DOT_STEP_MS)).toEqual(["off", "on", "off"]);
  });

  it("grow, brighten and rise as they light", () => {
    const dim = dotPose(0);
    const lit = dotPose(1);
    expect(lit.radius).toBeGreaterThan(dim.radius);
    expect(lit.opacity).toBe(1);
    expect(lit.lift).toBeGreaterThan(dim.lift);
  });
});

describe("eyes", () => {
  it("hides an eye of no length", () => {
    expect(eyeOpacity({ x: 0, y: 0, length: 0, width: 0, angle: 0 })).toBe(0);
    expect(eyeOpacity(IDLE_FACE.eyes[0])).toBe(1);
  });

  it("blinks shut halfway and opens again", () => {
    expect(blinkOpenness(0)).toBe(1);
    expect(blinkOpenness(BLINK_MS / 2)).toBeLessThan(0.15);
    expect(blinkOpenness(BLINK_MS)).toBe(1);
  });

  it("draws a dot when length and width match", () => {
    expect(pillPath(0.3, 0.3)).toContain("A0.1500 0.1500");
  });
});
