// The test server's tester kit (functions/_lib/app/devkit.js, functions/api/app/dev/kit.js; architecture 4.17), tested in plain
// node:   npm run test:app-devkit
// Like scripts/test-app-hideout.mjs: every call goes through functions/api/_middleware.js into the real handler, as the app
// calls it (its origin, a guest's bearer token), against a SQLite database with the real migrations/ applied. What is checked:
// the kit exists only with DEV_KIT=1 on a preview or local address (404 everywhere else, the production domain above all); it
// gives every cosmetic, prop and pack at every tier it can have, and coins and hints only through the ledger; a second call tops
// up and nothing grows without bound; and on the test server a GUEST can go through every flow the Shop offers: buy and open
// packs, swap a cosmetic of the day (free and with a dev ad), "buy" coins, hints and memberships with a dev token, grow the
// hideout, buy a room and place any prop at any tier.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openD1 } from "./lib/d1-sqlite.mjs";
import { APP_ORIGIN } from "../functions/_lib/app/cors.js";
import { onRequest as middleware } from "../functions/api/_middleware.js";
import { KIT_CATALOGUE, KIT_COINS, KIT_HINTS, KIT_PROPS, KIT_AVATAR, KIT_PACKS, KIT_REASON } from "../functions/_lib/app/devkit.js";
import { HIDEOUT_PROPS } from "../functions/_lib/app/hideout_props.js";
import { VARIANTS } from "../functions/_lib/app/economy.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.shadoku.net";
const TEST = "https://test.shadoku.pages.dev";

