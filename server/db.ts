/* ────────────────────────────────────────────────────────────────
   The database. Owns all persistence; the browser never sees SQL.

   Every write that touches more than one table runs inside a
   transaction, because a half-filed entry is worse than a failed one.
   ──────────────────────────────────────────────────────────────── */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MIGRATIONS } from "./schema.ts";
import { CUE_SEED } from "../src/domain/extract/lexicon/cues.ts";
import { stem } from "../src/domain/extract/stem.ts";
import { fold } from "../src/domain/extract/normalize.ts";
import { nameBase } from "../src/domain/extract/people.ts";
import { TRACK_KEYS, emptyAwards } from "../src/domain/tracks.ts";
import type {
  Alert,
  Awards,
  Cue,
  Entry,
  Lang,
  Metric,
  Person,
  Quest,
  Settings,
  TrackKey,
} from "../src/domain/types.ts";

export type DB = Database.Database;

const DEFAULT_SETTINGS: Settings = {
  lang: "en",
  halfLife: 14,
  xpScale: 7.5,
  notify: false,
  restDays: false,
};

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seedCues(db);
  seedSettings(db);
  return db;
}

function migrate(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);
  const row = db.prepare(`SELECT MAX(version) AS v FROM schema_version`).get() as
    | { v: number | null }
    | undefined;
  const current = row?.v ?? 0;

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(m.version);
    })();
  }
}

/** Load the seed lexicon on first run. Existing rows are never overwritten. */
function seedCues(db: DB): void {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM cues`).get() as { n: number };
  if (count.n > 0) return;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO cues (lang, track, stem, weight, seed_weight, source)
     VALUES (?, ?, ?, ?, ?, 'seed')`,
  );

  db.transaction(() => {
    for (const track of TRACK_KEYS) {
      for (const lang of ["en", "sr"] as Lang[]) {
        for (const seed of CUE_SEED[track][lang]) {
          const s = stem(seed.word, lang);
          if (s.length < 2) continue;
          insert.run(lang, track, s, seed.weight, seed.weight);
        }
      }
    }
  })();
}

function seedSettings(db: DB): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
  );
  db.transaction(() => {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      insert.run(k, JSON.stringify(v));
    }
  })();
}

/* ── settings ───────────────────────────────────────────────────── */

export function getSettings(db: DB): Settings {
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as {
    key: string;
    value: string;
  }[];
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out as unknown as Settings;
}

export function setSettings(db: DB, patch: Partial<Settings>): Settings {
  const stmt = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      stmt.run(k, JSON.stringify(v));
    }
  })();
  return getSettings(db);
}

/* ── entries ────────────────────────────────────────────────────── */

interface EntryRow {
  id: number;
  date: string;
  text: string;
  lang: string;
  mood: number | null;
  energy: number | null;
  note: string;
  created_at: string;
  edited_at: string | null;
}

