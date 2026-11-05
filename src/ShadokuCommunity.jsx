/* eslint-disable react/prop-types */
/**
 * ShadokuCommunity.jsx — the Syndicate ranking and the community contracts.
 *
 *   RankingPanel        /profile/ranking   every signed-in player, ranked by contracts fulfilled, speed and hints (src/ranking.js)
 *   CommunityPage       /community         the published community puzzles, by board size, sorted by difficulty, stars, plays or date
 *   CreatePage          /community/create  the Guide (how a contract is built, its rules and the logic players use) and the Workshop:
 *                                          scene → zones and openings → props → scapegoats → clues → check & publish
 *   RateBox             the 1–5 stars in the "Contract Completed!" window of a community puzzle (ShadokuApp CommunityPlayScreen)
 *   draftCase(draft)    the playable case JSON of a Workshop draft (the play-test opens it in the game)
 *
 * The Workshop builds the same case JSON the engine writes: the zones, props and clue atoms come from the engine's catalog
 * (src/creatorCatalog.json, scripts/creator-catalog.mjs), the scapegoats from the story's cast, and every clue is rendered by
 * caseText.js, so a community puzzle reads in every language. src/creatorCore.js checks the laws and runs the solver.
 * Data goes through src/community.js (the backend, or this browser's storage without one). Strings: ui.ranking.*, ui.community.*,
 * ui.rate.*, ui.create.* in src/locales/en.json.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang, useAuth, useModals, Avatar, Rich, store } from "./ShadokuHome.jsx";
import { Page, usePageTitle } from "./ShadokuPages.jsx";
import { Board, BZ, buildGeometry, GAME_CSS, PUZZLES, DAILIES, readBestTimes } from "./ShadokuGame.jsx";
import { getCastForPuzzle, CELL, SUSPECT_COLORS, SuspectPolaroid, PropSprite, BIOME_META } from "./ShadokuArt.jsx";
import { caseRenderer, trOf, difficultyKey } from "./caseText.js";
import { tEn } from "./i18n.js";
import CATALOG from "./creatorCatalog.json";
import * as core from "./creatorCore.js";
import { hasBadWords } from "./wordFilter.js";
import { fetchRanking, listCommunity, publishCommunity, deleteCommunity, rateCommunity, RANKED_EVENT } from "./community.js";

/* ═════════════════════════ small pieces ═════════════════════════ */
class ArtBoundary extends React.Component {
  constructor(props) { super(props); this.state = { broken: false }; }
  static getDerivedStateFromError() { return { broken: true }; }
  componentDidCatch(e) { console.warn("[Shadoku] community art failed", e); }
  render() { return this.state.broken ? this.props.fallback || null : this.props.children; }
}
const diffClass = (d) => String(d || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
const useDiffName = () => { const { t } = useLang(); return useCallback((d) => { const v = t(difficultyKey(d)); return v && !v.startsWith("DIFFICULTY.") ? v : d; }, [t]); };
const Stars = ({ value, label }) => (
  <span className="sh-stars" role="img" aria-label={label}>
    {[1, 2, 3, 4, 5].map((n) => <span key={n} className={value >= n - 0.25 ? "on" : value >= n - 0.75 ? "half" : ""} aria-hidden="true">★</span>)}
  </span>
);
/** The stylesheet of this file's pieces (the Ranking tab and the stars in the game need it outside the community pages too). */
const Styles = () => <style data-shadoku="community">{COMMUNITY_CSS}</style>;
const errorText = (t, e) => t(e === "auth" ? "community.signIn" : e === "storage" ? "community.unavailable" : e === "not_found" ? "community.notFound" : "community.error");

/* ═════════════════════════ /profile/ranking ═════════════════════════ */
export function RankingPanel() {
  const { t } = useLang();
  const { user } = useAuth();
  const [res, setRes] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { // the first sync after signing in sends this player's numbers: show them
    const on = () => setTick((n) => n + 1);
    window.addEventListener(RANKED_EVENT, on);
    return () => window.removeEventListener(RANKED_EVENT, on);
  }, []);
  useEffect(() => {
    let alive = true;
    fetchRanking(user).then((r) => { if (alive) setRes(r); });
    return () => { alive = false; };
  }, [user, tick]);
  const medal = (n) => (n === 1 ? "🥇" : n === 2 ? "🥈" : n === 3 ? "🥉" : n);
  return (
    <section className="sh-pcard sh-rank" aria-labelledby="sh-rank-h">
      <Styles />
      <h2 id="sh-rank-h" className="sh-type">{t("ranking.title")}</h2>
      <p>{t("ranking.lead")}</p>
      {!res ? <p className="sh-muted">{t("ranking.loading")}</p>
        : res.error ? <p className="sh-err" role="alert">{t(res.error === "storage" ? "ranking.unavailable" : "ranking.error")}</p>
          : <>
            {res.me ? <p className="sh-rank-me sh-type">{t("ranking.yourRank", { rank: res.me.rank, total: res.total })} · <b>{res.me.score}</b> {t("ranking.points")}</p>
              : <p className="sh-muted sm">{t("ranking.notListed")}</p>}
            {res.players.length ? (
              <div className="sh-rank-scroll">
                <table className="sh-stbl sh-rank-tbl">
                  <thead><tr>
                    <th scope="col">{t("ranking.rank")}</th><th scope="col">{t("ranking.agent")}</th>
                    {/* on a phone the number columns show an icon; the word stays as the tooltip and for screen readers */}
                    {[["contracts", "✓"], ["speed", "⚡"], ["hints", "🔍"], ["score", "★"]].map(([k, icon]) => (
                      <th key={k} scope="col" className="num" title={t(`ranking.${k}`)}><span className="full">{t(`ranking.${k}`)}</span><span className="short" aria-hidden="true">{icon}</span><span className="sh-sr">{t(`ranking.${k}`)}</span></th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {[...res.players, ...(res.me && !res.players.some((p) => p.me) ? [res.me] : [])].map((p) => (
                      <tr key={`${p.rank}-${p.codename}`} className={p.me ? "me" : ""}>
                        <td className={`pos${p.rank <= 3 ? " medal" : ""}`}>{medal(p.rank)}</td>
                        <td className="who"><span className="sh-rank-who"><Avatar user={{ username: p.codename, avatar: p.avatar }} /><span className="nm">{p.codename}{p.me && <small> · {t("ranking.you")}</small>}</span></span></td>
                        <td className="num">{p.solved}</td><td className="num">⚡ {p.speed}</td><td className="num">{p.hints}</td><td className="num"><b>{p.score}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="sh-muted">{t("ranking.empty")}</p>}
            {res.demo && <p className="sh-muted sm">{t("ranking.demo")}</p>}
          </>}
      <details className="sh-rank-how">
        <summary>{t("ranking.how")}</summary>
        <ul className="sh-page-list">{[1, 2, 3, 4].map((n) => <li key={n}>{t(`ranking.how.${n}`)}</li>)}</ul>
      </details>
    </section>
  );
}

/* ═════════════════════════ /community ═════════════════════════ */
const SORTS = ["new", "difficulty", "stars", "plays"];
const PREF_KEY = "shadoku-community-view"; // { size, sort, order }: this browser's last choice

export function CommunityPage({ go }) {
  const { t } = useLang();
  usePageTitle("page.community");
  const diffName = useDiffName();
  const pref = (() => { try { return JSON.parse(store.get(PREF_KEY) || "{}") || {}; } catch { return {}; } })();
  const [size, setSize] = useState(core.SIZES.includes(pref.size) ? pref.size : 0);
  const [sort, setSort] = useState(SORTS.includes(pref.sort) ? pref.sort : "new");
  const [order, setOrder] = useState(pref.order === "asc" ? "asc" : "desc");
  const [res, setRes] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { store.set(PREF_KEY, JSON.stringify({ size, sort, order })); }, [size, sort, order]);
  useEffect(() => {
    let alive = true;
    listCommunity({ sort, order }).then((r) => { if (alive) setRes(r); });
    return () => { alive = false; };
  }, [sort, order, tick]);
  const solved = useMemo(() => new Set(Object.keys(readBestTimes((res && res.puzzles) || []))), [res]);
  const all = useMemo(() => (res && res.puzzles) || [], [res]);
  const counts = useMemo(() => Object.fromEntries(core.SIZES.map((n) => [n, all.filter((p) => p.size === n).length])), [all]);
  const shown = core.SIZES.filter((n) => (!size || n === size) && (counts[n] || size));
  const remove = async (p) => {
    if (!window.confirm(t("community.deleteConfirm", { title: p.title }))) return;
    const r = await deleteCommunity(p.id);
    if (r.ok) setTick((n) => n + 1); else window.alert(errorText(t, r.error));
  };
  const sortLabel = (s) => t(`community.sort.${s}`);
  return (
    <Page go={go} current="/community" wide>
      <Styles />
      <h1 className="sh-type">{t("community.title")}</h1>
      <p className="sh-page-lead">{t("community.lead")}</p>
      <div className="sh-cm-bar">
        <nav className="sh-tabs sh-cm-sizes" aria-label={t("community.sizes")}>
          <button type="button" className={!size ? "on" : ""} aria-pressed={!size} onClick={() => setSize(0)}>{t("community.all")} <small>{all.length}</small></button>
          {core.SIZES.map((n) => <button key={n} type="button" className={size === n ? "on" : ""} aria-pressed={size === n} onClick={() => setSize(n)}>{n}×{n} <small>{counts[n] || 0}</small></button>)}
        </nav>
        <div className="sh-cm-sort">
          <label><span>{t("community.sort")}</span>
            <select className="sh-select sh-cm-select" value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map((s) => <option key={s} value={s}>{sortLabel(s)}</option>)}</select>
          </label>
          <button type="button" className="sh-btn ghost sm" onClick={() => setOrder((o) => (o === "asc" ? "desc" : "asc"))} aria-label={t(`community.order.${order}`)} title={t(`community.order.${order}`)}>{order === "asc" ? "↑" : "↓"} {t(`community.order.${order}`)}</button>
          <button type="button" className="sh-btn sm" onClick={() => go("/community/create")}>＋ {t("community.create")}</button>
        </div>
      </div>
      {!res ? <p className="sh-muted sh-cm-note">{t("community.loading")}</p>
        : res.error ? <p className="sh-err sh-cm-note" role="alert">{errorText(t, res.error)}</p>
          : !shown.length ? (
            <section className="sh-pcard sh-cm-empty">
              <p>{t("community.empty")}</p>
              <button type="button" className="sh-btn" onClick={() => go("/community/create")}>{t("community.create")}</button>
            </section>
          ) : shown.map((n) => {
            const items = all.filter((p) => p.size === n);
            return (
              <section key={n} className="sh-cm-group" aria-label={`${n}×${n}`}>
                <h2 className="sh-hub-h"><span className="sh-hub-diff">{n}×{n}</span><small>{t("community.count", { n: items.length })}</small></h2>
                {items.length ? (
                  <div className="sh-cm-grid">
                    {items.map((p) => (
                      <article key={p.id} className={`sh-cm-card t-${String(p.theme).toLowerCase()}`}>
                        <a className="sh-cm-open" href={`/community/play/${p.id}`} onClick={(e) => { e.preventDefault(); go(`/community/play/${p.id}`); }}>
                          <span className="sh-cm-theme" aria-hidden="true">{(BIOME_META[p.theme] || BIOME_META.MANSION).icon}</span>
                          <span className="sh-cm-title sh-type">{p.title}</span>
                          <span className="sh-cm-meta"><span className={`sh-diff d-${diffClass(p.difficulty)}`}>{diffName(p.difficulty)}</span> · {t(`THEME.${p.theme}`)} · {t("community.scapegoats", { n: p.suspects })}</span>
                          <span className="sh-cm-stats">
                            {p.ratings ? <><Stars value={p.stars} label={t("community.starsAria", { avg: p.stars })} /> <b>{p.stars}</b> <small>({p.ratings})</small></> : <small>{t("community.noRatings")}</small>}
                            <span>▶ {t("community.plays", { n: p.plays })}</span>
                            {solved.has(p.id) && <span className="ok">✓ {t("community.solvedByYou")}</span>}
                          </span>
                        </a>
                        <footer className="sh-cm-by">
                          <Avatar user={{ username: p.author, avatar: p.avatar }} /><span>{t("community.by", { name: p.author })}</span>
                          {p.mine && <><span className="sh-cm-mine">{t("community.yours")}</span><button type="button" className="sh-link" onClick={() => remove(p)}>{t("community.delete")}</button></>}
                        </footer>
                      </article>
                    ))}
                  </div>
                ) : <p className="sh-muted">{t("community.emptySize")}</p>}
              </section>
            );
          })}
      {res && res.demo && <p className="sh-muted sm sh-cm-note">{t("community.demo")}</p>}
    </Page>
  );
}

/* ═════════════════════════ the stars after a community contract ═════════════════════════ */
/** `meta`: the puzzle's list row; `initial`: the player's earlier rating (0 = none). */
export function RateBox({ id, meta, initial = 0 }) {
  const { t } = useLang();
  const { user } = useAuth();
  const modals = useModals();
  const [stars, setStars] = useState(initial);
  const [hover, setHover] = useState(0);
  const [state, setState] = useState(initial ? "done" : ""); // "" | "busy" | "done" | error code
  const [agg, setAgg] = useState(meta ? { avg: meta.stars, count: meta.ratings } : null);
  if (meta && meta.mine) return <div className="sk-rate"><Styles /><b>{t("rate.title")}</b><p>{t("rate.own")}</p></div>;
  const rate = async (n) => {
    if (!user) { modals.openSignIn(); return; }
    setStars(n); setState("busy");
    const r = await rateCommunity(id, n);
    if (r.ok) { setAgg({ avg: r.avg, count: r.count }); setState("done"); } else setState(r.error || "error");
  };
  const shown = hover || stars;
  return (
    <div className="sk-rate" role="group" aria-label={t("rate.title")}>
      <Styles />
      <b>{t("rate.title")}</b>
      <div className="sk-rate-stars" onPointerLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className={n <= shown ? "on" : ""} aria-pressed={n <= stars} aria-label={t("rate.star", { n })} disabled={state === "busy"}
            onPointerEnter={() => setHover(n)} onFocus={() => setHover(n)} onBlur={() => setHover(0)} onClick={() => rate(n)}>★</button>
        ))}
      </div>
      {!user ? <button type="button" className="sh-link" onClick={modals.openSignIn}>{t("rate.signIn")}</button>
        : state === "done" ? <p>{t("rate.thanks")}{agg && agg.count ? ` ${t("rate.avg", { avg: agg.avg, n: agg.count })}` : ""}</p>
          : state && state !== "busy" ? <p className="bad" role="alert">{t(state === "own" ? "rate.own" : "rate.error")}</p>
            : <p>{t("rate.prompt")}</p>}
    </div>
  );
}

/* ═════════════════════════ the Workshop: drafts and their case ═════════════════════════ */
const DRAFT_KEY = "shadoku-create-draft";
const STEPS = ["scene", "zones", "props", "suspects", "clues", "publish"];
const ZONE_COLORS = ["#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4", "#46f0f0", "#f032e6", "#bcf60c", "#fabebe", "#008080", "#e6beff", "#9a6324", "#fffac8", "#800000", "#aaffc3"];
const catOf = (theme) => CATALOG.themes[theme] || CATALOG.themes.MANSION;
const zoneOf = (theme, id) => catOf(theme).zones.find((z) => z.id === id) || null;
const grid = (n, v) => Array.from({ length: n }, () => Array.from({ length: n }, () => v));
const RECOMMENDED = { 5: [3, 5], 6: [4, 6], 7: [5, 7], 8: [6, 8], 9: [7, 10], 10: [8, 11] };

/** The scapegoats of the story and the daily contracts, by initial: { A: [{ name, gender, traits, look }], … }. */
const CAST = (() => {
  const seen = new Map();
  [...PUZZLES, ...DAILIES].forEach((q) => (q.suspects || []).forEach((s) => {
    const L = String(s.name || "")[0];
    if (!s.traits || !L || seen.has(s.name) || !core.LETTERS.includes(L.toUpperCase()) || (s.gender !== "m" && s.gender !== "f")) return;
    seen.set(s.name, { name: s.name, gender: s.gender, traits: s.traits, look: s.look || "" });
  }));
  const by = {};
  seen.forEach((c) => { const L = c.name[0].toUpperCase(); (by[L] = by[L] || []).push(c); });
  return by;
})();

function blankDraft(theme = "MANSION", size = 6) {
  const zones = catOf(theme).zones, first = zones.find((z) => z.max == null) || zones[0];
  return { v: 1, title: "", theme, size, zones: [first.id], rooms: grid(size, 0), doors: [], contents: grid(size, ""), suspects: [] };
}
function loadDraft() {
  try {
    const d = JSON.parse(store.get(DRAFT_KEY) || "null");
    if (d && d.v === 1 && core.SIZES.includes(d.size) && CATALOG.themes[d.theme] && Array.isArray(d.rooms) && d.rooms.length === d.size) return d;
  } catch { /* a damaged draft: start fresh */ }
  return blankDraft();
}
/** The tutorial contract as a draft: the Guide's example. */
function exampleDraft() {
  const q = PUZZLES.find((x) => x.id === "tutorial") || PUZZLES[0];
  const n = q.rooms.length;
  return {
    v: 1, title: "", theme: q.theme, size: n, zones: [...q.roomIds], rooms: q.rooms.map((r) => [...r]), doors: q.doors.map(([a, b]) => [[...a], [...b]]),
    contents: q.contents.map((r) => r.map((k) => k || "")),
    suspects: q.suspects.map((s) => ({ id: s.id, name: s.name, gender: s.gender, traits: s.traits, look: s.look, at: [...s.solution], atoms: s.atoms.filter((a) => core.ATOM_KINDS.has(a.kind)).map((a) => ({ kind: a.kind, subject: s.id, params: a.params })) })),
  };
}

/**
 * The draft as a case JSON the game, caseText.js and creatorCore.js read. Zones are numbered in the order of their first tile;
 * openings between tiles of one zone are dropped; `shadow` is set when every scapegoat stands and exactly one tile is dark.
 */
export function draftCase(dr, id = "draft") {
  const c = catOf(dr.theme);
  const used = [...new Set(dr.rooms.flat())].sort((a, b) => a - b);
  const map = Object.fromEntries(used.map((z, i) => [z, i]));
  const rooms = dr.rooms.map((row) => row.map((z) => map[z]));
  const roomIds = used.map((z) => dr.zones[z]);
  const kinds = [...new Set(dr.contents.flat().filter((k) => k && k !== "CORPSE"))];
  let corpse = null;
  dr.contents.forEach((row, r) => row.forEach((k, cc) => { if (k === "CORPSE") corpse = [r, cc]; }));
  const suspects = dr.suspects.map((s) => ({
    id: s.id, name: s.name, gender: s.gender, pronoun: s.gender === "m" ? "he" : "she", traits: s.traits, look: s.look,
    atoms: s.atoms.map((a) => ({ kind: a.kind, subject: s.id, params: a.params })), clueTokens: core.clueTokensOf(s.id, s.atoms),
    solution: s.at ? [...s.at] : null, clue: "", text: "",
  }));
  const d = {
    id, community: true, title: dr.title.trim(), theme: dr.theme, size: dr.size, shape: "rect", zoneWord: c.zoneWord.toLowerCase(), surface: c.surface,
    rooms, roomIds, roomNames: roomIds.map((z) => (zoneOf(dr.theme, z) || {}).en || z),
    doors: dr.doors.filter(([a, b]) => rooms[a[0]] && rooms[b[0]] && rooms[a[0]][a[1]] !== rooms[b[0]][b[1]]),
    windows: [], contents: dr.contents.map((row) => [...row]), multiTile: [], corpse, propClasses: Object.fromEntries(kinds.map((k) => [k, (c.props[k] || {}).cls || "SHORT"])),
    suspects, shadow: null, shadowSuspect: { id: "S", name: "S. H. Adow", gender: null, traits: null }, globalRules: [], steps: [],
  };
  if (corpse) {
    const g = core.geometry(d), pos = {};
    suspects.forEach((s) => { if (s.solution) pos[s.id] = g.at(...s.solution); });
    const dark = core.darkTiles(g, pos);
    if (suspects.length && suspects.every((s) => s.solution) && dark.length === 1) d.shadow = g.rc(dark[0]);
  }
  const R = caseRenderer(d, trOf(tEn)); // the English fallback the JSON keeps (the game re-renders every clue in the player's language)
  d.suspects = d.suspects.map((s) => (s.atoms.length ? { ...s, clue: R.clue(s.id, ""), text: R.clue(s.id, "") } : s));
  return d;
}

/** What still stands between the draft and publishing: [{ step, level: "error" | "warn", key, vars }]. */
function problemsOf(dr, d, t) {
  const out = [], add = (step, key, vars = {}, level = "error") => out.push({ step, level, key, vars });
  const c = catOf(dr.theme), zoneName = (id) => t(`ZONE.${id}`);
  if (!dr.title.trim()) add("scene", "create.err.title");
  else if (hasBadWords(dr.title)) add("scene", "create.err.titleWords");
  const sizes = {};
  dr.rooms.flat().forEach((z) => { sizes[z] = (sizes[z] || 0) + 1; });
  const zonesUsed = Object.keys(sizes).map(Number);
  if (zonesUsed.length < 2) add("zones", "create.err.zoneCount", { zones: t(`ui.fmt.zonePl.${c.zoneWord}`) });
  zonesUsed.forEach((z) => {
    const info = zoneOf(dr.theme, dr.zones[z]);
    if (info && (sizes[z] < info.min || (info.max != null && sizes[z] > info.max))) add("zones", "create.err.zoneSize", { room: zoneName(info.id), n: sizes[z], range: info.max == null ? t("create.zones.rangeMin", { min: info.min }) : t("create.zones.range", { min: info.min, max: info.max }) });
  });
  core.splitZones(d.rooms).forEach((i) => add("zones", "create.err.zonePieces", { room: zoneName(d.roomIds[i]) }));
  d.roomIds.forEach((id, i) => {
    const doors = d.doors.some(([a, b]) => d.rooms[a[0]][a[1]] === i || d.rooms[b[0]][b[1]] === i);
    if (!doors && d.roomIds.length > 1) add("zones", "create.warn.noDoor", { room: zoneName(id) }, "warn");
  });
  if (!d.corpse) add("props", "create.err.corpse");
  const count = {};
  dr.contents.forEach((row, r) => row.forEach((k, cc) => {
    if (!k || k === "CORPSE") return;
    const zid = dr.zones[dr.rooms[r][cc]], pr = c.props[k];
    if (!pr || (pr.zones && !pr.zones.includes(zid))) add("props", "create.err.prop", { prop: t(`prop.${k}`), room: zoneName(zid) });
    const key = `${k}|${zid}`;
    count[key] = (count[key] || 0) + 1;
    if (pr && count[key] === pr.cap + 1) add("props", "create.err.cap", { prop: t(`prop.${k}`), room: zoneName(zid) });
  }));
  if (dr.suspects.length < core.MIN_SUSPECTS) add("suspects", "create.err.suspects", { n: core.MIN_SUSPECTS });
  dr.suspects.forEach((s) => { if (!s.at) add("suspects", "create.err.unplaced", { name: s.name }); });
  if (d.corpse) {
    const g = core.geometry(d), pos = {};
    d.suspects.forEach((s) => { if (s.solution) pos[s.id] = g.at(...s.solution); });
    const names = Object.fromEntries(d.suspects.map((s) => [s.id, s.name]));
    core.sightConflicts(g, pos).forEach(([a, b]) => add("suspects", "create.err.sight", { a: names[a], b: names[b] }));
    if (dr.suspects.length && dr.suspects.every((s) => s.at)) {
      const dark = core.darkTiles(g, pos).length;
      if (dark !== 1) add("suspects", "create.err.dark", { n: dark });
    }
    if (d.shadow) {
      const full = { ...pos, S: g.at(...d.shadow) };
      d.suspects.forEach((s) => {
        if (!s.atoms.length) add("clues", "create.err.noClue", { name: s.name });
        else if (s.atoms.some((a) => !core.atomHolds(g, d, full, a))) add("clues", "create.err.falseClue", { name: s.name });
      });
    }
  }
  return out;
}

/* ═════════════════════════ the Workshop's board ═════════════════════════ */
/** The real board (read-only art) with a click layer on top: tiles, and in "doors" mode the walls between zones. */
function WorkBoard({ d, dr, mode, onTile, onEdge, ghosts = null, focus = null }) {
  const { t } = useLang();
  const cast = useMemo(() => {
    try { const c = getCastForPuzzle(d, 0); return { ...c, puzzle: { ...c.puzzle, roomLabels: d.roomIds.map((id, i) => { const v = t(`ZONE.${id}`); return v && v !== `ZONE.${id}` ? v : d.roomNames[i]; }) } }; } catch { return null; }
  }, [d, t]);
  const geo = useMemo(() => (cast ? buildGeometry(cast.puzzle) : null), [cast]);
  const svg = useRef(null), drag = useRef(false);
  const [hover, setHover] = useState(null);
  if (!cast || !geo) return null;
  const n = d.rooms.length, W = n * CELL + 2 * BZ, H = W;
  const looks = cast.looks, p = cast.puzzle;
  const colorOf = (id) => (id === "S" ? "#D99B26" : (looks[id] && looks[id].back) || SUSPECT_COLORS[Math.max(0, p.suspects.findIndex((q) => q.id === id)) % SUSPECT_COLORS.length]);
  const tokens = {};
  if (!ghosts) { d.suspects.forEach((s) => { if (s.solution) tokens[s.id] = s.solution; }); if (d.shadow) tokens.S = d.shadow; }
  const tileOf = (e) => {
    const r = svg.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W - BZ, y = ((e.clientY - r.top) / r.height) * H - BZ;
    const c = Math.floor(x / CELL), row = Math.floor(y / CELL);
    return row >= 0 && c >= 0 && row < n && c < n ? [row, c] : null;
  };
  const paints = mode === "zones";
  const down = (e) => { if (mode === "doors") return; const x = tileOf(e); if (!x) return; drag.current = paints; try { svg.current.setPointerCapture(e.pointerId); } catch { /* noop */ } onTile(x, "down"); };
  const move = (e) => { const x = tileOf(e); setHover(x); if (drag.current && x && paints) onTile(x, "move"); };
  const up = () => { drag.current = false; };
  const edges = [];
  if (mode === "doors") {
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (c + 1 < n && d.rooms[r][c] !== d.rooms[r][c + 1]) edges.push([[r, c], [r, c + 1], BZ + (c + 1) * CELL, BZ + r * CELL, BZ + (c + 1) * CELL, BZ + (r + 1) * CELL]);
      if (r + 1 < n && d.rooms[r][c] !== d.rooms[r + 1][c]) edges.push([[r, c], [r + 1, c], BZ + c * CELL, BZ + (r + 1) * CELL, BZ + (c + 1) * CELL, BZ + (r + 1) * CELL]);
    }
  }
  const isDoor = (a, b) => d.doors.some(([x, y]) => (x[0] === a[0] && x[1] === a[1] && y[0] === b[0] && y[1] === b[1]) || (x[0] === b[0] && x[1] === b[1] && y[0] === a[0] && y[1] === a[1]));
  return (
    <div className="sh-cr-boardwrap">
      <ArtBoundary fallback={<div className="sh-cr-boardfail" />}>
        <div className="sk sk-embed sh-board-box sh-cr-board" style={{ aspectRatio: `${W} / ${H}` }}>
          <Board p={p} geo={geo} st={{ tokens }} looks={looks} colorOf={colorOf} active={(p.suspects[0] || { id: "A" }).id} tool="suspect" solved={false} uid="create" />
        </div>
      </ArtBoundary>
      <svg ref={svg} className={`sh-cr-ovl m-${mode}`} viewBox={`0 0 ${W} ${H}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => { setHover(null); }}
        role="presentation">
        {paints && dr.rooms.map((row, r) => row.map((z, c) => <rect key={`z${r}-${c}`} x={BZ + c * CELL} y={BZ + r * CELL} width={CELL} height={CELL} fill={ZONE_COLORS[z % ZONE_COLORS.length]} fillOpacity=".32" pointerEvents="none" />))}
        {focus && <rect x={BZ + focus[1] * CELL + 3} y={BZ + focus[0] * CELL + 3} width={CELL - 6} height={CELL - 6} rx="8" fill="none" stroke="#fff" strokeWidth="4" strokeDasharray="8 6" pointerEvents="none" />}
        {ghosts && Object.entries(ghosts).map(([id, [r, c]]) => (
          <g key={id} pointerEvents="none">
            <circle cx={BZ + c * CELL + CELL / 2} cy={BZ + r * CELL + CELL / 2} r="21" fill={id === "S" ? "#1a1408" : "#C83E3B"} stroke="#fff" strokeWidth="3" />
            <text x={BZ + c * CELL + CELL / 2} y={BZ + r * CELL + CELL / 2 + 8} textAnchor="middle" fontSize="24" fontWeight="800" fill={id === "S" ? "#D99B26" : "#fff"}>{id}</text>
          </g>
        ))}
        {hover && mode !== "doors" && <rect x={BZ + hover[1] * CELL + 1.5} y={BZ + hover[0] * CELL + 1.5} width={CELL - 3} height={CELL - 3} rx="6" fill="#fff" fillOpacity=".12" stroke="#D99B26" strokeWidth="3" pointerEvents="none" />}
        {edges.map(([a, b, x1, y1, x2, y2]) => {
          const on = isDoor(a, b);
          return (
            <g key={`${a}-${b}`} className={`sh-cr-edge${on ? " on" : ""}`} onClick={() => onEdge(a, b)}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="22" />
              <line x1={x1 + (x1 === x2 ? 0 : 8)} y1={y1 + (y1 === y2 ? 0 : 8)} x2={x2 - (x1 === x2 ? 0 : 8)} y2={y2 - (y1 === y2 ? 0 : 8)} className="vis" strokeWidth="8" strokeLinecap="round" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const PropIcon = ({ kind }) => (
  <svg viewBox="0 -14 64 78" width="44" height="54" aria-hidden="true" style={{ overflow: "visible" }}>
    <ArtBoundary fallback={null}><PropSprite kind={kind} len={1} /></ArtBoundary>
  </svg>
);

/* ═════════════════════════ /community/create ═════════════════════════ */
export function CreatePage({ go }) {
  const { t } = useLang();
  const { user } = useAuth();
  const modals = useModals();
  usePageTitle("page.create");
  const diffName = useDiffName();
  const [tab, setTab] = useState(() => (store.get(DRAFT_KEY) ? "workshop" : "guide"));
  const [dr, setDr] = useState(loadDraft);
  const [past, setPast] = useState([]);
  const [step, setStep] = useState("scene");
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const say = useCallback((msg) => { setToast(msg); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), 2800); }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const update = useCallback((fn, undoable = true) => setDr((cur) => {
    const next = fn(cur);
    if (next === cur) return cur;
    if (undoable) setPast((p) => [...p.slice(-60), cur]);
    store.set(DRAFT_KEY, JSON.stringify(next));
    return next;
  }), []);
  const undo = () => { if (!past.length) return; const prev = past[past.length - 1]; setPast((p) => p.slice(0, -1)); setDr(prev); store.set(DRAFT_KEY, JSON.stringify(prev)); };

  const cat = catOf(dr.theme), zw = cat.zoneWord;
  const d = useMemo(() => draftCase(dr), [dr]);
  const g = useMemo(() => core.geometry(d), [d]);
  const problems = useMemo(() => problemsOf(dr, d, t), [dr, d, t]);
  const titleBad = problems.some((p) => p.key === "create.err.titleWords");
  const R = useMemo(() => caseRenderer(d, trOf(t)), [d, t]);
  const [zone, setZone] = useState(0); // the zone (index into dr.zones, or a new zone id) the brush paints
  const [zoneTool, setZoneTool] = useState("paint");
  const [prop, setProp] = useState("CORPSE");
  const [fitsZone, setFitsZone] = useState(true);
  const [active, setActive] = useState(null); // the scapegoat being placed / given a clue
  const [showAlt, setShowAlt] = useState(false);

  /* ─── the checker: the solver, then the difficulty estimate, in time slices ─── */
  const [check, setCheck] = useState({ status: "waiting" });
  const sig = useMemo(() => JSON.stringify([d.rooms, d.doors, d.contents, d.suspects.map((s) => [s.solution, s.atoms])]), [d]);
  const ready = !!d.shadow && d.suspects.length >= core.MIN_SUSPECTS && d.suspects.every((s) => s.atoms.length) && !problems.some((p) => p.key === "create.err.falseClue" || p.key === "create.err.sight");
  useEffect(() => {
    if (!ready) { setCheck({ status: "waiting" }); return undefined; }
    setCheck({ status: "running" }); setShowAlt(false);
    let cancel = null;
    const timer = setTimeout(() => {
      cancel = core.runSteps(core.solveSteps(d, { limit: 2, budget: 200000 }), (r) => {
        if (r.error) { setCheck({ status: "open" }); return; }
        if (r.solutions.length >= 2) {
          const mine = r.solutions.find((s) => d.suspects.some((x) => s[x.id] !== g.at(...x.solution))) || r.solutions[1];
          setCheck({ status: "multiple", alt: Object.fromEntries(Object.entries(mine).map(([id, tt]) => [id, g.rc(tt)])) });
        } else if (!r.exhausted) setCheck({ status: "open" });
        else if (!r.solutions.length) setCheck({ status: "none" });
        else {
          setCheck({ status: "grading" });
          cancel = core.runSteps(core.gradeSteps(d), (gr) => setCheck({ status: "unique", difficulty: (gr && !gr.error && gr.difficulty) || "Expert" }));
        }
      });
    }, 450);
    return () => { clearTimeout(timer); if (cancel) cancel(); };
  }, [sig, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── edits ─── */
  const resetBoard = (theme, size) => update((cur) => ({ ...blankDraft(theme, size), title: cur.title, suspects: cur.suspects.map((s) => ({ ...s, at: null, atoms: [] })) }));
  const setScene = (theme, size) => {
    if (theme === dr.theme && size === dr.size) return;
    const touched = dr.rooms.flat().some((z) => z !== 0) || dr.contents.flat().some(Boolean) || dr.suspects.some((s) => s.at);
    if (touched && !window.confirm(t("create.scene.changeConfirm"))) return;
    resetBoard(theme, size); setZone(0);
  };
  const zoneIdx = (cur, id) => { const i = cur.zones.indexOf(id); return i >= 0 ? i : -1; };
  const paintZone = ([r, c], phase) => {
    const id = typeof zone === "string" ? zone : dr.zones[zone];
    if (!id) return;
    update((cur) => {
      let zones = cur.zones, z = zoneIdx(cur, id);
      if (z < 0) { zones = [...zones, id]; z = zones.length - 1; }
      if (cur.rooms[r][c] === z) return zones === cur.zones ? cur : { ...cur, zones };
      const rooms = cur.rooms.map((row) => [...row]);
      rooms[r][c] = z;
      return { ...cur, zones, rooms };
    }, phase === "down");
    if (typeof zone === "string") setZone(zoneIdx(dr, zone) >= 0 ? zoneIdx(dr, zone) : dr.zones.length);
  };
  const toggleDoor = (a, b) => update((cur) => {
    const same = ([x, y]) => (x[0] === a[0] && x[1] === a[1] && y[0] === b[0] && y[1] === b[1]) || (x[0] === b[0] && x[1] === b[1] && y[0] === a[0] && y[1] === a[1]);
    return { ...cur, doors: cur.doors.some(same) ? cur.doors.filter((x) => !same(x)) : [...cur.doors, [a, b]] };
  });
  const placeProp = ([r, c]) => {
    const here = dr.contents[r][c], zid = dr.zones[dr.rooms[r][c]];
    const next = prop === "ERASER" ? "" : here === prop ? "" : prop;
    if (next && next !== "CORPSE") {
      const pr = cat.props[next];
      if (pr.zones && !pr.zones.includes(zid)) { say(t("create.props.noZone", { prop: t(`PROP.${next}.a`), room: t(`ZONE.${zid}`) })); return; }
      let n = 0;
      dr.contents.forEach((row, rr) => row.forEach((k, cc) => { if (k === next && dr.rooms[rr][cc] === dr.rooms[r][c] && !(rr === r && cc === c)) n++; }));
      if (n >= pr.cap) { say(t("create.props.cap", { room: t(`ZONE.${zid}`) })); return; }
    }
    const standable = !next || (next !== "CORPSE" && (cat.props[next].cls === "LOW" || cat.props[next].cls === "PERCH"));
    const lifted = dr.suspects.find((s) => s.at && s.at[0] === r && s.at[1] === c && !standable);
    if (lifted) say(t("create.props.lifted", { name: lifted.name }));
    update((cur) => {
      const contents = cur.contents.map((row) => row.map((k) => (next === "CORPSE" && k === "CORPSE" ? "" : k)));
      contents[r][c] = next;
      return { ...cur, contents, suspects: lifted ? cur.suspects.map((s) => (s.id === lifted.id ? { ...s, at: null } : s)) : cur.suspects };
    });
  };
  const freeLetters = core.LETTERS.filter((L) => CAST[L] && !dr.suspects.some((s) => s.id === L));
  const addSuspect = () => {
    if (!freeLetters.length || dr.suspects.length >= core.MAX_SUSPECTS) return;
    const L = freeLetters[0], pool = CAST[L], who = pool[Math.floor(Math.random() * pool.length)];
    update((cur) => ({ ...cur, suspects: [...cur.suspects, { id: L, ...who, at: null, atoms: [] }] }));
    setActive(L);
  };
  const reroll = (id) => update((cur) => ({
    ...cur, suspects: cur.suspects.map((s) => {
      if (s.id !== id) return s;
      const pool = CAST[id] || [], i = pool.findIndex((x) => x.name === s.name), who = pool[(i + 1) % pool.length] || s;
      return { ...s, name: who.name, gender: who.gender, traits: who.traits, look: who.look, atoms: s.atoms.filter((a) => !core.PEOPLE_KINDS.includes(a.kind)) };
    }),
  }));
  const removeSuspect = (id) => {
    update((cur) => ({ ...cur, suspects: cur.suspects.filter((s) => s.id !== id).map((s) => ({ ...s, atoms: s.atoms.filter((a) => !a.params || a.params.other !== id) })) }));
    if (active === id) setActive(null);
  };
  const placeSuspect = ([r, c]) => {
    const id = active || (dr.suspects.find((s) => !s.at) || {}).id;
    if (!id) return;
    if (!g.occ[g.at(r, c)]) { say(t("create.suspects.cant")); return; }
    update((cur) => ({
      ...cur, suspects: cur.suspects.map((s) => (s.id === id ? { ...s, at: s.at && s.at[0] === r && s.at[1] === c ? null : [r, c] } : s.at && s.at[0] === r && s.at[1] === c ? { ...s, at: null } : s)),
    }));
    if (!active) setActive(id);
  };
  const onTile = (x, phase) => {
    if (step === "zones") paintZone(x, phase);
    else if (step === "props") placeProp(x);
    else if (step === "suspects" || step === "clues") {
      const who = dr.suspects.find((s) => s.at && s.at[0] === x[0] && s.at[1] === x[1]);
      if (step === "clues") { if (who) setActive(who.id); return; }
      placeSuspect(x);
    }
  };
  const addAtom = (id, a) => update((cur) => ({ ...cur, suspects: cur.suspects.map((s) => (s.id === id ? { ...s, atoms: [...s.atoms, { kind: a.kind, subject: id, params: a.params }] } : s)) }));
  const removeAtom = (id, i) => update((cur) => ({ ...cur, suspects: cur.suspects.map((s) => (s.id === id ? { ...s, atoms: s.atoms.filter((_, j) => j !== i) } : s)) }));

  const exampleLoad = () => {
    if ((dr.rooms.flat().some((z) => z !== 0) || dr.suspects.length) && !window.confirm(t("create.scene.resetConfirm"))) return;
    update(() => exampleDraft()); setTab("workshop"); setStep("clues"); setActive(null); setZone(0);
  };
  const startOver = () => { if (!window.confirm(t("create.scene.resetConfirm"))) return; update(() => blankDraft(dr.theme, dr.size)); setStep("scene"); setActive(null); setZone(0); };

  /* ─── publish ─── */
  const [pub, setPub] = useState(null); // null | "busy" | { id } | { error, problems }
  const errors = problems.filter((p) => p.level === "error");
  const canPublish = !errors.length && check.status === "unique";
  const publish = async () => {
    if (!user) { modals.openSignIn(); return; }
    setPub("busy");
    const r = await publishCommunity(draftCase(dr), check.difficulty, user);
    if (r.ok) setPub({ id: r.id }); else { setPub(r); if (r.error === "auth") modals.openSignIn(); }
  };
  const playTest = () => { store.set("shadoku-create-test", JSON.stringify({ ...draftCase(dr, "draft-test"), difficulty: check.difficulty || "Easy" })); go("/community/play/draft-test"); };

  const sus = (id) => dr.suspects.find((s) => s.id === id) || null;
  const looks = useMemo(() => { try { return getCastForPuzzle(d, 0).looks; } catch { return {}; } }, [d]);
  const darkN = useMemo(() => (d.corpse && dr.suspects.every((s) => s.at) && dr.suspects.length ? core.darkTiles(g, Object.fromEntries(d.suspects.filter((s) => s.solution).map((s) => [s.id, g.at(...s.solution)]))).length : null), [d, g, dr.suspects]);
  const fits = useMemo(() => core.fits(d), [d]);
  const stepProblems = (s) => problems.filter((p) => p.step === s && p.level === "error").length;
  const zoneSizes = useMemo(() => { const n = {}; dr.rooms.flat().forEach((z) => { n[dr.zones[z]] = (n[dr.zones[z]] || 0) + 1; }); return n; }, [dr]);

  /* ─── the step panels ─── */
  const panel = () => {
    if (step === "scene") return (
      <div className="sh-cr-panel">
        <label className="sh-label" htmlFor="sh-cr-title">{t("create.scene.title")}</label>
        <input id="sh-cr-title" className="sh-input" maxLength={60} value={dr.title} placeholder={t("create.scene.titlePh")} onChange={(e) => { const v = e.target.value; update((cur) => ({ ...cur, title: v }), false); }} aria-invalid={titleBad || undefined} aria-describedby={titleBad ? "sh-cr-title-err" : undefined} />
        {titleBad && <p id="sh-cr-title-err" className="sh-err sm" role="alert">{t("create.err.titleWords")}</p>}
        <label className="sh-label" htmlFor="sh-cr-theme">{t("create.scene.theme")}</label>
        <select id="sh-cr-theme" className="sh-select sh-cr-select" value={dr.theme} onChange={(e) => setScene(e.target.value, dr.size)}>
          {core.THEMES.map((th) => <option key={th} value={th}>{(BIOME_META[th] || {}).icon} {t(`THEME.${th}`)}</option>)}
        </select>
        <label className="sh-label" htmlFor="sh-cr-size">{t("create.scene.size")}</label>
        <select id="sh-cr-size" className="sh-select sh-cr-select" value={dr.size} onChange={(e) => setScene(dr.theme, +e.target.value)}>
          {core.SIZES.map((n) => <option key={n} value={n}>{n}×{n}</option>)}
        </select>
        <p className="sh-muted sm">{t("create.scene.note")}</p>
        <div className="sh-row">
          <button type="button" className="sh-btn ghost sm" onClick={exampleLoad}>{t("create.scene.example")}</button>
          <button type="button" className="sh-btn ghost sm" onClick={startOver}>{t("create.scene.reset")}</button>
        </div>
      </div>
    );
    if (step === "zones") return (
      <div className="sh-cr-panel">
        <div className="sh-cr-seg" role="group">
          <button type="button" className={zoneTool === "paint" ? "on" : ""} aria-pressed={zoneTool === "paint"} onClick={() => setZoneTool("paint")}>🖌 {t("create.zones.paint")}</button>
          <button type="button" className={zoneTool === "doors" ? "on" : ""} aria-pressed={zoneTool === "doors"} onClick={() => setZoneTool("doors")}>🚪 {t("create.zones.doors")}</button>
        </div>
        <p className="sh-muted sm">{zoneTool === "paint" ? t("create.zones.help", { zone: t(`ZONE_WORD.${zw}`) }) : t("create.zones.doorsHelp", { zones: t(`ui.fmt.zonePl.${zw}`) })}</p>
        {zoneTool === "paint" && (
          <ul className="sh-cr-zones">
            {cat.zones.map((z) => {
              const i = dr.zones.indexOf(z.id), n = zoneSizes[z.id] || 0, on = (typeof zone === "string" ? zone : dr.zones[zone]) === z.id;
              const bad = n && (n < z.min || (z.max != null && n > z.max));
              return (
                <li key={z.id}>
                  <button type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => setZone(i >= 0 ? i : z.id)}>
                    <i style={{ background: i >= 0 && n ? ZONE_COLORS[i % ZONE_COLORS.length] : "transparent" }} aria-hidden="true" />
                    <span>{t(`ZONE.${z.id}`)}</span>
                    <small className={bad ? "bad" : ""}>{n ? `${t("create.zones.size", { n })} · ` : ""}{z.max == null ? t("create.zones.rangeMin", { min: z.min }) : t("create.zones.range", { min: z.min, max: z.max })}</small>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
    if (step === "props") {
      const hereZone = dr.zones[typeof zone === "number" ? zone : 0];
      const kinds = Object.entries(cat.props).filter(([, pr]) => !fitsZone || !pr.zones || pr.zones.includes(hereZone)).sort((a, b) => core.PROP_CLASS_IDS.indexOf(a[1].cls) - core.PROP_CLASS_IDS.indexOf(b[1].cls) || t(`prop.${a[0]}`).localeCompare(t(`prop.${b[0]}`)));
      return (
        <div className="sh-cr-panel">
          <p className="sh-muted sm">{t("create.props.help")}</p>
          <div className="sh-cr-props">
            <button type="button" className={`sh-cr-prop special${prop === "CORPSE" ? " on" : ""}`} aria-pressed={prop === "CORPSE"} onClick={() => setProp("CORPSE")}><PropIcon kind="CORPSE" /><span>{t("create.props.corpse")}</span></button>
            <button type="button" className={`sh-cr-prop special${prop === "ERASER" ? " on" : ""}`} aria-pressed={prop === "ERASER"} onClick={() => setProp("ERASER")}><span className="ico" aria-hidden="true">🧹</span><span>{t("create.props.eraser")}</span></button>
          </div>
          <label className="sh-cr-check">
            <input type="checkbox" checked={fitsZone} onChange={(e) => setFitsZone(e.target.checked)} />
            <span>{t("create.props.fitsZone")}</span>
            <select className="sh-select sh-cr-select sm" value={typeof zone === "number" ? zone : 0} onChange={(e) => setZone(+e.target.value)} disabled={!fitsZone}>
              {dr.zones.map((id, i) => (zoneSizes[id] ? <option key={id} value={i}>{t(`ZONE.${id}`)}</option> : null))}
            </select>
          </label>
          {core.PROP_CLASS_IDS.map((cls) => {
            const list = kinds.filter(([, pr]) => pr.cls === cls);
            if (!list.length) return null;
            return (
              <section key={cls} className="sh-cr-propgroup">
                <h4><span className={`sh-cr-cls c-${cls.toLowerCase()}`}>{t(`propInspector.${cls.toLowerCase()}Tag`)}</span> <small>{t(`create.props.class.${cls}`)}</small></h4>
                <div className="sh-cr-props">
                  {list.map(([k]) => <button key={k} type="button" className={`sh-cr-prop${prop === k ? " on" : ""}`} aria-pressed={prop === k} onClick={() => setProp(k)}><PropIcon kind={k} /><span>{t(`prop.${k}`)}</span></button>)}
                </div>
              </section>
            );
          })}
        </div>
      );
    }
    if (step === "suspects") {
      const [lo, hi] = RECOMMENDED[dr.size];
      return (
        <div className="sh-cr-panel">
          <p className="sh-muted sm">{t("create.suspects.help")}</p>
          <p className="sh-muted sm">{t("create.suspects.recommend", { size: dr.size, min: lo, max: hi })}</p>
          <ul className="sh-cr-cast">
            {dr.suspects.map((s) => (
              <li key={s.id} className={active === s.id ? "on" : ""}>
                <button type="button" className="sh-cr-face" onClick={() => setActive(s.id)} aria-pressed={active === s.id}>
                  <SuspectPolaroid name={s.name} id={s.id} look={looks[s.id]} size={58} tag={false} showName={false} tilt={0} />
                  <span><b>{s.id} · {s.name}</b><small>{s.at ? t("create.suspects.at", { coord: `r${s.at[0] + 1}c${s.at[1] + 1}` }) : t("create.suspects.unplaced")}</small></span>
                </button>
                <button type="button" className="sh-cr-mini" onClick={() => reroll(s.id)} title={t("create.suspects.change")} aria-label={t("create.suspects.change")}>↻</button>
                <button type="button" className="sh-cr-mini" onClick={() => removeSuspect(s.id)} title={t("create.suspects.remove")} aria-label={t("create.suspects.remove")}>×</button>
              </li>
            ))}
          </ul>
          <button type="button" className="sh-btn sm" onClick={addSuspect} disabled={!freeLetters.length || dr.suspects.length >= core.MAX_SUSPECTS}>＋ {t("create.suspects.add")}</button>
          {darkN != null && (
            <p className={`sh-cr-dark ${darkN === 1 ? "ok" : "bad"}`} role="status">
              {darkN === 1 ? t("create.suspects.darkOk") : darkN === 0 ? t("create.suspects.darkNone") : t("create.suspects.darkMany", { n: darkN })}
            </p>
          )}
        </div>
      );
    }
    if (step === "clues") {
      const s = sus(active);
      const full = d.shadow ? { ...Object.fromEntries(d.suspects.filter((x) => x.solution).map((x) => [x.id, g.at(...x.solution)])), S: g.at(...d.shadow) } : null;
      const options = s && full ? core.trueAtoms(g, d, full, s.id, (k) => tEn(`PROP.${k}.noun`)) : [];
      const phrase = (a) => { // the option as a sentence of its own
        const one = { ...d, suspects: d.suspects.map((x) => (x.id === s.id ? { ...x, atoms: [a], clueTokens: core.clueTokensOf(x.id, [a]) } : x)) };
        return caseRenderer(one, trOf(t)).clue(s.id, a.kind);
      };
      const GROUPS = [
        ["where", ["ROOM", "NOT_ROOM", "ROOM_PAIR", "CORPSE_ROOM", "ROW", "COL", "CORNER", "NOT_CORNER", "DOOR", "ALONE"]],
        ["props", ["ON", "ONLY_ON", "BESIDE", "ONLY_BESIDE", "NOT_BESIDE", "BARE"]],
        ["sight", ["SEE_CORPSE", "NO_SEE_CORPSE", "SEE_OTHER_ROOM"]],
        ["others", core.RELATION_KINDS],
        ["people", core.PEOPLE_KINDS],
      ];
      return (
        <div className="sh-cr-panel">
          <p className="sh-muted sm">{t("create.clues.help")}</p>
          {!d.shadow ? <p className="sh-cr-dark bad">{t("create.clues.needDark")}</p> : <>
            <ul className="sh-cr-who">
              {dr.suspects.map((x) => {
                const bad = problems.some((p) => p.step === "clues" && p.vars.name === x.name);
                return (
                  <li key={x.id}><button type="button" className={`${active === x.id ? "on" : ""}${bad ? " bad" : x.atoms.length ? " ok" : ""}`} aria-pressed={active === x.id} onClick={() => setActive(x.id)}>
                    {x.id}<small>{x.atoms.length ? t("create.clues.fits", { n: fits[x.id] }) : "—"}</small>
                  </button></li>
                );
              })}
            </ul>
            {!s ? <p className="sh-muted">{t("create.clues.pick")}</p> : <>
              <div className="sh-cr-clue">
                <SuspectPolaroid name={s.name} id={s.id} look={looks[s.id]} size={64} tag={false} showName={false} tilt={0} />
                <div>
                  <p className="sh-cr-sentence">{s.atoms.length ? R.clue(s.id, d.suspects.find((x) => x.id === s.id).clue) : <span className="sh-muted">{t("create.clues.empty")}</span>}</p>
                  <ul className="sh-cr-parts">
                    {s.atoms.map((a, i) => {
                      const ok = core.atomHolds(g, d, full, { ...a, subject: s.id });
                      return <li key={core.atomKey(a)} className={ok ? "" : "bad"}><span>{phrase(a)}</span>{!ok && <small>{t("create.clues.false")}</small>}<button type="button" className="sh-cr-mini" onClick={() => removeAtom(s.id, i)} aria-label={t("create.suspects.remove")}>×</button></li>;
                    })}
                  </ul>
                </div>
              </div>
              <h4 className="sh-cr-addh">{t("create.clues.add")} {s.atoms.length >= core.MAX_ATOMS && <small>· {t("create.clues.max", { n: core.MAX_ATOMS })}</small>}</h4>
              {GROUPS.map(([gk, kinds]) => {
                const list = options.filter((a) => kinds.includes(a.kind));
                if (!list.length) return null;
                return (
                  <details key={gk} className="sh-cr-opts" open={gk === "where"}>
                    <summary>{t(`create.clues.group.${gk}`)} <small>{list.length}</small></summary>
                    <div>
                      {list.map((a) => {
                        const off = s.atoms.length >= core.MAX_ATOMS || core.clashes(s.atoms, a);
                        return <button key={core.atomKey(a)} type="button" className="sh-cr-opt" disabled={off} onClick={() => addAtom(s.id, a)}>{phrase(a)}</button>;
                      })}
                    </div>
                  </details>
                );
              })}
            </>}
          </>}
          <Checker check={check} showAlt={showAlt} setShowAlt={setShowAlt} diffName={diffName} />
        </div>
      );
    }
    // publish
    return (
      <div className="sh-cr-panel">
        <Checker check={check} showAlt={showAlt} setShowAlt={setShowAlt} diffName={diffName} />
        {problems.length > 0 && (
          <section className="sh-cr-problems">
            <h4>{t("create.publish.problems")}</h4>
            <ul>{problems.map((p, i) => <li key={i} className={p.level}><button type="button" className="sh-link" onClick={() => setStep(p.step)}>{t(`create.steps.${p.step}`)}</button>: {t(p.key, p.vars)}</li>)}</ul>
          </section>
        )}
        {!errors.length && check.status === "unique" && <p className="sh-cr-dark ok">{t("create.publish.ready")}</p>}
        <div className="sh-row">
          <button type="button" className="sh-btn ghost" onClick={playTest} disabled={!d.shadow || !d.corpse}>▶ {t("create.publish.test")}</button>
          <button type="button" className="sh-btn" onClick={publish} disabled={!canPublish || pub === "busy"}>{user ? t("create.publish.go") : t("create.publish.signIn")}</button>
        </div>
        <p className="sh-muted sm">{t("create.publish.note")}</p>
        {pub && pub.id && (
          <div className="sh-cr-done" role="status">
            <p>{t("create.publish.done")}</p>
            <div className="sh-row">
              <button type="button" className="sh-btn sm" onClick={() => go(`/community/play/${pub.id}`)}>{t("create.publish.play")}</button>
              <button type="button" className="sh-btn ghost sm" onClick={() => go("/community")}>{t("nav.pCommunityPuzzles")}</button>
              <button type="button" className="sh-btn ghost sm" onClick={() => { update(() => blankDraft(dr.theme, dr.size)); setPub(null); setStep("scene"); }}>{t("create.publish.new")}</button>
            </div>
          </div>
        )}
        {pub && pub.error && <p className="sh-err" role="alert">{pub.error === "limit" ? t("create.publish.limit") : pub.error === "storage" ? t("create.publish.unavailable") : t("create.publish.error", { why: (pub.problems || [pub.error]).join("; ") })}</p>}
      </div>
    );
  };

  const boardMode = step === "zones" ? (zoneTool === "doors" ? "doors" : "zones") : step === "props" ? "props" : step === "suspects" || step === "clues" ? "suspects" : "view";
  const focus = (step === "suspects" || step === "clues") && active && sus(active) && sus(active).at ? sus(active).at : null;
  return (
    <Page go={go} current="/community/create" wide>
      <Styles />
      <style data-shadoku="boards">{GAME_CSS}</style>
      <h1 className="sh-type">{t("create.title")}</h1>
      <p className="sh-page-lead">{t("create.lead")}</p>
      <nav className="sh-tabs" aria-label={t("create.title")}>
        {["guide", "workshop"].map((k) => <button key={k} type="button" className={tab === k ? "on" : ""} aria-pressed={tab === k} onClick={() => setTab(k)}>{t(`create.tab.${k}`)}</button>)}
      </nav>
      {tab === "guide" ? <Guide onStart={() => setTab("workshop")} onExample={exampleLoad} /> : (
        <div className="sh-cr">
          <ol className="sh-cr-steps">
            {STEPS.map((s, i) => (
              <li key={s}><button type="button" className={step === s ? "on" : ""} aria-current={step === s ? "step" : undefined} onClick={() => setStep(s)}>
                <span className="n">{i + 1}</span>{t(`create.steps.${s}`)}{stepProblems(s) > 0 && <span className="dot" aria-label={t("create.stepIssues", { n: stepProblems(s) })} />}
              </button></li>
            ))}
          </ol>
          <div className="sh-cr-main">
            <div className="sh-cr-left">
              <WorkBoard d={d} dr={dr} mode={boardMode} onTile={onTile} onEdge={toggleDoor} ghosts={showAlt && check.alt ? check.alt : null} focus={focus} />
              <div className="sh-cr-under">
                <button type="button" className="sh-btn ghost sm" onClick={undo} disabled={!past.length}>↩ {t("create.undo")}</button>
                <span className="sh-muted sm">{dr.title.trim() || t("create.untitled")} · {t(`THEME.${dr.theme}`)} · {dr.size}×{dr.size}</span>
              </div>
            </div>
            <div className="sh-cr-right">
              <h2 className="sh-type">{STEPS.indexOf(step) + 1}. {t(`create.steps.${step}`)}</h2>
              {panel()}
              <div className="sh-cr-nav">
                {STEPS.indexOf(step) > 0 && <button type="button" className="sh-btn ghost sm" onClick={() => setStep(STEPS[STEPS.indexOf(step) - 1])}>← {t(`create.steps.${STEPS[STEPS.indexOf(step) - 1]}`)}</button>}
                {STEPS.indexOf(step) < STEPS.length - 1 && <button type="button" className="sh-btn sm" onClick={() => setStep(STEPS[STEPS.indexOf(step) + 1])}>{t(`create.steps.${STEPS[STEPS.indexOf(step) + 1]}`)} →</button>}
              </div>
            </div>
          </div>
          {toast && <div className="sh-cr-toast" role="status">{toast}</div>}
        </div>
      )}
    </Page>
  );
}

function Checker({ check, showAlt, setShowAlt, diffName }) {
  const { t } = useLang();
  const st = check.status;
  return (
    <section className={`sh-cr-check-box s-${st}`} aria-live="polite">
      <h4>{t("create.check.title")}</h4>
      {st === "waiting" && <p>{t("create.check.waiting")}</p>}
      {(st === "running" || st === "grading") && <p>{t(st === "running" ? "create.check.running" : "create.check.grading")}</p>}
      {st === "unique" && <><p className="ok">{t("create.check.unique")}</p><p>{t("create.check.difficulty", { difficulty: diffName(check.difficulty) })}</p></>}
      {st === "multiple" && <><p className="bad">{t("create.check.multiple")}</p><button type="button" className="sh-btn ghost sm" onClick={() => setShowAlt((v) => !v)}>{t(showAlt ? "create.check.hideAlt" : "create.check.showAlt")}</button></>}
      {st === "open" && <p className="bad">{t("create.check.open")}</p>}
      {st === "none" && <p className="bad">{t("create.check.none")}</p>}
    </section>
  );
}

/* ═════════════════════════ the Guide ═════════════════════════ */
const GUIDE = [
  ["goal", 3], ["sight", 3], ["scene", 3], ["suspects", 3], ["clues", 4], ["logic", 5], ["publish", 3],
];
function Guide({ onStart, onExample }) {
  const { t } = useLang();
  return (
    <div className="sh-cr-guide">
      {GUIDE.map(([k, n], i) => (
        <section key={k} className="sh-pcard">
          <h2 className="sh-type">{i + 1}. {t(`create.guide.${k}.h`)}</h2>
          {k === "sight" && (
            <ul className="sh-cr-classes">
              {[["TALL", "SHELF"], ["PERCH", "PIANO"], ["SHORT", "TABLE"], ["LOW", "RUG"], ["CORPSE", "CORPSE"]].map(([cls, kind]) => (
                <li key={cls}><PropIcon kind={kind} /><span><b>{cls === "CORPSE" ? t("create.props.corpse") : t(`propInspector.${cls.toLowerCase()}Tag`)}</b><small>{cls === "CORPSE" ? t("propInspector.corpseRule") : t(`create.props.class.${cls}`)}</small></span></li>
              ))}
            </ul>
          )}
          {k === "logic" ? (
            <dl className="sh-cr-logic">{Array.from({ length: n }, (_, j) => j + 1).map((j) => <div key={j}><dt>{t(`create.guide.logic.${j}.h`)}</dt><dd><Rich text={t(`create.guide.logic.${j}.p`)} /></dd></div>)}</dl>
          ) : Array.from({ length: n }, (_, j) => j + 1).map((j) => <p key={j}><Rich text={t(`create.guide.${k}.${j}`)} /></p>)}
        </section>
      ))}
      <div className="sh-page-cta">
        <button type="button" className="sh-btn" onClick={onStart}>{t("create.guide.start")}</button>
        <button type="button" className="sh-btn ghost" onClick={onExample}>{t("create.scene.example")}</button>
      </div>
    </div>
  );
}

const COMMUNITY_CSS = `
.sh-stars{color:#5b5868;letter-spacing:1px}.sh-stars .on{color:#f2b636}.sh-stars .half{background:linear-gradient(90deg,#f2b636 50%,#5b5868 50%);-webkit-background-clip:text;background-clip:text;color:transparent}
.sh-rank-me{margin:0 0 12px!important;font-size:18px;color:var(--sh-brass)!important}
.sh-rank-scroll{overflow-x:auto;margin:0 -4px}
.sh-rank-tbl td.pos{font:400 18px 'Special Elite',monospace;width:44px;text-align:center}.sh-rank-tbl td.pos.medal{font-size:24px}
.sh-rank-tbl tr.me td{background:rgba(217,155,38,.1)}.sh-rank-tbl tr.me td:first-child{box-shadow:inset 3px 0 var(--sh-brass)}
.sh-rank-who{display:inline-flex;align-items:center;gap:10px;min-width:0}.sh-rank-who .sh-avatar{height:40px;flex:0 0 auto}
.sh-rank-who .nm{min-width:0;overflow-wrap:anywhere}
.sh-rank-tbl th .short,.sh-rank-tbl th .sh-sr{display:none}
.sh-rank-tbl .sh-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.sh-rank-who small{color:var(--sh-brass);font-weight:700}
.sh-rank-how{margin-top:12px}.sh-rank-how summary{cursor:pointer;color:var(--sh-brass);font-weight:700}
.sh-cm-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin:0 0 18px}
.sh-cm-sizes{margin:0}.sh-tabs button{padding:9px 14px;border:0;border-radius:9px;background:none;color:var(--sh-cream);font:600 15px 'Barlow',sans-serif;cursor:pointer}
.sh-tabs button:hover{background:rgba(217,155,38,.1)}.sh-tabs button.on{background:var(--sh-brass);color:#1a1408}.sh-tabs button small{opacity:.7;font-size:12px}
.sh-cm-sort{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.sh-cm-sort label{display:inline-flex;align-items:center;gap:8px;color:var(--sh-muted);font-weight:600;font-size:14px}
.sh-cm-select,.sh-cr-select{padding:7px 30px 7px 12px;border-radius:9px;border:1px solid var(--sh-line);background:#1c1c25;color:var(--sh-cream);font:600 14px 'Barlow',sans-serif}
.sh-cm-note{text-align:center;margin:24px 0}
.sh-cm-empty{text-align:center}.sh-cm-group{margin:0 0 26px}
.sh-cm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.sh-cm-card{display:flex;flex-direction:column;border-radius:14px;background:linear-gradient(180deg,#23232f,#191920);border:1px solid var(--sh-line);overflow:hidden;transition:transform .15s,border-color .15s}
.sh-cm-card:hover{transform:translateY(-2px);border-color:var(--sh-brass)}
.sh-cm-open{display:flex;flex-direction:column;gap:6px;padding:14px 16px 12px;color:var(--sh-cream);text-decoration:none;flex:1}
.sh-cm-theme{font-size:26px;line-height:1}.sh-cm-title{font-size:19px;line-height:1.2;color:var(--sh-cream);overflow-wrap:anywhere}
.sh-cm-meta{font-size:13px;color:var(--sh-muted)}.sh-cm-meta .sh-diff{font-size:13px;padding:1px 8px}
.sh-cm-stats{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;font-size:13.5px;color:#d9d3c4}.sh-cm-stats small{color:var(--sh-muted)}.sh-cm-stats .ok{color:#7fe0b4;font-weight:700}
.sh-cm-by{display:flex;align-items:center;gap:8px;padding:9px 16px;border-top:1px solid #2a2a38;font-size:13px;color:var(--sh-muted)}
.sh-cm-by .sh-avatar{height:36px}.sh-cm-mine{margin-inline-start:auto;padding:1px 8px;border-radius:99px;background:rgba(217,155,38,.16);color:var(--sh-brass);font-weight:700}
.sk-rate{display:flex;flex-direction:column;align-items:center;gap:4px;margin:6px 0 2px;padding:10px 12px;border-radius:12px;background:rgba(217,155,38,.08);border:1px solid rgba(217,155,38,.35)}
.sk-rate b{font:400 16px 'Special Elite',monospace;letter-spacing:.06em;color:var(--brass2,#f0b545)}.sk-rate p{margin:0;font-size:13.5px}.sk-rate p.bad{color:#ff8a80}
.sk-rate-stars{display:flex;gap:2px}.sk-rate-stars button{width:40px;height:40px;border:0;background:none;color:#5b5868;font-size:32px;line-height:1;cursor:pointer;transition:transform .12s,color .12s;padding:0}
.sk-rate-stars button.on{color:#f2b636}.sk-rate-stars button:hover:not(:disabled){transform:scale(1.15)}
.sh-cr-steps{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:0 0 16px;padding:0}
.sh-cr-steps button{display:inline-flex;align-items:center;gap:8px;padding:8px 13px;border-radius:99px;border:1px solid var(--sh-line);background:#1c1c25;color:var(--sh-cream);font:600 14px 'Barlow',sans-serif;cursor:pointer;position:relative}
.sh-cr-steps button.on{border-color:var(--sh-brass);background:rgba(217,155,38,.16)}.sh-cr-steps .n{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--sh-brass);color:#1a1408;font-size:12px;font-weight:800}
.sh-cr-steps .dot{width:8px;height:8px;border-radius:50%;background:var(--sh-crimson)}
.sh-cr-main{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:20px;align-items:start}
.sh-cr-left{position:sticky;top:90px}.sh-cr-boardwrap{position:relative;width:100%;max-width:min(100%,72vh);margin:0 auto;border-radius:12px;overflow:hidden;box-shadow:0 14px 34px rgba(0,0,0,.4)}
.sh-cr-board{pointer-events:none}.sh-cr-ovl{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair}.sh-cr-ovl.m-view{cursor:default}
.sh-cr-boardfail{aspect-ratio:1;background:#0f0f14}
.sh-cr-edge{cursor:pointer}.sh-cr-edge .vis{stroke:#ffffff;stroke-opacity:.35}.sh-cr-edge:hover .vis{stroke:#f6e27a;stroke-opacity:.9}.sh-cr-edge.on .vis{stroke:#f6e27a;stroke-opacity:1}
.sh-cr-under{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;flex-wrap:wrap}
.sh-cr-right{min-width:0;padding:clamp(14px,2.4vw,20px);border-radius:14px;background:linear-gradient(180deg,#20202b,#181820);border:1px solid var(--sh-line)}
.sh-cr-right h2{margin:0 0 10px;font-size:21px;color:var(--sh-brass)}
.sh-cr-panel{display:flex;flex-direction:column;gap:10px}.sh-cr-panel .sh-input{width:100%}.sh-cr-panel .sh-row{display:flex;gap:8px;flex-wrap:wrap}
.sh-cr-nav{display:flex;justify-content:space-between;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid #2a2a38}.sh-cr-nav :only-child{margin-inline-start:auto}
.sh-cr-seg{display:inline-flex;gap:4px;padding:4px;border-radius:10px;background:#15151c;border:1px solid var(--sh-line);align-self:flex-start}
.sh-cr-seg button{padding:7px 12px;border:0;border-radius:7px;background:none;color:var(--sh-cream);font:600 14px 'Barlow',sans-serif;cursor:pointer}.sh-cr-seg button.on{background:var(--sh-brass);color:#1a1408}
.sh-cr-zones{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}
.sh-cr-zones button{display:grid;grid-template-columns:14px 1fr;grid-template-rows:auto auto;column-gap:8px;align-items:center;width:100%;padding:7px 9px;border-radius:9px;border:1px solid var(--sh-line);background:#1c1c25;color:var(--sh-cream);text-align:start;cursor:pointer;font:600 14px 'Barlow',sans-serif}
.sh-cr-zones button.on{border-color:var(--sh-brass);background:rgba(217,155,38,.14)}.sh-cr-zones i{grid-row:1/3;width:14px;height:14px;border-radius:4px;border:1px solid #666}
.sh-cr-zones small{grid-column:2;color:var(--sh-muted);font-size:12px;font-weight:500}.sh-cr-zones small.bad{color:#ff8a80}
.sh-cr-props{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:6px}
.sh-cr-prop{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 4px;border-radius:10px;border:1px solid var(--sh-line);background:#1c1c25;color:var(--sh-cream);font:600 12px/1.2 'Barlow',sans-serif;cursor:pointer;text-align:center}
.sh-cr-prop.on{border-color:var(--sh-brass);background:rgba(217,155,38,.16)}.sh-cr-prop .ico{font-size:28px;line-height:44px}
.sh-cr-propgroup h4{margin:6px 0 6px;font-size:14px}.sh-cr-propgroup h4 small{color:var(--sh-muted);font-weight:500}
.sh-cr-cls{display:inline-block;padding:1px 8px;border-radius:5px;font:700 12px 'Barlow',sans-serif;letter-spacing:.05em;text-transform:uppercase;background:#2a2a36}
.sh-cr-cls.c-tall{background:#5a2b2b}.sh-cr-cls.c-perch{background:#5a4220}.sh-cr-cls.c-short{background:#24425a}.sh-cr-cls.c-low{background:#2b5a3a}
.sh-cr-check{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px}.sh-cr-select.sm{padding:4px 24px 4px 8px;font-size:13px}
.sh-cr-cast{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.sh-cr-cast li{display:flex;align-items:center;gap:6px;padding:4px;border-radius:12px;border:1px solid transparent}.sh-cr-cast li.on{border-color:var(--sh-brass);background:rgba(217,155,38,.08)}
.sh-cr-face{display:flex;align-items:center;gap:10px;flex:1;min-width:0;border:0;background:none;color:var(--sh-cream);text-align:start;cursor:pointer;padding:0}
.sh-cr-face span{display:flex;flex-direction:column;min-width:0}.sh-cr-face small{color:var(--sh-muted)}
.sh-cr-mini{flex:0 0 auto;width:30px;height:30px;border-radius:8px;border:1px solid var(--sh-line);background:#15151c;color:var(--sh-cream);cursor:pointer;font-size:16px;line-height:1}
.sh-cr-mini:hover{border-color:var(--sh-brass);color:var(--sh-brass)}
.sh-cr-dark{margin:4px 0 0;padding:9px 12px;border-radius:10px;font-weight:600;font-size:14px}.sh-cr-dark.ok{background:rgba(88,183,132,.14);color:#9fe7bf}.sh-cr-dark.bad{background:rgba(200,62,59,.14);color:#ffb0a8}
.sh-cr-who{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.sh-cr-who button{display:flex;flex-direction:column;align-items:center;min-width:54px;padding:6px 8px;border-radius:10px;border:1px solid var(--sh-line);background:#1c1c25;color:var(--sh-cream);font:800 16px 'Barlow',sans-serif;cursor:pointer}
.sh-cr-who button small{font-size:10.5px;font-weight:600;color:var(--sh-muted)}.sh-cr-who button.on{border-color:var(--sh-brass);background:rgba(217,155,38,.16)}
.sh-cr-who button.ok{box-shadow:inset 0 -3px #58b784}.sh-cr-who button.bad{box-shadow:inset 0 -3px var(--sh-crimson)}
.sh-cr-clue{display:flex;gap:12px;align-items:flex-start}.sh-cr-clue>div{flex:1;min-width:0}
.sh-cr-sentence{margin:0 0 6px!important;font:400 16px/1.45 'Special Elite',monospace;color:var(--sh-cream)!important}
.sh-cr-parts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.sh-cr-parts li{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;background:#15151c;font-size:13.5px}.sh-cr-parts li span{flex:1}
.sh-cr-parts li.bad{background:rgba(200,62,59,.16)}.sh-cr-parts li small{color:#ff8a80}
.sh-cr-addh{margin:6px 0 0;font-size:14px}.sh-cr-addh small{color:var(--sh-muted);font-weight:500}
.sh-cr-opts{border-radius:10px;background:#15151c;border:1px solid #2a2a38}.sh-cr-opts summary{padding:8px 12px;cursor:pointer;font-weight:700;font-size:14px}.sh-cr-opts summary small{color:var(--sh-muted)}
.sh-cr-opts>div{display:flex;flex-wrap:wrap;gap:6px;padding:0 10px 10px;max-height:240px;overflow:auto}
.sh-cr-opt{padding:6px 10px;border-radius:8px;border:1px solid var(--sh-line);background:#1f1f2a;color:var(--sh-cream);font:500 13px/1.3 'Barlow',sans-serif;text-align:start;cursor:pointer}
.sh-cr-opt:hover:not(:disabled){border-color:var(--sh-brass)}.sh-cr-opt:disabled{opacity:.4;cursor:not-allowed}
.sh-cr-check-box{margin-top:8px;padding:10px 12px;border-radius:12px;border:1px solid var(--sh-line);background:#15151c}
.sh-cr-check-box h4{margin:0 0 4px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--sh-muted)}.sh-cr-check-box p{margin:0 0 6px!important;font-size:14px}
.sh-cr-check-box .ok{color:#9fe7bf!important;font-weight:700}.sh-cr-check-box .bad{color:#ffb0a8!important;font-weight:600}
.sh-cr-check-box.s-unique{border-color:#3d8a62}.sh-cr-check-box.s-multiple,.sh-cr-check-box.s-open,.sh-cr-check-box.s-none{border-color:#8a3d3d}
.sh-cr-problems h4{margin:4px 0;font-size:14px}.sh-cr-problems ul{margin:0;padding-inline-start:18px;font-size:13.5px}.sh-cr-problems li.error{color:#ffb0a8}.sh-cr-problems li.warn{color:#e8d38f}
.sh-cr-done{padding:12px;border-radius:12px;background:rgba(88,183,132,.12);border:1px solid #3d8a62}.sh-cr-done p{margin:0 0 8px!important;color:#9fe7bf!important;font-weight:700}
.sh-cr-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:80;max-width:min(92vw,520px);padding:11px 18px;border-radius:12px;background:#2b2620;border:1px solid var(--sh-brass);color:var(--sh-cream);font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.sh-cr-guide .sh-pcard p{color:#dcd7cb}
.sh-cr-classes{list-style:none;margin:6px 0 12px;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
.sh-cr-classes li{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:#15151c}.sh-cr-classes span{display:flex;flex-direction:column}.sh-cr-classes small{color:var(--sh-muted)}
.sh-cr-logic{margin:0;display:flex;flex-direction:column;gap:10px}.sh-cr-logic dt{font-weight:700;color:var(--sh-cream)}.sh-cr-logic dd{margin:2px 0 0;color:#dcd7cb}
@media (max-width:860px){.sh-cr-main{grid-template-columns:1fr}.sh-cr-left{position:static}.sh-cr-boardwrap{max-width:100%}}
@media (max-width:640px){.sh-cm-bar{flex-direction:column;align-items:stretch}.sh-cm-sort{justify-content:space-between}.sh-rank-tbl th:nth-child(4),.sh-rank-tbl td:nth-child(4){display:none}
  .sh-rank-scroll{margin:0}.sh-rank-tbl th,.sh-rank-tbl td{padding:8px 3px}.sh-rank-tbl .num{text-align:center;white-space:nowrap}
  .sh-rank-tbl th .full{display:none}.sh-rank-tbl th .short{display:inline;font-size:16px;letter-spacing:0}.sh-rank-tbl th .sh-sr{display:inline-block}
  .sh-rank-tbl td.pos{width:28px;font-size:16px}.sh-rank-tbl td.pos.medal{font-size:20px}.sh-rank-tbl td b{font-size:16px}
  .sh-rank-who{gap:7px}.sh-rank-who small{display:block}}
`;
