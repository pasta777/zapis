/* ────────────────────────────────────────────────────────────────
   The API.

   Extraction runs here rather than in the browser, so the cue table,
   the people registry, the tag corpus and your settings all come
   straight from the database. The browser stays a view.

   Every route below /api — except the auth handshake and the health
   check — runs behind requireAuth, and every database call carries an
   explicit user id. There is no ambient current user in this process.

   Still no third-party credentials anywhere in this file. What leaves
   a journal is a row of integers in `scores`, and nothing else.
   ──────────────────────────────────────────────────────────────── */

import express, { type Request, type Response } from "express";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  OVERALL, clearAlertsFor, createSession, createUser, deleteCue, deleteEntry,
  deletePerson, deleteQuest, deleteSession, dismissAlert, findUserByHandle,
  getCachedReview, getEntry, getSettings, insertAlert, insertEntry, insertQuest,
  learnFromCorrection, linkQuest, listAlerts, listCues, listEntries, listPeople,
  listQuests, openDb, purgeExpiredSessions, putCachedReview, questLinkedEntries,
  questLinksFor, readBoard, readOwnScore, resetCue, searchEntries, setSettings, setShareScores,
  unlinkQuest, updateEntry, updateQuestStatus, upsertCue, upsertPerson,
  addPersonAlias, type DB,
} from "./db.ts";
import {
  clearSessionCookie, handleProblem, hashPassword, inviteProblem,
  newSessionToken, passwordProblem, requireAuth, sessionTokenOf,
  setSessionCookie, SESSION_TTL_DAYS, verifyPassword,
} from "./auth.ts";
import { refreshAllScores, refreshScores, refreshStaleScores } from "./scores.ts";
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
const IS_PROD = process.env.NODE_ENV === "production";

const db: DB = openDb(DB_PATH);
const app = express();
app.use(express.json({ limit: "32mb" }));

// Behind Fly's proxy the client address arrives in X-Forwarded-For, and
// `secure` cookies need the protocol from X-Forwarded-Proto.
if (IS_PROD) app.set("trust proxy", 1);

/* ── caches ─────────────────────────────────────────────────────── */

/**
 * The cue table and tag corpus are rebuilt only when the data behind them
 * changes. Rebuilding the corpus per keystroke would make the live preview
 * quadratic in journal size.
 *
 * Both are keyed by user. The corpus is built from entry *text*, so a single
 * shared instance would have handed one person's vocabulary to the next
 * request — the cache is the one place where multi-user turns a harmless
 * singleton into a disclosure.
 */
const cueTables = new Map<number, CueTable>();
const corpora = new Map<number, TagCorpus>();

function getCueTable(userId: number): CueTable {
  const hit = cueTables.get(userId);
  if (hit) return hit;

  const built = buildCueTable(
    listCues(db, userId).map((c) => ({
      lang: c.lang, track: c.track, stem: c.stem, weight: c.weight,
    })),
  );
  cueTables.set(userId, built);
  return built;
}

function getCorpus(userId: number): TagCorpus {
  const hit = corpora.get(userId);
  if (hit) return hit;

  const entries = listEntries(db, userId);
  const built = entries.length === 0
    ? EMPTY_CORPUS
    : buildCorpus(
        entries.map((e) => ({ text: e.text, tags: e.tags })),
        (text) => tokenize(text),
        (text) => {
          const g = detectLang(text, getSettings(db, userId).lang);
          return { lang: g.lang, perSentence: g.perSentence };
        },
      );
  corpora.set(userId, built);
  return built;
}

