-- Shadoku app: the hideout (app/docs/architecture.md 4.14 "As built: the hideout"; the author's rules: app/docs/product_brief.md
-- "Hideout and cosmetics", app/docs/art-plan/README.md, and of 2026-11-25: each size step bought with coins; once you have an
-- 8 x 8 you can buy another room, which starts again as the smallest and grows). Code: functions/_lib/app/hideout.js,
-- functions/api/app/hideout/**. Apply like the others (npx wrangler d1 migrations apply shadoku --local|--remote). Until it is
-- applied, /api/app/hideout answers 503 "schema" and everything else works as before. Once applied anywhere, never edit it.

-- The hideout as a whole, one per account that wrote anything to it (an account without a row has one empty 4 x 4 room: a
-- GET makes nothing). public, rating_sum, rating_count: for the Social phase (other players' hideouts and their ratings:
-- architecture 4.2). Nothing reads or writes them yet; a guest's hideout is private until it signs in.
CREATE TABLE hideouts (
  account_id TEXT PRIMARY KEY,
  public INTEGER NOT NULL DEFAULT 0,
  rating_sum INTEGER NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0
);

-- Its rooms, numbered from 1. Room 1 is everyone's from the start (it gets its row on its first save or grow); every other room
-- is bought (hideout_settings room_price) and gets its row in the batch that pays for it. Rooms are never deleted by the player
-- (only an erased account loses them).
-- size: the room's side, 4 at the start, one step at a time up to 10 (each step bought: hideout_sizes, the same for every room).
-- layout: JSON, the room's placements [{item, x, y, shape, rot, tier}] (format: functions/_lib/app/hideout.js), at most 16 KB.
-- version: +1 on every saved layout of THIS room; a save names the version it was made from and is refused (409 stale) when
--   another save of the room came first ("the server copy wins", architecture 3.1). Growing does not change it.
CREATE TABLE hideout_rooms (
  account_id TEXT NOT NULL,
  room INTEGER NOT NULL CHECK (room >= 1),
  size INTEGER NOT NULL DEFAULT 4 CHECK (size BETWEEN 4 AND 10),
  layout TEXT NOT NULL DEFAULT '[]' CHECK (length(layout) <= 16384),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, room)
);

-- A room only ever grows.
CREATE TRIGGER hideout_room_never_shrinks BEFORE UPDATE OF size ON hideout_rooms
BEGIN
  SELECT RAISE(ABORT, 'hideout: a room never shrinks') WHERE NEW.size < OLD.size;
END;
CREATE TRIGGER hideout_room_keeps_its_place BEFORE UPDATE OF account_id, room ON hideout_rooms
WHEN NEW.room IS NOT OLD.room
BEGIN
  SELECT RAISE(ABORT, 'hideout: a room keeps its number');
END;

-- What each step of a room costs in coins: the step TO this size (the author, 2026-11-25: 5 x 5 to 10 x 10, each bought; every
-- room the same, each room's steps paid once). These are DATA, first guesses: change them with an ordinary UPDATE (a new
-- migration, or `npx wrangler d1 execute shadoku --remote --command "UPDATE hideout_sizes SET price_coins = ... WHERE size = ..."`).
-- A size with no row cannot be bought (another source can still grant it: hideout.js growStatements).
-- Not in `items`: GET /api/app/shop lists every active item row, and these are not Shop goods.
CREATE TABLE hideout_sizes (
  size INTEGER PRIMARY KEY CHECK (size BETWEEN 5 AND 10),
  price_coins INTEGER NOT NULL CHECK (price_coins > 0)
);
INSERT INTO hideout_sizes (size, price_coins) VALUES
  (5, 100), (6, 200), (7, 350), (8, 500), (9, 750), (10, 1000);

-- The other numbers of the hideout, DATA like the prices (an UPDATE changes them; a missing row falls back to the code's value):
--   room_price      coins for one more room (the author, 2026-11-25: 1000)
--   room_from_size  a room can be bought once the NEWEST room is at least this size (the author: "after you have an 8x8";
--                   read as the newest room, so each room is grown before the next is bought)
--   max_rooms       rooms an account can have, room 1 included (a bound on what one account stores: 16 KB a room)
CREATE TABLE hideout_settings (
  k TEXT PRIMARY KEY,
  v INTEGER NOT NULL CHECK (v >= 0)
);
INSERT INTO hideout_settings (k, v) VALUES ('room_price', 1000), ('room_from_size', 8), ('max_rooms', 10);

-- The ledger lines of the hideout (reason 'hideout'): ref 'room:<n>:size:<s>' for a step of room n, 'room:<n>' for buying room
-- n. Each is paid once per account, ever: the ledger's own key, no extra table.
