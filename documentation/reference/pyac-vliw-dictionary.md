# Pyac VLIW Multilingual Dictionary

Status: Rust writes dictionary profile v4 and searches its sorted in-band
indexes directly in the raw `.pyac` file. Profile v2 and v3 remain readable
through a seek-and-scan compatibility path; those legacy profiles do not get
runtime-built indexes.
The accepted-vocabulary reference volume is published in
`program/library/dictionary/` and currently contains 58,630 entries in its
existing v3 snapshot. Its regeneration is gated on resolving 3,363 keys with
multiple exact Open English WordNet 2025 senses; v4 rejects those conflicts.
The separate six-entry `english-core` volume remains a small example fixture.
The Rust library writer accepts optional already-lowered native definition
codelets and exact source glosses. The
`pyash dictionary volume` authoring command parses Pyash source and lowers its
definition sentences before calling that writer. The profile organizes a
searchable, multilingual dictionary as ordinary Pyash sentences encoded in
the existing `.pyac` VLIW format.

## 1. Design boundary

The outer container remains the frozen `.pyac` v1 format: its existing
32-byte header followed by a flat, ordered stream of sixteen-word codelets.
The dictionary is an in-band content profile, not a new container version.
Its table of contents, lookup indexes, lexical records, provenance, and
definitions are all ordinary VLIW sentences. There is no binary directory,
opaque JSON record payload, or persisted sidecar index that contains
dictionary truth.

The first sentence identifies the profile with the Pyac key `lyin kwon`
(`n:06639023` in WordNet 3.0, crosswalked to `n:06651548-n` in Open English
WordNet 2025): a machine-readable version of a standard dictionary. Its `ob`
text labels the concrete volume kind, such as `English Pyash dictionary` or
`Chinese Pyash dictionary`:

```text
su name lyin kwon ob text "English Pyash dictionary" be text ya
```

The profile marker uses ordinary dictionary vocabulary and does not reserve
an HNUC or alter the `.pyac` header. The volume is read as dictionary data;
lookup does not execute its declarative definition sentences. An optional
program link is a separate record and is never followed by a dictionary lookup
as an invocation.

The profile uses existing sentence, typed-value, quote, and codelet rules from
the [VLIW ISA](../specifications/27-pyash-vliw-isa.md). Its TOC groups are
logical ranges, not executable programlets.

## 2. In-band book layout

After the profile sentence, codelets appear in this order:

1. volume metadata, including title, revision, and supported language tags;
2. table-of-contents records;
3. four lookup-index sections;
4. dictionary entries, ordered by their canonical Pyac key.

All constituent records are ordinary Pyash sentences. A dictionary entry is
one complete Pyash paragraph or map, using the existing grammar to keep its
sentences together; it is not a new opcode or a new word allocation. Each
entry's exact linked WordNet sense and gloss provide an interim definition
when no native Pyash definition has been authored. V4 permits one distinct
exact WordNet sense per dataset release for each Pyac key; cross-release links
to the same sense are allowed. A native definition is one or more canonical
Pyash sentences and may be added later. V4 TOC sections use fixed ordinal
roles; a printable reader presents them as navigable groups while preserving
the source codelet order.

Entries are sorted by the unsigned numeric HNUC sequence of the exact
canonical Pyac key in `su`, lexicographically, with a shorter prefix first.
The sequence itself is the identity; no separate entry ID participates in
sorting or lookup.

A volume-level record gives the number of TOC records and the entry count.
V4 TOC records use fixed numeric ordinals, not quoted role names. Their
zero-based codelet ranges use `[start-low, start-high, count-low,
count-high]`; offsets in index rows are unsigned 32-bit codelet ordinals.
Readers derive byte positions from the existing fixed-width codelet layout.

