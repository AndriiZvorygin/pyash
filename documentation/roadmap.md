### Updated roadmap (general-purpose, parity-driven, with **specification drops**, hardening points, **genetic programming**, and **early modules/namespacing**)

Assumption: you keep **interpreter + JS + C parity as the default rule**, but you allow **explicit feature gates** when a backend lags (tests declare the gate).

---

## Dec 13–Dec 21, 2025 (completed): Algorithms slice + parity discipline

**Ship**

* 100 Doors parity (done)
* Sieve parity (done)
* Insertion sort parity (done)

**Specification drops (freeze v0.1)**

* **Core Semantics v0.1** — done

  * evaluation order
  * memory merge rules (`ret`)
  * ceremony overwrite rule
  * signature resolution order and error surface (“unknown verb/signature”)

**Hardening**

* Golden tests: same input program, same output snapshot across interpreter, JS, and C
* Error sentence contract established (`be error do`)

---

## Dec 22, 2025 (completed): Specifications modularization v0.1

**Ship**

* Modular **Specifications** set (`00-index.md`, `01–06` core specifications)
* Guides: Getting Started, Debugging, Cookbook
* Indexes: Examples list, Glossary, Specifications-to-quizzes

**Hardening**

* Every normative rule links to existing quizzes and/or runnable examples

**Additional work completed Dec 22, 2025**

* JSON map import (`be import`) and JSON → Pyash compile path
* `write` defaults to Pyash def-chain for JSON maps; `to state json` prints JSON
* JS/C parity quizzes for JSON → Pyash compile
* Example: `examples/pyash/compile-json-to-pyash.pya`

---

## Dec 22, 2025–Feb 14, 2026 (current): Maps + frequency + CSV group-by (data slice)

**Ship**

* Map literal
* Map get/set
* Map iteration order (pick one and lock it)
* Word frequency (map + loop + text split)
* CSV parse + group-by + aggregate (count, sum)

**Specification drops (freeze v0.2)**

* **Map specification v0.1**

  * key types allowed (text, number)
  * equality rules
  * iteration order
  * missing-key behaviour

* **Text specification v0.1**

  * character definition (ASCII-first)
  * whitespace rules
  * split/join behaviour
  * case-conversion stance

**Hardening**

* Error sentence contract parity across interpreter, JS, and C
* Expanded golden corpus:

  * fizzbuzz
  * insertion sort
  * sieve-10
  * one vector example
* Stdlib boundary enforced in layout:

  * core verbs stay minimal
  * maps/text/csv live under library verbs with stable signatures
* Ceremony overwrite warnings enforced (strict mode optional)

---

## Feb 2026 (small milestone): Minimal agent loop v0.1

**Ship**

* Verifier loop: run quizzes, emit structured report artifacts
* Reducer loop: store minimal repro `.pya` programs
* Agents propose, tests decide (no autonomy promise)

**Hardening**

* Deterministic, diff-friendly reports

---

## Feb 2026 (small milestone): Genetic programming harness v0.1

**Ship**

* Genome format: Pyash sentence lists (and/or JSON sentence IR once available)
* Mutations: insert/delete/swap cases, tweak literals, tweak loop bounds
* Crossover: splice sentence ranges
* Fitness: pass/fail on selected quizzes, optional size/novelty penalties

**Specification drops (freeze v0.2-gp)**

* **Evolution artifacts specification v0.1**

  * genome serialization
  * mutation log format
  * fitness report format
  * reproducibility fields (seed, quiz set)

**Hardening**

* Fixed seeds and stable serialization
* Time/step limits per candidate
* Sandboxed IO: writes limited to an artifacts directory

---

## Feb 15–Mar 15, 2026: JSON parse + transform + path utilities (document slice)

**Ship**

* JSON parse to typed tree
* JSON stringify
* JSON transforms (map/filter/reduce; set/get by path)

**Specification drops (freeze v0.3)**

* **JSON IR specification v0.1**

  * node types (null, bool, number, text, array, object)
  * number mapping (double with constraints)
  * object keys (text only)

* **Path specification v0.1**

  * canonical addressing model
  * missing-path error rules

**Hardening**

* Determinism contract v0.1 (pure vs impure verbs)
* Span-tracked parser errors across all backends

---

## Mar 16–Apr 30, 2026: Pipeline skeleton + retries + checkpoints (systems slice)

**Ship**

* Pipeline runner (stages)
* Queue + worker pool
* Rate limiting, retries with backoff, checkpoints
* Structured logs (machine-readable)

**Specification drops (freeze v0.4)**

* **Error model specification v0.1**

  * error propagation rules
  * ceremony vs pipeline behaviour

* **IO model specification v0.1**

  * file read/write contracts
  * text encodings
  * sandpit IO boundaries

**Hardening**

* Reproducible runs (`--seed` where applicable)
* Stable log schema
* Backpressure rules (queue size, drop vs block)

---

## May–Jun 2026: Minimal modules/imports/namespacing (keeps core tiny)

**Ship**

* Module file as unit of execution/compilation
* `import` (single minimal form)
* Qualified names (`module.symbol` or equivalent)
* Stdlib split becomes real: core vs library paths enforce boundaries

**Specification drops (freeze v0.45)**

* **Modules & namespacing specification v0.1**

  * module identity rules
  * name resolution (local vs imported)
  * cycle rule (forbid or define)
  * visibility rule

**Hardening**

* Multi-file golden tests across interpreter, JS, and C
* Compatibility rule: core names stable; library may evolve behind gates

---

## Jul–Aug 2026: Scheduler and concurrency “truth serum”

**Ship**

* DAG scheduler
* Priorities
* Cancellation
* Timeouts
* Concurrency torture tests (readers–writers, dining philosophers)

**Specification drops (freeze v0.5)**

* **Concurrency specification v0.1**

  * isolation vs sharing
  * cancellation semantics
  * ordering guarantees

* **Runtime lifecycle specification v0.1**

  * startup/shutdown hooks
  * resource cleanup contracts

**Hardening**

* Deterministic simulation mode for concurrency tests (where possible)
* Stress harness with regression reporting per backend

---

## Sep 2026 onward: Packaging + tooling + “usable by other humans”

**Ship**

* Package layout conventions
* Versioned standard library
* Formatter + linter suitable for daily use
* Dependency and compatibility checks
* Genetic programming “production mode”:

  * evolves candidate patches against target quizzes/specifications
  * outputs PR-ready diffs plus proof artifacts

**Specification drops (v1.0 candidates)**

* **Package system specification v0.1**

  * package layout rules
  * version resolution rules
  * compatibility constraints

* **Stdlib stability policy**

  * stable vs experimental vs deprecated verbs

* **Evolution policy specification v0.1**

  * legal fitness targets
  * acceptance thresholds
  * provenance requirements (seeds, logs, reproductions)

**Hardening**

* Backward-compatibility tests for v1-stable signatures
* Deprecation warnings with codes
* Migration guides per breaking change

---

## Parity rule (refined)

* Every quiz is tagged:

  * `@core`: must pass on interpreter, JS, and C
  * `@js`: JS may lead temporarily
  * `@c`: C may lag temporarily
* Features promote to `@core` only when their **specification** is frozen

---

## Specification template (standard)

Each specification uses:

* Purpose
* Concepts and terms
* Syntax surface (minimal)
* Semantics (normative rules)
* Errors (names and conditions)
* Examples (existing files only)
* Tests that define truth
