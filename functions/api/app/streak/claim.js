// POST /api/app/streak/claim { date: "YYYY-MM-DD" }  →  { result, reward?, current?, cycleDay?, state }   the Daily Reward for the
// phone's local date (also a sync event). The date must be within a day of the server's and after the last one claimed.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext, snapshot } from "../../../_lib/app/context.js";
import { claimStreak } from "../../../_lib/app/earn.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-claim", max: 120, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 1024);
  if (!body) return json({ error: "format" }, 400);
  const out = await claimStreak(ctx, body.date);
  return json({ ...out, state: await snapshot(ctx) }, out.result === "rejected" ? 409 : 200);
}
