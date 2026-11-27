/**
 * The live 1v1 (architecture 4.20; the author's rules: product_brief.md "1v1, redesigned (author, 2026-11-25)"; tables:
 * migrations/0008_app_duel.sql; the rules as plain functions: duel_rules.js). Endpoints: functions/api/app/duel/**.
 *
 * THE MATCH IS THE SERVER'S. It holds the three boards and their answers, both clocks, the 3-minute limit, the 10-second
 * countdown, who finished first and, at a timeout, how many scapegoats each player had right. The phone sends placements
 * ("A on r3c2", "A off the board"), never a result, and reads the state back about once a second (GET /api/app/duel). No
 * answer of this module says whether a placement is right: a board is "finished" when every piece is, and the counts are
 * told when it is over. A duel board's case reaches the phone without its answer, walkthrough or hints.
 *
 * NOTHING RUNS BETWEEN REQUESTS. Pages Functions have no timers, so a match is rows plus the clock: every deadline is a time
 * in a row, and whoever asks next (either player, or the nightly sweep) first brings the match up to now (`advance`): a board
 * someone finished is closed, a board past its 3 minutes is decided on placements, the next board gets its start, the match
 * its result and the ratings their change. A bot needs no process either: its plan for each board (a recording of another
 * player, or the case's walkthrough at a pace) is fixed when the match is made, so where the bot stands at any moment, and
 * when it finishes, is read off the plan.
 *
 * ONE WRITER AT A TIME. Two requests can bring the same match up to date at once. Every change is one db.batch() whose
 * first statement only succeeds on the state it was computed from (the board still open, both players' event numbers as
 * read) and stamps a fresh `op`; everything after it in the batch is tied to that stamp. The loser of a race writes
 * nothing, reads again and finds the work done. So a board ends once, a match ends once, and a rating moves once.
 *
 * Signed-in accounts only (architecture 5: a guest cannot play 1v1): a guest gets 403 "signin_required".
 * Until migration 0008 is applied every function here answers 503 "schema".
 */
import { getRecord } from "../auth.js";
import { db } from "../db.js";
import { newOp, wrote } from "./ledger.js";
import { flag } from "./context.js";
import { parseConfig } from "./economy.js";
import { DUEL, mayMeet, kFor, eloDelta, place, fold, correctCount, isSolved, cellOf, botFromWalk, botFromRecording, botFinishes } from "./duel_rules.js";

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEATS = ["a", "b"];
const seatOf = (m, id) => (m.a === id ? "a" : m.b === id ? "b" : null);
const otherSeat = (seat) => (seat === "a" ? "b" : "a");
const humans = (m) => (m.b === null ? ["a"] : SEATS);
const parse = (text, fallback) => { try { const v = JSON.parse(text); return v === null || v === undefined ? fallback : v; } catch { return fallback; } };
const answer = (status, body) => ({ status, body });
/** What the phone is told about the rules, so no number lives in two places. */
const RULES = Object.freeze({ sizes: DUEL.sizes, limitMs: DUEL.limitMs, countdownMs: DUEL.countdownMs, preloadMs: DUEL.preloadMs, queueMs: DUEL.queueMs, absentMs: DUEL.absentMs });

/** True once migration 0008 is applied (remembered per isolate once it is). */
let seen = false;
async function ready(d) {
  if (seen) return true;
  const row = await d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'duel_invites'").first(); // the migration's last table
  seen = !!row && row.n === 1;
  return seen;
}
/** What every duel call starts with → an error answer, or null. */
async function refused(ctx) {
  if (!(await ready(ctx.d))) return answer(503, { error: "schema" });
  if (ctx.account.kind !== "full") return answer(403, { error: "signin_required" });
  return null;
}

/* ───────────── reading a match ───────────── */
/**
 * Everything one call needs, in one batch of four statements (a free plan allows 50 database queries per call, and this
 * runs up to three times in one): the caller's live match (or, `matchId`: that match of theirs, live or not), its boards
 * with their answers, both players' placements on the board being played, and the caller's own rows: its place in the
 * queue, its rating, its open invitations.
 */
async function load(ctx, matchId = null) {
  const { d, id, now } = ctx;
  const M = matchId ? "(SELECT id FROM duel_matches WHERE id = ?2 AND (a = ?1 OR b = ?1))" : "(SELECT id FROM duel_matches WHERE state = 'live' AND (a = ?1 OR b = ?1) LIMIT 1)";
  const who = matchId ? [id, matchId] : [id];
  const res = await d.batch([
    d.prepare(`SELECT * FROM duel_matches WHERE id = ${M}`).bind(...who),
    d.prepare(`SELECT b.*, p.size, p.solution FROM duel_boards b LEFT JOIN duel_pool p ON p.id = b.board_id WHERE b.match_id = ${M} ORDER BY b.n`).bind(...who),
    d.prepare(`SELECT seat, track, placed, events FROM duel_recordings WHERE match_id = ${M} AND n = (SELECT board FROM duel_matches WHERE id = ${M})`).bind(...who),
    d.prepare(
      `SELECT q.account_id AS waiting, q.invite_id, q.rating AS q_rating, q.joined, q.seen, r.account_id AS rated, r.rating, r.played, r.wins, r.losses, r.draws, r.streak, r.best_streak, r.best_rating,
         (SELECT COUNT(*) FROM duel_invites i WHERE i.to_account = ?1 AND i.state = 'open' AND i.expires > ?2) AS invites
       FROM (SELECT ?1 AS id) me LEFT JOIN duel_queue q ON q.account_id = me.id LEFT JOIN duel_ratings r ON r.account_id = me.id`,
    ).bind(id, now),
  ]);
  const row = res[0].results[0] || null, me = res[3].results[0];
  const match = row ? { ...row, boards: parse(row.boards, []), bot: row.bot ? parse(row.bot, []) : null } : null;
  const recs = {};
  for (const r of res[2].results) recs[r.seat] = { ...r, track: parse(r.track, []) };
  return {
    match, boards: res[1].results, recs,
    pool: new Map(res[1].results.filter((b) => b.size).map((b) => [b.board_id, { size: b.size, solution: parse(b.solution, null) }])),
    queue: me.waiting ? { account_id: id, invite_id: me.invite_id, rating: me.q_rating, joined: me.joined, seen: me.seen } : null,
    rating: me.rated ? me : null, invites: me.invites,
  };
}
const currentBoard = (S) => S.boards.find((b) => b.n === S.match.board && b.ended_at === null) || null;
const answerOf = (S, board) => { const p = S.pool.get(board.board_id); return p && p.solution && p.solution.sg && p.solution.hid ? p.solution : null; };

