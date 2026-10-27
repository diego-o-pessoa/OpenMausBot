// Checks, installs and updates an OpenMausBot server on the person's own Linux machine over SSH, with progress.
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { isValidSshAlias } from "./config.ts";
import { augmentedPath } from "./env-path.ts";
import { spawnCli } from "./procs.ts";
import { prepareVpsSsh } from "./vps-ssh.ts";

export const DEFAULT_REMOTE_REPO = "https://github.com/diego-o-pessoa/OpenMausBot.git";
export const DEFAULT_REMOTE_BRANCH = "main";
export const REMOTE_SERVER_PORT = 8799;
const MAX_DETAILS = 40;
const CHECK_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 60 * 60_000;

export type RemoteAction = "check" | "install" | "move" | "pair";
/** Where the desktop's own server is reached from the VPS while it moves in: a reverse tunnel, held only for the move. */
export const MOVE_SOURCE_PORT = 38799;

export interface RemoteContainer { name: string; image: string; state: string }

export interface RemoteServerJob {
  id: string;
  action: RemoteAction;
  alias: string;
  repo: string;
  branch: string;
  phase: "running" | "done" | "failed";
  step: { index: number; total: number; key: string } | null;
  percent: number;
  details: string[];
  results: Record<string, string>;
  containers: RemoteContainer[];
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export type RemoteLine =
  | { kind: "step"; index: number; total: number; key: string }
  | { kind: "detail"; text: string }
  | { kind: "result"; key: string; value: string }
  | { kind: "container"; container: RemoteContainer }
  | { kind: "error"; message: string }
  | { kind: "done" };

export function parseRemoteLine(line: string): RemoteLine | null {
  const match = /^::omb (\S+)(?: (.*))?$/.exec(line.trimEnd());
  if (!match) return null;
  const [, kind, rest = ""] = match;
  if (kind === "step") {
    const step = /^(\d+)\/(\d+) (\S+)$/.exec(rest);
    return step ? { kind: "step", index: Number(step[1]), total: Number(step[2]), key: step[3]! } : null;
  }
  if (kind === "detail") return { kind: "detail", text: rest.slice(0, 300) };
  if (kind === "result") {
    const result = /^([a-z_]+) ?(.*)$/.exec(rest);
    return result ? { kind: "result", key: result[1]!, value: result[2]!.slice(0, 300) } : null;
  }
  if (kind === "container") {
    const [name = "", image = "", state = ""] = rest.split("|");
    return name ? { kind: "container", container: { name: name.slice(0, 120), image: image.slice(0, 200), state: state.slice(0, 40) } } : null;
  }
  if (kind === "error") return { kind: "error", message: rest.slice(0, 500) };
  if (kind === "done") return { kind: "done" };
  return null;
}

/** Each step owns an equal share; the build's sub-steps move it through its share without reaching the next. */
export function jobPercent(job: Pick<RemoteServerJob, "phase" | "step" | "details">): number {
  if (job.phase === "done") return 100;
  if (!job.step) return 0;
  const share = 100 / job.step.total;
  const base = (job.step.index - 1) * share;
  const within = job.step.key === "build" ? Math.min(0.9, job.details.length / 8) * share : 0;
  return Math.min(99, Math.round(base + within));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function validRepo(value: string): boolean {
  return value.length <= 500 && /^(?:https:\/\/[^\s'"]+|ssh:\/\/[^\s'"]+|git@[A-Za-z0-9.-]+:[^\s'"]+)$/.test(value);
}

export function validBranch(value: string): boolean {
  return /^[A-Za-z0-9._/-]{1,100}$/.test(value) && !value.includes("..");
}

export function remoteScriptCommand(input: { action: RemoteAction; repo: string; branch: string; pairLabel?: string }): string {
  const env = [
    `OMB_ACTION=${shellQuote(input.action)}`,
    `OMB_REPO=${shellQuote(input.repo)}`,
    `OMB_BRANCH=${shellQuote(input.branch)}`,
    `OMB_SERVER_PORT=${REMOTE_SERVER_PORT}`,
    ...(input.pairLabel ? [`OMB_PAIR_LABEL=${shellQuote(input.pairLabel.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 60))}`] : []),
  ];
  return `env ${env.join(" ")} bash -s`;
}

/** Git for Windows checks text out with CRLF under core.autocrlf, and bash on the VPS reads "set -o pipefail\r" as an unknown option. */
export const unixLineEndings = (script: string) => script.replace(/\r\n?/g, "\n");

const here = dirname(fileURLToPath(import.meta.url));
/** Beside the bundle in a build; in the repository's deploy folder when the server runs from source. */
function deployScript(name: string): string {
  for (const candidate of [join(here, name), join(here, "..", "deploy", "remote", name)]) {
    if (existsSync(candidate)) return unixLineEndings(readFileSync(candidate, "utf8"));
  }
  throw new Error(`The VPS script ${name} is missing from this build.`);
}
export const installScript = () => deployScript("install-server.sh");
export const moveScript = () => deployScript("move-in.sh");

/** Connections and engine settings that belong to the person, not to this computer: they move with the bots. */
export const MOVE_CONFIG_KEYS = [
  "anthropic", "openai", "openrouter", "openaiCompat", "xai", "mistral", "cerebras", "groq", "meta", "opencodeGo",
  "tts", "live", "composio", "box", "treg", "tomticket", "decider", "imageGen", "defaultModelSelection", "newBotDefaults",
  "newBots", "automaticRecovery", "cacheKeepWarm",
] as const;
/** The engines' sign-in files, under the home folder: Claude Code, Codex and Gemini CLI. */
export const ENGINE_SIGN_IN_FILES = [
  ".claude/.credentials.json", ".codex/auth.json", ".gemini/oauth_creds.json", ".gemini/google_accounts.json", ".gemini/settings.json",
] as const;
const PROVIDER_SIGN_IN_NAMES = new Set([".credentials.json", "auth.json", "oauth_creds.json", "google_accounts.json", "settings.json"]);
const MAX_SIGN_IN_FILE_BYTES = 1024 * 1024;
/** Replaced with the server's home folder on the VPS, which this computer does not know. */
export const REMOTE_HOME = "__OMB_HOME__";

const windowsPath = (value: unknown) => typeof value === "string" && (/^[A-Za-z]:[\\/]/.test(value) || /\\/.test(value) || /\.(?:exe|cmd|bat)$/i.test(value));

function portableMcpServers(servers: Record<string, unknown> | undefined): { servers: Record<string, unknown>; left: string[] } {
  const out: Record<string, unknown> = {};
  const left: string[] = [];
  for (const [name, raw] of Object.entries(servers ?? {})) {
    const server = raw as { command?: unknown; args?: unknown; env?: Record<string, string>; url?: unknown };
    if (typeof server?.url === "string") { out[name] = raw; continue; }
    const args = Array.isArray(server?.args) ? server.args.filter((arg): arg is string => typeof arg === "string") : [];
    const script = args.map((arg) => /(?:^|[\\/])scripts[\\/]([\w.-]+\.mjs)$/.exec(arg)?.[1]).find(Boolean);
    if (script) {
      const env = { ...server.env };
      delete env.ELECTRON_RUN_AS_NODE;
      out[name] = { ...server, command: "node", args: [`${REMOTE_HOME}/OpenMausBot/scripts/${script}`], env };
      continue;
    }
    if (windowsPath(server?.command) || args.some(windowsPath)) { left.push(name); continue; }
    out[name] = raw;
  }
  return { servers: out, left };
}

function portableInstances(instances: Record<string, unknown> | undefined, dataDir: string): Record<string, unknown> | undefined {
  if (!instances) return undefined;
  const out: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(instances)) {
    const entry = { ...(raw as Record<string, unknown>) };
    const config: Record<string, unknown> = { ...(entry.config as Record<string, unknown> | undefined) };
    if (windowsPath(config.cli)) delete config.cli;
    if (typeof config.configDir === "string") {
      const inside = relative(dataDir, config.configDir);
      if (!inside.startsWith("..") && !/^[A-Za-z]:/.test(inside)) config.configDir = `${REMOTE_HOME}/.openmausbot/${inside.split(sep).join("/")}`;
      else if (windowsPath(config.configDir)) delete config.configDir;
    }
    entry.config = config;
    out[id] = entry;
  }
  return out;
}

function signInFiles(home: string, dataDir: string): Array<{ path: string; base64: string }> {
  const files: Array<{ path: string; base64: string }> = [];
  const add = (absolute: string, remote: string) => {
    try {
      const stat = statSync(absolute);
      if (stat.isFile() && stat.size <= MAX_SIGN_IN_FILE_BYTES) files.push({ path: remote, base64: readFileSync(absolute).toString("base64") });
    } catch {}
  };
  for (const file of ENGINE_SIGN_IN_FILES) add(join(home, ...file.split("/")), file);
  const providers = join(dataDir, "providers");
  const walk = (dir: string, depth: number) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory() && depth < 3 && !["trial-credit", "hosted", "company"].includes(entry.name)) walk(absolute, depth + 1);
      else if (entry.isFile() && PROVIDER_SIGN_IN_NAMES.has(entry.name)) add(absolute, `.openmausbot/providers/${relative(providers, absolute).split(sep).join("/")}`);
    }
  };
  walk(providers, 0);
  return files;
}

