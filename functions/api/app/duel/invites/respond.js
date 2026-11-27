// POST /api/app/duel/invites/respond { id, action: "decline" | "cancel" }  →  { ok, invite }
//   The invited player declines, or the inviter takes the invitation back.
//   400 format | 403 signin_required (a guest) | 404 no_invite | 409 invite_closed | 503 schema.
import { json } from "../../../../_lib/auth.js";
import { readBody } from "../../../../_lib/db.js";
import { appContext } from "../../../../_lib/app/context.js";
import { respondInvite } from "../../../../_lib/app/duel.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 1024);
  if (!body) return json({ error: "format" }, 400);
  const out = await respondInvite(ctx, body);
  return json(out.body, out.status);
}
