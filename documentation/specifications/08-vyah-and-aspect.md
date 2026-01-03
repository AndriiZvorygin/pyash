# `08-vyah-and-aspect.md` (merged)

Merged specification file. Original sources:
- `08-vyah.md`
- `40-aspect.md`

---


## `08-vyah.md` (draft v1.1)

**Status:** draft (semantics locked, wording polish pending)

---

## 1. Purpose

This file defines **`vyah`**, the case used to carry **verb-phrase modifiers** in Pyash.

`vyah` allows a verb phrase to express **aspect, tense, outcome, and attitudinal information** without introducing wrapper sentences, hidden return channels, or secondary result objects.

This file defines only the **grammar, constraints, and ordering rules** of `vyah`.
Runtime behavior that depends on `vyah` (for example lifecycle success signaling) is defined in later specifications.

This chapter is the home for future `vyah`-based expansions (tense and other modifiers).

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
**Defined in:** `08-vyah-and-aspect.md` (Aspect section)

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
* If no aspect modifier is present, the **effective aspect** is `eval`
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
* They MAY be recorded in the newspaper
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

When a sentence is **emitted, stored, logged, or agained**, modifiers inside `vyah` MUST be written in the following **official order**:

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
* newspaper
* again
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
* Dispatch behavior is otherwise unchanged from the aspect rules in this file.

---

## 7. Determinism and again

For identical inputs and configuration:

* the set of modifiers in `vyah`
* their categorization
* their official output order
* their serialized sentence form

MUST be identical across implementations.

This guarantees stable newspaper records and again.

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


---

## `40-aspect.md` (draft v0.1)

**Status:** draft (semantics locked, wording polish pending)

## 1. Purpose

Define **aspect** in Pyash and specify how aspect controls **evaluation strategy** for verbs, especially for streaming, concurrency, and long-running pipelines.

Aspect is a grammatical marker that changes the view of an event. In Pyash it also selects the runtime contract: return a finished value, a running handle, or a stream of partials.

---

## 2. Aspect inventory

This table is the consolidated reference.

| Pyash aspect           | Plain English keyword | Human-language meaning                                    | Best programming analogue               |
| ---------------------- | --------------------- | --------------------------------------------------------- | --------------------------------------- |
| Perfective (`fa`)      | eval                  | Whole event as a single bounded unit                      | Run to completion, return a value       |
| Imperfective (`me`)    | stream                | Event viewed “from inside”: ongoing or evolving           | Stream of partials or updates           |
| Retrospective (`tyih`) | await                 | Looking back from a reference point; result now available | Wait on a handle, return the value      |
| Progressive (`pfih`)   | start                 | Action in progress                                        | Start work, return a handle immediately |
| Semelfactive (`swah`)  | emit                  | Single brief one-shot event                               | Emit one event (or one chunk)           |
| Prospective (`rwah`)   | schedule              | About to happen; later than reference time                | Schedule work to begin later            |
| Gnomic (`go`)          | rule                  | General truth; lawlike statement                          | Pure rule / invariant definition        |
| Inchoative (`za`)      | init                  | Begin a state; enter a condition                          | Initialise / start a service            |
| Completive (`mweh`)    | finish                | Bring action fully to completion                          | Flush/close/commit cleanly              |
| Cessative (`qa`)       | cancel                | Stop doing; cease a state                                 | Cancel/abort/stop                       |
| Delimitative (`dweh`)  | timebox               | Do for a while; bounded duration                          | Timebox with timeout                    |
| Telic (`tfeh`)         | goal                  | Has an inherent endpoint                                  | Goal-driven job completes when done     |
| Atelic (`lyeh`)        | loop                  | Open-ended activity, no endpoint                          | Long-running loop/daemon                |
| Momentane (`mreh`)     | step                  | Instantaneous punctual viewpoint                          | Atomic step                             |
| Habitual (`xi`)        | cron                  | Regular customary action                                  | Periodic job / cron                     |
| Continuative (`ta2`)   | status                | Still ongoing; continues to hold                          | Keepalive / still-running check         |
| Frequentative (`ra2`)  | poll                  | Repeated often; high frequency                            | Polling / repeated calls                |

**Normative note:**
For the current JavaScript implementation and all **Pyash English** surfaces (docs, module APIs, logs, error messages), use the **plain English aspect keywords** as the canonical written form. The Pyash aspect syllables (`fa`, `me`, `pfih`, etc.) are reserved for a future C-oriented internal representation and may be omitted from most English-facing specs until that layer exists.


**Default aspect:** if a verb phrase omits an aspect marker, interpret it as **perfective (`fa`)**, returning a **Value** (synchronous, blocking). 



---

## 3. Runtime primitives

Aspect selects among three runtime primitives.

### 3.1 Value

A finished result (or a structured error).

### 3.2 TaskHandle

A running job with lifecycle.

Minimum fields and operations:

* `handleId` (stable)
* `state` (`RUNNING | DONE | LOST | CANCELED | FAILED`)
* `traceId`
* `deadlineMs`
* operations: `wait`, `cancel`

### 3.3 Stream

An ordered sequence of chunks with lifecycle.

Minimum operations:

* `next`
* `close`
* `cancel`

---

## 4. Aspect as evaluation strategy

This section defines the default contract each aspect implies.

