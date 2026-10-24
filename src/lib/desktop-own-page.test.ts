import { afterEach, expect, it, vi } from "vitest";
import { ownDesktopPage } from "./desktop";

afterEach(() => vi.unstubAllGlobals());

it("is true only in the desktop window on its own server", () => {
  vi.stubGlobal("window", {});
  expect(ownDesktopPage()).toBe(false);
  vi.stubGlobal("window", { ogb: { platform: "linux" } });
  expect(ownDesktopPage()).toBe(false);
  vi.stubGlobal("window", { ogb: { remoteClient: { active: true } } });
  expect(ownDesktopPage()).toBe(false);
  vi.stubGlobal("window", { ogb: { remoteClient: { active: false } } });
  expect(ownDesktopPage()).toBe(true);
});
