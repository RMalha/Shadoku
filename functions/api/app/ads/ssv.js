// GET /api/app/ads/ssv?…&signature=…&key_id=…  →  AdMob's server-side verification callback (public: Google calls it, no session).
// The AdsVerifier (functions/_lib/app/verifiers.js) checks the signature; until the real one is in place every call is refused
// with 503 and pays nothing. A verified callback names the ticket (custom_data) and the account (user_id); the reward is the
// server's own (AdMob's reward_amount is never read) and a transaction id pays once.
import { json } from "../../../_lib/auth.js";
import { db } from "../../../_lib/db.js";
import { clock } from "../../../_lib/app/context.js";
import { payTicket } from "../../../_lib/app/ads.js";
import { adsVerifier } from "../../../_lib/app/verifiers.js";
import { parseConfig } from "../../../_lib/app/economy.js";

export async function onRequestGet({ request, env }) {
  const v = await adsVerifier(env, request).verifyCallback(new URL(request.url));
  if (!v || !v.ok) return v && v.error === "unconfigured" ? json({ error: "ads_unavailable" }, 503) : json({ error: "signature" }, 403);
  const d = await db(env);
  if (!d) return json({ error: "storage" }, 503);
  const cfg = parseConfig((await d.prepare("SELECT k, v FROM app_config").all()).results);
  const out = await payTicket(d, cfg, { ticketId: v.ticketId, account: v.userId, transactionId: v.transactionId, adUnit: v.adUnit, verified: "ssv", now: clock(env) });
  return json({ ok: true, result: out.result }); // 200 for anything correctly signed, paid or not: Google retries every other answer
}
