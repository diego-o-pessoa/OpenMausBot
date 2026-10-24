import { createWriteStream, existsSync, lstatSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { isLoopbackHost } from "./request-auth.ts";

/** Holds an admin session on the source computer: owner-only, never in a backup, kept by a restore. */
export const WORKSPACE_SOURCE_FILE = "workspace-source.json";

const PAIR_TIMEOUT_MS = 15_000;
const LOGOUT_TIMEOUT_MS = 5_000;
const TRANSFER_TIMEOUT_MS = 60 * 60_000;

export interface WorkspaceSource {
  address: string;
  token: string;
  pairedAt: string;
}

export interface WorkspaceSourceView {
  address: string;
  pairedAt: string;
}

type Fetch = typeof fetch;

const storedSource = z.object({
  address: z.string().max(2048),
  token: z.string().regex(/^omb_sess_[A-Za-z0-9_-]{20,128}$/),
  pairedAt: z.string().max(64),
});

const failure = (message: string, status = 400) => Object.assign(new Error(message), { status });

/** Plain HTTP only reaches a loopback address (an SSH tunnel's local end); anything else needs HTTPS. */
export function parseSourceAddress(text: string): { address: string; code: string | null } {
  let url: URL;
  try {
    url = new URL(text.trim().includes("://") ? text.trim() : `http://${text.trim()}`);
  } catch {
    throw failure("Enter the address as http://127.0.0.1:PORT, the local end of your SSH tunnel.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw failure("The address must start with http:// or https://.");
  if (url.username || url.password) throw failure("Leave the user name and password out of the address.");
  if (url.protocol === "http:" && !isLoopbackHost(url.host)) {
    throw failure("Without HTTPS, connect through an SSH tunnel and use its local address, such as http://127.0.0.1:18799.");
  }
  if (url.search || (url.pathname !== "/" && url.pathname !== "/pair")) throw failure("Enter only the address, such as http://127.0.0.1:18799.");
  const code = /^#code=([A-Za-z0-9-]{4,64})$/.exec(url.hash)?.[1] ?? null;
  if (url.hash && !code) throw failure("Enter only the address, such as http://127.0.0.1:18799.");
  return { address: url.origin, code };
}

export function readWorkspaceSource(dataDir: string): WorkspaceSource | null {
  const file = join(dataDir, WORKSPACE_SOURCE_FILE);
  if (!existsSync(file) || lstatSync(file).isSymbolicLink()) return null;
  try {
    const parsed = storedSource.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success) return null;
    return { ...parsed.data, address: parseSourceAddress(parsed.data.address).address };
  } catch {
    return null;
  }
}

export function sourceView(source: WorkspaceSource | null): WorkspaceSourceView | null {
  return source ? { address: source.address, pairedAt: source.pairedAt } : null;
}

function saveWorkspaceSource(dataDir: string, source: WorkspaceSource): void {
  writeFileAtomic(join(dataDir, WORKSPACE_SOURCE_FILE), `${JSON.stringify(source, null, 2)}\n`, { mode: 0o600 });
}

async function remoteError(response: Response, address: string): Promise<Error> {
  let detail = "";
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body?.error === "string") detail = body.error.slice(0, 300);
  } catch {}
  if (response.status === 401) {
    return failure(`${address} no longer accepts this computer${detail ? ` (${detail})` : ""}. Create a new pairing code there and connect again.`, 401);
  }
  return failure(`${address} answered ${response.status}${detail ? `: ${detail}` : ""}`, 502);
}

function unreachable(address: string, error: unknown): Error {
  const reason = error instanceof Error && error.name === "TimeoutError" ? "did not answer in time" : "could not be reached";
  return failure(`${address} ${reason}. Check that OpenMausBot is open there and that the SSH tunnel is running.`, 502);
}

