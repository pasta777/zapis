/* ────────────────────────────────────────────────────────────────
   The extractor. Prose in, ledger data out — deterministically.

   Given the same text and the same context this returns byte-identical
   output every time, which is what makes the golden corpus in
   corpus/ a meaningful regression suite.
   ──────────────────────────────────────────────────────────────── */

import { fold, tokenize, wordCount } from "./normalize.ts";
import { detectLang } from "./detectLang.ts";
import {
  buildCueTable,
  isCue,
  isModifier,
  matchCues,
  type CueTable,
} from "./match.ts";
import { isStopword } from "./lexicon/stopwords.ts";
import { valenceLexicon, energyLexicon } from "./lexicon/valence.ts";
import { looksPastTense } from "./events.ts";
import { DEFAULT_XP_SCALE, scoreTracks } from "./score.ts";
import { scoreEnergy, scoreMood } from "./sentiment.ts";
import { extractPeople, type KnownPerson } from "./people.ts";
import { extractEvents } from "./events.ts";
import { EMPTY_CORPUS, extractTags, type TagCorpus } from "./tags.ts";
import { buildNote } from "./note.ts";
import type { Draft, Lang, Metric, TrackKey } from "../types.ts";

export interface ExtractContext {
  /** Registry of people you've already confirmed. */
  known?: readonly KnownPerson[];
  /** TF-IDF corpus built from your prior entries. */
  corpus?: TagCorpus;
  /** Cue weight overrides — user edits and learned adjustments. */
  cueTable?: CueTable;
  /** Days since each track last scored, for the note. */
  daysSince?: Partial<Record<TrackKey, number | null>>;
  /** Mean mood over prior entries, for the note. */
  moodBaseline?: number | null;
  /** UI language, used when the text itself is ambiguous. */
  fallbackLang?: Lang;
  xpScale?: number;
}

/** The one entry point. A different backend could implement this signature. */
export interface Extractor {
  extract(text: string, date: string, ctx?: ExtractContext): Draft;
}

/**
 * Union of both languages' emotion vocabularies, built once. Used only to
 * reject false person-candidates: "Divan" opening a sentence is an adjective,
 * not somebody you met.
 */
const VALENCE_ANY: ReadonlySet<string> = new Set([
  ...valenceLexicon("en").keys(),
  ...valenceLexicon("sr").keys(),
]);
const ENERGY_ANY: ReadonlySet<string> = new Set([
  ...energyLexicon("en").keys(),
  ...energyLexicon("sr").keys(),
]);

export function createExtractor(defaultTable?: CueTable): Extractor {
  const table = defaultTable ?? buildCueTable();
  return {
    extract(text, _date, ctx = {}) {
      return extract(text, { cueTable: table, ...ctx });
    },
  };
}

export function extract(text: string, ctx: ExtractContext = {}): Draft {
  const fallbackLang = ctx.fallbackLang ?? "en";
  const table = ctx.cueTable ?? buildCueTable();
  const corpus = ctx.corpus ?? EMPTY_CORPUS;

  const { tokens, sentences } = tokenize(text);
  const guess = detectLang(text, fallbackLang);
  const perSentence = guess.perSentence;

  const matched = matchCues(tokens, table, perSentence, guess.lang);
  const { awards } = scoreTracks(
    matched.evidence,
    matched.quantities,
    ctx.xpScale ?? DEFAULT_XP_SCALE,
  );

  const metrics: Metric[] = matched.quantities.map((q) => ({
    kind: q.kind,
    value: q.value,
    unit: q.unit,
    track: q.track,
  }));
  const sleep = metrics.find((m) => m.kind === "sleep_hours")?.value ?? null;

  const mood = scoreMood(text, tokens, perSentence, guess.lang);
  const energy = scoreEnergy(tokens, perSentence, guess.lang, sleep);

  const { people, candidates } = extractPeople(tokens, ctx.known ?? [], {
    // Anything the engine can already account for is not a new person.
    isKnownVocabulary: (folded, surface) =>
      isCue(table, folded, surface) ||
      isModifier(folded) ||
      isStopword(folded, guess.lang) ||
      VALENCE_ANY.has(folded) ||
      ENERGY_ANY.has(folded),
    looksLikeVerb: (folded) => looksPastTense(folded, guess.lang),
  });
  const events = extractEvents(sentences, tokens, people, perSentence, guess.lang);
  const tags = extractTags(tokens, perSentence, guess.lang, corpus);

  const note = buildNote(
    {
      awards,
      mood: mood.score,
      energy: energy.score,
      wordCount: wordCount(text),
      peopleCount: people.length,
      metrics,
      daysSince: ctx.daysSince ?? {},
      moodBaseline: ctx.moodBaseline ?? null,
    },
    guess.lang,
  );

  return {
    awards,
    mood: mood.score,
    energy: energy.score,
    people,
    personCandidates: candidates,
    events,
    tags,
    note,
    lang: guess.lang,
    metrics,
    // Negated cues are kept: "why did Body score 0" is as useful as
    // "why did it score 12", and the UI greys them out rather than hiding them.
    evidence: matched.evidence,
    wordCount: wordCount(text),
  };
}

export { buildCueTable, type CueTable } from "./match.ts";
export { buildCorpus, EMPTY_CORPUS, type TagCorpus } from "./tags.ts";
export type { KnownPerson } from "./people.ts";
export { DEFAULT_XP_SCALE } from "./score.ts";
export { detectLang } from "./detectLang.ts";
export { tokenize, fold, wordCount } from "./normalize.ts";
export { stem, stemEn, stemSr } from "./stem.ts";
