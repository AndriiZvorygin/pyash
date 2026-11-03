# Translation adapters

This folder keeps per-language adapters separate so contributors can work in parallel.

Pattern:
- `<language>.mjs` exports a line-to-sentence mapper (e.g., `englishLineToSentence`), used as `toPyash`.
- Add Pyash → target language logic by exporting a sentence formatter (e.g., `sentenceToEnglish`), used as `fromPyash`.
- Register new languages in `program/library/translation/registry.mjs` without touching parser or compiler code.

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
it does not create a new Pyash word or bypass sentence-level sense selection. Adjacent
`sense-gloss:<sense-key>` and `sense-lemma:<sense-key>:<index>` rows project the source
WordNet gloss and lemmas for active links.
Open English WordNet remains authoritative in
`know/wordnet/open-english-wordnet-2025-json/`; this small projection lets
`kwon <word-or-Pyac-atom>` show linked glosses and target anchors without loading the full
dataset.
The bounded sense-linking worker is configured in `english_wordnet_linker.pya`. Its
`english_wordnet_linker.mjs` module emits one stable record per WordNet sense, accepts only
targets present in the supplied inventory, and submits unresolved records through the existing
`vyah start future be gpu mind do` queue path. A completed response can be rendered back into
the native `english_wordnet_bridges.pya` map; the linker is evidence generation, not a second
vocabulary or transcript format. The model-backed linker caps one batch at 200 senses and
keeps each queued prompt below 12,000 characters. The deterministic background sweep has its
own 1,000-sense checkpoint batch size. The selected model's durable card is
`translation_model_cards.pya`; Qwen3.5 9B declares a 32,768-token context window, a 3,900-token
safe input budget, and an 8,192-token safe output budget for this workflow. A paragraph-sized
group is sent as one duty when it fits; larger groups split on complete sense rows, so a provider
never receives a truncated sense identity or exhausts the response budget before returning all
decision rows.
The deterministic pre-pass also accepts a low-degree edge synset when one lemma has exactly
one WordNet sense and the target anchor does not identify a competing WordNet sense. Links
carry `targetKind` (`atom` or `compound`) and a stable `targetId` (`atom:<Pyac>` or
`compound:<Pyac parts>`, unless the accepted compound already has a stable record id). Direct
same-synset lemmas and accepted compounds with two or three components can be offered as
bounded choices. WordNet relation atoms, convergent word suggestions, and unverified compounds
remain evidence only; a nearby atom cannot become a sense translation by itself. Composition
search is capped at three atoms.

The bridge index also withholds a target reused by different synsets unless the `.pya` catalog
declares their equivalence. Add one evidence row such as
`su text "equivalence:<group>" ob text "<sense-id-1> <sense-id-2>" via text "shared meaning evidence" ya`;
all listed senses must share the same target and part of speech. Without that row, colliding
bridge rows remain in the catalog as evidence but do not become active links. This keeps the senses of `touch`,
`experience`, `emotionally`, `searching`, and `appear` unresolved where their current bridge
rows share a target. Give each sense a distinct accepted atom/compound before linking it; shared
anchors activate only when the equivalence evidence is recorded.
To scale this deterministic pass across the installed Open English WordNet, run
`node command/wordnet_sense_sweep.mjs`. It classifies every sense using the same safe edge-node
and active-bridge rules as the document refinery. Existing active links are recorded as
`linked-existing`; unique safe edge links become `automatic-link` proposals; target collisions
are marked `needs-equivalence-review`; selectable but context-dependent anchors become
`needs-sense-choice`; and senses without an existing selectable anchor become
`needs-atom-or-compound-anchor`. The sweep makes no model calls and does not edit the curated
bridge catalog.

The sweep is resumable and idempotent. Its batch size is configured by
`sweep-batch-size` in `english_wordnet_linker.pya` (currently 1,000). Stable WordNet and lexical
resource hashes determine the run id. The manifest and numbered checkpoint batches live under
`artifacts/<run-id>/`; `automatic-links.pya` contains only the deterministic proposals and is a
review artifact, not an active bridge map. Existing identical batch checkpoints are reused when
the command runs again. A detached run can be started with:

```bash
setsid node command/wordnet_sense_sweep.mjs > artifacts/wordnet-sense-sweep.log 2>&1 < /dev/null &
echo $! > artifacts/wordnet-sense-sweep.pid
```

