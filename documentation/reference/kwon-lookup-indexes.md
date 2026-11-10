# Kwon lookup indexes

`kwon` and `vocab_suggest` keep the translation catalogs as their canonical records. The three generated `.pya` files beside those catalogs are sorted sidecar indexes for English terms, spaced or packed Pyac forms, and POS-qualified WordNet sense IDs. Their postings identify a source catalog, stable catalog key, UTF-8 byte offset, and line number; the reader seeks to the source record instead of parsing each full catalog for every lookup.

Rebuild the indexes after changing a source catalog:

```sh
node command/vocab_lookup_index.mjs
```

The generated files are:

- `program/library/translation/kwon_english_index.pya`
- `program/library/translation/kwon_pyac_index.pya`
- `program/library/translation/kwon_wordnet_index.pya`

Each index stores SHA-256 hashes of its source files. A lookup with an out-of-date index reports the changed source and asks for a rebuild; it never silently uses stale byte offsets. The original `.pya` and JSON catalogs remain authoritative. Index generation is deterministic, and source reads use byte offsets so multibyte text does not shift later records.

The generated posting lists use a compact source table to avoid repeating long catalog paths on every row. Source hashes are checked once per process; the normal `kwon` command starts a fresh process for each invocation.

The indexes are a first-stage acceleration for direct dictionary queries and targeted compound, bridge, and gloss reads. Full-catalog operations still use the canonical loaders. Binary VLIW encoding is deferred until the `.pya` indexes have been measured against real `kwon` workloads.
