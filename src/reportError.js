// Reports the app's own uncaught errors to /api/report (functions/api/report.js): the error text, the route path, the build id. No
// account, address or cookie. Production only, at most 5 reports per page load, each distinct error once. Never throws.
const seen = new Set();
let sent = 0;

const build = () => {
  try { return (document.querySelector('script[src*="/assets/index-"]')?.getAttribute("src") || "").match(/index-([\w-]+)\.js/)?.[1] || ""; } catch { return ""; }
};

export function reportError(err, kind = "error") {
  try {
    if (!import.meta.env.PROD || sent >= 5) return;
    const message = String((err && err.message) || err || "").slice(0, 300);
    if (!message) return;
    const stack = String((err && err.stack) || "").slice(0, 1500);
    const sig = kind + message + stack.slice(0, 120);
    if (seen.has(sig)) return;
    seen.add(sig); sent++;
    fetch("/api/report", {
      method: "POST", keepalive: true, credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, message, stack, route: window.location.pathname, build: build() }),
    }).catch(() => {});
  } catch { /* reporting must never cause an error */ }
}

export function installErrorReporting() {
  window.addEventListener("error", (e) => reportError(e.error || e.message, "error"));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, "rejection"));
}
