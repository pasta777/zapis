/* ────────────────────────────────────────────────────────────────
   Achievements — computed, never granted.

   Every one of these is derived from history, so none can be farmed
   by writing more words: the engine caps per-track XP, and the
   conditions below are about shape and persistence rather than volume.
   Recomputed on read; nothing is stored, so they can never drift out
   of sync with the ledger.
   ──────────────────────────────────────────────────────────────── */

import { TRACK_KEYS } from "./tracks.ts";
import { compareISO, daysBetween, shiftISO, todayISO } from "./dates.ts";
import { longestStreak, momentumAsOf, totalXp, trackXp, type Scorable } from "./stats.ts";
import { DEFAULT_HALF_LIFE } from "./xp.ts";
import type { TrackKey } from "./types.ts";

export interface AchievementEntry extends Scorable {
  text: string;
  mood: number | null;
  people: readonly string[];
}

export interface Achievement {
  id: string;
  /** Filled in by the i18n layer; data carries the specifics. */
  data: Record<string, string | number>;
  earnedOn: string | null;
  progress: number; // 0…1
  earned: boolean;
}

export function computeAchievements(
  entries: readonly AchievementEntry[],
  asOf: string = todayISO(),
  halfLife = DEFAULT_HALF_LIFE,
): Achievement[] {
  const sorted = [...entries].sort((a, b) => compareISO(a.date, b.date));
  const out: Achievement[] = [];

  const add = (
    id: string,
    earned: boolean,
    progress: number,
    earnedOn: string | null = null,
    data: Record<string, string | number> = {},
  ) => out.push({ id, earned, progress: Math.min(1, progress), earnedOn, data });

  /* ── volume milestones ───────────────────────────────────────── */
  for (const n of [1, 10, 50, 100, 365, 1000]) {
    const hit = sorted[n - 1];
    add(`entries_${n}`, sorted.length >= n, sorted.length / n, hit?.date ?? null, {
      count: n,
    });
  }

  /* ── the all-seven day: every track scored at once ───────────── */
  const allSeven = sorted.find((e) => TRACK_KEYS.every((t) => trackXp(e, t) > 0));
  const bestSpread = sorted.reduce(
    (best, e) => Math.max(best, TRACK_KEYS.filter((t) => trackXp(e, t) > 0).length),
    0,
  );
  add("all_seven", allSeven !== undefined, bestSpread / TRACK_KEYS.length,
    allSeven?.date ?? null, { tracks: bestSpread });

  /* ── streaks ─────────────────────────────────────────────────── */
  const best = longestStreak(sorted);
  for (const n of [7, 30, 100]) {
    add(`streak_${n}`, best >= n, best / n, null, { days: n, best });
  }

  /* ── a track carried from dormant to burning ─────────────────── */
  for (const track of TRACK_KEYS) {
    let sawDormant = false;
    let earnedOn: string | null = null;
    let peak = 0;
    for (const e of sorted) {
      const m = momentumAsOf(sorted, track, e.date, halfLife);
      peak = Math.max(peak, m);
      if (m < 15) sawDormant = true;
      else if (sawDormant && m >= 85 && earnedOn === null) earnedOn = e.date;
    }
    add(`kindled_${track}`, earnedOn !== null, peak / 85, earnedOn, { track });
  }

  /* ── a single track at maximum for a full week ───────────────── */
  for (const track of TRACK_KEYS) {
    let earnedOn: string | null = null;
    let bestRun = 0;
    let run = 0;
    let prev: string | null = null;
    for (const e of sorted) {
      const consecutive = prev !== null && shiftISO(prev, 1) === e.date;
      run = trackXp(e, track) > 0 ? (consecutive ? run + 1 : 1) : 0;
      if (run > bestRun) bestRun = run;
      if (run >= 7 && earnedOn === null) earnedOn = e.date;
      prev = e.date;
    }
    add(`week_of_${track}`, earnedOn !== null, bestRun / 7, earnedOn, { track });
  }

  /* ── the honest empty day: filed with nothing to report ──────── */
  const empty = sorted.find((e) => totalXp(e) === 0 && e.text.length > 0);
  add("honest_zero", empty !== undefined, empty ? 1 : 0, empty?.date ?? null);

  /* ── breadth of people ──────────────────────────────────────── */
  const everyone = new Set(sorted.flatMap((e) => [...e.people]));
  for (const n of [5, 25]) {
    add(`people_${n}`, everyone.size >= n, everyone.size / n, null, {
      count: n, seen: everyone.size,
    });
  }

  /* ── a year of history ──────────────────────────────────────── */
  const first = sorted[0];
  const span = first ? daysBetween(first.date, asOf) : 0;
  add("one_year", span >= 365, span / 365, first ? shiftISO(first.date, 365) : null, {
    days: span,
  });

  return out;
}

