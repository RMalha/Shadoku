/* eslint-disable react/prop-types */
/**
 * ShadokuHome.jsx — shadoku.net landing page + shared site chrome.
 *
 * Exports
 *   default  ShadokuHome            the homepage (wraps itself in providers if none exist)
 *   ShadokuProviders                language + auth + modal host + navigation (ShadokuApp wraps everything in this; `onNav` = its router)
 *   LanguageSelector, UserPill, Modal, GlobalStyles, SiteHeader, SiteFooter, AuthButtons, Avatar
 *   useLang / useAuth / useModals / useNav   hooks (useNav() → navigate(to): "/", "/play", "/about", "/contact", "/profile[/stats|/collection]")
 *   LANGUAGES, STRINGS, registerTranslations(code, dict), translate(lang, key, vars)   i18n
 *   store, pushPath                 tiny helpers shared with ShadokuApp
 *
 * ──────────────────────────────────────────────────────────────────────
 *  ART ADAPTER  (the only place that knows the game's data / prop shapes)
 * ──────────────────────────────────────────────────────────────────────
 *  From "./ShadokuGame.jsx":  Board, BZ, buildGeometry, ShadokuLogo, PUZZLES, GAME_CSS
 *  From "./ShadokuArt.jsx":   AdowPolaroid, SuspectPolaroid, getCastForPuzzle, BRASS, SUSPECT_COLORS, CELL
 *
 *  The showcases are the real <Board> in read-only mode: no handlers, wrapped in `inert`.
 *  castFor(p) mirrors what the game does (getCastForPuzzle → buildGeometry → colorOf), so the homepage
 *  shows exactly the portraits, props and lighting the player will meet on /play.
 *  Every live art component sits inside an error boundary, so a mismatch shows a
 *  noir placeholder instead of white-screening the homepage.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { Board, BZ, buildGeometry, ShadokuLogo, PUZZLES, GAME_CSS, readBestTimes, fmtTime } from "./ShadokuGame.jsx";
import { AdowPolaroid, AssassinPolaroid, SuspectPolaroid, VictimPolaroid, UninvitedSigil, victimNameOf, hash, getCastForPuzzle, BRASS, SUSPECT_COLORS, CELL, LABEL } from "./ShadokuArt.jsx";
import { LOCALES, LOCALE_CODES, localeKey, codeKey, TextContext } from "./i18n.js";
import { localizeHead, trOf } from "./caseText.js";

/* ═════════════════════════════ CONSTANTS ═════════════════════════════ */
export const CONTACT_EMAIL = "shadoku.game@proton.me";
export const MURDOKU_URL = "https://murdoku.com";
const LANG_KEY = "shadoku-lang";
const USER_KEY = "shadoku-user";
export const TUTORIAL_KEY = "shadoku-tutorial-done"; // set once the initiation is solved or skipped (ShadokuApp re-exports it)
const ENVELOPE_MS = 850;

const BASE_LANGUAGES = [
  { code: "ca", label: "Català" },
  { code: "cs", label: "Čeština" },
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
  { code: "hu", label: "Magyar" },
  { code: "nl", label: "Nederlands" },
  { code: "pl", label: "Polski" },
  { code: "pt", label: "Português" },
  { code: "pt-PT", label: "Português" },
  { code: "ro", label: "Română" },
  { code: "fi", label: "Suomi" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "tr", label: "Türkçe" },
  { code: "el", label: "Ελληνικά" },
  { code: "ru", label: "Русский" },
  { code: "uk", label: "Українська" },
  { code: "ar", label: "العربية", dir: "rtl" },
  { code: "ko", label: "한국어" },
  { code: "ja", label: "日本語" },
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
];
const RTL = new Set(["ar", "he", "fa", "ur", "ps", "yi"]);
const nativeName = (code) => {
  try {
    const n = new Intl.DisplayNames([code], { type: "language", languageDisplay: "standard" }).of(code);
    return n && n !== code ? n.charAt(0).toLocaleUpperCase(code) + n.slice(1) : code;
  } catch { return code; }
};
/** The picker: one entry per src/locales/<code>.json (a language without a file would silently stay English, so it is not offered).
 *  Names come from the list above, else from Intl (e.g. pt-PT, listed right after pt). A file whose name is not a language code is ignored. */
const LOCALE_CODE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
export const LANGUAGES = (() => {
  const has = new Set(LOCALE_CODES);
  const out = BASE_LANGUAGES.filter((l) => l.code === "en" || has.has(l.code));
  LOCALE_CODES.filter((code) => LOCALE_CODE_RE.test(code) && !out.some((l) => l.code === code)).forEach((code) => {
    const base = code.split("-")[0];
    const entry = { code, label: nativeName(code), ...(RTL.has(base) ? { dir: "rtl" } : {}) };
    let at = -1;
    out.forEach((l, i) => { if (l.code.split("-")[0] === base) at = i; });
    if (at < 0) out.push(entry); else out.splice(at + 1, 0, entry);
  });
  return out;
})();

/* ═════════════════════════════ STORAGE ═════════════════════════════ */
const memStore = {};
export const store = {
  get(k) { try { return window.localStorage.getItem(k); } catch { return k in memStore ? memStore[k] : null; } },
  set(k, v) { memStore[k] = v; try { window.localStorage.setItem(k, v); } catch { /* private mode / sandbox */ } },
  del(k) { delete memStore[k]; try { window.localStorage.removeItem(k); } catch { /* noop */ } },
};

/** pushState that never throws (sandboxed preview iframes forbid it). */
export function pushPath(path) {
  try { window.history.pushState({}, "", path); return true; } catch { return false; }
}

/* ═════════════════════════════ i18n ═════════════════════════════
 * Translations live in src/locales/<lang>.json (flat dotted keys, see ./i18n.js); en.json is the English reference.
 * A key resolves: the current locale file → registerTranslations(lang) → en.json → the in-code English below → the key.
 * UI keys are written here without their "ui." prefix (t("nav.signIn") reads "ui.nav.signIn" from the locale files;
 * t("ui.nav.signIn") works too); generated engine keys (LORE.*, PROP.*, CLUE…) are used as they are.
 * registerTranslations("fr", { "nav.signIn": "Connexion", … }) still works (or assigning STRINGS.fr = {…}).
 * Paragraph lists are numbered keys (ui.lore.s1.1, ui.lore.s1.2 …). Inline markup: **bold**, [[murdoku]], [[email]].
 * en.json holds every key, including all the keys added after this table; the table is only the last-resort English for the original ones.
 */
export const STRINGS = {
  en: {
    "nav.language": "Language",
    "nav.signIn": "Sign In",
    "nav.signOut": "Sign Out",
    "nav.menu": "Menu",
    "nav.pHome": "Home",
    "nav.pContracts": "Contracts",
    "nav.pInitiation": "Initiation",
    "nav.about": "About",
    "nav.contact": "Contact",
    "nav.home": "← Home",
    "nav.help": "Help",

    "hero.eyebrow": "Shadoku · The Blindspot Murder Mystery",
    "hero.title": "The Inspectors Had It All Wrong",
    "hero.read": "Read the briefing",
    "hero.skip": "Skip to the envelope",

    "lore.s1.1": "You played the detective. You analyzed the grid. You cornered the suspects, presented your flawless logic, and patted yourself on the back when the authorities hauled them away. But did you ever wonder why the evidence always felt a little too perfect?",
    "lore.s1.2": "Those bumbling fools you locked up in [[murdoku]] weren't the masterminds. They were scapegoats. The real architects of demise were never on the grid at all—they were standing right in the cracks of your logic, watching you from the dark.",
    "lore.s1.3": "**Welcome to Shadoku.**",
    "lore.s2.1": "You are S. H. Adow, a promising initiate in the world's most elite, unseen syndicate. The deed is already done, the corpse is growing cold, and the panicked suspects are frantically scanning the room. Your task is not to solve the murder. Your task is to vanish.",
    "lore.s3.1": "Forget the old rules. There is no neat and tidy law dictating a single suspect per row or column. This is a real crime scene, bounded by rigid walls, open doors, and towering obstacles. The suspects are looking everywhere—their gazes sweeping relentlessly in straight lines, passing over rugs, beds, and even the body of the victim itself. But they are flawed, and their panic creates a singular, mathematical inevitability: a blind spot.",
    "lore.s3.2": "When every suspect is placed, one single tile remains unseen by every eye in the room. Find it, step into the shadows, and leave the scapegoats to the inspectors.",

    "show1.caption": "Every suspect has an alibi. S. H. Adow only needs a blind spot.",
    "show1.tag": "Exhibit A · The Study",
    "show2.caption": "Orthogonal sightlines sweep across 7 biomes—blocked by walls and tall obstacles, passing through open doors.",
    "show2.tag": "Exhibit B · Sightlines",
    "show2.left": "Beach cove",
    "show2.right": "Street courtyard",
    "show3.caption": "Every eye in the room, and still one tile no one can see. That is where you vanish.",
    "show3.tag": "Exhibit C · The Blind Spot",
    "show.live": "LIVE",
    "show.adow": "S. H. Adow",

    "creds.title": "Syndicate Credentials",
    "creds.sub": "Play instantly with no account. Sign in only if you want your progress to follow you across devices.",
    "creds.signedIn": "Credentials verified",
    "creds.codename": "Codename",
    "creds.change": "Change codename",
    "creds.demo": "Demo session — no real account was created.",
    "creds.error": "Sign-in failed. Please try again.",
    "creds.delete": "Delete account",
    "creds.deleteConfirm": "Delete your account? Your codename and the data saved for your account are erased and this cannot be undone.",
    "creds.deleteError": "The account could not be deleted. Please try again.",

    "auth.title": "Join the Syndicate",
    "auth.google": "Continue with Google",
    "auth.github": "Continue with GitHub",
    "auth.consentPre": "By signing in with Google or GitHub, you agree to our ",
    "auth.consentLink": "Terms of Use & Privacy Policy",
    "auth.consentPost": ".",
    "auth.working": "Working…",

    "codename.title": "Choose Your Syndicate Codename",
    "codename.help": "3–20 characters: letters, numbers and underscores. Your codename is how the Syndicate knows you.",
    "codename.label": "Codename",
    "codename.reroll": "Reroll",
    "codename.ok": "✓ Codename available",
    "codename.taken": "✕ Already taken",
    "codename.format": "✕ 3–20 characters: letters, numbers, underscore",
    "codename.checking": "Checking…",
    "codename.save": "Save codename",
    "codename.cancel": "Keep current",

    "env.prompt": "Click to break the seal & open the contract",
    "env.stamp1": "CONFIDENTIAL —",
    "env.stamp2": "FOR INITIATE EYES ONLY",
    "env.cue": "The Envelope",
    "env.aria": "Break the seal and open the contract",
    "env.accept": "Accept the contract",
    "env.pick": "Pick a contract",
    "env.start": "Start Initiation",
    "env.replay": "Replay Initiation",
    "env.reopen": "Open the contract",
    "env.fulfilled": "FULFILLED",
    "env.best": "BEST TIME",
    "env.pickNote": "Your contracts are waiting. Tap the card to choose one.",
    "env.acceptNote": "Master U. M. Bra is waiting. Tap the contract to begin your initiation.",
    "env.caseFile": "INITIATION CONTRACT № 000",
    "env.initiate": "INITIATE: S. H. ADOW",
    "env.status": "STATUS: AWAITING YOUR SIGNATURE",

    "homage.title": "An Homage to Murdoku",
    "homage.text": "Shadoku is an independent fan-made homage inspired by **[[murdoku]]**. Special thanks to **Manuel Garand** for creating Murdoku and inspiring detectives everywhere.",

    "footer.copyright": "© 2026 Shadoku · R.M. Malha",
    "footer.social": "Social media",
    "footer.legal": "Terms & Privacy",
    "modal.close": "Close",

    /* Prop Inspector (the badge shown when a prop or the corpse is hovered / tapped on the board) */
    "propInspector.tallTag": "Tall Prop",
    "propInspector.perchTag": "Perch Prop",
    "propInspector.shortTag": "Short Prop",
    "propInspector.lowTag": "Low Prop",
    "propInspector.tallRule": "Blocks sightlines · Cannot be occupied",
    "propInspector.perchRule": "Blocks sightlines · Can be occupied · Whoever is on it is seen",
    "propInspector.shortRule": "Sightlines pass over · Cannot be occupied",
    "propInspector.lowRule": "Sightlines pass over · Can be occupied",
    "propInspector.corpseRule": "Cannot be occupied · Does not block sight",

    /* Prop names, one key per prop: "prop.SAFE", "prop.TEA_SET" … (English gold standard = ShadokuArt's LABEL, all 94 props + the corpse).
       A translation only needs to register the keys it translates: registerTranslations("fr", { "prop.SAFE": "Coffre-fort", … }). */
    ...Object.fromEntries(Object.entries(LABEL).map(([kind, name]) => [`prop.${kind}`, name])),
  },
};

