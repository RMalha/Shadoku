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
 */
import { HIDEOUT_PROPS } from "./hideout_props.js";
import { post, when, wrote, newOp, lineFor } from "./ledger.js";
import { snapshot } from "./context.js";
import { CLIENT_ID_RE, dayKey, intIn, MAX_TIER } from "./economy.js";
import { achievementStatements, unlocksOf } from "./achievements.js";

export const HIDEOUT_START = 4;
export const HIDEOUT_MAX = 10;
export const LAYOUT_MAX_BYTES = 16384;
/** hideout_settings as the code knows them when a row is missing (migrations/0005 seeds the same). */
export const HIDEOUT_SETTINGS = Object.freeze({ room_price: 1000, room_from_size: 8, max_rooms: 10 });
/** The starting set: owned from the start, unlimited, never sold, never in packs (the author, 2026-11-16). */
export const STARTERS = Object.freeze([...HIDEOUT_PROPS.starters]);
const STARTER = new Set(STARTERS);
const PROPS = HIDEOUT_PROPS.props;

let tableSeen = false; // once per isolate, remembered only once migration 0005 is there
async function ready(d) {
  if (tableSeen) return true;
  const row = await d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('hideouts', 'hideout_rooms', 'hideout_sizes', 'hideout_settings')").first();
  tableSeen = !!row && row.n === 4;
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

const parse = (text) => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } };
const roomOf = (body) => (body.room === undefined ? 1 : intIn(body.room, 1, 1000));

/** → the account's rooms, in order, room 1 always there (the empty 4 x 4 when it has no row yet), its hideout row, the settings and the step prices. */
async function read(d, id) {
  const r = await d.batch([
    d.prepare("SELECT room, size, layout, version, updated FROM hideout_rooms WHERE account_id = ? ORDER BY room").bind(id),
    d.prepare("SELECT public, updated FROM hideouts WHERE account_id = ?").bind(id),
    d.prepare("SELECT k, v FROM hideout_settings"),
    d.prepare("SELECT size, price_coins FROM hideout_sizes"),
  ]);
  const rooms = r[0].results.map((x) => ({ ...x, placements: parse(x.layout) }));
  if (!rooms.length || rooms[0].room !== 1) rooms.unshift({ room: 1, size: HIDEOUT_START, layout: "[]", placements: [], version: 0, updated: 0 });
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
  const used = new Map(), removed = [];
  const out = rooms.map((r) => {
    const layout = [];
    for (const p of r.placements) { // a card merged or gone since a save: the placements past what is held drop out
      if (!p || !Object.hasOwn(PROPS, p.item)) continue;
      if (STARTER.has(p.item)) { layout.push(p); continue; }
      const n = (used.get(keyOf(p)) || 0) + 1;
      used.set(keyOf(p), n);
      if (n <= (held.get(keyOf(p)) || 0)) layout.push(p); else removed.push({ room: r.room, ...p });
    }
    return { room: r.room, size: r.size, layout, version: r.version, updated: r.updated, next: nextOf(r.size, prices) };
  });
  return {
    rooms: out,
    ...(removed.length ? { removed } : {}),
    maxSize: HIDEOUT_MAX,
    maxRooms: settings.max_rooms,
    newRoom: newRoomOf(rooms, settings),
    starters: STARTERS,
    public: !!hideout.public,
    updated: hideout.updated,
  };
}

/** GET /api/app/hideout → { status, body: { rooms: [{ room, size, layout, version, updated, next }], maxSize, maxRooms, newRoom, starters, public, updated, removed? } } */
export async function getHideout(ctx) {
  if (!(await ready(ctx.d))) return schema();
  return { status: 200, body: await view(ctx) };
}

/**
 * PUT /api/app/hideout { room?, layout, version } → { status, body: { ok, room, hideout, unlocked } }. room: 1 when left out.
 * 400 format | too_many | unknown_item | bad_shape | bad_tier | out_of_bounds | overlap; 404 no_room; 413 too_large;
 * 409 not_owned { item, tier, held, placed, elsewhere } | 409 stale { room, hideout } (another save of the room came first).
 */
