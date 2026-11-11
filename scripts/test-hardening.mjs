// Regression checks for the 2026-11 audit fixes that run in plain node (no JSX): the word filter, the sign-in return path, the
// community case check (src/creatorCore.js checkCase) and the avatar code check.   npm run test:hardening
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { badWordIn } from "../src/wordFilter.js";
import { safeReturn } from "../functions/_lib/auth.js";
import { avatarOk } from "../functions/_lib/db.js";
import { checkCase } from "../src/creatorCore.js";
import { hit } from "../functions/_lib/ratelimit.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let n = 0; const bad = [];
const ok = (what, cond) => { n++; if (!cond) bad.push(what); };

// security-07: word filter bypasses (each must be refused) and harmless words (each must pass)
for (const w of ["fuck", "sh1t", "f u c k", "f*ck", "fu​ck", "f‍u⁠c­k", "сunt", "fuсk", "ni99er", "n1663r", "niggerz", "Thenigger", "cuntface", "shitshow", "fu ck", "f-uck", "sh.it x f-uck", "fvck", "phuck", "ƒuck"])
  ok(`filter should refuse ${JSON.stringify(w)}`, !!badWordIn(w));
for (const w of ["Assassin", "Peacock", "Scunthorpe", "Glass House", "Mother Fox", "The Grand Hotel", "Room 6", "Class Hole Punch", "Cocktail Hour", "Niger"])
  ok(`filter should allow ${JSON.stringify(w)}`, !badWordIn(w));

// security-04: open redirect through a tab
for (const r of ["/\t/evil.example", "//evil.example", "/\\evil.example", "https://evil.example", "/\n/x", "/ok path"]) ok(`safeReturn ${JSON.stringify(r)}`, safeReturn(r) === "/");
for (const r of ["/", "/play/case1", "/daily?x=1&y=2#top"]) ok(`safeReturn keeps ${r}`, safeReturn(r) === r);

// security-01: avatar codes
const good = "L:m.0.x.x.none.0.none.0.none.none.0.x.0.x.x.x.0";
ok("avatarOk good", avatarOk(good) && avatarOk("") && avatarOk("photo"));
ok("avatarOk 17 fields only", !avatarOk("L:a.b"));
for (const p of ["constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "toLocaleString", "propertyIsEnumerable"]) {
  const f = good.slice(2).split("."); f[15] = p;
  ok(`avatarOk refuses a ${p} field`, !avatarOk("L:" + f.join(".")));
}

// security-03 / engine-02 (partly): checkCase on a published daily with doctored clue parts
// the engine folder exists on the maintainer's PC only; the public repo (and its CI) has the same cases in src/puzzles
const dir = fs.existsSync(path.join(ROOT, "engine", "puzzles")) ? path.join(ROOT, "engine", "puzzles") : path.join(ROOT, "src", "puzzles");
const base = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).filter((f) => /^shadoku_case1\.json$/.test(f))[0]), "utf8"));
const community = (mut) => {
  const d = JSON.parse(JSON.stringify(base));
  d.suspects.forEach((s) => { s.atoms = [{ kind: "ROOM", subject: s.id, params: { room: d.roomIds[d.rooms[s.solution[0]][s.solution[1]]] } }]; });
  mut(d); return checkCase(d);
};
ok("a plain ROOM case passes", community(() => {}).length === 0);
ok("NOT_ROOM without params is refused", community((d) => { d.suspects[0].atoms = [{ kind: "NOT_ROOM", subject: d.suspects[0].id, params: {} }]; }).length > 0);
ok("prototype-named param is refused", community((d) => { d.suspects[0].atoms[0].params.constructor = "x"; }).length > 0);
ok("__proto__ param does not throw", (() => { try { community((d) => { d.suspects[0].atoms[0].params = JSON.parse('{"__proto__":1}'); }); return true; } catch { return false; } })());
ok("atoms as a string does not throw", (() => { try { return community((d) => { d.suspects[0].atoms = "abc"; }).length > 0; } catch { return false; } })());
ok("bad word in a zone name is refused", community((d) => { d.roomNames[0] = "fuck"; }).length > 0);
ok("bad word in a scapegoat name is refused", community((d) => { d.suspects[0].name = d.suspects[0].id + "fuck"; }).length > 0);
ok("bad word in a clue text is refused", community((d) => { d.suspects[0].clue = "what the fuck"; }).length > 0);
ok("bad word in the stored 400 characters of a long clue is refused", community((d) => { d.suspects[0].clue = "x ".repeat(100) + "fuck" + " y".repeat(50000); }).length > 0);
ok("a long clue is read up to the 400 characters the server stores (a bad word after them is cut, not scanned)", community((d) => { d.suspects[0].clue = "x".repeat(450) + " fuck"; }).length === 0);
ok("a 96 KB clue text is cheap to check", (() => { const t = performance.now(); community((d) => { d.suspects[0].clue = "f*ck ".repeat(20000); }); return performance.now() - t < 100; })());
ok("too many prop classes are refused", community((d) => { for (let i = 0; i < 2000; i++) d.propClasses["ZZ" + i] = "LOW"; }).length > 0);

// rate limiting (functions/_lib/ratelimit.js hit): a fixed window per key, a fresh count in the next window, keys never mix
{
  const rows = new Map();
  const fake = { prepare: () => ({ bind: (k, w) => ({ first: async () => { const id = k + "|" + w; const n = (rows.get(id) || 0) + 1; rows.set(id, n); return { n }; } }) }) };
  const T = Date.UTC(2026, 10, 11, 12, 0, 5);
  const ns = []; for (let i = 0; i < 4; i++) ns.push((await hit(fake, "play:u:a", 600, T)).n);
  ok("rate limit counts 1,2,3,4 inside one window", ns.join() === "1,2,3,4");
  const r = await hit(fake, "play:u:a", 600, T);
  ok("rate limit says when the window ends (1..600 s)", r.retry >= 1 && r.retry <= 600);
  ok("rate limit starts over in the next window", (await hit(fake, "play:u:a", 600, T + 600 * 1000)).n === 1);
  ok("rate limit keeps keys apart", (await hit(fake, "play:u:b", 600, T)).n === 1);
}

console.log(`${n} checks, ${bad.length} failed`);
bad.forEach((b) => console.log("  FAIL " + b));
process.exit(bad.length ? 1 : 0);
