-- Shadoku app: the first rows of the economy's lists (docs/android/product_brief.md "Economy"; app/docs/Stuff.xlsx of 2026-11-13).
-- These are DATA, not schema: change them later with ordinary UPDATE/INSERT statements (a new migration, or
-- `npx wrangler d1 execute shadoku --remote --command "..."`), never by editing this file after it was applied.

-- The quest list each player's daily and weekly quests are dealt from (how many: app_config daily_quests / weekly_quests).
-- The first eight are the brief's examples, with the brief's rewards.
INSERT INTO quest_defs (id, period, kind, target, reward) VALUES
  ('d_solve2',  'daily',  'solve',          2,  10),
  ('d_solve5',  'daily',  'solve',          5,  25),
  ('d_nohint2', 'daily',  'solve_no_hints', 2,  25),
  ('d_expert1', 'daily',  'solve_expert',   1,  25),
  ('d_pack1',   'daily',  'open_pack',      1,  10),
  ('w_nohint5', 'weekly', 'solve_no_hints', 5,  100),
  ('w_solve20', 'weekly', 'solve',          20, 100),
  ('w_props8',  'weekly', 'new_props',      8,  120);

-- More quests (2026-11-13). Their targets and rewards are a FIRST PROPOSAL on the scale of the examples above (daily 5-25,
-- weekly 50-150): edit freely. Kinds: functions/_lib/app/economy.js QUEST_KINDS (solve_daily: a daily contract; merge_cards:
-- three cards merged into a variant; shop_buy: anything bought in the Shop with coins; watch_ad: any rewarded ad;
-- streak: the Daily Reward collected, so w_reward7 is "every day of the week").
INSERT INTO quest_defs (id, period, kind, target, reward) VALUES
  ('d_daily1',    'daily',  'solve_daily',     1,  15),
  ('d_solve3',    'daily',  'solve',           3,  15),
  ('d_nohint1',   'daily',  'solve_no_hints',  1,  10),
  ('d_veryeasy3', 'daily',  'solve_very_easy', 3,  10),
  ('d_easy2',     'daily',  'solve_easy',      2,  10),
  ('d_medium2',   'daily',  'solve_medium',    2,  15),
  ('d_hard1',     'daily',  'solve_hard',      1,  20),
  ('d_merge1',    'daily',  'merge_cards',     1,  15),
  ('d_shop1',     'daily',  'shop_buy',        1,  10),
  ('d_ad1',       'daily',  'watch_ad',        1,  5),
  ('d_reward1',   'daily',  'streak',          1,  5),
  ('w_solve10',   'weekly', 'solve',           10, 50),
  ('w_daily5',    'weekly', 'solve_daily',     5,  75),
  ('w_daily7',    'weekly', 'solve_daily',     7,  120),
  ('w_medium8',   'weekly', 'solve_medium',    8,  80),
  ('w_hard5',     'weekly', 'solve_hard',      5,  100),
  ('w_expert3',   'weekly', 'solve_expert',    3,  100),
  ('w_nohint10',  'weekly', 'solve_no_hints',  10, 150),
  ('w_packs3',    'weekly', 'open_pack',       3,  60),
  ('w_merge3',    'weekly', 'merge_cards',     3,  80),
  ('w_ads10',     'weekly', 'watch_ad',        10, 50),
  ('w_reward7',   'weekly', 'streak',          7,  100);

-- The Shop, for coins (sheet "Shop"). Packs: what they hold is in `data` (5 cards; "hints": a 5-hints card; "guaranteed": one
-- card of exactly each rarity listed; the rest random by pack_odds below; "legendaryEvery": the Legendary timer: N packs
-- of that kind opened in a row with no Legendary card, and the Nth holds a guaranteed one in place of a random card). Bought
-- or won packs wait in the inventory until they are opened.
-- Cosmetics have no rows yet: they come with their art, each with a rarity, and are priced by it (50 / 100 / 200 / 400:
-- functions/_lib/app/economy.js COSMETIC_PRICES). Until some exist, a pack cannot be opened (409 empty_pool).
INSERT INTO items (id, kind, price_coins, data) VALUES
  ('pack_bronze', 'pack',        90,   '{"cards":5,"hints":5,"guaranteed":["rare"],"legendaryEvery":30}'),
  ('pack_silver', 'pack',        120,  '{"cards":5,"hints":5,"guaranteed":["epic"],"legendaryEvery":20}'),
  ('pack_gold',   'pack',        300,  '{"cards":5,"hints":0,"guaranteed":["rare","epic"],"legendaryEvery":10}'),
  ('hints_5',     'hint_bundle', 60,   '{"hints":5}'),
  ('hints_15',    'hint_bundle', 160,  '{"hints":15}'),
  ('hints_40',    'hint_bundle', 650,  '{"hints":40}'),
  ('hints_100',   'hint_bundle', 1500, '{"hints":100}');

-- The Shop, for money. `sku` must be the product id created in Play Console (rename here if they differ there).
-- Prices in euros live in Play Console, never here. The three upgrades are permanent (one purchase, never consumed):
-- No ads; Member (No ads, the member badge, 10 free hints a day instead of 5); Golden Member (No ads, the golden badge, 15).
-- Not seeded: the timed promotions (to be decided).
INSERT INTO items (id, kind, sku, data) VALUES
  ('coins_100',  'coin_pack',  'coins_100',  '{"coins":100}'),
  ('coins_500',  'coin_pack',  'coins_500',  '{"coins":500}'),
  ('coins_1200', 'coin_pack',  'coins_1200', '{"coins":1200}'),
  ('coins_2500', 'coin_pack',  'coins_2500', '{"coins":2500}'),
  ('remove_ads', 'remove_ads', 'remove_ads', '{"entitlements":["remove_ads"]}'),
  ('member',      'upgrade',   'member',      '{"entitlements":["remove_ads","member"]}'),
  ('member_gold', 'upgrade',   'member_gold', '{"entitlements":["remove_ads","member_gold"]}'),
  ('noob_kit',   'promo',      'noob_kit',   '{"coins":500,"hints":15,"inventory":{"pack_bronze":1,"pack_silver":1,"pack_gold":1},"once":true}');

-- A random card of any pack: Common 40 %, Rare 30 %, Epic 20 %, Legendary 10 % (sheet "Packs").
INSERT INTO pack_odds (pack_id, rarity, weight) VALUES
  ('pack_bronze', 'common', 40), ('pack_bronze', 'rare', 30), ('pack_bronze', 'epic', 20), ('pack_bronze', 'legendary', 10),
  ('pack_silver', 'common', 40), ('pack_silver', 'rare', 30), ('pack_silver', 'epic', 20), ('pack_silver', 'legendary', 10),
  ('pack_gold',   'common', 40), ('pack_gold',   'rare', 30), ('pack_gold',   'epic', 20), ('pack_gold',   'legendary', 10);

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
