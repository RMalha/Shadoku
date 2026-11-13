/**
 * What every /api/app endpoint starts with: who is calling, the database, the account's row, the configuration, the clock.
 *
 *   const ctx = await appContext(request, env, { write: true, rate: { name: "app-sync", max: 60, windowSec: 600 } });
 *   if (ctx.error) return ctx.error;
 *
 * Who is calling (architecture 4.1):
 *   - the app: `Authorization: Bearer <token>`, a token sealed with SESSION_SECRET whose payload says aud "app". There is no
 *     cookie, so no CSRF check. The tokens are issued by functions/api/app/auth/** (accounts.js: a guest account, a sign-in, a
 *     renewal). The site's cookie reader refuses them (readSession, `aud`). A token names its device (`dev`): the call is
 *     refused once that device signed out (revoked) or signed in to another account, whatever the token's expiry says.
 *   - a browser on the site's own origin with the site's session cookie (local testing with DEV_LOGIN): writes must be
 *     same-origin, and a call that names any other origin is refused, reads too (cookies are never accepted cross-origin).
 * Storage: the app's tables come from migrations/ (not created lazily): until they are applied the answer is 503 "schema".
 */
import { json, readSession, sameOrigin, siteOrigin, seal, unseal, sessionAlive, SESSION_DAYS } from "../auth.js";
import { db } from "../db.js";
import { limit } from "../ratelimit.js";
import { parseConfig, dayKey, hintsPerDay, periodKey, AD_COIN_REWARD, SOCIAL_NETWORKS, VARIANTS } from "./economy.js";
import { openWallet } from "./ledger.js";
import { dealStatements, questDefs } from "./quests.js";

export const APP_AUD = "app";

/** How long an app token lasts; POST /api/app/auth/refresh renews it (accounts.js). */
export const APP_TOKEN_SEC = SESSION_DAYS * 86400;
const short = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * → the bearer token of an app session: { id, aud: "app", dev, provider, name, avatar } for 30 days. `dev`: its row in `devices`
 * ("" only for tokens made by the tests and scripts: nothing to revoke). `provider`, `name`, `avatar`: who signed in, as the
 * site's session cookie carries them ("guest" and nothing else for a guest).
 */
export const sealAppToken = (env, { id, dev = "", provider = "", name = "", avatar = "" }, maxAgeSec = APP_TOKEN_SEC) =>
  seal(env, { id, aud: APP_AUD, dev: short(dev, 64), provider: short(provider, 20), name: short(name, 80), avatar: short(avatar, 300) }, maxAgeSec);

/** The server's clock. (`env.NOW`, a function, replaces it in the tests: bindings come from wrangler's configuration, never from a request.) */
export const clock = (env) => (typeof env.NOW === "function" ? env.NOW() : Date.now());

const fail = (error, status, extra = {}) => ({ error: json({ error, ...extra }, status) });

let schemaSeen = false; // one look per isolate, remembered only once the tables are there

async function appDb(env) {
  const d = await db(env);
  if (!d) return fail("storage", 503);
  if (!schemaSeen) {
    const row = await d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('wallets', 'ledger', 'devices', 'identities')").first();
    if (!row || row.n !== 4) return fail("schema", 503); // every migration up to 0003_app_identity.sql
    schemaSeen = true;
  }
  return { d };
}

/**
 * → the payload of the request's bearer token, or null: the signature is ours, it was made for the app and it has not expired
 * (`graceSec`: or expired no longer ago than that: only the sign-in and renewal endpoints pass one). Nothing else is checked
 * here: whether its account was deleted, its device revoked or its account merged is the caller's business.
 */
export async function readBearer(request, env, graceSec = 0) {
  const m = /^Bearer ([A-Za-z0-9_.-]{20,2000})$/.exec(request.headers.get("Authorization") || "");
  const s = m ? await unseal(env, m[1], graceSec) : null;
  return s && s.aud === APP_AUD && typeof s.id === "string" && s.id ? { ...s, dev: typeof s.dev === "string" ? s.dev : "" } : null;
}

