import { useEffect, useState } from "react";
import { api, type QuestView } from "../../api/client.ts";
import { TRACKS } from "../../domain/tracks.ts";
import { useT } from "../../i18n/index.tsx";
import type { TrackKey } from "../../domain/types.ts";

export function Quests({ onChanged }: { onChanged: () => void }) {
  const t = useT();
  const [quests, setQuests] = useState<QuestView[]>([]);
  const [title, setTitle] = useState("");
  const [tracks, setTracks] = useState<TrackKey[]>([]);
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .quests()
      .then(setQuests)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    void load();
  }, []);

  const declare = async () => {
    if (title.trim().length < 2) return;
    setBusy(true);
    setError("");
    try {
      await api.createQuest({
        title: title.trim(),
        tracks,
        targetDate: target || null,
        xpTarget: null,
      });
      setTitle("");
      setTracks([]);
      setTarget("");
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const setStatus = async (id: number, status: "active" | "done" | "abandoned") => {
    await api.setQuestStatus(id, status);
    await load();
  };

  const remove = async (id: number) => {
    await api.deleteQuest(id);
    await load();
  };

  return (
    <section className="ll-pane">
      {error && <div className="ll-error">{error}</div>}

      <p className="ll-label">{t.t("newQuest")}</p>
      <div className="ll-form">
        <input
          className="ll-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t.t("questTitle")}
        />
        <div className="ll-formrow">
          {TRACKS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`ll-ghost sm${tracks.includes(s.key) ? " on" : ""}`}
              onClick={() =>
                setTracks((v) =>
                  v.includes(s.key) ? v.filter((x) => x !== s.key) : [...v, s.key],
                )
              }
            >
              {t.track(s.key)}
            </button>
          ))}
        </div>
        <div className="ll-formrow">
          <label className="ll-label" style={{ margin: 0 }} htmlFor="q-target">
            {t.t("questTarget")}
          </label>
          <input
            id="q-target"
            className="ll-date"
            type="date"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <button className="ll-seal" onClick={declare} disabled={busy} type="button">
            {t.t("declare")}
          </button>
        </div>
      </div>

      {quests.length === 0 && <p className="ll-empty">{t.t("noQuests")}</p>}

      {quests.map((q) => (
        <article
          key={q.quest.id}
          className={`ll-quest${q.quest.status !== "active" ? " done" : ""}`}
        >
          <div className="ll-quest-top">
            <span className="ll-quest-title">{q.quest.title}</span>
            <span className="ll-rule" />
            <span className="ll-row-sum">{q.xp} xp</span>
          </div>

          {q.quest.tracks.length > 0 && (
            <div className="ll-chips">
              {q.quest.tracks.map((tr) => (
                <span key={tr} className="ll-chip">
                  {t.track(tr)}
                </span>
              ))}
            </div>
          )}

          <div className="ll-quest-foot">
            <span>
              {q.linkedEntries} {t.t("linkedEntries")}
            </span>
            {q.lastTouched && <span>{t.date(q.lastTouched)}</span>}
            {q.daysRemaining !== null && (
              <span style={{ color: q.daysRemaining < 0 ? "var(--crimson)" : undefined }}>
                {q.daysRemaining < 0
                  ? t.t("overdue")
                  : `${q.daysRemaining} ${t.t("daysLeft")}`}
              </span>
            )}
            <span className="ll-rule" />
            {q.quest.status === "active" ? (
              <>
                <button
                  className="ll-ghost sm"
                  type="button"
                  onClick={() => setStatus(q.quest.id, "done")}
                >
                  {t.t("done")}
                </button>
                <button
                  className="ll-ghost sm"
                  type="button"
                  onClick={() => setStatus(q.quest.id, "abandoned")}
                >
                  {t.t("abandon")}
                </button>
              </>
            ) : (
              <button
                className="ll-ghost sm"
                type="button"
                onClick={() => setStatus(q.quest.id, "active")}
              >
                {t.t("reopen")}
              </button>
            )}
            <button
              className="ll-x"
              type="button"
              onClick={() => remove(q.quest.id)}
              aria-label={t.t("delete")}
            >
              ×
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
