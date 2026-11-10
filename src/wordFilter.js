/**
 * wordFilter.js — keeps swear words and slurs out of community puzzle titles (src/creatorCore.js checkCase, so the Workshop's
 * checker and the server both refuse them).
 *
 * The text is folded first: lower case, accents dropped (ß → ss), look-alike digits and signs read as letters (f4ck, $hit), and a run of
 * single letters joined back into one word ("f u c k", "f.u.c.k"). Each word is then tested as written and with its repeated letters
 * squeezed ("fuuuck"); a "*" stands for any vowel ("f*ck"). WORDS must be the whole word (so "Assassin", "Peacock" and "Scunthorpe"
 * stay fine); STEMS may sit anywhere inside a word (they are never part of a harmless one). The lists cover the site's languages; add
 * to them freely.
 */
const WORDS = [
  // English
  "ass", "asses", "arse", "arses", "bitch", "bitches", "bollocks", "boner", "crap", "cum", "cunt", "cunts", "dick", "dicks", "dildo",
  "dyke", "fag", "fags", "fuk", "jizz", "kike", "nigga", "niggas", "nigger", "niggers", "piss", "pissed", "porn", "prick", "pussy", "rape", "raped",
  "rapist", "retard", "retarded", "shit", "shits", "shitty", "shithead", "slut", "sluts", "spic", "tits", "titties", "tranny", "twat", "wank", "wanker",
  "wankers", "wanking", "whore", "whores",
  // Portuguese
  "buceta", "cabrao", "caralho", "cona", "foda", "fodase", "fodido", "foder", "merda", "paneleiro", "porra", "puta", "putas", "viado", "punheta",
  // Spanish
  "cabron", "carajo", "chinga", "chingada", "culo", "gilipollas", "joder", "jodido", "maricon", "mierda", "pendejo", "polla", "verga",
  // French
  "connard", "connasse", "couille", "couilles", "encule", "enculer", "merde", "nique", "niquer", "putain", "pute", "salope", "salaud",
  // German
  "arsch", "arschloch", "fick", "ficken", "fotze", "hure", "hurensohn", "kacke", "muschi", "scheisse", "schlampe", "schwuchtel", "wichser",
  // Italian
  "cazzo", "coglione", "minchia", "puttana", "stronzo", "stronza", "vaffanculo",
  // Dutch
  "flikker", "godverdomme", "hoer", "klootzak", "kut", "lul",
  // Catalan
  "collons", "cony",
  // Czech
  "curak", "hovno", "kokot", "kurva", "prdel", "zmrd",
  // Greek
  "γαμω", "γαμησου", "καριολη", "μαλακα", "μαλακας", "μαλακες", "μουνι", "πουστη", "πουστης", "πουτανα",
  // Romanian
  "cacat", "muie", "pizda", "pula", "futut", "futu",
  // Turkish
  "amk", "gavat", "kahpe", "orospu", "pezevenk", "siktir", "yarak", "yarrak",
];
const STEMS = ["fuck", "motherf", "faggot", "asshole", "arsehole", "bullshit", "dickhead", "cocksuck", "hijoputa", "hijodeputa",
  "vaffancul", "arschloch", "hurensohn", "putain", "enculé", "orospu", "siktir", "γαμησ",
  // slurs and spellings with no harmless word around them (so "niggerz", "shitshow", "phuck" are caught as part of a longer word)
  "nigger", "shitshow", "shitface", "cuntface", "fvck", "phuck"];

const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 6: "g", 7: "t", 8: "b", 9: "g", "@": "a", $: "s", "!": "i", "|": "i", "€": "e" };
// Cyrillic and Greek letters that look like Latin ones, and ƒ (applied to the word lists as well, so both sides fold the same way)
const LOOKALIKE = { а: "a", с: "c", е: "e", і: "i", ї: "i", ј: "j", о: "o", р: "p", х: "x", у: "y", к: "k", м: "m", н: "h", т: "t", в: "b", ѕ: "s", ԁ: "d",
  ι: "i", ο: "o", α: "a", ε: "e", ν: "v", ρ: "p", υ: "u", κ: "k", τ: "t", ƒ: "f" };
const fold = (s) => String(s).toLowerCase().replace(/ß/g, "ss").replace(/ς/g, "σ").normalize("NFKD").replace(/\p{M}|\p{Cf}/gu, "")
  .replace(/[а-яіїјѕԁιοαενρυκτƒ]/g, (c) => LOOKALIKE[c] || c)
  .replace(/[013456789@$!|€]/g, (c) => LEET[c]);
const WORD_SET = new Set(WORDS.map(fold));
const STEM_LIST = STEMS.map(fold);

/** The text's words after folding (runs of single letters joined: "f u c k" → "fuck"). */
function wordsOf(text) {
  const raw = fold(text).split(/[^\p{L}*]+/u).filter((w) => w.replace(/\*/g, "")), out = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].length === 1) {
      let j = i, w = "";
      while (j < raw.length && raw[j].length === 1) w += raw[j++];
      out.push(w);
      i = j - 1;
    } else out.push(raw[i]);
  }
  return out;
}

/** → the first offending word of `text`, or "" when it is clean. */
export function badWordIn(text) {
  // a word split by spaces or marks ("fu ck", "f-uck", "sh.it"): the letters joined, tested against the long stems only
  const joined = fold(text).replace(/[^\p{L}]+/gu, "");
  const split = STEM_LIST.find((st) => st.length >= 4 && !/hole$|^motherf$/.test(st) && joined.includes(st));
  if (split) return split;
  for (const w of wordsOf(text)) {
    const forms = w.includes("*") ? [..."aeiou"].map((v) => w.replace(/\*/g, v)) : [w];
    for (const v of new Set(forms.flatMap((f) => [f, f.replace(/(\p{L})\1+/gu, "$1")]))) {
      if (WORD_SET.has(v) || STEM_LIST.some((s) => v.includes(s))) return w;
    }
  }
  return "";
}
export const hasBadWords = (text) => !!badWordIn(text);
