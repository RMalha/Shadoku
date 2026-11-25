/**
 * avatarCosmetics.js — the avatar cosmetics (app/docs/art-plan/avatar_cosmetics.csv: 100 cards in clothing, hats, neckwear,
 * accessories and backgrounds, 5 achievement rewards) and the avatar code's format v2. Plain JS with no import from the art, so
 * the website (avatarLook.js, AvatarFigure.jsx, ShadokuAvatar.jsx), the Android app (through @site) and the server
 * (functions/_lib/db.js avatarOk, functions/api/avatar.js) share it. The list is generated: scripts/avatar-cosmetics.mjs.
 * Names: ui.cosmetic.<id> (src/locales). Who may wear what (art-plan rules 3 and 5, product_brief.md "Hideout and cosmetics"):
 * the kit's default options are free; a cosmetic is worn only by an account that holds it (the app's `inventory`), at a variant
 * tier it holds; the kit's wayfarers and round glasses are rewards for the player's avatar (the suspects keep both).
 *
 * THE AVATAR CODE, FORMAT V2 (2026-11-25). "" = S. H. Adow, "photo" = the account picture, or a portrait:
 *
 *   L:<17 fields>[.<accessory>[.<tiers>]]                         (at most 200 characters: AVATAR_RE)
 *
 *   The 17 fields are format 1's (avatarLook.js LOOK_FIELDS): gender skin hairStyle hairColor hat hatC glassesStyle frameC
 *   facialHair tie accent clothing cloth eyes brows mouth back. A cosmetic takes the place of the kit's value in its field:
 *     hat           a cosmetic hat ("flatCap")              clothing   a cosmetic garment ("trench")
 *     tie           cosmetic neckwear ("knitScarf"): one thing round the neck
 *     glassesStyle  "umbra" (U. M. Bra's glasses); the kit's "wayfarers" is a reward too
 *     back          a background ("library") instead of the colour's index: the scene fills the backdrop
 *   18th field      the accessory ("cat"), or "none"; present only when an accessory is worn or a 19th field follows
 *   19th field      the variant tiers: 6 digits for hat, glassesStyle, tie, clothing, back, accessory, in that order:
 *                   0 the card as won, 1 Bronze, 2 Silver, 3 Gold, 4 Shadow. Present only when one is not 0; a digit other
 *                   than 0 only on a slot that wears a card cosmetic (achievement rewards have no variants).
 *   A cosmetic value is letters only, so it never looks like a colour index.
 *
 *   A look with no cosmetic is exactly format 1 (17 fields). An older decoder reads a v2 code as the plain look under it: an
 *   unknown hat or garment falls back, a word in `back` reads as colour 0, fields 18 and 19 are ignored.
 */
import LIST from "./avatarCosmeticsList.js";

export const AVATAR_RE = /^(|photo|L:[A-Za-z0-9.]{1,200})$/;
/** Variant tiers by digit: 0 is the card as won. */
export const TIER_NAMES = ["", "bronze", "silver", "gold", "shadow"];
/** The look fields that can wear a cosmetic, in the 19th field's order. (`bgArt` is written in the `back` field.) */
export const TIER_SLOTS = ["hat", "glassesStyle", "tie", "clothing", "bgArt", "acc"];
const CODE_INDEX = { hat: 4, glassesStyle: 6, tie: 9, clothing: 11, bgArt: 16 }; // where each slot sits in the 17 fields (acc: the 18th)
export const BASE_FIELDS = 17;

/** Every cosmetic: { id, field, value, rarity, source: "daily" | "card" | "ach", ach? (the achievement that gives it) }. */
export const COSMETICS = Object.freeze(LIST.map(([id, field, value, rarity, source, ach]) => Object.freeze({ id, field, value, rarity, source, ...(ach ? { ach } : {}) })));
const BY_SLOT = {};
for (const c of COSMETICS) (BY_SLOT[c.field] ||= new Map()).set(c.value, c);
export const COSMETIC_BY_ID = new Map(COSMETICS.map((c) => [c.id, c]));
/** The cosmetic worn as `value` in look field `field` (bgArt, acc, hat, ...), or null. */
export const cosmeticAt = (field, value) => (typeof value === "string" && BY_SLOT[field] && BY_SLOT[field].get(value)) || null;
/** Can this cosmetic come in Bronze, Silver, Gold and Shadow? (cards: yes; achievement rewards: no) */
export const hasVariants = (c) => !!c && c.source !== "ach";
/** The kit's own glasses that are rewards for a player's avatar: the value → the cosmetic that must be held to wear it. The
 *  round glasses are drawn as U. M. Bra's glasses (glasses-umbra) in the makers; an older avatar that wears them keeps them. */
