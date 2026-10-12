// Small helpers for reading untrusted request data and writing safe async routes.

// Always returns a string, never an array or object, and caps its length.
export function str(v, max = 200, { trim = true } = {}) {
  const s = typeof v === 'string' ? v : '';
  return (trim ? s.trim() : s).slice(0, max);
}

// Express 4 does not catch rejected promises from async handlers; forward them to the error middleware.
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sliding-window limiter. Counts failures per key, can be reset on success, and prunes stale keys.
export function createLimiter({ max, windowMs }) {
  const hits = new Map();
  const recent = (key, now) => (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  let lastPrune = 0;
  const limiter = {
    prune(now = Date.now()) {
      for (const [k, v] of hits) {
        const r = v.filter((t) => now - t < windowMs);
        r.length ? hits.set(k, r) : hits.delete(k);
      }
      lastPrune = now;
    },
    allowed(key) {
      const now = Date.now();
      if (now - lastPrune > 60e3) limiter.prune(now);
      return recent(key, now).length < max;
    },
    hit(key) {
      const now = Date.now();
      hits.set(key, [...recent(key, now), now]);
    },
    fail(key) { limiter.hit(key); },
    reset(key) { hits.delete(key); },
    get size() { return hits.size; },
  };
  return limiter;
}
