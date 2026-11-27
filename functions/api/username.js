// GET /api/username?name=Foo_42  →  { available, reason? }   (signed-in players only; reason: "format" | "blocked" | "reserved")
// PUT /api/username  { name }    →  { ok } | 400 { error: "format" | "blocked" | "reserved" } | 409 taken (the codename is saved for the account)
// "blocked": the name holds a swear, sexual, hateful or self-harm word; "reserved": it passes for staff, the product or a Story speaker (_lib/codename/).
// Signed in: the site's session cookie, or the Android app's bearer token from the app's origin (functions/_lib/caller.js; not a guest).
import { codenameFree, setCodename, json, USERNAME_RE } from "../_lib/auth.js";
import { caller } from "../_lib/caller.js";
import { renamePlayer } from "../_lib/db.js";
import { limit } from "../_lib/ratelimit.js";
import { codenameIssue } from "../_lib/codename/index.js";

export async function onRequestGet({ request, env }) {
  const who = await caller(request, env);
  if (who.error) return who.error;
  const { s } = who;
  const name = new URL(request.url).searchParams.get("name") || "";
  if (!USERNAME_RE.test(name)) return json({ available: false, reason: "format" });
  const issue = codenameIssue(name);
  if (issue) return json({ available: false, reason: issue });
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
  const issue = codenameIssue(name);
  if (issue) return json({ error: issue }, 400);
  if (!(await codenameFree(env, name, s.id))) return json({ error: "taken" }, 409);
  if ((await setCodename(env, s.id, name)) === false) return json({ error: codenameIssue(name) || "blocked" }, 400); // the filter's last line of defence (never reached after the check above)
  await renamePlayer(env, s.id, name); // the ranking and the author of their community puzzles
  return json({ ok: true });
}
