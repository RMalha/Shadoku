/**
 * What every /api/app endpoint starts with: who is calling, the database, the account's row, the configuration, the clock.
 *
 *   const ctx = await appContext(request, env, { write: true, rate: { name: "app-sync", max: 60, windowSec: 600 } });
 *   if (ctx.error) return ctx.error;
 *
 * Who is calling (architecture 4.1):
 *   - the app: `Authorization: Bearer <token>`, a token sealed with SESSION_SECRET whose payload says aud "app". There is no
 *     cookie, so no CSRF check. Issuing these tokens (guest accounts, the native sign-ins) is the sign-in phase's job:
 *     sealAppToken() below is what it will call. The site's cookie reader refuses them (readSession, `aud`).
 *   - a browser on the site's own origin with the site's session cookie (local testing with DEV_LOGIN): writes must be same-origin.
 * Storage: the app's tables come from migrations/ (not created lazily): until they are applied the answer is 503 "schema".
 */
import { json, readSession, sameOrigin, seal, unseal, sessionAlive, SESSION_DAYS } from "../auth.js";
import { db } from "../db.js";
import { limit } from "../ratelimit.js";
import { parseConfig, dayKey, periodKey, AD_COIN_REWARD, SOCIAL_NETWORKS } from "./economy.js";
import { openWallet } from "./ledger.js";
import { dealStatements, questDefs } from "./quests.js";

export const APP_AUD = "app";

/** → the bearer token of an app session: { id, aud: "app", dev } for 30 days. */
export const sealAppToken = (env, { id, dev = "" }) => seal(env, { id, aud: APP_AUD, dev }, SESSION_DAYS * 86400);

/** The server's clock. (`env.NOW`, a function, replaces it in the tests: bindings come from wrangler's configuration, never from a request.) */
export const clock = (env) => (typeof env.NOW === "function" ? env.NOW() : Date.now());

const fail = (error, status, extra = {}) => ({ error: json({ error, ...extra }, status) });

let schemaSeen = false; // one look per isolate, remembered only once the tables are there

async function appDb(env) {
  const d = await db(env);
  if (!d) return fail("storage", 503);
  if (!schemaSeen) {
    const row = await d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('wallets', 'ledger')").first();
    if (!row || row.n !== 2) return fail("schema", 503);
    schemaSeen = true;
  }
  return { d };
}

async function caller(request, env, write) {
  const header = request.headers.get("Authorization");
  if (header) { // the app: a bearer token and nothing else (a wrong one never falls back to a cookie)
    const m = /^Bearer ([A-Za-z0-9_.-]{20,2000})$/.exec(header);
    const s = m ? await unseal(env, m[1]) : null;
    return s && s.aud === APP_AUD && typeof s.id === "string" && s.id && (await sessionAlive(env, s)) ? { id: s.id } : fail("auth", 401);
  }
  if (write && !sameOrigin(request, env)) return fail("origin", 403);
  const s = await readSession(request, env);
  return s ? { id: s.id } : fail("auth", 401);
}

/**
 * → { d, env, id, account, cfg, now, tz } or { error: Response }.
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
  ]);
  const account = res[2].results[0];
  if (account.banned) return fail("banned", 403);
  if (account.merged_into) return fail("merged", 409, { into: account.merged_into });
  return { d, env, id: who.id, account, cfg: parseConfig(res[3].results), now, tz: account.tz_offset };
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
    d.prepare("SELECT item_id, qty FROM inventory WHERE account_id = ? ORDER BY item_id").bind(id),
    d.prepare("SELECT current, best, last_date, cycle_day FROM streaks WHERE account_id = ?").bind(id),
    d.prepare("SELECT DISTINCT SUBSTR(period_key, 1, 1) AS period FROM quest_state WHERE account_id = ? AND replaced_day = ? AND replaced_how = 'free'").bind(id, day),
    d.prepare("SELECT period_key, quest_id, slot, progress, claimed_at FROM quest_state WHERE account_id = ? AND period_key IN (?, ?) AND replaced_at IS NULL ORDER BY period_key, slot").bind(id, keys[0], keys[1]),
    d.prepare("SELECT COUNT(*) AS n FROM ledger WHERE account_id = ? AND currency = 'coin' AND reason = 'ad' AND day = ?").bind(id, day),
    d.prepare("SELECT COUNT(*) AS n FROM ad_tickets WHERE account_id = ? AND placement = 'quest_refresh' AND paid_at IS NOT NULL AND used_at IS NULL").bind(id),
    d.prepare("SELECT v.network, EXISTS (SELECT 1 FROM ledger l WHERE l.account_id = v.account_id AND l.currency = 'coin' AND l.reason = 'social' AND l.ref = v.network) AS claimed FROM social_visits v WHERE v.account_id = ?").bind(id),
  ])).slice(deal.length);
  const wallet = r[0].results[0] || { coins: 0, hints: 0, version: 0 };
  const streak = r[3].results[0] || { current: 0, best: 0, last_date: "", cycle_day: 0 };
  const byId = new Map(defs.map((q) => [q.id, q]));
  const freeUsed = new Set(r[4].results.map((f) => f.period));
  const visits = new Map(r[8].results.map((v) => [v.network, v.claimed ? "claimed" : "opened"]));
  const adsToday = r[6].results[0].n;
  return {
    serverTime: now,
    day,
    coins: wallet.coins,
    hints: wallet.hints,
    version: wallet.version,
    entitlements: r[1].results.map((e) => e.key),
    inventory: Object.fromEntries(r[2].results.map((i) => [i.item_id, i.qty])),
    ads: { coinReward: AD_COIN_REWARD, perDay: cfg.ad_coins_per_day, left: Math.max(0, cfg.ad_coins_per_day - adsToday) },
    streak: { current: streak.current, best: streak.best, lastDate: streak.last_date, cycleDay: streak.cycle_day },
    // the quests dealt for today and this week (a quest switched off since it was dealt is left out)
    quests: r[5].results.filter((q) => byId.has(q.quest_id)).map((q) => {
      const def = byId.get(q.quest_id);
      return { id: def.id, period: def.period, periodKey: q.period_key, slot: q.slot, kind: def.kind, target: def.target, reward: def.reward, progress: q.progress, claimed: !!q.claimed_at };
    }),
    // one free refresh a day for a daily quest and one for a weekly quest; each paid "quest_refresh" ad ticket is one more
    questRefresh: { dailyFree: !freeUsed.has("d"), weeklyFree: !freeUsed.has("w"), adTickets: r[7].results[0].n },
    social: Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, visits.get(n) || "new"])),
  };
}

/**
 * The account is being deleted (DELETE /api/account): its wallet, ledger, inventory and play records go. Its purchase rows stay,
 * without the account id: the token hash must keep refusing a replay, and a refund from Google must still find its order.
 * A database without the app's tables (migrations not applied) has nothing to erase.
 */
export async function eraseAppAccount(env, id) {
  const d = await db(env).catch(() => null);
  if (!d) return;
  const gone = (table, column = "account_id") => d.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).bind(id);
  try {
    await d.batch([
      gone("wallets"), gone("ledger"), gone("inventory"), gone("entitlements"), gone("ad_tickets"), gone("ad_rewards"), gone("solves"),
      gone("quest_state"), gone("streaks"), gone("social_visits"), gone("flags"),
      d.prepare("UPDATE purchases SET account_id = 'erased' WHERE account_id = ?").bind(id),
      gone("accounts", "id"),
    ]);
  } catch (e) {
    if (!/no such table/i.test(String(e && e.message))) throw e;
  }
}
