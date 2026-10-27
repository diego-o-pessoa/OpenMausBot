import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createServerTunnels, tunnelArgs } from "./server-tunnels.mjs";

function fakeSsh() {
  const children = [];
  const spawn = (command, args) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stderr.setEncoding = () => {};
    child.command = command;
    child.args = args;
    child.killed = false;
    child.kill = () => { child.killed = true; child.emit("exit", null); };
    children.push(child);
    return child;
  };
  return { children, spawn };
}

test("forwards a loopback port to the server's loopback port, refusing an alias that could be an option", () => {
  assert.deepEqual(tunnelArgs({ alias: "minha-vps", localPort: 38800, remotePort: 8799 }).slice(-3), ["-L", "127.0.0.1:38800:127.0.0.1:8799", "minha-vps"]);
  assert.ok(tunnelArgs({ alias: "minha-vps", localPort: 38800, remotePort: 8799 }).includes("BatchMode=yes"));
  assert.throws(() => tunnelArgs({ alias: "-oProxyCommand=x", localPort: 38800, remotePort: 8799 }));
  assert.ok(tunnelArgs({ alias: "minha-vps", localPort: 38800, remotePort: 8799 }, "linux").includes("ControlPath=none"));
  assert.ok(!tunnelArgs({ alias: "minha-vps", localPort: 38800, remotePort: 8799 }, "win32").includes("ControlPath=none"));
});

test("opens once, reuses an open tunnel, and reopens one that drops", async () => {
  const ssh = fakeSsh();
  let up = false;
  const tunnels = createServerTunnels({ spawn: ssh.spawn, answers: async () => up, sleep: async () => { up = true; } });
  await tunnels.ensure({ alias: "minha-vps", localPort: 38800, remotePort: 8799 });
  await tunnels.ensure({ alias: "minha-vps", localPort: 38800, remotePort: 8799 });
  assert.equal(ssh.children.length, 1);
  up = false;
  ssh.children[0].emit("exit", 255);
  await tunnels.ensure({ alias: "minha-vps", localPort: 38800, remotePort: 8799 });
  assert.equal(ssh.children.length, 2);
  tunnels.stopAll();
  assert.equal(ssh.children[1].killed, true);
});

test("says why when ssh exits before the port answers", async () => {
  const ssh = fakeSsh();
  const tunnels = createServerTunnels({
    spawn: (...args) => { const child = ssh.spawn(...args); setImmediate(() => { child.stderr.emit("data", "Permission denied (publickey)."); child.emit("exit", 255); }); return child; },
    answers: async () => false,
    sleep: () => new Promise((resolve) => setTimeout(resolve, 5)),
  });
  await assert.rejects(tunnels.ensure({ alias: "minha-vps", localPort: 38800, remotePort: 8799 }), /Permission denied/);
  tunnels.stopAll();
});
