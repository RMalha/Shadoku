// POST /api/app/auth/refresh { appVersion? }  →  { token, expires, account, device }
// Renews the phone's bearer token (the app does it on launch once the token is past half its life). The token sent may have run
// out up to a year ago: what decides is its device row, which a sign-out revokes and a later sign-in on the phone moves to
// another account. 401 "auth" | "revoked", 403 "banned", 409 "merged" { into } (a guest that signed in: use the token that sign-in gave).
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appDoor } from "../../../_lib/app/context.js";
import { refresh } from "../../../_lib/app/accounts.js";

export async function onRequestPost({ request, env }) {
  const door = await appDoor(request, env, { rate: { name: "app-refresh-ip", max: 120, windowSec: 600 } });
  if (door.error) return door.error;
  const out = await refresh(door, request, (await readBody(request, 1024)) || {});
  return out.response || json(out.body, out.status);
}
