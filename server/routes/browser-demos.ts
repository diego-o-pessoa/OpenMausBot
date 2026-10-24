import { saveDemo, type SavedDemo } from "../browser-demos.ts";
import { describeDemo, type DemoStep } from "../browser/demo-recorder.ts";

export interface DemoControl {
  startDemo(): boolean | null;
  demo(): { steps: DemoStep[]; truncated: boolean } | null;
  stopDemo(): { steps: DemoStep[]; truncated: boolean } | null;
}

export type DemoReply = { status: number; body: Record<string, unknown> };

const ENGINE_ONLY = "Teaching a task works in the browser panel of the desktop app.";

/** GET reads the demonstration being recorded; POST starts, stops (saving it) or discards one. */
export function demoRoute(method: string, body: Record<string, unknown> | null, control: DemoControl, save: { dataDir: string; botId: string }): DemoReply {
  if (method === "GET") {
    const current = control.demo();
    return { status: 200, body: current ? { recording: true, ...current, text: describeDemo(current.steps) } : { recording: false } };
  }
  if (method !== "POST") return { status: 405, body: { error: "method not allowed" } };
  switch (body?.action) {
    case "start": {
      const started = control.startDemo();
      if (started === null) return { status: 409, body: { error: ENGINE_ONLY } };
      if (!started) return { status: 409, body: { error: "Open the bot's browser first, then start teaching." } };
      return { status: 200, body: { recording: true, steps: [], truncated: false, text: "" } };
    }
    case "stop": {
      const finished = control.stopDemo();
      if (!finished) return { status: 409, body: { error: "Nothing is being recorded." } };
      if (finished.steps.length === 0) return { status: 200, body: { recording: false, demo: null } };
      const demo: SavedDemo = saveDemo(save.dataDir, save.botId, finished);
      return { status: 200, body: { recording: false, demo, text: describeDemo(demo.steps) } };
    }
    case "discard":
      control.stopDemo();
      return { status: 200, body: { recording: false } };
    default:
      return { status: 400, body: { error: "Say start, stop or discard." } };
  }
}
