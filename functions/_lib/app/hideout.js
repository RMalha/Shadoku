/**
 * The hideout (architecture 4.14; the author's rules: app/docs/product_brief.md "Hideout and cosmetics", 2026-11-16, and of
 * 2026-11-25). A hideout is one or more ROOMS, each a square board like a contract's that the player decorates with props they
 * own. Room 1 is everyone's from the start: 4 x 4, growing one step at a time up to 10 x 10, each step bought with coins at the
 * server's price (table hideout_sizes). Once the NEWEST room is 8 x 8 or more (hideout_settings room_from_size), another room
 * can be bought (room_price, 1000), up to max_rooms (10) in all; a new room starts again at 4 x 4 and grows at the same prices,
 * each room's steps paid once. Guests have a hideout too (private until they sign in). Layouts are kept here and "the server
 * copy wins" (architecture 3.1): a save names the version of that room it was made from and is refused when another save of
 * the room came first.
 *
 * LAYOUT FORMAT (one room's; what the app sends in PUT /api/app/hideout and gets back from GET): a JSON array of placements
 *   { item, x, y, shape?, rot?, tier? }
 *   item   a prop id of functions/_lib/app/hideout_props.js (the board's own ids: "BED", "BARREL", "CARPET_RUNNER" ...)
 *   x, y   integers, 0-based: column and row of the top-left corner of the shape's bounding box; (0, 0) is the room's
 *          top-left tile, x grows to the right and y downwards
 *   shape  which footprint: the `key` of one of the item's shapes in hideout_props.js (its rows top to bottom, "/" between
 *          rows, 1 = a covered tile: "1" one tile, "11" two in a row, "1/1" two in a column, "111/100/100" an L of five).
 *          May be left out when the item has a single shape. The shapes are the spans the puzzle boards draw the prop across
 *          (engine/shadoku_catalog.py), so every orientation is its own shape: a bed along a row is "11", down a column "1/1"
 *   rot    0..3 (default 0): which way the prop faces, for the app to draw. It does NOT turn the footprint (the shapes above
 *          already list every orientation the art has); the server only keeps it
 *   tier   0..4 (default 0): the card's variant, 0 the card itself, 1 Bronze, 2 Silver, 3 Gold, 4 Shadow (economy.js VARIANTS)
 * Stored and returned with every field filled in ({item, x, y, shape, rot, tier}), in the order sent; at most 16 KB a room.
 *
 * WHAT A SAVE MUST HOLD (else 400/409 with a code, nothing saved):
 *   - every tile a placement covers is in the room (size x size); no two placements share a tile;
 *   - the starting set (CHAIR, STOOL, DESK, TRASH_BAG, CRATE, BED, WARDROBE) is owned from the start and placed as often as the
 *     player likes, always as tier 0 (it never comes as a card, so it has no variants);
 *   - anything else is placed, in ALL the rooms together, at most as many times as the account holds it IN THAT TIER
 *     (inventory rows (item, tier)): a Bronze BARREL and a plain BARREL are different things to place, because the hideout
 *     shows the variant (a tone and a rim glow: app/docs/art-plan/README.md) and a merge turns three plain ones into one Bronze.
 *     The other rooms count as stored, up to what is held: a save never takes a prop away from another room. The database
 *     checks the holdings again inside the batch that saves, so a merge or a save of another room racing it cannot slip in.
 * Cards can still leave after a save (three merged into a variant): GET then leaves out the placements past what is held,
 * going through the rooms in order and the last placements first, and lists them in `removed`; nothing is written by GET.
 *
 * GROWING: growStatements() is the one way a room's size changes, so another source (an achievement) can call it with its own
 * guard instead of a price. With coins: one batch writes the debit (ledger.js post, reason "hideout", ref "room:<n>:size:<s>":
 * each step of each room is paid once per account, ever, which is also what makes a double tap harmless) and the new size
 * only if that debit was written. A new room: the same, ref "room:<n>", and the room's row is made only if the debit was written.
 *
 * ONE BOARD (the author, 2026-11-25; migrations/0007). All the rooms sit on one board, connected:
 *   x, y   board coordinates of a room's top-left tile (x to the right, y downwards). Room 1 is at (0, 0). A room's tiles are
 *          (x .. x + size - 1, y .. y + size - 1); every tile of every room stays in BOARD_MIN..BOARD_MAX (-64..64).
 *   grow   the corner the room grows toward (GROW_DIRS): "se" right and down (room 1, and every room before 0007), "sw" left
 *          and down, "ne" right and up, "nw" left and up. A step keeps the opposite corner: x goes down by 1 for sw / nw,
 *          y for ne / nw, and the room's layout and edges shift by the same step in room coordinates, so nothing moves on the
 *          board (growStatements; the version goes up, since a copy from before has the old coordinates). A room moves only
 *          that way (trigger hideout_room_stays_put).
 *   A bought room (4 x 4) goes where the player puts it, on any side: on the board, overlapping no room and sharing at least
 *   one full tile edge with one (L shapes and offsets are fine), with its growing square free: room_from_size (8) x 8 from
 *   the room toward its corner must be on the board and overlap no room (409 no_room_to_grow { need }; the author,
 *   2026-11-25: the next room is sold once the NEWEST room is 8 x 8, so a new room must be able to get there). The corner is
 *   the player's, or the first of se, sw, ne, nw that is free. While the newest room is under 8 x 8, no other room may grow
 *   into its growing square. A room grows only if its new row and column stay on the board, overlap no other room and keep
 *   out of that square (409 no_space).
 *   name   "" (the app shows "Room N") or at most NAME_MAX (24) characters, trimmed, no control characters, and nothing the
 *          Codename word filter blocks (functions/_lib/codename: 400 bad_name { reason: "blocked" }; its "reserved" is allowed here)
 *   floor  one of FLOORS: the board's floor patterns (src/ShadokuArt.jsx FLOORS, drawn by FloorDefs as `skf-<id>`); "parquet"
 *          by default (the app's floor until now). "water" is left out: nobody stands on it.
 *
 * EDGE FORMAT (one room's walls, windows and doors; free for now, no item needed): a JSON array of
 *   { x, y, side, kind }
 *   side   "left" or "top": the left side or the top side of the room's tile (x, y), in the room's own coordinates (like a
 *          layout's). The room's right edge is the "left" side of x = size, its bottom edge the "top" side of y = size:
 *            side "left": 0 <= x <= size, 0 <= y < size        side "top": 0 <= x < size, 0 <= y <= size
 *   kind   "wall", "window" or "door"
 * No edge twice; stored sorted (side, y, x) with every field, at most 16 KB a room. Inner edges are the room's own. An edge
 * on the line between two rooms (a SHARED edge) is kept by the NEWER room (the higher number): the older room's save may not
 * name it (400 edge_shared), and GET leaves out of the older room whatever it had stored there before the newer room came.
 * Two rooms are connected by a door on a shared edge, and every room must stay reachable from room 1 through such doors
 * (400 disconnected). A room bought gets one door in the middle of the longest edge it shares with a room (the lowest room
 * number on a tie); what the older rooms had on the edges it now shares is copied into it (the door wins its own edge).
 * Growing never takes a shared edge away (a room cannot grow into another), so it never disconnects a room.
 */
