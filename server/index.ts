/* ────────────────────────────────────────────────────────────────
   The API.

   Extraction runs here rather than in the browser, so the cue table,
   the people registry, the tag corpus and your settings all come
   straight from the database. The browser stays a view.

   There are no credentials anywhere in this file. Nothing leaves the
   machine — that is the point.
   ──────────────────────────────────────────────────────────────── */

import express, { type Request, type Response } from "express";
import { z } from "zod";
import {
  clearAlertsFor, deleteCue, deleteEntry, deletePerson, deleteQuest,
  dismissAlert, getCachedReview, getEntry, getSettings, insertAlert,
  insertEntry, insertQuest, learnFromCorrection, linkQuest, listAlerts,
  listCues, listEntries, listPeople, listQuests, openDb, putCachedReview,
  questLinkedEntries, questLinksFor, resetCue, searchEntries, setSettings,
  unlinkQuest, updateEntry, updateQuestStatus, upsertCue, upsertPerson,
  addPersonAlias, type DB,
} from "./db.ts";
import { buildCueTable, extract, type CueTable } from "../src/domain/extract/index.ts";
import { buildCorpus, EMPTY_CORPUS, type TagCorpus } from "../src/domain/extract/tags.ts";
import { detectLang } from "../src/domain/extract/detectLang.ts";
import { tokenize } from "../src/domain/extract/normalize.ts";
import { stemBoth } from "../src/domain/extract/stem.ts";
import { computeStats, currentStreak, dailyTotals, longestStreak } from "../src/domain/stats.ts";
import { isISODate, lastNDays, todayISO, weekStart } from "../src/domain/dates.ts";
import { TRACK_KEYS, emptyAwards, isTrackKey } from "../src/domain/tracks.ts";
import { buildWeeklyReview, reviewHash } from "../src/domain/review.ts";
import { lagCorrelations, pairedDayCount, sameDayCorrelations, sleepLagCorrelation } from "../src/domain/correlate.ts";
import { detectDecay, diffAlerts, staleAlerts } from "../src/domain/decay.ts";
import { linkEntry, questProgress } from "../src/domain/quests.ts";
import { computeAchievements, detectChapters } from "../src/domain/achievements.ts";
import {
  buildCsv, buildExport, buildMarkdown, diffImport, parseImport, planImport,
} from "../src/domain/importer.ts";
import type { Entry, Lang, TrackKey } from "../src/domain/types.ts";

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.DB_PATH ?? "./data/zapis.db";

const db: DB = openDb(DB_PATH);
const app = express();
app.use(express.json({ limit: "32mb" }));

/* ── caches ─────────────────────────────────────────────────────── */

/**
 * The cue table and tag corpus are rebuilt only when the data behind them
 * changes. Rebuilding the corpus per keystroke would make the live preview
 * quadratic in journal size.
 */
let cueTable: CueTable | null = null;
let corpus: TagCorpus | null = null;

function getCueTable(): CueTable {
  if (cueTable) return cueTable;
  cueTable = buildCueTable(
    listCues(db).map((c) => ({
      lang: c.lang, track: c.track, stem: c.stem, weight: c.weight,
    })),
  );
  return cueTable;
}

function getCorpus(): TagCorpus {
  if (corpus) return corpus;
  const entries = listEntries(db);
  corpus = entries.length === 0
    ? EMPTY_CORPUS
    : buildCorpus(
        entries.map((e) => ({ text: e.text, tags: e.tags })),
        (text) => tokenize(text),
        (text) => {
          const g = detectLang(text, getSettings(db).lang);
          return { lang: g.lang, perSentence: g.perSentence };
        },
      );
  return corpus;
}

function invalidate(opts: { cues?: boolean; corpus?: boolean } = {}): void {
  if (opts.cues !== false) cueTable = null;
  if (opts.corpus !== false) corpus = null;
}

/* ── helpers ────────────────────────────────────────────────────── */

function ok<T>(res: Response, body: T): void {
  res.json(body);
}

