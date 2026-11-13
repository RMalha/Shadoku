/**
 * The app's accounts (architecture 4.1 and 5): guest accounts, sign-in, the phone's bearer token and its device, linked
 * sign-ins, and what happens to a guest's things when the player signs in. Endpoints: functions/api/app/auth/**.
 *
 * TOKENS. A session is a sealed token { id, aud: "app", dev } that lasts 30 days. The phone renews it (POST /auth/refresh) while
 * its device row stands; a token may be renewed up to a year after it ran out, so a guest who comes back after two months
 * still has their account (a guest has no other way in). Signing out revokes the device: every token that names it is dead.
 * A phone that signs in keeps its device, which then belongs to the new account: the tokens it held before stop working.
 *
 * WHICH ACCOUNT. A sign-in (provider, sub) is the account "<provider>:<sub>", exactly as on the website, unless a row of
 * `identities` says that sign-in was linked to another account.
 *
 * A GUEST WHO SIGNS IN keeps what they have (mergeGuest). Two cases, because a guest account costs nothing to make and the
 * economy rests on every source paying once per account:
 *   moved    the account signed in to has nothing of its own in the app yet (the usual case: a new player who played first and
 *            signed in later, an account that only ever used the website). It takes EVERYTHING: coins and hints (a `merge`
 *            ledger line on each side), cards and packs, contracts, quests, the streak, the day's hints. It becomes the guest
 *            under another name, so everything that paid once has still paid once.
 *   solves   the account already has its own history. Moving a second wallet in would pay it twice for what pays once (a new
 *            guest could collect the first Daily Reward, a Silver Pack, and hand it over, again and again). So only the
 *            contracts the guest closed that the account had not are added, each paid once at what the server paid the guest.
 *            The guest's coins, hints and cards stay behind: the sign-in answers 409 "guest_progress" with what would be left,
 *            and goes ahead only when the phone sends it again with leaveGuest: true (the player said yes).
 * Either way the guest account is closed (accounts.merged_into) and can never merge again (a trigger sees to it).
 */
import { sessionAlive, getRecord, getProgress } from "../auth.js";
import { readBody } from "../db.js";
import { limit } from "../ratelimit.js";
import { postFrom, when, wrote, newOp, openWallet } from "./ledger.js";
import { sealAppToken, readBearer, APP_TOKEN_SEC } from "./context.js";
import { verifyIdentity, IDENTITY_FAIL } from "./identity.js";
import { CLIENT_ID_RE, SOCIAL_NETWORKS, clampTz, dayKey, intIn } from "./economy.js";

/** A token that ran out no longer ago than this can still be renewed, or name the guest who is signing in. */
export const TOKEN_GRACE_SEC = 365 * 86400;

const cleanInstall = (v) => (typeof v === "string" && CLIENT_ID_RE.test(v) ? v : "");
const cleanVersion = (v) => (typeof v === "string" && /^[0-9A-Za-z .+_()-]{1,40}$/.test(v) ? v : "");
const providerOf = (id) => id.slice(0, id.indexOf(":"));

/** What the phone keeps after a sign-in: the token, when it runs out, who it is. */
async function session(env, { id, kind, provider, name = "", avatar = "", device }) {
  return {
    token: await sealAppToken(env, { id, dev: device, provider, name, avatar }),
    expires: Date.now() + APP_TOKEN_SEC * 1000,
    account: { id, kind, provider },
    device,
  };
}

const deviceRow = (d, { id, account, installId, appVersion, now }) =>
  d.prepare("INSERT INTO devices (id, account_id, install_id, app_version, created, last_seen) VALUES (?, ?, ?, ?, ?, ?)").bind(id, account, installId, appVersion, now, now);

/* ───────────── guests ───────────── */
/**
 * POST /api/app/auth/guest { installId?, appVersion?, tz?, birthYear? } → a new guest account, its device and its token.
 * Limited per client address (cfg.guests_per_address_hour: mobile networks put many phones behind one address) and per install.
 * A guest account is worth nothing by itself: see the top of the file for what it can bring to a sign-in.
 */
