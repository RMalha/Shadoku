/**
 * ShadokuAvatar.jsx — the avatar card on /profile (ShadokuPages.jsx ProfileInfo).
 *
 * Three choices: S. H. Adow (the default), "your own agent" (a portrait built from the suspects' kit in ShadokuArt.jsx: face, hair,
 * hat, glasses, clothes and backdrop, each option drawn as a small portrait) or the Google / GitHub account picture. Saving calls
 * useAuth().setAvatar (src/auth.js → functions/api/avatar.js); the code format is src/avatarLook.js. Strings: ui.avatar.*.
 */
import React, { useMemo, useState } from "react";
import { useLang, useAuth, AvatarArt } from "./ShadokuHome.jsx";
import {
  fixLook, deriveLook, Figure, TOKEN_ZOOM, TOKEN_CY, TOKEN_SW, HAIR_META, hairList, hatList, genderOk, clothingOk,
  SKIN, HAIR_HEX, HAIR_COLORS, HAT_COLORS, FRAME_COLORS, CLOTH, ACCENTS, SUSPECT_COLORS,
  EYES, BROWS, MOUTHS, BEARDS, TIES, TIE_GENDER, GLASSES, CLOTHING,
} from "./ShadokuArt.jsx";
import { encodeLook, decodeLook } from "./avatarLook.js";

const idx = (list) => list.map((_, i) => i);
const FRAMES = idx(FRAME_COLORS).filter((i) => FRAME_COLORS.indexOf(FRAME_COLORS[i]) === i); // the palette repeats its first colour
const BEACH = new Set(["shirtless", "bikini"]); // beach wear stays on the beach

/** The rows of each tab: [look field, "thumb" | "swatch", options for the current look, the swatch colour of an option]. */
const TABS = {
  face: [
    ["gender", "thumb", () => ["f", "m"]],
    ["skin", "swatch", () => idx(SKIN), (v) => SKIN[v]],
    ["eyes", "thumb", () => EYES],
    ["brows", "thumb", () => BROWS],
    ["mouth", "thumb", () => MOUTHS],
  ],
  hair: [
    ["hairStyle", "thumb", (L) => ["bald", ...hairList(L.gender, "short"), ...hairList(L.gender, "long")]],
    ["hairColor", "swatch", (L) => (L.hairStyle === "bald" ? [] : HAIR_COLORS), (v) => HAIR_HEX[v]],
    ["facialHair", "thumb", (L) => (L.gender === "m" ? BEARDS : [])],
  ],
  hat: [
    ["hat", "thumb", (L) => ["none", ...hatList(L.gender)]],
    ["hatC", "swatch", (L) => (L.hat === "none" ? [] : idx(HAT_COLORS)), (v) => HAT_COLORS[v]],
  ],
  glasses: [
    ["glassesStyle", "thumb", (L) => GLASSES.filter((g) => g !== "kurt" || L.gender === "f")],
    ["frameC", "swatch", (L) => (L.glasses ? FRAMES : []), (v) => FRAME_COLORS[v]],
  ],
  clothes: [
    ["clothing", "thumb", (L) => CLOTHING.filter((c) => !BEACH.has(c) && clothingOk(c, L.gender))],
    ["cloth", "swatch", () => idx(CLOTH), (v) => CLOTH[v]],
    ["tie", "thumb", (L) => TIES.filter((x) => x === "none" || genderOk(TIE_GENDER[x], L.gender))],
    ["accent", "swatch", (L) => (L.tie === "none" ? [] : idx(ACCENTS)), (v) => ACCENTS[v]],
  ],
  backdrop: [
    ["back", "swatch", () => SUSPECT_COLORS, (v) => v],
  ],
};
/** How each row's thumbnails are cropped: [zoom, centre y] in the 280×280 portrait. */
const CROP = { hairStyle: [1.05, 132], hat: [1.05, 128], clothing: [1, 168], tie: [1.3, 178], gender: [1.2, 132] };

