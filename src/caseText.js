/**
 * caseText.js — a case's player-facing text, rebuilt in the browser from the tokens the engine exports.
 *
 * The English the engine writes into a case JSON (clue, text, rule, globalRules[].text, steps[].text) is rendered from tokens by
 * engine/shadoku_i18n.py (templates + formatters). This module is the same evaluator in JavaScript, reading the TEMPLATES and the
 * WORD FORMS from the active locale instead of from Python, so a translated locale file (src/locales/<lang>.json) re-words every clue,
 * house rule and hint step. scripts/test-case-text.mjs renders all 13 cases from tokens with en.json and requires an exact match
 * with the English stored in the JSON (including punctuation).
 *
 * Keys read through `tr(key)` (→ string, or undefined when the locale has no such key):
 *   generated (engine): CLUE*, ATOM.*, HID.*, GLOBAL.*, RULE_*, FRAG_*, REASON_*, STEP_*, BAN_*, CONTRA_*, FUSED.*, ASSASSIN_CLUE,
 *                       PROP.<ID>.{a,the,noun,prep,onPhrase}, TRAIT.<ID>.<form>, SURFACE.<ID>, ZONE.<ID>, ZONE_PREP.<ID>, ZONE_WORD.<WORD>,
 *                       DIFFICULTY.<ID>, CASE.<id>.{TITLE,SUBTITLE}
 *                       PROP.<ID>.onPhrase may also come as .m / .f / .n (a language whose verbs inflect for gender, e.g. Arabic): the variant of
 *                       the atom's subject is read first, the plain phrase when the locale has none. Likewise a clue sentence (ATOM.<kind>…,
 *                       FUSED.ALONE_IN_ROOM) may come as <key>.m / .f / .n for the subject's gender (Arabic "كانت" / "كان"); the plain key
 *                       is the fallback, so a language only writes the variants that differ.
 *   hand-written (ui.fmt.*): the language-dependent words of the formatters (lists, pronouns, "the X", "r{row}c{col}", "a room" …).
 * Anything that fails to render (a missing key, a case without tokens) falls back to the English stored in the case JSON.
 */

const PH = /\{(\w+)(?:\|(\w+)(?::([^}]*))?)?\}/g;
const SELF_KINDS = ["WITH_P", "TWO_P_ROOM", "NO_P_ROOM", "ALONE_WITH_P", "DIAG_P"];

/** Param name → type (engine/shadoku_i18n.py PARAM_TYPES). */
const TYPE = {};
const typed = (t, names) => names.split(" ").forEach((n) => { TYPE[n] = t; });
typed("SuspectRef", "suspect owner other partner pinned blocked x y subject clueOf");
typed("WhoRef", "who");
typed("SuspectRefList", "suspects holders");
typed("RoomId", "room room2");
typed("RoomIdList", "rooms empty");
typed("Coord", "coord");
typed("CoordList", "coords common options");
const MARKED_MAX = 3; // longer tile lists read "the marked tiles" (engine/shadoku_i18n.py MARKED_MAX)
/** Prop groups a clue may name (engine/shadoku_catalog.py PROP_GROUPS): "a tree" is any of these kinds. */
const PROP_GROUPS = { ANY_TREE: ["TREE", "OAK", "BIRCH", "PINE", "SNOW_PINE", "PALM"] };
/** Prop kind → how many separate objects of it the board holds (a multi-tile rug is ONE rug; engine/shadoku_i18n.py prop_objects). */
function propObjects(d) {
  const multi = d.multiTile || [], grouped = new Set(multi.flatMap((g) => g.cells.map(([r, c]) => `${r},${c}`))), n = {};
  multi.forEach((g) => { n[g.kind] = (n[g.kind] || 0) + 1; });
  (d.contents || []).forEach((row, r) => row.forEach((k, c) => { if (k && !grouped.has(`${r},${c}`)) n[k] = (n[k] || 0) + 1; }));
  return n;
}
typed("PropId", "prop");
typed("PropIdList", "lows");
typed("TraitId", "trait");
typed("SurfaceId", "surface");
typed("Index", "index line from to");
typed("IndexList", "lines");
typed("Dir", "dir");
typed("Int", "dist count n expected fits allows watch");
typed("Bool", "selfMatch");
typed("Token", "said poll rule lead ban reason contra summary span src left body");
typed("AtomToken", "atom");
typed("TokenList", "bits groups items seats entries parts place people");

