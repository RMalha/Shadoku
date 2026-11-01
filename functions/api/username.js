// GET /api/username?name=Foo_42  →  { available }      (signed-in players only)
// PUT /api/username  { name }    →  { ok } | 409 taken (the codename is saved for the account)
import { readSession, codenameFree, setCodename, json, sameOrigin, USERNAME_RE } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  const s = await readSession(request, env);
  if (!s) return json({ error: "auth" }, 401);
  const name = new URL(request.url).searchParams.get("name") || "";
  if (!USERNAME_RE.test(name)) return json({ available: false, reason: "format" });
  return json({ available: await codenameFree(env, name, s.id) });
}

export async function onRequestPut({ request, env }) {
  if (!sameOrigin(request, env)) return json({ error: "origin" }, 403);
  const s = await readSession(request, env);
  if (!s) return json({ error: "auth" }, 401);
  const { name } = await request.json().catch(() => ({}));
  if (!USERNAME_RE.test(name || "")) return json({ error: "format" }, 400);
  if (!(await codenameFree(env, name, s.id))) return json({ error: "taken" }, 409);
  await setCodename(env, s.id, name);
  return json({ ok: true });
}
