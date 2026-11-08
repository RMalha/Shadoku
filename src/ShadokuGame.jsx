/**
 * ShadokuGame.jsx  --  SHADOKU play screen (viewport-locked: the floorplan is always on screen)
 * ------------------------------------------------------------------------------------------
 * (Formerly ShadokuApp.jsx. ShadokuApp.jsx is now the shadoku.net router: "/" → ShadokuHome, "/play" → this.)
 * Art comes from ./ShadokuArt.jsx, contracts from the individual ./puzzles/shadoku_*.json files (synced from engine/puzzles) (tutorial + case1…case10). Nothing here draws a sprite;
 * the only artwork in this file is the SHADOKU logo (<ShadokuLogo />, art/shadoku-logo.png).
 *
 *   import ShadokuGame from "./ShadokuGame";
 *   <ShadokuGame />                                         // the built-in pack: shadoku_tutorial.json + shadoku_case1…10.json
 *   <ShadokuGame puzzles={json} logoSrc="/img/logo.svg" />  // any engine export · optional logo file override
 *   <ShadokuGame lab={Lab} />                               // ShadokuLab.jsx passes its test bench in here
 *   <ShadokuGame forcePuzzleId="case1" lockCaseMenu onGameEvent={fn} insetY={44} />  // tutorial mode (see props below)
 *
 * Layout. The root is locked to 100dvh (minus `insetY`) and never scrolls.
 *   > 960px  · 3 zones: dossier (logo, case menu, timer, house rules, suspect grid) | board stage | tool rail
 *   <= 960px · 4 rows: compact header | pinned board (max 46dvh) | scrolling dossier | bottom action dock
 *
 * Controls (the Murdoku paradigm): tap a suspect card to pick them. Tap a tile = pencil note, tap it again = rub it out.
 * Press and HOLD a tile (a ring fills up) = place the suspect; a placed suspect only comes off with the Eraser. Drag = paint notes (one Undo step).
 * Tools: 💡 Light Switch · 🧹 Eraser (hold = clear the board) · 📋 Inspect (the props and what they do; hover info on/off) · ↩️ Undo · 🔎 Hint.
 * "Lights On" is always on: placed suspects light their orthogonal sightlines (walls, VOID and tall props
 * stop the ray) and the Light Switch lifts the shadow on a tile by hand. There is no fog toggle.
 */
import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { useText, TextContext, tEn } from "./i18n.js";
import { boldNodes } from "./rich.jsx";
import { BOARDS_KEY, TIMES_KEY, BESTS_KEY, PROGRESS_EVENT, markProgress, stampBoard } from "./sync.js";
import { localizeHead, localizeCase, trOf } from "./caseText.js";
import { RelicCard, ObsidianEnvelope, OmegaFolder, EvidenceBoard, FinalDossier, acceptFinale, allRelics, isRelicCase, isUnlocked, UMBRA_HARD, UMBRA_FINALE } from "./umbra.jsx";
import {
  AdowPolaroid, AdowToken, ASSASSINS, AssassinPolaroid, AssassinToken, BIOME_META, BRASS, CELL, CREAM, CRIMSON, DIRS, FOG, FOG_OPACITY, FloorDefs, INK, LAB, LABEL,
  FACING, MasterPolaroid, PropChip, PropSprite, SUSPECT_COLORS, SuspectPolaroid, TokenAvatar, WallLayer, WindowPane,
  assignFloors, classBlocksSight, classIsSolid, propClassOf, floorOf, getCastForPuzzle, lookFacts, themeOf, windowAt, victimIsDummy, victimNameOf, victimGenderOf, inkOn,
} from "./ShadokuArt";
// One JSON file per puzzle (no merged shadoku_puzzles.json). Play order: the tutorial, then Very Easy → Expert.
// ./puzzles is synced from engine/puzzles by vite.config.js; never edit it by hand.
import LOGO_IMG from "./logoImg.js";
import tutorial from "./puzzles/shadoku_tutorial.json";
import case1 from "./puzzles/shadoku_case1.json";
import case2 from "./puzzles/shadoku_case2.json";
import case3 from "./puzzles/shadoku_case3.json";
import case4 from "./puzzles/shadoku_case4.json";
import case5 from "./puzzles/shadoku_case5.json";
import case6 from "./puzzles/shadoku_case6.json";
import case7 from "./puzzles/shadoku_case7.json";
import case8 from "./puzzles/shadoku_case8.json";
import case9 from "./puzzles/shadoku_case9.json";
import case10 from "./puzzles/shadoku_case10.json";
import uninvited from "./puzzles/shadoku_MAH1010QAR3-4101.json"; // the two multi-assassin contracts (The Umbra Conspiracy unlocks them); kept last
import manor from "./puzzles/shadoku_MAX1111RAR5-4201.json";
const DEFAULT_PUZZLES = [tutorial, case1, case2, case3, case4, case5, case6, case7, case8, case9, case10, uninvited, manor];

export const BZ = 8; // slim outer bezel around the floorplan
const HOLD_SHOW_MS = 240; // the placing ring only appears once a press lasts this long
const HOLD_MS = 1000; // press-and-hold: places a suspect on a tile, and (on the Eraser) clears the whole board. The player is never told a number. // Eraser: hold this long to clear the whole board (and to place a suspect by pressing and holding)
const ZOOMS = [1, 1.5, 2, 2.5, 3]; // the + / − steps; a pinch or Ctrl + wheel zooms freely between the first and the last
const ZOOM_MAX = ZOOMS[ZOOMS.length - 1];
const clampZoom = (z) => (z < 1.04 ? 1 : Math.min(ZOOM_MAX, z));
/* Phones and tablets upright: header | board | dossier | dock. A phone held sideways (short and wide) keeps the desktop's
   side-by-side columns in a compact form instead (the "short landscape" block of the CSS). Keep in step with that CSS. */
const MOBILE_MQ = "(max-width: 960px) and (orientation: portrait), (max-width: 960px) and (min-height: 521px)";
const SHORT_MQ = "(orientation: landscape) and (max-height: 520px)"; // a phone held sideways: that compact block of the CSS
const HOVER_MQ = "(any-hover: hover)"; // a mouse or trackpad is there: the hover-only settings (keyword tooltips, room highlight) make sense
const TOUCH_MQ = "(hover: none), (pointer: coarse)"; // touch-first devices: tapping a selected card/tool again drops to the neutral "inspect" state
const TIP_MS = 2500; // a tap-opened Prop Inspector tooltip dismisses itself after this long
const DBL_RIGHT_MS = 400; // ⚙ right-click "Light, double: X": a second right-click on the same tile within this long is a double
/** Prop Inspector copy: the in-code English fallback. The site wrapper's t() reads ui.propInspector.<cls>Tag / <cls>Rule from
 *  src/locales/<lang>.json (then en.json, then its own in-code English), and prop.<KIND> for the names. */
export const INSPECTOR_EN = {
  tallTag: "Tall Prop", perchTag: "Perch Prop", shortTag: "Short Prop", lowTag: "Low Prop",
  blocks: "Blocks view", passes: "Doesn't block view", canOccupy: "Can be occupied", cannotOccupy: "Cannot be occupied",
  title: "Props on this floorplan", hover: "Show prop info when hovering or tapping", empty: "No props on this floorplan.", close: "Close",
};
/** What each class does: [blocks the view, can be occupied]. The corpse casts no sightline and nobody stands on it. */
const CLASS_RULES = { tall: [true, false], perch: [true, true], short: [false, false], low: [false, true], corpse: [false, false] };
/* ---- Settings (⚙ in the game header). Saved in localStorage; the defaults keep the classic look and rules. ---- */
const SETTINGS_KEY = "shadoku-settings";
export const DEFAULT_SETTINGS = {
  kw: true, kwCore: true, kwObjects: true, kwRooms: true, kwPeople: true, kwLines: true, // clue hover: tooltips and board highlights
  kwSelected: false, // the selected suspect's own clue keeps its board highlights lit (no hovering)
  selHi: true, coords: false, autoScale: true, roomHover: false,
  roomLabel: 14, objSize: 0, walls: 1, // px (10-20) · -0.15..+0.15 · 0.6..1.6
  timer: true, portrait: true, autoLight: true, preventLight: false, gender: false,
  tokenStyle: "portrait", plain: false,
  rightClick: "light", // a mouse right-click on a tile: "light" | "cross" (X) | "menu" (pick Light or X) | "double" (Light; a double right-click: X)
  lightTint: "warm", myTint: "warm", // light colours (LIGHT_TINTS): the scapegoats' sightlines · the tiles lit with the Light Switch
  symbols: false, // the Note Symbols palette under the scapegoats (NOTE_SYMBOLS)
  symbolSet: "otqx", // …and which of its symbols are offered: their ids (NOTE_SYMBOLS keys), all of them by default
};
/** ⚙ Note Symbols: pencil marks that stand for nobody. A tap notes one in a tile beside the scapegoats' letters (in `notes`), a hold marks the
 *  tile with it in big (`syms`); neither ever counts toward the solution. The ids are lowercase so they never clash with the letters. */
export const NOTE_SYMBOLS = { o: { shape: "circle", color: "#2ad4c4" }, t: { shape: "triangle", color: "#b48cff" }, q: { shape: "square", color: "#ffb02e" }, x: { shape: "star", color: "#f4efe2" } };
const SYM_IDS = Object.keys(NOTE_SYMBOLS);
const isSym = (id) => !!NOTE_SYMBOLS[id];
/** The note symbols the player chose in ⚙ (settings.symbolSet), in palette order. */
const chosenSyms = (s) => SYM_IDS.filter((id) => String(s.symbolSet == null ? SYM_IDS.join("") : s.symbolSet).includes(id));
/** A tile's notes for a screen reader: the letters, then the note symbols by name ("A B Circle", "Star (mark)"). */
const tileNoteText = (s, k, t) => {
  const n = s.syms[k] ? "" : s.notes[k] || "", nm = (ch) => t(`game.sym.${NOTE_SYMBOLS[ch].shape}`); // notes are hidden under a held symbol
  return [...[...n].filter((ch) => !isSym(ch)), ...[...n].filter(isSym).map(nm), ...(s.syms[k] ? [t("game.symMark", { name: nm(s.syms[k]) })] : [])].join(" ");
};
/** A note symbol centred on (cx, cy), `r` its outer radius. */
const SymShape = ({ id, cx, cy, r, ...rest }) => {
  const shape = (NOTE_SYMBOLS[id] || NOTE_SYMBOLS.o).shape, f = (n) => n.toFixed(2);
  if (shape === "circle") return <circle cx={cx} cy={cy} r={r * 0.86} {...rest} />;
  if (shape === "square") return <rect x={cx - r * 0.76} y={cy - r * 0.76} width={r * 1.52} height={r * 1.52} rx={r * 0.12} {...rest} />;
  if (shape === "triangle") return <path d={`M${f(cx)} ${f(cy - r)}L${f(cx + r * 0.98)} ${f(cy + r * 0.72)}H${f(cx - r * 0.98)}Z`} strokeLinejoin="round" {...rest} />;
  const pts = Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? r * 0.45 : r; return `${f(cx + q * Math.cos(a))} ${f(cy + q * Math.sin(a) + r * 0.08)}`; });
  return <path d={`M${pts.join("L")}Z`} strokeLinejoin="round" {...rest} />;
};
/** Light colours: `wash` at `op` over a lit tile, `bulb` for the Light Switch bulbs and swatches, `hue` turns the 💡 emoji (a yellow bulb).
 *  "warm" is the classic faint glow; the others are stronger so the colour reads. */
export const LIGHT_TINTS = {
  warm: { wash: "#ffd9a0", op: 0.1, bulb: "#ffd27a", hue: 0 },
  red: { wash: "#ff4d4d", op: 0.26, bulb: "#ff6b6b", hue: -45 },
  orange: { wash: "#ff9a2e", op: 0.26, bulb: "#ffa64d", hue: -20 },
  pink: { wash: "#ff6fc0", op: 0.26, bulb: "#ff8fd0", hue: -80 },
  green: { wash: "#3ddc84", op: 0.24, bulb: "#5ee89a", hue: 100 },
  blue: { wash: "#4da3ff", op: 0.26, bulb: "#7cbcff", hue: 165 },
};
const TINT_IDS = Object.keys(LIGHT_TINTS);
const tintOf = (id) => LIGHT_TINTS[id] || LIGHT_TINTS.warm;
const bulbFilter = (id) => { const k = tintOf(id); return k.hue ? `hue-rotate(${k.hue}deg) saturate(1.6) drop-shadow(0 0 5px ${k.bulb})` : undefined; };
const TINT_HOLD_MS = 400; // touch: hold the Light button this long for the colour strip
const loadSettings = () => {
  try { const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); return { ...DEFAULT_SETTINGS, ...(v && typeof v === "object" ? v : {}) }; } catch (e) { return { ...DEFAULT_SETTINGS }; }
};
/** Board drawing options (the Board's `opts`); the showcase boards on the home page use these defaults. */
const BOARD_OPTS = { coords: false, roomHover: false, roomLabel: 14, objSize: 0, walls: 1, autoLight: true, tokenStyle: "portrait", selHi: true, lightTint: "warm", myTint: "warm" };
const COORD_BAND = 20; // board units: the R1..Rn / C1..Cn band added left of and above the floorplan
/** The core clue words with a tooltip: concept → English trigger words (a locale overrides them with ui.kw.<concept>.words, its definition is ui.kw.<concept>). */
const KW_WORDS = {
  beside: "beside|next to|adjacent", diagonal: "diagonally|diagonal", alone: "alone", same: "same", only: "only", exactly: "exactly", atLeast: "at least",
  north: "north|above", south: "south|under|below", east: "east|to the right of", west: "west|to the left of",
  row: "row|rows", column: "column|columns", corner: "corner", see: "see|saw",
};
/* The lemon of an opening between two areas: its posts and its outlined dotted line. */
const OPENING = "#f6e27a";
/* The shadow's rim (beside the fog), cast by the light and by the walls: [id, gradient x1 y1 x2 y2 (dark edge -> clear), neighbour dr dc]. RIM_W px deep. */
const SHADE_RIM = [["T", 0, 0, 0, 1, -1, 0], ["B", 0, 1, 0, 0, 1, 0], ["L", 0, 0, 1, 0, 0, -1], ["R", 1, 0, 0, 0, 0, 1]];
const RIM_W = 16;
const BIG_BOARD = 9; // desktop: from this many rows or columns the board takes the full height and the suspects' column narrows; smaller boards split the width evenly
const SPLIT_KEY = "shadoku-split"; // desktop: the stage column's width in px, set by dragging the divider (absent = automatic)
const SPLIT_KEY_SHORT = "shadoku-split-short"; // the same on a phone held sideways (its own width: the screens differ)
const RAIL_W = 116, SPLIT_MIN = 300, DOSSIER_MIN = 340; // px: the tool rail, the narrowest stage, the narrowest suspects area
const SPLIT_MIN_SHORT = 160, DOSSIER_MIN_SHORT = 200; // px: the same, a phone held sideways
const HOVER_KEY = "shadoku-hover-tips"; // "0" = the hover / tap prop badge is switched off in the Inspect panel (on by default)
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/* ---------------------------------------------------------------------- */
/*  The SHADOKU logo: art/shadoku-logo.png as a data URI (./logoImg.js)     */
/* ---------------------------------------------------------------------- */
/* width/height are only the size it paints at before its CSS applies (3:1 like the art): kept small so a late stylesheet never shows a huge logo. */
/** The logo image. Pass `src` to use another file instead; if that file fails to load, the built-in logo comes back. */
export const ShadokuLogo = React.memo(function ShadokuLogo({ src, className = "", title = "SHADOKU" }) {
  const [broken, setBroken] = useState(false);
  return <img className={`sk-logo ${className}`} src={src && !broken ? src : LOGO_IMG} alt={title} width={150} height={50} draggable={false} onError={() => setBroken(true)} />;
});

/* ---- Puzzle data: steps may be full objects or compact tuples [n, tier, ruleKey, text, focus] ---- */
/* Short rule codes of the old compact steps → the generated rule-title keys in the locale (RULE_*). The English is only the last-resort fallback;
   the shipped cases carry steps[].i18n.ruleKey and need none of this. */
const RULE = {
  D: "Sightline domino", B: "The blindspot", C: "Compass squeeze", P: "Polaroid check", PL: "Polaroid partner logic",
  SR: "Shared room", SP: "Separate rooms", M: "Monopoly mask", L: "Pair lookahead (common watched tiles)",
  O: "One man / one woman per room", SA: "Shared area", SS: "Separate areas", NE: "No empty area", AL: "Alone in an area",
};
const RULE_KEY = {
  D: "RULE_SINGLE", B: "RULE_BLINDSPOT", C: "RULE_COMPASS", P: "RULE_TRAIT_FILTER", PL: "RULE_TRAIT_PARTNER", SR: "RULE_SAME_ROOM", SP: "RULE_DIFF_ROOM",
  M: "RULE_MONOPOLY", L: "RULE_PAIR_WATCH", O: "RULE_GENDER_ROOMS", SA: "RULE_SAME_ROOM", SS: "RULE_DIFF_ROOM", NE: "RULE_EVERY_ROOM", AL: "RULE_ALONE",
};
const normStep = (s) => {
  const code = Array.isArray(s) ? s[2] : s.rule;
  const ruleKey = !Array.isArray(s) && s.i18n && s.i18n.ruleKey ? undefined : RULE_KEY[code]; // legacy code: shown through the locale (see ruleOf)
  return Array.isArray(s) ? { n: s[0], tier: s[1], rule: RULE[code] || code, ruleKey, text: s[3], focus: s[4] } : { ...s, rule: RULE[code] || code, ruleKey };
};
export const normalizePuzzle = (p) => ({ ...p, steps: (p.steps || []).map(normStep) });
export const normalizePuzzles = (list) => (Array.isArray(list) ? list : []).map(normalizePuzzle);
export const PUZZLES = normalizePuzzles(DEFAULT_PUZZLES);
/* The daily contracts, oldest first: engine/puzzles_daily (the released ones; `npm run dev` adds the coming week's
   engine/daily_queue). Read as raw text so src/bundle.py can inline them; the release job rotates them out after two weeks. */
const DAILY_RAW = import.meta.glob("./puzzles/shadoku_daily-*.json", { query: "?raw", import: "default", eager: true });
const parseCase = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
export const DAILIES = normalizePuzzles(Object.values(DAILY_RAW).map(parseCase).filter((d) => d && d.daily).sort((a, b) => (a.daily < b.daily ? -1 : 1)));

const HINT_RUNGS = 3; // where to look → the key deduction → the placement
// Note cards (V10.6, Murdoku's first hints): a hint whose groundwork has NOTES_MIN lines or more opens with up to NOTES_MAX cards of
// deductions for the player's notes, before the rungs name the scapegoat. Opened cards are saved as hintLog["n:<letter>"] = how many.
const NOTES_MIN = 3, NOTES_MAX = 6, NOTE_LOG = (h) => `n:${h.suspect}`;
const STORE_KEY = BOARDS_KEY, CASE_KEY = "shadoku-case", TIME_KEY = TIMES_KEY, BEST_KEY = BESTS_KEY; // the synced ones: sync.js
const key = (r, c) => r * 100 + c;
const DRAW_RANK = { LOW: 0, SHORT: 1, PERCH: 2, TALL: 2 }; // board draw passes: flush, waist-high, upright (CORPSE / unknown: 0)
const cn = (cell) => `r${cell[0] + 1}c${cell[1] + 1}`;
const sameCell = (a, r, c) => !!a && a[0] === r && a[1] === c;
const dims = (q) => `${q.rooms.length}×${q.rooms[0].length}`;
const edgeKey = (a, b) => { const ka = key(a[0], a[1]), kb = key(b[0], b[1]); return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`; };

/* ---- Geometry: mirror of shadoku_board.Board (VOID, N×M, the four V10 prop classes, multi-tile spans) ----
 * Classes come from the case's own "propClasses" (propClassOf), falling back to ShadokuArt's PROP_CLASS table.
 * Sight (Board._cast): orthogonal rays stop at the border, VOID, a wall (doors pass), and a TALL or PERCH prop.
 * A PERCH tile is occupiable, so it is SEEN (whoever sits at it or rides it is in plain view) and the ray stops there;
 * a TALL prop is not seen, it only stops the ray (`blockers` keeps it for the light ripple). SHORT, LOW and the
 * Corpse are transparent. Nobody stands on TALL, SHORT, the Corpse or VOID (Board.is_occupiable). */
export function buildGeometry(p) {
  const R = p.rooms.length, C = p.rooms[0].length;
  const doors = new Set((p.doors || []).map(([a, b]) => edgeKey(a, b)));
  const room = (r, c) => p.rooms[r][c], kind = (r, c) => p.contents[r][c];
  const inside = (r, c) => r >= 0 && c >= 0 && r < R && c < C;
  const isVoid = (r, c) => inside(r, c) && (room(r, c) < 0 || kind(r, c) === "VOID");
  const isDoor = (a, b) => doors.has(edgeKey(a, b));
  const isWall = (a, b) => room(a[0], a[1]) !== room(b[0], b[1]) && !isDoor(a, b);
  const clsMemo = new Map();
  const classOfKind = (k) => { if (!clsMemo.has(k)) clsMemo.set(k, propClassOf(p, k)); return clsMemo.get(k); };
  const cls = (r, c) => classOfKind(kind(r, c));
  const isTall = (r, c) => cls(r, c) === "TALL";
  const blocksSight = (r, c) => classBlocksSight(cls(r, c));
  const occupiable = (r, c) => inside(r, c) && !isVoid(r, c) && !classIsSolid(cls(r, c)) && kind(r, c) !== "CORPSE";
  const info = {}, vis = {}, occCells = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const set = new Set();
    vis[key(r, c)] = set;
    if (isVoid(r, c)) { info[key(r, c)] = DIRS.map(() => ({ cells: [], block: null })); continue; }
    if (occupiable(r, c)) occCells.push([r, c]);
    info[key(r, c)] = DIRS.map(([dr, dc]) => {
      const cells = []; let block = null, r0 = r, c0 = c;
      for (;;) {
        const r1 = r0 + dr, c1 = c0 + dc;
        if (!inside(r1, c1) || isVoid(r1, c1) || isWall([r0, c0], [r1, c1])) break;
        if (blocksSight(r1, c1)) {
          if (occupiable(r1, c1)) { cells.push([r1, c1]); set.add(key(r1, c1)); } // PERCH: the rider is seen, then the ray stops
          else block = [r1, c1, cells.length + 1]; // TALL: the prop that stopped the ray is lit too
          break;
        }
        cells.push([r1, c1]); set.add(key(r1, c1)); r0 = r1; c0 = c1;
      }
      return { cells, block };
    });
  }
  const labelAt = {};
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (room(r, c) >= 0 && !(room(r, c) in labelAt)) labelAt[room(r, c)] = [r, c];
  // multi-tile objects: one span per object, from the case's "multiTile" list. Older files without the list fall back
  // to grouping neighbouring RUG tiles into rectangles and BED tiles into pairs (the frozen tutorial).
  const spans = [];
  const addSpan = (k, cells) => {
    const rs = cells.map(([r]) => r), cs = cells.map(([, c]) => c);
    const r0 = Math.min(...rs), c0 = Math.min(...cs), ch = Math.max(...rs) - r0 + 1, cw = Math.max(...cs) - c0 + 1;
    spans.push({ kind: k, r: r0, c: c0, cw, ch, cells: cells.map(([r, c]) => [r, c]), horizontal: cw > ch, len: Math.max(cw, ch) });
  };
  if (Array.isArray(p.multiTile)) {
    p.multiTile.forEach((m) => { if (m && m.kind && Array.isArray(m.cells) && m.cells.length) addSpan(m.kind, m.cells.filter((x) => inside(x[0], x[1]))); });
  } else {
    const done = new Set();
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      if (kind(r, c) !== "BED" || done.has(key(r, c))) continue;
      let mate = null;
      if (c + 1 < C && kind(r, c + 1) === "BED" && room(r, c + 1) === room(r, c)) mate = [r, c + 1];
      else if (r + 1 < R && kind(r + 1, c) === "BED" && room(r + 1, c) === room(r, c)) mate = [r + 1, c];
      done.add(key(r, c)); if (mate) done.add(key(mate[0], mate[1]));
      addSpan("BED", mate ? [[r, c], mate] : [[r, c]]);
    }
    const rugAt = (r, c, r0, c0) => r < R && c < C && kind(r, c) === "RUG" && room(r, c) === room(r0, c0) && !done.has(key(r, c));
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      if (!rugAt(r, c, r, c)) continue;
      let w = 1, h = 1;
      while (rugAt(r, c + w, r, c)) w++;
      grow: for (;;) { for (let i = 0; i < w; i++) if (!rugAt(r + h, c + i, r, c)) break grow; h++; }
      const cells = [];
      for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) { done.add(key(r + i, c + j)); cells.push([r + i, c + j]); }
      addSpan("RUG", cells);
    }
  }
  const spanAt = new Map();
  spans.forEach((g) => g.cells.forEach(([r, c]) => spanAt.set(key(r, c), g)));
  return {
    R, C, room, kind, cls, classOfKind, inside, isVoid, isDoor, isWall, isTall, blocksSight, occupiable, occCells, labelAt, spans,
    spanAt: (r, c) => spanAt.get(key(r, c)) || null,
    // legacy views of the spans
    beds: spans.filter((g) => g.kind === "BED").map((g) => ({ r: g.r, c: g.c, horizontal: g.horizontal, len: g.len })),
    rugs: spans.filter((g) => g.kind === "RUG").map((g) => ({ r: g.r, c: g.c, w: g.cw, h: g.ch })),
    rays: (r, c) => info[key(r, c)].map((d) => d.cells),
    blockers: (r, c) => info[key(r, c)].map((d) => d.block).filter(Boolean),
    visible: (r, c) => vis[key(r, c)],
  };
}

function loadAll() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; } catch (e) { return {}; } }
function saveAll(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } }
/** Save one case into what is stored now: another tab's progress on the other cases is kept, not overwritten by this tab's older copy. */
function saveCase(id, v) { const all = loadAll(); saveAll({ ...(isObj(all) ? all : {}), [id]: v }); stampBoard(id); }
/** Ids of the puzzles the player has fulfilled (read from the saved boards) — the contracts page shows a green check on them. */
export function readSolvedIds(puzzles) { return Object.keys(readBestTimes(puzzles)); }
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const validCell = (a) => Array.isArray(a) && a.length === 2 && Number.isInteger(a[0]) && Number.isInteger(a[1]);
const normMemo = new WeakMap();
/** Any saved board becomes a well-formed { tokens, notes, lights, crosses, hints, hintLog, done } — old saves (pencil / marks) migrate, damaged ones are repaired instead of freezing the board.
 *  `hintLog` = { [hint id]: highest rung revealed (1–3) }; `hints` is the count of the old one-rung hints, kept for the stats. */
export const normCase = (c) => {
  if (!isObj(c)) return { tokens: {}, notes: {}, lights: {}, crosses: {}, syms: {}, hints: 0, hintLog: {}, done: false };
  if (normMemo.has(c)) return normMemo.get(c);
  const notesSrc = isObj(c.notes) ? c.notes : Object.fromEntries(Object.entries(isObj(c.pencil) ? c.pencil : {}).map(([k, v]) => [k, String(v).toUpperCase()]));
  const tokens = {}, notes = {}, lights = {}, crosses = {}, syms = {};
  if (isObj(c.tokens)) Object.entries(c.tokens).forEach(([id, v]) => { if (validCell(v)) tokens[id] = v; });
  Object.entries(notesSrc).forEach(([k, v]) => { const t = [...String(v == null ? "" : v)].map((ch) => (isSym(ch) ? ch : ch.toUpperCase())).filter((ch) => isSym(ch) || /[A-Z]/.test(ch)).join(""); if (/^\d+$/.test(k) && t) notes[k] = t; }); // letters, and the note symbols (lowercase)
  const lightSrc = isObj(c.lights) ? c.lights : isObj(c.marks) ? c.marks : {};
  Object.entries(lightSrc).forEach(([k, v]) => { if (/^\d+$/.test(k) && v) lights[k] = 1; });
  if (isObj(c.crosses)) Object.entries(c.crosses).forEach(([k, v]) => { if (/^\d+$/.test(k) && v) crosses[k] = 1; });
  if (isObj(c.syms)) Object.entries(c.syms).forEach(([k, v]) => { if (/^\d+$/.test(k) && isSym(v)) syms[k] = v; });
  const hintLog = {};
  if (isObj(c.hintLog)) Object.entries(c.hintLog).forEach(([k, v]) => { if (Number.isInteger(v) && v >= 1) hintLog[k] = Math.min(k.startsWith("n:") ? NOTES_MAX : HINT_RUNGS, v); });
  const out = { tokens, notes, lights, crosses, syms, hints: Number.isFinite(c.hints) ? c.hints : 0, hintLog, done: !!c.done };
  normMemo.set(c, out);
  return out;
};
/** Everyone who hides in the dark: S. H. Adow, then the case's extra assassins (O. B. Scuro …). They cast no light. */
const hidersOf = (p) => ["S", ...(p.assassins || []).map((a) => a.id)];
const hiderCell = (p, id) => (id === "S" ? p.shadow : ((p.assassins || []).find((a) => a.id === id) || {}).solution);
/** Puzzle-aware repair: drop tokens of suspects this case does not have, tokens off the floorplan, and notes / lights on cells that do not exist. */
const cleanCase = (p, geo, cs) => {
  const ids = new Set([...p.suspects.map((q) => q.id), ...hidersOf(p)]);
  const okCell = (k) => { const r = Math.floor(Number(k) / 100), c = Number(k) % 100; return geo.inside(r, c) && !geo.isVoid(r, c); };
  const badTok = Object.entries(cs.tokens).some(([id, v]) => !ids.has(id) || !geo.inside(v[0], v[1]) || geo.isVoid(v[0], v[1]));
  const badNote = Object.keys(cs.notes).some((k) => !okCell(k) || [...cs.notes[k]].some((ch) => !ids.has(ch) && !isSym(ch)));
  const badLight = Object.keys(cs.lights).some((k) => !okCell(k)) || Object.keys(cs.crosses).some((k) => !okCell(k)) || Object.keys(cs.syms).some((k) => !okCell(k));
  if (!badTok && !badNote && !badLight) return cs;
  const tokens = {}, notes = {}, lights = {}, crosses = {}, syms = {};
  Object.entries(cs.tokens).forEach(([id, v]) => { if (ids.has(id) && geo.inside(v[0], v[1]) && !geo.isVoid(v[0], v[1])) tokens[id] = v; });
  Object.entries(cs.notes).forEach(([k, v]) => { const t = [...v].filter((ch) => ids.has(ch) || isSym(ch)).join(""); if (okCell(k) && t) notes[k] = t; });
  Object.keys(cs.lights).forEach((k) => { if (okCell(k)) lights[k] = cs.lights[k]; });
  Object.keys(cs.crosses).forEach((k) => { if (okCell(k)) crosses[k] = cs.crosses[k]; });
  Object.keys(cs.syms).forEach((k) => { if (okCell(k)) syms[k] = cs.syms[k]; });
  return { ...cs, tokens, notes, lights, crosses, syms };
};
/** Solved = Submit was pressed on a board where every suspect, S. H. Adow and every extra assassin stand on their tiles. */
const isSolved = (q, cs0) => {
  const cs = normCase(cs0);
  return !!cs.done && !!q.shadow && hidersOf(q).every((id) => { const at = hiderCell(q, id); return !!at && sameCell(cs.tokens[id], ...at); })
    && q.suspects.every((s) => sameCell(cs.tokens[s.id], ...s.solution));
};
/**
 * The hint for the board as it is now (V10.5). Each hint has HINT_RUNGS rungs: where to look → the key deduction → the placement.
 *  - A mistake comes first: a token on a wrong tile, an X on someone's tile, a light on a hiding tile → { mistake: "token"|"cross"|"light", id?, cell }.
 *  - Otherwise the engine's hints (p.hints) whose suspect is not yet on its tile and whose `needs` all stand on theirs; a hint the player has
 *    already opened wins (it does not jump away when another suspect is placed), else the first in the engine's order.
 *  - null when everyone stands right (or the case has no hints). `hid` keys the hint in the saved hintLog.
 */
export function boardHint(p, cs) {
  const tiles = [...(p.suspects || []).map((q) => [q.id, q.solution]), ...hidersOf(p).map((id) => [id, hiderCell(p, id)])].filter(([, at]) => !!at);
  for (const [id, at] of tiles) {
    const t = cs.tokens[id];
    if (t && !sameCell(t, ...at)) return { mistake: "token", id, cell: t, hid: `!${id}@${t[0]},${t[1]}` };
  }
  const hiders = new Set(hidersOf(p));
  for (const [id, at] of tiles) {
    const k = key(at[0], at[1]);
    if (cs.crosses[k] && !tokenIdAt(cs, ...at)) return { mistake: "cross", cell: at, hid: `!x@${at[0]},${at[1]}` };
    if (hiders.has(id) && cs.lights[k]) return { mistake: "light", cell: at, hid: `!l@${at[0]},${at[1]}` };
  }
  const right = new Set(tiles.filter(([id, at]) => sameCell(cs.tokens[id], ...at)).map(([id]) => id));
  const done = (h) => (h.suspect === "S" ? hidersOf(p).every((id) => right.has(id)) : right.has(h.suspect));
  const open = (p.hints || []).filter((h) => !done(h) && h.needs.every((n) => right.has(n)));
  if (!open.length) return null;
  const log = cs.hintLog || {}, hid = (h) => `h:${h.suspect}`;
  const started = open.filter((h) => log[hid(h)]).sort((a, b) => log[hid(b)] - log[hid(a)])[0];
  const h = started || open[0];
  if (!h.chain) return { ...h, hid: hid(h) };
  // The player may have placed more scapegoats than this hint needed: its lines that only narrow those down say nothing about the board any more.
  const keep = h.chain.map((_, i) => i).filter((i) => { const who = Object.keys(h.chain[i].elims || {}); return !who.length || who.some((w) => !right.has(w)); });
  return { ...h, chain: keep.map((i) => h.chain[i]), key: (h.key || []).filter((k) => keep.includes(k)).map((k) => keep.indexOf(k)), hid: hid(h) };
}
/**
 * The note cards of a placement hint (V10.6): its groundwork (the chain lines that are not key lines) in order, a run of lines with one
 * rule about the same scapegoats as one card, the smallest neighbours merged down to NOTES_MAX. [] for a mistake, the hiders' hint
 * or a short groundwork. Each card: { lines: [[chain index, step]], rule, tier, focus }.
 */
export function hintNotes(h) {
  if (!h || h.mistake || h.suspect === "S" || !h.chain) return [];
  const keys = new Set(h.key || []), out = [];
  h.chain.forEach((s, i) => {
    if (keys.has(i)) return;
    const who = Object.keys(s.elims || {}).sort().join(""), rk = s.i18n && s.i18n.ruleKey, last = out[out.length - 1];
    if (last && last.rk === rk && last.who === who) last.lines.push([i, s]);
    else out.push({ rk, who, lines: [[i, s]] });
  });
  if (out.reduce((n, g) => n + g.lines.length, 0) < NOTES_MIN) return [];
  while (out.length > NOTES_MAX) {
    let j = 0;
    for (let k = 1; k < out.length - 1; k++) if (out[k].lines.length + out[k + 1].lines.length < out[j].lines.length + out[j + 1].lines.length) j = k;
    out.splice(j, 2, { ...out[j], lines: [...out[j].lines, ...out[j + 1].lines] });
  }
  return out.map((g) => {
    const top = g.lines.reduce((a, b) => ((b[1].tier || 1) > (a[1].tier || 1) ? b : a))[1];
    const focus = new Map();
    g.lines.forEach(([, s]) => (s.focus || []).forEach((c) => focus.set(`${c[0]},${c[1]}`, c)));
    return { lines: g.lines, rule: top.rule, tier: top.tier || 1, focus: [...focus.values()] };
  });
}
const snap = (cs) => ({ tokens: cs.tokens, notes: cs.notes, lights: cs.lights, crosses: cs.crosses, syms: cs.syms || {} });
/** A crossed-out tile keeps its notes, hidden until the X comes off (a light switch leaves them showing); so does a tile with a note symbol held on it. */
const notesHidden = (cs, k) => !!cs.crosses[k] || !!(cs.syms || {})[k];
const tokenIdAt = (cs, r, c) => Object.keys(cs.tokens).find((t) => sameCell(cs.tokens[t], r, c));
const withNote = (cs, k, id, mode) => {
  const s = cs.notes[k] || "", has = s.includes(id), want = mode === "add" ? true : mode === "remove" ? false : !has;
  if (want === has) return cs;
  const notes = { ...cs.notes }, n = want ? s + id : s.replace(id, "");
  if (n) notes[k] = n; else delete notes[k];
  return { ...cs, notes };
};
const withLight = (cs, k, on) => {
  if (!!cs.lights[k] === on) return cs;
  const lights = { ...cs.lights }; if (on) lights[k] = 1; else delete lights[k];
  return { ...cs, lights };
};
const withCross = (cs, k, on) => {
  if (!!cs.crosses[k] === on) return cs;
  const crosses = { ...cs.crosses }; if (on) crosses[k] = 1; else delete crosses[k];
  return { ...cs, crosses };
};
const withToken = (cs, id, r, c) => { // moves `id` here, bumping whoever stood on the tile
  const tokens = {};
  Object.entries(cs.tokens).forEach(([t, at]) => { if (t !== id && !sameCell(at, r, c)) tokens[t] = at; });
  tokens[id] = [r, c];
  const sy = cs.syms || {}, k = key(r, c); // a symbol held on this tile gives way to the scapegoat
  if (!sy[k]) return { ...cs, tokens };
  const syms = { ...sy }; delete syms[k];
  return { ...cs, tokens, syms };
};
/** A scapegoat just placed watches its sightlines, so nobody can stand there: the scapegoat letters noted on those tiles go, and so do
 *  the Light Switch marks and the X marks when `lights` (the auto light now shows those tiles, so an X there says nothing new).
 *  Note symbols stay: they are the player's own marks. */
const withSightCleared = (cs, geo, r, c, lights) => {
  let notes = cs.notes, lit = cs.lights, xs = cs.crosses;
  geo.rays(r, c).flat().forEach(([rr, cc]) => {
    const k = key(rr, cc), n = notes[k];
    if (n) {
      const t = [...n].filter(isSym).join("");
      if (t !== n) { if (notes === cs.notes) notes = { ...notes }; if (t) notes[k] = t; else delete notes[k]; }
    }
    if (lights && lit[k]) { if (lit === cs.lights) lit = { ...lit }; delete lit[k]; }
    if (lights && xs[k]) { if (xs === cs.crosses) xs = { ...xs }; delete xs[k]; }
  });
  return notes === cs.notes && lit === cs.lights && xs === cs.crosses ? cs : { ...cs, notes, lights: lit, crosses: xs };
};
/** Hold-to-mark with a note symbol: the tile shows it in big (the same symbol again takes it off). Never part of the solution. */
const withSym = (cs, k, id) => { const syms = { ...(cs.syms || {}) }; if (syms[k] === id) delete syms[k]; else syms[k] = id; return { ...cs, syms }; };
const withoutToken = (cs, id) => { if (!cs.tokens[id]) return cs; const tokens = { ...cs.tokens }; delete tokens[id]; return { ...cs, tokens }; };
const erased = (cs, r, c) => {
  const k = key(r, c), tid = tokenIdAt(cs, r, c);
  const sy = cs.syms || {};
  if (!tid && !cs.notes[k] && !cs.lights[k] && !cs.crosses[k] && !sy[k]) return cs;
  const tokens = { ...cs.tokens }, notes = { ...cs.notes }, lights = { ...cs.lights }, crosses = { ...cs.crosses }, syms = { ...sy };
  if (tid) delete tokens[tid]; delete notes[k]; delete lights[k]; delete crosses[k]; delete syms[k];
  return { ...cs, tokens, notes, lights, crosses, syms };
};
const cleared = (cs) => (Object.keys(cs.tokens).length || Object.keys(cs.notes).length || Object.keys(cs.lights).length || Object.keys(cs.crosses).length || Object.keys(cs.syms || {}).length
  ? { ...cs, tokens: {}, notes: {}, lights: {}, crosses: {}, syms: {} } : cs);
const lineCells = ([r0, c0], [r1, c1]) => { // every tile a fast drag skipped over
  const out = [], n = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0));
  for (let i = 1; i <= n; i++) out.push([Math.round(r0 + ((r1 - r0) * i) / n), Math.round(c0 + ((c1 - c0) * i) / n)]);
  return out;
};

/* ---- Case timer storage (seconds per case id) ---- */
function readTimes() { try { return JSON.parse(localStorage.getItem(TIME_KEY) || "{}") || {}; } catch (e) { return {}; } }
const readTime = (id) => Math.max(0, Math.floor(+readTimes()[id] || 0));
function writeTime(id, s) { try { const t = readTimes(); t[id] = s; localStorage.setItem(TIME_KEY, JSON.stringify(t)); } catch (e) { /* ignore */ } }
/* ---- Best times: { [contract id]: seconds }. A contract is FULFILLED once it has an entry here (so wiping a solved board does not un-solve it). ---- */
function readBests() { try { return JSON.parse(localStorage.getItem(BEST_KEY) || "{}") || {}; } catch (e) { return {}; } }
function recordBest(id, s) { try { const b = readBests(), t = Math.max(1, Math.floor(s) || 1); if (!(b[id] > 0) || t < b[id]) b[id] = t; localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch (e) { /* ignore */ } markProgress(true); }
/** Hint rungs revealed on a saved board: { look, key, place, note } (each rung counts once per hint; the old one-rung hints count as placements;
 *  `note`: note cards opened). */
export function hintCounts(cs) {
  const log = Object.entries(cs.hintLog || {}), rungs = log.filter(([k]) => !k.startsWith("n:")).map(([, v]) => v);
  const n = (r) => rungs.filter((v) => v >= r).length;
  return { look: n(1), key: n(2), place: n(3) + Math.max(0, +cs.hints || 0), note: log.filter(([k]) => k.startsWith("n:")).reduce((a, [, v]) => a + v, 0) };
}
/**
 * The profile's numbers, per contract: { [id]: { played, solved, best, hints } } (`played`: the player marked the board, took a hint or solved it,
 * `best`: best seconds when fulfilled, `hints`: the hint rungs taken on the saved board, { look, key, place }). Read from this browser's storage.
 */
export function readPlayStats(puzzles) {
  const all = loadAll(), bests = readBestTimes(puzzles), out = {};
  (puzzles || []).forEach((q) => {
    const cs = normCase(all[q.id]);
    const seeded = q.id === "tutorial" || !!q.dummies; // the initiation opens with the Master's pencil notes already on the board
    const marks = Object.keys(cs.tokens).length + Object.keys(cs.lights).length + Object.keys(cs.crosses).length + (seeded ? 0 : Object.keys(cs.notes).length);
    const hints = hintCounts(cs);
    const solved = bests[q.id] > 0;
    // played = the player did something (a mark, a hint, a solve): merely opening a contract, or its clock running, is not playing it
    out[q.id] = { played: solved || marks > 0 || hints.look + hints.place + hints.note > 0, solved, best: solved ? bests[q.id] : 0, hints };
  });
  return out;
}
/** → { [id]: best seconds } for every contract the player has fulfilled (saved solved boards without a record count too, with their last time). */
export function readBestTimes(puzzles) {
  const b = readBests(), all = loadAll(), out = {};
  (puzzles || []).forEach((q) => { if (b[q.id] > 0) out[q.id] = b[q.id]; else if (isSolved(q, all[q.id])) out[q.id] = readTime(q.id) || 1; });
  return out;
}
const DAILY_KEEP = 14; // days of archive before today's contract (engine DAILY_KEEP: the release job deletes older ones)
const isLocalHost = () => { try { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname); } catch { return false; } };
const DAILY_LEAD_MS = 2 * 36e5; // a contract ships at 22:00 the evening before its date (tools/release_daily.py RELEASE_HOUR)
/** The newest contract day out now (localhost only: on the site the deploy is the clock): tomorrow's from 22:00 on. */
const isoToday = () => { const d = new Date(Date.now() + DAILY_LEAD_MS), p2 = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const dayNo = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return Date.UTC(y, m - 1, d) / 864e5; };

/** -> { today, archive (newest first), queue } of the daily contracts (the Daily Contract page, the home envelope). On the site the deploy is the clock: the newest shipped daily is today's. On localhost
 *  (npm run dev also mirrors engine/daily_queue) the ones dated after today wait in the queue, for testing. */
export function dailyShelves(list = DAILIES, local = isLocalHost(), now = isoToday()) {
  const shipped = local ? list.filter((q) => q.daily <= now) : list;
  const today = shipped[shipped.length - 1] || null;
  const archive = today ? shipped.filter((q) => q !== today && dayNo(today.daily) - dayNo(q.daily) <= DAILY_KEEP).reverse() : [];
  return { today, archive, queue: local ? list.filter((q) => q.daily > now) : [] };
}

/** Difficulty of a daily contract by weekday, Monday first (engine DAILY_PLAN): rebuilds the ones rotated out of DAILIES. */
const DAILY_PLAN = ["Very Easy", "Easy", "Easy", "Medium", "Medium", "Hard", "Expert"];
/**
 * Every daily contract the stats count, oldest first: the shipped ones (DAILIES) and the rotated-out ones this player still has a best
 * time or a board for (storage outlives the two-week archive), rebuilt from their id ("daily-2026-11-03") as { id, daily, difficulty }.
 */
export function dailyRecords() {
  const now = isoToday(), shipped = isLocalHost() ? DAILIES.filter((q) => q.daily <= now) : DAILIES; // npm run dev: the queue is not played yet
  const have = new Set(DAILIES.map((q) => q.id));
  const gone = [...new Set([...Object.keys(readBests()), ...Object.keys(loadAll())])].filter((id) => /^daily-\d{4}-\d{2}-\d{2}$/.test(id) && !have.has(id)).map((id) => {
    const daily = id.slice(6), [y, m, d] = daily.split("-").map(Number);
    return { id, daily, title: id, titleKey: "ui.daily.title", difficulty: DAILY_PLAN[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7] };
  });
  return [...gone, ...shipped].sort((a, b) => (a.daily < b.daily ? -1 : 1));
}
export const fmtTime = (sec) => {
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};

/* ---- Small hooks ---- */
export function useMediaQuery(q) {
  const read = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(q).matches;
  const [match, setMatch] = useState(read);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(q), on = () => setMatch(mq.matches);
    on();
    if (mq.addEventListener) mq.addEventListener("change", on); else mq.addListener(on);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", on); else mq.removeListener(on); };
  }, [q]);
  return match;
}
function useElementSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setSize((s) => (s.w === el.offsetWidth && s.h === el.offsetHeight ? s : { w: el.offsetWidth, h: el.offsetHeight }));
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/* ---- Alibi typesetting: names, places, props, negations and logic words stand out ---- */
/* The word lists are the locale's (ui.emph.logic / ui.emph.negations, "|"-separated); these are the in-code English for a locale-less build. */
const LOGIC_WORDS = "beside|next to|adjacent|same|different|alone|together|only|exactly|at least|at most|north|south|east|west|row|rows|column|columns|above|below|corner|edge|between|diagonal|diagonally|every|each|man|men|woman|women";
const NEGATIONS = "not|never|no|nobody|neither|nor|none|without|nowhere|wasn't|weren't|didn't|isn't";
/** The bare surface of each theme (engine/shadoku_i18n.py SURFACE_EN; a locale words them with SURFACE.<ID>). */
const SURFACE_EN = { FLOOR: "bare floor", PAVEMENT: "bare pavement", SAND: "bare sand", GROUND: "bare ground" };
const wordList = (text) => String(text || "").split("|").map((w) => w.trim()).filter(Boolean);
const upper = (str) => { let lang; try { lang = document.documentElement.lang || undefined; } catch (e) { /* SSR */ } try { return String(str).toLocaleUpperCase(lang); } catch (e) { return String(str).toUpperCase(); } };
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Returns `emph(text)` → an array of strings and styled spans for one case. */
function buildEmphasis(p, colorOf, t = tEn) {
  const kinds = new Map();
  const add = (term, v) => {
    const t = String(term || "").trim().toLowerCase();
    if (t.length < 2) return;
    const old = kinds.get(t);
    if (!old) kinds.set(t, v);
    else if (old.k === "pr" && v.k === "pr" && !old.kind.split(",").includes(v.kind)) kinds.set(t, { k: "pr", kind: `${old.kind},${v.kind}` }); // one word, two props ("pine tree": PINE and SNOW_PINE): hovering lights both
  };
  const tx = (k, fb) => { const v = t(k); return typeof v === "string" && v && v !== k ? v : fb; };
  p.suspects.forEach((q) => add(q.name, { k: "nm", id: q.id }));
  hidersOf(p).forEach((id) => add(t(`assassin.${id}`), { k: "nm", id }));
  (p.assassins || []).forEach((a) => add(a.name, { k: "nm", id: a.id })); // the English name too, for a locale without ui.assassin.<letter>
  (p.roomLabels || p.roomNames || []).forEach((n, i) => add(n, { k: "rm", i }));
  // "bare pavement": bold, its "(no bench, puddle …)" list moves into a hover tooltip (kept inline with `full`)
  const surfaces = Object.entries(SURFACE_EN).map(([id, en]) => tx(`SURFACE.${id}`, en));
  surfaces.forEach((n) => add(n, { k: "bare" }));
  Object.keys(LABEL).forEach((k) => add(t(`prop.${k}`), { k: "pr", kind: k }));
  Object.keys(LABEL).forEach((k) => { const n = t(`PROP.${k}.noun`); if (n && n !== `PROP.${k}.noun`) add(n, { k: "pr", kind: k }); }); // the clues' own noun ("hot pool", "trail of footprints", "lamppost")
  // "row 5" / "column 3", worded like the locale's own clues (FRAG_LINES_ONE.*: "row {line|n1}")
  [["row", "FRAG_LINES_ONE.ROW", "row {line}", p.rooms.length], ["col", "FRAG_LINES_ONE.COL", "column {line}", p.rooms[0].length]].forEach(([axis, k, fb, n]) => {
    const tpl = tx(k, fb);
    if (/\{[^}]*\}/.test(tpl)) for (let i = 1; i <= n; i++) add(tpl.replace(/\{[^}]*\}/, String(i)), { k: "ln", axis, n: i });
  });
  const neg = t("emph.negations"), kw = t("emph.logic");
  wordList(neg === "emph.negations" ? NEGATIONS : neg).forEach((n) => add(n, { k: "neg" }));
  Object.entries(KW_WORDS).forEach(([c, en]) => wordList(tx(`kw.${c}.words`, en)).forEach((n) => add(n, { k: "kw", c })));
  wordList(kw === "emph.logic" ? LOGIC_WORDS : kw).forEach((n) => add(n, { k: "kw" }));
  const terms = [...kinds.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(^|[^\\w'])(${terms.map((t) => escRe(t) + (kinds.get(t).k === "pr" ? "(?:e?s)?" : "")).join("|")})(?![\\w'])`, "gi");
  const kindOf = (m) => {
    const l = m.toLowerCase();
    return kinds.get(l) || kinds.get(l.replace(/es$/, "")) || kinds.get(l.replace(/s$/, ""));
  };
  // a surface, then (a few words on, as in Japanese) its parenthesised list of low props: "bare sand (no camel, … or woven mat)"
  const bareRe = new RegExp(`(${surfaces.map(escRe).join("|")})([^()（）.。;:!?]{0,24}?)\\s*([(（][^()（）]*[)）])`, "gi");
  /** → [text without the lists, Map(index of the surface in that text → its list)] */
  const stripLists = (s) => {
    const tips = new Map();
    let kept = "", from = 0, m;
    bareRe.lastIndex = 0;
    while ((m = bareRe.exec(s))) {
      kept += s.slice(from, m.index);
      tips.set(kept.length, m[3]);
      kept += m[1] + m[2];
      from = m.index + m[0].length;
    }
    return [kept + s.slice(from), tips];
  };
  return (text, full = false) => {
    const out = [], [src, tips] = full ? [String(text || ""), new Map()] : stripLists(String(text || ""));
    let last = 0, m, i = 0;
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      const start = m.index + m[1].length, word = m[2], v = kindOf(word);
      if (!v) continue;
      if (start > last) out.push(src.slice(last, start));
      const k = `e${i++}`;
      // data-hi / data-kw: what hovering the word shows (board highlight / keyword tooltip, see the clue-hover settings)
      if (v.k === "nm") out.push(<b key={k} className="sk-nm" style={{ "--nc": colorOf(v.id) }} data-hi={`nm:${v.id}`}>{word}</b>);
      else if (v.k === "neg") out.push(<strong key={k} className="sk-neg">{word}</strong>);
      else if (v.k === "kw") out.push(<b key={k} className="sk-kw" data-kw={v.c}>{word}</b>);
      else if (v.k === "ln") out.push(<b key={k} className="sk-kw" data-hi={`${v.axis}:${v.n}`}>{word}</b>);
      else if (v.k === "bare") out.push(tips.has(start) ? <b key={k} className="sk-kw sk-bare" data-tip={tips.get(start)}>{word}</b> : <b key={k} className="sk-kw">{word}</b>);
      else out.push(<em key={k} className={v.k === "rm" ? "sk-rm" : "sk-pr"} data-hi={v.k === "rm" ? `rm:${v.i}` : `pr:${v.kind}`}>{word}</em>);
      last = start + word.length;
    }
    if (last < src.length) out.push(src.slice(last));
    return out;
  };
}

