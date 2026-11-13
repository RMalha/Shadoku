/**
 * Shared helpers for the sign-in endpoints (Cloudflare Pages Functions).
 *
 * Secrets (wrangler pages secret put …, or .dev.vars locally):
 *   SESSION_SECRET                          32+ random characters; signs the session and the OAuth state cookies
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 *   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
 * Optional:
 *   SITE_URL      the public origin (https://shadoku.net); default: the origin of the request
 *   SHADOKU_KV    a KV namespace binding: unique codenames, the account's server-side record and its game progress
 *
 * The session is a stateless HMAC-signed cookie (HttpOnly, SameSite=Lax); the codename and the game progress are stored server-side.
 */

const enc = new TextEncoder();
export const SESSION_DAYS = 30;
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

/* ───────────── encoding + signing ───────────── */
export const b64u = (buf) => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const hmacKey = (env, usage) => {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET is missing or shorter than 32 characters");
  return crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
};

/** {…} → "payload.signature" (the payload gets `iat`, issued at in epoch ms, and `exp` in epoch seconds). */
export async function seal(env, data, maxAgeSec) {
  const now = Date.now();
  const body = b64u(enc.encode(JSON.stringify({ ...data, iat: now, exp: Math.floor(now / 1000) + maxAgeSec })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env, "sign"), enc.encode(body));
  return `${body}.${b64u(sig)}`;
}

/** → the payload, or null when the signature is wrong, the token is malformed or it expired (more than `graceSec` ago: only the
 *  app's token renewal passes one, functions/_lib/app/accounts.js; everything else reads a token with no grace). */
export async function unseal(env, token, graceSec = 0) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig) return null;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(env, "verify"), unb64u(sig), enc.encode(body));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(unb64u(body)));
    return data.exp + graceSec > Date.now() / 1000 ? data : null;
  } catch { return null; }
}

export const randomToken = (bytes = 32) => b64u(crypto.getRandomValues(new Uint8Array(bytes)));
export const sha256b64u = async (text) => b64u(await crypto.subtle.digest("SHA-256", enc.encode(text)));

/* ───────────── cookies ───────────── */
const isHttps = (request) => new URL(request.url).protocol === "https:";
/** `__Host-` pins a cookie to this exact origin (needs Secure, so https only; plain http on localhost keeps the bare name). */
export const cookieName = (request, name) => (isHttps(request) ? `__Host-${name}` : name);

export function readCookie(request, name) {
  const jar = request.headers.get("Cookie") || "";
  for (const part of jar.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

export const setCookie = (request, name, value, maxAgeSec) =>
  `${cookieName(request, name)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isHttps(request) ? "; Secure" : ""}`;
export const clearCookie = (request, name) => setCookie(request, name, "", 0);

/* ───────────── responses ───────────── */
export const json = (data, status = 200, cookies = []) => {
  const h = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(JSON.stringify(data), { status, headers: h });
};

export const redirect = (location, cookies = []) => {
  const h = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers: h });
};

/** Only same-site paths: "/play/x?y" yes; "//evil.example", "/\t/evil.example" (URL parsers drop the tab), backslashes and "https://…" no: printable ASCII only. */
export const safeReturn = (p) => (typeof p === "string" && /^\/(?!\/)[\x21-\x5b\x5d-\x7e]*$/.test(p) && p.length < 300 ? p : "/");

/** The origin the site is served from (SITE_URL pins it for the OAuth redirect URIs). */
export const siteOrigin = (request, env) => (env.SITE_URL ? env.SITE_URL.replace(/\/+$/, "") : new URL(request.url).origin);

/** State-changing calls must come from this site (SameSite=Lax is the first line; this is the second). */
export const sameOrigin = (request, env) => {
  const origin = request.headers.get("Origin");
  return !!origin && origin === siteOrigin(request, env);
};

/* ───────────── providers ───────────── */
const getJson = async (url, headers) => {
  const r = await fetch(url, { headers: { Accept: "application/json", ...headers } });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json();
};

export const PROVIDERS = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    extra: { prompt: "select_account" },
    idVar: "GOOGLE_CLIENT_ID",
    secretVar: "GOOGLE_CLIENT_SECRET",
    async profile(accessToken) {
      const u = await getJson("https://openidconnect.googleapis.com/v1/userinfo", { Authorization: `Bearer ${accessToken}` });
      return { sub: String(u.sub), name: u.name || "", email: u.email_verified ? u.email || "" : "", avatar: u.picture || "" };
    },
  },
  github: {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    extra: {},
    idVar: "GITHUB_CLIENT_ID",
    secretVar: "GITHUB_CLIENT_SECRET",
    async profile(accessToken) {
      const h = { Authorization: `Bearer ${accessToken}`, "User-Agent": "shadoku", "X-GitHub-Api-Version": "2022-11-28" };
      const u = await getJson("https://api.github.com/user", h);
      let email = "";
      try { // the profile email is often private: the verified primary one comes from /user/emails
        const list = await getJson("https://api.github.com/user/emails", h);
        email = (list.find((e) => e.primary && e.verified) || {}).email || "";
      } catch { /* scope declined: no email */ }
      return { sub: String(u.id), name: u.name || u.login || "", email, avatar: u.avatar_url || "" };
    },
  },
};

