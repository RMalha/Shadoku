-- Shadoku app: the hideout's rooms on ONE board (the author, 2026-11-25; app/docs/architecture.md 4.18). Code:
-- functions/_lib/app/hideout.js (the formats and the rules), functions/api/app/hideout/**. Apply like the others
-- (npx wrangler d1 migrations apply shadoku --local|--remote, and for the test server
-- npx wrangler d1 migrations apply shadoku-test --remote --env preview). Until it is applied, /api/app/hideout answers 503
-- "schema" and everything else works as before. Once applied anywhere remote, never edit it.
--
-- Every room of an account sits on one board, all connected. New columns on hideout_rooms (defaults keep every row valid):
--   x, y    board coordinates of the room's top-left tile. Room 1 is at (0, 0); a bought room is placed where the player
--           chooses, touching another room along at least one full tile edge and overlapping none. Every tile of every room
--           stays in -64..64 (hideout.js BOARD_MIN / BOARD_MAX; the triggers below; the CHECKs only bound the top-left).
--   grow    the corner the room grows toward, chosen when it is bought: 'se' right and down (room 1 and every room before this
--           migration), 'sw' left and down, 'ne' right and up, 'nw' left and up. Growing one step keeps the opposite corner
--           where it is, so x goes down by 1 for 'sw' / 'nw' and y for 'ne' / 'nw'; the room's layout and edges (in room
--           coordinates) shift with it in the same statement (hideout.js growStatements), so nothing moves on the board.
--   name    "" (the app shows "Room N") or the player's name for it: at most 24 characters, trimmed, no control characters
--           (hideout.js checks the characters; the CHECK only the length)
--   floor   the floor art: one of hideout.js FLOORS (the board's floor patterns, src/ShadokuArt.jsx FLOORS / FloorDefs)
--   edges   JSON, the walls, windows and doors on the room's tile edges [{x, y, side, kind}] (format: hideout.js), at most 16 KB
ALTER TABLE hideout_rooms ADD COLUMN x INTEGER NOT NULL DEFAULT 0 CHECK (x BETWEEN -64 AND 64);
ALTER TABLE hideout_rooms ADD COLUMN y INTEGER NOT NULL DEFAULT 0 CHECK (y BETWEEN -64 AND 64);
ALTER TABLE hideout_rooms ADD COLUMN grow TEXT NOT NULL DEFAULT 'se' CHECK (grow IN ('se', 'sw', 'ne', 'nw'));
ALTER TABLE hideout_rooms ADD COLUMN name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 24);
ALTER TABLE hideout_rooms ADD COLUMN floor TEXT NOT NULL DEFAULT 'parquet';
ALTER TABLE hideout_rooms ADD COLUMN edges TEXT NOT NULL DEFAULT '[]' CHECK (length(edges) <= 16384);

-- Rooms bought before this migration (production has none; the test server may): room 1 stays at (0, 0) and every later room
-- is put against the room before it, in a staircase (an even room to its right, an odd room below it, top or left edges
-- aligned), so no two overlap and every tile stays inside the bound (room 10 of ten 10 x 10 rooms: x 50..59, y 40..49). Each
-- gets one door in the middle of the edge it shares with the room before (a shared edge is kept by the newer room:
-- hideout.js). All of them grow right and down ('se'), as they did.
WITH RECURSIVE place (account_id, room, x, y, size, edges) AS (
  SELECT account_id, room, 0, 0, size, '[]' FROM hideout_rooms WHERE room = 1
  UNION ALL
  SELECT r.account_id, r.room,
    CASE WHEN r.room % 2 = 0 THEN p.x + p.size ELSE p.x END,
    CASE WHEN r.room % 2 = 0 THEN p.y ELSE p.y + p.size END,
    r.size,
    CASE WHEN r.room % 2 = 0
      THEN json_array(json_object('x', 0, 'y', (MIN(p.size, r.size) - 1) / 2, 'side', 'left', 'kind', 'door'))
      ELSE json_array(json_object('x', (MIN(p.size, r.size) - 1) / 2, 'y', 0, 'side', 'top', 'kind', 'door')) END
  FROM place p JOIN hideout_rooms r ON r.account_id = p.account_id AND r.room = p.room + 1
)
UPDATE hideout_rooms SET
  x = (SELECT p.x FROM place p WHERE p.account_id = hideout_rooms.account_id AND p.room = hideout_rooms.room),
  y = (SELECT p.y FROM place p WHERE p.account_id = hideout_rooms.account_id AND p.room = hideout_rooms.room),
  edges = (SELECT p.edges FROM place p WHERE p.account_id = hideout_rooms.account_id AND p.room = hideout_rooms.room)
WHERE room > 1 AND EXISTS (SELECT 1 FROM place p WHERE p.account_id = hideout_rooms.account_id AND p.room = hideout_rooms.room);

-- A room moves only by growing toward its corner, and keeps that corner (moving rooms could come later: it would change this
-- trigger and re-check overlap, bounds and doors).
CREATE TRIGGER hideout_room_stays_put BEFORE UPDATE OF x, y, size, grow ON hideout_rooms
WHEN NEW.grow IS NOT OLD.grow
  OR NEW.x IS NOT OLD.x - (CASE WHEN OLD.grow IN ('sw', 'nw') THEN NEW.size - OLD.size ELSE 0 END)
  OR NEW.y IS NOT OLD.y - (CASE WHEN OLD.grow IN ('ne', 'nw') THEN NEW.size - OLD.size ELSE 0 END)
BEGIN
  SELECT RAISE(ABORT, 'hideout: a room stays where it was placed (it moves only by growing toward its corner)');
END;

-- No two rooms of an account share a tile, and every tile stays on the board: not when a room is added, not when one grows
-- (hideout.js checks first and its statements are guarded; these are the database's own last word).
CREATE TRIGGER hideout_room_no_overlap_insert BEFORE INSERT ON hideout_rooms
BEGIN
  SELECT RAISE(ABORT, 'hideout: rooms overlap') WHERE EXISTS (SELECT 1 FROM hideout_rooms o WHERE o.account_id = NEW.account_id
    AND o.room <> NEW.room AND o.x < NEW.x + NEW.size AND NEW.x < o.x + o.size AND o.y < NEW.y + NEW.size AND NEW.y < o.y + o.size);
  SELECT RAISE(ABORT, 'hideout: a room off the board') WHERE NEW.x < -64 OR NEW.y < -64 OR NEW.x + NEW.size - 1 > 64 OR NEW.y + NEW.size - 1 > 64;
END;
CREATE TRIGGER hideout_room_no_overlap_grow BEFORE UPDATE OF size ON hideout_rooms
BEGIN
  SELECT RAISE(ABORT, 'hideout: rooms overlap') WHERE EXISTS (SELECT 1 FROM hideout_rooms o WHERE o.account_id = NEW.account_id
    AND o.room <> NEW.room AND o.x < NEW.x + NEW.size AND NEW.x < o.x + o.size AND o.y < NEW.y + NEW.size AND NEW.y < o.y + o.size);
  SELECT RAISE(ABORT, 'hideout: a room off the board') WHERE NEW.x < -64 OR NEW.y < -64 OR NEW.x + NEW.size - 1 > 64 OR NEW.y + NEW.size - 1 > 64;
END;