export async function saveHideout(ctx, body) {
  const { d, id, now, tz } = ctx;
  if (!(await ready(d))) return schema();
  const version = intIn(body.version, 0, Number.MAX_SAFE_INTEGER), room = roomOf(body);
  if (version === null || room === null || !Array.isArray(body.layout)) return bad("format");
  const { rooms } = await read(d, id);
  const mine = rooms.find((r) => r.room === room);
  if (!mine) return bad("no_room", { room }, 404);
  if (mine.version !== version) return { status: 409, body: { error: "stale", room, hideout: await view(ctx) } };
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
  const op = newOp(), day = dayKey(now, tz);
  // the save itself checks the version and the holdings (with the other rooms as they are now) again
  const heldSql = "COALESCE((SELECT i.qty FROM inventory i WHERE i.account_id = ? AND i.item_id = json_extract(n.value, '$.item') AND i.tier = json_extract(n.value, '$.tier')), 0)";
  const otherSql = `(SELECT COUNT(*) FROM hideout_rooms r, json_each(r.layout) p WHERE r.account_id = ? AND r.room <> ?
    AND json_extract(p.value, '$.item') = json_extract(n.value, '$.item') AND json_extract(p.value, '$.tier') = json_extract(n.value, '$.tier'))`;
  const holds = `NOT EXISTS (SELECT 1 FROM json_each(?) n WHERE json_extract(n.value, '$.n') + MIN(${heldSql}, ${otherSql}) > ${heldSql})`;
  const res = await d.batch([
    d.prepare("INSERT INTO hideouts (account_id, updated) VALUES (?, ?) ON CONFLICT (account_id) DO UPDATE SET updated = excluded.updated").bind(id, now),
    d.prepare("INSERT INTO hideout_rooms (account_id, room, updated) SELECT ?, 1, ? WHERE ? = 1 ON CONFLICT (account_id, room) DO NOTHING").bind(id, now, room),
    d.prepare(`UPDATE hideout_rooms SET layout = ?, version = version + 1, updated = ? WHERE account_id = ? AND room = ? AND version = ? AND ${holds} RETURNING version`)
      .bind(text, now, id, room, version, JSON.stringify(need), id, id, room, id),
    ...(await achievementStatements(ctx, ["hideout_edit"], { day, op, guard: { sql: "EXISTS (SELECT 1 FROM hideout_rooms WHERE account_id = ? AND room = ? AND version = ? AND updated = ?)", binds: [id, room, version + 1, now] } })),
  ]);
  if (!wrote(res[2])) {
    const again = (await read(d, id)).rooms.find((r) => r.room === room);
    if (!again || again.version !== version) return { status: 409, body: { error: "stale", room, hideout: await view(ctx) } };
    return { status: 409, body: { error: "not_owned" } }; // a card left, or another room took it, between the look and the save: ask again
  }
  return { status: 200, body: { ok: true, room, hideout: await view(ctx), unlocked: await unlocksOf(ctx, op) } };
}

/**
 * The statements that make room `room` of the account `to` x `to`, only if it is `to - 1` now and `guard` holds (a ledger.js
 * `when` condition: the debit of this batch, or another source's own row). The one place a room's size changes: an achievement
 * or a gift that grows a room calls this with its own guard. Room 1 gets its row here if it has none; another room must exist.
 */
export function growStatements(d, { id, room = 1, to, now, guard }) {
  return [
    d.prepare(`INSERT INTO hideouts (account_id, updated) SELECT ?, ? WHERE ${guard.sql} ON CONFLICT (account_id) DO UPDATE SET updated = excluded.updated`).bind(id, now, ...guard.binds),
    d.prepare(`INSERT INTO hideout_rooms (account_id, room, updated) SELECT ?, 1, ? WHERE ? = 1 AND ${guard.sql} ON CONFLICT (account_id, room) DO NOTHING`).bind(id, now, room, ...guard.binds),
    d.prepare(`UPDATE hideout_rooms SET size = ?, updated = ? WHERE account_id = ? AND room = ? AND size = ? AND ${guard.sql}`).bind(to, now, id, room, to - 1, ...guard.binds),
  ];
}

/**
 * POST /api/app/hideout/grow { room?, to } → { status, body: { ok, room, size, spent, hideout, state, unlocked } }. room: 1 when
 * left out. `to` must be the room's next size; the price is the server's (hideout_sizes). A resend of a step already bought
 * answers { ok, duplicate: true }. 400 format | 404 no_room | 409 max_size | 409 not_next { size, next } | 409 not_for_sale |
 * 402 insufficient { price, coins }
 */
