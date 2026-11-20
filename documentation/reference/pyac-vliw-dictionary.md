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
relation and typed value. Its relation and profile concept must have active,
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
4. lexical-entry records and their provenance;
5. canonical concept definitions and optional program links.

Every record is a normal Pyash sentence. Every definition is one or more
canonical Pyash sentences in paragraph order, ended by the ordinary `prah`
paragraph marker where needed. A section is a named logical range in the TOC,
not a new opcode or a new word allocation. A printable reader presents these
ranges as book-like sections and preserves the source codelet order.

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

## 3. Identity and multilingual entries

Separate three things that must not collapse into one key:

| Record | Meaning |
| --- | --- |
| Lexical entry | A language-specific written or spoken form, including its normalized lookup form, variants, morphology, and provenance. |
| Concept | The shared semantic identity to which one or more lexical entries refer. It may link to a WordNet or SUMO sense; where no external sense fits, it has a stable project-local identity. |
| Definition | The canonical Pyash sentence paragraph for a concept, encoded as ordinary VLIW codelets. Optional localized glosses are supplementary text, not the canonical definition. |

A language-plus-surface lookup may return multiple lexical entries and concept
IDs. Homographs and polysemy remain explicit; the reader MUST return all
matching senses rather than silently selecting one. One concept may have
lexical entries in many languages, and all resolve to the same canonical
definition paragraph.

Each volume declares its language identifiers and normalization policy in
ordinary VLIW sentences. The source surface is retained exactly. A normalized
surface is an explicit lookup value; case folding, transliteration, or other
aliases are represented as additional indexed forms rather than guessed by
the reader. The initial lookup contract is exact language-plus-normalized-form
matching, with no fuzzy or model-selected fallback.

Stable concept and entry identifiers are quoted VLIW text values, not new
HNUCs. Canonical Pyash/Pyac HNUC sequences are also indexed, but are not
assumed to uniquely identify every external WordNet/SUMO sense. External
identifiers and source citations remain quoted data inside VLIW sentences;
they are links, not executable words.

## 4. Lookup indexes

The volume contains in-band sentence sections for these lookup directions:

| Index | Key | Result |
| --- | --- | --- |
| Language surface | Language ID plus normalized surface form | One or more lexical-entry IDs. |
| Canonical Pyash/Pyac | Exact HNUC word or compound sequence | The associated concept IDs and lexical entries. |
| External sense | Exact POS-qualified WordNet ID or SUMO concept ID | The linked concept and its definition range. |
| Concept location | Stable concept ID | The codelet range containing its canonical definition paragraph. |

Each index section is itself a deterministically ordered sequence of VLIW
sentences. Its TOC range lets a reader find the appropriate index without
scanning definition chapters. Index records point to stable entry/concept IDs
and definition codelet ranges; they do not contain a second copy of the
definition. The field meanings and relation signatures MUST use Pyash cases
and typed quote values. If a needed relation lacks a suitable canonical
vocabulary entry, record that as a vocabulary dependency instead of assigning
an unreviewed HNUC or substituting an unrelated word.

Index order is deterministic by normalized UTF-8 key bytes and then stable ID.
A language-specific normalization policy is part of the volume metadata, so
readers do not depend on host locale collation. A lookup that encounters a
duplicate key returns the complete ordered posting set.

## 5. Definition paragraphs and program links

Definitions are semantic Pyash sentences, not English gloss blobs, JSON
descriptions, or executable code hidden in a quote. They are lowered through
the ordinary sentence-to-VLIW path and remain printable as Pyash. A concept's
definition paragraph may express the concept through other defined concepts;
references use stable concept identities and must resolve within the volume
or an explicitly declared linked dictionary volume.

A concept may separately link to a pure VLIW programlet that demonstrates or
computes an operational interpretation. This link does not replace the
definition, change the concept identity, or make lookup execute code. The
programlet follows the independent-section and execution contract in the VLIW
ISA and is invoked only through an explicit program-execution request.

## 6. Vocabulary evidence and curation status

These local Kwon results are useful candidates for the eventual sentence
signatures. `accepted-llm` is a candidate status, not semantic approval or a
curated dictionary entry.

| Dictionary role | WordNet sense | Current Pyash candidate/status |
| --- | --- | --- |
| Book/compilation | `n:06649049-n`, compilation of known facts | `lwat hpuk`, accepted-LLM candidate. |
| Contents / table of contents | `n:06501650-n`, list of divisions and their locations | `dvis hnok`, accepted-LLM candidate. |
| Alphabetical index | `n:06503777-n`, alphabetical listing of names and topics | `lwat txik`, accepted-LLM candidate. |
| Written entry | `n:06515715-n`, item inserted in a written record | `nyit lwat`, accepted-LLM candidate. |
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
- validate TOC ranges against the codelet count, require section boundaries
  to fall between complete sentences, reject overlapping/out-of-range ranges,
  and reject missing references;
- resolve every index posting to an existing lexical entry or concept and
  every concept-location posting to exactly one definition paragraph;
- preserve multiple senses for a shared surface form and return them in
  deterministic order;
- round-trip the volume to printable Pyash without changing sentences,
  paragraph boundaries, language forms, or index order; and
- keep lookup declarative, with programlet execution available only by
  explicit request.

This is a design specification, not a claim that a multilingual dictionary
builder, reader, or search service already exists.
