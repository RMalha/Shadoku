/**
 * The real AdsVerifier (verifiers.js): AdMob's rewarded server-side verification. Architecture 4.5 and 4.21.
 *
 *   verifyCallback     GET /api/app/ads/ssv. Google signs every callback: ECDSA (P-256, SHA-256, DER) over the query string
 *                      exactly as it was received, up to "&signature=" (signature and key_id are always its last two
 *                      parameters). The key is one of Google's public keys, read from their JSON address and kept at most 24
 *                      hours (KV, and this isolate's memory). A signature only proves GOOGLE sent it, for SOME publisher's ad:
 *                      anybody may point an ad unit of their own at this address, so the callback must also name one of OUR
 *                      rewarded ad units (ADMOB_AD_UNITS). That list is what switches this verifier on.
 *   verifyClientClaim  POST /api/app/ads/claim, when the callback is late or lost: a Play Integrity token made for this
 *                      ticket (integrity.js). Observe mode: the verdict is handed back to be kept and flagged, and the claim
 *                      stands whatever it says; ads.js keeps the 10-second wait and the few-a-day limit.
 *
 * AdMob's reward_amount and reward_item are never read: what an ad is worth is the server's own (ads.js).
 */
import { googleFetch, serviceAccount } from "./google.js";
import { checkIntegrity, integrityHash } from "./integrity.js";
import { AD_CLAIM_WAIT_MS } from "./economy.js";
import { clock } from "./context.js";

export const SSV_KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";
export const SSV_KEYS_KV = "admob:ssv-keys";
/** Google: "should not be cached for longer than 24 hours". */
const KEYS_TTL_SEC = 24 * 3600;
/** A callback that names a key we do not hold (Google rotated them, or somebody made the number up): look again, at most this often. */
const KEYS_RETRY_MS = 5 * 60 * 1000;
const no = (error) => ({ ok: false, error });
const enc = new TextEncoder();

/** Our rewarded ad units, as a callback names them: the digits after the "/" of "ca-app-pub-…/1234567890" (the whole id is accepted too). */
export const adUnits = (env) => new Set(String(env.ADMOB_AD_UNITS || "").split(",").map((s) => s.trim().split("/").pop()).filter((s) => /^\d{4,20}$/.test(s)));

const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/**
 * An ECDSA signature as Google sends it (ASN.1 DER: SEQUENCE { INTEGER r, INTEGER s }) → the 64 bytes r || s that WebCrypto
 * verifies, or null when it is not exactly that.
 */
export function derToRaw(der, size = 32) {
  let at = 0;
  const length = () => { // a DER length: short form, or 0x81 and one byte
    let n = der[at++];
    if (n === 0x81) n = der[at++];
    else if (n === undefined || n > 0x7f) return -1;
    return n === undefined ? -1 : n;
  };
  const integer = () => {
    if (der[at++] !== 0x02) return null;
    const n = length();
    if (n < 1 || at + n > der.length) return null;
    let v = der.subarray(at, at + n);
    at += n;
    while (v.length > 1 && v[0] === 0) v = v.subarray(1); // the sign byte of a number whose first bit is set
    return v.length > size ? null : v;
  };
  if (!(der instanceof Uint8Array) || der[at++] !== 0x30) return null;
  if (length() !== der.length - at) return null;
  const r = integer(), s = r && integer();
  if (!r || !s || at !== der.length) return null;
  const raw = new Uint8Array(size * 2);
  raw.set(r, size - r.length);
  raw.set(s, size * 2 - s.length);
  return raw;
}

let held = { at: 0, keys: [] }; // Google's keys in this isolate: [{ keyId: "3335741209", base64: "<SPKI>" }]

const keep = (body, at) => ({ at, keys: (body && Array.isArray(body.keys) ? body.keys : []).filter((k) => k && typeof k.base64 === "string" && k.base64.length < 2000 && k.keyId !== undefined).map((k) => ({ keyId: String(k.keyId), base64: k.base64 })) });