/** The look with one field changed, kept consistent (hair length follows the style, glasses follow their style). */
function withField(L, key, v) {
  const o = { ...L, [key]: v };
  if (key === "hairStyle") o.hairLength = v === "bald" ? "bald" : (HAIR_META[v] || [])[1] || "short";
  if (key === "hairStyle" && v !== "bald" && (!o.hairColor || o.hairColor === "none")) o.hairColor = "brown";
  if (key === "glassesStyle") o.glasses = v !== "none";
  return fixLook(o);
}
const firstLook = (name) => deriveLook(name || "Agent", "A", "avatar", {});
function randomLook() {
  const L = deriveLook(Math.random().toString(36).slice(2), "A", "avatar", {});
  return fixLook({ ...L, clothing: BEACH.has(L.clothing) ? "shirtCrewNeck" : L.clothing, back: SUSPECT_COLORS[Math.floor(Math.random() * SUSPECT_COLORS.length)] });
}

function Portrait({ look, crop }) {
  const [zoom, cy] = crop || [TOKEN_ZOOM, TOKEN_CY];
  return (
    <svg viewBox="0 0 96 96" width="100%" height="100%" aria-hidden="true" focusable="false">
      <rect width="96" height="96" fill={look.back} /><Figure look={look} zoom={zoom} cy={cy} sw={TOKEN_SW} />
    </svg>
  );
}