function fail(res: Response, status: number, message: string, detail?: unknown): void {
  res.status(status).json({ error: message, detail: detail ?? null });
}

/** Wrap a handler so a thrown error becomes a 500 instead of a hung request. */
function handler(fn: (req: Request, res: Response) => void | Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`${req.method} ${req.path} failed:`, err);
      if (!res.headersSent) {
        fail(res, 500, err instanceof Error ? err.message : "unexpected error");
      }
    }
  };
}

function knownPeople() {
  return listPeople(db).map((p) => ({
    canonical: p.canonical, display: p.display, aliases: p.aliases,
  }));
}

/** Days since each track last scored — the note generator wants this. */
function daysSinceMap(entries: readonly Entry[]) {
  const stats = computeStats(entries, todayISO(), getSettings(db).halfLife);
  const out: Partial<Record<TrackKey, number | null>> = {};
  for (const t of TRACK_KEYS) out[t] = stats[t].daysSince;
  return out;
}

function moodBaseline(entries: readonly Entry[]): number | null {
  const moods = entries.map((e) => e.mood).filter((m): m is number => m !== null);
  if (moods.length === 0) return null;
  return moods.reduce((a, b) => a + b, 0) / moods.length;
}

/* ── extraction ─────────────────────────────────────────────────── */

const extractBody = z.object({
  text: z.string(),
  date: z.string().optional(),
});

app.post("/api/extract", handler((req, res) => {
  const parsed = extractBody.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "text is required");

  const settings = getSettings(db);
  const entries = listEntries(db);

  const draft = extract(parsed.data.text, {
    cueTable: getCueTable(),
    corpus: getCorpus(),
    known: knownPeople(),
    daysSince: daysSinceMap(entries),
    moodBaseline: moodBaseline(entries),
    fallbackLang: settings.lang,
    xpScale: settings.xpScale,
  });

  // Which quests this entry would advance, shown before you file it.
  const quests = listQuests(db).filter((q) => q.status === "active");
  const links = linkEntry(parsed.data.text, draft.awards, quests, draft.lang).map((l) => ({
    ...l,
    title: quests.find((q) => q.id === l.questId)?.title ?? "",
  }));

  ok(res, { draft, questLinks: links });
}));

/* ── entries ────────────────────────────────────────────────────── */

const awardsBody = z.record(z.string(), z.number());

const entryBody = z.object({
  date: z.string().refine(isISODate, "date must be yyyy-mm-dd"),
  text: z.string().min(1),
  lang: z.enum(["en", "sr"]).optional(),
  awards: awardsBody,
  autoAwards: awardsBody.optional(),
  mood: z.number().nullable().optional(),
  energy: z.number().nullable().optional(),
  people: z.array(z.string()).default([]),
  events: z.array(z.string()).default([]),
  tags: z.array(z.object({ stem: z.string(), display: z.string() })).default([]),
  note: z.string().default(""),
  metrics: z
    .array(
      z.object({
        kind: z.string(), value: z.number(), unit: z.string(),
        track: z.string().nullable(),
      }),
    )
    .default([]),
  /** People you confirmed in the draft screen; added to the registry. */
  confirmPeople: z.array(z.string()).default([]),
});

function coerceAwards(raw: Record<string, number>) {
  const out = emptyAwards();
  for (const [k, v] of Object.entries(raw)) {
    if (!isTrackKey(k)) continue;
    out[k] = Math.max(0, Math.min(25, Math.round(v)));
  }
  return out;
}

app.get("/api/entries", handler((_req, res) => ok(res, listEntries(db))));

