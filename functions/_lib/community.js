/**
 * Community puzzles: what the backend stores of a published case, and how a list row looks.
 * A case is checked with src/creatorCore.js (structure, the laws, every clue true on the stored solution) and rebuilt from the
 * fields the game reads, so nothing else a client sends is kept. Uniqueness is the creator's job (its solver runs in the browser).
 */
import { checkCase, clueTokensOf, DIFFICULTIES } from "../../src/creatorCore.js";

export const MAX_CASE_BYTES = 96 * 1024;
export const MAX_PER_AUTHOR = 50;
export const DIFF_RANK = Object.fromEntries(DIFFICULTIES.map((d, i) => [d, i + 1]));
export const ID_RE = /^c[a-z0-9]{10}$/;
export const newId = () => `c${Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("")}`;

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const TRAIT_FIELDS = { hairStyle: 16, hairLength: 16, hairColor: 16, glassesStyle: 16, hat: 16, facialHair: 16, tie: 16 };
const cleanTraits = (t) => {
  if (!t || typeof t !== "object") return null;
  const out = {};
  Object.entries(TRAIT_FIELDS).forEach(([k, n]) => { if (typeof t[k] === "string") out[k] = str(t[k], n); });
  out.glasses = !!t.glasses;
  ["skin", "cloth"].forEach((k) => { if (Number.isInteger(t[k]) && t[k] >= 0 && t[k] < 16) out[k] = t[k]; });
  return out;
};

/** → { problems } or { data } (the case to store, with the given id and difficulty). */
export function cleanCase(d, id, difficulty) {
  if (!DIFFICULTIES.includes(difficulty)) return { problems: ["unknown difficulty"] };
  const problems = checkCase(d);
  if (problems.length) return { problems };
  const n = d.rooms.length;
  const data = {
    id, community: true, engine: "community-1", title: d.title.trim(), theme: d.theme, difficulty, size: n, shape: "rect",
    zoneWord: d.zoneWord === "area" ? "area" : "room", surface: str(d.surface, 16) || "FLOOR",
    rooms: d.rooms, roomIds: d.roomIds, roomNames: d.roomNames, doors: d.doors, windows: [], contents: d.contents, multiTile: [],
    corpse: d.corpse, propClasses: d.propClasses,
    suspects: d.suspects.map((s) => ({
      id: s.id, name: s.name, gender: s.gender, pronoun: s.gender === "m" ? "he" : "she", traits: cleanTraits(s.traits), look: str(s.look, 160),
      clue: str(s.clue, 400), text: str(s.clue, 400), atoms: s.atoms.map((a) => ({ kind: a.kind, subject: s.id, params: a.params })),
      clueTokens: clueTokensOf(s.id, s.atoms), solution: s.solution,
    })),
    shadow: d.shadow,
    shadowSuspect: { id: "S", name: "S. H. Adow", gender: null, traits: null },
    globalRules: [], steps: [],
  };
  return { data };
}

/** A puzzles row (joined with the author's players row) → the list entry the pages show. */
export const listRow = (r, me) => ({
  id: r.id, title: r.title, theme: r.theme, size: r.size, difficulty: r.difficulty, suspects: r.suspects, created: r.created,
  plays: r.plays, solves: r.solves, stars: r.rating_count ? Math.round((r.rating_sum / r.rating_count) * 10) / 10 : 0, ratings: r.rating_count,
  author: r.codename || r.author, avatar: (r.codename != null ? r.avatar : r.author_avatar) || "", mine: !!me && r.author_id === me,
});

export const SELECT_ROW = "SELECT puzzles.*, players.codename AS codename, players.avatar AS avatar FROM puzzles LEFT JOIN players ON players.id = puzzles.author_id";
