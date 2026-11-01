/* eslint-disable react/prop-types */
/**
 * umbra.jsx — "The Umbra Conspiracy": the endgame that links the ten standard contracts, the Hard 3-assassin contract and the
 * Expert 5-assassin finale. Every lock is visual (no typing, no spelling, no words to read), so it plays the same in every
 * language. All narrative text is in src/locales/en.json (ui.relic.*, ui.conspiracy.*, ui.sanctum.*, ui.game.solved.umbra.*).
 *
 *   Phase 1  each solved case1-case10 shows its victim's relic (VictimRelicSvg) in the Contract Fulfilled banner, and a brass relic
 *            badge on its envelope in the contracts hub. Every relic hides one torn strip of the same page: Master U. M. Bra's
 *            private ledger (LedgerStrip). The strips are not in case order (STRIP_OF).
 *   Phase 2  with all ten solved, a black envelope from the Uninvited opens the Evidence Board: swap the ten strips until every
 *            torn edge meets its twin. The whole page shows the manor's floorplan, its front door circled in red and an arrow
 *            to the door's combination. Turn the four brass dials to it (CRYPTEX_CODE) and "The Uninvited Guests"
 *            (MAH1010QAR3-4101) unlocks (localStorage "shadoku-unlocked-4101"). With fewer strips the digits stay torn in half.
 *   Phase 3  "The Uninvited Guests" kills N. O. Ir, the Master's hooded second in command, and the red folder he carried is
 *            Dossier № 000-OMEGA (FinalDossier). No puzzle: the Master's own orders in his hand, and black-and-white surveillance
 *            polaroids of the ten victims, the proof that he is the mastermind. Tucked in at the bottom, the Uninvited's sealed
 *            black envelope: breaking the silver seal shows their letter above (he kills for his own gain, against the Syndicate's
 *            code), and below it the contract card with his polaroid. Accepting it unlocks "Five Shadows at the Manor" (MAX1111RAR5-4201,
 *            "shadoku-unlocked-4201"), whose corpse is the Master.
 *
 * The two multi-assassin contracts stay hidden in the hub until unlocked (a contract the player has already fulfilled counts
 * as unlocked). Storage goes through try/catch: a private window simply keeps the locks closed for the session.
 */
import React, { useEffect, useId, useRef, useState } from "react";
import { useText } from "./i18n.js";
import { VictimRelicSvg, VictimPolaroid, UninvitedSigil, victimNameOf, RELIC_IDS } from "./ShadokuArt.jsx";

export const UMBRA_HARD = "MAH1010QAR3-4101";   // "The Uninvited Guests"
export const UMBRA_FINALE = "MAX1111RAR5-4201"; // "Five Shadows at the Manor": Master U. M. Bra is the corpse
export const RELIC_CASES = RELIC_IDS || ["case1", "case2", "case3", "case4", "case5", "case6", "case7", "case8", "case9", "case10"];
export const CRYPTEX_CODE = [4, 1, 0, 1]; // the manor door's combination, written on the ledger page
const UNLOCK_KEY = { [UMBRA_HARD]: "shadoku-unlocked-4101", [UMBRA_FINALE]: "shadoku-unlocked-4201" };
const UMBRA_EVENT = "shadoku-umbra"; // window event: an unlock happened (the hub and the game re-read the locks)

