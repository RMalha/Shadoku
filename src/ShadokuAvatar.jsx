/**
 * ShadokuAvatar.jsx — the avatar maker, on the website's /profile (ShadokuPages.jsx ProfileInfo) and in the Android app's Profile
 * (app/src/screens/profile/AvatarPage.jsx, through `ext`).
 *
 * Three choices: S. H. Adow (the default), "your own agent" (a portrait from the avatar kit, AvatarFigure.jsx: skin, hair, hat,
 * glasses, clothes and backdrop, each option drawn as a small portrait; the eyes, brows and mouth are the suspects' kit's) or the
 * Google / GitHub account picture. Saving calls useAuth().setAvatar (src/auth.js → functions/api/avatar.js); the code format is
 * src/avatarLook.js with format v2's cosmetics (src/avatarCosmetics.js). Strings: ui.avatar.*, cosmetic names ui.cosmetic.<id>.
 *
 * COSMETICS (2026-11-25). The kit's options are free. The avatar cosmetics (hats, clothes, neckwear, glasses, accessories in the
 * Extras tab, scenes in the Backdrop tab) are offered when the account holds them, and drawn locked otherwise, with where they come
 * from (a tap says it). A held card shows its variant tier, and a Variant row picks among the tiers held. What is held comes from
 * GET /api/avatar (`cosmetics`) for a signed-in player of the site, or from `ext.held` in the app; what the saved avatar already
 * wears stays available (the server allows it too), so editing never strips it. The wayfarers and U. M. Bra's glasses are rewards.
 *
 * `ext` (optional, the app): the player and the save (`user`, `save(code)` → true once kept), the cosmetics held (`held`: { id:
 * [tiers] }), labels the site's locale lacks (`label(k, vars)` → string or undefined, k as in "title" / "tab.x" / "row.x"), a tap on
 * a locked option (`onLocked(key, v)`) and a node under the buttons (`note`). Kept from before: `fix`, `encode`, `decode`, `Figure`,
 * `owned`, `rows`, `options(key, list, L)`, `item(key, v, L)`, `change(L, key, v)`, `crop` (see the code).
 */
import React, { useEffect, useMemo, useState } from "react";
import { useLang, useAuth, AvatarArt, AVATAR_CROP } from "./ShadokuHome.jsx";
import {
  deriveLook, TOKEN_ZOOM, TOKEN_CY, TOKEN_SW, HAIR_META, hairList, hatList, genderOk, clothingOk,
  SKIN, HAIR_HEX, HAIR_COLORS, HAT_COLORS, FRAME_COLORS, CLOTH, ACCENTS, SUSPECT_COLORS,
  EYES, BROWS, MOUTHS, BEARDS, TIES, TIE_GENDER, GLASSES, CLOTHING,
} from "./ShadokuArt.jsx";
import { AvatarFigure } from "./AvatarFigure.jsx";
import { encodeLook, decodeLook, fixAvatarLook, avatarHatFits, avatarGlassesOptions, startingAvatarLook, isCos } from "./avatarLook.js";
import { COSMETICS, TIER_NAMES, TIER_SLOTS, cosmeticAt, hasVariants, wornCosmetics } from "./avatarCosmetics.js";

const idx = (list) => list.map((_, i) => i);
const FRAMES = idx(FRAME_COLORS).filter((i) => FRAME_COLORS.indexOf(FRAME_COLORS[i]) === i); // the palette repeats its first colour
const BEACH = new Set(["shirtless", "bikini"]); // beach wear stays on the beach

