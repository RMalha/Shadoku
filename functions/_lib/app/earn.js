/**
 * Earning by play: the sync outbox (solves, hint use, streak and quest claims) and the one-time social rewards. (Quests: quests.js.)
 * The phone reports what happened; every amount comes from economy.js and the server's tables (architecture 3: "the phone
 * records what happened, the server decides what it was worth"). Each function returns a small result object:
 *   { result: "ok" | "duplicate" | "rejected", reward?, reason? }
 * "duplicate" = already counted (a resend): nothing changed. There is no daily ceiling on coins (decided 2026-11-13): what
 * bounds earning is that each source pays once (a case, a date, a quest of a period, a network) or a few times a day (ads).
 */
import { post, when, wrote, newOp, lineFor } from "./ledger.js";
import { flag, snapshot } from "./context.js";
import { claimQuest, questBumps, questDefs } from "./quests.js";
import {
  CASE_ID_RE, CLIENT_ID_RE, COSMETIC_GROUP, HINTS_PER_DAY, SOCIAL_NETWORKS, SOCIAL_REWARD, STREAK_CYCLE,
  addDays, clampAt, clampTz, dailyCase, dayKey, dayStart, difficultyKey, intIn, questCounts, randomInt, solveReward,
} from "./economy.js";

const rejected = (reason) => ({ result: "rejected", reason });

/* ───────────── solve ───────────── */
/**
 * A closed contract. Pays once per case and account (the `solves` primary key and the ledger key), at the rate of the
 * difficulty the server has for the case: the tutorial/story/classic index, or the weekday plan for a daily.
 * A solve faster than the board's minimum counts as progress, pays nothing and raises a flag.
 */
async function solve(ctx, ev, at, day) {
  const { d, id, cfg, now } = ctx;
  const seconds = intIn(ev.seconds, 0, 864000), hints = intIn(ev.hints, 0, 999);
  if (typeof ev.caseId !== "string" || !CASE_ID_RE.test(ev.caseId) || seconds === null || hints === null) return rejected("format");
  let info = dailyCase(ev.caseId, now, cfg);
  if (info && info.error) return rejected(info.error);
  if (!info) {
    const row = await d.prepare("SELECT mode, difficulty, size FROM case_index WHERE case_id = ? AND active = 1").bind(ev.caseId).first();
    if (!row) return rejected("unknown_case");
    info = { mode: row.mode, difficulty: row.mode === "tutorial" ? "tutorial" : difficultyKey(row.difficulty), size: row.size };
  }
  const min = cfg.min_solve_seconds[info.size] || 0;
  const fast = seconds < min;
  const reward = fast ? 0 : solveReward(info.difficulty);
  const op = newOp(), mine = when.gate("solves", op);
  const stmts = [
    d.prepare(
      `INSERT INTO solves (account_id, case_id, mode, difficulty, seconds, hints, device_at, at, day, paid, flagged, op)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (account_id, case_id) DO NOTHING RETURNING case_id`,
    ).bind(id, ev.caseId, info.mode, info.difficulty, seconds, hints, Number.isFinite(ev.at) ? Math.trunc(ev.at) : 0, now, day, reward, fast ? 1 : 0, op),
  ];
  if (reward > 0) stmts.push(...post(d, { id: newOp(), account: id, delta: reward, reason: "solve", ref: ev.caseId, day, at: now, meta: { mode: info.mode, difficulty: info.difficulty }, guards: [mine] }));
  if (fast) stmts.push(flag(d, id, "fast_solve", { caseId: ev.caseId, seconds, min }, now, mine));
  stmts.push(...questBumps(ctx, await questDefs(ctx), day, (kind) => questCounts(kind, { hints, difficulty: info.difficulty, mode: info.mode }), mine));
  const res = await d.batch(stmts);
  if (!wrote(res[0])) return { result: "duplicate" };
  return fast ? { result: "ok", reward: 0, flagged: "fast_solve" } : { result: "ok", reward };
}

/* ───────────── hints ───────────── */
/** The day's free hints of the account `?`, in SQL: its entitlements decide (economy.js HINTS_PER_DAY). */
const FREE_HINTS = `CASE WHEN EXISTS (SELECT 1 FROM entitlements e WHERE e.account_id = ? AND e.key = 'member_gold') THEN ${HINTS_PER_DAY.member_gold}
  WHEN EXISTS (SELECT 1 FROM entitlements e WHERE e.account_id = ? AND e.key = 'member') THEN ${HINTS_PER_DAY.member} ELSE ${HINTS_PER_DAY.free} END`;

/**
 * A hint was used (possibly offline), on the event's day. The day's free hints go first (5, or 10 / 15 with a membership); after
 * them one hint of the stock is spent (bought, won, or earned with an ad). With neither, the event is refused and flagged: the
 * stock never goes below zero. Counted once per event, by the database, in one batch.
 */
