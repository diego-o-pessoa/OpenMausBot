import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { callTriggerTool } from "./drivers/agents-call-triggers.ts";
import type { ToolCallContext } from "./drivers/agents-call.ts";
import { routineToolScheduleSchema, storedScheduleSchema } from "./routine-request-schemas.ts";
import { latestIntervalOccurrence } from "./routine-intervals.ts";
import { cleanSchedule, cloneSchedule, mergeScheduleUpdate, nextOccurrence, type RoutineIntervalSchedule } from "./routine-schedules.ts";
import { RoutineManager, type RoutineManagerOptions } from "./routines.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute, 0, 0).getTime();
const threeADay: RoutineIntervalSchedule = {
  type: "interval", everyMinutes: 240, anchorAt: at(26, 9), window: { start: "09:00", end: "21:00" }, random: true,
};

function runsBetween(schedule: RoutineIntervalSchedule, from: number, to: number): number[] {
  const runs: number[] = [];
  for (let next = nextOccurrence(schedule, from); next !== null && next < to; next = nextOccurrence(schedule, next)) runs.push(next);
  return runs;
}

describe("random times inside an interval", () => {
  it("runs once in each interval of the window, at a minute that is not the interval's start", () => {
    const runs = runsBetween(threeADay, at(26, 8), at(29, 8));
    expect(runs).toHaveLength(9);
    for (const [index, run] of runs.entries()) {
      const day = Math.floor(index / 3);
      const slot = at(26 + day, 9 + (index % 3) * 4);
      expect(run).toBeGreaterThanOrEqual(slot);
      expect(run).toBeLessThan(slot + 240 * 60_000);
      expect(new Date(run).getSeconds()).toBe(0);
    }
    expect(runs.some((run, index) => run !== at(26 + Math.floor(index / 3), 9 + (index % 3) * 4))).toBe(true);
    expect(new Set(runs.map((run) => new Date(run).getMinutes() + new Date(run).getHours() * 60)).size).toBeGreaterThan(3);
  });

  it("draws the same minutes after a restart, and the latest run agrees with the next one", () => {
    const first = nextOccurrence(threeADay, at(27, 8))!;
    expect(nextOccurrence(structuredClone(threeADay), at(27, 8))).toBe(first);
    expect(latestIntervalOccurrence(threeADay, first)).toBe(first);
    expect(latestIntervalOccurrence(threeADay, first - 60_000)).toBeLessThan(first);
    expect(latestIntervalOccurrence(threeADay, first - 60_000)).toBe(runsBetween(threeADay, at(26, 8), at(27, 8)).at(-1));
  });

  it("keeps a run inside a window shorter than its interval and on its own day", () => {
    const evenings: RoutineIntervalSchedule = { type: "interval", everyMinutes: 60, anchorAt: at(26, 20), window: { start: "20:00", end: "20:30" }, random: true };
    for (const run of runsBetween(evenings, at(26, 19), at(30, 19))) {
      const date = new Date(run);
      expect(date.getHours() * 60 + date.getMinutes()).toBeGreaterThanOrEqual(20 * 60);
      expect(date.getHours() * 60 + date.getMinutes()).toBeLessThan(20 * 60 + 30);
    }
    const daily: RoutineIntervalSchedule = { type: "interval", everyMinutes: 1_440, anchorAt: at(26, 18), random: true };
    for (const run of runsBetween(daily, at(26, 17), at(31, 17))) expect(new Date(run).getHours()).toBeGreaterThanOrEqual(18);
  });

  it("is saved, cloned and kept on an edit that does not mention it", () => {
    const saved = cleanSchedule({ type: "interval", everyMinutes: 240, anchorAt: at(26, 9), window: { start: "09:00", end: "21:00" }, random: true }, at(26, 8));
    expect(saved).toMatchObject({ random: true });
    expect(cloneSchedule(saved)).toEqual(saved);
    expect(mergeScheduleUpdate(saved, { type: "interval", everyMinutes: 180, anchorAt: at(26, 9) })).toMatchObject({ random: true });
    expect(cleanSchedule(mergeScheduleUpdate(saved, { type: "interval", everyMinutes: 180, anchorAt: at(26, 9), random: false }), at(26, 8))).not.toHaveProperty("random");
    expect(() => cleanSchedule({ type: "interval", everyMinutes: 240, anchorAt: at(26, 9), random: "yes" } as never, at(26, 8))).toThrow("Random times must be on or off");
  });

  it("lets a bot ask for random times, and the request keeps them", async () => {
    const bodies: unknown[] = [];
    const client = {
      api: async () => ({}),
      apiResponse: async (_path: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return { ok: true, status: 201, body: { resultId: "r-1", summary: "Created." } };
      },
    };
    const ctx = { botId: "scout", threadId: "thread-1", depth: 0, externalRuntime: false, sharedComputers: false, client } as unknown as ToolCallContext;
    await callTriggerTool("create_trigger", {
      when: "schedule", name: "Offers", instructions: "Post an offer.",
      schedule: { type: "interval", every_minutes: 240, window_start: "09:00", window_end: "21:00", random_times: true },
    }, ctx);
    expect(JSON.stringify(bodies[0])).toContain('"random":true');
    expect(routineToolScheduleSchema.parse({ type: "interval", everyMinutes: 240, random: true })).toMatchObject({ random: true });
    expect(storedScheduleSchema.parse({ type: "interval", everyMinutes: 240, anchorAt: at(26, 9), random: true })).toMatchObject({ random: true });
  });

  it("starts the bot's turn at the drawn minute and not at the interval's start", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-random-times-"));
    dirs.push(dir);
    let now = at(26, 8);
    const started: number[] = [];
    let task = 0;
    const options: RoutineManagerOptions = {
      file: join(dir, "routines.json"),
      now: () => now,
      emit: () => {},
      botState: () => "ready",
      goalState: () => "ready",
      createTask: () => ({ threadId: `thread-${++task}` }),
      createGoalTask: () => ({ threadId: `goal-${++task}` }),
      startTurn: async () => { started.push(now); },
      startGoal: async () => {},
      interruptTurn: async () => {},
      interruptGoal: async () => {},
    };
    const manager = new RoutineManager(options);
    const routine = manager.create({ name: "Post offers", prompt: "Post today's offer", botId: "maus-1", schedule: threeADay });
    const drawn = routine.nextRunAt!;
    expect(drawn).toBe(nextOccurrence(threeADay, at(26, 8)));
    for (now = at(26, 9); now < drawn; now += 60_000) await manager.tick();
    expect(started).toEqual([]);
    now = drawn;
    await manager.tick();
    expect(started).toEqual([drawn]);
    expect(manager.listRoutines()[0]!.nextRunAt).toBe(nextOccurrence(threeADay, drawn));
  });
});
