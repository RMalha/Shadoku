/* eslint-disable react/prop-types */
/**
 * ShadokuPages.jsx — the site's plain pages, around the same header and footer as the landing page.
 *
 *   /about                 AboutPage     what Shadoku is, how a puzzle is made, the homage
 *   /contact               ContactPage   the e-mail, and what to put in a report
 *   /profile               ProfilePage   (signed in) Info: avatar, codename, name, e-mail, sign-in provider
 *   /profile/stats                       Stats: contracts played and fulfilled, relics, hints, fastest time per difficulty
 *   /profile/collection                  Collection: the ten relics of The Umbra Conspiracy (umbra.jsx), and the Evidence Board once all are in
 *   /test/umbra            TestUmbraPage not linked: the Evidence Board and Dossier № 000-OMEGA without the ten relics (test mode: nothing is saved)
 *
 * Signed out, /profile asks you to sign in. Progress is read from this browser's storage (ShadokuGame's readPlayStats); signed in
 * with the backend, src/sync.js merges that storage with the account's copy, so the numbers are the same on every device.
 * Every string is a ui.about.*, ui.contact.* or ui.profile.* key in src/locales/en.json.
 */
import React, { useEffect, useMemo, useState } from "react";
import { SiteHeader, SiteFooter, useLang, useAuth, useModals, AuthButtons, Avatar, Rich, CONTACT_EMAIL, PROFILE_PAGES, ContractEnvelope, CoffeeCard } from "./ShadokuHome.jsx";
import { PUZZLES, normalizePuzzles, readPlayStats, fmtTime, dailyRecords } from "./ShadokuGame.jsx";
import { RelicCollection, EvidenceBoard, FinalDossier, ObsidianEnvelope, OmegaFolder, RELIC_CASES, UMBRA_HARD, UMBRA_FINALE, isUnlocked, resetUmbraLocks, useUmbraTick } from "./umbra.jsx";
import { MasterPolaroid } from "./ShadokuArt.jsx";
import { localizeHead, trOf } from "./caseText.js";
import { useProgressTick } from "./sync.js";

/** The difficulty groups, easiest first (the contracts page uses the same order). */
export const DIFF_ORDER = ["Tutorial", "Very Easy", "Easy", "Medium", "Hard", "Expert"];

/** Sets document.title to t(key) while the page is open. */
function usePageTitle(key) {
  const { t } = useLang();
  useEffect(() => {
    const prev = document.title;
    document.title = t(key);
    return () => { document.title = prev; };
  }, [t, key]);
}

/** Header + a centred column + footer. `current` marks the page in the ☰ menu. */
function Page({ go, current, children, wide = false }) {
  return (
    <div className="sh-root sh-pageroot">
      <style data-shadoku="pages">{PAGES_CSS}</style>
      <SiteHeader onLogo={() => go("/")} onNav={go} current={current} />
      <main className={`sh-page${wide ? " wide" : ""}`}>{children}</main>
      <SiteFooter />
    </div>
  );
}

/* ═════════════════════════ /about ═════════════════════════ */
export function AboutPage({ go }) {
  const { t } = useLang();
  usePageTitle("page.about");
  return (
    <Page go={go} current="/about">
      <h1 className="sh-type">{t("about.title")}</h1>
      <p className="sh-page-lead">{t("about.lead")}</p>
      {[1, 2, 3].map((n) => (
        <section key={n} className="sh-pcard">
          <h2 className="sh-type">{t(`about.s${n}.h`)}</h2>
          <p><Rich text={t(`about.s${n}.p`)} /></p>
        </section>
      ))}
      <CoffeeCard />
      <div className="sh-page-cta">
        <button type="button" className="sh-btn" onClick={() => go("/play")}>{t("about.play")}</button>
        <button type="button" className="sh-btn ghost" onClick={() => go("/contact")}>{t("nav.contact")}</button>
      </div>
    </Page>
  );
}

