/**
 * auth.js — the browser side of the sign-in backend (functions/api/*, Cloudflare Pages Functions).
 *
 * Every hook returns `undefined` when there is no backend (npm run dev, a file:// bundle, a static host): the site then
 * keeps its local DEMO sign-in, so the game never depends on the server.
 */
import { startSync, stopSync, clearLocalProgress } from "./sync.js";

const JSON_HEADERS = { Accept: "application/json" };

async function call(path, init) {
  try {
    const r = await fetch(path, { credentials: "same-origin", ...init, headers: { ...JSON_HEADERS, ...(init?.headers || {}) } });
    if (!/json/.test(r.headers.get("content-type") || "")) return null; // the SPA's index.html answered: no backend here
    return { status: r.status, body: await r.json() };
  } catch { return null; }
}

/** → { providers, user } or null (no backend). */
async function session() {
  const r = await call("/api/auth/session");
  return r && r.status === 200 && r.body && "providers" in r.body ? r.body : null;
}

export async function onSession() {
  const s = await session();
  if (s && s.deleted) { // the account was deleted on another device: its progress goes from this browser too
    clearLocalProgress();
    window.location.reload(); // the server cleared the cookie, so the fresh page is simply signed out
    return new Promise(() => {});
  }
  if (s && s.user) startSync(); // the progress follows the account (src/sync.js)
  return s ? s.user : undefined; // user | null (not signed in) | undefined (no backend)
}

export async function onSignIn(provider) {
  const s = await session();
  if (!s) return undefined; // no backend: demo session
  if (!s.providers[provider]) throw new Error("not_configured");
  const back = window.location.pathname + window.location.search;
  window.location.assign(`/api/auth/${provider}/login?return=${encodeURIComponent(back)}`);
  return new Promise(() => {}); // the page is leaving: "Working…" stays up until the provider takes over
}

export async function onSignOut() {
  stopSync();
  await call("/api/auth/logout", { method: "POST" });
}

export async function onCheckUsername(name) {
  const r = await call(`/api/username?name=${encodeURIComponent(name)}`);
  return r && r.status === 200 ? { available: r.body.available === true } : undefined; // 401 (a demo session) or no backend: local check
}

export async function onUsernameChange(name) {
  const r = await call("/api/username", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
  if (r && r.status === 409) throw new Error("taken");
}

/** → true saved, false refused, undefined no backend (the avatar stays in this browser). */
export async function onAvatarChange(avatar) {
  const r = await call("/api/avatar", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ avatar }) });
  return r ? r.status === 200 : undefined;
}

/** → true when the server erased the account (or there is none to erase). This browser's game progress is erased with it. */
export async function onDeleteAccount() {
  stopSync();
  const r = await call("/api/account", { method: "DELETE" });
  const ok = !r || r.status === 200 || r.status === 401;
  if (ok) clearLocalProgress();
  return ok;
}

/** The provider's page can be restored from the back/forward cache with "Working…" still showing: reload it clean. */
if (typeof window !== "undefined") window.addEventListener("pageshow", (e) => { if (e.persisted) window.location.reload(); });

/** ?auth_error=<code> after a failed sign-in: read once, then removed from the address bar. */
export function takeAuthError() {
  if (typeof window === "undefined") return "";
  const u = new URL(window.location.href), code = u.searchParams.get("auth_error") || "";
  if (code) { u.searchParams.delete("auth_error"); window.history.replaceState({}, "", u.pathname + u.search + u.hash); }
  return code;
}
