// POST /api/app/duel/leave { match }  →  the state. The caller gives the match up: it goes to the opponent (how "left"),
//   and a ranked one counts as lost. 400 format | 403 signin_required (a guest) | 404 no_match | 503 schema.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext } from "../../../_lib/app/context.js";
import { leaveMatch } from "../../../_lib/app/duel.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 1024);
  if (!body) return json({ error: "format" }, 400);
  const out = await leaveMatch(ctx, body);
  return json(out.body, out.status);
}
