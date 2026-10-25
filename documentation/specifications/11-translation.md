# `11-translation.md`

# Translation (draft v0.1)

**Status:** draft v0.1

## 1. Purpose

Define the translation pipeline for Pyash text ↔ natural language, including:
- the `translation` verb behavior,
- exact and template translation pairs,
- placeholder rules,
- fallback language detection during parsing.

This spec documents current behavior so future changes remain consistent and low-churn.

English source analysis is deterministic-first. Grammar surfaces, conservative morphology,
existing Pyash atoms/compounds, and sentence constructions are applied before semantic review.
The read-only WordNet evidence resource is configured in
`program/verbs/exchange/translation/english_wordnet.pya` and records the source path and hash.
It supplies part-of-speech, synset, gloss, and same-synset evidence for unresolved terms; it
does not create vocabulary. A term is auto-resolved only when the existing Pyash inventory and
sentence context leave one result. Multiple senses or missing inventory evidence remain
unresolved and can enter the existing bounded Housekeeper verifier, whose response is limited
to supplied candidate ids. For unresolved WordNet terms, a bounded local sentence window scores
exact overlap between neighboring words and sense glosses or lemmas before this agreement check;
a unique positive match narrows the sense set, while tied or unmapped senses remain reviewable.
The English `such as` surface is classified as an
`exemplifier` construction, a subtype of `exemplification`. It lowers to `fluh ga`: the
`example_` referential head with the space-way case, whose established surface glosses
are “at” and “via”; the fused form is `fluhga`. The lexical noun form remains `tlam`
when the source requires the root noun.

The English surface `example` now uses the generated `example_` grammar word `fluh`.
`fluh` is a `CCVh` long grammar form (`0x5367`), selected by the existing
`pyachso2n` weighted phonetic method after reserving both the checked-in vocabulary
and the historical `pyachso2n/pyashWords.txt` inventory. The lexical root
`example_WORD` remains `tlam` for explicit root and compound use; `tfum` is a
`CCVC` root shape and is therefore not used for this grammar entry.

For a lexical gap that needs a new atomic Pyac word, the read-only atom proposal
path in `atom_word_generation.mjs` reuses the historical
`pyachso2n/rootWordPhon.js` method. It combines multilingual phonetic evidence
with the source `NativeWeights`, ranks generated root candidates, and selects
the first free word from the 16, 19, 24, 28, and 32 glyph inventories. The
current Pyash vocabulary reserves both word spellings and encoded HNUCs before
selection. English30k rank is retained as concept evidence and batch order;
the phonetic profile supplies the candidate score. A proposal is evidence for
review and does not mutate `pyashWords.json`.

---

## 2. Translation verb (normative)

### 2.1 Source/target

`be translation do` operates on text input and emits translated text.

Common forms:
- Pyash → English:
  ```
  from text quoted.pyash.<pyash>.pyash.quoted from state pyash to state english to name output be translation do
  ```
- English → Pyash:
  ```
  from text quoted.pyash.<english>.pyash.quoted from state english to state pyash to name output be translation do
  ```
- Pyac → English Pyash:
  ```
  from text "mina nyahye hcaspuka pfinkiya" from state pyac to state pyash to name output be translation do
  ```

The Pyac reverse slice expands fused vocabulary and grammar into structural
Pyash evidence, then emits the readable English-Pyash surface:

```text
Pyac:          mina nyahye hcaspuka pfinkiya
structural:    su name mi na ob name nyah ye hcas pu ka be pfin ki ya
English Pyash: su I ob our houses be walked ya
English gloss: I walked our houses.
```

