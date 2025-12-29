
# `08-vyah.md` (draft v1.1)

**Status:** draft (semantics locked, wording polish pending)

---

## 1. Purpose

This file defines **`vyah`**, the case used to carry **verb-phrase modifiers** in Pyash.

`vyah` allows a verb phrase to express **aspect, tense, outcome, and attitudinal information** without introducing wrapper sentences, hidden return channels, or secondary result objects.

This file defines only the **grammar, constraints, and ordering rules** of `vyah`.
Runtime behavior that depends on `vyah` (for example lifecycle success signaling) is defined in later specifications.

---

## 2. The `vyah` case

### 2.1 Definition

`vyah` is a **first-class sentence case**.

A sentence MAY contain **zero or one** `vyah` case.

The value of `vyah` is an **ordered vector of atomic verb modifiers**.

Example:

```
be hear do su name L7 vyah cancel sloh ya
```

---

### 2.2 Vector semantics

Conceptually:

```
vyah = ["cancel", "sloh"]
```

Surface form:

```
vyah cancel sloh
```

Modifiers are **symbols** (not `name`, `text`, or structured values).

---

## 3. What `vyah` may contain

Modifiers in `vyah` fall into **five categories**, ordered below by **importance and runtime relevance**.

---

### 3.1 Aspect modifiers (highest priority)

**Status:** required for execution
**Defined in:** `40-aspect.md`

Aspect modifiers determine **how the event is evaluated in time** and **which runtime contract applies**.

Examples include:

```
eval, start, stream,
await, finish, cancel,
schedule, cron, poll,
init, status, rule,
emit, step
```

#### Rules (normative)

* `vyah` MAY contain **zero or one** aspect modifier
* If more than one aspect modifier is present, the sentence is invalid
* If no aspect modifier is present, the **effective aspect** is `do`
* The effective aspect participates in **signature derivation and dispatch**

---

### 3.2 Tense / temporal modifiers

**Status:** important, policy-bearing
**Defined in:** `41-tense.md`

Tense modifiers express **temporal anchoring intent**, not concrete timestamps.

Examples include:

```
now, past, future,
today, yesterday, recent,
long_ago, soon, far_future,
tomorrow
```

#### Rules

* Tense modifiers do **not** participate in dispatch
* Tense modifiers MAY desugar into explicit temporal noun phrases
* Tense expresses programmer intent and default policy

---

### 3.3 Outcome modifiers (runtime-significant)

**Status:** minimal and strictly defined

Currently defined outcome particle:

| Modifier | Meaning                          |
| -------- | -------------------------------- |
| `sloh`   | explicit success acknowledgement |

#### Rules (normative)

* `sloh` MAY appear only inside `vyah`
* `sloh` MUST NOT appear on an error sentence (`be error … ya`)
* Lifecycle aspects (`await`, `finish`, `cancel`) MUST include `sloh` on success
* Absence of `sloh` does **not** imply failure

Outcome modifiers:

* do **not** affect dispatch
* do **not** alter verb meaning
* exist solely for observable success signaling

---

### 3.4 Attitudinal / emotional modifiers

**Status:** allowed, non-normative

`vyah` MAY include emotional or attitudinal modifiers, including (non-exhaustive):

```
satisfied, success, hope, doubt, fear, love, anger,
curious, enthusiasm, patience, wonder, despair, pride,
equanimity, melancholy, joy, shame, surprise
```

#### Rules

* These modifiers are **annotations only**
* They MUST NOT affect execution, dispatch, or control flow
* They MAY be recorded in logs or journals
* Semantics are undefined unless a later spec assigns them

---

### 3.5 Other verb modifiers (reserved)

**Status:** reserved for future grammar

This category includes:

* modality-like markers
* stylistic or rhetorical markers
* future grammatical extensions

No semantics are assigned unless explicitly specified elsewhere.

---

## 4. Ordering rules

### 4.1 Input order

The **input order** of modifiers inside `vyah` is **free**.

All of the following are valid inputs:

```
vyah sloh cancel
vyah cancel sloh
vyah satisfied cancel sloh
```

---

### 4.2 Official output order

When a sentence is **emitted, stored, logged, or replayed**, modifiers inside `vyah` MUST be written in the following **official order**:

1. **Aspect modifiers**
2. **Tense / temporal modifiers**
3. **Other verb modifiers**
4. **Outcome modifiers** (`sloh`)
5. **Attitudinal / emotional modifiers**

Example (official form):

```
vyah cancel past sloh satisfied
```

This ordering is required for:

* deterministic output
* journaling
* replay
* cross-implementation parity

---

## 5. Relationship to other grammatical systems

### 5.1 Mood (out of scope)

Mood expresses **clause force** (assertion, command, question, hypothesis, etc.).

Mood is defined elsewhere and MUST NOT appear in `vyah`.

---

### 5.2 Topic and focus (out of scope)

Topic and focus are **noun-phrase concerns** and MUST NOT appear in `vyah`.

---

### 5.3 Evidentiality and certainty (out of scope)

Truth strength, evidence source, and certainty level MUST live in a **dedicated case**, not `vyah`.

---

## 6. Signature and dispatch implications

* The **effective aspect** (from `vyah`, or default `do`) participates in **signature derivation**
* Only the aspect modifier affects dispatch
* All other `vyah` modifiers are ignored for dispatch purposes
* Dispatch behavior is otherwise unchanged from `40-aspect.md`

---

## 7. Determinism and replay

For identical inputs and configuration:

* the set of modifiers in `vyah`
* their categorization
* their official output order
* their serialized sentence form

MUST be identical across implementations.

This guarantees stable logging, journaling, and replay.

---

## 8. Conformance

An implementation conforms to this specification if it:

* recognizes `vyah` as a first-class sentence case
* enforces **at most one aspect modifier**
* accepts modifiers in any input order
* emits modifiers using the official ordering in §4.2
* enforces `sloh` rules in §3.3
* does not assign semantics to emotional modifiers unless specified elsewhere

---

**End of `08-vyah.md`.**