/* ───────────── bringing a match up to now ───────────── */
/** The statements that open board `n` for the match's players: where their placements go, and that they were dealt it. */
function openBoard(d, m, n, boardId, at, G) {
  const out = [];
  for (const seat of humans(m)) {
    out.push(d.prepare(`INSERT INTO duel_recordings (match_id, n, seat, account_id, board_id, ranked, rating) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${G.sql} ON CONFLICT (match_id, n, seat) DO NOTHING`)
      .bind(m.id, n, seat, m[seat], boardId, m.kind === "ranked" ? 1 : 0, m[`${seat}_rating`], ...G.binds));
    out.push(d.prepare(`INSERT INTO duel_dealt (account_id, board_id, at) SELECT ?, ?, ? WHERE ${G.sql} ON CONFLICT (account_id, board_id) DO UPDATE SET at = excluded.at, times = times + 1`)
      .bind(m[seat], boardId, at, ...G.binds));
  }
  return out;
}

/**
 * The batch that ends the board being played and whatever follows from it: the next board's countdown, or the match's result
 * and, for a ranked match, the ratings. `end`: { at, how, winner?, ms?: { a, b }, match?: { result, how } } (winner left out:
 * decided on correctly placed scapegoats; `match`: the match ends here whatever the score, a forfeit).
 * Its first statement writes only if the board is still open and both players' event numbers are the ones this was computed
 * from; everything else hangs on it.
 */
function endStatements(ctx, S, cur, end) {
  const { d, now, cfg } = ctx, m = S.match, op = newOp(), out = [];
  const solution = answerOf(S, cur), cut = end.at - cur.starts_at;
  const plan = m.bot ? m.bot[cur.n - 1] : null;
  const tokens = { a: fold(S.recs.a ? S.recs.a.track : [], cut), b: fold(plan ? plan.track : S.recs.b ? S.recs.b.track : [], cut) };
  const correct = { a: solution ? correctCount(tokens.a, solution) : 0, b: solution ? correctCount(tokens.b, solution) : 0 };
  const ms = end.ms || { a: null, b: null };
  const winner = end.winner || (correct.a > correct.b ? "a" : correct.b > correct.a ? "b" : "tie");
  out.push(d.prepare(
    `UPDATE duel_boards SET ended_at = ?, winner = ?, how = ?, a_ms = ?, b_ms = ?, a_correct = ?, b_correct = ?, end_op = ?
     WHERE match_id = ? AND n = ? AND ended_at IS NULL
       AND EXISTS (SELECT 1 FROM duel_matches WHERE id = ? AND state = 'live' AND board = ? AND a_seq = ? AND b_seq = ?) RETURNING n`,
  ).bind(end.at, winner, end.how, ms.a, ms.b, correct.a, correct.b, op, m.id, cur.n, m.id, cur.n, m.a_seq, m.b_seq));
  const G = { sql: "EXISTS (SELECT 1 FROM duel_boards WHERE match_id = ? AND n = ? AND end_op = ?)", binds: [m.id, cur.n, op] };
  const size = (S.pool.get(cur.board_id) || {}).size, floorMs = ((cfg.min_solve_seconds || {})[size] || 0) * 1000;
  for (const seat of humans(m)) {
    out.push(d.prepare(`UPDATE duel_recordings SET solved = ?, ms = ?, correct = ?, at = ? WHERE match_id = ? AND n = ? AND seat = ? AND ${G.sql}`)
      .bind(ms[seat] === null ? 0 : 1, ms[seat], correct[seat], end.at, m.id, cur.n, seat, ...G.binds));
    // too fast to be a person: the result stands, the account is flagged for review (architecture 4.8)
    if (ms[seat] !== null && ms[seat] < floorMs) out.push(flag(d, m[seat], "duel_fast", { match: m.id, board: cur.n, size, ms: ms[seat] }, now, G));
  }
  const wins = { a: m.a_wins + (winner === "a" ? 1 : 0), b: m.b_wins + (winner === "b" ? 1 : 0) };
  const over = end.match || (wins.a >= 2 || wins.b >= 2 || cur.n >= 3 ? { result: wins.a > wins.b ? "a" : wins.b > wins.a ? "b" : "draw", how: "boards" } : null);
  if (!over) {
    const n = cur.n + 1, boardId = m.boards[n - 1], starts = end.at + DUEL.countdownMs;
    out.push(d.prepare(`UPDATE duel_matches SET a_wins = ?, b_wins = ?, board = ? WHERE id = ? AND state = 'live' AND ${G.sql}`).bind(wins.a, wins.b, n, m.id, ...G.binds));
    out.push(d.prepare(`INSERT INTO duel_boards (match_id, n, board_id, starts_at, deadline) SELECT ?, ?, ?, ?, ? WHERE ${G.sql}`).bind(m.id, n, boardId, starts, starts + DUEL.limitMs, ...G.binds));
    out.push(...openBoard(d, m, n, boardId, end.at, G));
    return out;
  }
  const ranked = m.kind === "ranked", mop = newOp();
  const score = { a: over.result === "a" ? 1 : over.result === "draw" ? 0.5 : 0 };
  score.b = 1 - score.a;
  const delta = { a: ranked ? eloDelta(m.a_rating, m.b_rating, score.a, m.a_k) : null, b: ranked && m.b !== null ? eloDelta(m.b_rating, m.a_rating, score.b, m.b_k) : null };
  out.push(d.prepare(
    `UPDATE duel_matches SET state = 'done', a_wins = ?, b_wins = ?, result = ?, how = ?, ended = ?, a_delta = ?, b_delta = ?, end_op = ? WHERE id = ? AND state = 'live' AND ${G.sql}`,
  ).bind(wins.a, wins.b, over.result, over.how, end.at, delta.a, delta.b, mop, m.id, ...G.binds));
  const MG = { sql: "EXISTS (SELECT 1 FROM duel_matches WHERE id = ? AND end_op = ?)", binds: [m.id, mop] };
  if (!ranked) { // a friendly match counts for nothing: no rating, and a bot never learns from it
    out.push(d.prepare(`DELETE FROM duel_recordings WHERE match_id = ? AND ${MG.sql}`).bind(m.id, ...MG.binds));
    return out;
  }
  for (const seat of humans(m)) { // the only statement anywhere that changes a rating
    const won = score[seat] === 1 ? 1 : 0;
    out.push(d.prepare(
      `UPDATE duel_ratings SET rating = MAX(?, rating + ?), played = played + 1, wins = wins + ?, losses = losses + ?, draws = draws + ?,
         best_streak = MAX(best_streak, CASE WHEN ? = 1 THEN streak + 1 ELSE 0 END), streak = CASE WHEN ? = 1 THEN streak + 1 ELSE 0 END,
         best_rating = MAX(best_rating, rating + ?), updated = ? WHERE account_id = ? AND ${MG.sql}`,
    ).bind(DUEL.minRating, delta[seat], won, score[seat] === 0 ? 1 : 0, score[seat] === 0.5 ? 1 : 0, won, won, delta[seat], end.at, m[seat], ...MG.binds));
  }
  return out;
}

