/**
 * The real BillingVerifier (verifiers.js): Google Play, asked through the Play Developer API as our service account
 * (google.js, secret PLAY_SERVICE_ACCOUNT). Architecture 4.4 and 4.21.
 *
 *   verifyPurchase    purchases.products.get (purchases.subscriptionsv2.get for a sku named in PLAY_SUBSCRIPTIONS) and the
 *                     checks of 4.4 step 3: our package and this product (both are in the address asked, so Google itself refuses
 *                     a token of another app or product, and the answer's own productId and token are compared again), the
 *                     purchase state, and obfuscatedExternalAccountId = this account's hash.
 *   finishPurchase    purchases.products.consume, or .acknowledge for what is never consumed. A call Google refuses is followed
 *                     by a look at the purchase: an earlier try that did arrive counts as done.
 *   readNotification  a Real-time Developer Notification: Pub/Sub's push, authenticated by the Google-signed token it carries
 *                     (made for THIS address, for the service account named in PLAY_RTDN_EMAIL).
 *   listVoided        purchases.voidedpurchases.list: what the nightly check reads (billing.js sweepVoided).
 *
 * Nothing here decides an amount or writes a row: it answers "real or not" and hands back identifiers.
 */
import { PLAY_PACKAGE, SCOPE_PUBLISHER, serviceAccount, googleCall, upstream } from "./google.js";
import { googleSignedClaims, googleClaimsCurrent } from "./identity.js";

