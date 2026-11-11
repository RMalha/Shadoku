// POST /api/report { kind, message, stack, route, build }  →  204. The app reports its own uncaught errors here (src/reportError.js).
// Kept: the error text, the route (path only, no query), the build id and the time. Not kept: the address, cookies, account or browser.
// Stored in D1 (table `errors`, the last 14 days) and logged. Read them with:
//   npx wrangler d1 execute shadoku --remote --command "SELECT datetime(at,'unixepoch') t, kind, route, message FROM errors ORDER BY id DESC LIMIT 30"
import { json, sameOrigin } from "../_lib/auth.js";
import { db, noStorage, readBody } from "../_lib/db.js";
import { limit } from "../_lib/ratelimit.js";

const KINDS = new Set(["render", "error", "rejection"]);
const clip = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, n) : "");
const KEEP_DAYS = 14;

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request, env)) return json({ error: "origin" }, 403);
  const blocked = (await limit(env, request, "report", { max: 10, windowSec: 600 })) || (await limit(env, request, "report-all", { max: 300, windowSec: 3600, id: "all" }));
  if (blocked) return blocked;
  const d = await db(env);
  if (!d) return noStorage();
  const body = await readBody(request, 6 * 1024);
  if (!body || !KINDS.has(body.kind) || !clip(body.message, 300)) return json({ error: "format" }, 400);
  const row = { kind: body.kind, route: clip(body.route, 120).split(/[?#]/)[0], build: clip(body.build, 40), message: clip(body.message, 300), stack: clip(body.stack, 1500) };
  await d.prepare("INSERT INTO errors (at, route, build, message, stack, kind) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(Math.floor(Date.now() / 1000), row.route, row.build, row.message, row.stack, row.kind).run();
  console.warn(JSON.stringify({ at: "client-error", ...row, stack: row.stack.slice(0, 300) }));
  if (Math.random() < 0.05) await d.prepare("DELETE FROM errors WHERE at < ?1").bind(Math.floor(Date.now() / 1000) - KEEP_DAYS * 86400).run().catch(() => {});
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
