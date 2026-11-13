// The app's sign-in backend (functions/api/app/auth/**, functions/_lib/app/accounts.js, identity.js, cors.js and the CORS part
// of functions/api/_middleware.js), tested in plain node:   npm run test:app-auth
// Like scripts/test-wallet.mjs: the endpoint handlers are called directly, against a SQLite database with the real migrations/
// applied and a clock the test moves. What is checked, above all: a token is only ever what the server issued for a device that
// still stands; a cookie never signs the app's origin in; a guest who signs in keeps what they had, once; and no number of
// guest accounts can pay an account twice for what pays once.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openD1 } from "./lib/d1-sqlite.mjs";
import { seal, unseal, readSession, endSessions } from "../functions/_lib/auth.js";
import { sealAppToken, eraseAppAccount, appDoor, APP_TOKEN_SEC } from "../functions/_lib/app/context.js";
import { signIn as signInCore } from "../functions/_lib/app/accounts.js";
import { post, newOp } from "../functions/_lib/app/ledger.js";
import { APP_ORIGIN } from "../functions/_lib/app/cors.js";
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
const kv = new Map(); // a stand-in for the site's KV namespace (deleted accounts, codenames)
const KV = { get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, String(v)); }, delete: async (k) => { kv.delete(k); } };

// Google, for the tests: our own signing key, published the way Google publishes its keys
const CLIENT = "1234-shadoku.apps.googleusercontent.com";
const rsa = () => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const google = await rsa(), stranger = await rsa();
const certs = { keys: [{ ...(await crypto.subtle.exportKey("jwk", google.publicKey)), kid: "k1", use: "sig", alg: "RS256" }] };
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
async function idToken(sub, { key = google.privateKey, kid = "k1", alg = "RS256", ...claims } = {}) {
  const now = Math.floor(NOW / 1000);
  const head = b64({ alg, kid, typ: "JWT" }), body = b64({ iss: "https://accounts.google.com", aud: CLIENT, sub: String(sub), name: `Player ${sub}`, picture: "https://lh3.googleusercontent.com/a/x", iat: now - 5, exp: now + 3600, ...claims });
  return `${head}.${body}.${Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, Buffer.from(`${head}.${body}`))).toString("base64url")}`;
}
// a second provider, for linking: the real ones (Play Games, GitHub) are not built, so the tests bring their own verifier
const OTHER = { IDENTITY_VERIFIER: { verify: async (provider, body) => (typeof body.sub === "string" ? { ok: true, provider: body.as || provider, sub: body.sub, name: "Linked" } : { ok: false, error: "invalid" }) } };

const baseEnv = { SHADOKU_DB: d1, SHADOKU_KV: KV, SESSION_SECRET: "test-secret-".repeat(4), NOW: () => NOW, GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CERTS: async () => certs };
const today = () => eco.dayKey(NOW);

