/**
 * avatarLook.js — the player's avatar as one short string, saved with the account (functions/api/avatar.js) and shown by
 * <Avatar> (ShadokuHome.jsx) in the menu, the profile, the ranking and on community puzzles.
 *
 *   ""          S. H. Adow (the default)
 *   "photo"     the Google / GitHub account picture (the server stores the picture's https URL in the ranking instead)
 *   "L:…"       a portrait built in the profile's avatar maker from the suspects' kit (ShadokuArt.jsx): the fields below joined by "."
 *
 * Ranking rows and community cards carry the resolved form: "", an https URL, or an "L:" code.
 *
 * Format v2 (2026-11-25) adds the avatar cosmetics and their variant tiers: the format is described in src/avatarCosmetics.js.
 * A look carries them as fields of the kit's own (hat, clothing, tie, glassesStyle hold a cosmetic's value) plus `acc` (the
 * accessory), `bgArt` (the background) and `tiers` ({ hat, glassesStyle, tie, clothing, bgArt, acc }: 0-4).
 */
import { fixLook, genderOk, GLASSES, HAIR_META, HAT_META, SUSPECT_COLORS } from "./ShadokuArt.jsx";
import { AVATAR_RE, BASE_FIELDS, TIER_SLOTS, cosmeticAt, hasVariants, parseCode } from "./avatarCosmetics.js";
import AVATAR_HATS from "./avatarHats.json"; // made with the avatar kit (scripts/avatar-kit/build.mjs): which hair fits under which hat

/** Whether the avatar kit draws `hair` under `hat` cleanly (no hair above or beside the hat). The suspects' kit has its own rule. */
export function avatarHatFits(hat, hair) {
  if (!hat || hat === "none" || !hair || hair === "bald" || AVATAR_HATS.hides.includes(hat)) return true;
  return (AVATAR_HATS.fit[hat] || []).includes(hair);
}
/** Whether the avatar kit draws no hair at all under `hat`. */
export const avatarHatHides = (hat) => AVATAR_HATS.hides.includes(hat);
/** fixLook for an avatar: the same repairs, but the hat follows the avatar kit's rule (avatarHatFits) instead of the suspects'
 *  kit's, so a hair chosen in the maker is never swapped; a hat that does not fit the hair is taken off. */
export function fixAvatarLook(L) {
  const src = L || {};
  // a cosmetic in a field of the kit's own is set aside while the kit's repairs run, then put back (format v2)
  const plain = { ...src };
  for (const [k, fallback] of Object.entries(SWAPPED)) if (isCos(k, src[k])) plain[k] = fallback;
  if (isCos("glassesStyle", src.glassesStyle)) plain.glasses = false;
  const hat = plain.hat;
  const o = fixLook({ ...plain, hat: "none" });
  if (hat && hat !== "none" && HAT_META[hat] && genderOk(HAT_META[hat][0], o.gender) && avatarHatFits(hat, o.hairStyle)) o.hat = hat;
  if (isCos("hat", src.hat) && avatarHatFits(src.hat, o.hairStyle)) o.hat = src.hat; // a cosmetic hat stays only on a hair it fits
  if (isCos("clothing", src.clothing)) o.clothing = src.clothing;
  if (isCos("tie", src.tie)) o.tie = src.tie;
  if (isCos("glassesStyle", src.glassesStyle)) { o.glassesStyle = src.glassesStyle; o.glasses = true; }
  o.acc = isCos("acc", src.acc) ? src.acc : "none";
  o.bgArt = isCos("bgArt", src.bgArt) ? src.bgArt : "none";
  const t = src.tiers || {};
  o.tiers = Object.fromEntries(TIER_SLOTS.map((k) => [k, hasVariants(cosmeticAt(k, o[k])) && Number.isInteger(t[k]) && t[k] >= 0 && t[k] <= 4 ? t[k] : 0]));
  return o;
}

/* ───────────── the cosmetics in a look (format v2) ───────────── */
/** The kit fields a cosmetic can take, and the kit's value they fall back to when the cosmetic is not drawn. */
const SWAPPED = { hat: "none", clothing: "shirtCrewNeck", tie: "none", glassesStyle: "none" };
/** Is `v` a cosmetic the code carries in look field `field`? (The kit's own wayfarers are a normal glasses value.) */
export const isCos = (field, v) => !!cosmeticAt(field, v) && !(field === "glassesStyle" && GLASSES.includes(v));
const wearsCos = (o) => Object.keys(SWAPPED).some((k) => isCos(k, o[k])) || o.acc !== "none" || o.bgArt !== "none";
/** The cosmetics a look wears with their tiers: [{ id, field, value, tier }] (the kit's reward glasses included). */
export function lookCosmetics(L) {
  const o = fixAvatarLook(L);
  return TIER_SLOTS.map((k) => [k, cosmeticAt(k, o[k])]).filter(([, c]) => c).map(([k, c]) => ({ id: c.id, field: k, value: c.value, tier: o.tiers[k] }));
}

