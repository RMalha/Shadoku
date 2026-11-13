// POST /api/app/auth/logout  →  { ok }   The phone signs out: its device is revoked, so no token that names it works again
// (a bearer token cannot be taken back any other way). The app then starts a new guest account, or signs in again.
import { json } from "../../../_lib/auth.js";
import { appContext } from "../../../_lib/app/context.js";
import { signOut } from "../../../_lib/app/accounts.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true });
  if (ctx.error) return ctx.error;
  const out = await signOut(ctx);
  return json(out.body, out.status);
}
