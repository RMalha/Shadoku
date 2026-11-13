// GET /api/app/bootstrap  →  what the app needs to show the economy and to estimate quest progress offline: the server's time, the
//                             reward table, the caps, the daily plan, the Daily Reward list, the quest list and the quests the next
//                             7 days will deal (before any refresh), the account's hash for Play purchases, and its state.
// The numbers are for DISPLAY: the phone never sends an amount back, and the server pays from its own tables whatever the phone believes.
import { json } from "../../_lib/auth.js";
import { appContext, snapshot } from "../../_lib/app/context.js";
import { accountHash } from "../../_lib/app/billing.js";
import { questDefs } from "../../_lib/app/quests.js";
import { REWARDS, AD_COIN_REWARD, SOCIAL_REWARD, SOCIAL_NETWORKS, STREAK_CYCLE, DAILY_PLAN, COSMETIC_PRICES, HINTS_PER_DAY, MERGE_COUNT, VARIANTS, addDays, dayKey, dealQuests, periodKey } from "../../_lib/app/economy.js";

export async function onRequestGet({ request, env }) {
  const ctx = await appContext(request, env);
  if (ctx.error) return ctx.error;
  const streakRewards = (await ctx.d.prepare("SELECT day, kind, amount, item FROM streak_rewards ORDER BY day").all()).results;
  const defs = await questDefs(ctx), today = dayKey(ctx.now, ctx.tz);
  const coming = Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((day) => ({
    day,
    daily: dealQuests(defs, "daily", ctx.id, periodKey("daily", day), ctx.cfg.daily_quests),
    weekly: dealQuests(defs, "weekly", ctx.id, periodKey("weekly", day), ctx.cfg.weekly_quests),
  }));
  return json({
    serverTime: ctx.now,
    account: { id: ctx.id, kind: ctx.account.kind, purchaseHash: await accountHash(ctx.id) },
    rewards: { solve: REWARDS, ad: AD_COIN_REWARD, social: SOCIAL_REWARD },
    prices: { cosmetics: COSMETIC_PRICES },
    hints: { perDay: HINTS_PER_DAY }, // free hints a day: everyone, a member, a golden member
    cards: { variants: VARIANTS, merge: MERGE_COUNT }, // three of one tier merge into one of the next
    caps: { adCoinsPerDay: ctx.cfg.ad_coins_per_day, syncEvents: ctx.cfg.sync_max_events },
    quests: { dailySlots: ctx.cfg.daily_quests, weeklySlots: ctx.cfg.weekly_quests, list: defs, coming },
    dailyPlan: DAILY_PLAN.map(([difficulty, size]) => ({ difficulty, size })),
    streak: { cycle: STREAK_CYCLE, rewards: streakRewards },
    social: SOCIAL_NETWORKS,
    state: await snapshot(ctx),
  });
}
