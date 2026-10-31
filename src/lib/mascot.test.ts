import { describe, expect, it } from "vitest";

import { stateForBot } from "./mascot";

const running = (name: string) => ({ kind: "activity", role: "bot" as const, tool: { name } });

describe("stateForBot", () => {
  it("thinks while the turn has no tool running", () => {
    expect(stateForBot({ name: "Atlas", busy: true })).toBe("thinking");
    expect(stateForBot({ name: "Atlas", busy: true, messages: [{ kind: "text", role: "user" }] })).toBe("thinking");
    expect(stateForBot({ name: "Atlas", busy: true, messages: [{ kind: "activity", tool: { name: "bash", ok: true } }] })).toBe("thinking");
  });

  it("keeps thinking while its reply comes in: the quill is for writing files", () => {
    expect(stateForBot({ name: "Atlas", busy: true, messages: [{ kind: "text", role: "bot" }] })).toBe("thinking");
    expect(stateForBot({ name: "Atlas", busy: true, messages: [{ kind: "text", role: "bot" }, { kind: "digest" }] })).toBe("thinking");
  });

  it("acts out the kind of tool that is running", () => {
    expect(stateForBot({ name: "Atlas", busy: true, messages: [running("Bash")] })).toBe("working");
    expect(stateForBot({ name: "Atlas", busy: true, messages: [running("Read")] })).toBe("searching");
    expect(stateForBot({ name: "Atlas", busy: true, messages: [running("web_search")] })).toBe("searching");
    expect(stateForBot({ name: "Atlas", busy: true, messages: [running("Edit")] })).toBe("writing");
    expect(stateForBot({ name: "Atlas", busy: true, messages: [running("mcp__browser__screenshot")] })).toBe("radar");
    expect(stateForBot({ name: "Atlas", busy: true, messages: [running("delegate_bot")] })).toBe("working");
  });

  it("rests otherwise, whatever the last message or profile says", () => {
    expect(stateForBot({ name: "Atlas", messages: [{ kind: "activity", tool: { ok: false } }, { kind: "digest" }] })).toBe("idle");
    expect(stateForBot({ name: "Atlas", messages: [{ kind: "options" }, { kind: "call" }] })).toBe("idle");
    expect(stateForBot({ name: "Growth", title: "Marketing lead", unread: true })).toBe("idle");
    expect(stateForBot({ name: "Atlas", mascotExpression: "sleeping" })).toBe("idle");
  });
});
