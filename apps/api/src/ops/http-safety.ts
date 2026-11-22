/**
 * Small HTTP safety helpers for the API (Master Plan section 8, "security pass").
 */

const REDACTED = '[redacted]';

/**
 * The callback key is part of every Applink callback URL and is the only thing that keeps those
 * routes private until Applink's IP list is enforced. It must never reach a log line.
 */
export function redactCallbackKey(url: string, key: string | undefined): string {
  if (!key) return url;
  return url.split(`/api/applink/${key}/`).join(`/api/applink/${REDACTED}/`);
}

/**
 * Sliding-window counter per key, in process. One API instance serves this VM, so a store is not
 * needed, and a request must not cost a database round trip just to be counted.
 */
export function createIpLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  let lastSweep = now();

  return {
    /** True if this request is allowed. */
    hit(key: string): boolean {
      const t = now();
      if (t - lastSweep > windowMs) {
        // Forget idle keys so the map cannot grow without bound.
        for (const [k, list] of hits) {
          if ((list[list.length - 1] ?? 0) <= t - windowMs) hits.delete(k);
        }
        lastSweep = t;
      }
      const recent = (hits.get(key) ?? []).filter((x) => x > t - windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      return true;
    },
  };
}
