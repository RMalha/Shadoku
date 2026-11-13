// POST /api/app/auth/guest { installId?, appVersion?, tz?, birthYear? }  →  { token, expires, account: { id, kind: "guest", provider }, device }
// The app's first launch, silently: a new guest account ("guest:<uuid>"), this phone's device row and its bearer token (30 days,
// renewed by POST /api/app/auth/refresh). A guest plays, earns and spends coins at once; real-money purchases and everything
// with other players wait for a sign-in (functions/_lib/app/accounts.js: what the guest keeps then). No cookie is read or set.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appDoor } from "../../../_lib/app/context.js";
import { createGuest } from "../../../_lib/app/accounts.js";

export async function onRequestPost({ request, env }) {
  const door = await appDoor(request, env);
  if (door.error) return door.error;
  const body = await readBody(request, 2048);
  if (!body) return json({ error: "format" }, 400);
  const out = await createGuest(door, request, body);
  return out.response || json(out.body, out.status);
}
