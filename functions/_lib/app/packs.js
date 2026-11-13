/**
 * Packs and cards (app/docs/Stuff.xlsx "Packs"; the author's answers of 2026-11-13).
 *
 * A pack holds 5 cards. Bronze: one "5 hints" card, one Rare card, three random cards. Silver: the same with an Epic card.
 * Gold: one Rare card, one Epic card, three random cards. The Legendary timer: the 30th Bronze, 20th Silver or 10th Gold pack
 * a player opens (and every 30th, 20th, 10th after it) holds a guaranteed Legendary card in place of one random card. A random card is Common 40 %, Rare 30 %, Epic 20 %, Legendary 10 % (table pack_odds), then any
 * cosmetic of that rarity with equal chance. Cards are cosmetics (avatar items, hideout props and furniture); duplicates are
 * kept and counted, and three of a kind merge into the next variant: card -> Bronze -> Silver -> Gold -> Diamond.
 *
 * The server rolls (Workers' crypto random); the phone only shows the result. Play requires the odds to be disclosed before a
 * purchase: GET /api/app/shop publishes, for each pack, exactly the table the roll reads, with a version that names it. An
 * open must quote that version: if the odds changed since the player saw them (a new cosmetic, a new weight), the open is
 * refused with the new table and nothing is spent.
 *
 * Packs are bought in the Shop or won (Daily Reward, Noob Kit) and wait in the inventory; opening one takes it from there.
 */
import { post, when, wrote, newOp } from "./ledger.js";
import { questBumps, questDefs } from "./quests.js";
import { snapshot } from "./context.js";
import { CLIENT_ID_RE, COSMETIC_GROUP, MAX_TIER, MERGE_COUNT, VARIANTS, dayKey, legendaryDue, packOdds, randomInt, rollPack } from "./economy.js";

const ITEM_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/** → Map of pack id → its odds (economy.js packOdds) as they stand now, plus `kinds`: cosmetic id → item kind. */
export async function packTables(d) {
  const r = await d.batch([
    d.prepare("SELECT id, data FROM items WHERE kind = 'pack' ORDER BY id"),
    d.prepare("SELECT pack_id, rarity, weight FROM pack_odds"),
    d.prepare("SELECT id, kind, rarity FROM items WHERE active = 1 AND kind IN ('avatar', 'prop', 'furniture') ORDER BY id"),
  ]);
  const pool = r[2].results, kinds = new Map(pool.map((c) => [c.id, c.kind])), packs = new Map();
  for (const pack of r[0].results) {
    let data = {};
    try { data = JSON.parse(pack.data) || {}; } catch { /* a broken row is a pack of plain random cards */ }
    const weights = Object.fromEntries(r[1].results.filter((w) => w.pack_id === pack.id).map((w) => [w.rarity, w.weight]));
    packs.set(pack.id, packOdds(pack.id, data, weights, pool));
  }
  return { packs, kinds };
}

/** The odds as the Shop shows them: per cent for each rarity and each item of a random card, the guaranteed cards' items, the Legendary timer. */
export function publishedOdds(info) {
  const pct = (part, whole) => Math.round((part / whole) * 100000) / 1000;
  const sure = (rarity) => { const r = info.rarities.find((x) => x.rarity === rarity); return { rarity, items: r.items.map((item) => ({ id: item, percent: pct(1, r.items.length) })) }; };
  return {
    version: info.version,
    cards: info.cards,
    hintsCard: info.hints || 0,
    guaranteed: info.guaranteed.map(sure), // one card of exactly each of these rarities
    randomCards: info.random,
    random: info.rarities.filter((r) => r.weight > 0).map((r) => ({ rarity: r.rarity, percent: pct(r.weight, info.total), items: r.items.map((item) => ({ id: item, percent: pct(r.weight, info.total * r.items.length) })) })),
    legendaryTimer: info.legendaryEvery
      ? { every: info.legendaryEvery, ...sure("legendary"), note: `Every ${info.legendaryEvery}th pack of this kind you open holds a guaranteed Legendary card, in place of one random card.` }
      : null,
    duplicates: `Duplicates are kept. ${MERGE_COUNT} of the same card merge into its next variant: ${VARIANTS.slice(1).join(", ")}.`,
  };
}