app.post("/api/entries", handler((req, res) => {
  const parsed = entryBody.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, "invalid entry", parsed.error.issues);
  }
  const b = parsed.data;

  for (const name of b.confirmPeople) upsertPerson(db, name, b.date);

  const awards = coerceAwards(b.awards);
  const autoAwards = b.autoAwards ? coerceAwards(b.autoAwards) : awards;
  const lang: Lang = b.lang ?? detectLang(b.text, getSettings(db).lang).lang;

  const entry = insertEntry(db, {
    date: b.date, text: b.text, lang, awards, autoAwards,
    mood: b.mood ?? null, energy: b.energy ?? null,
    people: b.people, events: b.events, tags: b.tags, note: b.note,
    metrics: b.metrics.map((m) => ({
      ...m, track: m.track && isTrackKey(m.track) ? m.track : null,
    })),
  });

  applyLearning(entry, b.text, lang, awards, autoAwards);
  autoLinkQuests(entry);
  invalidate();

  ok(res, { entry, alerts: refreshAlerts() });
}));

app.put("/api/entries/:id", handler((req, res) => {
  const id = Number(req.params.id);
  const parsed = entryBody.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "invalid entry", parsed.error.issues);
  const b = parsed.data;

  const awards = coerceAwards(b.awards);
  const autoAwards = b.autoAwards ? coerceAwards(b.autoAwards) : awards;
  const lang: Lang = b.lang ?? detectLang(b.text, getSettings(db).lang).lang;

  const entry = updateEntry(db, id, {
    date: b.date, text: b.text, lang, awards, autoAwards,
    mood: b.mood ?? null, energy: b.energy ?? null,
    people: b.people, events: b.events, tags: b.tags, note: b.note,
    metrics: b.metrics.map((m) => ({
      ...m, track: m.track && isTrackKey(m.track) ? m.track : null,
    })),
  });
  if (!entry) return fail(res, 404, "no such entry");

  invalidate();
  ok(res, { entry, alerts: refreshAlerts() });
}));

app.delete("/api/entries/:id", handler((req, res) => {
  const removed = deleteEntry(db, Number(req.params.id));
  if (!removed) return fail(res, 404, "no such entry");
  invalidate();
  ok(res, { deleted: true, alerts: refreshAlerts() });
}));

/**
 * Feed a correction back into the lexicon.
 *
 * Only the cues that actually fired for that track are adjusted, so nudging
 * Body doesn't quietly reweight your Craft vocabulary.
 */
function applyLearning(
  entry: Entry,
  text: string,
  lang: Lang,
  awards: ReturnType<typeof emptyAwards>,
  autoAwards: ReturnType<typeof emptyAwards>,
): void {
  const draft = extract(text, {
    cueTable: getCueTable(), fallbackLang: lang,
    xpScale: getSettings(db).xpScale,
  });

  for (const track of TRACK_KEYS) {
    const delta = awards[track] - autoAwards[track];
    if (delta === 0) continue;

    const stems = [
      ...new Set(
        draft.evidence
          .filter((e) => e.track === track && !e.negated)
          .map((e) => e.stem),
      ),
    ];
    // Nudged a track the engine saw nothing for: take the entry's content
    // words as the candidates, which is how a missing cue gets learned.
    const fallback = stems.length === 0 && delta > 0
      ? [...new Set(tokenize(text).tokens
          .filter((t) => t.surface.length >= 4 && !/\d/.test(t.folded))
          .map((t) => (lang === "sr" ? stemBoth(t.surface).sr : stemBoth(t.surface).en)))]
        .slice(0, 6)
      : stems;

    learnFromCorrection(db, {
      entryId: entry.id, lang, track, stems: fallback, delta,
    });
  }
  invalidate({ corpus: false });
}

function autoLinkQuests(entry: Entry): void {
  const quests = listQuests(db).filter((q) => q.status === "active");
  if (quests.length === 0) return;
  for (const link of linkEntry(entry.text, entry.awards, quests, entry.lang)) {
    linkQuest(db, { ...link, entryId: entry.id });
  }
}

/* ── stats ──────────────────────────────────────────────────────── */

app.get("/api/stats", handler((_req, res) => {
  const settings = getSettings(db);
  const entries = listEntries(db);
  const today = todayISO();

  ok(res, {
    stats: computeStats(entries, today, settings.halfLife),
    streak: currentStreak(entries, today, settings.restDays),
    longestStreak: longestStreak(entries),
    entryCount: entries.length,
    heat35: dailyTotals(entries, lastNDays(35, today)),
    heatYear: dailyTotals(entries, lastNDays(371, today)),
  });
}));

