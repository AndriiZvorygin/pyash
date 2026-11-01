# Runtime Vocabulary Parameter

**Status:** parked. Reviewed twice; the second round left it without a
deliverable. The analysis below is kept because it is measured and reproducible,
but nothing here is queued for work, and no code change is proposed.

## Purpose

Make the Pyash atom table a **declared, injected value** instead of a file path
chosen per tool.

The reason is not a hypothetical second vocabulary. **There are already two
copies of the atom table in the tree, they have already diverged, and two of
the tools answer from the wrong one.** The section below shows it.

This is not a proposal to add atoms. The vocabulary expansion direction is
compound-first: a new concept should be covered by a compound of existing
atoms wherever a compound holds up, and a new atom only when no compound does.
This document is about the machinery that makes that direction testable, and
about making the choice of atom table explicit instead of implicit.

**Read this first if the rest of the document is more than you need.** The
refactor has no deliverable today. The review asked for a concrete second
vocabulary; there is none in this repository — see "No second vocabulary
exists" below — and the one thing the proposal could have offered as an
immediate action was declined as not worth doing. The measurements below are
the durable part of this document: they describe how the vocabulary is
actually wired, and they would be the starting point for anyone who later has
a real reason to change it.

## The alternate word lists already exist

Two copies of the atom table are in the tree:

| Copy | Entries | Read by |
|---|---:|---|
| `program/library/pyashWords.json` | 7,841 | the interpreter, and every `program/` module |
| `caterer/pyac/lyac/pyashWords.json` | 7,840 | `command/vocab_query.mjs`, `command/vocab_anchor_ing_suggest.mjs` |

Nothing declares which is authoritative. Each tool picks one by writing a
path. The interpreter and the vocabulary tooling therefore answer from
different vocabularies, and **they have already diverged** — by exactly the two
renames this repository is mid-way through:

| pya | in-repo copy (the interpreter) | lyac copy (the tooling) |
|---|---|---|
| `syat` | `toindex` | `until` |
| `fromindex` | `multiplicative_case_` | — |
| `tloh` | — | `multiplicative_case_` |

The `hnuc` codes agree (`syat` is `0xA909` in both; `multiplicative_case_` is
`0x6357` in both). Only the names moved, because the loops were renamed from
`until`/`tloh` to `toindex`/`fromindex` — the deprecation `documentation/todo.md`
still carries as "remove stale `tloh` wording".

The consequence is that the tooling names words the interpreter does not have:

```
$ node -e 'import("./command/vocab_query.mjs").then(async (m) => {
    console.log(await m.queryVocabLines("syat")); })'
[ 'syat en until' ]          <- a name the interpreter does not have

$ node -e 'import("./command/vocab_query.mjs").then(async (m) => {
    console.log(await m.queryVocabLines("toindex")); })'
[]                          <- the name the interpreter actually uses
```

A lookup that is supposed to answer "which concept is this word?" answers with
the pre-rename name. That is the defect this proposal is for, and it is a
defect that exists today, not one that a future second vocabulary would
create.

**The immediate fix is small and independent of this proposal:** point the two
tools at the in-repo copy. That is a two-line change and it does not need the
refactor below. The refactor is what stops the same divergence happening
again, because it makes the set a declared thing that every consumer resolves
the same way.

## No second vocabulary exists

The review asked for a concrete second vocabulary. The honest answer is that
this repository does not have one, and the searches that establish that are
short:

- **No set concept anywhere.** As whole words, `vocabulary_set`, `word_set`,
  `wordSet` and `vocabularySet` appear in no source file, no `.pya` file and no
  document in the repository. The only hits are in this proposal and in the run
  artifacts it produced. (The one substring match is `keywordSets`, an
  unrelated local variable in
  `program/library/reporter_shared/agenda-stage2-grounding.mjs:778`.)
