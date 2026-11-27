// The shared avatar (functions/api/avatar.js, format v2 of src/avatarCosmetics.js), tested in plain node:   npm run test:avatar
// Like scripts/test-app-shared.mjs: every call goes through functions/api/_middleware.js into the real handler, against a SQLite
// database with the real migrations/ applied. Checked: the v2 code's validation (avatarOk); GET /api/avatar for both callers
// (the site's cookie, the app's token; a guest refused); PUT refuses cosmetics the account does not hold, tier included, and
// keeps what the saved avatar already wears; `updated` follows the saves; a badge on the chest (the 20th field) only when the
// account holds it (an achievement tier with a badge, a membership bought), and GET lists the badges it may wear.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openD1 } from "./lib/d1-sqlite.mjs";
import { seal } from "../functions/_lib/auth.js";
import { avatarOk } from "../functions/_lib/db.js";
import { APP_ORIGIN } from "../functions/_lib/app/cors.js";
import { onRequest as middleware } from "../functions/api/_middleware.js";
import { BADGE_RE, COSMETICS, lookBadge, notHeld, parseCode, withBadge, wornCosmetics } from "../src/avatarCosmetics.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.shadoku.net";
let n = 0; const bad = [];
const ok = (what, cond) => { n++; if (!cond) bad.push(what); };
const eq = (what, got, want) => ok(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`, JSON.stringify(got) === JSON.stringify(want));

/* ───────────── harness (as scripts/test-app-shared.mjs) ───────────── */
let NOW = Date.UTC(2026, 10, 25, 12);
const kvOf = (map) => ({ get: async (k, type) => (map.has(k) ? (type === "json" ? JSON.parse(map.get(k)) : map.get(k)) : null), put: async (k, v) => { map.set(k, String(v)); }, delete: async (k) => { map.delete(k); } });
const VERIFIER = { verify: async (provider, body) => (typeof body.sub === "string" ? { ok: true, provider, sub: body.sub, name: `Player ${body.sub}`, avatar: "" } : { ok: false, error: "invalid" }) };
const d1 = openD1(path.join(ROOT, "migrations"));
await (await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "db.js")).href)).db({ SHADOKU_DB: d1 });
const kv = new Map();
const env = { SHADOKU_DB: d1, SHADOKU_KV: kvOf(kv), SESSION_SECRET: "test-secret-".repeat(4), NOW: () => NOW, IDENTITY_VERIFIER: VERIFIER };
const FILES = [[/^\/api\/avatar$/, () => "avatar.js"], [/^\/api\/app\/(.+)$/, (m) => `app/${m[1]}.js`]];
let IP = 0;
async function hit(method, where, { from = null, token, cookie, body } = {}) {
  const url = new URL(SITE + where);
  const found = FILES.map(([re, to]) => [re.exec(url.pathname), to]).find(([m]) => m);
  const handler = (await import(pathToFileURL(path.join(ROOT, "functions", "api", found[1](found[0]))).href))[`onRequest${method[0]}${method.slice(1).toLowerCase()}`];
  const h = new Headers({ "CF-Connecting-IP": `10.2.0.${++IP % 250}` });
  if (from) h.set("Origin", from === "app" ? APP_ORIGIN : SITE);
  if (token) h.set("Authorization", `Bearer ${token}`);
  if (cookie) h.set("Cookie", `__Host-sh_session=${cookie}`);
  const request = new Request(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await middleware({ request, env, next: (req) => handler({ request: req || request, env, params: {} }) });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed };
}
const app = (method, where, token, opt = {}) => hit(method, where, { from: "app", token, ...opt });
const web = (method, where, cookie, opt = {}) => hit(method, where, { from: "site", cookie, ...opt });
const answer = async (call) => { const r = await call; return r.status === 200 ? 200 : `${r.status} ${r.body && r.body.error}`; };
const cookieFor = (id) => seal(env, { id, provider: id.split(":")[0], name: "Web Player", email: "", avatar: "" }, 30 * 86400);
const give = (id, item, tier = 0, qty = 1) => d1.raw.prepare("INSERT INTO inventory (account_id, item_id, tier, qty, first_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (account_id, item_id, tier) DO UPDATE SET qty = excluded.qty").run(id, item, tier, qty, NOW);

// codes: a plain look (format 1), then the same with cosmetics
const BASE = "m.0.shortRound.grey.none.3.none.3.beardLight.none.1.collarAndSweater.2.wink.angry.serious.4".split(".");
const code = (over = {}, extra = []) => { const f = [...BASE]; for (const [i, v] of Object.entries(over)) f[i] = v; return `L:${[...f, ...extra].join(".")}`; };
const HAT = 4, GLASSES = 6, TIE = 9, CLOTHING = 11, BACK = 16;

/* ───────────── the code's validation (avatarOk, shared by the site, the app and the server) ───────────── */
{
  eq("format 1 stays valid; S. H. Adow and the account picture too", [avatarOk(code()), avatarOk(""), avatarOk("photo")], [true, true, true]);
  eq("cosmetics in the kit's fields, a scene in the backdrop", avatarOk(code({ [HAT]: "flatCap", [CLOTHING]: "trench", [TIE]: "knitScarf", [GLASSES]: "umbra", [BACK]: "library" })), true);
  eq("an 18th field: a known accessory", [avatarOk(code({}, ["cat"])), avatarOk(code({}, ["dragon"])), avatarOk(code({}, ["none"]))], [true, false, false]);
  eq("a 19th field: six tier digits, not all 0, only on card cosmetics", [
    avatarOk(code({ [HAT]: "flatCap" }, ["none", "300000"])),
    avatarOk(code({ [HAT]: "flatCap" }, ["none", "000000"])),
    avatarOk(code({ [HAT]: "flatCap" }, ["none", "500000"])),
    avatarOk(code({ [HAT]: "flatCap" }, ["none", "3000"])),
    avatarOk(code({}, ["none", "300000"])), // a tier on a kit hat
    avatarOk(code({ [GLASSES]: "umbra" }, ["none", "010000"])), // an achievement reward has no variants
    avatarOk(code({ [BACK]: "library" }, ["cat", "000042"])),
  ], [true, false, false, false, false, false, true]);
  eq("too many fields, an empty field, a prototype name, too long", [avatarOk(code({}, ["cat", "000001", "x"])), avatarOk(code({ 2: "" })), avatarOk(code({ 2: "constructor" })), avatarOk(`L:${"a".repeat(241)}`)], [false, false, false, false]);
  eq("what a code wears", wornCosmetics(code({ [HAT]: "flatCap", [GLASSES]: "wayfarers", [BACK]: "library" }, ["cat", "300024"])),
    [{ id: "hat-flatCap", tier: 3 }, { id: "glasses-wayfarers", tier: 0 }, { id: "bg-library", tier: 2 }, { id: "acc-cat", tier: 4 }]);
  eq("the kit's round glasses need U. M. Bra's", wornCosmetics(code({ [GLASSES]: "round" })), [{ id: "glasses-umbra", tier: 0 }]);
  eq("a variant needs that variant; the card as won, any copy; what is kept stays", [
    notHeld([{ id: "hat-flatCap", tier: 3 }], { "hat-flatCap": [0] }), notHeld([{ id: "hat-flatCap", tier: 0 }], { "hat-flatCap": [3] }),
    notHeld([{ id: "hat-flatCap", tier: 3 }], {}, [{ id: "hat-flatCap", tier: 3 }]),
  ], [["hat-flatCap"], [], []]);
  eq("every cosmetic value is letters only (never read as a colour index)", COSMETICS.every((c) => /^[a-z][A-Za-z]*$/.test(c.value)), true);
  eq("parseCode reads the tiers by slot", parseCode(code({}, ["none", "120304"])).tiers, { hat: 1, glassesStyle: 2, tie: 0, clothing: 3, bgArt: 0, acc: 4 });
}

/* ───────────── the badge on the chest: the 20th field ───────────── */
{
  eq("badge tokens: an achievement's tier (1-10), or a membership", ["a-contracts-5", "a-no_hints_very_easy-10", "a-act1-1", "m-member", "m-golden", "a-contracts-0", "a-contracts-11", "a-Contracts-1", "a-no__hints-1", "a-x_1-1", "m-gold", "contracts-5", ""].map((t) => BADGE_RE.test(t)),
    [true, true, true, true, true, false, false, false, false, false, false, false, false]);
  const plain = code();
  const pinned = withBadge(plain, "a-no_hints_very_easy-10");
  eq("a badge is written as letters and digits after an accessory and tiers of \"none\" and \"000000\"", pinned, `${plain}.none.000000.anoHintsVeryEasyT10`);
  eq("…and read back", [lookBadge(pinned), lookBadge(withBadge(plain, "m-golden")), lookBadge(withBadge(plain, "a-act1-1")), lookBadge(plain), lookBadge(""), lookBadge("photo")], ["a-no_hints_very_easy-10", "m-golden", "a-act1-1", null, null, null]);
  eq("the memberships' fields", [withBadge(plain, "m-member").split(".").pop(), withBadge(plain, "m-golden").split(".").pop()], ["mMember", "mGolden"]);
  const dressed = code({ [HAT]: "flatCap" }, ["cat", "300004"]);
  eq("a badge beside an accessory and tiers keeps them; taking it off gives the shortest code back", [withBadge(dressed, "m-member"), withBadge(withBadge(dressed, "m-member"), null), withBadge(withBadge(code({}, ["cat"]), "m-member"), null), withBadge(pinned, null)],
    [`${dressed}.mMember`, dressed, code({}, ["cat"]), plain]);
  eq("a badge replaces a badge; a bad token or a code that is not a portrait changes nothing", [withBadge(pinned, "m-member"), withBadge(plain, "m-gold"), withBadge("", "m-member"), withBadge("photo", "m-member"), withBadge("L:bad", "m-member")],
    [`${plain}.none.000000.mMember`, plain, "", "photo", "L:bad"]);
  eq("avatarOk: a 20th field that is a badge, with \"none\" and \"000000\" before it", [avatarOk(pinned), avatarOk(withBadge(dressed, "m-golden")), avatarOk(`${plain}.none.000000.mGold`), avatarOk(`${plain}.none.000000.aContractsT1`), avatarOk(`${plain}.none.000000.acontractsT0`), avatarOk(`${pinned}.x`), avatarOk(`${plain}.none.000000`)],
    [true, true, false, false, false, false, false]);
  eq("parseCode still reads the look under a badge", [parseCode(withBadge(dressed, "m-member")).acc, parseCode(withBadge(dressed, "m-member")).tiers.acc, wornCosmetics(withBadge(dressed, "m-member"))], ["cat", 4, wornCosmetics(dressed)]);
  // a decoder from before the badge: the old charset and limit pass, the 17 fields are the same, fields 18+ are dropped
  const OLD_RE = /^(|photo|L:[A-Za-z0-9.]{1,200})$/;
  eq("an older decoder still reads the plain look of a badged code", [OLD_RE.test(withBadge(dressed, "a-no_hints_very_easy-10")), withBadge(dressed, "m-member").slice(2).split(".").slice(0, 17).join("."), withBadge(dressed, "m-member").length < 200],
    [true, dressed.slice(2).split(".").slice(0, 17).join("."), true]);
}

/* ───────────── GET and PUT /api/avatar ───────────── */
const signIn = async (sub) => (await app("POST", "/api/app/auth/google", undefined, { body: { sub } })).body;
const a = await signIn("777001"), A = a.account.id;
const g = (await app("POST", "/api/app/auth/guest", undefined, { body: {} })).body;
const cookie = await cookieFor(A);
{
  eq("a new account: no avatar, never saved, nothing held, no badge", (await app("GET", "/api/avatar", a.token)).body, { avatar: "", updated: 0, cosmetics: {}, badges: [] });
  eq("a guest must sign in; the site needs its cookie", [await answer(app("GET", "/api/avatar", g.token)), await answer(web("GET", "/api/avatar")), await answer(web("GET", "/api/avatar", cookie))], ["403 signin_required", "401 auth", 200]);
  const plain = code();
  NOW += 1000;
  eq("the kit's options are free", (await app("PUT", "/api/avatar", a.token, { body: { avatar: plain } })).body, { ok: true, shown: plain, updated: NOW });
  eq("GET reads it back with when", (await web("GET", "/api/avatar", cookie)).body, { avatar: plain, updated: NOW, cosmetics: {}, badges: [] });

  const capped = code({ [HAT]: "flatCap" });
  eq("a cosmetic not held is refused, from the app and from the site", [(await app("PUT", "/api/avatar", a.token, { body: { avatar: capped } })).body, await answer(web("PUT", "/api/avatar", cookie, { body: { avatar: capped } }))], [{ error: "not_held", items: ["hat-flatCap"] }, "403 not_held"]);
  give(A, "hat-flatCap", 0);
  eq("held: both callers see it", [(await app("GET", "/api/avatar", a.token)).body.cosmetics, (await web("GET", "/api/avatar", cookie)).body.cosmetics], [{ "hat-flatCap": [0] }, { "hat-flatCap": [0] }]);
  eq("held as won: worn", await answer(web("PUT", "/api/avatar", cookie, { body: { avatar: capped } })), 200);
  const gold = code({ [HAT]: "flatCap" }, ["none", "300000"]);
  eq("its Gold variant is not held", (await app("PUT", "/api/avatar", a.token, { body: { avatar: gold } })).body, { error: "not_held", items: ["hat-flatCap"] });
  give(A, "hat-flatCap", 3); give(A, "hat-flatCap", 0, 0); // three merged up to Gold: no plain copy left
  eq("a Gold copy: the Gold look, and the plain look too", [await answer(app("PUT", "/api/avatar", a.token, { body: { avatar: gold } })), await answer(app("PUT", "/api/avatar", a.token, { body: { avatar: capped } }))], [200, 200]);
  eq("cards that are not avatar cosmetics are not listed", (give(A, "pack_bronze", 0), (await app("GET", "/api/avatar", a.token)).body.cosmetics), { "hat-flatCap": [3] });

  eq("an accessory (18 fields) and a scene, held", (give(A, "acc-cat", 4), give(A, "bg-library", 0), await answer(app("PUT", "/api/avatar", a.token, { body: { avatar: code({ [BACK]: "library" }, ["cat", "000004"]) } }))), 200);
  eq("the wayfarers are a reward: not held, refused", (await app("PUT", "/api/avatar", a.token, { body: { avatar: code({ [GLASSES]: "wayfarers" }) } })).body, { error: "not_held", items: ["glasses-wayfarers"] });

  // an avatar saved before the rule wears the wayfarers: it may keep them while changing something else
  const B = (await signIn("777002")).account.id, cookieB = await cookieFor(B);
  kv.set(`user:${B}`, JSON.stringify({ username: "", avatar: code({ [GLASSES]: "wayfarers" }) }));
  eq("what the saved avatar wears stays allowed", [await answer(web("PUT", "/api/avatar", cookieB, { body: { avatar: code({ [GLASSES]: "wayfarers", 1: "2" }) } })), await answer(web("PUT", "/api/avatar", cookieB, { body: { avatar: code({ [GLASSES]: "round" }) } }))], [200, "403 not_held"]);
  eq("a bad code is a format error", (await app("PUT", "/api/avatar", a.token, { body: { avatar: code({}, ["cat", "000001", "x"]) } })).body, { error: "format" });
}

/* ───────────── badges on the server ───────────── */
{
  const C = (await signIn("777003")), cid = C.account.id, cookieC = await cookieFor(cid);
  const look = code(), put = (avatar, via = "app") => (via === "app" ? app("PUT", "/api/avatar", C.token, { body: { avatar } }) : web("PUT", "/api/avatar", cookieC, { body: { avatar } }));
  const member = withBadge(look, "m-member"), golden = withBadge(look, "m-golden");
  eq("a membership badge the account did not buy is refused, from both callers", [(await put(member)).body, await answer(put(golden, "site"))], [{ error: "not_held", items: [], badge: "m-member" }, "403 not_held"]);
  const entitle = (key) => d1.raw.prepare("INSERT INTO entitlements (account_id, key, since, source) VALUES (?, ?, ?, 'test')").run(cid, key, NOW);
  entitle("member");
  eq("Member bought: listed, and worn", [(await app("GET", "/api/avatar", C.token)).body.badges, await answer(put(member)), lookBadge((await web("GET", "/api/avatar", cookieC)).body.avatar)],
    [[{ badge: "m-member", kind: "membership", key: "member" }], 200, "m-member"]);
  eq("…the Golden Member's badge needs its own purchase", (await put(golden, "site")).body, { error: "not_held", items: [], badge: "m-golden" });
  const unlock = (achievement, tier, at) => d1.raw.prepare("INSERT INTO achievements (account_id, achievement, tier, at, op) VALUES (?, ?, ?, ?, 'test')").run(cid, achievement, tier, at);
  unlock("contracts", 1, NOW - 2000); unlock("contracts", 5, NOW - 1000); unlock("tutorial", 1, NOW - 3000);
  const listed = (await web("GET", "/api/avatar", cookieC)).body.badges;
  eq("achievement tiers with a badge are listed (material, when), after the memberships; a one-off (items, no badge) is not", listed,
    [{ badge: "m-member", kind: "membership", key: "member" }, { badge: "a-contracts-1", kind: "achievement", achievement: "contracts", tier: 1, material: "paper", at: NOW - 2000 },
      { badge: "a-contracts-5", kind: "achievement", achievement: "contracts", tier: 5, material: "bronze", at: NOW - 1000 }]);
  eq("an unlocked tier is worn; a tier not reached, a one-off, an unknown achievement are refused",
    [await answer(put(withBadge(look, "a-contracts-5"))), (await put(withBadge(look, "a-contracts-6"))).body, await answer(put(withBadge(look, "a-tutorial-1"))), await answer(put(withBadge(look, "a-nothing-1")))],
    [200, { error: "not_held", items: [], badge: "a-contracts-6" }, "403 not_held", "403 not_held"]);
  eq("a badge beside held cosmetics", (give(cid, "acc-cat", 0), await answer(put(withBadge(code({}, ["cat"]), "a-contracts-1"), "site"))), 200);
  eq("a cosmetic not held is named first, the badge is checked too", (await put(withBadge(code({ [HAT]: "flatCap" }), "a-contracts-1"))).body, { error: "not_held", items: ["hat-flatCap"] });
  await answer(put(member));
  d1.raw.prepare("DELETE FROM entitlements WHERE account_id = ?").run(cid); // refunded
  eq("a membership refunded: its badge is no longer listed, and comes off with the next change (unlike a kept cosmetic)", [(await app("GET", "/api/avatar", C.token)).body.badges.map((b) => b.badge), await answer(put(withBadge(code({ 1: "2" }), "m-member"))), await answer(put(code({ 1: "2" })))],
    [["a-contracts-1", "a-contracts-5"], "403 not_held", 200]);
  eq("taking a badge off is always allowed", lookBadge((await app("GET", "/api/avatar", C.token)).body.avatar), null);
}

console.log(`${n} checks, ${bad.length} failed`);
bad.forEach((b) => console.log("  FAIL " + b));
process.exit(bad.length ? 1 : 0);
