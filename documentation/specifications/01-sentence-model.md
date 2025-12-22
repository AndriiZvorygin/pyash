# Sentence Model

## 1. Purpose
Define the shape of a sentence and how cases/genitives/quoting are represented.

## 2. Terms
- sentence: a structured object with mood, verb, and cases.
- case: keyworded role like `subj`, `obj`, `to`, `from`, `by`.
- genitive: a field chain such as `this ti obj ti num`.

## 3. Rules (normative)
- A sentence has `mood`, `be`, and any number of cases.
- Cases are keyworded fields (`subj`, `obj`, `to`, `from`, `by`, `fromindex`, `toindex`, `atindex`).
- `subj name <x>` identifies a subject name; `obj num <n>` / `obj text <t>` are typed payloads.
- Genitives resolve a field chain on a sentence:
  - Possessive: `this ti obj ti num` maps to `this.obj.num`.
  - Genitive: `num of obj of this` maps to the same chain.
- Quoted blocks use `quoted.<lang>. … .<lang>.quoted` and are parsed as text.

## 4. Error contracts
- If a sentence cannot be parsed, the parser raises an error (see `quiz/parser.test.mjs`).

## 5. Examples (existing files only)
- Run: `examples/pyash/compile-text-to-js-text.pya`
- Run: `examples/pyash/vector-write-index.pya`

## 6. Tests that define truth
- `quiz/parser.test.mjs`
- `quiz/compositional.test.mjs`
