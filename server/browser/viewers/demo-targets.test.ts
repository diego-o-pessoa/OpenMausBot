import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";

import { DESCRIBE_ELEMENT, type DemoTarget } from "./demo-targets.ts";

let window: Window;

function describeIn(html: string, selector: string): DemoTarget | null {
  window = new Window();
  window.document.body.innerHTML = html;
  const describe = window.eval(DESCRIBE_ELEMENT) as (element: unknown) => DemoTarget | null;
  return describe(window.document.querySelector(selector));
}

afterEach(() => window?.close());

describe("DESCRIBE_ELEMENT", () => {
  it("names a button by its text, even when the click landed on an icon inside it", () => {
    expect(describeIn(`<button><span id="icon">Save draft</span></button>`, "#icon")).toMatchObject({ role: "button", name: "Save draft", tag: "button", editable: false, secret: false });
  });

  it("names a field by its label and keeps its placeholder", () => {
    const found = describeIn(`<label for="e">Work email</label><input id="e" type="email" placeholder="you@company.com">`, "#e");
    expect(found).toMatchObject({ role: "textbox", name: "Work email", label: "Work email", placeholder: "you@company.com", type: "email", editable: true, secret: false });
  });

  it("prefers aria-label over visible text", () => {
    expect(describeIn(`<a href="/x" aria-label="Open invoice 42">#42</a>`, "a")).toMatchObject({ role: "link", name: "Open invoice 42", href: "/x" });
  });

  it("marks password, one-time code and card fields secret", () => {
    expect(describeIn(`<input id="p" type="password" name="pw">`, "#p")).toMatchObject({ secret: true, editable: true });
    expect(describeIn(`<input id="o" autocomplete="one-time-code">`, "#o")).toMatchObject({ secret: true });
    expect(describeIn(`<input id="c" autocomplete="cc-number">`, "#c")).toMatchObject({ secret: true });
    expect(describeIn(`<input id="n" autocomplete="name">`, "#n")).toMatchObject({ secret: false });
  });

  it("uses an explicit role and treats a disabled field as not editable", () => {
    expect(describeIn(`<div role="tab" id="t">Billing</div>`, "#t")).toMatchObject({ role: "tab", name: "Billing" });
    expect(describeIn(`<input id="d" disabled aria-label="Locked">`, "#d")).toMatchObject({ editable: false, name: "Locked" });
  });

  it("returns null for nothing", () => {
    expect(describeIn(`<p>hi</p>`, "#missing")).toBeNull();
  });
});
