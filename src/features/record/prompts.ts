import type { Lang } from "../../domain/types.ts";

/**
 * Prompts for the days you sit down with nothing.
 *
 * Written to elicit concrete recall rather than reflection — the engine
 * scores what you did, so "who did you speak to" produces a more useful
 * entry than "how do you feel about your life".
 */
const PROMPTS: Record<Lang, string[]> = {
  en: [
    "What took the most time today, and was it what you meant to spend it on?",
    "Who did you talk to, and what did they say that stuck?",
    "What did you make, fix, or finish?",
    "What did you learn that you didn't know yesterday?",
    "What did your body do today — and what did it ask for that you ignored?",
    "What did you avoid?",
    "What was the smallest good thing?",
    "Where did the day surprise you?",
    "What would you tell yourself this morning, knowing how it went?",
    "What are you carrying into tomorrow?",
    "What did you rest with, on purpose?",
    "Name one thing you'd forget by next week if you didn't write it down.",
  ],
  sr: [
    "Šta ti je danas oduzelo najviše vremena, i je li to ono na šta si nameravao?",
    "S kim si razgovarao, i šta je ostalo od tog razgovora?",
    "Šta si napravio, popravio ili završio?",
    "Šta si naučio danas što juče nisi znao?",
    "Šta je tvoje telo danas radilo — i šta je tražilo, a ti nisi dao?",
    "Šta si izbegavao?",
    "Koja je bila najmanja dobra stvar?",
    "Gde te je dan iznenadio?",
    "Šta bi rekao sebi jutros, sad kad znaš kako je prošlo?",
    "Šta nosiš u sutra?",
    "Čime si se namerno odmarao?",
    "Navedi jednu stvar koju bi za nedelju dana zaboravio da je nisi zapisao.",
  ],
};

/** Deterministic per (date, language), so refreshing doesn't reshuffle it. */
export function promptFor(date: string, lang: Lang): string {
  const list = PROMPTS[lang];
  let h = 0;
  for (let i = 0; i < date.length; i++) h = (h * 31 + date.charCodeAt(i)) >>> 0;
  return list[h % list.length]!;
}
