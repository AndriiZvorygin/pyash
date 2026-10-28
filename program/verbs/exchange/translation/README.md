# Translation adapters

This folder keeps per-language adapters separate so contributors can work in parallel.

Pattern:
- `<language>.mjs` exports a line-to-sentence mapper (e.g., `englishLineToSentence`), used as `toPyash`.
- Add Pyash → target language logic by exporting a sentence formatter (e.g., `sentenceToEnglish`), used as `fromPyash`.
- Register new languages in `program/verbs/exchange/translation/registry.mjs` without touching parser or compiler code.

Notes:
- Russian/French adapters are stubbed and currently throw a clear error when invoked.

## Translation pairs

`pairs_english.pya` stores a pyash map keyed by the canonical Pyash sentence (via `sentenceToPyash`).
The value is a plain English gloss string. The translation pipeline checks this map first when
translating Pyash → English, then falls back to the formatter. `pairs_russian.pya` and
`pairs_french.pya` follow the same shape.

Template pairs live alongside exact pairs:
`pairs_english_templates.pya`, `pairs_russian_templates.pya`, `pairs_french_templates.pya`.
Templates use placeholders like `[name of su]` and `[num of ob]` so a single entry covers many
sentences. Exact pairs always win; templates are a fallback before the formatter.

## Document pipeline

`translation_pipeline.mjs` is the shared source-text path. It accepts an explicit registered
language and a sentence-aware document, preserves source offsets, resolves deterministic lexical
and grammar evidence, and emits resolved, provisional, or unresolved records. Provisional records
retain token evidence and queued vocabulary candidates without entering executable Pyac output.
English uses the English30k, lemma, grammar, compound, WordNet, and sentence resources; the other
registered adapters use their existing structured line parsers until free-text analyzers are
added. A caller may supply the existing Housekeeper verifier for contextual candidates.

The English analyzer is deterministic-first. It applies the grammar catalog, existing atomic
and accepted compound vocabulary, conservative inflection, and sentence constructions before
consulting semantic evidence. The read-only WordNet resource is configured by
`english_wordnet.pya` and loaded from
`know/wordnet/open-english-wordnet-2025-json/`; each unresolved token retains its part of
speech, synset, gloss, and bounded same-synset Pyash candidates. The dataset is a local
knowledge input rather than a vendored dependency; its upstream URL, license, and source hash
are durable in the Pyash configuration.
Sense-specific bridges live in the native Pyash map
`english_wordnet_bridges.pya`. Each bridge sense is one sentence row: `su` identifies the
WordNet sense, `ob` names an existing English target anchor, `as` records its part of speech,
`with` records certainty, and `via` records provenance. The bridge adds a bounded candidate;
it does not create a new Pyash word or bypass sentence-level sense selection.
The bounded sense-linking worker is configured in `english_wordnet_linker.pya`. Its
`english_wordnet_linker.mjs` module emits one stable record per WordNet sense, accepts only
targets present in the supplied inventory, and submits unresolved records through the existing
`vyah start future be gpu mind do` queue path. A completed response can be rendered back into
the native `english_wordnet_bridges.pya` map; the linker is evidence generation, not a second
vocabulary or transcript format. The durable configuration caps one batch at 200 senses and
keeps each queued prompt below 12,000 characters. The selected model's durable card is
`translation_model_cards.pya`; Qwen3.5 9B declares a 32,768-token context window, a 3,900-token
safe input budget, and an 8,192-token safe output budget for this workflow. A paragraph-sized
group is sent as one duty when it fits; larger groups split on complete sense rows, so a provider
never receives a truncated sense identity or exhausts the response budget before returning all
decision rows.
The deterministic pre-pass also accepts a low-degree edge synset when one lemma has exactly
one WordNet sense. The existing target may be an atom or an accepted compound; missing
vocabulary stays review evidence and is never invented.
Callers that have loaded the derived compound catalog pass its accepted records explicitly;
candidate-closed and rejected compounds are excluded from the authoritative inventory.
Compound and atom relationships are derived by
`compound_atom_links.mjs`. A lowered or accepted compound whose target is an existing atom
gets that atom as `specificAtom`; a curated semantic alternative may name a different atom,
as `brainstorm` does for `brain_storming`. The same index exposes reverse `atomToCompounds`
links, so adding an atom makes all loaded language compounds that point to it discoverable.
Unlowered and candidate-only records stay outside inferred links until their lowering is
accepted. `vocab_suggest` uses this index for both compound-to-atom and atom-to-compound
reports.
Curated lemma equivalence may reuse one existing Pyash atom across English lexical surfaces:
the `mixed` atom `mrat` anchors `mix`, `mixes`, `mixed`, and `mixing`. The `mix` surface keeps
noun/verb ambiguity in sentence review, while the inflected surfaces carry their accepted tense
or aspect evidence.
The same equivalence pass reuses `emotionally` (`xyek`) for `emotion`, `emotions`, `emotional`,
and the emotional-sensitivity sense of `feelings`; plural `pu` and adjective `ci` remain explicit
Pyash grammar suffixes. Broad `feel` and singular `feeling` stay contextual because WordNet
also gives them tactile, perceptual, intuitive, and physical senses. The native bridge catalog
covers all 17 Open English WordNet senses of `feel` with existing anchors such as `touch`,
`awareness`, `experience`, `searching`, `appear`, and `air`; sentence context selects among those
bridges and leaves genuinely tied readings reviewable.
The analyzer also scores a bounded local sentence window against sense glosses and lemmas;
one unique positive overlap narrows the sense set before deterministic agreement.
Generic contrast and quantity modifiers such as `different`, `various`, and `several` do not
select a sense by themselves; constructions such as `different types of love` therefore retain
their noun-sense alternatives for the focused selector instead of collapsing to a character or
symbol sense merely because its gloss repeats `different`.
Optional relation edges can add bounded graph relatedness to that score without changing the
offline resource contract.
WordNet evidence can narrow a review candidate, but a lexical mapping is auto-selected only
when the existing Pyash evidence leaves one deterministic result. Ambiguity remains queued for
the existing Housekeeper/LLM verifier, which may choose only from supplied candidates.
The English surface `such as` is classified as an `exemplifier` construction under the broader
`exemplification` category. It lowers to `fluh ga`, rendered as the fused form `fluhga`:
the referential `example_` head followed by the space-way case (`at`/`via`).

