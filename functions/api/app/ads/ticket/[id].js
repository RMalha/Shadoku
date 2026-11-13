// GET /api/app/ads/ticket/:id  →  { ticket, placement, paid, verified }   the app polls its own ticket after the ad.
import { json } from "../../../../_lib/auth.js";
import { appContext } from "../../../../_lib/app/context.js";
import { readTicket } from "../../../../_lib/app/ads.js";

export async function onRequestGet({ request, env, params }) {
  const ctx = await appContext(request, env);
  if (ctx.error) return ctx.error;
  const out = await readTicket(ctx, params.id);
  return json(out.body, out.status);
}
