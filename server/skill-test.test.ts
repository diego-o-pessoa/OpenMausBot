import { describe, expect, it } from "vitest";

import { expandLearnTurnText } from "./skill-learn.ts";
import { SKILL_TEST_MARKER, parseSkillTestCommand, skillTestCommand, skillTestPrompt, skillTestStatus } from "./skill-test.ts";
import type { StagedSkillWrite } from "./skills.ts";

const ID = "5d6c0a1e-1b2c-4d3e-8f90-0123456789ab";
const staged: StagedSkillWrite = {
  id: ID, action: "create", name: "add-lead", gist: "Adds a lead", source: "demonstration",
  files: [{ path: "SKILL.md", content: "---\nname: add-lead\ndescription: Adds a lead.\n---\n\n# Add lead\n" }],
  sha256: "a".repeat(64), warnings: [], skippedFiles: [], createdAt: "2026-10-24T00:00:00.000Z",
};

describe("/test-skill", () => {
  it("reads the proposal id and an optional input", () => {
    expect(parseSkillTestCommand(skillTestCommand(ID, "Ana, ana@acme.com"))).toEqual({ stagedId: ID, request: "Ana, ana@acme.com" });
    expect(parseSkillTestCommand(`/test-skill ${ID.toUpperCase()}`)).toEqual({ stagedId: ID, request: "" });
    expect(parseSkillTestCommand("/test-skill add-lead")).toBeNull();
  });

  it("runs the pending proposal's own text once, with the result line a card can read", () => {
    const text = expandLearnTurnText(skillTestCommand(ID, "Ana"), () => null, (id) => (id === ID ? staged : null));
    expect(text.startsWith(SKILL_TEST_MARKER)).toBe(true);
    expect(text).toContain("# Add lead");
    expect(text).toContain("USE THIS INPUT: Ana");
    expect(text).toContain("Do not create, update or enable any skill");
    expect(text).toContain("Skill test: passed");
  });

  it("refuses a proposal that is no longer pending", () => {
    expect(skillTestPrompt(null, "")).toContain("no longer pending");
    expect(expandLearnTurnText(skillTestCommand(ID), () => null, () => null)).toContain("Do not run anything");
  });
});

describe("skillTestStatus", () => {
  const start = { role: "user", kind: "text", text: skillTestCommand(ID), at: 10 };
  const thread = (messages: Array<Record<string, unknown>>, busy = false) => ({ threadId: "t1", busy, messages: messages as never });

  it("is none until a test starts, and running until the bot has answered", () => {
    expect(skillTestStatus([thread([{ role: "user", kind: "text", text: "hi", at: 1 }])], ID)).toEqual({ status: "none" });
    expect(skillTestStatus([thread([start])], ID)).toEqual({ status: "running", threadId: "t1" });
    expect(skillTestStatus([thread([start, { role: "bot", kind: "text", text: "Working…", at: 11 }], true)], ID)).toEqual({ status: "running", threadId: "t1" });
  });

  it("reads passed and failed, with the reason", () => {
    expect(skillTestStatus([thread([start, { role: "bot", kind: "text", text: "Done.\nSkill test: passed", at: 20 }])], ID)).toEqual({ status: "passed", threadId: "t1", at: 20 });
    expect(skillTestStatus([thread([start, { role: "bot", kind: "text", text: "Skill test: failed — the Save button is gone", at: 21 }])], ID))
      .toEqual({ status: "failed", threadId: "t1", at: 21, reason: "the Save button is gone" });
  });

  it("counts a finished test without a result line as failed", () => {
    expect(skillTestStatus([thread([start, { role: "bot", kind: "text", text: "I could not finish.", at: 30 }])], ID)).toMatchObject({ status: "failed", reason: "The test ended without a result line." });
  });

  it("follows the newest test of the proposal", () => {
    const older = { threadId: "old", busy: false, messages: [{ ...start, at: 1 }, { role: "bot", kind: "text", text: "Skill test: failed — x", at: 2 }] as never };
    const newer = { threadId: "new", busy: false, messages: [{ ...start, at: 50 }, { role: "bot", kind: "text", text: "Skill test: passed", at: 60 }] as never };
    expect(skillTestStatus([older, newer], ID)).toMatchObject({ status: "passed", threadId: "new" });
    expect(skillTestStatus([newer, older], ID)).toMatchObject({ status: "passed", threadId: "new" });
  });
});
