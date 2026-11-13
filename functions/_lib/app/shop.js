/**
 * Spending coins in the Shop (architecture 4.3 `POST /shop/buy`; prices: app/docs/Stuff.xlsx "Shop"). The phone names an item
 * and a request id; the price is the server's. One batch: the debit is written only if the balance covers it (so two buys racing
 * for the same coins cannot both win, and a balance below zero buys nothing), and the goods are added only if that debit was
 * written. The request id makes a retry safe: the same id never debits twice.
 *
 * Sold for coins:
 *   hint bundles          {"hints": n}, at their row's price
 *   packs                 at their row's price; a bought pack waits in the inventory (opening it: POST /api/app/packs/open).
 *                         The list shows each pack's odds, the very table the roll reads (packs.js publishedOdds)
 *   cosmetics             avatar items, hideout props and furniture, as cards: a second one is a duplicate, and duplicates
 *                         merge into variants (packs.js). Priced by rarity (economy.js COSMETIC_PRICES) unless the row sets
 *                         a price, and on sale only as a "cosmetic of the day".
 *
 * Cosmetics of the day (decided 2026-11-13): each player has their own shelves for a date, one item per group (avatar,
 * hideout) and rarity, dealt at random (economy.js shopShelves: the same on every look). A player may swap ONE of them for
 * free once a day, and after that as often as they like by watching an ad each time (placement "shop_refresh"). A swap puts
 * another item of the same group and rarity on that shelf; the allowance and the ticket are checked by the database in the
 * batch that records the swap.
 */
import { post, when, wrote, newOp, lineFor } from "./ledger.js";
import { questBumps, questDefs } from "./quests.js";
import { packTables, publishedOdds } from "./packs.js";
import { snapshot } from "./context.js";
import { CLIENT_ID_RE, COSMETIC_GROUP, COSMETIC_PRICES, dayKey, randomInt, shopShelves } from "./economy.js";

const HIDEOUT = ["prop", "furniture"];
const ITEM_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const isCosmetic = (item) => Object.hasOwn(COSMETIC_GROUP, item.kind);

const onSale = (item, now) => item.active === 1 && (item.starts === null || item.starts <= now) && (item.ends === null || item.ends > now);

/** → the item's price in coins, or 0 when it is not sold for coins. */
function priceOf(item) {
  if (Number.isInteger(item.price_coins)) return item.price_coins > 0 && (isCosmetic(item) || item.kind === "hint_bundle" || item.kind === "pack") ? item.price_coins : 0;
  return isCosmetic(item) && Object.hasOwn(COSMETIC_PRICES, item.rarity) ? COSMETIC_PRICES[item.rarity] : 0;
}

/**
 * The account's cosmetic shelves for its date. → { now: Map shelf → the item on it, all: Map shelf → every item that could be }.
 * A shelf holds the day's deal, or the item the player's latest swap of that shelf put there (while that item is still on sale).
 */
async function shelvesOf(ctx) {
  const day = dayKey(ctx.now, ctx.tz);
  const r = await ctx.d.batch([
    ctx.d.prepare("SELECT id, kind, rarity, active, starts, ends FROM items WHERE active = 1 AND kind IN ('avatar', 'prop', 'furniture')"),
    ctx.d.prepare("SELECT shelf, item_id FROM shop_refreshes WHERE account_id = ? AND day = ? ORDER BY seq").bind(ctx.id, day),
  ]);
  const all = shopShelves(r[0].results.filter((i) => onSale(i, ctx.now)), day, ctx.id);
  const now = new Map([...all].map(([shelf, ids]) => [shelf, ids[0]]));
  for (const swap of r[1].results) if (all.has(swap.shelf) && all.get(swap.shelf).includes(swap.item_id)) now.set(swap.shelf, swap.item_id);
  return { now, all };
}

/** → the ids of the cosmetics on the account's shelves today. */
const todaysCosmetics = async (ctx) => new Set((await shelvesOf(ctx)).now.values());

/** GET /api/app/shop → what is on sale now. Prices in coins are the server's; prices in money are Play's (by sku). */
export async function listShop(ctx) {
  const rows = (await ctx.d.prepare("SELECT id, kind, rarity, price_coins, sku, data, starts, ends, active FROM items WHERE active = 1 ORDER BY kind, price_coins, id").all()).results;
  const today = await todaysCosmetics(ctx);
  const { packs } = await packTables(ctx.d);
  return rows.filter((i) => onSale(i, ctx.now) && (!isCosmetic(i) || today.has(i.id))).map((i) => {
    let data = {};
    try { data = JSON.parse(i.data) || {}; } catch { /* shown without details */ }
    return { id: i.id, kind: i.kind, rarity: i.rarity, priceCoins: priceOf(i) || null, sku: i.sku, data, ends: i.ends, ...(isCosmetic(i) ? { ofTheDay: true } : {}), ...(i.kind === "pack" && packs.has(i.id) ? { odds: publishedOdds(packs.get(i.id)) } : {}) };
  });
}

/**
 * POST /api/app/shop/refresh { itemId, ticket? } → { status, body: { ok, shelf, item (the new one), replaced, how, state } }.
 * Swaps one of today's cosmetics for another of its group and rarity. Without `ticket`: the day's one free swap. With `ticket`:
 * a paid "shop_refresh" ad ticket, spent here. 404 not_today | 409 no_other_item | 409 free_used | 409 ticket.
 */