- **The one other word-list axis is language, not set.** The
  `caterer/pyac/lyac/kwon_*.json` tables — `kwon_en`, `kwon_fi`, `kwon_he`,
  `kwon_hi`, `kwon_ia`, `kwon_isv`, `kwon_tr`, `kwon_zh` — map the same `pya`
  atoms to a name *in another language*. That is a per-atom naming table, not
  an alternative vocabulary, and it already coexists with the atom table
  without either one being made injectable.
- **The layer-32 list is an extension, not a set.** The 18,630-word layer-32
  list is a superset of the base vocabulary rather than an alternative to it,
  so it does not create the situation a vocabulary parameter exists to solve.

So the refactor would be building a mechanism for a second vocabulary that
nobody has asked for, on the strength of a divergence between one live copy
and one stale vendored copy. That is not a reason to do it. What would be a
reason is a concrete second vocabulary, and there is none.

```
# no set concept exists
grep -rnw "vocabulary_set\|word_set\|wordSet\|vocabularySet" \
  --include=*.mjs --include=*.pya --include=*.md .

# the other word lists are per-language name tables
ls caterer/pyac/lyac/kwon_*.json
```

## The problem

The atom table is a compile-time constant.

- **20 modules** import `program/library/pyashWords.json` statically
  (`grep -rln "pyashWords.json" --include=*.mjs program/ command/`).
- **Three of them build their lookup indexes at module load**, so the indexes
  are fixed before any caller can choose a set:

  | Site | Built at import time |
  |---|---|
  | `program/library/vliw/phrase.mjs:13-32` | `PHRASE_CASE_WORDS`, `entriesByPya`, `grammarPya` |
  | `program/library/vliw/quotes.mjs:82-98` | `legacyEntriesByHnuc`, `legacyEntriesByEnglish`, and the derived `legacyNumberWords` |
  | `program/library/translation/pyac_to_english_pyash.mjs:35` | a `for (const entry of pyashWords)` index loop |

- **A fourth site reads the static import inside a function.**
  `program/library/translation/english_sentence.mjs:2220` builds
  `atomicByVariant` from `pyashWords` on each call. It is not an import-time
  side effect, but it resolves against the static table, so it must be
  re-threaded for a chosen set to be honoured.

- **One more coupling is not a vocabulary coupling at all.**
  `program/library/vliw/phrase.mjs:19` holds a hardcoded 42-word `MOOD_WORDS`
  literal (`ya`, `do`, `def`, `prah`, `ret`, `que`, `can`, …). Those are the
  grammar moods, not content atoms. They belong in the grammar layer. They are
  listed here because a vocabulary parameter does not by itself fix them, and
  because a set whose mood words differ would need them to move with it.

The consequence: compound resolution, phrase encoding, quote encoding and
English rendering all resolve against one hardcoded table. A second vocabulary
set cannot exist beside it, and compound coverage cannot be measured against a
set other than the default one.

## What already works, and constrains the change

The injectable pattern is **already proven in this codebase**. Five call sites
already take the vocabulary as a parameter with a defaulted argument:

| Site | Parameter |
|---|---|
| `program/library/translation/compound_lexicon.mjs` | `atomicEntries = pyashWords` |
| `program/library/translation/compound_lexicons.mjs` | `atomicEntries = pyashWords` |
| `program/library/translation/atom_word_generation.mjs` | `existingEntries = pyashWords` |
| `program/library/compositional_case_validation.mjs` | `lexicon = pyashWords` |
| `program/library/vliw/compound_dictionary.mjs` | `entries = VLIW_COMPOUND_ENTRIES` |

So the refactor is *remove the default and thread one object*, not invent a
mechanism. Reviewers should check that this reading is right before sizing it.

**The compiler is not affected.** There is no vocabulary reference in
`program/library/compile/c/`, `program/library/compile/js/`, or
`program/library/compile/emit_native/`. A compiled program carries
sentence-level data, not the atom table. This is the single largest reason the
change is cheap, and it should be re-verified rather than assumed.

