/**
 * A per-key cap on how many things were handed out inside a rolling window.
 *
 * Used by the intake upload route to bound the signed upload URLs it MINTS.
 *
 * ⚠️ WHY A SEPARATE COUNTER AT ALL: the route also caps on objects that have
 * LANDED in the bucket, and that count cannot see this endpoint's own output —
 * it returns a URL, and the object appears only when the client PUTs to it. So a
 * burst of calls that upload nothing saw an empty folder every time and was
 * never refused, walking away with one single-use 30MB write URL per call, on a
 * 1GB storage tier.
 *
 * ⚠️ BEST-EFFORT, STATED PLAINLY: the state lives in the process, so on
 * serverless it is per-instance and resets on a cold start — several instances
 * mean several allowances. It bounds the common case and raises the bar; it is
 * not a guarantee. A durable version needs storage the instances share.
 */
export function makeMintCap(max: number, windowMs: number, now: () => number = Date.now) {
  const seen = new Map<string, number[]>();
  return {
    /** True when `key` is over its allowance — and otherwise records this mint. */
    exceeded(key: string): boolean {
      const since = now() - windowMs;
      const fresh = (seen.get(key) ?? []).filter((t) => t >= since);
      // Prune while we are here, so an idle process does not hold every key for ever.
      if (fresh.length) seen.set(key, fresh);
      else seen.delete(key);
      if (fresh.length >= max) return true;
      fresh.push(now());
      seen.set(key, fresh);
      return false;
    },
    /** Keys currently being tracked — for the test, and for a health probe. */
    size(): number {
      return seen.size;
    },
  };
}
