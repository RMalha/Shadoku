// GET    /api/community/<id>  →  { puzzle: case JSON, meta: list row, myRating }   (anyone; myRating 0 when not signed in or not rated)
// DELETE /api/community/<id>  →  { ok }   the author takes the puzzle down (its ratings and plays go with it)
// Signed in: the site's session cookie, or the Android app's bearer token from the app's origin (functions/_lib/caller.js; not a guest).
import { json } from "../../_lib/auth.js";
import { caller, visitor } from "../../_lib/caller.js";
import { db, noStorage } from "../../_lib/db.js";
import { listRow, ID_RE, SELECT_ROW } from "../../_lib/community.js";

export async function onRequestGet({ request, env, params }) {
  if (!ID_RE.test(params.id)) return json({ error: "not_found" }, 404);
  const d = await db(env);
  if (!d) return noStorage();
  const r = await d.prepare(`${SELECT_ROW} WHERE puzzles.id = ?1`).bind(params.id).first();
  if (!r) return json({ error: "not_found" }, 404);
  const s = await visitor(request, env);
  const mine = s ? await d.prepare("SELECT stars FROM ratings WHERE puzzle_id = ?1 AND user_id = ?2").bind(params.id, s.id).first() : null;
  return json({ puzzle: JSON.parse(r.data), meta: listRow(r, s && s.id), myRating: mine ? mine.stars : 0 });
}

export async function onRequestDelete({ request, env, params }) {
  const who = await caller(request, env, { write: true });
  if (who.error) return who.error;
  const { s } = who;
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