/** The rows of each tab: [look field, "thumb" | "swatch", options for the current look, the swatch colour of an option,
 *  the row's label key when it is not the field's own (a function of the look)]. */
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
    ["hat", "thumb", (L) => ["none", ...hatList(L.gender).filter((h) => avatarHatFits(h, L.hairStyle))]], // only hats the hair fits under
    ["hatC", "swatch", (L) => (L.hat === "none" ? [] : idx(HAT_COLORS)), (v) => HAT_COLORS[v]],
  ],
  glasses: [
    ["glassesStyle", "thumb", (L, owned = []) => avatarGlassesOptions(GLASSES.filter((g) => g !== "kurt" || L.gender === "f"), [L.glassesStyle, ...owned])],
    ["frameC", "swatch", (L) => (L.glasses ? FRAMES : []), (v) => FRAME_COLORS[v]],
  ],
  clothes: [
    ["clothing", "thumb", (L) => CLOTHING.filter((c) => !BEACH.has(c) && clothingOk(c, L.gender))],
    ["cloth", "swatch", () => idx(CLOTH), (v) => CLOTH[v]],
    ["tie", "thumb", (L) => TIES.filter((x) => x === "none" || genderOk(TIE_GENDER[x], L.gender))],
    // the accent colours the neckwear, or the T-shirt under an overall (an overall never has neckwear), so each has its own colour row
    ["accent", "swatch", (L) => (L.tie === "none" && L.clothing !== "overall" ? [] : idx(ACCENTS)), (v) => ACCENTS[v], (L) => (L.clothing === "overall" ? "tee" : "accent")],
  ],
  backdrop: [
    ["back", "swatch", () => SUSPECT_COLORS, (v) => v],
    ["bgArt", "thumb", () => ["none"]], // the scenes: cosmetics only (added below)
  ],
  extras: [
    ["acc", "thumb", () => ["none"]], // the accessories: cosmetics only
  ],
};
/** How each row's thumbnails are cropped: [zoom, centre y] in the 280×280 portrait. */
const CROP = { hairStyle: [1.05, 132], hat: [1.05, 128], clothing: [1, 168], tie: [1.3, 178], gender: [1.2, 132], bgArt: [1, 144], acc: [1, 150] };
/** A cosmetic's look field → the maker's row of it. The colour rows a cosmetic hides (the cosmetics are pictures, not tinted). */
const TINT_OF = { hatC: "hat", cloth: "clothing", frameC: "glassesStyle" };
const RARITY_ORDER = ["common", "rare", "epic", "legendary", "unique"];

/** The look with one field changed, kept consistent (hair length follows the style, glasses follow their style). */
function withField(L, key, v, ext = null) {
  let o = { ...L, [key]: v };
  if (key === "hairStyle") o.hairLength = v === "bald" ? "bald" : (HAIR_META[v] || [])[1] || "short";
  if (key === "hairStyle" && v !== "bald" && (!o.hairColor || o.hairColor === "none")) o.hairColor = "brown";
  if (key === "glassesStyle") o.glasses = v !== "none";
  if (key === "back") o.bgArt = "none"; // a colour replaces the scene
  if (ext && ext.change) o = ext.change(o, key, v);
  return ((ext && ext.fix) || fixAvatarLook)(o); // a hair the hat does not fit takes the hat off
}
// `owned` and `fix` come from the maker's optional `ext` (the site passes neither: the site's own starting look)
const firstLook = (name, owned = [], fix = null) => { const L = startingAvatarLook(deriveLook(name || "Agent", "A", "avatar", {}), owned); return fix ? fix(L) : L; };
function randomLook(owned = [], fix = null) {
  const L = deriveLook(Math.random().toString(36).slice(2), "A", "avatar", {});
  const o = startingAvatarLook({ ...L, clothing: BEACH.has(L.clothing) ? "shirtCrewNeck" : L.clothing, back: SUSPECT_COLORS[Math.floor(Math.random() * SUSPECT_COLORS.length)] }, owned);
  return fix ? fix(o) : o;
}

function Portrait({ look, crop, Figure = AvatarFigure }) {
  const [zoom, cy] = crop || [TOKEN_ZOOM, TOKEN_CY];
  return (
    <svg viewBox="0 0 96 96" width="100%" height="100%" aria-hidden="true" focusable="false">
      <rect width="96" height="96" fill={look.back} /><Figure look={look} zoom={zoom} cy={cy} sw={TOKEN_SW} />
    </svg>
  );
}
const Padlock = () => (
  <span className="sh-avm-lock" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>
  </span>
);

/** What the site's signed-in player holds: GET /api/avatar's `cosmetics` ({ id: [tiers] }), or {} while unknown. */
function useSiteHeld(active, id) {
  const [held, setHeld] = useState(null);
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    fetch("/api/avatar", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null)).then((b) => { if (live && b && b.cosmetics && typeof b.cosmetics === "object") setHeld(b.cosmetics); })
      .catch(() => {});
    return () => { live = false; };
  }, [active, id]);
  return held;
}

