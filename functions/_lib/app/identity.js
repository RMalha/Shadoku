/**
 * Who is signing in to the app (architecture 5): a proof the phone got from a sign-in provider → that provider's id for the
 * person. Like verifiers.js: one small interface, and everything that is not set up FAILS CLOSED ("unconfigured": the endpoint
 * answers 503 and nobody is signed in). The account that id belongs to is decided in accounts.js, never here.
 *
 *   google   an ID token from Android's Credential Manager ("Sign in with Google"), asked for with the SAME web client id the
 *            site uses (GOOGLE_CLIENT_ID): the token's `sub` is the one the website knows, so the player lands in the account
 *            they already have there. Checked here against Google's public keys: signature (RS256), issuer, audience, expiry.
 *   dev      a test player by codename, as /api/auth/dev/login makes them (the account "dev:<name>"): only with DEV_LOGIN=1 and
 *            only on localhost, so never on a deployed site.
 *   pgs, github   not built yet (the Play Games plugin and the Custom Tab flow come with the Android sign-in phase): unconfigured.
 *
 * @typedef {{ ok: true, provider: string, sub: string, name: string, avatar: string } | { ok: false, error: "unconfigured" | "invalid" | "upstream" }} Identity
 */
import { USERNAME_RE } from "../auth.js";
import { clock } from "./context.js";

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const CLOCK_SKEW_SEC = 120;
const KEYS_FRESH_MS = 3600 * 1000, KEYS_RETRY_MS = 60 * 1000;
/** A provider's id for a person, as it may stand in an account id ("<provider>:<sub>"). */
export const SUB_RE = /^[A-Za-z0-9_.-]{1,128}$/;

const no = (error) => ({ ok: false, error });
const bytes = (b64u) => Uint8Array.from(atob(b64u.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const part = (b64u) => JSON.parse(new TextDecoder().decode(bytes(b64u)));
const clean = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

let cached = { at: 0, keys: [] }; // Google's signing keys, per isolate

/** → Google's current public keys (JWK). `again`: the token names a key we do not have: look once more, at most once a minute. */
async function googleKeys(env, again) {
  if (typeof env.GOOGLE_CERTS === "function") return (await env.GOOGLE_CERTS()).keys || []; // the tests' seam: a binding, never request data
  const age = Date.now() - cached.at;
  if (cached.keys.length && age < (again ? KEYS_RETRY_MS : KEYS_FRESH_MS)) return cached.keys;
  const res = await fetch(GOOGLE_CERTS_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`google certs answered ${res.status}`);
  const body = await res.json();
  cached = { at: Date.now(), keys: Array.isArray(body.keys) ? body.keys : [] };
  return cached.keys;
}

/** A Google ID token → who it names. @returns {Promise<Identity>} */
export async function verifyGoogleIdToken(env, idToken) {
  if (!env.GOOGLE_CLIENT_ID) return no("unconfigured");
  if (typeof idToken !== "string" || idToken.length > 4096) return no("invalid");
  const [h, p, s, extra] = idToken.split(".");
  if (!h || !p || !s || extra !== undefined) return no("invalid");
  let header, claims, signature;
  try { header = part(h); claims = part(p); signature = bytes(s); } catch { return no("invalid"); }
  if (!header || header.alg !== "RS256" || typeof header.kid !== "string" || !claims || typeof claims !== "object") return no("invalid");
  let jwk;
  try {
    const find = (keys) => keys.find((k) => k && k.kid === header.kid && k.kty === "RSA");
    jwk = find(await googleKeys(env, false)) || find(await googleKeys(env, true));
  } catch { return no("upstream"); }
  if (!jwk) return no("invalid");
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(`${h}.${p}`)))) return no("invalid");
  } catch { return no("invalid"); }
  const now = clock(env) / 1000;
  if (!GOOGLE_ISSUERS.includes(claims.iss) || claims.aud !== env.GOOGLE_CLIENT_ID) return no("invalid"); // made for another app: not ours to accept
  if (!Number.isFinite(claims.exp) || claims.exp < now - CLOCK_SKEW_SEC || (Number.isFinite(claims.iat) && claims.iat > now + CLOCK_SKEW_SEC)) return no("invalid");
  if (typeof claims.sub !== "string" || !/^[0-9]{1,64}$/.test(claims.sub)) return no("invalid");
  return { ok: true, provider: "google", sub: claims.sub, name: clean(claims.name, 80), avatar: clean(claims.picture, 300) };
}

const localhost = (request) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(request.url).hostname);

/** A test player, by codename: the same account /api/auth/dev/login signs a browser in to. @returns {Identity} */
function verifyDev(env, request, name) {
  if (env.DEV_LOGIN !== "1" || !localhost(request)) return no("unconfigured");
  return typeof name === "string" && USERNAME_RE.test(name) ? { ok: true, provider: "dev", sub: name.toLowerCase(), name, avatar: "" } : no("invalid");
}

/**
 * → who `body` proves the caller to be, for `provider`: body.idToken (google), body.name (dev).
 * (`env.IDENTITY_VERIFIER`, an object, is the tests' seam for providers that are not built: bindings are never request data.)
 * @returns {Promise<Identity>}
 */
export async function verifyIdentity(env, request, provider, body) {
  let who;
  if (env.IDENTITY_VERIFIER && typeof env.IDENTITY_VERIFIER.verify === "function") who = await env.IDENTITY_VERIFIER.verify(provider, body);
  else if (provider === "google") who = await verifyGoogleIdToken(env, body.idToken);
  else if (provider === "dev") who = verifyDev(env, request, body.name);
  else who = no("unconfigured");
  if (!who || !who.ok) return no(who && ["unconfigured", "upstream"].includes(who.error) ? who.error : "invalid");
  // whatever verified it, the id must be fit to stand in an account id, and "guest" is never a provider
  if (who.provider !== provider || provider === "guest" || !/^[a-z]{2,12}$/.test(provider) || typeof who.sub !== "string" || !SUB_RE.test(who.sub)) return no("invalid");
  return { ok: true, provider, sub: who.sub, name: clean(who.name, 80), avatar: clean(who.avatar, 300) };
}

/** The HTTP status of a failed check. */
export const IDENTITY_FAIL = Object.freeze({ unconfigured: 503, upstream: 502, invalid: 401 });
