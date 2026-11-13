/**
 * The Syndicate Coin economy's numbers and calendar (docs/android/product_brief.md "Economy", architecture.md 3.4).
 * Pure functions and constants: no storage, no request. Every amount the server ever pays is decided from this file
 * and the server's own tables; nothing here reads a value sent by the phone except an event's time, which is clamped.
 */

/** Coins for the first solve of a case, by the difficulty the SERVER knows for it. Every tutorial board pays 25. */
export const REWARDS = Object.freeze({ tutorial: 25, very_easy: 5, easy: 10, medium: 15, hard: 20, expert: 25 });
/** Coins for one rewarded ad of the "coins" placement (how many a day: CONFIG_DEFAULTS.ad_coins_per_day). */
export const AD_COIN_REWARD = 5;
/** Coins for visiting one of our social pages, once per network for the life of the account. */
export const SOCIAL_REWARD = 25;
export const SOCIAL_NETWORKS = Object.freeze(["facebook", "instagram", "tiktok"]);
/** The Daily Reward list is this long, then starts over. */
export const STREAK_CYCLE = 30;
/** Monday .. Sunday: the daily contract's difficulty and board side (DAILY_PLAN in engine/shadoku_engine.py). */
export const DAILY_PLAN = Object.freeze([["very_easy", 6], ["easy", 7], ["easy", 7], ["medium", 8], ["medium", 8], ["hard", 9], ["expert", 10]]);
/** A daily contract ships the evening before its date (22:00 Lisbon = 21:00 or 22:00 UTC): its solve is accepted from then. */
export const DAILY_RELEASE_LEAD_MS = 3 * 3600 * 1000;
/** Coins for a cosmetic (avatar, prop, furniture) of each rarity, unless its row sets its own price. */
export const COSMETIC_PRICES = Object.freeze({ common: 50, rare: 100, epic: 200, legendary: 400 });
/** The two shelves of cosmetics: an item kind → its group. */
export const COSMETIC_GROUP = Object.freeze({ avatar: "avatar", prop: "hideout", furniture: "hideout" });
/** Free hints a day (decided 2026-11-13): everyone has 5; the two permanent memberships raise it. After them a hint comes from the stock, or from an ad. */
export const HINTS_PER_DAY = Object.freeze({ free: 5, member: 10, member_gold: 15 });
/** → the day's free hints of an account with these entitlement keys. */
export const hintsPerDay = (entitlements) => (entitlements.includes("member_gold") ? HINTS_PER_DAY.member_gold : entitlements.includes("member") ? HINTS_PER_DAY.member : HINTS_PER_DAY.free);
/** Card rarities, most common first. */
export const RARITIES = Object.freeze(["common", "rare", "epic", "legendary"]);
/** A card's variants by tier: three of one tier merge into one of the next (decided 2026-11-13). */
export const VARIANTS = Object.freeze(["card", "bronze", "silver", "gold", "diamond"]);
export const MAX_TIER = VARIANTS.length - 1;
export const MERGE_COUNT = 3;
/** An unpaid ad ticket older than this is dead. */
export const AD_TICKET_TTL_MS = 3600 * 1000;

/**
 * Caps and thresholds; a row in the table app_config (k, JSON v) overrides one of them without a deploy.
 *   ad_coins_per_day          rewarded "coins" ads that pay, per day
 *   ad_client_claims_per_day  ad rewards a day granted without AdMob's server callback (the Play Integrity fallback)
 *   daily_max_age_days        a daily contract older than this pays nothing
 *   sync_max_events           events handled per POST /api/app/sync (the rest come back "deferred")
 *   daily_quests              quests dealt to each player per day, from the active daily ones (FIRST GUESS)
 *   weekly_quests             quests dealt to each player per week, from the active weekly ones (FIRST GUESS)
 *   min_solve_seconds         by board side: a faster solve counts as progress, pays nothing and raises a flag.
 *                             FIRST GUESSES, set low on purpose: tune them with real solve times.
 */
export const CONFIG_DEFAULTS = Object.freeze({
  ad_coins_per_day: 3,
  ad_client_claims_per_day: 5,
  daily_max_age_days: 30,
  sync_max_events: 25,
  daily_quests: 3,
  weekly_quests: 2,
  min_solve_seconds: Object.freeze({ 5: 8, 6: 12, 7: 20, 8: 30, 9: 45, 10: 60, 11: 80, 12: 100 }),
});

/** app_config rows → the configuration. A value that is not JSON, or not of the default's type, is ignored. */
export function parseConfig(rows) {
  const cfg = { ...CONFIG_DEFAULTS, min_solve_seconds: { ...CONFIG_DEFAULTS.min_solve_seconds } };
  for (const row of rows || []) {
    if (!Object.hasOwn(CONFIG_DEFAULTS, row.k)) continue;
    let v;
    try { v = JSON.parse(row.v); } catch { continue; }
    if (typeof CONFIG_DEFAULTS[row.k] === "number") {
      if (Number.isInteger(v) && v >= 0) cfg[row.k] = v;
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      const map = {};
      for (const [side, s] of Object.entries(v)) if (/^\d{1,2}$/.test(side) && Number.isInteger(s) && s >= 0) map[side] = s;
      cfg[row.k] = map;
    }
  }
  return cfg;
}