/**
 * What is due on a live match at `ctx.now` → the batch that does it (one step: a board's end and what follows), or null when
 * the match is up to date. `seat`: the caller's, when a player is asking (the absence rule needs to know who is here).
 *   1. The opponent was away for DUEL.absentMs while the caller kept playing: the match is the caller's (a forfeit). "Away"
 *      is measured between the two players' own "heard from" times, never against the clock alone: if both were cut off
 *      (the server's fault, or a tunnel each) nobody forfeits and the match simply goes on.
 *   2. Someone has every piece right: the board is theirs, at the time of their last placement. A bot finishes at its
 *      plan's time. Two finishes at the same millisecond: a tie.
 *   3. The 3 minutes are over: more correctly placed scapegoats takes the board, the same number is a tie.
 */
function advance(ctx, S, seat = null) {
  const { now } = ctx, m = S.match;
  if (!m || m.state !== "live") return null;
  const cur = currentBoard(S);
  if (!cur) return null;
  if (seat && m.b !== null && m[`${seat}_seen`] - m[`${otherSeat(seat)}_seen`] >= DUEL.absentMs) {
    return endStatements(ctx, S, cur, { at: now, how: "forfeit", winner: seat, match: { result: seat, how: "forfeit" } });
  }
  const solution = answerOf(S, cur), done = [];
  if (solution) {
    for (const s of humans(m)) {
      const track = S.recs[s] ? S.recs[s].track : [];
      if (track.length && isSolved(fold(track), solution)) done.push({ seat: s, ms: track[track.length - 1][0] });
    }
  }
  const plan = m.bot ? m.bot[cur.n - 1] : null;
  if (plan && botFinishes(plan) && now >= cur.starts_at + plan.ms) done.push({ seat: "b", ms: plan.ms });
  if (done.length) {
    const first = Math.min(...done.map((x) => x.ms)), firsts = done.filter((x) => x.ms === first);
    const ms = { a: null, b: null };
    for (const x of firsts) ms[x.seat] = first;
    return endStatements(ctx, S, cur, { at: cur.starts_at + first, how: "finish", winner: firsts.length === 1 ? firsts[0].seat : "tie", ms });
  }
  if (now >= cur.deadline) return endStatements(ctx, S, cur, { at: cur.deadline, how: "timeout" });
  return null;
}

/**
 * Reads the caller's match, brings it up to now, then does `action` on it, as often as it takes for both to land on a state
 * nobody changed meanwhile. `action(S, seat)` → { statements } (its first statement must be a RETURNING one that writes only
 * on the state it was computed from) or null when there is nothing to write. → the state as last read.
 */
async function run(ctx, { matchId = null, action = null, absence = true } = {}) {
  let S = null, pending = action;
  for (let turn = 0; turn < 10; turn++) {
    S = await load(ctx, matchId);
    const seat = S.match ? seatOf(S.match, ctx.id) : null;
    const due = advance(ctx, S, absence ? seat : null);
    if (due) { await ctx.d.batch(due); continue; }
    if (!pending) return S;
    const act = pending(S, seat);
    if (!act || !act.statements.length) return S;
    if (wrote((await ctx.d.batch(act.statements))[0])) pending = null; // done; read once more: it may have finished a board
  }
  return S;
}

/* ───────────── what the phone is told ───────────── */
const ratingOf = (r) => (r
  ? { rating: r.rating, played: r.played, wins: r.wins, losses: r.losses, draws: r.draws, streak: r.streak, bestStreak: r.best_streak, bestRating: r.best_rating }
  : { rating: DUEL.startRating, played: 0, wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, bestRating: DUEL.startRating });

/**
 * The state for the caller (the answer of every duel call):
 *   { serverTime, state: "idle" | "queue" | "match" | "done", rating, rules, invites (open invitations waiting for the caller),
 *     queue?: { joined, waited, endsAt, invite }, queueEnded?: "nobody" | "away",
 *     match?: { id, kind, you: "a" | "b", opponent: { bot, name, avatar, rating }, board, wins: { you, them }, seq,
 *               boards: [{ n, size, startsAt, deadline, endedAt, winner: "you" | "them" | "tie" | null, how,
 *                          you: { ms, correct }, them: { ms, correct } }],
 *               tokens (the caller's pieces on the board being played), placed: { you, them } (pieces on the board, right or not),
 *               case?: { n, id, body } (the board's case, from DUEL.preloadMs before its start, while `have` < n),
 *               result?: "win" | "loss" | "draw", how?, ended?, delta? } }
 * Nothing here says where a piece belongs: `correct` appears only on a board that has ended.
 */