const ROUTES = {
  "POST /auth/guest": "auth/guest.js", "POST /auth/google": "auth/google.js", "POST /auth/dev": "auth/dev.js", "POST /auth/link": "auth/link.js", "POST /auth/refresh": "auth/refresh.js", "POST /auth/logout": "auth/logout.js",
  "POST /devices": "devices.js", "GET /bootstrap": "bootstrap.js", "POST /sync": "sync.js", "GET /wallet": "wallet.js", "POST /shop/buy": "shop/buy.js", "POST /streak/claim": "streak/claim.js",
  "POST /social/open": "social/open.js", "POST /social/claim": "social/claim.js",
};
let IP = 0; // each section calls from its own address, so one section's sign-ins never use up another's rate limit
const section = () => { IP++; };
const handlerOf = async (route) => { const [method] = route.split(" "); return (await import(pathToFileURL(path.join(ROOT, "functions", "api", "app", ROUTES[route])).href))[`onRequest${method[0]}${method.slice(1).toLowerCase()}`]; };
const requestOf = (route, { token, body, headers = {}, host = SITE } = {}) => {
  const [method, pattern] = route.split(" ");
  const h = new Headers({ "CF-Connecting-IP": `10.0.0.${IP}`, ...headers });
  if (token) h.set("Authorization", `Bearer ${token}`);
  return new Request(host + "/api/app" + pattern, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
};
/** Calls an endpoint as the app would, with the bearer `token` (none: no session). → { status, body, headers } */
async function call(route, opt = {}) {
  const res = await (await handlerOf(route))({ request: requestOf(route, opt), env: { ...baseEnv, ...(opt.env || {}) }, params: {} });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}
/** The calls as truly simultaneous requests (scripts/test-wallet.mjs atOnce): all of them reach each write before any is let through. */
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
const account = (id) => one("SELECT kind, merged_into, merge_how, banned, tz_offset, birth_year FROM accounts WHERE id = ?", id);
const uid = () => crypto.randomUUID();
const solveEv = (caseId, extra = {}) => ({ eventId: uid(), type: "solve", caseId, seconds: 300, hints: 0, ...extra });
const sync = (token, events, extra = {}) => call("POST /sync", { token, body: { events, ...extra } });
const results = (r) => r.body.results.map((x) => x.result).join();
const state = async (token) => (await call("GET /wallet", { token })).body.state;
const guest = async (body = {}, opt = {}) => (await call("POST /auth/guest", { body, ...opt })).body;
const signIn = async (sub, opt = {}) => call("POST /auth/google", { ...opt, body: { idToken: await idToken(sub), ...(opt.body || {}) } });
const setConfig = (k, v) => d1.raw.prepare("INSERT INTO app_config (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").run(k, JSON.stringify(v));
const dropConfig = (k) => d1.raw.prepare("DELETE FROM app_config WHERE k = ?").run(k);
/** What a player sees of their file: the part of the state that must survive a sign-in unchanged. */
const file = (s) => ({ coins: s.coins, hints: s.hints, hintsToday: s.hintsToday, inventory: s.inventory, streak: s.streak, quests: s.quests, social: s.social, entitlements: s.entitlements });

// the server's case index and two test goods
const CASES = { tut1: ["tutorial", "Tutorial", 5], tut2: ["tutorial", "Tutorial", 5], e1: ["story", "Easy", 7], e2: ["story", "Easy", 7], e3: ["story", "Easy", 7], m1: ["classic", "Medium", 8], x1: ["story", "Expert", 10] };
for (const [id, [mode, difficulty, size]] of Object.entries(CASES)) d1.raw.prepare("INSERT INTO case_index (case_id, mode, difficulty, size) VALUES (?, ?, ?, ?)").run(id, mode, difficulty, size);
d1.raw.prepare("INSERT INTO items (id, kind, rarity, price_coins, data) VALUES ('hints3', 'hint_bundle', '', 30, '{\"hints\":3}'), ('hints35', 'hint_bundle', '', 35, '{\"hints\":4}')").run();
setConfig("daily_quests", 50); setConfig("weekly_quests", 50); // every quest dealt to everyone: an account's quests do not depend on its id

/** A guest's afternoon: four contracts (75), a hint, the Daily Reward (a Silver Pack), a social visit (25), three hints bought (30). → 70 coins, 3 hints, 1 pack */
async function afternoon(token) {
  const outbox = [solveEv("tut1"), solveEv("tut2"), solveEv("e1"), solveEv("m1"), { eventId: uid(), type: "hint_use", caseId: "e1" }];
  await sync(token, outbox);
  await call("POST /streak/claim", { token, body: { date: today() } });
  await call("POST /social/open", { token, body: { network: "instagram" } });
  await call("POST /social/claim", { token, body: { network: "instagram" } });
  await call("POST /shop/buy", { token, body: { itemId: "hints3", requestId: uid() } });
  return outbox;
}

/* ───────────── a guest account: made by the server, with a device and a token ───────────── */
{
  section();
  const res = await call("POST /auth/guest", { body: { installId: "install-0001", appVersion: "1.1.0 (2)", tz: 60, birthYear: 1990 } }), g = res.body;
  eq("a guest account is made", [res.status, /^guest:[0-9a-f-]{36}$/.test(g.account.id), g.account.kind, g.account.provider, typeof g.token, g.expires > Date.now() + 29 * DAY], [200, true, "guest", "guest", "string", true]);
  eq("…with its row, an empty wallet and a device", [account(g.account.id), wallet(g.account.id), one("SELECT account_id, install_id, app_version, revoked_at FROM devices WHERE id = ?", g.device)],
    [{ kind: "guest", merged_into: null, merge_how: null, banned: 0, tz_offset: 60, birth_year: 1990 }, { coins: 0, hints: 0 }, { account_id: g.account.id, install_id: "install-0001", app_version: "1.1.0 (2)", revoked_at: null }]);
  const payload = await unseal(baseEnv, g.token);
  eq("the token is the app's, names the account and its device, and lasts 30 days", [payload.id, payload.aud, payload.dev, payload.provider, payload.exp - Math.floor(payload.iat / 1000)], [g.account.id, "app", g.device, "guest", APP_TOKEN_SEC]);
  ok("no cookie is set", !res.headers.get("Set-Cookie"));
  const boot = await call("GET /bootstrap", { token: g.token });
  eq("the token opens the account", [boot.status, boot.body.account.id, boot.body.account.kind, boot.body.account.signIns, boot.body.account.device, boot.body.state.coins], [200, g.account.id, "guest", [], g.device, 0]);
  eq("the site's cookie reader refuses it", await readSession(new Request(SITE, { headers: { Cookie: `__Host-sh_session=${g.token}` } }), baseEnv), null);
  const g2 = await guest({ tz: "noon", birthYear: 3000, installId: "x", appVersion: "<script>" });
  eq("every call makes another account; what does not fit is left out", [g2.account.id !== g.account.id, account(g2.account.id).tz_offset, account(g2.account.id).birth_year, one("SELECT install_id, app_version FROM devices WHERE id = ?", g2.device)], [true, 0, null, { install_id: "", app_version: "" }]);
  eq("a body that is not JSON → 400", (await call("POST /auth/guest", { body: "guest=1" })).status, 400);
  eq("a guest id cannot be chosen", /^guest:[0-9a-f-]{36}$/.test((await guest({ id: "guest:mine", account: "google:1", kind: "full", coins: 999 })).account.id), true);
  eq("…and starts with nothing", one("SELECT COUNT(*) AS n FROM ledger").n, 0);
  eq("without the database → 503", (await call("POST /auth/guest", { body: {}, env: { SHADOKU_DB: undefined } })).status, 503);

  section();
  setConfig("guests_per_address_hour", 3);
  const burst = []; for (let i = 0; i < 5; i++) burst.push((await call("POST /auth/guest", { body: {} })).status);
  eq("guest accounts are limited per address", burst, [200, 200, 200, 429, 429]);
  dropConfig("guests_per_address_hour");
  const same = []; for (let i = 0; i < 7; i++) { section(); same.push((await call("POST /auth/guest", { body: { installId: "install-0002" } })).status); }
  eq("…and per install, whatever the address", same, [200, 200, 200, 200, 200, 429, 429]);
}

/* ───────────── tokens and devices: renewal, sign-out, a device that is not the token's ───────────── */
{
  section();
  const g = await guest(), id = g.account.id;
  await sync(g.token, [solveEv("tut1")]);
  const r = await call("POST /auth/refresh", { token: g.token, body: { appVersion: "1.2.0" } });
  eq("a token is renewed for the same account and device", [r.status, r.body.account, r.body.device, (await unseal(baseEnv, r.body.token)).dev, one("SELECT app_version FROM devices WHERE id = ?", g.device).app_version], [200, g.account, g.device, g.device, "1.2.0"]);
  eq("…and opens the same wallet", [(await state(r.body.token)).coins, (await state(g.token)).coins], [25, 25]);
  const old = await sealAppToken(baseEnv, { id, dev: g.device, provider: "guest" }, -40 * DAY / 1000);
  eq("a token that ran out opens nothing", (await call("GET /wallet", { token: old })).status, 401);
  const back = await call("POST /auth/refresh", { token: old });
  eq("…but its guest, back after six weeks, renews it and still has the account", [back.status, back.body.account.id, (await state(back.body.token)).coins], [200, id, 25]);
  eq("a token that ran out more than a year ago is not renewed", (await call("POST /auth/refresh", { token: await sealAppToken(baseEnv, { id, dev: g.device }, -400 * DAY / 1000) })).status, 401);
  eq("nor a tampered one, nor none, nor a site cookie's", [(await call("POST /auth/refresh", { token: `${g.token.slice(0, -3)}AAA` })).status, (await call("POST /auth/refresh")).status, (await call("POST /auth/refresh", { token: await seal(baseEnv, { id }, 3600) })).status], [401, 401, 401]);
  const forged = `${b64({ id: "google:rich", aud: "app", dev: g.device, exp: 9e9 })}.${g.token.split(".")[1]}`;
  eq("another payload under a real signature → 401", [(await call("POST /auth/refresh", { token: forged })).status, (await call("GET /wallet", { token: forged })).status], [401, 401]);

  // the device decides
  const other = await guest();
  eq("a token that names another account's device is refused", [(await call("GET /wallet", { token: await sealAppToken(baseEnv, { id, dev: other.device }) })).body.error, (await call("POST /auth/refresh", { token: await sealAppToken(baseEnv, { id, dev: other.device }) })).body.error], ["revoked", "revoked"]);
  eq("…and one that names no known device", (await call("GET /wallet", { token: await sealAppToken(baseEnv, { id, dev: uid() }) })).body.error, "revoked");
  const seen = () => one("SELECT last_seen FROM devices WHERE id = ?", g.device).last_seen;
  const first = seen();
  NOW += 10 * 60 * 1000; await state(g.token);
  const soon = seen();
  NOW += 2 * HOUR; await state(g.token);
  eq("the device is seen (noted once an hour)", [soon === first, seen()], [true, NOW]);
  eq("the push token is kept on the device", [(await call("POST /devices", { token: g.token, body: { fcmToken: "fcm:Token_1-x", appVersion: "1.3.0" } })).status, one("SELECT fcm_token, app_version FROM devices WHERE id = ?", g.device)], [200, { fcm_token: "fcm:Token_1-x", app_version: "1.3.0" }]);
  eq("…left alone when it is not sent, refused when it is not one", [(await call("POST /devices", { token: g.token, body: { appVersion: "1.3.1" } })).status, one("SELECT fcm_token FROM devices WHERE id = ?", g.device).fcm_token, (await call("POST /devices", { token: g.token, body: { fcmToken: "a b" } })).status, (await call("POST /devices", { token: g.token, body: { fcmToken: 5 } })).status], [200, "fcm:Token_1-x", 400, 400]);
  eq("a session without a device has none to note", (await call("POST /devices", { token: await sealAppToken(baseEnv, { id: other.account.id }), body: { fcmToken: "x" } })).body.error, "no_device");

  const out = await call("POST /auth/logout", { token: g.token });
  eq("signing out revokes the device", [out.status, one("SELECT revoked_at, fcm_token FROM devices WHERE id = ?", g.device)], [200, { revoked_at: NOW, fcm_token: "" }]);
  eq("…and with it every token that names it, renewed ones too", [(await call("GET /wallet", { token: g.token })).body.error, (await call("GET /wallet", { token: r.body.token })).body.error, (await sync(back.body.token, [solveEv("e1")])).body.error, (await call("POST /auth/refresh", { token: g.token })).body.error], ["revoked", "revoked", "revoked", "revoked"]);
  eq("…and nothing moved after it", coins(id), 25);
  eq("another phone's session is not touched", (await call("GET /wallet", { token: other.token })).status, 200);

  d1.raw.prepare("UPDATE accounts SET banned = 1 WHERE id = ?").run(other.account.id);
  eq("a banned account renews nothing", [(await call("POST /auth/refresh", { token: other.token })).status, (await call("GET /wallet", { token: other.token })).status], [403, 403]);

  // an account deleted since the token was made (DELETE /api/account: endSessions, then the erasure)
  const gone = await guest();
  await sync(gone.token, [solveEv("tut1")]);
  await endSessions(baseEnv, gone.account.id);
  eq("a deleted account's token opens nothing and renews nothing", [(await call("GET /wallet", { token: gone.token })).status, (await call("POST /auth/refresh", { token: gone.token })).status], [401, 401]);
  await eraseAppAccount(baseEnv, gone.account.id);
  eq("…and its device is erased with it", [one("SELECT COUNT(*) AS n FROM devices WHERE id = ?", gone.device).n, account(gone.account.id)], [0, undefined]);
}

/* ───────────── the outbox, replayed: the same batch twice leaves the balance unchanged ───────────── */
{
  section();
  const g = await guest(), id = g.account.id;
  const batch = [solveEv("tut1", { reward: 9999, coins: 9999 }), solveEv("e1"), solveEv("m1"), solveEv("x1"), { eventId: uid(), type: "hint_use", caseId: "e1" }, { eventId: uid(), type: "streak_claim", date: today() }];
  const first = await sync(g.token, batch, { coins: 5000 });
  eq("the phone's outbox is priced by the server", [first.status, results(first), first.body.results.slice(0, 4).map((x) => x.reward), first.body.state.coins, coins(id)], [200, "ok,ok,ok,ok,ok,ok", [25, 10, 15, 25], 75, 75]);
  const before = JSON.stringify([rows("SELECT * FROM ledger WHERE account_id = ? ORDER BY seq", id), file(await state(g.token))]);
  const second = await sync(g.token, batch), third = await sync(g.token, batch);
  eq("the same batch a second and a third time: every event is a duplicate", [results(second), results(third)], ["duplicate,duplicate,duplicate,duplicate,duplicate,duplicate", "duplicate,duplicate,duplicate,duplicate,duplicate,duplicate"]);
  eq("…the balance is unchanged", [coins(id), third.body.state.coins, wallet(id).hints], [75, 75, 0]);
  ok("…and so is everything else: the ledger, the pack, the streak, the quests, the day's hints", before === JSON.stringify([rows("SELECT * FROM ledger WHERE account_id = ? ORDER BY seq", id), file(await state(g.token))]));
  const racing = await atOnce([() => sync(g.token, batch), () => sync(g.token, batch), () => sync(g.token, [solveEv("e2")]), () => sync(g.token, [solveEv("e2")])]);
  eq("…also when resends arrive at once", [racing.slice(0, 2).map(results).every((x) => x === "duplicate,duplicate,duplicate,duplicate,duplicate,duplicate"), racing.slice(2).map(results).sort().join(), coins(id)], [true, "duplicate,ok", 85]);
  const renewed = (await call("POST /auth/refresh", { token: g.token })).body.token;
  eq("a renewed token replays nothing either", [results(await sync(renewed, batch)), coins(id)], ["duplicate,duplicate,duplicate,duplicate,duplicate,duplicate", 85]);
}

/* ───────────── Google's ID token: checked before anybody is signed in ───────────── */
{
  section();
  const post = async (token, env = {}) => { const r = await call("POST /auth/google", { body: { idToken: token }, env }); return r.status === 200 ? r.body.account.id : `${r.status} ${r.body.error}`; };
  eq("a token Google signed for our client signs in", await post(await idToken(9001)), "google:9001");
  eq("…the accounts.google.com issuer without https too", await post(await idToken(9001, { iss: "accounts.google.com" })), "google:9001");
  eq("signed by someone else → 401", await post(await idToken(9001, { key: stranger.privateKey })), "401 invalid");
  eq("made for another app → 401", await post(await idToken(9001, { aud: "other.apps.googleusercontent.com" })), "401 invalid");
  eq("from another issuer → 401", await post(await idToken(9001, { iss: "https://accounts.example.com" })), "401 invalid");
  eq("expired → 401", await post(await idToken(9001, { exp: Math.floor(NOW / 1000) - 600 })), "401 invalid");
  eq("issued in the future → 401", await post(await idToken(9001, { iat: Math.floor(NOW / 1000) + 3600 })), "401 invalid");
  eq("a key Google does not publish → 401", await post(await idToken(9001, { kid: "k9" })), "401 invalid");
  eq("an unsigned token (alg none) → 401", await post(`${b64({ alg: "none", kid: "k1" })}.${b64({ iss: "https://accounts.google.com", aud: CLIENT, sub: "9001", exp: 9e9 })}.`), "401 invalid");
  eq("HS256 with the public key as the secret → 401", await post(await idToken(9001, { alg: "HS256" })), "401 invalid");
  const real = await idToken(9001), [h, , s] = real.split(".");
  eq("another person's claims under a real signature → 401", await post(`${h}.${b64({ iss: "https://accounts.google.com", aud: CLIENT, sub: "1", exp: 9e9 })}.${s}`), "401 invalid");
  eq("a sub that is not Google's → 401", [await post(await idToken("9001:admin")), await post(await idToken("guest"))], ["401 invalid", "401 invalid"]);
  eq("garbage, nothing, a number → 401", [await post("abc"), await post(undefined), await post(5), await post("a.b.c.d")], ["401 invalid", "401 invalid", "401 invalid", "401 invalid"]);
  eq("Google's keys cannot be fetched → 502, nobody signed in", await post(real, { GOOGLE_CERTS: async () => { throw new Error("down"); } }), "502 upstream");
  eq("without GOOGLE_CLIENT_ID → 503", await post(real, { GOOGLE_CLIENT_ID: "" }), "503 signin_unavailable");
  eq("a body that is not JSON → 400", (await call("POST /auth/google", { body: "idToken=x" })).status, 400);
  eq("only one account came of all that", rows("SELECT id FROM accounts WHERE id LIKE 'google:%'").map((a) => a.id), ["google:9001"]);

  // the test sign-in: DEV_LOGIN=1 and localhost, or it does not exist
  const dev = (opt) => call("POST /auth/dev", { body: { name: "Agent_7" }, ...opt });
  eq("the test sign-in does not exist without DEV_LOGIN, nor away from localhost", [(await dev()).status, (await dev({ env: { DEV_LOGIN: "1" } })).status, (await dev({ env: { DEV_LOGIN: "1" }, host: "https://app-phase-2.shadoku.pages.dev" })).status], [404, 404, 404]);
  const d = await dev({ env: { DEV_LOGIN: "1" }, host: LOCAL });
  eq("…on localhost it signs in the test player /api/auth/dev/login makes", [d.status, d.body.account, (await call("POST /auth/dev", { body: { name: "x" }, env: { DEV_LOGIN: "1" }, host: LOCAL })).status], [200, { id: "dev:agent_7", kind: "full", provider: "dev" }, 401]);
  eq("a provider that is not built signs nobody in", (await call("POST /auth/link", { token: d.body.token, body: { provider: "pgs", code: "x" } })).status, 503);
}

/* ───────────── a guest who signs in later keeps their coins (and everything else) ───────────── */
{
  section();
  const g = await guest({ tz: 60, birthYear: 1988 }), G = g.account.id, T = "google:1001";
  const outbox = await afternoon(g.token);
  const had = file(await state(g.token));
  eq("the guest's afternoon", [had.coins, had.hints, had.inventory, had.streak.current, had.social.instagram, had.hintsToday.used], [70, 3, { pack_silver: 1 }, 1, "claimed", 1]);

  const s = await signIn(1001, { token: g.token, body: { coins: 99999, merge: { coins: 99999 }, account: "google:rich" } });
  eq("signing in answers a token for the Google account, on the same device", [s.status, s.body.account, s.body.device, (await unseal(baseEnv, s.body.token)).name], [200, { id: T, kind: "full", provider: "google" }, g.device, "Player 1001"]);
  eq("…and says what came along", s.body.merge, { result: "moved", coins: 70, hints: 3 });
  const has = file(await state(s.body.token));
  eq("THE GUEST KEEPS ITS COINS: the account has them, the guest account has none", [coins(T), wallet(T).hints, wallet(G)], [70, 3, { coins: 0, hints: 0 }]);
  eq("…and the pack, the streak, the quests, the social visit and the day's hints: the player's file is the same", has, had);
  eq("a `merge` line on each side, and the social visit under its own key", rows("SELECT account_id, currency, delta, reason, ref, balance_after FROM ledger WHERE (account_id = ? AND reason = 'merge') OR account_id = ? ORDER BY seq", G, T).map((l) => `${l.account_id === G ? "guest" : "account"} ${l.currency} ${l.delta} ${l.reason} → ${l.balance_after}`),
    ["guest coin -70 merge → 0", "guest hint -3 merge → 0", "account coin 25 social → 25", "account coin 45 merge → 70", "account hint 3 merge → 3"]);
  eq("the guest account is closed", [account(G).merged_into, account(G).merge_how, account(T).tz_offset, account(T).birth_year, one("SELECT account_id FROM devices WHERE id = ?", g.device).account_id], [T, "moved", 60, 1988, T]);
  eq("its token says where it went", [(await call("GET /wallet", { token: g.token })).status, (await call("GET /wallet", { token: g.token })).body, (await sync(g.token, [solveEv("e2")])).body.error, (await call("POST /auth/refresh", { token: g.token })).body], [409, { error: "merged", into: T }, "merged", { error: "merged", into: T }]);
  eq("nothing of it is left behind", ["inventory", "solves", "quest_state", "streaks", "social_visits", "hint_uses"].filter((t) => one(`SELECT 1 AS x FROM ${t} WHERE account_id = ?`, G)), []);

  // once: nothing that paid the guest pays the account again
  eq("the guest's outbox, sent again by the signed-in account, is all duplicates", [results(await sync(s.body.token, outbox)), coins(T)], ["duplicate,duplicate,duplicate,duplicate,duplicate", 70]);
  eq("…the same contracts under new event ids too", [results(await sync(s.body.token, ["tut1", "tut2", "e1", "m1"].map((c) => solveEv(c)))), coins(T)], ["duplicate,duplicate,duplicate,duplicate", 70]);
  eq("the Daily Reward and the social visit were collected: not twice", [(await call("POST /streak/claim", { token: s.body.token, body: { date: today() } })).body.result, (await call("POST /social/claim", { token: s.body.token, body: { network: "instagram" } })).body.result, coins(T), has.inventory], ["duplicate", "duplicate", 70, { pack_silver: 1 }]);
  eq("what it had not done yet, it can still do, once", [results(await sync(s.body.token, [solveEv("e2"), solveEv("e2")])), coins(T)], ["ok,duplicate", 80]);

  // the answer was lost and the phone asks again, still holding the guest's token
  const again = await signIn(1001, { token: g.token });
  eq("the same sign-in sent again only signs in", [again.status, again.body.merge, again.body.account.id, again.body.device, coins(T), coins(G)], [200, { result: "already" }, T, g.device, 80, 0]);
  eq("…and both tokens it was given work", [(await state(s.body.token)).coins, (await state(again.body.token)).coins], [80, 80]);
  eq("the account shows how it is signed in to", (await call("GET /bootstrap", { token: s.body.token })).body.account.signIns, ["google"]);

  // the database's own word
  const refuses = (sql, ...binds) => { try { d1.raw.prepare(sql).run(...binds); return false; } catch (e) { return /accounts:|ledger:/.test(e.message); } };
  ok("a merged account cannot merge again", refuses("UPDATE accounts SET merged_into = 'google:other' WHERE id = ?", G));
  ok("…nor be opened again", refuses("UPDATE accounts SET merged_into = NULL WHERE id = ?", G));
  ok("an account that is not a guest never merges", refuses("UPDATE accounts SET merged_into = 'google:other' WHERE id = ?", T));
  ok("an account does not merge into itself", refuses("UPDATE accounts SET merged_into = id WHERE id = ?", (await guest()).account.id));
  const late = await d1.batch(post(d1, { id: newOp(), account: G, delta: 500, reason: "grant", ref: "late", day: today(), at: NOW })).then(() => "written", (e) => (/closed/.test(e.message) ? "refused" : e.message));
  eq("a closed account's ledger takes no more lines", [late, coins(G)], ["refused", 0]);
}

/* ───────────── what a guest spent is spent; two sign-ins at once move the wallet once ───────────── */
{
  section();
  const a = await guest(), b = await guest();
  for (const g of [a, b]) {
    await sync(g.token, [solveEv("e1")]);
    await call("POST /social/open", { token: g.token, body: { network: "tiktok" } });
    await call("POST /social/claim", { token: g.token, body: { network: "tiktok" } });
  }
  await call("POST /shop/buy", { token: a.token, body: { itemId: "hints3", requestId: uid() } });  // 35 - 30: 5 coins left
  await call("POST /shop/buy", { token: b.token, body: { itemId: "hints35", requestId: uid() } }); // 35 - 35: nothing left
  const sa = await signIn(1101, { token: a.token }), sb = await signIn(1102, { token: b.token });
  eq("a guest who spent most of it brings what is left", [sa.body.merge, wallet("google:1101"), rows("SELECT delta, reason FROM ledger WHERE account_id = 'google:1101' AND currency = 'coin' ORDER BY seq").map((l) => `${l.reason} ${l.delta}`)], [{ result: "moved", coins: 5, hints: 3 }, { coins: 5, hints: 3 }, ["social 25", "merge -20"]]);
  eq("a guest who spent all of it brings no coins", [sb.body.merge, wallet("google:1102"), rows("SELECT delta, reason FROM ledger WHERE account_id = 'google:1102' AND currency = 'coin' ORDER BY seq").map((l) => `${l.reason} ${l.delta}`)], [{ result: "moved", coins: 0, hints: 4 }, { coins: 0, hints: 4 }, ["social 25", "merge -25"]]);
  eq("…and the social visit stays collected", [(await call("POST /social/claim", { token: sa.body.token, body: { network: "tiktok" } })).body.result, (await call("POST /social/claim", { token: sb.body.token, body: { network: "tiktok" } })).body.result, coins("google:1101"), coins("google:1102")], ["duplicate", "duplicate", 5, 0]);

  const c = await guest();
  await afternoon(c.token);
  const twice = await atOnce([() => signIn(1103, { token: c.token }), () => signIn(1103, { token: c.token })]);
  eq("the same sign-in twice at once moves the wallet once", [twice.map((r) => r.status), twice.map((r) => r.body.merge.result).sort(), wallet("google:1103"), wallet(c.account.id), (await state(twice[0].body.token)).inventory], [[200, 200], ["already", "moved"], { coins: 70, hints: 3 }, { coins: 0, hints: 0 }, { pack_silver: 1 }]);

  // a sync that was running when the phone signed in
  const e = await guest();
  await sync(e.token, [solveEv("tut1")]);
  // (the sync ends before the sign-in, or is told "merged", or is caught half way: then the database refuses the rest of it whole)
  const both = await atOnce([() => signIn(1104, { token: e.token }).then((r) => r.body.merge.result), () => sync(e.token, [solveEv("e1"), solveEv("e2")]).then((r) => (r.status === 200 ? results(r) : r.body.error), (err) => (/closed/.test(err.message) ? "refused" : err.message))]);
  const after = [coins("google:1104"), coins(e.account.id)];
  ok(`a sync racing the sign-in pays the account or nobody, never the closed guest (${both.join(" / ")}; ${after})`, both[0] === "moved" && after[1] === 0 && [25, 35, 45].includes(after[0]));
  const t1104 = (await signIn(1104, { token: e.token })).body.token;
  eq("…and sent again by the account, every event counts once", [results(await sync(t1104, [solveEv("e1"), solveEv("e2")])).replaceAll("duplicate", "ok"), coins("google:1104")], ["ok,ok", 45]);
}

/* ───────────── an account that already has its own file: the guest cannot pay it twice ───────────── */
{
  section();
  const T = "google:2002";
  const home = await signIn(2002); // signed in on another phone, no guest
  eq("a sign-in with no guest to bring", [home.status, home.body.merge, home.body.account.id, one("SELECT account_id FROM devices WHERE id = ?", home.body.device).account_id], [200, { result: "none" }, T, T]);
  await sync(home.body.token, [solveEv("tut1"), solveEv("e1")]);
  await call("POST /streak/claim", { token: home.body.token, body: { date: today() } });
  eq("the account's own file", [coins(T), (await state(home.body.token)).inventory], [35, { pack_silver: 1 }]);

  const g = await guest(), G = g.account.id;
  await sync(g.token, [solveEv("tut1"), solveEv("e2")]);
  await call("POST /streak/claim", { token: g.token, body: { date: today() } });
  const ask = await signIn(2002, { token: g.token });
  eq("signing a guest with things in to it asks first, and changes nothing", [ask.status, ask.body, account(G).merged_into, (await call("GET /wallet", { token: g.token })).status, coins(T)], [409, { error: "guest_progress", guest: { coins: 35, hints: 0, items: 1 } }, null, 200, 35]);
  const yes = await signIn(2002, { token: g.token, body: { leaveGuest: true } });
  eq("with the player's yes: the contract the account had not closed counts, once, and nothing else comes", [yes.status, yes.body.merge, coins(T), (await state(yes.body.token)).inventory, rows("SELECT case_id FROM solves WHERE account_id = ? ORDER BY case_id", T).map((r) => r.case_id)],
    [200, { result: "solves", solves: 1, coins: 10, left: { coins: 35, hints: 0, items: 1 } }, 45, { pack_silver: 1 }, ["e1", "e2", "tut1"]]);
  eq("the guest account is closed with what it had", [account(G).merged_into, account(G).merge_how, coins(G), (await call("GET /wallet", { token: g.token })).body.error], [T, "solves", 35, "merged"]);
  eq("…its contracts cannot pay the account again", [results(await sync(yes.body.token, [solveEv("tut1"), solveEv("e2")])), coins(T)], ["duplicate,duplicate", 45]);
  eq("the account's other phone still works, and sees the same file", [(await state(home.body.token)).coins, one("SELECT COUNT(*) AS n FROM devices WHERE account_id = ? AND revoked_at IS NULL", T).n], [45, 2]);

  // the farm: a new guest collects what a new account is given, hands it over, again and again
  for (let i = 0; i < 4; i++) {
    const f = await guest();
    await sync(f.token, [solveEv("tut1"), solveEv("tut2"), solveEv("e1"), solveEv("e2")]);
    await call("POST /streak/claim", { token: f.token, body: { date: today() } });
    await call("POST /social/open", { token: f.token, body: { network: "facebook" } });
    await call("POST /social/claim", { token: f.token, body: { network: "facebook" } });
    await signIn(2002, { token: f.token, body: { leaveGuest: true } });
  }
  eq("four more guests, each with the first Daily Reward and a social visit: the account gains one new contract and no pack", [coins(T), (await state(home.body.token)).inventory, (await state(home.body.token)).social.facebook, one("SELECT COUNT(*) AS n FROM accounts WHERE merged_into = ?", T).n], [70, { pack_silver: 1 }, "new", 5]);
  eq("…each contract paid the account once in all", [rows("SELECT case_id, paid FROM solves WHERE account_id = ? ORDER BY case_id", T).map((r) => `${r.case_id}:${r.paid}`), one("SELECT SUM(delta) AS s FROM ledger WHERE account_id = ? AND currency = 'coin'", T).s], [["e1:10", "e2:10", "tut1:25", "tut2:25"], 70]);

  const empty = await guest();
  await sync(empty.token, [solveEv("e3", { seconds: 2 })]); // too fast: counts, pays nothing
  const quiet = await signIn(2002, { token: empty.token });
  eq("a guest with nothing to leave behind signs in without being asked", [quiet.status, quiet.body.merge, coins(T)], [200, { result: "solves", solves: 1, coins: 0, left: { coins: 0, hints: 0, items: 0 } }, 70]);

  // a website account that never opened the app is new to the app: the guest moves in whole
  kv.set("user:google:2003", JSON.stringify({ username: "WebOnly_1" }));
  const w = await guest();
  await afternoon(w.token);
  eq("an account that only ever used the website takes the guest whole", [(await signIn(2003, { token: w.token })).body.merge, wallet("google:2003")], [{ result: "moved", coins: 70, hints: 3 }, { coins: 70, hints: 3 }]);
  // …and an account that only looked at the app (dealt its quests, opened a social card? no: a visit is history)
  const looked = await signIn(2004);
  await call("GET /bootstrap", { token: looked.body.token }); await state(looked.body.token);
  const l = await guest();
  await afternoon(l.token);
  eq("…and so does one that had only looked at the app", [(await signIn(2004, { token: l.token })).body.merge.result, file(await state(looked.body.token)).coins, (await state(looked.body.token)).quests.some((q) => q.progress > 0)], ["moved", 70, true]);
}

/* ───────────── switching accounts, banned accounts, guests that cannot merge ───────────── */
{
  section();
  const a = await signIn(3001);
  await sync(a.body.token, [solveEv("tut1")]);
  const b = await signIn(3002, { token: a.body.token });
  eq("signing in as someone else on the phone switches: nothing moves", [b.status, b.body.merge, b.body.account.id, b.body.device === a.body.device, coins("google:3001"), coins("google:3002"), account("google:3001").merged_into], [200, { result: "none" }, "google:3002", true, 25, 0, null]);
  eq("…and the phone's old token stops", (await call("GET /wallet", { token: a.body.token })).body.error, "revoked");
  eq("…until that account signs in again", (await state((await signIn(3001, { token: b.body.token })).body.token)).coins, 25);

  d1.raw.prepare("UPDATE accounts SET banned = 1 WHERE id = 'google:3002'").run();
  const g = await guest();
  await sync(g.token, [solveEv("tut1")]);
  eq("a banned account cannot be signed in to, and takes no guest", [(await signIn(3002, { token: g.token })).status, account(g.account.id).merged_into, coins(g.account.id)], [403, null, 25]);
  d1.raw.prepare("UPDATE accounts SET banned = 1 WHERE id = ?").run(g.account.id);
  const s = await signIn(3003, { token: g.token });
  eq("a banned guest brings nothing", [s.status, s.body.merge, coins("google:3003"), account(g.account.id).merged_into], [200, { result: "none" }, 0, null]);

  const out = await guest();
  await sync(out.token, [solveEv("tut1")]);
  await call("POST /auth/logout", { token: out.token });
  const late = await signIn(3004, { token: out.token });
  eq("a token whose device signed out names no guest to merge", [late.status, late.body.merge, late.body.device !== out.device, coins("google:3004"), coins(out.account.id)], [200, { result: "none" }, true, 0, 25]);
  const stolen = await guest(), victim = await guest();
  await sync(victim.token, [solveEv("tut1")]);
  const forged = await sealAppToken(baseEnv, { id: victim.account.id, dev: stolen.device }); // (only the server can seal one; the device must still agree)
  eq("…nor does a token whose device belongs to another account", [(await signIn(3005, { token: forged })).body.merge, coins(victim.account.id), account(victim.account.id).merged_into], [{ result: "none" }, 25, null]);
  const old = await sealAppToken(baseEnv, { id: victim.account.id, dev: victim.device }, -40 * DAY / 1000);
  eq("a guest back after six weeks who signs in at once still keeps their coins", [(await signIn(3006, { token: old })).body.merge, coins("google:3006")], [{ result: "moved", coins: 25, hints: 0 }, 25]);
}

/* ───────────── linked sign-ins ───────────── */
{
  section();
  const link = (token, provider, sub, extra = {}) => call("POST /auth/link", { token, body: { provider, sub, ...extra }, env: OTHER });
  const a = await signIn(4001), A = "google:4001";
  await sync(a.body.token, [solveEv("tut1")]);
  const l = await link(a.body.token, "github", "77");
  eq("a second sign-in is linked to the account", [l.status, l.body, one("SELECT account_id FROM identities WHERE provider = 'github' AND sub = '77'").account_id], [200, { ok: true, signIns: ["google", "github"] }, A]);
  const g = await guest();
  await sync(g.token, [solveEv("e1")]);
  // signing in with the second provider (it has no endpoint yet: the sign-in itself is called, as its endpoint will call it)
  const signInWith = async (who, token, body = {}) => { const request = requestOf("POST /auth/google", { token, body }); const door = await appDoor(request, baseEnv); return signInCore(door, request, { name: "", avatar: "", ...who }, body); };
  const linked = await signInWith({ provider: "github", sub: "77" }, g.token, { leaveGuest: true });
  eq("that sign-in now opens the account it was linked to (and a guest's new contract counts there)", [linked.status, linked.body.account, linked.body.merge.result, coins(A), rows("SELECT id FROM accounts WHERE id = 'github:77'").length], [200, { id: A, kind: "full", provider: "github" }, "solves", 35, 0]);
  eq("…and the account lists both", (await call("GET /bootstrap", { token: linked.body.token })).body.account.signIns, ["google", "github"]);
  eq("linking it again changes nothing", [(await link(a.body.token, "github", "77")).body, one("SELECT COUNT(*) AS n FROM identities").n], [{ ok: true, duplicate: true, signIns: ["google", "github"] }, 1]);
  eq("one sign-in per provider", [(await link(a.body.token, "github", "78")).body.error, (await link(a.body.token, "google", "4999")).body.error], ["provider_linked", "provider_linked"]);
  eq("an account's own sign-in is already its own", (await link(a.body.token, "google", "4001")).body.duplicate, true);
  const b = await signIn(4002);
  eq("a sign-in linked to one account cannot be linked to another", [(await link(b.body.token, "github", "77")).status, (await link(b.body.token, "github", "77")).body.error], [409, "linked_elsewhere"]);
  await signInWith({ provider: "github", sub: "90" }); // github:90 has its own account in the app
  kv.set("user:github:91", JSON.stringify({ username: "WebAgent_91" })); // github:91 has one on the website (a codename)
  d1.raw.prepare("INSERT INTO players (id, codename, updated) VALUES ('github:92', 'Ranked_92', 0)").run(); // github:92 is in the ranking
  eq("a sign-in that has its own account is not linked: accounts are never merged here", [(await link(b.body.token, "github", "90")).body.error, (await link(b.body.token, "github", "91")).body.error, (await link(b.body.token, "github", "92")).body.error, one("SELECT COUNT(*) AS n FROM identities WHERE account_id = 'google:4002'").n], ["has_account", "has_account", "has_account", 0]);
  eq("a guest does not link: it signs in", (await link((await guest()).token, "github", "93")).body.error, "guest");
  eq("a proof that is not one links nothing", [(await link(b.body.token, "github", 5)).status, (await link(b.body.token, "github", "a:b")).status, (await link(b.body.token, "github", "94", { as: "google" })).status, (await link(b.body.token, "guest", "95")).status, (await call("POST /auth/link", { token: b.body.token, body: { sub: "96" }, env: OTHER })).status, (await call("POST /auth/link", { body: { provider: "github", sub: "97" }, env: OTHER })).status], [401, 401, 401, 401, 400, 403]);
  eq("…and a real Google token links Google", [(await call("POST /auth/link", { token: (await signInWith({ provider: "github", sub: "98" })).body.token, body: { provider: "google", idToken: await idToken(4098) } })).body, (await signIn(4098)).body.account.id], [{ ok: true, signIns: ["github", "google"] }, "github:98"]);
  const two = await atOnce([() => link(b.body.token, "github", "99"), () => link(b.body.token, "github", "100")]);
  eq("two links at once: one sign-in per provider still", [two.map((r) => r.status).sort(), one("SELECT COUNT(*) AS n FROM identities WHERE account_id = 'google:4002'").n], [[200, 409], 1]);
}

/* ───────────── CORS: the app's origin and only it; a cookie never signs it in ───────────── */
{
  section();
  const { onRequest } = await import(pathToFileURL(path.join(ROOT, "functions", "api", "_middleware.js")).href);
  const cookie = await seal(baseEnv, { id: "google:5001", provider: "google" }, 3600); // a site session
  const jar = { Cookie: `__Host-sh_session=${cookie}` };
  /** A request through the middleware into `next` (default: an endpoint that echoes what reached it). */
  const through = async (request, env = baseEnv, next) => {
    let reached = null;
    const res = await onRequest({ request, env, next: next || (async (req) => { reached = req || request; return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }); }) });
    return { res, reached };
  };
  const cors = (res) => [res.headers.get("Access-Control-Allow-Origin"), res.headers.get("Access-Control-Allow-Credentials")];

  const pre = await through(new Request(`${SITE}/api/app/sync`, { method: "OPTIONS", headers: { Origin: APP_ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } }));
  eq("the app's preflight is answered", [pre.res.status, cors(pre.res), pre.res.headers.get("Access-Control-Allow-Headers"), pre.res.headers.get("Access-Control-Allow-Methods").includes("POST"), pre.res.headers.get("Vary"), pre.reached], [204, [APP_ORIGIN, null], "authorization, content-type", true, "Origin", null]);
  const evilPre = await through(new Request(`${SITE}/api/app/sync`, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } }));
  eq("another origin's preflight gets no permission", [cors(evilPre.res), !!evilPre.reached], [[null, null], true]);

  const got = await through(new Request(`${SITE}/api/app/wallet`, { headers: { Origin: APP_ORIGIN, Authorization: "Bearer abc", ...jar } }));
  eq("the app's origin may read the answer, without credentials", [got.res.status, cors(got.res), got.res.headers.get("Vary"), await got.res.json()], [200, [APP_ORIGIN, null], "Origin", { ok: true }]);
  eq("…its bearer token reaches the endpoint, a cookie does not", [got.reached.headers.get("Authorization"), got.reached.headers.get("Cookie")], ["Bearer abc", null]);
  const sent = await through(new Request(`${SITE}/api/app/sync`, { method: "POST", headers: { Origin: APP_ORIGIN, "Content-Type": "application/json", ...jar }, body: '{"events":[]}' }));
  eq("…and a body passes whole", [await sent.reached.text(), sent.reached.method], ['{"events":[]}', "POST"]);

  for (const [what, headers] of [["the site itself (no Origin)", jar], ["the site's own origin", { Origin: SITE, ...jar }], ["another origin", { Origin: "https://evil.example", ...jar }], ["a look-alike origin", { Origin: "https://app.shadoku.net.evil.example", ...jar }], ["the app's host over http", { Origin: "http://app.shadoku.net", ...jar }], ["the null origin", { Origin: "null", ...jar }]]) {
    const request = new Request(`${SITE}/api/progress`, { headers });
    const plain = new Response("x");
    const r = await through(request, baseEnv, async (req) => { ok(`${what}: the request is passed on untouched`, req === undefined); return plain; });
    ok(`${what}: the answer is the endpoint's own, with no CORS header`, r.res === plain && cors(r.res).every((v) => v === null));
  }
  eq("a dev origin counts on localhost only, and only when named", [
    cors((await through(new Request(`${LOCAL}/api/app/wallet`, { headers: { Origin: "http://localhost:5183" } }), { ...baseEnv, APP_DEV_ORIGINS: "http://localhost:5183, http://localhost:5184/" })).res)[0],
    cors((await through(new Request(`${LOCAL}/api/app/wallet`, { headers: { Origin: "http://localhost:5184" } }), { ...baseEnv, APP_DEV_ORIGINS: "http://localhost:5183, http://localhost:5184/" })).res)[0],
    cors((await through(new Request(`${LOCAL}/api/app/wallet`, { headers: { Origin: "http://localhost:5183" } }))).res)[0],
    cors((await through(new Request(`${SITE}/api/app/wallet`, { headers: { Origin: "http://localhost:5183" } }), { ...baseEnv, APP_DEV_ORIGINS: "http://localhost:5183" })).res)[0],
    cors((await through(new Request(`${LOCAL}/api/app/wallet`, { headers: { Origin: "https://evil.example" } }), { ...baseEnv, APP_DEV_ORIGINS: "http://localhost:5183" })).res)[0],
  ], ["http://localhost:5183", "http://localhost:5184", null, null, null]);
  const crash = await through(new Request(`${SITE}/api/app/wallet`, { headers: { Origin: APP_ORIGIN } }), baseEnv, async () => { throw new Error("boom"); });
  const crashSite = await through(new Request(`${SITE}/api/app/wallet`), baseEnv, async () => { throw new Error("boom"); });
  eq("an endpoint that throws still answers JSON the app can read", [crash.res.status, cors(crash.res)[0], await crash.res.json(), crashSite.res.status, cors(crashSite.res)[0]], [500, APP_ORIGIN, { error: "server" }, 500, null]);

  // through the middleware into the real endpoints
  const real = async (route, opt) => { const handler = await handlerOf(route); const { res } = await through(requestOf(route, opt), baseEnv, (req) => handler({ request: req || requestOf(route, opt), env: baseEnv, params: {} })); return { status: res.status, body: await res.json().catch(() => null), acao: res.headers.get("Access-Control-Allow-Origin") }; };
  const g = await guest();
  eq("from the app's origin: a bearer token works", [(await real("GET /wallet", { token: g.token, headers: { Origin: APP_ORIGIN } })).status, (await real("POST /sync", { token: g.token, headers: { Origin: APP_ORIGIN }, body: { events: [solveEv("tut1")] } })).body.state.coins], [200, 25]);
  eq("from the app's origin: a site cookie does not, to read or to write", [(await real("GET /wallet", { headers: { Origin: APP_ORIGIN, ...jar } })).status, (await real("POST /sync", { headers: { Origin: APP_ORIGIN, ...jar }, body: { events: [] } })).status, (await real("GET /wallet", { headers: { Origin: APP_ORIGIN, ...jar } })).acao], [403, 403, APP_ORIGIN]);
  eq("…and the guest a cookie-bearing call makes there is nobody's account", (await real("POST /auth/guest", { headers: { Origin: APP_ORIGIN, ...jar }, body: {} })).body.account.kind, "guest");

  // cookie requests from other origins stay refused; the site's own cookie calls stay as they were
  eq("a cookie request from another origin is refused: write and read", [(await call("POST /sync", { headers: { Origin: "https://evil.example", ...jar }, body: { events: [] } })).status, (await call("POST /sync", { headers: { Origin: APP_ORIGIN, ...jar }, body: { events: [] } })).status, (await call("POST /sync", { headers: jar, body: { events: [] } })).status, (await call("GET /wallet", { headers: { Origin: "https://evil.example", ...jar } })).status, (await call("GET /wallet", { headers: { Origin: APP_ORIGIN, ...jar } })).status, (await call("POST /auth/logout", { headers: { Origin: "https://evil.example", ...jar } })).status], [403, 403, 403, 403, 403, 403]);
  eq("the site's own cookie calls work as before", [(await call("GET /wallet", { headers: jar })).status, (await call("GET /wallet", { headers: { Origin: SITE, ...jar } })).status, (await call("POST /sync", { headers: { Origin: SITE, ...jar }, body: { events: [] } })).status], [200, 200, 200]);
  eq("a cookie signs nobody in to anything: the sign-in endpoints never read it", [(await call("POST /auth/refresh", { headers: { Origin: SITE, ...jar } })).status, (await call("POST /auth/google", { headers: { Origin: SITE, ...jar }, body: {} })).status], [401, 401]);
}

