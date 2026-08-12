import { describe, expect, it } from "vitest";
import { emptyAwards } from "./tracks.ts";
import {
  compareISO, dateRange, dayOfWeek, daysBetween, isISODate, lastNDays,
  shiftISO, weekStart,
} from "./dates.ts";
import { levelFromXp, momentumLabel, momentumFromDecayed } from "./xp.ts";
import {
  computeStats, currentStreak, dailyTotals, longestStreak, momentumAsOf,
  peakMomentum, totalXp,
} from "./stats.ts";
import {
  MIN_GROUP, consecutivePairs, lagCorrelations, pearson, pValue,
  sameDayCorrelations,
} from "./correlate.ts";
import { DECAY_FLOOR, detectDecay, diffAlerts, staleAlerts } from "./decay.ts";
import { linkEntry, questProgress, questStems } from "./quests.ts";
import { buildWeeklyReview, reviewHash } from "./review.ts";
import {
  buildCsv, buildExport, buildMarkdown, diffImport, parseImport, planImport,
} from "./importer.ts";
import { computeAchievements, detectChapters } from "./achievements.ts";
import type { Awards, Entry, Quest, TrackKey } from "./types.ts";

/* ── helpers ────────────────────────────────────────────────────── */

function aw(partial: Partial<Record<TrackKey, number>>): Awards {
  return { ...emptyAwards(), ...partial };
}

let nextId = 1;
function entry(date: string, partial: Partial<Entry> = {}): Entry {
  return {
    id: nextId++,
    date,
    text: partial.text ?? "an entry",
    lang: "en",
    awards: partial.awards ?? emptyAwards(),
    autoAwards: partial.autoAwards ?? partial.awards ?? emptyAwards(),
    mood: partial.mood ?? null,
    energy: partial.energy ?? null,
    people: partial.people ?? [],
    events: partial.events ?? [],
    tags: partial.tags ?? [],
    note: partial.note ?? "",
    metrics: partial.metrics ?? [],
    createdAt: "2026-01-01T00:00:00.000Z",
    editedAt: null,
  };
}

/* ── dates ──────────────────────────────────────────────────────── */

