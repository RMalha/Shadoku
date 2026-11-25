/**
 * Achievements (architecture 4.15; the author's list: app/docs/Stuff.xlsx, sheet "Achievements"; rewards: product_brief.md
 * "Hideout and cosmetics", app/docs/art-plan/). An achievement is a ladder of tiers: a counted one has ten (1, 5, 10 ... 1000:
 * Paper ... Shadow badges), a one-off has one. Each tier reached is a row of `achievements` (migrations/0006) and its reward:
 *   badge   the tier's material (Paper, Plastic, Wood, Metal, Bronze, Silver, Gold, Diamond, Platinum, Shadow): the row itself is
 *           the badge, nothing else is written
 *   items   unique items (no variants: they never come as cards) added to the inventory, one each, never a second
 *   coins   through ledger.js post() (reason "achievement", ref "<id>:<tier>": paid once per account, ever), in the same batch
 *
 * WHERE PROGRESS COMES FROM. Almost every count is read from the server's own tables (solves, pack_opens, streaks, hideout_rooms,
 * entitlements, inventory), never from a counter the phone could push: so an achievement counts everything that happened
 * before it existed, it moves with a guest's things when the guest signs in, and nothing can count twice. The event that can
 * change a count appends the unlock statements to its own batch, guarded by that event's own row (achievementStatements), so
 * the event, the unlock and the reward happen together or not at all, and its answer lists what it unlocked (`unlocked`).
 * GET /api/app/achievements runs every statement once more (a catch-up: a guest's contracts added at sign-in, a case added to
 * an act, an achievement added later), so nothing is ever missed for long.
 * Two one-offs come from the event itself: a daily contract solved between midnight and 6 AM (the hour of the solve's time on
 * the account's clock: the event's `at`, kept between the last sync and now, plus the tz the phone sends; both can be faked,
 * for a coffee machine) and "Create your Avatar" (the sync event `avatar_created`, which a guest can send too: the avatar is
 * saved on the phone until sign-in; faking it gains a pair of sunglasses any player gets by opening the avatar screen).
 *
 * Not built yet, so listed with live: false and never unlocked: 1v1 (played, 2-0, comeback, wins in a row, ELO), Infinite,
 * inviting a friend. Each says what it waits for.
 *
 * Until migration 0006 is applied, every function here does nothing (the events work as before) and GET answers 503 schema.
 */
import { post, newOp } from "./ledger.js";
import { dayKey } from "./economy.js";

/** The badge materials, lowest first (Stuff.xlsx; "Red Diamond" in the art list is Shadow). */
export const MATERIALS = Object.freeze(["paper", "plastic", "wood", "metal", "bronze", "silver", "gold", "diamond", "platinum", "shadow"]);
const TEN = [1, 5, 10, 25, 50, 100, 250, 500, 750, 1000];
const ladder = (targets, from = 0) => targets.map((target, i) => ({ target, badge: MATERIALS[from + i] }));
const COUNTED = ladder(TEN);
const DIFFICULTIES = ["very_easy", "easy", "medium", "hard", "expert"];

/* SQL of a count, for the account bound as `?` (each `binds` lists how many times). Table and column names are code. */
const solves = (extra = "") => ({ sql: `(SELECT COUNT(*) FROM solves s WHERE s.account_id = ? AND s.mode <> 'tutorial'${extra})`, n: 1 });
/** Every active case of a set solved: the count solved, and the set's size (the tier is reached when both match and the set is not empty). */
const everyCase = (where) => ({
  sql: `(SELECT COUNT(*) FROM case_index c WHERE c.active = 1 AND ${where} AND EXISTS (SELECT 1 FROM solves s WHERE s.account_id = ? AND s.case_id = c.case_id))`, n: 1,
  of: `(SELECT COUNT(*) FROM case_index c WHERE c.active = 1 AND ${where})`,
});
const UPGRADES = ["remove_ads", "member", "member_gold"];
/** Every cosmetic that comes as a card (a rarity of the packs): what "Collect everything" means. */
const CARD_ITEMS = "i.active = 1 AND i.kind IN ('avatar', 'prop', 'furniture') AND i.rarity IN ('common', 'rare', 'epic', 'legendary')";