### 4.1 Core evaluation aspects

These three are the core contracts.

* **`fa` (do / perfective)**
  Evaluate now and return a **Value**.

* **`pfih` (start / progressive)**
  Start now and return a **TaskHandle**.

* **`me` (stream / imperfective)**
  Return a **Stream** of chunks (partials or updates).

### 4.2 Control and lifecycle aspects

These aspects primarily control existing work.

* **`tyih` (await / retrospective)**
  Wait on a **TaskHandle** and return a **Value**.

* **`mweh` (finish / completive)**
  Close/flush a **Stream** or finalise a **TaskHandle** cleanly; return a **Value** status.

* **`qa` (cancel / cessative)**
  Cancel a **Stream** or **TaskHandle**; return a **Value** status.

* **`dweh` (timebox / delimitative)**
  Execute under a timebox; if timebox expires, cancel; return partial + status as a **Value** or **Stream** (see §6.3).

### 4.3 Scheduling and repetition aspects

* **`rwah` (schedule / prospective)**
  Schedule work to begin in the future; return a **TaskHandle** for the scheduled job.

* **`xi` (cron / habitual)**
  Create a recurring schedule; return a **TaskHandle** for the schedule.

* **`ra2` (poll / frequentative)**
  Repeated often; may return a **Stream** of events or a **TaskHandle** controlling the repetition policy.

### 4.4 State and classification aspects

* **`za` (init / inchoative)**
  Enter a running state (start service); return a **TaskHandle**.

* **`ta2` (status / continuative)**
  Still ongoing check; return a **Value** snapshot (status).

* **`tfeh` (goal / telic)**
  Classified as goal-terminated work; typically returns **Value** (`fa`) or **TaskHandle** (`pfih`) that ends by itself.

* **`lyeh` (loop / atelic)**
  Classified as open-ended work; typically returns **TaskHandle** (`pfih`) or **Stream** (`me`) and ends via `mweh` or `qa`.

* **`go` (rule / gnomic)**
  Pure rule/invariant; returns a **Value** deterministically.

* **`mreh` (step / momentane)** and **`swah` (emit / semelfactive)**
  Single-step or one-shot event; returns a **Value** or a one-chunk **Stream**.

---

## 5. Deterministic return typing rule

Unless a module states otherwise, return type is determined by aspect:

* `fa` → Value
* `pfih` → TaskHandle
* `me` → Stream
* `tyih` → Value (requires TaskHandle input)
* `mweh` → Value status (requires Stream or TaskHandle input)
* `qa` → Value status (requires Stream or TaskHandle input)

If a verb is invoked with an aspect that the verb does not support, the runtime must return a structured error.

---

## 6. Standard envelopes

### 6.1 Status Value envelope

A Value status should use a standard map:

* `ok` (bool)
* `traceId` (text)
* `retryable` (bool)
* `error.kind` (text) if `ok:false`
* `error.message` (text) if `ok:false`

### 6.2 Stream chunk envelope

A Stream yields chunks with:

* `seq` (integer, monotonic increasing from 0)
* `tMs` (integer, optional)
* `payload` (any)
* `final` (bool)

### 6.3 Lifecycle guarantees

* `mweh` on a Stream guarantees either:

  * a final chunk with `final:true`, or
  * a Value status indicating `closed:true`
* `qa` guarantees a terminal status within `deadlineMs` (or a timeout error if the backend is lost)
* If a backend can only do one-shot, `me` may be emulated as a one-chunk stream with `final:true`

---

## 7. Aspect in signature dispatch

Aspect participates in signature dispatch as part of the verb form.

Same stem, different aspect can select a different contract:

* `be hear fa …` returns Value (one-shot STT)
* `be hear me …` returns Stream (partial transcripts)
* `be hear pfih …` returns TaskHandle (capture job)

Modules should list supported aspects per exported verb.

---

## 8. Example: `audio` module façade

Illustrative.

### 8.1 Canonical verbs

* `be hear fa …` → one-shot STT (Value text or Value map)
* `be hear me …` → streaming STT (Stream of partial transcripts)
* `be say fa …` → one-shot TTS (Value with bytes or file path)
* `be say me …` → streaming TTS (Stream of audio frames)
* `be hear pfih …` → start capture (TaskHandle)
* `be say pfih …` → start synthesis (TaskHandle)
* `be … tyih …` → wait on handle (Value)
* `be … mweh …` → flush/close (Value status)
* `be … qa …` → cancel (Value status)

### 8.2 Backend contract (internal)

Backends may be implemented via local tools, MCP, HTTP, or anything else.

Each backend provides one or more of:

* `call(requestMap) -> resultMap`
* `stream(requestMap) -> chunkStream`
* `cancel(handleId) -> statusMap`

The module normalizes backend responses into the standard envelopes in §6.

---

## 9. Why this supports long pipelines

* News crawler: `crawl me` yields pages, `summarize me` yields bullets, `publish fa` posts once.
* Walkie-talkie: `hear me` yields partials, dispatch mid-stream, `say me` streams audio back, `qa` cancels instantly.

---

## 10. Conformance

An implementation conforms to this spec if it:

* recognizes the aspects in §2
* enforces the return typing rule in §5
* implements envelopes and lifecycle rules in §6
* treats aspect as part of signature dispatch per §7
