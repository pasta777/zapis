import { useT } from "../../i18n/index.tsx";

export interface Day {
  iso: string;
  xp: number;
}

function opacity(xp: number): number {
  return xp ? 0.22 + Math.min(0.78, xp / 70) : 0.07;
}

/** The 35-day grid from the original. */
export function Heat({ days }: { days: readonly Day[] }) {
  const t = useT();
  return (
    <div className="ll-heat">
      {days.map((d) => (
        <span
          key={d.iso}
          title={`${t.date(d.iso)} · ${d.xp} xp`}
          style={{ opacity: opacity(d.xp) }}
        />
      ))}
    </div>
  );
}

/**
 * A year in pixels: same idea, 53 weeks wide, columns of seven.
 *
 * Days are padded to a Monday boundary so rows line up with weekdays
 * rather than drifting by one each year.
 */
export function YearHeat({ days }: { days: readonly Day[] }) {
  const t = useT();
  if (days.length === 0) return null;

  const first = days[0]!;
  const dow = new Date(`${first.iso}T12:00:00Z`).getUTCDay();
  const pad = dow === 0 ? 6 : dow - 1;

  return (
    <div className="ll-yearheat">
      {Array.from({ length: pad }, (_, i) => (
        <span key={`pad-${i}`} style={{ opacity: 0 }} />
      ))}
      {days.map((d) => (
        <span
          key={d.iso}
          title={`${t.date(d.iso)} · ${d.xp} xp`}
          style={{ opacity: opacity(d.xp) }}
        />
      ))}
    </div>
  );
}