function hydrate(db: DB, rows: readonly EntryRow[]): Entry[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");

  const awardRows = db
    .prepare(
      `SELECT entry_id, track, xp, auto_xp FROM entry_awards
       WHERE entry_id IN (${placeholders})`,
    )
    .all(...ids) as { entry_id: number; track: string; xp: number; auto_xp: number }[];

  const peopleRows = db
    .prepare(
      `SELECT ep.entry_id, p.display FROM entry_people ep
       JOIN people p ON p.id = ep.person_id
       WHERE ep.entry_id IN (${placeholders})`,
    )
    .all(...ids) as { entry_id: number; display: string }[];

  const tagRows = db
    .prepare(
      `SELECT et.entry_id, t.display FROM entry_tags et
       JOIN tags t ON t.id = et.tag_id
       WHERE et.entry_id IN (${placeholders})`,
    )
    .all(...ids) as { entry_id: number; display: string }[];

  const eventRows = db
    .prepare(
      `SELECT entry_id, idx, text FROM entry_events
       WHERE entry_id IN (${placeholders}) ORDER BY idx`,
    )
    .all(...ids) as { entry_id: number; idx: number; text: string }[];

  const metricRows = db
    .prepare(
      `SELECT entry_id, kind, value, unit, track FROM entry_metrics
       WHERE entry_id IN (${placeholders})`,
    )
    .all(...ids) as {
    entry_id: number;
    kind: string;
    value: number;
    unit: string;
    track: string | null;
  }[];

  const byId = new Map<number, Entry>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      date: r.date,
      text: r.text,
      lang: (r.lang === "sr" ? "sr" : "en") as Lang,
      awards: emptyAwards(),
      autoAwards: emptyAwards(),
      mood: r.mood,
      energy: r.energy,
      people: [],
      events: [],
      tags: [],
      note: r.note,
      metrics: [],
      createdAt: r.created_at,
      editedAt: r.edited_at,
    });
  }

  for (const a of awardRows) {
    const e = byId.get(a.entry_id);
    if (!e) continue;
    const t = a.track as TrackKey;
    if (!TRACK_KEYS.includes(t)) continue;
    e.awards[t] = a.xp;
    e.autoAwards[t] = a.auto_xp;
  }
  for (const p of peopleRows) byId.get(p.entry_id)?.people.push(p.display);
  for (const t of tagRows) byId.get(t.entry_id)?.tags.push(t.display);
  for (const ev of eventRows) byId.get(ev.entry_id)?.events.push(ev.text);
  for (const m of metricRows) {
    byId.get(m.entry_id)?.metrics.push({
      kind: m.kind,
      value: m.value,
      unit: m.unit,
      track: (m.track as TrackKey) ?? null,
    });
  }

  return rows.map((r) => byId.get(r.id)!);
}

export function listEntries(db: DB): Entry[] {
  const rows = db
    .prepare(`SELECT * FROM entries ORDER BY date DESC, id DESC`)
    .all() as EntryRow[];
  return hydrate(db, rows);
}

export function getEntry(db: DB, id: number): Entry | null {
  const row = db.prepare(`SELECT * FROM entries WHERE id = ?`).get(id) as
    | EntryRow
    | undefined;
  if (!row) return null;
  return hydrate(db, [row])[0] ?? null;
}

export interface EntryInput {
  date: string;
  text: string;
  lang: Lang;
  awards: Awards;
  autoAwards: Awards;
  mood: number | null;
  energy: number | null;
  people: readonly string[];
  events: readonly string[];
  tags: readonly { stem: string; display: string }[];
  note: string;
  metrics: readonly Metric[];
  createdAt?: string;
}

/** Insert an entry and everything hanging off it, atomically. */
export function insertEntry(db: DB, input: EntryInput): Entry {
  const id = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO entries (date, text, lang, mood, energy, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.date,
        input.text,
        input.lang,
        input.mood,
        input.energy,
        input.note,
        input.createdAt ?? new Date().toISOString(),
      );
    const entryId = Number(info.lastInsertRowid);
    writeChildren(db, entryId, input);
    return entryId;
  })();

  return getEntry(db, id)!;
}

export function updateEntry(db: DB, id: number, input: EntryInput): Entry | null {
  const exists = db.prepare(`SELECT id FROM entries WHERE id = ?`).get(id);
  if (!exists) return null;

  db.transaction(() => {
    db.prepare(
      `UPDATE entries SET date = ?, text = ?, lang = ?, mood = ?, energy = ?,
              note = ?, edited_at = ? WHERE id = ?`,
    ).run(
      input.date,
      input.text,
      input.lang,
      input.mood,
      input.energy,
      input.note,
      new Date().toISOString(),
      id,
    );
    db.prepare(`DELETE FROM entry_awards  WHERE entry_id = ?`).run(id);
    db.prepare(`DELETE FROM entry_people  WHERE entry_id = ?`).run(id);
    db.prepare(`DELETE FROM entry_tags    WHERE entry_id = ?`).run(id);
    db.prepare(`DELETE FROM entry_events  WHERE entry_id = ?`).run(id);
    db.prepare(`DELETE FROM entry_metrics WHERE entry_id = ?`).run(id);
    writeChildren(db, id, input);
  })();

  return getEntry(db, id);
}

