/**
 * creatorCore.js — the laws of a Shadoku case in plain JavaScript (no React, no DOM), for community puzzles.
 *
 * Used by the creator (/community/create, ShadokuCommunity.jsx) to check a draft as it is built, and by the backend
 * (functions/api/community) to refuse a broken case. It reads the same case JSON the game plays (rooms, roomIds, doors,
 * contents, propClasses, corpse, suspects[].atoms / solution, shadow) and mirrors the engine's rules:
 *   sight    orthogonal rays stop at the border, a wall (a door passes) and a TALL or PERCH prop; a PERCH tile is seen
 *            (whoever sits there is in plain view), a TALL one is not. SHORT, LOW and the Corpse are see-through.
 *   standing nobody stands on TALL, SHORT or the Corpse. No two suspects may see each other.
 *   climax   with every suspect placed exactly one open tile is unwatched: S. H. Adow hides there.
 *   clues    the atom kinds of engine/shadoku_solver.py (unary_cells / atom_true / trait_ok); S. H. Adow counts as a
 *            person for ALONE, ALONE_WITH_P and the "only person" clues, never for a trait.
 *
 *   geometry(d)            sight, zones, corners, doors … of a case (tiles are numbered r * C + c)
 *   atomHolds(g, d, pos, a) is atom `a` true when everyone stands on `pos` ({ id: tile }, "S" included)
 *   trueAtoms(g, d, pos, id, nounOf) every clue part that is true for suspect `id` and says something
 *   darkTiles(g, pos)      the open tiles nobody sees or stands on
 *   solve(d, opts)         every solution (up to opts.limit, default 2) under the laws; exhausted = the search finished
 *   grade(d)               an estimate of how hard the case is to solve by hand ("Very Easy" … "Expert"), or null
 *   solveSteps / gradeSteps the same as generators, and runSteps(gen, done) runs one in time slices (the page stays responsive)
 *   checkCase(d)           what is wrong with a case (structure, laws, false clues): [] when it is sound
 */
import { hasBadWords } from "./wordFilter.js";

export const PROP_CLASS_IDS = ["TALL", "PERCH", "SHORT", "LOW"];
export const DIFFICULTIES = ["Very Easy", "Easy", "Medium", "Hard", "Expert"];
export const SIZES = [5, 6, 7, 8, 9, 10];
export const THEMES = ["MANSION", "FARM", "BEACH", "FOREST", "MOUNTAINS", "DESERT", "STREET"];
export const MAX_SUSPECTS = 12;
export const MIN_SUSPECTS = 3;
export const MAX_ATOMS = 3;
/** Suspect letters: S is S. H. Adow; O–R are the extra assassins of the multi-assassin story cases. */
export const LETTERS = "ABCDEFGHIJKLMNTUVWXYZ".split("");

/* ───────────── bitsets (one bit per tile, 100 tiles at most) ───────────── */
const words = (n) => Math.ceil(n / 32);
const bsNew = (W) => new Uint32Array(W);
const bsSet = (b, i) => { b[i >>> 5] |= 1 << (i & 31); };
const bsHas = (b, i) => (b[i >>> 5] & (1 << (i & 31))) !== 0;
const pop32 = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
const bsCount = (b) => { let n = 0; for (let i = 0; i < b.length; i++) n += pop32(b[i]); return n; };
const bsAndCount = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) n += pop32(a[i] & b[i]); return n; };
const bsList = (b) => { const out = []; for (let w = 0; w < b.length; w++) { let x = b[w]; while (x) { const t = x & -x; out.push(w * 32 + 31 - Math.clz32(t)); x ^= t; } } return out; };