The durable command writes the translation evidence catalog and the existing Pyac catalog/pack:

```
node command/translate_document.mjs english source.txt translation.pya catalog.pya pack.pyac
```

The goal form uses the refinery's normal single destination and run artifact
folder, so a shell run needs no intermediate filenames:

```bash
PYA_RUN_VERBOSE=1 PYA_RUN_ID=love-paragraph-vliw \
node command/translate_document.mjs english \
  examples/translation/simple-english-wikipedia-love.txt vliw
```

Stage and checkpoint progress is written to stderr. The JSON summary is written
to stdout. Its `sentences` rows preserve each source sentence with `original`,
`pyash`, `pyac`, and `status`. Complete projections are strings. Provisional
projections are arrays of `{ source, value, sequence }` parts, so approved
token-level output remains visible without inventing a complete sentence; an
empty array means that side has no available projection. The generated artifacts
are kept together under
`artifacts/love-paragraph-vliw/`: `translation.pya`, `vliw-catalog.pya`, and
`vliw.pyac`. The direct `./run` map also includes a `sentences` text field
containing the same JSON sentence rows, including partial arrays. The checkpoint newspaper remains at
`newspaper/love-paragraph-vliw.pya`, so it can be inspected without rerunning:

The durable `translation.pya` stores each metadata, record, and vocabulary row as
pretty JSON inside a Pyash `quoted.text ... .text.quoted` block. This keeps the
whitespace readable in the artifact while `pya_to_json.mjs` and the pipeline
parser recover the same structured values.

```bash
node command/read_translation_refinery.mjs love-paragraph-vliw .
node command/pya_to_json.mjs artifacts/love-paragraph-vliw/translation.pya --pretty
```

The normal Pyash entry point is the runnable example
`examples/pyash/translate-love-to-vliw.pya`. Run it through the standard runner
to keep the outer run identity, exchange events, result artifact, and newspaper
in the same durable run:

```bash
./run --verbose --newspaper --full --run-id love-paragraph-vliw \
  examples/pyash/translate-love-to-vliw.pya
```

The runner also accepts `--verbose` after the program path. Verbose runs stream
stage and checkpoint records while the job is running, including during a cold
Housekeeper/model load.