function invalidate(userId: number, opts: { cues?: boolean; corpus?: boolean } = {}): void {
  if (opts.cues !== false) cueTables.delete(userId);
  if (opts.corpus !== false) corpora.delete(userId);
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

/** The authenticated user's id. Only valid behind requireAuth. */
function uid(req: Request): number {
  return req.user!.id;
}

function knownPeople(userId: number) {
  return listPeople(db, userId).map((p) => ({
    canonical: p.canonical, display: p.display, aliases: p.aliases,
  }));
}

/** Days since each track last scored — the note generator wants this. */
function daysSinceMap(userId: number, entries: readonly Entry[]) {
  const stats = computeStats(entries, todayISO(), getSettings(db, userId).halfLife);
  const out: Partial<Record<TrackKey, number | null>> = {};
  for (const t of TRACK_KEYS) out[t] = stats[t].daysSince;
  return out;
}

function moodBaseline(entries: readonly Entry[]): number | null {
  const moods = entries.map((e) => e.mood).filter((m): m is number => m !== null);
  if (moods.length === 0) return null;
  return moods.reduce((a, b) => a + b, 0) / moods.length;
}

/* ── auth (the only unauthenticated routes) ─────────────────────── */

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, db: DB_PATH });
});

const credentials = z.object({
  handle: z.string(),
  password: z.string(),
});

app.post("/api/auth/register", handler(async (req, res) => {
  const parsed = credentials
    .extend({ display: z.string().min(1).max(40), invite: z.string().optional() })
    .safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "handle, display and password are required");

  const { handle, display, password, invite } = parsed.data;

  const gate = inviteProblem(invite);
  if (gate) return fail(res, 403, gate);

  const bad = handleProblem(handle) ?? passwordProblem(password);
  if (bad) return fail(res, 400, bad);

  if (findUserByHandle(db, handle)) return fail(res, 409, "that handle is taken");

  const user = createUser(db, {
    handle, display, passwordHash: await hashPassword(password),
  });

  // A brand-new account still gets a scores row, so it appears on the board
  // at zero rather than being invisible until its first entry.
  refreshScores(db, user.id);

  const token = newSessionToken();
  createSession(db, user.id, token, SESSION_TTL_DAYS);
  setSessionCookie(res, token);
  ok(res, { user });
}));

app.post("/api/auth/login", handler(async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "handle and password are required");

  const found = findUserByHandle(db, parsed.data.handle);
  // The same message and the same work either way: a login form that answers
  // faster for unknown handles is a handle oracle.
  const valid = found
    ? await verifyPassword(parsed.data.password, found.passwordHash)
    : await verifyPassword(parsed.data.password, "");

  if (!found || !valid) return fail(res, 401, "wrong handle or password");

  const token = newSessionToken();
  createSession(db, found.id, token, SESSION_TTL_DAYS);
  setSessionCookie(res, token);
  purgeExpiredSessions(db);

  const { passwordHash: _omit, ...user } = found;
  ok(res, { user });
}));

app.post("/api/auth/logout", handler((req, res) => {
  const token = sessionTokenOf(req);
  if (token) deleteSession(db, token);
  clearSessionCookie(res);
  ok(res, { ok: true });
}));

/* ── everything past this line requires a session ───────────────── */

app.use("/api", requireAuth(db));

app.get("/api/auth/me", handler((req, res) => ok(res, { user: req.user })));

/* ── extraction ─────────────────────────────────────────────────── */

const extractBody = z.object({
  text: z.string(),
  date: z.string().optional(),
});

app.post("/api/extract", handler((req, res) => {
  const parsed = extractBody.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "text is required");

  const userId = uid(req);
  const settings = getSettings(db, userId);
  const entries = listEntries(db, userId);

  const draft = extract(parsed.data.text, {
    cueTable: getCueTable(userId),
    corpus: getCorpus(userId),
    known: knownPeople(userId),
    daysSince: daysSinceMap(userId, entries),
    moodBaseline: moodBaseline(entries),
    fallbackLang: settings.lang,
    xpScale: settings.xpScale,
  });

  // Which quests this entry would advance, shown before you file it.
  const quests = listQuests(db, userId).filter((q) => q.status === "active");
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

app.get("/api/entries", handler((req, res) => ok(res, listEntries(db, uid(req)))));

app.post("/api/entries", handler((req, res) => {
  const parsed = entryBody.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, "invalid entry", parsed.error.issues);
  }
  const b = parsed.data;
  const userId = uid(req);

  for (const name of b.confirmPeople) upsertPerson(db, userId, name, b.date);

  const awards = coerceAwards(b.awards);
  const autoAwards = b.autoAwards ? coerceAwards(b.autoAwards) : awards;
  const lang: Lang = b.lang ?? detectLang(b.text, getSettings(db, userId).lang).lang;

  const entry = insertEntry(db, userId, {
    date: b.date, text: b.text, lang, awards, autoAwards,
    mood: b.mood ?? null, energy: b.energy ?? null,
    people: b.people, events: b.events, tags: b.tags, note: b.note,
    metrics: b.metrics.map((m) => ({
      ...m, track: m.track && isTrackKey(m.track) ? m.track : null,
    })),
  });

  applyLearning(userId, entry, b.text, lang, awards, autoAwards);
  autoLinkQuests(userId, entry);
  invalidate(userId);
  refreshScores(db, userId);

  ok(res, { entry, alerts: refreshAlerts(userId) });
}));

