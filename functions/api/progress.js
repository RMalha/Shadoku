// GET /api/progress             →  { progress: {…} | null, account, since, now }   the account's saved game progress (signed-in players only);
//                                    `account` its id, `since` when it started (accountSince: a deleted account made again), `now` the server's clock:
//                                    the browser asks before adding progress it kept from before `since` or for another account (src/sync.js)
// PUT /api/progress { progress } →  { ok }                     replaces it (the browser merged its own progress in first: src/sync.js)
// Without a KV namespace there is nowhere to keep it: GET answers null and PUT 503, and the game stays local.
import { readSession, getProgress, setProgress, accountSince, json, sameOrigin } from "../_lib/auth.js";

const MAX_BYTES = 256 * 1024; // a full pack of boards is a few KB

export async function onRequestGet({ request, env }) {
  const s = await readSession(request, env);
  if (!s) return json({ error: "auth" }, 401);
  const [progress, since] = await Promise.all([getProgress(env, s.id), accountSince(env, s.id)]);
  return json({ progress, account: s.id, since, now: Date.now() });
}

export async function onRequestPut({ request, env }) {
  if (!sameOrigin(request, env)) return json({ error: "origin" }, 403);
  const s = await readSession(request, env);
  if (!s) return json({ error: "auth" }, 401);
  if (!env.SHADOKU_KV) return json({ error: "storage" }, 503);
  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ error: "size" }, 413);
  let progress;
  try { ({ progress } = JSON.parse(text)); } catch { return json({ error: "format" }, 400); }
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return json({ error: "format" }, 400);
  await setProgress(env, s.id, progress);
  return json({ ok: true });
}
