/**
 * tierTone.js — the tier tone-map: one Flow drawing becomes its Bronze, Silver, Gold or Shadow variant in code
 * (app/docs/art-plan/README.md, "Variants are made in code"; three of a tier merge into the next). Plain JS, no React, shared by
 * the website (the avatar cosmetics' variants: avatarKit.js) and the app (app/src/assets/tierTone.js re-exports this file; the
 * preview page and scripts/ui-tier-preview.mjs use it too). Moved here from app/src/assets on 2026-11-25.
 *
 *   toneMapRGBA(rgba, tier, { strength, paper, fit, range })   in place on RGBA bytes (a Uint8ClampedArray or Buffer), returns them
 *   toneMapCanvas(image, tier, opts)               a canvas with the picture mapped (browser)
 *   tierLook(tier)                                 { ramp, glow, rim, frame }: the colours for a matching frame, rim glow and text
 *   tierGlow(tier, px)                             a CSS drop-shadow() for the rim glow in the hideout and on cards
 *   tierFilterSvg(tier, id, { rim })               an SVG <filter> doing the same gradient map live (the avatar's cosmetics)
 *
 * How it maps: each pixel's luminance picks a colour from the tier's ramp (a gradient map: bronze is warm metal, silver cool
 * grey, gold yellow metal, Shadow dark with a violet rim in the game's night palette), so the drawing's ink and shading stay and
 * only the colour changes. The paper of a card (its cream art window and name strip: light, low in saturation) is left as
 * drawn, so only the frame changes tier; `paper: false` maps everything (a badge, a seal). `fit` (on) stretches the ramp over the
 * picture's own frame range. `strength` mixes with the original (1 = fully mapped). Alpha is never touched.
 */
export const TIERS = ["bronze", "silver", "gold", "shadow"];

/** ramp: [luminance 0..1, colour] stops, dark ink to highlight. glow: the rim glow; rim: the line round a framed card. */
const LOOK = {
  bronze: { ramp: [[0, "#2a160c"], [0.4, "#7d4420"], [0.72, "#b46f33"], [1, "#e9a867"]], glow: "#e0894a", rim: "#6a3a1a" },
  silver: { ramp: [[0, "#1b2027"], [0.4, "#667280"], [0.72, "#9aa7b4"], [1, "#e6edf4"]], glow: "#c9d6e4", rim: "#56626f" },
  gold: { ramp: [[0, "#2e1d05"], [0.4, "#94640f"], [0.72, "#d49a1c"], [1, "#fbe58a"]], glow: "#ffd24a", rim: "#7a5208" },
  shadow: { ramp: [[0, "#08060f"], [0.4, "#221838"], [0.72, "#3a2a68"], [1, "#8a72d4"]], glow: "#9b6cff", rim: "#7e4fe0" },
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const RAMPS = Object.fromEntries(Object.entries(LOOK).map(([k, v]) => [k, v.ramp.map(([t, c]) => [t, hex(c)])]));

/** The tier's colours: the 4-stop ramp, glow and rim as hex, and `frame`, the mid colour a flat frame or text can use. */
export function tierLook(tier) {
  const l = LOOK[tier];
  if (!l) throw new Error(`unknown tier ${tier}`);
  return { ...l, frame: l.ramp[2][1] };
}
export const tierGlow = (tier, px = 10) => `drop-shadow(0 0 ${px}px ${tierLook(tier).glow}) drop-shadow(0 0 ${Math.round(px / 3)}px ${tierLook(tier).rim})`;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function ramp(stops, t) {
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) { const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], u = (t - t0) / (t1 - t0 || 1); return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u]; }
  }
  return stops[stops.length - 1][1];
}

// the ramp position's gamma: a frame's mid-tones sit in the middle of the ramp, only its highlights reach the bright end
const GAMMA = 1.7;
const isPaper = (L, S) => smooth(0.86, 0.9, L) * (1 - smooth(0.26, 0.34, S));
const lumOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
/** The luminance range of the frame (everything that is not paper): its 3rd and 97th percentile, so a pale frame and a dark one
 *  both fill the whole ramp. */
