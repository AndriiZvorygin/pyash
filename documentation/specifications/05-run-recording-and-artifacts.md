# 05. Run Recording And Artifacts

Purpose: define run newspaper events, ordering, and artifact exchange contracts.

## 1. Run newspaper baseline

A run record is append-only and sentence-shaped.

Minimum event kinds:
- run start
- evoke/step
- result/state
- tool call/produce
- artifact record
- run end

## 2. Ordering rules

- events must be ordered by append order within a run
- deterministic runs must emit stable sequence for identical input and environment profile
- replay/again mode relies on this ordering

## 3. Artifact contract

Artifacts must record:
- locator/path
- hash/check metadata (when available)
- relation to producing action

Artifact naming should be deterministic and collision-safe.

## 4. Exchange events

Exchange events must be sentence-shaped and replayable.

## 5. Again/replay requirements

Replay mode must validate deterministic subset:
- inputs
- selected outputs
- event ordering

## 6. Source mapping (compiled targets)

Compiled JS/C flows should preserve source mapping/line mapping sufficient for error tracing.

## 7. Conformance

Implementation conforms when it emits append-only deterministic run/event/artifact records and supports replay checks.

## 8. Full draft reference

Detailed schemas and golden examples are preserved at:
`documentation/recipes/spec-archive/05-run-recording-and-artifacts.full.md`