export function AvatarMaker({ ext = null } = {}) {
  const { t } = useLang();
  const auth = useAuth();
  const user = ext ? ext.user : auth.user;
  const setAvatar = ext ? ext.save : auth.setAvatar;
  const siteHeld = useSiteHeld(!ext && !!user && !user.demo, user && user.id);
  const held = (ext ? ext.held : siteHeld) || {};
  const extFix = (ext && ext.fix) || null, fix = extFix || fixAvatarLook, decode = (ext && ext.decode) || decodeLook, encode = (ext && ext.encode) || encodeLook;
  const owned = [...((ext && ext.owned) || []), ...((held["glasses-wayfarers"] || []).length ? ["wayfarers"] : [])];
  const Figure = (ext && ext.Figure) || AvatarFigure;
  const lab = (k, vars) => (ext && ext.label && ext.label(k, vars)) || t(`avatar.${k}`, vars);
  const tabs = ext && ext.rows ? { ...TABS, ...Object.fromEntries(Object.entries(ext.rows).map(([k, rows]) => [k, [...(TABS[k] || []), ...rows]])) } : TABS;
  const saved = (user && user.avatar) || "";
  const savedMode = saved === "photo" ? "photo" : saved.startsWith("L:") ? "custom" : "adow";
  const [mode, setMode] = useState(savedMode);
  const [look, setLook] = useState(() => decode(saved) || firstLook(user && user.username, owned, extFix));
  const [tab, setTab] = useState("face");
  const [status, setStatus] = useState(null); // "saving" | "saved" | "error"
  const [note, setNote] = useState(""); // why a locked option is locked
  const L = useMemo(() => fix(look), [look, fix]);
  if (!user) return null;

  /* ── the cosmetics: held, kept (worn by the saved avatar), locked ── */
  const kept = new Map(wornCosmetics(saved).map((w) => [w.id, w.tier]));
  const tiersOf = (c) => { const h = Array.isArray(held[c.id]) ? held[c.id].filter((x) => Number.isInteger(x) && x >= 0 && x <= 4) : []; return kept.has(c.id) && !h.includes(kept.get(c.id)) ? [...h, kept.get(c.id)] : h; };
  const has = (c) => tiersOf(c).length > 0;
  const rarity = (c) => t(`avatar.rarity.${c.rarity}`);
  const nameOf = (c) => t(`cosmetic.${c.id}`);
  const lockText = (c) => (c.source === "ach"
    ? t("avatar.lock.ach", { name: nameOf(c), ach: t(`avatar.ach.${c.ach}`) })
    : t(c.source === "daily" ? "avatar.lock.daily" : "avatar.lock.card", { name: nameOf(c), rarity: rarity(c) }));
  const cosmeticsFor = (slot) => COSMETICS.filter((c) => c.field === slot && (slot !== "hat" || avatarHatFits(c.value, L.hairStyle)))
    .sort((a, b) => (has(b) - has(a)) || RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)).map((c) => c.value);
  const addCos = (key, list) => {
    if (TINT_OF[key]) return isCos(TINT_OF[key], L[TINT_OF[key]]) ? [] : list;
    if (key === "accent") return isCos("tie", L.tie) && L.clothing !== "overall" ? [] : list;
    if (!TIER_SLOTS.includes(key)) return list;
    const base = key === "glassesStyle" ? list.filter((g) => g !== "round" || L.glassesStyle === "round") : list; // the round glasses are U. M. Bra's: shown as "umbra"
    return [...base, ...cosmeticsFor(key).filter((v) => !base.includes(v))];
  };
  const decoOf = (key, v) => {
    if (ext && ext.item) { const d = ext.item(key, v, L); if (d !== undefined) return d; }
    const c = TIER_SLOTS.includes(key) ? cosmeticAt(key, v) : null;
    if (!c) return null;
    if (!has(c)) return { locked: true, cls: `is-locked rar-${c.rarity}`, label: lockText(c), badge: <Padlock /> };
    const tier = TIER_NAMES[Math.max(...tiersOf(c))];
    const label = c.source === "ach" ? t("avatar.rewardLabel", { name: nameOf(c) })
      : tier ? t("avatar.cardTierLabel", { name: nameOf(c), rarity: rarity(c), tier: t(`avatar.tier.${tier}`) }) : t("avatar.cardLabel", { name: nameOf(c), rarity: rarity(c) });
    return { cls: `rar-${c.rarity}`, label, badge: tier ? <span className={`sh-avm-tier t-${tier}`} aria-hidden="true">{t(`avatar.tier.${tier}`)}</span> : null };
  };
  /** Picking an option: a cosmetic is worn in the best tier held. */
  const take = (key, v) => {
    let o = withField(L, key, v, ext);
    const c = TIER_SLOTS.includes(key) ? cosmeticAt(key, v) : null;
    if (TIER_SLOTS.includes(key)) o = fix({ ...o, tiers: { ...o.tiers, [key]: c && hasVariants(c) ? Math.max(0, ...tiersOf(c)) : 0 } });
    return o;
  };
  const variantsOf = (slot) => { const c = cosmeticAt(slot, L[slot]); return c && hasVariants(c) && has(c) ? [...new Set([...tiersOf(c), L.tiers[slot] || 0])].sort() : []; };

  const choice = mode === "photo" ? "photo" : mode === "custom" ? encode(L) : "";
  const dirty = choice !== saved;
  const pick = (next) => { setStatus(null); setNote(""); setLook(next); };
  const choose = (m) => { setStatus(null); setMode(m); };
  const reset = () => { setStatus(null); setNote(""); setMode(savedMode); setLook(decode(saved) || firstLook(user.username, owned, extFix)); };
  const save = async () => {
    setStatus("saving");
    setStatus((await setAvatar(choice)) ? "saved" : "error");
  };
  const modes = [
    ["adow", t("avatar.adow"), <AvatarArt key="a" code="" />],
    ["custom", t("avatar.custom"), <Portrait key="c" look={L} crop={AVATAR_CROP} Figure={Figure} />],
    ...(user.avatarUrl ? [["photo", t("avatar.photo"), <img key="p" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />]] : []),
  ];
  /** The Variant row under a worn cosmetic held in more than one tier. */
  const variantRow = (slot) => {
    const tiers = variantsOf(slot);
    if (tiers.length < 2) return null;
    return (
      <div key={`${slot}-tier`} className="sh-avm-row">
        <span className="sh-avm-label">{lab("row.variant")}</span>
        <div className="sh-avm-opts tiers" role="group" aria-label={lab("row.variant")}>
          {tiers.map((n) => {
            const name = TIER_NAMES[n] || "card", on = (L.tiers[slot] || 0) === n;
            return <button key={n} type="button" className={`sh-avm-tierbtn t-${name}${on ? " on" : ""}`} aria-pressed={on} onClick={() => pick(fix({ ...L, tiers: { ...L.tiers, [slot]: n } }))}>{t(`avatar.tier.${name}`)}</button>;
          })}
        </div>
      </div>
    );
  };
  return (
    <section className="sh-pcard sh-avm" aria-labelledby="sh-avm-h">
      <style data-shadoku="avatar">{AVATAR_CSS}</style>
      <h2 id="sh-avm-h" className="sh-type">{lab("title")}</h2>
      <p className="sh-muted sm">{lab("lead")}</p>
      <div className="sh-avm-modes" role="radiogroup" aria-label={t("avatar.title")}>
        {modes.map(([m, label, art]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={`sh-avm-mode${mode === m ? " on" : ""}`} onClick={() => choose(m)}>
            <span className={`sh-avm-disc${m === "adow" ? " adow" : ""}`}>{art}</span><span>{label}</span>
          </button>
        ))}
      </div>
      {mode === "photo" && <p className="sh-muted sm">{t("avatar.photoNote")}</p>}
      {mode === "custom" && (
        <div className="sh-avm-maker">
          {/* the look being made, large and in sight while the options scroll */}
          <div className="sh-avm-big" aria-hidden="true"><span className="sh-avm-disc"><Portrait look={L} crop={AVATAR_CROP} Figure={Figure} /></span></div>
          <div className="sh-avm-edit">
          <div className="sh-avm-tabs" role="tablist" aria-label={t("avatar.custom")}>
            {Object.keys(tabs).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{lab(`tab.${k}`)}</button>
            ))}
            <button type="button" className="sh-avm-dice" onClick={() => pick(randomLook(owned, extFix))}>🎲 {t("avatar.random")}</button>
          </div>
          <div className="sh-avm-rows" role="tabpanel">
            {(tabs[tab] || []).flatMap(([key, kind, optionsOf, colorOf, labelOf]) => {
              const own = addCos(key, optionsOf(L, owned));
              const opts = ext && ext.options ? ext.options(key, own, L) : own;
              const variants = TIER_SLOTS.includes(key) ? variantRow(key) : null;
              if (!opts.length) return [];
              return [(
                <div key={key} className="sh-avm-row">
                  <span className="sh-avm-label">{lab(`row.${labelOf ? labelOf(L) : key}`)}</span>
                  <div className={`sh-avm-opts ${kind}`}>
                    {opts.map((v, i) => {
                      const on = L[key] === v;
                      const deco = decoOf(key, v);
                      const label = deco && deco.label ? deco.label : key === "gender" ? t(`avatar.gender.${v}`) : v === "none" ? t("avatar.none") : t(kind === "swatch" ? "avatar.colour" : "avatar.option", { n: i + 1 });
                      const tap = () => {
                        if (!(deco && deco.locked)) { pick(take(key, v)); return; }
                        setNote(label);
                        if (ext && ext.onLocked) ext.onLocked(key, v);
                      };
                      return kind === "swatch"
                        ? <button key={String(v)} type="button" className={`sh-avm-sw${on ? " on" : ""}`} style={{ background: colorOf(v) }} aria-pressed={on} aria-label={label} title={label} onClick={tap} />
                        : (
                          <button key={String(v)} type="button" className={`sh-avm-th${on ? " on" : ""}${deco && deco.cls ? ` ${deco.cls}` : ""}`} aria-pressed={on} aria-disabled={deco && deco.locked ? true : undefined} aria-label={label} title={label} onClick={tap}>
                            <Portrait look={key === "hairStyle" ? withField({ ...L, hat: "none" }, key, v, ext) : take(key, v)} crop={CROP[key] || (ext && ext.crop && ext.crop[key])} Figure={Figure} />
                            {v === "none" && <span className="sh-avm-none" aria-hidden="true">∅</span>}
                            {deco && deco.badge}
                          </button>
                        );
                    })}
                  </div>
                </div>
              ), ...(variants ? [variants] : [])];
            })}
          </div>
          </div>
        </div>
      )}
      <div className="sh-avm-actions">
        <button type="button" className="sh-btn sm" disabled={!dirty || status === "saving"} onClick={save}>{t(status === "saving" ? "avatar.saving" : "avatar.save")}</button>
        {dirty && status !== "saving" && <button type="button" className="sh-btn ghost sm" onClick={reset}>{t("avatar.reset")}</button>}
        {status === "saved" && !dirty && <span className="sh-avm-ok" role="status">✓ {t("avatar.saved")}</span>}
        {status === "error" && <span className="sh-err sm" role="alert">{t("avatar.error")}</span>}
      </div>
      <div className="sh-avm-notes" aria-live="polite">
        {note && <p className="sh-avm-note">{note}{!ext && <> {t("avatar.lock.app")}</>}</p>}
      </div>
      {ext && ext.note}
    </section>
  );
}

