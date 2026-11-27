/**
 * The 1v1's rules as plain functions: no database, no clock, no request (architecture 4.20). duel.js keeps the match in D1
 * with them; scripts/duel-pool-push.mjs makes the pool rows with them; scripts/test-duel.mjs checks them.
 *
 * A board's answer is { sg: { "A": [r, c], ... }, hid: { "S": [r, c] } }: the scapegoats' tiles and S. H. Adow's.
 * A track is what a player did on a board: [[ms, "A", [r, c]], [ms, "A", null], ...], ms since the board's start, null = the
 * piece went back to the tray. A player's board at any moment is the track replayed (fold).
 */
import { hash32, CASE_ID_RE } from "./economy.js";

export const DUEL = Object.freeze({
  /** The three boards of a match, in this order (the author, 2026-11-25). */
  sizes: Object.freeze([5, 6, 7]),
  /** A board lasts at most this long; then the player with more correctly placed scapegoats takes it. */
  limitMs: 180000,
  /** Between the match being made, or a board ending, and the next board starting for both. */
  countdownMs: 10000,
  /** The next board's case reaches the phone this long before its start, so it is drawn when the countdown ends. */
  preloadMs: 3000,
  /** A player waits this long for an opponent; then a bot (the ranked queue) or nothing (a friendly room). */
  queueMs: 60000,
  /** The Elo band: +-bandStart at first, +bandStep every bandEveryMs, anyone from bandOpenMs. PROPOSED. */
  bandStart: 100, bandStep: 100, bandEveryMs: 10000, bandOpenMs: 30000,
  /** A waiting player not heard from for this long is nobody's opponent; for staleMs, no longer waiting at all. */
  freshMs: 10000, staleMs: 20000,
  /** How often "heard from" is written (a write per poll would be most of the database's work). */
  queueGrainMs: 3000, seenGrainMs: 5000,
  /** A player away this long, while the opponent kept playing, forfeits the match. MY RULE: the brief does not say. */
  absentMs: 30000,
  startRating: 1000, minRating: 100,
  /** K = kNew for an account's first kNewMatches ranked matches, then k. PROPOSED (architecture 4.20). */
  kNew: 40, kNewMatches: 20, k: 24,
  /** Events accepted per player and board: a real game needs a few dozen. */
  maxEvents: 200, maxEventsPerCall: 20,
  /** A friendly invitation stays open this long. */
  inviteMs: 24 * 3600 * 1000,
  /** A bot replays a recording made within this many points of the rating it stands in for. */
  botBand: 150,
  /** A bot that follows the walkthrough: time to finish each board at 1000 points, halved every paceHalving points above
   *  (doubled below). FIRST GUESSES: set them from real recordings. Never faster than minStepMs a piece. */
  paceMs: Object.freeze({ 5: 80000, 6: 120000, 7: 170000 }), paceHalving: 600, minStepMs: 1500,
});

/* ───────────── matchmaking and Elo ───────────── */
/** How far apart two ratings may be for a player who has waited `waitMs`. */
export const band = (waitMs) => (waitMs >= DUEL.bandOpenMs ? Infinity : DUEL.bandStart + DUEL.bandStep * Math.floor(Math.max(0, waitMs) / DUEL.bandEveryMs));
/** Two waiting players may meet when the difference fits the band of the one who waited longer. */
export const mayMeet = (ratingA, waitA, ratingB, waitB) => Math.abs(ratingA - ratingB) <= Math.max(band(waitA), band(waitB));

export const expectedScore = (rating, opponent) => 1 / (1 + 10 ** ((opponent - rating) / 400));
export const kFor = (played) => (played < DUEL.kNewMatches ? DUEL.kNew : DUEL.k);
/** What a result does to `rating`: score 1 a win, 0.5 a draw, 0 a loss. Never below DUEL.minRating. */
export const eloDelta = (rating, opponent, score, k) => Math.max(DUEL.minRating - rating, Math.round(k * (score - expectedScore(rating, opponent))));