const sub = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? "" : vars[k]));

class Ctx {
  constructor(d, tr) {
    this.d = d;
    this.tr = tr;
    this.theme = d.theme;
    this.zoneWord = d.zoneWord || "room";
    this.zw = String(this.zoneWord).toUpperCase();
    this.sus = new Map((d.suspects || []).map((s) => [s.id, s]));
    this.ass = new Map((d.assassins || []).map((a) => [a.id, a]));
    this.rooms = new Map((d.roomIds || []).map((id, i) => [id, (d.roomNames || [])[i]]));
    this.objects = propObjects(d);
  }
  /** The board holds exactly one object of prop `k` (a prop group: of all its kinds together): its clue reads "the fireplace". */
  onlyOne(k) { return (PROP_GROUPS[k] || [k]).reduce((s, x) => s + (this.objects[x] || 0), 0) === 1; }
  /** The template/word of `key`; throws when the locale lacks it (the caller falls back to the English in the JSON). */
  T(key) {
    const v = this.tr(key);
    if (v == null) throw new Error(`no text for ${key}`);
    return v;
  }
  has(key) { return this.tr(key) != null; }
  fmt(key, vars) { return sub(this.T(key), vars); }
  name(L) {
    const v = this.tr(`ui.assassin.${L}`);
    if (v != null && (L === "S" || this.ass.has(L))) return v;
    if (L === "S") return "S. H. Adow";
    const a = this.ass.get(L), s = this.sus.get(L);
    if (a) return a.name;
    if (!s) throw new Error(`unknown suspect ${L}`);
    return s.name;
  }
  /** `key` with the gender suffix of suspect `who` (.m / .f; .n for assassins, S. H. Adow and unknown) when the locale has that variant, else `key`. */
  gKey(key, who) {
    if (who == null) return key;
    const g = this.gender(who);
    const k = `${key}.${g === "m" || g === "f" ? g : "n"}`;
    return this.has(k) ? k : key;
  }
  gender(L) { const s = this.sus.get(L); return s && !this.ass.has(L) ? s.gender : null; }
  roomName(id) {
    const v = this.tr(`ZONE.${id}`);
    if (v != null) return v;
    if (!this.rooms.has(id)) throw new Error(`unknown room ${id}`);
    return this.rooms.get(id);
  }
  prep(id) { return this.tr(`ZONE_PREP.${id}`) ?? "in"; }
  clue(L) { const s = this.sus.get(L); if (!s) throw new Error(`no clue for ${L}`); return [s.atoms, s.clueTokens]; }

  /** "a, b, c" (all but the last), then the last with the list-and / list-or template. */
  head(words) { return words.reduce((acc, w) => this.fmt("ui.fmt.list.more", { head: acc, tail: w })); }
  andList(words) {
    if (!words.length) return "";
    if (words.length === 1) return words[0];
    return this.fmt("ui.fmt.list.and", { head: this.head(words.slice(0, -1)), last: words[words.length - 1] });
  }
  orList(words) {
    if (!words.length) return "";
    if (words.length === 1) return words[0];
    return this.fmt("ui.fmt.list.or", { head: this.head(words.slice(0, -1)), last: words[words.length - 1] });
  }
  commaList(words) { return words.length ? this.head(words) : ""; }
  coord(c) { return this.fmt("ui.fmt.coord", { row: c[0] + 1, col: c[1] + 1 }); }
  roomIn(id) { return this.fmt("ui.fmt.roomIn", { prep: this.prep(id), room: this.roomName(id) }); }
  /** PROP.<id>.<form>, preferring its .m/.f/.n variant when a subject `who` is given (suspect letter; assassins and S. H. Adow are "n"). */
  propForm(id, form, who) {
    const v = this.tr(this.gKey(`PROP.${id}.${form}`, who));
    if (v == null) throw new Error(`no PROP.${id}.${form}`);
    return v;
  }
}

