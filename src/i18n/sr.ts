import type { FindingData, Strings } from "./en.ts";
import type { TrackKey } from "../domain/types.ts";

/**
 * Grammatical gender of each track name, because Serbian participles and
 * adjectives must agree with their subject.
 *
 * Without this the review reads "Učenje nije zabeležen" where it must say
 * "zabeleženo", and "Igra nije zabeležen" where it must say "zabeležena" —
 * the kind of mistake a native reader notices in the first second and never
 * stops noticing. English needs none of this, which is exactly why the
 * phrases are functions rather than templates with placeholders.
 */
type Gender = "m" | "f" | "n";

const TRACK_GENDER: Record<TrackKey, Gender> = {
  craft: "m", // Rad
  study: "n", // Učenje
  body: "n", // Telo
  bonds: "f", // Veze (plural, agrees like feminine plural)
  creation: "n", // Stvaranje
  spirit: "m", // Duh
  play: "f", // Igra
};

function genderOf(d: FindingData): Gender {
  const key = d.trackKey;
  return typeof key === "string" && key in TRACK_GENDER
    ? TRACK_GENDER[key as TrackKey]
    : "m";
}

/**
 * Participle forms, written out rather than derived.
 *
 * A generic stem-plus-ending helper gets the masculine wrong: `vratila` and
 * `vratilo` share the stem `vrati-`, but the masculine is `vratio`, not
 * `vratil`. Listing the four forms is shorter than the rule that would
 * generate them and cannot be subtly wrong.
 */
interface Forms {
  m: string;
  f: string;
  n: string;
  pl: string;
}

const RECORDED: Forms = {
  m: "zabeležen",
  f: "zabeležena",
  n: "zabeleženo",
  pl: "zabeležene",
};

const RETURNED: Forms = {
  m: "vratio",
  f: "vratila",
  n: "vratilo",
  pl: "vratile",
};

/** "Veze" is a plural noun, so it takes plural agreement throughout. */
function isPlural(d: FindingData): boolean {
  return d.trackKey === "bonds";
}

function form(f: Forms, d: FindingData): string {
  return isPlural(d) ? f.pl : f[genderOf(d)];
}

/** "nije" for a singular subject, "nisu" for the plural one. */
function notAux(d: FindingData): string {
  return isPlural(d) ? "nisu" : "nije";
}

/**
 * Serbian, Latin script.
 *
 * Momentum labels are translated for sense rather than word-for-word:
 * "burning/cooling/dormant" is a fire metaphor, and gori / hladi se /
 * uspavano carries it in Serbian where a literal rendering would not.
 */
