/* ────────────────────────────────────────────────────────────────
   Correlations.

   Two kinds, kept visibly separate:
     same-day — does a Bonds day co-occur with a good mood?
     lag      — does a Bonds day predict a better *next* day?

   The lag version is the interesting one, and also the one most
   easily faked by a small sample, so this module refuses to report a
   number until it has enough paired days and says how many more it
   needs. A confident-looking figure computed from twelve entries is
   worse than no figure at all.
   ──────────────────────────────────────────────────────────────── */

import { TRACK_KEYS } from "./tracks.ts";
import { shiftISO } from "./dates.ts";
import { totalXp, trackXp, type Scorable } from "./stats.ts";
import type { TrackKey } from "./types.ts";

/** Minimum days on each side of the split before a delta is shown. */
export const MIN_GROUP = 8;
/** Below this, r is reported but flagged as noise. */
export const SIGNIFICANCE_P = 0.1;

export interface Entryish extends Scorable {
  mood: number | null;
  energy: number | null;
  metrics?: readonly { kind: string; value: number }[];
}

export type Outcome = "mood" | "energy" | "totalXp";

export interface Correlation {
  track: TrackKey;
  outcome: Outcome;
  /** "same" compares the same day; "lag1" compares the following day. */
  kind: "same" | "lag1";
  /** Mean outcome on days the track fired, minus days it didn't. */
  delta: number | null;
  nOn: number;
  nOff: number;
  /** Pearson r between the track's XP and the outcome. */
  r: number | null;
  /** Two-tailed p from the t-statistic on r. */
  p: number | null;
  /** False when the sample is too small to say anything. */
  ready: boolean;
  /** How many more paired days are needed, when not ready. */
  needed: number;
  /** True when ready but the result is statistically indistinguishable from noise. */
  noise: boolean;
}

function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs.slice(0, n))!;
  const my = mean(ys.slice(0, n))!;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null; // no variance — undefined, not zero
  return num / Math.sqrt(dx * dy);
}

/**
 * Two-tailed p for a correlation coefficient, via the t-distribution.
 *
 * Uses an incomplete-beta evaluation rather than a normal approximation
 * because journal samples are small (n = 20–100) and the approximation is
 * meaningfully wrong exactly there.
 */
export function pValue(r: number, n: number): number | null {
  if (n < 3) return null;
  const df = n - 2;
  const denom = 1 - r * r;
  if (denom <= 0) return 0;
  const t = Math.abs(r) * Math.sqrt(df / denom);
  return studentTTwoTailed(t, df);
}

function studentTTwoTailed(t: number, df: number): number {
  const x = df / (df + t * t);
  return incompleteBeta(x, df / 2, 0.5);
}

/** Regularised incomplete beta, continued-fraction form (Lentz's method). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta =
    logGamma(a + b) - logGamma(a) - logGamma(b) +
    a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lbeta);
  if (x < (a + 1) / (a + b + 2)) return (front * betaCF(x, a, b)) / a;
  return 1 - (Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) +
    b * Math.log(1 - x) + a * Math.log(x),
  ) * betaCF(1 - x, b, a)) / b;
}

function betaCF(x: number, a: number, b: number): number {
  const TINY = 1e-30;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-7) break;
  }
  return h;
}

function logGamma(z: number): number {
  // Lanczos approximation, g = 7.
  const g = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = g[0]!;
  for (let i = 1; i < 9; i++) x += g[i]! / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/* ── pairing ────────────────────────────────────────────────────── */

export interface DayPair {
  today: Entryish;
  next: Entryish;
}

/**
 * Consecutive-day pairs where *both* days were written.
 *
 * Gaps are excluded rather than interpolated: if you skipped Tuesday, then
 * Monday tells you nothing about Wednesday, and inventing a Tuesday would
 * manufacture correlation out of nothing.
 */
