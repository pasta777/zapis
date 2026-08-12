import { useEffect, useState } from "react";
import { api, type PersonDetail } from "../../api/client.ts";
import { useT } from "../../i18n/index.tsx";

/**
 * The cast of characters.
 *
 * Mood-with-them against your own baseline is the interesting column: it
 * answers a question you would never ask directly, and it comes free from
 * data you already wrote.
 */
export function People() {
  const t = useT();
  const [people, setPeople] = useState<PersonDetail[]>([]);
  const [error, setError] = useState("");

  const load = () =>
    api
      .people()
      .then(setPeople)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    void load();
  }, []);

  const remove = async (id: number) => {
    await api.deletePerson(id);
    await load();
  };

  if (people.length === 0) {
    return (
      <section className="ll-pane">
        {error && <div className="ll-error">{error}</div>}
        <p className="ll-empty">{t.t("noEntries")}</p>
      </section>
    );
  }

  return (
    <section className="ll-pane">
      {error && <div className="ll-error">{error}</div>}
      <p className="ll-label">{t.t("peopleByDays")}</p>

      {people.map((p) => {
        const delta =
          p.moodWithThem !== null && p.moodBaseline !== null
            ? p.moodWithThem - p.moodBaseline
            : null;
        return (
          <div key={p.id} className="ll-quest">
            <div className="ll-quest-top">
              <span className="ll-quest-title">{p.display}</span>
              <span className="ll-rule" />
              <span className="ll-row-sum">{p.appearances}</span>
              <button
                className="ll-x"
                type="button"
                onClick={() => remove(p.id)}
                aria-label={t.t("delete")}
              >
                ×
              </button>
            </div>

            <div className="ll-quest-foot">
              {p.firstSeen && (
                <span>
                  {t.date(p.firstSeen)} → {t.date(p.lastSeen)}
                </span>
              )}
              {delta !== null && (
                <span
                  style={{
                    color:
                      delta >= 0.5
                        ? "var(--sage)"
                        : delta <= -0.5
                          ? "var(--crimson)"
                          : undefined,
                  }}
                >
                  {t.t("mood")} {delta >= 0 ? "+" : ""}
                  {delta.toFixed(1)}
                </span>
              )}
              {p.daysSinceSeen !== null && p.daysSinceSeen > 21 && (
                <span style={{ color: "var(--crimson)" }}>
                  {p.daysSinceSeen}d
                </span>
              )}
              {p.aliases.length > 0 && <span>{p.aliases.join(", ")}</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