async function view(ctx, S, { have = 0, queueEnded = null } = {}) {
  const { d, id, now } = ctx, m = S.match;
  const out = { serverTime: now, state: "idle", rating: ratingOf(S.rating), rules: RULES, invites: S.invites };
  if (queueEnded) out.queueEnded = queueEnded;
  if (!m) {
    if (S.queue) { out.state = "queue"; out.queue = { joined: S.queue.joined, waited: now - S.queue.joined, endsAt: S.queue.joined + DUEL.queueMs, invite: S.queue.invite_id }; }
    return out;
  }
  const seat = seatOf(m, id), other = otherSeat(seat);
  const mine = (w) => (w === null ? null : w === "tie" ? "tie" : w === seat ? "you" : "them");
  const avatar = (v) => (typeof v === "string" && v.startsWith("L:") ? v : "");
  out.state = m.state === "live" ? "match" : "done";
  out.match = {
    id: m.id, kind: m.kind, you: seat,
    opponent: { bot: m.b === null, name: m[`${other}_name`], avatar: avatar(m[`${other}_avatar`]), rating: m[`${other}_rating`] },
    board: m.board, wins: { you: m[`${seat}_wins`], them: m[`${other}_wins`] }, seq: m[`${seat}_seq`],
    boards: S.boards.map((b) => ({
      n: b.n, size: (S.pool.get(b.board_id) || {}).size || DUEL.sizes[b.n - 1], startsAt: b.starts_at, deadline: b.deadline, endedAt: b.ended_at, winner: mine(b.winner), how: b.how,
      you: { ms: b[`${seat}_ms`], correct: b[`${seat}_correct`] }, them: { ms: b[`${other}_ms`], correct: b[`${other}_correct`] },
    })),
  };
  if (m.state !== "live") {
    Object.assign(out.match, { result: m.result === "draw" ? "draw" : m.result === seat ? "win" : "loss", how: m.how, ended: m.ended, delta: m[`${seat}_delta`] });
    return out;
  }
  const cur = currentBoard(S);
  if (!cur) return out;
  const plan = m.bot ? m.bot[cur.n - 1] : null;
  out.match.tokens = fold(S.recs[seat] ? S.recs[seat].track : []);
  out.match.placed = {
    you: S.recs[seat] ? S.recs[seat].placed : 0,
    them: plan ? Object.keys(fold(plan.track, now - cur.starts_at)).length : S.recs[other] ? S.recs[other].placed : 0,
  };
  if (cur.n > have && now >= cur.starts_at - DUEL.preloadMs) {
    const row = await d.prepare("SELECT body FROM duel_pool WHERE id = ?").bind(cur.board_id).first();
    if (row) out.match.case = { n: cur.n, id: cur.board_id, body: parse(row.body, null) };
  }
  return out;
}

/* ───────────── making a match ───────────── */
/**
 * A match between two waiting players, or (b null) between one and a bot. The three boards are chosen here, one of each
 * size: first a board neither player was ever dealt, else the one they saw longest ago; for a bot, among equals, one that
 * has a recording near the player's rating. Made only if both are still waiting in the same room, heard from lately and in
 * no other match: the database checks it in the batch that makes the match, so two calls pairing the same players make one.
 * → true when this call made it.
 */
