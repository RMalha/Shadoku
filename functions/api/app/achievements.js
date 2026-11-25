// GET /api/app/achievements  →  { achievements: [{ id, achievement, group, tier, tiers, target, progress, done, doneAt, reward, live, waits? }],
//                                 badges: [{ achievement, tier, material, at }], materials, unlocked }
// Every achievement, one entry per tier, and the badges earned (functions/_lib/app/achievements.js). It first unlocks whatever
// the account has reached and not yet been given (a catch-up: normally nothing), and lists that in `unlocked`. 503 schema: migration 0006.
import { json } from "../../_lib/auth.js";
import { appContext } from "../../_lib/app/context.js";
import { listAchievements } from "../../_lib/app/achievements.js";

export async function onRequestGet({ request, env }) {
  const ctx = await appContext(request, env, { rate: { name: "app-achievements", max: 120, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const out = await listAchievements(ctx);
  return json(out.body, out.status);
}
