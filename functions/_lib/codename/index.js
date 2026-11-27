// The Codename filter: which names are refused, and which are reserved. One plain ES module with no imports of its own beyond the word lists beside it, so the server
// (functions/api/username.js) and the app (app/src/data/codenameRules.js, through the same relative-import pattern the app already uses for functions/_lib/app/economy.js)
// run the very same code. The Hideout's names (its own checkName) are another place that wants it: import { codenameIssue } from this file.
//
//   codenameIssue(name) → null | "blocked" | "reserved"
//     "blocked"   a swear, sexual, hateful or self-harm word is in the name (words/*.js: one file per category, intl.js for the other languages)
//     "reserved"  the name passes for staff or the product ("admin", "Shadoku") or for a Story speaker written with its initials ("S_H_Adow"; words/reserved.js)
//
// HOW A NAME IS READ
//   Case is ignored and accents are folded (ß = ss). Digits and symbols that stand for letters are letters (0 o, 1 i or l, 3 e, 4 a, 5 s, 7 t, $ s, @ a, ! i, + t). Underscores and every
//   other separator are ignored where a word may be spelled across them ("b_a_d_w_o_r_d"), and a letter typed again and again counts once ("baaadword"); a word that itself has a double
//   letter ("ball") is matched with doubles kept, so "balll" is caught and "bal" is not.
// THE TWO TIERS (the Scunthorpe problem: a short root hides inside innocent words, "Scunthorpe", "Classic", "Therapist", "Cocktail", "Essex")
//   sub   long, unambiguous words. Found anywhere in the name once the separators are taken out, so "Mr_Badword" and "b_a_d_w_o_r_d_u" are caught.
//   tok   short or ambiguous roots. Found only as a whole word: the name is cut into words at underscores, at digit runs and at case humps ("DogBad" is Dog and Bad; "SHAdow" is SH and
//         Adow), single letters typed apart are glued ("B_A_D" is one word), and a root matches only when it is a word by itself. "Classic_Glass", "Cocktail", "Dickens" pass.
//   digits   number codes (words/hate.js), found in the name with its underscores taken out.
// Every new word goes in the file of its category, as letters a-z only, and into the tier by this rule: it is `sub` only if no innocent English word or name contains it.
import profanity from "./words/profanity.js";
import sexual from "./words/sexual.js";
import slurs from "./words/slurs.js";
import hate from "./words/hate.js";
import sexviolence from "./words/sexviolence.js";
import selfharm from "./words/selfharm.js";
import intl from "./words/intl.js";
import reserved from "./words/reserved.js";

/* ───────────── reading a name ───────────── */
const LEET = { 0: "o", 1: "il", 3: "e", 4: "a", 5: "s", 7: "t", $: "s", "@": "a", "!": "i", "+": "t" };
const SPECIAL = { "ß": "ss", "æ": "ae", "œ": "oe", "ø": "o", "đ": "d", "ł": "l", "ı": "i", "þ": "th" };

/** Lower case, accents folded, nothing else changed. */
export const fold = (s) => String(s == null ? "" : s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[ßæœøđłıþ]/g, (c) => SPECIAL[c]);

/** Runs of one letter cut to at most `n`. */
const cap = (s, n) => s.replace(/(.)\1+/g, (m, c) => c.repeat(Math.min(m.length, n)));

/** Every reading of `s` with its digits and symbols as letters (a 1 is an i or an l; at most 8 readings). */
function leet(s) {
  let out = [""];
  for (const ch of s) {
    const to = LEET[ch];
    if (!to) { out = out.map((o) => o + ch); continue; }
    out = out.flatMap((o) => [...to].map((l) => o + l)).slice(0, 8);
  }
  return out;
}
const letters = (s) => s.replace(/[^a-z]/g, "");

