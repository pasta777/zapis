import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { shiftISO, todayISO, weekStart } from "../../domain/dates.ts";
import { useT } from "../../i18n/index.tsx";
import type { WeeklyReview } from "../../domain/review.ts";

/**
 * The week, as the app saw it.
 *
 * Findings arrive already sorted by priority, and absence findings sort
 * highest — the point of this screen is what you didn't do, which is the one
 * thing re-reading your own entries can't tell you.
 */
export function Review() {
  const t = useT();
  const [anchor, setAnchor] = useState(weekStart(todayISO()));
  const [data, setData] = useState<(WeeklyReview & { cached: boolean }) | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api
      .review(anchor)
      .then((r) => {
        if (live) setData(r);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [anchor]);

  const thisWeek = weekStart(todayISO());

  return (
    <section className="ll-pane">
      {error && <div className="ll-error">{error}</div>}

      <div className="ll-weeknav">
        <button
          className="ll-ghost sm"
          type="button"
          onClick={() => setAnchor((a) => shiftISO(a, -7))}
        >
          ←
        </button>
        <span className="ll-label" style={{ margin: 0 }}>
          {data ? `${t.date(data.weekStart)} → ${t.date(data.weekEnd)}` : "…"}
        </span>
        <span className="ll-rule" />
        <button
          className="ll-ghost sm"
          type="button"
          disabled={anchor >= thisWeek}
          onClick={() => setAnchor((a) => shiftISO(a, 7))}
        >
          →
        </button>
      </div>

      {loading && !data && <p className="ll-empty">…</p>}

      {data && (
        <>
          <div className="ll-vitals">
            <div>
              <span className="ll-label">{t.t("entries")}</span>
              <b>{data.entryCount}</b>
            </div>
            <div>
              <span className="ll-label">XP</span>
              <b>{data.totalXp}</b>
            </div>
            <div>
              <span className="ll-label">{t.t("mood")}</span>
              <b>{data.moodMean ?? "—"}</b>
            </div>
            <div>
              <span className="ll-label">{t.t("words")}</span>
              <b>{data.avgWords}</b>
            </div>
          </div>

          {data.findings.length === 0 && (
            <p className="ll-empty">{t.t("reviewEmpty")}</p>
          )}

          {data.findings.map((f, i) => (
            <div key={`${f.kind}-${i}`} className={`ll-finding ${f.kind}`}>
              <span className="ll-finding-mark">{f.kind.replace(/([A-Z])/g, " $1")}</span>
              <span>{t.finding(f)}</span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
