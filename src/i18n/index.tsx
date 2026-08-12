import React, { createContext, useContext, useMemo } from "react";
import { en, type Strings } from "./en.ts";
import { sr } from "./sr.ts";
import type { Lang, TrackKey } from "../domain/types.ts";
import type { Finding } from "../domain/review.ts";
import type { MomentumLabel } from "../domain/xp.ts";

const DICTS: Record<Lang, Strings> = { en, sr };

export interface Translator {
  lang: Lang;
  s: Strings;
  /** UI string by key, falling back to the key itself so nothing renders blank. */
  t: (key: keyof Strings["ui"] | string) => string;
  track: (key: TrackKey) => string;
  trackHint: (key: TrackKey) => string;
  momentum: (label: MomentumLabel) => string;
  tab: (key: string) => string;
  /** Render a review finding, translating any track name inside its data. */
  finding: (f: Finding) => string;
  achievement: (id: string) => string;
  date: (iso: string, opts?: Intl.DateTimeFormatOptions) => string;
  number: (n: number, opts?: Intl.NumberFormatOptions) => string;
}

const Ctx = createContext<Translator | null>(null);

function build(lang: Lang): Translator {
  const s = DICTS[lang];
  const track = (key: TrackKey) => s.tracks[key]?.name ?? key;

  return {
    lang,
    s,
    // Falls back to the key itself, so a missing string is visible in the UI
    // rather than rendering as an empty gap nobody notices.
    t: (key) => s.ui[key as string] ?? String(key),
    track,
    trackHint: (key) => s.tracks[key]?.hint ?? "",
    momentum: (label) => s.momentum[label] ?? label,
    tab: (key) => (s.tabs as Record<string, string>)[key] ?? key,

    finding: (f) => {
      const fn = s.finding[f.kind];
      if (!fn) return f.kind;
      // Detectors emit raw track keys so they stay language-agnostic;
      // localising here is the last possible moment.
      const data = { ...f.data };
      if (typeof data.track === "string") {
        // The raw key is kept alongside the label because Serbian participles
        // must agree with the track name's gender, and the localised label
        // can't be inspected for that.
        data.trackKey = data.track;
        data.track = track(data.track as TrackKey);
      }
      return fn(data);
    },

    achievement: (id) => s.achievement[id] ?? id,

    date: (iso, opts) => {
      const d = new Date(`${iso}T12:00:00Z`);
      if (Number.isNaN(d.getTime())) return iso;
      return new Intl.DateTimeFormat(
        s.code,
        opts ?? { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" },
      ).format(d);
    },

    number: (n, opts) => new Intl.NumberFormat(s.code, opts).format(n),
  };
}

export function I18nProvider({
  lang,
  children,
}: {
  lang: Lang;
  children: React.ReactNode;
}) {
  const value = useMemo(() => build(lang), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT(): Translator {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useT must be used inside <I18nProvider>");
  return ctx;
}

export { en, sr };