let n = 0; const bad = [];
const ok = (what, cond) => { n++; if (!cond) bad.push(what); };
const eq = (what, got, want) => ok(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`, JSON.stringify(got) === JSON.stringify(want));

/* ───────────── harness ───────────── */
const NOW = Date.UTC(2026, 10, 25, 12);
const kv = new Map();
const KV = { get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, String(v)); }, delete: async (k) => { kv.delete(k); } };
const d1 = openD1(path.join(ROOT, "migrations"));
await (await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "db.js")).href)).db({ SHADOKU_DB: d1 });
const base = { SHADOKU_DB: d1, SHADOKU_KV: KV, SESSION_SECRET: "test-secret-".repeat(4), NOW: () => NOW };
const PROD = base; // production: no DEV_* at all
const PREVIEW = { ...base, DEV_BILLING: "1", DEV_ADS: "1", DEV_KIT: "1" }; // wrangler.toml [env.preview]

let IP = 0;
/** One call as the app makes it. → { status, body } */
async function app(method, where, token, body, { host = TEST, env = PREVIEW } = {}) {
  const url = new URL(host + where);
  const rel = url.pathname.replace(/^\/api\//, "");
  const file = [path.join(ROOT, "functions", "api", `${rel}.js`), path.join(ROOT, "functions", "api", rel, "index.js")].find((f) => fs.existsSync(f));
  const handler = (await import(pathToFileURL(file).href))[`onRequest${method[0]}${method.slice(1).toLowerCase()}`];
  const h = new Headers({ Origin: APP_ORIGIN, "CF-Connecting-IP": `10.7.0.${++IP % 250}` });
  if (token) h.set("Authorization", `Bearer ${token}`);
  const request = new Request(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await middleware({ request, env, next: (req) => handler({ request: req || request, env, params: {} }) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const answer = (r) => (r.status === 200 ? 200 : `${r.status} ${r.body && r.body.error}`);
const rows = (sql, ...binds) => d1.raw.prepare(sql).all(...binds);
const one = (sql, ...binds) => rows(sql, ...binds)[0];
const wallet = (id) => one("SELECT coins, hints FROM wallets WHERE account_id = ?", id);
const held = (id, item, tier = 0) => (one("SELECT qty FROM inventory WHERE account_id = ? AND item_id = ? AND tier = ?", id, item, tier) || { qty: 0 }).qty;
const kit = (token, opts) => app("POST", "/api/app/dev/kit", token, undefined, opts);
let req = 0;
const rid = () => `req-${String(++req).padStart(6, "0")}`;

const G = (await app("POST", "/api/app/auth/guest", undefined, {}, { host: TEST })).body;
const id = G.account.id;
eq("a guest on the test server", [G.account.kind, id.startsWith("guest:")], ["guest", true]);

/* ───────────── only on the test server ───────────── */
{
  const before = { items: one("SELECT COUNT(*) AS n FROM items").n, inv: one("SELECT COUNT(*) AS n FROM inventory").n, ledger: one("SELECT COUNT(*) AS n FROM ledger").n };
  eq("a preview address without DEV_KIT: 404, as if it did not exist", [answer(await kit(G.token, { env: { ...PREVIEW, DEV_KIT: undefined } })), answer(await kit(G.token, { env: { ...PREVIEW, DEV_KIT: "0" } }))], ["404 not_found", "404 not_found"]);
  eq("the production domain with DEV_KIT=1: 404", [answer(await kit(G.token, { host: SITE })), answer(await kit(G.token, { host: "https://shadoku.net" }))], ["404 not_found", "404 not_found"]);
  eq("the project's own production address (shadoku.pages.dev) and look-alikes: 404", [
    answer(await kit(G.token, { host: "https://shadoku.pages.dev" })),
    answer(await kit(G.token, { host: "https://test.shadoku.pages.dev.evil.com" })),
  ], ["404 not_found", "404 not_found"]);
  eq("production as configured (no DEV_* at all): 404", answer(await kit(G.token, { host: SITE, env: PROD })), "404 not_found");
  eq("a disabled kit answers before it reads a token", answer(await kit(undefined, { host: SITE })), "404 not_found");
  eq("…and nothing was written", { items: one("SELECT COUNT(*) AS n FROM items").n, inv: one("SELECT COUNT(*) AS n FROM inventory").n, ledger: one("SELECT COUNT(*) AS n FROM ledger").n }, before);
  eq("on the test server it still needs the app's token (no token: the cookie path, refused from the app's origin)", [answer(await kit(undefined)), answer(await kit("x".repeat(40)))], ["403 origin", "401 auth"]);
}

/* ───────────── the kit ───────────── */
const cards = () => rows("SELECT id, kind, rarity FROM items WHERE active = 1 AND kind IN ('prop', 'furniture', 'avatar')");
{
  eq("the catalogue has only the achievements' unique cosmetics before the kit", [...new Set(cards().map((c) => c.rarity))], ["unique"]);
  const r = await kit(G.token);
  eq("the kit answers 200 with what it did", [r.status, r.body.ok, r.body.kit.catalogueAdded, r.body.kit.coinsAdded, r.body.kit.hintsAdded, r.body.kit.coinsTo, r.body.kit.hintsTo],
    [200, true, KIT_CATALOGUE.length, KIT_COINS, KIT_HINTS, KIT_COINS, KIT_HINTS]);
  ok("the catalogue covers every card prop and every card avatar cosmetic (common .. legendary)", KIT_CATALOGUE.length === 151 + 100);
  eq("every prop of the hideout list is now an item, the starting set aside", Object.keys(HIDEOUT_PROPS.props).filter((p) => !HIDEOUT_PROPS.starters.includes(p) && !one("SELECT 1 AS x FROM items WHERE id = ?", p)), []);
  eq("the answer's state is the wallet snapshot", [r.body.state.coins, r.body.state.hints, typeof r.body.state.inventory, typeof r.body.state.variants, Array.isArray(r.body.state.entitlements)], [KIT_COINS, KIT_HINTS, "object", "object", true]);
  const s = (await app("GET", "/api/app/wallet", G.token)).body.state;
  eq("…the same as GET /wallet's (serverTime aside)", { ...r.body.state, serverTime: 0 }, { ...s, serverTime: 0 });
  eq("coins and hints are in the wallet", wallet(id), { coins: KIT_COINS, hints: KIT_HINTS });
  eq("…written by two ledger lines of the kit's reason", rows("SELECT currency, delta, balance_after AS b FROM ledger WHERE account_id = ? AND reason = ? ORDER BY seq", id, KIT_REASON), [{ currency: "coin", delta: KIT_COINS, b: KIT_COINS }, { currency: "hint", delta: KIT_HINTS, b: KIT_HINTS }]);
  const all = cards(), want = [];
  for (const c of all) {
    const tiers = c.rarity === "unique" ? [0] : [0, 1, 2, 3, 4];
    for (const t of tiers) want.push([c.id, t, c.kind === "avatar" ? KIT_AVATAR : KIT_PROPS]);
  }
  for (const p of rows("SELECT id FROM items WHERE kind = 'pack' AND active = 1")) want.push([p.id, 0, KIT_PACKS]);
  const got = rows("SELECT item_id, tier, qty FROM inventory WHERE account_id = ? ORDER BY item_id, tier", id).map((i) => [i.item_id, i.tier, i.qty]);
  const sort = (a) => a.map((x) => JSON.stringify(x)).sort();
  eq("every cosmetic at every tier (unique ones as the card), every pack: in the kit's numbers", sort(got), sort(want));
  eq("a prop's variants are held, a unique prop as its card, an avatar cosmetic once a tier", [held(id, "BARREL", 4), held(id, "DOOR_FRONT", 0), held(id, "DOOR_FRONT", 1), held(id, "clothing-flannel", 3)], [KIT_PROPS, KIT_PROPS, 0, KIT_AVATAR]);
  eq("no entitlement is given (the upgrades stay to be bought)", rows("SELECT key FROM entitlements WHERE account_id = ?", id), []);
  eq("the snapshot shows the variants", r.body.state.variants.BARREL, Object.fromEntries(VARIANTS.slice(1).map((v) => [v, KIT_PROPS]))); // the tier names come from economy.js (release still says "diamond")
}

/* ───────────── calling it again tops up ───────────── */
{
  const lines = one("SELECT COUNT(*) AS n FROM ledger WHERE account_id = ?", id).n, inv = rows("SELECT item_id, tier, qty FROM inventory WHERE account_id = ? ORDER BY item_id, tier", id);
  const again = await kit(G.token);
  eq("a second call at full: nothing added, no ledger line, the same inventory", [again.body.kit.catalogueAdded, again.body.kit.coinsAdded, again.body.kit.hintsAdded, one("SELECT COUNT(*) AS n FROM ledger WHERE account_id = ?", id).n, rows("SELECT item_id, tier, qty FROM inventory WHERE account_id = ? ORDER BY item_id, tier", id)],
    [0, 0, 0, lines, inv]);
}

/* ───────────── the flows the app's Shop needs, as a guest on the test server ───────────── */
{
  const shop = (await app("GET", "/api/app/shop", G.token)).body.items;
  const byId = new Map(shop.map((i) => [i.id, i]));
  ok("GET /shop lists the packs with their odds", ["pack_bronze", "pack_silver", "pack_gold"].every((p) => byId.get(p) && byId.get(p).odds && byId.get(p).priceCoins));
  const ofTheDay = shop.filter((i) => i.ofTheDay);
  eq("…and now 8 cosmetics of the day (avatar and hideout, one per rarity)", ofTheDay.length, 8);
  ok("…the hint bundles, coin packs and upgrades", ["hints_5", "coins_100", "member", "member_gold", "remove_ads", "noob_kit"].every((x) => byId.has(x)));

  // a pack, bought with coins and opened
  const bought = await app("POST", "/api/app/shop/buy", G.token, { itemId: "pack_bronze", requestId: rid() });
  eq("buying a pack with coins", [answer(bought), bought.body.spent, held(id, "pack_bronze")], [200, 90, KIT_PACKS + 1]);
  const opened = await app("POST", "/api/app/packs/open", G.token, { packId: "pack_bronze", oddsVersion: byId.get("pack_bronze").odds.version, requestId: rid() });
  eq("…and opening it: 5 cards, one of them the hints card", [answer(opened), opened.body.cards.length, opened.body.cards.filter((c) => c.hints).length, held(id, "pack_bronze")], [200, 5, 1, KIT_PACKS]);
  const cosmetic = ofTheDay[0];
  eq("a cosmetic of the day for coins", answer(await app("POST", "/api/app/shop/buy", G.token, { itemId: cosmetic.id, requestId: rid() })), 200);
  eq("a hint bundle for coins", answer(await app("POST", "/api/app/shop/buy", G.token, { itemId: "hints_5", requestId: rid() })), 200);

  // swapping a cosmetic of the day: the free one, then one with a dev ad
  const swap = await app("POST", "/api/app/shop/refresh", G.token, { itemId: ofTheDay[1].id });
  eq("the day's free swap", [answer(swap), swap.body.how], [200, "free"]);
  eq("…a second one without an ad is refused", answer(await app("POST", "/api/app/shop/refresh", G.token, { itemId: ofTheDay[2].id })), "409 free_used");
  const ticket = (await app("POST", "/api/app/ads/ticket", G.token, { placement: "shop_refresh" })).body.ticket;
  const claim = await app("POST", "/api/app/ads/claim", G.token, { ticket, integrity: "" });
  eq("a dev ad pays the ticket (DEV_ADS)", [answer(claim), claim.body.result], [200, "ok"]);
  const adSwap = await app("POST", "/api/app/shop/refresh", G.token, { itemId: ofTheDay[2].id, ticket });
  eq("…and the ticket buys a swap", [answer(adSwap), adSwap.body.how], [200, "ad"]);
  const prodClaim = await app("POST", "/api/app/ads/claim", G.token, { ticket: "x".repeat(24), integrity: "" }, { host: SITE });
  eq("on the production domain a dev ad pays nothing", answer(prodClaim), "503 ads_unavailable");

  // real-money products with a dev token
  const pay = (sku, opts) => app("POST", "/api/app/billing/verify", G.token, { sku, purchaseToken: `dev.${sku}.${crypto.randomUUID()}` }, opts);
  const c0 = wallet(id).coins;
  const coins500 = await pay("coins_500");
  eq("a guest buys coins with a dev token (DEV_BILLING)", [answer(coins500), coins500.body.granted && coins500.body.granted.coins, wallet(id).coins - c0], [200, 500, 500]);
  const h0 = wallet(id).hints;
  const noob = await pay("noob_kit");
  eq("…the Noob Kit once", [answer(noob), wallet(id).hints - h0, answer(await pay("noob_kit"))], [200, 15, "409 owned"]);
  const member = await pay("member"), gold = await pay("member_gold"), noAds = await pay("remove_ads");
  eq("…the memberships and No ads", [answer(member), answer(gold), answer(noAds), gold.body.state.entitlements], [200, 200, 200, ["member", "member_gold", "once:noob_kit", "remove_ads"]]);
  eq("…the free hints follow the membership", gold.body.state.hintsToday.free, 15);
  eq("a token for another sku is refused", answer(await app("POST", "/api/app/billing/verify", G.token, { sku: "coins_100", purchaseToken: `dev.coins_500.${crypto.randomUUID()}` })), "400 invalid");
  eq("on the production domain a guest still cannot buy (even with DEV_BILLING set)", answer(await pay("coins_100", { host: SITE })), "403 signin_required");
  eq("a build with DEV_BILLING but not DEV_KIT keeps production's rule for guests", answer(await pay("coins_100", { env: { ...PREVIEW, DEV_KIT: undefined } })), "403 signin_required");
  eq("…and production as configured refuses too", answer(await pay("coins_100", { host: SITE, env: PROD })), "403 signin_required");
  eq("purchases go through the ledger", rows("SELECT currency, delta FROM ledger WHERE account_id = ? AND reason = 'iap' ORDER BY seq", id), [{ currency: "coin", delta: 500 }, { currency: "coin", delta: 500 }, { currency: "hint", delta: 15 }]);

  // the hideout: grow room 1 to 10 x 10, buy room 2, place any prop at any tier in both
  for (const to of [5, 6, 7, 8, 9, 10]) eq(`room 1 grows to ${to} x ${to}`, answer(await app("POST", "/api/app/hideout/grow", G.token, { room: 1, to })), 200);
  const room = await app("POST", "/api/app/hideout/rooms", G.token, { requestId: rid() });
  eq("a second room is bought", [answer(room), room.body.room, room.body.spent], [200, 2, 1000]);
  eq("…and grows too", answer(await app("POST", "/api/app/hideout/grow", G.token, { room: 2, to: 5 })), 200);
  const layout = [{ item: "BARREL", x: 0, y: 0, tier: 4 }, { item: "BARREL", x: 1, y: 0, tier: 0 }, { item: "DOOR_FRONT", x: 2, y: 0 }, { item: "CHAIR", x: 3, y: 0 }, { item: "BED", x: 0, y: 1, shape: "11" }];
  eq("a room with a Shadow variant, a card, a unique prop and starters is saved", answer(await app("PUT", "/api/app/hideout", G.token, { room: 1, layout, version: 0 })), 200);
  eq("…and the same props in the second room (counted across rooms)", answer(await app("PUT", "/api/app/hideout", G.token, { room: 2, layout, version: 0 })), 200);
  const tooMany = Array.from({ length: KIT_PROPS - 1 }, (_, i) => ({ item: "BARREL", x: i % 10, y: 5 + Math.floor(i / 10), tier: 4 }));
  eq("…but no more Shadow barrels than held, all rooms together", (await app("PUT", "/api/app/hideout", G.token, { room: 1, layout: [...layout, ...tooMany], version: 1 })).body.error, "not_owned");
  const ach = await app("GET", "/api/app/achievements", G.token);
  eq("achievements answer for the guest", answer(ach), 200);
  ok("…and the kit's collection unlocked \"collect everything\" (with its GOLDEN_FLOOR)", ach.body.achievements.some((a) => a.achievement === "collect_all" && a.done) && held(id, "GOLDEN_FLOOR") >= 1);

  // the kit tops the coins back up after all that spending, and puts back what was used, never more
  eq("a merge uses three plain cards", answer(await app("POST", "/api/app/cards/merge", G.token, { itemId: "BARREL", tier: 0, requestId: rid() })), 200);
  const spent = KIT_COINS - wallet(id).coins;
  ok("coins were spent", spent !== 0);
  const top = await kit(G.token);
  eq("the kit tops up the coins and hints to the mark", [top.body.kit.coinsAdded, wallet(id).coins, wallet(id).hints >= KIT_HINTS], [spent, KIT_COINS, true]);
  eq("…the merged card back to the kit's count, the variant it made kept", [held(id, "BARREL", 0), held(id, "BARREL", 1)], [KIT_PROPS, KIT_PROPS + 1]);
  eq("…the pack opened is back (plus the Noob Kit's, which the kit keeps)", held(id, "pack_bronze"), KIT_PACKS + 1);
  const again = await kit(G.token);
  eq("…and a third call adds nothing", [again.body.kit.coinsAdded, again.body.kit.hintsAdded, held(id, "BARREL", 1)], [0, 0, KIT_PROPS + 1]);
}

/* ───────────── the books balance ───────────── */
{
  const off = rows(`SELECT w.account_id FROM wallets w WHERE w.coins IS NOT COALESCE((SELECT balance_after FROM ledger l WHERE l.account_id = w.account_id AND l.currency = 'coin' ORDER BY seq DESC LIMIT 1), 0)
    OR w.hints IS NOT COALESCE((SELECT balance_after FROM ledger l WHERE l.account_id = w.account_id AND l.currency = 'hint' ORDER BY seq DESC LIMIT 1), 0)`);
  eq("every wallet is its newest ledger line", off, []);
  eq("the kit's lines are the kit's reason, one per call and currency at most", rows("SELECT COUNT(*) AS n, COUNT(DISTINCT ref || currency) AS k FROM ledger WHERE reason = ?", KIT_REASON).map((r) => r.n === r.k), [true]);
  const src = fs.readFileSync(path.join(ROOT, "functions", "_lib", "app", "devkit.js"), "utf8");
  ok("the kit writes no balance itself (ledger.js does)", !/\b(INSERT\s+(OR\s+\w+\s+)?INTO|REPLACE\s+INTO|UPDATE)\s+(wallets|ledger)\b/i.test(src));
}

if (bad.length) {
  console.error(`test-app-devkit: ${bad.length} of ${n} checks FAILED`);
  for (const b of bad) console.error(`  - ${b}`);
  process.exit(1);
}
console.log(`test-app-devkit: all ${n} checks passed`);
