// POST /api/app/duel/events { match, events: [{ seq, board, id, cell }] }  →  { results, ...state }
//   The caller's placements on the board being played: `id` a piece ("A" ... or "S"), `cell` [row, column] from 0, or null to
//   take it off. `seq` counts the caller's events in this match from 1. Each is applied once, in order, at the server's time:
//   results[i] is ok | duplicate | gap | late | early | too_many | bad (functions/_lib/app/duel.js postEvents). "ok" never
//   says a placement is right. At most 20 events a call.
//   400 format | 403 signin_required (a guest) | 404 no_match | 503 schema.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext } from "../../../_lib/app/context.js";
import { postEvents } from "../../../_lib/app/duel.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 4096);
  if (!body) return json({ error: "format" }, 400);
  const out = await postEvents(ctx, body);
  return json(out.body, out.status);
}
