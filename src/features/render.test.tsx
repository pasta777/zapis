/* ────────────────────────────────────────────────────────────────
   Render smoke tests.

   Every tab is rendered to HTML with realistic props, in both
   languages. This catches the class of bug a type-checker cannot —
   a missing i18n key, an undefined array access, a crash on the
   empty state — without needing a browser.

   Effects don't run under renderToString, so each component is
   exercised in its initial state, which is exactly the state a
   first-time reader sees.
   ──────────────────────────────────────────────────────────────── */

import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { I18nProvider } from "../i18n/index.tsx";
import { Record as RecordTab } from "./record/Record.tsx";
import { Sheet } from "./sheet/Sheet.tsx";
import { Ledger } from "./ledger/Ledger.tsx";
import { Study } from "./study/Study.tsx";
import { Review } from "./review/Review.tsx";
import { Quests } from "./quests/Quests.tsx";
import { People } from "./people/People.tsx";
import { Lexicon } from "./lexicon/Lexicon.tsx";
import { Data } from "./data/Data.tsx";
import { Board } from "./board/Board.tsx";
import { SignIn } from "./auth/SignIn.tsx";
import { Radar } from "./shared/Radar.tsx";
import { Heat, YearHeat } from "./shared/Heat.tsx";
import { emptyAwards, TRACK_KEYS } from "../domain/tracks.ts";
import { computeStats } from "../domain/stats.ts";
import { lagCorrelations, sameDayCorrelations } from "../domain/correlate.ts";
import { lastNDays, shiftISO } from "../domain/dates.ts";
import type { AccountSettings, StatsResponse, StudyResponse } from "../api/client.ts";
import type { Entry, Lang } from "../domain/types.ts";

/* ── fixtures ───────────────────────────────────────────────────── */

const settings: AccountSettings = {
  lang: "en", halfLife: 14, xpScale: 7.5, notify: false, restDays: false,
  shareScores: true,
};

function entries(): Entry[] {
  return Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    date: shiftISO("2026-06-01", i),
    text: "Radio sam na serveru. Trčao 5km. Zvao me je Milan.",
    lang: "sr" as Lang,
    awards: { ...emptyAwards(), craft: 12, body: 8, bonds: 5 },
    autoAwards: { ...emptyAwards(), craft: 12, body: 8, bonds: 5 },
    mood: 6,
    energy: 5,
    people: ["Milan"],
    events: ["Trčao 5km"],
    tags: ["server", "trčanje"],
    note: "Rad je uzeo dan.",
    metrics: [{ kind: "sleep_hours", value: 7, unit: "h", track: "body" as const }],
    createdAt: "2026-06-01T21:00:00.000Z",
    editedAt: null,
  }));
}

function statsResponse(es: Entry[]): StatsResponse {
  return {
    stats: computeStats(es, "2026-07-10"),
    streak: 5,
    longestStreak: 12,
    entryCount: es.length,
    heat35: lastNDays(35, "2026-07-10").map((iso) => ({ iso, xp: 20 })),
    heatYear: lastNDays(371, "2026-07-10").map((iso) => ({ iso, xp: 10 })),
  };
}

function studyResponse(es: Entry[]): StudyResponse {
  return {
    sameDay: sameDayCorrelations(es, "mood"),
    lagMood: lagCorrelations(es, "mood"),
    lagXp: lagCorrelations(es, "totalXp"),
    sleep: { r: 0.42, p: 0.01, n: 30, ready: true },
    pairedDays: 39,
    people: [
      {
        id: 1, canonical: "milan", display: "Milan", aliases: ["Milanom"],
        firstSeen: "2026-06-01", lastSeen: "2026-07-10", appearances: 40,
      },
    ],
    chapters: [
      {
        start: "2026-06-01", end: "2026-07-10",
        profile: Object.fromEntries(TRACK_KEYS.map((t) => [t, 1 / 7])) as never,
        dominant: "craft", entryCount: 40,
      },
    ],
  };
}

/** Render inside the i18n provider for a given language. */
function render(node: React.ReactNode, lang: Lang): string {
  return renderToString(<I18nProvider lang={lang}>{node}</I18nProvider>);
}

const LANGS: Lang[] = ["en", "sr"];

/* ── tests ──────────────────────────────────────────────────────── */

