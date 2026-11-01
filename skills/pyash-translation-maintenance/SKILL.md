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
- In readable English Pyash, place sentence mood and its aspect marker together
  before the SVO clause (for example, `can often su love be identity-mix`).
  Keep the encoded aspect after the verb and voice markers in Pyac, followed by
  the sentence-final mood.
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

## WordNet sense anchors

- Treat the selected WordNet synset as the semantic unit. Record its displayed
  sense lemma as well as its POS and synset id.
- A direct same-synset atom can be offered as an anchor. Automatic linking also
  requires a low-degree edge node with one WordNet meaning, and the target word
  must not name a competing WordNet sense.
- An accepted compound with two or three Pyash components can be offered as a
  sense anchor. Candidate-only compounds, unverified component compositions,
  WordNet relation atoms, and convergent `vocab_suggest` atoms are evidence;
  they are not selectable links.
- Keep `targetKind` (`atom` or `compound`) and a stable `targetId` on every
  accepted sense link. Prefer a compound record id; otherwise derive it from
  the ordered Pyash components.
- Do not activate one bridge target for multiple WordNet synsets unless the
  bridge catalog records evidence that those senses are equivalent. Declare
  the group with a native `.pya` row such as
  `su text "equivalence:<group>" ob text "<sense-id-1> <sense-id-2>" via text "shared meaning evidence" ya`.
  Every sense sharing that target must be in the group and use the same target
  and part of speech; otherwise leave the colliding rows as evidence and
  withhold them from the active index.
- Do not bulk-link every WordNet synset. Pilot the reusable linker on selected
  senses from the working translation and a few contrasting cases, then
  inspect accepted and unresolved records before expanding scope.
- For the bounded catalog workflow, `node command/wordnet_sense_link_sweep.mjs`
  processes only `needs-sense-choice` rows with existing selectable anchors. It
  uses the configured model through Housekeeper, stores per-batch `.pya`
  checkpoints, and activates only accepted links that pass bridge collision
  checks. Senses with no selectable anchor remain candidates for atom/compound
  work; the linker never creates a compound.
- Do not infer atom sense frequency from Open English WordNet JSON entry-array
  order. That source has no `tag_count`; atom defaults need an explicit ranked
  sense resource. Princeton WordNet's `index.sense` has `tag_cnt` values from
  semantic concordances; tagged senses are usually ranked by those counts, but
  untagged senses have no reliable rank and the counts are not universal
  frequency measurements. Preserve the resource version and counts when using
  them for atom defaults.

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
- `node --test quiz/translation_english_wordnet_linker.test.mjs quiz/translation_english_wordnet_refinery.test.mjs quiz/translation_vocabulary_queue.test.mjs quiz/translation_english_wordnet_bridges.test.mjs`
