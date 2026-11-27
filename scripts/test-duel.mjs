// The live 1v1 (functions/_lib/app/duel.js and duel_rules.js, /api/app/duel/**, migrations/0008_app_duel.sql, the pool tool
// scripts/duel-pool-push.mjs), tested in plain node:   npm run test:duel
// Like scripts/test-app-hideout.mjs: every call goes through functions/api/_middleware.js into the real handler, as the app
// calls it, against a SQLite database with the real migrations/ applied. The clock is the test's own (env.NOW): a match is
// played by moving it. What is checked, above all: the server alone decides a board and a match (who finished first, a
// timeout on correctly placed scapegoats, a tie), nothing it answers gives a board's answer away, an event counts once, a
// rating moves once and only for a ranked match, and a player meets a board again only when no other is left.
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openD1 } from "./lib/d1-sqlite.mjs";
import { APP_ORIGIN } from "../functions/_lib/app/cors.js";
import { setCodename } from "../functions/_lib/auth.js";
import { onRequest as middleware } from "../functions/api/_middleware.js";
import { DUEL, band, mayMeet, eloDelta, kFor, place, fold, correctCount, isSolved, poolRow, botFromWalk, paceMs } from "../functions/_lib/app/duel_rules.js";
import { sweepDuels } from "../functions/_lib/app/duel.js";
import { poolRows, poolSql } from "./duel-pool-push.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.shadoku.net";

