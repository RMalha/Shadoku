// GET  /api/community?size=7&sort=stars|plays|difficulty|new&order=asc|desc  →  { puzzles: [list row] }   (anyone; no case data)
// POST /api/community { puzzle, difficulty }  →  { id }   publish (signed-in players; the case must pass src/creatorCore.js checkCase)
import { readSession, getRecord, json, sameOrigin } from "../../_lib/auth.js";
import { db, noStorage, readBody, shownAvatar } from "../../_lib/db.js";
import { cleanCase, listRow, newId, DIFF_RANK, MAX_CASE_BYTES, MAX_PER_AUTHOR, SELECT_LIST } from "../../_lib/community.js";

const SORTS = {
  stars: "(CASE WHEN rating_count = 0 THEN 0 ELSE 1.0 * rating_sum / rating_count END) {o}, rating_count {o}, created DESC",
  plays: "plays {o}, created DESC",
  difficulty: "diff_rank {o}, created DESC",
  new: "created {o}",
};

export async function onRequestGet({ request, env }) {
  const d = await db(env);
  if (!d) return noStorage();
  const url = new URL(request.url);
  const size = parseInt(url.searchParams.get("size") || "", 10);
  const sort = SORTS[url.searchParams.get("sort")] ? url.searchParams.get("sort") : "new";
  const order = url.searchParams.get("order") === "asc" ? "ASC" : "DESC";
  const where = size >= 5 && size <= 10 ? `WHERE size = ${size}` : "";
  const s = await readSession(request, env).catch(() => null);
  const rows = (await d.prepare(`${SELECT_LIST} ${where} ORDER BY ${SORTS[sort].replace(/\{o\}/g, order)} LIMIT 500`).all()).results;
  return json({ puzzles: rows.map((r) => listRow(r, s && s.id)) });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request, env)) return json({ error: "origin" }, 403);
  const s = await readSession(request, env);
  if (!s) return json({ error: "auth" }, 401);
  const d = await db(env);
  if (!d) return noStorage();
  const body = await readBody(request, MAX_CASE_BYTES);
  if (!body || !body.puzzle) return json({ error: "format" }, 400);
  const mine = await d.prepare("SELECT COUNT(*) AS n FROM puzzles WHERE author_id = ?1").bind(s.id).first();
  if (mine.n >= MAX_PER_AUTHOR) return json({ error: "limit", max: MAX_PER_AUTHOR }, 429);
  const id = newId();
  const { data, problems } = cleanCase(body.puzzle, id, body.difficulty);
  if (!data) return json({ error: "invalid", problems: problems.slice(0, 8) }, 422);
  const rec = await getRecord(env, s.id), author = rec.username || "Agent";
  await d.prepare(`INSERT INTO puzzles (id, author_id, author, author_avatar, title, theme, size, difficulty, diff_rank, suspects, data, created)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`)
    .bind(id, s.id, author, shownAvatar(rec.avatar, s), data.title, data.theme, data.size, data.difficulty, DIFF_RANK[data.difficulty], data.suspects.length, JSON.stringify(data), Date.now()).run();
  return json({ id }, 201);
}
