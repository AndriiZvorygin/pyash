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

## Anchor helpers

- Add anchor form:
  `node command/anchor_words_add.mjs --anchor <name> --form <text> --role <role>`
- Suggest -ing anchors:
  `node command/vocab_anchor_ing_suggest.mjs`

## Notes

- Quoted prompt text does not need Pyash vocabulary.
- `vocab_suggest` accepts paths or raw text; it infers mode by checking if an arg is a file/dir.
