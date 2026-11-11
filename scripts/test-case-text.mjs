// Renders every clue, house rule, hint step (text + rule) and title of all shipped cases from their TOKENS with src/locales/en.json
// (src/caseText.js) and requires an exact match with the English stored in each case JSON.   npm run test:case-text
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { caseRenderer, localizeHead, localizeCase } from "../src/caseText.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const en = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "locales", "en.json"), "utf8"));
const tr = (k) => en[k];
// the engine folders exist on the maintainer's PC only; the public repo (and its CI) has the same cases in src/puzzles
const dirs = fs.existsSync(path.join(ROOT, "engine", "puzzles")) ? ["engine/puzzles", "engine/puzzles_multi"] : ["src/puzzles"];
const files = dirs.flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => /^shadoku_.*\.json$/.test(f) && !/^shadoku_daily-/.test(f)).map((f) => path.join(ROOT, d, f)));
let n = 0; const bad = [];
const eq = (where, got, want) => { n++; if (got !== want) bad.push(`${where}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); };
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(f, "utf8")), id = d.id, R = caseRenderer(d, tr);
  const run = (where, fn, want) => { try { eq(`${id} ${where}`, fn(), want); } catch (e) { n++; bad.push(`${id} ${where}: ${e.message}`); } };
  for (const s of d.suspects) run(`clue ${s.id}`, () => R.strict.clue(s.id), s.clue);
  for (const a of d.assassins || []) run(`assassin ${a.id}`, () => R.strict.assassinClue(a), a.clue);
  for (const g of d.globalRules || []) run(`house rule ${g.id}`, () => R.strict.globalRule(g), g.text);
  for (const st of d.steps || []) { run(`step ${st.n} text`, () => R.strict.step(st), st.text); run(`step ${st.n} rule`, () => R.strict.stepRule(st), st.rule); }
  const h = localizeHead(d, tr);
  eq(`${id} title`, h.title, d.title); eq(`${id} subtitle`, h.subtitle, d.subtitle); eq(`${id} difficulty`, h.difficulty, d.difficulty);
  const L = localizeCase(d, tr);
  d.roomNames.forEach((nm, i) => eq(`${id} room ${i}`, L.roomLabels[i], nm));
  // localizeCase must keep the English whenever a locale lacks a template (no crash, no raw key)
  const L2 = localizeCase(d, () => undefined);
  d.suspects.forEach((s, i) => eq(`${id} fallback clue ${s.id}`, L2.suspects[i].clue, s.clue));
  (d.steps || []).forEach((s, i) => eq(`${id} fallback step ${s.n}`, L2.steps[i].text, s.text));
}
if (bad.length) { console.log(bad.slice(0, 40).join("\n")); console.log(`FAIL ${bad.length} of ${n} checks (${files.length} cases)`); process.exit(1); }
console.log(`ok  ${n} checks on ${files.length} cases: every clue, house rule, step text/rule, title, subtitle, difficulty and room name matches the stored English`);
