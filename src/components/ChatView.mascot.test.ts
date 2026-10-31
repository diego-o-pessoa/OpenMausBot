import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";

const seen = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { avatars: [] as { state?: string; animated?: boolean }[] };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo] },
    dispatch: vi.fn(),
  }) };
});
vi.mock("./Avatar", async (importOriginal) => ({
  ...await importOriginal<typeof import("./Avatar")>(),
  BotAvatar: (props: { state?: string; animated?: boolean }) => { seen.avatars.push({ state: props.state, animated: props.animated }); return null; },
}));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true, useReactor: () => "user" }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const { ChatView } = await import("./ChatView");
afterAll(() => vi.unstubAllGlobals());

const done: Message = { id: "a", role: "bot", kind: "text", text: "Done.", at: 2, turnTerminal: true };
const agent = (routineBusy: boolean): Bot => ({
  id: "bot", threadId: "chat", name: "Samu", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: routineBusy, activity: routineBusy ? "working" : "idle",
  messages: [done], activeLeafId: "a", modelSelection: { instanceId: "test", model: "m" },
  tasks: [
    { threadId: "chat", title: "Chat", busy: false, activity: "idle" },
    { threadId: "routine", title: "Rotina", busy: routineBusy, activity: routineBusy ? "working" : "idle" },
  ] as Bot["tasks"],
});
const headerAvatars = (bot: Bot) => {
  seen.avatars = [];
  renderToStaticMarkup(createElement(ChatView, { bot }));
  return seen.avatars;
};

it("keeps the agent's header mascot working while a routine runs in another chat", () => {
  const avatars = headerAvatars(agent(true));
  expect(avatars.length).toBeGreaterThan(0);
  // Same reading as the sidebar row: busy agent, open chat idle -> not "idle", so no finale on open.
  for (const avatar of avatars) {
    expect(avatar.state).not.toBe("idle");
    expect(avatar.animated).toBe(true);
  }
});

it("rests the header mascot once the agent has nothing running", () => {
  for (const avatar of headerAvatars(agent(false))) expect(avatar.state).toBe("idle");
});
