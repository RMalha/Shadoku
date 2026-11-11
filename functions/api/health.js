// GET /api/health  →  200 { ok: true } when the site's backend can reach its storage, 503 otherwise. The uptime monitor watches this URL.
// It reveals only booleans: no versions, names or counts. Cheap on purpose: one trivial D1 query and one KV read (a missing key is fine).
import { json } from "../_lib/auth.js";

export async function onRequestGet({ env }) {
  const checks = {};
  checks.d1 = env.SHADOKU_DB ? await env.SHADOKU_DB.prepare("SELECT 1 AS ok").first().then((r) => !!r, () => false) : null;
  checks.kv = env.SHADOKU_KV ? await env.SHADOKU_KV.get("health:probe").then(() => true, () => false) : null;
  const ok = Object.values(checks).every((v) => v !== false);
  return json({ ok, ...checks }, ok ? 200 : 503);
}
