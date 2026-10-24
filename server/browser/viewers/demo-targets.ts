// What the person pointed at or typed into while teaching, described the way a later run can find it again: role,
// accessible name, label. Runs in the isolated world, like the other probes, so the page cannot see or alter it.
import { valueInWorld } from "../cdp/evaluate.ts";
import type { CdpPage } from "../cdp/page.ts";

export interface DemoTarget {
  role: string;
  name: string;
  tag: string;
  /** An <input>'s type. */
  type?: string;
  label?: string;
  placeholder?: string;
  href?: string;
  editable: boolean;
  /** A password, one-time code or card number: what is typed here is never kept. */
  secret: boolean;
}

const TEXT_LIMIT = 120;

/** Describes an element, or the nearest interactive ancestor of one; null for nothing. Kept as source so tests run it in a DOM. */
export const DESCRIBE_ELEMENT = `((start) => {
  const LIMIT = ${TEXT_LIMIT};
  const clip = (value) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, LIMIT);
  const INTERACTIVE = "a[href],button,input,select,textarea,summary,label,[role],[contenteditable=''],[contenteditable='true'],[onclick],[tabindex]";
  let element = start;
  if (element && element.nodeType !== 1) element = element.parentElement;
  if (!element) return null;
  const owner = element.closest ? element.closest(INTERACTIVE) : null;
  if (owner) element = owner;
  if (element.tagName === "LABEL" && element.control) element = element.control;
  const tag = element.tagName.toLowerCase();
  const type = tag === "input" ? String(element.type || "text").toLowerCase() : undefined;
  const IMPLICIT = { a: "link", button: "button", select: "combobox", textarea: "textbox", summary: "button", img: "img", h1: "heading", h2: "heading", h3: "heading", option: "option" };
  const INPUT_ROLES = { checkbox: "checkbox", radio: "radio", button: "button", submit: "button", reset: "button", range: "slider", search: "searchbox" };
  const role = clip(element.getAttribute("role")) || (tag === "input" ? INPUT_ROLES[type] || "textbox" : IMPLICIT[tag] || (element.isContentEditable ? "textbox" : "generic"));
  const byIds = (ids) => clip(String(ids || "").split(/\\s+/).map((id) => { const found = id && element.ownerDocument.getElementById(id); return found ? found.textContent : ""; }).join(" "));
  let label = "";
  if (element.labels && element.labels.length) label = clip([...element.labels].map((one) => one.textContent).join(" "));
  else if (element.closest && element.closest("label")) label = clip(element.closest("label").textContent);
  const placeholder = clip(element.getAttribute("placeholder"));
  const ownText = tag === "input" || tag === "select" || tag === "textarea" ? "" : clip(element.innerText || element.textContent);
  const buttonValue = tag === "input" && ["button", "submit", "reset"].includes(type) ? clip(element.value) : "";
  const name = clip(element.getAttribute("aria-label")) || byIds(element.getAttribute("aria-labelledby")) || label || buttonValue || ownText
    || placeholder || clip(element.getAttribute("alt")) || clip(element.getAttribute("title")) || clip(element.getAttribute("name"));
  const autocomplete = String(element.getAttribute("autocomplete") || "").toLowerCase();
  const secret = type === "password" || /(^|\\s)(current-password|new-password|one-time-code|cc-number|cc-csc)(\\s|$)/.test(autocomplete);
  const NON_TEXT = ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"];
  const editable = Boolean(element.isContentEditable) || (tag === "textarea" && !element.disabled && !element.readOnly)
    || (tag === "input" && !NON_TEXT.includes(type) && !element.disabled && !element.readOnly);
  const href = tag === "a" ? clip(element.getAttribute("href")) : "";
  return {
    role, name, tag, editable, secret,
    ...(type ? { type } : {}), ...(label ? { label } : {}), ...(placeholder ? { placeholder } : {}), ...(href ? { href } : {}),
  };
})`;

const DEEP_POINT = `((x, y) => {
  let element = document.elementFromPoint(x, y);
  while (element && element.shadowRoot) {
    const inner = element.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === element) break;
    element = inner;
  }
  return element;
})`;

const DEEP_FOCUS = `(() => {
  let element = document.activeElement;
  while (element && element.shadowRoot && element.shadowRoot.activeElement) element = element.shadowRoot.activeElement;
  return element === document.body ? null : element;
})`;

const finite = (value: number) => (Number.isFinite(value) ? value : 0);

function valid(found: unknown): DemoTarget | null {
  if (!found || typeof found !== "object") return null;
  const target = found as Partial<DemoTarget>;
  return typeof target.role === "string" && typeof target.name === "string" && typeof target.tag === "string" ? (target as DemoTarget) : null;
}

/** The element a click at this point lands on, in the tab's main frame. */
export async function describeAt(page: CdpPage, x: number, y: number): Promise<DemoTarget | null> {
  return valid(await valueInWorld(page.frames, page.frames.mainFrameId, `${DESCRIBE_ELEMENT}(${DEEP_POINT}(${finite(x)}, ${finite(y)}))`));
}

/** The element that has focus, where typing goes. */
export async function describeFocused(page: CdpPage): Promise<DemoTarget | null> {
  return valid(await valueInWorld(page.frames, page.frames.mainFrameId, `${DESCRIBE_ELEMENT}(${DEEP_FOCUS}())`));
}

/** The dropdown a viewer is choosing from, held by `selectAt` under `token`, and the label of option `index`. */
export async function describeHeldSelect(page: CdpPage, token: string, index: number): Promise<{ target: DemoTarget | null; option: string }> {
  const found = await valueInWorld<{ target: unknown; option: string } | null>(page.frames, page.frames.mainFrameId, `(() => {
    const held = globalThis.__ombSelect;
    const select = held && held.token === ${JSON.stringify(token)} && held.select.isConnected ? held.select : null;
    if (!select) return null;
    const option = select.options[${Math.trunc(finite(index))}];
    return { target: ${DESCRIBE_ELEMENT}(select), option: option ? String(option.label || option.text || "").slice(0, 200) : "" };
  })()`);
  return { target: valid(found?.target), option: typeof found?.option === "string" ? found.option : "" };
}
