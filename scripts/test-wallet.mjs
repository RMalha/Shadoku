// The app's wallet backend (functions/api/app/**, functions/_lib/app/**), tested in plain node:   npm run test:wallet
// The endpoint handlers are called directly, against a SQLite database with the real migrations/ applied (scripts/lib/d1-sqlite.mjs)
// and a clock the test moves. What is checked, above all: nothing a client sends can create coins. Every balance is the sum of
// ledger lines the server wrote, each kind of line is bounded, and every resend, replay or race pays once.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openD1 } from "./lib/d1-sqlite.mjs";
import { seal } from "../functions/_lib/auth.js";
import { sealAppToken, eraseAppAccount } from "../functions/_lib/app/context.js";
import { post, newOp } from "../functions/_lib/app/ledger.js";
import * as eco from "../functions/_lib/app/economy.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const SITE = "https://www.shadoku.net", LOCAL = "http://localhost:8788";

let n = 0; const bad = [];
const ok = (what, cond) => { n++; if (!cond) bad.push(what); };
const eq = (what, got, want) => ok(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`, JSON.stringify(got) === JSON.stringify(want));

/* ───────────── harness ───────────── */
const d1 = openD1(path.join(ROOT, "migrations"));
let NOW = Date.UTC(2026, 10, 16, 12); // Monday 2026-11-16, 12:00 UTC
const baseEnv = { SHADOKU_DB: d1, SESSION_SECRET: "test-secret-".repeat(4), NOW: () => NOW };
/** Moves the clock to 12:00 UTC of the next Monday. The clock only ever goes forward. */
const toMonday = () => { do NOW += DAY; while (new Date(NOW).getUTCDay() !== 1); NOW = eco.dayStart(eco.dayKey(NOW)) + 12 * HOUR; };
const today = () => eco.dayKey(NOW);

const ROUTES = {
  "GET /wallet": "wallet.js", "GET /bootstrap": "bootstrap.js", "POST /sync": "sync.js", "GET /shop": "shop/index.js", "POST /shop/buy": "shop/buy.js",
  "POST /ads/ticket": "ads/ticket/index.js", "GET /ads/ticket/:id": "ads/ticket/[id].js", "GET /ads/ssv": "ads/ssv.js", "POST /ads/claim": "ads/claim.js",
  "POST /billing/verify": "billing/verify.js", "POST /billing/rtdn": "billing/rtdn.js", "POST /quests/claim": "quests/claim.js", "POST /quests/refresh": "quests/refresh.js",
  "POST /streak/claim": "streak/claim.js", "POST /social/open": "social/open.js", "POST /social/claim": "social/claim.js",
};
const tokens = new Map();
const tokenFor = async (id) => { if (!tokens.has(id)) tokens.set(id, await sealAppToken(baseEnv, { id })); return tokens.get(id); };

/** Calls an endpoint as the app would. `as`: the account id (a bearer token is made for it). → { status, body } */
async function call(route, { as, body, headers = {}, env = {}, params = {}, query = "", host = SITE } = {}) {
  const [method, pattern] = route.split(" ");
  const mod = await import(pathToFileURL(path.join(ROOT, "functions", "api", "app", ROUTES[route])).href);
  const h = new Headers(headers);
  if (as) h.set("Authorization", `Bearer ${await tokenFor(as)}`);
  const url = host + "/api/app" + pattern.replace(":id", params.id || "") + query;
  const request = new Request(url, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const handler = mod[`onRequest${method[0]}${method.slice(1).toLowerCase()}`];
  const res = await handler({ request, env: { ...baseEnv, ...env }, params });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/**
 * Runs the calls as truly simultaneous requests: every one does its reads, then all of them reach their write (a batch) before
 * any is let through, round after round. The worst case for a check that was made on a value read earlier.
 */
async function atOnce(calls) {
  d1.hold();
  let settled = 0;
  const running = calls.map((start) => start().finally(() => { settled++; }));
  while (settled < calls.length) {
    for (let i = 0; i < 300 && d1.waiting() + settled < calls.length; i++) await new Promise((r) => setTimeout(r, 1));
    d1.release();
    await new Promise((r) => setImmediate(r));
  }
  d1.release(true);
  return Promise.all(running);
}

const rows = (sql, ...binds) => d1.raw.prepare(sql).all(...binds);
const one = (sql, ...binds) => rows(sql, ...binds)[0];
const wallet = (id) => one("SELECT coins, hints FROM wallets WHERE account_id = ?", id) || { coins: 0, hints: 0 };
const coins = (id) => wallet(id).coins;
const uid = () => crypto.randomUUID();
const solveEv = (caseId, extra = {}) => ({ eventId: uid(), type: "solve", caseId, seconds: 300, hints: 0, ...extra });
const sync = (as, events, extra = {}) => call("POST /sync", { as, body: { events, ...extra } });
const results = (r) => r.body.results.map((x) => x.result).join();
/** Coins or hints from the server's own side (an Inbox grant, say): written through the ledger like everything else. */
async function grant(id, delta, currency = "coin") {
  await call("GET /wallet", { as: id });
  await d1.batch(post(d1, { id: newOp(), account: id, currency, delta, reason: "grant", ref: uid(), day: today(), at: NOW }));
}
const setConfig = (k, v) => d1.raw.prepare("INSERT INTO app_config (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").run(k, JSON.stringify(v));
const dropConfig = (k) => d1.raw.prepare("DELETE FROM app_config WHERE k = ?").run(k);

// the server's case index, as scripts/app-case-index.mjs would write it
const CASES = { tut1: ["tutorial", "Tutorial", 5], tut2: ["tutorial", "Tutorial", 5], ve1: ["classic", "Very Easy", 6], m1: ["classic", "Medium", 8], h1: ["story", "Hard", 9], x1: ["story", "Expert", 10], x2: ["classic", "Expert", 10] };
for (let i = 1; i <= 60; i++) CASES[`e${i}`] = ["story", "Easy", 7];
for (const [id, [mode, difficulty, size]] of Object.entries(CASES)) d1.raw.prepare("INSERT INTO case_index (case_id, mode, difficulty, size) VALUES (?, ?, ?, ?)").run(id, mode, difficulty, size);
d1.raw.prepare("INSERT INTO case_index (case_id, mode, difficulty, size, active) VALUES ('retired', 'story', 'Expert', 10, 0)").run();
const REWARD_OF = (id) => (CASES[id][0] === "tutorial" ? 25 : eco.REWARDS[eco.difficultyKey(CASES[id][1])]);
// test goods beside the seeded ones. Each cosmetic here is alone on its shelf (group and rarity), so it is always "of the day";
// mask_a and mask_b share one shelf, priced by rarity.
const ITEMS = [ // id, kind, rarity, price_coins, sku, data, active, starts, ends
  ["hints3", "hint_bundle", "", 30, null, '{"hints":3}', 1, null, null], ["hat", "avatar", "common", 20, null, "{}", 1, null, null], ["lamp", "prop", "common", 10, null, "{}", 1, null, null],
  ["rug", "prop", "rare", 15, null, "{}", 1, null, null], ["sofa", "furniture", "epic", 40, null, "{}", 1, null, null], ["gone", "prop", "legendary", 1, null, "{}", 0, null, null],
  ["expired", "prop", "legendary", 1, null, "{}", 1, null, NOW - DAY], ["future", "prop", "legendary", 1, null, "{}", 1, NOW + 4000 * DAY, null],
  ["free", "hint_bundle", "", 0, null, '{"hints":1}', 1, null, null], ["hints5_money", "hint_bundle", "", null, "hints_5_money", '{"hints":5}', 1, null, null],
  ["mask_a", "avatar", "rare", null, null, "{}", 1, null, null], ["mask_b", "avatar", "rare", null, null, "{}", 1, null, null], ["plain", "prop", "", null, null, "{}", 1, null, null],
];
for (const it of ITEMS) d1.raw.prepare("INSERT INTO items (id, kind, rarity, price_coins, sku, data, active, starts, ends) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(...it);
// every quest dealt to everyone: the scripted tests below name quests (dealing a few of them, and refreshing, has its own section)
setConfig("daily_quests", 5); setConfig("weekly_quests", 3);

/* ───────────── the brief's numbers and the calendar ───────────── */
eq("solve rewards are the brief's", eco.REWARDS, { tutorial: 25, very_easy: 5, easy: 10, medium: 15, hard: 20, expert: 25 });
eq("an ad pays 5, three a day", [eco.AD_COIN_REWARD, eco.CONFIG_DEFAULTS.ad_coins_per_day], [5, 3]);
eq("a social visit pays 25, on three networks", [eco.SOCIAL_REWARD, eco.SOCIAL_NETWORKS.length], [25, 3]);
eq("the seeded quests are the brief's examples", rows("SELECT id, period, kind, target, reward FROM quest_defs ORDER BY id").map((q) => `${q.id}:${q.period}:${q.kind}:${q.target}:${q.reward}`), [
  "d_expert1:daily:solve_expert:1:25", "d_nohint2:daily:solve_no_hints:2:25", "d_pack1:daily:open_pack:1:10", "d_solve2:daily:solve:2:10", "d_solve5:daily:solve:5:25",
  "w_nohint5:weekly:solve_no_hints:5:100", "w_props8:weekly:new_props:8:120", "w_solve20:weekly:solve:20:100"]);
eq("the seeded coin packs are the brief's", rows("SELECT sku, data FROM items WHERE kind = 'coin_pack' ORDER BY id").map((i) => `${i.sku}=${JSON.parse(i.data).coins}`), ["coins_100=100", "coins_1200=1200", "coins_2500=2500", "coins_500=500"]);
eq("dayKey follows the time zone", [eco.dayKey(Date.UTC(2026, 10, 16, 23, 30)), eco.dayKey(Date.UTC(2026, 10, 16, 23, 30), 60), eco.dayKey(Date.UTC(2026, 10, 16, 0, 30), -60)], ["2026-11-16", "2026-11-17", "2026-11-15"]);
eq("clampTz keeps real offsets only", [eco.clampTz(99999), eco.clampTz(-99999), eco.clampTz("60"), eco.clampTz(NaN), eco.clampTz(540.7)], [840, -720, 0, 0, 540]);
eq("weeks start on Monday", [eco.weekStart("2026-11-16"), eco.weekStart("2026-11-22"), eco.weekStart("2026-11-23")], ["2026-11-16", "2026-11-16", "2026-11-23"]);
eq("period keys", [eco.periodKey("daily", "2026-11-18"), eco.periodKey("weekly", "2026-11-18")], ["d:2026-11-18", "w:2026-11-16"]);
eq("an event's time is believed only between the last sync and now", [eco.clampAt(50, 100, 200), eco.clampAt(150, 100, 200), eco.clampAt(999, 100, 200), eco.clampAt("x", 100, 200), eco.clampAt(150, 0, 200), eco.clampAt(1, 300, 200)], [100, 150, 200, 200, 200, 200]);
ok("not a real date", Number.isNaN(eco.dayStart("2026-02-30")) && Number.isNaN(eco.dayStart("2026-13-01")) && Number.isNaN(eco.dayStart(20261116)));
eq("the daily plan follows the engine's weekdays", ["2026-11-09", "2026-11-10", "2026-11-12", "2026-11-14", "2026-11-15"].map((d) => eco.dailyCase(`daily-${d}`, NOW, eco.CONFIG_DEFAULTS).difficulty), ["very_easy", "easy", "medium", "hard", "expert"]);
eq("config: bad overrides are ignored", (() => { const c = eco.parseConfig([{ k: "sync_max_events", v: "-5" }, { k: "ad_coins_per_day", v: '"9"' }, { k: "nope", v: "1" }, { k: "daily_quests", v: "{" }, { k: "min_solve_seconds", v: '{"7":5,"x":1}' }, { k: "daily_earn_cap", v: "30" }]); return [c.sync_max_events, c.ad_coins_per_day, c.daily_quests, c.weekly_quests, c.min_solve_seconds, c.nope, c.daily_earn_cap]; })(), [25, 3, 3, 2, { 7: 5 }, undefined, undefined]);
eq("the seeded Daily Reward list is the author's 30 days", [rows("SELECT kind, COUNT(*) AS n FROM streak_rewards GROUP BY kind ORDER BY kind").map((r) => `${r.kind}:${r.n}`), rows("SELECT day, kind, amount, item FROM streak_rewards WHERE day IN (1, 2, 3, 4, 7, 8, 30) ORDER BY day").map((r) => `${r.day}=${r.kind}:${r.amount}:${r.item}`)],
  [["coins:8", "cosmetic:8", "hints:8", "item:6"], ["1=item:1:pack_silver", "2=hints:5:", "3=coins:5:", "4=cosmetic:1:hideout:common", "7=cosmetic:1:avatar:common", "8=item:1:pack_bronze", "30=item:1:pack_gold"]]);
eq("the seeded Shop prices are the author's", rows("SELECT id, price_coins FROM items WHERE id IN ('pack_bronze', 'pack_silver', 'pack_gold', 'hints_5', 'hints_15', 'hints_40', 'hints_100') ORDER BY price_coins").map((i) => `${i.id}=${i.price_coins}`), ["hints_5=60", "pack_bronze=90", "pack_silver=120", "hints_15=160", "pack_gold=300", "hints_40=650", "hints_100=1500"]);
eq("cosmetics are priced by rarity", eco.COSMETIC_PRICES, { common: 50, rare: 100, epic: 200, legendary: 400 });
eq("a deal is the same on every call and never deals a quest twice", (() => { const defs = ["a", "b", "c", "d", "e"].map((id) => ({ id, period: "daily" })); const one = eco.dealQuests(defs, "daily", "acc", "d:2026-11-16", 3); return [one.length, new Set(one).size, JSON.stringify(one) === JSON.stringify(eco.dealQuests(defs.slice().reverse(), "daily", "acc", "d:2026-11-16", 3)), eco.dealQuests(defs, "weekly", "acc", "w:2026-11-16", 3).length]; })(), [3, 3, true, 0]);

/* ───────────── who may call ───────────── */
{
  eq("no session → 401", (await call("GET /wallet")).status, 401);
  eq("a garbage bearer → 401", (await call("GET /wallet", { headers: { Authorization: "Bearer aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbb" } })).status, 401);
  const t = await tokenFor("google:auth1");
  eq("a tampered bearer → 401", (await call("GET /wallet", { headers: { Authorization: `Bearer ${t.slice(0, -3)}AAA` } })).status, 401);
  const forged = `${Buffer.from(JSON.stringify({ id: "google:rich", aud: "app", exp: 9e9 })).toString("base64url")}.${t.split(".")[1]}`;
  eq("another payload with a real signature → 401", (await call("GET /wallet", { headers: { Authorization: `Bearer ${forged}` } })).status, 401);
  const cookie = await seal(baseEnv, { id: "google:auth1", provider: "google" }, 3600); // a site session: no `aud`
  eq("a site cookie token used as a bearer → 401", (await call("GET /wallet", { headers: { Authorization: `Bearer ${cookie}` } })).status, 401);
  eq("an app token used as the site cookie → 401", (await call("GET /wallet", { headers: { Cookie: `__Host-sh_session=${t}` } })).status, 401);
  eq("the site cookie reads (same account)", (await call("GET /wallet", { headers: { Cookie: `__Host-sh_session=${cookie}` } })).status, 200);
  eq("a cookie write without an Origin → 403", (await call("POST /sync", { headers: { Cookie: `__Host-sh_session=${cookie}` }, body: { events: [] } })).status, 403);
  eq("a cookie write from another origin → 403", (await call("POST /sync", { headers: { Cookie: `__Host-sh_session=${cookie}`, Origin: "https://evil.example" }, body: { events: [] } })).status, 403);
  eq("a cookie write from the site → 200", (await call("POST /sync", { headers: { Cookie: `__Host-sh_session=${cookie}`, Origin: SITE }, body: { events: [] } })).status, 200);
  eq("a bearer with a cookie of someone else is the bearer's account", (await call("GET /bootstrap", { as: "google:auth2", headers: { Cookie: `__Host-sh_session=${cookie}` } })).body.account.id, "google:auth2");
  eq("no database → 503", (await call("GET /wallet", { as: "google:auth1", env: { SHADOKU_DB: undefined } })).status, 503);
  eq("a body that is not JSON → 400", (await call("POST /sync", { as: "google:auth1", body: "coins=999" })).status, 400);
  eq("events that are not a list → 400", (await call("POST /sync", { as: "google:auth1", body: { events: { coins: 999 } } })).status, 400);
  d1.raw.prepare("UPDATE accounts SET banned = 1 WHERE id = 'google:auth2'").run();
  eq("a banned account → 403", (await call("GET /wallet", { as: "google:auth2" })).status, 403);
  eq("a new account starts at zero", wallet("google:auth1"), { coins: 0, hints: 0 });
}

/* ───────────── solves: the server's price, once ───────────── */
{
  const A = "google:solver";
  const lie = { reward: 9999, coins: 9999, delta: 9999, amount: 9999, difficulty: "expert", mode: "tutorial", paid: 9999 };
  const batch = ["tut1", "ve1", "e1", "m1", "h1", "x1"].map((c) => solveEv(c, lie));
  const r1 = await sync(A, batch, { coins: 5000, state: { coins: 5000 }, wallet: { coins: 5000 } });
  eq("each case pays its own difficulty, whatever the event claims", r1.body.results.map((x) => x.reward), [25, 5, 10, 15, 20, 25]);
  eq("balance after six solves", [coins(A), r1.body.state.coins], [100, 100]);
  eq("the same batch again changes nothing", [results(await sync(A, batch)), coins(A)], ["duplicate,duplicate,duplicate,duplicate,duplicate,duplicate", 100]);
  eq("the same cases under new event ids pay nothing", [results(await sync(A, ["tut1", "x1"].map((c) => solveEv(c)))), coins(A)], ["duplicate,duplicate", 100]);
  eq("one batch naming a case five times pays it once", [results(await sync(A, Array.from({ length: 5 }, () => solveEv("tut2")))), coins(A)], ["ok,duplicate,duplicate,duplicate,duplicate", 125]);
  const both = await atOnce([() => sync(A, [solveEv("e2")]), () => sync(A, [solveEv("e2")])]);
  eq("two syncs racing on one case pay once", [both.map(results).sort().join(), coins(A)], ["duplicate,ok", 135]);
  const odd = await sync(A, [solveEv("nope"), solveEv("retired"), solveEv("../x"), solveEv("e3", { seconds: -5 }), solveEv("e3", { seconds: 1.5 }), solveEv("e3", { hints: "0" }), { type: "solve", caseId: "e3" }, { eventId: uid(), type: "mint", coins: 500 }, null, "solve", [1], solveEv("e3", { eventId: "x" })]);
  eq("unknown cases, bad shapes and unknown types are refused", odd.body.results.map((x) => x.reason), ["unknown_case", "unknown_case", "format", "format", "format", "format", "format", "type", "format", "format", "format", "format"]);
  eq("…and pay nothing", coins(A), 135);
  eq("one ledger line per paid case", one("SELECT COUNT(*) AS n, SUM(delta) AS s FROM ledger WHERE account_id = ? AND reason = 'solve'", A), { n: 8, s: 135 });
  const many = await sync(A, Array.from({ length: 30 }, (_, i) => solveEv(`e${10 + i}`)));
  eq("a sync handles 25 events and defers the rest", [many.body.results.filter((x) => x.result === "ok").length, many.body.results.filter((x) => x.result === "deferred").length, coins(A)], [25, 5, 385]);
  const hist = await call("GET /wallet", { as: A });
  eq("the history is the ledger, newest first", [hist.body.history.length, hist.body.history[0].reason, hist.body.history[0].balance], [33, "solve", 385]);
}

/* ───────────── dailies: the weekday plan, released dates only ───────────── */
{
  toMonday();
  const A = "google:daily", t = today();
  const r = await sync(A, [solveEv(`daily-${t}`, { difficulty: "expert" }), solveEv(`daily-${eco.addDays(t, -1)}`), solveEv(`daily-${eco.addDays(t, -2)}`), solveEv(`daily-${eco.addDays(t, 1)}`), solveEv(`daily-${eco.addDays(t, -40)}`), solveEv("daily-2026-02-30"), solveEv(`daily-${eco.addDays(t, 300)}`)]);
  eq("Monday 5, Sunday 25, Saturday 20; tomorrow, a 40-day-old and an unreal date are refused", r.body.results.map((x) => x.reward ?? x.reason), [5, 25, 20, "not_released", "too_old", "bad_date", "not_released"]);
  eq("a daily pays once per date", [results(await sync(A, [solveEv(`daily-${t}`)])), coins(A)], ["duplicate", 50]);
  NOW += 10 * HOUR; // 22:00 UTC: tomorrow's contract shipped at 22:00 Lisbon
  eq("tomorrow's daily counts from its release", (await sync(A, [solveEv(`daily-${eco.addDays(t, 1)}`)])).body.results[0].reward, 10);
}

/* ───────────── plausibility: too fast pays nothing ───────────── */
{
  toMonday();
  const A = "google:fast";
  const r = await sync(A, [solveEv("e1", { seconds: 3 }), solveEv("x1", { seconds: 59 }), solveEv("x2", { seconds: 60 })]);
  eq("a 7x7 in 3 s and a 10x10 in 59 s pay nothing; 60 s pays", r.body.results.map((x) => [x.result, x.reward, x.flagged]), [["ok", 0, "fast_solve"], ["ok", 0, "fast_solve"], ["ok", 25, undefined]]);
  eq("…and raise a flag each", rows("SELECT kind FROM flags WHERE account_id = ?", A).map((f) => f.kind), ["fast_solve", "fast_solve"]);
  eq("…but count as progress", r.body.state.quests.find((q) => q.id === "d_solve5").progress, 3);
  eq("a slower solve of the same case later is not a first solve", [results(await sync(A, [solveEv("e1")])), coins(A)], ["duplicate", 25]);
}

/* ───────────── no daily ceiling: every first solve pays, however many in a day ───────────── */
{
  toMonday();
  const A = "google:marathon";
  setConfig("daily_earn_cap", 30); // a leftover row of the old ceiling changes nothing
  let paid = 0;
  for (let i = 0; i < 3; i++) paid += (await sync(A, Array.from({ length: 20 }, (_, j) => solveEv(`e${1 + i * 20 + j}`)))).body.results.filter((x) => x.result === "ok" && x.reward === 10).length;
  const more = await sync(A, ["tut1", "tut2", "x1", "x2", "h1", "m1", "ve1"].map((c) => solveEv(c)));
  eq("67 first solves in one day all pay", [paid, results(more), coins(A), one("SELECT COUNT(DISTINCT day) AS n FROM ledger WHERE account_id = ?", A).n], [60, "ok,ok,ok,ok,ok,ok,ok", 740, 1]);
  eq("no result is ever capped, and the state owes nothing", [rows("SELECT COUNT(*) AS n FROM solves WHERE account_id = ? AND paid = 0", A)[0].n, "owed" in more.body.state], [0, false]);
  dropConfig("daily_earn_cap");
}

/* ───────────── dates: an offline week is credited to its real days, never to more ───────────── */
{
  toMonday();
  const A = "google:offline", t0 = NOW, d0 = today();
  await sync(A, []); // the account's first sync
  NOW += 3 * DAY;
  await sync(A, [solveEv("e1", { at: t0 + DAY }), solveEv("e2", { at: t0 - 365 * DAY }), solveEv("e3", { at: NOW + 10 * DAY }), solveEv("e4", { at: "yesterday" }), solveEv("e5", { at: t0 + 2 * DAY })]);
  eq("event days are clamped between the previous sync and now", rows("SELECT case_id, day FROM solves WHERE account_id = ? ORDER BY case_id", A).map((s) => s.day), [eco.addDays(d0, 1), d0, eco.addDays(d0, 3), eco.addDays(d0, 3), eco.addDays(d0, 2)]);
  await sync(A, [solveEv("e6", { at: t0 })]);
  eq("a later sync cannot reach back before the one before it", one("SELECT day FROM solves WHERE account_id = ? AND case_id = 'e6'", A).day, eco.addDays(d0, 3));
  const B = "google:tz";
  await sync(B, [solveEv("e1")], { tz: 14 * 60 });
  eq("the account's day follows its time zone", one("SELECT day FROM ledger WHERE account_id = ?", B).day, eco.addDays(today(), 1));
  await sync(B, [], { tz: 1e9 });
  eq("an absurd time zone is clamped", one("SELECT tz_offset FROM accounts WHERE id = ?", B).tz_offset, 840);
}

/* ───────────── hints ───────────── */
{
  const A = "google:hints";
  const hintEvent = () => ({ eventId: uid(), type: "hint_use", caseId: "e1" });
  eq("no hints, none used", [(await sync(A, [hintEvent()])).body.results[0].reason, wallet(A).hints], ["no_stock", 0]);
  eq("…and the overuse is flagged", one("SELECT COUNT(*) AS n FROM flags WHERE account_id = ? AND kind = 'hint_overuse'", A).n, 1);
  await grant(A, 2, "hint");
  const ev = hintEvent();
  eq("a hint is used once per event", [results(await sync(A, [ev, ev])), results(await sync(A, [ev])), wallet(A).hints], ["ok,duplicate", "duplicate", 1]);
  eq("the stock stops at zero", [results(await sync(A, [hintEvent(), hintEvent(), hintEvent()])), wallet(A).hints], ["ok,rejected,rejected", 0]);
}

/* ───────────── rewarded ads: 5 coins, 3 a day, verified ───────────── */
{
  toMonday();
  const A = "google:ads", dev = { env: { DEV_ADS: "1" }, host: LOCAL };
  const ticket = async (as, placement = "coins", opt = {}) => (await call("POST /ads/ticket", { as, body: { placement }, ...opt })).body.ticket;
  const t1 = await ticket(A);
  eq("without a verifier a claim pays nothing: 503", [(await call("POST /ads/claim", { as: A, body: { ticket: t1 } })).status, coins(A)], [503, 0]);
  eq("without a verifier a callback pays nothing: 503", [(await call("GET /ads/ssv", { query: `?custom_data=${t1}&user_id=${A}&transaction_id=abc&reward_amount=500&signature=x&key_id=1` })).status, coins(A)], [503, 0]);
  eq("DEV_ADS does nothing on the production domain", [(await call("POST /ads/claim", { as: A, body: { ticket: t1 }, env: { DEV_ADS: "1" } })).status, coins(A)], [503, 0]);
  for (const host of ["https://shadoku.pages.dev", "https://shadoku.net", "https://localhost.evil.example", "https://x.pages.dev.evil.example"]) {
    eq(`DEV_ADS does nothing on ${host}`, [(await call("POST /ads/claim", { as: A, body: { ticket: t1 }, env: { DEV_ADS: "1" }, host })).status, coins(A)], [503, 0]);
  }
  const P = "google:ads-preview", tp = await ticket(P);
  eq("a Pages preview address is a test build", [(await call("POST /ads/claim", { as: P, body: { ticket: tp }, env: { DEV_ADS: "1" }, host: "https://app-phase-7.shadoku.pages.dev" })).body.result, coins(P)], ["ok", 5]);
  const c1 = await call("POST /ads/claim", { as: A, body: { ticket: t1, reward: 500, coins: 500 }, ...dev });
  eq("a test build's ad pays 5", [c1.body.result, c1.body.reward, coins(A)], ["ok", { coins: 5 }, 5]);
  eq("the ticket shows as paid", (await call("GET /ads/ticket/:id", { as: A, params: { id: t1 } })).body.paid, true);
  eq("somebody else cannot read it", (await call("GET /ads/ticket/:id", { as: "google:ads2", params: { id: t1 } })).status, 404);
  eq("a ticket pays once", [(await call("POST /ads/claim", { as: A, body: { ticket: t1 }, ...dev })).body.result, coins(A)], ["duplicate", 5]);
  for (let i = 0; i < 2; i++) await call("POST /ads/claim", { as: A, body: { ticket: await ticket(A) }, ...dev });
  eq("three ads: 15 coins, none left today", [coins(A), (await call("GET /wallet", { as: A })).body.state.ads.left], [15, 0]);
  const fourth = await call("POST /ads/ticket", { as: A, body: { placement: "coins" } });
  eq("the fourth coin ad of the day is refused before it is shown", [fourth.status, fourth.body.error], [409, "cap"]);
  eq("unknown placements are refused", (await call("POST /ads/ticket", { as: A, body: { placement: "jackpot" } })).status, 400);
  NOW += DAY;
  eq("the next day there are three again", (await call("POST /ads/ticket", { as: A, body: { placement: "coins" } })).status, 200);

  // tickets taken before the cap was reached: the cap still holds when they are paid
  const B = "google:ads-race", five = [];
  for (let i = 0; i < 5; i++) five.push(await ticket(B));
  const paid = await atOnce(five.map((t) => () => call("POST /ads/claim", { as: B, body: { ticket: t }, ...dev })));
  eq("five tickets cashed at once pay three", [paid.map((p) => p.body.result).sort().join(), coins(B)], ["capped,capped,ok,ok,ok", 15]);
  const C = "google:ads-twice", tc = await ticket(C);
  const twice = await atOnce([1, 2].map(() => () => call("POST /ads/claim", { as: C, body: { ticket: tc }, ...dev })));
  eq("one ticket cashed twice at once pays once", [twice.map((p) => p.body.result).sort().join(), coins(C)], ["duplicate,ok", 5]);
  eq("a ticket of another account is not mine to cash", [(await call("POST /ads/claim", { as: C, body: { ticket: await ticket(B, "hint") }, ...dev })).body.reason, wallet(C).hints], ["ticket", 0]);

  // AdMob's callback, with a verifier that accepts signature=good (the real one checks Google's ECDSA signature)
  const ssv = { verifyCallback: async (url) => (url.searchParams.get("signature") === "good" ? { ok: true, transactionId: url.searchParams.get("transaction_id"), ticketId: url.searchParams.get("custom_data"), userId: url.searchParams.get("user_id"), adUnit: "unit" } : { ok: false, error: "invalid" }), verifyClientClaim: async () => ({ ok: false, error: "invalid" }) };
  const callback = (t, user, tx, sig = "good") => call("GET /ads/ssv", { query: `?custom_data=${t}&user_id=${encodeURIComponent(user)}&transaction_id=${tx}&reward_amount=1000000&reward_item=coins&signature=${sig}&key_id=1`, env: { ADS_VERIFIER: ssv } });
  const D = "google:ads-ssv", td = await ticket(D);
  eq("a callback with a bad signature → 403, nothing paid", [(await callback(td, D, "tx1", "bad")).status, coins(D)], [403, 0]);
  eq("a callback naming another account pays nobody", [(await callback(td, "google:ads", "tx1")).body.result, coins(D), coins(A)], ["rejected", 0, 15]);
  eq("a signed callback pays 5, not AdMob's reward_amount", [(await callback(td, D, "tx1")).body.result, coins(D)], ["ok", 5]);
  eq("the callback replayed pays nothing", [(await callback(td, D, "tx1")).body.result, (await callback(td, D, "tx2")).body.result, coins(D)], ["duplicate", "duplicate", 5]);
  eq("one transaction cannot pay two tickets", [(await callback(await ticket(D), D, "tx1")).body.result, coins(D)], ["duplicate", 5]);
  eq("a callback for a ticket that never existed", [(await callback("nope", D, "tx9")).body.result, coins(D)], ["rejected", 5]);
  const F = "google:ads-two-tx", tf = await ticket(F);
  const twoTx = await atOnce([() => callback(tf, F, "txA"), () => callback(tf, F, "txB")]);
  eq("two different transactions at once for one ticket pay it once", [twoTx.map((r) => r.body.result).sort().join(), coins(F), one("SELECT COUNT(*) AS n FROM ad_rewards WHERE ticket_id = ?", tf).n], ["duplicate,ok", 5, 1]);
  const old = await ticket(D);
  NOW += 2 * HOUR;
  eq("a ticket older than an hour is dead", [(await callback(old, D, "tx3")).body.result, coins(D)], ["rejected", 5]);
  const th = await ticket(D, "hint");
  eq("the hint placement gives one hint", [(await callback(th, D, "tx4")).body.result, wallet(D)], ["ok", { coins: 5, hints: 1 }]);

  // the fallback claim (Play Integrity): a few a day
  const E = "google:ads-fallback";
  const integrity = { verifyCallback: async () => ({ ok: false, error: "invalid" }), verifyClientClaim: async ({ ticketId, integrity: tok }) => (tok === "genuine" ? { ok: true, transactionId: `client:${ticketId}`, verified: "client" } : { ok: false, error: "invalid" }) };
  eq("a fallback claim without a genuine verdict → 403", (await call("POST /ads/claim", { as: E, body: { ticket: await ticket(E, "hint"), integrity: "fake" }, env: { ADS_VERIFIER: integrity } })).status, 403);
  const got = [];
  for (let i = 0; i < 7; i++) got.push((await call("POST /ads/claim", { as: E, body: { ticket: await ticket(E, "hint"), integrity: "genuine" }, env: { ADS_VERIFIER: integrity } })).body.result);
  eq("five fallback claims a day, then no more", [got.join(), wallet(E).hints], ["ok,ok,ok,ok,ok,rejected,rejected", 5]);
  NOW += 2 * DAY;
  await ticket(D);
  eq("a ticket nobody paid is swept after a day; paid ones stay as records", [one("SELECT COUNT(*) AS n FROM ad_tickets WHERE id = ?", old).n, one("SELECT COUNT(*) AS n FROM ad_tickets WHERE id = ?", td).n], [0, 1]);
}

/* ───────────── quests: progress from accepted events only ───────────── */
{
  toMonday();
  const A = "google:quests", monday = today();
  const claim = (questId, extra = {}) => call("POST /quests/claim", { as: A, body: { questId, ...extra } });
  const quest = async (id) => (await call("GET /wallet", { as: A })).body.state.quests.find((q) => q.id === id);
  eq("a quest cannot be collected before it is done", [(await claim("d_solve2")).body.reason, (await claim("d_solve2", { progress: 99, target: 0, reward: 500 })).body.reason, coins(A)], ["incomplete", "incomplete", 0]);
  await sync(A, [solveEv("e1", { hints: 1 })]);
  eq("one solve of two", [(await quest("d_solve2")).progress, (await claim("d_solve2")).body.reason], [1, "incomplete"]);
  await sync(A, [solveEv("e2"), solveEv("e2"), solveEv("nope")]);
  eq("a duplicate and a refused event do not count", (await quest("d_solve2")).progress, 2);
  const c = await claim("d_solve2", { reward: 500 });
  eq("the quest pays its own reward", [c.status, c.body.reward, coins(A)], [200, 10, 30]);
  eq("…once", [(await claim("d_solve2")).body.result, (await sync(A, [{ eventId: uid(), type: "quest_claim", questId: "d_solve2" }])).body.results[0].result, coins(A)], ["duplicate", "duplicate", 30]);
  const racing = await atOnce([() => claim("d_nohint2"), () => claim("d_nohint2")]);
  eq("solving with a hint does not count as without", racing.map((r) => r.body.reason), ["incomplete", "incomplete"]);
  await sync(A, [solveEv("e3")]);
  const two = await atOnce([() => claim("d_nohint2"), () => claim("d_nohint2")]);
  eq("two claims at once pay once", [two.map((r) => r.body.result).sort().join(), coins(A)], ["duplicate,ok", 65]);
  eq("unknown quests and periods are refused", [(await claim("nope")).body.reason, (await claim("d_solve5", { periodKey: "d:2030-01-01" })).body.reason, (await claim("d_solve5", { periodKey: `d:${eco.addDays(monday, -2)}` })).body.reason], ["unknown_quest", "period", "period"]);
  await sync(A, [solveEv("x1"), solveEv("e4", { hints: 2 })]);
  eq("an expert case finishes the expert quest", [(await claim("d_expert1")).body.reward, (await quest("d_solve5")).progress, (await quest("w_solve20")).progress, (await quest("w_nohint5")).progress], [25, 5, 5, 3]);
  eq("the pack quest moves only when a pack is opened", (await quest("d_pack1")).progress, 0);
  NOW += DAY;
  eq("a new day: daily quests start over, weekly ones go on", [(await quest("d_solve5")).progress, (await quest("d_solve2")).claimed, (await quest("w_solve20")).progress], [0, false, 5]);
  const late = await claim("d_solve5", { periodKey: `d:${monday}` });
  eq("yesterday's finished quest can still be collected", [late.body.result, late.body.reward, (await claim("d_solve5", { periodKey: `d:${monday}` })).body.result], ["ok", 25, "duplicate"]);
  await sync(A, [solveEv("e5"), solveEv("e6")]);
  eq("today's own quest is another one", [(await claim("d_solve2")).body.reward, (await quest("w_solve20")).progress], [10, 7]);
  NOW += 6 * DAY;
  eq("a new week: weekly quests start over", (await quest("w_solve20")).progress, 0);
  eq("everything the quests paid", one("SELECT COUNT(*) AS n, SUM(delta) AS s FROM ledger WHERE account_id = ? AND reason = 'quest'", A), { n: 5, s: 95 });
}

/* ───────────── quests: a few dealt per player; one free refresh a day each for daily and weekly, more with an ad ───────────── */
{
  toMonday();
  dropConfig("daily_quests"); dropConfig("weekly_quests"); // the defaults: 3 daily of the 5, 2 weekly of the 3
  const A = "google:refresh", B = "google:refresh2", dev = { env: { DEV_ADS: "1" }, host: LOCAL };
  const st = async (as = A) => (await call("GET /wallet", { as })).body.state;
  const ids = (state, period) => state.quests.filter((q) => q.period === period).map((q) => q.id);
  const claim = (questId, as = A) => call("POST /quests/claim", { as, body: { questId } });
  const refresh = (questId, ticket, as = A) => call("POST /quests/refresh", { as, body: { questId, ticket, reward: 500, progress: 99 } });
  const paidTicket = async (as = A) => { const t = (await call("POST /ads/ticket", { as, body: { placement: "quest_refresh" } })).body.ticket; await call("POST /ads/claim", { as, body: { ticket: t }, ...dev }); return t; };
  const ALL = { daily: ["d_expert1", "d_nohint2", "d_pack1", "d_solve2", "d_solve5"], weekly: ["w_nohint5", "w_props8", "w_solve20"] };

  const boot = await call("GET /bootstrap", { as: A }), s0 = await st();
  eq("three daily and two weekly quests are dealt", [ids(s0, "daily").length, ids(s0, "weekly").length, new Set(s0.quests.map((q) => `${q.period}${q.slot}`)).size], [3, 2, 5]);
  eq("…the ones bootstrap announced, the same on every look", [ids(s0, "daily"), ids(s0, "weekly"), ids(await st(), "daily")], [boot.body.quests.coming[0].daily, boot.body.quests.coming[0].weekly, ids(s0, "daily")]);
  eq("bootstrap tells the coming week", [boot.body.quests.coming.length, boot.body.quests.dailySlots, boot.body.quests.weeklySlots, boot.body.quests.list.length], [7, 3, 2, 8]);
  const spare = ALL.daily.filter((q) => !ids(s0, "daily").includes(q));
  await sync(A, [solveEv("e1", { hints: 1 })]);
  eq("only dealt quests advance or can be collected", [rows("SELECT quest_id FROM quest_state WHERE account_id = ? AND period_key = ? ORDER BY quest_id", A, `d:${today()}`).map((r) => r.quest_id), (await claim(spare[0])).body.reason, (await claim(spare[1])).body.reason, coins(A)], [ids(s0, "daily").slice().sort(), "not_dealt", "not_dealt", 10]);

  const open = (state) => state.quests.filter((q) => q.period === "daily" && q.progress < q.target && !q.claimed);
  const s1 = await st(), first = open(s1).find((q) => q.kind !== "open_pack");
  const r1 = await refresh(first.id), s2 = await st();
  eq("a free refresh swaps an unfinished quest for one not seen today, in its slot, from zero", [r1.body.result, r1.body.how, spare.includes(r1.body.questId), r1.body.slot, s2.quests.find((q) => q.id === r1.body.questId).progress, ids(s2, "daily").includes(first.id), ids(s2, "daily").length, s2.questRefresh], ["ok", "free", true, first.slot, 0, false, 3, { dailyFree: false, weeklyFree: true, adTickets: 0 }]);
  eq("the swapped quest is gone for the day", [(await claim(first.id)).body.reason, (await refresh(first.id)).body.reason], ["not_dealt", "not_dealt"]);
  const second = open(s2).find((q) => q.id !== r1.body.questId) || open(s2)[0];
  eq("the day's second free refresh is refused", [(await refresh(second.id)).body.reason, ids(await st(), "daily")], ["free_used", ids(s2, "daily")]);
  const week = s2.quests.find((q) => q.period === "weekly");
  const rw = await refresh(week.id);
  eq("weekly quests have their own free refresh", [rw.body.result, ALL.weekly.includes(rw.body.questId), ids(rw.body.state, "weekly").includes(week.id), rw.body.state.questRefresh], ["ok", true, false, { dailyFree: false, weeklyFree: false, adTickets: 0 }]);
  eq("…one a day, and the list has no fourth weekly quest anyway", (await refresh(rw.body.questId)).body.reason, "no_other_quest");

  const t0 = (await call("POST /ads/ticket", { as: A, body: { placement: "quest_refresh" } })).body;
  eq("an ad ticket that was not watched refreshes nothing", [t0.reward, (await refresh(second.id, t0.ticket)).body.reason, (await refresh(second.id, "nope")).body.reason, (await refresh(second.id, { id: 1 })).body.reason], [{ questRefresh: 1 }, "ticket", "ticket", "format"]);
  await call("POST /ads/claim", { as: A, body: { ticket: t0.ticket }, ...dev });
  eq("a watched ad shows as one more refresh, and pays no coins", [(await st()).questRefresh.adTickets, coins(A)], [1, 10]);
  eq("it is mine alone", [(await st(B)).questRefresh.adTickets, (await refresh(ids(await st(B), "daily")[0], t0.ticket, B)).body.reason, (await st(B)).questRefresh.dailyFree], [0, "ticket", true]);
  const r2 = await refresh(second.id, t0.ticket);
  eq("after an ad: one more refresh, to the last quest not seen today", [r2.body.result, r2.body.how, r2.body.questId, r2.body.state.questRefresh.adTickets], ["ok", "ad", spare.find((q) => q !== r1.body.questId), 0]);
  eq("the ticket is spent", one("SELECT used_at IS NOT NULL AS used FROM ad_tickets WHERE id = ?", t0.ticket).used, 1);
  const t1 = await paidTicket();
  eq("with the whole list seen there is nothing to swap in, and the ticket is kept", [(await refresh(r2.body.questId, t1)).body.reason, (await st()).questRefresh.adTickets], ["no_other_quest", 1]);
  eq("a coin or hint ad ticket is not a refresh", await (async () => { const t = (await call("POST /ads/ticket", { as: B, body: { placement: "hint" } })).body.ticket; await call("POST /ads/claim", { as: B, body: { ticket: t }, ...dev }); await refresh(ids(await st(B), "daily")[0], undefined, B); return (await refresh(ids(await st(B), "daily")[1], t, B)).body.reason; })(), "ticket");
  await sync(A, [solveEv("x2")]); // an expert case without hints: it counts for every kind of solve quest
  eq("a swapped-out quest no longer advances", one("SELECT progress FROM quest_state WHERE account_id = ? AND period_key = ? AND quest_id = ?", A, `d:${today()}`, first.id).progress, first.progress);

  NOW += DAY;
  const s3 = await st();
  eq("a new day: a new deal and the free refreshes are back; yesterday's ticket still counts", [ids(s3, "daily").length, s3.questRefresh], [3, { dailyFree: true, weeklyFree: true, adTickets: 1 }]);
  const twoFree = open(s3).slice(0, 2);
  const raced = await atOnce(twoFree.map((q) => () => refresh(q.id)));
  eq("two free refreshes at once: one", [raced.map((r) => r.body.result === "ok" ? "ok" : r.body.reason).sort().join(), ids(await st(), "daily").length], ["free_used,ok", 3]);
  const s4 = await st(), twoAd = open(s4).filter((q) => q.progress === 0).slice(0, 2);
  const sameTicket = await atOnce(twoAd.map((q) => () => refresh(q.id, t1)));
  eq("one ad ticket used for two refreshes at once: one", [sameTicket.map((r) => r.body.result === "ok" ? "ok" : r.body.reason).sort().join(), (await st()).questRefresh.adTickets], ["ok,ticket", 0]);

  // a fresh day with two tickets and two swaps at once: both go through, to two different quests (the list has exactly two spare)
  NOW += DAY;
  const C = "google:refresh3", sc = await st(C), ta = await paidTicket(C), tb = await paidTicket(C);
  const both = await atOnce([() => refresh(ids(sc, "daily")[0], ta, C), () => refresh(ids(sc, "daily")[1], tb, C)]);
  const sc2 = await st(C);
  eq("two ad refreshes at once never deal the same quest", [both.map((r) => r.body.result).join(), new Set(ids(sc2, "daily")).size, new Set(both.map((r) => r.body.questId)).size, sc2.questRefresh.adTickets], ["ok,ok", 3, 2, 0]);
  eq("a spent ticket refreshes nothing more (the weekly list still has a spare)", [(await refresh(ids(sc2, "weekly")[0], ta, C)).body.reason, ids(await st(C), "weekly")], ["ticket", ids(sc2, "weekly")]);

  // finished and collected quests stay
  setConfig("daily_quests", 5);
  const D = "google:refresh4";
  await sync(D, [solveEv("e1", { hints: 1 }), solveEv("e2", { hints: 1 })]);
  eq("a finished quest is collected, not swapped", [(await refresh("d_solve2", undefined, D)).body.reason, (await claim("d_solve2", D)).body.reward, (await refresh("d_solve2", undefined, D)).body.reason, (await refresh("d_nohint2", undefined, D)).body.reason, (await refresh("nope", undefined, D)).body.reason], ["complete", 10, "claimed", "no_other_quest", "unknown_quest"]);
  // the solve that finishes a quest lands between the refresh's look and its swap: the database still refuses the swap
  // (a sixth daily quest for this test, so that five dealt leave one to swap in; the player is one who was dealt the expert quest)
  d1.raw.prepare("INSERT INTO quest_defs (id, period, kind, target, reward) VALUES ('d_test50', 'daily', 'solve', 50, 1)").run();
  const six = rows("SELECT id, period FROM quest_defs WHERE active = 1");
  const F = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((x) => `google:refresh5${x}`).find((acc) => eco.dealQuests(six, "daily", acc, `d:${today()}`, 5).includes("d_expert1"));
  await st(F);
  const late = await atOnce([() => refresh("d_expert1", undefined, F), () => sync(F, [solveEv("x1")])]);
  eq("a quest finished while it was being swapped stays", [late[0].body.reason, (await st(F)).quests.find((q) => q.id === "d_expert1")?.progress, (await claim("d_expert1", F)).body.reward, (await st(F)).questRefresh.dailyFree], ["complete", 1, 25, true]);
  d1.raw.prepare("UPDATE quest_defs SET active = 0 WHERE id = 'd_test50'").run();
  dropConfig("daily_quests");
  eq("refreshing never paid a coin", one("SELECT COUNT(*) AS n FROM ledger WHERE account_id IN (?, ?, ?) AND currency = 'coin' AND reason NOT IN ('solve', 'quest')", A, B, C).n, 0);
}

/* ───────────── the daily streak: the author's 30-day list ───────────── */
{
  toMonday();
  setConfig("daily_quests", 5); setConfig("weekly_quests", 3);
  const A = "google:streak", t = today();
  const claim = (date, as = A) => call("POST /streak/claim", { as, body: { date, reward: 500, current: 29, cycleDay: 30 } });
  const has = (item, as = A) => (one("SELECT qty FROM inventory WHERE account_id = ? AND item_id = ?", as, item) || { qty: 0 }).qty;
  const c1 = await claim(t);
  eq("day 1: a Silver Pack, kept in the inventory", [c1.body.result, c1.body.current, c1.body.cycleDay, c1.body.reward, has("pack_silver"), wallet(A)], ["ok", 1, 1, { item: "pack_silver", qty: 1 }, 1, { coins: 0, hints: 0 }]);
  eq("the same date again", [(await claim(t)).body.result, has("pack_silver")], ["duplicate", 1]);
  const c2 = await claim(eco.addDays(t, 1));
  eq("a phone ahead of UTC is already on tomorrow: day 2, five hints", [c2.body.current, c2.body.reward, wallet(A)], [2, { hints: 5 }, { coins: 0, hints: 5 }]);
  eq("but not two days ahead, nor back in time, nor a made-up date", [(await claim(eco.addDays(t, 2))).body.reason, (await claim(eco.addDays(t, -1))).body.reason, (await claim(t)).body.reason, (await claim("2026-13-40")).body.reason, (await claim(20261116)).body.reason, (await claim()).body.reason], ["date", "date", "date", "format", "format", "format"]);
  NOW += 2 * DAY;
  const both = await atOnce([() => claim(today()), () => claim(today())]);
  eq("day 3, claimed twice at once: five coins, once", [both.map((r) => r.body.result).sort().join(), wallet(A)], ["duplicate,ok", { coins: 5, hints: 5 }]);
  NOW += DAY;
  const c4 = await sync(A, [{ eventId: uid(), type: "streak_claim", date: today() }]);
  eq("day 4: a common hideout cosmetic the player does not own", [c4.body.results[0].current, c4.body.results[0].reward, has("lamp"), c4.body.state.streak.current, c4.body.state.inventory.lamp], [4, { item: "lamp", qty: 1 }, 1, 4, 1]);
  NOW += 3 * DAY;
  const c5 = await claim(today());
  eq("after a gap the streak and the list start again", [c5.body.current, c5.body.cycleDay, c5.body.reward, has("pack_silver"), c5.body.state.streak.best], [1, 1, { item: "pack_silver", qty: 1 }, 2, 4]);
  d1.raw.prepare("UPDATE streaks SET cycle_day = 29, current = 29 WHERE account_id = ?").run(A);
  NOW += DAY;
  const c30 = await claim(today());
  NOW += DAY;
  const c31 = await claim(today());
  eq("day 30 is the Gold Pack; then the list starts over and the streak continues", [c30.body.cycleDay, c30.body.reward, c31.body.current, c31.body.cycleDay, c31.body.reward, has("pack_gold"), has("pack_silver")], [30, { item: "pack_gold", qty: 1 }, 31, 1, { item: "pack_silver", qty: 1 }, 1, 3]);
  d1.raw.prepare("UPDATE streaks SET cycle_day = 3 WHERE account_id = ?").run(A);
  NOW += DAY;
  const none = await claim(today());
  eq("a cosmetic day with nothing left to give: the streak goes on, with no reward", [none.body.result, none.body.cycleDay, none.body.reward, none.body.current, has("lamp")], ["ok", 4, null, 32, 1]);
  d1.raw.prepare("UPDATE streaks SET cycle_day = 6 WHERE account_id = ?").run(A);
  NOW += DAY;
  eq("day 7: a common avatar cosmetic", (await claim(today())).body.reward, { item: "hat", qty: 1 });
  eq("the ledger holds the coin and hint days only", rows("SELECT currency, COUNT(*) AS n, SUM(delta) AS total FROM ledger WHERE account_id = ? AND reason = 'streak' GROUP BY currency ORDER BY currency", A).map((l) => `${l.currency}:${l.n}:${l.total}`), ["coin:1:5", "hint:1:5"]);
  const R = "google:streak-race";
  const pair = await atOnce([() => claim(today(), R), () => claim(eco.addDays(today(), 1), R)]);
  eq("today and tomorrow claimed at once: both count, each with its own day's reward", [pair.map((r) => [r.body.result, r.body.current, r.body.reward]), wallet(R).hints, has("pack_silver", R)], [[["ok", 1, { item: "pack_silver", qty: 1 }], ["ok", 2, { hints: 5 }]], 5, 1]);
  // a phone that claims every date it can reach: N days never give more than N + 2 claims
  const B = "google:streak-greedy"; let got = 0;
  for (let dayNo = 0; dayNo < 5; dayNo++, NOW += DAY) for (const off of [-1, 0, 1, 2, 5]) if ((await claim(eco.addDays(today(), off), B)).body.result === "ok") got++;
  eq("five days of greedy claiming yield seven", got, 7);
}

/* ───────────── the shop: the server's price, covered by the balance, once per request ───────────── */
{
  toMonday();
  const A = "google:shop";
  const buy = (itemId, requestId = uid(), extra = {}, as = A) => call("POST /shop/buy", { as, body: { itemId, requestId, ...extra } });
  eq("no coins, no goods", [(await buy("lamp")).status, (await buy("hints3")).status, (await buy("pack_bronze")).status, wallet(A), one("SELECT COUNT(*) AS n FROM inventory WHERE account_id = ?", A).n], [402, 402, 402, { coins: 0, hints: 0 }, 0]);
  await grant(A, 100);
  const req = uid(), b1 = await buy("hints3", req, { price: 0, priceCoins: 1, coins: 9999, hints: 99 });
  eq("a hint bundle: 30 coins for 3 hints, whatever the request says", [b1.status, b1.body.spent, wallet(A)], [200, 30, { coins: 70, hints: 3 }]);
  eq("the same request again: no second debit", [(await buy("hints3", req)).body.duplicate, wallet(A)], [true, { coins: 70, hints: 3 }]);
  eq("a request id is for one item", [(await buy("hat", req)).body.error, wallet(A).coins], ["request_reused", 70]);
  eq("a cosmetic is owned once", [(await buy("hat")).status, (await buy("hat")).body.error, coins(A)], [200, "owned", 50]);
  await buy("lamp"); await buy("lamp"); await buy("rug");
  eq("props stack", [rows("SELECT item_id, qty FROM inventory WHERE account_id = ? ORDER BY item_id", A).map((i) => `${i.item_id}:${i.qty}`), coins(A)], [["hat:1", "lamp:2", "rug:1"], 15]);
  eq("the props quest counts new props only", (await call("GET /wallet", { as: A })).body.state.quests.find((q) => q.id === "w_props8").progress, 2);
  eq("not enough coins: nothing happens", [(await buy("sofa")).body.error, coins(A), one("SELECT COUNT(*) AS n FROM inventory WHERE account_id = ? AND item_id = 'sofa'", A).n], ["insufficient", 15, 0]);
  eq("what is not on sale, or not sold for coins", [(await buy("gone")).status, (await buy("expired")).status, (await buy("future")).status, (await buy("nope")).status, (await buy("coins_2500")).body.error, (await buy("noob_kit")).body.error, (await buy("hints5_money")).body.error, (await buy("free")).body.error, (await buy("plain")).body.error, (await buy("lamp", "short")).status, (await buy(["lamp"])).status], [404, 404, 404, 404, "not_for_coins", "not_for_coins", "not_for_coins", "not_for_coins", "not_for_coins", 400, 400]);
  eq("…and none of it moved the wallet", wallet(A), { coins: 15, hints: 3 });

  await grant(A, 1000);
  eq("packs wait in the inventory, at the author's prices", [(await buy("pack_bronze")).body.spent, (await buy("pack_bronze")).body.spent, (await buy("pack_gold")).body.spent, rows("SELECT item_id, qty FROM inventory WHERE account_id = ? AND item_id LIKE 'pack_%' ORDER BY item_id", A).map((i) => `${i.item_id}:${i.qty}`), coins(A)], [90, 90, 300, ["pack_bronze:2", "pack_gold:1"], 535]);
  eq("the seeded hint bundles", [(await buy("hints_5")).body.hints, (await buy("hints_15")).body.spent, wallet(A)], [5, 160, { coins: 315, hints: 23 }]);
  // cosmetics of the day: one per shelf, the same choice the pure function makes
  const shelf = (await call("GET /shop", { as: A })).body.items;
  const todays = eco.cosmeticsOfDay(rows("SELECT id, kind, rarity FROM items WHERE active = 1 AND (starts IS NULL OR starts <= ?) AND (ends IS NULL OR ends > ?)", NOW, NOW), today());
  const mask = todays.has("mask_a") ? "mask_a" : "mask_b", other = mask === "mask_a" ? "mask_b" : "mask_a";
  eq("the shop shows today's cosmetics only, one per shelf", [shelf.filter((i) => i.ofTheDay).map((i) => i.id).sort(), todays.has(other), shelf.some((i) => ["gone", "expired", "future", "plain", other].includes(i.id))], [[...todays].sort(), false, false]);
  eq("prices on the shelf", [shelf.find((i) => i.id === mask).priceCoins, shelf.find((i) => i.id === "lamp").priceCoins, shelf.find((i) => i.id === "hints_40").priceCoins, shelf.find((i) => i.id === "coins_100").priceCoins, shelf.find((i) => i.id === "coins_100").sku], [100, 10, 650, null, "coins_100"]);
  eq("today's rare avatar costs 100; the other one is not for sale today", [(await buy(mask)).body.spent, (await buy(other)).body.error, (await buy(other)).status, coins(A)], [100, "not_today", 404, 215]);
  let seen = new Set();
  for (let i = 0; i < 40; i++) for (const id of eco.cosmeticsOfDay([{ id: "mask_a", kind: "avatar", rarity: "rare" }, { id: "mask_b", kind: "avatar", rarity: "rare" }], eco.addDays(today(), i))) seen.add(id);
  eq("the shelf rotates from day to day", seen.size, 2);

  const B = "google:shop-race";
  await grant(B, 40);
  const race = await atOnce([1, 2, 3].map(() => () => buy("sofa", uid(), {}, B)));
  eq("three buys racing for coins that cover one: one wins", [race.map((r) => r.status).sort().join(), coins(B), one("SELECT qty FROM inventory WHERE account_id = ? AND item_id = 'sofa'", B).qty], ["200,402,402", 0, 1]);
  await grant(B, 100);
  const same = uid(), twice = await atOnce([() => buy("lamp", same, {}, B), () => buy("lamp", same, {}, B)]);
  eq("one request sent twice at once: one debit", [twice.map((r) => r.status).join(), twice.filter((r) => r.body.duplicate).length, coins(B), one("SELECT qty FROM inventory WHERE account_id = ? AND item_id = 'lamp'", B).qty], ["200,200", 1, 90, 1]);
  const hats = await atOnce([1, 2].map(() => () => buy("hat", uid(), {}, B)));
  eq("a once-only cosmetic bought twice at once: one", [hats.map((r) => r.status).sort().join(), coins(B)], ["200,409", 70]);
}

/* ───────────── Play purchases: verified, once per token; refunds ───────────── */
{
  toMonday();
  const A = "google:buyer", dev = { env: { DEV_BILLING: "1" }, host: LOCAL };
  const verify = (as, sku, purchaseToken, opt = dev, extra = {}) => call("POST /billing/verify", { as, body: { sku, purchaseToken, ...extra }, ...opt });
  eq("without a verifier nothing is granted: 503", [(await verify(A, "coins_2500", "dev.coins_2500.aaaaaaaa", {})).status, coins(A), one("SELECT COUNT(*) AS n FROM purchases").n], [503, 0, 0]);
  eq("DEV_BILLING does nothing on the production domain", [(await verify(A, "coins_2500", "dev.coins_2500.aaaaaaaa", { env: { DEV_BILLING: "1" } })).status, coins(A)], [503, 0]);
  eq("a guest must sign in before buying", [(await verify("guest:0001", "coins_100", "dev.coins_100.aaaaaaaa")).body.error, coins("guest:0001")], ["signin_required", 0]);
  const p1 = await verify(A, "coins_500", "dev.coins_500.token0001", dev, { coins: 99999, amount: 99999 });
  eq("a verified purchase grants the pack's coins", [p1.status, p1.body.granted.coins, p1.body.finished, coins(A)], [200, 500, true, 500]);
  eq("the same token again grants nothing", [(await verify(A, "coins_500", "dev.coins_500.token0001")).body.duplicate, coins(A)], [true, 500]);
  eq("another account cannot redeem it", [(await verify("google:thief", "coins_500", "dev.coins_500.token0001")).body.error, coins("google:thief")], ["token_used", 0]);
  eq("a cheap purchase cannot be redeemed as a dear one", [(await verify(A, "coins_2500", "dev.coins_100.token0002")).status, (await verify(A, "coins_100", "dev.coins_100.token0002", dev, { sku: "coins_100" })).status, coins(A)], [400, 200, 600]);
  eq("the token is then tied to its product", [(await verify(A, "coins_2500", "dev.coins_100.token0002")).body.error, coins(A)], ["token_used", 600]);
  eq("unknown products and bad shapes", [(await verify(A, "coins_9999", "dev.coins_9999.x1234567")).status, (await verify(A, "coins_100", "x")).status, (await verify(A, 5, {})).status, coins(A)], [404, 400, 400, 600]);
  const C = "google:buyer-race";
  const race = await atOnce([1, 2, 3].map(() => () => verify(C, "coins_1200", "dev.coins_1200.racetoken")));
  eq("one token sent three times at once grants once", [race.map((r) => r.status).join(), race.filter((r) => r.body.duplicate).length, coins(C)], ["200,200,200", 2, 1200]);
  const ads = await verify(A, "remove_ads", "dev.remove_ads.token0003");
  eq("Remove ads is an entitlement", [ads.body.state.entitlements, coins(A)], [["remove_ads"], 600]);
  await verify(A, "hints_5_money", "dev.hints_5_money.token0004");
  eq("a hint bundle bought with money", wallet(A), { coins: 600, hints: 5 });

  // the consume/acknowledge step fails, then succeeds on the app's next launch
  const D = "google:buyer-retry"; let up = false; const finishes = [];
  const flaky = { verifyPurchase: async ({ accountHash }) => ({ ok: accountHash.length > 20, orderId: "GPA.1", purchasedAt: NOW }), finishPurchase: async (p) => { finishes.push(p.consumable); return { ok: up }; }, readNotification: async () => ({ ok: false, error: "invalid" }) };
  const f1 = await verify(D, "coins_100", "tok-retry-1", { env: { BILLING_VERIFIER: flaky } });
  eq("granted although Google could not be told", [f1.body.finished, coins(D), one("SELECT consumed FROM purchases WHERE account_id = ?", D).consumed], [false, 100, 0]);
  up = true;
  const f2 = await verify(D, "coins_100", "tok-retry-1", { env: { BILLING_VERIFIER: flaky } });
  eq("the resend finishes it and grants nothing more", [f2.body.duplicate, coins(D), one("SELECT consumed FROM purchases WHERE account_id = ?", D).consumed, finishes], [true, 100, 1, [true, true]]);
  for (const [error, status] of [["invalid", 400], ["pending", 409], ["wrong_account", 403], ["upstream", 502], ["???", 400]]) {
    const no = { ...flaky, verifyPurchase: async () => ({ ok: false, error }) };
    eq(`a purchase Google does not confirm (${error}) grants nothing`, [(await verify(D, "coins_2500", `tok-${error}-12345`, { env: { BILLING_VERIFIER: no } })).status, coins(D)], [status, 100]);
  }

  // refunds
  const rtdn = (tokens, opt = dev) => call("POST /billing/rtdn", { body: { voided: tokens.map((purchaseToken) => ({ purchaseToken })) }, ...opt });
  eq("a refund notice nobody verified changes nothing", [(await rtdn(["dev.coins_500.token0001"], {})).status, coins(A)], [503, 600]);
  await call("POST /shop/buy", { as: A, body: { itemId: "sofa", requestId: uid() } });
  await call("POST /shop/buy", { as: A, body: { itemId: "sofa", requestId: uid() } });
  await grant(A, -500); // the player spends 500 more (stands in for hideout shopping)
  eq("before the refund", coins(A), 20);
  const r1 = await rtdn(["dev.coins_500.token0001", "dev.unknown.token", "dev.remove_ads.token0003", "dev.hints_5_money.token0004"]);
  eq("refunds take back what was granted", [r1.body.results, wallet(A), (await call("GET /wallet", { as: A })).body.state.entitlements], [["voided", "unknown", "voided", "voided"], { coins: -480, hints: 0 }, []]);
  eq("…once", [(await rtdn(["dev.coins_500.token0001"])).body.results, coins(A)], [["already"], -480]);
  const twoNotices = await atOnce([() => rtdn(["dev.coins_1200.racetoken"]), () => rtdn(["dev.coins_1200.racetoken"])]);
  eq("two refund notices at once take the coins back once", [twoNotices.map((r) => r.body.results[0]).sort().join(), coins(C)], ["already,voided", 0]);
  eq("below zero nothing can be bought", [(await call("POST /shop/buy", { as: A, body: { itemId: "lamp", requestId: uid() } })).status, coins(A)], [402, -480]);
  eq("a refunded token cannot be redeemed again", [(await verify(A, "coins_500", "dev.coins_500.token0001")).body.error, coins(A)], ["voided", -480]);
  await sync(A, [solveEv("x1")]);
  eq("playing pays the debt back", coins(A), -455);

  // the Noob Kit: 500 coins, 15 hints and three packs, once per account
  const N = "google:noob", inv = (as) => rows("SELECT item_id, qty FROM inventory WHERE account_id = ? ORDER BY item_id", as).map((i) => `${i.item_id}:${i.qty}`);
  await call("POST /shop/buy", { as: N, body: { itemId: "pack_gold", requestId: uid() } });
  await grant(N, 300);
  await call("POST /shop/buy", { as: N, body: { itemId: "pack_gold", requestId: uid() } });
  const k1 = await verify(N, "noob_kit", "dev.noob_kit.token0001");
  eq("the Noob Kit", [k1.status, k1.body.granted, wallet(N), inv(N), k1.body.state.entitlements], [200, { coins: 500, hints: 15, entitlement: "", inventory: { pack_bronze: 1, pack_silver: 1, pack_gold: 1 } }, { coins: 500, hints: 15 }, ["pack_bronze:1", "pack_gold:2", "pack_silver:1"], ["once:noob_kit"]]);
  eq("a second kit is refused before anything is consumed", [(await verify(N, "noob_kit", "dev.noob_kit.token0002")).body.error, wallet(N), one("SELECT COUNT(*) AS n FROM purchases WHERE account_id = ?", N).n], ["owned", { coins: 500, hints: 15 }, 1]);
  const N2 = "google:noob2";
  const kits = await atOnce([() => verify(N2, "noob_kit", "dev.noob_kit.raceA001"), () => verify(N2, "noob_kit", "dev.noob_kit.raceB001")]);
  eq("two kits bought at once: one", [kits.map((r) => r.status).sort().join(), wallet(N2), inv(N2)], ["200,409", { coins: 500, hints: 15 }, ["pack_bronze:1", "pack_gold:1", "pack_silver:1"]]);
  await rtdn(["dev.noob_kit.token0001"]);
  eq("a refunded kit takes back its coins, hints and unopened packs, and may be bought again", [wallet(N), inv(N), (await call("GET /wallet", { as: N })).body.state.entitlements, (await verify(N, "noob_kit", "dev.noob_kit.token0003")).status], [{ coins: 0, hints: 0 }, ["pack_gold:1"], [], 200]);
}

/* ───────────── social visits: 25, once per network ───────────── */
{
  const A = "google:social";
  const open = (network) => call("POST /social/open", { as: A, body: { network } });
  const claim = (network) => call("POST /social/claim", { as: A, body: { network, reward: 500 } });
  eq("no visit, no reward", [(await claim("instagram")).body.reason, coins(A)], ["not_opened", 0]);
  eq("unknown networks", [(await open("myspace")).status, (await claim("myspace")).body.reason], [400, "network"]);
  await open("instagram"); await open("instagram");
  eq("the visit pays 25", [(await claim("instagram")).body.reward, coins(A)], [25, 25]);
  eq("…once, however often the card is tapped", [(await claim("instagram")).body.result, (await open("instagram")).status, (await claim("instagram")).body.result, coins(A)], ["duplicate", 200, "duplicate", 25]);
  await open("facebook"); await open("tiktok");
  const all = await atOnce([() => claim("facebook"), () => claim("facebook"), () => claim("tiktok")]);
  eq("75 coins in all", [all.map((r) => r.body.result).sort().join(), coins(A), (await call("GET /wallet", { as: A })).body.state.social], ["duplicate,ok,ok", 75, { facebook: "claimed", instagram: "claimed", tiktok: "claimed" }]);
}

/* ───────────── the database refuses a balance the ledger does not explain ───────────── */
{
  const A = "google:solver";
  const refuses = (sql, ...binds) => { try { d1.raw.prepare(sql).run(...binds); return false; } catch (e) { return /ledger|wallet/.test(e.message); } };
  ok("coins cannot be written straight into a wallet", refuses("UPDATE wallets SET coins = coins + 1000 WHERE account_id = ?", A));
  ok("nor hints", refuses("UPDATE wallets SET hints = 50 WHERE account_id = ?", A));
  ok("a wallet cannot be opened with coins in it", refuses("INSERT INTO wallets (account_id, coins) VALUES ('google:new', 1000)"));
  ok("a wallet cannot be pointed at another account's ledger", refuses("UPDATE wallets SET account_id = 'google:buyer-race' WHERE account_id = 'google:hints'"));
  ok("a ledger line cannot be rewritten", refuses("UPDATE ledger SET delta = 1000 WHERE account_id = ?", A));
  ok("a ledger line must continue the balance", refuses("INSERT INTO ledger (id, account_id, currency, delta, reason, ref, balance_after, day, at) VALUES ('x1', ?, 'coin', 10, 'grant', 'x1', 99999, '2026-11-16', 0)", A));
  ok("a ledger line needs a wallet", refuses("INSERT INTO ledger (id, account_id, currency, delta, reason, ref, balance_after, day, at) VALUES ('x2', 'google:nobody', 'coin', 10, 'grant', 'x2', 10, '2026-11-16', 0)"));
  const before = coins(A);
  const half = await d1.batch([post(d1, { id: newOp(), account: A, delta: 500, reason: "grant", ref: "half", day: today(), at: NOW })[0]]).then(() => true);
  ok("a line without its wallet update is caught at the next move", half && refuses("UPDATE wallets SET version = version + 1, coins = coins WHERE account_id = ?", A) && coins(A) === before);
  d1.raw.prepare("DELETE FROM ledger WHERE account_id = ? AND ref = 'half'").run(A);
  let threw = false;
  try { post(d1, { id: newOp(), account: A, delta: 0, reason: "grant", ref: "z", day: today(), at: NOW }); } catch { threw = true; }
  try { post(d1, { id: newOp(), account: A, delta: 1.5, reason: "grant", ref: "z", day: today(), at: NOW }); threw = false; } catch { /* expected */ }
  ok("post() refuses a zero or fractional amount", threw);
}

/* ───────────── only ledger.js writes balances ───────────── */
{
  const files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(dir, e.name)); else files.push(path.join(dir, e.name)); } };
  walk(path.join(ROOT, "functions"));
  const writes = /\b(INSERT\s+(OR\s+\w+\s+)?INTO|REPLACE\s+INTO|UPDATE)\s+(wallets|ledger)\b/i;
  const offenders = files.filter((f) => !f.endsWith(path.join("_lib", "app", "ledger.js")) && writes.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
  eq("no file but functions/_lib/app/ledger.js writes the wallets or ledger tables", offenders, []);
  ok("…and ledger.js does", writes.test(fs.readFileSync(path.join(ROOT, "functions", "_lib", "app", "ledger.js"), "utf8")));
  const handlers = files.filter((f) => f.includes(path.join("api", "app")));
  eq("every app endpoint goes through appContext, or is one of the two verified callbacks", handlers.filter((f) => !/appContext\(/.test(fs.readFileSync(f, "utf8"))).map((f) => path.basename(f)).sort(), ["rtdn.js", "ssv.js"]);
}

/* ───────────── a hostile client, at random: the books always balance ───────────── */
function audit(label) {
  const lines = rows("SELECT account_id, currency, delta, reason, ref, balance_after, day FROM ledger ORDER BY seq");
  const run = new Map(), adsDay = new Map(), solved = new Map();
  let chain = true, solvePrice = true;
  for (const l of lines) {
    const k = `${l.account_id}|${l.currency}`, next = (run.get(k) || 0) + l.delta;
    if (next !== l.balance_after) chain = false;
    run.set(k, next);
    if (l.currency !== "coin") continue;
    const dk = `${l.account_id}|${l.day}`;
    if (l.reason === "ad") { adsDay.set(dk, (adsDay.get(dk) || 0) + 1); if (l.delta !== 5) solvePrice = false; }
    if (l.reason === "solve") {
      const want = CASES[l.ref] ? REWARD_OF(l.ref) : eco.dailyCase(l.ref, NOW + 400 * DAY, { daily_max_age_days: 1e6 })?.difficulty && eco.REWARDS[eco.dailyCase(l.ref, NOW + 400 * DAY, { daily_max_age_days: 1e6 }).difficulty];
      if (l.delta !== want || solved.has(`${l.account_id}|${l.ref}`)) solvePrice = false;
      solved.set(`${l.account_id}|${l.ref}`, 1);
    }
  }
  ok(`${label}: every ledger line continues the one before`, chain);
  ok(`${label}: every wallet is the sum of its ledger`, rows("SELECT account_id, coins, hints FROM wallets").every((w) => w.coins === (run.get(`${w.account_id}|coin`) || 0) && w.hints === (run.get(`${w.account_id}|hint`) || 0)));
  ok(`${label}: no ledger line without a wallet`, [...run.keys()].every((k) => one("SELECT 1 AS x FROM wallets WHERE account_id = ?", k.split("|")[0])));
  ok(`${label}: a solve pays its case's price, once`, solvePrice);
  ok(`${label}: never more than 3 coin ads a day`, [...adsDay.values()].every((c) => c <= 3));
  ok(`${label}: a slot never holds two quests`, !one("SELECT 1 AS x FROM quest_state WHERE replaced_at IS NULL GROUP BY account_id, period_key, slot HAVING COUNT(*) > 1"));
  ok(`${label}: never more than one free refresh a day for daily quests and one for weekly`, !one("SELECT 1 AS x FROM quest_state WHERE replaced_how = 'free' GROUP BY account_id, replaced_day, SUBSTR(period_key, 1, 1) HAVING COUNT(*) > 1"));
  ok(`${label}: every ad refresh spent a paid ticket of its own`, rows("SELECT account_id, COUNT(*) AS n FROM quest_state WHERE replaced_how = 'ad' GROUP BY account_id").every((r) => r.n === one("SELECT COUNT(*) AS n FROM ad_tickets WHERE account_id = ? AND placement = 'quest_refresh' AND paid_at IS NOT NULL AND used_at IS NOT NULL", r.account_id).n));
  ok(`${label}: a quest pays its reward once per period, and only when dealt and finished`, rows("SELECT account_id, ref, delta FROM ledger WHERE reason = 'quest'").every((l) => { const cut = l.ref.lastIndexOf(":"), q = one("SELECT s.progress, s.claimed_at, s.replaced_at, d.target, d.reward FROM quest_state s JOIN quest_defs d ON d.id = s.quest_id WHERE s.account_id = ? AND s.period_key = ? AND s.quest_id = ?", l.account_id, l.ref.slice(0, cut), l.ref.slice(cut + 1)); return q && q.claimed_at && !q.replaced_at && q.progress >= q.target && q.reward === l.delta; }));
  ok(`${label}: hints never below zero without a refund`, rows("SELECT w.account_id, w.hints FROM wallets w WHERE w.hints < 0").every((w) => one("SELECT 1 AS x FROM ledger WHERE account_id = ? AND reason = 'refund'", w.account_id)));
}
audit("after the scripted tests");
{
  toMonday();
  let seed = 20261113;
  const rnd = (k) => { // mulberry32: the same sequence on every run
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % k;
  };
  const pick = (list) => list[rnd(list.length)];
  const players = ["google:fuzz1", "google:fuzz2", "guest:fuzz3", "google:fuzz4"], caseIds = [...Object.keys(CASES), "nope", "retired"];
  const junk = () => pick([9999, -9999, "9999", 1e12, null, { coins: 9999 }, [9999], 0.5, true]);
  const dev = { env: { DEV_ADS: "1", DEV_BILLING: "1" }, host: LOCAL };
  const tickets = [], tokensUsed = [], requests = [];
  dropConfig("daily_quests"); dropConfig("weekly_quests");
  let failures = 0;
  for (let step = 0; step < 500; step++) {
    const as = pick(players);
    try {
      switch (rnd(14)) {
        case 0: case 1: case 2: {
          const events = Array.from({ length: 1 + rnd(4) }, () => pick([
            () => solveEv(rnd(4) ? pick(caseIds) : `daily-${eco.addDays(today(), rnd(6) - 3)}`, { seconds: pick([300, 300, 300, 2, junk()]), hints: pick([0, 0, 1, junk()]), at: pick([NOW, NOW, NOW - rnd(5) * DAY, NOW + 9 * DAY, junk()]), reward: junk(), coins: junk(), delta: junk() }),
            () => solveEv(pick(caseIds), { reward: junk() }), () => solveEv(pick(caseIds), { reward: junk() }),
            () => ({ eventId: uid(), type: "hint_use", caseId: pick(caseIds), hints: junk() }),
            () => ({ eventId: uid(), type: "streak_claim", date: eco.addDays(today(), rnd(5) - 2), reward: junk() }),
            () => ({ eventId: uid(), type: "quest_claim", questId: pick(["d_solve2", "d_solve5", "d_nohint2", "d_expert1", "w_solve20", "w_props8", "nope"]), reward: junk(), progress: junk() }),
            () => ({ eventId: uid(), type: pick(["mint", "grant", "iap", "refund", ""]), coins: junk(), delta: junk() }),
          ])());
          await sync(as, events, { tz: pick([0, 60, -300, 840, junk()]), coins: junk() });
          break;
        }
        case 3: { const t = await call("POST /ads/ticket", { as, body: { placement: pick(["coins", "coins", "hint"]), reward: junk() } }); if (t.body && t.body.ticket) { tickets.push(t.body.ticket); if (rnd(2)) await call("POST /ads/claim", { as, body: { ticket: t.body.ticket, reward: junk() }, ...dev }); } break; }
        case 4: case 5: if (tickets.length) await call("POST /ads/claim", { as, body: { ticket: pick(tickets), reward: junk(), coins: junk() }, ...dev }); break;
        case 6: { const requestId = rnd(3) && requests.length ? pick(requests) : uid(); requests.push(requestId); await call("POST /shop/buy", { as, body: { itemId: pick(["hints3", "hat", "lamp", "rug", "sofa", "pack_bronze", "mask_a", "mask_b", "coins_2500", "free"]), requestId, price: junk(), coins: junk() } }); break; }
        case 7: { const sku = pick(["coins_100", "coins_500", "hints_5_money", "remove_ads", "noob_kit"]); const token = rnd(3) && tokensUsed.length ? pick(tokensUsed) : `dev.${sku}.fuzz${step}xx`; tokensUsed.push(token); await call("POST /billing/verify", { as, body: { sku: rnd(5) ? sku : "coins_2500", purchaseToken: token, coins: junk() }, ...dev }); break; }
        case 8: if (tokensUsed.length && !rnd(3)) await call("POST /billing/rtdn", { body: { voided: [{ purchaseToken: pick(tokensUsed) }] }, ...dev }); break;
        case 9: await call("POST /social/open", { as, body: { network: pick(eco.SOCIAL_NETWORKS) } }); await call("POST /social/claim", { as, body: { network: pick(eco.SOCIAL_NETWORKS), reward: junk() } }); break;
        case 11: case 12: {
          const dealt = (await call("GET /wallet", { as })).body.state.quests.map((q) => q.id);
          let ticket;
          if (rnd(2)) { ticket = (await call("POST /ads/ticket", { as, body: { placement: "quest_refresh" } })).body?.ticket; if (ticket && rnd(4)) await call("POST /ads/claim", { as, body: { ticket }, ...dev }); if (ticket) tickets.push(ticket); if (!rnd(4)) ticket = pick(tickets); }
          await call("POST /quests/refresh", { as, body: { questId: rnd(5) ? pick(dealt) : pick(["d_solve2", "w_props8", "nope"]), ticket, reward: junk() } });
          break;
        }
        case 10: {
          await call("POST /streak/claim", { as, body: { date: eco.addDays(today(), rnd(4) - 1), reward: junk() } });
          const done = (await call("GET /wallet", { as })).body.state.quests.filter((q) => q.progress >= q.target && !q.claimed).map((q) => q.id);
          await call("POST /quests/claim", { as, body: { questId: done.length && rnd(4) ? pick(done) : pick(["d_solve2", "d_solve5", "w_solve20"]), reward: junk() } });
          break;
        }
        default: NOW += pick([HOUR, 5 * HOUR, DAY]);
      }
    } catch (e) { failures++; if (failures === 1) bad.push(`fuzz step ${step} threw: ${e.message}`); }
  }
  eq("500 random hostile calls: none crashed", failures, 0);
  audit("after the fuzz");
  ok("the fuzz used every player and was not stopped by the rate limiter", players.every((p) => one("SELECT 1 AS x FROM accounts WHERE id = ?", p)) && !one("SELECT 1 AS x FROM rate_limits WHERE k LIKE '%fuzz%' AND ((k LIKE 'app-sync%' AND n > 120) OR (k LIKE 'app-ad%' AND n > 40) OR (k LIKE 'app-buy%' AND n > 60) OR (k LIKE 'app-billing%' AND n > 30) OR (k LIKE 'app-social%' AND n > 30) OR (k LIKE 'app-claim%' AND n > 120))"));
  ok("the fuzz refreshed quests both ways", ["free", "ad"].every((how) => one("SELECT 1 AS x FROM quest_state WHERE replaced_how = ? AND account_id LIKE '%fuzz%'", how)));
  if (process.argv.includes("--show")) console.log(rows("SELECT account_id, reason, currency, COUNT(*) AS n, SUM(delta) AS total FROM ledger WHERE account_id LIKE '%fuzz%' GROUP BY account_id, reason, currency").map((r) => `${r.account_id} ${r.reason} ${r.currency} x${r.n} = ${r.total}`).join("\n"));
  ok("the fuzz did earn, spend, buy and get refunded", ["solve", "ad", "quest", "streak", "social", "shop", "iap", "refund", "hint_use"].every((reason) => one("SELECT 1 AS x FROM ledger WHERE reason = ? AND account_id LIKE '%fuzz%'", reason)));
  ok("a guest never got a purchase through", !one("SELECT 1 AS x FROM purchases WHERE account_id LIKE 'guest:%'"));
}

