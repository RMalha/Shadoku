import { Component } from "react";
import { tEn } from "./i18n.js";
import { BOARDS_KEY } from "./sync.js";

const EN = {
  "ui.error.title": "Something went wrong",
  "ui.error.body": "This page could not be drawn. Reloading usually fixes it. If it comes back, clearing this case's saved board may help.",
  "ui.error.reload": "Reload",
  "ui.error.clear": "Clear this case's save",
};
const say = (k) => { try { const v = tEn(k); return v && v !== k ? v : EN[k]; } catch { return EN[k]; } };

/** Removes the Workshop's play-test copy and the saved board of the case in the address bar (/play/<id>, /community/play/<id>): the usual cause of a page that cannot draw. */
function clearSave() {
  try {
    localStorage.removeItem("shadoku-create-test");
    const seg = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).pop() || "").toLowerCase();
    const boards = JSON.parse(localStorage.getItem(BOARDS_KEY) || "{}");
    if (boards && typeof boards === "object") {
      Object.keys(boards).forEach((id) => { if (id.toLowerCase() === seg) delete boards[id]; });
      localStorage.setItem(BOARDS_KEY, JSON.stringify(boards));
    }
  } catch { /* nothing to clear */ }
}

/** The last line of defence: one render error shows a plain page with a way out instead of an empty screen. Plain styles, no app components. */
export default class ErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { err: false }; }
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch(e) { console.error("[Shadoku] the app failed to render:", e); }
  render() {
    if (!this.state.err) return this.props.children;
    const btn = { font: "inherit", padding: "10px 18px", margin: "6px", borderRadius: 8, border: "1px solid #888", background: "transparent", color: "inherit", cursor: "pointer" };
    return (
      <div role="alert" style={{ maxWidth: 520, margin: "12vh auto", padding: 24, textAlign: "center", color: "#eee", fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 22 }}>{say("ui.error.title")}</h1>
        <p style={{ lineHeight: 1.5 }}>{say("ui.error.body")}</p>
        <button type="button" style={btn} onClick={() => window.location.reload()}>{say("ui.error.reload")}</button>
        <button type="button" style={btn} onClick={() => { clearSave(); window.location.reload(); }}>{say("ui.error.clear")}</button>
      </div>
    );
  }
}
