# Moods and Memory

## 1. Purpose
Define mood behavior (`ya`, `do`, `def`, `prah`, `then`) and memory rules.

## 2. Terms
- memory: last-write-wins store of sentences keyed by `su name`.
- sandpit: temporary memory context used while running ceremonies/loops.
- exists: declaration flag on `ya` sentences.

## 3. Rules (normative)
- `ya` stores a fact in memory. `exists` is only valid on `ya` sentences.
- `do` executes a verb or ceremony; it does not store a new fact unless the verb returns one.
- `def` / `prah` wrap ceremony definitions. Bodies are stored for later invocation.
- `then` is used as a consequence sentence attached to conditionals.
- Memory is last-write-wins by subject name for non-definition sentences.
- Sandpits isolate side effects during ceremony/loop execution; merged results return to main memory.

## 4. Error contracts
- `exists` on a `do` sentence raises `be error do` (see `quiz/exists_do.test.mjs`).

## 5. Examples (existing files only)
- Run: `examples/pyash/fizzbuzz.pya`
- Run: `examples/pyash/ceremony-invoke.pya`

## 6. Tests that define truth
- `quiz/exists_do.test.mjs`
- `quiz/loop.test.mjs`
---

## Appendix A: Runtime relevance ordering (v0.1)

This appendix defines an **ordering of moods by practical runtime leverage**, especially for pipeline execution, journaling, replay, and deterministic contracts.

This ordering is **non-semantic**: it does not rank moods by philosophical importance, only by **how early and how often they are needed to build the core runtime**.

### A.1 Tier 1 — Core runtime moods (must exist early)

These moods are required to build a functioning pipeline, journal, replay system, and tooling interface.

| Mood               | Grammar | Surface | Role                                   |
| ------------------ | ------- | ------- | -------------------------------------- |
| deontic_mood       | `tu`    | `do`    | Execute stages, tools, retries, replay |
| declarative_mood   | `ksuh`  | `def`   | Define schemas, specs, contracts, APIs |
| realis_mood        | `li`    | `ya`    | Record facts into memory and journal   |
| interrogative_mood | `ri`    | `qwe`   | Inspect state, query journal, debug    |
| conditional_mood   | `cu`    | `then`  | Branching logic, retry and replay flow |

**Normative rule:**
Any runtime implementation must support these moods to be considered minimally usable.

---

### A.2 Tier 2 — Control, gating, and invariants

These moods are not required for minimal execution, but sharply improve correctness, safety, and explainability.

| Mood               | Grammar | Surface   | Role                                      |
| ------------------ | ------- | --------- | ----------------------------------------- |
| prohibitive_mood   | `ru`    | `forbid`  | Deny tools, IO, or actions with reasons   |
| assumptive_mood    | `swuh`  | `assume`  | Mark fallbacks and soft guarantees        |
| potential_mood     | `tseh`  | `can`     | Capability checks, feature gates          |
| necessitative_mood | `si2`   | `must`    | Hard invariants and contract enforcement  |
| epistemic_mood     | `si`    | `believe` | Non-factual conclusions, weaker than `ya` |

**Normative rule:**
These moods must be journaled distinctly and must never silently upgrade to `ya`.

---

### A.3 Tier 3 — Administrative and control force

These moods affect execution *style* rather than correctness.

| Mood            | Grammar | Surface   | Role                                    |
| --------------- | ------- | --------- | --------------------------------------- |
| imperative_mood | `pcih`  | `command` | Hard admin actions (kill, reset, purge) |
| directive_mood  | `di`    | `force`   | Priority or override semantics          |
| dubitative_mood | `twuh`  | `doubt`   | Suspicious or degraded trust states     |

---

### A.4 Tier 4 — Planning, intent, and commitment

Primarily useful for agent loops, intent compilation, and proposal systems.

| Mood             | Grammar | Surface   | Role                               |
| ---------------- | ------- | --------- | ---------------------------------- |
| speculative_mood | `lu`    | `guess`   | Hypothesis generation              |
| propositive_mood | `pi7`   | `propose` | Candidate plans and patches        |
| commissive_mood  | `mu`    | `promise` | Commitments and scheduled outcomes |

---

### A.5 Tier 5 — Expressive and human-centric moods

These moods enrich language expressiveness but are **not required** for early runtime correctness.

Includes:
hortative, volitive, deliberative, desiderative, optative, precative, jussive, permissive, eventive, benedictive, inductive, admonitive, apprehensive, imprecative, affirmative, irrealis, sensory_evidential, gnomic.

---

### A.6 Design invariant

* `ya` records **what is treated as reality**.
* `si`, `swuh`, `lu` never silently become `ya`.
* `do` causes effects.
* `qwe` observes without mutating.
* `def` creates structure.
* `then` controls flow.

Violating these invariants breaks replay, auditability, and trust.



