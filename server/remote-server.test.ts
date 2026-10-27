import { describe, expect, it } from "vitest";

import { createRemoteServerJobs, installScript, jobPercent, parseRemoteLine, publicJob, remoteScriptCommand, sshArgs, unixLineEndings, type SshRunner } from "./remote-server.ts";

const REPO = "https://github.com/diego-o-pessoa/OpenMausBot.git";

function scripted(lines: string[], result: { code: number | null; stderr?: string } = { code: 0 }) {
  const calls: Array<{ args: string[]; input: string }> = [];
  const runner: SshRunner = async (args, input, onLine) => {
    calls.push({ args, input });
    for (const line of lines) onLine(line);
    return { code: result.code, stderr: result.stderr ?? "" };
  };
  return { calls, runner };
}

describe("parseRemoteLine", () => {
  it("reads steps, details, results, containers, errors and the end", () => {
    expect(parseRemoteLine("::omb step 4/8 build")).toEqual({ kind: "step", index: 4, total: 8, key: "build" });
    expect(parseRemoteLine("::omb detail Instalando o Node 24")).toEqual({ kind: "detail", text: "Instalando o Node 24" });
    expect(parseRemoteLine("::omb result installed_commit abc123")).toEqual({ kind: "result", key: "installed_commit", value: "abc123" });
    expect(parseRemoteLine("::omb result os Ubuntu 24.04.5 LTS")).toEqual({ kind: "result", key: "os", value: "Ubuntu 24.04.5 LTS" });
    expect(parseRemoteLine("::omb container webtop|lscr.io/linuxserver/webtop|running"))
      .toEqual({ kind: "container", container: { name: "webtop", image: "lscr.io/linuxserver/webtop", state: "running" } });
    expect(parseRemoteLine("::omb error the build failed")).toEqual({ kind: "error", message: "the build failed" });
    expect(parseRemoteLine("::omb done")).toEqual({ kind: "done" });
    for (const noise of ["npm WARN deprecated", "::omb step x/8 build", ":: omb done", ""]) expect(parseRemoteLine(noise)).toBeNull();
  });
});

describe("jobPercent", () => {
  it("gives each step an equal share and moves through the build without reaching the next step", () => {
    expect(jobPercent({ phase: "running", step: null, details: [] })).toBe(0);
    expect(jobPercent({ phase: "running", step: { index: 1, total: 8, key: "prepare" }, details: [] })).toBe(0);
    expect(jobPercent({ phase: "running", step: { index: 4, total: 8, key: "build" }, details: [] })).toBe(38);
    expect(jobPercent({ phase: "running", step: { index: 4, total: 8, key: "build" }, details: Array(20).fill("x") })).toBeLessThan(50);
    expect(jobPercent({ phase: "running", step: { index: 8, total: 8, key: "pair" }, details: [] })).toBe(88);
    expect(jobPercent({ phase: "done", step: { index: 8, total: 8, key: "pair" }, details: [] })).toBe(100);
  });
});

describe("the SSH command", () => {
  it("sends the scripts with Unix line endings even from a Windows checkout", () => {
    expect(unixLineEndings("set -euo pipefail\r\necho ok\r\n")).toBe("set -euo pipefail\necho ok\n");
    expect(installScript()).not.toContain("\r");
  });
  it("quotes every value it sends, so a repository or label cannot run its own command", () => {
    const command = remoteScriptCommand({ action: "install", repo: REPO, branch: "main", pairLabel: "Diego's PC; rm -rf /" });
    expect(command).toBe(`env OMB_ACTION='install' OMB_REPO='${REPO}' OMB_BRANCH='main' OMB_SERVER_PORT=8799 OMB_PAIR_LABEL='Diegos PC rm -rf ' bash -s`);
    expect(sshArgs("minha-vps", command, null)).toEqual(["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", "minha-vps", command]);
    expect(() => sshArgs("-oProxyCommand=evil", command, null)).toThrow();
  });

  it("ships the install script, which it sends on stdin", () => {
    expect(installScript()).toContain("::omb");
  });
});

