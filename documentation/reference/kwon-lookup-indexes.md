# Kwon lookup indexes

`kwon` and `vocab_suggest` keep the translation catalogs as their canonical records. The generated `.pya` files beside those catalogs are sorted sidecar indexes for English terms, spaced or packed Pyac forms, linked POS-qualified WordNet senses, and raw Open English WordNet synsets. Catalog postings identify a source record by UTF-8 byte offset and line number; raw synset postings identify the JSON object byte span. Readers seek directly to those records instead of parsing each full catalog or corpus for every lookup.

Rebuild the indexes after changing a source catalog:

```sh
node command/vocab_lookup_index.mjs
```

The generated files are:

- `program/library/translation/kwon_english_index.pya`
- `program/library/translation/kwon_pyac_index.pya`
- `program/library/translation/kwon_wordnet_index.pya`
- `program/library/translation/kwon_open_wordnet_index.pya`

The raw synset index uses the corpus configured in `program/library/translation/english_wordnet.pya`. Rebuilding requires that local corpus at its configured path and verifies its configured source hash. A POS-qualified sense query reads only the matching synset record; the canonical bridge, gloss, and compound catalogs remain the source for Pyash links.

Each index stores SHA-256 hashes of its source files. A lookup with an out-of-date index reports the changed source and asks for a rebuild; it never silently uses stale byte offsets. The original `.pya` and JSON catalogs remain authoritative. Index generation is deterministic, and source reads use byte offsets so multibyte text does not shift later records.

The generated posting lists use a compact source table to avoid repeating long catalog paths on every row. Source hashes are checked once per process; the normal `kwon` command starts a fresh process for each invocation.

The indexes accelerate direct dictionary queries and targeted compound, bridge, gloss, and raw-synset reads. Full-catalog operations still use the canonical loaders. Binary VLIW encoding is deferred until the `.pya` indexes have been measured against real `kwon` workloads.
