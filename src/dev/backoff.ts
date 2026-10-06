export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** 0..1; injectable so tests are deterministic. */
  random?: () => number;
}

/** Exponential backoff with full jitter on the upper half: attempt 0 waits about baseMs. */
export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? 1000;
  const max = options.maxMs ?? 30_000;
  const random = options.random ?? Math.random;
  const ceiling = Math.min(max, base * 2 ** Math.max(0, attempt));
  return Math.round(ceiling / 2 + (ceiling / 2) * random());
}