Inspect `manifest.pya` and the batch files with `node command/pya_to_json.mjs <file> --pretty`.

The Qwen anchor-decision stage is `node command/wordnet_sense_link_sweep.mjs`. Its Pyash config
starts in `pilot` mode with 12 records: it includes up to two multi-choice rows and samples
single-choice rows across parts of speech by descending English30k frequency. Switch
`model-sweep-mode` in `english_wordnet_linker.pya` to `full`
only after reviewing the pilot. The command submits only
`needs-sense-choice` records through the configured GPU Housekeeper, explicitly selects the
`model` from `english_wordnet_linker.pya`, and awaits each bounded duty before submitting the next.
The model sees a WordNet definition with example clauses removed and only the existing anchors
allowed for that synset. It can accept one supplied anchor, reject the choices, or leave the row
uncertain; it cannot generate Pyash sequences or compounds. Completed decisions are checkpointed
as `.pya` batch artifacts and resume without repeating completed duties. The pilot records a
collision-checked activation preview without changing the active bridge map. In `full` mode,
collision-free accepted links are added to the bridge map with contextual certainty; rejected,
uncertain, and colliding rows remain in the model-stage artifacts for later compound work. The
pilot's completed batch checkpoints lead the full run, so those model duties are reused.
Each model batch artifact includes the exact submitted prompt beside its decisions for review.