function zoneFmt(ctx, f) {
  if (f == null) return ctx.T(`ZONE_WORD.${ctx.zw}`);
  if (f === "a") return ctx.T(`ui.fmt.zoneA.${ctx.zw}`);
  if (f === "plural") return ctx.T(`ui.fmt.zonePl.${ctx.zw}`);
  throw new Error(`zone|${f}`);
}

function pronoun(ctx, g, f) {
  const x = g === "m" || g === "f" ? g : "n";
  if (f === "obj") return ctx.T(`ui.fmt.pronounObj.${x}`);
  return ctx.T(`${f === "Pronoun" ? "ui.fmt.pronounCap" : "ui.fmt.pronoun"}.${x}`);
}

function fmtParam(key, val, f, arg, ctx, who) {
  const t = TYPE[key];
  if (t === "SuspectRef") {
    if (f == null) return ctx.name(val);
    if (f === "pronoun" || f === "Pronoun" || f === "obj") return pronoun(ctx, ctx.gender(val), f);
    if (f === "clue") return renderClue(val, ctx, false);
  } else if (t === "WhoRef" && f == null) {
    return val === "ALL" ? ctx.T("ui.fmt.assassins") : ctx.name(val);
  } else if (t === "SuspectRefList") {
    const names = val.map((x) => ctx.name(x));
    if (f === "and") return ctx.andList(names);
    if (f === "comma") return ctx.commaList(names);
    if (f === "and_or_nobody") return ctx.andList(names) || ctx.T("ui.fmt.nobody");
  } else if (t === "RoomId" && f == null) {
    return ctx.roomName(val);
  } else if (t === "RoomId" && f === "in") {
    return ctx.roomIn(val);
  } else if (t === "RoomIdList") {
    if (f === "the_or") return ctx.orList(val.map((r) => ctx.fmt("ui.fmt.the", { name: ctx.roomName(r) })));
    if (f === "comma") return ctx.commaList(val.map((r) => ctx.roomName(r)));
    if (f === "in_or") return ctx.orList(val.map((r) => ctx.roomIn(r)));
  } else if (t === "Coord" && f == null) {
    return ctx.coord(val);
  } else if (t === "CoordList") {
    if ((f == null || f === "or" || f === "and") && val.length > MARKED_MAX) return ctx.T("FRAG_MARKED_TILES"); // the hint marks them on the board
    if (f == null) return ctx.commaList([...val].sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((c) => ctx.coord(c)));
    if (f === "or") return ctx.orList(val.map((c) => ctx.coord(c)));
    if (f === "and") return ctx.andList(val.map((c) => ctx.coord(c)));
    if (f === "isare") return ctx.T(val.length === 1 ? "ui.fmt.is" : "ui.fmt.are");
  } else if (t === "PropId") {
    if (f === "a") return ctx.onlyOne(val) && ctx.has(`PROP.${val}.the`) ? ctx.propForm(val, "the") : ctx.propForm(val, "a"); // a locale without .the keeps its "a" form
    if (f === "noun") return ctx.propForm(val, "noun");
    if (f === "prep") return ctx.propForm(val, "prep");
    if (f === "on") return ctx.propForm(val, "onPhrase", who);
  } else if (t === "PropIdList" && f === "noun_or") {
    return ctx.orList(val.map((p) => ctx.propForm(p, "noun")));
  } else if (t === "TraitId" && f) {
    return ctx.T(`TRAIT.${val}.${f}`);
  } else if (t === "SurfaceId" && f == null) {
    return ctx.T(`SURFACE.${val}`);
  } else if (t === "Index" && f === "n1") {
    return String(val + 1);
  } else if (t === "IndexList" && f === "n1_or") {
    return ctx.orList(val.map((x) => String(x + 1)));
  } else if (t === "Int") {
    if (f == null) return String(val);
    if (f === "plural") { const [one, other] = arg.split(":"); return val === 1 ? one : other; }
  } else if (t === "Token" && f == null) {
    return render(val, ctx);
  } else if (t === "AtomToken" && f == null) {
    return renderAtom(val, ctx);
  } else if (t === "TokenList") {
    const parts = val.map((x) => render(x, ctx));
    if (f === "join") return parts.join(arg);
    if (f === "and") return ctx.andList(parts);
  }
  throw new Error(`no formatter ${key}|${f} for ${t}`);
}

