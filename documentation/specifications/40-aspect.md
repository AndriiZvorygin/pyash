# `40-aspect.md` (draft v0.1)

**Status:** draft (semantics locked, wording polish pending)

## 1. Purpose

Define **aspect** in Pyash and specify how aspect controls **evaluation strategy** for verbs, especially for streaming, concurrency, and long-running pipelines.

Aspect is a grammatical marker that changes the view of an event. In Pyash it also selects the runtime contract: return a finished value, a running handle, or a stream of partials.

---

## 2. Aspect inventory

This table is the consolidated reference.

| Pyash aspect           | Plain English keyword | Human-language meaning                                    | Best programming analogue               |
| ---------------------- | --------------------- | --------------------------------------------------------- | --------------------------------------- |
| Perfective (`fa`)      | do                    | Whole event as a single bounded unit                      | Run to completion, return a value       |
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

**Normative note:** Docs and module APIs should prefer the Pyash aspect forms (`fa`, `me`, `pfih`, etc.). The plain English keyword is for learning, logs, and error messages.

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
