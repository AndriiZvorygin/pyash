# Pyac VLIW Multilingual Dictionary

Status: implemented Rust writer and seek-based reader for the v1 dictionary
volume, with in-memory binary-search indexes rebuilt from its VLIW sentences.
The selected permanent location for published volumes is
`program/library/dictionary/`. No production volume is stored there yet. The
writer accepts already-lowered definition codelets; it does not translate
Pyash source text. The profile organizes a searchable, multilingual dictionary
as ordinary Pyash sentences encoded in the existing `.pyac` VLIW format.

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
3. lookup-index sections;
4. dictionary entries, ordered by their canonical Pyac key.

All constituent records are ordinary Pyash sentences. A dictionary entry is
one complete Pyash paragraph or map, using the existing grammar to keep its
sentences together; it is not a new opcode or a new word allocation. Its
definition is one or more canonical Pyash sentences. A TOC item is a named
logical range. A printable reader presents these ranges as navigable groups
and preserves the source codelet order.

Entries are sorted by the unsigned numeric HNUC sequence of the exact
canonical Pyac key in `su`, lexicographically, with a shorter prefix first.
The sequence itself is the identity; no separate entry ID participates in
sorting or lookup.

A volume-level record gives the number of TOC records, so a reader can find
the end of the TOC without scanning definitions or relying on a sidecar. A TOC
record identifies a stable section ID, its role, and its codelet range.
Ranges use zero-based codelet ordinals and codelet counts, never byte offsets.
Each ordinal/count is an unsigned 32-bit value represented in ordinary VLIW
typed data as two unsigned 16-bit words, low word first. The range payload is
`[start-low, start-high, count-low, count-high]`. The profile marker, count,
and TOC records are all ordinary VLIW sentences; their relation signatures
must be vocabulary-backed and use typed quote values. Readers derive byte
positions from the existing fixed-width codelet layout.

The TOC and indexes are first-class dictionary contents and can be printed,
decoded, copied, and validated with the same sentence tools as definitions.
A reader may build disposable in-memory maps from these sentences for fast
lookup. Such maps are caches only: they are rebuilt from the `.pyac` volume
and are never an alternate persisted encoding.

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
| Dictionary entry | The paragraph or map keyed by that Pyac key. It contains the canonical definition plus any lexical-form, source-link, provenance, and optional program-link sentences. |
| Lexical form | A language-tagged written or spoken form, including its exact surface, normalized lookup form, variants, and morphology. It is lookup data inside an entry, not the entry's identity. |
| Source link | A versioned external identifier and explicit mapping relation, such as a WordNet synset, COW record, or SUMO concept. Links document correspondence; they do not add another meaning to the key. |
| Definition | The canonical Pyash sentence paragraph in the entry. Localized glosses are supplementary lexical data, not replacements for the definition. |

A language-plus-surface lookup may return multiple Pyac keys. This represents
homographs or polysemy as separate sense-specific entries; the reader MUST
return all matching keys rather than silently selecting one. One key may have
lexical forms in many languages, all resolving to that entry's single
definition.

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

| Index | Key | Result |
| --- | --- | --- |
| Language surface | Language ID plus normalized surface form | One or more canonical Pyac keys. |
| Canonical Pyac | Exact HNUC atom or compound sequence | The corresponding dictionary-entry range. |
| External source | Dataset, release, and exact external identifier | The matching Pyac key and explicit mapping relation. |
| Entry location | Canonical Pyac key | The codelet range containing that entry. |
| Operation signature | Verb, mood, and unordered grammatical-case/value-type pairs | The operation entry and its descriptive argument/result metadata. |

Each index section is itself a deterministically ordered sequence of VLIW
sentences. Its TOC range lets a reader find the appropriate index without
scanning definition sections. Index records point to canonical Pyac keys and
entry codelet ranges; they do not contain a second copy of the definition.
The field meanings and relation signatures MUST use Pyash cases
and typed quote values. If a needed relation lacks a suitable canonical
vocabulary entry, record that as a vocabulary dependency instead of assigning
an unreviewed HNUC or substituting an unrelated word.

