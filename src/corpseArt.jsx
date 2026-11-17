/**
 * corpseArt.jsx — the board's corpse from the Flow-redrawn corpse kit (src/corpseKit.json and src/corpseKit/<body>.json, cut by
 * scripts/avatar-kit/corpse.mjs): the tutorial's dummy as one redrawn picture, and for every other victim the body of their garment, lying in the pool, with the victim's head from the avatar
 * kit (X eyes, a flat mouth unless it was a pained one). ShadokuArt.jsx Corpse passes the victim's look and colours; until the
 * kits have loaded, or where they cannot (the standalone bundle), it draws its SVG corpse (`fallback`).
 *
 * A body's coloured layers ("skin", "cloth", "accent", "pants") store how far each pixel is from the ink towards the drawn
 * colour; a colour matrix draws them back in the victim's colour (ink + t (colour - ink)), so the shading keeps its depth.
 * It imports nothing from ShadokuArt.jsx (no import cycle).
 */
import React, { useEffect, useId, useState } from "react";
import META from "./corpseKit.json";
import { kitFace, kitItems, kitSvg } from "./avatarKit.js";
import { useAvatarKit } from "./avatarKitLoad.js";

const bodies = new Map(); // name -> layers | false
const waiting = new Map();
function loadBody(name) {
  if (!waiting.has(name)) waiting.set(name, import(`./corpseKit/${name}.json`).then((m) => bodies.set(name, m.default || m)).catch(() => bodies.set(name, false)));
  return waiting.get(name);
}
function useBodies(names) {
  const [, tick] = useState(0);
  const key = names.join(",");
  useEffect(() => {
    let live = true;
    const need = names.filter((n) => !bodies.has(n));
    if (need.length) Promise.all(need.map(loadBody)).then(() => live && tick((t) => t + 1));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return names.map((n) => bodies.get(n));
}

export const CORPSE_BODIES = new Set(META.bodies);
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
// the avatar's head on the body's oval: the earless head (116 frame units wide, crown at y 36) on the oval's width
const HEAD_W = 116, HEAD_TOP = 36;
// the body laid on its tile: about 55 units from crown to shoes, turned like the SVG corpse
const K = 0.094, CX = 0, CY = 300;

/**
 * The corpse in a 64-unit tile. `look`: the victim's fixed look; `colors`: { skin, hair, hat, cloth, accent, pants, frame } as
 * hex; `body`: the corpse kit's body name (the look's clothing).
 */
export function KitCorpse({ look, colors, body, fallback = null }) {
  const kit = useAvatarKit();
  const [layers, pool] = useBodies([body, "pool"]);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (!kit || !layers || !pool) return fallback;
  const T = META.tMax, INK = META.ink;
  const roles = ["skin", "cloth", "accent", "pants"];
  const defs = roles.map((role) => {
    const c = hex(colors[role] || "#808080"), m = (k) => ((T * (c[k] - INK[k])) / 255).toFixed(4), o = (k) => (INK[k] / 255).toFixed(4);
    return `<filter id="${uid}${role}" color-interpolation-filters="sRGB" x="0" y="0" width="1" height="1"><feColorMatrix type="matrix" values="${m(0)} 0 0 0 ${o(0)} 0 ${m(1)} 0 0 ${o(1)} 0 0 ${m(2)} 0 ${o(2)} 0 0 0 1 0"/></filter>`;
  }).join("");
  const draw = (ls) => ls.map(([role, x, y, w, h, href]) => `<image x="${x}" y="${y}" width="${w}" height="${h}" href="${href}" preserveAspectRatio="none"${role === "k" ? "" : ` filter="url(#${uid}${role})"`}/>`).join("");
  // the head: the portrait cut at the oval's bottom (the collar), so only the head and neck show over the body
  const [, , ow, oh] = META.head, s = ow / HEAD_W, cutY = HEAD_TOP + oh / s;
  const ids = kitItems({ ...look, clothing: "shirtless", tie: "none" }, look.hidesHair);
  const bi = ids.findIndex((id) => id === "base" || id === "base-noEars");
  const flat = ["default", "smile", "twinkle", "tongue", "eating"].includes(look.mouth || "default");
  const face = kitFace(kit, { ...look, eyes: "xDizzy", mouth: flat ? "serious" : look.mouth, gender: "m" }, look.hidesHair ? null : colors.hair); // no lashes: blots at this size
  const head = `<g transform="scale(${s}) translate(-140 ${-HEAD_TOP})"><clipPath id="${uid}neck"><rect width="280" height="${cutY.toFixed(1)}"/></clipPath>`
    + `${kitSvg(kit, ids.slice(0, bi), colors)}<g clip-path="url(#${uid}neck)">${kitSvg(kit, [ids[bi]], colors, face)}</g>${kitSvg(kit, ids.slice(bi + 1), colors)}</g>`;
  const html = `<defs>${defs}</defs>${draw(pool)}${draw(layers)}${head}`;
  return <g transform={`translate(32 33) rotate(-34) scale(${K}) translate(${-CX} ${-CY})`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The tutorial's crash-test dummy, redrawn whole (src/corpseKit/dummy.json: one picture on the tile's frame). */
export function DummyCorpse({ fallback = null }) {
  const [pic] = useBodies(["dummy"]);
  if (!pic) return fallback;
  const [x, y, w, h] = pic.box;
  return <image href={pic.src} x={x} y={y} width={w} height={h} preserveAspectRatio="none" />;
}
