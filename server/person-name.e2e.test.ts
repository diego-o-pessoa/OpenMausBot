import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";
import { removeTempDir } from "./testing/cleanup.ts";

it("tells a bot who wrote when someone other than the owner uses the desktop", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "omb-person-"));
  const promptLog = join(scratch, "prompts.jsonl");
  const fixture = await launchVerificationServer({
    FAKE_CLAUDE_REPLIES: JSON.stringify(["Oi, Kayky.", "Oi.", "Oi no grupo, Kayky."]),
    FAKE_CLAUDE_REPLY_STATE: join(scratch, "reply-state"),
    FAKE_CLAUDE_TOOL_CALLS: "[]",
    FAKE_CLAUDE_PROMPTS: promptLog,
  });
  const api = async (method: string, path: string, body?: unknown, expected = 200, person?: string) => {
    const response = await fetch(fixture.info.url + path, {
      method,
      headers: { "content-type": "application/json", origin: fixture.info.url, ...(person ? { "x-openmausbot-person": encodeURIComponent(person) } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as any;
    expect(response.status, JSON.stringify(result)).toBe(expected);
    return result;
  };
  const prompts = (): string[] => existsSync(promptLog) ? readFileSync(promptLog, "utf8").trim().split("\n").map((line) => {
    const content = JSON.parse(line)?.message?.content;
    return Array.isArray(content) ? content.map((block: { text?: string }) => block.text ?? "").join("\n") : String(content ?? "");
  }) : [];
  try {
    await api("PATCH", "/api/config", { profile: { name: "Diego" } });
    const bot = (await api("POST", "/api/bots", { name: "Samu" }, 201)).bot;
    const transcript = async (): Promise<any[]> => (await api("GET", `/api/threads/${bot.threadId}/messages`)).messages;
    const replied = (reply: string) => expect.poll(async () => (await transcript()).some((message) => message.role === "bot" && message.text === reply), { timeout: 20_000 }).toBe(true);

    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text: "Quantas ofertas hoje?" }, 202, "Kayky");
    await replied("Oi, Kayky.");
    await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).bots.find((candidate: any) => candidate.id === bot.id).busy, { timeout: 20_000 }).toBe(false);
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text: "E agora?" }, 202, "diego");
    await replied("Oi.");

    expect(prompts()[0]).toContain("(This message is from Kayky, not Diego. Address Kayky by name.)\n\nQuantas ofertas hoje?");
    expect(prompts()[1]).not.toContain("This message is from");
    expect((await transcript()).filter((message) => message.role === "user").map((message) => message.sender?.name)).toEqual(["Kayky", "diego"]);

    const { group } = await api("POST", "/api/groups", {
      name: "Diretoria", memberIds: [bot.id], setup: { bulletin: "", defaultResponder: { kind: "member", botId: bot.id } },
    }, 201);
    await api("POST", `/api/groups/${group.id}/messages`, { text: "Bom dia, equipe" }, 202, "Kayky");
    await expect.poll(() => prompts().length, { timeout: 20_000 }).toBe(3);
    expect(prompts()[2]).toContain("Kayky: Bom dia, equipe");
    expect(prompts()[2]).toContain("(This message is from Kayky, not Diego. Address Kayky by name.)");
  } finally {
    await fixture.close();
    await removeTempDir(scratch);
  }
});
