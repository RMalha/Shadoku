/**
 * The D1 database behind the ranking and the community puzzles (binding SHADOKU_DB, see wrangler.toml).
 * Without the binding these endpoints answer 503 "storage" and the pages say the feature is unavailable; sign-in and the
 * game are not affected. The tables are created on first use, so a new database needs no migration step.
 *
 *   players   one row per signed-in player who synced progress: codename, avatar (resolved: "", an https URL or an "L:" portrait), the ranking numbers;
 *             `reset` 1 = reset by tools/reset_ranking.py and not synced since, `excluded` = JSON list of the contract ids that no longer count
 *   puzzles   community puzzles: the case JSON (`data`), its search fields and its counters
 *   ratings   one row per player and puzzle (1–5 stars; a new rating replaces the old one)
 *   plays     one row per player (an account id, or "anon:<browser id>") and puzzle; `solved` once they fulfilled it
 */
import { json } from "./auth.js";

/** An avatar choice: "" (S. H. Adow), "photo" or an "L:" portrait (src/avatarLook.js has the same pattern; it imports the art, so not shared). */
export const AVATAR_RE = /^(|photo|L:[A-Za-z0-9.]{1,200})$/;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, codename TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT '', solved INTEGER NOT NULL DEFAULT 0,
    hints INTEGER NOT NULL DEFAULT 0, seconds INTEGER NOT NULL DEFAULT 0, speed INTEGER NOT NULL DEFAULT 0, score INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL,
    reset INTEGER NOT NULL DEFAULT 0, excluded TEXT NOT NULL DEFAULT '[]')`,
  "CREATE INDEX IF NOT EXISTS players_rank ON players (score DESC, solved DESC, seconds ASC)",
  `CREATE TABLE IF NOT EXISTS puzzles (id TEXT PRIMARY KEY, author_id TEXT NOT NULL, author TEXT NOT NULL, author_avatar TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL, theme TEXT NOT NULL, size INTEGER NOT NULL, difficulty TEXT NOT NULL, diff_rank INTEGER NOT NULL, suspects INTEGER NOT NULL,
    data TEXT NOT NULL, created INTEGER NOT NULL, plays INTEGER NOT NULL DEFAULT 0, solves INTEGER NOT NULL DEFAULT 0,
    rating_sum INTEGER NOT NULL DEFAULT 0, rating_count INTEGER NOT NULL DEFAULT 0)`,
  "CREATE INDEX IF NOT EXISTS puzzles_author ON puzzles (author_id)",
  "CREATE TABLE IF NOT EXISTS ratings (puzzle_id TEXT NOT NULL, user_id TEXT NOT NULL, stars INTEGER NOT NULL, PRIMARY KEY (puzzle_id, user_id))",
  "CREATE INDEX IF NOT EXISTS ratings_user ON ratings (user_id)",
  "CREATE TABLE IF NOT EXISTS plays (puzzle_id TEXT NOT NULL, player TEXT NOT NULL, solved INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (puzzle_id, player))",
  "CREATE INDEX IF NOT EXISTS plays_player ON plays (player)",
];

/** Columns added after the first release: a database made before them gets them on first use (CREATE TABLE IF NOT EXISTS skips an existing table). */
const ADDED = { players: { reset: "INTEGER NOT NULL DEFAULT 0", excluded: "TEXT NOT NULL DEFAULT '[]'" } };

async function migrate(d) {
  await d.batch(SCHEMA.map((q) => d.prepare(q)));
  for (const [table, cols] of Object.entries(ADDED)) {
    const have = new Set((await d.prepare(`PRAGMA table_info(${table})`).all()).results.map((r) => r.name));
    for (const [col, type] of Object.entries(cols)) {
      if (have.has(col)) continue;
      // two isolates can race to add the same column: the loser's "duplicate column" is fine
      await d.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run().catch((e) => { if (!/duplicate column/i.test(String(e && e.message))) throw e; });
    }
  }
}

let ready = null; // one schema check per isolate

/** → the D1 database with its tables, or null when the binding is missing. */
export async function db(env) {
  const d = env.SHADOKU_DB;
  if (!d) return null;
  if (!ready) ready = migrate(d).catch((e) => { ready = null; throw e; });
  await ready;
  return d;
}

export const noStorage = () => json({ error: "storage" }, 503);

/** Reads a JSON body of at most `max` bytes → the object, or null. */
export async function readBody(request, max) {
  const text = await request.text();
  if (text.length > max) return null;
  try { const v = JSON.parse(text); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}

/** An avatar URL worth showing to other players: https, short, no quotes. */
export const cleanAvatar = (u) => (typeof u === "string" && /^https:\/\/[^\s"'<>]{1,480}$/.test(u) ? u : "");
/** The avatar other players see, from the account's choice (src/avatarLook.js): "" (S. H. Adow), the session's picture URL, or the "L:" portrait. */
export const shownAvatar = (choice, s) => (choice === "photo" ? cleanAvatar(s.avatar) : AVATAR_RE.test(choice || "") && choice.startsWith("L:") ? choice : "");

/** The account chose another avatar: its ranking row and its community puzzles follow. */
export async function setPlayerAvatar(env, id, shown) {
  const d = await db(env).catch(() => null);
  if (!d) return;
  await d.batch([
    d.prepare("UPDATE players SET avatar = ?1 WHERE id = ?2").bind(shown, id),
    d.prepare("UPDATE puzzles SET author_avatar = ?1 WHERE author_id = ?2").bind(shown, id),
  ]);
}

/** The account's codename changed: the ranking row follows (the community puzzles read it from there). */
export async function renamePlayer(env, id, name) {
  const d = await db(env).catch(() => null);
  if (!d) return;
  await d.batch([
    d.prepare("UPDATE players SET codename = ?1 WHERE id = ?2").bind(name, id),
    d.prepare("UPDATE puzzles SET author = ?1 WHERE author_id = ?2").bind(name, id),
  ]);
}

/** The account is being deleted: its ranking row, its ratings and plays, and the puzzles it published (with their ratings and plays). */
export async function erasePlayer(env, id) {
  const d = await db(env).catch(() => null);
  if (!d) return;
  const rated = (await d.prepare("SELECT puzzle_id FROM ratings WHERE user_id = ?1").bind(id).all()).results.map((r) => r.puzzle_id);
  await d.batch([
    d.prepare("DELETE FROM ratings WHERE puzzle_id IN (SELECT id FROM puzzles WHERE author_id = ?1)").bind(id),
    d.prepare("DELETE FROM plays WHERE puzzle_id IN (SELECT id FROM puzzles WHERE author_id = ?1)").bind(id),
    d.prepare("DELETE FROM puzzles WHERE author_id = ?1").bind(id),
    d.prepare("DELETE FROM ratings WHERE user_id = ?1").bind(id),
    d.prepare("DELETE FROM plays WHERE player = ?1").bind(id),
    d.prepare("DELETE FROM players WHERE id = ?1").bind(id),
  ]);
  if (rated.length) await d.batch(rated.map((pid) => recountRatings(d, pid)));
}

/** The statement that recomputes a puzzle's rating counters from its ratings. */
export const recountRatings = (d, pid) => d.prepare(
  "UPDATE puzzles SET rating_sum = (SELECT COALESCE(SUM(stars), 0) FROM ratings WHERE puzzle_id = ?1), rating_count = (SELECT COUNT(*) FROM ratings WHERE puzzle_id = ?1) WHERE id = ?1",
).bind(pid);