app.put("/api/entries/:id", handler((req, res) => {
  const id = Number(req.params.id);
  const parsed = entryBody.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "invalid entry", parsed.error.issues);
  const b = parsed.data;
  const userId = uid(req);

  const awards = coerceAwards(b.awards);
  const autoAwards = b.autoAwards ? coerceAwards(b.autoAwards) : awards;
  const lang: Lang = b.lang ?? detectLang(b.text, getSettings(db, userId).lang).lang;

  const entry = updateEntry(db, userId, id, {
    date: b.date, text: b.text, lang, awards, autoAwards,
    mood: b.mood ?? null, energy: b.energy ?? null,
    people: b.people, events: b.events, tags: b.tags, note: b.note,
    metrics: b.metrics.map((m) => ({
      ...m, track: m.track && isTrackKey(m.track) ? m.track : null,
    })),
  });
  if (!entry) return fail(res, 404, "no such entry");

  invalidate(userId);
  refreshScores(db, userId);
  ok(res, { entry, alerts: refreshAlerts(userId) });
}));

app.delete("/api/entries/:id", handler((req, res) => {
  const userId = uid(req);
  const removed = deleteEntry(db, userId, Number(req.params.id));
  if (!removed) return fail(res, 404, "no such entry");
  invalidate(userId);
  refreshScores(db, userId);
  ok(res, { deleted: true, alerts: refreshAlerts(userId) });
}));

/**
 * Feed a correction back into the lexicon.
 *
 * Only the cues that actually fired for that track are adjusted, so nudging
 * Body doesn't quietly reweight your Craft vocabulary.
 */
