// Shadoku's service worker: makes the site installable (and the Play Store app, a Trusted Web Activity) and lets it open offline.
// Registered by src/main.jsx in production builds only (never under `npm run dev`).
//  - /api/* (sign-in, progress, ranking, community) always goes to the network, untouched.
//  - Pages (navigations): network first, so a new deploy (a daily release) shows at once; offline, the last page shell.
//    Every route serves the same index.html (public/_redirects), so one cached shell covers them all.
//  - /assets/* (Vite's hashed bundles, the puzzles included): cache first, they never change; old builds are pruned.
//  - Other same-origin files (icons, favicons) and Google Fonts: served from the cache, refreshed in the background.
// Bump VERSION to drop the shell and static caches on the next visit.
const VERSION = "v1";
const SHELL = `shadoku-shell-${VERSION}`;
const STATIC = `shadoku-static-${VERSION}`;
const ASSETS = "shadoku-assets"; // hashed names: safe across versions
const KEEP_ASSETS = 80; // a build is a handful of files; this keeps a few builds back
const PRECACHE = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/favicon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL, STATIC, ASSETS]);
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith("shadoku-") && !keep.has(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

async function prune(cache, max) {
  const keys = await cache.keys(); // oldest first
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}

async function page(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put("/", copy));
    }
    return res;
  } catch {
    return (await caches.match("/", { cacheName: SHELL })) || Response.error();
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request, { cacheName: ASSETS });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    const cache = await caches.open(ASSETS);
    await cache.put(request, res.clone());
    prune(cache, KEEP_ASSETS);
  }
  return res;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  const fresh = fetch(request)
    .then((res) => {
      if (res.ok || res.type === "opaque") cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit || Response.error());
  if (hit) {
    event.waitUntil(fresh.then(() => undefined));
    return hit;
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/")) return;
    if (request.mode === "navigate") return event.respondWith(page(request));
    if (url.pathname.startsWith("/assets/")) return event.respondWith(cacheFirst(request));
    if (url.pathname === "/sw.js") return;
    return event.respondWith(staleWhileRevalidate(request, event));
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});