/**
 * POST /api/app/packs/open { packId, oddsVersion, requestId } → { status, body: { ok, number, cards: [{ hints } | { item, rarity, guaranteed?, timer? }], state } }.
 * One batch: the open is recorded only if the account holds the pack; the pack leaves the inventory, the hints and the cards
 * arrive, only if that record was written. The same requestId returns the same cards and opens nothing more.
 */
export async function openPack(ctx, { packId, oddsVersion, requestId }) {
  const { d, id, now, tz } = ctx;
  if (typeof packId !== "string" || !ITEM_ID_RE.test(packId) || typeof requestId !== "string" || !CLIENT_ID_RE.test(requestId) || typeof oddsVersion !== "string") return { status: 400, body: { error: "format" } };
  const before = () => d.prepare("SELECT pack_id, result FROM pack_opens WHERE account_id = ? AND request_id = ?").bind(id, requestId).first();
  const again = async (prior) => (prior.pack_id === packId
    ? { status: 200, body: { ok: true, duplicate: true, pack: packId, cards: JSON.parse(prior.result), state: await snapshot(ctx) } }
    : { status: 409, body: { error: "request_reused" } });
  const prior = await before();
  if (prior) return again(prior);
  const { packs, kinds } = await packTables(d);
  const info = packs.get(packId);
  if (!info) return { status: 404, body: { error: "unknown_pack" } };
  if (!info.rarities.length) return { status: 409, body: { error: "empty_pool" } }; // no cosmetic exists yet: the pack stays unopened
  if (oddsVersion !== info.version) return { status: 409, body: { error: "odds_changed", odds: publishedOdds(info) } };
  const defs = await questDefs(ctx), day = dayKey(now, tz);
  const holds = "EXISTS (SELECT 1 FROM inventory i WHERE i.account_id = ? AND i.item_id = ? AND i.tier = 0 AND i.qty >= 1)";
  for (let attempt = 0; attempt < 4; attempt++) {
    // which pack of its kind this is decides the Legendary timer: the open is recorded only if that count still stands
    const opened = (await d.prepare("SELECT COUNT(*) AS n FROM pack_opens WHERE account_id = ? AND pack_id = ?").bind(id, packId).first()).n;
    const timer = legendaryDue(info, opened);
    const cards = rollPack(info, randomInt, { legendary: timer });
    const hints = cards.reduce((n, c) => n + (c.hints || 0), 0);
    const counts = new Map();
    for (const c of cards) if (c.item) counts.set(c.item, (counts.get(c.item) || 0) + 1);
    const op = newOp(), mine = when.gate("pack_opens", op);
    const stmts = [
      d.prepare(
        `INSERT INTO pack_opens (account_id, request_id, pack_id, seq, odds_version, result, at, op) SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE ${holds} AND (SELECT COUNT(*) FROM pack_opens o WHERE o.account_id = ? AND o.pack_id = ?) = ?
         ON CONFLICT (account_id, request_id) DO NOTHING RETURNING request_id`,
      ).bind(id, requestId, packId, opened + 1, info.version, JSON.stringify(cards), now, op, id, packId, id, packId, opened),
      d.prepare(`UPDATE inventory SET qty = qty - 1 WHERE account_id = ? AND item_id = ? AND tier = 0 AND ${mine.sql}`).bind(id, packId, ...mine.binds),
      ...(hints ? post(d, { id: newOp(), account: id, currency: "hint", delta: hints, reason: "pack", ref: requestId, day, at: now, meta: { pack: packId }, guards: [mine] }) : []),
      ...questBumps(ctx, defs, day, (kind) => kind === "open_pack", mine),
    ];
    for (const [item, qty] of counts) {
      if (COSMETIC_GROUP[kinds.get(item)] === "hideout") { // a hideout item never held before counts for the "new props" quests: asked before its row exists
        stmts.push(...questBumps(ctx, defs, day, (kind) => kind === "new_props", { sql: `${mine.sql} AND NOT EXISTS (SELECT 1 FROM inventory i WHERE i.account_id = ? AND i.item_id = ?)`, binds: [...mine.binds, id, item] }));
      }
      stmts.push(d.prepare(`INSERT INTO inventory (account_id, item_id, tier, qty, first_at) SELECT ?, ?, 0, ?, ? WHERE ${mine.sql} ON CONFLICT (account_id, item_id, tier) DO UPDATE SET qty = qty + excluded.qty`)
        .bind(id, item, qty, now, ...mine.binds));
    }
    const res = await d.batch(stmts);
    if (wrote(res[0])) return { status: 200, body: { ok: true, pack: packId, number: opened + 1, cards, state: await snapshot(ctx) } };
    const raced = await before(); // the same request, twice at once
    if (raced) return again(raced);
    if (!(await d.prepare(`SELECT ${holds} AS x`).bind(id, packId).first()).x) return { status: 409, body: { error: "no_pack" } };
    // another pack of this kind was opened in between: count again and roll again
  }
  return { status: 409, body: { error: "busy" } };
}

