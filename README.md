# Zapis

A character sheet for an actual person. Write prose about your day; it becomes
numbers; the numbers decay.

Seven tracks — Craft, Study, Body, Bonds, Creation, Spirit, Play — earn XP from
what you actually wrote. XP decays with a 14-day half-life, so **momentum**
reflects the recent past rather than a lifetime total: a track you've stopped
feeding goes cold whether or not you once had a hundred good days in it.

Everything runs on your machine. There is no account, no API key, and no
network call to anywhere. Quantification is a local rule engine you can read,
edit, and teach.

```bash
npm install
npm run dev          # api on :8787, app on http://localhost:5173
```

## How the numbers are made

There is no model in the loop. An entry goes through a fixed pipeline:

| Step | What happens |
|---|---|
| **Normalise** | Unicode fold, Cyrillic→Latin, diacritics stripped. `трчање`, `trčanje` and `trcanje` become one key. |
| **Detect language** | Per *sentence*, by stopword overlap, so a mixed Serbian/English entry works. |
| **Stem** | Porter for English (plus an irregular-verb map, because journals are written in the past tense). A hand-rolled suffix stripper for Serbian — no published stemmer for it exists on npm. |
| **Match cues** | A weighted lexicon per track, with clause-scoped negation, intensifiers (×1.6) and diminishers (×0.5). *"Nisam trčao, ali sam čitao"* scores the reading and not the running. |
| **Quantities** | `3 sata`, `nine hours`, `12km`, `7,5 kilometara`, `40 strana` — attributed to the nearest cue in the clause. The most objective signal available, and weighted accordingly. |
| **Score** | `xp = 25 × (1 − e^(−raw/K))`, saturating, so writing more words about one thing cannot farm XP. |
| **Mood & energy** | Two separate lexicons on two separate axes. Neither is invented: both return *null* when the text carries no signal. |
| **People, events, tags** | Names matched against your registry; events quoted verbatim, never paraphrased; tags by TF-IDF against your own past entries, so they sharpen as the journal grows. |
| **Note** | One sentence, assembled from computed facts in the register of a records clerk. |

Every number is traceable. The `why?` link on the draft screen shows the exact
words that produced it, including the ones that were negated.

### It learns from your corrections

Nudge a track with `±` and the cues that fired for it shift weight — a little,
not a lot. Over weeks the lexicon converges on your vocabulary. The **Lexicon**
tab shows every word and weight, marks the ones the loop has moved, and lets
you edit or reset any of them. Nothing is hidden and nothing is irreversible.

Expect to correct it often in week one and rarely by month two.

## What it notices

- **Weekly review** — deliberately weighted toward *absence*: a track that went
  quiet after three active weeks, a person who appeared in three of the last
  four weeks and not in this one. Those are set differences over your own
  history, which is why they don't need a model.
- **Lag correlations** — does a Body day predict a *better tomorrow*? Only
  consecutive written days count; gaps are excluded rather than guessed. The
  screen refuses to print a number until it has ≥8 days on each side of the
  split, and greys out anything indistinguishable from noise. It will tell you
  how many more paired days it needs.
- **Decay alerts** — a track that was above 60 momentum and has fallen below 15.
  Fires once per crossing, clears when the track recovers so a later fall can
  report again.
- **Quests** — declare an intention (*"Završiti tri ispita"*) and entries link
  themselves by stem, so *ispita* matches *ispit* with no shared surface form
  and no box to tick. Declaring one backfills against your history.
- **Chapters** — where the *composition* of your days shifts, found by
  change-point detection on rolling 14-day track profiles.

## Serbian

Full bilingual interface (`SR`/`EN` in the header), and you can write in either
language regardless of which the UI is in — detection is per sentence.

Serbian is handled as a language, not as a translation table: case endings are
stripped so *Milanom*, *Milanu* and *Milana* resolve to one person, and
participles agree with the gender of each track name (*Učenje nije
zabeleženo*, *Igra nije zabeležena*, *Veze nisu zabeležene*). Cyrillic and
Latin input are equivalent throughout, including in search.

## Your data

One SQLite file, at `DB_PATH` (default `./data/zapis.db`). Copy it to back it up.

- **Export** JSON, CSV, or Markdown from the Data tab.
- **Import** shows a dry-run diff first — how many entries are new, identical,
  or in conflict — and only writes after you choose what to do about conflicts.
  The whole import is one transaction. Re-importing the same file reports
  nothing to do.
- The legacy `lifelog:v2` export shape imports without loss.

## Layout

```
server/     API + SQLite. Owns all persistence; the browser never sees SQL.
  schema.ts   append-only migrations
src/domain/ pure logic, no React, no I/O — where all the maths lives
  extract/    the rule engine
src/features/ one directory per tab
corpus/     hand-labelled entries the engine is tested against
```

`src/domain` has no dependency on React or the DOM, which is why the maths is
testable and why the whole thing can be verified without a browser.

## Tests

```bash
npm test        # 119 tests
npm run typecheck
```

The **golden corpus** (`corpus/entries.ts`) is the important part: hand-labelled
English, Serbian, Cyrillic and mixed entries with expected XP *ranges* rather
than exact values, so the lexicon can keep growing for years without a
regression slipping through. Cases cover negation, quantities, modifiers, the
technical-vocabulary trap (AFINN rates `bug` and `crash` as sadness — a
programmer's cheerful day must not read as distress), and the rule that
sentence-initial verbs are not people.

**When the engine gets something wrong, add the case.** That is the workflow
this is built for.

## Development helpers

```bash
npm run seed 140                  # 140 days of synthetic history with real signal in it
DB_PATH=./data/dev.db npm run preview   # render populated tabs to preview.html
```

The seeded history deliberately contains findable truths: Spirit burns for six
weeks then stops dead, someone disappears from the record halfway through, and
a short night genuinely predicts a flat tomorrow.

## Notes and limits

- **Notifications** only fire while the page is open. That is a browser
  limitation, stated in the settings rather than worked around.
- **The seed lexicons are a starting point.** They will feel thin on your
  specific vocabulary at first; the Lexicon tab and the learning loop are how
  that closes.
- **`HALF_LIFE` and the XP scale are settings**, not constants. The decay feel
  is yours to tune.
- `lifelog.jsx` in the repository root is the original single-file version, kept
  for reference. Nothing imports it and it no longer runs — it relied on a
  hosted runtime for storage and for an API call. Safe to delete.
