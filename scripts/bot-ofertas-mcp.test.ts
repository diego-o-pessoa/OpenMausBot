import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "bot-ofertas-mcp.mjs");

let api: Server;
let child: ChildProcess;
let calls: Array<{ method: string; path: string; body: unknown; auth: string | undefined }>;
let nextId = 1;
const pending = new Map<number, (value: any) => void>();

async function start(env: Record<string, string> = {}) {
  calls = [];
  api = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({ method: req.method!, path: req.url!, body, auth: req.headers.authorization });
    const json = (status: number, payload: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); };
    if (req.headers.authorization !== "Bearer fixture-token") return json(401, { erro: "Token inválido ou ausente." });
    if (req.method === "POST" && req.url === "/ofertas") return json(201, { oferta: { id: 12, status: "rascunho" }, pronta: true, falta: [], divergencias: [] });
    if (req.method === "POST" && req.url === "/ofertas/7/postar") return json(403, { erro: "A #7 não é sua: quem criou foi uma pessoa do grupo." });
    if (req.method === "POST" && req.url === "/janelas") return json(422, { erro: "Nenhuma das ofertas está pronta para agendar.", recusadas: [{ id: 3, motivo: "falta foto" }] });
    if (req.method === "POST" && req.url === "/ofertas/12/editar") return json(200, { oferta: { id: 12, ...body } });
    if (req.method === "POST" && req.url === "/grupo/mensagem") return json(200, { ok: true });
    if (req.method === "GET" && req.url === "/situacao") return json(200, { postadas_hoje: 2, limite_do_dia: 18 });
    if (req.method === "GET" && req.url === "/ofertas?dias=3") return json(200, { ofertas: [] });
    return json(404, { erro: "unexpected" });
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const address = api.address();
  if (!address || typeof address === "string") throw new Error("fixture did not listen");
  child = spawn(process.execPath, [SCRIPT], {
    env: { PATH: process.env.PATH, BOT_OFERTAS_URL: `http://127.0.0.1:${address.port}`, BOT_OFERTAS_TOKEN: "fixture-token", ...env },
    stdio: ["pipe", "pipe", "inherit"],
  });
  createInterface({ input: child.stdout! }).on("line", (line) => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
}

afterEach(async () => {
  child?.kill();
  if (api) await new Promise<void>((resolve) => api.close(() => resolve()));
});

function rpc(method: string, params: unknown): Promise<any> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

async function tool(name: string, args: Record<string, unknown> = {}) {
  const answer = await rpc("tools/call", { name, arguments: args });
  return { error: answer.result.isError === true, text: answer.result.content[0].text as string };
}

const toolNames = async () => (await rpc("tools/list", {})).result.tools.map((entry: { name: string }) => entry.name);

it("lists the offer tools and none that reach settings", async () => {
  await start();
  expect(await toolNames()).toEqual([
    "ofertas_criar", "ofertas_ver", "ofertas_recentes", "ofertas_postar", "ofertas_whatsapp",
    "ofertas_descartar", "ofertas_editar", "ofertas_cupom", "ofertas_pra_fila", "ofertas_kit",
    "ofertas_marketeiro", "ofertas_mensagem_grupo", "ofertas_agendar_janela", "ofertas_situacao",
    "ofertas_buscar_shopee",
  ]);
});

it("forwards a new offer with the token and returns the bot's preview", async () => {
  await start();
  const created = await tool("ofertas_criar", { link: "https://meli.la/abc", cupom: "TECH10", cupom_pct: 10 });
  expect(created.error, created.text).toBe(false);
  expect(JSON.parse(created.text)).toMatchObject({ oferta: { id: 12 }, pronta: true });
  expect(calls).toEqual([{ method: "POST", path: "/ofertas", body: { link: "https://meli.la/abc", cupom: "TECH10", cupom_pct: 10 }, auth: "Bearer fixture-token" }]);
});

it("sends an edit's fields without the id, and a group message as text", async () => {
  await start();
  const edited = await tool("ofertas_editar", { id: 12, pix: 85.4, cupom: null });
  expect(JSON.parse(edited.text)).toEqual({ oferta: { id: 12, pix: 85.4, cupom: null } });
  expect(calls[0]).toMatchObject({ method: "POST", path: "/ofertas/12/editar", body: { pix: 85.4, cupom: null } });
  expect((await tool("ofertas_mensagem_grupo", { texto: "Janela da manhã: 4 agendadas" })).error).toBe(false);
  expect(calls[1]).toMatchObject({ path: "/grupo/mensagem", body: { texto: "Janela da manhã: 4 agendadas" } });
});

it("passes the bot's refusals through as tool errors, with their details", async () => {
  await start();
  const notMine = await tool("ofertas_postar", { id: 7 });
  expect(notMine).toEqual({ error: true, text: "A #7 não é sua: quem criou foi uma pessoa do grupo." });
  const window = await tool("ofertas_agendar_janela", { ids: [3], janela: "manha" });
  expect(window.error).toBe(true);
  expect(window.text).toContain("Nenhuma das ofertas está pronta");
  expect(window.text).toContain("falta foto");
  expect((await tool("ofertas_postar", { id: "x" })).text).toMatch(/número da oferta/);
});

it("hides and refuses every tool that changes something in read-only mode", async () => {
  await start({ BOT_OFERTAS_SOMENTE_LEITURA: "1" });
  expect(await toolNames()).toEqual(["ofertas_ver", "ofertas_recentes", "ofertas_situacao"]);
  const refused = await tool("ofertas_postar", { id: 12 });
  expect(refused.error).toBe(true);
  expect(calls).toEqual([]);
  expect(JSON.parse((await tool("ofertas_situacao")).text)).toEqual({ postadas_hoje: 2, limite_do_dia: 18 });
  expect(JSON.parse((await tool("ofertas_recentes", { dias: 3 })).text)).toEqual({ ofertas: [] });
});

it("says plainly when the token is missing or wrong", async () => {
  await start({ BOT_OFERTAS_TOKEN: "" });
  expect((await tool("ofertas_situacao")).text).toMatch(/BOT_OFERTAS_TOKEN/);
  child.kill();
  await new Promise<void>((resolve) => api.close(() => resolve()));
  await start({ BOT_OFERTAS_TOKEN: "wrong" });
  expect(await tool("ofertas_situacao")).toEqual({ error: true, text: "Token inválido ou ausente." });
});
