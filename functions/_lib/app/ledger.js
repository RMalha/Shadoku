/**
 * The only code that moves Syndicate Coins or hints (scripts/test-wallet.mjs checks that no other file writes the
 * `wallets` or `ledger` tables). Nothing here, and nothing that calls it, takes an amount from a request.
 *
 * How a balance changes: `post()` gives two statements for one `db.batch()` (atomic in D1):
 *   1. INSERT the ledger line, only if its guards hold (enough coins, under the day's ad cap, the operation's own row exists...)
 *      and only if that (account, currency, reason, ref) was never written;
 *   2. UPDATE the wallet, only if statement 1 wrote the line (looked up by the line's fresh id).
 * So a resend, a replay or two calls racing can write a line once at most, and the wallet moves only with a line.
 * Guards are evaluated by the database inside the batch, never from a value read earlier.
 * The migration's triggers back this up: a wallet that does not match its newest ledger line aborts the batch.
 *
 * An operation with side effects (a solve row, an inventory row, a purchase row) writes its own row first, stamped with a fresh
 * `op` id; everything after it in the batch is guarded by `when.gate(table, op)`, so it happens only if THIS batch wrote that row.
 */

const COLUMN = { coin: "coins", hint: "hints" };
/** A fresh id for a ledger line or an operation. */
export const newOp = () => crypto.randomUUID();

/** Guards for post(): SQL conditions over `w`, the account's wallet row. Table and column names here are code, never input. */
export const when = {
  /** the row this batch wrote in `table` exists */
  gate: (table, op, column = "op") => ({ sql: `EXISTS (SELECT 1 FROM ${table} WHERE ${column} = ?)`, binds: [op] }),
  /** another ledger line of this batch was written */
  line: (id) => ({ sql: "EXISTS (SELECT 1 FROM ledger WHERE id = ?)", binds: [id] }),
  /** the balance covers a spend (so a balance below zero, after a refund, blocks spending) */
  funds: (currency, amount) => ({ sql: `w.${COLUMN[currency]} >= ?`, binds: [amount] }),
  /** fewer than `max` coin lines of this reason on this day */
  perDay: (reason, day, max) => ({
    sql: "(SELECT COUNT(*) FROM ledger l WHERE l.account_id = w.account_id AND l.currency = 'coin' AND l.reason = ? AND l.day = ?) < ?",
    binds: [reason, day, max],
  }),
};

/**
 * → [insert the ledger line, move the wallet]: two statements for one batch (see the top of the file).
 * `id` a fresh newOp(); `delta` a non-zero integer the SERVER computed; `day` the account's date the line counts for.
 */
export function post(d, { id, account, currency = "coin", delta, reason, ref, day, at, meta = null, guards = [] }) {
  const col = COLUMN[currency];
  if (!col || !Number.isInteger(delta) || delta === 0 || !id || !account || !reason || ref === undefined || ref === null || !day) throw new Error("ledger: bad line");
  const where = guards.map((g) => ` AND (${g.sql})`).join("");
  return [
    d.prepare(
      `INSERT INTO ledger (id, account_id, currency, delta, reason, ref, balance_after, day, at, meta)
       SELECT ?, w.account_id, ?, ?, ?, ?, w.${col} + ?, ?, ?, ? FROM wallets w WHERE w.account_id = ?${where}
       ON CONFLICT (account_id, currency, reason, ref) DO NOTHING RETURNING balance_after`,
    ).bind(id, currency, delta, reason, String(ref), delta, day, at, meta ? JSON.stringify(meta) : null, account, ...guards.flatMap((g) => g.binds)),
    d.prepare(`UPDATE wallets SET ${col} = ${col} + ?, version = version + 1, updated = ? WHERE account_id = ? AND EXISTS (SELECT 1 FROM ledger WHERE id = ?)`)
      .bind(delta, at, account, id),
  ];
}

/**
 * As post(), for an amount the DATABASE works out from the server's own rows inside the batch (a guest's whole balance when it
 * signs in, the rewards of the contracts it brings: accounts.js). `amount`: { sql, binds }, a scalar SQL expression written in
 * code, never a value from a request. A NULL or zero amount writes nothing.
 * No ON CONFLICT here: a second line under the same key aborts the whole batch, so half a transfer can never be written.
 */
export function postFrom(d, { id, account, currency = "coin", amount, reason, ref, day, at, meta = null, guards = [] }) {
  const col = COLUMN[currency];
  if (!col || !amount || typeof amount.sql !== "string" || !Array.isArray(amount.binds) || !id || !account || !reason || ref === undefined || ref === null || !day) throw new Error("ledger: bad line");
  const where = guards.map((g) => ` AND (${g.sql})`).join("");
  return [
    d.prepare(
      `INSERT INTO ledger (id, account_id, currency, delta, reason, ref, balance_after, day, at, meta)
       SELECT ?, w.account_id, ?, x.n, ?, ?, w.${col} + x.n, ?, ?, ? FROM wallets w, (SELECT CAST((${amount.sql}) AS INTEGER) AS n) x
       WHERE w.account_id = ? AND x.n IS NOT NULL AND x.n <> 0${where} RETURNING delta, balance_after`,
    ).bind(id, currency, reason, String(ref), day, at, meta ? JSON.stringify(meta) : null, ...amount.binds, account, ...guards.flatMap((g) => g.binds)),
    d.prepare(`UPDATE wallets SET ${col} = ${col} + (SELECT delta FROM ledger WHERE id = ?), version = version + 1, updated = ? WHERE account_id = ? AND EXISTS (SELECT 1 FROM ledger WHERE id = ?)`)
      .bind(id, at, account, id),
  ];
}

/** The statement that opens an account's wallet, at zero (the only way a wallet row is made). */
export const openWallet = (d, account) => d.prepare("INSERT INTO wallets (account_id) VALUES (?) ON CONFLICT (account_id) DO NOTHING").bind(account);

/** The batch result of a RETURNING statement → true when it wrote its row. */
export const wrote = (result) => !!(result && result.results && result.results.length);

/** → the ledger line already written for this key, or null. */
export const lineFor = (d, account, currency, reason, ref) =>
  d.prepare("SELECT id, delta, meta, at FROM ledger WHERE account_id = ? AND currency = ? AND reason = ? AND ref = ?").bind(account, currency, reason, String(ref)).first();
