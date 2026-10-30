---
name: pyash-translation-maintenance
description: "Maintain translation pairs, templates, and anchor words for Pyash; use when updating translation files, adapters, or reverse-pair parsing."
---

# Pyash Translation Maintenance

Use this skill when editing translation pairs/templates, adapters, or anchor word normalization.

## Pair files

- Exact pairs: `program/verbs/exchange/translation/pairs_<lang>.pya`
- Templates: `program/verbs/exchange/translation/pairs_<lang>_templates.pya`
- Anchors: `program/verbs/exchange/translation/anchor_words.pya`

## Adapter flow

- `program/verbs/exchange/translation.mjs` chooses pairs/templates or adapter formatters.
- Reverse matching lives in `program/verbs/exchange/translation/reverse_pairs.mjs`.
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

## Phrase-list translation

- Detect coordination at the phrase level in subject, object, oblique, and
  existential-content roles. Preserve parenthetical examples and conjunctions
  inside a member; do not promote them to sentence connectors.
- Factor a repeated lexical head only when the list also provides explicit
  case-led ellipsis evidence. Keep the member spans, target cases, and
  factorization evidence in the translation `.pya` artifact.
- In postpositional Pyac, place each member's case suffix before `ba`, put `ba`
  between members only, and place a factored shared parent phrase after its
  dependent members. Add the role case to the shared head.
- Use the compositional destination grid for directional targets. If target
  role is ambiguous, make one bounded structured choice through the queued
  Housekeeper mind path; accept only supplied case ids and retain uncertain
  results as review data.
- A `self-` member in a factored list becomes the nominal self target `fyif`
  plus its selected case. Keep `fyoh` for the separate reflexive-voice suffix.
- Keep clause coordination separate: split an `and`/`but`/`or` clause only
  when both sides have clause-action evidence.

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
