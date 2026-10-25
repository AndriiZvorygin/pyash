# Pyac VLIW codelet database

Status: design and reference implementation contract. This document defines
the searchable catalog and compiled VLIW container built on the sentence-first
lowering contract in `documentation/specifications/27-pyash-vliw-isa.md`.

## 1. Purpose and boundary

Pyash sentences and paragraphs remain the canonical semantic source. A Pyac
database stores two projections of that source:

In the language terminology, Pyash is the English-oriented form, such as
`su me be happy ya`. Pyac is the VLIW-compatible word form, such as
`mina nyahye hcaspuka pfinkiya`; Pyac is a language form, while `.pyac` names
the corresponding packed artifact.

```text
canonical Pyash `.pya` sentences
  -> searchable `.pya` catalog
  -> executable `.pyac` codelet pack
```

The catalog carries semantic identity, provenance, compatibility status,
source text references, codelet hashes, and replay expectations. The `.pyac`
pack carries exact legacy VLIW words. The catalog is the searchable semantic
index; the pack is the executable byte projection.

Human-language input enters this boundary through an existing or future
translation adapter. It becomes executable after the adapter produces a
canonical Pyash sentence or paragraph and the VLIW compatibility table accepts
each semantic item.

The JavaScript reference path exposes
`buildVliwDatabaseFromTranslation(lines, options)`. It resolves an adapter
from the existing translation registry, translates ordered non-empty source
lines into canonical sentences, and attaches language, locator, line index,
sentence index, and source text to the existing catalog provenance field.
Blank source lines are ignored while their original line positions remain
available in provenance. The resulting database uses the same `.pya` catalog
and `.pyac` pack contracts as canonical Pyash input.

## 2. `.pyac` container

The reference container is little-endian and has no timestamps, addresses,
worker identifiers, or runtime pointers. Its header is 32 bytes:

| offset | width | field |
| ---: | ---: | --- |
| 0 | 8 | ASCII magic `PYACVLIW` |
| 8 | 2 | format version, currently `1` |
| 10 | 2 | word width, currently `16` |
| 12 | 2 | words per codelet, currently `16` |
| 14 | 2 | header width, currently `32` |
| 16 | 4 | codelet count |
| 20 | 4 | bytes per codelet, currently `32` |
| 24 | 4 | complete file width |
| 28 | 4 | reserved zero field |

Each codelet occupies exactly sixteen unsigned 16-bit words. Codelets follow
the header in source order. The file width equals the header width plus
`count * 32`; trailing bytes are invalid. A reader rejects an unknown magic,
version, word layout, reserved field, truncation, or extra data.

`.pyc` remains associated with Python bytecode. `.hdes` is available for a
future semantic descriptor/HNUC store. PyAC executable codelets use `.pyac`.

## 3. Catalog contract

The catalog is a parser-readable Pyash `series` in a `.pya` file. Each codelet
row contains a JSON-shaped text payload inside a sentence-native row so the
catalog remains inspectable with `pya_to_json.mjs` and `read_pya_trace.mjs`.
Each row carries:

- stable content-derived record identity;
- input and codelet ordinals;
- executable or unsupported status;
- canonical sentence and semantic verb/mood/cases;
- exact words and codelet SHA-256;
- source-language/provenance data when supplied;
- explicit error identity for unsupported lowering; and
- an optional expected replay result.

The catalog records the SHA-256 of the complete `.pyac` pack. Opening a
database verifies that hash before query or replay operations continue.

Record identity is derived from the canonical sentence and exact codelet
bytes. Equal canonical semantics and equal bytes receive equal identities;
timestamps and source spelling do not affect identity.

## 4. Query and replay

The reference API exposes:

```text
buildVliwDatabase(sentences, options)
encodePyacPack(codelets)
decodePyacPack(bytes)
queryVliwCatalog(database, criteria)
replayVliwDatabase(database, options)
renderVliwCatalogPya(database)
```

Queries may select record identity, status, semantic adapter, mood, verb,
case, legacy word, literal value, source language, locator, source line or
sentence, content hash, canonical sentence text, and derived read/write
references. Unsupported records remain queryable and retain their error
identity; they never become executable by inference.