/* ───────────── a player's board ───────────── */
const same = (x, y) => Array.isArray(x) && Array.isArray(y) && x[0] === y[0] && x[1] === y[1];
/** A piece is put on a tile (whoever stood there goes back to the tray, as in the game) or, `cell` null, taken off. */
export function place(tokens, id, cell) {
  const out = {};
  for (const [k, at] of Object.entries(tokens)) if (k !== id && !(cell && same(at, cell))) out[k] = at;
  if (cell) out[id] = cell;
  return out;
}
/** The board a track leaves, counting only what happened up to `untilMs`. */
export function fold(track, untilMs = Infinity) {
  let tokens = {};
  for (const [ms, id, cell] of track) { if (ms > untilMs) break; tokens = place(tokens, id, cell); }
  return tokens;
}
/** Correctly placed scapegoats: what decides a board at its timeout. S. H. Adow is not a scapegoat. */
export const correctCount = (tokens, solution) => Object.entries(solution.sg).filter(([id, at]) => same(tokens[id], at)).length;
/** Finished: every scapegoat and S. H. Adow on their tiles. */
export const isSolved = (tokens, solution) => [...Object.entries(solution.sg), ...Object.entries(solution.hid)].every(([id, at]) => same(tokens[id], at));
/** → the cell of a placement event, checked against the board's side, or undefined when it is not one. */
export const cellOf = (cell, size) => (cell === null ? null
  : Array.isArray(cell) && cell.length === 2 && cell.every((v) => Number.isInteger(v) && v >= 0 && v < size) ? [cell[0], cell[1]] : undefined);

/* ───────────── the pool: a case file → a row ───────────── */
// Every field the engine writes is named here as public (the phone needs it to draw and read the board) or secret (it
// gives the answer, or the way to it, away). A field in neither list stops the push: someone must say which it is.
const PUBLIC = new Set(["id", "title", "titleKey", "subtitleKey", "subtitle", "theme", "difficulty", "tier", "shape", "traitMode", "propMode", "engine", "i18nSchema", "zoneWord",
  "size", "rooms", "roomNames", "roomIds", "doors", "windows", "contents", "multiTile", "corpse", "biomeProps", "propClasses", "dress", "dressing", "suspects", "shadowSuspect",
  "globalRules", "openGround", "wording", "rules", "water"]);
const SECRET = new Set(["shadow", "steps", "hints", "gates", "seed", "attempt", "castKey", "puzzleId", "difficultyScore"]);
// what a duel board never is: a case the app or the site already holds with its answer, or one with extra assassins
const REFUSED = { story: "a Story case", lesson: "a lesson board", lessonRules: "a lesson board", dummies: "a lesson board", daily: "a daily contract", tutorialLore: "the tutorial",
  assassins: "a multi-assassin case", darkTiles: "a multi-assassin case" };
const SUSPECT_PUBLIC = new Set(["id", "name", "gender", "pronoun", "traits", "look", "clue", "text", "atoms", "clueTokens"]);
const tile = (v, size) => Array.isArray(v) && v.length === 2 && v.every((x) => Number.isInteger(x) && x >= 0 && x < size);

/**
 * A case file of engine/puzzles_duel → { id, size, difficulty, people, body, solution, walk } (body, solution, walk: objects).
 * Throws with the reason when the case cannot be a duel board.
 */
