# OpenMausBot on your VPS

**Settings → Remote access → OpenMausBot on your VPS** installs OpenMausBot on your own Linux server over
SSH. Bots, chats and routines then run there around the clock, with your computer off. The desktop app
becomes the server's control panel, reached through an SSH tunnel.

There is one server, on the VPS, and nothing to keep in sync. The desktop is only a window onto it. A chat,
a routine, an API key, an MCP server or an engine sign-in you set up from the desktop is saved on the VPS
the moment you make it.

## How it is built

```text
Desktop app ── ssh -L 127.0.0.1:38800 → VPS 127.0.0.1:8799 ──▶ OpenMausBot server (systemd, user openmausbot)
                                                                   │  Chief of Staff, routines, keys, sign-ins
                                                                   ▼
                                                     one Docker desktop per bot (Local VM, per-bot mode)
```

- **The server** runs on the VPS's own Linux as the unprivileged user `openmausbot`, under systemd with
  `Restart=always`, so it starts on boot and comes back if it stops. Where systemd is absent, a respawning
  supervisor started at boot by cron does the same.
- **One container per bot.** The server is set to the Local VM's per-bot mode, and `openmausbot` is in the
  `docker` group. Each bot gets its own hardened desktop container with a durable workspace. The container
  starts when a task needs it and stops after it has been idle. The server, always up, starts it again.
- **The desktop** opens `ssh -N -L` to the VPS whenever you open that server, and reopens it if it drops.
  The server listens only on the VPS's loopback, so nothing is exposed to the internet. Over the tunnel the
  desktop is a paired device with full access.

The server is installed on the VPS's Linux, never inside a container. It creates each bot's container and
mounts that bot's workspace from its own disk. From inside a container those paths would be wrong, and the
server would need the host's Docker socket, which amounts to root on the VPS. The check still lists the
Docker containers already on the VPS.

## Steps

1. Add the VPS to `~/.ssh/config` on the desktop computer, with a key that signs in without a password
   prompt, as `root` or as a user with passwordless `sudo`:

   ```
   Host minha-vps
     HostName 200.141.23.73
     User root
     IdentityFile ~/.ssh/id_ed25519
   ```

2. Open the card, enter the alias and choose **Check VPS**. It shows the system, Docker, the containers,
   and whether OpenMausBot is not installed, installed with an update available, or up to date. The
   repository and branch default to this fork's `main`.
3. **Install on the VPS** (or **Update the VPS**). A progress bar follows the eight steps run by
   `deploy/remote/install-server.sh`:
   - packages and Docker;
   - the service user;
   - the code;
   - the build;
   - one container per bot;
   - start on boot;
   - the health check;
   - a pairing code.

   When the installed commit already matches the repository and the service is healthy, the install stops
   at once and says so, without reinstalling.
4. With **Bring everything from this computer** ticked, `deploy/remote/move-in.sh` then moves this computer
   in:
   - a full backup over a reverse tunnel held only for the move, restored on the VPS;
   - the API keys and other connection settings;
   - MCP servers, with ones that run a script from this repository pointed at the VPS's copy;
   - the Claude Code, Codex and Gemini CLI sign-in files.

   Engine settings drop paths that exist only on Windows. The move cuts the VPS's access to this computer
   when it ends.
5. The desktop saves the VPS under **Server**, opens its tunnel, pairs with a fresh code and switches to it.
   Switch back to **This computer** from the Server menu at any time.

## Updating

Choose **Check VPS**, then **Update the VPS**. It fetches the branch, rebuilds and restarts the service,
keeping its data. Leave **Bring everything from this computer** unticked unless you want the VPS replaced
by this computer's copy again.

## Security

- SSH is the only way in, in both directions, and it is encrypted. The desktop never sends a password; the
  key in your SSH config is used.
- The reverse tunnel gives the VPS's loopback a way to reach this computer's server. It exists only while a
  move runs.
- Values sent to the VPS (the pairing code, keys, sign-in files) travel on SSH's standard input, never in a
  command line.
- Everything runs as `openmausbot`, not root. Membership in `docker` is what lets it create the bots'
  containers. It also lets that user control Docker on the VPS, so keep the VPS for this.

## Verification

```sh
pnpm exec vitest run server/remote-server.test.ts src/components/RemoteServerSettings.test.ts
node --test electron/server-tunnels.node-test.mjs electron/environments.node-test.mjs
```

The work was also checked end to end on a Linux machine reached through a real SSH server:

- check, install, the up-to-date shortcut, and the server restarting after its process was killed;
- a move from a second server holding a bot, its instructions, an API key, a Windows-path TomTicket MCP
  server and a Codex sign-in;
- the reverse tunnel closing when the move ended;
- pairing through the real desktop tunnel module;
- a container created for each bot, with its desktop ready;
- a scheduled routine completing on the VPS with the source server stopped;
- the install under systemd (a systemd container).

The Electron window itself was not driven.
