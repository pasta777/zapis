/* ────────────────────────────────────────────────────────────────
   Dates are ISO yyyy-mm-dd strings everywhere. All arithmetic runs
   through UTC noon rather than midnight so a DST shift can never
   move a day by one — the classic off-by-one in journal apps.
   ──────────────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;

/** Today in the *user's local* calendar, as yyyy-mm-dd. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Parse yyyy-mm-dd to a UTC-noon timestamp. Anchored mid-day for DST safety. */
function toUTCNoon(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
}

export function isISODate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = toUTCNoon(v);
  return fromUTC(t) === v; // rejects 2026-02-31
}

function fromUTC(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Whole days from `a` to `b`, clamped at 0.
 *
 * The clamp is inherited from the original implementation and is relied on by
 * the decay maths: an entry dated in the future decays as if it were today
 * rather than gaining XP back.
 */
export function daysBetween(a: string, b: string): number {
  return Math.max(0, Math.round((toUTCNoon(b) - toUTCNoon(a)) / DAY_MS));
}

/** Signed day difference, for ordering and windowing. */
export function daysSigned(a: string, b: string): number {
  return Math.round((toUTCNoon(b) - toUTCNoon(a)) / DAY_MS);
}

export function shiftISO(iso: string, days: number): string {
  return fromUTC(toUTCNoon(iso) + days * DAY_MS);
}

export function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(iso: string): number {
  return new Date(toUTCNoon(iso)).getUTCDay();
}

/** Monday-anchored week start, matching ISO-8601 week convention. */
export function weekStart(iso: string): string {
  const dow = dayOfWeek(iso);
  const back = dow === 0 ? 6 : dow - 1;
  return shiftISO(iso, -back);
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Inclusive list of dates from `from` to `to`. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const n = daysSigned(from, to);
  for (let i = 0; i <= n; i++) out.push(shiftISO(from, i));
  return out;
}

/** The last `count` days, oldest first, ending on `end` (default today). */
export function lastNDays(count: number, end = todayISO()): string[] {
  return dateRange(shiftISO(end, -(count - 1)), end);
}