export function registerTranslations(code, dict) {
  STRINGS[code] = { ...(STRINGS[code] || {}), ...dict };
}

/** The text of `key` in `lang` (no React needed): locale file → registerTranslations(lang) → en.json → in-code English → key. `{name}` placeholders are filled from `vars`. */
export function translate(lang, key, vars) {
  const lk = localeKey(String(key)), ck = codeKey(String(key));
  const raw = LOCALES[lang]?.[lk] ?? (lang !== "en" ? STRINGS[lang]?.[ck] : undefined) ?? LOCALES.en?.[lk] ?? STRINGS.en[ck] ?? key;
  if (!vars) return raw;
  return String(raw).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
}

/* ═════════════════════════════ CONTEXTS ═════════════════════════════ */
const LangCtx = createContext(null);
const AuthCtx = createContext(null);
const ModalsCtx = createContext(null);
const NavCtx = createContext(null);

export const useLang = () => {
  const v = useContext(LangCtx);
  if (!v) throw new Error("useLang must be used inside <ShadokuProviders>");
  return v;
};
export const useAuth = () => {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth must be used inside <ShadokuProviders>");
  return v;
};
export const useModals = () => {
  const v = useContext(ModalsCtx);
  if (!v) throw new Error("useModals must be used inside <ShadokuProviders>");
  return v;
};

function LangProvider({ children }) {
  const [lang, setLang] = useState(() => {
    const saved = store.get(LANG_KEY);
    return LANGUAGES.some((l) => l.code === saved) ? saved : "en";
  });
  const meta = LANGUAGES.find((l) => l.code === lang) || LANGUAGES.find((l) => l.code === "en");

  useEffect(() => {
    store.set(LANG_KEY, lang);
    try {
      document.documentElement.lang = lang;
      document.documentElement.dir = meta.dir || "ltr";
    } catch { /* SSR */ }
  }, [lang, meta.dir]);

  const t = useCallback((key, vars) => translate(lang, key, vars), [lang]);

  const value = useMemo(() => ({ lang, setLang, t, dir: meta.dir || "ltr" }), [lang, t, meta.dir]);
  return <LangCtx.Provider value={value}><TextContext.Provider value={t}>{children}</TextContext.Provider></LangCtx.Provider>;
}

/* ═════════════════════════ AUTH + CODENAMES ═════════════════════════ */
const NOIR_A = ["Shadow", "Blindspot", "Silent", "Velvet", "Crimson", "Midnight", "Brass", "Hollow", "Quiet", "Ashen", "Ivory", "Veiled", "Gilded", "Ghost", "Cipher", "Nocturne"];
const NOIR_B = ["Initiate", "Agent", "Rook", "Phantom", "Fedora", "Locksmith", "Operative", "Raven", "Sleeper", "Alibi", "Courier", "Specter", "Whisper", "Cloak", "Vesper", "Mask"];
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const RESERVED = ["admin", "administrator", "moderator", "support", "root", "system", "shadoku", "shadow", "adow", "sh_adow", "murdoku", "inspector", "detective", "staff", "official"];
const DEMO_TAKEN = ["ShadowInitiate_402", "BlindspotAgent_89", "SilentRook_17", "VelvetPhantom_64"];

export function randomAlias() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  for (let i = 0; i < 20; i++) {
    const alias = `${pick(NOIR_A)}${pick(NOIR_B)}_${10 + Math.floor(Math.random() * 490)}`;
    if (alias.length <= 20 && !isTakenLocal(alias)) return alias;
  }
  return `Initiate_${Date.now() % 100000}`;
}
function isTakenLocal(name) {
  const n = name.toLowerCase();
  return RESERVED.includes(n) || DEMO_TAKEN.some((x) => x.toLowerCase() === n);
}
function demoProfile(provider) {
  return provider === "google"
    ? { displayName: "Demo Detective", email: "demo.detective@example.com", avatarUrl: "" }
    : { displayName: "demo-octocat", email: "demo-octocat@users.noreply.github.com", avatarUrl: "" };
}

/**
 * Auth hooks you can wire up later:
 *   onSignIn(provider: "google" | "github")  → Promise<{ displayName, email, avatarUrl, username? } | void>
 *       Return a profile from your OAuth backend (Cloudflare Pages Function / Firebase / Supabase).
 *       If it returns nothing (or isn't provided) a local DEMO session is created.
 *       If the profile has no `username`, a random noir alias is assigned and the codename picker opens.
 *   onCheckUsername(name) → Promise<boolean | { ok } | { available }>   server-side uniqueness check
 *   onUsernameChange(name) → called after the player saves a codename (persist it server-side)
 *   onSession()  → Promise<profile | null | undefined>   on load: the signed-in profile (with its `id`), null when the
 *       backend says nobody is signed in (a stored non-demo session is dropped), undefined when there is no backend
 *   onSignOut()  → called on log out        onDeleteAccount() → Promise<boolean>   erase the account server-side
 *   (src/auth.js implements all of them against functions/api/*; onCheckUsername may return undefined = check locally)
 */
function AuthProvider({ children, onSignIn, onCheckUsername, onUsernameChange, onSession, onSignOut, onDeleteAccount, authError }) {
  const [user, setUser] = useState(() => {
    try { const raw = store.get(USER_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [authFailed, setAuthFailed] = useState(!!authError); // the provider sent the player back with ?auth_error=…
  const [pendingCodename, setPendingCodename] = useState(false); // a session restored after the OAuth redirect that has no codename yet
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  const persist = useCallback((u) => { if (u) store.set(USER_KEY, JSON.stringify(u)); else store.del(USER_KEY); }, []);

  const signIn = useCallback(async (provider) => {
    setBusy(provider); setError(null); setAuthFailed(false);
    try {
      let profile = typeof onSignIn === "function" ? await onSignIn(provider) : null;
      const demo = !profile;
      if (!profile) profile = demoProfile(provider);
      const next = {
        provider,
        displayName: profile.displayName || "",
        email: profile.email || "",
        avatarUrl: profile.avatarUrl || "",
        username: profile.username || randomAlias(),
        demo,
      };
      setUser(next); persist(next);
      return { user: next, needsCodename: !profile.username };
    } catch (e) {
      setError(e?.message || "error");
      return null;
    } finally { setBusy(null); }
  }, [onSignIn, persist]);

  useEffect(() => { // the OAuth redirect lands on a fresh page: the signed cookie, not localStorage, says who is signed in
    if (typeof onSession !== "function") return undefined;
    let alive = true;
    onSession().then((profile) => {
      if (!alive || profile === undefined) return; // no backend: keep what is stored
      const cur = userRef.current;
      if (!profile) { if (cur && !cur.demo) { setUser(null); persist(null); } return; } // the cookie is gone or expired
      const kept = cur && cur.id === profile.id && !cur.demo ? cur.username : "";
      const next = {
        id: profile.id, provider: profile.provider,
        displayName: profile.displayName || "", email: profile.email || "", avatarUrl: profile.avatarUrl || "",
        username: profile.username || kept || randomAlias(), demo: false,
      };
      setUser(next); persist(next);
      if (!profile.username && !kept) setPendingCodename(true);
    }).catch(() => {});
    return () => { alive = false; };
  }, [onSession, persist]);

  const signOut = useCallback(() => { setUser(null); persist(null); Promise.resolve(onSignOut?.()).catch(() => {}); }, [persist, onSignOut]);

  /** → true once the server erased the account and the local session is gone (a demo session has nothing to erase). */
  const deleteAccount = useCallback(async () => {
    try { if (!userRef.current?.demo && typeof onDeleteAccount === "function" && !(await onDeleteAccount())) return false; } catch { return false; }
    setUser(null); persist(null);
    return true;
  }, [persist, onDeleteAccount]);

  const checkUsername = useCallback(async (name) => {
    if (!USERNAME_RE.test(name)) return { ok: false, reason: "format" };
    if (user?.username && user.username.toLowerCase() === name.toLowerCase()) return { ok: true };
    if (typeof onCheckUsername === "function") {
      const r = await onCheckUsername(name);
      if (r !== undefined) { // undefined: no backend (or a demo session) to ask, so the local check below decides
        const ok = r === true || r?.ok === true || r?.available === true;
        return ok ? { ok: true } : { ok: false, reason: "taken" };
      }
    }
    return isTakenLocal(name) ? { ok: false, reason: "taken" } : { ok: true };
  }, [onCheckUsername, user]);

  const setUsername = useCallback(async (name) => {
    if (!user) return;
    const next = { ...user, username: name };
    setUser(next); persist(next);
    try { await onUsernameChange?.(name); } catch { /* backend errors surface in your hook */ }
  }, [user, persist, onUsernameChange]);

  const value = useMemo(
    () => ({ user, busy, error, authFailed, signIn, signOut, deleteAccount, checkUsername, setUsername, pendingCodename, clearPendingCodename: () => setPendingCodename(false) }),
    [user, busy, error, authFailed, signIn, signOut, deleteAccount, checkUsername, setUsername, pendingCodename],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

function useSignInFlow(onDone) {
  const auth = useAuth();
  const modals = useModals();
  return useCallback(async (provider) => {
    const r = await auth.signIn(provider);
    if (!r) return;
    onDone?.();
    if (r.needsCodename) modals.openCodename();
  }, [auth, modals, onDone]);
}

/* ═════════════════════════ NAVIGATION ═════════════════════════ */
/** Address-bar navigation without a router: pushState + a popstate the router (ShadokuApp's useRoute) listens to. */
const navByHistory = (to) => {
  pushPath(to);
  try { window.dispatchEvent(new PopStateEvent("popstate")); } catch { /* noop */ }
};
/** → navigate(to): the router's `go` when ShadokuProviders got `onNav`, else history navigation. */
export const useNav = () => useContext(NavCtx) || navByHistory;

/* ═════════════════════════ ROOT PROVIDERS ═════════════════════════ */
export function ShadokuProviders({ children, onSignIn, onCheckUsername, onUsernameChange, onSession, onSignOut, onDeleteAccount, authError, onStart, onSkip, onNav }) {
  return (
    <NavCtx.Provider value={onNav || null}>
      <LangProvider>
        <AuthProvider onSignIn={onSignIn} onCheckUsername={onCheckUsername} onUsernameChange={onUsernameChange}
          onSession={onSession} onSignOut={onSignOut} onDeleteAccount={onDeleteAccount} authError={authError}>
          <ModalHost authError={authError} onStart={onStart} onSkip={onSkip}>{children}</ModalHost>
        </AuthProvider>
      </LangProvider>
    </NavCtx.Provider>
  );
}

function ModalHost({ children, authError, onStart, onSkip }) {
  const [open, setOpen] = useState({ signIn: false, legal: false, codename: false, initiation: false });
  const api = useMemo(() => ({
    openSignIn: () => setOpen((s) => ({ ...s, signIn: true })),
    openLegal: () => setOpen((s) => ({ ...s, legal: true })),
    openCodename: () => setOpen((s) => ({ ...s, codename: true })),
    openInitiation: () => setOpen((s) => ({ ...s, initiation: true })),
    close: (k) => setOpen((s) => ({ ...s, [k]: false })),
  }), []);
  const { user, pendingCodename, clearPendingCodename } = useAuth();
  useEffect(() => { if (authError) api.openSignIn(); }, [authError, api]); // a failed or cancelled sign-in: the buttons again, with the error
  useEffect(() => { if (pendingCodename && user) { api.openCodename(); clearPendingCodename(); } }, [pendingCodename, user, api, clearPendingCodename]);

  return (
    <ModalsCtx.Provider value={api}>
      <GlobalStyles />
      {children}
      {open.signIn && !user && <SignInModal onClose={() => api.close("signIn")} />}
      {open.codename && user && <CodenameModal onClose={() => api.close("codename")} />}
      {open.legal && <LegalModal onClose={() => api.close("legal")} />}
      {open.initiation && <InitiationModal onClose={() => api.close("initiation")} onStart={onStart} onSkip={onSkip} />}
    </ModalsCtx.Provider>
  );
}

/* ═════════════════════════ SMALL UTILITIES ═════════════════════════ */
/** Inline markup: **bold**, [[murdoku]], [[email]] */
export function Rich({ text }) {
  const parts = String(text).split(/(\*\*.+?\*\*|\[\[murdoku\]\]|\[\[email\]\])/g);
  return parts.map((p, i) => {
    if (p === "[[murdoku]]") return <a key={i} className="sh-link" href={MURDOKU_URL} target="_blank" rel="noopener noreferrer">Murdoku</a>;
    if (p === "[[email]]") return <a key={i} className="sh-link" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}><Rich text={p.slice(2, -2)} /></strong>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

class ArtBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: false }; }
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch(e) { console.warn("[Shadoku] art component failed to render:", e); }
  render() { return this.state.err ? (this.props.fallback ?? null) : this.props.children; }
}

function usePrefersReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setR(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return r;
}

/* ═════════════════════════ ART ADAPTER ═════════════════════════ */
const getPuzzle = (id) => PUZZLES.find((q) => q.id === id) || PUZZLES[0] || null;
const puzzleByTheme = (theme, fallbackId) =>
  PUZZLES.find((q) => String(q.theme).toUpperCase() === theme) || getPuzzle(fallbackId);

const castCache = new Map();
/** { puzzle, looks, geo, colorOf } exactly as the game builds them (cast names + portraits are deterministic). */
function castFor(p) {
  if (!p) return null;
  if (castCache.has(p.id)) return castCache.get(p.id);
  let out = null;
  try {
    const { puzzle, looks } = getCastForPuzzle(p, 0);
    const geo = buildGeometry(puzzle);
    const colorOf = (id) => (id === "S" ? BRASS
      : (looks[id] && looks[id].back) || SUSPECT_COLORS[Math.max(0, puzzle.suspects.findIndex((q) => q.id === id)) % SUSPECT_COLORS.length]);
    out = { puzzle, looks, geo, colorOf };
  } catch (e) { console.warn("[Shadoku] could not cast", p.id, e); }
  castCache.set(p.id, out);
  return out;
}
/** → { [suspectId]: [r, c] } the solved positions of the first `n` suspects */
const solutionPlacements = (cast, n = Infinity) =>
  Object.fromEntries(cast.puzzle.suspects.filter((q) => Array.isArray(q.solution)).slice(0, n).map((q) => [q.id, q.solution]));
const blindspotOf = (cast) => (Array.isArray(cast.puzzle.shadow) ? cast.puzzle.shadow : null);

function BoardPlaceholder({ label }) {
  const { t } = useLang();
  return (
    <svg viewBox="0 0 160 160" className="sh-ph" role="img" aria-label={label || t("env.contract")}>
      <rect width="160" height="160" fill="#0f0f14" />
      {[...Array(7)].map((_, i) => <path key={i} d={`M${i * 26.7} 0V160M0 ${i * 26.7}H160`} stroke="#2a2a38" strokeWidth="1" />)}
      <circle cx="80" cy="80" r="14" fill="none" stroke="#D99B26" strokeWidth="2" strokeDasharray="4 4" />
      <text x="80" y="140" textAnchor="middle" fill="#D99B26" fontFamily="'Special Elite',monospace" fontSize="10">{label || t("show.ph.contract")}</text>
    </svg>
  );
}

/** Makes a subtree non-interactive: `inert` is not a React 18 prop, so it is set on the DOM node. */
const inertRef = (el) => { if (el) el.setAttribute("inert", ""); };

function LiveBoard({ puzzle, count = 0, showTarget, label, id }) {
  const cast = castFor(puzzle);
  const uid = `home-${String(id || "x").replace(/[^a-z0-9]/gi, "")}`;
  if (!cast) return <BoardPlaceholder label={label} />;
  const { geo, looks, colorOf } = cast, p = cast.puzzle;
  const st = { tokens: solutionPlacements(cast, count), notes: {}, lights: {}, hints: 0, done: false };
  const W = geo.C * CELL + 2 * BZ, H = geo.R * CELL + 2 * BZ;
  const target = showTarget ? blindspotOf(cast) : null;
  return (
    <ArtBoundary fallback={<BoardPlaceholder label={label} />}>
      <div className="sk sk-embed sh-board-box" ref={inertRef} style={{ aspectRatio: `${W} / ${H}` }}>
        <Board p={p} geo={geo} st={st} looks={looks} colorOf={colorOf} active={p.suspects[0].id} tool="suspect" solved={false} uid={uid} />
        {target && (
          <div
            className="sh-target"
            style={{
              left: `${((BZ + target[1] * CELL) / W) * 100}%`, top: `${((BZ + target[0] * CELL) / H) * 100}%`,
              width: `${(CELL / W) * 100}%`, height: `${(CELL / H) * 100}%`,
            }}
          >
            <span>S</span>
          </div>
        )}
      </div>
    </ArtBoundary>
  );
}

function ArtSafe({ children }) {
  const { t } = useLang();
  return <ArtBoundary fallback={<BoardPlaceholder label={t("show.ph.adow")} />}>{children}</ArtBoundary>;
}

/* ═════════════════════════ ICONS ═════════════════════════ */
const GoogleG = () => (
  <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);
const GitHubMark = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);
const Globe = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" />
  </svg>
);
const Caret = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
);

/* ═════════════════════════ MODAL ═════════════════════════ */
export function Modal({ title, onClose, children, wide }) {
  const { t } = useLang();
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    // runs once per mount: re-running would re-steal focus from inputs
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); } };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, []);
  const id = useMemo(() => `shm-${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <div className="sh-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`sh-modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} ref={ref}>
        <div className="sh-modal-head">
          <h2 id={id} className="sh-type">{title}</h2>
          <button className="sh-x" onClick={onClose} aria-label={t("modal.close")}>×</button>
        </div>
        <div className="sh-modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ═════════════════════════ AUTH UI ═════════════════════════ */