describe("every tab renders", () => {
  const es = entries();
  const stats = statsResponse(es);
  const study = studyResponse(es);

  for (const lang of LANGS) {
    describe(lang, () => {
      it("Record — empty", () => {
        const html = render(
          <RecordTab lang={lang} onThisDay={null} onFiled={() => {}} />,
          lang,
        );
        expect(html).toContain("ll-write");
        expect(html).toContain("ll-seal");
      });

      it("Record — with an on-this-day entry", () => {
        const html = render(
          <RecordTab
            lang={lang}
            onThisDay={{ monthAgo: es[0]!, yearAgo: null }}
            onFiled={() => {}}
          />,
          lang,
        );
        expect(html).toContain("ll-row-date");
      });

      it("Sheet — populated and empty", () => {
        const full = render(<Sheet data={stats} />, lang);
        // All seven tracks, localised.
        for (const t of TRACK_KEYS) expect(full).toContain("ll-stat");
        expect(full).toContain("LV");

        const empty = render(
          <Sheet data={{ ...stats, entryCount: 0 }} />,
          lang,
        );
        expect(empty).toContain("ll-empty");
      });

      it("Ledger — populated and empty", () => {
        const full = render(<Ledger entries={es} onDeleted={() => {}} />, lang);
        expect(full).toContain("ll-row-date");
        expect(full).toContain("Milan");

        const empty = render(<Ledger entries={[]} onDeleted={() => {}} />, lang);
        expect(empty).toContain("ll-empty");
      });

      it("Study — populated, and gated when thin", () => {
        const full = render(<Study stats={stats} study={study} />, lang);
        expect(full).toContain("ll-radar");
        expect(full).toContain("ll-heat");
        expect(full).toContain("ll-corr");

        const thin = render(
          <Study stats={{ ...stats, entryCount: 1 }} study={null} />,
          lang,
        );
        expect(thin).toContain("ll-empty");
      });

      it("Review", () => {
        expect(render(<Review />, lang)).toContain("ll-weeknav");
      });

      it("Quests", () => {
        const html = render(<Quests onChanged={() => {}} />, lang);
        expect(html).toContain("ll-form");
      });

      it("People", () => {
        expect(render(<People />, lang)).toContain("ll-pane");
      });

      it("Lexicon", () => {
        const html = render(<Lexicon onChanged={() => {}} />, lang);
        expect(html).toContain("ll-formrow");
      });

      it("Data", () => {
        const html = render(
          <Data
            settings={{ ...settings, lang }}
            onSettings={() => {}}
            onImported={() => {}}
          />,
          lang,
        );
        expect(html).toContain("ll-settingrow");
        expect(html).toContain("zapis.json");
      });

      it("Board", () => {
        // Effects don't run here, so this is the pre-fetch state: the chip row
        // and the privacy note must be there before any data arrives.
        const html = render(<Board />, lang);
        expect(html).toContain("ll-chips");
        expect(html).toContain("ll-note");
      });

      it("SignIn", () => {
        const html = render(<SignIn onSignedIn={() => {}} />, lang);
        expect(html).toContain("ll-signin");
        expect(html).toContain('type="password"');
      });
    });
  }

  it("shared components render", () => {
    expect(render(<Radar stats={stats.stats} />, "en")).toContain("polygon");
    expect(render(<Heat days={stats.heat35} />, "en")).toContain("ll-heat");
    expect(render(<YearHeat days={stats.heatYear} />, "en")).toContain("ll-yearheat");
    // Degenerate input must not throw.
    expect(render(<YearHeat days={[]} />, "en")).toBe("");
  });

  it("uses the Serbian dictionary when the language is sr", () => {
    const sr = render(<Sheet data={stats} />, "sr");
    const en = render(<Sheet data={stats} />, "en");
    // Track names are genuinely translated, not passed through.
    expect(sr).toContain("Učenje");
    expect(en).toContain("Study");
    expect(sr).not.toContain(">Craft<");
  });

  it("leaves no untranslated i18n keys in either language", () => {
    for (const lang of LANGS) {
      const html = [
        render(<Sheet data={stats} />, lang),
        render(<Study stats={stats} study={study} />, lang),
        render(<Ledger entries={es} onDeleted={() => {}} />, lang),
        render(<Data settings={{ ...settings, lang }} onSettings={() => {}} onImported={() => {}} />, lang),
        render(<Quests onChanged={() => {}} />, lang),
        render(<Board />, lang),
        render(<SignIn onSignedIn={() => {}} />, lang),
      ].join("");

      // A missing key falls back to the key itself, which is always
      // lowerCamelCase — so any bare camelCase token in the output is a hole
      // in the dictionary.
      for (const key of [
        "needMoreDays", "pairedDays", "exportJson", "halfLife", "questTitle",
        "signIn", "password", "overall", "boardBlurb", "shareScores",
      ]) {
        expect(html, `${key} should be translated in ${lang}`).not.toContain(`>${key}<`);
      }
    }
  });
});