/** The round glasses and the wayfarers are achievement rewards for the player's avatar (art-plan rule 5, 2026-11-16): the
 *  maker does not offer them and a new or random look never wears them, unless the player owns them (`owned`). The suspects keep
 *  both (glasses are a trait in the clues), and a shared "L:" code that names them still draws them. */
export const AVATAR_REWARD_GLASSES = ["round", "wayfarers"];
export const avatarGlassesOptions = (list, owned = []) => list.filter((g) => !AVATAR_REWARD_GLASSES.includes(g) || owned.includes(g));
/** A starting look (derived from a name, or random) without reward glasses the player does not own. */
export function startingAvatarLook(L, owned = []) {
  const bare = AVATAR_REWARD_GLASSES.includes(L && L.glassesStyle) && !owned.includes(L.glassesStyle);
  return fixAvatarLook(bare ? { ...L, glassesStyle: "none", glasses: false } : L);
}

export const LOOK_FIELDS = ["gender", "skin", "hairStyle", "hairColor", "hat", "hatC", "glassesStyle", "frameC", "facialHair", "tie", "accent", "clothing", "cloth", "eyes", "brows", "mouth", "back"];
const NUMERIC = new Set(["skin", "hatC", "frameC", "accent", "cloth", "back"]);
export { AVATAR_RE }; // the server checks the same pattern and the v2 shape (functions/_lib/db.js avatarOk → avatarCosmetics.js)

/** A look (ShadokuArt fixLook shape; `back` is an index into SUSPECT_COLORS) → "L:…" (format v2: avatarCosmetics.js; a look with no
 *  cosmetic is the 17 fields of format 1, unchanged). */
export function encodeLook(L) {
  const f = fixAvatarLook(L);
  const back = Math.max(0, SUSPECT_COLORS.indexOf(f.back));
  const v = LOOK_FIELDS.map((k) => (k === "back" ? back : NUMERIC.has(k) ? f[k] || 0 : String(f[k] || "none")));
  if (!wearsCos(f)) return `L:${v.join(".")}`;
  if (f.bgArt !== "none") v[LOOK_FIELDS.indexOf("back")] = f.bgArt;
  const digits = TIER_SLOTS.map((k) => f.tiers[k] || 0).join("");
  if (digits !== "000000") v.push(f.acc, digits);
  else if (f.acc !== "none") v.push(f.acc);
  return `L:${v.join(".")}`;
}

/** "L:…" → a complete look (repaired by fixAvatarLook), or null when it is not an avatar code. A v2 code brings its cosmetics and
 *  tiers; fields 18 and 19 that do not parse are dropped (the plain look under them is drawn). */
export function decodeLook(code) {
  if (typeof code !== "string" || !code.startsWith("L:") || !AVATAR_RE.test(code)) return null; // same charset as the server: nothing else reaches the markup
  const v = code.slice(2).split("."), o = {}, cos = {};
  const p = v.length > BASE_FIELDS ? parseCode(code) : null;
  for (const k of Object.keys(SWAPPED)) { const i = LOOK_FIELDS.indexOf(k); if (isCos(k, v[i])) { cos[k] = v[i]; v[i] = SWAPPED[k]; } }
  const bi = LOOK_FIELDS.indexOf("back");
  if (isCos("bgArt", v[bi])) { cos.bgArt = v[bi]; v[bi] = "0"; }
  LOOK_FIELDS.forEach((k, i) => { o[k] = NUMERIC.has(k) ? Math.max(0, parseInt(v[i], 10) || 0) : v[i] || "none"; });
  o.back = SUSPECT_COLORS[o.back % SUSPECT_COLORS.length];
  o.hairLength = o.hairStyle === "bald" ? "bald" : (HAIR_META[o.hairStyle] || [])[1] || "short";
  o.glasses = o.glassesStyle !== "none";
  return fixAvatarLook({ ...o, ...cos, acc: p ? p.acc : "none", tiers: p ? p.tiers : {} });
}

/** What <Avatar> draws for a player: "" (S. H. Adow), an https picture URL, or an "L:" code. `user`: { avatar, avatarUrl }. */
export function avatarOf(user) {
  const a = (user && user.avatar) || "";
  if (a === "photo") return (user && user.avatarUrl) || "";
  return /^https:\/\//.test(a) || a.startsWith("L:") ? a : "";
}
