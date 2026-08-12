/* ────────────────────────────────────────────────────────────────
   The daily note: one sentence, in the register of a records clerk.
   Neutral, specific, no compliments, no advice, no moralising.

   Every note is assembled from facts already computed, so it can
   always be checked against the numbers above it. That is the whole
   argument for doing this with templates rather than prose
   generation — a clerk states the record; it doesn't have opinions.
   ──────────────────────────────────────────────────────────────── */

import { TRACK_KEYS } from "../tracks.ts";
import { activeTracks, dominantTrack } from "./score.ts";
import type { Awards, Lang, Metric, TrackKey } from "../types.ts";

export interface NoteFacts {
  awards: Awards;
  mood: number | null;
  energy: number | null;
  wordCount: number;
  peopleCount: number;
  metrics: readonly Metric[];
  /** Days since each track last scored, from the running stats. */
  daysSince: Partial<Record<TrackKey, number | null>>;
  /** Mood averaged over prior entries, for comparison. */
  moodBaseline: number | null;
}

type Phrases = {
  trackName: Record<TrackKey, string>;
  nothing: string;
  tookTheDay: (track: string, silent: number) => string;
  cold: (track: string, days: number) => string;
  returned: (track: string, days: number) => string;
  highMoodThinDay: string;
  lowMoodFullDay: string;
  moodAbove: (delta: string) => string;
  moodBelow: (delta: string) => string;
  spread: (n: number) => string;
  brief: string;
  long: (n: number) => string;
  sleepShort: (h: number) => string;
  sleepLong: (h: number) => string;
  peopleOnly: string;
  flat: string;
  singleTrack: (track: string) => string;
};

const EN: Phrases = {
  trackName: {
    craft: "Craft", study: "Study", body: "Body", bonds: "Bonds",
    creation: "Creation", spirit: "Spirit", play: "Play",
  },
  nothing: "Nothing scored. That is itself a record.",
  tookTheDay: (t, silent) =>
    `${t} took the day; ${silent} ${silent === 1 ? "track" : "tracks"} recorded nothing.`,
  cold: (t, d) => `${t} has been cold ${d} days.`,
  returned: (t, d) => `${t} recorded again after ${d} days.`,
  highMoodThinDay: "High mood on a thin day.",
  lowMoodFullDay: "A full day, recorded without much warmth.",
  moodAbove: (d) => `Mood ${d} above your baseline.`,
  moodBelow: (d) => `Mood ${d} below your baseline.`,
  spread: (n) => `Spread across ${n} tracks.`,
  brief: "Briefly noted.",
  long: (n) => `${n} words filed.`,
  sleepShort: (h) => `${h} hours of sleep logged.`,
  sleepLong: (h) => `${h} hours of sleep logged.`,
  peopleOnly: "The day's record is mostly other people.",
  flat: "A flat day, plainly stated.",
  singleTrack: (t) => `${t} only.`,
};

const SR: Phrases = {
  trackName: {
    craft: "Rad", study: "Učenje", body: "Telo", bonds: "Veze",
    creation: "Stvaranje", spirit: "Duh", play: "Igra",
  },
  nothing: "Ništa nije zabeleženo. I to je podatak.",
  tookTheDay: (t, silent) =>
    `${t} je uzeo dan; ${silent} ${silent === 1 ? "trak nije" : "traka nisu"} zabeležen${silent === 1 ? "" : "e"}.`,
  cold: (t, d) => `${t} je hladan ${d} dana.`,
  returned: (t, d) => `${t} je ponovo zabeležen posle ${d} dana.`,
  highMoodThinDay: "Dobro raspoloženje na praznom danu.",
  lowMoodFullDay: "Pun dan, zabeležen bez topline.",
  moodAbove: (d) => `Raspoloženje ${d} iznad tvoje osnovne linije.`,
  moodBelow: (d) => `Raspoloženje ${d} ispod tvoje osnovne linije.`,
  spread: (n) => `Raspoređeno na ${n} traka.`,
  brief: "Kratko zabeleženo.",
  long: (n) => `${n} reči zabeleženo.`,
  sleepShort: (h) => `${h} sati sna zabeleženo.`,
  sleepLong: (h) => `${h} sati sna zabeleženo.`,
  peopleOnly: "Dnevni zapis je uglavnom o drugim ljudima.",
  flat: "Ravan dan, jasno rečeno.",
  singleTrack: (t) => `Samo ${t}.`,
};

const PHRASES: Record<Lang, Phrases> = { en: EN, sr: SR };

/**
 * Pick the most specific true statement, then optionally a second clause.
 * Ordered deliberately: a fact about *absence* outranks a fact about volume,
 * because absence is the thing you can't see by reading your own entry.
 */
export function buildNote(facts: NoteFacts, lang: Lang): string {
  const p = PHRASES[lang];
  const active = activeTracks(facts.awards);

  if (active.length === 0) return p.nothing;

  const clauses: string[] = [];
  const dom = dominantTrack(facts.awards);

  // Primary clause.
  if (active.length === 1) {
    clauses.push(p.singleTrack(p.trackName[active[0]!]));
  } else if (dom && dom.share >= 0.6) {
    const silent = TRACK_KEYS.length - active.length;
    clauses.push(p.tookTheDay(p.trackName[dom.track], silent));
  } else if (active.length >= 5) {
    clauses.push(p.spread(active.length));
  }

  // A track waking up after a long silence is worth more than volume.
  let returned: string | null = null;
  let coldest: { track: TrackKey; days: number } | null = null;
  for (const track of TRACK_KEYS) {
    const days = facts.daysSince[track];
    if (days === null || days === undefined) continue;
    if (facts.awards[track] > 0) {
      if (days >= 7 && (returned === null || days > 0)) {
        returned = p.returned(p.trackName[track], days);
      }
    } else if (days >= 7 && (coldest === null || days > coldest.days)) {
      coldest = { track, days };
    }
  }
  if (returned) clauses.push(returned);
  else if (coldest) clauses.push(p.cold(p.trackName[coldest.track], coldest.days));

  // Mood, only when it says something the numbers don't.
  const total = TRACK_KEYS.reduce((a, t) => a + facts.awards[t], 0);
  if (facts.mood !== null) {
    if (facts.mood >= 8 && total < 15) clauses.push(p.highMoodThinDay);
    else if (facts.mood <= 4 && total >= 40) clauses.push(p.lowMoodFullDay);
    else if (facts.moodBaseline !== null) {
      const delta = facts.mood - facts.moodBaseline;
      if (delta >= 2) clauses.push(p.moodAbove(delta.toFixed(1)));
      else if (delta <= -2) clauses.push(p.moodBelow(Math.abs(delta).toFixed(1)));
    }
  }

  const sleep = facts.metrics.find((m) => m.kind === "sleep_hours");
  if (sleep && (sleep.value < 6 || sleep.value >= 9)) {
    clauses.push(
      sleep.value < 6 ? p.sleepShort(sleep.value) : p.sleepLong(sleep.value),
    );
  }

  if (clauses.length === 0) {
    if (facts.wordCount < 25) clauses.push(p.brief);
    else clauses.push(p.flat);
  }

  return clauses.slice(0, 2).join(" ");
}
