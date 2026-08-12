/* ────────────────────────────────────────────────────────────────
   The golden corpus.

   Hand-labelled entries with expected *ranges* rather than exact
   numbers — a rule engine's precise output will shift as the lexicon
   grows, and pinning exact values would make every improvement look
   like a regression. Ranges catch the failures that matter: a track
   scoring zero when it should be high, negation leaking, a quantity
   attributed to the wrong track.

   This file is the safety net that lets the lexicon keep growing for
   years. Add a case whenever the engine gets something wrong.
   ──────────────────────────────────────────────────────────────── */

import type { Lang, TrackKey } from "../src/domain/types.ts";

export interface Expectation {
  name: string;
  text: string;
  lang: Lang;
  /** Inclusive [min, max] XP per track. Omitted tracks must be exactly 0. */
  expect: Partial<Record<TrackKey, [number, number]>>;
  /** Inclusive mood band, or null to require no mood reading at all. */
  mood?: [number, number] | null;
  energy?: [number, number] | null;
  /** Substrings that must appear among the extracted metrics' kinds. */
  metrics?: string[];
  /** Person candidates that must be offered / must not be offered. */
  candidates?: { some?: string[]; none?: string[] };
}

export const CORPUS: Expectation[] = [
  /* ── English: ordinary days ──────────────────────────────────── */
  {
    name: "en/plain workday",
    text: "Worked on the billing service most of the day, fixed two bugs and pushed a release.",
    lang: "en",
    expect: { craft: [8, 25] },
  },
  {
    name: "en/study with pages",
    text: "Read 60 pages of the statistics textbook and did the exercises for chapter four.",
    lang: "en",
    expect: { study: [8, 25] },
    metrics: ["pages"],
  },
  {
    name: "en/gym and food",
    text: "Went to the gym, deadlifts and squats. Cooked a proper dinner instead of ordering.",
    lang: "en",
    expect: { body: [8, 25] },
  },
  {
    name: "en/friends",
    text: "Long dinner with Marko and Jelena. We talked for three hours and laughed a lot.",
    lang: "en",
    // Dinner is contact and also food; both tracks scoring is correct.
    expect: { bonds: [8, 25], body: [0, 8] },
    mood: [6, 10],
    candidates: { some: ["Marko", "Jelena"] },
  },
  {
    name: "en/creation",
    text: "Wrote a short story in the evening and sketched the cover for it.",
    lang: "en",
    expect: { creation: [6, 25] },
  },
  {
    name: "en/spirit",
    text: "Went to liturgy in the morning, then sat in silence for a while and prayed.",
    lang: "en",
    expect: { spirit: [8, 25] },
  },
  {
    name: "en/play is not a penalty",
    text: "Watched two films and played chess with my brother. Deliberately did nothing useful.",
    lang: "en",
    expect: { play: [6, 25], bonds: [0, 25] },
  },

  /* ── negation must suppress, not score ───────────────────────── */
  {
    name: "en/negation suppresses gym",
    text: "I didn't go to the gym today, but I read 40 pages.",
    lang: "en",
    expect: { study: [5, 25] },
    metrics: ["pages"],
  },
  {
    name: "en/skipped",
    text: "Skipped my run. Meant to write but never opened the laptop.",
    lang: "en",
    expect: {},
  },
  {
    name: "sr/negation suppresses running",
    text: "Nisam trčao danas, ali sam čitao 40 strana.",
    lang: "sr",
    expect: { study: [5, 25] },
  },
  {
    name: "sr/negation across clause boundary",
    text: "Nisam vežbao, ali sam radio na projektu ceo dan.",
    lang: "sr",
    expect: { craft: [5, 25] },
  },

  /* ── Serbian: ordinary days ──────────────────────────────────── */
  {
    name: "sr/workday",
    text: "Radio sam na serveru šest sati i konačno rešio grešku u naplati.",
    lang: "sr",
    expect: { craft: [8, 25] },
    metrics: ["duration_h"],
  },
  {
    name: "sr/study for exam",
    text: "Učio sam za ispit ceo dan, prošao sam celo gradivo iz statistike.",
    lang: "sr",
    expect: { study: [8, 25] },
  },
  {
    name: "sr/running with distance",
    text: "Trčao sam 10 kilometara jutros. Bio je divan dan.",
    lang: "sr",
    expect: { body: [8, 25] },
    mood: [7, 10],
    metrics: ["distance_km"],
  },
  {
    name: "sr/family",
    text: "Bio sam kod mame na večeri, razgovarali smo dugo. Zvao me je i brat.",
    lang: "sr",
    expect: { bonds: [8, 25], body: [0, 8] },
  },
  {
    name: "sr/liturgy",
    text: "Jutros sam bio na liturgiji, posle sam se molio i čitao jevanđelje.",
    lang: "sr",
    expect: { spirit: [8, 25], study: [0, 25] },
  },
  {
    name: "sr/cyrillic body",
    text: "Трчао сам десет километара јутрос и вежбао у теретани.",
    lang: "sr",
    expect: { body: [8, 25] },
  },

  /* ── modifiers ───────────────────────────────────────────────── */
  {
    name: "sr/intensified beats diminished",
    text: "Učio sam veoma intenzivno ceo dan za ispit.",
    lang: "sr",
    expect: { study: [10, 25] },
  },
  {
    name: "sr/diminished stays low",
    text: "Malo sam vežbao, samo kratko.",
    lang: "sr",
    expect: { body: [1, 8] },
  },
  {
    name: "en/diminished stays low",
    text: "Studied a bit, just briefly before bed.",
    lang: "en",
    expect: { study: [1, 8], body: [0, 8] },
  },

  /* ── quantities ──────────────────────────────────────────────── */
  {
    name: "en/sleep is its own metric",
    text: "Slept nine hours and woke up genuinely rested for once.",
    lang: "en",
    expect: { body: [2, 25] },
    metrics: ["sleep_hours"],
  },
  {
    name: "en/glued units",
    text: "Ran 12km this morning then coded for 3h on the parser.",
    lang: "en",
    expect: { body: [6, 25], craft: [4, 25] },
    metrics: ["distance_km", "duration_h"],
  },
  {
    name: "sr/decimal comma",
    text: "Trčao sam 7,5 kilometara i posle vežbao trideset minuta.",
    lang: "sr",
    expect: { body: [6, 25] },
    metrics: ["distance_km"],
  },

  /* ── mood and the technical-vocabulary trap ──────────────────── */
  {
    name: "en/dev words are not sadness",
    text: "Spent the day chasing a crash in the payment code. Found the bug, killed it, tests green. Good day.",
    lang: "en",
    expect: { craft: [8, 25] },
    // AFINN rates crash/bug/kill/dead negative; this must not read as distress.
    mood: [5, 10],
  },
  {
    name: "en/genuinely bad day",
    text: "Awful day. Felt lonely and anxious the whole time, cried in the afternoon.",
    lang: "en",
    expect: {},
    mood: [1, 4],
  },
  {
    name: "sr/genuinely bad day",
    text: "Užasan dan. Bio sam tužan i usamljen, ništa nisam uradio.",
    lang: "sr",
    expect: {},
    mood: [1, 4],
  },
  {
    name: "en/no mood signal at all",
    text: "Moved the boxes from the hallway into the storage room and labelled them.",
    lang: "en",
    expect: {},
    mood: null,
  },

  /* ── energy ──────────────────────────────────────────────────── */
  {
    name: "en/exhausted",
    text: "Completely drained today, running on four hours of sleep, foggy and useless.",
    lang: "en",
    expect: { body: [0, 25] },
    energy: [1, 4],
    metrics: ["sleep_hours"],
  },
  {
    name: "sr/exhausted",
    text: "Iscrpljen sam, nenaspavan i mrtav. Spavao sam četiri sata.",
    lang: "sr",
    expect: { body: [0, 25] },
    energy: [1, 4],
  },

  /* ── the flat day, which must be recordable ──────────────────── */
  {
    name: "en/flat day scores almost nothing",
    text: "Not much happened. Sat around, scrolled, went to bed early.",
    lang: "en",
    expect: { play: [0, 8], body: [0, 8] },
  },

  /* ── people detection must not invent friends ────────────────── */
  {
    name: "en/sentence-initial verbs are not people",
    text: "Spent the morning writing. Slept badly. Watched a film. Cooked dinner.",
    lang: "en",
    // The point of this case is the candidate list; the awards are incidental.
    expect: { creation: [1, 25], body: [0, 25], play: [0, 25], bonds: [0, 25] },
    candidates: { none: ["Spent", "Slept", "Watched", "Cooked"] },
  },
  {
    name: "sr/sentence-initial verbs are not people",
    text: "Radio sam ceo dan. Trčao sam uveče. Spavao sam loše.",
    lang: "sr",
    expect: { craft: [5, 25], body: [1, 25] },
    candidates: { none: ["Radio", "Trčao", "Spavao"] },
  },
  {
    name: "en/weekdays and brands are not people",
    text: "On Monday I pushed the build to GitHub and watched something on Netflix.",
    lang: "en",
    expect: { craft: [1, 25], play: [0, 25] },
    candidates: { none: ["Monday", "GitHub", "Netflix"] },
  },
  {
    name: "sr/real name survives",
    text: "Popio sam kafu sa Milanom i posle smo šetali gradom.",
    lang: "sr",
    // Walking counts as Body and Play both; coffee out as Bonds and Play.
    expect: { bonds: [1, 25], body: [0, 25], play: [0, 25] },
    candidates: { some: ["Milanom"] },
  },

  /* ── mixed language in one entry ─────────────────────────────── */
  {
    name: "mixed/serbian and english together",
    text: "Radio sam na deployu ceo dan. Then I went for a run and read 20 pages.",
    lang: "sr",
    expect: { craft: [5, 25], body: [1, 25], study: [1, 25] },
  },
];
