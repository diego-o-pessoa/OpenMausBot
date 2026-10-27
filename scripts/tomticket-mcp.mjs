#!/usr/bin/env node
// A stdio MCP server for TomTicket (API v2) that can only answer as the configured attendant.
//
//   TOMTICKET_TOKEN=...  TOMTICKET_OPERATOR_ID=...  node scripts/tomticket-mcp.mjs
//   TOMTICKET_TOKEN=...  node scripts/tomticket-mcp.mjs find-operator "Diego Pessoa"
//
// Security invariant: no tool replies as the customer or links anyone but TOMTICKET_OPERATOR_ID, and a reply is
// sent only after the ticket reads back with that attendant linked. Keep the token here only, not in a bot's
// instructions or memory, so a bot cannot reach the API around these checks.

const API = (process.env.TOMTICKET_API_URL || "https://api.tomticket.com/v2.0").replace(/\/$/, "");
const TOKEN = process.env.TOMTICKET_TOKEN || "";
const OPERATOR_ID = (process.env.TOMTICKET_OPERATOR_ID || "").trim();
const OPERATOR_NAME = (process.env.TOMTICKET_OPERATOR_NAME || "").trim();
// TomTicket allows 3 requests per second: https://tomticket.tomticket.com/kb/api
const MIN_GAP_MS = 350;

class TicketError extends Error {}

