// GET    /api/community/<id>  →  { puzzle: case JSON, meta: list row, myRating }   (anyone; myRating 0 when not signed in or not rated)
// DELETE /api/community/<id>  →  { ok }   the author takes the puzzle down (its ratings and plays go with it)
import { readSession, json, sameOrigin } from "../../_lib/auth.js";
import { db, noStorage } from "../../_lib/db.js";
import { listRow, ID_RE, SELECT_ROW } from "../../_lib/community.js";

export async function onRequestGet({ request, env, params }) {
  if (!ID_RE.test(params.id)) return json({ error: "not_found" }, 404);
  const d = await db(env);
  if (!d) return noStorage();
  const r = await d.prepare(`${SELECT_ROW} WHERE puzzles.id = ?1`).bind(params.id).first();
  if (!r) return json({ error: "not_found" }, 404);
  const s = await readSession(request, env).catch(() => null);
  const mine = s ? await d.prepare("SELECT stars FROM ratings WHERE puzzle_id = ?1 AND user_id = ?2").bind(params.id, s.id).first() : null;
  return json({ puzzle: JSON.parse(r.data), meta: listRow(r, s && s.id), myRating: mine ? mine.stars : 0 });
}

export async function onRequestDelete({ request, env, params }) {
  if (!sameOrigin(request, env)) return json({ error: "origin" }, 403);
  const s = await readSession(request, env);
  if (!s) return json({ error: "auth" }, 401);
  if (!ID_RE.test(params.id)) return json({ error: "not_found" }, 404);
  const d = await db(env);
  if (!d) return noStorage();
  const r = await d.prepare("SELECT author_id FROM puzzles WHERE id = ?1").bind(params.id).first();
  if (!r) return json({ error: "not_found" }, 404);
  if (r.author_id !== s.id) return json({ error: "forbidden" }, 403);
  await d.batch([
    d.prepare("DELETE FROM ratings WHERE puzzle_id = ?1").bind(params.id),
    d.prepare("DELETE FROM plays WHERE puzzle_id = ?1").bind(params.id),
    d.prepare("DELETE FROM puzzles WHERE id = ?1").bind(params.id),
  ]);
  return json({ ok: true });
}
