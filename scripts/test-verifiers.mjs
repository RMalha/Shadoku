// The real verifiers (functions/_lib/app/play.js, admob.js, integrity.js over google.js), tested in plain node:   npm run test:verifiers
// The real endpoint handlers on the production host, a SQLite database with the real migrations/, and Google played by the
// fixtures of scripts/fixtures/verifiers/ (README.md there says what each one is and which are recordings). No network.
// What is checked, above all: with nothing configured nothing is granted and Google is never asked; a purchase, a callback or a
// notification is believed only when Google says so, for OUR app, product, ad unit and account; each pays or is taken back
// once; and a Play Integrity verdict is kept and flagged but never refuses anything (observe mode).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openD1 } from "./lib/d1-sqlite.mjs";
import { sha256b64u } from "../functions/_lib/auth.js";
import { sealAppToken } from "../functions/_lib/app/context.js";
import { accountHash } from "../functions/_lib/app/billing.js";
import { integrityHash } from "../functions/_lib/app/integrity.js";
import { derToRaw, adUnits, SSV_KEYS_URL, SSV_KEYS_KV } from "../functions/_lib/app/admob.js";
import { PLAY_PACKAGE } from "../functions/_lib/app/google.js";
import { AD_CLAIM_WAIT_MS } from "../functions/_lib/app/economy.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(ROOT, "scripts", "fixtures", "verifiers");
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), "utf8"));
const HOUR = 3600 * 1000, SITE = "https://www.shadoku.net";
const enc = new TextEncoder();

let n = 0; const bad = [];
const ok = (what, cond) => { n++; if (!cond) bad.push(what); };
const eq = (what, got, want) => ok(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`, JSON.stringify(got) === JSON.stringify(want));
{ const { warn } = console; console.warn = (...a) => { if (!/"at":"google"/.test(String(a[0]))) warn(...a); }; const { log } = console; console.log = (...a) => { if (!/"at":"retention"/.test(String(a[0]))) log(...a); }; }

/* ───────────── keys made for this run (nothing secret is kept in the repository) ───────────── */
const b64 = (buf) => Buffer.from(buf).toString("base64"), b64u = (buf) => Buffer.from(buf).toString("base64url");
const RSA = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
// the service account, as the JSON key file Google Cloud downloads
const sa = await crypto.subtle.generateKey(RSA, true, ["sign", "verify"]);
const SA_EMAIL = "shadoku-play@shadoku-test.iam.gserviceaccount.com";
const SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account", project_id: "shadoku-test", private_key_id: "k1", client_email: SA_EMAIL, token_uri: "https://oauth2.googleapis.com/token",
  private_key: `-----BEGIN PRIVATE KEY-----\n${b64(await crypto.subtle.exportKey("pkcs8", sa.privateKey)).match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`,
});
// "Google", signing the token Pub/Sub puts on a notification
const google = await crypto.subtle.generateKey(RSA, true, ["sign", "verify"]), stranger = await crypto.subtle.generateKey(RSA, true, ["sign", "verify"]);
const GOOGLE_JWK = { ...(await crypto.subtle.exportKey("jwk", google.publicKey)), kid: "g1" };
const jwt = async (claims, key = google.privateKey, kid = "g1") => {
  const body = `${b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid }))}.${b64u(JSON.stringify(claims))}`;
  return `${body}.${b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(body)))}`;
};
// an ad network key of our own, for callbacks the recorded one cannot show (AdMob signs in DER; WebCrypto signs r || s)
const adKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const AD_KEY_ID = 990000777;
const derInt = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; let v = b.subarray(i); if (v[0] & 0x80) v = Uint8Array.from([0, ...v]); return [0x02, v.length, ...v]; };
const rawToDer = (raw) => { const r = derInt(raw.subarray(0, 32)), s = derInt(raw.subarray(32)); return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]); };
const signedCallback = async (params) => {
  const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, adKey.privateKey, enc.encode(query)));
  return `?${query}&signature=${b64u(rawToDer(raw))}&key_id=${AD_KEY_ID}`;
};

/* ───────────── Google, played by the fixtures ───────────── */
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PLAY = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PACKAGE}/purchases`;
const DECODE = `https://playintegrity.googleapis.com/v1/${PLAY_PACKAGE}:decodeIntegrityToken`;
const G = {
  calls: [], // every request the server made to Google: { method, url, body, auth }
  tokens: [], // every access token it was given: { scope, claims, signed }
  fail: [], // answers to give first: { match: RegExp (on "METHOD url"), status, then?: () => void }
  products: new Map(), subscriptions: new Map(), // purchase token → the purchase, as Play would answer
  misfiled: new Map(), // purchase token → a product id Play wrongly answers it under (it never should: the answer's own id is compared all the same)
  voided: { "": fixture("play-voided.json") }, // page token → a page of the voided-purchases list
  verdicts: new Map(), // integrity token → the decoded payload
  keys: fixture("ssv-keys.json"), keysDown: false,
  pauses: [],
};
const answer = (status, body = null) => new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
async function googleFetch(url, init = {}) {
  url = String(url);
  const call = { method: init.method || "GET", url, body: init.body === undefined ? null : String(init.body), auth: (init.headers && init.headers.Authorization) || "" };
  G.calls.push(call);
  if (url === SSV_KEYS_URL) return G.keysDown ? answer(503) : answer(200, G.keys);
  if (url === TOKEN_URL) { // a service-account JWT, exchanged for an access token
    const form = new URLSearchParams(call.body), [h, p, s] = String(form.get("assertion")).split(".");
    const claims = JSON.parse(Buffer.from(p, "base64url").toString()), header = JSON.parse(Buffer.from(h, "base64url").toString());
    const signed = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", sa.publicKey, Buffer.from(s, "base64url"), enc.encode(`${h}.${p}`));
    if (!signed || form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer") return answer(400, { error: "invalid_grant" });
    G.tokens.push({ scope: claims.scope, claims, header, signed, token: `ya29.test-token-${G.tokens.length + 1}` });
    return answer(200, { access_token: G.tokens.at(-1).token, expires_in: 3600, token_type: "Bearer" });
  }
  const i = G.fail.findIndex((f) => f.match.test(`${call.method} ${url}`));
  if (i >= 0) { const f = G.fail.splice(i, 1)[0]; if (f.then) f.then(); return answer(f.status, { error: { code: 0, message: "injected" } }); }
  // an access token we issued, of the scope this API wants
  const held = G.tokens.find((t) => call.auth === `Bearer ${t.token}`);
  if (!held || !new URL(url).host.startsWith(`${held.scope.split("/").pop()}.`)) return answer(401, { error: { message: "no token for this" } });
  if (url === DECODE) {
    const payload = G.verdicts.get(JSON.parse(call.body).integrity_token);
    return payload ? answer(200, { tokenPayloadExternal: payload }) : answer(400, { error: { message: "Integrity token cannot be decrypted" } });
  }
  let m;
  if ((m = /\/products\/([^/]+)\/tokens\/([^/:]+)(:consume|:acknowledge)?$/.exec(url.slice(PLAY.length)))) {
    const p = G.products.get(decodeURIComponent(m[2]));
    if (!p || (p.productId !== decodeURIComponent(m[1]) && G.misfiled.get(p.purchaseToken) !== decodeURIComponent(m[1]))) return answer(404, { error: { message: "The purchase token was not found." } });
    if (!m[3]) return call.method === "GET" ? answer(200, p) : answer(405);
    if (call.method !== "POST") return answer(405);
    if (m[3] === ":consume") { if (p.consumptionState === 1) return answer(400, { error: { message: "already consumed" } }); p.consumptionState = 1; p.acknowledgementState = 1; } else p.acknowledgementState = 1;
    return answer(200);
  }
  if ((m = /\/subscriptionsv2\/tokens\/([^/:]+)$/.exec(url.slice(PLAY.length)))) return G.subscriptions.has(decodeURIComponent(m[1])) ? answer(200, G.subscriptions.get(decodeURIComponent(m[1]))) : answer(404);
  if ((m = /\/subscriptions\/([^/]+)\/tokens\/([^/:]+):acknowledge$/.exec(url.slice(PLAY.length)))) {
    const s = G.subscriptions.get(decodeURIComponent(m[2]));
    if (!s) return answer(404);
    s.acknowledgementState = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
    return answer(200);
  }
  if (url.startsWith(`${PLAY}/voidedpurchases?`)) { const page = G.voided[new URL(url).searchParams.get("token") || ""]; return page ? answer(200, page) : answer(400); }
  return answer(404);
}
const asked = (re) => G.calls.filter((c) => re.test(`${c.method} ${c.url}`));
const since = (mark) => G.calls.slice(mark).map((c) => `${c.method} ${c.url.replace(PLAY, "").replace(/\?.*$/, "")}`);

/* ───────────── harness ───────────── */
const d1 = openD1(path.join(ROOT, "migrations"));
let NOW = Date.UTC(2026, 10, 16, 12);
const kv = new Map(), kvTtl = new Map();
const KV = { get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v, opt = {}) => { kv.set(k, String(v)); kvTtl.set(k, opt.expirationTtl); }, delete: async (k) => { kv.delete(k); } };
const CRON = "cron-secret-".repeat(4), RTDN_EMAIL = "play-rtdn-push@shadoku-test.iam.gserviceaccount.com";
const BARE = { SHADOKU_DB: d1, SHADOKU_KV: KV, SESSION_SECRET: "test-secret-".repeat(4), NOW: () => NOW, CRON_SECRET: CRON, GOOGLE_FETCH: googleFetch, GOOGLE_PAUSE: async (ms) => { G.pauses.push(ms); }, GOOGLE_CERTS: async () => ({ keys: [GOOGLE_JWK] }) };
const WITH_PLAY = { ...BARE, PLAY_SERVICE_ACCOUNT: SERVICE_ACCOUNT, PLAY_RTDN_EMAIL: RTDN_EMAIL, PLAY_SUBSCRIPTIONS: "member_sub" };
const AD_UNIT = "2747237135";
const LIVE = { ...WITH_PLAY, ADMOB_AD_UNITS: `ca-app-pub-0000000000000000/${AD_UNIT}` };

