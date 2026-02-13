# 03. Vyah And Aspect

Purpose: define lifecycle/aspect modifiers and their runtime meaning.

## 1. Scope

`vyah` carries runtime aspect and lifecycle facts for operations, streams, and scheduling surfaces.

## 2. Canonical aspect model

Aspects are attached as explicit values, for example:
- begin/start
- await/wait
- stream
- success/fail
- habit (recurrence)

Rules:
- use normalized aspect vocabulary in emitted output
- aliases may parse, but canonical emit should prefer normalized terms

## 3. Recurrence guidance

For recurring schedules, use `per` semantics with units (`second`, `minute`, `hour`, `day`).

`every` may exist as alias to `per`; emitted canonical form should use `per`.

## 4. Interaction with verbs

`vyah` facts must remain orthogonal to verb meaning:
- verb defines action class
- `vyah` defines lifecycle/aspect state

## 5. Determinism

Given same action + aspect inputs, runtime must produce same lifecycle output markers.

## 6. Conformance

Implementation conforms when it:
- parses canonical aspect words
- emits normalized aspect words
- preserves aspect facts in newspaper/artifacts where required

## 7. Full draft reference

Detailed inventory and transitional notes are preserved at:
`documentation/recipes/spec-archive/03-vyah-and-aspect.full.md`
