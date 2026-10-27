# TomTicket

`scripts/tomticket-mcp.mjs` is a stdio MCP server for the TomTicket API v2 that can only answer as one
attendant. Bots use it instead of calling the API themselves, so a reply can never go out as the customer.

## What it guarantees

- **No customer reply.** It never calls `/ticket/reply/customer`; replies go through `/ticket/reply/operator`.
- **Attendant first.** Before a reply or a finish, it reads the ticket. When the linked attendant is not
  `TOMTICKET_OPERATOR_ID`, it links that attendant (`/ticket/operator/link`) and reads the ticket again.
  If the attendant still does not match, it posts nothing and says so.
- **Checked after sending.** After a reply it reads the ticket again and confirms the newest reply is from
  the attendant (`sender_type` `A`). Otherwise it reports the reply as wrong.
- **Only one attendant.** `tomticket_link_attendant` takes a ticket id and nothing else.
- **No noise.** It refuses a test message ("teste", "ok"), text that holds an unfilled variable such as
  `$Kayky` or `{{nome}}`, and an exact repeat of the last attendant reply. A literal `\n` in the text becomes
  a real line break.
- It keeps under TomTicket's limit of 3 requests per second.

Tools: `tomticket_list_tickets`, `tomticket_get_ticket`, `tomticket_link_attendant`, `tomticket_reply`,
`tomticket_finish`.

## Set it up

1. In TomTicket, create an API token under Administração → Configurações da Conta → API → Novo Token, with
   "Pode criar e modificar dados". Use a new token only for this server, and delete any token a bot was
   given before.
2. Find the attendant's id:

   ```sh
   TOMTICKET_TOKEN=... node scripts/tomticket-mcp.mjs find-operator "Diego Pessoa"
   ```

   It reads recent tickets and prints `TOMTICKET_OPERATOR_ID=...` for every attendant with that name. If no
   recent ticket has that attendant, link one ticket to them by hand in TomTicket first.
3. In OpenMausBot, open **Plugins → MCP servers → Add server → Run a command**:
   - Command: `node`. On a desktop install without Node, use the app's own executable
     (`/opt/OpenMausBot/openmausbot` on Linux) and add `ELECTRON_RUN_AS_NODE=1` to the environment.
   - Argument: the full path to `scripts/tomticket-mcp.mjs`.
   - Environment:
     ```
     TOMTICKET_TOKEN=...
     TOMTICKET_OPERATOR_ID=...
     TOMTICKET_OPERATOR_NAME=Diego Pessoa
     ```
   - Name it `tomticket`, choose **Test**, check the five tools, and turn it on.
4. Remove the TomTicket token from every bot's standing instructions, memory and skills, and tell the bots
   to use only the `tomticket_*` tools.

## Limits

- Bots run shell commands as the same user that runs this server, so a bot that went looking could still
  read the token from OpenMausBot's `config.json`. The tools remove the reason to: keep the token out of the
  bots' own instructions and files.
- The checks cover who is linked and who a reply is from, not what the text says. Wording is the bot's.
- `situation` codes and the field names follow TomTicket's documentation at
  https://tomticket.tomticket.com/kb/api. The server was tested against a fake API, not a live account.

## Verification

```sh
pnpm exec vitest run scripts/tomticket-mcp.test.ts
```

It runs the real server over stdio against a fake TomTicket API. The test checks that:

- there is no customer reply and no way to link another attendant;
- the attendant is linked before the first reply;
- nothing is posted when the link does not read back;
- test messages, unfilled variables and repeats are refused;
- a reply that reads back as the customer's is reported.
