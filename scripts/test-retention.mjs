// How long things are kept (functions/_lib/retention.js, POST /api/cron/retention), tested in plain node:   npm run test:retention
// Like scripts/test-app-shared.mjs: the real handlers, a SQLite database with the real migrations/, a clock the test moves.
// What is checked, above all: an account that is used is never deleted; one not seen for 12 months is, whole, on both sides;
// rows past their date go and younger ones stay; and nobody but the holder of CRON_SECRET can start any of it.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openD1 } from "./lib/d1-sqlite.mjs";
import { seal } from "../functions/_lib/auth.js";
import { APP_ORIGIN } from "../functions/_lib/app/cors.js";
import { onRequest as middleware } from "../functions/api/_middleware.js";
import { INACTIVE_DAYS, KEPT_YEARS } from "../functions/_lib/retention.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAY = 24 * 3600 * 1000, SITE = "https://www.shadoku.net", LOCAL = "http://localhost:8788";
let n = 0; const bad = [];
const ok = (what, cond) => { n++; if (!cond) bad.push(what); };
const eq = (what, got, want) => ok(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`, JSON.stringify(got) === JSON.stringify(want));
{ const { warn, log } = console; console.warn = (...a) => { if (!/"at":"(client-error|api)"/.test(String(a[0]))) warn(...a); }; console.log = (...a) => { if (!/"at":"retention"/.test(String(a[0]))) log(...a); }; }

/* ───────────── harness ───────────── */
let NOW = Date.UTC(2026, 10, 16, 12);
const d1 = openD1(path.join(ROOT, "migrations"));
const kv = new Map();
const KV = {
  get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, String(v)); }, delete: async (k) => { kv.delete(k); },
  list: async ({ prefix, cursor }) => { const all = [...kv.keys()].filter((k) => k.startsWith(prefix)).sort(), from = Number(cursor) || 0, keys = all.slice(from, from + 2); return { keys: keys.map((name) => ({ name })), list_complete: from + 2 >= all.length, cursor: String(from + 2) }; },
};
const SECRET = "cron-secret-".repeat(4);
const VERIFIER = { verify: async (provider, body) => (typeof body.sub === "string" ? { ok: true, provider, sub: body.sub, name: "", avatar: "" } : { ok: false, error: "invalid" }) };
const baseEnv = { SHADOKU_DB: d1, SHADOKU_KV: KV, SESSION_SECRET: "test-secret-".repeat(4), NOW: () => NOW, IDENTITY_VERIFIER: VERIFIER, CRON_SECRET: SECRET };
const FILES = [[/^\/api\/(progress|username|account|ranking)$/, (m) => `${m[1]}.js`], [/^\/api\/auth\/session$/, () => "auth/session.js"], [/^\/api\/cron\/retention$/, () => "cron/retention.js"], [/^\/api\/app\/(.+)$/, (m) => `app/${m[1]}.js`]];
async function hit(method, where, { from = null, token, cookie, body, env = baseEnv, host = SITE } = {}) {
  const url = new URL(host + where), found = FILES.map(([re, to]) => [re.exec(url.pathname), to]).find(([m]) => m);
  const handler = (await import(pathToFileURL(path.join(ROOT, "functions", "api", found[1](found[0]))).href))[`onRequest${method[0]}${method.slice(1).toLowerCase()}`];
  const h = new Headers({ "CF-Connecting-IP": "10.3.0.1" });
  if (from) h.set("Origin", from);
  if (token) h.set("Authorization", `Bearer ${token}`);
  if (cookie) h.set("Cookie", `${host.startsWith("https") ? "__Host-" : ""}sh_session=${cookie}`);
  const request = new Request(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await middleware({ request, env, next: (req) => handler({ request: req || request, env, params: {} }) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const app = (method, where, token, opt = {}) => hit(method, where, { from: APP_ORIGIN, token, ...opt });
const cron = (query, opt = {}) => hit("POST", `/api/cron/retention?${query}`, { token: SECRET, ...opt });
const rows = (sql, ...binds) => d1.raw.prepare(sql).all(...binds);
const one = (sql, ...binds) => rows(sql, ...binds)[0];
const seenAt = (id) => (one("SELECT at FROM account_seen WHERE id = ?", id) || { at: null }).at;
const named = (needle) => d1.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'rate_limits'").all().filter((t) => JSON.stringify(d1.raw.prepare(`SELECT * FROM ${t.name}`).all()).includes(needle)).map((t) => t.name);
const cookieFor = (id) => seal(baseEnv, { id, provider: "google", name: "Web", email: "", avatar: "" }, 30 * 86400);
const phone = async (sub) => (await app("POST", "/api/app/auth/google", undefined, { body: { sub } })).body;
const guest = async () => (await app("POST", "/api/app/auth/guest", undefined, { body: {} })).body;
const DEV = { env: { ...baseEnv, DEV_BILLING: "1" }, host: LOCAL };

/* ───────────── only the holder of the secret ───────────── */
{
  eq("the housekeeping answers its secret, and nothing else", [(await cron("task=expired")).status, (await hit("POST", "/api/cron/retention?task=expired")).status, (await cron("task=expired", { token: `${SECRET}x` })).status, (await cron("task=expired", { token: SECRET.slice(0, -1) })).status,
    (await hit("POST", "/api/cron/retention?task=inactive", { cookie: await cookieFor("google:admin"), from: SITE })).status, (await app("POST", "/api/cron/retention?task=inactive", (await phone("9500000")).token)).status, (await cron("task=nope")).status, (await cron("")).status], [200, 401, 401, 401, 401, 401, 400, 400]);
  eq("without a secret of 32 characters it does not exist for anybody", [(await cron("task=expired", { env: { ...baseEnv, CRON_SECRET: undefined } })).status, (await cron("task=expired", { env: { ...baseEnv, CRON_SECRET: "short" }, token: "short" })).status, (await cron("task=inactive", { env: { ...baseEnv, CRON_SECRET: "" }, token: "" })).status], [503, 503, 503]);
}

/* ───────────── an account that is used is seen ───────────── */
{
  const W = "google:9510001", cookie = await cookieFor(W);
  eq("a signed-in visit to the site notes the account; a visit without a session notes nobody", [(await hit("GET", "/api/auth/session", { cookie })).body.user.id, seenAt(W), (await hit("GET", "/api/auth/session")).body.user, one("SELECT COUNT(*) AS n FROM account_seen WHERE id NOT LIKE 'google:95%'").n], [W, NOW, null, 0]);
  const first = NOW;
  NOW += 6 * 3600 * 1000; await hit("GET", "/api/auth/session", { cookie });
  const sameDay = seenAt(W);
  NOW += 20 * 3600 * 1000; await hit("GET", "/api/auth/session", { cookie });
  eq("…once a day", [sameDay, seenAt(W)], [first, NOW]);
  const p = await phone("9510002"), g = await guest();
  await app("GET", "/api/app/wallet", p.token); await app("GET", "/api/app/wallet", g.token);
  eq("any call of the app notes its account, a guest's too", [seenAt("google:9510002"), seenAt(g.account.id)], [NOW, NOW]);
  const shared = await phone("9510003");
  d1.raw.prepare("DELETE FROM account_seen WHERE id = 'google:9510003'").run();
  await app("GET", "/api/progress", shared.token);
  eq("…also on the endpoints it shares with the site", seenAt("google:9510003"), NOW);
  await app("POST", "/api/app/auth/logout", shared.token);
  d1.raw.prepare("DELETE FROM account_seen WHERE id = 'google:9510003'").run();
  await app("GET", "/api/progress", shared.token); await app("GET", "/api/app/wallet", `${shared.token}x`);
  eq("a token that is refused notes nobody", seenAt("google:9510003"), null);
}

/* ───────────── rows past their date ───────────── */
{
  const t0 = NOW, ago = (days) => t0 - days * DAY, A = "google:9520001", p = await phone("9520001"), p2 = await phone("9520001");
  await app("POST", "/api/app/auth/logout", p2.token);
  d1.raw.prepare("UPDATE devices SET revoked_at = ? WHERE id = ?").run(ago(31), p2.device);
  const p3 = await phone("9520001");
  await app("POST", "/api/app/auth/logout", p3.token); // signed out today
  const put = (sql, ...b) => d1.raw.prepare(sql).run(...b);
  for (const [tag, days] of [["old", 31], ["new", 29]]) {
    put("INSERT INTO errors (at, route, build, message, stack, kind) VALUES (?, '', '', ?, '', 'error')", Math.floor(ago(days) / 1000), tag);
    put("INSERT INTO ad_tickets (id, account_id, placement, created) VALUES (?, ?, 'coins', ?)", `t-${tag}`, A, ago(days));
  }
  for (const [tag, days] of [["old", 91], ["new", 89]]) {
    put("INSERT INTO flags (account_id, kind, detail, at) VALUES (?, ?, '{}', ?)", A, tag, ago(days));
    put("INSERT INTO ad_rewards (transaction_id, account_id, ticket_id, verified, day, at, op) VALUES (?, ?, 't', 'dev', '2026-01-01', ?, ?)", `r-${tag}`, A, ago(days), tag);
    put("INSERT INTO shop_refreshes (account_id, day, shelf, item_id, how, at, op) VALUES (?, '2026-01-01', 'avatar:common', ?, 'free', ?, ?)", A, tag, ago(days), tag);
  }
  // the 1v1 (migration 0008): a wait nobody came back to goes after a day, an invitation 30 days after it ran out
  for (const [tag, days] of [["old", 1.1], ["new", 0.9]]) put("INSERT INTO duel_queue (account_id, rating, joined, seen) VALUES (?, 1000, ?, ?)", `google:wait-${tag}`, ago(days), ago(days));
  for (const [tag, days] of [["old", 31], ["new", 29]]) put("INSERT INTO duel_invites (id, account_id, to_account, created, expires) VALUES (?, ?, ?, ?, ?)", `inv-${tag}`, A, `google:other-${tag}`, ago(days + 1), ago(days));
  const duelLeft = () => [rows("SELECT account_id FROM duel_queue ORDER BY account_id").map((r) => r.account_id), rows("SELECT id FROM duel_invites ORDER BY id").map((r) => r.id)];
  const years = (y) => t0 - y * 365.25 * DAY;
  for (const [tag, y] of [["old", KEPT_YEARS + 0.1], ["new", KEPT_YEARS - 0.1]]) {
    put("INSERT INTO purchases (token_hash, account_id, sku, state, verified_at, op) VALUES (?, 'erased', 'coins_100', 'purchased', ?, ?)", `h-${tag}`, years(y), `e-${tag}`);
    put("INSERT INTO purchases (token_hash, account_id, sku, state, verified_at, op) VALUES (?, ?, 'coins_100', 'purchased', ?, ?)", `live-${tag}`, A, years(y), `l-${tag}`);
    put("INSERT INTO kept_ledger (seq, currency, delta, reason, ref, at, erased_at) VALUES (?, 'coin', 100, 'iap', ?, ?, ?)", y > KEPT_YEARS ? 900001 : 900002, `h-${tag}`, years(y), t0);
  }
  const left = () => [rows("SELECT message FROM errors ORDER BY id").map((r) => r.message), rows("SELECT id FROM ad_tickets WHERE id LIKE 't-%' ORDER BY id").map((r) => r.id), rows("SELECT kind FROM flags WHERE account_id = ? ORDER BY id", A).map((r) => r.kind), rows("SELECT transaction_id FROM ad_rewards WHERE account_id = ?", A).map((r) => r.transaction_id), rows("SELECT item_id FROM shop_refreshes WHERE account_id = ?", A).map((r) => r.item_id),
    rows("SELECT id FROM devices WHERE account_id = ? ORDER BY created, id", A).length, rows("SELECT token_hash FROM purchases WHERE token_hash LIKE 'h-%' OR token_hash LIKE 'live-%' ORDER BY token_hash").map((r) => r.token_hash), rows("SELECT ref FROM kept_ledger WHERE seq >= 900000").map((r) => r.ref)];
  const before = left(), dry = await cron("task=expired&dry=1");
  eq("a dry run counts what is due and deletes nothing", [dry.body.deleted, left()], [{ errors: 1, devices: 1, ad_tickets: 1, ad_rewards: 1, flags: 1, shop_refreshes: 1, duel_queue: 1, duel_invites: 1, kept_ledger: 1, purchases: 1 }, before]);
  const duelBefore = duelLeft();
  const run = await cron("task=expired");
  eq("a 1v1 wait goes after a day, a friendly invitation 30 days after it ran out", [duelBefore, duelLeft(), (await cron("task=duels")).body, (await cron("task=duels&dry=1")).body],
    [[["google:wait-new", "google:wait-old"], ["inv-new", "inv-old"]], [["google:wait-new"], ["inv-new"]], { ok: true, task: "duels", dry: false, due: 0, closed: 0 }, { ok: true, task: "duels", dry: true, due: 0, closed: 0 }]);
  eq("error reports and ad tickets go after 30 days, ad views, anti-cheat signals and Shop swaps after 90, a signed-out phone after 30, the purchase records of deleted accounts after 10 years", [run.body.deleted, left()],
    [{ errors: 1, devices: 1, ad_tickets: 1, ad_rewards: 1, flags: 1, shop_refreshes: 1, duel_queue: 1, duel_invites: 1, kept_ledger: 1, purchases: 1 }, [["new"], ["t-new"], ["new"], ["r-new"], ["new"], 2, ["h-new", "live-new", "live-old"], ["h-new"]]]);
  eq("…a living account's own purchases never, its signed-in phone neither, and nothing twice", [(await cron("task=expired")).body.deleted, await (async () => (await app("GET", "/api/app/wallet", p.token)).status)()], [{ errors: 0, devices: 0, ad_tickets: 0, ad_rewards: 0, flags: 0, shop_refreshes: 0, duel_queue: 0, duel_invites: 0, kept_ledger: 0, purchases: 0 }, 200]);
}

/* ───────────── accounts that predate the "seen" table get their date ───────────── */
{
  d1.raw.prepare("DELETE FROM account_seen").run();
  kv.set("user:google:9530001", JSON.stringify({ username: "Dormant_1" })); kv.set("progress:google:9530001", "{}"); kv.set("progress:github:9530002", "{}"); kv.set("user:google:9530003", "{}"); kv.set("user:google:9530004", "{}"); kv.set("user:google:9530005", "{}");
  d1.raw.prepare("INSERT INTO players (id, codename, updated) VALUES ('google:9530006', 'Ranked', 0)").run();
  d1.raw.prepare("UPDATE accounts SET created = ?, last_sync = ? WHERE id = 'google:9510002'").run(NOW - 400 * DAY, NOW - 300 * DAY);
  d1.raw.prepare("UPDATE devices SET last_seen = ? WHERE account_id = 'google:9510002'").run(NOW - 200 * DAY);
  const merged = (await guest()).account.id;
  d1.raw.prepare("DELETE FROM account_seen").run();
  d1.raw.prepare("UPDATE accounts SET merged_into = 'google:9510002', merge_op = 'm1' WHERE id = ?").run(merged);
  eq("a dry run adds nothing", [(await cron("task=backfill&dry=1")).body.skipped, one("SELECT COUNT(*) AS n FROM account_seen").n], [true, 0]);
  const fill = await cron("task=backfill");
  eq("an app account gets its own last activity, an account only the site knows gets today (its 12 months start now)", [fill.body.truncated, seenAt("google:9510002"), seenAt("google:9530001"), seenAt("github:9530002"), seenAt("google:9530005"), seenAt("google:9530006"), seenAt(merged), one("SELECT COUNT(*) AS n FROM account_seen WHERE id LIKE 'anon:%' OR id = ''").n],
    [false, NOW - 200 * DAY, NOW, NOW, NOW, NOW, null, 0]);
  const count = one("SELECT COUNT(*) AS n FROM account_seen").n;
  NOW += DAY;
  eq("…once: a second run moves no date", [(await cron("task=backfill")).body.app + (await cron("task=backfill")).body.site, one("SELECT COUNT(*) AS n FROM account_seen").n, seenAt("google:9530001")], [0, count, NOW - DAY]);
}

/* ───────────── not seen for 12 months: deleted, whole; anything less: kept ───────────── */
{
  d1.raw.prepare("DELETE FROM account_seen").run();
  const start = NOW, A = "google:9540001", K = "google:9540002", S = "google:9540003", B = "google:9540004";
  // A: plays in the app and on the site, buys a membership, publishes nothing; then stops
  const a = await phone("9540001"), k = await phone("9540002"), b = await phone("9540004"), g = await guest(), G = g.account.id;
  await app("GET", "/api/app/wallet", g.token);
  await app("POST", "/api/app/billing/verify", a.token, { ...DEV, body: { sku: "member", purchaseToken: "dev.member.inactive-0001" } });
  await app("PUT", "/api/progress", a.token, { body: { progress: { v: 1 } } }); await app("PUT", "/api/username", a.token, { body: { name: "Sleeper_1" } });
  await hit("PUT", "/api/ranking", { cookie: await cookieFor(A), from: SITE, body: { entries: [] } });
  await hit("GET", "/api/auth/session", { cookie: await cookieFor(S) }); kv.set(`progress:${S}`, "{}");
  d1.raw.prepare("UPDATE accounts SET banned = 1 WHERE id = ?").run(B);
  await app("GET", "/api/app/wallet", b.token);
  eq("(five accounts, all seen today)", [A, K, S, B, G].map(seenAt), [start, start, start, start, start]);

  NOW = start + (INACTIVE_DAYS - 1) * DAY;
  await app("GET", "/api/app/wallet", k.token); // K comes back the day before
  eq("one day short of 12 months nobody is due", [(await cron("task=inactive&dry=1")).body.due, (await cron("task=inactive&limit=25")).body, named(A).length > 5], [0, { ok: true, task: "inactive", dry: false, erased: 0, corrected: 0, more: false }, true]);

  NOW = start + (INACTIVE_DAYS + 1) * DAY;
  // S has an old row but the ranking saw it since (a row that was not noted): corrected, never deleted on a stale row
  d1.raw.prepare("INSERT INTO players (id, codename, updated) VALUES (?, 'Still_Here', ?)").run(S, NOW - 10 * DAY);
  eq("after 12 months a dry run says how many are due and touches nothing", [(await cron("task=inactive&dry=1")).body.due, seenAt(A), named(A).length > 5], [4, start, true]);
  const first = await cron("task=inactive");
  eq("one account per call unless asked for more, the oldest first", [first.body.erased + first.body.corrected, first.body.more], [1, true]);
  const rest = await cron("task=inactive&limit=25");
  eq("…then the rest: three deleted in all, the one that was in fact seen is kept and its date corrected", [first.body.erased + rest.body.erased, first.body.corrected + rest.body.corrected, rest.body.more, seenAt(S), kv.has(`progress:${S}`), one("SELECT COUNT(*) AS n FROM players WHERE id = ?", S).n], [3, 1, false, NOW - 10 * DAY, true, 1]);
  eq("the inactive account is gone whole, on both sides, like one its owner deleted", [named(A), named(G), named(B), [...kv.keys()].filter((key) => key.includes(A) || key.includes(G)).sort(), kv.has("name:sleeper_1"), (await app("GET", "/api/app/wallet", a.token)).status, (await app("POST", "/api/app/auth/refresh", g.token, { body: {} })).status], [[], [], [], [`gone:${A}`, `gone:${G}`], false, 401, 401]);
  eq("…with the same things kept: its purchase without the account, and the ban", [one("SELECT account_id, owner_hash IS NOT NULL AS restorable FROM purchases WHERE sku = 'member' AND op NOT LIKE '_-%'"), one("SELECT COUNT(*) AS n FROM kept_bans").n], [{ account_id: "erased", restorable: 1 }, 1]);
  eq("the account that came back the day before is untouched", [seenAt(K), (await app("GET", "/api/app/wallet", k.token)).status, named(K).length > 3], [start + (INACTIVE_DAYS - 1) * DAY, 200, true]);
  eq("nothing is due any more", [(await cron("task=inactive&limit=25")).body.erased, (await cron("task=inactive&dry=1")).body.due], [0, 0]);
  await new Promise((r) => setTimeout(r, 5));
  const back = await phone("9540001");
  const restored = await app("POST", "/api/app/billing/verify", back.token, { ...DEV, body: { sku: "member", purchaseToken: "dev.member.inactive-0001" } });
  eq("a player who returns after that starts a new account, and has the membership back", [back.account.id, (await app("GET", "/api/app/wallet", back.token)).body.state.coins, restored.body.restored, restored.body.state.entitlements, seenAt(A)], [A, 0, true, ["member", "remove_ads"], NOW]);
  eq("a banned sign-in that was deleted as inactive is still banned", (await app("POST", "/api/app/auth/google", undefined, { body: { sub: "9540004" } })).status, 403);
}

console.log(`${n} checks, ${bad.length} failed`);
bad.forEach((b) => console.log("  FAIL " + b));
process.exit(bad.length ? 1 : 0);
