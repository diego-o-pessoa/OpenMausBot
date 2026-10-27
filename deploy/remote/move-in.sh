#!/usr/bin/env bash
# Moves the desktop's installation into the server install-server.sh set up on this machine.
# The desktop sends this script over SSH with `move_in '<base64 JSON>'` appended, while it holds a reverse
# tunnel from 127.0.0.1:$SOURCE_PORT here to its own server. The JSON carries a one-time pairing code for that
# server, the connection settings to keep (API keys), and the engines' sign-in files.
set -euo pipefail

SERVICE_USER="${OMB_SERVICE_USER:-openmausbot}"
PORT="${OMB_SERVER_PORT:-8799}"
SOURCE_PORT="${OMB_SOURCE_PORT:-38799}"
TOTAL=8

# Progress goes to the saved stdout, so a failure inside $(...) still reaches the desktop.
exec 3>&1
say() { printf '::omb %s\n' "$*" >&3; }
step() { say "step $1/$TOTAL $2"; }
result() { say "result $1 $2"; }
fail() { say "error $*"; exit 1; }

cd /
if [ "$(id -u)" -eq 0 ]; then SUDO=(); elif sudo -n true 2>/dev/null; then SUDO=(sudo -n); else fail "connect as root or with passwordless sudo"; fi
as_root() { "${SUDO[@]}" "$@"; }
SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6 || true)"
[ -n "$SERVICE_HOME" ] || fail "OpenMausBot is not installed on this machine yet"
DATA="$SERVICE_HOME/.openmausbot"
as_service() {
  if [ "$(id -u)" -eq 0 ]; then runuser -u "$SERVICE_USER" -- env HOME="$SERVICE_HOME" USER="$SERVICE_USER" "$@"
  else sudo -n -u "$SERVICE_USER" env HOME="$SERVICE_HOME" USER="$SERVICE_USER" "$@"; fi
}
NODE="$(as_service bash -lc 'command -v node' 2>/dev/null || true)"
[ -n "$NODE" ] || fail "Node is missing for $SERVICE_USER; install the server again"
json() { as_service "$NODE" -e "$1" "${@:2}"; }

healthy() { curl -fsS --max-time 3 "http://127.0.0.1:$1/api/health" 2>/dev/null | grep -q openmausbot; }
# Prints the response body; fails with the server's own error when the status is not 2xx.
api() {
  local method="$1" path="$2" body="${3:-}" out status
  # The body goes on stdin: a pairing code in curl's arguments would show in ps.
  out="$(printf '%s' "$body" | curl -sS --max-time "${4:-120}" -X "$method" "http://127.0.0.1:$PORT$path" -H 'content-type: application/json' \
    ${body:+--data-binary @-} -w $'\n%{http_code}')" || fail "the server did not answer $path"
  status="${out##*$'\n'}"
  out="${out%$'\n'*}"
  if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
    fail "$path answered $status: $(printf '%s' "$out" | json 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{try{console.log(JSON.parse(t).error??t)}catch{console.log(t)}})' | head -c 300)"
  fi
  printf '%s' "$out"
}
field() { json 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(t));process.stdout.write(v==null?"":String(v))})' "$1"; }

server_stop() {
  if [ -d /run/systemd/system ] && systemctl cat openmausbot.service >/dev/null 2>&1; then as_root systemctl stop openmausbot.service; return; fi
  local pid; pid="$(cat "$DATA/supervisor.pid" 2>/dev/null || true)"
  [ -n "$pid" ] && as_root kill "$pid" 2>/dev/null || true
  as_root pkill -u "$SERVICE_USER" -f "openmausbot serve" 2>/dev/null || true
  for _ in $(seq 1 30); do healthy "$PORT" || return 0; sleep 1; done
}
server_start() {
  if [ -d /run/systemd/system ] && systemctl cat openmausbot.service >/dev/null 2>&1; then as_root systemctl start openmausbot.service
  # 3>&- too: a server that kept the progress descriptor would hold this SSH session, and the desktop's tunnel, open.
  else as_service setsid nohup "$DATA/supervise.sh" >/dev/null 2>&1 < /dev/null 3>&- & fi
  for _ in $(seq 1 120); do healthy "$PORT" && return 0; sleep 1; done
  fail "the server did not come back after the move; see journalctl -u openmausbot (or $DATA/server.log)"
}

move_in() {
  local payload="$1" code staged
  healthy "$PORT" || fail "the server is not running on this machine; install it first"

  step 1 reach
  for _ in $(seq 1 30); do healthy "$SOURCE_PORT" && break; sleep 1; done
  healthy "$SOURCE_PORT" || fail "the desktop could not be reached through the SSH tunnel"
  code="$(printf '%s' "$payload" | base64 -d | field code)"

  step 2 connect
  api POST /api/workspace-backup/source "{\"address\":\"http://127.0.0.1:$SOURCE_PORT\",\"code\":\"$code\"}" >/dev/null

  step 3 copy
  staged="$(api POST /api/workspace-backup/pull '{}' 3600 | field id)"
  [ -n "$staged" ] || fail "the copy from the desktop did not arrive"

  step 4 restore
  api POST /api/workspace-backup/restore "{\"id\":\"$staged\",\"confirmation\":\"REPLACE\"}" >/dev/null

  step 5 restart
  server_stop
  server_start

  step 6 credentials
  server_stop
  printf '%s' "$payload" | base64 -d | json '
    const fs = require("fs"), path = require("path");
    let t = ""; process.stdin.on("data", (d) => t += d).on("end", () => {
      const move = JSON.parse(t), home = process.env.HOME, data = path.join(home, ".openmausbot");
      const file = path.join(data, "config.json");
      let config = {}; try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
      Object.assign(config, move.config || {});
      // The restore brought the setting of the desktop; on this server each bot works in its own container.
      config.localVm = { ...(config.localVm || {}), mode: "per-bot" };
      if (move.instances) config.instances = { ...(config.instances || {}), ...move.instances };
      // The desktop does not know this folder; it marks where it goes.
      const text = JSON.stringify(config, null, 2).split("__OMB_HOME__").join(home);
      fs.writeFileSync(file, text + "\n", { mode: 0o600 });
      let written = 0;
      for (const entry of move.files || []) {
        const target = path.resolve(home, entry.path);
        if (!target.startsWith(home + path.sep)) continue;
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.writeFileSync(target, Buffer.from(entry.base64, "base64"), { mode: 0o600 });
        written++;
      }
      console.log(written);
    });' > /dev/null
  result keys "$(printf '%s' "$payload" | base64 -d | json 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>console.log(Object.keys(JSON.parse(t).config||{}).length))')"
  result sign_ins "$(printf '%s' "$payload" | base64 -d | json 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>console.log((JSON.parse(t).files||[]).length))')"
  server_start

  step 7 disconnect
  api DELETE /api/workspace-backup/source >/dev/null || true

  step 8 pair
  code="$(api POST /api/auth/pairing '{"scopes":["admin","client"],"label":"Desktop"}' | field code)"
  [ -n "$code" ] || fail "the server did not return a pairing code"
  result pairing_code "$code"
  result port "$PORT"
  say "done"
}
