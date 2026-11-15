// The endpoints the website and the Android app share (functions/_lib/caller.js: /api/progress, /api/community/*, /api/username,
// /api/avatar, /api/report, DELETE /api/account) and deleting an account from the app (functions/_lib/app/context.js
// eraseAppAccount, migrations/0004_app_erasure.sql), tested in plain node:   npm run test:app-shared
// Like scripts/test-app-auth.mjs: every call goes through functions/api/_middleware.js into the real handler, against a SQLite
// database with the real migrations/ applied. What is checked, above all: the site's cookie works on these endpoints exactly as
// it did; the app's token works from the app's origin and from nowhere else, and only while its device stands; a cookie never
// works from the app's origin; and a deleted account leaves nothing that names it, on either side.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openD1 } from "./lib/d1-sqlite.mjs";
import { seal, sha256b64u } from "../functions/_lib/auth.js";
import { sealAppToken, banKey, appDoor } from "../functions/_lib/app/context.js";
import { signIn as signInCore } from "../functions/_lib/app/accounts.js";
import { APP_ORIGIN } from "../functions/_lib/app/cors.js";
import { onRequest as middleware } from "../functions/api/_middleware.js";
import * as eco from "../functions/_lib/app/economy.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const SITE = "https://www.shadoku.net", LOCAL = "http://localhost:8788", EVIL = "https://evil.example";
const ORIGINS = { app: APP_ORIGIN, site: SITE, evil: EVIL, alike: "https://app.shadoku.net.evil.example" };

