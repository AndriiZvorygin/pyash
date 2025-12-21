### Updated roadmap (general-purpose, parity-driven, with “spec drops” and hardening points)

Assumption: you keep **interpreter + JS + C parity as the default rule**, but you allow **explicit feature gates** when a backend lags (tests declare the gate).

---

## Dec 13–Jan 10 (you are here): Algorithms slice + parity discipline

**Ship**

* 100 Doors parity (done, as you said)
* Sieve parity (done)
* Insertion sort parity (done)

**Spec drops (freeze v0.1)**

* **Core Semantics v0.1** (1–2 pages):

  * evaluation order
  * memory merge rules (`ret`)
  * ceremony overwrite rule (and whether it is kept or replaced)
  * signature resolution order and error surface (“unknown signature” contract)

**Hardening**

* **Golden tests**: same input program, same output snapshot across all 3 backends.
* **Error format**: standardize one machine-readable error shape (code + span + message).

---

## Jan 11–Feb 14: Maps + frequency + CSV group-by (data slice begins)

**Ship**

* Map literal, map get/set, map iteration order (pick one and lock it)
* Word frequency (map + loop + text split)
* CSV parse + group-by + aggregate (count, sum)

**Spec drops (freeze v0.2)**

* **Map spec v0.1**

  * key types allowed (start with text + number)
  * equality rules (numbers, text)
  * iteration order rule
  * missing key behaviour (null-ish value vs error)

* **Text spec v0.1 (deliberately small)**

  * what a “character” means for now (ASCII-first acceptable)
  * whitespace definition
  * split/join behaviour
  * case conversion stance (if any)

**Hardening**

* Introduce **“strict mode”** for ceremonies:

  * warn or fail on overwrite unless explicitly marked (example: `replace ya`)
* Add **stdlib boundary**:

  * core verbs stay tiny
  * maps/text/csv land in `program/verbs/library/*` with stable signatures

---

## Feb 15–Mar 15: JSON parse + transform + path utilities (document slice)

**Ship**

* JSON parse to a typed tree
* JSON stringify
* JSON transform primitives (map, filter, reduce over arrays; set/get by path)

**Spec drops (freeze v0.3)**

* **JSON IR spec v0.1**

  * exact node types (null, bool, number, text, array, object)
  * number mapping (double? decimal? for now: double with constraints)
  * object key rules (text only)

* **Path spec v0.1**

  * canonical way to address nested values (dot + bracket, or verb-based “by key / by index”)
  * error rules for missing paths

**Hardening**

* **Determinism contract v0.1**

  * label verbs as pure/impure
  * define what “pure” guarantees (same inputs => same outputs)
* **Span-tracked parser errors** (line/column) across all backends, same codes.

---

## Mar 16–Apr 30: Pipeline skeleton + retries + checkpoints (systems slice)

**Ship**

* Pipeline runner (stages)
* Queue + worker pool
* Rate limit, retries with backoff, checkpoints
* Structured logs (machine readable)

**Spec drops (freeze v0.4)**

* **Error model spec v0.1**

  * error values vs thrown exceptions (pick one)
  * standard fields (code, message, origin verb, optional span)
  * how errors propagate through ceremonies and pipelines

* **IO model spec v0.1**

  * file read/write contracts
  * encoding rules for text
  * sandbox boundaries: what IO allowed in sandpits

**Hardening**

* **Repro runs**:

  * `pyash run --seed N` for anything nondeterministic (if any exists)
  * stable log schema
* **Backpressure rules** in pipeline (queue size, drop vs block)

---

## May–Jun: Scheduler and concurrency “truth serum”

**Ship**

* DAG scheduler
* Priorities
* Cancellation
* Timeouts
* Concurrency torture tests (readers–writers, dining philosophers)

**Spec drops (freeze v0.5)**

* **Concurrency spec v0.1**

  * what can be shared, what is isolated
  * cancellation semantics
  * ordering guarantees (if any)
* **Runtime lifecycle spec v0.1**

  * startup/shutdown hooks
  * resource cleanup contracts

**Hardening**

* Deterministic simulation mode for concurrency tests (where possible)
* Stress harness runs nightly (or on demand) and reports regressions by backend.

---

## Jul onward: “General purpose” means modules + packaging + tooling

This is the phase where a language becomes usable for other humans.

**Ship**

* Modules/imports
* Namespacing
* Package layout conventions
* Versioned stdlib
* Formatter + linter that people trust

**Spec drops (freeze v1.0 candidates)**

* **Module system spec v0.1**

  * how names resolve
  * cyclic import rules
  * visibility rules
* **Stdlib stability policy**

  * which verbs are stable, experimental, deprecated

**Hardening**

* Backward compatibility tests for “v1 stable” verbs/signatures
* Deprecation warnings with codes, plus a migration guide.

---

## The parity rule, refined (keeps honesty without trapping you)

Keep parity as your religion, but with one explicit mechanism:

* Every quiz is tagged:

  * `@core` must pass on all 3
  * `@js` allowed to lead temporarily
  * `@c` allowed to lag temporarily
* Every new feature starts life either as `@core` (if small) or `@js/@c` (if big), then gets promoted to `@core` when its spec is frozen.

This keeps you honest while still letting you move.

---

## Minimum “spec drop” templates (so you can ship them fast)

For each spec, keep the same headings:

* Purpose
* Concepts and terms
* Syntax surface (minimal)
* Semantics (bullet rules)
* Errors (codes)
* Examples (3)
* Tests that define it (file list)

That turns specs into a map of your quizzes, instead of a novel.

If you want to keep it ultra practical: the next spec to drop, given where you are, is **Core Semantics v0.1** plus a **standard error shape**. That will pay dividends immediately when you start tightening maps and text.
