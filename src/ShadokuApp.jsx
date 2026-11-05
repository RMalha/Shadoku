/* eslint-disable react/prop-types */
/**
 * ShadokuApp.jsx — shadoku.net shell (router + site chrome around the game)
 * ------------------------------------------------------------------------------------------
 *   /      → <ShadokuHome />                      landing page; the envelope opens into /play
 *   /play  → Contracts › STORY: Act 1, every story puzzle in an envelope, grouped by difficulty (click one to open it, click the card to accept)
 *            (before the initiation is done, /play opens the tutorial instead)
 *   /daily → Contracts › DAILY CONTRACT: today's contract in its envelope, then the archive of the two weeks before it (DailyScreen).
 *            The release job (tools/release_daily.py) ships one a day at midnight and rotates out the older ones; the newest shipped
 *            one is "today's". On localhost the coming week's queue (npm run dev) is listed under it, for testing.
 *   /play/<puzzle-name>                            one puzzle, e.g. /play/the-art-of-the-ghost (slim top bar + <ShadokuGame />; the URL follows the contract picker)
 *   /about  /contact                               plain pages (ShadokuPages.jsx)
 *   /legal (alias /privacy)  /delete-account       the terms & privacy text and the account deletion steps (the Play Store links to both)
 *   /profile  /profile/stats  /profile/collection  the signed-in player's Info, Stats and relic Collection (ShadokuPages.jsx)
 *   /profile/ranking                               every signed-in player, ranked (ShadokuCommunity.jsx RankingPanel)
 *   /community                                     Community › COMMUNITY PUZZLES: the published puzzles by board size (ShadokuCommunity.jsx)
 *   /community/create                              Community › CREATE: the Guide and the Workshop (ShadokuCommunity.jsx)
 *   /community/play/<id>                           one community puzzle in the game (CommunityPlayScreen; "draft-test" = the Workshop's play-test)
 *   /test/umbra                                    not linked anywhere: opens the Evidence Board and Dossier № 000-OMEGA without the ten
 *                                                  relics, in a test mode that never saves or unlocks anything (ShadokuPages.jsx)
 *
 * The game itself lives in ./ShadokuGame.jsx (it used to be called ShadokuApp.jsx).
 *
 * THE MASTER'S INITIATION (the tutorial)
 *   · The tutorial is the puzzle with id "tutorial" ("The Art of the Ghost"). On a first visit to /play
 *     (no `shadoku-tutorial-done` in localStorage) the player starts on it and the case picker is locked
 *     (lock icon, tooltip "Complete The Master's initiation first").
 *   · A dossier card pinned under the board shows <MasterPolaroid/> and walks the player through a hands-on lesson
 *     (`buildTutorial`): it IS the puzzle's solution, in the Master's voice. The board starts with the Inspector's scribbles, so step 1 is
 *     "hold the Eraser to wipe the board"; then pick a suspect → hold-to-place → Hint → drag-paint notes → the ray block with the
 *     Light Switch → placements → Eraser (one tile, Undo) → the last dark tile → Submit. No tile coordinates anywhere: tiles are named by what they touch.
 *     Every hands-on step advances ONLY when ShadokuGame's `onGameEvent` reports that the player did it (the pulsing `coach` highlight
 *     shows where); lore steps have a Continue button. "Skip Initiation" is always there.
 *   · Solving the tutorial, or skipping, sets `shadoku-tutorial-done` = "1", unlocks the picker and shows the brass
 *     "Initiation Complete — Enter Case #1 →" button. Picking "The Art of the Ghost" later brings the card back.
 *   · Wiring uses ShadokuGame's optional props: lockCaseMenu, forcePuzzleId, onGameEvent, onCaseChange, jumpTo (+seedNotes), helpExtra, insetY, fixedCase, onExit, hideLogo.
 *   · A puzzle's own page (/play/<name>) has NO contract picker (fixedCase): you change puzzles only from the /play contracts page.
 *   · Hints, the 6 difficulty badges (Tutorial … Expert) and the 12×12 / 14-suspect ergonomics live in ShadokuGame.jsx.
 *
 * Routing is window.history.pushState + popstate, with a React-state fallback so it still works in
 * sandboxed preview iframes where pushState throws.
 * (Cloudflare Pages: add `public/_redirects` containing `/* /index.html 200` so a deep link to /play works.)
 *
 *   <ShadokuApp
 *     onSignIn={(provider) => profile}        // see ShadokuHome.jsx for the auth hook contracts
 *     onCheckUsername={(name) => bool}
 *     onUsernameChange={(name) => void}
 *     onAvatarChange={(avatar) => bool}
 *     onSession onSignOut onDeleteAccount authError   // the same, for a real backend: src/auth.js
 *     screenshots={[url1, url2, url3]}        // optional: static images instead of the live showcases
 *     puzzles logoSrc lab                     // forwarded to <ShadokuGame />
 *   />
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ShadokuHome, {
  ShadokuProviders, SiteHeader, SiteMenu, UserPill, SiteFooter, ContractEnvelope, dailyLabel, LanguageSelector, useLang, useAuth, useModals, store, pushPath, registerTranslations, translate, PROFILE_PAGES, TUTORIAL_KEY,
} from "./ShadokuHome.jsx";
import { AboutPage, ContactPage, LegalPage, DeleteAccountPage, ProfilePage, TestUmbraPage, DIFF_ORDER } from "./ShadokuPages.jsx";
import ShadokuGame, { PUZZLES, DAILIES, dailyShelves, normalizePuzzles, readBestTimes, fmtTime, useMediaQuery } from "./ShadokuGame.jsx";
import { MasterPolaroid, AssassinPolaroid } from "./ShadokuArt.jsx";
import { localizeHead, trOf, dailyDate } from "./caseText.js";
import { useProgressTick } from "./sync.js";
import { RelicBadge, RelicModal, EvidenceBoard, FinalDossier, acceptFinale, allRelics, isUnlocked, useUmbraTick, UMBRA_HARD, UMBRA_FINALE } from "./umbra.jsx";
import { CommunityPage, CreatePage, RankingPanel, RateBox } from "./ShadokuCommunity.jsx";
import { getCommunity, reportPlay } from "./community.js";

export { TUTORIAL_KEY };
export const TUTORIAL_PUZZLE = "tutorial"; // "The Art of the Ghost"
const BAR_H = 61; // px, the site header on /play (the same <SiteHeader/> as the landing page: 40px logo + 2×10px padding + 1px border)
const BAR_H_DESK = 77; // px, the same header on a desktop: 56px logo (see SHADOKU_CSS)
const DESK_MQ = "(min-width: 961px)"; // the game's desktop layout: no site header on /play, the ☰ Menu sits on the tool rail
const SHORT_LANDSCAPE_MQ = "(orientation: landscape) and (max-height: 520px)"; // the game's compact side-by-side layout (ShadokuGame CSS)
const useBrowserLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/* ═════════════════════════ STRINGS (English; other languages fall back to these) ═════════════════════════
 * The tutorial's own lines are not here: they are ui.tutorial.* keys in src/locales/en.json (see buildTutorial). */
registerTranslations("en", {
  "help.replay": "↺ Replay Master U. M. Bra's initiation",

  "tut.badge": "Master U. M. Bra's Initiation",
  "tut.dossier": "Master U. M. Bra's initiation dossier",
  "tut.stage": "Stage {n} of {total}",
  "tut.step": "Step {n} of {total}",
  "hub.title": "Your contracts",
  "hub.contracts": "Contracts",
  "hub.act": "Act {n}",
  "daily.title": "Daily Contract · {date}",
  "daily.subtitle": "{difficulty} · {theme}",
  "daily.intro": "A new contract every day",
  "daily.none": "No daily contract yet. Come back at midnight.",
  "daily.label": "{weekday} · {theme}",
  "daily.archive": "Archive",
  "daily.archiveNote": "Older contracts are rotated out.",
  "daily.archiveEmpty": "Nothing here yet: the archive fills up day by day.",
  "daily.queue": "Queue (local testing only)",
  "daily.cap": "{date} · {difficulty}",
  "hub.open": "Open the envelope",
  "hub.close": "Close",
  "tut.continue": "Continue →",
  "tut.waiting": "Do it on the board and I will go on.",
  "tut.doneTitle": "Master U. M. Bra nods",
  "tut.prev": "← Prev",
  "tut.next": "Next →",
  "tut.skip": "Skip Initiation",
  "tut.minimize": "Minimize",
  "tut.expand": "Expand",
  "tut.enter": "Initiation Complete — Choose Your First Contract →",
  "tut.solved": "Contract fulfilled — and S. H. Adow was in the one tile no eye could reach.",
  "tut.skipped": "The initiation is behind you. The contracts are open.",
});

/**
 * The Master's four lessons, the last fallback for his lines. They come from the locale through the keys the tutorial JSON carries
 * (`tutorialLore[i].titleKey/textKey` = LORE.tutorial.N.TITLE/TEXT, generated by the engine into en.json); the JSON's own title/text are
 * only used when no locale has the key, and these when the puzzle has neither. Line 1 matches en.json.
 */
export const LORE_FALLBACK = [
  { title: "The Illusion of Justice", text: "The inspector scribbled scapegoats on the board, a parlour trick we feed him for centuries." },
  { title: "The Ray Block", text: "Aurora sat on a stool, and the Kitchen has two. Whichever she took, her gaze runs through the opening: that line is lit either way." },
  { title: "The Geometry of Panic", text: "Dinah stood beside the safe. Aurora's row lights one side of it, so she takes the other: the safe blocks their view." },
  { title: "The Sanctuary", text: "Every tile is lit but one. That single void in their vision is your sanctuary. Step into the shadows." },
];
/** The short how-to-play note of the initiation: t(LORE_NOTE_KEY). */
export const LORE_NOTE_KEY = "ui.tutorial.loreNote";

/** English through the locale files, for callers without a t(). */
const ENGLISH = (key, vars) => translate("en", key, vars);
/** t(key, vars), or `fb` when no locale file (nor the in-code English) has the key. */
const textOr = (t, key, fb, vars) => {
  if (!key) return fb;
  const v = t(key, vars);
  return typeof v === "string" && v && v !== key ? v : fb;
};

/** Four { title, text } stages of `puzzle.tutorialLore`: locale (titleKey/textKey) → the JSON's title/text → LORE_FALLBACK (strings and partial entries are tolerated). */
export function loreOf(puzzle, t = ENGLISH) {
  const raw = puzzle && Array.isArray(puzzle.tutorialLore) ? puzzle.tutorialLore : [];
  return LORE_FALLBACK.map((fb, i) => {
    const e = raw[i];
    const title = textOr(t, `LORE.tutorial.${i + 1}.TITLE`, fb.title), text = textOr(t, `LORE.tutorial.${i + 1}.TEXT`, fb.text); // no entry: the Master's own line
    if (typeof e === "string" && e.trim()) return { title, text: e };
    if (e && typeof e === "object") return { title: textOr(t, e.titleKey, e.title || title), text: textOr(t, e.textKey, e.text || e.body || text) };
    return { title, text };
  });
}

