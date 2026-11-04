// DELETE /api/account  →  the account's server-side record (its codename and game progress) is erased and the session ends.
// The legal page promises this: "you can delete it any time … removes your account and the game data saved for it".
// That includes its ranking row, its ratings and the community puzzles it published (functions/_lib/db.js erasePlayer).
import { readSession, deleteRecord, clearCookie, json, sameOrigin } from "../_lib/auth.js";
import { erasePlayer } from "../_lib/db.js";

export async function onRequestDelete({ request, env }) {
  if (!sameOrigin(request, env)) return json({ error: "origin" }, 403);
  const s = await readSession(request, env);
  if (!s) return json({ error: "auth" }, 401);
  await erasePlayer(env, s.id);
  await deleteRecord(env, s.id);
  return json({ ok: true }, 200, [clearCookie(request, "sh_session")]);
}
