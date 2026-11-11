// POST /api/community/<id>/play { player, solved }  →  { plays, solves }
// Counts each player once per puzzle: the account when signed in, else the browser's random id ("player", kept in its storage).
// `solved: true` (sent when the contract is fulfilled) also counts the player among its solvers, once.
import { readSession, json, sameOrigin } from "../../../_lib/auth.js";
import { db, noStorage, readBody } from "../../../_lib/db.js";
import { ID_RE } from "../../../_lib/community.js";
import { limit } from "../../../_lib/ratelimit.js";

const ANON_RE = /^[A-Za-z0-9_-]{16,48}$/;

export async function onRequestPost({ request, env, params }) {
  if (!sameOrigin(request, env)) return json({ error: "origin" }, 403);
  if (!ID_RE.test(params.id)) return json({ error: "not_found" }, 404);
  const d = await db(env);
  if (!d) return noStorage();
  const body = (await readBody(request, 1024)) || {};
  const s = await readSession(request, env).catch(() => null);
  const blocked = await limit(env, request, "play", { max: 60, windowSec: 600, id: s ? s.id : "" });
  if (blocked) return blocked;
  const player = s ? s.id : ANON_RE.test(body.player || "") ? `anon:${body.player}` : "";
  if (!player) return json({ error: "format" }, 400);
  if (!(await d.prepare("SELECT 1 AS ok FROM puzzles WHERE id = ?1").bind(params.id).first())) return json({ error: "not_found" }, 404);
  const added = await d.prepare("INSERT OR IGNORE INTO plays (puzzle_id, player) VALUES (?1, ?2)").bind(params.id, player).run();
  if (added.meta.changes) await d.prepare("UPDATE puzzles SET plays = plays + 1 WHERE id = ?1").bind(params.id).run();
  if (body.solved === true) {
    const won = await d.prepare("UPDATE plays SET solved = 1 WHERE puzzle_id = ?1 AND player = ?2 AND solved = 0").bind(params.id, player).run();
    if (won.meta.changes) await d.prepare("UPDATE puzzles SET solves = solves + 1 WHERE id = ?1").bind(params.id).run();
  }
  const r = await d.prepare("SELECT plays, solves FROM puzzles WHERE id = ?1").bind(params.id).first();
  return json({ plays: r.plays, solves: r.solves });
}
