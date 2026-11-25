// POST /api/app/hideout/rooms { requestId? }  →  { ok, room, spent, hideout, state, unlocked }
//   Buys the next room of the hideout (its number: the newest + 1) at the server's price (hideout_settings room_price), once
//   the NEWEST room is 8 x 8 or more (room_from_size). It starts 4 x 4 and grows like room 1. A resend (the same requestId,
//   or a second tap racing the first) answers { ok, duplicate: true, room, hideout, state }.
//   400 format | 409 not_yet { room, size, needs } | 409 max_rooms { max } | 402 insufficient { price, coins } | 503 schema.
import { json } from "../../../_lib/auth.js";
import { readBody } from "../../../_lib/db.js";
import { appContext } from "../../../_lib/app/context.js";
import { buyRoom } from "../../../_lib/app/hideout.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-buy", max: 60, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 1024);
  if (!body) return json({ error: "format" }, 400);
  const out = await buyRoom(ctx, body);
  return json(out.body, out.status);
}
