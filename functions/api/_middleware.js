// Runs in front of every /api/* function (not the static files, so it costs no extra requests).
// An uncaught error becomes one JSON log line (visible in Cloudflare's real-time logs / Workers Logs) and a plain 500 instead of
// Cloudflare's HTML error page, which the app cannot read. Rate-limited answers are logged too, so abuse shows up in the logs.
// CORS (functions/_lib/app/cors.js): the Android app's origin, and only it, may read the answers; it is answered its preflight
// here, and a cookie it sends never reaches an endpoint. A request from the site itself or from any other origin passes
// through exactly as before.
import { json } from "../_lib/auth.js";
import { appOrigin, preflight, withCors, withoutCookies } from "../_lib/app/cors.js";

export async function onRequest({ request, env, next }) {
  const t0 = Date.now();
  const origin = appOrigin(request, env || {});
  if (origin && request.method === "OPTIONS") return preflight(origin);
  const answer = (res) => (origin ? withCors(res, origin) : res);
  try {
    const res = await (origin ? next(withoutCookies(request)) : next());
    if (res.status >= 500 || res.status === 429) {
      console.warn(JSON.stringify({ at: "api", status: res.status, method: request.method, path: new URL(request.url).pathname, ms: Date.now() - t0 }));
    }
    return answer(res);
  } catch (e) {
    console.error(JSON.stringify({ at: "api", status: 500, method: request.method, path: new URL(request.url).pathname, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 300), stack: String((e && e.stack) || "").slice(0, 800) }));
    return answer(json({ error: "server" }, 500));
  }
}
