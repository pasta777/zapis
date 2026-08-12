/* ────────────────────────────────────────────────────────────────
   Mood and energy from valence lexicons.

   Both are null when the text gives no signal at all — an honest
   "unknown" beats a fabricated 5/10, and the correlation code
   depends on being able to tell those apart.
   ──────────────────────────────────────────────────────────────── */

import { fold, type Token } from "./normalize.ts";
import { stem } from "./stem.ts";
import { isDiminisher, isIntensifier, isNegator, INTENSIFY, DIMINISH } from "./match.ts";
import {
  EMOJI_VALENCE,
  energyLexicon,
  valenceLexicon,
} from "./lexicon/valence.ts";
import { clamp } from "../xp.ts";
import type { Lang } from "../types.ts";

const VALENCE = { en: valenceLexicon("en"), sr: valenceLexicon("sr") };
const ENERGY = { en: energyLexicon("en"), sr: energyLexicon("sr") };

/** Look a word up by fold, then by stem — covers Serbian inflection. */
function lookup(
  lex: Map<string, number>,
  token: Token,
  lang: Lang,
): number | undefined {
  const direct = lex.get(token.folded);
  if (direct !== undefined) return direct;
  return lex.get(stem(token.surface, lang));
}

export interface SentimentHit {
  surface: string;
  value: number;
  start: number;
  end: number;
}

export interface SentimentResult {
  score: number | null;
  hits: SentimentHit[];
}

function scoreAxis(
  tokens: readonly Token[],
  lexicons: { en: Map<string, number>; sr: Map<string, number> },
  perSentenceLang: readonly Lang[],
  fallbackLang: Lang,
): { sum: number; count: number; hits: SentimentHit[] } {
  const negated = new Set<number>();
  const intense = new Set<number>();
  const weak = new Set<number>();
  for (const t of tokens) {
    if (isNegator(t.folded)) negated.add(t.clause);
    if (isIntensifier(t.folded)) intense.add(t.clause);
    if (isDiminisher(t.folded)) weak.add(t.clause);
  }

  let sum = 0;
  let count = 0;
  const hits: SentimentHit[] = [];

  for (const tok of tokens) {
    const lang = perSentenceLang[tok.sentence] ?? fallbackLang;
    const order: Lang[] = lang === "sr" ? ["sr", "en"] : ["en", "sr"];

    let value: number | undefined;
    for (const l of order) {
      value = lookup(lexicons[l], tok, l);
      if (value !== undefined) break;
    }
    if (value === undefined) continue;

    let v = value;
    // Negation inverts and damps: "not great" is mildly bad, not the
    // mirror image of great.
    if (negated.has(tok.clause)) v = -v * 0.7;
    else if (intense.has(tok.clause)) v *= INTENSIFY;
    else if (weak.has(tok.clause)) v *= DIMINISH;

    if (tok.isAllCaps) v *= 1.3; // shouting counts

    sum += v;
    count += 1;
    hits.push({ surface: tok.surface, value: Number(v.toFixed(2)), start: tok.start, end: tok.end });
  }

  return { sum, count, hits };
}

/** Emoji and exclamation runs, which a token-based pass would miss. */
function scoreGlyphs(text: string): { sum: number; count: number; hits: SentimentHit[] } {
  let sum = 0;
  let count = 0;
  const hits: SentimentHit[] = [];

  for (const [emoji, value] of Object.entries(EMOJI_VALENCE)) {
    let idx = text.indexOf(emoji);
    while (idx !== -1) {
      sum += value;
      count += 1;
      hits.push({ surface: emoji, value, start: idx, end: idx + emoji.length });
      idx = text.indexOf(emoji, idx + emoji.length);
    }
  }

  // "!!" amplifies whatever is already there rather than adding its own mood.
  const bangs = (text.match(/!{2,}/g) ?? []).length;
  if (bangs > 0 && count + bangs > 0) sum *= 1 + Math.min(0.3, bangs * 0.1);

  return { sum, count, hits };
}

/**
 * Mood, 1…10, or null when nothing in the text carries valence.
 *
 * tanh keeps the mapping graceful: it takes a genuinely lopsided entry to
 * reach the extremes, so a single "good" doesn't read as euphoria.
 */
export function scoreMood(
  text: string,
  tokens: readonly Token[],
  perSentenceLang: readonly Lang[],
  fallbackLang: Lang,
): SentimentResult {
  const words = scoreAxis(tokens, VALENCE, perSentenceLang, fallbackLang);
  const glyphs = scoreGlyphs(text);

  const count = words.count + glyphs.count;
  if (count === 0) return { score: null, hits: [] };

  const sum = words.sum + glyphs.sum;
  const mean = sum / (3 * count);
  const score = clamp(Math.round(5.5 + 4.5 * Math.tanh(mean)), 1, 10);

  return { score, hits: [...words.hits, ...glyphs.hits] };
}

/** Energy, 1…10. Sleep hours nudge it: under 6h drags, over 7.5h lifts. */
export function scoreEnergy(
  tokens: readonly Token[],
  perSentenceLang: readonly Lang[],
  fallbackLang: Lang,
  sleepHours: number | null,
): SentimentResult {
  const words = scoreAxis(tokens, ENERGY, perSentenceLang, fallbackLang);

  let sum = words.sum;
  let count = words.count;

  if (sleepHours !== null) {
    // Centred on 7.5h, ±1 energy point per hour away from it, capped.
    sum += clamp((sleepHours - 7.5) * 1.0, -3, 2);
    count += 1;
  }

  if (count === 0) return { score: null, hits: [] };

  const mean = sum / (2 * count);
  return {
    score: clamp(Math.round(5.5 + 4.5 * Math.tanh(mean)), 1, 10),
    hits: words.hits,
  };
}

export { fold };