/* ───────────── geometry ───────────── */
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function geometry(d) {
  const R = d.rooms.length, C = d.rooms[0].length, N = R * C, W = words(N);
  const at = (r, c) => r * C + c, rc = (t) => [Math.floor(t / C), t % C];
  const inside = (r, c) => r >= 0 && c >= 0 && r < R && c < C;
  const room = new Int16Array(N), kind = new Array(N), cls = new Array(N);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const t = at(r, c), k = (d.contents && d.contents[r] && d.contents[r][c]) || "";
    room[t] = d.rooms[r][c];
    kind[t] = k;
    cls[t] = k === "CORPSE" ? "CORPSE" : k === "VOID" || room[t] < 0 ? "VOID" : k ? (d.propClasses && d.propClasses[k]) || null : null;
  }
  const isVoid = (r, c) => cls[at(r, c)] === "VOID"; // off the floorplan (engine cases with a shape; the creator makes none)
  const doorSet = new Set();
  const edge = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  (d.doors || []).forEach(([a, b]) => { if (Array.isArray(a) && Array.isArray(b) && inside(a[0], a[1]) && inside(b[0], b[1])) doorSet.add(edge(at(a[0], a[1]), at(b[0], b[1]))); });
  const isDoor = (a, b) => doorSet.has(edge(a, b));
  const isWall = (a, b) => room[a] !== room[b] && !isDoor(a, b);
  const occ = new Uint8Array(N), occB = bsNew(W);
  for (let t = 0; t < N; t++) if (kind[t] !== "CORPSE" && cls[t] !== "TALL" && cls[t] !== "SHORT" && cls[t] !== "VOID") { occ[t] = 1; bsSet(occB, t); }

  const vis = [], visB = [], cov = [];
  for (let t = 0; t < N; t++) {
    const [r, c] = rc(t), seen = [], b = bsNew(W);
    for (const [dr, dc] of DIRS) {
      let r0 = r, c0 = c;
      for (;;) {
        const r1 = r0 + dr, c1 = c0 + dc;
        if (!inside(r1, c1) || isVoid(r1, c1) || isWall(at(r0, c0), at(r1, c1))) break;
        const u = at(r1, c1);
        if (cls[u] === "TALL") break;
        seen.push(u); bsSet(b, u);
        if (cls[u] === "PERCH") break; // the rider is seen, then the ray stops
        r0 = r1; c0 = c1;
      }
    }
    vis.push(seen); visB.push(b);
    const cv = b.slice(); bsSet(cv, t); cov.push(cv); // a suspect watches its sightlines and stands on its own tile
  }

  const sideWall = (t, dr, dc) => { const [r, c] = rc(t), r1 = r + dr, c1 = c + dc; return !inside(r1, c1) || isVoid(r1, c1) || isWall(t, at(r1, c1)); };
  const corner = new Uint8Array(N), atDoor = new Uint8Array(N), besideKinds = [], diag = [];
  for (let t = 0; t < N; t++) {
    const [r, c] = rc(t);
    corner[t] = (sideWall(t, -1, 0) || sideWall(t, 1, 0)) && (sideWall(t, 0, -1) || sideWall(t, 0, 1)) ? 1 : 0;
    const ks = new Set();
    for (const [dr, dc] of DIRS) {
      const r1 = r + dr, c1 = c + dc;
      if (!inside(r1, c1)) continue;
      const u = at(r1, c1);
      if (isDoor(t, u)) atDoor[t] = 1;
      if (room[u] === room[t] && kind[u] && kind[u] !== "VOID") ks.add(kind[u]);
    }
    besideKinds.push(ks);
    const dg = [];
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const r1 = r + dr, c1 = c + dc;
      if (inside(r1, c1) && occ[at(r1, c1)] && room[at(r1, c1)] === room[t]) dg.push(at(r1, c1));
    }
    diag.push(dg);
  }
  let corpse = -1;
  for (let t = 0; t < N; t++) if (kind[t] === "CORPSE") corpse = t;
  const zoneIdx = (id) => (d.roomIds || []).indexOf(id);
  return {
    R, C, N, W, at, rc, inside, room, kind, cls, occ, occB, vis, visB, cov, corner, atDoor, besideKinds, diag, corpse, isDoor, isWall, zoneIdx,
    seesCorpse: (t) => corpse >= 0 && bsHas(visB[t], corpse),
    seesOther: (t) => vis[t].some((u) => room[u] !== room[t]),
    bsNew: () => bsNew(W),
  };
}

/* ───────────── people and traits ───────────── */
/** Trait id (engine TRAIT_PREDS) → does this suspect have it. S. H. Adow (no traits, no gender) never does. */
export const TRAIT_TEST = {
  MALE: (s) => s.gender === "m",
  FEMALE: (s) => s.gender === "f",
  GLASSES: (s) => !!(s.traits && s.traits.glasses),
  HAT: (s) => !!(s.traits && s.traits.hat && s.traits.hat !== "none"),
  BEARD: (s) => !!(s.traits && s.traits.facialHair === "beard"),
  MUSTACHE: (s) => !!(s.traits && s.traits.facialHair === "mustache"),
  BALD: (s) => !!(s.traits && (s.traits.hairLength === "bald" || s.traits.hairStyle === "bald")),
  HAIR_BLACK: (s) => !!(s.traits && s.traits.hairColor === "black"),
  HAIR_BROWN: (s) => !!(s.traits && s.traits.hairColor === "brown"),
  HAIR_BLONDE: (s) => !!(s.traits && s.traits.hairColor === "blonde"),
  HAIR_RED: (s) => !!(s.traits && s.traits.hairColor === "red"),
  HAIR_GREY: (s) => !!(s.traits && s.traits.hairColor === "grey"),
};
const hasTrait = (s, tr) => !!s && !!TRAIT_TEST[tr] && TRAIT_TEST[tr](s);

/** The atom kinds the creator offers, by group (the clue's "people" sentence holds the trait kinds). */
export const UNARY_KINDS = ["ROOM", "ROOM_PAIR", "NOT_ROOM", "CORPSE_ROOM", "ON", "BARE", "BESIDE", "NOT_BESIDE", "DOOR", "CORNER", "NOT_CORNER",
  "SEE_CORPSE", "NO_SEE_CORPSE", "SEE_OTHER_ROOM", "ROW", "COL"];
export const RELATION_KINDS = ["NORTH_OF", "SOUTH_OF", "EAST_OF", "WEST_OF", "EXACT_OFFSET", "SAME_ROOM", "DIFF_ROOM"];
export const CROWD_KINDS = ["ALONE", "ONLY_ON", "ONLY_BESIDE"];
export const PEOPLE_KINDS = ["WITH_P", "TWO_P_ROOM", "NO_P_ROOM", "ALONE_WITH_P", "DIAG_P", "ONLY_G_ROOM"];
export const ATOM_KINDS = new Set([...UNARY_KINDS, ...RELATION_KINDS, ...CROWD_KINDS, ...PEOPLE_KINDS]);
const OFFSET = { N: [0, -1], S: [0, 1], W: [1, -1], E: [1, 1] }; // [axis, delta]: subject[axis] === other[axis] + delta
const PROP_GROUPS = { ANY_TREE: ["TREE", "OAK", "BIRCH", "PINE", "SNOW_PINE", "PALM"] };
const kindsOf = (k) => PROP_GROUPS[k] || [k];

