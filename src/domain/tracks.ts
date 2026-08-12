import type { TrackKey } from "./types.ts";

export interface TrackDef {
  key: TrackKey;
  /** English name. Localised labels live in src/i18n. */
  name: string;
  hint: string;
}

/** The seven tracks. Order is load-bearing: it fixes the radar's geometry. */
export const TRACKS: readonly TrackDef[] = [
  {
    key: "craft",
    name: "Craft",
    hint: "paid & technical work — code, systems, problems solved on the job",
  },
  {
    key: "study",
    name: "Study",
    hint: "deliberate learning — coursework, languages, reading to understand",
  },
  {
    key: "body",
    name: "Body",
    hint: "sleep, movement, food, health admin, physical upkeep",
  },
  {
    key: "bonds",
    name: "Bonds",
    hint: "real contact — conversations and time with people that landed",
  },
  {
    key: "creation",
    name: "Creation",
    hint: "making things that didn't exist — writing, art, builds, side projects",
  },
  {
    key: "spirit",
    name: "Spirit",
    hint: "prayer, reflection, silence, whatever steadies you",
  },
  {
    key: "play",
    name: "Play",
    hint: "games, music, films, rest taken on purpose — a resource, not a penalty",
  },
] as const;

export const TRACK_KEYS: readonly TrackKey[] = TRACKS.map((t) => t.key);

export function isTrackKey(v: unknown): v is TrackKey {
  return typeof v === "string" && (TRACK_KEYS as string[]).includes(v);
}

export function trackDef(key: TrackKey): TrackDef {
  const found = TRACKS.find((t) => t.key === key);
  if (!found) throw new Error(`unknown track: ${key}`);
  return found;
}

/** A zeroed award set. Every award object in the system has all seven keys. */
export function emptyAwards(): Record<TrackKey, number> {
  return {
    craft: 0,
    study: 0,
    body: 0,
    bonds: 0,
    creation: 0,
    spirit: 0,
    play: 0,
  };
}

export const MAX_TRACK_XP = 25;