Index order is deterministic by the index's complete key and then by the
canonical Pyac HNUC sequence. Language-surface keys use the declared
normalized UTF-8 form; external-source keys include the dataset and release.
A language-specific normalization policy is part of the volume metadata, so
readers do not depend on host locale collation. A lookup that encounters a
duplicate surface key returns the complete ordered set of Pyac keys. An
operation signature is a structural dispatch description: argument names and
descriptions explain the contract to readers, but do not constrain which
lexical forms may fill the grammatical cases.

The Rust reader validates the in-band index sentence shapes and targets, then
builds sorted posting arrays with binary-search range starts. These arrays are
disposable runtime indexes, not persisted sidecars. Lookup is
`O(log n + matches)` after opening, rather than scanning definitions. Opening
loads the indexes into memory; definitions remain on disk and are fetched by
their validated codelet ranges only when requested.

## 5. Definition paragraphs and program links

Definitions are semantic Pyash sentences, not English gloss blobs, JSON
descriptions, or executable code hidden in a quote. They are lowered through
the ordinary sentence-to-VLIW path and remain printable as Pyash. An entry's
definition paragraph may express its meaning through other defined meanings;
references use their canonical Pyac keys and must resolve within the volume
or an explicitly declared linked dictionary volume.

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
decisions. This reference adds no vocabulary entries.

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

## 8. Implementation status

`rust/pyac/src/dictionary.rs` exposes a deterministic volume writer and a
seek-based file reader. The writer emits the profile marker, metadata, TOC,
canonical/surface/source/location/operation indexes, entry descriptors, and
already-lowered definition sentences as ordinary VLIW codelets. The reader
validates those records, rebuilds searchable postings, and supports exact
Pyac-key location/read, NFC-normalized language-surface lookup, versioned
external-source lookup (returning its relation), and structural operation-
signature lookup. It reads an entry's codelet range on demand rather than
loading all definitions. The separate in-memory `DictionaryIndex` retains its
language/task projection API.

`rust/pyac/examples/dictionary_fixture.rs` is the runnable minimal authoring
example. It creates a typed Pyash definition sentence, adds lexical and
WordNet records, and writes the resulting `.pyac` bytes to stdout:

```sh
cargo run --manifest-path rust/pyac/Cargo.toml --example dictionary_fixture > dictionary.pyac
```

Run the synthetic scaling comparison with
`cargo bench --manifest-path rust/pyac/Cargo.toml --bench dictionary_index`.
It builds 100,000 entries, measures each in-memory indexed lookup over
100,000 queries, and compares against bounded linear scans over the first 100
queries. This is a repeatable algorithmic baseline, not a substitute for
measuring file-backed open and range reads on target storage. The volume is
the persisted source of truth; all lookup arrays are reconstructed from it.

## 9. Vocabulary-agent workflow

Use the [dictionary vocabulary workbook](../suggest/pyac-vliw-dictionary-workbook.md)
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
4. Draft the meaning as ordinary Pyash definition sentences using existing
   canonical keys. Record referenced keys and ensure each is present in the
   volume or an explicitly linked volume.
5. Describe operation signatures by verb, mood, grammatical case, and value
   type. Keep argument names and explanations as documentation, not dispatch
   constraints.
6. Update the workbook with evidence and review state. Only copy an
   `accepted-llm` or `accepted-curated` state when the vocabulary catalog
   itself records that state.

The Rust writer currently consumes `DictionaryVolume` values with already-
lowered definition codelets; there is not yet an importer from this workbook
or from vocabulary catalogs. Vocabulary agents may maintain the tracked
library volume through trusted, version-controlled updates; runtime/model
workers consume the published file read-only. The authoring importer and
release step remain to be automated.
