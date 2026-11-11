// PUT /api/community/<id>/rate { stars: 1–5 }  →  { stars, avg, count }   (signed-in players; a new rating replaces the old one; not your own puzzle)
import { readSession, json, sameOrigin } from "../../../_lib/auth.js";
import { db, noStorage, readBody, recountRatings } from "../../../_lib/db.js";
import { ID_RE } from "../../../_lib/community.js";
import { limit } from "../../../_lib/ratelimit.js";

export async function onRequestPut({ request, env, params }) {
  if (!sameOrigin(request, env)) return json({ error: "origin" }, 403);
  const s = await readSession(request, env);
  if (!s) return json({ error: "auth" }, 401);
  const blocked = await limit(env, request, "rate", { max: 60, windowSec: 600, id: s.id });
  if (blocked) return blocked;
  if (!ID_RE.test(params.id)) return json({ error: "not_found" }, 404);
  const d = await db(env);
  if (!d) return noStorage();
  const body = await readBody(request, 1024);
  const stars = body && Number.isInteger(body.stars) ? body.stars : 0;
  if (stars < 1 || stars > 5) return json({ error: "format" }, 400);
  const p = await d.prepare("SELECT author_id FROM puzzles WHERE id = ?1").bind(params.id).first();
  if (!p) return json({ error: "not_found" }, 404);
  if (p.author_id === s.id) return json({ error: "own" }, 403);
  await d.batch([
    d.prepare("INSERT INTO ratings (puzzle_id, user_id, stars) VALUES (?1, ?2, ?3) ON CONFLICT (puzzle_id, user_id) DO UPDATE SET stars = ?3").bind(params.id, s.id, stars),
    recountRatings(d, params.id),
  ]);
  const r = await d.prepare("SELECT rating_sum, rating_count FROM puzzles WHERE id = ?1").bind(params.id).first();
  return json({ stars, avg: r.rating_count ? Math.round((r.rating_sum / r.rating_count) * 10) / 10 : 0, count: r.rating_count });
}
