# Sentence Model

## 1. Purpose
Define the shape of a sentence and how cases/genitives/quoting are represented.

## 2. Terms
- sentence: a structured object with mood, verb, and cases.
- case: keyworded role like `su`, `ob`, `to`, `from`, `by`.
- genitive: a field chain such as `this ti ob ti num`.

## 3. Rules (normative)
- A sentence has `mood`, `be`, and any number of cases.
- Cases are keyworded fields (`su`, `ob`, `to`, `from`, `by`, `fromindex`, `toindex`, `atindex`).
- `su name <x>` identifies a subject name; `ob num <n>` / `ob text <t>` are typed payloads.
- Typed name references use `name <type> <literal>` (e.g., `to name num counter`, `to name text line`); the type must immediately follow `name` to allow multi-word literals.
- Genitives resolve a field chain on a sentence:
  - Possessive: `this ti ob ti num` maps to `this.ob.num`.
  - Genitive: `num of ob of this` maps to the same chain.
- Subordinate clauses embed a full sentence as a case value using `la … ko`:
  - Example: `ob la su name clause ob text "ok" be text ya ko`.
  - The embedded sentence is represented as `ob: { la: <sentence> }` in the internal model.
- Quoted blocks use `quoted.<lang>. … .<lang>.quoted` and are parsed as text.
- Newlines inside quoted blocks are preserved; escaped `\\n` sequences are unescaped before parsing.
- Internal sentence objects use `su` / `ob` keys; `subj` / `obj` are accepted at the surface but canonicalize to `su` / `ob` on parse.
- Keyword lists (moods, cases, type tokens, vyah modifiers) are defined in `program/library/grammar/keywords.mjs` and MUST be treated as the source of truth.
- Official ordering (for sentence formatting and signature words) follows the compositional case order (`07-compositional-cases.md`) and JSON official key ordering (`33-json.md`).

## 4. Error contracts
- If a sentence cannot be parsed, the parser raises an error (see `quiz/parser.test.mjs`).

## 5. Examples (existing files only)
- Run: `examples/pyash/compile-text-to-js-text.pya`
- Run: `examples/pyash/vector-write-index.pya`

## 6. Tests that define truth
- `quiz/parser.test.mjs`
- `quiz/compositional.test.mjs`