The TOC and indexes are first-class dictionary contents and can be printed,
decoded, copied, and validated with the same sentence tools as definitions.
V4 lookup binary-searches the sorted index sentences in place in the raw
file. It creates no runtime maps, scratch copy, or sidecar and uses no fence
records. A probe that lands in a multi-codelet sentence advances to a
complete-codelet boundary and validates the candidate sentence shape before
comparing its key. To make that seek reliable when an indexed text key uses
raw quote continuation, those continuation codelets reserve the first uint16
for the codelet index (zero for continuation) and carry up to fifteen payload
words. The rest of the v4 volume, including profile, entry, and definition
sentences, keeps the ordinary text-quote encoding. V2/v3 compatibility uses
the legacy sixteen-word raw quote payload and query-time seek-and-scan.

## 3. Entry identity and terminology

The canonical Pyac key is the identity of one meaning. It is the exact
canonical atom or compound sequence in the entry's `su` case, represented by
its HNUC sequence. Each key occurs once in the dictionary and denotes exactly
one Pyash meaning. When linked to WordNet, it identifies one synset sense;
versioned crosswalk identifiers may coexist only when they refer to that same
sense. A genuinely different sense must have a different Pyac key; do not put
multiple senses under one key or introduce a second concept ID as the primary
identity.

| Term | Meaning |
| --- | --- |
| Pyac key | The canonical atom or compound in `su`; the unique identity of one meaning. |
| Dictionary entry | The paragraph or map keyed by that Pyac key. It contains lexical forms, exact source links and glosses, optional native Pyash definition sentences, component references, and optional program links. |
| Lexical form | A language-tagged written or spoken form, including its exact surface, normalized lookup form, variants, and morphology. It is lookup data inside an entry, not the entry's identity. |
| Source link | A versioned external identifier and explicit mapping relation, such as a WordNet synset, COW record, or SUMO concept. Links document correspondence; they do not add another meaning to the key. |
| Interim definition | The exact gloss from the linked WordNet sense. It is displayed as a source-derived definition until a native Pyash definition is available. |
| Native definition | The canonical Pyash sentence paragraph in the entry. It is the compositional Pyash definition when present; its absence does not make the entry unavailable. |

A language-plus-surface lookup may return multiple Pyac keys. This represents
homographs or polysemy as separate sense-specific entries; the reader MUST
return all matching keys rather than silently selecting one. One key may have
lexical forms in many languages, all resolving to that entry's exact linked
sense and its interim or native definition.

For example, the English surface `mapping` can index both `pwak hnuc`, linked
to the mathematical function/map sense, and `tcas hjom`, linked to the
chromosome-mapping sense. These are different Pyac keys because they identify
different meanings; a surface lookup returns both, while a WordNet lookup by
exact version and synset selects the corresponding one.

For programming-oriented English display, the bare term `map` denotes the
mathematical function sense (`pwak hnuc`, `n:13806028-n`). Other meanings use
an explicit English compound when needed to disambiguate. For example,
`chromosome mapping` (`tcas hjom`, `n:01026585-n`). This display convention
does not collapse senses: if a lexical surface is shared, exact surface lookup
still returns every linked Pyac key.

Each volume declares its language identifiers and normalization policy in
ordinary VLIW sentences. The source surface is retained exactly. A normalized
surface is an explicit lookup value; case folding, transliteration, or other
aliases are represented as additional indexed forms rather than guessed by
the reader. The initial lookup contract is exact language-plus-normalized-form
matching, with no fuzzy or model-selected fallback.

The Pyac key itself identifies the entry; a second arbitrary concept or entry
ID is unnecessary. External database identifiers remain quoted data inside
VLIW source-link sentences. Version-specific identifiers, such as WordNet
3.0 and 3.1 crosswalk targets, may both be recorded when they refer to the
same keyed meaning. SUMO and other ontology links may have distinct explicit
mapping relations. Conflicting WordNet senses under one key are a curation
error, not a reason to give that key multiple meanings.

### Derived dictionary views