/** A placed suspect drawn as a lettered disc ("Placed Suspect Style: Letter"). */
const LetterToken = ({ cx, cy, id, fill, ink, ring, dashed = false }) => (
  <g>
    <circle cx={cx} cy={cy} r="21.5" fill={fill} stroke={ring} strokeWidth="2.4" strokeDasharray={dashed ? "4 3" : undefined} />
    <text x={cx} y={cy + 8.2} textAnchor="middle" fill={ink} style={{ fontFamily: "'Barlow', system-ui, sans-serif", fontWeight: 800, fontSize: 24 }}>{id}</text>
  </g>
);

/* ---------------------------------------------------------------------- */
/*  Board — always "Lights On"                                             */
/* ---------------------------------------------------------------------- */
function Board({ p, geo, st, looks, colorOf, active, tool = "suspect", focus, solved, flash, hover, onStroke, onHover, onKey, onCell, hold, coachCells, describe, uid = "main", opts = null, hiCells = null }) {
  const svg = useRef(null);
  const t = useText();
  const o = { ...BOARD_OPTS, ...(opts || {}) }, LB = o.coords ? COORD_BAND : 0;
  const R = geo.R, C = geo.C, X = (c) => LAB + c * CELL, Y = (r) => LAB + r * CELL;
  const W = C * CELL + 2 * BZ, H = R * CELL + 2 * BZ;
  const s = normCase(st);
  const tokens = s.tokens; // S. H. Adow is placed by the player, never automatically
  const tokenAt = new Map(Object.entries(tokens).map(([id, [r, c]]) => [key(r, c), id]));
  const placed = p.suspects.filter((q) => tokens[q.id]).map((q) => ({ id: q.id, cell: tokens[q.id] }));
  const litMap = new Map(), setMin = (k, d) => { if (!litMap.has(k) || litMap.get(k) > d) litMap.set(k, d); };
  const seen = new Set(); // every tile a placed suspect sees (S. H. Adow there is a mistake, lit or not)
  const shine = (r, c) => {
    setMin(key(r, c), 0);
    geo.rays(r, c).forEach((ray) => ray.forEach(([rr, cc], i) => setMin(key(rr, cc), i + 1)));
    geo.blockers(r, c).forEach(([rr, cc, d]) => setMin(key(rr, cc), d));
  };
  placed.forEach(({ cell: [r, c] }) => {
    geo.rays(r, c).forEach((ray) => ray.forEach(([rr, cc]) => seen.add(key(rr, cc))));
    if (o.autoLight) shine(r, c); // "Auto Light on Place" off: only the Light Switch lifts the shadow
  });
  // a note symbol held on a tile lights its row and column like a scapegoat, but it is only a mark: it never counts as someone seeing (no conflicts, no mistake for S. H. Adow)
  if (o.autoLight) Object.keys(s.syms).forEach((k) => { if (!tokenAt.has(+k) && !s.crosses[k]) shine(Math.floor(+k / 100), +k % 100); });
  const conflicts = new Set();
  placed.forEach((a) => placed.forEach((b) => { if (a.id !== b.id && geo.visible(...a.cell).has(key(...b.cell))) { conflicts.add(a.id); conflicts.add(b.id); } }));
  const hiders = hidersOf(p);
  if (!solved) hiders.forEach((id) => { if (tokens[id] && seen.has(key(...tokens[id]))) conflicts.add(id); }); // an assassin standing in the light

  const cells = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) cells.push([r, c]);
  const real = cells.filter(([r, c]) => !geo.isVoid(r, c));
  const props = useMemo(() => {
    const out = [];
    geo.spans.forEach((g) => out.push({ ...g }));
    real.forEach(([r, c]) => {
      const k = geo.kind(r, c);
      if (!k || k === "VOID" || geo.spanAt(r, c)) return;
      out.push({ kind: k, r, c, cw: 1, ch: 1, cells: [[r, c]] });
    });
    const shut = (r, c, dc) => !geo.inside(r, c + dc) || geo.isVoid(r, c + dc) || geo.isWall([r, c], [r, c + dc]);
    // the room's edge on that side (a door in it still counts: furniture stands against the wall either side of a door)
    const edge = (r, c, dc) => !geo.inside(r, c + dc) || geo.isVoid(r, c + dc) || geo.room(r, c) !== geo.room(r, c + dc);
    out.forEach((it) => {
      it.rank = DRAW_RANK[geo.classOfKind(it.kind)] || 0; it.bottom = it.r + it.ch - 1;
      it.flip = FACING.has(it.kind) && it.cw === 1 && it.ch === 1 && shut(it.r, it.c, 1) && !shut(it.r, it.c, -1); // face away from a wall on the east
      // a sofa down a column has its back on the west: mirror it when the room's wall runs along its east side instead, so it faces into the room
      if (it.kind === "SOFA" && it.ch > it.cw) it.flip = it.cells.every(([r, c]) => edge(r, c, 1)) && !it.cells.every(([r, c]) => edge(r, c, -1));
    });
    return out.sort((a, b) => a.rank - b.rank || a.bottom - b.bottom || a.c - b.c);
  }, [geo]); // eslint-disable-line react-hooks/exhaustive-deps
  const floors = useMemo(() => assignFloors(p, geo), [p, geo]);
  const theme = themeOf(p), beach = theme === "BEACH";

  // Beach: VOID tiles are open water, shaded by distance from the shore, with foam on the shoreline
  const water = beach ? cells.filter(([r, c]) => geo.isVoid(r, c)) : [];
  const depth = new Map(), shore = [];
  if (water.length) {
    const wk = new Set(water.map(([r, c]) => key(r, c)));
    let front = water.filter(([r, c]) => DIRS.some(([dr, dc]) => geo.inside(r + dr, c + dc) && !geo.isVoid(r + dr, c + dc)));
    front.forEach(([r, c]) => depth.set(key(r, c), 1));
    while (front.length) {
      const next = [];
      front.forEach(([r, c]) => DIRS.forEach(([dr, dc]) => { const k2 = key(r + dr, c + dc); if (wk.has(k2) && !depth.has(k2)) { depth.set(k2, depth.get(key(r, c)) + 1); next.push([r + dr, c + dc]); } }));
      front = next;
    }
    water.forEach(([r, c]) => DIRS.forEach(([dr, dc], d) => { if (geo.inside(r + dr, c + dc) && !geo.isVoid(r + dr, c + dc)) shore.push([r, c, d]); }));
  }
  const edge = (x, y, d) => [[[x, y], [x + CELL, y]], [[x, y + CELL], [x + CELL, y + CELL]], [[x, y], [x, y + CELL]], [[x + CELL, y], [x + CELL, y + CELL]]][d];
  const wavy = (a, b, nx, ny, off, amp) => {
    const pt = (t, o) => [a[0] + (b[0] - a[0]) * t + nx * o, a[1] + (b[1] - a[1]) * t + ny * o], f = (q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
    let d = `M${f(pt(0, off))}Q${f(pt(1 / 12, off + amp))} ${f(pt(1 / 6, off))}`;
    for (let i = 2; i <= 6; i++) d += `T${f(pt(i / 6, off))}`;
    return d;
  };

  // walls: an opening is simply a missing wall segment with squared lemon posts and a lemon dotted line (ink outline) across the gap
  const segs = [], sills = [], postAt = new Map();
  const addPost = (px, py) => { const k = `${px},${py}`; if (!postAt.has(k)) postAt.set(k, { x: px, y: py, k }); };
  real.forEach(([r, c]) => DIRS.forEach(([dr, dc], d) => {
    const r1 = r + dr, c1 = c + dc, e = edge(X(c), Y(r), d).flat();
    if (!geo.inside(r1, c1) || geo.isVoid(r1, c1)) {
      if (!(beach && geo.inside(r1, c1))) segs.push({ k: `e${r}-${c}-${d}`, x1: e[0], y1: e[1], x2: e[2], y2: e[3], thick: true });
      return;
    }
    if (d === 0 || d === 2 || geo.room(r1, c1) === geo.room(r, c)) return;
    if (geo.isDoor([r, c], [r1, c1])) {
      addPost(e[0], e[1]); addPost(e[2], e[3]);
      const hz = e[1] === e[3];
      sills.push({ k: `s${r}-${c}-${d}`, x1: e[0] + (hz ? 4 : 0), y1: e[1] + (hz ? 0 : 4), x2: e[2] - (hz ? 4 : 0), y2: e[3] - (hz ? 0 : 4) });
    } else segs.push({ k: `w${r}-${c}-${d}`, x1: e[0], y1: e[1], x2: e[2], y2: e[3], thick: false });
  }));

  // "Highlight room on hover": the room under the mouse gets blue walls (doorways dashed) and a bigger label
  const hovRoom = o.roomHover && hover && geo.inside(hover[0], hover[1]) && !geo.isVoid(hover[0], hover[1]) ? geo.room(hover[0], hover[1]) : null;
  const roomEdges = hovRoom == null ? [] : real.filter(([r, c]) => geo.room(r, c) === hovRoom).flatMap(([r, c]) => DIRS.map(([dr, dc], d) => {
    const r1 = r + dr, c1 = c + dc, open = geo.inside(r1, c1) && !geo.isVoid(r1, c1);
    if (open && geo.room(r1, c1) === hovRoom) return null;
    const e = edge(X(c), Y(r), d).flat();
    return { k: `re${r}-${c}-${d}`, door: open && geo.isDoor([r, c], [r1, c1]), x1: e[0], y1: e[1], x2: e[2], y2: e[3] };
  }).filter(Boolean));
  const focusSet = new Set((focus?.focus || []).map(([r, c]) => key(r, c)));
  const showHover = hover && tool === "suspect" && active && !hiders.includes(active) && !isSym(active) && geo.occupiable(hover[0], hover[1]) && !tokenAt.has(key(...hover));
  const order = [...p.suspects.map((q) => q.id), ...hiders, ...SYM_IDS];
  const cellAt = (e) => {
    // maps the pointer through the drawn box and the viewBox (no getScreenCTM, which some mobile WebKit builds get wrong under CSS transforms)
    const el = svg.current; if (!el) return null;
    const b = el.getBoundingClientRect(), vb = el.viewBox && el.viewBox.baseVal;
    if (!b.width || !b.height || !vb || !vb.width) return null;
    const k = Math.min(b.width / vb.width, b.height / vb.height);
    const ox = b.left + (b.width - vb.width * k) / 2, oy = b.top + (b.height - vb.height * k) / 2;
    const x = vb.x + (e.clientX - ox) / k, y = vb.y + (e.clientY - oy) / k;
    const r = Math.floor((y - LAB) / CELL), c = Math.floor((x - LAB) / CELL);
    return geo.inside(r, c) && !geo.isVoid(r, c) ? [r, c] : null;
  };

  return (
    <svg ref={svg} className="sk-board" viewBox={`${LAB - BZ - LB} ${LAB - BZ - LB} ${W + LB} ${H + LB}`} role="grid" aria-label={t("game.boardAria", { title: p.title, rows: R, cols: C })}
      onPointerDown={(e) => {
        if (e.button !== 0 && !(e.button === 2 && e.pointerType === "mouse" && onStroke)) return; // the right button: the game's right-click setting
        const c = cellAt(e); if (!c) return;
        try { svg.current.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ }
        if (onStroke) onStroke("down", c, e); else if (onCell) onCell(c[0], c[1]);
      }}
      onPointerMove={(e) => { const c = cellAt(e); if (onHover) onHover(e.pointerType === "mouse" ? c : null); if (onStroke) onStroke("move", c, e); }}
      onPointerUp={(e) => onStroke && onStroke("up", cellAt(e), e)}
      onPointerCancel={() => onStroke && onStroke("cancel")}
      onPointerLeave={() => onHover && onHover(null)}
      onContextMenu={(e) => e.preventDefault()}>
      <FloorDefs />
      <defs>
        {/* the shadow's hatching: a dark stroke and a pale one side by side, so an unlit tile reads on light and dark floors alike */}
        {/* the shadow's rim: a soft darkening on the sides of a dark tile that face light, a wall or the floor's edge, one per side */}
        {SHADE_RIM.map(([id, x1, y1, x2, y2]) => (
          <linearGradient key={id} id={`skRim${id}-${uid}`} x1={x1} y1={y1} x2={x2} y2={y2}>
            <stop offset="0" stopColor="#05070f" stopOpacity=".58" /><stop offset="1" stopColor="#05070f" stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      <rect x={LAB - BZ} y={LAB - BZ} width={W} height={H} rx="14" fill="#0e0f15" />
      {real.map(([r, c]) => <rect key={`f${r}-${c}`} x={X(c)} y={Y(r)} width={CELL} height={CELL} fill={`url(#skf-${floors[geo.room(r, c)] || floorOf(p.roomNames[geo.room(r, c)], geo.room(r, c), theme)})`} />)}
      {real.map(([r, c]) => <rect key={`g${r}-${c}`} x={X(c) + 0.5} y={Y(r) + 0.5} width={CELL - 1} height={CELL - 1} fill="none" stroke="#000" strokeOpacity=".16" />)}
      {LB > 0 && (
        <g pointerEvents="none" textAnchor="middle" fill="#a9b0c4" style={{ fontFamily: "'Barlow', system-ui, sans-serif", fontWeight: 700, fontSize: 10 }}>
          {Array.from({ length: C }, (_, c) => <text key={`cl${c}`} x={X(c) + CELL / 2} y={LAB - BZ - LB / 2 + 3.6}>{t("settings.colNum", { n: c + 1 })}</text>)}
          {Array.from({ length: R }, (_, r) => <text key={`rl${r}`} x={LAB - BZ - LB / 2} y={Y(r) + CELL / 2 + 3.6}>{t("settings.rowNum", { n: r + 1 })}</text>)}
        </g>
      )}

      {water.length > 0 && (
        <g pointerEvents="none">
          {water.map(([r, c]) => (
            <g key={`w${r}-${c}`}>
              <rect x={X(c)} y={Y(r)} width={CELL} height={CELL} fill="url(#skf-water)" />
              <rect x={X(c)} y={Y(r)} width={CELL} height={CELL} fill="#06304a" opacity={Math.min(0.5, 0.12 * ((depth.get(key(r, c)) || 3) - 1))} />
              <rect x={X(c)} y={Y(r)} width={CELL} height={CELL} fill={FOG} opacity=".3" />
            </g>
          ))}
          <g className="sk-foam" fill="none" strokeLinecap="round">
            {shore.map(([r, c, d]) => {
              const [a, b] = edge(X(c), Y(r), d), [nx, ny] = [[0, 1], [0, -1], [1, 0], [-1, 0]][d];
              return (
                <g key={`fo${r}-${c}-${d}`}>
                  <path d={wavy(a, b, nx, ny, 3.4, 2.4)} stroke="#fff" strokeOpacity=".92" strokeWidth="2.6" />
                  <path d={wavy(a, b, nx, ny, 9, 2.2)} stroke="#e4f8ff" strokeOpacity=".5" strokeWidth="1.5" strokeDasharray="6 5" />
                </g>
              );
            })}
          </g>
        </g>
      )}

      {/* props by class: LOW (flush) first, then SHORT, then PERCH and TALL, each pass in reading order so upright props
          overlap correctly. A multi-tile object is ONE item drawn across its span (box origin = its top-left cell). */}
      {props.map((it) => (
        <g key={`p${it.r}-${it.c}-${it.kind}`} transform={`translate(${X(it.c)} ${Y(it.r)})${+o.objSize ? ` translate(${it.cw * CELL / 2} ${it.ch * CELL / 2}) scale(${1 + +o.objSize}) translate(${-it.cw * CELL / 2} ${-it.ch * CELL / 2})` : ""}`} pointerEvents="none">
          <PropSprite kind={it.kind} cw={it.cw} ch={it.ch} len={it.len} horizontal={it.horizontal} cells={it.cells.map(([r, c]) => [r - it.r, c - it.c])} flip={it.flip} victim={victimNameOf(p)} dummy={victimIsDummy(p)} master={p.id === UMBRA_FINALE} second={p.id === UMBRA_HARD} />
        </g>
      ))}

      {/* the lights: cool slate shadow with a soft rim where it meets the light, melting away (rippling out from each scapegoat), a tinted wash on top
          (⚙ light colours: the scapegoats' sightlines, else the player's own Light Switch) */}
      {real.map(([r, c]) => {
        const k = key(r, c), lit = litMap.has(k) || !!s.lights[k], tint = tintOf(litMap.has(k) ? o.lightTint : o.myTint);
        const delay = litMap.has(k) ? `${Math.min(litMap.get(k), 9) * 55}ms` : "0ms";
        return (
          <g key={`fg${r}-${c}`} pointerEvents="none">
            <rect className="sk-fog" x={X(c)} y={Y(r)} width={CELL} height={CELL} fill={FOG} style={{ opacity: lit ? 0 : FOG_OPACITY, transitionDelay: delay }} />
            {SHADE_RIM.map(([id, , , , , dr, dc]) => { // a side is a rim where the neighbour is lit, behind a wall (not a door) or not floor at all
              const nr = r + dr, nc = c + dc, nk = key(nr, nc), open = !geo.inside(nr, nc) || geo.isVoid(nr, nc) || geo.isWall([r, c], [nr, nc]) || litMap.has(nk) || !!s.lights[nk];
              const w = dc ? RIM_W : CELL, h = dr ? RIM_W : CELL, x = dc > 0 ? X(c) + CELL - RIM_W : X(c), y = dr > 0 ? Y(r) + CELL - RIM_W : Y(r);
              return <rect key={id} className="sk-fog" x={x} y={y} width={w} height={h} fill={`url(#skRim${id}-${uid})`} style={{ opacity: !lit && open ? 1 : 0, transitionDelay: delay }} />;
            })}
            <rect className="sk-warm" x={X(c)} y={Y(r)} width={CELL} height={CELL} fill={tint.wash} style={{ opacity: lit ? tint.op : 0, transitionDelay: delay }} />
          </g>
        );
      })}

      <g pointerEvents="none" strokeLinecap="round" strokeDasharray="0.1 7">
        {sills.map((q) => <line key={`i${q.k}`} x1={q.x1} y1={q.y1} x2={q.x2} y2={q.y2} stroke={INK} strokeWidth={5.2 * (+o.walls || 1)} />)}
        {sills.map((q) => <line key={`c${q.k}`} x1={q.x1} y1={q.y1} x2={q.x2} y2={q.y2} stroke={OPENING} strokeWidth={3 * (+o.walls || 1)} />)}
      </g>
      <WallLayer segs={segs} posts={[...postAt.values()]} core={BIOME_META[theme].wall} postCore={OPENING} k={+o.walls || 1} />
      {roomEdges.length > 0 && (
        <g pointerEvents="none" strokeLinecap="square" stroke="#4da3ff">
          {roomEdges.map((e) => <line key={e.k} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} strokeWidth={(e.door ? 2.4 : 5) * (+o.walls || 1)} strokeDasharray={e.door ? "5 5" : undefined} />)}
        </g>
      )}
      {(p.windows || []).map((w, i) => <WindowPane key={`win${i}`} {...windowAt(w)} />)}

      {/* the player's own light switches: a small bulb in the corner, in the player's light colour */}
      {real.filter(([r, c]) => s.lights[key(r, c)] && !tokenAt.has(key(r, c))).map(([r, c]) => (
        <g key={`lb${r}-${c}`} transform={`translate(${X(c) + CELL - 10} ${Y(r) + 10})`} pointerEvents="none">
          <circle r="7.5" fill={o.myTint === "warm" ? BRASS : tintOf(o.myTint).bulb} fillOpacity=".22" /><circle r="3.8" fill={tintOf(o.myTint).bulb} stroke={INK} strokeWidth="1.3" />
        </g>
      ))}
      {/* the player's X marks: nobody can be here */}
      {real.filter(([r, c]) => s.crosses[key(r, c)] && !tokenAt.has(key(r, c))).map(([r, c]) => {
        const x0 = X(c) + 17, y0 = Y(r) + 17, x1 = X(c) + CELL - 17, y1 = Y(r) + CELL - 17, d = `M${x0} ${y0}L${x1} ${y1}M${x1} ${y0}L${x0} ${y1}`;
        return (
          <g key={`x${r}-${c}`} pointerEvents="none" strokeLinecap="round">
            <path d={d} stroke={CREAM} strokeOpacity=".45" strokeWidth="9" />
            <path d={d} stroke={INK} strokeWidth="5.5" />
          </g>
        );
      })}

      {real.filter(([r, c]) => focusSet.has(key(r, c))).map(([r, c]) => (
        <rect key={`fc${r}-${c}`} x={X(c) + 3} y={Y(r) + 3} width={CELL - 6} height={CELL - 6} rx="6" fill="none" stroke="#6fd0ff" strokeWidth="2.4" strokeDasharray="6 6" className="sk-march" pointerEvents="none" />
      ))}
      {hiCells && hiCells.map(([r, c]) => (
        <rect key={`hi${r}-${c}`} x={X(c) + 2} y={Y(r) + 2} width={CELL - 4} height={CELL - 4} rx="7" fill="#f0b94a" fillOpacity=".22" stroke="#f0b94a" strokeWidth="2.6" pointerEvents="none" />
      ))}
      {focus?.cell && <rect x={X(focus.cell[1]) + 1.5} y={Y(focus.cell[0]) + 1.5} width={CELL - 3} height={CELL - 3} rx="7" fill="none" stroke="#6fd0ff" strokeWidth="3" pointerEvents="none" />}

      {showHover && (
        <g pointerEvents="none">
          {geo.rays(hover[0], hover[1]).flat().map(([r, c]) => (
            <rect key={`hv${r}-${c}`} x={X(c) + 3} y={Y(r) + 3} width={CELL - 6} height={CELL - 6} rx="5" fill={colorOf(active)} fillOpacity=".14" stroke={colorOf(active)} strokeOpacity=".7" strokeWidth="1.4" strokeDasharray="4 4" />
          ))}
          <rect x={X(hover[1]) + 2} y={Y(hover[0]) + 2} width={CELL - 4} height={CELL - 4} rx="5" fill="none" stroke={colorOf(active)} strokeWidth="2.4" />
        </g>
      )}

      {/* candidate notes: a 3×3 grid of uppercase letters in each suspect's Polaroid colour (4×3 from 10 letters, 4×4 for the 12×12 casts: A–N + S) */}
      {real.map(([r, c]) => {
        const k = key(r, c), n = s.notes[k];
        if (!n || tokenAt.has(k) || notesHidden(s, k)) return null;
        const ids = order.filter((id) => n.includes(id) && !tokens[id]);
        const g4 = ids.length > 12, cols = ids.length > 9 ? 4 : 3, step = cols === 4 ? 14.5 : 18; // g4: up to 15 letters in a 4×4 mini-grid
        const rowH = g4 ? 13.5 : 16, y0 = g4 ? 16 : 25, fs = g4 ? 10.5 : cols === 4 ? 12 : 14.5;
        return (
          <g key={`n${k}`} pointerEvents="none" textAnchor="middle" style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 800, fontSize: fs, paintOrder: "stroke" }}>
            {ids.map((id, i) => {
              const x = X(c) + CELL / 2 + ((i % cols) - (cols - 1) / 2) * step, y = Y(r) + y0 + Math.floor(i / cols) * rowH;
              const hot = o.selHi && tool === "suspect" && id === active; // the selected suspect's notes pop; the rest step back ("Highlight for selected character")
              return (
                <g key={id} opacity={o.selHi && tool === "suspect" && !hot ? 0.55 : 1}>
                  {hot && <circle cx={x} cy={y - (g4 ? 4.2 : 5)} r={g4 ? 7.2 : cols === 4 ? 8.5 : 10} fill={colorOf(id)} fillOpacity=".3" stroke={colorOf(id)} strokeWidth={g4 ? 1.6 : 2} />}
                  {isSym(id) /* a note symbol: the shape in its colour, the size of a letter */
                    ? <SymShape id={id} cx={x} cy={y - (g4 ? 4.2 : 5)} r={(g4 ? 5.2 : cols === 4 ? 6 : 7) * (hot ? 1.12 : 1)} fill={NOTE_SYMBOLS[id].color} stroke={INK} strokeWidth={g4 ? 1.8 : 2.2} style={{ paintOrder: "stroke" }} />
                    : <text x={x} y={y} fill={hot ? CREAM : colorOf(id)} stroke={INK} strokeWidth={g4 ? 2.6 : 3} strokeLinejoin="round" style={{ paintOrder: "stroke", fontSize: hot ? (g4 ? 11.5 : cols === 4 ? 13 : 16) : undefined }}>{id.toUpperCase()}</text>}
                </g>
              );
            })}
          </g>
        );
      })}

      {/* ⚙ Note Symbols held onto a tile: the symbol in big (an X or a token on the tile hides it) */}
      {real.filter(([r, c]) => s.syms[key(r, c)] && !tokenAt.has(key(r, c)) && !s.crosses[key(r, c)]).map(([r, c]) => {
        const id = s.syms[key(r, c)], col = NOTE_SYMBOLS[id].color, cx = X(c) + CELL / 2, cy = Y(r) + CELL / 2 + 1;
        return (
          <g key={`sy${r}-${c}`} pointerEvents="none">
            <SymShape id={id} cx={cx} cy={cy} r={19} fill="none" stroke={INK} strokeWidth="9" />
            <SymShape id={id} cx={cx} cy={cy} r={19} fill={col} fillOpacity=".28" stroke={col} strokeWidth="4.5" />
          </g>
        );
      })}

      {Object.entries(tokens).map(([id, [r, c]]) => {
        const cx = X(c) + CELL / 2, cy = Y(r) + CELL / 2, bad = conflicts.has(id) && <circle cx={cx} cy={cy} r="25" fill="none" stroke="#ff6f6f" strokeWidth="3" className="sk-pulse" />;
        const sel = o.selHi && tool === "suspect" && id === active && <circle cx={cx} cy={cy} r="26.5" fill="none" stroke={colorOf(id)} strokeWidth="3" />;
        const letter = o.tokenStyle === "letter"; // "Placed Suspect Style": a lettered disc instead of the portrait
        if (id === "S") return (
          <g key="tokS" pointerEvents="none">
            {solved && <circle cx={cx} cy={cy} r="28" fill="none" stroke={BRASS} strokeWidth="4" className="sk-catch" />}
            {solved && <circle cx={cx} cy={cy} r="30" fill={BRASS} fillOpacity=".2" />}
            {letter ? <LetterToken cx={cx} cy={cy} id="S" fill="#171a26" ink={BRASS} ring={BRASS} dashed /> : <AdowToken cx={cx} cy={cy} uid={uid} beach={beach} />}{sel}{bad}
          </g>
        );
        if (hiders.includes(id)) return (
          <g key={`tok${id}`} pointerEvents="none">
            {letter ? <LetterToken cx={cx} cy={cy} id={id} fill="#171a26" ink={colorOf(id)} ring={colorOf(id)} dashed /> : <AssassinToken cx={cx} cy={cy} uid={uid} who={id} />}{sel}{bad}
          </g>
        );
        return (
          <g key={`tok${id}`} pointerEvents="none">
            <circle cx={cx} cy={cy} r="34" fill="url(#skGlow)" />
            {letter ? <LetterToken cx={cx} cy={cy} id={id} fill={colorOf(id)} ink={inkOn(colorOf(id))} ring={INK} /> : <TokenAvatar cx={cx} cy={cy} look={looks[id]} id={id} uid={uid} />}
            <PropChip kind={geo.kind(r, c)} cls={geo.cls(r, c)} x={X(c) + 12} y={Y(r) + 12} />{sel}{bad}
          </g>
        );
      })}
      {/* room names last but the coaching: a suspect standing on the label tile never hides the name */}
      {Object.entries(geo.labelAt).map(([rid, [r, c]]) => {
        let run = 1;
        while (c + run < C && geo.room(r, c + run) === geo.room(r, c)) run++;
        const pop = hovRoom === +rid, k = (+o.roomLabel || 14) / 14 * (pop ? 1.3 : 1); // room label size (settings) · the hovered room's label pops
        const name = upper((p.roomLabels || p.roomNames)[rid] || ""), maxW = run * CELL - 12;
        const fit = name.length * 6.4 * k > maxW ? { textLength: maxW, lengthAdjust: "spacingAndGlyphs" } : {};
        return (
          <text key={`rn${rid}`} x={X(c) + 7} y={Y(r) + 5.5 + 8.5 * k} pointerEvents="none" {...fit} fill={pop ? "#bfe0ff" : CREAM} stroke={INK} strokeWidth={2.6 * Math.max(1, k * 0.8)} strokeOpacity=".85"
            style={{ paintOrder: "stroke", fontFamily: "'Barlow', system-ui, sans-serif", fontWeight: 700, fontSize: 8.5 * k, letterSpacing: ".1em" }}>{name}</text>
        );
      })}
      {coachCells && coachCells.map(([r, c]) => (
        <g key={`coach${r}-${c}`} pointerEvents="none" className="sk-coach">
          <rect className="sk-coachring" x={X(c) + 3} y={Y(r) + 3} width={CELL - 6} height={CELL - 6} rx="10" fill="none" stroke={BRASS} strokeWidth="4" />
        </g>
      ))}
      {hold && (() => {
        const cx = X(hold.c) + CELL / 2, cy = Y(hold.r) + CELL / 2, d = { animationDuration: `${HOLD_MS}ms`, animationDelay: `-${HOLD_SHOW_MS}ms` };
        return (
          <g key={`hold${hold.t}`} pointerEvents="none">
            <circle className="sk-holdfill" cx={cx} cy={cy} r="24" fill={hold.color} style={d} />
            <circle cx={cx} cy={cy} r="29" fill="none" stroke={INK} strokeOpacity=".55" strokeWidth="9" />
            <circle className="sk-holdring" cx={cx} cy={cy} r="29" fill="none" stroke={hold.color} strokeWidth="6" strokeLinecap="round" pathLength="100" strokeDasharray="100"
              transform={`rotate(-90 ${cx} ${cy})`} style={d} />
            <circle cx={cx} cy={cy} r="29" fill="none" stroke={CREAM} strokeOpacity=".85" strokeWidth="1.4" />
          </g>
        );
      })()}
      {flash > 0 && <rect key={flash} className="sk-flash" x={LAB - BZ} y={LAB - BZ} width={W} height={H} rx="14" fill={BRASS} pointerEvents="none" />}

      {real.map(([r, c]) => {
        const k = key(r, c), kind = geo.kind(r, c);
        return (
          <rect key={`h${r}-${c}`} className="hit" x={X(c)} y={Y(r)} width={CELL} height={CELL} fill="transparent" tabIndex={0} role="gridcell"
            aria-label={t("game.tileAria", { coord: t("fmt.coord", { row: r + 1, col: c + 1 }), room: (p.roomLabels || p.roomNames)[geo.room(r, c)], prop: kind ? t("game.tileProp", { prop: describe ? describe(kind) : (LABEL[kind] || kind) }) : "", token: tokenAt.has(k) ? t("game.tileToken", { token: tokenAt.get(k) }) : "", notes: (s.notes[k] || s.syms[k]) && !tokenAt.has(k) && !s.crosses[k] ? t("game.tileNotes", { notes: tileNoteText(s, k, t) }) : "", lit: s.lights[k] ? t("game.tileLit") : s.crosses[k] ? t("game.tileCrossed") : "" })}
            style={{ cursor: geo.occupiable(r, c) ? "pointer" : "default" }}
            onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && onKey) { e.preventDefault(); onKey(r, c, e); } }} />
        );
      })}
    </svg>
  );
}