/** The subject's own tile satisfies the position part of atom `a` (true for kinds without one). */
export function unaryHolds(g, a, t) {
  const p = a.params || {};
  switch (a.kind) {
    case "ROOM": case "ONLY_G_ROOM": return g.room[t] === g.zoneIdx(p.room);
    case "ROOM_PAIR": return g.room[t] === g.zoneIdx(p.room) || g.room[t] === g.zoneIdx(p.room2);
    case "NOT_ROOM": return g.room[t] !== g.zoneIdx(p.room);
    case "CORPSE_ROOM": return g.corpse >= 0 && g.room[t] === g.room[g.corpse];
    case "ON": case "ONLY_ON": return kindsOf(p.prop).includes(g.kind[t]);
    case "BARE": return g.kind[t] === "";
    case "BESIDE": case "ONLY_BESIDE": return kindsOf(p.prop).some((k) => g.besideKinds[t].has(k));
    case "NOT_BESIDE": return !kindsOf(p.prop).some((k) => g.besideKinds[t].has(k));
    case "DOOR": return !!g.atDoor[t];
    case "CORNER": return !!g.corner[t];
    case "NOT_CORNER": return !g.corner[t];
    case "SEE_CORPSE": return g.seesCorpse(t);
    case "NO_SEE_CORPSE": return !g.seesCorpse(t);
    case "SEE_OTHER_ROOM": return g.seesOther(t);
    case "ROW": return g.rc(t)[0] === p.index;
    case "COL": return g.rc(t)[1] === p.index;
    default: return true;
  }
}

/** Atom `a` (subject a.subject) is true when everyone stands on `pos` ({ id: tile }; "S" may be missing = S. H. Adow not counted yet). */
export function atomHolds(g, d, pos, a) {
  const x = pos[a.subject];
  if (x == null || !unaryHolds(g, a, x)) return false;
  const p = a.params || {}, sus = d.suspects || [];
  const others = sus.filter((s) => s.id !== a.subject && pos[s.id] != null);
  const mates = others.filter((s) => g.room[pos[s.id]] === g.room[x]);
  const S = pos.S;
  const sInRoom = S != null && g.room[S] === g.room[x];
  switch (a.kind) {
    case "ALONE": return !mates.length && !sInRoom;
    case "ONLY_ON": case "ONLY_BESIDE": {
      const own = (t) => unaryHolds(g, a, t);
      return others.every((s) => !own(pos[s.id])) && (S == null || !own(S));
    }
    case "NORTH_OF": case "SOUTH_OF": case "EAST_OF": case "WEST_OF": case "EXACT_OFFSET": case "SAME_ROOM": case "DIFF_ROOM": {
      const y = pos[p.other];
      if (y == null || p.other === a.subject) return false;
      return relationHolds(g, a, x, y);
    }
    case "WITH_P": return mates.some((s) => hasTrait(s, p.trait));
    case "TWO_P_ROOM": return mates.filter((s) => hasTrait(s, p.trait)).length >= 2;
    case "NO_P_ROOM": return !mates.some((s) => hasTrait(s, p.trait));
    case "ALONE_WITH_P": return mates.length === 1 && hasTrait(mates[0], p.trait) && !sInRoom;
    case "DIAG_P": return others.some((s) => hasTrait(s, p.trait) && g.diag[x].includes(pos[s.id]));
    case "ONLY_G_ROOM": { const me = sus.find((s) => s.id === a.subject); return !!me && hasTrait(me, p.trait) && !mates.some((s) => hasTrait(s, p.trait)); }
    default: return ATOM_KINDS.has(a.kind);
  }
}

/** Relation atom between the subject's tile x and the other suspect's tile y. */
function relationHolds(g, a, x, y) {
  const [xr, xc] = g.rc(x), [yr, yc] = g.rc(y), p = a.params || {};
  switch (a.kind) {
    case "NORTH_OF": return xr < yr;
    case "SOUTH_OF": return xr > yr;
    case "EAST_OF": return xc > yc;
    case "WEST_OF": return xc < yc;
    case "EXACT_OFFSET": { const o = OFFSET[p.dir]; if (!o) return false; const [ax, dl] = o; return (ax ? xc : xr) === (ax ? yc : yr) + dl; }
    case "SAME_ROOM": return g.room[x] === g.room[y];
    case "DIFF_ROOM": return g.room[x] !== g.room[y];
    default: return false;
  }
}

/** Atom `a` can still come true / is not yet broken with only some people placed (for pruning; the full check comes at the end). */
function atomAlive(g, d, pos, a) {
  const x = pos[a.subject];
  if (x == null) return true;
  const p = a.params || {}, sus = d.suspects;
  const others = sus.filter((s) => s.id !== a.subject && pos[s.id] != null);
  const mates = others.filter((s) => g.room[pos[s.id]] === g.room[x]);
  switch (a.kind) {
    case "ALONE": return !mates.length;
    case "ONLY_ON": case "ONLY_BESIDE": return others.every((s) => !unaryHolds(g, a, pos[s.id]));
    case "NORTH_OF": case "SOUTH_OF": case "EAST_OF": case "WEST_OF": case "EXACT_OFFSET": case "SAME_ROOM": case "DIFF_ROOM":
      return pos[p.other] == null || relationHolds(g, a, x, pos[p.other]);
    case "NO_P_ROOM": return !mates.some((s) => hasTrait(s, p.trait));
    case "ONLY_G_ROOM": return !mates.some((s) => hasTrait(s, p.trait));
    case "ALONE_WITH_P": return mates.length <= 1 && mates.every((s) => hasTrait(s, p.trait));
    default: return true;
  }
}

/** The open tiles nobody watches or stands on, with everyone in `pos` placed (S. H. Adow is not counted: he casts no sight). */
export function darkTiles(g, pos, ids) {
  const lit = g.bsNew();
  (ids || Object.keys(pos)).forEach((id) => { if (id !== "S" && pos[id] != null) { const cv = g.cov[pos[id]]; for (let w = 0; w < lit.length; w++) lit[w] |= cv[w]; } });
  const out = [];
  for (let t = 0; t < g.N; t++) if (g.occ[t] && !bsHas(lit, t)) out.push(t);
  return out;
}

/** Pairs of suspects in `pos` that see each other. */
export function sightConflicts(g, pos) {
  const ids = Object.keys(pos).filter((id) => id !== "S" && pos[id] != null), out = [];
  ids.forEach((a, i) => ids.slice(i + 1).forEach((b) => { if (bsHas(g.visB[pos[a]], pos[b])) out.push([a, b]); }));
  return out;
}

