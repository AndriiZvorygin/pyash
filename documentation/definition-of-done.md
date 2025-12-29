## Weekly Definition of Done checklist (use this every tranche)

### 1) Ship

* [ ] New features live behind the correct parity tag (`@core`, `@js`, `@c`) with an explicit gate reason if non-core
* [ ] Feature surface documented: signatures, inputs, outputs, error sentences
* [ ] Module-aware placement decided (stdlib namespace or project module), with import examples

### 2) Spec drop

* [ ] Spec section added or updated with a version bump (example: v0.35)
* [ ] Official surface forms stated (exact spellings, roles, ordering rules)
* [ ] Edge cases covered: empty inputs, malformed inputs, boundary sizes
* [ ] Error contract defined

  * stable error sentence shape
  * stable fields and ordering
  * stable wording rules where relevant

### 3) Determinism

* [ ] Outputs are byte-stable under fixed inputs
* [ ] Any nondeterminism has a deterministic test mode

  * fixed seeds
  * pinned fixtures
  * pinned model id and params (for mind or speech)
* [ ] No hidden timestamps in artefacts or logs unless explicitly specified

### 4) Journal + artefacts

* [ ] Run journal emitted for all runs affected by the tranche
* [ ] Every external interaction is journaled (file IO, subprocess, mind calls)
* [ ] Artefact paths are stable and spec-compliant
* [ ] Content hashes stored for large outputs
* [ ] Replay can re-run and verify hashes for golden cases

### 5) Golden coverage

* [ ] At least 1 golden demo program added for the tranche
* [ ] Snapshot tests for the demo(s) across backends required by tags
* [ ] Cross-backend parity confirmed for:

  * normal output (`write`)
  * error outputs
  * JSON map official ordering where relevant

### 6) Backends and gates

* [ ] Interpreter passes all new quizzes
* [ ] JS passes all gated quizzes and compile parity where applicable
* [ ] C passes all gated quizzes and compile parity where applicable
* [ ] If any backend lags:

  * [ ] gate is explicit in quizzes
  * [ ] issue list created with minimal repro
  * [ ] spec remains unchanged unless formally bumped

### 7) Tooling and ergonomics

* [ ] One command to run the tranche demos end-to-end
* [ ] One command to run the tranche test suite
* [ ] Error messages include enough context to debug (signature, module, stage id)

### 8) Regression safety

* [ ] Golden corpus updated with new snapshots
* [ ] Old snapshots still pass unless intentionally changed with a recorded rationale
* [ ] Any changed snapshot includes a “why it changed” note in the commit message

### 9) Promotion criteria

* [ ] New surface stays outside `@core` until:

  * spec is frozen
  * golden demo exists
  * parity exists for required backends
  * error parity is achieved
* [ ] Once promoted, the feature is treated as stable and protected by snapshots

### 10) Exit criteria (final sanity)

* [ ] Fresh checkout smoke run passes (no local state required)
* [ ] Replay of at least one run succeeds and verifies hashes
* [ ] Docs, specs, quizzes, and demos all agree on the behaviour

This gives you a single metronome for shipping: every week ends with a spec you can point at, a demo you can run, a journal you can replay, and parity you can trust.