/** `who`: the suspect the sentence is about (an atom's subject), for the gendered word forms. */
function fill(pattern, params, ctx, elims, who) {
  return pattern.replace(PH, (_, key, f, arg) => {
    if (key === "zone") return zoneFmt(ctx, f);
    if (key === "elims") return ""; // the hint marks the eliminated tiles on the board
    if (!(key in params)) throw new Error(`missing param ${key}`);
    return fmtParam(key, params[key], f, arg, ctx, who);
  });
}

function atomKey(tok, ctx, register = "ATOM") {
  const k = tok.kind, p = tok.params || {};
  const base = `${register}.${k}`;
  let v = null;
  if (k === "NOT_BESIDE" && p.prop === "CORPSE") v = "CORPSE";
  else if (k === "DOOR") v = ctx.theme;
  else if (k === "EXACT_OFFSET") v = p.dir;
  else if (k === "ONLY_G_ROOM") v = p.trait;
  else if (SELF_KINDS.includes(k) && p.selfMatch) v = "SELF";
  else if (register === "HID" && k === "ON" && p.prop === "BED") v = "BED";
  return v != null && ctx.has(`${base}.${v}`) ? `${base}.${v}` : base;
}

function renderAtom(tok, ctx, register = "ATOM") {
  return fill(ctx.T(ctx.gKey(atomKey(tok, ctx, register), tok.subject)), tok.params || {}, ctx, undefined, tok.subject);
}

function globalKey(tok) {
  return tok.kind === "NO_TWO_IN_ROOM" ? `GLOBAL.NO_TWO_IN_ROOM.${tok.params.trait}` : `GLOBAL.${tok.kind}`;
}

function render(tok, ctx, elims) {
  if (tok.templateKey) return fill(ctx.T(ctx.gKey(tok.templateKey, tok.who)), tok.params || {}, ctx, elims);
  if (tok.subject) return renderAtom(tok, ctx);
  return fill(ctx.T(globalKey(tok)), tok.params || {}, ctx);
}

function part(entry, atoms) {
  if (Number.isInteger(entry)) return atoms[entry];
  if (entry && entry.fuse === "ALONE_IN_ROOM") return { templateKey: "FUSED.ALONE_IN_ROOM", who: atoms[entry.atoms[0]].subject, params: { room: atoms[entry.atoms[0]].params.room } };
  throw new Error("unknown clue part");
}

function renderClue(letter, ctx, full = true) {
  const [atoms, p] = ctx.clue(letter);
  const place = (p.place || []).map((x) => part(x, atoms)), people = (p.people || []).map((x) => part(x, atoms));
  const body = place.length && people.length
    ? { templateKey: "CLUE_BODY.BOTH", params: { subject: letter, place, people } }
    : { templateKey: "CLUE_BODY.ONE", params: { parts: place.length ? place : people } };
  if (!full) return render(body, ctx);
  return render({ templateKey: "CLUE", params: { subject: letter, body } }, ctx);
}

function renderAssassinClue(atoms, layout, ctx) {
  const parts = layout.parts.map((i) => atoms[i]);
  return fill(ctx.T("ASSASSIN_CLUE"), {
    subject: layout.subject,
    parts: parts.map((a) => ({ templateKey: atomKey(a, ctx, "HID"), params: a.params })),
  }, ctx);
}

/** t(key) → string, or undefined when no locale (nor the in-code English) has the key: the `tr` that caseRenderer / localizeHead / localizeCase read templates through. */
export const trOf = (t) => (k) => { const v = t(k); return typeof v === "string" && v !== k ? v : undefined; };