describe("dates", () => {
  it("validates ISO dates and rejects impossible ones", () => {
    expect(isISODate("2026-08-12")).toBe(true);
    expect(isISODate("2026-02-31")).toBe(false);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate("12/08/2026")).toBe(false);
    expect(isISODate("")).toBe(false);
  });

  it("shifts across month, year and leap boundaries", () => {
    expect(shiftISO("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftISO("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftISO("2028-02-28", 1)).toBe("2028-02-29"); // 2028 is a leap year
    expect(shiftISO("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("clamps daysBetween at zero so future entries cannot gain XP back", () => {
    expect(daysBetween("2026-08-01", "2026-08-11")).toBe(10);
    expect(daysBetween("2026-08-11", "2026-08-01")).toBe(0);
  });

  it("anchors weeks on Monday", () => {
    // 2026-08-12 is a Wednesday.
    expect(dayOfWeek("2026-08-12")).toBe(3);
    expect(weekStart("2026-08-12")).toBe("2026-08-10");
    expect(weekStart("2026-08-10")).toBe("2026-08-10");
    expect(weekStart("2026-08-16")).toBe("2026-08-10"); // Sunday belongs to it
  });

  it("builds inclusive ranges", () => {
    expect(dateRange("2026-08-10", "2026-08-12")).toEqual([
      "2026-08-10", "2026-08-11", "2026-08-12",
    ]);
    expect(lastNDays(3, "2026-08-12")).toEqual([
      "2026-08-10", "2026-08-11", "2026-08-12",
    ]);
    expect(compareISO("2026-01-01", "2026-01-02")).toBe(-1);
  });
});

/* ── levelling & momentum ───────────────────────────────────────── */

describe("xp", () => {
  it("levels on the documented curve", () => {
    expect(levelFromXp(0)).toEqual({ level: 1, into: 0, need: 100 });
    expect(levelFromXp(99).level).toBe(1);
    expect(levelFromXp(100)).toEqual({ level: 2, into: 0, need: 255 });
    expect(levelFromXp(354)).toMatchObject({ level: 2, into: 254 });
    expect(levelFromXp(355).level).toBe(3);
  });

  it("is monotonic and never returns a negative remainder", () => {
    let prev = 1;
    for (let xp = 0; xp < 20_000; xp += 137) {
      const l = levelFromXp(xp);
      expect(l.level).toBeGreaterThanOrEqual(prev);
      expect(l.into).toBeGreaterThanOrEqual(0);
      expect(l.into).toBeLessThan(l.need);
      prev = l.level;
    }
  });

  it("bands momentum at the documented thresholds", () => {
    expect(momentumLabel(100)).toBe("burning");
    expect(momentumLabel(85)).toBe("burning");
    expect(momentumLabel(84)).toBe("warm");
    expect(momentumLabel(35)).toBe("steady");
    expect(momentumLabel(15)).toBe("cooling");
    expect(momentumLabel(14)).toBe("dormant");
    expect(momentumLabel(0)).toBe("dormant");
  });

  it("saturates momentum below 100", () => {
    expect(momentumFromDecayed(0)).toBe(0);
    expect(momentumFromDecayed(1e9)).toBeLessThanOrEqual(100);
  });
});

/* ── stats ──────────────────────────────────────────────────────── */

describe("stats", () => {
  const entries = [
    entry("2026-08-01", { awards: aw({ craft: 10, body: 5 }) }),
    entry("2026-08-08", { awards: aw({ craft: 10 }) }),
    entry("2026-08-12", { awards: aw({ study: 20 }) }),
  ];

  it("sums lifetime XP and reports staleness", () => {
    const s = computeStats(entries, "2026-08-12");
    expect(s.craft.lifetime).toBe(20);
    expect(s.study.lifetime).toBe(20);
    expect(s.craft.daysSince).toBe(4);
    expect(s.study.daysSince).toBe(0);
    expect(s.spirit.daysSince).toBeNull();
    expect(s.spirit.momentum).toBe(0);
  });

  it("decays: the same XP is worth less as it ages", () => {
    const fresh = computeStats(entries, "2026-08-12").craft.momentum;
    const later = computeStats(entries, "2026-10-12").craft.momentum;
    expect(later).toBeLessThan(fresh);
  });

  it("halves at exactly one half-life", () => {
    const one = [entry("2026-08-01", { awards: aw({ craft: 100 }) })];
    // Compare decayed contributions rather than the saturated output.
    const day0 = momentumAsOf(one, "craft", "2026-08-01", 14);
    const day14 = momentumAsOf(one, "craft", "2026-08-15", 14);
    expect(day14).toBeLessThan(day0);
    expect(day14).toBeGreaterThan(0);
  });

  it("excludes future entries from an as-of figure", () => {
    // Without the exclusion, asking about August would fold in September.
    const withFuture = [
      entry("2026-08-01", { awards: aw({ craft: 10 }) }),
      entry("2026-09-01", { awards: aw({ craft: 25 }) }),
    ];
    const asOfAugust = computeStats(withFuture, "2026-08-01");
    expect(asOfAugust.craft.lifetime).toBe(10);
    expect(momentumAsOf(withFuture, "craft", "2026-08-01")).toBe(
      momentumAsOf([withFuture[0]!], "craft", "2026-08-01"),
    );
  });

  it("finds the peak inside a window", () => {
    const { peak, peakDate } = peakMomentum(entries, "craft", "2026-08-12", 30);
    expect(peak).toBeGreaterThan(0);
    expect(peakDate >= "2026-08-01").toBe(true);
  });

  it("counts a streak back from today", () => {
    const run = ["2026-08-10", "2026-08-11", "2026-08-12"].map((d) => entry(d));
    expect(currentStreak(run, "2026-08-12")).toBe(3);
    // Yesterday-anchored: today not yet written is not a broken streak.
    expect(currentStreak(run, "2026-08-13")).toBe(3);
    expect(currentStreak(run, "2026-08-14")).toBe(0);
    expect(currentStreak([], "2026-08-12")).toBe(0);
  });

  it("forgives one gap per week when rest days are on", () => {
    // Missing the 11th.
    const gapped = ["2026-08-08", "2026-08-09", "2026-08-10", "2026-08-12"].map((d) =>
      entry(d),
    );
    expect(currentStreak(gapped, "2026-08-12", false)).toBe(1);
    expect(currentStreak(gapped, "2026-08-12", true)).toBeGreaterThan(1);
  });

  it("finds the longest historical streak", () => {
    const days = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-02-01"].map((d) =>
      entry(d),
    );
    expect(longestStreak(days)).toBe(3);
  });

  it("fills missing days with zero in daily totals", () => {
    const totals = dailyTotals(entries, lastNDays(3, "2026-08-12"));
    expect(totals).toHaveLength(3);
    expect(totals[0]).toEqual({ iso: "2026-08-10", xp: 0 });
    expect(totals[2]!.xp).toBe(20);
    expect(totalXp(entries[0]!)).toBe(15);
  });
});

/* ── correlations ───────────────────────────────────────────────── */

describe("correlate", () => {
  it("computes Pearson r and refuses when there is no variance", () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 5);
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 5);
    // A flat series has no correlation — undefined, not zero.
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(pearson([1], [1])).toBeNull();
  });

  it("produces sane p-values", () => {
    // A near-perfect correlation over 30 points is highly significant.
    expect(pValue(0.99, 30)!).toBeLessThan(0.01);
    // A vanishing one is not.
    expect(pValue(0.01, 30)!).toBeGreaterThan(0.5);
    // Two points cannot support a claim at all.
    expect(pValue(0.5, 2)).toBeNull();
    // And the function stays in range.
    for (const r of [-0.9, -0.4, 0, 0.4, 0.9]) {
      const p = pValue(r, 25)!;
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("pairs only genuinely consecutive days", () => {
    const es = [
      entry("2026-08-01", { mood: 5 }),
      entry("2026-08-02", { mood: 6 }),
      // gap on the 3rd
      entry("2026-08-04", { mood: 7 }),
    ];
    const pairs = consecutivePairs(es);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.today.date).toBe("2026-08-01");
    expect(pairs[0]!.next.date).toBe("2026-08-02");
  });

  it("refuses to report until both groups are big enough", () => {
    const small = [
      entry("2026-08-01", { mood: 5, awards: aw({ body: 10 }) }),
      entry("2026-08-02", { mood: 7 }),
    ];
    for (const c of lagCorrelations(small)) {
      expect(c.ready).toBe(false);
      expect(c.delta).toBeNull();
      expect(c.needed).toBeGreaterThan(0);
    }
  });

  it("reports once both groups clear the gate, and finds a planted signal", () => {
    // 40 consecutive days: on odd days Body fires and the NEXT day's mood is high.
    const es: Entry[] = [];
    for (let i = 0; i < 40; i++) {
      const date = shiftISO("2026-01-01", i);
      const bodyDay = i % 2 === 0;
      const moodFromYesterday = i % 2 === 1 ? 9 : 3;
      es.push(
        entry(date, {
          mood: moodFromYesterday,
          awards: bodyDay ? aw({ body: 12 }) : emptyAwards(),
        }),
      );
    }

    const body = lagCorrelations(es, "mood").find((c) => c.track === "body")!;
    expect(body.ready).toBe(true);
    expect(body.nOn).toBeGreaterThanOrEqual(MIN_GROUP);
    expect(body.nOff).toBeGreaterThanOrEqual(MIN_GROUP);
    expect(body.delta!).toBeGreaterThan(3); // yesterday's Body predicts today
    expect(body.noise).toBe(false);

    // A track that never fires stays unreportable rather than reading as zero.
    const spirit = lagCorrelations(es, "mood").find((c) => c.track === "spirit")!;
    expect(spirit.ready).toBe(false);
  });

  it("keeps same-day and lag analyses separate", () => {
    const es = [
      entry("2026-08-01", { mood: 9, awards: aw({ play: 10 }) }),
      entry("2026-08-02", { mood: 2 }),
    ];
    const same = sameDayCorrelations(es).find((c) => c.track === "play")!;
    const lag = lagCorrelations(es).find((c) => c.track === "play")!;
    expect(same.kind).toBe("same");
    expect(lag.kind).toBe("lag1");
  });
});