/** Chapters: change-points in what your days are made of. */
export interface Chapter {
  start: string;
  end: string;
  /** Track shares over the chapter, summing to 1. */
  profile: Record<TrackKey, number>;
  dominant: TrackKey;
  entryCount: number;
}

const CHAPTER_WINDOW = 14;
const CHAPTER_MIN_LENGTH = 21;

/**
 * Absolute floor on what counts as a change of chapter.
 *
 * Cosine distance between two normalised seven-track profiles is a small
 * number in practice: across a real four-month history the median week-to-week
 * wobble sits near 0.03 and even a track dying outright only reaches ~0.16.
 * A threshold picked by intuition (0.35 was the first guess) never fires at
 * all, which is worse than firing too often — it looks like the feature is
 * broken rather than conservative.
 */
const CHAPTER_FLOOR = 0.1;

/**
 * ...and a relative term, because "a big shift" means different things for
 * different people. A life with a steady rhythm should split on a change that
 * would be ordinary noise in a chaotic one, so the bar is also three times
 * this particular journal's own median wobble.
 */
const CHAPTER_NOISE_MULTIPLE = 3;

function profileOf(entries: readonly Scorable[]): Record<TrackKey, number> {
  const raw = {} as Record<TrackKey, number>;
  let total = 0;
  for (const t of TRACK_KEYS) {
    raw[t] = entries.reduce((a, e) => a + trackXp(e, t), 0);
    total += raw[t];
  }
  if (total === 0) return raw;
  for (const t of TRACK_KEYS) raw[t] = raw[t] / total;
  return raw;
}

function cosineDistance(a: Record<TrackKey, number>, b: Record<TrackKey, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const t of TRACK_KEYS) {
    dot += a[t] * b[t];
    na += a[t] ** 2;
    nb += b[t] ** 2;
  }
  if (na === 0 || nb === 0) return 0;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Split history where the *composition* of your days changes.
 *
 * Compares two adjacent 14-day profiles and cuts when they point in
 * meaningfully different directions. It is not detecting that you got busier —
 * the profiles are normalised — but that the balance shifted, which is what a
 * chapter of a life actually is.
 */
export function detectChapters(entries: readonly AchievementEntry[]): Chapter[] {
  const sorted = [...entries].sort((a, b) => compareISO(a.date, b.date));
  if (sorted.length < CHAPTER_MIN_LENGTH) return wholeSpan(sorted);

  // Measure every adjacent-window distance first, so the threshold can be set
  // against this journal's own baseline rather than an assumed one.
  const distances: number[] = [];
  for (let i = CHAPTER_WINDOW; i < sorted.length - CHAPTER_WINDOW; i++) {
    distances.push(
      cosineDistance(
        profileOf(sorted.slice(i - CHAPTER_WINDOW, i)),
        profileOf(sorted.slice(i, i + CHAPTER_WINDOW)),
      ),
    );
  }
  if (distances.length === 0) return wholeSpan(sorted);

  const median = [...distances].sort((a, b) => a - b)[Math.floor(distances.length / 2)]!;
  const threshold = Math.max(CHAPTER_FLOOR, median * CHAPTER_NOISE_MULTIPLE);

  const cuts: string[] = [];
  let lastCutDate = sorted[0]!.date;

  for (let i = CHAPTER_WINDOW; i < sorted.length - CHAPTER_WINDOW; i++) {
    const here = sorted[i]!.date;
    if (daysBetween(lastCutDate, here) < CHAPTER_MIN_LENGTH) continue;
    if (distances[i - CHAPTER_WINDOW]! >= threshold) {
      cuts.push(here);
      lastCutDate = here;
    }
  }

  const bounds = [sorted[0]!.date, ...cuts, shiftISO(sorted[sorted.length - 1]!.date, 1)];
  const out: Chapter[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i]!;
    const endExclusive = bounds[i + 1]!;
    const slice = sorted.filter((e) => e.date >= start && e.date < endExclusive);
    if (slice.length === 0) continue;
    const profile = profileOf(slice);
    out.push({
      start,
      end: slice[slice.length - 1]!.date,
      profile,
      dominant: TRACK_KEYS.reduce((a, t) => (profile[t] > profile[a] ? t : a), TRACK_KEYS[0]!),
      entryCount: slice.length,
    });
  }
  return out;
}

function wholeSpan(sorted: readonly AchievementEntry[]): Chapter[] {
  if (sorted.length === 0) return [];
  const profile = profileOf(sorted);
  return [
    {
      start: sorted[0]!.date,
      end: sorted[sorted.length - 1]!.date,
      profile,
      dominant: TRACK_KEYS.reduce((a, t) => (profile[t] > profile[a] ? t : a), TRACK_KEYS[0]!),
      entryCount: sorted.length,
    },
  ];
}
