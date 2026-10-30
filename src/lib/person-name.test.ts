import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../state/store";
import { devicePersonName, setDevicePersonName } from "./person-name";

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the name of the person at this computer", () => {
  it("goes with every request, percent-encoded, once the person sets it", async () => {
    const fetch = vi.fn(async (_path: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await api("/api/threads");
    setDevicePersonName("  João   Kayky ");
    expect(devicePersonName()).toBe("João Kayky");
    await api("/api/bots/b1/messages", { method: "POST", body: "{}" });
    const sent = fetch.mock.calls.map(([, init]) => new Headers(init?.headers).get("x-openmausbot-person"));
    expect(sent).toEqual([null, "Jo%C3%A3o%20Kayky"]);
  });

  it("clears with an empty name and keeps it short", () => {
    setDevicePersonName("x".repeat(100));
    expect(devicePersonName()).toHaveLength(60);
    setDevicePersonName("   ");
    expect(devicePersonName()).toBe("");
  });
});