const AVATAR_CSS = `
.sh-avm-modes{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}
.sh-avm-mode{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:104px;padding:10px 12px;border-radius:12px;border:1px solid var(--sh-line);background:#1a1a23;color:var(--sh-cream);font:600 13px 'Barlow',sans-serif;cursor:pointer}
.sh-avm-mode.on{border-color:var(--sh-brass);box-shadow:0 0 0 1px var(--sh-brass) inset;background:rgba(217,155,38,.08)}
.sh-avm-mode:focus-visible,.sh-avm-tabs button:focus-visible,.sh-avm-th:focus-visible,.sh-avm-sw:focus-visible{outline:2px solid var(--sh-brass);outline-offset:2px}
.sh-avm-disc{box-sizing:border-box;height:150px;aspect-ratio:112/142;display:flex;flex-direction:column;align-items:center;background:#f5f0e6;border:1px solid #d8cfb8;border-radius:2px;box-shadow:1px 2px 4px rgba(0,0,0,.45);transform:rotate(-2deg)}
.sh-avm-disc.adow{background:#2a2a33;border-color:#3b3b47}
.sh-avm-disc svg,.sh-avm-disc img{display:block;width:86%;height:auto;aspect-ratio:1;margin-top:7%;object-fit:cover;background:#171a26}
.sh-avm-maker{display:grid;grid-template-columns:minmax(200px,260px) minmax(0,1fr);gap:24px;align-items:start;border-top:1px solid var(--sh-line);padding-top:16px;margin-top:4px}
.sh-avm-big{position:sticky;top:16px;display:flex;justify-content:center;padding:8px 0}
.sh-avm-big .sh-avm-disc{height:auto;width:100%;max-width:240px}
.sh-avm-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.sh-avm-tabs button{padding:6px 12px;border-radius:99px;border:1px solid var(--sh-line);background:transparent;color:var(--sh-cream);font:600 13px 'Barlow',sans-serif;cursor:pointer}
.sh-avm-tabs button.on{background:var(--sh-brass);border-color:var(--sh-brass);color:#1a1408}
.sh-avm-tabs .sh-avm-dice{margin-inline-start:auto}
.sh-avm-row{margin-bottom:12px}
.sh-avm-label{display:block;font:600 12px 'Barlow',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--sh-muted);margin-bottom:6px}
.sh-avm-opts{display:flex;flex-wrap:wrap;gap:6px}
.sh-avm-th{position:relative;width:72px;height:72px;padding:0;border-radius:10px;overflow:hidden;border:2px solid transparent;background:#171a26;cursor:pointer}
.sh-avm-th svg{display:block}
.sh-avm-th.on{border-color:var(--sh-brass)}
.sh-avm-none{position:absolute;right:2px;top:0;font:700 14px 'Barlow',sans-serif;color:var(--sh-cream);text-shadow:0 1px 2px #000}
.sh-avm-sw{width:38px;height:38px;border-radius:50%;border:2px solid rgba(245,240,230,.25);padding:0;cursor:pointer}
.sh-avm-sw.on{border-color:var(--sh-cream);box-shadow:0 0 0 2px var(--sh-brass)}
.sh-avm-th.is-locked>svg{opacity:.62;filter:grayscale(.75) brightness(.9)}
.sh-avm-lock{position:absolute;top:3px;inset-inline-end:3px;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:rgba(12,12,16,.78);color:#f5f0e6}
.sh-avm-th[class*="rar-"]::after{content:"";position:absolute;inset-inline:0;bottom:0;height:4px;background:var(--rar,transparent)}
.sh-avm-th.rar-common{--rar:#b8b3a7}.sh-avm-th.rar-rare{--rar:#5aa2e6}.sh-avm-th.rar-epic{--rar:#b077e8}.sh-avm-th.rar-legendary{--rar:#ffc928}.sh-avm-th.rar-unique{--rar:#c83e3b}
.sh-avm-tier{position:absolute;bottom:6px;inset-inline-start:3px;max-width:calc(100% - 6px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 4px;border-radius:4px;font:700 9px/1 'Barlow',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#1a1408;box-shadow:0 1px 2px rgba(0,0,0,.5)}
.sh-avm-tier.t-bronze,.sh-avm-tierbtn.t-bronze.on{background:#b46f33}.sh-avm-tier.t-silver,.sh-avm-tierbtn.t-silver.on{background:#c9d3dc}.sh-avm-tier.t-gold,.sh-avm-tierbtn.t-gold.on{background:#ffd24a}
.sh-avm-tier.t-shadow,.sh-avm-tierbtn.t-shadow.on{background:#3a2a68;color:#e6dcff;box-shadow:0 0 0 1px #9b6cff}
.sh-avm-opts.tiers{gap:8px}
.sh-avm-tierbtn{min-height:40px;padding:0 14px;border-radius:99px;border:2px solid var(--sh-line);background:transparent;color:var(--sh-cream);font:700 13px 'Barlow',sans-serif;cursor:pointer}
.sh-avm-tierbtn.on{border-color:var(--sh-brass);color:#1a1408;background:var(--sh-cream)}
.sh-avm-tierbtn:focus-visible{outline:2px solid var(--sh-brass);outline-offset:2px}
.sh-avm-note{margin:10px 0 0;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.06);font:500 13px/1.4 'Barlow',sans-serif;color:var(--sh-cream)}
.sh-avm-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:6px}
.sh-avm-ok{color:var(--sh-green);font:600 14px 'Barlow',sans-serif}
@media (max-width:720px){.sh-avm-maker{grid-template-columns:1fr;gap:12px}.sh-avm-big{position:static;padding:0}.sh-avm-big .sh-avm-disc{max-width:200px}}
@media (max-width:480px){.sh-avm-mode{min-width:0;flex:1 1 0;padding:8px 6px}.sh-avm-disc{height:120px}.sh-avm-th{width:58px;height:58px}.sh-avm-big .sh-avm-disc{max-width:170px}}
`;
