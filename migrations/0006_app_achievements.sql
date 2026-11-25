-- Shadoku app: achievements (app/docs/architecture.md 4.15 "As built: achievements"; the author's list: app/docs/Stuff.xlsx,
-- sheet "Achievements"). Code: functions/_lib/app/achievements.js (the list, its ladders and rewards, live in code),
-- GET /api/app/achievements. Until this is applied, the events work as before and unlock nothing, and GET answers 503 "schema".
-- Once applied anywhere, never edit it: add a new migration.

-- Every tier an account reached. A counted achievement has ten tiers (1, 5, 10, 25, 50, 100, 250, 500, 750, 1000: the Paper
-- ... Shadow badges), a one-off has one. The row IS the badge; an item or coin reward is written in the same batch, tied to it
-- by `op` (the batch that unlocked it), so a tier gives its reward exactly once. achievement: an id of achievements.js.
CREATE TABLE achievements (
  account_id TEXT NOT NULL,
  achievement TEXT NOT NULL,
  tier INTEGER NOT NULL CHECK (tier >= 1),
  at INTEGER NOT NULL,
  op TEXT NOT NULL,
  PRIMARY KEY (account_id, achievement, tier)
);
CREATE INDEX achievements_op ON achievements (op);

-- The items achievements give (product_brief.md "Hideout and cosmetics": unique, no variants). Hideout props carry the board's
-- prop ids (functions/_lib/app/hideout_props.js, from app/docs/art-plan/hideout_props.csv and the engine's HIDEOUT_PROP_INFO),
-- avatar items the ids of app/docs/art-plan/avatar_cosmetics.csv. rarity 'unique': no Shop price (economy.js COSMETIC_PRICES
-- has none), never on a shelf of the day, never in a pack (packs roll only common, rare, epic and legendary), so they come only
-- from here. data.achievement: which one gives it.
INSERT INTO items (id, kind, rarity, data) VALUES
  ('ASSASSIN_PERMIT',    'prop',   'unique', '{"achievement":"tutorial"}'),
  ('COFFEE_MACHINE',     'prop',   'unique', '{"achievement":"night_daily"}'),
  ('POCKET_WATCH',       'prop',   'unique', '{"achievement":"streak","tier":1}'),
  ('CALENDAR',           'prop',   'unique', '{"achievement":"streak","tier":2}'),
  ('CLOCK',              'prop',   'unique', '{"achievement":"streak","tier":3}'),
  ('COMPUTER',           'prop',   'unique', '{"achievement":"support"}'),
  ('WELCOME_MAT',        'prop',   'unique', '{"achievement":"hideout_edit"}'),
  ('GOLDEN_FLOOR',       'prop',   'unique', '{"achievement":"collect_all"}'),
  ('DOOR_FRONT',         'prop',   'unique', '{"achievement":"hideout_room"}'),
  ('DOOR_SIDE',          'prop',   'unique', '{"achievement":"hideout_room"}'),
  ('PUNCHING_BAG',       'prop',   'unique', '{"achievement":"duel_clean"}'),
  ('clothing-noirCloak', 'avatar', 'unique', '{"achievement":"act1"}'),
  ('glasses-umbra',      'avatar', 'unique', '{"achievement":"act2"}'),
  ('glasses-wayfarers',  'avatar', 'unique', '{"achievement":"avatar"}'),
  ('hat-neverGiveUp',    'avatar', 'unique', '{"achievement":"duel_comeback"}'),
  ('acc-friendship',     'avatar', 'unique', '{"achievement":"invite_friend"}')
ON CONFLICT (id) DO NOTHING;

-- The coins an achievement gives are ledger lines: reason 'achievement', ref '<achievement>:<tier>' (once per account, ever).
