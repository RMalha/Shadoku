/**
 * Rewarded ads (architecture 4.5). The flow: the app asks for a ticket, shows the ad with the ticket as its custom data,
 * and a verifier (verifiers.js: AdMob's server callback, or the fallback claim) later says the ad was watched. Only then is
 * the ticket paid, here, once: the ticket can be paid one time and AdMob's transaction id is a primary key.
 * Placements: "coins" (AD_COIN_REWARD coins, cfg.ad_coins_per_day a day), "hint" (one hint), "quest_refresh" and "shop_refresh"
 * (the paid ticket is spent by one refresh: quests.js refreshQuest, shop.js refreshShelf).
 */
import { post, when, wrote, newOp } from "./ledger.js";
import { questBumps, questDefs } from "./quests.js";
import { randomToken } from "../auth.js";
import { AD_COIN_REWARD, AD_TICKET_TTL_MS, dayKey } from "./economy.js";

const PLACEMENTS = ["coins", "hint", "quest_refresh", "shop_refresh"]; // "infinite" (the unlock of an Infinite board) comes with that mode
const rewardOf = (placement) => (placement === "coins" ? { coins: AD_COIN_REWARD } : placement === "hint" ? { hints: 1 } : placement === "quest_refresh" ? { questRefresh: 1 } : { shopRefresh: 1 });

/** Before the ad: → { status, body: { ticket, placement, reward } }, or 409 "cap" when today's coin ads are used up (no ad should be shown). */
export async function createTicket(ctx, placement) {
  const { d, id, cfg, now, tz } = ctx;
  if (!PLACEMENTS.includes(placement)) return { status: 400, body: { error: "placement" } };
  if (placement === "coins") {
    const day = dayKey(now, tz);
    const used = await d.prepare("SELECT COUNT(*) AS n FROM ledger WHERE account_id = ? AND currency = 'coin' AND reason = 'ad' AND day = ?").bind(id, day).first();
    if (used.n >= cfg.ad_coins_per_day) return { status: 409, body: { error: "cap", perDay: cfg.ad_coins_per_day } };
  }
  const ticket = randomToken(18);
  await d.batch([
    d.prepare("DELETE FROM ad_tickets WHERE account_id = ? AND paid_at IS NULL AND created < ?").bind(id, now - 24 * AD_TICKET_TTL_MS), // tickets nobody paid: long dead
    d.prepare("INSERT INTO ad_tickets (id, account_id, placement, created) VALUES (?, ?, ?, ?)").bind(ticket, id, placement, now),
  ]);
  return { status: 200, body: { ticket, placement, reward: rewardOf(placement) } };
}

/** After the ad: the app polls its own ticket until `paid`. */
export async function readTicket(ctx, ticketId) {
  const t = await ctx.d.prepare("SELECT placement, paid_at, verified FROM ad_tickets WHERE id = ? AND account_id = ?").bind(String(ticketId), ctx.id).first();
  return t ? { status: 200, body: { ticket: String(ticketId), placement: t.placement, paid: !!t.paid_at, verified: t.verified || "" } } : { status: 404, body: { error: "not_found" } };
}

/**
 * A verifier said the ad of this ticket was watched: pay it. Called with identifiers only (never an amount).
 *   account: the account the verifier named (AdMob's user_id, or the caller of the fallback claim): it must own the ticket
 *   verified: "ssv" | "client" | "dev"; "client" rewards are limited to cfg.ad_client_claims_per_day
 * → { result: "ok" | "duplicate" | "capped" | "rejected", reason?, reward? }. A "coins" ad beyond the day's cap marks the
 * ticket paid and pays nothing ("capped"): the cap is checked by the database in the paying batch, not only when the ticket was made.
 */
export async function payTicket(d, cfg, { ticketId, account, transactionId, adUnit = "", verified, now }) {
  if (typeof ticketId !== "string" || !ticketId || typeof transactionId !== "string" || !transactionId || transactionId.length > 200) return { result: "rejected", reason: "format" };
  const ticket = await d.prepare("SELECT t.account_id, t.placement, t.paid_at, t.created, a.tz_offset FROM ad_tickets t JOIN accounts a ON a.id = t.account_id WHERE t.id = ?").bind(ticketId).first();
  if (!ticket || ticket.account_id !== account) return { result: "rejected", reason: "ticket" };
  if (ticket.paid_at) return { result: "duplicate" };
  if (now - ticket.created > AD_TICKET_TTL_MS) return { result: "rejected", reason: "expired" };
  const day = dayKey(now, ticket.tz_offset);
  const op = newOp(), line = newOp(), mine = when.gate("ad_rewards", op);
  const viewer = { d, id: account, cfg }; // enough of a context for the "watch an ad" quests
  const clientCap = verified === "client"
    ? " AND (SELECT COUNT(*) FROM ad_rewards r WHERE r.account_id = t.account_id AND r.verified = 'client' AND r.day = ?) < ?" : "";
  const res = await d.batch([
    d.prepare(
      `INSERT INTO ad_rewards (transaction_id, account_id, ticket_id, ad_unit, verified, day, at, op)
       SELECT ?, t.account_id, t.id, ?, ?, ?, ?, ? FROM ad_tickets t WHERE t.id = ? AND t.paid_at IS NULL${clientCap}
       ON CONFLICT (transaction_id) DO NOTHING RETURNING transaction_id`,
    ).bind(transactionId, String(adUnit).slice(0, 100), verified, day, now, op, ticketId, ...(clientCap ? [day, cfg.ad_client_claims_per_day] : [])),
    d.prepare("UPDATE ad_tickets SET paid_at = ?, verified = ? WHERE id = ? AND EXISTS (SELECT 1 FROM ad_rewards WHERE op = ?)").bind(now, verified, ticketId, op),
    ...(ticket.placement === "coins"
      ? post(d, { id: line, account, delta: AD_COIN_REWARD, reason: "ad", ref: transactionId, day, at: now, meta: { ticket: ticketId, verified }, guards: [mine, when.perDay("ad", day, cfg.ad_coins_per_day)] })
      : ticket.placement === "hint"
        ? post(d, { id: line, account, currency: "hint", delta: 1, reason: "ad", ref: transactionId, day, at: now, meta: { ticket: ticketId, verified }, guards: [mine] })
        : []), // quest_refresh, shop_refresh: the paid ticket itself is the reward, spent by one refresh
    ...questBumps(viewer, await questDefs(viewer), day, (kind) => kind === "watch_ad", mine),
  ]);
  if (!wrote(res[0])) { // the transaction was seen before, the ticket was paid by a racing call, or the fallback's daily limit is reached
    const seen = await d.prepare("SELECT 1 AS x FROM ad_rewards WHERE transaction_id = ? OR ticket_id = ?").bind(transactionId, ticketId).first();
    return seen ? { result: "duplicate" } : { result: "rejected", reason: "client_cap" };
  }
  return !["coins", "hint"].includes(ticket.placement) || wrote(res[2]) ? { result: "ok", reward: rewardOf(ticket.placement) } : { result: "capped" };
}
