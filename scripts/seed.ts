/* ────────────────────────────────────────────────────────────────
   Seed a realistic history, for exercising the screens that only
   come alive with months of data — the weekly review's absence
   detectors, the lag correlations, the decay alerts, chapters.

   Usage:  DB_PATH=./data/dev.db npx tsx scripts/seed.ts [days]

   The narrative is deliberately shaped so the analytics have
   something true to find: Spirit runs hot for six weeks then stops
   dead (decay alert), Ana disappears from the record halfway
   through (personDropped), and a good night's sleep genuinely
   predicts the next day (lag correlation).

   Spirit is the track chosen to die because nothing else in a normal
   day incidentally mentions it. Body would never have gone dormant:
   the sleep line appears every day, and sleep is Body upkeep.
   ──────────────────────────────────────────────────────────────── */

import { openDb, insertEntry } from "../server/db.ts";
import { extract, buildCueTable } from "../src/domain/extract/index.ts";
import { shiftISO, todayISO } from "../src/domain/dates.ts";
import { listCues } from "../server/db.ts";

const DAYS = Number(process.argv[2] ?? 100);
const DB_PATH = process.env.DB_PATH ?? "./data/dev.db";

const db = openDb(DB_PATH);
const table = buildCueTable(
  listCues(db).map((c) => ({ lang: c.lang, track: c.track, stem: c.stem, weight: c.weight })),
);

/** Deterministic PRNG, so a seeded database is reproducible. */
let state = 20260812;
function rnd(): number {
  state = (state * 1103515245 + 12345) & 0x7fffffff;
  return state / 0x7fffffff;
}
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

const WORK = [
  "Radio sam na naplati skoro ceo dan i konačno rešio grešku sa duplim računima.",
  "Šest sati na serveru, deployovao sam popravku u produkciju.",
  "Spent the day refactoring the payment service. Shipped it before six.",
  "Dug through the queue code for four hours and found the race condition.",
  "Sastanak sa klijentom ujutru, posle sam pisao dokumentaciju.",
];
const STUDY = [
  "Učio sam za ispit tri sata, prošao celo gradivo iz statistike.",
  "Read 50 pages of the algorithms textbook and did the exercises.",
  "Vežbao sam nemački na Duolingu i pisao beleške iz gramatike.",
  "Two hours of lecture notes, then flashcards until it stuck.",
];
const BODY = [
  "Trčao sam 8 kilometara jutros, osećao sam se odlično.",
  "Ran 10km before work. Legs heavy but good.",
  "Teretana, sklekovi i čučnjevi. Posle sam kuvao večeru.",
  "Long walk after dinner, about 5km.",
];
const BONDS_ANA = [
  "Zvala me je Ana uveče, razgovarali smo sat vremena.",
  "Dinner with Ana and her brother. We laughed a lot.",
  "Kafa sa Anom u gradu, dugo smo sedeli.",
];
const BONDS_OTHER = [
  "Video sam Milana, pili smo kafu i šetali.",
  "Long call with Marko about the old flat.",
  "Bio sam kod mame na večeri, cela porodica.",
];
const CREATION = [
  "Napisao sam kratku priču uveče i skicirao naslovnu.",
  "Wrote 900 words of the essay and edited the photographs.",
  "Svirao sam gitaru i komponovao nešto novo.",
];
const SPIRIT = [
  "Jutros sam bio na liturgiji, posle sam se molio u tišini.",
  "Sat in silence for twenty minutes. Read the gospel.",
  "Postio sam danas i čitao psalme uveče.",
];
const PLAY = [
  "Gledao sam dva filma i igrao šah sa bratom.",
  "Played chess and listened to the new album. Deliberate rest.",
  "Netflix i pivo, ništa korisno i to je bilo u redu.",
];
const FLAT = [
  "Ništa posebno. Umoran sam bio ceo dan.",
  "Not much happened. Tired and scattered.",
  "Prazan dan, jedva sam nešto uradio.",
];

const start = shiftISO(todayISO(), -(DAYS - 1));
let written = 0;

/** Carries yesterday's short night into today, so the effect is genuinely lagged. */
let badMorning = false;

for (let i = 0; i < DAYS; i++) {
  const date = shiftISO(start, i);
  const week = Math.floor(i / 7);

  // A day off roughly once a week: the streak logic needs real gaps.
  if (rnd() < 0.12) continue;

  const parts: string[] = [];

  // Craft on weekdays.
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const weekday = dow >= 1 && dow <= 5;
  if (weekday && rnd() < 0.8) parts.push(pick(WORK));
  if (rnd() < 0.45) parts.push(pick(STUDY));

  if (rnd() < 0.5) parts.push(pick(BODY));

  // Spirit burns for the first six weeks and then stops dead — this is the
  // fall the decay alert exists to catch.
  if (week < 6 && rnd() < 0.75) parts.push(pick(SPIRIT));

  // Ana is present for the first half of the history and then absent.
  if (rnd() < 0.35) {
    parts.push(i < DAYS * 0.5 ? pick(BONDS_ANA) : pick(BONDS_OTHER));
  }

  if (rnd() < 0.25) parts.push(pick(CREATION));
  if (!weekday || rnd() < 0.3) parts.push(pick(PLAY));

  /*
   * Sleep, with a genuine *lagged* effect.
   *
   * The flat day has to land on the day AFTER the short night, not the same
   * one — a same-day pairing would only ever show up in the same-day
   * correlations and would leave the lag screen with nothing to find.
   */
  if (badMorning && rnd() < 0.85) parts.push(pick(FLAT));

  const sleptWell = rnd() < 0.6;
  parts.push(sleptWell ? "Spavao sam osam sati." : "Spavao sam pet sati.");
  badMorning = !sleptWell;

  if (parts.length === 0) parts.push(pick(FLAT));

  const text = parts.join(" ");
  const draft = extract(text, { cueTable: table, fallbackLang: "sr" });

  insertEntry(db, {
    date,
    text,
    lang: draft.lang,
    awards: draft.awards,
    autoAwards: draft.awards,
    mood: draft.mood,
    energy: draft.energy,
    people: draft.people.length > 0 ? draft.people : draft.personCandidates.slice(0, 2),
    events: draft.events,
    tags: draft.tags.map((t) => ({ stem: t.stem, display: t.display })),
    note: draft.note,
    metrics: draft.metrics,
    createdAt: new Date(`${date}T21:00:00Z`).toISOString(),
  });
  written += 1;
}

console.log(`seeded ${written} entries over ${DAYS} days → ${DB_PATH}`);