import { HIDEOUT_PROPS } from "./hideout_props.js";
import { post, when, wrote, newOp, lineFor } from "./ledger.js";
import { snapshot } from "./context.js";
import { CLIENT_ID_RE, dayKey, intIn, MAX_TIER } from "./economy.js";
import { achievementStatements, unlocksOf } from "./achievements.js";
import { codenameIssue } from "../codename/index.js";

export const HIDEOUT_START = 4;
export const HIDEOUT_MAX = 10;
export const LAYOUT_MAX_BYTES = 16384;
/** hideout_settings as the code knows them when a row is missing (migrations/0005 seeds the same). */
export const HIDEOUT_SETTINGS = Object.freeze({ room_price: 1000, room_from_size: 8, max_rooms: 10 });
/** The starting set: owned from the start, unlimited, never sold, never in packs (the author, 2026-11-16). */
export const STARTERS = Object.freeze([...HIDEOUT_PROPS.starters]);
const STARTER = new Set(STARTERS);
const PROPS = HIDEOUT_PROPS.props;

/** The board (migrations/0007): bounds of a room's top-left, the names, the floors, the edges. */
export const BOARD_MIN = -64;
export const BOARD_MAX = 64;
export const NAME_MAX = 24;
/** The board's floor patterns (src/ShadokuArt.jsx FLOORS; a test keeps the two lists equal). */
export const FLOORS = Object.freeze(["parquet", "checker", "marble", "carpet", "stone", "slate", "terracotta", "grass", "dirt", "sand", "boardwalk", "snow", "canyon", "salt", "asphalt", "cobble", "marsh"]);
export const FLOOR_DEFAULT = "parquet";
export const EDGE_KINDS = Object.freeze(["wall", "window", "door"]);
export const EDGE_SIDES = Object.freeze(["left", "top"]);
export const EDGES_MAX_BYTES = 16384;
/** The corners a room grows toward: se right and down (room 1, and every room before 0007), sw left and down, ne right and up, nw left and up. */
export const GROW_DIRS = Object.freeze(["se", "sw", "ne", "nw"]);

let tableSeen = false; // once per isolate, remembered only once migrations 0005 and 0007 are there
async function ready(d) {
  if (tableSeen) return true;
  const row = await d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('hideouts', 'hideout_rooms', 'hideout_sizes', 'hideout_settings')").first();
  if (!row || row.n !== 4) return false;
  try { await d.prepare("SELECT x, y, grow, name, floor, edges FROM hideout_rooms LIMIT 0").all(); } catch { return false; } // 0007 not applied
  tableSeen = true;
  return tableSeen;
}
const schema = () => ({ status: 503, body: { error: "schema" } });
const bad = (error, extra = {}, status = 400) => ({ status, body: { error, ...extra } });

/**
 * A layout as sent → { placements (normalised), need: Map "item|tier" → count of non-starters } or { error, ...where }.
 * `size`: the board's side. Pure: no storage.
 */
export function checkLayout(layout, size) {
  if (!Array.isArray(layout)) return { error: "format" };
  if (layout.length > size * size) return { error: "too_many" };
  const taken = new Map(), placements = [], need = new Map();
  for (let i = 0; i < layout.length; i++) {
    const p = layout[i];
    if (!p || typeof p !== "object" || Array.isArray(p)) return { error: "format", index: i };
    const item = typeof p.item === "string" ? p.item : "";
    const prop = Object.hasOwn(PROPS, item) ? PROPS[item] : null;
    if (!prop) return { error: "unknown_item", index: i, item: String(p.item).slice(0, 64) };
    const x = intIn(p.x, 0, HIDEOUT_MAX - 1), y = intIn(p.y, 0, HIDEOUT_MAX - 1);
    const rot = p.rot === undefined ? 0 : intIn(p.rot, 0, 3), tier = p.tier === undefined ? 0 : intIn(p.tier, 0, MAX_TIER);
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || rot === null || tier === null) return { error: "format", index: i };
    if (x === null || y === null) return { error: "out_of_bounds", index: i };
    if (STARTER.has(item) && tier !== 0) return { error: "bad_tier", index: i, item };
    const shape = p.shape === undefined && prop.shapes.length === 1 ? prop.shapes[0] : prop.shapes.find((s) => s.key === p.shape);
    if (!shape) return { error: "bad_shape", index: i, item, shapes: prop.shapes.map((s) => s.key) };
    for (const [dx, dy] of shape.cells) {
      const cx = x + dx, cy = y + dy;
      if (cx >= size || cy >= size) return { error: "out_of_bounds", index: i };
      const tile = cy * HIDEOUT_MAX + cx;
      if (taken.has(tile)) return { error: "overlap", index: i, with: taken.get(tile), x: cx, y: cy };
      taken.set(tile, i);
    }
    placements.push({ item, x, y, shape: shape.key, rot, tier });
    if (!STARTER.has(item)) need.set(`${item}|${tier}`, (need.get(`${item}|${tier}`) || 0) + 1);
  }
  return { placements, need };
}

/* ───────────── the board: rooms as rectangles, their shared edges, the doors between them ───────────── */

