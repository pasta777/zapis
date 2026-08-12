/* ────────────────────────────────────────────────────────────────
   The leaderboard's feed.

   This module is the *only* thing permitted to read a journal and
   write to `scores`. It takes entries in and emits seven integers
   and a streak — the prose stops here, by construction rather than
   by care.
   ──────────────────────────────────────────────────────────────── */

import {
  OVERALL, getSettings, listEntries, listUsers, writeScores,
  type DB, type ScoreRow,
} from "./db.ts";
import { computeStats, currentStreak } from "../src/domain/stats.ts";
import { levelFromXp } from "../src/domain/xp.ts";
import { TRACK_KEYS } from "../src/domain/tracks.ts";
import { todayISO } from "../src/domain/dates.ts";

/**
 * Overall momentum is the *mean* of the seven tracks, not their sum.
 *
 * Summing would let one obsessive track carry a whole board, which inverts
 * what this app is for — the radar's area is the point, not its longest spoke.
 * The mean also keeps overall on the same 0–100 scale as every track, so the
 * number means the same thing wherever it appears.
 */
function overallMomentum(perTrack: readonly number[]): number {
  if (perTrack.length === 0) return 0;
  return perTrack.reduce((a, b) => a + b, 0) / perTrack.length;
}

/** Recompute one account's scores from its journal. */
export function refreshScores(db: DB, userId: number): void {
  const entries = listEntries(db, userId);
  const settings = getSettings(db, userId);
  const today = todayISO();

  const stats = computeStats(entries, today, settings.halfLife);
  const streak = currentStreak(entries, today, settings.restDays);

  const rows: ScoreRow[] = TRACK_KEYS.map((track) => ({
    track,
    momentum: stats[track].momentum,
    lifetime: stats[track].lifetime,
    level: stats[track].level,
    streak,
    entryCount: entries.length,
  }));

  const lifetime = rows.reduce((sum, r) => sum + r.lifetime, 0);
  rows.push({
    track: OVERALL,
    momentum: overallMomentum(rows.map((r) => r.momentum)),
    lifetime,
    level: levelFromXp(lifetime).level,
    streak,
    entryCount: entries.length,
  });

  writeScores(db, userId, rows);
}

/**
 * Momentum decays with the calendar, not with writes, so a board built only
 * from write-time snapshots would show an account that stopped journaling in
 * March still burning in June. Refreshing everyone on read keeps the ranking
 * honest; at a friends-sized deployment the cost is negligible, and the
 * `maxAgeMinutes` guard stops a busy board from recomputing per request.
 */
export function refreshStaleScores(db: DB, maxAgeMinutes = 180): void {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();

  const stale = db
    .prepare(
      `SELECT u.id FROM users u
       LEFT JOIN scores s ON s.user_id = u.id AND s.track = ?
       WHERE s.updated_at IS NULL OR s.updated_at < ?`,
    )
    .all(OVERALL, cutoff) as { id: number }[];

  for (const { id } of stale) refreshScores(db, id);
}

/** Build scores for every account. Used once at boot after a migration. */
export function refreshAllScores(db: DB): void {
  for (const user of listUsers(db)) refreshScores(db, user.id);
}
