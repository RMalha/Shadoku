-- Shadoku app: the first rows of the economy's lists (docs/android/product_brief.md "Economy"; app/docs/Stuff.xlsx of 2026-11-13).
-- These are DATA, not schema: change them later with ordinary UPDATE/INSERT statements (a new migration, or
-- `npx wrangler d1 execute shadoku --remote --command "..."`), never by editing this file after it was applied.

-- The brief's example quests: the list each player's daily and weekly quests are dealt from (how many: app_config
-- daily_quests / weekly_quests). open_pack waits for the pack-opening endpoint, new_props for the hideout catalogue.
INSERT INTO quest_defs (id, period, kind, target, reward) VALUES
  ('d_solve2',  'daily',  'solve',          2,  10),
  ('d_solve5',  'daily',  'solve',          5,  25),
  ('d_nohint2', 'daily',  'solve_no_hints', 2,  25),
  ('d_expert1', 'daily',  'solve_expert',   1,  25),
  ('d_pack1',   'daily',  'open_pack',      1,  10),
  ('w_nohint5', 'weekly', 'solve_no_hints', 5,  100),
  ('w_solve20', 'weekly', 'solve',          20, 100),
  ('w_props8',  'weekly', 'new_props',      8,  120);

-- The Shop, for coins (sheet "Shop"). Packs: what they hold is in `data`, for the pack-opening endpoint (not built yet);
-- bought or won packs wait in the inventory. Cosmetics have no rows yet: they come with their art, each with a rarity,
-- and are priced by it (50 / 100 / 200 / 400: functions/_lib/app/economy.js COSMETIC_PRICES).
INSERT INTO items (id, kind, price_coins, data) VALUES
  ('pack_bronze', 'pack',        90,   '{"cards":5,"hints":5,"guaranteed":"rare"}'),
  ('pack_silver', 'pack',        120,  '{"cards":5,"hints":5,"guaranteed":"epic"}'),
  ('pack_gold',   'pack',        300,  '{"cards":5,"hints":0}'),
  ('hints_5',     'hint_bundle', 60,   '{"hints":5}'),
  ('hints_15',    'hint_bundle', 160,  '{"hints":15}'),
  ('hints_40',    'hint_bundle', 650,  '{"hints":40}'),
  ('hints_100',   'hint_bundle', 1500, '{"hints":100}');

-- The Shop, for money. `sku` must be the product id created in Play Console (rename here if they differ there).
-- Prices in euros live in Play Console, never here. Not seeded: the two memberships (No ads + badge + daily hints) and
-- the timed promotions, which need decisions first (docs/android/architecture.md 4.9).
INSERT INTO items (id, kind, sku, data) VALUES
  ('coins_100',  'coin_pack',  'coins_100',  '{"coins":100}'),
  ('coins_500',  'coin_pack',  'coins_500',  '{"coins":500}'),
  ('coins_1200', 'coin_pack',  'coins_1200', '{"coins":1200}'),
  ('coins_2500', 'coin_pack',  'coins_2500', '{"coins":2500}'),
  ('remove_ads', 'remove_ads', 'remove_ads', '{"entitlement":"remove_ads"}'),
  ('noob_kit',   'promo',      'noob_kit',   '{"coins":500,"hints":15,"inventory":{"pack_bronze":1,"pack_silver":1,"pack_gold":1},"once":true}');

-- The 30-day Daily Reward list (sheet "Daily Streak Rewards").
INSERT INTO streak_rewards (day, kind, amount, item) VALUES
  (1,  'item',     1, 'pack_silver'),
  (2,  'hints',    5, ''),
  (3,  'coins',    5, ''),
  (4,  'cosmetic', 1, 'hideout:common'),
  (5,  'hints',    5, ''),
  (6,  'coins',    5, ''),
  (7,  'cosmetic', 1, 'avatar:common'),
  (8,  'item',     1, 'pack_bronze'),
  (9,  'hints',    5, ''),
  (10, 'coins',    5, ''),
  (11, 'cosmetic', 1, 'hideout:common'),
  (12, 'hints',    5, ''),
  (13, 'coins',    5, ''),
  (14, 'cosmetic', 1, 'avatar:common'),
  (15, 'item',     1, 'pack_silver'),
  (16, 'hints',    5, ''),
  (17, 'coins',    5, ''),
  (18, 'cosmetic', 1, 'hideout:common'),
  (19, 'hints',    5, ''),
  (20, 'coins',    5, ''),
  (21, 'cosmetic', 1, 'avatar:common'),
  (22, 'item',     1, 'pack_bronze'),
  (23, 'hints',    5, ''),
  (24, 'coins',    5, ''),
  (25, 'cosmetic', 1, 'hideout:common'),
  (26, 'hints',    5, ''),
  (27, 'coins',    5, ''),
  (28, 'cosmetic', 1, 'avatar:common'),
  (29, 'item',     1, 'pack_bronze'),
  (30, 'item',     1, 'pack_gold');