/** Do two rooms ({x, y, size}) share a tile? */
/** The room `r` ({x, y, size, grow}) grown to `to` x `to` toward its corner (or the square of that side it may grow into). */
export const grownRect = (r, to) => ({
  x: r.grow === "sw" || r.grow === "nw" ? r.x + r.size - to : r.x,
  y: r.grow === "ne" || r.grow === "nw" ? r.y + r.size - to : r.y,
  size: to,
});
/** Is every tile of a room ({x, y, size}) on the board (BOARD_MIN..BOARD_MAX)? */
export const onBoard = (r) => r.x >= BOARD_MIN && r.y >= BOARD_MIN && r.x + r.size - 1 <= BOARD_MAX && r.y + r.size - 1 <= BOARD_MAX;
export const overlaps = (a, b) => a.x < b.x + b.size && b.x < a.x + a.size && a.y < b.y + b.size && b.y < a.y + a.size;
/**
 * The tile edges two rooms share, in board coordinates: [{ bx, by, side }] ("left" / "top" side of the board tile (bx, by)),
 * in order along the line. [] when they do not touch along a full tile edge (a corner is not touching).
 */
export function sharedEdges(a, b) {
  const out = [];
  const lo = (p, q) => Math.max(p, q), hi = (p, q) => Math.min(p, q);
  for (const [u, v] of [[a, b], [b, a]]) {
    if (u.x + u.size === v.x) for (let y = lo(u.y, v.y); y < hi(u.y + u.size, v.y + v.size); y++) out.push({ bx: v.x, by: y, side: "left" });
    if (u.y + u.size === v.y) for (let x = lo(u.x, v.x); x < hi(u.x + u.size, v.x + v.size); x++) out.push({ bx: x, by: v.y, side: "top" });
  }
  return out;
}
const edgeKey = (side, bx, by) => `${side}:${bx}:${by}`;

/**
 * One room's edges as sent → { edges (normalised, sorted) } or { error, ...where }. `size`: the room's side. Pure.
 * 400 format | bad_edge (off the room's grid, an unknown side or kind) | duplicate_edge.
 */
export function checkEdges(edges, size) {
  if (!Array.isArray(edges)) return { error: "format" };
  if (edges.length > 2 * size * (size + 1)) return { error: "too_many", max: 2 * size * (size + 1) };
  const seen = new Map(), out = [];
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!e || typeof e !== "object" || Array.isArray(e) || !Number.isInteger(e.x) || !Number.isInteger(e.y)) return { error: "format", index: i };
    if (!EDGE_SIDES.includes(e.side) || !EDGE_KINDS.includes(e.kind)) return { error: "bad_edge", index: i, sides: EDGE_SIDES, kinds: EDGE_KINDS };
    const inside = e.side === "left" ? e.x >= 0 && e.x <= size && e.y >= 0 && e.y < size : e.x >= 0 && e.x < size && e.y >= 0 && e.y <= size;
    if (!inside) return { error: "bad_edge", index: i, x: e.x, y: e.y, side: e.side };
    const k = edgeKey(e.side, e.x, e.y);
    if (seen.has(k)) return { error: "duplicate_edge", index: i, with: seen.get(k) };
    seen.set(k, i);
    out.push({ x: e.x, y: e.y, side: e.side, kind: e.kind });
  }
  out.sort((p, q) => (p.side === q.side ? 0 : p.side === "left" ? -1 : 1) || p.y - q.y || p.x - q.x);
  return { edges: out };
}

/** Which room keeps each shared edge: Map edgeKey (board) → { owner, other } (the newer room keeps it). */
function sharedOwners(rooms) {
  const out = new Map();
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i], b = rooms[j], owner = a.room > b.room ? a : b, other = owner === a ? b : a;
    for (const s of sharedEdges(a, b)) out.set(edgeKey(s.side, s.bx, s.by), { owner: owner.room, other: other.room });
  }
  return out;
}
/** A room's stored edges without those a newer room now keeps. */
const ownEdges = (r, owners) => r.edgeList.filter((e) => { const o = owners.get(edgeKey(e.side, r.x + e.x, r.y + e.y)); return !o || o.owner === r.room; });

/** The rooms not reachable from room 1 through doors on shared edges ([] when all are). `rooms[i].edgeList`: its own edges. */
export function unreachable(rooms) {
  const owners = sharedOwners(rooms), door = new Set();
  for (const r of rooms) for (const e of ownEdges(r, owners)) if (e.kind === "door") door.add(edgeKey(e.side, r.x + e.x, r.y + e.y));
  const links = new Map(rooms.map((r) => [r.room, new Set()]));
  for (const [k, { owner, other }] of owners) if (door.has(k)) { links.get(owner).add(other); links.get(other).add(owner); }
  const seen = new Set([1]), todo = [1];
  while (todo.length) for (const n of links.get(todo.pop()) || []) if (!seen.has(n)) { seen.add(n); todo.push(n); }
  return rooms.map((r) => r.room).filter((n) => !seen.has(n));
}

/** A name as sent → { name } (trimmed) or { error, max, reason? }. Control characters, line breaks and bidi overrides are refused, and so is
 *  a name the Codename word filter blocks (reason "blocked"); its "reserved" (staff, the brand) is fine for a player's own room. */
export function checkName(name) {
  if (typeof name !== "string") return { error: "bad_name", max: NAME_MAX };
  const t = name.trim();
  if ([...t].length > NAME_MAX || /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u.test(t)) return { error: "bad_name", max: NAME_MAX };
  if (codenameIssue(t) === "blocked") return { error: "bad_name", max: NAME_MAX, reason: "blocked" };
  return { name: t };
}

const parse = (text) => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } };
const roomOf = (body) => (body.room === undefined ? 1 : intIn(body.room, 1, 1000));

/** → the account's rooms, in order, room 1 always there (the empty 4 x 4 when it has no row yet), its hideout row, the settings and the step prices. */
async function read(d, id) {
  const r = await d.batch([
    d.prepare("SELECT room, size, layout, version, updated, x, y, grow, name, floor, edges FROM hideout_rooms WHERE account_id = ? ORDER BY room").bind(id),
    d.prepare("SELECT public, updated FROM hideouts WHERE account_id = ?").bind(id),
    d.prepare("SELECT k, v FROM hideout_settings"),
    d.prepare("SELECT size, price_coins FROM hideout_sizes"),
  ]);
  const rooms = r[0].results.map((x) => ({ ...x, placements: parse(x.layout), edgeList: parse(x.edges).filter((e) => e && typeof e === "object") }));
  if (!rooms.length || rooms[0].room !== 1) rooms.unshift({ room: 1, size: HIDEOUT_START, layout: "[]", placements: [], version: 0, updated: 0, x: 0, y: 0, grow: "se", name: "", floor: FLOOR_DEFAULT, edges: "[]", edgeList: [] });
  const settings = { ...HIDEOUT_SETTINGS };
  for (const row of r[2].results) if (Object.hasOwn(settings, row.k)) settings[row.k] = row.v;
  return { rooms, hideout: r[1].results[0] || { public: 0, updated: 0 }, settings, prices: new Map(r[3].results.map((x) => [x.size, x.price_coins])) };
}