/* ───────────── state ───────────── */
const readFlag = (k) => { try { return window.localStorage.getItem(k) === "1"; } catch { return false; } };
/** Is `id` playable? Standard contracts always are; the two Umbra contracts once unlocked (or already fulfilled). */
export function isUnlocked(id, solved = new Set()) {
  if (!UNLOCK_KEY[id]) return true;
  return readFlag(UNLOCK_KEY[id]) || solved.has(id);
}
/** Seals both Umbra contracts again (the /test/umbra page): a contract already fulfilled stays open anyway. */
export function resetUmbraLocks() {
  Object.values(UNLOCK_KEY).forEach((k) => { try { window.localStorage.removeItem(k); } catch { /* noop */ } });
  try { window.dispatchEvent(new Event(UMBRA_EVENT)); } catch { /* noop */ }
}
export function unlock(id) {
  try { window.localStorage.setItem(UNLOCK_KEY[id], "1"); } catch { /* private mode: open for this visit only */ }
  try { window.dispatchEvent(new Event(UMBRA_EVENT)); } catch { /* noop */ }
}
export const isRelicCase = (id) => RELIC_CASES.includes(id);
export const allRelics = (solved) => RELIC_CASES.every((id) => solved.has(id));
/** Re-render when an Umbra lock opens anywhere on the page. */
export function useUmbraTick() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const on = () => setN((x) => x + 1);
    window.addEventListener(UMBRA_EVENT, on);
    return () => window.removeEventListener(UMBRA_EVENT, on);
  }, []);
  return n;
}
/** A unique, url()-safe id prefix (React's useId has colons). */
const useSvgId = (p) => `${p}${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

/* ───────────── the Master's ledger page, torn in ten ───────────── */
const PW = 400, PH = 200, N = 10, SW = PW / N; // the page, and the width of one strip
/** Which strip of the page (0 = the left edge) each relic hides: deliberately not the case order. */
export const STRIP_OF = { case1: 6, case2: 2, case3: 9, case4: 0, case5: 4, case6: 7, case7: 1, case8: 5, case9: 3, case10: 8 };
/** The nine torn edges, top to bottom: tear k runs between strip k and strip k + 1 (a fixed seed: every player gets the same page). */
const TEARS = (() => {
  let seed = 4101;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  return Array.from({ length: N - 1 }, (_, k) => {
    const pts = [];
    for (let i = 0, y = 0; y <= PH; i++, y = Math.min(PH, y + 9 + rnd() * 9)) {
      pts.push([+(SW * (k + 1) + (i % 2 ? 1 : -1) * (1.5 + rnd() * 4.5)).toFixed(1), +y.toFixed(1)]);
      if (y === PH) break;
    }
    return pts;
  });
})();
/** The outline of strip `s` in page coordinates: its left tear down, its right tear up (the page's own edges are straight). */
const stripPath = (s) => {
  const left = s === 0 ? [[0, 0], [0, PH]] : TEARS[s - 1];
  const right = s === N - 1 ? [[PW, PH], [PW, 0]] : [...TEARS[s]].reverse();
  return `M${[...left, ...right].map(([x, y]) => `${x} ${y}`).join("L")}Z`;
};
const INK = "#22305c", RED = "#b3262b";

/** The whole page, drawn once in page coordinates (0..400 × 0..200). No words: a floorplan, a circled door, an arrow, four digits. */
function LedgerPageArt({ id, paper }) {
  return (
    <g id={id}>
      <rect width={PW} height={PH} fill={`url(#${paper}-paper)`} />
      {Array.from({ length: 11 }, (_, i) => <path key={i} d={`M0 ${30 + i * 16}H${PW}`} stroke="#8fa6bf" strokeWidth=".8" opacity=".45" />)}
      <path d="M30 0V200" stroke="#c8524f" strokeWidth="1.2" opacity=".7" />
      {[40, 100, 160].map((y) => <circle key={y} cx="13" cy={y} r="4.5" fill="#0f0d12" />)}
      <circle cx="118" cy="62" r="30" fill="none" stroke="#7b4f22" strokeWidth="5" opacity=".16" />
      <path d="M92 48a30 30 0 0 1 44-12" fill="none" stroke="#7b4f22" strokeWidth="2.4" opacity=".14" />
      {/* the manor, from above: rooms, inner doors, the stairs, and the front door left open in the south wall */}
      <g fill="none" stroke={INK} strokeLinecap="round" strokeLinejoin="round">
        <path d="M188 94H56V16H344V94H212" strokeWidth="2.6" />
        <path d="M150 16V58M150 74V94M250 16V42M250 58V94M56 56H108M124 56H150M250 54H298M314 54H344" strokeWidth="1.8" />
        <path d="M262 22V46M270 22V46M278 22V46M286 22V46M294 22V46M302 22V46" strokeWidth=".9" opacity=".75" />
        <path d="M66 26l10 10M76 26l-10 10M318 66l10 10M328 66l-10 10M176 30l8 8M184 30l-8 8" strokeWidth="1.3" opacity=".6" />
      </g>
      <ellipse cx="200" cy="95" rx="24" ry="12" fill="none" stroke={RED} strokeWidth="2.2" transform="rotate(-6 200 95)" />
      <path d="M201 109C195 116 207 121 200 131" fill="none" stroke={RED} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M193 125L200 134L207 125" fill="none" stroke={RED} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      {/* the combination: every digit straddles a tear, so it only reads once both halves meet */}
      <rect x="44" y="137" width="312" height="56" rx="6" fill="none" stroke={RED} strokeWidth="1.6" strokeDasharray="7 4" opacity=".85" />
      {CRYPTEX_CODE.map((d, i) => (
        <text key={i} x={80 + i * 80} y="185" textAnchor="middle" fontFamily="'Special Elite','Courier New',monospace" fontSize="56" fill={INK}>{d}</text>
      ))}
      {/* the Master's wax seal in the corner */}
      <circle cx="372" cy="34" r="18" fill="#7a1d2c" />
      <circle cx="372" cy="34" r="13" fill="none" stroke="#e7a99b" strokeWidth="1" opacity=".7" />
      <text x="372" y="37.5" textAnchor="middle" fontFamily="'Special Elite','Courier New',monospace" fontSize="9" fill="#f3d2c8">UMB</text>
    </g>
  );
}
function PaperDefs({ id }) {
  return (
    <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#f3e7c9" /><stop offset=".6" stopColor="#eadbb5" /><stop offset="1" stopColor="#dcc89a" />
    </linearGradient>
  );
}