/**
 * POST /api/app/cards/merge { itemId, tier, requestId } → { status, body: { ok, item, tier (the new variant), variant, state } }.
 * Three cards of one kind and tier become one of the next tier (tier 0 the card itself, 1 Bronze ... 4 Diamond, the last).
 * The three are taken only if the account holds them, in the batch that adds the variant.
 */
export async function mergeCards(ctx, { itemId, tier = 0, requestId }) {
  const { d, id, now, tz } = ctx;
  if (typeof itemId !== "string" || !ITEM_ID_RE.test(itemId) || typeof requestId !== "string" || !CLIENT_ID_RE.test(requestId) || !Number.isInteger(tier) || tier < 0 || tier > MAX_TIER) return { status: 400, body: { error: "format" } };
  if (tier === MAX_TIER) return { status: 400, body: { error: "max_tier" } };
  const before = () => d.prepare("SELECT item_id, tier FROM card_merges WHERE account_id = ? AND request_id = ?").bind(id, requestId).first();
  const again = async (prior) => (prior.item_id === itemId && prior.tier === tier
    ? { status: 200, body: { ok: true, duplicate: true, item: itemId, tier: tier + 1, variant: VARIANTS[tier + 1], state: await snapshot(ctx) } }
    : { status: 409, body: { error: "request_reused" } });
  const prior = await before();
  if (prior) return again(prior);
  const item = await d.prepare("SELECT kind FROM items WHERE id = ?").bind(itemId).first();
  if (!item || !Object.hasOwn(COSMETIC_GROUP, item.kind)) return { status: 400, body: { error: "not_a_card" } };
  const op = newOp(), mine = when.gate("card_merges", op), day = dayKey(now, tz);
  const res = await d.batch([
    d.prepare(
      `INSERT INTO card_merges (account_id, request_id, item_id, tier, at, op) SELECT ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM inventory i WHERE i.account_id = ? AND i.item_id = ? AND i.tier = ? AND i.qty >= ?)
       ON CONFLICT (account_id, request_id) DO NOTHING RETURNING request_id`,
    ).bind(id, requestId, itemId, tier, now, op, id, itemId, tier, MERGE_COUNT),
    d.prepare(`UPDATE inventory SET qty = qty - ? WHERE account_id = ? AND item_id = ? AND tier = ? AND ${mine.sql}`).bind(MERGE_COUNT, id, itemId, tier, ...mine.binds),
    d.prepare(`INSERT INTO inventory (account_id, item_id, tier, qty, first_at) SELECT ?, ?, ?, 1, ? WHERE ${mine.sql} ON CONFLICT (account_id, item_id, tier) DO UPDATE SET qty = qty + 1`)
      .bind(id, itemId, tier + 1, now, ...mine.binds),
    ...questBumps(ctx, await questDefs(ctx), day, (kind) => kind === "merge_cards", mine),
  ]);
  if (wrote(res[0])) return { status: 200, body: { ok: true, item: itemId, tier: tier + 1, variant: VARIANTS[tier + 1], state: await snapshot(ctx) } };
  const raced = await before();
  return raced ? again(raced) : { status: 409, body: { error: "not_enough", need: MERGE_COUNT } };
}