describe("jobs", () => {
  it("checks a machine and lists its containers", async () => {
    const { calls, runner } = scripted([
      "::omb result os Ubuntu 24.04.5 LTS", "::omb result docker yes", "::omb container webtop|webtop:latest|running",
      "::omb result installed_commit none", "::omb result up_to_date no",
    ]);
    const jobs = createRemoteServerJobs({ dataDir: "/tmp", runner, script: () => "#!/bin/bash" });
    const job = await jobs.start({ action: "check", alias: "minha-vps", repo: REPO, branch: "main" }).finished;
    expect(job).toMatchObject({ phase: "done", results: { os: "Ubuntu 24.04.5 LTS", docker: "yes", up_to_date: "no" }, containers: [{ name: "webtop" }] });
    expect(calls[0]!.input).toBe("#!/bin/bash");
    expect(calls[0]!.args.at(-1)).toContain("OMB_ACTION='check'");
  });

  it("follows an install to the end and hands the pairing code only to the job's own read", async () => {
    const { runner } = scripted(["::omb step 1/8 prepare", "::omb step 4/8 build", "::omb detail Instalando o Node 24", "::omb step 8/8 pair",
      "::omb result pairing_code ABCD-EFGH-JKLM", "::omb result port 8799", "::omb done"]);
    const jobs = createRemoteServerJobs({ dataDir: "/tmp", runner, script: () => "" });
    const job = await jobs.start({ action: "install", alias: "minha-vps", repo: REPO, branch: "main" }).finished;
    expect(job.phase).toBe("done");
    expect(job.percent).toBe(100);
    expect(publicJob(job).results.pairing_code).toBeUndefined();
    expect(publicJob(job, true).results.pairing_code).toBe("ABCD-EFGH-JKLM");
  });

  it("finishes an install that found the server already up to date, without a pairing code", async () => {
    const { runner } = scripted(["::omb step 1/8 prepare", "::omb result up_to_date yes", "::omb step 8/8 done"]);
    const job = await createRemoteServerJobs({ dataDir: "/tmp", runner, script: () => "" })
      .start({ action: "install", alias: "minha-vps", repo: REPO, branch: "main" }).finished;
    expect(job).toMatchObject({ phase: "done", results: { up_to_date: "yes" } });
  });

  it("reports the script's own error, or an SSH failure in plain words", async () => {
    const failed = await createRemoteServerJobs({ dataDir: "/tmp", runner: scripted(["::omb step 4/8 build", "::omb error the build failed"], { code: 1 }).runner, script: () => "" })
      .start({ action: "install", alias: "minha-vps", repo: REPO, branch: "main" }).finished;
    expect(failed).toMatchObject({ phase: "failed", error: "the build failed" });
    const refused = await createRemoteServerJobs({ dataDir: "/tmp", runner: scripted([], { code: 255, stderr: "root@1.2.3.4: Permission denied (publickey,password)." }).runner, script: () => "" })
      .start({ action: "check", alias: "minha-vps", repo: REPO, branch: "main" }).finished;
    expect(refused.error).toMatch(/sign in with a key/);
    const unknown = await createRemoteServerJobs({ dataDir: "/tmp", runner: scripted([], { code: 255, stderr: "ssh: Could not resolve hostname minha-vps: Name or service not known" }).runner, script: () => "" })
      .start({ action: "check", alias: "minha-vps", repo: REPO, branch: "main" }).finished;
    expect(unknown.error).toMatch(/not an SSH alias/);
  });

  it("refuses a bad alias, repository or branch, and a second job while one runs", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const runner: SshRunner = async () => { await held; return { code: 0, stderr: "" }; };
    const jobs = createRemoteServerJobs({ dataDir: "/tmp", runner, script: () => "" });
    expect(() => jobs.start({ action: "check", alias: "bad alias", repo: REPO, branch: "main" })).toThrow(/SSH alias/);
    expect(() => jobs.start({ action: "check", alias: "vps", repo: "file:///etc", branch: "main" })).toThrow(/repository/);
    expect(() => jobs.start({ action: "check", alias: "vps", repo: REPO, branch: "../x" })).toThrow(/branch/);
    const first = jobs.start({ action: "install", alias: "vps", repo: REPO, branch: "main" });
    expect(() => jobs.start({ action: "check", alias: "vps", repo: REPO, branch: "main" })).toThrow(/installation is running/);
    release();
    await first.finished;
    expect(jobs.get(first.job.id)?.phase).toBe("failed");
  });
});

