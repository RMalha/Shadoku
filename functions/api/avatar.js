// PUT /api/avatar { avatar }  →  { ok, shown }   the profile's avatar: "" (S. H. Adow), "photo" (the account picture) or "L:…" (a portrait
// from the avatar maker, src/avatarLook.js). The ranking and the player's community puzzles show it at once (`shown`: what others see).
import { readSession, setAvatar, json, sameOrigin } from "../_lib/auth.js";
import { shownAvatar, setPlayerAvatar, AVATAR_RE } from "../_lib/db.js";

export async function onRequestPut({ request, env }) {
  if (!sameOrigin(request, env)) return json({ error: "origin" }, 403);
  const s = await readSession(request, env);
  if (!s) return json({ error: "auth" }, 401);
  const { avatar } = await request.json().catch(() => ({}));
  if (typeof avatar !== "string" || !AVATAR_RE.test(avatar)) return json({ error: "format" }, 400);
  await setAvatar(env, s.id, avatar);
  const shown = shownAvatar(avatar, s);
  await setPlayerAvatar(env, s.id, shown);
  return json({ ok: true, shown });
}
