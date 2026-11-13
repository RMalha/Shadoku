// POST /api/app/ads/claim { ticket, integrity }  →  { result, reward?, state }   the fallback when AdMob's callback is late or lost
// (architecture 4.5): the phone says the ad finished and proves it is a genuine install. The AdsVerifier decides; without one
// the answer is 503 and nothing is paid. Test builds (DEV_ADS=1, never on the production domain) are paid here directly.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext, snapshot } from "../../../_lib/app/context.js";
import { payTicket } from "../../../_lib/app/ads.js";
import { adsVerifier } from "../../../_lib/app/verifiers.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-ad-claim", max: 40, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 16 * 1024);
  if (!body || typeof body.ticket !== "string") return json({ error: "format" }, 400);
  const v = await adsVerifier(env, request).verifyClientClaim({ accountId: ctx.id, ticketId: body.ticket, integrity: body.integrity });
  if (!v || !v.ok) return v && v.error === "unconfigured" ? json({ error: "ads_unavailable" }, 503) : json({ error: "integrity" }, 403);
  const out = await payTicket(ctx.d, ctx.cfg, { ticketId: body.ticket, account: ctx.id, transactionId: v.transactionId, verified: v.verified === "dev" ? "dev" : "client", now: ctx.now });
  return json({ ...out, state: await snapshot(ctx) }, out.result === "rejected" ? 409 : 200);
}
