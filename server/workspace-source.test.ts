import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { excludedWorkspaceAuthPath } from "./workspace-backup-policy.ts";
import {
  downloadSourceBackup, forgetWorkspaceSource, pairWorkspaceSource, parseSourceAddress, readWorkspaceSource, WORKSPACE_SOURCE_FILE,
} from "./workspace-source.ts";

const TOKEN = `omb_sess_${"a".repeat(43)}`;
const BACKUP = Buffer.from("fixture encrypted backup bytes");

let dataDir: string;
let server: Server;
let address: string;
let scopes: string[];
let revoked: string[];
let exports: Array<{ password: string; authorization?: string }>;
let downloadStatus: number;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "omb-source-"));
  scopes = ["admin", "client"];
  revoked = [];
  exports = [];
  downloadStatus = 200;
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const json = (status: number, value: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    const bearer = req.headers.authorization === `Bearer ${TOKEN}`;
    if (req.url === "/api/auth/pair" && req.method === "POST") {
      return body.code === "ABCD-EFGH-JKLM" ? json(200, { token: TOKEN, session: { scopes } }) : json(401, { error: "pairing code is wrong or has expired" });
    }
    if (req.url === "/api/auth/logout" && req.method === "POST") {
      revoked.push(String(req.headers.authorization));
      return json(200, { ok: true });
    }
    if (!bearer) return json(401, { error: "unauthorized: this session has expired or was revoked" });
    if (req.url === "/api/workspace-backup/export" && req.method === "POST") {
      exports.push({ password: body.password, authorization: req.headers.authorization });
      return json(200, { id: "11111111-2222-4333-8444-555555555555" });
    }
    if (req.url === "/api/workspace-backup/download/11111111-2222-4333-8444-555555555555") {
      if (downloadStatus !== 200) return json(downloadStatus, { error: "This backup has expired" });
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": BACKUP.length });
      return res.end(BACKUP);
    }
    json(404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const bound = server.address();
  if (!bound || typeof bound === "string") throw new Error("fixture did not listen");
  address = `http://127.0.0.1:${bound.port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
});

describe("parseSourceAddress", () => {
  it("accepts plain HTTP only on loopback, the local end of an SSH tunnel", () => {
    expect(parseSourceAddress("http://127.0.0.1:18799")).toEqual({ address: "http://127.0.0.1:18799", code: null });
    expect(parseSourceAddress("localhost:18799/").address).toBe("http://localhost:18799");
    expect(parseSourceAddress("https://maus.example.com").address).toBe("https://maus.example.com");
    for (const remote of ["http://192.168.0.10:8799", "http://maus.example.com", "http://10.0.0.2"]) {
      expect(() => parseSourceAddress(remote)).toThrow(/SSH tunnel/);
    }
  });

  it("takes the code out of a pairing link and refuses anything else after the address", () => {
    expect(parseSourceAddress("http://127.0.0.1:18799/pair#code=ABCD-EFGH-JKLM")).toEqual({ address: "http://127.0.0.1:18799", code: "ABCD-EFGH-JKLM" });
    for (const bad of ["http://user:pw@127.0.0.1:18799", "http://127.0.0.1:18799/api", "http://127.0.0.1:18799/?x=1", "ftp://127.0.0.1", "http://127.0.0.1:18799/#other"]) {
      expect(() => parseSourceAddress(bad)).toThrow();
    }
  });
});

describe("pairing", () => {
  it("saves the session owner-only and outside every backup", async () => {
    const source = await pairWorkspaceSource({ dataDir, address, code: "ABCD-EFGH-JKLM", label: "Sync fixture" });
    expect(source).toMatchObject({ address, token: TOKEN });
    const file = join(dataDir, WORKSPACE_SOURCE_FILE);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readWorkspaceSource(dataDir)).toEqual(source);
    expect(excludedWorkspaceAuthPath(WORKSPACE_SOURCE_FILE)).toBe(true);
    expect(excludedWorkspaceAuthPath(`${WORKSPACE_SOURCE_FILE}.123.0f0e-aa.tmp`)).toBe(true);
  });

  it("reads the code from a pasted pairing link", async () => {
    await pairWorkspaceSource({ dataDir, address: `${address}/pair#code=ABCD-EFGH-JKLM`, code: "", label: "Sync fixture" });
    expect(readWorkspaceSource(dataDir)?.token).toBe(TOKEN);
  });

  it("refuses a chat-only code and ends the session it was given", async () => {
    scopes = ["client"];
    await expect(pairWorkspaceSource({ dataDir, address, code: "ABCD-EFGH-JKLM", label: "Sync fixture" })).rejects.toThrow(/Full access/);
    expect(revoked).toEqual([`Bearer ${TOKEN}`]);
    expect(existsSync(join(dataDir, WORKSPACE_SOURCE_FILE))).toBe(false);
  });

  it("passes on a wrong code and keeps the previous connection", async () => {
    await pairWorkspaceSource({ dataDir, address, code: "ABCD-EFGH-JKLM", label: "Sync fixture" });
    await expect(pairWorkspaceSource({ dataDir, address, code: "WRONG-CODE", label: "Sync fixture" })).rejects.toThrow(/no longer accepts|wrong/);
    expect(readWorkspaceSource(dataDir)?.token).toBe(TOKEN);
  });

  it("says the tunnel is down when nothing answers", async () => {
    await expect(pairWorkspaceSource({ dataDir, address: "http://127.0.0.1:1", code: "ABCD-EFGH-JKLM", label: "Sync fixture" })).rejects.toThrow(/SSH tunnel is running/);
  });

  it("ignores a stored file that does not hold a session", () => {
    writeFileSync(join(dataDir, WORKSPACE_SOURCE_FILE), JSON.stringify({ address: "http://192.168.0.2:1", token: TOKEN, pairedAt: "x" }));
    expect(readWorkspaceSource(dataDir)).toBeNull();
  });

  it("forgets the connection and ends the session on the other computer", async () => {
    await pairWorkspaceSource({ dataDir, address, code: "ABCD-EFGH-JKLM", label: "Sync fixture" });
    await forgetWorkspaceSource(dataDir);
    expect(readWorkspaceSource(dataDir)).toBeNull();
    expect(revoked).toEqual([`Bearer ${TOKEN}`]);
  });
});

