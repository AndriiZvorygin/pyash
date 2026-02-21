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

For multi-artifact producers (example: `photographs`):
- producer should emit one manifest series artifact that lists produced child artifacts,
- newspaper hash verification MUST include this manifest artifact,
- downstream stages should depend on the manifest handle instead of filename conventions.

Default policy:
- newspaper recording is enabled by default (`exists su name newspaper enabled ob bool truth be default ya`),
- sentence-level APIs may remain typed/in-memory (for example `from name itinerary ...`),
- when newspaper mode is enabled, implementations should persist replayable artifacts in the background and record them as artifact/exchange events.

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

Programmatic sentence-native profile:
- a run surface marked with `vyah iterative` SHOULD enable equivalent strict recording/replay requirements.
- this is runner policy derived from aspect intent, not a separate ad-hoc JSON mode.

Example:
```pyash
su name run ob text "<program>" at filename "." vyah iterative be interpret do
```

## 6. Source mapping

Compiled JS/C paths should preserve source-map/line mapping for actionable diagnostics.

## 7. Conformance

Implementation conforms when it emits deterministic append-only run + artifact records and supports replay verification.

## 8. Full draft reference

`documentation/recipes/spec-archive/05-run-recording-and-artifacts.full.md`
