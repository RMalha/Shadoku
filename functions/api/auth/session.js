// GET /api/auth/session  →  { providers: { google, github }, user: { id, provider, displayName, email, avatarUrl, username } | null }
// The page calls this on load: it tells it that a backend exists, which providers are set up, and who (if anyone) is signed in.
import { readSession, getCodename, providerConfigured, json } from "../../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  const providers = { google: providerConfigured(env, "google"), github: providerConfigured(env, "github") };
  let user = null;
  try {
    const s = await readSession(request, env);
    if (s) user = { id: s.id, provider: s.provider, displayName: s.name || "", email: s.email || "", avatarUrl: s.avatar || "", username: await getCodename(env, s.id) };
  } catch { /* SESSION_SECRET missing: nobody can be signed in */ }
  return json({ providers, user });
}
