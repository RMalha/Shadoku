// GET /api/username?name=Foo_42  →  { available }      (signed-in players only)
// PUT /api/username  { name }    →  { ok } | 409 taken (the codename is saved for the account)
// Signed in: the site's session cookie, or the Android app's bearer token from the app's origin (functions/_lib/caller.js; not a guest).
import { codenameFree, setCodename, json, USERNAME_RE } from "../_lib/auth.js";
import { caller } from "../_lib/caller.js";
import { renamePlayer } from "../_lib/db.js";
import { limit } from "../_lib/ratelimit.js";

export async function onRequestGet({ request, env }) {
  const who = await caller(request, env);
  if (who.error) return who.error;
  const { s } = who;
  const name = new URL(request.url).searchParams.get("name") || "";
  if (!USERNAME_RE.test(name)) return json({ available: false, reason: "format" });
  return json({ available: await codenameFree(env, name, s.id) });
}

export async function onRequestPut({ request, env }) {
  const who = await caller(request, env, { write: true });
  if (who.error) return who.error;
  const { s } = who;
  const blocked = await limit(env, request, "username", { max: 10, windowSec: 600, id: s.id });
  if (blocked) return blocked;
  const { name } = (await request.json().catch(() => null)) || {};
  if (!USERNAME_RE.test(name || "")) return json({ error: "format" }, 400);
  if (!(await codenameFree(env, name, s.id))) return json({ error: "taken" }, 409);
  await setCodename(env, s.id, name);
  await renamePlayer(env, s.id, name); // the ranking and the author of their community puzzles
  return json({ ok: true });
}
