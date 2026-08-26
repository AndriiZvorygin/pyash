# `02-core-execution.md` (merged)

Merged specification sources (legacy IDs):
- 03-dispatch-and-signatures
- 04-ceremonies-and-this
- 05-control-flow
- 06-errors

---

# Dispatch and Signatures

## 1. Purpose
Define how signature words are derived and used for dispatch.

## 2. Terms
- signature: official word list `be <verb> <case> <type> ...`.
- handler: built-in verb implementation.
- ceremony: user-defined verb with a registered signature.

## 3. Rules (normative)
- Dispatch is **signature-based**, not verb-based: each distinct case/type/aspect shape is its own dispatch target.
- Dispatch is signature-first: derive signature words, then resolve to a ceremony (if registered) or a handler.
- If multiple ceremonies register the same signature, the most recent registration wins and a warning is emitted.
- Case order is normalized using the official compositional keyword order (`01-sentence-and-grammar.md`).
- Sequence registers (`fromindex`, `toindex`, `atindex`) are ignored when matching ceremony signatures.
- Literal `wo` values contribute their literal word(s) to the signature words (e.g., `from wo microphone` derives `from wo microphone`, `become wo markdown plain` derives `become wo markdown plain`), enabling strict literal dispatch.
- If a ceremony body reads sequence registers via `this`, include those cases in the definition to make the dependency explicit.
- If no handler or ceremony matches, raise `be error do` with the derived signature.

## 4. Error contracts
- Unknown verb/signature raises `be error do` (see `quiz/ceremony_signature_inconsistency.test.mjs`).
- Signature derivation failures raise `be error do` (see `quiz/derive_signature` references below).
- Surfaced errors MUST follow `02-core-execution.md`, including `from filename`, `by num`, and `at la … ko` when available.
- For `do` sentences that include `from filename` or `ob filename`, the runtime MUST guard that the source file exists before dispatch. If missing, raise `be error do` with name `file or directory unavailable error`.

## 5. Examples (existing files only)
- Run: `examples/pyash/ceremony-plus-two.pya`
- Typed JS parity: `examples/pyash/compile-ceremony-parity.pya`

## 6. Tests that define truth
- `quiz/ceremony_signature_inconsistency.test.mjs`
- `quiz/ceremony_sequence_signature.test.mjs`
- `quiz/map_signature.test.mjs`
- `quiz/compile_ceremony_parity.test.mjs`

---

# Configuration Defaults (dynamic)

## 1. Purpose
Define how runtime defaults are discovered and loaded at program start.

## 2. Rules (normative)
- Defaults are **dynamic facts** loaded at runtime, not hard-coded in verbs.
- The runtime MUST load config files in this order:
  1) `configure/default.pya`
  2) `configure/container.pya` (only when running in a container environment)
  3) `configure/secret.pya`
- Config discovery is **root-relative to the entry program path**:
  - The runtime MUST search upward from the entry file’s directory until it finds a `configure/default.pya` and use that directory as a config root.
  - The runtime MUST also load config files from the current working directory as a root (if different).
- Each config file is interpreted as normal Pyash sentences; defaults are expressed as `be default` facts.
- Later defaults override earlier defaults **only when explicitly redefined**.

## 3. Error contracts
- Missing config files are **not errors** (silent skip).
- Parse errors in config files surface as `be error ya`.

## 4. Related specs
- `07-io-and-scripts.md` (filesystem + IO)
- `11-modules.md` (module import and runner contract)


---

# Ceremonies and `this`

## 1. Purpose
Define ceremony definition/invocation, `this` access, and return behavior.

## 2. Terms
- ceremony: a `def`/`prah` block that defines a verb.
- evoker: the `do` sentence that calls a ceremony.
- register: loop/map fields on the evoker (`fromindex`, `toindex`, `atindex`, `by`).