async function caller(request, env, write) {
  if (request.headers.get("Authorization")) { // the app: a bearer token and nothing else (a wrong one never falls back to a cookie)
    const s = await readBearer(request, env);
    return s && (await sessionAlive(env, s)) ? { id: s.id, dev: s.dev } : fail("auth", 401);
  }
  const origin = request.headers.get("Origin");
  if (write ? !sameOrigin(request, env) : !!origin && origin !== siteOrigin(request, env)) return fail("origin", 403);
  const s = await readSession(request, env);
  return s ? { id: s.id, dev: "" } : fail("auth", 401);
}

/**
 * What the sign-in endpoints start with (functions/api/app/auth/**): the caller has no session yet, or the one it has is about
 * to change, so there is no account here. Nothing in them reads a cookie, so there is nothing for another site to forge.
 * → { d, env, cfg, now } or { error: Response }. `rate`: { name, max, windowSec } per client address.
 */
export async function appDoor(request, env, { rate = null } = {}) {
  const store = await appDb(env);
  if (store.error) return store;
  const { d } = store;
  if (rate) {
    const blocked = await limit(env, request, rate.name, { max: rate.max, windowSec: rate.windowSec });
    if (blocked) return { error: blocked };
  }
  return { d, env, cfg: parseConfig((await d.prepare("SELECT k, v FROM app_config").all()).results), now: clock(env) };
}

/**
 * → { d, env, id, dev, account, cfg, now, tz } or { error: Response }. `dev`: the token's device ("" for a cookie caller).
 * `write`: the call changes something (a cookie caller must then be same-origin). `rate`: { name, max, windowSec } per account.
 */
export async function appContext(request, env, { write = false, rate = null } = {}) {
  const who = await caller(request, env, write);
  if (who.error) return who;
  const store = await appDb(env);
  if (store.error) return store;
  const { d } = store;
  if (rate) {
    const blocked = await limit(env, request, rate.name, { max: rate.max, windowSec: rate.windowSec, id: who.id });
    if (blocked) return { error: blocked };
  }
  const now = clock(env);
  const res = await d.batch([
    d.prepare("INSERT INTO accounts (id, kind, created) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING").bind(who.id, who.id.startsWith("guest:") ? "guest" : "full", now),
    openWallet(d, who.id),
    d.prepare("SELECT * FROM accounts WHERE id = ?").bind(who.id),
    d.prepare("SELECT k, v FROM app_config"),
    // the token's device: seen now (noted once an hour), and read back to see that it is still this account's
    ...(who.dev ? [
      d.prepare("UPDATE devices SET last_seen = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL AND last_seen < ?").bind(now, who.dev, who.id, now - 3600 * 1000),
      d.prepare("SELECT account_id, revoked_at FROM devices WHERE id = ?").bind(who.dev),
    ] : []),
  ]);
  const account = res[2].results[0];
  if (account.banned) return fail("banned", 403);
  if (account.merged_into) return fail("merged", 409, { into: account.merged_into }); // a guest that signed in: the phone holds a newer token
  if (who.dev) {
    const device = res[5].results[0];
    if (!device || device.revoked_at || device.account_id !== who.id) return fail("revoked", 401); // signed out, or the phone signed in to another account
  }
  return { d, env, id: who.id, dev: who.dev, account, cfg: parseConfig(res[3].results), now, tz: account.tz_offset };
}

/** The statement that files an anti-cheat signal for review (`guard`: a ledger.js `when` condition without `w`, or none). */
export function flag(d, account, kind, detail, at, guard = null) {
  const text = JSON.stringify(detail).slice(0, 500);
  return guard
    ? d.prepare(`INSERT INTO flags (account_id, kind, detail, at) SELECT ?, ?, ?, ? WHERE ${guard.sql}`).bind(account, kind, text, at, ...guard.binds)
    : d.prepare("INSERT INTO flags (account_id, kind, detail, at) VALUES (?, ?, ?, ?)").bind(account, kind, text, at);
}

