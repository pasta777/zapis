/* ────────────────────────────────────────────────────────────────
   Render the populated tabs to a single static HTML page.

   A browser screenshot of the live app captures it mid-fetch, which
   shows only empty states. This renders every view server-side with
   real data from the database and inlines the real stylesheet, so the
   result is a faithful picture of what the app looks like once it has
   something to show.

   Usage:  DB_PATH=./data/dev.db npx tsx scripts/preview.tsx out.html
   ──────────────────────────────────────────────────────────────── */

import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import { openDb, listEntries, getSettings, listPeople, listUsers } from "../server/db.ts";
import { I18nProvider } from "../src/i18n/index.tsx";
import { Sheet } from "../src/features/sheet/Sheet.tsx";
import { Ledger } from "../src/features/ledger/Ledger.tsx";
import { Study } from "../src/features/study/Study.tsx";
import { computeStats, currentStreak, dailyTotals, longestStreak } from "../src/domain/stats.ts";
import { lagCorrelations, sameDayCorrelations, sleepLagCorrelation, pairedDayCount } from "../src/domain/correlate.ts";
import { detectChapters } from "../src/domain/achievements.ts";
import { buildWeeklyReview } from "../src/domain/review.ts";
import { lastNDays, todayISO, weekStart } from "../src/domain/dates.ts";
import { en } from "../src/i18n/en.ts";
import { sr } from "../src/i18n/sr.ts";
import type { Lang } from "../src/domain/types.ts";

const OUT = process.argv[2] ?? "preview.html";
const db = openDb(process.env.DB_PATH ?? "./data/dev.db");

// Renders whichever account the database happens to hold; with several, pass
// PREVIEW_USER_ID to choose. A preview is a developer tool, so it reads
// directly rather than going through the API's auth.
const users = listUsers(db);
const userId = Number(process.env.PREVIEW_USER_ID ?? users[0]?.id ?? 0);
if (!userId) {
  console.error("no accounts in this database — run 'npm run seed' first");
  process.exit(1);
}

const settings = getSettings(db, userId);
const entries = listEntries(db, userId);
const today = todayISO();

const stats = {
  stats: computeStats(entries, today, settings.halfLife),
  streak: currentStreak(entries, today, settings.restDays),
  longestStreak: longestStreak(entries),
  entryCount: entries.length,
  heat35: dailyTotals(entries, lastNDays(35, today)),
  heatYear: dailyTotals(entries, lastNDays(371, today)),
};

const study = {
  sameDay: sameDayCorrelations(entries, "mood"),
  lagMood: lagCorrelations(entries, "mood"),
  lagXp: lagCorrelations(entries, "totalXp"),
  sleep: sleepLagCorrelation(entries, "mood"),
  pairedDays: pairedDayCount(entries),
  people: listPeople(db, userId),
  chapters: detectChapters(entries),
};

const review = buildWeeklyReview(entries, weekStart(today), settings.halfLife);

/** Render one section, labelled, inside the language provider. */
function section(title: string, lang: Lang, node: React.ReactNode): string {
  const dict = lang === "sr" ? sr : en;
  return `
  <div class="preview-block">
    <div class="preview-label">${title} — ${dict.code}</div>
    <div class="ll">${renderToStaticMarkup(
      <I18nProvider lang={lang}>{node}</I18nProvider>,
    )}</div>
  </div>`;
}

/** The review has its own fetch, so its findings are rendered directly here. */
function reviewMarkup(lang: Lang): string {
  const dict = lang === "sr" ? sr : en;
  const t = (k: string) => (dict.ui as Record<string, string>)[k] ?? k;
  const line = (kind: string, text: string) =>
    `<div class="ll-finding ${kind}"><span class="ll-finding-mark">${kind}</span><span>${text}</span></div>`;

  const findings = review.findings
    .map((f) => {
      const fn = dict.finding[f.kind];
      const data = { ...f.data };
      if (typeof data.track === "string") {
        // Mirror the translator: keep the raw key for gender agreement.
        data.trackKey = data.track;
        data.track = dict.tracks[data.track as keyof typeof dict.tracks]?.name ?? data.track;
      }
      return line(f.kind, fn ? fn(data) : f.kind);
    })
    .join("");

  return `
  <div class="preview-block">
    <div class="preview-label">Review — ${dict.code}</div>
    <div class="ll"><section class="ll-pane">
      <div class="ll-weeknav"><span class="ll-label" style="margin:0">${review.weekStart} → ${review.weekEnd}</span><span class="ll-rule"></span></div>
      <div class="ll-vitals">
        <div><span class="ll-label">${t("entries")}</span><b>${review.entryCount}</b></div>
        <div><span class="ll-label">XP</span><b>${review.totalXp}</b></div>
        <div><span class="ll-label">${t("mood")}</span><b>${review.moodMean ?? "—"}</b></div>
        <div><span class="ll-label">${t("words")}</span><b>${review.avgWords}</b></div>
      </div>
      ${findings}
    </section></div>
  </div>`;
}

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Zapis — preview</title>
<style>
${css}
body { background:#0b0e14; padding:24px; }
.preview-block { max-width: 800px; margin: 0 auto 40px; border:1px solid #3a4356; }
.preview-label { font-family: var(--mono); font-size:10px; letter-spacing:.2em;
  text-transform:uppercase; color:#b8934a; padding:8px 14px; border-bottom:1px solid #3a4356; }
.preview-block .ll { min-height:0; padding:20px 18px 28px; }
.ll-pane { animation: none; }
</style></head>
<body>
${section("Sheet", "en", <Sheet data={stats} />)}
${section("Sheet", "sr", <Sheet data={stats} />)}
${section("Study", "en", <Study stats={stats} study={study} />)}
${reviewMarkup("en")}
${reviewMarkup("sr")}
${section("Ledger", "sr", <Ledger entries={entries.slice(0, 4)} onDeleted={() => {}} />)}
</body></html>`;

writeFileSync(OUT, html);
console.log(`preview written to ${OUT} (${entries.length} entries)`);
