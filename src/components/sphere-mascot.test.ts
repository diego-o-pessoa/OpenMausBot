import { describe, expect, it } from "vitest";

import {
  BLINK_MS,
  DONE_FRONT_MS,
  DONE_HOPS_MS,
  DONE_MS,
  DONE_SMILE_MS,
  EYE_SPHERE,
  FRONT_POSE,
  HAPPY_POSE,
  IDLE_POSE,
  REST_BODY,
  WORKING_GLANCES,
  blinkOpenness,
  doneBodyAt,
  donePoseAt,
  eyeLengthScale,
  eyeOpacity,
  moodForState,
  pickGlance,
  pillPath,
  placeEyes,
} from "./sphere-mascot";

const DEG = Math.PI / 180;

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

describe("placeEyes", () => {
  it("puts a front-facing pair level and symmetric about the centre", () => {
    const [left, right] = placeEyes(FRONT_POSE, 100, 100, 50);
    expect(left.matrix[5]).toBeCloseTo(100, 6);
    expect(right.matrix[5]).toBeCloseTo(100, 6);
    expect(left.matrix[4] - 100).toBeCloseTo(-(right.matrix[4] - 100), 6);
    expect(right.matrix[4] - 100).toBeCloseTo(0.31 * 50, 4);
    expect(left.depth).toBeGreaterThan(0.85);
  });

  it("keeps a front-facing eye upright and unsquashed", () => {
    const [, right] = placeEyes(FRONT_POSE, 0, 0, 1);
    const [a, b, c, d] = right.matrix;
    expect(Math.hypot(c, d)).toBeCloseTo(1, 6);
    expect(b).toBeCloseTo(0, 6);
    expect(c).toBeCloseTo(0, 6);
    expect(Math.hypot(a, b)).toBeGreaterThan(0.85);
  });

  it("rests the idle pair in the upper-right quadrant, the outer eye higher", () => {
    const [inner, outer] = placeEyes(IDLE_POSE, 0, 0, 1);
    for (const eye of [inner, outer]) {
      expect(eye.matrix[4]).toBeGreaterThan(0);
      expect(eye.matrix[5]).toBeLessThan(0);
    }
    expect(outer.matrix[5]).toBeLessThan(inner.matrix[5]);
    expect(Math.hypot(outer.matrix[4], outer.matrix[5])).toBeLessThanOrEqual(EYE_SPHERE + 1e-9);
  });

  it("hides the eyes when the face turns away", () => {
    const away = { ...FRONT_POSE, yaw: 160 * DEG };
    for (const eye of placeEyes(away, 0, 0, 1)) expect(eyeOpacity(eye.depth)).toBe(0);
    for (const eye of placeEyes(FRONT_POSE, 0, 0, 1)) expect(eyeOpacity(eye.depth)).toBe(1);
  });
});

describe("eyeLengthScale", () => {
  it("leaves a front face alone and collapses a glance up into dashes", () => {
    expect(eyeLengthScale(FRONT_POSE)).toBe(1);
    expect(eyeLengthScale({ ...FRONT_POSE, pitch: 45 * DEG })).toBeLessThan(0.5);
  });

  it("never shrinks the resting pose", () => {
    expect(eyeLengthScale(IDLE_POSE)).toBe(1);
  });
});

describe("blinkOpenness", () => {
  it("closes to a slit halfway and opens again", () => {
    expect(blinkOpenness(-1)).toBe(1);
    expect(blinkOpenness(0)).toBe(1);
    expect(blinkOpenness(BLINK_MS / 2)).toBeLessThan(0.1);
    expect(blinkOpenness(BLINK_MS)).toBe(1);
  });
});

describe("the finished-work celebration", () => {
  it("smiles, then faces front, then hands back to the resting pose", () => {
    expect(donePoseAt(0)).toBe(HAPPY_POSE);
    expect(donePoseAt(DONE_SMILE_MS - 1)).toBe(HAPPY_POSE);
    expect(donePoseAt(DONE_SMILE_MS)).toBe(FRONT_POSE);
    expect(donePoseAt(DONE_SMILE_MS + DONE_FRONT_MS - 1)).toBe(FRONT_POSE);
    expect(donePoseAt(DONE_MS)).toBeNull();
  });

  it("squashes then stretches on each hop and rests between them", () => {
    expect(doneBodyAt(0)).toBe(REST_BODY);
    const squash = doneBodyAt(DONE_HOPS_MS[0] + 110);
    expect(squash.scaleX).toBeGreaterThan(1);
    expect(squash.scaleY).toBeLessThan(1);
    const stretch = doneBodyAt(DONE_HOPS_MS[0] + 300);
    expect(stretch.scaleY).toBeGreaterThan(1);
    expect(stretch.lift).toBeGreaterThan(0);
    expect(doneBodyAt(DONE_HOPS_MS[1] - 1)).toBe(REST_BODY);
  });
});

describe("pickGlance", () => {
  it("never repeats the glance it is leaving", () => {
    for (const previous of WORKING_GLANCES) {
      for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
        expect(pickGlance(() => roll, previous)).not.toBe(previous);
      }
    }
  });
});

describe("pillPath", () => {
  it("draws a dot when width and height match", () => {
    expect(pillPath(0.3, 0.3)).toContain("A0.1500 0.1500");
  });
});