export const sr: Strings = {
  code: "sr-RS",
  brand: "ZAPIS",

  tracks: {
    craft: { name: "Rad", hint: "plaćeni i tehnički rad — kod, sistemi, rešeni problemi" },
    study: { name: "Učenje", hint: "namerno učenje — predmeti, jezici, čitanje s razumevanjem" },
    body: { name: "Telo", hint: "spavanje, kretanje, hrana, zdravlje, fizičko održavanje" },
    bonds: { name: "Veze", hint: "pravi kontakt — vreme s ljudima koje je nešto značilo" },
    creation: { name: "Stvaranje", hint: "pravljenje stvari koje ranije nisu postojale" },
    spirit: { name: "Duh", hint: "molitva, razmišljanje, tišina, šta te god drži" },
    play: { name: "Igra", hint: "namerni odmor — resurs, ne kazna" },
  },

  momentum: {
    burning: "gori",
    warm: "toplo",
    steady: "postojano",
    cooling: "hladi se",
    dormant: "uspavano",
  },

  tabs: {
    record: "Zapis",
    sheet: "List",
    ledger: "Knjiga",
    study: "Analiza",
    review: "Pregled",
    quests: "Zadaci",
    people: "Ljudi",
    lexicon: "Rečnik",
    data: "Podaci",
  },

  ui: {
    entries: "zapisa",
    dayStreak: "dana u nizu",
    entryDate: "Datum zapisa",
    words: "reči",
    reading: "Čitam…",
    seal: "Pročitaj zapis",
    fileIt: "Upiši",
    backToText: "Vrati se na tekst",
    awarded: "Dodeljeno",
    mood: "Raspoloženje",
    energy: "Energija",
    people: "Ljudi",
    nothingScored: "Ništa nije zabeleženo. I to je podatak.",
    writePlaceholder:
      "Šta se danas dogodilo? Piši kao da pričaš prijatelju — neuredno je u redu. Ništa ne napušta ovaj računar.",
    tooShort: "Napiši najmanje rečenicu ili dve.",
    noEntries: "Još nema zapisa. List se sam popuni kad zabeležiš dan.",
    ledgerBlank: "Knjiga je prazna.",
    toLevel: "do NIV",
    cold: "hladno",
    lifetime: "ukupno",
    momentumShape: "Oblik zamaha",
    last35: "Poslednjih 35 dana",
    lastYear: "Poslednja godina",
    sameDayMood: "Raspoloženje na dane s pojedinim trakom",
    sameDayCaption:
      "Razlika prema danima bez njega, merena istog dana. Povezanost, ne uzrok — dobro raspoloženje je možda ono što dan omogućava, a ne obrnuto.",
    lagMood: "Sutrašnje raspoloženje posle pojedinog traka",
    lagCaption:
      "Da li trak danas predviđa sutra? Računaju se samo uzastopni zapisani dani; praznine se izostavljaju, ne pogađaju.",
    needMoreDays: "potrebno je još uparenih dana",
    noise: "ne razlikuje se od šuma",
    pairedDays: "uparenih dana do sada",
    sleepLag: "Noćni san i sutrašnje raspoloženje",
    peopleByDays: "Ljudi, po broju dana",
    exportCsv: "Izvezi CSV",
    exportJson: "Izvezi JSON",
    exportMd: "Izvezi Markdown",
    importTitle: "Uvoz",
    importPick: "Izaberi rezervnu kopiju",
    importPreview: "Pregled",
    importCommit: "Uvezi",
    importNew: "novih",
    importIdentical: "istih",
    importConflict: "u sukobu",
    importStrategy: "Kod sukoba",
    strategySkip: "zadrži postojeće",
    strategyReplace: "zameni iz datoteke",
    strategyKeepBoth: "zadrži oba",
    importDone: "Uvezeno",
    weeklyReview: "Nedelja",
    reviewEmpty: "Ove nedelje nije upisano ništa.",
    noReviewYet: "Zapiši nekoliko dana i pregled počinje da primećuje ono što nisi.",
    quests: "Zadaci",
    newQuest: "Objavi nameru",
    questTitle: "Šta hoćeš da završiš?",
    questTracks: "Traci (opciono)",
    questTarget: "Ciljni datum (opciono)",
    declare: "Objavi",
    advances: "napreduje",
    linkedEntries: "povezanih zapisa",
    daysLeft: "dana ostalo",
    overdue: "rok prošao",
    done: "Završeno",
    abandon: "Odustani",
    reopen: "Ponovo otvori",
    noQuests: "Nema zadataka. Objavi nameru i zapisi će se sami povezati.",
    decayAlert: "je pao sa",
    decayTo: "na",
    dismiss: "Odbaci",
    lexicon: "Rečnik",
    lexiconCaption:
      "Svaka reč koju mehanizam boduje i koliko vredi. Ispravka zapisa ih automatski pomera; možeš ih i sam menjati.",
    addWord: "Dodaj reč",
    word: "reč",
    weight: "težina",
    track: "trak",
    language: "jezik",
    reset: "Vrati",
    remove: "Obriši",
    source: "izvor",
    sourceSeed: "osnovno",
    sourceUser: "tvoje",
    sourceLearned: "naučeno",
    search: "Traži",
    searchPlaceholder: "Traži kroz sve što si napisao…",
    noResults: "Ništa nije nađeno.",
    onThisDay: "Na današnji dan",
    monthAgo: "pre mesec dana",
    yearAgo: "pre godinu dana",
    achievements: "Postignuća",
    earned: "osvojeno",
    chapters: "Poglavlja",
    settings: "Podešavanja",
    halfLife: "Poluvreme opadanja (dana)",
    xpScale: "Skala poena",
    restDays: "Oprosti jedan propušten dan nedeljno",
    notify: "Obaveštenja na radnoj površini",
    notifyCaveat: "Radi samo dok je ova stranica otvorena.",
    langLabel: "Jezik interfejsa",
    whyThisNumber: "zašto?",
    negated: "negirano",
    evidence: "Dokaz",
    confirmPerson: "Je li ovo osoba?",
    yes: "Da",
    no: "Ne",
    listen: "Diktiraj",
    listening: "Slušam…",
    stop: "Zaustavi",
    voiceUnsupported: "Ovaj pregledač ne prepoznaje govor.",
    prompt: "Treba ti podsticaj?",
    saving: "Upisujem…",
    saved: "Upisano",
    delete: "Obriši",
    metrics: "Izmereno",
  },

  finding: {
    // "Učenje nije zabeleženo", "Igra nije zabeležena", "Veze nisu zabeležene".
    absence: (d) =>
      `${d.track} ${notAux(d)} ${form(RECORDED, d)} ove nedelje, posle ${d.activeWeeks} od poslednje tri.`,
    trackReturned: (d) =>
      `${d.track} se ${form(RETURNED, d)} posle ${d.silentWeeks} tihe nedelje — ${d.xp} poena.`,
    personDropped: (d) =>
      `${d.person} se pojavio u ${d.weeks} od poslednje četiri nedelje, a u ovoj ne.`,
    personNew: (d) => `${d.person} se pojavljuje prvi put.`,
    momentumSwing: (d) => `Zamah ${d.track} se promenio ${d.delta} (${d.from} → ${d.to}).`,
    varianceShift: (d) =>
      d.direction === "up"
        ? `Raspoloženje je variralo više nego obično (σ ${d.sigma} prema ${d.priorSigma}).`
        : `Raspoloženje je bilo mirnije nego obično (σ ${d.sigma} prema ${d.priorSigma}).`,
    tagNew: (d) => `Novo ove nedelje: ${d.tags}.`,
    tagGone: (d) => `Odsutno ove nedelje: ${d.tags}.`,
    cadence: (d) =>
      `${d.entries} zapisa, prosečno ${d.avgWords} reči, najveća praznina ${d.longestGap} dana.`,
    moodExtreme: (d) =>
      `Najbolji dan ${d.bestDate} (${d.bestMood}), najgori ${d.worstDate} (${d.worstMood}).`,
    quietWeek: () => "Ove nedelje nije upisano ništa.",
  },

  achievement: {
    entries_1: "Prvi zapis upisan",
    entries_10: "Deset dana zabeleženo",
    entries_50: "Pedeset dana zabeleženo",
    entries_100: "Sto dana zabeleženo",
    entries_365: "Tri stotine šezdeset pet dana zabeleženo",
    entries_1000: "Hiljadu dana zabeleženo",
    all_seven: "Svih sedam traka u jednom danu",
    streak_7: "Sedam dana bez prekida",
    streak_30: "Trideset dana bez prekida",
    streak_100: "Sto dana bez prekida",
    honest_zero: "Upisan dan bez ičega za prijaviti",
    people_5: "Pet ljudi u knjizi",
    people_25: "Dvadeset pet ljudi u knjizi",
    one_year: "Godina istorije",
    kindled_craft: "Rad iz uspavanog u goreći",
    kindled_study: "Učenje iz uspavanog u goreće",
    kindled_body: "Telo iz uspavanog u goreće",
    kindled_bonds: "Veze iz uspavanih u goreće",
    kindled_creation: "Stvaranje iz uspavanog u goreće",
    kindled_spirit: "Duh iz uspavanog u goreći",
    kindled_play: "Igra iz uspavane u goreću",
    week_of_craft: "Sedam dana Rada u nizu",
    week_of_study: "Sedam dana Učenja u nizu",
    week_of_body: "Sedam dana Tela u nizu",
    week_of_bonds: "Sedam dana Veza u nizu",
    week_of_creation: "Sedam dana Stvaranja u nizu",
    week_of_spirit: "Sedam dana Duha u nizu",
    week_of_play: "Sedam dana Igre u nizu",
  },
};