function applyLearning(
  userId: number,
  entry: Entry,
  text: string,
  lang: Lang,
  awards: ReturnType<typeof emptyAwards>,
  autoAwards: ReturnType<typeof emptyAwards>,
): void {
  const draft = extract(text, {
    cueTable: getCueTable(userId), fallbackLang: lang,
    xpScale: getSettings(db, userId).xpScale,
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

    learnFromCorrection(db, userId, {
      entryId: entry.id, lang, track, stems: fallback, delta,
    });
  }
  invalidate(userId, { corpus: false });
}

function autoLinkQuests(userId: number, entry: Entry): void {
  const quests = listQuests(db, userId).filter((q) => q.status === "active");
  if (quests.length === 0) return;
  for (const link of linkEntry(entry.text, entry.awards, quests, entry.lang)) {
    linkQuest(db, userId, { ...link, entryId: entry.id });
  }
}

/* ── stats ──────────────────────────────────────────────────────── */

app.get("/api/stats", handler((req, res) => {
  const userId = uid(req);
  const settings = getSettings(db, userId);
  const entries = listEntries(db, userId);
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

app.get("/api/study", handler((req, res) => {
  const userId = uid(req);
  const entries = listEntries(db, userId);
  ok(res, {
    sameDay: sameDayCorrelations(entries, "mood"),
    lagMood: lagCorrelations(entries, "mood"),
    lagXp: lagCorrelations(entries, "totalXp"),
    sleep: sleepLagCorrelation(entries, "mood"),
    pairedDays: pairedDayCount(entries),
    people: listPeople(db, userId),
    chapters: detectChapters(entries),
  });
}));

app.get("/api/achievements", handler((req, res) => {
  const userId = uid(req);
  const settings = getSettings(db, userId);
  ok(res, computeAchievements(listEntries(db, userId), todayISO(), settings.halfLife));
}));

/* ── weekly review ──────────────────────────────────────────────── */

app.get("/api/review", handler((req, res) => {
  const anchor = typeof req.query.week === "string" && isISODate(req.query.week)
    ? req.query.week
    : todayISO();
  const start = weekStart(anchor);

  const userId = uid(req);
  const entries = listEntries(db, userId);
  const hash = reviewHash(entries, start);

  const cached = getCachedReview(db, userId, start, hash);
  if (cached) return ok(res, { ...(cached as object), cached: true });

  const review = buildWeeklyReview(entries, start, getSettings(db, userId).halfLife);
  putCachedReview(db, userId, start, hash, review);
  ok(res, { ...review, cached: false });
}));

/* ── quests ─────────────────────────────────────────────────────── */

const questBody = z.object({
  title: z.string().min(2),
  tracks: z.array(z.string()).default([]),
  targetDate: z.string().nullable().default(null),
  xpTarget: z.number().nullable().default(null),
});

app.get("/api/quests", handler((req, res) => {
  const userId = uid(req);
  const today = todayISO();
  ok(res, listQuests(db, userId).map((q) => {
    const linked = questLinkedEntries(db, userId, q.id);
    return {
      ...questProgress(q, linked, today),
      links: linked.map((e) => ({ id: e.id, date: e.date })),
    };
  }));
}));

app.post("/api/quests", handler((req, res) => {
  const parsed = questBody.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "invalid quest", parsed.error.issues);
  const userId = uid(req);
  const tracks = parsed.data.tracks.filter(isTrackKey);
  const quest = insertQuest(db, userId, { ...parsed.data, tracks });

  // Backfill: an intention you declare today still explains last week.
  for (const entry of listEntries(db, userId)) {
    for (const link of linkEntry(entry.text, entry.awards, [quest], entry.lang)) {
      linkQuest(db, userId, { ...link, entryId: entry.id });
    }
  }
  ok(res, quest);
}));

app.post("/api/quests/:id/status", handler((req, res) => {
  const status = z.enum(["active", "done", "abandoned"]).safeParse(req.body?.status);
  if (!status.success) return fail(res, 400, "status must be active|done|abandoned");
  if (!updateQuestStatus(db, uid(req), Number(req.params.id), status.data)) {
    return fail(res, 404, "no such quest");
  }
  ok(res, { updated: true });
}));

app.delete("/api/quests/:id", handler((req, res) => {
  if (!deleteQuest(db, uid(req), Number(req.params.id))) {
    return fail(res, 404, "no such quest");
  }
  ok(res, { deleted: true });
}));

app.delete("/api/quests/:id/links/:entryId", handler((req, res) => {
  unlinkQuest(db, uid(req), Number(req.params.id), Number(req.params.entryId));
  ok(res, { unlinked: true });
}));

app.get("/api/entries/:id/quests", handler((req, res) =>
  ok(res, questLinksFor(db, uid(req), Number(req.params.id))),
));

/* ── alerts ─────────────────────────────────────────────────────── */

/**
 * Recompute decay state and record anything new.
 *
 * Recovered tracks have their alerts cleared, which is what allows a second
 * fall months later to report again instead of being suppressed forever.
 */
function refreshAlerts(userId: number) {
  const settings = getSettings(db, userId);
  const entries = listEntries(db, userId);
  const existing = listAlerts(db, userId, true);

  for (const stale of staleAlerts(entries, existing, todayISO(), settings.halfLife)) {
    clearAlertsFor(db, userId, stale.track, stale.kind);
  }

  const remaining = listAlerts(db, userId, true);
  const candidates = detectDecay(entries, todayISO(), settings.halfLife);
  for (const fresh of diffAlerts(candidates, remaining)) {
    insertAlert(db, userId, {
      track: fresh.track, kind: fresh.kind,
      peak: fresh.peak, current: fresh.current,
    });
  }
  return listAlerts(db, userId, false);
}

app.get("/api/alerts", handler((req, res) => ok(res, refreshAlerts(uid(req)))));

app.post("/api/alerts/:id/dismiss", handler((req, res) => {
  if (!dismissAlert(db, uid(req), Number(req.params.id))) {
    return fail(res, 404, "no such alert");
  }
  ok(res, { dismissed: true });
}));

/* ── lexicon ────────────────────────────────────────────────────── */

app.get("/api/cues", handler((req, res) => ok(res, listCues(db, uid(req)))));

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
  const userId = uid(req);
  const { lang, track, word, weight } = parsed.data;
  const stems = stemBoth(word);
  upsertCue(db, userId, {
    lang, track: track as TrackKey,
    stem: lang === "sr" ? stems.sr : stems.en,
    weight, source: "user",
  });
  invalidate(userId, { corpus: false });
  ok(res, { saved: true });
}));

