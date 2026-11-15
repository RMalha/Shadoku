// GET /api/progress             →  { progress: {…} | null, account, since, now }   the account's saved game progress (signed-in players only);
//                                    `account` its id, `since` when it started (accountSince: a deleted account made again), `now` the server's clock:
//                                    the browser asks before adding progress it kept from before `since` or for another account (src/sync.js)
// PUT /api/progress { progress } →  { ok }                     replaces it (the browser merged its own progress in first: src/sync.js)
// Without a KV namespace there is nowhere to keep it: GET answers null and PUT 503, and the game stays local.
// Signed in: the site's session cookie, or the Android app's bearer token from the app's origin (functions/_lib/caller.js; not a guest).
import { getProgress, setProgress, accountSince, json } from "../_lib/auth.js";
import { caller } from "../_lib/caller.js";
import { limit } from "../_lib/ratelimit.js";

// Not a budget for play: a safety ceiling. A board with notes is about 1 KB, so this is some four thousand of them, and the store
// itself (KV) refuses a value past 25 MB. (Until 2026-11-14 it was 256 KB, which a year of dailies with notes passed.)
const MAX_BYTES = 4 * 1024 * 1024;

export async function onRequestGet({ request, env }) {
  const who = await caller(request, env);
  if (who.error) return who.error;
  const { s } = who;
  const [progress, since] = await Promise.all([getProgress(env, s.id), accountSince(env, s.id)]);
  return json({ progress, account: s.id, since, now: Date.now() });
}

export async function onRequestPut({ request, env }) {
  const who = await caller(request, env, { write: true });
  if (who.error) return who.error;
  const { s } = who;
  const blocked = await limit(env, request, "progress", { max: 120, windowSec: 600, id: s.id });
  if (blocked) return blocked;
  if (!env.SHADOKU_KV) return json({ error: "storage" }, 503);
  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ error: "size" }, 413);
  let progress;
  try { ({ progress } = JSON.parse(text)); } catch { return json({ error: "format" }, 400); }
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return json({ error: "format" }, 400);
  await setProgress(env, s.id, progress);
  return json({ ok: true });
}
