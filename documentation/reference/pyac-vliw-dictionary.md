# Pyac VLIW Multilingual Dictionary

Status: proposed design contract; no dictionary reader or image builder is
implemented by this document. This profile organizes a searchable,
multilingual dictionary as a printable sequence of ordinary Pyash sentences
encoded in the existing `.pyac` VLIW format.

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
the [VLIW ISA](../specifications/27-pyash-vliw-isa.md). It does not use
`myocpfun` as a chapter marker: that compound delimits independent executable
programlets, not dictionary sections.

## 2. In-band book layout

After the profile sentence, codelets appear in this order:

1. volume metadata, including title, revision, and supported language tags;
2. table-of-contents records;
3. lookup-index sections;
4. dictionary entries, ordered by their canonical Pyac key.

All constituent records are ordinary Pyash sentences. A dictionary entry is
one complete Pyash paragraph or map, using the existing grammar to keep its
sentences together; it is not a new opcode or a new word allocation. Its
definition is one or more canonical Pyash sentences. A section is a named
logical range in the TOC. A printable reader presents these ranges as
book-like sections and preserves the source codelet order.

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

## 4. Lookup indexes

The volume contains in-band sentence sections for these lookup directions:

| Index | Key | Result |
| --- | --- | --- |
| Language surface | Language ID plus normalized surface form | One or more canonical Pyac keys. |
| Canonical Pyac | Exact HNUC atom or compound sequence | The corresponding dictionary-entry range. |
| External source | Dataset, release, and exact external identifier | The matching Pyac key and explicit mapping relation. |
| Entry location | Canonical Pyac key | The codelet range containing that entry. |

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
duplicate surface key returns the complete ordered set of Pyac keys.

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

These local Kwon results are useful candidates for the eventual sentence
signatures. `accepted-llm` is a candidate status, not semantic approval or a
curated dictionary entry.

| Dictionary role | WordNet / crosswalk sense | Current Pyash candidate/status |
| --- | --- | --- |
| Book/compilation | `n:06649049-n`, compilation of known facts | `lwat hpuk`, accepted-LLM candidate. |
| Contents / table of contents | `n:06501650-n`, list of divisions and their locations | `dvis hnok`, accepted-LLM candidate. |
| Alphabetical index | `n:06503777-n`, alphabetical listing of names and topics | `lwat txik`, accepted-LLM candidate. |
| Dictionary entry | WordNet 3.0 `n:06300823` -> Open English WordNet 2025 `n:06311813-n`; the entry in a dictionary of information about a word. | `tlat kwon` (word + dictionary), accepted-LLM candidate; not curated. |
| General written-record entry | `n:06515715-n`, an item inserted in a written record | `nyit lwat`, accepted-LLM candidate. |
| Word definition | `n:06757091-n`, concise explanation of a word's meaning | `pcat nyif`, accepted-LLM candidate. |
| Dictionary | Current atom `kwon` | Existing lexical atom. |
| Chapter | No suitable dictionary-book sense selected | Use TOC ranges and ordinary paragraph boundaries; do not force a nearby sense or allocate a special chapter HNUC for this profile. |

The candidates document search evidence only. Before a later implementation
uses them as Pyash names, vocabulary review must confirm their exact senses,
component order, and active HNUCs. This reference adds no vocabulary entries.

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
- preserve all distinct Pyac keys for a shared surface form and return them
  in deterministic order;
- round-trip the volume to printable Pyash without changing sentences,
  paragraph boundaries, language forms, or index order; and
- keep lookup declarative, with programlet execution available only by
  explicit request.

This is a design specification, not a claim that a multilingual dictionary
builder, reader, or search service already exists.
