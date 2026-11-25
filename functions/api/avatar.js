// The profile's avatar, shared by the website and the Android app: one avatar per account (the author, 2026-11-25: the server's copy
// is the truth, edited on either side). Signed in: the site's session cookie, or the app's bearer token from the app's origin
// (functions/_lib/caller.js; a guest of the app gets 403 signin_required, as on every shared endpoint).
//
//   GET /api/avatar               → { avatar, updated, cosmetics }
//       avatar     "" (S. H. Adow), "photo" (the account picture) or an "L:" code (format v2: src/avatarCosmetics.js)
//       updated    when it was last saved (epoch ms; 0 = never saved)
//       cosmetics  the avatar cosmetics the account holds: { "<cosmetic id>": [tiers held] } (0 = the card as won, 1-4 Bronze,
//                  Silver, Gold, Shadow), read from the app's inventory: what the makers may offer
//   PUT /api/avatar { avatar }    → { ok, shown, updated }
//       400 format      not a valid code (avatarOk)
//       403 not_held    { items: [ids] }: it wears cosmetics the account does not hold, at that tier (the card as won needs any
//                       copy; a variant needs that variant). The kit's options are free; what the saved avatar already wears stays
//                       allowed (an avatar from before the rule, a reward glasses look from the site's first maker)
//   The ranking and the player's community puzzles show the new avatar at once (`shown`: what others see).
import { setAvatar, getRecord, json } from "../_lib/auth.js";
import { caller } from "../_lib/caller.js";
import { shownAvatar, setPlayerAvatar, avatarOk, heldCosmetics } from "../_lib/db.js";
import { limit } from "../_lib/ratelimit.js";
import { notHeld, wornCosmetics } from "../../src/avatarCosmetics.js";

const nowOf = (env) => (typeof env.NOW === "function" ? env.NOW() : Date.now());

export async function onRequestGet({ request, env }) {
  const who = await caller(request, env);
  if (who.error) return who.error;
  const { s } = who;
  const blocked = await limit(env, request, "avatar-read", { max: 120, windowSec: 600, id: s.id });
  if (blocked) return blocked;
  const rec = await getRecord(env, s.id);
  return json({ avatar: rec.avatar, updated: rec.avatarAt, cosmetics: await heldCosmetics(env, s.id) });
}

export async function onRequestPut({ request, env }) {
  const who = await caller(request, env, { write: true });
  if (who.error) return who.error;
  const { s } = who;
  const blocked = await limit(env, request, "avatar", { max: 20, windowSec: 600, id: s.id });
  if (blocked) return blocked;
  const { avatar } = (await request.json().catch(() => null)) || {};
  if (!avatarOk(avatar)) return json({ error: "format" }, 400);
  const worn = wornCosmetics(avatar);
  if (worn.length) {
    const rec = await getRecord(env, s.id);
    const missing = notHeld(worn, await heldCosmetics(env, s.id), wornCosmetics(rec.avatar));
    if (missing.length) return json({ error: "not_held", items: missing }, 403);
  }
  const at = nowOf(env);
  await setAvatar(env, s.id, avatar, at);
  const shown = shownAvatar(avatar, s);
  await setPlayerAvatar(env, s.id, shown);
  return json({ ok: true, shown, updated: at });
}
