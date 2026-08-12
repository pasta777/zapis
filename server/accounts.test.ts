/* ────────────────────────────────────────────────────────────────
   Multi-user isolation, and the leaderboard's boundary.

   These tests exist because the failure they guard against is silent:
   a dropped `WHERE user_id = ?` doesn't crash, doesn't fail a type
   check, and doesn't show up in the UI until someone reads a sentence
   they should never have seen. Every accessor gets an explicit "and
   the other account cannot see it" case.
   ──────────────────────────────────────────────────────────────── */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MIGRATIONS } from "./schema.ts";
import {
  OVERALL, clearAlertsFor, createSession, createUser, deleteCue, deleteEntry,
  deletePerson, deleteQuest, dismissAlert, findUserByHandle, getCachedReview,
  getEntry, getSettings, insertAlert, insertEntry, insertQuest, learnFromCorrection,
  linkQuest, listAlerts, listCues, listEntries, listPeople, listQuests, openDb,
  putCachedReview, questLinkedEntries, questLinksFor, readBoard, readOwnScore,
  searchEntries,
  setSettings, setShareScores, updateEntry, updateQuestStatus, upsertCue,
  upsertPerson, userForSession, type DB, type User,
} from "./db.ts";
import { hashPassword, inviteProblem, verifyPassword } from "./auth.ts";
import { refreshScores } from "./scores.ts";
import { emptyAwards } from "../src/domain/tracks.ts";
import { todayISO, shiftISO } from "../src/domain/dates.ts";
import type { Awards, TrackKey } from "../src/domain/types.ts";

function awards(patch: Partial<Awards> = {}): Awards {
  return { ...emptyAwards(), ...patch };
}

function entry(date: string, text: string, patch: Partial<Awards> = {}) {
  return {
    date, text, lang: "en" as const,
    awards: awards(patch), autoAwards: awards(patch),
    mood: null, energy: null,
    people: [] as string[], events: [] as string[],
    tags: [] as { stem: string; display: string }[],
    note: "", metrics: [],
  };
}

let db: DB;
let alice: User;
let bob: User;

beforeEach(() => {
  db = openDb(":memory:");
  alice = createUser(db, { handle: "alice", display: "Alice", passwordHash: "x" });
  bob = createUser(db, { handle: "bob", display: "Bob", passwordHash: "y" });
});

/* ── entries ────────────────────────────────────────────────────── */

describe("entry isolation", () => {
  it("keeps each account's entries to itself", () => {
    insertEntry(db, alice.id, entry("2026-08-01", "alice wrote this", { craft: 5 }));
    insertEntry(db, bob.id, entry("2026-08-01", "bob wrote this", { body: 3 }));

    expect(listEntries(db, alice.id).map((e) => e.text)).toEqual(["alice wrote this"]);
    expect(listEntries(db, bob.id).map((e) => e.text)).toEqual(["bob wrote this"]);
  });

  it("refuses to fetch another account's entry by id", () => {
    const a = insertEntry(db, alice.id, entry("2026-08-01", "private", { craft: 5 }));
    expect(getEntry(db, alice.id, a.id)).not.toBeNull();
    expect(getEntry(db, bob.id, a.id)).toBeNull();
  });

  it("refuses to update another account's entry", () => {
    const a = insertEntry(db, alice.id, entry("2026-08-01", "mine", { craft: 5 }));
    const attempt = updateEntry(db, bob.id, a.id, entry("2026-08-01", "hijacked"));

    expect(attempt).toBeNull();
    expect(getEntry(db, alice.id, a.id)!.text).toBe("mine");
  });

  it("refuses to delete another account's entry", () => {
    const a = insertEntry(db, alice.id, entry("2026-08-01", "mine", { craft: 5 }));
    expect(deleteEntry(db, bob.id, a.id)).toBe(false);
    expect(listEntries(db, alice.id)).toHaveLength(1);
  });
});

/* ── search ─────────────────────────────────────────────────────── */