async function createMatch(ctx, { a, b = null, invite = null }) {
  const { d, env, now, cfg } = ctx, kind = invite ? "friendly" : "ranked";
  const two = [a.id, (b || a).id], lo = a.rating - DUEL.botBand, hi = a.rating + DUEL.botBand;
  const hasRecording = "(SELECT COUNT(*) FROM duel_recordings r WHERE r.board_id = p.id AND r.ranked = 1 AND r.solved = 1 AND r.account_id <> ? AND r.rating BETWEEN ? AND ?) = 0";
  const pre = await d.batch([
    ...DUEL.sizes.map((size) => d.prepare(
      `SELECT p.id, p.size, p.solution, p.walk FROM duel_pool p WHERE p.size = ? AND p.active = 1 ORDER BY
         (SELECT COUNT(*) FROM duel_dealt x WHERE x.account_id IN (?, ?) AND x.board_id = p.id),
         COALESCE((SELECT MAX(x.at) FROM duel_dealt x WHERE x.account_id IN (?, ?) AND x.board_id = p.id), 0),
         ${b ? "" : `${hasRecording},`} RANDOM() LIMIT 1`,
    ).bind(size, two[0], two[1], two[0], two[1], ...(b ? [] : [a.id, lo, hi]))),
    d.prepare("SELECT account_id, rating, played FROM duel_ratings WHERE account_id IN (?, ?)").bind(two[0], two[1]),
  ]);
  const boards = DUEL.sizes.map((_, i) => pre[i].results[0]);
  if (boards.some((p) => !p)) return false;
  const rated = (who) => pre[DUEL.sizes.length].results.find((r) => r.account_id === who) || { rating: DUEL.startRating, played: 0 };
  const ra = rated(a.id), rb = b ? rated(b.id) : { rating: ra.rating, played: 0 }; // a bot stands in for the player's own rating
  const mid = crypto.randomUUID(), op = newOp();
  let bot = null;
  if (!b) {
    const recs = await d.batch(boards.map((p) => d.prepare(
      `SELECT track, ms FROM duel_recordings WHERE board_id = ? AND ranked = 1 AND solved = 1 AND account_id <> ? AND rating BETWEEN ? AND ? AND ms >= ?
       ORDER BY ABS(rating - ?), RANDOM() LIMIT 1`,
    ).bind(p.id, a.id, lo, hi, ((cfg.min_solve_seconds || {})[p.size] || 0) * 1000, ra.rating)));
    bot = boards.map((p, i) => {
      const rec = recs[i].results[0], track = rec ? parse(rec.track, null) : null;
      return Array.isArray(track) && track.length
        ? botFromRecording({ ms: rec.ms, track })
        : botFromWalk({ walk: parse(p.walk, []), solution: parse(p.solution, { sg: {}, hid: {} }), size: p.size, rating: ra.rating, seed: `${mid}:${i + 1}` });
    });
  }
  const [na, nb] = await Promise.all([getRecord(env, a.id), b ? getRecord(env, b.id) : null]);
  const G = { sql: "EXISTS (SELECT 1 FROM duel_matches WHERE id = ? AND op = ?)", binds: [mid, op] };
  const m = { id: mid, kind, a: a.id, b: b ? b.id : null, a_rating: ra.rating, b_rating: rb.rating };
  const starts = now + DUEL.countdownMs;
  const res = await d.batch([
    d.prepare("UPDATE duel_queue SET seen = ? WHERE account_id = ?").bind(now, ctx.id), // the caller is here: this call is the proof
    d.prepare(
      `INSERT INTO duel_matches (id, kind, a, b, a_name, b_name, a_avatar, b_avatar, a_rating, b_rating, a_k, b_k, boards, bot, created, a_seen, b_seen, invite_id, op)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM duel_matches m WHERE m.state = 'live' AND (m.a IN (?, ?) OR m.b IN (?, ?)))
         AND (SELECT COUNT(*) FROM duel_queue q WHERE q.account_id IN (?, ?) AND q.invite_id IS ? AND q.seen >= ?) = ?
         ${invite ? "AND EXISTS (SELECT 1 FROM duel_invites i WHERE i.id = ? AND i.state = 'open' AND i.expires > ?)" : ""} RETURNING id`,
    ).bind(mid, kind, m.a, m.b, na.username, nb ? nb.username : "", na.avatar, nb ? nb.avatar : "", ra.rating, rb.rating,
      kind === "ranked" ? kFor(ra.played) : 0, kind === "ranked" && b ? kFor(rb.played) : 0, JSON.stringify(boards.map((p) => p.id)), bot ? JSON.stringify(bot) : null,
      now, now, now, invite, op, two[0], two[1], two[0], two[1], two[0], two[1], invite, now - DUEL.freshMs, b ? 2 : 1, ...(invite ? [invite, now] : [])),
    d.prepare(`DELETE FROM duel_queue WHERE account_id IN (?, ?) AND ${G.sql}`).bind(two[0], two[1], ...G.binds),
    d.prepare(`INSERT INTO duel_boards (match_id, n, board_id, starts_at, deadline) SELECT ?, 1, ?, ?, ? WHERE ${G.sql}`).bind(mid, boards[0].id, starts, starts + DUEL.limitMs, ...G.binds),
    ...openBoard(d, m, 1, boards[0].id, now, G),
    ...(invite ? [d.prepare(`UPDATE duel_invites SET state = 'played', answered = ?, match_id = ? WHERE id = ? AND state = 'open' AND ${G.sql}`).bind(now, mid, invite, ...G.binds)] : []),
    // the same two accounts meeting over and over in the ranked queue is how wins are traded: a signal for review
    ...(b && kind === "ranked" ? [flag(d, a.id, "duel_pair", { match: mid, with: b.id }, now, {
      sql: `${G.sql} AND (SELECT COUNT(*) FROM duel_matches p WHERE p.kind = 'ranked' AND p.created > ? AND ((p.a = ? AND p.b = ?) OR (p.a = ? AND p.b = ?))) > 5`,
      binds: [...G.binds, now - 24 * 3600 * 1000, a.id, b.id, b.id, a.id],
    })] : []),
  ]);
  return wrote(res[1]);
}

/**
 * The caller is waiting: is there a match to make now? → "made" | "nobody" (a friendly room's minute ran out) | "away" (the
 * caller stopped asking for too long: it is no longer waiting) | null (still waiting).
 * The ranked queue: the waiting player of the closest rating whose difference fits the band of whichever of the two waited
 * longer (duel_rules.js band: it widens until anyone will do); after DUEL.queueMs with nobody, a bot.
 * A friendly room: only the invitation's other party; never a bot.
 */
async function matchmake(ctx, S) {
  const { d, id, now } = ctx, q = S.queue;
  const drop = () => d.prepare("DELETE FROM duel_queue WHERE account_id = ?").bind(id).run();
  if (now - q.seen > DUEL.staleMs) { await drop(); return "away"; }
  const wait = now - q.joined, fresh = now - DUEL.freshMs, me = { id, rating: q.rating };
  if (q.invite_id) {
    const other = await d.prepare("SELECT account_id, rating FROM duel_queue WHERE invite_id = ? AND account_id <> ? AND seen >= ?").bind(q.invite_id, id, fresh).first();
    if (other) return (await createMatch(ctx, { a: { id: other.account_id, rating: other.rating }, b: me, invite: q.invite_id })) ? "made" : null;
    if (wait >= DUEL.queueMs) { await drop(); return "nobody"; }
  } else {
    const waiting = (await d.prepare("SELECT account_id, rating, joined FROM duel_queue WHERE invite_id IS NULL AND account_id <> ? AND seen >= ? ORDER BY ABS(rating - ?), joined LIMIT 8")
      .bind(id, fresh, q.rating).all()).results;
    const pick = waiting.find((c) => mayMeet(q.rating, wait, c.rating, now - c.joined));
    if (pick) return (await createMatch(ctx, { a: { id: pick.account_id, rating: pick.rating }, b: me })) ? "made" : null;
    if (wait >= DUEL.queueMs) return (await createMatch(ctx, { a: me })) ? "made" : null;
  }
  if (now - q.seen >= DUEL.queueGrainMs) await d.prepare("UPDATE duel_queue SET seen = ? WHERE account_id = ?").bind(now, id).run();
  return null;
}

/* ───────────── the calls ───────────── */
/**
 * GET /api/app/duel[?match=<id>][&have=<n>] → the state (see `view`). The poll: once a second while waiting or playing.
 * Without `match`: the caller's live match, else its place in the queue (and this is where a waiting player gets its
 * opponent or its bot), else "idle". With `match`: that match of the caller's, also once it is over (the result screen).
 * `have`: the highest board whose case the phone already holds, so it is not sent again.
 */