Translation now lowers the selected Pyac words to the VLIW phrase codelet
first. The same decoded codelet produces the fused Pyac surface, readable
English Pyash, and English gloss. The word number is calculated by the
lwonprom-compatible algorithm in `program/library/vliw/word_code.mjs`;
`pyashWords.json` supplies vocabulary membership and glosses. The phrase
head carries case/mood boundaries, and continuation vectors preserve longer
clauses. The reverse adapter remains bounded by the vocabulary and rejects an
input token that cannot be segmented into known roots and grammatical
endings. Its implementation is
`program/verbs/exchange/translation/pyac_to_english_pyash.mjs`.

The English projection reads phrase roles from the decoded VLIW head: the
nominative phrase supplies `su`, remaining case phrases supply `ob`, and
case endings become English prepositions (`te` → `in`, `so` → `from`, `ma` →
`to`, and `twih` → `into`); vocative `wu` becomes an `O` address prefix.
The complete case inventory comes from vocabulary entries ending in
`_case_`. Possessive, plural, negation, conjunction,
imperative, tense, aspect, passive, and mood markers are applied during this
projection. English Pyash keeps the `su`/`ob`/`be` sentence shape while using
English words inside those phrases. The Lord's Prayer clauses use this same
decoded renderer; their VLIW components carry `our father` explicitly.
Composed English-Pyash phrases remain token-visible, so a source like
`us from evil` renders as `ob us from evil`; quotes remain reserved for
literal text payloads.

The result is stored under `to name <output>` with:
```
su name <output> be <language> ob text "<translated>" ya
```

### 2.2 File translation (pattern)

When translating from a file, first read the file into a named value, then translate:
```
su name input from filename "<path>" be read do
from name input fromstate name pyash to state english to name output be translation do
```

See `examples/pyash/translate-pyash-file-to-english.pya`.

---

## 3. Exact translation pairs (normative)

Exact pairs provide direct Pyash ↔ natural language mappings.

Files:
- `program/verbs/exchange/translation/pairs_english.pya`
- `program/verbs/exchange/translation/pairs_russian.pya`
- `program/verbs/exchange/translation/pairs_french.pya`
- `program/verbs/exchange/translation/pairs_chinese.pya`
- `program/verbs/exchange/translation/pairs_interlingua.pya`
- `program/verbs/exchange/translation/pairs_hindi.pya`

Shape:
```
su name translation_pairs_<lang> be map def
su text "<pyash sentence>" ob text "<gloss>" ya
prah
```

Lookup order: exact pairs are checked before templates and formatters.

---

## 4. Template translation pairs (normative)

Templates allow variable inputs using placeholders that are **case-based** rather than positional.

Files:
- `program/verbs/exchange/translation/pairs_english_templates.pya`
- `program/verbs/exchange/translation/pairs_russian_templates.pya`
- `program/verbs/exchange/translation/pairs_french_templates.pya`
- `program/verbs/exchange/translation/pairs_chinese_templates.pya`
- `program/verbs/exchange/translation/pairs_interlingua_templates.pya`
- `program/verbs/exchange/translation/pairs_hindi_templates.pya`

Shape:
```
su name translation_pairs_<lang>_templates be map def
su text "<pyash template>" ob text "<gloss template>" ya
prah
```

### 4.1 Placeholder syntax

Placeholders are bracketed and use genitive form:
```
[<field> of <role>]
```

Examples:
- `[name of su]`
  → `su.name`
- `[num of ob]`
  → `ob.num`
- `[text of ob]`
  → `ob.text`
- `[gloss of consequence]`
  → uses the formatter on the nested `then` sentence
- `[pyash of consequence]`
  → uses the Pyash surface form of the nested `then` sentence

Allowed roles:
`su`, `ob`, `to`, `from`, `with`, `via`, `by`, `consequence`.

Allowed fields:
`name`, `num`, `text`, `bool`, `date`, `filename`, `wo`, `vec`, `pyash`, `gloss`.

### 4.2 Matching rules

Given a Pyash sentence:
1. Template placeholders are substituted with Pyash surface forms.
2. The resulting Pyash string must match the sentence exactly.
3. If it matches, the gloss template is rendered using the same placeholders.