/** What moves besides the backup: the pairing code for this computer, the person's connections and the engines' sign-ins. */
export function movePayload(input: { code: string; config: Record<string, unknown>; home: string; dataDir: string }) {
  const config: Record<string, unknown> = {};
  for (const key of MOVE_CONFIG_KEYS) if (input.config[key] !== undefined) config[key] = input.config[key];
  const mcp = portableMcpServers(input.config.mcpServers as Record<string, unknown> | undefined);
  if (Object.keys(mcp.servers).length) config.mcpServers = mcp.servers;
  const instances = portableInstances(input.config.instances as Record<string, unknown> | undefined, input.dataDir);
  const files = signInFiles(input.home, input.dataDir);
  return {
    payload: { code: input.code, config, ...(instances ? { instances } : {}), files },
    summary: { keys: Object.keys(config), signIns: files.map((file) => file.path), leftMcpServers: mcp.left },
  };
}

export type SshRunner = (args: string[], input: string, onLine: (line: string) => void, timeoutMs: number) => Promise<{ code: number | null; stderr: string }>;

export function sshArgs(alias: string, command: string, configPath: string | null): string[] {
  if (!isValidSshAlias(alias)) throw new Error("invalid SSH alias");
  return [
    ...(configPath ? ["-F", configPath] : []),
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=15",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=4",
    alias,
    command,
  ];
}

