/**
 * Rate limiting for the write endpoints: a fixed window per key, counted in D1 (table `rate_limits`, created with the others in db.js).
 * D1 is consistent, so a burst from one account or address cannot slip past the way it could with KV.
 *
 *   const blocked = await limit(env, request, "play", { max: 60, windowSec: 600, id: session?.id });
 *   if (blocked) return blocked;
 *
 * The key is the signed-in account id, else a hash of the client address (salted with SESSION_SECRET and kept for at most an hour:
 * no raw address is stored). Without the D1 binding it lets everything through: the endpoints that need D1 answer 503 anyway.
 * This is a second line behind Cloudflare's own rate-limiting rules (docs/ops/runbook.md), not a replacement.
 */
import { json, sha256b64u } from "./auth.js";
import { db } from "./db.js";

/** Window rows older than this are removed (about one call in fifty does it). */
const KEEP_SEC = 3600;

/** → { n, retry } for this key and window, counting this call. `now` is injectable for tests. */
export async function hit(d, key, windowSec, now = Date.now()) {
  const w = Math.floor(now / 1000 / windowSec);
  const end = (w + 1) * windowSec;
  const row = await d.prepare("INSERT INTO rate_limits (k, w, n, until) VALUES (?1, ?2, 1, ?3) ON CONFLICT (k, w) DO UPDATE SET n = n + 1 RETURNING n").bind(key, w, end).first();
  return { n: row ? row.n : 1, retry: Math.max(1, end - Math.floor(now / 1000)) };
}

const clientKey = async (request, env, id) => {
  if (id) return `u:${id}`;
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  return `ip:${(await sha256b64u(`${env.SESSION_SECRET || ""}|${ip}`)).slice(0, 22)}`;
};

/**
 * → a 429 Response when `name` was called more than `max` times in the window by this account (`id`) or address, else null.
 * A failure of the limiter itself never blocks the request.
 */
export async function limit(env, request, name, { max, windowSec, id = "" }) {
  try {
    const d = await db(env);
    if (!d) return null;
    const { n, retry } = await hit(d, `${name}:${await clientKey(request, env, id)}`, windowSec);
    if (Math.random() < 0.02) await d.prepare("DELETE FROM rate_limits WHERE until < ?1").bind(Math.floor(Date.now() / 1000) - KEEP_SEC).run().catch(() => {});
    if (n <= max) return null;
    const res = json({ error: "rate_limited", retry }, 429);
    res.headers.set("Retry-After", String(retry));
    return res;
  } catch (e) {
    console.error(JSON.stringify({ at: "ratelimit", name, error: String((e && e.message) || e) }));
    return null;
  }
}
