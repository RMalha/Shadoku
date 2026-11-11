/**
 * community.js — the browser side of the ranking and the community puzzles (functions/api/ranking.js, functions/api/community/*).
 *
 * Every call answers { ok: true, … } or { error }: "auth" (sign in first), "storage" (the site has no database yet), "network",
 * "invalid" (with `problems`), "own" (rating your own puzzle), "limit", "not_found". Without a backend (npm run dev, a file:// bundle)
 * the community lives in this browser's storage instead (`demo: true`): publishing, playing and rating work, and the ranking
 * lists only this browser's player, so every page can be tried without the server.
 *
 * Signed in with the backend, the ranking numbers follow the progress: after every sync (src/sync.js SYNCED_EVENT) the fulfilled
 * story and daily contracts are sent as ranking entries (src/ranking.js computes the score, on the server too).
 */
import { PUZZLES, readPlayStats, dailyRecords } from "./ShadokuGame.jsx";
import { rankStats, peopleOf } from "./ranking.js";
import { SYNCED_EVENT } from "./sync.js";
import { avatarOf } from "./avatarLook.js";

const JSON_HEADERS = { Accept: "application/json", "Content-Type": "application/json" };
const DEMO_KEY = "shadoku-community-demo", PLAYER_KEY = "shadoku-player-id", PLAYED_KEY = "shadoku-community-played";

/** Only a dev host (npm run dev, a LAN preview, file://) may fall back to the local demo. On the live site a non-JSON reply is a 5xx page or a
 *  rate-limit page: a backend that should answer and does not, so the caller says "network" and nothing is stored as if it had been sent. */
const devHost = () => typeof window === "undefined" || window.location.protocol === "file:"
  || /^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|$)/.test(window.location.hostname);
const noBackend = () => (devHost() ? null : { status: 0, body: { error: "network" } });

async function call(path, init) {
  try {
    const r = await fetch(path, { credentials: "same-origin", ...init, headers: { ...JSON_HEADERS, ...(init?.headers || {}) } });
    if (!/json/.test(r.headers.get("content-type") || "")) return noBackend(); // the SPA's index.html answered: no backend here (a dev host only)
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } catch { return { status: 0, body: { error: "network" } }; }
}
const fail = (r) => ({ error: r.body && r.body.error ? r.body.error : r.status === 401 ? "auth" : "network", ...(r.body && r.body.problems ? { problems: r.body.problems } : {}) });

const readJson = (k) => { try { const v = JSON.parse(window.localStorage.getItem(k) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } };
const writeJson = (k, v) => { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

/* ───────────── ranking ───────────── */
/** This browser's fulfilled story and daily contracts as ranking entries ({ c: contract id, d, s, t, l, k, p, n }: src/ranking.js;
 *  `s` is left out for a daily rotated out of the app, whose cast this browser no longer has). */
export function rankEntries() {
  const pack = [...PUZZLES, ...dailyRecords()], stats = readPlayStats(pack);
  return pack.filter((q) => stats[q.id] && stats[q.id].solved).map((q) => {
    const s = stats[q.id], h = s.hints || {};
    const people = peopleOf(q);
    return { c: String(q.id), d: q.difficulty || "Easy", ...(people ? { s: people } : {}), t: s.best, l: h.look || 0, k: h.key || 0, p: h.place || 0, n: h.note || 0 };
  });
}

/** → { ok, players, me, total, demo? }. `user`: the signed-in profile (the demo ranking shows it alone). */
export async function fetchRanking(user) {
  const r = await call("/api/ranking");
  if (r && r.status === 200) return { ok: true, ...r.body };
  if (r) return fail(r);
  if (!user) return { error: "auth" };
  const me = { rank: 1, codename: user.username, avatar: avatarOf(user), ...rankStats(rankEntries()), me: true };
  return { ok: true, demo: true, players: [me], me, total: 1 };
}

let sent = "";
export const RANKED_EVENT = "shadoku-ranked"; // the server has this player's latest numbers (the Ranking tab reloads)
/** Sends the ranking entries when they changed since the last time (once per page load at least, so a new device catches up). */
export async function pushRanking() {
  const entries = rankEntries(), body = JSON.stringify({ entries });
  if (body === sent) return;
  const r = await call("/api/ranking", { method: "PUT", body });
  if (r && r.status === 200) { sent = body; try { window.dispatchEvent(new Event(RANKED_EVENT)); } catch { /* noop */ } }
}
if (typeof window !== "undefined") window.addEventListener(SYNCED_EVENT, () => { pushRanking().catch(() => {}); });

/* ───────────── community puzzles ───────────── */
const demoStore = () => { const s = readJson(DEMO_KEY); return { puzzles: s.puzzles || {}, ratings: s.ratings || {} }; };
const saveDemo = (s) => writeJson(DEMO_KEY, s);
const DIFF_RANK = { "Very Easy": 1, Easy: 2, Medium: 3, Hard: 4, Expert: 5 };
const avg = (m) => (m.ratings ? Math.round((m.ratingSum / m.ratings) * 10) / 10 : 0);
/** The list's order (the backend sorts the same way): stars, plays, difficulty or newest; `order` "asc" | "desc". */
export function sortPuzzles(list, sort, order) {
  const dir = order === "asc" ? 1 : -1;
  const key = { stars: (p) => [p.stars, p.ratings], plays: (p) => [p.plays], difficulty: (p) => [DIFF_RANK[p.difficulty] || 0], new: (p) => [p.created] }[sort] || ((p) => [p.created]);
  return [...list].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return (ka[i] - kb[i]) * dir;
    return b.created - a.created;
  });
}

