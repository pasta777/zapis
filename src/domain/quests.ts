/* ────────────────────────────────────────────────────────────────
   Quests: declare an intention, and entries link themselves to it.

   Matching reuses the same stemmer the cue engine uses, so "finish
   the three exams" links an entry that says "učio za ispit" without
   any shared vocabulary being configured — and without a box to tick.
   ──────────────────────────────────────────────────────────────── */

import { fold, tokenize, type Token } from "./extract/normalize.ts";
import { stemBoth } from "./extract/stem.ts";
import { isStopword } from "./extract/lexicon/stopwords.ts";
import { trackXp, type Scorable } from "./stats.ts";
import type { Lang, Quest, TrackKey } from "./types.ts";

/** Stems worth matching from a quest title — content words only. */
export function questStems(title: string, lang: Lang): Set<string> {
  const { tokens } = tokenize(title);
  const out = new Set<string>();
  for (const tok of tokens) {
    if (tok.surface.length < 3) continue;
    if (/\d/.test(tok.folded)) continue;
    if (isStopword(tok.folded, lang)) continue;
    const { en, sr } = stemBoth(tok.surface);
    if (en.length >= 3) out.add(en);
    if (sr.length >= 3) out.add(sr);
  }
  return out;
}

export interface LinkCandidate {
  questId: number;
  confidence: number;
  /** The sentence that justified the link, quoted. */
  evidence: string;
}

const MIN_CONFIDENCE = 0.34;

/**
 * Link an entry to the quests it advances.
 *
 * Confidence is the share of the quest's content words the entry touched,
 * with a bonus when the entry also scored XP in one of the quest's tracks.
 * A single incidental word is not enough — a quest called "finish the three
 * exams" should not fire on any entry that happens to say "three".
 */
export function linkEntry(
  text: string,
  awards: Partial<Record<TrackKey, number>>,
  quests: readonly Quest[],
  lang: Lang,
): LinkCandidate[] {
  const { tokens, sentences } = tokenize(text);
  const entryStems = new Set<string>();
  const stemToToken = new Map<string, Token>();

  for (const tok of tokens) {
    const { en, sr } = stemBoth(tok.surface);
    for (const s of [en, sr]) {
      if (s.length < 3) continue;
      entryStems.add(s);
      if (!stemToToken.has(s)) stemToToken.set(s, tok);
    }
  }

  const out: LinkCandidate[] = [];

  for (const quest of quests) {
    if (quest.status !== "active") continue;

    const wanted = questStems(quest.title, lang);
    if (wanted.size === 0) continue;

    const hits = [...wanted].filter((s) => entryStems.has(s));
    if (hits.length === 0) continue;

    let confidence = hits.length / wanted.size;

    // Scoring XP in a track the quest names is corroboration, not proof.
    const trackHit = quest.tracks.some((t) => (awards[t] ?? 0) > 0);
    if (trackHit) confidence = Math.min(1, confidence + 0.25);

    if (confidence < MIN_CONFIDENCE) continue;

    // Quote the sentence containing the strongest hit.
    const anchor = stemToToken.get(hits[0]!);
    const sentence = anchor
      ? sentences.find((s) => s.index === anchor.sentence)?.text ?? ""
      : "";

    out.push({
      questId: quest.id,
      confidence: Number(confidence.toFixed(2)),
      evidence: sentence.slice(0, 240),
    });
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

export interface QuestProgress {
  quest: Quest;
  linkedEntries: number;
  /** XP accrued in the quest's tracks across linked entries. */
  xp: number;
  /** Fraction of xpTarget, or null when the quest has no numeric target. */
  fraction: number | null;
  firstTouched: string | null;
  lastTouched: string | null;
  daysRemaining: number | null;
}

export function questProgress(
  quest: Quest,
  linked: readonly Scorable[],
  today: string,
): QuestProgress {
  // A quest with no declared tracks counts every track — the intention is
  // the point, not the bookkeeping.
  const tracks: TrackKey[] =
    quest.tracks.length > 0
      ? quest.tracks
      : (["craft", "study", "body", "bonds", "creation", "spirit", "play"] as TrackKey[]);

  let xp = 0;
  for (const e of linked) for (const t of tracks) xp += trackXp(e, t);

  const dates = linked.map((e) => e.date).sort();

  let daysRemaining: number | null = null;
  if (quest.targetDate) {
    const ms = Date.parse(`${quest.targetDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`);
    daysRemaining = Math.round(ms / 86_400_000);
  }

  return {
    quest,
    linkedEntries: linked.length,
    xp,
    fraction: quest.xpTarget ? Math.min(1, xp / quest.xpTarget) : null,
    firstTouched: dates[0] ?? null,
    lastTouched: dates[dates.length - 1] ?? null,
    daysRemaining,
  };
}

export { fold };
