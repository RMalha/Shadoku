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
 *   L:<17 fields>[.<accessory>[.<tiers>[.<badge>]]]               (at most 240 characters: AVATAR_RE)
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
 *   20th field      the badge pinned on the chest (2026-11-25), present only when one is worn; then fields 18 and 19 are
 *                   always there too ("none" when no accessory is worn, "000000" when every tier is 0). Letters and digits
 *                   only (the code's charset); it is the badge TOKEN below, written without "-" and "_":
 *                     token "m-member" (Member)   -> "mMember"      token "m-golden" (Golden Member) -> "mGolden"
 *                     token "a-<achievement>-<tier>" -> "a" + the achievement id in camelCase + "T" + the tier:
 *                       "a-contracts-5" -> "acontractsT5", "a-no_hints_very_easy-10" -> "anoHintsVeryEasyT10"
 *                   An achievement badge is one tier of a laddered achievement (functions/_lib/app/achievements.js: the
 *                   tiers with a badge material, 1-10 = Paper ... Shadow), so the pin can be drawn from the code alone.
 *                   lookBadge / withBadge read and write it; BADGE_RE is the token's grammar. The server lets an account
 *                   wear only a badge it holds (functions/api/avatar.js).
 *   A cosmetic value is letters only, so it never looks like a colour index.
 *
 *   A look with no cosmetic is exactly format 1 (17 fields). An older decoder reads a v2 code as the plain look under it: an
 *   unknown hat or garment falls back, a word in `back` reads as colour 0, fields 18 to 20 are ignored (the decoders before
 *   the badge read 18 and 19 only up to 19 fields, so they drop the accessory and tiers of a code with a badge, and keep the
 *   rest). The limit went from 200 to 240 characters with the badge (up to 22 more: "." + "a" + 17 + "T10"); the longest
 *   look before it was about 191. A decoder from before the badge refuses a code over 200 and draws S. H. Adow instead: only
 *   a look made of nearly all the longest names, with a badge, gets there.
 */
import LIST from "./avatarCosmeticsList.js";

export const AVATAR_RE = /^(|photo|L:[A-Za-z0-9.]{1,240})$/;
/** A badge token: "m-member", "m-golden", or "a-<achievement id>-<tier 1-10>" (format v2's 20th field, written without "-" and "_"). */
export const BADGE_RE = /^(?:a-[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)*-(?:[1-9]|10)|m-(?:member|golden))$/;
const BADGE_FIELD_RE = /^(?:a([a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)*)T([1-9]|10)|m(Member|Golden))$/;
const MEMBERSHIP_FIELD = { member: "Member", golden: "Golden" };
/** A badge token → its field in the code, or null. */
function badgeField(token) {
  if (typeof token !== "string" || !BADGE_RE.test(token)) return null;
  if (token.startsWith("m-")) return `m${MEMBERSHIP_FIELD[token.slice(2)]}`;
  const cut = token.lastIndexOf("-");
  return `a${token.slice(2, cut).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}T${token.slice(cut + 1)}`;
}
/** A code's 20th field → the badge token, or null. */
function badgeToken(field) {
  const m = typeof field === "string" ? BADGE_FIELD_RE.exec(field) : null;
  if (!m) return null;
  if (m[3]) return `m-${m[3].toLowerCase()}`;
  return `a-${m[1].replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}-${m[2]}`;
}
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

/**
 * "L:…" → { fields (the 17), acc, tiers: { slot: 0-4 }, badge (a token or null) } by structure only (no art), or null when it
 * is not a portrait code. Fields after the 20th, and a 20th that is not a badge, are passed over (badge null): a later format
 * still draws here; avatarCodeOk is the strict check.
 */
export function parseCode(code) {
  if (typeof code !== "string" || !code.startsWith("L:") || !AVATAR_RE.test(code)) return null;
  const f = code.slice(2).split(".");
  if (f.length < BASE_FIELDS) return null;
  const acc = f.length > BASE_FIELDS ? f[BASE_FIELDS] : "none";
  const digits = f.length > BASE_FIELDS + 1 ? f[BASE_FIELDS + 1] : "000000";
  if (!/^[0-4]{6}$/.test(digits)) return null;
  const tiers = Object.fromEntries(TIER_SLOTS.map((s, i) => [s, +digits[i]]));
  return { fields: f.slice(0, BASE_FIELDS), acc, tiers, badge: f.length > BASE_FIELDS + 2 ? badgeToken(f[BASE_FIELDS + 2]) : null };
}

/** The badge a code wears: its token ("a-contracts-5", "m-member" ...), or null (none, "", "photo", not a code). */
export function lookBadge(code) {
  const p = parseCode(code);
  return p ? p.badge : null;
}

/**
 * The same code wearing `token` (a BADGE_RE token), or with no badge (null). A code that is not a portrait ("", "photo", a bad
 * code) comes back unchanged, and so does any code when `token` is neither null nor a badge token. Without a badge the code
 * keeps its shortest form (fields 18 and 19 only when they carry something).
 */
export function withBadge(code, token) {
  const p = parseCode(code);
  if (!p || (token !== null && token !== undefined && !badgeField(token))) return code;
  const f = code.slice(2).split(".");
  const base = f.slice(0, BASE_FIELDS), acc = f.length > BASE_FIELDS ? f[BASE_FIELDS] : "none";
  const digits = f.length > BASE_FIELDS + 1 ? f[BASE_FIELDS + 1] : "000000";
  if (token) return `L:${[...base, acc, digits, badgeField(token)].join(".")}`;
  if (digits !== "000000") return `L:${[...base, acc, digits].join(".")}`;
  return `L:${[...base, ...(acc !== "none" ? [acc] : [])].join(".")}`;
}

/** The value each cosmetic slot holds in a parsed code. */
const slotValue = (p, slot) => (slot === "acc" ? p.acc : p.fields[CODE_INDEX[slot]]);

/**
 * The server's check of a code (functions/_lib/db.js avatarOk): "", "photo", or an "L:" code of 17 to 20 fields, at most 240
 * characters, no empty field and none named like an Object.prototype member (the art looks fields up in plain tables), the 18th a
 * known accessory or "none" (and "none" only when a 19th follows), the 19th six tier digits, each on a card cosmetic, not all 0
 * unless a 20th follows, the 20th a badge (BADGE_RE once read back as a token). Whether the account holds the badge is the
 * server's check (functions/api/avatar.js).
 */
export function avatarCodeOk(code) {
  if (typeof code !== "string" || !AVATAR_RE.test(code)) return false;
  if (!code.startsWith("L:")) return true;
  const raw = code.slice(2).split(".");
  if (raw.some((x) => x === "" || x in Object.prototype)) return false;
  const p = parseCode(code);
  if (!p || raw.length > BASE_FIELDS + 3) return false;
  if (raw.length > BASE_FIELDS && p.acc !== "none" && !cosmeticAt("acc", p.acc)) return false;
  if (raw.length === BASE_FIELDS + 1 && p.acc === "none") return false;
  if (raw.length >= BASE_FIELDS + 2) {
    if (raw.length === BASE_FIELDS + 2 && TIER_SLOTS.every((s) => p.tiers[s] === 0)) return false;
    for (const s of TIER_SLOTS) if (p.tiers[s] && !hasVariants(cosmeticAt(s, slotValue(p, s)))) return false;
  }
  if (raw.length === BASE_FIELDS + 3 && !p.badge) return false;
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
