/* ────────────────────────────────────────────────────────────────
   Decay alerts.

   A track that was burning and is now dormant is the single most
   useful thing this app can tell you, and it is invisible from
   inside a daily entry — you notice you haven't run in three weeks
   only when something says so.

   Each crossing fires once. Dismissal sticks until the track climbs
   back out and falls again, so the banner can never nag.
   ──────────────────────────────────────────────────────────────── */

import { TRACK_KEYS } from "./tracks.ts";
import { momentumAsOf, peakMomentum, type Scorable } from "./stats.ts";
import { DEFAULT_HALF_LIFE } from "./xp.ts";
import { todayISO } from "./dates.ts";
import type { AlertKind, TrackKey } from "./types.ts";

/** Momentum a track must have reached for its fall to be worth reporting. */
export const PEAK_THRESHOLD = 60;
/** Full alert below this. */
export const DECAY_FLOOR = 15;
/** Earlier, still-actionable warning below this. */
export const WARNING_FLOOR = 25;

/**
 * How far back to look for the peak — derived from the half-life, not fixed.
 *
 * The two ends of this rule have to be compatible or it can never fire. Under
 * a 14-day half-life, decaying from momentum 60 down to 15 takes a little
 * over three half-lives, roughly 43 days. A fixed 30-day window would
 * therefore have aged the peak out of scope *before* the current value got
 * low enough to qualify — the alert would be unreachable, silently, forever.
 *
 * 4.5 half-lives leaves room for the crossing to happen and still be seen.
 * Because the half-life is a user setting, the window follows it.
 */
export function peakWindowFor(halfLife: number): number {
  return Math.max(30, Math.ceil(halfLife * 4.5));
}

/** The default window, for callers using the default half-life. */
export const PEAK_WINDOW = peakWindowFor(DEFAULT_HALF_LIFE);

export interface DecayCandidate {
  track: TrackKey;
  kind: AlertKind;
  peak: number;
  peakDate: string;
  current: number;
}

/**
 * Which tracks have crossed downward, given the entry history.
 *
 * Pure: it reports the current state of the world. Deciding what is *new*
 * is `diffAlerts` below, which needs the already-recorded alerts.
 */
export function detectDecay(
  entries: readonly Scorable[],
  asOf: string = todayISO(),
  halfLife = DEFAULT_HALF_LIFE,
): DecayCandidate[] {
  const out: DecayCandidate[] = [];

  const window = peakWindowFor(halfLife);

  for (const track of TRACK_KEYS) {
    const current = momentumAsOf(entries, track, asOf, halfLife);
    if (current >= WARNING_FLOOR) continue;

    const { peak, peakDate } = peakMomentum(entries, track, asOf, window, halfLife);
    if (peak < PEAK_THRESHOLD) continue;

    out.push({
      track,
      kind: current < DECAY_FLOOR ? "decay" : "decay_warning",
      peak,
      peakDate,
      current,
    });
  }

  return out.sort((a, b) => b.peak - b.current - (a.peak - a.current));
}

export interface ExistingAlert {
  track: TrackKey;
  kind: AlertKind;
  dismissedAt: string | null;
}

/**
 * Candidates that should be raised now.
 *
 * A crossing already on file — dismissed or not — is not raised again. The
 * escalation from warning to full alert *is* a new event, so it fires even if
 * the warning was dismissed: it's new information, not a repeat.
 */
export function diffAlerts(
  candidates: readonly DecayCandidate[],
  existing: readonly ExistingAlert[],
): DecayCandidate[] {
  const onFile = new Set(existing.map((a) => `${a.track}:${a.kind}`));
  return candidates.filter((c) => !onFile.has(`${c.track}:${c.kind}`));
}

/**
 * Alerts whose track has recovered, and which can therefore be cleared so a
 * future fall reports again. Without this, a track can only ever alert once.
 */
export function staleAlerts(
  entries: readonly Scorable[],
  existing: readonly ExistingAlert[],
  asOf: string = todayISO(),
  halfLife = DEFAULT_HALF_LIFE,
): ExistingAlert[] {
  return existing.filter((a) => {
    const current = momentumAsOf(entries, a.track, asOf, halfLife);
    // Recovered past the warning line: the episode is over.
    return current >= WARNING_FLOOR + 10;
  });
}
