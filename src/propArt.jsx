/**
 * propArt.jsx — the board props as the Flow-redrawn pictures (src/propArt.json and src/propArt/<ID>.json, made by
 * scripts/avatar-kit/props.mjs). ShadokuArt.jsx PropSprite asks propArtOf for a prop's cut and draws it with <PropArt>; a prop
 * without a cut, or any prop while its picture loads or where it cannot load (the standalone bundle), keeps its SVG sprite.
 * It imports nothing from ShadokuArt.jsx (no import cycle).
 */
import React, { useEffect, useState } from "react";
import INDEX from "./propArt.json";

// kind -> its cuts: [id, cw, ch, variant, x, y, w, h]
const BY_KIND = {};
for (const [id, [kind, cw, ch, variant, x, y, w, h]] of Object.entries(INDEX)) (BY_KIND[kind] = BY_KIND[kind] || []).push({ id, cw, ch, variant, x, y, w, h });

/**
 * The cut to draw for a prop on a cw × ch span, or null. A cut made for that exact span wins; otherwise the kind's own single
 * cut (variant "") is used the way the SVG sprite was: alone on one tile, or bottom-centred on a bigger span at the size of its
 * short side. `cells` (an L-shaped carpet runner) must fill the box, or the SVG draws it. `variant` picks a named cut (the
 * Master's and N. O. Ir's corpses).
 */
export function propArtOf(kind, cw = 1, ch = 1, { cells, variant = "" } = {}) {
  const cuts = BY_KIND[kind];
  if (!cuts) return null;
  if (variant) { const v = cuts.find((c) => c.variant === variant); return v ? { cut: v, k: 1, dx: 0, dy: 0 } : null; }
  if (cells && cells.length && cells.length !== cw * ch) return null; // an L shape: no cut matches its outline
  const exact = cuts.find((c) => c.cw === cw && c.ch === ch && (c.variant === "span" || c.variant === ""));
  if (exact) return { cut: exact, k: 1, dx: 0, dy: 0 };
  const one = cuts.find((c) => c.variant === "" && c.cw === 1 && c.ch === 1);
  if (!one) return null;
  const k = Math.max(1, Math.min(cw, ch)); // as PropSprite places a single-tile sprite on a span
  return { cut: one, k, dx: 32 * cw - 32 * k, dy: 64 * ch - 64 * k };
}

const pics = new Map(); // id -> data URI | false (cannot load)
const waiting = new Map(); // id -> promise
function loadPic(id) {
  if (!waiting.has(id)) waiting.set(id, import(`./propArt/${id}.json`).then((m) => pics.set(id, (m.default || m).src)).catch(() => pics.set(id, false)));
  return waiting.get(id);
}

/** The picture of a cut (from propArtOf), or `fallback` (the SVG sprite) until it has loaded or if it cannot load. */
export function PropArt({ art, fallback = null }) {
  const id = art.cut.id;
  const [src, setSrc] = useState(() => pics.get(id));
  useEffect(() => {
    let live = true;
    if (!pics.has(id)) loadPic(id).then(() => live && setSrc(pics.get(id)));
    else setSrc(pics.get(id));
    return () => { live = false; };
  }, [id]);
  if (!src) return fallback;
  const { cut: c, k, dx, dy } = art;
  const img = <image href={src} x={c.x} y={c.y} width={c.w} height={c.h} preserveAspectRatio="none" />;
  return k === 1 && !dx && !dy ? img : <g transform={`translate(${dx} ${dy})${k !== 1 ? ` scale(${k})` : ""}`}>{img}</g>;
}
