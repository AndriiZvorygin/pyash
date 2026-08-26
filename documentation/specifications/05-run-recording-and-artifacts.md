# 05. Run Recording And Artifacts

Purpose: define append-only run newspaper, event ordering, artifact records, and replay checks.

## 1. Event keyword map

| Event type | Meaning |
| --- | --- |
| run start | run boundary start marker |
| identity protocol | `command result identity protocol` version marker for strict command graph replay |
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

### 3.1 Command identity graph (normative)

For each synchronous command invocation, the newspaper may contain the
following linked graph. The canonical request name is
`command request <six-digit ordinal>` and is allocated once at runtime.
An identity-bearing newspaper MUST record the exact capability marker before
its command identity graph:
`exists su name command result identity protocol ob text "v1" be text ya`.

| Record | Required link |
| --- | --- |
| command request/evoke | `su name <request>` and `ob la <original command sentence>` |
| command result | `su name <request> ... be command ya` |
| command audit | `to name <request>`; audit subjects are `command audit <ordinal>` |
| approval request/decision | `to name <request>`; a truthful approval must be followed by the resumed result, while a denied approval is terminal |
| declared artifact | `ob name <request>` and its declared `to filename` locator; the first declaration also names the request as its producer when available |
| artifact exchange | `ob name <request>`, with `as name read|write|...` |
| compiled tool event | its `to la` result resolves to the same canonical command result |

The request evoke record precedes policy audits. A declared `to filename`
output is written first and then recorded as an artifact and exchange
operation. If a later command reuses an artifact locator, content addressing,
aliasing, and hash-consistency rules remain unchanged: no duplicate artifact
declaration is required, but that command's exchange operation still carries
its own request identity.

Replay validates the graph in addition to artifact hashes: every canonical
command result resolves to exactly one known command request; every
identity-bearing artifact, exchange, audit, and approval link resolves to a
known request; and one request identity cannot carry conflicting request or
result payloads. Strict graph completeness is active only after the exact
identity protocol marker. Without that marker, pre-identity audit-only
newspapers remain replayable. A successful request must have its canonical result. A denied
request or failed request may terminate at its explicit deny/error audit (and
a denied approval is terminal); an approval request, request-only record, or
truthful approval without its resumed result is incomplete. A newspaper with
no command identity records is a legacy newspaper and remains replayable.
Once the new identity contract is present, malformed, orphaned, partially
linked, split-resume, or internally inconsistent identity records are defective
and replay emits a sentence-shaped identity error.

For multi-artifact producers (example: `photographs`):
- producer should emit one manifest series artifact that lists produced child artifacts,
- newspaper hash verification MUST include this manifest artifact,
- downstream stages should depend on the manifest handle instead of filename conventions.

Session compaction snapshots follow the same rule. The snapshot is a canonical
Pyash series containing the immutable duty and latest explicitly accepted
generator/verifier evidence. It is recorded with an immutable content hash and a
per-turn/hash locator. The run newspaper records a `be checkpoint ya` linkage
with the turn id, snapshot hash, and artifact filename. Replay verifies the
content-addressed bytes; changing them is a `hash inconsistency`.

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
