// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MausAvatar, type MausAvatarHandle, type MausAvatarProps } from "./Avatar";
import { FINALE_MS } from "./mascot-director";
import { IDLE_FACE, pillPath } from "./sphere-mascot";
import { mascotClock } from "./mascot-clock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const observed: { callback: ((entries: Array<{ target: Element; isIntersecting: boolean }>) => void) | null } = { callback: null };
class FakeIntersectionObserver {
  constructor(callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void) {
    observed.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

let reducedMotion = false;
const motionListeners = new Set<() => void>();
vi.stubGlobal("matchMedia", (query: string) => ({
  get matches() { return query.includes("reduce") && reducedMotion; },
  addEventListener: (_: string, listener: () => void) => motionListeners.add(listener),
  removeEventListener: (_: string, listener: () => void) => motionListeners.delete(listener),
}));

let frameRequests = 0;
let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    frameRequests++;
    return raf(callback);
  };
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  frameRequests = 0;
  reducedMotion = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (avatars: Array<Partial<MausAvatarProps> & { ref?: React.Ref<MausAvatarHandle> }>) =>
  act(() => root.render(avatars.map((props, key) => createElement(MausAvatar, { key, color: "green", ...props }))));
const run = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const eyePaths = () => [...host.querySelectorAll("svg")].map((svg) => svg.querySelector("g[clip-path] path")!.getAttribute("d"));

describe("the mascot on the shared clock", () => {
  it("draws every animated mascot from one animation frame", () => {
    render(Array.from({ length: 12 }, () => ({ state: "working" as const, size: 36 })));
    run(100);
    frameRequests = 0;
    run(1000);
    expect(frameRequests).toBeGreaterThan(30);
    expect(frameRequests).toBeLessThanOrEqual(70);
    expect(mascotClock().pending()).toBe(12);
  });

  it("paints a still mascot in its resting pose and then asks for nothing", () => {
    render([{ state: "sleeping", animated: false, size: 24 }]);
    run(100);
    expect(eyePaths()[0]).toBe(pillPath(IDLE_FACE.eyes[0].length, IDLE_FACE.eyes[0].width));
    frameRequests = 0;
    run(2000);
    expect(frameRequests).toBe(0);
    expect(mascotClock().pending()).toBe(0);
  });

  it("redraws a still mascot when its look changes", () => {
    render([{ state: "idle", animated: false, size: 24 }]);
    run(100);
    const eye = () => host.querySelector("g[clip-path] path")!.getAttribute("transform");
    const before = eye();
    render([{ state: "working", animated: false, size: 24 }]);
    run(1000);
    expect(eye()).not.toBe(before);
    expect(mascotClock().pending()).toBe(0);
  });

  it("celebrates once when work stops, then goes still", () => {
    render([{ state: "working", animated: false, size: 36 }]);
    run(100);
    render([{ state: "idle", animated: false, size: 36 }]);
    run(500);
    expect(mascotClock().pending()).toBe(1);
    run(FINALE_MS + 1000);
    expect(mascotClock().pending()).toBe(0);
  });

  it("keeps an agent still when only a still mascot of it shows a busy expression", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    render([
      { state: "idle", size: 36, syncKey: "maya" },
      { state: "working", size: 24, animated: false, syncKey: "maya" },
    ]);
    run(1000);
    frameRequests = 0;
    run(3000);
    expect(frameRequests).toBe(0);
    random.mockRestore();
  });

  it("comes to rest when a row stops moving as its agent's work ends", () => {
    render([{ state: "thinking", size: 36, syncKey: "augusto" }]);
    run(2000);
    render([{ state: "idle", size: 36, animated: false, syncKey: "augusto" }]);
    run(FINALE_MS + 1000);
    expect(mascotClock().pending()).toBe(0);
  });

  it("moves every mascot of an agent once a live one starts working", () => {
    render([
      { state: "working", size: 36, syncKey: "maya" },
      { state: "idle", size: 24, syncKey: "maya" },
    ]);
    run(500);
    expect(mascotClock().pending()).toBe(2);
  });

  it("rests between the blinks it gives on its own, drawing nothing while it waits", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const ref = createRef<MausAvatarHandle>();
    render([{ state: "idle", size: 24, ref }]);
    run(1000);
    frameRequests = 0;
    run(3000);
    expect(frameRequests).toBe(0);
    run(1000);
    expect(frameRequests).toBeGreaterThan(3);
    frameRequests = 0;
    run(1500);
    expect(frameRequests).toBe(0);
    act(() => ref.current!.blink());
    run(500);
    expect(frameRequests).toBeGreaterThan(5);
    random.mockRestore();
  });

  it("stops drawing a mascot that leaves the screen", () => {
    render([{ state: "working", size: 36 }]);
    run(200);
    act(() => observed.callback!([{ target: host.querySelector("svg")!, isIntersecting: false }]));
    frameRequests = 0;
    run(1000);
    expect(frameRequests).toBe(0);
    act(() => observed.callback!([{ target: host.querySelector("svg")!, isIntersecting: true }]));
    run(500);
    expect(frameRequests).toBeGreaterThan(10);
  });

  it("keeps moving when the computer asks for reduced motion", () => {
    reducedMotion = true;
    const ref = createRef<MausAvatarHandle>();
    render([{ state: "working", size: 220, ref }]);
    run(200);
    expect(mascotClock().pending()).toBe(1);
    const eye = () => host.querySelector("g[clip-path] path")!.getAttribute("transform");
    const open = eye();
    frameRequests = 0;
    act(() => { ref.current!.blink(); });
    run(80);
    expect(frameRequests).toBeGreaterThan(0);
    expect(eye()).not.toBe(open);
  });
});
