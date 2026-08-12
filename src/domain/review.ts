/* ────────────────────────────────────────────────────────────────
   The weekly review.

   Findings are returned as structured data, not prose, so the UI can
   render them in either language and the cache can store them
   verbatim. Detectors are ordered so that *absence* outranks volume:
   what you stopped doing is the thing you cannot see by re-reading
   your own week, and it is a set difference, not a judgement call.
   ──────────────────────────────────────────────────────────────── */

import { TRACK_KEYS } from "./tracks.ts";
import { dateRange, shiftISO, weekStart } from "./dates.ts";
import { momentumAsOf, totalXp, trackXp } from "./stats.ts";
import { DEFAULT_HALF_LIFE } from "./xp.ts";
import { wordCount } from "./extract/normalize.ts";
import type { TrackKey } from "./types.ts";

export interface ReviewEntry {
  date: string;
  text: string;
  mood: number | null;
  energy: number | null;
  awards: Partial<Record<TrackKey, number>>;
  people: readonly string[];
  tags: readonly string[];
}

export type FindingKind =
  | "absence"
  | "personDropped"
  | "personNew"
  | "momentumSwing"
  | "varianceShift"
  | "tagNew"
  | "tagGone"
  | "cadence"
  | "moodExtreme"
  | "trackReturned"
  | "quietWeek";

export interface Finding {
  kind: FindingKind;
  /** Higher sorts first. Absence findings are weighted deliberately high. */
  priority: number;
  /** Everything the UI needs to phrase this in any language. */
  data: Record<string, string | number | null>;
}

export interface WeeklyReview {
  weekStart: string;
  weekEnd: string;
  entryCount: number;
  totalXp: number;
  avgWords: number;
  longestGap: number;
  moodMean: number | null;
  moodSigma: number | null;
  findings: Finding[];
  perTrack: { track: TrackKey; xp: number; momentumDelta: number }[];
}

function inWindow(entries: readonly ReviewEntry[], from: string, to: string) {
  return entries.filter((e) => e.date >= from && e.date <= to);
}