async function hintUse(ctx, ev, day) {
  const { d, id, now } = ctx;
  const line = newOp(), caseId = typeof ev.caseId === "string" && CASE_ID_RE.test(ev.caseId) ? ev.caseId : "";
  const note = (source, condition) => `INSERT INTO hint_uses (account_id, event_id, day, source, case_id, at) SELECT ?, ?, ?, '${source}', ?, ? WHERE ${condition}
    ON CONFLICT (account_id, event_id) DO NOTHING RETURNING source`;
  const res = await d.batch([
    d.prepare(note("free", `(SELECT COUNT(*) FROM hint_uses h WHERE h.account_id = ? AND h.day = ? AND h.source = 'free') < ${FREE_HINTS}`)).bind(id, ev.eventId, day, caseId, now, id, day, id, id),
    ...post(d, {
      id: line, account: id, currency: "hint", delta: -1, reason: "hint_use", ref: ev.eventId, day, at: now, meta: caseId ? { caseId } : null,
      guards: [when.funds("hint", 1), { sql: "NOT EXISTS (SELECT 1 FROM hint_uses h WHERE h.account_id = w.account_id AND h.event_id = ?)", binds: [ev.eventId] }],
    }),
    d.prepare(note("stock", "EXISTS (SELECT 1 FROM ledger WHERE id = ?)")).bind(id, ev.eventId, day, caseId, now, line),
  ]);
  if (wrote(res[0])) return { result: "ok", source: "free" };
  if (wrote(res[1])) return { result: "ok", source: "stock" };
  if (await d.prepare("SELECT 1 AS x FROM hint_uses WHERE account_id = ? AND event_id = ?").bind(id, ev.eventId).first()) return { result: "duplicate" };
  await flag(d, id, "hint_overuse", { eventId: ev.eventId }, now).run();
  return rejected("no_stock");
}

/* ───────────── daily streak ───────────── */
/**
 * What a day of the Daily Reward list gives this account: { coins } | { hints } | { item, qty } | null.
 * A "cosmetic" day draws one item of its shelf (group and rarity) at random: a duplicate if the account holds it already
 * (duplicates merge into variants: packs.js). A shelf with no item gives nothing.
 */
async function streakReward(ctx, row) {
  if (!row) return null;
  if (row.kind === "coins") return { coins: row.amount };
  if (row.kind === "hints") return { hints: row.amount };
  if (row.kind === "item") return row.item ? { item: row.item, qty: row.amount } : null;
  const [group, rarity] = String(row.item).split(":");
  const kinds = Object.keys(COSMETIC_GROUP).filter((k) => COSMETIC_GROUP[k] === group);
  if (!kinds.length) return null;
  const free = (await ctx.d.prepare(
    `SELECT id FROM items WHERE active = 1 AND rarity = ? AND kind IN (${kinds.map(() => "?").join(", ")}) ORDER BY id`,
  ).bind(rarity || "", ...kinds).all()).results;
  return free.length ? { item: free[randomInt(free.length)].id, qty: 1 } : null;
}

/**
 * The Daily Reward for `date`, the phone's local date. A device clock cannot be trusted, so the date must be within one day
 * of the server's (every time zone on Earth is) and later than the last claimed one: N days can never yield more than N + 2 claims.
 * The day after the last claim continues the streak and the 30-day list; any gap starts both again at day 1.
 * → { result, reward: { coins } | { hints } | { item, qty } | null, current, cycleDay }
 */