/** → Map "item|tier" → qty held, for these items. */
async function holdings(d, id, items) {
  if (!items.length) return new Map();
  const rows = (await d.prepare("SELECT item_id, tier, qty FROM inventory WHERE account_id = ? AND item_id IN (SELECT value FROM json_each(?))").bind(id, JSON.stringify(items)).all()).results;
  return new Map(rows.map((r) => [`${r.item_id}|${r.tier}`, r.qty]));
}
const keyOf = (p) => `${p.item}|${p.tier || 0}`;
const nextOf = (size, prices) => (size < HIDEOUT_MAX && prices.has(size + 1) ? { size: size + 1, price: prices.get(size + 1) } : null);

/** → what the next room would be: { room, price, available, needs, reason? }, or null when the account has every room it can. */
function newRoomOf(rooms, settings) {
  if (rooms.length >= settings.max_rooms) return null;
  const newest = rooms[rooms.length - 1], available = newest.size >= settings.room_from_size;
  return { room: newest.room + 1, price: settings.room_price, available, needs: settings.room_from_size, ...(available ? {} : { reason: "not_yet" }) };
}

/** What GET answers (and what a save, a grow or a new room returns as `hideout`). */
async function view(ctx) {
  const { d, id } = ctx;
  const { rooms, hideout, settings, prices } = await read(d, id);
  const items = [...new Set(rooms.flatMap((r) => r.placements).filter((p) => p && !STARTER.has(p.item)).map((p) => p.item))];
  const held = await holdings(d, id, items);
  const used = new Map(), removed = [], owners = sharedOwners(rooms);
  const out = rooms.map((r) => {
    const layout = [];
    for (const p of r.placements) { // a card merged or gone since a save: the placements past what is held drop out
      if (!p || !Object.hasOwn(PROPS, p.item)) continue;
      if (STARTER.has(p.item)) { layout.push(p); continue; }
      const n = (used.get(keyOf(p)) || 0) + 1;
      used.set(keyOf(p), n);
      if (n <= (held.get(keyOf(p)) || 0)) layout.push(p); else removed.push({ room: r.room, ...p });
    }
    return { room: r.room, size: r.size, x: r.x, y: r.y, grow: r.grow, name: r.name, floor: r.floor, edges: ownEdges(r, owners), layout, version: r.version, updated: r.updated, next: nextOf(r.size, prices) };
  });
  return {
    rooms: out,
    ...(removed.length ? { removed } : {}),
    maxSize: HIDEOUT_MAX,
    maxRooms: settings.max_rooms,
    board: { min: BOARD_MIN, max: BOARD_MAX },
    floors: FLOORS,
    edgeKinds: EDGE_KINDS,
    nameMax: NAME_MAX,
    newRoom: newRoomOf(rooms, settings),
    starters: STARTERS,
    public: !!hideout.public,
    updated: hideout.updated,
  };
}

/** GET /api/app/hideout → { status, body: { rooms: [{ room, size, x, y, name, floor, edges, layout, version, updated, next }], maxSize, maxRooms, board, floors, edgeKinds, nameMax, newRoom, starters, public, updated, removed? } } */
export async function getHideout(ctx) {
  if (!(await ready(ctx.d))) return schema();
  return { status: 200, body: await view(ctx) };
}

/**
 * PUT /api/app/hideout { room?, version, layout?, name?, floor?, edges? } → { status, body: { ok, room, hideout, unlocked } }.
 * room: 1 when left out. Each of layout, name, floor and edges is saved when sent and left as it is when left out (an older
 * app sends { room?, layout, version } and keeps working); at least one must be sent. Every save is +1 on the room's version.
 * 400 format | too_many | unknown_item | bad_shape | bad_tier | out_of_bounds | overlap (the layout);
 * 400 bad_name { max, reason? ("blocked": the word filter) } | bad_floor { floors } | bad_edge | duplicate_edge | edge_shared { index, room } | disconnected { rooms };
 * 404 no_room; 413 too_large { max }; 409 not_owned { item, tier, held, placed, elsewhere } | 409 stale { room, hideout }
 * (another save of the room came first, or, for a save with edges, another room's edges or size changed in between).
 */