/* ═════════════════════════ /contact ═════════════════════════ */
export function ContactPage({ go }) {
  const { t } = useLang();
  usePageTitle("page.contact");
  return (
    <Page go={go} current="/contact">
      <h1 className="sh-type">{t("contact.title")}</h1>
      <p className="sh-page-lead">{t("contact.lead")}</p>
      <section className="sh-pcard sh-contact">
        <span className="sh-contact-ico" aria-hidden="true">✉</span>
        <div>
          <p className="sh-muted sm">{t("contact.emailLabel")}</p>
          <a className="sh-contact-mail" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </div>
        <a className="sh-btn" href={`mailto:${CONTACT_EMAIL}`}>{t("contact.write")}</a>
      </section>
      <section className="sh-pcard">
        <h2 className="sh-type">{t("contact.tips.h")}</h2>
        <ul className="sh-page-list">
          {[1, 2, 3].map((n) => <li key={n}>{t(`contact.tips.${n}`)}</li>)}
        </ul>
        <p className="sh-muted sm">{t("contact.reply")}</p>
      </section>
    </Page>
  );
}

/* ═════════════════════════ /profile ═════════════════════════ */
/** `tab`: "info" | "stats" | "collection". `onLaunch(id)` opens a contract (the Evidence Board's "Enter …" button). */
export function ProfilePage({ go, tab = "info", puzzles, onLaunch }) {
  const { t } = useLang();
  const { user, signOut } = useAuth();
  const page = PROFILE_PAGES.find((m) => m.key === tab) || PROFILE_PAGES[0];
  usePageTitle("page.profile");
  return (
    <Page go={go} current={page.to} wide>
      <h1 className="sh-type">{t("profile.title")}</h1>
      {!user ? (
        <section className="sh-pcard sh-psignin">
          <p>{t("profile.signedOut")}</p>
          <AuthButtons />
        </section>
      ) : <>
        <nav className="sh-tabs" aria-label={t("profile.title")}>
          {PROFILE_PAGES.map((m) => (
            <a key={m.key} href={m.to} className={m.key === page.key ? "on" : ""} aria-current={m.key === page.key ? "page" : undefined}
              onClick={(e) => { e.preventDefault(); go(m.to); }}>{t(`profile.tab.${m.key}`)}</a>
          ))}
          <button type="button" className="sh-btn ghost sm sh-tabs-out" onClick={signOut}>{t("nav.logOut")}</button>
        </nav>
        {page.key === "info" && <ProfileInfo user={user} />}
        {page.key === "stats" && <ProfileStats puzzles={puzzles} />}
        {page.key === "collection" && <ProfileCollection puzzles={puzzles} onLaunch={onLaunch} />}
      </>}
    </Page>
  );
}

function ProfileInfo({ user }) {
  const { t } = useLang();
  const modals = useModals();
  const rows = [
    ["profile.info.name", user.displayName],
    ["profile.info.email", user.email],
    ["profile.info.provider", user.provider === "github" ? "GitHub" : user.provider === "google" ? "Google" : user.provider],
  ];
  return (
    <section className="sh-pcard sh-pinfo">
      <div className="sh-pinfo-top">
        <Avatar user={user} />
        <div className="sh-pinfo-who">
          <span className="sh-muted sm">{t("creds.codename")}</span>
          <span className="sh-pinfo-name sh-type">{user.username}</span>
        </div>
        <button type="button" className="sh-btn ghost sm" onClick={modals.openCodename}>{t("creds.change")}</button>
      </div>
      <dl className="sh-dl">
        {rows.map(([k, v]) => <React.Fragment key={k}><dt>{t(k)}</dt><dd>{v || "—"}</dd></React.Fragment>)}
      </dl>
      {user.demo && <p className="sh-muted sm">{t("creds.demo")}</p>}
      <p className="sh-muted sm">{t(user && !user.demo ? "profile.info.synced" : "profile.info.local")}</p>
    </section>
  );
}

const usePack = (puzzles) => useMemo(() => (puzzles ? normalizePuzzles(puzzles) : PUZZLES), [puzzles]);

