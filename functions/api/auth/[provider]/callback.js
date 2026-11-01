// GET /api/auth/<google|github>/callback?code=…&state=…  →  session cookie, then back to the page the player came from.
import {
  PROVIDERS, providerConfigured, readCookie, cookieName, unseal, seal, setCookie, clearCookie, redirect, siteOrigin, SESSION_DAYS,
} from "../../../_lib/auth.js";

export async function onRequestGet({ request, env, params }) {
  const name = params.provider;
  const fail = (code) => redirect(`/?auth_error=${code}`, [clearCookie(request, "sh_oauth")]);
  if (!providerConfigured(env, name)) return fail("not_configured");
  const p = PROVIDERS[name];
  const url = new URL(request.url);

  if (url.searchParams.get("error")) return fail("denied"); // the player pressed Cancel on the consent page
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  const saved = await unseal(env, readCookie(request, cookieName(request, "sh_oauth")));
  if (!code || !state || !saved || saved.name !== name || saved.state !== state) return fail("state");

  try {
    const tokenRes = await fetch(p.token, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "shadoku" },
      body: new URLSearchParams({
        client_id: env[p.idVar],
        client_secret: env[p.secretVar],
        code,
        grant_type: "authorization_code",
        redirect_uri: `${siteOrigin(request, env)}/api/auth/${name}/callback`,
        code_verifier: saved.verifier,
      }),
    });
    const token = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !token.access_token) return fail("token");

    const u = await p.profile(token.access_token);
    const session = await seal(env, { id: `${name}:${u.sub}`, provider: name, name: u.name, email: u.email, avatar: u.avatar }, SESSION_DAYS * 86400);
    return redirect(saved.ret || "/", [setCookie(request, "sh_session", session, SESSION_DAYS * 86400), clearCookie(request, "sh_oauth")]);
  } catch {
    return fail("profile");
  }
}
