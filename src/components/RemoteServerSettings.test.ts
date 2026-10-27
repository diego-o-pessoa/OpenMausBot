import { Children, createElement, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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
import { RemoteServerSettings, type RemoteJob } from "./RemoteServerSettings";

type Node = ReactElement<{ children?: ReactNode; type?: string; disabled?: boolean; checked?: boolean; onChange?: (event: unknown) => void; onClick?: () => void }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}
function render() {
  fixture.index = 0; fixture.effects = [];
  let tree: ReactNode;
  function Capture() { tree = RemoteServerSettings(); return tree; }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const button = (label: string) => render().nodes.find((node) => node.type === "button" && Children.toArray(node.props.children).includes(label))!;
const job = (overrides: Partial<RemoteJob>): RemoteJob => ({ id: "job", action: "check", phase: "done", step: null, percent: 100, details: [], results: {}, containers: [], ...overrides });
let addVpsServer: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fixture.values = []; fixture.index = 0; fixture.effects = []; fixture.api.mockReset();
  addVpsServer = vi.fn(async () => ({ ok: true, id: "env", origin: "http://127.0.0.1:38800" }));
  vi.stubGlobal("window", { ogb: { environments: { addVpsServer } } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function mount() {
  fixture.api.mockResolvedValueOnce({ defaults: { alias: "minha-vps", repo: "https://github.com/diego-o-pessoa/OpenMausBot.git", branch: "main", port: 8799 } });
  render(); fixture.effects[0](); await flush();
}

async function settle() { for (let i = 0; i < 6; i++) { await vi.advanceTimersByTimeAsync(1600); await flush(); } }

it("checks the VPS and shows its machine, Docker, containers and whether OpenMausBot is there", async () => {
  await mount();
  fixture.api.mockResolvedValueOnce({ job: job({ results: { os: "Ubuntu 24.04.5 LTS", arch: "x86_64", docker: "yes", installed_commit: "none", up_to_date: "no" },
    containers: [{ name: "webtop", image: "lscr.io/linuxserver/webtop", state: "running" }] }) });
  button("Check VPS").props.onClick!(); await flush();
  expect(fixture.api).toHaveBeenCalledWith("/api/remote-server/check", expect.objectContaining({ method: "POST" }));
  expect(JSON.parse(fixture.api.mock.calls[1][1].body)).toMatchObject({ alias: "minha-vps", branch: "main" });
  const html = render().html;
  for (const text of ["Ubuntu 24.04.5 LTS", "webtop", "Not installed", "Install on the VPS", "Bring everything from this computer"]) expect(html).toContain(text);
});

it("installs, moves this computer in, and connects this window to the VPS with the last pairing code", async () => {
  await mount();
  fixture.api.mockResolvedValueOnce({ job: job({ results: { os: "Ubuntu", arch: "x86_64", docker: "yes", installed_commit: "none", up_to_date: "no" } }) });
  button("Check VPS").props.onClick!(); await flush();
  fixture.api
    .mockResolvedValueOnce({ job: job({ id: "install", action: "install", phase: "running", percent: 0 }) })
    .mockResolvedValueOnce({ job: job({ id: "install", action: "install", phase: "running", percent: 38, step: { index: 4, total: 8, key: "build" }, details: ["Compilando o servidor"] }) })
    .mockResolvedValueOnce({ job: job({ id: "install", action: "install", results: { pairing_code: "AAAA-BBBB-CCCC" } }) })
    .mockResolvedValueOnce({ job: job({ id: "move", action: "move", phase: "running", percent: 0 }) })
    .mockRejectedValueOnce(Object.assign(new Error("busy"), { status: 503 }))
    .mockResolvedValueOnce({ job: job({ id: "move", action: "move", results: { pairing_code: "DDDD-EEEE-FFFF" } }) });
  button("Install on the VPS").props.onClick!();
  await flush(); await vi.advanceTimersByTimeAsync(1600); await flush();
  expect(render().html).toContain("Building (several minutes)");
  expect(render().html).toContain("38%");
  await settle();
  expect(fixture.api.mock.calls.map(([path]) => path)).toEqual([
    "/api/remote-server", "/api/remote-server/check", "/api/remote-server/install", "/api/remote-server/jobs/install", "/api/remote-server/jobs/install",
    "/api/remote-server/move", "/api/remote-server/jobs/move", "/api/remote-server/jobs/move",
  ]);
  expect(addVpsServer).toHaveBeenCalledWith({ alias: "minha-vps", remotePort: 8799, code: "DDDD-EEEE-FFFF", name: "minha-vps" });
  expect(render().html).toContain("Connected.");
});

it("opens a VPS that is already up to date with a fresh pairing code, without reinstalling", async () => {
  await mount();
  fixture.api.mockResolvedValueOnce({ job: job({ results: { os: "Ubuntu", arch: "x86_64", docker: "yes", installed_commit: "abc", latest_commit: "abc", up_to_date: "yes" } }) });
  button("Check VPS").props.onClick!(); await flush();
  expect(render().html).toContain("Installed and up to date");
  expect(render().html).not.toContain("Install on the VPS");
  fixture.api.mockResolvedValueOnce({ job: job({ action: "pair", results: { pairing_code: "GGGG-HHHH-JJJJ" } }) });
  button("Open the VPS server").props.onClick!(); await flush();
  expect(fixture.api).toHaveBeenLastCalledWith("/api/remote-server/pair", expect.objectContaining({ method: "POST" }));
  expect(addVpsServer).toHaveBeenCalledWith(expect.objectContaining({ code: "GGGG-HHHH-JJJJ" }));
});

it("shows why an install failed and does not connect", async () => {
  await mount();
  fixture.api.mockResolvedValueOnce({ job: job({ results: { installed_commit: "none", up_to_date: "no" } }) });
  button("Check VPS").props.onClick!(); await flush();
  render().nodes.find((node) => node.type === "input" && node.props.type === "checkbox")!.props.onChange!({ target: { checked: false } });
  fixture.api
    .mockResolvedValueOnce({ job: job({ id: "install", action: "install", phase: "running" }) })
    .mockResolvedValueOnce({ job: job({ id: "install", action: "install", phase: "failed", error: "the build failed; the full log is /home/openmausbot/openmausbot-install.log on this machine" }) });
  button("Install on the VPS").props.onClick!(); await settle();
  const html = render().html;
  expect(html).toContain('role="alert"');
  expect(html).toContain("the build failed");
  expect(addVpsServer).not.toHaveBeenCalled();
});

it("says it needs the desktop app in a browser", async () => {
  vi.stubGlobal("window", {});
  await mount();
  expect(render().html).toContain("Open this from the desktop app");
});