let lastCall = 0;
async function call(method, path, params = {}) {
  if (!TOKEN) throw new TicketError("TOMTICKET_TOKEN is not set on this MCP server.");
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();
  const url = new URL(`${API}${path}`);
  const init = { method, headers: { authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(30_000) };
  if (method === "GET") {
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  } else {
    const form = new FormData();
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) form.set(key, String(value));
    init.body = form;
  }
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new TicketError(`TomTicket could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!response.ok || !body || body.error === true) {
    const detail = body?.message || text.slice(0, 300) || `HTTP ${response.status}`;
    throw new TicketError(`TomTicket refused ${path}: ${detail}`);
  }
  return body;
}

const ticketDetail = async (ticketId) => (await call("GET", "/ticket/detail", { ticket_id: ticketId })).data ?? {};
const linkedOperator = (ticket) => String(ticket?.operator?.id ?? "").trim();
const replies = (ticket) => (Array.isArray(ticket?.replies) ? ticket.replies : []);
const senderLabel = (reply) => (reply?.sender_type === "A" ? "atendente" : reply?.sender_type === "C" ? "cliente" : String(reply?.sender_type ?? "?"));
const normalized = (text) => String(text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

function requireOperator() {
  if (!OPERATOR_ID) throw new TicketError("TOMTICKET_OPERATOR_ID is not set on this MCP server, so it cannot link or answer as the attendant.");
}

function ticketIdOf(args) {
  const id = String(args?.ticket_id ?? "").trim();
  if (!id || id.length > 250) throw new TicketError("ticket_id is required: the ticket's id from tomticket_list_tickets or tomticket_get_ticket.");
  return id;
}

export function checkedMessage(raw) {
  const message = String(raw ?? "").replace(/\\r\\n|\\n|\\r/g, "\n").replace(/\r\n/g, "\n").trim();
  if (!message) throw new TicketError("The message is empty.");
  if (/^(?:teste?|testing|ok|okay|\.+|-+|x+|asdf\w*)[.!]*$/i.test(message)) {
    throw new TicketError("Refused: this looks like a test message. Every message is read by the customer; send only the final text.");
  }
  const placeholder = /\$\{?[A-Za-zÀ-ÿ_]|\{\{[^}]*\}\}|\[(?:nome|name|cliente|customer|id|ticket)[^\]]*\]/i.exec(message);
  if (placeholder) {
    throw new TicketError(`Refused: the message contains "${placeholder[0]}", which looks like an unfilled variable. Write the final text.`);
  }
  return message;
}

async function ensureOperatorLinked(ticketId) {
  requireOperator();
  let ticket = await ticketDetail(ticketId);
  if (linkedOperator(ticket) === OPERATOR_ID) return { ticket, linkedNow: false };
  await call("POST", "/ticket/operator/link", { ticket_id: ticketId, operator_id: OPERATOR_ID });
  ticket = await ticketDetail(ticketId);
  const now = linkedOperator(ticket);
  if (now !== OPERATOR_ID) {
    throw new TicketError(`Not sent: ticket ${ticketId} still has attendant "${ticket?.operator?.name ?? now ?? "none"}" after linking ${OPERATOR_ID}. Nothing was posted.`);
  }
  return { ticket, linkedNow: true };
}

function ticketView(ticket) {
  return {
    id: ticket.id,
    protocol: ticket.protocol,
    subject: ticket.subject,
    customer: ticket.customer?.name,
    attendant: ticket.operator ? { id: ticket.operator.id, name: ticket.operator.name } : null,
    attendantIsConfigured: linkedOperator(ticket) === OPERATOR_ID,
    status: ticket.current_status?.description ?? ticket.status?.description,
    situation: ticket.situation?.description,
    message: ticket.message,
    replies: replies(ticket).map((reply) => ({ from: senderLabel(reply), sender: reply.sender, date: reply.date, message: reply.message })),
  };
}

const TOOLS = [
  {
    name: "tomticket_list_tickets",
    description: "List TomTicket tickets, newest first, with each ticket's id, protocol, subject, customer, linked attendant and situation. situation filters by code: 0 waiting for the attendant, 1 not started, 2 answered and waiting for the customer, 3 answered by the customer, 5 finished (comma-separated for several). without_attendant: true lists only tickets nobody is linked to.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        situation: { type: "string", description: "Situation codes, comma-separated, e.g. \"0,1,3\"." },
        without_attendant: { type: "boolean" },
        page: { type: "integer", minimum: 1 },
      },
    },
  },
  {
    name: "tomticket_get_ticket",
    description: "Read one ticket: subject, customer, linked attendant (and whether it is the configured one), status, the opening message and every reply marked from \"atendente\" or \"cliente\". Read it before answering so you do not repeat a question.",
    inputSchema: { type: "object", additionalProperties: false, properties: { ticket_id: { type: "string" } }, required: ["ticket_id"] },
  },
  {
    name: "tomticket_link_attendant",
    description: "Link the configured attendant to a ticket and confirm it reads back linked. It always links the same attendant; there is no way to link anyone else.",
    inputSchema: { type: "object", additionalProperties: false, properties: { ticket_id: { type: "string" } }, required: ["ticket_id"] },
  },
  {
    name: "tomticket_reply",
    description: "Answer a ticket as the configured attendant. It links that attendant first if needed, refuses to post unless the ticket reads back with that attendant, posts through the attendant reply, then confirms the new reply is from the attendant. It refuses test messages, unfilled variables like $Name, and an exact repeat of the last attendant reply. Write the final text with real line breaks. This is the only way to write in a ticket: there is no customer reply.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { ticket_id: { type: "string" }, message: { type: "string", description: "The final text the customer will read." } },
      required: ["ticket_id", "message"],
    },
  },
  {
    name: "tomticket_finish",
    description: "Finish a ticket with a closing message, as the configured attendant (linked first if needed). Use only after the result is tested and confirmed.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { ticket_id: { type: "string" }, message: { type: "string" }, time_work_minutes: { type: "integer", minimum: 0 } },
      required: ["ticket_id", "message"],
    },
  },
];

async function runTool(name, args) {
  if (name === "tomticket_list_tickets") {
    const body = await call("GET", "/ticket/list", {
      page: args?.page ?? 1,
      situation: args?.situation,
      ...(args?.without_attendant ? { operator_id: "" } : {}),
    });
    const tickets = (Array.isArray(body.data) ? body.data : []).map((ticket) => ({
      id: ticket.id, protocol: ticket.protocol, subject: ticket.subject, customer: ticket.customer?.name,
      attendant: ticket.operator?.name ?? null, situation: ticket.situation?.description, status: ticket.status?.description,
    }));
    return { tickets, page: args?.page ?? 1, pages: body.pages };
  }
  if (name === "tomticket_get_ticket") return ticketView(await ticketDetail(ticketIdOf(args)));
  if (name === "tomticket_link_attendant") {
    const ticketId = ticketIdOf(args);
    const { ticket, linkedNow } = await ensureOperatorLinked(ticketId);
    return { ok: true, ticket_id: ticketId, attendant: ticket.operator?.name ?? OPERATOR_NAME, linkedNow };
  }
  if (name === "tomticket_reply") {
    const ticketId = ticketIdOf(args);
    const message = checkedMessage(args?.message);
    const { ticket, linkedNow } = await ensureOperatorLinked(ticketId);
    const lastFromAttendant = [...replies(ticket)].reverse().find((reply) => reply?.sender_type === "A");
    if (lastFromAttendant && normalized(lastFromAttendant.message) === normalized(message)) {
      throw new TicketError("Refused: this is the same text as the last attendant reply. Nothing was posted.");
    }
    const before = replies(ticket).length;
    const sent = await call("POST", "/ticket/reply/operator", { ticket_id: ticketId, message });
    const after = await ticketDetail(ticketId);
    const posted = replies(after).find((reply) => sent.id !== undefined && String(reply.id) === String(sent.id)) ?? replies(after)[replies(after).length - 1];
    const confirmed = replies(after).length > before && posted?.sender_type === "A" && linkedOperator(after) === OPERATOR_ID;
    if (!confirmed) {
      throw new TicketError(`Posted, but the ticket does not read back as expected: newest reply is from "${senderLabel(posted)}" (${posted?.sender ?? "unknown"}), attendant "${after?.operator?.name ?? "none"}". Read the ticket and fix it.`);
    }
    return { ok: true, ticket_id: ticketId, reply_id: sent.id ?? posted?.id, from: "atendente", sender: posted?.sender, attendant: after.operator?.name, linkedNow };
  }
  if (name === "tomticket_finish") {
    const ticketId = ticketIdOf(args);
    const message = checkedMessage(args?.message);
    await ensureOperatorLinked(ticketId);
    await call("POST", "/ticket/finish", {
      ticket_id: ticketId, message, ...(Number.isInteger(args?.time_work_minutes) ? { time_work: args.time_work_minutes } : {}),
    });
    const after = await ticketDetail(ticketId);
    return { ok: true, ticket_id: ticketId, status: after.current_status?.description, attendant: after.operator?.name };
  }
  throw new TicketError(`Unknown tool ${name}.`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(request) {
  const { id, method, params } = request;
  if (method === "initialize") {
    return send({ jsonrpc: "2.0", id, result: {
      protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "tomticket", version: "1.0.0" },
      instructions: `Use these tools for every TomTicket ticket; never call the TomTicket API another way. Replies always go out as the attendant${OPERATOR_NAME ? ` ${OPERATOR_NAME}` : ""}.`,
    } });
  }
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    try {
      const result = await runTool(params?.name, params?.arguments ?? {});
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
    } catch (error) {
      const text = error instanceof TicketError ? error.message : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: true } });
    }
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

async function findOperator(name) {
  const wanted = normalized(name);
  const seen = new Map();
  for (let page = 1; page <= 10; page++) {
    const body = await call("GET", "/ticket/list", { page });
    for (const ticket of Array.isArray(body.data) ? body.data : []) {
      if (ticket.operator?.id) seen.set(String(ticket.operator.id), ticket.operator.name);
    }
    if (!body.next_page) break;
  }
  const matches = [...seen].filter(([, operatorName]) => !wanted || normalized(operatorName).includes(wanted));
  if (!matches.length) {
    console.error(seen.size ? `No attendant named "${name}" on recent tickets. Attendants seen: ${[...seen.values()].join(", ")}` : "No recent ticket has an attendant yet. Link one by hand in TomTicket, then run this again.");
    process.exitCode = 1;
    return;
  }
  for (const [operatorId, operatorName] of matches) console.log(`${operatorName}\tTOMTICKET_OPERATOR_ID=${operatorId}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("tomticket-mcp.mjs")) {
  if (process.argv[2] === "find-operator") {
    findOperator(process.argv.slice(3).join(" ")).catch((error) => { console.error(error.message); process.exitCode = 1; });
  } else {
    let buffer = "";
    let queue = Promise.resolve();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let request;
        try { request = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
        queue = queue.then(() => handle(request)).catch((error) => console.error(error));
      }
    });
  }
}
