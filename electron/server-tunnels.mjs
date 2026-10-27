// SSH tunnels to servers the person runs on their own VPS: the desktop reaches them on a loopback port.
import { spawn as nodeSpawn } from "node:child_process";
import { connect } from "node:net";

const SSH_ALIAS = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const READY_TIMEOUT_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;

export function tunnelArgs({ alias, localPort, remotePort }, platform = process.platform) {
  if (!SSH_ALIAS.test(alias ?? "")) throw new Error("invalid SSH alias");
  for (const port of [localPort, remotePort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid tunnel port");
  }
  return [
    "-N",
    // Windows OpenSSH has no connection sharing to opt out of.
    ...(platform === "win32" ? [] : ["-o", "ControlMaster=no", "-o", "ControlPath=none"]),
    "-o", "BatchMode=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-o", "PermitLocalCommand=no",
    "-L", `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    alias,
  ];
}

export function portAnswers(port, timeoutMs = 1_000) {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export function createServerTunnels({ spawn = nodeSpawn, log = () => {}, answers = portAnswers, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const tunnels = new Map();

  function launch(tunnel) {
    let stderr = "";
    const child = spawn("ssh", tunnelArgs(tunnel), { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    tunnel.child = child;
    child.stderr?.setEncoding?.("utf8");
    child.stderr?.on?.("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    child.once("error", (error) => { stderr = error.message; });
    child.once("exit", (code) => {
      if (tunnel.child === child) tunnel.child = null;
      tunnel.lastError = stderr.trim() || `ssh exited ${code}`;
      if (!tunnel.wanted) return;
      log(`server tunnel to ${tunnel.alias} closed (${tunnel.lastError}); reopening`);
      tunnel.backoff = Math.min(MAX_BACKOFF_MS, (tunnel.backoff || 1_000) * 2);
      tunnel.timer = setTimeout(() => { tunnel.timer = null; if (tunnel.wanted && !tunnel.child) launch(tunnel); }, tunnel.backoff);
      tunnel.timer.unref?.();
    });
    return child;
  }

  async function ensure({ alias, localPort, remotePort }) {
    let tunnel = tunnels.get(localPort);
    if (tunnel && (tunnel.alias !== alias || tunnel.remotePort !== remotePort)) { stop(localPort); tunnel = null; }
    if (!tunnel) {
      tunnel = { alias, localPort, remotePort, wanted: true, child: null, timer: null, backoff: 0, lastError: "" };
      tunnels.set(localPort, tunnel);
    }
    tunnel.wanted = true;
    if (tunnel.child && await answers(localPort)) return;
    if (!tunnel.child) {
      if (tunnel.timer) { clearTimeout(tunnel.timer); tunnel.timer = null; }
      launch(tunnel);
    }
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await answers(localPort)) { tunnel.backoff = 0; return; }
      if (!tunnel.child) break;
      await sleep(250);
    }
    throw new Error(`Could not open the SSH tunnel to ${alias}${tunnel.lastError ? `: ${tunnel.lastError}` : ""}. Check that "ssh ${alias}" works without a password on this computer.`);
  }

  function stop(localPort) {
    const tunnel = tunnels.get(localPort);
    if (!tunnel) return;
    tunnel.wanted = false;
    if (tunnel.timer) clearTimeout(tunnel.timer);
    tunnel.child?.kill?.();
    tunnels.delete(localPort);
  }

  return {
    ensure,
    stop,
    stopAll: () => { for (const port of tunnels.keys()) stop(port); },
    open: () => [...tunnels.values()].filter((t) => t.child).map((t) => t.localPort),
  };
}