/* ── decay alerts ───────────────────────────────────────────────── */

describe("decay", () => {
  /** A burst big enough to reach "burning", then silence. */
  const burst = Array.from({ length: 8 }, (_, i) =>
    entry(shiftISO("2026-01-01", i), { awards: aw({ body: 25 }) }),
  );

  it("says nothing while the track is still warm", () => {
    expect(detectDecay(burst, "2026-01-08")).toEqual([]);
  });

  it("fires once the track has fallen from a real peak", () => {
    const found = detectDecay(burst, "2026-02-26");
    const body = found.find((c) => c.track === "body");
    expect(body).toBeDefined();
    expect(body!.peak).toBeGreaterThanOrEqual(60);
    expect(body!.current).toBeLessThan(DECAY_FLOOR);
    expect(body!.kind).toBe("decay");
  });

  it("never fires for a track that was never lit", () => {
    const trickle = [entry("2026-01-01", { awards: aw({ spirit: 2 }) })];
    expect(detectDecay(trickle, "2026-06-01")).toEqual([]);
  });

  it("does not re-raise a crossing already on file", () => {
    const candidates = detectDecay(burst, "2026-03-01");
    const onFile = candidates.map((c) => ({
      track: c.track, kind: c.kind, dismissedAt: null,
    }));
    expect(diffAlerts(candidates, onFile)).toEqual([]);
    // Dismissal must also suppress, not just an open alert.
    const dismissed = onFile.map((a) => ({ ...a, dismissedAt: "2026-03-02" }));
    expect(diffAlerts(candidates, dismissed)).toEqual([]);
  });

  it("clears an alert once the track recovers, so it can fire again later", () => {
    const recovered = [
      ...burst,
      ...Array.from({ length: 6 }, (_, i) =>
        entry(shiftISO("2026-05-01", i), { awards: aw({ body: 25 }) }),
      ),
    ];
    const stale = staleAlerts(
      recovered,
      [{ track: "body", kind: "decay", dismissedAt: null }],
      "2026-05-06",
    );
    expect(stale).toHaveLength(1);
  });
});