export const REWARD_KIT_GLASSES = Object.freeze({ wayfarers: "glasses-wayfarers", round: "glasses-umbra" });

/** "L:…" → { fields (the 17), acc, tiers: { slot: 0-4 } } by structure only (no art), or null when it is not a portrait code. */
export function parseCode(code) {
  if (typeof code !== "string" || !code.startsWith("L:") || !AVATAR_RE.test(code)) return null;
  const f = code.slice(2).split(".");
  if (f.length < BASE_FIELDS || f.length > BASE_FIELDS + 2) return null;
  const acc = f.length > BASE_FIELDS ? f[BASE_FIELDS] : "none";
  const digits = f.length > BASE_FIELDS + 1 ? f[BASE_FIELDS + 1] : "000000";
  if (!/^[0-4]{6}$/.test(digits)) return null;
  const tiers = Object.fromEntries(TIER_SLOTS.map((s, i) => [s, +digits[i]]));
  return { fields: f.slice(0, BASE_FIELDS), acc, tiers };
}

/** The value each cosmetic slot holds in a parsed code. */
const slotValue = (p, slot) => (slot === "acc" ? p.acc : p.fields[CODE_INDEX[slot]]);

/**
 * The server's check of a code (functions/_lib/db.js avatarOk): "", "photo", or an "L:" code of 17 to 19 fields, at most 200
 * characters, no empty field and none named like an Object.prototype member (the art looks fields up in plain tables), the 18th a
 * known accessory or "none" (and "none" only when a 19th follows), the 19th six tier digits, not all 0, each on a card cosmetic.
 */
export function avatarCodeOk(code) {
  if (typeof code !== "string" || !AVATAR_RE.test(code)) return false;
  if (!code.startsWith("L:")) return true;
  const raw = code.slice(2).split(".");
  if (raw.some((x) => x === "" || x in Object.prototype)) return false;
  const p = parseCode(code);
  if (!p) return false;
  if (raw.length > BASE_FIELDS && p.acc !== "none" && !cosmeticAt("acc", p.acc)) return false;
  if (raw.length === BASE_FIELDS + 1 && p.acc === "none") return false;
  if (raw.length === BASE_FIELDS + 2) {
    if (TIER_SLOTS.every((s) => p.tiers[s] === 0)) return false;
    for (const s of TIER_SLOTS) if (p.tiers[s] && !hasVariants(cosmeticAt(s, slotValue(p, s)))) return false;
  }
  return true;
}

/** The cosmetics a code wears: [{ id, tier }] (tier 0-4), the kit's reward glasses included. [] for "", "photo" or a bad code. */
export function wornCosmetics(code) {
  const p = parseCode(code);
  if (!p) return [];
  const out = [];
  for (const s of TIER_SLOTS) {
    const v = slotValue(p, s), c = cosmeticAt(s, v);
    if (c) out.push({ id: c.id, tier: hasVariants(c) ? p.tiers[s] : 0 });
    else if (s === "glassesStyle" && REWARD_KIT_GLASSES[v]) out.push({ id: REWARD_KIT_GLASSES[v], tier: 0 });
  }
  return out;
}

/**
 * May an account wear these? `held`: { id: [tiers held] } (tier 0 = the card as won). A tier above 0 needs that variant; the card
 * as won (0) needs any copy, plain or merged. `kept`: what the account's saved avatar already wears (it stays allowed: an avatar
 * from before a rule, or a reward glasses look kept from the site's first maker). → the ids that are not allowed.
 */
export function notHeld(worn, held, kept = []) {
  const keep = new Set(kept.map((w) => `${w.id}:${w.tier}`));
  return worn.filter((w) => {
    if (keep.has(`${w.id}:${w.tier}`)) return false;
    const tiers = (held && held[w.id]) || [];
    return w.tier ? !tiers.includes(w.tier) : tiers.length === 0;
  }).map((w) => w.id);
}
