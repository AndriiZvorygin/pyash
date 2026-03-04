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
| `verify platform` | generator+verifier retry primitive | reusable stage verification with deterministic checks |
| `concatenate become wo filename` | deterministic path assembly | compact path building without repeated `be plus` chains |

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

## 10. Verify Platform Primitive (`verify platform`)

`verify platform` provides a canonical generator+verifier loop for text stages.

Canonical form:

```pyash
ob text <task> for name <generator> among name <verifier series> to name text <output> be verify platform do
```

Compatibility shorthand forms:

```pyash
ob text <task> for name <generator> among name <single verifier> to name text <output> be verify platform do
```

```pyash
ob text <task> for name <generator> among ve name <verifier a> <verifier b> ... to name text <output> be verify platform do
```

Optional controls:

```pyash
... atleast num <min score> atmost num <max score> fromindex num <min retry> toindex num <max retry> accordingto name <checks series> be verify platform do
```

### 10.1 Required roles

- `ob text`: task/request packet sent to the generator.
- `for name`: generator platform (mind/ceremony/refinery target that produces candidate text).
- `among name`: ordered verifier series selector.
- `to name text`: final accepted candidate output.

`among` is the canonical verifier selector for this primitive.

Verifier series contract:
- `among name <verifier series>` expects `<verifier series>` to resolve to a `series`.
- each entry must resolve to a verifier platform name.
- verifier order is the listed series order.

Compatibility behavior:
- `among name <single verifier>` (non-series) is treated as a one-item verifier series.
- `among ve name ...` is treated as an in-place ordered verifier series in listed order.

### 10.2 Retry semantics

- Retry window is inclusive.
- If `fromindex/toindex` are omitted, default retry window is `1..3`.
- On each attempt, runtime produces one candidate from the generator and evaluates it through all selected verifiers in order.
- Primitive returns immediately on pass.
- If retries exhaust without pass, runtime raises `be error do` with name `verify platform defective`.

### 10.3 Verifier aggregation

- pass only when all verifiers pass;
- fail when any verifier fails.
- Aggregation is deterministic and order-preserving for traces.

### 10.4 Score gate (`atleast`/`atmost`)

- `atleast` and `atmost` apply to verifier-loop score/acceptance behavior (same semantics as existing `verify loop` usage).
- If score gate fails, attempt is treated as failed and retry window proceeds.

### 10.5 Deterministic checks series (`accordingto`)

If present, `accordingto name <checks series>` applies deterministic post-verifier checks to the candidate before declaring pass.

Checks series contract:
- `<checks series>` must resolve to a `series`.
- checks are evaluated in listed order.
- each entry is a check sentence with one of these canonical forms:
  - `su name word_min ob num <n> ya`
  - `su name word_max ob num <n> ya`
  - `su name sentence_complete ob bool <truth|lie> ya`
  - `su name distinct_from ob text <line> ya`
  - `su name must_match_pattern ob text <regex> ya`
  - `su name must_not_match_pattern ob text <regex> ya`

If any deterministic check fails, attempt fails and retry proceeds.

### 10.6 Conformance

Conformance requires:
- deterministic retry count behavior,
- deterministic multi-verifier aggregation,
- identical pass/fail outcomes across interpreter/JS/C for equivalent inputs.

## 11. Filename Concatenate Primitive (`concatenate become wo filename`)

`concatenate become wo filename` constructs deterministic filesystem-like paths from segments without ad hoc text concatenation.

Canonical text output form:

```pyash
ob ve text "artifacts" "run-001" "sections" "paragraph-1" to name text path out be concatenate become wo filename do
```

Canonical filename output form:

```pyash
ob ve text "artifacts" "run-001" "video.mp4" to filename output be concatenate become wo filename do
```

### 11.1 Accepted segment values

Each segment must be one of:
- `text`
- `filename`
- `num` (stringified in base-10)

Otherwise runtime raises `be error do` with name `concatenate filename segment defective`.

### 11.2 Join normalization

- Separator is `/` (cross-platform deterministic form).
- Empty segments are ignored.
- Duplicate separators between segments are collapsed to one.
- If first non-empty segment is absolute (`/` prefix), output remains absolute.
- Leading `./` segments are omitted in canonical output.

### 11.3 Output binding

- `to name text ...` writes joined path as text.
- `to filename ...` writes joined path as filename-typed output.

### 11.4 Conformance

Conformance requires identical normalized output across interpreter/JS/C for equivalent segment vectors.