That sentence invokes the same source-to-VLIW refinery as the command module;
the `to name map translation result` value is the returned artifact map, not a
second transcript or intermediate destination. The returned map is written to
`artifacts/love-paragraph-vliw/result.pya`, while the translation, VLIW catalog,
and `.pyac` pack remain beside it. The outer newspaper is
`newspaper/love-paragraph-vliw.pya`.

Reuse an existing `PYA_RUN_ID` to replay matching checkpoints and see where the
previous run stopped; choose a new id for a fresh run.

This is one source-to-VLIW job. Its semantic destination is the VLIW goal;
`translation.pya`, the VLIW catalog, the `.pyac` pack, queue evidence, and
checkpoint/newspaper records are intermediate or audit artifacts in that same
job artifact folder. Destination type describes the goal state, while artifact
names describe files produced along the path. `understand` remains the parser
for Pyash source and is not the document-translation verb.

The command automatically submits one deduplicated vocabulary-review duty through the existing
`vyah start future be gpu mind do` path and awaits that same handle through the bounded GPU await
path. The returned handle, repair handle (when needed), decision, and candidate queue state are
written into the translation catalog. The translation catalog remains the evidence record. A
malformed, incomplete, or ungrounded response gets one automatic repair submission through the
same queue; if repair still fails, valid inventory-backed rows are retained and malformed rows
receive a durable `uncertain-llm` outcome rather than waiting for a human approval step. Accepted
model decisions apply existing inventory-backed sequences to the document's provisional records and
still never edit the lexicon directly. Only resolved canonical sentences are passed to Pyac lowering;
machine-uncertain vocabulary stays available as explicit evidence for a later refinery run.

For English documents, the command also runs the standard WordNet refinery before vocabulary
review. It records one stable occurrence decision only for a source word that is present in the
document and still unresolved. Deterministic context selects a unique sense locally; an ambiguous
occurrence gets one focused Housekeeper duty containing only that word, its sentence, and its
possible WordNet senses. The model returns one supplied sense id, confidence, and short rationale;
it never emits a Pyash sequence or a whole-document translation. A low-confidence, uncertain,
malformed, or failed duty becomes an explicit occurrence error, while other occurrences continue.

The canonical unit after sentence analysis is the source occurrence, not the surface spelling.
Every persisted token and vocabulary candidate carries its source record, token index, stable
occurrence id, and bounded WordNet sense candidates. Two uses of the same English word therefore
retain separate decisions and queue duties. The `translation-sense-state-v1` marker in the
translation `.pya` catalog guards this boundary: current checkpoints resume selected occurrences
without re-submitting them, while an older or incomplete catalog regenerates only the missing
token-sense state before continuing the existing refinery stages.

After a sense is selected, the refinery first checks the existing atom and accepted-compound
coverage through the normal WordNet bridge path. When no direct bridge exists, it emits a bounded
`wordnet-sense-attachment` candidate for the existing vocabulary/compound refinery. The native
bridge catalog remains the durable curated lexicon; the document catalog records automatic model
decisions without requiring a human in the loop. Accepted sense links are fed back through the
same sentence analyzer before vocabulary review, so the selected sense can affect the current run.
Each selection queue uses an `english-wordnet-select-*` handle and is stored under
`wordnet-refinery` in the translation `.pya` catalog. `wordnetSelected` counts occurrences with a
selected sense, `wordnetUnresolved` counts selected senses still lacking a bridge, and
`wordnetQueuePending`/`wordnetPending` count active Housekeeper queues. Completed queues therefore
do not appear to be hanging merely because attachment or vocabulary review remains unresolved.

Stage outputs are durable checkpoint artifacts in the run newspaper. Inspect them without running
the refinery again:

```
node command/read_translation_refinery.mjs <run-id> [checkpoint-cwd]
```

The report lists the latest completed stage, each stage's input/output map artifact, and pending
WordNet occurrence links from the latest translation artifact. The canonical session remains the
translation `.pya`; the newspaper remains the replayable stage-evidence source.

The source-to-VLIW operation therefore means “translate this English source
toward the VLIW goal.” It does not mean “translate separately to a translation
catalog, a catalog, and a pack”; those are durable members of the one job
artifact folder.