/* ───────────── the website's own sign-in is as it was ───────────── */
{
  section();
  const session = await seal(baseEnv, { id: "google:6001", provider: "google", name: "Web Player", email: "", avatar: "" }, 30 * 86400);
  const site = (file) => import(pathToFileURL(path.join(ROOT, "functions", "api", "auth", file)).href);
  const who = await (await site("session.js")).onRequestGet({ request: new Request(`${SITE}/api/auth/session`, { headers: { Cookie: `__Host-sh_session=${session}` } }), env: baseEnv });
  eq("the session endpoint knows the cookie's player", (await who.json()).user.id, "google:6001");
  const appToken = (await guest()).token;
  const not = await (await site("session.js")).onRequestGet({ request: new Request(`${SITE}/api/auth/session`, { headers: { Cookie: `__Host-sh_session=${appToken}` } }), env: baseEnv });
  eq("…and an app token in the cookie is nobody", (await not.json()).user, null);
  eq("an expired site session is over: the year of grace is the app's renewal only", [await unseal(baseEnv, await seal(baseEnv, { id: "google:6001" }, -60)), (await unseal(baseEnv, await seal(baseEnv, { id: "google:6001" }, -60), 3600)).id], [null, "google:6001"]);
  const logout = (await site("logout.js")).onRequestPost;
  eq("signing out of the site is same-origin only, as before", [(await logout({ request: new Request(`${SITE}/api/auth/logout`, { method: "POST", headers: { Origin: SITE } }), env: baseEnv })).status, (await logout({ request: new Request(`${SITE}/api/auth/logout`, { method: "POST", headers: { Origin: APP_ORIGIN } }), env: baseEnv })).status], [200, 403]);
  eq("a site sign-in is still the account <provider>:<sub>: the callback does not read `identities`", /identities|accounts\.js/.test(fs.readFileSync(path.join(ROOT, "functions", "api", "auth", "[provider]", "callback.js"), "utf8")), false);
}

