import { afterEach, describe, expect, it, vi } from "vitest";
import { noteServerDate, resetServerClockForTests, serverNow } from "./server-clock";

afterEach(() => {
  resetServerClockForTests();
  vi.useRealTimers();
});

describe("server clock", () => {
  it("measures time on the server's clock when this computer's clock runs minutes off", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-30T12:07:00.000Z")); // this computer is 7 minutes ahead
    const server = new Date("2026-10-30T12:00:00.000Z").toUTCString();
    noteServerDate(server, Date.now() - 100, Date.now());
    expect(Math.abs(serverNow() - Date.parse("2026-10-30T12:00:00.500Z"))).toBeLessThan(200);
  });

  it("leaves a clock that is right alone, and ignores a missing or broken header", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-30T12:00:00.300Z"));
    noteServerDate(new Date("2026-10-30T12:00:00.000Z").toUTCString(), Date.now() - 50, Date.now());
    noteServerDate(null, Date.now(), Date.now());
    noteServerDate("not a date", Date.now(), Date.now());
    expect(serverNow()).toBe(Date.now());
  });

  it("follows most replies, not a single slow one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-30T12:10:00.000Z"));
    const at = (iso: string) => new Date(iso).toUTCString();
    for (let i = 0; i < 4; i++) noteServerDate(at("2026-10-30T12:00:00.000Z"), Date.now() - 20, Date.now());
    noteServerDate(at("2026-10-30T11:00:00.000Z"), Date.now() - 20, Date.now());
    expect(Math.abs(serverNow() - Date.parse("2026-10-30T12:00:00.500Z"))).toBeLessThan(200);
  });
});