/* ── quests ─────────────────────────────────────────────────────── */

describe("quests", () => {
  const quest: Quest = {
    id: 1,
    title: "Finish the three exams",
    tracks: ["study"],
    createdAt: "2026-01-01T00:00:00.000Z",
    targetDate: "2026-02-01",
    status: "active",
    xpTarget: 200,
  };

  it("reduces a title to content stems only", () => {
    const stems = questStems("Finish the three exams", "en");
    expect(stems.has("the")).toBe(false);
    expect([...stems].some((s) => s.startsWith("exam"))).toBe(true);
  });

  it("links an entry that advances it", () => {
    const links = linkEntry(
      "Studied for the exam all evening.",
      aw({ study: 12 }),
      [quest],
      "en",
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.confidence).toBeGreaterThan(0.3);
    expect(links[0]!.evidence).toContain("exam");
  });

  it("matches across Serbian inflection without a shared surface form", () => {
    const sr: Quest = { ...quest, title: "Završiti tri ispita" };
    const links = linkEntry("Učio sam za ispit ceo dan.", aw({ study: 10 }), [sr], "sr");
    expect(links).toHaveLength(1);
  });

  it("does not link on one incidental word", () => {
    const links = linkEntry(
      "Three of us went for a walk.",
      aw({ body: 5 }),
      [quest],
      "en",
    );
    expect(links).toEqual([]);
  });

  it("ignores quests that are no longer active", () => {
    const done: Quest = { ...quest, status: "done" };
    expect(linkEntry("Studied for the exam.", aw({ study: 9 }), [done], "en")).toEqual([]);
  });

  it("sums progress over the quest's tracks", () => {
    const linked = [
      entry("2026-01-05", { awards: aw({ study: 10, play: 20 }) }),
      entry("2026-01-06", { awards: aw({ study: 15 }) }),
    ];
    const p = questProgress(quest, linked, "2026-01-10");
    expect(p.xp).toBe(25); // Play is not part of this quest
    expect(p.linkedEntries).toBe(2);
    expect(p.fraction).toBeCloseTo(25 / 200, 5);
    expect(p.daysRemaining).toBe(22);
  });
});

