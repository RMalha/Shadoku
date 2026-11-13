/**
 * Real-money purchases (architecture 4.4). The phone sends a Play purchase token; a BillingVerifier (verifiers.js) asks Google
 * whether it is real; what it grants comes from the server's `items` row for the sku (data: {"coins": n, "hints": n,
 * "entitlements": ["remove_ads", "member"], "inventory": {"<item id>": n}, "once": true}). The token's SHA-256 is the primary key of
 * `purchases`, so a token grants once, for one account. "once" (the Noob Kit): one per account, ever, kept as the entitlement
 * "once:<item id>"; a second purchase is refused before it is consumed, so Google refunds it.
 * Refunds write a negative `refund` line; a balance below zero blocks spending until it recovers (ledger.js when.funds).
 */
import { post, when, wrote, newOp } from "./ledger.js";
import { sha256b64u } from "../auth.js";
import { dayKey } from "./economy.js";
import { snapshot } from "./context.js";

const FAIL_STATUS = { unconfigured: 503, upstream: 502, pending: 409, wrong_account: 403, invalid: 400 };

/** What the app passes to Play as obfuscatedAccountId when it starts a purchase; the verifier checks Google reports the same. */
export const accountHash = (id) => sha256b64u(`shadoku-account|${id}`);

const grantOf = (item) => {
  let data = {};
  try { data = JSON.parse(item.data) || {}; } catch { /* a broken row grants nothing */ }
  const amount = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
  const inventory = data.inventory && typeof data.inventory === "object" && !Array.isArray(data.inventory)
    ? Object.entries(data.inventory).filter(([itemId, qty]) => /^[A-Za-z0-9_.-]{1,64}$/.test(itemId) && amount(qty)) : [];
  const entitlements = [...(Array.isArray(data.entitlements) ? data.entitlements : []), data.entitlement].filter((key) => typeof key === "string" && /^[a-z0-9_]{1,40}$/.test(key));
  return { coins: amount(data.coins), hints: amount(data.hints), entitlements, inventory, once: data.once === true };
};
const onceKey = (itemId) => `once:${itemId}`;
const shown = (grant) => ({ coins: grant.coins, hints: grant.hints, entitlements: grant.entitlements, inventory: Object.fromEntries(grant.inventory) });

// a product that grants an entitlement is permanent (No ads, the memberships): acknowledged, never consumed
const finish = async (d, verifier, item, purchaseToken, tokenHash) => {
  const done = await verifier.finishPurchase({ sku: item.sku, purchaseToken, consumable: !grantOf(item).entitlements.length }).catch(() => ({ ok: false }));
  if (done && done.ok) await d.prepare("UPDATE purchases SET consumed = 1 WHERE token_hash = ?").bind(tokenHash).run();
  return !!(done && done.ok);
};

/**
 * POST /api/app/billing/verify { sku, purchaseToken } → { status, body }.
 * The app re-sends unfinished purchases on every launch: a token already granted answers ok with duplicate: true (and the
 * consume/acknowledge step is tried again if it had failed), so nothing depends on the phone remembering.
 */
