#!/usr/bin/env bash
# Instala (ou atualiza) o OpenMausBot deste fork numa máquina Linux, sem Docker: compila o código e instala o
# comando `openmausbot`, que roda o servidor e abre o app no navegador desta máquina.
#
#   curl -fsSL https://raw.githubusercontent.com/diego-o-pessoa/OpenMausBot/main/instalar-linux.sh | bash
#
# Variáveis opcionais: OMB_DIR (padrão ~/OpenMausBot), OMB_REPO, OMB_BRANCH, ENGINES (CLIs de IA a instalar).
set -euo pipefail

REPO="${OMB_REPO:-https://github.com/diego-o-pessoa/OpenMausBot.git}"
BRANCH="${OMB_BRANCH:-main}"
DIR="${OMB_DIR:-$HOME/OpenMausBot}"
ENGINES="${ENGINES-@anthropic-ai/claude-code @openai/codex}"
NODE_MAJOR=24

info() { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mErro:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || die "este instalador é para Linux."

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"
  elif command -v sudo >/dev/null 2>&1; then sudo "$@"
  else return 1
  fi
}

info "Verificando git e curl"
missing=()
command -v git >/dev/null 2>&1 || missing+=(git)
command -v curl >/dev/null 2>&1 || missing+=(curl)
if [ ${#missing[@]} -gt 0 ]; then
  if command -v apt-get >/dev/null 2>&1; then
    as_root apt-get update -y && as_root apt-get install -y "${missing[@]}" ca-certificates \
      || die "não consegui instalar ${missing[*]}; instale-os e rode de novo."
  else
    die "instale ${missing[*]} e rode de novo."
  fi
fi

info "Instalando o Node $NODE_MAJOR (só para este usuário)"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | PROFILE=/dev/null bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install "$NODE_MAJOR" >/dev/null
nvm alias default "$NODE_MAJOR" >/dev/null
nvm use "$NODE_MAJOR" >/dev/null
corepack enable >/dev/null 2>&1 || npm install -g pnpm@10 >/dev/null
for rc in "$HOME/.bashrc" "$HOME/.profile"; do
  grep -q 'NVM_DIR/nvm.sh' "$rc" 2>/dev/null || printf '\nexport NVM_DIR="%s"\n[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"\n' "$NVM_DIR" >> "$rc"
done

info "Baixando o código em $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --quiet origin "$BRANCH"
  git -C "$DIR" checkout --quiet "$BRANCH"
  git -C "$DIR" pull --ff-only --quiet origin "$BRANCH" || die "a pasta $DIR tem mudanças locais; resolva-as e rode de novo."
else
  git clone --quiet --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

info "Instalando as dependências (alguns minutos)"
# The desktop shell is not built here, so its Electron binary is not needed.
ELECTRON_SKIP_BINARY_DOWNLOAD=1 OMB_SKIP_HOOKS=1 pnpm install --frozen-lockfile

info "Compilando o servidor e a interface (alguns minutos)"
pnpm build:server
pnpm exec vite build
node scripts/build-npm-package.mjs

info "Instalando o comando openmausbot"
(cd release/npm && rm -f openmausbot-*.tgz && npm pack --silent >/dev/null)
npm install -g "$DIR"/release/npm/openmausbot-*.tgz >/dev/null

if [ -n "$ENGINES" ]; then
  info "Instalando as IAs: $ENGINES"
  # shellcheck disable=SC2086
  npm install -g $ENGINES >/dev/null || warn "não consegui instalar $ENGINES; instale depois com: npm install -g $ENGINES"
fi

cat <<EOF

Pronto. Para usar, abra um terminal NOVO nesta máquina e rode:

  openmausbot

Na primeira vez ele pergunta qual IA usar e faz o login; depois abre o app no navegador
desta máquina. Deixe o terminal aberto enquanto usar.

Opcional, para os bots terem navegador próprio:
  openmausbot browser install

Para atualizar no futuro, rode este instalador de novo.
EOF