/**
 * The account's state as the app shows it: the phone caches it and never changes it. Balances are the server's;
 * `coins < 0` (after a refund) means spending is blocked until the balance recovers.
 */
export async function snapshot(ctx) {
  const { d, id, now, tz, cfg } = ctx;
  const day = dayKey(now, tz);
  const keys = [periodKey("daily", day), periodKey("weekly", day)];
  const defs = await questDefs(ctx);
  const deal = dealStatements(ctx, defs, day); // the day's and the week's quests exist from the first look at them
  const r = (await d.batch([
    ...deal,
    d.prepare("SELECT coins, hints, version FROM wallets WHERE account_id = ?").bind(id),
    d.prepare("SELECT key FROM entitlements WHERE account_id = ? ORDER BY key").bind(id),
    d.prepare("SELECT item_id, tier, qty FROM inventory WHERE account_id = ? AND qty > 0 ORDER BY item_id, tier").bind(id),
    d.prepare("SELECT current, best, last_date, cycle_day FROM streaks WHERE account_id = ?").bind(id),
    d.prepare("SELECT DISTINCT SUBSTR(period_key, 1, 1) AS period FROM quest_state WHERE account_id = ? AND replaced_day = ? AND replaced_how = 'free'").bind(id, day),
    d.prepare("SELECT period_key, quest_id, slot, progress, claimed_at FROM quest_state WHERE account_id = ? AND period_key IN (?, ?) AND replaced_at IS NULL ORDER BY period_key, slot").bind(id, keys[0], keys[1]),
    d.prepare("SELECT COUNT(*) AS n FROM ledger WHERE account_id = ? AND currency = 'coin' AND reason = 'ad' AND day = ?").bind(id, day),
    d.prepare("SELECT COUNT(*) AS n FROM ad_tickets WHERE account_id = ? AND placement = 'quest_refresh' AND paid_at IS NOT NULL AND used_at IS NULL").bind(id),
    d.prepare("SELECT v.network, EXISTS (SELECT 1 FROM ledger l WHERE l.account_id = v.account_id AND l.currency = 'coin' AND l.reason = 'social' AND l.ref = v.network) AS claimed FROM social_visits v WHERE v.account_id = ?").bind(id),
    d.prepare("SELECT COUNT(*) AS n FROM hint_uses WHERE account_id = ? AND day = ? AND source = 'free'").bind(id, day),
    d.prepare("SELECT COUNT(*) AS n FROM shop_refreshes WHERE account_id = ? AND day = ? AND how = 'free'").bind(id, day),
    d.prepare("SELECT COUNT(*) AS n FROM ad_tickets WHERE account_id = ? AND placement = 'shop_refresh' AND paid_at IS NOT NULL AND used_at IS NULL").bind(id),
    d.prepare("SELECT o.pack_id, COUNT(*) AS n, (SELECT p.dry FROM pack_opens p WHERE p.account_id = o.account_id AND p.pack_id = o.pack_id ORDER BY p.seq DESC LIMIT 1) AS dry FROM pack_opens o WHERE o.account_id = ? GROUP BY o.pack_id").bind(id),
  ])).slice(deal.length);
  const wallet = r[0].results[0] || { coins: 0, hints: 0, version: 0 };
  const streak = r[3].results[0] || { current: 0, best: 0, last_date: "", cycle_day: 0 };
  const byId = new Map(defs.map((q) => [q.id, q]));
  const freeUsed = new Set(r[4].results.map((f) => f.period));
  const visits = new Map(r[8].results.map((v) => [v.network, v.claimed ? "claimed" : "opened"]));
  const adsToday = r[6].results[0].n;
  const entitlements = r[1].results.map((e) => e.key), freeHints = hintsPerDay(entitlements), freeHintsUsed = r[9].results[0].n;
  const variants = {};
  for (const i of r[2].results) if (i.tier > 0) (variants[i.item_id] ||= {})[VARIANTS[i.tier]] = i.qty;
  return {
    serverTime: now,
    day,
    coins: wallet.coins,
    hints: wallet.hints, // the stock: bought, won or earned with an ad; it is spent only after the day's free hints
    hintsToday: { free: freeHints, used: freeHintsUsed, left: Math.max(0, freeHints - freeHintsUsed) },
    version: wallet.version,
    entitlements,
    inventory: Object.fromEntries(r[2].results.filter((i) => i.tier === 0).map((i) => [i.item_id, i.qty])), // packs and cards held (duplicates counted)
    variants, // merged cards: { "<item id>": { bronze: n, silver: n, gold: n, diamond: n } }
    ads: { coinReward: AD_COIN_REWARD, perDay: cfg.ad_coins_per_day, left: Math.max(0, cfg.ad_coins_per_day - adsToday) },
    streak: { current: streak.current, best: streak.best, lastDate: streak.last_date, cycleDay: streak.cycle_day },
    // the quests dealt for today and this week (a quest switched off since it was dealt is left out)
    quests: r[5].results.filter((q) => byId.has(q.quest_id)).map((q) => {
      const def = byId.get(q.quest_id);
      return { id: def.id, period: def.period, periodKey: q.period_key, slot: q.slot, kind: def.kind, target: def.target, reward: def.reward, progress: q.progress, claimed: !!q.claimed_at };
    }),
    // one free refresh a day for a daily quest and one for a weekly quest; each paid "quest_refresh" ad ticket is one more
    questRefresh: { dailyFree: !freeUsed.has("d"), weeklyFree: !freeUsed.has("w"), adTickets: r[7].results[0].n },
    // the Shop's cosmetics of the day: one free swap a day; each paid "shop_refresh" ad ticket is one more
    shopRefresh: { free: r[10].results[0].n === 0, adTickets: r[11].results[0].n },
    packsOpened: Object.fromEntries(r[12].results.map((o) => [o.pack_id, o.n])), // per kind of pack
    // the Legendary timer, per kind of pack: packs opened in a row with no Legendary card (GET /shop: odds.legendaryTimer.every is the row that pays)
    packsSinceLegendary: Object.fromEntries(r[12].results.map((o) => [o.pack_id, o.dry])),
    social: Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, visits.get(n) || "new"])),
  };
}

