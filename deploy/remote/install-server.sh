#!/usr/bin/env bash
# Installs, updates or checks an OpenMausBot server on this Linux machine, from a Git repository.
# The desktop app sends this script over SSH (`bash -s`) and reads the `::omb` lines as its progress.
#
#   OMB_ACTION=check|install  OMB_REPO=<git url>  OMB_BRANCH=main  bash install-server.sh
#
# The server runs as its own unprivileged user, in that user's docker group so each bot can get its own
# container, and starts on boot under systemd (or a respawning supervisor where systemd is absent).
set -euo pipefail

ACTION="${OMB_ACTION:-check}"
REPO="${OMB_REPO:-https://github.com/diego-o-pessoa/OpenMausBot.git}"
BRANCH="${OMB_BRANCH:-main}"
SERVICE_USER="${OMB_SERVICE_USER:-openmausbot}"
PORT="${OMB_SERVER_PORT:-8799}"
ENGINES="${OMB_ENGINES-@anthropic-ai/claude-code @openai/codex @google/gemini-cli}"
PAIR_LABEL="${OMB_PAIR_LABEL:-Desktop}"
TOTAL=8

say() { printf '::omb %s\n' "$*"; }
step() { say "step $1/$TOTAL $2"; }
result() { say "result $1 $2"; }
fail() { say "error $*"; exit 1; }