export async function redeem(ctx, verifier, { sku, purchaseToken }) {
  const { d, id, account, now, tz } = ctx;
  if (account.kind !== "full") return { status: 403, body: { error: "signin_required" } }; // a guest account dies with a reinstall: bought coins must not
  if (typeof sku !== "string" || !/^[A-Za-z0-9_.]{1,80}$/.test(sku) || typeof purchaseToken !== "string" || purchaseToken.length < 8 || purchaseToken.length > 4096) return { status: 400, body: { error: "format" } };
  const item = await d.prepare("SELECT id, kind, sku, data FROM items WHERE sku = ? AND active = 1").bind(sku).first();
  if (!item) return { status: 404, body: { error: "unknown_sku" } };
  const grant = grantOf(item);
  const tokenHash = await sha256b64u(purchaseToken);
  const known = await d.prepare("SELECT account_id, sku, consumed, voided_at FROM purchases WHERE token_hash = ?").bind(tokenHash).first();
  if (known) {
    if (known.account_id !== id || known.sku !== sku) return { status: 409, body: { error: "token_used" } };
    if (known.voided_at) return { status: 409, body: { error: "voided" } };
    if (!known.consumed) await finish(d, verifier, item, purchaseToken, tokenHash);
    return { status: 200, body: { ok: true, duplicate: true, state: await snapshot(ctx) } };
  }
  const had = "EXISTS (SELECT 1 FROM entitlements e WHERE e.account_id = ? AND e.key = ?)";
  if (grant.once && (await d.prepare(`SELECT ${had} AS x`).bind(id, onceKey(item.id)).first()).x) return { status: 409, body: { error: "owned" } };
  const v = await verifier.verifyPurchase({ sku, purchaseToken, accountId: id, accountHash: await accountHash(id) });
  if (!v || !v.ok) {
    const error = v && Object.hasOwn(FAIL_STATUS, v.error) ? v.error : "invalid";
    return { status: FAIL_STATUS[error], body: { error: error === "unconfigured" ? "billing_unavailable" : error } };
  }
  const op = newOp(), mine = when.gate("purchases", op), day = dayKey(now, tz), meta = { sku, item: item.id };
  const stmts = [
    d.prepare( // a once-only product: the row is written only if the account does not have it (two tokens racing: one wins)
      `INSERT INTO purchases (token_hash, account_id, sku, order_id, state, purchased_at, verified_at, op) SELECT ?, ?, ?, ?, 'purchased', ?, ?, ?
       WHERE NOT (? AND ${had}) ON CONFLICT (token_hash) DO NOTHING RETURNING token_hash`,
    ).bind(tokenHash, id, sku, String(v.orderId || "").slice(0, 120), Number.isFinite(v.purchasedAt) ? Math.trunc(v.purchasedAt) : 0, now, op, grant.once ? 1 : 0, id, onceKey(item.id)),
  ];
  const entitle = (key) => d.prepare(`INSERT INTO entitlements (account_id, key, since, source) SELECT ?, ?, ?, ? WHERE ${mine.sql} ON CONFLICT (account_id, key) DO NOTHING`)
    .bind(id, key, now, `iap:${tokenHash}`, ...mine.binds);
  if (grant.coins) stmts.push(...post(d, { id: newOp(), account: id, delta: grant.coins, reason: "iap", ref: tokenHash, day, at: now, meta, guards: [mine] }));
  if (grant.hints) stmts.push(...post(d, { id: newOp(), account: id, currency: "hint", delta: grant.hints, reason: "iap", ref: tokenHash, day, at: now, meta, guards: [mine] }));
  for (const key of grant.entitlements) stmts.push(entitle(key)); // one the account already has keeps its first source
  if (grant.once) stmts.push(entitle(onceKey(item.id)));
  for (const [itemId, qty] of grant.inventory) {
    stmts.push(d.prepare(`INSERT INTO inventory (account_id, item_id, qty, first_at) SELECT ?, ?, ?, ? WHERE ${mine.sql} ON CONFLICT (account_id, item_id, tier) DO UPDATE SET qty = qty + excluded.qty`)
      .bind(id, itemId, qty, now, ...mine.binds));
  }
  const res = await d.batch(stmts);
  if (!wrote(res[0])) { // the same token arrived twice at once and the other call wrote it: for this account it is a duplicate
    const owner = await d.prepare("SELECT account_id FROM purchases WHERE token_hash = ?").bind(tokenHash).first();
    if (!owner && grant.once) return { status: 409, body: { error: "owned" } };
    if (!owner || owner.account_id !== id) return { status: 409, body: { error: "token_used" } };
    return { status: 200, body: { ok: true, duplicate: true, state: await snapshot(ctx) } };
  }
  const finished = await finish(d, verifier, item, purchaseToken, tokenHash);
  return { status: 200, body: { ok: true, granted: shown(grant), finished, state: await snapshot(ctx) } };
}

/**
 * Google refunded or revoked a purchase: take back what it granted, once (the purchase row is voided in the same batch).
 * The coins may already be spent: the balance then goes below zero and spending stays blocked until it recovers.
 * Items it granted (packs) are taken back as far as they are still in the inventory.
 * → "voided" | "unknown" | "already"
 */
export async function voidPurchase(d, purchaseToken, now) {
  const tokenHash = await sha256b64u(String(purchaseToken));
  const p = await d.prepare("SELECT p.account_id, p.sku, p.order_id, p.voided_at, i.data, i.id AS item_id FROM purchases p LEFT JOIN items i ON i.sku = p.sku WHERE p.token_hash = ?").bind(tokenHash).first();
  if (!p) return "unknown";
  if (p.voided_at) return "already";
  const grant = grantOf({ data: p.data || "{}" });
  const op = newOp(), mine = when.gate("purchases", op, "void_op"), day = dayKey(now), ref = p.order_id || tokenHash, meta = { sku: p.sku, item: p.item_id };
  const stmts = [d.prepare("UPDATE purchases SET voided_at = ?, state = 'voided', void_op = ? WHERE token_hash = ? AND voided_at IS NULL RETURNING token_hash").bind(now, op, tokenHash)];
  // an erased account has no wallet row: the lines select nothing and only the purchase is marked
  if (grant.coins) stmts.push(...post(d, { id: newOp(), account: p.account_id, delta: -grant.coins, reason: "refund", ref, day, at: now, meta, guards: [mine] }));
  if (grant.hints) stmts.push(...post(d, { id: newOp(), account: p.account_id, currency: "hint", delta: -grant.hints, reason: "refund", ref, day, at: now, meta, guards: [mine] }));
  const unentitle = (key) => d.prepare(`DELETE FROM entitlements WHERE account_id = ? AND key = ? AND source = ? AND ${mine.sql}`).bind(p.account_id, key, `iap:${tokenHash}`, ...mine.binds);
  for (const key of grant.entitlements) stmts.push(unentitle(key)); // only what THIS purchase gave (source)
  if (grant.once && p.item_id) stmts.push(unentitle(onceKey(p.item_id)));
  for (const [itemId, qty] of grant.inventory) {
    stmts.push(d.prepare(`UPDATE inventory SET qty = MAX(0, qty - ?) WHERE account_id = ? AND item_id = ? AND tier = 0 AND ${mine.sql}`).bind(qty, p.account_id, itemId, ...mine.binds));
  }
  const res = await d.batch(stmts);
  return wrote(res[0]) ? "voided" : "already";
}