The multilingual reference volume is the canonical source. A language- or
task-specific dictionary is a deterministic projection of that volume, not a
separately authored truth. A projection retains canonical Pyac keys,
definitions, source links, and provenance for selected entries; it includes
the transitive closure of definition references, then rebuilds its TOC and
lookup indexes. A translated definition is included only when separately
authored and linked as a language-specific definition record.

## 4. Lookup indexes

The volume contains in-band sentence sections for these lookup directions:

| V4 index section | Sort key | Result |
| --- | --- | --- |
| Canonical Pyac | Exact HNUC atom or compound sequence in the subject | Entry start offset (`at` uint32). |
| Language surface | Normalized surface in the subject, then language | Sorted entry offsets (`at` uint32 or uint32 vector). |
| External source | Identifier in the subject, then dataset and release | Sorted entry offsets (`at` uint32 or uint32 vector). |
| Operation signature | Canonical signature words in the subject | Sorted entry offsets (`at` uint32 or uint32 vector). |

The corresponding decoded sentence shapes are compact. The subject is the
lookup key; `at` contains only the result offset(s):

```text
su name drut hnuc at num 12312 be text ya
su text "vector" as text "en" at num 12312 be text ya
su text "n:05873161-n" as text "wordnet" from text "OEWN 2025" at ve num 12312 16384 be text ya
su ve num <canonical-signature-words> at num 12312 be text ya
```

These are sentence-level renderings of the index rows; the serialized file
uses the corresponding typed VLIW quote widths and fixed ordinal TOC sections.

Each index section is a deterministically ordered sequence of VLIW sentences.
V4 row schemas are distinguished by section ordinal, subject type, and
case/type sequence; English schema labels are not stored as quoted text. Rows
point directly to entry offsets and do not copy definitions.

Their ordering uses the complete index key and then entry offset. Surface keys
use UTF-16 code-unit order to match the VLIW text payload. Source keys order by
identifier, dataset, and release. A language-specific normalization policy
is part of volume metadata, so readers do not depend on host locale
collation. Duplicate surface and source keys return every matching offset.
Operation argument names and explanations describe a signature for readers,
but do not constrain lexical forms.

The canonical index replaces the separate entry-location index. An entry
starts at its indexed offset and ends at the next canonical offset; the last
entry ends at the entries-section boundary. V4 profile metadata includes the
entry count. Entry metadata records precede native definition sentences and
are recognized by their case/type patterns rather than text labels. A
zero-length definition is the entry's end offset. V2/v3 volumes retain their
entry-location index and are scanned on demand without constructing posting
arrays or maps.

For v4, binary search reads candidate sentences from the index section using
codelet offsets and the existing continuation/completion bit. It parses and
validates each candidate row before comparing keys. Lookup is
`O(log n + row width + matches)` reads and does not scan the definitions area.
No index is loaded or materialized at open time.

## 5. Definition paragraphs and program links

An interim definition is the exact gloss attached to one of the entry's linked
WordNet synsets, stored as quoted source data together with its language,
dataset, release, and identifier. The source link and gloss must agree exactly.
This gives every linked sense a readable definition while the vocabulary is
still being built. A native Pyash definition is semantic Pyash sentences, not
an English gloss blob, JSON description, or executable code hidden in a
quote. It is lowered through the ordinary sentence-to-VLIW path and remains
printable as Pyash. A native definition may express its meaning through other
defined meanings; references use their canonical Pyac keys and must resolve
within the volume or an explicitly declared linked dictionary volume.

An entry may separately link to a pure VLIW programlet that demonstrates or
computes an operational interpretation. This link does not replace the
definition, change the Pyac key, or make lookup execute code. The programlet
follows the independent-section and execution contract in the VLIW ISA and is
invoked only through an explicit program-execution request.

## 6. Vocabulary evidence and curation status

