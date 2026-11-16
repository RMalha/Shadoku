/**
 * avatarKitLoad.js — loads the avatar kit (src/avatarKit.json: the portrait art made by scripts/avatar-kit/build.mjs) once, in
 * its own chunk, for everything that draws a portrait with it: the player's avatar (AvatarFigure.jsx), the suspects and the
 * victim (ShadokuArt.jsx SuspectFigure) and the corpse (corpseArt.jsx). It imports nothing from ShadokuArt.jsx, so that file
 * can use it without an import cycle. Where the kit cannot load (the standalone bundle has no dynamic import) the kit is
 * `false` and callers draw the older SVG art instead.
 */
import { useEffect, useState } from "react";

let kitData = null; // null = not loaded yet, false = cannot load
let kitPromise = null;
export function loadAvatarKit() {
  if (!kitPromise) kitPromise = import("./avatarKit.json").then((m) => (kitData = m.default || m)).catch(() => (kitData = false));
  return kitPromise;
}
/** The kit: null while it loads, false if it cannot, else the kit. */
export function useAvatarKit() {
  const [kit, setKit] = useState(kitData);
  useEffect(() => {
    let live = true;
    if (kitData === null) loadAvatarKit().then(() => live && setKit(kitData));
    return () => { live = false; };
  }, []);
  return kit;
}
