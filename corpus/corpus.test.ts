import { describe, expect, it } from "vitest";
import { CORPUS } from "./entries.ts";
import { buildCueTable, extract } from "../src/domain/extract/index.ts";
import { TRACK_KEYS } from "../src/domain/tracks.ts";

/**
 * The regression suite for the extraction engine.
 *
 * Every case asserts a range, so tuning the lexicon is safe: the tests fail
 * when behaviour breaks, not when a number moves by one.
 */
describe("golden corpus", () => {
  const table = buildCueTable();

  for (const c of CORPUS) {
    it(c.name, () => {
      const d = extract(c.text, { cueTable: table, fallbackLang: c.lang });

      // Expected tracks land in range; unlisted tracks must be exactly zero.
      for (const track of TRACK_KEYS) {
        const band = c.expect[track];
        const xp = d.awards[track];
        if (band) {
          expect(xp, `${track} expected ${band[0]}…${band[1]}, got ${xp}`)
            .toBeGreaterThanOrEqual(band[0]);
          expect(xp, `${track} expected ${band[0]}…${band[1]}, got ${xp}`)
            .toBeLessThanOrEqual(band[1]);
        } else {
          expect(xp, `${track} should not have scored`).toBe(0);
        }
      }

      if (c.mood === null) {
        expect(d.mood, "mood should be unreadable").toBeNull();
      } else if (c.mood) {
        expect(d.mood, "mood should be readable").not.toBeNull();
        expect(d.mood!).toBeGreaterThanOrEqual(c.mood[0]);
        expect(d.mood!).toBeLessThanOrEqual(c.mood[1]);
      }

      if (c.energy === null) {
        expect(d.energy).toBeNull();
      } else if (c.energy) {
        expect(d.energy, "energy should be readable").not.toBeNull();
        expect(d.energy!).toBeGreaterThanOrEqual(c.energy[0]);
        expect(d.energy!).toBeLessThanOrEqual(c.energy[1]);
      }

      for (const kind of c.metrics ?? []) {
        expect(
          d.metrics.map((m) => m.kind),
          `expected a ${kind} metric`,
        ).toContain(kind);
      }

      for (const name of c.candidates?.some ?? []) {
        expect(d.personCandidates, `${name} should be offered`).toContain(name);
      }
      for (const name of c.candidates?.none ?? []) {
        expect(d.personCandidates, `${name} must not be offered`).not.toContain(name);
      }
    });
  }

  it("is deterministic", () => {
    for (const c of CORPUS.slice(0, 6)) {
      const a = extract(c.text, { cueTable: table, fallbackLang: c.lang });
      const b = extract(c.text, { cueTable: table, fallbackLang: c.lang });
      expect(a).toEqual(b);
    }
  });

  it("never exceeds the per-track ceiling", () => {
    const wall = "Deployed to production and shipped the release. ".repeat(60);
    const d = extract(wall, { cueTable: table, fallbackLang: "en" });
    expect(d.awards.craft).toBeLessThanOrEqual(25);
  });

  it("cannot be farmed by repeating the same word", () => {
    const once = extract("Coded.", { cueTable: table, fallbackLang: "en" });
    const many = extract("Coded coded coded coded coded coded coded coded.", {
      cueTable: table,
      fallbackLang: "en",
    });
    // Repeats count, but with diminishing returns — nowhere near 8x.
    expect(many.awards.craft).toBeGreaterThanOrEqual(once.awards.craft);
    expect(many.awards.craft).toBeLessThan(once.awards.craft * 4);
  });

  it("handles empty and whitespace input without throwing", () => {
    for (const text of ["", "   ", "\n\n", "?!", "…"]) {
      const d = extract(text, { cueTable: table, fallbackLang: "en" });
      expect(d.awards.craft).toBe(0);
      expect(d.events).toEqual([]);
    }
  });
});
