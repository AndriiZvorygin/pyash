# 04. Runtime Primitives

Purpose: define low-level runtime primitives and IR contracts used by interpreter and compiler targets.

## 1. Primitive keyword table

| Primitive | Meaning | Application |
| --- | --- | --- |
| `duty` | task/work handle | long-running lifecycle state |
| `stream` | ordered incremental output | chunked/ongoing transfer |
| `chip` | one stream chunk | deterministic stream consumption unit |
| `evoke` (clause mode) | execute embedded sentence template | reusable clause-driven calls with deterministic override |
| `instead` (map mode) | deterministic literal replacement | map-driven packet/text assembly |

## 2. Lifecycle concepts

| Lifecycle concept | Typical marker |
| --- | --- |
| begin/start | `vyah start` |
| ongoing stream | `vyah stream` |
| await completion | `vyah await` |
| clean complete | `vyah finish success` |
| canceled | `vyah cancel success` |
| failed | `vyah fail` |

## 3. IR boundary

Runtime IR must preserve:
- sentence structure,
- typed case values,
- signature derivation inputs,
- deterministic lowering parity between interpreter and compiled outputs.

## 4. Canonical usage examples

Duty fact:
```pyash
su name task_1 as name running be duty ya
```

Stream fact:
```pyash
su name transcript as name open ob ve text hello world be stream ya
```

Read one chunk:
```pyash
su name transcript vyah eval be chip do
```

## 5. Logging and traceability

Primitive transitions should be observable in run newspaper/event records when enabled.

## 6. Clause invocation primitive (`evoke` clause mode)

`evoke` in clause mode executes an embedded sentence template exactly once.

Canonical forms:

```pyash
ob la <call sentence> ko to name text output be evoke do
```

```pyash
to name text output be evoke do
```

Rules (normative):
- Clause source priority:
  - first: `ob la ... ko` on the `evoke` sentence.
  - fallback: current evoker `from la ... ko` (when called inside a ceremony/module).
- Runtime MUST deep-clone the source clause before execution.
- If clause-mode `evoke` includes `to ...`, that `to` MUST override any `to` present in the embedded clause.
- The cloned (and possibly overridden) clause is then executed via normal dispatch.
- The overridden `to` target (if present) is the authoritative output binding for downstream reads.

Mode selection:
- If `for name ...` is present, `evoke` uses target mode (existing mind/refinery/ceremony dispatch behavior).
- If `for` is absent and a clause source is available, `evoke` uses clause mode.

Error contract:
- Missing or malformed clause source in clause mode MUST raise `be error do` with name `evoke clause defective`.

## 7. Conformance

Implementation conforms when primitive behavior is semantically equivalent across interpreter/JS/C targets for identical input.

For clause-mode `evoke`, conformance additionally requires:
- deterministic clause source resolution,
- deterministic `to` override precedence,
- equivalent behavior across interpreter/JS/C.

## 8. Full draft reference

`documentation/recipes/spec-archive/04-runtime-primitives.full.md`

## 9. Map replacement primitive reference (`instead`)

`instead` map-mode behavior is tracked in the reference profile:
- `documentation/reference/instead-replacement.md`

Conformance target:
- deterministic map-order literal replacement,
- no hidden placeholder language requirement,
- parity across interpreter/JS/C for equivalent inputs.