Output substitution is language-aware for booleans:
- English: `true` / `false`
- Russian: `истина` / `ложь`
- French: `vrai` / `faux`
- Chinese: `真相` / `谎言`
- Interlingua: `veritate` / `false`
- Hindi: `सच` / `झूठ`

---

## 5. Parsing fallback (normative)

When `parse()` does not produce a valid Pyash mood, the parser attempts a **translation fallback**:
1. Try exact reverse pairs (gloss → Pyash).
2. Try reverse templates (gloss → Pyash).
3. If a Pyash match is found, re-parse it as Pyash and return that sentence.

This allows lines like:
```
collector is number 5.
ajoute 2 a collector.
прибавь 3 к collector.
```
to be interpreted as Pyash without explicit `be translation do`.

See `examples/pyash/translation-fallback-mixed.pya`.

## 5.1 English grammatical composition

English grammatical words that have a direct PyAC construction use the durable
catalog `program/verbs/exchange/translation/english_grammar.pya`. The catalog
keeps lexical heads separate from grammar markers:

- Person words use the short grammar particles: `i`/`me` -> `mi`, `we`/`us`
  -> `nyah`, and `you` -> `sa`.
- `our` is the grammar us particle `nyah` followed by the possessive marker
  `ye`, so a phrase such as “our father” lowers as `nyah ye <father>`.
- `your` and `my` use the same possessive construction with `sa` and `mi`, and
  standalone `yours` lowers as `sa ye`.
- Conjunctions use their grammar particles: `and` -> `wa`, `also` -> `pcah`,
  and `but` -> `pyuh`.
- The lexical roots `hwam`, `hnan`, and `hman` remain available for compound
  words, while `hwan`, `hyac`, and `hlan` remain available for lexical
  compounds. These roots are separate from the short grammar particles used
  in phrases.
- `plural` is the noun suffix `pu`; a composed plural phrase appends `pu` to
  the resolved head.
- `possessive` is the possessive marker `ye`, while `genitive` is the linking
  marker `ti`.

These entries come from the lwonprom noun-phrase and grammatical-case
construction. The catalog is evidence for composition; it does not replace the
canonical English lemma, alias, or compound indexes. When an explicit catalog
surface overlaps a lexical root, its grammar sequence is the deliberate
translation override; ordinary default grammar keywords retain the normal
atomic-first coverage order.

---

## 5.2 Pyash/Pyac phrase contract

This is the compact grammar contract for agents working on English-to-Pyac
translation. Keep this section beside the implementation when resuming work.

Terminology:

- **Pyash** is the English-oriented semantic form. Its compact shape uses
  English words with grammatical roles, for example `su me be happy ya`.
- **Pyac** is the VLIW-compatible word form. It uses the short encoded words,
  for example `mina nyahye hcaspuka pfinkiya`.
- The pipeline's `canonical` field keeps the English source/gloss. The
  parser-native structural `pyash` field remains replay evidence; it is an
  internal role serialization, not the displayed English canonical form.

Phrase rules:

1. A noun phrase ends with its case marker. Grammatical endings attach to the
   preceding phrase word. Plural `pu` comes before the phrase-final case:
   `hcas pu na` becomes `hcaspuna`, and `hcas pu ka` becomes `hcaspuka`.
2. A subject takes nominative `na`: `mi na` becomes `mina`.
3. A direct object takes accusative `ka`, unless the phrase is already marked
   by a compositional location or relation such as `into`, `to`, `at`, or
   `from`.
4. Explicit possession uses `ye`: `nyah ye` becomes `nyahye` for “our”.
   Ordinary genitive relations use `ti`: `hcas tlan ti` represents “house of
   God”, with `ti` closing the possessor phrase. Possessive `ye` and genitive
   `ti` express different source meanings.
