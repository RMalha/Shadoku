// POST /api/cron/retention?task=expired|backfill|inactive|duels|voided[&limit=n][&dry=1]  →  { ok, task, … }
// The nightly housekeeping the privacy policy promises (functions/_lib/retention.js has the periods): one task per call.
//   expired    rows past their date go (error reports, signed-out phones, ad and anti-cheat records, …)        → { deleted: { table: rows } }
//   backfill   accounts with no "last seen" row yet get one, so their 12 months can start                    → { app, site, truncated }
//   inactive   accounts not seen for 12 months are deleted, at most `limit` (1 to 25, default 1) per call    → { erased, corrected, more }
//   duels      1v1 matches nobody came back to are brought up to now, so they end and their ratings settle (duel.js)  → { due, closed }
//   voided     Google Play's list of refunded and revoked purchases is compared with ours; each is taken back once (billing.js sweepVoided)
//              → { listed, due, voided, more }, or { skipped: "billing_unavailable" } while Play billing is not set up
// `dry=1` counts and deletes nothing. No answer ever names an account.
// Called by the Worker in tools/cloud/retention with `Authorization: Bearer <CRON_SECRET>` (a Pages secret of 32+ characters).
// Without the secret set the endpoint does not exist for anybody: 503. It reads no cookie and no app token.
import { json, sha256b64u } from "../../_lib/auth.js";
import { clock } from "../../_lib/app/context.js";
import { sweepExpired, backfillSeen, eraseInactive } from "../../_lib/retention.js";
import { sweepDuels } from "../../_lib/app/duel.js";
import { sweepVoided } from "../../_lib/app/billing.js";
import { billingVerifier } from "../../_lib/app/verifiers.js";
import { db } from "../../_lib/db.js";

export async function onRequestPost({ request, env }) {
  const secret = typeof env.CRON_SECRET === "string" ? env.CRON_SECRET : "";
  if (secret.length < 32) return json({ error: "unconfigured" }, 503);
  const m = /^Bearer (.{1,400})$/.exec(request.headers.get("Authorization") || "");
  // compared as hashes: the time it takes says nothing about the secret
  if (!m || (await sha256b64u(`cron|${m[1]}`)) !== (await sha256b64u(`cron|${secret}`))) return json({ error: "auth" }, 401);
  const url = new URL(request.url), task = url.searchParams.get("task"), dry = url.searchParams.get("dry") === "1", now = clock(env);
  if (task === "expired") return json({ ok: true, task, dry, deleted: await sweepExpired(env, { now, dry }) });
  if (task === "backfill") return json({ ok: true, task, ...(dry ? { skipped: true } : await backfillSeen(env, { now })) });
  if (task === "inactive") {
    const limit = Math.min(25, Math.max(1, parseInt(url.searchParams.get("limit") || "1", 10) || 1));
    const out = await eraseInactive(env, { now, limit, dry });
    console.log(JSON.stringify({ at: "retention", task, dry, erased: out.erased, corrected: out.corrected, more: out.more }));
    return json({ ok: true, task, dry, ...out });
  }
  if (task === "duels") return json({ ok: true, task, dry, ...(await sweepDuels(env, { now, limit: 20, dry })) });
  if (task === "voided") {
    const d = await db(env);
    if (!d) return json({ error: "storage" }, 503);
    const out = await sweepVoided(d, billingVerifier(env, request), { now, dry });
    if (out.error === "unconfigured") return json({ ok: true, task, dry, skipped: "billing_unavailable" }); // nothing is sold yet: nothing to compare
    if (out.error) return json({ error: out.error }, 502);
    console.log(JSON.stringify({ at: "retention", task, dry, listed: out.listed, due: out.due, voided: out.voided, more: out.more }));
    return json({ ok: true, task, dry, ...out });
  }
  return json({ error: "format" }, 400);
}
