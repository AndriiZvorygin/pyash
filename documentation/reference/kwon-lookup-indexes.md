# Kwon lookup indexes

`kwon` and `vocab_suggest` keep the translation catalogs as their canonical records. The generated `.pya` files beside those catalogs are sorted sidecar indexes for English terms, spaced or packed Pyac forms, linked POS-qualified WordNet senses, and raw Open English WordNet synsets. Catalog postings point to Pya rows or JSON records; raw synset postings identify the JSON object byte span in the configured local corpus.

Normal lookups use the last built index. They do not hash sources, scan catalogs, or update indexes. During vocabulary work, results may omit entries added since the last refresh; if a rewrite moved a stored byte offset, Kwon skips that mismatched row rather than displaying a different record. Rebuild manually when needed:

```sh
node command/vocab_lookup_index.mjs
```

The generated files are:

- `program/library/translation/kwon_english_index.pya`
- `program/library/translation/kwon_pyac_index.pya`
- `program/library/translation/kwon_wordnet_index.pya`
- `program/library/translation/kwon_open_wordnet_index.pya`

The raw synset index uses the corpus configured in `program/library/translation/english_wordnet.pya`. Rebuilding requires that local corpus at its configured path and verifies its configured source hash. A POS-qualified sense query reads only the matching synset record; the canonical bridge, gloss, and compound catalogs remain the source for Pyash links.

The refinery watchdog refreshes the indexes hourly. Its schedule is managed in Pyash at `world/house/refinery-watchdog/conduct/calendar.pya`, under `kwon lookup index refresh schedule`; the default is `minute 17 every hour`. Set the value to `disabled` to remove the refresh from the managed crontab. Apply schedule changes with:

```sh
node world/house/refinery-watchdog/program/install-cron.mjs
```

The original `.pya` and JSON catalogs remain authoritative. Each index stores source hashes for refresh auditing, while ordinary lookups use only its postings. Pya row reads verify that the row key still matches the indexed record identity.

The generated posting lists use a compact source table to avoid repeating long catalog paths on every row. The normal `kwon` command can start a fresh process for each invocation without paying a catalog-validation scan.

The indexes accelerate direct dictionary queries and targeted compound, bridge, gloss, and raw-synset reads. Full-catalog operations still use the canonical loaders. Binary VLIW encoding is deferred until the `.pya` indexes have been measured against real `kwon` workloads.
