import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { TRACKS } from "../../domain/tracks.ts";
import { useT } from "../../i18n/index.tsx";
import type { Cue, Lang, TrackKey } from "../../domain/types.ts";

/**
 * The engine, exposed.
 *
 * Every number the app produces traces back to this table, so it is editable
 * and nothing is hidden. Rows the learning loop has moved are marked, and any
 * of them can be reset — an automatic adjustment you disagree with is one
 * click from undone, which is what makes the loop safe to leave switched on.
 */
export function Lexicon({ onChanged }: { onChanged: () => void }) {
  const t = useT();
  const [cues, setCues] = useState<Cue[]>([]);
  const [filter, setFilter] = useState<TrackKey | "all">("all");
  const [lang, setLang] = useState<Lang>("en");
  const [word, setWord] = useState("");
  const [weight, setWeight] = useState(2);
  const [addTrack, setAddTrack] = useState<TrackKey>("craft");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const load = () =>
    api
      .cues()
      .then(setCues)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cues.filter(
      (c) =>
        (filter === "all" || c.track === filter) &&
        c.lang === lang &&
        (q === "" || c.stem.includes(q)),
    );
  }, [cues, filter, lang, query]);

  const grouped = useMemo(() => {
    const m = new Map<TrackKey, Cue[]>();
    for (const c of shown) {
      const list = m.get(c.track) ?? [];
      list.push(c);
      m.set(c.track, list);
    }
    return m;
  }, [shown]);

  const add = async () => {
    if (word.trim().length < 2) return;
    setError("");
    try {
      await api.addCue({ lang, track: addTrack, word: word.trim(), weight });
      setWord("");
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const reset = async (id: number) => {
    await api.resetCue(id);
    await load();
    onChanged();
  };

  const remove = async (id: number) => {
    await api.deleteCue(id);
    await load();
    onChanged();
  };

  const learned = cues.filter((c) => c.source === "learned").length;

  return (
    <section className="ll-pane">
      {error && <div className="ll-error">{error}</div>}

      <p className="ll-label">{t.t("lexicon")}</p>
      <p className="ll-caption">{t.t("lexiconCaption")}</p>

      <div className="ll-formrow">
        <select
          className="ll-select"
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          aria-label={t.t("language")}
        >
          <option value="en">EN</option>
          <option value="sr">SR</option>
        </select>
        <select
          className="ll-select"
          value={filter}
          onChange={(e) => setFilter(e.target.value as TrackKey | "all")}
          aria-label={t.t("track")}
        >
          <option value="all">— {t.t("track")} —</option>
          {TRACKS.map((s) => (
            <option key={s.key} value={s.key}>
              {t.track(s.key)}
            </option>
          ))}
        </select>
        <input
          className="ll-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.t("word")}
        />
        <span className="ll-mono">
          {shown.length} · {learned} {t.t("sourceLearned")}
        </span>
      </div>

      <p className="ll-label">{t.t("addWord")}</p>
      <div className="ll-formrow">
        <input
          className="ll-input"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder={t.t("word")}
        />
        <select
          className="ll-select"
          value={addTrack}
          onChange={(e) => setAddTrack(e.target.value as TrackKey)}
        >
          {TRACKS.map((s) => (
            <option key={s.key} value={s.key}>
              {t.track(s.key)}
            </option>
          ))}
        </select>
        <input
          className="ll-select"
          type="number"
          min={0}
          max={6}
          step={0.5}
          value={weight}
          onChange={(e) => setWeight(Number(e.target.value))}
          aria-label={t.t("weight")}
          style={{ width: 72 }}
        />
        <button className="ll-ghost" type="button" onClick={add}>
          {t.t("addWord")}
        </button>
      </div>

      {[...grouped.entries()].map(([track, list]) => (
        <div key={track}>
          <p className="ll-cuegroup">{t.track(track)}</p>
          {list
            .slice()
            .sort((a, b) => b.weight - a.weight || a.stem.localeCompare(b.stem))
            .map((c) => (
              <div key={c.id} className="ll-cue">
                <span className="ll-cue-stem">{c.stem}</span>
                <span className="ll-cue-w">{c.weight.toFixed(2)}</span>
                <span className={`ll-cue-src ${c.source}`}>
                  {t.t(
                    c.source === "learned"
                      ? "sourceLearned"
                      : c.source === "user"
                        ? "sourceUser"
                        : "sourceSeed",
                  )}
                </span>
                <button
                  className="ll-ghost sm"
                  type="button"
                  onClick={() => reset(c.id)}
                  disabled={c.source === "seed" && c.weight === c.seedWeight}
                >
                  {t.t("reset")}
                </button>
                <button
                  className="ll-x"
                  type="button"
                  onClick={() => remove(c.id)}
                  aria-label={t.t("remove")}
                >
                  ×
                </button>
              </div>
            ))}
        </div>
      ))}
    </section>
  );
}