/**
 * The account is being deleted (DELETE /api/account): its wallet, ledger, inventory and play records go, and with them the phones
 * signed in to it, the sign-ins linked to it and whatever is left of the guest accounts it grew from (accounts.js mergeGuest).
 * Its purchase rows stay, without the account id: the token hash must keep refusing a replay, and a refund from Google must
 * still find its order. A database without the app's tables (migrations not applied) has nothing to erase.
 */
export async function eraseAppAccount(env, id) {
  const d = await db(env).catch(() => null);
  if (!d) return;
  const mine = "account_id = ? OR account_id IN (SELECT id FROM accounts WHERE merged_into = ?)";
  const gone = (table) => d.prepare(`DELETE FROM ${table} WHERE ${mine}`).bind(id, id);
  const run = (statements) => d.batch(statements).catch((e) => { if (!/no such table/i.test(String(e && e.message))) throw e; });
  // the sign-in records first, and on their own: a database that has no migration 0003 yet still erases everything below
  await run([gone("devices"), gone("identities")]);
  await run([
    ...["wallets", "ledger", "inventory", "entitlements", "ad_tickets", "ad_rewards", "solves", "quest_state", "streaks", "social_visits", "flags", "pack_opens", "card_merges", "hint_uses", "shop_refreshes"].map(gone),
    d.prepare(`UPDATE purchases SET account_id = 'erased' WHERE ${mine}`).bind(id, id),
    d.prepare("DELETE FROM accounts WHERE id = ? OR merged_into = ?").bind(id, id),
  ]);
}
