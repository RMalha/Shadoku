// POST /api/app/quests/refresh { questId, ticket? }  →  { result, questId (the new quest), replaced, slot, how, state }
// Swaps one of the player's unfinished quests for another. Free once a day for a daily quest and once a day for a weekly quest;
// after that each refresh spends a paid "quest_refresh" ad ticket (POST /api/app/ads/ticket, then the ad).
// 409 with reason free_used (watch an ad) | ticket (not paid, already spent, or not yours) | complete (collect it instead)
//   | claimed | not_dealt | no_other_quest.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext, snapshot } from "../../../_lib/app/context.js";
import { refreshQuest } from "../../../_lib/app/quests.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-claim", max: 120, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 1024);
  if (!body || typeof body.questId !== "string") return json({ error: "format" }, 400);
  const out = await refreshQuest(ctx, body.questId, body.ticket);
  return json({ ...out, state: await snapshot(ctx) }, out.result === "rejected" ? 409 : 200);
}
