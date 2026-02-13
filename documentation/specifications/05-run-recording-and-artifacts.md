# 05. Run Recording And Artifacts

Purpose: define append-only run newspaper, event ordering, artifact records, and replay checks.

## 1. Event keyword map

| Event type | Meaning |
| --- | --- |
| run start | run boundary start marker |
| evoke/step | action invocation record |
| result/state | surfaced sentence outcome |
| tool | tool call + produce record |
| artifact | file/hash/provenance record |
| run end | run boundary end marker |

## 2. Ordering rules

- events are append-ordered within run,
- identical input/profile must produce stable event sequence,
- replay/again verification depends on this deterministic order.

## 3. Artifact contract

Each artifact record should include:
- path/locator,
- relation to producer action,
- hash metadata when available.

## 4. Canonical application examples

Enable run recording and execute:
```text
node command/run_pya_program.mjs --newspaper examples/pyash/refinery-basic.pya
```

Replay verification flow:
```text
node command/replay_newspaper.mjs <run-id>
```

## 5. Again/replay meaning

Again mode means: require sufficient recording/verifiability so run outputs can be checked/replayed deterministically.

## 6. Source mapping

Compiled JS/C paths should preserve source-map/line mapping for actionable diagnostics.

## 7. Conformance

Implementation conforms when it emits deterministic append-only run + artifact records and supports replay verification.

## 8. Full draft reference

`documentation/recipes/spec-archive/05-run-recording-and-artifacts.full.md`
