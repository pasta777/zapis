/* ────────────────────────────────────────────────────────────────
   Seed track lexicon.

   Entries are written as SURFACE WORDS and stemmed at load time, so
   this file stays readable and the stemmer stays the single source
   of truth about morphology. Weight is roughly "how much does this
   word, on its own, tell me the day contained this track":

     3  unmistakable  (deploy, liturgija, maraton)
     2  strong        (code, ucio, trcao)
     1  suggestive    (laptop, knjiga, muzika)

   Serbian entries only need one form per verb — the stemmer collapses
   the rest. Where a deverbal noun stems differently (uciti→uci but
   ucenje→ucen) both forms are listed on purpose.

   This is a starting point, not a finished lexicon. The Lexicon tab
   lets you add to it, and the learning loop tunes these weights from
   your own corrections.
   ──────────────────────────────────────────────────────────────── */

import type { Lang, TrackKey } from "../../types.ts";

export interface SeedCue {
  word: string;
  weight: number;
}

export type CueSeed = Record<TrackKey, Record<Lang, SeedCue[]>>;

const w = (weight: number, ...words: string[]): SeedCue[] =>
  words.map((word) => ({ word, weight }));

export const CUE_SEED: CueSeed = {
  craft: {
    en: [
      ...w(3, "deploy", "deployed", "shipped", "production", "refactor", "hotfix", "pullrequest", "merged"),
      ...w(2, "code", "coding", "debug", "bug", "fixed", "commit", "pushed", "review", "sprint",
             "standup", "ticket", "client", "meeting", "server", "database", "api", "test",
             "compile", "build", "release", "migration", "work", "worked", "office", "job",
             "feature", "backend", "frontend", "script", "query", "endpoint", "typescript",
             "python", "sql", "docker", "repo", "branch", "pipeline"),
      ...w(1, "laptop", "keyboard", "terminal", "boss", "colleague", "task", "deadline",
             "email", "slack", "jira", "spreadsheet", "invoice", "overtime"),
    ],
    sr: [
      ...w(3, "deploy", "produkcija", "refaktorisao", "isporucio"),
      ...w(2, "kodirao", "programirao", "debagovao", "bug", "greska", "popravio",
             "komit", "commit", "posao", "radio", "kancelarija", "server", "baza", "upit",
             "testirao", "build", "izdanje", "migracija", "sastanak", "klijent", "zadatak",
             "sprint", "tiket", "funkcionalnost", "skripta", "aplikacija", "sajt"),
      ...w(1, "laptop", "kompjuter", "terminal", "sef", "kolega", "kolege", "rok",
             "mejl", "imejl", "tabela", "faktura", "prekovremeno"),
    ],
  },

  study: {
    en: [
      ...w(3, "exam", "lecture", "coursework", "thesis", "revision", "flashcards", "anki"),
      ...w(2, "studied", "studying", "learned", "learning", "read", "reading", "course",
             "chapter", "notes", "homework", "textbook", "tutorial", "practice", "grammar",
             "vocabulary", "language", "duolingo", "documentation", "paper", "research",
             "understood", "memorised", "memorized", "quiz", "seminar", "class"),
      ...w(1, "book", "pages", "library", "professor", "syllabus", "notebook", "highlighted"),
    ],
    sr: [
      ...w(3, "ispit", "predavanje", "kolokvijum", "diplomski", "seminarski", "gradivo"),
      ...w(2, "ucio", "ucenje", "naucio", "citao", "citanje", "kurs", "poglavlje",
             "beleske", "domaci", "gramatika", "recnik", "jezik", "dokumentacija",
             "istrazivanje", "razumeo", "zapamtio", "skripta", "casovi",
             "fakultet", "skola", "predmet", "literatura"),
      ...w(1, "knjiga", "knjigu", "strane", "biblioteka", "profesor", "sveska", "olovka"),
    ],
  },

  body: {
    en: [
      ...w(3, "marathon", "workout", "deadlift", "squats", "physio", "bloodwork"),
      ...w(2, "ran", "running", "gym", "trained", "training", "lifted", "swim", "swam",
             "cycled", "bike", "walked", "hike", "stretched", "yoga", "pushups", "reps",
             "doctor", "dentist", "vitamins",
             "cooked", "salad", "protein", "hydrated", "steps", "cardio", "pilates"),
      ...w(1, "slept", "sleep", "nap", "rested",
             "tired", "sore", "ate", "breakfast", "lunch", "dinner", "water", "shower",
             "weight", "sick", "headache", "medicine", "appointment"),
    ],
    sr: [
      ...w(3, "maraton", "trening", "teretana", "fizioterapija", "analize"),
      ...w(2, "trcao", "trcanje", "vezbao", "vezbanje", "plivao", "plivanje", "vozio", "bicikl",
             "setao", "setnja", "planinarenje", "istezanje", "joga", "sklekovi", "serija",
             "lekar", "zubar", "vitamini", "kuvao",
             "salata", "proteini", "koraka", "kardio", "pilates", "bazen"),
      ...w(1, "spavao", "spavanje", "odmarao",
             "umoran", "bolan", "jeo", "dorucak", "rucak", "vecera", "voda", "kupanje",
             "kilogram", "bolestan", "glavobolja", "lek", "pregled"),
    ],
  },

  bonds: {
    en: [
      ...w(3, "wedding", "funeral", "reunion", "hearttoheart"),
      ...w(2, "talked", "called", "visited", "dinner", "coffee", "met", "meeting",
             "family", "friend", "friends", "mother", "father", "mum", "dad", "brother",
             "sister", "girlfriend", "boyfriend", "wife", "husband", "conversation",
             "laughed", "hugged", "birthday", "party", "guests", "catchup"),
      ...w(1, "phone", "message", "texted", "together", "shared", "listened"),
    ],
    sr: [
      ...w(3, "svadba", "sahrana", "proslava", "kafana"),
      ...w(2, "razgovarao", "razgovor", "zvao", "pozvao", "posetio", "vecera", "kafa",
             "video", "druzio", "porodica", "prijatelj", "prijatelji", "mama", "tata",
             "majka", "otac", "brat", "sestra", "devojka", "decko", "zena", "muz",
             "smejali", "zagrljaj", "rodjendan", "gosti", "slava", "komsija"),
      ...w(1, "telefon", "poruka", "javio", "zajedno", "podelio", "slusao", "ćerka", "sin"),
    ],
  },

  creation: {
    en: [
      ...w(3, "published", "recorded", "composed", "painted", "sculpted"),
      ...w(2, "wrote", "writing", "drew", "drawing", "sketched", "designed",
             "made", "created", "song", "poem", "story", "essay", "blog", "sideproject",
             "prototype", "photographed", "edited", "video", "logo", "illustration",
             "novel", "draft", "guitar", "piano"),
      ...w(1, "idea", "notebook", "canvas", "brush", "camera", "figma", "blender"),
    ],
    sr: [
      ...w(3, "objavio", "snimio", "komponovao", "slikao", "izdao"),
      ...w(2, "pisao", "pisanje", "crtao", "skicirao", "dizajnirao", "napravio",
             "stvorio", "pesma", "pesmu", "prica", "esej", "blog", "projekat",
             "prototip", "fotografisao", "montirao", "video", "logo", "ilustracija",
             "roman", "poglavlje", "nacrt", "gitara", "klavir", "komponovanje"),
      ...w(1, "ideja", "sveska", "platno", "kicica", "kamera", "boje"),
    ],
  },

  spirit: {
    en: [
      ...w(3, "liturgy", "communion", "confession", "pilgrimage", "vespers", "psalms"),
      ...w(2, "prayed", "prayer", "church", "meditated", "meditation", "fasted", "fasting",
             "gratitude", "silence", "stillness", "scripture", "bible", "gospel",
             "reflected", "reflection", "journaled", "contemplation", "chapel", "icon"),
      ...w(1, "quiet", "candle", "peace", "soul", "god", "faith", "grace", "forgave"),
    ],
    sr: [
      ...w(3, "liturgija", "pricest", "ispovest", "hodocasce", "vecernje", "psalmi", "slava"),
      ...w(2, "molio", "molitva", "crkva", "meditirao", "meditacija", "postio", "post",
             "zahvalnost", "tisina", "jevandjelje", "biblija", "svetogorje",
             "razmisljao", "dnevnik", "manastir", "ikona", "kandilo", "sveca"),
      ...w(1, "mir", "dusa", "bog", "vera", "blagodat", "oprostio", "tiho"),
    ],
  },

  play: {
    en: [
      ...w(3, "concert", "festival", "cinema", "boardgame", "vacation"),
      ...w(2, "played", "playing", "game", "gaming", "film", "movie", "series", "episode",
             "watched", "music", "listened", "album", "chess", "cards", "beer", "wine",
             "relaxed", "fun", "netflix", "steam", "podcast", "hobby",
             "wandered", "explored", "swimming", "beach"),
      ...w(1, "youtube", "phone", "scrolled", "snack", "couch", "weekend", "coffee"),
    ],
    sr: [
      ...w(3, "koncert", "festival", "bioskop", "odmor", "putovanje"),
      ...w(2, "igrao", "igrica", "igrice", "film", "serija", "epizoda", "gledao",
             "muzika", "slusao", "album", "sah", "karte", "pivo", "vino",
             "odmarao", "zabava", "netflix", "podkast", "hobi",
             "setao", "istrazivao", "plaza", "more", "kafic"),
      ...w(1, "jutjub", "telefon", "skrolovao", "uzina", "kauc", "vikend", "kafa"),
    ],
  },
};

