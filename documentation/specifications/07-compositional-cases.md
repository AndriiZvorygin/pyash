# `07-compositional-cases.md`

**Status:** v0.1

## 1. Purpose

Define the compositional case system used by Pyash for roles like `from`, `to`, `become`, `fromindex`, etc. This is core semantics for parsing, signature derivation, and sentence formatting.

## 2. Model

Every case is a combination of:

- **axis**: `source`, `way`, `destination`
- **context**: domain for the relation

The implementation exposes **single-token keywords** for each `(axis, context)` pair. These are the canonical case words used in sentences and signatures.

## 3. Canonical case keywords

```text
| context    | source      | way         | destination |
|------------|-------------|-------------|-------------|
| space      | from        | at          | to          |
| interior   | outof       | inside      | into        |
| surface    | offof       | along       | onto        |
| under      | fromunder   | under       | beneath     |
| time       | since       | during      | until       |
| state      | fromstate   | as          | become      |
| person     | fromperson  | with        | for         |
| social     | fromgroup   | among       | intogroup   |
| discourse  | fromtext    | accordingto | totext      |
| quantity   | times       | by          | per         |
| sequence   | fromindex   | atindex     | toindex     |
```

## 4. Normalization rules

- Canonical case keywords are the **single-token** forms in the table above.
- The parser **may accept split forms** and normalize them:
  - `from state` → `fromstate`
  - `to state` → `become`
  - `to text` → `totext`
- Signature derivation and formatting **use the canonical keywords**.

## 5. Sentence roles

- Cases attach to the sentence as their canonical keyword (e.g., `fromstate`, `become`, `fromindex`).
- The payload for a case is an object (e.g., `fromstate { name: "json" }`).
- The `ob` field is still the main payload slot; there is no per-context `ob` alias in v0.1.

## 6. Formatting and signature order

- Sentence formatting and signature derivation use the canonical case keywords above.
- Keyword order is derived from the compositional grid; new cases must be added there.
- Implementations MUST use the keyword lists from `program/library/grammar/keywords.mjs` (not hardcoded case lists).

## 7. Examples

```text
from state pyash to state json be compile do
fromindex num 1 toindex num 10 be process do
fromtext "prompt" totext output be read do
```

## 8. Source of truth

The canonical mapping is defined in:

- `program/library/compositionalCases.mjs`
- `program/library/grammar/keywords.mjs`
- `documentation/compositional-cases.md` (expanded background)