/**
 * The list. id: stable (rows and ledger refs use it). group: for the app's screen. tiers: [{ target, badge?, items?, coins? }].
 * value: the SQL count (null: the event itself unlocks it). live: false while the feature it needs is not built.
 */
export const ACHIEVEMENTS = Object.freeze([
  { id: "tutorial", group: "story", tiers: [{ target: 1, items: ["ASSASSIN_PERMIT"], coins: 25 }], value: everyCase("c.mode = 'tutorial'") },
  { id: "act1", group: "story", tiers: [{ target: 1, items: ["clothing-noirCloak"] }], value: everyCase("c.mode = 'story' AND c.case_id LIKE 'a1c%'") },
  { id: "act2", group: "story", tiers: [{ target: 1, items: ["glasses-umbra"] }], value: everyCase("c.mode = 'story' AND c.case_id LIKE 'a2c%'") },
  { id: "contracts", group: "contracts", tiers: COUNTED, value: solves() },
  ...DIFFICULTIES.map((k) => ({ id: `contracts_${k}`, group: "difficulty", tiers: COUNTED, value: solves(` AND s.difficulty = '${k}'`) })),
  ...DIFFICULTIES.map((k) => ({ id: `no_hints_${k}`, group: "no_hints", tiers: COUNTED, value: solves(` AND s.difficulty = '${k}' AND s.hints = 0`) })),
  { id: "night_daily", group: "contracts", tiers: [{ target: 1, items: ["COFFEE_MACHINE"] }], value: null },
  { id: "streak", group: "streak", tiers: [{ target: 7, items: ["POCKET_WATCH"] }, { target: 30, items: ["CALENDAR"] }, { target: 100, items: ["CLOCK"] }],
    value: { sql: "COALESCE((SELECT st.best FROM streaks st WHERE st.account_id = ?), 0)", n: 1 } },
  { id: "packs", group: "packs", tiers: COUNTED, value: { sql: "(SELECT COUNT(*) FROM pack_opens p WHERE p.account_id = ?)", n: 1 } },
  { id: "collect_all", group: "collection", tiers: [{ target: 1, items: ["GOLDEN_FLOOR"] }],
    value: { sql: `(SELECT COUNT(DISTINCT v.item_id) FROM inventory v JOIN items i ON i.id = v.item_id WHERE v.account_id = ? AND ${CARD_ITEMS})`, n: 1, of: `(SELECT COUNT(*) FROM items i WHERE ${CARD_ITEMS})` } },
  { id: "support", group: "support", tiers: [{ target: 1, items: ["COMPUTER"] }],
    value: { sql: `(SELECT COUNT(*) FROM entitlements e WHERE e.account_id = ? AND e.key IN (${UPGRADES.map((k) => `'${k}'`).join(", ")}))`, n: 1 } },
  { id: "hideout_edit", group: "hideout", tiers: [{ target: 1, items: ["WELCOME_MAT"] }], value: { sql: "COALESCE((SELECT MAX(r.version) FROM hideout_rooms r WHERE r.account_id = ?), 0)", n: 1 } },
  // the first time ANY room reaches the size (the author, 2026-11-25)
  { id: "hideout_size", group: "hideout", tiers: ladder([5, 6, 7, 8, 9, 10], 4), value: { sql: "COALESCE((SELECT MAX(r.size) FROM hideout_rooms r WHERE r.account_id = ?), 4)", n: 1 } },
  { id: "hideout_room", group: "hideout", tiers: [{ target: 1, items: ["DOOR_FRONT", "DOOR_SIDE"] }], value: { sql: "(SELECT COUNT(*) FROM hideout_rooms r WHERE r.account_id = ? AND r.room > 1)", n: 1 } },
  { id: "avatar", group: "avatar", tiers: [{ target: 1, items: ["glasses-wayfarers"] }], value: null },
  // not built yet
  { id: "invite_friend", group: "social", tiers: [{ target: 1, items: ["acc-friendship"] }], value: null, live: false, waits: "friends (Social phase)" },
  { id: "infinite", group: "infinite", tiers: COUNTED, value: null, live: false, waits: "Infinite" },
  { id: "duel_played", group: "duel", tiers: COUNTED, value: null, live: false, waits: "1v1" },
  { id: "duel_clean", group: "duel", tiers: [{ target: 1, items: ["PUNCHING_BAG"] }], value: null, live: false, waits: "1v1 (a match won 2-0)" },
  { id: "duel_comeback", group: "duel", tiers: [{ target: 1, items: ["hat-neverGiveUp"] }], value: null, live: false, waits: "1v1 (won 2-1 after losing the first round)" },
  { id: "duel_streak", group: "duel", tiers: ladder([2, 3, 5, 7, 11, 13, 17, 19, 23, 29]), value: null, live: false, waits: "1v1 (matches won in a row)" },
  { id: "duel_elo", group: "duel", tiers: ladder([1200, 1400, 1600, 1800, 2000, 2500], 4), value: null, live: false, waits: "1v1 (ELO)" },
]);
const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
/** Every item an achievement gives (migrations/0006 seeds an `items` row for each: kind prop or avatar, rarity "unique"). */
export const REWARD_ITEMS = Object.freeze([...new Set(ACHIEVEMENTS.flatMap((a) => a.tiers.flatMap((t) => t.items || [])))]);

