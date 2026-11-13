/**
 * Quests. Each period (a day, a week) deals every account a few quests from the active list: cfg.daily_quests and
 * cfg.weekly_quests of them, chosen by economy.js dealQuests (the same on every call, so the phone can be told the coming days).
 * A dealt quest is a `quest_state` row; only dealt quests advance, and only the server advances them, from accepted events.
 *
 * Refresh (decided 2026-11-13): a player may swap one daily quest and one weekly quest per day for free, and swap again each
 * time they watch a rewarded ad (placement "quest_refresh"). The swapped quest's row stays, marked replaced, so a period never
 * deals the same quest twice; the new quest takes its slot and starts at zero.
 */
import { post, wrote, newOp } from "./ledger.js";
import { claimableKeys, dayKey, dealQuests, periodKey } from "./economy.js";

const rejected = (reason) => ({ result: "rejected", reason });
const PERIODS = ["daily", "weekly"];
const slotsOf = (cfg, period) => (period === "weekly" ? cfg.weekly_quests : cfg.daily_quests);

/** The active quests (read once per request). */
export async function questDefs(ctx) {
  if (!ctx.defs) ctx.defs = (await ctx.d.prepare("SELECT id, period, kind, target, reward FROM quest_defs WHERE active = 1 ORDER BY period, reward, id").all()).results;
  return ctx.defs;
}

/** The statements that deal the day's and its week's quests, for the slots that have none yet (once per request and day). */
export function dealStatements(ctx, defs, day) {
  const { d, id, cfg } = ctx;
  if (!ctx.dealt) ctx.dealt = new Set();
  if (ctx.dealt.has(day)) return [];
  ctx.dealt.add(day);
  const out = [];
  for (const period of PERIODS) {
    const key = periodKey(period, day);
    dealQuests(defs, period, id, key, slotsOf(cfg, period)).forEach((questId, slot) => out.push(
      d.prepare(
        `INSERT INTO quest_state (account_id, period_key, quest_id, slot) SELECT ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM quest_state WHERE account_id = ? AND period_key = ? AND slot = ?)
         ON CONFLICT (account_id, period_key, quest_id) DO NOTHING`,
      ).bind(id, key, questId, slot, id, key, slot)));
  }
  return out;
}

/**
 * The statements that advance by one every dealt quest whose kind `counts`, if `guard` holds (a ledger.js `when` condition:
 * the event's own row was written by this batch). `day`: the event's day, which names the two periods.
 */
export function questBumps(ctx, defs, day, counts, guard) {
  const { d, id } = ctx;
  return [
    ...dealStatements(ctx, defs, day),
    ...defs.filter((q) => counts(q.kind)).map((q) =>
      d.prepare(`UPDATE quest_state SET progress = progress + 1 WHERE account_id = ? AND period_key = ? AND quest_id = ? AND replaced_at IS NULL AND ${guard.sql}`)
        .bind(id, periodKey(q.period, day), q.id, ...guard.binds)),
  ];
}

/**
 * Collects a finished quest. The claim is paid only if the database finds the quest dealt, at its target and unclaimed, inside
 * the same batch. `key`: the period ("d:…", "w:…"), the running one when left out; the one before it can still be collected.
 */
export async function claimQuest(ctx, questId, key) {
  const { d, id, now, tz } = ctx;
  const defs = await questDefs(ctx), def = defs.find((q) => q.id === questId);
  if (!def) return rejected("unknown_quest");
  if (def.reward <= 0) return rejected("no_reward");
  const day = dayKey(now, tz);
  const keys = claimableKeys(def.period, day);
  const period = key === undefined || key === null ? keys[0] : key;
  if (!keys.includes(period)) return rejected("period");
  const row = "q.account_id = ? AND q.period_key = ? AND q.quest_id = ? AND q.replaced_at IS NULL";
  const line = newOp();
  const deal = period === keys[0] ? dealStatements(ctx, defs, day) : []; // the running period's quests exist before the answer is given
  const res = (await d.batch([
    ...deal,
    ...post(d, {
      id: line, account: id, delta: def.reward, reason: "quest", ref: `${period}:${def.id}`, day, at: now, meta: { kind: def.kind },
      guards: [{ sql: `EXISTS (SELECT 1 FROM quest_state q WHERE ${row} AND q.progress >= ? AND q.claimed_at IS NULL)`, binds: [id, period, def.id, def.target] }],
    }),
    d.prepare(`UPDATE quest_state AS q SET claimed_at = ? WHERE ${row} AND EXISTS (SELECT 1 FROM ledger WHERE id = ?)`).bind(now, id, period, def.id, line),
  ])).slice(deal.length);
  if (wrote(res[0])) return { result: "ok", reward: def.reward, questId: def.id, periodKey: period };
  const s = await d.prepare(`SELECT progress, claimed_at FROM quest_state q WHERE ${row}`).bind(id, period, def.id).first();
  if (!s) return rejected("not_dealt");
  return s.claimed_at ? { result: "duplicate" } : rejected("incomplete");
}

