# `04-runtime-primitives.md` (merged)

Merged specification sources (legacy IDs):
- 07-c-ir
- 09-runtime-primitives
- 21-vector-at-all

---

# C Internal Representation (Stage 1 Flat IR)

**File:** `04-runtime-primitives.md`  
**Status:** v0.1  
**Intent:** A close-to-Pyash, low-churn C IR that can ingest Pyash and emit Pyash.  
**Future:** A separate lowering pass may emit the high-speed pyac tuple stream later.

---

## 1. Goals

- Keep parsing and printing simple.
- Keep runtime execution fast enough for early progress.
- Keep code churn low as surface parsing and printing evolve.
- Preserve Pyash semantics from the existing specs.

---

## 2. Core principles

### 2.1 Flat keyworded fields

Pyash cases are keyworded fields (examples: `su`, `ob`, `to`, `from`, `by`, plus sequence registers).  
C IR stores these as flat optional fields on the sentence record.

### 2.2 Surface order vs in-memory order

Pyash surface order is postpositional (mood at end).  
C IR stores mood as a field (`sentence.mood`).  
Emitter prints mood at the end.

### 2.3 Two-layer plan

- Stage 1: Flat Sentence IR (this file)
- Stage 2: Lower Flat Sentence IR into pyac packed tuples (separate spec later)

Stage 2 must remain a pure lowering step so the parser and printer stay unchanged.

---

## 3. Interning and word IDs

Implementations may intern frequent words into `uint16_t` IDs:
- verbs (`be` values)
- case keywords (`su`, `ob`, etc.)
- mood keywords (`ya`, `do`, `def`, `prah`, `then`)
- common name types (`num`, `text`, etc.)

Arbitrary literals (free text, long identifiers) remain stored as strings (or indexes into a string table).

---

## 4. Data model

### 4.1 Mood

Moods are:

- `YA`
- `DO`
- `DEF`
- `PRAH`
- `THEN`

Store as an enum.

### 4.2 Name reference

A typed name reference corresponds to: `name <type> <literal>`

Store:
- `type` (interned word ID or string)
- `lit` (string or string-table index)

### 4.3 Genitive chain (path)

A genitive chain corresponds to: `this ti ob ti num` and similar.

Store:
- base: either `THIS` or a `NAME` reference
- steps: ordered list of selectors (interned word IDs preferred)

Direction is left-to-right: `this ti ob ti num` stores base `THIS` with steps `["ob", "num"]`, matching the surface order.

---

## 5. Value IR

Values are a tagged union.

### 5.1 Required value tags

- `V_NUM`        (double or fixed-point, backend choice)
- `V_TEXT`       (string view or string-table index)
- `V_BOOL`
- `V_HOLLOW`     (JSON null semantics)
- `V_UNSPEC`     (absence semantics)
- `V_NAME`       (typed name reference)
- `V_THIS`
- `V_PATH`       (genitive chain)
- `V_VECTOR`
- `V_MAP`
- `V_SENTENCE`   (inline sentence payload, used by `then` and other constructs)

### 5.2 Vectors

Vector stores:
- length
- element storage as `ValueRef[]` (indexes into a value pool) or `Value[]` (inline), backend choice

Stage 1 allows inline vectors for simplicity.

### 5.3 Maps

Two map kinds:
- `MAP_PYASH`
- `MAP_JSON`

JSON map rules:
- `V_HOLLOW` represents present null
- `V_UNSPEC` represents absence and gets omitted during JSON export and JSON enumeration

Map storage options in Stage 1:
- hash map for lookup
- optional sorted key cache for JSON maps (for official enumeration / export)

---

## 6. Sentence IR

### 6.1 Sentence structure

A sentence stores:
- `be` (interned verb ID or string)
- `mood` (enum)
- `exists` flag (valid only when mood is `YA`; required on the first `ya` write to a new `su name` so missing names error)
- flat optional case fields:
  - `su`, `ob`, `to`, `from`, `by`
  - `fromindex`, `toindex`, `atindex`
- optional inline consequence sentence for conditionals:
  - `then_sentence` (pointer or index)

### 6.2 Field presence

Each optional field has presence tracked via a bitmask.

Example bit names:
- `HAS_SU`, `HAS_OB`, `HAS_TO`, `HAS_FROM`, `HAS_BY`
- `HAS_FROMINDEX`, `HAS_TOINDEX`, `HAS_ATINDEX`
- `HAS_THEN`