These local Kwon results establish the Pyac concepts used by the profile and
record signatures. In the vocabulary workflow, `accepted-llm` means the
compound passed the LLM-review acceptance step; it is distinct from
`accepted-curated`, and is not merely an unreviewed suggestion. The status
preserves provenance: model acceptance is not the same provenance as curated
acceptance.

| Dictionary role | WordNet / crosswalk sense | Current Pyash candidate/status |
| --- | --- | --- |
| Book/compilation | `n:06649049-n`, compilation of known facts | `lwat hpuk`, accepted-LLM. |
| Contents / table of contents | `n:06501650-n`, list of divisions and their locations | `dvis hnok`, accepted-LLM. |
| Alphabetical index | `n:06503777-n`, alphabetical listing of names and topics | `lwat txik`, accepted-LLM. |
| Dictionary entry | WordNet 3.0 `n:06300823` -> Open English WordNet 2025 `n:06311813-n`; the entry in a dictionary of information about a word. | `tlat kwon`, accepted-LLM. |
| General written-record entry | `n:06515715-n`, an item inserted in a written record | `nyit lwat`, accepted-LLM. |
| Word definition | `n:06757091-n`, concise explanation of a word's meaning | `pcat nyif`, accepted-LLM. |
| Mathematical map / function | WordNet 3.0 `n:13783816` -> Open English WordNet 2025 `n:13806028-n`; a single-valued mathematical relation from domain elements to range elements. | `pwak hnuc`, linked compound, accepted-LLM. |
| Chromosome mapping | WordNet 3.0 `n:01024643` -> Open English WordNet 2025 `n:01026585-n`; the process of locating genes on a chromosome. | `tcas hjom`, linked compound, accepted-LLM. |
| General dictionary | Open English WordNet 2025 `n:06430544-n`, a reference book containing an alphabetical list of words and information about them. | `kwon`, existing lexical atom. |
| Machine-readable dictionary profile | WordNet 3.0 `n:06639023` -> Open English WordNet 2025 `n:06651548-n`, a machine-readable version of a standard dictionary. | `lyin kwon`, the profile marker subject. Its `ob` text gives the concrete kind, such as `English Pyash dictionary`. |
| Normalization policy | Open English WordNet 2025 `n:05910115-n`; a plan of action adopted by an individual or group. | `trec kfan`, accepted-LLM. The selected normalization algorithm is stored as exact quoted policy data; it is not inferred from this concept. |
| Data | WordNet 3.0 `n:08462320` -> Open English WordNet 2025 `n:08479331-n`; a collection of facts from which conclusions may be drawn. | `drut hnuc`, accepted-LLM. Dataset names and release labels remain exact quoted source data; no dataset compound is required. |
| Identifier | WordNet 3.0 `n:07270601` -> Open English WordNet 2025 `n:07285306-n`; a symbol that establishes the identity of what bears it. | `hdiftyec`, confirmed for this schema by the user; external identifier values remain exact quoted source data. |
| Mathematical interval | WordNet 3.0 `n:06016276` -> Open English WordNet 2025 `n:06025625-n`; the set of points between two endpoints. | `hkic tri2k`, accepted-LLM. TOC ranges are encoded as start ordinal plus count. |

Existing catalog compounds and links are recorded as supplied by the
vocabulary catalog. The `hdiftyec` identifier mapping is the user-confirmed
schema choice being linked by vocabulary work. The dictionary preserves exact
sense links and provenance; it does not re-rank or reinterpret vocabulary
decisions. The writer allocates no Pyash words; new entries must use keys from
the canonical atom and compound catalogs.

## 7. Conformance and validation

A conforming volume and reader MUST:

- retain the v1 `.pyac` header and encode all profile content as normal VLIW
  codelets;
- give each Pyac key exactly one entry and one meaning; conflicting senses
  require distinct keys;
- validate TOC ranges against the codelet count, require section boundaries
  to fall between complete sentences, reject overlapping/out-of-range ranges,
  and reject missing references;
