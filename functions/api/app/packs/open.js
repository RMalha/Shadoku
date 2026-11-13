// POST /api/app/packs/open { packId, oddsVersion, requestId }  →  { ok, pack, cards: [{ hints } | { item, rarity, guaranteed? }], state }
// Opens one pack from the inventory. The server rolls the cards; `oddsVersion` must be the version GET /api/app/shop published
// for that pack (409 odds_changed with the new table otherwise: the app shows it and asks again). The same requestId never
// opens a second pack: it returns the first result. 409 no_pack | 404 unknown_pack | 409 empty_pool.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext } from "../../../_lib/app/context.js";
import { openPack } from "../../../_lib/app/packs.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-pack", max: 120, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 2048);
  if (!body) return json({ error: "format" }, 400);
  const out = await openPack(ctx, body);
  return json(out.body, out.status);
}
