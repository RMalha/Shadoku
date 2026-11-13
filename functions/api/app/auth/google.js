// POST /api/app/auth/google { idToken, leaveGuest?, installId?, appVersion? }  →  { token, expires, account, device, merge }
// "Sign in with Google" on the phone (Android Credential Manager, asked for with the site's own web client id): the ID token is
// checked against Google's keys (functions/_lib/app/identity.js) and the phone is signed in to "google:<sub>", the account the
// website knows. Sent with the phone's current token (Authorization: Bearer): a guest's things come along
// (functions/_lib/app/accounts.js mergeGuest). 409 "guest_progress" { guest }: the account has its own history and the guest's
// coins, hints and cards would stay behind; send again with leaveGuest: true once the player agreed.
// 503 "signin_unavailable": GOOGLE_CLIENT_ID is not set. No cookie is read or set.
import { json } from "../../../_lib/auth.js";
import { appDoor } from "../../../_lib/app/context.js";
import { signInRequest } from "../../../_lib/app/accounts.js";

export async function onRequestPost({ request, env }) {
  const door = await appDoor(request, env, { rate: { name: "app-signin", max: 30, windowSec: 600 } });
  if (door.error) return door.error;
  const out = await signInRequest(door, request, "google");
  return json(out.body, out.status);
}
