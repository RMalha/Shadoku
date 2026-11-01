/**
 * ShadokuArt.jsx  --  SHADOKU art engine (pure SVG, no game or UI state)
 * ------------------------------------------------------------------------
 * Everything here is vector art and the data that drives it. The web-app UI
 * (ShadokuApp.jsx) imports from this file, so you can iterate on menus, layout
 * and gameplay without re-sending the sprites.
 *
 *  - Constants / registries: palette, CELL/LAB/PAD, prop classes (PROP_CLASS, propClassOf, TALL / PERCH / SHORT / LOW), BIOMES, BIOME_META,
 *    PROP_BIOME, PROP_ORDER, PROP_NOTE, FIT, FOG ...
 *  - Floors: FLOORS, BIOME_FLOORS, floorOf, assignFloors, FloorDefs, FloorSwatch
 *  - Props & architecture: the prop components, one per prop id. Every prop is now drawn in the new style (art/STYLE.md):
 *    flat fills, OS 1.5 outline with IS 0.9 detail, one shade step, a flat GroundShadow under upright props. Grouped by
 *    biome kit (MANSION, FARM, BEACH, FOREST, MOUNTAINS, DESERT, STREET, UNIVERSAL), with the span-aware ones (RugN / Rug,
 *    BedSpan / Bed, SofaSpan / Sofa, BilliardSpan / BilliardTable, FootprintsSpan / Footprints,
 *    BoatSpan / Boat, OasisPoolSpan / OasisPool, HotPoolSpan / HotPool, CarpetRunner). Helpers: OS, IS, GroundShadow, inkBox, slabTop, slabSide,
 *    polyD, r2, useUid and the LOW-furniture camera lowCam / camTop / camSide / camFront. Registries: SPRITES,
 *    SPAN_SPRITES, PropSprite, PropChip, WallLayer, WindowPane, windowAt, X0, Y0
 *  - Portrait kit: AV (avataaars table), SKIN / HAIR / CLOTH palettes, the look
 *    rules (fixLook, composeLook), Figure, deterministic casting (getCastForPuzzle),
 *    SuspectPolaroid, AdowFigure/AdowPolaroid, MasterPolaroid, AssassinPolaroid (O. B. Scuro, P. H. Obia, Q. U. Yet, R. E. Aper), TokenAvatar, AdowToken
 *
 * Needs only React 18. Every top-level declaration is a named export.
 */
import React, { useId } from "react";
import { useText, tEn } from "./i18n.js";

/* ---- Prop classes (V10): mirror of engine/shadoku_catalog.py -------------------------------------
 *   TALL   nobody stands on it · blocks sight                       (tree, TV, tall safe, dumpster)
 *   PERCH  someone can be on it · blocks sight, but a ray that reaches it sees the occupant and stops
 *   SHORT  nobody stands on it · sight passes over                  (table, crate, barrel, well)
 *   LOW    stand on it · sight passes over                          (rug, bed, umbrella)
 * A case's own "propClasses" ALWAYS wins over this table (CLAUDE.md): resolve a kind with
 * propClassOf(puzzle, kind). CORPSE and VOID are not prop classes and keep their own rules. */
export const PROP_CLASSES = ["LOW", "SHORT", "PERCH", "TALL"]; // also the board's draw order (flush first, upright last)
const CLASS_IDS = {
  TALL: [ // engine catalog
    "ARMOR", "BIRCH", "BOULDER", "CACTUS", "CHANGING_HUT", "CLOCK", "DUMPSTER", "EASEL", "FIREPLACE", "FOUNTAIN", "HAYBALE", "HAY_WAGON",
    "ICE_PILLAR", "LOCKER", "MARKET_STALL", "NEWSSTAND", "OAK", "OBELISK", "PALM", "PHONE_BOOTH", "PILLAR", "PINE", "PLANT", "POSTER_COLUMN",
    "RUINED_WALL", "SAFE", "SCREEN", "SHELF", "SHRUB", "SNOW_PINE", "SPIRAL_STAIRS", "STATUE", "STREETLIGHT", "SURF_RACK", "TENT", "TRACTOR", "TREE",
    "TV", "WARDROBE", "WATER_TOWER", "WINE_RACK", "WOODPILE",
    // front-end-only sprites (not in the catalog; never in an engine case)
    "SCARECROW", "LIFEGUARD_CHAIR", "TOTEM", "SANDSTONE_ARCH",
  ],
  PERCH: ["CAMEL", "HORSE", "PIANO"],
  SHORT: [
    "AMPHORA", "ANCHOR", "BARREL", "BEEHIVE", "BILLIARD_TABLE", "CAIRN", "CAMPFIRE", "CARDBOARD_BOX", "CRATE", "DESK", "DISPLAY_CASE", "FERN", "GRAMOPHONE",
    "HYDRANT", "JUKEBOX", "LANTERN", "SANDCASTLE", "SARCOPHAGUS", "SKI_RACK", "SNOWMAN", "STOVE", "TABLE", "TEA_TROLLEY",
    "TIKI_TORCH", "TRAFFIC_CONE", "TRASH_CAN", "TROUGH", "WASHER", "WELL", "WHEELBARROW",
  ],
  LOW: [
    "BARBER_CHAIR", "BEARSKIN", "BED", "BENCH", "BOAT", "BROKEN_GLASS", "CARPET_RUNNER", "CHAIR", "COOLER", "CUSHION", "DRIFTWOOD", "FAIRY_RING",
    "FALLEN_LOG", "FLOOR_PILLOW", "FOOTPRINTS", "GRATE", "HOT_POOL", "ICE", "MANHOLE", "MOSS", "MUD", "OASIS_POOL", "PUDDLE", "RUG", "SLED",
    "SNOWDRIFT", "SOFA", "STOOL", "STRAW_MAT", "STUMP", "TOWEL", "TRAPDOOR", "UMBRELLA", "WOVEN_MAT",
    // front-end-only sprites
    "FLOOR_GRATE", "BUCKET", "CHICKEN_FEED", "STARFISH", "PICKAXE", "BONES", "SCORPION_NEST",
    "POTTERY_SHARDS", "TRASH_BAG", "GRAFFITI", "CHANDELIER_FALL",
  ],
};
/** Front-end default class per prop id, used only when a case has no "propClasses" entry for the kind. */
export const PROP_CLASS = Object.fromEntries(PROP_CLASSES.flatMap((cls) => CLASS_IDS[cls].map((k) => [k, cls])));
/** Default-class sets (catalog classes; a case's propClasses can differ, so board code should use propClassOf). */
export const TALL = new Set(CLASS_IDS.TALL);
export const PERCH = new Set(CLASS_IDS.PERCH);
export const SHORT = new Set(CLASS_IDS.SHORT);
export const LOW = new Set(CLASS_IDS.LOW);
/** The class of `kind` in puzzle `p`: the case's own propClasses first, then PROP_CLASS. null for floor, CORPSE, VOID and unknown ids. */
export function propClassOf(p, kind) {
  if (!kind || kind === "CORPSE" || kind === "VOID") return null;
  const own = p && p.propClasses && p.propClasses[kind];
  return own || PROP_CLASS[kind] || null;
}
/** Sight stops at TALL and PERCH props (a PERCH tile itself is seen when someone is on it: see buildGeometry). */
export const classBlocksSight = (cls) => cls === "TALL" || cls === "PERCH";
/** Nobody stands on TALL or SHORT props. Like the engine, an unknown kind (null class) is not solid. */
export const classIsSolid = (cls) => cls === "TALL" || cls === "SHORT";
/** Props a suspect can be ON (stand on, sit at or ride): LOW and PERCH. */
export const classIsOccupiable = (cls) => cls === "LOW" || cls === "PERCH";
export const LABEL = {
  TABLE: "Table", PLANT: "Potted Plant", SHELF: "Bookshelf", TV: "TV", STATUE: "Statue", PILLAR: "Pillar",
  SAFE: "Safe", PIANO: "Piano", SCREEN: "Folding Screen", CHAIR: "Chair", RUG: "Rug", BED: "Bed", STOOL: "Stool", CORPSE: "Corpse",
  CRATE: "Crate", BARREL: "Barrel", PUDDLE: "Puddle",
  HAYBALE: "Hay Bale", TRACTOR: "Tractor", WELL: "Stone Well", TREE: "Apple Tree", MUD: "Mud Patch", STRAW_MAT: "Straw Mat",
  PALM: "Palm Tree", UMBRELLA: "Beach Umbrella", SURF_RACK: "Surfboard Rack", TOWEL: "Beach Towel", BOAT: "Boat",
  PINE: "Pine Tree", BOULDER: "Boulder", SHRUB: "Shrub", TENT: "Tent", STUMP: "Tree Stump", MOSS: "Moss Patch",
  SNOW_PINE: "Snow Pine", CAIRN: "Stone Cairn", FIREPLACE: "Fireplace", SLED: "Sled", ICE: "Ice Patch",
  CACTUS: "Cactus", OBELISK: "Obelisk", AMPHORA: "Amphora", OASIS_POOL: "Oasis Pool", WOVEN_MAT: "Woven Mat",
  DUMPSTER: "Dumpster", PHONE_BOOTH: "Phone Booth", HYDRANT: "Fire Hydrant", FOUNTAIN: "Fountain", MANHOLE: "Manhole Cover", GRATE: "Steam Grate",
  // catalog expansion (40)
  EASEL: "Easel", DISPLAY_CASE: "Display Case", CHANDELIER_FALL: "Fallen Chandelier", GRAMOPHONE: "Gramophone",
  SCARECROW: "Scarecrow", TROUGH: "Water Trough", LIFEGUARD_CHAIR: "Lifeguard Chair", TIKI_TORCH: "Tiki Torch", TOTEM: "Totem Pole",
  WOODPILE: "Woodpile", SANDSTONE_ARCH: "Sandstone Arch", STREETLIGHT: "Lamppost", NEWSSTAND: "Newsstand",
  TRAPDOOR: "Trapdoor", FOOTPRINTS: "Footprints", BROKEN_GLASS: "Broken Glass", LANTERN: "Lantern", CUSHION: "Floor Cushion", CARPET_RUNNER: "Carpet Runner", FLOOR_GRATE: "Floor Grate",
  WHEELBARROW: "Wheelbarrow", BUCKET: "Upturned Bucket", CHICKEN_FEED: "Chicken Feed", SANDCASTLE: "Sandcastle", STARFISH: "Stranded Starfish", COOLER: "Cooler", DRIFTWOOD: "Driftwood Log",
  CAMPFIRE: "Campfire", FERN: "Fern", FALLEN_LOG: "Fallen Log", SNOWDRIFT: "Snowdrift", PICKAXE: "Dropped Pickaxe",
  BONES: "Bones", SCORPION_NEST: "Scorpion Nest", POTTERY_SHARDS: "Pottery Shards", FLOOR_PILLOW: "Floor Pillow", TRASH_BAG: "Trash Bag", CARDBOARD_BOX: "Cardboard Box", GRAFFITI: "Graffiti",
  // new art (art/STYLE.md, 2026-10-28)
  HORSE: "Horse", OAK: "Oak Tree", SOFA: "Sofa",
  ARMOR: "Suit of Armor", BILLIARD_TABLE: "Billiard Table", DESK: "Writing Desk", STOVE: "Stove", WINE_RACK: "Wine Rack",
  BARBER_CHAIR: "Barber Chair", BENCH: "Bench", JUKEBOX: "Jukebox", POSTER_COLUMN: "Advertising Column", WASHER: "Washing Machine", WATER_TOWER: "Water Tower",
  BEARSKIN: "Bearskin Rug", FAIRY_RING: "Fairy Ring", SKI_RACK: "Ski Rack", SNOWMAN: "Snowman", ICE_PILLAR: "Ice Column", RUINED_WALL: "Crumbling Wall",
  ANCHOR: "Anchor", CHANGING_HUT: "Bathing Hut", LOCKER: "Locker", CAMEL: "Camel", MARKET_STALL: "Market Stall",
  WARDROBE: "Wardrobe", TRASH_CAN: "Trash Can", BEEHIVE: "Beehive", SARCOPHAGUS: "Sarcophagus",
  BIRCH: "Birch Tree", TRAFFIC_CONE: "Traffic Cone", CLOCK: "Grandfather Clock", TEA_TROLLEY: "Tea Trolley",
  SPIRAL_STAIRS: "Spiral Staircase",
  HAY_WAGON: "Hay Wagon", HOT_POOL: "Hot Pool",
};

/* ---- Biomes: the 7 environments (`p.theme`) ------------------------------ */
export const BIOMES = ["MANSION", "FARM", "BEACH", "FOREST", "MOUNTAINS", "DESERT", "STREET"];
/** Wall-core tint, badge icon and label per environment. Doorway gaps are untouched by the tint. */
export const BIOME_META = {
  MANSION: { label: "Mansion", icon: "🏛️", wall: "#e9e2cf" },
  FARM: { label: "Farm", icon: "🚜", wall: "#b88655" },
  BEACH: { label: "Beach", icon: "🏖️", wall: "#c8b896" },
  FOREST: { label: "Forest", icon: "🌲", wall: "#6e7d52" },
  MOUNTAINS: { label: "Mountains", icon: "🏔️", wall: "#8c969e" },
  DESERT: { label: "Desert", icon: "🏜️", wall: "#d9b382" },
  STREET: { label: "Street", icon: "🏙️", wall: "#a65346" },
};
export const themeOf = (p) => (p && BIOME_META[String(p.theme || "").toUpperCase()] ? String(p.theme).toUpperCase() : "MANSION");
/** Which kit each prop belongs to (drives the Biome Filter in the inspector). A value is one biome, UNIVERSAL, or a list of
 *  biomes for a prop the engine allows in several themes (see `biomesOf`). */
export const PROP_BIOME = {
  PLANT: "MANSION", SHELF: ["MANSION", "FOREST", "MOUNTAINS"], TV: "MANSION", PILLAR: ["MANSION", "DESERT"], SAFE: "MANSION", PIANO: ["MANSION", "STREET"],
  SCREEN: "MANSION", RUG: "MANSION", BED: "MANSION",
  STATUE: ["MANSION", "FOREST", "DESERT", "STREET"], // engine scope: BIOME (shadoku_i18n_schema.json "themes")
  TABLE: "UNIVERSAL", CHAIR: "UNIVERSAL", STOOL: "UNIVERSAL", // shadoku_board.UNIVERSAL_TALL / UNIVERSAL_LOW
  CRATE: "UNIVERSAL", BARREL: "UNIVERSAL", PUDDLE: ["FARM", "BEACH", "FOREST", "MOUNTAINS", "STREET"], CORPSE: "UNIVERSAL",
  HAYBALE: "FARM", TRACTOR: "FARM", WELL: "FARM", TREE: "FARM", MUD: "FARM", STRAW_MAT: "FARM",
  PALM: ["BEACH", "DESERT"], UMBRELLA: "BEACH", SURF_RACK: "BEACH", TOWEL: "BEACH", BOAT: "BEACH",
  PINE: "FOREST", BOULDER: ["BEACH", "FOREST", "MOUNTAINS", "DESERT"], SHRUB: "FOREST", TENT: ["FOREST", "MOUNTAINS"], STUMP: "FOREST", MOSS: "FOREST",
  SNOW_PINE: "MOUNTAINS", CAIRN: "MOUNTAINS", FIREPLACE: ["FOREST", "MOUNTAINS"], SLED: "MOUNTAINS", ICE: "MOUNTAINS",
  CACTUS: "DESERT", OBELISK: "DESERT", AMPHORA: "DESERT", OASIS_POOL: "DESERT", WOVEN_MAT: "DESERT",
  DUMPSTER: "STREET", PHONE_BOOTH: "STREET", HYDRANT: "STREET", FOUNTAIN: "STREET", MANHOLE: "STREET", GRATE: "STREET",
  // catalog expansion (40)
  TRAPDOOR: ["MANSION", "MOUNTAINS", "DESERT", "STREET"], FOOTPRINTS: "UNIVERSAL", BROKEN_GLASS: ["MANSION", "STREET"], LANTERN: ["FOREST", "MOUNTAINS"],
  EASEL: "MANSION", DISPLAY_CASE: ["MANSION", "STREET"], CHANDELIER_FALL: "MANSION", GRAMOPHONE: "MANSION", CUSHION: "MANSION", CARPET_RUNNER: "MANSION", FLOOR_GRATE: "MANSION",
  SCARECROW: "FARM", TROUGH: "FARM", WHEELBARROW: "FARM", BUCKET: "FARM", CHICKEN_FEED: "FARM",
  LIFEGUARD_CHAIR: "BEACH", TIKI_TORCH: "BEACH", SANDCASTLE: "BEACH", STARFISH: "BEACH", COOLER: "BEACH", DRIFTWOOD: "BEACH",
  TOTEM: "FOREST", CAMPFIRE: ["FOREST", "DESERT"], FERN: "FOREST", FALLEN_LOG: "FOREST", WOODPILE: "FOREST",
  SNOWDRIFT: "MOUNTAINS", PICKAXE: "MOUNTAINS",
  SANDSTONE_ARCH: "DESERT", BONES: "DESERT", SCORPION_NEST: "DESERT", POTTERY_SHARDS: "DESERT", FLOOR_PILLOW: "DESERT",
  STREETLIGHT: "STREET", NEWSSTAND: "STREET", TRASH_BAG: "STREET", CARDBOARD_BOX: "STREET", GRAFFITI: "STREET",
  // new art (art/STYLE.md, 2026-10-28)
  HORSE: "FARM", OAK: "FOREST", SOFA: "MANSION",
  ARMOR: "MANSION", BILLIARD_TABLE: "MANSION", DESK: "MANSION", STOVE: "MANSION", WINE_RACK: "MANSION",
  BARBER_CHAIR: "STREET", BENCH: "STREET", JUKEBOX: "STREET", POSTER_COLUMN: "STREET", WASHER: "STREET", WATER_TOWER: "STREET",
  FAIRY_RING: "FOREST", RUINED_WALL: "FOREST", BEARSKIN: ["FOREST", "MOUNTAINS"], SKI_RACK: "MOUNTAINS", SNOWMAN: "MOUNTAINS", ICE_PILLAR: "MOUNTAINS",
  ANCHOR: "BEACH", CHANGING_HUT: "BEACH", LOCKER: ["BEACH", "MOUNTAINS"], CAMEL: "DESERT", MARKET_STALL: "DESERT",
  WARDROBE: "MANSION", TRASH_CAN: "STREET", BEEHIVE: "FARM", SARCOPHAGUS: "DESERT",
  BIRCH: "FOREST", TRAFFIC_CONE: "STREET", CLOCK: "MANSION", TEA_TROLLEY: "MANSION",
  SPIRAL_STAIRS: "BEACH", // engine scope: BIOME, themes [BEACH] (the Lighthouse zone)
  HAY_WAGON: "FARM", HOT_POOL: "MOUNTAINS",
};
export const FILTERS = ["ALL", "UNIVERSAL", ...BIOMES];
export const FILTER_LABEL = { ALL: "All", UNIVERSAL: "Universal", ...Object.fromEntries(BIOMES.map((b) => [b, BIOME_META[b].label])) };
export const FILTER_ICON = { ALL: "✦", UNIVERSAL: "◈", ...Object.fromEntries(BIOMES.map((b) => [b, BIOME_META[b].icon])) };
export const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
export const CELL = 64, LAB = 22, PAD = 8;


// Cozy-noir palette
export const INK = "#1A1A22", SLATE = "#141419", CREAM = "#F5F0E6", CRIMSON = "#C83E3B", BRASS = "#D99B26";
export const WALL = "#e9e2cf", GLASS = "#9fd4ee";
export const SUSPECT_COLORS = ["#f4a259", "#7cc6fe", "#c9a3e6", "#8fd694", "#f78fb3",
  "#efd96b", "#7fe0d4", "#ff9e80", "#b8c4d6", "#a3b1ff", "#e6c79c", "#9fe870",
  "#e58fd8", "#4fb0a6"]; // 13 + 14 (M, N): orchid and deep teal, distinct from the 12 above and legible as uppercase notes

/* ---------------------------------------------------------------------- */
/*  Floors: each room gets an architectural texture, picked by its name     */
/* ---------------------------------------------------------------------- */
export const INDOOR_FLOORS = ["parquet", "checker", "marble", "carpet", "stone", "slate", "terracotta"];
export const FLOORS = [...INDOOR_FLOORS, "grass", "dirt", "sand", "boardwalk", "snow", "canyon", "asphalt", "cobble"];
export const FLOOR_LABEL = {
  parquet: "Parquet wood", checker: "Checker tile", marble: "Marble", carpet: "Carpet", stone: "Flagstone", slate: "Slate tile", terracotta: "Terracotta", water: "Open water",
  grass: "Grass", dirt: "Tilled soil", sand: "Wind-rippled sand", boardwalk: "Boardwalk planks", snow: "Alpine snow", canyon: "Canyon rock", asphalt: "Asphalt", cobble: "Cobble pavers",
};
/** Biome floors, in the order the per-biome pools below hand them out. */
export const BIOME_FLOORS = { MANSION: INDOOR_FLOORS, FARM: ["grass", "dirt", "boardwalk", "parquet", "stone", "slate"],
  BEACH: ["sand", "boardwalk", "stone", "slate", "grass", "terracotta"], FOREST: ["grass", "dirt", "stone", "slate", "boardwalk", "parquet"],
  MOUNTAINS: ["snow", "stone", "slate", "parquet", "boardwalk", "canyon"], DESERT: ["sand", "canyon", "stone", "terracotta", "grass", "carpet"],
  STREET: ["asphalt", "cobble", "slate", "stone", "checker", "parquet"] };
export const FLOOR_RULES = [ // the mansion rules (unchanged)
  [/bed|dormitory/i, "carpet"], [/kitchen|refectory/i, "checker"], [/bath/i, "marble"],
  [/sculpture|lobby|foyer/i, "marble"], [/vault|chapel|gatehouse/i, "stone"],
  [/conservatory|terrace|courtyard|garden/i, "terracotta"], [/corridor|hallway|passage/i, "slate"],
  [/study|library|den|parlor|parlour|smoking|drawing|gallery|living|scriptorium|office/i, "parquet"],
];
/** Indoor zones in an outdoor biome still get indoor flooring: a Diner is checker, a Ski Lodge is parquet. */
export const INDOOR_RULES = [
  [/diner|caf[eé]|kitchen|canteen|refectory/i, "checker"], [/lodge|cabin|chalet|barber|shop|store|office|library|study|parlou?r|bedroom|lounge/i, "parquet"],
  [/bath/i, "marble"], [/lobby|foyer/i, "marble"],
];
export const BIOME_RULES = {
  FARM: [[/orchard|pasture|field|meadow|garden/i, "grass"], [/yard|pen\b|barnyard|silo|paddock|mud/i, "dirt"], [/barn|shed|porch|stable|loft|coop|farmhouse|granary/i, "boardwalk"]],
  BEACH: [[/tide|reef|rock/i, "slate"], [/cove|dune|sand|shore|beach|bay|lagoon/i, "sand"], [/lighthouse|ruin|fort/i, "stone"], [/shack|boardwalk|pier|dock|hut|cabana/i, "boardwalk"]],
  FOREST: [[/clearing|meadow|glade/i, "grass"], [/creek|stream|river|pond|lake|brook/i, "slate"], [/grove|trail|camp|path/i, "dirt"], [/ruin|temple|tomb|fort|castle/i, "stone"]],
  MOUNTAINS: [[/ridge|summit|ledge|peak|slope|ice|cave/i, "snow"], [/cliff|trail/i, "stone"], [/station|hut|refuge|tower/i, "slate"]],
  DESERT: [[/tent|caravan|bazaar|market/i, "carpet"], [/tomb|temple|ruin|pyramid|sphinx/i, "stone"], [/oasis|palm|garden/i, "grass"], [/dune|sand/i, "sand"], [/canyon|mesa|pass|gorge|rock|cliff/i, "canyon"]],
  STREET: [[/rooftop|roof|alley|crosswalk|crossing|road|street|lane|avenue|parking/i, "asphalt"], [/corner|plaza|sidewalk|square|market|newsstand|stand|courtyard/i, "cobble"], [/subway|station|metro|underpass/i, "slate"]],
};
export function floorOf(name, id, theme = "MANSION") {
  const t = BIOME_META[String(theme || "").toUpperCase()] ? String(theme).toUpperCase() : "MANSION", n = name || "";
  if (t === "MANSION") {
    const hit = FLOOR_RULES.find(([re]) => re.test(n));
    return hit ? hit[1] : INDOOR_FLOORS[Math.abs(id) % INDOOR_FLOORS.length];
  }
  const hit = INDOOR_RULES.find(([re]) => re.test(n)) || BIOME_RULES[t].find(([re]) => re.test(n));
  return hit ? hit[1] : BIOME_FLOORS[t][Math.abs(id) % BIOME_FLOORS[t].length];
}
/**
 * One floor per room, by name, but never the same floor on two rooms that share a wall or doorway: a clashing room
 * moves to the next-best texture of its biome that none of its neighbours (and as few other rooms as possible) already use.
 */
/** When two touching rooms want the same floor, the loser takes the closest-looking texture instead of an arbitrary one. */
export const FLOOR_ALT = {
  grass: ["dirt", "stone", "slate"], dirt: ["grass", "boardwalk", "stone"], sand: ["boardwalk", "stone", "slate"], boardwalk: ["parquet", "dirt", "slate"],
  snow: ["slate", "stone", "canyon"], canyon: ["stone", "sand", "terracotta"], asphalt: ["cobble", "slate", "stone"], cobble: ["asphalt", "stone", "slate"],
  stone: ["slate", "cobble"], slate: ["stone", "cobble"], parquet: ["boardwalk", "carpet"], checker: ["slate", "marble"],
};
export function assignFloors(p, geo) {
  const theme = themeOf(p), pool = BIOME_FLOORS[theme];
  const ids = [], nb = {};
  for (let r = 0; r < geo.R; r++) for (let c = 0; c < geo.C; c++) {
    const a = geo.room(r, c);
    if (a < 0) continue;
    if (!(a in nb)) { nb[a] = new Set(); ids.push(a); }
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const r1 = r + dr, c1 = c + dc;
      if (r1 >= geo.R || c1 >= geo.C) continue;
      const b = geo.room(r1, c1);
      if (b < 0 || b === a) continue;
      if (!(b in nb)) { nb[b] = new Set(); ids.push(b); }
      nb[a].add(b); nb[b].add(a);
    }
  }
  ids.sort((x, y) => x - y);
  const out = {};
  for (const id of ids) {
    const want = floorOf(p.roomNames[id], id, theme);
    const taken = new Set([...nb[id]].map((n) => out[n]).filter(Boolean));
    if (!taken.has(want)) { out[id] = want; continue; }
    const used = new Set(Object.values(out));
    const alts = theme === "MANSION" ? [] : (FLOOR_ALT[want] || []).filter((f) => pool.includes(f));
    const free = pool.filter((f) => !taken.has(f));
    out[id] = alts.find((f) => !taken.has(f)) || free.find((f) => !used.has(f)) || free[0] || want;
  }
  return out;
}


/* ---------------------------------------------------------------------- */
/*  Small colour helper                                                    */
/* ---------------------------------------------------------------------- */
export function mix(hex, amt) { // amt > 0 lightens toward white, < 0 darkens toward black
  const n = parseInt(hex.slice(1), 16);
  const t = amt < 0 ? 0 : 255, a = Math.abs(amt);
  const ch = (v) => Math.round(v + (t - v) * a);
  return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, "0")).join("");
}
export const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/* ---------------------------------------------------------------------- */
/*  Floor textures (seamless 64×64 tiles, aligned to the board grid)        */
/* ---------------------------------------------------------------------- */
export function FloorDefs({ align = true }) {
  const pt = align ? `translate(${LAB} ${LAB})` : undefined;
  const P = (id, children) => (
    <pattern id={`skf-${id}`} width="64" height="64" patternUnits="userSpaceOnUse" patternTransform={pt}>{children}</pattern>
  );
  const plankShades = ["#b98a5a", "#c4966a", "#ad7f50"];
  const planks = [];
  for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) {
    planks.push(<rect key={`${i}${k}`} x={k * 32 - (i % 2) * 16} y={i * 16} width="32" height="16"
      fill={plankShades[(i * 2 + k) % 3]} stroke="#7d5330" strokeWidth=".9" />);
  }
  const weave = [];
  for (let i = 0; i < 16; i++) weave.push(<path key={i} d={`M0 ${i * 4 + 2}H64`} stroke="#93404d" strokeWidth=".6" strokeOpacity=".55" />);
  const specks = [[6, 8], [22, 14], [50, 6], [14, 40], [44, 34], [58, 52], [30, 58], [8, 56], [38, 20]];
  const tufts = [[8, 12], [30, 8], [54, 20], [20, 32], [44, 30], [10, 48], [36, 52], [58, 58], [26, 22], [60, 40]];
  return (
    <defs>
      {P("parquet", <>
        {planks}
        <path d="M4 5H26M38 21H60M10 38H30M40 54H58M2 22H12" stroke="#8a5f38" strokeWidth=".6" strokeOpacity=".6" />
      </>)}
      {P("checker", <>
        <rect width="64" height="64" fill="#d9d2bf" />
        <rect width="32" height="32" fill="#39434d" /><rect x="32" y="32" width="32" height="32" fill="#39434d" />
        <rect x="1" y="1" width="62" height="62" fill="none" stroke="#000" strokeOpacity=".08" />
        <path d="M32 0V64M0 32H64" stroke="#000" strokeOpacity=".12" />
      </>)}
      {P("marble", <>
        <rect width="64" height="64" fill="#e2ded6" />
        <path d="M0 20C16 14 30 34 64 26" fill="none" stroke="#b9b3a6" strokeWidth="1.3" />
        <path d="M10 64C22 44 40 52 64 40" fill="none" stroke="#cfc9bc" strokeWidth="2.6" strokeOpacity=".7" />
        <path d="M30 0C26 16 40 24 34 44" fill="none" stroke="#c4beb0" strokeWidth=".9" />
        <rect x=".5" y=".5" width="63" height="63" fill="none" stroke="#b3ad9f" strokeWidth="1" />
      </>)}
      {P("carpet", <><rect width="64" height="64" fill="#7b2f3b" />{weave}
        <rect x="3" y="3" width="58" height="58" fill="none" stroke="#5c1f2a" strokeOpacity=".5" /></>)}
      {P("stone", <>
        <rect width="64" height="64" fill="#8b8d8c" />
        <rect x="1" y="1" width="38" height="28" fill="#979998" stroke="#5c5f5f" strokeWidth="1.6" />
        <rect x="39" y="1" width="24" height="40" fill="#828483" stroke="#5c5f5f" strokeWidth="1.6" />
        <rect x="1" y="29" width="28" height="34" fill="#868887" stroke="#5c5f5f" strokeWidth="1.6" />
        <rect x="29" y="41" width="34" height="22" fill="#9a9c9b" stroke="#5c5f5f" strokeWidth="1.6" />
        {specks.map(([x, y], i) => <circle key={i} cx={x} cy={y} r=".9" fill="#5c5f5f" fillOpacity=".55" />)}
      </>)}
      {P("slate", <>
        <rect width="64" height="64" fill="#4d6a5c" />
        <path d="M0 0H64V64H0Z M32 0V64 M0 32H64" fill="none" stroke="#2f4439" strokeWidth="1.6" />
        <path d="M4 12L14 4M36 44L48 34" stroke="#6f8d7e" strokeWidth="1" strokeOpacity=".6" />
      </>)}
      {P("terracotta", <>
        <rect width="64" height="64" fill="#b5663d" />
        {[0, 16, 32, 48].map((y) => [0, 16, 32, 48].map((x) => (
          <rect key={`${x}${y}`} x={x + 1} y={y + 1} width="14" height="14" fill={(x + y) % 32 ? "#bd7048" : "#ad5f37"} stroke="#8a4a2a" strokeWidth="1" />
        )))}
      </>)}
      {P("grass", <>
        <rect width="64" height="64" fill="#5f8f3f" />
        <circle cx="14" cy="16" r="15" fill="#6a9a46" fillOpacity=".7" /><circle cx="48" cy="44" r="17" fill="#548537" fillOpacity=".7" />
        <circle cx="52" cy="10" r="9" fill="#6a9a46" fillOpacity=".5" /><circle cx="8" cy="52" r="10" fill="#6a9a46" fillOpacity=".5" />
        {tufts.map(([x, y], i) => <path key={i} d={`M${x} ${y}l-1.6-4M${x} ${y}l.4-5M${x} ${y}l2-4`} stroke={i % 2 ? "#3f6a2a" : "#86b45a"} strokeWidth="1" strokeLinecap="round" />)}
      </>)}
      {P("dirt", <>
        <rect width="64" height="64" fill="#7a5336" />
        {[6, 18, 30, 42, 54].map((y, i) => <path key={y} d={`M0 ${y}C16 ${y - 4} 32 ${y + 4} 48 ${y} S64 ${y - 2} 64 ${y}`} fill="none" stroke={i % 2 ? "#5e3d26" : "#8c6444"} strokeWidth="3" strokeLinecap="round" />)}
        {specks.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 3 ? 1.1 : 1.8} fill={i % 2 ? "#a47c58" : "#4a2f1d"} fillOpacity=".7" />)}
      </>)}
      {P("sand", <>
        <rect width="64" height="64" fill="#e3c88f" />
        {[8, 24, 40, 56].map((y, i) => <path key={y} d={`M0 ${y}C10 ${y - 5} 22 ${y + 5} 32 ${y}S54 ${y - 5} 64 ${y}`} fill="none" stroke={i % 2 ? "#cfae6e" : "#f0dba8"} strokeWidth="1.6" strokeOpacity=".85" />)}
        {specks.map(([x, y], i) => <circle key={i} cx={x} cy={y} r=".8" fill="#b8955a" fillOpacity=".6" />)}
      </>)}
      {P("boardwalk", <>
        <rect width="64" height="64" fill="#8f7a62" />
        {[0, 1, 2, 3].map((i) => <g key={i}>
          <rect x="0" y={i * 16} width="64" height="16" fill={["#a08a70", "#97826a", "#a99479", "#9a856c"][i]} stroke="#4f3f2f" strokeWidth="1.2" />
          <path d={`M${6 + i * 11} ${i * 16 + 4}H${30 + i * 6}M${34 - i * 4} ${i * 16 + 11}H${58}`} stroke="#6f5c47" strokeWidth=".6" strokeOpacity=".7" />
          <circle cx={4} cy={i * 16 + 8} r="1" fill="#3a2e22" /><circle cx={60} cy={i * 16 + 8} r="1" fill="#3a2e22" />
        </g>)}
      </>)}
      {P("snow", <>
        <rect width="64" height="64" fill="#e8f1f6" />
        <ellipse cx="18" cy="20" rx="20" ry="10" fill="#fff" fillOpacity=".85" /><ellipse cx="50" cy="48" rx="22" ry="11" fill="#d3e3ee" fillOpacity=".85" />
        <ellipse cx="54" cy="12" rx="12" ry="6" fill="#d3e3ee" fillOpacity=".6" /><ellipse cx="10" cy="54" rx="12" ry="6" fill="#fff" fillOpacity=".7" />
        {specks.map(([x, y], i) => <circle key={i} cx={x} cy={y} r=".9" fill="#9fb9c9" fillOpacity=".7" />)}
      </>)}
      {P("canyon", <>
        <rect width="64" height="64" fill="#b4573a" />
        {[10, 26, 42, 58].map((y, i) => <path key={y} d={`M0 ${y}C12 ${y - 3} 24 ${y + 3} 36 ${y}S56 ${y - 3} 64 ${y}`} fill="none" stroke={["#c9704a", "#8e3f28", "#d98a5c", "#9c4a30"][i]} strokeWidth={i % 2 ? 3 : 4.5} strokeOpacity=".75" />)}
        <path d="M8 6L18 10M40 30L52 26M20 46L30 52M50 58L58 54" stroke="#6b2d1c" strokeWidth="1.2" strokeOpacity=".6" strokeLinecap="round" />
      </>)}
      {P("asphalt", <>
        <rect width="64" height="64" fill="#3a3c42" />
        {specks.concat([[2, 30], [26, 4], [60, 24], [36, 46], [18, 26]]).map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 3 ? .8 : 1.3} fill={i % 2 ? "#5b5e66" : "#26272b"} fillOpacity=".8" />)}
        <path d="M0 40C14 38 26 44 40 41S58 38 64 40" fill="none" stroke="#1f2023" strokeWidth="1" strokeOpacity=".8" />
        <path d="M44 0L40 14L46 22" fill="none" stroke="#25262a" strokeWidth=".9" strokeOpacity=".8" />
      </>)}
      {P("cobble", <>
        <rect width="64" height="64" fill="#6a6560" />
        {[[1, 1, 18, 14], [21, 1, 20, 14], [43, 1, 20, 14], [1, 17, 12, 14], [15, 17, 22, 14], [39, 17, 24, 14],
          [1, 33, 20, 14], [23, 33, 18, 14], [43, 33, 20, 14], [1, 49, 14, 14], [17, 49, 24, 14], [43, 49, 20, 14]].map(([x, y, w, h], i) =>
          <rect key={i} x={x} y={y} width={w} height={h} rx="3" fill={["#8a847d", "#7c766f", "#948e86", "#847e77"][i % 4]} stroke="#4a4642" strokeWidth="1" />)}
      </>)}
      {P("water", <>
        <rect width="64" height="64" fill="#2c8bb0" />
        {[8, 24, 40, 56].map((y, i) => <path key={y} d={`M${i % 2 ? -8 : 0} ${y}Q${i % 2 ? 0 : 8} ${y - 5} ${i % 2 ? 8 : 16} ${y}T${i % 2 ? 24 : 32} ${y}T${i % 2 ? 40 : 48} ${y}T${i % 2 ? 56 : 64} ${y}T${i % 2 ? 72 : 80} ${y}`} fill="none" stroke={i % 2 ? "#4fa9cb" : "#6cc3e0"} strokeWidth="1.7" strokeOpacity=".8" />)}
        {[[10, 14], [38, 6], [52, 30], [20, 44], [46, 58], [6, 34]].map(([x, y], i) => <path key={i} d={`M${x} ${y}l4-1`} stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeOpacity=".55" />)}
      </>)}
      <radialGradient id="skGlow">
        <stop offset="0" stopColor="#ffd9a0" stopOpacity=".42" />
        <stop offset="1" stopColor="#ffd9a0" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}



/* ---------------------------------------------------------------------- */
/*  64×64 prop sprites · ONE shared camera                                   */
/*                                                                          */
/*  Every prop is drawn in the new style (art/STYLE.md): flat fills, an      */
/*  outline of OS (1.5) with IS (0.9) detail lines, one shade step, a flat    */
/*  GroundShadow blob under upright props (LOW props stay flush, no shadow). */
/*  TALL props use the board's 45° oblique, SHORT props the steeper          */
/*  waist-height oblique (slabTop / slabSide), LOW furniture lowCam; flat     */
/*  floor items are top-down footprints.                                     */
/*  Every sprite draws inside a 64×64 box; the board places it by translate.  */
/* ---------------------------------------------------------------------- */
/** Outline for every prop (art/STYLE.md, revised 2026-10-29): 1.5 board units on every prop and span size, close to
 *  the suspect avatars' outline. */
export const OS = { stroke: INK, strokeWidth: 1.5, strokeLinejoin: "round", strokeLinecap: "round" };

/* ---- New-art helpers (art/STYLE.md, art direction 2026-10-28) ---------------------------------------
 * Flat fills, one shade step per material, at most one highlight, a dark inked outline (OS, 1.5, on the
 * outer silhouette, IS, 0.9, for interior lines) and a flat translucent GroundShadow under upright props.
 * LOW props stay flush: no shadow. Design sources live in art/props/<ID>.svg. */
/** Interior ink line for new art (the outer silhouette uses OS). */
export const IS = { stroke: INK, strokeWidth: 0.9, strokeLinejoin: "round", strokeLinecap: "round", fill: "none" };
/** Flat translucent blob under an upright prop's base. */
export const GroundShadow = ({ cx = 32, cy = 57, rx = 22, ry = 4 }) => <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#000" fillOpacity=".34" />;
/** Hand-inked rounded box: each side bows a little (top and bottom out, left and right in), so outlines wobble
 *  like a brush line instead of ruling dead straight. Returns a path `d`. */
export function inkBox(x, y, w, h, r = 2, j = 0.5) {
  const f = (n) => +n.toFixed(2), X = x + w, Y = y + h, mx = x + w / 2, my = y + h / 2;
  return `M${f(x + r)} ${f(y)}Q${f(mx)} ${f(y - j)} ${f(X - r)} ${f(y)}Q${f(X)} ${f(y)} ${f(X)} ${f(y + r)}Q${f(X - j)} ${f(my)} ${f(X)} ${f(Y - r)}`
    + `Q${f(X)} ${f(Y)} ${f(X - r)} ${f(Y)}Q${f(mx)} ${f(Y + j)} ${f(x + r)} ${f(Y)}Q${f(x)} ${f(Y)} ${f(x)} ${f(Y - r)}Q${f(x + j)} ${f(my)} ${f(x)} ${f(y + r)}Q${f(x)} ${f(y)} ${f(x + r)} ${f(y)}Z`;
}

/* ---- MANSION furniture: TABLE, PLANT, SHELF, TV, STATUE, PILLAR, SAFE, PIANO, SCREEN ---- */

/** SHORT. Chestnut table at waist height (SHORT camera, like the desk): a plank top seen from above with a cream linen
 *  runner laid front to back and hanging over the front edge, a blue jug of flowers and a bowl of fruit on it, an apron
 *  and four square legs. Neutral mid-brown wood with a cream accent, so it reads on wooden, stone, tiled and grass floors. */
export function Table() {
  const wood = "#8f5a33", woodL = "#b57b4b", woodD = "#5e3920", linen = "#efe6cf", linenD = "#cdbf9b", band = "#b5524a";
  const jug = "#6f8fa6", leaf = "#4c7a5e", bowl = "#e7d8b4";
  const x = 8, y = 33, w = 42, dx = 6, dy = 13, t = 3.6; // top: front edge y 33, back edge y 20, east side to x 56
  const P = (uu, v) => [r2(x + uu * w + v * dx), r2(y - v * dy)];
  const leg = (lx, ly, h, f) => <path d={inkBox(lx, ly, 4, h, .8, .2)} fill={f} {...OS} />;
  const [jx, jy] = P(.53, .6), [bx, by] = P(.2, .45);
  const r0 = P(.41, 0)[0], r1 = P(.63, 0)[0]; // runner, front edge
  return (
    <g>
      <GroundShadow cx={33} cy={57} rx={25} ry={3.4} />
      {/* back legs, the east apron between the east legs, the front apron */}
      {leg(16, 24, 19.4, woodD)}
      {leg(50, 24, 19.4, woodD)}
      <path d={slabSide(14, 36.6, 34, 4.4, 6, 13)} fill={woodD} {...OS} />
      <path d={inkBox(12, 36.4, 34, 4.6, .6, .2)} fill={wood} {...OS} />
      {/* front legs */}
      {leg(10, 35.6, 20.8, wood)}
      {leg(44, 35.6, 20.8, wood)}
      {/* top: east edge, plank top with two seams, front edge */}
      <path d={slabSide(x, y, w, t, dx, dy)} fill={woodD} {...OS} />
      <path d={slabTop(x, y, w, dx, dy)} fill={woodL} {...OS} />
      {[.34, .67].map((v) => <path key={v} d={`M${P(0, v).join(" ")}L${P(1, v).join(" ")}`} {...IS} />)}
      <path d={inkBox(x, y, w, t, .8, .2)} fill={wood} {...OS} />
      {/* linen runner: across the top, then hanging over the front edge with a red band and a fringe */}
      <path d={planeQuad(P, .41, 0, .63, .94)} {...IS} fill={linen} />
      <path d={inkBox(r0, y - .2, r1 - r0, 7.2, .6, .1)} {...IS} fill={linen} />
      <path d={`M${r0 + .6} 38.2H${r1 - .6}`} stroke={band} strokeWidth="1.2" />
      <path d={Array.from({ length: 6 }, (_, k) => `M${r2(r0 + 1 + k * (r1 - r0 - 2) / 5)} 40.4v1.6`).join("")} stroke={linenD} strokeWidth=".9" strokeLinecap="round" />
      {/* bowl of fruit */}
      {[[-2.6, -1.6, "#c45970"], [2.4, -1.8, BRASS], [0, -3.2, "#7fa65a"]].map(([ox, oy, c]) => <circle key={c} cx={r2(bx + ox)} cy={r2(by + oy)} r="2.1" {...IS} fill={c} />)}
      <path d={`M${r2(bx - 5)} ${r2(by - 1)}Q${r2(bx - 4.6)} ${r2(by + 2.6)} ${bx} ${r2(by + 2.6)}Q${r2(bx + 4.6)} ${r2(by + 2.6)} ${r2(bx + 5)} ${r2(by - 1)}Z`} {...IS} fill={bowl} />
      {/* jug of flowers: stems and heads, the jug, its handle */}
      <path d={`M${jx} ${r2(jy - 6)}L${r2(jx - 3.4)} ${r2(jy - 11)}M${jx} ${r2(jy - 6)}L${r2(jx + .6)} ${r2(jy - 12.6)}M${jx} ${r2(jy - 6)}L${r2(jx + 3.8)} ${r2(jy - 10.2)}`} stroke={leaf} strokeWidth="1.2" strokeLinecap="round" />
      <path d={`M${r2(jx - 1)} ${r2(jy - 8)}q-3 -.6 -3.6 1.6q2.6 .4 3.6 -1.6Z`} {...IS} fill={leaf} />
      {[[-3.4, -11, "#c45970"], [.6, -12.6, BRASS], [3.8, -10.2, "#e8e2d4"]].map(([ox, oy, c]) => <circle key={c} cx={r2(jx + ox)} cy={r2(jy + oy)} r="1.8" {...IS} fill={c} />)}
      <path d={`M${r2(jx + 2.4)} ${r2(jy - 4.6)}Q${r2(jx + 5.4)} ${r2(jy - 4.4)} ${r2(jx + 2.8)} ${r2(jy - 1.2)}`} fill="none" stroke={INK} strokeWidth="1.1" strokeLinecap="round" />
      <path d={`M${r2(jx - 3)} ${jy}Q${r2(jx - 4.2)} ${r2(jy - 3.6)} ${r2(jx - 1.8)} ${r2(jy - 6)}H${r2(jx + 1.8)}Q${r2(jx + 4.2)} ${r2(jy - 3.6)} ${r2(jx + 3)} ${jy}Q${jx} ${r2(jy + 1.2)} ${r2(jx - 3)} ${jy}Z`} {...IS} fill={jug} />
    </g>
  );
}

/** TALL. Potted plant, a big leafy one: a terracotta pot (banded rim, east side shaded) whose dark soil shows inside the
 *  rim, and growing out of that soil a dense fan of about twenty long, ribbed leaves on short stems, arching up to about
 *  head height and beyond (nearly the whole tile tall), the far leaves one shade darker, a few lit ones in front, and
 *  two front leaves that spill over the rim and hang down in front of the pot, so the plant clearly grows from inside
 *  it. Leafy green on terracotta, so it reads on parquet, marble, carpet and terracotta floors. */
export function Plant() {
  const leaf = "#3f8a52", leafD = "#2b6a3d", leafL = "#5fa564", rib = "#1f4d2e", stem = "#6f7a3a";
  const pot = "#b5653a", potD = "#8a4a26", potL = "#cf8658", soil = "#3a2414";
  const sy = 38.6; // the soil line inside the rim
  // a leaf: a lens from its base to its tip, bowed sideways by `bend`, `w` wide at its belly, with a midrib
  const lens = (b, t, bend, w) => {
    const dx = t[0] - b[0], dy = t[1] - b[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
    const cx = (b[0] + t[0]) / 2 + nx * bend, cy = (b[1] + t[1]) / 2 + ny * bend;
    const f = (q) => `${r2(q[0])} ${r2(q[1])}`;
    return { d: `M${f(b)}Q${f([cx + nx * w, cy + ny * w])} ${f(t)}Q${f([cx - nx * w, cy - ny * w])} ${f(b)}Z`, rib: `M${f(b)}Q${f([cx, cy])} ${f(t)}` };
  };
  // [stem foot x on the soil, leaf base (top of its stem), tip, bend, width]
  const back = [[30, [28, 33], [9, 8], -4, 7.4], [34, [36, 33], [55, 8], 4, 7.4], [32, [32, 32], [32, 1.4], 1.6, 7], [29, [27, 35], [3, 22], -3, 6.6],
    [35, [37, 35], [61, 21], 3, 6.6], [31, [30, 32], [19, 2.4], -2, 6.8], [33, [34, 32], [45, 2.2], 2, 6.8]];
  const mid = [[30, [28, 34], [5, 14], -5, 7.4], [34, [36, 34], [59, 13.4], 5, 7.4], [31, [30, 33], [13.6, 6], -3, 7.2], [33, [34, 33], [50.6, 6.4], 3, 7.2],
    [31.4, [31, 33], [25, 4], 1.4, 6.8], [32.6, [33, 33], [39.6, 4.2], -1.4, 6.8], [29.6, [28, 36], [4.4, 31], -3, 6], [34.4, [36, 36], [60, 31], 3, 6]];
  const lit = [[31, [30, 34], [17.6, 16], -2.6, 6.4], [33, [34, 34], [46.4, 15.6], 2.6, 6.4], [32, [32, 34], [31, 11], 1.2, 6]];
  // front leaves: from the soil, up over the rim and hanging down in front of the pot
  const front = [[[29.4, sy - .6], [12.6, 47], -6.4, 6], [[34.6, sy - .6], [51.4, 47.4], 6.4, 6]];
  const stems = [...back, ...mid, ...lit].map(([fx, b]) => `M${fx} ${sy}Q${r2((fx + b[0]) / 2)} ${r2(sy - 3)} ${b[0]} ${b[1]}`).join("");
  const draw = (list, fill, key) => list.map(([, b, t, bend, w], i) => {
    const fr = lens(b, t, bend, w);
    return <g key={`${key}${i}`}><path d={fr.d} fill={fill} {...OS} /><path d={fr.rib} {...IS} stroke={rib} /></g>;
  });
  return (
    <g>
      <GroundShadow cx={32} cy={57.4} rx={19} ry={3.2} />
      {/* pot: tapered body with its east side shaded, the banded rim, the soil inside it */}
      <path d="M19.4 43L22.6 56.2Q32 59.2 41.4 56.2L44.6 43Z" fill={pot} {...OS} />
      <path d="M38.4 43H44.6L41.4 56.2Q40 56.7 38.6 57Z" fill={potD} />
      <path d="M24 47.4Q32 50 40 47.4" {...IS} />
      <path d="M16 38A16 3.6 0 0 0 48 38V43.6A16 3.6 0 0 1 16 43.6Z" fill={potL} {...OS} />
      <path d="M41.6 41.4L42 46.6Q45 45.6 48 43.6V38Z" fill={pot} />
      <ellipse cx="32" cy="38" rx="16" ry="3.6" fill={potL} {...OS} />
      <ellipse cx="32" cy="38.4" rx="13.4" ry="2.5" {...IS} fill={soil} />
      {/* the plant growing out of the soil: stems, far leaves, then the near and lit leaves */}
      <path d={stems} fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <path d={stems} fill="none" stroke={stem} strokeWidth="1" strokeLinecap="round" />
      {draw(back, leafD, "b")}
      {draw(mid, leaf, "m")}
      {draw(lit, leafL, "l")}
      {/* leaves spilling over the rim, in front of the pot */}
      {front.map(([b, t, bend, w], i) => {
        const fr = lens(b, t, bend, w);
        return <g key={`f${i}`}><path d={fr.d} fill={leaf} {...OS} /><path d={fr.rib} {...IS} stroke={rib} /></g>;
      })}
    </g>
  );
}

/** TALL. Floor-to-ceiling bookcase, 2 m, clearly taller than a person: a warm oak carcass with its top and east side
 *  showing, a cornice, four shelves of colourful leaning books with a red vase on one, and a cupboard with two doors
 *  and brass knobs at the bottom, on a dark kick plate. */
export function Shelf() {
  const oak = "#8a5a36", oakL = "#b58250", oakD = "#5e3b22", inside = "#2e1c0c", board = "#a06e3e", brass = BRASS;
  const x = 12, y = 6, w = 38, h = 49, d = 5; // front 12..50 x 6..55, top to y 1, east side to x 55
  const ix = 15.4, iw = 31.2, top0 = 10.6, rowH = 8.4;
  const palette = ["#c83e3b", "#d99b26", "#2f5d8a", "#3f7d52", "#e6dcc2", "#7a4a8a", "#b5653a", "#35858b"];
  // each book [width, height, colour]; one per row leans on its neighbour
  const rows = [
    [[3, 6, 0], [2.4, 5, 1], [3.2, 6.2, 2], [2.6, 5.4, 3], [3, 6, 4], [3.4, 6.2, 5], [2.6, 5, 6], [3, 5.8, 7], [3.2, 6.2, 1]],
    [[3, 5.6, 3], [2.4, 6.2, 0], [3.2, 5, 7], [3.4, 6, 1], [2.4, 5.6, 5], [3, 5.2, 2], [3.2, 6.1, 6], [2.6, 5, 4]],
    [[2.8, 6.2, 4], [3.2, 5.2, 2], [2.4, 6.2, 6], [3, 5.6, 0], [2.8, 5, 1], [3.4, 6, 3], [2.4, 5.4, 5], [3, 6, 7], [2.6, 5.2, 0]],
    [[3.2, 5.4, 7], [2.6, 6, 5], [3, 5.2, 1], [3.4, 6.2, 4], [2.6, 5.4, 2], [3, 6, 6], [3, 5, 3], [2.8, 5.8, 0]],
  ];
  const lean = [2, 4, 1, 5]; // index of the leaning book in each row
  const books = rows.map((row, ri) => {
    const floorY = top0 + (ri + 1) * rowH - 1.6;
    let cx = ix + 1;
    const out = [];
    row.forEach(([bw, bh, ci], bi) => {
      const lh = lean[ri] === bi ? 12 : 0;
      if (cx + bw > ix + iw - 1) return;
      const col = palette[ci % palette.length];
      out.push(
        <g key={`${ri}-${bi}`} transform={lh ? `rotate(${lh} ${r2(cx + bw)} ${r2(floorY)})` : undefined}>
          <rect x={r2(cx)} y={r2(floorY - bh)} width={r2(bw - .3)} height={bh} rx=".4" {...IS} fill={col} />
          <path d={`M${r2(cx + .5)} ${r2(floorY - bh + 1.2)}H${r2(cx + bw - .8)}`} stroke="#fff" strokeOpacity=".55" strokeWidth=".6" />
        </g>
      );
      cx += bw + (lh ? bh * Math.sin((lh * Math.PI) / 180) : .1);
    });
    return out;
  });
  const floor3 = top0 + 4 * rowH - 1.6; // row 4 (index 3) sits on this board
  return (
    <g>
      <GroundShadow cx={33} cy={57} rx={22} ry={3.4} />
      <path d={slabSide(x, y, w, h, d, d)} fill={oakD} {...OS} />
      <path d={slabTop(x, y, w, d, d)} fill={oakL} {...OS} />
      <path d={inkBox(x, y, w, h, 1.2, .4)} fill={oak} {...OS} />
      {/* cornice, kick plate */}
      <path d={inkBox(x - 1, y - .6, w + 2, 4, .8, .2)} fill={oakL} {...OS} />
      <path d={inkBox(x + 1, 52.2, w - 2, 3.6, .6, .2)} fill={oakD} {...OS} />
      {/* the recess, its boards, then the books */}
      <path d={inkBox(ix, top0, iw, 4 * rowH, .8, .2)} {...IS} fill={inside} />
      {[1, 2, 3].map((k) => <rect key={k} x={ix} y={r2(top0 + k * rowH - 1.6)} width={iw} height="1.6" fill={board} />)}
      <rect x={ix} y={r2(floor3)} width={iw} height="1.6" fill={board} />
      {books}
      {/* a red vase on the second row's right end, standing in front of the books */}
      <path d={`M${r2(ix + iw - 7)} ${r2(top0 + 2 * rowH - 1.6)}Q${r2(ix + iw - 8.4)} ${r2(top0 + 2 * rowH - 5)} ${r2(ix + iw - 6.2)} ${r2(top0 + 2 * rowH - 7)}H${r2(ix + iw - 4.6)}Q${r2(ix + iw - 2.4)} ${r2(top0 + 2 * rowH - 5)} ${r2(ix + iw - 3.6)} ${r2(top0 + 2 * rowH - 1.6)}Z`} {...IS} fill="#b8443a" />
      {/* cupboard below: two doors, brass knobs */}
      <path d={inkBox(ix, 44.6, iw, 7, .8, .2)} {...IS} fill={oak} />
      <path d="M31 44.8V51.6" {...IS} />
      {[29, 33].map((kx) => <circle key={kx} cx={kx} cy="48.2" r="1" {...IS} fill={brass} />)}
    </g>
  );
}

/** TALL. Console television in a tall teak cabinet (about 2 m with its rabbit-ear antenna), its top and east side
 *  showing: a black bezel with a rounded blue glass screen and a glare streak, two dials and a slider on its right, a
 *  cream speaker grille underneath, short splayed legs. Warm wood with a cool screen, so it reads on any floor. */
export function TV() {
  const teak = "#8a5a36", teakL = "#b58250", teakD = "#5e3b22", plastic = "#22242d", glass = "#4e7f9e", glassL = "#9cc4d8", cloth = "#d9cca2", clothD = "#a89a72";
  const x = 12, y = 14, w = 40, h = 39, d = 5; // front 12..52 x 14..53, top to y 9, east side to x 57
  return (
    <g>
      <GroundShadow cx={33} cy={57} rx={23} ry={3.4} />
      {/* legs */}
      {[[15.4, 1], [45.4, -1]].map(([lx, sg]) => <path key={lx} d={polyD([lx, 52], [lx + 4.6, 52], [lx + 4.6 + sg * 1.4, 57], [lx + sg * 1.4, 57])} fill={teakD} {...OS} />)}
      {/* cabinet */}
      <path d={slabSide(x, y, w, h, d, d)} fill={teakD} {...OS} />
      <path d={slabTop(x, y, w, d, d)} fill={teakL} {...OS} />
      <path d={inkBox(x, y, w, h, 1.4, .4)} fill={teak} {...OS} />
      {/* rabbit ears on a small base */}
      <path d="M32 9.6L22.6 1.6M34 9.6L43.6 2.2" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M32 9.6L22.6 1.6M34 9.6L43.6 2.2" stroke="#c9ccd1" strokeWidth="1" strokeLinecap="round" />
      <circle cx="22.4" cy="1.8" r="1.5" {...IS} fill="#c9ccd1" /><circle cx="43.8" cy="2.4" r="1.5" {...IS} fill="#c9ccd1" />
      <path d="M28.6 11.8Q30.6 9 33 9Q35.4 9 37.4 11.8Z" {...IS} fill={plastic} />
      {/* the set: bezel, glass with its glare, dials and a slider */}
      <path d={inkBox(14.6, 16.6, 34.8, 24, 2.4, .5)} {...IS} fill={plastic} />
      <path d={inkBox(16.8, 18.6, 22.4, 19.8, 4, .5)} {...IS} fill={glass} />
      <path d="M19.4 21.4Q22 20 27 20L20.4 31Q19.2 28 19.4 21.4Z" fill={glassL} />
      <circle cx="44" cy="23.4" r="2.5" {...IS} fill="#c9ccd1" /><path d="M44 21.6V23.4" {...IS} />
      <circle cx="44" cy="30" r="2.5" {...IS} fill="#c9ccd1" /><path d="M42.6 30.8L44 30" {...IS} />
      <path d="M42 35.6H46.4" stroke={clothD} strokeWidth="1.6" strokeLinecap="round" />
      {/* speaker grille */}
      <path d={inkBox(14.6, 43, 34.8, 8, 1, .3)} {...IS} fill={cloth} />
      {[19, 22.6, 26.2, 29.8, 33.4, 37, 40.6, 44.2].map((gx) => <path key={gx} d={`M${gx} 44.8V49.2`} stroke={clothD} strokeWidth="1.1" strokeLinecap="round" />)}
    </g>
  );
}

/** TALL. Life-size marble statue on a stepped stone plinth: a figure in a draped robe, one hand gathering the drapery,
 *  the other arm raised to hold a laurel wreath above its head. Marble shaded on the east half; it rises well above a
 *  standing suspect token. Pale marble on a mid-grey plinth reads on carpet, wood, stone, cobble and asphalt. */
export function Statue() {
  const u = useUid();
  const m = "#ebe6da", mD = "#bcb3a1", st = "#9d9686", stL = "#c4bdad", stD = "#6f695d";
  const robe = "M28 15.2Q33.5 13.6 39 15.2L40 19.6Q38.6 23.4 38.8 26L42 37.4Q33.5 39.4 25 37.4L28.2 26Q28.4 23.4 27 19.6Z";
  const armL = "M27.4 15.4Q24.4 16.2 24.4 19.6L24.6 28.4Q26.2 29.8 27.8 28.4L28.4 20Z";
  const armR = "M37.6 15.2L41.6 10.6L41.4 5.6H44.6L45 11Q45 12.4 44 13.4L39.6 18.4Z";
  const neck = inkBox(32.2, 11.4, 2.8, 4, .6, 0);
  // one marble part: lit fill, the east of it in shade (clipped to the part), then its outline
  const part = (d, k, sx = 33.6) => (
    <g key={k}>
      <defs><clipPath id={`${u}${k}`}><path d={d} /></clipPath></defs>
      <path d={d} fill={m} />
      <path d={`M${sx} 0H52V44H${sx}Z`} fill={mD} clipPath={`url(#${u}${k})`} />
      <path d={d} fill="none" {...OS} />
    </g>
  );
  return (
    <g>
      <GroundShadow cx={33} cy={57} rx={19} ry={3.4} />
      {/* plinth: a low step, then the block with a sunk panel */}
      <path d={slabSide(16, 52, 32, 4.6, 4, 4)} fill={stD} {...OS} />
      <path d={slabTop(16, 52, 32, 4, 4)} fill={stL} {...OS} />
      <path d={inkBox(16, 52, 32, 4.6, .8, .2)} fill={st} {...OS} />
      <path d={slabSide(20, 39, 24, 12, 4, 4)} fill={stD} {...OS} />
      <path d={slabTop(20, 39, 24, 4, 4)} fill={stL} {...OS} />
      <path d={inkBox(20, 39, 24, 12, .8, .2)} fill={st} {...OS} />
      <path d={inkBox(23.4, 42, 17.2, 6, .6, .2)} {...IS} />
      {/* figure: robe, the hanging arm, the raised arm, neck and head */}
      {part(robe, "r")}
      <path d="M28.6 16Q35 20.4 38.8 25.6M31.2 27.4L30.4 37.4M35.6 27.4L36.6 37.8" {...IS} />
      {part(armL, "l")}
      {part(armR, "a", 43.2)}
      {part(neck, "n")}
      {part("M30 8.4A3.6 4.2 0 1 1 37.2 8.4A3.6 4.2 0 1 1 30 8.4Z", "h")}
      <path d="M30.3 7.8Q33.6 5 36.9 7.8" {...IS} />
      <circle cx="33.6" cy="3.9" r="1.6" {...IS} fill={m} />
      {/* laurel wreath held up in the raised hand */}
      <circle cx="43.1" cy="3.4" r="2.3" fill="none" stroke={INK} strokeWidth="2.6" />
      <circle cx="43.1" cy="3.4" r="2.3" fill="none" stroke={m} strokeWidth="1" />
    </g>
  );
}

/** TALL. Fluted stone column, a round shaft with real volume, wider than a person and about the height of the tile,
 *  seen from slightly above: a square plinth (top plane showing) under a round torus base whose top is an ellipse, a
 *  shaft that tapers a little, lit on the left, mid-tone in the middle and shaded on the right, its flutes wrapping round
 *  it (closer together toward the edges, their feet following the curve) with a hairline crack, then a necking ring, a
 *  round flared capital and a thin square slab on top. Pale limestone, so it reads on marble, wood, carpet and sand. */
export function Pillar() {
  const u = useUid();
  const st = "#d6d0c1", stL = "#ece8dc", stS = "#b3ac9a", stD = "#8b857a";
  const cx = 32, yb = 47.6, rb = 12.4, rby = 2.8, yt = 14.2, rt = 11.4, rty = 2.5; // shaft foot and top ellipses
  const shaft = `M${cx - rb} ${yb}L${cx - rt} ${yt}H${cx + rt}L${cx + rb} ${yb}A${rb} ${rby} 0 0 1 ${cx - rb} ${yb}Z`;
  // a round band (cylinder slice) from y0 to y1, rx wide, with elliptical top and bottom edges
  const band = (rx, ry, y0, y1) => `M${cx - rx} ${y0}V${y1}A${rx} ${ry} 0 0 0 ${cx + rx} ${y1}V${y0}A${rx} ${ry} 0 0 1 ${cx - rx} ${y0}Z`;
  const flutes = [-64, -42, -21, 0, 21, 42, 64].map((a) => {
    const sn = Math.sin((a * Math.PI) / 180), cs = Math.cos((a * Math.PI) / 180);
    return `M${r2(cx + rt * sn)} ${r2(yt + rty * cs)}L${r2(cx + rb * sn)} ${r2(yb + rby * cs - .4)}`;
  }).join("");
  const capital = `M${cx - rt - .4} ${12.6}C${cx - rt - 3} 11.6 ${cx - 16.6} 10.2 ${cx - 17.2} 8.6A17.2 3.2 0 0 0 ${cx + 17.2} 8.6C${cx + 16.6} 10.2 ${cx + rt + 3} 11.6 ${cx + rt + .4} 12.6A${rt + .4} 2.4 0 0 1 ${cx - rt - .4} 12.6Z`;
  return (
    <g>
      <defs>
        <clipPath id={`${u}s`}><path d={shaft} /></clipPath>
        <clipPath id={`${u}b`}><path d={band(15.6, 3.2, 48.4, 51.8)} /><path d={capital} /><path d={band(rt + .6, 2.4, 12, 14.4)} /></clipPath>
      </defs>
      <GroundShadow cx={33} cy={57.4} rx={25} ry={3.6} />
      {/* square plinth */}
      <path d={slabSide(14, 52, 36, 5, 4, 4)} fill={stD} {...OS} />
      <path d={slabTop(14, 52, 36, 4, 4)} fill={stL} {...OS} />
      <path d={inkBox(14, 52, 36, 5, .8, .2)} fill={st} {...OS} />
      {/* round torus base: its side band, then its elliptical top */}
      <path d={band(15.6, 3.2, 48.4, 51.8)} fill={st} {...OS} />
      <ellipse cx={cx} cy="48.4" rx="15.6" ry="3.2" fill={stL} {...OS} />
      {/* shaft: mid-tone, a lit band on the left, shade on the right with a darker edge, the flutes, a crack */}
      <path d={shaft} fill={st} />
      <g clipPath={`url(#${u}s)`}>
        <path d={`M${cx - 9} 0H${cx - 4.6}V60H${cx - 9}Z`} fill={stL} />
        <path d={`M${cx + 5.6} 0H64V60H${cx + 5.6}Z`} fill={stS} />
        <path d={`M${cx + 10} 0H64V60H${cx + 10}Z`} fill={stD} fillOpacity=".55" />
        <path d={flutes} {...IS} strokeOpacity=".75" />
        <path d="M27.4 26L29.4 30.4L27 33.8L28.8 38.6" {...IS} />
      </g>
      <path d={shaft} fill="none" {...OS} />
      {/* necking ring, the round flared capital, the square slab on top */}
      <path d={band(rt + .6, 2.4, 12, 14.4)} fill={st} {...OS} />
      <path d={capital} fill={st} {...OS} />
      <g clipPath={`url(#${u}b)`}>
        <path d={`M${cx - 13} 0H${cx - 8.6}V60H${cx - 13}Z`} fill={stL} fillOpacity=".8" />
        <path d={`M${cx + 7} 0H64V60H${cx + 7}Z`} fill={stS} />
      </g>
      <path d={band(15.6, 3.2, 48.4, 51.8)} fill="none" {...OS} />
      <ellipse cx={cx} cy="48.4" rx="15.6" ry="3.2" fill="none" {...OS} />
      <path d={band(rt + .6, 2.4, 12, 14.4)} fill="none" {...OS} />
      <path d={capital} fill="none" {...OS} />
      <path d={slabSide(12, 4.8, 40, 3.4, 3.4, 3.4)} fill={stD} {...OS} />
      <path d={slabTop(12, 4.8, 40, 3.4, 3.4)} fill={stL} {...OS} />
      <path d={inkBox(12, 4.8, 40, 3.4, .8, .2)} fill={st} {...OS} />
    </g>
  );
}

/** Tall walk-in vault safe (new art): front-on with its top and east side showing, a door with a spoked wheel at
 *  chest height and a combination dial, on a plinth. It rises well above a standing suspect token. */
export function Safe() {
  const steel = "#8b9196", steelD = "#5b6166", steelL = "#c3c8cc", trim = "#42474c", hub = "#c9a24e";
  const x = 14, y = 8, w = 32, h = 45, d = 5; // front face 14..46 × 8..53, east side to x = 51, top to y = 3
  const wx = 30, wy = 28; // wheel centre
  const spokes = [0, 60, 120].map((a) => {
    const c = Math.cos((a * Math.PI) / 180) * 9.5, s = Math.sin((a * Math.PI) / 180) * 9.5;
    return { a, x1: +(wx - c).toFixed(2), y1: +(wy - s).toFixed(2), x2: +(wx + c).toFixed(2), y2: +(wy + s).toFixed(2) };
  });
  return (
    <g>
      <GroundShadow cx={33} cy={57} rx={23} ry={3.6} />
      <path d={inkBox(12, 51.5, 41, 5.5, 1.5, .4)} fill={trim} {...OS} />
      <path d={`M${x + w} ${y}L${x + w + d} ${y - d}V${y + h - d}L${x + w} ${y + h}Z`} fill={steelD} {...OS} />
      <path d={`M${x} ${y}L${x + d} ${y - d}H${x + w + d}L${x + w} ${y}Z`} fill={steelL} {...OS} />
      <path d={inkBox(x, y, w, h, 1.5, .5)} fill={steel} {...OS} />
      {/* door: inset panel, its thickness on the right, two hinges on the left */}
      <path d="M40.6 12.6H43V48.4H40.6Z" fill={steelD} />
      <path d={inkBox(18, 12, 25, 37, 1.2, .4)} {...IS} />
      {[16, 40].map((hy) => <path key={hy} d={inkBox(15.6, hy, 4, 5.5, 1, .2)} {...IS} fill={trim} />)}
      {/* wheel handle */}
      {spokes.map((k) => <path key={k.a} d={`M${k.x1} ${k.y1}L${k.x2} ${k.y2}`} stroke={INK} strokeWidth="2.2" strokeLinecap="round" />)}
      <circle cx={wx} cy={wy} r="7" fill="none" stroke={INK} strokeWidth="3.2" />
      <circle cx={wx} cy={wy} r="7" fill="none" stroke={steelL} strokeWidth="1.4" />
      {spokes.flatMap((k) => [[k.x1, k.y1], [k.x2, k.y2]]).map(([px, py], i) => <circle key={i} cx={px} cy={py} r="1.5" {...IS} fill={steelL} />)}
      <circle cx={wx} cy={wy} r="2.6" {...IS} fill={hub} />
      {/* combination dial */}
      <circle cx={wx} cy="42.5" r="3.2" {...IS} fill={trim} />
      <path d={`M${wx} 40.2V41.6`} stroke={steelL} strokeWidth="1" strokeLinecap="round" />
    </g>
  );
}

/** PERCH. Upright piano, seen from the front with its top showing, and its stool pulled up to the keyboard: black
 *  lacquer case, brass candle sconces, sheet music on the stand, white keys with black sharps on the key bed; in front
 *  of it the pianist's seat, a padded red bench on four legs centred on the keyboard, at the lower middle of the tile
 *  where a placed token sits and plays. The case rises behind and above the token, the keys and the bench stay readable round it. */
export function Piano() {
  const lac = "#33333f", lacL = "#5a5a6c", lacD = "#1c1c24", paper = "#f3efe2", key = "#f6f1e3", keyD = "#cfc6ad";
  const seat = "#a8303f", seatL = "#c95a66", seatD = "#7b2230", leg = "#5e3b22", legD = "#3f2615", brass = BRASS;
  const kx = 9, ky = 34.4, kw = 38, kdx = 4, kdy = 6; // key bed: front edge y 34.4, top plane receding to y 28.4
  const kb = (i) => kx + 1.9 + i * 3.4; // white key divisions along the front edge
  return (
    <g>
      <GroundShadow cx={31} cy={57.6} rx={25} ry={3.4} />
      {/* case: east side, top, front */}
      <path d={slabSide(7, 9, 46, 38, 5, 5)} fill={lacD} {...OS} />
      <path d={slabTop(7, 9, 46, 5, 5)} fill={lacL} {...OS} />
      <path d={inkBox(7, 9, 46, 38, 1.4, .4)} fill={lac} {...OS} />
      <path d="M12 6.2L20 4.6M22 6.2L27 5.2" stroke="#fff" strokeOpacity=".3" strokeWidth="1.1" strokeLinecap="round" />
      {/* feet */}
      {[8.6, 46.6].map((fx) => <path key={fx} d={inkBox(fx, 47, 5.4, 4.2, .8, .2)} fill={lacD} {...OS} />)}
      {/* sheet music on the stand */}
      <path d={inkBox(17.4, 12.6, 25.8, 13.6, 1, .3)} {...IS} fill={paper} />
      {[16.2, 19, 21.8].map((ly) => <path key={ly} d={`M19.4 ${ly}H41.2`} stroke="#6b6558" strokeWidth=".6" />)}
      {[[22.4, 17.8], [27, 15.4], [31.6, 19.8], [36.6, 16.6]].map(([nx, ny]) => <g key={nx}><ellipse cx={nx} cy={ny} rx="1.1" ry=".8" fill={INK} /><path d={`M${r2(nx + 1)} ${ny}V${r2(ny - 3.6)}`} stroke={INK} strokeWidth=".7" /></g>)}
      {/* brass sconces with candles */}
      {[11.4, 48.2].map((cx) => (
        <g key={cx}>
          <path d={`M${cx - 3} 26.6H${cx + 3}`} stroke={INK} strokeWidth="3" strokeLinecap="round" />
          <path d={`M${cx - 3} 26.6H${cx + 3}`} stroke={brass} strokeWidth="1.4" strokeLinecap="round" />
          <rect x={cx - 1.3} y="20.6" width="2.6" height="5.4" {...IS} fill={CREAM} />
          <path d={`M${cx} 20.2C${cx - 1.4} 18.8 ${cx - .3} 17.6 ${cx} 16.4C${cx + .3} 17.6 ${cx + 1.4} 18.8 ${cx} 20.2Z`} {...IS} fill="#ffb347" />
        </g>
      ))}
      {/* key bed: side, top plane with the black keys, then the white-key front */}
      <path d={slabSide(kx, ky, kw, 3.8, kdx, kdy)} fill={keyD} {...OS} />
      <path d={slabTop(kx, ky, kw, kdx, kdy)} fill={key} {...OS} />
      {Array.from({ length: 10 }, (_, i) => i).map((i) => <path key={i} d={`M${r2(kb(i))} ${ky}L${r2(kb(i) + kdx)} ${ky - kdy}`} stroke="#8a8576" strokeWidth=".6" />)}
      {[0, 1, 3, 4, 5, 7, 8].map((i) => <path key={i} d={polyD([kb(i) + 2.2, ky - 1.3], [kb(i) + 3.8, ky - 1.3], [kb(i) + 3.8 + kdx * .62, ky - kdy], [kb(i) + 2.2 + kdx * .62, ky - kdy])} fill={INK} />)}
      <path d={inkBox(kx, ky, kw, 3.8, .8, .2)} fill={key} {...OS} />
      {Array.from({ length: 11 }, (_, i) => i).map((i) => <path key={i} d={`M${r2(kx + 1.9 + i * 3.4 - 1.7)} ${ky + .6}V${ky + 3.4}`} stroke="#8a8576" strokeWidth=".6" />)}
      {/* the pianist's seat, centred on the keyboard (front edges both centred on x = kx + kw / 2 = 28): padded red
          bench, legs, then its top and front */}
      {[[16.4, 1], [36.4, -1]].map(([lx, sg]) => <path key={lx} d={polyD([lx, 51], [lx + 3.4, 51], [lx + 3.4 + sg * 1.2, 57], [lx + sg * 1.2, 57])} fill={leg} {...OS} />)}
      {[[19.6, 0], [34, 0]].map(([lx]) => <path key={lx} d={polyD([lx + 1.5, 49], [lx + 4, 49], [lx + 4, 53.6], [lx + 1.5, 53.6])} fill={legD} {...OS} />)}
      <path d={slabSide(14, 47, 28, 4.4, 4, 4)} fill={seatD} {...OS} />
      <path d={slabTop(14, 47, 28, 4, 4)} fill={seatL} {...OS} />
      <path d={inkBox(14, 47, 28, 4.4, 1.6, .3)} fill={seat} {...OS} />
      <path d="M22 44.6Q30 45.6 38 44.6" {...IS} stroke={seatD} />
      <circle cx="30" cy="45" r=".9" fill={seatD} />
    </g>
  );
}

/** TALL. Three-panel folding screen, a little under 2 m, in a zigzag: the near panel face-on, the middle panel folded
 *  away up and to the right, the last face-on again and further back, so its top and its base step up in a W. Silk
 *  panels in lacquered red-brown frames: bamboo on the first, a red sun over blue hills on the second (sheared with
 *  the panel), plum blossom on the third. A crimson robe hangs over the top rail of the near panel. */
export function Screen() {
  const wood = "#6b2f26", woodL = "#8a4a38", woodD = "#54231c", silk = "#eadfbd", silkD = "#cdbf94";
  const A = 8, B = 23.5, C = 39, E = 54.5; // panel edges
  const sl = -0.4; // B recedes: y shifts by sl per unit x
  const poly = (...pts) => polyD(...pts);
  return (
    <g>
      <GroundShadow cx={32} cy={56.8} rx={27} ry={3.2} />
      {/* panel C (far, face-on), panel B (folded), panel A (near) */}
      <path d={poly([C, 4.8], [E, 4.8], [E, 50.4], [C, 50.4])} fill={silk} {...OS} />
      <path d={poly([B, 11], [C, 4.8], [C, 50.4], [B, 56.6])} fill={silkD} {...OS} />
      <path d={poly([A, 11], [B, 11], [B, 56.6], [A, 56.6])} fill={silk} {...OS} />
      {/* panel A: bamboo */}
      <path d={inkBox(10.4, 17, 11, 33.6, .8, .2)} {...IS} />
      <g stroke="#3f7d52" strokeWidth="1.5" strokeLinecap="round" fill="none">
        <path d="M16.6 49V25M20.4 48V28" />
        <path d="M15.2 42H18M15.2 34H18M19 41H21.8M19 34.4H21.8" stroke="#2f5d3b" />
        <path d="M16.6 30C18.8 28.6 21 28.8 22 30.4M16.6 38C14.4 37 12.6 37.6 12 39.2M20.4 33C18.4 32.8 17.4 33.6 17 35" strokeWidth="1.1" />
      </g>
      {/* panel B: a red sun over blue hills, drawn flat then sheared with the panel */}
      <g transform={`translate(${B} 0) skewY(${(Math.atan(sl) * 180) / Math.PI})`}>
        <path d={inkBox(2.2, 17, 11, 33.6, .8, .2)} {...IS} />
        <circle cx="7.7" cy="27" r="3.8" fill={CRIMSON} />
        <path d="M2.6 49.6V42L6.6 36L9.6 40.2L11.8 36.8L13.4 39.4V49.6Z" fill="#3b4a63" />
        <path d="M3 33C5 31.6 6 31.8 7.4 32.6" stroke="#8a7f5e" strokeWidth="1" fill="none" strokeLinecap="round" />
      </g>
      {/* panel C: a plum branch in blossom */}
      <path d={inkBox(41.4, 10.4, 11.2, 33.6, .8, .2)} {...IS} />
      <path d="M43 43C46.4 38.4 49.2 34 52 28.4M46.4 38C45.6 35 46.2 32.6 47.6 31.2M49.6 33.4C50.6 31 51.6 29.8 52.4 29" stroke="#6b4a2d" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      {[[48.4, 29.6], [51, 25.6], [46.2, 33.6], [52, 32], [44.8, 39.6]].map(([cx, cy]) => <circle key={cx} cx={cx} cy={cy} r="1.7" {...IS} fill="#f4a6b8" />)}
      {/* rails: top and base planks, each following its panel */}
      <path d={poly([C, 4.8], [E, 4.8], [E, 8], [C, 8])} fill={woodL} {...OS} />
      <path d={poly([B, 11], [C, 4.8], [C, 8], [B, 14.2])} fill={woodD} {...OS} />
      <path d={poly([A, 11], [B, 11], [B, 14.2], [A, 14.2])} fill={wood} {...OS} />
      <path d={poly([C, 46.2], [E, 46.2], [E, 50.4], [C, 50.4])} fill={wood} {...OS} />
      <path d={poly([B, 52.4], [C, 46.2], [C, 50.4], [B, 56.6])} fill={woodD} {...OS} />
      <path d={poly([A, 52.4], [B, 52.4], [B, 56.6], [A, 56.6])} fill={woodL} {...OS} />
      {/* crimson robe hung over the near panel's top rail: shoulders over the rail, two sleeves, a pale collar, a fold */}
      <path d="M7.6 11.4L11.6 8.6Q14 9.8 16.4 8.6L20.4 11.4L19.8 21.6L16.8 21.2L16.6 29.2H11.4L11.2 21.2L8.2 21.6Z" fill="#c45970" {...OS} />
      <path d="M16.4 8.8L20.2 11.4L19.8 21.4L16.8 21L16.6 29L14.6 29.2L14.6 10Z" fill="#93404f" />
      <path d="M11.8 9L14 13.4L16.2 9" {...IS} fill="#efe6cf" />
      <path d="M12.6 17V28" {...IS} />
    </g>
  );
}

/* ---- Seating, rugs, beds and the corpse: CHAIR, STOOL, RUG (RugN), BED (BedSpan), CORPSE ---- */

/** LOW. Walnut dining chair, kept low in the LOW-furniture camera: a woven rush seat at knee height (its weave meeting on the diagonals),
 *  three spindles under a top rail no higher than a desk top, the back posts peeking above it, four square legs. The
 *  seat sits at the tile centre, under a placed token. Dark wood with a pale straw seat, so it reads on any floor. */
export function Chair() {
  const wood = "#7a4c2c", woodL = "#9c6a42", woodD = "#4f301b", rush = "#d6b46a", rushD = "#a8843f";
  const P = lowCam(56), top = (...a) => camTop(P, ...a), side = (...a) => camSide(P, ...a), front = (...a) => camFront(P, ...a);
  const xa = 19, xb = 45, zs = 15, hs = 12, hf = 9.2, zp = 13.4; // seat x xa..xb, depth 0..zs, top hs, frame bottom hf; posts at zp
  const posts = [xa + .6, xb - 3.6];
  const line = (a, b, st) => <path d={`M${P(...a).map(r2).join(" ")}L${P(...b).map(r2).join(" ")}`} {...st} />;
  return (
    <g>
      {/* back legs, rising into the back posts */}
      {posts.map((lx, i) => <path key={lx} d={front(lx, lx + 3, zp, -.5, 29, 1.2)} fill={i ? woodD : wood} {...OS} />)}
      {/* three spindles and the top rail */}
      {[26, 30.8, 35.6].map((sx) => <path key={sx} d={front(sx, sx + 2.4, zp - .2, 11, 22, .6)} fill={wood} {...OS} />)}
      <path d={side(xb + .8, 12.6, 14.6, 21.4, 27)} fill={woodD} {...OS} />
      <path d={top(xa - .8, xb + .8, 12.6, 14.6, 27)} fill={woodL} {...OS} />
      <path d={front(xa - .8, xb + .8, 12.6, 21.4, 27, 1.6)} fill={wood} {...OS} />
      {/* front legs */}
      {posts.map((lx) => <path key={lx} d={front(lx, lx + 3, .6, -.5, hf + .4, .8)} fill={wood} {...OS} />)}
      {/* seat: east rail, rush top with its weave, front rail */}
      <path d={side(xb, 0, zs, hf, hs)} fill={woodD} {...OS} />
      <path d={top(xa, xb, 0, zs, hs)} fill={rush} {...OS} />
      <path d={camTop(P, xa + 4, xb - 4, 2.4, zs - 2.4, hs)} fill="none" stroke={rushD} strokeWidth=".9" />
      {line([xa, 0, hs], [xb, zs, hs], { stroke: rushD, strokeWidth: .9, strokeLinecap: "round" })}
      {line([xb, 0, hs], [xa, zs, hs], { stroke: rushD, strokeWidth: .9, strokeLinecap: "round" })}
      <path d={front(xa, xb, 0, hf, hs, 1)} fill={wood} {...OS} />
    </g>
  );
}

/** LOW. Round mahogany stool, kept low in the LOW-furniture camera: a thick round seat at knee height with a hand slot,
 *  on four splayed legs joined by rungs. The seat sits at the tile centre, under a placed token. */
export function Stool() {
  const wood = "#a35f36", woodL = "#c9844f", woodD = "#6e3c21";
  const P = lowCam(56), pt = (a) => P(...a).map(r2);
  const [cx, cy] = pt([32, 8, 15.5]), rx = 12.4, ry = 5.9, t = 3.2; // seat top centre, radii, thickness
  // legs from the floor (splayed) up under the seat; rungs at 40 % of their height
  const legs = { fl: [[21.6, 0, 0], [25.4, 3, 13]], fr: [[42.4, 0, 0], [38.6, 3, 13]], bl: [[23.2, 16, 0], [26.4, 13, 13]], br: [[40.8, 16, 0], [37.6, 13, 13]] };
  const at = (k, f) => legs[k][0].map((v, i) => v + (legs[k][1][i] - v) * f);
  const tube = (a, b, key, wt = 3.8) => (
    <g key={key}>
      <path d={`M${pt(a).join(" ")}L${pt(b).join(" ")}`} stroke={INK} strokeWidth={wt} strokeLinecap="round" />
      <path d={`M${pt(a).join(" ")}L${pt(b).join(" ")}`} stroke={wood} strokeWidth={wt - 1.8} strokeLinecap="round" />
    </g>
  );
  const rung = (p, q) => tube(at(p, .4), at(q, .4), p + q, 3);
  return (
    <g>
      {tube(...legs.bl, "bl")}{tube(...legs.br, "br")}
      {rung("bl", "br")}{rung("fl", "bl")}{rung("fr", "br")}
      {tube(...legs.fl, "fl")}{tube(...legs.fr, "fr")}
      {rung("fl", "fr")}
      {/* seat: its rim, then the top with a grain line and a hand slot */}
      <path d={`M${r2(cx - rx)} ${cy}V${r2(cy + t)}A${rx} ${ry} 0 0 0 ${r2(cx + rx)} ${r2(cy + t)}V${cy}Z`} fill={woodD} {...OS} />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={woodL} {...OS} />
      <path d={`M${r2(cx - 7.4)} ${r2(cy + 1.4)}Q${cx} ${r2(cy + 4.4)} ${r2(cx + 7.4)} ${r2(cy + 1.4)}`} {...IS} />
      <path d={inkBox(r2(cx - 3.4), r2(cy - 2.4), 6.8, 1.8, .9, 0)} fill={INK} />
    </g>
  );
}

/** LOW. Persian rug, one object across any span (cw × ch tiles), a flat top-down footprint inked in OS, no shadow: a
 *  deep-red border, a navy band, a crimson field with a navy lozenge (cream inside, a red diamond at its heart) at the
 *  centre of the whole rug and a navy triangle in each field corner, cream fringe at both short ends (left and right on
 *  a wide rug, top and bottom on a tall or square one). The lozenge's heart is calm, so a token on it reads. */
export function RugN({ cw = 1, ch = 1 }) {
  const border = "#7d2431", band = "#2b3f66", field = "#a63a47", cream = "#efe3c4", brass = "#d9a441";
  const W = 64 * cw, H = 64 * ch, wide = cw > ch;
  const fx = wide ? 9 : 5, fy = wide ? 5 : 9; // body inset (the short ends leave room for the fringe)
  const bx = fx + 3.4, by = fy + 3.4, gx = fx + 6.8, gy = fy + 6.8;
  const fw = W - 2 * gx, fh = H - 2 * gy, cx = W / 2, cy = H / 2;
  const hw = fw * (fw > fh ? .4 : .34), hh = fh * (fh > fw ? .4 : .34);
  const dia = (k) => polyD([cx, cy - hh * k], [cx + hw * k, cy], [cx, cy + hh * k], [cx - hw * k, cy]);
  const leg = Math.min(fw, fh) * .22, c0 = [gx, gy], c1 = [gx + fw, gy], c2 = [gx + fw, gy + fh], c3 = [gx, gy + fh];
  const corners = [[c0, 1, 1], [c1, -1, 1], [c2, -1, -1], [c3, 1, -1]].map(([[x, y], sx, sy]) => polyD([x, y], [x + sx * leg, y], [x, y + sy * leg]));
  // fringe tufts along the two short ends
  const n = Math.round(((wide ? H : W) - 2 * 8) / 4.2), step = ((wide ? H : W) - 2 * 8) / Math.max(1, n - 1);
  const tufts = Array.from({ length: n }, (_, i) => 8 + i * step).flatMap((t) => (wide
    ? [`M${fx + .5} ${t}H${fx - 3.6}`, `M${W - fx - .5} ${t}H${W - fx + 3.6}`]
    : [`M${t} ${fy + .5}V${fy - 3.6}`, `M${t} ${H - fy - .5}V${H - fy + 3.6}`])).join("");
  return (
    <g>
      <path d={tufts} fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <path d={tufts} fill="none" stroke={cream} strokeWidth="1" strokeLinecap="round" />
      <path d={inkBox(fx, fy, W - 2 * fx, H - 2 * fy, 2.4, .3)} fill={border} {...OS} />
      <rect x={bx} y={by} width={W - 2 * bx} height={H - 2 * by} rx="1.2" {...IS} fill={band} />
      <rect x={gx} y={gy} width={fw} height={fh} {...IS} fill={field} />
      <rect x={gx + 1.4} y={gy + 1.4} width={fw - 2.8} height={fh - 2.8} fill="none" stroke={brass} strokeWidth=".9" />
      {corners.map((d, i) => <path key={i} d={d} {...IS} fill={band} />)}
      <path d={dia(1)} {...IS} fill={band} />
      <path d={dia(.66)} {...IS} fill={cream} />
      <path d={dia(.3)} {...IS} fill={field} />
    </g>
  );
}
export const Rug = () => <RugN cw={1} ch={1} />;

/** LOW. Bed, one object across its span (1 × 2 down a column, 2 × 1 along a row), in the LOW-furniture camera of the
 *  sofa, kept low: a mattress at knee height under a blue duvet with a folded-back cream cuff and plump pillows at
 *  the head, a walnut headboard no higher than a SHORT prop and a lower footboard. No cast shadow. Along a row the head
 *  is at the west and the east faces show darkest; down a column the head is at the north and the foot faces the
 *  viewer, the bed seen from above and its east faces as dark bands. */
export function BedSpan({ cw = 1, ch = 1 }) {
  const wood = "#7a4c2c", woodL = "#9c6a42", woodD = "#4f301b";
  const lin = "#e9e0c8", linL = "#f8f2e2", linD = "#c2b693";
  const duv = "#4b7a9e", duvL = "#6a97b8", duvD = "#325974";
  const W = 64 * cw, H = 64 * ch;
  const hF = 3, hM = 9, hT = 14, hP = 17.4, hB = 24.6, hFB = 17; // frame bottom, mattress bottom, mattress top, pillow top, headboard top, footboard top
  if (ch <= cw) {
    const P = lowCam(57), top = (...a) => camTop(P, ...a), side = (...a) => camSide(P, ...a), front = (...a) => camFront(P, ...a);
    const x0 = 5, x1 = W - 10, D = 28, xh = x0 + 4, xf = x1 - 4, xd = xh + Math.min(17, (xf - xh) * .4), xc = xd + 6; // head slab, foot slab, duvet start, cuff end
    const stitch = [.4, .72].map((t) => xc + (xf - xc) * t);
    return (
      <g>
        {/* headboard: inner face, top, then its end post */}
        <path d={side(xh, 0, D, hF, hB)} fill={woodD} {...OS} />
        <path d={top(x0, xh, 0, D, hB)} fill={woodL} {...OS} />
        <path d={front(x0, xh, 0, 0, hB, 1.2)} fill={wood} {...OS} />
        <path d={`M${P(xh, 4, 21).map(r2).join(" ")}L${P(xh, D - 4, 21).map(r2).join(" ")}M${P(xh, 4, 17).map(r2).join(" ")}L${P(xh, D - 4, 17).map(r2).join(" ")}`} {...IS} />
        {/* frame rail, the sheet and the duvet's drape along the front */}
        <path d={front(xh, xf, 0, hF + .6, hM + 1, 1)} fill={wood} {...OS} />
        <path d={front(xh, xd, 0, hM, hT, 1.6)} fill={lin} {...OS} />
        <path d={front(xd, xf, 0, hM - 2.4, hT + .4, 1.8)} fill={duv} {...OS} />
        <path d={front(xd, xc, 0, hM - 2.4, hT + .4, 1.8)} fill={lin} {...OS} />
        {/* mattress tops: the sheet at the head, the duvet over the rest, the cuff folded across it */}
        <path d={top(xh, xd, 0, D, hT)} fill={linL} {...OS} />
        <path d={top(xd, xf, 0, D, hT + .4)} fill={duvL} {...OS} />
        <path d={top(xd, xc, 0, D, hT + .4)} fill={linL} {...OS} />
        {stitch.map((sx) => <path key={sx} d={`M${P(sx, 2, hT + .4).map(r2).join(" ")}L${P(sx, D - 2, hT + .4).map(r2).join(" ")}`} {...IS} strokeDasharray="2.6 2.4" />)}
        {/* a plump pillow at the head */}
        <path d={side(xd - 1.6, 3, D - 3, hT, hP)} fill={linD} {...OS} />
        <path d={top(xh + 1.4, xd - 1.6, 3, D - 3, hP)} fill={linL} {...OS} />
        <path d={front(xh + 1.4, xd - 1.6, 3, hT - .4, hP, 2)} fill={lin} {...OS} />
        {/* footboard: end face, top, front */}
        <path d={side(x1, 0, D, hF, hFB)} fill={woodD} {...OS} />
        <path d={top(xf, x1, 0, D, hFB)} fill={woodL} {...OS} />
        <path d={front(xf, x1, 0, 0, hFB, 1.2)} fill={wood} {...OS} />
      </g>
    );
  }
  // down a column: z runs north along the column (one screen unit per unit, no sideways lean, so every face is a rounded
  // box), x across, h up. The footboard faces the viewer; the east faces show as dark bands, as on the sofa.
  const Yf = H - 5, L = Yf - hB - 3, Y = (z, h) => Yf - h - z;
  const xa = 9, xb = 51, zf = 4.4, zh = L - 5, zd = zh - 42; // footboard depth, headboard south face, duvet start
  const box = (x0, x1, ya, yb, r) => inkBox(x0, r2(ya), x1 - x0, r2(yb - ya), r, .3);
  const xm = (xa + xb) / 2;
  return (
    <g>
      {/* headboard: top, the panelled face toward the bed, knobbed posts, east band */}
      <path d={box(xb - 1, xb + 4.4, Y(L, hB) + 1, Y(zh, hF), 1.6)} fill={woodD} {...OS} />
      <path d={box(xa - 1.4, xb + 1.4, Y(zh, hB), Y(zh, hT), 1.2)} fill={wood} {...OS} />
      <path d={box(xa + 3, xb - 3, Y(zh, hB - 3), Y(zh, hT + 2), 1)} {...IS} />
      <path d={box(xa - 1.4, xb + 1.4, Y(L, hB), Y(zh, hB) + 1, 2.4)} fill={woodL} {...OS} />
      {[xa + 2, xb - 2].map((kx) => <circle key={kx} cx={kx} cy={r2(Y(L, hB) + .4)} r="2.3" fill={woodL} {...OS} />)}
      {/* bed body: east band of the frame and the drape, the mattress tops, cuff and stitching */}
      <path d={box(xb - 1, xb + 4.4, Y(zh, hT), Y(zf, hF), 1.8)} fill={woodD} {...OS} />
      <path d={box(xb - 1, xb + 4.4, Y(zd, hT + .4), Y(zf, hM - 2.4), 1.8)} fill={duvD} {...OS} />
      <path d={box(xa, xb, Y(zh, hT), Y(zd, hT), 2.6)} fill={linL} {...OS} />
      <path d={box(xa, xb, Y(zd, hT + .4), Y(zf, hT + .4), 2.6)} fill={duvL} {...OS} />
      <path d={box(xa, xb, Y(zd, hT + .4), Y(zd - 7, hT + .4), 1.6)} fill={linL} {...OS} />
      {[18, 30].map((s) => <path key={s} d={`M${xa + 4} ${r2(Y(zd - 7 - s, hT + .4))}H${xb - 4}`} {...IS} strokeDasharray="2.6 2.4" />)}
      {/* two plump pillows at the head: east band, top, front */}
      {[[xa + 2.6, xm - 1.6], [xm + 1.6, xb - 2.6]].map(([p0, p1]) => (
        <g key={p0}>
          <path d={box(p1 - 1.4, p1 + 2.2, Y(zh - 3, hP) + 1, Y(zh - 16, hT), 1.4)} fill={linD} {...OS} />
          <path d={box(p0, p1, Y(zh - 3, hP), Y(zh - 16, hP), 3)} fill={linL} {...OS} />
          <path d={box(p0, p1, Y(zh - 16, hP), Y(zh - 16, hT - .4), 1.6)} fill={lin} {...OS} />
        </g>
      ))}
      {/* footboard: east band, top, the front face with a recessed panel */}
      <path d={box(xb - 1, xb + 4.4, Y(zf, hFB) + 1, Y(0, hF - 1), 1.6)} fill={woodD} {...OS} />
      <path d={box(xa - 1.4, xb + 1.4, Y(zf, hFB), Y(0, hFB) + 1, 1.8)} fill={woodL} {...OS} />
      <path d={box(xa - 1.4, xb + 1.4, Y(0, hFB), Y(0, 0), 1.6)} fill={wood} {...OS} />
      <path d={box(xa + 3, xb - 3, Y(0, hFB - 3), Y(0, 4), 1)} {...IS} />
    </g>
  );
}

/** Bed across `len` tiles: kept for callers that pass a length (BED in SPAN_SPRITES goes through here); BedSpan draws it. */
export function Bed({ len = 2, horizontal = false }) {
  return <BedSpan cw={horizontal ? len : 1} ch={horizontal ? 1 : len} />;
}

/** Evidence (not a prop class: nobody stands on it, it casts no sightline, sight passes over it). The victim, the very
 *  character on the case's target polaroid (VictimPolaroid: the same look from the same name, so the same hair, face,
 *  skin and outfit), seen from above lying on their back on the floor, turned at an angle, in a dark pool of blood: the
 *  portrait's own head and shoulders, the face looking straight up with crossed-out X eyes, carry on into a torso in the
 *  same outfit (the blazer's shirt and tie, a hoodie's pouch...), one arm flung up past the head, the other bent at the
 *  side, legs splayed in dark trousers and shoes. `victim` is the target's name (the polaroid's `name`; default "Victor",
 *  the polaroid's default); `dummy` draws the tutorial's ivory crash-test dummy instead (the polaroid's `dummy`);
 *  `master` draws Master U. M. Bra (CORPSE_MASTER: MASTER_LOOK's silver hair and majestic beard, obsidian blazer over a
 *  sweater, crimson bowtie, X eyes), no chalk outline, his round brass spectacles knocked off and lying beside his
 *  head with one lens cracked. `second` draws N. O. Ir, the Master's hooded second in command (CORPSE_SECOND, the target of
 *  "The Uninvited Guests"): a slate-black cloak fanned out under the body, the hood still up round a face lost in shadow with
 *  two pale X eyes, dark gloves, and the brass clasp of the Master's household at the throat.
 *  `master` wins over `second`, `second` over `victim`; `dummy` wins over all.
 *  Top-down and flush like the other floor items, inked in OS, no shadow. Drawn on every board. */
export function Corpse({ victim = "Victor", dummy = false, master = false, second = false } = {}) {
  const u = useUid();
  const M = !!master && !dummy;
  const N = !!second && !dummy && !M; // N. O. Ir, hooded
  // the Master's own look, minus the glasses (they lie on the floor beside him)
  const V = M ? { ...MASTER_LOOK, glasses: false, glassesStyle: "none" } : victimLook(victim, dummy), F = fixLook(V);
  const k = .126, sw = 11.9; // the 280-unit portrait frame scaled into the tile; sw * k = 1.5, like OS
  const skin = dummy ? V.dummyColor : M ? MASTER_LOOK.pal.skin : N ? "#262833" /* gloves */ : SKIN[F.skin % SKIN.length];
  const bare = !dummy && !N && (F.clothing === "shirtless" || F.clothing === "bikini");
  const blazer = !dummy && !N && /^blazer/.test(F.clothing);
  const clothes = dummy ? mix(V.dummyColor, -.28) : M ? MASTER_LOOK.pal.clothes : N ? SECOND_CLOAK : bare ? skin : CLOTH[F.cloth % CLOTH.length];
  const sleeve = dummy ? V.dummyColor : clothes;
  const trousers = dummy ? V.dummyColor : M ? "#2b2932" : N ? "#15161e" : mix(CLOTH[F.cloth % CLOTH.length], -.4), shoe = dummy ? mix(V.dummyColor, -.45) : M ? "#4a2e22" : N ? "#0e0f14" : "#2a2220";
  const tie = ACCENTS[(F.accent || 0) % ACCENTS.length];
  const mouth = ["smile", "twinkle", "tongue", "eating"].includes(F.mouth) ? "serious" : F.mouth;
  const bust = dummy ? dummySvg(V.dummyColor, sw) : composeLook({ ...F, eyes: "xDizzy", mouth }, sw);
  // a crash-test dummy is not a person: its pool is dark oil (near-black blue-brown, glossy highlight), not blood
  const blood = dummy ? "#2d2c38" : "#8a1c24", bloodL = dummy ? "#98a0b6" : "#bb4650";
  // the real victim's pool spreads out round the head; the dummy's oil has leaked from its chest, so its head stays clear of the dark (no black "hair" halo)
  const pool = dummy ? [[6, 33], [9, 24], [19, 21.4], [33, 20], [47, 22], [56, 30], [55, 42], [45, 50], [30, 52.4], [15, 50], [7, 42]] : [[11, 24], [10.6, 11], [19.6, 1.4], [32, -2], [45, 1], [54, 10], [56, 23], [51.4, 34], [40, 39.6], [25, 39.4], [15, 33]];
  // the body is laid out head-up in its own frame (portrait centre x 140 -> 32, its top at y 0), then turned onto the tile
  const P = `translate(32 0) scale(${k}) translate(-140 0)`, yH = 45; // yH: hem of the torso
  const legs = [[[28.4, 44], [25.4, 52.4], [22.6, 59.4]], [[35.6, 44], [40, 52], [44.4, 58.6]]];
  const arms = [[[22.4, 32], [13, 26.4], [12.6, 15]], [[41.6, 32], [49.6, 38.6], [49.6, 47]]];
  const LW = 7.6, AW = 6;
  const line = (pts) => `M${pts.map((q) => q.join(" ")).join("L")}`;
  const shoes = [[21.8, 61.6, -18], [45.4, 60.6, 30]], hands = [[12.8, 12.8], [49.6, 49]];
  const torso = `M19.8 30V37Q20.6 43.4 22.8 ${yH + .4}Q32 ${yH + 2.4} 41.2 ${yH + .4}Q43.4 43.4 44.2 37V30Z`;
  return (
    <g transform="translate(32 32.6) rotate(-34) scale(.82) translate(-32 -33)">
      <defs><clipPath id={`${u}b`}><rect x="0" y="-40" width="280" height="313" /></clipPath></defs>
      {/* blood pool spreading out from under the head and shoulders, one wet sheen and two drops */}
      <path d={lobed(pool, .62)} fill={blood} {...OS} />
      {dummy
        ? <><path d="M10.4 37Q11.4 44.6 17.6 48.4" fill="none" stroke={bloodL} strokeWidth="2" strokeLinecap="round" /><path d="M50.6 28.4Q53.4 32.6 52.6 38" fill="none" stroke={bloodL} strokeWidth="1.5" strokeLinecap="round" /></>
        : <path d="M45.4 4.4Q51.6 7.4 52.8 12.8" fill="none" stroke={bloodL} strokeWidth="1.8" strokeLinecap="round" />}
      <circle cx="59.6" cy="32" r="1.7" {...IS} fill={blood} /><circle cx="7.6" cy="35" r="1.2" {...IS} fill={blood} />
      {/* N. O. Ir's cloak, fanned out on the floor under the body */}
      {N && <><path d="M18.4 27Q7 43 11 58.6Q32 65.4 53 58.6Q57 43 45.6 27Z" fill="#101119" {...OS} /><path d="M17 44Q22 52 20 60M47 44Q42 52 44 60" {...IS} stroke="#2a2e40" /></>}
      {/* legs, shoes, arms (sleeves of the outfit) and hands: an ink pass, then the colours */}
      <g fill="none" stroke={INK} strokeLinejoin="round" strokeLinecap="round">
        {legs.map((l, i) => <path key={`l${i}`} d={line(l)} strokeWidth={LW + 3} />)}
        {arms.map((a, i) => <path key={`a${i}`} d={line(a)} strokeWidth={AW + 3} />)}
      </g>
      {shoes.map(([x, y, r]) => <ellipse key={x} cx={x} cy={y} rx="3.4" ry="4.3" transform={`rotate(${r} ${x} ${y})`} fill={shoe} {...OS} />)}
      {legs.map((l, i) => <path key={`l${i}`} d={line(l)} fill="none" stroke={trousers} strokeWidth={LW} strokeLinejoin="round" strokeLinecap="round" />)}
      {arms.map((a, i) => <path key={`a${i}`} d={line(a)} fill="none" stroke={sleeve} strokeWidth={AW} strokeLinejoin="round" strokeLinecap="round" />)}
      {hands.map(([x, y]) => <circle key={x} cx={x} cy={y} r="2.8" fill={skin} {...OS} />)}
      {/* trousers at the hips, then the torso in the outfit's colour, carrying on from the portrait's shoulders */}
      <path d={inkBox(22.6, yH - 4, 18.8, 6.6, 2.6, .3)} fill={trousers} {...OS} />
      <path d={torso} fill={clothes} {...OS} />
      {blazer && <path d="M28.6 30L32 39.8L35.4 30Z" {...IS} fill={M ? MASTER_LOOK.pal.shirt : "#e4dcc8"} />}
      {M && <path d="M25.4 30.6L30.4 40.6M38.6 30.6L33.6 40.6" {...IS} stroke="#4a4654" />}
      {!dummy && !N && F.tie === "necktie" && <path d="M30.2 30H33.8L34.4 36.8L32 39.2L29.6 36.8Z" {...IS} fill={tie} />}
      {blazer && <><path d="M32 39.8V44.6" {...IS} /><circle cx="33.4" cy="41.8" r=".75" fill={INK} /></>}
      {!dummy && !N && F.clothing === "hoodie" && <path d="M25.6 38.4H38.4L37 43.6H27Z" {...IS} />}
      {N && <path d="M32 32V45" {...IS} stroke="#3a3f55" />}
      {!dummy && !N && F.clothing === "overall" && <path d={inkBox(28, 34.6, 8, 5.6, 1, .2)} {...IS} />}
      {bare && <circle cx="32" cy="40.6" r=".8" fill={mix(skin, -.35)} />}
      {dummy && <><path d="M32 31V44.8" {...IS} strokeOpacity=".5" /><path d="M23.6 41.6H40.4" {...IS} strokeOpacity=".4" /></>}
      {/* the portrait itself: head and shoulders, face up (its flat bottom edge trimmed off) */}
      {N ? <SecondHood /> : <g transform={P}><g clipPath={`url(#${u}b)`} dangerouslySetInnerHTML={{ __html: bust }} /></g>}
      {M && <MasterSpecs />}
    </g>
  );
}
/** N. O. Ir's hood, seen from above with the body (head-up frame, head centre ≈ 31, 16): the hood still up, the face a void, two pale X eyes, the brass clasp. */
const SECOND_CLOAK = "#1a1c27";
function SecondHood() {
  return (
    <g>
      <path d="M31 .6C21.6 .6 17 8.6 17 17.4C17 24.6 20.4 29.6 24.4 31.4H37.6C41.6 29.6 45 24.6 45 17.4C45 8.6 40.4 .6 31 .6Z" fill={SECOND_CLOAK} {...OS} />
      <path d="M31 1.4Q27.2 4.2 25.4 8M31 1.4Q34.8 4.2 36.6 8" {...IS} stroke="#3a3f55" />
      <path d="M31 6.6C25.8 6.6 23.2 11.2 23.2 16.6C23.2 22.2 26.6 26.4 31 26.4C35.4 26.4 38.8 22.2 38.8 16.6C38.8 11.2 36.2 6.6 31 6.6Z" fill="#050508" />
      <path d="M26.6 14.8L29 17.2M29 14.8L26.6 17.2M33 14.8L35.4 17.2M35.4 14.8L33 17.2" fill="none" stroke="#aab0c2" strokeWidth=".9" strokeLinecap="round" />
      <circle cx="31" cy="31.4" r="1.8" {...IS} fill={BRASS} />
    </g>
  );
}
/** Master U. M. Bra's round brass spectacles, knocked off beside his head: one temple folded, the other splayed, the near lens cracked. */
function MasterSpecs() {
  const brass = MASTER_LOOK.pal.frame, lens = "#cfe4ec";
  return (
    <g transform="translate(58.6 19.4) rotate(46) scale(.92)">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" stroke={INK} strokeWidth="2.7">
        <path d="M-3.2 0L-8.4 -1.6M3.2 0Q4.6 -1.6 6 0M12.4 0L15.4 3.6L13.4 5.4" />
      </g>
      <circle cx="0" cy="0" r="3.2" fill={lens} stroke={INK} strokeWidth="2.6" />
      <circle cx="9.2" cy=".2" r="3.2" fill={lens} stroke={INK} strokeWidth="2.6" />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" stroke={brass} strokeWidth="1.2">
        <path d="M-3.2 0L-8.4 -1.6M3.2 0Q4.6 -1.6 6 0M12.4 0L15.4 3.6L13.4 5.4" />
        <circle cx="0" cy="0" r="3.2" /><circle cx="9.2" cy=".2" r="3.2" />
      </g>
      <path d="M-1.8 -2L.4 .2L-.6 1.4L1.6 2.6M.4 .2L2.2 -1" {...IS} strokeWidth=".6" />
      <path d="M7.6 -1.4Q8.6 -2.2 9.8 -2" fill="none" stroke="#fff" strokeWidth=".7" strokeLinecap="round" />
    </g>
  );
}


/* ====================================================================== */
/*  BIOME PROPS · same camera, same rules (OS 1.5 outline, IS 0.9 detail,   */
/*  flat GroundShadow; LOW = flush, calm centre so tokens sit on top)       */
/* ====================================================================== */
export const useUid = () => "u" + useId().replace(/[^a-zA-Z0-9]/g, "");
/** Deterministic little scatter of points (so sprites never flicker between renders). */
export const scatter = (n, seed, x0, y0, x1, y1) => {
  const rnd = mulberry32(seed), out = [];
  for (let i = 0; i < n; i++) out.push([+(x0 + rnd() * (x1 - x0)).toFixed(1), +(y0 + rnd() * (y1 - y0)).toFixed(1)]);
  return out;
};

/* ---- UNIVERSAL: CRATE, PUDDLE ---- */

/** SHORT. Pine shipping crate at knee-to-waist height (SHORT camera): a lid of three boards seen from above, a framed
 *  front (corner posts and rails) with a diagonal brace and nail heads, a hand hole in the darker east side. */
export function Crate() {
  const pine = "#c99c5e", pineL = "#e2bc7e", pineD = "#94703f", hole = "#3a2616";
  const x = 13, y = 34, w = 32, h = 22, dx = 6, dy = 12, b = 4.2; // front 13..45 × 34..56, top back edge y 22; post width b
  const P = (uu, v) => [r2(x + uu * w + v * dx), r2(y - v * dy)];
  const x0 = x + b, x1 = x + w - b, y0 = y + 4, y1 = y + h - 4; // the infill between posts and rails
  return (
    <g>
      <GroundShadow cx={34} cy={57} rx={22} ry={3.4} />
      {/* east side with a plank seam and a hand hole */}
      <path d={slabSide(x, y, w, h, dx, dy)} fill={pineD} {...OS} />
      <path d={`M${x + w} ${y + h / 2}L${x + w + dx} ${y + h / 2 - dy}`} {...IS} />
      <path d={polyD([x + w + 1.6, y + 4.2], [x + w + 4.4, y - 1.4], [x + w + 4.4, y + .6], [x + w + 1.6, y + 6.2])} {...IS} fill={hole} />
      {/* lid: three boards */}
      <path d={slabTop(x, y, w, dx, dy)} fill={pineL} {...OS} />
      {[1 / 3, 2 / 3].map((v) => <path key={v} d={`M${P(0, v).join(" ")}L${P(1, v).join(" ")}`} {...IS} />)}
      {/* front: posts, rails, infill seams and the diagonal brace */}
      <path d={inkBox(x, y, w, h, 1, .3)} fill={pine} {...OS} />
      <path d={`M${x0} ${y}V${y + h}M${x1} ${y}V${y + h}M${x0} ${y0}H${x1}M${x0} ${y1}H${x1}M${x0} ${r2(y0 + (y1 - y0) / 3)}H${x1}M${x0} ${r2(y0 + 2 * (y1 - y0) / 3)}H${x1}`} {...IS} />
      <path d={polyD([x0, y1], [x0, y1 - 4], [x1, y0], [x1, y0 + 4])} {...IS} fill={pine} />
      {[[x + 2.1, y + 2], [x1 + 2.1, y + 2], [x + 2.1, y + h - 2], [x1 + 2.1, y + h - 2]].map(([nx, ny]) => <circle key={`${nx}${ny}`} cx={nx} cy={ny} r=".9" fill={INK} />)}
    </g>
  );
}


/** LOW. Puddle, a top-down footprint flush with the floor (art/STYLE.md, LOW props): a lobed pool of rain water in OS,
 *  one deeper shade along its far edge, one pale streak of reflected sky, a ripple ring, and a small second puddle
 *  splashed off to the north-west. It spreads wider than a token so the water shows round anyone standing in it. No shadow. */
export function Puddle() {
  const water = "#5c8ea8", waterD = "#3f6c86", sky = "#cfe6ef";
  const pool = "M8.4 33.4C7.4 25.4 13.6 19.4 22.6 18.8C28.4 13.4 41.4 12.4 49 17.6C55.8 21 58.2 28.6 55.4 34.4C56.4 42.6 49.8 48.6 40.6 47.4C34.6 50.6 25.4 50.6 20.4 47C12.8 46.2 8.8 40.8 8.4 33.4Z";
  return (
    <g>
      <path d={pool} fill={water} {...OS} />
      <path d="M10.8 31.4C11 25 16.4 21.4 23.6 21.4C29.4 16.4 41 15.8 47.6 20.6C41.4 19.6 34 20.8 29.6 24.2C22.4 23.6 15.6 26 10.8 31.4Z" fill={waterD} />
      <path d="M21.4 39.6Q30 43.4 41.6 40.2" fill="none" stroke={sky} strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="38.6" cy="30.4" rx="7.4" ry="4" fill="none" stroke={sky} strokeOpacity=".6" strokeWidth=".9" />
      <path d="M5.6 12.4C5.2 9.2 8.6 7.4 11.8 8.2C15 8.8 16.4 11.4 14.8 13.6C13 15.8 6.2 15.6 5.6 12.4Z" fill={water} {...OS} />
    </g>
  );
}

/* ---- FARM: HAYBALE, TRACTOR, WELL, MUD, STRAW_MAT ---- */

/** TALL. Hay bale stack, well above head height: six tied golden bales stacked in a 3-2-1 pyramid, each seen from the
 *  front and slightly above (lit top, mid-tone straw face, darker east end), with two twine bands over every bale and
 *  loose stalks. The upper bales cover the tops below, so the stepped tops show at both sides. */
export function Haybale() {
  const hay = ["#dcb457", "#e5c166"], hayL = "#f1da8a", hayD = "#a47c26", twine = "#6a4a14", tick = "#b3892b";
  const bw = 16, bh = 15, d = 5;
  const rows = [[5.5, 3], [13.5, 2], [21.5, 1]]; // first bale's x, bales in the row (bottom row first)
  const bales = rows.flatMap(([x0, n], r) => Array.from({ length: n }, (_, i) => ({ x: x0 + i * bw, y: 57 - (r + 1) * bh, r, i })));
  const stalks = [[3, 4], [9.4, 7.6], [5.6, 11.4]]; // little straw ticks on a face
  return (
    <g>
      <GroundShadow cx={32} cy={57.4} rx={28} ry={3.6} />
      {bales.map(({ x, y, r, i }) => (
        <g key={`${r}${i}`}>
          <path d={slabSide(x, y, bw, bh, d, d)} fill={hayD} {...OS} />
          <path d={inkBox(x, y, bw, bh, 1.4, .3)} fill={hay[(r + i) % 2]} {...OS} />
          <path d={slabTop(x, y, bw, d, d)} fill={hayL} {...OS} />
          <path d={stalks.map(([sx, sy]) => `M${r2(x + sx + (r + i) % 2)} ${r2(y + sy)}h3.2`).join("")} stroke={tick} strokeWidth=".9" strokeLinecap="round" fill="none" />
          <path d={[4.6, bw - 4.6].map((tx) => `M${r2(x + tx)} ${y}V${y + bh}M${r2(x + tx)} ${y}l${d} ${-d}`).join("")} stroke={twine} strokeWidth="1.2" strokeLinecap="butt" fill="none" />
        </g>
      ))}
      {/* loose stalks at the foot */}
      <path d="M2.4 56.6l3.4 -1.8M3.6 58l3.8 -.2M60.6 56.6l-3.2 -1.8M59 58.2l-3.6 -.4" stroke={tick} strokeWidth="1" strokeLinecap="round" fill="none" />
    </g>
  );
}

/** TALL. Red farm tractor, clearly taller than a person (cab roof about 53 units up), seen from its side: a long
 *  hood with a cream grille, a headlamp and a vented side, an exhaust stack, a glazed cab (steering wheel and seat
 *  behind the glass, a roof slab with its top showing) behind a big lugged rear wheel under a red mudguard, and a
 *  small front wheel. Shaded on the east end of the cab and along the bottom of the hood. */
export function Tractor() {
  const u = useUid();
  const red = "#c2382f", redL = "#e0584c", redD = "#8d2a24", glass = "#a5d0e3", tire = "#2a2b32", lug = "#4b4d57", hub = "#f2c24a", hubD = "#b88e20", seat = "#2f3f66";
  const hood = inkBox(6, 31, 26, 15, 2.5, .4);
  const R = 14.2, cx = 42, cy = 43; // rear wheel
  const lugs = Array.from({ length: 14 }, (_, i) => {
    const a = (i * Math.PI * 2) / 14;
    return `M${r2(cx + Math.cos(a) * (R - 3))} ${r2(cy + Math.sin(a) * (R - 3))}L${r2(cx + Math.cos(a) * (R - .9))} ${r2(cy + Math.sin(a) * (R - .9))}`;
  }).join("");
  const fender = `M${cx - 16.6} ${cy}A16.6 16.6 0 0 1 ${cx + 16.6} ${cy}L${cx + 14.4} ${cy}A14.4 14.4 0 0 0 ${cx - 14.4} ${cy}Z`;
  return (
    <g>
      <defs><clipPath id={`${u}h`}><path d={hood} /></clipPath></defs>
      <GroundShadow cx={32} cy={57.4} rx={28} ry={3.6} />
      {/* exhaust stack, behind the hood */}
      <path d={inkBox(12, 11, 3.6, 22, .8, .2)} fill="#6b7078" {...OS} />
      <path d={inkBox(10.8, 9, 6, 3, 1, .2)} fill="#3a3d44" {...OS} />
      {/* cab: east end, glazed front with seat and wheel, roof */}
      <path d={polyD([53, 12], [58, 7], [58, 27], [53, 32])} fill={redD} {...OS} />
      <path d={inkBox(31, 12, 22, 20, 1.2, .3)} fill={red} {...OS} />
      <path d={inkBox(34, 14, 16, 15.4, .8, .2)} {...IS} fill={glass} />
      <path d="M37 28L41.4 15.4M42.4 28L45.8 17.4" stroke="#eaf6fb" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <path d={inkBox(45, 17, 3, 10, .8, .1)} {...IS} fill={seat} />
      <path d={inkBox(40.6, 25.2, 7.4, 3, .8, .1)} {...IS} fill={seat} />
      <path d="M37 28.4L38.6 21.6" {...IS} strokeWidth="1.4" />
      <path d="M36.2 20.4L41.4 22.8" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      <path d={slabTop(29.6, 12, 25, 5, 4.6)} fill={redL} {...OS} />
      <path d={inkBox(29.6, 8.6, 25, 3.8, 1, .2)} fill={red} {...OS} />
      <path d={polyD([29.6, 8.4], [34.6, 3.8], [59.6, 3.8], [54.6, 8.4])} fill={redL} {...OS} />
      {/* hood: body, a darker underside, vents, grille and lamp */}
      <path d={hood} fill={red} />
      <g clipPath={`url(#${u}h)`}><path d="M0 41H40V50H0Z" fill={redD} /></g>
      <path d={hood} fill="none" {...OS} />
      <path d={slabTop(7, 31, 24, 4.4, 3.4)} fill={redL} {...OS} />
      <path d="M13 36H27M13 38.6H27" {...IS} stroke="#5b1a16" />
      <path d={inkBox(3.2, 33, 3.8, 11, 1, .2)} fill="#ece0b4" {...OS} />
      <path d="M3.6 36.4H6.6M3.6 39H6.6M3.6 41.6H6.6" {...IS} />
      <circle cx="4.4" cy="31.8" r="2.1" fill="#f6e27a" {...OS} />
      {/* front wheel */}
      <circle cx="14" cy="49" r="8" fill={tire} {...OS} />
      <circle cx="14" cy="49" r="4" fill={hub} {...OS} strokeWidth=".9" />
      <circle cx="14" cy="49" r="1.3" fill={hubD} />
      {/* rear wheel: tire, lugs, hub, then the mudguard over its top */}
      <circle cx={cx} cy={cy} r={R} fill={tire} {...OS} />
      <path d={lugs} stroke={lug} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <circle cx={cx} cy={cy} r="7.4" fill={hub} {...OS} strokeWidth=".9" />
      <circle cx={cx} cy={cy} r="2.4" {...IS} fill={hubD} />
      <path d={`M${cx} ${cy - 7.2}V${cy - 3}M${cx + 6.2} ${cy + 3.6}L${cx + 2.6} ${cy + 1.5}M${cx - 6.2} ${cy + 3.6}L${cx - 2.6} ${cy + 1.5}`} {...IS} />
      <path d={fender} fill={red} {...OS} />
    </g>
  );
}

/** SHORT. Stone well at waist height (SHORT camera): a low round wall of staggered stones, its rim seen from above round
 *  a dark pool of water, shaded on the east; two timber posts rise from the rim to a crank beam with a rope and a
 *  wooden bucket hanging over the water, and a crank handle at the east end. No roof, so sight passes over it. */
export function Well() {
  const u = useUid();
  const stone = "#a8a59d", stoneL = "#cbc8bf", stoneD = "#77746c", wood = "#9a6a3a", woodL = "#b98650", woodD = "#6c4526", water = "#2f5c80", waterL = "#7db1d0", rope = "#e2d3a4";
  const cx = 32, rx = 17.5, ry = 7.4, yt = 37, yb = 49.6;
  const body = `M${cx - rx} ${yt}V${yb}A${rx} ${ry} 0 0 0 ${cx + rx} ${yb}V${yt}Z`;
  const course = (y) => `M${cx - rx} ${y}A${rx} ${ry} 0 0 0 ${cx + rx} ${y}`;
  const joint = (k, c0, c1) => { const e = ry * Math.sqrt(1 - (k / rx) ** 2); return `M${r2(cx + k)} ${r2(yt + c0 + e)}V${r2(yt + c1 + e)}`; };
  const joints = [-12, -4, 4, 12].map((k) => joint(k, 0, 4.6)).join("") + [-15, -8, 0, 8, 15].map((k) => joint(k, 4.6, 9)).join("") + [-11, -3, 6, 13].map((k) => joint(k, 9, 13)).join("");
  return (
    <g>
      <defs><clipPath id={`${u}b`}><path d={body} /></clipPath></defs>
      <GroundShadow cx={33} cy={57.4} rx={24} ry={3.6} />
      <path d={body} fill={stone} />
      <g clipPath={`url(#${u}b)`}>
        <path d={`M${cx + 7} 0H60V64H${cx + 7}Z`} fill={stoneD} />
        <path d={course(yt + 4.6) + course(yt + 9)} {...IS} />
        <path d={joints} {...IS} />
      </g>
      <path d={body} fill="none" {...OS} />
      {/* rim: a stone ring round the pool */}
      <ellipse cx={cx} cy={yt} rx={rx} ry={ry} fill={stoneL} {...OS} />
      <ellipse cx={cx} cy={yt + .4} rx={rx - 4.2} ry={ry - 2.4} fill={water} {...OS} strokeWidth="1.2" />
      <path d={`M${cx - 6.6} ${yt + 1.6}Q${cx - 2} ${yt - .2} ${cx + 3} ${yt + .8}`} stroke={waterL} strokeWidth="1" strokeLinecap="round" fill="none" />
      <path d={`M${cx - 15.4} ${yt - .6}l1.8 1.6M${cx - 11} ${yt - 5}l1.2 1.6M${cx + 12} ${yt - 4.6}l-1.6 1.6M${cx + 14.4} ${yt + .4}l-1.8 1.4`} {...IS} />
      {/* posts, crank beam, handle, rope and bucket */}
      <path d={inkBox(14.6, 19, 3.6, yt + 2.4 - 19, .8, .2)} fill={wood} {...OS} />
      <path d={inkBox(46.4, 19, 3.6, yt + 2.4 - 19, .8, .2)} fill={woodD} {...OS} />
      <path d={inkBox(12.6, 17.4, 38.8, 3.8, 1, .2)} fill={woodL} {...OS} />
      <path d="M51.4 19.4H58.6" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
      <path d="M51.4 19.4H58.6" stroke={wood} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="59" cy="19.4" r="1.8" {...IS} fill={woodL} />
      <path d={`M${cx} 21.2V29.4`} stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <path d={`M${cx} 21.2V29.4`} stroke={rope} strokeWidth="1.1" strokeLinecap="round" />
      <path d={`M${cx - 4} 29.4H${cx + 4}L${cx + 3.2} 36.6Q${cx} 37.8 ${cx - 3.2} 36.6Z`} fill={wood} {...OS} />
      <path d={`M${cx - 3.8} 31.6H${cx + 3.8}M${cx - 3.4} 34.4H${cx + 3.4}`} {...IS} />
    </g>
  );
}


/** LOW. Mud patch, a top-down footprint flush with the floor (art/STYLE.md, LOW props): a lobed splat of wet brown mud in
 *  OS with a darker damp edge all round and a lighter slick pool inside, two pale wet streaks, bubble rings, a boot
 *  print pressed into it and two small splats thrown to the sides. Wide enough that the mud shows round a token. No shadow. */
export function Mud() {
  const edge = "#3f2c1d", mud = "#6a4b33", wet = "#b79470", print = "#47301f";
  const pts = [[8.6, 34], [10.6, 26.4], [17, 20.6], [25, 19.4], [29.4, 14.6], [37, 14.6], [42, 19.6], [50, 19.8], [56, 26.4], [56.6, 34.6], [52, 41.8], [44.4, 43.8], [40.6, 49.6], [31, 48.6], [24, 50.6], [16, 45.6], [10.8, 41.2]];
  const pool = lobed(pts, .55);
  return (
    <g>
      <path d={pool} fill={edge} {...OS} />
      <path d={pool} fill={mud} transform="translate(32.5 33.2) scale(.8) translate(-32.5 -33.2)" />
      <path d="M17.4 39.4Q26 44 37.4 40.6" stroke={wet} strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M42.6 24.6Q49 26.2 50.6 31.6" stroke={wet} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M20 26.4Q24 23.4 29 24" stroke={wet} strokeWidth="1.3" strokeLinecap="round" fill="none" />
      {[[23.6, 33, 3.6, 2.4], [33.6, 25.6, 2.2, 1.5]].map(([bx, by, rx, ry]) => <ellipse key={bx} cx={bx} cy={by} rx={rx} ry={ry} stroke={wet} strokeOpacity=".75" strokeWidth=".9" fill="none" />)}
      {/* a boot print: sole and heel */}
      <g fill={print} transform="rotate(-24 42 36)">
        <path d="M37.4 31.6C39.8 29.8 44.6 30.2 46.2 32.6C47.4 34.6 46.2 37.4 43.6 38.6C40.6 39.8 37.4 38.6 36.8 35.8C36.6 34 36.8 32.6 37.4 31.6Z" />
        <path d="M38.4 40.6C40.6 40.2 43.2 40.6 44.2 42.2C44.8 43.6 43.8 45 41.8 45.2C39.8 45.4 38 44.4 37.8 43C37.6 41.8 37.8 40.8 38.4 40.6Z" />
      </g>
      {/* splats */}
      <path d="M5.8 13.4C5.2 10.2 8.6 8.2 11.8 9C15 9.6 16.4 12.2 14.8 14.4C13 16.6 6.4 16.6 5.8 13.4Z" fill={mud} {...OS} />
      <path d="M54.4 55.4C53.8 53 56.2 51.4 58.6 52C60.8 52.6 61.4 54.8 60 56.4C58.6 58 54.8 57.6 54.4 55.4Z" fill={mud} {...OS} />
    </g>
  );
}

/** LOW. Straw mat, a flat woven top-down mat to sit on (art/STYLE.md, LOW props): a golden twill of crossing straw
 *  stripes in a rounded rectangle, a darker braided border with plait ticks all round, and a short fringe of loose
 *  straw at both ends. Flush: you sit on it, so the middle stays calm for a token. No shadow. */
export function StrawMat() {
  const u = useUid();
  const x = 8, y = 13, w = 48, h = 38, r = 3.4, b = 4.2;
  const straw = "#dcbb5b", strawD = "#b08a2e", strawL = "#f0d98a", border = "#c19a3a";
  const outer = inkBox(x, y, w, h, r, .3);
  const lines = (c, a) => {
    let s = "";
    for (let t = -h; t < w + h; t += 5.6) s += a > 0 ? `M${x + t} ${y + h}L${x + t + h} ${y}` : `M${x + t} ${y}L${x + t + h} ${y + h}`;
    return s;
  };
  const ticks = [];
  for (let t = x + 4; t < x + w - 3; t += 3.6) ticks.push(`M${r2(t)} ${y + .4}l1.8 ${b - .8}M${r2(t)} ${y + h - .4}l1.8 ${-(b - .8)}`);
  for (let t = y + 4; t < y + h - 3; t += 3.6) ticks.push(`M${x + .4} ${r2(t)}l${b - .8} 1.8M${x + w - .4} ${r2(t)}l${-(b - .8)} 1.8`);
  return (
    <g>
      <defs><clipPath id={`${u}m`}><path d={outer} /></clipPath></defs>
      {/* fringe at the two ends */}
      <path d={Array.from({ length: 8 }, (_, i) => `M${x} ${y + 3 + i * 4.6}h-3.6M${x + w} ${y + 3 + i * 4.6}h3.6`).join("")} stroke={strawD} strokeWidth="1.1" strokeLinecap="round" fill="none" />
      <path d={outer} fill={straw} />
      <g clipPath={`url(#${u}m)`}>
        <path d={lines(0, 1)} stroke={strawD} strokeOpacity=".55" strokeWidth="1.2" fill="none" />
        <path d={lines(0, -1)} stroke={strawL} strokeOpacity=".8" strokeWidth="1.2" fill="none" />
        <path d={`${outer}${inkBox(x + b, y + b, w - 2 * b, h - 2 * b, 1.4, .2)}`} fill={border} fillRule="evenodd" />
        <path d={ticks.join("")} stroke={strawD} strokeWidth="1" strokeLinecap="round" fill="none" />
      </g>
      <path d={inkBox(x + b, y + b, w - 2 * b, h - 2 * b, 1.4, .2)} {...IS} />
      <path d={outer} fill="none" {...OS} />
    </g>
  );
}

/* ---- BEACH: UMBRELLA, SURF_RACK, TOWEL ---- */


/** LOW. Beach umbrella you stand under, planted in the sand (board camera, seen a little from above): a white pole
 *  pushed into a small sand mound rises to a wide, open canopy of eight red and cream panels, a shallow cone whose top
 *  shows, with scalloped edges between the rib tips, a red valance hanging round the front and a brass finial on top.
 *  The canopy spreads over the top of the tile and the pole runs down its middle, so a token standing under it (drawn
 *  over it, at the tile centre) leaves the canopy showing above and the pole's foot below. No cast shadow. */
export function Umbrella() {
  const red = "#d2453d", redD = "#9c2f29", cream = "#f4efe2", creamD = "#d9d0ba", pole = "#eceae4", poleD = "#a9a59a", sand = "#d9bd7e", sandD = "#b89a5c";
  const cx = 32, cy = 16, rx = 28, ry = 9.6, ax = 32, ay = 8.4; // canopy rim ellipse and the raised apex
  const E = (deg, k = 1) => { const a = (deg * Math.PI) / 180; return [r2(cx + rx * k * Math.cos(a)), r2(cy + ry * k * Math.sin(a))]; };
  const ks = [0, 1, 2, 3, 4, 5, 6, 7], ang = (k) => k * 45 + 22.5;
  // each panel: apex to rib tip to rib tip, its rim edge a shallow scallop pulled in toward the apex
  const scal = (k) => { const [mx, my] = E(ang(k) + 22.5, .9); return [r2(mx + (ax - mx) * .04), r2(my + (ay - cy) * .3)]; };
  const panel = (k) => `M${ax} ${ay}L${E(ang(k))}Q${scal(k)} ${E(ang(k + 1))}Z`;
  const rim = `M${E(ang(0))}` + ks.map((k) => `Q${scal(k)} ${E(ang(k + 1))}`).join("") + "Z";
  // the valance: a scalloped band hanging under the front half of the rim (rib tips at 22.5..157.5 degrees)
  const front = [0, 1, 2, 3];
  const val = `M${E(ang(0))}` + front.map((k) => `Q${scal(k)} ${E(ang(k + 1))}`).join("")
    + `L${E(ang(4))[0]} ${E(ang(4))[1] + 2.6}` + [...front].reverse().map((k) => { const [sx, sy] = scal(k), [px, py] = E(ang(k)); return `Q${sx} ${r2(sy + 4.4)} ${px} ${r2(py + 2.6)}`; }).join("") + "Z";
  return (
    <g>
      {/* sand mound with the pole pushed into it */}
      <path d="M22 56.6Q24 52.6 32 52.4Q40 52.6 42 56.6Q32 58.6 22 56.6Z" fill={sand} {...OS} />
      <path d="M26 55.4Q32 54.2 38 55.4" {...IS} stroke={sandD} />
      <path d={inkBox(30.4, 20, 3.2, 35.4, 1.2, .1)} fill={pole} {...OS} />
      <path d="M32.4 22V54.6" stroke={poleD} strokeWidth="1.1" />
      <path d={inkBox(29.6, 36, 4.8, 3, .8, 0)} {...IS} fill={poleD} />
      {/* canopy: the valance under the front, the panels, ribs, one glint, the rim, then the finial */}
      <path d={val} fill={redD} {...OS} />
      {ks.map((k) => <path key={k} d={panel(k)} fill={k % 2 ? cream : red} />)}
      {ks.map((k) => <path key={`r${k}`} d={`M${ax} ${ay}L${E(ang(k))}`} {...IS} />)}
      <path d={`M${r2(ax - 5)} ${r2(ay + .6)}Q${r2(ax - 13)} ${r2(ay + 1.4)} ${r2(ax - 19)} ${r2(ay + 3.6)}`} fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.5" strokeLinecap="round" />
      <path d={rim} fill="none" {...OS} />
      {ks.map((k) => { const [px, py] = E(ang(k)); return <circle key={`t${k}`} cx={px} cy={py} r=".9" fill={creamD} stroke={INK} strokeWidth=".6" />; })}
      <circle cx={ax} cy={ay - .6} r="2" {...IS} fill={BRASS} />
    </g>
  );
}

/** TALL. Surfboard rack, about 2 m: a low wooden base trough (its top seen from above) with a post at each end and a
 *  rear rail behind, holding four tall boards upright, tails down in the trough and pointed noses up: each a classic
 *  surfboard outline (widest a little below the middle, tapering to a sharp nose) with a dark stringer down its middle,
 *  in teal, coral, yellow and green with cream stripes and a shaded east half, a front rail tying the posts across them.
 *  Warm timber with bright boards, so it reads on sand and boardwalk. */
export function SurfRack() {
  const u = useUid();
  const wood = "#a8743c", woodL = "#c9935f", woodD = "#6e4526", cream = "#f4efe2";
  const boards = [[17.5, "#2f9fb2", "#1f6f80", -2.4, 5], [28, "#e2574c", "#a8352c", 1.4, 3], [38.4, "#f2c14e", "#b58a20", -1, 4], [48.4, "#6dbf74", "#3f8a4a", 2.6, 6]];
  const board = ([cx, c, cD, tilt, top], i) => {
    // tail (hidden in the trough) at y 51, widest a little below the middle, a sharp nose at `top`
    const out = `M${r2(cx - 4.2)} 51C${r2(cx - 5.6)} 33 ${r2(cx - 4)} ${top + 5} ${cx} ${top}C${r2(cx + 4)} ${top + 5} ${r2(cx + 5.6)} 33 ${r2(cx + 4.2)} 51Z`;
    const half = `M${cx} 51V${top}C${r2(cx + 4)} ${top + 5} ${r2(cx + 5.6)} 33 ${r2(cx + 4.2)} 51Z`;
    const W = `${r2(cx - 6)}`, w = 12;
    return (
      <g key={i} transform={`rotate(${tilt} ${cx} 51)`}>
        <defs><clipPath id={`${u}b${i}`}><path d={out} /></clipPath></defs>
        <path d={out} fill={c} />
        <g clipPath={`url(#${u}b${i})`}>
          {i === 0 && <path d={`M${W} 16.4h${w}v2.6h-${w}ZM${W} 21.4h${w}v1.6h-${w}Z`} fill={cream} />}
          {i === 1 && <path d={`M${W} 12h${w}v2h-${w}Z`} fill={cream} />}
          {i === 2 && <path d={`M${W} 24h${w}v5h-${w}Z`} fill={cream} />}
          {i === 3 && <path d={`M${W} 19L${cx} 23.4L${r2(cx + 6)} 19V22.6L${cx} 27L${W} 22.6Z`} fill={cream} />}
          <path d={half} fill={cD} fillOpacity=".55" />
        </g>
        {/* the stringer, nose to tail */}
        <path d={`M${cx} ${top + 2.4}V50`} stroke={INK} strokeWidth=".8" strokeOpacity=".7" />
        <path d={out} fill="none" {...OS} />
      </g>
    );
  };
  return (
    <g>
      <GroundShadow cx={33} cy={57.4} rx={25} ry={3.4} />
      {/* base trough: east end, top, front */}
      <path d={slabSide(6, 51.6, 49, 5.4, 5, 5)} fill={woodD} {...OS} />
      <path d={slabTop(6, 51.6, 49, 5, 5)} fill={woodL} {...OS} />
      {/* rear rail, the boards, the front posts and rail */}
      <path d={inkBox(9, 27.6, 48, 3.6, .8, .2)} fill={woodD} {...OS} />
      {boards.map(board)}
      <path d={inkBox(6, 51.6, 49, 5.4, .8, .2)} fill={wood} {...OS} />
      {[6, 51].map((px, i) => (
        <g key={px}>
          <path d={inkBox(px, 27, 4.6, 29.6, .8, .2)} fill={i ? woodD : wood} {...OS} />
          <path d={inkBox(px - .6, 25.4, 5.8, 3, .8, .2)} fill={woodL} {...OS} />
        </g>
      ))}
      <path d={inkBox(6, 38.4, 49.6, 3.8, .8, .2)} fill={wood} {...OS} />
    </g>
  );
}

/** LOW. Beach towel laid flat on one tile, top-down: a rounded rectangle of long teal, cream and coral stripes (running
 *  along the towel) with a woven hem line across each short end and a short fringe beyond it, and one corner turned
 *  over to show the paler underside, set a few degrees askew. A towel only ever covers one cell (the engine gives it no
 *  multi-tile span). Flush: you lie on it, so the middle stays calm for a token. No shadow. */
export function Towel() {
  const u = useUid(), cream0 = "#f4efe2";
  const L = 42, Wd = 30, hl = L / 2, hd = Wd / 2, f = 7.4; // sits well inside its one tile: about 49 x 30 with the fringe
  const bands = [["#2f9fb2", 1.1], [cream0, .55], ["#e2574c", 1.3], [cream0, .55], ["#2f9fb2", 1.1]];
  const total = bands.reduce((a, b) => a + b[1], 0);
  let acc = -hd;
  const rects = bands.map(([c, k], i) => { const h = (Wd * k) / total, y = acc; acc += h; return <rect key={i} x={-hl} y={r2(y)} width={L} height={r2(h) + .2} fill={c} />; });
  const body = `M${-hl + 2} ${-hd}H${hl - f}L${hl} ${-hd + f}V${hd - 2}Q${hl} ${hd} ${hl - 2} ${hd}H${-hl + 2}Q${-hl} ${hd} ${-hl} ${hd - 2}V${-hd + 2}Q${-hl} ${-hd} ${-hl + 2} ${-hd}Z`;
  const fringe = Array.from({ length: Math.floor(Wd / 3.6) }, (_, i) => { const y = r2(-hd + 2.8 + i * 3.6); return `M${-hl} ${y}h-3.4M${hl} ${y}h3.4`; }).join("");
  return (
    <g transform="translate(32 32) rotate(-3)">
      <defs><clipPath id={`${u}t`}><path d={body} /></clipPath></defs>
      <path d={fringe} stroke="#8f8670" strokeWidth="1.1" strokeLinecap="round" fill="none" />
      <g clipPath={`url(#${u}t)`}>
        {rects}
        <path d={`M${-hl + 3.6} ${-hd}V${hd}M${hl - 3.6} ${-hd}V${hd}`} {...IS} strokeOpacity=".6" />
      </g>
      <path d={body} fill="none" {...OS} />
      {/* the turned corner: the cut's mirror image, paler and plain */}
      <path d={`M${hl - f} ${-hd}L${hl} ${-hd + f}L${hl - f} ${-hd + f}Z`} fill="#e3dac1" {...OS} />
      <path d={`M${hl - f + 2.2} ${-hd + f - 2.4}L${hl - 3} ${-hd + 2.6}`} {...IS} strokeOpacity=".5" />
    </g>
  );
}


/* ---- Round D new props: WARDROBE (MANSION), TRASH_CAN (STREET), BEEHIVE (FARM), SARCOPHAGUS (DESERT) ---- */

/** TALL. Mahogany wardrobe, 2 m, clearly taller than a person: a tall cabinet with a projecting crown moulding (its
 *  top and east side showing), two framed doors with raised panels meeting at a centre seam with brass knobs and a
 *  keyhole, a drawer across the foot, a plinth and two bun feet standing on the floor. */
export function Wardrobe() {
  const wood = "#84502f", woodL = "#a8734a", woodD = "#58341f", panel = "#6c4026";
  const x = 15, y = 10, w = 34, h = 40, d = 5; // body front 15..49 × 10..50, side to x 54
  return (
    <g>
      <GroundShadow cx={34} cy={57} rx={22} ry={3.4} />
      {[17.4, 42.6].map((fx) => <path key={fx} d={inkBox(fx, 50, 5, 7, 1.8, 0)} fill={woodD} {...OS} />)}
      {/* east side, then the body front */}
      <path d={slabSide(x, y, w, h + 2.6, d, d)} fill={woodD} {...OS} />
      <path d={inkBox(x, y, w, h, 1, .3)} fill={wood} {...OS} />
      {/* plinth moulding */}
      <path d={inkBox(x - 1, 47.8, w + 2, 4.2, .8, 0)} fill={woodD} {...OS} />
      {/* two framed doors with raised panels, a centre seam, knobs and a keyhole */}
      {[17.4, 32.6].map((dx) => (
        <g key={dx}>
          <path d={inkBox(dx, 12.6, 14, 26.4, .8, 0)} {...IS} />
          <path d={inkBox(dx + 2.2, 14.8, 9.6, 13.4, .6, 0)} {...IS} fill={panel} />
          <path d={inkBox(dx + 2.2, 30.4, 9.6, 6, .6, 0)} {...IS} fill={panel} />
        </g>
      ))}
      <path d="M32 12.6V39" {...IS} />
      {[29.2, 34.8].map((kx) => <circle key={kx} cx={kx} cy="26.4" r="1.4" fill={BRASS} {...IS} />)}
      <path d="M33.8 29.2h1.4v2.6h-1.4z" fill={INK} />
      {/* drawer across the foot */}
      <path d={inkBox(17.4, 40.8, 29.2, 6, .8, 0)} {...IS} fill={wood} />
      {[24.4, 39.6].map((kx) => <circle key={kx} cx={kx} cy="43.8" r="1.2" fill={BRASS} {...IS} />)}
      {/* crown moulding: east edge, lit top, front cornice with a bead line */}
      <path d={slabSide(13, 5, 38, 5.6, d, d)} fill={woodD} {...OS} />
      <path d={slabTop(13, 5, 38, d, d)} fill={woodL} {...OS} />
      <path d={inkBox(13, 5, 38, 5.6, .8, .3)} fill={wood} {...OS} />
      <path d="M14.4 8.2H49.6" {...IS} />
      <path d="M17 5.2V8.2M21 5.2V8.2M25 5.2V8.2M29 5.2V8.2M33 5.2V8.2M37 5.2V8.2M41 5.2V8.2M45 5.2V8.2" stroke={woodD} strokeWidth=".7" />
    </g>
  );
}

/** SHORT. Street trash can at waist height (SHORT camera): a galvanised steel can with vertical ribs, two side handles
 *  and a couple of dents, a domed lid with a handle sitting straight on top, on a grey ground shadow. */
export function TrashCan() {
  const u = useUid();
  const steel = "#8c97a4", steelL = "#c0c9d3", steelD = "#5b6672";
  const cx = 31, rx = 12, yt = 27, yb = 52, ry = 4.8;
  const body = `M${cx - rx} ${yt}L${cx - rx + 1.4} ${yb}A${rx - 1.4} ${ry} 0 0 0 ${cx + rx - 1.4} ${yb}L${cx + rx} ${yt}Z`;
  const handles = `M${cx - rx - 1} 31.4Q${cx - rx - 5.4} 34 ${cx - rx - 1} 36.6M${cx + rx + 1} 31.4Q${cx + rx + 5.4} 34 ${cx + rx + 1} 36.6`;
  return (
    <g>
      <defs><clipPath id={`${u}c`}><path d={body} /></clipPath></defs>
      <GroundShadow cx={32} cy={57} rx={17} ry={3.4} />
      {/* side handles */}
      <path d={handles} fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
      <path d={handles} fill="none" stroke={steelD} strokeWidth="1.4" strokeLinecap="round" />
      <path d={body} fill={steel} />
      <g clipPath={`url(#${u}c)`}>
        <path d={`M${cx + 5} 20H50V64H${cx + 5}Z`} fill={steelD} />
        <path d={`M${cx - 9} 28V54H${cx - 6}V28Z`} fill={steelL} />
        {[-8, -4, 0, 4, 8].map((k) => <path key={k} d={`M${cx + k} ${yt + 1}Q${cx + k * 1.05} ${yb - 2} ${cx + k * 1.04} ${yb + 4}`} {...IS} strokeOpacity=".7" />)}
      </g>
      <path d={body} fill="none" {...OS} />
      {/* dents */}
      <path d="M22.4 40.8Q25 38.8 26.6 41.4Q25 43.6 22.4 40.8Z" fill={steelD} fillOpacity=".5" />
      <path d="M33.6 33.4Q36.4 31.8 37.6 34.4" {...IS} />
      {/* the lid, sitting straight: a short skirt, a domed top and a handle */}
      <path d={`M${cx - 13.4} 26.2A13.4 4.8 0 0 0 ${cx + 13.4} 26.2L${cx + 13.4} 23.8A13.4 4.8 0 0 0 ${cx - 13.4} 23.8Z`} fill={steelD} {...OS} />
      <ellipse cx={cx} cy="23.8" rx="13.4" ry="4.8" fill={steelL} {...OS} />
      <ellipse cx={cx} cy="23.8" rx="8.6" ry="3" {...IS} />
      <path d={inkBox(cx - 3.2, 19.4, 6.4, 2.8, 1.2, 0)} fill={steel} {...OS} />
    </g>
  );
}

/** SHORT. Beehive, knee-high: three white wooden hive boxes stacked on a stand, the middle one butter-yellow, with
 *  hand slots in each, a dark entrance slot over a brown landing board at the foot, a slightly overhanging grey roof
 *  lid (SHORT camera, its top plane showing), and four bees round the entrance. */
export function Beehive() {
  const white = "#f3efe2", whiteD = "#cbc4ad", yel = "#f1d77e", yelD = "#c9ac4c", roof = "#8d949c", roofL = "#bcc3ca", roofD = "#626972", wood = "#8d5d35", slot = "#4a3a28";
  const x = 17, w = 26, dx = 6, dy = 9, rows = [[45, 7, white], [38, 7, yel], [31, 7, white]];
  return (
    <g>
      <GroundShadow cx={34} cy={57} rx={21} ry={3.4} />
      {/* stand and landing board */}
      <path d={inkBox(18, 52, 4, 5, 1, 0)} fill={wood} {...OS} /><path d={inkBox(38, 52, 4, 5, 1, 0)} fill={wood} {...OS} />
      <path d={inkBox(14, 50.6, 32, 3, .8, 0)} fill={wood} {...OS} />
      {/* the stack: east faces first, then the fronts */}
      {rows.map(([ry, rh, c]) => <path key={`s${ry}`} d={slabSide(x, ry, w, rh, dx, dx * .6)} fill={c === white ? whiteD : yelD} {...OS} />)}
      {rows.map(([ry, rh, c]) => (
        <g key={ry}>
          <path d={inkBox(x, ry, w, rh, .8, .2)} fill={c} {...OS} />
          <path d={inkBox(x + 8, ry + 2.2, 10, 2.2, 1, 0)} {...IS} fill={slot} />
        </g>
      ))}
      <path d={inkBox(x + 3, 49.4, 20, 1.6, .7, 0)} fill="#1b1d22" />
      {/* roof lid: east edge, grey top plane, front lip */}
      <path d={slabSide(x - 2, 26.4, w + 4, 4.6, dx, dy)} fill={roofD} {...OS} />
      <path d={slabTop(x - 2, 26.4, w + 4, dx, dy)} fill={roofL} {...OS} />
      <path d={polyD([x + 1, 25.4], [x + 5, 20], [x + w - 4, 20], [x + w - 8, 25.4])} fill={roof} {...IS} />
      <path d={inkBox(x - 2, 26.4, w + 4, 4.6, .8, .2)} fill={roof} {...OS} />
      {/* bees */}
      {[[20, 47.4, -20], [34.6, 56.6, 15], [45, 44, -10], [48.4, 33.6, 25]].map(([bx, by, r], i) => (
        <g key={i} transform={`translate(${bx} ${by}) rotate(${r})`}>
          <ellipse cx="-1.6" cy="-2.4" rx="1.9" ry="1.2" {...IS} fill="#e6f0f4" strokeWidth=".6" transform="rotate(-30 -1.6 -2.4)" />
          <ellipse cx="0" cy="0" rx="2.8" ry="1.8" {...IS} fill="#f2c230" strokeWidth=".7" />
          <path d="M-.4 -1.6V1.6M1.2 -1.5V1.5" stroke={INK} strokeWidth=".9" />
        </g>
      ))}
    </g>
  );
}

/** SHORT. Sarcophagus, waist-high carved stone coffin (SHORT camera, like the desk): a sandstone trough with a lid whose
 *  top plane shows a mummiform figure in low relief, a gold mask under a blue-and-gold striped headdress at the west end,
 *  crossed arms, and bands down the body to the feet. The front is a lid lip over a trough carved with an eye, glyphs
 *  and a dado line, on a plinth; the east end is the darker shade. */
export function Sarcophagus() {
  const stone = "#c6b38b", stoneL = "#dccca4", stoneD = "#8e7b57", carve = "#5a4932", gold = "#d9a441", lapis = "#3d6aa4";
  const x = 8, y = 38, w = 42, h = 18, dx = 6, dy = 12;
  const P = (uu, v) => [r2(x + uu * w + v * dx), r2(y - v * dy)];
  // figure outline: half-width (in v) along its length, head at the west end
  const hw = [[.03, .2], [.1, .3], [.2, .3], [.28, .27], [.5, .24], [.7, .2], [.9, .15], [.97, .1]];
  const upper = hw.map(([uu, a]) => P(uu, .5 + a)), lower = [...hw].reverse().map(([uu, a]) => P(uu, .5 - a));
  const fig = polyD(...upper, ...lower);
  const [hx, hy] = P(.12, .5);
  return (
    <g>
      <GroundShadow cx={33} cy={57.4} rx={27} ry={3.2} />
      {/* east end, then the front: plinth, trough, lid lip */}
      <path d={slabSide(x, y, w, h, dx, dy)} fill={stoneD} {...OS} />
      <path d={`M${x + w + .6} ${y + 5}L${x + w + dx - .6} ${y + 5 - dy}`} {...IS} />
      <path d={inkBox(x - 1.4, y + h - 3.4, w + 2.8, 3.4, .6, 0)} fill={stoneD} {...OS} />
      <path d={inkBox(x, y, w, h - 3.4, .8, .3)} fill={stone} {...OS} />
      <path d={inkBox(x - 1.4, y, w + 2.8, 4.2, .8, .2)} fill={stoneL} {...OS} />
      {/* carved front: eye, glyphs and a dado line */}
      <path d={`M${x + 3} ${y + 12.6}H${x + w - 3}`} {...IS} />
      <path d={`M${x + 4} ${y + 8.6}Q${x + 7} ${y + 6.2} ${x + 10} ${y + 8.6}Q${x + 7} ${y + 11} ${x + 4} ${y + 8.6}Z`} {...IS} />
      <circle cx={x + 7} cy={y + 8.6} r="1.2" fill={carve} />
      <path d={`M${x + 13} ${y + 6.6}V${y + 11}M${x + 16.4} ${y + 6.6}V${y + 11}M${x + 19.8} ${y + 7.4}Q${x + 22.4} ${y + 5.6} ${x + 24.6} ${y + 7.4}Q${x + 22.4} ${y + 9.2} ${x + 19.8} ${y + 7.4}M${x + 22.2} ${y + 9.2}V${y + 11.2}M${x + 29} ${y + 6.4}V${y + 11}L${x + 32.4} ${y + 11}M${x + 35.4} ${y + 6.6}H${x + 39.4}M${x + 37.4} ${y + 6.6}V${y + 11}`} fill="none" stroke={carve} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      {/* lid: lit top plane with the figure in relief */}
      <path d={slabTop(x - 1.4, y, w + 2.8, dx, dy)} fill={stoneL} {...OS} />
      <path d={fig} fill={stone} {...IS} />
      {/* bands across the body and crossed arms */}
      {[.55, .66, .77, .88].map((uu) => <path key={uu} d={`M${P(uu, .27).join(" ")}L${P(uu, .73).join(" ")}`} {...IS} />)}
      <path d={`M${P(.31, .62).join(" ")}L${P(.44, .4).join(" ")}M${P(.31, .4).join(" ")}L${P(.44, .62).join(" ")}`} fill="none" stroke={lapis} strokeWidth="1.4" strokeLinecap="round" />
      {/* headdress and gold mask */}
      <path d={polyD(P(.03, .72), P(.2, .84), P(.25, .5), P(.2, .16), P(.03, .28), P(.01, .5))} fill={lapis} {...IS} />
      <path d={`M${P(.07, .66).join(" ")}L${P(.19, .76).join(" ")}M${P(.07, .34).join(" ")}L${P(.19, .24).join(" ")}`} fill="none" stroke={gold} strokeWidth="1.1" strokeLinecap="round" />
      <ellipse cx={hx} cy={hy} rx="2.8" ry="3.6" transform={`rotate(14 ${hx} ${hy})`} fill={gold} {...IS} />
      <path d={`M${hx - 1.6} ${hy - 1}h1M${hx + 1.2} ${hy - 1.6}h1`} stroke={carve} strokeWidth="1" strokeLinecap="round" />
      <path d={`M${hx - .4} ${hy + 1.6}h1.6`} stroke={carve} strokeWidth=".8" strokeLinecap="round" />
    </g>
  );
}


/* ---- FOREST: PINE, SNOW_PINE, BOULDER, TENT, STUMP, MOSS ---- */

/** TALL. Pine tree, about 55 units tall: three stacked cones of dark blue-green needles, each with a ragged, toothed skirt,
 *  the east half a shade darker and one lit streak on the west, over a short bare trunk with a flared foot. Narrow and
 *  pointed with a trunk you can see under the skirts, so it never reads as the oak, birch or tree. */
export function Pine() {
  const u = useUid();
  const g = "#2e7757", gD = "#1d5640", gL = "#5aa57d", bark = "#7b5535", barkD = "#563a23";
  // a cone: apex, then the right corner, a zigzag skirt of n teeth (tips on the skirt line yb, notches d above), the left corner
  const cone = (ax, ay, xl, xr, yb, n, d) => {
    const pts = [[ax, ay], [xr, yb - d]];
    for (let i = 0; i <= 2 * n; i++) pts.push([xr - ((xr - xl) * i) / (2 * n), i % 2 ? yb - d : yb]);
    pts.push([xl, yb - d]);
    return pts;
  };
  const T = [
    { t: cone(32, 24, 8.4, 55.6, 51.6, 4, 4.6), yb: 51.6, xl: 8.4 },
    { t: cone(32, 12.6, 13, 51, 37.4, 4, 4.2), yb: 37.4, xl: 13 },
    { t: cone(32, 2.8, 18.6, 45.4, 23.6, 3, 3.8), yb: 23.6, xl: 18.6 },
  ];
  return (
    <g>
      <defs>{T.map(({ t }, i) => <clipPath key={i} id={`${u}c${i}`}><path d={polyD(...t)} /></clipPath>)}</defs>
      <GroundShadow cx={32} cy={57.4} rx={21} ry={3.6} />
      {/* trunk with a flared foot, shaded on the east */}
      <path d="M25.4 58.2C28 57.2 28.4 54.6 28.6 50H35.8C36 54.6 36.6 57.2 39.2 58.2Q34.6 57 32.4 58.4Q29.6 57 25.4 58.2Z" fill={bark} {...OS} />
      <path d="M33.4 50H35.8C36 54.6 36.6 57.2 39.2 58.2Q36.4 57.4 34.4 57.6C33.8 55 33.4 53 33.4 50Z" fill={barkD} />
      {/* cones, bottom first so each tier tucks under the one above */}
      {T.map(({ t, yb, xl }, i) => (
        <g key={i}>
          <path d={polyD(...t)} fill={g} />
          <g clipPath={`url(#${u}c${i})`}>
            <path d={polyD([32, t[0][1]], [64, yb + 1], [34.6, yb + 1])} fill={gD} />
            <path d={polyD([30.6, t[0][1] + 3.4], [xl + 6, yb - 1.4], [xl + 11, yb - 1.4])} fill={gL} />
          </g>
          <path d={polyD(...t)} fill="none" {...OS} />
          <path d={`M${r2(32 - (32 - xl) * .42)} ${r2(yb - 9)}Q${r2(32 - (32 - xl) * .3)} ${r2(yb - 11)} ${r2(32 - (32 - xl) * .18)} ${r2(yb - 8.4)}M${r2(32 + (32 - xl) * .2)} ${r2(yb - 11.4)}Q${r2(32 + (32 - xl) * .34)} ${r2(yb - 13)} ${r2(32 + (32 - xl) * .46)} ${r2(yb - 9.6)}`} {...IS} />
        </g>
      ))}
    </g>
  );
}

/** TALL. Snow pine, about 56 units tall and broad, unlike the pine at a glance: three fat tiers whose skirts hang in
 *  round scallops down to the ground, each loaded with a white snow cap that covers the top of the tier and ends in its
 *  own scalloped edge, the blue-green boughs showing only in a band underneath, the east half a shade darker, a pointed
 *  snowy tip and only a stub of trunk between the lowest scallops. */
export function SnowPine() {
  const u = useUid();
  const g = "#2f6e60", gD = "#1f4d44", sn = "#f6f9fc", snD = "#c3d5e6", bark = "#6e4a2c";
  const T = [
    { ay: 21.4, yb: 55.4, hw: 27.4, n: 5, f: .66 },
    { ay: 10.2, yb: 40.6, hw: 22, n: 4, f: .62 },
    { ay: 2.2, yb: 26.2, hw: 15.6, n: 3, f: .6 },
  ];
  const cone = ({ ay, yb, hw, n }) => {
    const w = (2 * hw) / n;
    let d = `M32 ${ay}L${r2(32 + hw)} ${r2(yb - 3)}`;
    for (let i = 0; i < n; i++) d += `Q${r2(32 + hw - w * (i + .5))} ${r2(yb + 3.6)} ${r2(32 + hw - w * (i + 1))} ${r2(yb - 3)}`;
    return d + "Z";
  };
  const cap = ({ ay, yb, hw, n, f }) => {
    const yc = ay + f * (yb - 3 - ay), hc = hw * f, k = Math.max(2, n - 1), w = (2 * hc) / k;
    let d = `M32 ${ay}L${r2(32 + hc)} ${r2(yc)}`;
    for (let i = 0; i < k; i++) d += `Q${r2(32 + hc - w * (i + .5))} ${r2(yc + 5.4 + (i % 2) * 1.6)} ${r2(32 + hc - w * (i + 1))} ${r2(yc + (i % 2 ? 1.4 : -.4))}`;
    return d + "Z";
  };
  return (
    <g>
      <defs>
        {T.map((t, i) => <clipPath key={`c${i}`} id={`${u}c${i}`}><path d={cone(t)} /></clipPath>)}
        {T.map((t, i) => <clipPath key={`s${i}`} id={`${u}s${i}`}><path d={cap(t)} /></clipPath>)}
      </defs>
      <GroundShadow cx={32} cy={57.2} rx={27} ry={3.6} />
      {/* the stub of trunk between the lowest scallops */}
      <path d="M28.4 52H35.6L36.4 58H27.6Z" fill={bark} {...OS} />
      {T.map((t, i) => (
        <g key={i}>
          <path d={cone(t)} fill={g} />
          <g clipPath={`url(#${u}c${i})`}>
            <path d="M34 0H70V70H34Z" fill={gD} />
            <path d={cap(t)} fill={sn} />
            <g clipPath={`url(#${u}s${i})`}><path d="M35 0H70V70H35Z" fill={snD} /></g>
          </g>
          <path d={cap(t)} {...IS} />
          <path d={cone(t)} fill="none" {...OS} />
        </g>
      ))}
    </g>
  );
}

/** TALL. Boulder bigger than a person, about 50 units tall and 54 wide: a squat, faceted grey rock with a lit west
 *  plane, a mid-grey front, a dark east face, a few cracks and a cap of moss on top. Neutral grey so it sits on sand, grass,
 *  snow and rock alike. */
export function Boulder() {
  const u = useUid();
  const st = "#979ba4", stL = "#bec2c9", stD = "#666a75", moss = "#6f9c47", mossL = "#93bb67";
  const out = polyD([6.4, 56.4], [4.6, 40], [10.6, 27], [20.4, 15.4], [32, 8], [44, 10.6], [52.4, 21], [58.6, 35], [58.4, 49], [52, 57], [30, 58.6]);
  return (
    <g>
      <defs><clipPath id={`${u}k`}><path d={out} /></clipPath></defs>
      <GroundShadow cx={32} cy={57.6} rx={27} ry={4.2} />
      <path d={out} fill={st} />
      <g clipPath={`url(#${u}k)`}>
        {/* lit west planes, then the dark east face */}
        <path d="M0 62L2 38L12 24L22 14L32 6L30 24L24 38L18 62Z" fill={stL} />
        <path d="M44 6L52 21L66 36V62H48L42 44L40 24Z" fill={stD} />
      </g>
      <path d="M32 8L30 24L24 38L18 56.6M30 24L40 24L42 44L48 58M24 38L42 44M10.6 27L20.4 24L30 24" {...IS} />
      <path d="M32 8L44 10.6L48 16C44 18 42 22 40 24L30 24Z" fill={moss} />
      <path d="M20.4 15.4L32 8L36 9.6C32 12.4 28.6 15 28 19C25 17.6 22.6 18 20.4 15.4Z" fill={mossL} />
      <path d={out} fill="none" {...OS} />
      <path d="M44 10.6L48 16C44 18 42 22 40 24M28 19C25 17.6 22.6 18 20.4 15.4" {...IS} />
    </g>
  );
}


/** TALL. Ridge tent, about 52 units tall and so clearly taller than a person: a front gable of orange canvas with a dark
 *  doorway and a flap folded back, the long roof plane receding up and to the east in a shade of the same orange, a ridge
 *  knob, and one low guy rope pegged out from the back corner (no rope from the ridge). */
export function Tent() {
  const can = "#e08a3a", canL = "#f0ab5c", canD = "#b3652a", dark = "#2a2530", flap = "#c4742e";
  const A = [24, 8], B = [38, 4], L = [6, 56.6], R = [42, 56.6], R2 = [56, 52.6]; // front apex, back apex, front feet, back right foot
  return (
    <g>
      <GroundShadow cx={32} cy={57.6} rx={27} ry={3.8} />
      {/* one low guy rope pegged out from the back corner (no rope from the ridge) */}
      <path d="M42 56.6L60.4 58.4" {...IS} />
      <path d="M59.4 56.8L60.8 59.6" stroke="#e4d2a0" strokeWidth="1.8" strokeLinecap="round" />
      {/* the long east roof plane */}
      <path d={polyD(A, B, R2, R)} fill={canD} {...OS} />
      <path d={`M${B[0] - 3.4} ${B[1] + 2}L${R2[0] - 4.6} ${R2[1] - 1.6}`} {...IS} strokeOpacity=".55" />
      {/* the front gable with a lit streak down its west edge */}
      <path d={polyD(A, R, L)} fill={can} {...OS} />
      <path d={polyD([A[0] - 1.4, A[1] + 9], [L[0] + 4.4, L[1] - 1.4], [L[0] + 8.8, L[1] - 1.4], [A[0] + .4, A[1] + 13])} fill={canL} />
      {/* open doorway with the flap pulled back to the west */}
      <path d={polyD([A[0], 26], [34.6, R[1]], [13.4, R[1]])} fill={dark} {...OS} />
      <path d={polyD([A[0], 26], [13.4, R[1]], [20.4, R[1]], [A[0], 34])} fill={flap} {...OS} />
      <path d={`M${A[0]} ${A[1]}V26`} {...IS} />
      <circle cx={A[0]} cy={A[1] - .6} r="1.8" {...IS} fill={canD} />
    </g>
  );
}

/** LOW. Tree stump you stand or sit on, in the LOW-furniture camera, kept low: a squat cylinder about knee height with a
 *  flat sawn top seen from above (growth rings, a centre mark and one crack), rough bark sides shaded on the east, a
 *  flared foot and a tuft of moss on the west. No cast shadow. */
export function Stump() {
  const u = useUid();
  const bark = "#8b5b35", barkD = "#5d3b21", top = "#e0b982", topD = "#c79a5e", ring = "#a97b44", moss = "#6f9c47";
  const cx = 32, rx = 19, ry = 8.4, yt = 37.6, yb = 50;
  const body = `M${cx - rx} ${yt}C${cx - rx} ${yt + 5} ${cx - rx - 1.4} ${yb - 4.6} ${cx - rx - 5.6} ${yb + .6}Q${cx - rx - 2.4} ${yb + 3.4} ${cx - 17} ${yb + 6.2}A${rx + 5} 8.6 0 0 0 ${cx + 17} ${yb + 6.2}Q${cx + rx + 2.4} ${yb + 3.4} ${cx + rx + 5.6} ${yb + .6}C${cx + rx + 1.4} ${yb - 4.6} ${cx + rx} ${yt + 5} ${cx + rx} ${yt}Z`;
  return (
    <g>
      <defs><clipPath id={`${u}b`}><path d={body} /></clipPath></defs>
      <path d={body} fill={bark} />
      <g clipPath={`url(#${u}b)`}>
        <path d={`M45 ${yt}C46 44 47 50 52 ${yb + 6}H70V${yt - 4}H45Z`} fill={barkD} />
      </g>
      <path d={body} fill="none" {...OS} />
      {/* bark furrows */}
      <path d={`M20.4 ${yt + 4}C20 ${yt + 9} 20.4 ${yb - 2} 17.6 ${yb + 3}M27 ${yt + 7}V${yb + 4}M36.6 ${yt + 7.4}V${yb + 4.6}M44.6 ${yt + 4}C44.6 ${yt + 9} 45.6 ${yb - 1} 47.4 ${yb + 3.4}`} {...IS} />
      {/* moss tuft on the west side of the foot */}
      <path d={`M14.4 ${yb - 3}C14 ${yb - 6} 17.6 ${yb - 7.4} 19.4 ${yb - 5.6}C21 ${yb - 6.6} 23.4 ${yb - 4} 22.4 ${yb - 2}Q18.4 ${yb - .6} 14.4 ${yb - 3}Z`} {...IS} fill={moss} />
      {/* the sawn top */}
      <ellipse cx={cx} cy={yt} rx={rx} ry={ry} fill={top} {...OS} />
      <ellipse cx={cx} cy={yt} rx={rx - 4} ry={ry - 2.4} fill="none" stroke={ring} strokeWidth=".9" />
      <ellipse cx={cx + .6} cy={yt + .2} rx={rx - 9} ry={ry - 4.4} fill="none" stroke={ring} strokeWidth=".9" />
      <ellipse cx={cx + 1} cy={yt + .4} rx={rx - 14} ry={ry - 6.2} fill={topD} stroke={ring} strokeWidth=".9" />
      <path d={`M${cx + 6} ${yt + 1.6}L${cx + rx - 2.4} ${yt + 3.2}`} {...IS} />
    </g>
  );
}

/** LOW. Moss patch, a top-down footprint flush with the floor (art/STYLE.md, LOW props): a lobed cushion of green moss in
 *  OS with a darker shaded south-east edge, a lighter lobed crown inside and clusters of seed dots, mostly near the
 *  rim so the middle stays calm for a token. No shadow. */
export function Moss() {
  const u = useUid();
  const moss = "#80ab48", mossD = "#5c8a3a", mossL = "#a3c660";
  const pts = [[8, 33], [10, 25.4], [17, 19.8], [25, 19], [30, 14.6], [38, 15.4], [43, 20.4], [51, 21], [56.4, 28], [56.6, 35.6], [51, 42], [44, 44.2], [39.6, 50], [31, 49], [24, 51.4], [16, 46.4], [10.6, 41]];
  const blob = (q) => { // smooth closed blob: quadratic curves through the midpoints of each edge
    const m = (i) => [(q[i][0] + q[(i + 1) % q.length][0]) / 2, (q[i][1] + q[(i + 1) % q.length][1]) / 2];
    return `M${r2(m(q.length - 1)[0])} ${r2(m(q.length - 1)[1])}` + q.map((p, i) => `Q${p[0]} ${p[1]} ${r2(m(i)[0])} ${r2(m(i)[1])}`).join("") + "Z";
  };
  const patch = blob(pts);
  const crown = blob([[16, 32.6], [18, 26.4], [24.6, 23.6], [31, 20.8], [38, 21.6], [45, 25.4], [49.6, 31], [46, 36.4], [38, 36.6], [30, 38.4], [21.4, 37.4]]);
    return (
    <g>
      <defs><clipPath id={`${u}p`}><path d={patch} /></clipPath></defs>
      <path d={patch} fill={moss} />
      <g clipPath={`url(#${u}p)`}>
        <path d="M60 18C58 34 50 40 40 44C36 46 34 52 30 56L64 60Z" fill={mossD} />
      </g>
      <path d={patch} fill="none" {...OS} />
      <path d={crown} fill={mossL} fillOpacity=".7" />
      {/* sprigs and seed dots, mostly near the rim */}
      {[[14.6, 33, 0], [20.6, 24.8, 1], [47.4, 25.6, 0], [52.4, 33.4, 1], [27, 46.4, 1], [44.4, 39.8, 0], [33, 19, 1], [14.4, 41, 0], [38.6, 46, 1], [50, 38.6, 1]].map(([x, y, k], i) => (
        <g key={i} fill={k ? mossL : mossD}><circle cx={x} cy={y} r="1.5" /><circle cx={x + 2.6} cy={y - 1.2} r="1" /><circle cx={x + 1.2} cy={y + 2} r=".9" /></g>
      ))}
    </g>
  );
}

/* ---- MOUNTAINS: CAIRN, FIREPLACE, ICE ---- */

/** SHORT. Stone cairn at about waist height: four grey stones stacked wide to narrow with a pebble on top, each a rounded
 *  blob seen from slightly above (a lit flat top, a darker rim round the lower and east side), a crack here and there,
 *  a flat blob of shadow underneath. Sight passes over it; nobody stands on it. */
export function Cairn() {
  const u = useUid();
  const S = [ // cx, bottom y, w, h, base, shade, lit
    [31, 57, 46, 13.4, "#a39e96", "#78736a", "#cbc6be"],
    [33.2, 46.6, 33, 11.4, "#9aa0a8", "#6f757d", "#c3c8ce"],
    [30.6, 37.2, 23, 9.8, "#aaa59d", "#7d786f", "#d0cbc3"],
    [32.8, 28.8, 14, 7.6, "#9aa0a8", "#6f757d", "#c3c8ce"],
  ];
  const body = (cx, yb, w, h) => {
    const x0 = cx - w / 2, x1 = cx + w / 2, yt = yb - h, ym = yt + h * .5;
    return `M${r2(x0)} ${r2(ym)}C${r2(x0)} ${r2(yt + h * .1)} ${r2(cx - w * .28)} ${r2(yt)} ${cx} ${r2(yt)}C${r2(cx + w * .28)} ${r2(yt)} ${r2(x1)} ${r2(yt + h * .1)} ${r2(x1)} ${r2(ym)}`
      + `C${r2(x1)} ${r2(yb - h * .08)} ${r2(cx + w * .3)} ${r2(yb)} ${cx} ${r2(yb)}C${r2(cx - w * .3)} ${r2(yb)} ${r2(x0)} ${r2(yb - h * .08)} ${r2(x0)} ${r2(ym)}Z`;
  };
  return (
    <g>
      <defs>{S.map(([cx, yb, w, h], i) => <clipPath key={i} id={`${u}c${i}`}><path d={body(cx, yb, w, h)} /></clipPath>)}</defs>
      <GroundShadow cx={32} cy={57} rx={27} ry={3.8} />
      {S.map(([cx, yb, w, h, base, shade, lit], i) => {
        const yt = yb - h;
        return (
          <g key={i}>
            <path d={body(cx, yb, w, h)} fill={shade} />
            <g clipPath={`url(#${u}c${i})`}>
              <ellipse cx={r2(cx - w * .08)} cy={r2(yt + h * .42)} rx={r2(w * .52)} ry={r2(h * .5)} fill={base} />
              <ellipse cx={r2(cx - w * .04)} cy={r2(yt + h * .3)} rx={r2(w * .34)} ry={r2(h * .2)} fill={lit} />
            </g>
            <path d={body(cx, yb, w, h)} fill="none" {...OS} />
            {i === 0 ? <path d={`M${r2(cx + w * .14)} ${r2(yb - h * .52)}L${r2(cx + w * .22)} ${r2(yb - h * .3)}L${r2(cx + w * .18)} ${r2(yb - h * .12)}`} {...IS} /> : null}
            {i === 1 ? <path d={`M${r2(cx - w * .3)} ${r2(yb - h * .38)}L${r2(cx - w * .18)} ${r2(yb - h * .2)}`} {...IS} /> : null}
          </g>
        );
      })}
      {/* the pebble on top */}
      <path d="M28.2 22.4C28.4 19.8 31.4 18.6 34.4 19C37.2 19.6 38.2 21.6 37.6 23.2C36.4 24.4 31.6 24.8 28.2 22.4Z" fill="#b6b1a9" {...OS} />
      <path d="M29.4 21.2Q31.6 19.8 34 20.4" {...IS} stroke="#e4e0d8" />
    </g>
  );
}

/** TALL. Stone fireplace taller than a person, about 55 units: a coursed stone surround with a low arched firebox (dark
 *  inside, two logs, a flame and a glow on the hearth), a wooden mantel with a candle at each end, and above it the
 *  narrower chimney breast of the same stone rising to a stepped cornice at the ceiling. A stone hearth step sticks out
 *  at the foot. Front, top and shaded east faces, like the other tall pieces. */
export function Fireplace() {
  const st = "#a79e8f", stL = "#c8bfae", stD = "#7a7163", wood = "#8a5530", woodL = "#b07a48", woodD = "#5a3920";
  const fire = "#ef7f2a", fireL = "#ffd24a", wax = "#f0e6c6";
  const dx = 5, dy = 5;
  const joint = { ...IS, strokeOpacity: .5 };
  return (
    <g>
      <GroundShadow cx={31} cy={58} rx={27} ry={3.2} />
      {/* hearth step */}
      <path d={slabSide(4, 54, 50, 4.4, dx, dy)} fill={stD} {...OS} />
      <path d={slabTop(4, 54, 50, dx, dy)} fill={stL} {...OS} />
      <path d={inkBox(4, 54, 50, 4.4, 1, .2)} fill={st} {...OS} />
      {/* surround: east side, front with its courses */}
      <path d={slabSide(9, 31, 42, 19, dx, dy)} fill={stD} {...OS} />
      <path d={inkBox(9, 31, 42, 19, 1.2, .3)} fill={st} {...OS} />
      <path d="M9 36.4H51M9 41.8H16M44 41.8H51M9 47H16M44 47H51M26 31V36.4M38 31V36.4M20 36.4V41.8M32 36.4V41.8M47 36.4V41.8M13 41.8V47M48 41.8V47" {...joint} />
      <path d="M53.6 31.8V49M52 36.4L56 32.6M52 42L56 38.2" {...joint} stroke="#4f473d" />
      {/* firebox: arch, dark inside, glow, two logs, flame */}
      <path d="M16 50V41.4Q16 35.4 30 35.4Q44 35.4 44 41.4V50Z" fill="#1d1511" {...OS} />
      <ellipse cx="30" cy="49.2" rx="12" ry="2.6" fill={fire} fillOpacity=".5" />
      <path d="M19.6 48.6L38.6 45.8M21.4 45.6L40.6 48.8" stroke={INK} strokeWidth="5.4" strokeLinecap="round" />
      <path d="M19.6 48.6L38.6 45.8M21.4 45.6L40.6 48.8" stroke="#6b4a2b" strokeWidth="3" strokeLinecap="round" />
      <path d="M30 47C25.4 43.6 27.8 40.6 29 37.6C30.4 40 33 41.4 30 47Z" {...IS} fill={fire} stroke={INK} />
      <path d="M30.4 47C28.4 45 30 43.4 30.6 41.4C32 43.6 32.6 45.6 30.4 47Z" fill={fireL} />
      <ellipse cx="30" cy="52.2" rx="14" ry="1.7" fill={fire} fillOpacity=".34" />
      {/* mantel */}
      <path d={slabSide(6, 26, 48, 5, dx, dy)} fill={woodD} {...OS} />
      <path d={slabTop(6, 26, 48, dx, dy)} fill={woodL} {...OS} />
      <path d={inkBox(6, 26, 48, 5, 1, .2)} fill={wood} {...OS} />
      <path d="M10 28.8H25M32 28.8H49" {...IS} stroke={woodD} />
      {/* candles on the mantel ends */}
      {[[10.4, 24.4], [51.2, 22]].map(([x, y]) => (
        <g key={x}>
          <path d={inkBox(x - 1.5, y - 6.2, 3, 6.2, .8, .1)} fill={wax} {...OS} strokeWidth="1.1" />
          <path d={`M${x} ${y - 11.4}C${x + 1.8} ${y - 9.4} ${x + 1.2} ${y - 7.6} ${x} ${y - 7.2}C${x - 1.2} ${y - 7.6} ${x - 1.8} ${y - 9.4} ${x} ${y - 11.4}Z`} fill={fireL} stroke={INK} strokeWidth=".8" />
        </g>
      ))}
      {/* chimney breast */}
      <path d={slabSide(16, 9, 28, 15, 4, 4)} fill={stD} {...OS} />
      <path d={inkBox(16, 9, 28, 15, 1, .2)} fill={st} {...OS} />
      <path d="M16 14H44M16 19H44M24 9V14M36 9V14M20 14V19M30 14V19M40 14V19M25 19V24M36 19V24" {...joint} />
      {/* cornice at the ceiling: a stepped band wider than the breast */}
      <path d={slabSide(13, 4.4, 34, 4.6, 4, 3)} fill={stD} {...OS} />
      <path d={slabTop(13, 4.4, 34, 4, 3)} fill={stL} {...OS} />
      <path d={inkBox(13, 4.4, 34, 4.6, 1, .2)} fill={stL} {...OS} />
      <path d="M13 7.2H47" {...joint} />
    </g>
  );
}


/** LOW. Sheet of ice on the ground, a flat top-down footprint filling most of the tile: an angular, slightly jagged
 *  outline, a pale blue sheet with a lighter glaze inside it, a darker rim along the south-east edge, a branching crack
 *  with a lit edge, trapped air bubbles and three glints. You stand on it; no shadow. */
export function Ice() {
  const ice = "#aed8ec", iceL = "#e1f2f9", iceD = "#82b8d4", crack = "#4f86a6";
  const pts = [[5, 33], [8, 24], [14, 16], [20, 12.4], [29, 8.6], [38, 9.6], [46, 12.6], [54, 18], [59, 27], [58.4, 37], [54, 45.6], [47, 51.4], [38, 56], [29, 54.6], [21, 57.2], [13, 52], [7.6, 43.4]];
  const inner = pts.map(([x, y]) => [r2(32 + (x - 32) * .8 - 1.8), r2(33.4 + (y - 33.4) * .8 - 1.8)]);
  const spark = (cx, cy, s) => `M${cx} ${cy - s}L${r2(cx + s * .3)} ${r2(cy - s * .3)}L${cx + s} ${cy}L${r2(cx + s * .3)} ${r2(cy + s * .3)}L${cx} ${cy + s}L${r2(cx - s * .3)} ${r2(cy + s * .3)}L${cx - s} ${cy}L${r2(cx - s * .3)} ${r2(cy - s * .3)}Z`;
  const cr = "M31 10L28.6 21.4L34.4 28L30.6 37L36.4 42.4L33.8 56M28.6 21.4L17.6 23.6L9 30M34.4 28L46 26L55 31M36.4 42.4L47.6 45.4";
  return (
    <g>
      <path d={polyD(...pts)} fill={ice} {...OS} />
      <path d={polyD([5, 33], [7.6, 43.4], [13, 52], [21, 57.2], [29, 54.6], [38, 56], [47, 51.4], [54, 45.6], [58.4, 37], [59, 27], [56.2, 36], [51.4, 44.6], [43, 50.6], [36, 52.6], [29, 51.4], [21, 54], [14.4, 49.6], [9.4, 41.6])} fill={iceD} />
      <path d={polyD(...inner)} fill={iceL} />
      <path d={polyD(...pts)} fill="none" {...OS} />
      <path d={cr} {...IS} stroke={crack} strokeWidth="1" />
      <path d="M32.4 10.8L30 21.6L35.8 28.2L32 37.2" fill="none" stroke="#fff" strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round" transform="translate(1.6 0)" />
      {[[19, 33.4, 1.5], [44, 38, 1.2], [24, 46, 1], [46, 20.4, 1.1]].map(([x, y, r]) => <circle key={x} cx={x} cy={y} r={r} {...IS} fill="#f6fcfe" strokeWidth=".7" />)}
      {[[17.4, 20, 3], [47, 44.6, 2.4], [40.4, 16.4, 2]].map(([x, y, s]) => <path key={x} d={spark(x, y, s)} fill="#fff" />)}
    </g>
  );
}

/* ---- DESERT: OBELISK, AMPHORA, OASIS_POOL (OasisPoolSpan), WOVEN_MAT ---- */


/** TALL. Sandstone obelisk, about 55 units tall, standing on the floor: a two-step plinth whose lower block sits flat on
 *  the ground (front face down to y 58, its top and shaded east face showing, a flat GroundShadow round its foot and a
 *  little drifted sand against it), a square shaft narrowing to the top (lit front, shaded east face) carrying a
 *  cartouche and a few carved glyph rows, and a pointed pyramidion with a gilded tip. */
export function Obelisk() {
  const s = "#d4ab6c", sL = "#ecd199", sD = "#a67e44", gold = "#dca02a", goldD = "#a8731a", carve = "#7a5428", drift = "#ecd199";
  return (
    <g>
      <GroundShadow cx={33} cy={57.8} rx={27} ry={3.6} />
      {/* lower plinth, flat on the floor: east face, top, front */}
      <path d={slabSide(9, 51.6, 37, 6.4, 5, 5)} fill={sD} {...OS} />
      <path d={slabTop(9, 51.6, 37, 5, 5)} fill={sL} {...OS} />
      <path d={inkBox(9, 51.6, 37, 6.4, .8, .2)} fill={s} {...OS} />
      {/* upper plinth, set back on the lower one's top */}
      <path d={slabSide(15.4, 45.6, 25, 4.8, 4, 4)} fill={sD} {...OS} />
      <path d={slabTop(15.4, 45.6, 25, 4, 4)} fill={sL} {...OS} />
      <path d={inkBox(15.4, 45.6, 25, 4.8, .8, .2)} fill={s} {...OS} />
      {/* shaft standing on the upper plinth */}
      <path d="M37.6 44L40.6 41L37.2 12L35 14Z" fill={sD} {...OS} />
      <path d="M21.4 44L24.6 14H35L37.6 44Z" fill={s} {...OS} />
      <path d="M23 42.6L25.6 15.4" stroke={sL} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      {/* pyramidion: front and east faces, gilded tip */}
      <path d="M35 14L37.2 12L30.2 3Z" fill={sD} {...OS} />
      <path d="M24.6 14H35L30.2 3Z" fill={sL} {...OS} />
      <path d="M28.1 6.6H32L30.2 3Z" fill={gold} />
      <path d="M32 6.6L32.6 6L30.2 3Z" fill={goldD} />
      <path d="M24.6 14H35L30.2 3Z" fill="none" {...OS} />
      {/* carved glyphs: a cartouche, then rows */}
      <path d={inkBox(27.2, 17.2, 5, 10, 2.4, .2)} {...IS} stroke={carve} />
      <path d="M28.6 20.4h2.2M28.6 22.6h2.2M28.6 24.8h2.2" {...IS} stroke={carve} />
      <path d="M25.6 31.6h8.6M26.2 35.6q1.7 -2.2 3.4 0t3.4 0" {...IS} stroke={carve} />
      <circle cx="29.7" cy="39.6" r="1.6" {...IS} stroke={carve} />
      <path d="M29.7 36.6v.8M29.7 41.8v.8M26.8 39.6h.8M31.8 39.6h.8" {...IS} stroke={carve} />
      {/* sand drifted against the foot */}
      <path d="M4.6 58.2C5.6 55.4 9 54.6 11.6 55.8C13.6 55 16.4 55.8 17.2 58.2Z" fill={drift} {...OS} strokeWidth="1.1" />
      <path d="M41.4 58.2C42.4 56 45 55.4 47 56.2C48.8 55.2 51.6 55.6 52.8 57.6L51.4 58.2Z" fill={drift} {...OS} strokeWidth="1.1" />
    </g>
  );
}

/** SHORT. Clay amphora at about waist height, 40 units: a plump terracotta jar with a flared lip (its dark mouth showing
 *  from above), a narrow neck, two loop handles from neck to shoulder, a short foot ring, and painted bands of dark brown
 *  and cream with a zigzag round the belly. The east side is a shade darker. Sight passes over it. */
export function Amphora() {
  const u = useUid();
  const c = "#c8723f", cD = "#94482a", cL = "#e79a68", paint = "#4b2616", cream = "#ead2a2";
  const body = "M27.4 18.5C27.4 22 27 24.4 24.6 26.4C20.4 29.6 19 33.4 19.4 38C19.8 44 24.4 49.4 27.6 53H36.4C39.6 49.4 44.2 44 44.6 38C45 33.4 43.6 29.6 39.4 26.4C37 24.4 36.6 22 36.6 18.5Z";
  const hl = "M28 21.4C21 20.2 19 25 22.8 29.6", hr = "M36 21.4C43 20.2 45 25 41.2 29.6";
  const zig = Array.from({ length: 12 }, (_, i) => `${i ? "l" : "M19 39.6l"}1.1 -2.2l1.1 2.2`).join("");
  return (
    <g>
      <defs><clipPath id={`${u}b`}><path d={body} /></clipPath></defs>
      <GroundShadow cx={32} cy={57.2} rx={17} ry={3.2} />
      {/* handles, behind the body */}
      {[hl, hr].map((d) => <g key={d}><path d={d} stroke={INK} strokeWidth="5.4" strokeLinecap="round" fill="none" /><path d={d} stroke={c} strokeWidth="2.4" strokeLinecap="round" fill="none" /></g>)}
      {/* foot ring and body */}
      <path d={inkBox(26.4, 52.6, 11.2, 4, 1.4, .2)} fill={cD} {...OS} />
      <path d={body} fill={c} />
      <g clipPath={`url(#${u}b)`}>
        <path d="M37.4 14C37.4 24 42.6 28 44 34L50 60H33Z" fill={cD} />
        <path d="M18 31.6Q32 35.6 46 31.6V33.6Q32 37.6 18 33.6Z" fill={cream} />
        <path d="M18 31.6Q32 35.6 46 31.6M18 33.6Q32 37.6 46 33.6" stroke={paint} strokeWidth="1.1" fill="none" />
        <path d="M18 27.2Q32 30.4 46 27.2" stroke={paint} strokeWidth="1.1" fill="none" />
        <path d={zig} stroke={paint} strokeWidth=".9" strokeLinejoin="round" fill="none" transform="translate(0 2.4)" />
        <path d="M18 46.4Q32 49.4 46 46.4" stroke={paint} strokeWidth="1.1" fill="none" />
        <path d="M23.2 38C22.8 42.4 24.6 45.4 26.6 48" stroke={cL} strokeWidth="1.8" strokeLinecap="round" fill="none" />
      </g>
      <path d={body} fill="none" {...OS} />
      {/* flared lip with the dark mouth */}
      <ellipse cx="32" cy="18.2" rx="6.6" ry="2.5" fill={cL} {...OS} />
      <ellipse cx="32" cy="18.2" rx="4.4" ry="1.4" fill="#2b150b" />
    </g>
  );
}

/** LOW. Oasis pool seen from above, drawn once across its span (1x1, 1x2, 2x1 or 2x2 tiles): an irregular, softly
 *  rounded pool of turquoise water inside a ring of rounded sandstone rim stones (the east and south ones a shade darker),
 *  the water deepening toward the south-east shore with a lit patch at the north-west, two ripple rings, glints and a
 *  couple of lily pads near the edge. The middle stays calm for a wading token. Flush with the floor: no shadow. */
export function OasisPoolSpan({ cw = 1, ch = 1 }) {
  const u = useUid();
  const W = 64 * cw, H = 64 * ch, cx = W / 2, cy = H / 2;
  const ax = W / 2 - 4, ay = H / 2 - 4, wx = ax - 6.6, wy = ay - 6.6;
  const wob = (a) => 1 + .045 * Math.sin(2 * a + .8) + .03 * Math.sin(3 * a + 2.1) + .02 * Math.sin(5 * a + 1);
  const at = (a, rx, ry, ox = 0, oy = 0) => [cx + ox + rx * wob(a) * Math.cos(a), cy + oy + ry * wob(a) * Math.sin(a)];
  const ring = (rx, ry, ox = 0, oy = 0, n = 72) => Array.from({ length: n }, (_, i) => at((i / n) * Math.PI * 2, rx, ry, ox, oy));
  const rim = ring(ax, ay), water = ring(wx, wy), glaze = ring(wx - 3.2, wy - 3.2, -1.8, -1.8), lit = ring((wx - 2) * .56, (wy - 2) * .34, -wx * .2, -wy * .38, 40);
  // rim stones at an even spacing along the middle of the rim band
  const mid = ring(ax - 3.3, ay - 3.3, 0, 0, 480);
  const cum = [0];
  for (let i = 1; i <= mid.length; i++) { const p = mid[i - 1], q = mid[i % mid.length]; cum.push(cum[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1])); }
  const total = cum[mid.length], N = Math.round(total / 6.4);
  const stones = Array.from({ length: N }, (_, i) => {
    const t = ((i + .5) / N) * total;
    let k = cum.findIndex((c) => c >= t); if (k < 1) k = 1;
    const p = mid[(k - 1) % mid.length], q = mid[k % mid.length], dx = q[0] - p[0], dy = q[1] - p[1];
    return { x: p[0], y: p[1], ang: (Math.atan2(dy, dx) * 180) / Math.PI, i, shade: (p[0] - cx) / ax + (p[1] - cy) / ay > .5 };
  });
  const pad = (x, y, rot, flower) => (
    <g key={`${r2(x)}${r2(y)}`} transform={`translate(${r2(x)} ${r2(y)}) rotate(${rot})`}>
      <ellipse rx="3.6" ry="2.7" {...IS} fill="#4fa862" strokeWidth=".8" />
      <path d="M0 0L3.5 -.8" {...IS} strokeWidth=".7" />
      {flower ? <circle cx="-.8" cy="-.2" r="1.1" fill="#f0a0b8" /> : null}
    </g>
  );
  const rip = (x, y, rx, ry) => <ellipse key={`${r2(x)}${r2(y)}${rx}`} cx={r2(x)} cy={r2(y)} rx={rx} ry={ry} fill="none" stroke="#eafffb" strokeOpacity=".7" strokeWidth=".9" />;
  const spark = (x, y, s) => <path key={`${x}${y}`} d={`M${x} ${y - s}L${r2(x + s * .3)} ${r2(y - s * .3)}L${x + s} ${y}L${r2(x + s * .3)} ${r2(y + s * .3)}L${x} ${y + s}L${r2(x - s * .3)} ${r2(y + s * .3)}L${x - s} ${y}L${r2(x - s * .3)} ${r2(y - s * .3)}Z`} fill="#fff" />;
  return (
    <g>
      <defs><clipPath id={`${u}w`}><path d={polyD(...water)} /></clipPath></defs>
      <path d={polyD(...rim)} fill="#a88f5e" {...OS} />
      {stones.map((s) => (
        <ellipse key={s.i} cx={r2(s.x)} cy={r2(s.y)} rx={3.1 + ((s.i * 7) % 3) * .4} ry={2.3 + ((s.i * 5) % 3) * .25} transform={`rotate(${r2(s.ang)} ${r2(s.x)} ${r2(s.y)})`}
          {...IS} fill={s.shade ? "#bfa874" : s.i % 2 ? "#e2cfa2" : "#d6c18f"} strokeWidth=".7" />
      ))}
      <path d={polyD(...water)} fill="#2a9bb0" />
      <g clipPath={`url(#${u}w)`}>
        <path d={polyD(...glaze)} fill="#4fc6c8" />
        <path d={polyD(...lit)} fill="#9be6dc" />
      </g>
      <path d={polyD(...water)} {...IS} fill="none" />
      {rip(cx + wx * .34, cy + wy * .46, 7.4, 3)}{rip(cx + wx * .34, cy + wy * .46, 3.6, 1.5)}
      {rip(cx - wx * .52, cy + wy * .18, 4.6, 1.9)}
      {spark(r2(cx - wx * .46), r2(cy - wy * .26), 2.4)}{spark(r2(cx + wx * .12), r2(cy - wy * .56), 2)}
      {pad(cx - wx * .62, cy - wy * .5, -20, true)}{pad(cx + wx * .56, cy + wy * .62, 25, false)}
      {cw * ch > 2 ? pad(cx + wx * .62, cy - wy * .34, 60, false) : null}
    </g>
  );
}
export const OasisPool = () => <OasisPoolSpan cw={1} ch={1} />;

/** LOW. Woven desert kilim laid flat, top-down: a rectangle with an indigo border, a cream band with a small ochre
 *  zigzag, and a red field carrying three diamonds (ochre, cream, ochre, each with a small contrasting core), short
 *  fringe at both ends, laid very slightly askew. Someone sits on it: the middle stays calm. Flush: no shadow. */
export function WovenMat() {
  const ind = "#2c4577", cream = "#efe0bd", red = "#a9472b", och = "#dca43c", fr = "#9a8a62";
  const dia = (x, k) => `M${x} ${-9 * k}L${x + 5.8 * k} 0L${x} ${9 * k}L${x - 5.8 * k} 0Z`;
  const zig = (y, s) => Array.from({ length: 9 }, (_, i) => `${i ? "l" : `M-19 ${y}l`}2.2 ${s * 1.8}l2.2 ${-s * 1.8}`).join("");
  return (
    <g transform="translate(32 32) rotate(-2.5)">
      <path d={Array.from({ length: 9 }, (_, i) => `M-23 ${-15.2 + i * 3.8}h-3.8M23 ${-15.2 + i * 3.8}h3.8`).join("")} stroke={fr} strokeWidth="1.1" strokeLinecap="round" fill="none" />
      <rect x="-23" y="-18" width="46" height="36" rx="1.4" fill={ind} />
      <rect x="-20" y="-15" width="40" height="30" fill={cream} />
      <path d={zig(-13.4, 1)} {...IS} stroke={och} />
      <path d={zig(13.4, -1)} {...IS} stroke={och} />
      <rect x="-17.4" y="-11.4" width="34.8" height="22.8" fill={red} />
      <path d={dia(-11.6, 1)} fill={och} /><path d={dia(0, 1)} fill={cream} /><path d={dia(11.6, 1)} fill={och} />
      <path d={dia(-11.6, .46)} fill={ind} /><path d={dia(0, .46)} fill={red} /><path d={dia(11.6, .46)} fill={ind} />
      <circle cx="0" cy="0" r="1" fill={och} />
      <path d="M-17.4 -11.4H17.4V11.4H-17.4Z" {...IS} />
      <path d="M-20 -15H20V15H-20Z" {...IS} strokeOpacity=".5" />
      <rect x="-23" y="-18" width="46" height="36" rx="1.4" fill="none" {...OS} />
    </g>
  );
}

/* ---- STREET: DUMPSTER, PHONE_BOOTH, FOUNTAIN, MANHOLE, GRATE; then the mixed redraws BARREL, TREE, SHRUB, PALM, CACTUS, HYDRANT, SLED, BOAT (BoatSpan) ---- */

/** TALL. Big alley dumpster, clearly taller than a person (1.8 m): a green steel bin with its top and east side showing,
 *  pressed ribs, a mid band, a cream stencil plate and a hazard strip, two black casters, under a hinged grey lid that
 *  stands a little open at the back on a dark gap with a bin bag poking out. */
export function Dumpster() {
  const g = "#3f7a55", gD = "#2b5539", lid = "#4a505a", lidL = "#6b727d", lidD = "#30353d", gap = "#14161a", bag = "#7d8594", cream = "#efe6cf", hazard = "#e0a82e";
  const x = 11, y = 17, w = 36, h = 35, d = 6; // body front 11..47 × 17..52, side to x 53
  return (
    <g>
      <GroundShadow cx={33} cy={57} rx={23} ry={3.4} />
      {[17, 41].map((cx) => <circle key={cx} cx={cx} cy="54" r="3" fill="#25272d" {...OS} />)}
      <path d={slabSide(x, y, w, h, d, d)} fill={gD} {...OS} />
      <path d={inkBox(x, y, w, h, 1.2, .4)} fill={g} {...OS} />
      {/* pressed ribs and the steel band */}
      <path d="M19.6 20.4V48.6M28.8 20.4V48.6M38 20.4V48.6" {...IS} />
      <path d={inkBox(x, 27, w, 3, .4, 0)} {...IS} fill={gD} />
      {/* stencil plate and hazard strip */}
      <path d={inkBox(14, 33, 12, 7.4, .8, 0)} {...IS} fill={cream} />
      <path d="M16.4 36.7H23.6" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
      <path d={inkBox(32, 45.6, 14, 3.2, .6, 0)} {...IS} fill={hazard} />
      <path d="M35.4 45.7L33.6 48.7M39 45.7L37.2 48.7M42.6 45.7L40.8 48.7" stroke={INK} strokeWidth="1.1" />
      {/* lid: east edge, front lip, then the top plane with its open gap */}
      <path d={slabSide(9, 12, 40, 5, d, d)} fill={lidD} {...OS} />
      <path d={slabTop(9, 12, 40, d, d)} fill={lidL} {...OS} />
      <path d={polyD([12.4, 11], [14.4, 8.4], [30.4, 8.4], [28.4, 11])} fill={gap} />
      <path d="M17.4 8.6C18 5.4 21 4.2 23.2 6.2C25.4 4.6 27.4 6.4 27 8.6Z" {...IS} fill={bag} />
      <path d="M30.4 12L36.4 6H52.6" {...IS} />
      <path d={inkBox(9, 12, 40, 5, 1, .3)} fill={lid} {...OS} />
      <path d={inkBox(23, 13.6, 12, 2, .8, 0)} fill={lidD} />
    </g>
  );
}

/** TALL. Red telephone kiosk, 2.2 m, clearly taller than a person: a slim box with its roof and east side showing,
 *  a cream sign strip in the roof lintel, a door of ten glass panes in red glazing bars with a brass handle, the
 *  coin phone dark behind the glass, a narrow glazed side and a dark plinth. */
export function PhoneBooth() {
  const red = "#c2382f", redL = "#e2574c", redD = "#8d2720", glass = "#9edaeb", glassD = "#6fa4c4", brass = "#d9a441", cream = "#efe6cf";
  const x = 17, w = 28, d = 5;
  const rows = [16, 23.2, 30.4, 37.6, 44.8]; // pane tops, 6.2 tall with a 1 gap
  return (
    <g>
      <GroundShadow cx={33} cy={57} rx={19} ry={3.2} />
      <path d={slabSide(16, 52, 30, 4.4, d, d)} fill={redD} {...OS} />
      <path d={inkBox(16, 52, 30, 4.4, .8, .2)} fill="#5a1a15" {...OS} />
      <path d={slabSide(x, 13, w, 39, d, d)} fill={redD} {...OS} />
      <path d={polyD([46, 18], [49, 15], [49, 45], [46, 48])} {...IS} fill={glassD} />
      <path d={inkBox(x, 13, w, 39, 1, .3)} fill={red} {...OS} />
      {/* door glass, the phone behind it, then the glazing bars */}
      <rect x="20" y="16" width="22" height="34" {...IS} fill={glass} />
      <path d={inkBox(22, 31.4, 6.4, 8.6, .8, 0)} fill="#3a3f4b" />
      <path d="M22.6 29.6H27.8" stroke="#3a3f4b" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="25.2" cy="35" r="1.3" fill={brass} />
      <path d="M21 17.4L25 17.4L21 22Z" fill="#fff" fillOpacity=".7" />
      {rows.slice(1).map((ry) => <rect key={ry} x="20" y={ry - 1} width="22" height="1.2" fill={red} />)}
      <rect x="30.4" y="16" width="1.4" height="34" fill={red} />
      <rect x="20" y="16" width="22" height="34" {...IS} />
      <path d={inkBox(42.8, 29.4, 1.6, 6.4, .7, 0)} {...IS} fill={brass} />
      {/* roof: lintel with the sign strip, then the top plane with its crown */}
      <path d={slabSide(15, 8, 32, 5, d, d)} fill={redD} {...OS} />
      <path d={slabTop(15, 8, 32, d, d)} fill={redL} {...OS} />
      <path d="M24 5.2Q35 2.4 47 5.2" {...IS} />
      <path d={inkBox(15, 8, 32, 5, 1, .3)} fill={red} {...OS} />
      <path d={inkBox(17.4, 9.2, 27.2, 2.6, .5, 0)} {...IS} fill={cream} />
      <path d="M21 10.5H41" stroke={red} strokeWidth="1.1" strokeDasharray="2.4 1.6" />
    </g>
  );
}


/** TALL. Tiered stone plaza fountain, clearly taller than a person: a wide round basin of pale stone with its water
 *  showing, a stem into a mid bowl, a second stem into a small top bowl and a water jet over the top, with curtains of
 *  water falling from each bowl. The east side of every stone part is a shade darker. */
export function Fountain() {
  const u = useUid(), cx0 = 32;
  const st = "#c4c0b6", stD = "#8f8b82", stM = "#a9a59b", water = "#5aa8cc", waterL = "#bfe6f5";
  const wall = "M5 44.6V48.6A27 8.4 0 0 0 59 48.6V44.6Z";
  const mid = "M16.5 27C16.5 33.4 24 36.4 28.2 37.2H35.8C40 36.4 47.5 33.4 47.5 27Z";
  const top = "M23.6 14.4C23.6 18.6 29 20.8 30 21.4H34C35 20.8 40.4 18.6 40.4 14.4Z";
  const stem2 = "M28.2 36V45.8H35.8V36Z", stem3 = "M30 20.6V28H34V20.6Z";
  const shade = (id, d, yTop) => (
    <g>
      <clipPath id={`${u}${id}`}><path d={d} /></clipPath>
      <g clipPath={`url(#${u}${id})`}><path d={`M36 ${yTop}H60V60H36Z`} fill="#000" fillOpacity=".2" /></g>
    </g>
  );
  const jet = (d) => (
    <g key={d} fill="none" strokeLinecap="round">
      <path d={d} stroke={INK} strokeWidth="2.4" /><path d={d} stroke={waterL} strokeWidth="1.1" />
    </g>
  );
  const drip = (x, y0, y1) => <path key={`${x}${y0}`} d={inkBox(x - .9, y0, 1.8, y1 - y0, .8, 0)} {...IS} fill={waterL} />;
  return (
    <g>
      <GroundShadow cx={33} cy={57.2} rx={28} ry={3.2} />
      {/* basin */}
      <path d={wall} fill={stM} {...OS} />
      {shade("w", wall, 40)}
      <path d="M13 49.6V53.4M24 52.6V56.6M40 52.6V56.6M51 49.6V53.4" {...IS} />
      <ellipse cx={cx0} cy="44.6" rx="27" ry="8.4" fill={st} {...OS} />
      <ellipse cx={cx0} cy="44.2" rx="22.8" ry="6.6" {...IS} fill={stD} />
      <ellipse cx={cx0} cy="45.2" rx="22.2" ry="6" fill={water} />
      <path d="M12 46.4Q15 48.2 19 48.4M45.6 41.8Q49 42.4 51 44" stroke={waterL} strokeWidth="1" strokeLinecap="round" fill="none" />
      {/* stem into the mid bowl */}
      <path d={stem2} fill={stM} {...OS} />
      {shade("a", stem2, 30)}
      <ellipse cx={cx0} cy="45.6" rx="5.6" ry="1.6" fill={st} {...OS} />
      <path d={mid} fill={stM} {...OS} />
      {shade("m", mid, 24)}
      <ellipse cx={cx0} cy="27" rx="15.5" ry="4.6" fill={st} {...OS} />
      <ellipse cx={cx0} cy="27.4" rx="12.6" ry="3.4" {...IS} fill={water} />
      {/* second stem and the top bowl */}
      <path d={stem3} fill={stM} {...OS} />
      {shade("b", stem3, 18)}
      <path d={top} fill={stM} {...OS} />
      {shade("t", top, 10)}
      <ellipse cx={cx0} cy="14.4" rx="8.4" ry="2.7" fill={st} {...OS} />
      <ellipse cx={cx0} cy="14.6" rx="6.2" ry="1.7" {...IS} fill={water} />
      {/* jet and falling water */}
      <path d="M32 14.6C30.4 10.4 30.8 6.4 32 2.8C33.2 6.4 33.6 10.4 32 14.6Z" {...IS} fill={waterL} />
      {jet("M32 6Q27.4 4.8 25.4 12.4")}
      {jet("M32 6Q36.6 4.8 38.6 12.4")}
      {drip(18.2, 28.4, 35.4)}{drip(45.8, 28.4, 35.4)}
      {drip(24.8, 15.8, 20.6)}{drip(39.2, 15.8, 20.6)}
    </g>
  );
}

/** LOW. Manhole cover, flat top-down: a heavy round iron frame with a darker lower-right edge, a cover set in it with
 *  a waffle of raised diamonds, a ring and a centre plate, and two lifting slots either side of the middle. Flush
 *  with the road. No shadow. */
export const Manhole = () => {
  const u = useUid();
  const frame = "#6a707c", frameD = "#3f434d", cover = "#505662", grid = "#3b3f49", gapC = "#22252c", light = "#98a0ae", plate = "#6e7482";
  const grd = [];
  for (let i = -5; i <= 5; i++) {
    grd.push(<path key={`a${i}`} d={`M${32 + i * 5.4 - 22} 54L${32 + i * 5.4 + 22} 10`} />);
    grd.push(<path key={`b${i}`} d={`M${32 + i * 5.4 - 22} 10L${32 + i * 5.4 + 22} 54`} />);
  }
  return (
    <g>
      <defs><clipPath id={`${u}m`}><circle cx="32" cy="32" r="19.4" /></clipPath></defs>
      <circle cx="32" cy="32" r="26" fill={frame} {...OS} />
      <path d="M55.4 27.9A23.8 23.8 0 0 1 27.9 55.4" fill="none" stroke={frameD} strokeWidth="3.4" />
      <path d="M10.2 25A23.8 23.8 0 0 1 22.2 11.4" fill="none" stroke={light} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="32" cy="32" r="21.2" {...IS} fill={gapC} />
      <circle cx="32" cy="32" r="19.6" fill={cover} />
      <g clipPath={`url(#${u}m)`} stroke={grid} strokeWidth="1.5" fill="none">{grd}</g>
      <circle cx="32" cy="32" r="19.6" {...IS} />
      <circle cx="32" cy="32" r="12.4" {...IS} fill={cover} />
      <circle cx="32" cy="32" r="5.2" {...IS} fill={plate} />
      <path d={inkBox(18.6, 30.6, 7.4, 2.8, 1.2, 0)} fill="#14161a" />
      <path d={inkBox(38, 30.6, 7.4, 2.8, 1.2, 0)} fill="#14161a" />
    </g>
  );
};

/** LOW. Steam grate in the street, flat top-down: a galvanised frame bolted at the corners round a dark pit with eight
 *  pale bars and two cross-ties, and three wavy plumes of white steam curling up out of the north edge. Flush with the
 *  pavement. No shadow. */
export const Grate = () => {
  const frame = "#9ba3af", pit = "#1f232b", glow = "#3a4656", bar = "#b8c0cb", tie = "#848c99", steam = "#f4f7fa";
  const x = 9, y = 18, w = 46, h = 33;
  const plume = (d, key) => (
    <g key={key} fill="none" strokeLinecap="round">
      <path d={d} stroke={INK} strokeWidth="3.6" /><path d={d} stroke={steam} strokeWidth="2" />
    </g>
  );
  return (
    <g>
      <path d={inkBox(x, y, w, h, 2.4, .4)} fill={frame} {...OS} />
      <rect x={x + 4} y={y + 4} width={w - 8} height={h - 8} rx="1" {...IS} fill={pit} />
      <rect x={x + 4.6} y={y + 12} width={w - 9.2} height="5" fill={glow} />
      {Array.from({ length: 8 }, (_, i) => <rect key={i} x={14.4 + i * 4.6} y={y + 4.6} width="2.6" height={h - 9.2} fill={bar} />)}
      {[y + 9, y + h - 12.6].map((ty) => <rect key={ty} x={x + 4} y={ty} width={w - 8} height="2.6" {...IS} fill={tie} />)}
      {[[x + 2, y + 2], [x + w - 2, y + 2], [x + 2, y + h - 2], [x + w - 2, y + h - 2]].map(([bx, by], i) => <circle key={i} cx={bx} cy={by} r="1.1" {...IS} fill={tie} />)}
      {plume("M20 20C16 15 24 12 20 6", "p1")}
      {plume("M32 20C28 15 36 12 32 4.6", "p2")}
      {plume("M44 20C40 15 48 12 44 7", "p3")}
    </g>
  );
};


/** SHORT. Oak barrel at waist height (SHORT camera): the lid seen from above with its chime groove, two boards and a
 *  bung; bulging staves shaded on the east, two iron hoops that stop at the barrel's edge (clipped to its silhouette). */
export function Barrel() {
  const u = useUid();
  const oak = "#a5693b", oakL = "#c99360", oakD = "#73452a", iron = "#4b5058";
  const cx = 32, yt = 27, yb = 51.4, rx = 13, ry = 5.6, bulge = 3; // lid centre y, bottom-rim centre y
  const body = `M${cx - rx} ${yt}C${cx - rx - bulge} ${yt + 8} ${cx - rx - bulge} ${yb - 8} ${cx - rx} ${yb}A${rx} ${ry} 0 0 0 ${cx + rx} ${yb}C${cx + rx + bulge} ${yb - 8} ${cx + rx + bulge} ${yt + 8} ${cx + rx} ${yt}Z`;
  const hoop = (y) => `M${cx - rx - 5} ${y}A${rx + 5} ${ry + .4} 0 0 0 ${cx + rx + 5} ${y}`;
  const stave = (k) => {
    const e = ry * Math.sqrt(1 - (k / rx) ** 2);
    return `M${cx + k} ${r2(yt + e)}Q${r2(cx + k * 1.22)} ${r2((yt + yb) / 2 + e)} ${cx + k} ${r2(yb + e)}`;
  };
  return (
    <g>
      <defs><clipPath id={`${u}c`}><path d={body} /></clipPath></defs>
      <GroundShadow cx={33} cy={57} rx={18} ry={3.4} />
      <path d={body} fill={oak} />
      <g clipPath={`url(#${u}c)`}>
        <path d={`M${cx + 7} 0H60V64H${cx + 7}Z`} fill={oakD} />
        {[-6.5, 0, 6.5].map((k) => <path key={k} d={stave(k)} {...IS} />)}
        {[29.4, 45.6].map((y) => (
          <g key={y} fill="none">
            <path d={hoop(y)} stroke={INK} strokeWidth="4.4" />
            <path d={hoop(y)} stroke={iron} strokeWidth="2.6" />
          </g>
        ))}
      </g>
      <path d={body} fill="none" {...OS} />
      {/* lid */}
      <ellipse cx={cx} cy={yt} rx={rx} ry={ry} fill={oakL} {...OS} />
      <ellipse cx={cx} cy={yt} rx={rx - 2.2} ry={ry - 1.2} {...IS} />
      <path d={`M${cx - 10} ${yt - 1.5}H${cx + 10}M${cx - 10} ${yt + 1.5}H${cx + 10}`} {...IS} />
      <ellipse cx={cx + 4.6} cy={yt} rx="1.5" ry=".75" fill={INK} />
    </g>
  );
}

/** TALL. Apple tree, clearly taller than a person and unlike the oak and birch at a glance: a round, bright-green crown of
 *  small scalloped lobes (squatter than the birch, much smaller than the oak) dotted with red apples, on a slim
 *  brown trunk that forks into two limbs under it, a darker underside to the crown and two windfalls in the grass. */
export function Tree() {
  const u = useUid();
  const leaf = "#6fb04a", leafD = "#4a8a3a", leafL = "#9bd062", bark = "#8a5a34", barkD = "#5e3b22", apple = "#d63f38", appleL = "#f6a49c";
  const ccx = 32, ccy = 22.5, crx = 21, cry = 18;
  const crown = lobed(Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI * 2) / 12 - Math.PI / 2, k = 1 + (i % 2 ? .035 : -.03);
    return [r2(ccx + Math.cos(a) * crx * k), r2(ccy + Math.sin(a) * cry * k)];
  }), .6);
  const trunk = "M25.6 57.6C28.6 56 29.2 53 29.4 48L29.8 38.4H35L35.4 48C35.6 53 36.4 56 39.4 57.6Q35.8 56.6 32.4 57.8Q29 56.6 25.6 57.6Z";
  const apples = [[20.6, 20.4], [30, 13.4], [43.6, 17.6], [37.4, 27.8], [24.4, 30.4], [47, 29.2], [15.6, 28.8], [33, 21.4], [28, 22]];
  return (
    <g>
      <defs><clipPath id={`${u}k`}><path d={crown} /></clipPath></defs>
      <GroundShadow cx={32} cy={57.4} rx={21} ry={3.6} />
      {/* two limbs forking out of the trunk into the crown, then the trunk */}
      <path d="M31 44C27 41.6 22.4 38.6 19.4 33.6L23 31.6C25.6 35.8 29 38.2 32.4 39.6Z" fill={bark} {...OS} />
      <path d="M33.6 43C37 40.6 41.4 38 44.6 33.2L41 31C38.4 35 35.2 37.4 32.6 39Z" fill={barkD} {...OS} />
      <path d={trunk} fill={bark} {...OS} />
      <path d="M33 39V48C33.2 53 34 55.6 36 57.2Q34.4 56.8 32.4 57.8Q31.8 56.4 32 55.4C32.6 52 32.8 49 32.8 45Z" fill={barkD} />
      <path d="M30.6 46.4C30.4 49 30.8 51.4 30.2 53.6" {...IS} />
      {/* crown: base, darker underside, one lit lobe, clump marks, outline */}
      <path d={crown} fill={leaf} />
      <g clipPath={`url(#${u}k)`}>
        <path d="M0 29C8 26 14 31 22 28.4C28 31.4 36 27.6 43 30C49 27.8 56 29 64 27V48H0Z" fill={leafD} />
        <path d="M13 24A14 14 0 0 1 28 6A13 13 0 0 0 19 24.6Z" fill={leafL} />
      </g>
      <path d="M23.4 25.6A4.6 4.6 0 0 1 29.4 24M36.4 23.4A4.4 4.4 0 0 1 42.4 22M38.6 14.6A4.2 4.2 0 0 1 44 15.4M18 33.4A4 4 0 0 1 23 32.6" {...IS} />
      <path d={crown} fill="none" {...OS} />
      {/* apples */}
      {apples.map(([ax, ay], i) => (
        <g key={i}>
          <circle cx={ax} cy={ay} r="2.6" {...IS} fill={apple} />
          <circle cx={ax - .9} cy={ay - 1} r=".7" fill={appleL} />
        </g>
      ))}
      {/* windfalls */}
      {[[22.6, 56.4], [43.6, 55.6]].map(([ax, ay]) => (
        <g key={ax}>
          <circle cx={ax} cy={ay} r="2.3" {...IS} fill={apple} />
          <circle cx={ax - .8} cy={ay - .9} r=".6" fill={appleL} />
        </g>
      ))}
    </g>
  );
}

/** TALL. Dense shrub above head height, about 48 units tall and 52 wide: a tall mound of leafy lobes that runs right down
 *  to the ground with no trunk, a dark lower half and a lit upper-left edge, a few leaf-clump marks and a scatter of red
 *  berries. Yellower and rounder than the pine, and with no trunk, unlike the oak. */
export function Shrub() {
  const u = useUid();
  const leaf = "#4c9a4a", leafD = "#33763a", leafL = "#7cbc5e", berry = "#cf3a50";
  const crown = lobed([[10, 56.6], [6.4, 50], [6.6, 42.6], [10.6, 35.4], [13.6, 27.6], [17.6, 19.6], [23, 13], [30, 10.4],
    [37.4, 12.2], [43.4, 17.6], [47.6, 25], [50.6, 33.2], [55, 40.4], [58, 47.4], [55.4, 54.4], [48, 57.8], [38, 56.4], [28, 58], [18, 56.8]], .66);
  return (
    <g>
      <defs><clipPath id={`${u}k`}><path d={crown} /></clipPath></defs>
      <GroundShadow cx={32} cy={57.6} rx={26} ry={4} />
      <path d={crown} fill={leaf} />
      <g clipPath={`url(#${u}k)`}>
        <path d="M0 40C8 36 14 43 22 39C30 44 38 38 46 42C52 39 58 41 64 38V66H0Z" fill={leafD} />
        <path d="M9 36L15 25L21 15L29 10.4L24 20L18 32Z" fill={leafL} />
      </g>
      <path d="M17.6 31A5.4 5.4 0 0 1 25 28.4M31 22A5.2 5.2 0 0 1 38.6 20.6M40 34A5 5 0 0 1 47 32M24 48A5.4 5.4 0 0 1 31.4 46M41 52A5 5 0 0 1 48.4 50M12.4 50A4.6 4.6 0 0 1 18 47.4" {...IS} />
      <path d={crown} fill="none" {...OS} />
      {[[22, 22.6], [34, 31], [44.6, 42], [14.6, 42.4], [28.4, 42.4], [38.4, 49.6], [22.6, 52]].map(([bx, by], i) => (
        <circle key={i} cx={bx} cy={by} r="2" {...IS} fill={berry} />
      ))}
    </g>
  );
}

/** TALL. Beach palm, about 56 units tall: a slim trunk that leans and curves up from a flared foot, ringed with growth
 *  marks and shaded on its east half, under a crown of long toothed fronds that arch out and droop (the far ones a shade
 *  darker, the near ones lighter, each with a midrib) and three brown coconuts tucked under the hub. Warm sandy bark
 *  and leafy greens, so it reads on sand, boardwalk, stone and grass. */
export function Palm() {
  const bark = "#b48c5a", barkD = "#85623b", leaf = "#4f9b55", leafD = "#2f7144", nut = "#7a5230", nutD = "#4f321b";
  const K = [35.6, 17.6]; // the crown's hub
  // trunk: a quadratic centre line from the foot to the hub, offset to either side by a half-width that narrows upward
  const A = [27.6, 57.4], B = [38.4, 40], N = 12;
  const q = (t) => [(1 - t) ** 2 * A[0] + 2 * (1 - t) * t * B[0] + t * t * K[0], (1 - t) ** 2 * A[1] + 2 * (1 - t) * t * B[1] + t * t * K[1]];
  const hw = (t) => 3.9 - 1.5 * t + 2.8 * (1 - t) ** 7;
  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const t = i / N, c = q(t), a = q(Math.max(0, t - .02)), b = q(Math.min(1, t + .02));
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty), nx = -ty / l, ny = tx / l, w = hw(t);
    return { c, l: [c[0] - nx * w, c[1] - ny * w], r: [c[0] + nx * w, c[1] + ny * w], t };
  });
  pts[0].l = [A[0] - hw(0), A[1]]; pts[0].r = [A[0] + hw(0), A[1]]; // a flat foot
  const trunk = polyD(...pts.map((p) => p.l), ...pts.map((p) => p.r).reverse());
  const east = polyD(...pts.map((p) => p.c), ...pts.map((p) => p.r).reverse());
  const rings = pts.slice(2, N).filter((_, i) => i % 1 === 0).map((p) => `M${r2(p.l[0])} ${r2(p.l[1])}Q${r2(p.c[0] + .2)} ${r2(p.c[1] + 2)} ${r2(p.r[0])} ${r2(p.r[1])}`).join("");
  // a toothed frond: a centre line from the hub that arches up then droops (g), `L` long, `W` wide; teeth alternate in and out
  const frond = ([deg, L, g, W], key, fill) => {
    const th = (deg * Math.PI) / 180, dx = Math.cos(th), dy = Math.sin(th), M = 9;
    const c = (t) => [K[0] + dx * L * t, K[1] + dy * L * t + L * (g * t * t - .5 * t * (1 - t) * Math.max(0, 1 - Math.abs(dy) * 1.2))];
    const up = [], dn = [], mid = [];
    for (let i = 0; i <= M; i++) {
      const t = i / M, p = c(t), a = c(Math.max(0, t - .03)), b = c(Math.min(1, t + .03));
      const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty), nx = -ty / l, ny = tx / l;
      const w = i === M ? 0 : W * Math.sin(Math.PI * Math.min(1, t * 1.04)) ** .7 * (1 - .25 * t) * (i % 2 ? 1 : .6);
      up.push([p[0] + nx * w, p[1] + ny * w]); dn.push([p[0] - nx * w, p[1] - ny * w]); mid.push(p);
    }
    return (
      <g key={key}>
        <path d={polyD(...up, ...dn.reverse())} fill={fill} {...OS} />
        <path d={`M${mid.map((p) => `${r2(p[0])} ${r2(p[1])}`).join("L")}`} {...IS} />
      </g>
    );
  };
  const far = [[-138, 26, .55, 7], [-42, 26, .55, 7], [-94, 22, .12, 6.4]];
  const near = [[-172, 27, .9, 7.4], [-8, 27, .9, 7.4], [152, 20, 1.1, 6.6], [28, 20, 1.1, 6.6]];
  return (
    <g>
      <GroundShadow cx={33} cy={57.6} rx={17} ry={3.1} />
      {far.map((f, i) => frond(f, `f${i}`, leafD))}
      {/* trunk: bark, its east half in shade, growth rings, outline */}
      <path d={trunk} fill={bark} />
      <path d={east} fill={barkD} />
      <path d={rings} {...IS} />
      <path d={trunk} fill="none" {...OS} />
      {near.map((f, i) => frond(f, `n${i}`, leaf))}
      {/* coconuts hanging under the hub */}
      {[[33, 21.8], [38.2, 22], [35.6, 25]].map(([cx, cy]) => (
        <g key={cx}>
          <circle cx={cx} cy={cy} r="2.7" fill={nut} />
          <path d={`M${cx} ${r2(cy - 2.7)}A2.7 2.7 0 0 1 ${cx} ${r2(cy + 2.7)}Z`} fill={nutD} />
          <circle cx={cx} cy={cy} r="2.7" {...IS} />
        </g>
      ))}
    </g>
  );
}

/** TALL. Saguaro, about 53 units tall: a ribbed green trunk with a domed top and a pink flower, and two upturned arms that
 *  leave it at different heights (the left one lower and shorter). One clean outline runs round the whole plant, the
 *  east side of each part is a shade darker, a narrow lit stripe on the west, a few ribs and cream spines. */
export function Cactus() {
  const u = useUid();
  const g = "#4c9a5a", gD = "#2f7048", gL = "#82c68a", spine = "#f4f0d4";
  const trunk = "M26 56V11A6 6 0 0 1 38 11V56Q32 58.2 26 56Z";
  const armL = "M27 40.5H13A4 4 0 0 1 9 36.5V24.5A3.75 3.75 0 0 1 16.5 24.5V33H27Z";
  const armR = "M37 33.5H51A4 4 0 0 0 55 29.5V15.5A3.75 3.75 0 0 0 47.5 15.5V26H37Z";
  return (
    <g>
      <defs>
        <clipPath id={`${u}t`}><path d={trunk} /></clipPath>
        <clipPath id={`${u}l`}><path d={armL} /></clipPath>
        <clipPath id={`${u}r`}><path d={armR} /></clipPath>
      </defs>
      <GroundShadow cx={32} cy={57.4} rx={18} ry={3.2} />
      {/* one inked silhouette: the three parts stroked together, the fills laid over it */}
      <g fill={INK} stroke={INK} strokeWidth="3" strokeLinejoin="round"><path d={armL} /><path d={armR} /><path d={trunk} /></g>
      <path d={armL} fill={g} /><path d={armR} fill={g} /><path d={trunk} fill={g} />
      <g clipPath={`url(#${u}l)`}><path d="M13.6 14H20V33H30V44H13.6Z" fill={gD} /></g>
      <g clipPath={`url(#${u}r)`}><path d="M52 8H60V30H40V37.6H52Z" fill={gD} /></g>
      <g clipPath={`url(#${u}t)`}><path d="M34.6 0H44V64H34.6Z" fill={gD} /></g>
      {/* where the arms leave the trunk */}
      <path d="M26 34.4V39.6M38 27.4V32.6" stroke={gD} strokeWidth="1.5" strokeLinecap="round" />
      {/* lit stripes and ribs */}
      <path d="M28.2 12.4V51M11 26.6V36M49.2 17.4V24.4" stroke={gL} strokeWidth="1.7" strokeLinecap="round" fill="none" />
      <path d="M31.4 9.6V53.4M34.4 11.4V53M13 23.4V32M51.4 14V22.4" {...IS} strokeOpacity=".4" />
      {/* spines */}
      <path d="M29.6 17l-1.6-1M33 24l1.8-1M29.4 32l-1.6-1M33.2 40l1.8-1M29.6 47l-1.6-1M12 30l-1.4-1M14.8 36.6l1.4-.8M50.6 20.6l-1.4-1M53 26.2l1.2-.8" stroke={spine} strokeWidth=".8" strokeLinecap="round" fill="none" />
      {/* the flower on the crown */}
      <g>
        {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx={32} cy={2.6} rx="1.5" ry="2.5" {...IS} fill="#e8587f" strokeWidth=".7" transform={`rotate(${a} 32 5.2)`} />)}
        <circle cx={32} cy={5.2} r="1.4" fill="#f5c63c" />
      </g>
    </g>
  );
}

/** SHORT. Cast-iron fire hydrant at knee height, in the waist-height camera (its dome and nut seen from above): a wide
 *  flange, a red barrel with a collar, a bonnet under a dome and a brass nut, two brass-capped side outlets and a
 *  big brass pumper nozzle facing the viewer. Shade on the east. Sight passes over it. */
export function Hydrant() {
  const u = useUid();
  const red = "#cf3430", redL = "#e86a5e", brass = "#d9a441", brassL = "#f0c969", brassD = "#a87a2a", redD = "#9c2420";
  const cx = 32;
  const flange = "M21 51.2V54A11 3.4 0 0 0 43 54V51.2A11 3.4 0 0 0 21 51.2Z";
  const body = "M24.4 38V50.4A7.6 2.8 0 0 0 39.6 50.4V38Z";
  const collar = "M23.4 36V38.4A8.6 2.8 0 0 0 40.6 38.4V36Z";
  const bonnet = "M25.4 30V36A6.6 2.2 0 0 0 38.6 36V30Z";
  const dome = "M25.4 30C25.4 21.8 38.6 21.8 38.6 30A6.6 2.4 0 0 1 25.4 30Z";
  return (
    <g>
      <defs><clipPath id={`${u}s`}><path d={flange} /><path d={body} /><path d={collar} /><path d={bonnet} /><path d={dome} /></clipPath></defs>
      <GroundShadow cx={33} cy={57} rx={17} ry={3} />
      {/* side outlets sit beside the barrel: west lit, east a shade darker */}
      <path d={inkBox(17.4, 38.6, 8, 7, 1.2, .2)} fill={red} {...OS} />
      <path d={inkBox(38.6, 38.6, 8, 7, 1.2, .2)} fill={redD} {...OS} />
      <ellipse cx="17.2" cy="42.1" rx="1.9" ry="4.2" fill={brass} {...OS} />
      <ellipse cx="46.8" cy="42.1" rx="1.9" ry="4.2" fill={brassD} {...OS} />
      {/* flange, barrel, collar, bonnet and dome */}
      <path d={flange} fill={red} {...OS} />
      <ellipse cx={cx} cy="51.2" rx="11" ry="3.4" fill={redL} {...OS} />
      <path d={body} fill={red} {...OS} />
      <path d={collar} fill={red} {...OS} />
      <path d={bonnet} fill={red} {...OS} />
      <path d={dome} fill={red} {...OS} />
      <g clipPath={`url(#${u}s)`}><path d="M34.6 18H48V60H34.6Z" fill="#000" fillOpacity=".22" /></g>
      <path d="M27.4 40.4V49" stroke={redL} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M28.6 26.6Q30.4 24.4 32.6 24.2" stroke={redL} strokeWidth="1.3" strokeLinecap="round" fill="none" />
      {/* brass nut on the dome */}
      <path d="M29.4 24V21.6A2.6 1 0 0 1 34.6 21.6V24Z" fill={brass} {...OS} />
      <ellipse cx={cx} cy="21.6" rx="2.6" ry="1" fill={brassL} {...OS} />
      {/* the pumper nozzle facing the viewer */}
      <circle cx={cx} cy="45.4" r="5.4" fill={red} {...OS} />
      <circle cx={cx} cy="45.4" r="3.7" fill={brass} {...OS} />
      <circle cx={cx} cy="45.4" r="1.6" {...IS} fill={brassD} />
    </g>
  );
}

/** LOW. Toboggan you sit on, in the LOW-furniture camera kept low: a long plank deck at about knee height with slats
 *  across it, two steel cross-bars, a red painted nose that curls up at the east end with a coiled pull rope, and two
 *  steel runners underneath that turn up under the nose. No cast shadow. Sight passes over it. */
export function Sled() {
  const wood = "#c98f52", woodL = "#e3b072", woodD = "#8a5a2e", steel = "#8d97a8", red = "#c8423b", redD = "#8f2e2a", rope = "#eadfb9";
  const P = lowCam(56.4);
  const x0 = 4, x1 = 44, xn = 53, z0 = 3, z1 = 22, h0 = 6, h1 = 11, lift = 5.4;
  const hAt = (x) => (x <= x1 ? h1 : h1 + lift * ((x - x1) / (xn - x1)));
  const runner = (z, key) => {
    const d = `M${P(x0 + 2, z, 2.4).join(" ")}L${P(x1 + 2, z, 2.4).join(" ")}Q${P(xn + 1, z, 2.4).join(" ")} ${P(xn + 3, z, 12).join(" ")}`;
    return (
      <g key={key}>
        <path d={d} fill="none" stroke={INK} strokeWidth="5.2" strokeLinecap="round" />
        <path d={d} fill="none" stroke={steel} strokeWidth="2.4" strokeLinecap="round" />
        <path d={`M${P(x0 + 5, z, 3.2).join(" ")}L${P(x1 - 2, z, 3.2).join(" ")}`} stroke="#d9dfe8" strokeWidth=".8" strokeLinecap="round" />
      </g>
    );
  };
  const topPts = [P(x0, z0, h1), P(x0, z1, h1), P(x1, z1, h1), P(xn, z1, h1 + lift), P(xn, z0, h1 + lift), P(x1, z0, h1)];
  const front = `M${P(x0, z0, h0).join(" ")}L${P(x0, z0, h1).join(" ")}L${P(x1, z0, h1).join(" ")}Q${P(x1 + 5, z0, h1).join(" ")} ${P(xn, z0, h1 + lift).join(" ")}L${P(xn, z0, h0 + lift).join(" ")}Q${P(x1 + 5, z0, h0).join(" ")} ${P(x1, z0, h0).join(" ")}Z`;
  const ropeD = `M${P(xn - .6, 10, hAt(xn)).join(" ")}C${P(xn + 6, 11, h1 + 7).join(" ")} ${P(xn + 9, 2, 4).join(" ")} ${P(xn + 3, 2, 1.2).join(" ")}C${P(xn - 1, 2, .6).join(" ")} ${P(xn - 2, 8, 1.4).join(" ")} ${P(xn + 3.4, 9, 1.2).join(" ")}`;
  const strip = (xa, xb) => polyD(P(xa, z0, hAt(xa)), P(xa, z1, hAt(xa)), P(xb, z1, hAt(xb)), P(xb, z0, hAt(xb)));
  return (
    <g>
      {/* back runner, then the front one with its struts */}
      {runner(z1 - 2.4, "b")}
      <path d={`M${P(14, z0 + 3, 2.4).join(" ")}V${P(14, z0 + 3, h0).slice(1).join(" ")}M${P(36, z0 + 3, 2.4).join(" ")}V${P(36, z0 + 3, h0).slice(1).join(" ")}`} stroke={INK} strokeWidth="3.4" />
      {runner(z0 + 3, "f")}
      {/* deck: nose end face, top, front */}
      <path d={camSide(P, xn, z0, z1, h0 + lift, h1 + lift)} fill={woodD} {...OS} />
      <path d={polyD(...topPts)} fill={woodL} {...OS} />
      <path d={front} fill={wood} {...OS} />
      <path d={`M${P(x0 + 3, z0, h1 - 1.6).join(" ")}L${P(x1 - 4, z0, h1 - 1.6).join(" ")}`} {...IS} stroke={woodD} />
      {/* slats across the deck */}
      {[12, 20.4, 28.8, 37.2].map((x) => <path key={x} d={`M${P(x, z0, h1).join(" ")}L${P(x, z1, h1).join(" ")}`} {...IS} stroke={woodD} strokeOpacity=".75" />)}
      {/* steel cross-bars */}
      {[[15.4, 17.6], [32.4, 34.6]].map(([a, b]) => <path key={a} d={camTop(P, a, b, z0, z1, h1)} fill={steel} {...OS} strokeWidth="1.1" />)}
      {/* the red nose */}
      <path d={strip(46.4, xn)} fill={red} {...OS} strokeWidth="1.1" />
      <path d={`M${P(49.6, z0 + 1.4, hAt(49.6)).join(" ")}L${P(49.6, z1 - 1.4, hAt(49.6)).join(" ")}`} {...IS} stroke={redD} />
      {/* pull rope: tied through the nose and trailing out onto the floor */}
      <path d={ropeD} fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />
      <path d={ropeD} fill="none" stroke={rope} strokeWidth="1.6" strokeLinecap="round" />
      <path d={ropeD} fill="none" stroke={INK} strokeWidth=".7" strokeDasharray="1.2 1.6" strokeLinecap="round" />
    </g>
  );
}

/** LOW. Wooden rowboat you sit in, across `cw` x `ch` tiles, in the LOW-furniture camera kept low: a blunt stern and a
 *  pointed bow, the teal-painted hull side showing along the south edge under a light wood gunwale (with a cream stripe),
 *  the sunk interior seen from above (a lit far wall, a darker floor), plank thwarts across it, brass oarlocks and a
 *  ring at the bow. The long axis follows the span: bow east for 2 x 1, bow north for 1 x 2; a 1 x 1 is a short boat.
 *  Sight passes over it, no cast shadow. */
export function BoatSpan({ cw = 1, ch = 1 }) {
  const u = useUid();
  const teal = "#2f8f9a", cream = "#efe6cf", gun = "#d29b60", wall = "#b07a46", floor = "#6a4426", plank = "#e0b27a", brass = "#d9c27a";
  const vert = ch > cw, n = Math.max(cw, ch), L = n === 1 ? 54 : 64 * n - 18, Wd = n === 1 ? 33 : 34;
  const cx = 32 * cw, cy = vert ? 32 * ch : 33;
  const A = (a, b) => (vert ? [r2(cx + b), r2(cy - a)] : [r2(cx + a), r2(cy + b)]); // along the boat, across it
  // one side of the hull as a bezier [u, v]; the other side mirrors it
  const side = (l, w, lx = 0) => { const s = -l / 2 + lx, e = l / 2 + lx; return [[s + 2, w * .31], [s + l * .2, w * .62], [e - l * .4, w * .6], [e, 0]]; };
  const hull = (l, w, lx = 0) => {
    const [p0, p1, p2, p3] = side(l, w, lx), m = ([a, b]) => [a, -b];
    return `M${A(...m(p0))}C${A(...m(p1))} ${A(...m(p2))} ${A(...p3)}C${A(...p2)} ${A(...p1)} ${A(...p0)}Z`;
  };
  const halfW = (uu) => { // half-width of the hull's outer edge at u
    const [p0, p1, p2, p3] = side(L, Wd);
    let best = [p0[0], p0[1]], bd = 1e9;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, c = (k) => (1 - t) ** 3 * p0[k] + 3 * (1 - t) ** 2 * t * p1[k] + 3 * (1 - t) * t * t * p2[k] + t ** 3 * p3[k];
      if (Math.abs(c(0) - uu) < bd) { bd = Math.abs(c(0) - uu); best = [c(0), c(1)]; }
    }
    return best[1];
  };
  const outer = hull(L, Wd), inner = hull(L - 9, Wd - 8, -.5);
  const th = n === 1 ? [-.28, .24] : [-.33, 0, .33];
  const seg = (a) => `M${A(a - 1.8, -Wd)}L${A(a - 1.8, Wd)}L${A(a + 1.8, Wd)}L${A(a + 1.8, -Wd)}Z`;
  const ou = n === 1 ? [-.17 * L] : [-.2 * L, .12 * L]; // oarlocks sit on the gunwale where the hull is full
  return (
    <g>
      <defs><clipPath id={`${u}h`}><path d={outer} transform="translate(0 6.4)" /></clipPath><clipPath id={`${u}i`}><path d={inner} /></clipPath></defs>
      {/* hull side: the outline dropped by the hull's depth, a cream stripe along it */}
      <path d={outer} transform="translate(0 6.4)" fill={teal} {...OS} />
      <g clipPath={`url(#${u}h)`}><path d={outer} transform="translate(0 3.6)" fill="none" stroke={cream} strokeWidth="1.5" /></g>
      {/* gunwale, then the inside: lit far wall, darker floor, plank seams, the thwarts */}
      <path d={outer} fill={gun} {...OS} />
      <path d={inner} fill={wall} />
      <g clipPath={`url(#${u}i)`}>
        <path d={inner} transform="translate(0 5)" fill={floor} />
        {[-.12, .2].map((k) => <path key={k} d={`M${A(-L / 2, k * Wd)}L${A(L / 2, k * Wd - 1)}`} stroke="#8a5a33" strokeWidth=".8" strokeOpacity=".8" />)}
        {th.map((k) => <path key={k} d={seg(k * L)} {...IS} fill={plank} />)}
      </g>
      <path d={inner} fill="none" {...OS} strokeWidth="1.2" />
      {/* oarlocks on the gunwale, a ring at the bow */}
      {ou.flatMap((a) => [-1, 1].map((sd) => { const [x, y] = A(a, sd * (halfW(a) - 1.6)); return <circle key={`${a}${sd}`} cx={x} cy={y} r="1.4" {...IS} fill={brass} />; }))}
      <circle cx={A(L / 2 - 4.2, 0)[0]} cy={A(L / 2 - 4.2, 0)[1]} r="1.5" {...IS} fill={cream} />
    </g>
  );
}
export const Boat = () => <BoatSpan cw={1} ch={1} />;

/* ====================================================================== */
/*  CATALOG EXPANSION · the props added with the biome kits                */
/* ====================================================================== */

/* ---- MANSION (2): EASEL, DISPLAY_CASE, CHANDELIER_FALL, GRAMOPHONE ---- */

/** TALL. Painter's easel at full height, taller than a person: two splayed front legs and a thinner back leg meeting under
 *  a top clamp, a cross brace low down, a ledge holding a canvas (a sunny landscape of blue sky, a sun and green hills,
 *  its edge showing on the east) and a paint tube and brush on the ledge. Beech wood, one shade for the back leg. */
export function Easel() {
  const wood = "#b5803f", woodD = "#7e5628", woodL = "#d4a15f", canvas = "#f3ecd8", canvasD = "#cfc2a0";
  return (
    <g>
      <GroundShadow cx={32} cy={57.4} rx={23} ry={3.4} />
      {/* back leg, then the front legs */}
      <path d="M33.4 8H38.2L42.6 57.6H38.4Z" fill={woodD} {...OS} />
      <path d="M22 8H27.4L15.4 57.6H10Z" fill={wood} {...OS} />
      <path d="M36.6 8H42L54 57.6H48.6Z" fill={wood} {...OS} />
      {/* cross brace between the front legs */}
      <path d={inkBox(14, 47.4, 36, 3.6, 1, .2)} fill={woodD} {...OS} />
      {/* canvas: east edge, the stretched face and its painting */}
      <path d="M48.4 7.6L51.2 5.4V38.6L48.4 40.8Z" fill={canvasD} {...OS} />
      <path d={inkBox(15.6, 7.6, 32.8, 33.2, 1, .3)} fill={canvas} {...OS} />
      <rect x="18.2" y="10.2" width="27.6" height="28" fill="#8ec5e8" />
      <circle cx="38.6" cy="18" r="3.6" fill="#f2b84b" />
      <path d="M18.2 38.2V29C23.4 23.2 28.4 25 33 28.6C37.6 25 42 25.6 45.8 28.8V38.2Z" fill="#6fae6a" />
      <path d="M18.2 38.2V33.4C26 30.4 36 34.6 45.8 32.2V38.2Z" fill="#3f7d44" />
      <rect x="18.2" y="10.2" width="27.6" height="28" {...IS} />
      <path d="M24.6 28.4V23.6M24.6 23.6L22.4 26.6M24.6 23.6L26.8 26.4" {...IS} />
      {/* top clamp and the ledge in front of the canvas, with a paint tube and a brush on it */}
      <path d={inkBox(23, 3.2, 18, 5.4, 1.4, .3)} fill={woodD} {...OS} />
      <path d={inkBox(12.4, 39.6, 39.2, 4.6, 1.2, .3)} fill={woodL} {...OS} />
      <path d={inkBox(17, 37.2, 9.6, 3.2, 1.2, 0)} {...IS} fill={CRIMSON} />
      <path d="M26.6 37.8H29.4V39.8H26.6Z" {...IS} fill="#c3c8cc" />
      <path d="M33.6 39.2L45.4 36.6" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <path d="M33.6 39.2L45.4 36.6" stroke={woodD} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M44 37L47.2 36.2" stroke="#4aa0d8" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

/** SHORT. Museum display case at waist height (SHORT camera: its glass top seen from above), a glass cube on a short
 *  dark walnut plinth with a brass plaque, brass corner posts and a brass rim. Inside, on a crimson velvet cushion with
 *  gold tassels, a gold crown: a jewelled band (a ruby between two sapphires, a row of pearls), five gold points each
 *  tipped with a pearl orb, two arches over a crimson velvet cap, and an orb with a cross on top. Glass is pale blue and
 *  see-through, so the crown shows. */
export function DisplayCase() {
  const wood = "#5a3a24", woodD = "#3a2415", brass = BRASS, gold = "#e2b23c", goldD = "#a8801f", goldL = "#f6dc7a";
  const velvet = "#8a2634", velvetL = "#b04050", velvetD = "#5f1a25", pearl = "#f4efe2";
  const x = 18, w = 24, dx = 5, dy = 9.6, yg = 27, yb = 51, yt = 57.4; // glass cube front x 18..42, y 27..51
  const kx = 31.3, ky = 39.8, krx = 7.4, kry = 1.8, kh = 3; // crown band: top ellipse centre, radii, height
  const by = (px, top = true) => r2((top ? ky : ky + kh) + kry * Math.sqrt(Math.max(0, 1 - ((px - kx) / krx) ** 2)));
  const points = [-6.6, -3.4, 0, 3.4, 6.6].map((o) => kx + o);
  return (
    <g>
      <GroundShadow cx={32} cy={57.4} rx={19} ry={3.2} />
      {/* plinth */}
      <path d={slabSide(x, yb, w, yt - yb, dx, dy)} fill={woodD} {...OS} />
      <path d={inkBox(x, yb, w, yt - yb, 1.2, .3)} fill={wood} {...OS} />
      <path d={inkBox(x + 7.4, yb + 1.8, 9.2, 3, .8, 0)} {...IS} fill={brass} />
      {/* the velvet cushion with gold tassels at its front corners */}
      <path d={slabSide(22.6, 45, 14.8, 3.4, 2.6, 5)} fill={velvetD} {...OS} strokeWidth="1.1" />
      <path d={slabTop(22.6, 45, 14.8, 2.6, 5)} fill={velvetL} {...OS} strokeWidth="1.1" />
      <path d={inkBox(22.6, 45, 14.8, 3.4, 1, .2)} fill={velvet} {...OS} strokeWidth="1.1" />
      {[22.6, 37.4].map((tx) => <path key={tx} d={`M${tx} 45.4l-.9 3.6h1.8Z`} fill={gold} stroke={INK} strokeWidth=".6" strokeLinejoin="round" />)}
      {/* the crown: velvet cap under two gold arches, the band with its jewels, the points with pearl orbs, the orb and cross */}
      <path d={`M${kx - krx + .6} ${ky}Q${kx - krx + 1} 32 ${kx} 31.6Q${kx + krx - 1} 32 ${kx + krx - .6} ${ky}Z`} {...IS} fill={velvet} />
      <path d={`M${kx - krx + .4} ${ky + .2}Q${kx - krx + .6} 31 ${kx} 30.8Q${kx + krx - .6} 31 ${kx + krx - .4} ${ky + .2}`} fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <path d={`M${kx - krx + .4} ${ky + .2}Q${kx - krx + .6} 31 ${kx} 30.8Q${kx + krx - .6} 31 ${kx + krx - .4} ${ky + .2}`} fill="none" stroke={gold} strokeWidth="1.1" strokeLinecap="round" />
      <path d={`M${kx} ${by(kx)}V31.2`} stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <path d={`M${kx} ${by(kx)}V31.2`} stroke={gold} strokeWidth="1.1" strokeLinecap="round" />
      {points.map((px) => { const y0 = by(px); return <path key={px} d={`M${r2(px - 1.3)} ${y0}L${r2(px)} ${r2(y0 - 3.4)}L${r2(px + 1.3)} ${y0}Z`} fill={gold} stroke={INK} strokeWidth=".7" strokeLinejoin="round" />; })}
      {points.map((px) => <circle key={`o${px}`} cx={r2(px)} cy={r2(by(px) - 3.8)} r=".9" fill={pearl} stroke={INK} strokeWidth=".5" />)}
      <path d={`M${kx - krx} ${ky}V${ky + kh}A${krx} ${kry} 0 0 0 ${kx + krx} ${ky + kh}V${ky}A${krx} ${kry} 0 0 1 ${kx - krx} ${ky}Z`} fill={gold} {...OS} strokeWidth="1.1" />
      <path d={`M${kx + 2.6} ${by(kx + 2.6) + .3}V${by(kx + 2.6, false) - .3}M${kx + 4.6} ${by(kx + 4.6) + .3}V${by(kx + 4.6, false) - .3}`} stroke={goldD} strokeWidth="1.2" />
      <path d={`M${kx - krx + 1} ${r2(ky + .6)}Q${kx - 3} ${r2(ky + 1.8)} ${kx - 1.6} ${r2(ky + 1.9)}`} fill="none" stroke={goldL} strokeWidth=".8" strokeLinecap="round" />
      <ellipse cx={kx} cy={r2(by(kx) + 1.5)} rx="1.3" ry="1.1" fill={CRIMSON} stroke={INK} strokeWidth=".5" />
      {[-4.4, 4.4].map((o) => <ellipse key={o} cx={kx + o} cy={r2(by(kx + o) + 1.5)} rx=".9" ry=".8" fill="#3d7fd0" stroke={INK} strokeWidth=".5" />)}
      <circle cx={kx} cy="29.6" r="1.5" fill={gold} stroke={INK} strokeWidth=".7" />
      <path d={`M${kx} 28.2V25.8M${kx - 1} 26.8H${kx + 1}`} stroke={INK} strokeWidth="1.9" strokeLinecap="round" />
      <path d={`M${kx} 28.2V25.8M${kx - 1} 26.8H${kx + 1}`} stroke={gold} strokeWidth=".7" strokeLinecap="round" />
      {/* the glass cube: east face, front, top (see-through, the top lightest) and a highlight */}
      <path d={slabSide(x, yg, w, yb - yg, dx, dy)} fill="#8fc5df" fillOpacity=".4" {...OS} />
      <path d={inkBox(x, yg, w, yb - yg, 1, .3)} fill="#bfe6f6" fillOpacity=".16" {...OS} />
      <path d={slabTop(x, yg, w, dx, dy)} fill="#e6f5fb" fillOpacity=".45" {...OS} />
      <path d={`M${x + 3} 33L${x + 7.4} 33L${x + 3} 41Z`} fill="#fff" fillOpacity=".55" />
      {/* brass: front rim, corner posts */}
      <path d={inkBox(x - .6, yg, w + 1.2, 2.6, .8, 0)} {...IS} fill={brass} />
      <path d={inkBox(x - .6, yg, 2.6, yb - yg, .8, 0)} {...IS} fill={brass} />
      <path d={inkBox(x + w - 2, yg, 2.6, yb - yg, .8, 0)} {...IS} fill={brass} />
    </g>
  );
}

/** LOW (front-end-only prop; CLASS_IDS keeps it LOW). A brass chandelier crashed flat on the floor, seen from above like
 *  the other floor items: a brass hoop lying on the floor with six curling scroll arms running in to a hub with a crystal
 *  ball and a ring of crystal beads, six empty candle cups round the rim and their cream candles thrown out and lying
 *  on the floor round it, crystal drops spilled about, and its snapped chain lying slack on the floor, trailing from the
 *  hub out past the rim to a broken last link. Nothing stands up from it and it casts no shadow; the rim is wider than a
 *  token, so it shows round whoever stands on it. */
export function ChandelierFall() {
  const brass = "#d9a441", brassD = "#a77a20", brassL = "#edc866", cream = "#f2ead0", creamD = "#d6cba8", glass = "#cfe9f5";
  const cx = 31, cy = 33, rx = 24, ry = 21, ri = 20, rj = 17; // outer hoop and its inner edge
  const ell = (ax, ay, sw = 1) => `M${cx - ax} ${cy}A${ax} ${ay} 0 1 ${sw} ${cx + ax} ${cy}A${ax} ${ay} 0 1 ${sw} ${cx - ax} ${cy}Z`;
  const at = (deg, kx, ky = kx) => { const a = (deg * Math.PI) / 180; return [r2(cx + kx * Math.cos(a)), r2(cy + ky * Math.sin(a))]; };
  const mid = (deg) => at(deg, (rx + ri) / 2, (ry + rj) / 2);
  // six candle cups round the rim; each candle was thrown out of its cup and lies on the floor: [cup angle, candle
  // direction off the radius, distance out from the cup]
  const cups = [[-150, 18, 6.4], [-90, -64, 5.6], [-30, 30, 6.2], [30, -20, 6], [90, 70, 5.6], [150, -26, 6.2]];
  // the chain lies slack on the floor: a cubic from the hub out past the east rim and round to the south-east
  const C = [[cx + 2, cy - 1], [cx + 20, cy - 12], [cx + 40, cy + 6], [cx + 24, cy + 25]];
  const bz = (t, k) => (1 - t) ** 3 * C[0][k] + 3 * (1 - t) ** 2 * t * C[1][k] + 3 * (1 - t) * t * t * C[2][k] + t ** 3 * C[3][k];
  const dz = (t, k) => 3 * (1 - t) ** 2 * (C[1][k] - C[0][k]) + 6 * (1 - t) * t * (C[2][k] - C[1][k]) + 3 * t * t * (C[3][k] - C[2][k]);
  const L = Array.from({ length: 15 }, (_, k) => { const t = .1 + (k / 14) * .9; return [k, r2(bz(t, 0)), r2(bz(t, 1)), r2((Math.atan2(dz(t, 1), dz(t, 0)) * 180) / Math.PI)]; });
  const drops = [[17, 5], [47.6, 5.4], [3.6, 33], [59.8, 26], [22, 60.2], [42.4, 60.6]];
  // a scroll arm from the hub out to a cup, bowed to one side
  const arm = (d) => { const [ax, ay] = at(d, 4.6), [bx, by] = at(d, ri - .4, rj - .4), [qx, qy] = at(d + 26, 12, 10.6); return `M${ax} ${ay}Q${qx} ${qy} ${bx} ${by}`; };
  return (
    <g>
      {/* outer hoop (lit band, darker inner edge, one glint) */}
      <path d={ell(rx, ry) + ell(ri, rj, 0)} fillRule="evenodd" fill={brass} {...OS} />
      <path d={ell(ri + .9, rj + .9)} fill="none" stroke={brassD} strokeWidth="1.2" />
      <path d={`M${at(200, rx - 2.1, ry - 2.1).join(" ")}A${rx - 2.1} ${ry - 2.1} 0 0 1 ${at(242, rx - 2.1, ry - 2.1).join(" ")}`} fill="none" stroke={brassL} strokeWidth="1.3" strokeLinecap="round" />
      {/* scroll arms from the hub to the cups, a ring of crystal beads round the hub */}
      {cups.map(([d]) => <path key={`s${d}`} d={arm(d)} fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />)}
      {cups.map(([d]) => <path key={`b${d}`} d={arm(d)} fill="none" stroke={brassD} strokeWidth="1.2" strokeLinecap="round" />)}
      {Array.from({ length: 10 }, (_, k) => at(k * 36 + 18, 8.4, 7.4)).map(([bx, by]) => <circle key={bx + by} cx={bx} cy={by} r="1.25" {...IS} fill={glass} />)}
      {/* empty candle cups on the rim */}
      {cups.map(([d]) => { const [px, py] = mid(d); return <g key={`c${d}`}><circle cx={px} cy={py} r="3.1" {...IS} fill={brassD} /><circle cx={px} cy={py} r="1.5" fill="#5a3f12" /></g>; })}
      {/* the candles, thrown out of their cups and lying flat on the floor round the rim */}
      {cups.map(([d, off, dist]) => {
        const [px, py] = mid(d), [fx, fy] = at(d, (rx + ri) / 2 + dist, (ry + rj) / 2 + dist * .9), a = d + off;
        return (
          <g key={`f${d}`} transform={`rotate(${a} ${r2(fx + px - px)} ${fy})`}>
            <path d={inkBox(r2(fx - 4.4), r2(fy - 1.6), 8.8, 3.2, 1.3, 0)} {...IS} fill={cream} />
            <path d={`M${r2(fx - 3.6)} ${r2(fy + .8)}H${r2(fx + 3.4)}`} stroke={creamD} strokeWidth=".9" strokeLinecap="round" />
            <path d={`M${r2(fx + 4.4)} ${fy}h1.3`} {...IS} />
          </g>
        );
      })}
      {/* crystal drops spilled on the floor */}
      {drops.map(([qx, qy]) => <path key={qx} d={`M${qx} ${qy - 2.6}L${qx + 1.9} ${qy}L${qx} ${qy + 2.6}L${qx - 1.9} ${qy}Z`} {...IS} fill={glass} />)}
      {/* the chain lying slack on the floor (open links flat, the links between them on edge), the last one snapped */}
      {L.map(([k, x, y, ang]) => (k % 2
        ? <rect key={k} x={r2(x - 2)} y={r2(y - .7)} width="4" height="1.4" rx=".7" transform={`rotate(${ang} ${x} ${y})`} fill={brassD} stroke={INK} strokeWidth=".7" />
        : <ellipse key={k} cx={x} cy={y} rx="2.3" ry="1.5" transform={`rotate(${ang} ${x} ${y})`} fill="none" stroke={INK} strokeWidth="2.4" />))}
      {L.map(([k, x, y, ang]) => (k % 2 ? null : <ellipse key={k} cx={x} cy={y} rx="2.3" ry="1.5" transform={`rotate(${ang} ${x} ${y})`} fill="none" stroke={brass} strokeWidth=".9" />))}
      <path d={`M${C[3][0] - 1.4} ${C[3][1] + 1.4}l-1.4 2.2M${C[3][0] + 1.6} ${C[3][1] + 1}l1 2.4`} stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
      {/* hub (a brass bowl with a crystal ball), over the chain's first link */}
      <circle cx={cx} cy={cy} r="4.4" fill={brassD} {...OS} />
      <circle cx={cx} cy={cy} r="2.2" {...IS} fill={glass} />
      <circle cx={cx - .7} cy={cy - .7} r=".7" fill="#fff" />
    </g>
  );
}

/** SHORT. Cabinet gramophone at waist height (SHORT camera): a walnut cabinet with a speaker grille and a small door
 *  with a brass knob, a brass crank on its east side, a black record with a red label on the top, a chrome tonearm, and a
 *  brass horn flaring up and out to the left from the back of the top (kept low: it stops well short of a person's head). */
export function Gramophone() {
  const wood = "#7a4c2c", woodL = "#9c6a42", woodD = "#4f301b", brass = "#d9a441", brassD = "#a77a20", brassL = "#edc866", chrome = "#e3dccb";
  const x = 7, y = 37, w = 34, h = 20, dx = 6, dy = 11; // cabinet front 7..41 × 37..57, top back edge y 26
  const P = (u, v) => [r2(x + u * w + v * dx), r2(y - v * dy)];
  const [rx0, ry0] = P(.36, .45), [px, py] = P(.9, .8);
  // horn: base A-B on the back of the top, mouth centre M, its major axis E2-E1 perpendicular to the horn's axis
  const A = [29.5, 29.8], B = [35.6, 26.4], M = [15.5, 16.2], E1 = [20.9, 8.5], E2 = [10.1, 23.9];
  const body = `M${A}Q21.6 23.75 ${E2}L${E1}Q23.75 22.35 ${B}Z`;
  return (
    <g>
      <GroundShadow cx={32} cy={57.4} rx={25} ry={3.4} />
      {/* the horn stands at the back, behind the record */}
      <ellipse cx="32.6" cy="28.6" rx="4.8" ry="2.2" {...IS} fill={woodD} />
      <path d={body} fill={brass} />
      <path d={`M${A}Q21.6 23.75 ${E2}L${M}L32.6 27.6Z`} fill={brassD} />
      <path d={`M31.8 26.2Q26.4 20.4 24 12.4`} fill="none" stroke={brassL} strokeWidth="1.5" strokeLinecap="round" />
      <path d={body} fill="none" {...OS} />
      <ellipse cx={M[0]} cy={M[1]} rx="9.4" ry="4.3" transform={`rotate(-55.2 ${M[0]} ${M[1]})`} fill={brassL} {...OS} />
      <ellipse cx={M[0]} cy={M[1]} rx="7.2" ry="3" transform={`rotate(-55.2 ${M[0]} ${M[1]})`} fill="#3a2810" />
      {/* cabinet: east side, top, front */}
      <path d={slabSide(x, y, w, h, dx, dy)} fill={woodD} {...OS} />
      <path d={slabTop(x, y, w, dx, dy)} fill={woodL} {...OS} />
      <path d={inkBox(x, y, w, h, 1.2, .3)} fill={wood} {...OS} />
      <path d={inkBox(10, 40.4, 16.4, 12, 1, .2)} {...IS} fill="#2b1a10" />
      <path d="M13.6 41.6V51.2M17.2 41.6V51.2M20.8 41.6V51.2M24.2 41.6V51.2" stroke={woodL} strokeWidth=".9" strokeLinecap="round" />
      <path d={inkBox(28.6, 40.4, 9.6, 12, 1, .2)} {...IS} />
      <circle cx="35.4" cy="46.4" r="1.4" {...IS} fill={brass} />
      {/* the record on the top, with its label and a glint, and the tonearm */}
      <ellipse cx={rx0} cy={ry0} rx="10.8" ry="4.1" {...IS} fill="#22222a" />
      <ellipse cx={rx0} cy={ry0} rx="3.6" ry="1.4" fill={CRIMSON} />
      <path d={`M${r2(rx0 - 8)} ${r2(ry0 - .6)}Q${r2(rx0 - 5.6)} ${r2(ry0 - 2.6)} ${r2(rx0 - 2.2)} ${r2(ry0 - 3)}`} fill="none" stroke="#6e6e7a" strokeWidth=".8" strokeLinecap="round" />
      <path d={`M${px} ${py}L${r2(rx0 + 6)} ${r2(ry0 + .4)}`} stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
      <path d={`M${px} ${py}L${r2(rx0 + 6)} ${r2(ry0 + .4)}`} stroke={chrome} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx={px} cy={py} r="1.9" {...IS} fill={brassD} />
      {/* crank on the east side */}
      <path d="M42.6 44.4H49.6V50.6" fill="none" stroke={INK} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M42.6 44.4H49.6V50.6" fill="none" stroke={brass} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="49.6" cy="51.2" r="2" {...IS} fill={brassD} />
    </g>
  );
}

/* ---- FARM (2): SCARECROW, TROUGH ---- */

/** TALL. Scarecrow, clearly taller than a person (hat brim to the foot of the post, about 56 units): a timber post with a
 *  cross arm under a red plaid shirt with ragged sleeves and straw poking from the cuffs, patched blue trousers stuffed with
 *  straw, a burlap sack head tied at the neck (button eyes, stitched mouth) and a battered straw hat with a red band.
 *  The east side of the shirt, head and trousers is one step darker. Front-end only. */
export function Scarecrow() {
  const u = useUid();
  const wood = "#9a6a3a", woodD = "#6c4526", red = "#b5473d", redD = "#843229", plaid = "#d98c7e", denim = "#5a78a4", denimD = "#3f587f";
  const sack = "#dcc38c", sackD = "#b79b63", straw = "#e0b440", strawD = "#b88b22", hat = "#dcb653", hatD = "#b88b3a";
  const head = "M32 6.4A8.2 8.2 0 1 1 32 22.8A8.2 8.2 0 1 1 32 6.4Z";
  return (
    <g>
      <defs>
        <clipPath id={`${u}s`}><path d={inkBox(19, 24, 26, 20, 3, .4)} /></clipPath>
        <clipPath id={`${u}h`}><path d={head} /></clipPath>
        <clipPath id={`${u}l`}><path d={inkBox(20.6, 43, 10.4, 12.4, 2.4, .4)} /></clipPath>
        <clipPath id={`${u}r`}><path d={inkBox(33, 43, 10.4, 12.4, 2.4, .4)} /></clipPath>
      </defs>
      <GroundShadow cx={32} cy={57.4} rx={13} ry={2.8} />
      {/* post */}
      <path d={inkBox(29.2, 20, 5.6, 38, 1, .2)} fill={wood} {...OS} />
      <path d="M32.4 22H33.8V57" stroke={woodD} strokeWidth="1.2" fill="none" />
      {/* arms: ragged sleeves out along the cross arm, straw at the cuffs */}
      <path d={inkBox(5.4, 22.6, 16, 7.6, 3, .3)} fill={red} {...OS} />
      <path d={inkBox(42.6, 22.6, 16, 7.6, 3, .3)} fill={red} {...OS} />
      <path d="M12 23V29.8M56.4 23.4V29.4" {...IS} stroke={plaid} strokeWidth=".8" />
      <path d="M5.6 24L1.6 21.6M5.4 26.4L1 26.4M5.6 28.8L1.8 31.4M58.4 24L62.4 21.6M58.6 26.4L63 26.4M58.4 28.8L62.2 31.4" stroke={straw} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M5.6 24L1.6 21.6M5.4 28.8L1.8 31.4M58.4 24L62.4 21.6" stroke={strawD} strokeWidth=".6" strokeLinecap="round" fill="none" />
      {/* trousers: two stuffed legs with a patch, straw at the ankles */}
      <path d={inkBox(20.6, 43, 10.4, 12.4, 2.4, .4)} fill={denim} {...OS} />
      <path d={inkBox(33, 43, 10.4, 12.4, 2.4, .4)} fill={denim} {...OS} />
      <g clipPath={`url(#${u}l)`}><path d="M27 42H32V57H27Z" fill={denimD} /></g>
      <g clipPath={`url(#${u}r)`}><path d="M39.4 42H45V57H39.4Z" fill={denimD} /></g>
      <path d="M23.4 47.4H28.2V51.6H23.4Z" {...IS} fill="#c9a766" strokeDasharray="1.6 1.2" />
      <path d="M22.6 55.4L21 58.2M25.4 55.4L25 58.6M28.4 55.4L29.4 58.2M35.2 55.4L34.2 58.2M38.2 55.4L38.6 58.6M41 55.4L42.6 58.2" stroke={straw} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      {/* shirt */}
      <path d={inkBox(19, 24, 26, 20, 3, .4)} fill={red} {...OS} />
      <g clipPath={`url(#${u}s)`}>
        <path d="M37 22H46V46H37Z" fill={redD} />
        <path d="M19 31H45M19 38H45M26 24V44M33.4 24V44M40.6 24V44" stroke={plaid} strokeWidth=".8" strokeOpacity=".75" fill="none" />
      </g>
      <path d="M27 42.4L25.6 46.4M32 42.8V47.4M37.6 42.4L38.6 46.4" stroke={straw} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d={inkBox(31.4, 33, 7.6, 7, 1, .2)} {...IS} fill="#c9a766" strokeDasharray="1.6 1.2" />
      {/* sack head tied at the neck */}
      <path d={head} fill={sack} {...OS} />
      <g clipPath={`url(#${u}h)`}><path d="M36.6 4H42V25H36.6Z" fill={sackD} /></g>
      <path d={head} fill="none" {...OS} />
      <path d={inkBox(27.4, 21, 9.2, 2.8, 1.2, .2)} fill={wood} {...OS} />
      <circle cx="28.4" cy="15" r="1.6" fill={INK} />
      <circle cx="35.6" cy="15" r="1.6" fill={INK} />
      <path d="M32 16.4L30.4 19.2H33.6Z" {...IS} fill={sackD} />
      <path d="M27.4 20.6Q32 22.6 36.6 20.6M28.8 19.8V21.6M32 21.2V23M35.2 19.8V21.6" {...IS} />
      {/* straw hat */}
      <path d="M23.4 10C22.8 .8 41.2 .8 40.6 10Z" fill={hat} {...OS} />
      <path d="M23.2 8.6H40.8" stroke={red} strokeWidth="2" />
      <ellipse cx="32" cy="10.2" rx="15.4" ry="3.4" fill={hat} {...OS} />
      <path d="M17.6 11.4Q20 14 24 12.8M40 12.8Q44 14 46.4 11.4" stroke={hatD} strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <path d="M45.8 9.6L49.4 7.4M16.6 9.4L13 7.6" stroke={straw} strokeWidth="1.4" strokeLinecap="round" />
    </g>
  );
}

/** SHORT. Wooden water trough at waist height (SHORT camera): a long plank box on stubby feet, its top plane seen steeply
 *  from above with a wood rim round a dark inside and a pool of clear water in it, two iron bands with rivets round the
 *  planked front, the east end one step darker, a drip running down from one band. No shadow of its own beyond the
 *  ground blob. */
export function Trough() {
  const wood = "#9a6a3a", woodL = "#c08a52", woodD = "#6c4526", inner = "#4d3019", iron = "#3b3d46", ironL = "#6a6d78", water = "#5c8ea8", waterL = "#cfe6ef";
  const x = 7, y = 37, w = 42, h = 16, dx = 7, dy = 13;
  const P = (uu, v) => [r2(x + uu * w + v * dx), r2(y - v * dy)];
  const quad = (u0, v0, u1, v1) => polyD(P(u0, v0), P(u0, v1), P(u1, v1), P(u1, v0));
  return (
    <g>
      <GroundShadow cx={33} cy={57.2} rx={26} ry={3.4} />
      {/* feet, then the east end, top and front */}
      {[10, 38].map((fx) => <path key={fx} d={inkBox(fx, 51, 6, 6.4, 1, .2)} fill={woodD} {...OS} />)}
      <path d={slabSide(x, y, w, h, dx, dy)} fill={woodD} {...OS} />
      <path d={slabTop(x, y, w, dx, dy)} fill={woodL} {...OS} />
      <path d={quad(.045, .13, .955, .87)} {...IS} fill={inner} />
      <path d={quad(.07, .13, .93, .66)} {...IS} fill={water} />
      <path d={`M${P(.2, .4)}Q${P(.3, .46)} ${P(.42, .4)}M${P(.6, .3)}Q${P(.7, .36)} ${P(.8, .3)}`} stroke={waterL} strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <path d={inkBox(x, y, w, h, 1.4, .3)} fill={wood} {...OS} />
      <path d={`M${x} ${y + 5.4}H${x + w}M${x} ${y + 10.8}H${x + w}`} {...IS} />
      {[12.6, 39.4].map((bx) => (
        <g key={bx}>
          <path d={inkBox(bx, y - .4, 4.6, h + .8, 1, .2)} fill={iron} {...OS} />
          <path d={`M${bx + 2.3} ${y + 2.6}v.1M${bx + 2.3} ${y + h - 2.6}v.1`} stroke={ironL} strokeWidth="1.5" strokeLinecap="round" />
        </g>
      ))}
      <path d="M17.8 44.6V48.4" stroke={water} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M17.8 50.4v.1" stroke={water} strokeWidth="1.8" strokeLinecap="round" />
    </g>
  );
}

/* ---- BEACH (2): LIFEGUARD_CHAIR, TIKI_TORCH ---- */

/** TALL. Lifeguard tower chair, about 52 units tall: a whitewashed timber seat high on four splayed legs, climbed by a
 *  ladder in front, with a red cushion on the seat platform (its top and east side showing) and a tall backrest of white
 *  slats between two posts under a red top rail, with a red cross plate in the middle. The seat is exactly as wide as
 *  the backrest: its back edge runs from post to post, so the backrest sits centred on it. Cream wood with red accents,
 *  so it reads on sand and boardwalk. Front-end only. */
export function LifeguardChair() {
  const wood = "#efe9d8", woodL = "#fbf8ee", woodD = "#b9b09a", red = "#c83e3b";
  const sx = 13, sw = 34, sd = 4; // seat front edge x 13..47 at y 28; its back edge (x 17..51) lines up with the posts
  const leg = (x, sg) => polyD([x, 31.4], [x + 4, 31.4], [x + 4 + sg * 1.6, 57], [x + sg * 1.6, 57]);
  const rungs = [[37.2, 24.6, 36.4], [43.4, 23.2, 37.8], [49.6, 21.8, 39.2]];
  return (
    <g>
      <GroundShadow cx={32} cy={57.4} rx={23} ry={3.4} />
      {/* rear legs under the back corners, the back rail between them, the ladder */}
      {[sx + sd + .2, sx + sw + sd - 3.8].map((x) => <path key={x} d={inkBox(x, 25, 3.6, 27, .6, .2)} fill={woodD} {...OS} />)}
      <path d={inkBox(sx + sd, 40.6, sw, 3.2, .6, .2)} fill={woodD} {...OS} />
      <path d={polyD([22.6, 31.6], [25.2, 31.6], [23.8, 57], [20.6, 57])} fill={wood} {...OS} />
      <path d={polyD([34.8, 31.6], [37.4, 31.6], [39.4, 57], [36.2, 57])} fill={wood} {...OS} />
      {rungs.map(([y, xa, xb]) => <path key={y} d={`M${xa} ${y}H${xb}`} stroke={INK} strokeWidth="2.6" strokeLinecap="round" />)}
      {rungs.map(([y, xa, xb]) => <path key={`w${y}`} d={`M${xa} ${y}H${xb}`} stroke={wood} strokeWidth="1.1" strokeLinecap="round" />)}
      {/* front legs under the front corners */}
      <path d={leg(sx, -1)} fill={wood} {...OS} />
      <path d={leg(sx + sw - 4, 1)} fill={wood} {...OS} />
      {/* backrest: posts on the seat's back corners, slats and the cross plate, a red top rail */}
      {[sx + sd, sx + sw + sd - 3.6].map((x, i) => <path key={x} d={inkBox(x, 6, 3.6, 19, .6, .2)} fill={i ? woodD : wood} {...OS} />)}
      <path d={inkBox(sx + sd + 3.6, 8.6, sw - 7.2, 15, .6, .2)} fill={wood} {...OS} />
      <path d="M22 12.2H46M22 16.2H46M22 20.2H46" {...IS} />
      <path d={inkBox(sx + sd - 1.2, 3.4, sw + 2.4, 3.8, .8, .2)} fill={red} {...OS} />
      <path d="M32.6 11.4H35.4V14.4H38.4V17.2H35.4V20.2H32.6V17.2H29.6V14.4H32.6Z" {...IS} fill={red} />
      {/* seat platform: east side, top, red cushion, front board */}
      <path d={slabSide(sx, 28, sw, 4.4, sd, sd)} fill={woodD} {...OS} />
      <path d={slabTop(sx, 28, sw, sd, sd)} fill={woodL} {...OS} />
      <path d={slabTop(sx + 3, 27.4, sw - 6, 2.6, 2.6)} {...IS} fill={red} />
      <path d={inkBox(sx, 28, sw, 4.4, .8, .2)} fill={wood} {...OS} />
      <path d={`M${sx + 2.6} 30.2H${sx + sw - 2.6}`} stroke={red} strokeWidth="1.1" strokeLinecap="round" />
    </g>
  );
}

/** SHORT. Tiki torch at waist height, about 26 units to the cup: a bamboo pole with two node rings, shaded on its east
 *  half, planted in a low sand mound, topped by a flared coconut-brown cup lashed on with rope, whose mouth shows dark
 *  coals and a lit flame (orange with a yellow core) rising from it. */
export function TikiTorch() {
  const cane = "#cdaa5c", caneD = "#9c7a3a", cup = "#7a4c2c", cupD = "#4f301b", coal = "#2b1a10", rope = "#ece0bd", fire = "#f08a2a", fireL = "#f8cf55", sand = "#d9bd7e";
  const flame = "M26.6 30.2C23.6 25 28.6 23 27.8 18C30.6 19.8 31.2 17.6 31.4 13.6C33.6 17.2 37.4 18.8 36.6 23.8C39.2 25.6 38.8 28.8 37.6 30.2Q32 32.4 26.6 30.2Z";
  return (
    <g>
      <GroundShadow cx={33} cy={57.4} rx={13} ry={3} />
      <path d="M22.6 57.6Q24 54.6 32 54.6Q40 54.6 41.4 57.6Q32 59.4 22.6 57.6Z" fill={sand} {...OS} />
      {/* bamboo pole: east half shaded, two node rings */}
      <path d={inkBox(29.2, 36, 5.6, 20, 1.6, .3)} fill={cane} {...OS} />
      <path d="M32.8 37.4V54.8" stroke={caneD} strokeWidth="2" strokeLinecap="round" />
      <path d="M28.4 44.6H35.6M28.4 51H35.6" {...IS} strokeWidth="1.1" />
      {/* the cup: flared bowl, shaded east third, rope lashing, dark mouth */}
      <path d="M22.8 30.4H41.2L38.6 38.2Q32 40.6 25.4 38.2Z" fill={cup} {...OS} />
      <path d="M36.4 31.4H40.4L38 38.6Q36.8 39 35.8 39.2Z" fill={cupD} />
      <path d="M24 33.8Q32 36.6 40 33.8" fill="none" stroke={rope} strokeWidth="1.7" strokeLinecap="round" />
      <path d={inkBox(28.4, 38.4, 7.2, 2.8, 1.1, .2)} fill={rope} {...OS} />
      <ellipse cx="32" cy="30.4" rx="9.2" ry="2.7" fill={coal} {...OS} />
      {/* flame */}
      <path d={flame} fill={fire} {...OS} />
      <path d="M29.6 29.8C28 26.8 31 25.4 31.4 22.2C33.6 24.2 35.2 26.6 34.2 29.8Q31.8 30.8 29.6 29.8Z" fill={fireL} />
    </g>
  );
}

/* ---- FOREST (2): TOTEM, WOODPILE ---- */

/** TALL. Carved totem pole, about 53 units tall and so clearly taller than a person: a round pole on a stone foot, stacked
 *  eagle (red, hooked yellow beak, wings spread wide to both sides), frog (teal, wide mouth, bulging eyes) and bear
 *  (brown, tan muzzle, round ears), each with its east third a shade darker. */
export function Totem() {
  const u = useUid();
  const red = "#c2453b", redD = "#8c2a25", teal = "#2f8f83", tealD = "#1f655c", brown = "#8b5a2b", brownD = "#5f3c1c", cream = "#f3e7c8", gold = "#f2c14e", tan = "#c79a6a";
  const pole = "M22 12Q22 5.4 32 5.4Q42 5.4 42 12V54.6H22Z";
  const eye = (cx, cy, r) => (
    <g><circle cx={cx} cy={cy} r={r} {...IS} fill="#fbf7ea" /><circle cx={cx + .3} cy={cy + .3} r={r * .48} fill={INK} /></g>
  );
  // wing on the west (mirrored for the east)
  const wingW = "M23 10L12.4 6.4L3.4 10.6L8 12.4L2.4 18.4L8.6 19L4.2 26.4L11.6 25L23 24.6Z";
  const wingE = "M41 10L51.6 6.4L60.6 10.6L56 12.4L61.6 18.4L55.4 19L59.8 26.4L52.4 25L41 24.6Z";
  return (
    <g>
      <defs><clipPath id={`${u}p`}><path d={pole} /></clipPath></defs>
      <GroundShadow cx={32} cy={57.6} rx={24} ry={3.6} />
      {/* wings, behind the pole */}
      <path d={wingW} fill={red} {...OS} />
      <path d={wingE} fill={redD} {...OS} />
      <path d="M22.6 14.6L9.4 12.8M22.6 19L8.4 20.4M22.6 22.6L10 24.4" {...IS} />
      <path d="M41.4 14.6L54.6 12.8M41.4 19L55.6 20.4M41.4 22.6L54 24.4" {...IS} />
      <path d="M7.4 12.2L4.6 15.6M6.6 20L8.6 23.4M56.6 12.2L59.4 15.6M57.4 20L55.4 23.4" stroke={cream} strokeWidth="1.3" strokeLinecap="round" />
      {/* the pole: three coloured sections, each with a darker east third */}
      <path d={pole} fill={red} />
      <g clipPath={`url(#${u}p)`}>
        <rect x="22" y="26" width="20" height="14.4" fill={teal} />
        <rect x="22" y="40.4" width="20" height="15" fill={brown} />
        <rect x="36.6" y="0" width="6" height="26" fill={redD} />
        <rect x="36.6" y="26" width="6" height="14.4" fill={tealD} />
        <rect x="36.6" y="40.4" width="6" height="15" fill={brownD} />
      </g>
      <path d="M22 26Q32 27.8 42 26M22 40.4Q32 42.2 42 40.4" {...IS} />
      {/* eagle: brow, eyes, hooked beak, feather ticks */}
      <path d="M25.4 8.8L30.4 10.2M38.6 8.8L33.6 10.2" {...IS} strokeWidth="1.2" />
      {eye(28, 12, 2.3)}{eye(36, 12, 2.3)}
      <path d="M29 14.2H35L33.2 22Q32.4 23.2 31.4 22.2Z" {...IS} fill={gold} strokeWidth="1.2" />
      <path d="M24.4 17.6Q26 19 27.2 18.2M24.4 21.4Q26 22.8 27.2 22M36.8 18.2Q38 19 39.6 17.6M36.8 22Q38 22.8 39.6 21.4" {...IS} strokeOpacity=".6" />
      {/* frog: bulging eyes, nostrils, a wide mouth */}
      {eye(27.4, 30.4, 3)}{eye(36.6, 30.4, 3)}
      <path d="M30.6 33.6h.1M33.4 33.6h.1" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M23.6 35.2Q32 40.8 40.4 35.2" {...IS} strokeWidth="1.5" />
      {/* bear: round ears, eyes, tan muzzle, nose and mouth, cream face paint */}
      {[[24.4, 43], [39.6, 43]].map(([x, y]) => <g key={x}><circle cx={x} cy={y} r="3" fill={x < 32 ? brown : brownD} {...OS} strokeWidth="1.2" /><circle cx={x} cy={y} r="1.2" fill={x < 32 ? brownD : INK} /></g>)}
      <path d="M23.4 46H26.6M37.4 46H40.6" stroke={cream} strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="28.2" cy="45.4" r="1.4" fill={INK} /><circle cx="35.8" cy="45.4" r="1.4" fill={INK} />
      <ellipse cx="32" cy="49.6" rx="5.6" ry="3.4" {...IS} fill={tan} />
      <ellipse cx="32" cy="47.8" rx="2.2" ry="1.3" fill={INK} />
      <path d="M32 49V51M29.6 51.2Q32 52.8 34.4 51.2" {...IS} />
      <path d={pole} fill="none" {...OS} />
      {/* stone foot */}
      <path d={inkBox(17.6, 54, 28.8, 4.4, 1.6, .3)} fill="#9aa0a8" {...OS} />
      <path d="M39.4 54H44.6Q46.4 54 46.4 55.6V56.8Q46.4 58.4 44.6 58.4H39.4Z" fill="#747a82" />
      <path d={inkBox(17.6, 54, 28.8, 4.4, 1.6, .3)} fill="none" {...OS} />
      <path d="M29 54V58.4" {...IS} />
    </g>
  );
}

/** TALL. Woodpile stacked above head height under a small lean-to, clearly taller than a person (board camera, depth up
 *  and to the east): two timber posts carry a plank roof, and between them six rows of split logs are
 *  stacked end-on to the eaves, each end a cut disc with its bark rim and growth rings (a few split through), the log bodies
 *  running back up-right on the east side. A few loose splits lie at the foot. */
export function Woodpile() {
  const bark = "#7b5535", barkD = "#4f3520", cut = "#e0b982", cutD = "#cf9f63", ring = "#a97b44";
  const post = "#6a4428", postD = "#4a2f1b", roof = "#8a6440", roofL = "#b08657";
  const r = 4.2, dx = 4, dy = 4;
  // six rows from the floor to the eaves; even rows hold five rounds, odd rows four, offset half a log
  const logs = [];
  for (let ri = 0; ri < 6; ri++) {
    const y = r2(52.6 - ri * 7.3), n = ri % 2 ? 4 : 5, x0 = ri % 2 ? 15.4 + r : 11.2 + r;
    for (let i = 0; i < n; i++) logs.push({ x: r2(x0 + i * 2 * r), y, ri, i, k: logs.length });
  }
  const split = new Set([2, 8, 11, 16, 19, 24]); // rounds split through: a dark crack across the cut face
  const body = (l, w, c) => <path key={`${c}${l.k}`} d={`M${l.x} ${l.y}L${r2(l.x + dx)} ${r2(l.y - dy)}`} stroke={c} strokeWidth={w} strokeLinecap="round" />;
  return (
    <g>
      <GroundShadow cx={33} cy={57.4} rx={28} ry={3.8} />
      {/* back posts, then the log bodies receding up-right behind their ends */}
      <path d={inkBox(55.4, 6, 3.6, 47.4, .8, .2)} fill={postD} {...OS} />
      {logs.map((l) => body(l, 2 * r + 3, INK))}
      {logs.map((l) => body(l, 2 * r, bark))}
      {logs.filter((l) => l.i === (l.ri % 2 ? 3 : 4)).map((l) => <path key={`e${l.k}`} d={`M${r2(l.x + 2.6)} ${r2(l.y + 2.4)}L${r2(l.x + dx + 2.6)} ${r2(l.y - dy + 2.4)}`} stroke={barkD} strokeWidth="2" strokeLinecap="round" />)}
      {/* the cut ends */}
      {logs.map((l) => (
        <g key={l.k}>
          <circle cx={l.x} cy={l.y} r={r} fill={bark} {...OS} />
          <circle cx={l.x} cy={l.y} r={r - 1.2} fill={l.k % 3 === 1 ? cutD : cut} />
          {split.has(l.k)
            ? <path d={`M${r2(l.x - 2.6)} ${r2(l.y - 1.8)}L${r2(l.x + .4)} ${r2(l.y + .2)}L${r2(l.x + 2.6)} ${r2(l.y + 2)}`} {...IS} strokeWidth="1.1" />
            : <circle cx={l.x} cy={l.y} r={r * .45} {...IS} stroke={ring} strokeWidth=".7" />}
        </g>
      ))}
      {/* front posts */}
      <path d={inkBox(6.4, 9, 4.4, 48.4, .9, .2)} fill={post} {...OS} />
      <path d={inkBox(51.4, 9, 4.4, 48.4, .9, .2)} fill={post} {...OS} />
      <path d="M8 14V54M53 14V54" stroke={roofL} strokeWidth=".9" strokeLinecap="round" strokeOpacity=".7" />
      {/* lean-to roof: plank fascia, the top plane receding up-right with its plank seams */}
      <path d={slabTop(3.4, 9.6, 55, dx + 1, dy + 1)} fill={roofL} {...OS} />
      <path d="M17 9.6L21.2 4.6M31 9.6L35.2 4.6M45 9.6L49.2 4.6" {...IS} strokeOpacity=".6" />
      <path d={inkBox(3.4, 9.6, 55, 4.4, .8, .2)} fill={roof} {...OS} />
      <path d="M17 9.6V14M31 9.6V14M45 9.6V14" {...IS} />
      {/* loose splits at the foot */}
      <path d="M2.4 57.6L4.6 52.8L9.4 54.4L8.4 58Z" fill={cut} {...OS} strokeWidth="1.2" />
      <path d="M56 58L58.4 53.4L62.6 55.4L61.4 58.4Z" fill={cutD} {...OS} strokeWidth="1.2" />
    </g>
  );
}

/* ---- DESERT (2): SANDSTONE_ARCH ---- */

/** TALL. Natural sandstone arch with real volume, about 55 units tall (board camera, depth up and to the east): two
 *  rounded pillars, undercut where the wind has worn them near the foot, joined by a span, with a clear opening down to
 *  the floor. The rock is extruded back: the top of the span and the shoulders show as lit top planes, the east faces of
 *  both pillars (and the inner face of the west pillar, seen through the opening) a shade darker, and the strata bands
 *  (pale cap, sandstone, rust, pale, sandstone, rust) wrap from the front round onto those faces. On the front, each
 *  pillar is lit on its west edge and shaded on its east edge, and the underside of the span is shaded. Cracks, sand
 *  drifted at both feet, a flat GroundShadow. */
let ARCH_GEO = null; // built on first use (polyD is declared further down the file)
const archGeo = () => ARCH_GEO || (ARCH_GEO = (() => {
  const F = [[5, 57.6], [7, 52], [6.2, 46], [3.8, 39], [3.8, 31], [6.4, 23], [11, 16.4], [17, 11.8], [24.4, 9], [32.4, 8.2], [40, 9.4],
    [46, 12.8], [50.4, 18], [52.8, 24.4], [53.8, 31], [54, 38], [52, 45], [51.2, 51], [53, 57.6], [41.2, 57.6], [42.2, 52], [41.8, 45],
    [40.2, 37.4], [37, 31.8], [32.2, 29.6], [27, 30.6], [22.6, 34.2], [20, 40], [19.6, 46], [20.8, 52], [19.4, 57.6]];
  const D = [5.4, -5.4];
  // strata by front-face height: [from y, to y, front, top plane, east face]
  const bands = [[-9, 17, "#efcb90", "#f7e0b4", "#c99a5c"], [17, 24, "#d9a366", "#ebc189", "#a87443"], [24, 30, "#c4864f", "#d9a16b", "#93603a"],
    [30, 40, "#e6bb80", "#f1d1a0", "#b48853"], [40, 48, "#d9a366", "#ebc189", "#a87443"], [48, 70, "#c4864f", "#d9a16b", "#93603a"]];
  const area = F.reduce((acc, p, i) => { const q = F[(i + 1) % F.length]; return acc + p[0] * q[1] - q[0] * p[1]; }, 0);
  const sgn = area > 0 ? 1 : -1; // outward normal of edge (dx, dy) is sgn * (dy, -dx)
  const faces = [];
  F.forEach((p, i) => {
    const q = F[(i + 1) % F.length], ex = q[0] - p[0], ey = q[1] - p[1], L = Math.hypot(ex, ey);
    const nx = (sgn * ey) / L, ny = (-sgn * ex) / L;
    if (nx * D[0] + ny * D[1] <= 0) return; // faces away: hidden behind the front
    const top = -ny > nx;
    // split the edge where it crosses a band boundary, so the strata wrap onto the face
    const cuts = [0, 1];
    for (const [y0] of bands) { const t = (y0 - p[1]) / (ey || 1e-9); if (ey && t > 0 && t < 1) cuts.push(t); }
    cuts.sort((m, n) => m - n);
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = [p[0] + ex * cuts[k], p[1] + ey * cuts[k]], b = [p[0] + ex * cuts[k + 1], p[1] + ey * cuts[k + 1]];
      const ym = (a[1] + b[1]) / 2, band = bands.find(([y0, y1]) => ym >= y0 && ym < y1) || bands[0];
      faces.push({ d: polyD(a, b, [b[0] + D[0], b[1] + D[1]], [a[0] + D[0], a[1] + D[1]]), fill: top ? band[3] : band[4] });
    }
  });
  return { front: polyD(...F), faces, bands };
})());
export function SandstoneArch() {
  const u = useUid();
  const { front, faces, bands } = archGeo();
  const intrados = "M19.4 57.6L20.8 52L19.6 46L20 40L22.6 34.2L27 30.6L32.2 29.6L37 31.8L40.2 37.4L41.8 45L42.2 52L41.2 57.6";
  return (
    <g>
      <defs><clipPath id={`${u}f`}><path d={front} /></clipPath></defs>
      <GroundShadow cx={34} cy={57.4} rx={30} ry={3.6} />
      {/* ink pass under the whole solid (the faces swept back, then the front), then the swept faces in their strata */}
      <g fill={INK} stroke={INK} strokeWidth="3" strokeLinejoin="round">
        {faces.map((f, i) => <path key={i} d={f.d} />)}
      </g>
      {faces.map((f, i) => <path key={i} d={f.d} fill={f.fill} stroke={f.fill} strokeWidth=".4" strokeLinejoin="round" />)}
      {/* the front face: strata, a lit west edge and a shaded east edge on each pillar, a shaded underside to the span */}
      <path d={front} fill={bands[1][2]} />
      <g clipPath={`url(#${u}f)`}>
        {bands.map(([y0, y1, c]) => <rect key={y0} x="0" y={y0} width="64" height={y1 - y0} fill={c} />)}
        <path d="M0 0H10L7 20L8.6 40L10.6 58H0Z" fill="#fff" fillOpacity=".22" />
        <path d="M42 40L44 48L43.6 58H41Z" fill="#fff" fillOpacity=".16" />
        <path d="M13.6 30C15.4 40 16.4 50 15.6 60H22V30Z" fill="#000" fillOpacity=".14" />
        <path d="M47.4 18C50 30 49.4 46 48 60H64V12Z" fill="#000" fillOpacity=".16" />
        <path d={intrados} fill="none" stroke="#000" strokeOpacity=".15" strokeWidth="5" strokeLinejoin="round" />
      </g>
      <path d={front} fill="none" {...OS} />
      {/* cracks */}
      <path d="M12 27L15.2 32.6L13.4 38M47 26.4L49.6 31L48 36M28.6 12.4L31 16.8M9.2 47.6L12 51" {...IS} />
      {/* sand drifted against both feet */}
      <path d="M1.4 58.2C2.8 54.6 7 53.8 10.4 55.2C13.8 54.2 17.6 55.4 18.8 58.2Z" fill="#ecd199" {...OS} strokeWidth="1.1" />
      <path d="M46 58.2C47.4 55.2 51.8 54.4 54.8 55.6C58 54.4 61.4 55.4 62.8 58.2Z" fill="#ecd199" {...OS} strokeWidth="1.1" />
    </g>
  );
}

/* ---- STREET (2): STREETLIGHT, NEWSSTAND ---- */

/** TALL. Classic cast-iron lamp post, from the floor to the top of the tile, clearly taller than a person: a round
 *  stepped foot on the ground over a flat GroundShadow, a fluted base column, a slim post with collars and a ladder
 *  bar with ball ends, and at the top a four-paned glass lantern (wider at the top) under a domed cap with a ball
 *  finial, a pale flat halo round the glass. Painted iron in dark green, the east side a shade darker. */
export function Streetlight() {
  const u = useUid();
  const iron = "#3d5f53", ironL = "#6a937f", glass = "#ffe9a8", glassL = "#fff6d6";
  const foot = "M23.4 52.6V55.8A8.6 2.4 0 0 0 40.6 55.8V52.6Z";
  const base = "M27.6 38.4L26.6 52.8A5.4 1.6 0 0 0 37.4 52.8L36.4 38.4Z";
  const post = "M30 17V39H34V17Z";
  const collars = "M28.6 36.4V39A3.4 1 0 0 0 35.4 39V36.4ZM29.2 22V24.2A2.8 .9 0 0 0 34.8 24.2V22ZM28.4 13.8V16.6A3.6 1.1 0 0 0 35.6 16.6V13.8Z";
  const lamp = "M24.8 5.6L27.8 13.8H36.2L39.2 5.6Z";
  const cap = "M23 6.2C25 5 27.4 2.6 28.6 1.4H35.4C36.6 2.6 39 5 41 6.2Q32 8 23 6.2Z";
  return (
    <g>
      <defs><clipPath id={`${u}s`}><path d={foot} /><path d={base} /><path d={post} /><path d={collars} /><path d={cap} /></clipPath></defs>
      <GroundShadow cx={33} cy={57.2} rx={14} ry={3} />
      <circle cx="32" cy="9.6" r="11.6" fill="#ffd27a" fillOpacity=".22" />
      <path d={foot} fill={iron} {...OS} />
      <ellipse cx="32" cy="52.6" rx="8.6" ry="2.4" fill={ironL} {...OS} />
      <path d={base} fill={iron} {...OS} />
      <path d="M30 41V51.6M32 41V52M34 41V51.6" {...IS} strokeOpacity=".6" />
      <path d={post} fill={iron} {...OS} />
      <path d={collars} fill={iron} {...OS} />
      {/* ladder bar with ball ends */}
      <path d="M24.4 19.4H39.6" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
      <path d="M24.4 19.4H39.6" stroke={iron} strokeWidth="1.6" strokeLinecap="round" />
      {[24.4, 39.6].map((x) => <circle key={x} cx={x} cy="19.4" r="1.5" fill={ironL} {...OS} strokeWidth="1.1" />)}
      {/* the lantern: glass panes, frame, cap and finial */}
      <path d={lamp} fill={glass} {...OS} />
      <path d="M30 6.2L31 13.4M34 6.2L33 13.4" {...IS} />
      <path d="M27.4 7L29.2 12.4" stroke={glassL} strokeWidth="1.4" strokeLinecap="round" />
      <path d={cap} fill={iron} {...OS} />
      <g clipPath={`url(#${u}s)`}><path d="M33.2 0H48V60H33.2Z" fill="#000" fillOpacity=".24" /></g>
      <path d="M26.4 5Q28 3.4 29.4 2.6" stroke={ironL} strokeWidth="1.1" strokeLinecap="round" fill="none" />
      <circle cx="32" cy="1.2" r="1.5" fill={ironL} {...OS} strokeWidth="1.1" />
      <path d="M31 18V36M31.4 44V52" stroke={ironL} strokeWidth=".9" strokeLinecap="round" strokeOpacity=".8" />
    </g>
  );
}

/** TALL. Street newsstand kiosk, clearly taller than a person: a teal cabin with a roof lintel, a cream sign strip, a
 *  crimson and cream striped scalloped awning over an open front window with racked magazines, a wooden counter with
 *  a stack of papers, a panelled base, and a poster on the darker east side. Tall. */
export function Newsstand() {
  const u = useUid();
  const body = "#3e6f88", bodyD = "#2b4f63", roofL = "#86b0c4", wood = "#a9783f", woodL = "#cc9f66", cream = "#efe6cf", red = "#c9423d";
  const x = 10, y = 14, w = 36, h = 42, d = 6;
  const mags = ["#d1453b", "#f0c14b", "#3f8fb0", "#f3eee0", "#7a5ab0", "#58a06a"];
  const sw = 38 / 6, bw = 44 / 6, ay = 19.4, by = 27.6; // awning: top edge x 9..47, bottom edge x 6..50, scalloped
  const stripes = Array.from({ length: 6 }, (_, i) => {
    const a = 9 + i * sw, b = a + sw, c = 6 + (i + 1) * bw, e = 6 + i * bw;
    return { d: `M${r2(a)} ${ay}H${r2(b)}L${r2(c)} ${by}Q${r2((c + e) / 2)} ${by + 2.8} ${r2(e)} ${by}Z`, k: i };
  });
  const scallops = Array.from({ length: 6 }, (_, i) => { const c = 6 + (i + 1) * bw, e = 6 + i * bw; return `Q${r2((c + e) / 2)} ${by + 2.8} ${r2(e)} ${by}`; }).reverse();
  const rim = `M9 ${ay}H47L50 ${by}${scallops.map((q, i) => (i === 0 ? q : q)).join("")}Z`;
  return (
    <g>
      <defs><clipPath id={`${u}w`}><rect x="13" y="30.4" width="30" height="13.6" /></clipPath></defs>
      <GroundShadow cx={33} cy={57} rx={24} ry={3.4} />
      {/* east side of the cabin and of the roof, with a poster on it */}
      <path d={slabSide(x, y, w, h, d, d)} fill={bodyD} {...OS} />
      <path d={polyD([47.4, 31], [50.6, 27.8], [50.6, 40.6], [47.4, 43.8])} {...IS} fill={cream} />
      <path d="M48 36.4L50 34.4M48 39.4L50 37.4" {...IS} />
      <path d={slabSide(8, 9, 40, 5, d, d)} fill={bodyD} {...OS} />
      {/* cabin front: base panels */}
      <path d={inkBox(x, y, w, h, 1, .3)} fill={body} {...OS} />
      <path d={inkBox(13, 49, 30, 5.4, .8, 0)} {...IS} fill={bodyD} />
      <path d="M23 49V54.4M33 49V54.4" {...IS} />
      {/* window: dark interior, two rows of magazines, then the counter */}
      <rect x="13" y="30.4" width="30" height="13.6" {...IS} fill="#15181f" />
      <g clipPath={`url(#${u}w)`}>
        {[0, 1].map((r) => mags.map((c, i) => (
          <rect key={`${r}${i}`} x={14 + i * 4.8 + (r ? 2.4 : 0)} y={31.6 + r * 6} width="4.4" height="6.4" fill={c} stroke={INK} strokeWidth=".6" />
        )))}
      </g>
      <path d={slabTop(8, 44, 40, 3, 2.4)} fill={woodL} {...OS} />
      <path d={inkBox(8, 44, 40, 4, .8, .2)} fill={wood} {...OS} />
      <path d={inkBox(31, 40.4, 10, 3.6, .6, 0)} {...IS} fill={cream} />
      <path d="M32.6 42.2H39.6" {...IS} strokeOpacity=".7" />
      {/* striped awning, scalloped */}
      {stripes.map((s) => <path key={s.k} d={s.d} {...IS} fill={s.k % 2 ? cream : red} />)}
      <path d={rim} fill="none" {...OS} />
      {/* sign strip in the lintel, roof lintel and roof top */}
      <path d={inkBox(13, 15, 30, 3.4, .8, 0)} {...IS} fill={cream} />
      <path d="M16 16.7H40" stroke={red} strokeWidth="1.1" strokeDasharray="3 1.8" />
      <path d={slabTop(8, 9, 40, d, d)} fill={roofL} {...OS} />
      <path d={inkBox(8, 9, 40, 5, 1, .3)} fill={body} {...OS} />
    </g>
  );
}

/* ---- UNIVERSAL (2): TRAPDOOR, FOOTPRINTS, BROKEN_GLASS, LANTERN ---- */

/** LOW. Trapdoor set flush in the floor, seen from above (art/STYLE.md, LOW props): a dark sunken frame round a hatch of
 *  four oak planks (alternate planks a shade darker), two iron strap hinges running in from the north edge with rivets,
 *  and an iron ring pull near the south-east corner, where it stays clear of a token standing on the hatch. No shadow. */
export function Trapdoor() {
  const frame = "#4a3423", oak = "#a07a4a", oakD = "#86643a", iron = "#4b4e58", ironL = "#a9aeb6";
  const x0 = 10, x1 = 54, y0 = 10, y1 = 54, pw = (x1 - x0) / 4;
  return (
    <g>
      <path d={inkBox(6, 6, 52, 52, 2.6, .4)} fill={frame} {...OS} />
      {[0, 1, 2, 3].map((i) => <rect key={i} x={x0 + i * pw} y={y0} width={pw} height={y1 - y0} fill={i % 2 ? oakD : oak} />)}
      <path d={`M${x0 + pw} ${y0}V${y1}M${x0 + 2 * pw} ${y0}V${y1}M${x0 + 3 * pw} ${y0}V${y1}`} {...IS} />
      <path d="M17 24.6L19.4 27.4M38.6 37L40.4 40.4M47.4 21.6L49 24.2" {...IS} strokeOpacity=".5" />
      <path d={inkBox(x0, y0, x1 - x0, y1 - y0, 1, .2)} fill="none" {...OS} />
      {/* two strap hinges: a knuckle on the frame, a long iron strap tapering south across the planks */}
      {[18, 46].map((cx) => (
        <g key={cx}>
          <path d={`M${cx - 2.6} 11V40.4L${cx} 43.4L${cx + 2.6} 40.4V11Z`} {...IS} fill={iron} />
          <rect x={cx - 4.6} y="5.4" width="9.2" height="6.6" rx="1.6" {...IS} fill={iron} />
          {[17, 27, 37].map((ry) => <circle key={ry} cx={cx} cy={ry} r=".95" fill={ironL} />)}
        </g>
      ))}
      {/* ring pull on a plate */}
      <circle cx="45" cy="49.6" r="2" {...IS} fill={iron} />
      <circle cx="45" cy="53.4" r="3.2" fill="none" stroke={INK} strokeWidth="3" />
      <circle cx="45" cy="53.4" r="3.2" fill="none" stroke={ironL} strokeWidth="1.2" />
    </g>
  );
}

/** LOW. Trail of muddy boot prints, a top-down footprint flush with the floor (art/STYLE.md, LOW props): left and right
 *  soles with separate heels, inked in OS with darker tread bars, walking in step. One trail per span: on one tile it
 *  crosses corner to corner, along a row it walks east, down a column it walks north, with a slight sway, so prints
 *  show round a token on any cell. A few mud specks. No shadow. */
export function FootprintsSpan({ cw = 1, ch = 1 }) {
  const mud = "#6e4c31", mudD = "#4a3120";
  const W = 64 * cw, H = 64 * ch, step = 13.4, side = 3.4;
  // trail centreline from a to b
  const [a, b] = cw === ch ? [[6, H - 6], [W - 6, 6]] : cw > ch ? [[8, H / 2 + 2], [W - 8, H / 2 - 2]] : [[W / 2 - 2, H - 8], [W / 2 + 2, 8]];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy, ny = ux;
  const n = Math.floor(L / step), off = (L - (n - 1) * step) / 2, deg = (Math.atan2(uy, ux) * 180) / Math.PI + 90;
  const prints = Array.from({ length: n }, (_, i) => {
    const s = off + i * step, sw = cw === ch ? 0 : 2.4 * Math.sin((s / 64) * Math.PI), k = (i % 2 ? 1 : -1) * side + sw;
    return [r2(a[0] + ux * s + nx * k), r2(a[1] + uy * s + ny * k), i % 2, r2(deg + (i % 3 - 1) * 4)];
  });
  const specks = scatter(3 * Math.max(cw, ch), 7 + cw * 3 + ch, 4, 4, W - 4, H - 4);
  return (
    <g>
      {specks.map(([x, y], i) => <circle key={`s${i}`} cx={x} cy={y} r={i % 2 ? .9 : 1.3} fill={mud} />)}
      {prints.map(([x, y, right, rot], i) => (
        <g key={i} transform={`translate(${x} ${y}) rotate(${rot})${right ? " scale(-1 1)" : ""} scale(.64)`}>
          <path d="M-4.2 -9.4C-6.4 -5 -5.8 1 -3.8 3.2H3.6C5.2 1 5.8 -5.4 4 -9.6C2.4 -12.6 -2.4 -12.4 -4.2 -9.4Z" fill={mud} {...OS} strokeWidth={1.5 / .64} />
          <path d="M-3.4 6H3.4V10.4Q0 12.4 -3.4 10.4Z" fill={mud} {...OS} strokeWidth={1.5 / .64} />
          <path d="M-2.8 -7H2.6M-3.4 -3.4H3.4M-3 0H3" stroke={mudD} strokeWidth="1.6" strokeLinecap="round" />
        </g>
      ))}
    </g>
  );
}
export const Footprints = () => <FootprintsSpan cw={1} ch={1} />;

/** LOW. Broken glass, a top-down footprint flush with the floor (art/STYLE.md, LOW props): a scatter of pale glass
 *  shards round a smashed spot, big ones out toward the tile's edges and corners so they show round a token, small
 *  splinters between; shards inked in OS, every third one a shade darker, white glints on the largest. No shadow. */
export function BrokenGlass() {
  const glass = "#d6eef4", glassD = "#9fc8d4";
  const shards = [
    [[5.6, 15], [12.4, 8.4], [18.6, 10.6], [13.4, 20.6]], [[24.6, 6.4], [37, 3.6], [33.4, 9.4], [28.6, 13.4]], [[45, 7.4], [52.6, 6.6], [58, 14.6], [50.2, 17.6]],
    [[4.6, 30.4], [12.6, 26.4], [14.4, 31.4], [9.4, 41]], [[52.6, 26], [59.4, 30.4], [57.6, 39.6], [51.4, 35.4]], [[7.4, 50.4], [16.4, 45.4], [20.6, 50.4], [13.4, 58.4]],
    [[29.4, 56.4], [36.4, 50.4], [42.6, 54], [38.6, 60.2]], [[47, 48.6], [56.4, 45.4], [58.4, 51], [51.6, 58.6]],
    [[27.6, 27.4], [32.6, 24.8], [31.4, 31.4]], [[38.4, 35.4], [44, 37], [39.4, 41.4]], [[19.6, 36.6], [24.6, 33.6], [23.4, 39.4]],
    [[20.6, 22.4], [26.4, 18.6], [22.4, 23.6]], [[40.6, 21], [46.6, 22.4], [41, 23.4]], [[26, 45], [33, 43.4], [27, 46.6]],
  ];
  return (
    <g>
      {shards.map((p, i) => <path key={i} d={polyD(...p)} fill={i % 3 === 2 ? glassD : glass} {...OS} />)}
      <path d="M9 14.2L12.6 10.8M27.4 7.6L33.6 5.6M7.8 32L11.6 29.4M11.6 50.4L15.8 48M49.6 49.4L55 47.6" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" />
    </g>
  );
}

/** SHORT. Hurricane lantern standing on the ground (SHORT camera, steep oblique): a brass fuel tank, a glass globe with
 *  the flame behind two guard wires, an iron cap with a vent and a wire bail handle, side rods shaded on the east. It
 *  stands in a flat warm pool of its own light. Well below a person: ankle-to-knee height, sight passes over. */
export function Lantern() {
  const brass = "#c8963c", brassD = "#94692a", iron = "#3a3d48", ironL = "#5a5e6c", glass = "#ffe8b0", flame = "#ff9a2e", core = "#fff3c4";
  const cx = 32, k = .36;
  const tank = `M${cx - 10} 47.6V53.6A10 ${10 * k} 0 0 0 ${cx + 10} 53.6V47.6Z`;
  const globe = `M${cx - 5.6} 47C${cx - 9.6} 43.6 ${cx - 9.6} 36.8 ${cx - 5} 32.6H${cx + 5}C${cx + 9.6} 36.8 ${cx + 9.6} 43.6 ${cx + 5.6} 47Z`;
  return (
    <g>
      <ellipse cx="32" cy="54" rx="27" ry="8.6" fill="#ffcf6a" fillOpacity=".3" />
      <GroundShadow cx={33} cy={55.4} rx={12} ry={2.8} />
      {/* fuel tank: front, shaded east third, lid */}
      <path d={tank} fill={brass} {...OS} />
      <path d={`M${cx + 4} 47.6V${r2(53.6 + 10 * k * .9)}A10 ${10 * k} 0 0 0 ${cx + 10} 53.6V47.6Z`} fill={brassD} />
      <path d={tank} fill="none" {...OS} />
      <ellipse cx={cx} cy="47.6" rx="10" ry={10 * k} fill="#ddb05a" {...OS} />
      {/* globe with the flame and guard wires */}
      <path d={globe} fill={glass} {...OS} />
      <path d={`M${cx + 3.6} 33.2C${cx + 7.6} 37 ${cx + 7.6} 43.4 ${cx + 4.6} 46.4`} fill="none" stroke="#f2c56e" strokeWidth="2.4" strokeLinecap="round" />
      <path d={`M${cx} 45.6C${cx - 3.2} 43.4 ${cx - 2.8} 39.6 ${cx} 35.6C${cx + 2.8} 39.6 ${cx + 3.2} 43.4 ${cx} 45.6Z`} fill={flame} />
      <path d={`M${cx} 44.6C${cx - 1.4} 43.4 ${cx - 1.2} 41.6 ${cx} 39.4C${cx + 1.2} 41.6 ${cx + 1.4} 43.4 ${cx} 44.6Z`} fill={core} />
      <path d={`M${cx - 3} 32.8C${cx - 5.4} 37 ${cx - 5.4} 43 ${cx - 3} 47M${cx + 3} 32.8C${cx + 5.4} 37 ${cx + 5.4} 43 ${cx + 3} 47M${cx - 8.6} 40.4H${cx + 8.6}`} {...IS} />
      {/* side rods from tank to cap */}
      {[-9, 9].map((dx) => <path key={dx} d={`M${cx + dx} 47V31`} stroke={INK} strokeWidth="3" strokeLinecap="round" />)}
      {[-9, 9].map((dx) => <path key={`r${dx}`} d={`M${cx + dx} 47V31`} stroke={dx > 0 ? iron : ironL} strokeWidth="1.2" strokeLinecap="round" />)}
      {/* cap, vent and bail handle */}
      <path d={`M${cx} 18.6C${cx - 7} 18.6 ${cx - 9.4} 24 ${cx - 9.4} 30.6`} fill="none" stroke={INK} strokeWidth="1.5" />
      <path d={`M${cx} 18.6C${cx + 7} 18.6 ${cx + 9.4} 24 ${cx + 9.4} 30.6`} fill="none" stroke={INK} strokeWidth="1.5" />
      <path d={`M${cx - 10} 31.4Q${cx - 8} 25.6 ${cx} 25.4Q${cx + 8} 25.6 ${cx + 10} 31.4A10 ${10 * k} 0 0 1 ${cx - 10} 31.4Z`} fill={ironL} {...OS} />
      <path d={`M${cx + 2} 25.6Q${cx + 8} 26 ${cx + 10} 31.4A10 ${10 * k} 0 0 1 ${cx + 4} 34.6Z`} fill={iron} />
      <path d={`M${cx - 10} 31.4Q${cx - 8} 25.6 ${cx} 25.4Q${cx + 8} 25.6 ${cx + 10} 31.4A10 ${10 * k} 0 0 1 ${cx - 10} 31.4Z`} fill="none" {...OS} />
      <path d={`M${cx - 3} 25.8V23.2H${cx + 3}V25.8`} {...IS} fill={ironL} />
    </g>
  );
}

/* ---- MANSION (3): CUSHION, CARPET_RUNNER, FLOOR_GRATE ---- */

/** LOW. Floor cushion, a plump square pillow seen from above, flush with the floor, no shadow: a teal cover with pinched
 *  corners and bowed sides, a darker lower-right (one shade step), a cream piping line inset from the edge, four creases
 *  running from a central button out to the corners, a pale highlight at the upper left and a brass tassel on a cord at
 *  each corner. The button is small and dark so a seated token on it reads. */
export function Cushion() {
  const u = useUid();
  const teal = "#3f8c8a", tealD = "#2c6a6c", tealL = "#74b8b1", cream = "#efe3c4", brass = "#d9a441";
  const body = "M13 14Q32 8 51 14Q57 32 51 50Q32 56 13 50Q7 32 13 14Z";
  return (
    <g>
      {/* corner tassels: a cord out to the diagonal and a brass tuft */}
      {[[12, 13, -1, -1], [52, 13, 1, -1], [12, 51, -1, 1], [52, 51, 1, 1]].map(([x, y, sx, sy], i) => (
        <g key={i}>
          <path d={`M${x} ${y}L${x + sx * 4.4} ${y + sy * 4.4}`} stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
          <path d={`M${x} ${y}L${x + sx * 4.4} ${y + sy * 4.4}`} stroke={brass} strokeWidth="1.1" strokeLinecap="round" />
          <circle cx={x + sx * 5.6} cy={y + sy * 5.6} r="2.5" {...IS} fill={brass} />
        </g>
      ))}
      <defs><clipPath id={`${u}c`}><path d={body} /></clipPath></defs>
      <path d={body} fill={teal} />
      <g clipPath={`url(#${u}c)`}><path d="M12 64L64 12V64Z" fill={tealD} /></g>
      <path d="M17.4 18.4Q32 14 46.6 18.4Q50.8 32 46.6 45.6Q32 50 17.4 45.6Q13.2 32 17.4 18.4Z" fill="none" stroke={cream} strokeWidth="1.2" />
      <path d="M32 32Q25 26 18 19M32 32Q39 26 46 19M32 32Q25 38 18 45M32 32Q39 38 46 45" {...IS} />
      <path d="M17 24Q18.6 19.6 23 18.2" fill="none" stroke={tealL} strokeWidth="1.8" strokeLinecap="round" />
      <path d={body} fill="none" {...OS} />
      <circle cx="32" cy="32" r="2.4" {...IS} fill={tealD} />
    </g>
  );
}

/** The tiles of a carpet runner in walking order, as [row, col] offsets from the span's top-left cell. With `cells` (the
 *  board passes the object's tiles) the runner follows them, so an L that turns one corner works; without them, or if
 *  the tiles do not make a simple path, it is a straight strip along the span (down a column when ch > cw). */
export function runnerPath(cells, cw = 1, ch = 1) {
  const straight = () => Array.from({ length: Math.max(cw, ch) }, (_, i) => (ch > cw ? [i, 0] : [0, i]));
  if (!Array.isArray(cells) || cells.length < 2) return straight();
  const key = ([r, c]) => `${r},${c}`, set = new Map(cells.map((t) => [key(t), [t[0], t[1]]]));
  const nbrs = ([r, c]) => [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter((t) => set.has(key(t)));
  const ends = [...set.values()].filter((t) => nbrs(t).length === 1);
  if (ends.length !== 2) return straight();
  // start at the end nearest the top-left, so the walk is the same whichever order the tiles came in
  ends.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[0] - b[0]);
  const out = [ends[0]], seen = new Set([key(ends[0])]);
  while (out.length < set.size) {
    const next = nbrs(out[out.length - 1]).find((t) => !seen.has(key(t)));
    if (!next) return straight();
    out.push(next); seen.add(key(next));
  }
  return out;
}

/** LOW. Hall runner, one flat top-down strip across its whole span, no shadow: a straight strip (1 × 3, 3 × 1, 1 × 4,
 *  4 × 1, any length, down a column or along a row) or, when the board passes `cells`, a path that turns one corner (the
 *  L-shaped runners of 4 and 5 tiles). About half a tile wide so it reads as a runner and not a rug: a deep-green border
 *  and a green field with two thin gold lines, all running continuously round the corner with a mitred seam across the
 *  border; a cream and gold lozenge on every tile (laid along the run; a square medallion on the corner tile), a gold
 *  stud between tiles, and cream fringe at the two ends only. A single tile is drawn along a row. */
export function CarpetRunner({ cw = 1, ch = 1, cells }) {
  const border = "#2c5444", field = "#3f7059", gold = "#d9a441", cream = "#efe3c4";
  const path = runnerPath(cells, cw, ch);
  const C = path.map(([r, c]) => [32 + 64 * c, 32 + 64 * r]);
  const dirs = C.length > 1 ? C.slice(1).map((p, i) => [Math.sign(p[0] - C[i][0]), Math.sign(p[1] - C[i][1])]) : [[1, 0]];
  const d0 = dirs[0], d1 = dirs[dirs.length - 1], END = 23; // the runner ends 23 units past the end tiles' centres
  // centre line: the two ends and every corner
  const V = [[C[0][0] - d0[0] * END, C[0][1] - d0[1] * END]];
  const segDir = [d0];
  for (let i = 1; i < C.length - 1; i++) if (dirs[i][0] !== dirs[i - 1][0] || dirs[i][1] !== dirs[i - 1][1]) { V.push(C[i]); segDir.push(dirs[i]); }
  V.push([C[C.length - 1][0] + d1[0] * END, C[C.length - 1][1] + d1[1] * END]);
  const nrm = ([dx, dy]) => [-dy, dx];
  // a point offset sideways by `o` from vertex k of the centre line (corners take the mitre), the ends pulled in by `t`
  const off = (k, o, t = 0) => {
    const [x, y] = V[k], last = V.length - 1;
    if (k === 0) { const d = segDir[0], n = nrm(d); return [r2(x + n[0] * o + d[0] * t), r2(y + n[1] * o + d[1] * t)]; }
    if (k === last) { const d = segDir[last - 1], n = nrm(d); return [r2(x + n[0] * o - d[0] * t), r2(y + n[1] * o - d[1] * t)]; }
    const a = nrm(segDir[k - 1]), b = nrm(segDir[k]);
    return [r2(x + (a[0] + b[0]) * o), r2(y + (a[1] + b[1]) * o)];
  };
  const band = (w, t = 0) => polyD(...V.map((_, k) => off(k, w, t)), ...V.map((_, k) => off(k, -w, t)).reverse());
  const line = (o, t) => `M${V.map((_, k) => off(k, o, t).join(" ")).join("L")}`;
  const dia = ([cx, cy], [dx, dy], a, b) => (dx ? polyD([cx, cy - b], [cx + a, cy], [cx, cy + b], [cx - a, cy]) : polyD([cx - b, cy], [cx, cy + a], [cx + b, cy], [cx, cy - a]));
  const isCorner = (i) => i > 0 && i < C.length - 1 && (dirs[i][0] !== dirs[i - 1][0] || dirs[i][1] !== dirs[i - 1][1]);
  const tileDir = (i) => dirs[Math.min(i, dirs.length - 1)];
  const tufts = [[V[0], d0, -1], [V[V.length - 1], d1, 1]].map(([[x, y], d, s]) => {
    const n = nrm(d);
    return Array.from({ length: 7 }, (_, i) => -13 + (26 / 6) * i).map((o) => {
      const bx = x + n[0] * o, by = y + n[1] * o;
      return `M${r2(bx - s * d[0] * .5)} ${r2(by - s * d[1] * .5)}L${r2(bx + s * d[0] * 4)} ${r2(by + s * d[1] * 4)}`;
    }).join("");
  }).join("");
  return (
    <g>
      <path d={tufts} fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <path d={tufts} fill="none" stroke={cream} strokeWidth="1" strokeLinecap="round" />
      <path d={band(16)} fill={border} {...OS} />
      {/* mitred seams across the border at each corner */}
      {V.slice(1, -1).map((_, j) => <path key={j} d={`M${off(j + 1, 11).join(" ")}L${off(j + 1, 16).join(" ")}M${off(j + 1, -11).join(" ")}L${off(j + 1, -16).join(" ")}`} {...IS} strokeOpacity=".6" />)}
      <path d={band(11, 4)} {...IS} fill={field} />
      <path d={`${line(8.8, 6)}${line(-8.8, 6)}`} fill="none" stroke={gold} strokeWidth=".9" strokeLinejoin="miter" />
      {C.map((p, i) => (isCorner(i) ? (
        <g key={i}>
          <path d={dia(p, [1, 0], 9.6, 9.6)} {...IS} fill={gold} />
          <path d={dia(p, [1, 0], 6.2, 6.2)} {...IS} fill={cream} />
          <path d={dia(p, [1, 0], 2.6, 2.6)} {...IS} fill={border} />
        </g>
      ) : (
        <g key={i}>
          <path d={dia(p, tileDir(i), 15, 7.4)} {...IS} fill={gold} />
          <path d={dia(p, tileDir(i), 10.4, 4.6)} {...IS} fill={cream} />
          <path d={dia(p, tileDir(i), 4.6, 2.2)} {...IS} fill={border} />
        </g>
      )))}
      {C.slice(1).map((p, i) => <circle key={i} cx={(p[0] + C[i][0]) / 2} cy={(p[1] + C[i][1]) / 2} r="2" {...IS} fill={gold} />)}
    </g>
  );
}

/** LOW. Floor grate, a flat top-down iron grating set in the floor, no shadow: a slate-grey frame with a pale top edge
 *  and a bolt at each corner round a dark opening, crossed by five heavy bars and two thin ties. The bars are one shade
 *  step lighter than the frame. */
export function FloorGrate() {
  const iron = "#565b66", ironL = "#7d838f", ironD = "#3a3e47", hole = "#17181d";
  return (
    <g>
      <path d={inkBox(9, 10, 46, 44, 3, .4)} fill={iron} {...OS} />
      <path d="M13 13.6H51" fill="none" stroke={ironL} strokeWidth="1.3" strokeLinecap="round" />
      <rect x="14.5" y="16" width="35" height="32" rx="1.4" {...IS} fill={hole} />
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x="14.5" y={17.8 + i * 6.1} width="35" height="3.6" {...IS} fill={ironL} />)}
      {[26.2, 40.2].map((x) => <rect key={x} x={x - .8} y="16" width="1.6" height="32" {...IS} fill={ironD} />)}
      {[[11.8, 12.6], [52.2, 12.6], [11.8, 51.4], [52.2, 51.4]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.3" {...IS} fill={ironL} />)}
    </g>
  );
}

/* ---- FARM (3): WHEELBARROW, BUCKET, CHICKEN_FEED ---- */

/** SHORT. Rust-red wheelbarrow at waist height, seen from the side with its tray steeply from above: a tapered tray with
 *  a lighter rim, a dark empty inside, the east end one step darker, a dark rubber wheel on a fork at the nose, two
 *  wooden handles running back to the ground and a wooden stand leg. Nobody stands in it, and sight passes over. */
export function Wheelbarrow() {
  const red = "#b3472f", redL = "#d26a4c", redD = "#7d2f20", inner = "#5e2418", wood = "#b98650", woodD = "#8a5c32", tire = "#2a2b32", hub = "#c7ccd2", rim = "#4b4d57";
  const front = polyD([15.4, 33], [49, 33], [45.6, 45.4], [20.6, 45.4]);
  return (
    <g>
      <GroundShadow cx={33} cy={57.2} rx={27} ry={3.4} />
      {/* far handle and stand leg behind the tray */}
      <path d="M52.4 34.4L62.6 41.4" stroke={INK} strokeWidth="4.6" strokeLinecap="round" />
      <path d="M52.4 34.4L62.6 41.4" stroke={woodD} strokeWidth="2.6" strokeLinecap="round" />
      <path d={inkBox(36.6, 44, 4.6, 13.2, 1, .2)} fill={wood} {...OS} />
      {/* tray: east end, top, inside, front */}
      <path d={polyD([49, 33], [55, 22.4], [50.6, 37.6], [45.6, 45.4])} fill={redD} {...OS} />
      <path d={polyD([15.4, 33], [21.4, 22.4], [55, 22.4], [49, 33])} fill={redL} {...OS} />
      <path d={polyD([19.6, 31.4], [23.8, 24.6], [51.4, 24.6], [47.2, 31.4])} {...IS} fill={inner} />
      <path d={front} fill={red} {...OS} />
      <path d="M17.4 36.2H47.4M19 40.2H46.2" {...IS} />
      {/* near handle */}
      <path d="M46.2 41.2L61 52.4" stroke={INK} strokeWidth="4.6" strokeLinecap="round" />
      <path d="M46.2 41.2L61 52.4" stroke={wood} strokeWidth="2.6" strokeLinecap="round" />
      {/* wheel on its fork */}
      <path d="M12.6 49.4L19.6 44.2" stroke={INK} strokeWidth="4.2" strokeLinecap="round" />
      <path d="M12.6 49.4L19.6 44.2" stroke={wood} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12.6" cy="49.4" r="7.6" fill={tire} {...OS} />
      <circle cx="12.6" cy="49.4" r="4.4" {...IS} fill={rim} />
      <circle cx="12.6" cy="49.4" r="1.8" {...IS} fill={hub} />
    </g>
  );
}

/** LOW. Galvanised bucket turned upside down, kept low in the LOW-furniture camera (art/STYLE.md, LOW props): a flared
 *  grey cone about knee high with its base up as a lit ellipse with a dimple, two pressed rings round the body, the east
 *  side one step darker, the bail handle flopped out on the floor to the east and spilled water pooled in front with a
 *  few drops. No cast shadow. Front-end only. */
export function Bucket() {
  const u = useUid();
  const metal = "#aab2ba", metalL = "#cdd3d9", metalD = "#7d858e", water = "#5c8ea8", sky = "#cfe6ef";
  const cx = 30, yb = 43.6, yt = 28.4, rb = 15.4, rt = 11.6, eb = 5.6, et = 4.4;
  const body = `M${cx - rb} ${yb}L${cx - rt} ${yt}A${rt} ${et} 0 0 1 ${cx + rt} ${yt}L${cx + rb} ${yb}A${rb} ${eb} 0 0 1 ${cx - rb} ${yb}Z`;
  const pool = lobed([[4.4, 52.6], [8.4, 47.6], [15.4, 47.4], [22, 49.4], [29, 48.4], [37.6, 51.2], [38.4, 56.2], [30, 58.8], [19.6, 58.4], [9.4, 58.6]], .56);
  const hd = "M44.6 39.6C51 38 58.4 40.4 59.8 44.6C60.8 48 55.4 49.8 49.6 47.8";
  return (
    <g>
      <defs><clipPath id={`${u}b`}><path d={body} /></clipPath></defs>
      <path d={pool} fill={water} {...OS} />
      <path d="M9 55.6Q15 58 22.6 56.4" stroke={sky} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <ellipse cx="50.6" cy="55.4" rx="2.2" ry="1.4" fill={water} {...OS} />
      <ellipse cx="57" cy="57.6" rx="1.5" ry="1" fill={water} {...OS} />
      <path d={hd} stroke={INK} strokeWidth="3.8" strokeLinecap="round" fill="none" />
      <path d={hd} stroke={metalL} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d={body} fill={metal} />
      <g clipPath={`url(#${u}b)`}>
        <path d={`M${cx + 7} 20H50V52H${cx + 7}Z`} fill={metalD} />
        <path d={`M${cx - 18} 36.6A${rb} ${eb} 0 0 0 ${cx + 18} 36.6M${cx - 18} 41.2A${rb} ${eb} 0 0 0 ${cx + 18} 41.2`} {...IS} />
      </g>
      <path d={body} fill="none" {...OS} />
      <ellipse cx={cx} cy={yt} rx={rt} ry={et} fill={metalL} {...OS} />
      <ellipse cx={cx} cy={yt} rx="7.2" ry="2.7" {...IS} fill={metal} />
      <ellipse cx={cx} cy={yt + .2} rx="2.2" ry="1" {...IS} fill={metalD} />
    </g>
  );
}

/** LOW. Chicken feed, a top-down spill of golden grain flush with the floor (art/STYLE.md, LOW props): a low heap of
 *  grain in the middle, a darker rim where it spreads thin, loose kernels thrown all round and two dropped feathers. The
 *  heap is wide enough that grain shows round a token. No shadow. Front-end only. */
export function ChickenFeed() {
  const grain = "#e3b94a", grainD = "#b78a22", grainL = "#f3d982";
  const heap = lobed([[21.6, 33.4], [23.8, 26.4], [30, 22.4], [37, 23.6], [42.6, 28], [43.6, 35], [39, 41.6], [31, 42.6], [24.6, 40]], .56);
  const loose = [[9, 30], [13.6, 20.4], [20, 14.4], [28.4, 12], [37, 11.4], [46, 14], [52.4, 19.4], [55.6, 27.6], [54.6, 36], [50, 44], [45, 50], [37, 53.4], [28, 54.4], [19.4, 51], [13, 46], [8.4, 38.4], [18, 20], [48, 22], [50, 34.4], [14, 37], [34, 48.4], [24, 47.4], [46, 41]];
  const inHeap = [[27, 28], [31.6, 26], [36.4, 29], [33, 33], [28.2, 35.4], [38.4, 35.4], [25.4, 31.4], [35, 38], [31, 30.4]];
  return (
    <g>
      <path d={heap} fill={grainD} {...OS} />
      <path d={heap} fill={grain} transform="translate(32.6 32.8) scale(.78) translate(-32.6 -32.8)" />
      {inHeap.map(([x, y], i) => <ellipse key={`h${i}`} cx={x} cy={y} rx="1.9" ry="1" transform={`rotate(${(i * 53) % 180} ${x} ${y})`} fill={grainL} />)}
      {loose.map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="2" ry="1.1" transform={`rotate(${(i * 67 + 20) % 180} ${x} ${y})`} {...IS} fill={grain} strokeWidth=".7" />)}
      {/* two dropped feathers: curved vane, spine, a few barbs and the bare quill */}
      <g transform="rotate(-24 14 50)">
        <path d="M4 52C8 44.8 17 43.6 24 47C19 53.4 10 55 4 52Z" fill="#f4eee0" {...OS} />
        <path d="M1.6 53.6Q12 49 24 47" {...IS} />
        <path d="M9 50.6L8.4 46.6M13.4 49.2L13.4 45.2M17.8 48L18.6 44.8" {...IS} strokeWidth=".7" />
      </g>
      <g transform="rotate(40 51 15)">
        <path d="M42 17C46 9.8 55 8.6 62 12C57 18.4 48 20 42 17Z" fill="#e8dcc4" {...OS} />
        <path d="M39.6 18.6Q50 14 62 12" {...IS} />
        <path d="M47 15.6L46.4 11.6M51.4 14.2L51.4 10.2M55.8 13L56.6 9.8" {...IS} strokeWidth=".7" />
      </g>
    </g>
  );
}

/* ---- BEACH (3): SANDCASTLE, STARFISH, COOLER, DRIFTWOOD ---- */

/** SHORT. Sandcastle at knee-to-waist height: a low curtain wall with a dark gateway (top plane seen from above, east
 *  side shaded), a square keep with crenels and a red pennant on a stick behind it, and a round tower with a crenelled
 *  rim at each end. Wet-sand tan with one lighter tone for the tops and one darker for the east sides. */
export function Sandcastle() {
  const u = useUid();
  const sand = "#dcc085", sandL = "#efdcab", sandD = "#b99b5c", gate = "#7a6030";
  const tower = (cx, r, ty, by, key) => {
    const ry = r * .38, body = `M${cx - r} ${ty}V${by}A${r} ${ry} 0 0 0 ${cx + r} ${by}V${ty}Z`;
    return (
      <g key={key}>
        <defs><clipPath id={`${u}${key}`}><path d={body} /></clipPath></defs>
        <path d={body} fill={sand} />
        <g clipPath={`url(#${u}${key})`}><rect x={cx + r * .38} y={ty - 2} width={r} height={by - ty + ry + 4} fill={sandD} /></g>
        <path d={body} fill="none" {...OS} />
        <path d={`M${cx - r * .7} ${by - 5}Q${cx} ${by - 2.2} ${cx + r * .7} ${by - 5}`} {...IS} />
        <ellipse cx={cx} cy={ty} rx={r} ry={ry} fill={sandL} {...OS} />
        {[-.78, 0, .78].map((t) => <path key={t} d={inkBox(r2(cx + t * r - 1.6), r2(ty + ry * Math.sqrt(1 - t * t) - 3.4), 3.2, 3.2, .6, .1)} fill={sandL} {...OS} />)}
      </g>
    );
  };
  return (
    <g>
      <GroundShadow cx={33} cy={57.4} rx={25} ry={3.4} />
      {/* flag stick and pennant behind the keep */}
      <path d="M32.4 24V5.6" {...IS} strokeWidth="1.2" />
      <path d="M32.8 5.2L41.6 8.2L32.8 11.4Z" fill={CRIMSON} {...OS} />
      {/* keep: east side, top, crenels, front */}
      <path d={slabSide(21, 24, 19, 14, 4, 8)} fill={sandD} {...OS} />
      <path d={slabTop(21, 24, 19, 4, 8)} fill={sandL} {...OS} />
      {[21.4, 26.6, 31.8, 37].map((x) => <path key={x} d={inkBox(x, 20.8, 3, 3.6, .6, .1)} fill={sandL} {...OS} />)}
      <path d={inkBox(21, 24, 19, 14.4, 1.2, .3)} fill={sand} {...OS} />
      <path d={inkBox(28.4, 28.6, 4.2, 6.4, 2, .1)} {...IS} fill={gate} />
      {/* curtain wall: east side, top, front with the gateway */}
      <path d={slabSide(6, 43, 44, 13, 6, 11)} fill={sandD} {...OS} />
      <path d={slabTop(6, 43, 44, 6, 11)} fill={sandL} {...OS} />
      <path d={inkBox(6, 43, 44, 13.4, 2, .4)} fill={sand} {...OS} />
      <path d="M27.4 56.4V51Q32 46.4 36.6 51V56.4Z" {...IS} fill={gate} />
      <path d="M10.6 49.4Q13 48.4 15.4 49.4M42.4 51.6Q44.8 50.6 47.2 51.6" {...IS} />
      {/* towers at each end, the right one a little shorter */}
      {tower(11, 7.6, 30, 55, "tl")}
      {tower(48.6, 6.8, 34, 55.4, "tr")}
    </g>
  );
}

/** LOW (front-end-only, flat). Orange starfish stranded on the sand, a top-down footprint: five soft-tipped arms, each
 *  split lengthways into a lit and a shaded half, a row of pale bumps down the middle of every arm and a pale disc at
 *  the centre. The arms reach round a token on it. Flush with the floor: no shadow. */
export function Starfish() {
  const u = useUid();
  const base = "#ee8f4e", shade = "#cf6a30", bump = "#f9dcae", cx = 32, cy = 33.4;
  const R = 25.4, rin = 11, rot = -90 + 8;
  const pt = (i) => { const a = ((rot + 36 * i) * Math.PI) / 180, r = i % 2 ? rin : R; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
  const V = Array.from({ length: 10 }, (_, i) => pt(i));
  const mix = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  const d = V.map((v, i) => {
    const p = V[(i + 9) % 10], n = V[(i + 1) % 10], f = i % 2 ? .22 : .17, a = mix(v, p, f), b = mix(v, n, f);
    return `${i ? "L" : "M"}${r2(a[0])} ${r2(a[1])}Q${r2(v[0])} ${r2(v[1])} ${r2(b[0])} ${r2(b[1])}`;
  }).join("") + "Z";
  const shadeD = Array.from({ length: 5 }, (_, k) => `M${r2(cx)} ${r2(cy)}L${r2(V[2 * k][0])} ${r2(V[2 * k][1])}L${r2(V[2 * k + 1][0])} ${r2(V[2 * k + 1][1])}Z`).join("");
  return (
    <g>
      <defs><clipPath id={`${u}s`}><path d={d} /></clipPath></defs>
      <path d={d} fill={base} />
      <g clipPath={`url(#${u}s)`}><path d={shadeD} fill={shade} /></g>
      <path d={d} fill="none" {...OS} />
      {Array.from({ length: 5 }, (_, k) => {
        const [tx, ty] = V[2 * k];
        return [.46, .6, .74, .86].map((f, j) => <circle key={`${k}${j}`} cx={r2(cx + (tx - cx) * f)} cy={r2(cy + (ty - cy) * f)} r={r2(1.35 - j * .12)} fill={bump} />);
      })}
      <circle cx={cx} cy={cy} r="3.6" {...IS} fill={bump} />
    </g>
  );
}

/** LOW. Cooler box someone sits on, in the LOW-furniture camera: a red body at knee height under a cream lid (top seen
 *  from above with two cup holders, front face, shaded east end), a grey latch across the seam in front and a recessed
 *  carry grip in the east end. Stays below a SHORT prop's top. No cast shadow. */
export function Cooler() {
  const red = "#cf4b3f", redD = "#9a3028", lid = "#ede7d6", lidL = "#f9f5e8", lidD = "#c8c1ad", grey = "#8c939c", dark = "#3c4048";
  const P = lowCam(57), top = (...a) => camTop(P, ...a), side = (...a) => camSide(P, ...a), front = (...a) => camFront(P, ...a);
  const x0 = 7, x1 = 51, D = 22, hB = 11, hL = 17;
  const cup = (x, z) => { const [px, py] = P(x, z, hL); return <ellipse key={x} cx={r2(px)} cy={r2(py)} rx="5.2" ry="2.5" {...IS} fill={lidD} />; };
  return (
    <g>
      {/* east end: body, lid and the recessed grip */}
      <path d={side(x1, 0, D, 1, hB)} fill={redD} {...OS} />
      <path d={side(x1, 0, D, hB, hL)} fill={lidD} {...OS} />
      <path d={polyD(P(x1, 6, 3.4), P(x1, 6, 8), P(x1, 16, 8), P(x1, 16, 3.4))} {...IS} fill={dark} />
      {/* lid top with two cup holders, then the front of the lid and of the body */}
      <path d={top(x0, x1, 0, D, hL)} fill={lidL} {...OS} />
      {cup(x0 + 11.5, 12)}{cup(x1 - 11.5, 12)}
      <path d={front(x0, x1, 0, hB - .6, hL, 2)} fill={lid} {...OS} />
      <path d={front(x0, x1, 0, 1, hB, 1.6)} fill={red} {...OS} />
      <path d={front(x0 + 19, x0 + 25, -.2, 6.4, hB + 3.4, 1)} fill={grey} {...OS} />
      <circle cx={r2(x0 + 22)} cy={r2(P(0, 0, 9.4)[1])} r=".9" fill={dark} />
    </g>
  );
}

/** LOW. Driftwood log lying on the sand that someone sits on, in the LOW-furniture camera: a sun-bleached trunk
 *  at knee height with a lit top, a shaded underside, grain lines and a knot, the sawn east end showing growth rings,
 *  a broken root stub at the west end and two snapped limbs leaning out behind it. Kept lower than a SHORT prop.
 *  No cast shadow. */
export function Driftwood() {
  const u = useUid();
  const wood = "#cdbf9f", woodL = "#e8dfc6", woodD = "#a69a7a", ring = "#dfd3b4";
  const body = "M8.6 43C12 38.6 19 37.8 27 38.6C35 39.4 43 37.6 50 37.8L50 51.6C42 53.2 35 52.6 27 53.4C19 54.2 12.4 53.6 8.8 52.2L5.2 50.4L8 48.8L3.6 46.6L7.6 45.4L5.4 43.2Z";
  return (
    <g>
      <defs><clipPath id={`${u}b`}><path d={body} /></clipPath></defs>
      {/* two snapped limbs behind the trunk, tapering and leaning apart */}
      <path d="M16.6 41C16 34 14 29.6 10.4 26.4L13.6 23.8C18.4 27.4 22 33 24.6 41Z" fill={wood} {...OS} />
      <path d="M20.6 33.4L24.6 41H20Z" fill={woodD} />
      <path d="M10.4 26.4L13.6 23.8L14.6 25.6L11.4 27.8Z" fill={woodL} {...OS} />
      <path d="M36.4 40.6C37.4 35 40 31 45 28.4L47.4 31C44.4 33.4 43.8 36.6 45.4 40.6Z" fill={wood} {...OS} />
      <path d="M42 33L45.4 40.6H41Z" fill={woodD} />
      <path d="M45 28.4L47.4 31L48.6 29.4L46.4 27.2Z" fill={woodL} {...OS} />
      {/* trunk */}
      <path d={body} fill={wood} />
      <g clipPath={`url(#${u}b)`}>
        <path d="M0 47.4Q20 46 60 47.8V56H0Z" fill={woodD} />
        <path d="M6 42.4Q27 40.4 50 41" fill="none" stroke={woodL} strokeWidth="2.6" strokeLinecap="round" />
      </g>
      <path d={body} fill="none" {...OS} />
      <path d="M10 46.2Q20 44.6 30 45.4T47 44.6M13 49.2Q24 48 36 48.8" {...IS} strokeWidth=".8" />
      <ellipse cx="34" cy="43.6" rx="2.6" ry="1.5" {...IS} fill={woodD} />
      {/* sawn east end with growth rings */}
      <ellipse cx="50.2" cy="44.5" rx="4.4" ry="6.2" fill={woodL} {...OS} />
      <ellipse cx="50.2" cy="44.5" rx="2.6" ry="3.8" {...IS} fill={ring} strokeWidth=".7" />
      <circle cx="50.2" cy="44.5" r=".9" fill={woodD} />
    </g>
  );
}

/* ---- FOREST (3): CAMPFIRE, FERN, FALLEN_LOG ---- */

/** SHORT. Campfire in the waist-height camera: a ring of ten squat grey stones (back ones first, front ones in front of
 *  the fire) round a dark ash bed, two crossed charred logs, a tall two-tone flame and a few sparks, with a flat
 *  translucent orange glow on the ground round the ring. Sight passes over it; nobody stands in it. */
export function Campfire() {
  const stone = "#9aa0a8", stoneD = "#6f757d", ash = "#2d2723", log = "#6b4a2b", logD = "#3f2a17", cut = "#e0b982", fire = "#ef7f2a", fireL = "#ffd24a";
  const cx = 32, cy = 41.5, rx = 21.5, ry = 9.6, h = 4.6;
  const stones = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2 + .3;
    return { x: r2(cx + Math.cos(a) * rx), y: r2(cy + Math.sin(a) * ry), w: 5.6 + (i % 3) * .5, rot: (i * 37) % 24 - 12, i };
  }).sort((a, b) => a.y - b.y);
  const drawStone = ({ x, y, w, rot, i }) => (
    <g key={i}>
      <path d={`M${r2(x - w)} ${y}V${r2(y + h)}A${w} 3.6 0 0 0 ${r2(x + w)} ${r2(y + h)}V${y}Z`} fill={stoneD} {...OS} />
      <ellipse cx={x} cy={y} rx={w} ry="3.6" fill={stone} transform={`rotate(${rot} ${x} ${y})`} {...OS} />
      {i % 3 === 0 ? <path d={`M${r2(x - w * .4)} ${r2(y - .6)}L${r2(x + w * .1)} ${r2(y + 1)}`} {...IS} strokeOpacity=".6" /> : null}
    </g>
  );
  const back = stones.filter((s) => s.y < cy), front = stones.filter((s) => s.y >= cy);
  const logP = (x1, y1, x2, y2, key) => {
    const d = `M${x1} ${y1}L${x2} ${y2}`;
    return (
      <g key={key}>
        <path d={d} stroke={INK} strokeWidth="7.4" strokeLinecap="round" />
        <path d={d} stroke={log} strokeWidth="4.4" strokeLinecap="round" />
        <path d={`M${x1 + 1.6} ${y1 - 1.2}L${x2 - 1.6} ${y2 - 1.2}`} stroke={logD} strokeWidth="1.2" strokeLinecap="round" />
        <circle cx={x1} cy={y1} r="2.2" {...IS} fill={cut} />
      </g>
    );
  };
  return (
    <g>
      <GroundShadow cx={32} cy={55.4} rx={26} ry={4} />
      <ellipse cx={cx} cy={43} rx="29" ry="14" fill="#ff8a2a" fillOpacity=".24" />
      {back.map(drawStone)}
      <ellipse cx={cx} cy={cy + .6} rx="15.6" ry="6.6" fill={ash} {...OS} />
      {logP(20.4, 44.4, 43.6, 39.2, "a")}
      {logP(43.2, 45.2, 21.6, 38.4, "b")}
      {/* flame: side tongues, the big flame, a yellow heart */}
      <path d="M26.6 40.6C22.4 37 23.6 31.4 26 28.4C26.4 31.4 27.8 33 28.8 33.6C27.6 36 27.6 38.6 29 40.6Z" fill={fire} {...OS} strokeWidth="1.2" />
      <path d="M37.4 40.6C41.6 37.2 40.6 32 38.6 29.4C38.2 32 37 33.4 36 34C37 36.4 37 38.4 35.6 40.6Z" fill={fire} {...OS} strokeWidth="1.2" />
      <path d="M32 15.4C33.4 21.4 39.6 25.6 39 33C38.6 38.4 35.4 41.4 32 41.4C28.6 41.4 25.4 38.4 25.2 33.4C25 29 27.8 27.2 28.8 22.6C30 24.4 30.8 25.6 31.2 26.8C30.8 22.6 31 19 32 15.4Z" fill={fire} {...OS} />
      <path d="M32 26.4C33.8 30 36.2 33 35.4 37C35 39.4 33.6 40.4 32 40.4C30.4 40.4 29 39.4 28.6 37C28.2 33.6 30.6 31.6 32 26.4Z" fill={fireL} />
      {[[40.4, 20.6], [24.4, 22.4], [43.6, 29.6]].map(([x, y], i) => <path key={i} d={`M${x} ${y - 1.4}L${x + 1}${' '}${y}L${x} ${y + 1.4}L${x - 1} ${y}Z`} fill={fireL} />)}
      {front.map(drawStone)}
    </g>
  );
}

/** SHORT. Fern clump at waist height (art/STYLE.md, SHORT camera): a dozen arching fronds rise up and out from a low
 *  brown crown and fall over at their tips, the far ones a shade darker, the near ones lit, each a tapering
 *  blade of alternate leaflets round a midrib; the clump tops out near y 27, well below a standing person, on a flat
 *  GroundShadow. Nobody stands in it; sight passes over it. */
export function Fern() {
  const O = [32, 54.6]; // the crown
  // one frond: a cubic spine from the crown up to a peak and over to the drooping tip, leaflets alternating along it
  const frond = (tx, ty, peak, wid, k) => {
    const x0 = O[0] + (tx - O[0]) * .06, P = [[x0, O[1]], [x0 + (tx - x0) * .12, peak + 6], [x0 + (tx - x0) * .62, peak - 3], [tx, ty]];
    const at = (t) => {
      const m = 1 - t, a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t;
      const x = a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0], y = a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1];
      const dx = 3 * (m * m * (P[1][0] - P[0][0]) + 2 * m * t * (P[2][0] - P[1][0]) + t * t * (P[3][0] - P[2][0]));
      const dy = 3 * (m * m * (P[1][1] - P[0][1]) + 2 * m * t * (P[2][1] - P[1][1]) + t * t * (P[3][1] - P[2][1]));
      const L = Math.hypot(dx, dy) || 1;
      return [x, y, -dy / L, dx / L];
    };
    const n = 14, L = [], R = [], mid = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, [x, y, nx, ny] = at(t);
      // blade half-width: swells from the stalk, tapers to the tip; leaflet points alternate with the notches between them
      const w = wid * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - .14) / .86)) ** .8) * (i % 2 ? .55 : 1);
      const lag = i % 2 ? 0 : .9; // leaflet points lean toward the tip
      R.push([r2(x + nx * w + (i % 2 ? 0 : lag * ny)), r2(y + ny * w - (i % 2 ? 0 : lag * nx))]);
      L.push([r2(x - nx * w + (i % 2 ? 0 : lag * ny)), r2(y - ny * w - (i % 2 ? 0 : lag * nx))]);
      mid.push([r2(x), r2(y)]);
    }
    const all = polyD(...R, ...L.reverse());
    const half = polyD(...mid, ...R.slice().reverse());
    return { k, all, half, rib: `M${mid.map((q) => q.join(" ")).join("L")}` };
  };
  const back = [[11, 39, 31, 4.4, "b1"], [23, 30, 26, 4.6, "b2"], [42, 30, 26, 4.6, "b3"], [54, 38, 31, 4.4, "b4"]].map((f) => frond(...f));
  const front = [[3, 51, 38, 4.2, "f1"], [14, 44, 33, 4.8, "f2"], [27, 37, 30, 4.4, "f3"], [50, 44, 33, 4.8, "f5"], [61, 51, 38, 4.2, "f6"], [38, 36, 30, 4.4, "f4"]].map((f) => frond(...f));
  const draw = (g, fill, fillD) => (
    <g key={g.k}>
      <path d={g.all} fill={fill} {...OS} />
      <path d={g.half} fill={fillD} />
      <path d={g.rib} {...IS} />
    </g>
  );
  return (
    <g>
      <GroundShadow cx={32} cy={57.2} rx={24} ry={3.6} />
      {back.map((g) => draw(g, "#3f8a45", "#2d6c38"))}
      {front.map((g) => draw(g, "#68b255", "#4b9649"))}
      {/* the crown: a low brown tuft with two curled fiddleheads */}
      <path d="M24.6 57.2C24.4 53.6 27.6 51.4 32 51.4C36.4 51.4 39.6 53.6 39.4 57.2Z" fill="#7a5230" {...OS} />
      <path d="M28.4 56.4L29.4 53.2M32 56.6V52.8M35.6 56.4L34.6 53.2" {...IS} />
    </g>
  );
}

/** LOW. Fallen log you sit on, in the LOW-furniture camera and kept low (art/STYLE.md, LOW props): a bark-clad trunk lying
 *  east to west at about knee height, its lower third a shade darker, bark furrows, a knot, a moss cap and a stub of
 *  branch on top, a snapped splintered end to the west and the sawn east end showing growth rings. No cast shadow. */
export function FallenLog() {
  const u = useUid();
  const bark = "#8a5a34", barkD = "#5d3b21", barkL = "#aa7642", cut = "#e0b982", ring = "#a97b44", moss = "#6f9c47";
  const body = "M10.4 40.6Q30 38.2 51 40.2V56Q30 58 8.4 56L5.4 51.6L9.4 49.4L4.8 46L9.6 43.8L7.2 41.4Z";
  return (
    <g>
      <defs><clipPath id={`${u}b`}><path d={body} /></clipPath></defs>
      {/* branch stub behind the trunk */}
      <path d="M34.4 41V35.6Q38 34.2 41.6 35.6V41Z" fill={bark} {...OS} />
      <ellipse cx="38" cy="35.6" rx="3.6" ry="1.5" fill={cut} {...OS} strokeWidth="1.2" />
      <path d={body} fill={bark} />
      <g clipPath={`url(#${u}b)`}><rect x="0" y="50" width="60" height="9" fill={barkD} /></g>
      <path d="M14 42.6Q30 40.4 47 42" stroke={barkL} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d={body} fill="none" {...OS} />
      {/* splinters at the snapped end */}
      <path d="M9.4 49.4L3.2 48.6L5.6 51.4M9.6 43.8L3.6 41.4L7.2 41.4" {...IS} fill={cut} />
      {/* bark furrows and a knot */}
      <path d="M12 46.6Q20 45.2 28.4 46.6M24 51.2Q34 49.8 44 51.2M13 53.6Q19 52.6 26 53.8M32 46Q38 45 45 46.2" {...IS} />
      <ellipse cx="36.4" cy="47.2" rx="2.2" ry="1.7" {...IS} />
      {/* moss cap */}
      <path d="M13.4 41.8C13.4 38.8 17.6 38.4 19.4 39.6C21.4 38 25.8 38.6 26.4 41.4C26.8 43.8 23.6 44.4 21.6 43.8C19.4 45.2 14.6 44.6 13.4 41.8Z" {...IS} fill={moss} />
      {/* sawn east end */}
      <ellipse cx="51.4" cy="48.2" rx="4.8" ry="8.2" fill={cut} {...OS} />
      <ellipse cx="51.4" cy="48.2" rx="2.9" ry="5.2" fill="none" stroke={ring} strokeWidth=".9" />
      <ellipse cx="51.5" cy="48.2" rx="1.1" ry="2" fill="none" stroke={ring} strokeWidth=".8" />
    </g>
  );
}

/* ---- MOUNTAINS (3): SNOWDRIFT, PICKAXE ---- */

/** LOW. Snowdrift you stand in, a flat top-down footprint: a smooth wind-swept white mound, round to the north-east and drawn out
 *  into a low tail to the south-west, a blue-grey shaded rim along its south and east side, two wind-carved ridges along it
 *  with a lit crest and a few pale glints. Knee-deep, so low and flush; no shadow. */
export function Snowdrift() {
  const u = useUid();
  const sn = "#fbfdff", snD = "#bfd2e5", ridge = "#8ea9c6";
  // a wind-swept mound: round on the north-east, drawn out into a low tail to the south-west; smooth closed curve
  const pts = [[4, 52], [10, 40], [19, 29], [31, 22], [44, 18.4], [55, 24], [60, 35], [56, 47], [45, 54.4], [29, 57], [14, 57.6]];
  const smooth = (P) => {
    const n = P.length, g = (i) => P[(i + n) % n];
    let d = `M${g(0)}`;
    for (let i = 0; i < n; i++) {
      const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
      d += `C${r2(p1[0] + (p2[0] - p0[0]) / 6)} ${r2(p1[1] + (p2[1] - p0[1]) / 6)} ${r2(p2[0] - (p3[0] - p1[0]) / 6)} ${r2(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]} ${p2[1]}`;
    }
    return d + "Z";
  };
  const shape = smooth(pts);
  return (
    <g>
      <defs><clipPath id={`${u}c`}><path d={shape} /></clipPath></defs>
      <path d={shape} fill={sn} />
      <g clipPath={`url(#${u}c)`}>
        <path d="M0 60C14 64 34 64 50 58C62 53 66 42 64 30C60 44 52 50 40 52C26 54 14 54 0 50Z" fill={snD} />
      </g>
      <path d={shape} fill="none" {...OS} />
      {/* wind ridges along the drift with a lit crest */}
      <path d="M13 48C24 43 34 35 46 30M22 53C32 50 44 46 53 40" {...IS} stroke={ridge} />
      <path d="M18 44.4C26 40.4 34 34 44 28.4M30 48C38 45 46 41.6 52 37" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      {[[20, 28, 2], [48, 46, 1.8], [38, 24, 1.5]].map(([x, y, s]) => <path key={x} d={`M${x - s} ${y}H${x + s}M${x} ${y - s}V${y + s}`} stroke={ridge} strokeWidth=".9" strokeLinecap="round" />)}
    </g>
  );
}

/** LOW. Pickaxe lying flat on the ground, seen from above, no shadow: a long ash handle from the south-west corner up to
 *  the north-east with a darker lower edge, a lit streak and a swelled butt end, and the iron head across its top end,
 *  square to the handle: a long curved pick tapering to a sharp point on one side and a shorter flat chisel blade on
 *  the other, the far half of the iron a shade darker, the handle's tip poking through the eye. Two rock chips beside it. */
export function Pickaxe() {
  const wood = "#c08a4e", woodD = "#86592f", woodL = "#e3b57a", iron = "#8d97a3", ironD = "#5b6470", ironL = "#d5dbe2";
  const A = [9, 57], C = [41.6, 21.4]; // the butt end and the eye
  const Lh = Math.hypot(C[0] - A[0], C[1] - A[1]), v = [(C[0] - A[0]) / Lh, (C[1] - A[1]) / Lh], p = [v[1], -v[0]]; // v up the handle, p across it (toward the north-west)
  const at = (a, b) => [r2(C[0] + v[0] * a + p[0] * b), r2(C[1] + v[1] * a + p[1] * b)]; // a along the handle, b across
  const B = (a, b) => at(a, b).join(" ");
  // the head: an arc bowed away from the handle; pick to the north-west (b > 0), chisel to the south-east (b < 0)
  const head = `M${B(-1.6, 25)}Q${B(4.4, 12)} ${B(4.6, 3.4)}L${B(4.2, -3.4)}Q${B(4.4, -9)} ${B(1.6, -16.4)}L${B(-2.6, -16.4)}`
    + `Q${B(-.6, -9)} ${B(-3.4, -3.4)}L${B(-3.6, 3.4)}Q${B(-2.6, 12)} ${B(-1.6, 25)}Z`;
  const handle = (w, c) => <path d={`M${A[0]} ${A[1]}L${B(5.6, 0)}`} stroke={c} strokeWidth={w} strokeLinecap="round" />;
  return (
    <g>
      {/* handle: ink, wood, a darker lower edge and a lit streak, and a swelled butt */}
      {handle(6.6, INK)}
      <circle cx={A[0]} cy={A[1]} r="3.6" fill={INK} />
      {handle(3.6, wood)}
      <circle cx={A[0]} cy={A[1]} r="2.3" fill={wood} />
      <path d={`M${r2(A[0] - p[0] * 1.1 + v[0] * 2)} ${r2(A[1] - p[1] * 1.1 + v[1] * 2)}L${B(-4, -1.1)}`} stroke={woodD} strokeWidth="1.2" strokeLinecap="round" />
      <path d={`M${r2(A[0] + p[0] * .8 + v[0] * 5)} ${r2(A[1] + p[1] * .8 + v[1] * 5)}L${B(-10, .8)}`} stroke={woodL} strokeWidth=".9" strokeLinecap="round" />
      {/* iron head, its far (north-east) half a shade darker, a lit edge along the pick */}
      <path d={head} fill={iron} {...OS} />
      <path d={`M${B(.4, 22)}Q${B(4.4, 12)} ${B(4.6, 3.4)}L${B(4.2, -3.4)}Q${B(4.4, -9)} ${B(1.6, -16.4)}L${B(.5, -16.4)}Q${B(1.6, -9)} ${B(.6, -3.4)}L${B(.8, 3.4)}Q${B(1, 12)} ${B(.4, 22)}Z`} fill={ironD} />
      <path d={`M${B(-2.2, 21)}Q${B(-1.8, 12)} ${B(-2.4, 5)}`} {...IS} stroke={ironL} strokeWidth="1.1" />
      <path d={head} fill="none" {...OS} />
      {/* the eye collar and the handle's tip poking through it */}
      <path d={polyD(at(-4.2, -4.2), at(5, -4.2), at(5, 4.2), at(-4.2, 4.2))} fill={ironD} {...OS} strokeWidth="1.2" />
      <circle cx={at(.4, 0)[0]} cy={at(.4, 0)[1]} r="2" fill={woodL} {...IS} />
      {/* rock chips */}
      {[[47, 50, 3.4], [16, 22, 2.8], [55, 40, 2.2]].map(([x, y, s]) => <path key={x} d={`M${x - s} ${y}L${x} ${y - s}L${x + s} ${r2(y - s * .2)}L${r2(x + s * .6)} ${y + s}L${r2(x - s * .4)} ${r2(y + s * .8)}Z`} fill="#9aa0a8" {...OS} strokeWidth="1.1" />)}
    </g>
  );
}

/* ---- DESERT (3): BONES, SCORPION_NEST, POTTERY_SHARDS, FLOOR_PILLOW ---- */

/** LOW. Bleached bones scattered on the sand, seen from above and flat, no shadow: a femur and a shorter shin bone, a
 *  ribcage (a spine with curved ribs both sides), a small skull with dark eye sockets and teeth, and a few vertebrae. Each
 *  piece has one outline, a cream face and a darker lower edge. */
export function Bones() {
  const b = "#f1e8d0", bD = "#cdbf98", eye = "#3a2f20";
  // a long bone: shaft with a pair of knobs at each end, laid along x then rotated
  const long = (x, y, rot, len, w, key) => {
    const h = len / 2, k = w * .62, shape = (
      <>
        <rect x={-h + k * .6} y={-w / 2} width={len - k * 1.2} height={w} rx={w * .35} />
        {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, s], i) => <circle key={i} cx={sx * (h - k * .55)} cy={s * w * .46} r={k} />)}
      </>
    );
    return (
      <g key={key} transform={`translate(${x} ${y}) rotate(${rot})`}>
        <g fill={INK} stroke={INK} strokeWidth="3" strokeLinejoin="round">{shape}</g>
        <g fill={b}>{shape}</g>
        <rect x={-h + k * 1.2} y={w * .1} width={len - k * 2.4} height={w * .4} fill={bD} />
      </g>
    );
  };
  const ribs = [0, 1, 2, 3].map((i) => 11.4 + i * 6.6);
  const ribD = ribs.map((x) => `M${x} 46.6Q${x + 4.4} 41 ${x + 2.2} 34.6M${x} 46.6Q${x + 4.4} 52.2 ${x + 2.2} 58.6`).join("");
  const spine = `M9 46.6H${ribs[3] + 3.6}`;
  const skull = "M-8 -1C-8 -8.2 8 -8.2 8 -1C8 2 6.2 3.8 5.6 5.6L5 9.4H-5L-5.6 5.6C-6.2 3.8 -8 2 -8 -1Z";
  return (
    <g>
      {/* ribcage */}
      <path d={ribD} fill="none" stroke={INK} strokeWidth="4.2" strokeLinecap="round" />
      <path d={spine} fill="none" stroke={INK} strokeWidth="5.6" strokeLinecap="round" />
      <path d={ribD} fill="none" stroke={b} strokeWidth="1.8" strokeLinecap="round" />
      <path d={spine} fill="none" stroke={b} strokeWidth="3" strokeLinecap="round" />
      {long(24, 17, -20, 31, 4.6, "femur")}
      {long(43, 56, 9, 19, 3.6, "shin")}
      {/* skull */}
      <g transform="translate(47 34) rotate(8)">
        <path d={skull} fill={INK} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <path d={skull} fill={b} />
        <path d="M4 -7.2C7 -5.6 8 -2.8 8 -1C8 2 6.2 3.8 5.6 5.6L5 9.4H2.6C4 5 4.4 0 4 -7.2Z" fill={bD} />
        <ellipse cx="-3.2" cy="-.6" rx="2.2" ry="2.5" fill={eye} /><ellipse cx="3.2" cy="-.6" rx="2.2" ry="2.5" fill={eye} />
        <path d="M0 3.2L-1.2 5.4H1.2Z" fill={eye} />
        <path d="M-3.4 6.6V9.2M-1.1 6.6V9.2M1.1 6.6V9.2M3.4 6.6V9.2" {...IS} strokeWidth=".7" />
      </g>
      {/* loose vertebrae */}
      {[[14, 30, 2.2], [31, 38, 1.9], [53, 12, 2.1]].map(([x, y, r], i) => (
        <g key={i}><circle cx={x} cy={y} r={r} fill={b} {...OS} strokeWidth="1.2" /><circle cx={x} cy={y} r={r * .38} fill={eye} /></g>
      ))}
    </g>
  );
}

/** LOW. Scorpion nest, flat on the floor, seen from above, no shadow: a low, raked-sand burrow mound ringed with a few
 *  rocks, a dark hole in its west half, and four SMALL chestnut scorpions (about 9 units long each) coming out of the
 *  hole and crawling round the mound: each has two pincer claws, a segmented body, short legs and a tail curled up over
 *  its back to a black sting. The middle of the mound is left calm for a token. */
export function ScorpionNest() {
  const u = useUid();
  const sand = "#e0bd84", sandD = "#c39a5e", sandL = "#f0dcae", hole = "#2a1a10", rock = "#a79a86", rockD = "#7e7260";
  const sc = "#8a4a22", scD = "#5e2f14", scL = "#c27a3a";
  const mound = "M9 34C8 22 17 13.6 30 13C44 12.6 56 20 56 33C56 46 46 54 32 54C18 54 10 46 9 34Z";
  // one small scorpion, head to -y: two pincer arms, four pairs of legs, an oval body with a head shield, and a tail of
  // five beads that runs back, curls up the east side and ends in a black sting (x, y, turn in degrees, scale)
  const beads = [[0, 5.4, 1.5], [.5, 7.4, 1.4], [2.2, 8.6, 1.3], [4, 8, 1.2], [4.8, 6, 1.1], [4.3, 4, 1]];
  const claw = "M-3 -5.6C-5.2 -6.2 -5.6 -8.8 -3.8 -9.8C-3.4 -8.6 -2.9 -8.2 -2.2 -8C-2 -7 -2.2 -6.2 -3 -5.6Z";
  const scorp = (x, y, rot, k, key) => (
    <g key={key} transform={`translate(${x} ${y}) rotate(${rot}) scale(${k})`}>
      <path d="M-2 -1.6L-5.4 -3M-2.2 0L-6 .6M-2.1 1.6L-5.6 4M-1.7 3L-4.6 6.2M2 -1.6L5.4 -3M2.2 0L6 .6M2.1 1.6L5.6 4M1.7 3L4.6 6.2" fill="none" stroke={scD} strokeWidth="1" strokeLinecap="round" />
      {[...beads].reverse().map(([bx, by, br], i) => <circle key={i} cx={bx} cy={by} r={br} fill={sc} {...IS} strokeWidth=".55" />)}
      <path d="M3.5 4.4L3.2 1.8L5.4 3.4Z" fill={INK} stroke={INK} strokeWidth=".6" strokeLinejoin="round" />
      <path d="M-1.2 -3.4L-2.8 -5.8M1.2 -3.4L2.8 -5.8" fill="none" stroke={sc} strokeWidth="1.3" strokeLinecap="round" />
      <path d={claw} fill={scL} {...IS} strokeWidth=".8" />
      <path d={claw} fill={scL} {...IS} strokeWidth=".8" transform="scale(-1 1)" />
      <ellipse cx="0" cy=".6" rx="2.5" ry="3.9" fill={sc} {...IS} strokeWidth=".9" />
      <ellipse cx="0" cy="-2.8" rx="2.1" ry="1.7" fill={scD} {...IS} strokeWidth=".8" />
      <path d="M-2 .2H2M-2.1 1.8H2.1M-1.8 3.2H1.8" stroke={scD} strokeWidth=".6" />
      <circle cx="-.8" cy="-3.4" r=".4" fill={scL} /><circle cx=".8" cy="-3.4" r=".4" fill={scL} />
    </g>
  );
  return (
    <g>
      <defs><clipPath id={`${u}m`}><path d={mound} /></clipPath></defs>
      {/* the mound, its shaded flank, a few raked marks, the burrow hole */}
      <path d={mound} fill={sand} />
      <g clipPath={`url(#${u}m)`}>
        <path d="M64 22C60 38 50 52 26 64H64Z" fill={sandD} />
        <path d="M0 36C3 28 8 20 15 16L4 14Z" fill={sandL} />
      </g>
      <path d={mound} fill="none" {...OS} />
      <path d="M16 22Q22 17 30 16.4M46 24Q50 28 51 33M40 49Q34 51.6 28 51" {...IS} strokeOpacity=".5" />
      <ellipse cx="25" cy="31" rx="7.6" ry="5.2" {...IS} fill={sandD} />
      <ellipse cx="25.6" cy="31.8" rx="5.2" ry="3.4" fill={hole} />
      {/* rocks heaped round the burrow */}
      <path d="M45 12.6L51 11.4L54 15.6L50 18.6L45 17.2Z" fill={rock} {...OS} />
      <path d="M50 18.6L54 15.6L52 20.4Z" fill={rockD} {...IS} />
      <path d="M7 46.6L11.4 44L16.4 46L15.6 51L9.6 52Z" fill={rock} {...OS} />
      <path d="M15.6 51L16.4 46L19 50Z" fill={rockD} {...IS} />
      <path d="M50 50L54.4 48.2L56.4 52.2L52.6 54.6Z" fill={rock} {...OS} />
      {/* four little scorpions: one leaving the hole, three crawling round the mound */}
      {scorp(34.4, 30, 82, .8, "a")}
      {scorp(20, 22, -28, .8, "b")}
      {scorp(46, 40.4, 140, .8, "c")}
      {scorp(31, 47.2, 196, .8, "d")}
    </g>
  );
}

/** LOW. Broken pottery scattered on the floor, seen from above and flat, no shadow: four angular terracotta shards (one
 *  with the curved rim of the pot) and three chips, each with its own outline and a darker lower-right half. Painted
 *  decoration in cream and dark brown: a band, a zigzag, a row of dots and a rim line. */
export function PotteryShards() {
  const u = useUid();
  const clay = "#cd6c3f", cream = "#f0dcb4", brown = "#5e2f1a";
  const shards = [
    { d: "M6 24L14 15.6L31 16L32 28L22 35L9 34Z", c: [19, 25], deco: "band" },
    { d: "M37 10Q48 7.4 57 15L55 28L42 31L35 21Z", c: [46, 20], deco: "zig" },
    { d: "M8 45L26 41L34 53L26 59L12 58Z", c: [20, 51], deco: "dots" },
    { d: "M42 40L59 37L61 50L51 57L43 52Z", c: [51, 47], deco: "rim" },
  ];
  const chips = ["M31 33L37 35L34 40L30 38Z", "M3 38L8 36L9 41Z", "M38 59L44 58L42 62Z"];
  const deco = (k, c) => {
    const cy = c[1];
    if (k === "band") return (<g fill="none"><path d={`M0 ${cy + 2}L64 ${cy - 6}`} stroke={cream} strokeWidth="4.8" /><path d={`M0 ${cy - .2}L64 ${cy - 8.2}M0 ${cy + 4.2}L64 ${cy - 3.8}`} stroke={brown} strokeWidth=".9" /></g>);
    if (k === "zig") return (<g fill="none"><path d={`M30 ${cy + 4}L64 ${cy - 4}`} stroke={cream} strokeWidth="4.6" /><path d={`M32 ${cy + 4}l3 -3.2l3 3.2l3 -3.2l3 3.2l3 -3.2l3 3.2l3 -3.2`} stroke={brown} strokeWidth="1.1" /></g>);
    if (k === "dots") return (<g fill={cream}>{[[16, 48], [22, 46], [28, 50], [20, 53], [26, 55], [14, 52]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.4" />)}</g>);
    return (<g fill="none"><path d="M40 46L64 40" stroke={cream} strokeWidth="3.6" /><path d="M40 43.4L64 37.4M40 48.6L64 42.6" stroke={brown} strokeWidth=".9" /></g>);
  };
  return (
    <g>
      <defs>{shards.map((s, i) => <clipPath key={i} id={`${u}s${i}`}><path d={s.d} /></clipPath>)}</defs>
      {shards.map((s, i) => {
        const [cx, cy] = s.c;
        return (
          <g key={i}>
            <path d={s.d} fill={clay} />
            <g clipPath={`url(#${u}s${i})`}>
              {deco(s.deco, s.c)}
              <path d={`M${cx + 3} ${cy - 40}H${cx + 50}V${cy + 40}H${cx - 12}Z`} fill="#000" fillOpacity=".17" />
            </g>
            <path d={s.d} fill="none" {...OS} />
          </g>
        );
      })}
      {chips.map((d, i) => <g key={i}><path d={d} fill={clay} {...OS} strokeWidth="1.2" /><path d={d} fill="#000" fillOpacity=".12" /></g>)}
      <path d="M10 22L16 17.4M39 13.6L48 11M12 47.6L20 45.8" fill="none" stroke="#f3a07a" strokeWidth="1.1" strokeLinecap="round" />
    </g>
  );
}

/** LOW. Round floor pouf you sit on, in the LOW-furniture camera and kept low (about knee height, below a SHORT prop's
 *  top) so it does not look like the flat square CUSHION: a squat terracotta drum with a lighter quilted top seen from
 *  above (cream piping, creases running out from a brass button), a cream embroidered band with a teal zigzag round the
 *  waist, gore seams and the east side a shade darker. No cast shadow. */
export function FloorPillow() {
  const u = useUid();
  const red = "#c95a3f", redL = "#e07a58", redD = "#9c3f2d", cream = "#efe3c4", teal = "#2f8088", brass = "#d9a441";
  const cx = 32, rx = 19.4, ry = 8.8, yt = 37.4;
  const body = `M${cx - rx} ${yt}C${cx - rx - 2.4} ${yt + 6} ${cx - rx - 2.4} ${yt + 12} ${cx - rx + .6} ${yt + 17}Q${cx} ${yt + 26.6} ${cx + rx - .6} ${yt + 17}C${cx + rx + 2.4} ${yt + 12} ${cx + rx + 2.4} ${yt + 6} ${cx + rx} ${yt}A${rx} ${ry} 0 0 0 ${cx - rx} ${yt}Z`;
  const top = `M${cx - rx} ${yt}A${rx} ${ry} 0 0 1 ${cx + rx} ${yt}A${rx} ${ry} 0 0 1 ${cx - rx} ${yt}Z`;
  const bandA = `M${cx - rx - 3} ${yt + 8.6}Q${cx} ${yt + 17.6} ${cx + rx + 3} ${yt + 8.6}`;
  const bandB = `M${cx - rx - 3} ${yt + 15.4}Q${cx} ${yt + 24.4} ${cx + rx + 3} ${yt + 15.4}`;
  const zig = Array.from({ length: 10 }, (_, i) => `${i ? "L" : "M"}${r2(cx - rx + 1.8 + i * 4)} ${r2(yt + 11.6 + (i % 2 ? 1.6 : -.2) + Math.sin(((i * 4 + 1.8) / (rx * 2)) * Math.PI) * 4.6)}`).join("");
  return (
    <g>
      <defs><clipPath id={`${u}b`}><path d={body} /></clipPath><clipPath id={`${u}t`}><path d={top} /></clipPath></defs>
      <path d={body} fill={red} />
      <g clipPath={`url(#${u}b)`}>
        <path d={`M${cx + 12} 24C${cx + 14} 40 ${cx + 14} 52 ${cx + 8} 64H80V24Z`} fill={redD} />
        {/* embroidered band round the waist */}
        <path d={`${bandA}V${yt + 15.4}Q${cx} ${yt + 24.4} ${cx - rx - 3} ${yt + 15.4}Z`} fill={cream} />
        <path d={`M${cx + 12} ${yt + 10.6}Q${cx + 16} ${yt + 11.6} ${cx + 22} ${yt + 11}V${yt + 18}Q${cx + 16} ${yt + 21} ${cx + 12} ${yt + 20.4}Z`} fill="#000" fillOpacity=".16" />
        <path d={`${bandA}${bandB}`} {...IS} />
        <path d={zig} fill="none" stroke={teal} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
      </g>
      {/* gore seams */}
      <path d={`M${cx - 10} ${yt + 6.2}V${yt + 9.2}M${cx + 3} ${yt + 8.4}V${yt + 10.8}M${cx - 10} ${yt + 18.4}V${yt + 21.6}M${cx + 3} ${yt + 20.2}V${yt + 23}`} {...IS} strokeOpacity=".5" />
      <path d={body} fill="none" {...OS} />
      {/* the quilted top */}
      <path d={top} fill={redL} {...OS} />
      <g clipPath={`url(#${u}t)`}><path d={`M${cx + 8} ${yt - ry - 2}L${cx + rx + 4} ${yt - ry - 2}V${yt + ry + 2}H${cx + 1}Q${cx + 10} ${yt + 3} ${cx + 8} ${yt - ry - 2}Z`} fill={red} /></g>
      <ellipse cx={cx} cy={yt} rx={rx - 2.6} ry={ry - 1.6} fill="none" stroke={cream} strokeWidth="1.1" strokeDasharray="3 1.6" />
      <path d={`M${cx} ${yt}L${cx - 9} ${yt - 3.4}M${cx} ${yt}L${cx + 9} ${yt - 3.4}M${cx} ${yt}L${cx - 9} ${yt + 3.6}M${cx} ${yt}L${cx + 9} ${yt + 3.6}M${cx} ${yt}V${yt - 6}M${cx} ${yt}V${yt + 6}`} {...IS} strokeOpacity=".5" />
      <path d={`M${cx - 15} ${yt - 2.6}Q${cx - 11} ${yt - 6.6} ${cx - 5} ${yt - 7}`} fill="none" stroke="#f4a98a" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx={cx} cy={yt} r="2.1" {...IS} fill={brass} />
    </g>
  );
}

/* ---- STREET (3): TRASH_BAG, CARDBOARD_BOX, GRAFFITI ---- */

/** LOW. Black bin bag lying on the ground, seen from above (art/STYLE.md, LOW props): a slumped lumpy bag in charcoal
 *  with a darker lower-right half, one glossy highlight, creases radiating from the twisted knot at the north end, and a
 *  crushed can beside it. Flush with the floor, no shadow. */
export function TrashBag() {
  const u = useUid();
  const bag = "#3c424e", bagL = "#7d879b";
  const body = "M30.4 19.6C24.6 20.6 19 22.4 15.4 26.4C10.6 30.6 9 37.4 10.8 43C12.8 49.4 19.6 53.4 26.6 53.8C33.8 55.8 42 54.4 47.4 49.6C53.2 45 55.2 37.6 52.6 31.6C50.2 26 44 22.6 37.4 20.6C35.6 20 33.4 19.2 30.4 19.6Z";
  return (
    <g>
      <defs><clipPath id={`${u}b`}><path d={body} /></clipPath></defs>
      <path d={body} fill={bag} {...OS} />
      <g clipPath={`url(#${u}b)`}><path d="M60 24C50 36 40 46 22 62H66Z" fill="#000" fillOpacity=".3" /></g>
      <path d="M31.4 24C26 30 18.6 31.6 14 31M32.4 24C38.4 30 46 29.6 51.4 30.4M31.6 26C30.6 34 33.6 44 33.6 53" {...IS} strokeOpacity=".6" />
      <path d="M14.6 40C14 35 16.6 30.4 22 28.4" fill="none" stroke={bagL} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16.4 45.4Q22 51 29 51.4" fill="none" stroke={bagL} strokeWidth="1.2" strokeLinecap="round" strokeOpacity=".8" />
      {/* the twisted knot with two loose ears */}
      <path d="M30 21.4C26 17.2 26.6 11.6 30.6 9.8C33.6 12.4 33.6 17 32.8 21Z" fill={bag} {...OS} />
      <path d="M33.4 21.4C37.6 18 40.8 12.8 38 9.8C35 10.2 33 14.6 32.4 21Z" fill={bag} {...OS} />
      <ellipse cx="31.8" cy="22" rx="3.6" ry="2.2" fill={bag} {...OS} />
      <path d="M29.8 22.2Q31.8 23.4 33.8 22" {...IS} />
      {/* crushed can */}
      <g transform="translate(52.4 54) rotate(34)">
        <rect x="-3.2" y="-5.2" width="6.4" height="10.4" rx="1.6" fill="#c3c9d2" {...OS} strokeWidth="1.1" />
        <path d="M-3.2 -1.4H3.2V1.8H-3.2Z" {...IS} fill="#d1453b" />
        <path d="M-1.6 -4V-2.8" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
      </g>
    </g>
  );
}

/** SHORT. Open cardboard box at knee-to-waist height, in the waist-height camera: a tan box with its dark inside and a
 *  crumpled sheet showing from above, the back flap leaning up, the left flap drooping out, the front flap folded over
 *  with a strip of packing tape, a shipping label and print marks on the front, the east side a shade darker. Sight
 *  passes over it. */
export function CardboardBox() {
  const card = "#c79a62", cardL = "#e1bb82", cardD = "#9c7242", inner = "#4d3822", tape = "#ead9a4", paper = "#efe6cf";
  const x = 14, y = 34, w = 30, h = 22, dx = 6, dy = 12;
  return (
    <g>
      <GroundShadow cx={35} cy={57} rx={23} ry={3.4} />
      {/* back flap leaning up, left flap drooping out */}
      <path d={polyD([x + dx + .6, y - dy], [x + w + dx - .6, y - dy], [x + w + dx - 3.4, y - dy - 7], [x + dx + 3.2, y - dy - 7])} fill={cardL} {...OS} />
      <path d={polyD([x, y - .4], [x + dx, y - dy], [x + dx - 7, y - dy + 3.4], [x - 7, y + 3.4])} fill={cardL} {...OS} />
      {/* east side, with its flap folded over the upper part */}
      <path d={slabSide(x, y, w, h, dx, dy)} fill={cardD} {...OS} />
      <path d={polyD([x + w, y], [x + w + dx, y - dy], [x + w + dx, y - dy + 7], [x + w, y + 7])} {...IS} fill={card} />
      {/* open top: the dark inside with a crumpled sheet */}
      <path d={slabTop(x, y, w, dx, dy)} fill={inner} {...OS} />
      <path d="M21.4 27.6C23 24.6 27 24.2 28.6 26.4C30.6 24.8 34 25.6 34.4 28C36 29 34.4 31.6 31.6 31.2C29.6 32.4 26 32.4 24.4 31C21.8 31 20.4 29.4 21.4 27.6Z" {...IS} fill={paper} />
      {/* front with the flap folded over */}
      <path d={inkBox(x, y, w, h, 1, .3)} fill={card} {...OS} />
      <path d={inkBox(x, y, w, 8, 1, .2)} {...IS} fill={cardL} />
      <path d={inkBox(x + w / 2 - 2.4, y, 4.8, 14.6, .6, 0)} {...IS} fill={tape} />
      <path d={inkBox(x + 3, y + 11.4, 10, 7.6, .8, 0)} {...IS} fill={paper} />
      <path d={`M${x + 4.6} ${y + 14.2}H${x + 11.4}M${x + 4.6} ${y + 16.4}H${x + 9.4}`} {...IS} strokeOpacity=".7" />
      <path d="M38.4 49.4V43.4M36.6 45.2L38.4 43.2L40.2 45.2M38.4 53.4H41.8" {...IS} />
    </g>
  );
}

/** LOW. Graffiti sprayed on the pavement, flat from above, no shadow (front-end-only, STREET): a looping spray-paint
 *  tag in magenta (a fat cursive scrawl of loops and a zigzag, an abstract signature) with a cream outline band and an ink edge over a pale
 *  overspray haze, a teal swoosh arrow underlining it, a yellow three-point crown above it and loose spray dots round
 *  it. The bright colours and the cream band read on asphalt and cobble alike. */
export function Graffiti() {
  const pink = "#e0457b", pinkL = "#f59ab8", cream = "#fbf3dc", teal = "#2fb3a8", tealD = "#1d7f78", yellow = "#f4c430";
  // the tag: one looping scrawl from west to east
  const tag = "M7.4 36.4C9.4 27 15 19.6 18.6 22.2C22 24.8 16.4 36 13.4 40.4C17.6 33.6 22.6 27.4 25.6 29.6C28.2 31.6 24.4 38.4 26.6 39.6"
    + "C29.6 41 33 27.6 35.6 22.6C37 27.8 34.4 37.4 37.6 39.4C40 40.6 41.6 33 43.4 29.4L46.4 38.4L50 28.2L52.8 36.4C54.4 34.2 56 31.6 58.4 29.6";
  const arrow = "M9.6 48.6C21 53.8 36 53.4 49.6 46.6";
  const crown = "M25.6 15.4L24.4 6.4L29 10.4L32.2 4.6L35.4 10.4L40 6.4L38.8 15.4Z";
  return (
    <g>
      {/* overspray haze */}
      <path d={tag} fill="none" stroke={pink} strokeOpacity=".16" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      {/* the swoosh arrow under the tag */}
      <path d={arrow} fill="none" stroke={INK} strokeWidth="6" strokeLinecap="round" />
      <path d="M47 41.2L56.6 43.6L49.6 50.6Z" fill={teal} {...OS} />
      <path d={arrow} fill="none" stroke={teal} strokeWidth="3" strokeLinecap="round" />
      <path d="M13 50.6C23 53.8 34 53.6 44 50" fill="none" stroke={tealD} strokeWidth=".9" strokeLinecap="round" />
      {/* the tag: ink edge, cream band, magenta stroke, a lighter core */}
      <path d={tag} fill="none" stroke={INK} strokeWidth="8.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d={tag} fill="none" stroke={cream} strokeWidth="6.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d={tag} fill="none" stroke={pink} strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.4 33C11 27.4 14.4 23 17 23.4M28.4 36.4C30.6 31.6 32.6 27 34.8 24.6" fill="none" stroke={pinkL} strokeWidth="1.1" strokeLinecap="round" />
      {/* the crown above it */}
      <path d={crown} fill={yellow} {...OS} />
      <path d="M26 13H38.4" {...IS} />
      {/* loose spray dots */}
      {[[6, 22, 1.2, pink], [57.4, 22.6, 1, pink], [16.6, 12, 1.1, teal], [59, 38.6, .9, yellow], [5, 45, 1, teal], [47.6, 16, .8, yellow], [52.6, 55.6, 1, pink]].map(([x, y, r, c]) => <circle key={x} cx={x} cy={y} r={r} fill={c} {...IS} strokeWidth=".6" />)}
    </g>
  );
}

/* ====================================================================== */
/*  NEW ART (art/STYLE.md, art direction 2026-10-28): HORSE, OAK and the     */
/*  batches below. Flat fills, inked                                        */
/*  outline (OS 1.5, IS 0.9), flat ground shadow. art/props/<ID>.svg       */
/* ====================================================================== */

/** PERCH. Saddled dun horse in profile, facing east (designed with Brush; source art/props/HORSE.svg). Long legs and a
 *  short arched neck keep the head clear of the tile centre, where the saddle sits on the middle of the back, so a
 *  placed token rides it; head and ears, tail and hooves stay visible round the token. Hoof line at y 58. */
export function Horse() {
  const coat = "#b08d63", coatD = "#86684a", mane = "#3b2f27", hoof = "#5b4a3e";
  const cloth = "#c45970", clothD = "#93404f", leather = "#5a3a2a", leatherL = "#8a5f45", metal = "#9a9ca0";
  // one long leg (full at the top, a slight knee at y 45, a slimmer cannon) on its hoof
  const leg = (x, fill) => {
    const f = (n) => +n.toFixed(2), w = 4.4;
    return (
      <g key={x}>
        <path d={`M${f(x - .6)} 33L${f(x + w + .6)} 33L${f(x + w + .1)} 45L${f(x + w - .3)} 53.8L${f(x + .3)} 53.8L${f(x - .1)} 45Z`} fill={fill} {...OS} />
        <rect x={f(x - .2)} y="53.4" width={f(w + .4)} height="4.3" rx="1.1" fill={hoof} {...OS} />
      </g>
    );
  };
  return (
    <g>
      <ellipse cx="32" cy="58" rx="21" ry="3" fill="#000" fillOpacity=".34" />
      {/* far legs one shade down, the tail, then the near legs */}
      {[22.4, 44.2].map((x) => leg(x, coatD))}
      <path d="M14 22.6C7.6 22.2 3.8 28 4.4 36.4C4.8 40.4 6.2 43.4 7.8 45.4C8.6 40 10.6 34.6 15.2 29.6Z" fill={mane} {...OS} />
      {[15.8, 38.4].map((x) => leg(x, coat))}
      {/* barrel and its shaded belly */}
      <path d="M12.6 26.8C12.6 21 17.8 18.2 25.4 18.2H39.4C46.4 18.2 50 21.6 50 26.4C50 32.6 46.2 36.6 38.2 36.6H22.6C15.8 36.6 12.6 32.6 12.6 26.8Z" fill={coat} {...OS} />
      <path d="M14.6 31.8C16.4 35 19.6 36.4 23.4 36.4H38C43.4 36.4 47.2 34.4 48.9 31.2C43.6 33.4 37.6 34 30.6 34C23.2 34 18.2 33.4 14.6 31.8Z" fill={coatD} />
      {/* short arched neck, wedge head with the muzzle down to the east, ear, eye, nostril, mane on the crest */}
      <path d="M39.4 23.6C41 18.4 44.4 13.8 49.2 10.6L55.4 13.4C54 17.6 53 22 51.4 27.8C47.2 28 42.6 26.6 39.4 23.6Z" fill={coat} {...OS} />
      <path d="M48.4 11.2C49.8 7.2 54.6 6.2 57.2 8.4L62.2 17C63.3 20.1 61.6 22.6 58.4 22L54.4 20.2C51.4 18.8 48.8 15.8 48.4 11.2Z" fill={coat} {...OS} />
      <path d="M59.6 16.4L62.2 17C63.3 20.1 61.6 22.6 58.4 22L56.6 21.2Z" fill={coatD} />
      <path d="M50 9.4L49.6 4.7L53.1 7.6Z" {...IS} fill={coat} />
      <circle cx="54.2" cy="11.8" r="1.1" fill={INK} />
      <circle cx="60.6" cy="19.4" r=".65" fill={INK} />
      <path d="M48.6 9.8C45 13 42.2 17.6 39.8 23.4L42.8 24.8C45 19.8 47.6 15.4 51.2 12Z" {...IS} fill={mane} />
      {/* the seat: saddle cloth, saddle (pommel, dipped seat, cantle), strap and stirrup */}
      <rect x="22.8" y="17.8" width="15.6" height="12.2" rx="2" fill={cloth} {...OS} />
      <rect x="23.6" y="26.4" width="14" height="2.8" rx="1" fill={clothD} />
      <path d="M22.8 17.6C22.6 14.2 25 13.8 26.2 16.2C28.2 19.4 33.2 19.4 35.2 16.2L37.2 13.2C39.3 13 40.4 14.4 39.4 17.6C38.3 22.4 34.4 25.4 30.4 25.4C26.2 25.4 22.9 22.6 22.8 17.6Z" fill={leather} {...OS} />
      <ellipse cx="30.6" cy="20.6" rx="3.8" ry="1.3" fill={leatherL} />
      <path d="M30.4 25.4V32.6" {...IS} />
      <rect x="28" y="32.6" width="4.8" height="2.8" rx=".8" {...IS} fill={metal} />
    </g>
  );
}

/** TALL. Oak: a broad, lobed crown on a massive trunk with flared roots, and two thick low branches reaching out
 *  under the crown. About 56 units tall, well above a standing token. */
export function Oak() {
  const u = useUid();
  const leaf = "#5f8a3e", leafD = "#41632b", leafL = "#86ad5a", bark = "#7a6048", barkD = "#54402f";
  const crown = "M8 32A7 7 0 0 1 4 21A9 9 0 0 1 12 8.6A10.5 10.5 0 0 1 29 3.4A10 10 0 0 1 45 4.4A9 9 0 0 1 56.4 12.6"
    + "A8 8 0 0 1 59.6 25A7 7 0 0 1 53 33.4A7 7 0 0 1 42 33.6A8 8 0 0 1 31 34.4A7 7 0 0 1 20 34A7 7 0 0 1 8 32Z";
  return (
    <g>
      <defs><clipPath id={`${u}k`}><path d={crown} /></clipPath></defs>
      <GroundShadow cx={32} cy={57} rx={25} ry={4.2} />
      {/* low branches, then the trunk over their roots */}
      <path d="M27 42C21.6 40 15.6 36.4 10.4 30.6L14 28.6C18.4 32.4 23.4 34.6 28 35.6Z" fill={bark} {...OS} />
      <path d="M37.6 39.6C43 37.6 48.6 34 53.6 28.4L56 32C51 37 44.4 41 38 43.6Z" fill={barkD} {...OS} />
      <path d="M19.4 57.4C23.6 55.6 25.4 51 25.6 44L26 30H38.6L39 44C39.2 51 41 55.6 45.2 57.4Q39.8 56.2 37 57.6Q34.6 56.2 32.4 57.8Q29.6 56.2 27.4 57.6Q24.6 56.2 19.4 57.4Z" fill={bark} {...OS} />
      <path d="M34.6 31L35 44C35.2 50 36.6 54.4 39.4 56.8Q38 56.6 37 57.6Q36 57 34.8 56.8C33.2 53 32.6 49 32.6 44L32.6 31Z" fill={barkD} />
      <path d="M29.4 38.6C29 42.4 29.4 46.4 28.4 50M35.6 36.2C35.4 38.8 35.8 40.6 36.6 42.4" {...IS} />
      {/* crown: base, a darker underside, one lit lobe, a few clump marks, then the outline */}
      <path d={crown} fill={leaf} />
      <g clipPath={`url(#${u}k)`}>
        <path d="M0 26C10 21 18 28 27 24C36 28 44 21 52 25C56 23 60 24 64 23V40H0Z" fill={leafD} />
        <path d="M7.6 17.4A9 9 0 0 1 19.6 7.4A8.6 8.6 0 0 0 11.4 18.6Z" fill={leafL} />
      </g>
      <path d="M17 19.6A6.4 6.4 0 0 1 25.6 16.4M33 14.4A6.4 6.4 0 0 1 41.8 12.2M42.4 25.4A6 6 0 0 1 50.6 22.2M23.6 28.6A5.6 5.6 0 0 1 31.4 26.4" {...IS} />
      <path d={crown} fill="none" {...OS} />
      {/* two acorns under the crown */}
      {[[17.4, 36.4], [47, 36.8]].map(([ax, ay]) => (
        <g key={ax}>
          <ellipse cx={ax} cy={ay + 1.6} rx="1.5" ry="1.9" {...IS} fill="#b88a4e" />
          <path d={`M${ax - 1.9} ${ay + .9}Q${ax} ${ay - 1.4} ${ax + 1.9} ${ay + .9}Z`} {...IS} fill="#5a4130" />
        </g>
      ))}
    </g>
  );
}

/* ---- LOW furniture camera (art/STYLE.md, LOW props, 2026-10-29) ---------------------------------------------
 * Sofa, bench and barber chair stand in the same oblique as the desk and stove, kept low: P(x across, z back, h up)
 * maps to the board with depth receding up-right by (kx, ky) per unit, ky > kx. Faces: top lightest, front mid-tone,
 * east darkest; no cast shadow. */
/** Round to 2 decimals for path data. */
export const r2 = (n) => +n.toFixed(2);
/** Closed polygon path `d` through [x, y] points. */
export const polyD = (...pts) => `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join("L")}Z`;
/** The LOW-furniture camera: floor line y0 at z = 0. */
export const lowCam = (y0, kx = .25, ky = .52) => (x, z, h) => [x + z * kx, y0 - h - z * ky];
/** Top face at height h over x xa..xb and depth z0..z1. */
export const camTop = (P, xa, xb, z0, z1, h) => polyD(P(xa, z0, h), P(xa, z1, h), P(xb, z1, h), P(xb, z0, h));
/** East (or inner) face in the plane x, over depth z0..z1 and height h0..h1. */
export const camSide = (P, x, z0, z1, h0, h1) => polyD(P(x, z0, h0), P(x, z0, h1), P(x, z1, h1), P(x, z1, h0));
/** Front face at depth z (a hand-inked rounded box, since fronts stay upright in this camera). */
export const camFront = (P, xa, xb, z, h0, h1, r = 1.5) => {
  const [ax, ay] = P(xa, z, h1), [, by] = P(xa, z, h0);
  return inkBox(r2(ax), r2(ay), r2(xb - xa), r2(by - ay), r, .3);
};

/** LOW. Teal velvet sofa in the oblique camera of the desk and stove, kept low (art/STYLE.md, LOW props): seat cushions
 *  seen from slightly above at knee height, a low back and rolled arms no higher than the top of a SHORT prop, short
 *  wooden feet, no cast shadow. One object per span. Along a row (cw >= ch, the 1x1 too) the back runs along the north
 *  side with an arm at each end and one seat cushion per tile (two on the 1x1). Down a column (ch > cw) it is the same
 *  sofa turned 90°: the back runs along the west side, its reclined cushion face seen from above, and the arms close the
 *  north and south ends, the south arm facing the viewer. Faces: tops lightest, fronts mid-tone, east faces darkest. */
export function SofaSpan({ cw = 1, ch = 1 }) {
  const lit = "#9cc4c0", base = "#76a4a2", shade = "#527f7d", tuft = "#2f4f4d", foot = "#4f301b";
  const W = 64 * cw, H = 64 * ch;
  const hF = 3, hC = 9, hS = 14, hA = 20, hB = 25; // frame bottom, cushion bottom, seat top, arm top, back top
  const dot = (key, [x, y]) => <circle key={key} cx={r2(x)} cy={r2(y)} r="1.15" fill={tuft} />;
  if (ch <= cw) {
    // along a row: x across, z back from the front edge, h up; depth recedes up-right like the desk's top
    const P = lowCam(57), x0 = 4, x1 = W - 8, aw = cw > 1 ? 10 : 8, zb = 19, D = 26, sx0 = x0 + aw, sx1 = x1 - aw;
    const top = (...a) => camTop(P, ...a), side = (...a) => camSide(P, ...a), front = (...a) => camFront(P, ...a);
    const n = Math.max(2, cw), cush = Array.from({ length: n }, (_, k) => [sx0 + ((sx1 - sx0) * k) / n, sx0 + ((sx1 - sx0) * (k + 1)) / n]);
    const feet = [x0 + 1.5, x1 - 5.5, ...(cw > 1 ? Array.from({ length: cw - 1 }, (_, k) => 64 * (k + 1) - 4) : [])];
    return (
      <g>
        {feet.map((fx) => <path key={fx} d={front(fx, fx + 4, 1, -.6, hF + 1, 1)} fill={foot} {...OS} />)}
        {/* the back: east end, top, then its cushioned front with a seam and buttons per seat */}
        <path d={side(x1, zb, D, hF, hB)} fill={shade} {...OS} />
        <path d={top(x0, x1, zb, D, hB)} fill={lit} {...OS} />
        <path d={front(x0, x1, zb, hF, hB, 3)} fill={base} {...OS} />
        {cush.slice(1).map(([c0]) => { const [ax, ay] = P(c0, zb, hB - 1.5), [, by] = P(c0, zb, hS); return <path key={c0} d={`M${r2(ax)} ${r2(ay)}V${r2(by)}`} {...IS} />; })}
        {cush.flatMap(([c0, c1], k) => (c1 - c0 > 15 ? [.3, .7] : [.5]).map((t) => dot(`b${k}${t}`, P(c0 + (c1 - c0) * t, zb, (hS + hB) / 2 + .5))))}
        {/* west arm: inner face, top, rolled front */}
        <path d={side(sx0, 0, zb, hF, hA)} fill={shade} {...OS} />
        <path d={top(x0, sx0, 0, zb, hA)} fill={lit} {...OS} />
        <path d={front(x0, sx0, 0, hF, hA, 3.4)} fill={base} {...OS} />
        {/* seat: frame rail, then one cushion per seat (top, then its front) */}
        <path d={front(sx0, sx1, 0, hF, hC + .5, 1)} fill={shade} {...OS} />
        {cush.map(([c0, c1], k) => (
          <g key={k}>
            <path d={top(c0 + .5, c1 - .5, .4, zb, hS)} fill={lit} {...OS} />
            <path d={front(c0 + .5, c1 - .5, 0, hC, hS, 2)} fill={base} {...OS} />
          </g>
        ))}
        {/* east arm: outer face, top, rolled front */}
        <path d={side(x1, 0, zb, hF, hA)} fill={shade} {...OS} />
        <path d={top(sx1, x1, 0, zb, hA)} fill={lit} {...OS} />
        <path d={front(sx1, x1, 0, hF, hA, 3.4)} fill={base} {...OS} />
      </g>
    );
  }
  // down a column: z runs north along the column (one unit of screen per unit of sofa, no sideways lean, so every face
  // is a rounded box), x across, h up. The back is on the west, the seat faces east; the east faces show as dark bands.
  const Yf = H - 4, L = Yf - hB - 5, Y = (z, h) => Yf - h - z;
  const xb0 = 9, xb1 = 15, xc = 24, xs1 = 52, az = 8, z0 = az, z1 = L - az; // back top strip, reclined back face, seat; arm depth
  const box = (xa, xb, ya, yb, r) => inkBox(xa, r2(ya), xb - xa, r2(yb - ya), r, .3);
  const cush = Array.from({ length: ch }, (_, k) => [z0 + ((z1 - z0) * k) / ch, z0 + ((z1 - z0) * (k + 1)) / ch]);
  return (
    <g>
      {[xb0 + 1, xs1 - 5].map((fx) => <path key={fx} d={box(fx, fx + 4, Y(1, hF + 1), Y(1, -.6), 1)} fill={foot} {...OS} />)}
      {/* the back: top strip, the reclined cushion face with buttons, and its end profile at the south */}
      <path d={box(xb0, xb1 + 1, Y(L, hB), Y(0, hB) + 2, 2.4)} fill={lit} {...OS} />
      <path d={polyD([xb1, Y(L, hA)], [xc, Y(L, hS)], [xc, Y(0, hS)], [xb1, Y(0, hB)])} fill={base} {...OS} />
      {cush.flatMap(([c0, c1], k) => [.3, .7].map((t) => dot(`b${k}${t}`, [(xb1 + xc) / 2, Y(c0 + (c1 - c0) * t, (hS + hB) / 2)])))}
      <path d={polyD([xb0, Y(0, hF)], [xb0, Y(0, hB) + 1.5], [xb0 + 1.5, Y(0, hB)], [xb1, Y(0, hB)], [xc, Y(0, hS)], [xc, Y(0, hF)])} fill={base} {...OS} />
      {/* seat: the front of the seat as an east band, then one cushion per tile */}
      <path d={box(xs1 - 2, xs1 + 3, Y(z1, hS) + 1, Y(z0, hF), 1.4)} fill={shade} {...OS} />
      {cush.map(([c0, c1], k) => <path key={k} d={box(xc, xs1, Y(c1 - .6, hS), Y(c0 + .6, hS), 2.6)} fill={lit} {...OS} />)}
      {/* north arm: east band, its inner face toward the seat, its top */}
      <path d={box(xs1 - 2, xs1 + 4, Y(L, hA) + 1, Y(z1, hF) - 1, 2)} fill={shade} {...OS} />
      <path d={box(xb1, xs1, Y(z1, hA), Y(z1, hS) + 1, 1.6)} fill={base} {...OS} />
      <path d={box(xb1, xs1, Y(L, hA), Y(z1, hA), 3.4)} fill={lit} {...OS} />
      {/* south arm: east band, top, rolled front facing the viewer */}
      <path d={box(xs1 - 2, xs1 + 4, Y(z0, hA) + 1, Y(0, hF), 2)} fill={shade} {...OS} />
      <path d={box(xb1, xs1, Y(z0, hA), Y(0, hA) + 1, 3.4)} fill={lit} {...OS} />
      <path d={box(xb1, xs1, Y(0, hA), Y(0, hF), 3.4)} fill={base} {...OS} />
    </g>
  );
}
export const Sofa = () => <SofaSpan cw={1} ch={1} />;

/* ---- MANSION batch 1 (case7): new-art SHORT and TALL props ----------------------------------------------
 * SHORT props stand in a steep oblique: the top plane recedes up-right by (dx, dy) with dy > dx, so the top surface
 * reads clearly while the front face stays low (about 20 units, against the ~54 of a TALL prop). */
/** Top plane of a box whose front face starts at (x, y) and is w wide, receding by (dx, dy). Path `d`. */
export const slabTop = (x, y, w, dx, dy) => `M${x} ${y}L${x + dx} ${y - dy}H${x + w + dx}L${x + w} ${y}Z`;
/** East face of a box (front face x, y, w, h) receding by (dx, dy). Path `d`. */
export const slabSide = (x, y, w, h, dx, dy) => `M${x + w} ${y}L${x + w + dx} ${y - dy}V${y + h - dy}L${x + w} ${y + h}Z`;
/** A quad on a top plane: P maps (u across, v back) in 0..1 to a point. Path `d`. */
const planeQuad = (P, u0, v0, u1, v1) => `M${P(u0, v0)}L${P(u1, v0)}L${P(u1, v1)}L${P(u0, v1)}Z`;

/** SHORT. Walnut writing desk at waist height: a deep top with a green leather blotter, a letter and an inkwell
 *  with a quill; two drawer pedestals with brass pulls and a dark kneehole between them. */
export function Desk() {
  const wood = "#7a4c2c", woodL = "#9c6a42", woodD = "#4f301b", hole = "#2b1a10", leather = "#4c7a5e", brass = BRASS, paper = "#f2ece0";
  const x = 7, y = 33, w = 44, dx = 6, dy = 13; // desktop: front edge y 33, back edge y 20
  const P = (u, v) => [+(x + u * w + v * dx).toFixed(2), +(y - v * dy).toFixed(2)];
  const [ix, iy] = P(.86, .55);
  return (
    <g>
      <GroundShadow cx={33} cy={57} rx={25} ry={3.4} />
      {/* kneehole back panel, then the east side of the right pedestal */}
      <path d="M23 37H35V50H23Z" {...IS} fill={hole} />
      <path d={slabSide(35, 37, 14, 19, 5, 11)} fill={woodD} {...OS} />
      {[9, 35].map((px) => <path key={px} d={inkBox(px, 37, 14, 19, 1.2, .3)} fill={wood} {...OS} />)}
      {/* drawers: three on the left; a drawer over a door on the right */}
      <path d="M11 43.4H21M11 49.8H21M37 43.4H47" {...IS} />
      <path d={inkBox(37.6, 45.6, 8.8, 8.4, .8, .2)} {...IS} />
      {[[16, 40.4], [16, 46.7], [16, 53], [42, 40.4]].map(([kx, ky]) => <circle key={`${kx}${ky}`} cx={kx} cy={ky} r="1.5" fill={brass} />)}
      <circle cx="44.6" cy="49.8" r="1.2" fill={brass} />
      {/* desktop: east side, top, front edge with the middle drawer */}
      <path d={slabSide(x, y, w, 4, dx, dy)} fill={woodD} {...OS} />
      <path d={slabTop(x, y, w, dx, dy)} fill={woodL} {...OS} />
      <path d={inkBox(x, y, w, 4.2, 1, .2)} fill={wood} {...OS} />
      <path d="M25.6 35.2H32.4" stroke={brass} strokeWidth="1.4" strokeLinecap="round" />
      {/* blotter, letter, inkwell and quill */}
      <path d={planeQuad(P, .07, .18, .7, .84)} {...IS} fill={leather} />
      <path d={planeQuad(P, .28, .3, .52, .74)} {...IS} fill={paper} />
      <path d={inkBox(ix - 2.8, iy - 3.2, 5.6, 4.6, 1.6, .2)} fill={INK} />
      <path d={`M${ix + .4} ${iy - 3.2}C${ix + 1.2} ${iy - 7} ${ix + 3.4} ${iy - 10.4} ${ix + 6.6} ${iy - 12.4}C${ix + 5.6} ${iy - 8.4} ${ix + 3.6} ${iy - 5.4} ${ix + .4} ${iy - 3.2}Z`} {...IS} fill={paper} />
    </g>
  );
}

/** SHORT. Cream enamel kitchen range at waist height: a black iron hob with four burners (one glowing) under a low
 *  backguard, a row of knobs, a brass towel rail, an oven door with a window and a side warming door, iron feet. */
export function Stove() {
  const enamel = "#e4d6b0", enamelD = "#b3a077", iron = "#3a3a42", ironL = "#6e6e78", glow = "#e0703a", brass = BRASS;
  const x = 9, y = 32, w = 40, h = 22, dx = 6, dy = 13; // body front 9..49 × 32..54, hob back edge y 19
  const P = (u, v) => [+(x + u * w + v * dx).toFixed(2), +(y - v * dy).toFixed(2)];
  return (
    <g>
      <GroundShadow cx={33} cy={57} rx={24} ry={3.4} />
      {[11, 43].map((fx) => <path key={fx} d={inkBox(fx, 52, 4.6, 5, 1, .2)} fill={iron} {...OS} />)}
      {/* backguard along the back edge, then body side, hob and front */}
      <path d={inkBox(x + dx, y - dy - 5, w, 5.6, 1.2, .2)} fill={enamel} {...OS} />
      <path d={slabSide(x, y, w, h, dx, dy)} fill={enamelD} {...OS} />
      <path d={slabTop(x, y, w, dx, dy)} fill={iron} {...OS} />
      <path d={inkBox(x, y, w, h, 1.4, .4)} fill={enamel} {...OS} />
      {[[.26, .3], [.7, .3], [.3, .74], [.74, .74]].map(([u, v], i) => {
        const [bx, by] = P(u, v);
        return (
          <g key={i}>
            <ellipse cx={bx} cy={by} rx="5.6" ry="2.9" {...IS} fill={ironL} />
            <ellipse cx={bx} cy={by} rx="2.6" ry="1.3" fill={i === 1 ? glow : iron} />
          </g>
        );
      })}
      {/* control row: four knobs */}
      {[15, 23, 31, 39].map((kx) => <circle key={kx} cx={kx} cy="34.8" r="1.6" fill={iron} />)}
      {/* towel rail on two brackets */}
      <path d="M13 37.4V39.4M45 37.4V39.4" {...IS} />
      <path d={inkBox(10.5, 36.8, 37, 2.4, 1.2, 0)} {...IS} fill={brass} />
      {/* oven door with window, side warming door */}
      <path d={inkBox(12, 40.6, 24, 11.4, 1.2, .3)} {...IS} />
      <path d={inkBox(15.4, 43.4, 17.2, 6, 1, .2)} {...IS} fill={iron} />
      <path d="M17.6 45L20.2 48" stroke={ironL} strokeWidth="1.4" strokeLinecap="round" />
      <path d={inkBox(38.4, 40.6, 8, 11.4, 1.2, .3)} {...IS} />
      <circle cx="40.6" cy="46.3" r="1" fill={iron} />
    </g>
  );
}

/** TALL. Suit of plate armour on a wooden plinth, a halberd held upright: a plain great helm (no plume), round pauldrons,
 *  breastplate with a centre ridge, a laminated skirt and greaves. Reaches the top of the tile, above head height. */
export function Armor() {
  const u = useUid();
  const steel = "#a9b0b6", steelD = "#727a81", steelL = "#e2e6e9", plinth = "#5a3820", pole = "#8a5a36", poleD = "#5e3b22";
  const chest = "M22.6 17.4Q32 15.2 41.4 17.4L41.8 27Q40.6 32.8 32 33.6Q23.4 32.8 22.2 27Z";
  // halberd, drawn upright about its shaft (x 0) from the spike (y -4) to the butt (y 47.6), then leaned so the butt
  // stands on the plinth in front of the left foot and the shaft crosses the skirt and the left greave
  const lean = `translate(15.4 4.6) rotate(-14.2)`;
  return (
    <g>
      <defs><clipPath id={`${u}c`}><path d={chest} /></clipPath></defs>
      <GroundShadow cx={32} cy={57} rx={19} ry={3.4} />
      <path d={inkBox(18, 51, 28, 6, 1.4, .3)} fill={plinth} {...OS} />
      {/* legs: greaves and sabatons (the right side in shade) */}
      <path d={inkBox(24.6, 38, 6, 11, 2.4, .3)} fill={steel} {...OS} />
      <path d={inkBox(33.4, 38, 6, 11, 2.4, .3)} fill={steelD} {...OS} />
      <path d="M22.6 52V49.6Q23 47.4 25.4 47.2H31.2V52Z" fill={steel} {...OS} />
      <path d="M41.4 52V49.6Q41 47.4 38.6 47.2H32.8V52Z" fill={steelD} {...OS} />
      {/* laminated skirt (tassets) */}
      <path d="M22.8 31H41.2L43 40.4Q32 42.2 21 40.4Z" fill={steel} {...OS} />
      <path d="M22.2 35.6Q32 37 41.8 35.6M32 37V41.4" {...IS} />
      {/* arms (the left forearm bends in toward the shaft) */}
      <path d={inkBox(41, 21, 6.4, 14, 2.6, .3)} fill={steelD} {...OS} />
      <path d="M17.6 21.4Q19.8 20.6 22.2 21.4L23.4 31.4L24.6 34.6L19.4 36.2L17.2 31.6Z" fill={steel} {...OS} />
      <path d={inkBox(40.4, 33.4, 7.6, 6, 2.2, .2)} fill={steelD} {...OS} />
      {/* breastplate: shade on the east half, a highlight on the west, a centre ridge */}
      <path d={chest} fill={steel} />
      <g clipPath={`url(#${u}c)`}>
        <path d="M32 14H44V36H32Z" fill={steelD} />
        <path d="M25.4 19.6Q27.2 18.6 28.6 19.2L27.4 28.4Q25.8 27.6 25.4 26Z" fill={steelL} />
      </g>
      <path d="M32 16.4V33.2" {...IS} />
      <path d={chest} fill="none" {...OS} />
      {/* pauldrons */}
      <path d="M15.6 24.6C15 19.4 17.8 16.4 23.6 16.4L25 22.6C22 22.4 18.8 23.2 15.6 24.6Z" fill={steel} {...OS} />
      <path d="M48.4 24.6C49 19.4 46.2 16.4 40.4 16.4L39 22.6C42 22.4 45.2 23.2 48.4 24.6Z" fill={steelD} {...OS} />
      {/* gorget and great helm with visor slit */}
      <path d={inkBox(27.6, 14, 8.8, 4, 1.4, .2)} fill={steelD} {...OS} />
      <path d="M26 15.4V8.6Q26 3.6 32 3.6Q38 3.6 38 8.6V15.4Q32 17 26 15.4Z" fill={steel} {...OS} />
      <path d="M32 3.8V16.2" {...IS} />
      <path d={inkBox(27.2, 8.6, 9.6, 2, 1, 0)} fill={INK} />
      {/* halberd in front of the body: shaft, axe blade, back spike and top spike */}
      <g transform={lean}>
        <path d="M-1.4 1H1.4V47.6H-1.4Z" fill={pole} {...OS} />
        <path d="M.5 3V46" stroke={poleD} strokeWidth="1" strokeLinecap="round" />
        <path d="M-1.2 2.4C-5.6 1.6 -9.4 3.4 -10.4 8.6C-7.6 7.4 -4.2 7.6 -1.2 9.6Z" fill={steelL} {...OS} />
        <path d="M-1.4 4.6L-5.4 5.6" {...IS} />
        <path d="M1.2 3.4L5.6 4.4L1.2 6.6Z" fill={steelL} {...OS} />
        <path d="M0 -4L1.9 1.4H-1.9Z" fill={steelL} {...OS} />
      </g>
      {/* the left gauntlet closes round the shaft */}
      <path d="M18.8 34.6Q19.2 33 21.4 33H25.2Q27 33 27 35V38Q27 39.8 25.2 39.8H21Q18.8 39.8 18.8 37.8Z" fill={steelD} {...OS} />
      <path d="M21.2 35.4H26.8M21.2 37.6H26.8" {...IS} />
    </g>
  );
}

/** TALL. Floor-to-ceiling oak wine rack: a tall cabinet of eight deep cubbies, each bottle lying in its cubby seen at an
 *  angle, so its body, shoulder and neck read and the cork points out of the rack toward the viewer (down-left, in the
 *  board camera). Dark-glass greens with two reds, one slot empty. Top and east side show, like the Safe. */
export function WineRack() {
  const wood = "#a8703f", woodL = "#c9935f", woodD = "#6e4526", cubby = "#2b1a10";
  // glass, its highlight, and the capsule over the cork
  const kinds = { g: ["#33734f", "#a6dcbc", "#d9b45a"], d: ["#265a40", "#8cc8a6", "#c45970"], r: ["#a8303f", "#f0a0aa", "#e7d8b4"] };
  const x = 13, y = 8, w = 36, h = 47, d = 5; // front 13..49 × 8..55, top to y 3, side to x 54
  const cols = 2, rows = 4, ix = 16.2, iy = 11.2, iw = w - 6.4, ih = h - 6.4, cwid = iw / cols, chei = ih / rows;
  const fill = ["g", "r", "d", "g", null, "d", "r", "g"]; // row by row; null = empty slot
  // one bottle along +x from the cork (x 0) to the base (x 12.6), centred on y 0
  const glassD = "M1.8 -1.2H4.8Q6.1 -2.8 7.9 -2.8H10.8Q12.6 -2.8 12.6 0Q12.6 2.8 10.8 2.8H7.9Q6.1 2.8 4.8 1.2H1.8Z";
  return (
    <g>
      <GroundShadow cx={33} cy={57} rx={23} ry={3.6} />
      <path d={slabSide(x, y, w, h, d, d)} fill={woodD} {...OS} />
      <path d={slabTop(x, y, w, d, d)} fill={woodL} {...OS} />
      <path d={inkBox(x, y, w, h, 1.5, .5)} fill={wood} {...OS} />
      <path d={inkBox(ix, iy, iw, ih, 1, .2)} {...IS} fill={cubby} />
      {/* shelf boards and uprights: the cubby grid */}
      {Array.from({ length: rows - 1 }, (_, r) => <path key={`h${r}`} d={inkBox(ix, iy + chei * (r + 1) - .9, iw, 1.8, .4, 0)} {...IS} fill={woodL} />)}
      {Array.from({ length: cols - 1 }, (_, c) => <path key={`v${c}`} d={inkBox(ix + cwid * (c + 1) - .9, iy, 1.8, ih, .4, 0)} {...IS} fill={woodL} />)}
      {/* bottles, tilted so the base sits back up-right and the cork comes out down-left */}
      {fill.map((k, i) => {
        if (!k) return null;
        const c = i % cols, r = Math.floor(i / cols), [glass, hi, cap] = kinds[k];
        const cx = +(ix + cwid * (c + .5) + .2).toFixed(2), cy = +(iy + chei * (r + .5) + .3).toFixed(2);
        return (
          <g key={i} transform={`translate(${cx} ${cy}) rotate(-27) translate(-6.4 0)`}>
            <path d={glassD} {...IS} fill={glass} />
            <path d="M7.8 -1.5H10.8" stroke={hi} strokeWidth="1" strokeLinecap="round" />
            <rect x="-.3" y="-1.45" width="2.6" height="2.9" rx=".6" {...IS} fill={cap} />
          </g>
        );
      })}
      <path d={inkBox(ix, iy, iw, ih, 1, .2)} {...IS} />
    </g>
  );
}

/** SHORT. Mahogany billiard table at waist height, seen from the front and above, the felt top filling the span:
 *  cushioned rails with diamond sights, six pockets, a racked triangle, the cue ball and a cue; the front apron and
 *  turned legs below. One object per span: cw > ch runs it along a row, ch > cw down a column (the short end then
 *  faces south). The 1x1 version is for the gallery and the corner chip. */
export function BilliardSpan({ cw = 1, ch = 1 }) {
  const rail = "#94592f", apron = "#6a3a20", felt = "#4f8f5e", feltD = "#3a6c47", sight = "#e7d8b4";
  const W = 64 * cw, H = 64 * ch, vert = ch > cw;
  // rail box x0..x1 × y0..yF (top plane), apron yF..yA (front face), legs yA..yL
  const [x0, x1, y0, yF] = vert ? [11, 53, 9, H - 25] : cw > 1 ? [6, W - 6, 14, 39] : [5, 59, 19, 40];
  const yA = yF + 7, yL = H - 7, r = 5;
  const fx0 = x0 + r, fx1 = x1 - r, fy0 = y0 + r, fy1 = yF - r + .6, mx = (x0 + x1) / 2, my = (y0 + yF) / 2;
  const legs = vert || cw === 1 ? [x0 + 3, x1 - 9] : [x0 + 4, W / 2 - 3, x1 - 10];
  const pockets = [[fx0, fy0], [fx1, fy0], [fx0, fy1], [fx1, fy1], ...(vert ? [[fx0 - .8, my], [fx1 + .8, my]] : [[mx, fy0 - .8], [mx, fy1 + .8]])];
  // felt coordinates: (s along the long axis 0..1 from the head end, t across 0..1)
  const L = (s, t) => (vert ? [fx0 + t * (fx1 - fx0), fy1 - s * (fy1 - fy0)] : [fx0 + s * (fx1 - fx0), fy0 + t * (fy1 - fy0)]);
  const br = cw * ch > 1 ? 2.6 : 2.2; // ball radius
  const rack = [[0, 0], [1, -.5], [1, .5], [2, -1], [2, 0], [2, 1]].map(([k, j]) => {
    const step = (br * 1.9) / (vert ? fy1 - fy0 : fx1 - fx0), across = (br * 2.1) / (vert ? fx1 - fx0 : fy1 - fy0);
    return L(.7 + k * step * .95, .5 + j * across);
  });
  const balls = ["#d99b26", "#c83e3b", "#244573", "#c83e3b", INK, "#d99b26"];
  const [cbx, cby] = L(.26, .5);
  const [q0x, q0y] = L(.05, vert ? .12 : .82), [q1x, q1y] = L(.23, .56);
  const cue = (() => { // a shaft 2.4 wide at the butt, 1.4 at the tip, outlined like any interior shape
    const len = Math.hypot(q1x - q0x, q1y - q0y), nx = -(q1y - q0y) / len, ny = (q1x - q0x) / len, f = (v) => +v.toFixed(2);
    return `M${f(q0x + nx * 1.2)} ${f(q0y + ny * 1.2)}L${f(q1x + nx * .7)} ${f(q1y + ny * .7)}L${f(q1x - nx * .7)} ${f(q1y - ny * .7)}L${f(q0x - nx * 1.2)} ${f(q0y - ny * 1.2)}Z`;
  })();
  // two diamond sights between each pair of pockets on the long rails
  const sights = [.25, .75].flatMap((t) => (vert
    ? [x0 + 2.4, x1 - 2.4].flatMap((sx) => [[sx, y0 + t * (my - y0)], [sx, my + t * (yF - my)]])
    : [y0 + 2.4, yF - 2.2].flatMap((sy) => [[x0 + t * (mx - x0), sy], [mx + t * (x1 - mx), sy]])));
  return (
    <g>
      <GroundShadow cx={W / 2} cy={H - 7} rx={(x1 - x0) / 2 + 1} ry={3.4} />
      {legs.map((lx) => <path key={lx} d={`M${lx} ${yA - 1}H${lx + 6}L${lx + 5.2} ${yL}H${lx + .8}Z`} fill={apron} {...OS} />)}
      <path d={inkBox(x0 + 1, yF, x1 - x0 - 2, yA - yF, 1.2, .3)} fill={apron} {...OS} />
      <path d={inkBox(x0, y0, x1 - x0, yF - y0, 3, .5)} fill={rail} {...OS} />
      <path d={inkBox(fx0, fy0, fx1 - fx0, fy1 - fy0, 1.2, .2)} {...IS} fill={feltD} />
      <path d={inkBox(fx0 + 1.8, fy0 + 1.8, fx1 - fx0 - 3.6, fy1 - fy0 - 3.6, 1, .2)} fill={felt} />
      {sights.map(([sx, sy], i) => <circle key={i} cx={sx} cy={sy} r=".9" fill={sight} />)}
      {pockets.map(([px, py], i) => <circle key={i} cx={px} cy={py} r="2.9" fill={INK} />)}
      {/* cue lying on the felt, then the balls */}
      <path d={cue} {...IS} fill="#e1c48f" />
      {rack.map(([bx, by], i) => <circle key={i} cx={+bx.toFixed(2)} cy={+by.toFixed(2)} r={br} {...IS} fill={balls[i]} />)}
      <circle cx={cbx} cy={cby} r={br} {...IS} fill="#f7f7f7" />
    </g>
  );
}
export const BilliardTable = () => <BilliardSpan cw={1} ch={1} />;

/* ---- STREET batch (case6, case9): new-art props ---------------------------------------------------------- */
/** LOW. Barber chair, kept low in the LOW-furniture camera: an oxblood leather seat at knee height and a rounded,
 *  channelled back topped by a padded head-rest on a short chrome stem (the whole back no higher than a desk top), padded armrests on bent chrome struts, a chrome hydraulic column on a
 *  round base, and the ribbed chrome footrest in front. The seat sits at the tile centre, under a placed token. */
export function BarberChair() {
  const lea = "#9b3442", leaL = "#c0505f", leaD = "#6b2530", chr = "#a9b0b6", chrL = "#e2e6e9", chrD = "#727a81";
  const P = lowCam(54), top = (...a) => camTop(P, ...a), side = (...a) => camSide(P, ...a), front = (...a) => camFront(P, ...a);
  const pt = (x, z, h) => P(x, z, h).map(r2).join(" ");
  const tube = (d, key) => (
    <g key={key}>
      <path d={d} fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={chr} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
  const [bx, by] = P(32, 8, 0); // centre of the round base on the floor
  // one armrest: a bent chrome strut from the seat side up to a padded rest
  const arm = (xa, xb, xs, key) => (
    <g key={key}>
      {tube(`M${pt(xs, 4, 14)}Q${pt((xa + xb) / 2, 4, 15)} ${pt((xa + xb) / 2, 3, 20)}`, "s")}
      <path d={side(xb, .4, 14.6, 19.6, 22.2)} fill={leaD} {...OS} />
      <path d={top(xa, xb, .4, 14.6, 22.2)} fill={leaL} {...OS} />
      <path d={front(xa, xb, .4, 19.6, 22.2, 1.1)} fill={lea} {...OS} />
    </g>
  );
  return (
    <g>
      {/* round base and the hydraulic column */}
      <path d={`M${r2(bx - 11.5)} ${r2(by)}V${r2(by + 2)}A11.5 5 0 0 0 ${r2(bx + 11.5)} ${r2(by + 2)}V${r2(by)}Z`} fill={chrD} {...OS} />
      <ellipse cx={r2(bx)} cy={r2(by)} rx="11.5" ry="5" fill={chr} {...OS} />
      <path d={inkBox(r2(bx - 3.4), r2(by - 10), 6.8, 10, 1.2, .2)} fill={chr} {...OS} />
      <path d={`M${r2(bx - 1.6)} ${r2(by - 8)}V${r2(by - 1.4)}`} stroke={chrL} strokeWidth="1.2" strokeLinecap="round" />
      {/* the head-rest: a chrome stem rising from the back's top edge to a padded pillow (top, east end, face) */}
      {tube(`M${pt(32, 17.5, 21)}L${pt(32, 17.5, 24.4)}`, "h")}
      <path d={side(39, 15.6, 18.6, 23.6, 29)} fill={leaD} {...OS} />
      <path d={top(25, 39, 15.6, 18.6, 29)} fill={leaL} {...OS} />
      <path d={front(25, 39, 15.6, 23.6, 29, 2.4)} fill={lea} {...OS} />
      {/* the back: its thickness, then the padded face with two channels */}
      <path d={front(21.5, 42.5, 19, 10, 22.4, 5)} fill={leaD} {...OS} />
      <path d={front(21.5, 42.5, 16, 10, 22.4, 5)} fill={lea} {...OS} />
      {[28.5, 35.5].map((cx) => { const [ax, ay] = P(cx, 16, 20.6), [, ey] = P(cx, 16, 16); return <path key={cx} d={`M${r2(ax)} ${r2(ay)}V${r2(ey)}`} {...IS} />; })}
      {arm(13, 19, 20, "w")}
      {/* chrome seat pan, then the cushion: east side, top, front */}
      <path d={front(19.4, 44.6, .6, 8, 10.4, 1)} fill={chr} {...OS} />
      <path d={side(45, 0, 16, 10, 16)} fill={leaD} {...OS} />
      <path d={top(19, 45, 0, 16, 16)} fill={leaL} {...OS} />
      <path d={front(19, 45, 0, 10, 16, 2.2)} fill={lea} {...OS} />
      {arm(45, 51, 44, "e")}
      {/* footrest: stem, then the ribbed plate */}
      {tube(`M${pt(32, -1.6, 5.2)}L${pt(32, 1, 8.6)}`, "f")}
      <path d={top(23, 41, -9, -1, 5.6)} fill={chrL} {...OS} />
      <path d={front(23, 41, -9, 4, 5.6, .8)} fill={chr} {...OS} />
      {[-6.6, -3.4].map((z) => { const [ax, ay] = P(25.4, z, 5.6), [ex] = P(38.6, z, 5.6); return <path key={z} d={`M${r2(ax)} ${r2(ay)}H${r2(ex)}`} {...IS} />; })}
    </g>
  );
}

/** LOW. Park bench, kept low in the LOW-furniture camera: three wooden seat slats at knee height and two back slats no
 *  higher than a desk top, on dark cast-iron ends (legs, back posts and scrolled armrests). */
export function Bench() {
  const wood = "#a8703f", woodL = "#c9935f", woodD = "#6e4526", iron = "#3b4a44", ironL = "#5e7069";
  const P = lowCam(56), top = (...a) => camTop(P, ...a), side = (...a) => camSide(P, ...a), front = (...a) => camFront(P, ...a);
  const ends = [8, 51], x0 = 6, x1 = 56;
  const slat = (z0, z1, h0, h1, key) => (
    <g key={key}>
      <path d={side(x1, z0, z1, h0, h1)} fill={woodD} {...OS} />
      <path d={top(x0, x1, z0, z1, h1)} fill={woodL} {...OS} />
      <path d={front(x0, x1, z0, h0, h1, 1)} fill={wood} {...OS} />
    </g>
  );
  return (
    <g>
      {/* iron behind the seat: back legs and back posts */}
      {ends.map((xe) => <path key={`l${xe}`} d={front(xe, xe + 3, 13, -.5, 12, .8)} fill={iron} {...OS} />)}
      {ends.map((xe) => <path key={`p${xe}`} d={front(xe, xe + 3, 16.4, 11, 30.6, 1.2)} fill={iron} {...OS} />)}
      {/* back slats on the front of the posts */}
      {slat(15, 16.4, 23.6, 28, "b2")}
      {slat(15, 16.4, 17, 21.4, "b1")}
      {/* front legs under the seat, then the seat slats from the back forward */}
      {ends.map((xe) => <path key={`f${xe}`} d={front(xe, xe + 3, 1.2, -.5, 12, .8)} fill={iron} {...OS} />)}
      {slat(10, 14.2, 11.4, 13.4, "s3")}
      {slat(5, 9.2, 11.4, 13.4, "s2")}
      {slat(0, 4.2, 11.4, 13.4, "s1")}
      {/* armrests: a post up from the seat, the rail running back, a scroll at the front */}
      {ends.map((xe) => {
        const [qx, qy] = P(xe + 1.5, .4, 19.4);
        return (
          <g key={`a${xe}`}>
            <path d={front(xe + .3, xe + 2.7, 1.2, 13.2, 20, .6)} fill={iron} {...OS} />
            <path d={top(xe - .4, xe + 3.4, .4, 14.6, 20.6)} fill={ironL} {...OS} />
            <circle cx={r2(qx)} cy={r2(qy)} r="2.1" fill={iron} {...OS} />
            <circle cx={r2(qx)} cy={r2(qy)} r=".7" fill={ironL} />
          </g>
        );
      })}
    </g>
  );
}

/** SHORT. Classic arched jukebox, about chest height on a person and still clearly below a standing one (SHORT camera:
 *  a narrow front, its round-topped hood seen from above): a tall, slim walnut cabinet with a full arched top, a glowing
 *  amber tube running up both sides and over the arch, a dark window with a record on the turntable, a selector strip,
 *  a chrome speaker grille and a toe kick. Sight passes over it. */
export function Jukebox() {
  const wood = "#7a4c2c", woodL = "#9c6a42", woodD = "#4f301b", glow = "#e0703a", glowL = "#f2c14e", chrome = "#c3c8cc", win = "#2b1a10", cream = "#efe6cf";
  const cx = 31, rx = 12.4, ys = 36.4, ry = 11.4, yb = 56.4, dx = 4, dy = 8.6;
  // the arch is extruded back by (dx, dy): the hood runs from the arch's upper-left tangent over the top to the east side
  const t = Math.PI - Math.atan((ry * dx) / (rx * dy)), tx = r2(cx + rx * Math.cos(t)), ty = r2(ys - ry * Math.sin(t));
  const hood = `M${tx} ${ty}A${rx} ${ry} 0 0 1 ${cx + rx} ${ys}L${cx + rx + dx} ${ys - dy}A${rx} ${ry} 0 0 0 ${r2(tx + dx)} ${r2(ty - dy)}Z`;
  const face = `M${cx - rx} ${yb}V${ys}A${rx} ${ry} 0 0 1 ${cx + rx} ${ys}V${yb}Z`;
  const gr = 9, gy = ys + .6, glowD = `M${cx - gr} 53V${gy}A${gr} ${r2(ry - 2.6)} 0 0 1 ${cx + gr} ${gy}V53`;
  const wx = 6.2; // half-width of the window, strip and grille
  return (
    <g>
      <GroundShadow cx={33} cy={57} rx={17} ry={3.2} />
      <path d={slabSide(cx - rx, ys, 2 * rx, yb - ys, dx, dy)} fill={woodD} {...OS} />
      <path d={hood} fill={woodL} {...OS} />
      <path d={face} fill={wood} {...OS} />
      {/* toe kick */}
      <path d={inkBox(cx - rx + 1.2, 53.8, 2 * rx - 2.4, 2.2, .8, 0)} fill={woodD} />
      {/* the glowing tube up both sides and over the arch: ink edge, amber band, a light core */}
      <path d={glowD} fill="none" stroke={INK} strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d={glowD} fill="none" stroke={glow} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d={glowD} fill="none" stroke={glowL} strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round" />
      {/* window under the arch with a record on the turntable */}
      <path d={`M${cx - wx} 42.4V${gy}A${wx} 6.4 0 0 1 ${cx + wx} ${gy}V42.4Z`} {...IS} fill={win} />
      <ellipse cx={cx} cy="39.8" rx="4.4" ry="1.4" fill="#111116" stroke={chrome} strokeWidth=".5" />
      <ellipse cx={cx} cy="39.8" rx="1.3" ry=".5" fill="#c83e3b" />
      {/* selector strip and speaker grille */}
      <path d={inkBox(cx - wx, 43.2, 2 * wx, 2.4, .5, 0)} {...IS} fill={cream} />
      <path d={`M${r2(cx - 2)} 43.4V45.4M${r2(cx + 2)} 43.4V45.4`} {...IS} />
      <path d={inkBox(cx - wx, 46.4, 2 * wx, 6.2, .8, 0)} {...IS} fill={chrome} />
      <path d={[-4, -2, 0, 2, 4].map((o) => `M${cx + o} 47.4V51.6`).join("")} {...IS} />
    </g>
  );
}

/** TALL. Advertising column (a Morris column), clearly taller than a person: a wide cylinder pasted with posters
 *  between an iron base ring and a cornice, under a ribbed green dome with a finial. Shade on the east side. */
export function PosterColumn() {
  const u = useUid();
  const iron = "#3e5b4a", ironL = "#5f8068", paper = "#e9dfc4", cx = 32;
  const cyl = (rx, ry, yt, yb) => `M${cx - rx} ${yt}V${yb}A${rx} ${ry} 0 0 0 ${cx + rx} ${yb}V${yt}A${rx} ${ry} 0 0 0 ${cx - rx} ${yt}Z`;
  const body = cyl(13, 2.6, 13, 50), base = cyl(15.6, 3, 49.4, 54.4), ring = cyl(15.4, 3, 10.6, 14.2);
  const dome = "M18.4 10.6A13.6 7.6 0 0 1 45.6 10.6A13.6 2.8 0 0 1 18.4 10.6Z";
  // a poster pasted on the drum: its top and bottom edges follow the drum's curve
  const sheet = (x0, x1, y0, y1) => {
    const xs = Array.from({ length: 6 }, (_, i) => x0 + ((x1 - x0) * i) / 5), off = (x) => 2.6 * Math.sqrt(Math.max(0, 1 - ((x - cx) / 13) ** 2));
    return `M${xs.map((x) => `${r2(x)} ${r2(y0 + off(x))}`).join("L")}L${[...xs].reverse().map((x) => `${r2(x)} ${r2(y1 + off(x))}`).join("L")}Z`;
  };
  return (
    <g>
      <defs>
        <clipPath id={`${u}b`}><path d={body} /></clipPath>
        <clipPath id={`${u}a`}><path d={body} /><path d={base} /><path d={ring} /><path d={dome} /></clipPath>
      </defs>
      <GroundShadow cx={33} cy={56} rx={19} ry={3.4} />
      <path d={base} fill={iron} {...OS} />
      <ellipse cx={cx} cy="49.4" rx="15.6" ry="3" fill={ironL} {...OS} />
      <path d={body} fill={paper} {...OS} />
      {/* posters: two bands round the drum */}
      <g clipPath={`url(#${u}b)`}>
        <path d={sheet(16, 23, 16.4, 34)} {...IS} fill="#d99b26" />
        <path d={sheet(16, 23, 23, 26.4)} fill="#244573" />
        <path d={sheet(23.6, 38.4, 15.4, 33.4)} {...IS} fill="#c45970" />
        <circle cx="31" cy="22.6" r="4.2" {...IS} fill="#613536" />
        <path d="M26.4 29.4H35.6M27.8 32H34.2" stroke={paper} strokeWidth="1.3" strokeLinecap="round" />
        <path d={sheet(39, 48, 15, 31.6)} {...IS} fill="#244573" />
        <path d="M42.6 19.4L43.5 21.6L45.6 21.8L44 23.2L44.5 25.4L42.6 24.2L40.7 25.4L41.2 23.2L39.6 21.8L41.7 21.6Z" fill="#efe6cf" />
        <path d={sheet(16, 32.4, 35.6, 47.4)} {...IS} fill="#76a4a2" />
        <path d="M20 41H29M20 43.6H26" stroke="#2f4f4d" strokeWidth="1.3" strokeLinecap="round" />
        <path d={sheet(33, 48, 34.6, 47)} {...IS} fill="#f7f7f7" />
        <path d={sheet(33, 48, 38.6, 41)} fill="#c83e3b" />
      </g>
      <path d={body} fill="none" {...OS} />
      {/* cornice ring, its lip round the dome, the ribbed dome and the finial */}
      <path d={ring} fill={iron} {...OS} />
      <ellipse cx={cx} cy="10.6" rx="15.4" ry="3" fill={ironL} {...OS} />
      <path d={dome} fill={iron} {...OS} />
      <path d="M32 3.2Q26.4 5.2 24.8 12.6M32 3.2V13.4M32 3.2Q37.6 5.2 39.2 12.6" {...IS} />
      <path d="M32 3.6V1.6" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx={cx} cy="1.6" r="1.4" {...IS} fill={ironL} />
      {/* one flat shade over the east side of every part */}
      <g clipPath={`url(#${u}a)`}><path d="M38.6 0H50V58H38.6Z" fill="#000" fillOpacity=".22" /></g>
    </g>
  );
}

/** SHORT. Front-loading washing machine at waist height (SHORT camera), a near cube: its square white enamel front as
 *  tall as it is wide, its top showing, a control strip with a detergent drawer, two buttons and a dial, and a chrome
 *  porthole with laundry turning in blue water, on two dark feet. */
export function Washer() {
  const u = useUid();
  const top = "#f7f7f7", front = "#e1e4e6", side = "#a9afb4", panel = "#cdd2d6", chrome = "#c3c8cc", chromeD = "#7c8288", glass = "#7fbfd8", water = "#3f86a8";
  const x = 15, y = 29.6, w = 26, h = 25.4, dx = 5.4, dy = 11, px = 27.4, py = 45.6, R = 6.8, g = 4.8;
  return (
    <g>
      <defs><clipPath id={`${u}g`}><circle cx={px} cy={py} r={g} /></clipPath></defs>
      <GroundShadow cx={31} cy={57} rx={18} ry={3.2} />
      {[16.6, 35.4].map((fx) => <path key={fx} d={inkBox(fx, 53.6, 4.2, 3.8, .8, .2)} fill="#42474c" {...OS} />)}
      <path d={slabSide(x, y, w, h, dx, dy)} fill={side} {...OS} />
      <path d={slabTop(x, y, w, dx, dy)} fill={top} {...OS} />
      <path d={inkBox(x, y, w, h, 1.6, .4)} fill={front} {...OS} />
      {/* control strip: detergent drawer, two buttons, the programme dial */}
      <path d={inkBox(x + 1.4, y + 1.4, w - 2.8, 4.6, 1, .2)} {...IS} fill={panel} />
      <path d={inkBox(x + 2.6, y + 2.2, 8, 3, .6, 0)} {...IS} fill={front} />
      <path d={`M${x + 4.4} ${y + 3.9}H${x + 8.8}`} stroke={chromeD} strokeWidth="1" strokeLinecap="round" />
      {[x + 14.2, x + 17].map((bx) => <circle key={bx} cx={bx} cy={y + 3.7} r=".85" fill={INK} />)}
      <circle cx={x + w - 3.8} cy={y + 3.7} r="2" {...IS} fill={chrome} />
      <path d={`M${x + w - 3.8} ${y + 3.7}L${x + w - 2.8} ${y + 2.4}`} stroke={INK} strokeWidth=".9" strokeLinecap="round" />
      {/* porthole: chrome ring, glass, water and laundry, one glint; the door catch on the right */}
      <circle cx={px} cy={py} r={R} fill={chrome} {...OS} />
      <circle cx={px} cy={py} r={g} fill={glass} />
      <g clipPath={`url(#${u}g)`}>
        <path d={`M${px - 6} ${py + .4}Q${px - 3} ${py - 1.2} ${px} ${py + .2}T${px + 6} ${py}V${py + 6}H${px - 6}Z`} fill={water} />
        <ellipse cx={px - 1.8} cy={py + 2.2} rx="2.2" ry="1.2" fill="#c45970" transform={`rotate(-20 ${px - 1.8} ${py + 2.2})`} />
        <ellipse cx={px + 2.2} cy={py + 1.6} rx="1.7" ry="1" fill="#f2c14e" />
      </g>
      <circle cx={px} cy={py} r={g} {...IS} />
      <path d={`M${px - 3.3} ${py - 1.5}A3.6 3.6 0 0 1 ${px - .6} ${py - 3.4}`} stroke="#eef8fc" strokeWidth="1.1" strokeLinecap="round" fill="none" />
      <path d={inkBox(x + w - 4.2, py - 2.6, 2, 5.2, .6, 0)} {...IS} fill={chromeD} />
    </g>
  );
}

/** TALL. Rooftop water tower, clearly taller than a person: a wooden stave tank bound with iron hoops under a conical
 *  roof, on a deck held up by four steel legs with cross-bracing and a feed pipe down the middle. */
export function WaterTower() {
  const u = useUid();
  const steel = "#7c8288", steelD = "#50565b", deck = "#8b9196", deckL = "#b9bec2", wood = "#a8703f", woodL = "#c9935f", roof = "#5b4a3e";
  const cx = 33, rx = 16, ry = 3.2, yt = 12.4, yb = 27.4;
  const tank = `M${cx - rx} ${yt}V${yb}A${rx} ${ry} 0 0 0 ${cx + rx} ${yb}V${yt}A${rx} ${ry} 0 0 0 ${cx - rx} ${yt}Z`;
  const cone = `M${cx - rx - 1.4} ${yt}L${cx} 1.8L${cx + rx + 1.4} ${yt}A${rx + 1.4} ${ry + .4} 0 0 1 ${cx - rx - 1.4} ${yt}Z`;
  const leg = (xt, xb, yTop, yBot, fill, key) => <path key={key} d={`M${xt - 1.3} ${yTop}H${xt + 1.3}L${xb + 1.5} ${yBot}H${xb - 1.5}Z`} fill={fill} {...OS} />;
  const bar = (d, c, key) => (
    <g key={key}>
      <path d={d} fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <path d={d} fill="none" stroke={c} strokeWidth="1.1" strokeLinecap="round" />
    </g>
  );
  const staves = [-60, -36, -12, 12, 36, 60].map((a) => {
    const s = Math.sin((a * Math.PI) / 180), c = Math.cos((a * Math.PI) / 180);
    return `M${r2(cx + rx * s)} ${r2(yt + ry * c + .6)}V${r2(yb + ry * c - .4)}`;
  }).join("");
  return (
    <g>
      <defs><clipPath id={`${u}t`}><path d={tank} /><path d={cone} /></clipPath></defs>
      <GroundShadow cx={34} cy={56.4} rx={23} ry={3.6} />
      {/* back legs and bracing, the feed pipe */}
      {leg(22, 21, 30, 51.4, steelD, "bl")}
      {leg(50, 52, 30, 51.4, steelD, "br")}
      {bar("M22 34.6L51 49.6M51 34.6L22 49.6", steelD, "bx")}
      <path d={inkBox(31.6, 31, 3.6, 24.4, 1, .2)} fill={steel} {...OS} />
      {/* deck */}
      <path d={slabSide(12, 30.6, 38, 3, 5, 5)} fill={steelD} {...OS} />
      <path d={slabTop(12, 30.6, 38, 5, 5)} fill={deckL} {...OS} />
      <path d={inkBox(12, 30.6, 38, 3, .8, .2)} fill={deck} {...OS} />
      {/* front legs and bracing */}
      {leg(16.4, 14.6, 33.6, 57, steel, "fl")}
      {leg(45.6, 47.4, 33.6, 57, steel, "fr")}
      {bar("M17 37.4L45.6 53.4M45 37.4L16.4 53.4M16.4 45.2H45.6", steel, "fx")}
      {/* the tank: staves, a lit stripe, iron hoops */}
      <path d={tank} fill={wood} {...OS} />
      <g clipPath={`url(#${u}t)`}><path d={`M${cx - rx + 2.4} 0H${cx - rx + 5}V40H${cx - rx + 2.4}Z`} fill={woodL} /></g>
      <path d={staves} {...IS} />
      {[16, 21.6, 27.2].map((hy) => bar(`M${cx - rx} ${hy}A${rx} ${ry} 0 0 0 ${cx + rx} ${hy}`, steelD, `h${hy}`))}
      <path d={tank} fill="none" {...OS} />
      {/* conical roof and finial */}
      <path d={cone} fill={roof} {...OS} />
      <path d={`M${cx} 2.4L${cx - 7} ${yt + 2.4}M${cx} 2.4L${cx + 7} ${yt + 2.4}`} {...IS} />
      <circle cx={cx} cy="1.8" r="1.5" fill={roof} {...OS} />
      <g clipPath={`url(#${u}t)`}><path d={`M${cx + 6} 0H54V40H${cx + 6}Z`} fill="#000" fillOpacity=".22" /></g>
    </g>
  );
}

/* ---- MOUNTAINS and FOREST batch (case3, case4, case8): new-art props ------------------------------------------- */
/** LOW. Bearskin rug, a top-down footprint flat on the floor (art/STYLE.md, LOW props): just the dark brown pelt,
 *  inked in OS, hind legs to the north corners, forelegs out to the sides, a stub of tail, and the head at the south
 *  facing the viewer (ears, eyes, a tan muzzle and nose). The clawed paws stay visible round a token. No shadow. */
export function Bearskin() {
  const fur = "#5b3d28", furD = "#3f2a1c", furL = "#7c573a", muzzle = "#a8835c", claw = "#efe6cf";
  const LW = 9; // leg width
  const legs = [[[25, 16], [12, 10.5]], [[39, 16], [52, 10.5]], [[24, 35.6], [10.4, 41.6]], [[40, 35.6], [53.6, 41.6]]];
  const body = "M32 9.6C40.6 9.6 45.4 15.4 45.4 24C45.4 31 43.8 36.6 40 40.6H24C20.2 36.6 18.6 31 18.6 24C18.6 15.4 23.4 9.6 32 9.6Z";
  const skull = "M22.6 45.6C22.6 41.2 26.8 39 32 39C37.2 39 41.4 41.2 41.4 45.6C41.4 50.2 37.8 53.6 32 53.6C26.2 53.6 22.6 50.2 22.6 45.6Z";
  const ears = [[23.2, 40.2], [40.8, 40.2]];
  // one silhouette pass, every part grown by e: the ink outline behind, then the fur
  const pass = (e, color, key) => (
    <g key={key} fill={color} stroke={color} strokeWidth={2 * e} strokeLinejoin="round" strokeLinecap="round">
      {legs.map(([a, b], i) => <path key={i} d={`M${a}L${b}`} fill="none" strokeWidth={LW + 2 * e} />)}
      <path d="M32 12V8.8" fill="none" strokeWidth={6 + 2 * e} />
      <path d={body} />
      <path d={skull} />
      <ellipse cx="32" cy="53.6" rx="5.6" ry="4.4" />
      {ears.map(([x, y]) => <circle key={x} cx={x} cy={y} r="3.3" />)}
    </g>
  );
  const claws = legs.flatMap(([a, b], i) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy, ny = ux;
    return [-2.4, 0, 2.4].map((k) => {
      const e = Math.sqrt((LW / 2) ** 2 - k * k), bx = b[0] + nx * k, by = b[1] + ny * k;
      return <path key={`${i}${k}`} d={`M${r2(bx + ux * (e - 1.8))} ${r2(by + uy * (e - 1.8))}L${r2(bx + ux * (e + .5))} ${r2(by + uy * (e + .5))}`} stroke={claw} strokeWidth="1.1" strokeLinecap="round" />;
    });
  });
  return (
    <g>
      {pass(1.5, INK, "a")}
      {pass(0, fur, "b")}
      {/* darker fur down the spine and a few lighter tufts */}
      <path d="M32 11.4C35 11.4 36.6 16.4 36.6 24C36.6 30.6 35.2 35.4 32 38C28.8 35.4 27.4 30.6 27.4 24C27.4 16.4 29 11.4 32 11.4Z" fill={furD} />
      <path d="M21.4 21.4Q23 19.8 24.8 20.6M42.6 21.4Q41 19.8 39.2 20.6M21.6 30.6Q23.2 29 25 29.8M42.4 30.6Q40.8 29 39 29.8M15 12.6Q16.8 11.6 18.4 12.6M49 12.6Q47.2 11.6 45.6 12.6"
        fill="none" stroke={furL} strokeWidth="1" strokeLinecap="round" />
      {/* the head lying on the pelt: ears, skull, eyes, muzzle and nose */}
      {ears.map(([x, y]) => (
        <g key={x}>
          <circle cx={x} cy={y} r="3.3" {...IS} fill={fur} />
          <circle cx={x} cy={y} r="1.5" fill={furD} />
        </g>
      ))}
      <path d={skull} {...IS} fill={fur} />
      <circle cx="27.6" cy="46" r="1.2" fill={INK} />
      <circle cx="36.4" cy="46" r="1.2" fill={INK} />
      <ellipse cx="32" cy="53.6" rx="5.6" ry="4.4" {...IS} fill={muzzle} />
      <path d="M29.6 54.8Q32 53.8 34.4 54.8Q34 57.2 32 57.6Q30 57.2 29.6 54.8Z" fill={INK} />
      {claws}
    </g>
  );
}

/** LOW. Fairy ring (art/STYLE.md, LOW props): the band of darker grass is a top-down footprint on the ground, and the
 *  toadstools round it stand up in the board's camera, seen from the front and slightly above: a cream stem shaded to
 *  the east under a domed cap, red with cream spots or plain tan. Back ones are drawn first. They stay small and
 *  outside the token's disc, so the middle is clear for a token. No shadow. */
export function FairyRing() {
  const u = useUid();
  const red = "#c8423b", redD = "#8f2e2a", tan = "#c9a06a", tanD = "#94703f", spot = "#f4ecd8", stem = "#efe6cf", stemD = "#c9bd9c";
  // [base x, base y, cap width, red?], every one outside the token disc (r 21.2 round 32,32)
  const shrooms = [[32, 9.6, 6.4, 1], [13.6, 14.6, 5.6, 1], [49.6, 14, 5, 0], [55, 19.6, 3.4, 1], [5.8, 35.6, 6, 1], [58.4, 35, 6.6, 1],
    [12.6, 55.4, 5.6, 0], [51.4, 54.4, 6.2, 1], [33.4, 61.6, 6.8, 1], [26.4, 61.4, 3.6, 0]].sort((a, b) => a[1] - b[1]);
  const band = "M32 1.6A30.4 30.4 0 1 0 32 62.4A30.4 30.4 0 1 0 32 1.6ZM32 11.6A20.4 20.4 0 1 1 32 52.4A20.4 20.4 0 1 1 32 11.6Z";
  const geo = ([x, y, w]) => {
    const sh = w * .46, ch = w * .52, rim = y - sh; // stem height, cap height, cap rim line
    const cap = `M${r2(x - w / 2)} ${r2(rim)}C${r2(x - w / 2)} ${r2(rim - ch * 1.3)} ${r2(x + w / 2)} ${r2(rim - ch * 1.3)} ${r2(x + w / 2)} ${r2(rim)}Q${x} ${r2(rim + w * .16)} ${r2(x - w / 2)} ${r2(rim)}Z`;
    const sw = w * .17; // stem half width
    const st = `M${r2(x - sw)} ${r2(rim)}L${r2(x - sw * 1.15)} ${r2(y)}Q${x} ${r2(y + .5)} ${r2(x + sw * 1.15)} ${r2(y)}L${r2(x + sw)} ${r2(rim)}Z`;
    return { sh, ch, rim, cap, st, sw };
  };
  return (
    <g>
      <defs>
        {shrooms.map((m, i) => <clipPath key={i} id={`${u}c${i}`}><path d={geo(m).cap} /></clipPath>)}
      </defs>
      <path d={band} fill="#24451a" fillOpacity=".26" fillRule="evenodd" />
      {shrooms.map((m, i) => {
        const [x, y, w, rd] = m, { rim, ch, cap, st, sw } = geo(m);
        return (
          <g key={i}>
            <path d={st} fill={stem} />
            <path d={`M${r2(x + sw * .2)} ${r2(rim)}L${r2(x + sw * .3)} ${r2(y + .2)}Q${r2(x + sw)} ${r2(y + .1)} ${r2(x + sw * 1.15)} ${r2(y)}L${r2(x + sw)} ${r2(rim)}Z`} fill={stemD} />
            <path d={st} {...IS} fill="none" />
            <path d={cap} fill={rd ? redD : tanD} />
            <g clipPath={`url(#${u}c${i})`}>
              <ellipse cx={r2(x - w * .12)} cy={r2(rim - ch * .62)} rx={r2(w * .46)} ry={r2(ch * .82)} fill={rd ? red : tan} />
            </g>
            {rd ? [[-.2, -.62, .11], [.16, -.78, .085], [.24, -.34, .08]].map(([sx, sy, k], j) => (
              <circle key={j} cx={r2(x + sx * w)} cy={r2(rim + sy * ch)} r={r2(Math.max(.5, k * w))} fill={spot} />
            )) : null}
            <path d={cap} fill="none" stroke={INK} strokeWidth={w < 4 ? .9 : 1.2} strokeLinejoin="round" />
          </g>
        );
      })}
    </g>
  );
}

/** SHORT. Ski rack (SHORT camera, its tops seen from above): a low wooden frame, two end boards joined by a waist-high
 *  rail and a floor trough, with four thin skis standing upright in it, each with a binding and a rounded tip, clear
 *  gaps between them so the floor shows through; a pair of poles leans on the east end. The frame stays at waist
 *  height; only the slim skis rise above it, and sight passes through the gaps. */
export function SkiRack() {
  const wood = "#a8703f", woodL = "#c9935f", woodD = "#6e4526", bind = "#3a3a44", bindL = "#9a9ca0";
  const dx = 4, dy = 8; // depth of the end boards and trough (steep SHORT camera)
  const skis = [[19.4, 14.6, "#2f8f9a", "#1f6168", "#7cc6cf"], [27, 17.4, "#c8423b", "#8f2e2a", "#ec8a80"], [34.6, 13.6, "#e3b23c", "#a87c1f", "#f6dc8c"], [42.2, 16.4, "#244573", "#172d4c", "#6d8fc4"]];
  const sw = 3.8, yb = 49.2; // ski width; skis stand at mid depth, tails on the trough floor
  const ski = ([cx, yt, c, cD, cL]) => {
    const L = r2(cx - sw / 2), R = r2(cx + sw / 2);
    const out = `M${L} ${yb}V${r2(yt + 3.4)}Q${L} ${yt} ${cx} ${yt}Q${R} ${yt} ${R} ${r2(yt + 3.4)}V${yb}Z`;
    return (
      <g key={cx}>
        <path d={out} fill={c} />
        <path d={`M${r2(R - 1.2)} ${r2(yt + 1.4)}Q${R} ${r2(yt + 2)} ${R} ${r2(yt + 3.4)}V${yb}H${r2(R - 1.2)}Z`} fill={cD} />
        <path d={`M${r2(L + .9)} ${r2(yt + 3.2)}Q${r2(cx - .4)} ${r2(yt + 1)} ${r2(cx + .6)} ${r2(yt + 1.2)}`} fill="none" stroke={cL} strokeWidth=".9" strokeLinecap="round" />
        <path d={out} fill="none" {...OS} />
        <path d={inkBox(r2(L - .5), 26.4, sw + 1, 5.4, .8, 0)} {...IS} fill={bind} />
        <path d={`M${r2(L + .4)} 28.2H${r2(R - .4)}`} stroke={bindL} strokeWidth="1" />
      </g>
    );
  };
  const pole = (xa, ya, xb, yb2, key) => (
    <g key={key}>
      <path d={`M${xa} ${ya}L${xb} ${yb2}`} stroke={INK} strokeWidth={1 + 2 * IS.strokeWidth} strokeLinecap="round" />
      <path d={`M${xa} ${ya}L${xb} ${yb2}`} stroke={bindL} strokeWidth="1" strokeLinecap="round" />
      <path d={`M${r2(xa + (xb - xa) * .09 - 2.2)} ${r2(ya + (yb2 - ya) * .09)}h4.4`} stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      <path d={`M${xb} ${yb2}L${r2(xb + (xa - xb) * .17)} ${r2(yb2 + (ya - yb2) * .17)}`} stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
    </g>
  );
  // an end board: front edge, top and its east face going back
  const board = (x, shade) => (
    <g key={x}>
      <path d={`M${x + 3.4} 34L${x + 3.4 + dx} ${34 - dy}V${57 - dy}L${x + 3.4} 57Z`} fill={shade} {...OS} />
      <path d={slabTop(x, 34, 3.4, dx, dy)} fill={woodL} {...OS} />
      <path d={inkBox(x, 34, 3.4, 23, .6, 0)} fill={wood} {...OS} />
    </g>
  );
  return (
    <g>
      <GroundShadow cx={33} cy={56.8} rx={24} ry={3.2} />
      {board(11, woodD)}
      {/* the floor trough between the boards (its top seen from above), the skis standing in it */}
      <path d={slabTop(14.4, 51.6, 31.2, dx, dy)} fill={woodD} {...OS} />
      <path d={inkBox(14.4, 51.6, 31.2, 5.2, .6, 0)} fill={wood} {...OS} />
      {skis.map(ski)}
      {/* the waist-high front rail the skis lean on */}
      <path d={slabTop(14.4, 36, 31.2, 1.4, 2.8)} fill={woodL} {...OS} />
      <path d={inkBox(14.4, 36, 31.2, 3.2, .6, 0)} fill={wood} {...OS} />
      {board(45.6, "#5a3820")}
      {pole(54.4, 57.4, 50.6, 21.6, "a")}
      {pole(58, 56.8, 53.4, 22.8, "b")}
    </g>
  );
}

/** SHORT. Snowman, clearly below a standing person and no wider than one: two packed snowballs shaded to the east,
 *  twig arms, a red scarf with a hanging end, coal eyes, smile and buttons, and a carrot nose. */
export function Snowman() {
  const u = useUid();
  const snow = "#f6f9fb", snowD = "#c3d4e0", carrot = "#e0703a", scarf = "#c83e3b", scarfD = "#8f2e2a", twig = "#6e4526";
  const twigs = "M21 41.4L9.6 32.6M13.6 35.6L11.8 30.8M43 41.4L54.4 32.4M50.6 35.4L55.6 37.4";
  return (
    <g>
      <defs>
        <clipPath id={`${u}b`}><ellipse cx="32" cy="46" rx="13.6" ry="11.6" /></clipPath>
        <clipPath id={`${u}h`}><circle cx="32" cy="27.6" r="8.6" /></clipPath>
      </defs>
      <GroundShadow cx={33} cy={57} rx={17} ry={3.4} />
      <path d={twigs} fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <path d={twigs} fill="none" stroke={twig} strokeWidth="1.4" strokeLinecap="round" />
      {/* body: shade, lit part, outline, coal buttons */}
      <ellipse cx="32" cy="46" rx="13.6" ry="11.6" fill={snowD} />
      <g clipPath={`url(#${u}b)`}><ellipse cx="29.6" cy="44" rx="12.8" ry="10.8" fill={snow} /></g>
      <ellipse cx="32" cy="46" rx="13.6" ry="11.6" fill="none" {...OS} />
      {[41.8, 46.4, 51].map((y) => <circle key={y} cx="31.4" cy={y} r="1.35" fill={INK} />)}
      {/* head */}
      <circle cx="32" cy="27.6" r="8.6" fill={snowD} />
      <g clipPath={`url(#${u}h)`}><circle cx="30.4" cy="26.2" r="8" fill={snow} /></g>
      <circle cx="32" cy="27.6" r="8.6" fill="none" {...OS} />
      {/* scarf round the neck and its hanging end */}
      <path d="M35.4 37.4L39 37L40.6 47.2L36.6 47.8Z" fill={scarf} {...OS} />
      <path d="M36 41.4L39.6 41" stroke={scarfD} strokeWidth="1.4" />
      <path d="M37.4 47.8V49.4M38.8 47.6V49.2M40.1 47.4V49" {...IS} />
      <path d="M23.6 34.4Q32 38.8 40.4 34.4L40.8 37.6Q32 42 23.2 37.6Z" fill={scarf} {...OS} />
      <path d="M28 37.2L28.6 39.4M33.4 38.2L33.8 40.4" stroke={scarfD} strokeWidth="1.4" />
      {/* face: coal eyes and smile, carrot nose */}
      <circle cx="28.9" cy="25.2" r="1.2" fill={INK} />
      <circle cx="35.1" cy="25.2" r="1.2" fill={INK} />
      {[[28.2, 30.8], [30.2, 31.8], [32.6, 32.1], [34.9, 31.6]].map(([x, y]) => <circle key={x} cx={x} cy={y} r=".75" fill={INK} />)}
      <path d="M31.4 27L39.8 29.2L31.6 29.9Z" {...IS} fill={carrot} />
    </g>
  );
}

/** TALL. Ice column, clearly taller than a person: a thick six-sided column of cloudy ice standing in its own frozen
 *  spill, seen from above so its top face shows (lit top, lit west facet, front, shaded east facet), icicles along
 *  the front rim, a cloudy core with trapped bubbles, one lit edge and a crack; two loose chunks at the foot. */
export function IcePillar() {
  const u = useUid();
  const top = "#e4f4fa", west = "#c6e5f1", front = "#a6d2e5", east = "#77abc4", spill = "#d4ecf5", cloud = "#eef8fb", crack = "#5b93ae";
  const yb = 5.4, ys = 9, yf = 12.6, Yf = 55.6, Ys = 52; // top: back, side and front vertices; foot: front and side
  const W = 15.6, FW = 22.4, FE = 41.6, E = 48.4;
  const frontD = polyD([FW, yf], [FE, yf], [FE, Yf], [FW, Yf]);
  return (
    <g>
      <defs><clipPath id={`${u}f`}><path d={frontD} /></clipPath></defs>
      <GroundShadow cx={32} cy={56.6} rx={23} ry={3.6} />
      {/* frozen spill on the floor round the foot, and two chunks */}
      <path d="M9.6 54.4C10.8 51.4 15.6 50.2 20 50.6L44 50.4C49.4 50 54.4 51.6 54.8 54.6C55.2 57.4 49.6 58.8 42 58.6L22 58.8C14 59 8.6 57.4 9.6 54.4Z" fill={spill} {...OS} />
      <path d="M7.4 57.2L8.6 54.2L12.2 53.8L13.4 56.6L10.8 58.4Z" fill={west} {...OS} />
      <path d="M50.6 57.6L52 55.2L55.2 55.6L55.6 58Z" fill={east} {...OS} />
      {/* the column: west and east facets, the front face, then the top */}
      <path d={polyD([W, ys], [FW, yf], [FW, Yf], [W, Ys])} fill={west} {...OS} />
      <path d={polyD([FE, yf], [E, ys], [E, Ys], [FE, Yf])} fill={east} {...OS} />
      <path d={frontD} fill={front} />
      <g clipPath={`url(#${u}f)`}>
        <path d="M28.6 18.6C31 17.8 33.4 19.4 33 22.6C32.6 25.4 34.6 27.4 34.8 30.6C35 34 32.8 35.6 33.6 38.8C34.4 42 36.4 44 35 47.4C33.6 50.4 29.4 50.8 27.6 48.2C26 45.8 28 43 27 40C26 36.8 24.4 34.6 25.2 31.2C26 28 27.6 26.8 26.8 23.6C26.2 21 26.8 19.2 28.6 18.6Z" fill={cloud} />
        {[[30.2, 24.6, 1.1], [29.4, 40.6, .9], [37.6, 30, 1], [25.6, 50.4, .8]].map(([x, y, r]) => <circle key={y} cx={x} cy={y} r={r} fill="#ffffff" />)}
        <path d="M35.2 47.4L37.2 50L36.4 53M37.2 50L39.6 50.8" fill="none" stroke={crack} strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <path d={frontD} fill="none" {...OS} />
      <path d={`M${W + 2.2} ${ys + 4}V${Ys - 3}`} stroke="#f2fafd" strokeWidth="1.4" strokeLinecap="round" />
      {/* icicles hanging along the front rim */}
      {[[25.4, 4.6, 3], [30.6, 7.6, 3.4], [36.2, 5, 2.8], [44.4, 6.2, 2.6]].map(([x, len, wd]) => {
        const y0 = x > FE ? r2(yf - (x - FE) * (yf - ys) / (E - FE)) : yf;
        return <path key={x} d={`M${r2(x - wd / 2)} ${y0}Q${r2(x - wd / 5)} ${r2(y0 + len * .6)} ${x} ${r2(y0 + len)}Q${r2(x + wd / 5)} ${r2(y0 + len * .6)} ${r2(x + wd / 2)} ${y0}Z`}
          {...IS} fill={x > FE ? east : top} />;
      })}
      <path d={polyD([W, ys], [FW, yb], [FE, yb], [E, ys], [FE, yf], [FW, yf])} fill={top} {...OS} />
      <path d="M24.6 9.6L29.4 7.6M33.8 10.6L37.8 8.8" {...IS} />
    </g>
  );
}

/** TALL. Crumbling wall, clearly taller than a person: a standing piece of old coursed stone, its broken top stepping
 *  down along the courses from above head height to the east, moss on the ledges, an ivy runner, fallen blocks. */
export function RuinedWall() {
  const u = useUid();
  const stone = "#a89e8a", stoneL = "#cbc2ad", stoneD = "#766d5d", moss = "#7a9a48", mossD = "#4f6d32";
  const d = 6, yB = 56, xL = 5;
  // the broken top, west to east, then down the east end; each step breaks along a bed joint
  const prof = [[5, 9.4], [7.6, 7], [19, 7], [19, 15], [27, 15], [28.4, 18.4], [30.4, 23], [38, 23], [38, 31], [44, 31], [45.4, 35],
    [47, 39.4], [51, 39.4], [51, 56]];
  const front = polyD([xL, yB], ...prof);
  const off = ([x, y]) => [x + d, y - d];
  const faces = prof.slice(0, -1).map((p, i) => {
    const q = prof[i + 1], side = q[1] - p[1] > 0 && q[1] - p[1] >= (q[0] - p[0]) * .8;
    return <path key={i} d={polyD(p, q, off(q), off(p))} fill={side ? stoneD : stoneL} {...OS} />;
  });
  // big rough-cut blocks: bed joints, then head joints per course [y top, y bottom, x...]
  const beds = [47.5, 39.4, 31, 23, 15];
  const heads = [[47.5, 56, 16, 29, 41], [39.4, 47.5, 10.4, 23, 35.4, 45.6], [31, 39.4, 17, 30.4], [23, 31, 12, 25], [15, 23, 17.6], [7, 15, 12]];
  const joints = beds.map((y) => `M${xL} ${y}H52`).join("") + heads.map(([y0, y1, ...xs]) => xs.map((x) => `M${x} ${y0}V${y1}`).join("")).join("");
  const block = (x, y, w, h, dd, key) => (
    <g key={key}>
      <path d={slabSide(x, y, w, h, dd, dd)} fill={stoneD} {...OS} />
      <path d={slabTop(x, y, w, dd, dd)} fill={stoneL} {...OS} />
      <path d={inkBox(x, y, w, h, .8, .2)} fill={stone} {...OS} />
    </g>
  );
  return (
    <g>
      <defs><clipPath id={`${u}f`}><path d={front} /></clipPath></defs>
      <GroundShadow cx={32} cy={56.4} rx={27} ry={3.8} />
      {faces}
      <path d={front} fill={stone} />
      <g clipPath={`url(#${u}f)`}>
        <path d={joints} {...IS} />
        <path d="M33.6 31L35.2 34.6L33.8 37.4L35.8 39.4" {...IS} />
      </g>
      <path d={front} fill="none" {...OS} />
      {/* moss on the ledges, spilling over the edge */}
      <path d="M30.8 23C31.6 20.4 35 18.6 39.2 18.6L42 17.6C40.6 16.6 37.6 16.6 35.2 17.4C33 18.2 31 20 30.8 23Z" {...IS} fill={moss} />
      <path d="M30.6 22.8C33 23.4 35.6 23 38.2 23.2C38 25.4 36.6 26.2 35.8 25C35 26.6 33.4 26.2 33.2 24.6C32 25.4 30.8 24.4 30.6 22.8Z" {...IS} fill={moss} />
      <path d="M46.6 39.4C48.2 40 49.8 39.6 51.6 39.8C51.6 41.8 50.2 42.4 49.6 41.4C48.8 42.6 47.6 42 47.6 40.8C46.8 41.2 46.2 40.4 46.6 39.4Z" {...IS} fill={moss} />
      <path d="M8.4 7.4C10.4 6.2 13.4 6 15 7C13.4 7.8 12 9.2 11.8 11C10.8 9.6 9.6 9.4 8.4 9.8Z" {...IS} fill={moss} />
      {/* ivy runner down the west end */}
      <path d="M11.6 9.6C12.4 16 10.2 21 11.8 27C13.2 32.4 11 37 12.4 43" fill="none" stroke={mossD} strokeWidth="1.2" strokeLinecap="round" />
      {[[13.4, 14.4, 30], [9.8, 20.6, -30], [13.6, 27, 30], [10.4, 33.4, -30], [13.6, 39.6, 20]].map(([x, y, a]) => (
        <ellipse key={y} cx={x} cy={y} rx="2.6" ry="1.7" transform={`rotate(${a} ${x} ${y})`} {...IS} fill={moss} />
      ))}
      {/* fallen blocks at the foot */}
      {block(49.4, 51.6, 7.4, 5, 2.6, "r1")}
      {block(1.6, 53, 5.2, 3.8, 2, "r2")}
      <ellipse cx="45.4" cy="57" rx="1.7" ry="1.1" {...IS} fill={stoneL} />
    </g>
  );
}

/* ---- BEACH and DESERT batch (case2, case10, case5): new-art props ----------------------------------------------- */
/** SHORT. Admiralty anchor lying on the ground (SHORT camera): its iron stock lies flat across the floor at the ring
 *  end, so the arms stand in the picture plane, the lower fluke resting on the ground and the upper arm curling up to
 *  about waist height. A length of chain trails from the ring along the floor. */
export function Anchor() {
  const iron = "#6b7178", ironD = "#474c52", ironL = "#a3a9ae", rust = "#a0522d";
  const tube = (d, w, c, key) => (
    <g key={key}>
      <path d={d} fill="none" stroke={INK} strokeWidth={w + 3} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
  // the anchor in its own frame: ring end at the origin, the shank along +x to the crown at x L, the arms an arc of
  // radius R round (L - R, 0) out to A degrees each side; a rotation props the crown up on the lower arm
  const L = 34, R = 14, A = 68, rot = -17, ox = 16, oy = 49.6;
  const c = Math.cos((A * Math.PI) / 180), s = Math.sin((A * Math.PI) / 180);
  const up = [L - R + R * c, -R * s], dn = [L - R + R * c, R * s];
  const fluke = ([tx, ty], sgn, fill, key) => {
    // arrowhead at an arm tip, pointing on along the arc (away from the crown)
    const ax = -s, ay = sgn * -c, nx = -ay, ny = ax;
    const P = (k, m) => [r2(tx + ax * k + nx * m), r2(ty + ay * k + ny * m)];
    return <path key={key} d={polyD(P(5, 0), P(-2.4, 3.6), P(-.6, 0), P(-2.4, -3.6))} fill={fill} {...OS} />;
  };
  // the stock goes through the shank near the ring and lies on the floor, receding up-right like a SHORT top plane
  const k = (rot * Math.PI) / 180, sx = r2(ox + 5.6 * Math.cos(k)), sy = r2(oy + 5.6 * Math.sin(k));
  const sb = [r2(sx + 3.6), r2(sy - 7.4)], sf = [r2(sx - 3.6), r2(sy + 7.4)];
  // chain links from the ring down to the floor and along it: [x, y, angle, face-on?]
  const links = [[12.4, 55.2, 75, 1], [13, 57.8, 15, 0], [16.2, 58.9, 0, 1], [19.8, 59.1, 0, 0], [23.4, 58.8, -6, 1], [26.8, 58.3, -10, 0]];
  return (
    <g>
      <GroundShadow cx={31} cy={56.8} rx={23} ry={3.2} />
      {/* back half of the stock, lying on the floor */}
      {tube(`M${sx} ${sy}L${sb[0]} ${sb[1]}`, 2.6, ironD, "sb")}
      <circle cx={sb[0]} cy={sb[1]} r="2" fill={ironD} {...OS} />
      <g transform={`translate(${ox} ${oy}) rotate(${rot})`}>
        {/* lower arm and fluke (in shade, on the ground), shank, upper arm and fluke, crown */}
        {tube(`M${r2(L)} 0A${R} ${R} 0 0 1 ${r2(dn[0])} ${r2(dn[1])}`, 3.4, ironD, "ad")}
        {fluke(dn, -1, ironD, "fd")}
        <path d={`M-.4 -1.7L${L - 1} -2.7L${L - 1} 2.7L-.4 1.7Z`} fill={iron} {...OS} />
        <path d={`M8.4 -1L${L - 4} -1.6`} stroke={ironL} strokeWidth="1" strokeLinecap="round" />
        {tube(`M${r2(L)} 0A${R} ${R} 0 0 0 ${r2(up[0])} ${r2(up[1])}`, 3.4, iron, "au")}
        {fluke(up, 1, iron, "fu")}
        <circle cx={L} cy="0" r="2.9" fill={iron} {...OS} />
        <circle cx={L - 10} cy="-.2" r="1.1" fill={rust} />
        {/* the ring through the eye at the shank's end */}
        {tube("M-3.4 -3.4A3.4 3.4 0 1 0 -3.4 3.4A3.4 3.4 0 1 0 -3.4 -3.4", 1.2, iron, "r")}
      </g>
      {/* front half of the stock over the shank, then the chain trailing from the ring */}
      {tube(`M${sx} ${sy}L${sf[0]} ${sf[1]}`, 2.6, iron, "sf")}
      <circle cx={sf[0]} cy={sf[1]} r="2" fill={iron} {...OS} />
      {links.map(([x, y, a, face], i) => (
        <g key={i} transform={`rotate(${a} ${x} ${y})`}>
          {face
            ? <><ellipse cx={x} cy={y} rx="2.1" ry="1.3" fill="none" stroke={INK} strokeWidth="2.2" /><ellipse cx={x} cy={y} rx="2.1" ry="1.3" fill="none" stroke={iron} strokeWidth=".8" /></>
            : <><path d={`M${x - 1.7} ${y}H${x + 1.7}`} stroke={INK} strokeWidth="2.8" strokeLinecap="round" /><path d={`M${x - 1.5} ${y}H${x + 1.5}`} stroke={ironD} strokeWidth="1" strokeLinecap="round" /></>}
        </g>
      ))}
    </g>
  );
}

/** TALL. Beach changing hut (a bathing hut), clearly taller than a person: a small wooden box of candy-striped boards
 *  under a pitched roof, its gable to the viewer with white bargeboards and a porthole, a coral door with a vent, on a
 *  low plinth with a step. East wall and east roof slope in shade. */
export function ChangingHut() {
  const u = useUid();
  const teal = "#6fa3a8", tealD = "#4d7d82", cream = "#f1ead8", trim = "#f7f4ec", roof = "#a5433a", roofD = "#7a2f2a";
  const door = "#d0664f", doorD = "#a24a39", wood = "#a8703f", woodD = "#6e4526", glass = "#9edaeb";
  const x = 14, y = 25, w = 34, h = 26, d = 5, ax = 31, ay = 8.6; // walls 14..48 × 25..51, apex of the roof edge
  const front = polyD([x, y + h], [x, y], [ax, ay + 2], [x + w, y], [x + w, y + h]);
  const eL = [10.6, 27.6], eR = [51.4, 27.6]; // eaves (roof overhang)
  const sh = ([px, py]) => [px + d, py - d];
  const n = 8, bw = w / n;
  return (
    <g>
      <defs><clipPath id={`${u}f`}><path d={front} /></clipPath></defs>
      <GroundShadow cx={33} cy={57} rx={24} ry={3.6} />
      {/* plinth, east wall, roof slopes (west a sliver, east in shade) */}
      <path d={slabSide(12, 50.4, 38, 4.6, 4, 4)} fill={woodD} {...OS} />
      <path d={inkBox(12, 50.4, 38, 4.6, 1, .3)} fill={wood} {...OS} />
      <path d={slabSide(x, y, w, h, d, d)} fill={tealD} {...OS} />
      <path d={`M${x + w + 2.5} ${y - 2}V${y + h - 4}M${x + w + 4} ${y - 3.5}V${y + h - 5.5}`} {...IS} />
      <path d={polyD(eL, [ax, ay], sh([ax, ay]), sh(eL))} fill={roof} {...OS} />
      <path d={polyD([ax, ay], eR, sh(eR), sh([ax, ay]))} fill={roofD} {...OS} />
      {/* front: striped boards, then the outline */}
      <path d={front} fill={cream} />
      <g clipPath={`url(#${u}f)`}>
        {Array.from({ length: n / 2 }, (_, i) => <path key={i} d={`M${r2(x + bw * (2 * i + 1))} 0h${r2(bw)}V64h${r2(-bw)}Z`} fill={teal} />)}
      </g>
      <path d={front} fill="none" {...OS} />
      {/* porthole in the gable */}
      <circle cx={ax} cy="18.4" r="3.6" fill={trim} {...OS} />
      <circle cx={ax} cy="18.4" r="2" {...IS} fill={glass} />
      {/* door with a vent and a knob, a step below */}
      <path d={inkBox(23.6, 31, 14.8, 20, 1, .3)} fill={door} {...OS} />
      <path d="M36.4 32.4V49.6" stroke={doorD} strokeWidth="1.6" strokeLinecap="round" />
      <path d={inkBox(26.6, 33.6, 8.8, 4.6, .8, .2)} {...IS} fill={doorD} />
      <path d="M27.6 35.2H34.4M27.6 36.8H34.4" stroke={trim} strokeWidth=".8" strokeLinecap="round" />
      <circle cx="35" cy="42" r="1.1" {...IS} fill={BRASS} />
      <path d={inkBox(21.6, 53.2, 18.8, 3.4, .8, .2)} fill={wood} {...OS} />
      {/* white bargeboards along the gable, a finial at the apex */}
      <path d={`M${eL[0]} ${eL[1]}L${ax} ${ay}L${eR[0]} ${eR[1]}`} fill="none" stroke={INK} strokeWidth="4.8" strokeLinejoin="round" strokeLinecap="round" />
      <path d={`M${eL[0]} ${eL[1]}L${ax} ${ay}L${eR[0]} ${eR[1]}`} fill="none" stroke={trim} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={ax} cy={ay - 1.6} r="1.6" fill={trim} {...OS} />
    </g>
  );
}

/** TALL. Steel locker, 2 m, clearly taller than a person: a two-door unit in blue-grey enamel with its top and east
 *  side showing, louvred vents at the top and bottom of each door, brass number plates, latch handles and a red
 *  padlock, on a dark plinth. */
export function Locker() {
  const paint = "#6d8fa3", paintD = "#4a687a", paintL = "#a3bccb", trim = "#3a4a55", slot = "#24303a", steel = "#c3c8cc", lock = "#c83e3b";
  const x = 17, y = 7, w = 30, h = 45, d = 5; // front 17..47 × 7..52, top to y 2, side to x 52
  const doors = [18.8, 32.6], dw = 12.6;
  return (
    <g>
      <GroundShadow cx={33} cy={57} rx={20} ry={3.4} />
      <path d={slabSide(16, 51, 32, 5, 5, 5)} fill={slot} {...OS} />
      <path d={inkBox(16, 51, 32, 5, 1, .3)} fill={trim} {...OS} />
      <path d={slabSide(x, y, w, h, d, d)} fill={paintD} {...OS} />
      <path d={slabTop(x, y, w, d, d)} fill={paintL} {...OS} />
      <path d={inkBox(x, y, w, h, 1.4, .5)} fill={paint} {...OS} />
      {doors.map((dx) => (
        <g key={dx}>
          <path d={inkBox(dx, y + 1.8, dw, h - 3.6, 1, .2)} {...IS} />
          {[12, 14.4, 16.8, 41.4, 43.8, 46.2].map((vy) => <path key={vy} d={`M${dx + 2.6} ${vy}H${dx + dw - 2.6}`} stroke={slot} strokeWidth="1.3" strokeLinecap="round" />)}
          <path d={inkBox(dx + 3.4, 20.2, 5.8, 3.2, .5, 0)} {...IS} fill={BRASS} />
          <path d={inkBox(dx === doors[0] ? dx + dw - 3.8 : dx + 1.9, 26.4, 1.9, 8.4, .8, 0)} {...IS} fill={steel} />
        </g>
      ))}
      {/* a steel hasp strap across the seam, through both latch handles, and the padlock hanging from it */}
      <path d={inkBox(27.6, 28.2, 10.6, 2.4, .8, 0)} {...IS} fill={steel} />
      <path d="M30.5 30.6V32.6A1.9 1.9 0 0 1 34.3 32.6V30.6" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M30.5 30.6V32.6A1.9 1.9 0 0 1 34.3 32.6V30.6" fill="none" stroke={steel} strokeWidth=".9" strokeLinecap="round" />
      <path d={inkBox(29.4, 33.6, 6, 5, 1, 0)} {...IS} fill={lock} />
      <circle cx="32.4" cy="35.5" r=".8" fill={INK} />
    </g>
  );
}

/** TALL. Cast-iron spiral staircase (the Lighthouse's iron stair column; the engine's SPIRAL_STAIRS, case10), painted
 *  lighthouse green and clearly taller than a person: a slim central column with a brass finial on a round foot plate,
 *  ten wedge treads winding anticlockwise up round it from the front (just over one full turn), and a brass handrail on
 *  iron balusters spiralling with them from a newel post at the bottom step to a ball end at the top of the tile. Each
 *  tread is a lit plate on a darker edge. Treads behind the column, and the back runs of the rail, are drawn first, then
 *  the column, then the front treads and rail. The round footprint is centred at y 51.6 so its front edge meets y 58. */
export function SpiralStairs() {
  const iron = "#4f7a6e", ironD = "#335047", ironL = "#86ab9f", tread = "#a3c6ba", treadD = "#3e6259";
  const cx = 32, y0 = 51.6, k = .5, sk = .14, rc = 3.2, R = 17, Rr = 16.2, N = 10, D = 38, th0 = -132, rise = 3.9, h1 = 4.4, t = 3, hr = 9.6;
  const rad = (a) => (a * Math.PI) / 180;
  // P(radius, angle, height): angle 0 points east, 90 away from the viewer, 270 toward them; depth recedes up-right
  const P = (r, a, h) => { const z = r * Math.sin(rad(a)); return [r2(cx + r * Math.cos(rad(a)) + z * sk), r2(y0 - h - z * k)]; };
  const arc = (r, a0, a1, h, n = 5) => Array.from({ length: n + 1 }, (_, j) => P(r, a0 + ((a1 - a0) * j) / n, h));
  const hAt = (a) => h1 + ((a - th0) / D) * rise; // tread-top height along the helix
  const back = [], front = [];
  for (let i = 0; i < N; i++) {
    const a0 = th0 + i * D, a1 = a0 + D + 3, h = h1 + i * rise, am = a0 + D / 2, zm = Math.sin(rad(am));
    const top = [...arc(rc, a0, a1, h, 2), ...arc(R, a1, a0, h)];
    const bot = top.map(([x, y]) => [x, r2(y + t)]);
    const [bx, by] = P(Rr, am, h), [, ty] = P(Rr, am, hAt(am) + hr);
    (zm > 0 ? back : front).push([zm, (
      <g key={i}>
        <path d={polyD(...bot)} fill={treadD} {...OS} />
        <path d={polyD(...top)} fill={tread} {...OS} />
        <path d={`M${bx} ${by}V${ty}`} stroke={ironD} strokeWidth="1.1" strokeLinecap="round" />
      </g>
    )]);
  }
  const order = (list) => list.sort((a, b) => b[0] - a[0]).map((it) => it[1]);
  // the handrail: one helix from the newel post to the top, cut into back and front runs so each draws unbroken
  const aS = th0 + D / 2, aE = th0 + N * D - 2, runs = [];
  for (let a = aS; a < aE + 4; a += 4) {
    a = Math.min(a, aE);
    const s = Math.sin(rad(a)) > 0, p = P(Rr, a, hAt(a) + hr), last = runs[runs.length - 1];
    if (last && last.s === s) last.pts.push(p); else runs.push({ s, pts: last ? [last.pts[last.pts.length - 1], p] : [p] });
  }
  // back runs draw whole before the column; front runs after it, their ink stopping three samples short of each join so
  // the round cap cannot darken the rail where it turns back on itself, and the back runs' brass is redrawn near the
  // joins (at the sides, clear of the column) over that ink
  const line = (pts) => `M${pts.map((p) => p.join(" ")).join("L")}`, last = runs.length - 1;
  const stroke = (key, d, c, w) => <path key={key} d={d} fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />;
  const rail = (s) => {
    const mine = runs.map((r, n) => [r.pts, n, r.s]).filter((r) => r[2] === s);
    if (s) return mine.flatMap(([pts, n]) => [stroke(`i${n}`, line(pts), INK, 3.6), stroke(`b${n}`, line(pts), BRASS, 1.7)]);
    const ends = runs.flatMap((r, n) => (r.s ? [n > 0 && r.pts.slice(0, 4), n < last && r.pts.slice(-4)].filter(Boolean) : []));
    return [
      ...mine.map(([pts, n]) => stroke(`i${n}`, line(pts.slice(n > 0 ? 3 : 0, n < last ? -3 : undefined)), INK, 3.6)),
      ...ends.map((pts, e) => stroke(`e${e}`, line(pts), BRASS, 1.7)),
      ...mine.map(([pts, n]) => stroke(`b${n}`, line(pts), BRASS, 1.7)),
    ];
  };
  const colTop = 4.6, [nx, ny] = P(Rr, aS, h1), [, nt] = P(Rr, aS, hAt(aS) + hr), [ex, ey] = P(Rr, aE, h1 + (N - 1) * rise), [, et] = P(Rr, aE, hAt(aE) + hr);
  return (
    <g>
      <GroundShadow cx={33} cy={53} rx={20} ry={6.6} />
      {/* round foot plate bolted to the stone floor */}
      <ellipse cx={cx} cy={r2(y0 + .2)} rx="5.6" ry="2.2" fill={ironD} {...OS} />
      {order(back)}
      {rail(true)}
      {/* the central column: a slim iron tube with its shaded east side and a finial on top */}
      <path d={inkBox(r2(cx - rc), colTop, r2(rc * 2), r2(y0 - colTop), 1, .2)} fill={iron} {...OS} />
      <path d={`M${cx + 1.3} ${r2(colTop + 1.2)}V${r2(y0 - .8)}`} stroke={ironD} strokeWidth="1.8" />
      <path d={`M${cx - 1.4} ${r2(colTop + 1.2)}V${r2(y0 - .8)}`} stroke={ironL} strokeWidth=".9" />
      <circle cx={cx} cy={r2(colTop - 1.4)} r="2.4" fill={BRASS} {...OS} />
      {order(front)}
      {/* newel posts at the bottom and top steps, the rail in front, and the posts' brass knobs */}
      <path d={inkBox(r2(nx - 1.3), nt, 2.6, r2(ny - nt + 1.4), .8, 0)} fill={ironD} {...OS} />
      <path d={inkBox(r2(ex - 1.1), et, 2.2, r2(ey - et + 1), .8, 0)} fill={ironD} {...OS} />
      {rail(false)}
      <circle cx={nx} cy={nt} r="1.8" fill={BRASS} {...OS} />
      <circle cx={ex} cy={et} r="1.8" fill={BRASS} {...OS} />
    </g>
  );
}

/** PERCH. Two-humped camel in profile, facing east like the horse and at its scale (designed with Brush; source
 *  art/props/CAMEL.svg): the rider's seat is a red cushion on an indigo saddle blanket in the dip between the humps, at
 *  the middle of the back where a placed token sits. Both humps rise clear of the token's top edge. The long neck makes
 *  the camel's U: it runs forward and down from the shoulder, bottoms out at the chest and rises again to a small head
 *  held forward (small rounded ear, heavy-lidded eye, a long rounded muzzle with a droopy split lip). Foot line at y 58. */
export function Camel() {
  const coat = "#bf9058", coatD = "#8f663a", wool = "#6e4a2c", pad = "#5b4a3e";
  const cloth = "#244573", ochre = "#d99b26", tassel = "#c83e3b", seat = "#a8303f", seatL = "#c95a66";
  // one long leg: a full thigh, a knobbly knee at y 45, a slim cannon, a wide padded foot
  const leg = (x, fill) => (
    <g key={x}>
      <path d={`M${r2(x - .8)} 33L${r2(x + 5.6)} 33L${r2(x + 4.6)} 43.2Q${r2(x + 5.5)} 45.2 ${r2(x + 4.4)} 47.2L${r2(x + 4)} 54.4H${r2(x + .8)}L${r2(x + .4)} 47.2Q${r2(x - .6)} 45.2 ${r2(x + .2)} 43.2Z`} fill={fill} {...OS} />
      <path d={inkBox(r2(x - 2), 54.4, 8.8, 3.4, 1.6, .3)} fill={pad} {...OS} />
      <path d={`M${r2(x + 2.4)} 55.4V57.4`} {...IS} />
    </g>
  );
  const humps = [
    "M13.4 24.4C13.6 15.8 16.6 8.4 20.6 8.4C24.6 8.4 27.2 14.8 27.8 21.4",
    "M36 21.4C36.6 14 39.4 7.2 43.2 7.2C47.2 7.2 49.8 14.2 50.4 23.8",
  ];
  const tufts = [[20.6, 8.4], [43.2, 7.2]].map(([hx, hy]) => `M${r2(hx - 4.8)} ${r2(hy + 5)}C${r2(hx - 3.4)} ${r2(hy + 1.2)} ${r2(hx - 2)} ${hy} ${hx} ${hy}`
    + `C${r2(hx + 2.2)} ${hy} ${r2(hx + 3.8)} ${r2(hy + 1.6)} ${r2(hx + 5)} ${r2(hy + 5.2)}L${r2(hx + 3.4)} ${r2(hy + 4.2)}L${r2(hx + 2.6)} ${r2(hy + 6)}`
    + `L${r2(hx + 1)} ${r2(hy + 4.4)}L${hx} ${r2(hy + 6.2)}L${r2(hx - 1.2)} ${r2(hy + 4.4)}L${r2(hx - 2.6)} ${r2(hy + 6)}L${r2(hx - 3.4)} ${r2(hy + 4.2)}Z`);
  // the body, legs, humps and saddle sit 5 units west of the horse's frame so the neck's U and the head fit the tile
  const B = "translate(-5 0)";
  // neck: the top line leaves the shoulder, dips forward and down to the chest and climbs to the poll; the throat
  // line comes back down from under the jaw, round the bottom of the U, to the chest (root hidden under the body)
  const neck = "M40 23L45 23.6C47.8 25 49.2 32.4 51.6 33.2C53.8 33.8 55 30 54.8 26C54.6 22 53.6 18.6 52.6 15.4"
    + "L56.6 17.6C58.4 22.6 59.4 30 58.4 35.4C57.4 39.8 53.4 41.6 49.4 40.6C46.4 39.8 43.4 37.6 40 36.6Z";
  const head = "M52.8 15.4C52 13.2 52.6 10.6 55 10C57.2 9.6 59.6 10.4 61.4 11.6C62.8 12.6 63.3 13.8 63 15L62.6 15.9"
    + "Q62 16.3 61.4 16C62 16.9 61.8 18.4 60.4 18.6C59 18.8 57.6 18.4 56.4 17.8C54.8 17.2 53.4 16.4 52.8 15.4Z";
  return (
    <g>
      <g transform={B}>
        <ellipse cx="32" cy="58" rx="21" ry="3" fill="#000" fillOpacity=".34" />
        {/* far legs one shade down, the tail, then the near legs */}
        {[22.4, 43.6].map((x) => leg(x, coatD))}
        <path d="M13 24.6C10.6 26.6 9.8 30.6 10 35.4" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
        <path d="M13 24.6C10.6 26.6 9.8 30.6 10 35.4" fill="none" stroke={coat} strokeWidth="1.4" strokeLinecap="round" />
        <path d="M10 33.6C8.2 35.6 8.4 38.4 10 40C11.6 38.4 11.8 35.6 10 33.6Z" {...IS} fill={wool} />
        {[15.8, 37.8].map((x) => leg(x, coat))}
      </g>
      {/* the U-curved neck, a fringe of darker wool round the bottom of the U */}
      <path d={neck} fill={coat} {...OS} />
      <path d="M59.2 28.4C59.6 31 59.4 33.4 58.4 35.4C57.4 39.8 53.4 41.6 49.4 40.6C47.6 40.2 45.8 39.4 44.2 38.6Q45.2 40.8 47.4 40.8Q48.8 42.6 50.8 41.8Q52.8 43.2 54.4 41.6Q56.8 41.8 57.6 39.8Q59.8 39 59.8 36.8Q61.6 35.2 60.6 33Q61.6 30.6 59.2 28.4Z" {...IS} fill={wool} />
      <g transform={B}>
        {/* barrel, belly shade, the two humps (filled over the body's top line, then inked) with their wool caps */}
        <path d="M12.6 27.6C12.6 22.6 16.6 19.8 22.4 19.8H41.6C47.4 19.8 51 22.8 51 27.8C51 33.4 47.2 37.6 40.4 37.6H22.6C16.2 37.6 12.6 33.4 12.6 27.6Z" fill={coat} {...OS} />
        <path d="M14.6 32.4C16.4 35.6 19.6 37.4 23.4 37.4H39.6C44.6 37.4 48.2 35.4 49.8 32C44.4 34.2 38.4 34.8 31.4 34.8C24 34.8 18.6 34.2 14.6 32.4Z" fill={coatD} />
        {humps.map((h, i) => <path key={i} d={`${h}V25H${i ? 36 : 13.4}Z`} fill={coat} />)}
        {humps.map((h, i) => <path key={i} d={h} fill="none" {...OS} />)}
        {tufts.map((t, i) => <path key={i} d={t} fill={wool} />)}
        {/* the seat: indigo saddle blanket with an ochre band and tassels, a red cushion in the dip between the humps */}
        <path d={inkBox(24.2, 18, 15.2, 12.6, 2, .3)} fill={cloth} {...OS} />
        <path d="M25 26.4H38.6V28.4H25Z" fill={ochre} />
        {[26.4, 29.6, 32.8, 36].map((tx) => <circle key={tx} cx={tx} cy="31.4" r="1.1" {...IS} fill={tassel} />)}
        <path d="M24.2 18.6C23.8 15.4 25.8 14.2 27.4 15.8C29.4 17.8 34.2 17.8 36.2 15.8C37.8 14.2 39.8 15.4 39.4 18.6C39 21.8 35.8 23.6 31.8 23.6C27.8 23.6 24.6 21.8 24.2 18.6Z" fill={seat} {...OS} />
        <ellipse cx="31.8" cy="20" rx="4" ry="1.3" fill={seatL} />
      </g>
      {/* the small head held forward: rounded ear, long rounded muzzle, droopy split lip, heavy-lidded eye, nostril */}
      <ellipse cx="53.6" cy="10.2" rx="1.3" ry="1.8" transform="rotate(-30 53.6 10.2)" {...IS} fill={coat} />
      <path d={head} fill={coat} {...OS} />
      <path d="M61.4 16C60.5 16.2 59.5 16.1 58.6 15.6" {...IS} />
      <path d="M56.4 17.8C57.6 17.5 59 17.5 60.2 17.7" stroke={coatD} strokeWidth=".8" fill="none" strokeLinecap="round" />
      <path d="M61.6 12.9L62.3 14" stroke={INK} strokeWidth="1" strokeLinecap="round" />
      <path d="M54.5 12.9A1.25 1.25 0 0 0 56.9 12.9Z" fill={INK} />
      <path d="M54.1 12.8Q55.7 11.6 57.3 12.8" stroke={INK} strokeWidth="1.1" fill="none" strokeLinecap="round" />
    </g>
  );
}

/** TALL. Bazaar market stall, clearly taller than a person: a red-and-cream striped awning on four wooden poles with a
 *  scalloped valance, hung with two lanterns (amber and teal glass) and a small rug; under it a counter draped in indigo
 *  cloth with three baskets of spice on top, a dark curtain at the back. */
export function MarketStall() {
  const pole = "#8a5a36", poleD = "#5e3b22", red = "#b8443a", redD = "#8a3029", cream = "#efe6cf", creamD = "#c9bd9c";
  const cloth = "#244573", clothD = "#1a3354", ochre = "#d99b26", back = "#4a2a22", wood = "#a8703f", woodD = "#6e4526";
  const brass = "#c9a24e", glow = "#f2c14e", teal = "#7cc6cf";
  const d = 6, rise = 5, fx0 = 5, fx1 = 55, fy = 15; // awning front edge 5..55 at y 15; back edge 11..61 at y 4
  const B = ([px, py]) => [px + d, py - d - rise];
  const nS = 6, sw = (fx1 - fx0) / nS;
  const cx0 = 10, cy0 = 37, cw = 40, chh = 16; // counter front 10..50 × 37..53
  const T = (uu, v) => [r2(cx0 + uu * cw + v * d), r2(cy0 - v * d)];
  const baskets = [[.14, "#c8423b"], [.38, "#e3b23c"], [.62, "#7a9a48"]];
  const scallops = Array.from({ length: nS }, (_, i) => `A${r2(sw / 2)} 2.6 0 0 1 ${r2(fx1 - sw * (i + 1))} 19.4`).join("");
  return (
    <g>
      <GroundShadow cx={33} cy={56.6} rx={26} ry={3.6} />
      {/* back curtain and back poles */}
      <path d={polyD([fx0 + d + 2, 8], [fx1 + d - 2, 8], [fx1 + d - 2, 31.4], [fx0 + d + 2, 31.4])} fill={back} {...OS} />
      {[fx0 + d + 1.4, fx1 + d - 3.4].map((px) => <path key={px} d={inkBox(px, 6, 3, 42, .8, .2)} fill={poleD} {...OS} />)}
      {/* awning top: stripes running back, then the east side flap */}
      {Array.from({ length: nS }, (_, i) => {
        const a = [fx0 + sw * i, fy], b = [fx0 + sw * (i + 1), fy];
        return <path key={i} d={polyD(a, b, B(b), B(a))} fill={i % 2 ? cream : red} {...OS} />;
      })}
      <path d={polyD([fx1, fy], B([fx1, fy]), [B([fx1, fy])[0], B([fx1, fy])[1] + 4.4], [fx1, fy + 4.4])} fill={redD} {...OS} />
      {/* counter: east side, top, draped front with an ochre band and a diamond pattern */}
      <path d={slabSide(cx0, cy0, cw, chh, d, d)} fill={woodD} {...OS} />
      <path d={slabTop(cx0, cy0, cw, d, d)} fill={wood} {...OS} />
      <path d={inkBox(cx0, cy0, cw, chh, 1.2, .3)} fill={cloth} {...OS} />
      <path d={`M${cx0 + .8} 39.6H${cx0 + cw - .8}V41.8H${cx0 + .8}Z`} fill={ochre} />
      {[17, 24.5, 32, 39.5, 45].map((mx) => <path key={mx} d={`M${mx} 44.4L${mx + 2.2} 46.8L${mx} 49.2L${mx - 2.2} 46.8Z`} fill={clothD} stroke={ochre} strokeWidth=".8" />)}
      {/* spice baskets */}
      {baskets.map(([uu, c]) => {
        const [bx, by] = T(uu, .5);
        return (
          <g key={uu}>
            <path d={`M${r2(bx - 4.4)} ${by}L${r2(bx - 3.6)} ${r2(by + 2.4)}H${r2(bx + 3.6)}L${r2(bx + 4.4)} ${by}Z`} {...IS} fill={creamD} />
            <path d={`M${r2(bx - 4.2)} ${by}Q${bx} ${r2(by - 6.4)} ${r2(bx + 4.2)} ${by}Z`} {...IS} fill={c} />
          </g>
        );
      })}
      {/* front poles */}
      {[fx0 + 2, fx1 - 5].map((px) => <path key={px} d={inkBox(px, 16, 3, 39, .8, .2)} fill={pole} {...OS} />)}
      {/* valance: one scallop per stripe */}
      <path d={`M${fx0} ${fy}H${fx1}V19.4${scallops}Z`} fill={cream} {...OS} />
      {Array.from({ length: nS / 2 }, (_, i) => {
        const xa = fx0 + sw * 2 * i, xb = xa + sw;
        return <path key={i} d={`M${r2(xa)} ${fy + .7}H${r2(xb)}V19.4A${r2(sw / 2)} 2.6 0 0 1 ${r2(xa)} 19.4Z`} {...IS} fill={red} />;
      })}
      {/* hung goods: two lanterns (amber and teal glass) and a small rug */}
      {[[18, 21, glow], [30, 23.4, teal]].map(([lx, ly, g]) => (
        <g key={lx}>
          <path d={`M${lx} ${fy + 5.6}V${ly + 1}`} {...IS} />
          <path d={`M${lx - 1.2} ${ly + 1.4}H${lx + 1.2}L${lx} ${ly - .2}Z`} {...IS} fill={brass} />
          <path d={`M${lx - 2.2} ${ly + 2.6}L${lx - 1.4} ${ly + 1.4}H${lx + 1.4}L${lx + 2.2} ${ly + 2.6}V${ly + 6.4}L${lx + 1} ${ly + 7.6}H${lx - 1}L${lx - 2.2} ${ly + 6.4}Z`} {...IS} fill={g} />
          <path d={`M${lx - 2.2} ${ly + 2.6}H${lx + 2.2}M${lx - 2.2} ${ly + 6.4}H${lx + 2.2}M${lx} ${ly + 2.6}V${ly + 6.4}`} {...IS} />
        </g>
      ))}
      <path d={inkBox(40.4, 20, 9, 10.6, .6, .2)} {...IS} fill={red} />
      <path d="M44.9 22L47.4 25.3L44.9 28.6L42.4 25.3Z" {...IS} fill={ochre} />
      <path d="M41.4 30.6V32.2M43.2 30.6V32.2M45 30.6V32.2M46.8 30.6V32.2M48.6 30.6V32.2" {...IS} />
    </g>
  );
}

/* ---- FOREST, STREET and MANSION batch 6 (case8, case9, the two MANSION multi-assassin cases): new-art props ------- */
/** Crown outline of small lobes: an arc bulging outward between each pair of points, listed clockwise. Path `d`. */
const lobed = (pts, k = .62) => `M${pts[0].join(" ")}` + pts.map((p, i) => {
  const q = pts[(i + 1) % pts.length], r = r2(Math.hypot(q[0] - p[0], q[1] - p[1]) * k);
  return `A${r} ${r} 0 0 1 ${q[0]} ${q[1]}`;
}).join("") + "Z";

/** TALL. Silver birch, clearly taller than a person and unlike the oak at a glance: ONE slim dark-barked trunk (no second
 *  stem) with pale papery bark patches and black marks on it, and white branches forking up into a tall, narrow crown of
 *  small yellow-green lobes with a pointed top. No white block at the foot: the base is dark, rough bark. */
export function Birch() {
  const u = useUid();
  const leaf = "#a5c25c", leafD = "#789a42", leafL = "#d0e08c", bark = "#f4f1e9", barkD = "#c8c2b2", foot = "#5e564d", mark = "#2a292e";
  const crown = lobed([[19.4, 41.2], [15, 35.6], [13.4, 28.4], [14.2, 20.8], [17.4, 13.6], [22.4, 7.6], [28.4, 3.4], [34.4, 1.8], [40.2, 4],
    [45.2, 8.8], [48.8, 15.4], [50.8, 22.8], [50.8, 30.4], [48, 37], [43, 40.8], [37.4, 39.6], [32, 41.2], [26, 41.8]]);
  const tube = (d, w, c) => (
    <>
      <path d={d} fill="none" stroke={INK} strokeWidth={w + 3} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
  const trunk = "M27.4 57.6C29.2 55.6 29.8 52 29.8 47.4L30.9 23H33.3L34.4 47.4C34.4 52 35 55.6 36.8 57.6Q34.4 56.6 32.2 57.8Q30 56.6 27.4 57.6Z";
  // leaf clumps over the branch tips: x, y, radius
  const clumps = [[24.6, 16.4, 3.9], [39.4, 15, 3.7], [32.4, 12.4, 3.5]];
  return (
    <g>
      <defs>
        <clipPath id={`${u}k`}><path d={crown} /></clipPath>
        <clipPath id={`${u}t`}><path d={trunk} /></clipPath>
      </defs>
      <GroundShadow cx={32} cy={57} rx={17} ry={3.4} />
      {/* crown: base, a darker underside, one lit edge, a few clump marks, then the outline */}
      <path d={crown} fill={leaf} />
      <g clipPath={`url(#${u}k)`}>
        <path d="M0 33C8 30 14 35 22 32C30 36 38 31 46 34C51 32 57 33 64 32V46H0Z" fill={leafD} />
        <path d="M14.6 27A11 11 0 0 1 24.6 7.6A10.4 10.4 0 0 0 18.6 27.4Z" fill={leafL} />
      </g>
      <path d="M18.6 33.4A4.2 4.2 0 0 1 24.2 31.4M40.6 27.4A4.4 4.4 0 0 1 46.4 25.2M42.8 9.6A4.4 4.4 0 0 1 46.6 13.6M25.6 25.4A4 4 0 0 1 28.8 22.4" {...IS} />
      <path d={crown} fill="none" {...OS} />
      {/* white branches forking from the trunk up into the crown, their tips under leaf clumps */}
      {tube("M32 28.4C29.2 24 26.8 20.6 24.8 17.6M32.2 25.6C34.6 21.6 36.8 18.6 39.2 16.2M32.2 24V14", 1.4, bark)}
      {clumps.map(([cx, cy, r]) => (
        <g key={cx}>
          <path d={lobed([[r2(cx - r), r2(cy + 1)], [r2(cx - r * .6), r2(cy - r * .7)], [r2(cx + r * .3), r2(cy - r)], [r2(cx + r), r2(cy - .2)], [r2(cx + r * .4), r2(cy + r * .8)], [r2(cx - r * .5), r2(cy + r * .8)]], .6)} fill={leaf} />
          <path d={`M${r2(cx - r * .8)} ${r2(cy + r * .5)}A${r} ${r} 0 0 0 ${r2(cx + r * .8)} ${r2(cy + r * .5)}`} {...IS} />
        </g>
      ))}
      {/* the single dark-barked trunk: a darker east side, pale papery patches up the stem, black bark marks */}
      <path d={trunk} fill={foot} />
      <g clipPath={`url(#${u}t)`}>
        <path d="M33 21V47.4C33 51.4 33.6 55 35.6 58H40V20Z" fill="#3e3832" />
        <path d="M24 24H33V28.4H24ZM24 31.4H33V35.2H24ZM24 38.4H33V41.6H24Z" fill={bark} />
        <path d="M33 24H40V28.4H33ZM33 31.4H40V35.2H33ZM33 38.4H40V41.6H33Z" fill={barkD} />
        <path d="M31 46.6L30.6 50.4M33.2 48.6L33.6 52.8M31.6 53.6L31.2 56" stroke="#8a8076" strokeWidth=".8" strokeLinecap="round" />
      </g>
      <path d={trunk} fill="none" {...OS} />
      {[[30.5, 26.6, 1.6], [32, 33.4, 1.4], [30.8, 40, 1.6]].map(([mx, my, mw]) => (
        <path key={my} d={`M${mx} ${my}H${r2(mx + mw)}`} stroke={mark} strokeWidth="1" strokeLinecap="round" />
      ))}
    </g>
  );
}

/** SHORT. Traffic cone at knee height (SHORT camera), well below a standing person: an orange cone with two white
 *  reflective bands and a dark open tip, shaded on the east, on a square black rubber base whose top shows. */
export function TrafficCone() {
  const u = useUid();
  const org = "#ec6a24", orgD = "#b54b18", orgL = "#f6965a", band = "#f4f1ea", base = "#33363e", baseL = "#4c5059", baseD = "#1f2126";
  const bx = 14.5, by = 50, bw = 31, bh = 5, dx = 5, dy = 8; // base front 14.5..45.5 × 50..55, top back edge y 42
  const cx = r2(bx + bw / 2 + dx / 2), fy = r2(by - dy / 2), ty = 24, R = 11.4, rt = 1.8, k = .34; // cone axis, foot ellipse y, tip y
  const rad = (y) => rt + (R - rt) * (y - ty) / (fy - ty);
  const cone = `M${r2(cx - R)} ${fy}L${r2(cx - rt)} ${ty}A${rt} ${r2(rt * k)} 0 0 1 ${r2(cx + rt)} ${ty}L${r2(cx + R)} ${fy}A${R} ${r2(R * k)} 0 0 1 ${r2(cx - R)} ${fy}Z`;
  // a band between heights y0 (top) and y1, following the cone's curve
  const stripe = (y0, y1) => {
    const a = rad(y0), b = rad(y1);
    return `M${r2(cx - a)} ${y0}A${r2(a)} ${r2(a * k)} 0 0 0 ${r2(cx + a)} ${y0}L${r2(cx + b)} ${y1}A${r2(b)} ${r2(b * k)} 0 0 1 ${r2(cx - b)} ${y1}Z`;
  };
  return (
    <g>
      <defs><clipPath id={`${u}c`}><path d={cone} /></clipPath></defs>
      <GroundShadow cx={33} cy={57} rx={20} ry={3.2} />
      {/* base: east side, top, front */}
      <path d={slabSide(bx, by, bw, bh, dx, dy)} fill={baseD} {...OS} />
      <path d={slabTop(bx, by, bw, dx, dy)} fill={baseL} {...OS} />
      <path d={inkBox(bx, by, bw, bh, 1, .2)} fill={base} {...OS} />
      {/* cone: orange body, two reflective bands, east shade, one lit stripe on the west */}
      <path d={cone} fill={org} />
      <g clipPath={`url(#${u}c)`}>
        <path d={stripe(29.6, 33.4)} fill={band} />
        <path d={stripe(37.4, 41.8)} fill={band} />
        <path d={`M${r2(cx + 1.2)} ${ty - 2}L${r2(cx + rad(fy) * .5)} ${fy}L${cx + R + 2} ${fy + 6}V${ty - 2}Z`} fill={orgD} fillOpacity=".55" />
        <path d={`M${r2(cx - rt - .2)} ${ty + 3}L${r2(cx - rad(fy) * .62)} ${fy - 1}`} stroke={orgL} strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <path d={cone} fill="none" {...OS} />
      <ellipse cx={cx} cy={ty} rx={rt} ry={r2(rt * k + .2)} fill={INK} />
    </g>
  );
}

/** TALL. Longcase (grandfather) clock, 2 m, clearly taller than a person: a mahogany case seen with its top and east
 *  side, on a stepped plinth; a long trunk door with a glazed window and the brass pendulum behind it; a hood with
 *  turned pillars round a cream dial with brass spandrels; an arched crest with three brass finials. */
export function Clock() {
  const wood = "#8a4526", woodL = "#b0653a", woodD = "#5a2a17", dial = "#f2ead2", brass = BRASS, brassL = "#f0c766", glass = "#2e1d17";
  const d = 4;
  const pl = [19.4, 45.6, 25.2, 10.6], tr = [22.4, 23.6, 19.2, 22], ho = [19.6, 9.2, 24.8, 14.6]; // plinth, trunk, hood: x, y, w, h
  const crest = "M19.6 9.4C20.6 5.4 25.4 3.4 32 3.4C38.6 3.4 43.4 5.4 44.4 9.4Z";
  const box = ([x, y, w, h], f, s = woodD, t = woodL) => (
    <>
      <path d={slabSide(x, y, w, h, d, d)} fill={s} {...OS} />
      <path d={slabTop(x, y, w, d, d)} fill={t} {...OS} />
      <path d={inkBox(x, y, w, h, 1, .3)} fill={f} {...OS} />
    </>
  );
  return (
    <g>
      <GroundShadow cx={33} cy={57} rx={18} ry={3.4} />
      {box(pl, wood)}
      <path d={inkBox(23, 48.6, 18, 5.4, .8, .2)} {...IS} />
      {box(tr, wood)}
      {/* trunk door: a glazed window with the pendulum rod and bob behind it */}
      <path d={inkBox(25.4, 26.2, 13.2, 17.6, 1, .2)} {...IS} />
      <path d="M27.4 42V31.4A4.6 4.6 0 0 1 36.6 31.4V42Z" {...IS} fill={glass} />
      <path d="M32 27.6V37.4" stroke={brass} strokeWidth="1" />
      <circle cx="32" cy="38.4" r="2.6" {...IS} fill={brass} />
      <path d="M28.8 33.4L30.4 31.2" stroke="#8a7d76" strokeWidth="1" strokeLinecap="round" />
      {/* hood: crest behind, box, pillars, dial */}
      <path d={crest} transform={`translate(${d} ${-d})`} fill={woodD} {...OS} />
      {box(ho, wood)}
      <path d={crest} fill={woodL} {...OS} />
      {[[21.2], [40.6]].map(([px]) => <path key={px} d={inkBox(px, 10.6, 2.2, 12, .8, 0)} {...IS} fill={woodL} />)}
      <path d={inkBox(24.4, 10.4, 15.2, 12.2, .8, .2)} {...IS} fill={brass} />
      <circle cx="32" cy="16.5" r="5.6" {...IS} fill={dial} />
      <path d="M32 11.8V12.9M32 20.1V21.2M27.3 16.5H28.4M35.6 16.5H36.7" {...IS} />
      <path d="M32 16.5L29.6 14.6M32 16.5L34.2 13" stroke={INK} strokeWidth="1.1" strokeLinecap="round" />
      {[[20.8, 7.2], [32, 2], [43.2, 7.2]].map(([fx, fy]) => <circle key={fx} cx={fx} cy={fy} r="1.5" {...IS} fill={brassL} />)}
    </g>
  );
}

/** SHORT. Tea trolley at waist height (SHORT camera): a mahogany two-tier serving trolley on four posts with brass
 *  casters and a brass push handle at the east end; on the top tray a blue-banded teapot and two cups on saucers, on
 *  the lower shelf a layer cake and a plate of scones. */
export function TeaTrolley() {
  const wood = "#8a4f2c", woodL = "#b37a4e", woodD = "#5a321b", brass = BRASS, china = "#f6f3ec", chinaD = "#cfcabe", blue = "#3f6aa8";
  const cake = "#ecd3a4", cream = "#fbf6ea", jam = "#c45970", scone = "#d9a95e", wheel = "#2a2a30";
  const x = 9, w = 38, dx = 6, dy = 13, yT = 32, yB = 47; // top tray front edge y 32 (back 19), lower shelf y 47 (back 34)
  const T = (uu, v) => [r2(x + uu * w + v * dx), r2(yT - v * dy)], L = (uu, v) => [r2(x + uu * w + v * dx), r2(yB - v * dy)];
  const post = (px, y0, y1, f) => <path d={inkBox(px, y0, 2, y1 - y0, .8, 0)} fill={f} {...OS} />;
  const caster = (cx, cy) => <circle cx={cx} cy={cy} r="1.9" fill={wheel} {...OS} />;
  const [tx, ty] = T(.34, .52), cups = [T(.66, .34), T(.84, .7)];
  const [kx, ky] = L(.3, .5), [sx, sy] = L(.7, .5);
  const hf = [x + w - 1, yT - 1.4], hb = [x + w + dx - 1, yT - dy - 1.4], ho = 4.6, hr = 2.6; // handle roots (front, back), reach, rise
  const handle = `M${hf[0]} ${hf[1]}Q${hf[0] + ho} ${hf[1]} ${hf[0] + ho} ${r2(hf[1] - hr)}L${hb[0] + ho} ${r2(hb[1] - hr)}Q${hb[0] + ho} ${hb[1]} ${hb[0]} ${hb[1]}`;
  return (
    <g>
      <GroundShadow cx={34} cy={56.8} rx={24} ry={3.4} />
      {/* back posts and casters */}
      {post(x + dx, yT - dy - 1.2, 45, woodD)}
      {post(x + w + dx - 2, yT - dy - 1.2, 45, woodD)}
      {caster(x + w + dx - 1, 45.6)}
      {/* lower shelf, and what stands on it: a layer cake and a plate of scones */}
      <path d={slabSide(x, yB, w, 2.4, dx, dy)} fill={woodD} {...OS} />
      <path d={slabTop(x, yB, w, dx, dy)} fill={woodL} {...OS} />
      <ellipse cx={kx} cy={ky + 1.4} rx="6" ry="2" {...IS} fill={china} />
      <path d={`M${r2(kx - 4.6)} ${r2(ky - 2.4)}V${r2(ky + .8)}A4.6 1.6 0 0 0 ${r2(kx + 4.6)} ${r2(ky + .8)}V${r2(ky - 2.4)}Z`} {...IS} fill={cake} />
      <path d={`M${r2(kx - 4.6)} ${r2(ky - .8)}A4.6 1.6 0 0 0 ${r2(kx + 4.6)} ${r2(ky - .8)}`} stroke={jam} strokeWidth="1.1" fill="none" />
      <ellipse cx={kx} cy={r2(ky - 2.4)} rx="4.6" ry="1.6" {...IS} fill={cream} />
      <ellipse cx={sx} cy={sy + 1.2} rx="5.6" ry="1.8" {...IS} fill={china} />
      {[[-2.2, 0], [2.2, 0], [0, -1.6]].map(([ox, oy]) => <path key={ox + oy} d={inkBox(r2(sx + ox - 2), r2(sy + oy - 1.6), 4, 2.8, 1.4, 0)} {...IS} fill={scone} />)}
      <path d={inkBox(x, yB, w, 2.6, .8, .2)} fill={wood} {...OS} />
      {/* front posts and casters */}
      {post(x, yT - 1.2, 55.4, wood)}
      {post(x + w - 2, yT - 1.2, 55.4, wood)}
      {caster(x + 1, 56)}
      {caster(x + w - 1, 56)}
      {/* top tray with a raised gallery rim */}
      <path d={slabSide(x, yT, w, 3, dx, dy)} fill={woodD} {...OS} />
      <path d={slabTop(x, yT, w, dx, dy)} fill={woodL} {...OS} />
      {/* teapot: body, blue band, lid and knob, spout to the west, handle to the east */}
      <path d={`M${r2(tx - 5.4)} ${r2(ty - 4.6)}C${r2(tx - 8.4)} ${r2(ty - 5.4)} ${r2(tx - 9.2)} ${r2(ty - 8.4)} ${r2(tx - 10.4)} ${r2(ty - 9.6)}L${r2(tx - 9)} ${r2(ty - 10.2)}C${r2(tx - 8)} ${r2(ty - 8.4)} ${r2(tx - 6.8)} ${r2(ty - 7.4)} ${r2(tx - 5)} ${r2(ty - 7)}Z`} {...IS} fill={china} />
      <path d={`M${r2(tx + 4.4)} ${r2(ty - 7.4)}C${r2(tx + 8.6)} ${r2(ty - 8)} ${r2(tx + 8.6)} ${r2(ty - 2.6)} ${r2(tx + 4.6)} ${r2(ty - 2.6)}`} fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <path d={`M${r2(tx + 4.4)} ${r2(ty - 7.4)}C${r2(tx + 8.6)} ${r2(ty - 8)} ${r2(tx + 8.6)} ${r2(ty - 2.6)} ${r2(tx + 4.6)} ${r2(ty - 2.6)}`} fill="none" stroke={china} strokeWidth="1" strokeLinecap="round" />
      <ellipse cx={tx} cy={r2(ty - 4.8)} rx="6" ry="4.8" {...IS} fill={china} />
      <path d={`M${r2(tx - 6)} ${r2(ty - 4.8)}Q${tx} ${r2(ty - 2.6)} ${r2(tx + 6)} ${r2(ty - 4.8)}`} stroke={blue} strokeWidth="1.6" fill="none" />
      <path d={`M${r2(tx + 1.6)} ${r2(ty - 1)}A6 4.8 0 0 0 ${r2(tx + 6)} ${r2(ty - 4.8)}`} stroke={chinaD} strokeWidth="1.8" fill="none" />
      <ellipse cx={tx} cy={r2(ty - 4.8)} rx="6" ry="4.8" {...IS} />
      <path d={`M${r2(tx - 3.4)} ${r2(ty - 8.6)}Q${tx} ${r2(ty - 11.2)} ${r2(tx + 3.4)} ${r2(ty - 8.6)}Z`} {...IS} fill={china} />
      <circle cx={tx} cy={r2(ty - 10.8)} r="1.1" {...IS} fill={blue} />
      {/* two cups on saucers */}
      {cups.map(([cx, cy], i) => (
        <g key={i}>
          <ellipse cx={cx} cy={cy} rx="3.6" ry="1.3" {...IS} fill={china} />
          <path d={`M${r2(cx - 2.2)} ${r2(cy - 3.2)}L${r2(cx - 1.8)} ${r2(cy - .4)}H${r2(cx + 1.8)}L${r2(cx + 2.2)} ${r2(cy - 3.2)}Z`} {...IS} fill={china} />
          <path d={`M${r2(cx - 2.1)} ${r2(cy - 2.2)}H${r2(cx + 2.1)}`} stroke={blue} strokeWidth=".9" />
          <ellipse cx={cx} cy={r2(cy - 3.2)} rx="2.2" ry=".7" {...IS} fill="#8a5232" />
        </g>
      ))}
      <path d={inkBox(x, yT - 1, w, 4, .8, .2)} fill={wood} {...OS} />
      {/* brass push handle: two short arms out from the east end's corners, joined by a bar running back */}
      {[INK, brass].map((c, i) => <path key={c} d={handle} fill="none" stroke={c} strokeWidth={i ? 1.4 : 4.4} strokeLinecap="round" strokeLinejoin="round" />)}
      {[[x + 1, yT - 1.6], [x + w - 1, yT - 1.6]].map(([fx, fy]) => <circle key={fx} cx={fx} cy={fy} r="1.4" {...IS} fill={brass} />)}
    </g>
  );
}

/* ---- Batch B: HAY_WAGON (FARM), HOT_POOL (MOUNTAINS, HotPoolSpan) ------ */

/** TALL. Farm hay wagon, side view, taller than a person (the hay tops out near 50 units): a wooden flat-bed between two
 *  low end boards, heaped with a lumpy golden mound of hay (a darker shade on the east side, pale tufts, loose strands
 *  hanging over the edge), a big spoked rear wheel and a smaller front one with iron tyres, and the shaft reaching
 *  out to the front (left) and down to the ground. A pitchfork is stuck in the heap. */
export function HayWagon() {
  const u = useUid();
  const hay = "#dcb457", hayL = "#f1da8a", hayD = "#a47c26", strand = "#b3892b";
  const wood = "#9a6a3c", woodD = "#6a4627", woodL = "#c08c55", iron = "#4b4d57";
  const mound = "M6.6 38C4.6 33 7.4 27 12 24.6C11 19 16 15.4 20.4 16.4C21.6 10 29 6.4 35.6 9.6C39.6 5.6 47.4 7.6 48.4 13.4C54.2 14.4 57.4 20.4 54.8 25.6C59.4 28 60.4 34.4 57.4 38Z";
  const wheel = (cx, cy, R, n) => (
    <g>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke={INK} strokeWidth="5" />
      <circle cx={cx} cy={cy} r={R} fill="none" stroke={wood} strokeWidth="2.6" />
      <circle cx={cx} cy={cy} r={R + 1.3} fill="none" stroke={iron} strokeWidth=".9" />
      {Array.from({ length: n }, (_, i) => {
        const a = (i * Math.PI * 2) / n + .2, d = `M${r2(cx + Math.cos(a) * 2.4)} ${r2(cy + Math.sin(a) * 2.4)}L${r2(cx + Math.cos(a) * (R - 1))} ${r2(cy + Math.sin(a) * (R - 1))}`;
        return <g key={i}><path d={d} stroke={INK} strokeWidth="2.6" strokeLinecap="round" /><path d={d} stroke={woodL} strokeWidth="1.1" strokeLinecap="round" /></g>;
      })}
      <circle cx={cx} cy={cy} r={R > 9 ? 3.2 : 2.6} fill={woodD} {...OS} strokeWidth="1.2" />
      <circle cx={cx} cy={cy} r=".9" fill={iron} />
    </g>
  );
  return (
    <g>
      <defs><clipPath id={`${u}m`}><path d={mound} /></clipPath></defs>
      <GroundShadow cx={32} cy={57.6} rx={29} ry={3.4} />
      {/* shaft out to the front and down to the ground */}
      <path d="M16 46L2.2 55.4" stroke={INK} strokeWidth="4.4" strokeLinecap="round" />
      <path d="M16 46L2.2 55.4" stroke={wood} strokeWidth="2.2" strokeLinecap="round" />
      {/* end boards and the flat-bed */}
      <path d={inkBox(6.4, 27, 3.2, 16, .8, .2)} fill={woodD} {...OS} />
      <path d={inkBox(55.4, 27, 3.2, 16, .8, .2)} fill={woodD} {...OS} />
      {/* hay heap */}
      <path d={mound} fill={hay} />
      <g clipPath={`url(#${u}m)`}>
        <path d="M44 4C47 18 49 28 47 42H62V4Z" fill={hayD} />
        <path d="M14 22C20 12 30 9 36 12C30 14 22 18 18 26Z" fill={hayL} />
        <path d="M23 29h5M33 24h5M10 31h4M38 33h5M50 30h4M26 36h6M16 36h3M31 17h4M44 20h3M8 26h3" stroke={strand} strokeWidth="1" strokeLinecap="round" fill="none" />
        <path d="M22 15l2.6 -2.4M39 9l2 2.6M16 21l2 2.2M52 19l-2 2.4" stroke={hayL} strokeWidth="1" strokeLinecap="round" fill="none" />
      </g>
      <path d={mound} fill="none" {...OS} />
      {/* loose hay hanging over the bed edge */}
      <path d="M4.4 39.4l2.6 -1.6M5.6 42l2.8 -2M59.6 39.2l-2.4 -1.8M58.6 41.8l-2.6 -2" stroke={strand} strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <path d={inkBox(5, 37.6, 54, 5.8, 1, .3)} fill={wood} {...OS} />
      <path d="M12 40.4H52" stroke={woodD} strokeWidth=".9" fill="none" />
      {/* pitchfork stuck in the heap: the long handle with its cross grip */}
      <path d="M45.8 14.6L55.6 2.8" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <path d="M45.8 14.6L55.6 2.8" stroke={woodL} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M52.6 7.4L58.4 10.6" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <path d="M52.6 7.4L58.4 10.6" stroke={woodL} strokeWidth="1.3" strokeLinecap="round" />
      {/* wheels: rear (big) and front (small) */}
      {wheel(43, 47, 10.4, 8)}
      {wheel(18, 50, 7.4, 6)}
    </g>
  );
}

/** LOW. Hot spring pool seen from above, drawn once across its span (1x1, 1x2, 2x1 or 2x2 tiles): an irregular, rounded
 *  basin of milky blue-green water in concentric bands (pale shallows at the rim, deeper toward the middle), ringed by
 *  grey volcanic rim stones (the east and south ones a shade darker) with a few snow caps on the north side, and soft
 *  wisps of steam curling off the water. The middle stays calm for a soaking token. Flush with the floor: no shadow. */
export function HotPoolSpan({ cw = 1, ch = 1 }) {
  const u = useUid();
  const W = 64 * cw, H = 64 * ch, cx = W / 2, cy = H / 2;
  const ax = W / 2 - 3.6, ay = H / 2 - 3.6, wx = ax - 7, wy = ay - 7;
  const wob = (a) => 1 + .06 * Math.sin(2 * a + 2.2) + .035 * Math.sin(3 * a + .4) + .02 * Math.sin(5 * a + 3.1);
  const at = (a, rx, ry, ox = 0, oy = 0) => [cx + ox + rx * wob(a) * Math.cos(a), cy + oy + ry * wob(a) * Math.sin(a)];
  const ring = (rx, ry, ox = 0, oy = 0, n = 72) => Array.from({ length: n }, (_, i) => at((i / n) * Math.PI * 2, rx, ry, ox, oy));
  const rim = ring(ax, ay), water = ring(wx, wy), mid = ring(wx - 3.2, wy - 3.2, .8, .8), deep = ring((wx - 3) * .58, (wy - 3) * .58, 1.6, 1.6);
  // rim stones at an even spacing along the middle of the rim band
  const band = ring(ax - 3.5, ay - 3.5, 0, 0, 480);
  const cum = [0];
  for (let i = 1; i <= band.length; i++) { const p = band[i - 1], q = band[i % band.length]; cum.push(cum[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1])); }
  const total = cum[band.length];
  const tone = ["#8e939b", "#a4a9b0", "#7a7f88"], toneD = ["#6b7078", "#5d626a", "#777c84"];
  const hsh = (n) => { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v); };
  const blob = (x, y, rr, rot, i, k = 1) => polyD(...Array.from({ length: 7 }, (_, j) => {
    const a = rot + (j * Math.PI * 2) / 7, q = rr * k * (.74 + .42 * hsh(i * 7 + j + 1));
    return [x + Math.cos(a) * q * 1.18, y + Math.sin(a) * q * .9];
  }));
  // stones at uneven spacing along the middle of the rim band
  const stones = []; let acc = 2;
  for (let i = 0; acc < total - 3; i++) {
    const step = 5.6 + hsh(i + 3) * 3.2;
    let kk = cum.findIndex((c) => c >= acc); if (kk < 1) kk = 1;
    const p = band[(kk - 1) % band.length], q = band[kk % band.length];
    stones.push({ x: p[0], y: p[1], ang: Math.atan2(q[1] - p[1], q[0] - p[0]), i, rr: step * .46, shade: (p[0] - cx) / ax + (p[1] - cy) / ay > .45, north: (p[1] - cy) / ay < -.4 });
    acc += step;
  }
  const wisp = (x, y, s, rot = 0, k = 0) => (
    <g key={`${r2(x)}${r2(y)}${k}`} transform={`translate(${r2(x)} ${r2(y)}) rotate(${rot}) scale(${s})`}>
      <path d="M0 0q3.4 -2.6 .6 -5.4t.6 -5.6" fill="none" stroke="#fff" strokeOpacity=".62" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M-3 1.6q2.8 -2.2 .4 -4.4" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  );
  const bub = (x, y, rr) => <circle key={`${r2(x)}${r2(y)}`} cx={r2(x)} cy={r2(y)} r={rr} fill="none" stroke="#f1fffb" strokeOpacity=".8" strokeWidth=".8" />;
  const big = cw * ch > 2;
  return (
    <g>
      <defs><clipPath id={`${u}w`}><path d={polyD(...water)} /></clipPath></defs>
      <path d={polyD(...rim)} fill="#5f646c" {...OS} />
      {stones.map((s) => (
        <g key={s.i}>
          <path d={blob(s.x, s.y, s.rr + .2, s.ang, s.i)} {...IS} fill={(s.shade ? toneD : tone)[s.i % 3]} strokeWidth=".8" />
          {s.north && s.i % 2 === 0 ? <path d={blob(s.x - .6, s.y - .8, s.rr + .2, s.ang, s.i, .58)} fill="#f4f8fb" /> : null}
        </g>
      ))}
      <path d={polyD(...water)} fill="#8fdcd0" />
      <g clipPath={`url(#${u}w)`}>
        <path d={polyD(...mid)} fill="#4cbab6" />
        <path d={polyD(...deep)} fill="#2f9aa6" />
      </g>
      <path d={polyD(...water)} {...IS} fill="none" />
      {/* a glint, ripples and bubbles: kept off the middle */}
      <path d={`M${r2(cx - wx * .56)} ${r2(cy - wy * .4)}q1.6 -1 3.4 0`} stroke="#fff" strokeWidth="1" strokeLinecap="round" fill="none" />
      <ellipse cx={r2(cx + wx * .5)} cy={r2(cy + wy * .5)} rx="5.6" ry="2.3" fill="none" stroke="#e6fffa" strokeOpacity=".65" strokeWidth=".9" />
      {bub(cx - wx * .46, cy + wy * .36, 1.2)}{bub(cx - wx * .34, cy + wy * .5, .8)}{bub(cx + wx * .3, cy - wy * .5, 1)}
      {/* steam wisps curling up off the water */}
      {wisp(cx - wx * .6, cy + wy * .3, 1.15, -8)}
      {wisp(cx + wx * .52, cy - wy * .05, 1.25, 10, 1)}
      {wisp(cx + wx * .02, cy - wy * .5, 1.2, -4, 2)}
      {big ? <>{wisp(cx - wx * .26, cy + wy * .62, 1.3, 6, 3)}{wisp(cx + wx * .66, cy + wy * .5, 1.2, -10, 4)}</> : null}
    </g>
  );
}
export const HotPool = () => <HotPoolSpan cw={1} ch={1} />;

/* ---------------------------------------------------------------------- */
/*  Registry + dispatcher                                                  */
/* ---------------------------------------------------------------------- */
export const SPRITES = { TABLE: Table, PLANT: Plant, SHELF: Shelf, TV, STATUE: Statue, PILLAR: Pillar, SAFE: Safe, PIANO: Piano,
  SCREEN: Screen, CHAIR: Chair, RUG: Rug, STOOL: Stool, CORPSE: Corpse,
  CRATE: Crate, BARREL: Barrel, PUDDLE: Puddle,
  HAYBALE: Haybale, TRACTOR: Tractor, WELL: Well, TREE: Tree, MUD: Mud, STRAW_MAT: StrawMat,
  PALM: Palm, UMBRELLA: Umbrella, SURF_RACK: SurfRack, TOWEL: Towel, BOAT: Boat,
  PINE: Pine, BOULDER: Boulder, SHRUB: Shrub, TENT: Tent, STUMP: Stump, MOSS: Moss,
  SNOW_PINE: SnowPine, CAIRN: Cairn, FIREPLACE: Fireplace, SLED: Sled, ICE: Ice,
  CACTUS: Cactus, OBELISK: Obelisk, AMPHORA: Amphora, OASIS_POOL: OasisPool, WOVEN_MAT: WovenMat,
  DUMPSTER: Dumpster, PHONE_BOOTH: PhoneBooth, HYDRANT: Hydrant, FOUNTAIN: Fountain, MANHOLE: Manhole, GRATE: Grate,
  EASEL: Easel, DISPLAY_CASE: DisplayCase, CHANDELIER_FALL: ChandelierFall, GRAMOPHONE: Gramophone,
  SCARECROW: Scarecrow, TROUGH: Trough, LIFEGUARD_CHAIR: LifeguardChair, TIKI_TORCH: TikiTorch, TOTEM: Totem,
  WOODPILE: Woodpile, SANDSTONE_ARCH: SandstoneArch, STREETLIGHT: Streetlight, NEWSSTAND: Newsstand,
  TRAPDOOR: Trapdoor, FOOTPRINTS: Footprints, BROKEN_GLASS: BrokenGlass, LANTERN: Lantern, CUSHION: Cushion, CARPET_RUNNER: CarpetRunner, FLOOR_GRATE: FloorGrate,
  WHEELBARROW: Wheelbarrow, BUCKET: Bucket, CHICKEN_FEED: ChickenFeed, SANDCASTLE: Sandcastle, STARFISH: Starfish, COOLER: Cooler, DRIFTWOOD: Driftwood,
  CAMPFIRE: Campfire, FERN: Fern, FALLEN_LOG: FallenLog, SNOWDRIFT: Snowdrift, PICKAXE: Pickaxe,
  BONES: Bones, SCORPION_NEST: ScorpionNest, POTTERY_SHARDS: PotteryShards, FLOOR_PILLOW: FloorPillow, TRASH_BAG: TrashBag, CARDBOARD_BOX: CardboardBox, GRAFFITI: Graffiti,
  // new art (art/STYLE.md, 2026-10-28)
  HORSE: Horse, OAK: Oak, SOFA: Sofa,
  ARMOR: Armor, BILLIARD_TABLE: BilliardTable, DESK: Desk, STOVE: Stove, WINE_RACK: WineRack,
  BARBER_CHAIR: BarberChair, BENCH: Bench, JUKEBOX: Jukebox, POSTER_COLUMN: PosterColumn, WASHER: Washer, WATER_TOWER: WaterTower,
  BEARSKIN: Bearskin, FAIRY_RING: FairyRing, SKI_RACK: SkiRack, SNOWMAN: Snowman, ICE_PILLAR: IcePillar, RUINED_WALL: RuinedWall,
  ANCHOR: Anchor, CHANGING_HUT: ChangingHut, LOCKER: Locker, CAMEL: Camel, MARKET_STALL: MarketStall,
  WARDROBE: Wardrobe, TRASH_CAN: TrashCan, BEEHIVE: Beehive, SARCOPHAGUS: Sarcophagus,
  BIRCH: Birch, TRAFFIC_CONE: TrafficCone, CLOCK: Clock, TEA_TROLLEY: TeaTrolley,
  SPIRAL_STAIRS: SpiralStairs,
  HAY_WAGON: HayWagon, HOT_POOL: HotPool };
export const PROP_ORDER = ["TABLE", "PLANT", "SHELF", "TV", "STATUE", "PILLAR", "SAFE", "PIANO", "SCREEN", "CHAIR", "RUG", "BED", "STOOL", "CORPSE", "EASEL", "DISPLAY_CASE", "CHANDELIER_FALL", "GRAMOPHONE", "CUSHION", "CARPET_RUNNER", "FLOOR_GRATE", "SOFA",
  "ARMOR", "BILLIARD_TABLE", "DESK", "STOVE", "WINE_RACK", "CLOCK", "TEA_TROLLEY",
  "CRATE", "BARREL", "PUDDLE", "TRAPDOOR", "FOOTPRINTS", "BROKEN_GLASS", "LANTERN",
  "HAYBALE", "TRACTOR", "HAY_WAGON", "WELL", "TREE", "MUD", "STRAW_MAT", "SCARECROW", "TROUGH", "WHEELBARROW", "BUCKET", "CHICKEN_FEED", "HORSE",
  "PALM", "UMBRELLA", "SURF_RACK", "TOWEL", "BOAT", "LIFEGUARD_CHAIR", "TIKI_TORCH", "SANDCASTLE", "STARFISH", "COOLER", "DRIFTWOOD", "CHANGING_HUT", "LOCKER", "ANCHOR", "SPIRAL_STAIRS",
  "PINE", "BOULDER", "SHRUB", "TENT", "STUMP", "MOSS", "TOTEM", "CAMPFIRE", "FERN", "FALLEN_LOG", "WOODPILE", "OAK", "BIRCH", "FAIRY_RING", "RUINED_WALL",
  "SNOW_PINE", "CAIRN", "FIREPLACE", "SLED", "ICE", "SNOWDRIFT", "PICKAXE", "BEARSKIN", "SKI_RACK", "SNOWMAN", "ICE_PILLAR", "HOT_POOL",
  "CACTUS", "OBELISK", "AMPHORA", "OASIS_POOL", "WOVEN_MAT", "SANDSTONE_ARCH", "BONES", "SCORPION_NEST", "POTTERY_SHARDS", "FLOOR_PILLOW", "CAMEL", "MARKET_STALL",
  "DUMPSTER", "PHONE_BOOTH", "HYDRANT", "FOUNTAIN", "MANHOLE", "GRATE", "STREETLIGHT", "NEWSSTAND", "TRASH_BAG", "CARDBOARD_BOX", "GRAFFITI",
  "BARBER_CHAIR", "BENCH", "JUKEBOX", "POSTER_COLUMN", "WASHER", "WATER_TOWER", "TRAFFIC_CONE", "TRASH_CAN", "WARDROBE", "BEEHIVE", "SARCOPHAGUS"];
export const PROP_NOTE = {
  TABLE: "Chestnut table at waist height: a plank top seen from above with a cream linen runner hanging over the front edge, a jug of flowers and a bowl of fruit on it, an apron and four square legs. Waist height: sight passes over.",
  PLANT: "Big potted plant: a dense fan of about twenty long ribbed leaves on short stems growing out of the soil inside a terracotta pot, arching up past head height, with two leaves spilling over the rim in front of the pot. Tall.",
  SHELF: "Floor-to-ceiling oak bookcase: cornice, four shelves of colourful leaning books with a red vase, a two-door cupboard with brass knobs below, top and east side showing. Tall: blocks light.",
  TV: "Console television in a tall teak cabinet: black bezel with a rounded blue screen and glare, two dials and a slider, cream speaker grille below, rabbit-ear antenna on top. Tall: blocks light.",
  STATUE: "Life-size marble statue in a draped robe holding a laurel wreath up in one hand, on a stepped stone plinth, shaded on the east. Well above head height. Tall.",
  PILLAR: "Fluted limestone column with real volume: a square plinth and a round base, a rounded shaft lit on the left and shaded on the right with flutes wrapping round it, a necking ring, a round flared capital and a square slab, seen from slightly above. Tall.",
  SAFE: "Tall walk-in vault safe on a plinth: door with hinges, a spoked wheel handle and a combination dial. Rises well above a person. Tall.",
  PIANO: "Upright piano in black lacquer with brass candle sconces, sheet music and a keyboard; its padded red bench is pulled up in front, centred on the keyboard, where the pianist sits. Perch: you can sit at it.",
  SCREEN: "Three-panel folding screen in a zigzag, red-brown frames: bamboo, a red sun over blue hills, plum blossom; a crimson robe hangs over the near panel. Tall: made to hide people, blocks light.",
  CHAIR: "Walnut dining chair, kept low: a woven rush seat at knee height, three spindles under a top rail no higher than a desk top, four square legs. Someone sits on it. No shadow.",
  RUG: "Persian rug, one flat top-down piece across its whole span (1x1 up to 3x2, both ways): red border, navy band, crimson field with a navy and cream lozenge at its centre and a navy triangle in each corner, cream fringe at the short ends. No shadow.",
  BED: "Bed across its span (1x2 down a column, 2x1 along a row), kept low in the sofa's camera: a blue duvet with a cream cuff, two plump pillows at the head, a walnut headboard and a lower footboard. No shadow.",
  STOOL: "Round mahogany stool, kept low: a thick seat at knee height with a hand slot, on four splayed legs joined by rungs. Someone perches on it. No shadow.",
  CORPSE: "The case's target, the same character as on the target polaroid (hair, face, skin and outfit), seen from above lying on their back at an angle with X eyes: one arm flung past the head, legs splayed, in a dark blood pool. The tutorial's is the ivory crash-test dummy; the finale's (CORPSE_MASTER) is Master U. M. Bra with his brass spectacles beside him (no chalk outline). Fixed, never occupied; light passes over it.",
  CRATE: "Pine shipping crate, knee to waist height: a lid of three boards, a framed front with a diagonal brace and nail heads, a hand hole in the darker east side. Sight passes over.",
  BARREL: "Oak barrel at waist height: the lid seen from above with two boards and a bung, bulging staves shaded on the east, two iron hoops. Sight passes over.",
  PUDDLE: "Lobed pool of rain water seen from above, a deeper shade on its far edge, a pale sky streak and a ripple ring, with a small splash puddle beside it. Flush, no shadow.",
  HAYBALE: "Six tied golden hay bales stacked in a 3-2-1 pyramid, each seen from the front and slightly above with two twine bands, straw ticks and a darker east end; the stepped tops show at both sides. Well above head height. Tall.",
  TRACTOR: "Red farm tractor in side view: long hood with a cream grille, lamp and vents, an exhaust stack, a glazed cab with seat and steering wheel under a roof slab, a big lugged rear wheel under a mudguard and a small front wheel. About 53 units tall. Tall.",
  WELL: "Low round stone well at waist height: staggered stones shaded on the east, a stone rim round dark water, two timber posts to a crank beam with a rope, wooden bucket and crank handle. No roof, so sight passes over. Short.",
  TREE: "Apple tree: a round bright-green crown of scalloped lobes with a darker underside and red apples, on a slim brown trunk forking into two limbs, windfall apples at its foot. Clearly taller than a person and unlike the broad oak or the white birch. Tall.",
  MUD: "Mud patch, a flat top-down lobed puddle of wet brown mud: a darker far edge, two pale wet streaks, a bubble ring, a boot print and two splats. Flush: you stand in it. No shadow.",
  STRAW_MAT: "Straw mat, flat top-down: a golden twill of crossing straw stripes, a darker braided border with plait ticks and loose-straw fringe at both ends. Flush: you sit on it. No shadow.",
  PALM: "Beach palm, about 56 units tall: a slim leaning trunk with growth rings, shaded on its east half, under a crown of long toothed fronds that arch and droop (far ones darker, near ones lighter) with three coconuts under the hub. Tall.",
  UMBRELLA: "Beach umbrella planted in the sand: a white pole pushed into a small sand mound, rising to a wide open canopy of eight red and cream panels (its top showing) with scalloped edges, a red valance round the front and a brass finial. You stand under it. Low: no cast shadow.",
  SURF_RACK: "Surfboard rack about 2 m tall: a wooden trough with end posts and rails holding four upright boards with pointed noses and a dark stringer down each, in teal, coral, yellow and green with cream stripes. Tall.",
  TOWEL: "Striped beach towel laid flat, top-down: long teal, cream and coral stripes, a hem line and fringe at each short end, one corner turned over. One cell only. Flush.",
  BOAT: "Wooden rowboat you sit in, low: a blunt stern and pointed bow, a teal hull side with a cream stripe under a light wood gunwale, the sunk interior with plank thwarts, brass oarlocks and a bow ring. Drawn across 1 x 1, 2 x 1 (bow east) and 1 x 2 (bow north) spans. Light passes over it.",
  PINE: "Pine tree, taller than a person: three stacked cones of dark blue-green needles with ragged toothed skirts, shaded on the east with a lit west streak, over a short bare trunk with a flared foot. Tall.",
  BOULDER: "Boulder bigger than a person: a squat faceted grey rock with a lit west plane, a dark east face, cracks and a cap of moss on top. Tall.",
  SHRUB: "Dense shrub above head height: a tall mound of leafy green lobes running down to the ground with no trunk, a dark lower half, leaf marks and red berries. Tall.",
  TENT: "Ridge tent taller than a person: an orange canvas front gable with a dark doorway and a flap folded back, the shaded roof plane receding east, a ridge knob and one low guy rope pegged out at the back corner. Tall.",
  STUMP: "Tree stump you sit or stand on, knee height: a squat bark-sided cylinder shaded on the east with a flared foot and a moss tuft, its sawn top showing growth rings and a crack. Low, occupiable.",
  MOSS: "Moss patch seen from above: a lobed green cushion with a darker south-east edge, a lighter crown inside, tuft marks and seed dots. Flush: you stand on it. No shadow.",
  SNOW_PINE: "Snow pine taller than a person: three fat tiers of blue-green boughs hung in round scallops down to the ground, each under a white snow cap with its own scalloped edge, the east half a shade darker, a snowy tip and only a stub of trunk showing. Tall.",
  CAIRN: "Stone cairn at waist height: four grey stones stacked wide to narrow, each a rounded blob with a lit flat top and a darker rim, a pebble on top, a flat shadow beneath. Sight passes over it. Short.",
  FIREPLACE: "Stone fireplace taller than a person: a coursed stone surround with an arched firebox (two logs, a flame, a glow on the hearth), a wooden mantel with a candle at each end, the narrower chimney breast above it rising to a stepped cornice, a hearth step at the foot. Tall.",
  SLED: "Toboggan you sit on, kept low: a plank deck at knee height with slats and two steel cross-bars, a red nose curling up at the east end with a pull rope trailing to the floor, steel runners underneath. Flush, no shadow.",
  ICE: "Sheet of ice seen from above: an angular pale-blue patch with a lighter glaze, a darker south-east rim, a branching crack with a lit edge, trapped bubbles and glints. Flush: you stand on it. No shadow.",
  CACTUS: "Saguaro taller than a person: a ribbed green trunk with a domed top and a pink flower, two upturned arms at different heights, one clean outline round the whole plant, the east side a shade darker, cream spines. Tall.",
  OBELISK: "Sandstone obelisk taller than a person, standing on the floor: a two-step plinth whose lower block sits flat on the ground with a shadow round its foot and drifted sand, a square shaft narrowing to the top with a cartouche and rows of carved glyphs, a lit front and shaded east face, and a pointed pyramidion with a gilded tip. Tall.",
  AMPHORA: "Waist-high terracotta amphora: a plump jar with a flared lip showing its dark mouth, a narrow neck, two loop handles, a foot ring and painted brown and cream bands with a zigzag, the east side a shade darker. Sight passes over it. Short.",
  OASIS_POOL: "Oasis pool seen from above, drawn once across its 1x1, 1x2, 2x1 or 2x2 span: an irregular turquoise pool inside a ring of rounded sandstone rim stones, deeper toward the south-east, with ripples, glints and lily pads. Flush: you wade in it. No shadow.",
  WOVEN_MAT: "Woven kilim laid flat, seen from above: an indigo border, a cream band with an ochre zigzag, a red field with three diamonds, short fringe at both ends, laid slightly askew. You sit on it. Flush. No shadow.",
  DUMPSTER: "Big alley dumpster, 1.8 m, clearly taller than a person: a green steel bin with pressed ribs, a mid band, a cream stencil plate and a hazard strip on two black casters, under a grey hinged lid that stands open a crack at the back on a dark gap with a bin bag poking out. East side a shade darker. Tall.",
  PHONE_BOOTH: "Red telephone kiosk, 2.2 m, clearly taller than a person: a slim box with a cream sign strip in the roof lintel, a door of ten glass panes in red glazing bars with a brass handle and the coin phone dark behind the glass, a glazed east side and a dark plinth. Tall.",
  HYDRANT: "Red cast-iron fire hydrant at knee height, drawn in the waist-height camera: a wide flange, a barrel with a collar, a bonnet under a dome with a brass nut, two brass-capped side outlets and a big brass pumper nozzle facing the viewer, the east side a shade darker. Short: sight passes over it.",
  FOUNTAIN: "Tiered stone plaza fountain, clearly taller than a person: a wide pale-stone basin with its blue water showing, a stem into a mid bowl, a second stem into a small top bowl, a water jet over the top and curtains of water falling from each bowl; the east side of the stone a shade darker. Tall.",
  MANHOLE: "Manhole cover seen from above: a heavy round iron frame with a darker lower-right edge and a lit upper-left edge, the cover set in it with a waffle of diamonds, a ring, a centre plate and two lifting slots either side of the middle. Flush with the road. No shadow.",
  GRATE: "Steam grate in the street, seen from above: a galvanised frame bolted at the corners round a dark pit with eight pale bars and two cross-ties, and three wavy plumes of white steam curling up out of the north edge. Flush with the pavement. No shadow.",
  // catalog expansion (40)
  EASEL: "Painter's easel at full height: two splayed legs and a back leg under a top clamp, a cross brace, a canvas with a sunny landscape resting on a ledge with a paint tube and brush. Tall: blocks light.",
  DISPLAY_CASE: "Museum display case at waist height: a glass cube with brass corner posts on a walnut plinth with a brass plaque; inside, a gold crown (jewelled band, pearl-tipped points, arches over a velvet cap, an orb and cross) on a crimson velvet cushion. Short: sight passes over it.",
  CHANDELIER_FALL: "A brass chandelier crashed flat on the floor, seen from above: a hoop with curling arms to a crystal hub, empty candle cups round the rim with the candles thrown out and lying on the floor, crystals spilled around, and its snapped chain lying slack on the floor. Flush with the floor, no shadow. Low: you can stand on it.",
  GRAMOPHONE: "Cabinet gramophone at waist height: a walnut cabinet with a grille, a small door and a brass crank, a black record and chrome tonearm on top, a brass horn flaring up and out to the left. Short: sight passes over it.",
  SCARECROW: "Scarecrow on a timber post, about 56 units tall: a burlap sack head with button eyes and a stitched mouth under a battered straw hat with a red band, a red plaid shirt with ragged sleeves and straw at the cuffs, patched blue trousers stuffed with straw. Tall.",
  TROUGH: "Wooden water trough at waist height: a long plank box on stubby feet, a wood rim round a dark inside with clear water in it, two riveted iron bands round the planked front, a drip down one band. Sight passes over. Short.",
  LIFEGUARD_CHAIR: "Lifeguard tower chair, about 52 units tall: a whitewashed seat platform with a red cushion high on four splayed legs, a ladder in front, and a tall slatted backrest under a red top rail with a red cross plate, the seat as wide as the backrest and centred under it. Tall.",
  TIKI_TORCH: "Waist-high tiki torch: a bamboo pole with a node ring in a low sand mound, a flared coconut-brown cup lashed on with rope, dark coals in its mouth and an orange flame with a yellow core. Short.",
  TOTEM: "Carved totem pole taller than a person, on a stone foot: a red eagle on top with a gold hooked beak and wings spread wide, a teal frog with a wide mouth in the middle, a brown bear with round ears and a tan muzzle at the bottom. Tall.",
  WOODPILE: "Woodpile stacked above head height under a small lean-to, clearly taller than a person: two timber posts carrying a plank roof, six rows of split logs stacked end-on up to the eaves (cut ends with bark rims and growth rings, a few split through), the log bodies running back on the east side, loose splits at the foot. Tall.",
  SANDSTONE_ARCH: "Natural sandstone arch taller than a person, with volume: two rounded pillars worn in near the foot, joined by a span over a clear opening to the floor; the top of the span lit, the east faces (and the inner face of the west pillar) shaded, strata bands wrapping from the front round onto them, each pillar lit on its west edge, sand drifted at both feet. Tall.",
  STREETLIGHT: "Cast-iron lamp post reaching the top of the tile, clearly taller than a person: a stepped round foot on the floor, a fluted base column, a slim post with collars and a ladder bar, and a four-paned glass lantern under a domed cap with a finial, a pale halo round the glass, the east side a shade darker. Tall: blocks sight.",
  NEWSSTAND: "Street newsstand kiosk, clearly taller than a person: a teal cabin with a roof lintel and a cream sign strip, a crimson and cream striped scalloped awning over a window of racked magazines, a wooden counter with a stack of papers, a panelled base and a poster on the darker east side. Tall.",
  TRAPDOOR: "Oak plank hatch set flush in a dark frame, seen from above: two iron strap hinges from the north edge and a ring pull near the south-east corner. Flush, no shadow.",
  FOOTPRINTS: "Trail of muddy boot prints seen from above, left and right in step, with tread bars: corner to corner on one tile, one trail along a whole span. Flush, no shadow.",
  BROKEN_GLASS: "Scatter of pale glass shards seen from above, big ones out toward the edges and corners, splinters between, glints on the largest. Flush, no shadow.",
  LANTERN: "Hurricane lantern on the ground: brass tank, glass globe with the flame, iron cap and bail handle, standing in a flat pool of warm light. Ankle-to-knee height: sight passes over.",
  CUSHION: "Floor cushion, a plump top-down pillow: teal cover with pinched corners and bowed sides, one darker corner, a cream piping line, creases to a small central button and a brass tassel at each corner. Flush: you sit on it. No shadow.",
  CARPET_RUNNER: "Hall runner, one flat top-down strip across its tiles: straight (1x3, 3x1, 1x4, 4x1) or an L that turns one corner (4 or 5 tiles), following the tiles the board passes. Deep-green border and a green field with gold lines running continuously round the corner with a mitred seam, a cream and gold lozenge on every tile (a square medallion on the corner tile) with a gold stud between, cream fringe at the two ends only. No shadow.",
  FLOOR_GRATE: "Iron floor grate, flat top-down: a slate-grey frame with a bolt at each corner round a dark opening crossed by five heavy bars and two thin ties. Flush. No shadow.",
  WHEELBARROW: "Rust-red wheelbarrow at waist height, seen from the side with the tray from above: a tapered tray with a lighter rim and a dark empty inside, a dark rubber wheel on a wooden fork at the nose, two wooden handles to the ground and a stand leg. Short.",
  BUCKET: "Galvanised bucket turned upside down, top-down: the round grey base inside its rolled rim, the bail handle flopped out to the east, and spilled water pooled to the south-west with two drops. Flush.",
  CHICKEN_FEED: "Chicken feed spilled on the ground, top-down: a low heap of golden grain in the middle, loose kernels thrown all round and two dropped feathers. Flush.",
  SANDCASTLE: "Knee-high sandcastle: a low curtain wall with a dark gateway, a square keep with crenels and a red pennant behind it, and a round crenelled tower at each end, in lit and shaded sand. Short.",
  STARFISH: "Orange starfish seen from above: five soft-tipped arms each split into a lit and a shaded half, rows of pale bumps down the arms, a pale disc in the middle. Flush.",
  COOLER: "Cooler box you sit on, low: a red body under a cream lid (two cup holders on top), a grey latch across the seam and a dark recessed grip in the shaded east end. Light passes over it.",
  DRIFTWOOD: "Driftwood log you sit on, low: a bleached trunk with a lit top, shaded underside, grain and a knot, the sawn east end showing rings, a broken root at the west end and two snapped limbs behind. Light passes over it.",
  CAMPFIRE: "Campfire at waist height: a ring of ten squat grey stones round a dark ash bed, two crossed charred logs, a tall orange flame with a yellow heart and sparks, a flat orange glow on the ground. Sight passes over it. Short.",
  FERN: "Fern clump at waist height: a dozen arching fronds rising up and out from a low brown crown and falling over at the tips, the far ones darker and the near ones lit, each a tapering blade of leaflets round a midrib, on a ground shadow. Nobody stands in it; sight passes over it. Short.",
  FALLEN_LOG: "Fallen log you sit on, kept low: a bark-clad trunk lying east to west at knee height, a darker lower third, furrows, a knot, a moss cap and a branch stub, a splintered snapped west end and a sawn east end with growth rings. No shadow.",
  SNOWDRIFT: "Snowdrift seen from above: a smooth wind-swept white mound, round to the north-east with a low tail to the south-west, a blue-grey shaded south-east rim, two carved ridges with a lit crest and a few glints. Flush: you stand in it. No shadow.",
  PICKAXE: "Pickaxe lying flat on the ground, seen from above: a long ash handle from the south-west corner to the north-east, and across its top end, square to it, an iron head with a long curved pick tapering to a point on one side and a short flat chisel blade on the other, the handle tip poking through the eye; rock chips beside it. Flush. No shadow.",
  BONES: "Bleached bones scattered flat on the sand, seen from above: a femur, a shin bone, a ribcage with a spine, a small skull with dark sockets and a few vertebrae, each with one outline and a darker lower edge. Flush. No shadow.",
  SCORPION_NEST: "Scorpion nest seen from above: a low raked-sand burrow mound ringed with a few rocks and a dark hole, with four small chestnut scorpions (pincers, segmented body, curled tail with a black sting) coming out of the hole and crawling round it. Flush. No shadow.",
  POTTERY_SHARDS: "Broken terracotta pottery scattered flat, seen from above: four angular shards and three chips with outlines and a darker half, painted in cream and brown (a band, a zigzag, dots and a rim line). Flush. No shadow.",
  FLOOR_PILLOW: "Round floor pouf you sit on, kept low (knee height): a squat terracotta drum with a lighter quilted top, cream piping, creases and a brass button, a cream band with a teal zigzag round the waist, the east side a shade darker. Flush with the sight line. No shadow.",
  TRASH_BAG: "Black bin bag seen from above: a slumped lumpy charcoal bag with a darker lower-right half, one glossy highlight, creases running from the twisted knot with two loose ears at the north end, and a crushed can beside it. Flush with the floor, no shadow.",
  CARDBOARD_BOX: "Open cardboard box at knee-to-waist height: tan, with a dark inside and a crumpled sheet showing, the back flap leaning up, the left flap drooping out, the front flap folded over with packing tape, a shipping label and print marks, the east side a shade darker. Short: sight passes over it.",
  GRAFFITI: "Graffiti sprayed on the pavement, seen from above: a fat looping magenta spray tag (an abstract cursive scrawl ending in a zigzag) with a cream outline band and an ink edge over a pale overspray haze, a teal swoosh arrow under it, a yellow crown above it and loose spray dots. Flush with the ground, no shadow.",
  // new art (art/STYLE.md, 2026-10-28)
  HORSE: "Saddled dun horse in profile, long-legged with a short arched neck: red saddle cloth, dark saddle and a stirrup at the middle of its back, where a rider sits. Perch: blocks sight, the rider is seen.",
  OAK: "Broad oak: lobed crown, a massive trunk with flared roots and two thick low branches, acorns. Tall.",
  SOFA: "Teal velvet sofa in the same oblique camera as the desk, kept low: seat cushions at knee height (one per tile), a buttoned back and rolled arms no higher than a desk top, short feet. Drawn once along its span; down a column it is the same sofa turned, back on the west, an arm facing the viewer. No shadow.",
  ARMOR: "Suit of plate armour on a wooden plinth, its gauntlet gripping a halberd whose shaft crosses in front of the body: a plain great helm with a visor slit, pauldrons, ridged breastplate, skirt and greaves. Above head height. Tall.",
  BILLIARD_TABLE: "Mahogany billiard table, its green felt top filling both tiles: six pockets, diamond sights, a racked triangle, cue ball and cue, turned legs. Drawn once along its span, in either orientation. Waist height: sight passes over.",
  DESK: "Walnut writing desk: leather blotter, a letter, inkwell and quill on a deep top, two drawer pedestals round a kneehole. Waist height: sight passes over.",
  STOVE: "Cream enamel kitchen range: iron hob with four burners (one lit), backguard, knobs, brass towel rail, oven door with a window. Waist height: sight passes over.",
  WINE_RACK: "Floor-to-ceiling oak wine rack: eight deep cubbies, each bottle lying at an angle with its cork pointing out, green glass and two reds, one slot empty. Tall.",
  BARBER_CHAIR: "Barber chair, kept low: oxblood leather seat and channelled back topped by a padded head-rest on a chrome stem, padded armrests on chrome struts, a hydraulic column on a round base and a ribbed footrest. Someone sits in it. No shadow.",
  BENCH: "Park bench, kept low: three wooden seat slats and two back slats on dark cast-iron ends with scrolled armrests. Someone sits on it. No shadow.",
  JUKEBOX: "Classic arched jukebox, chest height on a person: a tall, slim walnut cabinet with a round arched top, a glowing amber tube up the sides and over the arch, a record behind the window, a selector strip and a chrome grille. Short: sight passes over it.",
  POSTER_COLUMN: "Advertising column: a wide drum pasted with posters between an iron base ring and cornice, under a ribbed green dome with a finial. Well above head height. Tall.",
  WASHER: "Front-loading washing machine, a near cube at waist height: a square white front as tall as it is wide with its top showing, a control strip with a drawer, buttons and a dial, and a chrome porthole with laundry in blue water. Short: sight passes over it.",
  WATER_TOWER: "Rooftop water tower: a wooden stave tank with iron hoops under a conical roof, on a deck held up by four braced steel legs. Well above head height. Tall.",
  BEARSKIN: "Bearskin rug seen from above, flat on the floor: just the dark brown pelt, inked, clawed paws to the corners, the head at the south with ears, eyes and a tan muzzle. Stand on it. No shadow.",
  FAIRY_RING: "Fairy ring: a band of darker grass on the ground ringed by small upright toadstools seen from the front and a little above, red with cream spots and a few tan ones, the middle left clear. Stand in it. No shadow.",
  SKI_RACK: "Low wooden ski rack: four thin skis standing upright in a floor trough against a waist-high rail, clear gaps between them, a binding on each, and a pair of poles leaning on the end. Waist height: sight passes over and through.",
  SNOWMAN: "Two-ball snowman, below head height and no wider than a person: twig arms, red scarf, coal eyes, smile and buttons, carrot nose. Waist height: sight passes over.",
  ICE_PILLAR: "Thick six-sided column of cloudy ice in its own frozen spill: lit top, shaded east facet, icicles along the rim, a cloudy core with bubbles, two loose chunks. Well above head height. Tall.",
  RUINED_WALL: "Standing piece of an old coursed stone wall, its broken top stepping down to the east, moss on the ledges, an ivy runner and fallen blocks. Above head height. Tall.",
  ANCHOR: "Iron admiralty anchor lying on the ground: the stock flat on the floor, the lower fluke resting on the ground and the upper arm curling up to waist height, a chain trailing from the ring. Sight passes over.",
  CHANGING_HUT: "Wooden bathing hut of candy-striped boards: pitched roof with white bargeboards and a porthole in the gable, a coral door with a vent, on a low plinth with a step. Above head height. Tall.",
  LOCKER: "Two-door steel locker in blue-grey enamel, 2 m: louvred vents, brass number plates, latch handles and a red padlock, on a dark plinth. Above head height. Tall.",
  SPIRAL_STAIRS: "Cast-iron spiral staircase painted lighthouse green: a slim column with a brass finial on a round foot plate, ten wedge treads winding up round it just over one full turn, and a brass handrail on iron balusters spiralling with them from a newel post to the top of the tile. Clearly taller than a person. Tall: blocks sight.",
  CAMEL: "Two-humped camel in profile, at the horse's scale: a red seat cushion on an indigo saddle blanket in the dip between the humps, where a rider sits; a long U-curved neck with a shaggy throat, a small head held forward with a droopy split lip, and padded feet show round the rider. Perch: blocks sight, the rider is seen.",
  MARKET_STALL: "Bazaar stall under a red-and-cream striped awning with a scalloped valance, hung with two lanterns and a small rug; a counter draped in indigo with three baskets of spice. Above head height. Tall.",
  WARDROBE: "Mahogany wardrobe, 2 m: a tall cabinet with a projecting crown moulding, two raised-panel doors with brass knobs and a keyhole, a drawer across the foot, on a plinth and bun feet. Well above head height. Tall: blocks light.",
  TRASH_CAN: "Street trash can at waist height: a ribbed galvanised steel can with side handles and dents, its dome lid knocked askew so a green bin bag and a banana peel poke out. Sight passes over.",
  BEEHIVE: "Beehive, knee-high: three stacked hive boxes (white, butter-yellow, white) with hand slots on a stand, a dark entrance slot over a brown landing board, a grey roof lid, and a few bees round the entrance. Sight passes over.",
  SARCOPHAGUS: "Waist-high sandstone sarcophagus: a lid carved in low relief with a mummiform figure, gold mask and blue-and-gold headdress, crossed arms and bands, over a trough carved with an eye and glyphs, on a plinth. Sight passes over.",
  BIRCH: "Silver birch: one slim dark-barked trunk with pale bark patches and black marks (no second stem), white branches forking into a tall, airy yellow-green crown. Above head height. Tall.",
  TRAFFIC_CONE: "Orange traffic cone with two white reflective bands on a square black rubber base, knee height. Sight passes over.",
  CLOCK: "Mahogany longcase clock, 2 m: arched crest with brass finials, a hood with pillars round a cream dial, a glazed trunk door with the brass pendulum, a stepped plinth. Above head height. Tall.",
  HAY_WAGON: "Farm hay wagon in side view: a lumpy golden heap of hay (darker on the east, pale tufts and loose strands) piled well above head height on a wooden flat-bed between two end boards, a big spoked rear wheel and a smaller front wheel with iron tyres, the shaft reaching down to the ground, a pitchfork stuck in the heap. Tall.",
  HOT_POOL: "Hot spring pool seen from above, drawn once across its 1x1, 1x2, 2x1 or 2x2 span: an irregular basin of milky blue-green water in bands (pale shallows, deeper middle) inside a ring of grey volcanic rim stones with snow caps on the north side, wisps of steam curling off the water, a few bubbles and a ripple. Flush: you soak in it. No shadow.",
  TEA_TROLLEY: "Two-tier mahogany tea trolley on brass casters with a push handle: a blue-banded teapot and two cups on the top tray, a layer cake and scones below. Waist height: sight passes over.",
};
/** Optional per-prop scale about the base (kind to factor). Empty: every prop is drawn at its final size, so none needs it; kept as a hook for the board's PropSprite. */
export const FIT = {};
/** Display class of a prop id: "Evidence" (the corpse), "Tall", "Perch", "Short", "Low" or null. Pass the case as `p` so its propClasses win. */
export const propClass = (k, p = null) => {
  if (k === "CORPSE") return "Evidence";
  const cls = propClassOf(p, k);
  return cls ? cls[0] + cls.slice(1).toLowerCase() : null;
};

/**
 * Span-aware sprites: prop ids whose component draws ONE object across a whole multi-tile span.
 * Each takes { cw, ch } (the span in cells) and draws inside a (64·cw) × (64·ch) box whose origin is the
 * span's top-left cell, bottom-centre anchored like every sprite (base centred on x = 32·cw, near y = 64·ch − 6). They
 * also get `cells`, the object's tiles as [dr, dc] offsets from that cell: CARPET_RUNNER draws its L paths from it.
 * To make a new multi-tile prop span-aware, register its component here (SOFA: SofaSpan is the new-art example).
 */
export const SPAN_SPRITES = {
  RUG: RugN,
  SOFA: SofaSpan,
  BILLIARD_TABLE: BilliardSpan,
  FOOTPRINTS: FootprintsSpan,
  BED: BedSpan,
  CARPET_RUNNER: CarpetRunner,
  BOAT: BoatSpan,
  OASIS_POOL: OasisPoolSpan,
  HOT_POOL: HotPoolSpan,
};

/**
 * One prop, drawn in its (64·cw) × (64·ch) box. A span-aware kind (SPAN_SPRITES) gets the span size; any other kind
 * draws its single-tile sprite ONCE, centred along the span and bottom-centre anchored (scaled by the span's
 * short side, so a 2 × 2 pool fills its box while a 1 × 2 sofa keeps its single-tile size).
 */
export function PropSprite({ kind, cw = 1, ch = 1, len, horizontal, cells, victim, dummy, master, second }) {
  const Span = SPAN_SPRITES[kind];
  // `cells`: the object's tiles as offsets from its top-left cell (an L-shaped carpet runner is not its whole box)
  if (Span) return <Span cw={cw} ch={ch} len={len} horizontal={horizontal} cells={cells} />;
  const S = SPRITES[kind];
  if (!S) return null;
  const f = FIT[kind];
  // the CORPSE sprite draws the case's target: `victim` (their name), `dummy` (the tutorial), `master` (Master U. M. Bra) and `second` (N. O. Ir) pass through to it
  const own = kind === "CORPSE" ? <S victim={victim || undefined} dummy={!!dummy} master={!!master} second={!!second} /> : <S />;
  const sprite = f ? <g transform={`translate(32 58) scale(${f}) translate(-32 -58)`}>{own}</g> : own;
  if (cw === 1 && ch === 1) return sprite;
  const k = Math.max(1, Math.min(cw, ch)); // the 64k × 64k sprite box sits bottom-centre in the span box
  return <g transform={`translate(${32 * cw - 32 * k} ${64 * ch - 64 * k})${k !== 1 ? ` scale(${k})` : ""}`}>{sprite}</g>;
}

/** Tiny corner chip: shows which prop a token is standing on, sitting at or riding (LOW and PERCH props).
 *  `cls` is the prop's class in this case (propClassOf); without it the default table is used. */
export function PropChip({ kind, x, y, cls }) {
  if (!classIsOccupiable(cls === undefined ? propClassOf(null, kind) : cls)) return null;
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      <circle r="8.5" fill={INK} stroke={CREAM} strokeOpacity=".7" strokeWidth="1" />
      <g transform="translate(-6 -6) scale(.19)"><PropSprite kind={kind} len={1} /></g>
    </g>
  );
}

/* ---------------------------------------------------------------------- */
/*  Architecture: walls, open doorways (clean gaps), windows                */
/* ---------------------------------------------------------------------- */
/**
 * All wall runs in two passes: every dark underlay first, then every cream core, so joints are clean.
 * `posts` are the squared wall-end caps at both corners of every doorway: the gap in between is simply
 * the missing wall segment. No leaf, no arc, no brass.
 */
export function WallLayer({ segs, posts, core = WALL, k = 1 }) { // k: the player's wall thickness (settings), 1 = as drawn
  return (
    <g strokeLinecap="square" fill="none" pointerEvents="none">
      {segs.map((s) => <line key={`u${s.k}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={INK} strokeWidth={(s.thick ? 9 : 7.5) * k} />)}
      {posts.map((p) => <rect key={`pu${p.k}`} x={p.x - 5.5 * k} y={p.y - 5.5 * k} width={11 * k} height={11 * k} fill={INK} stroke="none" />)}
      {segs.map((s) => <line key={`c${s.k}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={core} strokeWidth={(s.thick ? 5.6 : 4.2) * k} />)}
      {posts.map((p) => <rect key={`pc${p.k}`} x={p.x - 3.4 * k} y={p.y - 3.4 * k} width={6.8 * k} height={6.8 * k} fill={core} stroke="none" />)}
    </g>
  );
}

/** Window set into an exterior wall. (cx,cy) = midpoint of the edge. */
export function WindowPane({ cx, cy, vertical }) {
  const len = 38, th = 8.5;
  const w = vertical ? th : len, h = vertical ? len : th;
  return (
    <g pointerEvents="none" transform={`translate(${cx - w / 2} ${cy - h / 2})`}>
      <rect width={w} height={h} rx="1.5" fill={GLASS} stroke={INK} strokeWidth="1.8" />
      <rect x="1.4" y="1.4" width={w - 2.8} height={h - 2.8} rx=".8" fill="#d8eef9" fillOpacity=".55" />
      {vertical
        ? <path d={`M0 ${h / 2}H${w}`} stroke={INK} strokeWidth="1.2" />
        : <path d={`M${w / 2} 0V${h}`} stroke={INK} strokeWidth="1.2" />}
    </g>
  );
}

/** Edge geometry helper: where a (row, col, side) window or a door edge sits in board pixels. */
export const X0 = (c) => LAB + c * CELL;
export const Y0 = (r) => LAB + r * CELL;
export function windowAt([r, c, s]) {
  if (s === "N") return { cx: X0(c) + CELL / 2, cy: Y0(r), vertical: false };
  if (s === "S") return { cx: X0(c) + CELL / 2, cy: Y0(r) + CELL, vertical: false };
  if (s === "W") return { cx: X0(c), cy: Y0(r) + CELL / 2, vertical: true };
  return { cx: X0(c) + CELL, cy: Y0(r) + CELL / 2, vertical: true };
}


/* ---------------------------------------------------------------------- */
/*  Cozy-noir portraits · DiceBear "avataaars"                              */
/*                                                                          */
/*  Parts, geometry and part names come from the open-source DiceBear        */
/*  avataaars style (@dicebear/avataaars v9.4, "Avataaars" by Pablo Stanley, */
/*  free for personal and commercial use; DiceBear's port is MIT). Its       */
/*  280×280 layers were extracted once and re-skinned for the game:          */
/*    · every main fill gets a #1A1A22 outline (the original has none)       */
/*    · the pastel skin / hair / hat / clothes colours are replaced by our   */
/*      noir palette; whites become warm cream; gradients were removed       */
/*    · lashes (women) and neckwear (necktie, bowtie, scarf) were added in   */
/*      the same flat style                                                  */
/*  Everything is inline SVG markup, stacked in avataaars' own order:        */
/*    base → clothing → neckwear → mouth → nose → eyes (+lashes) → brows →   */
/*    top (hair, or hat) → facial hair → accessories                         */
/*                                                                          */
/*  A "look" is the full recipe for one face. CLUE traits come from the      */
/*  puzzle JSON and are never rerolled when a statement talks about them:    */
/*    gender, hairColor, hairLength, glasses, hat, tie  (+ facialHair, skin) */
/*  Everything else is cosmetic:                                             */
/*    hairStyle, eyes, brows, mouth, clothing, accent, hatC, frameC, back    */
/*                                                                          */
/*  Gender-specific parts (everything else is neutral):                      */
/*    male   · unibrowNatural brows, all facial hair, necktie, bowtie,       */
/*             hair: dreads01, dreads02, fro, shortCurly, shortFlat,         */
/*             shortRound, shortWaved, sides, theCaesar, theCaesarAndSidePart;*/
/*             hats: turban, winterHat1                                      */
/*    female · kurt glasses, scoop-neck shirt, hair: bigHair, bob, bun, dreads,*/
/*             curly, curvy, frida, froBand, longButNotTooLong, miaWallace,  */
/*             straight01, straight02, straightAndStrand; hat: hijab         */
/*  Women get eyelashes on every eye shape except hearts; men never do.      */
/*                                                                          */
/*  Neckwear rules: necktie only on blazer + sweater; bowtie on blazer +     */
/*  shirt, blazer + sweater, collar + sweater or crew neck; scarf on crew    */
/*  neck, V-neck or scoop neck. Women's necktie / bowtie become a scarf.     */
/*                                                                          */
/*  Hats: only the wide-brim hat leaves the hair visible. The flap cap, the  */
/*  beanies, the aviator cap, the turban and the hijab cover all hair, so    */
/*  hair colour and length cannot be seen under them and the casting only    */
/*  uses them when no clue talks about hair. Under the wide-brim hat the     */
/*  hair must be neither wider than the hat nor rise above its crown (see    */
/*  STRICT_HAT_HEIGHT and HAT_BLOCKS).                                       */
/*                                                                          */
/*  RETIRED parts stay in the code but are never rolled or offered:          */
/*  hair frida + shavedSides, eyes hearts / xDizzy / cry, mouth vomit, eyepatch. */
/* ---------------------------------------------------------------------- */
export const AV = {"base":"<path d=\"M132 36a56 56 0 0 0-56 56v6.17A12 12 0 0 0 66 110v14a12 12 0 0 0 10.3 11.88 56.04 56.04 0 0 0 31.7 44.73v18.4h-4a72 72 0 0 0-72 72v9h200v-9a72 72 0 0 0-72-72h-4v-18.39a56.04 56.04 0 0 0 31.7-44.73A12 12 0 0 0 198 124v-14a12 12 0 0 0-10-11.83V92a56 56 0 0 0-56-56Z\" fill=\"{{skin}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M108 180.61v8a55.79 55.79 0 0 0 24 5.39c8.59 0 16.73-1.93 24-5.39v-8a55.79 55.79 0 0 1-24 5.39 55.79 55.79 0 0 1-24-5.39Z\" fill=\"#000\" fill-opacity=\".1\"/>","nose":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M16 8c0 4.42 5.37 8 12 8s12-3.58 12-8\" fill=\"#000\" fill-opacity=\".16\"/>","clothing":{"blazerAndShirt":"<path d=\"M132.5 51.83c18.5 0 33.5-9.62 33.5-21.48 0-.36-.01-.7-.04-1.06A72 72 0 0 1 232 101.04V110H32v-8.95a72 72 0 0 1 67.05-71.83c-.03.37-.05.75-.05 1.13 0 11.86 15 21.48 33.5 21.48Z\" fill=\"#e4dcc8\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M132.5 58.76c21.89 0 39.63-12.05 39.63-26.91 0-.6-.02-1.2-.08-1.8-2-.33-4.03-.59-6.1-.76.04.35.05.7.05 1.06 0 11.86-15 21.48-33.5 21.48S99 42.2 99 30.35c0-.38.02-.76.05-1.13-2.06.14-4.08.36-6.08.67-.07.65-.1 1.3-.1 1.96 0 14.86 17.74 26.91 39.63 26.91Z\" fill=\"#000\" fill-opacity=\".16\"/><path d=\"M100.78 29.12 101 28c-2.96.05-6 1-6 1l-.42.66A72.01 72.01 0 0 0 32 101.06V110h74s-10.7-51.56-5.24-80.8l.02-.08ZM158 110s11-53 5-82c2.96.05 6 1 6 1l.42.66a72.01 72.01 0 0 1 62.58 71.4V110h-74Z\" fill=\"{{clothes}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M101 28c-6 29 5 82 5 82H90L76 74l6-9-6-6 19-30s3.04-.95 6-1ZM163 28c6 29-5 82-5 82h16l14-36-6-9 6-6-19-30s-3.04-.95-6-1Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"#000\" fill-opacity=\".15\"/><path d=\"m183.42 85.77.87-2.24 6.27-4.7a4 4 0 0 1 4.85.05l6.6 5.12-18.59 1.77Z\" fill=\"#e4dcc8\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","blazerAndSweater":"<path d=\"M132 57.05c14.91 0 27-11.2 27-25 0-1.01-.06-2.01-.2-3h1.2a72 72 0 0 1 72 72V110H32v-8.95a72 72 0 0 1 72-72h1.2c-.14.99-.2 1.99-.2 3 0 13.8 12.09 25 27 25Z\" fill=\"#e4dcc8\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M100.78 29.12 101 28c-2.96.05-6 1-6 1l-.42.66A72.01 72.01 0 0 0 32 101.06V110h74s-10.7-51.56-5.24-80.8l.02-.08ZM158 110s11-53 5-82c2.96.05 6 1 6 1l.42.66a72.01 72.01 0 0 1 62.58 71.4V110h-74Z\" fill=\"{{clothes}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M101 28c-6 29 5 82 5 82H90L76 74l6-9-6-6 19-30s3.04-.95 6-1ZM163 28c6 29-5 82-5 82h16l14-36-6-9 6-6-19-30s-3.04-.95-6-1Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"#000\" fill-opacity=\".15\"/><path d=\"M108 21.54c-6.77 4.6-11 11.12-11 18.35 0 7.4 4.43 14.05 11.48 18.67l5.94-4.68 4.58.33-1-3.15.08-.06c-6.1-3.15-10.08-8.3-10.08-14.12V21.54ZM156 36.88c0 5.82-3.98 10.97-10.08 14.12l.08.06-1 3.15 4.58-.33 5.94 4.68C162.57 53.94 167 47.29 167 39.89c0-7.23-4.23-13.75-11-18.35v15.34Z\" fill=\"#f1ead8\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"m183.42 85.77.87-2.24 6.27-4.7a4 4 0 0 1 4.85.05l6.6 5.12-18.59 1.77Z\" fill=\"#e4dcc8\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","collarAndSweater":"<path d=\"M100.37 29.14a27.6 27.6 0 0 1 7.63-7.57v15.3c0 5.83 3.98 10.98 10.08 14.13l-.08.06.9 2.86c3.89 2 8.35 3.13 13.1 3.13s9.21-1.13 13.1-3.13l.9-2.86-.08-.06c6.1-3.15 10.08-8.3 10.08-14.12v-14.6a27.1 27.1 0 0 1 6.6 6.82 72 72 0 0 1 69.4 71.95V110H32v-8.95a72 72 0 0 1 68.37-71.9Z\" fill=\"{{clothes}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M108 21.57c-6.77 4.6-11 11.17-11 18.46 0 7.4 4.36 14.05 11.3 18.66l6.12-4.81 4.58.33-1-3.15.08-.06c-6.1-3.15-10.08-8.3-10.08-14.12v-15.3ZM156 36.88c0 5.82-3.98 10.97-10.08 14.12l.08.06-1 3.15 4.58-.33 5.65 4.45c6.63-4.6 10.77-11.1 10.77-18.3 0-6.92-3.82-13.2-10-17.75v14.6Z\" fill=\"#fff\" fill-opacity=\".75\"/>","hoodie":"<path d=\"M108 14.7c-15.52 3.68-27.1 10.83-30.77 19.44A72.02 72.02 0 0 0 32 101v9h200v-9a72.02 72.02 0 0 0-45.23-66.86C183.1 25.53 171.52 18.38 156 14.7V32a24 24 0 1 1-48 0V14.7Z\" fill=\"{{clothes}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M102 63.34a67.1 67.1 0 0 1-7-2.82V110h7V63.34ZM162 63.34a67.04 67.04 0 0 0 7-2.82V98.5a3.5 3.5 0 1 1-7 0V63.34Z\" fill=\"#f1ead8\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M187.62 34.49a71.79 71.79 0 0 1 10.83 5.63C197.11 55.62 167.87 68 132 68c30.93 0 56-13.43 56-30 0-1.19-.13-2.36-.38-3.51ZM76.38 34.49a16.48 16.48 0 0 0-.38 3.5c0 16.58 25.07 30 56 30-35.87 0-65.1-12.38-66.45-27.88a71.79 71.79 0 0 1 10.83-5.63Z\" fill=\"#000\" fill-opacity=\".16\"/>","overall":"<path d=\"M196 38.63V110H68V38.63a71.52 71.52 0 0 1 26-8.94v44.3h76V29.69a71.52 71.52 0 0 1 26 8.94Z\" fill=\"{{clothes}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M86 83a5 5 0 1 1-10 0 5 5 0 0 1 10 0ZM188 83a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z\" fill=\"#f1ead8\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","shirtCrewNeck":"<path d=\"M132.5 51.83c18.5 0 33.5-9.62 33.5-21.48 0-.36-.01-.7-.04-1.06A72 72 0 0 1 232 101.04V110H32v-8.95a72 72 0 0 1 67.05-71.83c-.03.37-.05.75-.05 1.13 0 11.86 15 21.48 33.5 21.48Z\" fill=\"{{clothes}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M132.5 58.76c21.89 0 39.63-12.05 39.63-26.91 0-.6-.02-1.2-.08-1.8-2-.33-4.03-.59-6.1-.76.04.35.05.7.05 1.06 0 11.86-15 21.48-33.5 21.48S99 42.2 99 30.35c0-.38.02-.76.05-1.13-2.06.14-4.08.36-6.08.67-.07.65-.1 1.3-.1 1.96 0 14.86 17.74 26.91 39.63 26.91Z\" fill=\"#000\" fill-opacity=\".08\"/>","shirtScoopNeck":"<path d=\"M132.5 65.83c27.34 0 49.5-13.2 49.5-29.48 0-1.37-.16-2.7-.46-4.02A72.03 72.03 0 0 1 232 101.05V110H32v-8.95A72.03 72.03 0 0 1 83.53 32a18 18 0 0 0-.53 4.35c0 16.28 22.16 29.48 49.5 29.48Z\" fill=\"{{clothes}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","shirtVNeck":"<path d=\"M92.68 29.94A72.02 72.02 0 0 0 32 101.05V110h200v-8.95a72.02 72.02 0 0 0-60.68-71.11 23.87 23.87 0 0 1-7.56 13.6l-29.08 26.23a4 4 0 0 1-5.36 0l-29.08-26.23a23.87 23.87 0 0 1-7.56-13.6Z\" fill=\"{{clothes}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>"},"eyes":{"closed":"<path d=\"M16.16 27.55c1.85 3.8 6 6.45 10.84 6.45 4.81 0 8.96-2.63 10.82-6.4.55-1.13-.24-2.05-1.03-1.37a15.05 15.05 0 0 1-9.8 3.43c-3.73 0-7.12-1.24-9.55-3.23-.9-.73-1.82.01-1.28 1.12ZM74.16 27.55c1.85 3.8 6 6.45 10.84 6.45 4.81 0 8.96-2.63 10.82-6.4.55-1.13-.24-2.05-1.03-1.37a15.05 15.05 0 0 1-9.8 3.43c-3.74 0-7.13-1.24-9.56-3.23-.9-.73-1.82.01-1.28 1.12Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"#000\" fill-opacity=\".6\"/>","cry":"<path d=\"M25 27s-6 7.27-6 11.27a6 6 0 1 0 12 0c0-4-6-11.27-6-11.27Z\" fill=\"#9fd4ee\"/><path d=\"M36 22a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM88 22a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z\" fill=\"#000\" fill-opacity=\".6\"/>","default":"<path d=\"M36 22a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM88 22a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z\" fill=\"#000\" fill-opacity=\".6\"/>","eyeRoll":"<path d=\"M44 22a14 14 0 1 1-28 0 14 14 0 0 1 28 0ZM96 22a14 14 0 1 1-28 0 14 14 0 0 1 28 0Z\" fill=\"#fbf7ee\" stroke=\"{{ink}}\" stroke-width=\"{{sw2}}\" stroke-linejoin=\"round\"/><path d=\"M36 14a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM88 14a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z\" fill=\"#000\" fill-opacity=\".7\"/>","happy":"<path d=\"M16.16 22.45c1.85-3.8 6-6.45 10.84-6.45 4.81 0 8.96 2.63 10.82 6.4.55 1.13-.24 2.05-1.03 1.37a15.05 15.05 0 0 0-9.8-3.43c-3.73 0-7.12 1.24-9.55 3.23-.9.73-1.82-.01-1.28-1.12ZM74.16 22.45c1.85-3.8 6-6.45 10.84-6.45 4.81 0 8.96 2.63 10.82 6.4.55 1.13-.24 2.05-1.03 1.37a15.05 15.05 0 0 0-9.8-3.43c-3.74 0-7.13 1.24-9.56 3.23-.9.73-1.82-.01-1.28-1.12Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"#000\" fill-opacity=\".6\"/>","hearts":"<path d=\"M35.96 10c-2.55 0-5.08 1.98-6.46 3.82-1.39-1.84-3.9-3.82-6.46-3.82-5.49 0-9.04 3.33-9.04 7.64 0 5.73 4.41 9.13 9.04 12.74 1.66 1.23 4.78 4.4 5.17 5.1.38.68 2.1.7 2.58 0 .48-.73 3.51-3.87 5.17-5.1 4.63-3.6 9.04-7 9.04-12.74 0-4.3-3.55-7.64-9.04-7.64ZM88.96 10c-2.55 0-5.08 1.98-6.46 3.82-1.39-1.84-3.9-3.82-6.46-3.82-5.49 0-9.04 3.33-9.04 7.64 0 5.73 4.41 9.13 9.04 12.74 1.65 1.23 4.78 4.4 5.17 5.1.38.68 2.1.7 2.58 0 .48-.73 3.51-3.87 5.17-5.1 4.63-3.6 9.04-7 9.04-12.74 0-4.3-3.55-7.64-9.04-7.64Z\" fill=\"#C83E3B\" fill-opacity=\".8\"/>","side":"<path d=\"M27 16c-4.84 0-9 2.65-10.84 6.45-.54 1.1.39 1.85 1.28 1.12a15.13 15.13 0 0 1 9.8-3.22 6 6 0 1 0 10.7 2.8 2 2 0 0 0-.12-.74l-.15-.38a6 6 0 0 0-1.64-2.48C33.9 17.32 30.5 16 27 16ZM85 16c-4.84 0-9 2.65-10.84 6.45-.54 1.1.39 1.85 1.28 1.12a15.13 15.13 0 0 1 9.8-3.22 6 6 0 1 0 10.7 2.8 2 2 0 0 0-.12-.74l-.15-.38a6 6 0 0 0-1.64-2.48C91.9 17.32 88.5 16 85 16Z\" fill=\"#000\" fill-opacity=\".6\"/>","squint":"<path d=\"M44 20.73c0 4.26-6.27 7.72-14 7.72S16 25 16 20.73C16 16.46 22.27 13 30 13s14 3.46 14 7.73ZM96 20.73c0 4.26-6.27 7.72-14 7.72S68 25 68 20.73C68 16.46 74.27 13 82 13s14 3.46 14 7.73Z\" fill=\"#fbf7ee\" stroke=\"{{ink}}\" stroke-width=\"{{sw2}}\" stroke-linejoin=\"round\"/><path d=\"M32.82 28.3a25.15 25.15 0 0 1-5.64 0 6 6 0 1 1 5.64 0ZM84.82 28.3a25.15 25.15 0 0 1-5.64 0 6 6 0 1 1 5.64 0Z\" fill=\"#000\" fill-opacity=\".7\"/>","surprised":"<path d=\"M44 22a14 14 0 1 1-28 0 14 14 0 0 1 28 0ZM96 22a14 14 0 1 1-28 0 14 14 0 0 1 28 0Z\" fill=\"#fbf7ee\" stroke=\"{{ink}}\" stroke-width=\"{{sw2}}\" stroke-linejoin=\"round\"/><path d=\"M36 22a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM88 22a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z\" fill=\"#000\" fill-opacity=\".7\"/>","winkWacky":"<circle cx=\"82\" cy=\"22\" r=\"12\" fill=\"#fbf7ee\" stroke=\"{{ink}}\" stroke-width=\"{{sw2}}\" stroke-linejoin=\"round\"/><circle cx=\"82\" cy=\"22\" r=\"6\" fill=\"#000\" fill-opacity=\".7\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M16.16 25.45c1.85-3.8 6-6.45 10.84-6.45 4.81 0 8.96 2.63 10.82 6.4.55 1.13-.24 2.05-1.03 1.37a15.05 15.05 0 0 0-9.8-3.43c-3.73 0-7.12 1.24-9.55 3.23-.9.73-1.82-.01-1.28-1.12Z\" fill=\"#000\" fill-opacity=\".6\"/>","wink":"<g fill=\"#000\" fill-opacity=\".6\"><path d=\"M36 22a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M70.6 24.96c1.59-3.92 5.55-6.86 10.37-7.2 4.8-.33 9.12 2 11.24 5.64.63 1.09-.1 2.06-.93 1.43-2.6-1.93-6.15-3-10-2.73A15.13 15.13 0 0 0 71.95 26c-.84.78-1.81.1-1.35-1.04Z\"/></g>","xDizzy":"<path d=\"M34.5 30.7 29 25.2l-5.5 5.5c-.4.4-1.1.4-1.6 0l-1.6-1.6c-.4-.4-.4-1.1 0-1.6l5.5-5.5-5.5-5.5c-.4-.5-.4-1.2 0-1.6l1.6-1.6c.4-.4 1.1-.4 1.6 0l5.5 5.5 5.5-5.5c.4-.4 1.1-.4 1.6 0l1.6 1.6c.4.4.4 1.1 0 1.6L32.2 22l5.5 5.5c.4.4.4 1.1 0 1.6l-1.6 1.6c-.4.4-1.1.4-1.6 0ZM88.5 30.7 83 25.2l-5.5 5.5c-.4.4-1.1.4-1.6 0l-1.6-1.6c-.4-.4-.4-1.1 0-1.6l5.5-5.5-5.5-5.5c-.4-.5-.4-1.2 0-1.6l1.6-1.6c.4-.4 1.1-.4 1.6 0l5.5 5.5 5.5-5.5c.4-.4 1.1-.4 1.6 0l1.6 1.6c.4.4.4 1.1 0 1.6L86.2 22l5.5 5.5c.4.4.4 1.1 0 1.6l-1.6 1.6c-.4.4-1.1.4-1.6 0Z\" fill=\"#000\" fill-opacity=\".6\"/>"},"eyebrows":{"angryNatural":"<path d=\"M44.1 17.12ZM19.27 5.01a7.16 7.16 0 0 0-6.42 2.43c-.6.73-1.56 2.48-1.51 3.42.02.35.22.37 1.12.59 1.65.39 4.5-1.12 6.36-.98 2.58.2 5.04 1.4 7.28 2.68 3.84 2.2 8.35 6.84 13.1 6.6.35-.02 5.41-1.74 4.4-2.72-.31-.49-3.03-1.13-3.5-1.36-2.17-1.09-4.37-2.45-6.44-3.72C29.14 9.18 24.72 5.6 19.28 5ZM68.03 17.12ZM92.91 5.01c2.36-.27 4.85.5 6.42 2.43.6.73 1.56 2.48 1.51 3.42-.02.35-.22.37-1.12.59-1.65.39-4.5-1.12-6.36-.98-2.58.2-5.04 1.4-7.28 2.68-3.84 2.2-8.35 6.84-13.1 6.6-.35-.02-5.41-1.74-4.4-2.72.31-.49 3.03-1.13 3.5-1.36 2.17-1.09 4.36-2.45 6.44-3.72C83.05 9.18 87.46 5.6 92.91 5Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"#000\" fill-opacity=\".6\"/>","defaultNatural":"<path d=\"M26.55 6.15c-5.8.27-15.2 4.49-14.96 10.34.01.18.3.27.43.12 2.76-2.96 22.32-5.95 29.2-4.36.64.14 1.12-.48.72-.93-3.43-3.85-10.2-5.43-15.4-5.18ZM86.45 6.15c5.8.27 15.2 4.49 14.96 10.34-.01.18-.3.27-.43.12-2.76-2.96-22.32-5.95-29.2-4.36-.64.14-1.12-.48-.72-.93 3.43-3.85 10.2-5.43 15.4-5.18Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"#000\" fill-opacity=\".6\"/>","flatNatural":"<path d=\"M38.66 11.1c-5 .35-9.92.08-14.92-.13-3.83-.16-7.72-.68-11.37 1.01-.7.32-4.53 2.28-4.44 3.35.07.85 3.93 2.2 4.63 2.44 3.67 1.29 7.18.9 10.95.66 4.64-.27 9.25-.07 13.87-.2 3.12-.1 7.92-.63 9.46-4.4.46-1.14.1-3.42-.36-4.66-.19-.5-.72-.69-1.13-.4a15.04 15.04 0 0 1-6.68 2.32ZM73.34 11.1c5 .35 9.92.08 14.92-.13 3.83-.16 7.72-.68 11.37 1.01.7.32 4.53 2.28 4.44 3.35-.07.85-3.93 2.2-4.63 2.44-3.67 1.29-7.18.9-10.95.66-4.63-.27-9.24-.07-13.86-.2-3.12-.1-7.92-.63-9.46-4.4-.46-1.14-.1-3.42.36-4.66.18-.5.72-.69 1.13-.4a15.04 15.04 0 0 0 6.68 2.32Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"#000\" fill-opacity=\".6\"/>","frownNatural":"<path d=\"M36.37 6.88c-1.97 2.9-5.55 4.64-8.74 5.68-3.94 1.29-18.55 3.38-15.11 11.35.05.12.22.12.27 0 1.15-2.65 17.47-5.12 18.97-5.7 4.45-1.71 8.4-5.5 9.17-10.55.35-2.31-.64-6.05-1.55-7.55-.11-.18-.37-.13-.43.07-.36 1.33-1.41 4.97-2.58 6.7ZM75.63 6.88c1.97 2.9 5.55 4.64 8.74 5.68 3.94 1.29 18.55 3.38 15.11 11.35a.15.15 0 0 1-.27 0c-1.15-2.65-17.47-5.12-18.97-5.7-4.45-1.71-8.4-5.5-9.17-10.55-.35-2.31.64-6.05 1.55-7.55.11-.18.37-.13.43.07.36 1.33 1.41 4.97 2.58 6.7Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"#000\" fill-opacity=\".6\"/>","raisedExcitedNatural":"<path d=\"m22.77 1.58.9-.4C28.93-.91 36.88-.03 41.73 2.3c.57.27.18 1.15-.4 1.1-14.92-1.14-24.96 8.15-28.37 14.45-.1.18-.41.2-.49.03-2.3-5.32 4.45-13.98 10.3-16.3ZM89.23 1.58l-.9-.4C83.07-.91 75.12-.03 70.27 2.3c-.57.27-.18 1.15.4 1.1 14.92-1.14 24.96 8.15 28.37 14.45.1.18.41.2.49.03 2.3-5.32-4.45-13.98-10.3-16.3Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"#000\" fill-opacity=\".6\"/>","sadConcernedNatural":"<path d=\"m31.23 20.42-.9.4c-5.25 2.09-13.2 1.21-18.05-1.12-.57-.27-.18-1.15.4-1.1 14.92 1.14 24.96-8.15 28.37-14.45.1-.18.41-.2.49-.03 2.3 5.32-4.45 13.98-10.3 16.3ZM80.77 20.42l.9.4c5.25 2.09 13.2 1.21 18.05-1.12.57-.27.18-1.15-.4-1.1-14.92 1.14-24.96-8.15-28.37-14.45-.1-.18-.41-.2-.49-.03-2.3 5.32 4.45 13.98 10.3 16.3Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"#000\" fill-opacity=\".6\"/>","unibrowNatural":"<g fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"#000\" fill-opacity=\".6\"><path d=\"M57 12.82ZM96.12 7.6c1.46.56 9.19 6.43 7.86 9.16a.8.8 0 0 1-1.29.22 10.63 10.63 0 0 0-1.7-1.19c-5.1-2.84-11.3-1.93-16.73-.91-6.12 1.14-12.11 3.48-18.39 2.67-2.04-.26-6.08-1.22-7.63-2.96-.47-.53-.06-1.38.64-1.43 1.44-.11 2.86-.86 4.33-1.28 3.65-1.03 7.4-1.56 11.11-2.29 6.62-1.3 15.17-4.53 21.8-2Z\"/><path d=\"M58.76 12.76c-1.17.04-2.8 3.56-.56 3.68 2.23.11 1.73-3.72.56-3.68ZM55 12.8c0-.01 0-.01 0 0ZM15.88 7.56c-1.46.56-9.19 6.43-7.86 9.16.24.5.89.6 1.29.22.55-.52 1.58-1.11 1.71-1.18 5.1-2.84 11.3-1.93 16.73-.91 6.12 1.14 12.11 3.48 18.39 2.67 2.04-.26 6.08-1.22 7.63-2.96.47-.53.06-1.38-.64-1.43-1.44-.11-2.86-.86-4.33-1.28-3.65-1.03-7.4-1.56-11.11-2.29-6.62-1.3-15.17-4.53-21.8-2Z\"/><path d=\"M54.97 11.79c1.17.04 2.77 4.5.53 4.67-2.24.18-1.7-4.71-.53-4.67Z\"/></g>","upDownNatural":"<path d=\"m22.77 1.58.9-.4C28.93-.91 36.88-.03 41.73 2.3c.57.27.18 1.15-.4 1.1-14.92-1.14-24.96 8.15-28.37 14.45-.1.18-.41.2-.49.03-2.3-5.32 4.45-13.98 10.3-16.3ZM87 12.07c5.75.77 14.74 5.8 13.99 11.6-.03.2-.31.26-.44.1-2.49-3.2-21.71-7.87-28.71-6.9-.64.1-1.07-.57-.63-.98 3.75-3.54 10.62-4.52 15.78-3.82Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"#000\" fill-opacity=\".6\"/>","angry":"<path d=\"M15.61 15.18c4.24-5.76 6.88-5.48 13.31-.62l.67.5C34.41 18.73 36.7 20 40 20a2 2 0 1 0 0-4c-2.07 0-3.9-1.02-7.99-4.12l-.68-.52C27.57 8.53 25.37 7.3 22.63 7c-3.68-.4-7.05 1.48-10.24 5.83a2 2 0 1 0 3.22 2.36ZM96.39 15.18c-4.24-5.76-6.88-5.48-13.31-.62l-.67.5C77.58 18.73 75.29 20 72 20a2 2 0 1 1 0-4c2.07 0 3.9-1.02 7.99-4.12l.68-.52c3.76-2.83 5.96-4.07 8.7-4.37 3.68-.4 7.05 1.48 10.24 5.83a2 2 0 1 1-3.22 2.36Z\" fill=\"#000\" fill-opacity=\".6\"/>","default":"<path d=\"M15.63 17.16c3.92-5.51 14.65-8.6 23.9-6.33a2 2 0 1 0 .95-3.88c-10.74-2.64-23.17.94-28.11 7.9a2 2 0 0 0 3.26 2.3ZM96.37 17.16c-3.91-5.51-14.65-8.6-23.9-6.33a2 2 0 1 1-.95-3.88c10.74-2.64 23.17.94 28.11 7.9a2 2 0 0 1-3.26 2.3Z\" fill=\"#000\" fill-opacity=\".6\"/>","raisedExcited":"<path d=\"M15.98 17.13C17.48 7.6 30.06 1.1 39.16 5.3a2 2 0 1 0 1.68-3.63c-11.5-5.3-26.9 2.66-28.82 14.84a2 2 0 0 0 3.96.63ZM96.02 17.13C94.52 7.6 81.94 1.1 72.84 5.3a2 2 0 1 1-1.68-3.63c11.5-5.3 26.9 2.66 28.82 14.84a2 2 0 0 1-3.96.63Z\" fill=\"#000\" fill-opacity=\".6\"/>","sadConcerned":"<path d=\"M38.03 5.6c-1.48 8.38-14.1 14.17-23.24 10.42a2.04 2.04 0 0 0-2.64 1c-.43.97.04 2.1 1.05 2.5 11.45 4.7 26.84-2.37 28.76-13.3a1.92 1.92 0 0 0-1.64-2.2 2 2 0 0 0-2.3 1.57ZM73.97 5.6c1.48 8.38 14.1 14.17 23.24 10.42 1.02-.41 2.2.03 2.63 1 .43.97-.04 2.1-1.05 2.5-11.44 4.7-26.84-2.37-28.76-13.3a1.92 1.92 0 0 1 1.64-2.2 2 2 0 0 1 2.3 1.57Z\" fill=\"#000\" fill-opacity=\".6\"/>","upDown":"<path d=\"M15.6 14.16c4.49-6.32 14-9.5 23.75-6.36a2 2 0 1 0 1.23-3.81c-11.41-3.68-22.74.1-28.25 7.85a2 2 0 1 0 3.26 2.32ZM96.38 21.16c-3.92-5.51-14.65-8.6-23.9-6.33a2 2 0 0 1-.95-3.88c10.74-2.64 23.17.94 28.1 7.9a2 2 0 1 1-3.25 2.3Z\" fill=\"#000\" fill-opacity=\".6\"/>"},"mouth":{"concerned":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M35.12 29.87a19 19 0 0 1 37.77.09c.08.77-.77 2.04-1.85 2.04H37.1C36 32 35 30.82 35.12 29.87Z\" fill=\"#000\" fill-opacity=\".7\"/><path d=\"M69.59 32H38.4a11 11 0 0 1 15.6-6.8A11 11 0 0 1 69.59 32Z\" fill=\"#c8566a\"/><path d=\"M66.57 17.75A5 5 0 0 1 65 18H44c-.8 0-1.57-.2-2.24-.53A18.92 18.92 0 0 1 54 13c4.82 0 9.22 1.8 12.57 4.75Z\" fill=\"#fbf7ee\"/>","default":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M40 15a14 14 0 1 0 28 0\" fill=\"#000\" fill-opacity=\".7\"/>","disbelief":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M40 29a14 14 0 1 1 28 0\" fill=\"#000\" fill-opacity=\".7\"/>","eating":"<path d=\"M28 26.24c1.36.5 2.84.76 4.4.76 5.31 0 9.81-3.15 11.29-7.49 2.47 2.17 6.17 3.54 10.31 3.54 4.14 0 7.84-1.37 10.31-3.53 1.48 4.35 5.98 7.5 11.3 7.5 1.55 0 3.03-.27 4.4-.76h-.19c-6.33 0-11.8-4.9-11.8-10.56 0-4.18 2.32-7.72 5.69-9.68-5.5.8-9.73 5-9.9 10.1a17.61 17.61 0 0 1-9.8 2.8c-3.8 0-7.25-1.06-9.8-2.8-.18-5.1-4.4-9.3-9.9-10.1a11.18 11.18 0 0 1 5.68 9.68c0 5.66-5.47 10.57-11.8 10.57H28Z\" fill=\"#000\" fill-opacity=\".6\" opacity=\".6\"/><path d=\"M17 24a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM91 24a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z\" fill=\"#C83E3B\" fill-opacity=\".2\"/>","grimace":"<rect x=\"22\" y=\"7\" width=\"64\" height=\"26\" rx=\"13\" fill=\"#000\" fill-opacity=\".6\"/><rect x=\"24\" y=\"9\" width=\"60\" height=\"22\" rx=\"11\" fill=\"#fbf7ee\"/><path d=\"M24.18 18H32V9.41A11 11 0 0 1 35 9h1v9h9V9h4v9h9V9h4v9h9V9h2c.68 0 1.35.06 2 .18V18h8.82l.05.28v3.44l-.05.28H75v8.82c-.65.12-1.32.18-2 .18h-2v-9h-9v9h-4v-9h-9v9h-4v-9h-9v9h-1a11 11 0 0 1-3-.41V22h-7.82a11.06 11.06 0 0 1 0-4Z\" fill=\"#d6cfbd\"/>","sad":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M40.06 27.72C40.7 20.7 46.7 16 54 16c7.34 0 13.36 4.75 13.95 11.85.03.38-.87.67-1.32.45-5.54-2.77-9.75-4.16-12.63-4.16-2.84 0-7 1.36-12.45 4.07-.5.25-1.53-.07-1.5-.49Z\" fill=\"#000\" fill-opacity=\".7\"/>","screamOpen":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M34 38.86C35.14 24.88 38.24 13.01 54 13c15.76 0 18.92 11.94 20 26 .08 1.12-.83 2-1.96 2-6.69 0-9.37-2-18.05-2-8.7 0-13.24 2-17.9 2-1.15 0-2.2-.74-2.1-2.14Z\" fill=\"#000\" fill-opacity=\".7\"/><path d=\"M67.02 17.57c-.61.28-1.3.43-2.02.43H44c-.98 0-1.9-.28-2.67-.77C44.23 14.57 48.28 13 54 13c5.95 0 10.1 1.7 13.02 4.57Z\" fill=\"#fbf7ee\"/><path d=\"M69.8 40.92a44.2 44.2 0 0 1-5.54-.82c-2.73-.53-5.65-1.1-10.27-1.1-5.02 0-8.66.66-11.74 1.23-1.45.26-2.77.5-4.06.65A11 11 0 0 1 54 33.2a11 11 0 0 1 15.8 7.72Z\" fill=\"#c8566a\"/>","serious":"<rect x=\"42\" y=\"18\" width=\"24\" height=\"6\" rx=\"3\" fill=\"#000\" fill-opacity=\".7\"/>","smile":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M35.12 15.13a19 19 0 0 0 37.77-.09c.08-.77-.77-2.04-1.85-2.04H37.1C36 13 35 14.18 35.12 15.13Z\" fill=\"#000\" fill-opacity=\".7\"/><path d=\"M70 13H39a5 5 0 0 0 5 5h21a5 5 0 0 0 5-5Z\" fill=\"#fbf7ee\"/><path d=\"M66.7 27.14A10.96 10.96 0 0 0 54 25.2a10.95 10.95 0 0 0-12.7 1.94A18.93 18.93 0 0 0 54 32c4.88 0 9.33-1.84 12.7-4.86Z\" fill=\"#c8566a\"/>","tongue":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M29 15.6C30.41 25.24 41.06 33 54 33c12.97 0 23.65-7.82 25-18.26.1-.4-.22-1.74-2.17-1.74H31.17c-1.79 0-2.3 1.24-2.17 2.6Z\" fill=\"#000\" fill-opacity=\".7\"/><path d=\"M70 13H39a5 5 0 0 0 5 5h21a5 5 0 0 0 5-5Z\" fill=\"#fbf7ee\"/><path d=\"M43 23.5a1.88 1.88 0 0 0 0 .13v8.87a11.5 11.5 0 1 0 23 0v-8.87a1.62 1.62 0 0 0 0-.13c0-1.93-2.91-3.5-6.5-3.5-2.01 0-3.8.5-5 1.26a9.45 9.45 0 0 0-5-1.26c-3.59 0-6.5 1.57-6.5 3.5Z\" fill=\"#c8566a\"/>","twinkle":"<path d=\"M40 16c0 5.37 6.16 9 14 9s14-3.63 14-9c0-1.1-.95-2-2-2-1.3 0-1.87.9-2 2-1.24 2.94-4.32 4.72-10 5-5.68-.28-8.76-2.06-10-5-.13-1.1-.7-2-2-2-1.05 0-2 .9-2 2Z\" fill=\"#000\" fill-opacity=\".6\"/>","vomit":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M34 30.4C35.14 19.9 38.24 11 54 11c15.76 0 18.92 8.96 20 19.5.08.84-.83 1.5-1.96 1.5-6.69 0-9.37-1.5-18.05-1.5-8.7 0-13.24 1.5-17.9 1.5-1.15 0-2.2-.55-2.1-1.6Z\" fill=\"#000\" fill-opacity=\".7\"/><path d=\"M67.86 15.1c-.8.57-1.8.9-2.86.9H44c-1.3 0-2.49-.5-3.38-1.31C43.56 12.38 47.8 11 54 11c6.54 0 10.9 1.54 13.86 4.1Z\" fill=\"#fbf7ee\"/><path d=\"M42 25a6 6 0 0 0-6 6v7a6 6 0 0 0 12 0v-2h.08a6 6 0 0 1 11.84 0H60a6 6 0 0 0 12 0v-5a6 6 0 0 0-6-6H42Z\" fill=\"#6b8a3a\"/><path d=\"M72 31a6 6 0 0 0-6-6H42a6 6 0 0 0-6 6v6a6 6 0 0 0 12 0v-2h.08a6 6 0 0 1 11.84 0H60a6 6 0 0 0 12 0v-4Z\" fill=\"#7da24a\"/>"},"facialHair":{"beardLight":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M101.43 98.17c-2.52 2.3-5.2 3.32-8.58 2.6-.58-.12-2.95-4.54-8.85-4.54-5.9 0-8.27 4.42-8.85 4.54-3.39.72-6.07-.3-8.58-2.6-4.72-4.31-8.65-10.26-6.3-16.75 1.24-3.38 3.24-7.1 6.88-8.17 3.89-1.15 9.35 0 13.26-.8A8.6 8.6 0 0 0 84 71a8.6 8.6 0 0 0 3.58 1.46c3.92.78 9.38-.36 13.27.79 3.64 1.07 5.64 4.79 6.87 8.17 2.36 6.49-1.57 12.44-6.3 16.75ZM140.08 26c-3.4 8.4-2.1 18.86-2.72 27.68-.52 7.16-2.02 17.9-8.39 22.53-3.25 2.37-9.18 6.35-13.43 5.24-2.93-.76-3.24-9.16-7.09-12.3a22.42 22.42 0 0 0-15.3-4.9c-2.37.11-7.17.09-9.15 1.91-1.98-1.82-6.78-1.8-9.15-1.9a22.42 22.42 0 0 0-15.3 4.89c-3.85 3.14-4.16 11.54-7.1 12.3-4.24 1.1-10.17-2.87-13.42-5.24-6.37-4.62-7.87-15.37-8.39-22.53-.63-8.82.69-19.28-2.72-27.68-1.66 0-.57 16.13-.57 16.13v20.36c.04 15.28 9.59 38.16 30.76 46.9C63.29 111.53 75 115 84 115c8.98.01 20.71-3.13 25.9-5.27 21.16-8.73 30.71-31.95 30.75-47.23V42.13s1.1-16.13-.57-16.13Z\" fill=\"{{facialHair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","beardMajestic":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M65.18 77.74c2.18-1.64 15.23-2.26 17.58-3.65.73-.43 1.3-.87 1.74-1.31.44.44 1 .88 1.74 1.3 2.35 1.4 15.4 2.02 17.58 3.66 2.21 1.65 3.82 5.44 3.65 8.41-.22 3.56-4.1 12.05-13.8 13.03a12.3 12.3 0 0 0-9.17-3.87 12.3 12.3 0 0 0-9.17 3.87c-9.7-.98-13.58-9.47-13.8-13.03-.17-2.97 1.44-6.76 3.65-8.41Zm.67 17.16h.01-.01ZM144.86 56c-.39-5.97-1.58-11.85-2.63-17.71-.28-1.58-1.8-12.29-2.5-12.29-.23 9.1-1.03 18.08-2.06 27.14-.3 2.7-.63 5.42-.84 8.13-.18 2.2.13 4.85-.4 6.98-.68 2.7-4.08 5.23-6.73 6.16-6.6 2.33-12.1-7.3-17.74-10.12-7.32-3.66-19.9-4.53-27.38.24-7.64-4.77-20.22-3.9-27.54-.24C51.4 67.11 45.9 76.74 39.3 74.41c-2.65-.93-6.05-3.46-6.73-6.16-.53-2.13-.22-4.78-.4-6.98-.2-2.71-.53-5.42-.84-8.13A308.31 308.31 0 0 1 29.27 26c-.7 0-2.22 10.7-2.5 12.29-1.05 5.86-2.24 11.74-2.63 17.7-.4 6.11.07 12.18 1.33 18.17.6 2.87 1.3 5.72 2.05 8.54.83 3.15-.32 9.27.05 12.5.7 6.1 3.58 18 6.81 23.25 1.56 2.54 3.4 4.12 5.44 6.17 1.96 1.97 2.78 5.02 4.9 7.12 3.96 3.9 9.73 6.23 15.65 6.8 5.3 4.51 14.14 7.46 24.13 7.46 10 0 18.82-2.95 24.14-7.46 5.91-.57 11.68-2.9 15.63-6.8 2.13-2.1 2.95-5.15 4.91-7.12 2.05-2.05 3.88-3.63 5.44-6.17 3.23-5.25 6.1-17.15 6.8-23.26.38-3.22-.77-9.34.06-12.49.75-2.82 1.45-5.67 2.05-8.54 1.25-6 1.73-12.06 1.33-18.17Z\" fill=\"{{facialHair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","beardMedium":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M84.5 93.84c-11.5.38-16.64 5.88-20.5.29-2.91-4.2-1.7-11.26 1.01-15.23 3.86-5.65 9.1-2.92 14.95-3.56 1.6-.18 3.2-.62 4.54-1.34 1.36.72 2.95 1.16 4.55 1.34 5.85.64 11.09-2.09 14.94 3.56 2.72 3.97 3.93 11.03 1.03 15.23-3.87 5.6-9-.67-20.52-.29ZM140.4 26c-3.43 14.07-5 28.43-7.5 42.67-.5 2.97-1.07 5.93-1.68 8.88-.12.62-.25 2.92-.86 3.21-1.85.89-5.62-3.81-6.63-4.87-2.53-2.67-5.05-5.36-8.13-7.45a43.7 43.7 0 0 0-21.13-7.32c-3.18-.25-7.47.18-10.47 2-3-1.82-7.3-2.25-10.47-2-7.6.6-14.9 3.1-21.13 7.32-3.09 2.09-5.6 4.78-8.13 7.45-1 1.06-4.78 5.76-6.63 4.87-.61-.29-.74-2.6-.86-3.21-.6-2.95-1.17-5.91-1.7-8.88-2.47-14.24-4.05-28.6-7.47-42.67-1 0-1.87 18.75-1.98 20.5-.46 7.09-.98 14.03-.3 21.13 1.16 12.24 2.37 27.6 11.7 36.96 8.44 8.45 20.68 10.22 31.24 15.55 1.36.69 3.16 1.54 5.1 2.23 2.06 1.56 6.12 2.63 10.8 2.63 4.91 0 9.15-1.17 11.08-2.86 1.7-.65 3.27-1.39 4.48-2 10.56-5.33 22.8-7.1 31.24-15.55 9.33-9.36 10.54-24.72 11.7-36.96.68-7.1.16-14.04-.3-21.14-.1-1.74-.98-20.5-1.98-20.5Z\" fill=\"{{facialHair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","moustacheFancy":"<path d=\"M57.55 69.68a31.8 31.8 0 0 1 4.84-2.55C67.58 65.15 77.2 65.71 84 69.3c6.8-3.59 16.42-4.15 21.61-2.17 1.64.63 3.22 1.57 4.84 2.55 4.13 2.47 8.55 5.12 14.91 3.15.37-.12.73.22.62.58-1.37 4.5-9 7.6-11.6 7.7-6.2.24-11.75-2.26-17.13-4.69-4.44-2-8.77-3.96-13.25-4.26-4.48.3-8.8 2.26-13.25 4.26-5.38 2.43-10.92 4.93-17.13 4.69-2.6-.1-10.23-3.2-11.6-7.7-.11-.36.25-.7.62-.58 6.36 1.97 10.78-.68 14.9-3.15Z\" fill=\"{{facialHair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","moustacheMagnum":"<path d=\"M84 66.94c-2.5-3.34-12.27-4.75-19.28-3.48-9.65 1.76-13.74 12.3-12.5 14.22.77 1.2 2.48.8 4.26.38.8-.2 1.64-.38 2.4-.43 1.48-.09 3.34.22 5.44.57 4.98.82 11.37 1.88 17.63-1.51A6.04 6.04 0 0 0 84 74.84a6.04 6.04 0 0 0 2.05 1.85c6.25 3.39 12.64 2.33 17.62 1.5 2.1-.34 3.96-.65 5.45-.56.76.05 1.59.24 2.4.43 1.78.41 3.49.81 4.26-.38 1.24-1.91-2.85-12.46-12.5-14.22-7.02-1.27-16.78.14-19.28 3.48Z\" fill=\"{{facialHair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>"},"accessories":{"kurt":"<path d=\"M71 58.11c-11.04 0-12.63-9.08-35.33-10.37C13 46.72 5.82 53.44 5.77 58.11c.04 4.3-1.12 15.45 13.6 28.52 14.77 15.51 29.9 10.25 35.32 5.18 5.45-2.34 11.65-23.35 16.3-23.33 4.67.02 10.87 21 16.32 23.33 5.42 5.07 20.55 10.33 35.33-5.18 14.71-13.07 13.55-24.23 13.58-28.52-.03-4.66-7.2-11.4-29.9-10.37C83.63 49.03 82.05 58.11 71 58.11Z\" fill=\"#000\" fill-opacity=\".1\"/><path d=\"M71 56.11c-11.04 0-12.63-9.08-35.33-10.37C13 44.72 5.82 51.44 5.77 56.11c.04 4.3-1.12 15.45 13.6 28.52 14.77 15.51 29.9 10.25 35.32 5.18 5.45-2.34 11.65-23.35 16.3-23.33 4.67.02 10.87 21 16.32 23.33 5.42 5.07 20.55 10.33 35.33-5.18 14.71-13.07 13.55-24.23 13.58-28.52-.03-4.66-7.2-11.4-29.9-10.37C83.63 47.03 82.05 56.11 71 56.11Z\" fill=\"{{accessories}}\"/><path d=\"M32.95 50.93c14.27-.29 27.56 7.9 27.18 15.55-.22 5.05-2.93 22.83-19.02 23.33-16.1.5-24.81-17.79-24.46-25.92.2-3.51 2.05-12.67 16.3-12.96ZM109.05 50.93c-14.27-.29-27.56 7.9-27.18 15.55.22 5.05 2.93 22.83 19.02 23.33 16.1.5 24.81-17.79 24.46-25.92-.2-3.51-2.05-12.67-16.3-12.96Z\" fill=\"#262a33\"/>","prescription01":"<g fill-rule=\"evenodd\" clip-rule=\"evenodd\"><path d=\"M111.71 53.49c4.67.16 8 .88 10.55 4.52 3.01.15 6.25.37 8.98 1.63 3.39 1.56 3.9 5.1-.36 5.59-1.86.2-3.72-.12-5.55-.45l-.19-.03-.33-.06c1.1 9.46-6.21 20.87-14.23 24.35C99.6 93.8 87.34 88.53 81.53 79c-2.62-4.3-4.14-10.51-4.46-15.86-.42-.2-.83-.44-1.23-.67-.38-.22-.76-.44-1.12-.61-2-.98-5.34-1.1-7.5 0-.35.17-.7.37-1.05.58-.42.25-.86.5-1.3.72C64.53 68.5 63.01 74.7 60.4 79c-5.8 9.53-18.07 14.8-29.05 10.04-8.02-3.48-15.33-14.89-14.23-24.35l-.33.06-.2.03c-1.83.33-3.7.66-5.55.45-4.27-.5-3.74-4.03-.36-5.6 2.72-1.25 5.96-1.47 8.97-1.62 2.55-3.63 5.88-4.36 10.55-4.52l23.29-.46c5.19-.14 9.72 0 11.03 4.6a18.7 18.7 0 0 1 6.35-1.25c1.86 0 4.35.45 6.5 1.28 1.3-4.64 5.83-4.77 11.03-4.63l23.3.46Zm-24.03 6.78c-2.37.03-3.5.42-3.9 2.9-.4 2.5 0 5.31.46 7.78.73 3.77 1.92 7.46 4.71 10.22a16.24 16.24 0 0 0 8.32 4.34c.11.03.54.1.96.16.63.1 1.23.18.71.13l-.1-.01h-.06a47.08 47.08 0 0 1 .16 0c3.73.4 7.72.32 10.82-2.04 3.53-2.7 5.95-6.95 7.01-11.2.63-2.48 1.93-8.42-.46-10.4-2.73-2.28-28.63-1.88-28.63-1.88Zm-33.43 0c2.37.03 3.5.42 3.9 2.9.4 2.5 0 5.32-.46 7.78-.73 3.77-1.92 7.46-4.71 10.22a16.23 16.23 0 0 1-8.32 4.35l-.96.15c-.64.1-1.26.19-.68.13-3.73.4-7.74.32-10.85-2.05-3.53-2.69-5.95-6.95-7.01-11.2-.63-2.48-1.93-8.42.46-10.4 2.73-2.28 28.63-1.87 28.63-1.87Zm-10.93 25.5Z\" fill=\"#000\" fill-opacity=\".1\"/><path d=\"M111.71 51.49c4.67.16 8 .88 10.55 4.52 3.01.15 6.25.37 8.98 1.63 3.39 1.56 3.9 5.1-.36 5.59-1.86.2-3.72-.12-5.55-.45l-.19-.03-.33-.06c1.1 9.46-6.21 20.87-14.23 24.35C99.6 91.8 87.34 86.53 81.53 77c-2.62-4.3-4.14-10.51-4.46-15.86-.42-.2-.83-.44-1.23-.67-.38-.22-.76-.44-1.12-.61-2-.98-5.34-1.1-7.5 0-.35.17-.7.37-1.05.58-.42.25-.86.5-1.3.72C64.53 66.5 63.01 72.7 60.4 77c-5.8 9.53-18.07 14.8-29.05 10.04-8.02-3.48-15.33-14.89-14.23-24.35-.11 0-.22.03-.33.05l-.2.03c-1.83.33-3.7.66-5.55.45-4.27-.5-3.74-4.03-.36-5.6 2.72-1.25 5.96-1.47 8.97-1.62 2.55-3.63 5.88-4.36 10.55-4.52l23.29-.46c5.19-.14 9.72 0 11.03 4.6a18.7 18.7 0 0 1 6.35-1.25c1.86 0 4.35.45 6.5 1.28 1.3-4.64 5.83-4.77 11.03-4.63l23.3.46Zm-24.03 6.78c-2.37.03-3.5.42-3.9 2.9-.4 2.5 0 5.31.46 7.78.73 3.77 1.92 7.46 4.71 10.22a16.24 16.24 0 0 0 8.32 4.34c.11.03.54.1.96.16.63.1 1.23.18.71.13l-.1-.01h-.06a47.08 47.08 0 0 1 .16 0c3.73.4 7.72.32 10.82-2.04 3.53-2.7 5.95-6.95 7.01-11.2.63-2.48 1.93-8.42-.46-10.4-2.73-2.28-28.63-1.88-28.63-1.88Zm-33.43 0c2.37.03 3.5.42 3.9 2.9.4 2.5 0 5.32-.46 7.78-.73 3.77-1.92 7.46-4.71 10.22a16.23 16.23 0 0 1-8.32 4.35l-.96.15c-.64.1-1.26.19-.68.13-3.73.4-7.74.32-10.85-2.05-3.53-2.69-5.95-6.95-7.01-11.2-.63-2.48-1.93-8.42.46-10.4 2.73-2.28 28.63-1.87 28.63-1.87Zm-10.93 25.5Z\" fill=\"{{accessories}}\"/></g>","prescription02":"<g fill-rule=\"evenodd\" clip-rule=\"evenodd\"><path d=\"M38.5 52c-21.3 0-28.85 5.1-29.55 5.77A2.92 2.92 0 0 0 6 60.66v2.88c0 1.6 1.32 2.89 2.95 2.89 0 0 5.91 0 5.91 2.88 0 .44.07.65.19.68-.04.82-.05 1.66-.05 2.5C15 85.34 23.31 93 37.24 93H40c14.72 0 25-8.43 25-20.5 0-1.5-.04-3-.17-4.46l1.58-.77c.58-.29 1.21-.5 1.9-.64 1.85-.38 3.95-.22 5.99.28.73.18 1.26.35 1.5.45l1.38.55c-.14 1.5-.18 3.04-.18 4.6C77 85.34 85.31 93 99.24 93H102c14.72 0 25-8.43 25-20.5 0-1.54-.04-3.07-.18-4.56 1.74-1.51 6.22-1.51 6.22-1.51a2.92 2.92 0 0 0 2.96-2.89v-2.88c0-1.6-1.32-2.89-2.96-2.89-.69-.67-8.25-5.77-29.54-5.77H100.53c-1.8 0-3.44.07-4.97.2-9.54.54-14.68 2.15-19.92 4.7a17 17 0 0 1-4.56.87 17.01 17.01 0 0 1-4.81-.91l-.42-.2v-.01c-4.94-2.42-8.43-4.13-20.78-4.55a61.2 61.2 0 0 0-3.6-.1H38.5ZM19 73.5C19 64.84 19 58 38.39 58h3.22C61 58 61 64.84 61 73.5 61 82.63 52.36 89 40 89h-3.03C22.12 89 19 80.57 19 73.5Zm62 0c0-8.66 0-15.5 19.39-15.5h3.22C123 58 123 64.84 123 73.5c0 9.13-8.64 15.5-21 15.5h-3.03C84.12 89 81 80.57 81 73.5Z\" fill=\"#000\" fill-opacity=\".1\"/><path d=\"M38.5 50c-21.3 0-28.85 5.1-29.55 5.77A2.92 2.92 0 0 0 6 58.66v2.88c0 1.6 1.32 2.89 2.95 2.89 0 0 5.91 0 5.91 2.88 0 .44.07.65.19.68-.04.82-.05 1.66-.05 2.5C15 83.34 23.31 91 37.24 91H40c14.72 0 25-8.43 25-20.5 0-1.5-.04-3-.17-4.46l1.58-.77c.58-.29 1.21-.5 1.9-.64 1.85-.38 3.95-.22 5.99.28.73.18 1.26.35 1.5.45l1.38.55c-.14 1.5-.18 3.04-.18 4.6C77 83.34 85.31 91 99.24 91H102c14.72 0 25-8.43 25-20.5 0-1.54-.04-3.07-.18-4.56 1.74-1.51 6.22-1.51 6.22-1.51a2.92 2.92 0 0 0 2.96-2.89v-2.88c0-1.6-1.32-2.89-2.96-2.89-.69-.67-8.25-5.77-29.54-5.77H100.53c-1.8 0-3.44.07-4.97.2-9.54.54-14.68 2.15-19.92 4.7a17 17 0 0 1-4.56.87 17.01 17.01 0 0 1-4.81-.91l-.42-.2v-.01c-4.94-2.42-8.43-4.13-20.78-4.55a61.2 61.2 0 0 0-3.6-.1H38.5ZM19 71.5C19 62.84 19 56 38.39 56h3.22C61 56 61 62.84 61 71.5 61 80.63 52.36 87 40 87h-3.03C22.12 87 19 78.57 19 71.5Zm62 0c0-8.66 0-15.5 19.39-15.5h3.22C123 56 123 62.84 123 71.5c0 9.13-8.64 15.5-21 15.5h-3.03C84.12 87 81 78.57 81 71.5Z\" fill=\"{{accessories}}\"/></g>","round":"<g fill-rule=\"evenodd\" clip-rule=\"evenodd\"><path d=\"M40 96a24 24 0 0 1-22.96-31H10.5a2.5 2.5 0 0 1 0-5h8c.23 0 .45.03.66.09a24 24 0 0 1 42.26 1.06A11.36 11.36 0 0 1 70.86 56c4.01 0 7.55 2.14 9.6 5.4a24 24 0 0 1 42.38-1.31c.2-.06.43-.1.66-.1h8a2.5 2.5 0 1 1 0 5h-6.54a24 24 0 1 1-46.6 2.83c-.08-4.37-3.45-7.83-7.5-7.83-3.73 0-6.89 2.94-7.42 6.83A24 24 0 0 1 40 96Zm0-4a20 20 0 1 0 0-40 20 20 0 0 0 0 40Zm82-20a20 20 0 1 1-40 0 20 20 0 0 1 40 0Z\" fill=\"#000\" fill-opacity=\".1\"/><path d=\"M40 94a24 24 0 0 1-22.96-31H10.5a2.5 2.5 0 0 1 0-5h8c.23 0 .45.03.66.09a24 24 0 0 1 42.26 1.06A11.36 11.36 0 0 1 70.86 54c4.01 0 7.55 2.14 9.6 5.4a24 24 0 0 1 42.38-1.31c.2-.06.43-.1.66-.1h8a2.5 2.5 0 1 1 0 5h-6.54a24 24 0 1 1-46.6 2.84c-.08-4.37-3.45-7.83-7.5-7.83-3.73 0-6.89 2.94-7.42 6.83A24 24 0 0 1 40 94Zm0-4a20 20 0 1 0 0-40 20 20 0 0 0 0 40Zm82-20a20 20 0 1 1-40 0 20 20 0 0 1 40 0Z\" fill=\"{{accessories}}\"/></g>","sunglasses":"<g fill-rule=\"evenodd\" clip-rule=\"evenodd\"><path d=\"M111.71 53.49c4.67.16 8 .88 10.55 4.52 3.01.15 6.25.37 8.98 1.63 3.39 1.56 3.9 5.1-.36 5.59-1.86.2-3.72-.12-5.55-.45l-.19-.03-.33-.06c1.1 9.46-6.21 20.87-14.23 24.35C99.6 93.8 87.34 88.53 81.53 79c-2.62-4.3-4.14-10.51-4.46-15.86-.42-.2-.83-.44-1.23-.67-.38-.22-.76-.44-1.12-.61-2-.98-5.34-1.1-7.5 0-.35.17-.7.37-1.05.58-.42.25-.86.5-1.3.72C64.53 68.5 63.01 74.7 60.4 79c-5.8 9.53-18.07 14.8-29.05 10.04-8.02-3.48-15.33-14.89-14.23-24.35l-.33.06-.2.03c-1.83.33-3.7.66-5.55.45-4.27-.5-3.74-4.03-.36-5.6 2.72-1.25 5.96-1.47 8.97-1.62 2.55-3.63 5.88-4.36 10.55-4.52l23.29-.46c5.19-.14 9.72 0 11.03 4.6a18.7 18.7 0 0 1 6.35-1.25c1.86 0 4.35.45 6.5 1.28 1.3-4.64 5.83-4.77 11.03-4.63l23.3.46Zm-24.03 6.78c-2.37.03-3.5.42-3.9 2.9-.4 2.5 0 5.31.46 7.78.73 3.77 1.92 7.46 4.71 10.22a16.24 16.24 0 0 0 8.32 4.34c.11.03.54.1.96.16.63.1 1.23.18.71.13 3.73.4 7.72.3 10.82-2.05 3.53-2.7 5.95-6.95 7.01-11.2.63-2.48 1.93-8.42-.46-10.4-2.73-2.28-28.63-1.88-28.63-1.88Zm-33.43 0c2.37.03 3.5.42 3.9 2.9.4 2.5 0 5.32-.46 7.78-.73 3.77-1.92 7.46-4.71 10.22a16.23 16.23 0 0 1-9.28 4.5c-.64.1-1.26.19-.68.13-3.73.4-7.74.32-10.85-2.05-3.53-2.69-5.95-6.95-7.01-11.2-.63-2.48-1.93-8.42.46-10.4 2.73-2.28 28.63-1.87 28.63-1.87Zm-10.93 25.5Z\" fill=\"#000\" fill-opacity=\".1\"/><path d=\"M55.01 57.28c2.51.02 3.7.45 4.13 3.11.43 2.7 0 5.74-.5 8.4-.75 4.06-2.02 8.04-4.98 11a17.16 17.16 0 0 1-8.8 4.69c-.33.07-3.15.47-1.42.27-4.04.47-8.43.45-11.8-2.17-3.74-2.9-6.3-7.5-7.43-12.07-.66-2.66-2.04-9.06.49-11.2C27.6 56.85 55 57.28 55 57.28Z\" fill=\"#000\" fill-opacity=\".7\"/><path d=\"M86.92 57.27c-2.51.03-3.7.45-4.13 3.12-.43 2.7 0 5.73.5 8.4.75 4.06 2.02 8.03 4.98 11a17.17 17.17 0 0 0 8.8 4.69c.33.07 3.15.47 1.42.26 4.04.47 8.43.45 11.8-2.16 3.74-2.9 6.3-7.5 7.43-12.07.66-2.67 2.04-9.07-.49-11.2-2.9-2.46-30.31-2.03-30.31-2.03Z\" fill=\"#000\" fill-opacity=\".7\"/><path d=\"M111.71 51.49c4.67.16 8 .88 10.55 4.52 3.01.15 6.25.37 8.98 1.63 3.39 1.56 3.9 5.1-.36 5.59-1.86.2-3.72-.12-5.55-.45l-.19-.03-.33-.06c1.1 9.46-6.21 20.87-14.23 24.35C99.6 91.8 87.34 86.53 81.53 77c-2.62-4.3-4.14-10.51-4.46-15.86-.42-.2-.83-.44-1.23-.67-.38-.22-.76-.44-1.12-.61-2-.98-5.34-1.1-7.5 0-.35.17-.7.37-1.05.58-.42.25-.86.5-1.3.72C64.53 66.5 63.01 72.7 60.4 77c-5.8 9.53-18.07 14.8-29.05 10.04-8.02-3.48-15.33-14.89-14.23-24.35-.11 0-.22.03-.33.05l-.2.03c-1.83.33-3.7.66-5.55.45-4.27-.5-3.74-4.03-.36-5.6 2.72-1.25 5.96-1.47 8.97-1.62 2.55-3.63 5.88-4.36 10.55-4.52l23.29-.46c5.19-.14 9.72 0 11.03 4.6a18.7 18.7 0 0 1 6.35-1.25c1.86 0 4.35.45 6.5 1.28 1.3-4.64 5.83-4.77 11.03-4.63l23.3.46Zm-24.03 6.78c-2.37.03-3.5.42-3.9 2.9-.4 2.5 0 5.31.46 7.78.73 3.77 1.92 7.46 4.71 10.22a16.24 16.24 0 0 0 8.32 4.34c.11.03.54.1.96.16.63.1 1.23.18.71.13 3.73.4 7.72.3 10.82-2.05 3.53-2.7 5.95-6.95 7.01-11.2.63-2.48 1.93-8.42-.46-10.4-2.73-2.28-28.63-1.88-28.63-1.88Zm-33.43 0c2.37.03 3.5.42 3.9 2.9.4 2.5 0 5.32-.46 7.78-.73 3.77-1.92 7.46-4.71 10.22a16.23 16.23 0 0 1-9.28 4.5c-.64.1-1.26.19-.68.13-3.73.4-7.74.32-10.85-2.05-3.53-2.69-5.95-6.95-7.01-11.2-.63-2.48-1.93-8.42.46-10.4 2.73-2.28 28.63-1.87 28.63-1.87Zm-10.93 25.5Z\" fill=\"{{accessories}}\"/></g>","wayfarers":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M39.25 52c-21.13 0-28.63 5.17-29.32 5.86A2.93 2.93 0 0 0 7 60.79v2.92a2.93 2.93 0 0 0 2.93 2.93s5.87 0 5.87 2.93c0 .2 0 .34.03.45-.03.82-.04 1.65-.04 2.48C15.78 85.34 24.07 93 37.96 93h2.75c14.68 0 24.93-8.43 24.93-20.5 0-1.44-.04-2.88-.16-4.28l1.45-.73c.57-.28 1.2-.5 1.87-.64 1.85-.39 3.93-.23 5.95.28.73.18 1.25.36 1.5.46l1.25.5a50.58 50.58 0 0 0-.16 4.4c0 12.84 8.29 20.5 22.17 20.5h2.75c14.68 0 24.93-8.43 24.93-20.5 0-.83 0-1.66-.04-2.48.02-.11.03-.26.03-.45 0-2.93 5.87-2.93 5.87-2.93 1.62 0 2.93-1.3 2.93-2.93V60.8a2.93 2.93 0 0 0-2.93-2.93c-.69-.69-8.2-5.86-29.32-5.86h-2.93c-1.83 0-3.52.07-5.08.21-9.38.56-14.46 2.19-19.63 4.76-.54.2-2.38.79-4.53.88a16.56 16.56 0 0 1-4.77-.92l-.42-.2v-.01c-4.9-2.45-8.36-4.18-20.55-4.61-1.15-.07-2.37-.1-3.66-.1h-2.93Zm-1.12 5.86h1.12c2.44 0 4.59.03 6.48.1 14.05.84 14.05 6.95 14.05 14.54 0 8.62-7.84 14.64-19.06 14.64h-2.75c-13.5 0-16.32-7.96-16.32-14.64 0-8 0-14.37 16.48-14.64Zm26.11 4.36.1.03-.07.03-.03-.06Zm14.52 0-.07.03.04.02c0-.02 0-.03.02-.05Zm16.7-4.12a125.22 125.22 0 0 1 9.4-.24c16.49.27 16.49 6.63 16.49 14.64 0 8.62-7.84 14.64-19.07 14.64h-2.75c-13.48 0-16.31-7.96-16.31-14.64 0-7.25 0-13.15 12.24-14.4Z\" fill=\"#000\" fill-opacity=\".1\"/><path d=\"M40.72 88.07c13.74 0 22-7.87 22-17.57s-1.3-17.57-20.54-17.57h-2.93c-19.25 0-20.53 7.86-20.53 17.57 0 9.7 5.5 17.57 19.25 17.57h2.75Z\" fill=\"#000\" fill-opacity=\".7\"/><path d=\"M102.28 88.07c13.75 0 22-7.87 22-17.57S123 52.93 103.75 52.93h-2.93c-19.25 0-20.53 7.86-20.53 17.57 0 9.7 5.5 17.57 19.24 17.57h2.75Z\" fill=\"#000\" fill-opacity=\".7\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M39.25 50c-21.13 0-28.63 5.17-29.32 5.86A2.93 2.93 0 0 0 7 58.79v2.92a2.93 2.93 0 0 0 2.93 2.93s5.87 0 5.87 2.93c0 .2 0 .34.03.45-.03.82-.04 1.65-.04 2.48C15.78 83.34 24.07 91 37.96 91h2.75c14.68 0 24.93-8.43 24.93-20.5 0-1.44-.04-2.88-.16-4.28l1.45-.73c.57-.28 1.2-.5 1.87-.64 1.85-.39 3.93-.23 5.95.28.73.18 1.25.36 1.5.46l1.25.5a50.58 50.58 0 0 0-.16 4.4c0 12.84 8.29 20.5 22.17 20.5h2.75c14.68 0 24.93-8.43 24.93-20.5 0-.83 0-1.66-.04-2.48.02-.11.03-.26.03-.45 0-2.93 5.87-2.93 5.87-2.93 1.62 0 2.93-1.3 2.93-2.93V58.8a2.93 2.93 0 0 0-2.93-2.93c-.69-.69-8.2-5.86-29.32-5.86h-2.93c-1.83 0-3.52.07-5.08.21-9.38.56-14.46 2.19-19.63 4.76-.54.2-2.38.79-4.53.88a16.56 16.56 0 0 1-4.77-.92l-.42-.2v-.01c-4.9-2.45-8.36-4.18-20.55-4.61-1.15-.07-2.37-.1-3.66-.1h-2.93Zm-1.12 5.86h1.12c2.44 0 4.59.03 6.48.1 14.05.84 14.05 6.95 14.05 14.54 0 8.62-7.84 14.64-19.06 14.64h-2.75c-13.5 0-16.32-7.96-16.32-14.64 0-8 0-14.37 16.48-14.64Zm26.11 4.36.1.03-.07.03-.03-.06Zm14.52 0-.07.03.04.02c0-.02 0-.03.02-.05Zm16.7-4.12a125.22 125.22 0 0 1 9.4-.24c16.49.27 16.49 6.63 16.49 14.64 0 8.62-7.84 14.64-19.07 14.64h-2.75c-13.48 0-16.31-7.96-16.31-14.64 0-7.25 0-13.15 12.24-14.4Z\" fill=\"{{accessories}}\"/>","eyepatch":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M94.4 4.78c-3.08-3.09-6.28 3.86-7.78 5.65-3.6 4.32-7.08 8.75-10.75 13.02-7.25 8.43-14.43 16.92-21.64 25.4-1.09 1.28-.96 1.41-2.4 1.54-.94.08-2.27-.4-3.26-.46-2.75-.16-5.46.3-8.13.9-5.35 1.17-11.01 3.1-15.65 6.07-1.22.78-2 1.7-3.32 1.94-1.15.21-2.68-.21-3.85-.32-2.08-.2-5.08-1.05-7.12-.6-2.6.55-3.58 3.7-.94 5.08 2.01 1.06 6.01.48 8.26.64 2.58.2 1.8.06 1.43 2.52-.53 3.54.35 7.49 1.84 10.72 3.46 7.5 13.03 15.46 21.77 14.72 7.28-.6 13.67-7.19 16.66-13.5a30.75 30.75 0 0 0 2.73-10.47c.19-2.27.08-4.67-.57-6.87a16.5 16.5 0 0 0-1.37-3.2c-.44-.79-2.4-2.64-2.52-3.44-.23-1.56 4.18-5.73 5.03-6.78 3.97-4.91 7.96-9.8 11.9-14.75 3.88-4.87 7.79-9.73 11.77-14.51 1.8-2.17 10.83-10.37 7.9-13.3\" fill=\"#1f2733\"/>"},"hat":{"hat":"<path d=\"M188.32 138.76C227.9 129.26 255 109.87 255 87.5c0-23.5-29.92-43.72-72.8-52.63l-.31-1.43A40 40 0 0 0 142.82 2h-18.64a40 40 0 0 0-39.07 31.44l-.27 1.21C41.41 43.45 11 63.8 11 87.5c0 22.37 27.1 41.76 66.68 51.26-.2-1.28-.36-2.58-.47-3.9A12 12 0 0 1 67 123v-13a12 12 0 0 1 10-11.83V92c0-8 1.68-15.62 4.7-22.51 8.61-15.69 92.73-16.49 102.66.16A55.82 55.82 0 0 1 189 92v6.17A12 12 0 0 1 199 110v13a12 12 0 0 1-10.2 11.87 56.06 56.06 0 0 1-.48 3.9Z\" fill=\"{{hat}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M189 92.74c3.85-3.25 6-6.9 6-10.74 0-6.08-5.38-11.65-14.32-15.98 1.64 1.1 2.9 2.3 3.68 3.63A55.82 55.82 0 0 1 189 92v.74ZM157.26 58.99a144.36 144.36 0 0 0-24.26-2c-8.98 0-17.52.78-25.22 2.17 15.16-2.2 34.11-2.3 49.48-.17ZM84.69 66.33C76.12 70.62 71 76.07 71 82c0 3.85 2.15 7.49 6 10.74V92c0-8 1.68-15.62 4.7-22.51a9.94 9.94 0 0 1 2.99-3.16Z\" fill=\"#000\" fill-opacity=\".5\"/>","hijab":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M66 77.34c-.66 3.79-1 7.68-1 11.66v48c0 .97.02 1.94.06 2.9L65 142c.14 3.68-1.86 11.8-4.34 21.9-3.88 15.77-8.94 36.4-8.94 52.55 0 13.01 1.98 22.84 3.89 32.3 1.97 9.78 3.86 19.16 3.39 31.25h47s-.95-13.2-2.47-26.36c10.05 10.2 22.82 16.84 39.05 16.84 70.55 0 77.62-53.83 77.62-65.24 0-6.04-4.32-10.88-8.39-15.44-3.6-4.05-7.02-7.87-7-12.1 0-4.35 1.02-7.39 2.07-10.52 1.12-3.33 2.27-6.75 2.27-11.96 0-5.82-1.43-7.5-2.9-9.25a10.7 10.7 0 0 1-2.8-5.62c-.88-4.54-1.86-14.32-2.45-20.77V89A68 68 0 0 0 66.04 77.08L66 77v.34ZM133 53c-30.1 0-55 24.4-55 54.5v23c0 30.1 24.9 54.5 55 54.5s55-24.4 55-54.5v-23c0-30.1-24.9-54.5-55-54.5Z\" fill=\"{{hat}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M193.93 104.96A61.4 61.4 0 0 0 195 93.5c0-33.97-27.76-61.5-62-61.5-34.24 0-62 27.53-62 61.5 0 3.92.37 7.75 1.07 11.46a61 61 0 0 1 121.86 0Z\" fill=\"#fff\" fill-opacity=\".5\"/><path d=\"M78.07 104.69c-.05.93-.07 1.87-.07 2.81v23c0 30.1 24.9 54.5 55 54.5s55-24.4 55-54.5v-23c0-.94-.02-1.88-.07-2.81.7 3.5 1.07 7.1 1.07 10.81v23a54.5 54.5 0 0 1-54.5 54.5h-3A54.5 54.5 0 0 1 77 138.5v-23c0-3.7.37-7.32 1.07-10.81ZM187.05 194.14c-4.39 6.9-17.9 13.66-34.65 16.62-16.74 2.95-31.75 1.22-38.23-3.76.02.26.05.52.1.78 1.7 9.69 19.42 14.67 39.57 11.12 20.15-3.56 35.1-14.3 33.38-23.99-.04-.26-.1-.51-.17-.77ZM198.66 209.49c-2.64 9.6-14.87 20.2-31.56 26.28-16.68 6.07-32.87 5.8-41.06.15.1.34.2.67.32 1 4.53 12.44 24.47 16.6 44.55 9.3 20.07-7.31 32.67-23.32 28.15-35.75-.12-.34-.26-.66-.4-.98Z\" opacity=\".9\" fill=\"#000\" fill-opacity=\".16\"/>","turban":"<path d=\"M190.47 97.5c1-2.4 1.53-4.92 1.53-7.5 0-18.23-26.41-33-59-33-32.58 0-59 14.77-59 33 0 2.58.53 5.1 1.53 7.5C81.6 82.89 105.03 72 133 72s51.4 10.89 57.47 25.5Z\" fill=\"#e8e0cc\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M49 94.32C48.93 133.5 78 141 78 141c-5.44-49.55 23.54-65.15 46.53-77.53 2.94-1.58 5.78-3.11 8.44-4.65a309.5 309.5 0 0 0 8.48 4.68C164.43 75.87 193.42 91.48 188 141c0 0 29.07-8.46 29-46.68C216.92 47.15 164.85 3 135 3c-.67 0-1.34.03-2 .09-.67-.06-1.33-.09-2-.09-29.93 0-81.92 44.15-82 91.32Z\" fill=\"{{hat}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M49.01 95.9c.7 37.8 29 45.1 29 45.1s-29.07-7.07-29-43.97l.01-1.13ZM77.33 129.68c.15-37.86 26.18-51.05 47.2-61.71 11-5.58 20.64-10.47 24.47-17.83 4.13-7.25 5.39-13.94 4.65-19.67-.5 4.37-1.98 9.1-4.65 14.07-3.83 7.82-13.47 13-24.47 18.93-21.14 11.38-47.35 25.49-47.2 66.21Z\" fill=\"#000\" fill-opacity=\".16\"/>","winterHat1":"<path d=\"M86.67 68H64v112.91a4.09 4.09 0 0 0 4.09 4.1 18.58 18.58 0 0 0 18.58-18.6V68ZM202 68h-22.67v112.91a4.09 4.09 0 0 0 4.09 4.1A18.58 18.58 0 0 0 202 166.4V68Z\" fill=\"#f3eddc\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M63 64a44 44 0 0 1 44-44h52a44 44 0 0 1 44 44v104.6a16.4 16.4 0 0 1-16.4 16.4c-1.98 0-3.6-1.62-3.6-3.6V74H83v94.6A16.4 16.4 0 0 1 66.6 185c-1.99 0-3.6-1.62-3.6-3.6V64Z\" fill=\"{{hat}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><rect x=\"74\" y=\"52\" width=\"118\" height=\"36\" rx=\"8\" fill=\"#000\" fill-opacity=\".1\"/><rect x=\"74\" y=\"50\" width=\"118\" height=\"36\" rx=\"8\" fill=\"#f3eddc\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","winterHat02":"<path d=\"M197 168h-2v56.06a9 9 0 1 0 2 0V168ZM71 176h-2v56.06a9 9 0 1 0 2 0V176Z\" fill=\"#f3eddc\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><circle cx=\"133\" cy=\"20\" r=\"20\" fill=\"#f3eddc\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M93.45 77.53h79.1c6.08 0 9.82 2.93 9.82 9V166c0 30.46 22.63 30.41 22.63 10.92v-73.86C205 68.8 187.77 21 133 21c-54.77 0-72 47.8-72 82.05v73.86c0 19.5 22.63 19.54 22.63-10.92V86.53c0-6.07 3.73-9 9.82-9Z\" fill=\"{{hat}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M198.67 67H67.33C76.42 42.5 96.26 21 133 21s56.58 21.5 65.67 46Z\" fill=\"#000\" fill-opacity=\".2\"/><path d=\"M91.2 33.73 102.5 50 115 32H93.66c-.83.56-1.65 1.14-2.46 1.73ZM172.34 32H152l12.5 18 10.95-15.77c-1-.77-2.04-1.51-3.11-2.23ZM133.5 50 121 32h25l-12.5 18Z\" fill=\"#fff\" fill-opacity=\".5\"/><path d=\"M99 59 86.5 41 74 59h25ZM130 59l-12.5-18L105 59h25ZM148.5 41 161 59h-25l12.5-18ZM192 59l-12.5-18L167 59h25Z\" fill=\"#000\" fill-opacity=\".5\"/>","winterHat03":"<circle cx=\"133\" cy=\"20\" r=\"20\" fill=\"#f3eddc\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M67 78a66 66 0 1 1 132 0v5H67v-5Z\" fill=\"{{hat}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M64 69.77a7.05 7.05 0 0 1 3.05-5.96c7.8-5.18 30.42-17.8 66.02-17.8 35.6 0 58.14 12.62 65.9 17.81a7.04 7.04 0 0 1 3.03 5.95v30.2c0 3.3-3.9 5.38-6.78 3.75C184.84 97.83 163.1 88 133.8 88a133.57 133.57 0 0 0-63.17 15.98c-2.85 1.56-6.63-.5-6.63-3.75V69.77Z\" fill=\"#000\" fill-opacity=\".1\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M64 67.77a7.05 7.05 0 0 1 3.05-5.96c7.8-5.18 30.42-17.8 66.02-17.8 35.6 0 58.14 12.62 65.9 17.81a7.04 7.04 0 0 1 3.03 5.95v30.2c0 3.3-3.9 5.38-6.78 3.75C184.84 95.83 163.1 86 133.8 86a133.57 133.57 0 0 0-63.17 15.98c-2.85 1.56-6.63-.5-6.63-3.75V67.77Z\" fill=\"#f3eddc\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","winterHat04":"<path d=\"M67 65c0-8.16 1.6-15.95 4.5-23.06-3.86-8.95-8.33-22.96-3.86-32.82 8-2.43 17.8 1.33 25.63 5.73A60.72 60.72 0 0 1 128 4h10c12.91 0 24.9 4.01 34.75 10.86 7.84-4.4 17.66-8.17 25.67-5.74 4.47 9.88-.03 23.94-3.9 32.88A60.83 60.83 0 0 1 199 65v8H67v-8Z\" fill=\"{{hat}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M194.52 42c3.87-8.94 8.37-23 3.9-32.88-8.01-2.43-17.83 1.34-25.66 5.74A61.21 61.21 0 0 1 194.51 42ZM93.27 14.85c-7.83-4.4-17.63-8.16-25.63-5.73-4.47 9.86 0 23.87 3.87 32.82 4.5-11 12.12-20.4 21.76-27.1Z\" fill=\"#000\" fill-opacity=\".24\"/><path d=\"M190.2 33.42c1.99-6 3.5-12.86 1.49-16.1-2.67-1.16-7.59.47-12.4 2.77a61.28 61.28 0 0 1 10.9 13.33ZM86.66 20.14c-4.92-2.38-10-4.11-12.73-2.93-2.06 3.33-.42 10.47 1.64 16.59a61.28 61.28 0 0 1 11.1-13.66Z\" fill=\"#fff\" fill-opacity=\".3\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M64 69.77a7.05 7.05 0 0 1 3.05-5.96c7.8-5.18 30.42-17.8 66.02-17.8 35.6 0 58.14 12.62 65.9 17.81a7.04 7.04 0 0 1 3.03 5.95v30.2c0 3.3-3.9 5.38-6.78 3.75C184.84 97.83 163.1 88 133.8 88a133.57 133.57 0 0 0-63.17 15.98c-2.85 1.56-6.63-.5-6.63-3.75V69.77Z\" fill=\"#000\" fill-opacity=\".1\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M64 67.77a7.05 7.05 0 0 1 3.05-5.96c7.8-5.18 30.42-17.8 66.02-17.8 35.6 0 58.14 12.62 65.9 17.81a7.04 7.04 0 0 1 3.03 5.95v30.2c0 3.3-3.9 5.38-6.78 3.75C184.84 95.83 163.1 86 133.8 86a133.57 133.57 0 0 0-63.17 15.98c-2.85 1.56-6.63-.5-6.63-3.75V67.77Z\" fill=\"#f3eddc\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>"},"hair":{"bob":"<path d=\"M40 145c-.62-30.84 28.32-95.2 39-108 7.92-9.5 29.7-17.45 54-17 24.3.45 46.86 5.81 55 16 12.32 15.43 37.87 74.08 38 109 .1 24.8-9.54 49.66-23 51-7.6.76-17.26-.23-28.86-1.4-5.3-.55-11.02-1.13-17.14-1.6V180.6A56 56 0 0 0 189 130v-28.44a130.34 130.34 0 0 1-26.9-19.88c3.35 6.24 7.19 11.9 11.51 16.2-30.57-8.59-51.71-26.16-64.38-39.94C103.39 69.02 92.96 85.23 77 97.57V130a56 56 0 0 0 32 50.61v13.14c-6.95.95-13.41 2.16-19.36 3.27-10.85 2.02-19.98 3.73-27.26 2.98-14.22-1.47-21.88-30.2-22.38-55Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","bun":"<path d=\"M151.12 28.28c3.06-2.97 4.88-6.71 4.88-10.78C156 7.84 145.7 0 133 0s-23 7.84-23 17.5c0 4.1 1.85 7.86 4.94 10.84-.99.22-1.95.45-2.9.69-15.1 3.8-24.02 14.62-31.68 30.62a67.68 67.68 0 0 0-6.34 25.83c-.13 3.41.33 6.94 1.25 10.22.33 1.2 2.15 5.39 2.65 2 .1-.66-.07-1.47-.24-2.27-.12-.55-.23-1.1-.26-1.6-.08-1.56 0-3.15.11-4.72.2-2.92.73-5.8 1.65-8.59 1.33-3.98 3.02-8.3 5.6-11.67.97-1.25 1.88-2.7 2.88-4.27 5.63-8.9 13.68-21.6 45.34-22.9 34.3-1.42 46.78 21.66 51.21 29.87.38.7.7 1.3.97 1.75 2.67 4.53 2.78 9.75 2.9 14.91.05 2.71.11 5.41.54 8 .47 2.84 1.54 2.78 2.13.23 1-4.33 1.47-8.83 1.15-13.28-.72-10.05-4.4-36.45-24.6-48.15a65.52 65.52 0 0 0-16.18-6.73Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","curly":"<path d=\"M67 105.02c11.38-.72 24.68-14.4 31.98-33.94C108.78 72.94 120.04 74 132 74c12.55 0 24.31-1.16 34.45-3.2 7.38 19.96 21.01 33.87 32.55 34.24V88a66 66 0 0 0-38-59.78A183.64 183.64 0 0 0 132 26c-9.2 0-17.99.63-26.02 1.76A66.01 66.01 0 0 0 67 88v17.02Z\" fill=\"#000\" fill-opacity=\".16\"/><path d=\"M73 192a48 48 0 0 0 13.6-1.95 72.08 72.08 0 0 0 13.68 9.1c1.56-.1 3.13-.15 4.72-.15h4v-18.39a56.03 56.03 0 0 1-31.8-45.74A12 12 0 0 1 67 123v-13a12 12 0 0 1 10-11.83v-.75c8.46-5.38 16.75-16.36 21.98-30.34C108.78 68.94 120.04 70 132 70c12.55 0 24.31-1.16 34.45-3.2C171.76 81.17 180.32 92.4 189 97.7v.46c.44.07.87.17 1.29.29a24.4 24.4 0 0 0 3.23 1.47A11.99 11.99 0 0 1 199 110v13a12 12 0 0 1-10.2 11.87A56.03 56.03 0 0 1 157 180.6V199h4c1.59 0 3.16.05 4.72.15a72.08 72.08 0 0 0 13.69-9.1 48 48 0 0 0 45.19-82.18 44.01 44.01 0 0 0-28.37-69.28A44.02 44.02 0 0 0 133 15.9a44.02 44.02 0 0 0-63.23 22.7 44.01 44.01 0 0 0-28.37 69.27A48 48 0 0 0 73 192Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","curvy":"<path d=\"M89.4 84.2c-4.88 1.3-9.65 2.78-14.4 4.34-11.13 3.64-6.68-6.1-3-14.04l111.79-9.52c6.02 7.33 24.82 41 7.12 27-3.1-2.45-9.57-4.45-12.66-7.27-2.34-2.12-5.16-1.78-6.28-4.48l-2.55.9a375.12 375.12 0 0 1-11.97-4.12l-.55-1.07-1.67.64-9.12-.33c-2.63-.03-13.73.22-16.28.43 0 0-1.23-.92-2.94-2.68l-1.33 3.22s-11.92 1.8-14.08 1.96l-1.06-1.95-2.74 2.97c-3.9.9-13.84 2.83-18.3 4.01Z\" fill=\"#000\" fill-opacity=\".16\"/><path d=\"M48.6 123.04c-5.7-17.86 2.75-37.13 11.12-47.27 1.48-1.8 3.06-5.11 5.06-9.3 8.34-17.47 23.9-50.05 69.8-50.27 49.93-.24 59.75 36.02 63.66 50.43 1.64 6.08 4.55 11.59 7.38 17.21 4 8 8.4 16.74 9.9 23.05 1.09 4.54 1.7 9.05 1.17 13.7-.12 1.06-1.08 4.22-.48 4.85.54.57 1.88 1.15 3.1 1.67 9.01 3.9 16.1 10.4 19.8 19.62 4.71 11.72-.99 25.47-11.26 32.17-1.4.9-.74 2.7-.76 4.1a74.22 74.22 0 0 1-4.33 23.5c-1.42 3.94-3.17 7.92-6.53 10.98-2.85 2.58-6.94 4.42-10.86 5.52-1.35.38-1.33.78-1.41 1.17-1.15 5.76 2.7 13.12 4.6 18.56 1.5 4.29 3 8.59 3.8 13 1.18 6.42-3.02 27.82-14.12 22.8 5.52-2.64 5.76-8.26 3.88-9.84-4.34-3.62-11.76-1.59-16.9-.74-3.7.61-7.63 1.25-11.15.43a31.34 31.34 0 0 1-10.6-4.84c-17.65-13.97-13.84-37.04 1.07-64.4l-.55-.03c-1.1-.06-1.67-.1-3-.1h-4v-18.39A56 56 0 0 0 189 130V92c0-1.47-.05-2.94-.16-4.38a68.09 68.09 0 0 0-3.66-1.86c-2.58-1.24-5.24-2.53-6.91-4.05a10.2 10.2 0 0 0-3-1.76c-1.39-.6-2.62-1.14-3.28-2.72l-2.55.9a373.94 373.94 0 0 1-11.97-4.12l-.55-1.07-1.67.64-9.12-.33c-2.63-.03-13.73.22-16.28.43 0 0-1.23-.92-2.94-2.68l-1.33 3.22s-11.92 1.8-14.08 1.96l-1.06-1.95-2.74 2.97c-1.43.33-3.66.8-6.13 1.31-4.3.9-9.34 1.95-12.17 2.7a248.15 248.15 0 0 0-11.93 3.53c-.31 2.38-.47 4.8-.47 7.27v38a56 56 0 0 0 32 50.61V199h-4a72.2 72.2 0 0 0-16.4 1.87c-.1.17-.22.32-.32.5-4.78 6.95-13.87 12.39-17.46 19.5-1.47 2.9.19 7.82 1.66 10.55 3.2 5.9 11.15 8.66 19.52 7.33-2.53 2.12-7.55 3.82-10.95 3.94-4.63.17-10.29-1.62-14.26-3.58.6 3.6 2.68 5.62 4.62 8.6-5.52-.28-10.88-7.06-12.68-12.05-2.2 4.51-3.44 16.64-2.35 20.03-14.14-6.34-25.13-19.44-24.3-35.66.54-10.56 7.15-18.9 9.48-28.9.46-1.96.14-2.38-1.05-3.94l-.05-.07c-4.38-5.73-9.62-10.69-12.43-17.48-2.54-6.13-2.63-13.18-.64-19.5 2.21-7.08 9.06-14.16 14.84-20.14a105.5 105.5 0 0 0 6.37-6.95Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"m164.5 199.2.26-.06s4.44-9.02 11.25-17.38c-1.33-10.43 5.86-23.71 5.86-23.71l-.35-.08A56.25 56.25 0 0 1 157 180.62V199h4c1.32 0 1.88.04 3 .1l.54.04-.04.07ZM82.27 153.74l-.14.06c6.02 9.99 13.63 36.95 6.55 46.66l.25.34A72.25 72.25 0 0 1 105 199h4v-18.39a56.23 56.23 0 0 1-26.73-26.87Z\" fill=\"#000\" fill-opacity=\".24\"/><g fill=\"#fff\" fill-opacity=\".6\"><path d=\"M118.38 50.37c1.51-1.85 2.89-3.83 3.5-6.16.23-.87.47-1.77.89-2.3-4.76 4.99-8.8 9.91-12.3 15.63.77-1.02 2.73-2.02 3.76-2.91a34.94 34.94 0 0 0 4.15-4.25ZM171.5 41.98c-.3 3.5.47 6.94.63 10.4 0-.34.34-.92.65-1.47a6.98 6.98 0 0 0 .92-4.42c-.14-1-.55-1.95-1.07-2.85-.2-.36-1.12-1.33-1.12-1.66ZM56.4 120.38a88.61 88.61 0 0 0 4.47 18c2.06 5.72 4.42 11.46 7.8 16.69 3.17 4.87 6.93 9.42 9.96 14.36-.46-.55-1.22-1.17-1.9-1.73-.49-.4-.94-.76-1.2-1.05-3.23-3.4-5.82-7.2-8.29-11.04-3.25-5.07-5.69-10.58-7.8-16.08-4.14-10.78-8.3-23.85-4.7-35.24-.2.77.5 2.43.6 3.2.62 4.27.48 8.6 1.07 12.88ZM54.77 104.2a.76.76 0 0 0-.02.09l.02-.09ZM78.63 169.43c.5.58.35.56 0 0ZM68.86 165.04c-2.46-3.54-5.05-7.16-7.09-10.9-1.78-3.27-3.05-6.85-5.29-9.85-.32-.44-.72-.97-.8-1.32.68 6.15 3.45 12.74 7.73 17.3 1.56 1.67 4.09 3.04 5.45 4.77ZM64.08 171.32c3.55 3.82 6.94 7.76 9.45 12.18 1.75 3.07 3.22 6.64 3.46 10.21.04.53.08 1.2.2 1.57-2.22-4.29-3.91-8.83-6.55-12.94-2.6-4.05-5.95-7.78-9.44-11.28-3.7-3.7-7.41-7.18-9.4-11.85a25.53 25.53 0 0 1-1.99-12.55c.02 1.24.76 2.82 1.44 4.28 1.47 3.14 2.07 6.6 3.67 9.7 2.13 4.08 5.96 7.24 9.17 10.68ZM59.23 174.18c-.5-.49-2.41-1.69-2.75-2.3l-.03-.06.03.06c.7 1.5 1.48 2.95 2.22 4.43 1.53 3.08 3.71 5.71 5.93 8.4l1.08 1.3c-.8-1.02-1.02-3.29-1.53-4.5a21.43 21.43 0 0 0-4.95-7.33ZM48.9 180.53a83.67 83.67 0 0 0 3.73 5.02c1.9 2.43 3.8 4.86 5.25 7.5 2.83 5.2 4.07 10.81 4.32 16.55.12 2.7.12 5.46-.25 8.16-.24 1.77-.54 3.6-1.22 5.25-.25.6-.54 1.32-.63 1.84-.06-2.32-.03-4.64 0-6.95.13-8.2.25-16.3-4.02-23.96-1.58-2.83-3.68-5.4-5.78-7.99a90.37 90.37 0 0 1-3.9-5.02c-2.78-3.96-5.5-7.85-7.72-12.08 1.36 1.72 3.8 3.07 5.32 4.77 1.9 2.13 3.35 4.58 4.9 6.9Z\"/><path d=\"M60.1 224.85c-.08.53.01.4 0 0ZM50.54 204l.02-1.5c0 .5.82 1.51 1.04 2.03 1.61 3.75 1.57 7.5.09 11.32-1.9 4.9-4.88 9.25-8.62 13.3.83-1.09 1.35-2.6 1.85-4.06 1.01-2.94 2.6-5.62 3.8-8.49 1.68-4.01 1.73-8.32 1.81-12.6ZM41.92 221.2a9.46 9.46 0 0 0 2.25-4.13c.2-.9-.41-2.68 0-3.38a13.66 13.66 0 0 0-1.85 3.64c-.2.69 0 3.32-.4 3.87ZM84.86 64.32a63.3 63.3 0 0 0 9.77-11.2 34.6 34.6 0 0 0 3.22-5.6c.13-.28.3-.87.48-1.54.3-1.09.65-2.4 1.04-2.97-2.7 2.9-4.84 6-7.03 9.17-1.45 2.12-2.99 4.18-4.34 6.37-.36.58-.68 1.35-1.03 2.14-.59 1.37-1.22 2.83-2.1 3.63ZM83.84 55.69c.14-.62.27-1.22.47-1.57.75-1.32 1.9-2.45 3.18-3.41-.35.3-.58 1.16-.79 1.95-.15.54-.28 1.05-.44 1.33a15.8 15.8 0 0 1-3.17 3.75c.36-.35.56-1.22.74-2.04ZM83.07 57.75l.03-.02-.03.02ZM203.8 150.6c.6-3.33 1.25-6.84 2.94-9.84.76-1.36 1.68-2.68 2.6-3.98.48-.7.94-1.38 1.35-2.11.66-1.16 1.46-2.56 2.26-3.03-4.16 2.43-7.42 5.54-9.16 9.64-.88 2.07-1.2 4.2-1.09 6.39.08 1.57.76 3.24.77 4.77.08-.62.2-1.23.32-1.85ZM202 130.48a22.88 22.88 0 0 1-1 3.63 25.14 25.14 0 0 1-1.77 3.74c-.43.75-1.98 2.32-1.98 3.15-.09-4.9 1.73-9.33 5.17-13.25-.38.65-.28 2.03-.42 2.74ZM201.2 165.72c2.28-.03 4.82 2.52 6.51 4.22 2.42 2.43 5.14 4.56 7.2 7.31l.06.07-.05-.07c-.68-.96-.7-2.74-1.23-3.85-.72-1.5-1.82-2.9-3.06-4.13-2.32-2.29-5.77-4.07-9.42-3.55ZM200.42 176.1c-.18-.06-1.78-.52-2.28-.35.59-.26 1.3-.57 1.93-.65 4.28-.57 9.5 3.14 10.07 6.72-.48-1.23-3.03-2.24-4.18-2.85-1.82-.97-3.56-2.14-5.54-2.87ZM198.14 175.75l-.06.03.03-.02h.03ZM202.23 183.9a7.6 7.6 0 0 0-3.79-.13c-.47.13-1.44.42-1.56.39 2.82.66 5.47.98 8.4.91-.44 0-1.16-.34-1.84-.66-.47-.22-.9-.43-1.21-.5ZM191.01 197.76c-.13 0-.13.01 0 0ZM191.01 197.76c4.26-.22 9.25.4 13.3 1.42a22.3 22.3 0 0 1 5.7 2.3c1.4.81 3.93 1.93 4.87 3.13-3.74-6.44-11.85-9.79-20.16-8.13-1.06.22-2.67 1.2-3.7 1.29ZM192.76 210.27c3.23.42 6.55-.07 9.77-.44 1.38-.15 3.03-.86 4.38-.49a23.55 23.55 0 0 0-8.4-1.17c-2.93.13-5.9 1.06-8.59 2.03.68-.2 1.81-.06 2.84.07ZM179.36 220.67c-.06 2.23-.04 4.52.1 6.74.25 3.97 2.55 7.44 5.93 10.08a32.36 32.36 0 0 0 4.34 2.72c2.51 1.39 5 2.76 6.63 5.1 2.15 3.1 2.33 6.96.82 10.36-.25.56-.51 1.16-.52 1.58v-.05c.03-3.87.07-8.36-2.64-11.6-1.59-1.9-3.87-3.1-6.16-4.29-1.63-.85-3.28-1.7-4.67-2.83-3.27-2.64-5.76-6.1-6.32-9.98-.45-3.13-.23-8.58 2.98-10.73-.6.45-.48 2.35-.5 2.9ZM179.9 217.74a.43.43 0 0 0-.04.03l.05-.03ZM177 242.67l.08.08a.69.69 0 0 1-.07-.08ZM188.15 255.52c-.2-5.11-3.7-8.96-7.94-11.34-.6-.34-2.6-.93-3.13-1.43 2.96 3.24 6.32 6.21 8.96 9.73.46.6 2.06 2.3 2.11 3.04ZM188.15 255.55v-.03.03ZM229.17 153.8a11.45 11.45 0 0 1 2.67 3.7 12.62 12.62 0 0 1 .6 10c.14-.52-.15-1.47-.38-2.22-.55-1.76-1.07-3.5-1.76-5.22-1.18-2.91-2.14-5.64-4.18-8.2.54.67 2.32 1.3 3.05 1.93ZM179.15 48.8a5.72 5.72 0 0 1-.97 3.75c.09-.2-.12-1.1-.28-1.84-.34-1.47-.14-2.96-.04-4.47 0 .64 1.18 1.77 1.29 2.57ZM127.57 50.07c-.73 1.16-2 2.11-3.3 2.78.58-.33 1.1-2 1.54-2.55.73-.94 1.63-1.84 2.58-2.63-.21.22-.61 2.05-.83 2.4Z\"/></g>","dreads":"<path d=\"M242.13 168.86c4.84 6.8 11.1 14 12.25 22.06.45 3.2.7 16.23-7.54 11.43-.27 4.36-.97 4.98.34 9.2.88 2.86 2.08 8.62-3.87 8.1 2.26 6.17 5.88 14.76 2.48 21.16-5.58 10.51-11.89-2.74-13.57-7.49.1 3.28-3.42 9.2-7.84 4.63.35 5.42 2.52 13.78-.66 18.86-6.16 9.85-12.97-2.62-13.2-7.9-1.11 3.56-.28 12.14-7.6 10.15-6.32-1.71-4.03-10.09-2.8-13.87-2.02 3.56-4.5 8.85-4.88 12.87-.34 3.45 2.94 11.57-5.55 10.05-6.52-1.17-6.76-10.9-6.65-15.18.1-3.48 3.46-11.43 1.18-14.25-12.73 5.34.6 23.3-10.95 27.3-3.84 1.32-7.04-1.18-8.32-4.64.4-1.7-.36-2.56-2.28-2.6-1.21-1.49-2.01-1.44-2.8-3.66-2.31-6.52 2.2-15.19 5.43-21-3.35 3.05-6.05 7.25-9.7 9.91-2.45 1.8-6.08 2.31-8.38-.17-2.51-2.73-.13-5.34 1.22-7.82 3-5.49 7.73-8.68 12.67-13.08 4.33-3.85 8.18-8.18 12.01-12.37 2.57-2.8 5.01-5.8 7.06-8.97A72.1 72.1 0 0 0 161 199h-4v-18.39a56.24 56.24 0 0 0 25.8-24.98c.1-3.28.28-7.11.47-11.2.54-12.09 1.19-26.4.48-35.34l-.2-2.58c-1.12-14.36-1.8-23.03-12-36.06-4.56-5.83-13.18-7.67-21.72-9.5-8.09-1.73-16.1-3.45-20.51-8.51-4.13 4.78-10.14 7.32-16.74 8.99-1.45.37-2.9.67-4.34.96-4.98 1.03-9.7 2-13.08 5.6-7.8 8.32-11.23 13.88-13.62 24.26A116.55 116.55 0 0 0 79 126.83c.13 1.88.22 3.78.32 5.69.35 7.1.71 14.32 2.9 21.1a56.23 56.23 0 0 0 26.78 27V199h-4c-1.1 0-2.2.03-3.28.07.67 3.44 1.09 6.93.81 10.34-.4 5-1.34 9.66-.85 14.7 1.04 10.52 5.41 20.5 9.02 30.52 1.73 4.82 9.36 10.49 6.23 14.46-3.13 3.98-13.81-5.47-16.2-10.05-2.44-4.66-4.65-9.4-7.18-14.03 1.48 6.46 2.77 13.1 4.8 19.41 1.36 4.27 3.43 10.72-2.28 11.94-8.95 1.91-9.3-12.58-10.18-16.9-1.47-7.19-3.1-9.98-5.5-16.97-.49 5.34.34 10.9-.81 16.2-.7 3.19-4.36 5.83-6.56 8.53-7.53 9.28-9.32-6.28-11.23-10.55-3.3 2.4-10.5 7.16-14.9 4.14-3.26-2.23-1.2-6.27-.44-9.03 1.22-4.45 1.94-8.85-1.31-12.87-3.1 3-9.92 4.75-13.88 1.88-5-3.63-.62-8.94 1.63-12.7 4.33-7.26 4.07-15.87 5.44-23.94.46-2.7 1.06-6.26.3-8.12-1.1-2.68-2.3-2.7-4.74-2.1-3.45.87-6.29 2.8-6.87 5.58-.84 4.03 3.57 5.62 3.93 9.12.77 7.55-8.7 4-11.53.62-6.95-8.36-1.26-18.23 4.21-25.56 1.87-2.5 2.4-3.22 2.02-6.48-.77-6.41-2.5-12.18-1.88-18.72.86-8.97 4.3-17.44 9.35-24.82 3.46-5.06 5.29-9.45 5.79-15.57 1.41-17.39 7.32-35.28 15.05-50.74 3.97-7.93 7.96-16.5 14.83-22.4 2.23-1.91 6.24-2.8 8.17-4.65 3.56-3.43.44-9.5 4.95-13.39 3.78-3.25 8.17-2.17 12.28-3.93 4.21-1.81 5.11-7.42 10.21-8.61 5.16-1.2 9.29 2.18 13.66 3.8 6.43 2.38 10.45 1.69 16.76-.3l.08-.03c4.2-1.33 6.95-2.2 10.89.1 2.55 1.5 4.52 5.95 7.65 6.37 3.8.52 9.14-3.04 13.35-2.9 6.45.2 9.59 4.24 12.25 8.55 1.55 2.5 4.4 3.67 6.1 6.15.62.9 1.24 1.8 2.13 2.61 6.31 5.77 14.58 10.25 21.37 15.68 12.66 10.15 15.66 23.88 16.48 37.83.66 11.18-.37 24.31 6.74 34.31 3.71 5.22 7.82 9.73 10.02 15.85.78 2.19 1.85 5.2.51 7.12-1.8 2.58-6.36 2.6-8.31.14-1.9 5.87 4.57 14.35 8.03 19.22Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M182.5 156.2c-.07 3 0 5.98.38 8.86.33 2.5.84 4.91 1.34 7.31 1.13 5.33 2.23 10.56 1.3 16.27-.75 4.53-2.73 8.87-5.36 12.94A72.09 72.09 0 0 0 161 199h-4v-18.39a56.24 56.24 0 0 0 25.5-24.4ZM101.72 199.07a125 125 0 0 0-1.23-5.48c-2.14-8.82-6.42-16.63-10.77-24.55-1.9-3.46-3.8-6.94-5.56-10.53a37.08 37.08 0 0 1-1.95-4.89 56.23 56.23 0 0 0 26.8 27V199h-4c-1.1 0-2.2.03-3.28.07Z\" fill=\"#000\" fill-opacity=\".24\"/><path d=\"M102.48 33.5c-1.67 0-12.16 4.75-8.24 6.16 2.4.86 12.5-6.15 8.24-6.15ZM171.05 47.36c-.85.38-.83.73.04 1.07.85-.38.83-.74-.04-1.07ZM195.51 65.6a26.84 26.84 0 0 0-1.37-2.76c-.89-1.27-6.24-8.4-2.47-7.5 2.08.48 4.89 6.17 6.15 8.74.78 1.57 4.28 7.12.72 6.75-.63-.07-1.95-2.92-3.03-5.23ZM204.02 110.75c-.15-1.17.25-4.76-2.46-3.42-1.8.9.67 11.72.82 13.13l.46 3.95v.03c.6 6.07 1.42 12.1 1.33 18.23-.01.76-1.2 6.66 1.55 5.4 1.46-.66.78-8.74.57-11.2-.74-8.72-1.11-17.46-2.27-26.12ZM65.36 122.25c.08 1.58-.7 9.75 1.43 9.8 1.83.04 1.24-8.4 1-11.83-.08-1.08-.08-11.14-2.1-9.91-2.32 1.4-.46 9.52-.34 11.94ZM73.8 180c0-1.43.82-14.45-1.9-11.38-1.37 1.54-.48 7.02-.35 8.88.05.7-.52 2.86.41 3.19.76.26 1.83.32 1.84-.7ZM48.12 193.16c1.93-.05.14-37.83-2.82-37.79-2.08.03 1.36 37.83 2.82 37.8ZM50.35 212.52c-2.4 0-1.95 8.46-.54 9.13 2.14 1.03 3.23-9.13.54-9.13ZM65.59 216.06c.02 1.05-1.18 1.07-1.98.74-.72-.3-.63-2.31-.58-3.49.05-1.1-.15-2.2-.31-3.29-.5-3.38-1.26-8.48.04-9.65 1.98-1.78 2.02.17 2.55 1.5 1.56 3.9.2 10.03.28 14.19ZM203.02 169.59c-2.53-.5-3.85 8.1-2.7 9.01 1.92 1.53 5.35-8.49 2.7-9.01ZM202.75 207.38c-1.13-.22-9.43 15.74-8.75 16.64 1.3 1.72 12.83-15.82 8.75-16.64ZM182.33 214.76c-1.78-.8-9.33 10.75-7.4 11.62 1.75.78 9.56-10.65 7.4-11.62ZM224.43 171.45c-2.16 0-2.06 11.82-.4 12.56 1.7.78 2.94-12.56.4-12.56ZM83.51 54.2c1.26-.65 5.45-.87 3.1 1.29-2 1.84-9.53 12.51-12.12 12.62-4.22.18 2.59-7.24 4.76-9.6 1.33-1.45 2.49-3.41 4.26-4.32ZM59.25 83.98c-2.18-.43-5.83 10.27-4.56 11.56 1.93 1.95 7.01-11.07 4.56-11.56ZM81.4 201.85c.48-2.6 2.38-.2 2.8 1.14.4 1.34 4.62 11.08 3.56 12.36-1.63 1.97-2.34-1.37-2.9-2.57-1.31-2.83-3.92-8.43-3.46-10.93ZM75.99 225.82c-2.3 0-2.03 9.8-.67 10.38 2.12.9 3.48-10.38.67-10.38ZM232.81 203.88a58.4 58.4 0 0 1 4.98 13.57c.14.6 2.06 5.56-.66 4.84-1.56-.41-1.8-4.78-2.2-6.1a32.5 32.5 0 0 0-2.58-5.56c-1.41-2.63-2.85-5.31-3.06-7.64-.33-3.9 1.84-2.42 3.52.89ZM218.09 216.95c-2.13 0-2.24 10.77-.9 11.4 1.86.88 3.62-11.4.9-11.4ZM224.25 128.65c1.58-.4-3.4-13.32-5.18-13.18-2.7.22 2.78 13.8 5.18 13.18ZM197.43 184.75c-.84.38-.83.74.05 1.07.84-.38.83-.74-.05-1.07ZM173.22 239.99c.79 0 1.12-1.23-.06-1.25-.77 0-1.18 1.25.06 1.25ZM74.68 184.63c.03-1.9-2.46-.5-2.45 1.1.03 3.21 2.4 1.75 2.45-1.1ZM68.52 136.88c-.8 0-1.13 1.24.05 1.27.78 0 1.2-1.27-.05-1.27ZM47.78 199.44c-.1 0 1.53-1.99 1.6-.05.07 1.47-1.31.06-1.6.05ZM53.6 98.06c-2.37 0-2.02 5.76-.51 6.13 2.52.61 2.86-6.13.5-6.13ZM66.21 222.33c-2.28 0-2.44 7.8-.86 8.3 2.45.75 3.24-8.3.86-8.3ZM47.46 227.93c-.88.4-.86.76.04 1.1.87-.39.86-.75-.04-1.1ZM217.46 231.28c-2.32 0-2.23 9.56-.8 10.2 1.98.9 3.48-10.2.8-10.2ZM193.95 240.16c-2.41-.48-3.68 7.4-2.55 8.3 1.85 1.45 5.02-7.8 2.55-8.3ZM173.47 247.45c-2 0-1.51 3.58-.36 4.1 2 .93 2.6-4.1.37-4.1Z\" fill=\"#fff\" fill-opacity=\".3\"/>","frida":"<path d=\"M77 98.17v-.23l.08.06c1.7-27.45 17.84-33.2 32.51-38.41 10.53-3.75 20.3-7.22 23.4-18.25 3.12 11.03 12.89 14.5 23.42 18.25 14.67 5.22 30.82 10.96 32.5 38.41l.1-.06v.23a12 12 0 0 1 9.88 10.22 16.43 16.43 0 0 0 2.97-16.92 16.49 16.49 0 0 0-2.46-25.86 16.5 16.5 0 0 0-10.62-23.04 20.5 20.5 0 0 0-27.73-22.16A20.47 20.47 0 0 0 133 15.52a20.47 20.47 0 0 0-28.05 4.87 20.5 20.5 0 0 0-27.73 22.16A16.5 16.5 0 0 0 66.2 64.7a16.5 16.5 0 0 0-2.51 28.07 16.5 16.5 0 0 0 3.4 15.62A12 12 0 0 1 77 98.17ZM77.2 134.87c-3.85-.58-7.11-3-8.85-6.34a16.5 16.5 0 0 0 8.2 25.71 16.52 16.52 0 0 0 14.76 20.72A16.5 16.5 0 0 0 109 184.8v-4.2a56.03 56.03 0 0 1-31.8-45.74ZM157 180.61v4.2a16.5 16.5 0 0 0 17.69-9.85 16.5 16.5 0 0 0 14.76-20.71 16.5 16.5 0 0 0 8.2-25.72c-1.74 3.34-5 5.76-8.86 6.34A56.03 56.03 0 0 1 157 180.6Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M170.12 28.36c-.4.12-.77.27-1.13.45-.17-.5-.38-1-.62-1.48 3.72-3.63 5.25-9.54 5.25-9.54s-1.16.2-3.1.64c-.27.04-3.78.6-8.24 2.31-.8-.58-1.54-1.04-2.1-1.38.52-2.93 1.68-12.56-4.46-16.11-6.1-3.54-13.8 2.2-16.12 4.14l-.7-.42c-3.07-1.77-10.77-5.35-16.05-.23-5.64 5.46-2.31 14-1.04 16.7l-.55.53a7.14 7.14 0 0 0-8.17-1.63l-2.13.93-1.38-1.88a7.24 7.24 0 0 0-8.29-2.54c-2.69.94-4.49 3.2-4.8 6.05l-.26 2.32-2.32.25a7.12 7.12 0 0 0-6.05 4.81 7.22 7.22 0 0 0 .83 6.53 4.2 4.2 0 0 0-2.74.06c.27-.4.48-.77.59-1.13a5.2 5.2 0 0 0-9.95-3.04c-.1.36-.15.8-.14 1.27-.3-.38-.59-.7-.9-.91a5.2 5.2 0 0 0-5.96 8.52c.3.21.7.38 1.16.53-.45.15-.84.34-1.14.56a5.17 5.17 0 0 0-1.02 7.29 5.16 5.16 0 0 0 7.28 1.02c.3-.22.58-.55.86-.93 0 .47.07.9.19 1.25a5.2 5.2 0 0 0 9.83-3.39 4.23 4.23 0 0 0-.62-1.1c.45.15.88.22 1.25.22a5.18 5.18 0 0 0 3.36-1.32 7.2 7.2 0 0 0 2.13 4.44 7.15 7.15 0 0 0 8.06 1.52l2.13-.93 1.38 1.88c.29.38.6.74.94 1.05-.52.51-1.06 1-1.64 1.44-.47-.3-1.12-.7-1.92-1.06a11.98 11.98 0 0 0-13.25 1.82C84.62 61.46 83 67.7 83 67.7s7.37 4.17 15.26.42c5.9-2.8 6.53-7.22 6.48-9.26.78-.64 1.54-1.33 2.26-2.07a7.27 7.27 0 0 0 5.72.36 7.12 7.12 0 0 0 4.8-6.05l.26-2.32 2.32-.26a7.11 7.11 0 0 0 5.3-3.24c2.57.32 4.97.13 6.2-.01.99 1.88 3.82 6.71 7.88 9.06a9.1 9.1 0 0 0 5.07 1.33c6.9-.36 9.92-10 10.67-12.92.64-.09 1.6-.24 2.71-.51a7.36 7.36 0 0 0 .15 8.25 7.4 7.4 0 0 0 5.93 3.16c.53 0 1.14-.1 1.78-.3-.4.55-.7 1.07-.88 1.58a7.4 7.4 0 0 0 13.65 5.65l.34.62c-.71 1.48-3.8 8.96 5.53 12.36 6.77 2.46 13.45-1.15 13.5-1.17 0 0-2.07-9.48-9.46-12.55a7.38 7.38 0 0 0 3.7-7.5 7.35 7.35 0 0 0-2.87-4.87 6.05 6.05 0 0 0-1.62-.8c.64-.21 1.21-.45 1.65-.76a7.4 7.4 0 0 0-8.5-12.12c-.43.3-.85.76-1.26 1.3 0-.68-.05-1.3-.2-1.81a7.35 7.35 0 0 0-3.6-4.37 7.36 7.36 0 0 0-5.65-.54Zm-4.08 10.84a8.2 8.2 0 0 0-.73-.22l.4-.3c.1.17.2.34.33.52Zm14.35 20.08.48.33c-.36.17-.67.35-.93.52-.33-.6-.6-1.15-.8-1.65.02-.17.03-.35.03-.53a6 6 0 0 0 1.22 1.33ZM92.2 42.12l-.12-.32.2.15-.08.17Z\" fill=\"#000\" fill-opacity=\".2\"/><path d=\"M179.03 58.94s-4.98 8.83 5.4 12.6c6.8 2.48 13.5-1.16 13.5-1.16s-2.16-9.9-9.97-12.75c-6.1-2.22-8.93 1.3-8.93 1.3Z\" fill=\"#3f7d52\"/><path d=\"M197.93 70.38s-2.16-9.9-9.97-12.75c-4.07-1.48-6.7-.39-8.02.5-1.36-2.4-1.47-4.18-1.45-4.25.03-.3-.2-.53-.46-.63-.07-.02-.2-.07-.3-.03-.39.01-.67.37-.66.75 0 .23.35 4.54 4.63 8.83 6.05 6.6 16.23 7.58 16.23 7.58Z\" fill=\"#2f5d3b\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M166.22 27c5.28-3.06 7.4-11.2 7.4-11.2s-7.38-4.18-15.26-.43c-7.89 3.74-6.37 10.37-6.37 10.37s6.61 5.65 14.23 1.25Z\" fill=\"#3f7d52\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M148 29.43c.05.08.1.17.24.2.42.34 1.09.3 1.42-.12a23.68 23.68 0 0 1 3.26-3.15c1.97 1.41 7.33 4.1 13.3.64 5.28-3.06 7.4-11.2 7.4-11.2s-1.16.2-3.1.63c-.54.07-14.38 2.3-22.36 11.87a.96.96 0 0 0-.16 1.13Z\" fill=\"#2f5d3b\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M90.4 54.5C85.1 57.55 83 65.7 83 65.7s7.37 4.17 15.26.42c7.88-3.74 6.36-10.37 6.36-10.37s-6.6-5.65-14.23-1.25Z\" fill=\"#3f7d52\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M108.61 52.06c-.05-.08-.1-.17-.23-.2-.42-.34-1.1-.3-1.43.12a23.6 23.6 0 0 1-3.26 3.16c-1.97-1.41-7.32-4.1-13.3-.64-5.28 3.05-7.4 11.2-7.4 11.2s1.16-.2 3.1-.64c.54-.07 14.39-2.3 22.37-11.87.3-.3.35-.8.15-1.14Z\" fill=\"#2f5d3b\"/><path d=\"M68.58 49.96a5.17 5.17 0 0 1 1.02-7.29c.3-.22.7-.4 1.14-.56a4.26 4.26 0 0 1-1.16-.53 5.2 5.2 0 0 1 5.96-8.52c.31.21.6.53.9.91 0-.47.03-.9.14-1.27a5.16 5.16 0 0 1 6.5-3.45 5.2 5.2 0 0 1 3.45 6.5c-.11.35-.32.73-.59 1.12.45-.15.87-.24 1.25-.25a5.2 5.2 0 0 1 .18 10.4c-.37 0-.8-.07-1.25-.2.28.37.5.74.62 1.1a5.2 5.2 0 1 1-9.83 3.38 4.23 4.23 0 0 1-.2-1.25c-.27.38-.55.7-.85.93a5.17 5.17 0 0 1-7.28-1.02Z\" fill=\"#35858b\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M81.82 37.64a1.44 1.44 0 1 0-2.76-.84c-.23.76.23 4.18.23 4.18s2.3-2.58 2.53-3.34Zm2.24 5.8a1.44 1.44 0 1 0-.05-2.9c-.8.02-3.9 1.52-3.9 1.52s3.16 1.4 3.95 1.38Zm-6.05-2.02s-1.74-2.98-2.4-3.44a1.44 1.44 0 1 0-1.65 2.37c.65.45 4.05 1.07 4.05 1.07Zm3.07 6.84a1.44 1.44 0 0 0 .9-1.84c-.26-.75-2.65-3.25-2.65-3.25s-.35 3.44-.09 4.2a1.44 1.44 0 0 0 1.84.89Zm-5.32-1.96c.64-.48 2.27-3.52 2.27-3.52s-3.37.73-4 1.2a1.44 1.44 0 1 0 1.73 2.32Z\" fill=\"#fff\"/><path d=\"m117.53 49.1.25-2.32 2.32-.26a7.12 7.12 0 0 0 6.05-4.8 7.23 7.23 0 0 0-2.55-8.29l-1.87-1.38.93-2.13c1.23-2.8.65-5.9-1.52-8.06a7.14 7.14 0 0 0-8.06-1.52l-2.13.93-1.38-1.88a7.24 7.24 0 0 0-8.29-2.54c-2.69.94-4.49 3.2-4.8 6.05l-.26 2.32-2.32.25a7.12 7.12 0 0 0-6.05 4.81 7.2 7.2 0 0 0 1.67 7.53c.27.27.56.52.87.76l1.88 1.38-.93 2.13a7.15 7.15 0 0 0 1.52 8.06 7.15 7.15 0 0 0 8.06 1.52l2.13-.93 1.38 1.88a7.23 7.23 0 0 0 8.29 2.54 7.12 7.12 0 0 0 4.8-6.05Z\" fill=\"#e6a68a\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M109.88 41.2a1.44 1.44 0 1 1-2.78.74c-.2-.77-.1-5.94-.1-5.94s-2.5 4.53-3.06 5.1a1.44 1.44 0 0 1-2.03-2.05c.56-.56 5.1-3.05 5.1-3.05s-5.17.1-5.94-.1a1.44 1.44 0 0 1 .75-2.78c.77.2 5.19 2.88 5.19 2.88s-2.68-4.42-2.88-5.2a1.44 1.44 0 1 1 2.78-.74c.2.77.1 5.94.1 5.94s2.5-4.53 3.05-5.1a1.44 1.44 0 0 1 2.04 2.05c-.56.56-5.1 3.05-5.1 3.05s5.17-.1 5.94.1a1.44 1.44 0 1 1-.75 2.78C111.42 38.68 107 36 107 36s2.67 4.42 2.88 5.2Z\" fill=\"#fff\"/><path d=\"M190.76 55.82a7.36 7.36 0 0 0-1.46-10.36 6.06 6.06 0 0 0-1.62-.8c.64-.21 1.21-.45 1.65-.76a7.4 7.4 0 0 0-8.5-12.12c-.43.3-.85.75-1.26 1.3 0-.68-.05-1.3-.2-1.81a7.35 7.35 0 0 0-3.6-4.37 7.4 7.4 0 0 0-10.55 8.7c.15.5.44 1.04.82 1.6a6 6 0 0 0-1.77-.36 7.4 7.4 0 0 0-.26 14.8c.53 0 1.14-.1 1.78-.3-.4.55-.7 1.07-.88 1.58a7.4 7.4 0 0 0 14 4.81 6 6 0 0 0 .26-1.78c.4.55.8 1 1.22 1.33a7.35 7.35 0 0 0 5.49 1.42 7.35 7.35 0 0 0 4.88-2.88Z\" fill=\"#D99B26\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M171.9 38.3a2.05 2.05 0 1 1 3.94-1.2c.33 1.08-.33 5.94-.33 5.94s-3.27-3.66-3.6-4.74Zm-3.18 8.25a2.06 2.06 0 1 1 .07-4.11c1.13.02 5.56 2.15 5.56 2.15s-4.5 1.97-5.63 1.96Zm8.62-2.88s2.47-4.24 3.4-4.89a2.06 2.06 0 1 1 2.36 3.37c-.93.65-5.76 1.52-5.76 1.52Zm-4.38 9.73a2.06 2.06 0 0 1-1.27-2.6c.37-1.08 3.76-4.63 3.76-4.63s.5 4.89.13 5.96a2.06 2.06 0 0 1-2.62 1.27Zm7.57-2.79c-.9-.68-3.23-5-3.23-5s4.8 1.04 5.7 1.72a2.06 2.06 0 1 1-2.47 3.28Z\" fill=\"#fff\"/><path d=\"M169.14 31.55c1.82-6.99-6-12.42-8.95-14.19.5-2.93 1.67-12.56-4.47-16.11-6.1-3.54-13.8 2.2-16.12 4.14l-.7-.42c-3.07-1.77-10.77-5.35-16.05-.23-5.64 5.46-2.31 14-1.04 16.7-2.15 2-8.38 8.59-5.81 15.58a8.55 8.55 0 0 0 3.88 4.54c4.03 2.34 9.6 1.96 11.72 1.7 1 1.89 3.83 6.72 7.89 9.07a9.1 9.1 0 0 0 5.07 1.33c6.9-.36 9.92-10 10.67-12.92 2.86-.4 12.09-2.2 13.92-9.2Z\" fill=\"#c8566a\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M142.76 25.6s3.69 8.2.36 8.71c-3.34.52-1.46-8.59-1.46-8.59s-7.11 6-8.15 3.03c-1.04-2.98 7.7-4.05 7.7-4.05s-7.98-4.7-5.38-6.83c2.59-2.15 6.21 6.09 6.21 6.09s1.94-8.92 4.82-7.26c2.88 1.67-3.86 7.82-3.86 7.82s8.88-1 8.37 2.35c-.5 3.34-8.6-1.27-8.6-1.27Z\" fill=\"#fff\"/><rect x=\"191\" y=\"129\" width=\"2\" height=\"39\" rx=\"1\" fill=\"#E6E6E6\"/><path d=\"M202 166h-9.43l6.43-17h-11l-6 21h8.64L186 189l16-23Z\" fill=\"#7a4a8a\"/>","fro":"<path d=\"M94.7 69.39c-4.62 24.47-16 42.72-25.74 41a7.49 7.49 0 0 1-1.96-.63V89a65.93 65.93 0 0 1 28.4-54.24c.48 2.39.83 4.99 1.05 7.77a262.85 262.85 0 0 1 36.9-2.44c13.27 0 25.67.85 36.22 2.34.22-2.74.57-5.3 1.05-7.67A65.92 65.92 0 0 1 199 89v20.76c-.62.3-1.28.52-1.95.63-9.72 1.72-21.09-16.48-25.73-40.9a260.5 260.5 0 0 1-37.97 2.59c-14.3 0-27.6-1-38.65-2.7Z\" fill=\"#000\" fill-opacity=\".16\"/><path d=\"M133 0c-11.21 0-21.9 2.2-31.69 6.18-.92-.12-1.86-.18-2.81-.18-6.7 0-12.77 3.07-17.2 8.06-18.04.93-33.46 13.3-40.77 30.9C32.5 49.56 27 59.04 27 70c0 .58.02 1.15.05 1.73A62.11 62.11 0 0 0 17 106c0 7.33 1.21 14.34 3.43 20.78-.28 1.69-.43 3.44-.43 5.22 0 9.45 4.1 17.81 10.38 22.88C37.74 172.68 53.6 185 72 185c1.5 0 2.98-.08 4.44-.24C81.9 189.9 88.88 193 96.5 193c4.44 0 8.67-1.05 12.5-2.95v-9.44a56.03 56.03 0 0 1-31.8-45.74A12 12 0 0 1 67 123v-13c0-1.72.36-3.36 1.02-4.84.3.1.62.18.94.23 9.73 1.72 21.12-16.53 25.74-41 11.05 1.7 24.35 2.7 38.65 2.7 14.02 0 27.06-.96 37.97-2.6 4.64 24.41 16.01 42.6 25.73 40.9.32-.06.63-.14.94-.23a11.96 11.96 0 0 1 1 4.83v13a12 12 0 0 1-10.2 11.87A56.03 56.03 0 0 1 157 180.6v9.44a28.06 28.06 0 0 0 12.5 2.95c7.62 0 14.61-3.1 20.06-8.24 1.46.16 2.94.24 4.44.24 18.39 0 34.26-12.32 41.62-30.12C241.9 149.81 246 141.45 246 132c0-1.78-.15-3.53-.43-5.22A63.91 63.91 0 0 0 249 106a62.11 62.11 0 0 0-10.05-34.27c.04-.58.05-1.15.05-1.73 0-10.96-5.5-20.44-13.53-25.04-7.31-17.6-22.73-29.97-40.77-30.9C180.27 9.07 174.2 6 167.5 6c-.95 0-1.89.06-2.81.18A83.76 83.76 0 0 0 133 0Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","froBand":"<path d=\"M250 70.5c0 .8-.03 1.6-.1 2.37A57.74 57.74 0 0 1 261 107c0 7.16-1.3 14.01-3.67 20.34a28.47 28.47 0 0 1-11.78 29.71 53.5 53.5 0 0 1-53.86 29.64A36.35 36.35 0 0 1 168.5 195c-4.02 0-7.88-.65-11.5-1.85v-12.54a56.03 56.03 0 0 0 31.8-45.74A12 12 0 0 0 199 123v-13a12 12 0 0 0-10-11.83V92a56 56 0 0 0-2.22-15.68l1.37 12.87-11.34-24-45.13-19.52-30.12 10.56-21.5 20.19-.04-2.6A55.93 55.93 0 0 0 77 92v6.17A12 12 0 0 0 67 110v13a12 12 0 0 0 10.2 11.87A56.03 56.03 0 0 0 109 180.6v10.94A36.36 36.36 0 0 1 93.5 195c-8.8 0-16.88-3.12-23.19-8.31a53.5 53.5 0 0 1-53.86-29.63 28.47 28.47 0 0 1-11.78-29.72A57.87 57.87 0 0 1 1 107a57.74 57.74 0 0 1 11.1-34.13 28.5 28.5 0 0 1 16-28.04 55.02 55.02 0 0 1 47.55-31.78 28.4 28.4 0 0 1 26.6-7.24A83.78 83.78 0 0 1 133 0a83.82 83.82 0 0 1 29.4 5.3 28.4 28.4 0 0 1 23.94 7.76 55.02 55.02 0 0 1 47.56 31.77A28.5 28.5 0 0 1 250 70.5Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M188.37 98.97c.41-2.55.63-5.16.63-7.82C189 62.35 163.7 39 132.5 39S76 62.35 76 91.15c0 2.66.22 5.27.63 7.82 4.1-25.09 27.55-44.32 55.87-44.32 28.32 0 51.78 19.23 55.87 44.32Z\" fill=\"{{accent}}\"/>","longButNotTooLong":"<path d=\"M50 90.5c0 4.55 1.7 8.64 4.85 10.77.9.61 2.47.93 4.15 1.07V182a8 8 0 0 0 8 8h42v-9.39a56.03 56.03 0 0 1-31.8-45.74A12 12 0 0 1 67 123v-13c0-3.5 1.5-6.63 3.87-8.83 11.54-2.61 24.1-7.53 36.47-14.67 12.13-7 22.5-15.24 30.48-23.75a87.36 87.36 0 0 1-12.45 20.78c12.68-5.52 21.3-14.4 25.9-26.63.37.92.76 1.84 1.17 2.76 10.26 23.03 27.88 39.36 45.77 44.74.5 2.11.79 4.08.79 5.6v13a12 12 0 0 1-10.2 11.87A56.03 56.03 0 0 1 157 180.6V190h18a32 32 0 0 0 32-32v-54.12c0-.07 0-.17-.03-.28-.07-5.64-.28-18.87-.6-21.37A74.01 74.01 0 0 0 132.99 18c-36.08 0-66.14 25.83-73 60-5.52 0-10 5.6-10 12.5Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M152.44 59.66c11.94 26.81 33.86 44.53 54.56 46.5V92A74 74 0 0 0 60.32 78H60c-5.52 0-10 5.6-10 12.5 0 6.48 3.95 11.81 9 12.44v.15l.95-.1H60a8.1 8.1 0 0 0 1.9-.22C75.7 101 91.68 95.54 107.34 86.5c12.13-7 22.5-15.24 30.48-23.75a87.36 87.36 0 0 1-12.45 20.78c12.68-5.52 21.3-14.4 25.9-26.63.37.92.76 1.84 1.17 2.76Z\" fill=\"#fff\" fill-opacity=\".08\"/>","miaWallace":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M69.03 76.21C81.97 43.13 95.65 26.6 110.06 26.6c.54 0 29.25-.24 48.05-.36C178.77 35.59 193 55.3 193 78.1V93h-82.94l-2.8-23.18L103.36 93H69V78.11c0-.63.01-1.27.03-1.9Z\" fill=\"#000\" fill-opacity=\".16\"/><path d=\"M40 145c-.09-18.98 30.32-97.2 41-110 7.92-9.5 27.7-15.45 52-15 24.3.45 44.86 3.81 53 14 12.32 15.43 40.09 92.02 40 111-.1 21.27-9.62 33.59-18.6 45.22A293.1 293.1 0 0 0 203 196c-10.28-2.66-27.85-5.18-46-6.68v-8.7A56 56 0 0 0 189 130V92c0-1.34-.05-2.68-.14-4h-76.8l-2.8-21.44L105.36 88H77.14c-.1 1.32-.14 2.66-.14 4v38a56 56 0 0 0 32 50.61v8.7c-18.15 1.5-35.72 4.03-46 6.69-1.42-1.93-2.9-3.84-4.39-5.78C49.62 178.6 40.1 166.27 40 145Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","shavedSides":"<path d=\"m175.83 55.92-.03.02c.76.88 1.49 1.78 2.19 2.7a55.74 55.74 0 0 1 11 33.36v5.5c0-15.77-6.69-29.98-17.4-39.93-11.58 3.77-49.58 14.27-77.63.42A54.35 54.35 0 0 0 77 97.5V92c0-12.5 4.1-24.04 11.01-33.35.71-.94 1.45-1.86 2.22-2.75l-.02-.02A55.88 55.88 0 0 1 133 36a55.88 55.88 0 0 1 42.82 19.92Z\" fill=\"#000\" fill-opacity=\".16\"/><path d=\"M92.54 53.29A55.81 55.81 0 0 0 77 91.99v6.17a11.97 11.97 0 0 0-6.49 3.34l.7-17.37a45.92 45.92 0 0 1 17.37-34.17c-2.2-3.84-1.45-10.33 7.8-13.1 5.07-1.5 7.57-5.08 10.24-8.88 3.5-5 7.27-10.37 17.48-11.92 9.87-1.5 13.23-.88 17.05-.18 3.13.57 6.58 1.2 14.2.76 9.85-.57 16.86-4 21.43-6.22 3.26-1.6 5.27-2.58 6.17-1.47 15.42 18.9 6.97 33.8-6.2 41.96A45.9 45.9 0 0 1 193 86v13.6c-1.22-.7-2.56-1.2-4-1.43V92c0-15.26-6.1-29.09-16-39.19-7.76 2.75-50.39 16.55-80.46.48ZM223.61 226.05c3.06 5.6 4.05 11.12 3.5 16.38A72.02 72.02 0 0 0 161 199h-4v-18.39a56.03 56.03 0 0 0 31.8-45.74c1.5-.23 2.93-.74 4.2-1.47v20.7c0 20.77 11.47 39.79 22.15 57.47 2.97 4.93 5.88 9.75 8.46 14.48ZM68.7 146.5l.66-16.35a12 12 0 0 0 7.85 4.72A56.03 56.03 0 0 0 109 180.6V199h-4c-11.2 0-21.8 2.56-31.25 7.12-2.99-18.29-4.3-38.68-5.05-59.62Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M90.88 52.36c33.22 19.3 83.37 0 83.37 0 14.53-7.77 25.08-23.32 8.7-43.4-2.17-2.66-10.7 6.72-27.6 7.7-16.9.97-13.27-3.31-31.25-.59-17.97 2.73-15.99 17.3-27.72 20.8-11.73 3.5-9.8 13-5.5 15.5Z\" fill=\"#fff\" fill-opacity=\".2\"/>","straight02":"<path d=\"M157 180.61V199h4a71.7 71.7 0 0 1 46 16.6V92a74 74 0 0 0-148 0v183.72A28 28 0 0 0 83 248v-45.58a71.95 71.95 0 0 1 22-3.42h4v-18.39a56.24 56.24 0 0 1-26-25.36V93.27a150 150 0 0 0 28.34-12.77c15.4-8.9 28.1-19.56 36.73-30.1 1.76 5.2 4.1 10.4 7.04 15.48 8.78 15.2 21.12 26.35 33.9 32.04v.25c.4.06.8.15 1.18.26.77.32 1.55.62 2.33.9A12 12 0 0 1 199 110v13a12 12 0 0 1-10.22 11.87A56.03 56.03 0 0 1 157 180.6Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M157 199v-18.39a56.03 56.03 0 0 0 31.8-45.74A12 12 0 0 0 199 123v-13a12 12 0 0 0-6.5-10.66 44.57 44.57 0 0 0 14.5 2.8v113.47A71.7 71.7 0 0 0 161 199h-4ZM83 202.42v-47.17a56.24 56.24 0 0 0 26 25.36V199h-4c-7.67 0-15.07 1.2-22 3.42ZM189 97.92v.25c.4.06.8.15 1.18.26l-1.18-.51Z\" fill=\"#000\" fill-opacity=\".27\"/>","straight01":"<path d=\"M67 113c10.86-22.7 34.67-31.6 55.44-39.36 13.32-4.97 25.39-9.48 32-16.86 2.22 2.02 4.75 4.05 7.41 6.2C172.06 71.16 184.21 80.91 189 98v.17a12 12 0 0 1 9.81 9.72V86.04c0-1.3-.05-2.57-.15-3.84 4.54-17-3.1-37.78-12.66-47.2-9.48-8.82-22.3-12.32-30.95-8.48C143.45 8.98 109.9 13.24 90 28c-13.22 9.8-24.79 25.72-27.84 45.75A46.18 46.18 0 0 0 61 84.05v88.5c-.2 31.5-7.4 82.49-21 90.45 62.36 16.8 71.93-38.15 69-82v-.39a56.03 56.03 0 0 1-31.8-45.74A12 12 0 0 1 67 123v-10ZM157 180.61a56.03 56.03 0 0 0 31.8-45.74 12 12 0 0 0 10.01-9.76v1.36A100 100 0 0 0 209.78 172l26.95 52.71a37.79 37.79 0 0 1-3.94 40.76A72 72 0 0 0 161 199h-4v-18.39Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M67 113c10.86-22.7 34.67-31.6 55.44-39.36 13.32-4.97 25.39-9.48 32-16.86 2.22 2.02 4.75 4.05 7.41 6.2 10.19 8.17 22.3 17.89 27.11 34.9-4.57-14.04-15.75-21.22-25.6-27.55-3.21-2.06-6.28-4.03-8.93-6.12-6.6 6.4-18.67 10.32-32 14.64C101.68 85.58 77.87 93.3 67 113Z\" fill=\"#000\" fill-opacity=\".16\"/>","straightAndStrand":"<path d=\"M133 18a74 74 0 0 0-74 74v96c0 8.56 1.45 16.78 4.12 24.42A71.67 71.67 0 0 1 105 199h4v-18.39a56.03 56.03 0 0 1-31.8-45.74A12 12 0 0 1 67 123v-13a12 12 0 0 1 .46-3.3c17.13-6.02 33.75-21.94 43.59-44.04.4-.92.8-1.84 1.18-2.76 4.58 12.23 13.21 21.11 25.89 26.63a87.36 87.36 0 0 1-12.45-20.78c7.98 8.5 18.35 16.74 30.48 23.75 14.33 8.27 28.91 13.56 41.87 15.75.63 1.45.98 3.06.98 4.75v13a12 12 0 0 1-10.2 11.87A56.03 56.03 0 0 1 157 180.6V199h4a71.67 71.67 0 0 1 41.88 13.42A73.9 73.9 0 0 0 207 188V92a74 74 0 0 0-74-74Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M111.05 62.66C99.59 88.39 78.95 105.75 59 108.84v4c19.95-3.1 40.59-20.45 52.05-46.18.4-.92.8-1.84 1.18-2.76 4.58 12.23 13.21 21.11 25.89 26.63a78.16 78.16 0 0 1-4.62-6.26c-10.18-5.56-17.27-13.69-21.27-24.37a98.8 98.8 0 0 1-1.18 2.76ZM129.5 73.64a137.34 137.34 0 0 0 26.65 19.86c17.75 10.25 35.9 15.91 50.85 16.78v-4c-14.95-.87-33.1-6.54-50.85-16.78-12.13-7-22.5-15.24-30.48-23.75a98.3 98.3 0 0 0 3.83 7.89Z\" fill=\"#000\" fill-opacity=\".16\"/>","dreads01":"<g fill=\"{{hair}}\"><path d=\"M187.7 56.12c.9 3.25 2.17 11.95-.06 14.84-.75.96-5.84-1.74-7.97-2.92l-3.53-1.96c-14.92-8.32-19.74-11-45.9-10.62-28.11.4-47.37 13.58-48.46 14.93-.75.93-1.71 3.44-2.5 10.41-.25 2.2-.32 4.97-.4 7.71-.14 5.94-.3 11.77-2.25 11.76-2.44-.01-2.97-23.78-1.92-33.21.04-.36.1-.78.18-1.23.23-1.4.5-3.13.16-4.11-.16-.44-.54-.7-.94-.99-.62-.43-1.26-.88-1.08-2.03.21-1.31 1.1-1.43 1.97-1.56.57-.08 1.13-.16 1.5-.56 1.13-1.23.46-1.87-.31-2.6-.46-.43-.95-.9-1.12-1.53-.63-2.36 1.03-3.1 2.69-3.83l.38-.17c.69-.3 1.1-.42 1.42-.5.6-.15.85-.21 1.89-1.35-2.14-1.56-2.9-3.69.01-4.83.56-.22 1.52-.2 2.5-.2 1.2.02 2.4.03 2.94-.37.15-.11.24-.53.33-.9.06-.27.11-.5.18-.6 1.35-1.93 1.23-3.4 1.08-5.4l-.07-.92c-.13-2.04-.11-3.9 2.33-4.11 1-.08 1.9.4 2.77.86.54.29 1.08.58 1.64.73.87.23 1.1.43 1.32.43.19 0 .37-.15.96-.55 1.18-.82 1.3-2.05 1.43-3.3.11-1.08.22-2.18 1.04-3 1.58-1.6 2.8-.64 4 .3.64.5 1.28 1 1.96 1.1 2.55.36 3.06-1.06 3.62-2.59.36-1 .74-2.06 1.74-2.68 1.83-1.15 2.64-.05 3.43 1.01.5.68.98 1.33 1.7 1.39 1.01.08 2.52-1.1 3.85-2.14a11.6 11.6 0 0 1 2.1-1.44c2.27-.93 3.91.07 5.58 1.08 1.4.85 2.83 1.72 4.65 1.43l.83-.13c2.24-.37 3.11-.51 5.45.96a4.2 4.2 0 0 0 3.74.69c.6-.12 1.3-.25 2.26-.26 1.1 0 1.98.5 2.83.99.7.4 1.36.79 2.13.87.42.04.84-.16 1.26-.36.42-.2.84-.4 1.3-.38 1.83.11 2.69 1.5 3.55 2.88.67 1.08 1.34 2.15 2.46 2.66 1.62.72 3.44.24 5.17-.21.79-.2 1.55-.4 2.28-.5 3.96-.46 3.27 1.97 2.55 4.56a11.1 11.1 0 0 0-.6 3.26c1.15.27 2.3-.15 3.46-.57 1.1-.4 2.18-.8 3.27-.6 3.4.58 2.25 4.02 1.44 6.45l-.08.21c.64 0 1.54-.2 2.56-.42 2.86-.6 6.61-1.41 7.78 1.13.47 1.05 0 2.31-.44 3.54a7.17 7.17 0 0 0-.61 2.41c.02 1.53.7 2.9 1.4 4.27.45.91.9 1.82 1.17 2.78Z\"/><path d=\"m186.36 73.6.47.33c1.76.99 3.15 10.9 3.22 14.69.04 2.34.08 11.25-2.4 10.48-.75-.23-1.9-4.95-2.06-7.72-.16-2.76-1.74-12.16-4.14-16.49-.13-.23-.32-.51-.53-.8-.65-.96-1.44-2.12-.92-2.76.72-.88 1.43-.57 2.26-.2l.44.18c.87.35 2.77 1.68 3.66 2.3Z\"/></g>","dreads02":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M218.2 107.16a12.2 12.2 0 0 1-6.25-5.56 9.62 9.62 0 0 1 1.95-.13c2.27-.02 5.15-.04 4.62-2.87-.57-2.98-5.4-2.07-7.28-1.6.58-.36 1.34-.49 2.12-.62 1.49-.25 3-.51 3.31-2.33.53-3.18-3.29-3.08-5.08-2.4-.26-2.12 2-3.89 4.14-5.55 1.25-.97 2.45-1.9 3.08-2.85.13-.2.29-.38.43-.55.47-.53.86-.97.31-2.08-1.16-2.35-3.95.32-5.34 1.66l-.45.43c.88-1.63 3.32-8.4 2.95-10.13-.54-2.52-2.34-2.61-3.78-.56-.62.88-.94 2.65-1.23 4.26-.15.81-.29 1.58-.45 2.16-.87-.65-1.39-.7-1.7-.74-.43-.04-.49-.05-.55-1.45-.04-1.02.8-2.7 1.56-4.16.4-.8.79-1.54.97-2.09.08-.24.2-.51.3-.81.53-1.36 1.24-3.18.65-4.23-1.78-3.15-3.48 1.17-3.94 2.65-.5-2.14.5-3.97 1.53-5.88.6-1.13 1.24-2.3 1.57-3.55.54-2.05 1.97-7.58-.51-8.56-2.48-.98-2.51 2.12-2.53 4.66-.01.93-.02 1.79-.15 2.34l-.03.13c-.37 1.57-.92 3.97-2.1 4.71-.18.11-2.83.34-2.96.2-1.1-1.29.42-3.53 1.74-5.49.76-1.13 1.46-2.17 1.55-2.87.22-1.73-.44-2.82-2.06-2.92-.47-.03-1.1.36-1.61.7-.4.24-.73.45-.89.41-1.07-.23-.36-3.82.17-6.5.2-1.04.38-1.94.42-2.46.15-2-.1-7.17-3.48-4.79l.16-2.06c.15-1.95.3-3.86.57-5.83.05-.37.18-.73.3-1.08.32-.97.63-1.86-.67-2.69-2.16-1.36-3.36 1.5-3.85 3.17-.26.9-.27 1.93-.28 2.95-.04 2.29-.07 4.45-2.87 4.52-3.37.07-2.63-2.42-1.87-4.99.29-1 .59-2 .65-2.88.13-1.74-1.01-6.42-3.26-3.26-.53.73-.64 2.56-.74 4.25-.07 1.19-.14 2.3-.34 2.92-.56-.25-.37-1.4-.17-2.61.2-1.2.41-2.44-.06-2.95-1.5-1.64-2.82-.36-3.94.72-.41.4-.8.79-1.16.97l-.08-1.22c-.06-1.04-.13-2.08-.17-3.12-.03-.72.1-1.7.22-2.75.28-2.15.58-4.58-.34-5.6-2.33-2.59-3.82.43-4.5 2.53-.1.28-.18.57-.25.85-.45 1.56-.83 2.93-2.98 3.15.08-1.1-.28-2.7-.65-4.38-.54-2.43-1.12-5-.39-6.35.27-.5.67-.59 1.07-.68.42-.09.85-.18 1.1-.78.83-1.9-.51-2.71-1.98-2.77-4.17-.18-3.8 3.31-3.46 6.58.22 2.04.42 4-.5 4.9-.55-.5-.54-1.03-.52-1.6.01-.6.03-1.24-.55-1.99-1.22-1.6-3.17-1.46-4.92-.73 0-.3.06-.93.16-1.72.41-3.5 1.2-10.27-3.24-6.1-.82.77-1 1.86-1.18 2.93-.12.7-.23 1.37-.51 1.95-.7 1.45-2.4 3.6-3.34 4.78-.47-1.92.16-4.26.7-6.22l.12-.45c.12-.45.46-1.2.85-2.07.84-1.84 1.9-4.2 1.53-5.17-1.27-3.38-4.63.5-6.52 2.68-.45.51-.8.94-1.05 1.15-1.58 1.4-7.88 6.04-9.9 4.64-.32-.23-.36-.74-.4-1.3-.05-.65-.11-1.38-.62-1.83-.48-.4-2.48-.6-3.06-.54.36-1.5-.34-3.43-2.05-2.9-1.23.36-1.45 1.56-1.67 2.74-.16.88-.33 1.75-.91 2.25-1.5 1.29-3.17.3-4.84-.68-1.15-.68-2.3-1.36-3.4-1.3.07-.32.22-.76.4-1.28.84-2.44 2.22-6.45-1.8-4.87-1.25.49-2.13 3.35-2.45 4.54-.14.55-.24 1.02-.32 1.42-.39 1.82-.5 2.32-3.18 3.03.09-.63.09-1.3.1-1.98 0-1.25 0-2.53.55-3.54.14-.28.4-.63.7-1.03 1.16-1.53 2.81-3.71-.24-4.05-3.78-.4-4.26 4.68-4.59 8.17-.08.9-.16 1.7-.28 2.27-4.12-2.5-6.86.96-9.33 4.07l-.15.19c.45-1.42 1.56-15.56-2.96-11.24-.84.8-.53 1.84-.24 2.87.16.55.32 1.1.29 1.6-.08 1.29-.5 2.43-1 3.62a24.52 24.52 0 0 1-2.97 5.53c-.3.4-.53.73-.71.99-.32.46-.48.7-.69.74-.22.04-.48-.17-1.04-.61a58.7 58.7 0 0 0-.38-.3c-2.43-1.87-3.58-6.62-3.46-9.52 0-.35.05-.76.1-1.19.22-2.24.51-5.2-2.5-4.35-3.01.86-2.05 6.15-1.5 9.2l.21 1.26c.4 2.69.65 5.43.2 8.17-2.3-2.36-3.09.87-3.6 2.97-.16.63-.28 1.16-.42 1.4-.7 1.26-1.84 2.07-2.98 2.86-.46.33-.93.65-1.36 1-.42-1.47.28-2.83.93-4.1.59-1.15 1.14-2.23.84-3.27-1.1-3.87-4.1.93-5.11 2.55l-.2.32c-.24.37-.69 1.42-1.19 2.59-.8 1.86-1.73 4.04-2.17 4.34-1.03.69-7.6-2.53-8.28-3.14-.55-.51-.76-1.45-.97-2.38-.25-1.11-.5-2.22-1.34-2.61-4.72-2.2-1.93 5.73-1 7.37a24.3 24.3 0 0 1 2.94 14.5 6.4 6.4 0 0 1-2.46-2.07 6.28 6.28 0 0 1-.87-2.53c-.19-.96-.36-1.88-.94-2.46-3.3-3.28-3.68 2.88-3.4 4.8.32 2.35 1.2 3.66 2.2 5.13.51.76 1.06 1.57 1.57 2.6.94 1.9.37 4.07-.2 6.23-.25.97-.51 1.95-.63 2.9-3.43-3.3-18.2-.55-14.4 4.5 1.17 1.55 2.47.44 3.8-.7.93-.8 1.87-1.6 2.8-1.55 4.09.22 6.24 5.3 5.97 8.84-.5-1.9-2.42-3.76-3.75-1.44-.8 1.4.32 3.67 1.1 5.25l.28.57c-.9-.44-5.37-2.52-6.25-2.16-3.44 1.41 1.3 4.15 2.54 4.7 4.22 1.87 6.89 3.92 8.2 8.99-1.43-.46-1.85-1.05-2.3-1.7-.3-.43-.62-.88-1.25-1.34-.95-.7-1.4-.7-1.96-.73-.31 0-.66-.02-1.13-.14l-.07-.02c-2.36-.6-5.4-1.4-8.04-.3-1.97.82-5.3 3.31-5.9 5.65-.77 2.87.84 3.6 2.9 2.14a9.77 9.77 0 0 0 2.08-2.23c1.09-1.45 2.12-2.82 4.5-2.73a6.6 6.6 0 0 1 4.64 2.33c.44.53.8 1.19 1.14 1.85.3.57.6 1.15.98 1.64.28.38.75.82 1.23 1.27.73.68 1.49 1.4 1.73 1.99 1.3 3.3-.87 6.27-2.63 8.68l-.46.63c-.42-.55-3.47-1.76-4.1-1.88-2.95-.56-4.05.8-2.2 3.52.3.45.8.77 1.28 1.08.43.28.85.55 1.15.91.37.45.66 1.03.94 1.61.27.54.54 1.08.88 1.53.92 1.24 2 2.08 3.1 2.94.55.44 1.12.88 1.68 1.39-.33.21-.46.02-.6-.17-.12-.17-.25-.34-.5-.24-.2.07-.47.04-.75 0-.3-.04-.61-.08-.87 0-.47.16-.64.68-.79 1.15-.12.36-.23.7-.46.79-1.91.76-3.84-.58-5.7-1.86-1.34-.94-2.64-1.85-3.89-1.92-1.61-.08-2.97 1-2.2 3.03.44 1.13 2.04 1.85 3.25 2.4l.79.36c3.24 1.65 6.48 2.87 9.95 1.6a14.73 14.73 0 0 0 9.67 3.69c-2.01 1-4 2.23-4.7 4.72a12.3 12.3 0 0 1-.9-1.17c-1.41-1.95-3.52-4.88-4.74-1.3-1.04 3.1 3.73 6.87 5.93 8.27-2.56.75-4.68.9-7.28.6-.3-.03-.66-.14-1.04-.25-1.4-.43-3.06-.92-2.2 2 1.13 3.83 7.59 2.37 10.13 1.62-1.78 1.5-9.56 11.7-2.8 9.39.95-.33 1.53-1.34 2.13-2.4.77-1.35 1.58-2.77 3.28-2.98 2.48-.3 3.38 1.37 4.41 3.28.43.79.88 1.62 1.47 2.37.39.49 1.3 1.21 2.28 1.98 1.58 1.24 3.3 2.6 3.17 3.28-.1.46-.72.82-1.4 1.21-.77.44-1.6.92-1.9 1.62-.62 1.55-.34 2.75.54 4.08 1.17 1.78 3.09 2.4 4.92 3.01.58.2 1.14.38 1.67.6 3.17 1.29 4.31 2.86 5.73 6.21-2.5.12-9.62 7.36-5.26 8.65 1.12.33 1.35-.25 1.6-.91.12-.3.24-.6.45-.86l.55-1.02.27-.52c.46-1.2.97-1.27 1.52-.22.07-.02.47.08.9.18.42.1.88.22 1.05.23 1.19.07 2.1-.53 3.03-1.15.4-.26.8-.53 1.24-.75.31-.15.62-.25.93-.35.68-.22 1.33-.42 1.86-1.23-.09.13.56-2.51.57-2.54.13-.31.38-.45.63-.6.25-.13.51-.28.68-.63a55.8 55.8 0 0 1-15.5-34.47A12 12 0 0 1 69 123v-13a12 12 0 0 1 7.5-11.13c.53.38 1.27 0 1.5-.84-.46-1.5 3.3-27.85 13-34.87 3.62-2.44 23-2.62 42.31-2.6 19.1 0 38.11.18 41.69 2.6 9.7 7.02 13.46 33.37 13 34.87.23.84.97 1.22 1.5.84A12 12 0 0 1 197 110v13a12 12 0 0 1-8.17 11.38 55.7 55.7 0 0 1-11.07 29.28c.2.81.4 1.63.55 2.5.18 1.1.23 2.14.28 3.15.1 2.04.19 3.94 1.37 5.95.19.33.42.6.66.86.33.38.66.76.86 1.28.16.44.2 1.05.25 1.68.1 1.4.2 2.92 1.7 2.92 3.1 0 1.37-5.97.6-7.38-.3-.54-.57-1-.82-1.41-1.03-1.74-1.63-2.74-1.57-5.64 1.75 1.16 7.53 3.38 9.45 2.32 3.5-1.94-2.69-3.9-5.83-4.89a11.7 11.7 0 0 1-1.6-.56c.63-.63 1.3-1.14 1.97-1.66 1.13-.86 2.25-1.72 3.22-3.1.25-.34.49-.72.73-1.11 1.01-1.6 2.1-3.3 3.82-3.38.4-.02 1.04.3 1.77.65 1.46.7 3.24 1.56 3.94.21.74-1.4-.26-1.89-1.15-2.33-.29-.14-.57-.28-.77-.44-.55-.45-.95-.57-1.2-.65-.45-.13-.5-.14-.27-1.49 1.1 1.17 2.8.43 3.25-1.01.3-.92-.16-1.46-.56-1.95-.28-.34-.55-.66-.54-1.07 0 .4.84-5.11.7-4.93.85-1.12 3.81-.8 5.34-.63h.07c2.13.24 2.17.31 3.03 2.02l.22.42c.88 1.72 3.2 5.18 3.7.64.13-1.08-.86-3.4-1.44-4.34a5.12 5.12 0 0 0-1.6-1.33c-.58-.37-1.12-.71-1.31-1.1-.48-.94.08-2.47.68-4.12.59-1.61 1.22-3.33.96-4.73.3.12.73.7 1.23 1.38 1.29 1.75 3 4.07 3.96.22.33-1.27-1.01-3.25-2.27-5.12-1.48-2.2-2.86-4.25-1.24-4.76 2.29-.73 4.61 2.22 5.25 4.04.2.56.27 1.37.35 2.22.12 1.2.24 2.48.72 3.14 3.03 4.2 3.4-2.75 3.16-4.58-.56-4.02-1.99-6.98-5.63-8.5 1.14-1.42 0-2.58-.91-3.53l-.36-.37c.55-.6 2.22-.75 4-.91 3.13-.28 6.62-.6 5.2-3.42-.39-.78-1.53-1.1-2.5-1.36-.36-.1-.7-.19-.96-.3ZM59.5 138.8c0-.14-.13-.09-.36.1l.35-.1Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","frizzle":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M90.91 55.36h84.18c18.24-10.53 21.67-29.2 8.76-45.43-3.21-4.04-8.76 11.75-25.82 12.72-17.06.98-15.42-6.3-33.57-3.58-18.15 2.73-16.15 17.3-28 20.8-11.84 3.5-5.55 15.5-5.55 15.5Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","shaggy":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M88.18 37.86c5.14-3.84 11.22-7.12 17.56-8.38 6.45-1.28 10.36-1.6 16.7-.07 1.64.39 2.2.78 3.63-.15 1.2-.79 9.66-9.5 35.42-4.66 26.03 4.88 33.77 44.08 43.42 45.57 3.49.53 7.79-.39 7.92-2.53 3.96 6.03 5 14 3.33 21.07-1.45 6.09-4.5 11.8-10 15.14-4.72 2.87-11.25 4.12-16.71 3.59a22.36 22.36 0 0 1-7.03-1.77c-2.76-1.2-4.96-3.4-7.67-4.54a53.9 53.9 0 0 0 9.18 6.42c1.64.9 3.3 1.53 5.11 2.02 1.24.34 3.76 1.48 4.96 1.18-7.81 1.4-15.16.18-22.32-3.16a51.67 51.67 0 0 1-9.2-5.48c-2.83-2.13-6.09-4.3-8.3-7.1.93 1.2-.7-.6-.92-.81a74.07 74.07 0 0 1-4.72-5.29c-1.99-2.48-3.84-5.08-5.5-7.8-1.68-2.76-8.36-13.87-10.38-16.5a195.3 195.3 0 0 0 6.41 16.93c-4.71-1.47-9.28-5.54-12.3-9.34a29.46 29.46 0 0 1-6.1-14.66c-3.83 10.41-12.79 18.63-22.03 24.3 2-3.74 5.05-6.9 7.05-10.69-9.2 9.33-24.57 13.9-28.6 27.58-1.03-4.76-4.35-8.58-5.34-13.43-1.1-5.4-1.9-11.11-1.73-16.62.4-12.24 8.64-23.72 18.16-30.82Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","shaggyMullet":"<path d=\"M177.75 37.86c9.52 7.1 17.76 18.58 18.16 30.82.17 5.5-.62 11.23-1.73 16.62-.5 2.46-1.6 4.66-2.7 6.85-1.07 2.12-2.13 4.24-2.64 6.58-2.63-8.93-10.09-13.97-17.5-19-3.96-2.66-7.9-5.33-11.1-8.58 1.02 1.93 2.3 3.7 3.6 5.46 1.23 1.7 2.47 3.4 3.45 5.22-9.24-5.66-18.2-13.88-22.03-24.3a29.46 29.46 0 0 1-6.1 14.67c-3.02 3.8-7.59 7.87-12.3 9.34 2.43-5.5 4.5-11.21 6.4-16.92-1.78 2.31-7.21 11.29-9.6 15.23l-.77 1.26a73.9 73.9 0 0 1-10.47 13.35c-.5.53-1.42 1.52-.67.54-1.85 2.35-4.45 4.26-6.9 6.07l-1.4 1.04a51.67 51.67 0 0 1-9.2 5.48c-7.1 3.31-14.38 4.54-22.11 3.2.9.1 2.35-.4 3.53-.82a20 20 0 0 1 1.22-.4c1.8-.5 3.47-1.12 5.11-2.02a53.85 53.85 0 0 0 9.18-6.42c-1.37.58-2.6 1.42-3.84 2.27-1.23.83-2.46 1.67-3.83 2.27-2.28 1-4.54 1.53-7.03 1.77-5.46.53-12-.72-16.72-3.6-5.5-3.32-8.54-9.04-9.99-15.13-1.68-7.06-.63-15.04 3.33-21.07.13 2.14 4.43 3.06 7.92 2.53 3.77-.59 6.95-6.52 10.9-13.93 6.19-11.55 14.28-26.67 29.52-30.64 19.96-5.2 34.21 3.87 35.42 4.66 1.22.78 1.8.63 2.93.32l.68-.17c6.35-1.52 13.26-2.2 19.7-.92 6.35 1.26 12.43 4.54 17.57 8.38ZM71.93 110.75l.2.04a1.6 1.6 0 0 1-.2-.04ZM79 156.2c.8-1.53 1.57-3.06 2.32-4.6A56.2 56.2 0 0 0 109 180.6v9.01a54.4 54.4 0 0 1-7.73 1.97c-9 1.62-34.32-3.53-45.44-11.98-.85-.65-.42-1.92.67-2 11.66-.8 17.63-12.13 22.4-21.2l.1-.2ZM157 183.05v-2.44c6.95-3.3 13.11-8 18.13-13.71.71 2.24 1.75 4.33 3.43 5.79 1.32 1.14 3.48 1.12 5.34 1.1l1.2.01c1.67.05 3.34.06 5.02-.02.83-.03 1.2 1.02.53 1.5a39.2 39.2 0 0 1-3.64 2.07 29.3 29.3 0 0 1-7.98 2.74c-1.92.34-3.82.4-5.66.18a9.84 9.84 0 0 0 1.7 1.94c1.41 1.22 3.72 1.2 5.7 1.19h1.28c1.79.05 3.58.06 5.36-.02.9-.04 1.3 1.09.57 1.6a41.97 41.97 0 0 1-3.88 2.22 31.24 31.24 0 0 1-8.53 2.92c-5.5.97-10.86-.18-15.19-3.7a24.9 24.9 0 0 1-3.38-3.37Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path d=\"M81.32 151.6c-.75 1.54-1.51 3.07-2.31 4.6l-.1.18c-4.77 9.08-10.74 20.42-22.4 21.22-1.09.07-1.52 1.34-.67 1.99 11.12 8.45 36.43 13.6 45.44 11.98a54.4 54.4 0 0 0 7.73-1.96v-8.99a56.2 56.2 0 0 1-27.68-29ZM157 180.61v2.44a24.9 24.9 0 0 0 3.38 3.36c4.33 3.53 9.7 4.68 15.2 3.71a31.24 31.24 0 0 0 8.51-2.92 41.97 41.97 0 0 0 3.89-2.22c.72-.51.32-1.64-.57-1.6-1.78.08-3.57.07-5.35.02h-1.29c-1.98.01-4.29.03-5.7-1.2a9.84 9.84 0 0 1-1.7-1.93c1.84.22 3.74.16 5.66-.18a29.3 29.3 0 0 0 7.98-2.73 39.2 39.2 0 0 0 3.64-2.08c.68-.48.3-1.53-.53-1.5a69.9 69.9 0 0 1-5.02.02h-1.2c-1.86.01-4.02.03-5.34-1.11-1.69-1.46-2.72-3.55-3.43-5.8A56.18 56.18 0 0 1 157 180.62Z\" fill=\"#000\" fill-opacity=\".16\"/>","shortCurly":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M193.76 70.77a62.92 62.92 0 0 0-1.51-9.86 51.78 51.78 0 0 0-2.5-7.49c-.6-1.48-2.02-3.52-2.19-5.13-.16-1.57 1.07-3.32 1.33-5.16.24-1.79.2-3.66-.17-5.44-.83-4.03-3.6-7.77-7.85-8.82-.95-.23-2.97.06-3.64-.5-.77-.63-1.3-2.8-2-3.67-2-2.47-5.1-4.07-8.37-3.51-2.41.4-1.03.9-2.84-.51-1-.8-1.75-2-2.73-2.85a24.7 24.7 0 0 0-4.9-3.28 50.82 50.82 0 0 0-14.84-4.91c-9.28-1.52-19.2-.2-28.2 2.22a74.58 74.58 0 0 0-13.14 4.74c-1.78.87-2.81 1.58-4.67 1.81-2.93.36-5.4.34-8.18 1.58-8.54 3.82-12.39 12.69-9.06 21.17.66 1.71 1.57 3.21 2.82 4.59 1.52 1.68 2.07 1.35.76 3.28a52.78 52.78 0 0 0-4.96 9.17c-3.53 8.4-4.12 17.87-3.89 26.83.08 3.13.22 6.3.71 9.42.22 1.34.28 3.87 1.29 4.87.5.5 1.24.78 1.96.58 1.71-.47 1.13-1.73 1.17-2.9.2-5.88-.08-11.08 1.32-16.9a44.4 44.4 0 0 1 5-12.03 72.07 72.07 0 0 1 9.8-13.35c.92-.99 1.12-1.4 2.35-1.48.93-.05 2.3.59 3.2.8 2 .5 4 .98 6.03 1.3 3.74.6 7.45.65 11.22.53 7.43-.23 14.88-.75 22.09-2.62 4.78-1.24 9.02-3.47 13.6-5.1.08-.04 1.23-.85 1.43-.82.28.04 1.97 1.82 2.26 2.05 2.23 1.74 4.67 2.48 7.07 3.83 2.97 1.66.1-.72 1.73 1.36.48.6.72 1.72 1.1 2.4 1.22 2.2 2.9 4.1 4.93 5.63 1.96 1.47 4.9 2.18 5.9 4.1.76 1.47 1.02 3.48 1.64 5.06 1.63 4.13 3.78 7.99 5.93 11.88 1.73 3.14 3.62 5.89 3.81 9.47.07 1.25-1.12 8.74 1.78 6.46.43-.34 1.35-4.15 1.54-4.8.77-2.63 1.05-5.38 1.4-8.09.69-5.38.92-10.5.46-15.91Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","shortFlat":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M180.15 39.92c-2.76-2.82-5.96-5.21-9.08-7.61-.69-.53-1.39-1.05-2.06-1.6-.15-.12-1.72-1.24-1.9-1.66-.45-.99-.19-.22-.12-1.4.08-1.5 3.13-5.73.85-6.7-1-.43-2.8.7-3.75 1.08a59.56 59.56 0 0 1-5.73 1.9c.93-1.85 2.7-5.57-.63-4.58-2.6.78-5.03 2.77-7.64 3.7.86-1.4 4.32-5.8 1.2-6.05-.98-.07-3.8 1.75-4.86 2.14a55.81 55.81 0 0 1-9.63 2.51c-11.2 2.02-24.3 1.45-34.65 6.54-8 3.93-15.88 10.03-20.5 17.8-4.44 7.48-6.1 15.67-7.03 24.25-.69 6.3-.74 12.8-.42 19.12.1 2.07.34 11.61 3.34 8.72 1.5-1.44 1.49-7.25 1.87-9.22.75-3.91 1.47-7.85 2.72-11.64 2.2-6.68 4.81-13.8 10.3-18.4 3.53-2.94 6.01-6.93 9.39-9.9 1.51-1.35.36-1.2 2.8-1.03 1.63.12 3.28.16 4.92.2 3.8.1 7.6.08 11.4.1 7.64 0 15.25.12 22.89-.28 3.4-.18 6.8-.28 10.18-.6 1.9-.17 5.25-1.38 6.8-.45 1.43.84 2.91 3.61 3.94 4.75 2.41 2.67 5.3 4.72 8.12 6.92 5.9 4.57 8.87 10.33 10.66 17.48 1.79 7.13 1.29 13.75 3.5 20.76.38 1.24 1.4 3.36 2.67 1.46.24-.36.18-2.3.18-3.42 0-4.52 1.14-7.91 1.13-12.46-.06-13.83-.5-31.87-10.85-42.44Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","shortRound":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M167.3 35c-20.18-11.7-40.17-9.78-55.26-5.97-15.1 3.8-24.02 14.62-31.68 30.62a67.68 67.68 0 0 0-6.34 25.83c-.13 3.41.33 6.94 1.25 10.22.33 1.2 2.15 5.39 2.65 2 .17-1.12-.44-2.67-.5-3.86-.08-1.57 0-3.16.11-4.73.2-2.92.73-5.8 1.65-8.59 1.33-3.98 3.02-8.3 5.6-11.67 6.4-8.33 17.49-8.8 26.29-13.39-.77 1.4-3.7 3.68-2.7 5.27.71 1.1 3.38.76 4.65.72 3.35-.09 6.72-.67 10.02-1.14a71.5 71.5 0 0 0 15-4.1c4.02-1.5 8.61-2.88 11.63-6.07a68.67 68.67 0 0 0 17.4 13c5.62 2.88 14.68 4.32 18.11 10.16 4.07 6.91 2.2 15.4 3.44 22.9.47 2.85 1.54 2.79 2.13.24 1-4.33 1.47-8.83 1.15-13.28-.72-10.05-4.4-36.45-24.6-48.15Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","shortWaved":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M183.68 38.95c5.4-4.95 6.7-14.99 3.64-21.5-3.77-8-11.42-9-18.75-5.48-6.9 3.31-13.06 4.42-20.62 2.81-7.26-1.54-14.14-4.26-21.65-4.7-12.32-.74-24.3 3.83-32.7 13.05a35.75 35.75 0 0 0-4.11 5.8c-.98 1.63-2.08 3.38-2.5 5.26-.2.9.18 3.1-.27 3.83-.48.8-2.3 1.52-3.07 2.1a25.02 25.02 0 0 0-4.18 4.05c-2.66 3.22-4.13 6.59-5.37 10.57-4.1 13.25-4.45 29 .86 42 .7 1.74 2.9 5.36 4.18 1.64.26-.73-.33-3.19-.33-3.93 0-2.72 1.5-20.73 8.05-30.82 2.13-3.28 11.97-15.58 13.98-15.68 1.07 1.7 11.88 12.51 39.94 11.24 12.66-.58 22.4-6.27 24.74-8.73 1.03 5.53 13 13.81 14.82 17.22 5.26 9.85 6.43 30.3 8.44 30.27 2.01-.04 3.45-5.24 3.87-6.23 3.07-7.38 3.6-16.64 3.26-24.56-.42-10.2-4.63-21.23-12.23-28.22Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","sides":"<path d=\"M70 97c0 4 .92 5.07 6 5 3.25-.05 3.44-6 3.65-12.59.14-4.37.29-9.03 1.35-12.41.62-4.43-1.82-3.17-3-1-3.96 4.78-8 15.34-8 21ZM196 97c0 4-.92 5.07-6 5-3.25-.05-3.44-6-3.65-12.59-.14-4.37-.29-9.03-1.35-12.41-.62-4.43 1.82-3.17 3-1 3.96 4.78 8 15.34 8 21Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","theCaesar":"<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M76 98c.35 1.49 1.67 1.22 2 0-.46-1.55 3.3-28.75 13-36 3.62-2.52 23-4.77 42.31-4.75 19.1 0 38.11 2.26 41.69 4.75 9.7 7.25 13.46 34.45 13 36 .33 1.22 1.65 1.49 2 0 .72-10.3 0-63.73-57-63-57 .73-57.72 52.7-57 63Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","theCaesarAndSidePart":"<path d=\"M78 98c-.33 1.22-1.65 1.49-2 0-.72-10.3 0-62.27 57-63 57-.73 57.72 52.7 57 63-.35 1.49-1.67 1.22-2 0 .46-1.55-3.3-28.75-13-36-1.76-1.22-7.25-2.39-14.64-3.26L164 50l-6.98 8.38c-7.03-.7-15.36-1.13-23.7-1.13C114 57.23 94.61 59.48 91 62c-9.7 7.25-13.46 34.45-13 36Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/>","bigHair":"<path d=\"M44.83 105.6c-.39-1.61-.77-3.24-1.13-4.92-1.95-9.23-2.95-20.22 2.89-39.67-6.9 22.99-4.25 34.15-1.76 44.58 1.23 5.2 2.43 10.2 2.37 16.4a15.44 15.44 0 0 0 0 0c.06-6.2-1.14-11.21-2.37-16.4ZM218.38 114.23c-.13.4-.16.8-.18 1.23l.18-1.23ZM218.05 116.81c-.11 1.09-.2 2.2-.23 3.35-29.04-10.76-54.94-29.62-70.32-51.55-12.1 15.62-31.96 23.04-51.63 30.4-17.38 6.5-34.62 12.94-46.2 24.94l1.09-1.5c11-14.6 28.76-21.88 46.7-29.24 18.82-7.71 37.82-15.5 49.39-31.9 15.4 24.1 41.81 44.65 71.16 55.63l.04-.12Z\" fill=\"#000\" fill-opacity=\".16\"/><path d=\"M32 280h1v-9a72 72 0 0 1 72-72h4v-18.39a56.03 56.03 0 0 1-31.8-45.74A12 12 0 0 1 67 123v-13c0-.8.08-1.57.22-2.32 9.12-5.82 19.65-10.13 30.24-14.48 18.81-7.71 37.82-15.5 49.39-31.9C158.8 80 177.4 96.6 198.87 108.2c.08.59.13 1.19.13 1.8v13a12 12 0 0 1-10.2 11.87A56.03 56.03 0 0 1 157 180.6V199h4a72 72 0 0 1 72 72v9c24.41-13.94 15.86-33.21 6.28-48.46a303.17 303.17 0 0 0-4.07-6.27c-3.48-5.25-6.45-9.74-7.2-12.97-.1-.46-.17-.9-.18-1.3-.14-4.62 3.14-7.84 7.16-11.78 6.22-6.08 14.18-13.89 14.01-31.22-.51-15.83-9.8-22.25-18.1-28-6.93-4.78-13.17-9.1-13.1-18-.01-1.82.08-3.54.25-5.19.11-.4.13-.83.15-1.25v-.1c.45-3.44 1.2-6.62 1.98-9.87 2.55-10.72 5.3-22.23-2.38-46.59-2.9-9.12-6.97-16.5-12.1-22.46-14.12-16.42-36.35-22.04-64.9-23.29-2.55-.11-5.15-.19-7.8-.23V13h-1c-43.08.77-73.16 9.54-84.8 46-7.67 24.36-4.93 35.87-2.37 46.6 1.23 5.19 2.43 10.2 2.37 16.4.03 3.75-1.06 6.7-2.85 9.2-2.46 3.43-6.23 6.04-10.24 8.8-8.3 5.75-17.6 12.17-18.1 28-.17 17.33 7.8 25.14 14.01 31.22 4.03 3.94 7.32 7.16 7.17 11.78-.08 3.26-3.4 8.27-7.38 14.27-10.54 15.9-25.7 38.8 2.2 54.73Z\" fill=\"{{hair}}\" stroke=\"{{ink}}\" stroke-width=\"{{sw}}\" stroke-linejoin=\"round\"/><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M50.58 122.45c22.54-29.92 73.49-29.13 96.09-61.15 15.4 24.1 41.82 44.65 71.16 55.63.3-.86.08-1.85.37-2.7 2.15-14.14 9.14-24.37-.58-55.23-11.63-36.46-41.71-45.23-84.8-45.98l-1-.02c-43.08.77-73.16 9.54-84.8 46-11.38 36.16.17 44 0 63 .04 3.75-1.05 6.7-2.85 9.2.19.4 4.16-5.76 6.41-8.75Z\" fill=\"#fff\" fill-opacity=\".2\"/>"}};

export const SKIN = ["#f2d1b3", "#e3b48c", "#c68c60", "#9a6740", "#6e4528"];
// brown is a deep chocolate on purpose: it stays clear of every skin tone (the darkest skin is #6e4528)
export const HAIR_HEX = { black: "#121118", brown: "#3d2415", blonde: "#e6c04e", red: "#c23a2a", grey: "#a9a9b3", none: "#4a3d34" };
export const HAIR_COLORS = ["black", "brown", "blonde", "red", "grey"];
export const CLOTH = ["#3b4a63", "#7a2e3a", "#2f5d4a", "#5a4a7a", "#8a5a2a", "#2f2f3a", "#8a8f9a", "#a34a3a"];
export const ACCENTS = ["#c83e3b", "#d99b26", "#2f5d8a", "#e6dcc2", "#7a4a8a", "#3f7d52"];
export const HAT_COLORS = ["#3c342f", "#7a2e3a", "#2f6270", "#27324a", "#5a4a7a", "#2f5d4a", "#8a5a2a", "#a34a3a"];
export const FRAME_COLORS = ["#1A1A22", "#1A1A22", "#3b2a20", "#7a2e3a", "#2f5d8a", "#5a4a7a"];

/** Hair: [gender m|f|x, length, x0, x1, y0, y1] = bounding box of the part in the 280×280 art (measured). */
export const HAIR_META = {
  dreads01: ["m", "short", 73, 189, 19, 100], dreads02: ["m", "long", 37, 221, 0, 181], fro: ["m", "short", 17, 248, 0, 192],
  shortCurly: ["m", "short", 73, 193, 9, 99], shortFlat: ["m", "short", 74, 190, 17, 98], shortRound: ["m", "short", 74, 191, 26, 98],
  shortWaved: ["m", "short", 71, 195, 10, 99], sides: ["m", "short", 70, 195, 74, 101], theCaesar: ["m", "short", 76, 189, 35, 98],
  theCaesarAndSidePart: ["m", "short", 76, 189, 35, 98],
  bigHair: ["f", "long", 16, 248, 13, 279], bob: ["f", "short", 40, 225, 20, 200], bun: ["f", "short", 74, 191, 0, 98],
  curly: ["f", "short", 25, 240, 10, 199], frida: ["f", "short", 57, 206, 0, 188], froBand: ["f", "short", 1, 260, 0, 194],
  longButNotTooLong: ["f", "short", 50, 206, 18, 189], miaWallace: ["f", "short", 40, 225, 20, 195],
  straight01: ["f", "long", 40, 240, 15, 265], straight02: ["f", "long", 59, 206, 18, 275], straightAndStrand: ["f", "long", 59, 206, 18, 212],
  curvy: ["f", "long", 26, 240, 16, 279], dreads: ["f", "long", 16, 254, 14, 276], frizzle: ["x", "short", 89, 191, 9, 55],
  shaggy: ["x", "short", 70, 216, 23, 111], shaggyMullet: ["x", "long", 49, 195, 24, 191], shavedSides: ["x", "long", 68, 227, 8, 241],
};
/** Hats: [gender, x0, x1, y0, y1, coversAllHair] measured the same way. Only the wide-brim hat shows hair. */
export const HAT_META = {
  hat: ["x", 11, 254, 2, 138, false], winterHat02: ["x", 61, 204, 0, 249, true], winterHat03: ["x", 64, 201, 0, 103, true],
  winterHat04: ["x", 64, 201, 4, 103, true], turban: ["m", 49, 216, 3, 140, true], winterHat1: ["m", 63, 202, 20, 184, true],
  hijab: ["f", 51, 220, 21, 279, true],
};
/**
 * Hat rule (for the hats that leave hair visible, i.e. the wide-brim hat). The hair must not be wider than the hat
 * (x-range inside the hat) and must not rise above the hat's crown. With STRICT_HAT_HEIGHT = true the hair's total
 * height (crown to tips) must also not exceed the hat's, which would rule out every long style under any hat.
 * Hats that cover all hair never conflict with hair: the hair is simply not drawn.
 */
export const STRICT_HAT_HEIGHT = false;
/** Hair that is ruled out under a hat even though its box fits: it pokes through or looks wrong. */
export const HAT_BLOCKS = { hat: new Set(["frizzle", "shortCurly", "shortWaved", "dreads", "bigHair", "shavedSides", "curly"]) };
/** Retired: kept in the kit, never rolled by the casting and never offered in the Lab. */
export const RETIRED = { hair: new Set(["frida", "shavedSides"]), eyes: new Set(["hearts", "xDizzy", "cry"]), mouth: new Set(["vomit"]), accessories: new Set(["eyepatch"]) };
export const CAST_SKIP = new Set(["sides", "frizzle"]); // thin on top / a loose tuft: in the Lab, never cast
export const genderOk = (g, who) => g === "x" || g === who;
export const hidesHair = (hat) => !!(HAT_META[hat] && HAT_META[hat][5]);
export function hatFits(hair, hat) {
  const h = HAIR_META[hair], t = HAT_META[hat];
  if (!h || !t || t[5]) return true;
  if (HAT_BLOCKS[hat] && HAT_BLOCKS[hat].has(hair)) return false;
  const top = STRICT_HAT_HEIGHT ? h[5] - h[4] <= t[4] - t[3] : h[4] >= t[3];
  return h[2] >= t[1] && h[3] <= t[2] && top;
}
export const hairList = (who, len, skip = false) => Object.keys(HAIR_META)
  .filter((n) => genderOk(HAIR_META[n][0], who) && HAIR_META[n][1] === len && !RETIRED.hair.has(n) && !(skip && CAST_SKIP.has(n)));
export const hatList = (who) => Object.keys(HAT_META).filter((n) => genderOk(HAT_META[n][0], who));
export const DEFAULT_HAIR = { m: { short: "shortFlat", long: "curvy" }, f: { short: "bob", long: "straight01" } };

export const HAIR_LENGTHS = ["bald", "short", "long"];
export const HATS = ["none", "hat", "winterHat02", "winterHat03", "winterHat04", "winterHat1", "turban", "hijab"];
export const HAT_LABEL = { none: "none", hat: "wide-brim hat", winterHat02: "flap cap", winterHat03: "pom beanie", winterHat04: "cat beanie", winterHat1: "aviator cap", turban: "turban", hijab: "hijab" };
export const GLASSES = ["none", "round", "prescription01", "prescription02", "wayfarers", "sunglasses", "kurt"]; // pool (retired: eyepatch)
export const GLASS_LABEL = { none: "none", round: "round", prescription01: "prescription 1", prescription02: "prescription 2", wayfarers: "wayfarers", sunglasses: "sunglasses", kurt: "kurt (f)" };
export const BEARDS = ["none", "moustacheFancy", "moustacheMagnum", "beardLight", "beardMedium", "beardMajestic"];
export const BEARD_LABEL = { none: "none", moustacheFancy: "fancy moustache", moustacheMagnum: "magnum moustache", beardLight: "light beard", beardMedium: "medium beard", beardMajestic: "majestic beard" };
export const TIES = ["none", "necktie", "bowtie", "scarf"];
export const EYES = ["default", "side", "squint", "happy", "surprised", "eyeRoll", "wink", "winkWacky", "closed"]; // pool (retired: cry, xDizzy, hearts)
export const BROWS = ["defaultNatural", "default", "flatNatural", "frownNatural", "angryNatural", "angry", "raisedExcitedNatural", "raisedExcited", "sadConcernedNatural", "sadConcerned", "upDownNatural", "upDown", "unibrowNatural"];
export const MOUTHS = ["default", "smile", "twinkle", "serious", "concerned", "disbelief", "sad", "grimace", "eating", "tongue", "screamOpen"]; // pool (retired: vomit)
/* Beach wear (Beach biome only, never rolled by the random cast): bare chest for men, a halter bikini top for women.
 * Drawn in the absolute 280×280 portrait frame on top of the skin torso that the base figure already has. */
AV.clothing.shirtless = `<g transform="translate(0 -170)" fill="none" stroke="{{ink}}" stroke-linecap="round" stroke-linejoin="round">
  <path d="M108 216Q88 218 68 238M156 216Q176 218 196 238" stroke-width="{{sw}}" stroke-opacity=".2"/></g>`;
AV.clothing.bikini = `<g transform="translate(0 -170)" stroke-linecap="round" stroke-linejoin="round">
  <path d="M100 250L106 196M164 250L158 196" fill="none" stroke="{{ink}}" stroke-width="10"/>
  <path d="M100 250L106 196M164 250L158 196" fill="none" stroke="{{clothes}}" stroke-width="3.6"/>
  <path d="M100 248L74 292H126Z" fill="{{clothes}}" stroke="{{ink}}" stroke-width="{{sw}}"/>
  <path d="M164 248L138 292H190Z" fill="{{clothes}}" stroke="{{ink}}" stroke-width="{{sw}}"/>
  <path d="M99 256L90 272M163 256L154 272" fill="none" stroke="#fff" stroke-width="3.2" stroke-opacity=".3"/></g>`;
export const CLOTHING = ["blazerAndShirt", "blazerAndSweater", "collarAndSweater", "shirtCrewNeck", "shirtVNeck", "shirtScoopNeck", "hoodie", "overall", "shirtless", "bikini"];
export const CLOTHING_GENDER = { shirtScoopNeck: "f", shirtless: "m", bikini: "f" };
export const TIE_GENDER = { necktie: "m", bowtie: "m", scarf: "x" };
/** Which clothing each piece of neckwear can be worn with (first = the default). */
export const TIE_CLOTHING = {
  necktie: ["blazerAndSweater"],
  bowtie: ["blazerAndShirt", "blazerAndSweater", "collarAndSweater", "shirtCrewNeck"],
  scarf: ["shirtCrewNeck", "shirtVNeck", "shirtScoopNeck"],
};
export const clothingOk = (c, g) => genderOk(CLOTHING_GENDER[c] || "x", g);
export const tieOk = (tie, g, clothing) => tie === "none" || (genderOk(TIE_GENDER[tie], g) && TIE_CLOTHING[tie].includes(clothing) && clothingOk(clothing, g));
export const CLOTHING_LABEL = { blazerAndShirt: "blazer + shirt", blazerAndSweater: "blazer + sweater", collarAndSweater: "collar + sweater", shirtCrewNeck: "crew neck", shirtVNeck: "V-neck", shirtScoopNeck: "scoop neck (f)", hoodie: "hoodie", overall: "overalls", shirtless: "shirtless (m, beach)", bikini: "bikini top (f, beach)" };
export const humanize = (s) => String(s).replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase();

/* ---- eyelashes: generated per eye shape, drawn only for women, never over hearts ---- */
export const rad = (d) => (d * Math.PI) / 180, f1 = (n) => Math.round(n * 10) / 10;
export function lashPath({ cx, cy, rx, ry, outer, kind, lid = true }) { // outer: -1 = outer corner on the left, +1 on the right
  const at = (th, k = 1) => [cx + rx * k * Math.cos(rad(th)), cy + ry * k * Math.sin(rad(th))];
  const flip = (th) => (outer < 0 ? th : 180 - th);
  const ang = kind === "top" ? [252, 228, 205] : [158, 138, 118];
  let d = "";
  if (lid) { const a = at(flip(200)), b = at(flip(340)); d += `M${f1(a[0])} ${f1(a[1])}A${rx} ${ry} 0 0 ${outer < 0 ? 1 : 0} ${f1(b[0])} ${f1(b[1])}`; }
  const len = 5.8 + rx * 0.2;
  ang.forEach((th, i) => {
    const t = flip(th), [sx, sy] = at(t, 1.04);
    let nx = Math.cos(rad(t)) / rx, ny = Math.sin(rad(t)) / ry; const m = Math.hypot(nx, ny); nx /= m; ny /= m;
    nx += (outer < 0 ? -1 : 1) * 0.28 * (i + 1) * 0.5; ny += kind === "top" ? -0.12 : 0.12;
    const mm = Math.hypot(nx, ny);
    d += `M${f1(sx)} ${f1(sy)}L${f1(sx + (nx / mm) * len)} ${f1(sy + (ny / mm) * len)}`;
  });
  return d;
}
export const mirrorEye = (e) => ({ ...e, cx: 112 - e.cx, outer: -e.outer });
export const EYE_LASH = (() => {
  const dot = { cx: 30, cy: 22, rx: 6.5, ry: 6.5, outer: -1, kind: "top" };
  const big = { cx: 30, cy: 22, rx: 14.5, ry: 14.5, outer: -1, kind: "top" };
  const pairs = {
    default: [dot], cry: [dot], side: [{ cx: 28.5, cy: 22.5, rx: 8.5, ry: 7, outer: -1, kind: "top" }],
    eyeRoll: [big], surprised: [big], squint: [{ cx: 30, cy: 20.7, rx: 14.5, ry: 8.2, outer: -1, kind: "top" }],
    happy: [{ cx: 27, cy: 22.4, rx: 11, ry: 6.4, outer: -1, kind: "top", lid: false }],
    closed: [{ cx: 27, cy: 27.5, rx: 11, ry: 6.5, outer: -1, kind: "bottom", lid: false }],
    xDizzy: [{ cx: 29, cy: 22, rx: 9.5, ry: 9.5, outer: -1, kind: "top", lid: false }],
  };
  const out = {};
  for (const [k, l] of Object.entries(pairs)) out[k] = [...l, ...l.map(mirrorEye)].map(lashPath).join("");
  out.winkWacky = lashPath({ cx: 27, cy: 25.4, rx: 11, ry: 6.4, outer: -1, kind: "top", lid: false }) + lashPath({ cx: 82, cy: 22, rx: 12.5, ry: 12.5, outer: 1, kind: "top" });
  out.wink = lashPath(dot) + lashPath({ cx: 81.4, cy: 25, rx: 10.8, ry: 7.8, outer: 1, kind: "top", lid: false });
  return out; // hearts: none, on purpose
})();

/* ---- neckwear (avataaars has none): drawn in the same flat style, in base coordinates ---- */
export const TIE_STROKE = 'stroke="{{ink}}" stroke-width="{{sw}}" stroke-linejoin="round"';
export const TIE_SVG = {
  // hangs from the collar, knot at the base of the V
  necktie: `<path d="M118 246L146 246L152 266L132 278L112 266Z" fill="{{tie}}" ${TIE_STROKE}/><path d="M120 248L144 248L146 256L118 256Z" fill="#000" fill-opacity=".14"/><path d="M128 259L137 268" stroke="#fff" stroke-opacity=".32" stroke-width="3" stroke-linecap="round"/><path d="M123 230L141 230L146 246L118 246Z" fill="{{tieD}}" ${TIE_STROKE}/>`,
  bowtie: `<g transform="translate(0 6)"><path d="M131 213L103 197C96 211 96 225 103 236Z" fill="{{tie}}" ${TIE_STROKE}/><path d="M133 213L161 197C168 211 168 225 161 236Z" fill="{{tie}}" ${TIE_STROKE}/><path d="M111 208L123 213L111 222M155 208L143 213L155 222" fill="none" stroke="#000" stroke-opacity=".2" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><rect x="124" y="204" width="17" height="19" rx="5" fill="{{tieD}}" ${TIE_STROKE}/></g>`,
  // wound up around the neck, one tail hanging in front (nothing over the shoulders)
  scarf: `<path d="M104 214L88 266L118 274L134 226Z" fill="{{tie}}" ${TIE_STROKE}/><path d="M93 258L119 266M97 247L125 255" stroke="#fff" stroke-opacity=".28" stroke-width="3" stroke-linecap="round"/><path d="M98 184C112 199 152 199 166 184L172 206C150 226 114 226 92 206Z" fill="{{tie}}" ${TIE_STROKE}/><path d="M104 200C118 210 148 210 160 200" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="3.2" stroke-linecap="round"/><path d="M110 191L106 205M132 197V212M154 191L158 205" stroke="#000" stroke-opacity=".16" stroke-width="2.6" stroke-linecap="round"/>`,
};

export const blend = (a, b, t) => { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const ch = (sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t); return "#" + [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, "0")).join(""); };
/** A backdrop before the suspect is placed: the same hue, drained into cool slate. */
export const mutedBack = (hex) => blend(hex, "#4b5163", 0.8);
/** INK or CREAM, whichever reads better on the colour `hex` (the suspect's initial sits on a disc of their own background colour). */
export const inkOn = (hex) => { const n = parseInt(String(hex).slice(1), 16), l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.55 ? INK : CREAM; };

export const fillT = (s, t) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => (t[k] == null ? "" : t[k]));

/**
 * Repair a look so it obeys every rule, keeping the clue traits (gender, hair colour + length, glasses, hat, tie)
 * wherever possible: gender-specific parts, one accessory, hair that fits the hat. Safe to call on any object.
 */
export function fixLook(L) {
  const g = L.gender === "m" ? "m" : "f";
  const o = { ...L, gender: g };
  if (g === "f") { o.facialHair = "none"; if (o.brows === "unibrowNatural") o.brows = "defaultNatural"; }
  else if (!BEARDS.includes(o.facialHair)) o.facialHair = "none";
  if (!AV.eyes[o.eyes]) o.eyes = "default";
  if (!AV.eyebrows[o.brows]) o.brows = "defaultNatural";
  if (!AV.mouth[o.mouth]) o.mouth = "default";
  if (!AV.clothing[o.clothing]) o.clothing = "shirtCrewNeck";
  if (!clothingOk(o.clothing, g)) o.clothing = "shirtCrewNeck";
  if (!TIES.includes(o.tie)) o.tie = "none";
  if (o.tie !== "none") {
    if (!genderOk(TIE_GENDER[o.tie], g)) o.tie = "scarf"; // women: no necktie or bowtie, the neckwear becomes a scarf
    const okC = TIE_CLOTHING[o.tie].filter((c) => clothingOk(c, g));
    if (!okC.includes(o.clothing)) o.clothing = okC[0];
  }
  if (g === "m" && o.glassesStyle === "kurt") o.glassesStyle = "round";
  if (!AV.accessories[o.glassesStyle] || o.glassesStyle === "eyepatch") o.glassesStyle = "none";
  o.glasses = o.glassesStyle !== "none";
  if (o.glasses) o.eyepatch = false;
  if (!o.hat || !HAT_META[o.hat] || !genderOk(HAT_META[o.hat][0], g)) o.hat = "none";
  if (o.hairStyle === "bald" || o.hairLength === "bald") { o.hairStyle = "bald"; o.hairLength = "bald"; o.hairColor = "none"; }
  else {
    const len = o.hairLength === "long" ? "long" : "short";
    const pool = hairList(g, len);
    let h = o.hairStyle;
    if (!HAIR_META[h] || !genderOk(HAIR_META[h][0], g) || HAIR_META[h][1] !== len) h = pool.includes(DEFAULT_HAIR[g][len]) ? DEFAULT_HAIR[g][len] : pool[0];
    if (o.hat !== "none" && !hatFits(h, o.hat)) {
      const alt = pool.filter((x) => !CAST_SKIP.has(x)).find((x) => hatFits(x, o.hat));
      if (alt) h = alt; else o.hat = hatFits(h, "hat") ? "hat" : "none";
    }
    o.hairStyle = h; o.hairLength = len;
    if (!HAIR_HEX[o.hairColor] || o.hairColor === "none") o.hairColor = "brown";
  }
  return o;
}

export const svgCache = new Map();
/** The portrait as SVG markup in the 280×280 avataaars frame (cached). `look.pal` can override colours (Adow). */
export function composeLook(look, sw = 4.2) {
  const L = fixLook(look), pal = L.pal || {};
  const ck = JSON.stringify([L, sw]);
  if (svgCache.has(ck)) return svgCache.get(ck);
  const hat = L.hat !== "none" ? L.hat : null, hides = hat && hidesHair(hat);
  const bald = L.hairStyle === "bald";
  const hairHex = pal.hair || HAIR_HEX[L.hairColor] || HAIR_HEX.brown;
  const t = {
    ink: pal.ink || INK, sw, sw2: +(sw * 0.6).toFixed(2),
    skin: pal.skin || SKIN[L.skin % SKIN.length], hair: hairHex,
    hat: pal.hat || HAT_COLORS[(L.hatC || 0) % HAT_COLORS.length], clothes: pal.clothes || CLOTH[L.cloth % CLOTH.length],
    facialHair: bald || L.hairColor === "none" ? "#4a3d34" : hairHex,
    accessories: pal.frame || FRAME_COLORS[(L.frameC || 0) % FRAME_COLORS.length], accent: ACCENTS[(L.accent || 0) % ACCENTS.length],
  };
  const tie = ACCENTS[(L.accent || 0) % ACCENTS.length];
  const g = (tr, inner) => (inner ? `<g transform="${tr}">${fillT(inner, t)}</g>` : "");
  const lashes = L.gender === "f" && L.eyes !== "hearts" && EYE_LASH[L.eyes]
    ? `<path d="${EYE_LASH[L.eyes]}" fill="none" stroke="${t.ink === INK ? INK : "#000"}" stroke-width="${(sw * 0.64).toFixed(2)}" stroke-linecap="round"/>` : "";
  let clothing = AV.clothing[L.clothing];
  if (pal.shirt) clothing = clothing.split("#e4dcc8").join(pal.shirt).split("#f1ead8").join(pal.shirt);
  let s = fillT(AV.base, t);
  s += g("translate(0 170)", clothing);
  if (L.tie !== "none" && TIE_SVG[L.tie]) s += fillT(TIE_SVG[L.tie], { ...t, tie: pal.tie || tie, tieD: mix(pal.tie || tie, -0.3) });
  s += g("translate(78 134)", AV.mouth[L.mouth]);
  s += g("translate(104 122)", AV.nose);
  s += g("translate(76 90)", AV.eyes[L.eyes] + lashes);
  s += g("translate(76 82)", AV.eyebrows[L.brows]);
  const hairKey = bald || hides ? null : L.hairStyle;
  s += g("translate(-1)", (hairKey ? AV.hair[hairKey] : "") + (hat ? AV.hat[hat] : ""));
  s += g("translate(49 72)", L.facialHair !== "none" ? AV.facialHair[L.facialHair] : "");
  s += g("translate(62 42)", L.glasses ? AV.accessories[L.glassesStyle] : L.eyepatch ? AV.accessories.eyepatch : "");
  const out = `<g transform="translate(8)">${s}</g>`;
  if (svgCache.size > 600) svgCache.clear();
  svgCache.set(ck, out);
  return out;
}

/**
 * The portrait, drawn into a 96×96 box (the Polaroid photo and the 38px token both use it).
 * zoom 1 = the whole 280×280 avataaar (hats and shoulders included); zoom > 1 crops in on the face.
 */
export function Figure({ look, sw = 4.2, zoom = 1, cy = 140 }) {
  const k = (96 / 280) * zoom;
  if (look && look.dummy) return <g transform={`translate(48 48) scale(${k}) translate(-140 ${-cy})`} dangerouslySetInnerHTML={{ __html: dummySvg(look.dummyColor, sw) }} />;
  return <g transform={`translate(48 48) scale(${k}) translate(-140 ${-cy})`} dangerouslySetInnerHTML={{ __html: composeLook(look || {}, sw) }} />;
}

/**
 * A crash-test dummy, drawn in the same 280×280 space as the avataaars (head centre ≈ 132,104): a smooth featureless head with the two
 * quartered target discs for eyes, a flat mouth, neck rings and a chest seam. `color` is the body colour; the tutorial gives every suspect a different one.
 */
export function dummySvg(color = "#e8a24a", sw = 4.2) {
  const c = color, dk = mix(c, -0.28), lt = mix(c, 0.35), ink = "#1b1b24", s = (+sw || 4.2).toFixed(2);
  const eye = (cx) => `<g transform="translate(${cx} 100)"><circle r="17" fill="#fff" stroke="${ink}" stroke-width="${s}"/><path d="M0 0V-17A17 17 0 0 1 17 0ZM0 0V17A17 17 0 0 1 -17 0Z" fill="${ink}"/></g>`;
  return `<g transform="translate(8)">`
    + `<path d="M24 280V260C24 226 52 208 92 204H172C212 208 240 226 240 260V280Z" fill="${dk}" stroke="${ink}" stroke-width="${s}" stroke-linejoin="round"/>`
    + `<path d="M104 206 132 244 160 206" fill="none" stroke="${ink}" stroke-width="${(s * 0.7).toFixed(2)}" stroke-linejoin="round" opacity=".55"/>`
    + `<path d="M132 244V280" stroke="${ink}" stroke-width="${(s * 0.7).toFixed(2)}" opacity=".4"/>`
    + `<rect x="110" y="166" width="44" height="46" rx="8" fill="${dk}" stroke="${ink}" stroke-width="${s}"/>`
    + `<path d="M110 182H154M110 196H154" stroke="${ink}" stroke-width="${(s * 0.6).toFixed(2)}" opacity=".5"/>`
    + `<ellipse cx="132" cy="104" rx="55" ry="68" fill="${c}" stroke="${ink}" stroke-width="${s}"/>`
    + `<ellipse cx="108" cy="70" rx="22" ry="30" fill="${lt}" opacity=".45" transform="rotate(-18 108 70)"/>`
    + `<path d="M77 104H187" stroke="${ink}" stroke-width="${(s * 0.5).toFixed(2)}" opacity=".18"/>`
    + `<circle cx="77" cy="116" r="6" fill="${dk}" stroke="${ink}" stroke-width="${(s * 0.7).toFixed(2)}"/><circle cx="187" cy="116" r="6" fill="${dk}" stroke="${ink}" stroke-width="${(s * 0.7).toFixed(2)}"/>`
    + eye(108) + eye(156)
    + `<path d="M118 146H146" fill="none" stroke="${ink}" stroke-width="${(s * 1.1).toFixed(2)}" stroke-linecap="round"/>`
    + `</g>`;
}
/** Names for the 14 suspect colours (used for the dummies' "traits"). */
export const SUSPECT_COLOR_NAMES = ["orange", "sky-blue", "lilac", "green", "pink", "yellow", "aqua", "coral", "steel-grey", "periwinkle", "sand", "lime", "orchid", "teal"];


/* ---------------------------------------------------------------------- */
/*  Casting: deterministic per puzzle, clue-safe                            */
/* ---------------------------------------------------------------------- */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rngOf = (...parts) => mulberry32(hash(parts.join("|")));
export const pickOf = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
export const pickW = (rnd, pairs) => {
  const tot = pairs.reduce((s, [, w]) => s + w, 0);
  let x = rnd() * tot;
  for (const [v, w] of pairs) { x -= w; if (x <= 0) return v; }
  return pairs[pairs.length - 1][0];
};

/** The stock names of the old static cast. A puzzle that still uses them gets a fresh cast. */
export const OLD_NAMES = { Ada: "f", Boris: "m", Celeste: "f", Dmitri: "m", Esme: "f", Felix: "m", Greta: "f", Hugo: "m", Iris: "f" };
/** Fresh names start with the suspect's letter, so "Suspect D" is always a D. */
export const NAME_POOL = {
  A: { m: ["Ambrose", "Anselm"], f: ["Agatha", "Annabel"] }, B: { m: ["Barnaby", "Bertram"], f: ["Beatrix", "Blanche"] },
  C: { m: ["Cyril", "Conrad"], f: ["Cosima", "Clementine"] }, D: { m: ["Desmond", "Dashiell"], f: ["Delphine", "Dorothea"] },
  E: { m: ["Everett", "Edmund"], f: ["Eloise", "Elspeth"] }, F: { m: ["Fenwick", "Fitzgerald"], f: ["Fiona", "Florence"] },
  G: { m: ["Gideon", "Gustav"], f: ["Genevieve", "Gwendolyn"] }, H: { m: ["Horatio", "Hobart"], f: ["Harriet", "Henrietta"] },
  I: { m: ["Ignatius", "Ivor"], f: ["Imogen", "Ingrid"] }, J: { m: ["Jasper", "Jerome"], f: ["Josephine", "Juliet"] },
  K: { m: ["Konrad", "Kit"], f: ["Katarina", "Kitty"] }, L: { m: ["Leopold", "Lucian"], f: ["Lenore", "Lavinia"] },
  M: { m: ["Maximilian", "Montague"], f: ["Marguerite", "Millicent"] }, N: { m: ["Nathaniel", "Nigel"], f: ["Nadia", "Nell"] },
  O: { m: ["Octavian", "Orson"], f: ["Ottoline", "Odette"] }, P: { m: ["Percival", "Peregrine"], f: ["Philippa", "Prudence"] },
};


/** How often a generated character (no trait given by the puzzle) wears each extra. Kept low on purpose. */
export const P_HAT = 0.14, P_GLASSES = 0.18, P_TIE = 0.2;

/* ---- trait vocabulary: the puzzle JSON's names (and synonyms) → avataaars parts ---- */
export const LEGACY_HAIR = {
  crop: ["shortFlat", "shortRound", "bob"], short: ["shortFlat", "theCaesar", "shortWaved", "bob"],
  curly: ["shortCurly", "curly", "shaggy"], wavy: ["shortWaved", "curvy", "straightAndStrand"],
  bob: ["bob", "miaWallace", "longButNotTooLong"], bun: ["bun", "straight02", "curvy"],
  ponytail: ["straightAndStrand", "straight02", "straight01"], long: ["straight01", "straight02", "curvy", "bigHair"],
};
export const LEGACY_HAT = { fedora: ["hat"], beret: ["winterHat03"], cloche: ["winterHat04", "winterHat03"], peaked: ["winterHat1", "winterHat02"] };
export const LEGACY_BEARD = { mustache: "moustacheMagnum", moustache: "moustacheMagnum", goatee: "beardLight", beard: "beardMedium" };
export const LEGACY_GLASSES = { "horn-rimmed": "prescription02", square: "prescription02", round: "round" };

/** Words of the look vocabulary in the active language: ui.look.<group>.<id>, else the English label table (`fb`). */
const lookWord = (t, key, fb) => { const v = t(key); return v && v !== key ? v : fb; };
const docLang = () => { try { return document.documentElement.lang || undefined; } catch (err) { return undefined; } };
const capFirst = (x) => { if (!x) return x; try { return x.charAt(0).toLocaleUpperCase(docLang()) + x.slice(1); } catch (err) { return x.charAt(0).toUpperCase() + x.slice(1); } };
const colorWord = (t, name) => lookWord(t, `look.color.${String(name || "plain").replace(/-(\w)/g, (m, c) => c.toUpperCase())}`, name || "plain");
const hairWords = (t, L) => t("look.hairValue", {
  color: lookWord(t, `look.hairColor.${L.hairColor}`, L.hairColor), length: lookWord(t, `look.hairLength.${L.hairLength}`, L.hairLength),
});
const hatWord = (t, h) => lookWord(t, `look.hat.${h}`, HAT_LABEL[h]);
const glassesWord = (t, g) => lookWord(t, `look.glasses.${g}`, GLASS_LABEL[g] || g);
const beardWord = (t, b) => lookWord(t, `look.beard.${b}`, BEARD_LABEL[b] || b);
const tieWord = (t, x) => lookWord(t, `look.tie.${x}`, x);

/** The same look as a readable table for the Suspect card: [[label, value], …] in the language of `t`. */
export function lookFacts(L, t = tEn) {
  const none = t("look.none"), F = (k) => t(`look.fact.${k}`);
  if (L.dummy) return [[F("type"), t("look.dummy.type")], [F("colour"), capFirst(colorWord(t, L.dummyName))], [F("hair"), t("look.dummy.hair")], [F("glasses"), none], [F("hat"), none], [F("neckwear"), none]];
  const hatHides = L.hat && L.hat !== "none" && hidesHair(L.hat);
  const hair = L.hairLength === "bald" ? t("look.bald") : hatHides ? t("look.hairHidden") : capFirst(hairWords(t, L));
  const rows = [
    [F("gender"), t(L.gender === "f" ? "look.gender.f" : "look.gender.m")],
    [F("hair"), hair],
    [F("glasses"), L.glasses && L.glassesStyle !== "none" ? capFirst(glassesWord(t, L.glassesStyle)) : none],
    [F("hat"), L.hat && L.hat !== "none" ? capFirst(hatWord(t, L.hat)) : none],
  ];
  if (L.gender !== "f") rows.push([F("facialHair"), !L.facialHair || L.facialHair === "none" ? none : capFirst(beardWord(t, L.facialHair))]);
  rows.push([F("neckwear"), L.tie && L.tie !== "none" ? capFirst(tieWord(t, L.tie)) : none]);
  return rows;
}
/** Hair for a gender and length that also sits under `hat` (when given). Prefers the hinted styles, then anything. */
export function pickHair(rnd, g, len, hat, hint) {
  const pool = hairList(g, len, true).filter((n) => !hat || hatFits(n, hat));
  if (!pool.length) return null;
  return pool.includes(hint) ? hint : pickOf(rnd, pool); // only an exact avataaars name is honoured; the old style words just pick the length
}

/** Accept the puzzle JSON's trait vocabulary (and a few synonyms) and make it complete. `ctx.hideOk` allows turban / hijab. */
export function normTraits(t = {}, g, rnd, ctx = {}) {
  const out = {};
  let len = HAIR_LENGTHS.includes(t.hairLength) ? t.hairLength : undefined;
  if (!len && t.hairStyle === "bald") len = "bald";
  if (!len && HAIR_META[t.hairStyle]) len = HAIR_META[t.hairStyle][1];
  if (!len && t.hairStyle && LEGACY_HAIR[t.hairStyle]) len = ["bun", "ponytail", "long", "wavy"].includes(t.hairStyle) ? "long" : "short";
  if (!len) len = g === "f" ? pickOf(rnd, ["long", "long", "short", "short"]) : pickOf(rnd, ["short", "short", "short", "long", "bald"]);
  out.hairLength = len;
  out.hairColor = len === "bald" ? "none" : (HAIR_COLORS.includes(t.hairColor) ? t.hairColor : (t.hairColor === "gray" ? "grey" : pickW(rnd, [["black", 3], ["brown", 3], ["blonde", 2], ["red", 1.4], ["grey", 1]])));

  // glasses
  const gs0 = LEGACY_GLASSES[t.glassesStyle] || t.glassesStyle;
  const wears = t.glasses === true || (t.glasses === undefined && gs0 && gs0 !== "none") || (t.glasses === undefined && gs0 === undefined && rnd() < P_GLASSES);
  let gs = "none";
  if (wears) {
    // casting only uses clear-lens frames so "wearing glasses" is never mistaken for sunglasses (wayfarers, sunglasses and kurt stay in the Lab)
    gs = AV.accessories[gs0] && gs0 !== "eyepatch" ? gs0 : pickW(rnd, [["round", 3], ["prescription01", 2], ["prescription02", 2]]);
    if (g === "m" && gs === "kurt") gs = "round";
  }
  out.glasses = gs !== "none"; out.glassesStyle = gs;

  // hat. Only the wide-brim hat leaves the hair visible; every other hat covers it, so those are only used
  // when no clue talks about hair (an explicit avataaars hat name from the puzzle JSON is always respected)
  let hat = "none";
  if (HAT_META[t.hat]) hat = t.hat;
  else if (LEGACY_HAT[t.hat]) hat = LEGACY_HAT[t.hat].find((h) => genderOk(HAT_META[h][0], g)) || "hat";
  else if (t.hat !== "none" && rnd() < P_HAT) hat = pickOf(rnd, ctx.hideOk ? hatList(g) : ["hat"]);
  if (hat !== "none" && !genderOk(HAT_META[hat][0], g)) hat = g === "m" ? "winterHat1" : "winterHat04";
  if (hat !== "none" && hidesHair(hat) && !ctx.hideOk && !HAT_META[t.hat]) hat = "hat";

  // hair that fits under that hat; otherwise a hat that fits the hair
  let hair = "bald";
  if (len !== "bald") {
    hair = pickHair(rnd, g, len, hat === "none" ? null : hat, t.hairStyle);
    if (!hair && hat !== "none") { // nothing of this length fits under the hat: a hat the puzzle asked for wins over the hair rule
      const asked = t.hat && t.hat !== "none";
      if (!asked) hat = "none";
      hair = pickHair(rnd, g, len, null, t.hairStyle);
    }
  }
  out.hairStyle = hair; out.hat = hat;

  const fh0 = LEGACY_BEARD[t.facialHair] || t.facialHair;
  out.facialHair = g === "f" ? "none" : (BEARDS.includes(fh0) ? fh0 : pickW(rnd, [["none", 3], ["moustacheFancy", 1], ["moustacheMagnum", 1], ["beardLight", 1], ["beardMedium", 1], ["beardMajestic", 0.6]]));
  out.tie = TIES.includes(t.tie) ? t.tie : (rnd() < P_TIE ? pickOf(rnd, g === "m" ? ["necktie", "bowtie", "scarf"] : ["scarf"]) : "none");
  out.skin = Number.isInteger(t.skin) ? t.skin % SKIN.length : Math.floor(rnd() * SKIN.length);
  out.cloth = Number.isInteger(t.cloth) ? t.cloth % CLOTH.length : Math.floor(rnd() * CLOTH.length);
  return out;
}

/** Clothing that suits the neckwear (see TIE_CLOTHING) and the gender. */
export const clothingForTie = (tie, g, rnd) => {
  const pool = tie !== "none" ? TIE_CLOTHING[tie]
    : g === "f" ? ["shirtScoopNeck", "shirtVNeck", "overall", "hoodie", "shirtCrewNeck", "blazerAndSweater", "collarAndSweater"]
      : ["shirtCrewNeck", "hoodie", "overall", "shirtVNeck", "blazerAndShirt", "collarAndSweater"];
  return pickOf(rnd, pool.filter((c) => clothingOk(c, g)));
};

/** Cosmetic extras: nothing a clue can talk about. (Women never roll the male-only unibrow.) */
export function cosmetics(rnd, g, tie, back) {
  return {
    eyes: pickW(rnd, [["default", 5], ["side", 1.5], ["squint", 1.5], ["happy", 1], ["surprised", 0.6], ["eyeRoll", 0.4], ["wink", 0.35]]), // retired eyes are never rolled
    brows: pickW(rnd, BROWS.filter((b) => g === "m" || b !== "unibrowNatural").map((b) => [b, b === "unibrowNatural" ? 0.6 : (/angry|sadConcerned/.test(b) ? 0.6 : 1)])),
    mouth: pickW(rnd, [["default", 3], ["smile", 2.6], ["twinkle", 1.4], ["serious", 2.8], ["concerned", 1], ["disbelief", 0.7]]),
    clothing: clothingForTie(tie, g, rnd),
    accent: Math.floor(rnd() * ACCENTS.length), hatC: Math.floor(rnd() * HAT_COLORS.length), frameC: Math.floor(rnd() * FRAME_COLORS.length),
    eyepatch: false, back, // the eyepatch is retired
  };
}

/** Full look from traits. `over` can force any field (the Portrait Lab uses it). */
export function makeLook(traits, g, rnd, back, over = {}, ctx = {}) {
  const t = normTraits(traits, g, rnd, ctx);
  return fixLook({ gender: g, ...t, ...cosmetics(rnd, g, t.tie, back), ...over });
}

/** Deterministic look from a name. `puzzleId` keeps the same name looking different in different cases. */
export function deriveLook(name, id = "A", puzzleId = "", over = {}) {
  const rnd = rngOf("look", puzzleId, name, id);
  const g = over.gender || OLD_NAMES[name] || (hash(`${puzzleId}${name}`) % 2 ? "m" : "f");
  const idx = Math.max(0, String(id).charCodeAt(0) - 65);
  return makeLook(over.traits || {}, g, rnd, SUSPECT_COLORS[idx % SUSPECT_COLORS.length], over);
}


/** Which look categories do the statements talk about? Those must never be rerolled. */
export function lockedCategories(p) {
  const text = [...p.suspects.map((s) => s.clue), ...(p.globalRules || []).map((g) => g.text), ...(p.steps || []).map((s) => s.text)].join(" \n ");
  return {
    gender: /\b(men|man|male|women|woman|female|he|she|his|her)\b/i.test(text),
    hairColor: /\b(black|brown|blonde?|red|gr[ae]y)[- ]?(haired|hair)\b/i.test(text),
    hairLength: /\b(long|short)[- ]?(haired|hair)\b|\bbald\b/i.test(text),
    glasses: /glasses|spectacles/i.test(text),
    hat: /\b(hat|hats|fedora|beret|cloche|cap|peaked)\b/i.test(text),
    facialHair: /beard|mustache|moustache|goatee|facial hair|clean-shaven/i.test(text),
    tie: /\b(tie|ties|necktie|bowtie|bow tie|scarf|scarves)\b/i.test(text),
  };
}


/**
 * Cast for one puzzle. Uses `s.gender` + `s.traits` when the puzzle has them. Otherwise (the old static
 * names, or no traits) it invents names, genders and full looks, deterministic per puzzle, and rewrites
 * the old names inside every clue and hint. `seed` > 0 rerolls everything cosmetic that no clue mentions.
 */
export function getCastForPuzzle(p, seed = 0) {
  const rename = {};
  const sus = p.suspects.map((s) => {
    const stock = Object.prototype.hasOwnProperty.call(OLD_NAMES, s.name);
    const g = s.gender === "m" || s.gender === "f" ? s.gender : (stock ? OLD_NAMES[s.name] : (hash(`${p.id}|${s.id}|${s.name}`) % 2 ? "m" : "f"));
    let name = s.name;
    if (stock && !s.traits) { // old static cast: invent a fresh name that starts with the suspect's letter
      const pool = (NAME_POOL[s.id] || NAME_POOL.A)[g];
      name = pool[hash(`${p.id}|${s.id}`) % pool.length];
      rename[s.name] = name;
    }
    return { ...s, name, gender: g };
  });
  let puzzle = p;
  if (Object.keys(rename).length) {
    const re = new RegExp(`\\b(${Object.keys(rename).join("|")})\\b`, "g");
    const fix = (t) => (typeof t === "string" ? t.replace(re, (m) => rename[m]) : t);
    puzzle = { ...p, suspects: sus.map((s) => ({ ...s, clue: fix(s.clue) })), steps: (p.steps || []).map((st) => ({ ...st, text: fix(st.text) })) };
  } else puzzle = { ...p, suspects: sus };

  const locked = lockedCategories(puzzle);
  const hideOk = !locked.hairColor && !locked.hairLength; // a turban or hijab would hide what the clues talk about
  const sig = (l) => [l.hairStyle, l.hairColor, l.hat, l.glassesStyle, l.facialHair, l.eyes, l.skin].join("|");
  const looks = {}, seen = new Set();
  puzzle.suspects.forEach((s, i) => {
    const back = SUSPECT_COLORS[i % SUSPECT_COLORS.length];
    const base = makeLook(s.traits, s.gender, rngOf("cast", p.id, s.id, s.name), back, {}, { hideOk });
    let look = base;
    for (let tries = 0; tries < 8; tries++) {
      if (seed > 0 || tries > 0) {
        const rnd = rngOf("reroll", p.id, s.id, seed, tries);
        const fresh = makeLook({}, s.gender, rnd, back, {}, { hideOk });
        // keep whatever a clue can see; roll the rest
        const keepHair = locked.hairLength || locked.hairColor;
        const hairLen = keepHair ? base.hairLength : fresh.hairLength;
        const hairColor = locked.hairColor ? base.hairColor : (hairLen === "bald" ? "none" : (fresh.hairColor === "none" ? "brown" : fresh.hairColor));
        const hat = locked.hat ? base.hat : fresh.hat;
        const hairStyle = hairLen === "bald" ? "bald" : (hat === "none" ? pickHair(rnd, s.gender, hairLen, null) : pickHair(rnd, s.gender, hairLen, hat)) || fresh.hairStyle;
        const tie = locked.tie ? base.tie : fresh.tie;
        look = fixLook({
          ...fresh, gender: s.gender, back, hairLength: hairLen, hairStyle, hairColor, hat, tie,
          clothing: clothingForTie(tie, s.gender, rnd),
          ...(locked.glasses ? { glasses: base.glasses, glassesStyle: base.glassesStyle } : {}),
          ...(locked.facialHair ? { facialHair: base.facialHair } : {}),
        });
        if (!locked.hairColor && look.hairLength === "bald") look.hairColor = "none";
      }
      if (!seen.has(sig(look))) break;
    }
    // Beach biome: bare chests and bikini tops, unless a clue talks about neckwear (then the tie stays)
    if (themeOf(puzzle) === "BEACH" && !(locked.tie && look.tie !== "none")) look = fixLook({ ...look, tie: "none", clothing: s.gender === "m" ? "shirtless" : "bikini" });
    seen.add(sig(look));
    if (p.dummies || p.id === "tutorial") look = { ...look, dummy: true, dummyColor: mix(back, -0.16), dummyName: SUSPECT_COLOR_NAMES[i % SUSPECT_COLOR_NAMES.length] }; // the initiation is rehearsed with crash-test dummies
    looks[s.id] = look;
  });
  return { puzzle, looks, locked };
}

/** Short, human-readable tags for the clue traits (shown in the Portrait Lab). */
export function lookTags(L, t = tEn) {
  if (L.dummy) return [t("look.tag.dummy"), t("look.tag.body", { color: colorWord(t, L.dummyName) })];
  const out = [t(L.gender === "f" ? "look.tag.woman" : "look.tag.man")];
  const hatHides = L.hat && L.hat !== "none" && hidesHair(L.hat);
  if (L.hairLength === "bald") out.push(t("look.tag.bald"));
  else if (hatHides) out.push(t("look.tag.hairHidden"));
  else out.push(t("look.tag.hairColor", { color: lookWord(t, `look.hairColor.${L.hairColor}`, L.hairColor) }), t("look.tag.hairLength", { length: lookWord(t, `look.hairLength.${L.hairLength}`, L.hairLength) }));
  out.push(L.glasses && L.glassesStyle !== "none" ? t("look.tag.glasses", { style: glassesWord(t, L.glassesStyle) }) : t("look.tag.noGlasses"));
  out.push(L.hat && L.hat !== "none" ? hatWord(t, L.hat) : t("look.tag.noHat"));
  out.push(L.gender === "f" || !L.facialHair || L.facialHair === "none" ? null : beardWord(t, L.facialHair));
  out.push(L.tie && L.tie !== "none" ? tieWord(t, L.tie) : null);
  return out.filter(Boolean);
}
/** "tag, tag, tag" through the locale's list template (ui.fmt.list.more). */
const joinTags = (t, tags) => tags.reduce((acc, w) => t("fmt.list.more", { head: acc, tail: w }));


/* Token crop: the 38px circle shows the face and hat, so zoom in and use a heavier outline. */
export const TOKEN_ZOOM = 1.5, TOKEN_CY = 126, TOKEN_SW = 7;

/** Murdoku-style Polaroid: tilted vintage frame, flat rich backdrop, avataaars portrait in the 96×96 photo box. */
/** `placed` false = the backdrop is muted (cool slate); it fades into the suspect's colour once they are on the board. */
export function SuspectPolaroid({ name, id = "A", look, tilt, size = 120, tag = true, showName = true, placed = true, fluid = false }) {
  const lk = look || deriveLook(name, id);
  const bg = placed ? lk.back : mutedBack(lk.back);
  const t = tilt ?? ((hash(name + id) % 9) - 4);
  const pid = `pc${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const tx = useText();
  return (
    <svg viewBox="-8 -6 136 164" width={size} height={size * (164 / 136)} role="img" aria-label={tx("look.polaroid", { name, tags: joinTags(tx, lookTags(lk, tx)) })} style={{ display: "block", overflow: "visible", ...(fluid ? { width: "100%", height: "auto" } : null) }}>
      <g transform={`rotate(${t} 60 76)`}>
        <rect x="7" y="9" width="112" height="142" rx="3" fill="#000" fillOpacity=".28" />
        <rect x="4" y="4" width="112" height="142" rx="3" fill={CREAM} stroke="#d8cfb8" strokeWidth="1" />
        <g transform="translate(12 12)">
          <rect width="96" height="96" fill={bg} style={{ fill: bg, transition: "fill .7s ease" }} />
          <clipPath id={pid}><rect width="96" height="96" /></clipPath>
          <circle cx="48" cy="46" r="40" fill="#fff" fillOpacity={placed ? 0.22 : 0.07} style={{ fillOpacity: placed ? 0.22 : 0.07, transition: "fill-opacity .7s ease" }} />
          <g clipPath={`url(#${pid})`}><Figure look={lk} /></g>
          <rect width="96" height="96" fill="none" stroke="#000" strokeOpacity=".18" />
        </g>
        {showName && <text x="15" y="131" fontFamily="'Special Elite', 'Courier New', monospace" fontSize="14" fill="#3a2f24"
          {...(name.length * 8.4 > 66 ? { textLength: 66, lengthAdjust: "spacingAndGlyphs" } : {})}>{name}</text>}
        {tag && <g transform="translate(60 6)"><circle r="6.4" fill={CRIMSON} stroke={INK} strokeWidth="1.2" /><circle cx="-1.8" cy="-2" r="1.6" fill="#fff" fillOpacity=".55" /></g>}
        {tag && <g transform="translate(94 124)"><circle r="9" fill={bg} stroke={INK} strokeWidth="1.4" style={{ fill: bg, transition: "fill .7s ease" }} />
          <text y="4.6" textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontWeight="700" fontSize="13" fill={inkOn(bg)}>{id}</text></g>}
      </g>
    </svg>
  );
}

/* ---- S. H. Adow: the same avataaars kit, in shadow (fedora, sunglasses, crimson tie, soft slate line work) ---- */
export const ADOW_LOOK = {
  gender: "m", hairStyle: "bald", hairLength: "bald", hairColor: "none", glasses: true, glassesStyle: "sunglasses", hat: "hat",
  facialHair: "none", tie: "necktie", skin: 0, cloth: 0, eyes: "default", brows: "default", mouth: "serious", clothing: "blazerAndSweater",
  accent: 0, hatC: 0, frameC: 0, eyepatch: false, back: "#171a26",
  pal: { skin: "#1f2335", hat: "#0c0d14", clothes: "#0a0b11", shirt: "#252a3d", frame: "#05060a", tie: CRIMSON, ink: "#5d6a94" },
};
/** On the beach he is only a shadow: no fedora, no coat, no tie, just red shades. */
export const ADOW_BEACH = { ...ADOW_LOOK, hat: "none", tie: "none", clothing: "shirtless", pal: { ...ADOW_LOOK.pal, frame: "#e0453f", ink: "#6a76a0" } };
export function AdowFigure({ sw = 3.2, zoom = 1, cy = 140, beach = false }) {
  return (
    <g>
      <rect width="96" height="96" fill="#171a26" />
      <circle cx="48" cy="46" r="40" fill={beach ? "#e0453f" : BRASS} fillOpacity={beach ? ".08" : ".1"} />
      <Figure look={beach ? ADOW_BEACH : ADOW_LOOK} sw={sw} zoom={zoom} cy={cy} />
    </g>
  );
}
export function AdowPolaroid({ size = 120, tilt = 3, beach = false }) {
  const tx = useText(), nm = tx("assassin.S");
  return (
    <svg viewBox="-8 -6 136 164" width={size} height={size * (164 / 136)} role="img" aria-label={tx("look.polaroidName", { name: nm })} style={{ display: "block", overflow: "visible" }}>
      <g transform={`rotate(${tilt} 60 76)`}>
        <rect x="7" y="9" width="112" height="142" rx="3" fill="#000" fillOpacity=".35" />
        <rect x="4" y="4" width="112" height="142" rx="3" fill="#2a2a33" stroke="#3b3b47" strokeWidth="1" />
        <g transform="translate(12 12)"><AdowFigure beach={beach} /><rect width="96" height="96" fill="none" stroke="#000" strokeOpacity=".4" /></g>
        <text x="15" y="131" fontFamily="'Special Elite', 'Courier New', monospace" fontSize="13" fill={BRASS} textLength="66" lengthAdjust="spacingAndGlyphs">{nm}</text>
        <g transform="translate(60 6)"><circle r="6.4" fill={CRIMSON} stroke={INK} strokeWidth="1.2" /></g>
        <g transform="translate(94 124)"><circle r="9" fill={INK} stroke={BRASS} strokeWidth="1.4" strokeDasharray="3 2" />
          <text y="4.6" textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontWeight="700" fontSize="12" fill={BRASS}>S</text></g>
      </g>
    </svg>
  );
}

/* ---- The other Syndicate assassins: S. H. Adow's shadowed look, each with a tie colour and hair of their own ---- */
const assassinLook = (over, pal) => ({ ...ADOW_LOOK, hat: "none", ...over, pal: { ...ADOW_LOOK.pal, ...pal } });
export const ASSASSINS = {
  S: { name: "S. H. Adow", tie: CRIMSON, look: ADOW_LOOK },
  O: { name: "O. B. Scuro", tie: "#2fb36d", look: assassinLook({ gender: "m", hairStyle: "theCaesarAndSidePart", hairLength: "short", hairColor: "black", brows: "defaultNatural" }, { tie: "#2fb36d", hair: "#3a4270" }) },
  P: { name: "P. H. Obia", tie: "#ee6fae", look: assassinLook({ gender: "f", hairStyle: "straight02", hairLength: "long", hairColor: "black", tie: "scarf", clothing: "shirtCrewNeck", mouth: "serious" }, { tie: "#ee6fae", hair: "#1d2138" }) },
  Q: { name: "Q. U. Yet", tie: "#3f86e6", look: assassinLook({ gender: "m", hairStyle: "shortCurly", hairLength: "short", hairColor: "black" }, { tie: "#3f86e6", hair: "#58628f" }) },
  M: { name: "U. M. Bra", badge: "U", tie: BRASS, look: { ...ADOW_LOOK, gender: "m", hairStyle: "theCaesarAndSidePart", hairLength: "short", hairColor: "grey", glassesStyle: "round", glasses: true, hat: "none", facialHair: "beardMajestic", tie: "bowtie", eyes: "squint", brows: "raisedExcitedNatural",
    pal: { ...ADOW_LOOK.pal, tie: CRIMSON, hair: "#7b84a6", frame: "#0a0b11" } } },
  R: { name: "R. E. Aper", tie: "#f0c53a", look: assassinLook({ gender: "f", hairStyle: "curvy", hairLength: "long", hairColor: "black", tie: "scarf", clothing: "shirtCrewNeck", mouth: "serious" }, { tie: "#f0c53a", hair: "#4a3558" }) },
  // N. O. Ir: the Master's second in command, the target of "The Uninvited Guests". Hooded, face in shadow (HoodedFigure), no gender shown.
  N: { name: "N. O. Ir", badge: "N", tie: "#9aa0b8", hooded: true },
};
/** N. O. Ir in the 96 × 96 photo: a slate cloak and a deep hood, the face lost in shadow but for two pale eyes, the Master's brass clasp at the throat. */
export function HoodedFigure() {
  const u = useUid();
  return (
    <g>
      <defs><radialGradient id={`${u}f`} cx=".5" cy=".42" r=".6"><stop offset="0" stopColor="#000" /><stop offset=".7" stopColor="#05060a" /><stop offset="1" stopColor="#11131c" /></radialGradient></defs>
      <rect width="96" height="96" fill="#12131b" />
      <circle cx="48" cy="46" r="40" fill="#9aa0b8" fillOpacity=".1" />
      <path d="M4 96C8 76 20 68 32 64H64C76 68 88 76 92 96Z" fill="#0b0c12" stroke="#5d6a94" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M48 70V96M30 80Q34 88 32 96M66 80Q62 88 64 96" fill="none" stroke="#2a2e40" strokeWidth="1.1" />
      <path d="M48 11C31 11 23 27 23 44C23 56 27 64 34 70H62C69 64 73 56 73 44C73 27 65 11 48 11Z" fill="#161822" stroke="#5d6a94" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M48 12C42 19 38 27 36 35M48 12C54 19 58 27 60 35" fill="none" stroke="#2a2e40" strokeWidth="1.2" />
      <path d="M48 28C38.6 28 33.4 37 33.4 47C33.4 57 39.4 64 48 64C56.6 64 62.6 57 62.6 47C62.6 37 57.4 28 48 28Z" fill={`url(#${u}f)`} />
      <ellipse cx="42.2" cy="46.4" rx="2.7" ry="1.1" fill="#c9cdd7" />
      <ellipse cx="53.8" cy="46.4" rx="2.7" ry="1.1" fill="#c9cdd7" />
      <circle cx="48" cy="70" r="3.2" fill={BRASS} stroke="#1a1206" strokeWidth="1" />
    </g>
  );
}
export function AssassinFigure({ who = "S", sw = 3.2, zoom = 1, cy = 140 }) {
  const a = ASSASSINS[who] || ASSASSINS.S;
  if (a.hooded) return <HoodedFigure />;
  return (
    <g>
      <rect width="96" height="96" fill="#171a26" />
      <circle cx="48" cy="46" r="40" fill={a.tie} fillOpacity=".12" />
      <Figure look={a.look} sw={sw} zoom={zoom} cy={cy} />
    </g>
  );
}
/** The dark Polaroid of any assassin: "S" (S. H. Adow, the player), "O" O. B. Scuro, "P" P. H. Obia, "Q" Q. U. Yet, "R" R. E. Aper,
 *  "M" Master U. M. Bra, "N" N. O. Ir (his hooded second in command). */
export function AssassinPolaroid({ who = "S", size = 120, tilt = 3, showName = true }) {
  const a = ASSASSINS[who] || ASSASSINS.S;
  const tx = useText(), nm = lookWord(tx, `assassin.${ASSASSINS[who] ? who : "S"}`, a.name); // the name in the active language (ui.assassin.<letter>)
  return (
    <svg viewBox="-8 -6 136 164" width={size} height={size * (164 / 136)} role="img" aria-label={tx("look.polaroidName", { name: nm })} style={{ display: "block", overflow: "visible" }}>
      <g transform={`rotate(${tilt} 60 76)`}>
        <rect x="7" y="9" width="112" height="142" rx="3" fill="#000" fillOpacity=".35" />
        <rect x="4" y="4" width="112" height="142" rx="3" fill="#2a2a33" stroke="#3b3b47" strokeWidth="1" />
        <g transform="translate(12 12)"><AssassinFigure who={who} /><rect width="96" height="96" fill="none" stroke="#000" strokeOpacity=".4" /></g>
        {showName && <text x="15" y="131" fontFamily="'Special Elite', 'Courier New', monospace" fontSize="13" fill={BRASS} textLength="66" lengthAdjust="spacingAndGlyphs">{nm}</text>}
        <g transform="translate(60 6)"><circle r="6.4" fill={CRIMSON} stroke={INK} strokeWidth="1.2" /></g>
        <g transform="translate(94 124)"><circle r="9" fill={INK} stroke={a.tie} strokeWidth="1.6" strokeDasharray="3 2" />
          <text y="4.6" textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontWeight="700" fontSize="12" fill={a.tie}>{a.badge || who}</text></g>
      </g>
    </svg>
  );
}

/* ---- The Master: the Syndicate's silver-haired elder architect (same avataaars kit, warm noir palette) ---- */
export const MASTER_BACK = "#28181c";
export const MASTER_LOOK = {
  gender: "m", hairStyle: "theCaesarAndSidePart", hairLength: "short", hairColor: "grey", glasses: true, glassesStyle: "round", hat: "none",
  facialHair: "beardMajestic", tie: "bowtie", skin: 0, cloth: 0, eyes: "squint", brows: "raisedExcitedNatural", mouth: "serious",
  clothing: "blazerAndSweater", accent: 0, hatC: 0, frameC: 0, eyepatch: false, back: MASTER_BACK,
  pal: { skin: "#e3c3a6", hair: "#cdd0da", clothes: "#16151b", shirt: "#34313c", frame: BRASS, tie: CRIMSON, ink: "#0d0b10" },
};
/** The Master's Polaroid: in shadow, like every Syndicate assassin (dark frame and backdrop, brass halo, brass "M"). */
export function MasterPolaroid({ size = 120, tilt = -2, showName = true }) {
  return <AssassinPolaroid who="M" size={size} tilt={tilt} showName={showName} />;
}

/* ---------------------------------------------------------------------- */
/*  Evidence relics: "The Umbra Conspiracy" (one per standard case)        */
/* ---------------------------------------------------------------------- */
/** The ten standard cases, in order: each leaves one evidence relic (VictimRelicSvg). */
export const RELIC_IDS = ["case1", "case2", "case3", "case4", "case5", "case6", "case7", "case8", "case9", "case10"];
const RELIC_ROMAN = { case1: "I", case2: "II", case3: "III", case4: "IV", case5: "V", case6: "VI", case7: "VII", case8: "VIII", case9: "IX", case10: "X" };
const RELIC_INK = { obs: "#1d1b23", obsD: "#121117", brass: BRASS, brassD: "#9c6a17", brassL: "#f6d27a", groove: "#4f3208",
  crim: CRIMSON, crimD: "#8a1c24", silver: "#c9cdd7", silverD: "#8b909e", silverL: "#eff1f5", cream: CREAM };
/** Stroke glyphs for the Roman numerals stamped on the relics (I V X), 10 units tall: [advance, polylines]. */
const RELIC_GLYPH = {
  I: [3.4, [[[0, 0], [3.4, 0]], [[1.7, 0], [1.7, 10]], [[0, 10], [3.4, 10]]]],
  V: [6, [[[0, 0], [3, 10], [6, 0]]]],
  X: [6, [[[0, 0], [6, 10]], [[6, 0], [0, 10]]]],
};
/** Path `d` of `str` in RELIC_GLYPH strokes, `h` tall with its top at `y`; `anchor` "middle" centres it on `x`. */
function relicGlyphs(str, x, y, h, gap = 1.5, anchor = "middle") {
  const s = h / 10, chars = [...String(str)].filter((c) => RELIC_GLYPH[c]);
  const w = (chars.reduce((t, c) => t + RELIC_GLYPH[c][0], 0) + gap * Math.max(0, chars.length - 1)) * s;
  let cx = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  let d = "";
  for (const c of chars) {
    const [gw, segs] = RELIC_GLYPH[c];
    for (const seg of segs) d += `M${seg.map(([a, b]) => `${r2(cx + a * s)} ${r2(y + b * s)}`).join("L")}`;
    cx += (gw + gap) * s;
  }
  return d;
}
/** Path `d` of the Syndicate's audit eye, `w` wide and centred on (cx, cy): an almond lid and a round pupil. Every relic carries one:
 *  the mark of the auditor who hid a strip of the Master's ledger page inside it (see src/umbra.jsx). */
function relicEye(cx, cy, w) {
  const h = w * 0.3, r = w * 0.14;
  return `M${r2(cx - w / 2)} ${r2(cy)}Q${r2(cx)} ${r2(cy - 2 * h)} ${r2(cx + w / 2)} ${r2(cy)}Q${r2(cx)} ${r2(cy + 2 * h)} ${r2(cx - w / 2)} ${r2(cy)}Z`
    + `M${r2(cx - r)} ${r2(cy)}A${r2(r)} ${r2(r)} 0 1 0 ${r2(cx + r)} ${r2(cy)}A${r2(r)} ${r2(r)} 0 1 0 ${r2(cx - r)} ${r2(cy)}Z`;
}
/** The etched audit eye: a dark groove under a lit inlay line, in g.relic-frag so the UI can make it glow. */
function RelicEtch({ d, lit = RELIC_INK.brassL, groove = RELIC_INK.groove, sw = 1.7, transform }) {
  const st = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round" };
  return (
    <g className="relic-frag" transform={transform}>
      <path d={d} {...st} stroke={groove} strokeWidth={sw + 1.3} />
      <path d={d} {...st} stroke={lit} strokeWidth={sw} />
    </g>
  );
}
/* the evidence plate: an obsidian field in a brass rim, with a stepped key notch die-cut into the east edge */
const RELIC_PLATE = "M11 2H53Q62 2 62 11V24H58V28H55V36H58V40H62V53Q62 62 53 62H11Q2 62 2 53V11Q2 2 11 2Z";
const RELIC_FIELD = "M11 5H53Q59 5 59 11V21H55V25H52V39H55V43H59V53Q59 59 53 59H11Q5 59 5 53V11Q5 5 11 5Z";
const OSR = { ...OS, strokeWidth: 1.6 };
/** A lobed wax-seal outline: `n` round bumps about (cx, cy). Path `d`. */
const lobedSeal = (cx, cy, r, n = 9) => {
  const pts = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; return [r2(cx + Math.cos(a) * r), r2(cy + Math.sin(a) * r)]; });
  return `M${pts[0].join(" ")}` + pts.map((p, i) => { const q = pts[(i + 1) % n]; return `A${r2(r * .36)} ${r2(r * .36)} 0 0 1 ${q[0]} ${q[1]}`; }).join("") + "Z";
};

/* one drawing per relic, inside the field (x 6..51 beside the notch, the Roman stamp top left) */
/** I · Farm: rusted barn key, the audit eye etched in its round bow. */
function RelicBarnKey() {
  const rust = "#a4552f", rustD = "#6e3420", rustL = "#cf8456";
  return (
    <g>
      <g transform="rotate(45 24 27)">
        <path d="M50 28.4H61.6V38.6H58.4V35H55.4V38.6H50Z" fill={rust} {...OSR} />
        <path d={inkBox(34, 23.9, 28, 6.2, 1.4, .2)} fill={rust} {...OSR} />
        <path d="M35.4 28.2H60.6" stroke={rustD} strokeWidth="1.5" strokeLinecap="round" />
        <path d={inkBox(33.6, 21.6, 4.4, 10.8, 1.2, .2)} fill={rustD} {...OSR} />
        <circle cx="45" cy="25.6" r=".8" fill={rustL} /><circle cx="53.4" cy="26" r=".6" fill={rustL} />
      </g>
      <circle cx="24" cy="27" r="12.6" fill={rust} {...OSR} />
      <path d="M14.4 33.6A11.4 11.4 0 0 0 34.6 32.6" fill="none" stroke={rustD} strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="27" r="9.6" {...IS} stroke={rustD} />
      <circle cx="16.6" cy="21.4" r=".8" fill={rustL} /><circle cx="31.6" cy="20.6" r=".6" fill={rustL} /><circle cx="18" cy="35" r=".7" fill={rustD} />
      <RelicEtch d={relicEye(24, 26.8, 13)} lit="#f3c08a" groove="#3e1a0e" />
    </g>
  );
}
/** II · Beach: salt-crusted brass token, a milled rim, the audit eye in its face. */
function RelicToken() {
  const R = RELIC_INK, salt = "#eef1ec";
  const ticks = Array.from({ length: 32 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    return `M${r2(32 + c * 16.4)} ${r2(34 + s * 16.4)}L${r2(32 + c * 18.4)} ${r2(34 + s * 18.4)}`;
  }).join("");
  return (
    <g>
      <circle cx="32" cy="34" r="19" fill={R.brassD} {...OSR} />
      <circle cx="31.2" cy="33.2" r="17.6" fill={R.brass} />
      <path d={ticks} {...IS} stroke={R.groove} strokeOpacity=".55" />
      <circle cx="32" cy="34" r="13.6" fill={R.brass} {...IS} stroke={R.groove} />
      <circle cx="32" cy="34" r="11.4" fill="none" stroke={R.brassD} strokeWidth=".8" strokeDasharray="1 2.2" />
      <path d="M22.6 26Q25.4 22.6 29.6 21.8" fill="none" stroke={R.brassL} strokeWidth="1.4" strokeLinecap="round" />
      {/* salt crust caked on the rim, specks on the face */}
      <path d="M13.6 37.6Q13 44.6 17.6 49.2Q20.6 52 24.4 52.8L25.2 49.6Q21.6 48.4 19.4 45.6Q17.6 42.4 17.6 38.4Q15.4 36.6 13.6 37.6Z" fill={salt} {...IS} />
      <path d="M40.6 16.6Q46.4 18.2 49.6 23.4L47.4 25.4Q46.2 23.6 44.2 22.6L43.4 20.6Q41.4 20.2 40 19.4Z" fill={salt} {...IS} />
      {[[21.4, 46.6, 1], [27, 50.4, .8], [44.6, 44, .9], [41.2, 27.4, .6], [24.2, 39.6, .6], [47.4, 30.6, .8]].map(([x, y, r]) => <circle key={x} cx={x} cy={y} r={r} fill={salt} />)}
      <RelicEtch d={relicEye(32, 34, 15)} sw={2} />
    </g>
  );
}
/** III · Forest: charred field ledger, the leather cover burnt away at one corner, the audit eye tooled in brass foil. */
function RelicLedger() {
  const R = RELIC_INK, hide = "#6a2b23", hideD = "#45201b", page = "#eadfc4", pageD = "#c9b98f", char = "#141217", ember = "#ee7a2c";
  return (
    <g>
      {/* page block, bitten by the fire */}
      <path d="M20 16H48.6V37.8L46.4 40.6L47 43.8L43.6 45.4L43 49L39.4 50L38.4 53.4L34.8 54L33.2 56.4H20Z" fill={page} {...OSR} />
      <path d="M46.2 19V37M44.4 54.2H21.4" {...IS} stroke={pageD} />
      {/* char band along the burn line, then the cover with its jagged edge and an ember line */}
      <path d="M45 34L48.6 36.4L47.6 40.6L48.6 45.2L44.8 47.4L44.4 51.2L40.4 52.4L39.2 55.8L35 57L31.6 57.4L29.4 53.4Z" fill={char} {...IS} />
      <path d="M17 13H45V35.6L42.6 38.4L43.4 41.6L40 43L39.4 46.6L36 47.4L35 50.6L31.6 51L30 53H17Q15 53 15 51V15Q15 13 17 13Z" fill={hide} {...OSR} />
      <path d="M45 35.6L42.6 38.4L43.4 41.6L40 43L39.4 46.6L36 47.4L35 50.6L31.6 51L30 53" fill="none" stroke={ember} strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M15.8 14.2H20V52.2H15.8Z" fill={hideD} />
      <path d="M15.8 21H20M15.8 45H20" {...IS} stroke={R.brassD} strokeWidth="1.2" />
      <path d="M40 13H45V18Z" fill={R.brass} {...IS} />
      <path d={inkBox(23.4, 18.4, 16.4, 19.2, 1.4, .2)} {...IS} stroke={R.brass} />
      <circle cx="25" cy="44" r=".9" fill={char} /><circle cx="33.6" cy="42" r=".6" fill={ember} /><circle cx="22.6" cy="48.4" r=".7" fill={char} />
      <RelicEtch d={relicEye(31.6, 27.8, 13)} sw={1.8} groove="#2a0e0a" />
    </g>
  );
}
/** IV · Mountains: stopped silver pocket watch, hands frozen at 1:00, the audit eye etched where the hour hand points. */
function RelicWatch() {
  const R = RELIC_INK, face = "#f3ecdc";
  const ticks = Array.from({ length: 12 }, (_, i) => i).filter((i) => i !== 1).map((i) => {
    const a = (i / 12) * Math.PI * 2, sx = Math.sin(a), cy = -Math.cos(a), big = i % 3 === 0;
    return <path key={i} d={`M${r2(32 + sx * (big ? 10 : 10.8))} ${r2(37 + cy * (big ? 10 : 10.8))}L${r2(32 + sx * 12.3)} ${r2(37 + cy * 12.3)}`} stroke={INK} strokeWidth={big ? 1.4 : .8} strokeLinecap="round" />;
  });
  return (
    <g>
      <ellipse cx="32" cy="10.6" rx="5.2" ry="4.2" fill="none" stroke={INK} strokeWidth="4" />
      <ellipse cx="32" cy="10.6" rx="5.2" ry="4.2" fill="none" stroke={R.silver} strokeWidth="1.8" />
      <path d={inkBox(29.6, 16.8, 4.8, 4.4, .8, .1)} fill={R.silverD} {...OSR} />
      <path d={inkBox(27.6, 13.2, 8.8, 4.4, 1.6, .2)} fill={R.silver} {...OSR} />
      <path d="M30 13.6V17.2M32 13.6V17.2M34 13.6V17.2" {...IS} strokeWidth=".6" />
      <circle cx="32" cy="37" r="17" fill={R.silverD} {...OSR} />
      <circle cx="31.2" cy="36.2" r="15.6" fill={R.silver} />
      <circle cx="32" cy="37" r="13.8" fill={face} {...IS} />
      {ticks}
      <RelicEtch d={relicEye(37.6, 28.2, 7.4)} lit={R.crim} groove="#e4d6b8" sw={1.4} />
      {/* frozen at 1:00: minute hand at 12, hour hand at 1 */}
      <path d="M32 37V25.8" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M32 37L35.1 31.6" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="32" cy="37" r="1.5" fill={R.brass} stroke={INK} strokeWidth=".7" />
      {/* cracked glass and a glint */}
      <path d="M20.4 31.6L24.6 34.4L23.4 38.8L27.6 42.4L26.4 46.4M24.6 34.4L28.4 33.4" fill="none" stroke={INK} strokeWidth=".7" strokeOpacity=".7" strokeLinejoin="round" />
      <path d="M22.2 28.4Q24.6 25.2 28.4 24" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
    </g>
  );
}
/** V · Desert: a strip of microfilm off its spool, bound by a crimson wax seal embossed with the audit eye. */
function RelicMicrofilm() {
  const R = RELIC_INK, film = "#a8742e", filmD = "#6e4a1c", frame = "#d3a259";
  const holes = Array.from({ length: 10 }, (_, i) => r2(17.4 + i * 3.4));
  return (
    <g>
      {/* the strip, its far end cut on the bias */}
      <path d="M14 29.4H48.6L51 32V44.6H14Z" fill={film} {...OSR} />
      <path d="M14 42H51" stroke={filmD} strokeWidth="1.2" />
      {[19, 27.4, 35.8, 44.2].map((x) => <rect key={x} x={x} y="33.2" width="6.6" height="7.4" rx=".6" fill={frame} {...IS} strokeWidth=".6" />)}
      {holes.map((x) => <g key={x}><rect x={x} y="30.4" width="1.6" height="1.6" fill={R.obsD} /><rect x={x} y="42.2" width="1.6" height="1.6" fill={R.obsD} /></g>)}
      {/* spool: the rolled film behind a silver flange */}
      <path d={inkBox(9.6, 27, 6.2, 20.8, 1.6, .2)} fill={filmD} {...OSR} />
      <ellipse cx="9.8" cy="37.4" rx="3.2" ry="11.4" fill={R.silver} {...OSR} />
      <ellipse cx="9.8" cy="37.4" rx="1.2" ry="3.4" fill={R.obsD} />
      <path d="M15.8 26.4V48.4" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      {/* the seal: two ribbon tails under a lobed wax disc */}
      <path d="M28.8 43L25 54.4L27.6 53.4L28.8 55.8L32 44.6ZM35.2 43L39 54.4L36.4 53.4L35.2 55.8L32 44.6Z" fill={R.crimD} {...OSR} />
      <path d={lobedSeal(32, 37, 10)} fill={R.crim} {...OSR} />
      <circle cx="32" cy="37" r="6.8" fill="none" stroke={R.crimD} strokeWidth="1.1" />
      <path d="M26.4 32.4Q28.4 29.8 31.4 29.2" fill="none" stroke="#e8807a" strokeWidth="1.2" strokeLinecap="round" />
      <RelicEtch d={relicEye(32, 37, 9.4)} lit="#ffb4a8" groove="#5c0f16" sw={1.6} />
    </g>
  );
}
/** VI · Street: a Velvet Note matchbook in crimson velvet, a brass eighth note and the audit eye on its cover. */
function RelicMatchbook() {
  const R = RELIC_INK, vel = "#a42d38", velD = "#741c27", velL = "#c9505b", strike = "#4a3528";
  return (
    <g transform="rotate(-6 32 35)">
      <path d={inkBox(17, 12.6, 30, 43, 2.6, .3)} fill={vel} {...OSR} />
      <path d="M42.4 13.8H45.2Q45.8 14 45.8 15V43H42.4Z" fill={velD} />
      {/* the tucked flap with its staple, the striker strip under the fold */}
      <path d="M17.6 43.4H46.4V51.6H17.6Z" fill={velD} {...OSR} />
      <path d="M17.6 51.6H46.4V55.2Q46.4 55.6 45.6 55.6H18.4Q17.6 55.6 17.6 55.2Z" fill={strike} {...IS} />
      <path d="M20 53.6H44" stroke="#7a5a44" strokeWidth=".8" strokeDasharray=".6 1.2" />
      <path d="M30.4 46.8H33.6" stroke={R.silver} strokeWidth="1.4" strokeLinecap="round" />
      {[[21, 18], [24.6, 40], [39.4, 36], [37, 18.6], [20.6, 30.4]].map(([x, y]) => <circle key={x} cx={x} cy={y} r=".55" fill={velL} />)}
      {/* brass eighth note and a deco rule */}
      <ellipse cx="38.6" cy="23.8" rx="2.3" ry="1.7" transform="rotate(-22 38.6 23.8)" fill={R.brass} stroke={INK} strokeWidth=".7" />
      <path d="M40.6 23.2V15.6Q41 18.6 44 19.8" fill="none" stroke={R.brass} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21.6 39H28.6M35.4 39H42.4" stroke={R.brass} strokeWidth="1" strokeLinecap="round" />
      <path d="M32 37.2L33.8 39L32 40.8L30.2 39Z" fill={R.brass} />
      <RelicEtch d={relicEye(29.4, 27.9, 12)} sw={2} groove="#3e0a10" />
    </g>
  );
}
/** VII · Mansion: cracked porcelain half-mask (a columbina) with brass-rimmed eyes and crimson ribbons, the audit eye on its brow. */
function RelicMask() {
  const u = useUid(), R = RELIC_INK, por = "#f1ece2", porD = "#cfc6b6", hole = R.obsD;
  const mask = "M32 22.6C27 19.2 19 18.8 13 21.4C10.6 22.4 9.4 21 8.6 18.6C7.2 24 8.4 31.6 12 36.6C15.4 41.2 22 43.6 27 41.6C29.4 40.6 30.4 39.2 32 39.2C33.6 39.2 34.6 40.6 37 41.6C42 43.6 48.6 41.2 52 36.6C55.6 31.6 56.8 24 55.4 18.6C54.6 21 53.4 22.4 51 21.4C45 18.8 37 19.2 32 22.6Z";
  const eyeL = "M15.6 30.4Q21 25.8 27.2 29.8Q21.4 34.8 15.6 30.4Z", eyeR = "M48.4 30.4Q43 25.8 36.8 29.8Q42.6 34.8 48.4 30.4Z";
  return (
    <g transform="translate(32 33) scale(.84) translate(-32 -33)">
      <defs><clipPath id={`${u}m`}><path d={mask} /></clipPath></defs>
      <path d="M12.6 32.4C9.4 37.4 13.2 42.6 8.8 51.6L12 50.4L13 53.8C17.4 45.4 14 40.6 17.6 35.6ZM51.4 32.4C54.6 37.4 50.8 42.6 55.2 51.6L52 50.4L51 53.8C46.6 45.4 50 40.6 46.4 35.6Z" fill={R.crim} {...OS} strokeWidth="1.9" />
      <path d="M12.4 37.6C12.8 41.6 11.6 45.4 10.6 48.6M51.6 37.6C51.2 41.6 52.4 45.4 53.4 48.6" fill="none" stroke={R.crimD} strokeWidth="1.2" strokeLinecap="round" />
      <path d={mask} fill={por} />
      <g clipPath={`url(#${u}m)`}><ellipse cx="40" cy="47" rx="24" ry="11" fill={porD} /></g>
      <path d={mask} fill="none" {...OS} strokeWidth="1.9" />
      <path d={eyeL} fill={hole} stroke={R.brass} strokeWidth="2.2" strokeLinejoin="round" />
      <path d={eyeR} fill={hole} stroke={R.brass} strokeWidth="2.2" strokeLinejoin="round" />
      <path d={eyeL} fill="none" stroke={INK} strokeWidth=".8" /><path d={eyeR} fill="none" stroke={INK} strokeWidth=".8" />
      {/* the crack, and a chip knocked out of the lower edge */}
      <path d="M40.4 20.4L38.6 24.2L41.6 26.4L40 28.6M43.4 32.4L45.6 35.6L43.8 38.2L46.4 41.4" fill="none" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M44.8 42.2L46.4 41.4L48.4 42.6Z" fill={hole} stroke={INK} strokeWidth=".8" strokeLinejoin="round" />
      <path d="M14 24.4Q19.6 21.8 25.2 22.6" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <RelicEtch d={relicEye(32, 29.9, 10)} sw={2} />
    </g>
  );
}
/** VIII · Forest: hollow silver cartridge, its bullet pulled off and a crimson slip rolled inside, the audit eye etched on the case. */
function RelicCartridge() {
  const R = RELIC_INK;
  return (
    <g transform="translate(30.4 38) rotate(-32) scale(.88) translate(-33.75 -36)">
      <path d={inkBox(9, 27.6, 4, 16.8, 1, .1)} fill={R.silverD} {...OS} strokeWidth="1.8" />
      <path d="M13 30.6H14.6V41.4H13Z" fill="#5e6270" />
      <path d="M14.4 29H37.6L42.6 31.6V40.4L37.6 43H14.4Z" fill={R.silver} {...OS} strokeWidth="1.8" />
      <path d="M15.4 39.6H37.6L42 38" stroke={R.silverD} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M15.6 31.6H36.6" stroke={R.silverL} strokeWidth="1.3" strokeLinecap="round" />
      <ellipse cx="42.6" cy="36" rx="1.6" ry="4.4" fill={R.obsD} {...IS} />
      {/* the rolled crimson slip half out of the mouth */}
      <path d="M41.6 34H47.4V38H41.6Z" fill={R.crim} {...IS} />
      <ellipse cx="47.4" cy="36" rx=".9" ry="2" fill="#e8807a" {...IS} strokeWidth=".6" />
      {/* the pulled bullet */}
      <path d="M50 31.6H53Q58.4 33 60 36Q58.4 39 53 40.4H50Z" fill={R.brass} {...OS} strokeWidth="1.8" />
      <path d="M53 31.6V40.4" {...IS} />
      <path d="M53.8 33.6Q56.6 34.4 57.6 35.6" fill="none" stroke={R.brassL} strokeWidth="1" strokeLinecap="round" />
      <RelicEtch d={relicEye(26, 35.9, 9)} lit="#3d404c" groove={R.silverL} sw={1.7} />
    </g>
  );
}
/** IX · Street: pawn shop claim ticket, three brass balls on a crimson band, the audit eye stamped below. */
function RelicTicket() {
  const R = RELIC_INK, card = "#efe5cc", cardD = "#d3c4a0";
  return (
    <g transform="rotate(6 32 35)">
      <path d="M32 16.8C34 9.6 43.4 7.2 48.4 10.6" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M32 16.8C34 9.6 43.4 7.2 48.4 10.6" fill="none" stroke="#d9c79a" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M22 13H42L47 18V56H17V18Z" fill={card} {...OSR} />
      <path d="M43.6 18.4V54.4" stroke={cardD} strokeWidth="2" />
      <circle cx="32" cy="18.6" r="2.5" fill={R.brass} {...IS} /><circle cx="32" cy="18.6" r="1.1" fill={R.obsD} />
      <path d="M17.6 23H46.4V36.4H17.6Z" fill={R.crim} {...IS} />
      <path d="M24.4 25.4H39.6" stroke={R.brass} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M26.6 25.4V26.6M37.4 25.4V26.6M32 25.4V30.4" {...IS} stroke={R.brass} />
      {[[26.6, 29.2], [37.4, 29.2], [32, 33.2]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.6" fill={R.brass} {...IS} />)}
      <path d="M17.6 50.2H46.4" stroke={INK} strokeWidth=".9" strokeDasharray="1.2 1.4" />
      <circle cx="21.6" cy="53.2" r="1" fill={R.crimD} />
      <RelicEtch d={relicEye(32, 43.7, 12)} lit="#2a1f26" groove={cardD} sw={1.5} />
    </g>
  );
}
/** X · Beach: cracked Fresnel lens panel in a brass frame, a shard missing, the audit eye etched on the brass foot. */
function RelicFresnel() {
  const u = useUid(), R = RELIC_INK, glassD = "#6fb0d3", glassL = "#e4f5fc";
  const pane = "M17.6 45V22.6Q17.6 14.6 25.6 14.6H38.4Q46.4 14.6 46.4 22.6V45Z";
  return (
    <g>
      <defs><clipPath id={`${u}g`}><path d={pane} /></clipPath></defs>
      <path d="M15 46V22Q15 12 25 12H39Q49 12 49 22V46Z" fill={R.brass} {...OSR} />
      <path d={pane} fill={GLASS} />
      <g clipPath={`url(#${u}g)`}>
        <rect x="39" y="10" width="12" height="40" fill={glassD} />
        {[7.6, 11.4, 15.2, 19, 22.8].map((r) => <g key={r}><circle cx="32" cy="30" r={r} fill="none" stroke={INK} strokeWidth=".8" strokeOpacity=".7" /><circle cx="32" cy="30" r={r - 1.3} fill="none" stroke={glassL} strokeWidth=".9" /></g>)}
        <path d="M17 18L22.6 14L23.4 20.6Z" fill={R.obsD} stroke={INK} strokeWidth=".9" strokeLinejoin="round" />
        <path d="M23.4 20.6L22 26L27.4 29.4L29 33.4M22 26L18 28.6" fill="none" stroke={glassL} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        <path d="M23.4 20.6L22 26L27.4 29.4L29 33.4M22 26L18 28.6" fill="none" stroke={INK} strokeWidth=".7" strokeLinejoin="round" />
      </g>
      <circle cx="32" cy="30" r="3.8" fill={glassL} {...IS} />
      <path d={pane} fill="none" {...IS} />
      <path d="M12.6 56.4H51.4L48.6 45.4H15.4Z" fill={R.brass} {...OSR} />
      <path d="M13.6 54.6H50.4" stroke={R.brassD} strokeWidth="1.4" />
      <RelicEtch d={relicEye(32, 50.3, 10)} sw={1.3} />
    </g>
  );
}
/** Unknown case: a sealed evidence bag (crimson tamper strip, blank tag, no numerals). */
function RelicBag() {
  const R = RELIC_INK, bag = "#3f3d4a", bagL = "#5d5b6a";
  return (
    <g>
      <path d="M15 17H49V52.4Q49 55.6 45.8 55.6H18.2Q15 55.6 15 52.4Z" fill={bag} {...OSR} />
      <path d="M20 50L44 22" stroke={bagL} strokeWidth="3" strokeLinecap="round" />
      <path d="M38 52L46 43" stroke={bagL} strokeWidth="2" strokeLinecap="round" />
      <path d={inkBox(14, 12, 36, 7, 1.6, .2)} fill={R.crim} {...OSR} />
      <path d="M16.4 15.4L18.6 13.8L20.8 15.4L23 13.8L25.2 15.4L27.4 13.8L29.6 15.4L31.8 13.8L34 15.4L36.2 13.8L38.4 15.4L40.6 13.8L42.8 15.4L45 13.8L47.2 15.4" {...IS} stroke={R.crimD} />
      <path d={inkBox(22, 27, 20, 14, 1.4, .2)} fill={R.cream} {...IS} />
      <path d="M25 31.4H39M25 34.6H36M25 37.8H38" {...IS} strokeOpacity=".55" />
    </g>
  );
}
const RELIC_ART = { case1: RelicBarnKey, case2: RelicToken, case3: RelicLedger, case4: RelicWatch, case5: RelicMicrofilm,
  case6: RelicMatchbook, case7: RelicMask, case8: RelicCartridge, case9: RelicTicket, case10: RelicFresnel };
/**
 * One evidence relic of "The Umbra Conspiracy" (one per standard case, RELIC_IDS), 64 × 64, drawn at `size` px: an obsidian
 * plate in a brass rim with a stepped key notch die-cut into its east edge, the case's Roman numeral stamped top left, and
 * the relic itself with the Syndicate's audit eye (relicEye) etched on it inside `<g className="relic-frag">`, so CSS can
 * make it glow. Readable from 28 px (hub badge) to 120 px (modal). An unknown `caseId` gets a sealed evidence bag, no numerals.
 * `title` becomes the accessible name; without it the SVG is decorative (aria-hidden). Clip ids are unique per instance.
 * Source art: art/relics/<caseId>.svg and art/relics/UNKNOWN.svg.
 */
export function VictimRelicSvg({ caseId, size = 64, title }) {
  const Art = RELIC_ART[caseId], roman = RELIC_ROMAN[caseId];
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={size} height={size} role={title ? "img" : undefined}
      aria-label={title || undefined} aria-hidden={title ? undefined : "true"} data-relic={Art ? caseId : "unknown"} style={{ display: "block" }}>
      {title ? <title>{title}</title> : null}
      <path d={RELIC_PLATE} fill={BRASS} {...OSR} />
      <path d={RELIC_FIELD} fill={RELIC_INK.obs} stroke={RELIC_INK.brassD} strokeWidth=".9" strokeLinejoin="round" />
      <path d="M57.6 6.4Q59.6 8 59.4 10.4" fill="none" stroke={RELIC_INK.brassL} strokeWidth="1" strokeLinecap="round" />
      {Art ? <Art /> : <RelicBag />}
      {roman && <path d={relicGlyphs(roman, 8.6, 8.4, 6.2, 1.4, "start")} fill="none" stroke={BRASS} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

/**
 * The sigil of the Uninvited (the Syndicate assassins who watch the watchers): an eye looking out of a keyhole. Stamped into the
 * silver seal of their black envelopes, where the Syndicate's own envelopes carry the red fedora seal. A <g> drawn in a 100 × 100
 * box centred on (50, 50); scale it with `transform`.
 */
export function UninvitedSigil({ transform, ink = "#2c2f38", glint = "#eef0f5" }) {
  return (
    <g transform={transform}>
      <path d="M50 26A15 15 0 0 1 58.6 53.3L63 76H37L41.4 53.3A15 15 0 0 1 50 26Z" fill={ink} stroke="#1a1c22" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M37.4 41Q50 30.6 62.6 41Q50 51.4 37.4 41Z" fill={glint} />
      <circle cx="50" cy="41" r="4.6" fill={ink} />
      <circle cx="48.6" cy="39.6" r="1.4" fill={glint} />
      <path d="M45 62H55" stroke={glint} strokeWidth="1.6" strokeLinecap="round" opacity=".35" />
    </g>
  );
}

/**
 * The contract's target: a polaroid of the victim (a name that starts with V). `crossed` draws the red X by hand over the face: only for a
 * contract that is already fulfilled. `dummy` makes the target a crash-test dummy (the tutorial's victim).
 */
const VICTIM_GENDER = { Vesper: "f", Victor: "m", Valeria: "f", Vance: "m", Vera: "f", Vincent: "m", Violet: "f", Virgil: "m", Vanessa: "f", Vaughn: "m", Valentin: "m", Verity: "f", Vidal: "m", Viola: "f", Vito: "m", Venus: "f" };
/** The target's look from their name (the polaroid and the board's CORPSE sprite both use it, so they always match);
 *  `dummy` gives the tutorial's ivory crash-test dummy. */
/** Every contract has a target: the victim, a name that starts with V, unique per contract. The board's corpse and the
 *  contract polaroid both use it, so they always show the same person. */
const VICTIM_BY_ID = { tutorial: "Vesper", case1: "Victor", case2: "Valeria", case3: "Vance", case4: "Vera", case5: "Vincent", case6: "Violet", case7: "Virgil", case8: "Vanessa", case9: "Vaughn", case10: "Valentin" };
const VICTIM_POOL = ["Vesper", "Victor", "Valeria", "Vance", "Vera", "Vincent", "Violet", "Virgil", "Vanessa", "Vaughn", "Valentin", "Verity", "Vidal", "Viola", "Vito", "Venus"];
export const victimNameOf = (q) => (q && (VICTIM_BY_ID[q.id] || VICTIM_POOL[hash(q.id) % VICTIM_POOL.length])) || "Victor";
/** The tutorial's victim is a crash-test dummy (its polaroid and its corpse). */
export const victimIsDummy = (q) => !!q && (q.id === "tutorial" || !!q.frozen);

/** "m" | "f": the victim's gender, from the name (the polaroid and the corpse sprite use the same rule). */
export const victimGenderOf = (name = "Victor") => VICTIM_GENDER[name] || (/(a|e|y)$/i.test(name) ? "f" : "m");
export function victimLook(name = "Victor", dummy = false) {
  const vg = victimGenderOf(name);
  const lk = deriveLook(name, "V", "", { gender: vg, traits: vg === "m" ? { hairLength: "short" } : { hairLength: "long" } });
  return dummy ? { ...lk, dummy: true, dummyColor: "#e9e3d3", dummyName: "ivory", back: "#8c9ab6" } : { ...lk, back: SUSPECT_COLORS[hash(name) % SUSPECT_COLORS.length] };
}
export function VictimPolaroid({ name = "Victor", size = 120, tilt = 2, crossed = false, dummy = false, target = true }) {
  const tx = useText();
  const look = victimLook(name, dummy);
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: size, aspectRatio: "136 / 164", lineHeight: 0 }}>
      <SuspectPolaroid name={name} id="V" look={look} size={size} tilt={tilt} tag={false} fluid />
      {target && <svg viewBox="-8 -6 136 164" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
        <g transform="translate(26 24) rotate(-17)">
          <rect x="-31" y="-10" width="62" height="20" rx="2.5" fill="#F5F0E6" fillOpacity=".82" stroke={CRIMSON} strokeWidth="2.4" />
          <rect x="-27.5" y="-6.5" width="55" height="13" rx="1.5" fill="none" stroke={CRIMSON} strokeWidth=".9" opacity=".8" />
          <text y="4.4" textAnchor="middle" fontFamily="'Special Elite', 'Courier New', monospace" fontWeight="700" fontSize="12.5" letterSpacing="1.4" fill={CRIMSON}>{tx("victim.target")}</text>
        </g>
      </svg>}
      {crossed && <svg viewBox="-8 -6 136 164" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
        <g transform={`rotate(${tilt} 60 76)`} fill="none" stroke={CRIMSON} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 19C42 37 66 66 100 103" strokeWidth="7.5" opacity=".94" />
          <path d="M23 24C46 42 68 68 96 99" strokeWidth="2.6" opacity=".7" />
          <path d="M101 17C80 40 52 66 19 104" strokeWidth="7" opacity=".94" />
          <path d="M97 22C75 44 54 62 24 98" strokeWidth="2.4" opacity=".7" />
        </g>
      </svg>}
    </div>
  );
}

/* ---- Round board tokens built from the same figures ---------------------- */
export function TokenAvatar({ cx, cy, r = 19, look, id, uid }) {
  const cid = `skc-${uid}-${id}`, s = (2 * r) / 96;
  return (
    <g pointerEvents="none">
      <clipPath id={cid}><circle cx={cx} cy={cy} r={r} /></clipPath>
      <circle cx={cx} cy={cy} r={r + 2.2} fill={INK} />
      <g clipPath={`url(#${cid})`}>
        <g transform={`translate(${cx - r} ${cy - r}) scale(${s})`}>
          <rect width="96" height="96" fill={look.back} /><Figure look={look} zoom={TOKEN_ZOOM} cy={TOKEN_CY} sw={TOKEN_SW} />
        </g>
      </g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={CREAM} strokeWidth="1.6" />
      <circle cx={cx + r * 0.72} cy={cy + r * 0.72} r="8" fill={look.back} stroke={INK} strokeWidth="1.6" />
      <text x={cx + r * 0.72} y={cy + r * 0.72 + 4.2} textAnchor="middle" fontFamily="'Barlow', system-ui, sans-serif" fontWeight="800" fontSize="12" fill={inkOn(look.back)}>{id}</text>
    </g>
  );
}
export function AdowToken({ cx, cy, r = 19, uid, beach = false }) {
  const cid = `skc-${uid}-S`, s = (2 * r) / 96;
  return (
    <g pointerEvents="none">
      <clipPath id={cid}><circle cx={cx} cy={cy} r={r} /></clipPath>
      <circle cx={cx} cy={cy} r={r + 2.2} fill={INK} />
      <g clipPath={`url(#${cid})`}><g transform={`translate(${cx - r} ${cy - r}) scale(${s})`}><AdowFigure zoom={TOKEN_ZOOM} cy={TOKEN_CY} sw={5.6} beach={beach} /></g></g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={BRASS} strokeWidth="1.8" strokeDasharray="4 3" />
    </g>
  );
}
/** A placed extra assassin (O. B. Scuro, P. H. Obia, Q. U. Yet, R. E. Aper): the shadowed portrait, a dashed ring in their tie colour, their letter. */
export function AssassinToken({ cx, cy, r = 19, uid, who }) {
  const a = ASSASSINS[who] || ASSASSINS.S, cid = `skc-${uid}-${who}`, s = (2 * r) / 96;
  return (
    <g pointerEvents="none">
      <clipPath id={cid}><circle cx={cx} cy={cy} r={r} /></clipPath>
      <circle cx={cx} cy={cy} r={r + 2.2} fill={INK} />
      <g clipPath={`url(#${cid})`}><g transform={`translate(${cx - r} ${cy - r}) scale(${s})`}><AssassinFigure who={who} zoom={TOKEN_ZOOM} cy={TOKEN_CY} sw={5.6} /></g></g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={a.tie} strokeWidth="1.8" strokeDasharray="4 3" />
      <circle cx={cx + r * 0.72} cy={cy + r * 0.72} r="8" fill="#171a26" stroke={a.tie} strokeWidth="1.6" />
      <text x={cx + r * 0.72} y={cy + r * 0.72 + 4.2} textAnchor="middle" fontFamily="'Barlow', system-ui, sans-serif" fontWeight="800" fontSize="12" fill={a.tie}>{who}</text>
    </g>
  );
}

/* ---- Fog of war (used by the Board) ---- */
export const FOG = "#141b2e";
export const FOG_OPACITY = 0.42;

/* ---- Floor swatch + biome filter helpers (shared by the inspector) ---- */
export function FloorSwatch({ id, size = 26 }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={{ borderRadius: 6, display: "block" }}>
      <FloorDefs align={false} /><rect width="64" height="64" fill={`url(#skf-${id})`} />
    </svg>
  );
}

/* ---- Biome Filter: the same bar drives the Prop Inspector and the Showroom ---- */
export const BIOME_REP = { MANSION: "parquet", FARM: "dirt", BEACH: "sand", FOREST: "grass", MOUNTAINS: "snow", DESERT: "canyon", STREET: "asphalt" };
export const isBiomeFilter = (f) => BIOMES.includes(f);
/** The kits a prop belongs to, as a list (["UNIVERSAL"] when it has none). */
export const biomesOf = (k) => [].concat(PROP_BIOME[k] || "UNIVERSAL");
export const propsOfFilter = (f) => (f === "ALL" ? PROP_ORDER : PROP_ORDER.filter((k) => biomesOf(k).includes(f)));
