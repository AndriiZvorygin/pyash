# `01-sentence-and-grammar.md` (merged)

Merged specification file. Original sources:
- `01-sentence-model.md`
- `02-moods-and-memory.md`
- `07-compositional-cases.md`
- `10-subordinate-clauses.md`

---

## Sentence Model

## 1. Purpose
Define the shape of a sentence and how cases/genitives/quoting are represented.

## 2. Terms
- sentence: a structured object with mood, verb, and cases.
- case: keyworded role like `su`, `ob`, `to`, `from`, `by`.
- genitive: a field chain such as `this ti ob ti num`.

## 3. Rules (normative)
- A sentence has `mood`, `be`, and any number of cases.
- Cases are keyworded fields (`su`, `ob`, `to`, `from`, `by`, `fromindex`, `toindex`, `atindex`).
- `su name <x>` identifies a subject name; `ob num <n>` / `ob text <t>` / `ob date <d>` are typed payloads. Dates are ISO 8601.
- `wo` is a literal word type: `ob wo microphone` stores the literal token(s) and does not resolve memory names. It is used for strict literal dispatch in signatures. `wo` values may be multi-token (e.g., `become wo markdown plain`) and consume tokens until a boundary keyword.
- Typed name references use `name <type> <literal>` (e.g., `to name num counter`, `to name text line`); the type must immediately follow `name` to allow multi-word literals.
- Genitives resolve a field chain on a sentence:
  - Possessive: `this ti ob ti num` maps to `this.ob.num`.
  - Genitive: `num of ob of this` maps to the same chain.
- Type casts are explicit verbs and return typed values:
  - `be text` coerces `text`/`filename`/`name` into `ob text`.
  - `be filename` coerces `text`/`filename`/`name` into `ob filename`.
- Subordinate clauses embed a full sentence as a case value using `la … ko`:
  - Example: `ob la su name clause ob text "ok" be text ya ko`.
  - The embedded sentence is represented as `ob: { la: <sentence> }` in the internal model.
- Quoted blocks use `quoted.<lang>. … .<lang>.quoted` and are parsed as text.
- Newlines inside quoted blocks are preserved; escaped `\\n` sequences are unescaped before parsing.
- Internal sentence objects use `su` / `ob` keys; `subj` / `obj` are accepted at the surface but canonicalize to `su` / `ob` on parse.
- Keyword lists (moods, cases, type tokens, vyah modifiers) are defined in `program/library/grammar/keywords.mjs` and MUST be treated as the source of truth.
- Type tokens include `line/lines` and `byte/bytes` for quantity contexts (e.g., `atmost lines 30`, `fromindex byte 200`).
- Official ordering (for sentence formatting and signature words) follows the compositional case order (`01-sentence-and-grammar.md`) and JSON official key ordering (`06-data-formats.md`).

## 3.1 Dynamic defaults (adapter rules)

Dynamic defaults let configuration attach missing cases to matching sentences without custom code.

Rule form (stored as a normal default fact):

```
exists su name <rule-name>
  ob la <match-clause> ko
  <case> <value>
  <case> <value>
be default ya
```

Matching:
* The `ob la … ko` clause is a **pattern** that must match the target sentence by `be` and any cases present in the clause.
* If the clause omits a case, that case is ignored for matching.

Application:
* For each matching rule, any **missing** case on the target sentence is filled from the rule sentence.
* The rule does **not** overwrite cases that are already present on the target sentence.
* The rule’s `mood`, `be`, `su`, `ob`, and `exists` are never copied.

## 4. Error contracts
- If a sentence cannot be parsed, the parser raises an error (see `quiz/parser.test.mjs`).

## 5. Examples (existing files only)
- Run: `examples/pyash/compile-text-to-js-text.pya`
- Run: `examples/pyash/vector-write-index.pya`

## 6. Tests that define truth
- `quiz/parser.test.mjs`
- `quiz/compositional.test.mjs`


---

## Moods and Memory

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