/** → { ok, puzzles: [list row], demo? } (list row: id, title, theme, size, difficulty, suspects, created, plays, solves, stars, ratings, author, avatar, mine). */
export async function listCommunity({ size = 0, sort = "new", order = "desc" } = {}) {
  const q = new URLSearchParams({ sort, order, ...(size ? { size: String(size) } : {}) });
  const r = await call(`/api/community?${q}`);
  if (r && r.status === 200) return { ok: true, puzzles: r.body.puzzles || [] };
  if (r) return fail(r);
  const s = demoStore();
  const rows = Object.values(s.puzzles).map((x) => ({ ...x.meta, stars: avg(x.meta) })).filter((m) => !size || m.size === size);
  return { ok: true, demo: true, puzzles: sortPuzzles(rows, sort, order) };
}

/** → { ok, puzzle (case JSON), meta, myRating, demo? } */
export async function getCommunity(id) {
  const r = await call(`/api/community/${encodeURIComponent(id)}`);
  if (r && r.status === 200) return { ok: true, ...r.body };
  if (r) return fail(r);
  const s = demoStore(), x = s.puzzles[id];
  if (!x) return { error: "not_found" };
  return { ok: true, demo: true, puzzle: x.data, meta: { ...x.meta, stars: avg(x.meta) }, myRating: s.ratings[id] || 0 };
}

/** Publishes a case built by the creator → { ok, id }. `user` signs the demo copy. */
export async function publishCommunity(puzzle, difficulty, user) {
  const r = await call("/api/community", { method: "POST", body: JSON.stringify({ puzzle, difficulty }) });
  if (r && r.status === 201) return { ok: true, id: r.body.id };
  if (r) return fail(r);
  if (!user) return { error: "auth" };
  const s = demoStore(), id = `c${Math.random().toString(36).slice(2, 12).padEnd(10, "0")}`;
  const data = { ...puzzle, id, community: true, difficulty };
  s.puzzles[id] = { data, meta: { id, title: data.title, theme: data.theme, size: data.rooms.length, difficulty, suspects: data.suspects.length, created: Date.now(), plays: 0, solves: 0, ratingSum: 0, ratings: 0, author: user.username, avatar: avatarOf(user), mine: true } };
  saveDemo(s);
  return { ok: true, id, demo: true };
}

/** The author takes a puzzle down → { ok }. */
export async function deleteCommunity(id) {
  const r = await call(`/api/community/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (r && r.status === 200) return { ok: true };
  if (r) return fail(r);
  const s = demoStore();
  delete s.puzzles[id]; delete s.ratings[id];
  saveDemo(s);
  return { ok: true, demo: true };
}

/** 1–5 stars → { ok, stars, avg, count }. */
export async function rateCommunity(id, stars) {
  const r = await call(`/api/community/${encodeURIComponent(id)}/rate`, { method: "PUT", body: JSON.stringify({ stars }) });
  if (r && r.status === 200) return { ok: true, ...r.body };
  if (r) return fail(r);
  const s = demoStore(), x = s.puzzles[id];
  if (!x) return { error: "not_found" };
  if (x.meta.mine) return { error: "own" };
  const prev = s.ratings[id] || 0;
  x.meta.ratingSum += stars - prev; x.meta.ratings += prev ? 0 : 1; s.ratings[id] = stars;
  saveDemo(s);
  return { ok: true, demo: true, stars, avg: avg(x.meta), count: x.meta.ratings };
}

/** This browser's random player id (counts plays of players who are not signed in, once per puzzle). */
function playerId() {
  try {
    let v = window.localStorage.getItem(PLAYER_KEY);
    if (!v || !/^[A-Za-z0-9_-]{16,48}$/.test(v)) {
      v = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[b % 64]).join("");
      window.localStorage.setItem(PLAYER_KEY, v);
    }
    return v;
  } catch { return ""; }
}
/** The puzzle was opened (`solved` false) or fulfilled (true): counted once per player each. */
export async function reportPlay(id, solved = false) {
  const seen = readJson(PLAYED_KEY), was = seen[id] || 0, now = solved ? 2 : 1;
  if (was >= now) return;
  const r = await call(`/api/community/${encodeURIComponent(id)}/play`, { method: "POST", body: JSON.stringify({ player: playerId(), solved }) });
  if (r && r.status !== 200) return;
  if (!r) {
    const s = demoStore(), x = s.puzzles[id];
    if (x) { if (!was) x.meta.plays++; if (solved) x.meta.solves++; saveDemo(s); }
  }
  writeJson(PLAYED_KEY, { ...seen, [id]: now });
}
