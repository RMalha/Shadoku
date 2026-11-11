// PUT /api/avatar { avatar }  →  { ok, shown }   the profile's avatar: "" (S. H. Adow), "photo" (the account picture) or "L:…" (a portrait
// from the avatar maker, src/avatarLook.js). The ranking and the player's community puzzles show it at once (`shown`: what others see).
import { readSession, setAvatar, json, sameOrigin } from "../_lib/auth.js";
import { shownAvatar, setPlayerAvatar, avatarOk } from "../_lib/db.js";
import { limit } from "../_lib/ratelimit.js";

export async function onRequestPut({ request, env }) {
  if (!sameOrigin(request, env)) return json({ error: "origin" }, 403);
  const s = await readSession(request, env);
  if (!s) return json({ error: "auth" }, 401);
  const blocked = await limit(env, request, "avatar", { max: 20, windowSec: 600, id: s.id });
  if (blocked) return blocked;
  const { avatar } = (await request.json().catch(() => null)) || {};
  if (!avatarOk(avatar)) return json({ error: "format" }, 400);
  await setAvatar(env, s.id, avatar);
  const shown = shownAvatar(avatar, s);
  await setPlayerAvatar(env, s.id, shown);
  return json({ ok: true, shown });
}
