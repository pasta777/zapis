/* ────────────────────────────────────────────────────────────────
   Shared shapes. The entry shape is deliberately compatible with
   the legacy `lifelog:v2` export so old data imports without loss.
   ──────────────────────────────────────────────────────────────── */

export type TrackKey =
  | "craft"
  | "study"
  | "body"
  | "bonds"
  | "creation"
  | "spirit"
  | "play";

export type Lang = "en" | "sr";

/** XP per track for a single day. Always contains all seven keys. */
export type Awards = Record<TrackKey, number>;

/** A quantity the engine pulled out of the prose, e.g. 3 hours, 5 km. */
export interface Metric {
  kind: string; // sleep_hours | distance_km | pages | duration_min | reps
  value: number;
  unit: string;
  track: TrackKey | null;
}

/** Why a track scored what it scored. The audit trail for every number. */
export interface Evidence {
  track: TrackKey;
  /** The word as it appears in your text, not the stem. */
  surface: string;
  stem: string;
  weight: number;
  /** 1 normally, 0 when negated, 1.6 when intensified, 0.5 when diminished. */
  modifier: number;
  negated: boolean;
  /** Character offsets into the original text, for highlighting. */
  start: number;
  end: number;
}

/** What the extractor produces, before you approve it. */
export interface Draft {
  awards: Awards;
  mood: number | null;
  energy: number | null;
  /** Names matched against the registry. Safe to store. */
  people: string[];
  /** Capitalised words that look like names but aren't known yet. */
  personCandidates: string[];
  events: string[];
  tags: DraftTag[];
  note: string;
  lang: Lang;
  metrics: Metric[];
  evidence: Evidence[];
  wordCount: number;
}

export interface DraftTag {
  stem: string;
  display: string;
  score: number;
}

/** A filed entry. `autoAwards` preserves what the engine said before you nudged it. */
export interface Entry {
  id: number;
  date: string; // ISO yyyy-mm-dd
  text: string;
  lang: Lang;
  awards: Awards;
  autoAwards: Awards;
  mood: number | null;
  energy: number | null;
  people: string[];
  events: string[];
  tags: string[];
  note: string;
  metrics: Metric[];
  createdAt: string;
  editedAt: string | null;
}

export interface TrackStat {
  lifetime: number;
  level: number;
  into: number;
  need: number;
  momentum: number;
  daysSince: number | null;
}

export type Stats = Record<TrackKey, TrackStat>;

export interface Quest {
  id: number;
  title: string;
  tracks: TrackKey[];
  createdAt: string;
  targetDate: string | null;
  status: "active" | "done" | "abandoned";
  xpTarget: number | null;
}

export interface QuestLink {
  questId: number;
  entryId: number;
  confidence: number;
  evidence: string;
}

export interface Person {
  id: number;
  canonical: string;
  display: string;
  aliases: string[];
  firstSeen: string;
  lastSeen: string;
  appearances: number;
}

export interface Cue {
  id: number;
  lang: Lang;
  track: TrackKey;
  stem: string;
  weight: number;
  source: "seed" | "user" | "learned";
  seedWeight: number;
}

export type AlertKind = "decay" | "decay_warning";

export interface Alert {
  id: number;
  track: TrackKey;
  kind: AlertKind;
  peak: number;
  current: number;
  triggeredAt: string;
  dismissedAt: string | null;
}

export interface Settings {
  lang: Lang;
  halfLife: number;
  xpScale: number;
  notify: boolean;
  restDays: boolean;
}