app.get("/api/study", handler((_req, res) => {
  const entries = listEntries(db);
  ok(res, {
    sameDay: sameDayCorrelations(entries, "mood"),
    lagMood: lagCorrelations(entries, "mood"),
    lagXp: lagCorrelations(entries, "totalXp"),
    sleep: sleepLagCorrelation(entries, "mood"),
    pairedDays: pairedDayCount(entries),
    people: listPeople(db),
    chapters: detectChapters(entries),
  });
}));

app.get("/api/achievements", handler((_req, res) => {
  const settings = getSettings(db);
  ok(res, computeAchievements(listEntries(db), todayISO(), settings.halfLife));
}));

/* ── weekly review ──────────────────────────────────────────────── */

app.get("/api/review", handler((req, res) => {
  const anchor = typeof req.query.week === "string" && isISODate(req.query.week)
    ? req.query.week
    : todayISO();
  const start = weekStart(anchor);

  const entries = listEntries(db);
  const hash = reviewHash(entries, start);

  const cached = getCachedReview(db, start, hash);
  if (cached) return ok(res, { ...(cached as object), cached: true });

  const review = buildWeeklyReview(entries, start, getSettings(db).halfLife);
  putCachedReview(db, start, hash, review);
  ok(res, { ...review, cached: false });
}));

/* ── quests ─────────────────────────────────────────────────────── */

const questBody = z.object({
  title: z.string().min(2),
  tracks: z.array(z.string()).default([]),
  targetDate: z.string().nullable().default(null),
  xpTarget: z.number().nullable().default(null),
});

app.get("/api/quests", handler((_req, res) => {
  const today = todayISO();
  ok(res, listQuests(db).map((q) => ({
    ...questProgress(q, questLinkedEntries(db, q.id), today),
    links: questLinkedEntries(db, q.id).map((e) => ({ id: e.id, date: e.date })),
  })));
}));

app.post("/api/quests", handler((req, res) => {
  const parsed = questBody.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "invalid quest", parsed.error.issues);
  const tracks = parsed.data.tracks.filter(isTrackKey);
  const quest = insertQuest(db, { ...parsed.data, tracks });

  // Backfill: an intention you declare today still explains last week.
  for (const entry of listEntries(db)) {
    for (const link of linkEntry(entry.text, entry.awards, [quest], entry.lang)) {
      linkQuest(db, { ...link, entryId: entry.id });
    }
  }
  ok(res, quest);
}));

app.post("/api/quests/:id/status", handler((req, res) => {
  const status = z.enum(["active", "done", "abandoned"]).safeParse(req.body?.status);
  if (!status.success) return fail(res, 400, "status must be active|done|abandoned");
  if (!updateQuestStatus(db, Number(req.params.id), status.data)) {
    return fail(res, 404, "no such quest");
  }
  ok(res, { updated: true });
}));

app.delete("/api/quests/:id", handler((req, res) => {
  if (!deleteQuest(db, Number(req.params.id))) return fail(res, 404, "no such quest");
  ok(res, { deleted: true });
}));

app.delete("/api/quests/:id/links/:entryId", handler((req, res) => {
  unlinkQuest(db, Number(req.params.id), Number(req.params.entryId));
  ok(res, { unlinked: true });
}));

app.get("/api/entries/:id/quests", handler((req, res) =>
  ok(res, questLinksFor(db, Number(req.params.id))),
));

/* ── alerts ─────────────────────────────────────────────────────── */

/**
 * Recompute decay state and record anything new.
 *
 * Recovered tracks have their alerts cleared, which is what allows a second
 * fall months later to report again instead of being suppressed forever.
 */
