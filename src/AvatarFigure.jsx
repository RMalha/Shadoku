/**
 * AvatarFigure.jsx — a player's avatar portrait (an "L:" look, src/avatarLook.js) drawn from the Flow-redrawn avatar kit
 * (src/avatarKit.json via src/avatarKit.js). Same contract as ShadokuArt.jsx Figure: a <g> for a 96×96 SVG, with the same
 * [zoom, cy] crops. The kit is loaded on first use, in its own chunk; where it cannot load (the standalone bundle has no
 * dynamic import) the older SVG Figure is drawn instead. The suspects are drawn from the same kit (ShadokuArt.jsx SuspectFigure),
 * with the game's own hat rule (fixLook); an avatar follows the kit's (fixAvatarLook).
 */
import React from "react";
import { Figure, SKIN, HAIR_HEX, HAT_COLORS, CLOTH, ACCENTS, FRAME_COLORS } from "./ShadokuArt.jsx";
import { kitFace, kitItems, kitSvg } from "./avatarKit.js";
import { useAvatarKit } from "./avatarKitLoad.js";
import { fixAvatarLook, avatarHatHides } from "./avatarLook.js";

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
    s = kitSvg(kit, kitItems(L, avatarHatHides(L.hat)), colors, kitFace(kit, L));
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