## 3. Rules (normative)
- A ceremony is defined by `su name X be ceremony def` and closed by `su name X be ceremony prah`.
- The evoker’s signature must match the ceremony’s signature (sequence registers are allowed on the evoker even if omitted in the definition).
- `this` refers to the evoker sentence inside the ceremony body.
- `fromindex`, `toindex`, `atindex`, and register-form `by` belong to the active evoking sentence. Target and returned facts do not seed or replace those call-frame registers.
- A named `ret` returns the named fact's payload and value roles only; it does not implicitly import control registers from that fact. To change loop control, return the role explicitly, such as `this fromindex num 0 ret`.
- If a ceremony is defined more than once, the later definition takes priority (emit a compile-time warning).

## 4. Error contracts
- Signature inconsistency raises `be error do`.

## 4.1 Return and error propagation
- `ret` with `be error` returns the canonical error sentence as a `be error do` carrier.
- A nested ceremony or loop call propagates that carrier to its enclosing ceremony. The enclosing ceremony returns it immediately, so later body sentences run only on the successful path.
- A successful nested call remains an ordinary result even when the generated program also contains error-capable ceremonies; conditional error guards MUST NOT truncate later source statements.
- Only the top-level observation boundary surfaces the carrier as `be error ya`, preserving the canonical sentence separately from the compatibility `result` alias.

## 5. Examples (existing files only)
- Run: `examples/pyash/ceremony-invoke.pya`
- Run: `examples/pyash/ceremony-plus-two.pya`
- Run: `examples/pyash/ceremony-error-propagation.pya`
- Run and compile: `examples/pyash/compile-ceremony-parity.pya`

## 6. Tests that define truth
- `quiz/ceremony_signature_inconsistency.test.mjs`
- `quiz/ceremony_overwrite_warning.test.mjs`
- `quiz/compile_ceremony_overwrite_warning.test.mjs`
- `quiz/compile_ceremony_parity.test.mjs`

## 4.1 JavaScript lowering boundary

The interpreter and JavaScript compiler share the definition signature derived from the `def` header. For the supported top-level subset, a generated function validates the incoming sentence signature, executes the body with a fresh local frame, and returns the evoker sentence after `ret` updates its `ob`. A generated caller merges that `ob` into the addressed target instead of replacing the target sentence, preserving `su`, `be`, and the caller's value shape. The generated guard uses the interpreter's `signature inconsistency` identity and message contract.

The lowering is intentionally limited to direct top-level ceremony definitions with scalar typed arguments and existing supported body emitters. Nested/dynamic definitions, recursion, closures, imported ceremonies, broader control-flow lowering, and C output remain deferred.


---

# Control Flow

## 1. Purpose
Define official conditionals and loop semantics.

## 2. Terms
- conditional: `tiny`/`giant`/`equally` with an inline `then` consequence.
- loop: invocation with `fromindex` (and optional `toindex`).

## 3. Rules (normative)
- Conditional form is `ob … be tiny/giant/equally from … then <sentence>` and executes the inline consequence immediately when true.
- If the consequence needs to be a `ret`, both inline and two-line forms are valid:
  - inline: `ob … be tiny/giant/equally from … then <ret sentence>`
  - two-line: `ob … be tiny/giant/equally from … then` followed by `<ret sentence>`
- Loop semantics:
  - `fromindex <start> [toindex <bound>] be <ceremony> do` runs the body and stops when `fromindex === toindex` (or `fromindex === 0` if `toindex` is absent).
  - When `toindex` is present, the supervisor steps `fromindex` toward `toindex` by +/- 1 each iteration.
  - The supervisor reads progression state from the final evoker sentence. Target facts may retain payload/result data, but their `fromindex`, `toindex`, `atindex`, and register-form `by` fields are not loop state.
  - A named `ret` cannot redirect or shorten a loop through stale target registers; explicit role returns remain the supported control update.
  - Indexing is 0-based.
- Boolean composition:
  - Negation: `be not ob la <sentence> ko` inverts a boolean-producing sentence.
  - Conjunction: `be and ob la <sentence> ko with la <sentence> ko` yields truth only if both are truth.
  - Disjunction: `be or ob la <sentence> ko with la <sentence> ko` yields truth if either is truth.
  - These forms return `ob bool truth|lie`.

## 3.1 Result facts (normative)

On successful imperative execution, the runtime stores a **`ya`** result sentence:

* If the invoked sentence has `su name <id>`, store `su name <id> ob <value> be <verb> ya`.
* For compatibility, also store `su name result ob <value> be <verb> ya`.

