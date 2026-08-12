import { TRACK_KEYS } from "./tracks.ts";
import { daysBetween, shiftISO, todayISO } from "./dates.ts";
import {
  DEFAULT_HALF_LIFE,
  decayFactor,
  levelFromXp,
  momentumFromDecayed,
} from "./xp.ts";
import type { Stats, TrackKey } from "./types.ts";

/** The minimum an entry needs for statistics. Keeps tests free of boilerplate. */
export interface Scorable {
  date: string;
  awards: Partial<Record<TrackKey, number>>;
}

export function trackXp(e: Scorable, track: TrackKey): number {
  return e.awards?.[track] ?? 0;
}

export function totalXp(e: Scorable): number {
  let sum = 0;
  for (const k of TRACK_KEYS) sum += trackXp(e, k);
  return sum;
}

/**
 * Levels, momentum, and staleness per track, evaluated at `asOf`.
 *
 * Entries dated after `asOf` are excluded rather than clamped — without that,
 * asking for momentum on a past date would fold in everything that came after
 * it and every historical figure would read as today's.
 */
export function computeStats(
  entries: readonly Scorable[],
  asOf: string = todayISO(),
  halfLife: number = DEFAULT_HALF_LIFE,
): Stats {
  const out = {} as Stats;
  for (const track of TRACK_KEYS) {
    let lifetime = 0;
    let decayed = 0;
    let lastDay: string | null = null;

    for (const e of entries) {
      if (e.date > asOf) continue;
      const xp = trackXp(e, track);
      if (xp <= 0) continue;
      lifetime += xp;
      decayed += xp * decayFactor(daysBetween(e.date, asOf), halfLife);
      if (lastDay === null || e.date > lastDay) lastDay = e.date;
    }

    const { level, into, need } = levelFromXp(lifetime);
    out[track] = {
      lifetime,
      level,
      into,
      need,
      momentum: momentumFromDecayed(decayed),
      daysSince: lastDay ? daysBetween(lastDay, asOf) : null,
    };
  }
  return out;
}

/** One track's momentum at an arbitrary date — the basis of decay alerts. */
export function momentumAsOf(
  entries: readonly Scorable[],
  track: TrackKey,
  asOf: string,
  halfLife: number = DEFAULT_HALF_LIFE,
): number {
  let decayed = 0;
  for (const e of entries) {
    if (e.date > asOf) continue;
    const xp = trackXp(e, track);
    if (xp <= 0) continue;
    decayed += xp * decayFactor(daysBetween(e.date, asOf), halfLife);
  }
  return momentumFromDecayed(decayed);
}

/** Highest momentum this track reached in the `window` days ending at `asOf`. */
export function peakMomentum(
  entries: readonly Scorable[],
  track: TrackKey,
  asOf: string,
  window = 30,
  halfLife: number = DEFAULT_HALF_LIFE,
): { peak: number; peakDate: string } {
  let peak = -1;
  let peakDate = asOf;
  for (let i = window - 1; i >= 0; i--) {
    const day = shiftISO(asOf, -i);
    const m = momentumAsOf(entries, track, day, halfLife);
    if (m > peak) {
      peak = m;
      peakDate = day;
    }
  }
  return { peak: Math.max(0, peak), peakDate };
}

/**
 * Consecutive days written, counting back from today.
 *
 * With `restDays` on, one gap per rolling 7-day stretch is forgiven, so the
 * streak measures whether you kept the practice rather than whether you
 * never once had a bad night.
 */
export function currentStreak(
  entries: readonly Scorable[],
  asOf: string = todayISO(),
  restDays = false,
): number {
  if (entries.length === 0) return 0;
  const days = new Set(entries.map((e) => e.date));

  let cursor = asOf;
  if (!days.has(cursor)) cursor = shiftISO(cursor, -1);

  let streak = 0;
  let skipsUsed = 0;
  let sinceSkip = 0;

  for (;;) {
    if (days.has(cursor)) {
      streak += 1;
      sinceSkip += 1;
      cursor = shiftISO(cursor, -1);
      continue;
    }
    // A rest day may bridge one gap per seven counted days.
    const allowance = restDays ? Math.floor(streak / 7) + 1 : 0;
    if (skipsUsed < allowance && sinceSkip > 0) {
      skipsUsed += 1;
      sinceSkip = 0;
      cursor = shiftISO(cursor, -1);
      continue;
    }
    break;
  }
  return streak;
}

export function longestStreak(entries: readonly Scorable[]): number {
  const days = [...new Set(entries.map((e) => e.date))].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev !== null && shiftISO(prev, 1) === d ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

/** Daily XP totals over a window, for heatmaps. Missing days are 0. */
export function dailyTotals(
  entries: readonly Scorable[],
  days: readonly string[],
): { iso: string; xp: number }[] {
  const byDate = new Map<string, number>();
  for (const e of entries) {
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + totalXp(e));
  }
  return days.map((iso) => ({ iso, xp: byDate.get(iso) ?? 0 }));
}
