/* ────────────────────────────────────────────────────────────────
   Stemming. Cues are stored as stems, so one lexicon entry `trc`
   covers trčao / trčala / trčanje / trčim / trčali. That is what
   makes a hand-curated Serbian lexicon tractable at all.

   English uses Porter (the `stemmer` package). Serbian has no
   published npm stemmer, so this is a greedy longest-suffix
   stripper in the Keselj–Šipka tradition: an ordered rule list,
   applied longest-first, guarded so it can never strip a word down
   to something meaningless.
   ──────────────────────────────────────────────────────────────── */

import { stemmer as porter } from "stemmer";
import { fold } from "./normalize.ts";
import type { Lang } from "../types.ts";

/**
 * Serbian suffixes, grouped by length. Verbal, nominal, and adjectival
 * endings together — the goal is lexicon recall, not linguistic purity,
 * so a slightly aggressive rule that collapses related forms is a win.
 *
 * Written in *folded* form (č→c, š→s, ž→z, ć→c, đ→dj) because stemming
 * always runs after folding.
 *
 * Five short endings are deliberately absent — `le`, `er`, `et`, `iv`, `ir`
 * (and the infinitive `irati`). Each is
 * a rare suffix in Serbian but a common word *ending*, and stripping them
 * merged unrelated vocabulary into one stem:
 *
 *     posle (after)     → pos      collided with  posao (job)      → Craft
 *     večera (dinner)   → vec      collided with  već (already)
 *     teretana (gym)    → ter      far too generic to be a cue
 *     gradivo (course)  → grad     collided with  grad (city)      → Study
 *     kodirao (coded)   → kod      collided with  kod (at, by)     → Craft
 *
 * So "after" scored Craft and "in the city" scored Study. Leaving these four
 * in place costs a little recall on genuine `-er`/`-et` nouns; taking them out
 * costs correctness everywhere. Recall is recoverable from the Lexicon tab.
 */
const SR_SUFFIXES: readonly string[] = [
  // 6+
  "ivanje", "avanje", "ovanje", "ijemo", "ujemo",
  // 5
  "anjem", "enjem", "ivati", "ovati", "avati", "isati", "nuti",
  "asmo", "ismo", "ajuci", "ujuci", "avsi", "ivsi",
  "ijah", "ijas", "ijao",
  // 4
  "anje", "enje", "ance", "ence", "icom", "icem", "ovim", "ovih", "ovom",
  "inim", "inih", "skim", "skih", "skom", "ijem", "ijeg", "ijih", "ijim",
  "acki", "icki", "ucki", "osti", "ostu", "asti",
  "ismo", "iste", "asmo", "aste", "ahmo", "ahte",
  "aju", "uju", "emo", "ete", "amo", "ate", "imo", "ite",
  // 3
  "ost", "ast", "ist", "ovi", "ove", "ova", "ovu", "ime", "ima", "ama",
  "oga", "omu", "ega", "emu", "ih", "im",
  "ao", "eo", "io", "la", "li", "lo", "na", "ne", "ni", "no",
  "ti", "te", "ci", "ce", "je", "ju", "je",
  "am", "as", "at", "em", "es", "ov",
  // 2
  "ah", "eh", "oh", "uh", "ak", "ek", "ik", "ok", "uk",
  "an", "en", "in", "on", "un", "ar", "or", "ur",
  // 1
  "a", "e", "i", "o", "u", "j", "m", "h",
];

/** Sorted longest-first once, at module load, so matching is greedy. */
const SR_SORTED = [...new Set(SR_SUFFIXES)].sort((a, b) => b.length - a.length);

/**
 * `r` is a syllable nucleus in Serbian — trg, prst, krv, trčati — so a stem
 * like `trc` is perfectly well formed. Treating it as a vowel here is the
 * standard move in Serbian/Croatian stemmers, and without it every
 * syllabic-r verb fails the guard below and never reduces.
 */
