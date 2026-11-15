// GET /api/auth/session  →  { providers: { google, github }, user: { id, provider, displayName, email, avatarUrl, avatar, username } | null, deleted? }
// The page calls this on load: it tells it that a backend exists, which providers are set up, and who (if anyone) is signed in.
// `deleted: true`: this browser's session belonged to an account deleted since (on another device). The cookie is cleared and the
// page erases its copy of the progress (src/auth.js onSession), so signing in again starts from nothing.
// A signed-in visit is what keeps an account alive: it is noted here, once a day (functions/_lib/db.js seen; retention.js deletes
// accounts not seen for 12 months).
import { readSession, getRecord, providerConfigured, unseal, readCookie, cookieName, clearCookie, json } from "../../_lib/auth.js";
import { seen } from "../../_lib/db.js";

export async function onRequestGet({ request, env, waitUntil }) {
  const providers = { google: providerConfigured(env, "google"), github: providerConfigured(env, "github") };
  let user = null, deleted = false;
  try {
    const s = await readSession(request, env);
    if (s) {
      const rec = await getRecord(env, s.id);
      const noted = seen(env, s.id);
      if (typeof waitUntil === "function") waitUntil(noted); else await noted;
      user = { id: s.id, provider: s.provider, displayName: s.name || "", email: s.email || "", avatarUrl: s.avatar || "", avatar: rec.avatar, username: rec.username };
    } else {
      const raw = await unseal(env, readCookie(request, cookieName(request, "sh_session")));
      deleted = !!(raw && raw.id); // valid and unexpired, yet refused: its account was deleted
    }
  } catch { /* SESSION_SECRET missing: nobody can be signed in */ }
  return deleted ? json({ providers, user, deleted }, 200, [clearCookie(request, "sh_session")]) : json({ providers, user });
}