describe("search isolation", () => {
  // The FTS index is global and keyed on rowid alone; only the join predicate
  // separates accounts. This is the likeliest place for a leak to reappear.
  it("never returns another account's text", () => {
    insertEntry(db, alice.id, entry("2026-08-01", "the pomegranate was ripe"));
    insertEntry(db, bob.id, entry("2026-08-01", "the pomegranate was bitter"));

    const forAlice = searchEntries(db, alice.id, "pomegranate");
    expect(forAlice).toHaveLength(1);
    expect(forAlice[0]!.entry.text).toContain("ripe");

    const forBob = searchEntries(db, bob.id, "pomegranate");
    expect(forBob).toHaveLength(1);
    expect(forBob[0]!.entry.text).toContain("bitter");
  });

  it("returns nothing for an account with no matching entries", () => {
    insertEntry(db, alice.id, entry("2026-08-01", "kayaking on the Danube"));
    expect(searchEntries(db, bob.id, "kayaking")).toHaveLength(0);
  });

  it("still finds an entry after it is edited", () => {
    const a = insertEntry(db, alice.id, entry("2026-08-01", "original wording"));
    updateEntry(db, alice.id, a.id, entry("2026-08-01", "replacement wording"));

    expect(searchEntries(db, alice.id, "replacement")).toHaveLength(1);
    expect(searchEntries(db, alice.id, "original")).toHaveLength(0);
  });
});

/* ── the lexicon ────────────────────────────────────────────────── */

describe("lexicon isolation", () => {
  it("gives every account its own seeded copy", () => {
    const a = listCues(db, alice.id);
    const b = listCues(db, bob.id);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBe(b.length);
    expect(new Set(a.map((c) => c.id)).size).toBe(a.length);
    // Same vocabulary, different rows — otherwise learning would be shared.
    expect(a.some((c) => b.some((o) => o.id === c.id))).toBe(false);
  });

  it("keeps a correction from reweighting anyone else's lexicon", () => {
    const before = listCues(db, bob.id).find((c) => c.track === "craft")!;

    learnFromCorrection(db, alice.id, {
      entryId: null, lang: "en", track: "craft",
      stems: [before.stem], delta: 10,
    });

    const aliceCue = listCues(db, alice.id).find((c) => c.stem === before.stem &&
      c.track === "craft" && c.lang === "en")!;
    const bobCue = listCues(db, bob.id).find((c) => c.id === before.id)!;

    expect(aliceCue.weight).toBeGreaterThan(before.weight);
    expect(bobCue.weight).toBe(before.weight);
  });

  it("scopes cue edits and deletions by owner", () => {
    const cue = listCues(db, alice.id)[0]!;
    expect(deleteCue(db, bob.id, cue.id)).toBe(false);
    expect(deleteCue(db, alice.id, cue.id)).toBe(true);
  });

  it("lets two accounts hold the same stem independently", () => {
    upsertCue(db, alice.id, { lang: "en", track: "craft", stem: "deploy", weight: 5 });
    upsertCue(db, bob.id, { lang: "en", track: "craft", stem: "deploy", weight: 1 });

    const a = listCues(db, alice.id).find((c) => c.stem === "deploy" && c.track === "craft")!;
    const b = listCues(db, bob.id).find((c) => c.stem === "deploy" && c.track === "craft")!;
    expect(a.weight).toBe(5);
    expect(b.weight).toBe(1);
  });
});

/* ── people, quests, alerts, settings, reviews ──────────────────── */

describe("registry isolation", () => {
  it("lets both accounts know a different Marko", () => {
    upsertPerson(db, alice.id, "Marko", "2026-08-01");
    upsertPerson(db, bob.id, "Marko", "2026-08-02");

    expect(listPeople(db, alice.id).map((p) => p.display)).toEqual(["Marko"]);
    expect(listPeople(db, bob.id).map((p) => p.display)).toEqual(["Marko"]);
    expect(listPeople(db, alice.id)[0]!.id).not.toBe(listPeople(db, bob.id)[0]!.id);
  });

  it("scopes person deletion", () => {
    upsertPerson(db, alice.id, "Ana", "2026-08-01");
    const person = listPeople(db, alice.id)[0]!;
    expect(deletePerson(db, bob.id, person.id)).toBe(false);
    expect(listPeople(db, alice.id)).toHaveLength(1);
  });
});

