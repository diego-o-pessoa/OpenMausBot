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

Combinado: depois de **qualquer** mudança, fazer commit e push e esperar o OK para reinstalar. Reinstalar é
compilar, fechar o app se estiver aberto, instalar a versão nova e abrir o app de novo. O script
`reinstalar.ps1` faz tudo (e antes de instalar copia `~/.openmausbot` para `~/OpenMausBot-backups`):

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

### 2026-10-26 — Mascote age conforme o que o agente está fazendo, igual ao Grok Bot
- **O quê:** novas medições quadro a quadro dos vídeos em `videos/` (três do Grok, um do nosso), com o corpo,
  a posição e o tamanho de cada olho e o deslocamento do corpo a cada 100 ms. Com elas:
  - **inteligente:** o mascote encena a fase real do turno. **Pensando** começa com os três pontinhos do Grok
    (o corpo encolhe no ponto do meio e o ponto aceso anda esquerda→meio→direita) e depois alterna varreduras
    olhando para baixo da esquerda para a direita, ovais pensativos e olhinhos de lado. **Lendo/buscando** usa as
    varreduras para baixo. **Comando** usa olhos grandes de frente, olhadas para cima e olhos que atravessam o
    corpo. **Escrevendo** usa olhos grandes de frente. **Tela/navegador** usa olhadas para cima e para os lados.
    Os gestos se alternam sem repetir os últimos três e trocam assim que a fase muda.
  - **fim do turno:** olhos grandes ("digitando"), sorriso "^^" com pulinho e dois saltos olhando para cima,
    olhos de frente por 5 s, volta ao repouso. Ferramenta que dá certo no meio do turno não sorri mais.
  - **hover:** reage com o mouse em qualquer ponto da linha do agente na barra lateral. Os olhos são as
    pílulas verticais do Grok (antes eram bolinhas) e seguem o cursor em cada eixo.
  - O corpo pode sair da caixa do avatar nos saltos (`overflow: visible`).
- **Onde:** `scripts/mascot-clips/measure.py` (mede os vídeos e gera `src/components/mascot-clips.ts`; os vídeos
  não vão para o git), `src/components/mascot-director.ts` (escolhe e encadeia os gestos),
  `src/components/sphere-mascot.ts` (rosto, pontinhos, olhar), `src/components/SphereMascot.tsx`,
  `src/lib/mascot.ts` (`stateForBot` devolve a fase pelo tipo de ferramenta, via `toolActivityKey` de
  `src/lib/live-activity.ts`), `src/components/Avatar.tsx`, `src/state/store.tsx`, `data-mascot-hover` na linha
  em `src/components/Sidebar.tsx`, `src/mascot-preview.tsx`.
- **Como verificar:** `npx vitest run src/components/sphere-mascot.test.ts src/components/mascot-director.test.ts
  src/components/CursorAvatar.clock.test.ts src/lib/mascot.test.ts`. Visual: `npx vite --port 5287` e abrir
  `/mascot-preview.html` (palco com botões por fase + linhas para hover), `?solo=done`, `?solo=reading`, `?faces`.
  Comparado lado a lado com o vídeo do Grok: mesma sequência e tempos (~0,1 s de diferença).
- **Pendente:** 23 arquivos de teste já falhavam antes desta mudança (os mesmos, conferido com stash).

### 2026-10-26 — Backup do reinstalar.ps1 não segue junctions
- **O quê:** o robocopy do backup passou a usar `/XJ`.
- **Por quê:** as pastas `task-workspaces\...\{.agents,.claude,.grok}\skills\*` são junctions para skills; as que
  apontavam para skills apagadas faziam o robocopy sair com código 9 e o script abortar a instalação. Os alvos
  das junctions já ficam dentro de `.openmausbot`, então continuam no backup.
- **Onde:** `reinstalar.ps1`.
- **Como verificar:** `robocopy %USERPROFILE%\.openmausbot <pasta-teste> /E /XJ` sai com código < 8.

### 2026-10-24 — Instalador para Linux (sem Docker)
- **O quê:** `instalar-linux.sh` instala ou atualiza este fork numa máquina Linux sem Docker (feito para a área de
  trabalho Ubuntu em contêiner que é usada pelo navegador): instala o Node 24 via nvm (sem root), clona/atualiza o
  fork em `~/OpenMausBot`, compila servidor e interface, gera o pacote npm e instala o comando `openmausbot`, além
  dos CLIs de IA (`@anthropic-ai/claude-code`, `@openai/codex`). Uso:
  `curl -fsSL https://raw.githubusercontent.com/diego-o-pessoa/OpenMausBot/main/instalar-linux.sh | bash`, depois `openmausbot`.
