/* ────────────────────────────────────────────────────────────────
   Mood and energy lexicons.

   Mood (valence) runs -5…+5, matching AFINN's scale so the English
   list can be seeded from afinn-165 directly. Serbian has no
   published npm sentiment lexicon, so the Serbian list below is
   hand-built — deliberately compact and high-precision rather than
   broad, because a wrong valence entry is worse than a missing one.

   Energy is a separate axis. "Furious" is strongly negative in mood
   and strongly HIGH in energy; "content" is positive mood and low
   energy. Collapsing them into one number loses the more useful half.
   ──────────────────────────────────────────────────────────────── */

import { afinn165 } from "afinn-165";
import { fold } from "../normalize.ts";
import type { Lang } from "../../types.ts";

/**
 * Words AFINN scores emotionally that are neutral shop-talk in a working log.
 *
 * AFINN rates `bug` −1, `crash` −2, `error` −2, `critical` −2, `dead` −3,
 * `kill` −3 — all of which appear in a normal, cheerful day of programming.
 * Left in, they quietly drag the mood of every technical entry downwards and
 * poison the mood correlations, which are the app's most interesting output.
 * Domain vocabulary should not read as distress.
 */
const TECHNICAL_NEUTRAL = new Set(
  [
    "bug", "bugs", "buggy", "debug", "crash", "crashed", "crashes", "error",
    "errors", "fail", "failed", "failing", "failure", "critical", "block",
    "blocked", "blocker", "dead", "deadline", "kill", "killed", "abort",
    "aborted", "fix", "fixed", "fixes", "broken", "break", "breaking",
    "issue", "issues", "problem", "problems", "warning", "reject", "rejected",
    "conflict", "conflicts", "stuck", "hang", "hanging", "leak", "dirty",
    "legacy", "hack", "hacks", "dump", "strict", "force", "forced", "drop",
    "dropped", "cut", "stop", "stopped", "lost", "loss", "miss", "missing",
    "test", "tests", "mock", "fake", "stub", "trivial", "hard", "no",
  ].map(fold),
);

/** English valence: AFINN entries, folded for lookup, shop-talk removed. */
export function englishValence(): Map<string, number> {
  const out = new Map<string, number>();
  for (const [word, score] of Object.entries(afinn165 as Record<string, number>)) {
    const folded = fold(word);
    if (TECHNICAL_NEUTRAL.has(folded)) continue;
    out.set(folded, score);
  }
  // Journal-specific additions AFINN lacks or scores oddly in this context.
  const extra: Record<string, number> = {
    productive: 3, focused: 2, rested: 2, calm: 2, grateful: 3, proud: 3,
    accomplished: 3, clear: 1, steady: 1, hopeful: 2, connected: 2,
    peaceful: 3, content: 2, satisfied: 2, relieved: 2, energised: 3,
    energized: 3, motivated: 3, inspired: 3,
    drained: -3, scattered: -2, restless: -2, flat: -2, numb: -3,
    overwhelmed: -3, stuck: -2, behind: -2, procrastinated: -2,
    unproductive: -2, wasted: -3, pointless: -3, lonely: -3, isolated: -3,
    anxious: -3, dread: -3, guilty: -2, ashamed: -3, hungover: -2,
    burntout: -4, burnout: -4, exhausting: -3, draining: -3,
  };
  for (const [k, v] of Object.entries(extra)) out.set(fold(k), v);
  return out;
}

/**
 * Serbian valence, hand-built — there is no published npm lexicon for it.
 *
 * Adjective genders are spelled out rather than left to the stemmer, because
 * the "fleeting a" makes related forms diverge: `divan` reduces to `div` but
 * `divno` reduces to `divn`. Lookup tries the fold first, so listing the
 * surface forms is what actually makes these fire. Verbs need only one form —
 * the stemmer collapses those reliably.
 */
const srv = (score: number, ...words: string[]): [string, number][] =>
  words.map((w) => [w, score]);

