// POST /api/app/shop/buy { itemId, requestId }  →  { ok, item, spent, state }   coins for an item, at the server's price.
// 402 insufficient | 404 unknown_item | 400 not_for_coins | 409 owned | 409 request_reused. The same requestId never debits twice.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext } from "../../../_lib/app/context.js";
import { buy } from "../../../_lib/app/shop.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-buy", max: 60, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 2048);
  if (!body) return json({ error: "format" }, 400);
  const out = await buy(ctx, body);
  return json(out.body, out.status);
}
