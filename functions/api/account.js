// DELETE /api/account  →  the account's server-side record (its codename and game progress) is erased and the session ends.
// The legal page promises this: "you can delete it any time … removes your account and the game data saved for it".
// That includes its ranking row, its ratings and the community puzzles it published (functions/_lib/db.js erasePlayer).
// Its sessions on other devices end too (endSessions), or their next sync would upload their copy of the progress into a new
// account; this browser erases its own copy (src/auth.js onDeleteAccount).
import { readSession, deleteRecord, endSessions, clearCookie, json, sameOrigin } from "../_lib/auth.js";
import { erasePlayer } from "../_lib/db.js";
import { eraseAppAccount } from "../_lib/app/context.js";
import { limit } from "../_lib/ratelimit.js";

export async function onRequestDelete({ request, env }) {
  if (!sameOrigin(request, env)) return json({ error: "origin" }, 403);
  const s = await readSession(request, env);
  if (!s) return json({ error: "auth" }, 401);
  const blocked = await limit(env, request, "account", { max: 5, windowSec: 3600, id: s.id });
  if (blocked) return blocked;
  await endSessions(env, s.id);
  await erasePlayer(env, s.id);
  await eraseAppAccount(env, s.id); // the app's wallet and play records (nothing to do before its tables exist)
  await deleteRecord(env, s.id);
  return json({ ok: true }, 200, [clearCookie(request, "sh_session")]);
}