export function consecutivePairs(entries: readonly Entryish[]): DayPair[] {
  const byDate = new Map<string, Entryish>();
  for (const e of entries) byDate.set(e.date, e);

  const pairs: DayPair[] = [];
  for (const e of entries) {
    const next = byDate.get(shiftISO(e.date, 1));
    if (next) pairs.push({ today: e, next });
  }
  return pairs;
}

function outcomeOf(e: Entryish, outcome: Outcome): number | null {
  if (outcome === "mood") return e.mood;
  if (outcome === "energy") return e.energy;
  return totalXp(e);
}

function analyse(
  samples: readonly { xp: number; value: number }[],
  track: TrackKey,
  outcome: Outcome,
  kind: "same" | "lag1",
): Correlation {
  const on = samples.filter((s) => s.xp > 0);
  const off = samples.filter((s) => s.xp === 0);

  const ready = on.length >= MIN_GROUP && off.length >= MIN_GROUP;
  const needed = ready
    ? 0
    : Math.max(MIN_GROUP - on.length, 0) + Math.max(MIN_GROUP - off.length, 0);

  const mOn = mean(on.map((s) => s.value));
  const mOff = mean(off.map((s) => s.value));
  const r = pearson(samples.map((s) => s.xp), samples.map((s) => s.value));
  const p = r === null ? null : pValue(r, samples.length);

  return {
    track,
    outcome,
    kind,
    delta: ready && mOn !== null && mOff !== null ? Number((mOn - mOff).toFixed(2)) : null,
    nOn: on.length,
    nOff: off.length,
    r: r === null ? null : Number(r.toFixed(3)),
    p: p === null ? null : Number(p.toFixed(4)),
    ready,
    needed,
    noise: ready && p !== null && p > SIGNIFICANCE_P,
  };
}

/** Same-day association: track XP today vs outcome today. */
export function sameDayCorrelations(
  entries: readonly Entryish[],
  outcome: Outcome = "mood",
): Correlation[] {
  return TRACK_KEYS.map((track) => {
    const samples: { xp: number; value: number }[] = [];
    for (const e of entries) {
      const value = outcomeOf(e, outcome);
      if (value === null) continue;
      samples.push({ xp: trackXp(e, track), value });
    }
    return analyse(samples, track, outcome, "same");
  }).sort(byDeltaDesc);
}

/** Lag-1: track XP today vs outcome *tomorrow*. The one worth waiting for. */
export function lagCorrelations(
  entries: readonly Entryish[],
  outcome: Outcome = "mood",
): Correlation[] {
  const pairs = consecutivePairs(entries);
  return TRACK_KEYS.map((track) => {
    const samples: { xp: number; value: number }[] = [];
    for (const { today, next } of pairs) {
      const value = outcomeOf(next, outcome);
      if (value === null) continue;
      samples.push({ xp: trackXp(today, track), value });
    }
    return analyse(samples, track, outcome, "lag1");
  }).sort(byDeltaDesc);
}

function byDeltaDesc(a: Correlation, b: Correlation): number {
  if (a.ready !== b.ready) return a.ready ? -1 : 1;
  return (b.delta ?? -Infinity) - (a.delta ?? -Infinity);
}

/** Sleep hours today vs mood tomorrow — usually the strongest signal of all. */
export function sleepLagCorrelation(
  entries: readonly Entryish[],
  outcome: Outcome = "mood",
): { r: number | null; p: number | null; n: number; ready: boolean } {
  const pairs = consecutivePairs(entries);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const { today, next } of pairs) {
    const sleep = today.metrics?.find((m) => m.kind === "sleep_hours")?.value;
    const value = outcomeOf(next, outcome);
    if (sleep === undefined || value === null) continue;
    xs.push(sleep);
    ys.push(value);
  }
  const r = pearson(xs, ys);
  return {
    r: r === null ? null : Number(r.toFixed(3)),
    p: r === null ? null : pValue(r, xs.length),
    n: xs.length,
    ready: xs.length >= MIN_GROUP * 2,
  };
}

/** How many paired days exist — what the UI shows while gates are closed. */
export function pairedDayCount(entries: readonly Entryish[]): number {
  return consecutivePairs(entries).length;
}