export async function duelState(ctx, { matchId = null, have = 0 } = {}) {
  const no = await refused(ctx);
  if (no) return no;
  if (matchId !== null && !ID_RE.test(matchId)) return answer(400, { error: "format" });
  const S = await run(ctx, { matchId });
  if (matchId && !S.match) return answer(404, { error: "no_match" });
  if (!S.match && S.queue) return answer(200, await waiting(ctx, S, have));
  const m = S.match;
  if (m && m.state === "live") { // heard from, noted every few seconds (the absence rule reads it)
    const seat = seatOf(m, ctx.id);
    if (ctx.now - m[`${seat}_seen`] >= DUEL.seenGrainMs) await ctx.d.prepare(`UPDATE duel_matches SET ${seat}_seen = ? WHERE id = ? AND state = 'live' AND ${seat}_seen < ?`).bind(ctx.now, m.id, ctx.now).run();
  }
  return answer(200, await view(ctx, S, { have }));
}

/** The caller is in the queue (S as just read): makes its match if there is one to make → the state to answer. */
async function waiting(ctx, S, have = 0) {
  const made = await matchmake(ctx, S);
  if (made === "made") return view(ctx, await run(ctx), { have });
  if (made) return view(ctx, { ...S, queue: null }, { queueEnded: made });
  return view(ctx, S);
}

/**
 * POST /api/app/duel/queue { invite? } → the state. The caller starts waiting: in the ranked queue, or (`invite`: an open
 * invitation it sent or received) in that invitation's room. Sent again while waiting, it keeps its place.
 * 409 in_match (with the state) | 503 no_boards (the pool lacks a size) | 404 no_invite | 409 invite_closed.
 */
export async function joinQueue(ctx, body) {
  const no = await refused(ctx);
  if (no) return no;
  const { d, id, now } = ctx;
  const invite = body.invite === undefined || body.invite === null ? null : typeof body.invite === "string" && ID_RE.test(body.invite) ? body.invite : false;
  if (invite === false) return answer(400, { error: "format" });
  const S = await run(ctx);
  if (S.match) return answer(409, { error: "in_match", ...(await view(ctx, S)) });
  const pre = await d.batch([
    d.prepare(`SELECT ${DUEL.sizes.map((size) => `EXISTS (SELECT 1 FROM duel_pool WHERE size = ${size} AND active = 1)`).join(" + ")} AS n`),
    d.prepare("SELECT account_id, to_account, state, expires FROM duel_invites WHERE id = ?").bind(invite || ""),
  ]);
  if (pre[0].results[0].n < DUEL.sizes.length) return answer(503, { error: "no_boards" });
  if (invite) {
    const inv = pre[1].results[0];
    if (!inv || (inv.account_id !== id && inv.to_account !== id)) return answer(404, { error: "no_invite" });
    if (inv.state !== "open" || inv.expires <= now) return answer(409, { error: "invite_closed" });
  }
  const res = await d.batch([
    d.prepare(
      `INSERT INTO duel_queue (account_id, invite_id, rating, joined, seen) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (account_id) DO UPDATE SET joined = CASE WHEN duel_queue.invite_id IS excluded.invite_id AND duel_queue.seen >= excluded.seen - ? THEN duel_queue.joined ELSE excluded.joined END,
         invite_id = excluded.invite_id, rating = excluded.rating, seen = excluded.seen RETURNING account_id, invite_id, rating, joined, seen`,
    ).bind(id, invite, S.rating ? S.rating.rating : DUEL.startRating, now, now, DUEL.staleMs),
    // a rating row from the first ranked wait on; a friendly match makes none
    ...(invite ? [] : [d.prepare("INSERT INTO duel_ratings (account_id, rating, best_rating, updated) VALUES (?, ?, ?, ?) ON CONFLICT (account_id) DO NOTHING").bind(id, DUEL.startRating, DUEL.startRating, now)]),
  ]);
  S.queue = res[0].results[0];
  return answer(200, await waiting(ctx, S));
}

/** DELETE /api/app/duel/queue → the state. The caller stops waiting (a match already made is not undone: see leaveMatch). */
export async function leaveQueue(ctx) {
  const no = await refused(ctx);
  if (no) return no;
  await ctx.d.prepare("DELETE FROM duel_queue WHERE account_id = ?").bind(ctx.id).run();
  return answer(200, await view(ctx, await run(ctx)));
}

/**
 * POST /api/app/duel/events { match, events: [{ seq, board, id, cell }] } → { results, ...state }.
 * The caller's placements on the board being played: `id` a piece of that board ("A" ... or "S"), `cell` [row, column] from 0,
 * or null to take the piece off. `seq`: the caller's own count of events in this match, from 1, no number skipped.
 * Each event is applied once, in order, at the server's time:
 *   ok          applied (says nothing about being right)
 *   duplicate   that number was already handled: a replay or a resend, ignored
 *   gap         a number was skipped: resend from `match.seq` + 1
 *   late        the board it names is over (someone finished, the 3 minutes ran out) or the match is
 *   early       the board has not started yet
 *   too_many    more events than a board can need (DUEL.maxEvents)
 *   bad         not a piece of this board, or not a tile of it
 * An event that is the next in order uses its number up whatever its result, so the phone's count and the server's stay in step.
 * 400 format | 404 no_match (not the caller's).
 */
