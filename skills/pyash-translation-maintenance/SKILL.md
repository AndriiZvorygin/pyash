---
name: pyash-translation-maintenance
description: "Maintain translation pairs, templates, and anchor words for Pyash; use when updating translation files, adapters, or reverse-pair parsing."
---

# Pyash Translation Maintenance

Use this skill when editing translation pairs/templates, adapters, or anchor word normalization.

## Pair files

- Exact pairs: `program/library/translation/pairs_<lang>.pya`
- Templates: `program/library/translation/pairs_<lang>_templates.pya`
- Anchors: `program/library/translation/anchor_words.pya`

## Adapter flow

- `program/verbs/exchange/translation.mjs` chooses pairs/templates or adapter formatters.
- Reverse matching lives in `program/library/translation/reverse_pairs.mjs`.
- Anchor normalization is applied for gloss → Pyash inside translation (not core parse fallback).

## Pyash/Pyac surface boundary

- Readable Pyash uses prepositions and role words before their noun phrases;
  `ob` must introduce object content and must never be followed immediately by
  another preposition such as `for` or `to`.
- Pyac/VLIW uses the same case meanings as phrase-final suffixes, such as `ka`
  for accusative and `pwah` for benefactive.
- Keep the projections separate: do not fix a Pyash ordering problem by
  postposing English prepositions, and do not treat Pyac suffix order as
  readable Pyash word order.

## Update anchors quickly

- Add a line by hand:
  `su name <anchor> ob text "<form>" as wo <role> ya`
- Or run:
  `node command/anchor_words_add.mjs --anchor <name> --form <text> --role <role>`
- For -ing suggestions:
  `node command/vocab_anchor_ing_suggest.mjs`

## Tests to run

- `node --test quiz/translation.test.mjs`
- `node --test quiz/translation_pairs_english.test.mjs`
- `node --test quiz/translation_pairs_templates.test.mjs`
- `node --test quiz/translation_anchor_words.test.mjs`
