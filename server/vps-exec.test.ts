import { describe, expect, it } from "vitest";
import type { AppConfig } from "./config.ts";
import { vpsContainerExec, type VpsCommandRunner } from "./vps-computer.ts";

const cfg = { vps: { sshAlias: "my-vps" } } as AppConfig;
const CONTAINER = "openmausbot-vps-bot1-0123456789ab";

function recording(answer: { stdout: string; stderr: string } | Error) {
  const calls: Array<{ args: string[]; timeoutMs?: number }> = [];
  const runner: VpsCommandRunner = async (args, options) => {
    calls.push({ args, timeoutMs: options?.timeoutMs });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { calls, runner };
}

describe("vpsContainerExec", () => {
  it("runs the command as the desktop user in the bot's VPS container, with the limit inside the container", async () => {
    const { calls, runner } = recording({ stdout: "AnyDesk 7.0\n", stderr: "__openmausbot_exit__=0\n" });
    const result = await vpsContainerExec(cfg, CONTAINER, "anydesk --version", { timeoutSeconds: 90, runner });
    expect(result).toEqual({ exitCode: 0, stdout: "AnyDesk 7.0\n", stderr: "", timedOut: false });
    const [call] = calls;
    expect(call!.args.slice(0, 3)).toEqual(["-H", "ssh://my-vps", "exec"]);
    expect(call!.args).toContain(CONTAINER);
    expect(call!.args.slice(call!.args.indexOf("-u"), call!.args.indexOf("-u") + 2)).toEqual(["-u", "cua"]);
    expect(call!.args.slice(-2)).toEqual(["90", "anydesk --version"]);
    expect(call!.timeoutMs).toBe(110_000);
  });

  it("returns a failing command's own exit code and keeps its error output", async () => {
    const { runner } = recording({ stdout: "", stderr: "E: Unable to locate package anydesk\n__openmausbot_exit__=100\n" });
    expect(await vpsContainerExec(cfg, CONTAINER, "sudo apt-get install -y anydesk", { runner }))
      .toEqual({ exitCode: 100, stdout: "", stderr: "E: Unable to locate package anydesk\n", timedOut: false });
  });

  it("reports a command stopped at its limit", async () => {
    const { runner } = recording({ stdout: "", stderr: "__openmausbot_exit__=124\n" });
    expect((await vpsContainerExec(cfg, CONTAINER, "sleep 999", { timeoutSeconds: 1, runner })).timedOut).toBe(true);
  });

  it("says the VPS could not be reached when Docker over SSH fails", async () => {
    const { runner } = recording(new Error("ssh: connect to host my-vps port 22: Connection refused"));
    await expect(vpsContainerExec(cfg, CONTAINER, "true", { runner })).rejects.toMatchObject({ status: 502, message: expect.stringContaining("Connection refused") });
  });

  it("refuses an empty command, a missing VPS or a container name that is not one", async () => {
    const { calls, runner } = recording({ stdout: "", stderr: "__openmausbot_exit__=0\n" });
    await expect(vpsContainerExec(cfg, CONTAINER, "  ", { runner })).rejects.toMatchObject({ status: 400 });
    await expect(vpsContainerExec({} as AppConfig, CONTAINER, "true", { runner })).rejects.toMatchObject({ status: 409 });
    await expect(vpsContainerExec(cfg, "--privileged", "true", { runner })).rejects.toThrow(/invalid VPS container/);
    expect(calls).toEqual([]);
  });
});
