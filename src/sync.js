/**
 * sync.js — the signed-in player's progress, the same on every device (functions/api/progress.js keeps one copy per account).
 *
 * The game keeps playing from this browser's storage; this module only merges it with the account's copy:
 *   · on page load, once the backend says who is signed in (src/auth.js → startSync): pull, merge, save both ways
 *   · after a change (the game calls markProgress): a push, soon after a solve, otherwise at most every PUSH_MS
 *   · when the page is hidden or closed: a last sync
 * Every push pulls first and merges, so two devices never wipe each other's progress. The merge:
 *   best times   the faster one              unlocks, initiation   done on either device
 *   boards       per contract, the copy changed last (its clock comes with it; BOARD_AT stamps each save)
 * Without a backend (vite dev, file://) or signed out, nothing here runs. A pull that changed this browser's storage fires
 * PROGRESS_EVENT (useProgressTick) and UMBRA_EVENT, so open pages re-read it.
 */
import { useEffect, useState } from "react";

export const BOARDS_KEY = "shadoku-playtester-v1", TIMES_KEY = "shadoku-times-v1", BESTS_KEY = "shadoku-best-v1";
const BOARD_AT = "shadoku-board-at"; // { [contract id]: ms of the board's last save }
const FLAG_KEYS = ["shadoku-tutorial-done", "shadoku-unlocked-4101", "shadoku-unlocked-4201"]; // "1" once set (ShadokuHome TUTORIAL_KEY, umbra.jsx UNLOCK_KEY)
export const PROGRESS_EVENT = "shadoku-progress";
export const SYNCED_EVENT = "shadoku-synced"; // after every sync with the account (src/community.js sends the ranking numbers then)
const UMBRA_EVENT = "shadoku-umbra";
const PUSH_MS = 30000, PUSH_SOON_MS = 2000; // KV has a daily write budget: a push per change would spend it

const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const readJson = (k) => { try { const v = JSON.parse(window.localStorage.getItem(k) || "{}"); return isObj(v) ? v : {}; } catch { return {}; } };
const writeRaw = (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* private mode */ } };

/** This browser's progress as one object. */
function readLocal() {
  const flags = {};
  FLAG_KEYS.forEach((k) => { try { if (window.localStorage.getItem(k) === "1") flags[k] = 1; } catch { /* noop */ } });
  return { v: 1, boards: readJson(BOARDS_KEY), at: readJson(BOARD_AT), times: readJson(TIMES_KEY), bests: readJson(BESTS_KEY), flags };
}

/** Two progress objects → one (see the header). `a` wins ties: pass this browser's copy first. */
export function mergeProgress(a, b) {
  const x = { boards: {}, at: {}, times: {}, bests: {}, flags: {}, ...a }, y = { boards: {}, at: {}, times: {}, bests: {}, flags: {}, ...(isObj(b) ? b : {}) };
  const out = { v: 1, boards: {}, at: {}, times: {}, bests: {}, flags: { ...y.flags, ...x.flags } };
  const ids = new Set([...Object.keys(x.boards), ...Object.keys(y.boards), ...Object.keys(x.times), ...Object.keys(y.times)]);
  ids.forEach((id) => {
    const hasX = id in x.boards, hasY = id in y.boards;
    const src = hasX && hasY ? ((+y.at[id] || 0) > (+x.at[id] || 0) ? y : x) : hasY ? y : hasX ? x : null;
    if (src) {
      out.boards[id] = src.boards[id];
      if (src.at[id]) out.at[id] = src.at[id];
      if (id in src.times) out.times[id] = src.times[id];
    } else out.times[id] = Math.max(+x.times[id] || 0, +y.times[id] || 0); // a clock without a board on either side
  });
  new Set([...Object.keys(x.bests), ...Object.keys(y.bests)]).forEach((id) => {
    const v = [+x.bests[id], +y.bests[id]].filter((n) => n > 0);
    if (v.length) out.bests[id] = Math.min(...v);
  });
  return out;
}

