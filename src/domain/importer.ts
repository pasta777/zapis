/* ────────────────────────────────────────────────────────────────
   Import.

   Accepts the current export format and the legacy `lifelog:v2`
   shape, validates everything, and produces a *diff* for review
   before anything is written. No import ever silently overwrites:
   this is the one code path where a bug costs you months of writing,
   so it errs towards refusing rather than guessing.
   ──────────────────────────────────────────────────────────────── */

import { z } from "zod";
import { emptyAwards, isTrackKey, MAX_TRACK_XP, TRACK_KEYS } from "./tracks.ts";
import { isISODate } from "./dates.ts";
import type { Awards, Entry, Lang, Metric, TrackKey } from "./types.ts";

/* ── schemas ────────────────────────────────────────────────────── */

const awardsSchema = z
  .record(z.string(), z.union([z.number(), z.string()]))
  .transform((raw): Awards => {
    const out = emptyAwards();
    for (const [k, v] of Object.entries(raw)) {
      if (!isTrackKey(k)) continue; // unknown track: dropped, not fatal
      const n = typeof v === "string" ? Number(v) : v;
      if (!Number.isFinite(n)) continue;
      out[k] = Math.max(0, Math.min(MAX_TRACK_XP, Math.round(n)));
    }
    return out;
  });

const nullableScore = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "string" ? Number(v) : v;
    if (!Number.isFinite(n)) return null;
    return Math.max(1, Math.min(10, Math.round(n)));
  });

const stringList = z
  .union([z.array(z.union([z.string(), z.number()])), z.string(), z.null()])
  .optional()
  .transform((v): string[] => {
    if (v === null || v === undefined) return [];
    if (typeof v === "string") {
      // The CSV export joins with "; "
      return v.split(";").map((s) => s.trim()).filter(Boolean);
    }
    return v.map((s) => String(s).trim()).filter(Boolean);
  });

const metricSchema = z.object({
  kind: z.string(),
  value: z.number(),
  unit: z.string(),
  track: z.string().nullable().optional().transform((t) =>
    t && isTrackKey(t) ? (t as TrackKey) : null,
  ),
});

/** Deliberately permissive: unknown fields are ignored, not rejected. */
const entrySchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  date: z.string().refine(isISODate, "date must be yyyy-mm-dd"),
  text: z.string().default(""),
  lang: z.enum(["en", "sr"]).optional(),
  awards: awardsSchema.optional(),
  autoAwards: awardsSchema.optional(),
  mood: nullableScore,
  energy: nullableScore,
  people: stringList,
  events: stringList,
  tags: stringList,
  note: z.union([z.string(), z.null()]).optional().transform((s) => s ?? ""),
  metrics: z.array(metricSchema).optional(),
  createdAt: z.string().optional(),
  editedAt: z.string().nullable().optional(),
});

const fileSchema = z.union([
  z.object({ entries: z.array(entrySchema) }),
  z.array(entrySchema).transform((entries) => ({ entries })),
]);

export type ParsedEntry = z.infer<typeof entrySchema>;

/* ── normalising ────────────────────────────────────────────────── */

export interface ImportableEntry {
  date: string;
  text: string;
  lang: Lang;
  awards: Awards;
  autoAwards: Awards;
  mood: number | null;
  energy: number | null;
  people: string[];
  events: string[];
  tags: string[];
  note: string;
  metrics: Metric[];
  createdAt: string;
}

function normalise(p: ParsedEntry): ImportableEntry {
  const awards = p.awards ?? emptyAwards();
  return {
    date: p.date,
    text: p.text,
    lang: p.lang ?? "en",
    awards,
    // Legacy exports have no autoAwards — the filed numbers are all we know,
    // so they stand in as the engine's baseline too.
    autoAwards: p.autoAwards ?? awards,
    mood: p.mood ?? null,
    energy: p.energy ?? null,
    people: p.people ?? [],
    events: p.events ?? [],
    tags: p.tags ?? [],
    note: p.note ?? "",
    metrics: (p.metrics ?? []) as Metric[],
    createdAt: p.createdAt ?? new Date().toISOString(),
  };
}

/* ── parsing ────────────────────────────────────────────────────── */

export interface ParseFailure {
  index: number;
  path: string;
  message: string;
}

export interface ParseResult {
  entries: ImportableEntry[];
  failures: ParseFailure[];
}

export function parseImport(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const shape = fileSchema.safeParse(json);
  if (!shape.success) {
    // Fall back to per-entry validation so one bad row doesn't sink the file.
    const list = Array.isArray(json)
      ? json
      : (json as { entries?: unknown[] })?.entries;
    if (!Array.isArray(list)) {
      throw new Error(
        'Unrecognised file. Expected {"entries": [...]} or a bare array of entries.',
      );
    }
    return parseEach(list);
  }

  return { entries: shape.data.entries.map(normalise), failures: [] };
}

function parseEach(list: readonly unknown[]): ParseResult {
  const entries: ImportableEntry[] = [];
  const failures: ParseFailure[] = [];

  list.forEach((row, index) => {
    const parsed = entrySchema.safeParse(row);
    if (parsed.success) entries.push(normalise(parsed.data));
    else {
      const first = parsed.error.issues[0];
      failures.push({
        index,
        path: first?.path.join(".") ?? "",
        message: first?.message ?? "invalid entry",
      });
    }
  });

  return { entries, failures };
}

/* ── diffing ────────────────────────────────────────────────────── */

export type Resolution = "new" | "identical" | "conflict";

