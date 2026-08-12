import { Radar } from "../shared/Radar.tsx";
import { Heat, YearHeat } from "../shared/Heat.tsx";
import { MIN_GROUP, type Correlation } from "../../domain/correlate.ts";
import { useT } from "../../i18n/index.tsx";
import type { StatsResponse, StudyResponse } from "../../api/client.ts";

interface Props {
  stats: StatsResponse | null;
  study: StudyResponse | null;
}

/**
 * A correlation row.
 *
 * When the sample is too small this prints how many more paired days are
 * needed instead of a number. Showing a confident-looking figure computed
 * from a dozen entries would be the single most misleading thing this screen
 * could do.
 */
function CorrRow({ c }: { c: Correlation }) {
  const t = useT();

  if (!c.ready) {
    return (
      <div className="ll-corr pending">
        <span>{t.track(c.track)}</span>
        <span className="ll-rule" />
        <small>
          {t.t("needMoreDays")}: {c.needed}
        </small>
      </div>
    );
  }

  const delta = c.delta ?? 0;
  return (
    <div className="ll-corr">
      <span>{t.track(c.track)}</span>
      <span className="ll-rule" />
      {c.noise ? (
        <small>{t.t("noise")}</small>
      ) : (
        <small>
          n {c.nOn}/{c.nOff}
          {c.r !== null ? ` · r ${c.r}` : ""}
        </small>
      )}
      <b className={delta >= 0 ? "up" : "down"}>
        {delta >= 0 ? "+" : ""}
        {delta.toFixed(1)}
      </b>
    </div>
  );
}

export function Study({ stats, study }: Props) {
  const t = useT();

  if (!stats || stats.entryCount < 3) {
    return (
      <section className="ll-pane">
        <p className="ll-empty">{t.t("noReviewYet")}</p>
      </section>
    );
  }

  return (
    <section className="ll-pane">
      <p className="ll-label">{t.t("momentumShape")}</p>
      <div className="ll-radar-wrap">
        <Radar stats={stats.stats} />
      </div>

      <p className="ll-label">{t.t("last35")}</p>
      <Heat days={stats.heat35} />

      {stats.entryCount >= 30 && (
        <>
          <p className="ll-label">{t.t("lastYear")}</p>
          <YearHeat days={stats.heatYear} />
        </>
      )}

      {study && (
        <>
          <p className="ll-label">{t.t("sameDayMood")}</p>
          <p className="ll-caption">{t.t("sameDayCaption")}</p>
          {study.sameDay.map((c) => (
            <CorrRow key={`same-${c.track}`} c={c} />
          ))}

          <p className="ll-label">{t.t("lagMood")}</p>
          <p className="ll-caption">
            {t.t("lagCaption")} — {study.pairedDays} {t.t("pairedDays")}
            {study.pairedDays < MIN_GROUP * 2 ? "." : "."}
          </p>
          {study.lagMood.map((c) => (
            <CorrRow key={`lag-${c.track}`} c={c} />
          ))}

          {study.sleep.n > 0 && (
            <>
              <p className="ll-label">{t.t("sleepLag")}</p>
              <div className={`ll-corr${study.sleep.ready ? "" : " pending"}`}>
                <span>{t.t("sleepLag")}</span>
                <span className="ll-rule" />
                <small>n {study.sleep.n}</small>
                <b className={(study.sleep.r ?? 0) >= 0 ? "up" : "down"}>
                  {study.sleep.ready && study.sleep.r !== null
                    ? `r ${study.sleep.r}`
                    : "—"}
                </b>
              </div>
            </>
          )}

          {study.chapters.length > 1 && (
            <>
              <p className="ll-label">{t.t("chapters")}</p>
              {study.chapters.map((ch) => (
                <div key={ch.start} className="ll-corr">
                  <span>
                    {t.date(ch.start)} → {t.date(ch.end)}
                  </span>
                  <span className="ll-rule" />
                  <small>{ch.entryCount}</small>
                  <b className="up">{t.track(ch.dominant)}</b>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
