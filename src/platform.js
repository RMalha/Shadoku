// Where the game is running, decided once at startup (imported first by src/main.jsx):
//   "android"   the Play Store app (a Trusted Web Activity). Its launch URL carries ?source=twa (set as the
//               startUrl in the Android project's twa-manifest.json) and Chrome passes android-app://<package> as the referrer.
//   "installed" the site installed from the browser ("Add to Home screen"): the manifest's start_url carries ?source=pwa.
//   "web"       a browser tab.
// The launch marker is kept in sessionStorage, so it survives reloads and in-app navigation, and is then
// removed from the address bar. Use it for app-only features and wording, never for anything a player could
// cheat with: anyone can add ?source=twa to a URL. The server cannot trust it either.
const KEY = "shadoku-platform";

function detect() {
  if (typeof window === "undefined") return "web";
  let platform = null;
  const url = new URL(window.location.href);
  const source = url.searchParams.get("source");
  if (source === "twa" || (document.referrer || "").startsWith("android-app://")) platform = "android";
  else if (source === "pwa") platform = "installed";
  if (platform) {
    try { sessionStorage.setItem(KEY, platform); } catch { /* storage off: this launch only */ }
  } else {
    try { platform = sessionStorage.getItem(KEY); } catch { /* storage off */ }
  }
  if (source) {
    url.searchParams.delete("source");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
  if (!platform && window.matchMedia?.("(display-mode: standalone)").matches) platform = "installed";
  return platform || "web";
}

export const PLATFORM = detect();
/** True inside the Play Store app. */
export const IS_ANDROID_APP = PLATFORM === "android";
/** True when the game runs as an app (Play Store or installed from the browser), not in a browser tab. */
export const IS_APP = PLATFORM !== "web";
