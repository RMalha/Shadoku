/**
 * avatarKit.js — the players' avatar portrait, drawn from the Flow-redrawn kit (src/avatarKit.json, made by
 * scripts/avatar-kit/build.mjs from docs/android/design/art/New: never edit the JSON by hand).
 *
 * The kit is in the 280×280 frame of the suspects' portraits (ShadokuArt.jsx Figure), so the same crops apply. Each item
 * is a list of [role, value, d] in paint order: "k" = drawn in `value` (a colour); "t" = the item's chosen colour, `value`
 * being the path's shade in [-1, 1] (below 0 darker, above 0 lighter); "u" = the same for the item's second colour (the
 * T-shirt under the overall); "o" = as "t", with a thin rim in a dark tone of the colour (the wire of the round glasses, which
 * has no ink outline of its own). Plain JS (no React) so the build's preview can use it too.
 */

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
function rgb2hsl([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2hex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v + m)) * 255).toString(16).padStart(2, "0")).join("");
}
const tintCache = new Map();
/** The chosen colour at a path's shade: darker shades scale its lightness down, lighter ones move it towards white. */
export function tint(color, shade) {
  const k = color + shade;
  let v = tintCache.get(k);
  if (!v) {
    const [h, s, l] = rgb2hsl(hex2rgb(color));
    const L = shade < 0 ? l * (1 + shade) : l + (1 - l) * shade * 0.8;
    v = hsl2hex(h, s, Math.min(0.97, L));
    tintCache.set(k, v);
  }
  return v;
}

/** The eyebrows' colour for a hair colour: the same hue, darker (no lighter than BROW_L), so blonde, red or grey hair gets
 *  brows to match that still read on pale skin. */
const BROW_L = 0.36;
export function browColor(hair) {
  const [h, s, l] = rgb2hsl(hex2rgb(hair));
  return hsl2hex(h, s * 0.9, Math.min(l * 0.62, BROW_L));
}

/** The look's eyes, eyebrows and mouth from the kit's redrawn features (kit.face, cut by scripts/avatar-kit/face.mjs): raster
 *  parts laid where the suspects' kit draws the same styles. A style the kit lacks falls back to its default. A woman's
 *  eyes get lashes (kit.face.lashes: two flicks at each eye's outer corner, filled in the face's ink), painted over the brows.
 *  `hair`: the hair's colour, which the brows take (browColor); without it (a hat that hides all the hair, so the brows must
 *  not tell its colour; the assassins' shadow) they stay in the face's ink. */
export function kitFace(kit, look, hair = null) {
  const f = kit.face || {};
  const lash = look.gender === "f" && f.lashes && f.lashes[look.eyes];
  const extra = lash ? `<path d="${lash}" fill="${f.ink || "#2c1c16"}"/>` : "";
  const part = (kind, style, fallback) => ((f[kind] && (f[kind][style] || f[kind][fallback])) || [])
    .map(([x, y, w, h, href]) => `<image x="${x}" y="${y}" width="${w}" height="${h}" href="${href}" preserveAspectRatio="none"/>`).join("");
  let brows = part("brows", look.brows, "defaultNatural");
  if (hair) { // the brows are one flat shape: flood it with their colour (the same id for the same colour, so repeats are identical)
    const c = browColor(hair), id = `avk-brow-${c.slice(1)}`;
    brows = `<defs><filter id="${id}" color-interpolation-filters="sRGB"><feFlood flood-color="${c}"/><feComposite in2="SourceAlpha" operator="in"/></filter></defs><g filter="url(#${id})">${brows}</g>`;
  }
  // the lashes go last, over the brows (a raised brow can reach them)
  return part("mouth", look.mouth, "default") + part("eyes", look.eyes, "default") + brows + extra;
}

/** The rim of an "o" path: its shade against the path's own fill, and its width in frame units (half of it shows, outside the path). */
const RIM_SHADE = -0.55, RIM_W = 1.4;