export async function saveHideout(ctx, body) {
  const { d, id, now, tz } = ctx;
  if (!(await ready(d))) return schema();
  const version = intIn(body.version, 0, Number.MAX_SAFE_INTEGER), room = roomOf(body);
  const has = (k) => body[k] !== undefined;
  if (version === null || room === null || !["layout", "name", "floor", "edges"].some(has)) return bad("format");
  if (has("layout") && !Array.isArray(body.layout)) return bad("format");
  const { rooms } = await read(d, id);
  const mine = rooms.find((r) => r.room === room);
  if (!mine) return bad("no_room", { room }, 404);
  if (mine.version !== version) return { status: 409, body: { error: "stale", room, hideout: await view(ctx) } };
  const sets = [], setBinds = [], guards = [], guardBinds = [];
  if (has("layout")) {
    const checked = checkLayout(body.layout, mine.size);
    if (checked.error) { const { error, ...where } = checked; return bad(error, where); }
    const text = JSON.stringify(checked.placements);
    if (text.length > LAYOUT_MAX_BYTES) return bad("too_large", { max: LAYOUT_MAX_BYTES }, 413);
    const need = [...checked.need].map(([k, n]) => { const [item, tier] = k.split("|"); return { item, tier: Number(tier), n }; });
    const held = await holdings(d, id, [...new Set(need.map((x) => x.item))]);
    const elsewhere = new Map();
    for (const r of rooms) if (r.room !== room) for (const p of r.placements) if (p && !STARTER.has(p.item)) elsewhere.set(keyOf(p), (elsewhere.get(keyOf(p)) || 0) + 1);
    // the other rooms keep what they hold: this one gets what is left (more placed elsewhere than held, after a merge: nothing)
    const short = need.find((x) => { const k = `${x.item}|${x.tier}`, h = held.get(k) || 0; return x.n + Math.min(h, elsewhere.get(k) || 0) > h; });
    if (short) {
      const k = `${short.item}|${short.tier}`;
      return { status: 409, body: { error: "not_owned", item: short.item, tier: short.tier, held: held.get(k) || 0, placed: short.n, elsewhere: elsewhere.get(k) || 0 } };
    }
    // the save itself checks the holdings (with the other rooms as they are now) again
    const heldSql = "COALESCE((SELECT i.qty FROM inventory i WHERE i.account_id = ? AND i.item_id = json_extract(n.value, '$.item') AND i.tier = json_extract(n.value, '$.tier')), 0)";
    const otherSql = `(SELECT COUNT(*) FROM hideout_rooms r, json_each(r.layout) p WHERE r.account_id = ? AND r.room <> ?
      AND json_extract(p.value, '$.item') = json_extract(n.value, '$.item') AND json_extract(p.value, '$.tier') = json_extract(n.value, '$.tier'))`;
    sets.push("layout = ?"); setBinds.push(text);
    guards.push(`NOT EXISTS (SELECT 1 FROM json_each(?) n WHERE json_extract(n.value, '$.n') + MIN(${heldSql}, ${otherSql}) > ${heldSql})`);
    guardBinds.push(JSON.stringify(need), id, id, room, id);
  }
  if (has("name")) {
    const named = checkName(body.name);
    if (named.error) { const { error, ...why } = named; return bad(error, why); }
    sets.push("name = ?"); setBinds.push(named.name);
  }
  if (has("floor")) {
    if (typeof body.floor !== "string" || !FLOORS.includes(body.floor)) return bad("bad_floor", { floors: FLOORS });
    sets.push("floor = ?"); setBinds.push(body.floor);
  }
  const fingerprint = (list) => JSON.stringify(list.filter((r) => r.room !== room).map((r) => [r.room, r.size, r.edges]));
  if (has("edges")) {
    const checked = checkEdges(body.edges, mine.size);
    if (checked.error) { const { error, ...where } = checked; return bad(error, where); }
    const owners = sharedOwners(rooms), ownerOf = (e) => owners.get(edgeKey(e.side, mine.x + e.x, mine.y + e.y));
    const taken = checked.edges.findIndex((e) => ownerOf(e) && ownerOf(e).owner !== room);
    if (taken >= 0) return bad("edge_shared", { index: taken, room: ownerOf(checked.edges[taken]).owner });
    const lost = unreachable(rooms.map((r) => (r.room === room ? { ...r, edgeList: checked.edges } : r)));
    if (lost.length) return bad("disconnected", { rooms: lost });
    const text = JSON.stringify(checked.edges);
    if (text.length > EDGES_MAX_BYTES) return bad("too_large", { max: EDGES_MAX_BYTES }, 413);
    sets.push("edges = ?"); setBinds.push(text);
    // the doors were checked against the other rooms as read: the save holds only if their edges and sizes are still those
    const others = rooms.filter((r) => r.room !== room).map((r) => [r.room, r.size, r.edges]);
    guards.push(`(SELECT COUNT(*) FROM hideout_rooms o WHERE o.account_id = ? AND o.room <> ?) = ?
      AND (SELECT COUNT(*) FROM hideout_rooms o, json_each(?) k WHERE o.account_id = ? AND o.room = json_extract(k.value, '$[0]')
        AND o.size = json_extract(k.value, '$[1]') AND o.edges = json_extract(k.value, '$[2]')) = ?`);
    guardBinds.push(id, room, others.length, JSON.stringify(others), id, others.length);
  }
  const op = newOp(), day = dayKey(now, tz);
  const res = await d.batch([
    d.prepare("INSERT INTO hideouts (account_id, updated) VALUES (?, ?) ON CONFLICT (account_id) DO UPDATE SET updated = excluded.updated").bind(id, now),
    d.prepare("INSERT INTO hideout_rooms (account_id, room, updated) SELECT ?, 1, ? WHERE ? = 1 ON CONFLICT (account_id, room) DO NOTHING").bind(id, now, room),
    d.prepare(`UPDATE hideout_rooms SET ${sets.join(", ")}, version = version + 1, updated = ? WHERE account_id = ? AND room = ? AND version = ?${guards.map((g) => ` AND ${g}`).join("")} RETURNING version`)
      .bind(...setBinds, now, id, room, version, ...guardBinds),
    ...(await achievementStatements(ctx, ["hideout_edit"], { day, op, guard: { sql: "EXISTS (SELECT 1 FROM hideout_rooms WHERE account_id = ? AND room = ? AND version = ? AND updated = ?)", binds: [id, room, version + 1, now] } })),
  ]);
  if (!wrote(res[2])) {
    const after = (await read(d, id)).rooms, again = after.find((r) => r.room === room);
    if (!again || again.version !== version || (has("edges") && fingerprint(after) !== fingerprint(rooms))) return { status: 409, body: { error: "stale", room, hideout: await view(ctx) } };
    return { status: 409, body: { error: "not_owned" } }; // a card left, or another room took it, between the look and the save: ask again
  }
  return { status: 200, body: { ok: true, room, hideout: await view(ctx), unlocked: await unlocksOf(ctx, op) } };
}

/** room_from_size as the database has it (the code's value when the row is missing). */
const NEED_SQL = `COALESCE((SELECT st.v FROM hideout_settings st WHERE st.k = 'room_from_size'), ${HIDEOUT_SETTINGS.room_from_size})`;
/**
 * SQL: the square (nx, ny, s) (SQL expressions) of account `acc`'s room `self` stays on the board, overlaps no other room, and
 * stays out of the newest room's growing square while the newest room is under room_from_size (and is not `self`).
 */
