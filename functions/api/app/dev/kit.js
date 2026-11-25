// POST /api/app/dev/kit  (no body)  →  { ok, kit: { catalogueAdded, coinsAdded, hintsAdded, coinsTo, hintsTo, copies }, state }
// THE TEST SERVER ONLY (functions/_lib/app/devkit.js; architecture 4.17): with DEV_KIT=1 on a localhost or Pages preview address
// it gives the calling account (bearer token, a guest too) every prop, cosmetic and pack at every tier it can have, and tops
// coins up to 100000 and hints up to 500. Anywhere else: 404 not_found, before the token or the database is read.
// `state` is the snapshot GET /api/app/wallet answers (context.js snapshot). A second call tops up again; nothing grows unbounded.
import { json } from "../../../_lib/auth.js";
import { appContext } from "../../../_lib/app/context.js";
import { grantKit, kitOn } from "../../../_lib/app/devkit.js";

export async function onRequestPost({ request, env }) {
  if (!kitOn(env, request)) return json({ error: "not_found" }, 404);
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-dev-kit", max: 30, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const out = await grantKit(ctx);
  return json(out.body, out.status);
}
