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
  {
    version: 3,
    name: "accounts",
    sql: `
      CREATE TABLE users (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        handle         TEXT    NOT NULL UNIQUE,
        display        TEXT    NOT NULL,
        password_hash  TEXT    NOT NULL,
        created_at     TEXT    NOT NULL,
        share_scores   INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE sessions (
        token       TEXT    PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT    NOT NULL,
        expires_at  TEXT    NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      -- The leaderboard's only source. Numbers exclusively: no column here
      -- may ever hold prose, and the board is forbidden from joining against
      -- entries. That structural rule is what keeps a shared scoreboard from
      -- becoming a shared journal — a careful SELECT is one refactor away
      -- from leaking, a table with no text column is not.
      CREATE TABLE scores (
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track        TEXT    NOT NULL,
        momentum     REAL    NOT NULL DEFAULT 0,
        lifetime     INTEGER NOT NULL DEFAULT 0,
        level        INTEGER NOT NULL DEFAULT 0,
        streak       INTEGER NOT NULL DEFAULT 0,
        entry_count  INTEGER NOT NULL DEFAULT 0,
        updated_at   TEXT    NOT NULL,
        PRIMARY KEY (user_id, track)
      );

      -- A journal that predates accounts is adopted by user 1. Its password
      -- is empty, which no login accepts; 'npm run user:passwd' sets one.
      INSERT INTO users (id, handle, display, password_hash, created_at, share_scores)
      SELECT 1, 'me', 'Me', '', datetime('now'), 1
      WHERE EXISTS (SELECT 1 FROM entries);

      -- Each owned table is rebuilt rather than altered: SQLite cannot add a
      -- column to an existing UNIQUE constraint, and every uniqueness rule
      -- here has to become per-user or two people can't both know a Marko.
      --
      -- Rows are carried over only when there is an owner to carry them to.
      -- On a database that never held entries the cues and settings are just
      -- seed data, and are re-seeded per user at account creation.

      DROP TRIGGER entries_ai;
      DROP TRIGGER entries_ad;
      DROP TRIGGER entries_au;

      CREATE TABLE entries_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date        TEXT    NOT NULL,
        text        TEXT    NOT NULL DEFAULT '',
        lang        TEXT    NOT NULL DEFAULT 'en',
        mood        INTEGER,
        energy      INTEGER,
        note        TEXT    NOT NULL DEFAULT '',
        created_at  TEXT    NOT NULL,
        edited_at   TEXT
      );
      INSERT INTO entries_new (id, user_id, date, text, lang, mood, energy, note, created_at, edited_at)
      SELECT id, 1, date, text, lang, mood, energy, note, created_at, edited_at FROM entries
      WHERE EXISTS (SELECT 1 FROM users WHERE id = 1);
      DROP TABLE entries;
      ALTER TABLE entries_new RENAME TO entries;
      CREATE INDEX idx_entries_date ON entries(date);
      CREATE INDEX idx_entries_user_date ON entries(user_id, date);

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
      INSERT INTO entries_fts(entries_fts) VALUES ('rebuild');

      CREATE TABLE people_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        canonical   TEXT    NOT NULL,
        display     TEXT    NOT NULL,
        aliases     TEXT    NOT NULL DEFAULT '[]',
        first_seen  TEXT,
        last_seen   TEXT,
        UNIQUE (user_id, canonical)
      );
      INSERT INTO people_new (id, user_id, canonical, display, aliases, first_seen, last_seen)
      SELECT id, 1, canonical, display, aliases, first_seen, last_seen FROM people
      WHERE EXISTS (SELECT 1 FROM users WHERE id = 1);
      DROP TABLE people;
      ALTER TABLE people_new RENAME TO people;

      CREATE TABLE tags_new (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stem     TEXT    NOT NULL,
        display  TEXT    NOT NULL,
        lang     TEXT    NOT NULL DEFAULT 'en',
        UNIQUE (user_id, stem)
      );
      INSERT INTO tags_new (id, user_id, stem, display, lang)
      SELECT id, 1, stem, display, lang FROM tags
      WHERE EXISTS (SELECT 1 FROM users WHERE id = 1);
      DROP TABLE tags;
      ALTER TABLE tags_new RENAME TO tags;

      CREATE TABLE quests_new (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title        TEXT    NOT NULL,
        tracks       TEXT    NOT NULL DEFAULT '[]',
        created_at   TEXT    NOT NULL,
        target_date  TEXT,
        status       TEXT    NOT NULL DEFAULT 'active',
        xp_target    INTEGER
      );
      INSERT INTO quests_new (id, user_id, title, tracks, created_at, target_date, status, xp_target)
      SELECT id, 1, title, tracks, created_at, target_date, status, xp_target FROM quests
      WHERE EXISTS (SELECT 1 FROM users WHERE id = 1);
      DROP TABLE quests;
      ALTER TABLE quests_new RENAME TO quests;

      CREATE TABLE cues_new (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        lang         TEXT    NOT NULL,
        track        TEXT    NOT NULL,
        stem         TEXT    NOT NULL,
        weight       REAL    NOT NULL,
        seed_weight  REAL    NOT NULL,
        source       TEXT    NOT NULL DEFAULT 'seed',
        UNIQUE (user_id, lang, track, stem)
      );
      INSERT INTO cues_new (id, user_id, lang, track, stem, weight, seed_weight, source)
      SELECT id, 1, lang, track, stem, weight, seed_weight, source FROM cues
      WHERE EXISTS (SELECT 1 FROM users WHERE id = 1);
      DROP TABLE cues;
      ALTER TABLE cues_new RENAME TO cues;

      CREATE TABLE alerts_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track         TEXT    NOT NULL,
        kind          TEXT    NOT NULL,
        peak          INTEGER NOT NULL,
        current       INTEGER NOT NULL,
        triggered_at  TEXT    NOT NULL,
        dismissed_at  TEXT
      );
      INSERT INTO alerts_new (id, user_id, track, kind, peak, current, triggered_at, dismissed_at)
      SELECT id, 1, track, kind, peak, current, triggered_at, dismissed_at FROM alerts
      WHERE EXISTS (SELECT 1 FROM users WHERE id = 1);
      DROP TABLE alerts;
      ALTER TABLE alerts_new RENAME TO alerts;

      CREATE TABLE reviews_new (
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        week_start    TEXT    NOT NULL,
        entries_hash  TEXT    NOT NULL,
        findings      TEXT    NOT NULL,
        built_at      TEXT    NOT NULL,
        PRIMARY KEY (user_id, week_start)
      );
      INSERT INTO reviews_new (user_id, week_start, entries_hash, findings, built_at)
      SELECT 1, week_start, entries_hash, findings, built_at FROM reviews
      WHERE EXISTS (SELECT 1 FROM users WHERE id = 1);
      DROP TABLE reviews;
      ALTER TABLE reviews_new RENAME TO reviews;

      CREATE TABLE settings_new (
        user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key      TEXT    NOT NULL,
        value    TEXT    NOT NULL,
        PRIMARY KEY (user_id, key)
      );
      INSERT INTO settings_new (user_id, key, value)
      SELECT 1, key, value FROM settings
      WHERE EXISTS (SELECT 1 FROM users WHERE id = 1);
      DROP TABLE settings;
      ALTER TABLE settings_new RENAME TO settings;
    `,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
