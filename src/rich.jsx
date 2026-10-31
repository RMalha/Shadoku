import React from "react";

/**
 * **bold** markers in a locale string → React nodes (<b>). The one inline-markup scheme of the game screens
 * (ShadokuHome's <Rich/> also knows [[murdoku]] and [[email]]). Unbalanced markers are shown as typed.
 */
export function boldNodes(text, props = {}) {
  const parts = String(text == null ? "" : text).split(/\*\*(.+?)\*\*/s);
  return parts.map((s, i) => (i % 2 ? <b key={i} {...props}>{s}</b> : s || null));
}
