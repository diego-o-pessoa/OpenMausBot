import type { DemoTarget } from "./viewers/demo-targets.ts";

export type { DemoTarget };

interface StepBase {
  at: number;
  url: string;
}

export type DemoStep =
  | (StepBase & { kind: "navigate" })
  | (StepBase & { kind: "click"; target: DemoTarget; double?: true })
  | (StepBase & { kind: "type"; target: DemoTarget | null; text: string | null; length: number })
  | (StepBase & { kind: "key"; key: string; modifiers: number })
  | (StepBase & { kind: "select"; target: DemoTarget | null; option: string })
  | (StepBase & { kind: "scroll"; dy: number })
  | (StepBase & { kind: "tab"; action: "new" | "switch" | "close" });

export const DEMO_MAX_STEPS = 400;
export const DEMO_TEXT_LIMIT = 2_000;
const DOUBLE_CLICK_MS = 600;

/** CDP modifier bits. */
const ALT = 1;
const CTRL = 2;
const META = 4;

const sameTarget = (a: DemoTarget | null, b: DemoTarget | null) =>
  a === b || (a !== null && b !== null && a.role === b.role && a.name === b.name && a.tag === b.tag && a.label === b.label && a.placeholder === b.placeholder);

/**
 * The steps of one demonstration, in the order the person took them: typing into one field is one step, a run of
 * scrolls is one step, and nothing typed into a secret field is kept.
 */
export class DemoRecorder {
  readonly #now: () => number;
  readonly #steps: DemoStep[] = [];
  #truncated = false;
  #focus: DemoTarget | null = null;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  steps(): DemoStep[] {
    return this.#steps.map((step) => ({ ...step }));
  }

  navigate(url: string): void {
    const last = this.#last();
    if (last?.kind === "navigate" && last.url === url) return;
    this.#push({ kind: "navigate", url, at: this.#now() });
  }

  tab(action: "new" | "switch" | "close", url: string): void {
    this.#push({ kind: "tab", action, url, at: this.#now() });
  }

  click(target: DemoTarget | null, url: string, clickCount = 1): void {
    this.#focus = target?.editable ? target : null;
    if (!target) return;
    const last = this.#last();
    const at = this.#now();
    if (last?.kind === "click" && clickCount >= 2 && sameTarget(last.target, target) && at - last.at <= DOUBLE_CLICK_MS) {
      last.double = true;
      return;
    }
    this.#push({ kind: "click", target, url, at });
  }

  /** Where the next typing goes when it did not start with a click, such as after Tab. */
  focus(target: DemoTarget | null): void {
    this.#focus = target;
  }

  /** Typing is about to start and nothing says where it goes. */
  needsFocus(): boolean {
    return this.#focus === null;
  }

  /** `secret` is the person's own word that this text is a secret, whatever the field. */
  text(text: string, url: string, secret = false): void {
    if (!text) return;
    const target = this.#focus;
    const last = this.#last();
    if (last?.kind === "type" && sameTarget(last.target, target) && last.url === url && (last.text === null) === (secret || target?.secret === true)) {
      last.length += text.length;
      if (last.text !== null) last.text = (last.text + text).slice(0, DEMO_TEXT_LIMIT);
      last.at = this.#now();
      return;
    }
    const hidden = secret || target?.secret === true;
    this.#push({ kind: "type", target, text: hidden ? null : text.slice(0, DEMO_TEXT_LIMIT), length: text.length, url, at: this.#now() });
  }

  /** A key press. Printable characters without Ctrl, Alt or Meta are typing; Backspace edits what was just typed. */
  key(key: string, modifiers: number, url: string, text?: string): void {
    const chord = (modifiers & (ALT | CTRL | META)) !== 0;
    if (!chord && text && text.length === 1 && text >= " ") {
      this.text(text, url);
      return;
    }
    const last = this.#last();
    if (key === "Backspace" && !chord && last?.kind === "type" && sameTarget(last.target, this.#focus)) {
      last.length = Math.max(0, last.length - 1);
      if (last.text !== null) last.text = last.text.slice(0, -1);
      if (last.length === 0) this.#steps.pop();
      return;
    }
    if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") return;
    this.#push({ kind: "key", key, modifiers, url, at: this.#now() });
  }

  /** Choosing from a list replaces the click that opened it. */
  select(target: DemoTarget | null, option: string, url: string): void {
    const last = this.#last();
    if (last?.kind === "click" && sameTarget(last.target, target)) this.#steps.pop();
    this.#push({ kind: "select", target, option: option.slice(0, DEMO_TEXT_LIMIT), url, at: this.#now() });
  }

  scroll(deltaY: number, url: string): void {
    const last = this.#last();
    if (last?.kind === "scroll" && last.url === url) {
      last.dy += deltaY;
      last.at = this.#now();
      return;
    }
    this.#push({ kind: "scroll", dy: deltaY, url, at: this.#now() });
  }

  #last(): DemoStep | undefined {
    return this.#steps[this.#steps.length - 1];
  }

  #push(step: DemoStep): void {
    if (this.#steps.length >= DEMO_MAX_STEPS) {
      this.#truncated = true;
      return;
    }
    this.#steps.push(step);
  }
}

const quote = (value: string) => JSON.stringify(value);

function describeTarget(target: DemoTarget | null): string {
  if (!target) return "the focused field";
  const name = target.name || target.label || target.placeholder;
  return name ? `the ${target.role} ${quote(name)}` : `a ${target.role}`;
}

const KEY_NAMES: Record<string, string> = { Enter: "Enter", Tab: "Tab", Escape: "Escape", ArrowDown: "Down", ArrowUp: "Up", ArrowLeft: "Left", ArrowRight: "Right" };

function chordName(key: string, modifiers: number): string {
  const parts = [modifiers & CTRL ? "Ctrl" : "", modifiers & ALT ? "Alt" : "", modifiers & META ? "Cmd" : "", KEY_NAMES[key] ?? key];
  return parts.filter(Boolean).join("+");
}

/** The demonstration as numbered plain-language steps, the way a skill's procedure reads. */
export function describeDemo(steps: readonly DemoStep[]): string {
  const lines: string[] = [];
  let url = "";
  for (const step of steps) {
    if (step.kind !== "navigate" && step.kind !== "tab" && step.url && step.url !== url) lines.push(url ? `(now on ${step.url})` : `(starting on ${step.url})`);
    url = step.url || url;
    switch (step.kind) {
      case "navigate":
        lines.push(`Open ${step.url}`);
        break;
      case "tab":
        lines.push(step.action === "new" ? `Open a new tab${step.url ? ` at ${step.url}` : ""}` : step.action === "switch" ? `Switch to the tab at ${step.url}` : "Close the tab");
        break;
      case "click":
        lines.push(`${step.double ? "Double-click" : "Click"} ${describeTarget(step.target)}`);
        break;
      case "type":
        lines.push(step.text === null
          ? `Type the secret value (${step.length} characters, not recorded) into ${describeTarget(step.target)}`
          : `Type ${quote(step.text)} into ${describeTarget(step.target)}`);
        break;
      case "key":
        lines.push(`Press ${chordName(step.key, step.modifiers)}`);
        break;
      case "select":
        lines.push(`Choose ${quote(step.option)} in ${describeTarget(step.target)}`);
        break;
      case "scroll":
        lines.push(step.dy >= 0 ? "Scroll down" : "Scroll up");
        break;
    }
  }
  let n = 0;
  return lines.map((line) => (line.startsWith("(") ? line : `${++n}. ${line}`)).join("\n");
}
