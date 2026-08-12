/* ────────────────────────────────────────────────────────────────
   Turning matched cues into XP.

   The curve is the same shape as the momentum curve in stats.ts —
   saturating, so a long rant about one topic approaches the 25-point
   ceiling smoothly instead of hitting a cliff, and so writing more
   words about the same thing cannot farm XP.
   ──────────────────────────────────────────────────────────────── */

import { MAX_TRACK_XP, TRACK_KEYS, emptyAwards } from "../tracks.ts";
import type { Awards, Evidence, TrackKey } from "../types.ts";
import type { QuantityHit } from "./match.ts";

/**
 * Raw-score → XP scale factor. Tuned against the golden corpus:
 * one solid cue (weight 2) lands around 8 XP — the "normal workday"
 * the original prompt described — and it takes real accumulation to
 * approach 25.
 */
export const DEFAULT_XP_SCALE = 7.5;

/**
 * How much a quantity contributes, per canonical unit.
 *
 * Calibrated so a stated duration reads as roughly "one strong cue per hour
 * and a half" — enough that "3 sata učenja" clearly outweighs a passing
 * mention of studying, without a single long day pinning the track at 25.
 */
const QUANTITY_WEIGHT: Record<string, number> = {
  duration_h: 1.2,
  // Sleep is upkeep rather than effort. At 0.35 a logged eight-hour night
  // alone kept Body permanently warm, which meant a track could never go
  // dormant for anyone who records their sleep — and the decay alert, the
  // most useful thing the app can say, became unreachable.
  sleep_hours: 0.15,
  distance_km: 0.45,
  pages: 0.05,
  reps: 0.02,
  steps: 0.0004,
};

/** Diminishing returns on repeats of the *same* cue within one entry. */
const REPEAT_DECAY = 0.55;

export interface ScoreResult {
  awards: Awards;
  raw: Record<TrackKey, number>;
}

export function scoreTracks(
  evidence: readonly Evidence[],
  quantities: readonly QuantityHit[],
  xpScale = DEFAULT_XP_SCALE,
): ScoreResult {
  const raw = emptyAwards() as Record<TrackKey, number>;
  const seen = new Map<string, number>();

  for (const e of evidence) {
    if (e.modifier === 0) continue;
    const key = `${e.track}:${e.stem}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    // Repeats still count, but less each time.
    raw[e.track] += e.weight * e.modifier * Math.pow(REPEAT_DECAY, occurrence);
  }

  for (const q of quantities) {
    if (q.track === null) continue;
    const per = QUANTITY_WEIGHT[q.kind];
    if (per === undefined) continue;
    raw[q.track] += q.value * per;
  }

  const awards = emptyAwards();
  for (const track of TRACK_KEYS) {
    const r = raw[track];
    if (r <= 0) continue;
    awards[track] = Math.min(
      MAX_TRACK_XP,
      Math.round(MAX_TRACK_XP * (1 - Math.exp(-r / xpScale))),
    );
  }

  return { awards, raw };
}

/** Which track dominated, and by how much of the day's total. */
export function dominantTrack(
  awards: Awards,
): { track: TrackKey; share: number } | null {
  let total = 0;
  let best: TrackKey | null = null;
  let bestXp = 0;
  for (const t of TRACK_KEYS) {
    total += awards[t];
    if (awards[t] > bestXp) {
      bestXp = awards[t];
      best = t;
    }
  }
  if (best === null || total === 0) return null;
  return { track: best, share: bestXp / total };
}

export function activeTracks(awards: Awards): TrackKey[] {
  return TRACK_KEYS.filter((t) => awards[t] > 0);
}
