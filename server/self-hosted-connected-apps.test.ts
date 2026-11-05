import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { DEFAULT_MANAGED_COMPOSIO_BROKER_URL } from "../electron/managed-composio.mjs";
import { startCloudHomeConnectedApps, stopCloudHomeConnectedApps } from "./cloud-connected-apps.ts";
import { connectedAppsOffPrompt } from "./system-prompt.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const dirs: string[] = [];
afterEach(async () => {
  stopCloudHomeConnectedApps();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) await removeTempDir(dir);
});

function brokerSpy() {
  const urls: string[] = [];
  vi.stubGlobal("fetch", (async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ installationId: "install-1", token: "d".repeat(64) }), { status: 201, headers: { "content-type": "application/json" } });
  }) as typeof fetch);
  return urls;
}

it("a self-hosted server that opts in registers with the included connected-apps service, even run from source", async () => {
  vi.stubEnv("OMB_COMPOSIO_BROKER_URL", "");
  const urls = brokerSpy();
  const applied: unknown[] = [];
  const dataDir = mkdtempSync(join(tmpdir(), "omb-self-hosted-apps-"));
  dirs.push(dataDir);
  startCloudHomeConnectedApps({ cloudHome: false, selfHosted: true, dataDir, apply: (access) => applied.push(access) });
  await vi.waitFor(() => expect(applied.at(-1)).toMatchObject({ token: "d".repeat(64) }));
  expect(urls[0]).toBe(`${DEFAULT_MANAGED_COMPOSIO_BROKER_URL}/v1/installations`);
});

it("a self-hosted server that did not opt in registers nowhere", async () => {
  const urls = brokerSpy();
  const dataDir = mkdtempSync(join(tmpdir(), "omb-self-hosted-apps-"));
  dirs.push(dataDir);
  startCloudHomeConnectedApps({ cloudHome: false, dataDir, apply: () => {} });
  await new Promise((done) => setTimeout(done, 50));
  expect(urls).toEqual([]);
});

it("tells a bot without connected apps what is missing instead of waiting on a card that cannot show", () => {
  const off = connectedAppsOffPrompt(false);
  expect(off).toContain("App Settings → Connections");
  expect(off).toContain("OMB_MANAGED_CONNECTED_APPS=1");
  expect(off).toContain("stays pending forever");
  expect(connectedAppsOffPrompt(true)).toContain("Access settings");
});
