/* ────────────────────────────────────────────────────────────────
   Language detection by stopword overlap, scored per sentence so a
   mixed-language entry works. Chosen over a statistical detector
   (franc et al.) because those need ~40+ characters to be reliable
   and journal sentences are routinely shorter than that.
   ──────────────────────────────────────────────────────────────── */

import { fold, tokenize } from "./normalize.ts";
import type { Lang } from "../types.ts";

/** High-frequency function words. Deliberately excludes anything shared. */
const SR_MARKERS = new Set([
  "je", "sam", "se", "da", "na", "za", "su", "sa", "bio", "bila", "nije",
  "nisam", "ali", "kao", "sto", "koji", "koja", "ovo", "taj", "ta", "to",
  "mi", "mu", "joj", "ih", "ga", "ne", "ni", "vec", "jos", "samo", "kad",
  "kada", "gde", "onda", "danas", "juce", "sutra", "veoma", "mnogo",
  "malo", "dobro", "posle", "pre", "kod", "bez", "preko", "izmedju",
  "jesam", "budem", "bice", "treba", "moram", "mogu", "hocu", "zelim",
  "svoj", "moja", "moje", "moj", "nas", "vas", "njih", "sve", "svi",
]);

const EN_MARKERS = new Set([
  "the", "and", "was", "were", "is", "are", "of", "to", "in", "it", "that",
  "this", "with", "for", "but", "not", "have", "had", "has", "did", "does",
  "would", "could", "should", "about", "there", "their", "then", "than",
  "been", "being", "from", "they", "them", "what", "when", "which", "who",
  "will", "just", "very", "really", "today", "yesterday", "tomorrow",
  "some", "all", "because", "after", "before", "while", "into", "over",
]);

/** Ambiguous by design: "i", "a", "u", "sam", "do", "no" mean things in both. */

const CYRILLIC_RE = /\p{Script=Cyrillic}/u;

export interface LangGuess {
  lang: Lang;
  confidence: number;
  /** Per-sentence guesses, so mixed entries can be handled clause by clause. */
  perSentence: Lang[];
}

function scoreWords(words: string[]): { sr: number; en: number } {
  let sr = 0;
  let en = 0;
  for (const w of words) {
    if (SR_MARKERS.has(w)) sr++;
    if (EN_MARKERS.has(w)) en++;
  }
  return { sr, en };
}

/**
 * Serbian-specific orthography is decisive on its own: any Cyrillic, or the
 * letters ć/č/š/ž/đ, settles it before stopwords are consulted.
 */
function hasSerbianOrthography(raw: string): boolean {
  return CYRILLIC_RE.test(raw) || /[ćčšžđĆČŠŽĐ]/.test(raw);
}

export function detectLang(text: string, fallback: Lang = "en"): LangGuess {
  const { tokens, sentences } = tokenize(text);

  const perSentence: Lang[] = sentences.map((s) => {
    const words = tokens
      .filter((t) => t.sentence === s.index)
      .map((t) => t.folded);
    if (hasSerbianOrthography(s.text)) return "sr";
    const { sr, en } = scoreWords(words);
    if (sr === en) return fallback;
    return sr > en ? "sr" : "en";
  });

  if (hasSerbianOrthography(text)) {
    return { lang: "sr", confidence: 1, perSentence };
  }

  const { sr, en } = scoreWords(tokens.map((t) => t.folded));
  const total = sr + en;
  if (total === 0) return { lang: fallback, confidence: 0, perSentence };

  const lang: Lang = sr > en ? "sr" : "en";
  return {
    lang,
    confidence: Math.abs(sr - en) / total,
    perSentence,
  };
}

/** Which language a specific word most likely belongs to. */
export function wordLang(word: string, fallback: Lang): Lang {
  const f = fold(word);
  if (hasSerbianOrthography(word)) return "sr";
  if (SR_MARKERS.has(f)) return "sr";
  if (EN_MARKERS.has(f)) return "en";
  return fallback;
}
