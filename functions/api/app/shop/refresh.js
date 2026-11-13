// POST /api/app/shop/refresh { itemId, ticket? }  →  { ok, shelf, item (the new cosmetic), replaced, how, state }
// Swaps one of the player's cosmetics of the day for another of the same group and rarity. Free once a day (one item); after
// that each swap spends a paid "shop_refresh" ad ticket (POST /api/app/ads/ticket, then the ad), as often as the player likes.
// 404 not_today | 409 no_other_item | 409 free_used (watch an ad) | 409 ticket (not paid, already spent, or not yours).
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext } from "../../../_lib/app/context.js";
import { refreshShelf } from "../../../_lib/app/shop.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-shop-refresh", max: 120, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 1024);
  if (!body) return json({ error: "format" }, 400);
  const out = await refreshShelf(ctx, body);
  return json(out.body, out.status);
}