- resolve every index posting to an existing Pyac key and entry range;
- preserve each external sense identifier and its linked Pyac key exactly;
  equal English surfaces do not merge distinct senses or compounds;
- match operation signatures by verb, mood, grammatical cases, and value
  types, while keeping human-readable parameter labels outside the dispatch
  key;
- preserve all distinct Pyac keys for a shared surface form and return them
  in deterministic order;
- generate language/task projections deterministically and include referenced
  definition entries transitively;
- round-trip the volume to printable Pyash without changing sentences,
  paragraph boundaries, language forms, or index order; and
- keep lookup declarative, with programlet execution available only by
  explicit request.

## 8. Build, read, and measure

Build the Rust command once during setup. Normal dictionary commands use this
compiled executable and never invoke Cargo or compile source:

```sh
cargo build --release --manifest-path rust/pyac/Cargo.toml --bin pyac-dictionary
```

The author-facing interface is `pyash dictionary volume`. It imports a
Pyash-source file, builds/replaces a compiled volume, and uses the Rust binary
for inspection, lookup, definition reads, and throughput measurement. The
full reference is generated from canonical vocabulary catalogs on `dev-vocab`;
after a vocabulary update, regenerate `reference.pya` there, sync that source
to the runtime worktree, and rebuild the compiled volume:

```sh
pyash dictionary volume build from program/library/dictionary/reference.pya to program/library/dictionary/reference.pyac
pyash dictionary volume inspect program/library/dictionary/reference.pyac
pyash dictionary forecast
pyash dictionary n:07285306-n
pyash dictionary sumo:Identifier
pyash dictionary hnan to zh
pyash dictionary volume lookup program/library/dictionary/reference.pyac surface zh 你
pyash dictionary volume lookup program/library/dictionary/reference.pyac source wordnet "Open English WordNet 2025" n:07285306-n
pyash dictionary volume read program/library/dictionary/reference.pyac key hdiftyec
pyash dictionary volume benchmark <v4-volume.pyac> surface en forecast 100000 to artifacts/dictionary-benchmarks/reference.pya
```

`pyash dictionary` is also available as `pyash dict`. It searches the compiled
reference volume by English form, Chinese form, exact WordNet sense ID, SUMO
concept ID, or canonical Pyash key. A SUMO lookup uses `sumo:<concept>`.
`pyash dictionary <key> to zh` prints the Chinese form first, then available
Pinyin/Jyutping and the English component breakdown.
Multi-character readings are included only when every Han character has one
local reading and the surface maps to one Pyash key. Surface lookups return
all matching sense keys for homographs.

New `.pya` sources start with the profile and v4 metadata sentences:

```pyash
su name lyin kwon ob text "English Pyash dictionary" be text ya
su name lyin kwon ob text "English reference" as num 2 from text "en" to text "NFC" with text "pyac-vliw-dictionary/4" be text ya
```

V4 entries use the canonical Pyac key directly as their `su` name. Metadata
sentences are identified by their case/type signatures, not quoted labels;
native definition sentences follow the metadata for that key. Key words are
resolved through the active Pyash HNUC vocabulary. A source gloss must match
an exact source link and supplies the interim definition. Unknown key atoms
fail, and native definitions are lowered through the existing VLIW compiler.
The importer still accepts v3 authored source for the checked-in generated
snapshot; it serializes accepted entries with the v4 Rust writer. For
standalone volumes, editing the `.pya` source and rebuilding the `.pyac`
volume is the supported add/update workflow. For the accepted reference
volume, update canonical vocabulary catalogs, resolve the exact-sense curation
gate, regenerate the snapshot, then rebuild the volume. Neither workflow
recompiles the Rust executable.

For example, this adds an English form and an exact WordNet interim gloss to
the existing compound `rwoc hrom`:

