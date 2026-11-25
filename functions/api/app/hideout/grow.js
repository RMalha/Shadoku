// POST /api/app/hideout/grow { room?, to }  →  { ok, room, size, spent, hideout, state, unlocked }
//   One more row and column for a room (room 1 when left out), bought with coins at the server's price (table hideout_sizes,
//   the same for every room): `to` must be the room's next size, at most 10. A resend of a step already bought answers
//   { ok, duplicate: true, room, size, hideout, state }.
//   400 format | 404 no_room | 409 max_size | 409 not_next { size, next } | 409 not_for_sale | 402 insufficient { price, coins } | 503 schema.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext } from "../../../_lib/app/context.js";
import { growHideout } from "../../../_lib/app/hideout.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-buy", max: 60, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 1024);
  if (!body) return json({ error: "format" }, 400);
  const out = await growHideout(ctx, body);
  return json(out.body, out.status);
}
