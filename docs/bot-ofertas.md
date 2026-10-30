# bot-ofertas

`scripts/bot-ofertas-mcp.mjs` is a stdio MCP server for the agent API of
[KaykyFelipe/bot-ofertas](https://github.com/KaykyFelipe/bot-ofertas) (`api.py` there). A bot uses it to
create, post, send to WhatsApp and schedule offers. It replaces operating the bot through Telegram Web.

## What it guarantees

This server only forwards. The rules are enforced by bot-ofertas itself:

- the agent only touches offers it created (unless `API_TODAS_AS_OFERTAS=true`);
- the daily limit (`MAX_POR_DIA`) counts every post, by people and agents;
- an offer is never posted twice, and the same product cannot come back for 7 days;
- there is no settings route;
- with `API_APROVACAO=true`, an agent's offer goes out only after someone in the group taps **👍 Aprovar**.
  There is no tool to approve: an agent cannot approve its own offers. For it to work alone, set
  `API_APROVACAO=false`.

Every step shows in the group ("🤖 Samu criou #12", "🤖 Samu postou #12"), with the usual buttons, so people
can still discard an offer.

Tools:

- `ofertas_criar`
- `ofertas_ver`
- `ofertas_recentes`
- `ofertas_postar`
- `ofertas_whatsapp`
- `ofertas_descartar`
- `ofertas_editar`, `ofertas_cupom`, `ofertas_pra_fila`, `ofertas_kit` and `ofertas_marketeiro`: the same as the
  ✏️ Editar, cupom, 🕒 Pra fila, 🎁 Kit and 📣 Marketeiro buttons
- `ofertas_mensagem_grupo`: the window summary or an alert in the group, always signed with the agent's name
- `ofertas_agendar_janela`
- `ofertas_situacao`
- `ofertas_buscar_shopee`
- `ofertas_funil`: filters and ranks a list of products without AI and without creating anything (price floor per
  category, banned words, discount, rating, sales, and products posted in the last 7 days)

With `BOT_OFERTAS_SOMENTE_LEITURA=1`, only `ofertas_ver`, `ofertas_recentes`, `ofertas_situacao` and `ofertas_funil` are listed,
and the others are refused before any call. This is the setup for a bot that only checks the day.

`ofertas_agendar_janela` hands a posting window to bot-ofertas:

1. It draws how many offers go out and at what times.
2. It posts each one on time, then sends it to WhatsApp after a pause.
3. It discards the leftovers when the window ends.

The agent's turn ends right after the call.

## Set it up

1. In bot-ofertas' `.env` on the VPS, set two different tokens, each from `openssl rand -hex 32`:

   ```
   API_TOKEN=...
   API_AGENTE=Samu
   API_TOKEN_LEITURA=...
   ```

   Then run `docker compose up -d`. The API listens on `127.0.0.1:8090` of the VPS only.
2. In OpenMausBot on the VPS, open **Plugins → MCP servers → Add server → Run a command**:
   - Command: `node`.
   - Argument: the full path to `scripts/bot-ofertas-mcp.mjs`. On a VPS installed by the remote installer,
     that is `/home/openmausbot/OpenMausBot/scripts/bot-ofertas-mcp.mjs`.
   - Environment: `BOT_OFERTAS_TOKEN=` set to the `API_TOKEN`. If the port is not 8090, also set
     `BOT_OFERTAS_URL=http://127.0.0.1:PORT`.
   - Name it `bot-ofertas`, choose **Test**, check the sixteen tools, and turn it on for the posting bot.
3. For a bot that only checks the day, add a second server named `bot-ofertas-leitura` with the same command,
   `BOT_OFERTAS_TOKEN` set to the `API_TOKEN_LEITURA` and `BOT_OFERTAS_SOMENTE_LEITURA=1`.
4. Remove any Telegram Web skill from the posting bot, and set its computer to **Off**: it no longer needs a
   screen.

## Limits

- Bots run shell commands as the same user as OpenMausBot, so a bot that went looking could read the token
  from OpenMausBot's `config.json`. The API still enforces its rules for any caller with that token.
- An offer created from a link reads the product page from the VPS. When the Mercado Livre page cannot be
  read, the offer lacks a title or price and cannot be posted until a person edits it in the group.

## Verification

```sh
pnpm exec vitest run scripts/bot-ofertas-mcp.test.ts
```

It runs the real server over stdio against a fake API. The test checks that:

- the tools are listed;
- the token is sent;
- the bot's refusals come back as tool errors with their details;
- read-only mode hides and refuses every tool that changes something;
- a missing or wrong token is reported.

The API's own rules are tested in bot-ofertas (`tests/test_api.py`).