function refreshAlerts() {
  const settings = getSettings(db);
  const entries = listEntries(db);
  const existing = listAlerts(db, true);

  for (const stale of staleAlerts(entries, existing, todayISO(), settings.halfLife)) {
    clearAlertsFor(db, stale.track, stale.kind);
  }

  const remaining = listAlerts(db, true);
  const candidates = detectDecay(entries, todayISO(), settings.halfLife);
  for (const fresh of diffAlerts(candidates, remaining)) {
    insertAlert(db, {
      track: fresh.track, kind: fresh.kind,
      peak: fresh.peak, current: fresh.current,
    });
  }
  return listAlerts(db, false);
}

app.get("/api/alerts", handler((_req, res) => ok(res, refreshAlerts())));

app.post("/api/alerts/:id/dismiss", handler((req, res) => {
  if (!dismissAlert(db, Number(req.params.id))) return fail(res, 404, "no such alert");
  ok(res, { dismissed: true });
}));

/* ── lexicon ────────────────────────────────────────────────────── */

app.get("/api/cues", handler((_req, res) => ok(res, listCues(db))));

const cueBody = z.object({
  lang: z.enum(["en", "sr"]),
  track: z.string().refine(isTrackKey, "unknown track"),
  /** Accepts a plain word; it is stemmed before storage. */
  word: z.string().min(2),
  weight: z.number().min(0).max(6),
});

app.post("/api/cues", handler((req, res) => {
  const parsed = cueBody.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "invalid cue", parsed.error.issues);
  const { lang, track, word, weight } = parsed.data;
  const stems = stemBoth(word);
  upsertCue(db, {
    lang, track: track as TrackKey,
    stem: lang === "sr" ? stems.sr : stems.en,
    weight, source: "user",
  });
  invalidate({ corpus: false });
  ok(res, { saved: true });
}));

app.post("/api/cues/:id/reset", handler((req, res) => {
  if (!resetCue(db, Number(req.params.id))) return fail(res, 404, "no such cue");
  invalidate({ corpus: false });
  ok(res, { reset: true });
}));

app.delete("/api/cues/:id", handler((req, res) => {
  if (!deleteCue(db, Number(req.params.id))) return fail(res, 404, "no such cue");
  invalidate({ corpus: false });
  ok(res, { deleted: true });
}));

/* ── people ─────────────────────────────────────────────────────── */

app.get("/api/people", handler((_req, res) => {
  const entries = listEntries(db);
  const overall = moodBaseline(entries);

  ok(res, listPeople(db).map((p) => {
    const withThem = entries.filter((e) => e.people.includes(p.display));
    const moods = withThem.map((e) => e.mood).filter((m): m is number => m !== null);
    const mean = moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null;
    return {
      ...p,
      moodWithThem: mean === null ? null : Number(mean.toFixed(2)),
      moodBaseline: overall === null ? null : Number(overall.toFixed(2)),
      daysSinceSeen: p.lastSeen ? Math.max(0,
        Math.round((Date.parse(`${todayISO()}T12:00:00Z`) -
                    Date.parse(`${p.lastSeen}T12:00:00Z`)) / 86_400_000)) : null,
    };
  }));
}));

app.post("/api/people", handler((req, res) => {
  const body = z.object({
    display: z.string().min(1),
    seenOn: z.string().refine(isISODate).optional(),
    alias: z.string().optional(),
  }).safeParse(req.body);
  if (!body.success) return fail(res, 400, "display is required");

  const id = upsertPerson(db, body.data.display, body.data.seenOn ?? todayISO());
  if (body.data.alias) addPersonAlias(db, id, body.data.alias);
  ok(res, { id });
}));

app.delete("/api/people/:id", handler((req, res) => {
  if (!deletePerson(db, Number(req.params.id))) return fail(res, 404, "no such person");
  ok(res, { deleted: true });
}));

/* ── search & on this day ───────────────────────────────────────── */

app.get("/api/search", handler((req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (q.trim().length === 0) return ok(res, []);
  ok(res, searchEntries(db, q));
}));