export async function postEvents(ctx, body) {
  const no = await refused(ctx);
  if (no) return no;
  const { d, now } = ctx, events = body.events;
  if (typeof body.match !== "string" || !ID_RE.test(body.match) || !Array.isArray(events) || !events.length || events.length > DUEL.maxEventsPerCall) return answer(400, { error: "format" });
  let results = null;
  const action = (S, seat) => {
    const m = S.match;
    results = events.map(() => "late");
    if (!m || !seat || m.state !== "live") return null;
    const cur = currentBoard(S), solution = cur && answerOf(S, cur), rec = S.recs[seat];
    if (!cur || !solution || !rec) return null;
    const size = S.pool.get(cur.board_id).size, track = rec.track.slice();
    let seq = m[`${seat}_seq`], tokens = fold(track), count = rec.events, solved = false, flood = false;
    events.forEach((e, i) => {
      if (!e || typeof e !== "object" || !Number.isInteger(e.seq) || e.seq < 1) { results[i] = "bad"; return; }
      if (e.seq <= seq) { results[i] = "duplicate"; return; }
      if (e.seq !== seq + 1) { results[i] = "gap"; return; }
      seq = e.seq;
      if (e.board !== cur.n || solved) return; // "late"
      if (now < cur.starts_at) { results[i] = "early"; return; }
      if (count >= DUEL.maxEvents) { results[i] = "too_many"; flood = true; return; }
      const cell = cellOf(e.cell, size);
      if (typeof e.id !== "string" || !(Object.hasOwn(solution.sg, e.id) || Object.hasOwn(solution.hid, e.id)) || cell === undefined) { results[i] = "bad"; return; }
      track.push([Math.max(now - cur.starts_at, track.length ? track[track.length - 1][0] : 0), e.id, cell]);
      tokens = place(tokens, e.id, cell);
      count++;
      results[i] = "ok";
      solved = isSolved(tokens, solution); // the board is closed by `advance` on the next read, at this event's time
    });
    if (seq === m[`${seat}_seq`]) return null;
    const op = newOp(), mine = `EXISTS (SELECT 1 FROM duel_matches WHERE id = ? AND ${seat}_op = ?)`;
    return { statements: [
      d.prepare(
        `UPDATE duel_matches SET ${seat}_seq = ?, ${seat}_op = ?, ${seat}_seen = ? WHERE id = ? AND state = 'live' AND board = ? AND ${seat}_seq = ?
           AND EXISTS (SELECT 1 FROM duel_boards WHERE match_id = ? AND n = ? AND ended_at IS NULL) RETURNING id`,
      ).bind(seq, op, now, m.id, cur.n, m[`${seat}_seq`], m.id, cur.n),
      d.prepare(`UPDATE duel_recordings SET track = ?, placed = ?, events = ? WHERE match_id = ? AND n = ? AND seat = ? AND ${mine}`)
        .bind(JSON.stringify(track), Object.keys(tokens).length, count, m.id, cur.n, seat, m.id, op),
      ...(flood ? [flag(d, ctx.id, "duel_flood", { match: m.id, board: cur.n }, now, { sql: mine, binds: [m.id, op] })] : []),
    ] };
  };
  const S = await run(ctx, { matchId: body.match, action });
  if (!S.match) return answer(404, { error: "no_match" });
  return answer(200, { results: results || events.map(() => "late"), ...(await view(ctx, S, { have: 3 })) });
}

/**
 * POST /api/app/duel/leave { match } → the state. The caller gives the match up: the board being played and the match go to
 * the opponent (how "left"); a ranked match counts as lost. A match already over is answered as it ended.
 */
export async function leaveMatch(ctx, body) {
  const no = await refused(ctx);
  if (no) return no;
  if (typeof body.match !== "string" || !ID_RE.test(body.match)) return answer(400, { error: "format" });
  const action = (S, seat) => {
    const cur = S.match && S.match.state === "live" && seat ? currentBoard(S) : null;
    return cur ? { statements: endStatements(ctx, S, cur, { at: ctx.now, how: "forfeit", winner: otherSeat(seat), match: { result: otherSeat(seat), how: "left" } }) } : null;
  };
  const S = await run(ctx, { matchId: body.match, action, absence: false });
  return S.match ? answer(200, await view(ctx, S, { have: 3 })) : answer(404, { error: "no_match" });
}

/* ───────────── friendly invitations ───────────── */
const inviteOut = (i, id, now, waiting) => ({
  id: i.id, from: i.account_id === id ? "you" : i.from_name, to: i.to_account === id ? "you" : i.to_name, created: i.created, expires: i.expires,
  state: i.state === "open" && i.expires <= now ? "expired" : i.state, ...(waiting === undefined ? {} : { waiting: !!waiting }),
});

/**
 * POST /api/app/duel/invites { to } → { ok, invite, duplicate? }. The caller invites the account `to` to a friendly match
 * (unranked: nothing counts). The invitation is what the invited player's Inbox shows; it stays open for a day. One open
 * invitation per pair and direction: a second one answers the first with duplicate: true.
 * WHO MAY BE INVITED: any signed-in account that is not banned, for now. The friends list is not built (Social phase): when
 * it is, this is the place that must also ask for an accepted friendship and no block. Until then an account id is nothing
 * the app can look up, so nobody can invite a stranger from the app.
 * 400 format | 400 self | 404 no_account.
 */
export async function createInvite(ctx, body) {
  const no = await refused(ctx);
  if (no) return no;
  const { d, env, id, now } = ctx, to = body.to;
  if (typeof to !== "string" || !/^[a-z]{2,20}:[\x21-\x7e]{1,200}$/.test(to)) return answer(400, { error: "format" });
  if (to === id) return answer(400, { error: "self" });
  const them = await d.prepare("SELECT kind, banned, merged_into FROM accounts WHERE id = ?").bind(to).first();
  if (!them || them.kind !== "full" || them.banned || them.merged_into) return answer(404, { error: "no_account" });
  const [me, you] = await Promise.all([getRecord(env, id), getRecord(env, to)]);
  const iid = crypto.randomUUID();
  const res = await d.batch([
    d.prepare("UPDATE duel_invites SET state = 'cancelled', answered = ? WHERE account_id = ? AND to_account = ? AND state = 'open' AND expires <= ?").bind(now, id, to, now),
    d.prepare("INSERT INTO duel_invites (id, account_id, to_account, from_name, to_name, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id")
      .bind(iid, id, to, me.username, you.username, now, now + DUEL.inviteMs),
    d.prepare("SELECT * FROM duel_invites WHERE account_id = ? AND to_account = ? AND state = 'open'").bind(id, to),
  ]);
  const row = res[2].results[0];
  return row ? answer(200, { ok: true, ...(wrote(res[1]) ? {} : { duplicate: true }), invite: inviteOut(row, id, now) }) : answer(409, { error: "busy" });
}

/**
 * GET /api/app/duel/invites → { incoming: [...], outgoing: [...] }: the open invitations to and from the caller, newest
 * first: { id, from, to (a codename, or "you"), created, expires, state, waiting (the other party is in the room now) }.
 */