Presence mask prevents sentinel hacks.

### 6.3 Register classification

Registers for dispatch matching:
- `fromindex`, `toindex`, `atindex` are sequence registers
- signature derivation skips sequence registers

Keep a `REGISTER_MASK` for quick filtering.

---

## 7. Dispatch support

### 7.1 Signature derivation helper

Provide a helper:

`derive_signature(sentence) -> signature_words`

Rules:
- Start with `be`
- Include case keywords that are present and outside `REGISTER_MASK`
- Sort included case keywords by keyword ID (or by keyword text if IDs are absent)

Store the signature in a compact form suitable for ceremony lookup:
- small vector of `uint16_t` word IDs is ideal

### 7.2 Ceremony lookup

Ceremonies are keyed by derived signature words.

If no handler exists:
- raise an error sentence (see Section 10) with a message that includes the derived signature words

---

## 8. Memory model alignment

### 8.1 Stored facts

`YA` sentences update memory.

Memory key:
- `su name <type> <literal>` identifies the stored fact

Store last-write-wins for a given subject.

### 8.2 Sandpit behaviour

Ceremony evaluation uses a sandpit memory layer that merges back after completion, per the mood and memory rules in the existing specs.

Stage 1 implementation may use:
- copy-on-write maps
- or a log of writes for merge-back

---

## 9. Ingest and emit

### 9.1 Ingest (Pyash parse)

Parser produces Flat Sentence IR directly:
- read postpositional mood at end and set `sentence.mood`
- read `be <verb>` and set `sentence.be`
- read keyworded fields and fill flat case slots
- parse typed names into `V_NAME`
- parse genitive chains into `V_PATH`
- parse `then <sentence>` into `then_sentence`

### 9.2 Emit (Pyash print)

Emitter prints official Pyash surface:
- print each case group in a stable order (sort by case keyword)
- print mood at end
- for conditionals, print `then <sentence>` inline

Stage 1 emitter goal: stable diffs for goldens.

---

## 10. Errors

Errors are represented as thrown sentences.

A thrown error sentence uses:
- mood `DO`
- `be error`
- required fields:
  - `su` as a name reference (`su name <error-name>`)
  - `ob` as text message (`ob text <message>`)
  - `from` as a name reference (`from name <source>`)

When emitted, error sentences follow the same stable case ordering used by signature derivation.

Provide helper:
- `make_error(error_name, message, source) -> Sentence`

---

## 11. Ownership and allocation

Stage 1 allows a simple arena allocator:
- allocate sentences, vectors, maps, strings from arenas
- free arenas per program run or per REPL transaction

Value payload options:
- inline small scalars
- string table for text literals
- reference-counted heap objects remain optional in Stage 1

---

## 12. Forward compatibility: lowering to pyac

Stage 2 will introduce a lowering pass:

`lower_flat_ir_to_pyac(program_flat_ir) -> pyac_tape`

Requirements for that future pass:
- preserve `derive_signature` behaviour
- preserve register skip rules for signature matching
- preserve `then` inline consequence semantics
- preserve JSON map omission rules for `V_UNSPEC` on export and enumeration

Stage 1 code should keep clean seams:
- IR construction
- dispatch
- execution
- emission

So Stage 2 can swap the execution backend without touching parsing or printing.

---


---

# Runtime primitives (draft v1.2)

**Status:** draft (semantics locked, wording polish pending)

---

## 1. Purpose

This file defines the runtime primitives used by Pyash evaluation:

* **duty** — a running job with lifecycle
* **stream** — an ordered sequence of outputs with lifecycle
* **chip** — a single ordered output from a stream

Finished results are expressed as:

* a normal return sentence (for success), or
* an error sentence (`be error ya`) (for failure)

`vyah` modifier rules (including `sloh`) are defined in `03-vyah-and-aspect.md`.
Aspect inventory and meaning are defined in `03-vyah-and-aspect.md`.

---

## 2. Terms

* terminal — a state that will never change again
* lever — the identifier (`su name …`) of a duty
* stream name — the identifier (`su name …`) of a stream
* lifecycle aspect — an aspect that operates on an existing duty or stream (for example `await`, `finish`, `cancel`)

---