export function AvatarMaker() {
  const { t } = useLang();
  const { user, setAvatar } = useAuth();
  const saved = (user && user.avatar) || "";
  const savedMode = saved === "photo" ? "photo" : saved.startsWith("L:") ? "custom" : "adow";
  const [mode, setMode] = useState(savedMode);
  const [look, setLook] = useState(() => decodeLook(saved) || firstLook(user && user.username));
  const [tab, setTab] = useState("face");
  const [status, setStatus] = useState(null); // "saving" | "saved" | "error"
  const L = useMemo(() => fixLook(look), [look]);
  if (!user) return null;
  const choice = mode === "photo" ? "photo" : mode === "custom" ? encodeLook(L) : "";
  const dirty = choice !== saved;
  const pick = (next) => { setStatus(null); setLook(next); };
  const choose = (m) => { setStatus(null); setMode(m); };
  const reset = () => { setStatus(null); setMode(savedMode); setLook(decodeLook(saved) || firstLook(user.username)); };
  const save = async () => {
    setStatus("saving");
    setStatus((await setAvatar(choice)) ? "saved" : "error");
  };
  const modes = [
    ["adow", t("avatar.adow"), <AvatarArt key="a" code="" />],
    ["custom", t("avatar.custom"), <Portrait key="c" look={L} />],
    ...(user.avatarUrl ? [["photo", t("avatar.photo"), <img key="p" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />]] : []),
  ];
  return (
    <section className="sh-pcard sh-avm" aria-labelledby="sh-avm-h">
      <style data-shadoku="avatar">{AVATAR_CSS}</style>
      <h2 id="sh-avm-h" className="sh-type">{t("avatar.title")}</h2>
      <p className="sh-muted sm">{t("avatar.lead")}</p>
      <div className="sh-avm-modes" role="radiogroup" aria-label={t("avatar.title")}>
        {modes.map(([m, label, art]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={`sh-avm-mode${mode === m ? " on" : ""}`} onClick={() => choose(m)}>
            <span className="sh-avm-disc">{art}</span><span>{label}</span>
          </button>
        ))}
      </div>
      {mode === "photo" && <p className="sh-muted sm">{t("avatar.photoNote")}</p>}
      {mode === "custom" && (
        <div className="sh-avm-maker">
          <div className="sh-avm-tabs" role="tablist" aria-label={t("avatar.custom")}>
            {Object.keys(TABS).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(`avatar.tab.${k}`)}</button>
            ))}
            <button type="button" className="sh-avm-dice" onClick={() => pick(randomLook())}>🎲 {t("avatar.random")}</button>
          </div>
          <div className="sh-avm-rows" role="tabpanel">
            {TABS[tab].map(([key, kind, optionsOf, colorOf]) => {
              const opts = optionsOf(L);
              if (!opts.length) return null;
              return (
                <div key={key} className="sh-avm-row">
                  <span className="sh-avm-label">{t(`avatar.row.${key}`)}</span>
                  <div className={`sh-avm-opts ${kind}`}>
                    {opts.map((v, i) => {
                      const on = L[key] === v;
                      const label = key === "gender" ? t(`avatar.gender.${v}`) : v === "none" ? t("avatar.none") : t(kind === "swatch" ? "avatar.colour" : "avatar.option", { n: i + 1 });
                      return kind === "swatch"
                        ? <button key={String(v)} type="button" className={`sh-avm-sw${on ? " on" : ""}`} style={{ background: colorOf(v) }} aria-pressed={on} aria-label={label} title={label} onClick={() => pick(withField(L, key, v))} />
                        : (
                          <button key={String(v)} type="button" className={`sh-avm-th${on ? " on" : ""}`} aria-pressed={on} aria-label={label} title={label} onClick={() => pick(withField(L, key, v))}>
                            <Portrait look={withField(key === "hairStyle" ? { ...L, hat: "none" } : L, key, v)} crop={CROP[key]} />
                            {v === "none" && <span className="sh-avm-none" aria-hidden="true">∅</span>}
                          </button>
                        );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="sh-avm-actions">
        <button type="button" className="sh-btn sm" disabled={!dirty || status === "saving"} onClick={save}>{t(status === "saving" ? "avatar.saving" : "avatar.save")}</button>
        {dirty && status !== "saving" && <button type="button" className="sh-btn ghost sm" onClick={reset}>{t("avatar.reset")}</button>}
        {status === "saved" && !dirty && <span className="sh-avm-ok" role="status">✓ {t("avatar.saved")}</span>}
        {status === "error" && <span className="sh-err sm" role="alert">{t("avatar.error")}</span>}
      </div>
    </section>
  );
}

const AVATAR_CSS = `
.sh-avm-modes{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}
.sh-avm-mode{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:104px;padding:10px 12px;border-radius:12px;border:1px solid var(--sh-line);background:#1a1a23;color:var(--sh-cream);font:600 13px 'Barlow',sans-serif;cursor:pointer}
.sh-avm-mode.on{border-color:var(--sh-brass);box-shadow:0 0 0 1px var(--sh-brass) inset;background:rgba(217,155,38,.08)}
.sh-avm-mode:focus-visible,.sh-avm-tabs button:focus-visible,.sh-avm-th:focus-visible,.sh-avm-sw:focus-visible{outline:2px solid var(--sh-brass);outline-offset:2px}
.sh-avm-disc{width:64px;height:64px;border-radius:50%;overflow:hidden;background:#171a26;display:block;box-shadow:inset 0 0 0 1.5px rgba(245,240,230,.55)}
.sh-avm-disc svg,.sh-avm-disc img{display:block;width:100%;height:100%;object-fit:cover}
.sh-avm-maker{border-top:1px solid var(--sh-line);padding-top:12px;margin-top:4px}
.sh-avm-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.sh-avm-tabs button{padding:6px 12px;border-radius:99px;border:1px solid var(--sh-line);background:transparent;color:var(--sh-cream);font:600 13px 'Barlow',sans-serif;cursor:pointer}
.sh-avm-tabs button.on{background:var(--sh-brass);border-color:var(--sh-brass);color:#1a1408}
.sh-avm-tabs .sh-avm-dice{margin-inline-start:auto}
.sh-avm-row{margin-bottom:12px}
.sh-avm-label{display:block;font:600 12px 'Barlow',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--sh-muted);margin-bottom:6px}
.sh-avm-opts{display:flex;flex-wrap:wrap;gap:6px}
.sh-avm-th{position:relative;width:52px;height:52px;padding:0;border-radius:10px;overflow:hidden;border:2px solid transparent;background:#171a26;cursor:pointer}
.sh-avm-th svg{display:block}
.sh-avm-th.on{border-color:var(--sh-brass)}
.sh-avm-none{position:absolute;right:2px;top:0;font:700 14px 'Barlow',sans-serif;color:var(--sh-cream);text-shadow:0 1px 2px #000}
.sh-avm-sw{width:30px;height:30px;border-radius:50%;border:2px solid rgba(245,240,230,.25);padding:0;cursor:pointer}
.sh-avm-sw.on{border-color:var(--sh-cream);box-shadow:0 0 0 2px var(--sh-brass)}
.sh-avm-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:6px}
.sh-avm-ok{color:var(--sh-green);font:600 14px 'Barlow',sans-serif}
@media (max-width:480px){.sh-avm-mode{min-width:0;flex:1 1 0;padding:8px 6px}.sh-avm-disc{width:52px;height:52px}.sh-avm-th{width:46px;height:46px}}
`;
