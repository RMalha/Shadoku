// POST /api/auth/logout  →  the session cookie is cleared.
import { clearCookie, json, sameOrigin } from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request, env)) return json({ error: "origin" }, 403);
  return json({ ok: true }, 200, [clearCookie(request, "sh_session")]);
}