/* ───────────── what a suspect's clue can say ───────────── */
/**
 * Every clue part that is TRUE for suspect `id` when everyone (S. H. Adow included) stands on `pos`, and that narrows something down
 * (a position part that fits every open tile says nothing). `nounOf(kind)` orders BARE's list of floor props (English nouns).
 * → [{ kind, subject, params }]
 */
export function trueAtoms(g, d, pos, id, nounOf = (k) => k) {
  const x = pos[id];
  if (x == null) return [];
  const sus = d.suspects, ids = d.roomIds || [], me = sus.find((s) => s.id === id);
  const out = [], add = (kind, params = {}) => out.push({ kind, subject: id, params });
  const rm = g.room[x], present = new Set(g.kind.filter(Boolean));
  const roomId = ids[rm];
  add("ROOM", { room: roomId });
  ids.forEach((z, i) => {
    if (i === rm || !g.room.includes(i)) return;
    add("NOT_ROOM", { room: z });
    const [a, b] = i < rm ? [z, roomId] : [roomId, z];
    add("ROOM_PAIR", { room: a, room2: b });
  });
  if (g.corpse >= 0 && g.room[g.corpse] === rm) add("CORPSE_ROOM");
  if (g.kind[x] && g.kind[x] !== "CORPSE") { add("ON", { prop: g.kind[x] }); add("ONLY_ON", { prop: g.kind[x] }); }
  if (!g.kind[x]) {
    const lows = [...present].filter((k) => k !== "CORPSE" && k !== "VOID" && (g.cls[g.kind.indexOf(k)] === "LOW" || g.cls[g.kind.indexOf(k)] === "PERCH"));
    if (lows.length) add("BARE", { surface: d.surface || "FLOOR", lows: lows.sort((a, b) => String(nounOf(a)).localeCompare(String(nounOf(b)))) });
  }
  [...g.besideKinds[x]].sort().forEach((k) => { add("BESIDE", { prop: k }); if (k !== "CORPSE") add("ONLY_BESIDE", { prop: k }); });
  [...present].filter((k) => k !== "VOID").sort().forEach((k) => { if (!g.besideKinds[x].has(k)) add("NOT_BESIDE", { prop: k }); });
  if (g.atDoor[x]) add("DOOR");
  add(g.corner[x] ? "CORNER" : "NOT_CORNER");
  if (g.corpse >= 0) add(g.seesCorpse(x) ? "SEE_CORPSE" : "NO_SEE_CORPSE");
  if (g.seesOther(x)) add("SEE_OTHER_ROOM");
  const [xr, xc] = g.rc(x);
  add("ROW", { index: xr }); add("COL", { index: xc });
  add("ALONE");
  sus.forEach((s) => {
    if (s.id === id || pos[s.id] == null) return;
    const [yr, yc] = g.rc(pos[s.id]);
    if (xr < yr) add("NORTH_OF", { other: s.id });
    if (xr > yr) add("SOUTH_OF", { other: s.id });
    if (xc > yc) add("EAST_OF", { other: s.id });
    if (xc < yc) add("WEST_OF", { other: s.id });
    Object.entries(OFFSET).forEach(([dir, [ax, dl]]) => { if ((ax ? xc : xr) === (ax ? yc : yr) + dl) add("EXACT_OFFSET", { other: s.id, dir, dist: 1 }); });
    add(g.room[pos[s.id]] === rm ? "SAME_ROOM" : "DIFF_ROOM", { other: s.id });
  });
  Object.keys(TRAIT_TEST).forEach((tr) => {
    if (!sus.some((s) => s.id !== id && hasTrait(s, tr))) return; // nobody else has it: the clue would talk about no one
    const selfMatch = hasTrait(me, tr);
    ["WITH_P", "TWO_P_ROOM", "NO_P_ROOM", "ALONE_WITH_P", "DIAG_P"].forEach((k) => add(k, { trait: tr, selfMatch }));
  });
  if (me && (me.gender === "m" || me.gender === "f")) add("ONLY_G_ROOM", { trait: me.gender === "m" ? "MALE" : "FEMALE", room: roomId });
  const all = { ...pos };
  return out.filter((a) => atomHolds(g, d, all, a) && (!UNARY_KINDS.includes(a.kind) || !everywhere(g, a)));
}
const everywhere = (g, a) => { for (let t = 0; t < g.N; t++) if (g.occ[t] && !unaryHolds(g, a, t)) return false; return true; };

/** Two parts that should not share one clue (engine `compatible`): the same thing twice, or one that gives the other away. */
const CLASH = [["ROOM", "NOT_ROOM"], ["ROOM", "CORPSE_ROOM"], ["ON", "ONLY_ON"], ["ROW", "COL"], ["NOT_ROOM", "CORPSE_ROOM"], ["ONLY_G_ROOM", "ROOM"],
  ["ONLY_G_ROOM", "NOT_ROOM"], ["ONLY_G_ROOM", "CORPSE_ROOM"], ["ONLY_G_ROOM", "ALONE"], ["ROOM_PAIR", "ROOM"], ["ROOM_PAIR", "NOT_ROOM"],
  ["ROOM_PAIR", "CORPSE_ROOM"], ["ROOM_PAIR", "ONLY_G_ROOM"], ["BESIDE", "ONLY_BESIDE"], ["CORNER", "NOT_CORNER"], ["SEE_CORPSE", "NO_SEE_CORPSE"]];