/* ───────────── the books, after all of it ───────────── */
{
  const run = new Map();
  let chain = true;
  for (const l of rows("SELECT account_id, currency, delta, balance_after FROM ledger ORDER BY seq")) {
    const k = `${l.account_id}|${l.currency}`, next = (run.get(k) || 0) + l.delta;
    if (next !== l.balance_after) chain = false;
    run.set(k, next);
  }
  ok("every ledger line continues the one before", chain);
  ok("every wallet is the sum of its ledger", rows("SELECT account_id, coins, hints FROM wallets").every((w) => w.coins === (run.get(`${w.account_id}|coin`) || 0) && w.hints === (run.get(`${w.account_id}|hint`) || 0)));
  ok("no balance below zero", !one("SELECT 1 AS x FROM wallets WHERE coins < 0 OR hints < 0"));
  ok("every closed account is a guest, closed once, in one of the two ways", rows("SELECT kind, merge_how, merge_op, merged_at FROM accounts WHERE merged_into IS NOT NULL").every((a) => a.kind === "guest" && ["moved", "solves"].includes(a.merge_how) && a.merge_op && a.merged_at) && !one("SELECT 1 AS x FROM accounts WHERE merge_op IS NOT NULL GROUP BY merge_op HAVING COUNT(*) > 1"));
  ok("a guest that moved has an empty wallet and nothing else", rows("SELECT id FROM accounts WHERE merge_how = 'moved'").every((a) => wallet(a.id).coins === 0 && wallet(a.id).hints === 0 && ["inventory", "solves", "quest_state", "streaks", "hint_uses", "social_visits", "ad_tickets"].every((t) => !one(`SELECT 1 AS x FROM ${t} WHERE account_id = ?`, a.id))));
  ok("what moved out of the guests is what moved in to the accounts", rows("SELECT a.id, a.merged_into FROM accounts a WHERE a.merge_how = 'moved'").every((a) => ["coin", "hint"].every((c) => {
    const left = one("SELECT COALESCE(SUM(delta), 0) AS s FROM ledger WHERE account_id = ? AND currency = ? AND reason = 'merge'", a.id, c).s;
    const came = one("SELECT COALESCE(SUM(delta), 0) AS s FROM ledger WHERE account_id = ? AND currency = ? AND json_extract(meta, '$.from') = ?", a.merged_into, c, a.id).s;
    return left + came === 0;
  })));
  // an open account's contracts were paid by its own solve lines, by those of the guests that moved in whole, and by the
  // credit for the new contracts of the guests that did not: together exactly the price of each contract it holds, once
  const sum = (sql, ...binds) => one(`SELECT COALESCE(SUM(${sql}`, ...binds).s;
  ok("a contract never paid one account twice, whoever closed it first", !one("SELECT 1 AS x FROM solves GROUP BY account_id, case_id HAVING COUNT(*) > 1") && rows("SELECT id FROM accounts WHERE merged_into IS NULL").every((a) =>
    sum("delta), 0) AS s FROM ledger WHERE account_id = ? AND currency = 'coin' AND reason = 'solve'", a.id)
    + sum("l.delta), 0) AS s FROM ledger l JOIN accounts g ON g.id = l.account_id WHERE g.merged_into = ? AND g.merge_how = 'moved' AND l.currency = 'coin' AND l.reason = 'solve'", a.id)
    + sum("delta), 0) AS s FROM ledger WHERE account_id = ? AND currency = 'coin' AND reason = 'merge' AND json_extract(meta, '$.how') = 'solves'", a.id)
    === sum("paid), 0) AS s FROM solves WHERE account_id = ?", a.id)));
  ok("a social visit never paid one account twice", !one("SELECT 1 AS x FROM ledger WHERE reason = 'social' GROUP BY account_id, ref HAVING COUNT(*) > 1"));
  ok("every device belongs to an account that exists", !one("SELECT 1 AS x FROM devices d WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = d.account_id)"));
  ok("no live device belongs to a closed account that moved", !one("SELECT 1 AS x FROM devices d JOIN accounts a ON a.id = d.account_id WHERE a.merge_how = 'moved' AND d.revoked_at IS NULL AND d.last_seen > a.merged_at"));
}

