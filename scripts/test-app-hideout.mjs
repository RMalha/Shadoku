// The hideout (functions/_lib/app/hideout.js, functions/api/app/hideout/**, migrations/0005 and 0007), tested in plain
// node:   npm run test:app-hideout
// Like scripts/test-app-shared.mjs: every call goes through functions/api/_middleware.js into the real handler, as the app
// calls it (its origin, a guest's or a signed-in phone's bearer token), against a SQLite database with the real migrations/
// applied. What is checked, above all: a layout is saved only when every tile is on the board, no two props share one and
// nothing is placed more often than it is held; the server's copy wins; a step of the board is paid once, at the server's
// price, never with coins the account does not have; rooms on one board never overlap, always touch and stay joined by doors;
// and the hideout goes with the account, or with the guest who signs in.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openD1 } from "./lib/d1-sqlite.mjs";
import { post, newOp } from "../functions/_lib/app/ledger.js";
import { APP_ORIGIN } from "../functions/_lib/app/cors.js";
import { onRequest as middleware } from "../functions/api/_middleware.js";
import { checkLayout, checkEdges, unreachable, overlaps, STARTERS, HIDEOUT_MAX, BOARD_MIN, BOARD_MAX, FLOORS } from "../functions/_lib/app/hideout.js";
import os from "node:os";
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
const d1 = openD1(path.join(ROOT, "migrations"));
await (await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "db.js")).href)).db({ SHADOKU_DB: d1 }); // the site's tables (DELETE /api/account reads them)
const env = { SHADOKU_DB: d1, SHADOKU_KV: KV, SESSION_SECRET: "test-secret-".repeat(4), NOW: () => NOW, IDENTITY_VERIFIER: VERIFIER };

