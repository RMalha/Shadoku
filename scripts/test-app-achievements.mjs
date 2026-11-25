// Achievements (functions/_lib/app/achievements.js, GET /api/app/achievements, migrations/0006_app_achievements.sql), tested
// in plain node:   npm run test:app-achievements
// Like scripts/test-app-hideout.mjs: every call goes through functions/api/_middleware.js into the real handler, as the app
// calls it, against a SQLite database with the real migrations/ applied. What is checked, above all: each tier unlocks once,
// from the event that reached it (and says so in that event's answer) or from the catch-up; its reward arrives once, coins only
// as a ledger line; reward items never reach the Shop or a pack; the unbuilt ones never unlock; the achievements go with the
// account, or with the guest who signs in; and without migration 0006 every event works as before.
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openD1 } from "./lib/d1-sqlite.mjs";
import { post, newOp } from "../functions/_lib/app/ledger.js";
import { APP_ORIGIN } from "../functions/_lib/app/cors.js";
import { onRequest as middleware } from "../functions/api/_middleware.js";
import { ACHIEVEMENTS, REWARD_ITEMS, MATERIALS } from "../functions/_lib/app/achievements.js";
import { HIDEOUT_PROPS } from "../functions/_lib/app/hideout_props.js";
import * as eco from "../functions/_lib/app/economy.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.shadoku.net";

