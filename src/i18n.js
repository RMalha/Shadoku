/**
 * i18n.js — the locale files (src/locales/<lang>.json) as the app sees them.
 *
 *   LOCALES      { "en": { "ui.nav.signIn": "Sign In", "LORE.tutorial.1.TITLE": "…", … }, "pt-PT": { … }, … }
 *   LOCALE_CODES the codes that have a file, even an empty one ("en" first)
 *   localeKey(k) the locale-file key of an app key: "nav.signIn" → "ui.nav.signIn"; "ui.*" and generated keys
 *                (they start with a capital: LORE.*, PROP.*, CLUE…) stay as they are
 *   codeKey(k)   the in-code fallback key (STRINGS in ShadokuHome.jsx): "ui.nav.signIn" → "nav.signIn"
 *
 * Every file is one flat object of dotted keys (i18n Ally "flat" keystyle). Files are read as raw text and parsed
 * here, so an empty file (a new, untranslated locale: it is listed, everything falls back to English), invalid JSON
 * or a non-object never breaks the build or the app (those two are skipped with a console warning). Nested objects
 * are flattened to dotted keys; non-string and empty values are dropped (an empty value falls back to English, like
 * scripts/check-locales.mjs).
 */
import { createContext, useContext } from "react";

const RAW = import.meta.glob("./locales/*.json", { query: "?raw", import: "default", eager: true });

function flatten(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") { if (v) out[key] = v; } else if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
  }
  return out;
}

function parse(file, text) {
  const raw = String(text || "").trim(); // trim() also drops a byte-order mark
  if (!raw) return {}; // a new, empty locale file: listed in the picker, everything falls back to English
  try {
    const d = JSON.parse(raw);
    if (d && typeof d === "object" && !Array.isArray(d)) return flatten(d, "", {});
    console.warn(`[i18n] ${file}: not one JSON object, skipped`);
  } catch (e) {
    console.warn(`[i18n] ${file}: invalid JSON, skipped (${e.message})`);
  }
  return null;
}

export const LOCALES = {};
for (const [path, text] of Object.entries(RAW)) {
  const code = path.replace(/^.*\//, "").replace(/\.json$/i, "");
  const dict = parse(path, text);
  if (dict) LOCALES[code] = dict;
}
if (!LOCALES.en) LOCALES.en = {};

export const LOCALE_CODES = ["en", ...Object.keys(LOCALES).filter((c) => c !== "en").sort()];

const GENERATED = /^[A-Z]/; // engine keys: CLUE, PROP.SAFE.a, LORE.tutorial.1.TITLE …
export const localeKey = (key) => (key.startsWith("ui.") || GENERATED.test(key) ? key : `ui.${key}`);
export const codeKey = (key) => (key.startsWith("ui.") ? key.slice(3) : key);

/* ───────────── text access for components ─────────────
 *   TextContext   the site's t(key, vars) (ShadokuHome's LangProvider supplies it: current locale → en.json → in-code English)
 *   useText()     that t, or tEn when a component is rendered outside the providers
 *   tEn(key, vars) English straight from en.json (no React, no language state)
 *   fillVars(text, vars) replaces {name} placeholders
 */
export const TextContext = createContext(null);
export const fillVars = (text, vars) => (vars ? String(text).replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? "" : vars[k])) : text);
export const tEn = (key, vars) => {
  const raw = LOCALES.en[localeKey(String(key))];
  return raw == null ? String(key) : fillVars(raw, vars);
};
export const useText = () => useContext(TextContext) || tEn;