describe("downloadSourceBackup", () => {
  it("asks for a fresh backup with the given password and streams it to disk", async () => {
    const source = await pairWorkspaceSource({ dataDir, address, code: "ABCD-EFGH-JKLM", label: "Sync fixture" });
    const destination = join(dataDir, "pulled.ombbackup");
    const result = await downloadSourceBackup({ source, password: "fixture password 123", destination, maxBytes: 1024 });
    expect(result.bytes).toBe(BACKUP.length);
    expect(readFileSync(destination)).toEqual(BACKUP);
    expect(exports).toEqual([{ password: "fixture password 123", authorization: `Bearer ${TOKEN}` }]);
  });

  it("refuses a backup over the size limit and leaves no partial file", async () => {
    const source = await pairWorkspaceSource({ dataDir, address, code: "ABCD-EFGH-JKLM", label: "Sync fixture" });
    const destination = join(dataDir, "pulled.ombbackup");
    await expect(downloadSourceBackup({ source, password: "fixture password 123", destination, maxBytes: 4 })).rejects.toThrow(/larger than 10 GB/);
    expect(existsSync(destination)).toBe(false);
  });

  it("asks to connect again when the other computer revoked this one", async () => {
    const destination = join(dataDir, "pulled.ombbackup");
    const source = { address, token: `omb_sess_${"b".repeat(43)}`, pairedAt: new Date().toISOString() };
    await expect(downloadSourceBackup({ source, password: "fixture password 123", destination, maxBytes: 1024 })).rejects.toMatchObject({ status: 401 });
    expect(existsSync(destination)).toBe(false);
  });

  it("reports a failed download", async () => {
    downloadStatus = 404;
    const source = await pairWorkspaceSource({ dataDir, address, code: "ABCD-EFGH-JKLM", label: "Sync fixture" });
    const destination = join(dataDir, "pulled.ombbackup");
    await expect(downloadSourceBackup({ source, password: "fixture password 123", destination, maxBytes: 1024 })).rejects.toThrow(/answered 404/);
    expect(existsSync(destination)).toBe(false);
  });
});