describe("what moves to the VPS", () => {
  it("takes the person's connections, rewrites a repository script MCP server, and leaves Windows-only paths behind", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { movePayload, reverseTunnelArgs } = await import("./remote-server.ts");
    const home = mkdtempSync(join(tmpdir(), "omb-move-home-"));
    const dataDir = join(home, ".openmausbot");
    try {
      mkdirSync(join(home, ".claude"), { recursive: true });
      writeFileSync(join(home, ".claude", ".credentials.json"), "{\"claudeAiOauth\":{}}");
      mkdirSync(join(dataDir, "providers", "claude-work"), { recursive: true });
      writeFileSync(join(dataDir, "providers", "claude-work", ".credentials.json"), "{}");
      writeFileSync(join(dataDir, "providers", "claude-work", "history.jsonl"), "big");
      const { payload, summary } = movePayload({
        code: "ABCD-EFGH-JKLM", home, dataDir,
        config: {
          anthropic: { key: "sk-ant-fixture" }, tomticket: { key: "tt-fixture" }, vps: { sshAlias: "minha-vps" }, customDomain: "x.example",
          mcpServers: {
            tomticket: { command: "C:\\Users\\Diego\\AppData\\Local\\Programs\\OpenMausBot\\OpenMausBot.exe", args: ["C:\\OpenMausBot-src\\scripts\\tomticket-mcp.mjs"], env: { ELECTRON_RUN_AS_NODE: "1", TOMTICKET_TOKEN: "tok" }, enabled: true },
            windowsOnly: { command: "C:\\tools\\thing.exe", args: [], enabled: true },
            remote: { url: "https://mcp.example/mcp", enabled: true },
          },
          instances: {
            claude: { driver: "claudeAgent", config: { cli: "C:\\Users\\Diego\\AppData\\Roaming\\npm\\claude.cmd", fullAuto: true } },
            "claude-work": { driver: "claudeAgent", config: { configDir: join(dataDir, "providers", "claude-work") } },
          },
        },
      });
      expect(Object.keys(payload.config).sort()).toEqual(["anthropic", "mcpServers", "tomticket"]);
      expect(payload.config.mcpServers).toEqual({
        tomticket: { command: "node", args: ["__OMB_HOME__/OpenMausBot/scripts/tomticket-mcp.mjs"], env: { TOMTICKET_TOKEN: "tok" }, enabled: true },
        remote: { url: "https://mcp.example/mcp", enabled: true },
      });
      expect(summary.leftMcpServers).toEqual(["windowsOnly"]);
      expect(payload.instances).toEqual({
        claude: { driver: "claudeAgent", config: { fullAuto: true } },
        "claude-work": { driver: "claudeAgent", config: { configDir: "__OMB_HOME__/.openmausbot/providers/claude-work" } },
      });
      expect(payload.files.map((file) => file.path).sort()).toEqual([".claude/.credentials.json", ".openmausbot/providers/claude-work/.credentials.json"]);
      expect(Buffer.from(payload.files.find((file) => file.path.startsWith(".claude"))!.base64, "base64").toString()).toBe("{\"claudeAiOauth\":{}}");
      expect(payload.code).toBe("ABCD-EFGH-JKLM");
      expect(reverseTunnelArgs("minha-vps", 8799).slice(-3)).toEqual(["-R", "127.0.0.1:38799:127.0.0.1:8799", "minha-vps"]);
      expect(reverseTunnelArgs("minha-vps", 8799, "linux")).toContain("ControlPath=none");
      expect(reverseTunnelArgs("minha-vps", 8799, "win32")).not.toContain("ControlPath=none");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