5. A verb phrase puts lexical root, voice, aspect, and tense markers together:
   `pfin ki` is a past `walk` phrase. The sentence-final mood attaches to the
   final verb phrase: `pfin ki ya` becomes `pfinkiya`.
6. A verb phrase that must finish before a later phrase may close with the
   verb-affix `vi`: `pfin ki vi` becomes `pfinkivi`. The sentence mood still
   closes the complete sentence.
7. Ordinary sentence lowering keeps the verb phrase at the end. A direct
   object example is:

   ```text
   English: I walked our houses.
   Pyac:    mina nyahye hcaspuka pfinkiya
   ```

The reusable renderer is
`program/verbs/exchange/translation/pyash_surface.mjs`; its `renderPyac*`
exports name the Pyac projection, while the older `renderPyash*` names remain
compatibility aliases. The translation pipeline exposes `pyac` and retains
`pyashSurface` as an alias.

## 5.3 Reverse pairs and template matching (implementation notes)

Implementation lives in `program/verbs/exchange/translation/reverse_pairs.mjs`.

- Reverse pairs are built by inverting the exact pairs file (`pairs_<lang>.pya`) into
  a gloss → Pyash map.
- Reverse templates compile each template gloss into a regex by replacing placeholder
  slots with `(.+?)`, then substitute the captured values back into the Pyash template.
- Matching prefers the longest gloss template (greedy by template length) when multiple
  templates match the same input.
- Boolean glosses are normalized per language during reverse substitution:
  - English: `truth/lie` or `true/false`
  - Russian: `истина/ложь`
  - French: `vrai/faux`

Usage:
- `parse()` fallback uses reverse pairs/templates with no adapter involved.
- `be translation do` (gloss → Pyash) also uses reverse pairs/templates for most adapters
  (English/French/etc.), but some adapters parse directly instead (Russian/Chinese/Interlingua/Hindi).

---

## 6. Tests that define truth

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

---

## 7. Examples

- `examples/pyash/translate-pyash-sentence-to-english.pya`
- `examples/pyash/translate-pyash-file-to-english.pya`
- `examples/pyash/translation-fallback-mixed.pya`
- `examples/pyash/translate-pyash-map-ceremony-to-chinese.pya`
- `examples/pyash/translate-pyash-map-ceremony-to-interlingua.pya`
- `examples/pyash/translate-pyash-map-ceremony-to-hindi.pya`

---

## 8. Translation parity checklist

## 8a. Current coverage and gaps

The translation adapters and pairs are usable for core REPL-style sentences and the
example set, but they do not yet cover the full Pyash language surface. The items
below apply across all languages unless noted.

### Covered today
- Core imperative verbs in examples (write/read/plus/subtract/multiply/divide/remains).
- Simple declarative assignments for `text`, `number`, `bool`, `date`, `vector`.
- Basic map and ceremony open and close markers in the translation examples.
- Parser fallback to pairs/templates for Pyash glosses.

### Common gaps to close
- Nested maps and nested ceremonies.
- Rich ceremony bodies that use multiple arguments and outputs.
- Full compositional case coverage beyond the current templates.
- Conditional and comparative sentences beyond the current templates.
- Broader verb coverage for the standard library.
- More robust name handling and quoting for multiword identifiers.

### Language specific notes
- English, French, Russian, Chinese, Interlingua, Hindi: templates exist and roundtrip
  for the current example coverage only. Expand pairs and templates to match new
  verbs and data structures as they land.
- Chinese: vector uses the single character alias `量`, but `向量` is also accepted.
- Interlingua: Spanish is currently an alias to Interlingua forms.

### English
- [x] Adapter: `english.mjs` (to/from Pyash).
- [x] Exact pairs: `pairs_english.pya`.
- [x] Templates: `pairs_english_templates.pya`.
- [x] Parser fallback from gloss → Pyash.

