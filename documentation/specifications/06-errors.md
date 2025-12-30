# Errors

## 1. Purpose

Define the error sentence contract, error propagation rules, and official error names.

---

## 2. Terms

* **error sentence (thrown)**: a `be error do` sentence used as an exception carrier.
* **error sentence (surfaced)**: a `be error ya` sentence used as an observable result.
* **arrest**: catching a thrown error and preventing further propagation.

---

## 3. Rules (normative)

### 3.1 Throwing, propagation, and arrest

* Errors are thrown as exceptions with `err.sentence` set to a **`be error do`** sentence.
* While propagating through evaluation, dispatch, or runtime execution, errors MUST remain in the `be error do` form.
* A thrown error MAY be **arrested** (caught) by an implementation.
* Arresting an error MAY:

  * rethrow the same `be error do` sentence,
  * transform it into another `be error do` sentence, or
  * surface it as a result sentence (see §3.2).
* `be error do` sentences are **not facts** and MUST NOT be stored in memory or journals.

### 3.2 Surfacing (observation boundaries)

* When an error becomes observable, it MUST be surfaced as a **`be error ya`** sentence.
* Observation boundaries include:

  * returning an error as the result of an operation,
  * storing an error outcome in memory or journal,
  * printing or emitting an error as the final outcome of evaluation.
* Surfacing an error converts the sentence mood from `do` to `ya` and preserves all required and optional fields.
* Surfaced errors are facts and MAY be stored; thrown errors are not.

### 3.3 Required and optional fields

Both thrown and surfaced error sentences share the same field requirements:

* **Required fields**

  * `su name <error-name>`
  * `ob text <message>`
  * `from name <source>`

* **Optional fields**

  * `ob.pyash`
  * `ob.raw`

No fields are added, removed, or renamed during surfacing.

---

## 4. Error contracts (stable names)

The following error names are stable and MUST be supported:

* `unknown verb`
* `signature inconsistency`
* `signature derive`
* `exists defective`
* `compile error`
* `variable as not exists`
* `stream exhausted`
* `chip exhausted`

Additional error names MAY be introduced by later specifications.

---

## 5. Examples (existing files only)

* See: `quiz/exists_do.test.mjs`
* See: `quiz/ceremony_signature_inconsistency.test.mjs`

---

## 6. Tests that define truth

* `quiz/exists_do.test.mjs`
* `quiz/ceremony_signature_inconsistency.test.mjs`

---

### One-sentence rule of thumb

> **Errors propagate as `be error do` until arrested or observed; once observed, they surface as `be error ya`.**
