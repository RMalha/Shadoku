// GET /api/app/hideout  →  { rooms: [{ room, size, layout, version, updated, next: { size, price } | null }], maxSize: 10, maxRooms,
//                            newRoom: { room, price, available, needs, reason? } | null, starters, public, updated, removed? }
//   The account's hideout (a new account: room 1, an empty 4 x 4). Layout format and rules: functions/_lib/app/hideout.js.
// PUT /api/app/hideout { room?, layout, version }  →  { ok, room, hideout, unlocked }
//   Saves one room's layout made from that room's `version` (room 1 when left out). 400 format | too_many | unknown_item |
//   bad_shape | bad_tier | out_of_bounds | overlap (with index, item, ...); 404 no_room; 413 too_large;
//   409 not_owned { item, tier, held, placed, elsewhere }; 409 stale { room, hideout } (another save of the room came first:
//   the server's copy wins and is in the answer). 503 schema: migration 0005.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext } from "../../../_lib/app/context.js";
import { getHideout, saveHideout, LAYOUT_MAX_BYTES } from "../../../_lib/app/hideout.js";

export async function onRequestGet({ request, env }) {
  const ctx = await appContext(request, env);
  if (ctx.error) return ctx.error;
  const out = await getHideout(ctx);
  return json(out.body, out.status);
}

export async function onRequestPut({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-hideout", max: 120, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, LAYOUT_MAX_BYTES * 2); // a layout as the phone writes it (spaces, defaults) is larger than the stored one
  if (!body) return json({ error: "format" }, 400);
  const out = await saveHideout(ctx, body);
  return json(out.body, out.status);
}
