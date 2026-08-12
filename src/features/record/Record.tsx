import { useEffect, useMemo, useRef, useState } from "react";
import { api, type EntryPayload, type QuestLinkPreview } from "../../api/client.ts";
import { MAX_TRACK_XP, TRACKS, emptyAwards } from "../../domain/tracks.ts";
import { todayISO } from "../../domain/dates.ts";
import { wordCount } from "../../domain/extract/normalize.ts";
import { useT } from "../../i18n/index.tsx";
import { useVoice } from "./useVoice.ts";
import { promptFor } from "./prompts.ts";
import type { Draft, Entry, Lang, TrackKey } from "../../domain/types.ts";

interface Props {
  onFiled: (entry: Entry) => void;
  onThisDay: { monthAgo: Entry | null; yearAgo: Entry | null } | null;
  lang: Lang;
}

export function Record({ onFiled, onThisDay, lang }: Props) {
  const t = useT();
  const [text, setText] = useState("");
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [awards, setAwards] = useState(emptyAwards());
  const [questLinks, setQuestLinks] = useState<QuestLinkPreview[]>([]);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [showEvidence, setShowEvidence] = useState<TrackKey | null>(null);
  const [reveal, setReveal] = useState(0);
  const [showPrompt, setShowPrompt] = useState(false);

  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const voice = useVoice(lang, (phrase) =>
    setText((prev) => (prev ? `${prev.replace(/\s+$/, "")} ${phrase}` : phrase)),
  );

  const words = useMemo(() => wordCount(text), [text]);

  const read = async () => {
    if (text.trim().length < 15) {
      setError(t.t("tooShort"));
      return;
    }
    setBusy(true);
    setError("");
    setReveal(0);
    try {
      const res = await api.extract(text, date);
      setDraft(res.draft);
      setAwards({ ...res.draft.awards });
      setQuestLinks(res.questLinks);
      setConfirmed([]);
      setRejected([]);
      setShowEvidence(null);

      // Stagger the reveal, as the original did — the numbers landing one by
      // one is most of why filing an entry feels like anything.
      const active = TRACKS.filter((s) => res.draft.awards[s.key] > 0).length;
      timers.current.forEach(clearTimeout);
      timers.current = Array.from({ length: active + 1 }, (_, i) =>
        window.setTimeout(() => setReveal(i + 1), 90 + i * 130),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  const file = async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const payload: EntryPayload = {
        date,
        text: text.trim(),
        lang: draft.lang,
        awards,
        autoAwards: draft.awards,
        mood: draft.mood,
        energy: draft.energy,
        people: [...draft.people, ...confirmed],
        events: draft.events,
        tags: draft.tags.map((x) => ({ stem: x.stem, display: x.display })),
        note: draft.note,
        metrics: draft.metrics.map((m) => ({ ...m, track: m.track })),
        confirmPeople: confirmed,
      };
      const res = await api.createEntry(payload);
      setDraft(null);
      setText("");
      setDate(todayISO());
      onFiled(res.entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setSaving(false);
  };

  const nudge = (key: TrackKey, delta: number) =>
    setAwards((a) => ({
      ...a,
      [key]: Math.max(0, Math.min(MAX_TRACK_XP, a[key] + delta)),
    }));

  /* ── the writing screen ───────────────────────────────────────── */

  if (!draft) {
    const pending = onThisDay?.monthAgo ?? onThisDay?.yearAgo ?? null;
    return (
      <section className="ll-pane">
        {error && <div className="ll-error">{error}</div>}

        <div className="ll-daterow">
          <label className="ll-label" htmlFor="ll-date">
            {t.t("entryDate")}
          </label>
          <input
            id="ll-date"
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value)}
            className="ll-date"
          />
          <button
            className="ll-ghost sm"
            onClick={() => setShowPrompt((v) => !v)}
            type="button"
          >
            {t.t("prompt")}
          </button>
          {voice.supported && (
            <button
              className={`ll-ghost sm${voice.listening ? " on" : ""}`}
              onClick={voice.listening ? voice.stop : voice.start}
              type="button"
            >
              {voice.listening ? t.t("listening") : t.t("listen")}
            </button>
          )}
        </div>

        {showPrompt && <p className="ll-note">{promptFor(date, lang)}</p>}

        <textarea
          className="ll-write"
          value={voice.interim ? `${text} ${voice.interim}` : text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.t("writePlaceholder")}
        />

        <div className="ll-actions">
          <span className="ll-count">
            {t.number(words)} {t.t("words")}
          </span>
          <button className="ll-seal" onClick={read} disabled={busy} type="button">
            {busy ? t.t("reading") : t.t("seal")}
          </button>
        </div>

        {pending && (
          <>
            <p className="ll-label">{t.t("onThisDay")}</p>
            <article className="ll-row">
              <div className="ll-row-top">
                <span className="ll-row-date">{t.date(pending.date)}</span>
                <span className="ll-rule" />
                <span className="ll-row-sum">
                  {onThisDay?.monthAgo === pending ? t.t("monthAgo") : t.t("yearAgo")}
                </span>
              </div>
              {pending.note && <p className="ll-note">{pending.note}</p>}
              <p className="ll-excerpt">{pending.text}</p>
            </article>
          </>
        )}
      </section>
    );
  }

  /* ── the draft screen ─────────────────────────────────────────── */

  const scored = TRACKS.filter((s) => awards[s.key] > 0 || draft.awards[s.key] > 0);
  const candidates = draft.personCandidates.filter(
    (c) => !confirmed.includes(c) && !rejected.includes(c),
  );

  return (
    <section className="ll-pane">
      {error && <div className="ll-error">{error}</div>}

      <p className="ll-label">
        {t.t("awarded")} — {t.date(date)}
      </p>

      <div className="ll-awards">
        {scored.map((s, i) => {
          const evidence = draft.evidence.filter((e) => e.track === s.key);
          const xp = awards[s.key];
          return (
            <div key={s.key}>
              <div
                className={`ll-award${reveal > i ? " in" : ""}${xp === 0 ? " zero" : ""}`}
              >
                <span className="ll-award-name">{t.track(s.key)}</span>
                {evidence.length > 0 && (
                  <button
                    className="ll-why"
                    type="button"
                    onClick={() =>
                      setShowEvidence((cur) => (cur === s.key ? null : s.key))
                    }
                  >
                    {t.t("whyThisNumber")}
                  </button>
                )}
                <span className="ll-dots" />
                <div className="ll-nudge">
                  <button
                    onClick={() => nudge(s.key, -5)}
                    aria-label={`− ${t.track(s.key)}`}
                    type="button"
                  >
                    −
                  </button>
                  <span className={`ll-xp${xp === 0 ? " muted" : ""}`}>+{xp}</span>
                  <button
                    onClick={() => nudge(s.key, 5)}
                    aria-label={`+ ${t.track(s.key)}`}
                    type="button"
                  >
                    +
                  </button>
                </div>
              </div>

              {showEvidence === s.key && (
                <div className="ll-evidence">
                  {evidence.map((e, k) => (
                    <span
                      key={`${e.stem}-${k}`}
                      className={`ll-ev${e.negated ? " neg" : e.modifier > 1 ? " up" : ""}`}
                      title={`${e.stem} × ${e.weight} × ${e.modifier}`}
                    >
                      {e.surface}
                      {e.negated ? ` (${t.t("negated")})` : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {scored.length === 0 && <p className="ll-note">{t.t("nothingScored")}</p>}
      </div>

      <div className={`ll-readout${reveal > scored.length ? " in" : ""}`}>
        <div className="ll-vitals">
          <div>
            <span className="ll-label">{t.t("mood")}</span>
            <b>{draft.mood ?? "—"}</b>
          </div>
          <div>
            <span className="ll-label">{t.t("energy")}</span>
            <b>{draft.energy ?? "—"}</b>
          </div>
          <div>
            <span className="ll-label">{t.t("people")}</span>
            <b>{draft.people.length + confirmed.length || "—"}</b>
          </div>
        </div>

        {draft.note && <p className="ll-note">{draft.note}</p>}

        {draft.events.length > 0 && (
          <ul className="ll-events">
            {draft.events.map((ev, i) => (
              <li key={i}>{ev}</li>
            ))}
          </ul>
        )}

        {draft.metrics.length > 0 && (
          <div className="ll-chips">
            {draft.metrics.map((m, i) => (
              <span key={i} className="ll-chip">
                {m.value} {m.unit} · {m.kind.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        )}

        {questLinks.length > 0 && (
          <div className="ll-chips">
            {questLinks.map((q) => (
              <span key={q.questId} className="ll-chip quest">
                {t.t("advances")}: {q.title}
              </span>
            ))}
          </div>
        )}

        {candidates.length > 0 && (
          <div className="ll-ask">
            <span>{t.t("confirmPerson")}</span>
            {candidates.map((c) => (
              <span key={c} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <b style={{ fontWeight: 400, color: "var(--bone)" }}>{c}</b>
                <button
                  className="ll-ghost sm"
                  type="button"
                  onClick={() => setConfirmed((v) => [...v, c])}
                >
                  {t.t("yes")}
                </button>
                <button
                  className="ll-ghost sm"
                  type="button"
                  onClick={() => setRejected((v) => [...v, c])}
                >
                  {t.t("no")}
                </button>
              </span>
            ))}
          </div>
        )}

        {(draft.people.length > 0 || confirmed.length > 0) && (
          <div className="ll-chips">
            {[...draft.people, ...confirmed].map((p) => (
              <span key={p} className="ll-chip">
                {p}
              </span>
            ))}
          </div>
        )}

        <div className="ll-tags">
          {draft.tags.map((x) => (
            <span key={x.stem}>{x.display}</span>
          ))}
        </div>
      </div>

      <div className="ll-actions">
        <button className="ll-ghost" onClick={() => setDraft(null)} type="button">
          {t.t("backToText")}
        </button>
        <button className="ll-seal" onClick={file} disabled={saving} type="button">
          {saving ? t.t("saving") : t.t("fileIt")}
        </button>
      </div>
    </section>
  );
}
