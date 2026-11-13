-- Shadoku app: the wallet backend (docs/android/architecture.md 4.2). Functions: functions/api/app/**, functions/_lib/app/**.
-- Apply:  npx wrangler d1 migrations apply shadoku --local      (the database `wrangler pages dev` uses)
--         npx wrangler d1 migrations apply shadoku --remote     (production; until then /api/app/* answers 503 "schema")
-- The site's six tables keep their own mechanism (functions/_lib/db.js creates them on first use).
-- Money times are epoch milliseconds; a `day` is the account's calendar date, "YYYY-MM-DD".

-- ───────────── accounts ─────────────
-- The app-side record of an account id (guest:<uuid>, google:<sub>, github:<id>, ...). Made on its first /api/app call.
-- tz_offset: minutes east of UTC, sent by the phone with each sync; it only decides where the account's day starts.
-- last_sync: an event's date is accepted between this and now (architecture 3.4, "Dates").
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('guest', 'full')),
  created INTEGER NOT NULL,
  tz_offset INTEGER NOT NULL DEFAULT 0,
  country TEXT NOT NULL DEFAULT '',
  birth_year INTEGER,
  merged_into TEXT,
  banned INTEGER NOT NULL DEFAULT 0,
  last_sync INTEGER NOT NULL DEFAULT 0
);

-- ───────────── wallet + ledger ─────────────
CREATE TABLE wallets (
  account_id TEXT PRIMARY KEY,
  coins INTEGER NOT NULL DEFAULT 0,
  hints INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0
);

-- Every change of a balance, append-only. UNIQUE (account, currency, reason, ref) is the idempotency guarantee: the same
-- solve, ad, purchase, quest, streak day or shop request can never be written twice. (The currency is part of the key so
-- one purchase or shop request can carry a coin line and a hint line.)
-- reason -> ref: solve (case id) | ad (AdMob transaction id) | iap (purchase token hash) | quest (period key ":" quest id)
--   | streak (date) | social (network) | shop (request id) | hint_use (event id) | refund (order id)
--   | later: infinite, pack, merge, grant
CREATE TABLE ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('coin', 'hint')),
  delta INTEGER NOT NULL CHECK (delta <> 0),
  reason TEXT NOT NULL,
  ref TEXT NOT NULL,
  balance_after INTEGER NOT NULL,
  day TEXT NOT NULL,
  at INTEGER NOT NULL,
  meta TEXT,
  UNIQUE (account_id, currency, reason, ref)
);
CREATE INDEX ledger_tail ON ledger (account_id, currency, seq);
CREATE INDEX ledger_day ON ledger (account_id, day);

-- The database itself refuses a balance that no ledger line explains, whatever the code above it does:
--   1. a ledger line must continue from the wallet's current balance;
--   2. a wallet's balance must equal its newest ledger line (0 when it has none);
--   3. a ledger line is never rewritten. (Lines are deleted only when the whole account is erased.)
CREATE TRIGGER ledger_continues_wallet BEFORE INSERT ON ledger
BEGIN
  SELECT RAISE(ABORT, 'ledger: balance_after does not continue the wallet')
  WHERE NEW.balance_after IS NOT NEW.delta + (SELECT CASE NEW.currency WHEN 'coin' THEN coins ELSE hints END FROM wallets WHERE account_id = NEW.account_id);
END;

CREATE TRIGGER wallet_follows_ledger_update AFTER UPDATE OF coins, hints ON wallets
BEGIN
  SELECT RAISE(ABORT, 'wallet: balance without a ledger line')
  WHERE NEW.coins IS NOT COALESCE((SELECT balance_after FROM ledger WHERE account_id = NEW.account_id AND currency = 'coin' ORDER BY seq DESC LIMIT 1), 0)
     OR NEW.hints IS NOT COALESCE((SELECT balance_after FROM ledger WHERE account_id = NEW.account_id AND currency = 'hint' ORDER BY seq DESC LIMIT 1), 0);
END;

CREATE TRIGGER wallet_follows_ledger_insert AFTER INSERT ON wallets
BEGIN
  SELECT RAISE(ABORT, 'wallet: balance without a ledger line')
  WHERE NEW.coins IS NOT COALESCE((SELECT balance_after FROM ledger WHERE account_id = NEW.account_id AND currency = 'coin' ORDER BY seq DESC LIMIT 1), 0)
     OR NEW.hints IS NOT COALESCE((SELECT balance_after FROM ledger WHERE account_id = NEW.account_id AND currency = 'hint' ORDER BY seq DESC LIMIT 1), 0);
END;

CREATE TRIGGER wallet_keeps_account BEFORE UPDATE OF account_id ON wallets
BEGIN
  SELECT RAISE(ABORT, 'wallet: a wallet never changes account');
END;

CREATE TRIGGER ledger_append_only BEFORE UPDATE ON ledger
BEGIN
  SELECT RAISE(ABORT, 'ledger: lines are append-only');
END;

-- ───────────── catalogue, inventory, entitlements ─────────────
-- kind: avatar | prop | furniture | hint_bundle | coin_pack | remove_ads | promo | pack
-- rarity: common | rare | epic | legendary for cosmetics (avatar, prop, furniture): it sets their price and their place in the
--   Shop's "cosmetics of the day" (functions/_lib/app/shop.js); '' for everything else.
-- price_coins: what it costs in the Shop (NULL = a cosmetic's rarity price, or not sold for coins). sku: its Play Billing product id.
-- data (JSON): what a purchase grants: {"coins": n, "hints": n, "entitlement": "remove_ads", "inventory": {"<item id>": n}, "once": true}
--   (once: one per account, ever), or a pack's contents, or the cosmetic's own fields.
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  rarity TEXT NOT NULL DEFAULT '',
  price_coins INTEGER,
  sku TEXT UNIQUE,
  data TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  starts INTEGER,
  ends INTEGER
);

CREATE TABLE inventory (
  account_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  first_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, item_id)
);

CREATE TABLE entitlements (
  account_id TEXT NOT NULL,
  key TEXT NOT NULL,
  since INTEGER NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (account_id, key)
);

-- ───────────── purchases and ads ─────────────
-- One row per Play purchase token (its SHA-256): a replayed token finds its row and grants nothing.
-- op / void_op: the operation that wrote the row / voided it (functions/_lib/app/ledger.js: the grant is tied to it).
CREATE TABLE purchases (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  order_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  purchased_at INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0,
  voided_at INTEGER,
  op TEXT NOT NULL,
  void_op TEXT
);
CREATE INDEX purchases_account ON purchases (account_id);
CREATE INDEX purchases_order ON purchases (order_id);

-- One per rewarded ad the app is about to show. placement: coins | hint | quest_refresh (later: infinite).
-- used_at: a quest_refresh ticket, once paid, is spent by one refresh.
CREATE TABLE ad_tickets (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  placement TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  paid_at INTEGER,
  used_at INTEGER,
  verified TEXT
);
CREATE INDEX ad_tickets_account ON ad_tickets (account_id, created);

-- One per verified ad view: AdMob's transaction id is the key, so a replayed callback does nothing.
-- verified: ssv (AdMob's server callback) | client (the Play Integrity fallback) | dev (test builds).
CREATE TABLE ad_rewards (
  transaction_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  ad_unit TEXT NOT NULL DEFAULT '',
  verified TEXT NOT NULL,
  day TEXT NOT NULL,
  at INTEGER NOT NULL,
  op TEXT NOT NULL
);
CREATE INDEX ad_rewards_account ON ad_rewards (account_id, day);

-- ───────────── play ─────────────
-- The server's own list of the bundled cases and what they are worth (scripts/app-case-index.mjs writes it from the
-- engine folders). A solve of a case that is not here pays nothing. Dailies are not listed: the weekday plan prices them.
CREATE TABLE case_index (
  case_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('tutorial', 'story', 'classic')),
  difficulty TEXT NOT NULL,
  size INTEGER NOT NULL,
  people INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

-- The first solve of each case by each account: the primary key is why a case pays once. paid: coins written to the ledger.
CREATE TABLE solves (
  account_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  seconds INTEGER NOT NULL,
  hints INTEGER NOT NULL,
  device_at INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,
  day TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  flagged INTEGER NOT NULL DEFAULT 0,
  op TEXT NOT NULL,
  PRIMARY KEY (account_id, case_id)
);
CREATE INDEX solves_op ON solves (op);

-- period: daily | weekly. kind: solve | solve_no_hints | solve_expert | open_pack | new_props.
CREATE TABLE quest_defs (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL CHECK (period IN ('daily', 'weekly')),
  kind TEXT NOT NULL,
  target INTEGER NOT NULL CHECK (target > 0),
  reward INTEGER NOT NULL CHECK (reward >= 0),
  active INTEGER NOT NULL DEFAULT 1
);

-- The quests an account was dealt for a period, and how far it got. period_key: "d:YYYY-MM-DD" or "w:<the week's Monday>".
-- A period deals a few quests from the list (slots 0, 1, ...); only dealt quests advance. A refresh swaps the quest of one slot:
-- the old row stays, marked replaced (so the same quest is not dealt twice in a period), and a new row takes its slot at 0.
-- replaced_day / replaced_how ('free' | 'ad'): one free refresh per day for daily quests and one for weekly quests.
CREATE TABLE quest_state (
  account_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  replaced_at INTEGER,
  replaced_day TEXT,
  replaced_how TEXT,
  op TEXT,
  PRIMARY KEY (account_id, period_key, quest_id)
);
CREATE INDEX quest_state_refreshes ON quest_state (account_id, replaced_day);

CREATE TABLE streaks (
  account_id TEXT PRIMARY KEY,
  current INTEGER NOT NULL DEFAULT 0,
  best INTEGER NOT NULL DEFAULT 0,
  last_date TEXT NOT NULL DEFAULT '',
  cycle_day INTEGER NOT NULL DEFAULT 0,
  op TEXT
);

-- The 30-day Daily Reward list. A day without a row gives nothing. kind:
--   coins     amount coins                      hints     amount hints
--   item      `amount` of the item `item` (a pack)   cosmetic  one random cosmetic the account does not own yet; item = '<group>:<rarity>',
--                                                         group avatar | hideout (props and furniture), e.g. 'hideout:common'
CREATE TABLE streak_rewards (
  day INTEGER PRIMARY KEY CHECK (day BETWEEN 1 AND 30),
  kind TEXT NOT NULL CHECK (kind IN ('coins', 'hints', 'item', 'cosmetic')),
  amount INTEGER NOT NULL DEFAULT 1 CHECK (amount > 0),
  item TEXT NOT NULL DEFAULT ''
);

CREATE TABLE social_visits (
  account_id TEXT NOT NULL,
  network TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, network)
);

-- ───────────── review and tuning ─────────────
CREATE TABLE flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
);
CREATE INDEX flags_account ON flags (account_id, at);

-- Caps and thresholds that can change without a deploy: v is JSON. A key that is missing, unknown or of the wrong type
-- falls back to CONFIG_DEFAULTS in functions/_lib/app/economy.js.
CREATE TABLE app_config (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
