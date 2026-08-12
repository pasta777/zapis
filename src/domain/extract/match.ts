/* ────────────────────────────────────────────────────────────────
   Cue matching. Turns tokens into weighted, modifier-adjusted hits
   with character offsets, so every number the app shows can be
   traced back to the words that produced it.
   ──────────────────────────────────────────────────────────────── */

import { fold, type Token } from "./normalize.ts";
import { stem, stemBoth } from "./stem.ts";
import {
  CUE_SEED,
  DIMINISHERS,
  INTENSIFIERS,
  NEGATORS,
  type SeedCue,
} from "./lexicon/cues.ts";
import type { Evidence, Lang, Metric, TrackKey } from "../types.ts";
import { TRACK_KEYS } from "../tracks.ts";

export const INTENSIFY = 1.6;
export const DIMINISH = 0.5;

/** A cue table keyed by `${lang}:${stem}` → per-track weights. */
export type CueTable = Map<string, { track: TrackKey; weight: number }[]>;

function cueKey(lang: Lang, stemmed: string): string {
  return `${lang}:${stemmed}`;
}

/** Build the runtime table from the seed lists, stemming as we go. */
export function buildCueTable(
  overrides: readonly { lang: Lang; track: TrackKey; stem: string; weight: number }[] = [],
): CueTable {
  const table: CueTable = new Map();

  const add = (lang: Lang, track: TrackKey, stemmed: string, weight: number) => {
    if (stemmed.length < 2) return;
    const key = cueKey(lang, stemmed);
    const list = table.get(key);
    if (!list) {
      table.set(key, [{ track, weight }]);
      return;
    }
    const existing = list.find((e) => e.track === track);
    if (existing) existing.weight = Math.max(existing.weight, weight);
    else list.push({ track, weight });
  };

  for (const track of TRACK_KEYS) {
    const perLang = CUE_SEED[track];
    for (const lang of ["en", "sr"] as Lang[]) {
      for (const seed of perLang[lang] as SeedCue[]) {
        add(lang, track, stem(seed.word, lang), seed.weight);
      }
    }
  }

  // User edits and learned weights win outright, including weight 0 (= muted).
  for (const o of overrides) {
    const key = cueKey(o.lang, o.stem);
    const list = table.get(key) ?? [];
    const existing = list.find((e) => e.track === o.track);
    if (existing) existing.weight = o.weight;
    else list.push({ track: o.track, weight: o.weight });
    table.set(key, list);
  }

  return table;
}

/** Modifier sets, folded, indexed by language. */
function buildModifierSets() {
  const mk = (rec: Record<Lang, string[]>) => ({
    en: new Set(rec.en.map(fold)),
    sr: new Set(rec.sr.map(fold)),
  });
  return {
    negators: mk(NEGATORS),
    intensifiers: mk(INTENSIFIERS),
    diminishers: mk(DIMINISHERS),
  };
}

const MODS = buildModifierSets();

function inAnyLang(sets: { en: Set<string>; sr: Set<string> }, folded: string) {
  return sets.en.has(folded) || sets.sr.has(folded);
}

/**
 * Negators, including English contractions.
 *
 * The tokenizer keeps apostrophes, so "didn't" arrives intact and the
 * `n't` pattern catches the whole family without listing every auxiliary.
 * Apostrophe-free spellings ("didnt", "wasnt") are in the word list instead —
 * a bare `/nt$/` would swallow "important" and "front".
 */