/**
 * Swaps a dealt, unfinished quest of the running period for another one. Without `ticket`: the day's free refresh for that
 * kind of quest (one for daily quests, one for weekly quests). With `ticket`: a paid "quest_refresh" ad ticket, spent here.
 * The allowance and the ticket are checked by the database in the batch that makes the swap.
 * → { result: "ok", questId (the new one), replaced, slot, how } | rejected: not_dealt | claimed | complete | no_other_quest | free_used | ticket
 */
export async function refreshQuest(ctx, questId, ticket) {
  const { d, id, now, tz } = ctx;
  const defs = await questDefs(ctx);
  const def = defs.find((q) => q.id === questId);
  if (!def) return rejected("unknown_quest");
  if (ticket !== undefined && ticket !== null && (typeof ticket !== "string" || !ticket)) return rejected("format");
  const day = dayKey(now, tz), key = periodKey(def.period, day), how = ticket ? "ad" : "free";
  const freeToday = "(SELECT COUNT(*) FROM quest_state f WHERE f.account_id = ? AND f.replaced_day = ? AND f.replaced_how = 'free' AND f.period_key LIKE ?)";
  const freeBinds = [id, day, def.period === "weekly" ? "w:%" : "d:%"];
  const paidTicket = "EXISTS (SELECT 1 FROM ad_tickets t WHERE t.id = ? AND t.account_id = ? AND t.placement = 'quest_refresh' AND t.paid_at IS NOT NULL AND t.used_at IS NULL)";
  for (let attempt = 0; attempt < 3; attempt++) {
    ctx.dealt = null; // deal again inside this read: the quests must exist before one can be swapped
    const pre = await d.batch([
      ...dealStatements(ctx, defs, day),
      d.prepare("SELECT quest_id, slot, progress, claimed_at, replaced_at FROM quest_state WHERE account_id = ? AND period_key = ?").bind(id, key),
    ]);
    const dealt = pre[pre.length - 1].results;
    const mine = dealt.find((r) => r.quest_id === def.id);
    if (!mine || mine.replaced_at) return rejected("not_dealt");
    if (mine.claimed_at) return rejected("claimed");
    if (mine.progress >= def.target) return rejected("complete"); // finished: collect it instead
    const others = defs.filter((q) => q.period === def.period && !dealt.some((r) => r.quest_id === q.id));
    if (!others.length) return rejected("no_other_quest");
    const next = others[crypto.getRandomValues(new Uint32Array(1))[0] % others.length];
    const op = newOp();
    const stmts = [
      d.prepare(
        `UPDATE quest_state SET replaced_at = ?, replaced_day = ?, replaced_how = ?, op = ?
         WHERE account_id = ? AND period_key = ? AND quest_id = ? AND replaced_at IS NULL AND claimed_at IS NULL AND progress < ?
           AND ${ticket ? paidTicket : `${freeToday} = 0`} RETURNING slot`,
      ).bind(now, day, how, op, id, key, def.id, def.target, ...(ticket ? [ticket, id] : freeBinds)),
    ];
    if (ticket) stmts.push(d.prepare("UPDATE ad_tickets SET used_at = ? WHERE id = ? AND account_id = ? AND used_at IS NULL AND EXISTS (SELECT 1 FROM quest_state WHERE op = ?)").bind(now, ticket, id, op));
    // no ON CONFLICT: if a racing refresh was just dealt the same quest, the whole batch (ticket included) rolls back and we choose again
    stmts.push(d.prepare("INSERT INTO quest_state (account_id, period_key, quest_id, slot) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM quest_state WHERE op = ?)").bind(id, key, next.id, mine.slot, op));
    let res;
    try { res = await d.batch(stmts); } catch (e) {
      if (/UNIQUE constraint/i.test(String(e && e.message))) continue;
      throw e;
    }
    if (wrote(res[0])) return { result: "ok", questId: next.id, replaced: def.id, slot: mine.slot, how };
    if (ticket) return rejected("ticket");
    const used = await d.prepare(`SELECT ${freeToday} AS n`).bind(...freeBinds).first();
    if (used.n > 0) return rejected("free_used"); // watch an ad to refresh again
  }
  return rejected("busy");
}
