// POST /api/app/cards/merge { itemId, tier, requestId }  →  { ok, item, tier, variant, state }
// Three cards of one kind and tier become one of the next: tier 0 (the card) -> 1 Bronze -> 2 Silver -> 3 Gold -> 4 Diamond.
// 409 not_enough | 400 not_a_card | 400 max_tier. The same requestId never merges twice.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext } from "../../../_lib/app/context.js";
import { mergeCards } from "../../../_lib/app/packs.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-pack", max: 120, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 2048);
  if (!body) return json({ error: "format" }, 400);
  const out = await mergeCards(ctx, body);
  return json(out.body, out.status);
}