function roomFreeSql(nx, ny, s, acc, self) {
  const gx = `(o.x + CASE WHEN o.grow IN ('sw', 'nw') THEN o.size - ${NEED_SQL} ELSE 0 END)`;
  const gy = `(o.y + CASE WHEN o.grow IN ('ne', 'nw') THEN o.size - ${NEED_SQL} ELSE 0 END)`;
  return `(${nx} >= ${BOARD_MIN} AND ${ny} >= ${BOARD_MIN} AND ${nx} + ${s} - 1 <= ${BOARD_MAX} AND ${ny} + ${s} - 1 <= ${BOARD_MAX}
    AND NOT EXISTS (SELECT 1 FROM hideout_rooms o WHERE o.account_id = ${acc} AND o.room <> ${self}
      AND o.x < ${nx} + ${s} AND ${nx} < o.x + o.size AND o.y < ${ny} + ${s} AND ${ny} < o.y + o.size)
    AND NOT EXISTS (SELECT 1 FROM hideout_rooms o WHERE o.account_id = ${acc} AND o.room <> ${self} AND o.size < ${NEED_SQL}
      AND o.room = (SELECT MAX(m.room) FROM hideout_rooms m WHERE m.account_id = ${acc})
      AND ${gx} < ${nx} + ${s} AND ${nx} < ${gx} + ${NEED_SQL} AND ${gy} < ${ny} + ${s} AND ${ny} < ${gy} + ${NEED_SQL}))`;
}

/**
 * The statements that make room `room` of the account `to` x `to`, only if it is `to - 1` now, the grown room stays on the board,
 * overlaps no other room and keeps out of the newest room's growing square (roomSpace), and `guard` holds (a ledger.js `when`
 * condition: the debit of this batch, or another source's own row). The room grows toward its `grow` corner: for "sw" / "nw"
 * x goes down by 1, for "ne" / "nw" y does, and its layout and edges shift by the same step in room coordinates (so nothing
 * moves on the board) and its version goes up by 1 (a copy of the room from before is stale). The one place a room's size
 * changes: an achievement or a gift that grows a room calls this with its own guard (and should check roomSpace first: a
 * room that has no space simply does not grow). Room 1 gets its row here if it has none; another room must exist.
 */
export function growStatements(d, { id, room = 1, to, now, guard }) {
  if (!Number.isInteger(to)) throw new TypeError("growStatements: `to` must be an integer");
  const W = "(hideout_rooms.grow IN ('sw', 'nw'))", N = "(hideout_rooms.grow IN ('ne', 'nw'))";
  const shift = (col) => `CASE WHEN hideout_rooms.grow = 'se' THEN hideout_rooms.${col} ELSE (SELECT json_group_array(json_set(j.value,
    '$.x', json_extract(j.value, '$.x') + ${W}, '$.y', json_extract(j.value, '$.y') + ${N})) FROM json_each(hideout_rooms.${col}) j) END`;
  const free = roomFreeSql(`(hideout_rooms.x - ${W})`, `(hideout_rooms.y - ${N})`, String(to), "hideout_rooms.account_id", "hideout_rooms.room");
  return [
    d.prepare(`INSERT INTO hideouts (account_id, updated) SELECT ?, ? WHERE ${guard.sql} ON CONFLICT (account_id) DO UPDATE SET updated = excluded.updated`).bind(id, now, ...guard.binds),
    d.prepare(`INSERT INTO hideout_rooms (account_id, room, updated) SELECT ?, 1, ? WHERE ? = 1 AND ${guard.sql} ON CONFLICT (account_id, room) DO NOTHING`).bind(id, now, room, ...guard.binds),
    d.prepare(`UPDATE hideout_rooms SET size = ?, x = x - ${W}, y = y - ${N}, layout = ${shift("layout")}, edges = ${shift("edges")},
      version = version + (grow <> 'se'), updated = ? WHERE account_id = ? AND room = ? AND size = ? AND ${free} AND ${guard.sql}`)
      .bind(to, now, id, room, to - 1, ...guard.binds),
  ];
}

/**
 * What stands in the way of `room` growing to `to` x `to` toward its corner: { rooms (in the way), reserved (the newest room,
 * under `need`, whose growing square it would enter), board (it would leave the board) }; it can grow when rooms is empty and
 * board false. `need` left out: no square is reserved.
 */
export function growSpace(rooms, room, to, need) {
  const next = grownRect(room, to), newest = rooms[rooms.length - 1];
  const hit = rooms.filter((o) => o.room !== room.room && overlaps(next, o)).map((o) => o.room);
  const reserved = need !== undefined && newest.room !== room.room && newest.size < need && !hit.includes(newest.room) && overlaps(next, grownRect(newest, need));
  return { rooms: reserved ? [...hit, newest.room] : hit, reserved, board: !onBoard(next) };
}
/** The rooms in the way of `room` growing to `to` x `to` ([] when none; the newest room too when `need` is given and its square is entered). */
export const roomSpace = (rooms, room, to, need) => growSpace(rooms, room, to, need).rooms;

/**
 * POST /api/app/hideout/grow { room?, to } → { status, body: { ok, room, size, spent, hideout, state, unlocked } }. room: 1 when
 * left out. `to` must be the room's next size; the price is the server's (hideout_sizes). The room grows toward its `grow`
 * corner (growStatements): the new row and column must be on the board, free of other rooms, and out of the newest room's
 * growing square while that room is under 8 x 8. A resend of a step already bought answers { ok, duplicate: true }.
 * 400 format | 404 no_room | 409 max_size | 409 not_next { size, next } | 409 not_for_sale |
 * 409 no_space { room, size, to, rooms, reserved?: true, board?: { min, max } } | 402 insufficient { price, coins }
 */