describe("quest isolation", () => {
  it("hides quests from other accounts and refuses cross-account writes", () => {
    const q = insertQuest(db, alice.id, {
      title: "Finish the thesis", tracks: ["study"], targetDate: null, xpTarget: 100,
    });

    expect(listQuests(db, bob.id)).toHaveLength(0);
    expect(updateQuestStatus(db, bob.id, q.id, "abandoned")).toBe(false);
    expect(deleteQuest(db, bob.id, q.id)).toBe(false);
    expect(listQuests(db, alice.id)[0]!.status).toBe("active");
  });

  it("will not link one account's quest to another's entry", () => {
    const q = insertQuest(db, alice.id, {
      title: "Move daily", tracks: ["body"], targetDate: null, xpTarget: null,
    });
    const bobEntry = insertEntry(db, bob.id, entry("2026-08-01", "ran 5k", { body: 6 }));

    linkQuest(db, alice.id, {
      questId: q.id, entryId: bobEntry.id, confidence: 1, evidence: "ran",
    });

    expect(questLinkedEntries(db, alice.id, q.id)).toHaveLength(0);
    expect(questLinksFor(db, bob.id, bobEntry.id)).toHaveLength(0);
  });
});

describe("alert isolation", () => {
  it("scopes listing, dismissal and clearing", () => {
    insertAlert(db, alice.id, { track: "spirit", kind: "decay", peak: 80, current: 20 });
    insertAlert(db, bob.id, { track: "body", kind: "decay", peak: 70, current: 15 });

    expect(listAlerts(db, alice.id).map((a) => a.track)).toEqual(["spirit"]);
    expect(listAlerts(db, bob.id).map((a) => a.track)).toEqual(["body"]);

    const aliceAlert = listAlerts(db, alice.id)[0]!;
    expect(dismissAlert(db, bob.id, aliceAlert.id)).toBe(false);

    clearAlertsFor(db, bob.id, "spirit", "decay");
    expect(listAlerts(db, alice.id)).toHaveLength(1);
  });
});

describe("settings isolation", () => {
  it("keeps each account's half-life and language separate", () => {
    setSettings(db, alice.id, { halfLife: 30, lang: "sr" });
    setSettings(db, bob.id, { halfLife: 7 });

    expect(getSettings(db, alice.id).halfLife).toBe(30);
    expect(getSettings(db, alice.id).lang).toBe("sr");
    expect(getSettings(db, bob.id).halfLife).toBe(7);
    expect(getSettings(db, bob.id).lang).toBe("en");
  });
});

describe("review cache isolation", () => {
  it("does not serve one account's review to another", () => {
    putCachedReview(db, alice.id, "2026-08-03", "hash1", { findings: ["alice"] });
    expect(getCachedReview(db, bob.id, "2026-08-03", "hash1")).toBeNull();
    expect(getCachedReview(db, alice.id, "2026-08-03", "hash1")).toEqual({
      findings: ["alice"],
    });
  });
});

/* ── passwords and sessions ─────────────────────────────────────── */

describe("passwords", () => {
  it("round-trips a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong horse battery", hash)).toBe(false);
  });

  it("treats an empty stored hash as a locked account", async () => {
    // The state a pre-accounts journal is adopted into. An empty password
    // must not satisfy it.
    expect(await verifyPassword("", "")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
  });

  it("rejects a malformed stored hash rather than throwing", async () => {
    expect(await verifyPassword("x", "notascrypthash")).toBe(false);
    expect(await verifyPassword("x", "scrypt$zz$zz")).toBe(false);
  });

  it("salts, so the same password hashes differently each time", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});

describe("sessions", () => {
  it("resolves a live token and ignores an expired one", () => {
    createSession(db, alice.id, "live-token", 30);
    createSession(db, bob.id, "dead-token", -1);

    expect(userForSession(db, "live-token")?.id).toBe(alice.id);
    expect(userForSession(db, "dead-token")).toBeNull();
    expect(userForSession(db, "never-issued")).toBeNull();
  });
});

