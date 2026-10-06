/** Exponential backoff with full jitter on the upper half: attempt 0 waits about baseMs. */
export function backoffDelay(attempt, options = {}) {
    const base = options.baseMs ?? 1000;
    const max = options.maxMs ?? 30_000;
    const random = options.random ?? Math.random;
    const ceiling = Math.min(max, base * 2 ** Math.max(0, attempt));
    return Math.round(ceiling / 2 + (ceiling / 2) * random());
}
