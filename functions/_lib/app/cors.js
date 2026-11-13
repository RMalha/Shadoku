/**
 * Cross-origin access for the Android app (architecture 4.1). The app's web code is served inside the APK from
 * https://app.shadoku.net (app/capacitor.config.json: no server answers there), so every call it makes to the API is
 * cross-origin. functions/api/_middleware.js lets that one origin read the API's answers and send `authorization` and
 * `content-type`. Never `Access-Control-Allow-Credentials`: the app proves who it is with a bearer token, and a cookie sent
 * from that origin is dropped before any endpoint sees it. Every other origin gets what it got before: no CORS headers at all.
 */
import { devHost } from "./verifiers.js";

export const APP_ORIGIN = "https://app.shadoku.net";

/**
 * → the request's Origin when it is the app's, else "". APP_DEV_ORIGINS (comma-separated, e.g. "http://localhost:5183" for
 * `npm --prefix app run dev`) adds origins on localhost and Pages preview addresses only, never on the site's own domain.
 */
export function appOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return "";
  if (origin === APP_ORIGIN) return origin;
  const extra = typeof env.APP_DEV_ORIGINS === "string" && devHost(request) ? env.APP_DEV_ORIGINS.split(",").map((o) => o.trim().replace(/\/+$/, "")) : [];
  return extra.includes(origin) ? origin : "";
}

/** The answer to the browser's preflight question (OPTIONS) from the app's origin. */
export const preflight = (origin) => new Response(null, {
  status: 204,
  headers: {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  },
});

/** → the response, readable by the app's origin. */
export function withCors(res, origin) {
  const out = new Response(res.body, res); // a copy: a response's headers may be read-only
  out.headers.set("Access-Control-Allow-Origin", origin);
  out.headers.append("Vary", "Origin");
  return out;
}

/** → the request without its cookies: the app's origin is never signed in by a cookie. */
export function withoutCookies(request) {
  if (!request.headers.has("Cookie")) return request;
  const headers = new Headers(request.headers);
  headers.delete("Cookie");
  return new Request(request, { headers });
}
