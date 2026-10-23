# PyAC VLIW codelet database

Status: design and reference implementation contract. This document defines
the searchable catalog and compiled VLIW container built on the sentence-first
lowering contract in `documentation/specifications/27-pyash-vliw-isa.md`.

## 1. Purpose and boundary

Pyash sentences and paragraphs remain the canonical semantic source. A PyAC
database stores two projections of that source:

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

Chinese compound words provide a small morphology corpus at
`program/verbs/exchange/translation/compound_lexicon_chinese.pya`. It stores
the surface compound, ordered morphemes, canonical Pyash target, optional
English gloss, provenance, confidence, and lowering status in parser-readable
map rows. The loader and query helpers live in
`program/verbs/exchange/translation/compound_lexicon.mjs` and are re-exported
by the Chinese translation adapter.

The compound surface is evidence for translation; canonical Pyash identity
remains the execution authority. Compound rows remain searchable morphology
metadata. A translated sentence becomes executable when its canonical name
and value fit a proven VLIW adapter; automatic HNUC allocation remains outside
this contract.

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