const FILES = { "/api/app/ads/ticket": "app/ads/ticket/index.js", "/api/cron/retention": "cron/retention.js" };
const tokens = new Map();
const tokenFor = async (id) => { if (!tokens.has(id)) tokens.set(id, await sealAppToken(BARE, { id })); return tokens.get(id); };
/** Calls an endpoint. `as`: an account id (a token without a device is made for it); `token`: a bearer token as it is. → { status, body } */
async function hit(method, where, { as, token, body, env = LIVE, host = SITE } = {}) {
  const url = new URL(host + where);
  const file = FILES[url.pathname] || `${url.pathname.slice("/api/".length)}.js`;
  const handler = (await import(pathToFileURL(path.join(ROOT, "functions", "api", file)).href))[`onRequest${method[0]}${method.slice(1).toLowerCase()}`];
  const h = new Headers({ "CF-Connecting-IP": "10.9.0.1" });
  if (as) h.set("Authorization", `Bearer ${await tokenFor(as)}`);
  if (token) h.set("Authorization", `Bearer ${token}`);
  const request = new Request(url, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const res = await handler({ request, env, params: {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const rows = (sql, ...binds) => d1.raw.prepare(sql).all(...binds);
const one = (sql, ...binds) => rows(sql, ...binds)[0];
const lines = (id, reason) => rows("SELECT currency, delta FROM ledger WHERE account_id = ? AND reason = ? ORDER BY seq", id, reason).map((l) => `${l.currency}:${l.delta}`).join();
const flagsOf = (id) => rows("SELECT detail FROM flags WHERE account_id = ? AND kind = 'integrity' ORDER BY id", id).map((f) => JSON.parse(f.detail));
const guest = async () => (await hit("POST", "/api/app/auth/guest", { body: {} })).body;
const ticketOf = async (who, placement = "hint") => (await hit("POST", "/api/app/ads/ticket", { ...who, body: { placement } })).body.ticket;
d1.raw.prepare("INSERT INTO items (id, kind, sku, data) VALUES ('member_sub', 'upgrade', 'member_sub', '{\"entitlements\":[\"remove_ads\",\"member\"]}')").run();
d1.raw.prepare("INSERT INTO app_config (k, v) VALUES ('ad_client_claims_per_day', '50')").run(); // (its own limit is tested at the end)

const A = "google:8800001", B = "google:8800002"; // A: the account the recorded fixtures were bought and watched by
const PRODUCT = fixture("play-product.json"), TOKEN = PRODUCT.purchaseToken;
eq("the purchase fixture carries account A's hash, as the app would have passed it to Play", PRODUCT.obfuscatedExternalAccountId, await accountHash(A));
let serial = 0;
/** A purchase at "Play": the fixture, changed. → its token */
const bought = (change = {}, token = `fixture.variant.${++serial}.AO-J1Oz${"v".repeat(40)}`) => { G.products.set(token, { ...structuredClone(PRODUCT), purchaseToken: token, orderId: `GPA.0000-0000-0000-${String(serial).padStart(5, "0")}`, ...change }); return token; };
const rowOf = async (token) => one("SELECT account_id, consumed, state FROM purchases WHERE token_hash = ?", await sha256b64u(token)) || null;
const verify = (as, sku, purchaseToken, env = LIVE) => hit("POST", "/api/app/billing/verify", { as, body: { sku, purchaseToken }, env });

/* ───────────── nothing configured: nothing is granted, and Google is never asked ───────────── */
{
  const g = await guest(), who = { token: g.token };
  const t = await ticketOf(who);
  NOW += AD_CLAIM_WAIT_MS;
  eq("without settings every door is shut (503)", [
    (await verify(A, "coins_500", TOKEN, BARE)).body, (await hit("POST", "/api/app/billing/rtdn", { body: {}, env: BARE })).body, (await hit("GET", "/api/app/ads/ssv?x=1&signature=a&key_id=1", { env: BARE })).body,
    (await hit("POST", "/api/app/ads/claim", { ...who, body: { ticket: t, integrity: "x" }, env: BARE })).body, (await hit("POST", "/api/app/integrity", { ...who, body: { token: "x" }, env: BARE })).body,
  ].map((b) => b.error), ["billing_unavailable", "billing_unavailable", "ads_unavailable", "ads_unavailable", "integrity_unavailable"]);
  eq("…and the nightly check of voided purchases has nothing to compare", (await hit("POST", "/api/cron/retention?task=voided", { token: CRON, env: BARE })).body, { ok: true, task: "voided", dry: false, skipped: "billing_unavailable" });
  eq("a secret that is not a service-account key switches nothing on", [(await verify(A, "coins_500", TOKEN, { ...BARE, PLAY_SERVICE_ACCOUNT: "not json" })).status, (await verify(A, "coins_500", TOKEN, { ...BARE, PLAY_SERVICE_ACCOUNT: '{"client_email":"a@b.example"}' })).status,
    (await verify(A, "coins_500", TOKEN, { ...BARE, PLAY_SERVICE_ACCOUNT: JSON.stringify({ client_email: SA_EMAIL, private_key: "secret" }) })).status], [503, 503, 503]);
  eq("ads without the service account: the callback door is open, the fallback claim is not", [(await hit("POST", "/api/app/ads/claim", { ...who, body: { ticket: t, integrity: "x" }, env: { ...BARE, ADMOB_AD_UNITS: AD_UNIT } })).status, one("SELECT paid_at FROM ad_tickets WHERE id = ?", t).paid_at], [503, null]);
  eq("the service account alone opens no ad door", (await hit("GET", "/api/app/ads/ssv?x=1&signature=a&key_id=1", { env: WITH_PLAY })).status, 503);
  eq("a list of ad units that names none is no list", [...adUnits({ ADMOB_AD_UNITS: " , ca-app-pub-1/, abc" })], []);
  eq("nothing was granted and Google was not asked once", [G.calls.length, one("SELECT COUNT(*) AS n FROM purchases").n, one("SELECT COUNT(*) AS n FROM ad_rewards").n], [0, 0, 0]);
}

/* ───────────── a purchase, checked with Google Play ───────────── */
{
  G.products.set(TOKEN, structuredClone(PRODUCT));
  const first = await verify(A, "coins_500", TOKEN);
  eq("a purchase Google confirms is granted and consumed", [first.status, first.body.granted.coins, first.body.finished, lines(A, "iap")], [200, 500, true, "coin:500"]);
  eq("…asked as our package, this product and this token, then consumed", since(0), [`POST ${TOKEN_URL}`, `GET /products/coins_500/tokens/${TOKEN}`, `POST /products/coins_500/tokens/${TOKEN}:consume`]);
  const t = G.tokens[0];
  eq("…with a token from a JWT the service account signed for the Play Developer API", [t.signed, t.header.alg, t.header.kid, t.claims.iss, t.claims.scope, t.claims.aud, t.claims.exp - t.claims.iat, Math.abs(t.claims.iat - Date.now() / 1000) < 60],
    [true, "RS256", "k1", SA_EMAIL, "https://www.googleapis.com/auth/androidpublisher", TOKEN_URL, 3600, true]);
  eq("…sent as a bearer token, and nothing of the key is sent anywhere", [G.calls[1].auth, G.calls.some((c) => JSON.stringify(c).includes("PRIVATE KEY"))], [`Bearer ${t.token}`, false]);
  eq("the row keeps Google's order id and time", one("SELECT order_id, purchased_at, consumed, state FROM purchases WHERE account_id = ?", A), { order_id: PRODUCT.orderId, purchased_at: Number(PRODUCT.purchaseTimeMillis), consumed: 1, state: "purchased" });
  const mark = G.calls.length, again = await verify(A, "coins_500", TOKEN);
  eq("the same token again: a duplicate, paid once, and Google is not asked", [again.body.duplicate, lines(A, "iap"), G.calls.length - mark], [true, "coin:500", 0]);

  const refused = async (what, change, want, as = A) => {
    const token = bought(change), granted = lines(as, "iap");
    if (change.productId) G.misfiled.set(token, "coins_500");
    const r = await verify(as, "coins_500", token);
    eq(what, [r.status, r.body.error, await rowOf(token), lines(as, "iap") === granted, G.products.get(token).consumptionState === (change.consumptionState ?? 0)], [...want, null, true, true]);
  };
  await refused("bought by another account (the hash Play holds is not the caller's): refused, nothing consumed", {}, [403, "wrong_account"], B);
  await refused("bought with no account hash at all: refused", { obfuscatedExternalAccountId: undefined }, [403, "wrong_account"]);
  await refused("a payment still pending: nothing yet", { purchaseState: 2 }, [409, "pending"]);
  await refused("a cancelled purchase", { purchaseState: 1 }, [400, "invalid"]);
  await refused("an answer that names another product than the one asked for", { productId: "coins_2500" }, [400, "invalid"]);
  await refused("a token already consumed that this server never granted", { consumptionState: 1 }, [400, "invalid"]);
  await refused("a quantity of two", { quantity: 2 }, [400, "invalid"]);
  eq("a token Google does not know (or of another app or product: 404)", [(await verify(A, "coins_500", "made.up.token.0001")).body.error, (await verify(A, "coins_100", bought())).body.error], ["invalid", "invalid"]);
  eq("a token with characters of its own is asked for whole, escaped", [(await verify(A, "coins_500", "a/b?c=d&e#f:consume 0001")).status, G.calls.at(-1).url.slice(PLAY.length)], [400, "/products/coins_500/tokens/a%2Fb%3Fc%3Dd%26e%23f%3Aconsume%200001"]);

  // Google is unwell
  G.fail.push({ match: /^GET .*\/products\//, status: 500 }, { match: /^GET .*\/products\//, status: 503 }, { match: /^GET .*\/products\//, status: 500 });
  G.pauses.length = 0;
  const down = await verify(A, "coins_500", bought());
  eq("Google down: tried three times with a pause between, then 502 and nothing granted", [down.status, down.body.error, G.pauses, lines(A, "iap")], [502, "upstream", [150, 450], "coin:500"]);
  G.fail.push({ match: /^GET .*\/products\//, status: 500 });
  eq("…down once: the second try is the answer", (await verify(A, "coins_500", bought())).status, 200);
  G.fail.push({ match: /^GET .*\/products\//, status: 403 });
  eq("our service account refused (403): not the player's fault, 502", (await verify(A, "coins_500", bought())).body.error, "upstream");
  G.fail.push({ match: /^GET .*\/products\//, status: 401 });
  const tokensBefore = G.tokens.length, renewed = await verify(A, "coins_500", bought());
  eq("an access token Google dropped early (401) is replaced once and the call repeated", [renewed.status, G.tokens.length - tokensBefore], [200, 1]);

  // consume or acknowledge, until it succeeds
  const slow = bought();
  G.fail.push({ match: /:consume$/, status: 500 }, { match: /:consume$/, status: 500 }, { match: /:consume$/, status: 500 });
  const before = lines(A, "iap"), unfinished = await verify(A, "coins_500", slow);
  eq("granted, but Google could not be told (consume failed three times): finished false, the row waits", [unfinished.status, unfinished.body.finished, (await rowOf(slow)).consumed, G.products.get(slow).consumptionState], [200, false, 0, 0]);
  const resent = await verify(A, "coins_500", slow);
  eq("the phone sends it again on its next launch: a duplicate, paid once, and now consumed", [resent.body.duplicate, lines(A, "iap") === `${before},coin:500`, G.products.get(slow).consumptionState, rows("SELECT consumed FROM purchases WHERE account_id = ? AND consumed = 0", A).length], [true, true, 1, 0]);
  const lost = bought();
  G.fail.push({ match: /:consume$/, status: 500 }, { match: /:consume$/, status: 500 });
  eq("a consume whose answer was lost twice still counts once it went through", (await verify(A, "coins_500", lost)).body.finished, true);
  // Google refuses the consume, yet the purchase IS consumed (an earlier try arrived and its answer never came back)
  const arrived = bought(), m2 = G.calls.length;
  G.fail.push({ match: /:consume$/, status: 400, then: () => { G.products.get(arrived).consumptionState = 1; } });
  const r2 = await verify(A, "coins_500", arrived);
  eq("a consume Google refuses is followed by a look at the purchase: consumed after all counts as done", [r2.body.finished, since(m2).map((c) => c.split(" ")[0] + c.slice(c.lastIndexOf(":") < 12 ? c.length : c.lastIndexOf(":"))), (await rowOf(arrived)).consumed], [true, ["GET", "POST:consume", "GET"], 1]);
  const stuck = bought();
  G.fail.push({ match: /:consume$/, status: 400 });
  eq("…and one that is refused and not consumed is not done", [(await verify(A, "coins_500", stuck)).body.finished, (await rowOf(stuck)).consumed], [false, 0]);

  const upgrade = bought({ productId: "remove_ads" }), m3 = G.calls.length, up = await verify(A, "remove_ads", upgrade);
  eq("an upgrade is acknowledged, never consumed", [up.status, up.body.granted.entitlements, up.body.finished, since(m3), G.calls.at(-1).body, G.products.get(upgrade).consumptionState, G.products.get(upgrade).acknowledgementState],
    [200, ["remove_ads"], true, [`GET /products/remove_ads/tokens/${upgrade}`, `POST /products/remove_ads/tokens/${upgrade}:acknowledge`], "{}", 0, 1]);
  const acked = bought({ productId: "remove_ads", obfuscatedExternalAccountId: await accountHash(B) });
  G.fail.push({ match: /:acknowledge$/, status: 400, then: () => { G.products.get(acked).acknowledgementState = 1; } });
  eq("an acknowledge Google refuses because an earlier try arrived counts as done", (await verify(B, "remove_ads", acked)).body.finished, true);
}

/* ───────────── a membership sold as a subscription (PLAY_SUBSCRIPTIONS) ───────────── */
{
  const SUB = fixture("play-subscription.json");
  const subscribed = (change = {}, token = `fixture.sub.${++serial}.AO-J1Oz${"s".repeat(40)}`) => { G.subscriptions.set(token, { ...structuredClone(SUB), ...change }); return token; };
  const token = subscribed(), mark = G.calls.length, r = await verify(A, "member_sub", token);
  eq("a subscription is read from subscriptionsv2 and acknowledged", [r.status, r.body.granted.entitlements, r.body.finished, since(mark)], [200, ["remove_ads", "member"], true, [`GET /subscriptionsv2/tokens/${token}`, `POST /subscriptions/member_sub/tokens/${token}:acknowledge`]]);
  eq("…its order id is the line's, its time the start", one("SELECT order_id, purchased_at, consumed FROM purchases WHERE sku = 'member_sub'"), { order_id: SUB.lineItems[0].latestSuccessfulOrderId, purchased_at: Date.parse(SUB.startTime), consumed: 1 });
  eq("a subscription that is not owned now, is another account's, another product's or still pending", [
    (await verify(B, "member_sub", subscribed({ subscriptionState: "SUBSCRIPTION_STATE_EXPIRED", externalAccountIdentifiers: { obfuscatedExternalAccountId: await accountHash(B) } }))).body.error,
    (await verify(B, "member_sub", subscribed({ subscriptionState: "SUBSCRIPTION_STATE_ON_HOLD", externalAccountIdentifiers: { obfuscatedExternalAccountId: await accountHash(B) } }))).body.error,
    (await verify(B, "member_sub", subscribed())).body.error, (await verify(B, "member_sub", subscribed({ externalAccountIdentifiers: undefined }))).body.error,
    (await verify(B, "member_sub", subscribed({ lineItems: [{ productId: "other_sub" }], externalAccountIdentifiers: { obfuscatedExternalAccountId: await accountHash(B) } }))).body.error,
    (await verify(B, "member_sub", subscribed({ subscriptionState: "SUBSCRIPTION_STATE_PENDING", externalAccountIdentifiers: { obfuscatedExternalAccountId: await accountHash(B) } }))).body.error,
  ], ["invalid", "invalid", "wrong_account", "wrong_account", "invalid", "pending"]);
  eq("a one-time product is never looked up as a subscription, nor the other way round", [asked(/subscriptionsv2\/tokens\/fixture\.variant/).length, asked(/\/products\/member_sub\//).length], [0, 0]);
  eq("a grace period still owns it", (await verify(B, "member_sub", subscribed({ subscriptionState: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", externalAccountIdentifiers: { obfuscatedExternalAccountId: await accountHash(B) } }))).status, 200);
}

/* ───────────── the nightly check of Google's voided-purchases list ───────────── */
{
  const cron = (query, env = LIVE) => hit("POST", `/api/cron/retention?${query}`, { token: CRON, env });
  const mark = G.calls.length, dry = await cron("task=voided&dry=1");
  eq("dry: the list is read (both kinds of product, a thousand a page), what is due is counted, nothing is taken back", [dry.body, since(mark), G.calls.at(-1).url.split("?")[1], lines(A, "refund")],
    [{ ok: true, task: "voided", dry: true, listed: 2, due: 1, voided: 0, more: false }, ["GET /voidedpurchases"], "type=1&maxResults=1000", ""]);
  const real = await cron("task=voided");
  eq("the purchase Google voided is taken back, once; a token this server never saw and a partial refund are not ours", [real.body, lines(A, "refund"), one("SELECT state, voided_at FROM purchases WHERE order_id = ? AND voided_at IS NOT NULL", PRODUCT.orderId).state],
    [{ ok: true, task: "voided", dry: false, listed: 2, due: 1, voided: 1, more: false }, "coin:-500", "voided"]);
  eq("the night after: nothing is due", [(await cron("task=voided")).body.due, lines(A, "refund")], [0, "coin:-500"]);
  // two pages
  const second = bought(), third = bought();
  await verify(A, "coins_500", second); await verify(A, "coins_500", third);
  G.voided = { "": { voidedPurchases: [{ purchaseToken: second }], tokenPagination: { nextPageToken: "page/2" } }, "page/2": { voidedPurchases: [{ purchaseToken: third }, { purchaseToken: TOKEN }] } };
  const paged = await cron("task=voided");
  eq("a list of several pages is followed to its end", [paged.body.listed, paged.body.voided, G.calls.at(-1).url.split("?")[1], lines(A, "refund")], [3, 2, "type=1&maxResults=1000&token=page%2F2", "coin:-500,coin:-500,coin:-500"]);
  G.fail.push({ match: /voidedpurchases/, status: 500 }, { match: /voidedpurchases/, status: 500 }, { match: /voidedpurchases/, status: 500 });
  eq("Google down: 502, and the Worker tries again tomorrow", (await cron("task=voided")).status, 502);
  eq("only the holder of the cron secret starts it", (await hit("POST", "/api/cron/retention?task=voided", { token: `${CRON}x` })).status, 401);
}

/* ───────────── Real-time Developer Notifications (Pub/Sub push) ───────────── */
{
  const NOTE = fixture("rtdn-voided.json"), HERE = `${SITE}/api/app/billing/rtdn`;
  const claims = (change = {}) => ({ iss: "https://accounts.google.com", aud: HERE, email: RTDN_EMAIL, email_verified: true, sub: "1090", iat: Math.floor(NOW / 1000) - 5, exp: Math.floor(NOW / 1000) + 3600, ...change });
  const push = async (note, token, env = LIVE) => hit("POST", "/api/app/billing/rtdn", { token, env, body: { message: { data: b64(JSON.stringify(note)), messageId: "136969346945" }, subscription: "projects/shadoku-test/subscriptions/play-rtdn" } });
  const fresh = bought(); await verify(A, "coins_500", fresh);
  const note = { ...NOTE, voidedPurchaseNotification: { ...NOTE.voidedPurchaseNotification, purchaseToken: fresh } };
  const before = lines(A, "refund");
  eq("a notification nobody signed, or signed by somebody else, for another address, another sender, an unverified one or out of date: refused", [
    (await push(note)).status, (await push(note, "x".repeat(40))).status, (await push(note, await jwt(claims(), stranger.privateKey))).status, (await push(note, await jwt(claims({ aud: "https://example.com/api/app/billing/rtdn" })))).status,
    (await push(note, await jwt(claims({ email: "somebody@their-project.iam.gserviceaccount.com" })))).status, (await push(note, await jwt(claims({ email_verified: false })))).status,
    (await push(note, await jwt(claims({ exp: Math.floor(NOW / 1000) - 600 })))).status, (await push(note, await jwt(claims({ iss: "https://evil.example" })))).status, lines(A, "refund") === before,
  ], [403, 403, 403, 403, 403, 403, 403, 403, true]);
  eq("without the sender's address set the door is shut", (await push(note, await jwt(claims()), { ...LIVE, PLAY_RTDN_EMAIL: "" })).status, 503);
  const good = await push(note, await jwt(claims()));
  eq("Google's own notification of a refund takes the purchase back, once", [good.status, good.body.results, lines(A, "refund") === `${before},coin:-500`, (await push(note, await jwt(claims()))).body.results], [200, ["voided"], true, ["already"]]);
  eq("the recorded notification names the purchase the nightly check already took back", (await push(NOTE, await jwt(claims()))).body.results, ["already"]);
  eq("a test notification, one about another app, a partial refund and a plain purchase take nothing back", [
    (await push({ version: "1.0", packageName: PLAY_PACKAGE, eventTimeMillis: "1", testNotification: { version: "1.0" } }, await jwt(claims()))).body,
    (await push({ ...note, packageName: "com.example.other" }, await jwt(claims()))).body.results,
    (await push({ ...NOTE, voidedPurchaseNotification: { ...NOTE.voidedPurchaseNotification, purchaseToken: bought(), refundType: 2 } }, await jwt(claims()))).body.results,
    (await push({ version: "1.0", packageName: PLAY_PACKAGE, oneTimeProductNotification: { version: "1.0", notificationType: 1, purchaseToken: fresh, sku: "coins_500" } }, await jwt(claims()))).body.results,
  ], [{ ok: true, results: [] }, [], [], []]);
  const sub = one("SELECT account_id FROM purchases WHERE sku = 'member_sub' AND account_id = ?", A), subToken = [...G.subscriptions.keys()][0];
  const revoked = await push({ version: "1.0", packageName: PLAY_PACKAGE, subscriptionNotification: { version: "1.0", notificationType: 12, purchaseToken: subToken } }, await jwt(claims()));
  eq("a revoked subscription takes its membership back; a renewal does nothing", [!!sub, revoked.body.results, rows("SELECT key FROM entitlements WHERE account_id = ? AND key = 'member'", A).length,
    (await push({ version: "1.0", packageName: PLAY_PACKAGE, subscriptionNotification: { version: "1.0", notificationType: 2, purchaseToken: subToken } }, await jwt(claims()))).body.results], [true, ["voided"], 0, []]);
  eq("a body that is not a notification", (await hit("POST", "/api/app/billing/rtdn", { token: await jwt(claims()), body: "{}" })).status, 403);
}

/* ───────────── AdMob's signed callback ───────────── */
const ssv = (query, env = LIVE) => hit("GET", `/api/app/ads/ssv${query}`, { env });
const ticketRow = (id, account, placement = "coins") => d1.raw.prepare("INSERT INTO ad_tickets (id, account_id, placement, created) VALUES (?, ?, ?, ?)").run(id, account, placement, NOW);
{
  const RECORDED = new URL(fs.readFileSync(path.join(FIX, "ssv-callback.synthetic.txt"), "utf8").trim()), query = RECORDED.search, p = new URLSearchParams(query);
  ticketRow(p.get("custom_data"), p.get("user_id"));
  const mark = G.calls.length, paid = await ssv(query);
  eq("the recorded callback: Google's signature over the query string as received, our ad unit, our ticket: paid", [paid.status, paid.body, lines(A, "ad"), one("SELECT account_id, ticket_id, ad_unit, verified FROM ad_rewards WHERE transaction_id = ?", p.get("transaction_id"))],
    [200, { ok: true, result: "ok" }, "coin:5", { account_id: A, ticket_id: p.get("custom_data"), ad_unit: AD_UNIT, verified: "ssv" }]);
  eq("…with Google's keys read once from their address and kept 24 hours in KV", [since(mark), kvTtl.get(SSV_KEYS_KV), JSON.parse(kv.get(SSV_KEYS_KV)).keys.length], [[`GET ${SSV_KEYS_URL}`], 86400, G.keys.keys.length]);
  const again = await ssv(query);
  eq("the same callback again (Google retries): the transaction id pays once, and the keys are not fetched again", [again.body, lines(A, "ad"), G.calls.length - mark], [{ ok: true, result: "duplicate" }, "coin:5", 1]);

  // the same callback with one parameter changed
  const signedPart = query.slice(1, query.indexOf("&signature=")), tail = query.slice(query.indexOf("&signature="));
  const changed = [];
  for (const name of [...new URLSearchParams(signedPart).keys()]) {
    const other = signedPart.split("&").map((kv) => (kv.startsWith(`${name}=`) ? `${name}=${name === "custom_data" ? "other-ticket-0001" : name === "user_id" ? encodeURIComponent(B) : "7"}` : kv)).join("&");
    changed.push((await ssv(`?${other}${tail}`)).status);
  }
  ticketRow("other-ticket-0001", B);
  eq("the recorded callback with any one parameter changed: refused", changed, Array(8).fill(403));
  const sig = p.get("signature"), flip = sig.slice(0, 40) + (sig[40] === "A" ? "B" : "A") + sig.slice(41);
  eq("…or a parameter added, the parameters in another order, an escape written another way, the signature touched, cut or missing, another key named, something after key_id", [
    (await ssv(`?${signedPart}&bonus=1${tail}`)).status, (await ssv(`?${signedPart.split("&").reverse().join("&")}${tail}`)).status, (await ssv(`?${signedPart.replace("google%3A", "google:")}${tail}`)).status,
    (await ssv(`?${signedPart}&signature=${flip}&key_id=${p.get("key_id")}`)).status, (await ssv(`?${signedPart}&signature=${sig.slice(0, 70)}&key_id=${p.get("key_id")}`)).status, (await ssv(`?${signedPart}&key_id=${p.get("key_id")}`)).status,
    (await ssv(`?${signedPart}&signature=${sig}&key_id=3335741209`)).status, (await ssv(`${query}&user_id=${encodeURIComponent(B)}`)).status, (await ssv("")).status, (await ssv(`?signature=${sig}&key_id=${p.get("key_id")}`)).status,
  ], Array(10).fill(403));
  eq("…and none of it paid anything or anybody else", [lines(A, "ad"), lines(B, "ad"), one("SELECT COUNT(*) AS n FROM ad_rewards").n], ["coin:5", "", 1]);
  const realKey = G.keys.keys.find((k) => k.keyId === 3335741209);
  ok("Google's own key, as published, is a key this code reads", !!(await crypto.subtle.importKey("spki", Buffer.from(realKey.base64, "base64"), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])));
  const REAL = path.join(FIX, "ssv-callback.real.txt");
  if (fs.existsSync(REAL)) { // a callback captured from AdMob (README.md): Google's real signature, checked with Google's real key
    const real = new URL(fs.readFileSync(REAL, "utf8").trim()), unit = new URLSearchParams(real.search).get("ad_unit"), env = { ...LIVE, ADMOB_AD_UNITS: unit };
    const tampered = real.search.replace(/([?&]transaction_id=)[^&]*/, "$10");
    eq("the callback captured from AdMob verifies with Google's real key, and not with one parameter changed", [(await ssv(real.search, env)).status, (await ssv(tampered, env)).status], [200, 403]);
  } else console.log("  (no callback captured from AdMob in scripts/fixtures/verifiers/ssv-callback.real.txt: the synthetic one stands in)");
}
{
  // callbacks signed here, with a key "Google" publishes later (a rotation)
  const cb = (params) => signedCallback({ ad_network: "5450213213286189855", ad_unit: AD_UNIT, reward_amount: "1", reward_item: "Reward", timestamp: String(NOW), transaction_id: crypto.randomUUID().replace(/-/g, ""), ...params });
  ticketRow("rotation-ticket-01", A, "hint");
  const rotated = await cb({ custom_data: "rotation-ticket-01", user_id: A });
  const mark = G.calls.length;
  eq("a key we do not hold: refused, and Google is not asked for its keys again within five minutes", [(await ssv(rotated)).status, (await ssv(rotated)).status, G.calls.length - mark], [403, 403, 0]);
  G.keys = { keys: [...G.keys.keys, { keyId: AD_KEY_ID, pem: "", base64: b64(await crypto.subtle.exportKey("spki", adKey.publicKey)) }] };
  NOW += 5 * 60 * 1000 + 1;
  eq("Google rotated its keys: five minutes on, the list is read again and the callback is paid", [(await ssv(rotated)).body, lines(A, "ad"), G.calls.length - mark], [{ ok: true, result: "ok" }, "coin:5,hint:1", 1]);

  eq("the AdMob console's \"Verify URL\" (signed, no ticket, no player): answered 200, nothing paid", [(await ssv(await cb({}))).body, one("SELECT COUNT(*) AS n FROM ad_rewards").n], [{ ok: true, result: "rejected" }, 2]);
  ticketRow("their-ticket-0001", A, "hint");
  const theirs = await cb({ ad_unit: "9999999999", custom_data: "their-ticket-0001", user_id: A });
  eq("a callback Google signed for SOMEBODY ELSE'S ad unit, pointed at our ticket: refused", [(await ssv(theirs)).status, one("SELECT paid_at FROM ad_tickets WHERE id = 'their-ticket-0001'").paid_at, (await ssv(theirs, { ...LIVE, ADMOB_AD_UNITS: `${AD_UNIT}, 9999999999` })).body.result], [403, null, "ok"]);
  ticketRow("b-ticket-000001", B, "hint");
  eq("a ticket paid to the account the callback names only if it is that account's; a transaction id of a strange shape is refused", [(await ssv(await cb({ custom_data: "b-ticket-000001", user_id: A }))).body.result, (await ssv(await cb({ custom_data: "b-ticket-000001", user_id: B, transaction_id: "a b" }))).status, (await ssv(await cb({ custom_data: "b-ticket-000001", user_id: B }))).body.result], ["rejected", 403, "ok"]);

  // 24 hours
  const m2 = G.calls.length;
  NOW += 24 * HOUR + 1; kv.delete(SSV_KEYS_KV); // (KV's own expiry)
  G.keysDown = true;
  eq("a day later the keys are too old to trust, and if Google's list cannot be read the answer is 502 (AdMob sends the callback again)", [(await ssv(await cb({}))).status, G.calls.length - m2], [502, 1]);
  G.keysDown = false;
  eq("…and read again once it can", [(await ssv(await cb({}))).status, since(m2)], [200, [`GET ${SSV_KEYS_URL}`, `GET ${SSV_KEYS_URL}`]]);

  // the DER reader
  let round = 0;
  for (let i = 0; i < 200; i++) { const raw = crypto.getRandomValues(new Uint8Array(64)); if (i % 4 === 0) raw[0] = 0; if (i % 5 === 0) raw.fill(0, 32, 34); if (i % 7 === 0) raw[32] = 0xff; const back = derToRaw(rawToDer(raw)); if (back && Buffer.compare(Buffer.from(back), Buffer.from(raw)) === 0) round++; }
  eq("a DER signature is read back exactly, whatever its numbers' lengths", round, 200);
  const der = rawToDer(crypto.getRandomValues(new Uint8Array(64)));
  eq("what is not exactly SEQUENCE { INTEGER, INTEGER } is no signature", [derToRaw(der.subarray(0, der.length - 1)), derToRaw(Uint8Array.from([...der, 0])), derToRaw(Uint8Array.from([0x31, ...der.subarray(1)])), derToRaw(new Uint8Array(0)), derToRaw(Uint8Array.from([0x30, 0x80])), derToRaw(Uint8Array.from([0x30, 2, 2, 0])), derToRaw("MEQ")], Array(7).fill(null));
}

/* ───────────── the fallback claim: ten seconds, then a Play Integrity token, observed ───────────── */
const VERDICT = fixture("integrity-verdict.json").tokenPayloadExternal;
let made = 0;
/** A token "Play" issued: the recorded verdict, for this request hash, made now, changed. → the token */
const integrityToken = (requestHash, change = {}) => {
  const token = `eyJhbGciOiJBMjU2S1ciLCJlbmMiOiJBMjU2R0NNIn0.token-${++made}`, v = structuredClone(VERDICT);
  v.requestDetails.requestHash = requestHash; v.requestDetails.timestampMillis = String(NOW);
  for (const [where, value] of Object.entries(change)) { const [a, b] = where.split("."); v[a][b] = value; }
  G.verdicts.set(token, v);
  return token;
};
{
  const g = await guest(), who = { token: g.token }, id = g.account.id;
  const device = () => { const r = one("SELECT integrity, integrity_at FROM devices WHERE account_id = ?", id); return { ...(r.integrity ? JSON.parse(r.integrity) : {}), at: r.integrity_at }; };
  const claim = (ticket, integrity, env = LIVE) => hit("POST", "/api/app/ads/claim", { ...who, body: { ticket, integrity }, env });
  const paidHints = () => lines(id, "ad").split(",").filter(Boolean).length;

  const t1 = await ticketOf(who), mark = G.calls.length;
  const pass = integrityToken(await integrityHash("ad_claim", t1));
  const early = await claim(t1, pass);
  NOW += AD_CLAIM_WAIT_MS - 1;
  const almost = await claim(t1, pass);
  eq("a claim sooner than ten seconds after the ticket is too early: refused, unpaid, and Google is not asked", [early.status, early.body, almost.body, paidHints(), G.calls.length - mark], [409, { error: "early", retryInMs: AD_CLAIM_WAIT_MS }, { error: "early", retryInMs: 1 }, 0, 0]);
  NOW += 1;
  const done = await claim(t1, pass);
  eq("ten seconds on, with a token Play made for this ticket: paid, marked as the phone's word", [done.status, done.body.result, done.body.reward, one("SELECT verified FROM ad_tickets WHERE id = ?", t1).verified, one("SELECT verified, transaction_id FROM ad_rewards WHERE ticket_id = ?", t1)],
    [200, "ok", { hints: 1 }, "client", { verified: "client", transaction_id: `client:${t1}` }]);
  eq("…decoded by Google once, as our service account, for Play Integrity", [since(mark), G.calls.at(-1).body, G.tokens.at(-1).claims.scope, G.tokens.at(-1).signed], [[`POST ${TOKEN_URL}`, `POST ${DECODE}`], JSON.stringify({ integrity_token: pass }), "https://www.googleapis.com/auth/playintegrity", true]);
  eq("…the verdict is kept on the phone's device row, and a pass files no flag", [device(), flagsOf(id)], [{ state: "pass", why: [], app: "PLAY_RECOGNIZED", device: ["MEETS_DEVICE_INTEGRITY"], licence: "LICENSED", version: "42", for: "ad_claim", at: NOW }, []]);
  const m2 = G.calls.length;
  eq("the same claim again: a duplicate, and the token is not decoded twice", [(await claim(t1, pass)).body.result, G.calls.length - m2], ["duplicate", 0]);

  // observe mode: whatever the verdict, the claim stands and a flag is filed
  const observed = async (what, tokenFor2, wantState, wantWhy) => {
    const t = await ticketOf(who);
    NOW += AD_CLAIM_WAIT_MS;
    const before = paidHints(), flagged = flagsOf(id).length, r = await claim(t, await tokenFor2(t)), f = flagsOf(id).slice(flagged);
    eq(what, [r.status, r.body.result, paidHints() - before, f.map((x) => [x.for, x.state, x.why])], [200, "ok", 1, wantState ? [["ad_claim", wantState, wantWhy]] : []]);
  };
  await observed("a device that does not pass: paid all the same, and flagged", async (t) => integrityToken(await integrityHash("ad_claim", t), { "deviceIntegrity.deviceRecognitionVerdict": [] }), "fail", ["device"]);
  eq("…and the device row now says so", [device().state, device().why], ["fail", ["device"]]);
  await observed("only basic integrity", async (t) => integrityToken(await integrityHash("ad_claim", t), { "deviceIntegrity.deviceRecognitionVerdict": ["MEETS_BASIC_INTEGRITY"] }), "fail", ["device"]);
  await observed("an app Play does not recognise", async (t) => integrityToken(await integrityHash("ad_claim", t), { "appIntegrity.appRecognitionVerdict": "UNRECOGNIZED_VERSION" }), "fail", ["app"]);
  await observed("a token made for another app", async (t) => integrityToken(await integrityHash("ad_claim", t), { "requestDetails.requestPackageName": "com.example.clone", "appIntegrity.packageName": "com.example.clone" }), "fail", ["package"]);
  await observed("a token made for another ticket", async () => integrityToken(await integrityHash("ad_claim", t1)), "fail", ["request"]);
  await observed("a token made for something else altogether", async () => integrityToken(await integrityHash("device", id)), "fail", ["request"]);
  await observed("a token made eleven minutes ago", async (t) => integrityToken(await integrityHash("ad_claim", t), { "requestDetails.timestampMillis": String(NOW - 11 * 60 * 1000) }), "fail", ["stale"]);
  await observed("a token Google already decoded once (it blanks the verdicts)", async (t) => integrityToken(await integrityHash("ad_claim", t), { "appIntegrity.appRecognitionVerdict": "UNEVALUATED", "deviceIntegrity.deviceRecognitionVerdict": [] }), "fail", ["app", "device"]);
  const kept = device();
  await observed("something that is not a token", async () => "not-a-token-play-ever-made", "invalid", []);
  await observed("characters no token has", async () => "<script>", "invalid", []);
  const m3 = G.calls.length;
  await observed("no token at all", async () => "", "missing", []);
  await observed("…or not even a string", async () => ({ token: 1 }), "missing", []);
  eq("…and without a token Google is not asked; the device keeps its last decoded verdict", [G.calls.length - m3, device()], [0, kept]);
  G.fail.push({ match: /decodeIntegrityToken/, status: 500 }, { match: /decodeIntegrityToken/, status: 500 }, { match: /decodeIntegrityToken/, status: 500 });
  await observed("Google cannot be asked: that says nothing about the phone, so no flag", async (t) => integrityToken(await integrityHash("ad_claim", t)), null);
  await observed("a good one again", async (t) => integrityToken(await integrityHash("ad_claim", t)), null);
  eq("…and the device row says pass once more", device().state, "pass");

  // what still refuses a claim: nothing about the verdict
  const other = await guest(), theirs = await ticketOf({ token: other.token });
  NOW += AD_CLAIM_WAIT_MS;
  const m4 = G.calls.length;
  eq("somebody else's ticket, or none: rejected, and Google is not asked", [(await claim(theirs, "x")).body.reason, (await claim("no-such-ticket", "x")).body.reason, G.calls.length - m4, one("SELECT paid_at FROM ad_tickets WHERE id = ?", theirs).paid_at], ["ticket", "ticket", 0, null]);
  const t9 = await ticketOf(who, "coins");
  NOW += AD_CLAIM_WAIT_MS;
  await ssv(await signedCallback({ ad_network: "5450213213286189855", ad_unit: AD_UNIT, custom_data: t9, reward_amount: "1", reward_item: "Reward", timestamp: String(NOW), transaction_id: "feedc0de0001", user_id: id }));
  eq("the callback arrived after all: the claim is a duplicate, paid once, as the callback's", [(await claim(t9, "x")).body.result, lines(id, "ad").split(",").filter((l) => l.startsWith("coin")).join(), one("SELECT verified FROM ad_tickets WHERE id = ?", t9).verified, G.calls.length - m4], ["duplicate", "coin:5", "ssv", 0]);
  d1.raw.prepare("UPDATE app_config SET v = '2' WHERE k = 'ad_client_claims_per_day'").run();
  NOW += 30 * HOUR; // a new day
  const got = [];
  for (let i = 0; i < 4; i++) { const t = await ticketOf(who); NOW += AD_CLAIM_WAIT_MS; const r = await claim(t, integrityToken(await integrityHash("ad_claim", t))); got.push(r.body.result + (r.body.reason ? `:${r.body.reason}` : "")); }
  eq("only a few fallback claims a day, pass or not", got, ["ok", "ok", "rejected:client_cap", "rejected:client_cap"]);

  /* ───────────── POST /api/app/integrity: a verdict per device ───────────── */
  const report = (token, w = who, env = LIVE) => hit("POST", "/api/app/integrity", { ...w, body: { token }, env });
  const fresh = await guest(), fw = { token: fresh.token }, fid = fresh.account.id;
  const fdev = () => { const r = one("SELECT integrity, integrity_at FROM devices WHERE account_id = ?", fid); return r.integrity ? { ...JSON.parse(r.integrity), at: r.integrity_at } : null; };
  const good = await report(integrityToken(await integrityHash("device", fid)), fw);
  eq("the phone reports in: its verdict is kept on its device row", [good.status, good.body, fdev().state, fdev().for, fdev().at, flagsOf(fid)], [200, { ok: true }, "pass", "device", NOW, []]);
  const failing = await report(integrityToken(await integrityHash("device", fid), { "deviceIntegrity.deviceRecognitionVerdict": [], "accountDetails.appLicensingVerdict": "UNLICENSED" }), fw);
  eq("a failing verdict is answered exactly like a passing one, kept and flagged; nothing is blocked", [failing.status, failing.body, fdev().state, fdev().licence, flagsOf(fid).map((f) => [f.for, f.state, f.why]), (await hit("GET", "/api/app/wallet", fw)).status], [200, { ok: true }, "fail", "UNLICENSED", [["device", "fail", ["device"]]], 200]);
  eq("a token made for another account, no token, no service account", [(await report(integrityToken(await integrityHash("device", id)), fw)).body, flagsOf(fid).at(-1).why, (await report("", fw)).status, (await report(undefined, fw)).status, (await report("x", fw, { ...BARE, ADMOB_AD_UNITS: AD_UNIT })).status], [{ ok: true }, ["request"], 400, 400, 503]);
  eq("a caller with no device row (the site's own test sign-in) has a flag when it fails and nothing else kept", [(await report(integrityToken(await integrityHash("device", B), { "appIntegrity.appRecognitionVerdict": "UNEVALUATED" }), { as: B })).body, flagsOf(B).map((f) => [f.state, f.why, f.dev])], [{ ok: true }, [["fail", ["app"], ""]]]);
}

/* ───────────── in all ───────────── */
{
  const scopes = G.tokens.map((t) => t.scope.split("/").pop());
  eq("an access token is asked for once per scope and kept in memory (plus the one Google dropped)", [scopes.filter((s) => s === "androidpublisher").length, scopes.filter((s) => s === "playintegrity").length], [2, 1]);
  eq("every access token came from a JWT our key signed", G.tokens.every((t) => t.signed && t.claims.iss === SA_EMAIL), true);
  const stored = JSON.stringify([...kv.entries()]) + JSON.stringify(rows("SELECT * FROM flags")) + JSON.stringify(rows("SELECT * FROM devices")) + JSON.stringify(rows("SELECT * FROM purchases"));
  ok("no access token, key or purchase token is written to KV or the tables", !/ya29\.test|PRIVATE KEY|fixture\.oneTime|fixture\.variant|fixture\.sub/.test(stored));
  ok("no file of the repository's backend or fixtures holds a private key", ![path.join(ROOT, "functions"), FIX, path.join(ROOT, "wrangler.toml")].some(function has(p) { return fs.statSync(p).isDirectory() ? fs.readdirSync(p).some((f) => has(path.join(p, f))) : /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/]{40}/.test(fs.readFileSync(p, "utf8")); }));
}

if (bad.length) { console.error(`test-verifiers: ${bad.length} of ${n} checks FAILED`); for (const b of bad) console.error(`  ✗ ${b}`); process.exit(1); }
console.log(`test-verifiers: all ${n} checks passed`);