/** Which achievements an event can move. */
export const ON = Object.freeze({
  solve: ({ mode, difficulty, hints }) => [
    ...(mode === "tutorial" ? ["tutorial"] : ["contracts", `contracts_${difficulty}`, ...(hints === 0 ? [`no_hints_${difficulty}`] : [])]),
    ...(mode === "story" ? ["act1", "act2"] : []),
  ].filter((id) => BY_ID.has(id)),
  pack: ["packs", "collect_all"],
  cosmetic: ["collect_all"], // a card bought or won
  streak: ["streak", "collect_all"],
  upgrade: ["support"],
});

/** True once migration 0006 is applied (remembered per isolate once it is; looked at once per request until then). */
let seen = false;
export async function achievementsReady(ctx) {
  if (seen) return true;
  if (ctx.achievementsReady === undefined) {
    const row = await ctx.d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'achievements'").first();
    ctx.achievementsReady = !!row && row.n === 1;
    seen = ctx.achievementsReady;
  }
  return ctx.achievementsReady;
}

const tierRow = (id, achievement, tier, op) => ({ sql: "EXISTS (SELECT 1 FROM achievements WHERE account_id = ? AND achievement = ? AND tier = ? AND op = ?)", binds: [id, achievement, tier, op] });

/**
 * The statements that unlock every tier of these achievements the account has reached, and give their rewards, for one batch.
 * `op`: a fresh id that stamps this batch's unlocks (unlocksOf reads them back). `guard`: a ledger.js `when` condition, the
 * event's own row written by this batch (or none, for the catch-up). `day`: the account's date (ledger lines). Achievements
 * with no count (value null) unlock their first tier outright: the caller decided that the event is the achievement.
 * Returns [] until migration 0006 is applied.
 */
export async function achievementStatements(ctx, ids, { op, day, guard = null }) {
  if (!ids.length || !(await achievementsReady(ctx))) return [];
  const { d, id, now } = ctx, out = [];
  for (const aid of ids) {
    const a = BY_ID.get(aid);
    if (!a || a.live === false) continue;
    const values = a.tiers.map((t, i) => `(${i + 1}, ${t.target})`).join(", ");
    const binds = a.value ? Array(a.value.n).fill(id) : [];
    const reached = !a.value ? "t.column1 = 1" : a.value.of ? `${a.value.sql} >= ${a.value.of} AND ${a.value.of} > 0` : `${a.value.sql} >= t.column2`;
    out.push(d.prepare(
      `INSERT INTO achievements (account_id, achievement, tier, at, op) SELECT ?, ?, t.column1, ?, ? FROM (VALUES ${values}) t
       WHERE ${guard ? `(${guard.sql}) AND ` : ""}${reached} ON CONFLICT (account_id, achievement, tier) DO NOTHING`,
    ).bind(id, aid, now, op, ...(guard ? guard.binds : []), ...binds));
    a.tiers.forEach((t, i) => {
      const mine = tierRow(id, aid, i + 1, op);
      for (const item of t.items || []) { // unique: one, never a second (a row at qty 0 is one the account held once and gave up)
        out.push(d.prepare(`INSERT INTO inventory (account_id, item_id, tier, qty, first_at) SELECT ?, ?, 0, 1, ? WHERE ${mine.sql} ON CONFLICT (account_id, item_id, tier) DO NOTHING`)
          .bind(id, item, now, ...mine.binds));
      }
      if (t.coins) out.push(...post(d, { id: newOp(), account: id, delta: t.coins, reason: "achievement", ref: `${aid}:${i + 1}`, day, at: now, meta: { achievement: aid, tier: i + 1 }, guards: [mine] }));
    });
  }
  return out;
}