describe("registration gate", () => {
  const original = process.env.ZAPIS_INVITE_CODE;
  afterEach(() => {
    if (original === undefined) delete process.env.ZAPIS_INVITE_CODE;
    else process.env.ZAPIS_INVITE_CODE = original;
  });

  it("fails closed when no invite code is configured", () => {
    delete process.env.ZAPIS_INVITE_CODE;
    expect(inviteProblem("anything")).toBeTruthy();
    expect(inviteProblem(undefined)).toBeTruthy();
  });

  it("accepts only the configured code", () => {
    process.env.ZAPIS_INVITE_CODE = "let-me-in";
    expect(inviteProblem("let-me-in")).toBeNull();
    expect(inviteProblem("let-me-in-please")).toBeTruthy();
    expect(inviteProblem(undefined)).toBeTruthy();
  });
});

/* ── the leaderboard ────────────────────────────────────────────── */

describe("leaderboard", () => {
  it("ranks by momentum, not by lifetime XP", () => {
    // Alice banked a lot months ago and stopped; Bob has been steady all week.
    // The board is about now, so Bob leads despite less lifetime XP.
    const old = shiftISO(todayISO(), -200);
    insertEntry(db, alice.id, entry(old, "a huge old push", { craft: 25 }));
    insertEntry(db, alice.id, entry(shiftISO(old, 1), "more of it", { craft: 25 }));

    for (let i = 0; i < 5; i++) {
      insertEntry(db, bob.id, entry(shiftISO(todayISO(), -i), "steady work", { craft: 6 }));
    }

    refreshScores(db, alice.id);
    refreshScores(db, bob.id);

    const board = readBoard(db, OVERALL);
    expect(board[0]!.display).toBe("Bob");
    expect(board[0]!.momentum).toBeGreaterThan(board[1]!.momentum);
    expect(board[1]!.lifetime).toBeGreaterThan(board[0]!.lifetime);
  });

  it("exposes numbers only — no field carries prose", () => {
    insertEntry(db, alice.id, entry(todayISO(), "a sentence nobody else should see", {
      craft: 8,
    }));
    refreshScores(db, alice.id);

    const row = readBoard(db, OVERALL).find((r) => r.userId === alice.id)!;
    expect(Object.keys(row).sort()).toEqual([
      "display", "entryCount", "level", "lifetime", "momentum",
      "streak", "track", "updatedAt", "userId",
    ]);
    expect(JSON.stringify(row)).not.toContain("sentence");
  });

  it("omits accounts that opted out", () => {
    insertEntry(db, alice.id, entry(todayISO(), "work", { craft: 8 }));
    insertEntry(db, bob.id, entry(todayISO(), "work", { craft: 8 }));
    refreshScores(db, alice.id);
    refreshScores(db, bob.id);

    expect(readBoard(db, OVERALL)).toHaveLength(2);

    setShareScores(db, bob.id, false);
    const board = readBoard(db, OVERALL);
    expect(board).toHaveLength(1);
    expect(board[0]!.display).toBe("Alice");
  });

  it("still shows an opted-out account its own numbers", () => {
    insertEntry(db, alice.id, entry(todayISO(), "work", { craft: 8 }));
    refreshScores(db, alice.id);
    setShareScores(db, alice.id, false);

    // Hidden from everyone else...
    expect(readBoard(db, OVERALL).find((r) => r.userId === alice.id)).toBeUndefined();
    // ...but not from herself.
    const own = readOwnScore(db, alice.id, OVERALL);
    expect(own).not.toBeNull();
    expect(own!.lifetime).toBe(8);
  });

  it("averages the seven tracks so breadth beats a single spike", () => {
    // One maxed track against moderate scores across all seven.
    insertEntry(db, alice.id, entry(todayISO(), "only craft", { craft: 25 }));
    const spread: Partial<Awards> = {
      craft: 6, study: 6, body: 6, bonds: 6, creation: 6, spirit: 6, play: 6,
    };
    insertEntry(db, bob.id, entry(todayISO(), "a bit of everything", spread));

    refreshScores(db, alice.id);
    refreshScores(db, bob.id);

    const board = readBoard(db, OVERALL);
    expect(board[0]!.display).toBe("Bob");
  });

  it("gives a brand-new account a row at zero rather than no row", () => {
    refreshScores(db, alice.id);
    const row = readBoard(db, OVERALL).find((r) => r.userId === alice.id);
    expect(row).toBeDefined();
    expect(row!.momentum).toBe(0);
    expect(row!.entryCount).toBe(0);
  });

  it("keeps a per-track board that agrees with the account's own stats", () => {
    insertEntry(db, alice.id, entry(todayISO(), "ran far", { body: 10 }));
    refreshScores(db, alice.id);

    const body = readBoard(db, "body").find((r) => r.userId === alice.id)!;
    expect(body.lifetime).toBe(10);
    expect(readBoard(db, "study").find((r) => r.userId === alice.id)!.lifetime).toBe(0);
  });
});