/* ───────────── calendar ───────────── */
const DAY_MS = 86400000;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Minutes east of UTC, as the phone reports them (-new Date().getTimezoneOffset()), kept inside the real range. */
export const clampTz = (tz) => (Number.isFinite(tz) ? Math.max(-720, Math.min(840, Math.trunc(tz))) : 0);
/** Epoch ms → "YYYY-MM-DD" on the calendar `tz` minutes east of UTC. */
export const dayKey = (ms, tz = 0) => new Date(ms + tz * 60000).toISOString().slice(0, 10);
/** "YYYY-MM-DD" → epoch ms of its UTC midnight, or NaN when it is not a real date. */
export const dayStart = (day) => {
  if (typeof day !== "string" || !DATE_RE.test(day)) return NaN;
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) && dayKey(t) === day ? t : NaN;
};
export const addDays = (day, n) => dayKey(dayStart(day) + n * DAY_MS);
/** 0 = Monday .. 6 = Sunday. */
export const weekday = (day) => (new Date(dayStart(day)).getUTCDay() + 6) % 7;
/** The Monday of the day's week. */
export const weekStart = (day) => addDays(day, -weekday(day));
/** The key a quest's progress is filed under: "d:<day>" or "w:<Monday>". */
export const periodKey = (period, day) => (period === "weekly" ? `w:${weekStart(day)}` : `d:${day}`);
/** The keys a quest may still be claimed for: the running period and the one before it. */
export const claimableKeys = (period, day) => [periodKey(period, day), periodKey(period, addDays(day, period === "weekly" ? -7 : -1))];

/**
 * When an event happened, as far as the server will believe the phone: between the account's previous sync and now.
 * An offline week is credited to its real days, never to more days than passed (architecture 3.4).
 */
export function clampAt(at, floor, now) {
  const lo = Math.min(floor || now, now);
  return Number.isFinite(at) ? Math.max(lo, Math.min(now, Math.trunc(at))) : now;
}

/* ───────────── cases ───────────── */
/** "Very Easy" → "very_easy": the key of REWARDS. */
export const difficultyKey = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z]+/g, "_");

/** Coins for the first solve of a case of this difficulty (0 for one the table does not know). */
export const solveReward = (difficulty) => (Object.hasOwn(REWARDS, difficulty) ? REWARDS[difficulty] : 0);

/**
 * A daily contract's id → what the server knows about it without any table: { mode, difficulty, size } from the weekday plan,
 * { error } when the date is not a real one, not released yet or too old, null when the id is not a daily's.
 */
export function dailyCase(caseId, now, cfg) {
  const m = /^daily-(\d{4}-\d{2}-\d{2})$/.exec(caseId);
  if (!m) return null;
  const t = dayStart(m[1]);
  if (!Number.isFinite(t)) return { error: "bad_date" };
  if (now < t - DAILY_RELEASE_LEAD_MS) return { error: "not_released" };
  if (now - t > (cfg.daily_max_age_days + 1) * DAY_MS) return { error: "too_old" };
  const [difficulty, size] = DAILY_PLAN[weekday(m[1])];
  return { mode: "daily", difficulty, size };
}

/** The kinds of quest the server can advance (quest_defs.kind). */
export const QUEST_KINDS = Object.freeze([
  "solve", "solve_no_hints", "solve_daily", "solve_very_easy", "solve_easy", "solve_medium", "solve_hard", "solve_expert", // a closed contract
  "open_pack", "merge_cards", "new_props", "shop_buy", "watch_ad", "streak", // a pack opened, three cards merged, a hideout item held for the first time, a Shop buy with coins, a rewarded ad, the Daily Reward
]);
/** → true when a quest of this kind advances on a solve with these facts (difficulty: a REWARDS key; mode: daily, story, …). */
export const questCounts = (kind, { hints, difficulty, mode }) =>
  kind === "solve" || (kind === "solve_no_hints" && hints === 0) || (kind === "solve_daily" && mode === "daily") || kind === `solve_${difficulty}`;

/* ───────────── deals: the same answer on every call ───────────── */
/** FNV-1a: a small stable hash for dealing quests and shop shelves. Predictable on purpose; never for anything secret. */
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const byHash = (ids, salt) => ids.map((id) => [hash32(`${salt}|${id}`), id]).sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1)).map((x) => x[1]);

/** The quest ids a period deals an account: `count` of that period's active quests, in slot order. */
export const dealQuests = (defs, period, account, key, count) => byHash(defs.filter((q) => q.period === period).map((q) => q.id), `${account}|${key}`).slice(0, count);