case "$REPO" in https://*|git@*|ssh://*) ;; *) fail "the repository must be an https://, ssh:// or git@ address" ;; esac
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "invalid branch name"
[[ "$SERVICE_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || fail "invalid service user name"
[[ "$PORT" =~ ^[0-9]+$ ]] || fail "invalid port"

[ "$(uname -s)" = "Linux" ] || fail "this machine is not Linux"
if [ "$(id -u)" -eq 0 ]; then SUDO=(); elif sudo -n true 2>/dev/null; then SUDO=(sudo -n); else
  fail "connect as root, or as a user with passwordless sudo, to install the server"
fi
as_root() { "${SUDO[@]}" "$@"; }
as_service() {
  if [ "$(id -u)" -eq 0 ]; then runuser -u "$SERVICE_USER" -- env HOME="$SERVICE_HOME" USER="$SERVICE_USER" "$@"
  else sudo -n -u "$SERVICE_USER" env HOME="$SERVICE_HOME" USER="$SERVICE_USER" "$@"; fi
}
# The service user may not be able to read the login directory, and git refuses to run from one it cannot read.
cd /

have_systemd() { [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; }
SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6 || true)"
[ -n "$SERVICE_HOME" ] || SERVICE_HOME="/home/$SERVICE_USER"
SRC="$SERVICE_HOME/OpenMausBot"
DATA="$SERVICE_HOME/.openmausbot"

installed_commit() { [ -d "$SRC/.git" ] && as_service git -C "$SRC" rev-parse HEAD 2>/dev/null || true; }
remote_commit() { command -v git >/dev/null 2>&1 && git ls-remote "$REPO" "refs/heads/$BRANCH" 2>/dev/null | cut -f1 || true; }
healthy() { curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q openmausbot; }
service_state() {
  if have_systemd && systemctl cat openmausbot.service >/dev/null 2>&1; then
    systemctl is-active openmausbot.service 2>/dev/null || true
  elif [ -f "$DATA/supervisor.pid" ] && kill -0 "$(cat "$DATA/supervisor.pid" 2>/dev/null)" 2>/dev/null; then
    echo active
  else
    echo none
  fi
}

report_machine() {
  . /etc/os-release 2>/dev/null || true
  result os "${PRETTY_NAME:-Linux}"
  result arch "$(uname -m)"
  result user "$(id -un)"
  result systemd "$(have_systemd && echo yes || echo no)"
  result memory_mb "$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
  if command -v docker >/dev/null 2>&1 && as_root docker info >/dev/null 2>&1; then
    result docker yes
    as_root docker ps -a --format '{{.Names}}|{{.Image}}|{{.State}}' 2>/dev/null | while IFS= read -r line; do say "container $line"; done
  else
    result docker "$(command -v docker >/dev/null 2>&1 && echo stopped || echo no)"
  fi
  local current latest state
  current="$(installed_commit)"
  latest="$(remote_commit)"
  state="$(service_state)"
  result installed_commit "${current:-none}"
  result latest_commit "${latest:-unknown}"
  result service "$state"
  result healthy "$(healthy && echo yes || echo no)"
  if [ -n "$current" ] && [ "$current" = "$latest" ] && [ "$state" = active ] && healthy; then result up_to_date yes; else result up_to_date no; fi
}

pairing_code() {
  local pairing code
  pairing="$(curl -fsS --max-time 10 -X POST "http://127.0.0.1:$PORT/api/auth/pairing" -H 'content-type: application/json' \
    -d "{\"scopes\":[\"admin\",\"client\"],\"label\":\"${PAIR_LABEL//\"/}\"}")" || fail "the server did not create a pairing code"
  code="$(printf '%s' "$pairing" | sed -n 's/.*"code":"\([A-Za-z0-9-]*\)".*/\1/p')"
  [ -n "$code" ] || fail "the server did not return a pairing code"
  result pairing_code "$code"
  result port "$PORT"
}

if [ "$ACTION" = check ]; then
  report_machine
  exit 0
fi
if [ "$ACTION" = pair ]; then
  healthy || fail "the server is not running on this machine; install it first"
  pairing_code
  say "done"
  exit 0
fi
[ "$ACTION" = install ] || fail "unknown action $ACTION"

step 1 prepare
if command -v apt-get >/dev/null 2>&1; then
  missing=()
  for tool in git curl; do command -v "$tool" >/dev/null 2>&1 || missing+=("$tool"); done
  command -v docker >/dev/null 2>&1 || missing+=(docker.io)
  if [ ${#missing[@]} -gt 0 ]; then
    as_root env DEBIAN_FRONTEND=noninteractive apt-get update -y -q >/dev/null
    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${missing[@]}" ca-certificates >/dev/null || fail "could not install ${missing[*]}"
  fi
else
  for tool in git curl docker; do command -v "$tool" >/dev/null 2>&1 || fail "install $tool on this machine first (no apt-get here)"; done
fi
if have_systemd; then as_root systemctl enable --now docker >/dev/null 2>&1 || true; fi
as_root docker info >/dev/null 2>&1 || fail "Docker is installed but not running; start it (systemctl start docker) and try again"

LATEST="$(remote_commit)"
[ -n "$LATEST" ] || fail "could not read $REPO (branch $BRANCH) from this machine"
CURRENT="$(installed_commit)"
if [ -n "$CURRENT" ] && [ "$CURRENT" = "$LATEST" ] && [ "$(service_state)" = active ] && healthy; then
  result up_to_date yes
  result installed_commit "$CURRENT"
  step "$TOTAL" "done"
  exit 0
fi

step 2 user
if ! getent passwd "$SERVICE_USER" >/dev/null; then
  as_root useradd --create-home --shell /bin/bash "$SERVICE_USER"
  SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
  SRC="$SERVICE_HOME/OpenMausBot"
  DATA="$SERVICE_HOME/.openmausbot"
fi
getent group docker >/dev/null || as_root groupadd docker
as_root usermod -aG docker "$SERVICE_USER"

step 3 code
if [ -d "$SRC/.git" ]; then
  as_service git -C "$SRC" remote set-url origin "$REPO"
  as_service git -C "$SRC" fetch --quiet origin "$BRANCH"
  as_service git -C "$SRC" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
else
  as_service git clone --quiet --branch "$BRANCH" "$REPO" "$SRC"
fi
result installed_commit "$(installed_commit)"

step 4 build
# The same installer a person runs by hand; its "==>" lines become the build's sub-steps.
BUILD_LOG="$SERVICE_HOME/openmausbot-install.log"
# No terminal here: corepack must not stop to ask before it downloads pnpm.
if ! as_service env OMB_REPO="$REPO" OMB_BRANCH="$BRANCH" OMB_DIR="$SRC" ENGINES="$ENGINES" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1 \
    bash "$SRC/instalar-linux.sh" 2>&1 | as_service tee "$BUILD_LOG" \
  | while IFS= read -r line; do
      line="$(printf '%s' "$line" | sed 's/\x1b\[[0-9;]*m//g')"
      case "$line" in *"==>"*) say "detail ${line#*==> }" ;; esac
    done; then
  tail -n 15 "$BUILD_LOG" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | while IFS= read -r line; do say "detail $line"; done
  fail "the build failed; the full log is $BUILD_LOG on this machine"
fi
BIN="$(as_service bash -lc 'command -v openmausbot' 2>/dev/null || true)"
[ -n "$BIN" ] || fail "the openmausbot command was not installed"
NODE_DIR="$(dirname "$BIN")"

step 5 configure
as_service mkdir -p "$DATA"
as_service env PATH="$NODE_DIR:/usr/bin:/bin" node -e '
  const fs = require("fs"); const file = process.argv[1];
  let config = {}; try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  config.localVm = { ...(config.localVm || {}), mode: "per-bot" };
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
' "$DATA/config.json"

step 6 service
if have_systemd; then
  as_root tee /etc/systemd/system/openmausbot.service >/dev/null <<EOF
[Unit]
Description=OpenMausBot server
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=$SERVICE_USER
WorkingDirectory=$SERVICE_HOME
Environment=HOME=$SERVICE_HOME
Environment=PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin
Environment=OMB_PORT=$PORT
ExecStart=$BIN serve --no-pair
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  as_root systemctl daemon-reload
  as_root systemctl enable openmausbot.service >/dev/null 2>&1
  as_root systemctl restart openmausbot.service
  result service_manager systemd
else
  as_service tee "$DATA/supervise.sh" >/dev/null <<EOF
#!/bin/sh
echo \$\$ > "$DATA/supervisor.pid"
while :; do
  PATH="$NODE_DIR:/usr/local/bin:/usr/bin:/bin" OMB_PORT=$PORT "$BIN" serve --no-pair >> "$DATA/server.log" 2>&1
  sleep 5
done
EOF
  as_service chmod 0700 "$DATA/supervise.sh"
  if [ -f "$DATA/supervisor.pid" ]; then
    old="$(cat "$DATA/supervisor.pid" 2>/dev/null || true)"
    [ -n "$old" ] && as_root pkill -P "$old" 2>/dev/null || true
    [ -n "$old" ] && as_root kill "$old" 2>/dev/null || true
    sleep 1
  fi
  as_root pkill -u "$SERVICE_USER" -f "openmausbot serve" 2>/dev/null || true
  as_service setsid nohup "$DATA/supervise.sh" >/dev/null 2>&1 < /dev/null &
  if command -v crontab >/dev/null 2>&1; then
    { as_service crontab -l 2>/dev/null | grep -v supervise.sh || true; echo "@reboot $DATA/supervise.sh"; } | as_service crontab - || true
  fi
  result service_manager supervisor
fi

step 7 health
for _ in $(seq 1 90); do healthy && break; sleep 1; done
healthy || fail "the server did not answer on port $PORT; see journalctl -u openmausbot (or $DATA/server.log)"

step 8 pair
pairing_code
result up_to_date no
say "done"
