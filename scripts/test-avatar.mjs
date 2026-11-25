// The shared avatar (functions/api/avatar.js, format v2 of src/avatarCosmetics.js), tested in plain node:   npm run test:avatar
// Like scripts/test-app-shared.mjs: every call goes through functions/api/_middleware.js into the real handler, against a SQLite
// database with the real migrations/ applied. Checked: the v2 code's validation (avatarOk); GET /api/avatar for both callers
// (the site's cookie, the app's token; a guest refused); PUT refuses cosmetics the account does not hold, tier included, and
// keeps what the saved avatar already wears; `updated` follows the saves.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openD1 } from "./lib/d1-sqlite.mjs";
import { seal } from "../functions/_lib/auth.js";
import { avatarOk } from "../functions/_lib/db.js";
import { APP_ORIGIN } from "../functions/_lib/app/cors.js";
import { onRequest as middleware } from "../functions/api/_middleware.js";
import { COSMETICS, notHeld, parseCode, wornCosmetics } from "../src/avatarCosmetics.js";

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
  eq("too many fields, an empty field, a prototype name, too long", [avatarOk(code({}, ["cat", "000001", "x"])), avatarOk(code({ 2: "" })), avatarOk(code({ 2: "constructor" })), avatarOk(`L:${"a".repeat(201)}`)], [false, false, false, false]);
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

/* ───────────── GET and PUT /api/avatar ───────────── */
const signIn = async (sub) => (await app("POST", "/api/app/auth/google", undefined, { body: { sub } })).body;
const a = await signIn("777001"), A = a.account.id;
const g = (await app("POST", "/api/app/auth/guest", undefined, { body: {} })).body;
const cookie = await cookieFor(A);
{
  eq("a new account: no avatar, never saved, nothing held", (await app("GET", "/api/avatar", a.token)).body, { avatar: "", updated: 0, cosmetics: {} });
  eq("a guest must sign in; the site needs its cookie", [await answer(app("GET", "/api/avatar", g.token)), await answer(web("GET", "/api/avatar")), await answer(web("GET", "/api/avatar", cookie))], ["403 signin_required", "401 auth", 200]);
  const plain = code();
  NOW += 1000;
  eq("the kit's options are free", (await app("PUT", "/api/avatar", a.token, { body: { avatar: plain } })).body, { ok: true, shown: plain, updated: NOW });
  eq("GET reads it back with when", (await web("GET", "/api/avatar", cookie)).body, { avatar: plain, updated: NOW, cosmetics: {} });

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

console.log(`${n} checks, ${bad.length} failed`);
bad.forEach((b) => console.log("  FAIL " + b));
process.exit(bad.length ? 1 : 0);