function mean(xs: readonly number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sigma(xs: readonly number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/** Longest run of consecutive unwritten days inside the window. */
function longestGap(entries: readonly ReviewEntry[], from: string, to: string): number {
  const written = new Set(entries.map((e) => e.date));
  let worst = 0;
  let run = 0;
  for (const day of dateRange(from, to)) {
    if (written.has(day)) run = 0;
    else {
      run += 1;
      if (run > worst) worst = run;
    }
  }
  return worst;
}

const ABSENCE_LOOKBACK_WEEKS = 3;
const PERSON_LOOKBACK_WEEKS = 4;
const MOMENTUM_SWING = 15;

export function buildWeeklyReview(
  all: readonly ReviewEntry[],
  anchor: string,
  halfLife = DEFAULT_HALF_LIFE,
): WeeklyReview {
  const start = weekStart(anchor);
  const end = shiftISO(start, 6);
  const week = inWindow(all, start, end);
  const findings: Finding[] = [];

  /**
   * Absence and return findings compare against history, so they are only
   * meaningful once history exists. Without this guard a brand-new journal
   * reports every track it touched as "returned after a silence" — the
   * silence being the time before you started writing.
   */
  const earliest = all.reduce<string | null>(
    (min, e) => (min === null || e.date < min ? e.date : min),
    null,
  );
  const hasHistoryBefore = (weeks: number) =>
    earliest !== null && earliest <= shiftISO(start, -7 * weeks);

  /* ── absence: a track that was live and has now gone silent ──── */
  for (const track of TRACK_KEYS) {
    const thisWeek = week.reduce((a, e) => a + trackXp(e, track), 0);
    if (thisWeek > 0) continue;

    let activeWeeks = 0;
    for (let i = 1; i <= ABSENCE_LOOKBACK_WEEKS; i++) {
      const s = shiftISO(start, -7 * i);
      const xp = inWindow(all, s, shiftISO(s, 6)).reduce(
        (a, e) => a + trackXp(e, track),
        0,
      );
      if (xp > 0) activeWeeks += 1;
    }
    if (activeWeeks >= 2) {
      findings.push({
        kind: "absence",
        priority: 100 + activeWeeks,
        data: { track, activeWeeks },
      });
    }
  }

  /* ── a track waking up after a silence ───────────────────────── */
  for (const track of TRACK_KEYS) {
    if (!hasHistoryBefore(2)) break;
    const thisWeek = week.reduce((a, e) => a + trackXp(e, track), 0);
    if (thisWeek === 0) continue;
    let silentWeeks = 0;
    for (let i = 1; i <= ABSENCE_LOOKBACK_WEEKS; i++) {
      const s = shiftISO(start, -7 * i);
      const xp = inWindow(all, s, shiftISO(s, 6)).reduce(
        (a, e) => a + trackXp(e, track),
        0,
      );
      if (xp === 0) silentWeeks += 1;
      else break;
    }
    if (silentWeeks >= 2) {
      findings.push({
        kind: "trackReturned",
        priority: 90,
        data: { track, silentWeeks, xp: thisWeek },
      });
    }
  }

  /* ── people: who dropped out, who is new ─────────────────────── */
  const weekPeople = new Set(week.flatMap((e) => [...e.people]));
  const priorPeopleWeeks = new Map<string, number>();
  for (let i = 1; i <= PERSON_LOOKBACK_WEEKS; i++) {
    const s = shiftISO(start, -7 * i);
    const seen = new Set(
      inWindow(all, s, shiftISO(s, 6)).flatMap((e) => [...e.people]),
    );
    for (const p of seen) priorPeopleWeeks.set(p, (priorPeopleWeeks.get(p) ?? 0) + 1);
  }

  for (const [person, weeks] of priorPeopleWeeks) {
    if (weeks >= 3 && !weekPeople.has(person)) {
      findings.push({
        kind: "personDropped",
        priority: 95 + weeks,
        data: { person, weeks },
      });
    }
  }

  // "New" only means something once there is a before to be new against;
  // in week one everybody you mention is trivially new.
  if (hasHistoryBefore(1)) {
    const everBefore = new Set(
      all.filter((e) => e.date < start).flatMap((e) => [...e.people]),
    );
    for (const person of weekPeople) {
      if (!everBefore.has(person)) {
        findings.push({ kind: "personNew", priority: 70, data: { person } });
      }
    }
  }

  /* ── momentum swings ─────────────────────────────────────────── */
  const perTrack = TRACK_KEYS.map((track) => {
    const before = momentumAsOf(all, track, shiftISO(start, -1), halfLife);
    const after = momentumAsOf(all, track, end, halfLife);
    const delta = after - before;
    if (Math.abs(delta) >= MOMENTUM_SWING) {
      findings.push({
        kind: "momentumSwing",
        priority: 80 + Math.min(10, Math.abs(delta) / 5),
        data: { track, delta, from: before, to: after },
      });
    }
    return {
      track,
      xp: week.reduce((a, e) => a + trackXp(e, track), 0),
      momentumDelta: delta,
    };
  });

  /* ── mood: level and volatility ──────────────────────────────── */
  const moods = week.map((e) => e.mood).filter((m): m is number => m !== null);
  const moodMean = mean(moods);
  const moodSigma = sigma(moods);

  const priorMoods: number[] = [];
  for (let i = 1; i <= PERSON_LOOKBACK_WEEKS; i++) {
    const s = shiftISO(start, -7 * i);
    for (const e of inWindow(all, s, shiftISO(s, 6))) {
      if (e.mood !== null) priorMoods.push(e.mood);
    }
  }
  const priorSigma = sigma(priorMoods);
  if (moodSigma !== null && priorSigma !== null && priorSigma > 0) {
    const ratio = moodSigma / priorSigma;
    if (ratio >= 1.5 || ratio <= 0.6) {
      findings.push({
        kind: "varianceShift",
        priority: 60,
        data: {
          sigma: Number(moodSigma.toFixed(2)),
          priorSigma: Number(priorSigma.toFixed(2)),
          direction: ratio >= 1.5 ? "up" : "down",
        },
      });
    }
  }

  if (moods.length >= 3) {
    const best = week.reduce((a, e) => ((e.mood ?? -1) > (a.mood ?? -1) ? e : a));
    const worst = week.reduce((a, e) => ((e.mood ?? 11) < (a.mood ?? 11) ? e : a));
    if (best.mood !== null && worst.mood !== null && best.mood - worst.mood >= 4) {
      findings.push({
        kind: "moodExtreme",
        priority: 55,
        data: {
          bestDate: best.date, bestMood: best.mood,
          worstDate: worst.date, worstMood: worst.mood,
        },
      });
    }
  }

  /* ── tag drift ───────────────────────────────────────────────── */
  const weekTags = new Set(week.flatMap((e) => [...e.tags]));
  const priorTags = new Set(
    inWindow(all, shiftISO(start, -7 * PERSON_LOOKBACK_WEEKS), shiftISO(start, -1))
      .flatMap((e) => [...e.tags]),
  );
  const newTags = hasHistoryBefore(1)
    ? [...weekTags].filter((t) => !priorTags.has(t))
    : [];
  const goneTags = [...priorTags].filter((t) => !weekTags.has(t));
  if (newTags.length > 0) {
    findings.push({
      kind: "tagNew",
      priority: 50,
      data: { tags: newTags.slice(0, 5).join(", "), count: newTags.length },
    });
  }
  if (goneTags.length >= 3) {
    findings.push({
      kind: "tagGone",
      priority: 45,
      data: { tags: goneTags.slice(0, 5).join(", "), count: goneTags.length },
    });
  }

  /* ── cadence ─────────────────────────────────────────────────── */
  const gap = longestGap(week, start, end);
  const words = week.map((e) => wordCount(e.text));
  const avgWords = Math.round(mean(words) ?? 0);

  findings.push({
    kind: "cadence",
    priority: 40,
    data: { entries: week.length, avgWords, longestGap: gap },
  });

  if (week.length === 0) {
    findings.push({ kind: "quietWeek", priority: 120, data: {} });
  }

  findings.sort((a, b) => b.priority - a.priority);

  return {
    weekStart: start,
    weekEnd: end,
    entryCount: week.length,
    totalXp: week.reduce((a, e) => a + totalXp(e), 0),
    avgWords,
    longestGap: gap,
    moodMean: moodMean === null ? null : Number(moodMean.toFixed(2)),
    moodSigma: moodSigma === null ? null : Number(moodSigma.toFixed(2)),
    findings,
    perTrack,
  };
}

/** Stable hash of a week's inputs, so a cached review invalidates correctly. */
export function reviewHash(entries: readonly ReviewEntry[], start: string): string {
  const end = shiftISO(start, 6);
  const relevant = entries
    .filter((e) => e.date >= shiftISO(start, -7 * PERSON_LOOKBACK_WEEKS) && e.date <= end)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  let h = 2166136261;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  };
  for (const e of relevant) {
    feed(e.date);
    feed(String(e.mood));
    feed(e.text.length.toString());
    for (const t of TRACK_KEYS) feed(String(trackXp(e, t)));
    feed(e.people.join(","));
    feed(e.tags.join(","));
  }
  return (h >>> 0).toString(16);
}
