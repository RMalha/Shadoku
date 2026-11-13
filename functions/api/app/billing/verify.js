// POST /api/app/billing/verify { sku, purchaseToken }  →  { ok, granted, finished, state }   a Play purchase, checked with Google
// by the BillingVerifier (functions/_lib/app/verifiers.js) and granted once per token. Until the real verifier is in place:
// 503 billing_unavailable, and nothing is granted. 403 signin_required for a guest. 409 token_used for another account's token.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext } from "../../../_lib/app/context.js";
import { redeem } from "../../../_lib/app/billing.js";
import { billingVerifier } from "../../../_lib/app/verifiers.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-billing", max: 30, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 8192);
  if (!body) return json({ error: "format" }, 400);
  const out = await redeem(ctx, billingVerifier(env, request), body);
  return json(out.body, out.status);
}
