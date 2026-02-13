# 04. Runtime Primitives

Purpose: define low-level runtime primitives and IR contracts used by interpreter and compiler paths.

## 1. Primitive set

Normative primitives:
- `duty` (unit of work/lifecycle)
- `stream` (incremental output/input)
- `chip` (chunk unit for stream/data processing)

## 2. Global invariants

- deterministic lifecycle transitions
- explicit ownership boundaries
- sentence-shaped status/event reporting
- compatibility between interpreter and compiled targets

## 3. IR boundary

Runtime exposes value/sentence IR sufficient to:
- represent parsed sentences
- dispatch signatures
- preserve case/value types

Lowering to compiled backends must preserve semantic equivalence.

## 4. Lifecycle outcomes

Primitives must support begin, in-progress/stream, success/fail terminal outcomes.

## 5. Logging and traceability

Primitive lifecycle transitions should be observable through run records/newspaper where enabled.

## 6. Conformance

Conforms when runtime primitives behave equivalently across interpreter and compiler targets for same input.

## 7. Full draft reference

Detailed primitive/IR sections are preserved at:
`documentation/recipes/spec-archive/04-runtime-primitives.full.md`
