// POST /api/app/social/claim { network }  →  { result, reward?, state }   25 coins for the visit, once per network for the life
// of the account, on any device. 409 with reason "not_opened" when the card was never tapped.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext, snapshot } from "../../../_lib/app/context.js";
import { socialClaim } from "../../../_lib/app/earn.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-social", max: 30, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 1024);
  if (!body) return json({ error: "format" }, 400);
  const out = await socialClaim(ctx, body.network);
  return json({ ...out, state: await snapshot(ctx) }, out.result === "rejected" ? 409 : 200);
}
