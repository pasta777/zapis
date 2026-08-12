/* ────────────────────────────────────────────────────────────────
   Events: the 0–3 sentences most worth remembering.

   Sentences are quoted verbatim, never paraphrased. A rule engine has
   no business rewriting your words, and a quote you recognise is more
   trustworthy in a ledger than a summary you have to audit.
   ──────────────────────────────────────────────────────────────── */

import type { Sentence, Token } from "./normalize.ts";
import { fold } from "./normalize.ts";
import type { Lang } from "../types.ts";

/** Openers that mark a sentence as interpretation rather than record. */
const OPINION_OPENERS = new Set(
  [
    "i think", "i feel", "i guess", "i wonder", "maybe", "perhaps",
    "hopefully", "i should", "i need", "i want", "i wish",
    "mislim", "cini mi se", "osecam", "valjda", "mozda", "nadam",
    "trebalo bi", "zelim", "hocu", "voleo bih",
  ].map(fold),
);

/** Serbian past participle / aorist endings and English past markers. */
const SR_PAST = /(?:ao|la|li|lo|io|ila|ile|smo|ste|nuo|nula)$/;
const EN_PAST = /(?:ed|ked|ped|ted|led)$/;

const EN_PAST_IRREGULAR = new Set([
  "was", "were", "had", "did", "went", "made", "took", "got", "saw",
  "met", "ran", "wrote", "read", "said", "told", "found", "built",
  "slept", "ate", "drank", "spoke", "sent", "spent", "left", "felt",
  "thought", "brought", "bought", "caught", "taught", "won", "lost",
  "began", "broke", "chose", "drove", "flew", "gave", "grew", "held",
  "kept", "knew", "put", "sat", "stood", "swam", "woke",
]);

/**
 * Past-tense morphology in either language.
 *
 * Exported because people.ts needs it too: at the start of a sentence a
 * capital letter is free, so "Radio", "Spent" and "Trčao" have to be rejected
 * as person candidates on the strength of looking like verbs.
 */
export function looksPastTense(folded: string, lang: Lang): boolean {
  if (EN_PAST_IRREGULAR.has(folded)) return true;
  // Check both languages: entries mix, and a name shouldn't slip through
  // just because the surrounding sentence was detected as the other language.
  if (SR_PAST.test(folded)) return true;
  return lang === "en" ? EN_PAST.test(folded) : false;
}

function looksPast(tok: Token, lang: Lang): boolean {
  if (EN_PAST_IRREGULAR.has(tok.folded)) return true;
  return lang === "sr" ? SR_PAST.test(tok.folded) : EN_PAST.test(tok.folded);
}

export interface ScoredSentence {
  text: string;
  score: number;
  index: number;
}

/**
 * Score each sentence for "eventness": concrete, past-tense, specific.
 *
 *   +2  a number        — dates, counts, durations anchor a memory
 *   +2  a known person  — who was there is the thing you forget first
 *   +1  a past-tense verb marker
 *   +1  short enough to read back at a glance
 *   −3  opens with an opinion marker
 *   −2  very long, i.e. a paragraph of reflection rather than a record
 */
export function scoreSentences(
  sentences: readonly Sentence[],
  tokens: readonly Token[],
  people: readonly string[],
  perSentenceLang: readonly Lang[],
  fallbackLang: Lang,
): ScoredSentence[] {
  const peopleFolded = new Set(people.map(fold));

  return sentences.map((s) => {
    const own = tokens.filter((t) => t.sentence === s.index);
    const lang = perSentenceLang[s.index] ?? fallbackLang;
    let score = 0;

    if (own.some((t) => /^\d/.test(t.folded))) score += 2;
    if (own.some((t) => peopleFolded.has(t.folded))) score += 2;
    if (own.some((t) => looksPast(t, lang))) score += 1;

    const words = own.length;
    if (words >= 3 && words <= 18) score += 1;
    if (words > 40) score -= 2;
    if (words < 3) score -= 2;

    const opening = fold(s.text.slice(0, 24));
    for (const marker of OPINION_OPENERS) {
      if (opening.startsWith(marker)) {
        score -= 3;
        break;
      }
    }

    return { text: s.text, score, index: s.index };
  });
}

const EVENT_THRESHOLD = 3;
const MAX_EVENTS = 3;

export function extractEvents(
  sentences: readonly Sentence[],
  tokens: readonly Token[],
  people: readonly string[],
  perSentenceLang: readonly Lang[],
  fallbackLang: Lang,
): string[] {
  return scoreSentences(sentences, tokens, people, perSentenceLang, fallbackLang)
    .filter((s) => s.score >= EVENT_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_EVENTS)
    .sort((a, b) => a.index - b.index) // restore narrative order
    .map((s) => trimTerminal(s.text));
}

/** Drop a trailing period; keep ? and ! because they carry tone. */
function trimTerminal(s: string): string {
  return s.replace(/\s*\.\s*$/, "");
}
