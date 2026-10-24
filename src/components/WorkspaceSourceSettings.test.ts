import { Children, createElement, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceBackupSummary } from "../../shared/workspace-backup";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[], api: vi.fn() }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], (next: unknown) => { fixture.values[index] = typeof next === "function" ? next(fixture.values[index]) : next; }];
  },
  useEffect: (effect: EffectCallback) => { fixture.effects.push(effect); },
}));
vi.mock("@/state/store", () => ({ api: fixture.api }));
import { WorkspaceSourceSettings } from "./WorkspaceSourceSettings";

type Node = ReactElement<{ children?: ReactNode; type?: string; disabled?: boolean; placeholder?: string; onChange?: (event: unknown) => void; onSubmit?: (event: unknown) => void; onClick?: () => void }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}
function render() {
  fixture.index = 0; fixture.effects = [];
  let tree: ReactNode;
  function Capture() { tree = WorkspaceSourceSettings(); return tree; }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const change = (input: Node, value: string) => input.props.onChange!({ target: { value } });
const button = (label: string) => render().nodes.find((node) => node.type === "button" && Children.toArray(node.props.children).includes(label))!;
const summary: WorkspaceBackupSummary = { format: "openmaus.workspace-backup", version: 1, id: "archive-id", createdAt: "2026-10-24T00:00:00Z", appVersion: "0.1.122", files: 9, directories: 3, bytes: 1234, bots: 5, groups: 1, threads: 4, messages: 80, warnings: [], exclusions: [] };
let storage: Map<string, string>;

beforeEach(() => {
  fixture.values = []; fixture.index = 0; fixture.effects = []; fixture.api.mockReset();
  storage = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());

async function mount(source: { address: string; pairedAt: string } | null) {
  fixture.api.mockImplementation(async (path: string) => path.endsWith("/status") ? { busy: false } : { source });
  render(); fixture.effects[0](); await flush();
  fixture.api.mockReset();
}

it("connects with the tunnel address and the other computer's pairing code", async () => {
  await mount(null);
  const view = render();
  const [address, code] = view.nodes.filter((node) => node.type === "input");
  expect(address.props.placeholder).toBe("http://127.0.0.1:18799");
  change(address, "http://127.0.0.1:18799"); change(code, "ABCD-EFGH-JKLM");
  fixture.api.mockResolvedValueOnce({ source: { address: "http://127.0.0.1:18799", pairedAt: "2026-10-24T00:00:00Z" } });
  render().nodes.find((node) => node.type === "form")!.props.onSubmit!({ preventDefault: vi.fn() }); await flush();
  expect(fixture.api).toHaveBeenCalledWith("/api/workspace-backup/source", { method: "POST", body: JSON.stringify({ address: "http://127.0.0.1:18799", code: "ABCD-EFGH-JKLM" }) });
  expect(render().html).toContain("Connected to http://127.0.0.1:18799");
});

it("pulls a copy, shows what it holds and replaces only after an exact REPLACE", async () => {
  await mount({ address: "http://127.0.0.1:18799", pairedAt: "2026-10-24T00:00:00Z" });
  expect(render().html).not.toContain("Replace installation");
  fixture.api.mockResolvedValueOnce({ id: "stage-id", summary });
  button("Sync now").props.onClick!(); await flush();
  expect(fixture.api).toHaveBeenCalledWith("/api/workspace-backup/pull", { method: "POST", body: "{}" });
  const html = render().html;
  expect(html).toContain("Validated backup");
  expect(html).toContain("the other computer&#x27;s copy");
  const confirm = render().nodes.find((node) => node.type === "input")!;
  change(confirm, "replace"); expect(button("Replace installation").props.disabled).toBe(true);
  change(confirm, "REPLACE"); expect(button("Replace installation").props.disabled).toBe(false);
  fixture.api.mockResolvedValueOnce({ restartRequired: true, restoreId: "stage-id" });
  button("Replace installation").props.onClick!(); await flush();
  expect(fixture.api).toHaveBeenLastCalledWith("/api/workspace-backup/restore", { method: "POST", body: JSON.stringify({ id: "stage-id", confirmation: "REPLACE" }) });
  expect(storage.get("omb-pending-workspace-restore")).toBe("stage-id");
  expect(render().html).toContain("Fully quit OpenMausBot");
});

it("shows why a sync failed and offers no replacement", async () => {
  await mount({ address: "http://127.0.0.1:18799", pairedAt: "2026-10-24T00:00:00Z" });
  fixture.api.mockRejectedValueOnce(new Error("http://127.0.0.1:18799 could not be reached. Check that OpenMausBot is open there and that the SSH tunnel is running."));
  button("Sync now").props.onClick!(); await flush();
  const html = render().html;
  expect(html).toContain('role="alert"');
  expect(html).toContain("SSH tunnel is running");
  expect(html).not.toContain("Replace installation");
});

it("disconnects and goes back to the connect form", async () => {
  await mount({ address: "http://127.0.0.1:18799", pairedAt: "2026-10-24T00:00:00Z" });
  fixture.api.mockResolvedValueOnce({ source: null });
  button("Disconnect").props.onClick!(); await flush();
  expect(fixture.api).toHaveBeenCalledWith("/api/workspace-backup/source", { method: "DELETE" });
  expect(render().html).toContain("Pairing code");
});
