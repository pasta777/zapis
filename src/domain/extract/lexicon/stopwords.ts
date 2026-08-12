/* ────────────────────────────────────────────────────────────────
   Stopwords (for tagging) and the name stoplist (for people).

   The name stoplist matters more than it looks: without it, every
   "Monday", "Belgrade" and "YouTube" becomes a person you know.
   ──────────────────────────────────────────────────────────────── */

import { fold } from "../normalize.ts";
import type { Lang } from "../../types.ts";

const EN_STOP = `a about above after again against all am an and any are aren't as at
be because been before being below between both but by can cannot could couldn't did
didn't do does doesn't doing don't down during each few for from further had hadn't has
hasn't have haven't having he her here hers herself him himself his how i if in into is
isn't it its itself just let's me more most mustn't my myself no nor not of off on once
only or other ought our ours ourselves out over own same shan't she should shouldn't so
some such than that the their theirs them themselves then there these they this those
through to too under until up very was wasn't we were weren't what when where which
while who whom why with won't would wouldn't you your yours yourself yourselves
got get go going went really quite bit lot thing things day today yesterday tomorrow
morning afternoon evening night time also still even much many one two three
felt feel feeling was were had did made make also then back around still`;

const SR_STOP = `a ako ali bez bi bih bila bili bilo bio biti brzo cak ce cega cemu ces
cu da dakle dana danas do dok dosta drugi gde god ga i iako ih ili ima imam imao ipak
iz izmedju izvan ja je jedan jedna jedno jer jesam jos ju juce kad kada kako kao koja
koje koji koju kroz li ma malo me medju mene meni mi mimo mnogo moj moja moje mora
morao mu na nad nakon nam nama nas nasa nase nazad ne nego neka neki nekog nekoliko
nema nemam ni nije nikad nisam niste nisu njega njemu njen njih njihov no nula od oko
on ona oni ono onda opet osim ovaj ova ovo pa pak po pod pored posle pre preko pri
protiv radi rekao s sa sam samo se sebe sebi si sto stvarno su sutra svaki sve svi
svoj svoja svoje ta tada taj tako takodje tamo te tebe tebi ti to toj tom tu u uz
vam vas vec veoma vi vise za zar zato zbog ce cemo cete
bio bila bilo bili dan dana danas jutro vece noc vreme jedan dva tri
prvi drugi treci nesto neko negde nikako uvek ponekad`;

function toSet(raw: string): Set<string> {
  return new Set(
    raw
      .split(/\s+/)
      .map((x) => fold(x.trim()))
      .filter((x) => x.length > 0),
  );
}

/**
 * Never useful as a tag, in either language: measurement units, bare
 * intensifiers, and the indefinite pronouns. "3 hours of study" should tag
 * `study`, not `hours`; "veoma intenzivno" should tag neither word.
 */
const NEVER_A_TAG = `
hour hours hr hrs minute minutes min mins second seconds
sat sata sati cas casa casova minut minuta sekund sekundi
km kilometer kilometers kilometar kilometara meter meters metar metara
page pages str strana strane stranica stranica rep reps set sets
serija serije step steps korak koraka kg kilo kilograma
very really extremely incredibly hugely massively finally entire whole
constantly nonstop deeply seriously properly thoroughly completely totally
veoma vrlo jako mnogo previse izuzetno neverovatno intenzivno konacno
ceo cela cijeli sav stalno neprekidno duboko ozbiljno kompletno totalno
bit little slightly briefly barely just only somewhat quick quickly short
shortly almost nearly half lightly casually
malo pomalo samo jedva kratko tek blago brzo povrsno skoro gotovo pola
usput nakratko delimicno
nothing something anything everything nobody somebody everyone someone
nista nesto nista neko svako niko svi sve
`;

const NEVER_A_TAG_SET = toSet(NEVER_A_TAG);

export const STOPWORDS: Record<Lang, Set<string>> = {
  en: new Set([...toSet(EN_STOP), ...NEVER_A_TAG_SET]),
  sr: new Set([...toSet(SR_STOP), ...NEVER_A_TAG_SET]),
};

export function isStopword(folded: string, lang: Lang): boolean {
  return STOPWORDS[lang].has(folded) || STOPWORDS.en.has(folded);
}

/**
 * Capitalised words that are not people. Weekdays, months, places, products,
 * and the handful of nouns Serbian and English both capitalise mid-sentence.
 */
const NOT_A_NAME = `
monday tuesday wednesday thursday friday saturday sunday
january february march april may june july august september october november december
ponedeljak utorak srijeda sreda cetvrtak petak subota nedelja nedjelja
januar februar mart april maj jun juni jul juli avgust septembar oktobar novembar decembar
god godine bog boze gospod hrist hristos isus uskrs bozic vaskrs
beograd novi sad nis kragujevac subotica zemun vojvodina srbija serbia
london paris berlin vienna wien budapest zagreb sarajevo skoplje podgorica
europe europa america amerika balkan
google youtube jutjub facebook instagram twitter github gitlab netflix spotify
whatsapp viber telegram slack notion figma docker python javascript typescript
react node linux windows macos android iphone chrome firefox claude chatgpt openai
excel word powerpoint outlook zoom teams jira duolingo anki obsidian steam
covid internet email mail pdf api sql css html json http
i i'm i'd i'll i've ok okay yes no
`;

/**
 * Serbian case endings, stripped so the stoplist matches inflected forms.
 *
 * Kept deliberately in step with `nameBase` in people.ts: without it, the list
 * blocks "Duolingo" but sails straight past "Duolingu", and a language-learning
 * app joins your circle of friends. Same for "sa Netflixom", "u Beogradu".
 */
const TRAILING_CASE = /(?:ovima|evima|ovim|evim|ama|ima|om|em|ju|u|a|e|i|o)$/;

function withCaseVariants(words: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const w of words) {
    out.add(w);
    const base = w.replace(TRAILING_CASE, "");
    if (base.length >= 3) out.add(base);
  }
  return out;
}

export const NAME_STOPLIST: Set<string> = withCaseVariants(toSet(NOT_A_NAME));

/**
 * Function words that legitimately open a sentence, so a capital letter on
 * them proves nothing. Used to decide whether a sentence-initial capital is
 * a name candidate.
 */
const SENTENCE_OPENERS = `
the a an this that these those there here it he she they we you i my his her their our
today tomorrow yesterday after before when while because but and so then also however
was were had did have has been being am is are do does not no yes if since although
danas juce sutra posle pre kad kada dok jer ali i pa onda takodje medjutim
bio bila bilo bili je su sam nisam nije ovo taj ta to moj moja moje
nakon zatim zato ipak mozda verovatno konacno uglavnom obicno
`;

export const SENTENCE_OPENER_SET: Set<string> = toSet(SENTENCE_OPENERS);
