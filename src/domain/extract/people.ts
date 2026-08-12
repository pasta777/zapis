/* ────────────────────────────────────────────────────────────────
   People.

   Capitalisation is a weak signal, so this module never invents a
   person. Names that already exist in your registry are matched and
   stored; anything else is returned as a *candidate* for one-click
   confirmation. Confirming writes an alias, so the registry converges
   on your actual cast of characters — a small, finite set — and
   accuracy goes from mediocre on day one to near-perfect by month two.
   ──────────────────────────────────────────────────────────────── */

import { fold, type Token } from "./normalize.ts";
import { NAME_STOPLIST, SENTENCE_OPENER_SET } from "./lexicon/stopwords.ts";

/**
 * Serbian case endings on personal names, longest first.
 *
 * Milan → Milanom (instrumental), Milanu (dative), Milana (genitive);
 * Ana → Anom, Ani, Ane; Jovan → Jovanu, Jovana. Stripping these is what
 * stops one friend appearing as four different people in your stats.
 */
const SR_NAME_SUFFIXES = [
  "ovima", "evima", "ovim", "evim", "ama", "ima", "om", "em", "eta", "etu",
  "ju", "u", "a", "e", "i", "o",
];

/**
 * Two, not three — names are shorter than words.
 *
 * Serbian short names decline off a two-letter stem: Ana / Ane / Ani / Anu /
 * Anom all sit on `An-`. A three-character floor left `ana` and `anom`
 * unrelated, so one friend appeared in the People tab four times over, with
 * her appearance count and mood statistics split between the copies.
 *
 * The trade is occasional over-merging of genuinely different short names.
 * That failure is visible and reversible — the People tab lists the aliases
 * and lets you delete the entry — whereas silent fragmentation corrupts every
 * statistic that mentions her and looks like nothing is wrong.
 */
const NAME_MIN_STEM = 2;

/** Reduce an inflected name to a comparable base form. */
export function nameBase(surface: string): string {
  const f = fold(surface);
  if (f.length <= NAME_MIN_STEM) return f;
  for (const suffix of SR_NAME_SUFFIXES) {
    if (suffix.length >= f.length) continue;
    if (!f.endsWith(suffix)) continue;
    const candidate = f.slice(0, f.length - suffix.length);
    if (candidate.length < NAME_MIN_STEM) continue;
    return candidate;
  }
  return f;
}

export interface KnownPerson {
  canonical: string;
  display: string;
  /** Folded aliases, including inflected forms already confirmed. */
  aliases: string[];
}

export interface PeopleResult {
  /** Registry matches — safe to store. */
  people: string[];
  /** Looks like a name, not known yet. Needs your confirmation. */
  candidates: string[];
}

/** Build a lookup from every known alias and base form to its display name. */
function buildIndex(known: readonly KnownPerson[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const p of known) {
    const forms = [p.canonical, p.display, ...p.aliases];
    for (const f of forms) {
      const folded = fold(f);
      idx.set(folded, p.display);
      idx.set(nameBase(f), p.display);
    }
  }
  return idx;
}

/**
 * Vocabulary the caller already knows about, so a capitalised word that is
 * really a verb or an adjective doesn't get offered as a person.
 *
 * Without this, every sentence that opens in the past tense — which in a
 * journal is most of them — nominates its first word as a new friend:
 * "Spent", "Slept", "Radio", "Trčao", "Watched".
 */
export interface NameFilters {
  /** True when the word is a track cue, a modifier, a valence word, etc. */
  isKnownVocabulary: (folded: string, surface: string) => boolean;
  /** True when the word has past-tense morphology in either language. */
  looksLikeVerb: (folded: string) => boolean;
}

const NO_FILTERS: NameFilters = {
  isKnownVocabulary: () => false,
  looksLikeVerb: () => false,
};

/**
 * A token is a name candidate when it is capitalised, is not a known
 * non-name, and — crucially at the start of a sentence, where capitalisation
 * proves nothing — is not a word we can already account for some other way.
 */
function isNameCandidate(
  tok: Token,
  filters: NameFilters,
  capitalisedMidSentence: ReadonlySet<string>,
): boolean {
  if (!tok.isCapitalised) return false;
  if (tok.isAllCaps) return false; // shouting, not a name
  if (tok.surface.length < 2) return false;
  if (/\d/.test(tok.surface)) return false;
  if (NAME_STOPLIST.has(tok.folded)) return false;
  if (NAME_STOPLIST.has(nameBase(tok.surface))) return false;

  // Any word we can otherwise explain is not a name, wherever it sits:
  // "Ana" is not in the lexicon, "Radio" and "Watched" are.
  if (filters.isKnownVocabulary(tok.folded, tok.surface)) return false;

  if (tok.sentenceInitial) {
    if (SENTENCE_OPENER_SET.has(tok.folded)) return false;
    if (filters.looksLikeVerb(tok.folded)) return false;

    /*
     * At the start of a sentence a capital letter carries no information —
     * every sentence has one. Enumerating the words that can open a sentence
     * is hopeless ("Long dinner with Marko", "Jutros sam bio…"), so instead
     * require corroboration: the same word must also appear capitalised
     * somewhere it didn't have to be.
     *
     * The cost is missing a name that only ever appears sentence-initially;
     * the gain is never inventing one. Since candidates are offered for
     * confirmation rather than stored, and confirming teaches the registry
     * permanently, erring this way costs one manual add and nothing else.
     */
    if (!capitalisedMidSentence.has(tok.folded)) return false;
  }
  return true;
}

export function extractPeople(
  tokens: readonly Token[],
  known: readonly KnownPerson[],
  filters: NameFilters = NO_FILTERS,
): PeopleResult {
  const index = buildIndex(known);
  const people = new Set<string>();
  const candidates = new Set<string>();

  // Words capitalised where they didn't have to be — the corroborating signal
  // for anything found at the start of a sentence.
  const capitalisedMidSentence = new Set(
    tokens.filter((t) => t.isCapitalised && !t.sentenceInitial).map((t) => t.folded),
  );

  for (const tok of tokens) {
    // A known name is recognised even lowercase — people type fast.
    const hit = index.get(tok.folded) ?? index.get(nameBase(tok.surface));
    if (hit !== undefined) {
      people.add(hit);
      continue;
    }
    if (isNameCandidate(tok, filters, capitalisedMidSentence)) {
      // Offer the base form; it's what the registry will store.
      candidates.add(titleCase(tok.surface));
    }
  }

  return { people: [...people], candidates: [...candidates] };
}

function titleCase(s: string): string {
  return s[0]!.toUpperCase() + s.slice(1);
}