/* ───────────── the lists ───────────── */
const words = (s) => String(s || "").split(/\s+/).filter(Boolean).map(fold).map(letters).filter((w) => w.length >= 2);
const SUB1 = new Set(), SUB2 = new Set(), TOK1 = new Set(), TOK2 = new Set(), DIGITS = [];
const put = (list, one, two) => { for (const w of list) (/(.)\1/.test(w) ? two : one).add(w); };
for (const cat of [profanity, sexual, slurs, hate, sexviolence, selfharm, ...Object.values(intl)]) {
  put(words(cat.sub), SUB1, SUB2);
  put(words(cat.tok), TOK1, TOK2);
  for (const d of String(cat.digits || "").split(/\s+/).filter(Boolean)) DIGITS.push(d);
}
const RES_TOK1 = new Set(), RES_TOK2 = new Set(), RES_SUB = words(reserved.sub);
put(words(reserved.tok), RES_TOK1, RES_TOK2);
const SPEAKERS = reserved.speakers.map((n) => letters(fold(n)));

/* ───────────── the words of a name ───────────── */
/** The name cut at separators and case humps; `digits`: digit runs are separators too. Letters typed apart ("A_S_S") are glued when `glue`. */
function tokens(name, { digits = false, glue = false } = {}) {
  let s = String(name == null ? "" : name).normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  if (digits) s = s.replace(/[0-9]+/g, " ");
  let t = s.split(/[^A-Za-z0-9@$!+]+/).filter(Boolean);
  if (glue) { // runs of single characters make one word
    const g = [];
    for (const w of t) { const one = /^[A-Za-z@$!+]$/.test(w); if (one && g.length && g[g.length - 1].single) { g[g.length - 1].w += w; } else g.push({ w, single: one }); }
    t = g.map((x) => x.w);
  }
  return t.map(fold);
}

// a word, or the word with the x's players put round names ("xXBadXx") cut off
const matchesTok = (w, one, two) => [w, w.replace(/^x{1,3}|x{1,3}$/g, "")].some((u) => leet(u).some((v) => { const x = letters(v); return x && (one.has(cap(x, 1)) || two.has(cap(x, 2))); }));
const hasSub = (squash, one, two) => leet(squash).some((v) => { const x = letters(v); return [...one].some((e) => cap(x, 1).includes(e)) || [...two].some((e) => cap(x, 2).includes(e)); });

/* ───────────── the verdict ───────────── */
/** → null (allowed), "blocked" or "reserved". */
export function codenameIssue(name) {
  const raw = String(name == null ? "" : name);
  if (!raw.trim()) return null;
  const squash = fold(raw).replace(/[^a-z0-9@$!+]/g, "");
  if (DIGITS.some((d) => raw.replace(/_/g, "").includes(d))) return "blocked";
  if (hasSub(squash, SUB1, SUB2)) return "blocked";
  const lists = [tokens(raw), tokens(raw, { digits: true }), tokens(raw, { glue: true }), tokens(raw, { digits: true, glue: true })];
  if (lists.some((ts) => ts.some((w) => matchesTok(w, TOK1, TOK2)))) return "blocked";
  // a short word spelled across separators or split in pieces ("b_ad", "b.a.d"); a number apart from the letters ("Word_3") is not one of its letters
  if (matchesTok(tokens(raw).filter((w) => !/^[0-9]+$/.test(w)).join(""), TOK1, TOK2)) return "blocked";
  // reserved: staff words as whole words or inside, the brand anywhere, a speaker written in two or more pieces
  if (lists.some((ts) => ts.some((w) => matchesTok(w, RES_TOK1, RES_TOK2)))) return "reserved";
  if (hasSub(squash, new Set(RES_SUB), new Set())) return "reserved";
  const base = tokens(raw).map((w) => letters(leet(w)[0]));
  for (const sp of SPEAKERS) {
    for (let i = 0; i < base.length; i += 1) {
      let acc = "";
      for (let j = i; j < base.length && acc.length < sp.length; j += 1) { acc += base[j]; if (acc === sp && j > i) return "reserved"; }
    }
  }
  return null;
}
export const isCodenameOk = (name) => codenameIssue(name) === null;
