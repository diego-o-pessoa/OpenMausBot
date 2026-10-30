// Turn timestamps come from the server's clock. A Windows machine whose clock runs minutes off would show
// "Thinking 7m" for a turn that just started, so timers measure "now" on the server's clock instead.

const SAMPLES = 5;
/** The Date header only has whole seconds: a smaller gap is rounding, not a wrong clock. */
const IGNORED_SKEW_MS = 2_000;

const samples: number[] = [];
let offset = 0;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Records the server's `Date` header from a reply to a request sent at `sentAt` and answered at `receivedAt`. */
export function noteServerDate(header: string | null, sentAt: number, receivedAt: number): void {
  const server = header ? Date.parse(header) : NaN;
  if (!Number.isFinite(server) || receivedAt < sentAt) return;
  // The server wrote the header somewhere inside its whole second, and somewhere inside the round trip.
  samples.push(server + 500 - (sentAt + receivedAt) / 2);
  if (samples.length > SAMPLES) samples.shift();
  const skew = median(samples);
  offset = Math.abs(skew) < IGNORED_SKEW_MS ? 0 : skew;
}

/** Now, on the server's clock. */
export function serverNow(): number {
  return Date.now() + offset;
}

export function resetServerClockForTests(): void {
  samples.length = 0;
  offset = 0;
}
