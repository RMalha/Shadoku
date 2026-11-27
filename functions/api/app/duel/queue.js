// POST   /api/app/duel/queue { invite? }  →  the state: the caller waits for an opponent (the ranked queue), or in the room
//        of a friendly invitation it sent or received. Up to a minute: by Elo, then anyone, then a bot (never in a room).
//        409 in_match | 503 no_boards | 404 no_invite | 409 invite_closed.
// DELETE /api/app/duel/queue             →  the state: the caller stops waiting.
//   400 format | 403 signin_required (a guest) | 503 schema.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext } from "../../../_lib/app/context.js";
import { joinQueue, leaveQueue } from "../../../_lib/app/duel.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-duel-queue", max: 60, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 1024);
  if (!body) return json({ error: "format" }, 400);
  const out = await joinQueue(ctx, body);
  return json(out.body, out.status);
}

export async function onRequestDelete({ request, env }) {
  const ctx = await appContext(request, env, { write: true });
  if (ctx.error) return ctx.error;
  const out = await leaveQueue(ctx);
  return json(out.body, out.status);
}
