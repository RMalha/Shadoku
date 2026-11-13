/**
 * The two outside authorities the wallet trusts, each behind one small interface: Google Play (did this purchase happen?)
 * and AdMob (was this rewarded ad watched?). The wallet code (billing.js, ads.js) only ever talks to these interfaces.
 *
 * TODAY BOTH ARE STUBS THAT FAIL CLOSED: with nothing configured every check answers { ok: false, error: "unconfigured" },
 * the endpoints answer 503 and no coin moves. The real implementations (architecture 4.4 and 4.5) replace `unconfigured*`
 * below without touching the wallet: the Play Developer API with GOOGLE_SA_EMAIL / GOOGLE_SA_KEY, and AdMob's ECDSA
 * signature check against Google's public keys.
 *
 * A verifier never decides an amount. It answers "real or not" and hands back identifiers; what a purchase or an ad is worth
 * comes from the server's `items` table and economy.js.
 *
 * @typedef {Object} BillingVerifier
 * @property {(p: { sku: string, purchaseToken: string, accountId: string, accountHash: string }) =>
 *   Promise<{ ok: true, orderId: string, purchasedAt: number } | { ok: false, error: "unconfigured" | "invalid" | "pending" | "wrong_account" | "upstream" }>} verifyPurchase
 *     Asks Google about the token. ok only when the purchase exists for OUR package and THIS sku, its state is "purchased", and its
 *     obfuscatedAccountId is `accountHash` (so a token bought by one account cannot be redeemed by another).
 * @property {(p: { sku: string, purchaseToken: string, consumable: boolean }) => Promise<{ ok: boolean }>} finishPurchase
 *     Consumes (coin packs, bundles) or acknowledges (Remove ads) the purchase, after the grant is written. Google refunds a purchase
 *     left unacknowledged for three days, so billing.js retries this on every resend until it succeeds.
 * @property {(request: Request) => Promise<{ ok: true, voided: Array<{ purchaseToken: string }> } | { ok: false, error: "unconfigured" | "invalid" }>} readNotification
 *     Authenticates a Real-time Developer Notification (Pub/Sub push) and lists the purchases Google refunded or revoked.
 *
 * @typedef {Object} AdsVerifier
 * @property {(url: URL) => Promise<{ ok: true, transactionId: string, ticketId: string, userId: string, adUnit: string } | { ok: false, error: "unconfigured" | "invalid" }>} verifyCallback
 *     Checks the signature of AdMob's server-side verification callback over the query string exactly as received, and returns
 *     transaction_id, custom_data (our ticket id), user_id (our account id) and ad_unit. AdMob's reward_amount is ignored.
 * @property {(p: { accountId: string, ticketId: string, integrity: unknown }) =>
 *   Promise<{ ok: true, transactionId: string, verified: "client" | "dev" } | { ok: false, error: "unconfigured" | "invalid" }>} verifyClientClaim
 *     The fallback when the callback is late or lost: the phone says the ad finished and proves it is a genuine install with a
 *     Play Integrity token. ads.js allows only a few of these a day.
 */

const UNCONFIGURED = Object.freeze({ ok: false, error: "unconfigured" });

/** @type {BillingVerifier} */
const unconfiguredBilling = {
  verifyPurchase: async () => UNCONFIGURED,
  finishPurchase: async () => ({ ok: false }),
  readNotification: async () => UNCONFIGURED,
};

/** @type {AdsVerifier} */
const unconfiguredAds = {
  verifyCallback: async () => UNCONFIGURED,
  verifyClientClaim: async () => UNCONFIGURED,
};

/**
 * Test builds (architecture 4.5: Google only calls back for production ads; Play has no purchases outside its own testers).
 * DEV_BILLING=1: a purchase token "dev.<sku>.<anything>" is a paid purchase of that sku; POST /api/app/billing/rtdn takes
 * { "voided": [{ "purchaseToken": "…" }] }. DEV_ADS=1: POST /api/app/ads/claim pays the ticket without an ad.
 * Both work only on localhost or a Pages PREVIEW address (<name>.<project>.pages.dev), never on the site's own domain,
 * so setting one of them in production by mistake gives nothing away.
 */
export const devHost = (request) => /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev)$/.test(new URL(request.url).hostname);

/** @type {BillingVerifier} */
const devBilling = {
  async verifyPurchase({ sku, purchaseToken }) {
    const m = /^dev\.([A-Za-z0-9_]+)\.[A-Za-z0-9_-]{1,80}$/.exec(purchaseToken);
    return m && m[1] === sku ? { ok: true, orderId: `DEV.${purchaseToken.slice(-80)}`, purchasedAt: Date.now() } : { ok: false, error: "invalid" };
  },
  finishPurchase: async () => ({ ok: true }),
  async readNotification(request) {
    const body = await request.json().catch(() => null);
    const voided = body && Array.isArray(body.voided) ? body.voided.filter((v) => v && typeof v.purchaseToken === "string") : null;
    return voided ? { ok: true, voided } : { ok: false, error: "invalid" };
  },
};

/** @type {AdsVerifier} */
const devAds = {
  verifyCallback: async () => UNCONFIGURED, // nobody calls back in a test build
  verifyClientClaim: async ({ ticketId }) => ({ ok: true, transactionId: `dev:${ticketId}`, verified: "dev" }),
};

const isObject = (v, method) => !!v && typeof v[method] === "function";

/** → the BillingVerifier for this request. (`env.BILLING_VERIFIER`, an object, is the tests' seam: bindings are never request data.) */
export function billingVerifier(env, request) {
  if (isObject(env.BILLING_VERIFIER, "verifyPurchase")) return env.BILLING_VERIFIER;
  if (env.DEV_BILLING === "1" && devHost(request)) return devBilling;
  return unconfiguredBilling;
}

/** → the AdsVerifier for this request. (`env.ADS_VERIFIER` is the tests' seam.) */
export function adsVerifier(env, request) {
  if (isObject(env.ADS_VERIFIER, "verifyCallback")) return env.ADS_VERIFIER;
  if (env.DEV_ADS === "1" && devHost(request)) return devAds;
  return unconfiguredAds;
}
