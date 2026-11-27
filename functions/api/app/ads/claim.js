// POST /api/app/ads/claim { ticket, integrity }  →  { result, reward?, state }   the fallback when AdMob's callback is late or lost
// (architecture 4.5): 10 seconds after the ad's "rewarded" event with the ticket still unpaid, the phone says the ad finished and
// sends a Play Integrity token made for this ticket (integrity.js integrityHash("ad_claim", ticket)). 409 early { retryInMs }: too
// soon after the ticket was made. The token is observed, not enforced: a verdict that is not a pass is flagged and the claim
// still stands, a few a day at most. Without an AdsVerifier the answer is 503 and nothing is paid. Test builds (DEV_ADS=1, never
// on the production domain) are paid here directly.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext } from "../../../_lib/app/context.js";
import { claimTicket } from "../../../_lib/app/ads.js";
import { adsVerifier } from "../../../_lib/app/verifiers.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-ad-claim", max: 40, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 16 * 1024);
  if (!body || typeof body.ticket !== "string") return json({ error: "format" }, 400);
  const out = await claimTicket(ctx, adsVerifier(env, request), { ticket: body.ticket, integrity: body.integrity });
  return json(out.body, out.status);
}