```pyash
su name rwoc hrom as text "en" from text "procedure" to text "procedure" be text ya
su name rwoc hrom as text "wordnet" from text "Open English WordNet 2025" to text "n:01025762-n" by text "exact-sense" be text ya
su name rwoc hrom as text "en" from text "wordnet" to text "Open English WordNet 2025" by text "n:01025762-n" with text "course of action intended to achieve a result" be text ya
```

After adding the block and profile metadata to a standalone source, build the
volume, then retrieve the entry by `procedure`, `n:01025762-n`, or `rwoc hrom`.
For the full accepted reference, create or update the corresponding canonical
compound and sense-link catalog records instead; the snapshot generator
projects those records into the same entry shape.

Each executable response reports executable bytes, volume bytes, and relevant
open/read/lookup/build durations. The `benchmark` command performs five warmup
lookups, then measures the requested iteration count and writes a Pyash `.pya`
measurement record to the specified destination. The record includes the
timestamp, host/platform/architecture, executable and volume sizes, codelet
count, warmup and measured iteration counts, index-open time, total and mean
lookup time, lookup rate, and result count. It is persistent comparison
evidence; printed JSON is only the immediate CLI response.

`rust/pyac/src/dictionary.rs` exposes the deterministic writer and seek-based
reader APIs. V4 lookup searches raw index codelets directly; v2/v3 lookup uses
query-time scanning without runtime indexes. Throughput benchmarks require
v4 so a high iteration count cannot accidentally scan a legacy volume for
hours. Entry records and optional native definitions are fetched on demand
using codelet offsets. Gloss-only entries remain searchable. The separate
in-memory `DictionaryIndex` retains its language/task projection API.
The synthetic scaling comparison remains available with
`cargo bench --manifest-path rust/pyac/Cargo.toml --bench dictionary_index`;
it is an algorithmic baseline, not a substitute for the file-backed CLI
measurement above.

## 9. Vocabulary-agent workflow

Use the [dictionary vocabulary workbook](../workbook/pyac-vliw-dictionary.md)
as a curation handoff. It records candidates and evidence; it is not the
canonical vocabulary catalog or a compiled dictionary volume.

For each proposed dictionary entry, agents should:

1. Select the exact active Pyac atom or compound and copy its HNUC sequence
   from the vocabulary catalog. Do not create a second key for an existing
   meaning.
2. Resolve the intended WordNet/SUMO/etc. concept by exact versioned source ID
   and gloss. Record the mapping relation; use a distinct Pyac key for a
   distinct sense. Keep the machine-readable profile key `lyin kwon` separate
   from the general dictionary atom `kwon` and from the entry-structure key
   `tlat kwon`.
3. Record each language form with its exact surface and NFC lookup form.
   Preserve case; add case or spelling variants as separate forms instead of
   silently folding them together.
4. Store the exact WordNet gloss as an interim definition linked to its source
   sense. Add a native Pyash definition when its compositional meaning is
   ready, using existing canonical keys. Record referenced keys and ensure
   each is present in the volume or an explicitly linked volume.
5. Describe operation signatures by verb, mood, grammatical case, and value
   type. Keep argument names and explanations as documentation, not dispatch
   constraints.
6. Update the workbook with evidence and review state. Only copy an
   `accepted-llm` or `accepted-curated` state when the vocabulary catalog
   itself records that state.

The source importer resolves entry names against this checkout's active Pyash
HNUC vocabulary and lowers definition sentences with the existing VLIW
compiler. It validates the documented record kinds and sends the resulting
structured build request to the Rust writer over stdin; that request is
transient and is not saved as a JSON state file. The workbook and vocabulary
catalog are curation inputs, not runtime dictionary data. Vocabulary agents
update the canonical atom/compound and source-link catalogs, then the
`build_reference_source.mjs` generator creates the accepted snapshot. A
maintainer rebuilds and validates the published `.pyac` volume. Runtime readers
consume the compiled volume directly.