function writeChildren(db: DB, entryId: number, input: EntryInput): void {
  const award = db.prepare(
    `INSERT INTO entry_awards (entry_id, track, xp, auto_xp) VALUES (?, ?, ?, ?)`,
  );
  for (const t of TRACK_KEYS) {
    const xp = input.awards[t] ?? 0;
    const auto = input.autoAwards[t] ?? 0;
    if (xp === 0 && auto === 0) continue;
    award.run(entryId, t, xp, auto);
  }

  for (const name of input.people) {
    const personId = upsertPerson(db, name, input.date);
    db.prepare(
      `INSERT OR IGNORE INTO entry_people (entry_id, person_id) VALUES (?, ?)`,
    ).run(entryId, personId);
  }

  for (const tag of input.tags) {
    const tagId = upsertTag(db, tag.stem, tag.display, input.lang);
    db.prepare(
      `INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)`,
    ).run(entryId, tagId);
  }

  const ev = db.prepare(
    `INSERT INTO entry_events (entry_id, idx, text) VALUES (?, ?, ?)`,
  );
  input.events.forEach((text, idx) => ev.run(entryId, idx, text));

  const met = db.prepare(
    `INSERT INTO entry_metrics (entry_id, kind, value, unit, track)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const m of input.metrics) met.run(entryId, m.kind, m.value, m.unit, m.track);
}

export function deleteEntry(db: DB, id: number): boolean {
  const info = db.prepare(`DELETE FROM entries WHERE id = ?`).run(id);
  return info.changes > 0;
}

/* ── people ─────────────────────────────────────────────────────── */

/**
 * Find or create a person, merging inflected forms of the same name.
 *
 * Matching is by *case-stripped base*, not by the exact spelling, because
 * Serbian declines names: Ana / Anom / Ani / Ane, Milan / Milana / Milanu.
 * Keying on the surface form produced four separate "people" for one friend
 * and quietly split their appearance counts and mood statistics — the precise
 * fragmentation this app exists to avoid.
 *
 * The first spelling seen becomes the display name; later variants are
 * recorded as aliases so the registry gets better at recognising them.
 */
export function upsertPerson(db: DB, display: string, seenOn: string): number {
  const canonical = fold(display);
  const base = nameBase(display);

  const candidates = db
    .prepare(`SELECT id, canonical, display, aliases, first_seen, last_seen FROM people`)
    .all() as {
    id: number;
    canonical: string;
    display: string;
    aliases: string;
    first_seen: string | null;
    last_seen: string | null;
  }[];

  const existing = candidates.find(
    (p) =>
      p.canonical === canonical ||
      nameBase(p.canonical) === base ||
      safeJson<string[]>(p.aliases, []).some((a) => fold(a) === canonical),
  );

  if (existing) {
    db.prepare(
      `UPDATE people SET
         first_seen = MIN(COALESCE(first_seen, ?), ?),
         last_seen  = MAX(COALESCE(last_seen, ?), ?)
       WHERE id = ?`,
    ).run(seenOn, seenOn, seenOn, seenOn, existing.id);

    if (fold(existing.display) !== canonical) {
      addPersonAlias(db, existing.id, display);
      // Prefer the shortest spelling as the display name: Serbian case endings
      // only ever add length, so the shortest form seen is the nominative —
      // "Ana" rather than "Anom", "Milan" rather than "Milanom".
      if (display.length < existing.display.length) {
        addPersonAlias(db, existing.id, existing.display);
        db.prepare(`UPDATE people SET display = ? WHERE id = ?`).run(display, existing.id);
      }
    }
    return existing.id;
  }

  const info = db
    .prepare(
      `INSERT INTO people (canonical, display, aliases, first_seen, last_seen)
       VALUES (?, ?, '[]', ?, ?)`,
    )
    .run(canonical, display, seenOn, seenOn);
  return Number(info.lastInsertRowid);
}

export function addPersonAlias(db: DB, personId: number, alias: string): void {
  const row = db.prepare(`SELECT aliases FROM people WHERE id = ?`).get(personId) as
    | { aliases: string }
    | undefined;
  if (!row) return;
  let list: string[] = [];
  try {
    list = JSON.parse(row.aliases) as string[];
  } catch {
    list = [];
  }
  const folded = fold(alias);
  if (!list.map(fold).includes(folded)) list.push(alias);
  db.prepare(`UPDATE people SET aliases = ? WHERE id = ?`).run(
    JSON.stringify(list),
    personId,
  );
}

export function listPeople(db: DB): Person[] {
  const rows = db
    .prepare(
      `SELECT p.*, COUNT(ep.entry_id) AS appearances
       FROM people p LEFT JOIN entry_people ep ON ep.person_id = p.id
       GROUP BY p.id ORDER BY appearances DESC, p.display`,
    )
    .all() as {
    id: number;
    canonical: string;
    display: string;
    aliases: string;
    first_seen: string | null;
    last_seen: string | null;
    appearances: number;
  }[];

  return rows.map((r) => ({
    id: r.id,
    canonical: r.canonical,
    display: r.display,
    aliases: safeJson<string[]>(r.aliases, []),
    firstSeen: r.first_seen ?? "",
    lastSeen: r.last_seen ?? "",
    appearances: r.appearances,
  }));
}

export function deletePerson(db: DB, id: number): boolean {
  return db.prepare(`DELETE FROM people WHERE id = ?`).run(id).changes > 0;
}

/* ── tags ───────────────────────────────────────────────────────── */

export function upsertTag(db: DB, stemKey: string, display: string, lang: Lang): number {
  const existing = db.prepare(`SELECT id FROM tags WHERE stem = ?`).get(stemKey) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const info = db
    .prepare(`INSERT INTO tags (stem, display, lang) VALUES (?, ?, ?)`)
    .run(stemKey, display, lang);
  return Number(info.lastInsertRowid);
}

/* ── cues ───────────────────────────────────────────────────────── */

export function listCues(db: DB): Cue[] {
  const rows = db
    .prepare(`SELECT * FROM cues ORDER BY track, lang, stem`)
    .all() as {
    id: number;
    lang: string;
    track: string;
    stem: string;
    weight: number;
    seed_weight: number;
    source: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    lang: r.lang as Lang,
    track: r.track as TrackKey,
    stem: r.stem,
    weight: r.weight,
    seedWeight: r.seed_weight,
    source: r.source as Cue["source"],
  }));
}

export function upsertCue(
  db: DB,
  cue: { lang: Lang; track: TrackKey; stem: string; weight: number; source?: Cue["source"] },
): void {
  db.prepare(
    `INSERT INTO cues (lang, track, stem, weight, seed_weight, source)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(lang, track, stem) DO UPDATE SET
       weight = excluded.weight,
       source = excluded.source`,
  ).run(cue.lang, cue.track, cue.stem, cue.weight, cue.weight, cue.source ?? "user");
}

export function deleteCue(db: DB, id: number): boolean {
  return db.prepare(`DELETE FROM cues WHERE id = ?`).run(id).changes > 0;
}

export function resetCue(db: DB, id: number): boolean {
  return (
    db
      .prepare(
        `UPDATE cues SET weight = seed_weight, source = 'seed'
         WHERE id = ? AND seed_weight IS NOT NULL`,
      )
      .run(id).changes > 0
  );
}

/**
 * Nudge the weights of the cues that fired for a track, from your correction.
 *
 * Learning rate is deliberately small: one correction should tilt the engine,
 * not reverse it, so a single unusual day cannot rewrite the lexicon.
 */
export const LEARNING_RATE = 0.08;
export const WEIGHT_BOUNDS = { min: 0, max: 6 } as const;

export function learnFromCorrection(
  db: DB,
  opts: {
    entryId: number | null;
    lang: Lang;
    track: TrackKey;
    stems: readonly string[];
    /** XP delta you applied: positive means the engine under-scored. */
    delta: number;
  },
): void {
  if (opts.stems.length === 0 || opts.delta === 0) return;
  const step = (LEARNING_RATE * opts.delta) / opts.stems.length;

  db.transaction(() => {
    for (const s of opts.stems) {
      const row = db
        .prepare(`SELECT id, weight FROM cues WHERE lang = ? AND track = ? AND stem = ?`)
        .get(opts.lang, opts.track, s) as { id: number; weight: number } | undefined;

      if (!row) {
        // A word you corrected that isn't in the lexicon becomes a new cue,
        // but only when you nudged *upwards* — otherwise we'd invent a cue
        // in order to immediately mute it.
        if (opts.delta <= 0) continue;
        db.prepare(
          `INSERT OR IGNORE INTO cues (lang, track, stem, weight, seed_weight, source)
           VALUES (?, ?, ?, ?, 0, 'learned')`,
        ).run(opts.lang, opts.track, s, Math.min(WEIGHT_BOUNDS.max, Math.abs(step)));
        continue;
      }

      const next = Math.max(
        WEIGHT_BOUNDS.min,
        Math.min(WEIGHT_BOUNDS.max, row.weight + step),
      );
      db.prepare(`UPDATE cues SET weight = ?, source = 'learned' WHERE id = ?`).run(
        next,
        row.id,
      );
      db.prepare(
        `INSERT INTO cue_adjustments (cue_id, entry_id, delta, at) VALUES (?, ?, ?, ?)`,
      ).run(row.id, opts.entryId, step, new Date().toISOString());
    }
  })();
}

/* ── quests ─────────────────────────────────────────────────────── */

export function listQuests(db: DB): Quest[] {
  const rows = db.prepare(`SELECT * FROM quests ORDER BY created_at DESC`).all() as {
    id: number;
    title: string;
    tracks: string;
    created_at: string;
    target_date: string | null;
    status: string;
    xp_target: number | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    tracks: safeJson<TrackKey[]>(r.tracks, []),
    createdAt: r.created_at,
    targetDate: r.target_date,
    status: r.status as Quest["status"],
    xpTarget: r.xp_target,
  }));
}

export function insertQuest(
  db: DB,
  q: { title: string; tracks: TrackKey[]; targetDate: string | null; xpTarget: number | null },
): Quest {
  const info = db
    .prepare(
      `INSERT INTO quests (title, tracks, created_at, target_date, status, xp_target)
       VALUES (?, ?, ?, ?, 'active', ?)`,
    )
    .run(
      q.title,
      JSON.stringify(q.tracks),
      new Date().toISOString(),
      q.targetDate,
      q.xpTarget,
    );
  return listQuests(db).find((x) => x.id === Number(info.lastInsertRowid))!;
}

export function updateQuestStatus(db: DB, id: number, status: Quest["status"]): boolean {
  return db.prepare(`UPDATE quests SET status = ? WHERE id = ?`).run(status, id).changes > 0;
}

export function deleteQuest(db: DB, id: number): boolean {
  return db.prepare(`DELETE FROM quests WHERE id = ?`).run(id).changes > 0;
}

export function linkQuest(
  db: DB,
  link: { questId: number; entryId: number; confidence: number; evidence: string },
): void {
  db.prepare(
    `INSERT INTO quest_links (quest_id, entry_id, confidence, evidence)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(quest_id, entry_id) DO UPDATE SET
       confidence = excluded.confidence, evidence = excluded.evidence`,
  ).run(link.questId, link.entryId, link.confidence, link.evidence);
}

export function unlinkQuest(db: DB, questId: number, entryId: number): void {
  db.prepare(`DELETE FROM quest_links WHERE quest_id = ? AND entry_id = ?`).run(
    questId,
    entryId,
  );
}

export function questLinkedEntries(db: DB, questId: number): Entry[] {
  const rows = db
    .prepare(
      `SELECT e.* FROM entries e
       JOIN quest_links ql ON ql.entry_id = e.id
       WHERE ql.quest_id = ? ORDER BY e.date`,
    )
    .all(questId) as EntryRow[];
  return hydrate(db, rows);
}

export function questLinksFor(db: DB, entryId: number) {
  return db
    .prepare(
      `SELECT ql.quest_id AS questId, ql.confidence, ql.evidence, q.title
       FROM quest_links ql JOIN quests q ON q.id = ql.quest_id
       WHERE ql.entry_id = ?`,
    )
    .all(entryId) as {
    questId: number;
    confidence: number;
    evidence: string;
    title: string;
  }[];
}

/* ── alerts ─────────────────────────────────────────────────────── */

export function listAlerts(db: DB, includeDismissed = false): Alert[] {
  const sql = includeDismissed
    ? `SELECT * FROM alerts ORDER BY triggered_at DESC`
    : `SELECT * FROM alerts WHERE dismissed_at IS NULL ORDER BY triggered_at DESC`;
  const rows = db.prepare(sql).all() as {
    id: number;
    track: string;
    kind: string;
    peak: number;
    current: number;
    triggered_at: string;
    dismissed_at: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    track: r.track as TrackKey,
    kind: r.kind as Alert["kind"],
    peak: r.peak,
    current: r.current,
    triggeredAt: r.triggered_at,
    dismissedAt: r.dismissed_at,
  }));
}

export function insertAlert(
  db: DB,
  a: { track: TrackKey; kind: Alert["kind"]; peak: number; current: number },
): void {
  db.prepare(
    `INSERT INTO alerts (track, kind, peak, current, triggered_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(a.track, a.kind, a.peak, a.current, new Date().toISOString());
}

export function dismissAlert(db: DB, id: number): boolean {
  return (
    db
      .prepare(`UPDATE alerts SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL`)
      .run(new Date().toISOString(), id).changes > 0
  );
}

/** Clear alerts for a recovered track so a future fall can report again. */
export function clearAlertsFor(db: DB, track: TrackKey, kind: Alert["kind"]): void {
  db.prepare(`DELETE FROM alerts WHERE track = ? AND kind = ?`).run(track, kind);
}

/* ── reviews cache ──────────────────────────────────────────────── */

export function getCachedReview(
  db: DB,
  weekStart: string,
  hash: string,
): unknown | null {
  const row = db
    .prepare(`SELECT findings, entries_hash FROM reviews WHERE week_start = ?`)
    .get(weekStart) as { findings: string; entries_hash: string } | undefined;
  if (!row || row.entries_hash !== hash) return null;
  return safeJson<unknown>(row.findings, null);
}

export function putCachedReview(
  db: DB,
  weekStart: string,
  hash: string,
  payload: unknown,
): void {
  db.prepare(
    `INSERT INTO reviews (week_start, entries_hash, findings, built_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(week_start) DO UPDATE SET
       entries_hash = excluded.entries_hash,
       findings = excluded.findings,
       built_at = excluded.built_at`,
  ).run(weekStart, hash, JSON.stringify(payload), new Date().toISOString());
}

/* ── search ─────────────────────────────────────────────────────── */

export interface SearchHit {
  entry: Entry;
  snippet: string;
}

/**
 * Full-text search over entries.
 *
 * The query is passed through as an FTS5 MATCH expression but each bare term
 * is quoted, so a stray `"` or `*` from the search box can't become a syntax
 * error — or worse, a wildcard that matches the entire journal.
 */
export function searchEntries(db: DB, query: string, limit = 100): SearchHit[] {
  const terms = query
    .split(/\s+/)
    .map((t) => t.replace(/["*(){}:^-]/g, "").trim())
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"*`);

  if (terms.length === 0) return [];

  const rows = db
    .prepare(
      `SELECT e.*, snippet(entries_fts, 0, '⟦', '⟧', '…', 18) AS snippet
       FROM entries_fts f JOIN entries e ON e.id = f.rowid
       WHERE entries_fts MATCH ?
       ORDER BY rank LIMIT ?`,
    )
    .all(terms.join(" AND "), limit) as (EntryRow & { snippet: string })[];

  const entries = hydrate(db, rows);
  return rows.map((r, i) => ({ entry: entries[i]!, snippet: r.snippet }));
}

/* ── util ───────────────────────────────────────────────────────── */

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