export async function listInvites(ctx) {
  const no = await refused(ctx);
  if (no) return no;
  const { d, id, now } = ctx;
  const rows = (await d.prepare(
    `SELECT i.*, EXISTS (SELECT 1 FROM duel_queue q WHERE q.invite_id = i.id AND q.account_id <> ?1 AND q.seen >= ?3) AS waiting
     FROM duel_invites i WHERE (i.to_account = ?1 OR i.account_id = ?1) AND i.state = 'open' AND i.expires > ?2 ORDER BY i.created DESC LIMIT 50`,
  ).bind(id, now, now - DUEL.freshMs).all()).results;
  return answer(200, { incoming: rows.filter((i) => i.to_account === id).map((i) => inviteOut(i, id, now, i.waiting)), outgoing: rows.filter((i) => i.account_id === id).map((i) => inviteOut(i, id, now, i.waiting)) });
}

/**
 * POST /api/app/duel/invites/respond { id, action: "decline" | "cancel" } → { ok, invite }. The invited player declines, or
 * the inviter takes the invitation back. (Accepting is entering its room: POST /api/app/duel/queue { invite }.)
 * 400 format | 404 no_invite | 409 invite_closed.
 */
export async function respondInvite(ctx, body) {
  const no = await refused(ctx);
  if (no) return no;
  const { d, id, now } = ctx;
  if (typeof body.id !== "string" || !ID_RE.test(body.id) || !["decline", "cancel"].includes(body.action)) return answer(400, { error: "format" });
  const party = body.action === "decline" ? "to_account" : "account_id", state = body.action === "decline" ? "declined" : "cancelled";
  const res = await d.batch([
    d.prepare(`UPDATE duel_invites SET state = ?, answered = ? WHERE id = ? AND ${party} = ? AND state = 'open' RETURNING id`).bind(state, now, body.id, id),
    d.prepare("DELETE FROM duel_queue WHERE invite_id = ? AND EXISTS (SELECT 1 FROM duel_invites WHERE id = ? AND state <> 'open')").bind(body.id, body.id),
    d.prepare(`SELECT * FROM duel_invites WHERE id = ? AND ${party} = ?`).bind(body.id, id),
  ]);
  const row = res[2].results[0];
  if (!row) return answer(404, { error: "no_invite" });
  return wrote(res[0]) ? answer(200, { ok: true, invite: inviteOut(row, id, now) }) : answer(409, { error: "invite_closed", invite: inviteOut(row, id, now) });
}

/* ───────────── the 1v1 ranking ───────────── */
const RANK_TOP = 50;
/**
 * GET /api/app/duel/ranking -> { players: [{ rank, name, avatar, rating, played, wins, losses, draws, me }], me, total }.
 * The ranked ladder: accounts with at least one ranked match, best rating first (then more wins, then who got there first).
 * `me`: the caller's own row with its true place, also when it is not among the top RANK_TOP (null before its first ranked
 * match). The name and the look are the ones the account wore in its newest match (the matches hold them: no account lookup),
 * and no row carries an account id.
 */
export async function duelRanking(ctx) {
  const no = await refused(ctx);
  if (no) return no;
  const { d, id } = ctx;
  const order = "ORDER BY r.rating DESC, r.wins DESC, r.updated ASC, r.account_id ASC";
  const who = (col) => `(SELECT CASE WHEN m.a = r.account_id THEN m.a_${col} ELSE m.b_${col} END FROM duel_matches m WHERE (m.a = r.account_id OR m.b = r.account_id) AND m.kind = 'ranked' ORDER BY m.created DESC LIMIT 1)`;
  const res = await d.batch([
    d.prepare(`SELECT r.account_id, r.rating, r.played, r.wins, r.losses, r.draws, ROW_NUMBER() OVER (${order}) AS rank, ${who("name")} AS name, ${who("avatar")} AS avatar
      FROM duel_ratings r WHERE r.played > 0 ${order} LIMIT ${RANK_TOP}`),
    d.prepare("SELECT COUNT(*) AS n FROM duel_ratings WHERE played > 0"),
    d.prepare(`SELECT * FROM (SELECT r.account_id, r.rating, r.played, r.wins, r.losses, r.draws, ROW_NUMBER() OVER (${order}) AS rank, ${who("name")} AS name, ${who("avatar")} AS avatar
      FROM duel_ratings r WHERE r.played > 0) WHERE account_id = ?`).bind(id),
  ]);
  const avatar = (v) => (typeof v === "string" && v.startsWith("L:") ? v : "");
  const row = (r) => ({ rank: r.rank, name: r.name || "", avatar: avatar(r.avatar), rating: r.rating, played: r.played, wins: r.wins, losses: r.losses, draws: r.draws, me: r.account_id === id });
  const mine = res[2].results[0] || null;
  return answer(200, { players: res[0].results.map(row), me: mine ? row(mine) : null, total: res[1].results[0].n });
}

/* ───────────── the nightly sweep ───────────── */
/**
 * Matches nobody came back to (both players gone, or one who left a bot waiting) are brought up to now, so they end and
 * their ratings settle without waiting for a player to open the app again: the boards whose time ran out are decided on
 * placements. Called by POST /api/cron/retention?task=duels. `dry`: count them only. → { due, closed }
 */
export async function sweepDuels(env, { now = Date.now(), limit = 20, dry = false } = {}) {
  const d = await db(env);
  if (!d || !(await ready(d))) return { due: 0, closed: 0 };
  const due = (await d.prepare(
    "SELECT m.id, m.a FROM duel_boards b JOIN duel_matches m ON m.id = b.match_id AND m.board = b.n WHERE b.ended_at IS NULL AND b.deadline < ? AND m.state = 'live' ORDER BY b.deadline LIMIT ?",
  ).bind(now - 60000, limit).all()).results;
  if (dry) return { due: due.length, closed: 0 };
  let closed = 0;
  for (const row of due) {
    const S = await run({ d, env, id: row.a, now, cfg: parseConfig([]) }, { matchId: row.id, absence: false });
    if (S.match && S.match.state === "done") closed++;
  }
  return { due: due.length, closed };
}