export function AuthButtons({ onDone }) {
  const { t } = useLang();
  const { busy, error, authFailed } = useAuth();
  const modals = useModals();
  const go = useSignInFlow(onDone);
  return (
    <div className="sh-auth">
      <button className="sh-oauth google" onClick={() => go("google")} disabled={!!busy}>
        <GoogleG /><span>{busy === "google" ? t("auth.working") : t("auth.google")}</span>
      </button>
      <button className="sh-oauth github" onClick={() => go("github")} disabled={!!busy}>
        <GitHubMark /><span>{busy === "github" ? t("auth.working") : t("auth.github")}</span>
      </button>
      {(error || authFailed) && <p className="sh-err" role="alert">{t("creds.error")}</p>}
      <p className="sh-consent">
        {t("auth.consentPre")}
        <button type="button" className="sh-link strong" onClick={modals.openLegal}>{t("auth.consentLink")}</button>
        {t("auth.consentPost")}
      </p>
    </div>
  );
}

function SignInModal({ onClose }) {
  const { t } = useLang();
  return (
    <Modal title={t("auth.title")} onClose={onClose}>
      <AuthButtons onDone={onClose} />
    </Modal>
  );
}

export function Avatar({ user }) {
  const initial = (user.username || user.displayName || "?").charAt(0).toUpperCase();
  return user.avatarUrl
    ? <img className="sh-avatar" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
    : <span className="sh-avatar">{initial}</span>;
}

/** The profile pages of the menus, in order: [{ to, key }] (labels: t(`profile.tab.${key}`)). */
export const PROFILE_PAGES = [{ to: "/profile", key: "info" }, { to: "/profile/stats", key: "stats" }, { to: "/profile/collection", key: "collection" }];

/** Closes a dropdown on a click outside `ref` or on Escape, while `open`. */
function useDismiss(open, setOpen, ref) {
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open, setOpen, ref]);
}

/** Sign In, or (signed in) the codename chip that opens the Profile menu: Info, Stats, Collection, Log Out. */
export function UserPill() {
  const { t } = useLang();
  const { user, signOut } = useAuth();
  const modals = useModals();
  const nav = useNav();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(open, setOpen, ref);
  if (!user) return <button className="sh-btn" onClick={modals.openSignIn}>{t("nav.signIn")}</button>;
  const go = (to) => { setOpen(false); nav(to); };
  return (
    <div className="sh-userpill" ref={ref}>
      <button className="sh-userchip" onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open} aria-label={t("codename.chipAria", { name: user.username })}>
        <Avatar user={user} /><span className="sh-userchip-name">{user.username}</span><Caret />
      </button>
      {open && (
        <nav className="sh-menu sh-usermenu" aria-label={t("nav.profile")}>
          <span className="sh-menu-h">{t("nav.profile")}</span>
          {PROFILE_PAGES.map((m) => <a key={m.key} href={m.to} onClick={(e) => { e.preventDefault(); go(m.to); }}>{t(`profile.tab.${m.key}`)}</a>)}
          <button type="button" onClick={() => { setOpen(false); signOut(); }}>{t("nav.logOut")}</button>
        </nav>
      )}
    </div>
  );
}