## 3. Global invariants (normative)

1. Deterministic output  
   For the same inputs, configuration, and seed (when applicable), emitted sentences MUST be identical across implementations.

2. Stable identity  
   Lever names and stream names MUST remain stable for the lifetime of the object they identify.

3. Terminal guarantees  
   Lifecycle aspects MUST either reach a terminal outcome or raise an error.

4. No silent success for lifecycle aspects  
   When a lifecycle aspect succeeds, the returned sentence MUST include `vyah … sloh …`.

---

## 4. Finished results

### 4.1 Success

A successful finished result is returned as a normal return sentence, e.g.:

`ob text "hello" be text ya`

The exact success verb (`text`, `num`, `map`, etc.) is determined by the verb signature; this spec does not wrap it.

### 4.2 Failure

A failed finished result is returned as an error sentence, e.g.:

`su name timeout ob text "too slow" from name runtime be error ya`

Error vocabulary and sentence conventions are defined in `02-core-execution.md`.

---

## 5. Primitive: duty

### 5.1 Meaning

A duty represents an in-flight job that may finish later.

A duty supports:
* state inspection
* `await` (wait for completion)
* `finish` (clean finalisation)
* `cancel` (intentional stop)

### 5.2 Sentence form (official)

`su name <lever> as name <state> be duty ya`

Example:

`su name L7 as name running be duty ya`

### 5.3 States (duty)

Duty state MUST be one of the following names:

* `running`
* `done`
* `fail`
* `lost`
* `abandoned`

Semantics:

* `done`, `fail`, `lost`, and `abandoned` are terminal
* `lost` means the runtime can no longer observe or control the duty
* `abandoned` means the duty was intentionally stopped via `cancel`

---

## 6. Primitive: stream

### 6.1 Meaning

A stream represents an ordered sequence of outputs produced over time.

A stream supports:
* pulling chips (see §7.4)
* `finish` (clean end)
* `cancel` (intentional stop)

### 6.2 Sentence form (official)

`su name <stream> as name <state> be stream ya`

Example:

`su name S3 as name open be stream ya`

### 6.3 States (stream)

Stream state MUST be one of the following names:

* `open`
* `done`
* `fail`
* `lost`
* `abandoned`

Semantics:

* `done`, `fail`, `lost`, and `abandoned` are terminal
* `lost` means the runtime can no longer observe or control the stream
* `abandoned` means the stream was intentionally stopped via `cancel`

---

## 7. Primitive: chip

### 7.1 Meaning

A chip is one ordered output element from a stream.

### 7.2 Sentence form (official)

`su name <stream> atindex num <n> ob <type> <literal> be chip ya`

If the runtime knows the total length, it MAY also include `toindex` in the
same chip sentence:

`su name <stream> atindex num <n> toindex num <last> ob <type> <literal> be chip ya`

Examples:

`su name S3 atindex num 0 ob text "he" be chip ya`  
`su name S3 atindex num 1 toindex num 1 ob text "llo" be chip ya`

### 7.3 Rules

* `atindex` starts at `0` and increases by `1`
* ordering is determined solely by the index value
* `toindex` (when present) expresses the last index; it MAY appear on any chip
* if the runtime already knows the last index, it SHOULD include `toindex`
* a chip where `atindex == toindex` implies the stream transitions to `done`

### 7.4 Pulling chips (stream consumption)

Pulling the next output from a stream is done by evaluating the verb `chip` with the stream name in `su`.

Input form:

`su name <stream> vyah eval be chip ya`

Output:

* on success: a chip sentence, and MUST include `vyah eval sloh`
* on failure: an error sentence

Notes:

* The last chip SHOULD include `toindex` when known.
* After a chip where `atindex == toindex`, the stream is considered `done`.
* Calling `chip` again after the final chip MUST raise an error sentence (chip exhausted).

Example success:

`su name S3 atindex num 0 ob text "he" vyah eval sloh be chip ya`

Example after exhaustion:

`su name done ob text "stream is done" from name runtime be error ya`

(Exact error naming is per `02-core-execution.md`; the requirement is that it is an error sentence.)

---

## 8. Lifecycle aspects and outcomes

Lifecycle aspects return ordinary sentences. Success is marked using `vyah … sloh`.

### 8.1 The `sloh` success marker

