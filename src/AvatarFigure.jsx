/**
 * AvatarFigure.jsx — a player's avatar portrait (an "L:" look, src/avatarLook.js) drawn from the Flow-redrawn avatar kit
 * (src/avatarKit.json via src/avatarKit.js). Same contract as ShadokuArt.jsx Figure: a <g> for a 96×96 SVG, with the same
 * [zoom, cy] crops. The kit is loaded on first use, in its own chunk; where it cannot load (the standalone bundle has no
 * dynamic import) the older SVG Figure is drawn instead. The suspects are drawn from the same kit (ShadokuArt.jsx SuspectFigure),
 * with the game's own hat rule (fixLook); an avatar follows the kit's (fixAvatarLook).
 * The avatar cosmetics (format v2, src/avatarCosmetics.js) are kit items too: a cosmetic neckwear is the kit's "neck-" item where
 * the tie goes, a background ("bg-") is painted first and an accessory ("acc-") last; a variant is drawn through its tier's tone map.
 */
import React from "react";
import { Figure, SKIN, HAIR_HEX, HAT_COLORS, CLOTH, ACCENTS, FRAME_COLORS } from "./ShadokuArt.jsx";
import { kitFace, kitItems, kitSvg } from "./avatarKit.js";
import { useAvatarKit } from "./avatarKitLoad.js";
import { fixAvatarLook, avatarHatHides, isCos } from "./avatarLook.js";
import { TIER_NAMES, TIER_SLOTS, cosmeticAt } from "./avatarCosmetics.js";

const markupCache = new Map();
/** The look's portrait markup in the 280 frame (cached). */
function avatarMarkup(kit, look, sw) {
  const L = fixAvatarLook(look || {});
  const key = JSON.stringify([L, sw]);
  let s = markupCache.get(key);
  if (s == null) {
    const colors = {
      skin: SKIN[(L.skin || 0) % SKIN.length], hair: HAIR_HEX[L.hairColor] || HAIR_HEX.none, hat: HAT_COLORS[(L.hatC || 0) % HAT_COLORS.length],
      clothes: CLOTH[(L.cloth || 0) % CLOTH.length], accent: ACCENTS[(L.accent || 0) % ACCENTS.length],
      frame: FRAME_COLORS[(L.frameC || 0) % FRAME_COLORS.length],
    };
    const hides = avatarHatHides(L.hat);
    const ids = kitItems(L, hides).map((id) => (id.startsWith("tie-") && isCos("tie", id.slice(4)) ? `neck-${id.slice(4)}` : id));
    if (L.bgArt && L.bgArt !== "none") ids.unshift(`bg-${L.bgArt}`);
    if (L.acc && L.acc !== "none") ids.push(`acc-${L.acc}`);
    const tiers = {};
    for (const k of TIER_SLOTS) { const c = cosmeticAt(k, L[k]); if (c && L.tiers && L.tiers[k]) tiers[c.id] = TIER_NAMES[L.tiers[k]]; }
    s = kitSvg(kit, ids, colors, kitFace(kit, L, L.hat && L.hat !== "none" && hides ? null : colors.hair), null, tiers);
    if (markupCache.size > 400) markupCache.clear();
    markupCache.set(key, s);
  }
  return s;
}

export function AvatarFigure({ look, zoom = 1, cy = 140, sw = 4.2 }) {
  const kit = useAvatarKit();
  if (kit === false) return <Figure look={look} zoom={zoom} cy={cy} sw={sw} />;
  if (!kit) return null;
  const k = (96 / 280) * zoom;
  return <g transform={`translate(48 48) scale(${k}) translate(-140 ${-cy})`} dangerouslySetInnerHTML={{ __html: avatarMarkup(kit, look, sw) }} />;
}
