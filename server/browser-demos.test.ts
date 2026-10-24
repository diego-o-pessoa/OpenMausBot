import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DEMOS_KEPT, deleteDemo, findDemo, listDemos, loadDemo, saveDemo } from "./browser-demos.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const folders: string[] = [];
const dataDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-demos-"));
  folders.push(dir);
  return dir;
};
afterEach(async () => { for (const dir of folders.splice(0)) await removeTempDir(dir); });

const steps = [{ kind: "navigate" as const, url: "https://example.com", at: 1 }];

describe("saved demonstrations", () => {
  it("saves, finds by short id, lists newest first and deletes", () => {
    const dir = dataDir();
    const first = saveDemo(dir, "pepper", { steps, truncated: false }, 1);
    const second = saveDemo(dir, "pepper", { steps, truncated: true }, 2);
    expect(listDemos(dir, "pepper").map((demo) => demo.id)).toEqual([second.id, first.id]);
    expect(findDemo(dir, "pepper", first.id.slice(0, 8))?.id).toBe(first.id);
    expect(loadDemo(dir, "pepper", second.id)?.truncated).toBe(true);
    expect(findDemo(dir, "other", first.id.slice(0, 8))).toBeNull();
    expect(deleteDemo(dir, "pepper", first.id)).toBe(true);
    expect(loadDemo(dir, "pepper", first.id)).toBeNull();
  });

  it("keeps only the newest demonstrations", () => {
    const dir = dataDir();
    for (let i = 0; i < DEMOS_KEPT + 3; i++) saveDemo(dir, "pepper", { steps, truncated: false }, i);
    expect(listDemos(dir, "pepper")).toHaveLength(DEMOS_KEPT);
  });

  it("refuses ids that could leave its folder", () => {
    const dir = dataDir();
    expect(loadDemo(dir, "pepper", "../config")).toBeNull();
    expect(findDemo(dir, "pepper", "../../x")).toBeNull();
    expect(() => saveDemo(dir, "../escape", { steps, truncated: false })).toThrow();
  });
});