function CodenameModal({ onClose }) {
  const { t } = useLang();
  const { user, checkUsername, setUsername } = useAuth();
  const [name, setName] = useState(user?.username || randomAlias());
  const [status, setStatus] = useState("checking");
  const req = useRef(0);

  useEffect(() => {
    const id = ++req.current;
    if (!USERNAME_RE.test(name)) { setStatus("format"); return undefined; }
    setStatus("checking");
    const timer = setTimeout(async () => {
      let r;
      try { r = await checkUsername(name); } catch { r = { ok: false, reason: "taken" }; }
      if (id === req.current) setStatus(r.ok ? "ok" : r.reason || "taken");
    }, 250);
    return () => clearTimeout(timer);
  }, [name, checkUsername]);

  const save = async (e) => {
    e?.preventDefault();
    if (status !== "ok") return;
    await setUsername(name);
    onClose();
  };
  const badge = {
    ok: ["ok", t("codename.ok")], taken: ["bad", t("codename.taken")],
    format: ["bad", t("codename.format")], checking: ["idle", t("codename.checking")],
  }[status];

  return (
    <Modal title={t("codename.title")} onClose={onClose}>
      <form onSubmit={save} className="sh-codename">
        <p className="sh-muted">{t("codename.help")}</p>
        <label className="sh-label" htmlFor="sh-codename-input">{t("codename.label")}</label>
        <div className="sh-row">
          <input
            id="sh-codename-input" className="sh-input" value={name} maxLength={20} autoFocus
            autoComplete="off" autoCapitalize="off" spellCheck={false}
            onChange={(e) => setName(e.target.value.replace(/\s/g, ""))}
            aria-invalid={status === "taken" || status === "format"}
          />
          <button type="button" className="sh-btn ghost" onClick={() => setName(randomAlias())}>🎲 {t("codename.reroll")}</button>
        </div>
        <p className={`sh-badge ${badge[0]}`} aria-live="polite">{badge[1]}</p>
        <div className="sh-row end">
          <button type="button" className="sh-btn ghost" onClick={onClose}>{t("codename.cancel")}</button>
          <button type="submit" className="sh-btn" disabled={status !== "ok"}>{t("codename.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ═════════════════════════ LEGAL MODAL ═════════════════════════ */
const LEGAL_SECTIONS = 10; // ui.legal.s1.h / ui.legal.s1.p … ui.legal.s10.*

function LegalModal({ onClose }) {
  const { t } = useLang();
  return (
    <Modal title={t("legal.title")} onClose={onClose} wide>
      <div className="sh-legal">
        <p><Rich text={t("legal.intro")} /></p>
        {Array.from({ length: LEGAL_SECTIONS }, (_, i) => i + 1).map((n) => (
          <section key={n}>
            <h3 className="sh-type">{t(`legal.s${n}.h`)}</h3>
            <p><Rich text={t(`legal.s${n}.p`)} /></p>
          </section>
        ))}
        <section>
          <h3 className="sh-type">{t("homage.title")}</h3>
          <p><Rich text={t("homage.text")} /></p>
        </section>
      </div>
    </Modal>
  );
}

/* ═════════════════════════ HEADER PIECES ═════════════════════════ */
export function LanguageSelector() {
  const { lang, setLang, t } = useLang();
  return (
    <label className="sh-select-wrap">
      <span className="sh-sr">{t("nav.language")}</span>
      <span className="sh-select-ico"><Globe /></span>
      <select className="sh-select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t("nav.language")}>
        {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
      <span className="sh-select-caret"><Caret /></span>
    </label>
  );
}

/** The site's pages, in menu order: [{ to, key }] (labels: t(`nav.${key}`)). */
export const SITE_PAGES = [{ to: "/", key: "pHome" }, { to: "/play", key: "pContracts" }, { to: "/about", key: "about" }, { to: "/contact", key: "contact" }];

/**
 * The site header shared by every page: logo + `extra` + language + sign-in (or the codename chip) + a ☰ button whose dropdown lists
 * the pages (SITE_PAGES), then Sign In, or (signed in) the Profile group: Info, Stats, Collection, Log Out. `current` marks the page you
 * are on; `onNav(to)` navigates (default: useNav()).
 */
export function SiteHeader({ onLogo, extra = null, style, current = "", onNav }) {
  const { t } = useLang();
  const modals = useModals();
  const ctxNav = useNav();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(open, setOpen, ref);
  const nav = (to) => { setOpen(false); (onNav || ctxNav)(to); };
  const initiated = !!store.get(TUTORIAL_KEY);
  const link = (to, label, cls = "") => (
    <a key={to} href={to} className={`${cls}${to === current ? " on" : ""}`} aria-current={to === current ? "page" : undefined} onClick={(e) => { e.preventDefault(); nav(to); }}>{label}</a>
  );
  return (
    <header className="sh-header" style={style} ref={ref}>
      <button className="sh-logo" onClick={onLogo || (() => nav("/"))} aria-label="Shadoku">
        <ArtBoundary fallback={<span className="sh-type sh-wordmark">SHADOKU</span>}><ShadokuLogo /></ArtBoundary>
      </button>
      <div className="sh-header-r">
        {extra && <span className="sh-hide-m sh-extra">{extra}</span>}
        <HeaderControls />
        <button type="button" className="sh-burger" aria-label={t("nav.menu")} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
        </button>
      </div>
      {open && (
        <nav className="sh-menu" aria-label={t("nav.menu")}>
          {SITE_PAGES.map((m) => (m.to === "/play" && !initiated
            ? <button key={m.to} type="button" onClick={() => { setOpen(false); modals.openInitiation(); }}>{t("nav.pInitiation")}</button> // before the initiation: its envelope, not the contracts
            : link(m.to, t(`nav.${m.key}`))))}
        </nav>
      )}
    </header>
  );
}

/** The social pages of the footer, in order. The labels are brand names (not translated); the mail icon is labelled with the address. */
const SOCIALS = [
  { key: "mail", label: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}`, d: "M3 5h18v14H3z M3.5 5.5l8.5 7 8.5-7 M3.5 18.5l6-6.5 M20.5 18.5l-6-6.5", line: true },
  { key: "instagram", label: "Instagram", href: "https://www.instagram.com/shadoku.game/", d: "M7.5 3h9A4.5 4.5 0 0 1 21 7.5v9a4.5 4.5 0 0 1-4.5 4.5h-9A4.5 4.5 0 0 1 3 16.5v-9A4.5 4.5 0 0 1 7.5 3z M12 7.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8z M17.2 5.8a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z", line: true },
  { key: "facebook", label: "Facebook", href: "https://www.facebook.com/shadoku.game", d: "M13.5 21v-8h2.7l.5-3.2h-3.2V7.9c0-.9.4-1.6 1.7-1.6h1.6V3.5C16.5 3.4 15.6 3.3 14.6 3.3c-2.6 0-4.3 1.6-4.3 4.4v2.1H7.6V13h2.7v8z" },
  { key: "youtube", label: "YouTube", href: "https://www.youtube.com/@shadokugame", d: "M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z" },
  { key: "x", label: "X", href: "https://x.com/shadokugame", d: "M17.8 3h3L14.2 10.6 22 21h-6.1l-4.8-6.3L5.6 21h-3l7.1-8.1L2.3 3h6.2l4.3 5.7zm-1 16.2h1.7L7.6 4.7H5.8z" },
];

/** The footer of the site's pages: the social icons, About, Contact, Terms & Privacy, and the © line, all centred. */
export function SiteFooter() {
  const { t } = useLang();
  const modals = useModals();
  const nav = useNav();
  const page = (to, key) => <a className="sh-link" href={to} onClick={(e) => { e.preventDefault(); nav(to); }}>{t(key)}</a>;
  return (
    <footer className="sh-footer">
      <ul className="sh-social" aria-label={t("footer.social")}>
        {SOCIALS.map((s) => (
          <li key={s.key}>
            <a href={s.href} aria-label={s.label} title={s.label} {...(s.key === "mail" ? {} : { target: "_blank", rel: "noopener noreferrer" })}>
              <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
                {s.line ? <path d={s.d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" /> : <path d={s.d} fill="currentColor" />}
              </svg>
            </a>
          </li>
        ))}
      </ul>
      <nav aria-label={t("footer.aria")}>
        {page("/about", "nav.about")}
        {page("/contact", "nav.contact")}
        <button className="sh-link" onClick={modals.openLegal}>{t("footer.legal")}</button>
      </nav>
      <span>{t("footer.copyright")}</span>
    </footer>
  );
}
export function HeaderControls() {
  return <div className="sh-controls"><LanguageSelector /><UserPill /></div>;
}

/* ═════════════════════════ SHOWCASE FRAMES ═════════════════════════ */
function PhotoFrame({ children, rot = 0, className = "" }) {
  return <figure className={`sh-pol ${className}`} style={{ "--rot": `${rot}deg` }}>{children}</figure>;
}
function MonitorFrame({ children, rot = 0, tag, live = true, className = "" }) {
  const { t } = useLang();
  return (
    <figure className={`sh-monitor ${className}`} style={{ "--rot": `${rot}deg` }}>
      <div className="sh-monitor-bar sh-type">
        <span>{tag}</span>
        {live && <span className="sh-rec"><i />{t("show.live")}</span>}
      </div>
      <div className="sh-monitor-screen">{children}</div>
    </figure>
  );
}
const Shot = ({ src, alt }) => <img className="sh-shot" src={src} alt={alt} loading="lazy" />;
const Caption = ({ children }) => <p className="sh-showcap sh-type">{children}</p>;

function Showcase1({ shot }) {
  const { t } = useLang();
  const p = getPuzzle("case1");
  const cast = castFor(p);
  const sus = cast ? cast.puzzle.suspects.slice(0, 2) : [];
  return (
    <section className="sh-show" aria-label={t("show1.tag")}>
      <div className="sh-show1">
        <div className="sh-polcluster">
          <PhotoFrame rot={-4} className="adow"><ArtSafe><AdowPolaroid size={200} tilt={0} /></ArtSafe></PhotoFrame>
          {sus.map((s, i) => (
            <PhotoFrame key={s.id} rot={i ? 3 : -2} className="sus">
              <ArtBoundary fallback={<BoardPlaceholder label={t("show.ph.suspect")} />}>
                <SuspectPolaroid name={s.name} id={s.id} look={cast.looks[s.id]} size={160} tilt={0} />
              </ArtBoundary>
            </PhotoFrame>
          ))}
        </div>
        <MonitorFrame rot={1.2} tag={t("show1.tag")} live={!shot}>
          {shot ? <Shot src={shot} alt={t("show1.caption")} /> : <LiveBoard puzzle={p} count={2} id="study" label={t("show.ph.study")} />}
        </MonitorFrame>
      </div>
      <Caption>{t("show1.caption")}</Caption>
    </section>
  );
}

function Showcase2({ shot }) {
  const { t } = useLang();
  const beach = puzzleByTheme("BEACH", "case8");
  const street = puzzleByTheme("STREET", "case12");
  return (
    <section className="sh-show" aria-label={t("show2.tag")}>
      <MonitorFrame rot={-0.8} tag={t("show2.tag")} live={!shot} className="wide">
        {shot ? <Shot src={shot} alt={t("show2.caption")} /> : (
          <div className="sh-split">
            <div>
              <LiveBoard puzzle={beach} count={3} id="beach" label={t("show.ph.beach")} />
              <span className="sh-splitlabel sh-type">{t("show2.left")}</span>
            </div>
            <div>
              <LiveBoard puzzle={street} count={3} id="street" label={t("show.ph.street")} />
              <span className="sh-splitlabel sh-type">{t("show2.right")}</span>
            </div>
          </div>
        )}
      </MonitorFrame>
      <Caption>{t("show2.caption")}</Caption>
    </section>
  );
}

function Showcase3({ shot }) {
  const { t } = useLang();
  const p = getPuzzle("case1");
  return (
    <section className="sh-show" aria-label={t("show3.tag")}>
      <div className="sh-show3">
        <MonitorFrame rot={0.6} tag={t("show3.tag")} live={!shot}>
          {shot ? <Shot src={shot} alt={t("show3.caption")} /> : <LiveBoard puzzle={p} count={99} showTarget id="blindspot" label={t("show.ph.blindspot")} />}
        </MonitorFrame>
      </div>
      <Caption>{t("show3.caption")}</Caption>
    </section>
  );
}

/* ═════════════════════════ LORE ═════════════════════════ */
function Lore({ id, rot = 0 }) {
  const { t } = useLang();
  const paras = [];
  for (let i = 1; i < 30; i++) { const v = t(`${id}.${i}`); if (typeof v !== "string" || v === `${id}.${i}`) break; paras.push(v); } // lore.s1.1, lore.s1.2 …
  return (
    <article className="sh-paper" style={{ "--rot": `${rot}deg` }}>
      <span className="sh-tape" aria-hidden="true" />
      {paras.map((p, i) => (
        /^\*\*.+\*\*$/.test(p)
          ? <p key={i} className="sh-welcome sh-type"><Rich text={p.slice(2, -2)} /></p>
          : <p key={i}><Rich text={p} /></p>
      ))}
    </article>
  );
}

/* ═════════════════════════ CREDENTIALS CARD ═════════════════════════ */
function CredentialsCard() {
  const { t } = useLang();
  const { user, signOut, deleteAccount } = useAuth();
  const modals = useModals();
  const nav = useNav();
  const erase = async () => {
    if (!window.confirm(t("creds.deleteConfirm"))) return;
    if (!(await deleteAccount())) window.alert(t("creds.deleteError"));
  };
  return (
    <section className="sh-creds" aria-labelledby="sh-creds-h">
      <div className="sh-creds-card">
        <div className="sh-creds-head">
          <span className="sh-badgeid sh-type">{t("creds.badge")}</span>
          <h2 id="sh-creds-h" className="sh-type">{t("creds.title")}</h2>
        </div>
        {user ? (
          <div className="sh-creds-body">
            <div className="sh-creds-who">
              <Avatar user={user} />
              <div>
                <div className="sh-muted">{t("creds.signedIn")}</div>
                <div className="sh-creds-name sh-type">{user.username}</div>
                <div className="sh-muted sm">{user.demo ? t("creds.nameDemo", { name: user.displayName }) : user.displayName}</div>
              </div>
            </div>
            {user.demo && <p className="sh-muted sm">{t("creds.demo")}</p>}
            <div className="sh-row">
              <button className="sh-btn" onClick={() => nav("/profile")}>{t("creds.profile")}</button>
              <button className="sh-btn ghost" onClick={modals.openCodename}>{t("creds.change")}</button>
              <button className="sh-btn ghost" onClick={signOut}>{t("nav.logOut")}</button>
              {!user.demo && <button className="sh-btn ghost" onClick={erase}>{t("creds.delete")}</button>}
            </div>
          </div>
        ) : (
          <div className="sh-creds-body">
            <p className="sh-muted">{t("creds.sub")}</p>
            <AuthButtons />
          </div>
        )}
      </div>
    </section>
  );
}

/* ═════════════════════════ THE ENVELOPE ═════════════════════════ */
/** The seal on an envelope: the Syndicate's crimson wax with its fedora-and-eye, or (`silver`) the Uninvited's silver seal with their keyhole eye. */
function WaxSeal({ silver = false }) {
  const ticks = [...Array(14)].map((_, i) => {
    const a = (i * 360) / 14 * (Math.PI / 180);
    return [50 + Math.cos(a) * 27, 50 + Math.sin(a) * 27, 50 + Math.cos(a) * 32, 50 + Math.sin(a) * 32];
  });
  if (silver) return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="shWaxSilver" cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#f7f8fb" /><stop offset=".55" stopColor="#b9bdc8" /><stop offset="1" stopColor="#5f6370" />
        </radialGradient>
      </defs>
      <path d="M50 3C63 2 70 8 79 12 90 17 96 28 96 41 97 53 98 62 92 72 86 83 75 92 62 95 52 98 42 98 33 94 21 90 11 82 6 69 2 58 3 46 6 36 10 24 18 13 31 8 37 5 44 3 50 3Z" fill="url(#shWaxSilver)" />
      <circle cx="50" cy="50" r="35" fill="none" stroke="#565a66" strokeWidth="2.4" />
      <circle cx="50" cy="50" r="33" fill="none" stroke="#ffffff" strokeWidth="1" opacity=".5" />
      {ticks.map((t, i) => <line key={i} x1={t[0]} y1={t[1]} x2={t[2]} y2={t[3]} stroke="#565a66" strokeWidth="2" strokeLinecap="round" opacity=".8" />)}
      <UninvitedSigil transform="translate(50 51) scale(.62) translate(-50 -50)" />
    </svg>
  );
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="shWax" cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#e9645f" /><stop offset=".55" stopColor="#C83E3B" /><stop offset="1" stopColor="#7d1f1d" />
        </radialGradient>
      </defs>
      <path d="M50 3C63 2 70 8 79 12 90 17 96 28 96 41 97 53 98 62 92 72 86 83 75 92 62 95 52 98 42 98 33 94 21 90 11 82 6 69 2 58 3 46 6 36 10 24 18 13 31 8 37 5 44 3 50 3Z" fill="url(#shWax)" />
      <circle cx="50" cy="50" r="35" fill="none" stroke="#7d1f1d" strokeWidth="2.4" />
      <circle cx="50" cy="50" r="33" fill="none" stroke="#f08a85" strokeWidth="1" opacity=".35" />
      {ticks.map((t, i) => <line key={i} x1={t[0]} y1={t[1]} x2={t[2]} y2={t[3]} stroke="#7d1f1d" strokeWidth="2" strokeLinecap="round" opacity=".8" />)}
      <g fill="none" stroke="#6a1a18" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M37 42C37 27 63 27 63 42Z" fill="#a82f2c" />
        <path d="M37.5 38.5H62.5" />
        <ellipse cx="50" cy="43" rx="21" ry="5" fill="#a82f2c" />
        <path d="M32 62Q50 48 68 62Q50 76 32 62Z" />
        <circle cx="50" cy="62" r="5.4" fill="#6a1a18" />
      </g>
      <circle cx="48.3" cy="60.3" r="1.5" fill="#f08a85" opacity=".8" />
    </svg>
  );
}

/**
 * Dossier № 000-OMEGA as an object on the desk: a red folder, not an envelope. A burgundy cover with its tab, brass corner
 * protectors, a leather strap with a brass stud, a label card ("000-Ω") and the CONFIDENTIAL stamp; a hint of papers shows above the cover.
 * Sized like a "mini" envelope (it sits in the contracts grid and in the "Your next contract" pop-up) and is one button (`onPick`).
 */
function ContractFolder({ puzzle: rawPuzzle, label, onPick, done = false }) {
  const { t } = useLang();
  const puzzle = useMemo(() => localizeHead(rawPuzzle, trOf(t)), [rawPuzzle, t]);
  const corners = [[14, 40, 1, 1], [466, 40, -1, 1], [14, 284, 1, -1], [466, 284, -1, -1]];
  return (
    <div className="sh-env-cq mini sh-folder-cq">
      <div className="sh-folder" role="button" tabIndex={0} onClick={onPick}
        aria-label={t(done ? "env.miniAriaDone" : "env.miniAria", { open: t("hub.open"), label, title: puzzle ? puzzle.title : "" })}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick && onPick(); } }}>
        <svg viewBox="0 0 480 300" aria-hidden="true">
          <defs>
            <linearGradient id="shFolderBack" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5e1422" /><stop offset="1" stopColor="#2c0a10" /></linearGradient>
            <linearGradient id="shFolderFront" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8a2234" /><stop offset=".55" stopColor="#6a1727" /><stop offset="1" stopColor="#4a0f1b" /></linearGradient>
          </defs>
          <path d="M6 30Q6 22 14 22H150L174 6H466Q474 6 474 14V290Q474 296 468 296H12Q6 296 6 290Z" fill="url(#shFolderBack)" stroke="#2a070e" strokeWidth="3" strokeLinejoin="round" />
          <path d="M26 40H452V52H26Z" fill="#efe4c8" stroke="#bda677" strokeWidth="2" />
          <path d="M34 34H440V44H34Z" fill="#e3d5b6" stroke="#bda677" strokeWidth="2" />
          <path d="M6 54Q6 46 14 46H466Q474 46 474 54V288Q474 296 466 296H14Q6 296 6 288Z" fill="url(#shFolderFront)" stroke="#2a070e" strokeWidth="3" strokeLinejoin="round" />
          <path d="M12 58H468M12 286H468" stroke="#c46a78" strokeWidth="1.4" opacity=".28" />
          {corners.map(([x, y, sx, sy], i) => <path key={i} d={`M${x} ${y + 40 * sy}V${y}H${x + 40 * sx}`} fill="none" stroke="#d99b26" strokeWidth="8" strokeLinejoin="round" strokeLinecap="round" />)}
          <path d="M436 46V296" stroke="#2a070e" strokeWidth="26" opacity=".35" />
          <rect x="424" y="46" width="24" height="250" fill="#3a0a14" stroke="#1c0609" strokeWidth="2" />
          <circle cx="436" cy="171" r="13" fill="#d99b26" stroke="#7a5210" strokeWidth="2" />
          <circle cx="436" cy="171" r="5" fill="#7a5210" />
          <rect x="120" y="96" width="220" height="86" rx="4" fill="#f2e6cf" stroke="#d99b26" strokeWidth="3" />
          <rect x="128" y="104" width="204" height="70" rx="2" fill="none" stroke="#7a1d2c" strokeWidth="1.2" opacity=".6" />
          <text x="230" y="150" textAnchor="middle" fontFamily="'Special Elite',monospace" fontSize="46" fill="#7a1d2c">000-Ω</text>
        </svg>
      </div>
    </div>
  );
}

/** Every contract has a target: the victim (victimNameOf lives in ShadokuArt.jsx, so the board's corpse can match the polaroid). */
export { victimNameOf };

/**
 * A contract in its envelope. variant:
 *   "hero"  the landing page's invitation: click breaks the seal, then the card inside is the "accept" button
 *   "modal" the same, large, opening by itself (the contracts page shows it after you pick a small envelope)
 *   "mini"  a closed envelope in a grid: the whole thing is one button (`onPick`)
 * `puzzle` fills the card (title, difficulty, size, suspects); `label` is the card's header ("CONTRACT № 003").
 */
/** Envelope colours: the manila contract, The Uninvited Guests' black obsidian envelope, the finale's burgundy Omega folder. */
const ENV_TONES = {
  manila: { a: "#e3d5b6", b: "#cdbb94", edge: "#8a7650", fold: "#a8956a", inner: "#332d26", innerLine: "#4a4237", back: "#25221e", stamp: "#C83E3B" },
  obsidian: { a: "#2b2933", b: "#0d0c12", edge: "#5a5566", fold: "#4a4655", inner: "#1d1b24", innerLine: "#3a3644", back: "#121116", stamp: "#D99B26" },
  omega: { a: "#7a1d2c", b: "#3f0c16", edge: "#2a070e", fold: "#5e1422", inner: "#2c0a10", innerLine: "#4a1019", back: "#1c0609", stamp: "#D99B26" },
};
/**
 * `tone`: "manila" (default) | "obsidian" (the Uninvited's black envelope, silver seal) | "omega" (a mini one is drawn as the red FOLDER, ContractFolder). `target`: a polaroid node that replaces the victim's (the Umbra contracts:
 * N. O. Ir, Master U. M. Bra). `autoOpen` false: a "modal" envelope stays sealed until clicked. `onOpen`: called when its seal breaks.
 */
export function ContractEnvelope(props) {
  // the finale while sealed: the red folder (Dossier № 000-OMEGA) is a folder, never an envelope
  return props.tone === "omega" && (props.variant || "hero") === "mini" ? <ContractFolder {...props} /> : <EnvelopeBody {...props} />;
}
function EnvelopeBody({ puzzle: rawPuzzle, label, onAccept, onPick, variant = "hero", done = false, best = null, pre = false, acceptLabel = null, note = null, tone = "manila", target = null, autoOpen = true, onOpen = null, noId = false }) {
  const pal = ENV_TONES[tone] || ENV_TONES.manila, gid = `shManila-${variant}-${tone}`;
  const { t, lang } = useLang();
  const puzzle = useMemo(() => localizeHead(rawPuzzle, trOf(t)), [rawPuzzle, t]); // title + difficulty in the active language
  const reduced = usePrefersReducedMotion();
  const mini = variant === "mini";
  const isTutorial = !!(puzzle && (puzzle.id === "tutorial" || puzzle.dummies));
  const staticOpen = !!(pre || done); // a fulfilled contract (or one the caller says is already open) shows its envelope open from the start
  const [phase, setPhase] = useState(staticOpen && !mini ? "open" : "idle");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const open = () => {
    if (mini || phase !== "idle") return;
    setPhase("opening");
    if (onOpen) onOpen(); // the seal is broken (the dossier shows the Uninvited's letter)
    timer.current = setTimeout(() => setPhase("open"), reduced ? 150 : ENVELOPE_MS + 60);
  };
  useEffect(() => { if (variant === "modal" && autoOpen && !staticOpen) { const w = setTimeout(open, reduced ? 0 : 280); return () => clearTimeout(w); } return undefined; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sealed = variant === "modal" && !autoOpen; // a modal envelope that waits, closed, for the player to break its seal
  const onKey = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
  const opened = phase !== "idle" || (mini && staticOpen);
  const dim = puzzle ? `${puzzle.rooms.length}×${puzzle.rooms[0].length}` : "";
  const upper = (x) => { try { return String(x).toLocaleUpperCase(lang); } catch { return String(x).toUpperCase(); } };
  const meta = puzzle ? t("env.meta", { difficulty: upper(puzzle.difficulty || ""), size: dim, n: (puzzle.suspects || []).length }) : "";
  const rootProps = mini
    ? { role: "button", tabIndex: 0, "aria-label": done && puzzle ? t("env.miniAriaDone", { open: t("hub.open"), label, title: puzzle.title }) : t("env.miniAria", { open: t("hub.open"), label }), onClick: onPick, onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick && onPick(); } } }
    : phase === "idle" ? { role: "button", tabIndex: 0, "aria-label": t("env.aria"), onKeyDown: onKey, onClick: open } : { onClick: open };

  return (
    <div className={`sh-env-cq ${variant}${opened ? " opened" : ""}${sealed ? " sealed" : ""}`}>
      <div className={`sh-env tone-${tone}${opened ? " opening" : ""}${phase === "open" ? " ready" : ""}${staticOpen ? " pre" : ""}`} {...rootProps} id={variant === "hero" && !noId ? "sh-envelope" : undefined}>
        <div className="sh-env-lift">
          <div className="sh-env-stage">
            {/* back / inside */}
            <div className="sh-layer sh-layer-back">
              <svg viewBox="0 0 480 420">
                <rect x="1.5" y="151.5" width="477" height="267" rx="6" fill={pal.back} stroke="#0e0d0b" strokeWidth="3" />
              </svg>
            </div>

            {/* the contract card + the target's polaroid that slides out */}
            <div className="sh-card">
              <div className="sh-card-in">
                <div className="sh-card-pol"><ArtSafe>{target || (isTutorial
                  ? <AdowPolaroid size={200} tilt={2} /> /* the initiation's "target" is yourself: S. H. Adow, no stamp, no X */
                  : <VictimPolaroid name={victimNameOf(puzzle)} size={200} tilt={2} crossed={!!done} />)}</ArtSafe></div>
                <div className="sh-card-txt">
                  <div className="k sh-type">{label}</div>
                  <div className="h sh-type">{puzzle?.title || ""}</div>
                  <div className="m sh-type">{meta}</div>
                  <div className="sh-type">{t("env.initiate")}</div>
                  {done && best > 0 && <div className="sh-card-best sh-type">{t("env.best")} <b>{fmtTime(best)}</b></div>}
                  {!mini && <div className="sh-card-sign sh-type" aria-hidden="true">{t("env.sign", { action: acceptLabel || (isTutorial ? (done ? t("env.replay") : t("env.start")) : done ? t("env.reopen") : t("env.accept")) })}</div>}
                </div>
              </div>
              {done && <div className="sh-card-stamp sh-type" aria-hidden="true">{t("env.fulfilled")}</div>}
              {phase === "open" && (
                <button type="button" className="sh-card-hit" autoFocus onClick={onAccept}
                  aria-label={t("env.acceptAria", { action: acceptLabel || (isTutorial ? (done ? t("env.replay") : t("env.start")) : t("env.accept")), title: puzzle?.title || "" })} />
              )}
            </div>

            {/* front pocket + stamp */}
            <div className="sh-layer sh-layer-front">
              <svg viewBox="0 0 480 420">
                <defs>
                  <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={pal.a} /><stop offset="1" stopColor={pal.b} /></linearGradient>
                </defs>
                <path d="M2 150L240 300 478 150V414Q478 418 474 418H6Q2 418 2 414Z" fill={`url(#${gid})`} stroke={pal.edge} strokeWidth="3" strokeLinejoin="round" />
                <path d="M3 417L196 288M477 417L284 288" stroke={pal.fold} strokeWidth="2" opacity=".7" />
                {tone === "omega" && [[14, 162, 1, 1], [466, 162, -1, 1], [14, 406, 1, -1], [466, 406, -1, -1]].map(([x, y, sx, sy], i) => (
                  <path key={i} d={`M${x} ${y + 34 * sy}V${y}H${x + 34 * sx}`} fill="none" stroke="#d99b26" strokeWidth="7" strokeLinejoin="round" /> /* the folder's brass corners */
                ))}
                {tone === "manila" && <g transform="rotate(-5 240 368)">
                  <rect x="100" y="338" width="280" height="60" fill="none" stroke={pal.stamp} strokeWidth="3" rx="3" opacity=".9" />
                  <rect x="106" y="344" width="268" height="48" fill="none" stroke={pal.stamp} strokeWidth="1" rx="2" opacity=".7" />
                  <text x="240" y="366" textAnchor="middle" fontFamily="'Special Elite',monospace" fontSize="19" fill={pal.stamp} opacity=".92">{t("env.stamp1").replace(/\s*[—–-]\s*$/, "")}</text>
                  <text x="240" y="385" textAnchor="middle" fontFamily="'Special Elite',monospace" fontSize="14" fill={pal.stamp} opacity=".92">{t("env.stamp2")}</text>
                </g>}
              </svg>
            </div>

            {/* the flap (two faces so it reads correctly after rotateX(180deg)) */}
            <div className="sh-flap">
              <div className="sh-flap-face">
                <svg viewBox="0 0 480 420"><path d="M2 150H478L240 300Z" fill={`url(#${gid})`} stroke={pal.edge} strokeWidth="3" strokeLinejoin="round" /></svg>
              </div>
              <div className="sh-flap-face sh-flap-in">
                <svg viewBox="0 0 480 420"><path d="M2 150H478L240 2Z" fill={pal.inner} stroke="#0e0d0b" strokeWidth="3" strokeLinejoin="round" /><path d="M40 150L240 28 440 150" fill="none" stroke={pal.innerLine} strokeWidth="2" /></svg>
              </div>
            </div>

            {/* crimson wax seal — two halves so it can crack */}
            <div className="sh-seal">
              <div className="sh-seal-half sh-seal-l"><WaxSeal silver={tone === "obsidian"} /></div>
              <div className="sh-seal-half sh-seal-r"><WaxSeal silver={tone === "obsidian"} /></div>
              <svg className="sh-crack" viewBox="0 0 100 100" aria-hidden="true"><path d="M52 4L45 24 56 38 44 56 55 72 47 96" fill="none" stroke={tone === "obsidian" ? "#23252c" : "#2a0b0a"} strokeWidth="2.2" strokeLinejoin="round" /></svg>
            </div>
            {mini && done && <div className="sh-env-done sh-type" aria-hidden="true">✓</div>}
          </div>
        </div>
      </div>
      {variant === "hero" && <p className={`sh-env-prompt sh-type${phase === "open" ? " go" : ""}`} aria-live="polite">{phase === "open" ? (note || t("env.acceptNote")) : t("env.prompt")}</p>}
      {sealed && phase === "idle" && <p className="sh-env-prompt sh-type">{t("env.prompt")}</p>}
    </div>
  );
}

/** The landing page's invitation: the initiation contract ("The Art of the Ghost"). */
function Envelope({ onPlay, onStart, onSkip, noId = false }) {
  const { t } = useLang();
  const q = getPuzzle("tutorial");
  const best = useMemo(() => (q ? readBestTimes([q])[q.id] || 0 : 0), [q]);
  const initiated = best > 0; // only a SOLVED initiation opens the envelope for good (skipping it does not)
  const skippable = !store.get(TUTORIAL_KEY) && !!onSkip; // neither solved nor skipped yet
  return initiated
    ? <ContractEnvelope variant="hero" puzzle={q} label={t("env.caseFile")} pre done={best > 0} best={best} acceptLabel={t("env.pick")} note={t("env.pickNote")} onAccept={onPlay} noId={noId} />
    : <>
        <ContractEnvelope variant="hero" puzzle={q} label={t("env.caseFile")} onAccept={onStart || onPlay} noId={noId} />
        {skippable && <p className="sh-env-skip"><button type="button" className="sh-link" onClick={onSkip}>{t("tut.skip")}</button></p>}
      </>;
}

/** The Menu's "Initiation": the landing page's envelope (same component, same skip button) in a pop-up. */
function InitiationModal({ onClose, onStart, onSkip }) {
  const { t } = useLang();
  const nav = useNav();
  const start = () => { onClose(); (onStart || (() => nav("/play")))(); };
  const skip = () => { onClose(); (onSkip || (() => { store.set(TUTORIAL_KEY, "1"); nav("/play"); }))(); };
  return (
    <Modal title={t("nav.pInitiation")} onClose={onClose} wide>
      <Envelope onPlay={() => { onClose(); nav("/play"); }} onStart={start} onSkip={skip} noId />
    </Modal>
  );
}

/* ═════════════════════════ PAGE ═════════════════════════ */
function HomeInner({ onPlay, onStart, onSkip, onNav, screenshots }) {
  const { t } = useLang();
  const shots = Array.isArray(screenshots) ? screenshots : [];
  const [envVisible, setEnvVisible] = useState(false);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = t("page.home");
    return () => { document.title = prevTitle; };
  }, [t]);

  useEffect(() => {
    const el = document.getElementById("sh-envelope");
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(([e]) => setEnvVisible(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const toEnvelope = () => document.getElementById("sh-envelope")?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <div className="sh-root">
      <style data-shadoku="boards">{GAME_CSS}</style>
      <SiteHeader onLogo={() => window.scrollTo?.({ top: 0, behavior: "smooth" })} onNav={onNav} current="/" />

      <main>
        <section className="sh-hero">
          <p className="sh-eyebrow sh-type">{t("hero.eyebrow")}</p>
          <h1 className="sh-type">{t("hero.title")}</h1>
        </section>

        <section className="sh-env-section" aria-label={t("env.contract")}>
          <Envelope onPlay={onPlay} onStart={onStart} onSkip={onSkip} />
        </section>

        <div id="sh-story" className="sh-story">
          <Lore id="lore.s1" rot={-0.6} />
          <Showcase1 shot={shots[0]} />
          <Lore id="lore.s2" rot={0.5} />
          <Showcase2 shot={shots[1]} />
          <Lore id="lore.s3" rot={-0.4} />
          <Showcase3 shot={shots[2]} />
        </div>

        <CredentialsCard />

        <aside className="sh-homage" aria-labelledby="sh-homage-h">
          <span className="sh-homage-ico" aria-hidden="true">🔍</span>
          <div>
            <h2 id="sh-homage-h" className="sh-type">{t("homage.title")}</h2>
            <p><Rich text={t("homage.text")} /></p>
          </div>
        </aside>
      </main>

      <SiteFooter />

      {!envVisible && (
        <button className="sh-cue sh-type" onClick={toEnvelope} aria-label={t("env.cue")}>
          <span aria-hidden="true">✉</span> {t("env.cue")} ↑
        </button>
      )}
    </div>
  );
}

/**
 * <ShadokuHome onPlay={() => …} screenshots={[url1, url2, url3]} />
 *  onPlay      the contracts page (/play): where "Pick a contract" leads once the tutorial is behind you
 *  onStart     the first visit's "Accept the contract": opens the tutorial puzzle itself (falls back to onPlay)
 *  onSkip      "Skip Initiation" under that envelope: marks the initiation done and opens the contracts page
 *  screenshots optional static images that replace the live showcases
 */
export default function ShadokuHome({ onPlay, onStart, onSkip, onNav, screenshots, ...authHooks }) {
  const hasProviders = useContext(LangCtx);
  const play = onPlay || (() => {
    pushPath("/play");
    try { window.dispatchEvent(new PopStateEvent("popstate")); } catch { /* noop */ }
  });
  const body = <HomeInner onPlay={play} onStart={onStart} onSkip={onSkip} onNav={onNav} screenshots={screenshots} />;
  return hasProviders ? body : <ShadokuProviders {...authHooks}>{body}</ShadokuProviders>;
}

/* ═════════════════════════ STYLES ═════════════════════════ */
export const SHADOKU_CSS = `
/* Fonts: the <link> in index.html (see CSS in ShadokuGame.jsx) */
:root{--sh-bg:#141419;--sh-panel:#1c1c25;--sh-line:#34344a;--sh-cream:#F5F0E6;--sh-ink:#2b2620;--sh-brass:#D99B26;--sh-crimson:#C83E3B;--sh-green:#58b784;--sh-muted:#a9a59b}
.sh-root,.sh-backdrop,.sh-header{font-family:'Barlow',system-ui,-apple-system,'Segoe UI',sans-serif}
.sh-root *,.sh-backdrop *,.sh-header *{box-sizing:border-box}
/* the art is drawn left to right: in a right-to-left language an SVG <text> would run left from its x and leave its box */
svg{direction:ltr}
.sh-type{font-family:'Special Elite','Courier New',monospace;font-weight:400}
.sh-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.sh-muted{color:var(--sh-muted);margin:0 0 12px}.sh-muted.sm{font-size:13px;margin:0}
.sh-link{color:var(--sh-brass);text-decoration:underline;text-underline-offset:3px;background:none;border:0;padding:0;font:inherit;cursor:pointer}
.sh-link:hover{color:#f0b84a}.sh-link.strong{font-weight:700}
.sh-root{min-height:100vh;color:var(--sh-cream);line-height:1.6;overflow-x:hidden;
  background:radial-gradient(ellipse 80% 40% at 50% -8%,rgba(217,155,38,.16),transparent 70%),radial-gradient(ellipse 60% 30% at 85% 60%,rgba(200,62,59,.06),transparent 70%),var(--sh-bg)}

/* header */
.sh-header{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px clamp(12px,3vw,32px);background:rgba(20,20,25,.88);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--sh-line);color:var(--sh-cream)}
.sh-logo{display:flex;align-items:center;height:40px;border:0;background:none;padding:0;cursor:pointer;color:inherit}
.sh-logo img{height:100%;width:auto;max-width:46vw}@media (min-width:961px){.sh-logo{height:56px}} /* = the logo in the puzzle's own header (.sk-head .sk-logo) */.sh-wordmark{font-size:22px;letter-spacing:.12em;color:var(--sh-brass)}
.sh-controls,.sh-userpill{display:flex;align-items:center;gap:10px}
.sh-header{box-sizing:border-box}.sh-header-r{display:flex;align-items:center;gap:10px}.sh-extra{display:inline-flex}
.sh-burger{display:inline-flex;align-items:center;justify-content:center;width:40px;height:38px;padding:0;border-radius:10px;border:1px solid #34344a;background:#1c1c25;color:var(--sh-cream);cursor:pointer}
.sh-burger:hover,.sh-burger[aria-expanded=true]{border-color:var(--sh-brass);color:var(--sh-brass)}
.sh-header .sh-select,.sh-header .sh-btn,.sh-header .sh-burger{min-height:40px;height:40px} /* 40px tap targets; the 40px logo sets the header height anyway */
.sh-menu{position:absolute;top:calc(100% + 6px);right:10px;z-index:60;min-width:190px;display:flex;flex-direction:column;padding:6px;border-radius:12px;background:#1c1c25;border:1px solid #34344a;box-shadow:0 18px 40px rgba(0,0,0,.6)}
.sh-menu a{display:block;padding:12px 14px;border-radius:8px;color:var(--sh-cream);text-decoration:none;font:600 16px 'Barlow',sans-serif}
.sh-menu button{display:block;width:100%;padding:12px 14px;border:0;border-radius:8px;background:none;color:var(--sh-cream);text-align:start;font:600 16px 'Barlow',sans-serif;cursor:pointer}
.sh-menu a:hover,.sh-menu a:focus-visible,.sh-menu button:hover,.sh-menu button:focus-visible{background:rgba(217,155,38,.14);outline:none}.sh-menu a.on{color:var(--sh-brass)}.sh-header .sh-btn.keep{display:inline-flex}
.sh-menu-h{display:block;margin-top:4px;padding:10px 14px 4px;border-top:1px solid #34344a;font:400 12px 'Special Elite',monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--sh-brass)}
.sh-menu .sub{padding-inline-start:26px}.sh-menu .sh-menu-sep{margin-top:4px;border-top:1px solid #34344a;border-radius:0 0 8px 8px}
.sh-userpill{position:relative}.sh-userchip svg{color:var(--sh-muted);flex:none}
.sh-usermenu{top:calc(100% + 8px);right:0;min-width:200px}.sh-usermenu .sh-menu-h{margin-top:0;border-top:0}
.sh-select-wrap{position:relative;display:flex;align-items:center;color:var(--sh-cream)}
.sh-select{appearance:none;-webkit-appearance:none;background:#1c1c25;color:var(--sh-cream);border:1px solid #34344a;border-radius:10px;padding:8px 30px;padding-inline:34px 30px;font:600 14px 'Barlow',sans-serif;cursor:pointer;max-width:150px;min-height:38px}
.sh-select:hover{border-color:var(--sh-brass)}.sh-select option{background:#1c1c25;color:var(--sh-cream)}
.sh-select-ico,.sh-select-caret{position:absolute;pointer-events:none;display:flex;color:var(--sh-muted)}
.sh-select-ico{inset-inline-start:11px}.sh-select-caret{inset-inline-end:10px}
.sh-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:38px;padding:8px 18px;border-radius:10px;border:1px solid var(--sh-brass);background:var(--sh-brass);color:#1a1408;font:700 14px 'Barlow',sans-serif;cursor:pointer;transition:transform .15s,background .15s,box-shadow .15s;white-space:nowrap}
.sh-btn:hover:not(:disabled){background:#e8ab3a;transform:translateY(-1px);box-shadow:0 6px 16px rgba(217,155,38,.25)}
.sh-btn:disabled{opacity:.45;cursor:not-allowed}
.sh-btn.ghost{background:transparent;color:var(--sh-cream);border-color:var(--sh-line)}.sh-btn.ghost:hover:not(:disabled){border-color:var(--sh-brass);background:rgba(217,155,38,.08);box-shadow:none}
.sh-btn.sm{min-height:32px;padding:4px 12px;font-size:13px}
.sh-userchip{display:flex;align-items:center;gap:8px;background:var(--sh-panel);border:1px solid var(--sh-line);border-radius:999px;padding:3px 12px 3px 4px;padding-inline:4px 12px;color:var(--sh-cream);font:600 14px 'Barlow',sans-serif;cursor:pointer}
.sh-userchip:hover{border-color:var(--sh-brass)}.sh-userchip-name{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sh-avatar{width:28px;height:28px;border-radius:50%;background:var(--sh-brass);color:#1a1408;display:inline-flex;align-items:center;justify-content:center;font:700 14px 'Barlow',sans-serif;object-fit:cover;flex:none}
.sh-iconbtn{width:38px;height:38px;border-radius:50%;border:1px solid var(--sh-line);background:var(--sh-panel);color:var(--sh-brass);font:700 17px 'Special Elite',monospace;cursor:pointer}
.sh-iconbtn:hover{border-color:var(--sh-brass)}

/* hero */
.sh-hero{text-align:center;padding:clamp(24px,4vw,44px) 20px 0;max-width:920px;margin:0 auto}
.sh-eyebrow{color:var(--sh-brass);letter-spacing:.18em;text-transform:uppercase;font-size:clamp(11px,1.6vw,14px);margin:0 0 18px}
.sh-hero h1{font-size:clamp(32px,6vw,60px);line-height:1.05;margin:0 0 4px;color:var(--sh-cream);text-shadow:0 0 40px rgba(217,155,38,.25),3px 3px 0 rgba(200,62,59,.35)}
.sh-hero-cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}

/* story */
.sh-story{max-width:1080px;margin:0 auto;padding:0 clamp(14px,3vw,28px) 0}.sh-story>.sh-show:last-child{margin-bottom:0}
.sh-paper{position:relative;max-width:720px;margin:0 auto;padding:clamp(24px,4.5vw,44px);background:var(--sh-cream);color:var(--sh-ink);border-radius:3px;transform:rotate(var(--rot,0deg));
  background-image:repeating-linear-gradient(transparent 0 29px,rgba(120,90,50,.09) 29px 30px);box-shadow:0 22px 44px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.25)}
.sh-paper p{margin:0 0 1em;font-size:clamp(17px,2.2vw,20px)}.sh-paper p:last-child{margin-bottom:0}
.sh-paper .sh-link{color:#9b3430}.sh-paper .sh-link:hover{color:var(--sh-crimson)}
.sh-welcome{font-size:clamp(28px,5.5vw,46px)!important;line-height:1.1;color:var(--sh-crimson);text-align:center;margin-top:.5em!important}
.sh-tape{position:absolute;top:-12px;left:50%;width:96px;height:26px;margin-left:-48px;background:rgba(217,155,38,.55);transform:rotate(-3deg);box-shadow:0 1px 3px rgba(0,0,0,.3);z-index:2}
.sh-show{margin:clamp(40px,7vw,84px) auto}
.sh-showcap{text-align:center;color:var(--sh-brass);font-size:clamp(14px,2vw,18px);margin:26px auto 0;max-width:680px;line-height:1.45}
.sh-show1{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:clamp(20px,4vw,48px);align-items:center}
.sh-polcluster{display:flex;flex-wrap:wrap;gap:16px;justify-content:center;align-items:flex-start}
.sh-polcluster .sh-pol{width:clamp(120px,21vw,160px)}.sh-polcluster .adow{width:clamp(150px,26vw,200px)}
.sh-pol{margin:0;transform:rotate(var(--rot,0deg));filter:drop-shadow(0 12px 16px rgba(0,0,0,.5))}
.sh-pol svg{display:block;width:100%;height:auto}
.sh-monitor{margin:0;background:#0b0b10;border:6px solid #2a2a36;border-radius:14px;padding:8px 8px 10px;transform:rotate(var(--rot,0deg));box-shadow:0 0 0 2px #0a0a0f,0 30px 60px rgba(0,0,0,.6),inset 0 0 40px rgba(217,155,38,.08);position:relative}
.sh-monitor-bar{display:flex;justify-content:space-between;align-items:center;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--sh-brass);padding:2px 6px 8px}
.sh-rec{display:inline-flex;align-items:center;gap:6px;color:var(--sh-crimson)}.sh-rec i{width:8px;height:8px;border-radius:50%;background:var(--sh-crimson);animation:shBlink 1.4s steps(2) infinite}
.sh-monitor-screen{position:relative;border-radius:6px;overflow:hidden;background:#0f0f14}
.sh-monitor-screen::after{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(transparent 0 2px,rgba(0,0,0,.16) 2px 3px);mix-blend-mode:multiply}
.sh-shot{display:block;width:100%;height:auto}
.sk.sk-embed{height:auto;overflow:visible;background:none;color:inherit;font:inherit}
.sh-board-box{position:relative;width:100%;pointer-events:none;user-select:none}.sh-board-box>*:not(.sh-target){width:100%;height:100%;display:block}
.sh-ph{width:100%;height:auto;display:block}
.sh-split{display:grid;grid-template-columns:1fr 1fr;gap:10px;position:relative}
.sh-split>div{position:relative}.sh-split>div+div{border-inline-start:2px dashed var(--sh-line);padding-inline-start:10px}
.sh-splitlabel{position:absolute;left:6px;bottom:6px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;background:rgba(15,15,20,.85);color:var(--sh-brass);padding:2px 8px;border-radius:3px}
.sh-show3{max-width:560px;margin:0 auto}
.sh-show:has(.wide){max-width:980px}
.sh-target{position:absolute;pointer-events:none;display:grid;place-items:center;z-index:3}
.sh-target::before{content:"";position:absolute;inset:4%;border-radius:50%;border:3px solid var(--sh-brass);box-shadow:0 0 16px var(--sh-brass),inset 0 0 10px rgba(217,155,38,.5);animation:shPulse 1.6s ease-in-out infinite}
.sh-target span{position:relative;font:400 clamp(12px,3.2vw,24px) 'Special Elite',monospace;color:var(--sh-brass);text-shadow:0 0 8px #000}

/* credentials */
.sh-creds{padding:clamp(16px,3vw,28px) 16px clamp(24px,5vw,56px)}
.sh-creds-card{max-width:520px;margin:0 auto;background:linear-gradient(180deg,#20202b,#181820);border:2px dashed rgba(217,155,38,.6);border-radius:14px;padding:24px;box-shadow:0 20px 44px rgba(0,0,0,.45)}
.sh-creds-head{display:flex;align-items:center;gap:12px;margin-bottom:14px}.sh-creds-head h2{margin:0;font-size:clamp(20px,3.4vw,26px);color:var(--sh-cream)}
.sh-badgeid{background:var(--sh-crimson);color:#fff;padding:2px 9px;border-radius:4px;font-size:14px;transform:rotate(-4deg)}
.sh-creds-who{display:flex;gap:12px;align-items:center;margin-bottom:12px}.sh-creds-who .sh-avatar{width:48px;height:48px;font-size:20px}
.sh-creds-name{font-size:22px;color:var(--sh-brass)}
.sh-auth{display:flex;flex-direction:column;gap:10px}
.sh-oauth{display:flex;align-items:center;justify-content:center;gap:12px;min-height:46px;border-radius:10px;font:600 15px 'Barlow',sans-serif;cursor:pointer;border:1px solid var(--sh-line);transition:transform .15s,border-color .15s}
.sh-oauth:hover:not(:disabled){transform:translateY(-1px)}.sh-oauth:disabled{opacity:.6;cursor:wait}
.sh-oauth.google{background:#fff;color:#1f1f1f;border-color:#dadce0}.sh-oauth.github{background:#24292f;color:#fff;border-color:#3b4048}
.sh-consent{font-size:13px;color:var(--sh-muted);margin:6px 0 0;text-align:center}
.sh-err{color:var(--sh-crimson);margin:0;font-size:14px;text-align:center}

/* envelope */
.sh-env-section{text-align:center;padding:clamp(8px,2vw,24px) 16px clamp(40px,7vw,90px)}
.sh-env-section h2{font-size:clamp(26px,4.6vw,42px);margin:0 0 6px}
.sh-env-cq{container-type:inline-size;width:min(560px,92vw);margin:clamp(8px,2vw,16px) auto 0}
.sh-env-cq .sh-env-stage{margin-top:-27cqw;transition:margin-top .6s cubic-bezier(.3,.7,.3,1)} /* closed: the empty room above the flap is pulled away; it opens up again as the letter rises */
.sh-env-cq.opened .sh-env-stage,.sh-env-cq.modal .sh-env-stage{margin-top:12cqw}
.sh-env-cq.modal{width:min(560px,90vw);margin:0 auto}
.sh-env-cq.modal.sealed:not(.opened) .sh-env-stage{margin-top:-27cqw} /* closed like the landing page's: no empty room above the flap until the letter rises */
.sh-env-cq.sealed .sh-env-prompt,.sh-modal .sh-env-prompt{text-align:center}
.sh-env-cq.mini{width:100%;margin:0;overflow:hidden;padding-bottom:12px}
.sh-env-cq.mini .sh-env-stage{margin-top:-26cqw}
.sh-folder-cq{padding-bottom:12px}.sh-folder{position:relative;cursor:pointer;border-radius:8px;outline:none;transition:transform .25s ease,filter .25s ease;filter:drop-shadow(0 14px 14px rgba(0,0,0,.5))}
.sh-folder svg{display:block;width:100%;height:auto}
.sh-folder:hover,.sh-folder:focus-visible{transform:translateY(-8px);filter:drop-shadow(0 22px 20px rgba(122,29,44,.55))}
.sh-folder:focus-visible{box-shadow:0 0 0 3px var(--sh-brass)}
.sh-env-done{position:absolute;z-index:6;right:7%;bottom:8%;width:13cqw;height:13cqw;border-radius:50%;background:#2f9e6b;color:#fff;font-size:8.5cqw;line-height:1;display:grid;place-items:center;transform:rotate(-8deg);border:.9cqw solid #e3d5b6;box-shadow:0 .6cqw 1.6cqw rgba(0,0,0,.45);pointer-events:none}
.sh-card-txt .m{font-size:2cqw;color:#6a1a18;letter-spacing:.05em;margin:-.6cqw 0 1cqw}
.sh-accept{margin:26px auto 0;max-width:460px;display:flex;flex-direction:column;align-items:center;gap:14px}.sh-accept p{margin:0;color:var(--sh-cream);font-size:clamp(15px,2.4vw,19px)}.sh-btn.lg{min-height:50px;padding:10px 30px;font-size:17px;animation:shPulseBtn 1.8s ease-in-out infinite}
@keyframes shPulseBtn{50%{box-shadow:0 0 0 7px rgba(217,155,38,.18)}}
.sh-env{position:relative;cursor:pointer;-webkit-tap-highlight-color:transparent;outline:none;border-radius:8px}
.sh-env[aria-disabled="true"]{cursor:default}
.sh-env:focus-visible{box-shadow:0 0 0 3px var(--sh-brass)}
.sh-env-lift{transition:transform .25s ease,filter .25s ease;filter:drop-shadow(0 18px 18px rgba(0,0,0,.5))}
.sh-env:hover:not(.opening) .sh-env-lift,.sh-env:focus-visible .sh-env-lift{transform:translateY(-10px);filter:drop-shadow(0 28px 24px rgba(0,0,0,.55))}
.sh-env-stage{position:relative;width:100%;aspect-ratio:480/420;perspective:1200px}
.sh-layer{position:absolute;inset:0;pointer-events:none}.sh-layer svg,.sh-flap-face svg{width:100%;height:100%;display:block;overflow:visible}
.sh-layer-back{z-index:0}.sh-layer-front{z-index:3}
.sh-card{position:absolute;z-index:2;left:12.5%;top:39.3%;width:75%;height:54.8%;pointer-events:none;background:var(--sh-cream);border:.6cqw solid #bda677;border-radius:.8cqw;box-shadow:0 .6cqw 2cqw rgba(0,0,0,.45)}
.sh-card-in{display:flex;gap:3cqw;align-items:center;height:100%;padding:2.2cqw 3cqw;color:var(--sh-ink);font-size:2.5cqw;line-height:1.35}
.sh-card-pol{width:21cqw;flex:none;transform:rotate(-4deg);filter:drop-shadow(0 .4cqw 1cqw rgba(0,0,0,.4))}.sh-card-pol>*{display:block;width:100%;height:auto}
.sh-env.ready .sh-card{pointer-events:auto}
.sh-card-best{margin-top:.6cqw;font-size:2.5cqw;color:#2a6b49}.sh-card-best b{font-weight:400;color:#1d4e35;font-size:3cqw;letter-spacing:.04em}
.sh-card-stamp{position:absolute;z-index:3;left:2%;top:16%;padding:.5cqw 1.4cqw;border:.5cqw solid #14683f;border-radius:.9cqw;background:#2f9e6b;color:#f7fbf3;font-size:3.2cqw;letter-spacing:.06em;line-height:1.1;transform:rotate(-11deg);pointer-events:none;box-shadow:0 .5cqw 1.4cqw rgba(0,0,0,.45),inset 0 0 0 .3cqw rgba(247,251,243,.55)}
.sh-card-hit{position:absolute;inset:0;z-index:2;width:100%;height:100%;padding:0;border:0;border-radius:.6cqw;background:transparent;cursor:pointer;outline:none}
.sh-card-hit:hover,.sh-card-hit:focus-visible{box-shadow:0 0 0 .7cqw var(--sh-brass),0 0 4cqw rgba(217,155,38,.55)}
.sh-card-sign{display:inline-block;margin-top:1.6cqw;padding:1cqw 2.4cqw;border:.45cqw solid var(--sh-crimson);border-radius:.6cqw;color:var(--sh-crimson);font-size:3.1cqw;letter-spacing:.06em;transform:rotate(-3deg);background:rgba(200,62,59,.07);animation:shSign 1.8s ease-in-out infinite;white-space:nowrap}
.sh-card:hover .sh-card-sign{background:var(--sh-crimson);color:var(--sh-cream)}
@keyframes shSign{50%{box-shadow:0 0 0 .8cqw rgba(200,62,59,.18)}}
.sh-card-txt .k{color:var(--sh-crimson);font-size:2.3cqw;letter-spacing:.08em}.sh-card-txt .h{font-size:4.1cqw;line-height:1.1;margin:.6cqw 0 1.2cqw}.sh-card-txt .s{margin-top:1.2cqw;color:#6a1a18}
.sh-flap{position:absolute;inset:0;z-index:4;pointer-events:none;transform-origin:50% 35.714%;transform-style:preserve-3d}
.sh-flap-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden}
.sh-flap-in{transform-origin:50% 35.714%;transform:rotateX(180deg)}
.sh-seal{position:absolute;z-index:5;left:50%;top:71.43%;width:15%;aspect-ratio:1;transform:translate(-50%,-50%);pointer-events:none;filter:drop-shadow(0 3px 4px rgba(0,0,0,.5));transition:filter .25s}
.sh-env:hover:not(.opening) .sh-seal,.sh-env:focus-visible .sh-seal{filter:drop-shadow(0 0 12px rgba(217,155,38,.95)) drop-shadow(0 0 26px rgba(200,62,59,.8));animation:shGlow 1.4s ease-in-out infinite}
.sh-env.tone-obsidian:hover:not(.opening) .sh-seal,.sh-env.tone-obsidian:focus-visible .sh-seal{filter:drop-shadow(0 0 12px rgba(240,242,248,.95)) drop-shadow(0 0 26px rgba(150,160,190,.75))}
.sh-seal-half{position:absolute;inset:0}.sh-seal-half svg{width:100%;height:100%;display:block}
.sh-seal-l{clip-path:inset(0 50% 0 0)}.sh-seal-r{clip-path:inset(0 0 0 50%)}
.sh-crack{position:absolute;inset:0;width:100%;height:100%;opacity:0}
.sh-env.opening .sh-crack{animation:shCrack 200ms ease-out forwards}
.sh-env.opening .sh-seal-l{animation:shSealL 420ms ease-in forwards}
.sh-env.opening .sh-seal-r{animation:shSealR 420ms ease-in forwards}
.sh-env.opening .sh-flap{animation:shFlap 520ms 180ms cubic-bezier(.3,.7,.3,1) forwards}
.sh-env.opening .sh-card{animation:shCard 420ms 430ms cubic-bezier(.2,.8,.2,1) forwards}
.sh-env.pre .sh-seal-l,.sh-env.pre .sh-seal-r{animation:none;opacity:0}.sh-env.pre .sh-crack{animation:none;opacity:0}
.sh-env.pre .sh-flap{animation:none;transform:rotateX(180deg);z-index:1}.sh-env.pre .sh-card{animation:none;transform:translateY(-88%)}
.sh-env-cq.mini.opened .sh-env-stage{margin-top:9cqw}
.sh-env-skip{margin:14px 0 0;text-align:center;font-size:14px}.sh-env-skip .sh-link{color:var(--sh-muted)}.sh-env-skip .sh-link:hover{color:var(--sh-cream)}
.sh-env-prompt.go{opacity:1;color:var(--sh-cream);max-width:460px;margin-left:auto;margin-right:auto}
.sh-env-prompt{margin:26px 0 0;color:var(--sh-brass);opacity:.8;transition:opacity .2s,letter-spacing .2s;font-size:clamp(14px,2.2vw,18px)}
.sh-env-cq:hover .sh-env-prompt{opacity:1;letter-spacing:.03em}
@keyframes shCrack{0%{opacity:0}100%{opacity:1}}
@keyframes shSealL{0%{transform:none;opacity:1}35%{transform:translateX(-5%) rotate(-5deg);opacity:1}100%{transform:translate(-45%,170%) rotate(-38deg);opacity:0}}
@keyframes shSealR{0%{transform:none;opacity:1}35%{transform:translateX(5%) rotate(5deg);opacity:1}100%{transform:translate(45%,170%) rotate(38deg);opacity:0}}
@keyframes shFlap{0%{transform:rotateX(0);z-index:4}49%{z-index:4}50%{z-index:1}100%{transform:rotateX(180deg);z-index:1}}
@keyframes shCard{0%{transform:translateY(0)}100%{transform:translateY(-88%)}}
@keyframes shGlow{0%,100%{opacity:1}50%{opacity:.82}}
@keyframes shPulse{0%,100%{transform:scale(.86);opacity:.75}50%{transform:scale(1.12);opacity:1}}
@keyframes shBlink{50%{opacity:.15}}

/* quick-scroll cue */
.sh-cue{position:fixed;right:max(14px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:40;background:var(--sh-crimson);color:#fff;border:0;border-radius:999px;padding:11px 18px;font-size:15px;cursor:pointer;box-shadow:0 10px 26px rgba(0,0,0,.5);animation:shBob 2.4s ease-in-out infinite}
.sh-cue:hover{background:#d84f4c}
@keyframes shBob{50%{transform:translateY(-4px)}}

/* homage + footer */
.sh-homage{display:flex;gap:16px;align-items:flex-start;max-width:760px;margin:0 auto 40px;padding:20px 24px;background:rgba(217,155,38,.08);border:1px solid rgba(217,155,38,.4);border-radius:12px;margin-inline:auto;width:calc(100% - 32px)}
.sh-homage-ico{font-size:28px}.sh-homage h2{margin:0 0 4px;font-size:20px;color:var(--sh-brass)}.sh-homage p{margin:0;color:var(--sh-cream)}
.sh-footer{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;padding:22px clamp(14px,3vw,32px) calc(22px + env(safe-area-inset-bottom));border-top:1px solid var(--sh-line);color:var(--sh-muted);font-size:14px}
.sh-footer nav{display:flex;flex-wrap:wrap;justify-content:center;gap:0 22px}
.sh-footer .sh-link{display:inline-flex;align-items:center;min-height:36px}
.sh-social{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 18px;margin:0 0 4px;padding:0;list-style:none}
.sh-social a{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;color:var(--sh-cream);border-radius:10px;transition:color .15s,transform .15s}
.sh-social a:hover,.sh-social a:focus-visible{color:var(--sh-brass);transform:translateY(-2px)}

/* modal */
.sh-backdrop{position:fixed;inset:0;z-index:100;background:rgba(6,6,9,.78);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;color:var(--sh-cream)}
.sh-modal{width:min(460px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;background:#1c1c25;border:1px solid #34344a;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.7);outline:none}
.sh-modal.wide{width:min(720px,100%)}
.sh-modal-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--sh-line)}
.sh-modal-head h2{margin:0;font-size:clamp(18px,3vw,22px);color:var(--sh-brass)}
.sh-x{background:none;border:0;color:var(--sh-muted);font-size:28px;line-height:1;cursor:pointer;padding:0 4px}.sh-x:hover{color:var(--sh-cream)}
.sh-modal-body{padding:20px;overflow:auto}
.sh-legal p{margin:0 0 14px;color:#dcd7cb;font-size:15px}.sh-legal section{margin-top:20px}.sh-legal h3{margin:0 0 6px;color:var(--sh-brass);font-size:17px}
.sh-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.sh-row.end{justify-content:flex-end;margin-top:16px}
.sh-label{display:block;font-size:13px;color:var(--sh-muted);margin:12px 0 6px}
.sh-input{flex:1;min-width:0;background:#13131a;border:1px solid #34344a;border-radius:10px;padding:10px 12px;color:var(--sh-cream);font:600 16px 'Barlow',sans-serif}
.sh-input:focus{outline:none;border-color:var(--sh-brass);box-shadow:0 0 0 3px rgba(217,155,38,.2)}
.sh-badge{margin:10px 0 0;font-weight:600;font-size:14px;min-height:22px}.sh-badge.ok{color:var(--sh-green)}.sh-badge.bad{color:var(--sh-crimson)}.sh-badge.idle{color:var(--sh-muted)}

/* shared play-header bits (ShadokuApp) */
.sh-header--play{gap:10px}.sh-header--play .sh-logo{height:34px}.sh-left{display:flex;align-items:center;gap:12px;min-width:0}

@media (max-width:760px){
  .sh-show1{grid-template-columns:1fr}.sh-split{grid-template-columns:1fr}.sh-split>div+div{border-inline-start:0;padding-inline-start:0;border-top:2px dashed var(--sh-line);padding-top:10px}
  .sh-userchip .sh-userchip-name{display:none}.sh-userchip{padding:3px 6px 3px 3px}.sh-select{max-width:144px}
  .sh-tape{width:72px;margin-left:-36px}
}
@media (max-width:640px){.sh-hide-m{display:none!important}}
@media (max-width:420px){.sh-header .sh-btn.ghost.sm{display:none}.sh-header{gap:6px;padding-inline:10px}.sh-header-r{gap:6px}.sh-header .sh-logo img{max-width:30vw}.sh-header .sh-select{max-width:108px;padding-inline:10px 20px}.sh-header .sh-select-ico{display:none}.sh-header .sh-select-caret{inset-inline-end:7px}.sh-logo img{max-width:34vw}.sh-controls{gap:6px}}
@media (max-width:380px){.sh-header{gap:4px;padding-inline:8px}.sh-header-r,.sh-controls{gap:4px}.sh-header .sh-logo img{max-width:25vw}.sh-header .sh-select{max-width:92px;padding-inline:8px 18px}.sh-burger{width:38px}}
@media (prefers-reduced-motion:reduce){
  .sh-env-lift,.sh-btn,.sh-folder{transition:none}.sh-cue,.sh-target::before,.sh-rec i,.sh-env:hover .sh-seal{animation:none}
  .sh-env.opening .sh-seal-l,.sh-env.opening .sh-seal-r{animation:none;opacity:0}
  .sh-env.opening .sh-flap{animation:none;transform:rotateX(180deg);z-index:1}
  .sh-env.opening .sh-card{animation:none;transform:translateY(-74%)}
}
`;

export function GlobalStyles() {
  return <style data-shadoku="home">{SHADOKU_CSS}</style>;
}
