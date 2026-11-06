// Where the game is running, decided once at startup (imported first by src/main.jsx):
//   "android"   the Play Store app (a Trusted Web Activity). Its launch URL carries ?source=twa (set as the
//               startUrl in the Android project's twa-manifest.json) and Chrome passes android-app://<package> as the referrer.
//   "installed" the site installed from the browser ("Add to Home screen"): the manifest's start_url carries ?source=pwa.
//   "web"       a browser tab.
// The launch marker is kept in sessionStorage, so it survives reloads and in-app navigation, and is then
// removed from the address bar. Use it for app-only features and wording, never for anything a player could
// cheat with: anyone can add ?source=twa to a URL. The server cannot trust it either.
//
// The phone gate: on an Android phone's browser the puzzles are played in the Play Store app (ShadokuApp shows
// AppGatePage instead of a board). iPhones, tablets and computers play in the browser as before. The app, and the
// site installed from the browser, are never gated: if the app's launch marker were ever lost, it falls back to
// "installed" and still plays.
//
// LAUNCH DAY (the app is public on Google Play):
//   1. PHONE_GATE = true below.
//   2. public/manifest.webmanifest: add
//        "related_applications": [{ "platform": "play", "id": "<PLAY_PACKAGE>" }], "prefer_related_applications": true
//      so Chrome offers the Play Store app instead of installing the site.
// Until then `?phonegate=preview` turns the gate on in one browser tab (any device), to try it.
const KEY = "shadoku-platform";
const PREVIEW_KEY = "shadoku-phonegate";

/** The Play Store app's package name (Bubblewrap's packageId): permanent once published. */
export const PLAY_PACKAGE = "net.shadoku.app";
export const PLAY_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;
/** The host the app opens (its Digital Asset Links live there: /.well-known/assetlinks.json). */
export const APP_HOST = "www.shadoku.net";
/** The launch switch: true once the app is public on Google Play. */
export const PHONE_GATE = false;

function readLaunch() {
  if (typeof window === "undefined") return { platform: "web", preview: false };
  let platform = null, preview = false;
  const url = new URL(window.location.href);
  const source = url.searchParams.get("source");
  const gate = url.searchParams.get("phonegate");
  if (source === "twa" || (document.referrer || "").startsWith("android-app://")) platform = "android";
  else if (source === "pwa") platform = "installed";
  try {
    if (platform) sessionStorage.setItem(KEY, platform);
    else platform = sessionStorage.getItem(KEY);
    if (gate === "preview") sessionStorage.setItem(PREVIEW_KEY, "1");
    preview = sessionStorage.getItem(PREVIEW_KEY) === "1";
  } catch { preview = gate === "preview"; /* storage off: this launch only */ }
  if (source !== null || gate !== null) {
    url.searchParams.delete("source");
    url.searchParams.delete("phonegate");
    if (url.protocol !== "file:") window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
  if (!platform && window.matchMedia?.("(display-mode: standalone)").matches) platform = "installed";
  return { platform: platform || "web", preview };
}

/** An Android phone (not a tablet): Chrome's client hints when it has them, else the user agent's "Mobile" token. */
function isAndroidPhone() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const hints = navigator.userAgentData;
  const android = hints?.platform ? hints.platform === "Android" : /Android/i.test(ua);
  if (!android) return false;
  return typeof hints?.mobile === "boolean" ? hints.mobile : /Mobile/i.test(ua);
}

const LAUNCH = readLaunch();
export const PLATFORM = LAUNCH.platform;
/** True inside the Play Store app. */
export const IS_ANDROID_APP = PLATFORM === "android";
/** True when the game runs as an app (Play Store or installed from the browser), not in a browser tab. */
export const IS_APP = PLATFORM !== "web";
/** True on an Android phone's browser. */
export const IS_ANDROID_PHONE = isAndroidPhone();
/** Puzzles open the "Play in the app" page instead of the board: an Android phone's browser, once the switch is on (or in a preview tab). */
export const PHONE_GATED = PLATFORM === "web" && (LAUNCH.preview || (PHONE_GATE && IS_ANDROID_PHONE));

/**
 * A link that opens `path` in the app when it is installed and the app's Play Store page when it is not
 * (Chrome's intent: URL; the app's launch marker rides along so it knows it is the app).
 */
export function appLink(path = "/") {
  const target = new URL(path, `https://${APP_HOST}`);
  target.searchParams.set("source", "twa");
  return `intent://${APP_HOST}${target.pathname}${target.search}#Intent;scheme=https;package=${PLAY_PACKAGE};S.browser_fallback_url=${encodeURIComponent(PLAY_URL)};end`;
}