export async function claimStreak(ctx, date, attempt = 1) {
  const { d, id, now } = ctx;
  if (!Number.isFinite(dayStart(date))) return rejected("format");
  const today = dayKey(now);
  if (date < addDays(today, -1) || date > addDays(today, 1)) return rejected("date");
  const pre = await d.batch([
    d.prepare("INSERT INTO streaks (account_id) VALUES (?) ON CONFLICT (account_id) DO NOTHING").bind(id),
    d.prepare("SELECT current, last_date, cycle_day FROM streaks WHERE account_id = ?").bind(id),
    d.prepare("SELECT day, kind, amount, item FROM streak_rewards"),
  ]);
  const cur = pre[1].results[0];
  if (cur.last_date === date) return { result: "duplicate" };
  if (cur.last_date > date) return rejected("date");
  const follows = cur.last_date === addDays(date, -1);
  const current = follows ? cur.current + 1 : 1;
  const cycleDay = follows ? (cur.cycle_day % STREAK_CYCLE) + 1 : 1;
  const reward = await streakReward(ctx, pre[2].results.find((r) => r.day === cycleDay));
  const op = newOp(), mine = when.gate("streaks", op);
  const stmts = [ // the row must still be as it was read: two claims racing cannot both advance it
    d.prepare("UPDATE streaks SET current = ?, best = MAX(best, ?), last_date = ?, cycle_day = ?, op = ? WHERE account_id = ? AND last_date = ? AND current = ? RETURNING current")
      .bind(current, current, date, cycleDay, op, id, cur.last_date, cur.current),
  ];
  if (reward && reward.coins) stmts.push(...post(d, { id: newOp(), account: id, delta: reward.coins, reason: "streak", ref: date, day: date, at: now, meta: { cycleDay }, guards: [mine] }));
  if (reward && reward.hints) stmts.push(...post(d, { id: newOp(), account: id, currency: "hint", delta: reward.hints, reason: "streak", ref: date, day: date, at: now, meta: { cycleDay }, guards: [mine] }));
  if (reward && reward.item) {
    stmts.push(d.prepare(`INSERT INTO inventory (account_id, item_id, qty, first_at) SELECT ?, ?, ?, ? WHERE ${mine.sql} ON CONFLICT (account_id, item_id, tier) DO UPDATE SET qty = qty + excluded.qty`)
      .bind(id, reward.item, reward.qty, now, ...mine.binds));
  }
  stmts.push(...questBumps(ctx, await questDefs(ctx), date, (kind) => kind === "streak", mine));
  const res = await d.batch(stmts);
  // another claim moved the streak between the read and the batch: read again (it was this date, or this one now follows it)
  if (!wrote(res[0])) return attempt < 3 ? claimStreak(ctx, date, attempt + 1) : rejected("busy");
  return { result: "ok", reward, current, cycleDay };
}

/* ───────────── social visits ───────────── */
/** The player tapped one of our social cards: remember the visit (the reward is for the visit, never for a like or a follow). */
export async function socialOpen(ctx, network) {
  if (!SOCIAL_NETWORKS.includes(network)) return rejected("network");
  await ctx.d.prepare("INSERT INTO social_visits (account_id, network, opened_at) VALUES (?, ?, ?) ON CONFLICT (account_id, network) DO NOTHING").bind(ctx.id, network, ctx.now).run();
  return { result: "ok" };
}

/** Collects the visit's reward: once per network for the life of the account (the ledger key), on any device. */
export async function socialClaim(ctx, network) {
  const { d, id, now, tz } = ctx;
  if (!SOCIAL_NETWORKS.includes(network)) return rejected("network");
  const res = await d.batch(post(d, {
    id: newOp(), account: id, delta: SOCIAL_REWARD, reason: "social", ref: network, day: dayKey(now, tz), at: now,
    guards: [{ sql: "EXISTS (SELECT 1 FROM social_visits v WHERE v.account_id = w.account_id AND v.network = ?)", binds: [network] }],
  }));
  if (wrote(res[0])) return { result: "ok", reward: SOCIAL_REWARD };
  return (await lineFor(d, id, "coin", "social", network)) ? { result: "duplicate" } : rejected("not_opened");
}

/* ───────────── the outbox ───────────── */
async function applyEvent(ctx, ev, floor) {
  if (!ev || typeof ev !== "object" || Array.isArray(ev) || typeof ev.eventId !== "string" || !CLIENT_ID_RE.test(ev.eventId)) return rejected("format");
  const at = clampAt(ev.at, floor, ctx.now), day = dayKey(at, ctx.tz);
  switch (ev.type) {
    case "solve": return solve(ctx, ev, at, day);
    case "hint_use": return hintUse(ctx, ev, day);
    case "streak_claim": return claimStreak(ctx, ev.date);
    case "quest_claim": return typeof ev.questId === "string" ? claimQuest(ctx, ev.questId, ev.periodKey) : rejected("format");
    default: return rejected("type");
  }
}

/**
 * POST /api/app/sync: the phone's outbox, in order. → { status, body: { results: [{ eventId, result, … }], state } }.
 * Events are independent: one that is refused does not stop the ones after it. A resend of the whole batch changes nothing.
 * `body.tz` (minutes east of UTC) moves where the account's day starts; day keys are dates, so changing it cannot repeat a day.
 */
export async function runSync(ctx, body) {
  const { d, id, cfg, account, now } = ctx;
  if (!Array.isArray(body.events)) return { status: 400, body: { error: "format" } };
  if (body.tz !== undefined) ctx.tz = clampTz(body.tz);
  const floor = account.last_sync || account.created;
  const results = [];
  for (const [i, ev] of body.events.entries()) {
    const eventId = ev && typeof ev.eventId === "string" ? ev.eventId.slice(0, 64) : "";
    results.push({ eventId, ...(i < cfg.sync_max_events ? await applyEvent(ctx, ev, floor) : { result: "deferred" }) });
  }
  await d.prepare("UPDATE accounts SET last_sync = ?, tz_offset = ? WHERE id = ?").bind(now, ctx.tz, id).run();
  return { status: 200, body: { results, state: await snapshot(ctx) } };
}