**The current set is healthy and should not be disturbed.** Measured against
`program/library/vliw/word_code.mjs`:

- 7,841 entries, **7,839 distinct codes**, zero unencodable words.
  - `fromindex` is the one entry `encodePyacWord` refuses: it is a *role name*
    in `program/library/compositionalCases.mjs`, nine glyphs long, not a Pyac
    word. Not a defect.
  - `syi7h` is shared by `social_` and `existential_clause_`: one grammar atom
    serving two roles, used as the sentence-closing mood in
    `program/library/translation/english_grammar.pya`. Deliberate.
- The seven word shapes have a total space of **68,632 codes**; the vocabulary
  occupies **11.4%** of it.
- The grammar layer is **490 words**; content is 7,351. The shape split is
  ccvc 3,271 / h-ccv 926 / 5-glyph 3,154 for content, and ccvh 326 / cv 108 /
  ccv 31 / 5-glyph 24 for grammar. Tone-bearing words sit in layer 32 only.

## The proposed shape

### 1. A vocabulary module

`program/library/vocabulary.mjs` owns loading and every derived index:

```
buildVocabulary(entries) -> {
  entries, byPya, byHnuc, byEnglish,
  grammarPya, casePya, moodWords
}
defaultVocabulary = buildVocabulary(pyashWords)
```

Each index is computed once per vocabulary, not once per process. The three
import-time builders move here.

### 2. Restructure the three sites

`phrase.mjs`, `quotes.mjs` and `pyac_to_english_pyash.mjs` stop reading the
static import and read a vocabulary instead. Their exported functions take the
vocabulary as a parameter, defaulted to `defaultVocabulary` so existing callers
keep working.

### 3. Re-thread the already-parameterized sites

The five sites in the table above keep their parameters; their defaults change
from the static import to `defaultVocabulary`, and the callers that must honour
a chosen set pass it explicitly.

### 4. The switch point is a configuration sentence

Per `AGENTS.md`, behaviour that needs to be configurable is expressed as a
Pyash-native configuration sentence, not a new command-line flag. A
`configure/vocabulary.pya` naming the available sets and the active one:

```
su name vocabulary_sets be map def
su text "default" ob text "program/library/pyashWords.json" ya
su name active_vocabulary be text "default" ya
prah
```

The set is resolved once at startup and threaded down through the bridge. The
resolution rule — one active set per process, versus per-agent or per-place —
is an open question below.

### 5. The command tools

Six to eight tools under `command/` load their own copy of the JSON
(`vocab_query.mjs`, `list_pyash_words.mjs`, `vocab_suggest.mjs`, and others).
They already take a path, so they need the vocabulary resolution rule applied
to them and little else.

## What this enables

**One vocabulary is chosen once, and every consumer resolves the same one.**
That is the whole of the benefit, and it is worth having because the choice is
currently made per tool by file path and has already gone wrong.

**Compound-first expansion stays testable.** The coverage report is already
parameterised — `buildEnglish30kCoverage` takes `atomicEntries`, `aliases`,
`dictionaryAliases`, `compoundRecords` and `lemmaEntries` as arguments — so
this proposal does **not** unlock per-set coverage measurement. It keeps it
honest: the atoms a compound resolves against, the atoms the interpreter
dispatches on, and the atoms the tooling reports on are the same set, by
construction rather than by three separate file paths.

The coverage report is the measure that matters. Today, from
`node command/english30k_coverage.mjs`:

```
coveragePercent 46.505   covered 13951   unresolved 16048
atomic 5713   dictionary-alias 7033   lemma 1013   grammar 126   alias 31   compound 35
compoundRecords 317   compoundDeterministic 113   compoundVerificationCandidates 204   compoundRejected 36
```

**16,048 English30k words are ranked by frequency and have no representation.**
That is a machine-produced, prioritised gap list, and it is the natural source
of compound-expansion work. Note also that of 317 compound records, only 113
are deterministic; 204 still need verification and 36 were rejected. See
`documentation/suggest/self-chosen-work-candidates.md`.

