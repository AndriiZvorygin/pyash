---
name: pyash-vocab-tooling
description: "Work with Pyash vocabulary tooling (vocab_suggest, vocab_check, anchor helpers); use when adding new words or checking tokens."
---

# Pyash Vocab Tooling

Use this skill when adding new verbs/names or checking token validity.

## Common commands

- Check a proposed token:
  `node command/vocab_suggest.mjs "new verb name"`
- Scan `.pya` files:
  `node command/vocab_suggest.mjs examples/pyash`
- Enforce known tokens:
  `node command/vocab_check.mjs examples/pyash`
- Ask whether a word is used as a Pyash *name* anywhere:
  `node command/scan_pyashtoken.mjs <word>`
- Inspect a stable Open English WordNet synset directly:
  `kwon n:07558676-n`
- Write machine-readable lookup output:
  `node command/vocab_suggest.mjs n:07558676-n --map /tmp/love-synset.json`

Synset IDs are POS-qualified (`a`, `n`, `r`, `v`, or `s`) and use the matching POS suffix,
such as `n:07558676-n`. The lookup reports the source lemmas and gloss, linked Pyash anchor,
Pyac sequence, and whether the link is active, withheld, or absent. The optional `vocab-suggest-v3`
map is a query result for tooling; the `.pya` bridge and compound catalogs remain canonical.
Vocabulary and synset file reads are asynchronous. Module callers reuse in-flight and loaded
indexes within their process; the `kwon` executable starts a fresh process for each invocation.
For several related terms, pass them in one `kwon term-one term-two` call to share that process's
loaded indexes.

The English, Pyac, and POS-qualified WordNet sidecar lookup indexes are generated from the
canonical catalogs and checked against their source hashes. A stale index produces one warning
after query results, with changed catalog paths and the rebuild command. Lookups scan changed
sources in memory, so current vocabulary additions remain searchable while the persistent
sidecar is stale. After editing catalogs, run `node command/vocab_lookup_index.mjs` to persist
refreshed indexes. The source catalogs remain the canonical records.

## Canonical words over legacy aliases

`vocab_suggest` accepts a word that resolves through the English dictionary
alias table, so a legacy alias can survive unnoticed. A name must be spelled
with the canonical Pyash word, not the alias.

`kind` is such an alias: it resolves to `sort` and is not a Pyash word of its
own. The alias was purged from every Pyash name position (name-role tokens,
map row keys, quoted JSON/YAML keys, quoted Pyash source, and the JavaScript
that writes or reads those keys). `node command/scan_pyashtoken.mjs kind`
reports zero hits, and `quiz/pyash_name_purge.test.mjs` pins that.

`scan_pyashtoken.mjs` only reports name positions. English prose that happens
to use the word is data, not a name, and is skipped.

Exact English dictionary blacklist alternatives take precedence over prefix
matches. For example, `kwon accord` must return its alternatives rather than
the unrelated prefix match `accordions`.

## Anchor helpers

- Add anchor form:
  `node command/anchor_words_add.mjs --anchor <name> --form <text> --role <role>`
- Suggest -ing anchors:
  `node command/vocab_anchor_ing_suggest.mjs`

## Notes

- Quoted prompt text does not need Pyash vocabulary.
- `vocab_suggest` accepts paths or raw text; it infers mode by checking if an arg is a file/dir.
