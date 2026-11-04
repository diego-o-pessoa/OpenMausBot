import { describe, expect, it } from "vitest";

import { MascotDirector, REPERTOIRE, WHIP_REST_MS, stagedFace } from "./mascot-director";
import { WHIP_HITS, WHIP_MS, whipDrawing, whipPose } from "./mascot-whip";
import { IDLE_FACE } from "./sphere-mascot";

describe("the whip", () => {
  it("squashes the body a different way at each crack, then settles back", () => {
    const [top, side, diagonal] = WHIP_HITS.map((hit) => whipPose(hit.at + 15));
    expect(top.stretchY).toBeLessThan(0.7);      // from above: flat
    expect(top.stretchX).toBeGreaterThan(1.25);
    expect(side.stretchX).toBeLessThan(0.75);     // from the side: squeezed and pushed
    expect(side.x).toBeLessThan(-0.2);
    expect(Math.abs(diagonal.skew)).toBeGreaterThan(15); // on the diagonal: bent
    const after = whipPose(WHIP_MS);
    expect(Math.abs(after.stretchX - 1)).toBeLessThan(0.02);
    expect(Math.abs(after.stretchY - 1)).toBeLessThan(0.02);
    expect(Math.abs(after.skew)).toBeLessThan(0.5);
  });

  it("winces at each crack, ends dizzy with stars, then is itself again", () => {
    for (const hit of WHIP_HITS) expect(whipPose(hit.at + 100).hurt).toBe(1);
    const dizzy = WHIP_HITS[2].at + 600;
    expect(whipPose(dizzy).dizzy).toBe(1);
    expect(whipDrawing(dizzy).stars).not.toBe("");
    const end = whipPose(WHIP_MS);
    expect(end.hurt).toBe(0);
    expect(end.dizzy).toBe(0);
  });

  it("cracks on the body: the lash reaches each target with a flash, and the whip is away at the end", () => {
    for (const hit of WHIP_HITS) {
      const crack = whipDrawing(hit.at + 20);
      expect(crack.lash).not.toBe("");
      expect(crack.ring?.cx).toBeCloseTo(hit.target[0]);
      expect(crack.flash).not.toBeNull();
    }
    expect(whipDrawing(WHIP_MS).lash).toBe("");
    // the whip and the stars stay inside the mascot's square (1.13 radii), off the text beside it
    for (let t = 0; t <= WHIP_MS; t += 20) {
      const { lash, stars } = whipDrawing(t);
      for (const n of (`${lash} ${stars}`.match(/-?\d+\.\d+/g) ?? []).map(Number)) expect(Math.abs(n)).toBeLessThan(1.13);
    }
  });

  it("is one of the working gestures, at most once per stretch of rest", () => {
    expect(REPERTOIRE.command).toContain("whip");
    expect(REPERTOIRE.looking).toContain("whip");
    expect(REPERTOIRE.writing).not.toContain("whip");
    const at = REPERTOIRE.looking.indexOf("whip");
    const director = new MascotDirector(() => (at + 0.5) / REPERTOIRE.looking.length); // always asks for the whip
    director.setActivity("looking", 10, IDLE_FACE);
    const seen: string[] = [];
    for (let t = 10; t <= WHIP_REST_MS - 1000; t += 50) {
      director.frame(t);
      if (director.current && seen.at(-1) !== director.current) seen.push(director.current);
    }
    expect(seen.filter((gesture) => gesture === "whip").length).toBeLessThanOrEqual(1);
    expect(stagedFace("whip", WHIP_HITS[0].at + 15).whip).toBe(WHIP_HITS[0].at + 15);
  });

  it("plays to the end even when the work switches between tools under it", () => {
    const at = REPERTOIRE.looking.indexOf("whip");
    const director = new MascotDirector(() => (at + 0.5) / REPERTOIRE.looking.length);
    director.setActivity("looking", 0, IDLE_FACE);
    expect(director.current).toBe("whip");
    // a busy agent flips between thinking and a tool every few hundred ms
    for (let t = 300; t < WHIP_MS - 100; t += 300) {
      director.setActivity(t % 600 ? "thinking" : "command", t, director.frame(t)!);
      expect(director.current).toBe("whip");
    }
    for (const hit of WHIP_HITS) expect(director.frame(hit.at + 15)!.whip).toBe(hit.at + 15);
  });
});