Replay validates the pack hash, each codelet hash, semantic decoding, and the
optional recorded result. A mismatch raises a stable database error. A
supported codelet produces the same sentence-shaped result as the reference
interpreter adapter.

The reference command wrapper is `command/pyac_database.mjs`. It keeps the
database interface positional and delegates to the APIs above:

```text
node command/pyac_database.mjs build source.pya catalog.pya codelets.pyac
node command/pyac_database.mjs build-translation english source.txt catalog.pya codelets.pyac
node command/pyac_database.mjs query catalog.pya codelets.pyac semantic numeric-plus
node command/pyac_database.mjs replay catalog.pya codelets.pyac [record-id]
```

Build input is a canonical Pyash source file. Translation builds use a
registered source adapter and preserve source-line provenance. Structural `def` and `prah`
sentences are omitted from the codelet corpus; semantic sentences remain as
executable or explicitly unsupported catalog rows. Query and replay reopen
both files and verify the catalog-to-pack hash before returning results.

The committed round-trip corpus is
`examples/pyash/pyac-corpus.pya`. It contains all five supported numeric
operators, anonymous and named scalar literals, and explicit unsupported rows.
`quiz/pyac_roundtrip_corpus.test.mjs` builds that source into a catalog and
pack, verifies the historical numeric-plus text surface, renders every
executable codelet back to canonical Pyash, replays the pack, and checks the
unsupported error identities.

This file is a lowering corpus for `command/pyac_database.mjs`. Its anonymous
numeric arithmetic shapes preserve the fixed VLIW operand layout and are not
ordinary interpreter commands; use the PyAC database builder/replay path for
this fixture rather than `command/read_pya_trace.mjs` or
`command/pya_to_json.mjs`.

## 5. Translation and compound words

Translation remains a separate front end:

```text
human text
  -> language adapter
  -> morpheme/compound analysis
  -> canonical Pyash sentence
  -> VLIW lowering
```

Chinese compound words provide the first morphology corpus at
`program/verbs/exchange/translation/compound_lexicon_chinese.pya`. The same
layer-aware catalog contract now covers bounded compound samples from French,
Russian, Hindi, and Interlingua at:

```text
program/verbs/exchange/translation/compound_lexicon_french.pya
program/verbs/exchange/translation/compound_lexicon_russian.pya
program/verbs/exchange/translation/compound_lexicon_hindi.pya
program/verbs/exchange/translation/compound_lexicon_interlingua.pya
```

Each catalog stores
the surface compound, ordered morphemes, canonical Pyash target, optional
English gloss, provenance, confidence, and lowering status in parser-readable
map rows. The loader and query helpers live in
`program/verbs/exchange/translation/compound_lexicon.mjs`; the shared
language-specific loaders live in
`program/verbs/exchange/translation/compound_lexicons.mjs` and are re-exported
by the Chinese, French, Russian, Hindi, and Interlingua translation adapters.

The compound surface is evidence for translation; canonical Pyash identity
remains the execution authority. Compound rows remain searchable morphology
metadata. A translated sentence becomes executable when its canonical name
and value fit a proven VLIW adapter; automatic HNUC allocation remains outside
this contract.

Compound lowering follows the cumulative Pyac word layers recorded in
`program/verbs/exchange/translation/pyac_complexity_layers.pya`. The source
inventories are `pyachso2n`'s `16GlyphWordList.txt`, `19GlyphWordList.txt`,
`24GlyphWordList.txt`, `28GlyphWordList.txt`, and `32GlyphWordList.txt`.
Candidates are ranked progressively from layer 16 through layer 32, with exact
word-list membership and source hashes retained in the manifest. The current
Chinese database candidate is:

```text
数据库 / database
  data + storehouse
  number + shed
  hnuc + cren
  component layers: 16 + 19; compound layer: 19
```

