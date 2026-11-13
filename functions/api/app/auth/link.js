// POST /api/app/auth/link { provider: "google", idToken }  →  { ok, signIns: [providers] }
// A signed-in player adds a second sign-in to the account (Profile > Linked accounts): from then on it opens this account in the
// app. Only a sign-in that has no account of its own can be linked; accounts are never merged here.
// 409 "guest" (sign in instead) | "has_account" | "linked_elsewhere" | "provider_linked".  (provider "dev": local testing, { name }.)
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext } from "../../../_lib/app/context.js";
import { linkIdentity } from "../../../_lib/app/accounts.js";
import { verifyIdentity, IDENTITY_FAIL } from "../../../_lib/app/identity.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-link", max: 20, windowSec: 3600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 8192);
  if (!body || typeof body.provider !== "string") return json({ error: "format" }, 400);
  const who = await verifyIdentity(env, request, body.provider, body);
  if (!who.ok) return json({ error: who.error === "unconfigured" ? "signin_unavailable" : who.error }, IDENTITY_FAIL[who.error]);
  const out = await linkIdentity(ctx, who);
  return json(out.body, out.status);
}