/* ───────────── deleting the account: its phones, its linked sign-ins, the guests it grew from ───────────── */
{
  const A = "google:4001", grew = rows("SELECT id FROM accounts WHERE merged_into = ?", A).map((a) => a.id);
  ok("(the account has a linked sign-in, a phone and a guest behind it)", grew.length > 0 && !!one("SELECT 1 AS x FROM identities WHERE account_id = ?", A) && !!one("SELECT 1 AS x FROM devices WHERE account_id = ?", A));
  await eraseAppAccount(baseEnv, A);
  eq("everything of it is erased", [["wallets", "ledger", "solves", "devices", "identities"].filter((t) => one(`SELECT 1 AS x FROM ${t} WHERE account_id = ?`, A)), account(A), grew.filter((id) => account(id) || one("SELECT 1 AS x FROM ledger WHERE account_id = ?", id) || one("SELECT 1 AS x FROM wallets WHERE account_id = ?", id))], [[], undefined, []]);
  const request = requestOf("POST /auth/google", { body: {} });
  eq("the sign-in that was linked to it is its own account again", (await signInCore(await appDoor(request, baseEnv), request, { provider: "github", sub: "77", name: "", avatar: "" }, {})).body.account.id, "github:77");
}

/* ───────────── a database without this migration: the app's API waits, the site's erasure still works ───────────── */
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadoku-migrations-"));
  for (const f of ["0001_app_wallet.sql", "0002_app_seed.sql"]) fs.copyFileSync(path.join(ROOT, "migrations", f), path.join(dir, f));
  const before = openD1(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  const fresh = await import(`${pathToFileURL(path.join(ROOT, "functions", "_lib", "app", "context.js")).href}?before-0003`); // a new isolate: nothing remembered
  const env = { ...baseEnv, SHADOKU_DB: before };
  const door = await fresh.appDoor(new Request(`${SITE}/api/app/auth/guest`, { method: "POST" }), env);
  const ctx = await fresh.appContext(new Request(`${SITE}/api/app/wallet`, { headers: { Authorization: `Bearer ${await sealAppToken(baseEnv, { id: "google:7001" })}` } }), env);
  eq("until 0003 is applied the app's API answers 503 schema", [door.error && door.error.status, ctx.error && ctx.error.status, (await ctx.error.json()).error], [503, 503, "schema"]);
  before.raw.exec("INSERT INTO accounts (id, kind, created) VALUES ('google:7001', 'full', 0); INSERT INTO wallets (account_id) VALUES ('google:7001')");
  await fresh.eraseAppAccount(env, "google:7001");
  eq("…and deleting an account on the site still erases its wallet", [before.raw.prepare("SELECT COUNT(*) AS n FROM wallets").get().n, before.raw.prepare("SELECT COUNT(*) AS n FROM accounts").get().n], [0, 0]);
}

console.log(`${n} checks, ${bad.length} failed`);
bad.forEach((b) => console.log("  FAIL " + b));
process.exit(bad.length ? 1 : 0);