export async function createGuest(door, request, body) {
  const { d, env, cfg, now } = door;
  const installId = cleanInstall(body.installId);
  const blocked = (await limit(env, request, "app-guest", { max: cfg.guests_per_address_hour, windowSec: 3600 }))
    || (installId ? await limit(env, request, "app-guest-install", { max: 5, windowSec: 86400, id: installId }) : null);
  if (blocked) return { response: blocked };
  const id = `guest:${crypto.randomUUID()}`, device = crypto.randomUUID();
  await d.batch([
    d.prepare("INSERT INTO accounts (id, kind, created, tz_offset, birth_year) VALUES (?, 'guest', ?, ?, ?)")
      .bind(id, now, clampTz(body.tz), intIn(body.birthYear, 1900, new Date(now).getUTCFullYear())),
    openWallet(d, id),
    deviceRow(d, { id: device, account: id, installId, appVersion: cleanVersion(body.appVersion), now }),
  ]);
  return { status: 200, body: await session(env, { id, kind: "guest", provider: "guest", device }) };
}

/* ───────────── a guest signs in ───────────── */
// what makes an account "not new to the app": a row of its own in any of these…
const HISTORY = ["ledger", "solves", "inventory", "entitlements", "hint_uses", "pack_opens", "card_merges", "ad_rewards", "shop_refreshes", "purchases", "social_visits"];
// …or a streak that started, or a quest that moved. (Quests it was only dealt, an empty streak row and unpaid ad tickets are not history.)
const FRESH_SQL = `(${[
  ...HISTORY.map((table) => `NOT EXISTS (SELECT 1 FROM ${table} WHERE account_id = ?)`),
  "NOT EXISTS (SELECT 1 FROM streaks WHERE account_id = ? AND last_date <> '')",
  "NOT EXISTS (SELECT 1 FROM quest_state WHERE account_id = ? AND (progress > 0 OR claimed_at IS NOT NULL OR replaced_at IS NOT NULL))",
].join(" AND ")})`;
const freshBinds = (id) => Array(HISTORY.length + 2).fill(id);
// everything of a guest that is keyed by its account and is not the wallet or the ledger (those move by ledger lines)
const MOVED = ["inventory", "entitlements", "solves", "quest_state", "streaks", "social_visits", "hint_uses", "pack_opens", "card_merges", "shop_refreshes", "ad_tickets", "ad_rewards", "purchases", "flags"];