export async function refreshShelf(ctx, { itemId, ticket }) {
  const { d, id, now, tz } = ctx;
  if (typeof itemId !== "string" || !ITEM_ID_RE.test(itemId) || (ticket !== undefined && ticket !== null && (typeof ticket !== "string" || !ticket))) return { status: 400, body: { error: "format" } };
  const shelves = await shelvesOf(ctx);
  const shelf = ([...shelves.now].find(([, item]) => item === itemId) || [])[0];
  if (!shelf) return { status: 404, body: { error: "not_today" } };
  const others = shelves.all.get(shelf).filter((item) => item !== itemId);
  if (!others.length) return { status: 409, body: { error: "no_other_item" } };
  const next = others[randomInt(others.length)], day = dayKey(now, tz), op = newOp();
  const allowed = ticket
    ? { sql: "EXISTS (SELECT 1 FROM ad_tickets t WHERE t.id = ? AND t.account_id = ? AND t.placement = 'shop_refresh' AND t.paid_at IS NOT NULL AND t.used_at IS NULL)", binds: [ticket, id] }
    : { sql: "(SELECT COUNT(*) FROM shop_refreshes f WHERE f.account_id = ? AND f.day = ? AND f.how = 'free') = 0", binds: [id, day] };
  const stmts = [
    d.prepare(`INSERT INTO shop_refreshes (account_id, day, shelf, item_id, how, at, op) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${allowed.sql} RETURNING seq`)
      .bind(id, day, shelf, next, ticket ? "ad" : "free", now, op, ...allowed.binds),
  ];
  if (ticket) stmts.push(d.prepare("UPDATE ad_tickets SET used_at = ? WHERE id = ? AND account_id = ? AND used_at IS NULL AND EXISTS (SELECT 1 FROM shop_refreshes WHERE op = ?)").bind(now, ticket, id, op));
  const res = await d.batch(stmts);
  if (wrote(res[0])) return { status: 200, body: { ok: true, shelf, item: next, replaced: itemId, how: ticket ? "ad" : "free", state: await snapshot(ctx) } };
  return { status: 409, body: { error: ticket ? "ticket" : "free_used" } }; // free_used: watch an ad to swap again
}

/** POST /api/app/shop/buy { itemId, requestId } → { status, body }. */
export async function buy(ctx, { itemId, requestId }) {
  const { d, id, now, tz } = ctx;
  if (typeof itemId !== "string" || !ITEM_ID_RE.test(itemId) || typeof requestId !== "string" || !CLIENT_ID_RE.test(requestId)) return { status: 400, body: { error: "format" } };
  const item = await d.prepare("SELECT id, kind, rarity, price_coins, data, active, starts, ends FROM items WHERE id = ?").bind(itemId).first();
  if (!item || !onSale(item, now)) return { status: 404, body: { error: "unknown_item" } };
  const price = priceOf(item);
  if (!price) return { status: 400, body: { error: "not_for_coins" } };
  const prior = await lineFor(d, id, "coin", "shop", requestId);
  if (prior) { // a retry of a request that went through: same answer, no second debit
    let meta = {};
    try { meta = JSON.parse(prior.meta) || {}; } catch { /* treated as another item */ }
    return meta.item === item.id ? { status: 200, body: { ok: true, duplicate: true, state: await snapshot(ctx) } } : { status: 409, body: { error: "request_reused" } };
  }
  if (isCosmetic(item) && !(await todaysCosmetics(ctx)).has(item.id)) return { status: 404, body: { error: "not_today" } };
  let hints = 0;
  if (item.kind === "hint_bundle") {
    try { hints = JSON.parse(item.data).hints; } catch { /* refused below */ }
    if (!Number.isInteger(hints) || hints <= 0) return { status: 400, body: { error: "not_for_coins" } };
  }
  const day = dayKey(now, tz), debit = newOp(), paid = when.line(debit);
  const owned = "EXISTS (SELECT 1 FROM inventory i WHERE i.account_id = ? AND i.item_id = ?)";
  const defs = await questDefs(ctx);
  const stmts = post(d, { id: debit, account: id, delta: -price, reason: "shop", ref: requestId, day, at: now, meta: { item: item.id, kind: item.kind }, guards: [when.funds("coin", price)] });
  stmts.push(...questBumps(ctx, defs, day, (kind) => kind === "shop_buy", paid));
  if (hints) {
    stmts.push(...post(d, { id: newOp(), account: id, currency: "hint", delta: hints, reason: "shop", ref: requestId, day, at: now, meta: { item: item.id }, guards: [paid] }));
  } else {
    if (HIDEOUT.includes(item.kind)) { // "new hideout props" quests count an item the first time it is owned: before the row below exists
      stmts.push(...questBumps(ctx, defs, day, (kind) => kind === "new_props", { sql: `${paid.sql} AND NOT ${owned}`, binds: [...paid.binds, id, item.id] }));
    }
    stmts.push(d.prepare(`INSERT INTO inventory (account_id, item_id, qty, first_at) SELECT ?, ?, 1, ? WHERE ${paid.sql} ON CONFLICT (account_id, item_id, tier) DO UPDATE SET qty = qty + 1`).bind(id, item.id, now, ...paid.binds));
  }
  const res = await d.batch(stmts);
  if (wrote(res[0])) return { status: 200, body: { ok: true, item: item.id, spent: price, ...(hints ? { hints } : {}), state: await snapshot(ctx) } };
  if (await lineFor(d, id, "coin", "shop", requestId)) return { status: 200, body: { ok: true, duplicate: true, state: await snapshot(ctx) } }; // the same request, twice at once
  return { status: 402, body: { error: "insufficient", price } };
}