/* ── the legacy migration ───────────────────────────────────────── */

describe("adopting a pre-accounts journal", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "zapis-migrate-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Write a v2 database the way the old single-user code would have left it,
   * then hand the path back so openDb can run v3 over it for real. Replaying
   * the shipped migrations beats hand-writing the old schema: if migration 1
   * or 2 is ever edited, this notices.
   */
  function writeLegacyDb(seed: (raw: Database.Database) => void): string {
    const path = join(dir, "legacy.db");
    const raw = new Database(path);
    raw.pragma("foreign_keys = OFF");
    raw.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);
    for (const m of MIGRATIONS.filter((x) => x.version <= 2)) {
      raw.exec(m.sql);
      raw.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(m.version);
    }
    seed(raw);
    raw.close();
    return path;
  }

  it("moves an existing journal onto a locked user 1", async () => {
    const path = writeLegacyDb((raw) => {
      raw.prepare(
        `INSERT INTO entries (id, date, text, lang, note, created_at)
         VALUES (1, '2026-01-01', 'the old journal', 'en', '', '2026-01-01T00:00:00Z')`,
      ).run();
      raw.prepare(
        `INSERT INTO entry_awards (entry_id, track, xp, auto_xp)
         VALUES (1, 'craft', 12, 12)`,
      ).run();
      raw.prepare(`INSERT INTO settings (key, value) VALUES ('halfLife', '21')`).run();
      raw.prepare(
        `INSERT INTO people (canonical, display, aliases, first_seen, last_seen)
         VALUES ('ana', 'Ana', '[]', '2026-01-01', '2026-01-01')`,
      ).run();
    });

    const migrated = openDb(path);
    const owner = findUserByHandle(migrated, "me")!;

    expect(owner).not.toBeNull();
    expect(owner.id).toBe(1);

    // Locked, not password-less: nothing may authenticate as the adopted owner
    // until someone sets a password deliberately.
    expect(owner.passwordHash).toBe("");
    expect(await verifyPassword("", owner.passwordHash)).toBe(false);

    const entries = listEntries(migrated, owner.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe("the old journal");
    expect(entries[0]!.awards.craft).toBe(12);

    expect(getSettings(migrated, owner.id).halfLife).toBe(21);
    expect(listPeople(migrated, owner.id).map((p) => p.display)).toEqual(["Ana"]);
  });

  it("rebuilds the search index over the adopted entries", () => {
    const path = writeLegacyDb((raw) => {
      raw.prepare(
        `INSERT INTO entries (id, date, text, lang, note, created_at)
         VALUES (1, '2026-01-01', 'kayaking on the Danube', 'en', '', '2026-01-01T00:00:00Z')`,
      ).run();
    });

    const migrated = openDb(path);
    // The entries table was dropped and rebuilt underneath an external-content
    // FTS index; without the explicit rebuild this returns nothing.
    expect(searchEntries(migrated, 1, "kayaking")).toHaveLength(1);
  });

  it("leaves a never-used database with no accounts at all", () => {
    const fresh = openDb(":memory:");
    const users = fresh.prepare(`SELECT COUNT(*) n FROM users`).get() as { n: number };
    expect(users.n).toBe(0);
  });
});
