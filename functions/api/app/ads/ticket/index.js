// POST /api/app/ads/ticket { placement: "coins" | "hint" | "quest_refresh" }  →  { ticket, placement, reward }   before a rewarded ad is shown.
// 409 cap: today's coin ads are used up (3 a day): the app shows no ad. The ticket itself is worth nothing until a verifier pays it.
import { json } from "../../../../_lib/auth.js";
import { readBody } from "../../../../_lib/db.js";
import { appContext } from "../../../../_lib/app/context.js";
import { createTicket } from "../../../../_lib/app/ads.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-ad-ticket", max: 40, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 1024);
  if (!body) return json({ error: "format" }, 400);
  const out = await createTicket(ctx, body.placement);
  return json(out.body, out.status);
}