export const atomKey = (a) => `${a.kind}:${JSON.stringify(a.params || {})}`;
export function clashes(atoms, a) {
  if (atoms.some((b) => atomKey(b) === atomKey(a))) return true;
  return atoms.some((b) => CLASH.some(([p, q]) => (p === a.kind && q === b.kind) || (q === a.kind && p === b.kind)) || (b.kind === a.kind && ["ROW", "COL", "ROOM_PAIR", "NOT_ROOM", "ROOM"].includes(a.kind)));
}
/** clueTokens for a suspect's atoms: the trait parts make the clue's second sentence ("She was alone with a man."). */
export const clueTokensOf = (id, atoms) => ({
  subject: id,
  place: atoms.map((a, i) => (PEOPLE_KINDS.includes(a.kind) ? -1 : i)).filter((i) => i >= 0),
  people: atoms.map((a, i) => (PEOPLE_KINDS.includes(a.kind) ? i : -1)).filter((i) => i >= 0),
});

/* ───────────── the solver ───────────── */
function prepare(d) {
  const g = geometry(d), sus = d.suspects || [];
  const atoms = sus.flatMap((s) => (s.atoms || []).map((a) => ({ ...a, subject: s.id })));
  const dom = sus.map((s) => {
    const own = atoms.filter((a) => a.subject === s.id);
    const b = g.bsNew();
    for (let t = 0; t < g.N; t++) if (g.occ[t] && own.every((a) => unaryHolds(g, a, t))) bsSet(b, t);
    return b;
  });
  return { g, sus, atoms, dom };
}

/** Every tile each suspect's own clue allows, before anyone is placed: { id: count }. */
export function fits(d) {
  const { sus, dom } = prepare(d);
  return Object.fromEntries(sus.map((s, i) => [s.id, bsCount(dom[i])]));
}

/**
 * Solutions of the case under the laws (no mutual sight, exactly one dark tile for S. H. Adow, every clue true).
 * → { solutions: [{ id: tile, …, S: tile }], exhausted, nodes }. `exhausted` false = the node budget ran out first (the case is too open to tell).
 * solveSteps is the same search as a generator that yields every few hundred nodes (the creator runs it in time slices: runSteps).
 */
export function* solveSteps(d, { limit = 2, budget = 250000 } = {}) {
  const { g, sus, atoms, dom } = prepare(d), K = sus.length;
  const solutions = [];
  if (!K) return { solutions, exhausted: true, nodes: 0 };
  // the clue parts that depend on more than the suspect's own tile, per suspect they involve (own-tile parts are in the domains)
  const touches = sus.map((s) => atoms.filter((a) => !UNARY_KINDS.includes(a.kind)
    && (a.subject === s.id || (a.params && a.params.other === s.id) || PEOPLE_KINDS.includes(a.kind) || CROWD_KINDS.includes(a.kind))));
  const pos = {}, placed = new Uint8Array(K);
  const lit = g.bsNew(); // watched or occupied tiles
  let nodes = 0, stop = false;

  const candidates = (i) => {
    const out = [], b = dom[i], id = sus[i].id, tc = touches[i];
    for (let w = 0; w < b.length; w++) {
      let x = b[w] & ~lit[w];
      while (x) {
        const low = x & -x, t = w * 32 + 31 - Math.clz32(low);
        x ^= low;
        if (tc.length) { pos[id] = t; const ok = tc.every((a) => atomAlive(g, d, pos, a)); delete pos[id]; if (!ok) continue; }
        out.push(t);
      }
    }
    return out;
  };
  function* rec() {
    if (stop) return;
    if (++nodes > budget) { stop = true; return; }
    if ((nodes & 255) === 0) yield;
    // the dark tiles left can only shrink: none left means nowhere for S. H. Adow
    const dark = g.bsNew();
    let darkN = 0;
    for (let w = 0; w < dark.length; w++) { dark[w] = g.occB[w] & ~lit[w]; darkN += pop32(dark[w]); }
    let best = -1, bestC = null;
    const open = [];
    for (let i = 0; i < K; i++) if (!placed[i]) {
      const c = candidates(i);
      if (!c.length) return;
      open.push(c);
      if (!bestC || c.length < bestC.length) { best = i; bestC = c; }
    }
    if (best < 0) { // everyone is placed
      if (darkN !== 1) return;
      const S = bsList(dark)[0], full = { ...pos, S };
      if (atoms.every((a) => atomHolds(g, d, full, a))) { solutions.push(full); if (solutions.length >= limit) stop = true; }
      return;
    }
    if (darkN < 1) return;
    // can the suspects still to place cover all the dark tiles but one? each covers at most its best tile's share
    let reach = 0;
    for (const c of open) { let m = 0; for (const t of c) { const n = bsAndCount(g.cov[t], dark); if (n > m) m = n; } reach += m; }
    if (reach < darkN - 1) return;
    const id = sus[best].id;
    for (const t of bestC) {
      pos[id] = t; placed[best] = 1;
      const save = lit.slice();
      const cv = g.cov[t];
      for (let w = 0; w < lit.length; w++) lit[w] |= cv[w];
      yield* rec();
      lit.set(save);
      placed[best] = 0; delete pos[id];
      if (stop) return;
    }
  }
  yield* rec();
  return { solutions, exhausted: !stop || solutions.length >= limit, nodes };
}
/** Runs a step generator to the end (the backend, tests). */
export const finish = (gen) => { for (;;) { const r = gen.next(); if (r.done) return r.value; } };
export const solve = (d, opts) => finish(solveSteps(d, opts));
/** Runs a step generator in slices of `sliceMs` on timers, then calls done(result) (unless cancel() was called first). → cancel */
export function runSteps(gen, done, sliceMs = 24) {
  let dead = false, timer = null;
  const tick = () => {
    const end = Date.now() + sliceMs;
    try {
      while (Date.now() < end) { const r = gen.next(); if (r.done) { if (!dead) done(r.value); return; } }
    } catch (e) { if (!dead) done({ error: String(e && e.message || e) }); return; }
    if (!dead) timer = setTimeout(tick, 0);
  };
  timer = setTimeout(tick, 0);
  return () => { dead = true; if (timer) clearTimeout(timer); };
}