/** "m", "f" or "n" (neutral: S. H. Adow, or a suspect without a known gender): the suffix of a gendered ui.tutorial.* key. */
const genderOf = (puzzle, id) => {
  if (id === "S") return "n";
  const q = ((puzzle && puzzle.suspects) || []).find((x) => x.id === id);
  const g = String((q && q.gender) || "").toLowerCase();
  return g === "m" || g === "f" ? g : "n";
};

/** The tutorial's text lookup: `ui.tutorial.<k>`, plus the suspects' display names and genders. */
function tutorialText(puzzle, t) {
  const K = (k, vars) => t(`ui.tutorial.${k}`, vars);
  const nameOf = (id) => (id === "S" ? K("adow") : (((puzzle && puzzle.suspects) || []).find((q) => q.id === id) || {}).name || id);
  const gender = (id) => genderOf(puzzle, id);
  /** K for a line about suspect `id`: the locale's `<key>.m|f|n` variant when it has one (languages that inflect for gender), else the plain key. */
  const KG = (k, id, vars) => textOr(t, `ui.tutorial.${k}.${gender(id)}`, K(k, vars), vars);
  /** A placement nudge for suspect `id`: someone else was placed, or `id` went on the wrong tile. */
  const wrongPlace = (id) => (e) => (e.type !== "place" ? null
    : e.id !== id ? K(`nudge.wrongSuspect.${gender(e.id)}`, { name: nameOf(e.id), target: nameOf(id) })
      : K("nudge.wrongTile", { name: nameOf(id) }));
  return { K, KG, nameOf, gender, wrongPlace };
}

/**
 * The hands-on lesson. Every step is { key, chapter, title, text (the Master's voice), task (what to do), coach (what pulses),
 * gate(e) → true once the player did it, nudge(e) → a gentle correction, done (the little ✓ line) }. A step with no `gate` is a
 * reading step (Continue button). Placements, tiles and names are read from the puzzle itself, so the lesson survives edits to it.
 * Every line is a ui.tutorial.generic.* (or shared ui.tutorial.*) key, read through `t`.
 */
export function buildGenericTutorial(puzzle, lore, t = ENGLISH) {
  if (!puzzle) return [];
  const { K, nameOf, wrongPlace } = tutorialText(puzzle, t);
  const sus = new Map((puzzle.suspects || []).map((q) => [q.id, q]));
  const cn = ([r, c]) => `r${r + 1}c${c + 1}`;
  const same = (e, r, c) => e.r === r && e.c === c;
  const isPlace = (e, id, cell) => e.type === "place" && e.id === id && same(e, cell[0], cell[1]);
  const logicOf = (tx, fb) => String(tx || fb || "").replace(/\s*Place .*$/s, "").trim() || fb || "";

  const fromSteps = (puzzle.steps || []).filter((x) => x.kind === "place" && x.suspect && sus.get(x.suspect));
  const order = (fromSteps.length ? fromSteps.map((x) => ({ id: x.suspect, text: x.text })) : (puzzle.suspects || []).map((q) => ({ id: q.id, text: q.clue })))
    .map((o) => ({ id: o.id, cell: sus.get(o.id).solution, logic: logicOf(o.text, sus.get(o.id).clue) }))
    .filter((o) => Array.isArray(o.cell));
  const first = order[0] || null;
  const taken = new Set([...order.map((o) => cn(o.cell)), puzzle.shadow ? cn(puzzle.shadow) : "", puzzle.corpse ? cn(puzzle.corpse) : ""]);
  let lightCell = null; // an empty floor tile that is neither a suspect's nor the blind spot: safe to switch on by hand
  for (let r = (puzzle.contents || []).length - 1; r >= 0 && !lightCell; r--) {
    for (let c = 0; c < puzzle.contents[r].length; c++) if (!puzzle.contents[r][c] && !taken.has(cn([r, c]))) { lightCell = [r, c]; break; }
  }

  const placeStep = (o, i) => {
    const name = nameOf(o.id);
    return {
      key: `place-${o.id}`, chapter: K(i === 0 ? "chapter.placing" : "chapter.solving"), title: K(i === 0 ? "generic.place.titleFirst" : "generic.place.titleNext", { name }), text: o.logic,
      task: K("generic.place.task", { name }),
      coach: { card: o.id, cells: [o.cell] }, gate: (e) => isPlace(e, o.id, o.cell),
      nudge: wrongPlace(o.id),
      done: K("done.inPlace", { name }),
    };
  };

  const out = [];
  [0, 1, 2].forEach((i) => out.push({ key: `lore${i}`, chapter: K("chapter.master"), title: lore[i].title, text: lore[i].text, task: null }));
  if (first) {
    const name = nameOf(first.id);
    out.push({ key: "select", chapter: K("chapter.notes"), title: K("generic.select.title"),
      text: K("generic.select.text"),
      task: K("common.tapCard", { name }), coach: { card: first.id }, gate: (e) => e.type === "select" && e.id === first.id, done: K("done.isYourTool", { name }) });
    out.push({ key: "note", chapter: K("chapter.notes"), title: K("generic.note.title"),
      text: K("generic.note.text"),
      task: K("generic.note.task"), gate: (e) => e.type === "note", done: K("done.noted") });
    out.push({ key: "paint", chapter: K("chapter.notes"), title: K("generic.paint.title"),
      text: K("generic.paint.text"),
      task: K("generic.paint.task"), gate: (e) => e.type === "note" && e.drag, done: K("done.fineTrail") });
    out.push({ key: "eraser", chapter: K("chapter.cleaning"), title: K("generic.eraser.title"),
      text: K("generic.eraser.text"),
      task: K("generic.eraser.task"), coach: { tool: "eraser" }, gate: (e) => e.type === "tool" && e.tool === "eraser", done: K("done.eraserInHand") });
    out.push({ key: "erase1", chapter: K("chapter.cleaning"), title: K("generic.erase1.title"),
      text: K("generic.erase1.text"),
      task: K("generic.erase1.task"), gate: (e) => e.type === "erase" && !e.all, done: K("done.gone") });
    out.push({ key: "undo", chapter: K("chapter.cleaning"), title: K("generic.undo.title"),
      text: K("generic.undo.text"),
      task: K("generic.undo.task"), coach: { tool: "undo" }, gate: (e) => e.type === "undo", done: K("done.backFromDead") });
    out.push({ key: "clearall", chapter: K("chapter.cleaning"), title: K("generic.clearall.title"),
      text: K("generic.clearall.text"),
      task: K("generic.clearall.task"), coach: { tool: "eraser" }, gate: (e) => e.type === "erase" && e.all, done: K("done.cleanBoard") });
  }
  order.forEach((o, i) => {
    out.push(placeStep(o, i));
    if (i === 1) {
      out.push({ key: "lights", chapter: K("chapter.lights"), title: K("generic.lights.title"),
        text: K("generic.lights.text"),
        task: null });
      if (lightCell) {
        out.push({ key: "lamp", chapter: K("chapter.lights"), title: K("generic.lamp.title"),
          text: K("generic.lamp.text"),
          task: K("generic.lamp.task"), coach: { tool: "light" }, gate: (e) => e.type === "tool" && e.tool === "light", done: K("done.switchReady") });
        out.push({ key: "lamp2", chapter: K("chapter.lights"), title: K("generic.lamp2.title"),
          text: K("generic.lamp2.text"),
          task: K("generic.lamp2.task"), coach: { cells: [lightCell], tool: "light" }, gate: (e) => e.type === "light" && e.on && same(e, lightCell[0], lightCell[1]), done: K("done.lit") });
      }
      out.push({ key: "hint", chapter: K("chapter.hints"), title: K("generic.hint.title"),
        text: K("generic.hint.text"),
        task: K("generic.hint.task"), coach: { tool: "hint" }, gate: (e) => e.type === "hint" && e.open, done: K("done.myCounsel") });
      out.push({ key: "hint2", chapter: K("chapter.hints"), title: K("generic.hint2.title"),
        text: K("generic.hint2.text"),
        task: K("generic.hint2.task"), coach: { tool: "hint" }, gate: (e) => e.type === "hint" && !e.open, done: K("done.backToWork") });
    }
  });
  if (puzzle.shadow) {
    out.push({ key: "shadow", chapter: K("chapter.sanctuary"), title: lore[3].title,
      text: lore[3].text,
      task: K("generic.shadow.task"),
      coach: { card: "S", cells: [puzzle.shadow] }, gate: (e) => isPlace(e, "S", puzzle.shadow),
      nudge: (e) => (e.type === "place" && e.id === "S" ? K("nudge.shadow") : null), done: K("done.inShadows") });
  }
  out.push({ key: "submit", chapter: K("chapter.verdict"), title: K("generic.submit.title"),
    text: K("generic.submit.text"),
    task: K("generic.submit.task"), coach: { tool: "submit" }, gate: (e) => e.type === "solved", done: K("done.contractFulfilled") });
  return out;
}

/**
 * The scripted lesson for "The Art of the Ghost" (V10.1, Puzzle ID MAT0505ROR1-110): it IS the solution of the puzzle, told in the Master's
 * voice. Every step points at the tiles that matter (by what they are next to, never by coordinates), teaches one control through them, and
 * carries one of the Master's lines (the puzzle's own `tutorialLore` where it fits). Returns null when the puzzle is not the expected one (the
 * generic lesson takes over). The board shows every prop class: a piano (PERCH: sit on it, it blocks sight), the stools and footprints (LOW:
 * stand on them), the stove (SHORT: sight passes over), the safe and the palm (TALL), the Corpse (sight passes over it) and doors (sight
 * passes through). The walkthrough's one non-placement step is the ray block: A's two stools share one row, so the tile beside the
 * safe is lit whichever stool she took.
 * `seen` (3rd gate argument) is the set of "type:id:r,c:d|t" keys of every event since the step began, for steps that need several actions.
 * The board starts with the Inspector's wrong scribbles on it (see `tutorialSeed`), and step 1 is wiping them off.
 */