### Russian
- [x] Adapter: `russian.mjs` (to/from Pyash).
- [x] Exact pairs: `pairs_russian.pya`.
- [x] Templates: `pairs_russian_templates.pya`.
- [x] Parser fallback from gloss → Pyash.

### French
- [x] Adapter: `french.mjs` (to/from Pyash).
- [x] Exact pairs: `pairs_french.pya`.
- [x] Templates: `pairs_french_templates.pya`.
- [x] Parser fallback from gloss → Pyash.

### Chinese
- [x] Adapter: `chinese.mjs` (to/from Pyash).
- [x] Exact pairs: `pairs_chinese.pya`.
- [x] Templates: `pairs_chinese_templates.pya`.
- [x] Parser fallback from gloss → Pyash.

### Interlingua
- [x] Adapter: `interlingua.mjs` (to/from Pyash).
- [x] Exact pairs: `pairs_interlingua.pya`.
- [x] Templates: `pairs_interlingua_templates.pya`.
- [x] Parser fallback from gloss → Pyash.

### Hindi
- [x] Adapter: `hindi.mjs` (to/from Pyash).
- [x] Exact pairs: `pairs_hindi.pya`.
- [x] Templates: `pairs_hindi_templates.pya`.
- [x] Parser fallback from gloss → Pyash.

### Upcoming languages
- [ ] Spanish (adapter + pairs + templates + fallback coverage).
- [ ] Portuguese (adapter + pairs + templates + fallback coverage).

---

## 9. Vocabulary normalization (pending)

Translation examples should prefer **root dictionary words** instead of conjugated English variants
(`actively` vs `active`, etc.). The tooling for automatic normalization and replacement is not yet
implemented; for now, prefer dictionary-root tokens when authoring examples and pairs.

---

## 10. Anchor word forms (draft)

Some vocabulary entries need explicit surface forms (noun/adverb/etc.) while keeping a single
**anchor word** for Pyash. This is expressed as a small Pyash map:

```
su name translation_anchor_words be map def
su name actively ob text "active" as wo noun ya
su name actively ob text "actively" as wo adverb ya
prah
```

Interpretation:
- `su name <anchor>` is the canonical Pyash word.
- `ob text "<form>"` is a surface form.
- `as wo <role>` tags the form (noun/adverb/etc.).

Implementations MAY normalize incoming text by mapping known forms back to the anchor word.

### 10.1 Implementation behavior

Anchor words are implemented in `program/verbs/exchange/translation/anchor_words.mjs`
and applied via `normalizeAnchorSentence()` in `program/verbs/exchange/translation/helpers.mjs`.

Rules:
- Anchor forms are loaded from `program/verbs/exchange/translation/anchor_words.pya`.
- The normalization walks a parsed sentence object and rewrites **name tokens** only
  (e.g., `su.name`, `ob.name`, `to.name`, `from.name`) by splitting on whitespace and
  mapping any known form back to its anchor.
- This is applied when translating **gloss → Pyash** inside `be translation do`.
  It is not applied in the core parser fallback (`parse()`).

English aliases:
- `program/verbs/exchange/translation/english_aliases.mjs` builds a lookup that maps
  anchor-word surface forms back to the anchor for English gloss matching.
- This is a lookup helper for translation pairs, not a language-wide stemming system.

### 10.2 Updating anchor words

To add a new anchor mapping:
1. Add a line to `program/verbs/exchange/translation/anchor_words.pya`:
   ```
   su name <anchor> ob text "<surface form>" as wo <role> ya
   ```
2. Keep `<anchor>` as the canonical Pyash token; use `ob text` for the surface form.
3. Use `as wo <role>` to tag the form (noun/verb/adverb/etc.).

Helper:
- `node command/vocab_anchor_ing_suggest.mjs` scans the vocabulary and prints
  safe `-ing` → anchor suggestions.
- `node command/anchor_words_add.mjs --anchor <name> --form <text> --role <role>`
  appends a new mapping to the anchor file.