export async function growHideout(ctx, body) {
  const { d, id, now, tz } = ctx;
  if (!(await ready(d))) return schema();
  const to = intIn(body.to, 1, 1000), room = roomOf(body);
  if (to === null || room === null) return bad("format");
  const ref = `room:${room}:size:${to}`;
  const again = async () => ({ status: 200, body: { ok: true, duplicate: true, room, size: to, hideout: await view(ctx), state: await snapshot(ctx), unlocked: [] } });
  const { rooms, prices } = await read(d, id);
  const mine = rooms.find((r) => r.room === room);
  if (!mine) return bad("no_room", { room }, 404);
  const notNext = (size) => ({ status: 409, body: { error: "not_next", room, size, next: size < HIDEOUT_MAX ? size + 1 : null } });
  if (to > HIDEOUT_MAX) return { status: 409, body: { error: "max_size", room, size: mine.size, max: HIDEOUT_MAX } };
  if (to <= mine.size) return (await lineFor(d, id, "coin", "hideout", ref)) ? again() : notNext(mine.size);
  if (to !== mine.size + 1) return notNext(mine.size);
  if (!prices.has(to)) return { status: 409, body: { error: "not_for_sale", room, size: mine.size } };
  const price = prices.get(to), debit = newOp(), day = dayKey(now, tz);
  const sizeNow = "COALESCE((SELECT r.size FROM hideout_rooms r WHERE r.account_id = w.account_id AND r.room = ?), CASE WHEN ? = 1 THEN ? END)";
  const res = await d.batch([
    ...post(d, {
      id: debit, account: id, delta: -price, reason: "hideout", ref, day, at: now, meta: { room, size: to },
      guards: [when.funds("coin", price), { sql: `${sizeNow} = ?`, binds: [room, room, HIDEOUT_START, to - 1] }],
    }),
    ...growStatements(d, { id, room, to, now, guard: when.line(debit) }),
    ...(await achievementStatements(ctx, ["hideout_size"], { day, op: debit, guard: when.line(debit) })),
  ]);
  if (wrote(res[0])) return { status: 200, body: { ok: true, room, size: to, spent: price, hideout: await view(ctx), state: await snapshot(ctx), unlocked: await unlocksOf(ctx, debit) } };
  if (await lineFor(d, id, "coin", "hideout", ref)) return again(); // the same step, twice at once
  const after = (await read(d, id)).rooms.find((r) => r.room === room);
  if (after.size !== to - 1) return notNext(after.size);
  const w = await d.prepare("SELECT coins FROM wallets WHERE account_id = ?").bind(id).first();
  return { status: 402, body: { error: "insufficient", price, coins: w ? w.coins : 0 } };
}

/**
 * POST /api/app/hideout/rooms { requestId? } → { status, body: { ok, room, spent, hideout, state, unlocked } }. Buys the next
 * room (number: the newest + 1), at hideout_settings room_price, once the newest room is room_from_size or more. It starts
 * 4 x 4. A resend (the same requestId, or the same room bought by a tap racing this one) answers { ok, duplicate: true, room }.
 * 400 format | 409 not_yet { room (the newest), size, needs } | 409 max_rooms { max } | 402 insufficient { price, coins }
 */
export async function buyRoom(ctx, body) {
  const { d, id, now, tz } = ctx;
  if (!(await ready(d))) return schema();
  const requestId = body.requestId === undefined || body.requestId === null ? null : body.requestId;
  if (requestId !== null && (typeof requestId !== "string" || !CLIENT_ID_RE.test(requestId))) return bad("format");
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
  const debit = newOp(), day = dayKey(now, tz), ref = `room:${n}`, paid = when.line(debit);
  const res = await d.batch([
    ...post(d, {
      id: debit, account: id, delta: -price, reason: "hideout", ref, day, at: now, meta: { room: n, ...(requestId ? { requestId } : {}) },
      guards: [when.funds("coin", price),
        { sql: "COALESCE((SELECT MAX(r.room) FROM hideout_rooms r WHERE r.account_id = w.account_id), 1) = ?", binds: [n - 1] },
        { sql: "COALESCE((SELECT r.size FROM hideout_rooms r WHERE r.account_id = w.account_id AND r.room = ?), ?) >= ?", binds: [n - 1, HIDEOUT_START, settings.room_from_size] }],
    }),
    d.prepare(`INSERT INTO hideouts (account_id, updated) SELECT ?, ? WHERE ${paid.sql} ON CONFLICT (account_id) DO UPDATE SET updated = excluded.updated`).bind(id, now, ...paid.binds),
    d.prepare(`INSERT INTO hideout_rooms (account_id, room, updated) SELECT ?, ?, ? WHERE ${paid.sql}`).bind(id, n, now, ...paid.binds),
    ...(await achievementStatements(ctx, ["hideout_room"], { day, op: debit, guard: paid })),
  ]);
  if (wrote(res[0])) return { status: 200, body: { ok: true, room: n, spent: price, hideout: await view(ctx), state: await snapshot(ctx), unlocked: await unlocksOf(ctx, debit) } };
  const raced = await lineFor(d, id, "coin", "hideout", ref); // a tap racing this one bought this room
  if (raced) {
    let meta = {};
    try { meta = JSON.parse(raced.meta) || {}; } catch { /* no request id */ }
    if (!requestId || !meta.requestId || meta.requestId === requestId) return duplicate(n);
  }
  const later = refusal((await read(d, id)).rooms);
  if (later) return later;
  const w = await d.prepare("SELECT coins FROM wallets WHERE account_id = ?").bind(id).first();
  return { status: 402, body: { error: "insufficient", price, coins: w ? w.coins : 0 } };
}
