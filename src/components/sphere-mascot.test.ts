import { describe, expect, it } from "vitest";

import { DONE_TRACK, PRESS_TRACK, TRACK_STEP_MS, WORKING_TRACK } from "./mascot-tracks";
import {
  BLINK_MS,
  HOVER_FACE,
  IDLE_FACE,
  TRACK_WRAP_MS,
  blinkOpenness,
  eyeOpacity,
  faceFromSample,
  lookToward,
  mixFace,
  moodForState,
  pillPath,
  trackDurationMs,
  trackFaceAt,
} from "./sphere-mascot";

describe("moodForState", () => {
  it("collapses every busy state into working and everything else into idle", () => {
    for (const state of ["working", "thinking", "searching", "listening", "loading", "writing", "sending"] as const) {
      expect(moodForState(state)).toBe("working");
    }
    for (const state of ["idle", "happy", "sleeping", "angry", "celebrate", "notifying", "alerting", "proud"] as const) {
      expect(moodForState(state)).toBe("idle");
    }
  });
});

describe("the measured tracks", () => {
  it("carry fourteen numbers per sample and stay inside the body", () => {
    for (const track of [WORKING_TRACK, DONE_TRACK, PRESS_TRACK]) {
      for (const sample of track) {
        expect(sample).toHaveLength(14);
        for (const eye of faceFromSample(sample).eyes) {
          expect(Math.hypot(eye.x, eye.y)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("rest at the end of the finished track exactly where the idle face rests", () => {
    const end = trackFaceAt(DONE_TRACK, trackDurationMs(DONE_TRACK, false), false);
    for (const i of [0, 1]) {
      expect(end.eyes[i].x).toBeCloseTo(IDLE_FACE.eyes[i].x, 1);
      expect(end.eyes[i].y).toBeCloseTo(IDLE_FACE.eyes[i].y, 1);
    }
  });

  it("smiles while it celebrates", () => {
    expect(trackFaceAt(DONE_TRACK, 2000, false).smile).toBe(1);
    expect(trackFaceAt(DONE_TRACK, 0, false).smile).toBe(0);
  });

  it("ducks when pressed", () => {
    const smallest = Math.min(...PRESS_TRACK.map((sample) => sample[0]));
    expect(smallest).toBeLessThan(0.75);
  });
});

describe("trackFaceAt", () => {
  it("lands on each sample and blends between neighbours", () => {
    const a = faceFromSample(WORKING_TRACK[3]);
    const b = faceFromSample(WORKING_TRACK[4]);
    expect(trackFaceAt(WORKING_TRACK, 3 * TRACK_STEP_MS, true).eyes[0].x).toBeCloseTo(a.eyes[0].x, 6);
    expect(trackFaceAt(WORKING_TRACK, 3.5 * TRACK_STEP_MS, true).eyes[0].x).toBeCloseTo((a.eyes[0].x + b.eyes[0].x) / 2, 6);
  });

  it("loops back to the start after easing across the wrap", () => {
    const total = trackDurationMs(WORKING_TRACK, true);
    expect(total).toBe((WORKING_TRACK.length - 1) * TRACK_STEP_MS + TRACK_WRAP_MS);
    expect(trackFaceAt(WORKING_TRACK, total, true).eyes[0].x).toBeCloseTo(faceFromSample(WORKING_TRACK[0]).eyes[0].x, 6);
  });
});

describe("mixFace", () => {
  it("turns an eye the short way round, since a pill has no head or tail", () => {
    const a = { ...HOVER_FACE, eyes: [{ ...HOVER_FACE.eyes[0], angle: 89 }, HOVER_FACE.eyes[1]] as const };
    const b = { ...HOVER_FACE, eyes: [{ ...HOVER_FACE.eyes[0], angle: -89 }, HOVER_FACE.eyes[1]] as const };
    expect(mixFace(a, b, 0.5).eyes[0].angle).toBeCloseTo(90, 6);
  });

  it("fades an eye in where it appears rather than sliding it across the face", () => {
    const hidden = { ...HOVER_FACE, eyes: [{ ...HOVER_FACE.eyes[0], length: 0, width: 0, x: 0, y: 0 }, HOVER_FACE.eyes[1]] as const };
    const half = mixFace(hidden, HOVER_FACE, 0.5).eyes[0];
    expect(half.x).toBe(HOVER_FACE.eyes[0].x);
    expect(half.length).toBeCloseTo(HOVER_FACE.eyes[0].length / 2, 6);
  });
});

describe("lookToward", () => {
  it("moves both eyes toward the pointer and no further than its reach", () => {
    const right = lookToward(HOVER_FACE, 5, 0);
    expect(right.eyes[0].x).toBeGreaterThan(HOVER_FACE.eyes[0].x);
    expect(right.eyes[1].x).toBeLessThanOrEqual(1);
    const down = lookToward(HOVER_FACE, 0, 0.8);
    expect(down.eyes[0].y).toBeLessThan(0);
    expect(lookToward(HOVER_FACE, 0, 0).eyes).toEqual(HOVER_FACE.eyes);
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
