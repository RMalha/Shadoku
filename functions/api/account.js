// DELETE /api/account  →  { ok }   the account is erased and every session of it ends: on the website, and in the Android app.
// The legal page promises this: "you can delete it any time … removes your account and the game data saved for it".
//
// Who may ask (functions/_lib/caller.js): the site's session cookie from the site's own origin, as always, or the app's bearer
// token from the app's origin. From the app a guest account can be deleted too (it has no other way to), and so can a banned one.
//
// What goes, in this order (functions/_lib/retention.js eraseAccount: the accounts deleted as inactive go the same way):
//   1. the app's tables (functions/_lib/app/context.js eraseAppAccount): one batch, whole or not at all, so a failure here leaves
//      the caller signed in and able to ask again. It takes the account's phones with it: every app token stops at once.
//      What stays without the account id (purchases, their money lines, a ban): architecture 4.11.
//   2. its sessions (endSessions): the site's cookies on other devices end, or their next sync would upload their copy of the
//      progress into a new account. This browser erases its own copy (src/auth.js onDeleteAccount); the app erases its own.
//   3. its ranking row, its ratings and the community puzzles it published (functions/_lib/db.js erasePlayer).
//   4. its codename, avatar and saved progress (deleteRecord).
import { clearCookie, json } from "../_lib/auth.js";
import { caller } from "../_lib/caller.js";
import { eraseAccount } from "../_lib/retention.js";
import { limit } from "../_lib/ratelimit.js";

export async function onRequestDelete({ request, env }) {
  const who = await caller(request, env, { write: true, guest: true, banned: true });
  if (who.error) return who.error;
  const { s } = who;
  const blocked = await limit(env, request, "account", { max: 5, windowSec: 3600, id: s.id });
  if (blocked) return blocked;
  await eraseAccount(env, s.id);
  return json({ ok: true }, 200, who.app ? [] : [clearCookie(request, "sh_session")]);
}
