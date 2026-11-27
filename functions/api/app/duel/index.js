// GET /api/app/duel[?match=<id>][&have=<n>]  →  the caller's 1v1 state (functions/_lib/app/duel.js `view`; architecture 4.20)
//   The poll: about once a second while waiting or playing. Without `match`: the live match, else the place in the queue
//   (this call is also what gives a waiting player its opponent, or after a minute its bot), else "idle". With `match`: that
//   match of the caller's, also once it is over. `have`: the highest board (1-3) whose case the phone already holds.
//   No rate limit of its own: a counter would be one more database write per poll. It writes only every few seconds.
//   400 format | 403 signin_required (a guest) | 404 no_match | 503 schema.
import { json } from "../../../_lib/auth.js";
import { appContext } from "../../../_lib/app/context.js";
import { duelState } from "../../../_lib/app/duel.js";

export async function onRequestGet({ request, env }) {
  const ctx = await appContext(request, env);
  if (ctx.error) return ctx.error;
  const q = new URL(request.url).searchParams, have = parseInt(q.get("have") || "0", 10);
  const out = await duelState(ctx, { matchId: q.get("match"), have: have >= 0 && have <= 3 ? have : 0 });
  return json(out.body, out.status);
}