let IP = 0;
/** One call as the app makes it: its origin, the bearer token. → { status, body } */
async function app(method, where, token, body) {
  const url = new URL(SITE + where);
  const rel = url.pathname === "/api/account" ? "account.js" : url.pathname.replace(/^\/api\//, "");
  const file = [path.join(ROOT, "functions", "api", `${rel}.js`), path.join(ROOT, "functions", "api", rel, "index.js"), path.join(ROOT, "functions", "api", rel)].find((f) => f.endsWith(".js") && fs.existsSync(f));
  const handler = (await import(pathToFileURL(file).href))[`onRequest${method[0]}${method.slice(1).toLowerCase()}`];
  const h = new Headers({ Origin: APP_ORIGIN, "CF-Connecting-IP": `10.5.0.${++IP % 250}` });
  if (token) h.set("Authorization", `Bearer ${token}`);
  const request = new Request(url, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const res = await middleware({ request, env, next: (req) => handler({ request: req || request, env, params: {} }) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const answer = (r) => (r.status === 200 ? 200 : `${r.status} ${r.body && r.body.error}`);
const guest = async () => (await app("POST", "/api/app/auth/guest", undefined, {})).body;
const signIn = async (sub, token) => (await app("POST", "/api/app/auth/google", token, { sub })).body;
const get = async (p) => (await app("GET", "/api/app/hideout", p.token)).body;
const save = (p, layout, version) => app("PUT", "/api/app/hideout", p.token, { layout, version });
const grow = (p, to, room) => app("POST", "/api/app/hideout/grow", p.token, room === undefined ? { to } : { room, to });
const saveIn = (p, room, layout, version) => app("PUT", "/api/app/hideout", p.token, { room, layout, version });
const buyRoom = (p, body = {}) => app("POST", "/api/app/hideout/rooms", p.token, body);
const get1 = async (p) => (await get(p)).rooms[0]; // room 1, the hideout every account has
const roomRow = (id, room = 1) => one("SELECT size, version FROM hideout_rooms WHERE account_id = ? AND room = ?", id, room) || {};

const rows = (sql, ...binds) => d1.raw.prepare(sql).all(...binds);
const one = (sql, ...binds) => rows(sql, ...binds)[0];
const coins = (id) => (one("SELECT coins FROM wallets WHERE account_id = ?", id) || { coins: null }).coins;
const give = (id, item, tier, qty) => d1.raw.prepare("INSERT INTO inventory (account_id, item_id, tier, qty, first_at) VALUES (?, ?, ?, ?, 0) ON CONFLICT (account_id, item_id, tier) DO UPDATE SET qty = excluded.qty").run(id, item, tier, qty);
/** Coins from the server's own side (as an Inbox grant would be): through the ledger like everything else. */
const grant = (id, delta) => d1.batch(post(d1, { id: newOp(), account: id, delta, reason: "grant", ref: crypto.randomUUID(), day: eco.dayKey(NOW), at: NOW }));
const named = (needle) => d1.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'rate_limits'").all()
  .filter((t) => JSON.stringify(d1.raw.prepare(`SELECT * FROM ${t.name}`).all()).includes(needle)).map((t) => t.name);
const chair = (x, y, extra = {}) => ({ item: "CHAIR", x, y, ...extra });

/** The calls start together: every one does its reads, then all reach their batch before any is let through. */
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

/* ───────────── the props and their footprints ───────────── */
{
  eq("the starting set is the author's", [...STARTERS].sort(), ["BED", "CHAIR", "CRATE", "DESK", "STOOL", "TRASH_BAG", "WARDROBE"]);
  const csvPath = path.join(ROOT, "app", "docs", "art-plan", "hideout_props.csv"); // master only: the release branch has no app/
  if (fs.existsSync(csvPath)) {
    const csv = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(";")[0]);
    eq("every prop of the art plan's list can be placed", csv.filter((id) => !HIDEOUT_PROPS.props[id]), []);
  }
  eq("a bed covers two tiles, along a row or down a column", HIDEOUT_PROPS.props.BED.shapes.map((s) => [s.key, s.cells]), [["11", [[0, 0], [1, 0]]], ["1/1", [[0, 0], [0, 1]]]]);
  ok("every shape's key spells its cells", Object.values(HIDEOUT_PROPS.props).every((p) => p.shapes.every((s) => {
    const rowsOf = s.key.split("/");
    const cells = rowsOf.flatMap((r, y) => [...r].map((c, x) => (c === "1" ? [x, y] : null)).filter(Boolean));
    return JSON.stringify(cells.sort((a, b) => a[0] - b[0] || a[1] - b[1])) === JSON.stringify(s.cells);
  })));
  const props = fs.readFileSync(path.join(ROOT, "functions", "_lib", "app", "hideout_props.js"), "utf8");
  ok("the props module is the generated one", props.startsWith("// GENERATED by scripts/hideout-props.py"));
  eq("an L-shaped runner fits where its cells are free", [checkLayout([{ item: "CARPET_RUNNER", x: 0, y: 0, shape: "111/100/100" }, chair(1, 1)], 4).error, checkLayout([{ item: "CARPET_RUNNER", x: 0, y: 0, shape: "111/100/100" }, chair(0, 2)], 4).error], [undefined, "overlap"]);
}

/* ───────────── a new account, saving and loading ───────────── */
const A = await guest();
{
  eq("a new account has one room, an empty 4 x 4 at (0, 0) of the board, the next step for sale at 100; a second room waits for an 8 x 8", await get(A), {
    rooms: [{ room: 1, size: 4, x: 0, y: 0, grow: "se", name: "", floor: "parquet", edges: [], layout: [], version: 0, updated: 0, next: { size: 5, price: 100 } }], maxSize: 10, maxRooms: 10,
    board: { min: BOARD_MIN, max: BOARD_MAX }, floors: FLOORS, edgeKinds: ["wall", "window", "door"], nameMax: 24,
    newRoom: { room: 2, price: 1000, available: false, needs: 8, reason: "not_yet" }, starters: STARTERS, public: false, updated: 0 });
  eq("a look makes nothing", [rows("SELECT * FROM hideouts"), rows("SELECT * FROM hideout_rooms")], [[], []]);
  const layout = [chair(0, 0), { item: "BED", x: 1, y: 0, shape: "11", rot: 2 }, { item: "WARDROBE", x: 3, y: 3 }];
  const r = await save(A, layout, 0);
  eq("a layout is saved, every field filled in", [r.status, r.body.room, r.body.hideout.rooms[0].version, r.body.hideout.rooms[0].layout], [200, 1, 1, [
    { item: "CHAIR", x: 0, y: 0, shape: "1", rot: 0, tier: 0 }, { item: "BED", x: 1, y: 0, shape: "11", rot: 2, tier: 0 }, { item: "WARDROBE", x: 3, y: 3, shape: "1", rot: 0, tier: 0 }]]);
  eq("…and comes back the same", (await get1(A)).layout, r.body.hideout.rooms[0].layout);
  const stale = await save(A, [chair(2, 2)], 0);
  eq("a save made from an older version is refused, with the server's copy", [stale.status, stale.body.error, stale.body.room, stale.body.hideout.rooms[0].version, stale.body.hideout.rooms[0].layout.length], [409, "stale", 1, 1, 3]);
  eq("…and changed nothing", roomRow(A.account.id).version, 1);
  const twice = await atOnce([() => save(A, [chair(1, 1)], 1), () => save(A, [chair(2, 2)], 1)]);
  eq("two saves from the same version at once: one wins, the other is told", twice.map(answer).sort(), [200, "409 stale"]);
  eq("…and the version moved once", roomRow(A.account.id).version, 2);
  eq("an empty layout is a layout", [answer(await save(A, [], 2)), (await get1(A)).layout], [200, []]);
}

/* ───────────── what a layout must hold ───────────── */
{
  const v = (await get1(A)).version;
  const refuse = async (layout) => { const r = await save(A, layout, v); return `${r.status} ${r.body.error}`; };
  eq("a tile off the board", [await refuse([chair(4, 0)]), await refuse([chair(0, 4)]), await refuse([chair(-1, 0)]), await refuse([{ item: "BED", x: 3, y: 0, shape: "11" }]), await refuse([{ item: "BED", x: 0, y: 3, shape: "1/1" }]), await refuse([chair(10, 10)])],
    ["400 out_of_bounds", "400 out_of_bounds", "400 out_of_bounds", "400 out_of_bounds", "400 out_of_bounds", "400 out_of_bounds"]);
  eq("two props on one tile", [await refuse([chair(1, 1), chair(1, 1)]), await refuse([{ item: "BED", x: 0, y: 0, shape: "11" }, chair(1, 0)]), await refuse([{ item: "BED", x: 0, y: 0, shape: "1/1" }, { item: "BED", x: 0, y: 1, shape: "11" }])],
    ["400 overlap", "400 overlap", "400 overlap"]);
  const overlap = await save(A, [chair(0, 0), { item: "BED", x: 0, y: 0, shape: "11" }], v);
  eq("…the answer names both and the tile", [overlap.body.index, overlap.body.with, overlap.body.x, overlap.body.y], [1, 0, 0, 0]);
  eq("coordinates are integers, the fields are what they say", [await refuse([chair(0.5, 0)]), await refuse([chair("1", 0)]), await refuse([chair(0, 0, { rot: 4 })]), await refuse([chair(0, 0, { tier: 5 })]), await refuse([null]), await refuse({ item: "CHAIR" })],
    ["400 format", "400 format", "400 format", "400 format", "400 format", "400 format"]);
  eq("an unknown item, a shape the prop does not have, a bed with no shape named", [await refuse([{ item: "DRAGON", x: 0, y: 0 }]), await refuse([{ item: "BED", x: 0, y: 0, shape: "111" }]), await refuse([{ item: "BED", x: 0, y: 0 }]), await refuse([{ item: "__proto__", x: 0, y: 0 }])],
    ["400 unknown_item", "400 bad_shape", "400 bad_shape", "400 unknown_item"]);
  eq("more placements than tiles", await refuse(Array.from({ length: 17 }, (_, i) => chair(i % 4, Math.floor(i / 4) % 4))), "400 too_many");
  eq("a version that is not one", [answer(await save(A, [], -1)), answer(await save(A, [], "1")), answer(await app("PUT", "/api/app/hideout", A.token, { layout: [] }))], ["400 format", "400 format", "400 format"]);
  eq("a body past the cap", answer(await app("PUT", "/api/app/hideout", A.token, JSON.stringify({ layout: [], version: v, pad: "x".repeat(70000) }))), "400 format");
  eq("nothing refused was saved", (await get1(A)).version, v);
  eq("a room that is not there", [answer(await saveIn(A, 2, [], 0)), answer(await saveIn(A, 0, [], v)), answer(await saveIn(A, "1", [], v))], ["404 no_room", "400 format", "400 format"]);
}

/* ───────────── the starting set and what the account holds ───────────── */
{
  const id = A.account.id;
  let v = (await get1(A)).version;
  const full = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) full.push({ item: STARTERS[(x + y) % STARTERS.length] === "BED" ? "STOOL" : STARTERS[(x + y) % STARTERS.length], x, y });
  eq("the starting set is placed as often as the player likes: a board full of it", [answer(await save(A, full, v)), (await get1(A)).layout.length], [200, 16]);
  v++;
  eq("sixteen chairs", answer(await save(A, Array.from({ length: 16 }, (_, i) => chair(i % 4, Math.floor(i / 4))), v)), 200);
  v++;
  eq("a starter has no variants", [(await save(A, [chair(0, 0, { tier: 1 })], v)).body.error], ["bad_tier"]);
  const barrel = (x, tier = 0) => ({ item: "BARREL", x, y: 0, tier });
  const notOwned = await save(A, [barrel(0)], v);
  eq("an item the account does not hold", [notOwned.status, notOwned.body], [409, { error: "not_owned", item: "BARREL", tier: 0, held: 0, placed: 1, elsewhere: 0 }]);
  give(id, "BARREL", 0, 2);
  eq("held twice: placed twice, not three times", [answer(await save(A, [barrel(0), barrel(1), barrel(2)], v)), answer(await save(A, [barrel(0), barrel(1)], v))], ["409 not_owned", 200]);
  v++;
  eq("a variant is its own item: a plain card does not place a Bronze one", (await save(A, [barrel(0, 1)], v)).body, { error: "not_owned", item: "BARREL", tier: 1, held: 0, placed: 1, elsewhere: 0 });
  give(id, "BARREL", 1, 1);
  eq("…a Bronze one held places it, beside the two plain ones", [answer(await save(A, [barrel(0), barrel(1), barrel(2, 1)], v)), (await get1(A)).layout.map((p) => p.tier)], [200, [0, 0, 1]]);
  v++;
  give(id, "BARREL", 0, 0); // three merged, or the cards gone some other way, after the save
  const whole = await get(A), after = whole.rooms[0];
  eq("cards gone after the save: GET leaves those placements out and says so, and writes nothing", [after.layout.map((p) => `${p.item}:${p.tier}`), whole.removed.map((p) => `${p.room}:${p.item}:${p.x}`), after.version, roomRow(id).version], [["BARREL:1"], ["1:BARREL:0", "1:BARREL:1"], v, v]);
  eq("…a save of the same list is refused, the list without them goes through", [answer(await save(A, [barrel(0), barrel(2, 1)], v)), answer(await save(A, after.layout, v))], ["409 not_owned", 200]);
  v++;
  // a card leaves between the save's look at the inventory and its batch: the database refuses the save
  give(id, "BARREL", 0, 1);
  d1.hold();
  const racing = save(A, [barrel(0)], v);
  for (let i = 0; i < 300 && d1.waiting() < 1; i++) await new Promise((r) => setTimeout(r, 1));
  give(id, "BARREL", 0, 0);
  d1.release(true);
  eq("a card that leaves while the save is on its way is not saved placed", [answer(await racing), roomRow(id).version], ["409 not_owned", v]);
}

/* ───────────── growing the board ───────────── */
{
  const id = A.account.id;
  eq("the seeded prices", rows("SELECT size, price_coins FROM hideout_sizes ORDER BY size").map((r) => `${r.size}:${r.price_coins}`), ["5:100", "6:200", "7:350", "8:500", "9:750", "10:1000"]);
  const v = (await get1(A)).version;
  const short = await grow(A, 5);
  eq("no coins: refused with the price, nothing written", [short.status, short.body, roomRow(id).size, rows("SELECT * FROM ledger WHERE account_id = ? AND reason = 'hideout'", id).length], [402, { error: "insufficient", price: 100, coins: 0 }, 4, 0]);
  await grant(id, 450);
  eq("only the next size can be bought", [(await grow(A, 6)).body, (await grow(A, 4)).body, answer(await grow(A, "5")), answer(await grow(A, 5.5))], [{ error: "not_next", room: 1, size: 4, next: 5 }, { error: "not_next", room: 1, size: 4, next: 5 }, "400 format", "400 format"]);
  const g5 = await grow(A, 5);
  eq("5 x 5 costs 100, once", [g5.status, g5.body.room, g5.body.size, g5.body.spent, g5.body.hideout.rooms[0].size, g5.body.hideout.rooms[0].next, g5.body.state.coins, coins(id)], [200, 1, 5, 100, 5, { size: 6, price: 200 }, 350, 350]);
  eq("the same tap again pays nothing", [(await grow(A, 5)).body.duplicate, coins(id)], [true, 350]);
  eq("growing keeps the layout and its version (it still fits)", (await get1(A)).version, v);
  const both = await atOnce([() => grow(A, 6), () => grow(A, 6), () => grow(A, 6)]);
  eq("three taps at once on 6 x 6: one pays 200, the others are the same step", [both.map((r) => r.status), both.filter((r) => r.body.spent).length, coins(id), roomRow(id).size], [[200, 200, 200], 1, 150, 6]);
  eq("7 x 7 costs 350: not with 150", [(await grow(A, 7)).body, roomRow(id).size], [{ error: "insufficient", price: 350, coins: 150 }, 6]);
  eq("the new tiles take props", answer(await save(A, [chair(5, 5)], v)), 200);
  await grant(id, 2450);
  for (const to of [7, 8, 9, 10]) await grow(A, to);
  eq("up to 10 x 10, each step at its price", [roomRow(id).size, coins(id), rows("SELECT delta, ref FROM ledger WHERE account_id = ? AND reason = 'hideout' ORDER BY seq", id).map((l) => `${l.ref}:${l.delta}`)],
    [10, 0, ["room:1:size:5:-100", "room:1:size:6:-200", "room:1:size:7:-350", "room:1:size:8:-500", "room:1:size:9:-750", "room:1:size:10:-1000"]]);
  await grant(id, 5000);
  eq("past 10 x 10: refused, nothing spent", [(await grow(A, 11)).body, (await get1(A)).next, coins(id)], [{ error: "max_size", room: 1, size: 10, max: HIDEOUT_MAX }, null, 5000]);
  ok("the database refuses a room that shrinks", (() => { try { d1.raw.prepare("UPDATE hideout_rooms SET size = 5 WHERE account_id = ?").run(id); return false; } catch (e) { return /shrinks/.test(e.message); } })());
  ok("…and one past 10", (() => { try { d1.raw.prepare("UPDATE hideout_rooms SET size = 11 WHERE account_id = ?").run(id); return false; } catch (e) { return /CHECK/.test(e.message); } })());
}

/* ───────────── more rooms ───────────── */
{
  const R = await guest(), id = R.account.id;
  eq("the seeded room numbers: 1000 a room, once the newest is 8 x 8, 10 rooms at most", rows("SELECT k, v FROM hideout_settings ORDER BY k").map((r) => `${r.k}:${r.v}`), ["max_rooms:10", "room_from_size:8", "room_price:1000"]);
  await grant(id, 5000);
  eq("a room cannot be bought before the newest room is 8 x 8, even with the coins", [(await buyRoom(R)).body, coins(id), rows("SELECT * FROM hideout_rooms WHERE account_id = ?", id).length], [{ error: "not_yet", room: 1, size: 4, needs: 8 }, 5000, 0]);
  for (const to of [5, 6, 7]) await grow(R, to);
  eq("…nor at 7 x 7", (await buyRoom(R)).body, { error: "not_yet", room: 1, size: 7, needs: 8 });
  await grow(R, 8);
  const g = await get(R);
  eq("an 8 x 8: the next room is on offer", [g.newRoom, coins(id)], [{ room: 2, price: 1000, available: true, needs: 8 }, 3850]);
  await d1.batch(post(d1, { id: newOp(), account: id, delta: -3000, reason: "grant", ref: crypto.randomUUID(), day: eco.dayKey(NOW), at: NOW }));
  eq("850 coins do not buy a room", [(await buyRoom(R)).body, rows("SELECT room FROM hideout_rooms WHERE account_id = ?", id).map((r) => r.room)], [{ error: "insufficient", price: 1000, coins: 850 }, [1]]);
  await grant(id, 1150);
  const req = crypto.randomUUID(), b2 = await buyRoom(R, { requestId: req });
  eq("2000 do: room 2, an empty 4 x 4, paid 1000 once", [b2.status, b2.body.room, b2.body.spent, b2.body.hideout.rooms.map((r) => `${r.room}:${r.size}:${r.version}`), b2.body.hideout.newRoom, b2.body.state.coins, coins(id)],
    [200, 2, 1000, ["1:8:0", "2:4:0"], { room: 3, price: 1000, available: false, needs: 8, reason: "not_yet" }, 1000, 1000]);
  eq("an older app names no place: room 2 goes right of the newest room, a door in the middle of the shared edge", [b2.body.x, b2.body.y, b2.body.hideout.rooms[1].edges], [8, 0, [{ x: 0, y: 1, side: "left", kind: "door" }]]);
  eq("the same request again buys nothing", [(await buyRoom(R, { requestId: req })).body.duplicate, (await buyRoom(R, { requestId: req })).body.room, coins(id)], [true, 2, 1000]);
  eq("…a new request asks for room 3, which waits for room 2 to be 8 x 8", (await buyRoom(R, { requestId: crypto.randomUUID() })).body, { error: "not_yet", room: 2, size: 4, needs: 8 });
  eq("a request id that is not one", answer(await buyRoom(R, { requestId: "x" })), "400 format");
  // each room grows at the same prices, each step paid once per room
  const g2 = await grow(R, 5, 2);
  eq("room 2 pays its own 5 x 5", [g2.body.room, g2.body.spent, g2.body.hideout.rooms.map((r) => r.size), coins(id)], [2, 100, [8, 5], 900]);
  eq("…and the same tap again pays nothing", [(await grow(R, 5, 2)).body.duplicate, coins(id)], [true, 900]);
  eq("a room that does not exist cannot grow", [answer(await grow(R, 5, 3)), answer(await grow(R, 5, 0))], ["404 no_room", "400 format"]);
  eq("the ledger names the room of each step", rows("SELECT ref, delta FROM ledger WHERE account_id = ? AND reason = 'hideout' ORDER BY seq", id).map((l) => `${l.ref}:${l.delta}`),
    ["room:1:size:5:-100", "room:1:size:6:-200", "room:1:size:7:-350", "room:1:size:8:-500", "room:2:-1000", "room:2:size:5:-100"]);
  // a version per room
  eq("each room has its own version", [answer(await saveIn(R, 2, [chair(4, 4)], 0)), answer(await saveIn(R, 1, [chair(7, 7)], 0)), answer(await saveIn(R, 2, [], 0)), roomRow(id, 1).version, roomRow(id, 2).version], [200, 200, "409 stale", 1, 1]);
  // what is held counts across all rooms
  give(id, "BARREL", 0, 2);
  const barrel = (x) => ({ item: "BARREL", x, y: 0 });
  eq("two barrels held: two in room 1", answer(await saveIn(R, 1, [barrel(0), barrel(1)], 1)), 200);
  eq("…none left for room 2", (await saveIn(R, 2, [barrel(0)], 1)).body, { error: "not_owned", item: "BARREL", tier: 0, held: 2, placed: 1, elsewhere: 2 });
  eq("…one moved from room 1 to room 2", [answer(await saveIn(R, 1, [barrel(0)], 2)), answer(await saveIn(R, 2, [barrel(0)], 1)), (await get(R)).rooms.map((r) => r.layout.filter((p) => p.item === "BARREL").length)], [200, 200, [1, 1]]);
  eq("starters stay unlimited in every room", [answer(await saveIn(R, 2, Array.from({ length: 25 }, (_, i) => chair(i % 5, Math.floor(i / 5))), 2)), answer(await saveIn(R, 1, Array.from({ length: 64 }, (_, i) => chair(i % 8, Math.floor(i / 8))), 3))], [200, 200]);
  await saveIn(R, 2, [barrel(4)], 3); await saveIn(R, 1, [barrel(0)], 4);
  give(id, "BARREL", 0, 1);
  eq("a barrel held once, placed once in each room: room 1 keeps it, room 2's drops out in GET", (await get(R)).removed, [{ room: 2, item: "BARREL", x: 4, y: 0, shape: "1", rot: 0, tier: 0 }]);
  // two rooms saved at once may not use the same card twice
  give(id, "BARREL", 0, 1);
  await saveIn(R, 1, [], 5); await saveIn(R, 2, [], 4);
  const race = await atOnce([() => saveIn(R, 1, [barrel(0)], 6), () => saveIn(R, 2, [barrel(0)], 5)]);
  eq("one barrel saved into two rooms at once: one room gets it", [race.map(answer).sort(), (await get(R)).rooms.map((r) => r.layout.length).reduce((a, b) => a + b, 0)], [[200, "409 not_owned"], 1]);
  // three taps at once on a new room
  await grant(id, 1000 + 200 + 350 + 500);
  for (const to of [6, 7, 8]) await grow(R, to, 2);
  const before = coins(id);
  const taps = await atOnce([() => buyRoom(R), () => buyRoom(R), () => buyRoom(R)]);
  eq("three taps at once on room 3: one pays, the others are the same room", [taps.map((t) => t.status), taps.filter((t) => t.body.spent).length, taps.map((t) => t.body.room), before - coins(id), rows("SELECT room FROM hideout_rooms WHERE account_id = ?", id).map((r) => r.room)],
    [[200, 200, 200], 1, [3, 3, 3], 1000, [1, 2, 3]]);
  // the most rooms
  d1.raw.prepare("UPDATE hideout_settings SET v = 3 WHERE k = 'max_rooms'").run();
  d1.raw.prepare("UPDATE hideout_rooms SET size = 8 WHERE account_id = ? AND room = 3").run(id);
  eq("at the most rooms: none on offer, none sold", [(await get(R)).newRoom, (await get(R)).maxRooms, (await buyRoom(R)).body], [null, 3, { error: "max_rooms", max: 3 }]);
  d1.raw.prepare("UPDATE hideout_settings SET v = 10 WHERE k = 'max_rooms'").run();
  ok("the database keeps a room's number", (() => { try { d1.raw.prepare("UPDATE hideout_rooms SET room = 9 WHERE account_id = ? AND room = 3").run(id); return false; } catch (e) { return /keeps its number/.test(e.message); } })());
  const del = await app("DELETE", "/api/account", R.token);
  eq("deleting the account deletes every room", [del.status, rows("SELECT * FROM hideout_rooms WHERE account_id = ?", id).length, named(id)], [200, 0, []]);
}

/* ───────────── one board: where rooms go, growing, names, floors, edges and doors (migrations/0007) ───────────── */
{
  const art = fs.readFileSync(path.join(ROOT, "src", "ShadokuArt.jsx"), "utf8");
  const listOf = (re) => [...(art.match(re) || ["", ""])[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  eq("the floors are the board's floor patterns (src/ShadokuArt.jsx FLOORS)", FLOORS, [...listOf(/export const INDOOR_FLOORS = \[([^\]]*)\]/), ...listOf(/export const FLOORS = \[\.\.\.INDOOR_FLOORS, ([^\]]*)\]/)]);
  eq("…each drawn by FloorDefs", FLOORS.filter((f) => !art.includes(`{P("${f}"`)), []);

  const P = await guest(), id = P.account.id;
  await grant(id, 20000);
  for (const to of [5, 6, 7, 8]) await grow(P, to);
  const buy = (body) => buyRoom(P, body);
  const c0 = coins(id);
  eq("GET names the side a new room must be able to grow to (the app's ghost square)", (await get(P)).newRoom, { room: 2, price: 1000, available: true, needs: 8 });
  eq("a place that is not one", [answer(await buy({ x: 1.5, y: 0 })), answer(await buy({ x: 8 })), answer(await buy({ x: "8", y: 0 }))], ["400 format", "400 format", "400 format"]);
  eq("outside the board", [(await buy({ x: 65, y: 0 })).body, answer(await buy({ x: 0, y: -65 }))], [{ error: "out_of_bounds", min: -64, max: 64 }, "400 out_of_bounds"]);
  eq("on top of room 1", (await buy({ x: 4, y: 4 })).body, { error: "overlap", room: 1 });
  eq("a gap, or only a corner, is not touching", [(await buy({ x: 9, y: 0 })).body, answer(await buy({ x: 8, y: 8 })), answer(await buy({ x: -4, y: -4 }))], [{ error: "not_touching" }, "409 not_touching", "409 not_touching"]);
  eq("a corner asked for whose 8 x 8 would cover room 1; a corner that is not one", [(await buy({ x: -4, y: 0, grow: "se" })).body, answer(await buy({ x: 2, y: -4, grow: "sw" })), answer(await buy({ x: 8, y: 0, grow: "north" }))],
    [{ error: "no_room_to_grow", need: 8 }, "409 no_room_to_grow", "400 format"]);
  eq("…and none of that was paid for", [coins(id), rows("SELECT room FROM hideout_rooms WHERE account_id = ?", id).map((r) => r.room)], [c0, [1]]);
  const b2 = await buy({ x: 8, y: 0, requestId: crypto.randomUUID() });
  const r2 = () => one("SELECT x, y, edges FROM hideout_rooms WHERE account_id = ? AND room = 2", id);
  eq("right of room 1: bought, growing right and down, with a door in the middle of the four edges shared", [b2.status, b2.body.x, b2.body.y, b2.body.grow, b2.body.spent, b2.body.hideout.rooms[1].edges, r2().edges],
    [200, 8, 0, "se", 1000, [{ x: 0, y: 1, side: "left", kind: "door" }], '[{"x":0,"y":1,"side":"left","kind":"door"}]']);
  const g9 = await grow(P, 9, 1);
  eq("room 1 cannot grow into room 2, and pays nothing", [g9.status, g9.body, coins(id)], [409, { error: "no_space", room: 1, size: 8, to: 9, rooms: [2] }, c0 - 1000]);
  eq("room 2 grows right and down", [answer(await grow(P, 5, 2)), one("SELECT size FROM hideout_rooms WHERE account_id = ? AND room = 2", id).size], [200, 5]);

  // names and floors
  const v = (room) => one("SELECT version FROM hideout_rooms WHERE account_id = ? AND room = ?", id, room).version;
  const put = (room, fields) => app("PUT", "/api/app/hideout", P.token, { room, version: v(room), ...fields });
  const room2 = async () => (await get(P)).rooms[1];
  eq("a name, trimmed; the layout stays", [answer(await put(2, { name: "  Den  " })), (await room2()).name, (await room2()).layout, v(2)], [200, "Den", [], 1]);
  eq("24 characters at most, a character being a code point", [answer(await put(2, { name: "é".repeat(24) })), answer(await put(2, { name: "x".repeat(25) })), answer(await put(2, { name: "🦊".repeat(24) }))], [200, "400 bad_name", 200]);
  eq("no control characters, line breaks or bidi overrides; a name is a string", [(await put(2, { name: "a\nb" })).body, answer(await put(2, { name: "a\u0007" })), answer(await put(2, { name: "a‮b" })), answer(await put(2, { name: 12 }))],
    [{ error: "bad_name", max: 24 }, "400 bad_name", "400 bad_name", "400 bad_name"]);
  eq("an empty name: the app shows Room N", [answer(await put(2, { name: "   " })), (await room2()).name], [200, ""]);
  // the Codename word filter (functions/_lib/codename): "blocked" is refused with its reason, "reserved" is fine for a room, spaces separate words
  eq("a name the word filter blocks: 400 bad_name, reason blocked, the name kept", [(await put(2, { name: "Shit hole" })).body, (await put(2, { name: "the fucking room" })).body, (await room2()).name],
    [{ error: "bad_name", max: 24, reason: "blocked" }, { error: "bad_name", max: 24, reason: "blocked" }, ""]);
  eq("a reserved-looking name is the player's own room", [answer(await put(2, { name: "Admin office" })), answer(await put(2, { name: "Shadoku HQ" })), (await room2()).name], [200, 200, "Shadoku HQ"]);
  const spaced = [];
  for (const name of ["Wine cellar", "Glass room", "Assassin's den", "Classic study", "Cocktail bar"]) spaced.push([name, answer(await put(2, { name })), (await room2()).name]);
  eq("names with spaces whose words hide nothing pass", spaced.map(([name, a, got]) => a === 200 && got === name), [true, true, true, true, true]);
  eq("a floor of the list", [answer(await put(2, { floor: "marble", name: "Den" })), (await room2()).floor, (await room2()).name], [200, "marble", "Den"]);
  eq("…not water, not anything else", [(await put(2, { floor: "water" })).body.error, answer(await put(2, { floor: 3 })), answer(await put(2, { floor: "lava" }))], ["bad_floor", "400 bad_floor", "400 bad_floor"]);
  eq("a save with nothing to save", answer(await app("PUT", "/api/app/hideout", P.token, { room: 2, version: v(2) })), "400 format");
  for (const to of [6, 7, 8]) await grow(P, to, 2);
  eq("room 2 is 8 x 8 now, beside the whole of room 1", (await room2()).size, 8);

  // edges
  const E = (x, y, side, kind) => ({ x, y, side, kind });
  eq("an edge off the room's grid, of an unknown side or kind, twice, or not an edge", [
    answer(await put(1, { edges: [E(9, 0, "left", "wall")] })), answer(await put(1, { edges: [E(0, 8, "left", "wall")] })), answer(await put(1, { edges: [E(8, 0, "top", "wall")] })),
    answer(await put(1, { edges: [E(0, 0, "right", "wall")] })), answer(await put(1, { edges: [E(0, 0, "left", "arch")] })), (await put(1, { edges: [E(1, 1, "top", "wall"), E(1, 1, "top", "door")] })).body,
    answer(await put(1, { edges: [{ x: "1", y: 0, side: "top", kind: "wall" }] })), answer(await put(1, { edges: { x: 0 } })), answer(await put(1, { edges: [null] })),
  ], ["400 bad_edge", "400 bad_edge", "400 bad_edge", "400 bad_edge", "400 bad_edge", { error: "duplicate_edge", index: 1, with: 0 }, "400 format", "400 format", "400 format"]);
  eq("an edge room 2 keeps (shared, and room 2 is newer) is not room 1's to set", (await put(1, { edges: [E(8, 6, "left", "wall")] })).body, { error: "edge_shared", index: 0, room: 2 });
  const inner = [E(0, 0, "top", "window"), E(3, 1, "left", "door"), E(3, 0, "left", "wall"), E(0, 5, "left", "window"), E(7, 8, "top", "window")];
  const s1 = await put(1, { edges: inner });
  eq("walls, windows and doors inside room 1 and on its outer edges: saved sorted (side, y, x), the layout kept", [s1.status, s1.body.hideout.rooms[0].edges, s1.body.hideout.rooms[0].size],
    [200, [E(3, 0, "left", "wall"), E(3, 1, "left", "door"), E(0, 5, "left", "window"), E(0, 0, "top", "window"), E(7, 8, "top", "window")], 8]);
  eq("room 2 may not lose its only door to room 1", [(await put(2, { edges: [] })).body, answer(await put(2, { edges: [E(0, 1, "left", "window")] }))], [{ error: "disconnected", rooms: [2] }, "400 disconnected"]);
  eq("…but may move it along the shared edge, and add a wall on its bottom edge", [answer(await put(2, { edges: [E(0, 2, "left", "door"), E(1, 8, "top", "wall")] })), (await room2()).edges], [200, [E(0, 2, "left", "door"), E(1, 8, "top", "wall")]]);
  const keep = (await get(P)).rooms.map((r) => [r.name, r.floor, r.edges]);
  eq("an older app's save (layout and version only) leaves name, floor and edges as they are", [answer(await app("PUT", "/api/app/hideout", P.token, { room: 2, layout: [chair(0, 0)], version: v(2) })), (await get(P)).rooms.map((r) => [r.name, r.floor, r.edges]), (await room2()).layout.length],
    [200, keep, 1]);

  // room 3 under rooms 1 and 2, across the line between them
  const b3 = await buy({ x: 6, y: 8 });
  const room3 = b3.body.hideout.rooms[2];
  eq("room 3 under rooms 1 and 2: two edges shared with each, the door goes to room 1 (the lower on a tie)", [b3.status, room3.x, room3.y, room3.size, room3.edges.filter((e) => e.kind === "door")], [200, 6, 8, 4, [E(0, 0, "top", "door")]]);
  eq("…what rooms 1 and 2 had on the edges it now shares came with it", room3.edges, [E(0, 0, "top", "door"), E(1, 0, "top", "window"), E(3, 0, "top", "wall")]);
  eq("…and is no longer theirs in GET (nothing rewritten)", [b3.body.hideout.rooms[0].edges.some((e) => e.y === 8), b3.body.hideout.rooms[1].edges, JSON.parse(r2().edges).length], [false, [E(0, 2, "left", "door")], 2]);
  eq("…room 1 may not set it again", (await put(1, { edges: [E(7, 8, "top", "wall")] })).body, { error: "edge_shared", index: 0, room: 3 });
  const grown3 = [];
  for (const to of [5, 6, 7, 8]) grown3.push(answer(await grow(P, to, 3)));
  eq("its growing square was free: room 3 grows to 8 x 8", grown3, [200, 200, 200, 200]);
  // doors make a graph: room 2 can be reached through room 3
  eq("room 3 opens a door to room 2; then room 2 may close its own to room 1", [answer(await put(3, { edges: [E(0, 0, "top", "door"), E(2, 0, "top", "door")] })), answer(await put(2, { edges: [] })), (await get(P)).rooms.map((r) => r.edges.length)], [200, 200, [4, 0, 2]]);
  eq("…but room 3 may not then close its door to room 1 (rooms 2 and 3 cut off)", (await put(3, { edges: [E(2, 0, "top", "door")] })).body, { error: "disconnected", rooms: [2, 3] });
  eq("…nor its door to room 2", (await put(3, { edges: [E(0, 0, "top", "door")] })).body, { error: "disconnected", rooms: [2] });
  // two saves of two rooms at once, each fine alone, together cutting room 2 off: the second is told the other rooms changed
  await put(2, { edges: [E(0, 2, "left", "door")] });
  const race = await atOnce([() => put(2, { edges: [] }), () => put(3, { edges: [E(0, 0, "top", "door")] })]);
  const after = (await get(P)).rooms;
  eq("two door changes at once that would cut a room off: one wins, the other is stale", [race.map(answer).sort(), unreachable(after.map((r) => ({ ...r, edgeList: r.edges })))], [[200, "409 stale"], []]);
  eq("each room's place, size and floor come back in GET", after.map((r) => [r.room, r.x, r.y, r.size, r.floor]), [[1, 0, 0, 8, "parquet"], [2, 8, 0, 8, "marble"], [3, 6, 8, 8, "parquet"]]);
  ok("the database keeps a room where it was placed", (() => { try { d1.raw.prepare("UPDATE hideout_rooms SET x = 30 WHERE account_id = ? AND room = 3").run(id); return false; } catch (e) { return /stays where/.test(e.message); } })());
  ok("…and refuses two rooms on one tile", (() => { try { d1.raw.prepare("INSERT INTO hideout_rooms (account_id, room, x, y) VALUES (?, 4, 10, 10)").run(id); return false; } catch (e) { return /overlap/.test(e.message); } })());
  ok("…or a room grown into another", (() => { try { d1.raw.prepare("UPDATE hideout_rooms SET size = 9 WHERE account_id = ? AND room = 1").run(id); return false; } catch (e) { return /overlap/.test(e.message); } })());
  const Q = await guest();
  await grant(Q.account.id, 3000);
  for (const to of [5, 6, 7, 8]) await grow(Q, to);
  const off = await buyRoom(Q, { x: 8, y: 6 });
  eq("an offset (two edges shared with room 1): bought, its door on the first of them", [off.status, off.body.x, off.body.y, off.body.hideout.rooms[1].edges], [200, 8, 6, [{ x: 0, y: 0, side: "left", kind: "door" }]]);
}

/* ───────────── rooms on every side: the corner a room grows toward ───────────── */
{
  const E = (x, y, side, kind) => ({ x, y, side, kind });
  const L = await guest(), lid = L.account.id;
  await grant(lid, 8000);
  for (const to of [5, 6, 7, 8]) await grow(L, to);
  const left = await buyRoom(L, { x: -4, y: 2 });
  eq("left of room 1: bought, growing left and down (the first corner whose 8 x 8 is free), its door on its right side",
    [left.status, left.body.x, left.body.y, left.body.grow, left.body.hideout.rooms[1].grow, left.body.hideout.rooms[1].edges], [200, -4, 2, "sw", "sw", [E(4, 1, "left", "door")]]);
  const rowOf = (id, room) => one("SELECT x, y, size, version, layout, edges FROM hideout_rooms WHERE account_id = ? AND room = ?", id, room);
  const putIn = (p, id, room, fields) => app("PUT", "/api/app/hideout", p.token, { room, version: rowOf(id, room).version, ...fields });
  eq("(a chair, a bed and a wall in it)", answer(await putIn(L, lid, 2, { layout: [chair(0, 0), { item: "BED", x: 1, y: 2, shape: "11" }], edges: [E(4, 1, "left", "door"), E(1, 1, "top", "wall")] })), 200);
  const before = rowOf(lid, 2), g = await grow(L, 5, 2), lr = g.body.hideout.rooms[1];
  eq("growing left: x goes down by 1, the room keeps its right and top edges", [g.status, lr.x, lr.y, lr.size, lr.x + lr.size, lr.y], [200, -5, 2, 5, 0, 2]);
  eq("…its layout and edges shift one column in room coordinates, so they stay where they were on the board", [lr.layout.map((p) => [p.item, p.x, p.y]), lr.edges],
    [[["CHAIR", 1, 0], ["BED", 2, 2]], [E(5, 1, "left", "door"), E(2, 1, "top", "wall")]]);
  eq("…and its version goes up: a copy from before is stale", [lr.version, before.version + 1, answer(await app("PUT", "/api/app/hideout", L.token, { room: 2, layout: [chair(0, 0)], version: before.version }))], [before.version + 1, before.version + 1, "409 stale"]);
  eq("…the door still joins it to room 1", unreachable((await get(L)).rooms.map((r) => ({ ...r, edgeList: r.edges }))), []);
  const ok1 = (await get1(L)).version;
  eq("growing right and down (room 1) shifts nothing and keeps the version", [answer(await grow(L, 9, 1)), (await get1(L)).version], [200, ok1]);
  // the newest room's growing square is kept free for it
  const V = await guest(), vid = V.account.id;
  await grant(vid, 8000);
  for (const to of [5, 6, 7, 8]) await grow(V, to);
  await buyRoom(V, { x: 8, y: 0 });
  for (const to of [5, 6, 7, 8]) await grow(V, to, 2);
  const b3 = await buyRoom(V, { x: 4, y: 8 }); // its 8 x 8 (right and down): x 4..11, y 8..15
  eq("(room 3 under room 1, growing right and down)", [b3.status, b3.body.grow], [200, "se"]);
  const c = coins(vid), blocked = await grow(V, 9, 2);
  eq("room 2 may not grow into room 3's growing square while room 3 is under 8 x 8, and pays nothing", [blocked.status, blocked.body, coins(vid)], [409, { error: "no_space", room: 2, size: 8, to: 9, rooms: [3], reserved: true }, c]);
  for (const to of [5, 6, 7, 8]) await grow(V, to, 3);
  eq("…room 3 at 8 x 8 now stands there itself", (await grow(V, 9, 2)).body, { error: "no_space", room: 2, size: 8, to: 9, rooms: [3] });
  // growing up, and up and left
  const W = await guest(), wid = W.account.id;
  await grant(wid, 8000);
  for (const to of [5, 6, 7, 8]) await grow(W, to);
  const up = await buyRoom(W, { x: 2, y: -4, grow: "ne" });
  eq("above room 1, growing right and up as asked; its door on its bottom side", [up.status, up.body.grow, up.body.hideout.rooms[1].edges], [200, "ne", [E(1, 4, "top", "door")]]);
  await putIn(W, wid, 2, { layout: [chair(0, 0)] });
  const gu = (await grow(W, 5, 2)).body.hideout.rooms[1];
  eq("growing up: y goes down by 1, the layout and edges shift one row", [gu.x, gu.y, gu.size, gu.layout.map((p) => [p.x, p.y]), gu.edges], [2, -5, 5, [[0, 1]], [E(1, 5, "top", "door")]]);
  for (const to of [6, 7, 8]) await grow(W, to, 2);
  const nw = await buyRoom(W, { x: -2, y: -4 });
  const nwRoom = nw.body.hideout.rooms[2];
  eq("between rooms 1 and 2, only up and left is free: chosen; the door on the longer shared edge (room 2's)", [nw.status, nw.body.grow, nwRoom.edges.filter((e) => e.kind === "door")], [200, "nw", [E(4, 1, "left", "door")]]);
  await putIn(W, wid, 3, { layout: [chair(3, 3)] });
  const gn = (await grow(W, 5, 3)).body.hideout;
  eq("growing up and left: x and y go down by 1, everything shifts one column and one row", [gn.rooms[2].x, gn.rooms[2].y, gn.rooms[2].layout.map((p) => [p.x, p.y]), gn.rooms[2].edges.filter((e) => e.kind === "door"), unreachable(gn.rooms.map((r) => ({ ...r, edgeList: r.edges })))],
    [-3, -5, [[4, 4]], [E(5, 2, "left", "door")], []]);
  ok("the database lets a room move only by growing toward its corner", (() => {
    const tryIt = (sql) => { try { d1.raw.prepare(sql).run(wid); return "ran"; } catch (e) { return /stays where/.test(e.message) ? "refused" : e.message; } };
    return tryIt("UPDATE hideout_rooms SET x = x - 1 WHERE account_id = ? AND room = 3") === "refused" && tryIt("UPDATE hideout_rooms SET grow = 'se' WHERE account_id = ? AND room = 3") === "refused";
  })());
  // the board's bounds: every tile of a room, and of its growing square
  const X = await guest(), xid = X.account.id;
  await grant(xid, 3000);
  d1.raw.prepare("INSERT INTO hideout_rooms (account_id, room, x, y, size) VALUES (?, 1, 0, 0, 8), (?, 2, 57, 0, 8)").run(xid, xid); // set by hand: room 2 against the right bound
  eq("a room grown off the board: no space", (await grow(X, 9, 2)).body, { error: "no_space", room: 2, size: 8, to: 9, rooms: [], board: { min: -64, max: 64 } });
  eq("a 4 x 4 off the board; a growing square off the board", [answer(await buyRoom(X, { x: 62, y: 8 })), (await buyRoom(X, { x: 61, y: 8, grow: "se" })).body], ["400 out_of_bounds", { error: "no_room_to_grow", need: 8 }]);
  const edge = await buyRoom(X, { x: 61, y: 8 });
  eq("…the same place growing left and down fits", [edge.status, edge.body.grow], [200, "sw"]);
  ok("the database refuses a room off the board", (() => { try { d1.raw.prepare("INSERT INTO hideout_rooms (account_id, room, x, y, size) VALUES (?, 9, 60, 40, 8)").run(xid); return false; } catch (e) { return /off the board/.test(e.message); } })());
  // an older app's purchase: the first place, on any side, with a free growing square in any direction
  const T = await guest(), tid = T.account.id;
  await grant(tid, 1000);
  d1.raw.prepare("INSERT INTO hideout_rooms (account_id, room, x, y, size) VALUES (?, 2, 60, 12, 4), (?, 3, 57, 0, 8)").run(tid, tid); // set by hand
  const auto = await buyRoom(T, {});
  eq("an older app's room: not right of room 3 (off the board), not below it where no 8 x 8 fits, but the first place below it that one does",
    [auto.status, auto.body.room, auto.body.x, auto.body.y, auto.body.grow], [200, 4, 56, 8, "sw"]);
}

/* ───────────── migration 0007 on a hideout that already had rooms ───────────── */
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadoku-0006-"));
  for (const f of fs.readdirSync(path.join(ROOT, "migrations")).filter((f) => f.endsWith(".sql") && f < "0007")) fs.copyFileSync(path.join(ROOT, "migrations", f), path.join(dir, f));
  const old = openD1(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  const ins = old.raw.prepare("INSERT INTO hideout_rooms (account_id, room, size, layout, version) VALUES (?, ?, ?, '[]', 3)");
  [8, 8, 6].forEach((size, i) => ins.run("three", i + 1, size));
  for (let i = 1; i <= 10; i++) ins.run("ten", i, 10);
  ins.run("one", 1, 4);
  old.raw.exec(fs.readFileSync(path.join(ROOT, "migrations", "0007_app_hideout_board.sql"), "utf8"));
  const placed = (acc) => old.raw.prepare("SELECT room, x, y, size, grow, name, floor, edges, version FROM hideout_rooms WHERE account_id = ? ORDER BY room").all(acc).map((r) => ({ ...r, edgeList: JSON.parse(r.edges) }));
  const three = placed("three");
  eq("existing rooms: room 1 at (0, 0), room 2 to its right, room 3 below room 2; a door in the middle of each shared edge",
    three.map((r) => [r.room, r.x, r.y, r.edgeList]), [[1, 0, 0, []], [2, 8, 0, [{ x: 0, y: 3, side: "left", kind: "door" }]], [3, 8, 8, [{ x: 2, y: 0, side: "top", kind: "door" }]]]);
  eq("…growing right and down, names empty, the parquet floor, versions kept, and all connected", [three.map((r) => `${r.grow}|${r.name}|${r.floor}|${r.version}`), unreachable(three)], [["se||parquet|3", "se||parquet|3", "se||parquet|3"], []]);
  const ten = placed("ten");
  const apart = ten.every((a) => ten.every((b) => a.room === b.room || !overlaps(a, b)));
  eq("ten rooms of 10 x 10: a staircase inside the bounds, no overlap, all connected", [ten[9].x, ten[9].y, apart, unreachable(ten), ten.every((r) => r.x <= 64 && r.y <= 64)], [50, 40, true, [], true]);
  eq("a lone room 1 stays as it was", placed("one").map((r) => [r.x, r.y, r.edges]), [[0, 0, "[]"]]);
}

/* ───────────── a guest who signs in, deleting the account ───────────── */
{
  const G = await guest();
  await grant(G.account.id, 100);
  eq("(the guest grows its board and saves a layout)", [answer(await grow(G, 5)), answer(await save(G, [chair(4, 4)], 0))], [200, 200]);
  const S = await signIn("hideout-1", G.token);
  eq("a guest who signs in to a new account takes its hideout along", [S.merge && S.merge.result, (await get1(S)).size, (await get1(S)).layout.map((p) => `${p.item}@${p.x},${p.y}`), one("SELECT COUNT(*) AS n FROM hideout_rooms WHERE account_id = ?", G.account.id).n], ["moved", 5, ["CHAIR@4,4"], 0]);
  await grant(S.account.id, 200);
  eq("…and grows it from there", [(await grow(S, 6)).body.spent, (await get1(S)).size], [200, 6]);
  const del = await app("DELETE", "/api/account", S.token);
  eq("deleting the account deletes its hideout", [del.status, named(S.account.id), named(G.account.id), one("SELECT COUNT(*) AS n FROM hideout_rooms WHERE account_id = ?", S.account.id).n], [200, [], [], 0]);
  const gone = await app("DELETE", "/api/account", A.token);
  eq("…a guest's too", [gone.status, named(A.account.id)], [200, []]);
}

console.log(`${n} checks, ${bad.length} failed`);
bad.forEach((b) => console.log("  FAIL " + b));
process.exit(bad.length ? 1 : 0);
