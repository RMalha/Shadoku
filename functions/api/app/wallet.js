// GET /api/app/wallet  →  { state, history }   the account's balances and state (functions/_lib/app/context.js snapshot) and its
//                          last 50 ledger lines, newest first (the Profile's history). Read-only: nothing a phone sends changes a balance here.
import { json } from "../../_lib/auth.js";
import { appContext, snapshot } from "../../_lib/app/context.js";

export async function onRequestGet({ request, env }) {
  const ctx = await appContext(request, env);
  if (ctx.error) return ctx.error;
  const history = (await ctx.d.prepare("SELECT currency, delta, reason, ref, balance_after AS balance, day, at FROM ledger WHERE account_id = ? ORDER BY seq DESC LIMIT 50").bind(ctx.id).all()).results;
  return json({ state: await snapshot(ctx), history });
}