## Scope

**Phase 0 — considered and declined.** The first version of this proposal
called out a two-line change: point `command/vocab_query.mjs` and
`command/vocab_anchor_ing_suggest.mjs` at the in-repo copy, and add a quiz
asserting every vocabulary consumer resolves the same set. It was put to the
owner as an independent, approvable item and **declined as not worth doing**.
The measurement behind it stands — after the swap, four atoms that the
tooling cannot report today (`syat`, `srah`, `fromindex`, `fluh`) become
reportable under the names the interpreter uses — but the tooling is a
diagnostic aid, the affected names are two loop words that were renamed
recently, and nothing in the system depends on the answer. Changing it would
add a quiz and a diff without changing what the system does. It is recorded
here so it is not proposed a third time.

In scope for the refactor: one new module, three restructurings, five
re-threadings, one configuration file, the command tools, and a quiz that pins
the behaviour.

Out of scope: adding atoms, changing any atom's spelling, changing the code
tables in `word_code.mjs`, changing the code space, and moving `MOOD_WORDS`
out of the grammar layer. The last is a real piece of work and is listed as an
open question rather than folded in here.

## Acceptance

If the proposal is revived, these are the criteria it would be accepted
against. None of them is being worked toward today.

- `program/library/vocabulary.mjs` exists and exposes `buildVocabulary` and
  `defaultVocabulary`.
- No module under `program/` builds a vocabulary index at import time; a quiz
  asserts that importing the affected modules produces no vocabulary-derived
  module-level state.
- The three restructured sites and the five parameterised sites accept an
  injected vocabulary and behave identically against `defaultVocabulary`.
- `configure/vocabulary.pya` selects the active set, and a quiz proves that a
  second set changes the compound resolution result.
- The full suite passes with no change to any existing quiz's expectation.

## Risks

- **Silent divergence.** A site that keeps a static import would look correct
  against the default set and wrong against another. The quiz must assert the
  *absence* of import-time state, not just the presence of a parameter.
- **The 486 shape violations.** 486 of the 18,630 words in the layer-32 list
  (2.6%) place a digit in a slot the VLIW word shape rejects, so
  `encodePyacWord` throws on them. The digits are legitimate Pyac glyphs —
  `1` and `6` are vowels, `8` a consonant, `2` and `7` tones — so these are
  shape violations, not bad data. "Speakable" should be pinned to "encodable
  in the VLIW word shape", and the allocator must filter on encodability
  rather than on layer membership.
- **Grammar/content confusion.** A vocabulary parameter that also carried
  moods would blur the layer boundary the current split depends on.

## Review record

**First review: "the proposal does not explain what the alternate word lists
are for; before considering it we need a concrete example of a second
vocabulary you want Pyash to use."**

Accepted, and the proposal was wrong in the way the review says. It described
the alternate word lists as a future possibility and led with an architecture
argument. In fact:

- The alternate word lists **already exist** — `program/library/pyashWords.json`
  and `caterer/pyac/lyac/pyashWords.json` — and they have already diverged by
  the two renames in flight. Two tools read the stale copy and answer with
  names the interpreter does not have. That is now the leading section, with
  the measured divergence.
- A claim was **overstated and has been withdrawn**: the proposal implied the
  refactor unlocks per-set coverage measurement. It does not —
  `buildEnglish30kCoverage` is already fully parameterised. The refactor keeps
  the sets *consistent*, it does not add a capability there.
- The **immediate two-line fix is now called out as Phase 0**, separate from
  the refactor and approvable on its own, because it fixes a live divergence
  without waiting for any design question to be settled.

The general question behind the review — *is there a concrete second
vocabulary?* — was then asked of the proposal's own author, and the answer
turned out to be **no**: this repository has no second vocabulary, and the
searches that show it are in "No second vocabulary exists" above.