/** One torn strip on its own: the piece of the page hidden in `caseId`'s relic. `height` in px. */
export function LedgerStrip({ caseId, height = 84 }) {
  const t = useText();
  const id = useSvgId("umls");
  const s = STRIP_OF[caseId];
  if (s === undefined) return null;
  const x0 = s * SW - 8, w = SW + 16;
  return (
    <svg className="um-strip" viewBox={`${x0} -4 ${w} ${PH + 8}`} height={height} width={(height * w) / (PH + 8)} role="img" aria-label={t("relic.stripAria", { title: t(`relic.${caseId}.title`) })}>
      <defs><PaperDefs id={id} /><clipPath id={`${id}-c`}><path d={stripPath(s)} /></clipPath></defs>
      <path d={stripPath(s)} fill="#000" opacity=".35" transform="translate(1.5 2.5)" />
      <g clipPath={`url(#${id}-c)`}><LedgerPageArt id={`${id}-p`} paper={id} /></g>
      <path d={stripPath(s)} fill="none" stroke="#b9a678" strokeWidth=".9" />
    </svg>
  );
}

/* ───────────── shared modal shell ───────────── */
function Modal({ label, onClose, wide = false, children }) {
  const t = useText();
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="um-modal" role="dialog" aria-modal="true" aria-label={label} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <style>{CSS}</style>
      <div className={`um-card${wide ? " wide" : ""}`}>
        <button type="button" className="um-x" onClick={onClose} aria-label={t("conspiracy.close")}>×</button>
        {children}
      </div>
    </div>
  );
}

/* ───────────── Phase 1: the relic card ───────────── */
/** "Recovered from the Body": the relic of a solved standard contract and the strip hidden in it (Contract Fulfilled banner, hub, profile). */
export function RelicCard({ caseId, compact = false }) {
  const t = useText();
  if (!isRelicCase(caseId)) return null;
  return (
    <div className={`um-relic${compact ? " compact" : ""}`}>
      <style>{CSS}</style>
      <div className="um-relic-pic"><VictimRelicSvg caseId={caseId} size={compact ? 56 : 84} /></div>
      <div className="um-relic-txt">
        <small>{t("relic.recovered")}</small>
        <b>{t(`relic.${caseId}.title`)}</b>
        <span>{t(`relic.${caseId}.desc`)}</span>
      </div>
      <div className="um-relic-strip" title={t("relic.strip")}><LedgerStrip caseId={caseId} height={compact ? 64 : 92} /></div>
    </div>
  );
}

/** The hub's small brass relic badge on a solved standard contract: opens its relic card. */
export function RelicBadge({ caseId, onOpen }) {
  const t = useText();
  if (!isRelicCase(caseId)) return null;
  return (
    <button type="button" className="um-badge" onClick={(e) => { e.stopPropagation(); onOpen(caseId); }} aria-label={t("relic.inspect", { title: t(`relic.${caseId}.title`) })} title={t(`relic.${caseId}.title`)}>
      <style>{CSS}</style>
      <VictimRelicSvg caseId={caseId} size={26} />
    </button>
  );
}

export function RelicModal({ caseId, onClose }) {
  const t = useText();
  return <Modal label={t(`relic.${caseId}.title`)} onClose={onClose}><RelicCard caseId={caseId} /></Modal>;
}

/**
 * The profile's Collection: the ten relics, recovered or still out there. `solved` = Set of fulfilled contract ids;
 * `onOpenBoard` opens the Evidence Board (shown once all ten are in).
 */
export function RelicCollection({ solved, onOpenBoard }) {
  const t = useText();
  const have = RELIC_CASES.filter((id) => solved.has(id)).length;
  return (
    <div className="um-coll">
      <style>{CSS}</style>
      <p className="um-coll-sum">{t("relic.collected", { n: have, total: RELIC_CASES.length })}</p>
      {have === RELIC_CASES.length && onOpenBoard && (
        <div className="um-coll-env"><ObsidianEnvelope small onOpen={onOpenBoard} /><span>{t("conspiracy.envelope.caption")}</span></div>
      )}
      <ul className="um-coll-grid">
        {RELIC_CASES.map((id, i) => (solved.has(id)
          ? <li key={id}><RelicCard caseId={id} compact /></li>
          : (
            <li key={id} className="um-relic compact missing">
              <div className="um-relic-pic"><VictimRelicSvg caseId="unknown" size={56} /></div>
              <div className="um-relic-txt">
                <small>{t("relic.missing", { n: i + 1 })}</small>
                <span>{t("relic.missingHint", { n: String(i + 1).padStart(3, "0") })}</span>
              </div>
            </li>
          )))}
      </ul>
    </div>
  );
}

