// POST /api/app/billing/rtdn  →  Google's Real-time Developer Notifications (public: Pub/Sub calls it, no session).
// The BillingVerifier authenticates the message and lists the refunded or revoked purchases; each is taken back once
// (functions/_lib/app/billing.js voidPurchase). Until the real verifier is in place: 503, and nothing changes.
import { json } from "../../../_lib/auth.js";
import { db } from "../../../_lib/db.js";
import { clock } from "../../../_lib/app/context.js";
import { voidPurchase } from "../../../_lib/app/billing.js";
import { billingVerifier } from "../../../_lib/app/verifiers.js";

export async function onRequestPost({ request, env }) {
  const note = await billingVerifier(env, request).readNotification(request);
  if (!note || !note.ok) return note && note.error === "unconfigured" ? json({ error: "billing_unavailable" }, 503) : json({ error: "auth" }, 403);
  const d = await db(env);
  if (!d) return json({ error: "storage" }, 503);
  const results = [];
  for (const v of note.voided.slice(0, 50)) results.push(await voidPurchase(d, v.purchaseToken, clock(env)));
  return json({ ok: true, results });
}