/* ---------------------------------------------------------------------- */
/*  Header pieces                                                          */
/* ---------------------------------------------------------------------- */
/** "Very Easy" → d-very-easy. Tutorial · Very Easy · Easy · Medium · Hard · Expert each have their own badge colour. */
export const diffSlug = (d) => String(d || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const Diff = ({ d, id }) => <span className={`sk-diff d-${diffSlug(id || d)}`}>{d}</span>;
export const TUTORIAL_ID = "tutorial";
/** The tutorial is "T"; the real contracts count from #1 (so "Contract #1" is the first one after the tutorial). */
export const caseLabel = (puzzles, i, t = tEn) => (puzzles[i] && puzzles[i].id === TUTORIAL_ID ? t("game.caseTutorial") : t("game.caseNumber", { n: i + 1 - puzzles.slice(0, i).filter((q) => q.id === TUTORIAL_ID).length }));
export const LOCK_TIP = "Complete Master U. M. Bra's initiation first";
const caseRow = (puzzles, q, i, solvedOf, t) => (
  <>{!q.daily && <span className="sk-cn">{caseLabel(puzzles, i, t)}</span> /* a daily contract has no story number: its title carries the date */}<span className="sk-ci" aria-hidden="true">{BIOME_META[themeOf(q)].icon}</span><span className="sk-ct">{q.title}</span>
    <span className="sk-cs">{dims(q)}</span><Diff d={q.difficulty} id={q.diffId} />{solvedOf(q) && <span className="sk-ok" aria-label={t("game.solved")}>✓</span>}</>
);
/** The open contract's name, difficulty and size, as plain text: contracts are only picked on the wrapper's contracts page. */
function CaseTitle({ puzzles, idx, solvedOf }) {
  const t = useText();
  return <div className="sk-menu"><div className="sk-menu-btn sk-static" role="heading" aria-level={1}>{caseRow(puzzles, puzzles[idx], idx, solvedOf, t)}</div></div>;
}
function CaseMenu({ puzzles, idx, onPick, solvedOf, disabled = false }) {
  const t = useText();
  const [open, setOpen] = useState(false), ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const out = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", out); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc); };
  }, [open]);
  const row = (q, i) => caseRow(puzzles, q, i, solvedOf, t);
  const lockTip = t("game.lockTip");
  return (
    <div className={`sk-menu${disabled ? " locked" : ""}`} ref={ref} title={disabled ? lockTip : undefined}>
      <button type="button" className="sk-menu-btn" aria-haspopup="listbox" aria-expanded={open} aria-disabled={disabled || undefined} aria-label={disabled ? t("game.lockedPicker", { title: puzzles[idx].title, tip: lockTip }) : undefined}
        title={disabled ? lockTip : undefined} onClick={() => !disabled && setOpen(!open)}>
        {row(puzzles[idx], idx)}
        {disabled ? <span className="sk-lock" role="img" aria-label={t("game.locked")} title={lockTip}><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.8" fill="currentColor" /><path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg></span> : <span className="sk-caret">▾</span>}
      </button>
      {open && !disabled && (
        <ul className="sk-menu-list" role="listbox" aria-label={t("game.pickContract")}>
          {puzzles.map((q, i) => <li key={q.id}><button type="button" role="option" aria-selected={i === idx} onClick={() => { onPick(i); setOpen(false); }}>{row(q, i)}</button></li>)}
        </ul>
      )}
    </div>
  );
}

/** Elapsed time on this case (mm:ss). Pauses when the case is solved, when the tab is hidden or when told to. Own state: the board never re-renders on a tick. */
function CaseTimer({ caseId, paused, solved, hidden = false }) { // hidden ("Show Timer" off): it still counts, for the best times
  const t = useText();
  const [sec, setSec] = useState(() => readTime(caseId));
  useEffect(() => { writeTime(caseId, sec); }, [caseId, sec]);
  useEffect(() => {
    if (paused || solved) return undefined;
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      if (typeof document !== "undefined" && document.hidden) { last = now; return; }
      const d = Math.floor((now - last) / 1000);
      if (d > 0) { last += d * 1000; setSec((s) => s + d); }
    };
    const id = setInterval(tick, 250);
    const vis = () => { last = Date.now(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [paused, solved]);
  return (
    <span className={`sk-timer${solved ? " done" : ""}`} hidden={hidden} role="timer" aria-label={t(solved ? "game.timerSolved" : "game.timerElapsed", { time: fmtTime(sec) })} title={t(solved ? "game.timerSolvedTip" : "game.timerTip")}>
      <span aria-hidden="true">{solved ? "✓" : "⏱"}</span>{fmtTime(sec)}
    </span>
  );
}

/* ---- How to play: tabs (How to play · Keywords · Advanced · FAQ) with mini floorplans, Murdoku-style ---- */
/* A mini floorplan: `g` rows of tile codes, `r` rows of room letters (walls are drawn where the room changes).
   . empty · o suspect · L lit · x nobody · v possible · T tall prop · s short prop · w rug · W rug, possible · D dark (S. H. Adow) · a b c a suspect's letter */
const MINI = {
  sight: { g: ["..L...", "LLoLT.", "..L..."], r: ["AAAAAA", "AAAAAA", "AAAAAA"] },
  nosee: { g: ["x.....", "oxxTvv", "x....."], r: ["AAAAAA", "AAAAAA", "AAAAAA"] },
  occupy: { g: ["Tvs", "vWv", "svT"], r: ["AAA", "AAA", "AAA"] },
  dark: { g: ["LoLL", "LLTD", "oLLL", "LLoL"], r: ["AAAA", "AAAA", "AAAA", "AAAA"] },
  beside: { g: [".v.", "vo.", "..."], r: ["AAB", "AAB", "ABB"] },
  diagonal: { g: ["v..", ".o.", "v.."], r: ["AAB", "AAB", "AAB"] },
  alone: { g: ["xx.", "xo.", "x.."], r: ["AAB", "AAB", "ABB"] },
  same: { g: ["a..", "...", ".b."], r: ["AAB", "AAB", "AAB"] },
  exactly: { g: ["...", "vvv", ".a.", "..."], r: ["AAA", "AAA", "AAA", "AAA"] },
  north: { g: ["vvv", "vvv", ".a.", "..."], r: ["AAA", "AAA", "AAA", "AAA"] },
  south: { g: ["...", ".a.", "vvv", "vvv"], r: ["AAA", "AAA", "AAA", "AAA"] },
  east: { g: ["..vv", ".avv", "..vv"], r: ["AAAA", "AAAA", "AAAA"] },
  west: { g: ["vv..", "vva.", "vv.."], r: ["AAAA", "AAAA", "AAAA"] },
  row: { g: ["...", "vvv", "..."], r: ["AAB", "AAB", "ABB"] },
  column: { g: [".v.", ".v.", ".v."], r: ["AAB", "AAB", "ABB"] },
  corner: { g: ["v.v.", "....", "v.v."], r: ["AAAB", "AAAB", "AAAB"] },
  see: { g: ["L...", "oLLT.", "L...."], r: ["AAAAA", "AAAAA", "AAAAA"] },
  rayblock: { g: ["aaxxTv", "......"], r: ["AAAAAA", "AAAAAA"] },
  domino: { g: ["..x..", "xxoxx", "..x..", "TTxaT"], r: ["AAAAA", "AAAAA", "AAAAA", "AAAAA"] },
  law: { g: ["LLLo", "LDLL", "oTLL", "LLoL"], r: ["AAAA", "AAAA", "AAAA", "AAAA"] },
};
function MiniPlan({ id }) {
  const m = MINI[id];
  if (!m) return null;
  const Z = 26, R = m.g.length, C = Math.max(...m.g.map((x) => x.length));
  const at = (r, c) => (m.g[r] || "")[c] || ".", room = (r, c) => (m.r[r] || "")[c] || "A";
  const cells = [], marks = [], walls = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const k = at(r, c), x = c * Z, y = r * Z, cx = x + Z / 2, cy = y + Z / 2;
    cells.push(<rect key={`t${r}-${c}`} x={x} y={y} width={Z} height={Z} fill={k === "D" ? "#2b2e3b" : room(r, c) === "A" ? "#dfe9f4" : "#d4e6cc"} stroke="#9aa6b6" strokeWidth=".6" />);
    if (k === "L") cells.push(<rect key={`l${r}-${c}`} x={x + 1} y={y + 1} width={Z - 2} height={Z - 2} fill="#ffd27a" opacity=".55" />);
    if (k === "o") marks.push(<circle key={`o${r}-${c}`} cx={cx} cy={cy} r={7.5} fill="#f0b94a" stroke="#1A1A22" strokeWidth="1.6" />);
    if (k === "x") marks.push(<path key={`x${r}-${c}`} d={`M${x + 7} ${y + 7}L${x + Z - 7} ${y + Z - 7}M${x + Z - 7} ${y + 7}L${x + 7} ${y + Z - 7}`} stroke="#7d8492" strokeWidth="3" strokeLinecap="round" />);
    if (k === "v" || k === "W") marks.push(<circle key={`v${r}-${c}`} cx={cx} cy={cy} r={7} fill="none" stroke="#2f9e44" strokeWidth="2.6" />);
    if (k === "T") marks.push(<g key={`T${r}-${c}`}><rect x={x + 4} y={y + 3} width={Z - 8} height={Z - 6} rx="2" fill="#5b4b3a" stroke="#1A1A22" strokeWidth="1.2" /><rect x={x + 6} y={y + 5} width={Z - 12} height={5} rx="1" fill="#8a7458" /></g>);
    if (k === "s") marks.push(<rect key={`s${r}-${c}`} x={x + 6} y={y + 8} width={Z - 12} height={Z - 14} rx="2" fill="#b9a27a" stroke="#1A1A22" strokeWidth="1.1" />);
    if (k === "w" || k === "W") cells.push(<rect key={`w${r}-${c}`} x={x + 3} y={y + 5} width={Z - 6} height={Z - 10} rx="2" fill="#c98b8b" opacity=".75" />);
    if (k === "D") marks.push(<g key={`D${r}-${c}`}><ellipse cx={cx} cy={cy + 3} rx={8} ry={2.4} fill="#0f1016" /><path d={`M${cx - 5} ${cy + 3}Q${cx - 4} ${cy - 6} ${cx} ${cy - 6}Q${cx + 4} ${cy - 6} ${cx + 5} ${cy + 3}Z`} fill="#0f1016" /><rect x={cx - 5} y={cy} width="10" height="1.8" fill="#C83E3B" /></g>);
    if (/[a-c]/.test(k)) marks.push(<g key={`a${r}-${c}`}><rect x={x + 1.5} y={y + 1.5} width={Z - 3} height={Z - 3} fill="#b9d3ee" /><text x={cx} y={cy + 5} textAnchor="middle" fontFamily="Georgia, serif" fontWeight="700" fontSize="14" fill="#1A1A22">{k}</text></g>);
    // walls: the border, and wherever the room changes
    if (c === C - 1 || room(r, c) !== room(r, c + 1)) walls.push(`M${x + Z} ${y}V${y + Z}`);
    if (r === R - 1 || room(r, c) !== room(r + 1, c)) walls.push(`M${x} ${y + Z}H${x + Z}`);
    if (c === 0) walls.push(`M${x} ${y}V${y + Z}`);
    if (r === 0) walls.push(`M${x} ${y}H${x + Z}`);
  }
  return (
    <svg className="sk-mini" viewBox={`-3 -3 ${C * Z + 6} ${R * Z + 6}`} width={C * Z + 6} height={R * Z + 6} aria-hidden="true">
      {cells}{marks}<path d={walls.join("")} stroke="#111" strokeWidth="3.4" strokeLinecap="square" fill="none" />
    </svg>
  );
}
const HOW_RULES = ["sight", "nosee", "occupy", "dark"];
const HOW_KEYWORDS = ["beside", "diagonal", "alone", "same", "exactly", "north", "south", "east", "west", "row", "column", "corner", "see"];
const HOW_ADVANCED = ["domino", "rayblock", "law", "trial"];
const HOW_FAQ = ["corpse", "adow", "true", "unique", "guess", "rowcol", "doors", "doorway", "big", "perch", "portraits"];
const HOW_TABS = ["play", "keywords", "advanced", "faq"];

export function HowTo({ onClose, children = null }) {
  const t = useText();
  const [tab, setTab] = useState("play");
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  const card = (id, k) => (
    <div key={id} className="sk-how-card">
      {k && <b className="sk-how-kw">{t(`howto.kw.${id}.name`)}</b>}
      <p>{boldNodes(t(k ? `howto.kw.${id}.text` : `howto.rule.${id}`))}</p>
      <MiniPlan id={id} />
    </div>
  );
  return (
    <div className="sk-modal sk-howwrap" role="dialog" aria-modal="true" aria-label={t("howto.title")} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sk-how">
        <div className="sk-how-h">
          <h2>{t("howto.title")}</h2>
          <button type="button" className="sk-set-x" onClick={onClose} aria-label={t("modal.close")}>×</button>
        </div>
        <div className="sk-how-tabs" role="tablist">
          {HOW_TABS.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t(`howto.tab.${k}`)}</button>)}
        </div>
        <div className="sk-how-body" role="tabpanel">
          {tab === "play" && <>
            <h3>{t("howto.goal")}</h3>
            <p>{boldNodes(t("howto.intro"))}</p>
            <h3>{t("howto.rules")}</h3>
            <div className="sk-how-grid">{HOW_RULES.map((id) => card(id, false))}</div>
            <h3>{t("howto.controls")}</h3>
            <ul>{["pick", "tap", "drag", "props"].map((k) => <li key={k}>{boldNodes(t(`howto.${k}`))}</li>)}</ul>
            <h3>{t("howto.tools")}</h3>
            <ul>{["light", "cross", "eraser", "inspect", "undoHint", "redo", "submit", "zoom"].map((k) => <li key={k}>{boldNodes(t(`howto.${k}`))}</li>)}</ul>
            {children}
          </>}
          {tab === "keywords" && <div className="sk-how-grid">{HOW_KEYWORDS.map((id) => card(id, true))}</div>}
          {tab === "advanced" && HOW_ADVANCED.map((id, i) => (
            <div key={id} className="sk-how-adv">
              <h3>{`${i + 1}. ${t(`howto.adv.${id}.title`)}`}</h3>
              <p>{boldNodes(t(`howto.adv.${id}.text`))}</p>
              {MINI[id] && <div className="sk-how-ex"><MiniPlan id={id} /><p>{boldNodes(t(`howto.adv.${id}.example`))}</p></div>}
            </div>
          ))}
          {tab === "faq" && <>
            <h3 className="sk-how-faqh">{t("howto.faqTitle")}</h3>
            {HOW_FAQ.map((id) => (
              <details key={id} className="sk-how-faq">
                <summary>{t(`howto.faq.${id}.q`)}</summary>
                <p>{boldNodes(t(`howto.faq.${id}.a`))}</p>
              </details>
            ))}
          </>}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Tool buttons                                                           */
/* ---------------------------------------------------------------------- */
/** 🧹 Tap = pick the Eraser (tap again to put it down). Hold = clear the whole board (rising fill + perimeter ring + pill). */
function EraserButton({ active, onSelect, onClearAll, coach }) {
  const t = useText();
  const [hold, setHold] = useState(0);
  const ref = useRef(null), h = useRef(null);
  const { w, h: bh } = useElementSize(ref);
  useEffect(() => () => { if (h.current) cancelAnimationFrame(h.current.raf); }, []);
  const start = (e) => {
    if (e.button !== 0) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    begin();
  };
  /* the hold itself: a pointer held down, or Enter / Space held down (a quick press only selects the Eraser) */
  const begin = () => {
    if (h.current) return;
    const t0 = performance.now(), state = { done: false, raf: 0 };
    const tick = () => {
      const f = Math.min(1, (performance.now() - t0) / HOLD_MS);
      setHold(f);
      if (f < 1) { state.raf = requestAnimationFrame(tick); return; }
      state.done = true; setHold(0); onClearAll();
    };
    state.raf = requestAnimationFrame(tick);
    h.current = state;
  };
  const end = (select) => () => {
    const s = h.current;
    if (!s) return;
    cancelAnimationFrame(s.raf); h.current = null; setHold(0);
    if (!s.done && select) onSelect();
  };
    return (
    <button type="button" ref={ref} className={`sk-tool sk-eraser${coach ? " coach" : ""}`} aria-pressed={active} style={{ "--h": hold }}
      title={t("tools.eraserTip")}
      onPointerDown={start} onPointerUp={end(true)} onPointerCancel={end(false)} onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!e.repeat) begin(); } }}
      onKeyUp={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); end(true)(); } }} onBlur={end(false)}>
      <span className="sk-fill" aria-hidden="true" />
      {w > 0 && hold > 0 && (
        <svg className="sk-ring" viewBox={`0 0 ${w} ${bh}`} aria-hidden="true">
          <rect x="1.5" y="1.5" width={Math.max(0, w - 3)} height={Math.max(0, bh - 3)} rx="12" pathLength="100" strokeDasharray={`${hold * 100} 100`} />
        </svg>
      )}
      <span className="ic" aria-hidden="true">🧹</span><small>{t("tools.erase")}</small>
      {hold > 0 && <span className="sk-tip" role="status">{t("tools.eraseHold")}</span>}
    </button>
  );
}

/** 💡 Tap = pick the Light Switch. Right-click (mouse) = the colour strip; tap a colour. Touch: hold until the strip opens and slide
 *  along it, the colour follows the finger (lifting there keeps it; lifting without touching a colour leaves the strip open for a tap).
 *  The bulb on the button takes the player's light colour (`tint`). */
function LightButton({ active, onSelect, tint, onTint, coach }) {
  const t = useText();
  const ref = useRef(null), press = useRef(null), quietUntil = useRef(0);
  const [menu, setMenu] = useState(null); // null | { rect, drag }
  useEffect(() => () => { if (press.current) clearTimeout(press.current.timer); }, []);
  const open = (drag) => setMenu({ rect: ref.current.getBoundingClientRect(), drag });
  const down = (e) => {
    if (e.button !== 0 || e.pointerType === "mouse") return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    const p = { open: false, moved: false };
    p.timer = setTimeout(() => { p.open = true; open(true); }, TINT_HOLD_MS);
    press.current = p;
  };
  const move = (e) => {
    const p = press.current; if (!p || !p.open) return;
    const el = document.elementFromPoint(e.clientX, e.clientY), sw = el && el.closest("[data-tint]");
    if (sw) { p.moved = true; if (sw.dataset.tint !== tint) onTint(sw.dataset.tint); }
  };
  const up = (cancel) => () => {
    const p = press.current; press.current = null;
    if (!p) return;
    clearTimeout(p.timer);
    if (!p.open) return;
    quietUntil.current = performance.now() + 250; // the click that follows this pointerup does not toggle the tool
    setMenu(p.moved && !cancel ? null : (m) => (m ? { ...m, drag: false } : m));
  };
  const closeMenu = useCallback(() => setMenu(null), []);
  return (
    <>
      <button type="button" ref={ref} className={`sk-tool sk-light${coach ? " coach" : ""}`} aria-pressed={active} aria-haspopup="menu" aria-expanded={!!menu} title={t("tools.lightTip")}
        onClick={() => { if (performance.now() > quietUntil.current) onSelect(); quietUntil.current = 0; }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up(false)} onPointerCancel={up(true)}
        onContextMenu={(e) => { e.preventDefault(); if (!press.current) open(false); }}>
        <span className="ic" aria-hidden="true" style={{ filter: bulbFilter(tint) }}>💡</span><small>{t("tools.light1")}<span className="lb2">{t("tools.light2")}</span></small>
      </button>
      {menu && <TintMenu anchor={menu.rect} drag={menu.drag} value={tint} onPick={(v) => { onTint(v); setMenu(null); }} onClose={closeMenu} owner={ref} />}
    </>
  );
}

/** The Light Switch's colour strip, beside the tool rail (above it when the tools sit at the bottom of the screen). */
function TintMenu({ anchor, drag, value, onPick, onClose, owner }) {
  const t = useText();
  const ref = useRef(null), [pos, setPos] = useState({ left: -999, top: -999 });
  useIsoLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, a = anchor;
    let left, top;
    if (a.top > window.innerHeight * 0.55) { left = a.left + a.width / 2 - w / 2; top = a.top - h - 10; } // tools at the bottom: above
    else { left = a.left - w - 12; top = a.top + a.height / 2 - h / 2; if (left < 8) left = a.right + 12; } // the side rail: beside it
    setPos({ left: Math.max(8, Math.min(left, window.innerWidth - w - 8)), top: Math.max(8, Math.min(top, window.innerHeight - h - 8)) });
    if (!drag) { const b = el.querySelector("[aria-checked=true]") || el.querySelector("button"); if (b) b.focus({ preventScroll: true }); }
  }, [anchor, drag]);
  useEffect(() => {
    const out = (e) => { if (ref.current && !ref.current.contains(e.target) && !(owner.current && owner.current.contains(e.target))) onClose(); };
    const esc = (e) => { if (e.key === "Escape") { onClose(); if (owner.current) owner.current.focus(); } };
    document.addEventListener("pointerdown", out, true); document.addEventListener("keydown", esc);
    window.addEventListener("resize", onClose); window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", out, true); document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", onClose); window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose, owner]);
  const onKey = (e) => { // arrow keys move along the strip
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const bs = [...ref.current.querySelectorAll("button")], i = bs.indexOf(document.activeElement);
    bs[(i + d + bs.length) % bs.length].focus();
  };
  return (
    <div className="sk-tints" ref={ref} role="menu" aria-label={t("tools.tintMenu")} style={pos} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      <div className="sk-tints-row">
        {TINT_IDS.map((id) => (
          <button key={id} type="button" role="menuitemradio" aria-checked={value === id} data-tint={id} className="sk-tint" style={{ "--tc": LIGHT_TINTS[id].bulb }}
            aria-label={t(`settings.tint.${id}`)} title={t(`settings.tint.${id}`)} onClick={() => onPick(id)} />
        ))}
      </div>
      <span className="sk-tints-cap" aria-hidden="true">{t(`settings.tint.${value in LIGHT_TINTS ? value : "warm"}`)}</span>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Dossier cards                                                          */
/* ---------------------------------------------------------------------- */
const LensIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="10" cy="10" r="6.2" fill="rgba(255,255,255,.35)" stroke="currentColor" strokeWidth="2.6" /><path d="M14.8 14.8L21 21" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" /><path d="M7.4 8.4A3.6 3.6 0 0 1 10.4 6.6" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity=".8" /></svg>
);
/** ♀ / ♂ beside a suspect (or the victim) when "Show Symbols for Men and Women" is on: drawn, not a font glyph (phone fonts drew ♀ / ♂ oversized and off centre).
 *  On a dossier card it sits under the magnifying glass (.sk-cardw > .sk-gsym), clear of the Polaroid's letter. */
