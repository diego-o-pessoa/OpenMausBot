import type { DemoRecorder } from "../demo-recorder.ts";
import type { Tab } from "../tabs.ts";
import { describeAt, describeFocused, describeHeldSelect } from "./demo-targets.ts";

const num = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/**
 * Runs one of the person's inputs and adds it to the demonstration being taught. What it pointed at is read before
 * the input runs, since a click can take the page away; a probe that fails only leaves the step less specific.
 */
export async function recordAround<T>(recorder: DemoRecorder, tab: Tab, message: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  const page = tab.page;
  const url = () => page.url();
  switch (message.type) {
    case "mouse": {
      if (message.action !== "down" || message.button !== "left") {
        return run();
      }
      const target = await describeAt(page, num(message.x), num(message.y)).catch(() => null);
      const at = url();
      const result = await run();
      recorder.click(target, at, num(message.clickCount, 1));
      return result;
    }
    case "key": {
      if (message.action === "up") {
        return run();
      }
      if (recorder.needsFocus()) recorder.focus(await describeFocused(page).catch(() => null));
      const key = typeof message.key === "string" ? message.key.slice(0, 64) : "";
      const text = typeof message.text === "string" ? message.text : key.length === 1 ? key : undefined;
      const at = url();
      const result = await run();
      recorder.key(key, num(message.modifiers), at, text);
      if (key === "Tab") recorder.focus(await describeFocused(page).catch(() => null));
      return result;
    }
    case "text": {
      if (recorder.needsFocus()) recorder.focus(await describeFocused(page).catch(() => null));
      const at = url();
      const result = await run();
      if (typeof message.text === "string") recorder.text(message.text, at, message.secret === true);
      return result;
    }
    case "wheel": {
      const result = await run();
      recorder.scroll(num(message.deltaY), url());
      return result;
    }
    case "navigate": {
      const result = await run();
      recorder.navigate(url());
      return result;
    }
    case "selectChoose": {
      const chosen = await describeHeldSelect(page, String(message.id), num(message.index, -1)).catch(() => ({ target: null, option: "" }));
      const at = url();
      const result = await run();
      if (chosen.option) recorder.select(chosen.target, chosen.option, at);
      return result;
    }
    default:
      return run();
  }
}