The source-to-VLIW runner also uses those checkpoint artifacts as its resume boundary. It records
the source hash and the hashes of the loaded English resources in the stage input map. A matching
checkpoint can be replayed directly; a stale or legacy checkpoint reruns the affected stages while
preserving accepted occurrence sequences and accepted vocabulary candidates from the same source.
The latest stage output is therefore the input to the next refinery pass, rather than a fresh
analysis of the original surface words. This state remains in the existing Pyash newspaper and
translation `.pya` catalog; the refinery does not create a parallel JSON artifact or transcript.

To regenerate the English pairs from `examples/pyash/*.pya`:

```
node -e "import fs from 'node:fs/promises'; import path from 'node:path'; import { buildProgram } from './program/program.mjs'; import { sentenceToPyash } from './program/beautiful.mjs'; import { sentenceToEnglish } from './program/verbs/exchange/translation/english.mjs'; const dir='examples/pyash'; const entries=new Map(); const files=(await fs.readdir(dir)).filter(f=>f.endsWith('.pya')); for (const file of files){ const text=await fs.readFile(path.join(dir,file),'utf8'); const program=buildProgram(text); for (const sentence of program.sentences){ if (!sentence) continue; const pyash=sentenceToPyash(sentence); if (!pyash || entries.has(pyash)) continue; entries.set(pyash, sentenceToEnglish(sentence)); } } const keys=[...entries.keys()].sort(); let out='su name translation_pairs_english be map def\\n'; for (const key of keys){ const val=entries.get(key) ?? ''; out+=`su text ${JSON.stringify(key)} ob text ${JSON.stringify(val)} ya\\n`; } out+='prah\\n'; await fs.writeFile('program/verbs/exchange/translation/pairs_english.pya', out, 'utf8');"
```

The reverse Pyac slice is `pyac_to_english_pyash.mjs`. It expands fused Pyac
roots and grammar endings, lowers the expanded words through
`program/library/vliw/phrase.mjs`, and returns structural Pyash evidence plus
readable English-Pyash and English projections from the decoded VLIW phrase.
Word numbers come from the lwonprom-compatible algorithm in
`program/library/vliw/word_code.mjs`; the vocabulary remains the membership
and gloss source. English-Pyash keeps composed noun and prepositional phrases
as visible words (`ob us from evil`) rather than collapsing them into a
quoted text literal. Vocative phrases render as an address prefix (`O ...`);
the remaining case inventory is derived from the vocabulary's `_case_` entries.
Relative-clause direction follows the target language's adposition direction.
The postpositional Pyac/VLIW structural stream places a dependent clause before
its parent phrase (`la ... ba` followed by the parent). The English-Pyash
projection is prepositional and SVO, so it renders the complete parent phrase
first and then its attached dependent clause (`the brain that ...`). The clause
remains linked to its parent phrase across both projections.
The `translation` verb accepts `from state pyac` with `to state pyash` or
`to state english`; unknown or unsegmentable Pyac tokens remain hard errors.

## Atom word proposals

`atom_word_generation.mjs` adapts the original `pyachso2n/rootWordPhon.js`
allocation method to one concept at a time. It loads the existing multilingual
phonetic catalog, applies the source `NativeWeights` profile, builds the same
weighted CV/CCV(C) root candidates, and selects the first candidate available
in the cumulative 16/19/24/28/32 glyph inventories. Existing Pyash words and
their algorithmically encoded HNUCs are reserved before selection, so a
proposal stays non-overlapping with the checked-in vocabulary.

English30k rank and frequency remain attached as concept evidence. They order a
larger generation batch; the phonetic profile determines the candidate word.
The proposal command is read-only and emits evidence rather than editing
`pyashWords.json`:

```
node command/vocab_atom_suggest.mjs blueprint
```

Grammar concepts use the same allocator with a trailing underscore and reserve the
historical Pyash word list as well:

```
node command/vocab_grammar_suggest.mjs example
```

For `example`, the deterministic proposal is `example_ -> fluh` (`0x5367`, layer 16).
The command remains read-only; accepting a proposal into `pyashWords.json` and the
English grammar catalog is a separate vocabulary change.

The command uses `pyachso2n/phonetics.json.txt`, `pyachso2n/English30k.txt`,
and the five `*GlyphWordList.txt` files. A concept absent from the phonetic
catalog returns `missing-phonetic-evidence`, preserving the deterministic
boundary instead of inventing a pronunciation. The durable workflow facts are
recorded in `atom_word_generation.pya`; `renderAtomWordProposalPya` can place a
proposal into a parser-readable evidence map for later review.