/** What a tier gives, as the app shows it. */
const rewardOf = (t) => ({ ...(t.badge ? { badge: t.badge } : {}), ...(t.items ? { items: t.items } : {}), ...(t.coins ? { coins: t.coins } : {}) });

/** → the tiers this batch unlocked (stamped `op`): [{ id, tier, reward }]. Empty until migration 0006 is applied. */
export async function unlocksOf(ctx, op) {
  if (!(await achievementsReady(ctx))) return [];
  const rows = (await ctx.d.prepare("SELECT achievement, tier FROM achievements WHERE account_id = ? AND op = ? ORDER BY achievement, tier").bind(ctx.id, op).all()).results;
  return rows.filter((r) => BY_ID.has(r.achievement)).map((r) => ({ id: r.achievement, tier: r.tier, reward: rewardOf(BY_ID.get(r.achievement).tiers[r.tier - 1]) }));
}

/**
 * GET /api/app/achievements → { status, body: { achievements, badges, materials, unlocked } }.
 * First the catch-up (every live achievement with a count, in one batch), then one entry per tier:
 *   { id: "<achievement>:<tier>", achievement, group, tier, tiers (how many the ladder has), target, progress, done, doneAt,
 *     reward: { badge? | items? | coins? }, live, waits? }
 * progress is the count now (for "every contract of a set": cases solved, target = cases in the set); a one-off without a
 * count shows 1 once done. badges: every badge earned, [{ achievement, tier, material, at }]. unlocked: what the catch-up
 * unlocked just now (normally nothing).
 */
export async function listAchievements(ctx) {
  const { d, id } = ctx;
  if (!(await achievementsReady(ctx))) return { status: 503, body: { error: "schema" } };
  const op = newOp();
  const counted = ACHIEVEMENTS.filter((a) => a.value && a.live !== false);
  await d.batch(await achievementStatements(ctx, counted.map((a) => a.id), { op, day: dayKey(ctx.now, ctx.tz) }));
  const res = await d.batch([
    d.prepare("SELECT achievement, tier, at FROM achievements WHERE account_id = ?").bind(id),
    ...counted.map((a) => d.prepare(`SELECT ${a.value.sql} AS v${a.value.of ? `, ${a.value.of} AS t` : ""}`).bind(...Array(a.value.n).fill(id))),
  ]);
  const done = new Map(res[0].results.map((r) => [`${r.achievement}:${r.tier}`, r.at]));
  const counts = new Map(counted.map((a, i) => [a.id, res[i + 1].results[0]]));
  const achievements = [];
  for (const a of ACHIEVEMENTS) {
    const c = counts.get(a.id);
    a.tiers.forEach((t, i) => {
      const key = `${a.id}:${i + 1}`, at = done.has(key) ? done.get(key) : null;
      const target = c && c.t !== undefined ? c.t : t.target;
      const progress = c ? c.v : at !== null ? t.target : 0;
      achievements.push({
        id: key, achievement: a.id, group: a.group, tier: i + 1, tiers: a.tiers.length, target, progress, done: at !== null, doneAt: at,
        reward: rewardOf(t), live: a.live !== false, ...(a.waits ? { waits: a.waits } : {}),
      });
    });
  }
  const badges = res[0].results.filter((r) => BY_ID.has(r.achievement) && BY_ID.get(r.achievement).tiers[r.tier - 1] && BY_ID.get(r.achievement).tiers[r.tier - 1].badge)
    .sort((x, y) => x.at - y.at || (x.achievement < y.achievement ? -1 : 1) || x.tier - y.tier)
    .map((r) => ({ achievement: r.achievement, tier: r.tier, material: BY_ID.get(r.achievement).tiers[r.tier - 1].badge, at: r.at }));
  return { status: 200, body: { achievements, badges, materials: MATERIALS, unlocked: await unlocksOf(ctx, op) } };
}
