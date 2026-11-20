# Pyac VLIW Multilingual Dictionary

Status: design contract with a Rust in-memory index prototype. The prototype
indexes parsed entry metadata; it does not yet read or write a serialized
dictionary volume. The target profile organizes a searchable, multilingual
dictionary as ordinary Pyash sentences encoded in the existing `.pyac` VLIW
format.

## 1. Design boundary

The outer container remains the frozen `.pyac` v1 format: its existing
32-byte header followed by a flat, ordered stream of sixteen-word codelets.
The dictionary is an in-band content profile, not a new container version.
Its table of contents, lookup indexes, lexical records, provenance, and
definitions are all ordinary VLIW sentences. There is no binary directory,
opaque JSON record payload, or persisted sidecar index that contains
dictionary truth.

The first data sentence identifies the profile using an ordinary Pyash
relation and typed value. Its relation and profile value must have active,
curated Pyac/HNUC representations before a volume can be encoded. This
reference does not invent that vocabulary: the tempting literal `format`
marker is not currently lowerable through the VLIW named-literal path. The
profile marker does not reserve an HNUC or alter the `.pyac` header. The volume
is read as dictionary data; lookup does not execute its declarative definition
sentences. An optional program link is a separate record and is never followed
by a dictionary lookup as an invocation.

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

The Rust prototype uses sorted posting arrays and binary-search range starts;
postings refer to entry/form/link records rather than copying indexed strings.
Lookup is `O(log n + matches)` after index construction, rather than scanning
every definition. The eventual on-disk reader should use the TOC to locate an
index range and may load only the relevant index pages and entry ranges. The
exact in-band sentence signatures and page-directory representation remain
pending vocabulary-backed decisions; the runtime posting arrays are
disposable indexes, not a persisted sidecar.

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

These local Kwon results are evidence for the eventual sentence signatures.
In the vocabulary workflow, `accepted-llm` means the compound passed the
LLM-review acceptance step; it is distinct from `accepted-curated`, and is
not merely an unreviewed suggestion. The status preserves provenance: model
acceptance is not the same provenance as curated acceptance.

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
| Dictionary | Current atom `kwon` | Existing lexical atom. |

These compounds and links are recorded as supplied by the vocabulary catalog.
The dictionary preserves their exact sense links and provenance; it does not
re-rank or reinterpret the vocabulary decisions. This reference adds no
vocabulary entries.

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

`rust/pyac/src/dictionary.rs` provides an in-memory index over validated
parsed entry descriptors. It supports exact Pyac-key lookup,
language-plus-normalized-surface lookup, version-qualified external-source
lookup, structural operation-signature lookup, and deterministic
language/task projections with reference closure. These are sorted postings
and binary searches; posting records refer to entry/form/link descriptors
rather than duplicating indexed text.

Run the synthetic scaling comparison with
`cargo bench --manifest-path rust/pyac/Cargo.toml --bench dictionary_index`.
It builds 100,000 entries, measures each indexed lookup over 100,000 queries,
and compares against bounded linear scans over the first 100 queries. This is
a repeatable algorithmic baseline, not a substitute for benchmarking a
file-backed dictionary image on target storage.

The Rust crate does not yet parse dictionary records from `.pyac`, emit a
dictionary image, or perform lazy file-backed range reads. The next
implementation slice is to settle the remaining vocabulary-backed relation
signatures and sentence framing, then add a reader/writer that validates the
in-band TOC/index records against the existing pack decoder. A `.pya` sidecar
is not a substitute for the eventual in-band dictionary truth.