let n = 0; const bad = [];
const ok = (what, cond) => { n++; if (!cond) bad.push(what); };
const eq = (what, got, want) => ok(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`, JSON.stringify(got) === JSON.stringify(want));

/* ───────────── harness ───────────── */
let T = Date.UTC(2026, 10, 26, 12); // the server's clock: the test moves it
const kv = new Map();
const KV = { get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, String(v)); }, delete: async (k) => { kv.delete(k); } };
const VERIFIER = { verify: async (provider, body) => (typeof body.sub === "string" ? { ok: true, provider, sub: body.sub, name: `Player ${body.sub}`, avatar: "" } : { ok: false, error: "invalid" }) };
const siteTables = async (d) => { await (await import(`${pathToFileURL(path.join(ROOT, "functions", "_lib", "db.js")).href}?t=${Math.random()}`)).db({ SHADOKU_DB: d }); };
const envOf = (d) => ({ SHADOKU_DB: d, SHADOKU_KV: KV, SESSION_SECRET: "test-secret-".repeat(4), NOW: () => T, IDENTITY_VERIFIER: VERIFIER });

let IP = 0, env;
async function app(method, where, token, body) {
  const url = new URL(SITE + where);
  const rel = url.pathname === "/api/account" ? "account" : url.pathname.replace(/^\/api\//, "");
  const file = [path.join(ROOT, "functions", "api", `${rel}.js`), path.join(ROOT, "functions", "api", rel, "index.js")].find((f) => fs.existsSync(f));
  const handler = (await import(pathToFileURL(file).href))[`onRequest${method[0]}${method.slice(1).toLowerCase()}`];
  const h = new Headers({ Origin: APP_ORIGIN, "CF-Connecting-IP": `10.8.0.${++IP % 250}` });
  if (token) h.set("Authorization", `Bearer ${token}`);
  const request = new Request(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await middleware({ request, env, next: (req) => handler({ request: req || request, env, params: {} }) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const quiet = async (fn) => { const { warn, error, log } = console; console.warn = console.error = console.log = () => {}; try { return await fn(); } finally { Object.assign(console, { warn, error, log }); } };
const answer = (r) => (r.status === 200 ? 200 : `${r.status} ${r.body && r.body.error}`);
const guest = async () => (await app("POST", "/api/app/auth/guest", undefined, {})).body;
const full = async (sub) => ({ ...(await app("POST", "/api/app/auth/google", undefined, { sub })).body, seq: 0 });

/* ───────────── boards made for the test (a duel board is only a cast, its tiles and a walkthrough to the server) ───────────── */
function mkCase(id, size, extra = {}) {
  const people = size - 1, letters = "ABCDEFG".slice(0, people).split("");
  const suspects = letters.map((L, i) => ({ id: L, name: `Name ${L}`, gender: i % 2 ? "m" : "f", pronoun: i % 2 ? "he" : "she", traits: { hat: "none" }, look: "plain", clue: `${L} was somewhere.`, text: `${L} was somewhere.`,
    atoms: [{ kind: "ROW", subject: L, params: { row: i } }], clueTokens: { subject: L, place: [0], people: [] }, solution: [i, (i * 2) % size] }));
  const order = [...suspects].reverse();
  const steps = [];
  order.forEach((s, i) => {
    if (i === 2) steps.push({ n: steps.length + 1, kind: "eliminate", text: "Nobody else fits there." });
    steps.push({ n: steps.length + 1, kind: "place", suspect: s.id, cell: s.solution, text: `Place ${s.name}.` });
  });
  steps.push({ n: steps.length + 1, kind: "shadow", suspect: "S", cell: [size - 1, size - 1], text: "The blind spot." });
  return {
    id, title: `Board ${id}`, titleKey: `CASE.${id}.TITLE`, theme: "FARM", difficulty: size === 7 ? "Easy" : "Very Easy", tier: "easy", shape: "rect", seed: 7, attempt: 3, castKey: `K-${id}`, puzzleId: `PID-${id}`,
    engine: "V10.7", difficultyScore: 5, zoneWord: "area", size, rooms: Array.from({ length: size }, () => Array(size).fill(0)), roomNames: ["Yard"], roomIds: ["YARD"], doors: [], windows: [],
    contents: Array.from({ length: size }, () => Array(size).fill("")), multiTile: [], corpse: [size - 1, 0], propClasses: {}, suspects, shadow: [size - 1, size - 1],
    shadowSuspect: { id: "S", name: "S. H. Adow", gender: null, traits: null }, globalRules: [], steps, hints: order.map((s) => ({ suspect: s.id, cell: s.solution })), gates: { G3_unique_full: true }, wording: 6, rules: 3, ...extra,
  };
}
const SOL = {}; // board id → [[piece, tile], ...]: the scapegoats, then S. H. Adow
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shadoku-duel-"));
function pushBoards(d, list, { retire = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, "set-"));
  for (const c of list) {
    fs.writeFileSync(path.join(dir, `shadoku_${c.id}.json`), JSON.stringify(c));
    SOL[c.id] = [...c.suspects.map((s) => [s.id, s.solution]), ["S", c.shadow]];
  }
  const { rows, refused } = poolRows(dir, { engine: path.join(tmp, "no-engine") });
  d.raw.exec(poolSql(rows, { now: T, retire }));
  return { rows, refused };
}
const SECRET_KEYS = ["solution", "shadow", "steps", "hints", "gates", "seed", "attempt", "castKey", "puzzleId", "track", "walk", "sg", "hid"];
const keysOf = (v, out = new Set()) => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) out.add(k); keysOf(x, out); } return out; };
const leaks = (v) => SECRET_KEYS.filter((k) => keysOf(v).has(k));

/* ───────────── the rules, as plain functions ───────────── */
{
  eq("the Elo band: +-100, +100 every 10 s, anyone from 30 s", [0, 9999, 10000, 20000, 29999, 30000].map(band), [100, 100, 200, 300, 300, Infinity].map((v) => v));
  eq("two players meet when the one who waited longer has a band that fits", [mayMeet(1000, 0, 1100, 0), mayMeet(1000, 0, 1101, 0), mayMeet(1000, 0, 1250, 20000), mayMeet(1000, 31000, 2400, 0)], [true, false, true, true]);
  eq("Elo: even players, K 40: +20, 0, -20; an upset pays more", [eloDelta(1000, 1000, 1, 40), eloDelta(1000, 1000, 0.5, 40), eloDelta(1000, 1000, 0, 40), eloDelta(1000, 1400, 1, 24), eloDelta(1400, 1000, 1, 24)], [20, 0, -20, 22, 2]);
  eq("K: 40 for the first 20 ranked matches, then 24; a rating never goes under 100", [kFor(0), kFor(19), kFor(20), 110 + eloDelta(110, 110, 0, 40)], [40, 40, 24, 100]);
  const t = place(place({}, "A", [1, 1]), "B", [1, 1]);
  eq("a piece put on a taken tile sends the other back to the tray; null takes a piece off", [t, place(t, "B", null)], [{ B: [1, 1] }, {}]);
  const sol = { sg: { A: [0, 0], B: [1, 2] }, hid: { S: [4, 4] } };
  const track = [[1000, "A", [0, 0]], [2000, "B", [3, 3]], [3000, "S", [4, 4]], [4000, "B", [1, 2]]];
  eq("a board is the track replayed, up to a time", [fold(track, 2500), correctCount(fold(track, 2500), sol), isSolved(fold(track, 3500), sol), isSolved(fold(track), sol), correctCount(fold(track), sol)], [{ A: [0, 0], B: [3, 3] }, 1, false, true, 2]);
  const c = mkCase("unit5", 5), row = poolRow(c);
  eq("a pool row: the answer and the walkthrough's order apart from the player's copy", [row.size, row.people, row.solution, row.walk, leaks(row.body)],
    [5, 4, { sg: { A: [0, 0], B: [1, 2], C: [2, 4], D: [3, 1] }, hid: { S: [4, 4] } }, [["D", 1], ["C", 1], ["B", 2], ["A", 1], ["S", 1]], []]);
  eq("…the player's copy still has the board and the clues", [row.body.id, row.body.suspects.map((s) => s.clue).length, row.body.rooms.length, row.body.shadowSuspect.id], ["unit5", 4, 5, "S"]);
  const why = (x) => { try { poolRow(x); return "ok"; } catch (e) { return String(e.message).replace(/^duel pool: [^:]+: /, ""); } };
  eq("refused: an unknown field, a Story case, a daily, extra assassins, another size, a suspect field nobody named",
    [why({ ...c, answers: 1 }).slice(0, 23), why({ ...c, story: true }).slice(0, 12), why({ ...c, daily: "2026-11-26" }).slice(0, 16), why({ ...c, assassins: [] }).slice(0, 21), why(mkCase("u8", 8)).slice(0, 12),
      why({ ...c, suspects: c.suspects.map((s) => ({ ...s, tile: s.solution })) }).slice(0, 28)],
    ['unknown field "answers"', "a Story case", "a daily contract", "a multi-assassin case", "not a square", 'unknown suspect field "tile"']);
  const plan = botFromWalk({ walk: row.walk, solution: row.solution, size: 5, rating: 1000, seed: "m:1" }), again = botFromWalk({ walk: row.walk, solution: row.solution, size: 5, rating: 1000, seed: "m:1" });
  eq("a walkthrough bot: the solver's order, every piece right, the board's pace, the same plan for the same seed",
    [plan.track.map((e) => e[1]), isSolved(fold(plan.track), row.solution), plan.ms, plan.track[plan.track.length - 1][0], JSON.stringify(plan) === JSON.stringify(again), plan.track.every((e, i) => i === 0 || e[0] >= plan.track[i - 1][0])],
    [["D", "C", "B", "A", "S"], true, 80000, 80000, true, true]);
  eq("…faster the higher the rating it stands in for, never under 1.5 s a piece", [paceMs(5, 1600, 5), paceMs(7, 400, 7), paceMs(5, 9000, 5)], [40000, 340000, 7500]);
  // the real thing, where the engine's folder is at hand (master only): a shipped 7 x 7 splits cleanly (it is refused later, as public)
  const real = path.join(ROOT, "engine", "puzzles", "shadoku_case3.json");
  if (fs.existsSync(real)) {
    const r = poolRow(JSON.parse(fs.readFileSync(real, "utf8")));
    eq("an engine case: every field known, nothing of the answer in the player's copy, the walk places everyone", [leaks(r.body), r.walk.length, r.size], [[], r.people + 1, 7]);
  }
}

/* ───────────── the pool tool ───────────── */
{
  const dir = fs.mkdtempSync(path.join(tmp, "tool-")), engine = path.join(tmp, "engine");
  fs.mkdirSync(path.join(engine, "puzzles"), { recursive: true });
  fs.writeFileSync(path.join(engine, "puzzles", "shadoku_shipped.json"), JSON.stringify(mkCase("shipped", 5, { puzzleId: "PID-pub" })));
  fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify(mkCase("good5", 5)));
  fs.writeFileSync(path.join(dir, "b.json"), JSON.stringify(mkCase("nogate", 6, { gates: { G3_unique_full: false } })));
  fs.writeFileSync(path.join(dir, "c.json"), JSON.stringify(mkCase("public7", 7, { puzzleId: "PID-pub" })));
  fs.writeFileSync(path.join(dir, "d.json"), JSON.stringify(mkCase("good5", 5)));
  fs.writeFileSync(path.join(dir, "e.json"), "{ not json");
  const { rows, refused } = poolRows(dir, { engine });
  eq("the tool takes the good file and names why it refuses the others", [rows.map((r) => r.id), refused.map((r) => r.split(":")[0]), refused.map((r) => /uniqueness|public|twice|JSON/.exec(r.slice(r.indexOf(":")))?.[0])],
    [["good5"], ["b.json", "c.json", "d.json", "e.json"], ["uniqueness", "public", "twice", "JSON"]]);
  const sql = poolSql(rows, { now: 5, retire: ["old1"] });
  eq("its SQL: plain ASCII, one row per board, the retired ones switched off", [/^[\x00-\x7e]*$/.test(sql), sql.split("\n").filter((l) => l.startsWith("INSERT INTO duel_pool")).length, sql.includes("UPDATE duel_pool SET active = 0 WHERE id = 'old1';")], [true, 1, true]);
}

/* ───────────── without migration 0008: everything else works, the duel answers 503 ───────────── */
{
  const dir = fs.mkdtempSync(path.join(tmp, "mig-"));
  for (const f of fs.readdirSync(path.join(ROOT, "migrations")).filter((f) => f.endsWith(".sql") && !f.startsWith("0008"))) fs.copyFileSync(path.join(ROOT, "migrations", f), path.join(dir, f));
  const old = openD1(dir);
  await siteTables(old);
  env = envOf(old);
  const p = await full("pre-1");
  eq("before 0008: 503 schema on the duel, the wallet as always, the sweep and an account deletion do nothing wrong",
    [answer(await quiet(() => app("GET", "/api/app/duel", p.token))), answer(await quiet(() => app("POST", "/api/app/duel/queue", p.token, {}))), answer(await app("GET", "/api/app/wallet", p.token)), await sweepDuels(env, { now: T }), answer(await app("DELETE", "/api/account", p.token))],
    ["503 schema", "503 schema", 200, { due: 0, closed: 0 }, 200]);
}

/* ───────────── the database of the rest of the file ───────────── */
const d1 = openD1(path.join(ROOT, "migrations"));
await siteTables(d1);
env = envOf(d1);
const rows = (sql, ...binds) => d1.raw.prepare(sql).all(...binds).map((r) => ({ ...r }));
const one = (sql, ...binds) => rows(sql, ...binds)[0];
const st = async (p, q = "") => (await app("GET", `/api/app/duel${q}`, p.token)).body;
const join = (p, body = {}) => app("POST", "/api/app/duel/queue", p.token, body);
const send = (p, match, events) => app("POST", "/api/app/duel/events", p.token, { match, events });
const put = (p, match, board, id, cell) => send(p, match, [{ seq: ++p.seq, board, id, cell }]);
const leave = (p, match) => app("POST", "/api/app/duel/leave", p.token, { match });
const rating = (p) => one("SELECT rating, played, wins, losses, draws, streak FROM duel_ratings WHERE account_id = ?", p.account.id);
const matchRow = (id) => one("SELECT * FROM duel_matches WHERE id = ?", id);
const boardIds = (id) => JSON.parse(matchRow(id).boards);
/** The clock moves on by `ms`, in steps of `step`; after each step these players poll (a phone polls every second). */
const wait = async (ms, who = [], step = 4000) => { for (let left = ms; left > 0; left -= step) { T += Math.min(step, left); for (const p of who) await st(p); } };
/** `p` puts the first `count` pieces of board `n` on their tiles, one every `stepMs`; `others` keep polling. → the last answer. */
async function play(p, match, n, { count = Infinity, stepMs = 3000, others = [] } = {}) {
  let last = null;
  for (const [id, cell] of SOL[boardIds(match)[n - 1]].slice(0, count)) { await wait(stepMs, others, stepMs); last = await put(p, match, n, id, cell); }
  return last;
}
/** Two players who are not waiting yet meet in the ranked queue. → the match id. */
async function pair(a, b) {
  await join(a);
  const r = await join(b);
  a.seq = 0; b.seq = 0;
  return r.body.match ? r.body.match.id : null;
}
const toStart = async (match, who, n = 1) => { const b = one("SELECT starts_at FROM duel_boards WHERE match_id = ? AND n = ?", match, n); if (b.starts_at > T) await wait(b.starts_at - T, who, 2000); };

/* ───────────── who may play, and with what ───────────── */
const P = await full("solo-1");
{
  const g = await guest();
  eq("a guest cannot play 1v1, wait, send events or invite", [answer(await app("GET", "/api/app/duel", g.token)), answer(await join(g)), answer(await send(g, crypto.randomUUID(), [{ seq: 1, board: 1, id: "A", cell: [0, 0] }])), answer(await app("POST", "/api/app/duel/invites", g.token, { to: P.account.id }))],
    Array(4).fill("403 signin_required"));
  const idle = await st(P);
  eq("a new player: idle, 1000 points, the rules as the server holds them", [idle.state, idle.rating, idle.rules, idle.invites],
    ["idle", { rating: 1000, played: 0, wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, bestRating: 1000 }, { sizes: [5, 6, 7], limitMs: 180000, countdownMs: 10000, preloadMs: 3000, queueMs: 60000, absentMs: 30000 }, 0]);
  eq("an empty pool: nobody waits", [answer(await quiet(() => join(P))), rows("SELECT * FROM duel_queue").length], ["503 no_boards", 0]);
  pushBoards(d1, [mkCase("d5a", 5), mkCase("d6a", 6)]);
  eq("…nor with a size missing", answer(await quiet(() => join(P))), "503 no_boards");
  pushBoards(d1, [mkCase("d7a", 7)]);
  eq("the pool: three boards, their bodies without answers", [rows("SELECT id, size, people, active FROM duel_pool ORDER BY size"), rows("SELECT body FROM duel_pool").flatMap((r) => leaks(JSON.parse(r.body)))],
    [[{ id: "d5a", size: 5, people: 4, active: 1 }, { id: "d6a", size: 6, people: 5, active: 1 }, { id: "d7a", size: 7, people: 6, active: 1 }], []]);
}

/* ───────────── nobody comes: a bot that follows the walkthrough (no recording exists yet) ───────────── */
let botMatch;
{
  const j = await join(P), t0 = T;
  eq("waiting: a place in the queue, a minute at most", [j.status, j.body.state, j.body.queue], [200, "queue", { joined: t0, waited: 0, endsAt: t0 + 60000, invite: null }]);
  await wait(59000, [P], 1000);
  eq("59 seconds: still waiting", [(await st(P)).state, rows("SELECT * FROM duel_matches").length], ["queue", 0]);
  T += 1000;
  const s = await st(P);
  botMatch = s.match.id; P.seq = 0;
  eq("60 seconds: a bot, ranked, at the player's own rating; the first board starts in 10 seconds", [s.state, s.match.kind, s.match.opponent, s.match.board, s.match.boards.map((b) => [b.n, b.size, b.startsAt - T, b.deadline - b.startsAt, b.endedAt]), s.match.case, rows("SELECT * FROM duel_queue").length],
    ["match", "ranked", { bot: true, name: "", avatar: "", rating: 1000 }, 1, [[1, 5, 10000, 180000, null]], undefined, 0]);
  const m = matchRow(botMatch), plans = JSON.parse(m.bot);
  eq("its plan: the walkthrough of each board at the pace of 1000 points", [plans.map((p) => [p.source, p.ms]), plans.map((p) => p.track.map((e) => e[1]).join("")), m.b, m.a_k],
    [[["walk", 80000], ["walk", 120000], ["walk", 170000]], ["DCBAS", "EDCBAS", "FEDCBAS"], null, 40]);
  eq("an event before the board starts is refused", (await put(P, botMatch, 1, "A", [0, 0])).body.results, ["early"]);
  await wait(6000, [P], 1000);
  eq("4 seconds before the start: no case yet", (await st(P)).match.case, undefined);
  T += 1000;
  const pre = await st(P);
  eq("3 seconds before: the board's case, with nothing of its answer", [pre.match.case.n, pre.match.case.id, pre.match.case.body.suspects.length, leaks(pre.match.case)], [1, "d5a", 4, []]);
  eq("…and not sent again to a phone that says it has it", (await st(P, "?have=1")).match.case, undefined);
  await wait(3000 + 76000, [P]);
  const mid = await st(P);
  eq("the bot plays on by the clock: pieces on its board, nothing decided, and nothing of its plan or of the boards to come in the answer", [mid.match.boards[0].endedAt, mid.match.placed.them > 0 && mid.match.placed.them < 5, mid.match.boards[0].them, leaks(mid), /d6a|d7a/.test(JSON.stringify(mid))], [null, true, { ms: null, correct: null }, [], false]);
  await wait(4000, [P]);
  const b1 = (await st(P)).match;
  eq("at its plan's time the bot has finished: the board is its, the next one starts for both 10 seconds later", [b1.boards[0].winner, b1.boards[0].how, b1.boards[0].them, b1.boards[0].you, b1.board, b1.wins, b1.boards[1].startsAt - b1.boards[0].endedAt, b1.boards[0].endedAt - b1.boards[0].startsAt],
    ["them", "finish", { ms: 80000, correct: 4 }, { ms: null, correct: 0 }, 2, { you: 0, them: 1 }, 10000, 80000]);
  await toStart(botMatch, [P], 2);
  const win = await play(P, botMatch, 2, { stepMs: 1000 });
  eq("the player finishes the second board first: it is the player's, at the time of the last placement", [win.body.results, win.body.match.boards[1].winner, win.body.match.boards[1].how, win.body.match.boards[1].you, win.body.match.wins, win.body.match.board],
    [["ok"], "you", "finish", { ms: 6000, correct: 5 }, { you: 1, them: 1 }, 3]);
  eq("…six pieces in six seconds is flagged for review; the result stands", rows("SELECT kind FROM flags WHERE account_id = ?", P.account.id).map((f) => f.kind), ["duel_fast"]);
  await toStart(botMatch, [P], 3);
  await play(P, botMatch, 3, { count: 2, stepMs: 2000 });
  await wait(165000, [P]);
  eq("the third board, 169 seconds in: the bot has not finished", (await st(P)).state, "match");
  T += 1000;
  const end = await st(P, `?match=${botMatch}`);
  eq("the bot finishes it: the match is lost 1-2 and the rating pays for it", [end.state, end.match.result, end.match.how, end.match.wins, end.match.delta, end.match.boards[2].you, end.match.boards[2].them, rating(P)],
    ["done", "loss", "boards", { you: 1, them: 2 }, -20, { ms: null, correct: 2 }, { ms: 170000, correct: 6 }, { rating: 980, played: 1, wins: 0, losses: 1, draws: 0, streak: 0 }]);
  eq("…the player is free again; the result stays readable", [(await st(P)).state, (await st(P)).rating.rating], ["idle", 980]);
  eq("the player's three boards are recorded (a ranked match), the bot's are not", rows("SELECT n, seat, ranked, solved, ms, correct, events FROM duel_recordings WHERE match_id = ? ORDER BY n", botMatch),
    [{ n: 1, seat: "a", ranked: 1, solved: 0, ms: null, correct: 0, events: 0 }, { n: 2, seat: "a", ranked: 1, solved: 1, ms: 6000, correct: 5, events: 6 }, { n: 3, seat: "a", ranked: 1, solved: 0, ms: null, correct: 2, events: 2 }]);
}

/* ───────────── two players: they finish in different orders ───────────── */
const A = await full("duo-a"), B = await full("duo-b");
let firstMatch;
{
  eq("codenames", [await setCodename(env, A.account.id, "Lantern_A"), await setCodename(env, B.account.id, "Lantern_B")], [undefined, undefined]);
  const ja = await join(A);
  T += 2000;
  const jb = await join(B);
  firstMatch = jb.body.match.id;
  const sa = await st(A);
  eq("the second to wait finds the first: one match, both in it, nobody waiting", [ja.body.state, jb.body.state, sa.state, sa.match.id === firstMatch, sa.match.you, jb.body.match.you, rows("SELECT * FROM duel_queue").length, rows("SELECT * FROM duel_matches WHERE state = 'live'").length],
    ["queue", "match", "match", true, "a", "b", 0, 1]);
  eq("each sees the other's codename and rating, never the account", [sa.match.opponent, jb.body.match.opponent, JSON.stringify(sa).includes(B.account.id), JSON.stringify(jb.body).includes(A.account.id)],
    [{ bot: false, name: "Lantern_B", avatar: "", rating: 1000 }, { bot: false, name: "Lantern_A", avatar: "", rating: 1000 }, false, false]);
  eq("in a match nobody can wait for another", [answer(await join(A)), (await join(A)).body.match.id === firstMatch], ["409 in_match", true]);
  await toStart(firstMatch, [A, B]);
  // what an answer says about a placement: nothing. A right tile and a wrong one are answered alike
  const right = await put(A, firstMatch, 1, "A", [0, 0]), wrong = await put(B, firstMatch, 1, "A", [4, 0]);
  const shape = (r) => [r.body.results, [...keysOf(r.body)].sort().join(","), r.body.match.placed.you, r.body.match.boards[0].you, r.body.match.tokens, leaks(r.body)];
  eq("a right placement and a wrong one get the same answer", [shape(right)[0], shape(wrong)[0], shape(right)[1] === shape(wrong)[1], shape(right)[2], shape(wrong)[2], shape(right)[3], shape(wrong)[3], shape(right)[5], shape(wrong)[5], right.body.match.tokens, wrong.body.match.tokens],
    [["ok"], ["ok"], true, 1, 1, { ms: null, correct: null }, { ms: null, correct: null }, [], [], { A: [0, 0] }, { A: [4, 0] }]);
  // a replay, a skipped number, a piece or a tile that is not the board's, someone else's match
  const before = one("SELECT track, events FROM duel_recordings WHERE match_id = ? AND n = 1 AND seat = 'a'", firstMatch);
  const replay = await send(A, firstMatch, [{ seq: 1, board: 1, id: "A", cell: [3, 3] }]);
  eq("a replayed event is ignored: the same number never counts twice", [replay.body.results, replay.body.match.tokens, replay.body.match.seq, one("SELECT track, events FROM duel_recordings WHERE match_id = ? AND n = 1 AND seat = 'a'", firstMatch)], [["duplicate"], { A: [0, 0] }, 1, before]);
  eq("a skipped number is not applied: the phone resends from the server's count", [(await send(A, firstMatch, [{ seq: 3, board: 1, id: "B", cell: [1, 2] }])).body.results, (await st(A)).match.seq], [["gap"], 1]);
  const mixed = await send(A, firstMatch, [{ seq: 2, board: 1, id: "Z", cell: [0, 0] }, { seq: 3, board: 1, id: "B", cell: [9, 9] }, { seq: 4, board: 2, id: "B", cell: [1, 2] }, { seq: 4, board: 1, id: "B", cell: [1, 2] }, { seq: "5", board: 1, id: "B", cell: [1, 2] }]);
  eq("a piece or a tile the board does not have, another board, a number used up, a number that is not one", [mixed.body.results, mixed.body.match.seq, mixed.body.match.tokens], [["bad", "bad", "late", "duplicate", "bad"], 4, { A: [0, 0] }]);
  A.seq = 4;
  eq("nobody plays in a match that is not theirs", [answer(await send(P, firstMatch, [{ seq: 1, board: 1, id: "A", cell: [0, 0] }])), answer(await app("GET", `/api/app/duel?match=${firstMatch}`, P.token)), answer(await leave(P, firstMatch)), answer(await send(A, "nope", []))],
    ["404 no_match", "404 no_match", "404 no_match", "400 format"]);
  // board 1: A finishes first (a piece every 3 seconds), B is still at it
  let r;
  for (const [id, cell] of SOL.d5a.slice(1)) { await wait(3000, [B], 3000); r = await put(A, firstMatch, 1, id, cell); }
  const b1 = r.body.match.boards[0], sb = await st(B);
  eq("A's last piece finishes the board: it stops for B at once, and both get the same start for the next", [r.body.results, b1.winner, b1.how, b1.you.ms, b1.you.correct, b1.them, sb.match.boards[0].winner, sb.match.board, sb.match.boards[1].startsAt === r.body.match.boards[1].startsAt, r.body.match.boards[1].startsAt - b1.endedAt, sb.match.tokens],
    [["ok"], "you", "finish", 12000, 4, { ms: null, correct: 0 }, "them", 2, true, 10000, {}]);
  eq("B's placement on the stopped board is too late", [(await put(B, firstMatch, 1, "B", [1, 2])).body.results, one("SELECT events FROM duel_recordings WHERE match_id = ? AND n = 1 AND seat = 'b'", firstMatch).events], [["late"], 1]);
  await toStart(firstMatch, [A, B], 2);
  const r2 = await play(B, firstMatch, 2, { others: [A] });
  eq("the second board: B finishes first", [r2.body.match.boards[1].winner, r2.body.match.wins, (await st(A)).match.boards[1].winner, (await st(A)).match.wins], ["you", { you: 1, them: 1 }, "them", { you: 1, them: 1 }]);
  await toStart(firstMatch, [A, B], 3);
  A.seq = (await st(A)).match.seq;
  const r3 = await play(A, firstMatch, 3, { others: [B] });
  const fa = r3.body, fb = await st(B, `?match=${firstMatch}`);
  eq("the third: A again. A wins the match 2-1; both ratings move once, by the same 20", [fa.state, fa.match.result, fa.match.how, fa.match.wins, fa.match.delta, fb.state, fb.match.result, fb.match.wins, fb.match.delta, rating(A), rating(B)],
    ["done", "win", "boards", { you: 2, them: 1 }, 20, "done", "loss", { you: 1, them: 2 }, -20, { rating: 1020, played: 1, wins: 1, losses: 0, draws: 0, streak: 1 }, { rating: 980, played: 1, wins: 0, losses: 1, draws: 0, streak: 0 }]);
  eq("asking again changes nothing", [(await st(A, `?match=${firstMatch}`)).match.delta, (await st(B)).state, rating(A).rating, rating(B).rating, (await put(A, firstMatch, 3, "A", null)).body.results], [20, "idle", 1020, 980, ["late"]]);
  const recs = rows("SELECT n, seat, ranked, rating, solved, ms, correct, track FROM duel_recordings WHERE match_id = ? ORDER BY n, seat", firstMatch);
  eq("both players of the ranked match are recorded, board by board: placements with the server's times", [recs.map((x) => `${x.n}${x.seat}:${x.solved}:${x.ms}:${x.correct}`), recs.every((x) => x.ranked === 1 && x.rating === 1000), JSON.parse(recs[0].track)],
    [["1a:1:12000:4", "1b:0:null:0", "2a:0:null:0", "2b:1:18000:5", "3a:1:21000:6", "3b:0:null:0"], true, [[0, "A", [0, 0]], [3000, "B", [1, 2]], [6000, "C", [2, 4]], [9000, "D", [3, 1]], [12000, "S", [4, 4]]]]);
  eq("each was dealt the three boards", rows("SELECT account_id, board_id, times FROM duel_dealt WHERE account_id IN (?, ?) ORDER BY account_id, board_id", A.account.id, B.account.id).map((x) => `${x.account_id === A.account.id ? "A" : "B"}:${x.board_id}:${x.times}`),
    ["A:d5a:1", "A:d6a:1", "A:d7a:1", "B:d5a:1", "B:d6a:1", "B:d7a:1"]);
  let frozen = "";
  try { d1.raw.prepare("UPDATE duel_matches SET result = 'b', a_delta = 500 WHERE id = ?").run(firstMatch); } catch (e) { frozen = String(e.message); }
  let frozenBoard = "";
  try { d1.raw.prepare("UPDATE duel_boards SET winner = 'b' WHERE match_id = ? AND n = 1").run(firstMatch); } catch (e) { frozenBoard = String(e.message); }
  eq("the database itself refuses to rewrite a finished match or board", [/finished match/.test(frozen), /finished board/.test(frozenBoard)], [true, true]);
}

/* ───────────── a timeout decided on placements, a tie, a drawn match ───────────── */
const C = await full("time-c"), D = await full("time-d");
{
  const m = await pair(C, D);
  await toStart(m, [C, D]);
  await play(C, m, 1, { count: 2, others: [D] });                     // C: two scapegoats right
  await put(D, m, 1, "A", [0, 0]);                                    // D: one right…
  await put(D, m, 1, "B", [4, 0]);                                    // …one wrong
  await put(D, m, 1, "S", [4, 4]);                                    // …and S. H. Adow right: he is not a scapegoat
  const start = one("SELECT starts_at, deadline FROM duel_boards WHERE match_id = ? AND n = 1", m);
  await wait(start.deadline - 1000 - T, [C, D]);
  eq("one second before the 3 minutes: the board is open, no count is told", [(await st(C)).match.boards[0].endedAt, (await st(C)).match.boards[0].you], [null, { ms: null, correct: null }]);
  T += 1000;
  const lateOne = await put(D, m, 1, "B", [1, 2]); // would have made it 2-2
  const tc = await st(C), b = tc.match.boards[0];
  eq("at 3 minutes the board is decided on correctly placed scapegoats: 2 against 1; a placement at the bell is too late", [lateOne.body.results, b.how, b.winner, b.you, b.them, b.endedAt === start.deadline, tc.match.boards[1].startsAt - start.deadline, tc.match.wins, leaks(tc)],
    [["late"], "timeout", "you", { ms: null, correct: 2 }, { ms: null, correct: 1 }, true, 10000, { you: 1, them: 0 }, []]);
  await toStart(m, [C, D], 2);
  await play(C, m, 2, { count: 1, others: [D] });
  await play(D, m, 2, { count: 1, others: [C] });
  await wait(one("SELECT deadline FROM duel_boards WHERE match_id = ? AND n = 2", m).deadline - T, [C, D]);
  const t2 = (await st(D)).match;
  eq("the same number right at the timeout: a tie, the board is nobody's", [t2.boards[1].how, t2.boards[1].winner, t2.boards[1].you, t2.boards[1].them, t2.wins, t2.board], ["timeout", "tie", { ms: null, correct: 1 }, { ms: null, correct: 1 }, { you: 0, them: 1 }, 3]);
  await toStart(m, [C, D], 3);
  const r3 = await play(D, m, 3, { others: [C] });
  eq("one board each and a tie: the match is drawn, no rating moves, both have played one", [r3.body.match.result, r3.body.match.wins, r3.body.match.delta, (await st(C, `?match=${m}`)).match.result, rating(C), rating(D)],
    ["draw", { you: 1, them: 1 }, 0, "draw", { rating: 1000, played: 1, wins: 0, losses: 0, draws: 1, streak: 0 }, { rating: 1000, played: 1, wins: 0, losses: 0, draws: 1, streak: 0 }]);
}

/* ───────────── a disconnect in the middle of a board ───────────── */
const E = await full("net-e"), F = await full("net-f");
{
  const m = await pair(E, F);
  await toStart(m, [E, F]);
  await play(E, m, 1, { count: 2, others: [F] });
  await wait(12000, [F], 1000); // E's phone is in a tunnel for 12 seconds; F plays on
  const back = await st(E);
  eq("back after 12 seconds: the match goes on, the pieces are where the server kept them", [back.state, back.match.tokens, back.match.seq, back.match.boards[0].endedAt], ["match", { A: [0, 0], B: [1, 2] }, 2, null]);
  T += 40000; // the server itself is unreachable for 40 seconds: both are cut off
  eq("both cut off at once: nobody forfeits, whoever comes back first", [(await st(E)).state, (await st(F)).state, matchRow(m).state], ["match", "match", "live"]);
  await wait(28000, [E], 1000); // now F is gone for good; E keeps playing
  eq("F away, 28 seconds: still a match", (await st(E)).state, "match");
  await wait(8000, [E], 1000);
  const won = await st(E, `?match=${m}`);
  eq("F away for over 30 seconds while E played on: the match is E's, a forfeit; a ranked one, so the ratings move", [won.state, won.match.result, won.match.how, won.match.boards[0].how, won.match.boards[0].winner, won.match.delta, rating(E).rating, rating(F).rating],
    ["done", "win", "forfeit", "forfeit", "you", 20, 1020, 980]);
  const lost = await st(F, `?match=${m}`);
  eq("F comes back to a match that is over, and is free to play again", [lost.match.result, lost.match.how, lost.match.delta, (await st(F)).state, (await put(F, m, 1, "A", [0, 0])).body.results], ["loss", "forfeit", -20, "idle", ["late"]]);
  // giving up
  const m2 = await pair(E, F);
  const gone = await leave(E, m2);
  // 1020 against 980: E was expected to score 0.557, so losing costs 22 (K 40), and F gains the same
  eq("leaving a match gives it to the opponent, before the first board even starts; leaving twice costs once", [gone.body.match.result, gone.body.match.how, (await st(F, `?match=${m2}`)).match.result, rating(E).rating, rating(F).rating, answer(await leave(E, m2)), rating(E).rating],
    ["loss", "left", "win", 998, 1002, 200, 998]);
}

/* ───────────── the queue: the band, the closest rating, a player who stops asking ───────────── */
{
  const setRating = (p, r) => d1.raw.prepare("INSERT INTO duel_ratings (account_id, rating, best_rating) VALUES (?, ?, ?) ON CONFLICT (account_id) DO UPDATE SET rating = excluded.rating").run(p.account.id, r, r);
  const Q1 = await full("q-1"), Q2 = await full("q-2"), Q3 = await full("q-3"), Q4 = await full("q-4"), Q5 = await full("q-5");
  setRating(Q1, 1000); setRating(Q2, 1250); setRating(Q3, 1070); setRating(Q4, 1150);
  await join(Q1); await join(Q2);
  await wait(19000, [Q1, Q2], 1000);
  eq("250 points apart: not yet at 19 seconds", [(await st(Q1)).state, (await st(Q2)).state], ["queue", "queue"]);
  T += 1000;
  const met = await st(Q1);
  eq("…at 20 seconds the band (+-300) takes them", [met.state, met.match.opponent.rating, (await st(Q2)).match.opponent.rating, matchRow(met.match.id).kind], ["match", 1250, 1000, "ranked"]);
  await leave(Q1, met.match.id);
  setRating(Q1, 1000); setRating(Q2, 1250);
  await join(Q1); await join(Q4);
  T += 1000;
  const near = await join(Q3);
  eq("of two waiting players inside the band, the closer rating is met", [near.body.state, near.body.match.opponent.rating, (await st(Q4)).state], ["match", 1000, "queue"]);
  await leave(Q3, near.body.match.id);
  await app("DELETE", "/api/app/duel/queue", Q4.token);
  eq("leaving the queue", [(await st(Q4)).state, rows("SELECT * FROM duel_queue").length], ["idle", 0]);
  await join(Q5);
  T += 25000; // the app was closed while waiting
  const away = await st(Q5);
  eq("a player who stopped asking is no longer waiting, and is not handed a match on return", [away.state, away.queueEnded, rows("SELECT * FROM duel_queue").length, (await st(Q5)).queueEnded], ["idle", "away", 0, undefined]);
  await join(Q5);
  T += 12000; // heard from 12 seconds ago: not gone, but nobody's opponent right now
  eq("a waiting player not heard from for a moment is not matched", [(await join(Q4)).body.state, (await st(Q5)).state === "match" || (await st(Q4)).state === "match"], ["queue", true]);
  for (const p of [Q4, Q5]) { const s = await st(p); if (s.match) await leave(p, s.match.id); }
}

/* ───────────── a bot that replays a recording; never the player's own ───────────── */
{
  const R = await full("rec-r");
  await join(R);
  await wait(60000, [R], 2000);
  const s = await st(R), plans = JSON.parse(matchRow(s.match.id).bot);
  const recA = one("SELECT track, ms FROM duel_recordings WHERE match_id = ? AND n = 1 AND seat = 'a'", firstMatch);
  eq("recordings exist now: the bot replays a player's solved board of about that rating (never one flagged as too fast)", [plans.map((p) => p.source), plans[0].ms, JSON.stringify(plans[0].track) === recA.track, plans[1].ms, [21000].includes(plans[2].ms)],
    [["recording", "recording", "recording"], 12000, true, 18000, true]);
  await toStart(s.match.id, [R]);
  await wait(11000, [R], 1000);
  eq("…at the recorded times: 11 seconds in, four pieces down", [(await st(R)).match.placed.them, (await st(R)).match.boards[0].endedAt], [4, null]);
  T += 1000;
  const b1 = (await st(R)).match.boards[0];
  eq("…and it finishes when the recorded player did", [b1.winner, b1.them], ["them", { ms: 12000, correct: 4 }]);
  await leave(R, s.match.id);
  // A alone in the queue: the only solved recording of the 5 x 5 at A's rating is A's own
  await join(A);
  await wait(60000, [A], 2000);
  const sa = await st(A), mine = JSON.parse(matchRow(sa.match.id).bot);
  eq("a player never meets its own recording", [mine[0].source, mine[1].source], ["walk", "recording"]);
  await leave(A, sa.match.id);
}

/* ───────────── dealing: a board comes back only when no other is left ───────────── */
{
  T += 60000;
  pushBoards(d1, [mkCase("d5b", 5), mkCase("d6b", 6), mkCase("d7b", 7)]);
  d1.raw.prepare("UPDATE duel_ratings SET played = 20 WHERE account_id = ?").run(A.account.id);
  const N = await full("new-n");
  d1.raw.prepare("INSERT INTO duel_ratings (account_id, rating, best_rating) VALUES (?, ?, ?)").run(N.account.id, rating(A).rating, rating(A).rating);
  const m = await pair(A, N);
  eq("new boards in the pool: a player who had the old ones gets the new, and so does the opponent; K is 24 after 20 matches", [boardIds(m), matchRow(m).a_k, matchRow(m).b_k], [["d5b", "d6b", "d7b"], 24, 40]);
  await leave(N, m); // before board 2: A was dealt only the new 5 x 5
  await join(A);
  await wait(60000, [A], 2000);
  const next = (await st(A)).match.id;
  eq("next time: the 5 x 5 seen longest ago returns (both were dealt), the other sizes still have a board A never saw", boardIds(next), ["d5a", "d6b", "d7b"]);
  await leave(A, next);
  const dealt = (id) => rows("SELECT board_id, times FROM duel_dealt WHERE account_id = ? ORDER BY board_id", id).map((x) => `${x.board_id}:${x.times}`);
  eq("what each was dealt: only boards that started", [dealt(A.account.id), dealt(N.account.id)], [["d5a:3", "d5b:1", "d6a:1", "d7a:1"], ["d5b:1"]]);
  pushBoards(d1, [], { retire: ["d5a"] });
  await join(N);
  await wait(60000, [N], 2000);
  const nm = (await st(N)).match.id;
  eq("a retired board is never dealt, even as the only one a player has not seen", boardIds(nm)[0], "d5b");
  await leave(N, nm);
  pushBoards(d1, [mkCase("d5a", 5)]);
  eq("pushing a board again switches it back on and changes nothing else", [one("SELECT active FROM duel_pool WHERE id = 'd5a'").active, rows("SELECT id FROM duel_pool").length], [1, 6]);
  pushBoards(d1, [mkCase("d5a", 5, { title: "Another board under an old id" })]);
  eq("a changed file under an old id is not loaded over it", JSON.parse(one("SELECT body FROM duel_pool WHERE id = 'd5a'").body).title, "Board d5a");
}

/* ───────────── a friendly match: by invitation, and it changes nothing ───────────── */
{
  const Y = await full("friend-y"), Z = await full("friend-z");
  await setCodename(env, Y.account.id, "Lantern_Y");
  const before = { a: one("SELECT * FROM duel_ratings WHERE account_id = ?", A.account.id), recs: rows("SELECT COUNT(*) AS n FROM duel_recordings")[0].n };
  eq("an invitation needs a signed-in account that is not the caller's", [answer(await app("POST", "/api/app/duel/invites", A.token, { to: A.account.id })), answer(await app("POST", "/api/app/duel/invites", A.token, { to: "google:nobody" })), answer(await app("POST", "/api/app/duel/invites", A.token, { to: (await guest()).account.id })), answer(await app("POST", "/api/app/duel/invites", A.token, {}))],
    ["400 self", "404 no_account", "404 no_account", "400 format"]);
  const inv = await app("POST", "/api/app/duel/invites", A.token, { to: Y.account.id }), id = inv.body.invite.id;
  eq("A invites Y: open for a day; asked twice it is the same invitation", [inv.status, inv.body.invite.from, inv.body.invite.to, inv.body.invite.expires - T, inv.body.invite.state, (await app("POST", "/api/app/duel/invites", A.token, { to: Y.account.id })).body],
    [200, "you", "Lantern_Y", 86400000, "open", { ok: true, duplicate: true, invite: inv.body.invite }]);
  const inbox = (await app("GET", "/api/app/duel/invites", Y.token)).body;
  eq("it is in Y's inbox, by codename; the state counts it", [inbox.incoming.map((i) => [i.id === id, i.from, i.to, i.waiting]), inbox.outgoing, (await st(Y)).invites, JSON.stringify(inbox).includes(A.account.id)], [[[true, "Lantern_A", "you", false]], [], 1, false]);
  eq("nobody else can enter its room", [answer(await join(Z, { invite: id })), answer(await join(Z, { invite: "x" })), answer(await app("POST", "/api/app/duel/invites/respond", Z.token, { id, action: "decline" }))], ["404 no_invite", "400 format", "404 no_invite"]);
  const room = await join(A, { invite: id });
  eq("A waits in the room; Y sees that", [room.body.state, room.body.queue.invite === id, (await app("GET", "/api/app/duel/invites", Y.token)).body.incoming[0].waiting], ["queue", true, true]);
  await join(Z); // Z waits in the ranked queue meanwhile: a room and the queue never mix
  T += 3000;
  eq("…and is not matched with anyone in the ranked queue", [(await st(A)).state, (await st(Z)).state], ["queue", "queue"]);
  const start = await join(Y, { invite: id });
  const fm = start.body.match.id;
  A.seq = 0; Y.seq = 0;
  eq("Y enters: a friendly match, the invitation is used up", [start.body.state, start.body.match.kind, (await st(A)).match.kind, one("SELECT state, match_id FROM duel_invites WHERE id = ?", id), matchRow(fm).a_k, matchRow(fm).b_k, (await st(Y)).invites],
    ["match", "friendly", "friendly", { state: "played", match_id: fm }, 0, 0, 0]);
  await app("DELETE", "/api/app/duel/queue", Z.token);
  await toStart(fm, [A, Y]);
  await play(A, fm, 1, { others: [Y] });
  await toStart(fm, [A, Y], 2);
  const done = await play(A, fm, 2, { others: [Y] });
  eq("A wins it 2-0: the third board is never played", [done.body.state, done.body.match.result, done.body.match.wins, done.body.match.boards.length, done.body.match.delta, (await st(Y, `?match=${fm}`)).match.delta], ["done", "win", { you: 2, them: 0 }, 2, null, null]);
  eq("a friendly match changes no rating, makes none, and leaves no recording", [JSON.stringify(one("SELECT * FROM duel_ratings WHERE account_id = ?", A.account.id)) === JSON.stringify(before.a), rows("SELECT * FROM duel_ratings WHERE account_id = ?", Y.account.id), rows("SELECT * FROM duel_recordings WHERE match_id = ?", fm).length, rows("SELECT COUNT(*) AS n FROM duel_recordings")[0].n === before.recs, matchRow(fm).a_delta],
    [true, [], 0, true, null]);
  eq("a used invitation opens no second room", [answer(await join(A, { invite: id })), answer(await app("POST", "/api/app/duel/invites/respond", Y.token, { id, action: "decline" }))], ["409 invite_closed", "409 invite_closed"]);
  // a room nobody joins: a minute, then nothing (never a bot); declining; taking it back
  const inv2 = (await app("POST", "/api/app/duel/invites", A.token, { to: Y.account.id })).body.invite.id;
  await join(A, { invite: inv2 });
  await wait(59000, [A], 2000);
  eq("alone in the room, 59 seconds", (await st(A)).state, "queue");
  T += 1000;
  const alone = await st(A);
  eq("a minute alone in the room: nobody came, and no bot takes a friend's place; the invitation is still open", [alone.state, alone.queueEnded, rows("SELECT * FROM duel_matches WHERE state = 'live'").length, one("SELECT state FROM duel_invites WHERE id = ?", inv2).state], ["idle", "nobody", 0, "open"]);
  await join(A, { invite: inv2 });
  const no = await app("POST", "/api/app/duel/invites/respond", Y.token, { id: inv2, action: "decline" });
  eq("Y declines: the invitation closes and A's wait ends", [no.body.invite.state, (await st(A)).state, answer(await app("POST", "/api/app/duel/invites/respond", A.token, { id: inv2, action: "cancel" }))], ["declined", "idle", "409 invite_closed"]);
  const inv3 = (await app("POST", "/api/app/duel/invites", A.token, { to: Y.account.id })).body.invite.id;
  eq("A takes an invitation back; only the inviter can", [answer(await app("POST", "/api/app/duel/invites/respond", Y.token, { id: inv3, action: "cancel" })), (await app("POST", "/api/app/duel/invites/respond", A.token, { id: inv3, action: "cancel" })).body.invite.state, (await app("GET", "/api/app/duel/invites", Y.token)).body.incoming], ["404 no_invite", "cancelled", []]);
  const inv4 = (await app("POST", "/api/app/duel/invites", A.token, { to: Y.account.id })).body.invite.id;
  T += 86400000;
  eq("after a day an invitation has run out", [(await app("GET", "/api/app/duel/invites", Y.token)).body.incoming, answer(await join(Y, { invite: inv4 })), (await st(Y)).invites], [[], "409 invite_closed", 0]);
}

/* ───────────── two requests at once: a board ends once, a match ends once, a rating moves once ───────────── */
{
  const I = await full("race-i"), J = await full("race-j");
  const m = await pair(I, J);
  await toStart(m, [I, J]);
  await play(I, m, 1, { count: 4, others: [J] });
  await play(J, m, 1, { count: 4, others: [I] });
  T += 3000;
  // both put their last piece down in the same millisecond, in two requests that run through each other
  const [ri, rj] = await Promise.all([put(I, m, 1, "S", [4, 4]), put(J, m, 1, "S", [4, 4])]);
  const b = one("SELECT winner, how, a_ms, b_ms FROM duel_boards WHERE match_id = ? AND n = 1", m), vi = (await st(I)).match, vj = (await st(J)).match;
  eq("two last pieces in the same instant: the board is decided once and both are told the same (a tie when the server saw both)", [["ok", "late"].includes(ri.body.results[0]), ["ok", "late"].includes(rj.body.results[0]), b.how, ["a", "b", "tie"].includes(b.winner), vi.wins.you === vj.wins.them, vi.wins.them === vj.wins.you, vi.wins.you + vi.wins.them === (b.winner === "tie" ? 0 : 1), vi.board, rows("SELECT * FROM duel_boards WHERE match_id = ?", m).length],
    [true, true, "finish", true, true, true, true, 2, 2]);
  // nobody plays the rest; at each bell both phones ask several times at once
  for (const nb of [2, 3]) {
    if (matchRow(m).state !== "live") break;
    await wait(one("SELECT deadline FROM duel_boards WHERE match_id = ? AND n = ?", m, nb).deadline - T - 1000, [I, J]);
    T += 1000;
    await Promise.all([st(I), st(J), st(I), st(J), st(I)]);
  }
  const done = matchRow(m), ri2 = rating(I), rj2 = rating(J);
  eq("several requests at each bell: three boards, one result, each rating changed exactly once and by opposite amounts", [done.state, rows("SELECT n FROM duel_boards WHERE match_id = ? AND ended_at IS NOT NULL", m).length, ri2.played, rj2.played, ri2.rating + rj2.rating, ri2.rating - 1000 === done.a_delta, rj2.rating - 1000 === done.b_delta, rows("SELECT * FROM duel_recordings WHERE match_id = ?", m).length],
    ["done", 3, 1, 1, 2000, true, true, 6]);
  // two players who each find the other in the queue at the same moment
  const K1 = await full("race-k1"), K2 = await full("race-k2"), K3 = await full("race-k3");
  await Promise.all([join(K1), join(K2), join(K3)]);
  T += 1000;
  const [s1, s2, s3] = await Promise.all([st(K1), st(K2), st(K3)]), live = rows("SELECT a, b FROM duel_matches WHERE state = 'live'");
  eq("three join at once: one match of two, the third still waits, nobody is in two matches", [live.length, [s1, s2, s3].filter((x) => x.state === "match").length, [s1, s2, s3].filter((x) => x.state === "queue").length, rows("SELECT * FROM duel_queue").length], [1, 2, 1, 1]);
  for (const [p, x] of [[K1, s1], [K2, s2], [K3, s3]]) { if (x.match) await leave(p, x.match.id); else await app("DELETE", "/api/app/duel/queue", p.token); }
}

/* ───────────── more events than a board can need ───────────── */
{
  const X = await full("flood-x");
  await join(X);
  await wait(60000, [X], 2000);
  const m = (await st(X)).match.id;
  X.seq = 0;
  await toStart(m, [X]);
  let last;
  for (let call = 0; call < 10; call++) last = await send(X, m, Array.from({ length: 20 }, () => ({ seq: ++X.seq, board: 1, id: "A", cell: [X.seq % 5, 0] })));
  const over = await put(X, m, 1, "A", [0, 0]);
  eq("200 events on a board are taken, the next is not; the account is flagged", [last.body.results.every((r) => r === "ok"), over.body.results, one("SELECT events FROM duel_recordings WHERE match_id = ? AND n = 1", m).events, rows("SELECT kind FROM flags WHERE account_id = ?", X.account.id).map((f) => f.kind), answer(await send(X, m, Array(21).fill({ seq: 1, board: 1, id: "A", cell: null })))],
    [true, ["too_many"], 200, ["duel_flood"], "400 format"]);
  await leave(X, m);
}

/* ───────────── matches nobody comes back to: the nightly sweep ───────────── */
{
  const U = await full("gone-u"), V = await full("gone-v"), W = await full("gone-w");
  const m = await pair(U, V);
  await toStart(m, [U, V]);
  await put(U, m, 1, "A", [0, 0]);
  await join(W);
  await wait(60000, [W], 2000);
  const wm = (await st(W)).match.id;
  T += 3600000; // an hour later nobody has come back
  eq("a dry run counts them", await sweepDuels(env, { now: T, dry: true }), { due: 2, closed: 0 });
  eq("the sweep ends both", [await sweepDuels(env, { now: T }), await sweepDuels(env, { now: T })], [{ due: 2, closed: 2 }, { due: 0, closed: 0 }]);
  const mu = matchRow(m), bs = rows("SELECT n, winner, how, a_correct, b_correct FROM duel_boards WHERE match_id = ? ORDER BY n", m);
  eq("two players who both left: each board is decided at its own 3 minutes, on what was placed", [bs.map((b) => `${b.n}:${b.winner}:${b.how}:${b.a_correct}-${b.b_correct}`), mu.state, mu.result, mu.how, mu.a_wins, mu.b_wins, mu.ended - mu.created, rating(U), rating(V).rating],
    [["1:a:timeout:1-0", "2:tie:timeout:0-0", "3:tie:timeout:0-0"], "done", "a", "boards", 1, 0, 3 * 190000, { rating: 1020, played: 1, wins: 1, losses: 0, draws: 0, streak: 1 }, 980]);
  eq("a player who left a bot waiting has lost to it", [matchRow(wm).result, matchRow(wm).how, rating(W).rating], ["b", "boards", 980]);
  const rk = await app("GET", "/api/app/duel/ranking", U.token), rkg = await app("GET", "/api/app/duel/ranking", (await guest()).token);
  const pl = rk.body.players;
  eq("the 1v1 ranking: best rating first, ranks 1.., my own row marked with its true place, no account id in it; a guest is refused",
    [rk.status, pl.every((r, i) => r.rank === i + 1 && (i === 0 || pl[i - 1].rating >= r.rating)), rk.body.me.rating, rk.body.me.me, rk.body.me.rank === pl.findIndex((r) => r.me) + 1 || !pl.some((r) => r.me), rk.body.total >= 3, JSON.stringify(rk.body).includes("gone-u"), rkg.status],
    [200, true, 1020, true, true, true, false, 403]);
}

/* ───────────── only one place moves a rating; deleting an account ───────────── */
{
  const writers = [];
  const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (/\.js$/.test(f.name) && /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+duel_ratings\b/i.test(fs.readFileSync(p, "utf8"))) writers.push(path.relative(ROOT, p).replace(/\\/g, "/")); } };
  walk(path.join(ROOT, "functions"));
  eq("only duel.js writes a rating", writers, ["functions/_lib/app/duel.js"]);
  eq("no duel endpoint is a hint or an answer endpoint", fs.readdirSync(path.join(ROOT, "functions", "api", "app", "duel"), { recursive: true }).map(String).map((f) => f.replace(/\\/g, "/")).sort(), ["events.js", "index.js", "invites", "invites/index.js", "invites/respond.js", "leave.js", "queue.js", "ranking.js"]);
  const names = () => ["duel_ratings", "duel_queue", "duel_dealt", "duel_recordings"].map((t) => rows(`SELECT COUNT(*) AS n FROM ${t} WHERE account_id = ?`, B.account.id)[0].n);
  await app("POST", "/api/app/duel/invites", B.token, { to: A.account.id });
  await app("POST", "/api/app/duel/invites", A.token, { to: B.account.id });
  await join(B);
  eq("B has a rating, a wait, boards dealt, recordings, invitations", [names().every((x) => x > 0), rows("SELECT * FROM duel_invites WHERE state = 'open' AND (account_id = ?1 OR to_account = ?1)", B.account.id).length], [true, 2]);
  const del = await app("DELETE", "/api/account", B.token);
  const m = matchRow(firstMatch), seenByA = await st(A, `?match=${firstMatch}`);
  eq("deleting the account takes all of it; the match stays for the opponent, without B", [del.status, names(), rows("SELECT * FROM duel_invites WHERE account_id = ?1 OR to_account = ?1", B.account.id).length, m.b, m.b_name, m.result, m.a_delta, seenByA.match.result, seenByA.match.opponent.name, rating(A).rating > 0],
    [200, [0, 0, 0, 0], 0, "erased", "", "a", 20, "win", "", true]);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${n} checks, ${bad.length} failed`);
bad.forEach((b) => console.log("  FAIL " + b));
process.exit(bad.length ? 1 : 0);
