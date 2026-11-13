// POST /api/app/quests/claim { questId, periodKey? }  →  { result, reward?, state }   collects a finished quest (also a sync event).
// Progress is written only by the server, from accepted events: 409 with reason "incomplete" until the target is reached.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext, snapshot } from "../../../_lib/app/context.js";
import { claimQuest } from "../../../_lib/app/quests.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-claim", max: 120, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 1024);
  if (!body || typeof body.questId !== "string") return json({ error: "format" }, 400);
  const out = await claimQuest(ctx, body.questId, body.periodKey);
  return json({ ...out, state: await snapshot(ctx) }, out.result === "rejected" ? 409 : 200);
}
