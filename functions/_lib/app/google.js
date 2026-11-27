/**
 * Calling Google as ourselves: the one service account behind the Play Developer API (play.js) and Play Integrity
 * (integrity.js). Architecture 4.21.
 *
 * The secret PLAY_SERVICE_ACCOUNT is the service account's JSON key file, whole, as Google Cloud downloads it (only its
 * `client_email` and `private_key` are read). From it: a JWT signed here with RS256, exchanged at Google's token endpoint for
 * an access token of one scope, good for an hour. The token lives in this isolate's memory only: it is never written to KV,
 * the database or a log, and neither is anything of the key.
 *
 * Without the secret, or with one that is not such a key, `serviceAccount` answers null and every verifier built on it stays
 * "unconfigured" (verifiers.js): fail closed.
 */
import { b64u } from "../auth.js";

/** The app's package on Google Play: permanent (app/CLAUDE.md). */
export const PLAY_PACKAGE = "net.shadoku.app";
export const SCOPE_PUBLISHER = "https://www.googleapis.com/auth/androidpublisher";
export const SCOPE_INTEGRITY = "https://www.googleapis.com/auth/playintegrity";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const TOKEN_EARLY_MS = 5 * 60 * 1000; // a token is dropped five minutes before Google would
/** Tries of one call when Google answers 5xx or 429 or cannot be reached, and the pauses between them. */
const TRIES = 3, PAUSES_MS = [150, 450];
const enc = new TextEncoder();

/** Every request to Google goes through here. (`env.GOOGLE_FETCH`, a function, is the tests' seam: bindings are never request data.) */
export const googleFetch = (env) => (typeof env.GOOGLE_FETCH === "function" ? env.GOOGLE_FETCH : fetch);
const pause = (env, ms) => (typeof env.GOOGLE_PAUSE === "function" ? env.GOOGLE_PAUSE(ms) : new Promise((done) => setTimeout(done, ms)));

let warned = false;
/** → { email, pem, keyId } from the secret, or null when it is missing or is not a service-account key. */
export function serviceAccount(env) {
  const raw = env.PLAY_SERVICE_ACCOUNT;
  if (typeof raw !== "string" || !raw) return null;
  let key = null;
  try { key = JSON.parse(raw); } catch { /* not JSON: below */ }
  const fit = key && typeof key.client_email === "string" && /^[^@\s]{1,100}@[a-z0-9.-]{3,100}$/.test(key.client_email)
    && typeof key.private_key === "string" && key.private_key.includes("-----BEGIN PRIVATE KEY-----");
  if (!fit) {
    if (!warned) console.warn(JSON.stringify({ at: "google", error: "PLAY_SERVICE_ACCOUNT is set but is not a service-account JSON key: billing and Play Integrity stay off" }));
    warned = true;
    return null;
  }
  return { email: key.client_email, pem: key.private_key, keyId: typeof key.private_key_id === "string" ? key.private_key_id.slice(0, 80) : "" };
}

const tokens = new Map(); // "<key id>|<email>|<scope>" → { token, until }: this isolate's memory, nowhere else
const signers = new Map(); // the imported private key, per account

async function signer(account) {
  const id = `${account.keyId}|${account.email}`;
  if (!signers.has(id)) {
    const der = Uint8Array.from(atob(account.pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
    signers.set(id, await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]));
  }
  return signers.get(id);
}

/** → an access token of `scope` for the service account. Throws when Google refuses or cannot be reached. */
async function accessToken(env, account, scope) {
  const id = `${account.keyId}|${account.email}|${scope}`, held = tokens.get(id);
  if (held && held.until > Date.now()) return held.token;
  const iat = Math.floor(Date.now() / 1000); // Google's own clock decides here, never the tests' (env.NOW)
  const head = b64u(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT", ...(account.keyId ? { kid: account.keyId } : {}) })));
  const body = b64u(enc.encode(JSON.stringify({ iss: account.email, scope, aud: TOKEN_URL, iat, exp: iat + 3600 })));
  const signature = b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await signer(account), enc.encode(`${head}.${body}`)));
  const res = await googleFetch(env)(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: TOKEN_GRANT, assertion: `${head}.${body}.${signature}` }).toString(),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok || !out || typeof out.access_token !== "string" || !out.access_token) throw new Error(`google token: ${res.status} ${String((out && out.error) || "").slice(0, 60)}`);
  const life = Number.isFinite(out.expires_in) ? out.expires_in * 1000 : 3600 * 1000;
  tokens.set(id, { token: out.access_token, until: Date.now() + Math.max(0, life - TOKEN_EARLY_MS) });
  return out.access_token;
}

/**
 * One call of a Google API as the service account → { status, body }. `status` 0: Google could not be reached, or gave no
 * token. A 5xx, a 429 or a failed connection is tried again (three tries in all, a short pause between); a 401 once, with a
 * new token. Anything else is the answer. `body`: the JSON that came back, or null.
 */
export async function googleCall(env, account, scope, method, url, body) {
  let last = { status: 0, body: null }, fresh = false;
  for (let attempt = 0; attempt < TRIES; attempt++) {
    if (attempt) await pause(env, PAUSES_MS[attempt - 1]);
    try {
      const token = await accessToken(env, account, scope);
      const res = await googleFetch(env)(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      last = { status: res.status, body: await res.json().catch(() => null) };
      if (res.status === 401 && !fresh) { tokens.delete(`${account.keyId}|${account.email}|${scope}`); fresh = true; continue; } // the token was dropped early on Google's side
      if (res.status < 500 && res.status !== 429) return last;
    } catch (e) {
      last = { status: 0, body: null };
      console.warn(JSON.stringify({ at: "google", error: String((e && e.message) || e).slice(0, 200), host: new URL(url).host }));
    }
  }
  return last;
}

/** → "upstream" when the answer says nothing about what was asked (Google down, our key refused, too many calls), else "". */
export const upstream = (status) => (status === 0 || status >= 500 || status === 401 || status === 403 || status === 429 ? "upstream" : "");