/** "moved": the statements that make `target` (new to the app) what `guest` was. All of them hang on the first one. */
function moveStatements(d, { guest, target, op, day, now }) {
  const mine = when.gate("accounts", op, "merge_op");
  const tied = (sql, ...binds) => d.prepare(`${sql} AND ${mine.sql}`).bind(...binds, ...mine.binds);
  const out = { coin: newOp(), hint: newOp() }; // the guest's two closing lines
  const line = (id, account, currency, sql, binds, reason, ref, other) => postFrom(d, { id, account, currency, amount: { sql, binds }, reason, ref, day, at: now, meta: other, guards: [mine] });
  return [
    d.prepare(`UPDATE accounts SET merged_into = ?, merge_op = ?, merge_how = 'moved', merged_at = ? WHERE id = ? AND kind = 'guest' AND merged_into IS NULL AND banned = 0 AND ${FRESH_SQL} RETURNING id`)
      .bind(target, op, now, guest, ...freshBinds(target)),
    // what the account was dealt while it was empty makes room for the guest's
    ...["quest_state", "streaks", "ad_tickets"].map((table) => tied(`DELETE FROM ${table} WHERE account_id = ?`, target)),
    ...MOVED.map((table) => tied(`UPDATE ${table} SET account_id = ? WHERE account_id = ?`, target, guest)),
    tied(
      `UPDATE accounts SET tz_offset = (SELECT tz_offset FROM accounts WHERE id = ?), last_sync = MAX(last_sync, (SELECT last_sync FROM accounts WHERE id = ?)),
         birth_year = COALESCE(birth_year, (SELECT birth_year FROM accounts WHERE id = ?)) WHERE id = ?`, guest, guest, guest, target),
    // the wallet: the guest's balance goes to zero…
    ...line(out.coin, guest, "coin", "-(SELECT coins FROM wallets WHERE account_id = ?)", [guest], "merge", target, { to: target }),
    ...line(out.hint, guest, "hint", "-(SELECT hints FROM wallets WHERE account_id = ?)", [guest], "merge", target, { to: target }),
    // …and arrives in the account. A social visit's reward is paid once per account by its ledger key alone, so those lines
    // arrive under their own key (the account cannot collect them again); the rest is one `merge` line, less than zero when
    // the guest had already spent them.
    ...SOCIAL_NETWORKS.flatMap((network) => line(newOp(), target, "coin", "(SELECT delta FROM ledger WHERE account_id = ? AND currency = 'coin' AND reason = 'social' AND ref = ?)", [guest, network], "social", network, { from: guest })),
    ...line(newOp(), target, "coin", "-COALESCE((SELECT delta FROM ledger WHERE id = ?), 0) - (SELECT COALESCE(SUM(delta), 0) FROM ledger WHERE account_id = ? AND currency = 'coin' AND reason = 'social')", [out.coin, target], "merge", guest, { from: guest }),
    ...line(newOp(), target, "hint", "-(SELECT delta FROM ledger WHERE id = ?)", [out.hint], "merge", guest, { from: guest }),
  ];
}

/** "solves": the contracts the guest closed and `target` had not, each paid once at what the server paid the guest. */
function solveStatements(d, { guest, target, op, day, now }) {
  const mine = when.gate("accounts", op, "merge_op");
  return [
    d.prepare(`UPDATE accounts SET merged_into = ?, merge_op = ?, merge_how = 'solves', merged_at = ? WHERE id = ? AND kind = 'guest' AND merged_into IS NULL AND banned = 0 AND NOT ${FRESH_SQL} RETURNING id`)
      .bind(target, op, now, guest, ...freshBinds(target)),
    d.prepare(
      `INSERT INTO solves (account_id, case_id, mode, difficulty, seconds, hints, device_at, at, day, paid, flagged, op)
       SELECT ?, s.case_id, s.mode, s.difficulty, s.seconds, s.hints, s.device_at, s.at, s.day, s.paid, s.flagged, ? FROM solves s
       WHERE s.account_id = ? AND ${mine.sql} ON CONFLICT (account_id, case_id) DO NOTHING`,
    ).bind(target, op, guest, ...mine.binds),
    ...postFrom(d, { id: newOp(), account: target, amount: { sql: "(SELECT SUM(paid) FROM solves WHERE account_id = ? AND op = ?)", binds: [target, op] }, reason: "merge", ref: guest, day, at: now, meta: { from: guest, how: "solves" }, guards: [mine] }),
    d.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(paid), 0) AS coins FROM solves WHERE account_id = ? AND op = ?").bind(target, op),
  ];
}

/**
 * The guest account `guest` signs in as `target` (see the top of the file). `leave`: the player agreed to leave behind what a
 * "solves" merge does not take. The choice between the two cases is made by the database inside the batch that closes the guest.
 * → { result: "moved", coins, hints } | { result: "solves", solves, coins, left: { coins, hints, items } }
 *   | { result: "confirm", guest: { coins, hints, items } } (nothing changed) | { result: "already" } (it had become this account before)
 *   | { result: "none" } (not a guest that can merge) | { result: "busy" }
 */
