/* Typed fetch wrapper. One place that knows about HTTP. */

import type {
  Achievement, Chapter,
} from "../domain/achievements.ts";
import type { Correlation } from "../domain/correlate.ts";
import type { WeeklyReview } from "../domain/review.ts";
import type { QuestProgress } from "../domain/quests.ts";
import type {
  Alert, Cue, Draft, Entry, Lang, Person, Quest, Settings, Stats, TrackKey,
} from "../domain/types.ts";

const BASE = "/api";

/** Thrown for a 401, so the app can drop to the sign-in screen. */
export class NotAuthedError extends Error {
  constructor() {
    super("not signed in");
    this.name = "NotAuthedError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    // The session cookie is httpOnly, so it rides on the request rather than
    // being read by this code. Same-origin in production; in dev Vite proxies
    // /api, which keeps it same-origin there too.
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) throw new NotAuthedError();

    let message = `${res.status} ${res.statusText}`;
    try {
      const body = JSON.parse(text) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      if (text) message = text.slice(0, 300);
    }
    throw new Error(message);
  }

  return text ? (JSON.parse(text) as T) : (undefined as T);
}

const get = <T,>(p: string) => request<T>(p);
const post = <T,>(p: string, body?: unknown) =>
  request<T>(p, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T,>(p: string, body: unknown) =>
  request<T>(p, { method: "PUT", body: JSON.stringify(body) });
const del = <T,>(p: string) => request<T>(p, { method: "DELETE" });

/* ── payload shapes ─────────────────────────────────────────────── */

export interface QuestLinkPreview {
  questId: number;
  title: string;
  confidence: number;
  evidence: string;
}

export interface ExtractResponse {
  draft: Draft;
  questLinks: QuestLinkPreview[];
}

export interface StatsResponse {
  stats: Stats;
  streak: number;
  longestStreak: number;
  entryCount: number;
  heat35: { iso: string; xp: number }[];
  heatYear: { iso: string; xp: number }[];
}

export interface StudyResponse {
  sameDay: Correlation[];
  lagMood: Correlation[];
  lagXp: Correlation[];
  sleep: { r: number | null; p: number | null; n: number; ready: boolean };
  pairedDays: number;
  people: Person[];
  chapters: Chapter[];
}

export interface PersonDetail extends Person {
  moodWithThem: number | null;
  moodBaseline: number | null;
  daysSinceSeen: number | null;
}

export interface QuestView extends QuestProgress {
  links: { id: number; date: string }[];
}

export interface SearchHit {
  entry: Entry;
  snippet: string;
}

export interface ImportPreview {
  counts: { new: number; identical: number; conflict: number };
  failures: { index: number; path: string; message: string }[];
  rows: {
    date: string;
    resolution: "new" | "identical" | "conflict";
    changed: string[];
    words: number;
  }[];
}

export interface Account {
  id: number;
  handle: string;
  display: string;
  shareScores: boolean;
  createdAt: string;
}

/** One row of the shared board. Numbers and a display name; nothing else. */
export interface BoardRow {
  rank: number;
  userId: number;
  display: string;
  track: string;
  momentum: number;
  lifetime: number;
  level: number;
  streak: number;
  entryCount: number;
  updatedAt: string;
}

export interface LeaderboardResponse {
  track: string;
  you: Omit<BoardRow, "rank"> | null;
  sharing: boolean;
  rows: BoardRow[];
}

export type AccountSettings = Settings & { shareScores: boolean };

export interface EntryPayload {
  date: string;
  text: string;
  lang?: Lang;
  awards: Record<string, number>;
  autoAwards?: Record<string, number>;
  mood: number | null;
  energy: number | null;
  people: string[];
  events: string[];
  tags: { stem: string; display: string }[];
  note: string;
  metrics: { kind: string; value: number; unit: string; track: string | null }[];
  confirmPeople?: string[];
}

/* ── the client ─────────────────────────────────────────────────── */

export const api = {
  health: () => get<{ ok: boolean; db: string }>("/health"),

  me: () => get<{ user: Account }>("/auth/me"),
  login: (handle: string, password: string) =>
    post<{ user: Account }>("/auth/login", { handle, password }),
  register: (input: {
    handle: string;
    display: string;
    password: string;
    invite: string;
  }) => post<{ user: Account }>("/auth/register", input),
  logout: () => post<{ ok: boolean }>("/auth/logout"),

  leaderboard: (track?: string) =>
    get<LeaderboardResponse>(
      `/leaderboard${track ? `?track=${encodeURIComponent(track)}` : ""}`,
    ),

  extract: (text: string, date?: string) =>
    post<ExtractResponse>("/extract", { text, date }),

  entries: () => get<Entry[]>("/entries"),
  createEntry: (payload: EntryPayload) =>
    post<{ entry: Entry; alerts: Alert[] }>("/entries", payload),
  updateEntry: (id: number, payload: EntryPayload) =>
    put<{ entry: Entry; alerts: Alert[] }>(`/entries/${id}`, payload),
  deleteEntry: (id: number) =>
    del<{ deleted: boolean; alerts: Alert[] }>(`/entries/${id}`),

  stats: () => get<StatsResponse>("/stats"),
  study: () => get<StudyResponse>("/study"),
  achievements: () => get<Achievement[]>("/achievements"),
  review: (week?: string) =>
    get<WeeklyReview & { cached: boolean }>(
      `/review${week ? `?week=${encodeURIComponent(week)}` : ""}`,
    ),

  quests: () => get<QuestView[]>("/quests"),
  createQuest: (q: {
    title: string;
    tracks: TrackKey[];
    targetDate: string | null;
    xpTarget: number | null;
  }) => post<Quest>("/quests", q),
  setQuestStatus: (id: number, status: Quest["status"]) =>
    post<{ updated: boolean }>(`/quests/${id}/status`, { status }),
  deleteQuest: (id: number) => del<{ deleted: boolean }>(`/quests/${id}`),
  unlinkQuest: (questId: number, entryId: number) =>
    del<{ unlinked: boolean }>(`/quests/${questId}/links/${entryId}`),

  alerts: () => get<Alert[]>("/alerts"),
  dismissAlert: (id: number) => post<{ dismissed: boolean }>(`/alerts/${id}/dismiss`),

  cues: () => get<Cue[]>("/cues"),
  addCue: (c: { lang: Lang; track: TrackKey; word: string; weight: number }) =>
    post<{ saved: boolean }>("/cues", c),
  resetCue: (id: number) => post<{ reset: boolean }>(`/cues/${id}/reset`),
  deleteCue: (id: number) => del<{ deleted: boolean }>(`/cues/${id}`),

  people: () => get<PersonDetail[]>("/people"),
  addPerson: (display: string, alias?: string) =>
    post<{ id: number }>("/people", { display, alias }),
  deletePerson: (id: number) => del<{ deleted: boolean }>(`/people/${id}`),

  search: (q: string) => get<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`),
  onThisDay: () =>
    get<{ monthAgo: Entry | null; yearAgo: Entry | null }>("/onthisday"),

  settings: () => get<AccountSettings>("/settings"),
  saveSettings: (patch: Partial<AccountSettings>) =>
    put<AccountSettings>("/settings", patch),

  exportUrl: (format: "json" | "csv" | "md") => `${BASE}/export?format=${format}`,
  importPreview: (raw: string) => post<ImportPreview>("/import/preview", { raw }),
  importCommit: (raw: string, strategy: "skip" | "replace" | "keepBoth") =>
    post<{
      inserted: number;
      replaced: number;
      skipped: number;
      failures: unknown[];
      alerts: Alert[];
    }>("/import/commit", { raw, strategy }),
};