/** → the public key (SPKI, base64) Google names `keyId`, "" when Google has no such key. Throws when the keys cannot be had at all. */
async function ssvKey(env, keyId) {
  const now = clock(env), fresh = (set) => set.keys.length > 0 && now - set.at < KEYS_TTL_SEC * 1000;
  const find = (set) => (set.keys.find((k) => k.keyId === keyId) || { base64: "" }).base64;
  if (fresh(held) && find(held)) return find(held);
  const kv = env.SHADOKU_KV && typeof env.SHADOKU_KV.get === "function" ? env.SHADOKU_KV : null;
  if (kv) {
    const stored = await kv.get(SSV_KEYS_KV, "json").catch(() => null);
    if (stored && Number.isFinite(stored.at) && Array.isArray(stored.keys) && stored.at > held.at) held = keep(stored, stored.at);
    if (fresh(held) && find(held)) return find(held);
  }
  if (fresh(held) && now - held.at < KEYS_RETRY_MS) return ""; // looked a moment ago: Google has no such key
  let body = null;
  try {
    const res = await googleFetch(env)(SSV_KEYS_URL, { headers: { Accept: "application/json" } });
    if (res.ok) body = await res.json();
  } catch { /* below */ }
  const got = keep(body, now);
  if (!got.keys.length) {
    if (fresh(held)) return ""; // the keys we hold are still good for a day: this callback names none of them
    throw new Error("admob keys: Google's key list could not be read");
  }
  held = got;
  if (kv) await kv.put(SSV_KEYS_KV, JSON.stringify(held), { expirationTtl: KEYS_TTL_SEC }).catch(() => {});
  return find(held);
}

/** → the AdsVerifier that checks AdMob's signature, or null when no ad unit of ours is named (the caller then fails closed). */
export function admobAds(env) {
  const units = adUnits(env);
  if (!units.size) return null;
  return {
    /** Before this long after its ticket was made, a fallback claim is too early to be a late callback (ads.js claimTicket). */
    claimWaitMs: AD_CLAIM_WAIT_MS,

    async verifyCallback(url) {
      // as received: a URL keeps the query's own bytes (every escape as Google wrote it); nothing here is decoded before the check
      const query = url.search.startsWith("?") ? url.search.slice(1) : "";
      const cut = query.lastIndexOf("&signature=");
      if (cut < 1) return no("invalid");
      const m = /^([A-Za-z0-9_-]{60,200})={0,2}&key_id=(\d{1,20})$/.exec(query.slice(cut + "&signature=".length));
      if (!m) return no("invalid");
      let signature = null;
      try { signature = derToRaw(unb64(m[1])); } catch { /* not base64 */ }
      if (!signature) return no("invalid");
      let spki = "";
      try { spki = await ssvKey(env, m[2]); } catch { return no("upstream"); }
      if (!spki) return no("invalid");
      try {
        const key = await crypto.subtle.importKey("spki", unb64(spki), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
        if (!(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, enc.encode(query.slice(0, cut))))) return no("invalid");
      } catch { return no("invalid"); }
      // Google signed this. Whose ad was it?
      const p = new URLSearchParams(query.slice(0, cut));
      const adUnit = p.get("ad_unit") || "", transactionId = p.get("transaction_id") || "";
      if (!units.has(adUnit)) return no("invalid"); // another publisher's ad unit, pointed at us
      if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(transactionId)) return no("invalid");
      return { ok: true, transactionId, ticketId: p.get("custom_data") || "", userId: p.get("user_id") || "", adUnit };
    },

    async verifyClientClaim({ ticketId, integrity }) {
      if (!serviceAccount(env)) return no("unconfigured"); // nobody to ask about the token: no fallback
      const verdict = await checkIntegrity(env, { token: integrity, requestHash: await integrityHash("ad_claim", ticketId) });
      if (verdict.state === "unconfigured") return no("unconfigured");
      // observe mode (architecture 4.8 item 5): the verdict is kept and flagged by the caller, and refuses nothing yet
      return { ok: true, transactionId: `client:${ticketId}`, verified: "client", integrity: verdict };
    },
  };
}