export async function mergeGuest(d, { guest, target, leave = false, now }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const pre = await d.batch([
      d.prepare("SELECT a.kind, a.merged_into, a.banned, a.tz_offset, COALESCE(w.coins, 0) AS coins, COALESCE(w.hints, 0) AS hints FROM accounts a LEFT JOIN wallets w ON w.account_id = a.id WHERE a.id = ?").bind(guest),
      d.prepare("SELECT COALESCE(SUM(qty), 0) AS n FROM inventory WHERE account_id = ?").bind(guest),
      d.prepare(`SELECT ${FRESH_SQL} AS fresh`).bind(...freshBinds(target)),
    ]);
    const g = pre[0].results[0];
    if (!g || g.kind !== "guest" || guest === target) return { result: "none" };
    if (g.merged_into) return { result: g.merged_into === target ? "already" : "none" };
    if (g.banned) return { result: "none" };
    const has = { coins: g.coins, hints: g.hints, items: pre[1].results[0].n };
    const op = newOp(), day = dayKey(now, g.tz_offset);
    if (pre[2].results[0].fresh) {
      const res = await d.batch(moveStatements(d, { guest, target, op, day, now }));
      if (!wrote(res[0])) continue; // the guest merged meanwhile, or the account stopped being new: look again
      const lines = (await d.prepare("SELECT currency, delta FROM ledger WHERE account_id = ? AND reason = 'merge' AND ref = ?").bind(guest, target).all()).results;
      const moved = (currency) => -(lines.find((l) => l.currency === currency) || { delta: 0 }).delta;
      return { result: "moved", coins: moved("coin"), hints: moved("hint") };
    }
    if (!leave && (has.coins > 0 || has.hints > 0 || has.items > 0)) return { result: "confirm", guest: has };
    const res = await d.batch(solveStatements(d, { guest, target, op, day, now }));
    if (!wrote(res[0])) continue;
    const added = res[res.length - 1].results[0];
    return { result: "solves", solves: added.n, coins: added.coins, left: has };
  }
  return { result: "busy" };
}

/* ───────────── sign-in ───────────── */
/**
 * `who` (identity.js) signs in on this phone → { status, body: { token, expires, account, device, merge } }.
 * The request may carry the phone's current token: a guest's is merged into the account (mergeGuest); the device goes on as
 * the account's. Sent twice (the answer was lost), the second call finds the guest already merged and only signs in.
 * body.leaveGuest: see mergeGuest. body.installId, body.appVersion: for a phone that has no device row yet.
 */
export async function signIn(door, request, who, body) {
  const { d, env, now } = door;
  const prior = await readBearer(request, env, TOKEN_GRACE_SEC);
  const linked = await d.prepare("SELECT account_id FROM identities WHERE provider = ? AND sub = ?").bind(who.provider, who.sub).first();
  const target = linked ? linked.account_id : `${who.provider}:${who.sub}`;
  const pre = await d.batch([
    d.prepare("INSERT INTO accounts (id, kind, created) VALUES (?, 'full', ?) ON CONFLICT (id) DO NOTHING").bind(target, now),
    openWallet(d, target),
    d.prepare("SELECT id, kind, banned, merged_into FROM accounts WHERE id IN (?, ?)").bind(target, prior ? prior.id : target),
    d.prepare("SELECT account_id, revoked_at FROM devices WHERE id = ?").bind(prior ? prior.dev : ""),
  ]);
  const row = (id) => pre[2].results.find((a) => a.id === id);
  const account = row(target);
  if (account.banned) return { status: 403, body: { error: "banned" } };
  if (account.kind !== "full" || account.merged_into) return { status: 409, body: { error: "account" } };
  // the phone's own session, if it is still what its token says: the account not deleted since, the device not signed out and
  // still that account's (or this one's already: the same sign-in, sent again)
  const device = pre[3].results[0];
  const mine = !!prior && (await sessionAlive(env, prior)) && (!prior.dev || (!!device && !device.revoked_at && [prior.id, target].includes(device.account_id)));
  const from = mine && prior.id !== target ? row(prior.id) : null;
  let merge = { result: "none" };
  if (from && from.kind === "guest") {
    merge = await mergeGuest(d, { guest: from.id, target, leave: body.leaveGuest === true, now });
    if (merge.result === "confirm") return { status: 409, body: { error: "guest_progress", guest: merge.guest } };
    if (merge.result === "busy") return { status: 503, body: { error: "busy" } };
  }
  const appVersion = cleanVersion(body.appVersion);
  let dev = "";
  if (mine && prior.dev) {
    const kept = await d.prepare(
      "UPDATE devices SET account_id = ?, last_seen = ?, app_version = CASE WHEN ? <> '' THEN ? ELSE app_version END WHERE id = ? AND revoked_at IS NULL AND account_id IN (?, ?) RETURNING id",
    ).bind(target, now, appVersion, appVersion, prior.dev, prior.id, target).first();
    if (kept) dev = prior.dev;
  }
  if (!dev) {
    dev = crypto.randomUUID();
    await deviceRow(d, { id: dev, account: target, installId: cleanInstall(body.installId), appVersion, now }).run();
  }
  return { status: 200, body: { ...(await session(env, { id: target, kind: "full", provider: who.provider, name: who.name, avatar: who.avatar, device: dev })), merge } };
}