export function isNegator(folded: string): boolean {
  return inAnyLang(MODS.negators, folded) || /n['’]t$/.test(folded);
}

export function isIntensifier(folded: string): boolean {
  return inAnyLang(MODS.intensifiers, folded);
}

export function isDiminisher(folded: string): boolean {
  return inAnyLang(MODS.diminishers, folded);
}

export function isModifier(folded: string): boolean {
  return isNegator(folded) || isIntensifier(folded) || isDiminisher(folded);
}

/** Is this word a track cue in either language? Used to reject false names. */
export function isCue(table: CueTable, folded: string, surface: string): boolean {
  const stems = stemBoth(surface);
  return (
    table.has(cueKey("en", stems.en)) ||
    table.has(cueKey("sr", stems.sr)) ||
    table.has(cueKey("en", folded)) ||
    table.has(cueKey("sr", folded))
  );
}

/* ── quantities ─────────────────────────────────────────────────── */

interface UnitDef {
  kind: string;
  unit: string;
  /** Multiplier to the canonical unit (hours, km, pages, reps). */
  toCanonical: number;
  tracks: TrackKey[];
}

const UNITS: { match: RegExp; def: UnitDef }[] = [
  {
    match: /^(h|hr|hrs|hour|hours|sat|sata|sati|casa|casova|cas)$/,
    def: { kind: "duration_h", unit: "h", toCanonical: 1, tracks: [] },
  },
  {
    match: /^(min|mins|minute|minutes|minut|minuta|minute)$/,
    def: { kind: "duration_h", unit: "h", toCanonical: 1 / 60, tracks: [] },
  },
  {
    match: /^(km|kilometer|kilometers|kilometre|kilometres|kilometar|kilometara)$/,
    def: { kind: "distance_km", unit: "km", toCanonical: 1, tracks: ["body"] },
  },
  {
    match: /^(m|meter|meters|metar|metara)$/,
    def: { kind: "distance_km", unit: "km", toCanonical: 0.001, tracks: ["body"] },
  },
  {
    match: /^(page|pages|str|strana|strane|stranica|stranice)$/,
    def: { kind: "pages", unit: "pages", toCanonical: 1, tracks: ["study"] },
  },
  {
    match: /^(rep|reps|set|sets|serija|serije|ponavljanja|sklek|sklekova)$/,
    def: { kind: "reps", unit: "reps", toCanonical: 1, tracks: ["body"] },
  },
  {
    match: /^(step|steps|korak|koraka)$/,
    def: { kind: "steps", unit: "steps", toCanonical: 1, tracks: ["body"] },
  },
];

/** Words that mark a duration as sleep rather than activity. */
const SLEEP_MARKERS = new Set(
  ["sleep", "slept", "sleeping", "nap", "bed", "spavao", "spavala", "spavanje", "spavam", "san"].map(fold),
);

/**
 * Numbers written as words.
 *
 * People write "slept nine hours" and "učio šest sati" far more often than
 * they write digits, so a digits-only quantity parser misses the majority of
 * the durations in a real journal — including sleep, which is the single most
 * useful number the engine can extract.
 */
const NUMBER_WORDS: Record<string, number> = {
  // English
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  half: 0.5, couple: 2, dozen: 12,
  // Serbian
  jedan: 1, jedna: 1, jedno: 1, dva: 2, dve: 2, dvije: 2, tri: 3,
  cetiri: 4, pet: 5, sest: 6, sedam: 7, osam: 8, devet: 9, deset: 10,
  jedanaest: 11, dvanaest: 12, trinaest: 13, cetrnaest: 14, petnaest: 15,
  sesnaest: 16, sedamnaest: 17, osamnaest: 18, devetnaest: 19,
  dvadeset: 20, trideset: 30, cetrdeset: 40, pedeset: 50, sezdeset: 60,
  sedamdeset: 70, osamdeset: 80, devedeset: 90, sto: 100,
  pola: 0.5, par: 2,
};

/**
 * "sto" is 100 but also a very common Serbian pronoun ("što"/"sto" = what),
 * and "a"/"an" are English articles. Word-numbers are therefore only accepted
 * when a unit follows immediately, which is exactly the shape we're after.
 */
function wordNumber(folded: string): number | undefined {
  return NUMBER_WORDS[folded];
}

export interface QuantityHit extends Metric {
  start: number;
  end: number;
  clause: number;
}

/**
 * Numbers with units, attributed to the nearest track cue in the same clause.
 *
 * This is the engine's most objective signal by a wide margin: "3 sata učenja"
 * is unambiguous in a way no adjective ever is, so §score weights it heavily.
 */
export function extractQuantities(
  tokens: readonly Token[],
  cueTracks: ReadonlyMap<number, TrackKey[]>,
): QuantityHit[] {
  const out: QuantityHit[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    let value: number;
    let unitTok: Token | undefined;

    const numMatch = /^(\d+(?:[.,]\d+)?)$/.exec(tok.folded);
    const glued = /^(\d+(?:[.,]\d+)?)(\p{L}+)$/u.exec(tok.folded);
    const asWord = wordNumber(tok.folded);

    if (numMatch) {
      // "3.5" / "3,5" / "90"
      value = Number(numMatch[1]!.replace(",", "."));
      unitTok = tokens[i + 1];
    } else if (glued) {
      // "3h", "90min", "12km"
      value = Number(glued[1]!.replace(",", "."));
      unitTok = { ...tok, folded: glued[2]! };
    } else if (asWord !== undefined) {
      // "nine hours", "šest sati" — only when a unit follows.
      value = asWord;
      unitTok = tokens[i + 1];
    } else {
      continue;
    }
    if (!Number.isFinite(value) || !unitTok) continue;

    const unitDef = UNITS.find((u) => u.match.test(unitTok!.folded))?.def;
    if (!unitDef) continue;

    // Which track does this quantity belong to? Nearest cue in the clause.
    let track: TrackKey | null = null;
    let bestDistance = Infinity;
    for (const [idx, tracks] of cueTracks) {
      const other = tokens[idx];
      if (!other || other.clause !== tok.clause) continue;
      const d = Math.abs(idx - i);
      if (d < bestDistance && tracks.length > 0) {
        bestDistance = d;
        track = tracks[0]!;
      }
    }
    if (track === null && unitDef.tracks.length > 0) track = unitDef.tracks[0]!;

    // Sleep is a duration but not an activity — it gets its own metric kind.
    let kind = unitDef.kind;
    if (kind === "duration_h") {
      const near = tokens.slice(Math.max(0, i - 4), i + 5);
      if (near.some((t) => SLEEP_MARKERS.has(t.folded))) {
        kind = "sleep_hours";
        track = "body";
      }
    }

    out.push({
      kind,
      value: Number((value * unitDef.toCanonical).toFixed(3)),
      unit: unitDef.unit,
      track,
      start: tok.start,
      end: unitTok.end,
      clause: tok.clause,
    });
  }
  return out;
}

/* ── the matcher ────────────────────────────────────────────────── */

export interface MatchResult {
  evidence: Evidence[];
  quantities: QuantityHit[];
  /** token index → tracks it cued, used for quantity attribution */
  cueTracks: Map<number, TrackKey[]>;
}

/**
 * Walk the tokens once, resolving each cue against the table and applying
 * clause-scoped modifiers.
 *
 * Negation scope runs from the negator to the end of its clause, which is
 * what keeps "nisam trčao, ali sam čitao" from suppressing the reading.
 */
export function matchCues(
  tokens: readonly Token[],
  table: CueTable,
  perSentenceLang: readonly Lang[],
  fallbackLang: Lang,
): MatchResult {
  // Pass 1: locate modifiers by clause.
  const negatedClauses = new Set<number>();
  const intensifiedClauses = new Set<number>();
  const diminishedClauses = new Set<number>();

  for (const t of tokens) {
    if (isNegator(t.folded)) negatedClauses.add(t.clause);
    if (isIntensifier(t.folded)) intensifiedClauses.add(t.clause);
    if (isDiminisher(t.folded)) diminishedClauses.add(t.clause);
  }

  // Pass 2: resolve cues.
  const evidence: Evidence[] = [];
  const cueTracks = new Map<number, TrackKey[]>();

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (/^\d/.test(tok.folded)) continue;

    const lang = perSentenceLang[tok.sentence] ?? fallbackLang;
    const stems = stemBoth(tok.surface);

    // Try the sentence's language first, then the other — entries mix freely.
    const order: Lang[] = lang === "sr" ? ["sr", "en"] : ["en", "sr"];
    let hits: { track: TrackKey; weight: number }[] | undefined;
    for (const l of order) {
      hits = table.get(cueKey(l, l === "sr" ? stems.sr : stems.en));
      if (hits && hits.length > 0) break;
    }
    if (!hits || hits.length === 0) continue;

    const negated = negatedClauses.has(tok.clause);
    let modifier = 1;
    if (negated) modifier = 0;
    else if (intensifiedClauses.has(tok.clause)) modifier = INTENSIFY;
    else if (diminishedClauses.has(tok.clause)) modifier = DIMINISH;

    cueTracks.set(i, hits.map((h) => h.track));

    for (const hit of hits) {
      evidence.push({
        track: hit.track,
        surface: tok.surface,
        stem: lang === "sr" ? stems.sr : stems.en,
        weight: hit.weight,
        modifier,
        negated,
        start: tok.start,
        end: tok.end,
      });
    }
  }

  return {
    evidence,
    quantities: extractQuantities(tokens, cueTracks),
    cueTracks,
  };
}
