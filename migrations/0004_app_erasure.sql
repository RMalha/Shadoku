-- Shadoku app: what stays when an account is deleted (app/docs/architecture.md 4.11). Functions: functions/api/account.js,
-- functions/_lib/app/context.js eraseAppAccount.
-- Apply:  npx wrangler d1 migrations apply shadoku --local | --remote
-- Until it is applied, /api/app/* answers 503 "schema", and so does the app's bearer token on the endpoints it shares with the
-- website. The website is not affected, and deleting an account there still erases the app's tables.
--
-- DELETE /api/account erases every row that names the account. Three things stay, none of them with the account id:
--   purchases     the rows themselves, with account_id = 'erased' (0001): the token hash keeps refusing a replay and a refund
--                 from Google still finds its order
--   kept_ledger   below: what those purchases delivered and what their refunds took back
--   kept_bans     below: that a sign-in was banned

-- ───────────── the money lines of erased accounts ─────────────
-- A copy of the account's ledger lines of the reasons `iap` (a purchase's coins or hints) and `refund` (what a refund took
-- back), made in the batch that erases the ledger. A `purchases` row says that a purchase happened; only these lines say what it
-- delivered, and the `items` row it was priced from can change afterwards.
-- Not copied: the account id, balance_after and day (they describe the account, not the purchase), and every other line.
-- seq: the line's own number in `ledger` (never reused: AUTOINCREMENT). ref: the purchase's token hash (iap), its order id or
-- token hash (refund): the way back to its `purchases` row. meta: {"sku", "item"}.
CREATE TABLE kept_ledger (
  seq INTEGER PRIMARY KEY,
  currency TEXT NOT NULL CHECK (currency IN ('coin', 'hint')),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('iap', 'refund')),
  ref TEXT NOT NULL,
  at INTEGER NOT NULL,
  meta TEXT,
  erased_at INTEGER NOT NULL
);
CREATE INDEX kept_ledger_ref ON kept_ledger (ref);

-- ───────────── banned sign-ins of erased accounts ─────────────
-- Deleting an account must not lift a ban. When a banned account is erased, one row stays per sign-in it had (its own
-- "<provider>:<sub>" and the linked ones): account_hash is the SHA-256 of that id under its own prefix (context.js banKey), never
-- the id. An account made later for the same sign-in starts banned. To lift the ban by hand, delete the row and set
-- accounts.banned = 0 if the account was made again. A guest account leaves no row (a new guest is a new id anyway).
CREATE TABLE kept_bans (
  account_hash TEXT PRIMARY KEY,
  erased_at INTEGER NOT NULL
);

-- ───────────── giving a permanent purchase back ─────────────
-- A player who deletes the account and returns still owns, at Google Play, the upgrades that are never consumed (No ads, the
-- memberships), and Play will not sell them twice. So the erased row of such a purchase (and of no other) keeps owner_hash: the
-- hash Play itself holds for the buyer (functions/_lib/app/context.js accountHash, sent as obfuscatedAccountId), not the
-- account id. When the same sign-in sends the token again and Google still confirms it, the row becomes that account's again
-- and its entitlements return (billing.js restore): never coins, hints or cards. restore_op: the operation that did it (the
-- entitlements are tied to it); restored_at: when.
ALTER TABLE purchases ADD COLUMN owner_hash TEXT;
ALTER TABLE purchases ADD COLUMN restore_op TEXT;
ALTER TABLE purchases ADD COLUMN restored_at INTEGER;
CREATE INDEX purchases_restore ON purchases (restore_op) WHERE restore_op IS NOT NULL;