const attempt = (fn, fallback) => {
  try { const v = fn(); return typeof v === "string" && v ? v : fallback; } catch (e) { return fallback; }
};
/** The render functions of one case. Each takes the English stored in the JSON as its fallback. */
export function caseRenderer(d, tr) {
  const ctx = new Ctx(d, tr);
  return {
    clue: (letter, fb) => attempt(() => renderClue(letter, ctx), fb),
    assassinClue: (a, fb) => attempt(() => renderAssassinClue(a.atoms, a.clueTokens, ctx), fb),
    globalRule: (g, fb) => attempt(() => render({ kind: g.kind, params: g.params }, ctx), fb),
    step: (st, fb) => attempt(() => render({ templateKey: st.i18n.templateKey, params: st.i18n.params }, ctx, st.elims), fb),
    stepRule: (st, fb) => attempt(() => fill(ctx.T(st.i18n.ruleKey), {}, ctx), fb),
    roomName: (id, fb) => attempt(() => ctx.roomName(id), fb),
    ruleByKey: (key, fb) => attempt(() => fill(ctx.T(key), {}, ctx), fb),
    /** Strict variants (throw) for tests. */
    strict: {
      clue: (letter) => renderClue(letter, ctx),
      assassinClue: (a) => renderAssassinClue(a.atoms, a.clueTokens, ctx),
      globalRule: (g) => render({ kind: g.kind, params: g.params }, ctx),
      step: (st) => render({ templateKey: st.i18n.templateKey, params: st.i18n.params }, ctx, st.elims),
      stepRule: (st) => fill(ctx.T(st.i18n.ruleKey), {}, ctx),
    },
  };
}

/** "Very Easy" → DIFFICULTY.VERY_EASY */
export const difficultyKey = (d) => `DIFFICULTY.${String(d || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`;

/**
 * Title, subtitle and difficulty only (cheap; used by lists and envelopes). The English `difficulty` stays in `diffId`
 * (CSS classes and grouping use it); `difficulty` becomes the display name.
 */
export function localizeHead(p, tr) {
  if (!p) return p;
  return {
    ...p,
    diffId: p.diffId || p.difficulty,
    title: (p.titleKey && tr(p.titleKey)) || p.title,
    subtitle: (p.subtitleKey && tr(p.subtitleKey)) || p.subtitle,
    difficulty: tr(difficultyKey(p.diffId || p.difficulty)) || p.difficulty,
  };
}

/**
 * Everything a case shows, in the active locale: head fields, `roomLabels` (zone names; `roomNames` stays English because the art
 * picks floors from it), each suspect's `clue`, `globalRules[].text` and every step's `text` / `rule`. Rebuilt from tokens; anything that
 * cannot be rebuilt keeps its English. Call it on the cast puzzle (after getCastForPuzzle) so the names match the portraits.
 */
export function localizeCase(p, tr) {
  if (!p) return p;
  const R = caseRenderer(p, tr);
  const head = localizeHead(p, tr);
  return {
    ...head,
    roomLabels: (p.roomNames || []).map((n, i) => (p.roomIds && p.roomIds[i] ? R.roomName(p.roomIds[i], n) : n)),
    suspects: (p.suspects || []).map((s) => (s.atoms && s.clueTokens ? { ...s, clue: R.clue(s.id, s.clue) } : s)),
    ...(p.assassins ? { assassins: p.assassins.map((a) => (a.atoms && a.clueTokens ? { ...a, clue: R.assassinClue(a, a.clue) } : a)) } : null),
    globalRules: (p.globalRules || []).map((g) => (g.kind ? { ...g, text: R.globalRule(g, g.text) } : g)),
    steps: (p.steps || []).map((st) => (st.i18n ? { ...st, text: R.step(st, st.text), rule: R.stepRule(st, st.rule) }
      : st.ruleKey ? { ...st, rule: R.ruleByKey(st.ruleKey, st.rule) } : st)), // old compact steps: only the rule name can be rebuilt
  };
}