let n = 0; const bad = [];
const ok = (what, cond) => { n++; if (!cond) bad.push(what); };
const eq = (what, got, want) => ok(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`, JSON.stringify(got) === JSON.stringify(want));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
{ // functions/api/report.js logs every report it takes: not this run's news
  const { warn } = console;
  console.warn = (...args) => { if (!/"at":"client-error"/.test(String(args[0]))) warn(...args); };
}
/** Runs `fn` without the middleware's log lines (for the calls that are meant to answer 5xx). */
const quiet = async (fn) => { const { warn, error } = console; console.warn = console.error = () => {}; try { return await fn(); } finally { console.warn = warn; console.error = error; } };

/* ───────────── harness ───────────── */
const NOW = Date.UTC(2026, 10, 16, 12); // Monday 2026-11-16, 12:00 UTC
const kvOf = (map) => ({ get: async (k, type) => (map.has(k) ? (type === "json" ? JSON.parse(map.get(k)) : map.get(k)) : null), put: async (k, v) => { map.set(k, String(v)); }, delete: async (k) => { map.delete(k); } });
// the site's own tables are made on first use, once per isolate (functions/_lib/db.js): a test with two databases makes them itself
let fresh = 0;
const siteTables = async (d) => { await (await import(`${pathToFileURL(path.join(ROOT, "functions", "_lib", "db.js")).href}?tables-${fresh++}`)).db({ SHADOKU_DB: d }); };
// the sign-in providers, for the tests: whoever the body names (identity.js IDENTITY_VERIFIER)
const VERIFIER = { verify: async (provider, body) => (typeof body.sub === "string" ? { ok: true, provider, sub: body.sub, name: `Player ${body.sub}`, avatar: `https://lh3.googleusercontent.com/a/${body.sub}` } : { ok: false, error: "invalid" }) };

const d1 = openD1(path.join(ROOT, "migrations"));
await siteTables(d1);
const kv = new Map();
const baseEnv = { SHADOKU_DB: d1, SHADOKU_KV: kvOf(kv), SESSION_SECRET: "test-secret-".repeat(4), NOW: () => NOW, IDENTITY_VERIFIER: VERIFIER };

const FILES = [
  [/^\/api\/(progress|username|avatar|report|account|ranking)$/, (m) => `${m[1]}.js`],
  [/^\/api\/auth\/session$/, () => "auth/session.js"],
  [/^\/api\/community$/, () => "community/index.js"],
  [/^\/api\/community\/([^/]+)$/, () => "community/[id].js"],
  [/^\/api\/community\/([^/]+)\/(rate|play)$/, (m) => `community/[id]/${m[2]}.js`],
  [/^\/api\/app\/(.+)$/, (m) => `app/${m[1]}.js`],
];
let IP = 0; // each section calls from its own address, so one section never uses up another's rate limit
const section = () => { IP++; };

/**
 * One request, through the middleware into the endpoint. `from`: the Origin header ("app", "site", "evil", "alike", a URL, or
 * none). `token`: a bearer token. `cookie`: a session cookie's value. `direct`: skip the middleware (the endpoint on its own).
 * → { status, body, acao, credentials, setCookie }
 */
async function hit(method, where, { from = null, token, cookie, body, env = baseEnv, host = SITE, direct = false } = {}) {
  const url = new URL(host + where);
  const found = FILES.map(([re, to]) => [re.exec(url.pathname), to]).find(([m]) => m);
  const handler = (await import(pathToFileURL(path.join(ROOT, "functions", "api", found[1](found[0]))).href))[`onRequest${method[0]}${method.slice(1).toLowerCase()}`];
  const params = /community\//.test(url.pathname) ? { id: found[0][1] } : {};
  const h = new Headers({ "CF-Connecting-IP": `10.1.0.${IP}` });
  if (from) h.set("Origin", ORIGINS[from] || from);
  if (token) h.set("Authorization", `Bearer ${token}`);
  if (cookie) h.set("Cookie", `${host.startsWith("https") ? "__Host-" : ""}sh_session=${cookie}`);
  const request = new Request(url, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const run = (req) => handler({ request: req, env, params });
  const res = direct ? await run(request) : await middleware({ request, env, next: (req) => run(req || request) });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch { /* 204, or not JSON */ }
  return { status: res.status, body: parsed, acao: res.headers.get("Access-Control-Allow-Origin"), credentials: res.headers.get("Access-Control-Allow-Credentials"), setCookie: res.headers.get("Set-Cookie") };
}
const app = (method, where, token, opt = {}) => hit(method, where, { from: "app", token, ...opt }); // as the Android app calls
const web = (method, where, cookie, opt = {}) => hit(method, where, { from: "site", cookie, ...opt }); // as a page of the site calls
const status = async (call) => (await call).status;
const answer = async (call) => { const r = await call; return r.status === 200 ? 200 : `${r.status} ${r.body && r.body.error}`; };

const rows = (sql, ...binds) => d1.raw.prepare(sql).all(...binds);
const one = (sql, ...binds) => rows(sql, ...binds)[0];
const coins = (id) => (one("SELECT coins FROM wallets WHERE account_id = ?", id) || { coins: null }).coins;
const uid = () => crypto.randomUUID();
const today = () => eco.dayKey(NOW);
const solveEv = (caseId) => ({ eventId: uid(), type: "solve", caseId, seconds: 300, hints: 0 });
/** Every table of the database (but the rate limiter's counters, which are swept within the hour) as text: does anything name `needle`? */
const named = (db, needle) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'rate_limits'").all()
  .filter((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t.name}`).all()).includes(needle)).map((t) => t.name);

/** A site session cookie for the account `id`, as functions/api/auth/[provider]/callback.js seals it. */
const cookieFor = (id, extra = {}) => seal(baseEnv, { id, provider: id.split(":")[0], name: "Web Player", email: "", avatar: "https://lh3.googleusercontent.com/a/web", ...extra }, 30 * 86400);
/** A phone signs in with Google as `sub` → { token, account, device, merge }. `token`: the phone's current token (a guest's is merged). */
const phone = async (sub, opt = {}) => (await app("POST", "/api/app/auth/google", opt.token, { body: { sub, ...(opt.body || {}) } })).body;
const guest = async () => (await app("POST", "/api/app/auth/guest", undefined, { body: {} })).body;
const sync = (token, events) => app("POST", "/api/app/sync", token, { body: { events } });
const DEV = { env: { ...baseEnv, DEV_BILLING: "1" }, host: LOCAL }; // test purchases: DEV_BILLING works on localhost only
const buy = (token, sku, purchaseToken) => app("POST", "/api/app/billing/verify", token, { ...DEV, body: { sku, purchaseToken } });
const refund = (purchaseToken) => hit("POST", "/api/app/billing/rtdn", { ...DEV, body: { voided: [{ purchaseToken }] } });

for (const [id, mode, difficulty, size] of [["tut1", "tutorial", "Tutorial", 5], ["e1", "story", "Easy", 7], ["e2", "story", "Easy", 7], ["m1", "classic", "Medium", 8]]) d1.raw.prepare("INSERT INTO case_index (case_id, mode, difficulty, size) VALUES (?, ?, ?, ?)").run(id, mode, difficulty, size);

// a community puzzle the server accepts: a shipped case, its clues reduced to "was in <room>" (as scripts/test-hardening.mjs does)
const caseDir = fs.existsSync(path.join(ROOT, "engine", "puzzles")) ? path.join(ROOT, "engine", "puzzles") : path.join(ROOT, "src", "puzzles");
const shipped = JSON.parse(fs.readFileSync(path.join(caseDir, "shadoku_case1.json"), "utf8"));
const puzzle = (title) => {
  const d = JSON.parse(JSON.stringify(shipped));
  d.title = title;
  d.suspects.forEach((s) => { s.atoms = [{ kind: "ROOM", subject: s.id, params: { room: d.roomIds[d.rooms[s.solution[0]][s.solution[1]]] } }]; });
  for (const k of ["hints", "steps", "gates", "dress", "dressing", "biomeProps"]) delete d[k];
  return { puzzle: d, difficulty: "Easy" };
};
const PROGRESS = { v: 1, boards: { case1: { tokens: { A: 101 }, done: true } }, at: { case1: 5 }, times: { case1: 120 }, bests: { case1: 120 }, flags: {} };

/* ───────────── before migration 0004: the app's token waits, the website carries on ───────────── */
// (first: functions/_lib/app/context.js looks at the schema once per isolate, and remembers it only once the tables are there)
{
  section();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadoku-migrations-"));
  for (const f of ["0001_app_wallet.sql", "0002_app_seed.sql", "0003_app_identity.sql"]) fs.copyFileSync(path.join(ROOT, "migrations", f), path.join(dir, f));
  const old = openD1(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  await siteTables(old);
  const oldKv = new Map(), env = { ...baseEnv, SHADOKU_DB: old, SHADOKU_KV: kvOf(oldKv) };
  const A = "google:9000001";
  old.raw.exec(`INSERT INTO accounts (id, kind, created) VALUES ('${A}', 'full', 0); INSERT INTO wallets (account_id) VALUES ('${A}');
    INSERT INTO devices (id, account_id, created, last_seen) VALUES ('dev-9000001', '${A}', 0, 0);
    INSERT INTO purchases (token_hash, account_id, sku, order_id, state, verified_at, op) VALUES ('hash-1', '${A}', 'coins_100', 'GPA.1', 'purchased', 0, 'op-1')`);
  const token = await sealAppToken(baseEnv, { id: A, dev: "dev-9000001" }), cookie = await cookieFor(A);
  eq("until 0004 is applied the app's token answers 503 schema: on the shared endpoints and on its own", await quiet(async () => [await answer(app("GET", "/api/progress", token, { env })), await answer(app("DELETE", "/api/account", token, { env })), await answer(app("GET", "/api/app/wallet", token, { env }))]), ["503 schema", "503 schema", "503 schema"]);
  eq("…and the website does not notice", [await status(web("PUT", "/api/progress", cookie, { env, body: { progress: PROGRESS } })), (await hit("GET", "/api/progress", { cookie, env })).body.progress, await status(web("POST", "/api/report", undefined, { env, body: { kind: "error", message: "x" } }))], [200, PROGRESS, 204]);
  const del = await web("DELETE", "/api/account", cookie, { env });
  eq("deleting an account on the website still erases its wallet and its phones, and keeps the purchase without it", [del.status, /sh_session=;/.test(del.setCookie || ""), ["accounts", "wallets", "devices"].map((t) => old.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n), old.raw.prepare("SELECT account_id FROM purchases").get().account_id, named(old.raw, "9000001"), [...oldKv.keys()]], [200, true, [0, 0, 0], "erased", [], [`gone:${A}`]]);
}

/* ───────────── the website's cookie: every shared endpoint as it always answered ───────────── */
let webPuzzle = "";
{
  section();
  const W = "google:9010001", cookie = await cookieFor(W), other = await cookieFor("google:9010002");
  eq("progress: read with the cookie (an Origin is not needed), written from the site's own origin only", [
    (await hit("GET", "/api/progress", { cookie })).body.account, await status(web("PUT", "/api/progress", cookie, { body: { progress: PROGRESS } })), (await web("GET", "/api/progress", cookie)).body.progress,
    await answer(hit("PUT", "/api/progress", { cookie, body: { progress: {} } })), await answer(hit("PUT", "/api/progress", { cookie, from: "evil", body: { progress: {} } })),
    await answer(web("PUT", "/api/progress", undefined, { body: { progress: {} } })), await answer(hit("GET", "/api/progress")), await answer(web("PUT", "/api/progress", cookie, { body: "x" })),
  ], [W, 200, PROGRESS, "403 origin", "403 origin", "401 auth", "401 auth", "400 format"]);
  eq("…with room for years of boards (the 256 KB limit is gone) and a safety ceiling far above", [await answer(web("PUT", "/api/progress", cookie, { body: { progress: { pad: "x".repeat(900 * 1024) } } })), (await web("GET", "/api/progress", cookie)).body.progress.pad.length, await answer(web("PUT", "/api/progress", cookie, { body: { progress: PROGRESS } })),
    await answer(web("PUT", "/api/progress", cookie, { body: { progress: { pad: "x".repeat(4 * 1024 * 1024) } } })), (await web("GET", "/api/progress", cookie)).body.progress], [200, 900 * 1024, 200, "413 size", PROGRESS]);
  eq("codename", [(await web("GET", "/api/username?name=Web_Agent", cookie)).body, await status(web("PUT", "/api/username", cookie, { body: { name: "Web_Agent" } })), (await web("GET", "/api/username?name=web_agent", other)).body, await answer(web("PUT", "/api/username", other, { body: { name: "WEB_AGENT" } })),
    await answer(hit("PUT", "/api/username", { cookie, body: { name: "Nope_1" } })), await answer(hit("GET", "/api/username?name=Nope_1")), kv.get("name:web_agent")], [{ available: true }, 200, { available: false }, "409 taken", "403 origin", "401 auth", W]);
  eq("avatar", [(await web("PUT", "/api/avatar", cookie, { body: { avatar: "photo" } })).body, await answer(hit("PUT", "/api/avatar", { cookie, from: "evil", body: { avatar: "" } })), await answer(web("PUT", "/api/avatar", undefined, { body: { avatar: "" } }))], [{ ok: true, shown: "https://lh3.googleusercontent.com/a/web" }, "403 origin", "401 auth"]);
  const pub = await web("POST", "/api/community", cookie, { body: puzzle("The Web Case") });
  webPuzzle = pub.body.id;
  eq("community: publish, list, read, rate, play, take down", [
    pub.status, (await hit("GET", "/api/community", { cookie })).body.puzzles.map((p) => [p.title, p.author, p.mine]), (await hit("GET", "/api/community")).body.puzzles[0].mine,
    await answer(web("PUT", `/api/community/${webPuzzle}/rate`, cookie, { body: { stars: 5 } })), (await web("PUT", `/api/community/${webPuzzle}/rate`, other, { body: { stars: 4 } })).body, (await hit("GET", `/api/community/${webPuzzle}`, { cookie: other })).body.myRating,
    (await web("POST", `/api/community/${webPuzzle}/play`, other, { body: { solved: true } })).body, (await web("POST", `/api/community/${webPuzzle}/play`, undefined, { body: { player: "anonymous-browser-0001" } })).body,
    await answer(web("DELETE", `/api/community/${webPuzzle}`, other)), await answer(hit("POST", "/api/community", { cookie, body: puzzle("No Origin") })), await answer(web("POST", "/api/community", undefined, { body: puzzle("Nobody") })),
    await answer(hit("PUT", `/api/community/${webPuzzle}/rate`, { cookie: other, from: "evil", body: { stars: 1 } })), await answer(hit("POST", `/api/community/${webPuzzle}/play`, { cookie: other, body: {} })), await answer(hit("DELETE", `/api/community/${webPuzzle}`, { cookie })),
  ], [201, [["The Web Case", "Web_Agent", true]], false, "403 own", { stars: 4, avg: 4, count: 1 }, 4, { plays: 1, solves: 1 }, { plays: 2, solves: 1 }, "403 forbidden", "403 origin", "401 auth", "403 origin", "403 origin", "403 origin"]);
  eq("error reports: from the site's own pages, signed in or not", [await status(web("POST", "/api/report", undefined, { body: { kind: "error", message: "boom", route: "/play?x=1" } })), await answer(hit("POST", "/api/report", { body: { kind: "error", message: "boom" } })), await answer(hit("POST", "/api/report", { from: "evil", body: { kind: "error", message: "boom" } })), one("SELECT route, message FROM errors")], [204, "403 origin", "403 origin", { route: "/play", message: "boom" }]);
  ok("no answer to the site carries a CORS header", [await hit("GET", "/api/progress", { cookie }), await web("GET", "/api/progress", cookie), await hit("GET", "/api/community", { from: "evil" })].every((r) => r.acao === null && r.credentials === null));
}

/* ───────────── the app's token, from the app's origin, on the same endpoints ───────────── */
let appPuzzle = "";
{
  section();
  const a = await phone("9020001"), b = await phone("9020002"), A = "google:9020001";
  eq("progress: the app reads and writes its account's copy", [(await app("GET", "/api/progress", a.token)).body.account, (await app("GET", "/api/progress", a.token)).body.progress, await status(app("PUT", "/api/progress", a.token, { body: { progress: PROGRESS } })), (await app("GET", "/api/progress", a.token)).body.progress, JSON.parse(kv.get(`progress:${A}`)), (await app("GET", "/api/progress", b.token)).body.progress], [A, null, 200, PROGRESS, PROGRESS, null]);
  eq("…the very copy the website sees for that account: one account, two doors", (await web("GET", "/api/progress", await cookieFor(A))).body.progress, PROGRESS);
  eq("…under the same ceiling", [await answer(app("PUT", "/api/progress", a.token, { body: { progress: { ...PROGRESS, pad: "x".repeat(900 * 1024) } } })), await answer(app("PUT", "/api/progress", a.token, { body: { progress: PROGRESS } })), await answer(app("PUT", "/api/progress", a.token, { body: { progress: { pad: "x".repeat(4 * 1024 * 1024) } } }))], [200, 200, "413 size"]);
  eq("codename: checked, taken, and unique across both doors", [(await app("GET", "/api/username?name=App_Agent", a.token)).body, await status(app("PUT", "/api/username", a.token, { body: { name: "App_Agent" } })), await answer(app("PUT", "/api/username", b.token, { body: { name: "app_agent" } })), await answer(app("PUT", "/api/username", b.token, { body: { name: "Web_Agent" } })), await answer(app("PUT", "/api/username", b.token, { body: { name: "x" } })), kv.get("name:app_agent")], [{ available: true }, 200, "409 taken", "409 taken", "400 format", A]);
  eq("avatar: \"photo\" is the picture the app's sign-in brought", (await app("PUT", "/api/avatar", a.token, { body: { avatar: "photo" } })).body, { ok: true, shown: "https://lh3.googleusercontent.com/a/9020001" });
  const pub = await app("POST", "/api/community", a.token, { body: puzzle("The App Case") });
  appPuzzle = pub.body.id;
  eq("community: published from the app, listed for everyone, rated and played by another phone, taken down by its author only", [
    pub.status, (await app("GET", "/api/community?sort=new&order=asc", a.token)).body.puzzles.map((p) => [p.title, p.author, p.mine]), (await app("GET", "/api/community?sort=new&order=asc", b.token)).body.puzzles.map((p) => p.mine), (await app("GET", "/api/community", undefined)).body.puzzles.length,
    await answer(app("PUT", `/api/community/${appPuzzle}/rate`, a.token, { body: { stars: 5 } })), (await app("PUT", `/api/community/${appPuzzle}/rate`, b.token, { body: { stars: 3 } })).body, (await app("GET", `/api/community/${appPuzzle}`, b.token)).body.myRating, (await app("GET", `/api/community/${appPuzzle}`, a.token)).body.meta.mine,
    (await app("POST", `/api/community/${appPuzzle}/play`, b.token, { body: { solved: true } })).body, one("SELECT player, solved FROM plays WHERE puzzle_id = ?", appPuzzle),
    await answer(app("DELETE", `/api/community/${appPuzzle}`, b.token)), (await app("PUT", `/api/community/${webPuzzle}/rate`, a.token, { body: { stars: 2 } })).body.count,
  ], [201, [["The Web Case", "Web_Agent", false], ["The App Case", "App_Agent", true]], [false, false], 2, "403 own", { stars: 3, avg: 3, count: 1 }, 3, true, { plays: 1, solves: 1 }, { player: "google:9020002", solved: 1 }, "403 forbidden", 2]);
  const errors = one("SELECT COUNT(*) AS n FROM errors").n;
  eq("error reports: taken from the app with a token, without one, and with one that is no good (nobody needs to be signed in)", [await status(app("POST", "/api/report", a.token, { body: { kind: "render", message: "app boom", build: "app 1.1.0" } })), await status(app("POST", "/api/report", undefined, { body: { kind: "error", message: "early boom" } })), await status(app("POST", "/api/report", "not.a.token-but-long-enough", { body: { kind: "error", message: "late boom" } })), one("SELECT COUNT(*) AS n FROM errors").n - errors, await answer(app("POST", "/api/report", a.token, { body: { kind: "nope", message: "x" } }))], [204, 204, 204, 3, "400 format"]);
  const answers = [await app("GET", "/api/progress", a.token), await app("PUT", "/api/progress", a.token, { body: { progress: PROGRESS } }), await app("GET", "/api/progress", undefined), await app("POST", "/api/report", a.token, { body: { kind: "error", message: "x" } })];
  ok("every answer to the app's origin is readable there, and never with credentials", answers.every((r) => r.acao === APP_ORIGIN && r.credentials === null && r.setCookie === null));
}

/* ───────────── each proof at its own door only ───────────── */
{
  section();
  const a = await phone("9030001"), A = "google:9030001", W = "google:9030002", cookie = await cookieFor(W);
  await web("PUT", "/api/progress", cookie, { body: { progress: { v: 1, mine: "web" } } });
  await app("PUT", "/api/progress", a.token, { body: { progress: { v: 1, mine: "app" } } });
  const put = { body: { progress: { v: 1, mine: "forged" } } }, name = { body: { name: "Forged_1" } };
  eq("a bearer token is worth nothing from the site's origin", [await answer(web("GET", "/api/progress", undefined, { token: a.token })), await answer(web("PUT", "/api/progress", undefined, { token: a.token, ...put })), await answer(web("PUT", "/api/username", undefined, { token: a.token, ...name })), await answer(web("PUT", "/api/avatar", undefined, { token: a.token, body: { avatar: "" } })),
    await answer(web("POST", "/api/community", undefined, { token: a.token, body: puzzle("Forged") })), await answer(web("PUT", `/api/community/${webPuzzle}/rate`, undefined, { token: a.token, body: { stars: 1 } })), await answer(web("DELETE", `/api/community/${appPuzzle}`, undefined, { token: a.token })), await answer(web("DELETE", "/api/account", undefined, { token: a.token }))],
  ["401 auth", "401 auth", "401 auth", "401 auth", "401 auth", "401 auth", "401 auth", "401 auth"]);
  eq("…nor without an Origin, nor from another site, nor from a look-alike of the app's", [await answer(hit("GET", "/api/progress", { token: a.token })), await answer(hit("PUT", "/api/progress", { token: a.token, ...put })), await answer(hit("DELETE", "/api/account", { token: a.token })),
    await answer(hit("GET", "/api/progress", { token: a.token, from: "evil" })), await answer(hit("PUT", "/api/progress", { token: a.token, from: "evil", ...put })), await answer(hit("DELETE", "/api/account", { token: a.token, from: "evil" })),
    await answer(hit("GET", "/api/progress", { token: a.token, from: "alike" })), await answer(hit("PUT", "/api/progress", { token: a.token, from: "alike", ...put })), await answer(hit("GET", "/api/progress", { token: a.token, from: "http://app.shadoku.net" })), await answer(hit("GET", "/api/progress", { token: a.token, from: "null" }))],
  ["401 auth", "403 origin", "403 origin", "401 auth", "403 origin", "403 origin", "401 auth", "403 origin", "401 auth", "401 auth"]);
  eq("…and beside a cookie it is not looked at: the call is the cookie's player, as if it were not there", [(await web("GET", "/api/progress", cookie, { token: a.token })).body.account, await status(web("PUT", "/api/progress", cookie, { token: a.token, ...put })), JSON.parse(kv.get(`progress:${W}`)).mine, JSON.parse(kv.get(`progress:${A}`)).mine, (await web("GET", "/api/progress", cookie, { token: "garbage.garbage-garbage-garbage" })).body.account], [W, 200, "forged", "app", W]);
  eq("the public reads do not take it either: no \"mine\" for a token from the site's origin", [(await web("GET", "/api/community", undefined, { token: (await phone("9020001")).token })).body.puzzles.some((p) => p.mine), (await hit("GET", `/api/community/${appPuzzle}`, { token: (await phone("9020002")).token, from: "evil" })).body.myRating], [false, 0]);

  eq("a cookie is worth nothing from the app's origin: to read, to write, to delete", [await answer(app("GET", "/api/progress", undefined, { cookie })), await answer(app("PUT", "/api/progress", undefined, { cookie, ...put })), await answer(app("PUT", "/api/username", undefined, { cookie, ...name })), await answer(app("POST", "/api/community", undefined, { cookie, body: puzzle("Forged") })), await answer(app("DELETE", "/api/account", undefined, { cookie })), kv.has(`user:${W}`) || kv.has(`gone:${W}`)],
    ["401 auth", "401 auth", "401 auth", "401 auth", "401 auth", false]);
  eq("…also when the middleware is not in front (the endpoint does not read it there)", [await answer(app("GET", "/api/progress", undefined, { cookie, direct: true })), await answer(app("PUT", "/api/progress", undefined, { cookie, direct: true, ...put })), await answer(app("DELETE", "/api/account", undefined, { cookie, direct: true })), (await app("GET", "/api/community", undefined, { cookie: await cookieFor("google:9010001"), direct: true })).body.puzzles.some((p) => p.mine)], ["401 auth", "401 auth", "401 auth", false]);
  eq("…and beside a token it is dropped: the call is the token's player", [(await app("GET", "/api/progress", a.token, { cookie })).body.account, (await app("GET", "/api/progress", a.token, { cookie, direct: true })).body.account, (await app("GET", "/api/progress", a.token, { cookie })).body.progress.mine], [A, A, "app"]);
  eq("a token is not a cookie and a cookie is not a token", [await answer(web("GET", "/api/progress", a.token)), await answer(web("PUT", "/api/progress", a.token, put)), await answer(app("GET", "/api/progress", cookie)), await answer(app("PUT", "/api/progress", cookie, put)), await answer(app("DELETE", "/api/account", cookie))], ["401 auth", "401 auth", "401 auth", "401 auth", "401 auth"]);
  eq("error reports from anywhere else are refused as before", [await answer(hit("POST", "/api/report", { from: "alike", token: a.token, body: { kind: "error", message: "x" } })), await answer(hit("POST", "/api/report", { token: a.token, body: { kind: "error", message: "x" } }))], ["403 origin", "403 origin"]);
  eq("an endpoint that is not shared stays the website's: the ranking", [await answer(app("GET", "/api/ranking", a.token)), await answer(app("PUT", "/api/ranking", a.token, { body: { entries: [] } })), await status(web("PUT", "/api/ranking", cookie, { body: { entries: [] } }))], ["401 auth", "403 origin", 200]);
  eq("nothing of all that moved a thing", [JSON.parse(kv.get(`progress:${A}`)).mine, kv.has("name:forged_1"), one("SELECT COUNT(*) AS n FROM puzzles WHERE title = 'Forged'").n, one("SELECT 1 AS x FROM accounts WHERE id = ?", A).x], ["app", false, 0, 1]);
}

/* ───────────── the token is only as good as its device ───────────── */
{
  section();
  const p1 = await phone("9040001"), p2 = await phone("9040001"), A = "google:9040001", other = await phone("9040002");
  const tries = async (token, opt = {}) => [await answer(app("GET", "/api/progress", token, opt)), await answer(app("PUT", "/api/progress", token, { ...opt, body: { progress: { v: 1 } } })), await answer(app("PUT", "/api/username", token, { ...opt, body: { name: "Device_1" } })), await answer(app("DELETE", "/api/account", token, opt))];
  const all = (answerOf) => [answerOf, answerOf, answerOf, answerOf];
  eq("two phones of one account, each with its device", [p1.account.id, p2.account.id, p1.device !== p2.device, await answer(app("GET", "/api/progress", p1.token)), await answer(app("GET", "/api/progress", p2.token))], [A, A, true, 200, 200]);
  eq("a token that names no device is refused here", await tries(await sealAppToken(baseEnv, { id: A })), all("401 auth"));
  eq("…one that names another account's device, or a device nobody has", [await tries(await sealAppToken(baseEnv, { id: A, dev: other.device })), await tries(await sealAppToken(baseEnv, { id: A, dev: uid() }))], [all("401 revoked"), all("401 revoked")]);
  eq("…one that ran out, one that was tampered with, one for an account that never was", [await tries(await sealAppToken(baseEnv, { id: A, dev: p1.device }, -60)), await tries(`${p1.token.slice(0, -3)}AAA`), await tries(await sealAppToken(baseEnv, { id: "google:nobody", dev: p1.device }))], [all("401 auth"), all("401 auth"), all("401 auth")]);
  eq("…and one made with another secret", await tries(await sealAppToken({ ...baseEnv, SESSION_SECRET: "another-secret-".repeat(3) }, { id: A, dev: p1.device })), all("401 auth"));

  await app("POST", "/api/app/auth/logout", p1.token);
  eq("signing out revokes the phone's token on the shared endpoints too; the other phone is not touched", [await tries(p1.token), await answer(app("GET", "/api/progress", p2.token)), (await app("GET", "/api/community", p1.token)).body.puzzles.length > 0], [all("401 revoked"), 200, true]);
  const switched = await phone("9040003", { token: p2.token });
  eq("a phone that signs in as someone else: its old token stops, its new one is the new player", [switched.device === p2.device, await tries(p2.token), (await app("GET", "/api/progress", switched.token)).body.account], [true, all("401 revoked"), "google:9040003"]);
  eq("the account itself was not touched by any of it", [one("SELECT 1 AS x FROM accounts WHERE id = ?", A).x, kv.has(`gone:${A}`), kv.has("name:device_1")], [1, false, false]);

  const g = await guest(), s = await phone("9040004", { token: g.token });
  eq("a guest that signed in: its old token says where it went", [await answer(app("GET", "/api/progress", g.token)), (await app("DELETE", "/api/account", g.token)).body, await answer(app("GET", "/api/progress", s.token)), one("SELECT merged_into FROM accounts WHERE id = ?", g.account.id).merged_into], ["409 merged", { error: "merged", into: "google:9040004" }, 200, "google:9040004"]);

  eq("without the database the token cannot be checked: 503, and the cookie still works", await quiet(async () => [await answer(app("GET", "/api/progress", other.token, { env: { ...baseEnv, SHADOKU_DB: undefined } })), await answer(app("DELETE", "/api/account", other.token, { env: { ...baseEnv, SHADOKU_DB: undefined } })), await answer(hit("GET", "/api/progress", { cookie: await cookieFor("google:9040002"), env: { ...baseEnv, SHADOKU_DB: undefined } }))]), ["503 storage", "503 storage", 200]);
  eq("without SESSION_SECRET nobody is signed in", [await answer(app("GET", "/api/progress", other.token, { env: { ...baseEnv, SESSION_SECRET: "" } })), await answer(hit("GET", "/api/progress", { cookie: await cookieFor("google:9040002"), env: { ...baseEnv, SESSION_SECRET: "" } }))], ["401 auth", "401 auth"]);
}

/* ───────────── guests: nothing of the community side, nothing kept for them ───────────── */
{
  section();
  const g = await guest(), G = g.account.id;
  await sync(g.token, [solveEv("tut1")]);
  eq("a guest must sign in for everything these endpoints keep", [await answer(app("GET", "/api/progress", g.token)), await answer(app("PUT", "/api/progress", g.token, { body: { progress: PROGRESS } })), await answer(app("GET", "/api/username?name=Guest_1", g.token)), await answer(app("PUT", "/api/username", g.token, { body: { name: "Guest_1" } })), await answer(app("PUT", "/api/avatar", g.token, { body: { avatar: "" } })),
    await answer(app("POST", "/api/community", g.token, { body: puzzle("A Guest's") })), await answer(app("PUT", `/api/community/${webPuzzle}/rate`, g.token, { body: { stars: 1 } })), await answer(app("DELETE", `/api/community/${webPuzzle}`, g.token))],
  ["403 signin_required", "403 signin_required", "403 signin_required", "403 signin_required", "403 signin_required", "403 signin_required", "403 signin_required", "403 signin_required"]);
  const before = one("SELECT plays FROM puzzles WHERE id = ?", webPuzzle).plays;
  eq("a guest sees what any visitor sees, and a play counts by the phone's own id, not the account", [(await app("GET", "/api/community", g.token)).body.puzzles.some((p) => p.mine), (await app("GET", `/api/community/${webPuzzle}`, g.token)).body.myRating, (await app("POST", `/api/community/${webPuzzle}/play`, g.token, { body: { player: "guest-phone-install-0001" } })).body.plays - before, await answer(app("POST", `/api/community/${webPuzzle}/play`, g.token, { body: {} })), await status(app("POST", "/api/report", g.token, { body: { kind: "error", message: "guest boom" } }))], [false, 0, 1, "400 format", 204]);
  eq("nothing was kept for the guest outside the app's own tables", [[...kv.keys()].filter((k) => k.includes(G)), named(d1.raw, G).filter((t) => !["accounts", "wallets", "devices", "ledger", "solves", "quest_state", "account_seen"].includes(t))], [[], []]);
}

/* ───────────── deleting an account from the app: everything that names it goes ───────────── */
{
  section();
  const SUB = "9060001", A = `google:${SUB}`, LINKED = "9060002";
  // a player who started as a guest, signed in, plays on two phones and on the website, and has bought things
  const g = await guest(), G = g.account.id;
  await sync(g.token, [solveEv("tut1"), solveEv("e1")]);
  await app("POST", "/api/app/streak/claim", g.token, { body: { date: today() } });
  const p1 = await phone(SUB, { token: g.token }), p2 = await phone(SUB), cookie = await cookieFor(A);
  await sync(p1.token, [solveEv("m1"), { eventId: uid(), type: "hint_use", caseId: "m1" }]);
  await app("POST", "/api/app/social/open", p1.token, { body: { network: "instagram" } });
  await app("POST", "/api/app/social/claim", p1.token, { body: { network: "instagram" } });
  await app("POST", "/api/app/auth/link", p1.token, { body: { provider: "github", sub: LINKED } });
  eq("(purchases: 100 coins, 500 coins refunded afterwards, a membership)", [await status(buy(p1.token, "coins_100", "dev.coins_100.kept-0001")), await status(buy(p2.token, "coins_500", "dev.coins_500.kept-0002")), await status(buy(p1.token, "member", "dev.member.kept-0003")), (await refund("dev.coins_500.kept-0002")).body.results], [200, 200, 200, ["voided"]]);
  d1.raw.prepare("INSERT INTO flags (account_id, kind, detail, at) VALUES (?, 'fast_solve', '{}', 0)").run(A);
  await app("PUT", "/api/progress", p1.token, { body: { progress: PROGRESS } });
  await app("PUT", "/api/username", p1.token, { body: { name: "Leaving_1" } });
  await app("PUT", "/api/avatar", p1.token, { body: { avatar: "photo" } });
  const mine = (await app("POST", "/api/community", p1.token, { body: puzzle("Leaving Soon") })).body.id;
  await app("PUT", `/api/community/${webPuzzle}/rate`, p1.token, { body: { stars: 1 } });
  await app("POST", `/api/community/${webPuzzle}/play`, p1.token, { body: { solved: true } });
  await web("PUT", "/api/ranking", cookie, { body: { entries: [] } });
  const rated = () => one("SELECT rating_count AS n FROM puzzles WHERE id = ?", webPuzzle).n, ratedBefore = rated();
  const hashes = await Promise.all(["dev.coins_100.kept-0001", "dev.coins_500.kept-0002", "dev.member.kept-0003"].map((t) => sha256b64u(t)));
  const money = rows("SELECT seq, currency, delta, reason, ref, at, meta FROM ledger WHERE account_id = ? AND reason IN ('iap', 'refund') ORDER BY seq", A);
  eq("(the account before: coins, a membership, cards, two phones, a linked sign-in, the guest it grew from, and its place on the website)", [coins(A), rows("SELECT key FROM entitlements WHERE account_id = ? ORDER BY key", A).map((e) => e.key), one("SELECT COUNT(*) AS n FROM devices WHERE account_id = ? AND revoked_at IS NULL", A).n, one("SELECT COUNT(*) AS n FROM identities WHERE account_id = ?", A).n, one("SELECT merged_into FROM accounts WHERE id = ?", G).merged_into, named(d1.raw, A).length > 12, ["players", "puzzles", "ratings", "plays"].every((t) => named(d1.raw, A).includes(t)), [`user:${A}`, `progress:${A}`, "name:leaving_1"].every((k) => kv.has(k))],
    [175, ["member", "remove_ads"], 2, 1, A, true, true, true]); // 35 as a guest + 15 + 25 (the visit) + 100 bought; the 500 came and went

  const del = await app("DELETE", "/api/account", p1.token);
  eq("the app deletes the account with its token", [del.status, del.body, del.acao, del.setCookie], [200, { ok: true }, APP_ORIGIN, null]);
  eq("nothing in the database names it any more: not the account, its sign-ins, its phones or the guest it grew from", [named(d1.raw, A), named(d1.raw, SUB), named(d1.raw, LINKED), named(d1.raw, G), named(d1.raw, p1.device), named(d1.raw, p2.device), named(d1.raw, g.device)], [[], [], [], [], [], [], []]);
  eq("…nor in the site's own store, but the mark that ends its sessions (the id and a time, for 31 days)", [[...kv.keys()].filter((k) => k.includes(A) || k.includes(G)), kv.has("name:leaving_1"), /^\d+$/.test(kv.get(`gone:${A}`))], [[`gone:${A}`], false, true]);
  eq("its puzzle is gone with its ratings, and the rating it gave is taken out of the count", [one("SELECT COUNT(*) AS n FROM puzzles WHERE id = ?", mine).n, ratedBefore - rated()], [0, 1]);

  eq("KEPT, without the account: its three purchase rows, for the refunds and against a replay", rows("SELECT account_id, sku, state, token_hash FROM purchases WHERE token_hash IN (?, ?, ?) ORDER BY sku", ...hashes).map((p) => `${p.account_id} ${p.sku} ${p.state} ${hashes.indexOf(p.token_hash)}`), ["erased coins_100 purchased 0", "erased coins_500 voided 1", "erased member purchased 2"]);
  eq("KEPT, without the account: what those purchases delivered and what the refund took back, line for line", [rows("SELECT seq, currency, delta, reason, ref, at, meta FROM kept_ledger WHERE ref IN (?, ?, ?, ?) ORDER BY seq", ...hashes, "DEV.dev.coins_500.kept-0002"), rows("SELECT reason, delta FROM kept_ledger WHERE ref IN (?, ?, ?, ?) ORDER BY seq", ...hashes, "DEV.dev.coins_500.kept-0002").map((l) => `${l.reason} ${l.delta}`), Object.keys(one("SELECT * FROM kept_ledger LIMIT 1")).sort()],
    [money, ["iap 100", "iap 500", "refund -500"], ["at", "currency", "delta", "erased_at", "meta", "reason", "ref", "seq"]]);
  eq("…and nothing else of its ledger, and no ban (it was not banned)", [one("SELECT COUNT(*) AS n FROM kept_ledger WHERE reason NOT IN ('iap', 'refund')").n, one("SELECT COUNT(*) AS n FROM kept_bans").n], [0, 0]);

  // every session of it is over: the two phones, the guest's old token, the website
  const dead = async (token) => [await answer(app("GET", "/api/app/wallet", token)), await answer(app("POST", "/api/app/sync", token, { body: { events: [solveEv("e2")] } })), await answer(app("POST", "/api/app/auth/refresh", token, { body: {} })), await answer(app("GET", "/api/progress", token)), await answer(app("DELETE", "/api/account", token))];
  eq("every phone is signed out: the one that asked, the other one, and the guest's old token", [await dead(p1.token), await dead(p2.token), await dead(g.token)], [Array(5).fill("401 auth"), Array(5).fill("401 auth"), Array(5).fill("401 auth")]);
  eq("…and so is the website, which is told why", [await answer(hit("GET", "/api/progress", { cookie })), (await hit("GET", "/api/auth/session", { cookie })).body.deleted, await answer(web("PUT", "/api/progress", cookie, { body: { progress: PROGRESS } }))], ["401 auth", true, "401 auth"]);
  // the `gone` mark lives in KV, which another data centre may see a minute late: the database alone must already refuse
  const lag = { env: { ...baseEnv, SHADOKU_KV: undefined } };
  eq("before the mark has spread, the database already refuses the phones, and no call brings an empty account back", [await answer(app("GET", "/api/app/wallet", p2.token, lag)), await answer(app("POST", "/api/app/sync", p2.token, { ...lag, body: { events: [solveEv("e2")] } })), await answer(app("POST", "/api/app/auth/refresh", p2.token, { ...lag, body: {} })), await answer(app("GET", "/api/progress", p2.token, lag)), await answer(app("PUT", "/api/progress", p2.token, { ...lag, body: { progress: PROGRESS } })), named(d1.raw, A), kv.has(`progress:${A}`)],
    ["401 auth", "401 auth", "401 auth", "401 auth", "401 auth", [], false]);

  eq("a refund that arrives afterwards finds its order, and has nothing left to take", [(await refund("dev.coins_100.kept-0001")).body.results, one("SELECT account_id, state FROM purchases WHERE token_hash = ?", hashes[0]), named(d1.raw, A)], [["voided"], { account_id: "erased", state: "voided" }, []]);
  await sleep(5); // (a session counts as issued after a deletion from the next millisecond on)
  const back = await phone(SUB);
  eq("the same sign-in afterwards is a new account with nothing", [back.account, back.merge, back.device !== p1.device, (await app("GET", "/api/app/wallet", back.token)).body.state.coins, (await app("GET", "/api/app/wallet", back.token)).body.state.entitlements, (await app("GET", "/api/progress", back.token)).body.progress, (await app("GET", "/api/progress", back.token)).body.since > 0, (await app("GET", "/api/app/bootstrap", back.token)).body.account.signIns], [{ id: A, kind: "full", provider: "google" }, { result: "none" }, true, 0, [], null, true, ["google"]]);
  // RESTORE: what Play says the player still owns comes back to the same sign-in, and only that
  const stranger = await phone("9060009");
  eq("the coins it bought cannot be had again, and nobody else can take its membership", [await answer(buy(back.token, "coins_100", "dev.coins_100.kept-0001")), await answer(buy(back.token, "coins_500", "dev.coins_500.kept-0002")), await answer(buy(stranger.token, "member", "dev.member.kept-0003")), await answer(buy(back.token, "member_gold", "dev.member.kept-0003")), coins(A), rows("SELECT key FROM entitlements WHERE account_id IN (?, ?)", A, "google:9060009").length], ["409 token_used", "409 token_used", "409 token_used", "409 token_used", 0, 0]);
  eq("(the kept row of the permanent purchase carries the buyer's hash, the others carry none; none carries the id)", rows("SELECT sku, owner_hash IS NOT NULL AS kept, owner_hash FROM purchases WHERE token_hash IN (?, ?, ?) ORDER BY sku", ...hashes).map((p) => `${p.sku} ${p.kept} ${String(p.owner_hash).includes(SUB)}`), ["coins_100 0 false", "coins_500 0 false", "member 1 false"]);
  const restored = await buy(back.token, "member", "dev.member.kept-0003");
  eq("its membership is restored: the entitlements return, and no coin, hint or card with them", [restored.status, restored.body.restored, restored.body.granted, restored.body.state.entitlements, restored.body.state.coins, restored.body.state.hintsToday.free, restored.body.state.inventory, one("SELECT account_id, owner_hash, restored_at FROM purchases WHERE token_hash = ?", hashes[2])],
    [200, true, { coins: 0, hints: 0, entitlements: ["remove_ads", "member"], inventory: {} }, ["member", "remove_ads"], 0, 10, {}, { account_id: A, owner_hash: null, restored_at: NOW }]);
  eq("…once: sent again it is a duplicate, and still nobody else's", [(await buy(back.token, "member", "dev.member.kept-0003")).body.duplicate, await answer(buy(stranger.token, "member", "dev.member.kept-0003")), one("SELECT COUNT(*) AS n FROM entitlements WHERE account_id = ?", A).n], [true, "409 token_used", 2]);
  eq("…and a refund of it afterwards takes it away again", [(await refund("dev.member.kept-0003")).body.results, rows("SELECT key FROM entitlements WHERE account_id = ?", A).length, await answer(buy(back.token, "member", "dev.member.kept-0003"))], [["voided"], 0, "409 voided"]);
  // a purchase refunded before the account was deleted is not given back; one deleted twice is restored twice
  const twice = await phone("9060010"), TW = "google:9060010";
  await buy(twice.token, "remove_ads", "dev.remove_ads.kept-0010"); await buy(twice.token, "member_gold", "dev.member_gold.kept-0011"); await refund("dev.member_gold.kept-0011");
  await app("DELETE", "/api/account", twice.token); await sleep(5);
  const second = await phone("9060010");
  eq("a refunded upgrade is not restored; the other one is, again after a second deletion", [await answer(buy(second.token, "member_gold", "dev.member_gold.kept-0011")), (await buy(second.token, "remove_ads", "dev.remove_ads.kept-0010")).body.restored, await answer(app("DELETE", "/api/account", second.token)), named(d1.raw, TW)], ["409 token_used", true, 200, []]);
  await sleep(5);
  eq("…", [(await buy((await phone("9060010")).token, "remove_ads", "dev.remove_ads.kept-0010")).body.state.entitlements], [["remove_ads"]]);
  eq("…and the old tokens stay dead beside the new account", [await answer(app("GET", "/api/app/wallet", p1.token)), await answer(app("GET", "/api/progress", p2.token)), await answer(app("POST", "/api/app/auth/refresh", p2.token, { body: {} }))], ["401 auth", "401 auth", "401 auth"]);
  const request = new Request(`${SITE}/api/app/auth/google`, { method: "POST" });
  eq("the sign-in that was linked to it is its own account again", (await signInCore(await appDoor(request, baseEnv), request, { provider: "github", sub: LINKED, name: "", avatar: "" }, {})).body.account.id, `github:${LINKED}`);
}

/* ───────────── a guest deletes its account ───────────── */
{
  section();
  const g = await guest(), G = g.account.id, bystander = await guest();
  await sync(g.token, [solveEv("tut1"), solveEv("e1"), { eventId: uid(), type: "hint_use", caseId: "e1" }]);
  await app("POST", "/api/app/streak/claim", g.token, { body: { date: today() } });
  await sync(bystander.token, [solveEv("tut1")]);
  eq("(the guest has a wallet, contracts, a pack and a phone)", [coins(G), named(d1.raw, G).length > 6], [35, true]);
  eq("a guest cannot be deleted from the website's door (it has no cookie there)", [await answer(web("DELETE", "/api/account", undefined, { token: g.token })), await answer(hit("DELETE", "/api/account", { token: g.token })), coins(G)], ["401 auth", "403 origin", 35]);
  const del = await app("DELETE", "/api/account", g.token);
  eq("a guest account is deleted from the app, with everything it had", [del.status, del.body, named(d1.raw, G), named(d1.raw, g.device), [...kv.keys()].filter((k) => k.includes(G))], [200, { ok: true }, [], [], [`gone:${G}`]]);
  eq("…its token is over for good: a guest has no way back in", [await answer(app("GET", "/api/app/wallet", g.token)), await answer(app("POST", "/api/app/auth/refresh", g.token, { body: {} })), await answer(app("DELETE", "/api/account", g.token)), (await phone("9070001", { token: g.token })).merge], ["401 auth", "401 auth", "401 auth", { result: "none" }]);
  eq("…and nobody else lost anything", [coins(bystander.account.id), await answer(app("GET", "/api/app/wallet", bystander.token)), one("SELECT COUNT(*) AS n FROM kept_bans").n], [25, 200, 0]);
  const again = await guest();
  eq("the phone then starts over as a new guest", [again.account.id !== G, coins(again.account.id)], [true, 0]);
}

/* ───────────── a ban outlives the account ───────────── */
{
  section();
  const SUB = "9080001", A = `google:${SUB}`, LINKED = "9080002";
  const p = await phone(SUB);
  await app("POST", "/api/app/auth/link", p.token, { body: { provider: "github", sub: LINKED } });
  await app("PUT", "/api/progress", p.token, { body: { progress: PROGRESS } });
  d1.raw.prepare("UPDATE accounts SET banned = 1 WHERE id = ?").run(A);
  eq("a banned account is refused on the shared endpoints as on the app's own", [await answer(app("GET", "/api/progress", p.token)), await answer(app("PUT", "/api/progress", p.token, { body: { progress: {} } })), await answer(app("PUT", "/api/username", p.token, { body: { name: "Banned_1" } })), await answer(app("POST", "/api/community", p.token, { body: puzzle("Banned") })), await answer(app("GET", "/api/app/wallet", p.token)), (await app("GET", "/api/community", p.token)).body.puzzles.some((x) => x.mine)], ["403 banned", "403 banned", "403 banned", "403 banned", "403 banned", false]);
  eq("…but it can still delete itself", [await answer(app("DELETE", "/api/account", p.token)), named(d1.raw, A), named(d1.raw, SUB), named(d1.raw, LINKED), kv.has(`progress:${A}`)], [200, [], [], [], false]);
  eq("KEPT: that its sign-ins were banned, as hashes that are not the ids", [rows("SELECT account_hash FROM kept_bans ORDER BY account_hash").map((b) => b.account_hash), one("SELECT COUNT(*) AS n FROM kept_bans WHERE erased_at = ?", NOW).n], [[await banKey(A), await banKey(`github:${LINKED}`)].sort(), 2]);
  await sleep(5);
  const request = new Request(`${SITE}/api/app/auth/google`, { method: "POST" });
  eq("deleting the account did not lift the ban: the same sign-in comes back banned, and so does the one that was linked", [await answer(app("POST", "/api/app/auth/google", undefined, { body: { sub: SUB } })), (await signInCore(await appDoor(request, baseEnv), request, { provider: "github", sub: LINKED, name: "", avatar: "" }, {})).body, one("SELECT banned FROM accounts WHERE id = ?", A).banned, coins(A)], ["403 banned", { error: "banned" }, 1, 0]);
  eq("…also through a cookie on the app's own endpoints", [await answer(hit("GET", "/api/app/wallet", { cookie: await cookieFor("github:9080002") })), one("SELECT banned FROM accounts WHERE id = 'github:9080002'").banned], ["403 banned", 1]);

  // deleted from the website instead
  const w = await phone("9080003"), W = "google:9080003";
  d1.raw.prepare("UPDATE accounts SET banned = 1 WHERE id = ?").run(W);
  eq("a banned account deleted on the website leaves its ban too", [await answer(web("DELETE", "/api/account", await cookieFor(W))), named(d1.raw, W), one("SELECT COUNT(*) AS n FROM kept_bans WHERE account_hash = ?", await banKey(W)).n, await answer(app("GET", "/api/app/wallet", w.token))], [200, [], 1, "401 auth"]);
  await sleep(5);
  eq("…and is banned when it returns", await answer(app("POST", "/api/app/auth/google", undefined, { body: { sub: "9080003" } })), "403 banned");
  eq("a sign-in that was never banned starts clean", [(await phone("9080004")).account.id, one("SELECT banned FROM accounts WHERE id = 'google:9080004'").banned, one("SELECT COUNT(*) AS n FROM kept_bans").n], ["google:9080004", 0, 3]);
  const banned = await guest();
  d1.raw.prepare("UPDATE accounts SET banned = 1 WHERE id = ?").run(banned.account.id);
  eq("a banned guest that deletes itself leaves no row (a new guest is a new id anyway)", [await answer(app("DELETE", "/api/account", banned.token)), one("SELECT COUNT(*) AS n FROM kept_bans").n], [200, 3]);
}

/* ───────────── whole or not at all: a failed erasure leaves the caller signed in, to ask again ───────────── */
{
  section();
  const g = await guest(), G = g.account.id, f = await phone("9090001"), F = "google:9090001";
  for (const p of [g, f]) await sync(p.token, [solveEv("tut1"), solveEv("e1")]);
  await app("PUT", "/api/progress", f.token, { body: { progress: PROGRESS } });
  let failing = true;
  // the database fails on the erasing batch (the only one here with that many statements)
  const flaky = { prepare: (sql) => d1.prepare(sql), batch: async (stmts) => { if (failing && stmts.length > 15) throw new Error("D1_ERROR: the batch failed"); return d1.batch(stmts); } };
  const env = { ...baseEnv, SHADOKU_DB: flaky };
  const before = [named(d1.raw, G), named(d1.raw, F)];
  eq("when the erasure fails the answer is an error", await quiet(async () => [await answer(app("DELETE", "/api/account", g.token, { env })), await answer(app("DELETE", "/api/account", f.token, { env })), await answer(web("DELETE", "/api/account", await cookieFor(F), { env }))]), ["500 server", "500 server", "500 server"]);
  eq("…nothing was erased, nobody was signed out, on either side", [[named(d1.raw, G), named(d1.raw, F)], coins(G), coins(F), await answer(app("GET", "/api/app/wallet", g.token)), await answer(app("GET", "/api/progress", f.token)), await answer(hit("GET", "/api/progress", { cookie: await cookieFor(F) })), kv.has(`gone:${G}`) || kv.has(`gone:${F}`), kv.has(`progress:${F}`)], [before, 35, 35, 200, 200, 200, false, true]);
  failing = false;
  eq("…and asking again deletes it", [await answer(app("DELETE", "/api/account", g.token, { env })), await answer(app("DELETE", "/api/account", f.token, { env })), named(d1.raw, G), named(d1.raw, F), kv.has(`progress:${F}`)], [200, 200, [], [], false]);
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
  ok("every ledger line that is left continues the one before, and every wallet is the sum of its ledger", chain && rows("SELECT account_id, coins, hints FROM wallets").every((w) => w.coins === (run.get(`${w.account_id}|coin`) || 0) && w.hints === (run.get(`${w.account_id}|hint`) || 0)));
  ok("no row is left without its account: wallets, ledger, devices, identities, contracts, cards", ["wallets", "ledger", "devices", "identities", "solves", "inventory", "entitlements", "quest_state", "streaks", "hint_uses", "social_visits", "flags"].every((t) => !one(`SELECT 1 AS x FROM ${t} t WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = t.account_id)`)));
  ok("every purchase belongs to an account that exists, or to none", !one("SELECT 1 AS x FROM purchases p WHERE p.account_id <> 'erased' AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = p.account_id)"));
  ok("every kept money line still finds its purchase", rows("SELECT ref FROM kept_ledger").every((l) => one("SELECT 1 AS x FROM purchases WHERE account_id = 'erased' AND (token_hash = ? OR order_id = ?)", l.ref, l.ref)));
  // only functions/_lib/caller.js decides who is calling a shared endpoint
  const shared = ["progress.js", "username.js", "avatar.js", "report.js", "account.js", "community/index.js", "community/[id].js", "community/[id]/rate.js", "community/[id]/play.js"];
  eq("no shared endpoint reads a cookie, a token or the Origin by itself", shared.filter((f) => /readSession|sameOrigin|readBearer|readCookie|Authorization|headers\.get\("Origin"\)/.test(fs.readFileSync(path.join(ROOT, "functions", "api", f), "utf8"))), []);
}

console.log(`${n} checks, ${bad.length} failed`);
bad.forEach((b) => console.log("  FAIL " + b));
process.exit(bad.length ? 1 : 0);
