// GET /api/app/hideout  →  { rooms: [{ room, size, x, y, grow, name, floor, edges, layout, version, updated, next: { size, price } | null }],
//                            maxSize: 10, maxRooms, board: { min, max }, floors, edgeKinds, nameMax,
//                            newRoom: { room, price, available, needs, reason? } | null, starters, public, updated, removed? }
//   The account's hideout (a new account: room 1, an empty 4 x 4 at (0, 0)). All rooms sit on one board (x, y: a room's
//   top-left tile). Layout and edge formats and the rules: functions/_lib/app/hideout.js.
// PUT /api/app/hideout { room?, version, layout?, name?, floor?, edges? }  →  { ok, room, hideout, unlocked }
//   Saves one room (room 1 when left out) made from that room's `version`: each field sent is saved, each left out stays as it
//   is (an older app's { room?, layout, version } keeps working). 400 format | too_many | unknown_item | bad_shape | bad_tier |
//   out_of_bounds | overlap (with index, item, ...) | bad_name (reason "blocked": the word filter) | bad_floor | bad_edge | duplicate_edge | edge_shared |
//   disconnected; 404 no_room; 413 too_large; 409 not_owned { item, tier, held, placed, elsewhere }; 409 stale { room, hideout }
//   (another save came first: the server's copy wins and is in the answer). 503 schema: migrations 0005 and 0007.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext } from "../../../_lib/app/context.js";
import { getHideout, saveHideout, LAYOUT_MAX_BYTES, EDGES_MAX_BYTES } from "../../../_lib/app/hideout.js";

export async function onRequestGet({ request, env }) {
  const ctx = await appContext(request, env);
  if (ctx.error) return ctx.error;
  const out = await getHideout(ctx);
  return json(out.body, out.status);
}

export async function onRequestPut({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-hideout", max: 120, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, (LAYOUT_MAX_BYTES + EDGES_MAX_BYTES) * 2); // a layout and edges as the phone writes them (spaces, defaults) are larger than the stored ones
  if (!body) return json({ error: "format" }, 400);
  const out = await saveHideout(ctx, body);
  return json(out.body, out.status);
}
