/**
 * How long things are kept (the privacy policy states the same periods: src/locales/en.json ui.legal.*, architecture 4.12).
 *
 *   an account and everything saved for it   as long as the account is used; deleted when it was not seen for 12 months
 *   client error reports (`errors`)          30 days
 *   signed-out phones (revoked `devices`)    30 days
 *   rewarded-ad tickets (`ad_tickets`)       30 days
 *   ad views (`ad_rewards`), anti-cheat signals (`flags`), Shop swaps (`shop_refreshes`)   90 days
 *   a 1v1 wait nobody came back to (`duel_queue`)   1 day; a friendly invitation (`duel_invites`)   30 days after it ran out
 *   rate-limit counters                      about an hour (ratelimit.js)
 *   the mark that ends a deleted account's sessions   31 days (KV's own expiry: auth.js endSessions)
 *   what stays of a deleted account's purchases (`purchases` as "erased", `kept_ledger`)   10 years from the purchase
 *   a banned sign-in's hash (`kept_bans`)    as long as the ban stands
 *
 * D1 has no expiry of its own (KV has, and the deletion mark uses it), so these are DELETEs by date. Nothing runs by itself in
 * Pages Functions: POST /api/cron/retention (functions/api/cron/retention.js) does one task per call, and the Worker in
 * tools/cloud/retention calls it every night. Each task is small on purpose (a Worker invocation has a budget of queries).
 *
 * "Seen" is the table account_seen (db.js): a signed-in page load on the site (api/auth/session.js) or any call of the app with
 * its token (app/context.js) notes it, once a day. An account that predates the table gets its row from `backfill`.
 */
import { endSessions, deleteRecord } from "./auth.js";
import { db, erasePlayer, ERRORS_KEEP_DAYS } from "./db.js";
import { eraseAppAccount, ERASED_ACCOUNT } from "./app/context.js";

const DAY = 24 * 3600 * 1000;
export const INACTIVE_DAYS = 365;
export const KEPT_YEARS = 10;
/** [table, the column that dates a row, days kept, "s" when the column is in seconds, an extra condition] */
const TTL = [
  ["errors", "at", ERRORS_KEEP_DAYS, "s", ""],
  ["devices", "revoked_at", 30, "ms", "revoked_at IS NOT NULL"],
  ["ad_tickets", "created", 30, "ms", ""],
  ["ad_rewards", "at", 90, "ms", ""],
  ["flags", "at", 90, "ms", ""],
  ["shop_refreshes", "at", 90, "ms", ""],
  ["duel_queue", "seen", 1, "ms", ""],
  ["duel_invites", "expires", 30, "ms", ""],
  ["kept_ledger", "at", KEPT_YEARS * 365.25, "ms", ""],
  ["purchases", "verified_at", KEPT_YEARS * 365.25, "ms", `account_id = '${ERASED_ACCOUNT}'`],
];

