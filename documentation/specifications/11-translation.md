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

## 1.1 Source-to-VLIW refinery

The end-to-end document path is declared in
`program/verbs/exchange/translation/translation_to_vliw_refinery.pya` under the
`translation source vliw` refinery. Its stages carry named map outputs through the
normal refinery runner:

1. source input and sentence segmentation,
2. source-language sentence translation,
3. WordNet/context refinement when English senses remain ambiguous,
4. vocabulary review and lazy compound refinement,
5. translation-catalog rendering,
6. Pyac/VLIW lowering,
7. catalog and pack writes.

`command/translate_document.mjs` invokes this refinery through
`program/verbs/exchange/translation/translation_to_vliw_refinery.mjs`. The
JavaScript adapter owns resource/index access, asynchronous Housekeeper work,
and VLIW file writing; the `.pya` file owns stage names, typed map contracts,
and dependency edges. The final artifacts remain the translation `.pya`
catalog, the VLIW catalog `.pya`, and the binary `.pyac` pack supplied by the
command's output paths.

The WordNet linker is a refinement stage inside this source-to-VLIW flow. It
selects only supplied inventory entries and retains unresolved senses when the
bounded queue has no complete decision. The translation catalog remains the
durable source record, while the VLIW catalog and pack contain only sentences
that lower successfully.

English source analysis is deterministic-first. Grammar surfaces, conservative morphology,
existing Pyash atoms/compounds, and sentence constructions are applied before semantic review.
The read-only WordNet evidence resource is configured in
`program/verbs/exchange/translation/english_wordnet.pya` and records the source path and hash.
The current resource is Open English WordNet 2025 JSON under
`know/wordnet/open-english-wordnet-2025-json/`; the dataset is a local knowledge input,
kept outside version control, with its upstream archive URL and license recorded in the
Pyash configuration.
It supplies part-of-speech, synset, gloss, and same-synset evidence for unresolved terms; it
does not create vocabulary. A term is auto-resolved only when the existing Pyash inventory and
sentence context leave one result. Multiple senses or missing inventory evidence remain
unresolved and can enter the existing bounded Housekeeper verifier, whose response is limited
to supplied candidate ids. For unresolved WordNet terms, a bounded local sentence window scores
exact overlap between neighboring words and sense glosses or lemmas before this agreement check;
a unique positive match narrows the sense set, while tied or unmapped senses remain reviewable.
The index also accepts optional relation rows in the form `r [source] [target] [relation]`;
when present, bounded graph relatedness contributes to the context score. The checked-in slice
currently remains gloss-based, so relation data is additive evidence rather than a hidden
runtime download.
Sense-specific lexical bridges are recorded in the native Pyash map
`program/verbs/exchange/translation/english_wordnet_bridges.pya`. One row represents one
WordNet sense: `su` is the POS-prefixed sense key, `ob` is an existing English target anchor,
`as` is the target part of speech, `with` is certainty, and `via` is provenance. The bridge
provides a bounded candidate after the normal sentence sense selection; it does not add a
second vocabulary or transcript format.
The bounded linker workflow is configured in
`program/verbs/exchange/translation/english_wordnet_linker.pya`. Its JavaScript adapter emits
one stable record per WordNet sense, builds a bounded inventory from existing Pyash coverage,
and sends only unresolved senses through the existing durable `mind`/`gpu` future queue. The
worker may choose only an inventory-backed target; accepted evidence renders into the bridge
map. The configured batch bound is 200 senses, and the linker never edits the vocabulary
directly.
A deterministic seed pass also accepts low-degree edge synsets when a lemma has exactly one
WordNet sense and the inventory supplies an atom or accepted compound. This grows evidence
from graph leaves inward; central or multi-sense nodes remain contextual review cases.
Accepted compound records are supplied as an explicit inventory input; candidate or rejected
compound decompositions remain outside the linker's target set.
The current catalog covers all 17 Open English WordNet `feel` senses. Context examples select
`emotionally` for an emotional state, `experience` for a conscious or passive state,
`finger` for touch examination, `touch` for physical sensation or palpation, `searching` for
groping, `appear` for an impression or perceived quality, and `air` for a place's atmosphere.
A tied context remains a review candidate rather than receiving an arbitrary lexical choice.
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
English Pyash: ya su I be walked ob our houses.
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

The VLIW head maps the nominative phrase to `su` and an accusative `ka` phrase
to `ob`. Other cases retain their prepositions (`pwah` → `for`, `te` → `in`,
`so` → `from`, `ma` → `to`, `twih` → `into`); vocative `wu` becomes `O`.
`ob` must precede object content, never another preposition such as `for`.
The complete case inventory comes from vocabulary entries ending in
`_case_`. Possessive, plural, negation, conjunction,
imperative, tense, aspect, passive, and mood markers are applied during this
projection. English Pyash keeps the `su`/`ob`/`be` sentence shape while using
English words inside those phrases. The Lord's Prayer clauses use this same
decoded renderer; their VLIW components carry `our father` explicitly.
Composed English-Pyash keeps direct objects such as `ob us from evil` and
renders pure relations such as `to us` or `for someone` without outer `ob`.
Quotes remain reserved for literal text payloads.

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
construction. The catalog supplies composition evidence while canonical lemma,
alias, and compound indexes remain authoritative.

---

## 5.2 Pyash/Pyac phrase contract

This is the compact grammar contract for agents working on English-to-Pyac
translation. Keep this section beside the implementation when resuming work.

Terminology:

- **Pyash** is the English-oriented semantic form. Its compact shape uses
  English words with grammatical roles, for example `su me be happy ya`.
- **Pyac** is the VLIW-compatible word form. It uses the short encoded words,
  for example `mina nyahye hcaspuka pfinkiya`.
- The pipeline's `canonical` field keeps the English source/gloss. Resolved
  records expose `pyash` as the English-word Pyash projection, `pyac` as the
  fused VLIW-compatible projection, and `structural` as the internal role
  serialization used to preserve the encoded lexical sentence for replay.

Phrase rules:

1. Names and variables use `gi` immediately before their final case marker;
   lexical phrases and standalone pronouns keep only their case: `mi na`
   becomes `mina`, while `hcas pu ka` becomes `hcaspuka`.
2. A subject takes nominative `na`; a direct object takes accusative `ka`, unless the phrase is already marked
   by a compositional location or relation such as `into`, `to`, `at`, or
   `from`.
3. Explicit possession uses `ye`: `nyah ye` becomes `nyahye` for “our”.
   Ordinary genitive relations use `ti`: `hcas tlan ti` represents “house of
   God”, with `ti` closing the possessor phrase. Possessive `ye` and genitive
   `ti` express different source meanings.
4. A verb phrase puts lexical root, voice, aspect, and tense markers together:
   `pfin ki` is a past `walk` phrase. The sentence-final mood attaches to the
   final verb phrase: `pfin ki ya` becomes `pfinkiya`.
5. A verb phrase that must finish before a later phrase may close with the
   verb-affix `vi`: `pfin ki vi` becomes `pfinkivi`. The sentence mood still
   closes the complete sentence.
The reusable renderer is
`program/verbs/exchange/translation/pyash_surface.mjs`; its `renderPyac*`
exports name the Pyac projection, while the older `renderPyash*` names remain
compatibility aliases. Resolved records expose `pyash` and `englishPyash` as
the English-word projection decoded from VLIW in the `su`/`ob`/`be` shape.

## 5.3 References

Reverse pairs, tests, coverage, normalization, and anchors are documented in
`documentation/reference/translation-parity-notes.md`.
