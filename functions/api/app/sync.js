// POST /api/app/sync { events: [{ eventId, type, … }], tz }  →  { results: [{ eventId, result, … }], state }
// The phone's outbox (architecture 3.2), in order. Event types:
//   solve         { caseId, seconds, hints, at }   a closed contract; pays once per case, at the rate the SERVER has for it
//   hint_use      { caseId }                        one hint from the stock was used
//   streak_claim  { date }                          the Daily Reward for the phone's local date
//   quest_claim   { questId, periodKey? }           collects a finished quest
// result: ok | duplicate (already counted: a resend) | rejected (+ reason) | deferred (more than the per-call limit: send it
//         again). An event carries no amount, and any it carries is ignored.
import { json } from "../../_lib/auth.js";
import { readBody } from "../../_lib/db.js";
import { appContext } from "../../_lib/app/context.js";
import { runSync } from "../../_lib/app/earn.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-sync", max: 120, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 256 * 1024);
  if (!body) return json({ error: "format" }, 400);
  const out = await runSync(ctx, body);
  return json(out.body, out.status);
}