/** The whole of a sign-in endpoint after its door: read the body, check the proof, sign in. → Response-ready { status, body }. */
export async function signInRequest(door, request, provider) {
  const body = await readBody(request, 8192);
  if (!body) return { status: 400, body: { error: "format" } };
  const who = await verifyIdentity(door.env, request, provider, body);
  if (!who.ok) return { status: IDENTITY_FAIL[who.error], body: { error: who.error === "unconfigured" ? "signin_unavailable" : who.error } };
  return signIn(door, request, who, body);
}

/* ───────────── renewal, sign-out ───────────── */
/** POST /api/app/auth/refresh { appVersion? } → a new token for the same account and device. */
export async function refresh(door, request, body) {
  const { d, env, now } = door;
  const s = await readBearer(request, env, TOKEN_GRACE_SEC);
  if (!s || !(await sessionAlive(env, s))) return { status: 401, body: { error: "auth" } };
  const blocked = await limit(env, request, "app-refresh", { max: 30, windowSec: 3600, id: s.id });
  if (blocked) return { response: blocked };
  const appVersion = cleanVersion(body.appVersion);
  const res = await d.batch([
    d.prepare("SELECT kind, banned, merged_into FROM accounts WHERE id = ?").bind(s.id),
    d.prepare("UPDATE devices SET last_seen = ?, app_version = CASE WHEN ? <> '' THEN ? ELSE app_version END WHERE id = ? AND account_id = ? AND revoked_at IS NULL RETURNING id")
      .bind(now, appVersion, appVersion, s.dev, s.id),
  ]);
  const account = res[0].results[0];
  if (!account) return { status: 401, body: { error: "auth" } };
  if (account.banned) return { status: 403, body: { error: "banned" } };
  if (account.merged_into) return { status: 409, body: { error: "merged", into: account.merged_into } };
  if (s.dev && !wrote(res[1])) return { status: 401, body: { error: "revoked" } };
  return { status: 200, body: await session(env, { id: s.id, kind: account.kind, provider: s.provider || providerOf(s.id), name: s.name, avatar: s.avatar, device: s.dev }) };
}

/** POST /api/app/auth/logout: the phone signs out. Its device is revoked: no token that names it works again. */
export async function signOut(ctx) {
  if (ctx.dev) await ctx.d.prepare("UPDATE devices SET revoked_at = ?, fcm_token = '' WHERE id = ? AND account_id = ? AND revoked_at IS NULL").bind(ctx.now, ctx.dev, ctx.id).run();
  return { status: 200, body: { ok: true } };
}

