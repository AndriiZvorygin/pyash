
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

The following conditions MUST raise an error per `06-errors.md`:

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