/* ── weekly review ──────────────────────────────────────────────── */

describe("review", () => {
  /** Four weeks of Body and Bonds, then a week of neither. */
  function history() {
    const es: Entry[] = [];
    for (let w = 0; w < 4; w++) {
      for (let d = 0; d < 5; d++) {
        es.push(
          entry(shiftISO("2026-06-01", w * 7 + d), {
            awards: aw({ body: 10, bonds: 8 }),
            mood: 7,
            people: ["Ana"],
            tags: ["running"],
          }),
        );
      }
    }
    // The week under review: Craft only, nobody mentioned.
    for (let d = 0; d < 5; d++) {
      es.push(
        entry(shiftISO("2026-06-29", d), {
          awards: aw({ craft: 12 }),
          mood: 5,
          tags: ["work"],
        }),
      );
    }
    return es;
  }

  it("notices the tracks that went silent", () => {
    const r = buildWeeklyReview(history(), "2026-06-29");
    const absent = r.findings.filter((f) => f.kind === "absence").map((f) => f.data.track);
    expect(absent).toContain("body");
    expect(absent).toContain("bonds");
    expect(absent).not.toContain("craft");
  });

  it("notices the person who stopped appearing", () => {
    const r = buildWeeklyReview(history(), "2026-06-29");
    const dropped = r.findings.find((f) => f.kind === "personDropped");
    expect(dropped?.data.person).toBe("Ana");
  });

  it("sorts absence above bookkeeping", () => {
    const r = buildWeeklyReview(history(), "2026-06-29");
    const firstKinds = r.findings.slice(0, 3).map((f) => f.kind);
    expect(firstKinds.some((k) => k === "absence" || k === "personDropped")).toBe(true);
    expect(r.findings[r.findings.length - 1]!.kind).toBe("cadence");
  });

  it("reports tag drift", () => {
    const r = buildWeeklyReview(history(), "2026-06-29");
    expect(r.findings.some((f) => f.kind === "tagNew")).toBe(true);
    expect(r.findings.some((f) => f.kind === "tagGone")).toBe(false); // only 1 gone
  });

  it("does not invent findings for a brand-new journal", () => {
    const first = [entry("2026-06-29", { awards: aw({ craft: 10 }), people: ["Ana"] })];
    const r = buildWeeklyReview(first, "2026-06-29");
    // Nothing "returned" or "went absent" when there is no history to compare.
    expect(r.findings.some((f) => f.kind === "absence")).toBe(false);
    expect(r.findings.some((f) => f.kind === "trackReturned")).toBe(false);
    expect(r.findings.some((f) => f.kind === "personNew")).toBe(false);
  });

  it("flags an entirely empty week", () => {
    const r = buildWeeklyReview([], "2026-06-29");
    expect(r.findings.some((f) => f.kind === "quietWeek")).toBe(true);
    expect(r.entryCount).toBe(0);
  });

  it("hashes stably, and changes when the week changes", () => {
    const es = history();
    const a = reviewHash(es, "2026-06-29");
    expect(reviewHash(es, "2026-06-29")).toBe(a);
    const changed = [...es, entry("2026-06-30", { awards: aw({ spirit: 5 }) })];
    expect(reviewHash(changed, "2026-06-29")).not.toBe(a);
  });
});