/* ───────────── the grader: how a person would get there ───────────── */
/**
 * Plays the case with growing tools and reports the first that finishes it:
 *   1  placements, sightline eliminations, ray blocks (a tile every spot of X would watch is closed to everyone else) and what
 *      each clue says about the others (pairs, "alone", "the only person")                                          → Very Easy / Easy
 *   2  + the blindspot law: S. H. Adow needs a tile nobody watches, so nobody may stand where no such tile would be left,
 *      and once his tile is known, every other tile must be watched                                                 → Medium
 *   3  + one-step trials ("if X stood here, someone would have no tile left")                                  → Hard (up to 40) / Expert (more)
 * → { difficulty, tier, trials } or null on a contradiction (the case has no solution). An estimate: the engine's own grader has more rules.
 */
export function* gradeSteps(d) {
  const { g, sus, atoms, dom } = prepare(d), K = sus.length;
  if (!K) return null;
  const ids = sus.map((x) => x.id);
  const own = sus.map((x) => atoms.filter((a) => a.subject === x.id || (a.params && a.params.other === x.id) || PEOPLE_KINDS.includes(a.kind) || CROWD_KINDS.includes(a.kind)));
  const pairs = sus.map((x) => atoms.filter((a) => RELATION_KINDS.includes(a.kind) && (a.subject === x.id || a.params.other === x.id))
    .map((a) => ({ a, mine: a.subject === x.id, j: ids.indexOf(a.subject === x.id ? a.params.other : a.subject) })));
  const W = g.W, drop = (b, t) => { b[t >>> 5] &= ~(1 << (t & 31)); };
  const clone = (s) => ({ cand: s.cand.map((b) => b.slice()), pos: { ...s.pos } });

  /** → false on a contradiction. Mutates s. */
  const propagate = (s, tier) => {
    for (let guard = 0; guard < 300; guard++) {
      let changed = false;
      const placed = ids.filter((id) => s.pos[id] != null), open = [];
      for (let i = 0; i < K; i++) if (s.pos[ids[i]] == null) open.push(i);
      const lit = g.bsNew();
      placed.forEach((id) => { const cv = g.cov[s.pos[id]]; for (let w = 0; w < W; w++) lit[w] |= cv[w]; });
      for (const i of open) {
        const c = s.cand[i];
        for (let w = 0; w < W; w++) { const nv = c[w] & ~lit[w]; if (nv !== c[w]) { c[w] = nv; changed = true; } } // seen or taken
        for (const t of bsList(c)) {
          const trial = { ...s.pos, [ids[i]]: t };
          const bad = own[i].some((a) => !atomAlive(g, d, trial, a))
            || pairs[i].some(({ a, mine, j }) => j < 0 || (s.pos[ids[j]] == null
              && !bsList(s.cand[j]).some((u) => u !== t && !bsHas(g.visB[t], u) && (mine ? relationHolds(g, a, t, u) : relationHolds(g, a, u, t)))));
          if (bad) { drop(c, t); changed = true; }
        }
      }
      // ray block: whatever every spot of X would watch, nobody else can stand on
      for (const i of open) {
        const list = bsList(s.cand[i]);
        if (!list.length) return false;
        const common = g.cov[list[0]].slice();
        for (const t of list) { const cv = g.cov[t]; for (let w = 0; w < W; w++) common[w] &= cv[w]; }
        for (const j of open) if (j !== i) { const c = s.cand[j]; for (let w = 0; w < W; w++) { const nv = c[w] & ~common[w]; if (nv !== c[w]) { c[w] = nv; changed = true; } } }
      }
      for (const i of open) {
        const n = bsCount(s.cand[i]);
        if (!n) return false;
        if (n === 1) { s.pos[ids[i]] = bsList(s.cand[i])[0]; changed = true; }
      }
      if (changed) continue;
      // nothing new: the laws on what is placed
      for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) if (bsHas(g.visB[s.pos[placed[a]]], s.pos[placed[b]])) return false;
      const dark = [];
      for (let t = 0; t < g.N; t++) if (g.occ[t] && !bsHas(lit, t)) dark.push(t);
      if (!dark.length) return false;
      if (!open.length) {
        if (dark.length !== 1) return false;
        return atoms.every((a) => atomHolds(g, d, { ...s.pos, S: dark[0] }, a));
      }
      if (tier < 2) return true;
      // the blindspot law
      const reach = g.bsNew();
      open.forEach((i) => bsList(s.cand[i]).forEach((t) => { const cv = g.cov[t]; for (let w = 0; w < W; w++) reach[w] |= cv[w]; }));
      const forever = dark.filter((t) => !bsHas(reach, t)); // nobody left can watch it: it stays dark
      if (forever.length > 1) return false;
      if (forever.length === 1) {
        const S = forever[0];
        for (const i of open) for (const u of bsList(s.cand[i])) if (bsHas(g.cov[u], S)) { drop(s.cand[i], u); changed = true; } // nobody may watch his tile
        for (const t of dark) { // every other dark tile must be watched: a tile only one suspect can watch pins them
          if (t === S) continue;
          const who = open.filter((i) => bsList(s.cand[i]).some((u) => bsHas(g.cov[u], t)));
          if (!who.length) return false;
          if (who.length === 1) for (const u of bsList(s.cand[who[0]])) if (!bsHas(g.cov[u], t)) { drop(s.cand[who[0]], u); changed = true; }
        }
      } else {
        // someone must watch it: a tile closed to S. H. Adow (an "only person" prop, the zone of a pinned ALONE) is watched from
        // one of the few tiles that see it, so whatever all of those watch is out for everyone else
        const closed = new Set();
        atoms.forEach((a) => {
          if (a.kind === "ONLY_ON" || a.kind === "ONLY_BESIDE") { for (let t = 0; t < g.N; t++) if (g.occ[t] && unaryHolds(g, a, t)) closed.add(t); }
          else if (a.kind === "ALONE" || a.kind === "ALONE_WITH_P") {
            const i = ids.indexOf(a.subject), at = s.pos[a.subject];
            const zones = new Set(at != null ? [g.room[at]] : bsList(s.cand[i]).map((t) => g.room[t]));
            if (zones.size === 1) { const z = [...zones][0]; for (let t = 0; t < g.N; t++) if (g.occ[t] && g.room[t] === z) closed.add(t); }
          }
        });
        for (const t of dark) {
          if (!closed.has(t)) continue;
          const watchers = [];
          open.forEach((i) => bsList(s.cand[i]).forEach((u) => { if (bsHas(g.cov[u], t)) watchers.push([i, u]); }));
          if (!watchers.length) return false;
          const common = g.cov[watchers[0][1]].slice();
          watchers.forEach(([, u]) => { const cv = g.cov[u]; for (let w = 0; w < W; w++) common[w] &= cv[w]; });
          watchers.forEach(([, u]) => drop(common, u));
          for (const i of open) { const c = s.cand[i]; for (let w = 0; w < W; w++) { const nv = c[w] & ~common[w]; if (nv !== c[w]) { c[w] = nv; changed = true; } } }
          const owners = new Set(watchers.map(([i]) => i));
          if (owners.size === 1) { const i = watchers[0][0], keep = new Set(watchers.map(([, u]) => u)); for (const u of bsList(s.cand[i])) if (!keep.has(u)) { drop(s.cand[i], u); changed = true; } }
        }
        if (changed) continue;
        // nobody may stand where they would watch every tile still able to stay dark
        const sure = lit.slice();
        for (const i of open) {
          const list = bsList(s.cand[i]), common = g.cov[list[0]].slice();
          for (const t of list) { const cv = g.cov[t]; for (let w = 0; w < W; w++) common[w] &= cv[w]; }
          for (let w = 0; w < W; w++) sure[w] |= common[w];
        }
        const able = dark.filter((t) => !bsHas(sure, t));
        if (!able.length) return false;
        for (const i of open) for (const u of bsList(s.cand[i])) if (able.every((t) => bsHas(g.cov[u], t))) { drop(s.cand[i], u); changed = true; }
      }
      if (!changed) return true;
    }
    return true;
  };
  const done = (s) => ids.every((id) => s.pos[id] != null);

  const start = { cand: dom.map((b) => b.slice()), pos: {} };
  for (const tier of [1, 2]) {
    const s = clone(start);
    if (!propagate(s, tier)) return null;
    if (done(s)) return { tier, trials: 0, difficulty: tier === 1 ? (K <= 5 && g.R <= 6 ? "Very Easy" : "Easy") : "Medium" };
  }
  // tier 3: one-step trials, as long as they remove something
  const s = clone(start);
  propagate(s, 2);
  let trials = 0;
  for (let round = 0; round < 30 && !done(s); round++) {
    let progress = false;
    for (let i = 0; i < K; i++) {
      if (s.pos[ids[i]] != null) continue;
      for (const t of bsList(s.cand[i])) {
        if (!bsHas(s.cand[i], t)) continue;
        const tr = clone(s);
        tr.pos[ids[i]] = t;
        tr.cand[i] = g.bsNew(); bsSet(tr.cand[i], t);
        const dead = !propagate(tr, 2);
        yield;
        if (dead) { drop(s.cand[i], t); trials++; progress = true; if (!propagate(s, 2)) return null; if (s.pos[ids[i]] != null) break; }
      }
      if (done(s)) break;
    }
    if (!progress) break;
  }
  if (!done(s)) return { tier: 4, trials, difficulty: "Expert" };
  return { tier: 3, trials, difficulty: trials <= 40 ? "Hard" : "Expert" };
}
export const grade = (d) => finish(gradeSteps(d));

