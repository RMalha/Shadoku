/**
 * Who is calling an endpoint that the website and the Android app share: /api/progress, /api/community/*, /api/username,
 * /api/avatar, /api/report and DELETE /api/account (architecture 4.3, the "Shared" line, and 4.11).
 *
 * The request's ORIGIN decides which proof counts, and only that one is read:
 *
 *   the app's origin (https://app.shadoku.net, app/cors.js)
 *       the app's bearer token and nothing else: sealed by this server, aud "app", its device still standing and still that
 *       account's, the account neither deleted, closed by a sign-in nor banned (app/context.js appSession). A cookie is never
 *       read (functions/api/_middleware.js has already dropped it). No same-origin check: without a cookie there is nothing
 *       for another site to forge.
 *   anything else (the site itself, no Origin at all, another site)
 *       the site's session cookie, by the rules these endpoints always had: a write must come from the site's own origin, then
 *       the cookie must be a live site session. An Authorization header is not looked at, so a bearer token is worth nothing
 *       there, with or without a cookie beside it.
 *
 * So a token cannot be used from a page of the site, a cookie cannot be used from the app's origin, and a call can never
 * choose between the two.
 *
 * GUESTS. A guest account (the app's silent first sign-in) has no part in what these endpoints keep: saved progress, a
 * codename, an avatar, community puzzles and ratings all belong to a signed-in player (architecture 5, "What a guest cannot
 * do"). A guest's token is answered 403 signin_required, except where the endpoint says otherwise (`guest`: deleting the account).
 */
import { json, readSession, sameOrigin } from "./auth.js";
import { appOrigin } from "./app/cors.js";
import { appSession } from "./app/context.js";

const fail = (error, status) => ({ error: json({ error }, status) });

/**
 * → { s, app } or { error: Response }. `s`: the session ({ id, provider, name, avatar, … }: the cookie's payload or the
 * token's); `app`: true when it is the app's token.
 * `write`: the call changes something (a cookie caller must then be same-origin, checked before the cookie is read).
 * `guest`: a guest account may call too. `banned`: a banned account may call too. (Both: only DELETE /api/account.)
 */
export async function caller(request, env, { write = false, guest = false, banned = false } = {}) {
  if (appOrigin(request, env)) {
    const who = await appSession(request, env, { banned });
    if (who.error) return who;
    if (who.account.kind !== "full" && !guest) return fail("signin_required", 403);
    return { s: who.s, app: true };
  }
  if (write && !sameOrigin(request, env)) return fail("origin", 403);
  const s = await readSession(request, env);
  return s ? { s, app: false } : fail("auth", 401);
}

/**
 * For the endpoints anyone may call, which only answer more to a signed-in player (the community list marks "mine", a play is
 * counted per account): → the session, or null. A guest of the app is nobody here, like a visitor who is not signed in.
 */
export async function visitor(request, env) {
  try {
    const who = await caller(request, env);
    return who.error ? null : who.s;
  } catch { return null; }
}

/** → true when a state-changing call that needs no session comes from the site itself or from the app. */
export const fromHere = (request, env) => !!appOrigin(request, env) || sameOrigin(request, env);