export function defaultSshRunner(dataDir: string): SshRunner {
  return (args, input, onLine, timeoutMs) => new Promise((resolve) => {
    const ssh = prepareVpsSsh(dataDir, augmentedPath());
    const child = spawnCli("ssh", ssh.configPath ? ["-F", ssh.configPath, ...args] : args, {
      shell: false, env: { ...process.env, PATH: ssh.path }, stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); }, timeoutMs);
    timer.unref?.();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        onLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    });
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-4000); });
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: null, stderr: error.message }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buffer) onLine(buffer);
      resolve({ code, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** Held only while the VPS copies from this computer: the VPS reaches this computer's own server on its loopback port. */
export function reverseTunnelArgs(alias: string, localPort: number, platform: NodeJS.Platform = process.platform): string[] {
  if (!isValidSshAlias(alias)) throw new Error("invalid SSH alias");
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) throw new Error("invalid port");
  return [
    // A shared connection would take the forward and return at once; Windows OpenSSH has none to opt out of.
    "-N", ...(platform === "win32" ? [] : ["-o", "ControlMaster=no", "-o", "ControlPath=none"]),
    "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=15", "-o", "PermitLocalCommand=no",
    "-R", `127.0.0.1:${MOVE_SOURCE_PORT}:127.0.0.1:${localPort}`, alias,
  ];
}

export function openReverseTunnel(dataDir: string, alias: string, localPort: number): Promise<() => void> {
  const ssh = prepareVpsSsh(dataDir, augmentedPath());
  const args = reverseTunnelArgs(alias, localPort);
  const child = spawnCli("ssh", ssh.configPath ? ["-F", ssh.configPath, ...args] : args, {
    shell: false, env: { ...process.env, PATH: ssh.path }, stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
  return new Promise((resolve, reject) => {
    const settle = setTimeout(() => resolve(() => { child.kill(); }), 1500);
    child.once("close", (code) => {
      clearTimeout(settle);
      const reason = stderr.trim().split("\n").filter((line) => !line.startsWith("Warning: Permanently added")).join(" ");
      reject(new Error(`The tunnel back to this computer did not open (${reason || `ssh exited ${code}`}). Close any other OpenMausBot move to this VPS and try again.`));
    });
  });
}

function sshFailure(stderr: string, alias: string): string {
  const text = stderr.trim().split("\n").filter((line) => !line.startsWith("Warning: Permanently added")).join(" ").slice(-400);
  if (/Permission denied/i.test(text)) return `SSH to ${alias} was refused. The alias must sign in with a key, without a password prompt (BatchMode).`;
  if (/Could not resolve hostname|Name or service not known/i.test(text)) return `"${alias}" is not an SSH alias on this computer. Add it to ~/.ssh/config first.`;
  if (/timed out|Connection refused|No route to host/i.test(text)) return `${alias} could not be reached over SSH (${text}).`;
  return text ? `The connection to ${alias} ended: ${text}` : `The connection to ${alias} ended without a result.`;
}

export function createRemoteServerJobs(options: { dataDir: string; runner?: SshRunner; script?: () => string; moveScript?: () => string; now?: () => number }) {
  const jobs = new Map<string, RemoteServerJob>();
  const runner = options.runner ?? defaultSshRunner(options.dataDir);
  const now = options.now ?? Date.now;
  let running: RemoteServerJob | null = null;

  function start(input: { action: RemoteAction; alias: string; repo: string; branch: string; pairLabel?: string;
    move?: { payload: () => string; reverseTunnel: (alias: string) => Promise<() => void> } }): { job: RemoteServerJob; finished: Promise<RemoteServerJob> } {
    if (!isValidSshAlias(input.alias)) throw Object.assign(new Error("Choose the SSH alias of your VPS (from ~/.ssh/config)."), { status: 400 });
    if (!validRepo(input.repo)) throw Object.assign(new Error("Enter the repository as an https://, ssh:// or git@ address."), { status: 400 });
    if (!validBranch(input.branch)) throw Object.assign(new Error("Enter a valid branch name."), { status: 400 });
    if (running) throw Object.assign(new Error(`Another VPS ${running.action === "install" ? "installation" : "check"} is running.`), { status: 409 });
    const job: RemoteServerJob = {
      id: randomUUID(), action: input.action, alias: input.alias, repo: input.repo, branch: input.branch,
      phase: "running", step: null, percent: 0, details: [], results: {}, containers: [], startedAt: now(),
    };
    jobs.set(job.id, job);
    for (const [id, old] of jobs) if (jobs.size > 10 && old !== job && old.phase !== "running") jobs.delete(id);
    running = job;
    if (input.action === "move" && !input.move) { running = null; throw Object.assign(new Error("Nothing to move."), { status: 500 }); }
    let script: string;
    try {
      script = input.action === "move"
        ? `${(options.moveScript ?? moveScript)()}\nmove_in '${input.move!.payload()}'\n`
        : (options.script ?? installScript)();
    } catch (error) {
      running = null;
      throw Object.assign(error as Error, { status: 500 });
    }
    const onLine = (line: string) => {
      const parsed = parseRemoteLine(line);
      if (!parsed) return;
      if (parsed.kind === "step") { job.step = { index: parsed.index, total: parsed.total, key: parsed.key }; job.details = []; }
      else if (parsed.kind === "detail") { job.details.push(parsed.text); if (job.details.length > MAX_DETAILS) job.details.shift(); }
      else if (parsed.kind === "result") job.results[parsed.key] = parsed.value;
      else if (parsed.kind === "container") job.containers.push(parsed.container);
      else if (parsed.kind === "error") job.error = parsed.message;
      job.percent = jobPercent(job);
    };
    const run = async () => {
      const close = input.move ? await input.move.reverseTunnel(input.alias) : null;
      try {
        return await runner(sshArgs(input.alias, remoteScriptCommand(input), null), script, onLine,
          input.action === "check" || input.action === "pair" ? CHECK_TIMEOUT_MS : INSTALL_TIMEOUT_MS);
      } finally {
        close?.();
      }
    };
    const finished = run()
      .catch((error: unknown) => ({ code: null, stderr: error instanceof Error ? error.message : String(error) }))
      .then(({ code, stderr }) => {
        const ok = code === 0 && !job.error && (input.action === "check" || job.results.up_to_date === "yes" || Boolean(job.results.pairing_code));
        job.phase = ok ? "done" : "failed";
        if (!ok && !job.error) job.error = sshFailure(stderr, input.alias);
        job.percent = jobPercent(job);
        job.finishedAt = now();
        return job;
      })
      .finally(() => { if (running === job) running = null; });
    return { job, finished };
  }

  return {
    start,
    get: (id: string) => jobs.get(id) ?? null,
    latest: () => [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt)[0] ?? null,
  };
}

/** What the person sees: the pairing code is handed to the desktop once, then left out. */
export function publicJob(job: RemoteServerJob, includeCode = false): Omit<RemoteServerJob, "results"> & { results: Record<string, string> } {
  const { pairing_code: code, ...results } = job.results;
  return { ...job, results: includeCode && code ? { ...results, pairing_code: code } : results };
}
