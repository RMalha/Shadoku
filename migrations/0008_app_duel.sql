-- Shadoku app: the live 1v1 (app/docs/architecture.md 4.20 "The 1v1 as designed"; the author's rules: product_brief.md
-- "1v1, redesigned (author, 2026-11-25)"). Code: functions/_lib/app/duel.js and duel_rules.js, endpoints /api/app/duel/**.
-- The match is the server's: it holds the three boards and their answers, the clocks, who finished first and, at a timeout,
-- how many scapegoats each player had right. The phone sends placements and reads the state back once a second.
-- Until this is applied the duel endpoints answer 503 "schema" and everything else works as before.
-- Once applied anywhere, never edit it: add a new migration.

-- The boards a match is dealt from: one 5 x 5, one 6 x 6 and one 7 x 7. Loaded by `node scripts/duel-pool-push.mjs` from
-- engine/puzzles_duel, never by hand. A board is immutable: a changed case is a new id, the old one is switched off.
--   body      the player's copy of the case JSON: no answers, no walkthrough, no hints, no Puzzle ID (duel_rules.js poolRow)
--   solution  {"sg": {"A": [r, c], ...}, "hid": {"S": [r, c]}}: the scapegoats' tiles and S. H. Adow's. Never sent to a phone.
--   walk      [["B", 1], ["A", 1], ["F", 3], ...]: the solver's order of placements and how many steps each took: what a bot
--             follows while no recording of that board exists
CREATE TABLE duel_pool (
  id TEXT PRIMARY KEY,
  size INTEGER NOT NULL CHECK (size IN (5, 6, 7)),
  difficulty TEXT NOT NULL,
  people INTEGER NOT NULL CHECK (people >= 1),
  body TEXT NOT NULL,
  solution TEXT NOT NULL,
  walk TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  added INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX duel_pool_size ON duel_pool (size, active);

-- Which board each player has been dealt, and when last: a board is not dealt to a player again while that size has one the
-- player has not had; after that the one seen longest ago returns.
CREATE TABLE duel_dealt (
  account_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  times INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (account_id, board_id)
);

-- Elo, from 1000. The row is made the first time an account joins the ranked queue and changes only in the batch that
-- closes a ranked match (duel.js is the only code that writes it: scripts/test-duel.mjs checks). streak: ranked matches
-- won in a row. The counts are what the 1v1 achievements will read (played, streak, best_rating).
CREATE TABLE duel_ratings (
  account_id TEXT PRIMARY KEY,
  rating INTEGER NOT NULL DEFAULT 1000,
  played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  best_rating INTEGER NOT NULL DEFAULT 1000,
  updated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX duel_ratings_rank ON duel_ratings (rating DESC);

-- Who is waiting. invite_id NULL: the ranked queue (an opponent by rating, then anyone, then a bot). Otherwise the room of
-- that friendly invitation: only its other party can join, and there is no bot. seen: the last poll; a row not seen for a
-- few seconds is nobody's opponent. The row goes when the match is made, when the player leaves or when the wait runs out.
CREATE TABLE duel_queue (
  account_id TEXT PRIMARY KEY,
  invite_id TEXT,
  rating INTEGER NOT NULL,
  joined INTEGER NOT NULL,
  seen INTEGER NOT NULL
);
CREATE INDEX duel_queue_room ON duel_queue (invite_id, seen);

-- A match: best of three boards. a, b: the two accounts (b NULL: a bot; 'erased' once that account was deleted).
--   a_rating, b_rating  when the match was made (a bot's: the rating it stands in for)
--   a_k, b_k            each player's K, fixed when the match was made
--   boards              ["<5 x 5 id>", "<6 x 6 id>", "<7 x 7 id>"], chosen when the match was made
--   bot                 a bot's plan for each of the three boards: [{"source": "walk" | "recording", "ms", "track"}], else NULL
--   board               the board being played, 1 to 3: its duel_boards row is open while the match is live
--   a_seq, b_seq        the number of each player's last accepted event (events are applied once, in order)
--   a_op, b_op          the batch that accepted that event
--   a_seen, b_seen      the last time each player was heard from (noted every few seconds)
--   result              'a' | 'b' | 'draw'; how: 'boards' (played out), 'forfeit' (the other was away too long), 'left'
--   a_delta, b_delta    what the match did to each rating (NULL: friendly, or no row to change)
CREATE TABLE duel_matches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('ranked', 'friendly')),
  a TEXT NOT NULL,
  b TEXT,
  a_name TEXT NOT NULL DEFAULT '',
  b_name TEXT NOT NULL DEFAULT '',
  a_avatar TEXT NOT NULL DEFAULT '',
  b_avatar TEXT NOT NULL DEFAULT '',
  a_rating INTEGER NOT NULL,
  b_rating INTEGER NOT NULL,
  a_k INTEGER NOT NULL DEFAULT 0,
  b_k INTEGER NOT NULL DEFAULT 0,
  boards TEXT NOT NULL,
  bot TEXT,
  created INTEGER NOT NULL,
  board INTEGER NOT NULL DEFAULT 1 CHECK (board BETWEEN 1 AND 3),
  a_wins INTEGER NOT NULL DEFAULT 0,
  b_wins INTEGER NOT NULL DEFAULT 0,
  a_seq INTEGER NOT NULL DEFAULT 0,
  b_seq INTEGER NOT NULL DEFAULT 0,
  a_op TEXT,
  b_op TEXT,
  a_seen INTEGER NOT NULL,
  b_seen INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'live' CHECK (state IN ('live', 'done')),
  result TEXT CHECK (result IN ('a', 'b', 'draw')),
  how TEXT CHECK (how IN ('boards', 'forfeit', 'left')),
  ended INTEGER,
  a_delta INTEGER,
  b_delta INTEGER,
  invite_id TEXT,
  op TEXT NOT NULL,
  end_op TEXT
);
CREATE INDEX duel_matches_a ON duel_matches (a, state, created);
CREATE INDEX duel_matches_b ON duel_matches (b, state, created);
CREATE INDEX duel_matches_live ON duel_matches (state) WHERE state = 'live';

-- One live match per account. duel.js guards its INSERT the same way; this is the database's own word on it.
CREATE TRIGGER duel_one_live_match BEFORE INSERT ON duel_matches
WHEN EXISTS (SELECT 1 FROM duel_matches m WHERE m.state = 'live' AND (m.a IN (NEW.a, NEW.b) OR m.b IN (NEW.a, NEW.b)))
BEGIN SELECT RAISE(ABORT, 'duel: a player is already in a match'); END;

-- A finished match is final: its result, score and rating changes are never rewritten (deleting an account only replaces
-- its id by 'erased').
CREATE TRIGGER duel_match_is_final BEFORE UPDATE ON duel_matches
WHEN OLD.state = 'done' AND (NEW.state <> 'done' OR NEW.result IS NOT OLD.result OR NEW.how IS NOT OLD.how OR NEW.ended IS NOT OLD.ended
  OR NEW.a_wins <> OLD.a_wins OR NEW.b_wins <> OLD.b_wins OR NEW.a_delta IS NOT OLD.a_delta OR NEW.b_delta IS NOT OLD.b_delta OR NEW.kind <> OLD.kind)
BEGIN SELECT RAISE(ABORT, 'duel: a finished match does not change'); END;

-- A match's boards, one row from the moment its countdown starts. starts_at: when both may play (10 seconds after the match
-- was made or the board before ended); deadline: starts_at + 3 minutes. Open while ended_at is NULL.
--   winner     'a' | 'b' | 'tie'
--   how        'finish' (someone had every tile right), 'timeout' (decided on correctly placed scapegoats), 'forfeit'
--   a_ms, b_ms the time each took to finish (NULL: did not finish)
--   a_correct, b_correct  correctly placed scapegoats when the board ended
CREATE TABLE duel_boards (
  match_id TEXT NOT NULL,
  n INTEGER NOT NULL CHECK (n BETWEEN 1 AND 3),
  board_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  deadline INTEGER NOT NULL,
  ended_at INTEGER,
  winner TEXT CHECK (winner IN ('a', 'b', 'tie')),
  how TEXT CHECK (how IN ('finish', 'timeout', 'forfeit')),
  a_ms INTEGER,
  b_ms INTEGER,
  a_correct INTEGER,
  b_correct INTEGER,
  end_op TEXT,
  PRIMARY KEY (match_id, n)
);
CREATE INDEX duel_boards_open ON duel_boards (deadline) WHERE ended_at IS NULL;

-- A board's result is written once.
CREATE TRIGGER duel_board_is_final BEFORE UPDATE ON duel_boards
WHEN OLD.ended_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'duel: a finished board does not change'); END;

-- What each player did on each board: the placements with the server's times, written as they arrive (the server needs
-- them to judge the board) and closed with the board. track: [[ms, "A", [r, c]], [ms, "A", null], ...], ms since the
-- board's start, null = taken off the board. placed: pieces on the board now (what the opponent is shown). events: how
-- many were accepted. solved, ms, correct, at: set when the board ends.
-- ranked = 1: kept, and what a bot replays (a solved one, at a rating near the player it faces). A friendly match's rows
-- are deleted when the match ends: it counts for nothing.
CREATE TABLE duel_recordings (
  match_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  seat TEXT NOT NULL CHECK (seat IN ('a', 'b')),
  account_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  ranked INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  track TEXT NOT NULL DEFAULT '[]',
  placed INTEGER NOT NULL DEFAULT 0,
  events INTEGER NOT NULL DEFAULT 0,
  solved INTEGER,
  ms INTEGER,
  correct INTEGER,
  at INTEGER,
  PRIMARY KEY (match_id, n, seat)
);
CREATE INDEX duel_recordings_board ON duel_recordings (board_id, ranked, solved, rating);
CREATE INDEX duel_recordings_account ON duel_recordings (account_id);

-- A friendly invitation: what the Inbox shows the invited player (kind "duel_invite"; until the Inbox is built,
-- GET /api/app/duel/invites lists them). account_id invited to_account; both names as they were then. Open for a day.
-- Either party enters its room (duel_queue.invite_id); the match starts when both are in it, and the invitation is used up.
CREATE TABLE duel_invites (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  to_account TEXT NOT NULL,
  from_name TEXT NOT NULL DEFAULT '',
  to_name TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'declined', 'cancelled', 'played')),
  answered INTEGER,
  match_id TEXT
);
CREATE UNIQUE INDEX duel_invites_pair ON duel_invites (account_id, to_account) WHERE state = 'open';
CREATE INDEX duel_invites_to ON duel_invites (to_account, state);
