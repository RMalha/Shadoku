// POST /api/app/integrity { token }  →  { ok }   The phone reports in with a Play Integrity token (a standard request whose hash is
// integrity.js integrityHash("device", <account id>)): Google decodes it and the verdict is kept on this phone's device row.
// OBSERVE MODE (architecture 4.8 item 5, 4.21): nothing is refused on a verdict, a failing one files a flag for review, and the
// answer is the same whatever the verdict was. 503 integrity_unavailable without PLAY_SERVICE_ACCOUNT.
import { json } from "../../_lib/auth.js";
import { readBody } from "../../_lib/db.js";
import { appContext } from "../../_lib/app/context.js";
import { reportIntegrity } from "../../_lib/app/integrity.js";

export async function onRequestPost({ request, env }) {
  const ctx = await appContext(request, env, { write: true, rate: { name: "app-integrity", max: 12, windowSec: 600 } });
  if (ctx.error) return ctx.error;
  const body = await readBody(request, 24 * 1024);
  if (!body) return json({ error: "format" }, 400);
  const out = await reportIntegrity(ctx, body);
  return json(out.body, out.status);
}