/* ── modifiers ──────────────────────────────────────────────────── */

/** Words that suppress everything to the end of their clause. */
export const NEGATORS: Record<Lang, string[]> = {
  en: [
    "not", "n't", "no", "never", "without", "skipped", "missed", "failed",
    "neither", "nor", "hardly", "barely", "couldnt", "didnt", "wasnt",
    "wouldnt", "shouldnt", "havent", "hasnt", "isnt", "arent", "wont",
    "cant", "meant", "planned", "supposed", "intended", "instead",
  ],
  sr: [
    "ne", "ni", "nisam", "nisi", "nije", "nismo", "niste", "nisu",
    "nemam", "nemas", "nema", "nemamo", "nemate", "bez", "nikad", "nikada",
    "niko", "nista", "nikako", "propustio", "preskocio", "zaboravio",
    "odustao", "umesto", "trebao", "nameravao",
  ],
};

/** ×1.6 — the day clearly contained a lot of this. */
export const INTENSIFIERS: Record<Lang, string[]> = {
  en: [
    "very", "really", "extremely", "incredibly", "hugely", "massively",
    "intense", "intensely", "brutal", "brutally", "finally", "entire",
    "whole", "all", "constantly", "nonstop", "marathon", "deep", "deeply",
    "seriously", "properly", "thoroughly", "completely", "totally",
  ],
  sr: [
    "veoma", "vrlo", "jako", "mnogo", "previse", "izuzetno", "neverovatno",
    "intenzivno", "brutalno", "konacno", "ceo", "cela", "cijeli", "sav",
    "sve", "stalno", "neprekidno", "duboko", "ozbiljno", "temeljno",
    "kompletno", "totalno", "ogromno", "silno",
  ],
};

/** ×0.5 — it happened, but barely. */
export const DIMINISHERS: Record<Lang, string[]> = {
  en: [
    "bit", "little", "slightly", "briefly", "barely", "just", "only",
    "somewhat", "quick", "quickly", "short", "shortly", "tried", "attempted",
    "started", "began", "almost", "nearly", "half", "lightly", "casually",
  ],
  sr: [
    "malo", "pomalo", "samo", "jedva", "kratko", "tek", "blago",
    "brzo", "povrsno", "probao", "poceo", "pokusao", "skoro", "gotovo",
    "pola", "usput", "nakratko", "delimicno",
  ],
};