/** Saves `p` into this browser's storage; → true when something changed. */
function writeLocal(p) {
  let changed = false;
  const set = (k, v) => { let cur = null; try { cur = window.localStorage.getItem(k); } catch { /* noop */ } if (cur !== v) { writeRaw(k, v); changed = true; } };
  set(BOARDS_KEY, JSON.stringify(p.boards)); set(BOARD_AT, JSON.stringify(p.at)); set(TIMES_KEY, JSON.stringify(p.times)); set(BESTS_KEY, JSON.stringify(p.bests));
  FLAG_KEYS.forEach((k) => { if (p.flags[k]) set(k, "1"); });
  return changed;
}
// JSON.stringify of the pieces, in a fixed order: "did the merge change anything?"
const same = (a, b) => isObj(b) && ["boards", "at", "times", "bests", "flags"].every((k) => JSON.stringify(a[k] || {}) === JSON.stringify(b[k] || {}));

let active = false, timer = null, busy = null;

async function api(init) {
  try {
    const r = await fetch("/api/progress", { credentials: "same-origin", ...init, headers: { Accept: "application/json", ...(init?.headers || {}) } });
    if (!/json/.test(r.headers.get("content-type") || "")) return null;
    return { status: r.status, body: await r.json() };
  } catch { return null; }
}
const put = (progress, keepalive = false) => api({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ progress }), keepalive });

/** Pull, merge, save locally (telling the open pages) and push back when the account's copy is behind. One at a time.
 *  `keepalive`: the page is being hidden, the push may outlive it (if the pull does not, the changes wait here for the next sync). */
function syncNow(keepalive = false) {
  if (!active) return Promise.resolve();
  if (busy) return busy;
  busy = (async () => {
    const r = await api({ method: "GET" });
    if (!r || r.status !== 200) { if (r && r.status === 401) active = false; return; } // signed out elsewhere: stop
    const remote = r.body && r.body.progress;
    const merged = mergeProgress(readLocal(), remote);
    if (writeLocal(merged)) {
      try { window.dispatchEvent(new Event(PROGRESS_EVENT)); window.dispatchEvent(new Event(UMBRA_EVENT)); } catch { /* noop */ }
    }
    if (!same(merged, remote)) await put(merged, keepalive);
    try { window.dispatchEvent(new Event(SYNCED_EVENT)); } catch { /* noop */ }
  })().finally(() => { busy = null; });
  return busy;
}

const onHide = () => {
  if (!active || document.visibilityState !== "hidden") return;
  if (timer) { clearTimeout(timer); timer = null; }
  syncNow(true);
};

/** The backend says a player is signed in: merge now, then keep the account up to date. */
export function startSync() {
  if (typeof window === "undefined") return;
  if (!active) { active = true; document.addEventListener("visibilitychange", onHide); }
  syncNow();
}
/** Signed out or account deleted: stop (this browser keeps its progress). */
export function stopSync() {
  active = false;
  if (timer) { clearTimeout(timer); timer = null; }
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onHide);
}

/** The game saved something: push it soon (`soon`: a solve) or within PUSH_MS. */
export function markProgress(soon = false) {
  if (!active) return;
  if (timer && !soon) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; syncNow(); }, soon ? PUSH_SOON_MS : PUSH_MS);
}
/** A board was saved: stamp it, so the merge knows which device changed it last. */
export function stampBoard(id) {
  const at = readJson(BOARD_AT);
  at[id] = Date.now();
  writeRaw(BOARD_AT, JSON.stringify(at));
  markProgress();
}

/** Re-render when a sync brought progress from another device. */
export function useProgressTick() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const on = () => setN((v) => v + 1);
    window.addEventListener(PROGRESS_EVENT, on);
    return () => window.removeEventListener(PROGRESS_EVENT, on);
  }, []);
  return n;
}