export function poolRow(c) {
  const fail = (why) => { throw new Error(`duel pool: ${c && c.id ? c.id : "a case"}: ${why}`); };
  if (!c || typeof c !== "object" || Array.isArray(c)) fail("not a case");
  if (typeof c.id !== "string" || !CASE_ID_RE.test(c.id)) fail("no usable id");
  for (const k of Object.keys(c)) {
    if (Object.hasOwn(REFUSED, k)) fail(`${REFUSED[k]} cannot be a duel board ("${k}")`);
    if (!PUBLIC.has(k) && !SECRET.has(k)) fail(`unknown field "${k}": name it public or secret in duel_rules.js before any board with it is pushed`);
  }
  const size = Array.isArray(c.rooms) ? c.rooms.length : 0;
  if (!DUEL.sizes.includes(size) || c.rooms.some((row) => !Array.isArray(row) || row.length !== size)) fail("not a square 5 x 5, 6 x 6 or 7 x 7 board");
  if (typeof c.difficulty !== "string" || !c.difficulty) fail("no difficulty");
  if (!Array.isArray(c.suspects) || !c.suspects.length) fail("no suspects");
  const sg = {}, suspects = [];
  for (const s of c.suspects) {
    if (!s || typeof s.id !== "string" || !/^[A-R]$/.test(s.id) || Object.hasOwn(sg, s.id)) fail("a suspect without a letter of its own");
    if (!tile(s.solution, size)) fail(`suspect ${s.id} has no tile`);
    sg[s.id] = [s.solution[0], s.solution[1]];
    const pub = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === "solution") continue;
      if (!SUSPECT_PUBLIC.has(k)) fail(`unknown suspect field "${k}": name it public or secret in duel_rules.js`);
      pub[k] = v;
    }
    suspects.push(pub);
  }
  if (!tile(c.shadow, size)) fail("no hiding tile");
  const solution = { sg, hid: { S: [c.shadow[0], c.shadow[1]] } };
  const taken = new Set(Object.values({ ...sg, ...solution.hid }).map((at) => at.join(",")));
  if (taken.size !== suspects.length + 1) fail("two people on one tile");
  // the solver's order of placements; a placement's weight is the steps it took (the eliminations before it count)
  const all = { ...sg, ...solution.hid }, walk = [];
  let weight = 0;
  for (const step of Array.isArray(c.steps) ? c.steps : []) {
    weight++;
    const id = step && step.suspect;
    if (typeof id !== "string" || !Object.hasOwn(all, id) || walk.some(([w]) => w === id) || !same(step.cell, all[id])) continue;
    walk.push([id, weight]);
    weight = 0;
  }
  for (const id of Object.keys(all)) if (!walk.some(([w]) => w === id)) walk.push([id, 1]); // a case without a walkthrough: the cast's order
  const body = {};
  for (const [k, v] of Object.entries(c)) if (PUBLIC.has(k)) body[k] = k === "suspects" ? suspects : v;
  return { id: c.id, size, difficulty: c.difficulty, people: suspects.length, body, solution, walk };
}

/* ───────────── bots ───────────── */
const mulberry = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** How long a walkthrough bot takes over a whole board of this side when it stands in for `rating`. */
export const paceMs = (size, rating, pieces) => Math.max(DUEL.minStepMs * pieces, Math.round(DUEL.paceMs[size] * 2 ** ((DUEL.startRating - rating) / DUEL.paceHalving)));
/**
 * A bot's plan for a board from the case's own walkthrough: the solver's placements in its order, each right the first time,
 * the board's time shared out by how many steps each placement took (a little uneven, the same for the same `seed`).
 * → { source: "walk", ms, track }
 */
export function botFromWalk({ walk, solution, size, rating, seed }) {
  const all = { ...solution.sg, ...solution.hid }, rnd = mulberry(hash32(String(seed)));
  const total = paceMs(size, rating, walk.length);
  const share = walk.map(([, weight]) => Math.max(1, weight) * (0.7 + 0.6 * rnd()));
  const sum = share.reduce((x, y) => x + y, 0);
  let acc = 0;
  const track = walk.map(([id], i) => { acc += share[i]; return [i === walk.length - 1 ? total : Math.round((total * acc) / sum), id, all[id]]; });
  return { source: "walk", ms: total, track };
}
/** A bot's plan from a player's recording of the board (a solved one): the same placements at the same times. */
export const botFromRecording = (rec) => ({ source: "recording", ms: rec.ms, track: rec.track });
/** A plan finishes the board only inside the limit. */
export const botFinishes = (plan) => Number.isInteger(plan.ms) && plan.ms <= DUEL.limitMs;
