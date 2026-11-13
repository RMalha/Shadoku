// GET /api/app/shop  →  { items: [{ id, kind, rarity, priceCoins, sku, data, ends }] }   what is on sale now.
import { json } from "../../../_lib/auth.js";
import { appContext } from "../../../_lib/app/context.js";
import { listShop } from "../../../_lib/app/shop.js";

export async function onRequestGet({ request, env }) {
  const ctx = await appContext(request, env);
  if (ctx.error) return ctx.error;
  return json({ items: await listShop(ctx) });
}