When a lifecycle aspect succeeds, the returned sentence MUST include `vyah … sloh`.
Failure is always an error sentence.

---

### 8.2 `await` (duty → finished result)

Input: duty lever in `su`  
Output:
* on success: a finished normal return sentence with `vyah await sloh`
* on failure: an error sentence

Rules:

* If duty reaches `done`, return the finished result with `vyah await sloh`
* If duty reaches `fail`, `abandoned`, or `lost`, return an error sentence

Example:

`ob text "ok" vyah await sloh be text ya`

---

### 8.3 `cancel` (duty or stream → acknowledgement)

Input: duty or stream identifier in `su`  
Output:
* on success: an acknowledgement sentence with `vyah cancel sloh`
* on failure: an error sentence

Rules:

* On success, the target MUST transition to `abandoned`
* `cancel` is idempotent:
  * canceling an already terminal target returns success unless the target is `lost`
  * if the target is `lost`, return an error sentence

Example success acknowledgement:

`su name L7 vyah cancel sloh be hear ya`

(Any acknowledgement verb is allowed; the requirement is `vyah cancel sloh`.)

---

### 8.4 `finish` (duty or stream → acknowledgement)

Input: duty or stream identifier in `su`  
Output:
* on success: an acknowledgement sentence with `vyah finish sloh`
* on failure: an error sentence

Rules:

* On success, the target MUST transition to `done`
* `finish` is idempotent unless the target is `lost`

Example:

`su name S3 vyah finish sloh be hear ya`

---

## 9. Interaction with aspect (summary)

At minimum:

* `eval` → finished result (normal sentence or error sentence)
* `start` → duty
* `stream` → stream
* `await` → finished result (with `sloh` on success)
* `finish` → acknowledgement or error (with `sloh` on success)
* `cancel` → acknowledgement or error (with `sloh` on success)

Unsupported aspects MUST return an error sentence.

---

## 10. Journal and log requirements

Implementations MUST record:

* the full emitted sentence (with official `vyah` ordering)
* primitive kind: `duty | stream | chip | finished | error`
* primary subject identifier (`su`) when present
* aspect (`eval | start | stream | await | finish | cancel`)
* resulting state when applicable

Schemas are defined elsewhere.

---

## 11. Implementation notes (normative)

1. `as` parsing  
   `as` is a state case keyword (see compositional cases). Implementations MUST parse `as` as a role keyword so sentences like  
   `su name L7 as name running be duty ya`  
   are accepted.

2. State words  
   State words such as `open`, `final`, `notfinal` are plain names. Implementations MAY validate against the enumerations in this file, but they are not required to be parser keywords.

---

## 12. Conformance

An implementation conforms if it:

* represents duties, streams, and chips using the sentence forms above
* returns finished results as normal sentences or error sentences
* enforces lifecycle state transitions
* uses `vyah … sloh` for lifecycle success
* emits deterministic sentences with official `vyah` ordering


---

# Spec: `at all` Over Vectors in Pyash (Map + In-Place Foreach)

This version defines `at all` as element-wise application where:

* **with `to`**: produce a new vector (map)
* **without `to`**: update the original vector in place (foreach-style transform)
* Each element run exposes a zero-based index via `atindex` (as a register), accessible inside the body as `this atindex` without affecting signature dispatch.

---

## 1. Syntax

### 1.1 In-place transform (no `to`)

```pyash
be <verb> ob <vector-ref> [from …] [other roles…] at all do
```

Examples:

```pyash
be invert ob name vector at all do
be plus    ob name vector from num 1 at all do
```

### 1.2 Map to a new vector (`to` present)

```pyash
be <verb> ob <vector-ref> [from …] [other roles…] to <target-ref> at all do
```

Examples:

```pyash
be invert ob name vector to name out at all do
be plus    ob name vector from num 1 to name out at all do
```

---

## 2. Shared semantics

Given an invoking sentence `S` containing `at all`:

1. Resolve `S.ob` to a vector `V` (length `n`).
2. For each index `i` in `0..n-1`:

   * Deep-clone the entire sentence `S` into `E`.
   * Overwrite only:

     * `E.ob = V[i]` (in your standard value form)
   * Execute the normal handler for `be <verb>` on `E`. `E.atindex` is set to `{ num: i, register: true }` and is available as a `this atindex` register inside ceremonies; it is ignored for signature derivation.
   * The per-element result value is `E.ob` after execution.

