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
from the existing translation registry, translates one source line into one
canonical sentence, and attaches language, locator, line index, and source
text to the existing catalog provenance field. The resulting database uses the
same `.pya` catalog and `.pyac` pack contracts as canonical Pyash input.

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
case, legacy word, literal value, source language, content hash, or canonical
sentence text. Unsupported records remain queryable and retain their error
identity; they never become executable by inference.

Replay validates the pack hash, each codelet hash, semantic decoding, and the
optional recorded result. A mismatch raises a stable database error. A
supported codelet produces the same sentence-shaped result as the reference
interpreter adapter.

The reference command wrapper is `command/pyac_database.mjs`. It keeps the
database interface positional and delegates to the APIs above:

```text
node command/pyac_database.mjs build source.pya catalog.pya codelets.pyac
node command/pyac_database.mjs query catalog.pya codelets.pyac semantic numeric-plus
node command/pyac_database.mjs replay catalog.pya codelets.pyac [record-id]
```

Build input is a canonical Pyash source file. Structural `def` and `prah`
sentences are omitted from the codelet corpus; semantic sentences remain as
executable or explicitly unsupported catalog rows. Query and replay reopen
both files and verify the catalog-to-pack hash before returning results.

The committed starter corpus is
`examples/pyash/pyac-corpus.pya`. It contains executable numeric-plus and
typed-literal rows plus unsupported rows so the database keeps both
compatibility outcomes visible.

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

Rust implementation begins after the JavaScript/Pyash reference writer,
reader, query behavior, and golden fixtures are stable. Rust consumes the same
`.pya` catalog and `.pyac` bytes, then preserves the same result and error
identities. It does not introduce a second semantic vocabulary or database
schema.

## 7. Conformance

An implementation conforms when it emits deterministic pack bytes, rejects
malformed or tampered input, preserves unsupported records, supports catalog
queries, and replays supported codelets with sentence-shaped results.
