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

## Anchor helpers

- Add anchor form:
  `node command/anchor_words_add.mjs --anchor <name> --form <text> --role <role>`
- Suggest -ing anchors:
  `node command/vocab_anchor_ing_suggest.mjs`

## Notes

- Quoted prompt text does not need Pyash vocabulary.
- `vocab_suggest` accepts paths or raw text; it infers mode by checking if an arg is a file/dir.
