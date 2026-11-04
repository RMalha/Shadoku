/**
 * avatarLook.js — the player's avatar as one short string, saved with the account (functions/api/avatar.js) and shown by
 * <Avatar> (ShadokuHome.jsx) in the menu, the profile, the ranking and on community puzzles.
 *
 *   ""          S. H. Adow (the default)
 *   "photo"     the Google / GitHub account picture (the server stores the picture's https URL in the ranking instead)
 *   "L:…"       a portrait built in the profile's avatar maker from the suspects' kit (ShadokuArt.jsx): the fields below joined by "."
 *
 * Ranking rows and community cards carry the resolved form: "", an https URL, or an "L:" code.
 */
import { fixLook, HAIR_META, SUSPECT_COLORS } from "./ShadokuArt.jsx";

export const LOOK_FIELDS = ["gender", "skin", "hairStyle", "hairColor", "hat", "hatC", "glassesStyle", "frameC", "facialHair", "tie", "accent", "clothing", "cloth", "eyes", "brows", "mouth", "back"];
const NUMERIC = new Set(["skin", "hatC", "frameC", "accent", "cloth", "back"]);
export const AVATAR_RE = /^(|photo|L:[A-Za-z0-9.]{1,200})$/; // the server checks the same pattern (functions/_lib/db.js)

/** A look (ShadokuArt fixLook shape; `back` is an index into SUSPECT_COLORS) → "L:…". */
export function encodeLook(L) {
  const f = fixLook(L);
  const back = Math.max(0, SUSPECT_COLORS.indexOf(f.back));
  return `L:${LOOK_FIELDS.map((k) => (k === "back" ? back : NUMERIC.has(k) ? f[k] || 0 : String(f[k] || "none"))).join(".")}`;
}

/** "L:…" → a complete look (repaired by fixLook), or null when it is not an avatar code. */
export function decodeLook(code) {
  if (typeof code !== "string" || !code.startsWith("L:")) return null;
  const v = code.slice(2).split("."), o = {};
  LOOK_FIELDS.forEach((k, i) => { o[k] = NUMERIC.has(k) ? Math.max(0, parseInt(v[i], 10) || 0) : v[i] || "none"; });
  o.back = SUSPECT_COLORS[o.back % SUSPECT_COLORS.length];
  o.hairLength = o.hairStyle === "bald" ? "bald" : (HAIR_META[o.hairStyle] || [])[1] || "short";
  o.glasses = o.glassesStyle !== "none";
  return fixLook(o);
}

/** What <Avatar> draws for a player: "" (S. H. Adow), an https picture URL, or an "L:" code. `user`: { avatar, avatarUrl }. */
export function avatarOf(user) {
  const a = (user && user.avatar) || "";
  if (a === "photo") return (user && user.avatarUrl) || "";
  return /^https:\/\//.test(a) || a.startsWith("L:") ? a : "";
}
