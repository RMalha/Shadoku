// GET /api/ranking            →  { players: [{ rank, codename, avatar, solved, hints, speed, seconds, score, me }], me, total }   (signed-in players only)
// PUT /api/ranking { entries } →  { ok, stats }   the player's fulfilled contracts ([{ c, d, t, l, k, p, n }], src/ranking.js); the score is computed here,
//                                                  without the contracts a reset excluded (afterReset below)
// The browser sends its entries after every progress sync (src/community.js). Players without a codename yet show as "Agent".
import { readSession, getRecord, json, sameOrigin } from "../_lib/auth.js";
import { db, noStorage, readBody, shownAvatar } from "../_lib/db.js";
import { rankStats, entryId } from "../../src/ranking.js";

const TOP = 100;
const row = (r, me) => ({ rank: r.rank, codename: r.codename, avatar: r.avatar, solved: r.solved, hints: r.hints, speed: r.speed, seconds: r.seconds, score: r.score, me: r.id === me });

export async function onRequestGet({ request, env }) {
  const s = await readSession(request, env);
  if (!s) return json({ error: "auth" }, 401);
  const d = await db(env);
  if (!d) return noStorage();
  const order = "ORDER BY score DESC, solved DESC, seconds ASC, updated ASC";
  const top = (await d.prepare(`SELECT *, ROW_NUMBER() OVER (${order}) AS rank FROM players ${order} LIMIT ${TOP}`).all()).results;
  const total = (await d.prepare("SELECT COUNT(*) AS n FROM players").first()).n;
  let mine = top.find((r) => r.id === s.id) || null;
  if (!mine) {
    const r = await d.prepare("SELECT * FROM players WHERE id = ?1").bind(s.id).first();
    if (r) {
      const ahead = await d.prepare("SELECT COUNT(*) AS n FROM players WHERE score > ?1 OR (score = ?1 AND (solved > ?2 OR (solved = ?2 AND (seconds < ?3 OR (seconds = ?3 AND updated < ?4)))))")
        .bind(r.score, r.solved, r.seconds, r.updated).first();
      mine = { ...r, rank: ahead.n + 1 };
    }
  }
  return json({ players: top.map((r) => row(r, s.id)), me: mine ? row(mine, s.id) : null, total });
}

export async function onRequestPut({ request, env }) {
  if (!sameOrigin(request, env)) return json({ error: "origin" }, 403);
  const s = await readSession(request, env);
  if (!s) return json({ error: "auth" }, 401);
  const d = await db(env);
  if (!d) return noStorage();
  const body = await readBody(request, 200 * 1024);
  if (!body || !Array.isArray(body.entries)) return json({ error: "format" }, 400);
  const { entries, reset, excluded } = afterReset(body.entries, await d.prepare("SELECT reset, excluded FROM players WHERE id = ?1").bind(s.id).first());
  const st = rankStats(entries);
  const rec = await getRecord(env, s.id), codename = rec.username || "Agent";
  await d.prepare(`INSERT INTO players (id, codename, avatar, solved, hints, seconds, speed, score, updated, reset, excluded) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    ON CONFLICT (id) DO UPDATE SET codename = ?2, avatar = ?3, solved = ?4, hints = ?5, seconds = ?6, speed = ?7, score = ?8, reset = ?10, excluded = ?11,
    updated = CASE WHEN players.score = ?8 AND players.solved = ?4 AND players.seconds = ?6 THEN players.updated ELSE ?9 END`)
    .bind(s.id, codename, shownAvatar(rec.avatar, s), st.solved, st.hints, st.seconds, st.speed, st.score, Date.now(), reset, JSON.stringify(excluded)).run();
  return json({ ok: true, stats: st });
}

/**
 * The entries that count for a player's row ({ reset, excluded }, or null for a new player) → { entries, reset, excluded }.
 * After a reset (tools/reset_ranking.py sets `reset` = 1 and zeroes the numbers), the first sync whose entries carry contract ids
 * adds every contract fulfilled so far to `excluded`: they never count again, so the player starts over from zero.
 * A player who was ever reset scores only entries with an id (a page from before the ids cannot say which contracts they are).
 */
export function afterReset(sent, prev) {
  let excluded = [];
  try { const v = JSON.parse((prev && prev.excluded) || "[]"); if (Array.isArray(v)) excluded = v.filter((x) => typeof x === "string"); } catch { /* keep [] */ }
  let reset = prev && prev.reset ? 1 : 0;
  const ids = sent.map(entryId).filter(Boolean);
  if (reset && ids.length) { excluded = [...new Set([...excluded, ...ids])]; reset = 0; }
  if (!reset && !excluded.length) return { entries: sent, reset, excluded };
  const out = new Set(excluded);
  return { entries: sent.filter((e) => { const id = entryId(e); return id && !out.has(id); }), reset, excluded };
}
