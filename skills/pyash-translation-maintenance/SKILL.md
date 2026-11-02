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
- The frequency-first WordNet workflow is configured in
  `english_wordnet_frequency.pya` and
  `english_wordnet_frequency_allocation.pya`. Run
  `node command/wordnet_sense_frequency_setup.mjs` to verify/install the pinned
  Princeton WordNet 3.1 `index.sense`, then
  `node command/wordnet_frequency_allocate.mjs` to reconcile the full OEWN
  synset set against existing English30k-ranked atoms and accepted compounds.
- English30k rank is the primary ordering. Exact Princeton `tag_cnt` values
  join by lexical sense key only and break equal English30k ranks. If the rank
  and available tag counts do not select a unique lemma, leave the synset for
  compound work; do not break a semantic tie by alphabetic order. Missing
  exact-key counts stay unknown, not zero. Preserve the resource version and
  count in bridge evidence.
- A dictionary alias can anchor a sense only when its canonical target is an
  atomic or accepted compound anchor and both resolve to the same Pyash
  sequence. Grammar particles are not lexical sense anchors; leave aliases
  that resolve to grammar or change sequence as residual candidates.
- Allocation keeps one active anchor per synset and one synset per Pyac target.
  Curated and deterministic bridge rows stay reserved. Existing model links
  remain only when their selected Pyac identity agrees with the frequency
  allocation; the full reconciliation is saved under the run's artifacts.
- Every frequency-allocation run emits `atom-coverage.pya` in its artifact
  folder. It groups `pyashWords` by distinct Pyac identity and records English
  labels, English30k ranks, direct WordNet sense candidates, active bridge
  links, and a status for each atom. Read the manifest counters and this ledger
  before beginning another linking pass. Work only from the unlinked rows:
  distinguish grammar-only atoms, missing English glosses, direct candidates
  that remain free, candidates already linked to another anchor, and atoms
  with no exact WordNet candidate. Preserve linked rows as checkpoints and do
  not infer unsupported sense links.
- Run `node command/wordnet_frequency_compound_sweep.mjs` to verify residual
  closed-compound candidates through the configured Pyash mind and GPU
  Housekeeper. Never call a provider directly. The sweep groups alternate
  decompositions into one duty, checkpoints each decision in
  `english_wordnet_compound_decisions.pya`, promotes only accepted compounds
  to `compound_coverage_wordnet_verified.pya`, then reruns allocation so new
  compounds can become active sense anchors. Rejected and uncertain candidates
  remain evidence; synsets with no covered lemma or compound candidate remain
  explicit residuals for later atom/compound generation.
- Compound worklists include closed single-token forms from English30k that
  segment into two or three existing atomic lemmas, plus multiword WordNet
  lemmas whose space, underscore, or hyphen boundaries match existing atoms.
  WordNet phrase boundaries produce review candidates, never automatic
  acceptance. English spelling boundaries also remain candidates requiring
  semantic review. Existing source records keep stable candidate identities
  when these sources are added. Worklist items and Housekeeper duties run in
  English30k rank order, with exact Princeton WordNet 3.1 tag counts breaking
  equal-rank ties; missing counts stay unknown and sort last.
- Compound verification prompts receive up to four frequency-ranked residual
  WordNet senses and up to four senses per component, with definition text only;
  strip usage examples after the semicolon. Every accepted decision must cite
  a supplied target synset id, a supplied final-component sense id, and one
  supplied WordNet sense, a concise contribution explanation, and a literal vs
  figurative relation label for each modifier in component order. Only literal
  modifier contributions can be promoted. The target sense must equal the head sense or reach
  it through a directed same-part-of-speech WordNet hypernym path. Similarity and
  associative relations do not prove lexical headhood. The parser rejects missing
  or invented modifier citations, and the promotion gate independently requires
  saved modifier evidence and the head relation. Candidates lacking any
  compatible target/head pair stay in the artifact as `no-wordnet-head-evidence`
  and are not sent to the model. Bump
  `compound-verification-revision` when this decision contract changes so old
  candidate rows are re-evaluated with their prior verdict retained as evidence.
  Rebuild the derived active catalog from the current revision only; keep full
  provider and sense evidence in the decision ledger and link active entries by
  candidate id rather than copying raw responses into the lexicon.
- `node command/wordnet_sense_link_sweep.mjs` remains the separate contextual
  selector for synsets that have multiple existing selectable anchors. It
  accepts only supplied choices, uses Housekeeper, and does not create atoms
  or compounds. The frequency allocator does not infer ranks from Open English
  WordNet JSON entry-array order. Princeton `tag_cnt` is concordance evidence,
  not a universal frequency measurement; untagged senses have no dependable
  count-based ordering.

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
- `node --test quiz/translation_english_wordnet_frequency.test.mjs quiz/translation_english_wordnet_frequency_compounds.test.mjs`
