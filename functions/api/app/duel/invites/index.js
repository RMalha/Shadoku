// GET  /api/app/duel/invites         →  { incoming, outgoing }: the open friendly invitations to and from the caller
// POST /api/app/duel/invites { to }  →  { ok, invite, duplicate? }: the caller invites the account `to` to a friendly match
//   (unranked). The invitation is what the invited player's Inbox shows; open for a day. Entering its room is
//   POST /api/app/duel/queue { invite }; the match starts when both are in it.
//   400 format | 400 self | 403 signin_required (a guest) | 404 no_account | 503 schema.
import { json } from "../../../../_lib/auth.js";
import { readBody } from "../../../../_lib/db.js";
import { appContext } from "../../../../_lib/app/context.js";
import { createInvite, listInvites } from "../../../../_lib/app/duel.js";

export async function onRequestGet({ request, env }) {
  const ctx = await appContext(request, env);
  if (ctx.error) return ctx.error;
  const out = await listInvites(ctx);
  return json(out.body, out.status);
}

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-duel-invite", max: 20, windowSec: 3600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 1024);
  if (!body) return json({ error: "format" }, 400);
  const out = await createInvite(ctx, body);
  return json(out.body, out.status);
}
