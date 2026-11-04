/**
 * ranking.js — the Syndicate ranking's score, shared by the browser (/profile/ranking, src/community.js) and the backend
 * (functions/api/ranking.js recomputes it from the entries a player sends, so the formula lives in one place).
 *
 * Only the story and the daily contracts count (community puzzles do not: anyone could make an easy one). Per fulfilled contract:
 *   10 points                                               more contracts fulfilled = higher
 *   + up to 5 for speed: 5 × par / (par + best time), rounded   at par time 3, twice as fast 3, three times slower 1
 *   − hints: 1 per "where to look", 1 per key deduction, 1 per placement shown (at most 10 per contract); note cards are free
 * Every part is a whole number.
 * The pack is small (13 story cases + 15 days of dailies), so the totals stay in the hundreds.
 * Ties: more contracts first, then the smaller total of best times.
 * A reset (tools/reset_ranking.py) puts a player back at zero: the contracts fulfilled before it never count again for them
 * (functions/api/ranking.js keeps their ids in the row's `excluded`), so only contracts fulfilled after it score.
 */
export const PAR_SECONDS = { Tutorial: 180, "Very Easy": 300, Easy: 480, Medium: 900, Hard: 1500, Expert: 2400 };
export const HINT_COST = { l: 1, k: 1, p: 1 }; // look / key / place (note cards cost nothing)
export const BASE_POINTS = 10, SPEED_POINTS = 5, HINT_CAP = 10;
export const MAX_ENTRIES = 2000;

const num = (v, max) => (Number.isFinite(+v) ? Math.max(0, Math.min(max, Math.floor(+v))) : 0);

/** A fulfilled contract → { speed, hints (rungs opened), penalty, points }. Entry: { d: difficulty, t: best seconds, l, k, p, n: hint counts }. */
export function contractPoints(e) {
  const par = PAR_SECONDS[e.d] || PAR_SECONDS.Easy;
  const t = Math.max(1, num(e.t, 864000));
  const speed = Math.round((SPEED_POINTS * par) / (par + t));
  const counts = { l: num(e.l, 999), k: num(e.k, 999), p: num(e.p, 999) };
  const penalty = Math.min(HINT_CAP, Object.entries(HINT_COST).reduce((s, [k, w]) => s + w * counts[k], 0));
  return { speed, hints: counts.l + counts.k + counts.p, penalty, points: BASE_POINTS + speed - penalty, seconds: t };
}

/** An entry's contract id (`c`), or "" when it has none (sent by a page from before the ids). */
export const entryId = (e) => (e && typeof e.c === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(e.c) ? e.c : "");

/** Entries → { solved, hints, seconds, speed, score }. Bad entries are dropped, and a contract id counts once. */
export function rankStats(entries) {
  const seen = new Set();
  const list = (Array.isArray(entries) ? entries : []).slice(0, MAX_ENTRIES).filter((e) => {
    if (!e || typeof e !== "object" || !Object.prototype.hasOwnProperty.call(PAR_SECONDS, e.d)) return false;
    const id = entryId(e);
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  let score = 0, speed = 0, hints = 0, seconds = 0;
  list.forEach((e) => { const c = contractPoints(e); score += c.points; speed += c.speed; hints += c.hints; seconds += c.seconds; });
  return { solved: list.length, hints, seconds, speed, score };
}
