// POST /api/app/devices { fcmToken?, appVersion? }  →  { ok }   The phone's push token (FCM) and app version, kept on the device
// row its bearer token names. An empty fcmToken forgets it (notifications switched off).
import { json } from "../../_lib/auth.js";
import { readBody } from "../../_lib/db.js";
import { appContext } from "../../_lib/app/context.js";
import { noteDevice } from "../../_lib/app/accounts.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-device", max: 30, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 8192);
  if (!body) return json({ error: "format" }, 400);
  const out = await noteDevice(ctx, body);
  return json(out.body, out.status);
}