function scriptedParts(puzzle) {
  if (!puzzle || !Array.isArray(puzzle.suspects) || !Array.isArray(puzzle.contents) || !Array.isArray(puzzle.rooms) || !puzzle.shadow) return null;
  const sol = {};
  puzzle.suspects.forEach((q) => { sol[q.id] = q.solution; });
  const want = { A: [4, 4], B: [3, 0], C: [0, 3], D: [4, 0], E: [1, 2] };
  if (Object.keys(want).some((id) => !sol[id] || sol[id][0] !== want[id][0] || sol[id][1] !== want[id][1])) return null;
  const all = (kind) => { const out = []; for (let r = 0; r < puzzle.contents.length; r++) for (let c = 0; c < puzzle.contents[r].length; c++) if (puzzle.contents[r][c] === kind) out.push([r, c]); return out; };
  const piano = all("PIANO")[0], safe = all("SAFE")[0], stools = all("STOOL");
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  if (!piano || !safe || stools.length !== 2 || !same(piano, sol.B)) return null;
  const width = puzzle.contents[0].length;
  const room = ([r, c]) => puzzle.rooms[r][c];
  const free = (r, c) => r >= 0 && c >= 0 && r < puzzle.contents.length && c < width && !puzzle.contents[r][c];
  // the two sides of the safe inside its own room: D's and the one A's row lights (the ray block)
  const sides = [[safe[0], safe[1] - 1], [safe[0], safe[1] + 1]].filter(([r, c]) => c >= 0 && c < width && room([r, c]) === room(safe));
  const beyond = sides.find((x) => !same(x, sol.D));
  const litStool = stools.find((x) => !same(x, sol.A));
  const ray = (puzzle.steps || []).find((x) => x.i18n && x.i18n.ruleKey === "RULE_RAY_BLOCK");
  const rayHits = ray ? Object.values(ray.elims || {}).flat() : [];
  if (sides.length !== 2 || !beyond || !litStool || !stools.some((x) => same(x, sol.A)) || !rayHits.some((x) => same(x, beyond))) return null;
  return { sol, piano, safe, stools, beyond, litStool, free };
}

/** The Inspector's wrong scribbles that the tutorial board starts with: [[r, c, "letters"], …] (empty unless the scripted lesson applies). */
export function tutorialSeed(puzzle) {
  const p = scriptedParts(puzzle);
  if (!p) return [];
  const taken = new Set([...Object.values(p.sol), puzzle.shadow].map(([r, c]) => `${r},${c}`));
  const letters = ["E", "CD", "B", "AE", "D", "C", "B"], out = [];
  let i = 0;
  for (let r = 0; r < puzzle.contents.length; r++) {
    for (let c = 0; c < puzzle.contents[r].length; c++) {
      if (p.free(r, c) && !taken.has(`${r},${c}`) && i++ % 2 === 0 && out.length < letters.length) out.push([r, c, letters[out.length]]);
    }
  }
  return out;
}

/** Where S. H. Adow stands when the tutorial opens (the first lesson: he casts no light; clearing the board takes him off): the open,
 *  prop-free tile nearest the middle that is nobody's solution, not his hiding tile and not under a scribble. null unless the scripted lesson applies. */
export function tutorialAdowSeed(puzzle) {
  const p = scriptedParts(puzzle);
  if (!p) return null;
  const taken = new Set([...Object.values(p.sol), puzzle.shadow, ...tutorialSeed(puzzle)].map(([r, c]) => `${r},${c}`));
  const R = puzzle.contents.length, C = puzzle.contents[0].length;
  let best = null, bd = Infinity;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const d = Math.abs(r - (R - 1) / 2) + Math.abs(c - (C - 1) / 2);
    if (p.free(r, c) && !taken.has(`${r},${c}`) && d < bd) { best = [r, c]; bd = d; }
  }
  return best;
}

/** Where `cell` is next to `ref`: "above" | "below" | "left" | "right" (the ui.tutorial.lightTile.<side> sentence names the tile by what it touches). */
const sideOf = (cell, ref) => {
  const dr = cell[0] - ref[0], dc = cell[1] - ref[1];
  return dr < 0 ? "above" : dr > 0 ? "below" : dc < 0 ? "left" : "right";
};

/** The scripted lesson's lines are ui.tutorial.scripted.* (and shared ui.tutorial.*) keys, read through `t`. */
function buildScriptedTutorial(puzzle, lore, t = ENGLISH) {
  const p = scriptedParts(puzzle);
  if (!p) return null;
  const { sol, safe, stools, beyond, litStool } = p;
  const { K, KG, nameOf, wrongPlace } = tutorialText(puzzle, t);
  const same = (e, [r, c]) => e.r === r && e.c === c;
  const k = (type, id, [r, c], d) => `${type}:${id}:${r},${c}:${d ? "d" : "t"}`;
  const isPlace = (e, id, cell) => e.type === "place" && e.id === id && same(e, cell);
  const wrongTile = (type, cells, msg) => (e) => (e.type === type && !e.all && !cells.some((c) => same(e, c)) ? msg : null);
  const place = (id, chapter, title, text, task) => ({
    key: `place-${id}`, chapter, title, text, task, coach: { card: id, cells: [sol[id]] },
    gate: (e) => isPlace(e, id, sol[id]), nudge: wrongPlace(id), done: K("done.inPlace", { name: nameOf(id) }),
  });

  const [LA, LB, LC, LD] = lore; // the four lore beats (title + the Master's line): the steps below read both, so the lines live in one place
  const A = nameOf("A"), B = nameOf("B"), C = nameOf("C"), D = nameOf("D"), E = nameOf("E");
  return [
    { key: "adow-dark", chapter: K("chapter.shadow"), title: K("scripted.adowDark.title"),
      text: K("scripted.adowDark.text"),
      task: K("scripted.adowDark.task"), coach: { card: "S" },
      gate: (e) => e.type === "select" && e.id === "S", done: K("done.noLight") },
    { key: "clearall", chapter: K("chapter.cleanup"), title: LA.title,
      text: LA.text,
      task: K("scripted.clearall.task"), coach: { tool: "eraser" },
      gate: (e) => e.type === "erase" && e.all, done: K("done.spotless") },
    { key: "select-B", chapter: K("chapter.alibis"), title: K("scripted.selectPiano.title"),
      text: KG("scripted.selectPiano.text", "B", { name: B }),
      task: K("common.tapCard", { name: B }), coach: { card: "B" },
      gate: (e) => e.type === "select" && e.id === "B", done: K("done.isYourTool", { name: B }) },
    place("B", K("chapter.placing"), K("scripted.placeA.title", { name: B }),
      K("scripted.placePiano.text"),
      K("scripted.placePiano.task")),
    { key: "hint", chapter: K("chapter.hints"), title: K("scripted.hint.title"),
      text: K("scripted.hintPiano.text", { name: B }),
      task: K("scripted.hint.task"), coach: { tool: "hint" },
      gate: (e) => e.type === "hint" && e.open, done: K("done.myCounsel") },
    { key: "hint2", chapter: K("chapter.hints"), title: K("scripted.hint2.title"),
      text: K("scripted.hint2.text"),
      task: K("scripted.hint2.task"), coach: { tool: "hint" },
      gate: (e) => e.type === "hint" && !e.open, done: K("done.backToWork") },
    { key: "select-A", chapter: K("chapter.notes"), title: LB.title,
      text: LB.text,
      task: K("common.tapCard", { name: A }),
      coach: { card: "A" }, gate: (e) => e.type === "select" && e.id === "A", done: K("done.isYourTool", { name: A }) },
    { key: "drag-A", chapter: K("chapter.notes"), title: K("scripted.dragB.title"),
      text: K("scripted.dragStools.text"),
      task: K("scripted.dragStools.task"), coach: { cells: stools },
      gate: (e, seen) => stools.every((x) => seen.has(k("note", "A", x, true))),
      nudge: (e) => (e.type === "note" && !e.drag ? K("scripted.dragStools.nudge") : null), done: K("done.fineTrail") },
    { key: "lamp", chapter: K("chapter.light"), title: K("scripted.rayLight.title"),
      text: KG("scripted.rayLight.text", "A", { name: A }),
      task: K("scripted.lamp.task"), coach: { tool: "light" }, gate: (e) => e.type === "tool" && e.tool === "light", done: K("done.switchReady") },
    { key: "lamp1", chapter: K("chapter.light"), title: K("scripted.rayLamp.title"),
      text: K("scripted.rayLamp.text"),
      task: K(`lightTile.${sideOf(beyond, safe)}`, { noun: K("noun.safe") }), coach: { cells: [beyond], tool: "light" },
      gate: (e) => e.type === "light" && e.on && same(e, beyond), nudge: wrongTile("light", [beyond], K("scripted.rayLamp.nudge")), done: K("done.lit") },
    place("D", K("chapter.placing"), LC.title,
      LC.text,
      K("scripted.placeTask", { name: D })),
    place("E", K("chapter.placing"), KG("scripted.placeFoot.title", "E", { name: E }),
      KG("scripted.placeFoot.text", "E", { name: E, other: D }),
      K("scripted.placeTask", { name: E })),
    place("C", K("chapter.placing"), K("scripted.placeDoor.title"),
      KG("scripted.placeDoor.text", "C", { name: C, other: E }),
      K("scripted.placeTask", { name: C })),
    { key: "eraser", chapter: K("chapter.cleanup"), title: K("scripted.eraser.title"),
      text: K("scripted.eraserStool.text", { watcher: C, name: A }),
      task: K("scripted.eraser.task"), coach: { tool: "eraser" }, gate: (e) => e.type === "tool" && e.tool === "eraser", done: K("done.eraserInHand") },
    { key: "erase1", chapter: K("chapter.cleanup"), title: K("scripted.erase1.title"),
      text: K("scripted.erase1.text"),
      task: K("scripted.eraseStool.task"), coach: { cells: [litStool] },
      gate: (e) => e.type === "erase" && !e.all && same(e, litStool), nudge: wrongTile("erase", [litStool], K("scripted.eraseStool.nudge")), done: K("done.gone") },
    { key: "undo", chapter: K("chapter.cleanup"), title: K("scripted.undo.title"),
      text: K("scripted.undo.text"),
      task: K("scripted.undo.task"), coach: { tool: "undo" }, gate: (e) => e.type === "undo", done: K("done.backFromDead") },
    { key: "erase2", chapter: K("chapter.cleanup"), title: K("scripted.erase2.title"),
      text: K("scripted.eraseStool2.text", { name: C }),
      task: K("scripted.eraseStool2.task"), coach: { cells: [litStool] },
      gate: (e) => e.type === "erase" && !e.all && same(e, litStool), nudge: wrongTile("erase", [litStool], K("scripted.eraseStool.nudge")), done: K("done.clean") },
    place("A", K("chapter.placing"), KG("scripted.placeStool.title", "A", { name: A }),
      K("scripted.placeStool.text"),
      K("scripted.placeTask", { name: A })),
    { key: "shadow", chapter: K("chapter.sanctuary"), title: LD.title,
      text: LD.text,
      task: K("scripted.shadow.task"), coach: { card: "S", cells: [puzzle.shadow] }, gate: (e) => isPlace(e, "S", puzzle.shadow),
      nudge: (e) => (e.type === "place" && e.id === "S" ? K("nudge.shadow") : null), done: K("done.inShadows") },
    { key: "submit", chapter: K("chapter.verdict"), title: K("scripted.submit.title"),
      text: K("scripted.submit.text"),
      task: K("scripted.submit.task"), coach: { tool: "submit" }, gate: (e) => e.type === "solved", done: K("done.contractFulfilled") },
  ];
}

/** The lesson for a puzzle: the scripted walkthrough of "The Art of the Ghost", or a generic one for any other puzzle pack. `t` = useLang().t (English when omitted). */
export function buildTutorial(puzzle, lore, t = ENGLISH) {
  return buildScriptedTutorial(puzzle, lore, t) || buildGenericTutorial(puzzle, lore, t);
}

