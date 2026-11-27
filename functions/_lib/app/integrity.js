/**
 * Play Integrity (architecture 4.8 item 5 and 4.21): is this a genuine install of our app on a device that passes?
 *
 * The phone asks Play for a STANDARD integrity token, bound to what it is about to do by a request hash (`integrityHash`
 * below: the phone computes the same), and sends it along. Google decrypts and verifies it for us (decodeIntegrityToken, as
 * our service account: google.js); a token is decoded ONCE, never again (Google blanks the verdicts of a token it has
 * already decoded, which is its replay protection).
 *
 * OBSERVE MODE ONLY: a verdict never refuses anything. The last decoded verdict is kept on the phone's `devices` row
 * (integrity, integrity_at: migration 0003) and anything short of a pass files a `flags` row of kind "integrity". Blocking
 * comes only after real data was looked at, and it is not built.
 *
 * A verdict's `state`:
 *   pass     Play recognises the app, the device meets device integrity, the token is ours, fresh and made for this request
 *   fail     decoded, and one of those is not so (`why` lists which)
 *   invalid  Google could not decode it (not a token, or not our app's)
 *   missing  the phone sent none
 *   error    Google could not be asked (down, or our service account refused): says nothing about the phone, no flag
 *   unconfigured   no service account: the caller fails closed
 */
import { sha256b64u } from "../auth.js";
import { PLAY_PACKAGE, SCOPE_INTEGRITY, serviceAccount, googleCall, upstream } from "./google.js";
import { clock, flag } from "./context.js";

const DECODE_URL = `https://playintegrity.googleapis.com/v1/${PLAY_PACKAGE}:decodeIntegrityToken`;
/** A token older than this was not made for the call it came with (the phone asks for one per action); two minutes of clock difference ahead. */
const FRESH_MS = 10 * 60 * 1000, AHEAD_MS = 2 * 60 * 1000;
const FLAGGED = ["fail", "invalid", "missing"];

/**
 * The request hash a token must carry: what it was asked for, and for which thing. The phone passes the same string to
 * StandardIntegrityTokenProvider.request (base64url of the SHA-256 of "shadoku-integrity|<action>|<ref>", no padding).
 *   ad_claim  ref = the ad ticket's id          device  ref = the account id (POST /api/app/integrity)
 */
export const integrityHash = (action, ref) => sha256b64u(`shadoku-integrity|${action}|${ref}`);

const text = (v, max = 40) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Decodes and reads one token → the verdict (the states above). `requestHash`: await integrityHash(...) of this call.
 * Never throws.
 */
export async function checkIntegrity(env, { token, requestHash }) {
  const account = serviceAccount(env);
  if (!account) return { state: "unconfigured" };
  if (typeof token !== "string" || !token) return { state: "missing" };
  if (token.length > 16384 || !/^[A-Za-z0-9_.=-]+$/.test(token)) return { state: "invalid" };
  const r = await googleCall(env, account, SCOPE_INTEGRITY, "POST", DECODE_URL, { integrity_token: token });
  if (upstream(r.status)) return { state: "error" };
  const p = r.status === 200 && r.body && typeof r.body === "object" ? r.body.tokenPayloadExternal : null;
  if (!p || typeof p !== "object") return { state: "invalid" };
  const request = p.requestDetails || {}, app = p.appIntegrity || {}, device = p.deviceIntegrity || {}, licence = p.accountDetails || {};
  const labels = Array.isArray(device.deviceRecognitionVerdict) ? device.deviceRecognitionVerdict.filter((l) => typeof l === "string").map((l) => l.slice(0, 40)).slice(0, 6) : [];
  const made = Number(request.timestampMillis), now = clock(env), why = [];
  if (request.requestPackageName !== PLAY_PACKAGE || (app.packageName !== undefined && app.packageName !== PLAY_PACKAGE)) why.push("package");
  if (request.requestHash !== requestHash) why.push("request"); // made for something else: a token lifted from another call
  if (!Number.isFinite(made) || now - made > FRESH_MS || made - now > AHEAD_MS) why.push("stale");
  if (app.appRecognitionVerdict !== "PLAY_RECOGNIZED") why.push("app");
  if (!labels.includes("MEETS_DEVICE_INTEGRITY")) why.push("device");
  return {
    state: why.length ? "fail" : "pass", why,
    app: text(app.appRecognitionVerdict), device: labels, licence: text(licence.appLicensingVerdict), version: text(app.versionCode, 12),
  };
}

/**
 * Observe mode: the statements that keep a verdict, for the caller's own batch (or `await ctx.d.batch(...)` when there are any).
 * A decoded verdict goes on the phone's device row; one that is not a pass files a flag. Nothing is refused here or anywhere.
 * `action`: what the token came with ("ad_claim", "device").
 */
export function integrityStatements(ctx, verdict, action) {
  const { d, id, dev, now } = ctx, stmts = [];
  if (!verdict || !verdict.state) return stmts;
  const decoded = verdict.state === "pass" || verdict.state === "fail";
  if (decoded && dev) {
    const kept = JSON.stringify({ state: verdict.state, why: verdict.why, app: verdict.app, device: verdict.device, licence: verdict.licence, version: verdict.version, for: action });
    stmts.push(d.prepare("UPDATE devices SET integrity = ?, integrity_at = ? WHERE id = ? AND account_id = ?").bind(kept.slice(0, 600), now, dev, id));
  }
  if (FLAGGED.includes(verdict.state)) stmts.push(flag(d, id, "integrity", { for: action, state: verdict.state, why: verdict.why || [], app: verdict.app || "", device: verdict.device || [], dev: dev || "" }, now));
  return stmts;
}

/**
 * POST /api/app/integrity { token }: the phone reports in (at launch, after a sign-in), so there is a verdict per device to
 * look at before anything is ever blocked. The answer never says what the verdict was.
 */
export async function reportIntegrity(ctx, { token }) {
  if (typeof token !== "string" || !token || token.length > 16384) return { status: 400, body: { error: "format" } };
  const verdict = await checkIntegrity(ctx.env, { token, requestHash: await integrityHash("device", ctx.id) });
  if (verdict.state === "unconfigured") return { status: 503, body: { error: "integrity_unavailable" } };
  const stmts = integrityStatements(ctx, verdict, "device");
  if (stmts.length) await ctx.d.batch(stmts);
  return { status: 200, body: { ok: true } };
}