export interface DiffRow {
  incoming: ImportableEntry;
  existing: Entry | null;
  resolution: Resolution;
  /** Which fields differ, when the resolution is a conflict. */
  changed: string[];
}

export interface ImportDiff {
  rows: DiffRow[];
  counts: Record<Resolution, number>;
  failures: ParseFailure[];
}

function sameAwards(a: Awards, b: Awards): boolean {
  return TRACK_KEYS.every((t) => a[t] === b[t]);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

/**
 * Classify every incoming entry against what's already on file.
 *
 * `identical` matters as much as the other two: re-importing the same backup
 * should report "nothing to do" rather than 142 conflicts.
 */
export function diffImport(
  incoming: readonly ImportableEntry[],
  existing: readonly Entry[],
  failures: readonly ParseFailure[] = [],
): ImportDiff {
  const byDate = new Map<string, Entry>();
  for (const e of existing) byDate.set(e.date, e);

  const rows: DiffRow[] = incoming.map((inc) => {
    const cur = byDate.get(inc.date) ?? null;
    if (cur === null) {
      return { incoming: inc, existing: null, resolution: "new", changed: [] };
    }

    const changed: string[] = [];
    if (cur.text.trim() !== inc.text.trim()) changed.push("text");
    if (!sameAwards(cur.awards, inc.awards)) changed.push("awards");
    if (cur.mood !== inc.mood) changed.push("mood");
    if (cur.energy !== inc.energy) changed.push("energy");
    if (!sameList(cur.people, inc.people)) changed.push("people");
    if (!sameList(cur.tags, inc.tags)) changed.push("tags");
    if (cur.note !== inc.note) changed.push("note");

    return {
      incoming: inc,
      existing: cur,
      resolution: changed.length === 0 ? "identical" : "conflict",
      changed,
    };
  });

  const counts: Record<Resolution, number> = { new: 0, identical: 0, conflict: 0 };
  for (const r of rows) counts[r.resolution] += 1;

  return { rows, counts, failures: [...failures] };
}

export type ConflictStrategy = "skip" | "replace" | "keepBoth";

export interface ImportPlan {
  insert: ImportableEntry[];
  replace: { date: string; entry: ImportableEntry }[];
  skipped: number;
}

/** Turn a reviewed diff into the exact set of writes to perform. */
export function planImport(
  diff: ImportDiff,
  strategy: ConflictStrategy,
): ImportPlan {
  const insert: ImportableEntry[] = [];
  const replace: { date: string; entry: ImportableEntry }[] = [];
  let skipped = 0;

  for (const row of diff.rows) {
    if (row.resolution === "new") {
      insert.push(row.incoming);
      continue;
    }
    if (row.resolution === "identical") {
      skipped += 1;
      continue;
    }
    switch (strategy) {
      case "skip":
        skipped += 1;
        break;
      case "replace":
        replace.push({ date: row.incoming.date, entry: row.incoming });
        break;
      case "keepBoth":
        // Same day, second entry: the schema allows several per date, and the
        // stats sum them, so nothing is lost and nothing is overwritten.
        insert.push(row.incoming);
        break;
    }
  }

  return { insert, replace, skipped };
}

/* ── export ─────────────────────────────────────────────────────── */

export interface ExportFile {
  format: "zapis";
  version: 3;
  exportedAt: string;
  entries: unknown[];
}

export function buildExport(entries: readonly Entry[]): ExportFile {
  return {
    format: "zapis",
    version: 3,
    exportedAt: new Date().toISOString(),
    entries: entries.map((e) => ({
      id: e.id,
      date: e.date,
      text: e.text,
      lang: e.lang,
      awards: e.awards,
      autoAwards: e.autoAwards,
      mood: e.mood,
      energy: e.energy,
      people: e.people,
      events: e.events,
      tags: e.tags,
      note: e.note,
      metrics: e.metrics,
      createdAt: e.createdAt,
      editedAt: e.editedAt,
    })),
  };
}

/** CSV, for spreadsheets — the format that started this whole idea. */
export function buildCsv(entries: readonly Entry[]): string {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = [
    "date", "mood", "energy", ...TRACK_KEYS,
    "people", "tags", "events", "note", "entry",
  ];
  const rows = [...entries]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((e) =>
      [
        e.date, e.mood ?? "", e.energy ?? "",
        ...TRACK_KEYS.map((t) => e.awards[t] ?? 0),
        e.people.join("; "), e.tags.join("; "), e.events.join("; "),
        e.note, e.text,
      ]
        .map(q)
        .join(","),
    );
  return [head.join(","), ...rows].join("\n");
}

/** Markdown, one file's worth per entry — for Obsidian and friends. */
export function buildMarkdown(entries: readonly Entry[]): string {
  const out: string[] = [];
  for (const e of [...entries].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    out.push(`## ${e.date}`);
    out.push("");
    const scored = TRACK_KEYS.filter((t) => (e.awards[t] ?? 0) > 0)
      .map((t) => `${t} ${e.awards[t]}`)
      .join(" · ");
    if (scored) out.push(`\`${scored}\``);
    if (e.mood !== null || e.energy !== null) {
      out.push(`mood ${e.mood ?? "—"} · energy ${e.energy ?? "—"}`);
    }
    if (e.people.length) out.push(`with ${e.people.join(", ")}`);
    out.push("");
    out.push(e.text);
    if (e.note) {
      out.push("");
      out.push(`> ${e.note}`);
    }
    if (e.tags.length) {
      out.push("");
      out.push(e.tags.map((t) => `#${t.replace(/\s+/g, "-")}`).join(" "));
    }
    out.push("");
    out.push("---");
    out.push("");
  }
  return out.join("\n");
}