function ProfileStats({ puzzles }) {
  const { t } = useLang();
  const { user } = useAuth();
  const story = usePack(puzzles);
  const progressTick = useProgressTick(); // a sync brought another device's progress
  const pack = useMemo(() => [...story, ...dailyRecords()], [story, progressTick]); // eslint-disable-line react-hooks/exhaustive-deps -- the daily contracts count too, rotated-out ones included
  const stats = useMemo(() => readPlayStats(pack), [pack]);
  const trf = useMemo(() => trOf(t), [t]);
  const of = (q) => stats[q.id] || {};
  const played = pack.filter((q) => of(q).played).length;
  const solved = pack.filter((q) => of(q).solved).length;
  const daily = pack.filter((q) => q.daily && of(q).solved).length;
  const relics = RELIC_CASES.filter((id) => stats[id] && stats[id].solved).length;
  const hints = (k) => pack.reduce((n, q) => n + ((of(q).hints || {})[k] || 0), 0); // hint rungs: where to look / key deduction / placement
  const byDiff = new Map();
  pack.forEach((q) => { const d = q.difficulty || "Easy"; if (!byDiff.has(d)) byDiff.set(d, []); byDiff.get(d).push(q); });
  const diffs = [...DIFF_ORDER.filter((d) => byDiff.has(d)), ...[...byDiff.keys()].filter((d) => !DIFF_ORDER.includes(d))];
  const tiles = [
    ["profile.stats.played", played, null],
    ["profile.stats.fulfilled", solved, pack.length],
    ["profile.stats.daily", daily, null],
    ["profile.stats.relics", relics, RELIC_CASES.length],
    ["profile.stats.hintsLook", hints("look"), null],
    ["profile.stats.hintsKey", hints("key"), null],
    ["profile.stats.hintsPlace", hints("place"), null],
  ];
  return <>
    <section className="sh-tiles" aria-label={t("profile.tab.stats")}>
      {tiles.map(([k, n, total]) => (
        <div key={k} className="sh-tile">
          <b>{n}{total !== null && <small>/{total}</small>}</b>
          <span>{t(k)}</span>
        </div>
      ))}
    </section>
    <section className="sh-pcard">
      <h2 className="sh-type">{t("profile.stats.fastestTitle")}</h2>
      <table className="sh-stbl">
        <thead><tr><th scope="col">{t("profile.stats.difficulty")}</th><th scope="col">{t("profile.stats.fulfilled")}</th><th scope="col">{t("profile.stats.fastest")}</th></tr></thead>
        <tbody>
          {diffs.map((d) => {
            const items = byDiff.get(d), done = items.filter((q) => of(q).solved);
            const best = done.reduce((a, q) => (!a || of(q).best < of(a).best ? q : a), null);
            return (
              <tr key={d}>
                <th scope="row"><span className={`sh-diff d-${d.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{localizeHead({ difficulty: d }, trf).difficulty}</span></th>
                <td>{done.length}/{items.length}</td>
                <td>{best ? <><b>{fmtTime(of(best).best)}</b> <small>{localizeHead(best, trf).title}</small></> : <span className="sh-muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="sh-muted sm">{t(user && !user.demo ? "profile.info.synced" : "profile.info.local")}</p>
    </section>
  </>;
}

function ProfileCollection({ puzzles, onLaunch }) {
  const pack = usePack(puzzles);
  const progressTick = useProgressTick();
  const solved = useMemo(() => { const s = readPlayStats(pack); return new Set(Object.keys(s).filter((id) => s[id].solved)); }, [pack, progressTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [board, setBoard] = useState(false);
  return (
    <section className="sh-pcard">
      <RelicCollection solved={solved} onOpenBoard={() => setBoard(true)} />
      {board && <EvidenceBoard onClose={() => setBoard(false)} onLaunch={onLaunch ? (id) => { setBoard(false); onLaunch(id); } : null} />}
    </section>
  );
}

/* ═════════════════════════ /test/umbra ═════════════════════════ */
/**
 * A test bench for the endgame, for the developer: not linked from any menu, so its few lines are plain English (no locale keys).
 * The Evidence Board opens fresh every time (test mode: solving it unlocks nothing), and the Dossier's envelope can be accepted
 * without opening the finale. The last card shows the two real locks and can seal them again.
 */
export function TestUmbraPage({ go, puzzles }) {
  const pack = usePack(puzzles);
  const tick = useUmbraTick();
  const [open, setOpen] = useState(null); // "board" | "dossier" | null
  const [run, setRun] = useState(0); // a fresh board on every opening
  const [note, setNote] = useState("");
  const finale = pack.find((q) => q.id === UMBRA_FINALE) || null;
  const solved = useMemo(() => { const s = readPlayStats(pack); return new Set(Object.keys(s).filter((id) => s[id].solved)); }, [pack, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const lock = (id) => (isUnlocked(id, solved) ? "open" : "sealed");
  const accept = () => { setOpen(null); setNote("Accepted. Test mode: the finale stays as it was."); };
  return (
    <Page go={go} current="/test/umbra">
      <h1 className="sh-type">Umbra test bench</h1>
      <p className="sh-page-lead">The endgame without the ten relics. Nothing on this page saves progress or unlocks a contract.</p>
      <section className="sh-pcard sh-test">
        <ObsidianEnvelope small onOpen={() => { setRun((n) => n + 1); setOpen("board"); }} />
        <div><h2 className="sh-type">The Evidence Board</h2><p>The ten torn strips in their starting order, and the brass dials. Opens unsolved every time.</p></div>
      </section>
      <section className="sh-pcard sh-test">
        <OmegaFolder small onOpen={() => { setNote(""); setOpen("dossier"); }} />
        <div><h2 className="sh-type">Dossier № 000-OMEGA</h2><p>U. M. Bra&apos;s own file, taken from N. O. Ir, and the Uninvited&apos;s sealed black envelope.</p>{note && <p className="sh-test-note">{note}</p>}</div>
      </section>
      <section className="sh-pcard">
        <h2 className="sh-type">The real locks in this browser</h2>
        <p>The Uninvited Guests: <b>{lock(UMBRA_HARD)}</b> · Five Shadows at the Manor: <b>{lock(UMBRA_FINALE)}</b> (a fulfilled contract stays open).</p>
        <button type="button" className="sh-btn ghost sm" onClick={resetUmbraLocks}>Seal both again</button>
      </section>
      {open === "board" && <EvidenceBoard key={run} test onClose={() => setOpen(null)} onLaunch={null} />}
      {open === "dossier" && (
        <FinalDossier onClose={() => setOpen(null)} onAccept={accept}
          envelope={finale && ((onOpen) => <ContractEnvelope variant="modal" puzzle={finale} label="CONTRACT № 012" onAccept={accept} onOpen={onOpen} tone="obsidian" target={<MasterPolaroid size={200} tilt={2} />} autoOpen={false} />)} />
      )}
    </Page>
  );
}

const PAGES_CSS = `
.sh-pageroot{display:flex;flex-direction:column}
.sh-page{flex:1 0 auto;width:100%;max-width:760px;margin:0 auto;padding:clamp(22px,4vw,44px) clamp(14px,3vw,28px) 40px}
.sh-page.wide{max-width:980px}
.sh-page h1{margin:0 0 12px;font-size:clamp(28px,5vw,42px);line-height:1.1;color:var(--sh-cream);text-align:center}
.sh-page-lead{margin:0 auto 24px;max-width:620px;text-align:center;color:#d9d3c4;font-size:clamp(16px,2vw,18px)}
.sh-pcard{margin:0 0 16px;padding:clamp(16px,3vw,24px);border-radius:14px;background:linear-gradient(180deg,#20202b,#181820);border:1px solid var(--sh-line);box-shadow:0 14px 34px rgba(0,0,0,.35)}
.sh-pcard h2{margin:0 0 8px;font-size:clamp(19px,2.6vw,23px);color:var(--sh-brass)}
.sh-pcard p{margin:0 0 10px;color:#dcd7cb}.sh-pcard p:last-child{margin-bottom:0}
.sh-page-cta{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:22px}
.sh-page-list{margin:0 0 12px;padding-inline-start:20px;color:#dcd7cb}.sh-page-list li{margin:0 0 6px}
.sh-contact{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.sh-contact>div{flex:1 1 220px;min-width:0}.sh-contact .sh-muted{margin:0}
.sh-contact-ico{display:grid;place-items:center;width:52px;height:52px;border-radius:50%;background:rgba(217,155,38,.14);color:var(--sh-brass);font-size:26px}
.sh-contact-mail{display:block;font:700 clamp(17px,2.4vw,20px) 'Barlow',sans-serif;color:var(--sh-cream);word-break:break-all;text-decoration:none}
.sh-contact-mail:hover{color:var(--sh-brass)}
.sh-contact a.sh-btn{text-decoration:none}
.sh-psignin{max-width:460px;margin-inline:auto}.sh-psignin>p{text-align:center}
.sh-tabs{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 16px;padding:5px;border-radius:12px;background:#1c1c25;border:1px solid var(--sh-line)}
.sh-tabs a{padding:9px 16px;border-radius:9px;color:var(--sh-cream);text-decoration:none;font:600 15px 'Barlow',sans-serif}
.sh-tabs a:hover{background:rgba(217,155,38,.1)}.sh-tabs a.on{background:var(--sh-brass);color:#1a1408}
.sh-tabs-out{margin-inline-start:auto}
.sh-pinfo-top{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px}
.sh-pinfo .sh-avatar{width:72px;height:72px;font-size:30px}
.sh-pinfo-who{display:flex;flex-direction:column;flex:1 1 160px;min-width:0}
.sh-pinfo-name{font-size:clamp(22px,3.4vw,28px);color:var(--sh-brass);overflow-wrap:anywhere}
.sh-dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 18px;margin:0 0 14px;padding:14px 0 0;border-top:1px solid var(--sh-line)}
.sh-dl dt{color:var(--sh-muted);font-weight:600}.sh-dl dd{margin:0;color:var(--sh-cream);overflow-wrap:anywhere}
.sh-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 16px}
.sh-tile{display:flex;flex-direction:column;gap:2px;padding:14px 16px;border-radius:14px;background:#1c1c25;border:1px solid var(--sh-line);border-top:3px solid var(--sh-brass)}
.sh-tile b{font:400 clamp(26px,4vw,34px)/1.1 'Special Elite',monospace;color:var(--sh-cream)}.sh-tile b small{font-size:.55em;color:var(--sh-muted)}
.sh-tile span{color:var(--sh-muted);font-size:14px;font-weight:600}
.sh-stbl{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:15px}
.sh-stbl th,.sh-stbl td{padding:10px 8px;text-align:start;border-bottom:1px solid #2a2a38;vertical-align:middle}
.sh-stbl thead th{color:var(--sh-muted);font-size:12.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.sh-stbl td b{font:400 18px 'Special Elite',monospace;color:var(--sh-cream)}.sh-stbl td small{color:var(--sh-muted);font-size:13px}
.sh-diff{display:inline-block;font:400 15px 'Special Elite',monospace;padding:2px 10px;border-radius:4px;background:#2a2a36;border-left:4px solid var(--sh-brass);white-space:nowrap}
.sh-diff.d-tutorial{border-color:#8ea0ff}.sh-diff.d-very-easy{border-color:#58b784}.sh-diff.d-easy{border-color:#8fcf5a}.sh-diff.d-medium{border-color:#D99B26}.sh-diff.d-hard{border-color:#e0743a}.sh-diff.d-expert{border-color:#C83E3B}
.sh-test{display:flex;align-items:center;gap:16px}.sh-test>div{flex:1 1 auto;min-width:0}.sh-test-note{color:#7fe0b4!important;font-weight:600}
@media (max-width:640px){.sh-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.sh-stbl{font-size:14px}.sh-stbl th,.sh-stbl td{padding:8px 4px}.sh-tabs a{padding:8px 11px}}
`;
