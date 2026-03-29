/**
 * Lightweight in-memory rate limiter for Vercel Serverless Functions.
 * Uses a sliding-window counter per IP. Each serverless instance has its own
 * counter map, so this is "best-effort" — not a global distributed limit.
 * Good enough to stop casual abuse; for production-grade limits, use Upstash Redis.
 */

const store = new Map();
const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanup(windowMs) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now - entry.start > windowMs * 2) store.delete(key);
  }
}

/**
 * @param {object} req - Vercel request
 * @param {object} res - Vercel response
 * @param {object} opts
 * @param {number} opts.max     - Max requests per window (default 30)
 * @param {number} opts.windowMs - Window in ms (default 60_000 = 1 min)
 * @returns {boolean} true if rate-limited (response already sent), false if OK
 */
function rateLimit(req, res, { max = 30, windowMs = 60_000 } = {}) {
  cleanup(windowMs);

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  const now = Date.now();
  let entry = store.get(ip);

  if (!entry || now - entry.start > windowMs) {
    entry = { count: 0, start: now };
    store.set(ip, entry);
  }

  entry.count += 1;

  if (entry.count > max) {
    res.setHeader("Retry-After", String(Math.ceil((entry.start + windowMs - now) / 1000)));
    res.status(429).json({ error: "Too many requests" });
    return true;
  }

  return false;
}

module.exports = { rateLimit };