const tablesOf = async (d) => new Set((await d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results.map((t) => t.name));

/**
 * Everything of an account goes, on both sides (DELETE /api/account, and the accounts deleted as inactive): the app's tables
 * first and whole (app/context.js eraseAppAccount: what stays of it, without the account id, is listed there), then its
 * sessions, its ranking row, ratings and community puzzles, its codename, avatar and saved progress.
 */
export async function eraseAccount(env, id) {
  await eraseAppAccount(env, id); // also its account_seen row
  await endSessions(env, id);
  await erasePlayer(env, id);
  await deleteRecord(env, id);
}

/** Rows past their date go. `dry`: count them only. → { "<table>": rows } */
export async function sweepExpired(env, { now = Date.now(), dry = false } = {}) {
  const d = await db(env);
  if (!d) return {};
  const have = await tablesOf(d);
  const due = TTL.filter(([table]) => have.has(table)).map(([table, column, days, unit, extra]) => {
    const cut = Math.floor((now - days * DAY) / (unit === "s" ? 1000 : 1));
    return { table, sql: `FROM ${table} WHERE ${column} < ?${extra ? ` AND ${extra}` : ""}`, cut };
  });
  if (!due.length) return {};
  const res = await d.batch(due.map((t) => d.prepare(dry ? `SELECT COUNT(*) AS n ${t.sql}` : `DELETE ${t.sql} RETURNING 1 AS n`).bind(t.cut)));
  return Object.fromEntries(due.map((t, i) => [t.table, dry ? res[i].results[0].n : res[i].results.length]));
}

/**
 * Accounts that have no account_seen row yet (they were made before the table, or only ever left data behind) get one, so the
 * 12 months can run: an app account from its own last activity, an account known only to the site from now.
 * → { app, site, truncated } (rows added; truncated: the site's store has more accounts than one call lists)
 */
export async function backfillSeen(env, { now = Date.now(), pages = 5 } = {}) {
  const d = await db(env);
  if (!d) return { app: 0, site: 0, truncated: false };
  const have = await tablesOf(d);
  let app = 0, site = 0, truncated = false;
  if (have.has("accounts")) {
    app = (await d.prepare(
      `INSERT INTO account_seen (id, at) SELECT a.id, MAX(a.created, a.last_sync${have.has("devices") ? ", COALESCE((SELECT MAX(v.last_seen) FROM devices v WHERE v.account_id = a.id), 0)" : ""})
       FROM accounts a WHERE a.merged_into IS NULL AND NOT EXISTS (SELECT 1 FROM account_seen s WHERE s.id = a.id) ON CONFLICT (id) DO NOTHING RETURNING 1 AS n`,
    ).all()).results.length;
  }
  const add = async (ids) => (ids.length ? (await d.prepare("INSERT INTO account_seen (id, at) SELECT value, ?1 FROM json_each(?2) WHERE true ON CONFLICT (id) DO NOTHING RETURNING 1 AS n").bind(now, JSON.stringify(ids)).all()).results.length : 0);
  site += (await d.prepare(
    `INSERT INTO account_seen (id, at) SELECT id, ?1 FROM (SELECT id FROM players UNION SELECT author_id FROM puzzles UNION SELECT user_id FROM ratings) WHERE true ON CONFLICT (id) DO NOTHING RETURNING 1 AS n`,
  ).bind(now).all()).results.length;
  if (env.SHADOKU_KV && typeof env.SHADOKU_KV.list === "function") {
    for (const prefix of ["user:", "progress:"]) {
      let cursor;
      for (let page = 0; ; page++) {
        if (page >= pages) { truncated = true; break; }
        const list = await env.SHADOKU_KV.list({ prefix, cursor });
        site += await add(list.keys.map((k) => k.name.slice(prefix.length)));
        if (list.list_complete || !list.cursor) break;
        cursor = list.cursor;
      }
    }
  }
  return { app, site, truncated };
}

/**
 * Accounts not seen for 12 months are deleted, oldest first, at most `limit` per call. An account whose row is old but that
 * the app's own tables or the ranking saw since is not deleted: its row is corrected instead (a deletion cannot be undone).
 * `dry`: count them only. → { erased, corrected, more }
 */
export async function eraseInactive(env, { now = Date.now(), limit = 1, dry = false } = {}) {
  const d = await db(env);
  if (!d) return { erased: 0, corrected: 0, more: false };
  const have = await tablesOf(d), cut = now - INACTIVE_DAYS * DAY;
  const later = [
    have.has("devices") ? "(SELECT MAX(v.last_seen) FROM devices v WHERE v.account_id = s.id)" : null,
    have.has("accounts") ? "(SELECT a.last_sync FROM accounts a WHERE a.id = s.id)" : null,
    "(SELECT p.updated FROM players p WHERE p.id = s.id)",
  ].filter(Boolean).map((q) => `COALESCE(${q}, 0)`).join(", ");
  if (dry) return { erased: 0, corrected: 0, more: false, due: (await d.prepare("SELECT COUNT(*) AS n FROM account_seen WHERE at < ?").bind(cut).first()).n };
  const due = (await d.prepare(`SELECT s.id, MAX(s.at, ${later}) AS last FROM account_seen s WHERE s.at < ? ORDER BY s.at LIMIT ?`).bind(cut, limit + 1).all()).results;
  let erased = 0, corrected = 0;
  for (const row of due.slice(0, limit)) {
    if (row.last >= cut) { await d.prepare("UPDATE account_seen SET at = ? WHERE id = ?").bind(row.last, row.id).run(); corrected++; continue; }
    await eraseAccount(env, row.id);
    await d.prepare("DELETE FROM account_seen WHERE id = ?").bind(row.id).run(); // (a database without the app's tables: nobody else removed it)
    erased++;
  }
  return { erased, corrected, more: due.length > limit };
}
