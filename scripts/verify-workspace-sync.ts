// Owns two disposable fake-engine servers and a loopback relay standing in for an SSH tunnel; accepts no live URL.
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, connect, type Server } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runControlOmb, type VerificationServer } from "./control-omb.ts";
import { launchBackupFixture, restartFixture } from "./verify-workspace-backup.ts";
import { waitForExit } from "../server/testing/cleanup.ts";

async function openTunnel(target: string): Promise<{ address: string; server: Server }> {
  const port = Number(new URL(target).port);
  const server = createServer((client) => {
    const upstream = connect(port, "127.0.0.1");
    client.pipe(upstream).pipe(client);
    const close = () => { client.destroy(); upstream.destroy(); };
    client.on("error", close);
    upstream.on("error", close);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const bound = server.address();
  if (!bound || typeof bound === "string") throw new Error("tunnel did not listen");
  return { address: `http://127.0.0.1:${bound.port}`, server };
}

export async function verifyWorkspaceSync(report: (event: unknown) => void = () => {}) {
  const events: unknown[] = [];
  const record = (event: unknown) => { events.push(event); report(event); };
  const source = await launchBackupFixture();
  let destination: VerificationServer | undefined;
  let running: ChildProcess | undefined;
  let tunnel: Server | undefined;
  const evidencePath = `${source.info.logPath}.workspace-sync.json`;
  record({ source: source.info });
  const control = async (fixture: VerificationServer, ...args: string[]) => {
    const result = await runControlOmb([...args, "--url", fixture.info.url]);
    record({ command: [...args, "--url", fixture.info.url], result });
    return result;
  };
  const api = async (url: string, method: string, path: string, body?: unknown, token?: string) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120_000),
    });
    const result = await response.json() as Record<string, any>;
    record({ method, url, path, status: response.status, ...(response.ok ? {} : { error: result.error }) });
    return { status: response.status, body: result };
  };
  const restart = async () => {
    const current = { ...destination!, child: running ?? destination!.child };
    running = await restartFixture(current);
    record({ command: "restart destination", pid: running.pid });
  };
  const sync = async (url: string) => {
    const pulled = await api(url, "POST", "/api/workspace-backup/pull", {});
    assert.equal(pulled.status, 200, JSON.stringify(pulled.body));
    const committed = await api(url, "POST", "/api/workspace-backup/restore", { id: pulled.body.id, confirmation: "REPLACE" });
    assert.equal(committed.status, 200, JSON.stringify(committed.body));
    await restart();
    return pulled.body.summary as { bots: number; messages: number };
  };
  try {
    destination = await launchBackupFixture();
    record({ destination: destination.info });
    const url = destination.info.url;
    const opened = await openTunnel(source.info.url);
    tunnel = opened.server;
    record({ tunnel: opened.address, to: source.info.url });

    const { bot } = await control(source, "new-bot", "--name", "Windows bot", "--section", "Sync team") as { bot: { id: string } };
    const { bot: localOnly } = await control(destination, "new-bot", "--name", "Made only on Linux") as { bot: { id: string } };
    const soul = "SYNC_SOUL_MARKER: instructions written on the source.\n";
    assert.equal((await api(source.info.url, "PATCH", `/api/bots/${bot.id}/profile`, { soul })).status, 200);
    const memory = "SYNC_MEMORY_MARKER: what this bot learned.\n";
    mkdirSync(join(source.info.dataDir, "workspaces", bot.id), { recursive: true });
    writeFileSync(join(source.info.dataDir, "workspaces", bot.id, "MEMORY.md"), memory, { mode: 0o600 });
    await control(source, "send", "--bot", bot.id, "--text", "Remember this conversation on the other computer.");
    assert.equal((await control(source, "wait", "--bot", bot.id, "--timeout", "30") as { status: string }).status, "settled");
    const before = (await api(source.info.url, "GET", "/api/bots?messages=200")).body;

    assert.equal((await api(url, "POST", "/api/workspace-backup/pull", {})).status, 409);
    for (const address of ["http://192.168.0.10:8799", "http://maus.example.com"]) {
      assert.equal((await api(url, "POST", "/api/workspace-backup/source", { address, code: "ABCD-EFGH-JKLM" })).status, 400);
    }
    const chatOnly = await api(source.info.url, "POST", "/api/auth/pairing", { scopes: ["client"] });
    const refused = await api(url, "POST", "/api/workspace-backup/source", { address: opened.address, code: chatOnly.body.code });
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /Full access/);

    const pairing = await api(source.info.url, "POST", "/api/auth/pairing", { scopes: ["admin", "client"] });
    assert.equal(pairing.status, 200, JSON.stringify(pairing.body));
    const connected = await api(url, "POST", "/api/workspace-backup/source", { address: opened.address, code: pairing.body.code });
    assert.equal(connected.status, 200, JSON.stringify(connected.body));
    assert.equal(connected.body.source.address, opened.address);
    assert.equal(JSON.stringify(connected.body).includes("omb_sess_"), false);
    const stored = join(destination.info.dataDir, "workspace-source.json");
    if (process.platform !== "win32") assert.equal(statSync(stored).mode & 0o777, 0o600);
    const token = JSON.parse(readFileSync(stored, "utf8")).token as string;
    const pairedOnSource = (await api(source.info.url, "GET", "/api/auth/sessions")).body.sessions as Array<{ label: string }>;
    assert.ok(pairedOnSource.some((session) => session.label.startsWith("OpenMausBot sync")));

    const first = await sync(url);
    assert.equal(first.bots, before.bots.length);
    const after = (await api(url, "GET", "/api/bots?messages=200")).body;
    assert.deepEqual(after.bots.map((candidate: { id: string }) => candidate.id).sort(), before.bots.map((candidate: { id: string }) => candidate.id).sort());
    assert.equal(after.bots.some((candidate: { id: string }) => candidate.id === localOnly.id), false);
    const synced = after.bots.find((candidate: { id: string }) => candidate.id === bot.id);
    assert.equal(synced.soul, soul);
    assert.ok(synced.messages.some((message: { text?: string }) => message.text?.includes("Remember this conversation")));
    assert.ok(synced.messages.some((message: { text?: string }) => message.text?.includes("hello from fake claude")));
    assert.equal(readFileSync(join(destination.info.dataDir, "workspaces", bot.id, "MEMORY.md"), "utf8"), memory);
    assert.equal((await api(url, "GET", "/api/workspace-backup/source")).body.source.address, opened.address);
    record({ check: "first sync", bots: after.bots.length, messages: synced.messages.length });

    const { bot: later } = await control(source, "new-bot", "--name", "Added on Windows later") as { bot: { id: string } };
    await sync(url);
    const again = (await api(url, "GET", "/api/bots")).body;
    assert.ok(again.bots.some((candidate: { id: string }) => candidate.id === later.id));
    record({ check: "second sync", bots: again.bots.length });

    assert.equal((await api(source.info.url, "GET", "/api/workspace-backup/status", undefined, token)).status, 200);
    assert.equal((await api(url, "DELETE", "/api/workspace-backup/source")).status, 200);
    assert.equal((await api(source.info.url, "GET", "/api/workspace-backup/status", undefined, token)).status, 401);
    assert.equal(existsSync(stored), false);
    const result = { ok: true, pairedThroughTunnel: true, chatOnlyRefused: true, nonLoopbackHttpRefused: true, botsAndHistorySynced: true, memorySynced: true, connectionKeptAcrossRestore: true, resyncBringsNewBots: true, disconnectRevokes: true, evidencePath, logs: [source.info.logPath, destination.info.logPath] };
    record(result);
    return result;
  } finally {
    if (tunnel) { tunnel.close(); }
    await waitForExit(running, { signal: "SIGTERM" });
    await destination?.close();
    await source.close();
    record({ cleanup: true, sourceRemoved: !existsSync(source.info.dataDir), destinationRemoved: !destination || !existsSync(destination.info.dataDir) });
    writeFileSync(evidencePath, JSON.stringify(events, null, 2), { mode: 0o600 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyWorkspaceSync((event) => console.log(JSON.stringify(event))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
