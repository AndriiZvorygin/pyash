# `09-runtime-primitives.md` (draft v1.2)

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

`vyah` modifier rules (including `sloh`) are defined in `08-vyah.md`.
Aspect inventory and meaning are defined in `40-aspect.md`.

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

Error vocabulary and sentence conventions are defined in `06-errors.md`.

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

`su name <stream> atindex num <n> ob <type> <literal> as name <final|notfinal> be chip ya`

Examples:

`su name S3 atindex num 0 ob text "he" as name notfinal be chip ya`  
`su name S3 atindex num 1 ob text "llo" as name final be chip ya`

### 7.3 Rules

* `atindex` starts at `0` and increases by `1`
* ordering is determined solely by `atindex`
* at most one chip MAY be marked `final`
* a `final` chip implies the stream transitions to `done`

### 7.4 Pulling chips (stream consumption)

Pulling the next output from a stream is done by evaluating the verb `chip` with the stream name in `su`.

Input form:

`su name <stream> vyah eval be chip ya`

Output:

* on success: a chip sentence, and MUST include `vyah eval sloh`
* on failure: an error sentence

Notes:

* The last chip MUST be marked `final`.
* After a `final` chip, the stream is considered `done`.
* Calling `chip` again after the final chip MUST raise an error sentence (chip exhausted).

Example success:

`su name S3 atindex num 0 ob text "he" as name notfinal vyah eval sloh be chip ya`

Example after exhaustion:

`su name done ob text "stream is done" from name runtime be error ya`

(Exact error naming is per `06-errors.md`; the requirement is that it is an error sentence.)

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
