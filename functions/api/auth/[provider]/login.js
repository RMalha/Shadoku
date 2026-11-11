// GET /api/auth/<google|github>/login?return=/play  →  302 to the provider's consent page.
import { PROVIDERS, providerConfigured, randomToken, seal, sha256b64u, setCookie, redirect, safeReturn, siteOrigin } from "../../../_lib/auth.js";
import { limit } from "../../../_lib/ratelimit.js";

export async function onRequestGet({ request, env, params }) {
  const blocked = await limit(env, request, "login", { max: 30, windowSec: 600 });
  if (blocked) return blocked;
  const name = params.provider;
  if (!providerConfigured(env, name)) return redirect("/?auth_error=not_configured");
  const p = PROVIDERS[name];
  const url = new URL(request.url);

  // state ties the callback to this browser; the PKCE verifier ties the code to this request
  const state = randomToken(), verifier = randomToken(48);
  let cookie;
  try { cookie = await seal(env, { state, verifier, name, ret: safeReturn(url.searchParams.get("return")) }, 600); }
  catch { return redirect("/?auth_error=not_configured"); }

  const to = new URL(p.authorize);
  to.search = new URLSearchParams({
    client_id: env[p.idVar],
    redirect_uri: `${siteOrigin(request, env)}/api/auth/${name}/callback`,
    response_type: "code",
    scope: p.scope,
    state,
    code_challenge: await sha256b64u(verifier),
    code_challenge_method: "S256",
    ...p.extra,
  }).toString();
  return redirect(to.toString(), [setCookie(request, "sh_oauth", cookie, 600)]);
}