- **Onde:** `instalar-linux.sh`, `.gitattributes` (força LF).
- **Como verificar:** `bash -n instalar-linux.sh`. Ainda não testado numa máquina Linux real.

### 2026-10-24 — Ensinar tarefas (etapas 1 a 5)
- **O quê:** no painel do navegador do bot, menu **⋮ → Ensinar uma tarefa…** grava o que a pessoa faz
  (cliques, digitação, escolhas em listas, navegação) como passos com o nome de cada elemento. Senhas e o
  que é digitado por "Digitar um segredo" nunca são gravados. Ao concluir, a pessoa revisa os passos, diz
  para que serve a tarefa e clica **Ensinar**: o app envia `/teach demo-<id> <objetivo>` e o bot escreve a
  habilidade, que fica pendente de revisão. O cartão da proposta ganhou **Testar antes de habilitar**: abre
  uma conversa nova com `/test-skill <id>`, o bot segue a habilidade ainda desabilitada e termina com
  "Skill test: passed/failed"; o cartão mostra o resultado. Habilitar continua manual.
- **Onde:** `server/browser/demo-recorder.ts`, `server/browser/viewers/demo-targets.ts`,
  `server/browser/viewers/demo-input.ts` (+2 linhas em `viewers/core.ts`), `server/browser/service.ts`,
  `server/browser/engines.ts`, `server/browser-demos.ts` (gravações em `<dados>/demos/<bot>/`),
  `server/routes/browser-demos.ts` + `browser-viewers.ts` (`GET/POST /api/bots/:id/browser/demo`),
  `server/skill-learn.ts` (`/teach`), `server/skill-test.ts` + `routes/bot-messages.ts`
  (`GET /api/bots/:id/skill-tests/:stagedId`), `src/components/browser/TeachBar.tsx`, `SkillTestRow.tsx`.
- **Limites:** só no motor de navegador novo (painel do desktop). Não grava o computador local nem as VMs.
- **Como verificar:** testes `server/browser/*demo*`, `server/skill-test.test.ts`, `server/skill-learn.test.ts`;
  com Chrome: `OMB_CDP_E2E=1 npx vitest run server/browser/viewers/stream-v2.e2e.test.ts`.
- **Pendente:** o teste de limite de tamanho falha por crescimento de `server/index.ts`, `server/routines.ts`
  e `GroupView.tsx` vindo de commits de 2026-10-23 (rotinas de equipe), não deste trabalho.

### 2026-10-22 — Mascote refeito a partir de medições do vídeo do Grok Bot
- **O quê:** os olhos do Grok foram medidos quadro a quadro no vídeo (10 vezes por segundo: posição,
  comprimento, largura e inclinação de cada olho, tamanho e esticão do corpo) e o mascote agora reproduz
  essas trajetórias:
  - **trabalhando:** repete os 18 s do Grok (olha para baixo à esquerda, varre para cima e para a direita,
    olhos grandes, some "atrás" da bola e volta), em loop;
  - **concluído:** os 10 s do Grok (sorriso "^^" com pulinhos, olhar de frente, volta à pose parada);
  - **clique:** o corpo encolhe para ~75% com os olhos rolando para o alto à esquerda e volta pela direita;
  - **mouse em cima:** olhos em bolinha que seguem o cursor;
  - **parado:** pose medida do Grok (olhos mais grossos que antes).
  - Formatos que o Grok não tem (cursor, blob, estrela etc.) agora são desenhados como **círculo**; o seletor
    mostra só círculo, almofada e feijão. (O Cocoa estava salvo como "blob", por isso parecia oval.)
  - Tamanhos dos olhos conferidos medindo o nosso mascote com o mesmo método: diferença ≤ 2%.
- **Por quê:** o primeiro mascote não ficou parecido o bastante (olhos, animações, mouse).
- **Onde:** `src/components/mascot-tracks.ts` (dados medidos), `src/components/sphere-mascot.ts` (rostos,
  interpolação, olhar para o mouse), `src/components/SphereMascot.tsx`, `src/lib/mascot.ts` (`GROK_BODY_IDS`,
  `grokBody`), editores de avatar e testes.
- **Como verificar:** `npx vite --port 5199` e abrir `/mascot-preview.html?faces` (rostos fixos),
  `?solo=working`, `?solo=done`, `?solo=press` ou a galeria.

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