The existing atomic `database` word remains `hdes` at layer 24. The existing
`data_mining` word `dxak` is layer 28, so it remains a recorded higher-layer
word rather than a preferred database component. The durable row is in
`program/verbs/exchange/translation/compound_lexicon_chinese.pya`; its
`evidence` field records the curated Kwon decomposition.

The external-language rows use curated English target decompositions such as
`light + house`, `doll + house`, `water + fall`, and `water + line`. A source
language may lexicalize one of these targets as one word, so its row retains
the source surface and marks the semantic decomposition in `evidence`. This
keeps translation evidence separate from automatic morphology inference.
Every current external-language sample lowers through the same canonical Pyac
words and records the higher-layer atomic alternative in `rejectedCandidates`.

Broader derived coverage uses
`program/verbs/exchange/translation/compound_coverage.mjs` and the durable
curated decompositions in
`program/verbs/exchange/translation/compound_coverage_curated.pya`. The
current source projection finds 7,830 existing atomic targets, 393 accepted
derived compounds, and 411 closed-compound candidates across the Chinese,
French, Russian, Hindi, and Interlingua dictionaries. Existing atomic targets
remain in the atomic vocabulary; derived records cover terms that gain a
sequence from existing words. The morphology boundary guard identifies 44 of
those candidates as ending-boundary rejections before provider review, leaving
367 candidates for the bounded model batch.

Pyash compound order is head-final. The final component is the semantic head
and earlier components are modifiers:

```text
snake bird -> [snake, bird]
bird snake -> [bird, snake]
```

Source-language order and morpheme boundaries remain in provenance. A source
language may place the head first, use a linking word, or fuse the surface;
the resolver emits the semantic Pyash sequence separately. The resolver is
re-exported by the translation adapters and the shared multilingual compound
module. Closed-word candidates are emitted by
`node command/compound_coverage.mjs uncertain` as the bounded LLM
verification batch. Verification receives only existing candidate
decompositions, selects by stable id, and gets one repair attempt when its
response violates the contract. Outcomes use `accepted-llm`, `repaired-llm`,
`uncertain-llm`, or `rejected-llm`; the original coverage status remains in
`coverageStatus`. Verification evidence and attempt counts remain in the same
`.pya` record.

Compound translations for downstream integrations are lazy. The document
pipeline selects only accepted lexical compounds that occur in the source;
grammar rows, unresolved candidates, and unused compounds do not trigger a
model request. Missing language surfaces are requested through the existing
durable GPU worker and configured Housekeeper, using the model and five-language
set in `program/verbs/exchange/translation/compound_translation_config.pya`.
Successful responses are appended to the parser-readable cache at
`program/verbs/exchange/translation/compound_translation_cache.pya` and later
integrations reuse the stable compound request identity. The cache is evidence
for translation integration, not a second accepted-vocabulary catalog.

English document refineries also run
`program/verbs/exchange/translation/english_wordnet_refinery.mjs`. Encountered
lexical gaps receive stable WordNet sense rows; existing-atom or accepted-compound
leaf/edge links are recorded deterministically, while ambiguous senses enter the
existing durable Housekeeper `mind` queue. Source context is compacted by unresolved term and
sent once for a paragraph-sized group where the prompt fits; a larger group is split between
complete sense rows. Each prompt is capped at 12,000 characters. The model-specific safe input
and provider context values are durable in
`program/verbs/exchange/translation/translation_model_cards.pya`; the Qwen3.5 9B card declares
32,768 context tokens, a 3,900-token safe input budget, and an 8,192-token safe output budget.
This keeps requests within the rough input budget without truncating ids or exhausting the
response before every sense decision is returned. The `wordnet-refinery` row in the translation
`.pya` catalog preserves the sense batches and queue handles without silently promoting a model
decision into the vocabulary.