/* ───────────── deleting the account ───────────── */
{
  const A = "google:buyer";
  await eraseAppAccount(baseEnv, A);
  const left = ["wallets", "ledger", "inventory", "entitlements", "ad_tickets", "ad_rewards", "solves", "quest_state", "streaks", "social_visits", "flags"].filter((t) => one(`SELECT 1 AS x FROM ${t} WHERE account_id = ?`, A));
  eq("the account's wallet and play records are erased", [left, one("SELECT 1 AS x FROM accounts WHERE id = ?", A)], [[], undefined]);
  eq("its purchases stay, without the account", [one("SELECT COUNT(*) AS n FROM purchases WHERE account_id = ?", A).n, one("SELECT COUNT(*) AS n FROM purchases WHERE account_id = 'erased'").n > 0], [0, true]);
  eq("its token still cannot be redeemed by anyone", (await call("POST /billing/verify", { as: "google:thief", body: { sku: "coins_100", purchaseToken: "dev.coins_100.token0002" }, env: { DEV_BILLING: "1" }, host: LOCAL })).body.error, "token_used");
  eq("a refund for it afterwards is harmless", (await call("POST /billing/rtdn", { body: { voided: [{ purchaseToken: "dev.coins_100.token0002" }] }, env: { DEV_BILLING: "1" }, host: LOCAL })).body.results, ["voided"]);
  audit("after the erasure");
}

console.log(`${n} checks, ${bad.length} failed`);
bad.forEach((b) => console.log("  FAIL " + b));
process.exit(bad.length ? 1 : 0);
