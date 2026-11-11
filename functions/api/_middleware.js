// Runs in front of every /api/* function (not the static files, so it costs no extra requests).
// An uncaught error becomes one JSON log line (visible in Cloudflare's real-time logs / Workers Logs) and a plain 500 instead of
// Cloudflare's HTML error page, which the app cannot read. Rate-limited answers are logged too, so abuse shows up in the logs.
import { json } from "../_lib/auth.js";

export async function onRequest({ request, next }) {
  const t0 = Date.now();
  try {
    const res = await next();
    if (res.status >= 500 || res.status === 429) {
      console.warn(JSON.stringify({ at: "api", status: res.status, method: request.method, path: new URL(request.url).pathname, ms: Date.now() - t0 }));
    }
    return res;
  } catch (e) {
    console.error(JSON.stringify({ at: "api", status: 500, method: request.method, path: new URL(request.url).pathname, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 300), stack: String((e && e.stack) || "").slice(0, 800) }));
    return json({ error: "server" }, 500);
  }
}
