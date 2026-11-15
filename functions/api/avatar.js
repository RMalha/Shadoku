// PUT /api/avatar { avatar }  →  { ok, shown }   the profile's avatar: "" (S. H. Adow), "photo" (the account picture) or "L:…" (a portrait
// from the avatar maker, src/avatarLook.js). The ranking and the player's community puzzles show it at once (`shown`: what others see).
// Signed in: the site's session cookie, or the Android app's bearer token from the app's origin (functions/_lib/caller.js; not a guest).
import { setAvatar, json } from "../_lib/auth.js";
import { caller } from "../_lib/caller.js";
import { shownAvatar, setPlayerAvatar, avatarOk } from "../_lib/db.js";
import { limit } from "../_lib/ratelimit.js";

export async function onRequestPut({ request, env }) {
  const who = await caller(request, env, { write: true });
  if (who.error) return who.error;
  const { s } = who;
  const blocked = await limit(env, request, "avatar", { max: 20, windowSec: 600, id: s.id });
  if (blocked) return blocked;
  const { avatar } = (await request.json().catch(() => null)) || {};
  if (!avatarOk(avatar)) return json({ error: "format" }, 400);
  await setAvatar(env, s.id, avatar);
  const shown = shownAvatar(avatar, s);
  await setPlayerAvatar(env, s.id, shown);
  return json({ ok: true, shown });
}