This appendix defines an **ordering of moods by practical runtime leverage**, especially for pipeline execution, newspaper, again, and deterministic contracts.

This ordering is **non-semantic**: it does not rank moods by philosophical importance, only by **how early and how often they are needed to build the core runtime**.

### A.1 Tier 1 — Core runtime moods (must exist early)

These moods are required to build a functioning pipeline, newspaper, again system, and tooling interface.

Comment mood:
- `pe` is a non-executing comment mood. The interpreter MUST ignore `pe` sentences and they MUST NOT affect dispatch, memory, or control flow.

| Mood               | Grammar | Surface | Role                                   |
| ------------------ | ------- | ------- | -------------------------------------- |
| deontic_mood       | `tu`    | `do`    | Execute stages, tools, retries, again |
| declarative_mood   | `ksuh`  | `def`   | Define schemas, specs, contracts, APIs |
| realis_mood        | `li`    | `ya`    | Record facts into memory and newspaper |
| interrogative_mood | `ri`    | `qwe`   | Inspect state, query newspaper, debug  |
| conditional_mood   | `cu`    | `then`  | Branching logic, retry and again flow |

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
These moods must be recorded in the newspaper distinctly and must never silently upgrade to `ya`.

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

Violating these invariants breaks again, auditability, and trust.



---

## `07-compositional-cases.md`

**Status:** v0.1

## 1. Purpose

Define the compositional case system used by Pyash for roles like `from`, `to`, `become`, `fromindex`, etc. This is core semantics for parsing, signature derivation, and sentence formatting.

## 2. Model

Every case is a combination of:

- **axis**: `source`, `way`, `destination`
- **context**: domain for the relation

The implementation exposes **single-token keywords** for each `(axis, context)` pair. These are the canonical case words used in sentences and signatures.

## 3. Canonical case keywords

```text
| context    | source      | way         | destination |
|------------|-------------|-------------|-------------|
| space      | from        | at          | to          |
| interior   | outof       | inside      | into        |
| surface    | offof       | along       | onto        |
| under      | fromunder   | under       | beneath     |
| time       | since       | during      | until       |
| state      | fromstate   | as          | become      |
| person     | fromperson  | with        | for         |
| social     | fromgroup   | among       | intogroup   |
| discourse  | fromtext    | accordingto | totext      |
| quantity   | times       | by          | per         |
| limit      | atleast     | exactly     | atmost      |
| sequence   | fromindex   | atindex     | toindex     |
```

## 4. Normalization rules

- Canonical case keywords are the **single-token** forms in the table above.
- The parser **may accept split forms** and normalize them:
  - `from state` → `fromstate`
  - `to state` → `become`
  - `to text` → `totext`
  - `from limit` → `atleast`
  - `via limit` → `exactly`
  - `to limit` → `atmost`
- Signature derivation and formatting **use the canonical keywords**.

## 5. Sentence roles

- Cases attach to the sentence as their canonical keyword (e.g., `fromstate`, `become`, `fromindex`).
- The payload for a case is an object (e.g., `fromstate { name: "json" }`).
- The `ob` field is still the main payload slot; there is no per-context `ob` alias in v0.1.

## 6. Formatting and signature order

- Sentence formatting and signature derivation use the canonical case keywords above.
- Keyword order is derived from the compositional grid; new cases must be added there.
- Implementations MUST use the keyword lists from `program/library/grammar/keywords.mjs` (not hardcoded case lists).

## 7. Examples

```text
from state pyash to state json be compile do
fromindex num 1 toindex num 10 be process do
fromtext "prompt" totext output be read do
ob date 2025-05-01 be record ya
ob date today be record ya
ob day 3 be record ya
ob month 1 be record ya
```

## 8. Source of truth

The canonical mapping is defined in:

- `program/library/compositionalCases.mjs`
- `program/library/grammar/keywords.mjs`
- `documentation/compositional-cases.md` (expanded background)


---


# `10-subordinate-clauses.md` (draft v0.4)

**Status:** draft (semantics locked, wording polish pending)

---

## 1. Purpose

