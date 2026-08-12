import type { TrackKey } from "../domain/types.ts";
import type { FindingKind } from "../domain/review.ts";
import type { MomentumLabel } from "../domain/xp.ts";

/** Values a finding carries. Phrases receive it and read what they need. */
export type FindingData = Record<string, string | number | null>;

/**
 * The shape both dictionaries implement.
 *
 * Phrases that need values are functions rather than templates with
 * placeholders, because Serbian agreement depends on the numbers — "1 trak
 * nije zabeležen" against "3 traka nisu zabeležena" — and no amount of
 * `{count}` substitution gets that right.
 */
export interface Strings {
  code: string;
  brand: string;
  tracks: Record<TrackKey, { name: string; hint: string }>;
  momentum: Record<MomentumLabel, string>;
  tabs: Record<string, string>;
  ui: Record<string, string>;
  finding: Record<FindingKind, (d: FindingData) => string>;
  achievement: Record<string, string>;
}

export const en: Strings = {
  code: "en-GB",
  brand: "ZAPIS",

  tracks: {
    craft: { name: "Craft", hint: "paid & technical work — code, systems, problems solved" },
    study: { name: "Study", hint: "deliberate learning — coursework, languages, reading" },
    body: { name: "Body", hint: "sleep, movement, food, health admin, physical upkeep" },
    bonds: { name: "Bonds", hint: "real contact — time with people that landed" },
    creation: { name: "Creation", hint: "making things that didn't exist" },
    spirit: { name: "Spirit", hint: "prayer, reflection, silence, whatever steadies you" },
    play: { name: "Play", hint: "rest taken on purpose — a resource, not a penalty" },
  },

  momentum: {
    burning: "burning",
    warm: "warm",
    steady: "steady",
    cooling: "cooling",
    dormant: "dormant",
  },

  tabs: {
    record: "Record",
    sheet: "Sheet",
    ledger: "Ledger",
    study: "Study",
    review: "Review",
    quests: "Quests",
    people: "People",
    lexicon: "Lexicon",
    data: "Data",
    board: "Board",
  },

  ui: {
    momentumHeading: "Momentum",
    signIn: "Sign in",
    signOut: "Sign out",
    register: "Create an account",
    handle: "Handle",
    password: "Password",
    displayName: "Display name",
    inviteCode: "Invite code",
    haveAccount: "Already have an account?",
    needAccount: "Need an account?",
    signedInAs: "Signed in as",
    boardBlurb: "Only these numbers are shared. Nothing you write ever leaves your account.",
    boardEmpty: "Nobody is sharing scores yet.",
    shareScores: "Appear on the shared board",
    shareScoresHint: "Shares your momentum, level and streak with other accounts on this server. Your entries are never shared.",
    notSharing: "You are hidden from the board.",
    rank: "Rank",
    player: "Name",
    overall: "Overall",
    youLabel: "you",
    level: "Level",
    lifetimeXp: "Lifetime XP",
    entries: "entries",
    dayStreak: "day streak",
    entryDate: "Entry date",
    words: "words",
    reading: "Reading…",
    seal: "Read the entry",
    fileIt: "File it",
    backToText: "Back to the text",
    awarded: "Awarded",
    mood: "Mood",
    energy: "Energy",
    people: "People",
    nothingScored: "Nothing scored. That is itself a record.",
    writePlaceholder:
      "What happened today? Write it the way you'd tell a friend — messy is fine. Nothing leaves this machine.",
    tooShort: "Give it a sentence or two at minimum.",
    noEntries: "No entries yet. The sheet fills itself once you record a day.",
    ledgerBlank: "The ledger is blank.",
    toLevel: "to LV",
    cold: "cold",
    lifetime: "lifetime",
    momentumShape: "Momentum shape",
    last35: "Last 35 days",
    lastYear: "Last year",
    sameDayMood: "Mood on days with each track",
    sameDayCaption:
      "Difference against days without it, measured on the same day. Association, not cause — a good mood may be what makes the day possible, not the reverse.",
    lagMood: "Next-day mood after each track",
    lagCaption:
      "Does a track today predict tomorrow? Only consecutive written days count; gaps are excluded rather than guessed.",
    needMoreDays: "needs more paired days",
    noise: "indistinguishable from noise",
    pairedDays: "paired days so far",
    sleepLag: "Sleep tonight vs mood tomorrow",
    peopleByDays: "People, by days appeared",
    exportCsv: "Export CSV",
    exportJson: "Export JSON",
    exportMd: "Export Markdown",
    importTitle: "Import",
    importPick: "Choose a backup file",
    importPreview: "Preview",
    importCommit: "Import",
    importNew: "new",
    importIdentical: "identical",
    importConflict: "conflict",
    importStrategy: "On conflict",
    strategySkip: "keep what's here",
    strategyReplace: "replace with the file",
    strategyKeepBoth: "keep both",
    importDone: "Imported",
    weeklyReview: "The week",
    reviewEmpty: "Nothing filed this week.",
    noReviewYet: "Write a few days and the review starts noticing what you didn't.",
    quests: "Quests",
    newQuest: "Declare an intention",
    questTitle: "What are you trying to finish?",
    questTracks: "Tracks (optional)",
    questTarget: "Target date (optional)",
    declare: "Declare",
    advances: "advances",
    linkedEntries: "linked entries",
    daysLeft: "days left",
    overdue: "overdue",
    done: "Done",
    abandon: "Abandon",
    reopen: "Reopen",
    noQuests: "No quests. Declare an intention and entries will link themselves.",
    decayAlert: "has fallen from",
    decayTo: "to",
    dismiss: "Dismiss",
    lexicon: "Lexicon",
    lexiconCaption:
      "Every word the engine scores, and what it's worth. Correcting an entry nudges these automatically; you can also edit them directly.",
    addWord: "Add a word",
    word: "word",
    weight: "weight",
    track: "track",
    language: "language",
    reset: "Reset",
    remove: "Remove",
    source: "source",
    sourceSeed: "seed",
    sourceUser: "yours",
    sourceLearned: "learned",
    search: "Search",
    searchPlaceholder: "Search everything you've written…",
    noResults: "Nothing found.",
    onThisDay: "On this day",
    monthAgo: "a month ago",
    yearAgo: "a year ago",
    achievements: "Achievements",
    earned: "earned",
    chapters: "Chapters",
    settings: "Settings",
    halfLife: "Decay half-life (days)",
    xpScale: "XP scale",
    restDays: "Forgive one missed day per week",
    notify: "Desktop notifications",
    notifyCaveat: "Only fires while this page is open.",
    langLabel: "Interface language",
    whyThisNumber: "why?",
    negated: "negated",
    evidence: "Evidence",
    confirmPerson: "Is this a person?",
    yes: "Yes",
    no: "No",
    listen: "Dictate",
    listening: "Listening…",
    stop: "Stop",
    voiceUnsupported: "This browser has no speech recognition.",
    prompt: "Need a prompt?",
    saving: "Saving…",
    saved: "Saved",
    delete: "Delete",
    metrics: "Measured",
  },

  finding: {
    absence: (d) =>
      `${d.track} recorded nothing this week, after ${d.activeWeeks} of the last three.`,
    trackReturned: (d) =>
      `${d.track} came back after ${d.silentWeeks} silent weeks — ${d.xp} XP.`,
    personDropped: (d) =>
      `${d.person} appeared in ${d.weeks} of the last four weeks, and not in this one.`,
    personNew: (d) => `${d.person} appears for the first time.`,
    momentumSwing: (d) =>
      `${d.track} momentum moved ${d.delta} (${d.from} → ${d.to}).`,
    varianceShift: (d) =>
      d.direction === "up"
        ? `Mood swung wider than usual (σ ${d.sigma} against ${d.priorSigma}).`
        : `Mood was steadier than usual (σ ${d.sigma} against ${d.priorSigma}).`,
    tagNew: (d) => `New this week: ${d.tags}.`,
    tagGone: (d) => `Absent this week: ${d.tags}.`,
    cadence: (d) =>
      `${d.entries} entries, ${d.avgWords} words on average, longest gap ${d.longestGap} days.`,
    moodExtreme: (d) =>
      `Best day ${d.bestDate} (${d.bestMood}), worst ${d.worstDate} (${d.worstMood}).`,
    quietWeek: () => "Nothing was filed this week.",
  },

  achievement: {
    entries_1: "First entry filed",
    entries_10: "Ten days recorded",
    entries_50: "Fifty days recorded",
    entries_100: "A hundred days recorded",
    entries_365: "Three hundred and sixty-five days recorded",
    entries_1000: "A thousand days recorded",
    all_seven: "All seven tracks in a single day",
    streak_7: "Seven days unbroken",
    streak_30: "Thirty days unbroken",
    streak_100: "A hundred days unbroken",
    honest_zero: "Filed a day with nothing to report",
    people_5: "Five people in the ledger",
    people_25: "Twenty-five people in the ledger",
    one_year: "A year of history",
    kindled_craft: "Craft carried from dormant to burning",
    kindled_study: "Study carried from dormant to burning",
    kindled_body: "Body carried from dormant to burning",
    kindled_bonds: "Bonds carried from dormant to burning",
    kindled_creation: "Creation carried from dormant to burning",
    kindled_spirit: "Spirit carried from dormant to burning",
    kindled_play: "Play carried from dormant to burning",
    week_of_craft: "Seven straight days of Craft",
    week_of_study: "Seven straight days of Study",
    week_of_body: "Seven straight days of Body",
    week_of_bonds: "Seven straight days of Bonds",
    week_of_creation: "Seven straight days of Creation",
    week_of_spirit: "Seven straight days of Spirit",
    week_of_play: "Seven straight days of Play",
  },
};
