# OpenMausBot — notas do fork

Documento vivo deste fork. Duas partes:

1. **O que é o projeto** — para entender rápido a arquitetura antes de mexer.
2. **Registro de mudanças** — tudo que alteramos neste fork, com data e motivo.

> Regra: toda mudança feita no fork ganha uma entrada no [registro](#2-registro-de-mudanças-do-fork)
> no mesmo commit.

---

## 1. O que é o projeto

### Em uma frase

OpenMausBot é a alternativa open source ao **Grok Bot** (xAI): um app de chat no estilo Telegram em que
cada contato da barra lateral é um **agente de IA de verdade** (Claude, Codex, Grok etc. rodando pelos
CLIs instalados na sua máquina), com personalidade, modelo, computador e apps conectados próprios.

- Licença: Apache 2.0, exceto a pasta `enterprise/` (source-available, exige chave em produção — ver
  [LICENSING.md](LICENSING.md)).
- Upstream: `https://github.com/milind-soni/OpenMausBot` (autor: Milind Soni).
- Nosso fork: `https://github.com/diego-o-pessoa/OpenMausBot` (remote `origin`).
- Base do fork: commit `ce3d690c0` de 2026-10-22 (versão `0.1.122` no `package.json`).

### Ideia central

- **Traga seus próprios agentes**: usa os logins/assinaturas que você já tem nos CLIs `claude`, `codex`,
  `grok` (e outros motores via ACP ou endpoints compatíveis com OpenAI/Anthropic). Sem proxy no meio.
- **Local first**: um servidor "harness" em `127.0.0.1:8799` é dono de todos os processos de agente.
  Dados ficam em `~/.openmausbot/` (bots, transcrições, logs NDJSON por thread, `config.json` com chaves).
- **Agentes com mãos**: cada bot pode usar um computador na nuvem (Boat), uma VM local ou — com opt-in
  explícito — o seu próprio computador (Cua Driver), além de 500+ apps via Composio.
- **Aprovações**: comandos de shell, edições de arquivo e perguntas viram cartões Allow/Deny no chat
  (permission broker).

### Arquitetura (dois processos)

```
App React (Vite, :5199)  --HTTP comandos-->  Harness server (127.0.0.1:8799)
        ^                                         |  registry de drivers -> event bus
        +-------------- um stream SSE ------------+  permission broker
                                                  |
                              CLIs locais: claude / codex / grok / ...
                              Boat API (computador na nuvem) · Composio (apps)
```

O app **não tem transporte próprio**: manda comandos HTTP e consome um único stream SSE. O servidor
normaliza o protocolo nativo de cada provedor em um stream canônico de `RuntimeEvent`.

### Mapa do repositório

| Caminho | O que tem |
|---|---|
| `server/contracts.ts` | SPI dos drivers (`ProviderDriver`) e tipos canônicos de eventos. **Ler primeiro.** |
| `server/drivers/` | Um arquivo por provedor (claude, codex, grok, groq, mistral, openrouter, pi, antigravity…), `acp/` para motores ACP. Registro em `builtIn.ts`. |
| `server/harness/` | Registry (config → instância viva; inválido → "shadow" indisponível) e event bus. |
| `server/index.ts` | API HTTP + SSE (~17 mil linhas; sendo quebrada em `server/host/` e `server/routes/`). |
| `server/routes/`, `server/host/` | Rotas e módulos extraídos do `index.ts` (cada um tem README com regras). |
| `server/tts/` | Voz: ElevenLabs, Fish Audio, Grok (xAI), vozes do Mac, Chatterbox local. |
| `server/testing/` | Fakes: driver em memória e CLIs falsos de `claude`/`codex` para testes. |
| `server/openmausbot.ts` | CLI `openmausbot` (headless, `serve`, `pair`, `team apply`, `run`). |
| `shared/` | Tipos de fio compartilhados entre servidor e app. |
| `src/` | App React 19 + Tailwind. Store único, um reducer. Traduções em `src/locales/` (tem `pt-br.json`). |
| `electron/` | Shell desktop (macOS, Windows, Ubuntu): servidor embutido, ditado, captura de tela, controle local. |
| `companion/` | Sidecar que o celular acessa (pareamento, tokens, exposição de rede) na frente do harness. |
| `cloudflare/` | Workers: `composio-broker` e `control-plane` (parte cloud). |
| `enterprise/` | Recursos pagos/organização (licença própria). Apagar a pasta = edição OSS. |
| `apps/docs/` | Site de documentação (Next.js). |
| `docs/` | Documentação técnica por recurso (`docs/verification/` = como verificar mudanças). |
| `evals/` | Avaliações de comportamento dos agentes. |
| `scripts/` | Build, empacotamento, servidor MCP (`mcp-server.ts`), `control-omb.ts`, benchmarks. |
| `deploy/`, `Dockerfile`, `compose.yaml` | Self-hosting (Docker, Fly, Podman, Caddy). |
| `third_party/` | Dependências vendorizadas/pinadas (cua-driver, cloudflared, browser, opencode…). |
| `dist-server/` | **Saída de build. Nunca editar.** |

### Recursos principais

Seletor de modelo por bot · computador por bot (nuvem/VM/local) · cartões de aprovação · apps conectados
(Composio) · canais com transcrição, instruções e roster próprios · roteamento "Auto" por modelo de decisão
(Jev/OpenRouter) · times instaláveis a partir de um `.md` (BotMRR) e compartilháveis · triggers (agendas,
webhooks em `127.0.0.1:8800`, eventos de apps) · voz e chamadas · servidor MCP para orquestrar por fora ·
CLI headless para scripts/CI · app de celular (companion, PWA, iOS/Android).

### Como rodar (Windows, a partir do código)

Requisitos: Node 24+, pnpm 10, e pelo menos um CLI de agente logado (`claude`, `codex` ou `grok`).

```sh
pnpm install
pnpm dev:server    # harness → 127.0.0.1:8799
pnpm dev           # app → http://127.0.0.1:5199
pnpm dev:desktop   # Electron (deixe os dois acima rodando)
```

Checagens: `pnpm typecheck`, `pnpm lint`, `pnpm test` (suíte longa, roda arquivos em série),
`pnpm i18n:check`, `pnpm check:electron`. Empacotar Windows: `pnpm package:win` (ver skill `windows-release`).

`maus.ps1` na raiz é um atalho para `docker compose` com o `compose.yaml` do projeto.

### Depois de toda mudança: compilar e reinstalar

Combinado: depois de **qualquer** mudança, compilar, fechar o app se estiver aberto, instalar a versão nova
e abrir o app de novo. O script `reinstalar.ps1` faz tudo:

```powershell
.\reinstalar.ps1            # build (pnpm package:win) + fecha + instala em silêncio + abre
.\reinstalar.ps1 -SemBuild  # só fecha, instala o último build de release\ e abre
```

- Instalador gerado: `release\OpenMausBot-<versão>-setup.exe` (por usuário, sem pedir admin).
- App instalado: `%LOCALAPPDATA%\Programs\OpenMausBot\OpenMausBot.exe`.
- Logs do servidor: `%APPDATA%\OpenMausBot\logs\server.log`.

### Regras do projeto que valem para nós

Resumo de [AGENTS.md](AGENTS.md) e [CONTRIBUTING.md](CONTRIBUTING.md):

- **Verificar mudanças em fixture isolada**, nunca no app/dados reais:
  `node --experimental-strip-types scripts/control-omb.ts launch` e depois
  `pnpm control:omb doctor --url http://127.0.0.1:PORTA` (ver [docs/verification/README.md](docs/verification/README.md)).
- **Comentários só quando o código não consegue dizer** (licença, comportamento externo, contrato público,
  invariante de segurança). Nada de narrar código ou registrar histórico em comentário.
- `server/` deve continuar Node portátil; coisas só de macOS ficam em `electron/` atrás de checagem de plataforma.
- **Nunca montar strings de comando para shell** (`shell: true`, `cmd.exe` com aspas). Argumentos vão por argv;
  no Windows, resolver shims `.cmd` para o JS e rodar com `process.execPath`.
- Chaves de API são só-escrita: a API só devolve flags `configured`. Nunca logar ou ecoar chaves.
- Testes sem `sleep`: esperar pelo evento (`recordEvents(...).until(...)`). Nunca tocar o `~/.openmausbot` real.
- Novo provedor = um arquivo em `server/drivers/` + uma linha em `builtIn.ts` + teste de contrato com CLI falso.
- `scripts/testing/file-size-ratchet.test.ts` impede arquivos novos com mais de 1.000 linhas e impede que os
  existentes cresçam.

### Cuidados por ser um fork

- Não publicar binários ou metadados de atualização no repositório de releases oficial; revisar nome do app,
  identificadores, assinatura e destinos de publish do `electron-builder.yml` antes de distribuir.
- Se algo for virar PR para o upstream, manter o PR só com a mudança portátil (sem caminhos locais, contas
  ou branding do fork) e anotar o commit base do upstream.
- Para puxar novidades do upstream:
  ```sh
  git remote add upstream https://github.com/milind-soni/OpenMausBot.git   # uma vez
  git fetch upstream && git merge upstream/main
  ```
  Ao sincronizar, registre aqui o novo commit base.

---

## 2. Registro de mudanças do fork

Mais recente primeiro. Modelo de entrada:

```md
### AAAA-MM-DD — título curto
- **O quê:** o que mudou.
- **Por quê:** motivo.
- **Onde:** arquivos/pastas principais.
- **Como verificar:** comando ou passo usado.
```

### 2026-10-22 — Mascote igual ao do Grok Bot
- **O quê:** o mascote foi refeito para se comportar como o do Grok Bot (análise dos vídeos em `videos/`).
  - Visual: cor sólida (sem gradiente), só dois olhos brancos em pílula, sem boca. Os olhos ficam numa
    esfera e achatam/somem conforme o rosto vira.
  - Comportamentos: **parado** (imóvel, olhando para cima-direita), **trabalhando** (olhar passeia,
    pisca, respira), **concluído** (olhos "^^" e pulinhos ao terminar), **mouse em cima** (olha de frente,
    olhos em bolinha) e **clique** (encolhe e volta). As 40+ reações antigas viram parado/trabalhando.
  - Formatos: padrão agora é **círculo**; entraram **almofada** (`pillow`) e **feijão** (`bean`).
    O seletor de expressão saiu do perfil do bot.
  - Cores (tons do Grok): verde-água `#53B9A6`, laranja `#F19D38`, azul `#3D82F6`, roxo `#885DF3`,
    coral `#ED722E`; verde `#34B36A`, vermelho `#EF4F4F`, rosa `#EC5C9F`, amarelo `#F2BE2E`, ciano `#23B3D8`.
  - "Pensando": três bolinhas em onda na cor do bot, que viram o mascote quando ele usa ferramentas.
  - Lista lateral: sem ponto verde de "trabalhando"; "não lido" é a bolinha vermelha `#FD3C2F` no topo
    do avatar; avatar do modo simples 36→38 px; cabeçalho do chat 24→18 px; grupos viram o trio de bolinhas.
- **Por quê:** pedido para o mascote ficar exatamente igual ao do Grok Bot.
- **Onde:** `src/components/sphere-mascot.ts` (matemática, poses, olhares), `src/components/SphereMascot.tsx`
  (desenho/animação), `src/components/Avatar.tsx`, `src/components/ThinkingDots.tsx`, `src/components/Sidebar.tsx`,
  `src/components/StackedMauses.tsx`, `src/lib/mascot.ts` (cores, `stateForBot`), `scripts/mascot-bodies/builders.ts`
  + `scripts/gen-mascot-bodies.ts` → `shared/mascot-bodies.ts` (gerado com `pnpm gen:bodies`), `src/styles.css`,
  `src/mascot-preview.tsx`. O motor antigo (`CursorAvatar.tsx`) continua no repositório, só para tipos e Halloween.
- **Como verificar:** `pnpm dev` e abrir `http://127.0.0.1:5199/mascot-preview.html` (galeria),
  `?poses` (poses paradas) ou `?solo=working` / `?solo=done`. Testes: `npx vitest run src/components/sphere-mascot.test.ts`.

### 2026-10-22 — Script de compilar e reinstalar
- **O quê:** `reinstalar.ps1` compila o instalador do Windows, fecha o app aberto, instala em silêncio e abre.
- **Por quê:** testar cada mudança no app instalado, sempre do mesmo jeito.
- **Onde:** `reinstalar.ps1`, seção "Depois de toda mudança" acima.
- **Como verificar:** rodar `.\reinstalar.ps1` e ver o app abrir com o chat carregado.

### 2026-10-22 — Criação deste documento
- **O quê:** adicionado `PROJETO.md` com a visão geral do projeto e este registro.
- **Por quê:** ter num só lugar o que é o projeto e o que já mudamos no fork.
- **Onde:** `PROJETO.md`.
- **Como verificar:** n/a (só documentação). Base do fork: upstream `ce3d690c0`.