/** POST /api/app/devices { fcmToken?, appVersion? }: the phone's push token and version, on its own device row. */
export async function noteDevice(ctx, body) {
  if (!ctx.dev) return { status: 409, body: { error: "no_device" } };
  const fcm = body.fcmToken;
  if (fcm !== undefined && (typeof fcm !== "string" || fcm.length > 4096 || !/^[A-Za-z0-9_:.-]*$/.test(fcm))) return { status: 400, body: { error: "format" } };
  const appVersion = cleanVersion(body.appVersion);
  await ctx.d.prepare("UPDATE devices SET fcm_token = CASE WHEN ? THEN ? ELSE fcm_token END, app_version = CASE WHEN ? <> '' THEN ? ELSE app_version END, last_seen = ? WHERE id = ? AND account_id = ?")
    .bind(fcm === undefined ? 0 : 1, fcm || "", appVersion, appVersion, ctx.now, ctx.dev, ctx.id).run();
  return { status: 200, body: { ok: true } };
}

/* ───────────── linked sign-ins ───────────── */
/** → the providers an account can be signed in to with: its own, and the ones linked to it. */
export async function signIns(d, id) {
  const linked = (await d.prepare("SELECT provider FROM identities WHERE account_id = ? ORDER BY linked_at").bind(id).all()).results.map((r) => r.provider);
  return id.startsWith("guest:") ? linked : [providerOf(id), ...linked];
}

/** → true when "<provider>:<sub>" is somebody's account already: in the app, or on the website (a codename, an avatar, saved progress, a ranking row, a puzzle). */
async function hasAccount(env, d, own) {
  const row = await d.prepare(
    "SELECT (EXISTS (SELECT 1 FROM accounts WHERE id = ?) OR EXISTS (SELECT 1 FROM players WHERE id = ?) OR EXISTS (SELECT 1 FROM puzzles WHERE author_id = ?)) AS x",
  ).bind(own, own, own).first();
  if (row.x) return true;
  const rec = await getRecord(env, own);
  return !!(rec.username || rec.avatar || rec.since || (await getProgress(env, own)));
}

/**
 * POST /api/app/auth/link: a signed-in account adds a second sign-in (Profile > Linked accounts). From then on that sign-in
 * opens THIS account in the app. Allowed only when that sign-in has no account of its own; two accounts are never merged here
 * (architecture 5: the app says that sign-in already has its own file and offers to switch to it). One sign-in per provider.
 * → 200 { ok, signIns } | 409 guest | has_account | linked_elsewhere | provider_linked
 */
export async function linkIdentity(ctx, who) {
  const { d, id, now } = ctx;
  if (ctx.account.kind !== "full") return { status: 409, body: { error: "guest" } }; // a guest signs in instead: POST /auth/<provider>
  const own = `${who.provider}:${who.sub}`;
  const done = async (extra = {}) => ({ status: 200, body: { ok: true, ...extra, signIns: await signIns(d, id) } });
  if (own === id) return done({ duplicate: true });
  const row = await d.prepare("SELECT account_id FROM identities WHERE provider = ? AND sub = ?").bind(who.provider, who.sub).first();
  if (row) return row.account_id === id ? done({ duplicate: true }) : { status: 409, body: { error: "linked_elsewhere" } };
  if ((await signIns(d, id)).includes(who.provider)) return { status: 409, body: { error: "provider_linked" } };
  if (await hasAccount(ctx.env, d, own)) return { status: 409, body: { error: "has_account" } };
  const res = await d.batch([
    d.prepare( // checked again by the database: not while that sign-in got an account, or this account another sign-in of that provider
      `INSERT INTO identities (provider, sub, account_id, linked_at) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE id = ?)
         AND NOT EXISTS (SELECT 1 FROM identities WHERE account_id = ? AND provider = ?) ON CONFLICT (provider, sub) DO NOTHING RETURNING provider`,
    ).bind(who.provider, who.sub, id, now, own, id, who.provider),
  ]);
  return wrote(res[0]) ? done() : { status: 409, body: { error: "busy" } };
}