export async function growHideout(ctx, body) {
  const { d, id, now, tz } = ctx;
  if (!(await ready(d))) return schema();
  const to = intIn(body.to, 1, 1000), room = roomOf(body);
  if (to === null || room === null) return bad("format");
  const ref = `room:${room}:size:${to}`;
  const again = async () => ({ status: 200, body: { ok: true, duplicate: true, room, size: to, hideout: await view(ctx), state: await snapshot(ctx), unlocked: [] } });
  const { rooms, prices, settings } = await read(d, id);
  const mine = rooms.find((r) => r.room === room);
  if (!mine) return bad("no_room", { room }, 404);
  const notNext = (size) => ({ status: 409, body: { error: "not_next", room, size, next: size < HIDEOUT_MAX ? size + 1 : null } });
  if (to > HIDEOUT_MAX) return { status: 409, body: { error: "max_size", room, size: mine.size, max: HIDEOUT_MAX } };
  if (to <= mine.size) return (await lineFor(d, id, "coin", "hideout", ref)) ? again() : notNext(mine.size);
  if (to !== mine.size + 1) return notNext(mine.size);
  if (!prices.has(to)) return { status: 409, body: { error: "not_for_sale", room, size: mine.size } };
  const noSpace = (space, size) => (space.rooms.length || space.board
    ? { status: 409, body: { error: "no_space", room, size, to, rooms: space.rooms, ...(space.reserved ? { reserved: true } : {}), ...(space.board ? { board: { min: BOARD_MIN, max: BOARD_MAX } } : {}) } }
    : null);
  const blocked = noSpace(growSpace(rooms, mine, to, settings.room_from_size), mine.size);
  if (blocked) return blocked;
  const price = prices.get(to), debit = newOp(), day = dayKey(now, tz), next = grownRect(mine, to);
  const sizeNow = "COALESCE((SELECT r.size FROM hideout_rooms r WHERE r.account_id = w.account_id AND r.room = ?), CASE WHEN ? = 1 THEN ? END)";
  const res = await d.batch([
    ...post(d, {
      id: debit, account: id, delta: -price, reason: "hideout", ref, day, at: now, meta: { room, size: to },
      guards: [when.funds("coin", price), { sql: `${sizeNow} = ?`, binds: [room, room, HIDEOUT_START, to - 1] },
        { sql: roomFreeSql(String(next.x), String(next.y), String(to), "w.account_id", String(room)), binds: [] }],
    }),
    ...growStatements(d, { id, room, to, now, guard: when.line(debit) }),
    ...(await achievementStatements(ctx, ["hideout_size"], { day, op: debit, guard: when.line(debit) })),
  ]);
  if (wrote(res[0])) return { status: 200, body: { ok: true, room, size: to, spent: price, hideout: await view(ctx), state: await snapshot(ctx), unlocked: await unlocksOf(ctx, debit) } };
  if (await lineFor(d, id, "coin", "hideout", ref)) return again(); // the same step, twice at once
  const later = await read(d, id), after = later.rooms.find((r) => r.room === room);
  if (after.size !== to - 1) return notNext(after.size);
  const blockedNow = noSpace(growSpace(later.rooms, after, to, later.settings.room_from_size), after.size);
  if (blockedNow) return blockedNow; // a room bought in the way meanwhile
  const w = await d.prepare("SELECT coins FROM wallets WHERE account_id = ?").bind(id).first();
  return { status: 402, body: { error: "insufficient", price, coins: w ? w.coins : 0 } };
}

/**
 * Where a new HIDEOUT_START room may go at (x, y): → { grow } (the corner it will grow toward) or { refusal: { status, body } }.
 * The room must be on the board, overlap no room and share a full tile edge with one; and it must be able to reach `need` x
 * `need` (hideout_settings room_from_size, 8: the next room is sold only once the NEWEST room is that big, the author,
 * 2026-11-25): the square of that side that extends from the room toward its corner must be on the board and overlap no room.
 * `grow`: the corner asked for, or null for the first of se, sw, ne, nw whose square is free (409 no_room_to_grow when none).
 */
function placeAt(rooms, x, y, need, grow = null) {
  const spot = { x, y, size: HIDEOUT_START };
  if (!onBoard(spot)) return { refusal: bad("out_of_bounds", { min: BOARD_MIN, max: BOARD_MAX }) };
  const hit = rooms.find((r) => overlaps(spot, r));
  if (hit) return { refusal: bad("overlap", { room: hit.room }, 409) };
  if (!rooms.some((r) => sharedEdges(spot, r).length)) return { refusal: bad("not_touching", {}, 409) };
  const side = Math.max(need, HIDEOUT_START);
  const free = (grow ? [grow] : GROW_DIRS).find((g) => { const sq = grownRect({ ...spot, grow: g }, side); return onBoard(sq) && !rooms.some((r) => overlaps(sq, r)); });
  return free ? { grow: free } : { refusal: bad("no_room_to_grow", { need }, 409) };
}
/**
 * Where a room goes when the call names no place (an older app): the first legal place (placeAt, with a free growing square in
 * any direction) beside a room, the newest first: right of it, below it, left of it, above it, aligned first, then sliding
 * along that side.
 */
function autoPlace(rooms, need) {
  for (const r of [...rooms].reverse()) {
    const along = [...Array(r.size + HIDEOUT_START - 1).keys()].map((i) => i - (HIDEOUT_START - 1)).sort((a, b) => (a < 0) - (b < 0) || Math.abs(a) - Math.abs(b));
    const spots = [
      ...along.map((k) => [r.x + r.size, r.y + k]), ...along.map((k) => [r.x + k, r.y + r.size]),
      ...along.map((k) => [r.x - HIDEOUT_START, r.y + k]), ...along.map((k) => [r.x + k, r.y - HIDEOUT_START]),
    ];
    for (const [x, y] of spots) { const at = placeAt(rooms, x, y, need); if (at.grow) return { x, y, grow: at.grow }; }
  }
  return null;
}
/**
 * The edges a new room at `spot` starts with: what the older rooms had on the edges it now shares (it keeps them from now on),
 * in its own coordinates, and one door in the middle of the longest edge it shares with one room (lowest room on a tie).
 */
function startingEdges(rooms, spot) {
  const owners = sharedOwners(rooms), out = new Map();
  let best = null;
  for (const r of rooms) {
    const shared = sharedEdges(spot, r);
    if (!shared.length) continue;
    const keys = new Set(shared.map((s) => edgeKey(s.side, s.bx, s.by)));
    for (const e of ownEdges(r, owners)) {
      const bx = r.x + e.x, by = r.y + e.y;
      if (keys.has(edgeKey(e.side, bx, by))) out.set(edgeKey(e.side, bx - spot.x, by - spot.y), { x: bx - spot.x, y: by - spot.y, side: e.side, kind: e.kind });
    }
    if (!best || shared.length > best.length) best = shared;
  }
  const mid = best[Math.floor((best.length - 1) / 2)], door = { x: mid.bx - spot.x, y: mid.by - spot.y, side: mid.side, kind: "door" };
  out.set(edgeKey(door.side, door.x, door.y), door);
  return checkEdges([...out.values()], HIDEOUT_START).edges;
}