/* ───────────── the backend's check ───────────── */
const isInt = (n) => Number.isInteger(n);
const cellOk = (d, x) => Array.isArray(x) && x.length === 2 && isInt(x[0]) && isInt(x[1]) && x[0] >= 0 && x[1] >= 0 && x[0] < d.rooms.length && x[1] < d.rooms[0].length;
const ID_RE = /^[A-Z][A-Z0-9_]{0,31}$/;
const PARAM_RULES = {
  room: (v, d) => (d.roomIds || []).includes(v), room2: (v, d) => (d.roomIds || []).includes(v),
  prop: (v, d) => v === "CORPSE" || v === "ANY_TREE" || !!(d.propClasses && d.propClasses[v]),
  other: (v, d) => (d.suspects || []).some((s) => s.id === v),
  index: (v, d) => isInt(v) && v >= 0 && v < Math.max(d.rooms.length, d.rooms[0].length),
  dir: (v) => Object.prototype.hasOwnProperty.call(OFFSET, v), dist: (v) => v === 1,
  trait: (v) => Object.prototype.hasOwnProperty.call(TRAIT_TEST, v), selfMatch: (v) => typeof v === "boolean",
  surface: (v) => /^[A-Z]{1,16}$/.test(v), lows: (v, d) => Array.isArray(v) && v.length <= 40 && v.every((k) => !!(d.propClasses && d.propClasses[k])),
};

/** The zone numbers of `rooms` whose tiles do not all touch (a zone must be one piece). */
export function splitZones(rooms) {
  const R = rooms.length, C = rooms[0].length, out = [];
  [...new Set(rooms.flat())].forEach((z) => {
    const cells = [];
    rooms.forEach((row, r) => row.forEach((v, c) => { if (v === z) cells.push([r, c]); }));
    const stack = [cells[0]], got = new Set([`${cells[0][0]},${cells[0][1]}`]);
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [dr, dc] of DIRS) { const r1 = r + dr, c1 = c + dc, k = `${r1},${c1}`; if (r1 >= 0 && c1 >= 0 && r1 < R && c1 < C && rooms[r1][c1] === z && !got.has(k)) { got.add(k); stack.push([r1, c1]); } }
    }
    if (got.size !== cells.length) out.push(z);
  });
  return out;
}

