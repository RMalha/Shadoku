// Placeholder check for src/locales/*.json (npm run check:i18n).
// en.json is the reference: every locale must be one flat object of dotted keys with string values,
// and each translated key must use the same placeholder names as en.json ({name}, {room|in} -> room).
// Formatters after "|" may differ per language. Empty files (new, untranslated locales) are skipped.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "locales");
const PH = /\{([A-Za-z_][\w.]*)(?:\|[^{}]*)?\}/g;
const names = (s) => [...new Set([...s.matchAll(PH)].map((m) => m[1]))].sort();
// Placeholders a locale may leave out: in languages that inflect the room name for "in" (Finnish "holvissa" = "in the vault"),
// ZONE_PREP.<ROOM> is already the whole phrase, so ui.fmt.roomIn is just "{prep}".
const MAY_DROP = { "ui.fmt.roomIn": ["room"] };
const errs = [], warns = [];

function load(file) {
  const raw = fs.readFileSync(path.join(DIR, file), "utf8").trim();
  if (!raw) { warns.push(`${file}: empty, skipped`); return null; }
  let d;
  try { d = JSON.parse(raw); } catch (e) { errs.push(`${file}: not valid JSON (${e.message})`); return null; }
  if (!d || typeof d !== "object" || Array.isArray(d)) { errs.push(`${file}: must be one JSON object`); return null; }
  for (const [k, v] of Object.entries(d)) {
    if (typeof v !== "string") errs.push(`${file}: ${k} is not a string (flat keys only)`);
    else if ((v.match(/\{/g) || []).length !== (v.match(/\}/g) || []).length) errs.push(`${file}: ${k} has unbalanced braces`);
  }
  return d;
}

const en = load("en.json");
if (!en) errs.push("en.json: missing or unreadable");
let checked = 0, forms = 0;
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "en.json").sort()) {
  const loc = load(file);
  if (!loc || !en) continue;
  for (const [k, v] of Object.entries(loc)) {
    if (typeof v !== "string") continue;
    // <key>.m / .f / .n: gendered variants of a key (the app tries them first, see KG in ShadokuApp.jsx); checked against the base key
    const ref = k in en ? k : /\.[mfn]$/.test(k) && k.slice(0, -2) in en ? k.slice(0, -2) : null;
    // PROP.<id>.<form> / TRAIT.<id>.<form>: a language's own case forms (fr de_a, uk beside/any...; src/caseText.js uses whatever
    // forms the locale has). English has no such key, so they are checked against the prop or trait itself: one English dropped still warns.
    const own = !ref && /^(PROP|TRAIT)\.[A-Z0-9_]+\.[A-Za-z_]+$/.test(k) && `${k.slice(0, k.lastIndexOf("."))}.a` in en;
    if (own) { if (names(v).length) errs.push(`${file}: ${k} is a case form and takes no {placeholder}`); forms++; continue; }
    if (!ref) { warns.push(`${file}: ${k} is not in en.json`); continue; }
    if (!v) continue; // an empty value falls back to English
    const have = names(v), drop = MAY_DROP[ref] || [];
    const want = names(en[ref]).filter((n) => !drop.includes(n) || have.includes(n));
    if (want.join() !== have.join()) errs.push(`${file}: ${k} uses {${have.join("}, {")}} but en.json has {${want.join("}, {")}}`);
    checked++;
  }
}
for (const w of warns) console.log("warn  " + w);
for (const e of errs) console.log("ERROR " + e);
console.log(`${en ? Object.keys(en).length : 0} en.json keys, ${checked} translated keys checked, ${forms} case forms of the languages' own, ${errs.length} error(s)`);
process.exit(errs.length ? 1 : 0);