Closed-word review also carries morphology metadata from
`program/verbs/exchange/translation/compound_morphology.pya` and the
underscore-marked affix rows in `program/library/pyashWords.json`. Each record
stores `componentRoles`, `morphologyStatus`, and `morphologySignals`. An
ending that matches a component, such as `ant` in `acceptant`, receives an
explicit `component` signal; an ending embedded in a component, such as `ing`
in the candidate `king` for `zincking`, receives an `inside-component` signal.
An exact ending boundary in a closed-word candidate is rejected by the
deterministic guard. An ending embedded in a lexical component remains a
semantic-review signal. The verifier must return `headKind: "lexical-head"`
before an accepted response enters the catalog; a derivational or grammatical
classification remains rejected evidence, even when the ending also exists as
an atomic English word.

For a configured Pyash mind, the executable verifier is
`node command/compound_coverage_verify.mjs pya mind`. It loads the standard
`configure/default.pya` and host-local `configure/secret.pya` configuration,
then runs the
deterministic records through without a model call and sends only the
uncertain batch through the existing Pyash `vyah start future be gpu mind do`
and `vyah await be gpu do` path. The GPU worker submits those durable duties to
the configured housekeeper; the verifier has no direct provider fallback. Start
the worker with `node command/gpu_worker.mjs --world world` while the verifier
runs. The default output is a summary; `pya` emits the verified catalog for
parser-backed inspection. When `gpu housekeeper url` is configured, the worker
uses that existing managed GPU path while preserving the configured `ollama
host` as the provider endpoint. A third positional argument in `pya` mode
writes each verified record incrementally to that `.pya` path and closes the map
with `prah` on success; an interrupted run leaves a parser-readable partial
checkpoint in place.

The first external compound analysis uses the historical `hkestlat` source
shapes `mwonkwon.json` and `chinese_dictionary_stems.json`. The host-side
normalizer is `program/verbs/exchange/translation/hkestlat_compound_analysis.mjs`.
It hashes the source files, normalizes Unicode and row ordering, joins direct
Chinese/English/Pyash candidates with ordered component hints, and gives every
mapping a content-derived identity. Duplicate targets remain
`ambiguous-target`; rows without a direct Pyash target remain unresolved. The
stem row's target is evidence and cannot silently override conflicting direct
dictionary candidates.

The committed benchmark is
`examples/pyash/lord-prayer-compound-analysis.pya`. It records the World
English Bible text for Matthew 6:9-13, source hashes, stable verse locators,
and mapped or unresolved vocabulary terms. It is an analysis and provenance
artifact; translation-registry integration and executable PyAC lowering remain
subsequent steps. The focused regression is
`quiz/translation_hkestlat_compound_analysis.test.mjs`.
At the recorded source hashes it contains 7,353 normalized rows: 7,157 direct
mappings, 164 mapped compounds, 31 ambiguous targets, and one missing target.
The prayer benchmark currently maps `heaven`, `name`, `holy`, `come`, `today`,
`bread`, `temptation`, `evil`, and `glory`; unresolved terms remain recorded
for the next vocabulary pass.

### Lord's Prayer Greek source policy

The durable source policy is recorded in
`program/verbs/exchange/translation/lord_prayer_sources.pya` for Matthew
6:9-13. The project uses three explicitly separated layers:

- **Canonical Greek text:** Nestle-Aland 28 (NA28), edited by the Institute for
  New Testament Textual Research. The [INTF NA28 edition page](https://intf.uni-muenster.de/NA28/en.html)
  is the source locator.
- **Critical comparison text:** the freely available SBL Greek New Testament
  (SBLGNT), a critically edited alternative whose [editorial introduction](https://www.sblgnt.com/about/introduction/)
  documents its comparison with Westcott-Hort, Tregelles, the NIV Greek text,
  and the Robinson-Pierpont Byzantine Textform.
- **Received-Text comparison:** the Received Text/Textus Receptus tradition,
  retained because Young's Literal Translation follows the generally
  recognized Received Text. Young's [1898 preface](https://www.ccel.org/bible/ylt/ylt.htm)
  states that source policy directly. YLT remains a literal English gloss and
  comparison layer rather than the canonical Greek source.

Edition differences remain named variants. The translation workflow never
silently merges critical, Byzantine, and Received-Text readings. Greek token
and morphology mapping comes after this source selection; YLT helps inspect
literal tense, article, case, and word-order decisions without replacing the
Greek evidence.

The executable Lord's Prayer translation emits the NA28 main text and ends at
Matthew 6:13b, after `ἀπὸ τοῦ πονηροῦ`. The Received-Text/YLT doxology
(`ὅτι σοῦ ἐστιν...`) and `ἀμήν` remain available as named comparison evidence
in the lexical pilot and source analysis.

The same manifest records the Syriac Peshitta form for Matthew 6:10,
`ܡܰܠܟܽܘܬܳܟ` (`malkūthākh`), as Aramaic/Syriac comparison evidence. The
Peshitta is an attested translation witness; the exact Galilean wording remains
a reconstruction. For the English gloss, **kingdom** emphasizes the royal
realm or domain, while **reign** emphasizes the active exercise of royal rule.
Both belong to the semantic range of Greek `βασιλεία` and Syriac
`malkūthā`; the current lexical selection is `hyap syun` (`king government`).
The lexicon retains `king country` and `king domain` as alternate review
candidates. It also records `dwa2n syun` (`god-king government`) as a
contextual divine-rule expansion, with the prayer's possessive context
supplying the divine subject.

The bounded Matthew 6:9-13 lexical pilot is stored in
`program/verbs/exchange/translation/lord_prayer_lexicon.pya`, linked from the
source manifest. It records 27 source terms with Greek lemmas and inflected
forms, YLT/KJV comparison surfaces, stable semantic candidate identities, and
accepted-existing, review, or unresolved Pyash targets. The runtime parser and
renderer are `lord_prayer_lexicon.mjs`; `hkestlat_compound_analysis.mjs` can
attach the lexical evidence to its existing prayer records. This is a
source-specific pilot, not yet a general Greek translation adapter. A complete
New Testament path remains a later scope that will add sentence-level Greek
morphology and clause resolution after this evidence contract is extended.

The executable NA28 clause lowering is stored separately in
`program/verbs/exchange/translation/lord_prayer_lowering.pya`. Each clause row
contains its source locator and ordered term/marker sequence; the JavaScript
adapter resolves selected lexicon candidates, lowers those sequences through
the shared VLIW phrase encoder, and derives the structural signatures from the
same data. Expected Pyac, Pyash, and English-Pyash forms live in the quizzes as
assertions.

### Ranked English30k coverage

The ranked lexical target is the Gutenberg-derived source
`/home/htaf/pyachso2n/English30k.txt`. The durable source contract is recorded
in `program/verbs/exchange/translation/english30k_coverage.pya`: the cutoff is
ranks 1 through 30,000, the source hash is retained, and rank 6,897 is absent
from the source. The file contains 36,662 rows overall; the selected cutoff
contains 29,999 parseable rows.

`program/verbs/exchange/translation/english30k_coverage.mjs` preserves source
rank and frequency score and classifies each target as `atomic`, `alias`,
`grammar`, `compound`, `dictionary-alias`, `lemma`, or `unresolved`. Only
executable Pyash lowerings count as covered. Exact atomic mappings take
precedence over aliases and compounds. The dictionary-alias layer reads the
existing `caterer/pyac/lyac/dictionary_en.json` blacklist and accepts a row only
when its alternatives resolve to exactly one existing Pyash target; ambiguous
alternatives remain unresolved. Accepted compounds retain their ordered,
head-final Pyash sequence.

The operator report is:

```text
node command/english30k_coverage.mjs summary
```

It reports the current coverage counts and ordered source gap. The current
projection is 5,730 atomic mappings, 31 aliases, 63 grammar mappings, 30
accepted compounds, 7,056 unique dictionary aliases, 996 lemma mappings, and
16,093 unresolved entries, for 13,906 covered rows (46.355%). This is a
measurement and resolver over the existing catalogs; it does not create a
second JSON vocabulary or count ambiguous dictionary presence as coverage.
Candidates requiring semantic judgment continue through the existing queued
GPU/housekeeper compound verifier before entering the accepted catalog.

### English lemma coverage

The lemma layer keeps ranked surface rows and adds a canonical English lookup
over them. Its durable Pyash catalog is
`program/verbs/exchange/translation/english_lemmas.pya`, with the same
English30k source hash and cutoff as the coverage manifest. Runtime indexing
lives in `program/verbs/exchange/translation/english_lemmas.mjs`.

Exact atoms remain identity mappings. Existing anchor forms and curated
irregular forms resolve to their canonical Pyash sequence. Regular
inflectional forms resolve only when one existing atom gives a unique result;
derivational endings and lexical compounds remain separate concepts. The
inspection command is:

```text
node command/english30k_coverage.mjs lemmas
```

The current report contains 996 lemma-resolved rows, 13,906 covered rows in
total, 5,778 unique canonical lemmas, and 16,093 unresolved rows. The lemma
count is a surface-row count; dictionary aliases are reported separately
before this layer.
Ambiguous inflection candidates use
`program/verbs/exchange/translation/english_lemma_verification.mjs`; its
default verifier submits through the existing future GPU duty and await path,
accepts one bounded repair response, and retains malformed or uncertain
responses as review evidence. The live review command is
`node command/english30k_lemma_verify.mjs summary`; its `pya` mode emits a
parser-readable `translation_english30k_lemma_review` catalog.

### English sentence morphology

Word analysis supplies lexical roots and grammatical particle candidates. The
sentence layer in
`program/verbs/exchange/translation/english_sentence.mjs` uses plain English
context to select finite tense and aspect. Its first supported slice covers
simple finite forms, progressive auxiliaries, and the first noun-phrase
grammar layer. For example, the durable catalog records `walked` as `pfin ki`,
`walks` as `pfin ra`, and the contextual participle candidate `walking` as
`pfin pfih`; `I am walking` resolves to `pfin pfih ra`. Sentence composition
keeps grammar particles separate from lexical roots in the evidence structure,
then fuses each complete noun or verb phrase for the spoken form: `our houses`
keeps the component sequence `nyah ye hcas pu`, while its spoken surface is
`nyahye hcaspu`; `and` remains `wa`, `thy` has the spoken surface `saye`, and a
final mood attaches to the verb phrase, so `pfin ki ya` renders as `pfinkiya`.
When a verb phrase must finish before a later phrase, the verb-affix `vi`
closes it: `pfin ki vi` renders as `pfinkivi`; the sentence mood still closes
the whole sentence.
Imperative clauses use the understood second-person subject and remain
contextual predicate candidates for Housekeeper review.

Resolved translation records carry three useful projections: `canonical` keeps
the English source/gloss, `pyash` preserves the structural `su`/`ob`/`be` form
for replay, and `pyac` renders the VLIW-compatible word order. The
`pyashSurface` field remains a compatibility alias for `pyac`. The Pyac form
fuses noun, adjective, case, voice, tense, aspect, and final mood words into
complete phrases. For example, `I walked our houses` has the canonical English
form `I walked our houses.` and the Pyac form `mina nyahye hcaspuka pfinkiya`.
Noun/pro-form quantifier grammar also fuses to its head: structural `cyah tlih`,
`ya no`, and `clah tlih` render as `cyahtlih`, `yano`, and `clahtlih`.
The structural components remain separate in the VLIW evidence so decoding can
recover the grammar layers.
English compositional relations lower to Pyac case markers at the phrase
boundary: `I walked into houses` has structural form `hcas pu twih` and
surface form `hcasputwih`; direct objects retain final `ka` when no
compositional case already closes the phrase.
The reusable surface renderer is
`program/verbs/exchange/translation/pyash_surface.mjs`. The bounded Greek
Lord's Prayer pilot uses it through
`program/verbs/exchange/translation/lord_prayer_translation.mjs`; its daily
bread clause renders as `nyahyi trenmyah nyahye dlatci hpupka kwinpcih`.

Standalone `vocab_suggest` output keeps the lexical lemma line and adds a
morphology candidate line. A sentence with unresolved candidates can be sent
through `english_sentence_verification.mjs`, which uses the existing future
GPU duty and await path, one bounded repair attempt, and retained review
evidence for uncertain results. The English translation adapter uses the
sentence layer after its established command-style parser.

## 6. Rust compatibility boundary

The initial Rust boundary is `rust/pyac`. It implements the established
`.pyac` fixed-width pack header, little-endian 16-bit codelets, stable layout
errors, and the one-plus-one golden fixture. Its catalog reader uses the small
`serde_json` dependency already required to decode the existing JSON-shaped
row payload; it does not introduce a second semantic vocabulary or database
schema.

Rust now reads the existing generated catalog subset with
`parse_catalog_pya`. It validates the series/header/footer shape, the six
required metadata rows, optional pack locator, and JSON-shaped codelet rows;
it does not define a second catalog schema. The shared fixture is
`rust/pyac/tests/fixture_catalog.pya`, and the JavaScript renderer remains the
authority for producing parser-backed `.pya` text and semantic replay.

The Rust boundary also decodes and executes the proven numeric arithmetic
codelets through `decode_numeric_arithmetic_codelet`. Its marker layout,
zero-tail check, operator words, saturation/floor/division rules, and explicit
divide-by-zero error match the JavaScript facade. The shared one-plus fixture
continues to cover the public `decode_numeric_plus_codelet` adapter. Rust
semantic coverage remains deliberately limited to proven adapters; the
JavaScript facade remains the broader reference executor.

The recovered legacy C arithmetic boundary is also preserved: plus saturates
as a `uint16_t`, while subtract, multiply, divide, and xor produce `uint64_t`
values (`lwonprom-pre-oct-2025/program/math.c`). Rust therefore returns `u64`
for the general arithmetic executor and does not invent a narrower multiply
result width.

`execute_numeric_arithmetic_pack` applies that boundary to every codelet in a
decoded `.pyac` pack and reports the failing codelet index with the stable
semantic error code. It executes numeric arithmetic packs only; typed literals,
unsupported catalog rows, and unproven domains remain outside this adapter.

Run both Rust checks with:

```text
cargo fmt --manifest-path rust/pyac/Cargo.toml -- --check
cargo test --manifest-path rust/pyac/Cargo.toml
```

## 7. Backend status

The current executable reference backend is the JavaScript semantic facade.
The archived pre-October `lwonprom` source contains an OpenCL VM design and
hardware helpers, but the current repository has no PyAC OpenCL compiler,
kernel, or device execution contract. `program/runtime/gpu` owns provider and
queue lifecycle for model work; it does not execute PyAC codelets. Adding an
OpenCL backend therefore waits for a kernel ABI, codelet result ABI, device
admission, and conformance fixtures.

For supported semantic codelets, `renderPyashCodelet(words)` performs the
reverse projection from fixed-width PyAC VLIW to canonical Pyash text by
decoding the semantic sentence and using the existing Pyash renderer. The
legacy numeric-plus surface remains available as `hyikdoyu hyikdoka plustu`;
unknown codelets continue to expose diagnostic words rather than invented
semantics.

Vector quote payloads now decode losslessly for the recovered fixed-width
16-bit numeric/letter header families. Vector sentence values remain cataloged
as explicit unsupported semantic rows: the legacy source exposes vector-width
bit fields, yet the recovered encoder has no sentence-level `be vector` golden
fixture or matching execution handler, and those rows carry the stable
`unsupported-vector` reason. Dates likewise have vocabulary and current runtime
values but no recovered legacy date encoding or execution handler; their rows
carry `unsupported-date`. The structural continuation decoder is available for
lossless multi-vector evidence; it does not promote either domain to execution.

Unary `invert`, `exponential`, and vocabulary-only `remains` sentences also
remain outside the proven adapter set. Catalog rows preserve the stable
`unsupported-invert`, `unsupported-exponential`, and `unsupported-remains`
reasons rather than falling through to numeric-plus lowering.

## 8. Conformance

An implementation conforms when it emits deterministic pack bytes, rejects
malformed or tampered input, preserves unsupported records, supports catalog
queries, and replays supported codelets with sentence-shaped results.