**Second review: the two-line immediate fix was declined.** Phase 0 was put
forward as an independent, approvable item. It was declined as not worth
doing — the tooling is a diagnostic aid, the affected names are two loop
words renamed recently, and nothing in the system depends on the answer. So
the two things that could have made this proposal concrete — a live second
vocabulary, and a cheap fix with visible value — are both absent.

The Sino character codebook in `sino-pyash/PLAN.md` remains the only concrete
candidate anywhere in sight, and it is deferred.

### Outcome

**Parked.** Not rejected on the merits — the measurements and the coupling
analysis are sound — but left without a deliverable, and a proposal without a
deliverable should not sit in the review queue pretending to be live work.

What would revive it, in order of how much it would be worth:

1. **A second vocabulary that something actually needs.** The clearest case
   is a second set of *mood* words, because `MOOD_WORDS` is hardcoded in
   `program/library/vliw/phrase.mjs:19` and a set with different moods
   cannot exist until that literal moves into the grammar layer. Nothing
   needs that today.
2. **A vocabulary that is a strict subset.** A reduced set — the atoms a
   constrained device or a narrow domain can afford — is the case the
   parameter would serve best, because it is measurable: the English30k
   coverage command could be run against it. No such subset has been
   specified.
3. **A decision to move the atom table out of the interpreter entirely.** That
   is a different and larger piece of work than a runtime parameter, and it
   should not be smuggled in under this proposal's name.

Until one of those exists, the honest state is the one recorded here.

## Open questions for the reviewer

These are the questions that were left open when the proposal was parked. They
are kept in the order they were asked, and they are the questions a reviewer
would answer first if the proposal were revived against one of the three
conditions in "Outcome" above.

1. Is one active set per process right, or should the set be selectable per
   agent house, per place, or per session?
2. Should `MOOD_WORDS` move into the grammar layer in this tranche, or stay a
   separate piece of work?
3. Is the configuration sentence the right switch, given that the repository
   already prefers configuration sentences over flags?
4. Should the coverage report be computed per set, or only for the active one?
5. ~~Should Phase 0 land before this proposal is approved, or together with
   it?~~ Answered: it was put separately and declined. It is not a question
   any more, and it is not proposed a third time.

## Reproducing the measurements

```bash
# which copy each consumer reads
grep -rn 'pyashWords.json' --include=*.mjs command/ | grep -v "^.*library/pyashWords"

# the divergence: the two copies name the same hnuc differently
node -e 'const fs=require("fs");
for (const [label, file] of [["repo", "program/library/pyashWords.json"],
                              ["lyac", "caterer/pyac/lyac/pyashWords.json"]]) {
  const w = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const e of w) if (["syat","tloh","fromindex"].includes(e.pya)) console.log(label, e.pya, "->", e.en);
}'

# the consequence: the tooling answers with a name the interpreter lacks
node -e 'import("./command/vocab_query.mjs").then(async (m) => {
  console.log("syat ->", await m.queryVocabLines("syat"));
  console.log("toindex ->", await m.queryVocabLines("toindex")); })'

# the import sites and the static ones
grep -rln "pyashWords.json" --include=*.mjs program/ command/

# the three import-time index builders and the fourth function-local read
grep -rn "for (const entry of pyashWords)" --include=*.mjs program/

# the compiler is untouched
grep -rln "pyashWords\|vocabulary" program/library/compile/c/ \
  program/library/compile/js/ program/library/compile/emit_native/

# vocabulary health: distinct codes, encodability, code-space use
node -e 'import("./program/library/vliw/word_code.mjs").then(async (m) => {
  const fs = await import("node:fs");
  const words = JSON.parse(fs.readFileSync("program/library/pyashWords.json", "utf8"));
  const codes = new Set(); let bad = 0;
  for (const e of words) { try { codes.add(m.encodePyacWord(e.pya)); } catch { bad++; } }
  console.log({ entries: words.length, distinct: codes.size, unencodable: bad });
})'

# the coverage gap list
node command/english30k_coverage.mjs
```
