import { useEffect, useMemo, useState } from "react";
import { api, type SearchHit } from "../../api/client.ts";
import { TRACKS } from "../../domain/tracks.ts";
import { totalXp } from "../../domain/stats.ts";
import { useT } from "../../i18n/index.tsx";
import type { Entry } from "../../domain/types.ts";

interface Props {
  entries: Entry[];
  onDeleted: (id: number) => void;
}

export function Ledger({ entries, onDeleted }: Props) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);

  // Debounced so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    setSearching(true);
    const id = window.setTimeout(() => {
      api
        .search(q)
        .then(setHits)
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 220);
    return () => {
      clearTimeout(id);
      setSearching(false);
    };
  }, [query]);

  const sorted = useMemo(
    () => [...entries].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [entries],
  );

  const remove = async (id: number) => {
    await api.deleteEntry(id);
    onDeleted(id);
  };

  const list = hits ? hits.map((h) => h.entry) : sorted;

  return (
    <section className="ll-pane">
      <div className="ll-daterow">
        <input
          className="ll-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.t("searchPlaceholder")}
          aria-label={t.t("search")}
        />
      </div>

      {hits !== null && (
        <p className="ll-mono">
          {searching ? "…" : `${hits.length} / ${entries.length}`}
        </p>
      )}

      {list.length === 0 && (
        <p className="ll-empty">{hits ? t.t("noResults") : t.t("ledgerBlank")}</p>
      )}

      {list.map((e, i) => {
        const snippet = hits?.[i]?.snippet;
        const open = expanded === e.id;
        return (
          <article key={e.id} className="ll-row">
            <div className="ll-row-top">
              <span className="ll-row-date">{t.date(e.date)}</span>
              <span className="ll-rule" />
              <span className="ll-row-sum">{totalXp(e)} xp</span>
              <button
                className="ll-x"
                onClick={() => remove(e.id)}
                aria-label={`${t.t("delete")} ${e.date}`}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="ll-chips">
              {TRACKS.filter((s) => (e.awards[s.key] ?? 0) > 0).map((s) => (
                <span key={s.key} className="ll-chip">
                  {t.track(s.key)} {e.awards[s.key]}
                </span>
              ))}
              {e.mood !== null && (
                <span className="ll-chip">
                  {t.t("mood")} {e.mood}
                </span>
              )}
              {e.people.map((p) => (
                <span key={p} className="ll-chip">
                  {p}
                </span>
              ))}
            </div>

            {e.note && <p className="ll-note">{e.note}</p>}

            {snippet ? (
              <p
                className="ll-snippet"
                // The snippet's only markup is the ⟦ ⟧ delimiters we asked
                // FTS5 for, which are replaced below — never raw HTML.
              >
                {snippet.split(/⟦|⟧/).map((part, k) =>
                  k % 2 === 1 ? <mark key={k}>{part}</mark> : part,
                )}
              </p>
            ) : (
              <p
                className={`ll-excerpt${open ? " full" : ""}`}
                onClick={() => setExpanded(open ? null : e.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") setExpanded(open ? null : e.id);
                }}
              >
                {e.text}
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}