Define **subordinate clauses**, the mechanism by which a **Pyash sentence form** may be embedded inside another sentence as a **sentence-valued structure**.

Subordinate clauses are used to:

* embed sentences as values
* pass sentences through signatures and dispatch
* record evoked sentences in the run newspaper
* support higher-order verbs, tools, and again

This specification defines the **syntax, structural semantics, determinism rules, and dispatch interaction** for subordinate clauses.

---

## 2. Terms

* **subordinate clause** — a sentence embedded inside another sentence using `la … ko`
* **host sentence** — the sentence that contains a subordinate clause
* **embedded sentence form** — the moodless sentence form inside the clause

---

## 3. Syntax (normative)

### 3.1 Clause delimiters

A subordinate clause:

* **starts with** `la`
* **ends with** `ko`

Everything between `la` and `ko` MUST be exactly one **embedded sentence form**.

### 3.2 Embedded sentence form is mood-optional

* The embedded sentence form MAY contain a mood marker (`ya`, `do`, or any other mood token).
* In normal usage the embedded sentence form is moodless; moods are mainly used for newspaper records.
* The host sentence provides mood in the normal way.

### 3.3 General form

```
<case> la <embedded sentence form> ko <rest> be <verb> ya
```

Example:

```
ob la su name x be text ko be evoke ya
```

(Here the embedded sentence form is `su name x be text`.)

---

## 4. Structural semantics (normative)

### 4.1 Sentence container

* A subordinate clause embeds a sentence form as a structured value.
* The subordinate clause itself has **no mood**.
* The embedded sentence form is preserved as structure for later inspection or evaluation.
* The embedded sentence form is stored directly under `la`, e.g. `ob.la.su.name`.
* For signature dispatch, the embedded value is typed as `la`.

### 4.2 Evaluation boundary

* Embedding a sentence form inside `la … ko` does not evaluate it.
* If a verb later evaluates an embedded sentence form, that evaluation occurs under the consuming verb’s rules.

### 4.3 Dispatch and signatures

* Subordinate clauses MAY participate in:

  * signature derivation
  * dispatch selection
  * verb semantics
* Dispatch MAY inspect the structure of the embedded sentence form, including its verb and cases.

---

## 5. Placement rules

* A subordinate clause MAY appear anywhere a value is permitted by a verb signature.
* No positional restrictions are imposed by this specification beyond syntactic validity.

---

## 6. Ordering and determinism

### 6.1 Official ordering inside clauses

* The embedded sentence form inside `la … ko` MUST be emitted using **official sentence ordering**.
* Case order, `vyah` ordering, and vector/map ordering inside the embedded sentence form MUST follow their respective specifications.

### 6.2 Normalized emission

* Journals, logs, and tools MUST emit subordinate clauses in **normalized (official)** order.
* Implementations MAY accept arbitrary input order, but output MUST be canonical.

---

## 7. Nesting

* Subordinate clauses MAY be nested.
* Nesting MUST be well-formed and unambiguous.

Example (valid):

```
ob la ob la su name x be text ko be evoke ko be log ya
```

---

## 8. Error conditions

The following conditions MUST raise an error per `02-core-execution.md`:

* missing `ko`
* malformed embedded sentence form
* more than one embedded sentence form inside a single `la … ko`
* structurally invalid nesting

---

## 9. Interaction with other specifications

* The run newspaper records evoked sentence forms using subordinate clauses:

  ```
  ob la <embedded sentence form> ko be evoke ya
  ```
* Subordinate clauses do not introduce new cases, moods, or aspects.
* Subordinate clauses embed sentence structure only; they do not alter the host sentence’s evaluation semantics.

---

## 10. Conformance

An implementation conforms to this specification if it:

* parses `la … ko` as a subordinate clause
* allows mood-optional embedded sentence forms
* preserves embedded sentence forms exactly
* allows subordinate clauses to participate in dispatch and signatures
* emits deterministic, byte-stable representations

---

### Summary rule

> **A subordinate clause embeds a sentence form as a sentence-valued structure.**