const GENDER_PATH = { f: "M12 4.6a4.6 4.6 0 1 1 0 9.2a4.6 4.6 0 1 1 0-9.2M12 13.8V21M8.6 17.6h6.8", m: "M10 9.2a4.6 4.6 0 1 1 0 9.2a4.6 4.6 0 1 1 0-9.2M13.3 10.5L19 4.8M14.6 4.8H19V9.2" };
const GenderMark = ({ g, inline = false }) => {
  const t = useText();
  if (g !== "m" && g !== "f") return null;
  return (
    <span className={`sk-gsym ${g}${inline ? " inl" : ""}`} role="img" aria-label={t(g === "f" ? "settings.female" : "settings.male")}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={GENDER_PATH[g]} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
};
function SuspectCard({ q, look, color, on, placed, emph, onPick, onInspect, coach, hint, gender = null, hi = false }) {
  const t = useText();
  return (
    <div className="sk-cardw">
      <button type="button" className={`sk-card v${on ? " on" : ""}${placed ? " placed" : ""}${coach ? " coach" : ""}${hi ? " hi" : ""}`} style={{ "--sc": color }} aria-pressed={on} title={hint} onClick={onPick}>
        <span className="sk-photo"><SuspectPolaroid name={q.name} id={q.id} look={look} size={120} placed={placed} /></span>
        <span className="sk-alibi">{emph(q.clue)}</span>
        {placed && <span className="sk-stamp" aria-label={t("game.placed")}>✓</span>}
      </button>
      <button type="button" className="sk-lens" onClick={onInspect} aria-label={t("game.openCard", { name: q.name })} title={t("game.suspectCard")}><LensIcon /></button>
      {gender && <GenderMark g={gender} />}
    </div>
  );
}
function AdowCard({ beach, on, placed, solved, onPick, onInspect, coach, hint, hi = false }) {
  const t = useText();
  const text = t("game.adowHidden"); // the alibi never changes, solved or not (the solved banner says where S. H. Adow was)
  return (
    <div className="sk-cardw">
      <button type="button" className={`sk-card adow v${on ? " on" : ""}${placed ? " placed" : ""}${coach ? " coach" : ""}${hi ? " hi" : ""}`} style={{ "--sc": BRASS }} aria-pressed={on} onClick={onPick}>
        <span className="sk-photo"><AdowPolaroid size={120} beach={beach} /></span>
        <span className="sk-alibi"><b className="sk-nm" style={{ "--nc": BRASS }}>{t("assassin.S")}</b> {text}</span>
        {placed && <span className="sk-stamp" aria-label={t(solved ? "game.caught" : "game.placed")}>✓</span>}
      </button>
      <button type="button" className="sk-lens" onClick={onInspect} aria-label={t("game.openSyndicateCard", { name: t("assassin.S") })} title={t("game.syndicateCard")}><LensIcon /></button>
    </div>
  );
}

/** An extra assassin's card: the shadowed Polaroid and the clue that places them (it names them itself). */
function AssassinCard({ a, color, on, placed, emph, onPick, onInspect, coach, hint, hi = false }) {
  const t = useText(), name = t(`assassin.${a.id}`);
  return (
    <div className="sk-cardw">
      <button type="button" className={`sk-card adow v${on ? " on" : ""}${placed ? " placed" : ""}${coach ? " coach" : ""}${hi ? " hi" : ""}`} style={{ "--sc": color }} aria-pressed={on} title={hint} onClick={onPick}>
        <span className="sk-photo"><AssassinPolaroid who={a.id} size={120} /></span>
        <span className="sk-alibi">{emph(a.clue)}</span>
        {placed && <span className="sk-stamp" aria-label={t("game.placed")}>✓</span>}
      </button>
      <button type="button" className="sk-lens" onClick={onInspect} aria-label={t("game.openSyndicateCard", { name })} title={t("game.syndicateCard")}><LensIcon /></button>
    </div>
  );
}

/** The assassins are no suspects: their sheet is the Syndicate card, in their own dark blue-grey, with their tie's colour as its accent
 *  (S. H. Adow's crimson tie; the other assassins' colours come in as `color`). */
const synAccent = (id, color) => (id === "S" ? ASSASSINS.S.tie : color);
/** The Suspect card (an assassin's: the Syndicate card): the polaroid, the name, what they look like and what they said. A green check shows once they are on the board. */
function SuspectSheet({ q, look, color, placed, emph, beach, onClose, gender = null }) {
  const t = useText();
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  const adow = q.id === "S", hider = adow || !!q.assassin; // an assassin: looks unknown
  const facts = hider ? ["gender", "hair", "glasses", "hat"].map((k) => [t(`look.fact.${k}`), t("game.unknown")]) : lookFacts(look, t);
  const name = hider ? t(`assassin.${q.id}`) : q.name;
  return (
    <div className="sk-modal sk-sheetwrap" role="dialog" aria-modal="true" aria-label={t("game.sheetAria", { name })} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sk-sheet${hider ? " syn" : ""}`} style={hider ? { "--sc": synAccent(q.id, color), "--sci": inkOn(synAccent(q.id, color)) } : { "--sc": color }}>
        <button type="button" className="sk-x" onClick={onClose} aria-label={t("modal.close")}>×</button>
        <div className="sk-sheet-eyebrow">{t(hider ? "game.syndicateCard" : "game.suspectCard")}</div>
        <div className="sk-sheet-body">
          <div className="sk-sheet-pic">
            {adow ? <AdowPolaroid size={168} beach={beach} /> : hider ? <AssassinPolaroid who={q.id} size={168} /> : <SuspectPolaroid name={q.name} id={q.id} look={look} size={168} placed />}
            {placed && <span className="sk-sheet-ok" role="img" aria-label={t("game.placedOnBoard")}>✓</span>}
          </div>
          <div className="sk-sheet-info">
            <h2><span className="sk-letter" style={hider ? undefined : { "--sc": color }}>{q.id}</span> {name}{gender && <GenderMark g={gender} inline />}</h2>
            <p className={`sk-sheet-state${placed ? " ok" : ""}`}>{t(placed ? "game.statePlaced" : "game.stateNotPlaced")}</p>
            <dl className="sk-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </div>
        </div>
        <div className="sk-sheet-clue"><span>{t("game.alibi")}</span>{adow ? <p><b className="sk-nm" style={{ "--nc": BRASS }}>{name}</b> {t("game.adowAlibiHidden")}</p> : <p>{emph(q.clue, true)}</p>}</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  App                                                                    */
/* ---------------------------------------------------------------------- */
/**
 * The game. Extra props used by the shadoku.net wrapper (all optional, the bare game works without them):
 *  - lockCaseMenu    freezes the case picker, the ‹ › arrows and "Next Case" (first-time tutorial)
 *  - forcePuzzleId   opens this case (and keeps it open while set); the choice is not saved as "last case"
 *  - onGameEvent     ({type, id?}) for "select" ({id}) | "note" ({id,r,c,drag}) | "place" ({id,r,c}) | "unplace" | "light" ({r,c,on}) | "cross" ({r,c,on}) | "erase" ({r,c} or {all:true}) | "undo" | "tool" ({tool}) | "hint" ({open}) | "solved" | "view" ({view: "play" | "lab"})
 *  - helpExtra       node, or ({ close }) => node, appended to the "How to play" dialog (e.g. a "Replay tutorial" button)
 *  - fixedCase      the contract cannot be changed from here (no picker, no arrows): the wrapper's contracts page is the only way
 *  - onExit          () => void, the "Back to Contracts" button of the solved banner (with fixedCase)
 *  - exitLabel       that button's text instead of "Back to Contracts →" (a community puzzle goes back to the community list)
 *  - doneExtra       ({ id, close }) => node, drawn under the time in the "Contract Completed!" window (a community puzzle's star rating)
 *  - renderEnvelope  ({ puzzle, label, onPick, variant?, onAccept?, tone? }) => node: the closed envelope of the next contract in the "Contract Completed!" window
 *                    (tone "omega": the finale's red folder after The Uninvited Guests), and (variant "modal", onAccept, onOpen) the Uninvited's
 *                    sealed black envelope in Dossier № 000-OMEGA (the site passes ContractEnvelope; absent = no envelope)
 *  - hideLogo        the wrapper already draws the site header
 *  - onLogo          () => void: the header logo becomes a button (the wrapper's "home")
 *  - menu            [{ key, label, onSelect?, href?, settings?, heading?, sub? }] the ☰ Menu at the top of the tool rail (desktop); `settings: true` opens ⚙ Settings,
 *                    `heading: true` is a group title (click to fold its `sub` entries away), `sub: true` indents an entry under it
 *  - coach           { cells?: [[r,c]], card?: suspectId | "S", tool?: "light"|"eraser"|"undo"|"hint"|"submit" } pulses what the tutorial is pointing at
 *  - dossierCard     node drawn first in the suspects column when the phone is held sideways (the tutorial's lesson card, so the board keeps its height)
 *  - insetY          px of page chrome the wrapper draws above/below the game (top bar, tutorial strip): the game is 100dvh - insetY
 *  - onCaseChange    (puzzleId) => void, fired when the open case changes (the wrapper shows The Master's dossier on "tutorial")
 *  - t               optional (key, vars) => string from the site's i18n; used for the Prop Inspector (prop.<KIND>, propInspector.*). English when absent
 *  - jumpTo          { id, n, fresh? } opens case `id` (bump `n` to jump again to the same id); `fresh` also wipes its saved board (the tutorial): used by "Enter Case #1 →"
 */
const GearIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)" /></svg>
);

/** ☰ Menu at the top of the tool rail (desktop /play, where the site header is gone): the site's pages, sign-in and ⚙ Settings. */
function RailMenu({ items, onSettings }) {
  const t = useText();
  const [open, setOpen] = useState(false), ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const out = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", out); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc); };
  }, [open]);
  const pick = (it) => { setOpen(false); if (it.settings) onSettings(); else if (it.onSelect) it.onSelect(); };
  const [opened, setOpened] = useState(() => { try { return new Set(JSON.parse(window.localStorage.getItem("shadoku-menu-open") || "[]")); } catch { return new Set(); } }); // the groups the player opened: all start folded (shared with the site's ☰ menu)
  const folded = { has: (k) => !opened.has(k) };
  const fold = (k) => setOpened((f) => {
    const n = new Set(f);
    if (n.has(k)) n.delete(k); else n.add(k);
    try { window.localStorage.setItem("shadoku-menu-open", JSON.stringify([...n])); } catch { /* private mode */ }
    return n;
  });
  const foldKey = (it) => (it.key === "contracts" ? "pContracts" : it.key); // the site menu calls the Contracts group "pContracts"
  let group = null; // the heading the entry under it belongs to
  return (
    <div className="sk-railmenu" ref={ref}>
      <button type="button" className="sk-railmenu-btn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
        <span>{t("nav.menu")}</span>
      </button>
      {open && (
        <div className="sk-railmenu-list" role="menu" aria-label={t("nav.menu")}>
          {items.map((it) => {
            if (it.heading) group = foldKey(it); else if (!it.sub) group = null;
            return (it.heading
            ? <button key={it.key} type="button" className="sk-railmenu-h" aria-expanded={!folded.has(group)} onClick={() => fold(foldKey(it))}>{it.label}<span className="fold" aria-hidden="true" /></button>
            : it.sub && group && folded.has(group) ? null // its group is folded shut
            : it.href
              ? <a key={it.key} role="menuitem" className={it.sub ? "sub" : undefined} href={it.href} onClick={() => setOpen(false)}>{it.label}</a>
              : <button key={it.key} type="button" role="menuitem" className={it.sub ? "sub" : undefined} onClick={() => pick(it)}>{it.label}</button>);
          })}
        </div>
      )}
    </div>
  );
}

/** The right-click menu of a tile (⚙ "Right-Click on a Tile": Menu): Light or X, at the pointer. A click elsewhere, Esc, a scroll or
 *  a resize closes it. `lit` / `crossed`: the tile's marks now (the choice toggles them, as the tools do). */
function TileMenu({ x, y, lit, crossed, onPick, onClose }) {
  const t = useText();
  const ref = useRef(null), [pos, setPos] = useState({ left: x, top: y });
  useIsoLayoutEffect(() => { // kept inside the window
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(y, window.innerHeight - h - 8)) });
    const first = el.querySelector("button"); if (first) first.focus({ preventScroll: true });
  }, [x, y]);
  useEffect(() => {
    const out = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", out, true); document.addEventListener("keydown", esc);
    window.addEventListener("resize", onClose); window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", out, true); document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", onClose); window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);
  return (
    <div className="sk-ctx" ref={ref} role="menu" aria-label={t("game.ctx.title")} style={pos} onContextMenu={(e) => e.preventDefault()}>
      <button type="button" role="menuitemcheckbox" aria-checked={lit} onClick={() => onPick("light")}><span aria-hidden="true">💡</span>{t("game.ctx.light")}</button>
      <button type="button" role="menuitemcheckbox" aria-checked={crossed} onClick={() => onPick("cross")}><span aria-hidden="true">❌</span>{t("game.ctx.cross")}</button>
    </div>
  );
}

/** ⚙ Settings: every option is saved at once (localStorage "shadoku-settings"). `langPicker` is the site's language selector, when there is one. */
/** The "Contract Completed!" pop-up: a modal over the game (Esc, the × or a click outside closes it; the solved banner stays behind). */
function DoneWindow({ label, closeLabel, onClose, children }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="sk-done" role="dialog" aria-modal="true" aria-label={label} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sk-done-card">
        <button type="button" className="sk-done-x" onClick={onClose} aria-label={closeLabel}>×</button>
        {children}
      </div>
    </div>
  );
}

/** `hover` false (a touch screen with no mouse): the options that only act on mouse hover are left out. */
function SettingsPanel({ s, set, reset, onClose, langPicker = null, sample, hover = true }) {
  const t = useText();
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  const sw = (k, name, children = null) => (
    <div className="sk-set-row" key={k}>
      <label className="sk-set-sw">
        <span className="sk-set-txt"><b>{t(`settings.${name}.title`)}</b><small>{t(`settings.${name}.desc`)}</small></span>
        <input type="checkbox" role="switch" checked={!!s[k]} onChange={(e) => set({ [k]: e.target.checked })} /><i aria-hidden="true" />
      </label>
      {children}
    </div>
  );
  const sub = (k, name, off) => (
    <label className={`sk-set-sub${off ? " off" : ""}`} key={k}>
      <input type="checkbox" checked={!!s[k]} disabled={off} onChange={(e) => set({ [k]: e.target.checked })} />
      <span>{t(`settings.${name}`)} <small>({t(`settings.${name}Desc`)})</small></span>
    </label>
  );
  const slider = (k, name, min, max, step, lo, hi, val = null) => (
    <div className="sk-set-row sk-set-sl" key={k}>
      <b>{t(`settings.${name}`)}</b>
      <div>{lo && <small>{lo}</small>}<input type="range" min={min} max={max} step={step} value={s[k]} onChange={(e) => set({ [k]: +e.target.value })} aria-label={t(`settings.${name}`)} />{(val || hi) && <small className="v">{val || hi}</small>}</div>
    </div>
  );
  const style = (v, name, pic) => (
    <button type="button" className={`sk-set-opt${s.tokenStyle === v ? " on" : ""}`} aria-pressed={s.tokenStyle === v} onClick={() => set({ tokenStyle: v })}>
      <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">{pic}</svg><span>{t(`settings.tokenStyle.${name}`)}</span>
    </button>
  );
  const tints = (k, name) => (
    <div className="sk-set-row" key={k}>
      <b>{t(`settings.${name}.title`)}</b>
      <div className="sk-set-opts" role="radiogroup" aria-label={t(`settings.${name}.title`)}>
        {TINT_IDS.map((v) => (
          <button key={v} type="button" role="radio" aria-checked={s[k] === v} className={`sk-set-opt sk-set-tint${s[k] === v ? " on" : ""}`} onClick={() => set({ [k]: v })}>
            <span className="sk-set-dot" style={{ "--tc": LIGHT_TINTS[v].bulb }} aria-hidden="true" /><span>{t(`settings.tint.${v}`)}</span>
          </button>
        ))}
      </div>
      <small>{t(`settings.${name}.desc`)}</small>
    </div>
  );
  const [tab, setTab] = useState("general");
  const TABS = ["general", "clues", "board", "suspects"];
  const onTabKey = (e) => { // arrow keys move between the tabs
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const rtl = document.dir === "rtl" ? -1 : 1, next = TABS[(TABS.indexOf(tab) + d * rtl + TABS.length) % TABS.length];
    setTab(next);
    const el = document.getElementById(`sk-settab-${next}`); if (el) el.focus();
  };
  return (
    <div className="sk-modal sk-setwrap" role="dialog" aria-modal="true" aria-label={t("settings.title")} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sk-set">
        <div className="sk-set-h"><h2>{t("settings.title")}</h2><button type="button" className="sk-set-x" onClick={onClose} aria-label={t("settings.close")}>×</button></div>
        <div className="sk-set-tabs" role="tablist" aria-label={t("settings.title")} onKeyDown={onTabKey}>
          {TABS.map((k) => (
            <button key={k} id={`sk-settab-${k}`} type="button" role="tab" aria-selected={tab === k} aria-controls="sk-setpanel" tabIndex={tab === k ? 0 : -1} onClick={() => setTab(k)}>{t(`settings.tab.${k}`)}</button>
          ))}
        </div>
        <div className="sk-set-body" id="sk-setpanel" role="tabpanel" aria-labelledby={`sk-settab-${tab}`}>
          {tab === "general" && (<>
            {langPicker && <div className="sk-set-row sk-set-lang"><b>{t("settings.language")}</b>{langPicker}</div>}
            {sw("timer", "timer")}
            {sw("autoLight", "autoLight")}
            {sw("preventLight", "preventLight")}
            {hover && (
              <div className="sk-set-row">
                <b>{t("settings.rightClick.title")}</b>
                <div className="sk-set-opts">
                  {[["light", "💡"], ["cross", "❌"], ["double", <>💡<sub>1</sub>❌<sub>2</sub></>], ["menu", "💡❌"]].map(([v, ic]) => (
                    <button key={v} type="button" className={`sk-set-opt${s.rightClick === v ? " on" : ""}`} aria-pressed={s.rightClick === v} onClick={() => set({ rightClick: v })}>
                      <span className="sk-set-ic" aria-hidden="true">{ic}</span><span>{t(`settings.rightClick.${v}`)}</span>
                    </button>
                  ))}
                </div>
                <small>{t("settings.rightClick.desc")}</small>
              </div>
            )}
          </>)}
          {tab === "clues" && (<>
            {hover && sw("kw", "kw", <div className="sk-set-subs">{[["kwCore", "kw.core"], ["kwObjects", "kw.objects"], ["kwRooms", "kw.rooms"], ["kwPeople", "kw.people"], ["kwLines", "kw.lines"]].map(([k, n]) => sub(k, n, !s.kw))}</div>)}
            {sw("kwSelected", "kwSelected")}
            {sw("plain", "plain")}
          </>)}
          {tab === "board" && (<>
            {tints("lightTint", "lightTint")}
            {tints("myTint", "myTint")}
            {sw("coords", "coords")}
            {sw("autoScale", "autoScale")}
            {hover && sw("roomHover", "roomHover")}
            {slider("roomLabel", "roomLabel", 10, 20, 1, null, null, t("settings.px", { n: s.roomLabel }))}
            {slider("objSize", "objSize", -0.15, 0.15, 0.01, "−15%", "+15%")}
            {slider("walls", "walls", 0.6, 1.6, 0.05, t("settings.wallsThin"), t("settings.wallsThick"))}
          </>)}
          {tab === "suspects" && (<>
            {sw("selHi", "selHi")}
            {sw("portrait", "portrait")}
            {sw("gender", "gender")}
            {sw("symbols", "symbols", s.symbols && (
              <div className="sk-set-symrow" role="group" aria-label={t("game.symbols")}>
                {SYM_IDS.map((id) => {
                  const on = chosenSyms(s).includes(id), nm = t(`game.sym.${NOTE_SYMBOLS[id].shape}`);
                  return (
                    <button key={id} type="button" className={`sk-set-sym${on ? " on" : ""}`} aria-pressed={on} title={nm} aria-label={nm}
                      onClick={() => set({ symbolSet: SYM_IDS.filter((x) => (x === id ? !on : chosenSyms(s).includes(x))).join("") })}>
                      <svg viewBox="0 0 40 40" aria-hidden="true"><SymShape id={id} cx={20} cy={20} r={13} fill={NOTE_SYMBOLS[id].color} stroke={INK} strokeWidth="2.6" /></svg>
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="sk-set-row">
              <b>{t("settings.tokenStyle.title")}</b>
              <div className="sk-set-opts">
                {style("letter", "letter", <LetterToken cx={24} cy={24} id={sample.id} fill={sample.color} ink={inkOn(sample.color)} ring={INK} />)}
                {style("portrait", "portrait", sample.look ? <TokenAvatar cx={24} cy={24} r={18} look={sample.look} id={sample.id} uid="settings" /> : null)}
              </div>
              <small>{t("settings.tokenStyle.desc")}</small>
            </div>
          </>)}
        </div>
        <div className="sk-set-f"><button type="button" className="sk-set-reset" onClick={reset}>{t("settings.reset")}</button><button type="button" className="sk-set-done" onClick={onClose}>{t("settings.done")}</button></div>
      </div>
    </div>
  );
}

export default function ShadokuGame(props) {
  const ctxT = useText(), t = props.t || ctxT;
  return <TextContext.Provider value={t}><GameScreen {...props} t={t} /></TextContext.Provider>;
}
function GameScreen({ puzzles: puzzlesProp = PUZZLES, logoSrc, lab: Lab = null, lockCaseMenu = false, forcePuzzleId = null, onGameEvent = null, helpExtra = null, insetY = 0, onCaseChange = null, jumpTo = null, coach = null, fixedCase = false, onExit = null, renderEnvelope = null, hideLogo = false, onLogo = null, menu = null, langPicker = null, onLaunch = null, headEnd = null, dossierCard = null, doneExtra = null, exitLabel = null, t }) {
  const puzzles = useMemo(() => normalizePuzzles(puzzlesProp), [puzzlesProp]);
  const heads = useMemo(() => puzzles.map((q) => localizeHead(q, trOf(t))), [puzzles, t]); // title + difficulty in the active language, for the picker / title bar
  const [caseIdx, setCaseIdx] = useState(() => {
    if (forcePuzzleId) { const f = normalizePuzzles(puzzlesProp).findIndex((q) => q.id === forcePuzzleId); if (f >= 0) return f; }
    if (jumpTo && jumpTo.id) { const j = normalizePuzzles(puzzlesProp).findIndex((q) => q.id === jumpTo.id); if (j >= 0) return j; } // a deep link such as /play/the-art-of-the-ghost
    try { return +localStorage.getItem(CASE_KEY) || 0; } catch (e) { return 0; }
  });
  const [all, setAll] = useState(loadAll);
  const [undo, setUndo] = useState({});
  const [redo, setRedo] = useState({}); // per case: the boards Undo took back, for Redo
  const [tool, setTool] = useState("suspect");
  const [active, setActive] = useState("A");
  const [hover, setHover] = useState(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [flash, setFlash] = useState(0);
  const [help, setHelp] = useState(false);
  const [sheet, setSheet] = useState(null); // id of the suspect whose card is open
  const [view, setView] = useState("play");
  const [zoom, setZoom] = useState(1);
  const [celebrate, setCelebrate] = useState(null); // the case just solved by playing: it gets the "Contract Completed!" window instead of the solved banner
  const [doneClosed, setDoneClosed] = useState(null); // …and once that window is dismissed, nothing comes back in its place
  const [shared, setShared] = useState(false); // the share link was copied (the window shows "Link copied")
  const [gateId, setGateId] = useState(null); // the case whose "already solved" gate was answered (or that was solved just now): that case is not gated
  const short = useMediaQuery(SHORT_MQ);
  const splitKey = short ? SPLIT_KEY_SHORT : SPLIT_KEY, splitMin = short ? SPLIT_MIN_SHORT : SPLIT_MIN, dossierMin = short ? DOSSIER_MIN_SHORT : DOSSIER_MIN;
  const readSplit = (k, min) => { try { const v = +localStorage.getItem(k); return v >= min ? v : null; } catch (e) { return null; } };
  const [splits, setSplits] = useState(() => ({ desk: readSplit(SPLIT_KEY, SPLIT_MIN), short: readSplit(SPLIT_KEY_SHORT, SPLIT_MIN_SHORT) })); // stage width (px) per layout · null = automatic
  const split = short ? splits.short : splits.desk;
  const setSplit = (w) => setSplits((o) => ({ ...o, [short ? "short" : "desk"]: w }));
  const [dragging, setDragging] = useState(false); // the divider is being dragged
  const [holdCell, setHoldCell] = useState(null); // press-and-hold in progress: { r, c, color, t }
  const [verdict, setVerdict] = useState(null); // result of a wrong Submit: { wrong, total }
  const [tip, setTip] = useState(null); // Prop Inspector opened by a tap: { r, c, kind, cls, n }
  const [tipPos, setTipPos] = useState(null);
  const [inspectOpen, setInspectOpen] = useState(false); // the Inspect panel: this puzzle's props and what each one does
  const [hoverTips, setHoverTips] = useState(() => { try { return localStorage.getItem(HOVER_KEY) !== "0"; } catch (e) { return true; } }); // the prop badge on hover / tap
  const [settings, setSettings] = useState(loadSettings); // the ⚙ Settings panel's choices (DEFAULT_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ctx, setCtx] = useState(null); // the right-click menu (⚙ "Right-Click on a Tile": Menu): { r, c, x, y }
  const headRef = useRef(null), [headWide, setHeadWide] = useState(false); // desktop: logo, contract and timer fit in one row
  useIsoLayoutEffect(() => {
    const el = headRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setHeadWide(el.clientWidth >= (window.matchMedia && window.matchMedia(SHORT_MQ).matches ? 480 : 520)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [umbra, setUmbra] = useState(null); // The Umbra Conspiracy modal open over the game: "board" | "sanctum" | null
  const [clueHi, setClueHi] = useState(null); // a hovered clue word's board highlight: "pr:SAFE" | "rm:2" | "nm:A" | "row:3" | "col:2"
  const [kwTip, setKwTip] = useState(null); // a hovered core keyword's tooltip: { c, left, top }
  const [pressing, setPressing] = useState(false); // a pointer is down on the board: hover tooltips stay out of the way of a drag
  const mobile = useMediaQuery(MOBILE_MQ);
  const touchUi = useMediaQuery(TOUCH_MQ);
  const canHover = useMediaQuery(HOVER_MQ);
  const tipRef = useRef(null);
  const pinchRef = useRef(null), abortRef = useRef(null), zoomRef = useRef(1); // a two-finger pinch on the board · its stroke breaker · the zoom, for the native listeners
  const live = useRef(all), stroke = useRef(null), holdTimer = useRef(null), showTimer = useRef(null), undoRef = useRef(null), redoRef = useRef(null);
  const rootRef = useRef(null), ovlRef = useRef(null), vpRef = useRef(null), zoomAnchor = useRef(null), grabRef = useRef(0);
  const lastRight = useRef(null); // ⚙ right-click "Light, double: X": the last right-click's tile, time and stroke

  const forcedIdx = forcePuzzleId ? puzzles.findIndex((q) => q.id === forcePuzzleId) : -1;
  const idx = forcedIdx >= 0 ? forcedIdx : Math.max(0, Math.min(caseIdx, puzzles.length - 1));
  const evRef = useRef(onGameEvent), onCaseChangeRef = useRef(onCaseChange);
  evRef.current = onGameEvent;
  onCaseChangeRef.current = onCaseChange;
  const coachCells = coach && coach.cells && coach.cells.length ? coach.cells : null, coachCard = coach ? coach.card || null : null, coachTool = coach ? coach.tool || null : null;
  const emit = (type, extra) => { try { if (evRef.current) evRef.current({ type, ...extra }); } catch (e) { /* the wrapper must never break the game */ } };
  const base = puzzles[idx];
  const { puzzle: cast, looks } = useMemo(() => getCastForPuzzle(base, 0), [base]); // cast from the English fields (the clue words decide which looks are locked)
  // "Plain directions": ui.plain.<KEY> (e.g. ui.plain.ATOM.NORTH_OF "was above {other}") stands in for the compass templates
  // (a language without its own ui.plain.* keys keeps its translated compass wording rather than an English plain phrase)
  const tCase = useMemo(() => (settings.plain ? (k, v) => {
    const pk = `ui.plain.${k}`, x = t(pk, v), base = t(k, v);
    const untranslated = x === tEn(pk, v) && base !== tEn(k, v);
    return x && x !== pk && !untranslated ? x : base;
  } : t), [t, settings.plain]);
  /* "the fireplace" (PROP.<ID>.the) only from a locale that has it: one that still falls back to the English "the" keeps its own "a" form */
  const tClue = useMemo(() => (k, v) => {
    if (/^PROP\.\w+\.the$/.test(k)) { const a = k.slice(0, -3) + "a"; if (tCase(k) === tEn(k) && tCase(a) !== tEn(a)) return k; }
    return tCase(k, v);
  }, [tCase]);
  const p = useMemo(() => localizeCase(cast, trOf(tClue)), [cast, tClue]);
  const geo = useMemo(() => buildGeometry(p), [p]);
  const st = useMemo(() => cleanCase(p, geo, normCase(all[p.id])), [all, p, geo]);
  const closeCtx = useCallback(() => setCtx(null), []);
  useEffect(() => setCtx(null), [p.id]);
  const caseNow = () => cleanCase(p, geo, normCase(live.current[p.id]));
  const suspects = p.suspects;
  const colorOf = useCallback((id) => (id === "S" ? BRASS : isSym(id) ? NOTE_SYMBOLS[id].color : ASSASSINS[id] && (p.assassins || []).some((a) => a.id === id) ? ASSASSINS[id].tie
    : (looks[id] && looks[id].back) || SUSPECT_COLORS[Math.max(0, suspects.findIndex((q) => q.id === id)) % SUSPECT_COLORS.length]), [looks, suspects, p.assassins]);
  const emph = useMemo(() => buildEmphasis(p, colorOf, t), [p, colorOf, t]);

  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current); }, []);
  useEffect(() => { // another tab saved, or a sync brought another device's boards: take them (every move here is saved at once, so nothing of this tab's is lost)
    const h = (e) => { if (e.type === PROGRESS_EVENT || e.key === STORE_KEY) { live.current = loadAll(); setAll(live.current); } };
    window.addEventListener("storage", h);
    window.addEventListener(PROGRESS_EVENT, h);
    return () => { window.removeEventListener("storage", h); window.removeEventListener(PROGRESS_EVENT, h); };
  }, []);
  const [autoPicked, setAutoPicked] = useState(true); // the first suspect is selected for the player when a case opens: tapping that card confirms it, it does not deselect
  useEffect(() => {
    setActive(p.suspects[0].id); setTool("suspect"); setAutoPicked(true); setHintOpen(false); setHover(null); setZoom(1); zoomRef.current = 1; setVerdict(null); setTip(null); setPressing(false); setInspectOpen(false); setGateId(null);
    stroke.current = null; cancelHold();
    if (!forcePuzzleId) { try { localStorage.setItem(CASE_KEY, String(idx)); } catch (e) { /* ignore */ } }
    try { if (onCaseChangeRef.current) onCaseChangeRef.current(p.id); } catch (e) { /* the wrapper must never break the game */ }
  }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [timerEpoch, setTimerEpoch] = useState(0);
  const jumpKey = jumpTo ? `${jumpTo.id}|${jumpTo.n || 0}` : "";
  useEffect(() => {
    if (!jumpTo) return;
    const j = puzzles.findIndex((q) => q.id === jumpTo.id);
    if (j >= 0) setCaseIdx(j);
    if (j >= 0 && jumpTo.fresh) { // the tutorial always starts on a clean board
      const seeded = normCase(undefined);
      (jumpTo.seedNotes || []).forEach(([r, c, letters]) => { seeded.notes[key(r, c)] = letters; }); // e.g. the inspector's scribbles on the tutorial board
      Object.entries(jumpTo.seedTokens || {}).forEach(([id, at]) => { seeded.tokens[id] = at; }); // e.g. S. H. Adow, standing in the dark when the tutorial opens
      live.current = { ...live.current, [jumpTo.id]: seeded };
      setAll(live.current); saveCase(jumpTo.id, seeded);
      setUndo((u) => ({ ...u, [jumpTo.id]: [] })); setRedo((u) => ({ ...u, [jumpTo.id]: [] }));
      setHintOpen(false); setTool("suspect");
      writeTime(jumpTo.id, 0); setTimerEpoch((n) => n + 1); // a fresh run of the tutorial also restarts its clock
    }
  }, [jumpKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Apply `fn` to this case. `push` saves the previous board on the Undo stack. Returns whether anything changed. */
  const mutate = (fn, push = true) => {
    let cur, next;
    try { cur = caseNow(); next = fn(cur); } catch (err) { // a damaged save must never freeze the board: start this case over instead
      live.current = { ...live.current, [p.id]: normCase(undefined) };
      cur = caseNow(); next = fn(cur);
    }
    if (next === cur) return false;
    if (push) { setUndo((u) => ({ ...u, [p.id]: [...(u[p.id] || []), snap(cur)].slice(-120) })); setRedo((u) => (u[p.id] && u[p.id].length ? { ...u, [p.id]: [] } : u)); } // a new move drops the undone ones
    if (cur.done && next.tokens !== cur.tokens) next = { ...next, done: false }; // editing the placements re-opens the case
    setVerdict(null);
    live.current = { ...live.current, [p.id]: next };
    setAll(live.current); saveCase(p.id, next);
    return true;
  };
  useEffect(() => { emit("tool", { tool }); }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { emit("hint", { open: hintOpen }); }, [hintOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { emit("view", { view }); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  const stack = undo[p.id] || [], redoStack = redo[p.id] || [];
  const doUndo = () => {
    if (!stack.length) return;
    emit("undo", {});
    const prev = stack[stack.length - 1];
    const now = snap(caseNow()); // taken now: a state updater runs later, after mutate() has changed the board
    setUndo((u) => ({ ...u, [p.id]: (u[p.id] || []).slice(0, -1) }));
    setRedo((u) => ({ ...u, [p.id]: [...(u[p.id] || []), now] }));
    mutate((cs) => ({ ...cs, ...prev }), false);
  };
  const doRedo = () => {
    if (!redoStack.length) return;
    emit("redo", {});
    const nxt = redoStack[redoStack.length - 1];
    const now = snap(caseNow());
    setRedo((u) => ({ ...u, [p.id]: (u[p.id] || []).slice(0, -1) }));
    setUndo((u) => ({ ...u, [p.id]: [...(u[p.id] || []), now] }));
    mutate((cs) => ({ ...cs, ...nxt }), false);
  };
  undoRef.current = doUndo; redoRef.current = doRedo;
  useEffect(() => {
    const h = (e) => {
      const k = e.key.toLowerCase();
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undoRef.current(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redoRef.current(); } // Ctrl+Y · Ctrl/⌘+Shift+Z
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  /* The tutorial keeps the classic flow (its steps wait for "select" / "tool" events); everywhere else a second tap on the selected
     card drops to the neutral "inspect" state (tool "none"), and so does a second tap on the Light Switch / Eraser on touch screens. */
  const legacy = p.id === TUTORIAL_ID || !!coach;
  const offTool = touchUi && !legacy ? "none" : "suspect";
  const pick = (id) => {
    setTip(null);
    const auto = autoPicked; setAutoPicked(false);
    if (!legacy && tool === "suspect" && active === id && !auto) { setTool("none"); cancelHold(); return; }
    setActive(id); setTool("suspect"); cancelHold(); emit("select", { id });
  };
  useEffect(() => { if (tool !== "suspect") setAutoPicked(false); }, [tool]);
  useEffect(() => { if (isSym(active) && (!settings.symbols || !chosenSyms(settings).includes(active))) setActive(p.suspects[0].id); }, [settings.symbols, settings.symbolSet]); // eslint-disable-line react-hooks/exhaustive-deps -- the palette was switched off, or that symbol dropped from it
  const tapAgain = (id) => (!legacy && tool === "suspect" && active === id && !autoPicked ? t("game.tapAgain") : undefined); // the card's "Tap again to deselect"

  /** One tap with a suspect: a tile that has a token is left alone (use the Eraser) · otherwise toggle this suspect's note.
   *  Placing a suspect is a press-and-hold (see `startHold`), the only way to place, so a tap can never place by accident. */
  const tap = (r, c) => {
    if (!geo.occupiable(r, c)) return;
    const k = key(r, c), id = active, cs = caseNow(), other = tokenIdAt(cs, r, c);
    if (other || cs.syms[k]) return; // a placed scapegoat or note symbol is not touched by a tap: only the Eraser (or holding the same symbol) takes it off
    if (mutate((x) => withNote(x, k, id, "toggle"))) emit("note", { id, r, c, drag: false });
  };
  /** Put the active suspect on a tile (their note there is cleared). */
  const place = (r, c) => {
    if (!geo.occupiable(r, c)) return;
    const k = key(r, c), id = active, other = tokenIdAt(caseNow(), r, c);
    if (isSym(id)) { // a note symbol is held onto the tile (or off it again): a mark for the player, never a placement
      if (!other && mutate((x) => withSym(x, k, id))) emit("mark", { id, r, c });
      try { if (navigator.vibrate) navigator.vibrate(18); } catch (e) { /* ignore */ }
      return;
    }
    if (other === id) return;
    // notes on the tile itself stay stored (hidden while placed) and come back if the suspect is lifted; a scapegoat's sightlines are cleared
    if (mutate((x) => (hidersOf(p).includes(id) ? withToken(x, id, r, c) : withSightCleared(withToken(x, id, r, c), geo, r, c, autoLight)))) emit("place", { id, r, c });
    try { if (navigator.vibrate) navigator.vibrate(18); } catch (e) { /* ignore */ }
  };
  const cancelHold = () => { if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null; } if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; } setHoldCell((h) => (h ? null : h)); };
  const startHold = (r, c) => {
    cancelHold();
    if (!geo.occupiable(r, c) || tokenIdAt(caseNow(), r, c)) return; // a tile that already has a token is just tapped
    const col = colorOf(active);
    showTimer.current = setTimeout(() => { showTimer.current = null; setHoldCell({ r, c, color: col, t: Date.now() }); }, HOLD_SHOW_MS); // a plain tap never shows the ring
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null; setHoldCell(null);
      const s = stroke.current;
      if (s && !s.drag) { s.placed = true; place(r, c); }
    }, HOLD_MS);
  };
  /** Paint one tile during a stroke (notes, light switches, X marks or eraser). The whole stroke is one Undo step. */
  const paint = (r, c) => {
    const s = stroke.current, k = key(r, c);
    if (!s || s.tool === "none") return; // the neutral inspect state never marks the board
    const anyTile = geo.inside(r, c) && !geo.isVoid(r, c); // "Prevent Light on Non-Occupiable Tiles" off: the Light Switch may mark props too (the Eraser can always clear them)
    if (!geo.occupiable(r, c) && !(anyTile && (s.tool === "eraser" || (s.tool === "light" && !settings.preventLight)))) return;
    let changed;
    if (s.tool === "light") changed = mutate((x) => withLight(x, k, s.mode === "on"), !s.pushed);
    else if (s.tool === "cross") changed = mutate((x) => withCross(x, k, s.mode === "on"), !s.pushed);
    else if (s.tool === "eraser") changed = mutate((x) => erased(x, r, c), !s.pushed);
    else { const cs = caseNow(); if (tokenIdAt(cs, r, c) || notesHidden(cs, k)) return; changed = mutate((x) => withNote(x, k, s.id, s.mode), !s.pushed); } // no hidden notes under an X or a symbol
    if (changed) emit(s.tool === "light" ? "light" : s.tool === "cross" ? "cross" : s.tool === "eraser" ? "erase" : "note", { id: s.id, r, c, drag: !!s.drag, on: s.mode === "on" || s.mode === "add" });
    s.pushed = s.pushed || changed;
  };
  /** `use`: the tool for this stroke instead of the selected one (a right-click's Light or X). */
  const beginStroke = ([r, c], e, use = tool) => {
    const cs = caseNow(), k = key(r, c);
    // zoomed in on a touch screen, a finger that moves is panning the board: nothing is marked until it lifts without moving
    const panning = zoom > 1 && !!e && !!e.pointerType && e.pointerType !== "mouse";
    stroke.current = {
      tool: use, id: active, start: [r, c], last: [r, c], drag: false, pushed: false, x: e ? e.clientX : 0, y: e ? e.clientY : 0, panning, pid: e ? e.pointerId : null,
      mode: use === "light" ? (cs.lights[k] ? "off" : "on") : use === "cross" ? (cs.crosses[k] ? "off" : "on") : (cs.notes[k] || "").includes(active) ? "remove" : "add",
    };
    if (use === "suspect") startHold(r, c);
    else if (!panning) paint(r, c); // light switch, X and eraser act on press
  };
  /** Inspector class of a prop id in this case: "tall" | "perch" | "short" | "low" | "corpse" (null for bare floor, VOID and unknown ids). */
  const inspectCls = (kind) => (kind === "CORPSE" ? "corpse" : (geo.classOfKind(kind) || "").toLowerCase() || null);
  /** What the Prop Inspector can say about a tile: its prop's class (case propClasses first) or the corpse (null for bare floor and void). */
  const inspectAt = (r, c) => {
    const kind = geo.kind(r, c);
    if (!kind || kind === "VOID") return null;
    const cls = inspectCls(kind);
    return cls ? { r, c, kind, cls } : null;
  };
  /** A second finger came down: the first finger's press was the start of a pinch, so whatever it marked is taken back. */
  const abortStroke = () => {
    const s = stroke.current;
    cancelHold(); stroke.current = null; setPressing(false);
    if (s && s.pushed) { undoRef.current(); setRedo((u) => (u[p.id] && u[p.id].length ? { ...u, [p.id]: u[p.id].slice(0, -1) } : u)); }
  };
  abortRef.current = abortStroke;
  const onStroke = (phase, cell, e) => {
    if (pinchRef.current) { if (phase !== "move") setPressing(false); return; } // two fingers: the board zooms, nothing is marked
    if (phase === "down") {
      const s0 = stroke.current;
      if (s0 && e && e.pointerType === "touch" && s0.pid !== e.pointerId) { pinchRef.current = { pending: true }; abortStroke(); return; }
      setCtx(null);
      if (e && e.button === 2) { // a mouse right-click (⚙ "Right-Click on a Tile"): light or X the tile (a drag paints on), or ask which
        if (s0) return; // the left button is already marking
        if (settings.rightClick === "menu") { setTip(null); setCtx({ r: cell[0], c: cell[1], x: e.clientX, y: e.clientY }); return; }
        let use = settings.rightClick === "cross" ? "cross" : "light";
        if (settings.rightClick === "double") { // a right-click lights the tile at once; a second one on the same tile soon after takes that back and marks an X
          const lr = lastRight.current, now = Date.now();
          lastRight.current = null;
          if (lr && lr.k === key(...cell) && now - lr.t < DBL_RIGHT_MS && !lr.s.drag) {
            if (lr.s.pushed) { undoRef.current(); setRedo((u) => (u[p.id] && u[p.id].length ? { ...u, [p.id]: u[p.id].slice(0, -1) } : u)); }
            use = "cross";
          }
        }
        setPressing(true); setTip(null); beginStroke(cell, e, use);
        if (settings.rightClick === "double" && use === "light") lastRight.current = { k: key(...cell), t: Date.now(), s: stroke.current };
        return;
      }
      setPressing(true); setTip(null); beginStroke(cell, e); return;
    }
    if (phase === "up" || phase === "cancel") setPressing(false);
    const s = stroke.current;
    if (!s) return;
    if (phase === "move") {
      if (s.placed) return; // the suspect is down: ignore the rest of this press
      if (s.panning) { // a pan: once past the jitter guard it is no longer a tap or a hold
        if (!s.drag && e && Math.hypot(e.clientX - s.x, e.clientY - s.y) >= 10) { s.drag = true; cancelHold(); }
        return;
      }
      if (!cell || sameCell(s.last, cell[0], cell[1])) return;
      if (s.tool === "suspect" && !s.drag) {
        if (e && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 10) return; // jitter guard: a wobbly tap is still a tap
        s.drag = true; cancelHold(); paint(...s.start);
      }
      s.drag = true;
      lineCells(s.last, cell).forEach(([r, c]) => paint(r, c));
      s.last = cell;
      return;
    }
    if (phase === "up" && !s.drag && !s.placed && cell && sameCell(s.start, cell[0], cell[1])) {
      if (s.tool === "suspect") tap(cell[0], cell[1]);
      else if (s.panning) paint(cell[0], cell[1]); // the light switch / eraser tap held back while zoomed
      if (e && e.pointerType && e.pointerType !== "mouse") { // touch / pen: props nobody stands on (tall, short) and the corpse always answer; occupiable ones (low, perch) only in the neutral state
        const info = inspectAt(cell[0], cell[1]);
        if (hoverTips && info && ((info.cls !== "low" && info.cls !== "perch") || s.tool === "none")) setTip({ ...info, n: Date.now() });
      }
    }
    cancelHold();
    stroke.current = null;
  };
  const onKey = (r, c, e) => { if (tool === "suspect") { if (e && e.shiftKey) place(r, c); else tap(r, c); } else { beginStroke([r, c]); stroke.current = null; } };
  const onHover = (c) => setHover((h) => ((!h && !c) || (h && c && h[0] === c[0] && h[1] === c[1]) ? h : c));
  const clearAll = () => { mutate(cleared); setFlash(Date.now()); emit("erase", { all: true }); };

  /* Prop Inspector tooltip: mouse hover (every prop) or a touch tap (rules above). */
  const tr = (k, fb, vars) => { const v = t(k, vars); return v && v !== k ? v : fb; }; // the locale's text, else the in-code English
  const propName = (k) => (k === "CORPSE" && p.id === UMBRA_FINALE ? tr("prop.CORPSE.master", "Master U. M. Bra (Corpse)")
    : k === "CORPSE" && p.id === UMBRA_HARD ? tr("prop.CORPSE.second", "N. O. Ir (Corpse)") : tr(`prop.${k}`, LABEL[k] || k));
  const tipTag = (cls) => tr(`propInspector.${cls}Tag`, INSPECTOR_EN[`${cls}Tag`] || INSPECTOR_EN.lowTag);
  const viewText = (blocks) => tr(blocks ? "propInspector.blocks" : "propInspector.passes", blocks ? INSPECTOR_EN.blocks : INSPECTOR_EN.passes);
  const occText = (can) => tr(can ? "propInspector.canOccupy" : "propInspector.cannotOccupy", can ? INSPECTOR_EN.canOccupy : INSPECTOR_EN.cannotOccupy);
  const tipRule = (cls) => { const [b, o] = CLASS_RULES[cls] || CLASS_RULES.corpse; return `${viewText(b)} · ${occText(o)}`; };
  const setHoverTipsOn = (on) => { setHoverTips(on); if (!on) { setTip(null); setHover(null); } try { localStorage.setItem(HOVER_KEY, on ? "1" : "0"); } catch (e) { /* ignore */ } };
  /** Every prop kind on this floorplan (plus the corpse), each with its class: the Inspect panel's list. */
  const propList = useMemo(() => {
    const kinds = new Set();
    p.contents.forEach((row) => row.forEach((k) => { if (k && k !== "VOID") kinds.add(k); }));
    let coll; try { coll = new Intl.Collator(document.documentElement.lang || undefined, { sensitivity: "base" }); } catch (e) { coll = null; }
    return [...kinds].map((k) => ({ kind: k, cls: k === "CORPSE" ? "corpse" : String(geo.classOfKind(k) || "").toLowerCase() })).filter((x) => CLASS_RULES[x.cls])
      .map((x) => ({ ...x, name: propName(x.kind) })).sort((a, b) => (coll ? coll.compare(a.name, b.name) : a.name.localeCompare(b.name))); // alphabetical, in the player's language
  }, [p, geo, t]); // eslint-disable-line react-hooks/exhaustive-deps -- propName follows t
  const describeKind = (k) => {
    const cls = inspectCls(k);
    return cls ? t(cls === "corpse" ? "propInspector.describeCorpse" : "propInspector.describe", { name: propName(k), tag: cls === "corpse" ? "" : tipTag(cls), rule: tipRule(cls) }) : (LABEL[k] || k);
  };
  const hoverInfo = hoverTips && !tip && !pressing && hover ? inspectAt(hover[0], hover[1]) : null;
  const tipShown = hoverTips ? (tip || hoverInfo) : null, tipKey = tipShown ? `${tipShown.r}-${tipShown.c}-${tipShown.kind}` : "";
  useEffect(() => {
    if (!tip) return undefined;
    const id = setTimeout(() => setTip(null), TIP_MS);
    const out = (e) => { const b = rootRef.current && rootRef.current.querySelector(".sk-board"); if (!b || !b.contains(e.target)) setTip(null); }; // any control dismisses it at once
    document.addEventListener("pointerdown", out, true);
    return () => { clearTimeout(id); document.removeEventListener("pointerdown", out, true); };
  }, [tip]);
  useIsoLayoutEffect(() => {
    if (!tipShown) { setTipPos(null); return; }
    const root = rootRef.current, svgEl = root && root.querySelector(".sk-board"), stage = root && root.querySelector(".sk-stage"), el = tipRef.current;
    if (!svgEl || !stage || !el) return;
    const b = svgEl.getBoundingClientRect(), vb = svgEl.viewBox && svgEl.viewBox.baseVal, sr = stage.getBoundingClientRect();
    if (!b.width || !vb || !vb.width) return;
    const k = Math.min(b.width / vb.width, b.height / vb.height);
    const ox = b.left + (b.width - vb.width * k) / 2, oy = b.top + (b.height - vb.height * k) / 2;
    const x0 = ox + (LAB + tipShown.c * CELL - vb.x) * k, y0 = oy + (LAB + tipShown.r * CELL - vb.y) * k, cs = CELL * k;
    const tw = el.offsetWidth, th = el.offsetHeight, gap = 8, pad = 8, cx = x0 + cs / 2 - sr.left;
    const left = Math.max(pad + tw / 2, Math.min(sr.width - pad - tw / 2, cx));
    const below = tipShown.r <= 1 || y0 - sr.top < th + gap + pad; // rows 0 and 1 (or no room above) flip below the tile so it never clips
    setTipPos({ key: tipKey, left, top: below ? y0 + cs - sr.top + gap : y0 - sr.top - gap, below, ax: Math.max(14, Math.min(tw - 14, tw / 2 + cx - left)) });
  }, [tipKey, zoom, mobile]); // eslint-disable-line react-hooks/exhaustive-deps

  const setOpt = useCallback((patch) => setSettings((cur) => {
    const next = { ...cur, ...patch };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
    return next;
  }), []);
  const resetOpts = useCallback(() => { setSettings({ ...DEFAULT_SETTINGS }); try { localStorage.removeItem(SETTINGS_KEY); } catch (e) { /* ignore */ } }, []);
  /* Clue hover ("Keyword Tooltips"): names, rooms, props and "row 5" light up their tiles; core words show their meaning. */
  const KW_GATE = { nm: "kwPeople", rm: "kwRooms", pr: "kwObjects", row: "kwLines", col: "kwLines" };
  const onClueOver = (e) => {
    if (e.pointerType && e.pointerType !== "mouse") return;
    const at = e.target && e.target.closest ? e.target : null;
    const el = settings.kw && at ? at.closest("[data-hi],[data-kw]") : null;
    const raw = el && el.getAttribute("data-hi"), hi = raw && settings[KW_GATE[raw.split(":")[0]]] ? raw : null;
    setClueHi((h) => (h === hi ? h : hi));
    const tipEl = at ? at.closest("[data-tip]") : null; // a bare surface's "(no …)" list is part of the clue: shown whatever the tooltip settings
    const text = tipEl ? tipEl.getAttribute("data-tip") : null;
    const c = !text && el && settings.kwCore ? el.getAttribute("data-kw") : null;
    if (!c && !text) { setKwTip((k) => (k ? null : k)); return; }
    const root = rootRef.current, b = (tipEl || el).getBoundingClientRect(), rb = root ? root.getBoundingClientRect() : { left: 0, top: 0, width: 1e4 };
    const left = Math.max(160, Math.min(rb.width - 160, b.left + b.width / 2 - rb.left)), top = b.bottom - rb.top + 6;
    setKwTip((k) => (k && k.c === c && k.text === text && k.left === left && k.top === top ? k : { c, text, left, top }));
  };
  const clearClueHover = () => { setClueHi(null); setKwTip(null); };
  /* "Selected character's clue" (settings.kwSelected): every board reference in the selected suspect's own clue stays lit, on touch screens too. */
  const selClueHi = useMemo(() => {
    if (!settings.kwSelected || tool !== "suspect") return null;
    const who = [...suspects, ...(p.assassins || [])].find((q) => q.id === active);
    const keys = who && who.clue ? emph(who.clue).map((el) => el && el.props && el.props["data-hi"]).filter((h) => h && h !== `nm:${active}`) : [];
    return keys.length ? [...new Set(keys)] : null;
  }, [settings.kwSelected, tool, active, suspects, p.assassins, emph]);
  const hiCells = useMemo(() => {
    const keys = [...(selClueHi || []), ...(clueHi ? [clueHi] : [])];
    if (!keys.length) return null;
    const out = [], seen = new Set();
    const add = (r, c) => { const k = key(r, c); if (!seen.has(k)) { seen.add(k); out.push([r, c]); } };
    keys.forEach((hk) => {
      const i = hk.indexOf(":"), type = hk.slice(0, i), val = hk.slice(i + 1);
      if (type === "nm") { if (st.tokens[val]) add(...st.tokens[val]); return; }
      for (let r = 0; r < geo.R; r++) for (let c = 0; c < geo.C; c++) {
        if (geo.isVoid(r, c)) continue;
        if ((type === "pr" && val.split(",").includes(geo.kind(r, c))) || (type === "rm" && String(geo.room(r, c)) === val) || (type === "row" && r === +val - 1) || (type === "col" && c === +val - 1)) add(r, c);
      }
    });
    return out.length ? out : null;
  }, [clueHi, selClueHi, geo, st.tokens]);
  const hiCard = clueHi && clueHi.startsWith("nm:") ? clueHi.slice(3) : null;
  useEffect(() => { clearClueHover(); }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!inspectOpen) return undefined;
    const esc = (e) => { if (e.key === "Escape") setInspectOpen(false); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [inspectOpen]);

  /* Hints (V10.5): one hint at a time, read from the board as it is now (boardHint), opened rung by rung:
     1 where to look (the suspect and the tiles its clue fits), 2 the key deduction (the steps that rule out its other tiles; the
     groundwork stays folded under the lens), 3 the placement. Each rung counts once per hint (hintLog → the profile's stats). */
  const cur = useMemo(() => boardHint(p, st), [p, st]);
  const revealed = cur ? st.hintLog[cur.hid] || 0 : 0;
  // V10.6 note cards: the groundwork of a long investigation, one card at a time, before the rungs (see hintNotes)
  const notes = useMemo(() => hintNotes(cur), [cur]);
  const notesSeen = cur && notes.length ? st.hintLog[NOTE_LOG(cur)] || 0 : 0;
  const [noteOn, setNoteOn] = useState(-1); // the note card on show (-1: none)
  const [hintRung, setHintRung] = useState(0); // the rung on show (0: the board moved on to a hint not opened yet)
  const [hintPick, setHintPick] = useState(-1); // the picked chain line of rung 2 (-1: the last key line)
  const [whyOpen, setWhyOpen] = useState(false); // the groundwork of rung 2 stays folded until the player asks for it (the lens)
  const [groupOpen, setGroupOpen] = useState(() => new Set()); // unfolded runs of like groundwork lines
  useEffect(() => { setHintRung(revealed); setNoteOn(-1); setHintPick(-1); setWhyOpen(false); setGroupOpen(new Set()); }, [cur && cur.hid, p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const showRung = (r) => {
    if (!cur) return;
    if (r > revealed) mutate((cs) => ({ ...cs, hintLog: { ...cs.hintLog, [cur.hid]: Math.max(cs.hintLog[cur.hid] || 0, r) } }), false);
    setNoteOn(-1); setHintRung(r); setHintPick(-1);
  };
  const showNote = (k) => {
    if (!cur || !notes[k]) return;
    const lk = NOTE_LOG(cur);
    if (k + 1 > notesSeen) mutate((cs) => ({ ...cs, hintLog: { ...cs.hintLog, [lk]: Math.max(cs.hintLog[lk] || 0, k + 1) } }), false);
    setNoteOn(k); setHintPick(-1);
  };
  // the next thing to show: an unread note card while the rungs are still closed, else the highest rung reached
  const showNext = () => (!revealed && notesSeen < notes.length ? showNote(notesSeen) : showRung(Math.max(1, revealed)));
  const keyLines = cur && cur.chain ? cur.key.map((i) => [i, cur.chain[i]]) : [];
  // the groundwork: chain lines that are not key lines, consecutive lines with one rule about the same suspects folded into one run
  const ground = useMemo(() => {
    if (!cur || !cur.chain) return [];
    const keys = new Set(cur.key), out = [];
    cur.chain.forEach((s, i) => {
      if (keys.has(i)) return;
      const who = Object.keys(s.elims || {}).sort().join(""), last = out[out.length - 1];
      if (last && last.ruleKey === (s.i18n && s.i18n.ruleKey) && last.who === who && last.end === i - 1) { last.lines.push([i, s]); last.end = i; }
      else out.push({ ruleKey: s.i18n && s.i18n.ruleKey, rule: s.rule, who, lines: [[i, s]], end: i });
    });
    return out;
  }, [cur]);
  const zoneTiles = (cells) => {
    const rooms = new Set(cells.map((at) => geo.room(...at))), out = [];
    for (let r = 0; r < geo.R; r++) for (let c = 0; c < geo.C; c++) if (!geo.isVoid(r, c) && rooms.has(geo.room(r, c))) out.push([r, c]);
    return out;
  };
  const hiderTiles = hidersOf(p).map((id) => hiderCell(p, id)).filter(Boolean);
  const hint = useMemo(() => { // what the board marks for the rung on show: { n, focus, cell }
    if (cur && noteOn >= 0 && notes[noteOn]) return { n: `${cur.hid}.note${noteOn}`, focus: notes[noteOn].focus };
    if (!cur || !hintRung) return null;
    const n = `${cur.hid}.${hintRung}.${hintPick}`;
    if (cur.mistake) {
      if (hintRung === 3) return { n, focus: [], cell: cur.cell };
      return { n, focus: hintRung === 2 && cur.mistake !== "token" ? zoneTiles([cur.cell]) : [] };
    }
    if (cur.suspect === "S") return hintRung === 3 ? { n, focus: hiderTiles, cell: cur.cell } : { n, focus: hintRung === 2 ? zoneTiles(hiderTiles) : [] };
    if (hintRung === 1) return { n, focus: cur.fits };
    if (hintRung === 3) return { n, focus: [], cell: cur.cell };
    const line = hintPick >= 0 ? cur.chain[hintPick] : keyLines.length ? keyLines[keyLines.length - 1][1] : null;
    return { n, focus: line ? line.focus : cur.fits };
  }, [cur, hintRung, hintPick, noteOn, notes, geo]); // eslint-disable-line react-hooks/exhaustive-deps
  const hintCard = hintOpen && cur && hintRung && noteOn < 0 ? (cur.mistake ? (cur.mistake === "token" && hintRung >= 2 ? cur.id : null) : cur.suspect !== "S" ? cur.suspect : null) : null;
  const hintAct = () => { // rung 3's button: do what the hint says
    if (!cur) return;
    const k = key(cur.cell[0], cur.cell[1]);
    if (cur.mistake === "token") mutate((cs) => withoutToken(cs, cur.id));
    else if (cur.mistake === "cross") mutate((cs) => withCross(cs, k, false));
    else if (cur.mistake === "light") mutate((cs) => withLight(cs, k, false));
    else if (cur.suspect === "S") mutate((cs) => hidersOf(p).reduce((a, id) => withToken(a, id, ...hiderCell(p, id)), cs));
    else mutate((cs) => withSightCleared(withToken(cs, cur.suspect, ...cur.cell), geo, ...cur.cell, autoLight));
  };
  const coordsOn = settings.coords || hintOpen; // row / column numbers: always (settings) or while a hint is open
  const LB = coordsOn ? COORD_BAND : 0;
  const onHint = () => {
    if (hintOpen) { setHintOpen(false); return; }
    setHintOpen(true);
    if (cur && noteOn < 0) showNext(); // a note card on show stays
  };
  useEffect(() => {
    if (!hintOpen) return undefined;
    const esc = (e) => { if (e.key === "Escape" && !help) setHintOpen(false); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [hintOpen, help]);

  /* Submit: enabled once everyone, S. H. Adow and the other assassins included, is on the board. The case is solved only when Submit finds every placement right. */
  const hiders = hidersOf(p), extra = p.assassins || [];
  const placedCount = suspects.filter((q) => st.tokens[q.id]).length + hiders.filter((id) => st.tokens[id]).length;
  const totalCount = suspects.length + hiders.length;
  const allPlaced = placedCount === totalCount;
  const solved = isSolved(p, st);
  const onSubmit = () => {
    if (!allPlaced) return;
    const t = st.tokens;
    const wrong = suspects.filter((q) => !sameCell(t[q.id], ...q.solution)).length
      + hiders.filter((id) => { const at = hiderCell(p, id); return !at || !sameCell(t[id], ...at); }).length;
    if (!wrong) { setVerdict(null); setHintOpen(false); mutate((cs) => ({ ...cs, done: true }), false); }
    else { setHintOpen(false); setVerdict({ wrong, total: totalCount }); }
  };
  const go = (d) => { if (!lockCaseMenu) setCaseIdx(Math.max(0, Math.min(puzzles.length - 1, idx + d))); };
  const solvedPrev = useRef(solved), idPrev = useRef(p.id);
  useEffect(() => {
    if (solved && !solvedPrev.current) {
      recordBest(p.id, readTime(p.id)); emit("solved", { id: p.id });
      if (idPrev.current === p.id) { setGateId(p.id); setCelebrate(p.id); setDoneClosed(null); } // solved by playing, not by opening a solved case: no gate, and the completed window
    }
    solvedPrev.current = solved; idPrev.current = p.id;
  }, [solved, p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  /* Opening a contract that is already solved: the board is blurred behind a choice, replay it or view the solution. */
  const gated = solved && gateId !== p.id && !legacy && p.id !== TUTORIAL_ID && view === "play";
  const replay = () => {
    setGateId(p.id);
    live.current = { ...live.current, [p.id]: normCase(undefined) };
    setAll(live.current); saveCase(p.id, live.current[p.id]);
    setUndo((u) => ({ ...u, [p.id]: [] })); setRedo((u) => ({ ...u, [p.id]: [] }));
    setHintOpen(false); setTool("suspect"); setVerdict(null); setZoom(1); zoomRef.current = 1;
    writeTime(p.id, 0); setTimerEpoch((n) => n + 1); // a fresh run restarts the clock; the best time already recorded stays
  };

  /* Desktop and a phone held sideways: drag the line between the suspects and the board to resize both (double-click = automatic again). */
  const railW = () => { const r = rootRef.current && rootRef.current.querySelector(".sk-rail"); return r ? r.offsetWidth : RAIL_W; };
  const splitMax = () => {
    const room = (rootRef.current ? rootRef.current.clientWidth : window.innerWidth) - railW() - dossierMin;
    const st0 = stageEl(), full = short && zoom === 1 && st0 ? (st0.clientHeight - 16) * ar + 16 : Infinity; // sideways the board's height is the limit: no wider than the board at full height (zoomed in, it fills the column)
    return Math.max(splitMin, Math.min(room, full));
  };
  const clampSplit = (w) => Math.round(Math.max(splitMin, Math.min(splitMax(), w)));
  const stageEl = () => (rootRef.current ? rootRef.current.querySelector(".sk-stage") : null);
  const isRtl = () => !!rootRef.current && getComputedStyle(rootRef.current).direction === "rtl";
  const onSplitDown = (e) => {
    if (e.button) return;
    const st0 = stageEl();
    grabRef.current = st0 ? (isRtl() ? st0.getBoundingClientRect().right : st0.getBoundingClientRect().left) - e.clientX : 0; // where on the line the pointer took hold
    e.currentTarget.setPointerCapture(e.pointerId); setDragging(true);
  };
  const onSplitMove = (e) => {
    if (!dragging || !rootRef.current) return;
    const rb = rootRef.current.getBoundingClientRect(), x = e.clientX + grabRef.current; // the line's position
    setSplit(clampSplit(isRtl() ? x - rb.left - railW() : rb.right - railW() - x)); // right to left, the rail is on the left
  };
  const onSplitEnd = () => setDragging(false);
  const onSplitKey = (e) => {
    const d = (e.key === "ArrowLeft" ? 24 : e.key === "ArrowRight" ? -24 : 0) * (isRtl() ? -1 : 1); // the line moves with the arrow: towards the suspects = wider board column
    if (e.key === "Home" || e.key === "Escape") { e.preventDefault(); setSplit(null); return; }
    if (!d) return;
    e.preventDefault();
    const st0 = stageEl();
    setSplit(clampSplit((split || (st0 ? st0.offsetWidth : splitMin)) + d));
  };
  useEffect(() => {
    if (dragging) return;
    try { if (split) localStorage.setItem(splitKey, String(split)); else localStorage.removeItem(splitKey); } catch (e) { /* ignore */ }
  }, [split, splitKey, dragging]);
  const shadowRoom = p.shadow ? (p.roomLabels || p.roomNames)[geo.room(...p.shadow)] : null;

  /* Zoom: keeps the point under (px, py) of the view (default: its centre) where it was, or puts the board point `at`
     ({fx, fy}: fractions of the board) under (px, py) (a pinch: the point first under the fingers follows them) */
  const setZoomTo = (z, px, py, at = null) => {
    const vp = vpRef.current;
    z = clampZoom(z);
    if (vp) {
      const ax = px == null ? vp.clientWidth / 2 : px, ay = py == null ? vp.clientHeight / 2 : py;
      zoomAnchor.current = at ? { ...at, ax, ay } : { fx: (vp.scrollLeft + ax) / (vp.scrollWidth || 1), fy: (vp.scrollTop + ay) / (vp.scrollHeight || 1), ax, ay };
    }
    zoomRef.current = z;
    setZoom(z);
  };
  useIsoLayoutEffect(() => {
    const vp = vpRef.current, a = zoomAnchor.current;
    zoomAnchor.current = null;
    if (!vp) return;
    if (zoom === 1) { vp.scrollLeft = 0; vp.scrollTop = 0; return; }
    if (a) { vp.scrollLeft = a.fx * vp.scrollWidth - a.ax; vp.scrollTop = a.fy * vp.scrollHeight - a.ay; }
  }, [zoom]);
  const setZoomRef = useRef(setZoomTo);
  setZoomRef.current = setZoomTo;
  /* Pinch with two fingers (touch screens) and Ctrl + wheel / a trackpad pinch (desktop) scale the board, whatever the Auto-Scale setting */
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return undefined;
    const two = (e) => { const [a, b] = [e.touches[0], e.touches[1]], r = vp.getBoundingClientRect(); return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top }; };
    const start = (e) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      if (!pinchRef.current || pinchRef.current.pending) abortRef.current && abortRef.current();
      const g = two(e); // the board point under the fingers: it follows them, so moving both fingers pans as well as zooms
      pinchRef.current = { ...g, z: zoomRef.current, fx: (vp.scrollLeft + g.x) / (vp.scrollWidth || 1), fy: (vp.scrollTop + g.y) / (vp.scrollHeight || 1) };
    };
    const move = (e) => {
      const g = pinchRef.current;
      if (!g || g.pending || e.touches.length !== 2) return;
      e.preventDefault();
      const now = two(e), z = clampZoom(g.z * (now.d / g.d));
      if (z === zoomRef.current) { vp.scrollLeft = g.fx * vp.scrollWidth - now.x; vp.scrollTop = g.fy * vp.scrollHeight - now.y; } // same zoom (or at a limit): just pan
      else setZoomRef.current(z, now.x, now.y, { fx: g.fx, fy: g.fy });
    };
    const end = (e) => { if (e.touches.length === 0) pinchRef.current = null; };
    const wheel = (e) => {
      if (!e.ctrlKey) return; // a plain wheel still scrolls a zoomed board
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      setZoomRef.current(zoomRef.current * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    };
    vp.addEventListener("touchstart", start, { passive: false });
    vp.addEventListener("touchmove", move, { passive: false });
    vp.addEventListener("touchend", end); vp.addEventListener("touchcancel", end);
    vp.addEventListener("wheel", wheel, { passive: false });
    return () => {
      vp.removeEventListener("touchstart", start); vp.removeEventListener("touchmove", move);
      vp.removeEventListener("touchend", end); vp.removeEventListener("touchcancel", end); vp.removeEventListener("wheel", wheel);
    };
  }, [view]); // the Inspector view unmounts the board
  const zoomStepIn = ZOOMS.find((z) => z > zoom + 0.01), zoomStepOut = [...ZOOMS].reverse().find((z) => z < zoom - 0.01);
  const zoomBtns = !touchUi; // touch screens pinch instead: only Reset shows, and only while zoomed in
  const showZoom = zoomBtns || zoom > 1;
  const bigBoard = Math.max(geo.R, geo.C) >= 10; // 10×10 – 12×12: Reset stays on screen so the whole grid is one tap away
  // while zoomed in, bring the tiles a hint talks about into view (the hint drawer covers the foot of the board on desktop)
  const hintTiles = hint ? [...(hint.focus || []), ...(hint.cell ? [hint.cell] : [])] : [];
  const hintFocus = hintOpen && hintTiles.length ? hintTiles : null;
  useIsoLayoutEffect(() => {
    const vp = vpRef.current;
    if (!vp || zoom <= 1 || !hintFocus) return;
    const rs = hintFocus.map((f) => f[0]), cs = hintFocus.map((f) => f[1]);
    const cr = (Math.min(...rs) + Math.max(...rs)) / 2, cc = (Math.min(...cs) + Math.max(...cs)) / 2;
    const fx = (BZ + LB + (cc + 0.5) * CELL) / (geo.C * CELL + 2 * BZ + LB), fy = (BZ + LB + (cr + 0.5) * CELL) / (geo.R * CELL + 2 * BZ + LB);
    const left = fx * vp.scrollWidth - vp.clientWidth / 2, top = fy * vp.scrollHeight - vp.clientHeight / 2;
    try { vp.scrollTo({ left, top, behavior: "smooth" }); } catch (e) { vp.scrollLeft = left; vp.scrollTop = top; }
  }, [hint && hint.n, hintOpen, zoom, p.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The hint drawer / victory banner floats over the stage; its height is published as --ovl so the board (desktop)
     or the dossier (mobile) makes room for it without any re-render. */
  const showSolved = solved && p.id !== TUTORIAL_ID && !gated;
  const doneOpen = showSolved && celebrate === p.id && doneClosed !== p.id && view === "play"; // the pop-up over the game // the tutorial ends in U. M. Bra's dossier, not in this banner · the replay gate says it already
  const showBanner = showSolved && celebrate !== p.id; // the solved banner only where no pop-up told it (a solved contract opened with "view the solution")
  const overlayOpen = view === "play" && (showBanner || hintOpen || !!verdict);
  useIsoLayoutEffect(() => {
    const root = rootRef.current, el = ovlRef.current;
    if (!root) return undefined;
    if (!el) { root.style.setProperty("--ovl", "0px"); return undefined; }
    const set = () => root.style.setProperty("--ovl", `${Math.ceil(el.offsetHeight) + 12}px`);
    set();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [overlayOpen]);
  /* Phones: the drawer drops into the suspects area, so it may be no taller than that area: the room between the board and the
     dock, published as --dosh (measured on the grid, not on the dossier, whose padding grows with the drawer). It scrolls inside. */
  useIsoLayoutEffect(() => {
    const root = rootRef.current, d = root && root.querySelector(".sk-dossier"), rail = root && root.querySelector(".sk-rail"), stage = root && root.querySelector(".sk-stage");
    if (!d || !rail || typeof ResizeObserver === "undefined") return undefined;
    const set = () => {
      root.style.setProperty("--dosh", `${Math.max(0, Math.round(rail.getBoundingClientRect().top - d.getBoundingClientRect().top))}px`);
      // the room under the game (the tutorial's lesson card): the sideways layout lifts its fixed drawer above it
      root.style.setProperty("--gbot", `${Math.max(0, Math.round(window.innerHeight - root.getBoundingClientRect().bottom))}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    [root, rail, stage].forEach((el) => el && ro.observe(el));
    return () => ro.disconnect();
  }, []);

  const ar = (geo.C * CELL + 2 * BZ + LB) / (geo.R * CELL + 2 * BZ + LB);
  const autoLight = settings.autoLight || legacy; // the tutorial's lessons rely on the automatic lights
  const boardOpts = { coords: coordsOn, roomHover: settings.roomHover, roomLabel: settings.roomLabel, objSize: settings.objSize, walls: settings.walls, autoLight, tokenStyle: settings.tokenStyle, selHi: settings.selHi, lightTint: settings.lightTint, myTint: settings.myTint };
  const naturalW = Math.round(geo.C * CELL + 2 * BZ + LB); // "Auto-Scale Board" off: one board unit = one pixel at most
  const victimG = !settings.gender || victimIsDummy(p) || p.id === UMBRA_HARD ? null : p.id === UMBRA_FINALE ? "m" : victimGenderOf(victimNameOf(p)); // the finale's corpse is Master U. M. Bra; The Uninvited Guests' is hooded N. O. Ir (no gender shown)
  /* The Umbra Conspiracy (umbra.jsx): the relic of a solved standard contract, the black envelope once all ten are solved, the
     Omega dossier after "The Uninvited Guests", and the finale's own verdict. `onLaunch(id)` opens a contract (the site's router);
     without it the game switches cases itself. */
  const launch = (id) => {
    setUmbra(null);
    if (onLaunch) { onLaunch(id); return; }
    const i = puzzles.findIndex((q) => q.id === id);
    if (i >= 0 && !lockCaseMenu) setCaseIdx(i);
  };
  const solvedIds = solved ? new Set(Object.keys(readBestTimes(puzzles))) : null;
  const finaleNo = PUZZLES.filter((q) => q.id !== TUTORIAL_ID).findIndex((q) => q.id === UMBRA_FINALE) + 1; // its number in the contracts hub
  const hardNo = PUZZLES.filter((q) => q.id !== TUTORIAL_ID).findIndex((q) => q.id === UMBRA_HARD) + 1; // The Uninvited Guests' number there
  const genderOf = (q) => { const g = String(q.gender || (looks[q.id] && looks[q.id].gender) || "").toLowerCase(); return g === "m" || g === "f" ? g : null; };
  const nameOf = (id) => (hiders.includes(id) ? t(`assassin.${id}`) : (suspects.find((q) => q.id === id) || {}).name || id);
  const tierClass = (t) => `sk-tier t${Math.min(3, Math.max(1, +t || 1))}`;
  const beach = themeOf(p) === "BEACH";

  /* ---- Inspector view (only when ShadokuLab passes its bench in) ---- */
  if (view === "lab" && Lab) {
    return (
      <div className="sk sk-labview" ref={rootRef}>
        <style>{CSS}</style>
        <header className="sk-labbar">
          <ShadokuLogo src={logoSrc} />
          <div className="sk-tabs" role="tablist" aria-label="Views">
            <button type="button" role="tab" aria-selected="false" onClick={() => setView("play")}>🕵️ Play Puzzles</button>
            <button type="button" role="tab" aria-selected="true">🧪 SVG Asset &amp; Portrait Inspector</button>
          </div>
        </header>
        <div className="sk-labscroll"><Lab puzzles={puzzles} /></div>
      </div>
    );
  }

  const nowLabel = tool === "light" ? <>{boldNodes(t("game.now.light"))}</>
    : tool === "cross" ? <>{boldNodes(t("game.now.cross"))}</>
    : tool === "eraser" ? <>{boldNodes(t("game.now.eraser"))}</>
      : tool === "none" ? <>{boldNodes(t("game.now.inspect"))}</>
      : isSym(active) ? <><svg className="sk-symic" viewBox="0 0 24 24" aria-hidden="true"><SymShape id={active} cx={12} cy={12} r={9} fill={colorOf(active)} stroke={INK} strokeWidth="2" /></svg>{boldNodes(t("game.now.symbol", { name: t(`game.sym.${NOTE_SYMBOLS[active].shape}`) }))}</>
      : <><span className="sk-letter" style={{ "--sc": colorOf(active) }}>{active}</span>{boldNodes(t("game.now.suspect", { name: nameOf(active) }))}</>;

  /* Zoom / reset: under Undo in the tool rail on desktop; on phones and tablets a slim column beside the board (never over its tiles). */
  const zoomIcon = (plus) => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={plus ? "M3 8h10M8 3v10" : "M3 8h10"} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>; // drawn, not typed: a "+" / "−" glyph sits off-centre in its box
  const zoomCtl = showZoom && (
    <div className="sk-zoom" role="group" aria-label={t("game.zoom")}>
      {zoomBtns && <>
        <button type="button" onClick={() => setZoomTo(zoomStepIn || ZOOM_MAX)} disabled={!zoomStepIn} aria-label={t("game.zoomIn")} title={t("game.zoomIn")}>{zoomIcon(true)}</button>
        <button type="button" onClick={() => setZoomTo(zoomStepOut || 1)} disabled={!zoomStepOut} aria-label={t("game.zoomOut")} title={t("game.zoomOut")}>{zoomIcon(false)}</button>
      </>}
      {(zoom > 1 || (bigBoard && zoomBtns)) && <button type="button" className={`rst${zoomBtns ? "" : " solo"}`} onClick={() => setZoomTo(1)} disabled={zoom === 1} aria-label={t("game.resetView")} title={t("game.resetView")}>{t("game.reset")}</button>}
    </div>
  );

  /* A phone with `headEnd` (the site's sign-in and ☰): one header line (logo, timer, ⚙, ?, headEnd); the contract's title opens the dossier */
  const merged = !!headEnd && mobile;
  const caseNav = fixedCase ? <CaseTitle puzzles={heads} idx={idx} solvedOf={(q) => isSolved(q, all[q.id])} /> : (
    <nav className="sk-nav" aria-label={t("game.contracts")}>
      <button type="button" className="sk-arrow" onClick={() => go(-1)} disabled={lockCaseMenu || idx === 0} aria-label={t("game.prevContract")}>‹</button>
      <CaseMenu puzzles={heads} idx={idx} onPick={setCaseIdx} disabled={lockCaseMenu} solvedOf={(q) => isSolved(q, all[q.id])} />
      <button type="button" className="sk-arrow" onClick={() => go(1)} disabled={lockCaseMenu || idx === puzzles.length - 1} aria-label={t("game.nextContractAria")}>›</button>
    </nav>
  );
  return (
    <div className={`sk sk-game${settings.kw ? " kw-on" : ""}${dragging ? " sk-dragging" : ""}`} ref={rootRef} data-tight={+insetY > 110 ? "" : undefined} data-split={split && !mobile ? "" : undefined} data-big={Math.max(geo.R, geo.C) >= BIG_BOARD ? "" : undefined} data-zoomed={zoom > 1 ? "" : undefined}
      style={{ "--ar": ar, "--bar": `${Math.max(0, +insetY || 0)}px`, ...(split && !mobile ? { "--stagew": `${split}px` } : null) }}
      onPointerOver={onClueOver} onPointerLeave={clearClueHover}>
      <style>{CSS}</style>

      <header className={`sk-head${merged ? " merged" : ""}`} ref={headRef} data-wide={headWide ? "" : undefined}>
        {!hideLogo && (onLogo ? <button type="button" className="sk-logobtn" onClick={onLogo} aria-label={t("nav.pHome")}><ShadokuLogo src={logoSrc} /></button> : <ShadokuLogo src={logoSrc} />)}
        {!merged && caseNav}
        <div className="sk-headr">
          <CaseTimer key={`${p.id}|${timerEpoch}`} caseId={p.id} solved={solved} paused={view !== "play"} hidden={!settings.timer} />
          <button type="button" className="sk-gear" onClick={() => setSettingsOpen(true)} aria-label={t("settings.open")} title={t("settings.open")}><GearIcon /></button>
        </div>
        <button type="button" className="sk-help" onClick={() => setHelp(true)} aria-label={t("howto.title")}>?</button>
        {merged && <div className="sk-headend">{headEnd}</div>}
      </header>

      <section className="sk-dossier" aria-label={t("game.dossier")}>
        {short && dossierCard}
        {merged && <div className="sk-casebar">{caseNav}</div>}
        <div className="sk-now" role="status">{nowLabel}</div>
        {(p.globalRules || []).length > 0 && (
          <section className="sk-rules" aria-label={t("game.houseRulesAria")}>
            <div className="sk-rules-head"><span>{t("game.houseRules")}</span><small>{t("game.generalClues")}</small></div>
            {p.globalRules.map((g, i) => <p key={g.id || i} className="sk-rule">{emph(g.text)}</p>)}
          </section>
        )}
        <div className="sk-eyebrow">{t(tool === "none" ? "game.eyebrowInspect" : "game.eyebrow")}</div>
        <div className={`sk-cast${settings.portrait ? "" : " list"}`}>
          {suspects.map((q) => (
            <SuspectCard key={q.id} q={q} look={looks[q.id]} color={colorOf(q.id)} on={tool === "suspect" && active === q.id} placed={!!st.tokens[q.id]}
              emph={emph} onPick={() => pick(q.id)} onInspect={() => setSheet(q.id)} coach={coachCard === q.id} hint={tapAgain(q.id)}
              gender={settings.gender ? genderOf(q) : null} hi={hiCard === q.id || hintCard === q.id} />
          ))}
          <AdowCard beach={beach} on={tool === "suspect" && active === "S"} placed={!!st.tokens.S} solved={solved} onPick={() => pick("S")} onInspect={() => setSheet("S")} coach={coachCard === "S"} hint={tapAgain("S")} hi={hiCard === "S" || hintCard === "S"} />
          {extra.map((a) => (
            <AssassinCard key={a.id} a={a} color={colorOf(a.id)} on={tool === "suspect" && active === a.id} placed={!!st.tokens[a.id]} emph={emph} onPick={() => pick(a.id)} onInspect={() => setSheet(a.id)}
              coach={coachCard === a.id} hint={tapAgain(a.id)} hi={hiCard === a.id || hintCard === a.id} />
          ))}
        </div>
        {settings.symbols && chosenSyms(settings).length > 0 && (
          <section className="sk-syms" aria-label={t("game.symbols")}>
            <div className="sk-eyebrow">{t("game.symbols")}</div>
            <div className="sk-syms-row">
              {chosenSyms(settings).map((id) => (
                <button key={id} type="button" className="sk-sym" aria-pressed={tool === "suspect" && active === id} onClick={() => pick(id)} title={t(`game.sym.${NOTE_SYMBOLS[id].shape}`)} aria-label={t(`game.sym.${NOTE_SYMBOLS[id].shape}`)}>
                  <svg viewBox="0 0 40 40" aria-hidden="true"><SymShape id={id} cx={20} cy={20} r={13} fill={NOTE_SYMBOLS[id].color} stroke={INK} strokeWidth="2.6" /></svg>
                </button>
              ))}
            </div>
          </section>
        )}
        {Lab && mobile && <button type="button" className="sk-lablink" onClick={() => setView("lab")}>🧪 Open the SVG Asset &amp; Portrait Inspector</button>}
      </section>

      <main className="sk-stage" aria-label={t("game.board")}>
        <div className={`sk-boardbox${gated ? " gated" : ""}${mobile && zoomBtns ? " has-zoom" : ""}${zoom > 1 ? " zoomed" : ""}`} inert={gated || undefined} style={{ "--ar": ar, maxWidth: settings.autoScale ? undefined : naturalW }}>
          <div className="sk-viewport" ref={vpRef} data-zoomed={zoom > 1 ? "" : undefined} style={{ "--z": zoom }} onScroll={() => { setTip(null); setHover(null); }}>
            <div className="sk-zoomer">
              <Board p={p} geo={geo} st={st} looks={looks} colorOf={colorOf} active={active} tool={tool} hover={hover}
                focus={hintOpen ? hint : null} solved={solved} flash={flash} hold={holdCell} coachCells={coachCells} uid={p.id} describe={describeKind} onStroke={onStroke} onHover={onHover} onKey={onKey}
                opts={boardOpts} hiCells={hiCells} />
            </div>
          </div>
          {(mobile || !zoomBtns) && zoomCtl}
        </div>

        {tipShown && (
          <div ref={tipRef} className={`sk-pi ${tipShown.cls}`} role="tooltip" data-below={tipPos && tipPos.key === tipKey && tipPos.below ? "" : undefined}
            style={tipPos && tipPos.key === tipKey ? { left: tipPos.left, top: tipPos.top, "--ax": `${tipPos.ax}px` } : { left: 0, top: 0, visibility: "hidden" }}>
            <div className="sk-pi-h">
              <span className="sk-pi-n">{propName(tipShown.kind)}{tipShown.kind === "CORPSE" && victimG && <GenderMark g={victimG} inline />}</span>
            </div>
            <div className="sk-pi-r">{tipRule(tipShown.cls)}</div>
          </div>
        )}

        {gated && (
          <div className="sk-replay" role="dialog" aria-label={t("game.contractFulfilled")}>
            <div className="sk-replay-card">
              <b>{t("game.contractFulfilled")}</b>
              <span>{tr("game.replay.text", "You already solved this contract.")}</span>
              <div className="sk-replay-act">
                <button type="button" className="sk-btn primary" onClick={replay}>{tr("game.replay.replay", "Replay the contract")}</button>
                <button type="button" className="sk-btn" onClick={() => setGateId(p.id)} autoFocus>{tr("game.replay.view", "View the solution")}</button>
              </div>
            </div>
          </div>
        )}

        <div className="sk-split" role="separator" aria-orientation="vertical" tabIndex={0} aria-label={tr("game.resize", "Drag to resize the scapegoats and the board")} title={tr("game.resize", "Drag to resize the scapegoats and the board")}
          onPointerDown={onSplitDown} onPointerMove={onSplitMove} onPointerUp={onSplitEnd} onPointerCancel={onSplitEnd} onLostPointerCapture={onSplitEnd} onDoubleClick={() => setSplit(null)} onKeyDown={onSplitKey} />

        {overlayOpen && (
          <div className="sk-overlay" ref={ovlRef}>
            {showBanner && (
              <div className="sk-solved-wrap">
                <div className="sk-solved" role="status">
                  {p.id === UMBRA_FINALE
                    ? <div><b>{t("game.solved.umbra.title")}</b><span>{t("game.solved.umbra.text")}</span></div>
                    : <div><b>{t("game.contractFulfilled")}</b><span>{t("game.shadowWasIn", { room: shadowRoom || t("game.dark") })}</span>
                      {extra.map((a) => { const at = hiderCell(p, a.id), room = at ? (p.roomLabels || p.roomNames)[geo.room(...at)] : null; // the other assassins' hiding places too
                        return room ? <span key={a.id} className="sk-solved-more">{tr("game.assassinWasIn", `${nameOf(a.id)} was hiding in the ${room}.`, { name: nameOf(a.id), room })}</span> : null; })}</div>}
                  {fixedCase ? (onExit && <button type="button" onClick={onExit}>{exitLabel || t("game.backToContracts")}</button>)
                    : !lockCaseMenu && <button type="button" onClick={() => (idx < puzzles.length - 1 ? go(1) : setCaseIdx(0))}>{t(idx < puzzles.length - 1 ? "game.nextContract" : "game.backToFirst")}</button>}
                </div>
                {isRelicCase(p.id) && <RelicCard caseId={p.id} compact />}
                {isRelicCase(p.id) && solvedIds && allRelics(solvedIds) && <div className="sk-umbra-tok"><ObsidianEnvelope small onOpen={() => setUmbra("board")} /><span>{t("conspiracy.envelope.caption")}</span></div>}
                {p.id === UMBRA_HARD && <div className="sk-umbra-tok"><OmegaFolder small onOpen={() => setUmbra("sanctum")} /><span>{t("sanctum.folder.caption")}</span></div>}
              </div>
            )}
            {verdict && !solved && (
              <div className="sk-verdict" role="alert">
                <div><b>{t("game.notQuite")}</b><span>{t(verdict.wrong === 1 ? "game.verdict.one" : "game.verdict.other", { wrong: verdict.wrong, total: verdict.total })}</span></div>
                <button type="button" onClick={() => setVerdict(null)} aria-label={t("game.dismiss")}>×</button>
              </div>
            )}
            {hintOpen && (
              <div className="sk-hint" role="region" aria-label={t("hint.counsel")}>
                <button type="button" className="sk-hint-x" onClick={() => setHintOpen(false)} aria-label={t("hint.hideAria")}>×</button>
                <div className="sk-hint-pic" aria-hidden="true"><MasterPolaroid size={64} /></div>
                <div className="sk-hint-main">
                  {(() => {
                    const coord = (at) => t("fmt.coord", { row: at[0] + 1, col: at[1] + 1 });
                    const zone = (at) => (p.roomLabels || p.roomNames)[geo.room(...at)];
                    const head = (extra) => <div className="sk-hint-head"><span className="sk-step">{t("hint.counsel")}</span>{extra}</div>;
                    if (!cur) return <>{head(null)}<p>{p.hints && p.hints.length ? tr("hint.allRight", "Everyone stands on the right tile. Press Submit.") : t("hint.none")}</p></>;
                    if (noteOn >= 0 && notes[noteOn]) { // a note card: deductions for the notes, nobody named yet
                      const nt = notes[noteOn];
                      return <>{head(<><span className="sk-rung">{tr("hint.note", "Note {n}/{total}", { n: noteOn + 1, total: notes.length })}</span>
                        <span className={tierClass(nt.tier)}>{t("hint.tier", { tier: nt.tier })}</span><span className="sk-rname">{nt.rule}</span></>)}
                        {noteOn === 0 && <p>{tr("hint.noteLead", "For your notes:")}</p>}
                        <ol className="sk-hint-why">{nt.lines.map(([i, s]) => <li key={i}><span>{s.text}</span></li>)}</ol>
                        <div className="sk-hint-act">
                          {noteOn + 1 < notes.length ? <button type="button" className="sk-btn primary" onClick={() => showNote(noteOn + 1)}>{tr("hint.nextNote", "Next note")}</button>
                            : <button type="button" className="sk-btn primary" onClick={() => showRung(1)}>{tr("hint.more", "Show more")}</button>}
                          {noteOn > 0 && <button type="button" className="sk-btn" onClick={() => showNote(noteOn - 1)}>{t("hint.back")}</button>}
                          <button type="button" className="sk-btn" onClick={() => setHintOpen(false)}>{t("hint.hide")}</button>
                        </div></>;
                    }
                    if (!hintRung) return <>{head(null)}<p>{tr("hint.ready", "Your board has moved on. Ask for the next hint when you want it.")}</p></>;
                    const stage = [tr("hint.stage.1", "Where to look"), tr("hint.stage.2", "The key deduction"), tr("hint.stage.3", "The placement")][hintRung - 1];
                    const lead = cur.mistake ? null : cur.suspect === "S" ? null : keyLines.length ? keyLines.reduce((a, b) => ((b[1].tier || 1) > (a[1].tier || 1) ? b : a))[1] : cur.place;
                    const chips = <><span className="sk-rung">{tr("hint.rung", "{n}/{total} · {stage}", { n: hintRung, total: HINT_RUNGS, stage })}</span>
                      {lead && hintRung >= 2 && <><span className={tierClass(cur.tier)}>{t("hint.tier", { tier: cur.tier || 1 })}</span><span className="sk-rname">{lead.rule}</span></>}</>;
                    const line = (i, s) => <li key={i}><button type="button" aria-pressed={hintPick === i} onClick={() => setHintPick(hintPick === i ? -1 : i)}>{s.text}</button></li>;
                    let body;
                    if (cur.mistake) {
                      const who = cur.id && nameOf(cur.id);
                      body = <p>{hintRung === 1 ? tr("hint.wrongLook", "Something on your board does not add up. Check your tokens and marks against the clues.")
                        : hintRung === 2 ? (cur.mistake === "token" ? tr("hint.wrongWho", "Look again at {name}.", { name: who }) : tr("hint.wrongZone", "Look again at your marks in the {zone}.", { zone: zone(cur.cell) }))
                          : cur.mistake === "token" ? tr("hint.wrongToken", "{name} cannot be on {coord}.", { name: who, coord: coord(cur.cell) })
                            : cur.mistake === "cross" ? tr("hint.wrongCross", "Someone is on {coord}: the X there is wrong.", { coord: coord(cur.cell) })
                              : tr("hint.wrongLight", "Someone hides on {coord}: the light there is wrong.", { coord: coord(cur.cell) })}</p>;
                    } else if (cur.suspect === "S") {
                      body = hintRung === 1 ? <p>{hiders.length > 1 ? tr("hint.shadowLookMany", "Everyone is placed. Find the {n} tiles no scapegoat watches: the assassins hide there.", { n: hiders.length })
                        : tr("hint.shadowLook", "Everyone is placed. Find the one tile no scapegoat watches: S. H. Adow hides there.")}</p>
                        : hintRung === 2 ? <ul className="sk-hint-why">{hiders.map((id) => <li key={id}><span>{tr("hint.hidesIn", "{name} hides in the {zone}.", { name: nameOf(id), zone: zone(hiderCell(p, id)) })}</span></li>)}</ul>
                          : <p>{cur.place.text}</p>;
                    } else if (hintRung === 1) {
                      body = <p>{tr("hint.look", "Look at {name}. The tiles that fit the clue are marked on the board.", { name: nameOf(cur.suspect) })}</p>;
                    } else if (hintRung === 2) {
                      const n = cur.chain.length - keyLines.length;
                      const label = whyOpen ? tr("hint.groundHide", "Hide the groundwork") : tr("hint.groundShow", "Show the groundwork ({n} steps)", { n });
                      body = <>
                        {keyLines.length ? <ol className="sk-hint-why key">{keyLines.map(([i, s]) => line(i, s))}</ol>
                          : <p>{cur.fits.length === 1 ? tr("hint.oneFit", "Only one tile fits {name}'s clue.", { name: nameOf(cur.suspect) })
                            : tr("hint.direct", "The scapegoats on the board already take or watch every other tile that fits {name}'s clue.", { name: nameOf(cur.suspect) })}</p>}
                        {n > 0 && <button type="button" className="sk-hint-ground" aria-expanded={whyOpen} onClick={() => { setWhyOpen(!whyOpen); setHintPick(-1); }}><LensIcon /><span>{label}</span></button>}
                        {whyOpen && n > 0 && (
                          <ol className="sk-hint-why">
                            {ground.map((g, gi) => (g.lines.length === 1 || groupOpen.has(gi) ? g.lines.map(([i, s]) => line(i, s)) : (
                              <li key={`g${gi}`}><button type="button" className="sk-hint-run" aria-expanded={false} onClick={() => setGroupOpen(new Set([...groupOpen, gi]))}>
                                {g.who ? tr("hint.run", "{rule} · {names} ({n} steps)", { rule: g.rule, names: [...g.who].map(nameOf).join(", "), n: g.lines.length })
                                  : tr("hint.runBare", "{rule} ({n} steps)", { rule: g.rule, n: g.lines.length })}</button></li>
                            )))}
                          </ol>
                        )}
                      </>;
                    } else body = <p>{cur.place.text}</p>;
                    const act = hintRung < HINT_RUNGS ? <button type="button" className="sk-btn primary" onClick={() => showRung(hintRung + 1)}>{tr("hint.more", "Show more")}</button>
                      : <button type="button" className="sk-btn primary" onClick={hintAct}>{cur.mistake === "token" ? tr("hint.takeOff", "Take {name} off", { name: nameOf(cur.id) })
                        : cur.mistake === "cross" ? tr("hint.removeX", "Remove the X") : cur.mistake === "light" ? tr("hint.lightOff", "Switch the light off")
                          : cur.suspect === "S" && hiders.length > 1 ? tr("hint.placeAll", "Place them") : tr("hint.place", "Place {name}", { name: nameOf(cur.suspect) })}</button>;
                    return <>{head(chips)}{body}<div className="sk-hint-act">
                      {act}
                      {hintRung > 1 && <button type="button" className="sk-btn" onClick={() => { setHintRung(hintRung - 1); setHintPick(-1); }}>{t("hint.back")}</button>}
                      {hintRung === 1 && notes.length > 0 && <button type="button" className="sk-btn" onClick={() => showNote(notes.length - 1)}>{t("hint.back")}</button>}
                      <button type="button" className="sk-btn" onClick={() => setHintOpen(false)}>{t("hint.hide")}</button>
                    </div></>;
                  })()}
                  {cur && !hintRung && noteOn < 0 && <div className="sk-hint-act">
                    <button type="button" className="sk-btn primary" onClick={showNext}>{t("hint.next")}</button>
                    <button type="button" className="sk-btn" onClick={() => setHintOpen(false)}>{t("hint.hide")}</button>
                  </div>}
                  {!cur && <div className="sk-hint-act"><button type="button" className="sk-btn" onClick={() => setHintOpen(false)}>{t("hint.hide")}</button></div>}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <nav className="sk-rail" aria-label={t("tools.nav")}>
        <div className="sk-rail-group" role="toolbar" aria-label={t("tools.group")}>
          {menu && menu.length > 0 && !mobile && <RailMenu items={menu} onSettings={() => setSettingsOpen(true)} />}
          <span className="sk-rail-cap" aria-hidden="true">{t("tools.cap")}</span>
          <LightButton coach={coachTool === "light"} active={tool === "light"} onSelect={() => setTool(tool === "light" ? offTool : "light")}
            tint={settings.myTint} onTint={(v) => setOpt({ myTint: v })} />
          <button type="button" className={`sk-tool${coachTool === "cross" ? " coach" : ""}`} aria-pressed={tool === "cross"} onClick={() => setTool(tool === "cross" ? offTool : "cross")} title={t("tools.crossTip")}>
            <span className="ic" aria-hidden="true">❌</span><small>{t("tools.cross1")}<span className="lb2">{t("tools.cross2")}</span></small>
          </button>
          <EraserButton coach={coachTool === "eraser"} active={tool === "eraser"} onSelect={() => setTool((t) => (t === "eraser" ? offTool : "eraser"))} onClearAll={clearAll} />
          <button type="button" className="sk-tool" aria-pressed={inspectOpen} aria-expanded={inspectOpen} onClick={() => setInspectOpen((o) => !o)} title={t("tools.inspectTip")}>
            <span className="ic" aria-hidden="true">📋</span><small>{t("tools.inspect")}</small>
          </button>
          <button type="button" className={`sk-tool${coachTool === "undo" ? " coach" : ""}`} onClick={doUndo} disabled={!stack.length} title={t("tools.undoTip")}>
            <span className="ic" aria-hidden="true">↩️</span><small>{t("tools.undo")}</small>
          </button>
          {!legacy && ( /* not in the tutorial: its lesson card already takes the rail's spare height */
            <button type="button" className="sk-tool desk" onClick={doRedo} disabled={!redoStack.length} title={tr("tools.redoTip", "Redo (Ctrl/⌘ Y)")}>
              <span className="ic" aria-hidden="true">↪️</span><small>{tr("tools.redo", "Redo")}</small>
            </button>
          )}
          {!mobile && zoomBtns && zoomCtl}
        </div>
        <div className="sk-rail-group end">
          <button type="button" className={`sk-tool${coachTool === "hint" ? " coach" : ""}`} aria-pressed={hintOpen} onClick={onHint} title={t("tools.hintTip")}>
            <span className="ic" aria-hidden="true">🔎</span><small>{t("tools.hint")}</small>
          </button>
          <button type="button" className={`sk-tool sk-submit${allPlaced ? " ready" : ""}${coachTool === "submit" ? " coach" : ""}`} onClick={onSubmit} disabled={!allPlaced || solved}
            title={t(solved ? "tools.submitDone" : allPlaced ? "tools.submitReady" : extra.length ? "tools.submitWaitAll" : "tools.submitWait")}>
            <span className="ic" aria-hidden="true">{solved ? "🏅" : "✅"}</span><small>{t(solved ? "tools.solved" : "tools.submit")}</small><span className="sub keep">{solved ? t("tools.wellDone") : t("tools.placed", { n: placedCount, total: totalCount })}</span>
          </button>
          <button type="button" className="sk-tool desk" onClick={() => setHelp(true)} title={t("tools.howTip")}>
            <span className="ic" aria-hidden="true">❓</span><small>{t("tools.how1")}<span className="lb2">{t("tools.how2")}</span></small>
          </button>
          {Lab && (
            <button type="button" className="sk-tool desk" onClick={() => setView("lab")} title="SVG Asset & Portrait Inspector">
              <span className="ic" aria-hidden="true">🧪</span><small>Inspector</small>
            </button>
          )}
        </div>
      </nav>

      {sheet && (() => {
        const a = extra.find((x) => x.id === sheet);
        const q = sheet === "S" ? { id: "S", name: t("assassin.S"), clue: "" } : a ? { ...a, assassin: true } : suspects.find((x) => x.id === sheet);
        return q ? <SuspectSheet q={q} look={looks[q.id]} color={colorOf(q.id)} placed={!!st.tokens[q.id]} emph={emph} beach={beach} onClose={() => setSheet(null)} gender={settings.gender && !hiders.includes(q.id) ? genderOf(q) : null} /> : null;
      })()}
      {inspectOpen && (
        <aside className="sk-insp" role="dialog" aria-label={tr("inspect.title", INSPECTOR_EN.title)}>
          <div className="sk-insp-h">
            <b>{tr("inspect.title", INSPECTOR_EN.title)}</b>
            <button type="button" className="sk-insp-x" onClick={() => setInspectOpen(false)} aria-label={tr("inspect.close", INSPECTOR_EN.close)}>×</button>
          </div>
          <ul className="sk-insp-list">
            {propList.length === 0 && <li className="sk-insp-empty">{tr("inspect.empty", INSPECTOR_EN.empty)}</li>}
            {propList.map(({ kind, cls }) => {
              const [b, o] = CLASS_RULES[cls];
              return (
                <li key={kind} className="sk-insp-row">
                  <svg className="sk-insp-ic" viewBox="0 0 64 64" aria-hidden="true">{kind === "CORPSE" ? <text x="32" y="46" textAnchor="middle" fontSize="40">💀</text> : <PropSprite kind={kind} len={1} />}</svg>
                  <span className="sk-insp-n">{propName(kind)}{kind === "CORPSE" && victimG && <GenderMark g={victimG} inline />}</span>
                  <span className="sk-insp-tags">
                    <span className={`sk-insp-tag ${b ? "no" : "yes"}`}>{viewText(b)}</span>
                    <span className={`sk-insp-tag ${o ? "yes" : "no"}`}>{occText(o)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <label className="sk-insp-opt">
            <input type="checkbox" checked={hoverTips} onChange={(e) => setHoverTipsOn(e.target.checked)} />
            <span>{tr("inspect.hover", INSPECTOR_EN.hover)}</span>
          </label>
        </aside>
      )}

      {kwTip && <div className="sk-kwtip" role="tooltip" style={{ left: kwTip.left, top: kwTip.top }}>{kwTip.text || boldNodes(t(`kw.${kwTip.c}`))}</div>}
      {doneOpen && (() => {
        // The Uninvited Guests' next contract is the finale in its red Omega folder: picking it opens Dossier № 000-OMEGA, not the board
        const omegaNext = p.id === UMBRA_HARD;
        // every relic is in (whatever the order they were fulfilled in): the next contract is The Uninvited Guests' black envelope
        const blackNext = !omegaNext && isRelicCase(p.id) && !!solvedIds && allRelics(solvedIds);
        const head = heads[idx] || {};
        const umbraOf = (id) => puzzles.find((q) => q.id === id) || PUZZLES.find((q) => q.id === id) || null;
        const nxt = omegaNext ? umbraOf(UMBRA_FINALE) : blackNext ? umbraOf(UMBRA_HARD)
          : puzzles[idx + 1] && puzzles[idx + 1].id !== TUTORIAL_ID && !p.daily && !puzzles[idx + 1].daily ? puzzles[idx + 1] : null; // a daily contract has no "next": the Daily Contract page holds the others
        const nNo = omegaNext ? finaleNo : blackNext ? hardNo : idx + 2 - puzzles.slice(0, idx + 1).filter((q) => q.id === TUTORIAL_ID).length; // the next contract's number (the tutorial is not numbered)
        const close = () => setDoneClosed(p.id);
        const nxtLabel = t("hub.contractNo", { n: String(nNo).padStart(3, "0") });
        const rooms = [shadowRoom ? tr("game.shadowWasIn", `S. H. Adow was hiding in the ${shadowRoom}.`, { room: shadowRoom }) : null, ...extra.map((a) => { const at = hiderCell(p, a.id), room = at ? (p.roomLabels || p.roomNames)[geo.room(...at)] : null;
          return room ? tr("game.assassinWasIn", `${nameOf(a.id)} was hiding in the ${room}.`, { name: nameOf(a.id), room }) : null; })].filter(Boolean);
        const time = fmtTime(readTime(p.id));
        const share = async () => {
          const url = typeof window !== "undefined" ? window.location.href : "";
          const text = tr("game.done.shareText", `I fulfilled “${head.title}” on Shadoku in ${time}. Can you beat it?`, { title: head.title, time });
          try { if (typeof navigator !== "undefined" && navigator.share) { await navigator.share({ title: "Shadoku", text, url }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
          try { await navigator.clipboard.writeText(`${text} ${url}`); setShared(true); setTimeout(() => setShared(false), 2200); } catch (e) { /* no clipboard: nothing to confirm */ }
        };
        return (
          <DoneWindow label={tr("game.done.title", "Contract Completed!")} closeLabel={tr("game.dismiss", "Dismiss")} onClose={close}>
            <b className="sk-done-t">{tr("game.done.title", "Contract Completed!")}</b>
            <span className="sk-done-time">⏱ {tr("game.timerSolved", `Solved in ${time}`, { time })}</span>
            {typeof doneExtra === "function" && doneExtra({ id: p.id, close })}
            {p.id === UMBRA_FINALE
              ? <p className="sk-done-lore"><b>{t("game.solved.umbra.title")}</b> {t("game.solved.umbra.text")}</p>
              : <>
                {isRelicCase(p.id) && <RelicCard caseId={p.id} />}
                {rooms.map((r, i) => <span key={i} className="sk-done-room">{r}</span>)}
              </>}
            <div className="sk-done-act">
              {onExit && <button type="button" className="sk-btn primary" onClick={onExit}>{exitLabel || t("game.backToContracts")}</button>}
              <button type="button" className="sk-btn" onClick={share}>{shared ? tr("game.done.copied", "Link copied ✓") : `${tr("game.done.share", "Share")} ↗`}</button>
            </div>
            {nxt && renderEnvelope && (
              <div className="sk-done-next">
                <small>{tr("game.done.next", "Your next contract")}</small>
                <div className="sk-done-env">{omegaNext
                  ? renderEnvelope({ puzzle: nxt, label: nxtLabel, tone: "omega", onPick: () => { close(); setUmbra("sanctum"); } })
                  : blackNext // sealed until the cryptex opens (the Evidence Board), like on the contracts page
                    ? renderEnvelope({ puzzle: nxt, label: nxtLabel, tone: "obsidian", onPick: () => { close(); if (isUnlocked(UMBRA_HARD, solvedIds)) launch(UMBRA_HARD); else setUmbra("board"); } })
                    : renderEnvelope({ puzzle: nxt, label: nxtLabel, onPick: () => { close(); launch(nxt.id); } })}</div>
                <span className="sk-done-lbl">{omegaNext ? t("sanctum.folder.caption") : blackNext ? t("conspiracy.envelope.caption") : `${nxtLabel} · ${(heads[idx + 1] && heads[idx + 1].title) || ""}`}</span>
              </div>
            )}
            <p className="sk-done-coffee">{tr("game.done.coffee", "Enjoying Shadoku?")} <a href="https://buymeacoffee.com/shadoku" target="_blank" rel="noopener noreferrer">☕ {tr("game.done.coffeeLink", "Buy me a coffee")}</a></p>
          </DoneWindow>
        );
      })()}
      {umbra === "board" && <EvidenceBoard onClose={() => setUmbra(null)} onLaunch={launch} />}
      {umbra === "sanctum" && (() => { // Dossier № 000-OMEGA: the Uninvited's findings, and U. M. Bra's own contract in a black envelope
        const finale = puzzles.find((q) => q.id === UMBRA_FINALE) || PUZZLES.find((q) => q.id === UMBRA_FINALE);
        const accept = () => { acceptFinale(); launch(UMBRA_FINALE); };
        return <FinalDossier onClose={() => setUmbra(null)} onAccept={accept}
          envelope={finale && renderEnvelope ? (onOpen) => renderEnvelope({ puzzle: finale, label: t("hub.contractNo", { n: String(finaleNo).padStart(3, "0") }), variant: "modal", onAccept: accept, onOpen }) : null} />;
      })()}
      {ctx && view === "play" && (
        <TileMenu x={ctx.x} y={ctx.y} lit={!!st.lights[key(ctx.r, ctx.c)]} crossed={!!st.crosses[key(ctx.r, ctx.c)]} onClose={closeCtx}
          onPick={(use) => { closeCtx(); beginStroke([ctx.r, ctx.c], null, use); stroke.current = null; }} />
      )}
      {settingsOpen && (
        <SettingsPanel s={settings} set={setOpt} reset={resetOpts} onClose={() => setSettingsOpen(false)} langPicker={langPicker} hover={canHover}
          sample={{ id: suspects[0].id, look: looks[suspects[0].id], color: colorOf(suspects[0].id) }} />
      )}
      {help && <HowTo onClose={() => setHelp(false)}>{typeof helpExtra === "function" ? helpExtra({ close: () => setHelp(false) }) : helpExtra}</HowTo>}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Styles — cozy noir, viewport-locked                                    */
/* ---------------------------------------------------------------------- */
const CSS = `
/* Fonts (Barlow, Special Elite) load from a <link> in index.html: an @import here would hold back this whole sheet until Google answers, and the 900x300 logo would flash unstyled. */
.sk{--bg:#141419;--side:#18181f;--panel:#1c1c25;--panel2:#25252f;--line:#30303f;--fg:#ebe6d9;--muted:#98a0b6;--paper:#F5F0E6;--paper2:#ebe3d1;
  --ink:#1A1A22;--pink:#2a2118;--crimson:#C83E3B;--brass:#D99B26;--brass2:#f0b94a;--focus:#6fd0ff;
  color-scheme:dark;background:var(--bg);color:var(--fg);font:15px/1.45 Barlow,system-ui,sans-serif;
  position:relative;--bar:0px;height:calc(100vh - var(--bar));height:calc(100dvh - var(--bar));overflow:hidden;-webkit-tap-highlight-color:transparent}
.sk *{box-sizing:border-box}
.sk svg{direction:ltr} /* the art and its labels are laid out left to right, also in a right-to-left language */
:where(.sk) button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
.sk button:focus-visible,.sk .hit:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.sk button[disabled]{opacity:.35;cursor:default}
.sk-logo{display:block;height:50px;width:auto;aspect-ratio:3/1;max-width:100%;object-fit:contain;object-position:left center;filter:drop-shadow(0 6px 12px rgba(0,0,0,.45))}

/* ===== desktop: dossier | stage | rail ===== */
.sk-game{display:grid;
  /* the suspects and the board share the width evenly */
  grid-template-columns:minmax(340px,1fr) minmax(360px,1fr) 116px;grid-template-rows:auto minmax(0,1fr);
  grid-template-areas:"head stage rail" "dossier stage rail"}
/* a big board (9×9 and up): the stage is as wide as the board can be at full height, the suspects make room down to 340px
   (desktop only: unscoped, it outranked the phone grid and pushed a big board's page off the screen) */
@media (min-width:961px){.sk-game[data-big]{grid-template-columns:minmax(340px,1fr) min(calc((100vh - var(--bar) - 32px) * var(--ar) + 32px),max(360px,calc(100vw - 116px - 340px))) 116px;
  grid-template-columns:minmax(340px,1fr) min(calc((100dvh - var(--bar) - 32px) * var(--ar) + 32px),max(360px,calc(100vw - 116px - 340px))) 116px}}
.sk-head{grid-area:head;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"logo timer" "nav nav";align-items:center;gap:12px;
  padding:18px 18px 14px;background:var(--side);border-right:1px solid var(--line);position:relative;z-index:8}
.sk-head .sk-logo,.sk-logobtn{grid-area:logo;justify-self:start}
.sk-logobtn{display:block;line-height:0;border-radius:10px}
@media (min-width:961px){ /* desktop: a bigger logo; with room for it, the contract and the timer sit beside it */
  .sk-head .sk-logo{height:56px}
  .sk-head[data-wide]{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"logo nav timer";gap:14px}
  .sk-head[data-wide] .sk-logo{height:56px}
}
.sk-nav{grid-area:nav;display:flex;align-items:center;gap:6px;min-width:0}
.sk-timer{grid-area:timer;display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:var(--panel);
  font-weight:700;font-size:13px;font-variant-numeric:tabular-nums;color:var(--muted);white-space:nowrap}
.sk-timer[hidden]{display:none}
.sk-timer.done{color:var(--brass2);border-color:rgba(217,155,38,.55);background:rgba(217,155,38,.1)}
.sk-help{grid-area:help;display:none}
.sk-arrow,.sk-help{flex:0 0 auto;width:36px;height:38px;border-radius:10px;background:var(--panel);border:1px solid var(--line);font-size:22px;line-height:1;place-items:center}
.sk-arrow{display:grid}
.sk-help{font-size:17px;font-weight:800;color:var(--brass2)}
.sk-menu{position:relative;min-width:0;flex:1 1 auto}
.sk-menu-btn{width:100%;height:38px;display:flex;align-items:center;gap:7px;padding:0 10px;border-radius:10px;background:var(--panel);border:1px solid var(--line)}
.sk-menu-list{position:absolute;top:calc(100% + 6px);left:0;right:0;z-index:30;list-style:none;margin:0;padding:6px;background:var(--panel);border:1px solid var(--line);border-radius:12px;max-height:62vh;overflow:auto;box-shadow:0 18px 40px rgba(0,0,0,.55)}
.sk-menu-list button{width:100%;display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:8px;text-align:left}
.sk-menu-list button:hover,.sk-menu-list button[aria-selected=true]{background:var(--panel2)}
.sk-cn{font-weight:800;color:var(--brass);font-variant-numeric:tabular-nums;min-width:2em}
.sk-ct{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;text-align:left}
.sk-cs{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
.sk-caret{color:var(--muted);font-size:12px}
.sk-ok{color:#73d9a4;font-weight:800}
.sk-diff{font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.08);color:var(--muted)}
.sk-diff{white-space:nowrap;border:1px solid transparent}
.sk-diff.d-tutorial{color:#d9d4f2;background:linear-gradient(135deg,rgba(150,120,214,.34),rgba(201,205,220,.18));border-color:rgba(190,175,236,.45)}
.sk-diff.d-very-easy{color:#8ff0cf;background:rgba(110,231,190,.15)}
.sk-diff.d-easy{color:#73d9a4;background:rgba(115,217,164,.14)}
.sk-diff.d-medium{color:var(--brass2);background:rgba(217,155,38,.16)}
.sk-diff.d-hard{color:#ff8a7a;background:rgba(255,112,92,.2)}
.sk-diff.d-expert{color:#ffd9d6;background:linear-gradient(135deg,#8c1f26,#5e1219);border-color:var(--brass);box-shadow:0 0 0 1px rgba(217,155,38,.22)}
.sk-menu-btn.sk-static{cursor:default}
.sk-menu.locked .sk-menu-btn{opacity:.78;cursor:not-allowed;border-style:dashed}
.sk-lock{display:inline-grid;place-items:center;color:var(--brass2)}

/* dossier */
.sk-dossier{grid-area:dossier;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;display:flex;flex-direction:column;gap:12px;
  padding:4px 18px 22px;background:var(--side);border-right:1px solid var(--line);container:dossier/inline-size}
.sk-dossier>*{flex-shrink:0}
.sk-now{display:none}
.sk-eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:11px;font-weight:700;color:var(--muted)}
.sk-rules{border:1px solid rgba(217,155,38,.6);border-left:4px solid var(--brass);border-radius:10px;background:linear-gradient(180deg,rgba(217,155,38,.12),rgba(217,155,38,.04));padding:9px 12px 10px;display:flex;flex-direction:column;gap:6px}
.sk-rules-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.sk-rules-head span{font:400 15px/1 'Special Elite',monospace;letter-spacing:.06em;color:var(--brass2)}
.sk-rules-head small{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700}
.sk-rule{margin:0;font-size:14px;line-height:1.4;padding-left:14px;position:relative}
.sk-rule:before{content:"§";position:absolute;left:0;color:var(--brass);font-weight:700}
.sk-rule .sk-kw,.sk-rule .sk-nm{color:var(--fg)}

/* suspect grid */
.sk-cast{display:grid;gap:12px;align-items:stretch;
  /* cards hug their Polaroid: as many as fit, always 154px wide, so a taller or shorter tutorial card never resizes them */
  grid-template-columns:repeat(auto-fill,154px);justify-content:center}
.sk-cardw{position:relative;display:flex;width:100%;max-width:154px;justify-self:center}
.sk-cardw .sk-card{flex:1;max-width:none}
.sk-lens{position:absolute;z-index:2;top:-8px;left:-8px;width:26px;height:26px;padding:0;border-radius:50%;border:2px solid #1A1A22;background:var(--brass);color:#1A1A22;display:grid;place-items:center;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.4);transition:transform .12s,background .12s}
.sk-lens:before{content:"";position:absolute;inset:-8px;border-radius:50%} /* a 42px hit area around the 26px badge */
.sk-lens:hover{transform:scale(1.12);background:var(--brass2,#f0b94a)}
.sk-lens:focus-visible{outline:2px solid #6fd0ff;outline-offset:2px}
.sk-card{position:relative;width:100%;text-align:left;color:var(--pink);background:var(--paper);border:2px solid transparent;border-radius:10px;
  box-shadow:0 2px 0 rgba(0,0,0,.35),0 8px 18px rgba(0,0,0,.25);transition:border-color .15s,box-shadow .15s,background .3s,transform .08s}
.sk-card:active{transform:translateY(1px)}
.sk-card{-webkit-user-select:none;user-select:none}
.sk-card:hover{border-color:#cdbf9d}
.sk-card.on{border-color:var(--brass);box-shadow:0 0 0 2px var(--brass),0 0 22px rgba(217,155,38,.35),0 8px 18px rgba(0,0,0,.3)}
.sk-card.placed .sk-alibi{opacity:.7}
.sk-card:not(.adow):not(.placed){background:#bfc2cb;--ab:#aeb1bc} /* light grey until the suspect is placed, then the paper */
.sk-card{transition:background-color .2s}
.sk-card.v{display:flex;flex-direction:column;gap:6px;padding:8px 6px 7px;border-top:5px solid var(--sc)}
.sk-photo{display:block;width:min(100%,138px);margin:0 auto}
.sk-photo svg{width:100%!important;height:auto!important}
.sk-alibi{display:block;font-size:13px;line-height:1.38;overflow-wrap:break-word;hyphens:auto}
.sk-card.v .sk-alibi{flex:1;background:var(--ab,var(--paper2));border-radius:6px;padding:5px 6px;font-size:12.5px;line-height:1.34}
.sk-card.adow{background:#22222c;color:var(--fg)}
.sk-card.v.adow .sk-alibi{background:rgba(0,0,0,.25)}
.sk-nm{font-weight:800;box-shadow:inset 0 -.32em 0 color-mix(in srgb,var(--nc,var(--brass)) 55%,transparent)}
.sk-kw{font-weight:700}
.sk [data-tip]{cursor:help;border-radius:3px;text-decoration:underline dotted;text-underline-offset:3px;transition:background .12s}.sk [data-tip]:hover{background:rgba(217,155,38,.28)}
.sk-neg{font-weight:800;color:#a3302d;text-transform:uppercase;font-size:.88em;letter-spacing:.04em}
.sk-card.adow .sk-neg,.sk-rule .sk-neg{color:#ff8a86}
.sk-rm{font-style:normal;font-weight:700;text-decoration:underline;text-decoration-color:var(--brass);text-decoration-thickness:2px;text-underline-offset:2px}
.sk-pr{font-style:italic;font-weight:600}
.sk-stamp{position:absolute;top:-7px;right:-6px;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:var(--sc,var(--brass));color:#1A1A22;
  border:1.5px solid #1A1A22;font-size:12px;font-weight:800;transform:rotate(-8deg);box-shadow:0 2px 6px rgba(0,0,0,.4)}
.sk-letter{flex:0 0 auto;display:inline-grid;place-items:center;width:19px;height:19px;border-radius:50%;background:var(--sc,var(--brass));color:#1A1A22;border:1.5px solid #1A1A22;font-size:11px;font-weight:800;line-height:1}
.sk-lablink{margin-top:4px;padding:10px;border-radius:10px;border:1px dashed var(--line);color:var(--muted);font-size:13px}

/* stage */
.sk-stage{grid-area:stage;position:relative;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;
  padding:16px 16px calc(16px + var(--ovl,0px));transition:padding .25s ease;
  background:radial-gradient(ellipse at 50% 42%,#20202b 0%,var(--bg) 72%)}
.sk-boardbox{position:relative;flex:0 0 auto;width:min(100%,calc((100vh - var(--bar) - 32px - var(--ovl,0px)) * var(--ar)));width:min(100%,calc((100dvh - var(--bar) - 32px - var(--ovl,0px)) * var(--ar)));transition:width .25s ease}
/* Prop Inspector: cozy-noir badge anchored to a board tile (never takes a click) */
.sk-pi{position:absolute;z-index:30;pointer-events:none;width:max-content;max-width:min(280px,calc(100% - 16px));padding:7px 11px 8px;border-radius:10px;
  background:#181820;border:1.5px solid var(--tipc,#9aa3b5);box-shadow:0 10px 26px rgba(0,0,0,.55);color:var(--fg);transform:translate(-50%,-100%);animation:skTipIn .12s ease-out}
.sk-pi[data-below]{transform:translate(-50%,0)}
.sk-pi::after{content:"";position:absolute;left:var(--ax,50%);bottom:-6px;width:9px;height:9px;margin-left:-4.5px;background:#181820;border:solid var(--tipc,#9aa3b5);border-width:0 1.5px 1.5px 0;transform:rotate(45deg)}
.sk-pi[data-below]::after{bottom:auto;top:-6px;transform:rotate(225deg)}
.sk-pi.tall{--tipc:#D99B26}.sk-pi.perch{--tipc:#e0b85c}.sk-pi.short{--tipc:#b9a27a}.sk-pi.low{--tipc:#9aa3b5}.sk-pi.corpse{--tipc:#C83E3B}
.sk-pi-h{display:flex;align-items:center;flex-wrap:wrap;gap:4px 7px}
.sk-pi-n{font-weight:800;font-size:14px;color:var(--paper)}
.sk-pi-r{margin-top:3px;font-size:13px;font-weight:600;line-height:1.3;color:var(--tipc)}
/* header: timer + settings */
.sk-headr{grid-area:timer;display:flex;align-items:center;gap:8px;justify-self:end}
.sk-gear{flex:0 0 auto;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--panel);border:1px solid var(--line);color:var(--brass2)}
.sk-gear:hover{background:var(--panel2)}
/* clue hover: board highlights and keyword tooltips */
.sk.kw-on [data-hi],.sk.kw-on [data-kw]{cursor:help;border-radius:3px;transition:background .12s}
.sk.kw-on [data-hi]:hover,.sk.kw-on [data-kw]:hover{background:rgba(217,155,38,.28)}
.sk-kwtip{position:absolute;z-index:70;transform:translateX(-50%);width:max-content;max-width:300px;padding:8px 11px;border-radius:10px;background:#181820;border:1.5px solid var(--brass);
  color:var(--fg);font-size:13px;line-height:1.42;box-shadow:0 12px 30px rgba(0,0,0,.55);pointer-events:none;animation:skTipIn .12s ease-out}
.sk-kwtip b{color:var(--brass2)}
.sk-card.hi{box-shadow:0 0 0 3px #f0b94a,0 0 20px rgba(240,185,74,.6)}
/* ♀ / ♂ */
.sk-gsym{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:#fff;border:1.5px solid currentColor;box-shadow:0 1px 3px rgba(0,0,0,.35);pointer-events:none}
.sk-gsym svg{display:block;width:15px;height:15px}
.sk-gsym.f{color:#d0307a}.sk-gsym.m{color:#1f68c9}
/* on a card: centred under the magnifying glass (the lens is 26px at -8px,-8px), same corner in every layout */
.sk-cardw>.sk-gsym{position:absolute;z-index:2;top:22px;left:-6px}
.sk-gsym.inl{position:relative;display:inline-grid;vertical-align:middle;margin-inline-start:7px;width:19px;height:19px}
.sk-gsym.inl svg{width:13px;height:13px}
/* portrait mode off: a list */
.sk-cast.list{grid-template-columns:minmax(0,1fr);justify-content:stretch}
.sk-cast.list .sk-cardw{max-width:none;justify-self:stretch}
.sk-cast.list .sk-card.v{display:grid;grid-template-columns:74px minmax(0,1fr);align-items:center;gap:8px;padding:6px 34px 6px 6px;border-top:0;border-left:5px solid var(--sc)}
.sk-cast.list .sk-photo{width:100%}
.sk-cast.list .sk-card.v .sk-alibi{background:none;padding:0;font-size:13.5px}
/* How to play */
.sk-howwrap>.sk-how{background:var(--panel);color:var(--fg);border:1px solid var(--line);max-width:none;width:min(720px,100%);max-height:min(90vh,900px);max-height:min(90dvh,900px);display:flex;flex-direction:column;padding:0;overflow:hidden}
.sk-how-h{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px 10px;border-bottom:1px solid var(--line)}
.sk-how-h h2{margin:0;color:var(--paper)}
.sk-how-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:12px 18px 6px}
.sk-how-tabs button{min-height:40px;padding:6px 8px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--muted);font-weight:800;font-size:14px}
.sk-how-tabs button[aria-selected=true]{background:var(--bg);color:var(--fg);border-color:var(--brass);box-shadow:0 3px 0 rgba(0,0,0,.5)}
.sk-how-body{overflow-y:auto;overscroll-behavior:contain;padding:6px 18px 20px;font-size:15.5px;line-height:1.55}
.sk-how-body h3{margin:16px 0 6px;font-size:17px;color:var(--paper)}
.sk-how-body ul{margin:0;padding-inline-start:20px;display:flex;flex-direction:column;gap:6px}
.sk-how-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:6px}
.sk-how-card{display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px;border-radius:14px;background:var(--panel2);border:1.5px solid #3a3a4a;text-align:center}
.sk-how-card p{margin:0;font-size:14px;line-height:1.4;color:var(--fg)}
.sk-how-kw{font-size:17px;color:var(--paper)}
.sk-mini{display:block;max-width:100%;height:auto;margin-top:auto}
.sk-how-adv{margin-top:12px;padding:12px 14px;border-radius:14px;background:var(--panel2);border:1.5px solid #3a3a4a}
.sk-how-adv h3{margin:0 0 4px}.sk-how-adv>p{margin:0}
.sk-how-ex{display:flex;align-items:center;gap:14px;margin-top:10px}.sk-how-ex p{margin:0;font-size:14px;color:var(--fg)}
.sk-how-faqh{display:inline-block;border-bottom:2px solid var(--brass);padding-bottom:3px}
.sk-how-faq{margin-top:8px;border-radius:10px;background:var(--panel2);border:1px solid #3a3a4a}
.sk-how-faq summary{cursor:pointer;padding:11px 14px;font-weight:800;list-style-position:inside}
.sk-how-faq p{margin:0;padding:0 14px 12px;color:var(--fg)}
@media (max-width:560px){.sk-how-tabs{grid-template-columns:repeat(2,1fr)}.sk-how-ex{flex-direction:column;align-items:flex-start}}
/* the settings panel */
.sk-modal.sk-setwrap{z-index:58}
.sk-modal>.sk-set{width:min(520px,100%);max-width:520px;max-height:min(88vh,860px);max-height:min(88dvh,860px);padding:0;display:flex;flex-direction:column;overflow:hidden;overflow:clip;
  background:#1f1f2a;color:var(--fg);border:1px solid #3a3a4c;box-shadow:0 24px 60px rgba(0,0,0,.6)}
.sk-set-h{display:flex;align-items:center;justify-content:space-between;padding:14px 12px 12px 20px;border-bottom:1px solid var(--line)}
.sk-modal .sk-set-h h2{margin:0;color:var(--brass2)}
.sk-set-x{width:40px;height:40px;font-size:24px;color:var(--muted)}
.sk-modal>.sk-set{height:min(88vh,640px);height:min(88dvh,640px)} /* one height for every tab: the panel does not jump when the tab changes */
.sk-modal>.sk-set{min-width:0}
.sk-set-tabs{display:flex;flex:none;min-width:0;max-width:100%;gap:4px;padding:8px 12px 0;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none}
.sk-set-tabs::-webkit-scrollbar{display:none}
.sk-set-tabs button{flex:1 0 auto;white-space:nowrap;padding:9px 12px;border-radius:10px 10px 0 0;border:1px solid transparent;border-bottom:0;margin-bottom:-1px;font-weight:700;font-size:14.5px;color:var(--muted)}
.sk-set-tabs button:hover{color:var(--fg)}
.sk-set-tabs button[aria-selected=true]{background:#1f1f2a;color:var(--brass2);border-color:var(--line);box-shadow:inset 0 2px 0 var(--brass)}
.sk-set-tabs button:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}
.sk-set-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:6px 20px 16px;scrollbar-width:thin;overscroll-behavior:contain}
.sk-set-row{padding:12px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.sk-set-row>b,.sk-set-txt b{display:block;font-size:15.5px;font-weight:800;color:#f3efe6}
.sk-set-row small,.sk-set-txt small{display:block;font-size:13px;line-height:1.4;color:#a9adbd;margin-top:3px}
/* position:relative keeps each hidden checkbox inside the scrolling list: anchored to the panel, focusing it scrolled the whole panel blank */
.sk-set-sw{position:relative;display:flex;align-items:center;gap:14px;cursor:pointer}
.sk-set-txt{flex:1 1 auto;min-width:0}
.sk-set-sw input{position:absolute;opacity:0;width:1px;height:1px}
.sk-set-sw i{flex:0 0 auto;position:relative;width:42px;height:24px;border-radius:999px;background:#3a3a4c;transition:background .15s}
.sk-set-sw i:after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#d9d6cc;transition:transform .15s}
.sk-set-sw input:checked+i{background:var(--brass)}
.sk-set-sw input:checked+i:after{transform:translateX(18px);background:#fff}
.sk-set-sw input:focus-visible+i{outline:2px solid var(--focus);outline-offset:2px}
.sk-set-subs{margin:10px 0 0 4px;padding-left:12px;border-left:2px solid #3a3a4c;display:flex;flex-direction:column;gap:7px}
.sk-set-sub{display:flex;align-items:flex-start;gap:9px;font-size:14.5px;cursor:pointer}
.sk-set-sub small{display:inline;color:#a9adbd;font-size:13px}
.sk-set-sub input{width:17px;height:17px;margin:2px 0 0;accent-color:var(--brass);flex:0 0 auto;cursor:pointer}
.sk-set-sub.off{opacity:.45;cursor:default}
.sk-set-sl>div{display:flex;align-items:center;gap:10px;margin-top:8px}
.sk-set-sl input{flex:1 1 auto;min-width:0;accent-color:var(--brass)}
.sk-set-sl small{margin:0!important;white-space:nowrap}.sk-set-sl .v{min-width:3.2em;text-align:right;color:#f3efe6!important;font-weight:700}
.sk-set-lang .sh-select-wrap{margin-top:8px;width:100%}.sk-set-lang .sh-select{max-width:none!important;width:100%}
.sk-set-opts{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0 2px}
.sk-set-opt{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:96px;padding:10px 12px 8px;border-radius:12px;border:1.5px solid #3a3a4c;background:#17171f;font-weight:700;font-size:14px}
.sk-set-opt.on{border-color:var(--brass2);background:rgba(217,155,38,.12);color:var(--brass2)}
.sk-set-ic{display:grid;grid-auto-flow:column;place-content:center;align-items:center;height:44px;font-size:24px;letter-spacing:-.1em}
.sk-set-ic sub{font-size:12px;font-weight:800;letter-spacing:0;margin:10px 4px 0 1px;color:#a9adbd} /* "Light, double: X": 1 click, 2 clicks */
.sk-ctx{position:fixed;z-index:70;min-width:150px;display:flex;flex-direction:column;padding:5px;border-radius:12px;background:var(--panel);border:1px solid var(--line);box-shadow:0 14px 34px rgba(0,0,0,.6)}
.sk-ctx button{display:flex;align-items:center;gap:9px;padding:9px 12px;border-radius:8px;font-weight:700;font-size:15px;text-align:start}
.sk-ctx button:hover,.sk-ctx button:focus-visible{background:var(--panel2);outline:none}
.sk-ctx button[aria-checked=true]{color:var(--brass2)}
.sk-set-tint{min-width:68px;padding:9px 8px 7px;font-size:13px}
.sk-syms{display:flex;flex-direction:column;align-items:center;gap:8px}
.sk-syms-row{display:flex;flex-wrap:wrap;justify-content:center;gap:10px}
.sk-sym{width:56px;height:56px;display:grid;place-items:center;border-radius:12px;background:var(--panel2);border:2px solid var(--line);transition:transform .08s,border-color .15s,box-shadow .15s}
.sk-sym svg{width:34px;height:34px}
.sk-sym:hover{border-color:#55556e}
.sk-sym:active{transform:scale(.95)}
.sk-sym[aria-pressed=true]{border-color:var(--brass);box-shadow:0 0 0 3px rgba(217,155,38,.18)}
.sk-sym:focus-visible{outline:2px solid #6fd0ff;outline-offset:2px}
.sk-symic{width:18px;height:18px;vertical-align:-3px;margin-inline-end:6px}
.sk-set-symrow{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0 2px}
.sk-set-sym{width:48px;height:48px;display:grid;place-items:center;border-radius:12px;border:1.5px solid #3a3a4c;background:#17171f;opacity:.45;transition:opacity .12s,border-color .12s}
.sk-set-sym svg{width:30px;height:30px}
.sk-set-sym.on{opacity:1;border-color:var(--brass2);background:rgba(217,155,38,.12)}
.sk-set-sym:focus-visible{outline:2px solid #6fd0ff;outline-offset:2px}
.sk-set-dot{width:22px;height:22px;border-radius:50%;background:var(--tc);border:2px solid rgba(0,0,0,.45);box-shadow:0 0 10px var(--tc)}
.sk-tool.sk-light{touch-action:none;-webkit-touch-callout:none} /* touch: holding it opens the colour strip */
.sk-tints{position:fixed;z-index:70;display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 10px 6px;border-radius:16px;background:var(--panel);border:1px solid var(--line);box-shadow:0 14px 34px rgba(0,0,0,.6)}
.sk-tints-row{display:flex;gap:8px}
.sk-tint{width:38px;height:38px;border-radius:50%;background:var(--tc);border:2px solid rgba(0,0,0,.45);box-shadow:0 0 12px -2px var(--tc);transition:transform .12s}
.sk-tint:hover,.sk-tint:focus-visible{transform:scale(1.1);outline:none}
.sk-tint[aria-checked=true]{transform:scale(1.15);box-shadow:0 0 0 3px var(--panel),0 0 0 5px var(--brass2),0 0 14px var(--tc)}
.sk-tints-cap{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
@media (prefers-reduced-motion:reduce){.sk-tint{transition:none}}
.sk-set-f{display:flex;justify-content:space-between;gap:10px;padding:12px 20px;border-top:1px solid var(--line)}
.sk-set-reset{font-size:13.5px;font-weight:600;color:var(--muted);text-decoration:underline;text-underline-offset:3px}
.sk-set-done{padding:8px 18px;border-radius:10px;background:var(--brass);color:#1b1305;font-weight:800}
/* short screens (a phone held sideways): a slim header and footer, so the list of options keeps most of the height */
@media (max-height:520px){
  .sk-modal.sk-setwrap{padding:8px}
  .sk-modal>.sk-set{max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px)}
  .sk-set-h{padding:6px 8px 6px 18px}.sk-modal .sk-set-h h2{font-size:20px}
  .sk-set-tabs{padding:4px 12px 0}.sk-set-tabs button{padding:6px 12px}
  .sk-set-body{padding:2px 18px 10px}.sk-set-row{padding:9px 0}
  .sk-set-f{padding:6px 18px}.sk-set-done{padding:6px 16px}
}
/* Inspect panel: the floorplan's props and what each one does */
.sk-insp{position:absolute;z-index:40;right:124px;bottom:16px;width:min(330px,calc(100% - 140px));max-height:calc(100% - 32px);display:flex;flex-direction:column;
  background:#181820;border:1.5px solid var(--brass);border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.6);color:var(--fg);animation:skIn .18s ease}
.sk-insp-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 8px 8px 14px;border-bottom:1px solid var(--line)}
.sk-insp-h b{font:400 16px/1.1 'Special Elite',monospace;letter-spacing:.05em;color:var(--brass2)}
.sk-insp-x{width:40px;height:40px;font-size:22px;color:var(--muted)}
.sk-insp-list{list-style:none;margin:0;padding:6px 8px;overflow-y:auto;scrollbar-width:thin;display:flex;flex-direction:column;gap:2px;min-height:0}
.sk-insp-row{display:grid;grid-template-columns:34px minmax(0,1fr);grid-template-areas:"ic n" "ic tags";column-gap:9px;align-items:center;padding:6px 6px;border-radius:8px}
.sk-insp-row:hover{background:rgba(255,255,255,.05)}
.sk-insp-ic{grid-area:ic;width:34px;height:34px;overflow:visible}
.sk-insp-n{grid-area:n;font-weight:800;font-size:14px;color:var(--paper)}
.sk-insp-tags{grid-area:tags;display:flex;flex-wrap:wrap;gap:3px 10px}
.sk-insp-tag{font-size:12px;font-weight:600;color:var(--muted);display:inline-flex;align-items:center;gap:5px}
.sk-insp-tag:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.sk-insp-tag.yes{color:#73d9a4}.sk-insp-tag.no{color:#ff9a8f}
.sk-insp-empty{padding:10px 8px;color:var(--muted);font-size:13px}
.sk-insp-opt{display:flex;align-items:center;gap:9px;padding:10px 14px 12px;border-top:1px solid var(--line);font-size:13.5px;font-weight:600;cursor:pointer}
.sk-insp-opt input{width:17px;height:17px;accent-color:var(--brass);cursor:pointer}
@keyframes skTipIn{from{opacity:0}to{opacity:1}}
.sk-viewport{width:100%;aspect-ratio:var(--ar);overflow:hidden;border-radius:14px;box-shadow:0 18px 44px rgba(0,0,0,.5)}
.sk-viewport[data-zoomed]{overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
.sk-zoomer{width:calc(100% * var(--z,1))}
/* zoomed in, the view fills the whole board column (the zoom stays relative to the board at its fitted size) */
.sk-boardbox.zoomed{width:100%;align-self:stretch;display:flex;flex-direction:column}
.sk-boardbox.zoomed .sk-viewport{flex:1 1 auto;min-height:0;aspect-ratio:auto;display:flex;container-type:size;background:#0e0f15}
.sk-boardbox.zoomed .sk-zoomer{flex:0 0 auto;margin:auto;width:calc(min(100cqw,100cqh * var(--ar)) * var(--z,1))}
.sk-board{display:block;width:100%;height:auto;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;border-radius:14px}
.sk-viewport[data-zoomed] .sk-board{touch-action:pan-x pan-y}
.sk-zoom{position:absolute;right:14px;bottom:calc(14px + var(--ovl,0px));z-index:4;display:flex;flex-direction:column;gap:4px;padding:4px;border-radius:12px;
  background:rgba(20,20,25,.8);border:1px solid var(--line);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:bottom .25s ease}
.sk-zoom button{display:grid;place-items:center;padding:0;line-height:1;width:32px;height:32px;border-radius:8px;font-size:19px;font-weight:700;color:var(--fg)}
.sk-zoom button svg{display:block}
.sk-zoom button:hover:not([disabled]){background:var(--panel2)}
.sk-zoom .rst{font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--brass2);width:auto;min-width:32px;padding:0 6px}
/* desktop: the zoom block sits in the tool rail under Undo */
.sk-rail .sk-zoom{position:static;display:grid;grid-template-columns:1fr 1fr;gap:4px;width:100%;padding:4px;border-radius:14px;background:var(--panel2);border-color:transparent;backdrop-filter:none;-webkit-backdrop-filter:none;transition:none}
.sk-rail .sk-zoom button{width:100%;height:34px}
.sk-rail .sk-zoom button:hover:not([disabled]){background:#34343f}
.sk-boardbox:not(.has-zoom)>.sk-zoom{left:auto;right:8px;top:8px;bottom:auto} /* touch screens: Reset alone, over the board's corner while zoomed in */
.sk-zoom .rst.solo{width:auto;min-width:0;height:32px;padding:0 10px;font-size:11px}
.sk-rail .sk-zoom .rst{grid-column:1 / -1;min-width:0;padding:0 2px;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sk-game[data-tight] .sk-rail .sk-zoom button{height:26px}
@media (max-height:780px) and (min-width:961px){.sk-rail .sk-zoom button{height:28px}}
/* replay gate: a contract that is already solved opens blurred behind a choice */
.sk-viewport{transition:filter .3s ease}
.sk-boardbox.gated .sk-viewport{filter:blur(9px) brightness(.7) saturate(.8)}
.sk-replay{position:absolute;inset:0;z-index:12;display:grid;place-items:center;padding:16px}
.sk-replay-card{width:min(360px,100%);display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px 20px 16px;border-radius:16px;border:1px solid var(--brass);text-align:center;
  background:linear-gradient(180deg,rgba(40,32,18,.97),rgba(26,24,22,.97));box-shadow:0 0 28px rgba(217,155,38,.3),0 18px 40px rgba(0,0,0,.55);animation:skIn .3s ease}
.sk-replay-card b{font:400 22px/1.1 'Special Elite',monospace;letter-spacing:.14em;color:var(--brass2)}
.sk-replay-card span{font-size:14px;color:var(--fg)}
.sk-replay-act{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:6px}
.sk-replay-act .sk-btn{padding:9px 14px;background:rgba(255,255,255,.1);color:var(--fg)}
.sk-replay-act .sk-btn.primary{background:var(--brass);color:#1b1305}
/* desktop: the draggable line between the suspects and the board */
.sk-split{display:none}
.sk-overlay{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:5;width:min(580px,calc(100% - 120px));min-width:min(300px,calc(100% - 24px));display:flex;flex-direction:column;gap:8px}
.sk-hint{position:relative;display:flex;align-items:flex-start;gap:12px;background:var(--paper);color:var(--pink);border-radius:12px;padding:10px 14px 11px 12px;box-shadow:0 12px 30px rgba(0,0,0,.5);animation:skIn .25s ease}
.sk-hint-pic{flex:0 0 64px;width:64px;margin:2px 0 0;filter:drop-shadow(0 3px 5px rgba(0,0,0,.35))}
.sk-hint-main{flex:1 1 auto;min-width:0}
.sk-hint p{margin:5px 0 9px;font-size:14px;line-height:1.48}
.sk-hint-why{list-style:none;margin:2px 0 6px;padding:0;display:flex;flex-direction:column;gap:3px;max-height:34vh;overflow-y:auto;scrollbar-width:thin}
.sk-hint-why button{display:block;width:100%;text-align:start;padding:4px 8px;border-radius:8px;font-size:13.5px;line-height:1.38;color:#6e6250;border-inline-start:3px solid #d8cdb4} /* ink on the hint's paper, not the dark theme's colours */
.sk-hint-why button:hover{background:rgba(26,26,34,.06);color:var(--pink)}
.sk-hint-why button[aria-pressed=true]{color:var(--pink);border-color:#2b8fc4;background:rgba(111,208,255,.2)}
.sk-hint-why.key{max-height:20vh}.sk-hint-why.key~.sk-hint-why{max-height:24vh} /* key lines + groundwork together keep the board in view */
.sk-hint-why.key button{color:var(--pink);font-size:14px;border-color:var(--brass)} /* the key deduction reads first */
.sk-hint-why span{display:block;padding:4px 8px;font-size:14px;line-height:1.4;border-inline-start:3px solid var(--brass)}
.sk-hint-why .sk-hint-run{font-style:italic;font-weight:600}
.sk-hint-ground{display:inline-flex;align-items:center;gap:7px;margin:0 0 6px;padding:3px 10px 3px 3px;border-radius:99px;border:2px solid #1A1A22;background:var(--paper2);color:#1A1A22;font-size:12.5px;font-weight:700;cursor:pointer}
.sk-hint-ground[aria-expanded=true],.sk-hint-ground:hover{background:var(--brass)}
.sk-rung{font-size:11px;font-weight:800;padding:1px 7px;border-radius:6px;background:#efe3c4;color:#6e5320}
.sk-hint-head{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding-right:24px}
.sk-hint-x{position:absolute;z-index:2;top:4px;right:6px;width:28px;height:28px;font-size:21px;color:#6e6250}
.sk-step{font-weight:800;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6e6250}
.sk-rname{font-weight:700;font-size:13px}
.sk-tier{font-size:11px;font-weight:800;padding:1px 7px;border-radius:6px}
.sk-tier.t1{background:#d8efe1;color:#2f7d56}.sk-tier.t2{background:#dbeaf5;color:#2f5d8a}.sk-tier.t3{background:#f6d9d7;color:#a3302d}
.sk-hint-act{display:flex;gap:8px;flex-wrap:wrap}
.sk-btn{padding:6px 12px;border-radius:9px;font-weight:700;font-size:13.5px;background:rgba(0,0,0,.07);color:var(--pink)}
.sk-btn.primary{background:var(--brass);color:#1b1305}
.sk-solved{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 12px;padding:11px 14px;border-radius:14px;border:1px solid var(--brass);
  background:linear-gradient(90deg,rgba(40,32,18,.96),rgba(26,24,22,.96));box-shadow:0 0 28px rgba(217,155,38,.3),0 12px 30px rgba(0,0,0,.5);animation:skIn .35s ease}
.sk-solved b{display:block;font:400 21px/1.1 'Special Elite',monospace;letter-spacing:.14em;color:var(--brass2)}
.sk-solved span{font-size:14px;color:var(--fg)}
.sk-solved .sk-solved-more{display:block;margin-top:2px}
.sk-solved>div{flex:1 1 220px;min-width:0}
.sk-verdict{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px 10px 14px;border-radius:14px;border:1px solid var(--crimson);
  background:linear-gradient(90deg,rgba(48,20,22,.97),rgba(28,22,24,.97));box-shadow:0 12px 30px rgba(0,0,0,.5);animation:skIn .25s ease}
.sk-verdict b{display:block;font:400 18px/1.1 'Special Elite',monospace;letter-spacing:.14em;color:#ff7d79}
.sk-verdict span{font-size:14px;color:var(--fg)}
.sk-verdict button{flex:0 0 auto;width:30px;height:30px;font-size:22px;color:var(--muted)}
.sk-submit.ready{background:var(--brass);color:#1b1305;border-color:var(--brass2);box-shadow:0 0 0 3px rgba(217,155,38,.2)}
.sk-submit.ready:hover:not([disabled]){background:var(--brass2)}
.sk-submit.ready small,.sk-submit.ready .sub{color:#1b1305}
.sk-submit[disabled]:not(.ready){opacity:.5}
.sk-submit.ready[disabled]{opacity:1}
.sk-solved button{flex:0 0 auto;padding:9px 14px;border-radius:10px;background:var(--brass);color:#1b1305;font-weight:800}
.sk-solved-wrap{display:flex;flex-direction:column;gap:0}
/* the "Contract Completed!" pop-up */
.sk-done{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;overflow:auto;background:rgba(6,6,10,.78);animation:skIn .25s ease}
.sk-done-card{position:relative;width:min(420px,100%);margin:auto;display:flex;flex-direction:column;align-items:center;gap:10px;padding:22px 20px 14px;border-radius:18px;border:1px solid var(--brass);text-align:center;color:var(--fg);
  background:linear-gradient(180deg,rgba(44,35,19,.98),rgba(24,22,21,.98));box-shadow:0 0 36px rgba(217,155,38,.32),0 22px 50px rgba(0,0,0,.6)}
.sk-done-x{position:absolute;top:6px;inset-inline-end:8px;width:32px;height:32px;font-size:24px;line-height:1;color:var(--muted)}
.sk-done-t{font:400 25px/1.1 'Special Elite',monospace;letter-spacing:.1em;color:var(--brass2);padding:0 14px}
.sk-done-lore{margin:0;font-size:14px}
.sk-done-time{font:600 16px Barlow,system-ui,sans-serif;color:var(--fg);font-variant-numeric:tabular-nums}
.sk-done-room{font-size:13.5px;color:var(--muted)}
.sk-done-card .um-relic,.sk-done-card .sk-umbra-tok{text-align:start;width:100%;margin-top:0}
.sk-done-act{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:2px}
.sk-done-act .sk-btn{padding:9px 16px;background:rgba(255,255,255,.1);color:var(--fg)}
.sk-done-act .sk-btn.primary{background:var(--brass);color:#1b1305}
.sk-done-next{display:flex;flex-direction:column;align-items:center;gap:2px;width:100%;margin-top:4px;padding-top:12px;border-top:1px dashed rgba(217,155,38,.35)}
.sk-done-next small{font:600 12px/1.2 'Barlow',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.sk-done-env{width:min(230px,70%)}
.sk-done-lbl{font:600 13px/1.3 'Barlow',sans-serif;color:var(--fg)}
.sk-done-coffee{margin:2px 0 0;padding-top:10px;width:100%;border-top:1px solid rgba(255,255,255,.1);font-size:13.5px;color:var(--muted)}
.sk-done-coffee a{margin-inline-start:4px;font-weight:700;color:var(--brass2);text-decoration:underline;text-underline-offset:2px}
.sk-umbra-tok{display:flex;align-items:center;gap:10px;margin-top:8px;padding:6px 10px;border-radius:12px;border:1px dashed #5a5566;background:rgba(10,10,14,.6);font:600 13.5px/1.35 'Barlow',sans-serif;color:var(--fg)}

/* rail */
.sk-rail{grid-area:rail;display:flex;flex-direction:column;justify-content:space-between;gap:12px;padding:18px 12px;background:var(--side);border-left:1px solid var(--line);min-height:0;position:relative;z-index:50} /* above the Inspect panel (40): the rail's ☰ Menu opens over everything */
.sk-rail-group{display:flex;flex-direction:column;gap:10px}
.sk-railmenu{position:relative}
.sk-railmenu-btn{width:100%;height:40px;display:flex;align-items:center;justify-content:center;gap:7px;border-radius:12px;background:var(--panel);border:1px solid var(--line);font-weight:700;font-size:13px;color:var(--fg)}
.sk-railmenu-btn:hover,.sk-railmenu-btn[aria-expanded=true]{border-color:var(--brass);color:var(--brass2)}
.sk-railmenu-list{position:absolute;top:calc(100% + 6px);inset-inline-end:0;z-index:40;min-width:200px;display:flex;flex-direction:column;padding:6px;border-radius:12px;background:var(--panel);border:1px solid var(--line);box-shadow:0 18px 40px rgba(0,0,0,.6)}
.sk-railmenu-list>*{display:block;width:100%;padding:11px 14px;border-radius:8px;text-align:start;color:var(--fg);text-decoration:none;font:600 15px Barlow,system-ui,sans-serif}
.sk-railmenu-list>*:hover,.sk-railmenu-list>*:focus-visible{background:rgba(217,155,38,.14);outline:none}
.sk-railmenu-list>.sk-railmenu-h{margin-top:4px;padding:8px 14px 4px;border-top:1px solid var(--line);border-radius:0;font:600 13px Barlow,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--brass2);cursor:default}
.sk-railmenu-list>.sk-railmenu-h{display:flex;align-items:center;justify-content:space-between;gap:10px;border-inline:0;border-bottom:0;cursor:pointer}
.sk-railmenu-h .fold{width:7px;height:7px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg) translateY(-2px);transition:transform .15s}.sk-railmenu-h[aria-expanded=false] .fold{transform:rotate(-45deg)}
.sk-railmenu-list>.sub{padding-inline-start:26px}
.sk-rail-cap{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);text-align:center;font-weight:700;margin-bottom:-2px}
.sk-tool{position:relative;width:100%;min-height:80px;padding:9px 4px 8px;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
  background:var(--panel2);border:1.5px solid transparent;transition:transform .08s,background .15s,border-color .15s,box-shadow .15s;touch-action:manipulation;-webkit-user-select:none;user-select:none}
.sk-tool:hover:not([disabled]){background:#2c2c38}
.sk-tool:active:not([disabled]){transform:translateY(1px) scale(.97)}
.sk-tool[aria-pressed=true]{border-color:var(--brass);background:rgba(217,155,38,.15);box-shadow:0 0 0 3px rgba(217,155,38,.14)}
.sk-card.coach,.sk-tool.coach{animation:skCoach 1.3s ease-in-out infinite;border-color:var(--brass)}
@keyframes skCoach{0%,100%{box-shadow:0 0 0 2px rgba(217,155,38,.35),0 0 8px rgba(217,155,38,.2)}50%{box-shadow:0 0 0 4px rgba(217,155,38,.95),0 0 26px rgba(217,155,38,.7)}}
.sk-coachring{animation:skCoachRing 1.3s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes skCoachRing{0%,100%{opacity:.35;transform:scale(.96)}50%{opacity:1;transform:scale(1.03)}}
@media (prefers-reduced-motion:reduce){.sk-card.coach,.sk-tool.coach,.sk-coachring{animation:none;box-shadow:0 0 0 3px var(--brass)}.sk-coachring{opacity:1}}
.sk-tool .ic{font-size:24px;line-height:1;position:relative}
.sk-tool .ic.q{font-weight:800;color:var(--brass2);font-size:23px}
.sk-tool small{font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;position:relative;white-space:nowrap}
.sk-tool[aria-pressed=true] small{color:var(--brass2)}
.sk-tool .sub.mob{display:none}
.sk-tool .lb2{display:block;text-align:center}
.sk-tool .sub{font-size:10px;line-height:1.2;color:var(--muted);text-align:center;position:relative;padding:0 2px}
.sk-eraser{touch-action:none}
.sk-fill{position:absolute;inset:0;border-radius:13px;background:linear-gradient(to top,rgba(200,62,59,.6),rgba(217,155,38,.3));transform-origin:bottom;transform:scaleY(var(--h,0));pointer-events:none}
.sk-ring{position:absolute;inset:-1.5px;width:calc(100% + 3px);height:calc(100% + 3px);pointer-events:none;overflow:visible}
.sk-ring rect{fill:none;stroke:var(--crimson);stroke-width:3;stroke-linecap:round}
.sk-tip{position:absolute;right:calc(100% + 12px);top:50%;transform:translateY(-50%);z-index:20;white-space:nowrap;background:var(--paper);color:var(--pink);
  font-size:12.5px;font-weight:800;padding:6px 10px;border-radius:999px;box-shadow:0 6px 16px rgba(0,0,0,.45);font-variant-numeric:tabular-nums;pointer-events:none}

/* inspector view */
.sk.sk-labview{display:flex;flex-direction:column}
.sk-labbar{flex:0 0 auto;display:flex;align-items:center;gap:16px;padding:10px 18px;border-bottom:1px solid var(--line);background:var(--side)}
.sk-labbar .sk-logo{height:34px}
.sk-tabs{display:flex;gap:6px;overflow-x:auto;min-width:0;scrollbar-width:none}
.sk-tabs button{padding:7px 13px;border-radius:999px;border:1px solid var(--line);background:var(--panel);white-space:nowrap;font-weight:600;font-size:14px}
.sk-tabs button[aria-selected=true]{border-color:var(--brass);color:var(--brass2);background:var(--panel2)}
.sk-labscroll{flex:1 1 auto;min-height:0;overflow:auto;padding:18px;overscroll-behavior:contain}

@media (min-width:961px) and (min-height:521px){.sk-overlay:has(>.sk-hint){width:min(920px,calc(100% - 120px))}} /* the hint uses the room a narrower suspects column leaves */
@media (min-width:961px){
  .sk-game[data-split]{grid-template-columns:minmax(340px,1fr) max(300px,min(var(--stagew),calc(100% - 456px))) 116px}
  .sk-split{display:block;position:absolute;z-index:7;top:0;bottom:0;left:0;width:10px;cursor:col-resize;touch-action:none}
  [dir=rtl] .sk-split{left:auto;right:0} /* right to left: the suspects are on the right of the board */
  .sk-split:after{content:"";position:absolute;top:50%;left:3px;width:4px;height:56px;margin-top:-28px;border-radius:2px;background:#3a3a4c;transition:background .15s,height .15s}
  .sk-split:hover:after,.sk-split:focus-visible:after,.sk-dragging .sk-split:after{background:var(--brass);height:84px;margin-top:-42px}
  .sk-split:focus-visible{outline:none}
  .sk-dragging{cursor:col-resize;user-select:none;-webkit-user-select:none}
  .sk-dragging .sk-boardbox,.sk-dragging .sk-stage{transition:none}
}
@media (min-width:961px){.sk-game[data-tight] .sk-tool{min-height:56px;padding:4px 3px;gap:1px}.sk-game[data-tight] .sk-rail{gap:6px;padding:8px 10px}.sk-game[data-tight] .sk-rail-group{gap:5px}.sk-game[data-tight] .sk-tool .ic{font-size:18px}.sk-game[data-tight] .sk-tool .sub{display:none}.sk-game[data-tight] .sk-tool .sub.keep{display:block}.sk-game[data-tight] .sk-rail-cap{display:none}}
@media (max-height:980px) and (min-width:961px){.sk-tool{min-height:64px;padding:5px 4px}.sk-rail{gap:8px;padding:12px 10px}.sk-rail-group{gap:6px}.sk-tool .ic{font-size:20px}}
@media (max-height:820px) and (min-width:961px){.sk-tool{min-height:54px;padding:4px 3px;gap:1px}.sk-tool .sub{display:none}.sk-rail{gap:6px;padding:8px 10px}.sk-rail-group{gap:5px}.sk-tool .ic{font-size:18px}.sk-railmenu-btn{height:34px}.sk-rail-cap{display:none}}
@media (max-height:700px) and (min-width:961px){.sk-tool{min-height:44px}.sk-tool small{font-size:9.5px}.sk-tool .lb2{display:none}}
/* ===== mobile & tablet portrait: header | board | dossier (scrolls) | dock (MOBILE_MQ: a phone held sideways uses the short-landscape block below) ===== */
@media (max-width:960px) and (orientation:portrait),(max-width:960px) and (min-height:521px){
  .sk-game{grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr) auto;grid-template-areas:"head" "stage" "dossier" "rail"}
  .sk-head{grid-template-columns:auto minmax(0,1fr) auto auto;grid-template-rows:auto;grid-template-areas:"logo nav timer help";gap:7px;
    padding:calc(7px + env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) 7px max(10px,env(safe-area-inset-left));border-right:0;border-bottom:1px solid var(--line)}
  .sk-head .sk-logo{height:38px;filter:none}
  .sk-head.merged{display:flex;align-items:center;gap:6px;position:relative;z-index:20} /* position: the site menus hang from it */
  .sk-head.merged .sk-logobtn{margin-inline-end:auto;min-width:0}
  .sk-head.merged .sk-logo{height:36px;max-width:100%}
  .sk-head.merged .sk-headr{gap:6px}
  .sk-head.merged .sk-gear,.sk-head.merged .sk-help{width:36px;height:36px}
  .sk-headend{display:flex;align-items:center;gap:6px}
  .sk-headend .sh-controls{gap:6px}
  .sk-headend .sh-btn{min-height:36px;height:36px;padding:0 11px;font-size:14px}
  .sk-headend .sh-burger{width:36px;height:36px}
  .sk-headend .sh-userchip-name{display:none}
  .sk-casebar{display:flex;justify-content:center;min-width:0}
  .sk-casebar .sk-nav,.sk-casebar > *{max-width:100%}
  .sk-help{display:grid;width:40px;height:40px}
  .sk-arrow{width:34px;height:40px;font-size:20px}
  .sk-menu-btn{height:40px;padding:0 8px;gap:5px}
  .sk-nav{gap:4px}
  .sk-timer{padding:3px 8px;font-size:12px;gap:4px}
  .sk-headr{gap:5px}.sk-gear{width:40px;height:40px}
  .sk-menu-list{position:fixed;top:calc(50px + env(safe-area-inset-top));left:8px;right:8px;max-height:70vh;max-height:70dvh}
  .sk-stage{padding:8px 10px 8px;z-index:6;background:var(--bg)}
  .sk-boardbox{width:min(100%,calc((100vh - var(--bar)) * .46 * var(--ar)));width:min(100%,calc((100dvh - var(--bar)) * .46 * var(--ar)))}
  .sk-viewport{border-radius:12px;box-shadow:0 10px 26px rgba(0,0,0,.45)}
  /* the zoom column stands beside the board, never over its tiles */
  .sk-boardbox.has-zoom{width:min(calc(100% - 46px),calc((100vh - var(--bar)) * .46 * var(--ar)));width:min(calc(100% - 46px),calc((100dvh - var(--bar)) * .46 * var(--ar)));margin-right:46px}
  /* zoomed in: the full width, at the height the board had */
  .sk-boardbox.zoomed{width:100%}.sk-boardbox.zoomed.has-zoom{width:calc(100% - 46px)}
  .sk-boardbox.zoomed .sk-viewport{flex:none;height:min(calc((100vw - 20px) / var(--ar)),calc((100vh - var(--bar)) * .46));height:min(calc((100vw - 20px) / var(--ar)),calc((100dvh - var(--bar)) * .46))}
  .sk-zoom{left:calc(100% + 6px);right:auto;bottom:0;flex-direction:column;padding:3px;gap:3px;transition:none}
  .sk-zoom button{width:36px;height:36px}
  .sk-zoom .rst{width:36px;min-width:0;padding:0;font-size:8.5px;letter-spacing:.02em;overflow:hidden}
  .sk-replay{padding:8px}.sk-replay-card{padding:12px 14px;gap:6px}.sk-replay-card b{font-size:17px}.sk-replay-card span{display:none}
  .sk-insp{left:8px;right:8px;width:auto;bottom:calc(66px + env(safe-area-inset-bottom));max-height:56%}
  .sk-overlay{top:calc(100% - 2px);bottom:auto;left:10px;right:10px;transform:none;width:auto;min-width:0;
    max-height:calc(var(--dosh,40vh) - 8px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;border-radius:12px}
  .sk-hint-act{position:sticky;bottom:0;z-index:1;margin:0 -2px -2px;padding:4px 2px 2px;background:var(--paper)} /* Next / Back / Hide stay in reach while the hint scrolls */
  .sk-verdict{padding:8px 10px 8px 12px}.sk-verdict b{font-size:15px}.sk-verdict span{font-size:13px}
  .sk-solved{padding:9px 12px}.sk-solved b{font-size:17px}.sk-solved span{font-size:13px}.sk-solved .sk-solved-more{font-size:12px;margin-top:1px}
  .sk-hint p{font-size:13.5px;margin:4px 0 8px}
  .sk-hint{gap:9px;padding:8px 10px 9px 9px}
  .sk-dossier{padding:min(var(--ovl,0px),max(0px,calc(var(--dosh,100vh) - 14px))) max(10px,env(safe-area-inset-right)) 14px max(10px,env(safe-area-inset-left));border-right:0;border-top:1px solid var(--line);gap:10px;background:var(--bg)}
  .sk-now{display:none;align-items:center;gap:6px;position:sticky;top:0;z-index:3;margin:0 -10px;padding:8px 12px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    background:rgba(20,20,25,.94);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border-bottom:1px solid var(--line);font-size:13px;color:var(--muted)}
  .sk-now b{color:var(--fg)}
  .sk-rules{padding:8px 10px}.sk-rule{font-size:13px}
  .sk-cast{gap:9px;grid-template-columns:repeat(2,minmax(0,1fr))}
  .sk-cardw{max-width:none;justify-self:stretch}
  /* phone: Polaroid on the left, the statement beside it */
  .sk-card.v{display:grid;grid-template-columns:72px minmax(0,1fr);align-items:center;gap:5px;padding:5px 6px 5px 4px;border-top:0;border-left:5px solid var(--sc)}
  .sk-photo{width:100%}
  .sk-card.v .sk-alibi{background:none;padding:0;font-size:12px;line-height:1.3;align-self:center;hyphens:auto}
  .sk-card.adow.v .sk-alibi{background:none}
  .sk-stamp{top:-6px;right:-5px;width:20px;height:20px;font-size:11px}
  .sk-rail{flex-direction:row;justify-content:stretch;gap:6px;padding:6px max(8px,env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left));
    border-left:0;border-top:1px solid var(--line);overflow:visible}
  .sk-rail-group{display:contents}
  .sk-rail-cap,.sk-tool.desk{display:none}
  .sk-tool{flex:1 1 0;min-width:0;min-height:56px;border-radius:12px;padding:6px 2px 5px;gap:2px}
  .sk-tool .ic{font-size:20px}
  .sk-tool small{font-size:10.5px}
  .sk-tool .sub{display:none}
  .sk-tool .sub.keep,.sk-tool .sub.mob{display:block;font-size:9.5px}
  .sk-tool .sub-long,.sk-tool .lb2{display:none}
  .sk-tip{right:auto;top:auto;left:50%;bottom:calc(100% + 10px);transform:translateX(-50%)}
  .sk-labbar{padding:calc(8px + env(safe-area-inset-top)) 10px 8px;gap:10px}.sk-labbar .sk-logo{height:26px}
  .sk-labscroll{padding:12px 10px}
}
/* ===== a phone held sideways (short and wide): the desktop columns, compact. dossier | board | slim rail ===== */
@media (orientation:landscape) and (max-height:520px){
  .sk-game,.sk-game[data-split]{--stwh:calc((100vh - var(--bar) - 16px) * var(--ar) + 16px);--stwh:calc((100dvh - var(--bar) - 16px) * var(--ar) + 16px);--stw:min(var(--stwh),58vw);
    grid-template-columns:minmax(0,1fr) var(--stw) calc(70px + env(safe-area-inset-right));grid-template-rows:auto minmax(0,1fr);grid-template-areas:"head stage rail" "dossier stage rail"}
  /* the line between the suspects and the board: a finger (or mouse) drags it, a double tap or double-click puts it back */
  .sk-game[data-split]{--stw:min(var(--stagew),var(--stwh),calc(100vw - 270px - env(safe-area-inset-right)))} /* the board at full height · 270: the rail and the narrowest suspects (DOSSIER_MIN_SHORT) */
  .sk-game[data-split][data-zoomed]{--stw:min(var(--stagew),calc(100vw - 270px - env(safe-area-inset-right)))} /* zoomed in, the board fills whatever the line leaves it */
  .sk-split{display:block;position:absolute;z-index:7;top:0;bottom:0;left:0;width:16px;cursor:col-resize;touch-action:none}
  [dir=rtl] .sk-split{left:auto;right:0}
  .sk-split:after{content:"";position:absolute;top:50%;left:4px;width:4px;height:48px;margin-top:-24px;border-radius:2px;background:#3a3a4c;transition:background .15s,height .15s}
  .sk-split:focus-visible:after,.sk-dragging .sk-split:after{background:var(--brass);height:72px;margin-top:-36px}
  .sk-split:focus-visible{outline:none}
  .sk-dragging{user-select:none;-webkit-user-select:none}
  .sk-dragging .sk-boardbox,.sk-dragging .sk-stage{transition:none}
  /* as on desktop: the logo, the timer, ⚙ and ? over the contract (one row when the column has room: data-wide) */
  .sk-head{grid-template-columns:auto minmax(0,1fr) auto auto;grid-template-areas:"logo . timer help" "nav nav nav nav";gap:6px;padding:6px 8px 6px max(8px,env(safe-area-inset-left))}
  .sk-head[data-wide]{grid-template-areas:"logo nav timer help"}
  .sk-head>.sk-menu{grid-area:nav} /* the contract's title (once the case is fixed) */
  .sk-head .sk-logo{height:30px;filter:none}
  /* the ☰ Menu tops the rail (the site's pages, sign-in or the profile): an icon, its list over the rail (fixed: the rail scrolls and would clip it) */
  .sk-railmenu-btn{height:32px}.sk-railmenu-btn span{display:none}
  .sk-railmenu-list{position:fixed;top:44px;inset-inline-end:max(6px,env(safe-area-inset-right));z-index:60;max-height:calc(100vh - 52px);max-height:calc(100dvh - 52px);overflow-y:auto}
  .sk-help{display:grid;width:36px;height:36px}
  .sk-arrow{width:30px;height:36px;font-size:20px}.sk-menu-btn{height:36px;padding:0 8px;gap:5px}
  .sk-headr{gap:5px}.sk-gear{width:36px;height:36px}.sk-timer{padding:3px 8px;font-size:12px;gap:4px}
  .sk-cs,.sk-caret,.sk-menu-btn .sk-diff{display:none}
  .sk-dossier{padding:2px 10px calc(10px + var(--ovl,0px)) max(10px,env(safe-area-inset-left));gap:8px}
  .sk-rules{padding:7px 10px}.sk-rule{font-size:13px}
  .sk-cast{gap:8px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
  .sk-cardw{max-width:none;justify-self:stretch}
  .sk-card.v{display:grid;grid-template-columns:60px minmax(0,1fr);align-items:center;gap:5px;padding:4px 6px 4px 4px;border-top:0;border-left:5px solid var(--sc)}
  .sk-photo{width:100%}
  .sk-card.v .sk-alibi{background:none;padding:0;font-size:12px;line-height:1.3;align-self:center;hyphens:auto}
  .sk-card.adow.v .sk-alibi{background:none}
  .sk-stage{padding:8px}
  .sk-boardbox{width:min(100%,calc((100vh - var(--bar) - 16px) * var(--ar)));width:min(100%,calc((100dvh - var(--bar) - 16px) * var(--ar)))}
  .sk-viewport{border-radius:10px}
  /* the hint / verdict / win banner floats over the suspects column, so the board keeps its size */
  .sk-overlay{position:fixed;left:max(8px,env(safe-area-inset-left));right:auto;bottom:calc(8px + var(--gbot,0px));transform:none;min-width:0;
    width:calc(100vw - var(--stw) - 70px - env(safe-area-inset-right) - 16px);max-height:calc(100vh - var(--bar) - 56px);max-height:calc(100dvh - var(--bar) - 56px);overflow-y:auto;overscroll-behavior:contain;border-radius:12px;z-index:20}
  .sk-hint-act{position:sticky;bottom:0;z-index:1;padding:4px 0 2px;background:var(--paper)}
  .sk-hint-pic{display:none}.sk-hint p{font-size:13px;margin:4px 0 6px}.sk-hint{padding:8px 10px 9px}
  .sk-solved{padding:8px 10px}.sk-solved b{font-size:16px}.sk-solved span{font-size:13px}
  .sk-verdict{padding:8px 10px}.sk-verdict b{font-size:15px}.sk-verdict span{font-size:13px}
  .sk-rail{gap:6px;padding:6px max(6px,env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) 6px}
  .sk-rail-group{gap:4px}
  .sk-rail-cap,.sk-tool.desk,.sk-tool .sub,.sk-tool .sub.keep,.sk-tool .lb2{display:none}
  .sk-tool{min-height:32px;padding:2px;gap:0;border-radius:10px}
  .sk-tool .ic{font-size:16px}
  .sk-tool small{font-size:9px;letter-spacing:.03em;max-width:100%;overflow:hidden;text-overflow:ellipsis}
  .sk-rail .sk-zoom{padding:3px;gap:3px}.sk-rail .sk-zoom button{height:28px}.sk-rail .sk-zoom .rst{height:22px;font-size:9px}
  .sk-rail .sk-zoom .rst[disabled]{display:none} /* Reset only while zoomed: the rail has no height to spare */
  /* the tutorial's card shortens the game, so the rail may scroll; a scroller clips anything outside it, so the eraser's
     "Hold to clear all…" tip stays hidden here (the filling ring on the button still shows the hold) */
  .sk-rail{overflow-y:auto;scrollbar-width:none}
  .sk-eraser{touch-action:pan-y} /* a swipe that starts on the Eraser scrolls the rail (the browser cancels the hold) */
  .sk-tip{display:none}
  .sk-menu-btn .sk-ci{display:none}
  .sk-solved{flex-wrap:wrap}.sk-solved button{white-space:normal;text-align:center}
  .sk-insp{right:calc(78px + env(safe-area-inset-right));bottom:8px;max-height:calc(100% - 16px)}
  .sk-replay-card{padding:12px 14px;gap:6px}.sk-replay-card b{font-size:17px}.sk-replay-card span{display:none}
}
@media (orientation:landscape) and (max-height:520px) and (max-width:700px){.sk-menu-btn .sk-cn{display:none}}
@media (orientation:landscape) and (max-height:520px) and (max-width:820px){.sk-headend .sh-userchip-name{display:none}}
@media (max-width:560px){.sk-cs,.sk-caret,.sk-menu-btn .sk-diff{display:none}}
@media (max-width:440px){.sk-head .sk-logo,.sk-head.merged .sk-logo{height:33px}.sk-menu-btn .sk-ci{display:none}}
@media (max-width:380px){.sk-head .sk-logo,.sk-head.merged .sk-logo{height:29px}}
/* narrow phones: tighter header controls, so the logo keeps its height */
@media (max-width:380px){.sk-head,.sk-head.merged{gap:4px;padding-inline:max(8px,env(safe-area-inset-left)) max(8px,env(safe-area-inset-right))}.sk-head.merged .sk-headr,.sk-headend,.sk-headend .sh-controls{gap:4px}.sk-headend .sh-btn{padding:0 8px}.sk-head.merged .sk-gear,.sk-head.merged .sk-help,.sk-headend .sh-burger{width:34px}}
@media (max-width:290px){.sk-cast{grid-template-columns:minmax(0,1fr)}}

/* modal */
.sk-modal{position:fixed;inset:0;z-index:50;display:grid;place-items:center;padding:16px;background:rgba(8,8,12,.72);animation:skFade .2s ease}
.sk-modal>div{position:relative;max-width:520px;max-height:86vh;max-height:86dvh;overflow:auto;background:var(--paper);color:var(--pink);border-radius:14px;padding:18px 20px}
.sk-sheetwrap{z-index:55}
.sk-sheet{position:relative;width:min(520px,100%);max-width:520px;background:var(--paper);color:var(--pink);border-radius:14px;padding:16px 20px 18px;border-top:7px solid var(--sc,var(--brass));box-shadow:0 24px 60px rgba(0,0,0,.55)}
.sk-sheet-eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:800;color:#6e6250;margin-bottom:6px}
.sk-sheet-body{display:flex;gap:18px;align-items:flex-start}
.sk-sheet-pic{position:relative;flex:0 0 auto;filter:drop-shadow(0 6px 10px rgba(0,0,0,.35))}
.sk-sheet-ok{position:absolute;top:-8px;right:-10px;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#2f9e6b;color:#fff;font-size:22px;font-weight:800;border:3px solid var(--paper);box-shadow:0 3px 8px rgba(0,0,0,.4)}
.sk-sheet-info{flex:1;min-width:0}
.sk-sheet-info h2{margin:0 0 4px;display:flex;align-items:center;gap:8px;font:400 26px/1.1 'Special Elite',monospace}
.sk-sheet-info .sk-letter{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--sc);color:#1A1A22;font:800 15px 'Barlow',sans-serif}
.sk-sheet-state{margin:0 0 10px;font-size:13px;font-weight:700;color:#7a6f5b}.sk-sheet-state.ok{color:#1f7a53}
.sk-facts{margin:0;display:grid;gap:5px}.sk-facts>div{display:grid;grid-template-columns:92px 1fr;gap:8px;font-size:14px;padding-bottom:4px;border-bottom:1px dashed #cdbf9d}
.sk-facts dt{font-weight:800;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:#6e6250;align-self:center}.sk-facts dd{margin:0;font-weight:600}
.sk-sheet-clue{margin-top:14px;background:var(--paper2);border-radius:10px;padding:9px 12px}
.sk-sheet-clue>span{font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:#6e6250}.sk-sheet-clue p{margin:3px 0 0;font-size:16px;line-height:1.4}
@media (max-width:480px){.sk-sheet-body{flex-direction:column;align-items:center}.sk-sheet-info{width:100%}}
/* an assassin's Syndicate card: the dark blue-grey of their shadowed look, their tie's colour (--sc) as the accent */
.sk-sheet.syn{background:linear-gradient(180deg,#252a3d 0,#1c1f2e 55%,#15171f 100%);color:var(--fg);border:1px solid #33384d;border-top:7px solid var(--sc);box-shadow:0 24px 60px rgba(0,0,0,.65)}
.sk-sheet.syn .sk-sheet-eyebrow,.sk-sheet.syn .sk-sheet-clue>span{color:color-mix(in srgb,var(--sc) 75%,#fff)}
.sk-sheet.syn .sk-x{color:#a9adbd}
.sk-sheet.syn .sk-sheet-info h2{color:#f3efe6}
.sk-sheet.syn .sk-sheet-info .sk-letter{background:var(--sc);color:var(--sci,#fff)}
.sk-sheet.syn .sk-sheet-state{color:#98a0b6}.sk-sheet.syn .sk-sheet-state.ok{color:#7fd6a8}
.sk-sheet.syn .sk-facts>div{border-bottom-color:#3a4058}
.sk-sheet.syn .sk-facts dt{color:#8f98b8}
.sk-sheet.syn .sk-sheet-clue{background:#151823;border:1px solid #33384d;border-inline-start:4px solid var(--sc)}
.sk-sheet.syn .sk-sheet-ok{border-color:#1c1f2e}
.sk-modal h2{margin:0 0 8px;font:400 24px/1.1 'Special Elite',monospace}
.sk-modal ul{padding-left:18px;margin:8px 0 0;display:flex;flex-direction:column;gap:6px}
.sk-x{position:absolute;top:6px;right:8px;width:40px;height:40px;font-size:22px;color:#6e6250}

/* board animation */
.sk-fog,.sk-warm{transition:opacity .6s ease}
@keyframes skPulse{0%,100%{opacity:.95}50%{opacity:.3}}.sk-pulse{animation:skPulse 1.4s ease-in-out infinite}
@keyframes skDash{to{stroke-dashoffset:-24}}.sk-march{animation:skDash 1.2s linear infinite}
@keyframes skHoldRing{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}.sk-holdring{stroke-dashoffset:100;animation:skHoldRing 1s linear forwards}
@keyframes skHoldFill{from{transform:scale(.25);opacity:.15}to{transform:scale(1);opacity:.85}}.sk-holdfill{transform-box:fill-box;transform-origin:center;animation:skHoldFill 1s ease-out forwards}
@keyframes skCatch{from{transform:scale(.7);opacity:1}to{transform:scale(1.7);opacity:0}}.sk-catch{transform-box:fill-box;transform-origin:center;animation:skCatch 1.6s ease-out infinite}
@keyframes skFlash{from{opacity:.45}to{opacity:0}}.sk-flash{animation:skFlash .7s ease-out forwards}
@keyframes skIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes skFade{from{opacity:0}to{opacity:1}}
.sk-foam{animation:skFoam 3.6s ease-in-out infinite alternate}@keyframes skFoam{from{opacity:.62}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.sk-pi{animation:none}.sk-pulse,.sk-march,.sk-foam,.sk-catch,.sk-hint,.sk-solved{animation:none}.sk-fog,.sk-warm,.sk-boardbox,.sk-stage,.sk-zoom{transition:none}}
`;

export const GAME_CSS = CSS; // ShadokuHome injects it so its read-only showcase boards look exactly like the game's
export { Board, cn }; // ShadokuLab.jsx builds on these