app.post("/api/cues/:id/reset", handler((req, res) => {
  const userId = uid(req);
  if (!resetCue(db, userId, Number(req.params.id))) return fail(res, 404, "no such cue");
  invalidate(userId, { corpus: false });
  ok(res, { reset: true });
}));

app.delete("/api/cues/:id", handler((req, res) => {
  const userId = uid(req);
  if (!deleteCue(db, userId, Number(req.params.id))) return fail(res, 404, "no such cue");
  invalidate(userId, { corpus: false });
  ok(res, { deleted: true });
}));

/* ── people ─────────────────────────────────────────────────────── */

app.get("/api/people", handler((req, res) => {
  const userId = uid(req);
  const entries = listEntries(db, userId);
  const overall = moodBaseline(entries);

  ok(res, listPeople(db, userId).map((p) => {
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

  const id = upsertPerson(db, uid(req), body.data.display, body.data.seenOn ?? todayISO());
  if (body.data.alias) addPersonAlias(db, id, body.data.alias);
  ok(res, { id });
}));

app.delete("/api/people/:id", handler((req, res) => {
  if (!deletePerson(db, uid(req), Number(req.params.id))) {
    return fail(res, 404, "no such person");
  }
  ok(res, { deleted: true });
}));

/* ── search & on this day ───────────────────────────────────────── */

app.get("/api/search", handler((req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (q.trim().length === 0) return ok(res, []);
  ok(res, searchEntries(db, uid(req), q));
}));

app.get("/api/onthisday", handler((req, res) => {
  const entries = listEntries(db, uid(req));
  const today = todayISO();
  const pick = (days: number) => {
    const target = new Date(Date.parse(`${today}T12:00:00Z`) - days * 86_400_000)
      .toISOString().slice(0, 10);
    return entries.find((e) => e.date === target) ?? null;
  };
  ok(res, { monthAgo: pick(30), yearAgo: pick(365) });
}));

/* ── settings ───────────────────────────────────────────────────── */

app.get("/api/settings", handler((req, res) =>
  ok(res, { ...getSettings(db, uid(req)), shareScores: req.user!.shareScores }),
));

app.put("/api/settings", handler((req, res) => {
  const body = z.object({
    lang: z.enum(["en", "sr"]).optional(),
    halfLife: z.number().min(1).max(120).optional(),
    xpScale: z.number().min(1).max(40).optional(),
    notify: z.boolean().optional(),
    restDays: z.boolean().optional(),
    /** Whether this account appears on the shared board at all. */
    shareScores: z.boolean().optional(),
  }).safeParse(req.body);
  if (!body.success) return fail(res, 400, "invalid settings", body.error.issues);

  const userId = uid(req);
  const { shareScores, ...journalSettings } = body.data;
  if (shareScores !== undefined) setShareScores(db, userId, shareScores);

  const saved = setSettings(db, userId, journalSettings);
  // halfLife and restDays both feed momentum and the streak, so a change here
  // invalidates the numbers already published to the board.
  refreshScores(db, userId);

  ok(res, {
    ...saved,
    shareScores: shareScores ?? req.user!.shareScores,
  });
}));

/* ── leaderboard ────────────────────────────────────────────────── */

/**
 * The one shared surface.
 *
 * Reads `scores` and `users` only — see readBoard. What a viewer learns about
 * anyone else is a display name, seven momentum figures, a level and a streak.
 * No entry text, no dates, no people, no tags.
 */
app.get("/api/leaderboard", handler((req, res) => {
  const track = typeof req.query.track === "string" ? req.query.track : OVERALL;
  if (track !== OVERALL && !isTrackKey(track)) return fail(res, 400, "unknown track");

  const userId = uid(req);
  // The viewer's own row is always current; everyone else's is refreshed only
  // if it has gone stale, so momentum on the board reflects today's decay.
  refreshScores(db, userId);
  refreshStaleScores(db);

  ok(res, {
    track,
    you: readOwnScore(db, userId, track),
    sharing: req.user!.shareScores,
    rows: readBoard(db, track).map((r, i) => ({ ...r, rank: i + 1 })),
  });
}));

/* ── import & export ────────────────────────────────────────────── */

app.get("/api/export", handler((req, res) => {
  const format = typeof req.query.format === "string" ? req.query.format : "json";
  const entries = listEntries(db, uid(req));

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

  const diff = diffImport(parsed.entries, listEntries(db, uid(req)), parsed.failures);
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

  const userId = uid(req);
  const existing = listEntries(db, userId);
  const diff = diffImport(parsed.entries, existing, parsed.failures);
  const plan = planImport(diff, body.data.strategy);

  const byDate = new Map(existing.map((e) => [e.date, e]));
  let inserted = 0;
  let replaced = 0;

  // One transaction for the whole import: a partial import is not a state
  // anyone should have to reason about.
  db.transaction(() => {
    for (const e of plan.insert) {
      insertEntry(db, userId, {
        ...e,
        tags: e.tags.map((t) => ({ stem: t, display: t })),
      });
      inserted += 1;
    }
    for (const { date, entry } of plan.replace) {
      const target = byDate.get(date);
      if (!target) continue;
      updateEntry(db, userId, target.id, {
        ...entry,
        tags: entry.tags.map((t) => ({ stem: t, display: t })),
      });
      replaced += 1;
    }
  })();

  invalidate(userId);
  refreshScores(db, userId);
  ok(res, {
    inserted, replaced, skipped: plan.skipped,
    failures: diff.failures, alerts: refreshAlerts(userId),
  });
}));

/* ── boot ───────────────────────────────────────────────────────── */

/* ── the built frontend ─────────────────────────────────────────── */

/**
 * In development Vite serves the app on :5173 and proxies /api here. In
 * production there is no Vite, so this process serves `dist` itself and the
 * whole thing is one port and one container.
 *
 * The catch-all deliberately sits after every /api route: an unknown API path
 * should 404 as JSON, not quietly return index.html and surface as a baffling
 * "unexpected token <" in the browser.
 */
const distDir = fileURLToPath(new URL("../dist", import.meta.url));

if (existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: "1h" }));

  app.get("/api/*", (_req, res) => {
    res.status(404).json({ error: "no such endpoint", detail: null });
  });

  app.get("*", (_req, res) => {
    res.sendFile(join(distDir, "index.html"));
  });
} else if (IS_PROD) {
  console.warn(`no built frontend at ${distDir} — run 'npm run build' first`);
}

/* ── boot ───────────────────────────────────────────────────────── */

// A journal that predates accounts arrives with no scores row at all; this
// fills the board in on the first boot after the migration.
refreshAllScores(db);
purgeExpiredSessions(db);

app.listen(PORT, () => {
  console.log(`zapis → http://localhost:${PORT}  (db: ${DB_PATH})`);
  if (!process.env.ZAPIS_INVITE_CODE) {
    console.warn("ZAPIS_INVITE_CODE is unset — registration is closed");
  }
});