No other role fields are special-cased; they come from cloning `S`.

---

## 3. Output semantics

### 3.1 If `to` is present (map)

* Collect each per-element result into a new vector `Out`.
* Write `Out` to `S.to`.

### 3.2 If `to` is absent (in-place update)

* Collect each per-element result into a new vector `Out`.
* Write `Out` back into the original `S.ob` target **only if** `S.ob` is assignable (name or genitive lvalue).
* If `S.ob` is a literal vector (non-assignable), it is a runtime error (or compile-time error if detectable).

This keeps implementation simple (always build `Out`) and avoids per-element mutation complexity.

---

## 4. JavaScript compilation templates

Assumptions:

* Vectors are JS arrays at runtime.
* `structuredClone` exists (fallback: JSON clone if sentences are JSON-safe).
* `resolveVector(objRef)` resolves `S.ob` to a JS array value.
* `writeTarget(ref, value)` can write to a name or genitive target.
* `execVerb(be, sentence)` runs the existing verb handler.

### 4.1 Common mapping core

```js
const base = structuredClone(sentence);
const v = resolveVector(base.ob);

const out = v.map((elem, i) => {
  const s = structuredClone(base);
  s.ob = elem;
  s.atindex = { num: i };
  execVerb(s.be, s);
  return s.ob;
});
```

### 4.2 `to` present (map)

```js
{
  const base = structuredClone(sentence);
  const v = resolveVector(base.ob);

  const out = v.map((elem, i) => {
    const s = structuredClone(base);
    s.ob = elem;
    s.atindex = { num: i };
    execVerb(s.be, s);
    return s.ob;
  });

  writeTarget(base.to, out);
}
```

### 4.3 `to` absent (in-place update)

```js
{
  const base = structuredClone(sentence);
  const v = resolveVector(base.ob);

  const out = v.map((elem, i) => {
    const s = structuredClone(base);
    s.ob = elem;
    s.atindex = { num: i };
    execVerb(s.be, s);
    return s.ob;
  });

  // write back into the same target used for ob (name or genitive)
  writeTarget(base.ob, out);
}
```

---

## 5. Worked examples

### 5.0 Vector fill (repeat literal)

When declaring a vector with a single element, `by num N` repeats that element `N` times.

```pyash
exists su name doors ob ve bool lie by num 100 be vector ya
exists su name zeros ob ve num 0 by num 10 be vector ya
```

### 5.1 In-place: invert each element

Pyash:

```pyash
be invert ob name vector at all do
```

Note: In compiled JS, inside ceremony bodies only, a bare `to name` that matches a local fact binding can be used as sugar for `to num of ob of <name>` (interpreter still treats bare `to <name>` as a memory name lookup).

JS (explicit):

```js
{
  const base = structuredClone(sentence);
  const v = remember("vector");

  const out = v.map((elem, i) => {
    const s = structuredClone(base);
    s.ob = elem;
    s.atindex = { num: i };
    s.ob = invert(s.ob);        // or execVerb("invert", s)
    return s.ob;
  });

  store("vector", out);
}
```

### 5.2 Map: plus 1 into `out`

Pyash:

```pyash
be plus ob name vector from num 1 to name out at all do
```

JS (explicit):

```js
{
  const base = structuredClone(sentence);
  const v = remember("vector");

  const out = v.map((elem, i) => {
    const s = structuredClone(base);
    s.ob = elem;
    s.atindex = { num: i };
    s.ob = plus(s.ob, 1);        // or execVerb("plus", s)
    return s.ob;
  });

  store("out", out);
}
```

### 5.3 Single element (imperative)

You can mutate a single vector slot without `at all` by combining `at num` with a vector reference:

```pyash
ob name vector from num 5 at num 1 be plus do        # vector[1] += 5
ob num 3 from name vector at num 0 be subtract do   # vector[0] -= 3
```

Interpreter signatures recognize these shapes for `plus` and `subtract` and update the vector in place. Indexes are 0-based (JS-style).

---

## 6. Errors and guards

* `ob` must resolve to a vector.
* In the `to`-absent form, `ob` must be an assignable target (name or genitive). Otherwise error.

This spec keeps the compiler implementation minimal: one map core, then “store to `to`” vs “store back to `ob`”.