/** → a list of problems (English, for logs and the API's error); [] when the case is sound. Does not prove uniqueness (see solve). */
export function checkCase(d) {
  const bad = [];
  if (!d || typeof d !== "object") return ["not an object"];
  const R = Array.isArray(d.rooms) ? d.rooms.length : 0, C = R && Array.isArray(d.rooms[0]) ? d.rooms[0].length : 0;
  if (!SIZES.includes(R) || R !== C) return ["the board must be square, 5×5 to 10×10"];
  if (!d.rooms.every((row) => Array.isArray(row) && row.length === C && row.every((z) => isInt(z) && z >= 0 && z < (d.roomIds || []).length))) return ["bad zone grid"];
  if (!Array.isArray(d.roomIds) || d.roomIds.length > 16 || !d.roomIds.every((z) => typeof z === "string" && ID_RE.test(z))) return ["bad zone ids"];
  if (!Array.isArray(d.roomNames) || d.roomNames.length !== d.roomIds.length || !d.roomNames.every((n) => typeof n === "string" && n.length <= 30)) return ["bad zone names"];
  if (!THEMES.includes(d.theme)) bad.push("unknown theme");
  if (typeof d.title !== "string" || !d.title.trim() || d.title.length > 60) bad.push("the title must be 1–60 characters");
  else if (hasBadWords(d.title)) bad.push("the title has a word that is not allowed");
  if (!Array.isArray(d.contents) || d.contents.length !== R || !d.contents.every((row) => Array.isArray(row) && row.length === C && row.every((k) => k === "" || (typeof k === "string" && ID_RE.test(k))))) return [...bad, "bad contents"];
  const pc = d.propClasses || {};
  if (typeof pc !== "object" || Object.entries(pc).some(([k, v]) => !ID_RE.test(k) || !PROP_CLASS_IDS.includes(v))) bad.push("bad prop classes");
  let corpses = 0;
  d.contents.forEach((row) => row.forEach((k) => { if (k === "CORPSE") corpses++; else if (k && !pc[k]) bad.push(`no class for ${k}`); }));
  if (corpses !== 1 || !cellOk(d, d.corpse) || d.contents[d.corpse[0]][d.corpse[1]] !== "CORPSE") bad.push("the board needs exactly one Corpse");
  if (!Array.isArray(d.doors) || d.doors.length > 200) return [...bad, "bad doors"];
  for (const dr of d.doors) {
    if (!Array.isArray(dr) || dr.length !== 2 || !cellOk(d, dr[0]) || !cellOk(d, dr[1])) return [...bad, "bad door"];
    const [[r1, c1], [r2, c2]] = dr;
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1 || d.rooms[r1][c1] === d.rooms[r2][c2]) return [...bad, "a door must join two neighbouring zones"];
  }
  splitZones(d.rooms).forEach((z) => bad.push(`the ${d.roomNames[z]} is in two pieces`));
  const sus = d.suspects;
  if (!Array.isArray(sus) || sus.length < MIN_SUSPECTS || sus.length > MAX_SUSPECTS) return [...bad, `${MIN_SUSPECTS}–${MAX_SUSPECTS} scapegoats`];
  const ids = new Set();
  for (const s of sus) {
    if (!s || !LETTERS.includes(s.id) || ids.has(s.id)) return [...bad, "bad scapegoat letters"];
    ids.add(s.id);
    if (typeof s.name !== "string" || !s.name || s.name.length > 24 || s.name[0].toUpperCase() !== s.id) bad.push(`bad name for ${s.id}`);
    if (s.gender !== "m" && s.gender !== "f") bad.push(`bad gender for ${s.id}`);
    if (!cellOk(d, s.solution)) return [...bad, `no tile for ${s.id}`];
    if (!Array.isArray(s.atoms) || s.atoms.length < 1 || s.atoms.length > MAX_ATOMS) bad.push(`${s.name} needs 1–${MAX_ATOMS} clue parts`);
    (s.atoms || []).forEach((a) => {
      if (!a || !ATOM_KINDS.has(a.kind) || a.subject !== s.id || typeof a.params !== "object" || !a.params) { bad.push(`bad clue part for ${s.id}`); return; }
      Object.entries(a.params).forEach(([k, v]) => { if (!PARAM_RULES[k] || !PARAM_RULES[k](v, d)) bad.push(`bad ${k} in ${s.id}'s clue`); });
    });
  }
  if (!cellOk(d, d.shadow)) return [...bad, "no tile for S. H. Adow"];
  if (bad.length) return bad;
  // the laws, on the stored solution
  const g = geometry(d), pos = {};
  for (const s of sus) {
    const t = g.at(...s.solution);
    if (!g.occ[t]) bad.push(`${s.name} stands where nobody can stand`);
    if (Object.values(pos).includes(t)) bad.push(`two scapegoats share ${s.solution}`);
    pos[s.id] = t;
  }
  if (sightConflicts(g, pos).length) bad.push("two scapegoats see each other");
  const dark = darkTiles(g, pos);
  if (dark.length !== 1 || dark[0] !== g.at(...d.shadow)) bad.push("S. H. Adow's tile must be the only dark tile");
  const full = { ...pos, S: g.at(...d.shadow) };
  sus.forEach((s) => (s.atoms || []).forEach((a) => { if (!atomHolds(g, d, full, a)) bad.push(`a clue of ${s.name} is false`); }));
  return bad;
}
