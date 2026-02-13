# 01. Sentence And Grammar

Purpose: define canonical sentence shape, case ordering, and parse invariants.

## 1. Canonical sentence skeleton

Core form:

```pyash
su name <subject> <cases...> be <verb> <mood>
```

Moods:
- `do` execution
- `ya` fact/value
- `def ... prah` block
- `ko` clause block

## 2. Required parser invariants

- parsing is deterministic for identical bytes
- quoted text remains opaque payload
- case words are explicit; no positional inference by runtime
- unknown/invalid forms surface typed `be error` sentences

## 3. Case ordering

Normative ordering is the canonical emission order used for pretty output and stable hashing.

Rules:
- preserve semantic roles (`su`, `ob`, `from*`, `to*`, `for`, `as`, `become`, `during`, `since`, `vyah`, etc.)
- emit using canonical case order when serializing
- accept flexible input order where parser supports it, then normalize on output

## 4. Clause and composition

`ob la ... ko` and related clause payloads are legal values.

Compositional case keywords (for example `fromtext`, `fromstate`, `totext`) are first-class forms, not ad-hoc strings.

## 5. Defaults and matching

Default sentences may target a clause pattern and contribute missing cases.

Matching must be deterministic:
- evaluate same clause matcher
- fill only missing compatible slots
- never overwrite explicitly provided call values

## 6. Error surface

Grammar/syntax defects must surface stable sentence-shaped errors.

Minimum defect classes:
- unknown keyword/case
- invalid mood placement
- malformed quote/clause
- invalid block boundaries

## 7. Conformance

Implementation conforms when it can:
- parse + emit canonical form deterministically
- preserve quoted payloads
- normalize case ordering on output
- surface sentence-shaped errors for invalid forms

## 8. Full draft reference

The full detailed draft is preserved at:
`documentation/recipes/spec-archive/01-sentence-and-grammar.full.md`
