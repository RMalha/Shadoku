/* eslint-disable react/prop-types */
/**
 * umbra.jsx — "The Umbra Conspiracy": the endgame that links the ten standard contracts, the Hard 3-assassin contract and the
 * Expert 5-assassin finale. Every lock is visual and spatial (no typing, no spelling): relics slot into a blueprint, brass dials
 * turn to numerals, and the last seal is a 3×3 floorplan whose one blind spot the player must find. All narrative text is in
 * src/locales/en.json (ui.relic.*, ui.conspiracy.*, ui.sanctum.*, ui.game.solved.umbra.*).
 *
 *   Phase 1  each solved case1-case10 shows its victim's relic (VictimRelicSvg) in the Contract Fulfilled banner, and a brass
 *            relic badge on its envelope in the contracts hub.
 *   Phase 2  with all ten solved, a black obsidian envelope opens the Evidence Board: slot the ten relics, turn the cryptex to
 *            4-1-0-1, and "The Uninvited Guests" (MAH1010QAR3-4101) unlocks (localStorage "shadoku-unlocked-4101").
 *   Phase 3  solving "The Uninvited Guests" reveals Dossier № 000-OMEGA: tap the one dark tile of the 3×3 Sanctum Seal and
 *            "Five Shadows at the Manor" (MAX1111RAR5-4201) unlocks ("shadoku-unlocked-4201"). Its corpse is Master U. M. Bra.
 *
 * The two multi-assassin contracts stay hidden in the hub until unlocked (a contract the player has already fulfilled counts
 * as unlocked). Storage goes through try/catch: a private window simply keeps the locks closed for the session.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useText } from "./i18n.js";
import { VictimRelicSvg, RELIC_IDS } from "./ShadokuArt.jsx";

export const UMBRA_HARD = "MAH1010QAR3-4101";   // "The Uninvited Guests"
export const UMBRA_FINALE = "MAX1111RAR5-4201"; // "Five Shadows at the Manor": Master U. M. Bra is the corpse
export const RELIC_CASES = RELIC_IDS || ["case1", "case2", "case3", "case4", "case5", "case6", "case7", "case8", "case9", "case10"];
export const CRYPTEX_CODE = [4, 1, 0, 1];
const UNLOCK_KEY = { [UMBRA_HARD]: "shadoku-unlocked-4101", [UMBRA_FINALE]: "shadoku-unlocked-4201" };
const UMBRA_EVENT = "shadoku-umbra"; // window event: an unlock happened (the hub and the game re-read the locks)

/* ───────────── state ───────────── */
const readFlag = (k) => { try { return window.localStorage.getItem(k) === "1"; } catch { return false; } };
/** Is `id` playable? Standard contracts always are; the two Umbra contracts once unlocked (or already fulfilled). */
export function isUnlocked(id, solved = new Set()) {
  if (!UNLOCK_KEY[id]) return true;
  return readFlag(UNLOCK_KEY[id]) || solved.has(id);
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
/** "Recovered from the Body": the relic of a solved standard contract (inside the Contract Fulfilled banner, or the hub). */
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

/* ───────────── the two tokens that open phases 2 and 3 ───────────── */
/** The pulsing black obsidian envelope with its cracked silver wax seal. */
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
        <path d="M52 40 L59 47 L55 53 M61 46 L68 42" fill="none" stroke="#3a3d47" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="60" cy="46" r="7.5" fill="none" stroke="#7d8190" strokeWidth=".8" />
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

/* ───────────── Phase 2: the Evidence Board and the 4-wheel brass cryptex ───────────── */
export function EvidenceBoard({ onClose, onLaunch }) {
  const t = useText();
  const [wasOpen] = useState(() => readFlag(UNLOCK_KEY[UMBRA_HARD])); // opened on an earlier visit: shown solved
  const [slotted, setSlotted] = useState(() => new Set(wasOpen ? RELIC_CASES : []));
  const [dials, setDials] = useState(() => (wasOpen ? [...CRYPTEX_CODE] : [0, 0, 0, 0]));
  const all = slotted.size === RELIC_CASES.length;
  const sprung = all && dials.every((d, i) => d === CRYPTEX_CODE[i]);
  const open = wasOpen || sprung;
  useEffect(() => { if (sprung && !wasOpen) unlock(UMBRA_HARD); }, [sprung, wasOpen]);
  const turn = (i, by) => { if (!open) setDials((d) => d.map((v, k) => (k === i ? (v + by + 10) % 10 : v))); };
  const toggle = (id) => { if (!open) setSlotted((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  return (
    <Modal label={t("conspiracy.board.title")} onClose={onClose} wide>
      <div className="um-letter">
        <h2>{t("conspiracy.letter.title")}</h2>
        <p>{t("conspiracy.letter.p1")}</p>
        <p>{t("conspiracy.letter.p2")}</p>
        <p>{t("conspiracy.letter.p3")}</p>
        <p className="um-sign">{t("conspiracy.letter.from")}</p>
      </div>
      <div className={`um-board${open ? " open" : ""}`}>
        <div className="um-relics" role="group" aria-label={t("conspiracy.board.title")}>
          {RELIC_CASES.map((id, n) => (
            <button key={id} type="button" className={`um-slot${slotted.has(id) ? " in" : ""}`} aria-pressed={slotted.has(id)} onClick={() => toggle(id)}
              aria-label={t("conspiracy.relic.slot", { n: n + 1, title: t(`relic.${id}.title`) })} title={t(`relic.${id}.title`)}>
              <VictimRelicSvg caseId={id} size={52} />
            </button>
          ))}
        </div>
        <div className="um-blueprint" aria-hidden="true">
          <svg viewBox="0 0 200 120">
            <rect x="4" y="4" width="192" height="112" rx="4" fill="#132238" stroke="#3d5f8a" strokeWidth="1.5" />
            <path d="M20 20 H120 V60 H180 V100 H20 Z M70 20 V100 M120 60 V100 M20 60 H70" fill="none" stroke="#9cc2ec" strokeWidth="1.2" opacity=".8" />
            <path d="M150 4 L196 4 L196 40 L176 30 L168 44 L150 22 Z" fill="#0d0d12" />
            {RELIC_CASES.map((id, n) => <circle key={id} cx={28 + (n % 5) * 34} cy={n < 5 ? 38 : 82} r="5" fill={slotted.has(id) ? "#f0b94a" : "none"} stroke="#9cc2ec" strokeWidth="1" />)}
          </svg>
        </div>
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
        <p className="um-hint">{t("conspiracy.board.hint")}</p>
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

/* ───────────── Phase 3: Dossier № 000-OMEGA and the 3×3 Sanctum Seal ───────────── */
// W = brass watcher (sees N/S/E/W until a pillar or the edge), P = tall stone pillar (blocks sight), . = open brass tile.
const SEAL = ["WP.", ".WP", "P.W"];
const at = (r, c) => (r < 0 || c < 0 || r > 2 || c > 2 ? null : SEAL[r][c]);
/** The watchers that see open tile (r, c), with the cells of each ray (watcher first). */
function watchersOf(r, c) {
  const out = [];
  [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dr, dc]) => {
    const ray = [[r, c]];
    for (let k = 1; ; k++) {
      const x = at(r + dr * k, c + dc * k);
      if (x === null || x === "P") break;
      ray.push([r + dr * k, c + dc * k]);
      if (x === "W") { out.push(ray.reverse()); break; }
    }
  });
  return out;
}
const DARK = (() => { for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (at(r, c) === "." && !watchersOf(r, c).length) return [r, c]; return null; })(); // (0,2)

export function SanctumFolder({ onClose, onLaunch }) {
  const t = useText();
  const [flash, setFlash] = useState(null); // { rays, n } after a wrong tile
  const [won, setWon] = useState(() => readFlag(UNLOCK_KEY[UMBRA_FINALE]));
  const [sweep, setSweep] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const watchers = useMemo(() => { const w = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (at(r, c) === "W") w.push([r, c]); return w; }, []);
  const allRays = useMemo(() => { const out = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (at(r, c) === ".") out.push(...watchersOf(r, c)); return out; }, []);
  const tap = (r, c) => {
    if (won || at(r, c) !== ".") return;
    if (DARK && r === DARK[0] && c === DARK[1]) {
      setFlash(null); setSweep(true);
      timer.current = setTimeout(() => { setWon(true); unlock(UMBRA_FINALE); }, 1600);
      return;
    }
    setFlash({ rays: watchersOf(r, c), n: Date.now() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(null), 1500);
  };
  const X = (c) => 20 + c * 60 + 30, Y = (r) => 20 + r * 60 + 30;
  const rayPath = (ray) => `M${X(ray[0][1])} ${Y(ray[0][0])} L${X(ray[ray.length - 1][1])} ${Y(ray[ray.length - 1][0])}`;
  return (
    <Modal label={t("sanctum.lore.title")} onClose={onClose} wide>
      <div className="um-letter dossier">
        <h2>{t("sanctum.lore.title")}</h2>
        <p>{t("sanctum.lore.p1")}</p>
        <p>{t("sanctum.lore.p2")}</p>
        <p>{t("sanctum.lore.p3")}</p>
        <h3>{t("sanctum.riddle.title")}</h3>
        <p className="um-riddle">{t("sanctum.riddle.text")}</p>
      </div>
      <div className="um-seal">
        <svg viewBox="0 0 220 220" role="grid" aria-label={t("sanctum.riddle.title")}>
          <defs>
            <radialGradient id="umBrass" cx=".35" cy=".3" r=".8"><stop offset="0" stopColor="#f6d27a" /><stop offset=".6" stopColor="#c98c1f" /><stop offset="1" stopColor="#7a5210" /></radialGradient>
            <linearGradient id="umStone" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9c9aa6" /><stop offset="1" stopColor="#4d4b57" /></linearGradient>
          </defs>
          <circle cx="110" cy="110" r="106" fill="#2a1d0c" stroke="#d99b26" strokeWidth="3" />
          <circle cx="110" cy="110" r="99" fill="none" stroke="#7a5210" strokeWidth="1" strokeDasharray="3 4" />
          {SEAL.map((row, r) => row.split("").map((k, c) => {
            const dark = won && DARK && r === DARK[0] && c === DARK[1];
            return (
              <g key={`${r}${c}`} role="gridcell" aria-label={t("sanctum.tile.aria", { r: r + 1, c: c + 1 })} tabIndex={k === "." && !won ? 0 : -1}
                onClick={() => tap(r, c)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(r, c); } }}
                className={`um-tile${k === "." ? " open" : ""}${dark ? " dark" : ""}`}>
                <rect x={20 + c * 60 + 2} y={20 + r * 60 + 2} width="56" height="56" rx="6" fill={k === "." ? "url(#umBrass)" : "#3b2a12"} stroke="#1c1306" strokeWidth="1.5" />
                {k === "P" && <g><rect x={20 + c * 60 + 18} y={20 + r * 60 + 8} width="24" height="44" rx="3" fill="url(#umStone)" stroke="#2b2a31" /><rect x={20 + c * 60 + 14} y={20 + r * 60 + 6} width="32" height="6" rx="2" fill="#b4b2bd" /><rect x={20 + c * 60 + 14} y={20 + r * 60 + 48} width="32" height="6" rx="2" fill="#6e6c78" /></g>}
                {k === "W" && <g><circle cx={X(c)} cy={Y(r)} r="17" fill="url(#umBrass)" stroke="#3a2a0c" strokeWidth="2" /><ellipse cx={X(c)} cy={Y(r)} rx="10" ry="6" fill="#fff8e6" /><circle cx={X(c)} cy={Y(r)} r="4" fill="#1a1206" /></g>}
                {dark && <rect x={20 + c * 60 + 2} y={20 + r * 60 + 2} width="56" height="56" rx="6" fill="#050407" opacity=".88" />}
              </g>
            );
          }))}
          {flash && flash.rays.map((ray, i) => <path key={`${flash.n}-${i}`} d={rayPath(ray)} className="um-ray" />)}
          {(sweep || won) && allRays.map((ray, i) => <path key={`s${i}`} d={rayPath(ray)} className="um-ray sweep" style={{ animationDelay: `${(i % 4) * 120}ms` }} />)}
          {(sweep || won) && watchers.map(([r, c]) => <circle key={`w${r}${c}`} cx={X(c)} cy={Y(r)} r="20" className="um-glow" />)}
        </svg>
        {flash && <p className="um-wrong" role="alert">{t("sanctum.wrongTile")}</p>}
      </div>
      {won && (
        <div className="um-done" role="status">
          <b>{t("sanctum.solved.title")}</b>
          <span>{t("sanctum.solved.text")}</span>
          <div className="um-acts">
            {onLaunch && <button type="button" className="go" onClick={() => onLaunch(UMBRA_FINALE)}>{t("sanctum.launch")}</button>}
            <button type="button" onClick={onClose}>{t("conspiracy.later")}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

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
.um-riddle{font-style:normal!important;color:#f3efe6!important}
.um-relic{display:flex;align-items:center;gap:12px;margin-top:10px;padding:10px 12px;border-radius:12px;background:linear-gradient(135deg,#221c12,#141218);border:1px solid #6e5320}
.um-relic.compact{margin-top:8px;padding:8px 10px}
.um-relic-pic{flex:0 0 auto;display:grid;place-items:center;border-radius:10px;background:radial-gradient(circle,#2f2618,#121016);padding:4px}
.um-relic-txt{display:flex;flex-direction:column;gap:2px;min-width:0}
.um-relic-txt small{font:400 11px/1.2 'Special Elite',monospace;letter-spacing:.14em;text-transform:uppercase;color:#d99b26}
.um-relic-txt b{font:800 15.5px/1.25 'Barlow',sans-serif;color:#f3efe6}
.um-relic-txt span{font:14px/1.4 'Barlow',sans-serif;color:#c7c2b4}
.um-badge{position:absolute;top:6px;right:6px;z-index:3;display:grid;place-items:center;width:34px;height:34px;padding:2px;border-radius:50%;border:1.5px solid #d99b26;background:#1b1610;box-shadow:0 2px 8px rgba(0,0,0,.5);cursor:pointer}
.um-badge:hover{transform:scale(1.08)}
.um-env{display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px;border:0;background:none;color:#d9d3c4;cursor:pointer;font:600 14px/1.3 'Barlow',sans-serif;text-align:center}
.um-env svg{width:160px;height:auto;filter:drop-shadow(0 6px 16px rgba(0,0,0,.6));animation:umPulse 2.4s ease-in-out infinite}
.um-env.folder svg{animation:none;filter:drop-shadow(0 6px 16px rgba(122,29,44,.55))}
.um-env.small{padding:0;flex-direction:row}.um-env.small svg{width:76px}
.um-board{display:grid;grid-template-columns:1fr;gap:12px;margin-top:14px}
.um-relics{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.um-slot{position:relative;display:grid;place-items:center;aspect-ratio:1;padding:4px;border-radius:12px;border:1.5px dashed #5a4a2a;background:#120f15;cursor:pointer;opacity:.75;transition:transform .15s,opacity .15s,border-color .15s}
.um-slot svg{width:100%;height:auto;max-width:56px}
.um-slot.in{opacity:1;border-style:solid;border-color:#f0b94a;background:radial-gradient(circle,#3a2c12,#16120c);transform:translateY(-2px)}
.um-slot.in .relic-frag{filter:drop-shadow(0 0 3px #ffd36b) drop-shadow(0 0 6px #ffb42e)}
.um-blueprint svg{display:block;width:100%;height:auto;border-radius:8px}
.um-cryptex{display:flex;align-items:center;justify-content:center;gap:10px;padding:12px;border-radius:14px;background:linear-gradient(180deg,#2c2110,#16110a);border:1px solid #6e5320}
.um-wheel{display:flex;flex-direction:column;align-items:center;gap:4px}
.um-wheel button{width:44px;height:30px;border-radius:8px;border:1px solid #6e5320;background:#1e170c;color:#f0b94a;font-size:14px;cursor:pointer}
.um-wheel button:disabled{opacity:.4;cursor:default}
.um-wheel output{display:flex;flex-direction:column;align-items:center;width:46px;padding:2px 0;border-radius:8px;background:linear-gradient(180deg,#7a5210,#f0c05a 50%,#7a5210);color:#2a1d08;font:800 22px/1.15 'Barlow',sans-serif;font-variant-numeric:tabular-nums;box-shadow:inset 0 0 6px rgba(0,0,0,.5)}
.um-wheel output span{font-size:12px;opacity:.45}
.um-lock{width:40px;margin-left:6px}.um-lock svg{display:block;width:100%}
.um-lock.sprung{animation:umSpring .6s ease}
.um-hint{margin:0;text-align:center;font:13.5px/1.4 'Barlow',sans-serif;color:#a9adbd}
.um-board.open .um-cryptex{border-color:#f0b94a;box-shadow:0 0 24px rgba(240,185,74,.35)}
.um-done{margin-top:14px;padding:12px 14px;border-radius:12px;border:1px solid #d99b26;background:rgba(217,155,38,.1);display:flex;flex-direction:column;gap:6px}
.um-done b{font:400 20px/1.2 'Special Elite',monospace;color:#f0b94a}
.um-done span{font:14.5px/1.45 'Barlow',sans-serif;color:#ebe6d9}
.um-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.um-acts button{padding:9px 14px;border-radius:10px;border:1px solid #6e5320;background:#1e170c;color:#ebe6d9;font-weight:700;cursor:pointer}
.um-acts button.go{background:#d99b26;border-color:#d99b26;color:#1b1305}
.um-seal{display:flex;flex-direction:column;align-items:center;margin-top:12px}
.um-seal svg{width:min(320px,100%);height:auto}
.um-tile.open{cursor:pointer}.um-tile.open:hover rect:first-child{filter:brightness(1.12)}
.um-tile:focus-visible{outline:none}.um-tile:focus-visible rect:first-child{stroke:#6fd0ff;stroke-width:3}
.um-ray{stroke:#ffd36b;stroke-width:9;stroke-linecap:round;opacity:0;fill:none;filter:drop-shadow(0 0 6px #ffb42e);animation:umRay 1.4s ease forwards;pointer-events:none}
.um-ray.sweep{animation:umSweep 1.6s ease forwards}
.um-glow{fill:none;stroke:#ffd36b;stroke-width:3;opacity:.0;animation:umGlow 1.6s ease forwards;pointer-events:none}
.um-wrong{margin:8px 0 0;font:600 14px/1.4 'Barlow',sans-serif;color:#ffb4a8;text-align:center}
@keyframes umFade{from{opacity:0}to{opacity:1}}
@keyframes umPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04);filter:drop-shadow(0 0 18px rgba(185,189,200,.45))}}
@keyframes umSpring{0%{transform:translateY(0)}40%{transform:translateY(-8px) rotate(-8deg)}100%{transform:translateY(0)}}
@keyframes umRay{0%{opacity:0}20%{opacity:.95}70%{opacity:.85}100%{opacity:0}}
@keyframes umSweep{0%{opacity:0;stroke-dasharray:0 200}60%{opacity:.9;stroke-dasharray:200 0}100%{opacity:.55;stroke-dasharray:200 0}}
@keyframes umGlow{0%{opacity:0}50%{opacity:.9}100%{opacity:.5}}
@media (max-width:520px){.um-relics{grid-template-columns:repeat(5,1fr);gap:5px}.um-wheel button{width:38px}.um-wheel output{width:40px;font-size:20px}.um-card{padding:18px 14px 16px}}
@media (prefers-reduced-motion:reduce){.um-env svg,.um-lock.sprung,.um-ray,.um-ray.sweep,.um-glow{animation:none}.um-ray{opacity:.9}.um-glow{opacity:.6}}
`;