function frameRange(d, paper) {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const L = lumOf(r, g, b);
    if (paper && isPaper(L, mx ? (mx - mn) / mx : 0) > 0.5) continue;
    hist[Math.min(255, Math.round(L * 255))]++; n++;
  }
  if (!n) return [0.08, 0.8];
  const at = (q) => { let c = 0; for (let k = 0; k < 256; k++) { c += hist[k]; if (c >= q * n) return k / 255; } return 1; };
  const lo = at(0.03), hi = at(0.97);
  return hi - lo < 0.15 ? [Math.max(0, lo - 0.1), Math.min(1, lo + 0.25)] : [lo, hi];
}
/** The luminance range `fit` stretches the ramp over (see frameRange): pass it back as `range` to tone several drawings alike. */
export const lumaRange = (d, paper = true) => frameRange(d, paper);
export function toneMapRGBA(d, tier, { strength = 1, paper = true, fit = true, range = null } = {}) {
  const stops = tier && typeof tier === "object" ? tier.stops : RAMPS[tier]; // a tier name, or { stops } from rampFromColor (the envelope colours)
  if (!stops) throw new Error(`unknown tier ${tier}`);
  const [LO, HI] = range || (fit ? frameRange(d, paper) : [0.08, 0.8]); // `range`: a fixed [lo, hi], so the frames of one animation share the first frame's tone
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), L = lumOf(r, g, b), S = mx ? (mx - mn) / mx : 0;
    const keep = paper ? isPaper(L, S) : 0;
    const w = strength * (1 - keep);
    if (w <= 0) continue;
    const m = ramp(stops, Math.pow(Math.min(1, Math.max(0, (L - LO) / (HI - LO))), GAMMA));
    d[i] = d[i] + (m[0] - d[i]) * w;
    d[i + 1] = d[i + 1] + (m[1] - d[i + 1]) * w;
    d[i + 2] = d[i + 2] + (m[2] - d[i + 2]) * w;
  }
  return d;
}

/** A tone for toneMapRGBA/toneMapCanvas from one colour (a hex): dark ink of the same hue, the colour in the mid-tones, a paler highlight. */
export function rampFromColor(color) {
  const c = hex(color), mix = (a, b, u) => a.map((v, i) => v + (b[i] - v) * u);
  return { stops: [[0, mix(c, [8, 6, 6], 0.82)], [0.4, mix(c, [8, 6, 6], 0.42)], [0.72, mix(c, [255, 250, 240], 0.06)], [1, mix(c, [255, 250, 240], 0.4)]] };
}

/** A canvas holding `image` (an HTMLImageElement, ImageBitmap or canvas, already loaded) mapped to `tier`. */
export function toneMapCanvas(image, tier, opts) {
  const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(image, 0, 0);
  const px = x.getImageData(0, 0, w, h);
  toneMapRGBA(px.data, tier, opts);
  x.putImageData(px, 0, 0);
  return c;
}

/**
 * The tone map as an SVG <filter> (markup), for art drawn in an SVG: luminance, then a per-channel table sampled from the tier's
 * ramp (the same sampling as the Hideout's props), then a thin rim in the tier's colour. Alpha is never touched.
 * `rim`: the rim's blur in the SVG's user units (0 = none).
 */
export function tierFilterSvg(tier, id, { rim = 1.2 } = {}) {
  const l = LOOK[tier];
  if (!l) return "";
  const stops = RAMPS[tier].map(([u, c]) => [u, c.map((v) => v / 255)]);
  const table = (k) => Array.from({ length: 11 }, (_, s) => ramp(stops, Math.pow(s / 10, 1.25))[k].toFixed(3)).join(" ");
  const rimFx = rim > 0 ? `<feDropShadow in="tone" dx="0" dy="0" stdDeviation="${rim}" flood-color="${l.rim}" flood-opacity=".95"/>` : "";
  return `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">`
    + `<feColorMatrix type="matrix" values=".299 .587 .114 0 0 .299 .587 .114 0 0 .299 .587 .114 0 0 0 0 0 1 0"/>`
    + `<feComponentTransfer result="tone"><feFuncR type="table" tableValues="${table(0)}"/><feFuncG type="table" tableValues="${table(1)}"/><feFuncB type="table" tableValues="${table(2)}"/></feComponentTransfer>`
    + rimFx + `</filter>`;
}