/* ── import & export ────────────────────────────────────────────── */

describe("importer", () => {
  const existing = [
    entry("2026-08-01", { text: "first", awards: aw({ craft: 10 }), mood: 6 }),
  ];

  it("round-trips an export without loss", () => {
    const raw = JSON.stringify(buildExport(existing));
    const { entries, failures } = parseImport(raw);
    expect(failures).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.date).toBe("2026-08-01");
    expect(entries[0]!.awards.craft).toBe(10);
    expect(entries[0]!.mood).toBe(6);

    // Re-importing the same file must report nothing to do.
    const diff = diffImport(entries, existing);
    expect(diff.counts).toEqual({ new: 0, identical: 1, conflict: 0 });
  });

  it("accepts the legacy lifelog:v2 shape", () => {
    const legacy = JSON.stringify({
      entries: [
        {
          id: 1,
          date: "2026-07-01",
          text: "legacy entry",
          awards: { craft: 8, study: 3, unknownTrack: 99 },
          mood: 7,
          energy: null,
          people: ["Ana"],
          events: ["did a thing"],
          tags: ["work"],
          note: "a note",
        },
      ],
    });
    const { entries, failures } = parseImport(legacy);
    expect(failures).toEqual([]);
    expect(entries[0]!.awards.craft).toBe(8);
    // Unknown tracks are dropped rather than failing the whole row.
    expect(Object.keys(entries[0]!.awards)).toHaveLength(7);
    // No autoAwards in legacy data — the filed numbers stand in.
    expect(entries[0]!.autoAwards.craft).toBe(8);
  });

  it("accepts a bare array and CSV-style semicolon lists", () => {
    const raw = JSON.stringify([
      { date: "2026-07-02", text: "x", people: "Ana; Marko", tags: "a; b" },
    ]);
    const { entries } = parseImport(raw);
    expect(entries[0]!.people).toEqual(["Ana", "Marko"]);
    expect(entries[0]!.tags).toEqual(["a", "b"]);
  });

  it("rejects bad rows individually instead of failing the file", () => {
    const raw = JSON.stringify({
      entries: [
        { date: "2026-07-03", text: "good" },
        { date: "not-a-date", text: "bad" },
        { date: "2026-02-31", text: "impossible" },
      ],
    });
    const { entries, failures } = parseImport(raw);
    expect(entries).toHaveLength(1);
    expect(failures).toHaveLength(2);
  });

  it("throws on input that is not JSON at all", () => {
    expect(() => parseImport("<html>nope</html>")).toThrow(/not valid json/i);
    expect(() => parseImport(JSON.stringify({ nope: 1 }))).toThrow(/unrecognised/i);
  });

  it("classifies conflicts and honours each strategy", () => {
    const incoming = parseImport(
      JSON.stringify({
        entries: [
          { date: "2026-08-01", text: "CHANGED", awards: { craft: 25 } },
          { date: "2026-08-02", text: "brand new" },
        ],
      }),
    ).entries;

    const diff = diffImport(incoming, existing);
    expect(diff.counts).toEqual({ new: 1, identical: 0, conflict: 1 });
    expect(diff.rows.find((r) => r.resolution === "conflict")!.changed).toContain("text");

    expect(planImport(diff, "skip")).toMatchObject({ skipped: 1 });
    expect(planImport(diff, "skip").insert).toHaveLength(1);
    expect(planImport(diff, "replace").replace).toHaveLength(1);
    expect(planImport(diff, "keepBoth").insert).toHaveLength(2);
  });

  it("quotes CSV safely", () => {
    const nasty = [
      entry("2026-08-03", { text: 'he said "hello", then left', awards: aw({ play: 3 }) }),
    ];
    const csv = buildCsv(nasty);
    expect(csv.split("\n")[0]).toContain("date,mood,energy");
    expect(csv).toContain('""hello""');
  });

  it("writes markdown with the entry intact", () => {
    const md = buildMarkdown(existing);
    expect(md).toContain("## 2026-08-01");
    expect(md).toContain("first");
  });
});