Open English WordNet 2025 JSON supplies synsets and relations but no `tag_count`, and its lexical
entry array order is not a reliable frequency rank. Princeton WordNet 3.1's `index.sense` provides
`sense_number` and `tag_cnt` from semantically tagged concordance texts. Counts are evidence from
those concordances, not universal usage frequencies ([sense index format](https://wordnet.princeton.edu/documentation/senseidx5wn), [sense ordering notes](https://wordnet.princeton.edu/documentation/wndb5wn)).

### Frequency-first anchor allocation

`english_wordnet_frequency.pya` pins the official Princeton WordNet 3.1 sense index by source URL,
archive hash, local index path, and index hash. Install or verify that ignored local data with
`node command/wordnet_sense_frequency_setup.mjs`. The command joins its rows to Open English
WordNet 2025 by the exact lexical sense key only. Princeton byte offsets are retained as evidence;
they are never used to join the different OEWN synset release. Missing keys stay unranked rather
than being assigned a fabricated zero count.

Run `node command/wordnet_frequency_allocate.mjs` to allocate existing English30k-covered atoms
and accepted compounds to WordNet synsets. English30k rank is the primary ordering. An exact-key
Princeton `tag_cnt` breaks equal English30k ranks. When that evidence also ties, or a tied option
has no exact-key count, the synset remains for compound work instead of receiving a lexical-order
guess. Allocation is one-to-one: a synset gets at most one anchor and a Pyac target is allocated
to at most one synset. Curated and deterministic bridge rows remain reserved; previous model links
remain active only when their Pyac identity matches the frequency allocation. The active bridge
catalog records the selected lemma, English30k rank, tag count, and exact sense key in its evidence.

The atom-sense sweep is POS-scoped and selects a broad, ordinary general-language sense for an
atom label. It must not infer a sports, technical, regional, or other specialist domain from a bare
homograph; narrower specialist concepts belong in compound work. Its candidate inventory is
limited to WordNet POS forms supported by the atom's exact English labels or accepted same-atom
lemma mappings, but spelling and lemma matches only make candidates eligible; they do not prove
semantic fit. Read `atom-coverage.pya` by atom/POS slot: a unique atom count does not imply that
every atom has noun, verb, and adjective senses, so a three-links-per-atom expectation is not a
valid measure of direct lexical coverage.

The command writes resumable `.pya` batches and a manifest beneath
`artifacts/<run-id>/`, including residual senses, model-link reconciliation, and compound
candidates. It applies the resulting active bridge map to `english_wordnet_bridges.pya`. Inspect
the manifest and worklists with `node command/pya_to_json.mjs <file.pya> --pretty`.

Run `node command/wordnet_frequency_compound_sweep.mjs` to work the residual senses against
existing closed-compound candidates. Alternate decompositions of the same target are presented
together to one bounded verifier duty; duties use the configured Pyash mind and GPU Housekeeper,
never a direct provider request. Decisions are checkpointed to
`english_wordnet_compound_decisions.pya`. Accepted compounds enter the derived verified compound
catalog at `compound_coverage_wordnet_verified.pya`; after the sweep, the allocator runs again so
those newly verified compounds can anchor senses in the active bridge catalog. Rejected and
uncertain candidates remain durable evidence and do not enter the compound lexicon. The remaining
synsets without an existing covered lemma or compound candidate stay explicitly unresolved for a
later atom/compound generation pass.

For those residual senses, run `node command/wordnet_sense_compound_refinery.mjs`. Its Pyash
workflow is `wordnet_sense_compound_refinery.pya`; each launch selects the next 64 frequency-ranked
senses that have a compatible already-linked atomic WordNet head. It asks the configured Qwen mind,
through the future GPU Housekeeper queue, for sense-specific translations and transparent compound
parts in Chinese, French, Russian, and Hindi. The prompt contains one sense definition and no atom
inventory. `vocab_suggest` resolves each English component gloss, and only active one-atom links
with WordNet senses become candidates. Candidates are ordered head-final using the target sense's
directed hypernym evidence, then pass through the same compound verifier and promotion contract as
the closed-word sweep.

The run folder `artifacts/<run-id>/` holds `worklist.pya`, resumable `sense-translations.pya`,
`component-mappings.pya`, `compound-candidates.pya`, `progress.pya`,
`sense-compound-decisions.pya`, and verification artifacts.
Completed translation rows are keyed by WordNet source hash and prompt revision; rerunning resumes
the next eligible batch and reuses valid translations. The append-only run evidence is
`newspaper/<run-id>.pya`. Accepted decisions persist in `english_wordnet_compound_decisions.pya` and
activate only in `compound_coverage_wordnet_verified.pya`; uncertain, rejected, and unmapped results
remain in their artifacts and do not enter the active compound catalog. Re-run the command to
continue; it stops selecting completed senses for the current atomic inventory and prompt revision.

Only compound candidates with at least one target-sense/head-sense pair supported by a directed
same-part-of-speech WordNet hypernym path enter the Housekeeper worklist. Candidates without that
edge remain visible in the allocation artifact as `no-wordnet-head-evidence`; they are not treated
as linguistically false, but the model cannot promote them by rationale alone.

Each review prompt includes up to four frequency-ranked residual WordNet senses for the candidate
and up to four WordNet senses per component, ordered by exact Princeton tag count where available.
It sends definitions only (usage examples after semicolons are removed). An accepted decision must
cite one supplied target synset id and one supplied sense id for the final component, then cite one
supplied WordNet sense and a short semantic contribution for each modifier in component order.
Each modifier contribution is explicitly classified as literal, metaphorical, associative, or uncertain;
promotion requires literal contributions, and explicit figurative wording downgrades an acceptance.
Unknown ids or missing modifier explanations are rejected by the response parser, and the decision
row retains the citations for audit. Promotion also requires the cited target synset to equal the head
sense or reach it through a directed WordNet hypernym path with the same part of speech. Similarity,
material, location, and association edges do not establish a lexical head. The parser downgrades an
acceptance without this relation to uncertain, and the promotion gate independently checks the
saved relation evidence. The
`compound-verification-revision` value in `english_wordnet_frequency_allocation.pya` versions these
decisions: changing the prompt contract reopens stale rows and keeps their prior verdict summary
attached for audit. If a sweep stops after checkpointing a decision but before promoting its
compound, the next run restores eligible accepted rows before continuing.
The verified compound catalog contains only decisions accepted under the configured revision and
stores each decision id/revision as a link to the full `.pya` decision ledger. Raw provider payloads,
component-sense evidence, and prompts remain in the ledger rather than being copied into the active
lexicon.

English30k ranks words rather than WordNet senses. Thus identical ranks do not establish which
synset is more common; the exact-key Princeton counts are used only as the declared tie-breaker.
Untagged senses have no dependable Princeton rank, and counts from the tagged concordances should
not be interpreted as cross-domain or cross-era frequency measurements.
Dictionary aliases are frequency candidates only when their canonical target is an atomic or
accepted compound anchor and both records resolve to the same Pyash sequence. If an alias resolves
to a grammar particle or changes sequence at its canonical target, it stays residual for compound
work rather than colliding with a lexical anchor.

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
The same `english_lemmas.pya` catalog is the reverse-rendering table: a Pyash atom's English
surface gloss (for example `mixed`, `walking`, `containing`, or `triggered`) resolves to its
English lemma before `ki`, `ra`, or `pfih` conjugation. The surface gloss remains available for
lexical readings, while the lemma supplies the conjugation stem; the Pyac renderer therefore
does not maintain a second JavaScript word map.
The same equivalence pass reuses `emotionally` (`xyek`) for `emotion`, `emotions`, `emotional`,
and the emotional-sensitivity sense of `feelings`; plural `pu` and adjective `ci` remain explicit
Pyash grammar suffixes. Broad `feel` and singular `feeling` stay contextual because WordNet
also gives them tactile, perceptual, intuitive, and physical senses. The native bridge catalog
contains evidence for these readings, but colliding targets such as `touch`, `experience`,
`emotionally`, `searching`, and `appear` are withheld from the active bridge index until they
have distinct anchors or an explicit equivalence declaration. Unique anchors such as `awareness`,
`air`, `believe`, and `finger` can still resolve from sentence context.
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

After a sense is selected, the refinery first checks existing atoms and accepted compounds through
the normal WordNet bridge path. When neither supplies a compatible anchor, it may derive a bounded
closed-word compound from covered atoms and run that candidate through the existing queued compound
verifier. Only a verified compound is offered to the normal vocabulary review, where the selected
WordNet gloss is compared with the supplied anchor choices. The native bridge catalog remains the
durable curated lexicon; the document catalog records generated compound evidence and automatic
model decisions without silently changing the global compound list. Accepted sense links are fed
back through the same sentence analyzer before vocabulary review, so the selected sense can affect
the current run. Each selection queue uses an `english-wordnet-select-*` handle and is stored under
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
node -e "import fs from 'node:fs/promises'; import path from 'node:path'; import { buildProgram } from './program/program.mjs'; import { sentenceToPyash } from './program/beautiful.mjs'; import { sentenceToEnglish } from './program/library/translation/english.mjs'; const dir='examples/pyash'; const entries=new Map(); const files=(await fs.readdir(dir)).filter(f=>f.endsWith('.pya')); for (const file of files){ const text=await fs.readFile(path.join(dir,file),'utf8'); const program=buildProgram(text); for (const sentence of program.sentences){ if (!sentence) continue; const pyash=sentenceToPyash(sentence); if (!pyash || entries.has(pyash)) continue; entries.set(pyash, sentenceToEnglish(sentence)); } } const keys=[...entries.keys()].sort(); let out='su name translation_pairs_english be map def\\n'; for (const key of keys){ const val=entries.get(key) ?? ''; out+=`su text ${JSON.stringify(key)} ob text ${JSON.stringify(val)} ya\\n`; } out+='prah\\n'; await fs.writeFile('program/library/translation/pairs_english.pya', out, 'utf8');"
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
Relative-clause direction is a target-language ordering parameter. For this
translation pair, the postpositional Pyac/VLIW structural stream places a
dependent clause before its parent phrase (`la ... ba` followed by the parent).
The English-Pyash projection is prepositional and SVO, so it renders the
complete parent phrase first and then its attached dependent clause
(`the brain that ...`). The clause remains linked to its parent phrase across
both projections.
The `translation` verb accepts `from state pyac` with `to state pyash` or
`to state english`; unknown or unsegmentable Pyac tokens remain hard errors.

Phrase coordination is analyzed as a phrase-level structure in subject,
object, oblique, and existential-content roles. Top-level commas and
conjunctions delimit members; parentheses and conjunctions inside a member
remain attached to that member. A repeated lexical head followed by case-led
ellipsis can be factored into coordinated dependent phrases plus the shared
head. The Pyac/VLIW stream writes each member's phrase-final case, then `ba`
between non-final members, then the shared head with its sentence role case.
That places the dependent list before its parent in the postpositional target
form. The `.pya` translation record keeps the original members, role,
factorization evidence, and selected destination cases so the reverse
projection can restore the shared-head reading.

Directional case choices are sent as one bounded structured decision through
the existing queued mind/Housekeeper route. The prompt contains the source
sentence, shared-head candidate, each directional target, and only the
canonical person, social, and space destination cases. Invalid or uncertain
selections leave the record reviewable. Repeated stage analysis in one run
shares the same in-flight/completed decision by sentence and factorization id.
The duty requests no thinking output, JSON-formatted output, and a 512-token
generation limit. Provider envelopes are reduced to their answer text before
the bounded verifier parses it, so metadata and thinking content do not trigger
an oversized-response repair.

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
