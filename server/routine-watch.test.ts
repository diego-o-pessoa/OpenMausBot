import { describe, expect, it } from "vitest";

import { routineWatchChecker, tomticketFingerprint, tomticketListUrl } from "./routine-watch.ts";

const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("tomticketListUrl", () => {
  it("sorts by the latest answer and keeps the routine's own filters", () => {
    const url = new URL(tomticketListUrl("customer_type_id=E&customer_id=a@b.c&order=ASC&page=3"));
    expect(url.origin + url.pathname).toBe("https://api.tomticket.com/v2.0/ticket/list");
    expect(url.searchParams.get("column")).toBe("situation.apply_date");
    expect(url.searchParams.get("order")).toBe("DESC");
    expect(url.searchParams.get("page")).toBeNull();
    expect(url.searchParams.get("customer_id")).toBe("a@b.c");
  });
});

describe("tomticketFingerprint", () => {
  const ticket = (id: string, situation: number, at: string) => ({ id, situation: { id: situation, apply_date: at }, sla: Math.random() });

  it("changes when a ticket is answered and ignores fields that drift between reads", async () => {
    const before = await tomticketFingerprint("t", undefined, respond({ error: false, data: [ticket("a", 2, "10:00")] }));
    const again = await tomticketFingerprint("t", undefined, respond({ error: false, data: [ticket("a", 2, "10:00")] }));
    const answered = await tomticketFingerprint("t", undefined, respond({ error: false, data: [ticket("a", 3, "10:07")] }));
    expect(again).toBe(before);
    expect(answered).not.toBe(before);
  });

  it("refuses an HTTP error or an error body instead of reporting no change", async () => {
    await expect(tomticketFingerprint("t", undefined, respond({}, 429))).rejects.toThrow("HTTP 429");
    await expect(tomticketFingerprint("t", undefined, respond({ error: true, message: "Invalid token." }))).rejects.toThrow("Invalid token.");
  });

  it("sends the token as a bearer header", async () => {
    let auth: string | null = null;
    const capture = (async (_url: string, init: RequestInit) => {
      auth = new Headers(init.headers).get("authorization");
      return new Response(JSON.stringify({ error: false, data: [] }));
    }) as unknown as typeof fetch;
    await tomticketFingerprint("secret", undefined, capture);
    expect(auth).toBe("Bearer secret");
  });
});

describe("routineWatchChecker", () => {
  it("lets the routine run unwatched when no token is configured", async () => {
    await expect(routineWatchChecker(() => undefined, respond({ error: false, data: [] }))({ kind: "tomticket" })).resolves.toBeNull();
  });

  it("reads the token saved in Settings at check time", async () => {
    await expect(routineWatchChecker(() => "t", respond({ error: false, data: [] }))({ kind: "tomticket" })).resolves.toBe("");
  });
});