const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PACKAGE}/purchases`;
const no = (error) => ({ ok: false, error });
const part = (v) => encodeURIComponent(v);
const productUrl = (sku, token) => `${API}/products/${part(sku)}/tokens/${part(token)}`;
const subscriptionUrl = (token) => `${API}/subscriptionsv2/tokens/${part(token)}`;

// ProductPurchase (one-time products)
const PURCHASED = 0, PENDING = 2, CONSUMED = 1, ACKNOWLEDGED = 1;
// SubscriptionPurchaseV2
const SUB_OWNED = ["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"], SUB_PENDING = "SUBSCRIPTION_STATE_PENDING", SUB_ACKNOWLEDGED = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
// a Real-time Developer Notification
const SUBSCRIPTION_REVOKED = 12, PARTIAL_REFUND = 2;

/** The skus sold as subscriptions (PLAY_SUBSCRIPTIONS: "member,member_gold"). None by default: every product is a one-time one. */
const subscriptions = (env) => new Set(String(env.PLAY_SUBSCRIPTIONS || "").split(",").map((s) => s.trim()).filter(Boolean));

/** → the BillingVerifier that asks Google Play, or null without the service account (the caller then fails closed). */
export function playBilling(env) {
  const account = serviceAccount(env);
  if (!account) return null;
  const subs = subscriptions(env);
  const call = (method, url, body) => googleCall(env, account, SCOPE_PUBLISHER, method, url, body);
  // a look at a purchase → the purchase, or why there is none to speak of
  const look = async (url) => {
    const r = await call("GET", url);
    if (upstream(r.status)) return no("upstream");
    return r.status === 200 && r.body && typeof r.body === "object" ? { ok: true, purchase: r.body } : no("invalid"); // 400, 404, 410: no such purchase of this product in this app
  };

  async function verifyProduct({ sku, purchaseToken, accountHash }) {
    const got = await look(productUrl(sku, purchaseToken));
    if (!got.ok) return got;
    const p = got.purchase;
    if ((p.productId !== undefined && p.productId !== sku) || (p.purchaseToken !== undefined && p.purchaseToken !== purchaseToken)) return no("invalid");
    if (p.purchaseState === PENDING) return no("pending"); // a slow payment (cash, a bank transfer): nothing is granted until it is paid
    if (p.purchaseState !== PURCHASED) return no("invalid");
    if (p.quantity !== undefined && p.quantity !== 1) return no("invalid"); // no product of ours is sold by the dozen: one token, one grant
    if (p.consumptionState === CONSUMED) return no("invalid"); // used up, and this server holds no row for it: it was never ours to grant
    if (typeof p.obfuscatedExternalAccountId !== "string" || p.obfuscatedExternalAccountId !== accountHash) return no("wrong_account");
    return { ok: true, orderId: typeof p.orderId === "string" ? p.orderId : "", purchasedAt: Number(p.purchaseTimeMillis) || 0 };
  }

  async function verifySubscription({ sku, purchaseToken, accountHash }) {
    const got = await look(subscriptionUrl(purchaseToken));
    if (!got.ok) return got;
    const p = got.purchase, lines = Array.isArray(p.lineItems) ? p.lineItems : [];
    const line = lines.find((l) => l && l.productId === sku);
    if (!line) return no("invalid");
    if (p.subscriptionState === SUB_PENDING) return no("pending");
    if (!SUB_OWNED.includes(p.subscriptionState)) return no("invalid"); // on hold, paused, cancelled, expired: not owned now
    const ids = p.externalAccountIdentifiers;
    if (!ids || typeof ids.obfuscatedExternalAccountId !== "string" || ids.obfuscatedExternalAccountId !== accountHash) return no("wrong_account");
    return { ok: true, orderId: typeof line.latestSuccessfulOrderId === "string" ? line.latestSuccessfulOrderId : "", purchasedAt: Date.parse(p.startTime) || 0 };
  }

  return {
    verifyPurchase: (p) => (subs.has(p.sku) ? verifySubscription(p) : verifyProduct(p)),

    async finishPurchase({ sku, purchaseToken, consumable }) {
      const done = (r) => r.status >= 200 && r.status < 300;
      if (subs.has(sku)) {
        if (done(await call("POST", `${API}/subscriptions/${part(sku)}/tokens/${part(purchaseToken)}:acknowledge`, {}))) return { ok: true };
        const now = await look(subscriptionUrl(purchaseToken));
        return { ok: now.ok && now.purchase.acknowledgementState === SUB_ACKNOWLEDGED };
      }
      if (done(await call("POST", `${productUrl(sku, purchaseToken)}:${consumable ? "consume" : "acknowledge"}`, consumable ? undefined : {}))) return { ok: true };
      const now = await look(productUrl(sku, purchaseToken)); // refused: did an earlier try arrive after all?
      return { ok: now.ok && (consumable ? now.purchase.consumptionState === CONSUMED : now.purchase.acknowledgementState === ACKNOWLEDGED) };
    },

    async readNotification(request) {
      const sender = typeof env.PLAY_RTDN_EMAIL === "string" ? env.PLAY_RTDN_EMAIL.trim() : "";
      if (!sender) return no("unconfigured");
      const m = /^Bearer ([A-Za-z0-9_.-]{20,4096})$/.exec(request.headers.get("Authorization") || "");
      const signed = m ? await googleSignedClaims(env, m[1]) : no("invalid");
      if (!signed.ok) return no("invalid");
      // Anybody with a Google Cloud project can make Pub/Sub push a Google-signed token: it is ours only when it was made for
      // this address and for the service account our own subscription pushes as.
      const { claims } = signed, url = new URL(request.url);
      if (!googleClaimsCurrent(env, claims) || ![url.href, url.origin + url.pathname].includes(claims.aud)) return no("invalid");
      if (claims.email !== sender || claims.email_verified !== true) return no("invalid");
      let note = null;
      try {
        const envelope = await request.json();
        note = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(envelope.message.data), (c) => c.charCodeAt(0))));
      } catch { return no("invalid"); }
      const voided = [];
      if (note && note.packageName === PLAY_PACKAGE) { // (a note about another package, a test note, a purchase or a renewal: read, nothing to take back)
        const refund = note.voidedPurchaseNotification, sub = note.subscriptionNotification;
        if (refund && typeof refund.purchaseToken === "string" && refund.refundType !== PARTIAL_REFUND) voided.push({ purchaseToken: refund.purchaseToken });
        if (sub && typeof sub.purchaseToken === "string" && sub.notificationType === SUBSCRIPTION_REVOKED) voided.push({ purchaseToken: sub.purchaseToken });
      }
      return { ok: true, voided };
    },

    /** One page of the purchases Google voided in the last 30 days (refunded AND revoked, chargebacks, both kinds of product). */
    async listVoided({ pageToken = "" } = {}) {
      const r = await call("GET", `${API}/voidedpurchases?type=1&maxResults=1000${pageToken ? `&token=${part(pageToken)}` : ""}`);
      if (r.status !== 200 || !r.body || typeof r.body !== "object") return no(upstream(r.status) || "invalid");
      const list = Array.isArray(r.body.voidedPurchases) ? r.body.voidedPurchases : [];
      const next = r.body.tokenPagination && typeof r.body.tokenPagination.nextPageToken === "string" ? r.body.tokenPagination.nextPageToken : "";
      return { ok: true, voided: list.filter((v) => v && typeof v.purchaseToken === "string" && v.voidedQuantity === undefined).map((v) => ({ purchaseToken: v.purchaseToken })), next };
    },
  };
}
