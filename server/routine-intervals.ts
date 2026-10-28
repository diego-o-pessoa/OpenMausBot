// When an interval routine may run: its days, its hours and its end, read in this computer's local time. Moved out of
// routines.ts unchanged.
import type { RoutineIntervalSchedule } from "./routine-schedules.ts";

export const MAX_DATE_MS = 8_640_000_000_000_000;
const LOCAL_DAY_MS = 24 * 60 * 60_000;
export const INTERVAL_RESTRICTION_SEARCH_MS = 9 * LOCAL_DAY_MS;
const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function clockMinutes(value: string): number | null {
  const match = CLOCK_TIME.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function intervalHasRestrictions(
  schedule: Pick<RoutineIntervalSchedule, "weekdays" | "window" | "endsAt">,
): boolean {
  return schedule.weekdays !== undefined || schedule.window !== undefined || schedule.endsAt !== undefined;
}

export function intervalAllowsOccurrence(schedule: RoutineIntervalSchedule, at: number): boolean {
  if (schedule.endsAt !== undefined && at > schedule.endsAt) return false;
  const date = new Date(at);
  if (schedule.weekdays && !schedule.weekdays.includes(date.getDay())) return false;
  if (schedule.window) {
    const minute = date.getHours() * 60 + date.getMinutes();
    const start = clockMinutes(schedule.window.start)!;
    const end = clockMinutes(schedule.window.end)!;
    if (minute < start || minute >= end) return false;
  }
  return true;
}

export function isSameLocalDay(left: number, right: number): boolean {
  const a = new Date(left);
  const b = new Date(right);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function nextAlignedInterval(schedule: RoutineIntervalSchedule, after: number): number | null {
  if (schedule.anchorAt > after) return schedule.anchorAt;
  const intervalMs = schedule.everyMinutes * 60_000;
  const intervalsElapsed = Math.floor((after - schedule.anchorAt) / intervalMs);
  const candidate = schedule.anchorAt + (intervalsElapsed + 1) * intervalMs;
  return Number.isSafeInteger(candidate) && candidate <= MAX_DATE_MS ? candidate : null;
}

export function latestIntervalOccurrence(
  schedule: RoutineIntervalSchedule,
  at: number,
): number | null {
  if (schedule.random) return latestRandomIntervalRun(schedule, at);
  const intervalMs = schedule.everyMinutes * 60_000;
  const ceiling = Math.min(at, schedule.endsAt ?? at);
  if (schedule.anchorAt > ceiling) return null;
  let candidate = schedule.anchorAt + Math.floor((ceiling - schedule.anchorAt) / intervalMs) * intervalMs;
  if (!intervalHasRestrictions(schedule)) return candidate;
  const maxCandidates = Math.ceil(INTERVAL_RESTRICTION_SEARCH_MS / intervalMs) + 2;
  for (let checked = 0; checked < maxCandidates; checked++) {
    if (intervalAllowsOccurrence(schedule, candidate)) return candidate;
    const previous = candidate - intervalMs;
    if (!Number.isSafeInteger(previous) || previous < schedule.anchorAt) return null;
    candidate = previous;
  }
  return null;
}

function slotAllowed(schedule: RoutineIntervalSchedule, slot: number): boolean {
  return intervalAllowsOccurrence({ ...schedule, endsAt: undefined }, slot);
}

/** How far into its interval a slot may run: the whole interval, cut at the window's end or midnight, so a run keeps its slot's day. */
function randomSpanMs(schedule: RoutineIntervalSchedule, slot: number): number {
  const end = new Date(slot);
  const endMinutes = schedule.window ? clockMinutes(schedule.window.end)! : 24 * 60;
  end.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
  return Math.max(60_000, Math.min(schedule.everyMinutes * 60_000, end.getTime() - slot));
}

/** The drawn minute depends only on the routine's anchor and the slot, so every restart and every computer agrees on it. */
export function randomIntervalRunAt(schedule: RoutineIntervalSchedule, slot: number): number {
  const minutes = Math.floor(randomSpanMs(schedule, slot) / 60_000);
  let hash = 2166136261;
  for (const char of `${schedule.anchorAt}:${slot}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return slot + ((hash >>> 0) % minutes) * 60_000;
}

function slotAtOrBefore(schedule: RoutineIntervalSchedule, at: number): number {
  const intervalMs = schedule.everyMinutes * 60_000;
  return schedule.anchorAt + Math.floor((at - schedule.anchorAt) / intervalMs) * intervalMs;
}

export function nextRandomIntervalRun(schedule: RoutineIntervalSchedule, after: number): number | null {
  const intervalMs = schedule.everyMinutes * 60_000;
  let slot = schedule.anchorAt > after ? schedule.anchorAt : slotAtOrBefore(schedule, after);
  const maxSlots = Math.ceil(INTERVAL_RESTRICTION_SEARCH_MS / intervalMs) + 2;
  for (let checked = 0; checked < maxSlots; checked++) {
    if (schedule.endsAt !== undefined && slot > schedule.endsAt) return null;
    if (slotAllowed(schedule, slot)) {
      const run = randomIntervalRunAt(schedule, slot);
      if (run > after) return schedule.endsAt !== undefined && run > schedule.endsAt ? null : run;
    }
    slot += intervalMs;
    if (!Number.isSafeInteger(slot) || slot > MAX_DATE_MS) return null;
  }
  return null;
}

function latestRandomIntervalRun(schedule: RoutineIntervalSchedule, at: number): number | null {
  const intervalMs = schedule.everyMinutes * 60_000;
  const ceiling = Math.min(at, schedule.endsAt ?? at);
  if (schedule.anchorAt > ceiling) return null;
  let slot = slotAtOrBefore(schedule, ceiling);
  const maxSlots = Math.ceil(INTERVAL_RESTRICTION_SEARCH_MS / intervalMs) + 2;
  for (let checked = 0; checked < maxSlots && slot >= schedule.anchorAt; checked++) {
    if (slotAllowed(schedule, slot)) {
      const run = randomIntervalRunAt(schedule, slot);
      if (run <= ceiling) return run;
    }
    slot -= intervalMs;
  }
  return null;
}