/* ───────────── the two tokens that open phases 2 and 3 ───────────── */
/** The pulsing black obsidian envelope of the Uninvited, with their silver seal (the keyhole eye, UninvitedSigil). */
export function ObsidianEnvelope({ onOpen, small = false }) {
  const t = useText();
  return (
    <button type="button" className={`um-env${small ? " small" : ""}`} onClick={onOpen} aria-label={t("conspiracy.envelope.open")}>
      <style>{CSS}</style>
      <svg viewBox="0 0 120 80" aria-hidden="true">
        <defs>
          <linearGradient id="umObs" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2b2933" /><stop offset=".55" stopColor="#0d0c12" /><stop offset="1" stopColor="#1d1b24" /></linearGradient>
          <radialGradient id="umWax" cx=".4" cy=".35" r=".7"><stop offset="0" stopColor="#f4f5f8" /><stop offset=".55" stopColor="#b9bdc8" /><stop offset="1" stopColor="#6d7180" /></radialGradient>
        </defs>
        <rect x="4" y="6" width="112" height="68" rx="6" fill="url(#umObs)" stroke="#5a5566" strokeWidth="1.5" />
        <path d="M4 10 L60 46 L116 10" fill="none" stroke="#4a4655" strokeWidth="2" />
        <path d="M14 70 L48 40 M106 70 L72 40" stroke="#26232d" strokeWidth="1.5" />
        <path d="M22 18 l6 4 M96 20 l-5 3" stroke="#8a8598" strokeWidth=".8" opacity=".6" />
        <circle cx="60" cy="46" r="12" fill="url(#umWax)" stroke="#565a66" strokeWidth="1" />
        <circle cx="60" cy="46" r="9.6" fill="none" stroke="#7d8190" strokeWidth=".8" />
        <UninvitedSigil transform="translate(60 46.4) scale(.2) translate(-50 -50)" />
      </svg>
      {!small && <span>{t("conspiracy.envelope.caption")}</span>}
    </button>
  );
}

/** The velvet-burgundy Classified Folder with brass corners: DOSSIER № 000-OMEGA. */
export function OmegaFolder({ onOpen, small = false }) {
  const t = useText();
  return (
    <button type="button" className={`um-env folder${small ? " small" : ""}`} onClick={onOpen} aria-label={t("sanctum.folder.open")}>
      <style>{CSS}</style>
      <svg viewBox="0 0 120 84" aria-hidden="true">
        <defs><linearGradient id="umVel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7a1d2c" /><stop offset="1" stopColor="#3f0c16" /></linearGradient></defs>
        <path d="M6 14 h36 l8 -8 h64 v72 H6 Z" fill="url(#umVel)" stroke="#2a070e" strokeWidth="1.5" />
        <rect x="6" y="18" width="108" height="60" fill="#5e1422" opacity=".55" />
        {[[6, 18, 1, 1], [114, 18, -1, 1], [6, 78, 1, -1], [114, 78, -1, -1]].map(([x, y, sx, sy], i) => (
          <path key={i} d={`M${x} ${y + 12 * sy} V${y} H${x + 12 * sx}`} fill="none" stroke="#d99b26" strokeWidth="3" strokeLinejoin="round" />
        ))}
        <rect x="30" y="38" width="60" height="20" rx="2" fill="#f2e6cf" stroke="#d99b26" strokeWidth="1.2" />
        <text x="60" y="52" textAnchor="middle" fontFamily="'Special Elite', monospace" fontSize="10" fill="#7a1d2c">000-Ω</text>
      </svg>
      {!small && <span>{t("sanctum.folder.caption")}</span>}
    </button>
  );
}

/* ───────────── Phase 2: the Evidence Board (the torn page) and the 4-wheel brass cryptex ───────────── */
const SOLVED_ORDER = [...RELIC_CASES].sort((a, b) => STRIP_OF[a] - STRIP_OF[b]);