export const providerConfigured = (env, name) => {
  const p = PROVIDERS[name];
  return !!(p && env[p.idVar] && env[p.secretVar]);
};

/* ───────────── session + codename record ───────────── */
export async function readSession(request, env) {
  const s = await unseal(env, readCookie(request, cookieName(request, "sh_session")));
  // `aud` marks a token made for something else (the app's bearer token, functions/_lib/app/context.js): never a site cookie
  if (!s || !s.id || s.aud) return null;
  return (await sessionAlive(env, s)) ? s : null;
}

/** → false for a session of an account deleted after it was issued (on this device or another): the session is over, or its
 *  next sync would bring the erased progress and scores back into a new account. */
export async function sessionAlive(env, s) {
  const gone = env.SHADOKU_KV ? Number(await env.SHADOKU_KV.get(goneKey(s.id))) : 0;
  const issued = Number(s.iat) || (s.exp - SESSION_DAYS * 86400) * 1000; // sessions from before `iat`: their exp says when
  return !(gone && issued <= gone);
}

/** The account is being deleted: every session issued until now stops working (readSession). The mark outlives the longest session,
 *  then expires: it holds only the account id and the time. */
export async function endSessions(env, id) {
  if (env.SHADOKU_KV) await env.SHADOKU_KV.put(goneKey(id), String(Date.now()), { expirationTtl: SESSION_DAYS * 86400 + 86400 });
}

const goneKey = (id) => `gone:${id}`;
const userKey = (id) => `user:${id}`;
const nameKey = (name) => `name:${name.toLowerCase()}`;
const progressKey = (id) => `progress:${id}`;

/** The account's record: { username, avatar, since } ("" when unset; avatar: src/avatarLook.js; since: when an account deleted before
 *  was made again, epoch ms, else 0: progress a browser kept from before then is not this account's, see accountSince). */
export const getRecord = async (env, id) => {
  const rec = env.SHADOKU_KV ? await env.SHADOKU_KV.get(userKey(id), "json") : null;
  return { username: rec?.username || "", avatar: typeof rec?.avatar === "string" ? rec.avatar : "", since: Number.isFinite(rec?.since) ? rec.since : 0 };
};

/** → when this account started (epoch ms; 0 = its first life). An account deleted before starts at its deletion: the `gone` mark expires
 *  with the longest session, so the first call after it copies the time into the record, where it stays. */
export async function accountSince(env, id) {
  if (!env.SHADOKU_KV) return 0;
  const rec = await getRecord(env, id);
  if (rec.since) return rec.since;
  const gone = Number(await env.SHADOKU_KV.get(goneKey(id))) || 0;
  if (gone) await env.SHADOKU_KV.put(userKey(id), JSON.stringify({ ...rec, since: gone }));
  return gone;
}
export const getCodename = async (env, id) => (await getRecord(env, id)).username;

/** → true when the name is free (or already this account's). Without a KV namespace nothing is reserved. */
export async function codenameFree(env, name, id) {
  if (!env.SHADOKU_KV) return true;
  const owner = await env.SHADOKU_KV.get(nameKey(name));
  return !owner || owner === id;
}

/** Reserves `name` for `id` and releases the account's previous one. KV is not transactional: a same-instant race on one name is possible and harmless. */
export async function setCodename(env, id, name) {
  if (!env.SHADOKU_KV) return;
  const rec = await getRecord(env, id), prev = rec.username;
  await env.SHADOKU_KV.put(nameKey(name), id);
  await env.SHADOKU_KV.put(userKey(id), JSON.stringify({ ...rec, username: name }));
  if (prev && prev.toLowerCase() !== name.toLowerCase()) await env.SHADOKU_KV.delete(nameKey(prev));
}

/** Saves the avatar choice ("" = S. H. Adow, "photo", "L:…") in the account's record. */
export async function setAvatar(env, id, avatar) {
  if (!env.SHADOKU_KV) return;
  const rec = await getRecord(env, id);
  await env.SHADOKU_KV.put(userKey(id), JSON.stringify({ ...rec, avatar }));
}

export async function deleteRecord(env, id) {
  if (!env.SHADOKU_KV) return;
  const prev = await getCodename(env, id);
  if (prev) await env.SHADOKU_KV.delete(nameKey(prev));
  await env.SHADOKU_KV.delete(userKey(id));
  await env.SHADOKU_KV.delete(progressKey(id));
}

/** The account's game progress (src/sync.js decides its shape), or null. */
export const getProgress = async (env, id) => (env.SHADOKU_KV ? env.SHADOKU_KV.get(progressKey(id), "json") : null);
export async function setProgress(env, id, progress) {
  if (env.SHADOKU_KV) await env.SHADOKU_KV.put(progressKey(id), JSON.stringify(progress));
}