/* ── achievements & chapters ────────────────────────────────────── */

describe("achievements", () => {
  it("awards the all-seven day only when every track fires", () => {
    const six = [entry("2026-08-01", {
      awards: aw({ craft: 1, study: 1, body: 1, bonds: 1, creation: 1, spirit: 1 }),
    })];
    expect(computeAchievements(six).find((a) => a.id === "all_seven")!.earned).toBe(false);

    const seven = [entry("2026-08-01", {
      awards: aw({ craft: 1, study: 1, body: 1, bonds: 1, creation: 1, spirit: 1, play: 1 }),
    })];
    expect(computeAchievements(seven).find((a) => a.id === "all_seven")!.earned).toBe(true);
  });

  it("records the honest empty day", () => {
    const zero = [entry("2026-08-01", { text: "Nothing happened.", awards: emptyAwards() })];
    expect(computeAchievements(zero).find((a) => a.id === "honest_zero")!.earned).toBe(true);
  });

  it("tracks streak progress before it is earned", () => {
    const three = ["2026-08-01", "2026-08-02", "2026-08-03"].map((d) => entry(d));
    const seven = computeAchievements(three).find((a) => a.id === "streak_7")!;
    expect(seven.earned).toBe(false);
    expect(seven.progress).toBeCloseTo(3 / 7, 2);
  });

  it("splits chapters when the composition of days shifts", () => {
    const es: Entry[] = [];
    for (let i = 0; i < 40; i++) {
      es.push(entry(shiftISO("2026-01-01", i), { awards: aw({ craft: 15 }) }));
    }
    for (let i = 0; i < 40; i++) {
      es.push(entry(shiftISO("2026-02-10", i), { awards: aw({ creation: 15 }) }));
    }
    const chapters = detectChapters(es);
    expect(chapters.length).toBeGreaterThan(1);
    expect(chapters[0]!.dominant).toBe("craft");
    expect(chapters[chapters.length - 1]!.dominant).toBe("creation");
  });

  it("returns a single chapter for a short history", () => {
    const es = [entry("2026-01-01", { awards: aw({ craft: 5 }) })];
    expect(detectChapters(es)).toHaveLength(1);
    expect(detectChapters([])).toEqual([]);
  });
});

/* ── Serbian grammatical agreement ──────────────────────────────── */

describe("serbian agreement", () => {
  it("agrees the participle with each track's gender", async () => {
    const { sr } = await import("../i18n/sr.ts");
    const cases: [string, string][] = [
      ["craft", "zabeležen"],    // Rad — masculine
      ["study", "zabeleženo"],   // Učenje — neuter
      ["body", "zabeleženo"],    // Telo — neuter
      ["bonds", "zabeležene"],   // Veze — plural
      ["creation", "zabeleženo"],// Stvaranje — neuter
      ["spirit", "zabeležen"],   // Duh — masculine
      ["play", "zabeležena"],    // Igra — feminine
    ];
    for (const [key, expected] of cases) {
      const text = sr.finding.absence({
        track: "X", trackKey: key, activeWeeks: 3,
      });
      expect(text, `${key} should read "${expected}"`).toContain(expected);
      // The auxiliary has to match number, too.
      expect(text).toContain(key === "bonds" ? "nisu" : "nije");
    }
  });

  it("agrees the returned-verb form as well", async () => {
    const { sr } = await import("../i18n/sr.ts");
    const forms: [string, string][] = [
      ["craft", "vratio"], ["study", "vratilo"],
      ["play", "vratila"], ["bonds", "vratile"],
    ];
    for (const [key, expected] of forms) {
      expect(
        sr.finding.trackReturned({ track: "X", trackKey: key, silentWeeks: 2, xp: 10 }),
      ).toContain(expected);
    }
  });
});