/* ═════════════════════════ ROUTER ═════════════════════════ */
const normalise = (p) => (String(p || "/").replace(/\/+$/, "") || "/").replace(/^\/play(?=\/|$)/i, "/play"); // "/PLAY" is "/play" (the case slug is lower-cased by slugOfPath)
const PAGES = { "/daily": "daily", "/about": "about", "/contact": "contact", "/legal": "legal", "/privacy": "legal", "/delete-account": "deleteAccount", "/profile": "profile", "/test/umbra": "testUmbra", "/community": "community", "/community/create": "create" };
/** /community/play/c1a2b3c4d5 → "c1a2b3c4d5" · anything else → "" */
const communityIdOf = (p) => { const m = /^\/community\/play\/([A-Za-z0-9_-]{1,40})$/.exec(normalise(p)); return m ? m[1] : ""; };
/** "/profile/stats" → "stats" · "/profile" → "info" (the tab of the profile page). */
const profileTab = (p) => (PROFILE_PAGES.find((m) => m.to === normalise(p)) || PROFILE_PAGES[0]).key;
export const toView = (p) => {
  const n = normalise(p);
  if (n === "/play" || n.startsWith("/play/")) return "play";
  if (PROFILE_PAGES.some((m) => m.to === n)) return "profile";
  if (communityIdOf(n)) return "communityPlay";
  return PAGES[n] || "home";
};
/** The address the router shows for `p`: "/PLAY/x" → "/play/x"; anything that is not a page ("/nowhere") → "/". */
const canonical = (p) => { const n = normalise(p); return toView(n) === "home" ? "/" : n; };
/** The address the router follows. Opened from disk (file://, the standalone bundle) the app lives in the hash: index.html#/play/<name>. */
const currentPath = () => {
  try {
    const l = window.location;
    if (l.protocol === "file:") { const h = l.hash.replace(/^#/, ""); return h.startsWith("/") ? h : "/"; }
    return l.pathname;
  } catch { return "/"; }
};

/** "The Art of the Ghost" → "the-art-of-the-ghost" (accents folded, apostrophes dropped, anything else becomes a dash). */
export const slugify = (s) => String(s || "").normalize("NFD").replace(/\p{M}+/gu, "").replace(/['’]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** The puzzle's address name: its title slug, or a daily contract's id (/play/daily-2026-11-03); the id is accepted too when reading a URL. */
export const puzzleSlug = (q) => (q ? (q.daily ? q.id : slugify(q.title) || q.id) : "");
/** /play/the-art-of-the-ghost → "the-art-of-the-ghost" · /play → "" */
export const slugOfPath = (p) => {
  const m = /^\/play\/([^/]+)/.exec(normalise(p));
  if (!m) return "";
  try { return decodeURIComponent(m[1]).toLowerCase(); } catch { return m[1].toLowerCase(); }
};
export const findPuzzleBySlug = (pack, slug) => (slug ? pack.find((q) => puzzleSlug(q) === slug) || pack.find((q) => String(q.id).toLowerCase() === slug) || null : null);

/** → [view, go, path, sync]. `go` navigates (and scrolls to the top); `sync` only keeps the address bar in step with the game. */
export function useRoute() {
  const [path, setPath] = useState(() => currentPath());
  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((to) => {
    pushPath(to);   // the real URL when the environment allows it …
    setPath(to);    // … and the state fallback when pushState is blocked
    try { window.scrollTo(0, 0); } catch { /* noop */ }
  }, []);
  const sync = useCallback((to, replace) => {
    if (replace) { try { window.history.replaceState({}, "", to); } catch { /* sandboxed preview: state only */ } } else pushPath(to);
    setPath(to);
  }, []);
  return [toView(path), go, path, sync];
}

/* ═════════════════════════ THE MASTER'S DOSSIER ═════════════════════════ */
const DOSSIER_MIN_KEY = "shadoku-dossier-min"; // "1" = the Master's card is folded to one line (phones need the room)
function MasterDossier({ steps, index, total, finished, skipped, canEnter, ok, nudge, onContinue, onSkip, onEnter, onHeight, col = false }) {
  const { t } = useLang();
  const [choice, setChoice] = useState(() => store.get(DOSSIER_MIN_KEY)); // "1" folded / "0" open, as the player chose (null: never chose)
  const short = useMediaQuery(SHORT_LANDSCAPE_MQ);
  const min = choice ? choice === "1" : short; // never chosen: folded on a phone held sideways, open otherwise (and it follows a rotation)
  const toggleMin = () => { const v = min ? "0" : "1"; store.set(DOSSIER_MIN_KEY, v); setChoice(v); };
  const [peek, setPeek] = useState(null); // ← Prev / Next →: an earlier step shown again (null = the current one)
  useEffect(() => { setPeek(null); }, [index, finished]);
  const at = peek === null ? index : peek, past = at < index;
  const step = steps[at];
  const read = !!step && !step.gate && !past;
  const ref = useRef(null);

  // The game is shortened by exactly this card's height, so nothing it needs is ever hidden behind it.
  useBrowserLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => onHeight(Math.ceil(el.getBoundingClientRect().height));
    set();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); onHeight(0); };
  }, [onHeight]);

  return (
    <aside className={`sh-dos${finished ? " fin" : ""}${min ? " min" : ""}${col ? " col" : ""}`} ref={ref} role="region" aria-live="polite" aria-label={t("tut.dossier")}>
      <div className="sh-dos-in">
        <div className="sh-dos-photo"><MasterPolaroid size={150} /></div>
        <div className="sh-dos-body">
          <div className={`sh-dos-top${ok && !finished && !past ? " ok" : ""}`}>
            <span className="sh-dos-badge sh-type">{t("tut.badge")}</span>
            {!finished && step && <span className="sh-dos-step">{t("tut.chapterStep", { chapter: step.chapter, step: t("tut.step", { n: at + 1, total }) })}</span>}
            {ok && !finished && !past && <span className="sh-dos-ok" role="status">✓ {ok}</span>}
            <span className="sh-dos-tools">
              {!finished && index > 0 && <>
                <button type="button" className="sh-dos-mini" onClick={() => setPeek(Math.max(0, at - 1))} disabled={at === 0}>{t("tut.prev")}</button>
                <button type="button" className="sh-dos-mini" onClick={() => setPeek(at + 1 >= index ? null : at + 1)} disabled={!past}>{t("tut.next")}</button>
              </>}
              <button type="button" className="sh-dos-mini" onClick={toggleMin} aria-expanded={!min}>{t(min ? "tut.expand" : "tut.minimize")}</button>
            </span>
          </div>

          {finished ? <h2 className="sh-type">{t("tut.doneTitle")}</h2> : step && <h2 className="sh-type">{step.title}</h2>}
          {!finished && step && (
            <p className={`sh-dos-text${nudge && !past ? " bad" : ""}${past ? " past" : ""}${(past ? step.done : nudge || step.task) ? " has-t" : ""}`} role={nudge && !past ? "alert" : undefined}>
              <span className="q">{step.text}</span>
              {past ? step.done && <> <b className="t">✓ {step.done}</b></>
                : (nudge || step.task) && <> <b className="t">{nudge || step.task}</b></>}
            </p>
          )}

          <div className="sh-dos-actions">
            {finished ? <span className="sh-dos-win">{skipped ? t("tut.skipped") : t("tut.solved")}</span>
              : <button type="button" className="sh-dos-skip" onClick={onSkip}>{t("tut.skip")}</button>}
            <div className="sh-dos-nav">
              {!finished && !read && !past && <span className="sh-dos-cue" aria-hidden="true">{t("tut.waiting")}</span>}
              {!finished && read && <button type="button" className="sh-dos-btn go" onClick={onContinue} autoFocus>{t("tut.continue")}</button>}
              {finished && canEnter && <button type="button" className="sh-enter" onClick={onEnter}>{t("tut.enter")}</button>}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

/* ═════════════════════════ /play — THE CONTRACTS PAGE ═════════════════════════ */
/**
 * Envelope tone and target polaroid of a contract: the Umbra contracts have their own. The Uninvited Guests: a black envelope and
 * N. O. Ir, the Master's hooded second in command. The finale: the burgundy Omega folder while sealed, then (accepted in Dossier № 000-OMEGA) a black envelope with the Master.
 */
const toneOf = (id) => (id === UMBRA_HARD ? "obsidian" : id === UMBRA_FINALE ? (isUnlocked(id) ? "obsidian" : "omega") : "manila");
const targetOf = (id) => (id === UMBRA_HARD ? <AssassinPolaroid who="N" size={200} tilt={2} /> /* N. O. Ir, U. M. Bra's hooded second in command */
  : id === UMBRA_FINALE ? <MasterPolaroid size={200} tilt={2} /> : null);
const pad3 = (n) => String(n).padStart(3, "0");
const diffClass = (d) => String(d).toLowerCase().replace(/[^a-z0-9]+/g, "-"); // "Very Easy" -> "very-easy" (the .sh-hub-diff colour)

function ContractsScreen({ go, puzzles, logoSrc }) {
  const hubBar = useMediaQuery(DESK_MQ) ? BAR_H_DESK : BAR_H;
  const { t } = useLang();
  const all = useMemo(() => (puzzles ? normalizePuzzles(puzzles) : PUZZLES), [puzzles]);
  const progressTick = useProgressTick(); // a sync brought another device's progress
  const bests = useMemo(() => readBestTimes(all), [all, progressTick]); // eslint-disable-line react-hooks/exhaustive-deps -- { id: best seconds } of every fulfilled contract
  const solved = useMemo(() => new Set(Object.keys(bests)), [bests]);
  const tick = useUmbraTick(); // an Umbra lock opened: show its contract
  // The Umbra contracts sit in their own slot, sealed: The Uninvited Guests' black envelope once the ten relics are in, the finale's
  // Omega folder once The Uninvited Guests is fulfilled. Opening a sealed one starts its lock (cryptex / Sanctum Seal).
  const sealedShown = (id) => (id === UMBRA_HARD && allRelics(solved)) || (id === UMBRA_FINALE && solved.has(UMBRA_HARD));
  const pack = useMemo(() => all.filter((q) => isUnlocked(q.id, solved) || sealedShown(q.id)), [all, solved, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [umbra, setUmbra] = useState(null); // "board" | "sanctum" | { relic: caseId } | null
  const [picked, setPicked] = useState(null); // puzzle whose envelope is open
  const pick = (x) => { if (isUnlocked(x.q.id, solved)) setPicked(x); else setUmbra(x.q.id === UMBRA_HARD ? "board" : "sanctum"); };
  const numbered = useMemo(() => { let n = 0; return pack.map((q) => ({ q, n: q.id === TUTORIAL_PUZZLE ? 0 : ++n })); }, [pack]);
  const groups = useMemo(() => {
    const byDiff = new Map();
    numbered.forEach((x) => { const d = x.q.difficulty || "Easy"; if (!byDiff.has(d)) byDiff.set(d, []); byDiff.get(d).push(x); });
    const known = DIFF_ORDER.filter((d) => byDiff.has(d)), extra = [...byDiff.keys()].filter((d) => !DIFF_ORDER.includes(d));
    return [...known, ...extra].map((d) => [d, byDiff.get(d)]);
  }, [numbered]);
  const trf = useMemo(() => trOf(t), [t]);
  const diffName = (d) => localizeHead({ difficulty: d }, trf).difficulty; // "Very Easy" in the active language (the English name stays the group's id)
  const labelOf = (n) => (n === 0 ? t("env.caseFile") : t("hub.contractNo", { n: pad3(n) }));
  const launch = (id) => { setUmbra(null); const x = numbered.find((y) => y.q.id === id); if (x) setPicked(x); }; // the lock opened: the contract shows its target
  const finale = all.find((q) => q.id === UMBRA_FINALE) || null;
  const finaleNo = all.filter((q) => q.id !== TUTORIAL_PUZZLE).findIndex((q) => q.id === UMBRA_FINALE) + 1;
  const acceptAndPlay = () => { acceptFinale(); setUmbra(null); if (finale) go(`/play/${puzzleSlug(finale)}`); }; // Dossier № 000-OMEGA: the Master's contract, signed

  useEffect(() => {
    const prev = document.title;
    document.title = t("page.contracts");
    return () => { document.title = prev; };
  }, [t]);
  useEffect(() => {
    if (!picked) return undefined;
    const esc = (e) => { if (e.key === "Escape") setPicked(null); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [picked]);

  return (
    <div className="sh-hub">
      <SiteHeader onLogo={() => go("/")} style={{ height: hubBar }} onNav={go} current="/play" />
      <main className="sh-hub-main">
        <h1 className="sh-type">{t("nav.pStory")}</h1>
        <h2 className="sh-hub-act sh-type">{t("hub.act", { n: 1 })}</h2>
        {groups.map(([diff, items]) => {
          const done = items.filter((x) => solved.has(x.q.id)).length;
          return (
            <section key={diff} className="sh-hub-group" aria-label={diffName(diff)}>
              <h3 className="sh-hub-h"><span className={`sh-hub-diff d-${diffClass(diff)}`}>{diffName(diff)}</span><small>{t("hub.progress", { done, total: items.length })}</small></h3>
              <div className="sh-hub-grid">
                {items.map(({ q, n }) => {
                  const ok = solved.has(q.id);
                  return (
                    <div className="sh-hub-item" key={q.id}>
                      <ContractEnvelope variant="mini" puzzle={q} label={labelOf(n)} done={ok} best={bests[q.id]} onPick={() => pick({ q, n })} tone={toneOf(q.id)} target={targetOf(q.id)} />
                      {ok && <RelicBadge caseId={q.id} onOpen={(id) => setUmbra({ relic: id })} />}
                      <p className="sh-hub-cap sh-type"><b>{n === 0 ? t("hub.capInitiation") : t("hub.capNo", { n: pad3(n) })}</b>{" "}{ok ? <span className="ok">{t("hub.capDone", { title: localizeHead(q, trf).title, time: fmtTime(bests[q.id]) })}</span> : <span>{t("hub.capInfo", { size: `${q.rooms.length}×${q.rooms[0].length}`, n: q.suspects.length })}</span>}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>
      <SiteFooter />

      {umbra === "board" && <EvidenceBoard onClose={() => setUmbra(null)} onLaunch={launch} />}
      {umbra === "sanctum" && (
        <FinalDossier onClose={() => setUmbra(null)} onAccept={acceptAndPlay}
          envelope={finale && ((onOpen) => <ContractEnvelope variant="modal" puzzle={finale} label={labelOf(finaleNo)} onAccept={acceptAndPlay} onOpen={onOpen} tone="obsidian" target={targetOf(UMBRA_FINALE)} autoOpen={false} />)} />
      )}
      {umbra && umbra.relic && <RelicModal caseId={umbra.relic} onClose={() => setUmbra(null)} />}
      {picked && (
        <div className="sh-hub-modal" role="dialog" aria-modal="true" aria-label={labelOf(picked.n)} onPointerDown={(e) => e.target === e.currentTarget && setPicked(null)}>
          <div className="sh-hub-modal-in">
            <button type="button" className="sh-hub-x" onClick={() => setPicked(null)} aria-label={t("hub.close")}>×</button>
            <ContractEnvelope key={picked.q.id} variant="modal" puzzle={picked.q} label={labelOf(picked.n)} done={solved.has(picked.q.id)} best={bests[picked.q.id]} onAccept={() => go(`/play/${puzzleSlug(picked.q)}`)}
              tone={toneOf(picked.q.id)} target={targetOf(picked.q.id)} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════ /daily — THE DAILY CONTRACT ═════════════════════════ */
function DailyScreen({ go }) {
  const hubBar = useMediaQuery(DESK_MQ) ? BAR_H_DESK : BAR_H;
  const { t, lang } = useLang();
  const modals = useModals();
  const progressTick = useProgressTick(); // a sync brought another device's progress
  const bests = useMemo(() => readBestTimes(DAILIES), [progressTick]); // eslint-disable-line react-hooks/exhaustive-deps -- { id: best seconds } of every fulfilled daily
  const { today, archive, queue } = useMemo(() => dailyShelves(DAILIES), []);
  const [picked, setPicked] = useState(null); // an archived (or queued) daily whose envelope is open
  const trf = useMemo(() => trOf(t), [t]);
  const diffName = (q) => localizeHead(q, trf).difficulty;
  const shortDate = (q) => dailyDate(q.daily, { weekday: "short", day: "numeric", month: "short" });
  const labelOf = (q) => dailyLabel(q, t, lang); // the card's header: "TUESDAY · MANSION" (the title carries the date)
  const accept = (q) => { setPicked(null); if (store.get(TUTORIAL_KEY)) go(`/play/${puzzleSlug(q)}`); else modals.openInitiation(); }; // like the story: the initiation comes first

  useEffect(() => {
    const prev = document.title;
    document.title = t("page.daily");
    return () => { document.title = prev; };
  }, [t]);
  useEffect(() => {
    if (!picked) return undefined;
    const esc = (e) => { if (e.key === "Escape") setPicked(null); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [picked]);

  const shelf = (items) => (
    <div className="sh-hub-grid">
      {items.map((q) => {
        const ok = bests[q.id] > 0;
        return (
          <div className="sh-hub-item" key={q.id}>
            <ContractEnvelope variant="mini" puzzle={q} label={labelOf(q)} done={ok} best={bests[q.id]} onPick={() => setPicked(q)} />
            <p className="sh-hub-cap sh-type"><b>{t("daily.cap", { date: shortDate(q), difficulty: diffName(q) })}</b>{ok && <> <span className="ok">✓ ⏱ {fmtTime(bests[q.id])}</span></>}</p>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="sh-hub">
      <SiteHeader onLogo={() => go("/")} style={{ height: hubBar }} onNav={go} current="/daily" />
      <main className="sh-hub-main">
        <h1 className="sh-type">{t("nav.pDaily")}</h1>
        <p className="sh-daily-intro">{t("daily.intro")}</p>
        {today ? (
          <section className="sh-hub-group" aria-label={localizeHead(today, trf).title}>
            <h2 className="sh-hub-h"><span className={`sh-hub-diff d-${diffClass(today.difficulty)}`}>{diffName(today)}</span><small>{dailyDate(today.daily, { weekday: "long", day: "numeric", month: "long" })}</small></h2>
            <div className="sh-daily-env">
              <ContractEnvelope key={today.id} variant="modal" autoOpen={false} glow puzzle={today} label={labelOf(today)} done={bests[today.id] > 0} best={bests[today.id]} onAccept={() => accept(today)} />
            </div>
          </section>
        ) : <p className="sh-daily-none sh-type">{t("daily.none")}</p>}
        <section className="sh-hub-group" aria-label={t("daily.archive")}>
          <h2 className="sh-hub-h"><span className="sh-hub-diff">{t("daily.archive")}</span><small>{t("daily.archiveNote")}</small></h2>
          {archive.length ? shelf(archive) : <p className="sh-daily-none">{t("daily.archiveEmpty")}</p>}
        </section>
        {queue.length > 0 && (
          <section className="sh-hub-group" aria-label={t("daily.queue")}>
            <h2 className="sh-hub-h"><span className="sh-hub-diff d-queue">{t("daily.queue")}</span></h2>
            {shelf(queue)}
          </section>
        )}
      </main>
      <SiteFooter />

      {picked && (
        <div className="sh-hub-modal" role="dialog" aria-modal="true" aria-label={labelOf(picked)} onPointerDown={(e) => e.target === e.currentTarget && setPicked(null)}>
          <div className="sh-hub-modal-in">
            <button type="button" className="sh-hub-x" onClick={() => setPicked(null)} aria-label={t("hub.close")}>×</button>
            <ContractEnvelope key={picked.id} variant="modal" puzzle={picked} label={labelOf(picked)} done={bests[picked.id] > 0} best={bests[picked.id]} onAccept={() => accept(picked)} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════ /play ═════════════════════════ */
/** The ☰ Menu on the tool rail, desktop and a phone held sideways (it has no site header, so no Sign In button or profile chip): Home, the
 *  Contracts group (Story, Daily Contract), the Community group (Create, Community Puzzles), the Profile group (signed in), ⚙ Settings, About,
 *  Contact, Sign In (signed out). */
function useRailMenu(go, initiated) {
  const { t } = useLang();
  const { user, signOut } = useAuth();
  const modals = useModals();
  return useMemo(() => [
    { key: "home", label: t("nav.pHome"), onSelect: () => go("/") },
    { key: "contracts", label: t("nav.pContracts"), heading: true },
    initiated // before the initiation: its envelope in a pop-up, not the story
      ? { key: "story", label: t("nav.pStory"), sub: true, onSelect: () => go("/play") }
      : { key: "initiation", label: t("nav.pInitiation"), sub: true, onSelect: modals.openInitiation },
    initiated // the daily contracts open after the initiation too: locked, it offers the initiation
      ? { key: "daily", label: t("nav.pDaily"), sub: true, onSelect: () => go("/daily") }
      : { key: "daily", label: `${t("nav.pDaily")} 🔒`, sub: true, onSelect: modals.openInitiation },
    { key: "pCommunity", label: t("nav.pCommunity"), heading: true }, // the site menu's fold key, so both menus fold it together
    { key: "create", label: t("nav.pCreate"), sub: true, onSelect: () => go("/community/create") },
    { key: "community", label: t("nav.pCommunityPuzzles"), sub: true, onSelect: () => go("/community") },
    ...(user ? [
      { key: "profile", label: t("nav.profile"), heading: true },
      ...PROFILE_PAGES.map((m) => ({ key: `profile-${m.key}`, label: t(`profile.tab.${m.key}`), sub: true, onSelect: () => go(m.to) })),
      { key: "logout", label: t("nav.logOut"), sub: true, onSelect: signOut },
    ] : []),
    { key: "settings", label: t("settings.open"), settings: true },
    { key: "about", label: t("nav.about"), onSelect: () => go("/about") },
    { key: "contact", label: t("nav.contact"), onSelect: () => go("/contact") },
    ...(user ? [] : [{ key: "auth", label: t("nav.signIn"), onSelect: modals.openSignIn }]),
  ], [t, go, user, signOut, modals, initiated]);
}

/* ═════════════════════════ /community/play/<id> ═════════════════════════ */
const CREATE_TEST_KEY = "shadoku-create-test"; // the Workshop's play-test case (ShadokuCommunity.jsx CreatePage)
/** A community puzzle in the game, without a contract picker. Opening it counts a play, fulfilling it a solve, and the
 *  "Contract Completed!" window asks for 1–5 stars. "draft-test" plays the Workshop's draft on a fresh board (nothing is counted). */
function CommunityPlayScreen({ go, id, logoSrc }) {
  const { t } = useLang();
  const [res, setRes] = useState(null);
  const test = id === "draft-test";
  useEffect(() => {
    let alive = true;
    setRes(null);
    if (test) {
      let d = null;
      try { d = JSON.parse(store.get(CREATE_TEST_KEY) || "null"); } catch { /* a damaged copy */ }
      setRes(d && d.rooms ? { ok: true, puzzle: d, meta: null, myRating: 0 } : { error: "not_found" });
      return undefined;
    }
    getCommunity(id).then((r) => { if (alive) setRes(r); });
    return () => { alive = false; };
  }, [id, test]);
  useEffect(() => { if (res && res.ok && !test) reportPlay(id, false).catch(() => {}); }, [res, id, test]);
  useEffect(() => {
    const prev = document.title;
    document.title = t("page.community");
    return () => { document.title = prev; };
  }, [t]);
  const puzzle = useMemo(() => {
    if (!res || !res.ok) return null;
    const p = res.puzzle, theme = t(`THEME.${p.theme}`);
    const difficulty = localizeHead({ difficulty: p.difficulty }, trOf(t)).difficulty;
    return { ...p, subtitle: test ? t("community.testSubtitle") : t("community.subtitle", { difficulty, theme, author: (res.meta && res.meta.author) || "?" }) };
  }, [res, t, test]);
  const [jump] = useState(() => (test ? { id: "draft-test", n: Date.now(), fresh: true } : null)); // a play-test starts on a clean board every time
  const desk = useMediaQuery(DESK_MQ), short = useMediaQuery(SHORT_LANDSCAPE_MQ);
  const merged = !desk && !short;
  const railMenu = useRailMenu(go, !!store.get(TUTORIAL_KEY));
  const back = () => go(test ? "/community/create" : "/community");
  const onGameEvent = useCallback((e) => { if (e && e.type === "solved" && !test) reportPlay(id, true).catch(() => {}); }, [id, test]);
  if (!puzzle) {
    return (
      <div className="sh-hub">
        <SiteHeader onLogo={() => go("/")} style={{ height: desk ? BAR_H_DESK : BAR_H }} onNav={go} current="/community" />
        <main className="sh-hub-main">
          <p className="sh-daily-none sh-type">{!res ? t("community.opening") : res.error === "storage" ? t("community.unavailable") : t("community.notFound")}</p>
          {res && <p style={{ textAlign: "center" }}><button type="button" className="sh-btn" onClick={back}>{t("community.back")}</button></p>}
        </main>
        <SiteFooter />
      </div>
    );
  }
  return (
    <div className="sh-playroot">
      <ShadokuGame
        t={t} puzzles={[puzzle]} logoSrc={logoSrc} forcePuzzleId={puzzle.id} jumpTo={jump} fixedCase onExit={back}
        exitLabel={t(test ? "community.backToWorkshop" : "community.back")} onLogo={() => go("/")}
        headEnd={merged ? <><UserPill /><SiteMenu current="/community" onNav={go} /></> : null} menu={merged ? null : railMenu}
        langPicker={<LanguageSelector />} onGameEvent={onGameEvent}
        doneExtra={test ? () => <p className="sk-done-lore">{t("community.testDone")}</p> : ({ id: pid }) => <RateBox id={pid} meta={res.meta} initial={res.myRating || 0} />}
      />
    </div>
  );
}

function PlayScreen({ go, puzzles, logoSrc, lab, path, sync }) {
  const { t } = useLang();
  const pack = useMemo(() => [...(puzzles ? normalizePuzzles(puzzles) : PUZZLES), ...DAILIES], [puzzles]); // the story, then the daily contracts (no picker after the initiation: fixedCase)
  const tutorial = pack.find((q) => q.id === TUTORIAL_PUZZLE) || null;
  const tutorialId = tutorial ? tutorial.id : (pack[0] && pack[0].id) || TUTORIAL_PUZZLE; // a pack without the tutorial: teach on its first case
  const firstCase = pack.find((q) => q.id !== tutorialId) || null; // "Case #1"
  const lore = useMemo(() => loreOf(tutorial, t), [tutorial, t]); // the Master's lines, from the locale (LORE.tutorial.N.*)
  const steps = useMemo(() => buildTutorial(tutorial || pack.find((q) => q.id === tutorialId) || null, lore, t), [tutorial, pack, tutorialId, lore, t]);
  const seedOf = useMemo(() => tutorialSeed(tutorial || pack.find((q) => q.id === tutorialId) || null), [tutorial, pack, tutorialId]); // the Inspector's scribbles
  const seedToks = useMemo(() => { const at = tutorialAdowSeed(tutorial || pack.find((q) => q.id === tutorialId) || null); return at ? { S: at } : null; }, [tutorial, pack, tutorialId]); // S. H. Adow, already on the board
  const stepRef = useRef(0), stepsRef = useRef(steps), finRef = useRef(false), okTimer = useRef(null), seenRef = useRef(new Set());
  stepsRef.current = steps;

  const [initiated, setInitiated] = useState(() => !!store.get(TUTORIAL_KEY)); // "shadoku-tutorial-done"
  const progressTick = useProgressTick();
  useEffect(() => { if (progressTick && store.get(TUTORIAL_KEY)) setInitiated(true); }, [progressTick]); // initiated on another device (a sync)
  const [caseId, setCaseId] = useState(() => (store.get(TUTORIAL_KEY) ? null : tutorialId));
  const [step, setStep] = useState(0);   // index into `steps`: the lesson only moves on when the player has done the step
  const [ok, setOk] = useState("");       // the little "✓ Noted." after a step
  const [nudge, setNudge] = useState(""); // a gentle correction (wrong tile / wrong suspect)
  stepRef.current = step;
  const [finished, setFinished] = useState(false); // solved (or skipped) during this visit to the tutorial
  const [skipped, setSkipped] = useState(false);
  const slug = slugOfPath(path);
  const jumpFor = (q, n) => (q.id === tutorialId ? { id: q.id, n, fresh: true, seedNotes: seedOf, seedTokens: seedToks } : { id: q.id, n }); // the tutorial always opens on a clean, scribbled board
  const openable = (q) => q && isUnlocked(q.id, new Set(Object.keys(readBestTimes(pack)))); // The Umbra Conspiracy's locked contracts stay closed
  const umbraTick = useUmbraTick();
  const [solvedTick, setSolvedTick] = useState(0); // a contract was fulfilled: the conspiracy's locks are re-read
  const shown = useMemo(() => pack.filter((q) => openable(q)), [pack, umbraTick, solvedTick]); // eslint-disable-line react-hooks/exhaustive-deps -- the case menu skips locked Umbra contracts
  const [jump, setJump] = useState(() => {
    const q0 = !store.get(TUTORIAL_KEY) ? null : findPuzzleBySlug(pack, slug); // a deep link; before the initiation everyone starts on the tutorial
    const q = openable(q0) ? q0 : null;
    return q ? jumpFor(q, 0) : (store.get(TUTORIAL_KEY) ? null : { id: tutorialId, n: 0, fresh: true, seedNotes: seedOf, seedTokens: seedToks });
  });
  const caseRef = useRef(null), urlSynced = useRef(false);
  const [cardH, setCardH] = useState(0);
  const [view, setView] = useState("play"); // the game's own "play" / Inspector ("lab") switch

  useEffect(() => {
    const prev = document.title;
    document.title = t("page.play");
    return () => { document.title = prev; };
  }, [t]);

  useEffect(() => () => { if (okTimer.current) clearTimeout(okTimer.current); }, []);
  const advance = useCallback((n) => { stepRef.current = n; seenRef.current = new Set(); setStep(n); setNudge(""); }, []);

  const complete = useCallback((how) => { // solved or skipped: either way the case files unlock for good
    finRef.current = true;
    store.set(TUTORIAL_KEY, "1");
    setInitiated(true);
    setFinished(true);
    setSkipped(how === "skip");
  }, []);

  const onGameEvent = useCallback((e) => {
    const type = typeof e === "string" ? e : e && e.type;
    if (type === "view") { setView(e.view === "lab" ? "lab" : "play"); return; }
    if (type === "solved") setSolvedTick((n) => n + 1);
    if (type === "solved" && (!e.id || e.id === tutorialId)) { complete("solved"); return; }
    // the lesson: the current step's gate decides whether the player really did what the Master asked
    if (finRef.current || caseRef.current !== tutorialId || !e || typeof e !== "object") return;
    const cur = stepsRef.current[stepRef.current];
    if (!cur || !cur.gate) return;
    ['', e.id || ''].forEach((id) => seenRef.current.add(`${e.type}:${id}:${e.r},${e.c}:${e.drag ? "d" : "t"}`)); // once with the suspect, once for any suspect
    if (cur.gate(e, seenRef.current)) {
      advance(stepRef.current + 1);
      setOk(cur.done || "");
      if (okTimer.current) clearTimeout(okTimer.current);
      okTimer.current = setTimeout(() => setOk(""), 3200);
    } else if (cur.nudge) {
      const n = cur.nudge(e);
      if (n) setNudge(n);
    }
  }, [complete, tutorialId, advance]);

  const onCaseChange = useCallback((id) => {
    const prev = caseRef.current;
    caseRef.current = id;
    setCaseId(id);
    if (id === tutorialId && prev && prev !== tutorialId) { advance(0); setOk(""); setJump({ id, n: Date.now(), fresh: true, seedNotes: seedOf, seedTokens: seedToks }); } // back to the tutorial from the picker: a clean lesson
    const q = pack.find((x) => x.id === id);
    if (q) { // the address bar follows the case picker: /play/<puzzle-name>
      const want = `/play/${puzzleSlug(q)}`;
      if (normalise(currentPath()) !== want) sync(want, !urlSynced.current); // the first sync replaces "/play"; after that every pick is a history step
      urlSynced.current = true;
    }
    if (id !== tutorialId) { setFinished(false); setSkipped(false); finRef.current = false; }
  }, [tutorialId, pack, sync, advance, seedOf, seedToks]);

  // Back / Forward (or a pasted link) to another /play/<name>: open that puzzle
  useEffect(() => {
    const q = findPuzzleBySlug(pack, slug);
    if (!q || !initiated || q.id === caseRef.current) return;
    if (!openable(q)) { go("/play"); return; }
    setJump(jumpFor(q, Date.now()));
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const enter = useCallback(() => { const q = pack.find((x) => x.id === caseRef.current); go(q && q.daily ? "/daily" : "/play"); }, [go, pack]); // back to its contracts page: the story's, or the Daily Contract

  const replay = useCallback(() => {
    advance(0); setOk(""); setFinished(false); setSkipped(false); finRef.current = false;
    setJump({ id: tutorialId, n: Date.now(), fresh: true, seedNotes: seedOf, seedTokens: seedToks });
  }, [tutorialId, advance, seedOf, seedToks]);

  const helpExtra = useCallback(({ close }) => (
    <div className="sh-help-extra">
      <p className="sh-dos-note">{t(LORE_NOTE_KEY)}</p>
      <button type="button" className="sk-btn primary" onClick={() => { close(); replay(); }}>{t("help.replay")}</button>
    </div>
  ), [replay, t]);

  const showCard = caseId === tutorialId && view === "play"; // the Inspector gets the whole screen
  const short = useMediaQuery(SHORT_LANDSCAPE_MQ), desk = useMediaQuery(DESK_MQ);
  const merged = !desk && !short; // no site header on /play: a phone held upright has one header line (logo, timer, ⚙, ?, sign-in, ☰); desktop and a phone held sideways have the rail's ☰ Menu (sign-in and the profile inside)
  const railMenu = useRailMenu(go, initiated);

  // a phone held sideways: the card lives in the suspects column (the game draws it there), so the board keeps the whole height
  const card = showCard && (
    <MasterDossier steps={steps} index={Math.min(step, steps.length - 1)} total={steps.length} col={short}
      finished={finished} skipped={skipped} canEnter ok={ok} nudge={nudge}
      onContinue={() => advance(Math.min(steps.length - 1, step + 1))} onSkip={() => complete("skip")} onEnter={enter} onHeight={setCardH} />
  );

  return (
    <div className={`sh-playroot${showCard && desk ? " tut" : ""}`}>
      <ShadokuGame
        t={t}
        puzzles={shown} logoSrc={logoSrc} lab={lab}
        insetY={showCard && !short ? cardH : 0}
        dossierCard={short ? card : null}
        onLogo={() => go("/")}
        headEnd={merged ? <><UserPill /><SiteMenu current="/play" onNav={go} /></> : null} menu={merged ? null : railMenu} fixedCase={initiated} onExit={enter}
        renderEnvelope={({ puzzle, label, onPick, variant = "mini", onAccept, tone, onOpen }) => <ContractEnvelope variant={variant} puzzle={puzzle} label={label} onPick={onPick} onAccept={onAccept} onOpen={onOpen}
          tone={tone || (variant === "modal" ? "obsidian" : toneOf(puzzle.id))} target={targetOf(puzzle.id)} autoOpen={variant !== "modal"} />}
        lockCaseMenu={!initiated}
        forcePuzzleId={!initiated ? tutorialId : null}
        onGameEvent={onGameEvent}
        onCaseChange={onCaseChange}
        jumpTo={jump}
        helpExtra={helpExtra}
        langPicker={<LanguageSelector />}
        onLaunch={(id) => { const q = pack.find((x) => x.id === id); if (q) setJump(jumpFor(q, Date.now())); }}
        coach={showCard && !finished && steps[step] ? steps[step].coach || null : null}
      />

      {!short && card}
    </div>
  );
}

/* ═════════════════════════ ROOT ═════════════════════════ */
export default function ShadokuApp({ onSignIn, onCheckUsername, onUsernameChange, onAvatarChange, onSession, onSignOut, onDeleteAccount, authError, screenshots, puzzles, logoSrc, lab }) {
  const [view, go, path, sync] = useRoute();
  const startSlug = useMemo(() => puzzleSlug((puzzles ? normalizePuzzles(puzzles) : PUZZLES).find((q) => q.id === TUTORIAL_PUZZLE)) || "the-art-of-the-ghost", [puzzles]); // the home envelope opens the tutorial puzzle itself
  const initiated = !!store.get(TUTORIAL_KEY);
  const tick = useUmbraTick();
  const locked = useMemo(() => { // /play/<name> of an Umbra contract that is still locked: show the envelopes instead
    if (view !== "play" || !initiated) return false;
    const slug = slugOfPath(path);
    if (!slug) return false;
    const pack = [...(puzzles ? normalizePuzzles(puzzles) : PUZZLES), ...DAILIES], q = findPuzzleBySlug(pack, slug);
    return !q || !isUnlocked(q.id, new Set(Object.keys(readBestTimes(pack)))); // no such contract: the envelopes too
  }, [view, initiated, puzzles, path, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (locked) sync("/play", true); }, [locked, sync]);
  const dailyLocked = view === "daily" && !initiated; // /daily before the initiation: the initiation (like a story deep link)
  useEffect(() => { if (dailyLocked) sync("/play", true); }, [dailyLocked, sync]);
  useEffect(() => { // an unknown or oddly cased address: the address bar shows the page that is really open
    const fromDisk = typeof window !== "undefined" && window.location.protocol === "file:";
    const now = currentPath(); // the live address: the game may already have replaced `path` in this commit (the tutorial's own address)
    if (!fromDisk && canonical(now) !== now) sync(canonical(now), true);
  }, [path, sync]);
  useEffect(() => { // the page's canonical address for search engines (index.html only knows the home page)
    if (typeof document === "undefined" || window.location.protocol === "file:") return;
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) { link = document.createElement("link"); link.rel = "canonical"; document.head.appendChild(link); }
    const c = canonical(path);
    link.href = "https://www.shadoku.net" + (c === "/" ? "/" : c);
  }, [path]);
  const contracts = view === "play" && initiated && (!slugOfPath(path) || locked); // /play after the initiation: the envelopes
  const startInitiation = useCallback(() => go(`/play/${startSlug}`), [go, startSlug]); // the home envelope (and the Menu's pop-up) open the tutorial puzzle
  const skipInitiation = useCallback(() => { store.set(TUTORIAL_KEY, "1"); go("/play"); }, [go]); // "Skip Initiation": the case files unlock, straight to the contracts
  const launchContract = useCallback((id) => { // the profile's Evidence Board: "Enter “The Uninvited Guests”"
    const q = (puzzles ? normalizePuzzles(puzzles) : PUZZLES).find((x) => x.id === id);
    go(q ? `/play/${puzzleSlug(q)}` : "/play");
  }, [puzzles, go]);
  return (
    <ShadokuProviders onSignIn={onSignIn} onCheckUsername={onCheckUsername} onUsernameChange={onUsernameChange} onAvatarChange={onAvatarChange}
      onSession={onSession} onSignOut={onSignOut} onDeleteAccount={onDeleteAccount} authError={authError}
      onStart={startInitiation} onSkip={skipInitiation} onNav={go}>
      <style data-shadoku="app">{APP_CSS}</style>
      {contracts ? <ContractsScreen go={go} puzzles={puzzles} logoSrc={logoSrc} />
        : view === "play" || dailyLocked ? <PlayScreen go={go} puzzles={puzzles} logoSrc={logoSrc} lab={lab} path={path} sync={sync} />
        : view === "daily" ? <DailyScreen go={go} />
        : view === "about" ? <AboutPage go={go} />
        : view === "contact" ? <ContactPage go={go} />
        : view === "legal" ? <LegalPage go={go} />
        : view === "deleteAccount" ? <DeleteAccountPage go={go} />
        : view === "profile" ? <ProfilePage go={go} tab={profileTab(path)} puzzles={puzzles} onLaunch={launchContract} ranking={<RankingPanel />} />
        : view === "community" ? <CommunityPage go={go} />
        : view === "create" ? <CreatePage go={go} />
        : view === "communityPlay" ? <CommunityPlayScreen key={communityIdOf(path)} go={go} id={communityIdOf(path)} logoSrc={logoSrc} />
        : view === "testUmbra" ? <TestUmbraPage go={go} puzzles={puzzles} />
        : <ShadokuHome onPlay={() => go("/play")} onNav={go} onStart={startInitiation} onSkip={skipInitiation} screenshots={screenshots} />}
    </ShadokuProviders>
  );
}

const APP_CSS = `
.sh-playroot{height:100vh;height:100dvh;overflow:hidden;background:#141419;color:#F5F0E6;font-family:'Barlow',system-ui,sans-serif}
.sh-playroot *{box-sizing:border-box}
/* the play page never scrolls or bounces as a whole (a drag outside the suspects used to pull the whole page up on phones) */
html:has(.sh-playroot),html:has(.sh-playroot) body{overflow:hidden;overscroll-behavior:none}
.sh-playroot{position:fixed;inset:0;overscroll-behavior:none}
.sh-playroot .sk-dossier,.sh-playroot .sk-rail{overscroll-behavior:contain}
.sh-header a.sh-btn{text-decoration:none}

/* The Master's dossier card: pinned under the game, mahogany + brass like his Polaroid */
.sh-dos{position:fixed;z-index:45;left:0;right:0;bottom:0;background:linear-gradient(180deg,#2a1d1c,#1d1615);color:#F5F0E6;border-top:2px solid #D99B26;
  box-shadow:0 -12px 40px rgba(0,0,0,.55),inset 0 1px 0 rgba(217,155,38,.25);padding-bottom:env(safe-area-inset-bottom);font-family:'Barlow',system-ui,sans-serif}
.sh-dos *{box-sizing:border-box}
/* desktop initiation: the tool rail keeps the window's full height and the dossier card stops beside it (the card never covers a tool) */
.sh-playroot.tut .sk-rail{position:fixed;top:0;bottom:0;right:0;width:116px}
.sh-playroot.tut .sh-dos{right:116px}
[dir=rtl] .sh-playroot.tut .sk-rail{right:auto;left:0}
[dir=rtl] .sh-playroot.tut .sh-dos{right:0;left:116px}
.sh-dos-in{max-width:1040px;margin:0 auto;padding:10px 16px 11px;display:flex;gap:14px;align-items:flex-start}
.sh-dos-photo{flex:0 0 72px;width:72px;margin-top:4px;filter:drop-shadow(0 4px 8px rgba(0,0,0,.5))}
.sh-dos-body{flex:1 1 auto;min-width:0}
.sh-dos-top{display:flex;align-items:center;gap:4px 10px;flex-wrap:wrap;line-height:1.2}
.sh-dos-badge{background:#D99B26;color:#1b1305;font-size:12px;padding:2px 8px;border-radius:3px;letter-spacing:.06em}
.sh-dos-step{font-size:12px;color:#b9ad97;font-weight:600}
.sh-dos-text{margin:2px 0 6px;font-size:14.5px;line-height:1.42;color:#F5F0E6}
.sh-dos-text .q{font-style:italic;color:#e9dfc9}.sh-dos-text .t{color:#fff;font-weight:700}
.sh-dos-text.bad .t{color:#ff9a96}
.sh-dos-ok{font-size:12.5px;font-weight:700;color:#7fe0b4;animation:shOk .25s ease-out}
@keyframes shOk{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
.sh-dos-tools{display:flex;gap:4px;margin-inline-start:auto}
.sh-dos-mini{position:relative;font:inherit;font-size:12px;font-weight:700;min-height:32px;padding:4px 10px;border-radius:8px;border:1px solid #5a4a3e;background:rgba(255,255,255,.04);color:#e9dfc9;cursor:pointer;white-space:nowrap}
.sh-dos-mini:before{content:"";position:absolute;inset:-5px -3px} /* a 40px hit area (measured from inside the 1px border) */
.sh-dos-mini:hover:not([disabled]){background:rgba(255,255,255,.1)}
.sh-dos-mini[disabled]{opacity:.35;cursor:default}
.sh-dos-text.past{opacity:.85}.sh-dos-text.past .t{color:#7fe0b4}
/* folded: the badge row, the task and the buttons; the Master's portrait, title and words wait behind Expand */
/* a phone held sideways: the card sits at the top of the suspects column (inside the game), above the cards that scroll under it */
.sh-dos.col{position:sticky;top:0;left:auto;right:auto;bottom:auto;z-index:6;margin:0 0 2px;border:2px solid #D99B26;border-radius:12px;padding-bottom:0;box-shadow:0 6px 18px rgba(0,0,0,.45)}
.sh-dos.col .sh-dos-in{padding:7px 9px 8px;gap:0}
.sh-dos.col .sh-dos-photo{display:none}
.sh-dos.col h2{font-size:17px}.sh-dos.col .sh-dos-text{font-size:13.5px;line-height:1.36}
.sh-dos.min .sh-dos-photo,.sh-dos.min h2,.sh-dos.min .sh-dos-note,.sh-dos.min .sh-dos-text.has-t .q,.sh-dos.min .sh-dos-cue{display:none}
.sh-dos.min .sh-dos-text:not(.has-t){display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sh-dos.min .sh-dos-text{margin:2px 0 0}
.sh-dos.min .sh-dos-actions{margin-top:4px}
.sh-dos h2{margin:1px 0 2px;font-size:clamp(18px,3.2vw,23px);color:#f0b94a;font-weight:400;line-height:1.15}
.sh-dos-note{margin:0 0 6px;font-size:13px;line-height:1.4;color:#e9d9b8;padding:6px 9px;border-left:3px solid #D99B26;background:rgba(217,155,38,.1);border-radius:0 6px 6px 0}
.sh-dos-win{font-size:13px;font-weight:700;color:#7fe0b4;line-height:1.3;flex:1 1 220px;min-width:0}
.sh-dos-actions{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px}
.sh-dos-skip{background:none;border:0;padding:2px 0;font:inherit;font-size:12.5px;color:#9d917c;text-decoration:underline;text-decoration-color:rgba(157,145,124,.45);text-underline-offset:3px;cursor:pointer}
.sh-dos-skip:hover{color:#d9cdb6}
.sh-dos-skip{position:relative}.sh-dos-skip:before{content:"";position:absolute;inset:-10px -6px} /* a 40px hit area */
.sh-dos-nav{display:flex;align-items:center;gap:8px;margin-inline-start:auto;flex-wrap:wrap;justify-content:flex-end}
.sh-dos-cue{font-size:12px;color:#b9ad97;font-weight:600;margin-right:2px}
.sh-dos-btn{font:inherit;font-size:13.5px;font-weight:700;padding:6px 13px;border-radius:9px;border:1px solid #5a4a3e;background:rgba(255,255,255,.05);color:#F5F0E6;cursor:pointer}
.sh-dos-btn:hover:not([disabled]){background:rgba(255,255,255,.1)}
.sh-dos-btn.go{background:#D99B26;border-color:#f0b94a;color:#1b1305}
.sh-dos-btn.go:hover:not([disabled]){background:#f0b94a}
.sh-dos-btn[disabled]{opacity:.38;cursor:default}
.sh-dos button:focus-visible{outline:2px solid #6fd0ff;outline-offset:2px}
.sh-enter{padding:7px 14px;border-radius:10px;border:1px solid #f0b94a;background:linear-gradient(180deg,#f0b94a,#D99B26);color:#1b1305;font:inherit;font-size:14px;font-weight:800;letter-spacing:.01em;cursor:pointer;
  box-shadow:0 0 0 3px rgba(217,155,38,.2),0 6px 18px rgba(0,0,0,.4);animation:shEnter 2.2s ease-in-out infinite}
.sh-enter:hover{background:#f6c564}
@keyframes shEnter{0%,100%{box-shadow:0 0 0 3px rgba(217,155,38,.2),0 6px 18px rgba(0,0,0,.4)}50%{box-shadow:0 0 0 6px rgba(217,155,38,.32),0 6px 22px rgba(217,155,38,.25)}}
/* the contracts page */
.sh-hub{min-height:100vh;min-height:100dvh;background:radial-gradient(ellipse 80% 30% at 50% -6%,rgba(217,155,38,.14),transparent 70%),#141419;color:#F5F0E6;font-family:'Barlow',system-ui,sans-serif}
.sh-hub *{box-sizing:border-box}
.sh-hub-main{max-width:1100px;margin:0 auto;padding:clamp(22px,4vw,44px) clamp(14px,3vw,28px) 70px}
.sh-hub-main h1{margin:0 0 clamp(18px,3vw,34px);font-size:clamp(28px,5vw,44px);font-weight:400;text-align:center;line-height:1.1}
.sh-hub-group{margin-top:clamp(22px,4vw,40px)}
.sh-hub-act{margin:0 0 4px;text-align:center;font-size:clamp(17px,2.4vw,21px);font-weight:400;letter-spacing:.14em;text-transform:uppercase;color:#D99B26}
.sh-daily-intro{max-width:640px;margin:-6px auto 0;text-align:center;font-size:15px;line-height:1.5;color:#cfc8b6}
.sh-daily-env{width:min(560px,100%);margin:0 auto}
.sh-daily-none{margin:8px 0 0;color:#8d8a80;font-size:14.5px}
.sh-hub-diff.d-queue{border-color:#6fd0ff}
.sh-hub-h{display:flex;align-items:center;gap:12px;margin:0 0 clamp(8px,2vw,16px);padding-bottom:8px;border-bottom:1px solid #30303f;font-size:16px;font-weight:400}
.sh-hub-h small{color:#8d8a80;font-size:13px;font-weight:600;letter-spacing:.04em}
.sh-hub-diff{font-family:'Special Elite','Courier New',monospace;font-size:clamp(17px,2.4vw,21px);padding:3px 14px;border-radius:4px;background:#2a2a36;color:#F5F0E6;border-left:4px solid #D99B26}
.sh-hub-diff.d-tutorial{border-color:#8ea0ff}.sh-hub-diff.d-very-easy{border-color:#58b784}.sh-hub-diff.d-easy{border-color:#8fcf5a}.sh-hub-diff.d-medium{border-color:#D99B26}.sh-hub-diff.d-hard{border-color:#e0743a}.sh-hub-diff.d-expert{border-color:#C83E3B}
.sh-hub-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:clamp(14px,2.4vw,26px) clamp(14px,2.4vw,24px)}
.sh-hub-item{min-width:0}
.sh-hub-item .sh-env-cq.mini{border-radius:8px}
.sh-hub-cap{margin:4px 0 0;text-align:center;font-size:13.5px;color:#cfc8b6;line-height:1.3}.sh-hub-cap b{color:#D99B26;font-weight:400}.sh-hub-cap .ok{color:#7fe0b4}
.sh-hub-item{position:relative}
.sh-hub-umbra{margin:0 0 26px}.sh-hub-umbra-row{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start}
.sh-hub-diff.d-umbra{color:#e9e6f2;background:linear-gradient(135deg,#2b2933,#0d0c12);border-color:#8a8598}
.sh-hub-modal{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;overflow:auto;background:rgba(8,8,12,.82);animation:shHubFade .2s ease}
@keyframes shHubFade{from{opacity:0}to{opacity:1}}
.sh-hub-modal-in{position:relative;width:min(560px,100%);padding:0 0 30px}
.sh-hub-x{position:absolute;top:-6px;right:-4px;z-index:5;width:38px;height:38px;border-radius:50%;border:1px solid #5a4a3e;background:#1d1615;color:#F5F0E6;font-size:22px;line-height:1;cursor:pointer}
.sh-hub-x:hover{background:#2a1d1c}
.sh-help-extra{margin-top:12px;display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.sh-help-extra .sh-dos-note{align-self:stretch;margin:0;color:#4a3d2c;background:rgba(217,155,38,.14)}
.sh-help-extra .sk-btn{padding:8px 14px}
@media (max-width:520px){.sh-hub-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.sh-hub-cap{font-size:12px}}
@media (max-width:640px){
  .sh-dos-in{padding:8px 12px 9px;gap:10px}
  .sh-dos-photo{flex-basis:56px;width:56px}
  .sh-dos-text{font-size:13.5px;line-height:1.38;margin-bottom:4px}
  .sh-dos-note{font-size:12px;padding:4px 7px}
  .sh-dos-top .sh-dos-badge{display:none} /* the step label says where we are; the top row keeps to one line */
  .sh-dos-top{flex-wrap:nowrap}.sh-dos-step{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sh-dos-top.ok .sh-dos-step{display:none} /* the "✓ Noted." line stands in for the step label for its few seconds */
  .sh-dos-ok{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sh-dos-mini{padding:4px 8px}
  .sh-dos-text{max-height:calc(4 * 1.38em);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin} /* four lines, the rest scrolls */
  .sh-dos-cue{display:none}
  .sh-dos.fin .sh-dos-note{display:none}
  .sh-enter{flex:1 1 100%;padding:9px 12px;font-size:14px}
  .sh-dos-btn{padding:5px 11px;font-size:13px}
  .sh-dos h2{margin:3px 0 2px}
}
.sh-dos-photo svg{width:100%!important;height:auto!important}
/* desktop: a taller, fixed-height card (so the board does not resize from step to step) with room for the Master's whole line */
@media (min-width:961px){
  .sh-dos:not(.min){height:clamp(210px,26vh,280px)}
  .sh-dos-in{height:100%;max-width:1120px;padding:16px 24px 16px;gap:20px}
  .sh-dos-photo{flex-basis:150px;width:150px;margin-top:0}
  .sh-dos-body{display:flex;flex-direction:column;min-height:0;height:100%}
  .sh-dos h2{font-size:clamp(21px,2.2vw,27px);margin:3px 0 4px}
  .sh-dos-text{flex:1 1 auto;min-height:0;overflow-y:auto;font-size:16.5px;line-height:1.5;margin:2px 0 8px;scrollbar-width:thin}
  .sh-dos-actions{margin-top:auto;flex:0 0 auto}
  .sh-dos-skip{font-size:13.5px}
  .sh-dos-btn{font-size:14.5px;padding:8px 16px}
  .sh-enter{font-size:15px;padding:9px 18px}
}
@media (prefers-reduced-motion:reduce){.sh-enter{animation:none}}
`;