/**
 * POST /api/app/hideout/rooms { requestId?, x?, y?, grow? } → { status, body: { ok, room, x, y, grow, spent, hideout, state, unlocked } }.
 * Buys the next room (number: the newest + 1), at hideout_settings room_price, once the newest room is room_from_size or more.
 * It starts 4 x 4 with its top-left at board (x, y): on the board, overlapping no room, sharing at least one full tile edge
 * with one, and able to grow to room_from_size (8) x 8 toward its `grow` corner ("se", "sw", "ne", "nw"): that square is on the
 * board and overlaps no room (`newRoom.needs` in GET is its side, for the app's ghost square). Without `grow`, the first of
 * se, sw, ne, nw whose square is free. Without x and y (an older app) the server picks the first such place beside a room,
 * the newest first, on any side. It gets one door on a shared edge (startingEdges). A resend (the same requestId, or the same
 * room bought by a tap racing this one) answers { ok, duplicate: true, room }.
 * 400 format | 400 out_of_bounds { min, max } | 409 overlap { room } | 409 not_touching | 409 no_room_to_grow { need } |
 * 409 no_space (no place left beside any room, without x, y) | 409 not_yet { room (the newest), size, needs } |
 * 409 max_rooms { max } | 402 insufficient { price, coins }
 */
export async function buyRoom(ctx, body) {
  const { d, id, now, tz } = ctx;
  if (!(await ready(d))) return schema();
  const requestId = body.requestId === undefined || body.requestId === null ? null : body.requestId;
  if (requestId !== null && (typeof requestId !== "string" || !CLIENT_ID_RE.test(requestId))) return bad("format");
  const placed = body.x !== undefined || body.y !== undefined;
  if (placed && (!Number.isInteger(body.x) || !Number.isInteger(body.y))) return bad("format");
  const askedGrow = body.grow === undefined || body.grow === null ? null : body.grow;
  if (askedGrow !== null && !GROW_DIRS.includes(askedGrow)) return bad("format");
  const duplicate = async (room) => ({ status: 200, body: { ok: true, duplicate: true, room, hideout: await view(ctx), state: await snapshot(ctx), unlocked: [] } });
  if (requestId) {
    const prior = await d.prepare("SELECT ref FROM ledger WHERE account_id = ? AND currency = 'coin' AND reason = 'hideout' AND json_extract(meta, '$.requestId') = ?").bind(id, requestId).first();
    if (prior) return duplicate(Number(prior.ref.split(":")[1]));
  }
  const { rooms, settings } = await read(d, id);
  const newest = rooms[rooms.length - 1], n = newest.room + 1, price = settings.room_price;
  const refusal = (list) => {
    const last = list[list.length - 1];
    if (list.length >= settings.max_rooms) return { status: 409, body: { error: "max_rooms", max: settings.max_rooms } };
    if (last.size < settings.room_from_size) return { status: 409, body: { error: "not_yet", room: last.room, size: last.size, needs: settings.room_from_size } };
    return null;
  };
  const no = refusal(rooms);
  if (no) return no;
  let spot;
  if (placed) {
    const at = placeAt(rooms, body.x, body.y, settings.room_from_size, askedGrow);
    if (at.refusal) return at.refusal;
    spot = { x: body.x, y: body.y, size: HIDEOUT_START, grow: at.grow };
  } else {
    const auto = autoPlace(rooms, settings.room_from_size);
    if (!auto) return bad("no_space", {}, 409);
    spot = { ...auto, size: HIDEOUT_START };
  }
  const edges = JSON.stringify(startingEdges(rooms, spot)), square = grownRect(spot, Math.max(settings.room_from_size, HIDEOUT_START));
  const debit = newOp(), day = dayKey(now, tz), ref = `room:${n}`, paid = when.line(debit);
  const res = await d.batch([
    ...post(d, {
      id: debit, account: id, delta: -price, reason: "hideout", ref, day, at: now, meta: { room: n, x: spot.x, y: spot.y, grow: spot.grow, ...(requestId ? { requestId } : {}) },
      guards: [when.funds("coin", price),
        { sql: "COALESCE((SELECT MAX(r.room) FROM hideout_rooms r WHERE r.account_id = w.account_id), 1) = ?", binds: [n - 1] },
        { sql: "COALESCE((SELECT r.size FROM hideout_rooms r WHERE r.account_id = w.account_id AND r.room = ?), ?) >= ?", binds: [n - 1, HIDEOUT_START, settings.room_from_size] },
        // the place and its growing square are still free (no room grown into them since the look)
        { sql: "NOT EXISTS (SELECT 1 FROM hideout_rooms r WHERE r.account_id = w.account_id AND r.x < ? AND ? < r.x + r.size AND r.y < ? AND ? < r.y + r.size)", binds: [square.x + square.size, square.x, square.y + square.size, square.y] }],
    }),
    d.prepare(`INSERT INTO hideouts (account_id, updated) SELECT ?, ? WHERE ${paid.sql} ON CONFLICT (account_id) DO UPDATE SET updated = excluded.updated`).bind(id, now, ...paid.binds),
    d.prepare(`INSERT INTO hideout_rooms (account_id, room, x, y, grow, edges, updated) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${paid.sql}`).bind(id, n, spot.x, spot.y, spot.grow, edges, now, ...paid.binds),
    ...(await achievementStatements(ctx, ["hideout_room"], { day, op: debit, guard: paid })),
  ]);
  if (wrote(res[0])) return { status: 200, body: { ok: true, room: n, x: spot.x, y: spot.y, grow: spot.grow, spent: price, hideout: await view(ctx), state: await snapshot(ctx), unlocked: await unlocksOf(ctx, debit) } };
  const raced = await lineFor(d, id, "coin", "hideout", ref); // a tap racing this one bought this room
  if (raced) {
    let meta = {};
    try { meta = JSON.parse(raced.meta) || {}; } catch { /* no request id */ }
    if (!requestId || !meta.requestId || meta.requestId === requestId) return duplicate(n);
  }
  const later = (await read(d, id)).rooms;
  const stop = refusal(later) || placeAt(later, spot.x, spot.y, settings.room_from_size, spot.grow).refusal;
  if (stop) return stop;
  const w = await d.prepare("SELECT coins FROM wallets WHERE account_id = ?").bind(id).first();
  return { status: 402, body: { error: "insufficient", price, coins: w ? w.coins : 0 } };
}
