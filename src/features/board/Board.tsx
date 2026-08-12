import { useEffect, useState } from "react";
import { api, type LeaderboardResponse } from "../../api/client.ts";
import { useT } from "../../i18n/index.tsx";
import { TRACKS } from "../../domain/tracks.ts";
import { momentumLabel } from "../../domain/xp.ts";

const OVERALL = "_overall";

/**
 * The shared board — the only screen in Zapis that shows anyone else.
 *
 * Ranked by momentum rather than lifetime XP so it stays a picture of the
 * present: whoever started first can't hold the top spot forever, and a week
 * of consistency is enough to climb. Overall momentum is the mean across the
 * seven tracks, which rewards a filled-in radar over one obsessive spike.
 */
export function Board() {
  const t = useT();
  const [track, setTrack] = useState<string>(OVERALL);
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api
      .leaderboard(track)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [track]);

  return (
    <section className="ll-pane">
      {error && <div className="ll-error">{error}</div>}

      <nav className="ll-chips">
        <button
          type="button"
          className={`ll-chip${track === OVERALL ? " on" : ""}`}
          onClick={() => setTrack(OVERALL)}
        >
          {t.t("overall")}
        </button>
        {TRACKS.map((tr) => (
          <button
            key={tr.key}
            type="button"
            className={`ll-chip${track === tr.key ? " on" : ""}`}
            onClick={() => setTrack(tr.key)}
          >
            {t.track(tr.key)}
          </button>
        ))}
      </nav>

      {data && !data.sharing && <div className="ll-banner warn">{t.t("notSharing")}</div>}

      {data && data.rows.length === 0 && <p className="ll-empty">{t.t("boardEmpty")}</p>}

      {data && data.rows.length > 0 && (
        <table className="ll-board">
          <thead>
            <tr>
              <th className="num">{t.t("rank")}</th>
              <th>{t.t("player")}</th>
              <th className="num">{t.t("momentumHeading")}</th>
              <th className="num">{t.t("level")}</th>
              <th className="num">{t.t("dayStreak")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const isYou = data.you?.userId === row.userId;
              return (
                <tr key={row.userId} className={isYou ? "you" : undefined}>
                  <td className="num">{t.number(row.rank)}</td>
                  <td>
                    {row.display}
                    {isYou && <span className="ll-you"> · {t.t("youLabel")}</span>}
                  </td>
                  <td className="num">
                    {t.number(Math.round(row.momentum))}
                    <span className="ll-band"> {t.momentum(momentumLabel(row.momentum))}</span>
                  </td>
                  <td className="num">{t.number(row.level)}</td>
                  <td className="num">{t.number(row.streak)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="ll-note">{t.t("boardBlurb")}</p>
    </section>
  );
}
