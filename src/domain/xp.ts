/* ────────────────────────────────────────────────────────────────
   Levelling and the momentum curve. Ported unchanged from the
   original single-file version — the feel of these numbers is the
   whole point of the app, so the constants are not up for revision.
   ──────────────────────────────────────────────────────────────── */

export interface Level {
  level: number;
  /** XP accumulated inside the current level. */
  into: number;
  /** XP the current level requires in total. */
  need: number;
}

/**
 * Level from lifetime XP. Level 1 costs 100; each subsequent level costs
 * `100 * level^1.35`, so the curve stretches without ever becoming hopeless.
 */
export function levelFromXp(xp: number): Level {
  let level = 1;
  let need = 100;
  let banked = 0;
  while (banked + need <= xp) {
    banked += need;
    level += 1;
    need = Math.round(100 * Math.pow(level, 1.35));
  }
  return { level, into: xp - banked, need };
}

export const MOMENTUM_BANDS = [
  { min: 85, label: "burning" },
  { min: 65, label: "warm" },
  { min: 35, label: "steady" },
  { min: 15, label: "cooling" },
  { min: -Infinity, label: "dormant" },
] as const;

export type MomentumLabel = (typeof MOMENTUM_BANDS)[number]["label"];

export function momentumLabel(m: number): MomentumLabel {
  for (const band of MOMENTUM_BANDS) if (m >= band.min) return band.label;
  return "dormant";
}

/** Decayed-XP → 0…100. The saturating curve that keeps momentum meaningful. */
export const MOMENTUM_SCALE = 130;

export function momentumFromDecayed(decayed: number): number {
  return Math.round(100 * (1 - Math.exp(-decayed / MOMENTUM_SCALE)));
}

export const DEFAULT_HALF_LIFE = 14;

/** Weight of an award `ago` days old under a given half-life. */
export function decayFactor(ago: number, halfLife = DEFAULT_HALF_LIFE): number {
  return Math.pow(0.5, ago / halfLife);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