export async function pairWorkspaceSource(options: {
  dataDir: string;
  address: string;
  code: string;
  label: string;
  fetch?: Fetch;
  now?: () => Date;
}): Promise<WorkspaceSource> {
  const call = options.fetch ?? fetch;
  const parsed = parseSourceAddress(options.address);
  const code = (options.code.trim() || parsed.code || "").trim();
  if (!code) throw failure("Enter the pairing code shown on the other computer.");
  let response: Response;
  try {
    response = await call(`${parsed.address}/api/auth/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, label: options.label }),
      redirect: "error",
      signal: AbortSignal.timeout(PAIR_TIMEOUT_MS),
    });
  } catch (error) {
    throw unreachable(parsed.address, error);
  }
  if (!response.ok) throw await remoteError(response, parsed.address);
  const body = await response.json().catch(() => null) as { token?: unknown; session?: { scopes?: unknown } } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  const scopes = Array.isArray(body?.session?.scopes) ? body.session.scopes : [];
  const source = { address: parsed.address, token, pairedAt: (options.now?.() ?? new Date()).toISOString() };
  if (!storedSource.safeParse(source).success) throw failure(`${parsed.address} did not return a session. Is it OpenMausBot?`, 502);
  if (!scopes.includes("admin")) {
    await revoke(call, source);
    throw failure("This code has chat-only access. On the other computer, create a pairing code with Full access.", 403);
  }
  const previous = readWorkspaceSource(options.dataDir);
  saveWorkspaceSource(options.dataDir, source);
  if (previous && previous.token !== source.token) await revoke(call, previous);
  return source;
}

async function revoke(call: Fetch, source: WorkspaceSource): Promise<void> {
  try {
    await call(`${source.address}/api/auth/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${source.token}`, "content-type": "application/json" },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(LOGOUT_TIMEOUT_MS),
    });
  } catch {}
}

/** Ends the session on the source when it can be reached; the local copy is removed either way. */
export async function forgetWorkspaceSource(dataDir: string, call: Fetch = fetch): Promise<void> {
  const source = readWorkspaceSource(dataDir);
  const file = join(dataDir, WORKSPACE_SOURCE_FILE);
  if (existsSync(file)) unlinkSync(file);
  if (source) await revoke(call, source);
}

/** Asks the source for a fresh encrypted backup and streams it to `destination`. */
export async function downloadSourceBackup(options: {
  source: WorkspaceSource;
  password: string;
  destination: string;
  maxBytes: number;
  fetch?: Fetch;
}): Promise<{ bytes: number }> {
  const call = options.fetch ?? fetch;
  const { address, token } = options.source;
  const headers = { authorization: `Bearer ${token}` };
  let created: Response;
  try {
    created = await call(`${address}/api/workspace-backup/export`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ password: options.password, clientState: {} }),
      redirect: "error",
      signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
    });
  } catch (error) {
    throw unreachable(address, error);
  }
  if (!created.ok) throw await remoteError(created, address);
  const exported = await created.json().catch(() => null) as { id?: unknown } | null;
  const id = typeof exported?.id === "string" && /^[\w-]{1,64}$/.test(exported.id) ? exported.id : null;
  if (!id) throw failure(`${address} did not return a backup.`, 502);

  let download: Response;
  try {
    download = await call(`${address}/api/workspace-backup/download/${encodeURIComponent(id)}`, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
    });
  } catch (error) {
    throw unreachable(address, error);
  }
  if (!download.ok || !download.body) throw await remoteError(download, address);
  const declared = Number(download.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > options.maxBytes) throw failure("The other computer's backup is larger than 10 GB.", 413);
  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > options.maxBytes ? failure("The other computer's backup is larger than 10 GB.", 413) : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(download.body as import("node:stream/web").ReadableStream), limit, createWriteStream(options.destination, { flags: "wx", mode: 0o600 }));
  } catch (error) {
    try { unlinkSync(options.destination); } catch {}
    if ((error as { status?: number }).status) throw error;
    throw unreachable(address, error);
  }
  if (Number.isFinite(declared) && declared > 0 && bytes !== declared) {
    try { unlinkSync(options.destination); } catch {}
    throw failure("The transfer was cut off. Try again.", 502);
  }
  return { bytes };
}
