/**
 * A routine's watch: a cheap, model-free check run before each scheduled occurrence. The occurrence only starts
 * a run when what the watch sees changed since the last run it started.
 */
import type { RoutineWatch } from "../shared/routines.ts";

// TomTicket API v2.0 (https://tomticket.tomticket.com/kb/api): Bearer token, 3 requests/second. A ticket's
// situation.apply_date "is updated when the ticket is created, answered or finished", so sorting by it puts
// every newly answered ticket on the first page.
const TOMTICKET_LIST = "https://api.tomticket.com/v2.0/ticket/list";
const TOMTICKET_RESERVED = new Set(["column", "order", "page"]);
const FINGERPRINT_TICKETS = 20;
const WATCH_TIMEOUT_MS = 15_000;

interface TomTicketListItem {
  id?: unknown;
  situation?: { id?: unknown; apply_date?: unknown } | null;
}

export function tomticketListUrl(query: string | undefined): string {
  const params = new URLSearchParams({ column: "situation.apply_date", order: "DESC" });
  for (const [key, value] of new URLSearchParams(query ?? "")) {
    if (!TOMTICKET_RESERVED.has(key)) params.append(key, value);
  }
  return `${TOMTICKET_LIST}?${params}`;
}

/** The latest activity on the watched tickets, as one comparable string. Throws when the API cannot be read. */
export async function tomticketFingerprint(
  token: string,
  query: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(tomticketListUrl(query), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(WATCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`TomTicket answered HTTP ${response.status}`);
  const body = await response.json() as { error?: unknown; message?: unknown; data?: unknown };
  if (body.error) throw new Error(`TomTicket refused the check: ${String(body.message ?? "unknown error")}`);
  const tickets = Array.isArray(body.data) ? body.data as TomTicketListItem[] : [];
  return tickets
    .slice(0, FINGERPRINT_TICKETS)
    .map((ticket) => [ticket.id, ticket.situation?.id, ticket.situation?.apply_date].map((part) => String(part ?? "")).join("|"))
    .join("\n");
}

/** Null when the watch cannot run here (no token); the occurrence then runs as if nothing were watched. */
export function routineWatchChecker(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch) {
  return async (watch: RoutineWatch): Promise<string | null> => {
    if (watch.kind !== "tomticket") return null;
    const token = env.OMB_TOMTICKET_TOKEN?.trim();
    if (!token) return null;
    return tomticketFingerprint(token, watch.query, fetchImpl);
  };
}
