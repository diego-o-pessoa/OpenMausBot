import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "tomticket-mcp.mjs");
const DIEGO = "op-diego";

type Reply = { id: string; sender_type: "A" | "C"; sender: string; message: string };
let api: Server;
let url: string;
let calls: string[];
let ticket: { id: string; operator: { id: string; name: string } | null; replies: Reply[] };
let linkSticks: boolean;
let replyAs: "A" | "C";
let child: ChildProcess;
let nextId = 1;
const pending = new Map<number, (value: any) => void>();

async function form(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = new Response(Buffer.concat(chunks), { headers: { "content-type": String(req.headers["content-type"]) } });
  return Object.fromEntries([...(await body.formData()).entries()].map(([key, value]) => [key, String(value)]));
}

beforeEach(async () => {
  calls = [];
  linkSticks = true;
  replyAs = "A";
  ticket = { id: "t1", operator: null, replies: [{ id: "r0", sender_type: "C", sender: "Kayky", message: "Me ajuda impressora nao funfa" }] };
  api = createServer(async (req, res) => {
    const path = new URL(req.url!, "http://x").pathname;
    const json = (body: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== "Bearer fixture-token") { res.writeHead(401); return res.end("{\"error\":true,\"message\":\"no\"}"); }
    const fields = req.method === "POST" ? await form(req) : {};
    if (fields.message !== undefined) fields.message = fields.message.replace(/\r\n/g, "\n");
    calls.push(`${req.method} ${path}${fields.message !== undefined ? ` ${JSON.stringify(fields.message)}` : ""}`);
    if (path === "/ticket/detail") return json({ error: false, data: ticket });
    if (path === "/ticket/operator/link") {
      if (linkSticks) ticket.operator = { id: fields.operator_id, name: "Diego Pessoa" };
      return json({ error: false, success: true });
    }
    if (path === "/ticket/reply/operator") {
      if (!ticket.operator) return json({ error: true, message: "Somente será possível realizar essa operação se houver um atendente vinculado." });
      const id = `r${ticket.replies.length}`;
      ticket.replies.push({ id, sender_type: replyAs, sender: replyAs === "A" ? "Diego Pessoa" : "Kayky", message: fields.message });
      return json({ error: false, success: true, id });
    }
    res.writeHead(404); res.end("{\"error\":true,\"message\":\"unexpected\"}");
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const address = api.address();
  if (!address || typeof address === "string") throw new Error("fixture did not listen");
  url = `http://127.0.0.1:${address.port}`;
  child = spawn(process.execPath, [SCRIPT], {
    env: { PATH: process.env.PATH, TOMTICKET_API_URL: url, TOMTICKET_TOKEN: "fixture-token", TOMTICKET_OPERATOR_ID: DIEGO, TOMTICKET_OPERATOR_NAME: "Diego Pessoa" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  createInterface({ input: child.stdout! }).on("line", (line) => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
});

afterEach(async () => {
  child.kill();
  await new Promise<void>((resolve) => api.close(() => resolve()));
});

function rpc(method: string, params: unknown): Promise<any> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

async function tool(name: string, args: Record<string, unknown>) {
  const answer = await rpc("tools/call", { name, arguments: args });
  return { error: answer.result.isError === true, text: answer.result.content[0].text as string };
}

it("offers no way to answer as the customer or link anyone else", async () => {
  const { result } = await rpc("tools/list", {});
  const names = result.tools.map((entry: { name: string }) => entry.name);
  expect(names).toEqual(["tomticket_list_tickets", "tomticket_get_ticket", "tomticket_link_attendant", "tomticket_reply", "tomticket_finish"]);
  const link = result.tools.find((entry: { name: string }) => entry.name === "tomticket_link_attendant");
  expect(Object.keys(link.inputSchema.properties)).toEqual(["ticket_id"]);
});

it("links the attendant before the first reply, posts as the attendant and confirms it", async () => {
  const sent = await tool("tomticket_reply", { ticket_id: "t1", message: "Olá Kayky!\\nPreciso do ID do AnyDesk." });
  expect(sent.error, sent.text).toBe(false);
  expect(JSON.parse(sent.text)).toMatchObject({ ok: true, from: "atendente", attendant: "Diego Pessoa", linkedNow: true });
  expect(calls).toEqual([
    "GET /ticket/detail",
    "POST /ticket/operator/link",
    "GET /ticket/detail",
    `POST /ticket/reply/operator ${JSON.stringify("Olá Kayky!\nPreciso do ID do AnyDesk.")}`,
    "GET /ticket/detail",
  ]);
  expect(calls.some((entry) => entry.includes("customer"))).toBe(false);
});

it("posts nothing when the attendant does not read back as linked", async () => {
  linkSticks = false;
  const sent = await tool("tomticket_reply", { ticket_id: "t1", message: "Olá Kayky!" });
  expect(sent.error).toBe(true);
  expect(sent.text).toMatch(/Not sent/);
  expect(calls.some((entry) => entry.startsWith("POST /ticket/reply"))).toBe(false);
});

it("refuses test messages, unfilled variables and an exact repeat before touching the ticket", async () => {
  for (const message of ["teste", "Teste.", "ok", "$Kayky, não use o mouse.", "Olá {{nome}}"]) {
    const sent = await tool("tomticket_reply", { ticket_id: "t1", message });
    expect(sent.error, message).toBe(true);
  }
  expect(calls).toEqual([]);
  expect((await tool("tomticket_reply", { ticket_id: "t1", message: "O valor é R$ 50,00." })).error).toBe(false);
  const repeat = await tool("tomticket_reply", { ticket_id: "t1", message: "O valor é R$ 50,00." });
  expect(repeat.error).toBe(true);
  expect(repeat.text).toMatch(/same text/);
});

it("reports a reply that reads back as the customer's", async () => {
  ticket.operator = { id: DIEGO, name: "Diego Pessoa" };
  replyAs = "C";
  const sent = await tool("tomticket_reply", { ticket_id: "t1", message: "Olá Kayky!" });
  expect(sent.error).toBe(true);
  expect(sent.text).toMatch(/cliente/);
});

it("reads a ticket with each reply marked atendente or cliente and whether the attendant is the configured one", async () => {
  ticket.operator = { id: "someone-else", name: "Kayky Nascimento" };
  const read = JSON.parse((await tool("tomticket_get_ticket", { ticket_id: "t1" })).text);
  expect(read).toMatchObject({ attendant: { name: "Kayky Nascimento" }, attendantIsConfigured: false, replies: [{ from: "cliente", sender: "Kayky" }] });
  expect(JSON.parse((await tool("tomticket_link_attendant", { ticket_id: "t1" })).text)).toMatchObject({ ok: true, attendant: "Diego Pessoa", linkedNow: true });
});
