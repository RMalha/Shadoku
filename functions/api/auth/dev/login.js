// GET /api/auth/dev/login                     →  a form: sign in as a test player (LOCAL TESTING ONLY)
// GET /api/auth/dev/login?name=Agent_7&return=/profile/ranking  →  session cookie + codename, then back to `return`
// GET /api/auth/dev/login?seed=1              →  adds six sample players to the local ranking
// Works only when DEV_LOGIN=1 is set (never in production: `wrangler pages dev … --binding DEV_LOGIN=1`) AND the page is served
// from localhost, so several accounts can test the ranking and the community puzzles without Google or GitHub. Otherwise 404.
import { seal, setCookie, redirect, safeReturn, setCodename, json, SESSION_DAYS, USERNAME_RE } from "../../../_lib/auth.js";
import { db } from "../../../_lib/db.js";
import { rankStats } from "../../../../src/ranking.js";

const local = (request) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(request.url).hostname);
const SAMPLES = [["VelvetPhantom_64", 14, 1.1, 0], ["SilentRook_17", 11, 0.8, 2], ["CrimsonCourier_88", 9, 1.4, 1], ["GhostSleeper_23", 6, 0.6, 6], ["BrassRaven_301", 4, 2.2, 0], ["HollowMask_45", 2, 1.0, 9]];
const LOOKS = [ // their avatars (src/avatarLook.js); the last one keeps S. H. Adow
  "L:f.1.bob.red.none.0.round.3.none.scarf.1.shirtCrewNeck.1.default.defaultNatural.smile.0",
  "L:m.3.shortFlat.black.hat.2.none.0.moustacheFancy.necktie.0.blazerAndSweater.0.squint.default.serious.1",
  "L:f.4.curvy.black.none.0.sunglasses.0.none.none.0.blazerAndShirt.3.happy.raisedExcitedNatural.twinkle.2",
  "L:m.0.shaggy.blonde.winterHat03.4.none.0.beardLight.none.0.hoodie.2.default.defaultNatural.default.3",
  "L:m.2.bald.none.none.0.prescription01.2.beardMajestic.bowtie.1.blazerAndShirt.5.side.flatNatural.serious.4",
  "",
];
const DIFFS = ["Tutorial", "Very Easy", "Easy", "Easy", "Medium", "Medium", "Hard", "Expert"];

const page = (msg = "") => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test sign-in</title><style>body{font:16px system-ui;background:#141419;color:#f5f0e6;max-width:520px;margin:40px auto;padding:0 16px}
input,button{font:inherit;padding:8px 12px;border-radius:8px;border:1px solid #555;background:#20202b;color:inherit}button{background:#d99b26;color:#1a1408;border:0;font-weight:700;cursor:pointer}
a{color:#d99b26}p.note{color:#aaa;font-size:14px}</style>
<h1>Test sign-in (local only)</h1><p class="note">Signs this browser in as a test player. Use another browser or a private window for a second player.</p>
${msg ? `<p>${msg}</p>` : ""}
<form method="get"><label>Codename <input name="name" pattern="[A-Za-z0-9_]{3,20}" required value="TestAgent_${Math.floor(Math.random() * 900) + 100}"></label>
<input type="hidden" name="return" value="/profile/ranking"> <button>Sign in</button></form>
<p><a href="?seed=1">Add six sample players to the ranking</a> · <a href="/">Back to the site</a></p>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

export async function onRequestGet({ request, env }) {
  if (env.DEV_LOGIN !== "1" || !local(request)) return json({ error: "not_found" }, 404);
  const url = new URL(request.url);
  if (url.searchParams.get("seed")) {
    const d = await db(env);
    if (!d) return page("No database: start wrangler with --d1 SHADOKU_DB.");
    await d.batch(SAMPLES.map(([name, n, pace, hints], i) => {
      const entries = Array.from({ length: n }, (_, j) => ({ d: DIFFS[j % DIFFS.length], t: Math.round((200 + 90 * j) * pace), p: j < hints ? 1 : 0, l: j < hints ? 1 : 0 }));
      const st = rankStats(entries);
      return d.prepare(`INSERT OR REPLACE INTO players (id, codename, avatar, solved, hints, seconds, speed, score, updated) VALUES (?1, ?2, ?9, ?3, ?4, ?5, ?6, ?7, ?8)`)
        .bind(`dev-sample:${i}`, name, st.solved, st.hints, st.seconds, st.speed, st.score, Date.now() - i, LOOKS[i]);
    }));
    return page("Six sample players are in the ranking.");
  }
  const name = url.searchParams.get("name");
  if (!name) return page();
  if (!USERNAME_RE.test(name)) return page("3–20 letters, numbers or underscores.");
  const id = `dev:${name.toLowerCase()}`;
  await setCodename(env, id, name);
  const session = await seal(env, { id, provider: "dev", name, email: "", avatar: "" }, SESSION_DAYS * 86400);
  return redirect(safeReturn(url.searchParams.get("return")), [setCookie(request, "sh_session", session, SESSION_DAYS * 86400)]);
}
