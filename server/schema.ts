/* ────────────────────────────────────────────────────────────────
   Schema, as an ordered list of migrations.

   Kept in TypeScript rather than loose .sql files so the migration
   list can never drift out of sync with the code that depends on it,
   and so `npm test` can build a throwaway in-memory database from the
   exact same definitions the real one uses.

   Migrations are append-only. Never edit one that has shipped.
   ──────────────────────────────────────────────────────────────── */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "init",
    sql: `
      CREATE TABLE entries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        date        TEXT    NOT NULL,
        text        TEXT    NOT NULL DEFAULT '',
        lang        TEXT    NOT NULL DEFAULT 'en',
        mood        INTEGER,
        energy      INTEGER,
        note        TEXT    NOT NULL DEFAULT '',
        created_at  TEXT    NOT NULL,
        edited_at   TEXT
      );
      CREATE INDEX idx_entries_date ON entries(date);

      -- auto_xp preserves what the engine said before you corrected it.
      -- The difference between the two columns is the learning signal.
      CREATE TABLE entry_awards (
        entry_id  INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        track     TEXT    NOT NULL,
        xp        INTEGER NOT NULL DEFAULT 0,
        auto_xp   INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (entry_id, track)
      );

      CREATE TABLE people (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        canonical   TEXT    NOT NULL UNIQUE,
        display     TEXT    NOT NULL,
        aliases     TEXT    NOT NULL DEFAULT '[]',
        first_seen  TEXT,
        last_seen   TEXT
      );

      CREATE TABLE entry_people (
        entry_id   INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        person_id  INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        PRIMARY KEY (entry_id, person_id)
      );

      CREATE TABLE tags (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        stem     TEXT    NOT NULL UNIQUE,
        display  TEXT    NOT NULL,
        lang     TEXT    NOT NULL DEFAULT 'en'
      );

      CREATE TABLE entry_tags (
        entry_id  INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (entry_id, tag_id)
      );

      CREATE TABLE entry_events (
        entry_id  INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        idx       INTEGER NOT NULL,
        text      TEXT    NOT NULL,
        PRIMARY KEY (entry_id, idx)
      );

      CREATE TABLE entry_metrics (
        entry_id  INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        kind      TEXT    NOT NULL,
        value     REAL    NOT NULL,
        unit      TEXT    NOT NULL,
        track     TEXT
      );
      CREATE INDEX idx_metrics_entry ON entry_metrics(entry_id);
      CREATE INDEX idx_metrics_kind ON entry_metrics(kind);

      CREATE TABLE quests (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        title        TEXT    NOT NULL,
        tracks       TEXT    NOT NULL DEFAULT '[]',
        created_at   TEXT    NOT NULL,
        target_date  TEXT,
        status       TEXT    NOT NULL DEFAULT 'active',
        xp_target    INTEGER
      );

      CREATE TABLE quest_links (
        quest_id    INTEGER NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
        entry_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        confidence  REAL    NOT NULL DEFAULT 0,
        evidence    TEXT    NOT NULL DEFAULT '',
        PRIMARY KEY (quest_id, entry_id)
      );

      -- The lexicon. seed_weight is kept so any row can be reset.
      CREATE TABLE cues (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        lang         TEXT    NOT NULL,
        track        TEXT    NOT NULL,
        stem         TEXT    NOT NULL,
        weight       REAL    NOT NULL,
        seed_weight  REAL    NOT NULL,
        source       TEXT    NOT NULL DEFAULT 'seed',
        UNIQUE (lang, track, stem)
      );

      CREATE TABLE cue_adjustments (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        cue_id    INTEGER NOT NULL REFERENCES cues(id) ON DELETE CASCADE,
        entry_id  INTEGER REFERENCES entries(id) ON DELETE SET NULL,
        delta     REAL    NOT NULL,
        at        TEXT    NOT NULL
      );

      CREATE TABLE alerts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        track         TEXT    NOT NULL,
        kind          TEXT    NOT NULL,
        peak          INTEGER NOT NULL,
        current       INTEGER NOT NULL,
        triggered_at  TEXT    NOT NULL,
        dismissed_at  TEXT
      );

      CREATE TABLE reviews (
        week_start    TEXT PRIMARY KEY,
        entries_hash  TEXT NOT NULL,
        findings      TEXT NOT NULL,
        built_at      TEXT NOT NULL
      );

      CREATE TABLE settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "fts",
    sql: `
      -- External-content FTS5: the index references entries rather than
      -- duplicating the text, so there is exactly one copy of your writing.
      CREATE VIRTUAL TABLE entries_fts USING fts5(
        text,
        note,
        content='entries',
        content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN
        INSERT INTO entries_fts(rowid, text, note) VALUES (new.id, new.text, new.note);
      END;
      CREATE TRIGGER entries_ad AFTER DELETE ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, text, note)
          VALUES ('delete', old.id, old.text, old.note);
      END;
      CREATE TRIGGER entries_au AFTER UPDATE ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, text, note)
          VALUES ('delete', old.id, old.text, old.note);
        INSERT INTO entries_fts(rowid, text, note) VALUES (new.id, new.text, new.note);
      END;
    `,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
