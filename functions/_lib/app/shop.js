/**
 * Spending coins in the Shop (architecture 4.3 `POST /shop/buy`; prices: app/docs/Stuff.xlsx "Shop"). The phone names an item
 * and a request id; the price is the server's. One batch: the debit is written only if the balance covers it (so two buys racing
 * for the same coins cannot both win, and a balance below zero buys nothing), and the goods are added only if that debit was
 * written. The request id makes a retry safe: the same id never debits twice.
 *
 * Sold for coins:
 *   hint bundles          {"hints": n}, at their row's price
 *   packs                 at their row's price; a bought pack waits in the inventory (opening it: POST /api/app/packs/open, to come)
 *   cosmetics             avatar items (owned once), hideout props and furniture (stackable): priced by rarity
 *                         (economy.js COSMETIC_PRICES) unless the row sets a price, and on sale only as a "cosmetic of the day":
 *                         one per group and rarity, the same for everyone on a date (economy.js cosmeticsOfDay).
 */
import { post, when, wrote, newOp, lineFor } from "./ledger.js";
import { questBumps, questDefs } from "./quests.js";
import { snapshot } from "./context.js";
import { CLIENT_ID_RE, COSMETIC_GROUP, COSMETIC_PRICES, cosmeticsOfDay, dayKey } from "./economy.js";

const ONCE = ["avatar"];
const HIDEOUT = ["prop", "furniture"];
const isCosmetic = (item) => Object.hasOwn(COSMETIC_GROUP, item.kind);

const onSale = (item, now) => item.active === 1 && (item.starts === null || item.starts <= now) && (item.ends === null || item.ends > now);

/** → the item's price in coins, or 0 when it is not sold for coins. */
function priceOf(item) {
  if (Number.isInteger(item.price_coins)) return item.price_coins > 0 && (isCosmetic(item) || item.kind === "hint_bundle" || item.kind === "pack") ? item.price_coins : 0;
  return isCosmetic(item) && Object.hasOwn(COSMETIC_PRICES, item.rarity) ? COSMETIC_PRICES[item.rarity] : 0;
}

/** → the ids of today's cosmetics, for the account's date. */
async function todaysCosmetics(ctx) {
  const all = (await ctx.d.prepare("SELECT id, kind, rarity, active, starts, ends FROM items WHERE active = 1 AND kind IN ('avatar', 'prop', 'furniture')").all()).results;
  return cosmeticsOfDay(all.filter((i) => onSale(i, ctx.now)), dayKey(ctx.now, ctx.tz));
}

/** GET /api/app/shop → what is on sale now. Prices in coins are the server's; prices in money are Play's (by sku). */
export async function listShop(ctx) {
  const rows = (await ctx.d.prepare("SELECT id, kind, rarity, price_coins, sku, data, starts, ends, active FROM items WHERE active = 1 ORDER BY kind, price_coins, id").all()).results;
  const today = cosmeticsOfDay(rows.filter((i) => onSale(i, ctx.now)), dayKey(ctx.now, ctx.tz));
  return rows.filter((i) => onSale(i, ctx.now) && (!isCosmetic(i) || today.has(i.id))).map((i) => {
    let data = {};
    try { data = JSON.parse(i.data) || {}; } catch { /* shown without details */ }
    return { id: i.id, kind: i.kind, rarity: i.rarity, priceCoins: priceOf(i) || null, sku: i.sku, data, ends: i.ends, ...(isCosmetic(i) ? { ofTheDay: true } : {}) };
  });
}

/** POST /api/app/shop/buy { itemId, requestId } → { status, body }. */
export async function buy(ctx, { itemId, requestId }) {
  const { d, id, now, tz } = ctx;
  if (typeof itemId !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(itemId) || typeof requestId !== "string" || !CLIENT_ID_RE.test(requestId)) return { status: 400, body: { error: "format" } };
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
  const guards = [when.funds("coin", price)];
  if (ONCE.includes(item.kind)) guards.push({ sql: `NOT ${owned}`, binds: [id, item.id] });
  const stmts = post(d, { id: debit, account: id, delta: -price, reason: "shop", ref: requestId, day, at: now, meta: { item: item.id, kind: item.kind }, guards });
  if (hints) {
    stmts.push(...post(d, { id: newOp(), account: id, currency: "hint", delta: hints, reason: "shop", ref: requestId, day, at: now, meta: { item: item.id }, guards: [paid] }));
  } else {
    if (HIDEOUT.includes(item.kind)) { // "new hideout props" quests count an item the first time it is owned: before the row below exists
      stmts.push(...questBumps(ctx, await questDefs(ctx), day, (kind) => kind === "new_props", { sql: `${paid.sql} AND NOT ${owned}`, binds: [...paid.binds, id, item.id] }));
    }
    stmts.push(d.prepare(`INSERT INTO inventory (account_id, item_id, qty, first_at) SELECT ?, ?, 1, ? WHERE ${paid.sql} ON CONFLICT (account_id, item_id) DO UPDATE SET qty = qty + 1`).bind(id, item.id, now, ...paid.binds));
  }
  const res = await d.batch(stmts);
  if (wrote(res[0])) return { status: 200, body: { ok: true, item: item.id, spent: price, ...(hints ? { hints } : {}), state: await snapshot(ctx) } };
  if (await lineFor(d, id, "coin", "shop", requestId)) return { status: 200, body: { ok: true, duplicate: true, state: await snapshot(ctx) } }; // the same request, twice at once
  const has = ONCE.includes(item.kind) && (await d.prepare("SELECT 1 AS x FROM inventory WHERE account_id = ? AND item_id = ?").bind(id, item.id).first());
  return has ? { status: 409, body: { error: "owned" } } : { status: 402, body: { error: "insufficient", price } };
}
