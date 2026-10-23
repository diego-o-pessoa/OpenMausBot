import { describe, expect, it } from "vitest";

import { stateForBot } from "./mascot";

describe("stateForBot", () => {
  it("works only while the bot is busy", () => {
    expect(stateForBot({ name: "Atlas", busy: true })).toBe("working");
  });

  it("rests otherwise, whatever the last message or profile says", () => {
    expect(stateForBot({ name: "Atlas", messages: [{ kind: "activity", tool: { ok: false } }, { kind: "digest" }] })).toBe("idle");
    expect(stateForBot({ name: "Atlas", messages: [{ kind: "options" }, { kind: "call" }] })).toBe("idle");
    expect(stateForBot({ name: "Growth", title: "Marketing lead", unread: true })).toBe("idle");
    expect(stateForBot({ name: "Atlas", mascotExpression: "sleeping" })).toBe("idle");
  });
});
