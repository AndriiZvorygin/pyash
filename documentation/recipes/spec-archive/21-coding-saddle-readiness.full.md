# `21-coding-saddle-readiness.md`

Status: draft v0.1

Purpose: define a local-tool-first coding harness profile for mind calls.

---

## 1. Coding saddle profile

The coding profile is represented as a named saddle subject:

`su name software be saddle def`

The profile SHOULD reference:

- a model (`gpt-oss:latest` by default for live evals)
- a tool map (`saddle tools`)
- a system prompt that describes tool usage constraints

The canonical local coding tool map is `module/saddle_tools.pya`.

Invoke surface for coding saddle runs MUST use existing evoke grammar:

- `ob text "<input>" for name <target> to name text <output> be evoke do`
- `ob text "<input>" for name <target> with name <tools map> to name text <output> be evoke do`
- `under name <conduct>` MAY be attached when run-scoped conduct is needed.

Coding saddle runs are for mind/refinery targets, not plain builtin execution.

---

## 2. Local tool baseline

`saddle tools` MUST include:

- `command` (for shell execution + verification)
- `repair` (for deterministic unified-diff edits)

Recommended additions:

- `read`
- `write`
- `list files`
- `repair check`

---

## 3. Live coding check

A live check SHOULD run against `gpt-oss:latest` with:

- `with name saddle tools`
- task: write a basic program file and verify by executing it
- one retry allowed if first attempt fails

Reference files:

- example: `examples/pyash/saddle-gpt-oss-live.pya`
- optional live quiz: `quiz/saddle_live_gpt_oss.test.mjs`
- gate runner: `command/run_coding_saddle_gate.mjs`

---

## 4. Deterministic harness checks

A deterministic (fixture-driven) coding check MUST verify:

1. tool schema exposes `command` and `repair` signatures,
2. mind tool flow can execute `command` then `repair` in a single run,
3. resulting file content matches expected source.

Reference quizzes:

- `quiz/saddle_tools_signatures.test.mjs`
- `quiz/saddle_tool_flow.test.mjs`

---

## 5. Guarantee-first coding loop

For coding tasks, the preferred reliability pattern is:

1. generator writes a candidate,
2. deterministic `guarantee` gate validates it,
3. optional verifier runs only after guarantee passes.

`verify loop` supports this directly.

### 5.1 Configure deterministic guarantees

Use `verify loop configure` map keys:

- `guarantee command` — shell command template. `{{draft}}` and `{{task}}` are available placeholders.
- `guarantee expect regex` — optional regex that must match guarantee command stdout.
- `guarantee draft regex` — optional regex that must match draft text directly.

Backward-compatibility aliases:

- `verifier command` -> `guarantee command`
- `verifier expect regex` -> `guarantee expect regex`

### 5.2 Stop conditions and compact state

`verify loop` records deterministic control facts:

- `verify loop attempts used`
- `verify loop stop reason` (`pass`, `max attempts`, `unchanged draft`)
- `verify loop seed task`
- `verify loop last failure`
- `verify loop last success`
- `verify loop summary`

### 5.3 Canonical example

Reference:

- `examples/pyash/coding-loop-guarantee.pya`

This example runs a coding loop with `saddle tools` and a guarantee command gate, without a verifier mind.

## 6. Error and success surfaces

Errors MUST use standard error sentence forms already used by runtime:

- surfaced: `... be error ya`
- thrown/internal: `... be error do`
- stable names MAY include `<verb> defective`

Success marker for lifecycle/aspect outcomes is `vyah ... success`.
Legacy `sloh` MAY be accepted during transition, but emitted spec examples SHOULD use `success`.
