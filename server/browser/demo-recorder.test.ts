import { describe, expect, it } from "vitest";

import { DEMO_MAX_STEPS, DEMO_TEXT_LIMIT, DemoRecorder, describeDemo, type DemoTarget } from "./demo-recorder.ts";

const field = (name: string, extra: Partial<DemoTarget> = {}): DemoTarget => ({ role: "textbox", name, tag: "input", type: "text", editable: true, secret: false, ...extra });
const button = (name: string): DemoTarget => ({ role: "button", name, tag: "button", editable: false, secret: false });
const URL_A = "https://example.com/login";

function clock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe("DemoRecorder", () => {
  it("keeps typing into one field as one step, and a click on another field starts the next", () => {
    const recorder = new DemoRecorder();
    recorder.click(field("Email"), URL_A);
    for (const ch of "ana@") recorder.key(ch, 0, URL_A, ch);
    recorder.text("acme.com", URL_A);
    recorder.click(field("Name"), URL_A);
    recorder.text("Ana", URL_A);
    expect(recorder.steps().map((step) => step.kind)).toEqual(["click", "type", "click", "type"]);
    const typed = recorder.steps()[1];
    expect(typed).toMatchObject({ kind: "type", text: "ana@acme.com", length: 12, target: { name: "Email" } });
  });

  it("never keeps what is typed into a secret field, only how long it was", () => {
    const recorder = new DemoRecorder();
    recorder.click(field("Password", { type: "password", secret: true }), URL_A);
    recorder.text("hunter2", URL_A);
    recorder.key("x", 0, URL_A, "x");
    const typed = recorder.steps()[1];
    expect(typed).toMatchObject({ kind: "type", text: null, length: 8 });
    expect(JSON.stringify(recorder.steps())).not.toContain("hunter2");
    expect(describeDemo(recorder.steps())).toContain("secret value (8 characters, not recorded)");
  });

  it("keeps nothing the person typed as a secret, even into an ordinary field", () => {
    const recorder = new DemoRecorder();
    recorder.click(field("API key"), URL_A);
    recorder.text("sk-live-123", URL_A, true);
    recorder.text("visible", URL_A);
    expect(recorder.steps().slice(1)).toMatchObject([{ kind: "type", text: null, length: 11 }, { kind: "type", text: "visible" }]);
    expect(JSON.stringify(recorder.steps())).not.toContain("sk-live");
  });

  it("lets Backspace edit what was just typed, and drops a field emptied again", () => {
    const recorder = new DemoRecorder();
    recorder.click(field("Search"), URL_A);
    recorder.text("cats", URL_A);
    recorder.key("Backspace", 0, URL_A);
    expect(recorder.steps()[1]).toMatchObject({ text: "cat", length: 3 });
    for (let i = 0; i < 3; i++) recorder.key("Backspace", 0, URL_A);
    expect(recorder.steps().map((step) => step.kind)).toEqual(["click"]);
  });

  it("records Enter and shortcuts as keys, never modifier keys alone", () => {
    const recorder = new DemoRecorder();
    recorder.click(field("Search"), URL_A);
    recorder.key("Shift", 8, URL_A);
    recorder.key("Enter", 0, URL_A, "\r");
    recorder.key("a", 2, URL_A, "a");
    expect(recorder.steps().slice(1)).toMatchObject([{ kind: "key", key: "Enter" }, { kind: "key", key: "a", modifiers: 2 }]);
    expect(describeDemo(recorder.steps())).toContain("Press Ctrl+a");
  });

  it("turns a quick second click on the same thing into a double-click", () => {
    const time = clock();
    const recorder = new DemoRecorder(time.now);
    recorder.click(button("Row"), URL_A, 1);
    time.advance(200);
    recorder.click(button("Row"), URL_A, 2);
    expect(recorder.steps()).toHaveLength(1);
    expect(recorder.steps()[0]).toMatchObject({ kind: "click", double: true });
  });

  it("lets a choice from a list replace the click that opened the list", () => {
    const recorder = new DemoRecorder();
    const country = field("Country", { role: "combobox", tag: "select", editable: false });
    recorder.click(country, URL_A);
    recorder.select(country, "Brazil", URL_A);
    expect(recorder.steps()).toEqual([expect.objectContaining({ kind: "select", option: "Brazil" })]);
  });

  it("folds a run of scrolls on one page into one step", () => {
    const recorder = new DemoRecorder();
    recorder.scroll(100, URL_A);
    recorder.scroll(250, URL_A);
    recorder.scroll(-50, URL_A);
    expect(recorder.steps()).toEqual([expect.objectContaining({ kind: "scroll", dy: 300 })]);
  });

  it("ignores a repeated navigation to the same address and a click on nothing", () => {
    const recorder = new DemoRecorder();
    recorder.navigate(URL_A);
    recorder.navigate(URL_A);
    recorder.click(null, URL_A);
    expect(recorder.steps()).toHaveLength(1);
  });

  it("stops at its step limit and says it was cut short", () => {
    const recorder = new DemoRecorder();
    for (let i = 0; i <= DEMO_MAX_STEPS; i++) recorder.navigate(`https://example.com/${i}`);
    expect(recorder.steps()).toHaveLength(DEMO_MAX_STEPS);
    expect(recorder.truncated).toBe(true);
  });

  it("caps what one field keeps", () => {
    const recorder = new DemoRecorder();
    recorder.click(field("Notes"), URL_A);
    recorder.text("x".repeat(DEMO_TEXT_LIMIT + 50), URL_A);
    expect(recorder.steps()[1]).toMatchObject({ length: DEMO_TEXT_LIMIT + 50 });
    expect((recorder.steps()[1] as { text: string }).text).toHaveLength(DEMO_TEXT_LIMIT);
  });
});

describe("describeDemo", () => {
  it("numbers the steps and says when the page changed", () => {
    const recorder = new DemoRecorder();
    recorder.navigate(URL_A);
    recorder.click(field("Email"), URL_A);
    recorder.text("ana@acme.com", URL_A);
    recorder.click(button("Sign in"), URL_A);
    recorder.select(field("Country", { role: "combobox", tag: "select" }), "Brazil", "https://example.com/home");
    expect(describeDemo(recorder.steps())).toBe([
      "1. Open https://example.com/login",
      "2. Click the textbox \"Email\"",
      "3. Type \"ana@acme.com\" into the textbox \"Email\"",
      "4. Click the button \"Sign in\"",
      "(now on https://example.com/home)",
      "5. Choose \"Brazil\" in the combobox \"Country\"",
    ].join("\n"));
  });
});
