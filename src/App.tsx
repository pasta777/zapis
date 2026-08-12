import { useCallback, useEffect, useState } from "react";
import { api, type StatsResponse, type StudyResponse } from "./api/client.ts";
import { I18nProvider, useT } from "./i18n/index.tsx";
import { Record } from "./features/record/Record.tsx";
import { Sheet } from "./features/sheet/Sheet.tsx";
import { Ledger } from "./features/ledger/Ledger.tsx";
import { Study } from "./features/study/Study.tsx";
import { Review } from "./features/review/Review.tsx";
import { Quests } from "./features/quests/Quests.tsx";
import { People } from "./features/people/People.tsx";
import { Lexicon } from "./features/lexicon/Lexicon.tsx";
import { Data } from "./features/data/Data.tsx";
import type { Alert, Entry, Lang, Settings } from "./domain/types.ts";

const TABS = [
  "record", "sheet", "ledger", "study",
  "review", "quests", "people", "lexicon", "data",
] as const;

type Tab = (typeof TABS)[number];

const DEFAULT_SETTINGS: Settings = {
  lang: "en",
  halfLife: 14,
  xpScale: 7.5,
  notify: false,
  restDays: false,
};

const LANG_CACHE_KEY = "zapis:lang";

/**
 * Last known interface language, remembered locally.
 *
 * Settings live on the server, but waiting for that round trip before drawing
 * anything means a blank screen on every single load. Caching just the
 * language lets the first paint be correct — and the server remains the source
 * of truth the moment its answer arrives.
 */
function cachedLang(): Lang {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS.lang;
  const v = localStorage.getItem(LANG_CACHE_KEY);
  return v === "sr" || v === "en" ? v : DEFAULT_SETTINGS.lang;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>({
    ...DEFAULT_SETTINGS,
    lang: cachedLang(),
  });

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSettings(s);
        try {
          localStorage.setItem(LANG_CACHE_KEY, s.lang);
        } catch {
          /* private mode: the cache is an optimisation, not a requirement */
        }
      })
      .catch(() => {
        /* Server unreachable: the shell still renders and shows the error. */
      });
  }, []);

  const update = (s: Settings) => {
    setSettings(s);
    try {
      localStorage.setItem(LANG_CACHE_KEY, s.lang);
    } catch {
      /* ignore */
    }
  };

  return (
    <I18nProvider lang={settings.lang}>
      <Shell settings={settings} setSettings={update} />
    </I18nProvider>
  );
}

function isTab(v: string): v is Tab {
  return (TABS as readonly string[]).includes(v);
}

/** The tab named in the URL fragment, so a view can be linked and restored. */
function tabFromHash(): Tab {
  if (typeof window === "undefined") return "record";
  const raw = window.location.hash.replace(/^#\/?/, "");
  return isTab(raw) ? raw : "record";
}

function Shell({
  settings,
  setSettings,
}: {
  settings: Settings;
  setSettings: (s: Settings) => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>(tabFromHash);

  /*
   * Keep the fragment and the active tab in step, in both directions: the URL
   * makes a view linkable and survives a reload, and listening for hashchange
   * makes the browser's Back button behave the way every user expects it to.
   */
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (next: Tab) => {
    setTab(next);
    if (typeof window !== "undefined" && tabFromHash() !== next) {
      window.location.hash = `/${next}`;
    }
  };
  const [entries, setEntries] = useState<Entry[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [study, setStudy] = useState<StudyResponse | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [onThisDay, setOnThisDay] = useState<{
    monthAgo: Entry | null;
    yearAgo: Entry | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [notified, setNotified] = useState<Set<number>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const [e, s, a, otd] = await Promise.all([
        api.entries(),
        api.stats(),
        api.alerts(),
        api.onThisDay(),
      ]);
      setEntries(e);
      setStats(s);
      setAlerts(a);
      setOnThisDay(otd);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Study data is heavier; fetch it only when that tab is opened.
  useEffect(() => {
    if (tab !== "study") return;
    api.study().then(setStudy).catch(() => setStudy(null));
  }, [tab, entries.length]);

  /**
   * Desktop notification for a decay crossing.
   *
   * Fires once per alert per session. The browser can only do this while the
   * page is open — the setting says so, and there is no way around it from a
   * web app without a background service.
   */
  useEffect(() => {
    if (!settings.notify) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    for (const a of alerts) {
      if (notified.has(a.id)) continue;
      new Notification(`${t.track(a.track)} — ${t.momentum("dormant")}`, {
        body: `${t.t("decayAlert")} ${a.peak} ${t.t("decayTo")} ${a.current}.`,
        tag: `zapis-alert-${a.id}`,
      });
      setNotified((prev) => new Set(prev).add(a.id));
    }
  }, [alerts, settings.notify, notified, t]);

  const saveSettings = async (patch: Partial<Settings>) => {
    const next = await api.saveSettings(patch);
    setSettings(next);
    await refresh();
  };

  const dismiss = async (id: number) => {
    await api.dismissAlert(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div className="ll">
      <header className="ll-head">
        <div className="ll-brand">
          <span className="ll-mark">§</span>
          <span>{t.s.brand}</span>
        </div>
        <div className="ll-meta">
          <span>
            {t.number(entries.length)} {t.t("entries")}
          </span>
          <i>·</i>
          <span>
            {stats?.streak ?? 0} {t.t("dayStreak")}
          </span>
          <i>·</i>
          <button
            className="ll-langtoggle"
            type="button"
            onClick={() => saveSettings({ lang: settings.lang === "en" ? "sr" : "en" })}
          >
            {settings.lang === "en" ? "SR" : "EN"}
          </button>
        </div>
      </header>

      <nav className="ll-tabs">
        {TABS.map((k) => (
          <button
            key={k}
            onClick={() => go(k)}
            className={`ll-tab${tab === k ? " on" : ""}`}
            type="button"
          >
            {t.tab(k)}
          </button>
        ))}
      </nav>

      {error && <div className="ll-error">{error}</div>}

      {alerts.map((a) => (
        <div
          key={a.id}
          className={`ll-banner${a.kind === "decay_warning" ? " warn" : ""}`}
        >
          <span>
            <b>{t.track(a.track)}</b> {t.t("decayAlert")} {a.peak} {t.t("decayTo")}{" "}
            {a.current}.
          </span>
          <span className="ll-rule" />
          <button className="ll-ghost sm" type="button" onClick={() => dismiss(a.id)}>
            {t.t("dismiss")}
          </button>
        </div>
      ))}

      {tab === "record" && (
        <Record
          lang={settings.lang}
          onThisDay={onThisDay}
          onFiled={() => {
            void refresh();
            go("sheet");
          }}
        />
      )}
      {tab === "sheet" && <Sheet data={stats} />}
      {tab === "ledger" && <Ledger entries={entries} onDeleted={() => void refresh()} />}
      {tab === "study" && <Study stats={stats} study={study} />}
      {tab === "review" && <Review />}
      {tab === "quests" && <Quests onChanged={() => void refresh()} />}
      {tab === "people" && <People />}
      {tab === "lexicon" && <Lexicon onChanged={() => void refresh()} />}
      {tab === "data" && (
        <Data
          settings={settings}
          onSettings={(p) => void saveSettings(p)}
          onImported={() => void refresh()}
        />
      )}
    </div>
  );
}