let n = 0; const bad = [];
const ok = (what, cond) => { n++; if (!cond) bad.push(what); };
const eq = (what, got, want) => ok(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`, JSON.stringify(got) === JSON.stringify(want));

/* ───────────── harness ───────────── */
const NOW = Date.UTC(2026, 10, 25, 12); // Wednesday 2026-11-25, 12:00 UTC
const kv = new Map();
const KV = { get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, String(v)); }, delete: async (k) => { kv.delete(k); } };
const VERIFIER = { verify: async (provider, body) => (typeof body.sub === "string" ? { ok: true, provider, sub: body.sub, name: `Player ${body.sub}`, avatar: "" } : { ok: false, error: "invalid" }) };
const siteTables = async (d) => { await (await import(`${pathToFileURL(path.join(ROOT, "functions", "_lib", "db.js")).href}?t=${Math.random()}`)).db({ SHADOKU_DB: d }); };
const envOf = (d) => ({ SHADOKU_DB: d, SHADOKU_KV: KV, SESSION_SECRET: "test-secret-".repeat(4), NOW: () => NOW, IDENTITY_VERIFIER: VERIFIER });
const CASES = [["tut1", "tutorial", "Tutorial", 5], ["tut2", "tutorial", "Tutorial", 5], ["a1c1p01", "story", "Easy", 7], ["a1c1p02", "story", "Medium", 8], ["ve1", "classic", "Very Easy", 6], ["h1", "classic", "Hard", 9]];
const fill = (d) => { for (const c of CASES) d.raw.prepare("INSERT INTO case_index (case_id, mode, difficulty, size) VALUES (?, ?, ?, ?)").run(...c); };

let IP = 0, env;
async function app(method, where, token, body) {
  const url = new URL(SITE + where);
  const rel = url.pathname === "/api/account" ? "account" : url.pathname.replace(/^\/api\//, "");
  const file = [path.join(ROOT, "functions", "api", `${rel}.js`), path.join(ROOT, "functions", "api", rel, "index.js")].find((f) => fs.existsSync(f));
  const handler = (await import(pathToFileURL(file).href))[`onRequest${method[0]}${method.slice(1).toLowerCase()}`];
  const h = new Headers({ Origin: APP_ORIGIN, "CF-Connecting-IP": `10.6.0.${++IP % 250}` });
  if (token) h.set("Authorization", `Bearer ${token}`);
  const request = new Request(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await middleware({ request, env, next: (req) => handler({ request: req || request, env, params: {} }) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
/** Runs `fn` without the middleware's log lines (for the calls that are meant to answer 5xx). */
const quiet = async (fn) => { const { warn, error, log } = console; console.warn = console.error = console.log = () => {}; try { return await fn(); } finally { Object.assign(console, { warn, error, log }); } };
const answer = (r) => (r.status === 200 ? 200 : `${r.status} ${r.body && r.body.error}`);
const guest = async () => (await app("POST", "/api/app/auth/guest", undefined, {})).body;
const uid = () => crypto.randomUUID();
const solveEv = (caseId, extra = {}) => ({ eventId: uid(), type: "solve", caseId, seconds: 600, hints: 0, ...extra });
const sync = (p, events, extra = {}) => app("POST", "/api/app/sync", p.token, { events, ...extra });
const list = async (p) => (await app("GET", "/api/app/achievements", p.token)).body;
const unl = (r) => (r.unlocked || []).map((u) => `${u.id}:${u.tier}`);
const done = (body) => body.achievements.filter((a) => a.done).map((a) => a.id);

/* ───────────── without migration 0006: everything works as before ───────────── */
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadoku-0005-"));
  for (const f of fs.readdirSync(path.join(ROOT, "migrations")).filter((f) => f.endsWith(".sql") && f < "0006")) fs.copyFileSync(path.join(ROOT, "migrations", f), path.join(dir, f));
  const old = openD1(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  await siteTables(old);
  fill(old);
  env = envOf(old);
  const g = await guest();
  const r = await sync(g, [solveEv("tut1"), solveEv("tut2"), solveEv("ve1"), { eventId: uid(), type: "avatar_created" }]);
  eq("before 0006: solves pay as always and unlock nothing; the avatar event waits", [r.body.results.map((x) => `${x.result}${x.unlocked ? "+" : ""}`), r.body.state.coins], [["ok", "ok", "ok", "deferred"], 55]);
  eq("…the list answers 503 schema, the hideout still works", [answer(await quiet(() => app("GET", "/api/app/achievements", g.token))), answer(await app("PUT", "/api/app/hideout", g.token, { layout: [{ item: "CHAIR", x: 0, y: 0 }], version: 0 }))], ["503 schema", 200]);
}

/* ───────────── the list ───────────── */
const d1 = openD1(path.join(ROOT, "migrations"));
await siteTables(d1);
fill(d1);
env = envOf(d1);
const rows = (sql, ...binds) => d1.raw.prepare(sql).all(...binds);
const one = (sql, ...binds) => rows(sql, ...binds)[0];
const coins = (id) => one("SELECT coins FROM wallets WHERE account_id = ?", id).coins;
const holds = (id) => rows("SELECT item_id FROM inventory WHERE account_id = ? AND qty > 0 ORDER BY item_id", id).map((r) => r.item_id);
{
  eq("the badge ladder is the sheet's", MATERIALS, ["paper", "plastic", "wood", "metal", "bronze", "silver", "gold", "diamond", "platinum", "shadow"]);
  const by = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
  eq("counted ladders: 1, 5, 10 ... 1000, Paper to Shadow (Infinite included)", ["contracts", "contracts_expert", "no_hints_very_easy", "packs", "infinite", "duel_played"].map((id) => by[id].tiers.map((t) => `${t.target}${t.badge[0]}`).join(" ")),
    Array(6).fill("1p 5p 10w 25m 50b 100s 250g 500d 750p 1000s"));
  eq("the hideout size and ELO ladders start at Bronze; wins in a row follow the primes", [by.hideout_size.tiers.map((t) => `${t.target}:${t.badge}`), by.duel_elo.tiers.map((t) => `${t.target}:${t.badge}`), by.duel_streak.tiers.map((t) => t.target)],
    [["5:bronze", "6:silver", "7:gold", "8:diamond", "9:platinum", "10:shadow"], ["1200:bronze", "1400:silver", "1600:gold", "1800:diamond", "2000:platinum", "2500:shadow"], [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]]);
  eq("every reward item has its row: unique, not for sale", REWARD_ITEMS.filter((id) => { const i = one("SELECT kind, rarity, price_coins FROM items WHERE id = ?", id); return !i || i.rarity !== "unique" || i.price_coins !== null; }), []);
  eq("every hideout reward can be placed in the hideout", REWARD_ITEMS.filter((id) => one("SELECT kind FROM items WHERE id = ?", id).kind === "prop" && !HIDEOUT_PROPS.props[id]), []);
  const csvPath = path.join(ROOT, "app", "docs", "art-plan", "avatar_cosmetics.csv"); // master only: the release branch has no app/
  if (fs.existsSync(csvPath)) {
    const avatarIds = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).map((l) => l.split(";")[0]);
    eq("every avatar reward is an id of the cosmetics list", REWARD_ITEMS.filter((id) => one("SELECT kind FROM items WHERE id = ?", id).kind === "avatar" && !avatarIds.includes(id)), []);
  }
  const G = await guest(), body = await list(G);
  eq("a new account: every tier listed, none done, no badge", [body.achievements.length, body.achievements.filter((a) => a.done).length, body.badges, body.unlocked], [ACHIEVEMENTS.reduce((s, a) => s + a.tiers.length, 0), 0, [], []]);
  eq("an entry", body.achievements.find((a) => a.id === "contracts:3"), { id: "contracts:3", achievement: "contracts", group: "contracts", tier: 3, tiers: 10, target: 10, progress: 0, done: false, doneAt: null, reward: { badge: "wood" }, live: true });
  eq("every tutorial contract: progress is cases solved out of the set", (({ target, progress, reward }) => ({ target, progress, reward }))(body.achievements.find((a) => a.id === "tutorial:1")), { target: 2, progress: 0, reward: { items: ["ASSASSIN_PERMIT"], coins: 25 } });
  eq("what is not built is listed, not live", body.achievements.filter((a) => !a.live).map((a) => a.achievement).filter((x, i, all) => all.indexOf(x) === i), ["invite_friend", "infinite", "duel_played", "duel_clean", "duel_comeback", "duel_streak", "duel_elo"]);
}

/* ───────────── contracts ───────────── */
const A = await guest(), AID = A.account.id;
{
  const r1 = await sync(A, [solveEv("tut1")]);
  eq("one tutorial of two: nothing yet", [r1.body.results[0].unlocked, coins(AID)], [undefined, 25]);
  const r2 = await sync(A, [solveEv("tut2")]);
  eq("the last tutorial: the permit and 25 coins, in the event's answer", [unl(r2.body.results[0]), r2.body.results[0].unlocked[0].reward, coins(AID), holds(AID)], [["tutorial:1"], { items: ["ASSASSIN_PERMIT"], coins: 25 }, 75, ["ASSASSIN_PERMIT"]]);
  eq("…a tutorial is not a contract for the counted ladders", rows("SELECT achievement FROM achievements WHERE account_id = ?", AID).map((r) => r.achievement), ["tutorial"]);
  const r3 = await sync(A, [solveEv("ve1", { hints: 2 })]);
  eq("the first contract: Paper, and Paper for its difficulty, not for no hints (it used two)", unl(r3.body.results[0]), ["contracts:1", "contracts_very_easy:1"]);
  const r4 = await sync(A, [solveEv("a1c1p01"), solveEv("a1c1p02", { hints: 1 })]);
  eq("Act 1 done: N. O. Ir's cloak; each difficulty its Paper badge, Easy also with no hints", [unl(r4.body.results[0]), unl(r4.body.results[1])], [["contracts_easy:1", "no_hints_easy:1"], ["act1:1", "contracts_medium:1"]]);
  eq("…the cloak is held, Act 2 (no case yet) is not reached", [holds(AID).includes("clothing-noirCloak"), (await list(A)).achievements.find((a) => a.id === "act2:1")], [true, { id: "act2:1", achievement: "act2", group: "story", tier: 1, tiers: 1, target: 0, progress: 0, done: false, doneAt: null, reward: { items: ["glasses-umbra"] }, live: true }]);
  eq("a resend changes nothing", [(await sync(A, [solveEv("tut2"), solveEv("ve1")])).body.results.map((x) => x.result), coins(AID), one("SELECT COUNT(*) AS n FROM achievements WHERE account_id = ?", AID).n, one("SELECT COUNT(*) AS n FROM ledger WHERE account_id = ? AND reason = 'achievement'", AID).n], [["duplicate", "duplicate"], coins(AID), 7, 1]);
  // a daily solved at 02:00 on the account's clock (UTC-10: 12:00 UTC is 02:00 there), and one at noon
  const B = await guest();
  const day = await sync(B, [solveEv(`daily-${eco.dayKey(NOW)}`)]);
  eq("a daily at noon is not the coffee machine", unl(day.body.results[0]), ["contracts:1", "contracts_easy:1", "no_hints_easy:1"]);
  const C = await guest();
  const night = await sync(C, [solveEv(`daily-${eco.dayKey(NOW)}`)], { tz: -600 });
  eq("…one at 2 AM is", [unl(night.body.results[0]).includes("night_daily:1"), holds(C.account.id)], [true, ["COFFEE_MACHINE"]]);
  const story = await sync(C, [solveEv("a1c1p01")], { tz: -600 });
  eq("…and only a daily is", unl(story.body.results[0]).includes("night_daily:1"), false);
  // five more Very Easy contracts with no hints reach Plastic: the catch-up finds contracts the events did not announce
  d1.raw.prepare("INSERT INTO solves (account_id, case_id, mode, difficulty, seconds, hints, at, day, op) SELECT ?, 'old' || value, 'classic', 'very_easy', 60, 0, 0, '2026-01-01', 'x' FROM json_each('[1,2,3,4,5]')").run(AID);
  const caught = await list(A);
  eq("the catch-up unlocks what was reached elsewhere, once", [caught.unlocked.map((u) => `${u.id}:${u.tier}`), (await list(A)).unlocked], [["contracts:2", "contracts_very_easy:2", "no_hints_very_easy:1", "no_hints_very_easy:2"], []]);
  eq("progress and badges (one clock: in the order of the list)", [caught.achievements.find((a) => a.id === "contracts:3").progress, caught.badges.map((b) => `${b.achievement}:${b.material}`)],
    [8, ["contracts:paper", "contracts:plastic", "contracts_easy:paper", "contracts_medium:paper", "contracts_very_easy:paper", "contracts_very_easy:plastic", "no_hints_easy:paper", "no_hints_very_easy:paper", "no_hints_very_easy:plastic"]]);
}

/* ───────────── the streak, packs, collecting, the Shop, an upgrade ───────────── */
{
  d1.raw.prepare("INSERT INTO streaks (account_id, current, best, last_date, cycle_day) VALUES (?, 6, 6, ?, 6) ON CONFLICT (account_id) DO UPDATE SET current = 6, best = 6, last_date = excluded.last_date, cycle_day = 6").run(AID, eco.addDays(eco.dayKey(NOW), -1));
  const s = await sync(A, [{ eventId: uid(), type: "streak_claim", date: eco.dayKey(NOW) }]);
  eq("the 7th day in a row: the pocket watch", [unl(s.body.results[0]), holds(AID).includes("POCKET_WATCH")], [["streak:1"], true]);
  d1.raw.prepare("UPDATE streaks SET best = 100 WHERE account_id = ?").run(AID);
  eq("a best of 100 days: the calendar and the grandfather clock", [(await list(A)).unlocked.map((u) => u.id + ":" + u.tier), ["CALENDAR", "CLOCK"].every((i) => holds(AID).includes(i))], [["streak:2", "streak:3"], true]);
  // a pack and the only card there is: the first pack, and everything collected
  d1.raw.prepare("INSERT INTO items (id, kind, rarity) VALUES ('LAMP_TEST', 'prop', 'common')").run();
  d1.raw.prepare("INSERT INTO inventory (account_id, item_id, tier, qty, first_at) VALUES (?, 'pack_gold', 0, 1, 0)").run(AID);
  const shop = (await app("GET", "/api/app/shop", A.token)).body;
  eq("no reward item is in the Shop", shop.items.filter((i) => REWARD_ITEMS.includes(i.id)), []);
  const odds = shop.items.find((i) => i.id === "pack_gold").odds;
  eq("…nor in a pack", [odds.random.flatMap((r) => r.items.map((i) => i.id)), odds.guaranteed.flatMap((g) => g.items.map((i) => i.id))], [["LAMP_TEST"], []]);
  const open = await app("POST", "/api/app/packs/open", A.token, { packId: "pack_gold", oddsVersion: odds.version, requestId: uid() });
  eq("the first pack: Paper; every card held: the golden floor", [open.status, unl(open.body), holds(AID).includes("GOLDEN_FLOOR")], [200, ["collect_all:1", "packs:1"], true]);
  d1.raw.prepare("INSERT INTO entitlements (account_id, key, since, source) VALUES (?, 'member', 0, 'test')").run(AID);
  eq("an upgrade: the PC", [(await list(A)).unlocked.map((u) => u.id), holds(AID).includes("COMPUTER")], [["support"], true]);
  eq("a unique item cannot be bought or merged", [answer(await app("POST", "/api/app/shop/buy", A.token, { itemId: "COMPUTER", requestId: uid() })), answer(await app("POST", "/api/app/cards/merge", A.token, { itemId: "COMPUTER", tier: 0, requestId: uid() }))], ["400 not_for_coins", "409 not_enough"]);
}

/* ───────────── the hideout and the avatar ───────────── */
{
  const save = await app("PUT", "/api/app/hideout", A.token, { layout: [{ item: "ASSASSIN_PERMIT", x: 0, y: 0 }], version: 0 });
  eq("the first save of the hideout: the welcome mat (and a reward prop can be placed)", [save.status, unl(save.body), holds(AID).includes("WELCOME_MAT")], [200, ["hideout_edit:1"], true]);
  eq("…a second save unlocks nothing", unl((await app("PUT", "/api/app/hideout", A.token, { layout: [{ item: "WELCOME_MAT", x: 1, y: 1 }], version: 1 })).body), []);
  await d1.batch(post(d1, { id: newOp(), account: AID, delta: 300, reason: "grant", ref: uid(), day: eco.dayKey(NOW), at: NOW }));
  const g5 = await app("POST", "/api/app/hideout/grow", A.token, { to: 5 }), g6 = await app("POST", "/api/app/hideout/grow", A.token, { to: 6 });
  eq("5 x 5 is Bronze, 6 x 6 Silver", [unl(g5.body), unl(g6.body)], [["hideout_size:1"], ["hideout_size:2"]]);
  // a second room: the doors; and a size badge only the first time any room reaches that size
  await d1.batch(post(d1, { id: newOp(), account: AID, delta: 350 + 500 + 1000 + 100 + 200 + 350, reason: "grant", ref: uid(), day: eco.dayKey(NOW), at: NOW }));
  const grow = (to, room = 1) => app("POST", "/api/app/hideout/grow", A.token, { room, to });
  eq("7 x 7 is Gold, 8 x 8 Diamond", [unl((await grow(7)).body), unl((await grow(8)).body)], [["hideout_size:3"], ["hideout_size:4"]]);
  const room = await app("POST", "/api/app/hideout/rooms", A.token, {});
  eq("the first room bought: both doors, in the answer and in the inventory", [room.status, room.body.room, unl(room.body), room.body.unlocked[0].reward, ["DOOR_FRONT", "DOOR_SIDE"].every((i) => holds(AID).includes(i))],
    [200, 2, ["hideout_room:1"], { items: ["DOOR_FRONT", "DOOR_SIDE"] }, true]);
  eq("room 2 growing through sizes room 1 already reached unlocks nothing again", [unl((await grow(5, 2)).body), unl((await grow(6, 2)).body), unl((await grow(7, 2)).body)], [[], [], []]);
  eq("…the list shows the room and size achievements done once", done(await list(A)).filter((x) => x.startsWith("hideout")), ["hideout_edit:1", "hideout_size:1", "hideout_size:2", "hideout_size:3", "hideout_size:4", "hideout_room:1"]);
  const av = await sync(A, [{ eventId: uid(), type: "avatar_created" }, { eventId: uid(), type: "avatar_created" }]);
  eq("making the avatar: the wayfarers, once", [av.body.results.map((x) => x.result), unl(av.body.results[0]), holds(AID).includes("glasses-wayfarers")], [["ok", "duplicate"], ["avatar:1"], true]);
  const all = await list(A);
  eq("nothing that is not built was unlocked", all.achievements.filter((a) => !a.live && a.done), []);
  eq("every reward item arrived once", rows("SELECT item_id, qty FROM inventory WHERE account_id = ? AND item_id IN (SELECT value FROM json_each(?))", AID, JSON.stringify(REWARD_ITEMS)).filter((r) => r.qty !== 1), []);
  eq("the only coins: the tutorial's 25", rows("SELECT delta, ref FROM ledger WHERE account_id = ? AND reason = 'achievement'", AID).map((l) => `${l.ref}:${l.delta}`), ["tutorial:1:25"]);
}

/* ───────────── a guest who signs in, deleting the account ───────────── */
{
  const G = await guest();
  await sync(G, [solveEv("ve1"), { eventId: uid(), type: "avatar_created" }]);
  const S = (await app("POST", "/api/app/auth/google", G.token, { sub: "ach-1" })).body;
  eq("a guest who signs in to a new account takes its achievements along", [S.merge && S.merge.result, done(await list(S)), rows("SELECT * FROM achievements WHERE account_id = ?", G.account.id).length], ["moved", ["contracts:1", "contracts_very_easy:1", "no_hints_very_easy:1", "avatar:1"], 0]);
  const del = await app("DELETE", "/api/account", S.token);
  eq("deleting the account deletes its achievements", [del.status, rows("SELECT * FROM achievements WHERE account_id IN (?, ?)", S.account.id, G.account.id).length], [200, 0]);
}

console.log(`${n} checks, ${bad.length} failed`);
bad.forEach((b) => console.log("  FAIL " + b));
process.exit(bad.length ? 1 : 0);