app.get("/api/onthisday", handler((_req, res) => {
  const entries = listEntries(db);
  const today = todayISO();
  const pick = (days: number) => {
    const target = new Date(Date.parse(`${today}T12:00:00Z`) - days * 86_400_000)
      .toISOString().slice(0, 10);
    return entries.find((e) => e.date === target) ?? null;
  };
  ok(res, { monthAgo: pick(30), yearAgo: pick(365) });
}));

/* ── settings ───────────────────────────────────────────────────── */

app.get("/api/settings", handler((_req, res) => ok(res, getSettings(db))));

app.put("/api/settings", handler((req, res) => {
  const body = z.object({
    lang: z.enum(["en", "sr"]).optional(),
    halfLife: z.number().min(1).max(120).optional(),
    xpScale: z.number().min(1).max(40).optional(),
    notify: z.boolean().optional(),
    restDays: z.boolean().optional(),
  }).safeParse(req.body);
  if (!body.success) return fail(res, 400, "invalid settings", body.error.issues);
  ok(res, setSettings(db, body.data));
}));

/* ── import & export ────────────────────────────────────────────── */

app.get("/api/export", handler((req, res) => {
  const format = typeof req.query.format === "string" ? req.query.format : "json";
  const entries = listEntries(db);

  if (format === "csv") {
    res.type("text/csv").send(buildCsv(entries));
    return;
  }
  if (format === "md") {
    res.type("text/markdown").send(buildMarkdown(entries));
    return;
  }
  ok(res, buildExport(entries));
}));

/** Dry run: report what an import would do, and write nothing. */
app.post("/api/import/preview", handler((req, res) => {
  const raw = z.object({ raw: z.string() }).safeParse(req.body);
  if (!raw.success) return fail(res, 400, "raw file contents are required");

  let parsed;
  try {
    parsed = parseImport(raw.data.raw);
  } catch (err) {
    return fail(res, 400, err instanceof Error ? err.message : "unreadable file");
  }

  const diff = diffImport(parsed.entries, listEntries(db), parsed.failures);
  ok(res, {
    counts: diff.counts,
    failures: diff.failures,
    rows: diff.rows.slice(0, 500).map((r) => ({
      date: r.incoming.date,
      resolution: r.resolution,
      changed: r.changed,
      words: r.incoming.text.split(/\s+/).filter(Boolean).length,
    })),
  });
}));

app.post("/api/import/commit", handler((req, res) => {
  const body = z.object({
    raw: z.string(),
    strategy: z.enum(["skip", "replace", "keepBoth"]).default("skip"),
  }).safeParse(req.body);
  if (!body.success) return fail(res, 400, "raw and strategy are required");

  let parsed;
  try {
    parsed = parseImport(body.data.raw);
  } catch (err) {
    return fail(res, 400, err instanceof Error ? err.message : "unreadable file");
  }

  const existing = listEntries(db);
  const diff = diffImport(parsed.entries, existing, parsed.failures);
  const plan = planImport(diff, body.data.strategy);

  const byDate = new Map(existing.map((e) => [e.date, e]));
  let inserted = 0;
  let replaced = 0;

  // One transaction for the whole import: a partial import is not a state
  // anyone should have to reason about.
  db.transaction(() => {
    for (const e of plan.insert) {
      insertEntry(db, {
        ...e,
        tags: e.tags.map((t) => ({ stem: t, display: t })),
      });
      inserted += 1;
    }
    for (const { date, entry } of plan.replace) {
      const target = byDate.get(date);
      if (!target) continue;
      updateEntry(db, target.id, {
        ...entry,
        tags: entry.tags.map((t) => ({ stem: t, display: t })),
      });
      replaced += 1;
    }
  })();

  invalidate();
  ok(res, {
    inserted, replaced, skipped: plan.skipped,
    failures: diff.failures, alerts: refreshAlerts(),
  });
}));

/* ── boot ───────────────────────────────────────────────────────── */

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, entries: listEntries(db).length, db: DB_PATH });
});

app.listen(PORT, () => {
  console.log(`zapis api → http://localhost:${PORT}  (db: ${DB_PATH})`);
});
