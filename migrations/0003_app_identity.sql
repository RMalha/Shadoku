-- Shadoku app: sign-in for the native shell (docs/android/architecture.md 4.1, 5 and 4.10). Functions: functions/api/app/auth/**,
-- functions/_lib/app/accounts.js, identity.js.
-- Apply:  npx wrangler d1 migrations apply shadoku --local | --remote
-- Until it is applied, /api/app/* answers 503 "schema" (the wallet included: its endpoints read `devices`). The site is not affected.

-- ───────────── identities ─────────────
-- A sign-in (provider, sub) that belongs to an account whose id is NOT "<provider>:<sub>": a second sign-in linked to an
-- account (Profile > Linked accounts). A sign-in without a row here is the account "<provider>:<sub>", as on the website.
CREATE TABLE identities (
  provider TEXT NOT NULL,
  sub TEXT NOT NULL,
  account_id TEXT NOT NULL,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (provider, sub)
);
CREATE INDEX identities_account ON identities (account_id);

-- ───────────── devices ─────────────
-- One row per install that holds a bearer token. The token names its device (`dev`); a call is refused once the device is
-- revoked (sign-out) or signed in to another account (a later sign-in on that phone), whatever the token's own expiry says.
-- install_id: a random id the phone made on its first launch (only a rate-limit key and a hint for support, never a credential).
-- fcm_token: the push token (POST /api/app/devices). integrity / integrity_at: the last Play Integrity verdict (not read yet).
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  install_id TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL DEFAULT '',
  fcm_token TEXT NOT NULL DEFAULT '',
  integrity TEXT NOT NULL DEFAULT '',
  integrity_at INTEGER,
  created INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX devices_account ON devices (account_id);

-- ───────────── guest accounts that signed in ─────────────
-- accounts.merged_into (0001) names the account a guest became. merge_op: the operation that did it (everything else in that
-- batch is tied to it, functions/_lib/app/ledger.js `when.gate`). merge_how: moved (the account it became was new to the app
-- and took everything) | solves (it had its own history: only the contracts it had not closed counted).
ALTER TABLE accounts ADD COLUMN merge_op TEXT;
ALTER TABLE accounts ADD COLUMN merge_how TEXT;
ALTER TABLE accounts ADD COLUMN merged_at INTEGER;
CREATE INDEX accounts_merged ON accounts (merged_into) WHERE merged_into IS NOT NULL;
CREATE INDEX accounts_merge_op ON accounts (merge_op) WHERE merge_op IS NOT NULL;

-- A closed account's books are closed: once a guest has become another account, the only lines its ledger still takes are the
-- two that empty it. (A sync that was already running when the phone signed in fails whole instead of paying an account nobody
-- can open; the phone sends it again with its new token and the events count for the account the guest became.)
CREATE TRIGGER ledger_closed_account BEFORE INSERT ON ledger
WHEN NEW.reason <> 'merge'
BEGIN
  SELECT RAISE(ABORT, 'ledger: the account is closed (it signed in as another)')
  WHERE EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND merged_into IS NOT NULL);
END;

-- An account merges once, and only a guest does: whatever the code above it does.
CREATE TRIGGER account_merges_once BEFORE UPDATE OF merged_into ON accounts
BEGIN
  SELECT RAISE(ABORT, 'accounts: a merged account stays merged')
  WHERE OLD.merged_into IS NOT NULL AND NEW.merged_into IS NOT OLD.merged_into;
  SELECT RAISE(ABORT, 'accounts: only a guest account merges into another')
  WHERE NEW.merged_into IS NOT NULL AND OLD.merged_into IS NULL AND (OLD.kind <> 'guest' OR NEW.merged_into = OLD.id);
END;
