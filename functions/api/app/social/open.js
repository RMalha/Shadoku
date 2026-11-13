// POST /api/app/social/open { network: "facebook" | "instagram" | "tiktok" }  →  { result }   the player tapped the card; the app
// then opens the page. The reward (social/claim) is for this visit: the server never asks whether anyone liked or followed.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext } from "../../../_lib/app/context.js";
import { socialOpen } from "../../../_lib/app/earn.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-social", max: 30, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 1024);
  if (!body) return json({ error: "format" }, 400);
  const out = await socialOpen(ctx, body.network);
  return json(out, out.result === "rejected" ? 400 : 200);
}