/** Hats that hide the ears: the base is drawn without them and the hat's notch is filled in its colour. */
const EARS_HIDDEN = new Set(["hijab", "winterHat1"]);

/** The kit's item ids a look wears, in paint order. `hides`: the hat covers all the hair. The back of a hat (the wide brim
 *  hanging beside the face) comes first, behind the head and the hair; the hair is cut where the hat holds it (kitSvg). */
export function kitItems(look, hides) {
  const hat = look.hat && look.hat !== "none" ? look.hat : null;
  const ids = [];
  if (hat) ids.push(`hat-${hat}-back`);
  ids.push(hat && EARS_HIDDEN.has(hat) ? "base-noEars" : "base");
  if (look.clothing && look.clothing !== "shirtless") ids.push(`clothing-${look.clothing}`);
  if (look.hairStyle && look.hairStyle !== "bald" && !(hat && hides)) ids.push(`hair-${look.hairStyle}`);
  if (look.tie && look.tie !== "none") ids.push(`tie-${look.tie}`); // over long hair, under a beard
  if (look.facialHair && look.facialHair !== "none") ids.push(`facialHair-${look.facialHair}`);
  if (hat && EARS_HIDDEN.has(hat)) ids.push(`hat-earCover-${hat}`);
  if (hat) ids.push(`hat-${hat}`);
  if (look.glasses && look.glassesStyle && look.glassesStyle !== "none") ids.push(`glasses-${look.glassesStyle}`);
  return ids;
}

/** The portrait as SVG markup in the 280 frame. `colors`: { skin, hair, hat, clothes, accent, frame } as hex; `face`: markup drawn
 *  right over the base (the eyes, brows and mouth: kitFace). Under a hat the hair keeps only what lies below
 *  the hat's edge (kit.clip; the same id for the same hat, so repeated portraits share an identical clip path).
 *  `paint(id, role, v, fill, k)`, if given, may return another fill for a path (the assassins' shadow, ShadokuArt.jsx ShadowFigure);
 *  `fill` is the colour the kit would use, `k` the path's place in its item (0: the item's silhouette, under the rest). It may also
 *  return { fill, line, width }: the path then gets an outline in `line` round it (under its fill; `width` the stroke's, RIM_W * 2 by default). */
export function kitSvg(kit, ids, colors, face = "", paint = null) {
  const slot = { base: colors.skin, hair: colors.hair, facialHair: colors.hair, hat: colors.hat, clothing: colors.clothes, tie: colors.accent, glasses: colors.frame };
  const hat = (ids.find((id) => /^hat-[A-Za-z0-9]+$/.test(id)) || "").slice(4);
  const cut = hat && kit.clip && kit.clip[hat] ? `avk-hat-${hat}` : null;
  let out = cut ? `<defs><clipPath id="${cut}"><path d="${kit.clip[hat]}"/></clipPath></defs>` : "";
  for (const id of ids) {
    const item = kit.items[id];
    if (item) {
      const main = slot[id.split("-")[0]];
      let paths = "";
      for (const [k, [role, v, d]] of item.entries()) {
        const own = role === "k" ? v : tint(role === "u" ? colors.accent : main || "#808080", v);
        const got = (paint && paint(id, role, v, own, k)) || own, fill = typeof got === "string" ? got : got.fill;
        const line = typeof got === "string" ? (role === "o" ? tint(fill, RIM_SHADE) : null) : got.line;
        const rim = line ? ` stroke="${line}" stroke-width="${typeof got === "string" ? RIM_W : got.width || RIM_W * 2}" stroke-linejoin="round" paint-order="stroke"` : "";
        paths += `<path fill="${fill}"${rim} d="${d}"/>`;
      }
      out += cut && id.startsWith("hair-") ? `<g clip-path="url(#${cut})">${paths}</g>` : paths;
    }
    if (id === "base" || id === "base-noEars") out += face;
  }
  return out;
}