/** `test`: the /test/umbra page: always starts unsolved and never saves or unlocks anything. */
export function EvidenceBoard({ onClose, onLaunch, test = false }) {
  const t = useText();
  const id = useSvgId("umlb");
  const [wasOpen] = useState(() => !test && readFlag(UNLOCK_KEY[UMBRA_HARD])); // opened on an earlier visit: shown solved
  const [order, setOrder] = useState(() => (wasOpen ? SOLVED_ORDER : [...RELIC_CASES])); // order[k] = the relic whose strip lies in slot k
  const [held, setPick] = useState(null); // the slot of the strip in hand
  const [dials, setDials] = useState(() => (wasOpen ? [...CRYPTEX_CODE] : [0, 0, 0, 0]));
  const whole = order.every((c, k) => STRIP_OF[c] === k);
  const sprung = dials.every((d, i) => d === CRYPTEX_CODE[i]);
  const open = wasOpen || sprung;
  useEffect(() => { if (sprung && !wasOpen && !test) unlock(UMBRA_HARD); }, [sprung, wasOpen, test]);
  const pick = whole ? null : held; // a whole page is glued: nothing stays in hand
  const turn = (i, by) => { if (!open) setDials((d) => d.map((v, k) => (k === i ? (v + by + 10) % 10 : v))); };
  const tap = (k) => {
    if (whole) return;
    if (pick === null) { setPick(k); return; }
    if (pick !== k) setOrder((o) => { const n = [...o]; [n[pick], n[k]] = [n[k], n[pick]]; return n; });
    setPick(null);
  };
  return (
    <Modal label={t("conspiracy.board.title")} onClose={onClose} wide>
      <div className="um-letter">
        <h2>{t("conspiracy.letter.title")}</h2>
        <p>{t("conspiracy.letter.p1")}</p>
        <p>{t("conspiracy.letter.p2")}</p>
        <p>{t("conspiracy.letter.p3")}</p>
        <p className="um-sign">{t("conspiracy.letter.from")}</p>
      </div>
      <div className={`um-board${whole ? " whole" : ""}${open ? " open" : ""}`}>
        <h3 className="um-board-h">{t("conspiracy.board.title")}</h3>
        <div className="um-ledger">
          <div className="um-tags" aria-hidden="true">
            {order.map((c, k) => <span key={c} className={pick === k ? "on" : ""}><VictimRelicSvg caseId={c} size={30} /></span>)}
          </div>
          <div className="um-page">
            <svg viewBox={`-6 -10 ${PW + 12} ${PH + 20}`} aria-hidden="true">
              <defs>
                <PaperDefs id={id} />
                <LedgerPageArt id={`${id}-pg`} paper={id} />
                {RELIC_CASES.map((c) => <clipPath key={c} id={`${id}-c${STRIP_OF[c]}`}><path d={stripPath(STRIP_OF[c])} /></clipPath>)}
              </defs>
              <rect x="-6" y="-10" width={PW + 12} height={PH + 20} rx="6" fill="#0f0d12" />
              {order.map((c, k) => {
                const s = STRIP_OF[c], up = pick === k;
                return (
                  <g key={c} transform={`translate(${(k - s) * SW} ${up ? -7 : 0})`} className="um-piece">
                    <path d={stripPath(s)} fill="#000" opacity=".4" transform="translate(1.5 2.5)" />
                    <use href={`#${id}-pg`} clipPath={`url(#${id}-c${s})`} />
                    <path d={stripPath(s)} fill="none" stroke={up ? "#f0b94a" : "#b9a678"} strokeWidth={up ? 2 : 0.9} className="um-tear" />
                  </g>
                );
              })}
            </svg>
            <div className="um-slots" role="group" aria-label={t("conspiracy.board.title")}>
              {order.map((c, k) => (
                <button key={c} type="button" aria-pressed={pick === k} disabled={whole} onClick={() => tap(k)}
                  aria-label={t("conspiracy.relic.slot", { n: k + 1, title: t(`relic.${c}.title`) })} title={t(`relic.${c}.title`)} />
              ))}
            </div>
          </div>
        </div>
        <p className="um-hint" role="status">{whole ? t("conspiracy.board.whole") : t("conspiracy.board.hint")}</p>
        <div className="um-cryptex" role="group" aria-label={t("conspiracy.dial.group")}>
          {dials.map((d, i) => (
            <div key={i} className="um-wheel">
              <button type="button" onClick={() => turn(i, 1)} aria-label={t("conspiracy.dial.up", { n: i + 1 })} disabled={open}>▲</button>
              <output aria-label={t("conspiracy.dial.aria", { n: i + 1, value: d })}><span className="prev">{(d + 9) % 10}</span><b>{d}</b><span className="next">{(d + 1) % 10}</span></output>
              <button type="button" onClick={() => turn(i, -1)} aria-label={t("conspiracy.dial.down", { n: i + 1 })} disabled={open}>▼</button>
            </div>
          ))}
          <div className={`um-lock${open ? " sprung" : ""}`} aria-hidden="true">
            <svg viewBox="0 0 40 48"><path d={open ? "M10 22 V14 a10 10 0 0 1 20 0" : "M10 22 V14 a10 10 0 0 1 20 0 V22"} fill="none" stroke="#d99b26" strokeWidth="4" /><rect x="4" y="22" width="32" height="24" rx="4" fill="#d99b26" /><circle cx="20" cy="33" r="3.5" fill="#3a2a0c" /></svg>
          </div>
        </div>
      </div>
      {open && (
        <div className="um-done" role="status">
          <b>{t("conspiracy.unlocked.title")}</b>
          <span>{t("conspiracy.unlocked.text")}</span>
          <div className="um-acts">
            {onLaunch && <button type="button" className="go" onClick={() => onLaunch(UMBRA_HARD)}>{t("conspiracy.launch")}</button>}
            <button type="button" onClick={onClose}>{t("conspiracy.later")}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ───────────── Phase 3: Dossier № 000-OMEGA (no puzzle: the Master's own file, and the Uninvited's last contract) ───────────── */
/** How the ten surveillance photos lie on the felt: [rotation°, nudge up px] per victim, case order. */
const SPREAD = [[-6, 0], [4, 6], [-2, -2], [7, 4], [-5, 2], [3, -4], [-8, 4], [5, 0], [-3, 6], [6, -2]];

/** One black-and-white surveillance photo of a victim: their polaroid in grey, a paper clip, the Master's red X. */
function SurveillancePhoto({ caseId, i }) {
  const [rot, dy] = SPREAD[i % SPREAD.length];
  const name = victimNameOf({ id: caseId });
  return (
    <figure className="um-photo" style={{ "--r": `${rot}deg`, "--dy": `${dy}px` }}>
      <div className="um-bw"><VictimPolaroid name={name} size={140} tilt={0} target={false} /></div>
      <svg className="um-x-mark" viewBox="-8 -6 136 164" aria-hidden="true">
        <path d="M30 26Q60 58 92 96M90 24Q62 60 28 98" fill="none" stroke="#c8242c" strokeWidth="5" strokeLinecap="round" opacity=".88" />
      </svg>
      <svg className="um-clip" viewBox="0 0 14 30" aria-hidden="true">
        <path d="M4 26V6a3 3 0 0 1 6 0v18a5 5 0 0 1-10 0V9" fill="none" stroke="#b9bdc8" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </figure>
  );
}

/**
 * The red folder taken from N. O. Ir. `envelope`: the Uninvited's black envelope, built by the caller as `(onOpen) => node` (the
 * site's sealed ContractEnvelope, variant "modal", autoOpen false, U. M. Bra's polaroid as the target, `onOpen` passed through):
 * once its seal breaks, their letter shows under it. Accepting should call acceptFinale() and open the finale. Without an
 * envelope, the letter and a plain accept button stand in.
 */
export function FinalDossier({ onClose, envelope = null, onAccept = null }) {
  const t = useText();
  const [opened, setOpened] = useState(false);
  const env = typeof envelope === "function" ? envelope(() => setOpened(true)) : envelope;
  const letter = useRef(null);
  useEffect(() => { // the seal broke: bring their letter, which now sits above the contract, into view
    if (!opened) return undefined;
    const w = setTimeout(() => letter.current && letter.current.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    return () => clearTimeout(w);
  }, [opened]);
  return (
    <Modal label={t("sanctum.lore.title")} onClose={onClose} wide>
      <div className="um-dossier">
        <h2>{t("sanctum.lore.title")}</h2>
        <p className="um-dos-found">{t("sanctum.found")}</p>
        <div className="um-memo">
          <small>{t("sanctum.memo.head")}</small>
          <p>{t("sanctum.memo.p1")}</p>
          <p>{t("sanctum.memo.p2")}</p>
          <p>{t("sanctum.memo.p3")}</p>
          <p className="um-memo-sign">{t("sanctum.memo.sign")}</p>
          <span className="um-memo-stamp" aria-hidden="true">{t("sanctum.memo.stamp")}</span>
        </div>
        <div className="um-spread" role="img" aria-label={t("sanctum.photos")}>
          {RELIC_CASES.map((id, i) => <SurveillancePhoto key={id} caseId={id} i={i} />)}
        </div>
        <p className="um-spread-cap">{t("sanctum.photos")}</p>
      </div>
      <div className="um-final">
        <small>{t("sanctum.envelope.caption")}</small>
        {(opened || !env) && (
          <div className="um-letter uninvited" role="status" ref={letter}>
            <p>{t("sanctum.lore.p1")}</p>
            <p>{t("sanctum.lore.p2")}</p>
            <p>{t("sanctum.lore.p3")}</p>
            <p>{t("sanctum.lore.p4")}</p>
            <p className="um-sign">{t("conspiracy.letter.from")}</p>
          </div>
        )}
        {env}
        {!env && onAccept && <div className="um-acts"><button type="button" className="go" onClick={onAccept}>{t("sanctum.launch")}</button></div>}
      </div>
    </Modal>
  );
}
/** The player accepted U. M. Bra's contract: the finale opens for good. */
export const acceptFinale = () => unlock(UMBRA_FINALE);

/* ───────────── styles ───────────── */
const CSS = `
.um-modal{position:fixed;inset:0;z-index:70;display:grid;place-items:center;padding:16px;overflow:auto;background:rgba(6,6,10,.84);animation:umFade .2s ease}
.um-card{position:relative;width:min(560px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:#17151d;color:#ebe6d9;border:1px solid #4a3a1a;border-radius:16px;padding:22px 20px 20px;box-shadow:0 24px 70px rgba(0,0,0,.6)}
.um-card.wide{width:min(760px,100%)}
.um-x{position:absolute;top:8px;right:10px;width:34px;height:34px;font-size:24px;color:#a9adbd;background:none;border:0;cursor:pointer}
.um-letter h2{margin:0 0 10px;font:400 24px/1.15 'Special Elite',monospace;color:#f0b94a;padding-right:34px}
.um-letter h3{margin:16px 0 6px;font:400 18px/1.2 'Special Elite',monospace;color:#f0b94a}
.um-letter p{margin:0 0 8px;font:italic 15.5px/1.5 'Barlow',sans-serif;color:#d9d3c4}
.um-letter .um-sign{text-align:right;font-style:normal;font-family:'Special Elite',monospace;color:#b9bdc8}
.um-letter.dossier{border-left:3px solid #7a1d2c;padding-left:12px}
.um-relic{display:flex;align-items:center;gap:12px;margin-top:10px;padding:10px 12px;border-radius:12px;background:linear-gradient(135deg,#221c12,#141218);border:1px solid #6e5320}
.um-relic.compact{margin-top:8px;padding:8px 10px}
.um-relic-pic{flex:0 0 auto;display:grid;place-items:center;border-radius:10px;background:radial-gradient(circle,#2f2618,#121016);padding:4px}
.um-relic-txt{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
.um-relic-txt small{font:400 11px/1.2 'Special Elite',monospace;letter-spacing:.14em;text-transform:uppercase;color:#d99b26}
.um-relic-txt b{font:800 15.5px/1.25 'Barlow',sans-serif;color:#f3efe6}
.um-relic-txt span{font:14px/1.4 'Barlow',sans-serif;color:#c7c2b4}
.um-relic-strip{flex:0 0 auto;transform:rotate(4deg);filter:drop-shadow(0 3px 5px rgba(0,0,0,.5))}
.um-strip{display:block}
.um-relic.missing{opacity:.7;border-style:dashed;border-color:#4a3e28}
.um-relic.missing .um-relic-txt small{color:#9d917c}
.um-badge{position:absolute;top:6px;right:6px;z-index:3;display:grid;place-items:center;width:34px;height:34px;padding:2px;border-radius:50%;border:1.5px solid #d99b26;background:#1b1610;box-shadow:0 2px 8px rgba(0,0,0,.5);cursor:pointer}
.um-badge:hover{transform:scale(1.08)}
.um-env{display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px;border:0;background:none;color:#d9d3c4;cursor:pointer;font:600 14px/1.3 'Barlow',sans-serif;text-align:center}
.um-env svg{width:160px;height:auto;filter:drop-shadow(0 6px 16px rgba(0,0,0,.6));animation:umPulse 2.4s ease-in-out infinite}
.um-env.folder svg{animation:none;filter:drop-shadow(0 6px 16px rgba(122,29,44,.55))}
.um-env.small{padding:0;flex-direction:row}.um-env.small svg{width:76px}
.um-board{display:flex;flex-direction:column;gap:12px;margin-top:14px}
.um-board-h{margin:0;font:400 18px/1.2 'Special Elite',monospace;color:#f0b94a;text-align:center}
.um-ledger{display:flex;flex-direction:column;gap:6px}
.um-tags{display:grid;grid-template-columns:repeat(10,1fr);padding-inline:1.457%}
.um-tags span{display:grid;place-items:center;transition:transform .15s}
.um-tags span svg{width:min(30px,90%);height:auto}
.um-tags span.on{transform:translateY(-4px)}
.um-page{position:relative}
.um-page svg{display:block;width:100%;height:auto;border-radius:8px}
.um-piece{transition:transform .18s ease}
.um-board.whole .um-tear{opacity:0;transition:opacity .8s ease .2s}
.um-slots{position:absolute;inset:0 1.457%;display:grid;grid-template-columns:repeat(10,1fr)}
.um-slots button{border:0;background:none;padding:0;cursor:pointer;border-radius:4px}
.um-slots button:focus-visible{outline:2px solid #6fd0ff;outline-offset:-2px}
.um-slots button:disabled{cursor:default}
.um-cryptex{display:flex;align-items:center;justify-content:center;gap:10px;padding:12px;border-radius:14px;background:linear-gradient(180deg,#2c2110,#16110a);border:1px solid #6e5320}
.um-wheel{display:flex;flex-direction:column;align-items:center;gap:4px}
.um-wheel button{width:44px;height:30px;border-radius:8px;border:1px solid #6e5320;background:#1e170c;color:#f0b94a;font-size:14px;cursor:pointer}
.um-wheel button:disabled{opacity:.4;cursor:default}
.um-wheel output{display:flex;flex-direction:column;align-items:center;width:46px;padding:2px 0;border-radius:8px;background:linear-gradient(180deg,#7a5210,#f0c05a 50%,#7a5210);color:#2a1d08;font:800 22px/1.15 'Barlow',sans-serif;font-variant-numeric:tabular-nums;box-shadow:inset 0 0 6px rgba(0,0,0,.5)}
.um-wheel output span{font-size:12px;opacity:.45}
.um-lock{width:40px;margin-left:6px}.um-lock svg{display:block;width:100%}
.um-lock.sprung{animation:umSpring .6s ease}
.um-hint{margin:0;text-align:center;font:13.5px/1.4 'Barlow',sans-serif;color:#a9adbd}
.um-board.whole .um-hint{color:#7fe0b4;font-weight:600}
.um-board.open .um-cryptex{border-color:#f0b94a;box-shadow:0 0 24px rgba(240,185,74,.35)}
.um-done{margin-top:14px;padding:12px 14px;border-radius:12px;border:1px solid #d99b26;background:rgba(217,155,38,.1);display:flex;flex-direction:column;gap:6px}
.um-done b{font:400 20px/1.2 'Special Elite',monospace;color:#f0b94a}
.um-done span{font:14.5px/1.45 'Barlow',sans-serif;color:#ebe6d9}
.um-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.um-acts button{padding:9px 14px;border-radius:10px;border:1px solid #6e5320;background:#1e170c;color:#ebe6d9;font-weight:700;cursor:pointer}
.um-acts button.go{background:#d99b26;border-color:#d99b26;color:#1b1305}
.um-dossier{margin:-22px -20px 0;padding:22px 20px 18px;border-radius:16px 16px 0 0;background:linear-gradient(180deg,#5e1422,#3f0c16);border-bottom:3px solid #d99b26}
.um-dossier h2{margin:0 0 6px;padding-right:34px;font:400 24px/1.15 'Special Elite',monospace;color:#f0b94a}
.um-dos-found{margin:0 0 14px;font:italic 15px/1.45 'Barlow',sans-serif;color:#f1d9d2}
.um-memo{position:relative;margin:0 auto 18px;max-width:620px;padding:18px 20px 14px;background:#efe4c8;color:#2b2620;border-radius:2px;box-shadow:0 10px 26px rgba(0,0,0,.5);transform:rotate(-.6deg);
  background-image:repeating-linear-gradient(transparent 0 23px,rgba(120,90,50,.1) 23px 24px)}
.um-memo small{display:block;margin-bottom:8px;font:400 12px/1.3 'Special Elite',monospace;letter-spacing:.1em;text-transform:uppercase;color:#7a1d2c}
.um-memo p{margin:0 0 8px;font:400 15px/1.5 'Special Elite','Courier New',monospace}
.um-memo .um-memo-sign{margin:4px 0 0;text-align:right;font:italic 20px/1.2 'Brush Script MT','Segoe Script',cursive;color:#1d2752}
.um-memo-stamp{position:absolute;top:10px;right:14px;padding:2px 8px;border:2px solid #b3262b;border-radius:3px;font:400 12px/1.2 'Special Elite',monospace;letter-spacing:.08em;color:#b3262b;transform:rotate(8deg);opacity:.8}
.um-spread{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px 6px;padding:16px 12px 10px;border-radius:10px;background:radial-gradient(ellipse at 50% 40%,#4a1019,#2c0a10);box-shadow:inset 0 0 30px rgba(0,0,0,.6)}
.um-photo{position:relative;margin:0;transform:translateY(var(--dy)) rotate(var(--r));filter:drop-shadow(0 4px 6px rgba(0,0,0,.55))}
.um-bw{filter:grayscale(1) contrast(1.15) brightness(.97)}
.um-bw>*{max-width:none!important;width:100%!important}
.um-x-mark{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.um-clip{position:absolute;top:-8%;left:46%;width:10%;height:auto}
.um-spread-cap{margin:10px 0 0;text-align:center;font:italic 14px/1.4 'Barlow',sans-serif;color:#e9c9c2}
.um-letter.uninvited{width:100%;max-width:620px;margin:6px 0 4px;padding:16px 18px;border-radius:10px;background:linear-gradient(180deg,#1d1b24,#121116);border:1px solid #5a5566;scroll-margin-top:12px;animation:umLetter .5s ease both}
@keyframes umLetter{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}
.um-final{display:flex;flex-direction:column;align-items:center;gap:6px;margin-top:16px}
.um-final>small{font:400 12px/1.3 'Special Elite',monospace;letter-spacing:.12em;text-transform:uppercase;color:#b9bdc8;text-align:center}
.um-final .sh-env-cq.modal{width:min(520px,100%)}
.um-coll{display:flex;flex-direction:column;gap:10px}
.um-coll-sum{margin:0;font:600 15px/1.4 'Barlow',sans-serif;color:#cfc8b6}
.um-coll-env{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:12px;border:1px dashed #5a5566;background:rgba(10,10,14,.6);font:600 14px/1.35 'Barlow',sans-serif}
.um-coll-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
.um-coll-grid>li{margin:0}.um-coll-grid>li>.um-relic,.um-coll-grid>li.um-relic{margin:0;height:100%}
@keyframes umFade{from{opacity:0}to{opacity:1}}
@keyframes umPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04);filter:drop-shadow(0 0 18px rgba(185,189,200,.45))}}
@keyframes umSpring{0%{transform:translateY(0)}40%{transform:translateY(-8px) rotate(-8deg)}100%{transform:translateY(0)}}
@media (max-width:520px){.um-spread{gap:6px 3px;padding:12px 6px 8px}.um-dossier{margin:-18px -14px 0;padding:18px 14px 14px}.um-memo{padding:14px 14px 10px}.um-memo p{font-size:14px}.um-wheel button{width:38px}.um-wheel output{width:40px;font-size:20px}.um-card{padding:18px 14px 16px}.um-coll-grid{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.um-env svg,.um-lock.sprung,.um-letter.uninvited{animation:none}.um-piece,.um-tags span{transition:none}}
`;
