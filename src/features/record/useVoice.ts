import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "../../domain/types.ts";

/* Minimal typings — the Web Speech API is not in the DOM lib. */
interface SpeechRecognitionAlternative { transcript: string }
interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(i: number): SpeechRecognitionAlternative;
  [i: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(i: number): SpeechRecognitionResult;
  [i: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/**
 * The recogniser constructor, or null where speech recognition doesn't exist.
 *
 * The `typeof window` guard is not defensive padding: this module is imported
 * by the Record tab, so an unguarded global reference crashes the component
 * anywhere there is no DOM — server rendering, tests, a future prerender step.
 * A capability check has to work when the capability's whole environment is
 * absent, not just when the API is.
 */
function ctor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Dictation, for the days when typing is the thing standing between you and
 * writing anything at all. Appends finalised phrases; interim results are
 * exposed separately so the textarea doesn't thrash mid-sentence.
 */
export function useVoice(lang: Lang, onFinal: (text: string) => void) {
  const supported = ctor() !== null;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const ref = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const stop = useCallback(() => {
    ref.current?.stop();
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    const C = ctor();
    if (!C) return;

    const rec = new C();
    rec.lang = lang === "sr" ? "sr-RS" : "en-GB";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let final = "";
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const text = r[0]?.transcript ?? "";
        if (r.isFinal) final += text;
        else pending += text;
      }
      setInterim(pending);
      if (final.trim()) onFinalRef.current(final.trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);

    ref.current = rec;
    rec.start();
    setListening(true);
  }, [lang]);

  // Abort on unmount, or the microphone stays live after navigation.
  useEffect(() => () => ref.current?.abort(), []);

  return { supported, listening, interim, start, stop };
}
