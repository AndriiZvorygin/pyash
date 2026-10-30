# Translation parity and anchor notes

This reference document contains implementation notes, test/example inventories,
coverage status, and anchor-word maintenance details supporting the normative
translation contract in `documentation/specifications/11-translation.md`.

## Reverse pairs and template matching

Implementation lives in `program/library/translation/reverse_pairs.mjs`.

- Reverse pairs invert each `pairs_<lang>.pya` exact-pair file into a gloss → Pyash map.
- Reverse templates compile gloss templates to regular expressions with placeholder
  captures, then substitute those captures into the Pyash template.
- Matching prefers the longest matching gloss template.
- Boolean glosses normalize per language: English `truth/lie` or `true/false`,
  Russian `истина/ложь`, and French `vrai/faux`.

`parse()` fallback uses reverse pairs/templates without an adapter. `be translation do`
uses the same path for most adapters; Russian, Chinese, Interlingua, and Hindi also
retain direct parsing paths.

## Tests that define truth

- `quiz/translation.test.mjs`
- `quiz/translation_anchor_words.test.mjs`
- `quiz/translation_pairs_english.test.mjs`
- `quiz/translation_pairs_russian.test.mjs`
- `quiz/translation_pairs_french.test.mjs`
- `quiz/translation_pairs_chinese.test.mjs`
- `quiz/translation_pairs_interlingua.test.mjs`
- `quiz/translation_pairs_hindi.test.mjs`
- `quiz/translation_pairs_templates.test.mjs`
- `quiz/translation_pairs_conditionals_templates.test.mjs`
- `quiz/translation_pairs_vector_remains_templates.test.mjs`
- `quiz/translation_parse_fallback.test.mjs`
- `quiz/translation_chinese_adapter.test.mjs`
- `quiz/translation_chinese_roundtrip.test.mjs`
- `quiz/translation_interlingua_adapter.test.mjs`
- `quiz/translation_interlingua_roundtrip.test.mjs`
- `quiz/translation_hindi_adapter.test.mjs`
- `quiz/translation_hindi_roundtrip.test.mjs`

## Examples

- `examples/pyash/translate-pyash-sentence-to-english.pya`
- `examples/pyash/translate-pyash-file-to-english.pya`
- `examples/pyash/translation-fallback-mixed.pya`
- `examples/pyash/translate-pyash-map-ceremony-to-chinese.pya`
- `examples/pyash/translate-pyash-map-ceremony-to-interlingua.pya`
- `examples/pyash/translate-pyash-map-ceremony-to-hindi.pya`

## Coverage and gaps

The adapters and pairs cover the core REPL-style sentences and current examples,
not the full language surface.

Covered: imperative examples (`write`, `read`, `plus`, `subtract`, `multiply`,
`divide`, `remains`); simple `text`, `number`, `bool`, `date`, and `vector`
assignments; basic map and ceremony markers; and parser fallback to pairs/templates.

Gaps: nested maps and ceremonies, rich multi-argument ceremony bodies, full
compositional case coverage, conditionals/comparatives, broader standard-library
verbs, and robust multiword name quoting.

English, French, Russian, Chinese, Interlingua, and Hindi each have adapters,
exact pairs, templates, and parser fallback for current examples. Chinese accepts
both `量` and `向量` for vector. Interlingua currently serves Spanish as an alias.
Spanish and Portuguese remain future adapter/pair/template work.

## Vocabulary normalization

Translation examples should prefer root dictionary words over conjugated English
variants. Automatic normalization is not yet a general stemming system; authoring
should use dictionary-root tokens until a mapping exists.

## Anchor word forms

Anchor forms keep one canonical Pyash word while accepting tagged surface forms:

```text
su name translation_anchor_words be map def
su name actively ob text "active" as wo noun ya
su name actively ob text "actively" as wo adverb ya
prah
```

The anchor is the canonical token, `ob text` is the surface form, and `as wo`
identifies its role. Implementations may normalize known forms to the anchor.

Anchor words are implemented in
`program/library/translation/anchor_words.mjs` and applied by
`normalizeAnchorSentence()` in `helpers.mjs`. They load from
`program/library/translation/anchor_words.pya`; normalization walks name
tokens (`su.name`, `ob.name`, `to.name`, and `from.name`) and is applied to
gloss → Pyash translation, not parser fallback.

`english_aliases.mjs` provides English gloss lookup aliases. To add a mapping, add
`su name <anchor> ob text "<surface form>" as wo <role> ya` to the anchor file.
The helpers `vocab_anchor_ing_suggest.mjs` and `anchor_words_add.mjs` support safe
suggestion and insertion workflows.