/** A cosmetic's shelf in the Shop: "<group>:<rarity>" (avatar or hideout), or null for anything that is not a priced cosmetic. */
export const shelfOf = (item) => (Object.hasOwn(COSMETIC_GROUP, item.kind) && Object.hasOwn(COSMETIC_PRICES, item.rarity) ? `${COSMETIC_GROUP[item.kind]}:${item.rarity}` : null);

/**
 * A player's cosmetics of the day in the Shop (decided 2026-11-13: random, each player their own): for every shelf, the items
 * on sale in the order this account is dealt them on that date. The first is the day's item; the same on every call.
 * `items`: [{ id, kind, rarity }] on sale. → Map shelf → [item ids]
 */
export function shopShelves(items, day, account) {
  const shelves = new Map();
  for (const it of items) {
    const shelf = shelfOf(it);
    if (shelf) shelves.set(shelf, [...(shelves.get(shelf) || []), it.id]);
  }
  return new Map([...shelves].map(([shelf, ids]) => [shelf, byHash(ids, `${account}|${day}|${shelf}`)]));
}

/* ───────────── packs ───────────── */
/** → a uniform random integer in [0, n), from the platform's cryptographic generator (no modulo bias). */
export function randomInt(n) {
  const limit = Math.floor(0x100000000 / n) * n, buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

/**
 * The table a pack is rolled from, and its name. `data`: the pack row's { cards, hints, guaranteed: [rarities], legendaryEvery };
 * `weights`: { rarity: weight } (pack_odds); `pool`: the active cosmetics [{ id, rarity }].
 * → { version, cards, hints (on the hints card, or 0), guaranteed: [rarities, one card of exactly each], random (number of
 *     random cards), legendaryEvery (the Legendary timer, 0 = none), rarities: [{ rarity, weight, items: [ids] }], total }
 * A rarity with no cosmetic is left out and the others share the whole; a guaranteed rarity with no cosmetic becomes one more
 * random card; without a Legendary cosmetic there is no timer. `version` changes whenever anything a player could have been
 * shown changes.
 */
export function packOdds(packId, data, weights, pool) {
  const rarities = RARITIES.map((rarity) => ({ rarity, weight: Number.isInteger(weights[rarity]) && weights[rarity] > 0 ? weights[rarity] : 0, items: pool.filter((c) => c.rarity === rarity).map((c) => c.id).sort() }))
    .filter((r) => r.items.length);
  const has = (rarity) => rarities.some((r) => r.rarity === rarity);
  const cards = Number.isInteger(data.cards) && data.cards >= 1 && data.cards <= 10 ? data.cards : 5;
  const hints = Number.isInteger(data.hints) && data.hints > 0 ? data.hints : 0;
  const guaranteed = (Array.isArray(data.guaranteed) ? data.guaranteed : [data.guaranteed]).filter((r) => RARITIES.includes(r) && has(r)); // each drawn from its whole rarity
  const legendaryEvery = Number.isInteger(data.legendaryEvery) && data.legendaryEvery > 0 && has("legendary") ? data.legendaryEvery : 0;
  const total = rarities.reduce((n, r) => n + r.weight, 0);
  const random = total ? Math.max(0, cards - (hints ? 1 : 0) - guaranteed.length) : 0;
  const version = hash32(JSON.stringify([packId, cards, hints, guaranteed, legendaryEvery, rarities.map((r) => [r.rarity, r.weight, r.items])])).toString(16).padStart(8, "0");
  return { version, cards, hints, guaranteed, legendaryEvery, random, rarities: total || guaranteed.length ? rarities : [], total };
}

/** → true when the next pack of this kind is the one the Legendary timer pays: `opened` = how many the account opened so far. */
export const legendaryDue = (info, opened) => info.legendaryEvery > 0 && (opened + 1) % info.legendaryEvery === 0;

/**
 * Rolls one pack from its table. `rnd(n)` → an integer in [0, n). `legendary`: the Legendary timer is due (legendaryDue):
 * a guaranteed Legendary card takes the place of one random card.
 * → [{ hints } | { item, rarity, guaranteed?, timer? }]
 */
export function rollPack(info, rnd, { legendary = false } = {}) {
  const cards = [];
  const shelf = (rarity) => info.rarities.find((r) => r.rarity === rarity);
  const from = (r, extra = {}) => ({ item: r.items[rnd(r.items.length)], rarity: r.rarity, ...extra });
  if (info.hints) cards.push({ hints: info.hints });
  for (const rarity of info.guaranteed) cards.push(from(shelf(rarity), { guaranteed: true }));
  let random = info.random;
  if (legendary && info.legendaryEvery && random > 0) { cards.push(from(shelf("legendary"), { guaranteed: true, timer: true })); random--; }
  for (let i = 0; i < random; i++) {
    let x = rnd(info.total);
    cards.push(from(info.rarities.find((r) => (x -= r.weight) < 0)));
  }
  return cards;
}

/* ───────────── shapes ───────────── */
/** An id the phone made up (event id, shop request id): a UUID or the like. */
export const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const CASE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
/** → the integer when v is one inside [lo, hi], else null. */
export const intIn = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
