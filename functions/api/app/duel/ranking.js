// GET /api/app/duel/ranking  ->  { players: [{ rank, name, avatar, rating, played, wins, losses, draws, me }], me, total }
//   The 1v1 ladder (ranked matches only): the top 50 by rating, and the caller's own row with its true place (null before its first ranked match).
//   No account id in any row. 403 signin_required (a guest) | 503 schema.
import { json } from "../../../_lib/auth.js";
import { appContext } from "../../../_lib/app/context.js";
import { duelRanking } from "../../../_lib/app/duel.js";

export async function onRequestGet({ request, env }) {
  const ctx = await appContext(request, env);
  if (ctx.error) return ctx.error;
  const out = await duelRanking(ctx);
  return json(out.body, out.status);
}
