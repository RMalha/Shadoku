// POST /api/app/auth/dev { name, leaveGuest?, installId?, appVersion? }  →  { token, expires, account, device, merge }   LOCAL TESTING ONLY
// Signs the phone (or the app's browser build) in as the test player "dev:<name>", the same account /api/auth/dev/login gives a
// browser: the whole sign-in path, guest merge included, without Google. Works only with DEV_LOGIN=1 AND on localhost; anywhere
// else it answers 404.
import { json } from "../../../_lib/auth.js";
import { appDoor } from "../../../_lib/app/context.js";
import { signInRequest } from "../../../_lib/app/accounts.js";

export async function onRequestPost({ request, env }) {
  if (env.DEV_LOGIN !== "1") return json({ error: "not_found" }, 404);
  const door = await appDoor(request, env, { rate: { name: "app-signin", max: 30, windowSec: 600 } });
  if (door.error) return door.error;
  const out = await signInRequest(door, request, "dev");
  return out.status === 503 ? json({ error: "not_found" }, 404) : json(out.body, out.status);
}
