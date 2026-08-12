import { TRACKS } from "../../domain/tracks.ts";
import { momentumLabel } from "../../domain/xp.ts";
import { useT } from "../../i18n/index.tsx";
import type { StatsResponse } from "../../api/client.ts";

export function Sheet({ data }: { data: StatsResponse | null }) {
  const t = useT();

  if (!data || data.entryCount === 0) {
    return (
      <section className="ll-pane">
        <p className="ll-empty">{t.t("noEntries")}</p>
      </section>
    );
  }

  return (
    <section className="ll-pane">
      {TRACKS.map((s) => {
        const st = data.stats[s.key];
        return (
          <div key={s.key} className="ll-stat">
            <div className="ll-stat-top">
              <span className="ll-stat-name" title={t.trackHint(s.key)}>
                {t.track(s.key)}
              </span>
              <span className="ll-rule" />
              <span className="ll-lvl">
                LV<b>{st.level}</b>
              </span>
            </div>

            <div className="ll-track">
              <span style={{ width: `${st.momentum}%` }} />
            </div>

            <div className="ll-stat-foot">
              <span>
                {t.momentum(momentumLabel(st.momentum))} · {st.momentum}
              </span>
              <span>
                {st.into}/{st.need} {t.t("toLevel")}
                {st.level + 1}
                {st.daysSince !== null && st.daysSince > 2 && (
                  <i>
                    {" "}
                    · {st.daysSince}d {t.t("cold")}
                  </i>
                )}
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
