/**
 * The tester kit (architecture 4.17): POST /api/app/dev/kit gives the calling account everything, so the app can be tried on a
 * phone with every prop, cosmetic and pack, and coins and hints to spend on growing the hideout, rooms, packs and the Shop.
 *
 * ONLY ON THE TEST SERVER: env.DEV_KIT === "1" AND a localhost or Pages preview address (verifiers.js devHost). Anywhere else
 * the endpoint answers 404 as if it did not exist, before it reads a token or the database. The test server is the Pages
 * preview environment (wrangler.toml [env.preview]): its own D1 database ("shadoku-test") and KV namespace, so nothing here
 * ever reaches a real account or the production economy.
 *
 * What one call does, in ONE db.batch (atomic):
 *   1. the catalogue: every hideout prop of hideout_props.js and every avatar cosmetic of src/avatarCosmeticsList.js that has a
 *      card rarity (common .. legendary) gets its `items` row if it has none (kind "prop" / "avatar", priced by rarity like any
 *      cosmetic). The real cosmetic rows "come with their art" and are not seeded by any migration yet; without them a pack
 *      cannot be opened (409 empty_pool) and the Shop has no cosmetics of the day. A row that exists is left as it is. The
 *      starting set (unlimited, never a card) and the achievements' unique items (migration 0006) are not added here.
 *   2. the inventory, topped up to the kit's count (qty = MAX(held, kit): an account that holds more keeps what it holds):
 *        hideout props (kind prop / furniture)   KIT_PROPS copies of the card and of each variant (tiers 0-4): props are counted
 *                                                across all the rooms together, so this furnishes every room
 *        avatar cosmetics                        KIT_AVATAR of each tier (0-4)
 *        unique items (achievement rewards)      tier 0 only (they have no variants): KIT_PROPS of a prop, KIT_AVATAR of an avatar item
 *        packs                                   KIT_PACKS of each, unopened (tier 0)
 *      Every active `items` row of those kinds counts, so a cosmetic added to the catalogue later is in the next kit.
 *      Not given: entitlements (No ads, the memberships) and the once-only Noob Kit, so buying them can still be tried.
 *   3. coins up to KIT_COINS and hints up to KIT_HINTS, through ledger.js (postFrom: the database works out the difference
 *      inside the batch, and a balance already at or above the mark writes no line). reason "dev_kit", ref the call's own op id.
 * A second call tops up the same way: nothing grows without bound.
 *
 * → { ok: true, kit: { catalogueAdded, coinsAdded, hintsAdded, coinsTo, hintsTo, copies: { props, avatar, packs } }, state }
 *   `state` is context.js snapshot(), the shape GET /api/app/wallet, /sync and every purchase answer carry.
 */
import { HIDEOUT_PROPS } from "./hideout_props.js";
import AVATAR_COSMETICS from "../../../src/avatarCosmeticsList.js";
import { postFrom, newOp } from "./ledger.js";
import { snapshot } from "./context.js";
import { devHost } from "./verifiers.js";
import { COSMETIC_PRICES, MAX_TIER, dayKey } from "./economy.js";

export const KIT_COINS = 100000;
export const KIT_HINTS = 500;
export const KIT_PROPS = 10;
export const KIT_AVATAR = 1;
export const KIT_PACKS = 20;
export const KIT_REASON = "dev_kit";

/** → true when the kit exists for this request: the flag AND a test address. */
export const kitOn = (env, request) => env.DEV_KIT === "1" && devHost(request);

const CARD = (rarity) => Object.hasOwn(COSMETIC_PRICES, rarity);

/** The cosmetic rows the kit makes sure exist: [id, kind, rarity]. */
export const KIT_CATALOGUE = Object.freeze([
  ...Object.entries(HIDEOUT_PROPS.props).filter(([, p]) => CARD(p.rarity)).map(([id, p]) => [id, "prop", p.rarity]),
  ...AVATAR_COSMETICS.filter((c) => CARD(c[3])).map((c) => [c[0], "avatar", c[3]]),
]);

const TIERS = Array.from({ length: MAX_TIER + 1 }, (_, t) => `SELECT ${t} AS tier`).join(" UNION ALL ");

/** POST /api/app/dev/kit (after kitOn and appContext) → { status, body }. */
export async function grantKit(ctx) {
  const { d, id, now, tz } = ctx;
  const day = dayKey(now, tz), op = newOp(), meta = { kit: 1 };
  const topUp = (currency, column, to) => postFrom(d, {
    id: newOp(), account: id, currency, reason: KIT_REASON, ref: op, day, at: now, meta,
    amount: { sql: `SELECT ? - k.${column} FROM wallets k WHERE k.account_id = ? AND k.${column} < ?`, binds: [to, id, to] },
  });
  const coins = topUp("coin", "coins", KIT_COINS), hints = topUp("hint", "hints", KIT_HINTS);
  const res = await d.batch([
    d.prepare(
      `INSERT INTO items (id, kind, rarity, data) SELECT json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'), '{"seed":"dev_kit"}'
       FROM json_each(?) j WHERE true ON CONFLICT (id) DO NOTHING`,
    ).bind(JSON.stringify(KIT_CATALOGUE)),
    d.prepare(
      `INSERT INTO inventory (account_id, item_id, tier, qty, first_at)
       SELECT ?, i.id, t.tier, CASE WHEN i.kind = 'pack' THEN ? WHEN i.kind = 'avatar' THEN ? ELSE ? END, ?
       FROM items i, (${TIERS}) t
       WHERE i.active = 1 AND i.kind IN ('prop', 'furniture', 'avatar', 'pack')
         AND (t.tier = 0 OR (i.kind <> 'pack' AND i.rarity IN ('common', 'rare', 'epic', 'legendary')))
       ON CONFLICT (account_id, item_id, tier) DO UPDATE SET qty = MAX(inventory.qty, excluded.qty)`,
    ).bind(id, KIT_PACKS, KIT_AVATAR, KIT_PROPS, now),
    ...coins,
    ...hints,
  ]);
  const added = (r) => (r && r.results && r.results[0] ? r.results[0].delta : 0);
  return {
    status: 200,
    body: {
      ok: true,
      kit: {
        catalogueAdded: (res[0].meta && res[0].meta.changes) || 0,
        coinsAdded: added(res[2]),
        hintsAdded: added(res[2 + coins.length]),
        coinsTo: KIT_COINS,
        hintsTo: KIT_HINTS,
        copies: { props: KIT_PROPS, avatar: KIT_AVATAR, packs: KIT_PACKS },
      },
      state: await snapshot(ctx),
    },
  };
}