const SR_VALENCE: Map<string, number> = new Map([
  // strongly positive
  ...srv(4, "divan", "divna", "divno", "divni", "divne", "predivno", "predivan", "predivna"),
  ...srv(4, "savrsen", "savrsena", "savrseno", "fantastican", "fantasticna", "fantasticno"),
  ...srv(4, "sjajan", "sjajna", "sjajno", "odlican", "odlicna", "odlicno", "cudesno"),
  ...srv(4, "blazenstvo", "radost", "radostan", "ushicen", "presrecan"),
  ...srv(3, "ponosan", "ponosna", "ponosno", "srecan", "srecna", "srecno", "srecni", "sreca"),
  ...srv(3, "zadovoljan", "zadovoljna", "zadovoljno", "zahvalan", "zahvalna", "zahvalno"),
  ...srv(3, "uzivao", "zaljubljen", "oslobodjen", "olaksanje", "uspeh", "uspeo", "uspela"),
  ...srv(3, "pobeda", "nagrada", "ispunjen", "inspirisan", "motivisan", "voljen", "volim"),
  // mildly positive
  ...srv(2, "dobar", "dobra", "dobro", "dobri", "lep", "lepa", "lepo", "lepi"),
  ...srv(2, "prijatan", "prijatna", "prijatno", "miran", "mirna", "mirno", "smireno"),
  ...srv(2, "spokojno", "fokusiran", "koncentrisan", "odmoran", "odmorna", "odmorno"),
  ...srv(2, "svez", "sveza", "svezo", "nasmejan", "veselo", "vesela", "toplo", "bezbedno"),
  ...srv(2, "napredak", "resio", "zavrsio", "pomogao", "hvala", "nada", "optimistican"),
  ...srv(2, "povezan", "prihvacen", "smejao", "smejala", "zagrljaj"),
  ...srv(3, "produktivan", "produktivna", "produktivno"),
  ...srv(1, "jasno", "stabilno", "uredu", "solidno"),
  // mildly negative
  ...srv(-2, "los", "losa", "lose", "losi", "tezak", "teska", "tesko"),
  ...srv(-2, "naporan", "naporna", "naporno", "dosadan", "dosadna", "dosadno"),
  ...srv(-2, "prazan", "prazna", "prazno", "trom", "tromo", "troma"),
  ...srv(-2, "umoran", "umorna", "umorno", "umorni", "mrtav", "mrtva", "mrtvo"),
  ...srv(-2, "nervozan", "nervozna", "nervozno", "napet", "napeta", "napeto"),
  ...srv(-2, "uznemiren", "zabrinut", "zabrinuta", "zabrinuto", "nesigurno"),
  ...srv(-2, "izgubljen", "izgubljena", "rasejan", "nemotivisan", "odlagao"),
  ...srv(-2, "prokrastinirao", "zaglavio", "kasnim", "zurba", "pritisak"),
  ...srv(-1, "pospan", "pospana", "mrzovoljno"),
  // strongly negative
  ...srv(-3, "iscrpljen", "iscrpljena", "iscrpljeno", "izmoren", "nenaspavan"),
  ...srv(-3, "strasno", "tuzan", "tuzna", "tuzno", "tuzni", "tuga", "plakao", "plakala"),
  ...srv(-3, "ljut", "ljuta", "ljuto", "ljuti", "sramota", "krivica", "samoca"),
  ...srv(-3, "usamljen", "usamljena", "izolovan", "strah", "bol", "povreda"),
  ...srv(-3, "svadja", "sukob", "propao", "besmisleno", "uzaludno", "protraceno"),
  ...srv(-3, "stres", "stresno", "bezvoljan", "bolestan", "bolesna"),
  ...srv(-4, "uzasan", "uzasna", "uzasno", "katastrofa", "ocajan", "ocajna", "ocajno"),
  ...srv(-4, "depresivno", "depresivan", "beznadezno", "besan", "besna", "besno"),
  ...srv(-4, "gnev", "mrzim", "ponizen", "panika", "izdaja", "sagoreo"),
  ...srv(-2, "izgubio", "odustao"),
]);

/** Energy axis, -3 (flattened) … +3 (wired). Separate from mood by design. */
const ENERGY: Record<Lang, Record<string, number>> = {
  en: {
    energised: 3, energized: 3, wired: 3, buzzing: 3, alert: 2, sharp: 2,
    fresh: 2, awake: 2, rested: 2, lively: 2, motivated: 2, focused: 2,
    productive: 2, strong: 2, brisk: 1, steady: 1,
    calm: -1, quiet: -1, slow: -1, sleepy: -2, drowsy: -2, tired: -2,
    weary: -2, groggy: -2, sluggish: -2, heavy: -2, drained: -3,
    exhausted: -3, wrecked: -3, shattered: -3, depleted: -3, burntout: -3,
    foggy: -2, unfocused: -2, lethargic: -3,
  },
  sr: {
    energican: 3, energija: 3, budan: 2, bistar: 2, svez: 2, odmoran: 2,
    zivo: 2, motivisan: 2, fokusiran: 2, produktivan: 2, jak: 2,
    poletan: 2, raspolozen: 1, stabilan: 1,
    mirno: -1, tromo: -2, pospan: -2, sanjiv: -2, umoran: -2,
    iznemogao: -3, iscrpljen: -3, mrtav: -3, prazan: -3, tezak: -2,
    izmoren: -3, sagoreo: -3, magla: -2, rasejan: -2, letargican: -3,
    nenaspavan: -3, neispavan: -3,
  },
};

export function serbianValence(): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of SR_VALENCE) out.set(fold(k), v);
  return out;
}

export function energyLexicon(lang: Lang): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(ENERGY[lang])) out.set(fold(k), v);
  return out;
}

export function valenceLexicon(lang: Lang): Map<string, number> {
  return lang === "sr" ? serbianValence() : englishValence();
}

/** Emoji carry valence too, and in a diary they carry a lot of it. */
export const EMOJI_VALENCE: Record<string, number> = {
  "😀": 3, "😃": 3, "😄": 3, "😁": 3, "😊": 3, "🙂": 2, "😌": 2,
  "🥰": 4, "😍": 4, "❤️": 4, "💚": 3, "🙏": 2, "✨": 2, "🎉": 4,
  "💪": 3, "🔥": 3, "👏": 3, "😎": 2, "🤩": 4, "☺️": 2, "😇": 3,
  "😐": -1, "😕": -2, "🙁": -2, "☹️": -2, "😞": -3, "😔": -3,
  "😢": -3, "😭": -4, "😠": -3, "😡": -4, "🤬": -5, "😩": -3,
  "😫": -3, "🥱": -1, "😴": -1, "💀": -2, "🤒": -2, "🤕": -2,
  "😰": -3, "😨": -3, "😱": -4, "🥲": -1, "😬": -2, "🫠": -2,
};