const SR_VOWELS = new Set(["a", "e", "i", "o", "u", "r"]);

function hasVowel(s: string, vowels: Set<string>): boolean {
  for (const ch of s) if (vowels.has(ch)) return true;
  return false;
}

const SR_MIN_STEM = 3;
const SR_MAX_PASSES = 3;

/** One greedy longest-suffix strip, or null when no rule survives the guard. */
function stripOnce(w: string): string | null {
  for (const suffix of SR_SORTED) {
    if (suffix.length >= w.length) continue;
    if (!w.endsWith(suffix)) continue;
    const candidate = w.slice(0, w.length - suffix.length);
    if (candidate.length < SR_MIN_STEM) continue;
    if (!hasVowel(candidate, SR_VOWELS)) continue;
    return candidate;
  }
  return null;
}

/**
 * Strip repeatedly until nothing applies.
 *
 * A single pass is not enough: `trčala` loses only `la`, landing on `trca`,
 * while `trčao` loses `ao` and lands on `trc` — the same verb stemming two
 * ways, which would split one cue into two. Iterating converges both on
 * `trc`. Bounded so a pathological rule set cannot spin.
 */
export function stemSr(word: string): string {
  let w = fold(word);
  if (w.length <= SR_MIN_STEM) return w;

  for (let pass = 0; pass < SR_MAX_PASSES; pass++) {
    const next = stripOnce(w);
    if (next === null || next === w) break;
    w = next;
  }
  return w;
}

/**
 * Irregular past tenses, mapped to their infinitive before Porter runs.
 *
 * Porter is purely suffix-based, so it leaves `ran`, `slept` and `wrote`
 * completely unrelated to `run`, `sleep` and `write` — and a journal is
 * written almost entirely in the past tense, so without this the most
 * common phrasing of every cue would miss.
 */
const EN_IRREGULAR: Record<string, string> = {
  ran: "run", run: "run",
  slept: "sleep", wrote: "write", written: "write",
  ate: "eat", eaten: "eat", drank: "drink", drunk: "drink",
  went: "go", gone: "go", spoke: "speak", spoken: "speak",
  met: "meet", built: "build", taught: "teach", thought: "think",
  felt: "feel", swam: "swim", swum: "swim", rode: "ride", ridden: "ride",
  read: "read", said: "say", made: "make", took: "take", taken: "take",
  got: "get", gotten: "get", saw: "see", seen: "see", sang: "sing",
  sung: "sing", drew: "draw", drawn: "draw", threw: "throw",
  began: "begin", begun: "begin", broke: "break", broken: "break",
  chose: "choose", chosen: "choose", woke: "wake", woken: "wake",
  lay: "lie", lain: "lie", left: "leave", lost: "lose", found: "find",
  held: "hold", kept: "keep", sent: "send", spent: "spend",
  sat: "sit", stood: "stand", brought: "bring", bought: "buy",
  caught: "catch", fought: "fight", paid: "pay", told: "tell",
  understood: "understand", won: "win", hung: "hang", dug: "dig",
  fell: "fall", fallen: "fall", grew: "grow", grown: "grow",
  knew: "know", known: "know", flew: "fly", flown: "fly",
  bent: "bend", lent: "lend", crept: "creep", wept: "weep",
  stuck: "stick", struck: "strike", shot: "shoot", quit: "quit",
};

export function stemEn(word: string): string {
  const w = fold(word);
  if (w.length <= 2) return w;
  return porter(EN_IRREGULAR[w] ?? w);
}

export function stem(word: string, lang: Lang): string {
  return lang === "sr" ? stemSr(word) : stemEn(word);
}

/**
 * Both stems for a word, since entries mix languages and a cue table is
 * keyed by (lang, stem). Cheap enough to always compute both.
 */
export function stemBoth(word: string): { en: string; sr: string } {
  return { en: stemEn(word), sr: stemSr(word) };
}
