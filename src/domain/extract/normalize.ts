/* ────────────────────────────────────────────────────────────────
   Normalisation. Everything the engine matches on is "folded":
   lowercase, Cyrillic transliterated to Latin, diacritics removed.
   Display always uses the original text — folding is a lookup key,
   never something the reader sees.

   This single step is why трчање, trčanje and trcanje all become
   one tag instead of three.
   ──────────────────────────────────────────────────────────────── */

/** Serbian Cyrillic → Latin. Digraph letters expand to two Latin chars. */
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "dj", е: "e", ж: "z",
  з: "z", и: "i", ј: "j", к: "k", л: "l", љ: "lj", м: "m", н: "n",
  њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t", ћ: "c", у: "u",
  ф: "f", х: "h", ц: "c", ч: "c", џ: "dz", ш: "s",
};

/** Latin diacritics → ASCII. đ→dj matches the Cyrillic ђ mapping above. */
const DIACRITIC_TO_ASCII: Record<string, string> = {
  č: "c", ć: "c", ž: "z", š: "s", đ: "dj",
  // Precomposed forms that survive NFC.
  ĉ: "c", ǆ: "dz",
};

export function transliterate(text: string): string {
  let out = "";
  for (const ch of text) out += CYRILLIC_TO_LATIN[ch] ?? ch;
  return out;
}

/** Combining diacritical marks, for input that arrives decomposed. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

export function foldDiacritics(text: string): string {
  let out = "";
  for (const ch of text) out += DIACRITIC_TO_ASCII[ch] ?? ch;
  return out.normalize("NFD").replace(COMBINING_MARKS, "");
}

/** The canonical match key for a word or phrase. */
export function fold(text: string): string {
  return foldDiacritics(transliterate(text.normalize("NFC").toLowerCase()));
}

export interface Token {
  /** As written, for display and evidence highlighting. */
  surface: string;
  /** Folded, for matching. */
  folded: string;
  start: number;
  end: number;
  isCapitalised: boolean;
  isAllCaps: boolean;
  /** Index of the sentence this token belongs to. */
  sentence: number;
  /** Index of the clause (sentences split further on , ; ali/but/pa). */
  clause: number;
  /** True when this is the first word of its sentence. */
  sentenceInitial: boolean;
}

export interface Sentence {
  text: string;
  start: number;
  end: number;
  index: number;
}

/**
 * Word characters: Latin + Cyrillic letters, digits, and intra-word marks.
 *
 * Numbers are matched by their own leading alternative so that decimals stay
 * whole in both conventions — `7,5` as well as `7.5` — and so glued units
 * like `3h` and `12km` arrive as single tokens. Without the comma branch,
 * "7,5 kilometara" tokenised as `7`, `5`, `kilometara` and the quantity was
 * silently lost.
 *
 * A fresh instance per call: a shared `lastIndex` across `exec` and `match`
 * would drop tokens at random.
 */
const wordRe = () =>
  /\d+(?:[.,]\d+)*\p{L}*|[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*/gu;

/** Trim whitespace while reporting where the trimmed span actually starts. */
function trimmedSpan(text: string, from: number, to: number) {
  let s = from;
  let e = to;
  while (s < e && /\s/.test(text[s]!)) s++;
  while (e > s && /\s/.test(text[e - 1]!)) e--;
  return { start: s, end: e, text: text.slice(s, e) };
}

/**
 * Sentence boundaries. Abbreviation-aware enough for prose: a period only
 * ends a sentence when followed by whitespace and an uppercase letter or
 * end-of-text, so "3.5 sata" and "npr. sutra" stay intact.
 */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  let index = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const isTerminator = ch === "." || ch === "!" || ch === "?" || ch === "\n";
    if (!isTerminator) continue;

    // Consume runs like "!!!" or "?!" or a blank line.
    let j = i;
    while (j + 1 < text.length && ".!?\n".includes(text[j + 1]!)) j++;

    const after = text.slice(j + 1);
    const nextChar = /\S/.exec(after)?.[0];
    const breaks =
      ch === "\n" ||
      nextChar === undefined ||
      nextChar === nextChar.toUpperCase();

    if (breaks) {
      const span = trimmedSpan(text, start, j + 1);
      if (span.text.length > 0) out.push({ ...span, index: index++ });
      start = j + 1;
    }
    i = j;
  }

  const tail = trimmedSpan(text, start, text.length);
  if (tail.text.length > 0) out.push({ ...tail, index: index++ });
  return out;
}

/**
 * Clause boundary markers. Negation scope stops here, which is what keeps
 * "nisam trčao, ali sam čitao" from suppressing the reading.
 */
const CLAUSE_BREAKERS = new Set([
  "ali", "but", "pa", "iako", "although", "though", "however", "medjutim",
  "i", "and", "then", "zatim", "onda", "jer", "because", "dok", "while",
]);

export function tokenize(text: string): {
  tokens: Token[];
  sentences: Sentence[];
} {
  const sentences = splitSentences(text);
  const tokens: Token[] = [];
  let clause = 0;

  for (const s of sentences) {
    let first = true;
    let prevEnd = s.start;
    const re = wordRe();
    let m: RegExpExecArray | null;

    while ((m = re.exec(s.text)) !== null) {
      const surface = m[0];
      const start = s.start + m.index;

      // Punctuation between the previous word and this one starts a new clause.
      const gap = text.slice(prevEnd, start);
      if (/[,;:—–(]/.test(gap)) clause++;

      const folded = fold(surface);
      if (CLAUSE_BREAKERS.has(folded) && !first) clause++;

      const hasLetters = /\p{L}/u.test(surface);
      tokens.push({
        surface,
        folded,
        start,
        end: start + surface.length,
        isCapitalised:
          hasLetters && surface[0] === surface[0]!.toUpperCase() &&
          surface[0] !== surface[0]!.toLowerCase(),
        isAllCaps:
          hasLetters && surface.length > 1 && surface === surface.toUpperCase(),
        sentence: s.index,
        clause,
        sentenceInitial: first,
      });
      first = false;
      prevEnd = start + surface.length;
    }
    clause++; // every sentence starts a fresh clause
  }

  return { tokens, sentences };
}

export function wordCount(text: string): number {
  return (text.match(wordRe()) ?? []).length;
}
