# `34-translation.md`

**Status:** draft v0.1

## 1. Purpose

Define the translation pipeline for Pyash text ↔ natural language, including:
- the `translation` verb behavior,
- exact and template translation pairs,
- placeholder rules,
- fallback language detection during parsing.

This spec documents current behavior so future changes remain consistent and low-churn.

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

---

## 6. Tests that define truth

- `quiz/translation.test.mjs`
- `quiz/translation_pairs_english.test.mjs`
- `quiz/translation_pairs_russian.test.mjs`
- `quiz/translation_pairs_french.test.mjs`
- `quiz/translation_pairs_templates.test.mjs`
- `quiz/translation_pairs_conditionals_templates.test.mjs`
- `quiz/translation_pairs_vector_remains_templates.test.mjs`
- `quiz/translation_parse_fallback.test.mjs`

---

## 7. Examples

- `examples/pyash/translate-pyash-sentence-to-english.pya`
- `examples/pyash/translate-pyash-file-to-english.pya`
- `examples/pyash/translation-fallback-mixed.pya`

---

## 8. Translation parity checklist

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

### Upcoming languages
- [ ] Chinese (adapter + pairs + templates + fallback coverage).
- [ ] Spanish (adapter + pairs + templates + fallback coverage).
- [ ] Portuguese (adapter + pairs + templates + fallback coverage).
