/* ────────────────────────────────────────────────────────────────
   Tags by TF-IDF against your own past entries.

   The corpus is your journal, so tags sharpen as it grows: in a log
   full of work, "deploy" stops being remarkable and "hospital"
   stands out. A fixed keyword list could never do that.

   Canonical key = stem, display label = the surface form you use
   most, so `трчање` / `trčanje` / `trčao` collapse into one tag
   labelled the way you actually write it.
   ──────────────────────────────────────────────────────────────── */

import type { Token } from "./normalize.ts";
import { stem } from "./stem.ts";
import { isStopword } from "./lexicon/stopwords.ts";
import type { DraftTag, Lang } from "../types.ts";

export interface TagCorpus {
  /** How many entries exist in total. */
  documentCount: number;
  /** stem → number of entries it appeared in. */
  documentFrequency: ReadonlyMap<string, number>;
  /** stem → most frequent surface form across the corpus. */
  displayForms: ReadonlyMap<string, string>;
}

export const EMPTY_CORPUS: TagCorpus = {
  documentCount: 0,
  documentFrequency: new Map(),
  displayForms: new Map(),
};

const MIN_TAG_LENGTH = 3;
const MAX_TAGS = 5;
const MIN_TAGS = 2;

/** Stems worth tagging, with their in-entry counts and display forms. */
function candidateStems(
  tokens: readonly Token[],
  perSentenceLang: readonly Lang[],
  fallbackLang: Lang,
): Map<string, { count: number; surfaces: Map<string, number> }> {
  const out = new Map<string, { count: number; surfaces: Map<string, number> }>();

  for (const tok of tokens) {
    if (tok.surface.length < MIN_TAG_LENGTH) continue;
    if (/\d/.test(tok.folded)) continue;
    const lang = perSentenceLang[tok.sentence] ?? fallbackLang;
    if (isStopword(tok.folded, lang)) continue;

    const s = stem(tok.surface, lang);
    if (s.length < MIN_TAG_LENGTH) continue;

    let rec = out.get(s);
    if (!rec) {
      rec = { count: 0, surfaces: new Map() };
      out.set(s, rec);
    }
    rec.count += 1;
    const display = tok.surface.toLocaleLowerCase();
    rec.surfaces.set(display, (rec.surfaces.get(display) ?? 0) + 1);
  }
  return out;
}

function mostFrequent(m: ReadonlyMap<string, number>): string {
  let best = "";
  let bestN = -1;
  for (const [k, n] of m) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

/**
 * Rank by TF-IDF. With an empty corpus this degrades to term frequency,
 * which is the right behaviour on your first entry — it just means early
 * tags are less discriminating, not that they're wrong.
 */
export function extractTags(
  tokens: readonly Token[],
  perSentenceLang: readonly Lang[],
  fallbackLang: Lang,
  corpus: TagCorpus = EMPTY_CORPUS,
): DraftTag[] {
  const candidates = candidateStems(tokens, perSentenceLang, fallbackLang);
  if (candidates.size === 0) return [];

  const totalTerms = [...candidates.values()].reduce((a, c) => a + c.count, 0);
  const N = corpus.documentCount;

  const scored: DraftTag[] = [];
  for (const [s, rec] of candidates) {
    const tf = rec.count / Math.max(1, totalTerms);
    const df = corpus.documentFrequency.get(s) ?? 0;
    // Smoothed IDF; +1 keeps a brand-new term from dominating outright.
    const idf = Math.log((N + 1) / (df + 1)) + 1;
    scored.push({
      stem: s,
      display: corpus.displayForms.get(s) ?? mostFrequent(rec.surfaces),
      score: Number((tf * idf).toFixed(5)),
    });
  }

  scored.sort((a, b) => b.score - a.score || a.stem.localeCompare(b.stem));

  // Always offer at least MIN_TAGS when the entry has that many candidates.
  const cut = scored.filter((t) => t.score > 0);
  return cut.slice(0, Math.max(MIN_TAGS, Math.min(MAX_TAGS, cut.length)));
}

/** Fold a set of filed entries into a corpus for the next extraction. */
export function buildCorpus(
  entries: readonly { text: string; tags: readonly string[] }[],
  tokenizeFn: (text: string) => { tokens: Token[] },
  langOf: (text: string) => { lang: Lang; perSentence: Lang[] },
): TagCorpus {
  const documentFrequency = new Map<string, number>();
  const surfaceCounts = new Map<string, Map<string, number>>();

  for (const entry of entries) {
    const { tokens } = tokenizeFn(entry.text);
    const { lang, perSentence } = langOf(entry.text);
    const seen = new Set<string>();

    for (const tok of tokens) {
      if (tok.surface.length < MIN_TAG_LENGTH) continue;
      if (/\d/.test(tok.folded)) continue;
      const l = perSentence[tok.sentence] ?? lang;
      if (isStopword(tok.folded, l)) continue;
      const s = stem(tok.surface, l);
      if (s.length < MIN_TAG_LENGTH) continue;

      seen.add(s);
      let sc = surfaceCounts.get(s);
      if (!sc) {
        sc = new Map();
        surfaceCounts.set(s, sc);
      }
      const disp = tok.surface.toLocaleLowerCase();
      sc.set(disp, (sc.get(disp) ?? 0) + 1);
    }

    for (const s of seen) {
      documentFrequency.set(s, (documentFrequency.get(s) ?? 0) + 1);
    }
  }

  const displayForms = new Map<string, string>();
  for (const [s, counts] of surfaceCounts) displayForms.set(s, mostFrequent(counts));

  return { documentCount: entries.length, documentFrequency, displayForms };
}