The value always lives in `ob`, so it can be retrieved with genitives such as
`ob num of <id>`.

### 3.1.1 Command result identity (normative)

Every synchronous `be command do` invocation allocates one run-scoped command
identity at runtime. The allocator starts at `000001` for a fresh interpreter
run and formats the identity as `command request <six-digit ordinal>`. The
ordinal is allocated at invocation time, not from source lines, hashes,
filenames, timestamps, or compiler counters; loops, ceremonies, nested calls,
and repeated commands therefore receive distinct deterministic identities.
When newspaper recording is enabled, the run emits the sentence-native
capability marker `exists su name command result identity protocol ob text
"v1" be text ya`; replay applies the strict identity graph contract only when
this exact marker is present.

Before command policy/audit records, the runtime records the request as an
evoke sentence whose subject is the canonical request identity:

```text
exists su name command request 000001 ob la <command sentence> ko be evoke ya
```

The successful surfaced result is a sentence-shaped command fact with the same
subject and `be command ya`:

```text
su name command request 000001 ob text "<stdout>" be command ya
```

The fact is addressable through `remember("command request 000001")` and
genitives such as `ob text of command request 000001`. The runtime continues to
update the explicit `su name ...` and `to name ...` destination facts, and
continues to update `remember("result")` as the latest compatibility alias.
Declared command output files are correlated with this same identity through
the run artifact/exchange recorder.

The runnable example `examples/pyash/command-result-identity.pya` intentionally
uses the established generic `result` compatibility alias rather than adding a
new vocabulary word for the latest command result.

Implementations MAY also record a fully-resolved copy of the evoker sentence
(with `to` bound to its resolved target) when that is useful for reuse, but the
primary result fact is the `su name <id> … ya` sentence above.

## 3.2 Nickname bindings (normative)

`nickname` creates a live alias binding.

Form:
- `exists su name <alias> ob name <source> be nickname ya`
- `exists su name <alias> ob <genitive-path> be nickname ya`

Rules:
- A nickname aliases either a plain remembered name or a genitive path.
- Reading the nickname must resolve to the current underlying value, not a snapshot.
- Writing through the nickname must update the underlying binding or slot, not replace the nickname declaration itself.
- Genitive nickname targets must support the same observable slot updates as direct writes to that path.

Examples:
- `exists su name bucket alias ob name bucket be nickname ya`
- `exists su name score alias ob score of profile be nickname ya`

## 4. Error contracts
- Invalid conditionals or unknown verbs raise `be error do`.

## 5. Examples (existing files only)
- Run: `examples/pyash/fizzbuzz.pya`
- Run: `examples/pyash/insertion-sort.pya`

## 6. Tests that define truth
- `quiz/conditional_inline.test.mjs`
- `quiz/loop.test.mjs`
- `quiz/compile_loop_js.test.mjs`


---

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
* `be error do` sentences are **not facts** and MUST NOT be stored in memory or newspapers.

### 3.2 Surfacing (observation boundaries)

* When an error becomes observable, it MUST be surfaced as a **`be error ya`** sentence.
* Observation boundaries include:

  * returning an error as the final result at a top-level observation boundary (an error returned between nested ceremonies remains `be error do`),
  * storing an error outcome in memory or newspaper,
  * printing or emitting an error as the final outcome of evaluation.
* Surfacing an error converts the sentence mood from `do` to `ya` and preserves all required and optional fields.
* Surfaced errors are facts and MAY be stored; thrown errors are not.
* When errors are presented to users, implementations MUST render the surfaced error sentence (not a raw exception string).

### 3.3 Required and optional fields

Both thrown and surfaced error sentences share the same field requirements:

* **Required fields**

  * `su name <error-name>`
  * `ob text <message>`
  * `from name <source>`

* **Optional fields**

  * `ob.pyash`
  * `ob.raw`
  * `at la <sentence> ko`
  * `from filename "<path>"`
  * `by num <line-number>`

When the runtime has source context, it MUST include `from filename`, `by num`, and `at la … ko`.
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
* `refinery defective`
* `platform defective`
* `depend defective`
* `again defective`
* `evoke clause defective`

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
