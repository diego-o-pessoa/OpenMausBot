import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import type { DemoStep } from "./browser/demo-recorder.ts";

/** A finished demonstration, kept until it is taught or discarded. */
export interface SavedDemo {
  version: 1;
  id: string;
  botId: string;
  createdAt: number;
  steps: DemoStep[];
  truncated: boolean;
}

export const DEMOS_KEPT = 20;
const ID = /^[0-9a-f-]{36}$/;
const BOT = /^[\w-]{1,128}$/;

const folder = (dataDir: string, botId: string) => join(dataDir, "demos", botId);

export function saveDemo(dataDir: string, botId: string, demo: { steps: DemoStep[]; truncated: boolean }, now = Date.now()): SavedDemo {
  if (!BOT.test(botId)) throw new Error("bad bot id");
  const saved: SavedDemo = { version: 1, id: randomUUID(), botId, createdAt: now, steps: demo.steps, truncated: demo.truncated };
  const dir = folder(dataDir, botId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileAtomic(join(dir, `${saved.id}.json`), JSON.stringify(saved), { mode: 0o600 });
  for (const old of listDemos(dataDir, botId).slice(DEMOS_KEPT)) deleteDemo(dataDir, botId, old.id);
  return saved;
}

export function loadDemo(dataDir: string, botId: string, id: string): SavedDemo | null {
  if (!BOT.test(botId) || !ID.test(id)) return null;
  try {
    const parsed = JSON.parse(readFileSync(join(folder(dataDir, botId), `${id}.json`), "utf8")) as SavedDemo;
    return parsed?.version === 1 && parsed.id === id && parsed.botId === botId && Array.isArray(parsed.steps) ? parsed : null;
  } catch {
    return null;
  }
}

/** Newest first. */
export function listDemos(dataDir: string, botId: string): SavedDemo[] {
  const dir = folder(dataDir, botId);
  if (!BOT.test(botId) || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => loadDemo(dataDir, botId, name.slice(0, -5)))
    .filter((demo): demo is SavedDemo => demo !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function deleteDemo(dataDir: string, botId: string, id: string): boolean {
  if (!BOT.test(botId) || !ID.test(id)) return false;
  const file = join(folder(dataDir, botId), `${id}.json`);
  if (!existsSync(file)) return false;
  rmSync(file, { force: true });
  return true;
}

/** The newest demonstration whose id starts with `ref`, the short form a /teach message carries. */
export function findDemo(dataDir: string, botId: string, ref: string): SavedDemo | null {
  if (!/^[0-9a-f-]{8,36}$/.test(ref)) return null;
  return listDemos(dataDir, botId).find((demo) => demo.id.startsWith(ref)) ?? null;
}
