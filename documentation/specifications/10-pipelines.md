# `10-pipelines.md`

Merged specification sources (legacy IDs):
- 14-refinery
- 34-re-entry-cycle
- 34-translation

---

# Refinery (v0.1)

**Status:** v0.1

---

## 1. Purpose

Define refinery execution: a runner-controlled way to execute a set of named steps (series entries) with explicit depend lists, using normal Pyash sentences as the activity for each step.

This spec exists to make multi-step runs:

deterministic across interpreter / JS / C

verifiable to run again when again mode is enabled

compatible with duties, streams, chips, exchange, artifacts, and run newspaper

Refinery execution is a **runner policy** in v0.1: the runner may execute a refinery
after it finishes interpreting the program body. Refinery execution is not yet a
first-class sentence inside the program.


This spec defines:

- refinery declaration form
- series entry form
- depend rules and deterministic scheduling
- failure policy
- interaction with run newspaper and again mode
- compatibility notes for workflow files and approval gates
- series-based pipeline compatibility for workflow files



---

## 2. Terms

refinery — a named collection of series entries executed by a runner

platform — one named unit of refinery work (a series entry)

activity — the sentence the runner evaluates for a platform (the series entry itself)

depend — a platform name that MUST complete before another platform may start

already platform — a platform whose depend list is complete

again mode — runner policy that requires recording and verification sufficient to run again (see 05-run-recording-and-artifacts.md)

runner policy — behavior controlled by the runner (CLI/config), not by in-program
sentences. Examples: selecting which refinery to run, and when to print results.

propositive mood — `propose` mood used for approval gates; MUST halt execution until an explicit decision is provided



---

## 3. Global invariants (normative)

1. Deterministic scheduling
For the same refinery definition and inputs, the order of platform execution MUST be deterministic.


2. No hidden semantics
The runner MUST NOT rewrite platform activities. Activities are evaluated as normal Pyash sentences.


3. Definition does not execute activities
A refinery definition is declarative: series entries inside the refinery block are not executed at definition time. They are executed only when the runner runs the refinery.


4. Newspaper is optional
If run newspaper emission is disabled, refinery evaluation results MUST be the same; only recording changes.


5. Again mode is stricter
In again mode, refinery execution MUST satisfy the recording and verification rules in 05-run-recording-and-artifacts.md.

Checkpoint and retry records are emitted into the run newspaper per `05-run-recording-and-artifacts.md` when enabled.




---

## 4. Reserved verbs (normative)

The words refinery and platform are reserved for refinery declarations and MUST NOT dispatch as ordinary ceremonies.

be refinery def … prah is a declaration form.

Series entries inside a refinery are normal sentences with `su name` and optional `from ve name ...` depend lists.


If an implementation supports user-defined ceremonies named refinery or platform, that support MUST be gated off while parsing refinery blocks (the declaration meaning wins inside the refinery).

The propositive mood (`propose`) is reserved for approval gates when a refinery runner or workflow runner is active.


---

## 5. Refinery declaration (official)

A refinery is declared using a def / prah block.

### 5.1 Form

A refinery is declared as:

su name <refinery> be refinery def

followed by one or more series entries

ending with prah


The refinery name <refinery> is a su name identifier.

### 5.2 Multiple refineries

A file MAY declare more than one refinery. Selecting which refinery to run is a runner policy (outside this spec).

### 5.3 Runner invocation (deprecated)

Older runners may execute a refinery **after** the program body finishes by selecting
it via CLI/config. This mode is **deprecated**.

If this legacy mode is used:

* The program itself cannot run additional sentences after refinery completion.
* The refinery result is returned to the runner, which decides whether and how to print it.

New code should invoke refineries inline using `be refinery do` (see §5.4).

---

## 5.7 Propositive approval gate (draft v0.1)

Propositive mood (`propose`) is the Pyash-native approval gate for deterministic workflows.

### 5.7.1 Sentence form

Use any sentence that would otherwise be executed, but in `propose` mood.

Minimal prompt-only form:

```
ob text "<prompt>" be command propose
```

Optional storage of a decision:

```
ob text "<prompt>" to name text <decision> be command propose
```

### 5.7.2 Required behavior

* A `propose` gate MUST halt execution when evaluated in a runner workflow or refinery runner.
* The runner MUST emit a structured approval request that includes:
  - prompt text
  - a resume token
  - the decision field name (if provided)
* Execution MUST NOT continue until a resume action supplies an explicit decision.

#### 5.7.2.1 Surfaced sentence (normative)

When a runner encounters a `propose` gate, it MUST surface a `be ratify do`
sentence (not `be propose ya`). The surfaced sentence MUST include:

* `su name <platform>` — the evoking sentence subject name
* `ob text "<prompt>"` — prompt text (direct or resolved)
* `from name <refinery>` — refinery or workflow name
* `accordingto name "resume token"`
* `fromtext text "<resume-token>"`
* optional `to name <decision>` if the evoking sentence provided a decision field

This surfaced sentence is recorded in the run newspaper like any other result.

### 5.7.3 Resume (draft)

Resume is a runner command (not an in-language verb) that accepts a resume token and decision.
Implementations MAY expose an inline verb, but the runner command is the compatibility target.

Minimal contract:

* decision values: `truth` / `lie`
* resume continues at the next stage after the `propose` gate

#### 5.7.3.1 Resume sentence (normative)

The decision is expressed as a boolean. A compatible surfaced decision sentence is:

```
su name <platform>
ob bool truth|lie
be ratify ya
totext text "<raw input>"
accordingto name "resume token"
fromtext text "<resume-token>"
```

Runners MAY accept equivalent decision payloads, but MUST interpret `truth` as
approve/continue and `lie` as decline/stop.

### 5.7.4 Resume token (draft)

The resume token MUST be derivable from the run newspaper and SHOULD include:

* run id
* sentence id (or platform index) of the `propose` gate
* refinery/workflow name
* decision field name (if provided)

The run newspaper is the canonical state store for resumption.

---

## 5.8 Workflow file compatibility (draft v0.1)

Workflow files (`.json`, `.yaml`, `.yml`, `.lobster`) MUST be treated as **sources**
that are converted into Pyash structures using existing JSON/YAML import rules.
Pyash remains the canonical in-language form.

### 5.8.1 Workflow shape

Workflow files map to a Pyash map with these top-level keys:

* `name` (text, optional)
* `steps` (vector of maps, required)
* `env` (map, optional)
* `cwd` (text, optional)

Each step map MAY contain:

* `id` (text, required)
* `command` (text, required) — a sentence string
* `stdin` (text, optional) — references prior step output
* `env` (map, optional)
* `cwd` (text, optional)
* `condition` (text, optional) — boolean expression against prior results
* `approval` (text, optional) — when `"required"`, insert a ratification gate

### 5.8.2 Conversion rules

1. Load JSON/YAML into a Pyash json map def (per `06-data-formats.md`).
2. Emit optional prelude entries before steps:
   * `cwd` becomes a go step: `be go to filename "<cwd>" do`
   * `env` becomes ecology facts in the series (one per key), e.g.:
     `su name <key> ob text "<value>" be ecology ya`
3. Convert each step into a platform activity sentence:
   * `command` is parsed into a sentence and used as the series entry body (no `ob la ... ko` wrapper).
   * `approval: required` injects a `propose` gate activity.
4. `stdin` is expanded as a subordinate clause on the activity sentence.
5. Step-level `env` becomes ecology facts with the step prefix:
   `su name <step-id> env <key> ob text "<value>" be ecology ya`
6. `condition` determines whether the platform is scheduled (runner policy). When
   a condition references `$<step>.approved`, the series form MAY emit:
   `ob text "truth" from name <step> approved be remains do` followed by
   `ob text "truth" be then then` to gate the next step.

This conversion is deterministic and reversible via the json map representation.

---

## 5.9 Series pipeline compatibility (draft v0.1)

Workflow files MAY also be represented as a Pyash **series** of command sentences.
This is a lightweight, Pyash-native representation for simple pipelines.

### 5.9.1 Shape

```
su name <workflow> be series def
su name <step-id> ob text "<command>" be command ya
su name <step-id> ob text "<command>" fromtext text of <prior-step> stdout be command ya
su name <step-id> ob text "<command>" be command propose
su name <workflow> prah
```

Rules:

* The series name is the workflow name.
* Each step is a `be command` sentence using `su name <step-id>`.
* When a step consumes prior output, it uses `fromtext text of <prior-step> stdout` (or another canonical reference).
* Approval gates are expressed by using the **propositive mood** (`propose`) on a command sentence.

### 5.9.2 Resume token binding

When a `propose` step is encountered in a series pipeline:

* the resume token MUST reference the series name and the step index
* the runner MUST resume at the next step after the proposed one
* the run newspaper is the canonical state store

### 5.9.3 Conversion from workflow files

If the workflow file includes `approval: required`, the step becomes:

```
su name <step-id> ob text "<prompt>" be command propose
```

If the workflow file includes `stdin`, it becomes `fromtext text of <prior-step> stdout` in the series form.

---

## 5.4 Inline refinery execution (v0.1)

Inline refinery execution is the **default** and **recommended** invocation model.
It runs a refinery inside the program as a normal verb, enabling post-refinery logic
and programmatic access to the result.

### Sentence form

```
ob text "<input>" to name text <output> be refinery do
```

Optional refinery selector:

```
ob text "<input>" from name <refinery> to name text <output> be refinery do
```

If `from name <refinery>` is omitted, the runtime SHOULD read the refinery name
from memory (`su name refinery name ob text "<name>" be text ya`).

#### Optional input

`ob` is optional. A minimal inline invocation uses only the refinery selector:

```
from name <refinery> be refinery do
```

If both `ob` and `from name` are omitted, the runtime MUST resolve the refinery
name from memory and run that refinery.

Note: the surface form is `from name <refinery>` (a name). Do not write
`from name text`; that is only an internal signature typing detail.

### Input binding

If `ob` is provided, the runtime SHOULD bind the input into memory as:

```
su name input ob text "<input>" be text ya
```

so platform activities can read `input` normally. The binding MAY be temporary;
implementations SHOULD restore a prior `input` value if it existed.


### Result

The inline call behaves like a normal verb:

* it stores the final refinery result into the `to` target
* it writes the `result` fact
* errors surface normally and terminate execution unless handled

Inline refinery execution is the canonical path; runner-level invocation exists only
for backward compatibility.

### Provider substitution (`be write for name ...`)

Callers SHOULD keep one stable shape and swap providers by changing helper config:

```pyash
exists su name helper be mind as name "qwen3-vl:8b-instruct" ya
ob text "Task." for name helper to name text output be write do
```

```pyash
exists su name helper be mind as name "review loop" ya
ob text "Task." for name helper to name text output be write do
```

Required behavior:

* Dispatch remains signature-first.
* If a `mind` helper has `as name <refinery>` and that refinery is registered,
  `be write for name <helper>` MUST route to refinery execution.
* Caller sentence shape MUST remain unchanged.

### Refinery discharge

`discharge` MUST support explicit refinery teardown:

```pyash
be discharge as wo refinery ob text "review loop" do
```

Required behavior:

* Remove the refinery definition from the active refinery registry.
* Invalidate helper aliases bound to that refinery provider:
  - `be refinery as name "<refinery>"`
  - `be mind as name "<refinery>"`
* Return `by num <N>` where `N` is the number of invalidated aliases.

---

## 5.5 Report extraction contract (v0.1)

This section defines a deterministic report extracted from the run newspaper
plus referenced artifacts. The report is derivable and optional. **Status: v0.1**.

### Report name + ordering

The report is emitted as a single Pyash file (suggested: `report.pya`) with a
canonical ordering. A report is a linear list of sentences in this order:

1. Run header
2. Run root + environment
3. Platform outcomes (sorted by platform name, then start order)
4. Mind/tool calls (sorted by appearance in the newspaper)
5. Failures (sorted by appearance)
6. Artifacts (sorted by appearance)
7. Footer (end marker)

### Required fields (minimal)

**Run header**

- `run id` (string)
- `run time` (RFC 3339 text)
- `run root` (filename)

**Platform outcomes**

For each platform execution:
- `platform name`
- `platform order` (1-based, execution order)
- `platform activity` (embedded sentence)
- `platform result` (embedded sentence)
- `platform status` (`ok` | `error`)

**Mind calls**

For each mind request/response:
- `mind name`
- `mind label` (`request` | `response` | `empty-response` | `error`)
- `mind map` (json map def name)
- `mind order` (1-based, appearance order)

**Tool calls**

For each tool event (tool request + result):
- `tool name`
- `tool order` (1-based, appearance order)
- `tool event` (embedded event sentence)

**Failures**

For each error:
- `error name`
- `error sentence` (embedded sentence)
- `error order` (1-based, appearance order)

**Artifacts**

For each artifact:
- `artifact id`
- `artifact kind`
- `artifact origin` (embedded sentence, if available)
- `artifact order` (1-based, appearance order)

### Canonical sentence shapes

Report data MUST be emitted as json map def blocks, one block per report item.
This keeps the report single-sentence per line while preserving multiple fields.

```
su name report header be json map def
su name run id ob text "<id>" ya
su name run time ob text "<time>" ya
su name run root ob filename "<root>" ya
su name report header prah

su name platform outcome 1 be json map def
su name platform name ob name <platform> ya
su name platform order ob num 1 ya
su name platform activity ob la <sentence> ko ya
su name platform result ob la <sentence> ko ya
su name platform status ob text "ok" ya
su name platform outcome 1 prah

su name mind call 1 be json map def
su name mind name ob name <mind> ya
su name mind label ob text "request" ya
su name mind map ob name <map-name> ya
su name mind order ob num 1 ya
su name mind call 1 prah

su name tool call 1 be json map def
su name tool name ob name <tool> ya
su name tool order ob num 1 ya
su name tool event ob la <sentence> ko ya
su name tool call 1 prah

su name failure 1 be json map def
su name error name ob name <error> ya
su name error sentence ob la <sentence> ko ya
su name error order ob num 1 ya
su name failure 1 prah

su name artifact entry 1 be json map def
su name artifact id ob text "<hash>" ya
su name artifact kind ob text "<kind>" ya
su name artifact origin ob la <sentence> ko ya
su name artifact order ob num 1 ya
su name artifact entry 1 prah
```

The report ends with:

```
su name report end be report ya
```

Implementations MAY include additional report entries, but MUST preserve the
canonical ordering and required fields above.

### Extraction interfaces (non-normative)

Implementations may expose report extraction via:

- CLI (`node command/extract_report.mjs --run-id <id>`)
- Inline verb (`be reporter do`) that reads the current run's newspaper buffer
  or the on-disk newspaper when present.

---

## 5.6 Error sieve (draft v0.1)

The error sieve is a deterministic process that shrinks a failing program or
run into a minimal `.pya` reproduction while preserving the failure.

### Purpose

* produce the smallest repro that still fails
* enable deterministic debugging and regression tests
* emit a reduction report that references the original run

### Inputs

* original program source (`.pya`) or run newspaper
* a verifier action that returns PASS/FAIL (or error/success)
* optional constraints (minimum sentences, keep module imports, etc.)
* `atmost num` — maximum number of reduction attempts

### Required behavior

1. **Deterministic selection**
   The same input and verifier must produce the same minimized output.

2. **Monotonic shrinking**
   The reducer only removes or simplifies sentences; it does not invent new
   program content.

3. **Failure preservation**
   A reduction step is accepted only if the verifier still fails.

4. **Recorded trace**
   Each reduction step is recorded in the run newspaper when enabled.

### Output

* `repro.pya` — minimized failing program
* `report.pya` — reduction report (optional, derived from newspaper)

### Minimal example (conceptual)

```
su name error sieve demo be refinery def
su name reduce ob name source to name output be error sieve do
prah
```

This spec defines the reducer loop at a high level; an implementation may
introduce an inline `be error sieve do` verb or a runner policy in a future revision.

---

## 5.7 Success sieve (draft v0.1)

The success sieve is a reduction process that shrinks a *passing* program or
run into a minimal `.pya` reproduction while preserving success criteria.

Unlike the error sieve, success preservation may require a judgment step when
outputs are stochastic (e.g., mind responses). Implementations MAY use an LLM
judge to evaluate equivalence or success.

### Purpose

* produce the smallest example that still **passes**
* enable compact “golden” examples for docs and regression tests
* preserve behavioral equivalence when exact output matching is unreliable

### Inputs

* original program source (`.pya`) and an optional clone file (working copy)
* a success verifier:
  - deterministic check (exit code, exact output match, structured facts), or
  - a judge policy (LLM or heuristic) that returns PASS/FAIL
* optional constraints (minimum sentences, keep module imports, fixed seeds)
* `atmost num` — maximum number of reduction attempts

### Required behavior

1. **Deterministic selection**
   Given the same input, verifier, and judge policy, the reducer must produce
   the same minimized output. If an LLM judge is used, the judge prompt and
   decision MUST be recorded.

2. **Monotonic shrinking**
   The reducer only removes or simplifies sentences; it does not invent new
   program content.

3. **Success preservation**
   A reduction step is accepted only if the verifier still passes. When a
   judge is used, the judge decision MUST be PASS for acceptance.

4. **Recorded trace**
   Each reduction step and verdict is recorded in the run newspaper when
   enabled, including the judge payload and verdict if applicable.

### Output

* `repro.pya` — minimized passing program
* `report.pya` — reduction report (optional, derived from newspaper)

### Minimal example (conceptual)

```
su name success sieve demo be refinery def
su name reduce ob name source to name output be success sieve do
prah
```

This spec defines the reducer loop at a high level; an implementation may
introduce an inline `be success sieve do` verb or a runner policy in a future revision.


---

## 6. Series entry (official)

Each platform is declared by a single **series entry** sentence inside the refinery block.

### 6.1 Series entry form

A series entry is a normal sentence with:

su name <platform> (required)

from ve name <dep0> <dep1> ... (optional depend list)

<activity sentence> (required; the rest of the sentence)

Rules:

<platform> is the platform name (unique within the refinery).

The depend list is carried in from ve name ... as a vector of platform names.

When this spec says “previous step”, it refers to the **su name** of any
preceding step in the series (not necessarily the immediately preceding line).

The activity is the sentence itself (no ob la … ko wrapper). The runner MUST preserve the sentence when recording.

### 6.2 Uniqueness

Platform names within a refinery MUST be unique. Duplicate platform names are an error.

### 6.3 Examples

Platform with no depend list:
su name parse ob text "data/input.csv" be load do

Platform that depends on parse:
su name compile from ve name parse ob text "ok" be write do


---

## 7. Scheduling and execution (normative)

### 7.1 Depend satisfaction

A platform is eligible to start when all depend names listed in its from ve name ... vector are complete.

Depend names refer to platform names in the same refinery.

### 7.2 Deterministic selection among already platforms

If more than one platform is already at the same time, the runner MUST choose the next platform by this ordering:

1. sort by platform name using official name ordering


2. if still tied (should not occur in valid refineries), use refinery declaration order



Official name ordering is the same ordering used when writing maps by sorted su switches (see the official JSON key order rule in `06-data-formats.md`).

### 7.3 Single-worker default

This v0.1 spec defines refinery execution as single-worker and sequential:

the runner starts one platform at a time

the runner waits for the platform activity evaluation to produce an observable result sentence before starting the next platform


A future spec MAY plus parallel execution, but MUST preserve deterministic ordering (for example by limiting concurrency to platforms chosen in the deterministic already order).

### 7.4 What “platform completes” means

A platform completes when evaluation of its activity yields an observable outcome:

success: a normal ya result sentence

failure: a surfaced error sentence be error ya (see 02-core-execution.md)


If an activity returns a duty/stream/chip sentence (see 04-runtime-primitives.md), that is still an observable ya outcome and counts as platform completion. Lifecycle control of duties/streams is performed only if explicitly expressed by later activities (for example an await platform).

If an activity yields no explicit result sentence, the runner MAY record the activity sentence itself as the result event (same fallback used by the main run loop).

### 7.5 Retries and checkpoints

Retries and checkpoints are runner policy features and MUST NOT change evaluation semantics.

Retry policy (default values are set in `configure/default.pya`):

- `su name reiterate delay ob num <ms> ya`
- `su name reiterate backoff ob num <factor> ya`
- `su name reiterate attempts ob num <count> ya`
- `su name reiterate cap ob num <ms> ya`

On surfaced error from a platform, the runner MAY retry the activity up to `attempts`.
Each retry MUST emit a surfaced `be reiterate ya` sentence to the newspaper.

Checkpoint policy:

- Checkpointing is enabled by default and can be disabled by runner flag (`--no-checkpoint`).
- Runners in compiled JS/C use `PYA_CHECKPOINTS` to seed checkpoint reuse and `PYA_NO_CHECKPOINT=1` to disable checkpointing.
- Each successful platform MAY emit a surfaced `be checkpoint ya` sentence to the newspaper.

Checkpoint identity is derived from the platform activity sentence plus its dependent results.


---

## 8. Reiterate (retry) (official)

Platforms may be retried when an activity yields a surfaced error sentence (be error ya).

Retry behavior is per-platform and MUST NOT restart already completed platforms.

### 8.1 Configuration

Retry parameters are read from `configure/default.pya` (ya facts):

su name reiterate delay ob num <ms> be number ya
su name reiterate backoff ob num <factor> be number ya
su name reiterate attempts ob num <count> be number ya
su name reiterate cap ob num <ms> be number ya

Defaults (when no config exists): 250ms delay, backoff ×2, max attempts 5, max delay 8000ms.

### 8.2 Retry recording

Each retry attempt MUST be recorded in the newspaper as:

su name <platform> by num <attempt> ob text "<message>" from name <refinery> be reiterate ya

Attempt numbers are 1-based. The message is derived from the surfaced error text when available.


---

## 9. Checkpoints (official)

Refinery runners SHOULD reuse prior platform results (checkpoints) when available.

Checkpoints are automatic by default and can be disabled by runner flag (for example --no-checkpoint).

### 9.1 Checkpoint hash

The checkpoint key is derived from:

1) the platform’s action sentence (as text)
2) the dependent platform result sentences (as text), ordered by official name ordering

If any dependency result changes, the checkpoint MUST NOT be reused.

### 9.2 Checkpoint recording

When a platform completes (or a checkpoint is reused), the runner MUST record:

su name <platform> ob text "<hash>" from name <refinery> to la <result> ko be checkpoint ya

The result is the sentence that would have been emitted as the platform’s outcome.


---

## 8. Failure policy (v0.1)

The refinery failure policy in v0.1 is fail-fast:

if any platform completes with be error ya, the refinery MUST stop and the refinery result is that error sentence

platforms not yet started are not executed


A future spec MAY plus “continue” policies, but fail-fast is the official default.


---

9. Interaction with run newspaper

9.1 When newspaper is enabled

When run newspaper emission is enabled, the runner SHOULD record:

an evoke record for each platform activity it evaluates (see 05-run-recording-and-artifacts.md)

the resulting result record sentence (success or be error ya)

any state, artifact, and exchange sentences produced during evaluation (per their specs)


9.2 When newspaper is disabled

When run newspaper emission is disabled:

the runner MUST still execute the same platforms in the same deterministic order

no newspaper records are required



---

10. Again mode requirements (normative)

When again mode is enabled:

1. Newspaper emission MUST be enabled.


2. Any exchange/artifact activity that affects results MUST be recorded per 05-run-recording-and-artifacts.md.


3. Again-critical artifacts MUST include sha256 hashes.


4. Running again MUST verify hashes and MUST fail on inconsistency.



Again mode MUST NOT change evaluation semantics. It only strengthens recording and verification.


---

11. Errors

Refinery definition and scheduling errors MUST follow 02-core-execution.md:

thrown as be error do

surfaced as be error ya at observation boundaries


Recommended stable error names for this spec (plus to 02-core-execution.md if not already present):

refinery defective

platform defective

depend defective



---

12. Conformance

An implementation conforms to this spec if it:

parses refinery def / prah blocks

parses series entries with su name and optional from ve name ...

treats refinery and platform as reserved declaration verbs inside refinery declarations

executes platforms in deterministic order using the official tie-breaker (§7.2)

applies the v0.1 fail-fast policy (§8)

integrates with run newspaper and again mode requirements (§9–§10)


---

## 13. Draft extensions for pure-Pyash review loops (v0.2 draft)

This section is a forward-looking draft. It does not change v0.1 behavior.
Goal: make reviewer/generator loops implementable as ordinary Pyash refineries.

### 13.1 Loop control verbs

Add two control verbs for active `fromindex`/`toindex` loops:

```
be depart do
be continue do
```

Required behavior:

* `be depart do` exits the current loop immediately.
* `be continue do` skips remaining body sentences for the current iteration.
* Outside an active loop, each MUST surface `be error ya` (`loop control defective`).

Canonical signatures:

* `["be","depart"]`
* `["be","continue"]`

### 13.2 Structured branch extension

Add `else if` chain support so reviewer loops do not rely on deeply nested `then`.

Canonical surface forms:

```
ob text "<a>" from text "<b>" be equally then <sentence>
ob text "<a>" from text "<b>" be equally else if ob text "<c>" from text "<d>" be equally then <sentence>
ob text "<a>" from text "<b>" be equally else <sentence>
```

### 13.3 Deterministic last-line extraction

Add `line tail` as a first-class text primitive.

Canonical surface forms:

```
ob text "<multiline>" atmost num 1 be line tail do
ob name text <source> atmost num 1 to name text <target> be line tail do
```

Required behavior:

* `atmost num N` returns the last `N` non-empty lines (default `1`).
* Leading/trailing whitespace in each line is trimmed before emptiness checks.
* Output joins retained lines with `\n`, preserving deterministic order.

### 13.4 Deterministic numeric parse via cast

Extend `cast` for bounded numeric parsing used by review verdicts.

Canonical surface forms:

```
ob text "<x>" become num be cast do
ob text "<x>" from num 0 to num 1 become num be cast do
```

Required behavior:

* Parse first valid scalar numeric token from text.
* If bounds are present (`from num`, `to num`), value MUST be in range (inclusive).
* On parse/range failure, return `hollow` (no throw), so caller can branch.

### 13.5 Dynamic target dispatch (`evoke`)

Add a uniform invoke verb for typed target dispatch.

Canonical surface forms:

```
ob text "<input>" for name <target> to name text <output> be evoke do
ob text "<input>" for name <target> with name <map> to name text <output> be evoke do
```

Required behavior:

* Resolve `<target>` by remembered type:
  - `be mind` -> mind write path
  - `be refinery` -> refinery path
  - `be ceremony` / definition entry -> ceremony path
* Unknown target type surfaces `be error ya` (`evoke target defective`).
* `with name <map>` is passed through when target supports tools.

### 13.6 Hard assertion verb (`guarantee`)

Add a fail-fast verifier primitive.

Canonical surface forms:

```
ob bool truth be guarantee do
ob bool lie fromtext text "<message>" be guarantee do
ob name bool <fact> fromtext text "<message>" be guarantee do
```

Required behavior:

* If input is truth, return success acknowledgement.
* If input is lie, surface `be error ya` (`guarantee defective`) with optional message.

### 13.7 Explicit export verb (`export`)

Add a refinery-scope export marker:

```
su name <fact> be export do
```

Required behavior:

* Inside an active refinery platform scope, this marks `<fact>` for export to caller scope.
* Outside refinery platform scope, this surfaces `be error ya` (`refinery produce defective`).

Canonical signatures:

* `["be","export"]`

### 13.8 Refinery local scope and typed outputs

Refinery runners MUST provide run-local scope for platform execution and typed output contracts.

Canonical local slots for review loops:

* `trying` (attempt index)
* `sketch` (current generator output)
* `reaction` (current reviewer output)
* `decision` (pass/fail or score parse)

Contract extension on platform series entries:

```
su name <platform> to name text <target> <activity> ya
su name <platform> to name num <target> <activity> ya
```

Required behavior:

* Writes produced while evaluating a platform are local by default.
* The platform result fact (`su name <platform> ...`) is exported automatically.
* A platform output declared in the platform sentence (`to name <type> <target>`) is exported automatically.
* Additional names are exported explicitly via:

```
su name <fact> be export do
```

* Platform completion validates declared output type before marking completion.
* Type mismatch surfaces `be error ya` (`platform produce defective`).
* Invalid export usage surfaces `be error ya` (`refinery produce defective`).

### 13.9 Checkpoint/resume with loop cursor state

For iterative refinery flows, checkpoint identity MUST include loop cursor and
declared local slots that influence output.

Resume token extension MUST include:

* refinery name
* platform name or index
* loop cursor (`fromindex` and `toindex` when active)
* serialized local slots (`trying`, `sketch`, `reaction`, `decision`) when present

This ensures retry/resume returns the same next decision point and output.


---

# Re-entry cycle (draft v0.1)

## Re-entry Cycle — Why, How, What

### Why (RPT motivation)

Autoregressive LLMs process inputs in a single forward sweep per token. That limits correction,
global coherence, and error recovery. **Recurrent Processing Theory (RPT)** highlights that refinement
comes from *re-entering* the same input with feedback before accepting an outcome. The goal here is
**RPT-1+**: system-level recurrence achieved through orchestration, without changing model weights.

| System pattern          | Recurrence locus              | Approx RPT |
| ----------------------- | ----------------------------- | ---------- |
| Single-pass AR LLM      | token sequence only           | ~0.5       |
| AR LLM + re-entry       | external input re-entry       | ~1.0–1.2   |
| Diffusion LLM           | intrinsic latent refinement   | ~1.5       |
| Human perceptual cortex | intrinsic multi-area feedback | ~2         |

The Re-entry Cycle delivers the first meaningful jump using existing models and tooling.

---

### How (mechanism)

The system intentionally **re-enters the same input** multiple times. Each pass produces a draft,
receives reviewer criticism, and only applies revisions when the reviewer reports failure. A pass can
skip revision entirely. Feedback from earlier passes shapes later ones.
The recurrence lives in **control flow** (`fromindex … toindex … do`), not inside the model.
One mind or multiple minds may be used; both qualify as RPT-1 because the input itself is what is re-entered.

---

### What (the spec)

A **Re-entry Cycle** is a bounded, deterministic outer cycle implemented as a ceremony (or refinery)
that repeats a fixed attempt ceremony. Each attempt follows the same stages and then loops back to the
supervisor, which advances the index and invokes the next attempt. The **revised output of each attempt**
becomes the **next input**, so the cycle is a pipeline rather than parallel drafts.

---

## Sample prompts (normative examples)

**Draft (author mind)**

```
Task:
{{TASK}}

Produce a concise, structured candidate answer.
State assumptions explicitly when needed.
```

**Review (reviewer mind)**

```
Review the candidate.
Return:
1) Issues list (bullets)
2) Patch plan (numbered, concrete edits)
Candidate:
{{CANDIDATE}}
```

**Revise (author mind)**

```
Apply the patch plan to the candidate.
Return only the revised candidate.
Patch plan:
{{PATCH}}
Candidate:
{{CANDIDATE}}
```

**Judge (judge mind, optional)**

```
Score on correctness, completeness, constraint adherence, clarity.
Return only JSON:
{"score":0.0,"notes":"..."}
Revised candidate:
{{CANDIDATE}}
```

---

## Control flow (where it loops back)

```pyash
su name re-entry cycle be ceremony def
  ; evoker provides ob text <input>, fromindex <start>, toindex <limit>

  to name text latest
  be re-entry attempt do
  su name input ob text of latest be text ya
prah
```

After each `re-entry attempt` completes, control returns to the supervisor, `fromindex` advances, and
the attempt ceremony is invoked again. The cycle ends when the bound is reached or when an explicit
early-exit condition is triggered (judge pass, max attempts, or timebox).

Explicit loop rule (normative):
* If the attempt fails verification, the supervisor MUST schedule another attempt unless a stop
  condition has been reached.
* If the attempt passes verification, the supervisor SHOULD end the loop early.

---

## Mind configuration (author/reviewer/judge)

The author, reviewer, and judge are **mind configurations**. Define them with `be mind` sentences and
set their model + system prompt via `as` and `from discourse`:

```pyash
exists su name author prompt ob text "Draft: be concise and follow the input." be text ya
exists su name reviewer prompt ob text "Review: list issues + patch plan." be text ya
exists su name judge prompt ob text "Judge: score 0..1 + notes." be text ya

exists su name author be mind as name "qwen3-vl:8b-instruct" from discourse name author prompt ya
exists su name reviewer be mind as name "qwen3-vl:8b-instruct" from discourse name reviewer prompt ya
exists su name judge be mind as name "qwen3-vl:8b-instruct" from discourse name judge prompt ya
```

These can live in `configure/default.pya` for global defaults or inline in a specific program.

To keep each stage strictly pipeline-based (no dialogue carryover), set a history window of zero
via `by num 0` on the mind calls (see the attempt example below).

---

---

## Loop exit on judge pass (normative pattern)

If a judge is used, the cycle SHOULD terminate early when a pass threshold is met.
The supervisor can force loop exit by setting `fromindex` equal to `toindex`.

Example (illustrative):

```pyash
su name re-entry cycle be ceremony def
  fromindex 0 toindex toindex of this
  be re-entry attempt do
prah
```

Notes:
* If a judge score is available in the attempt, the attempt can end the loop by returning
  `fromindex` equal to `toindex` (see example below).
* The exact score placement is implementation-defined; the key requirement is deterministic exit.
* If no judge is used, the cycle runs to the bound.

Example (early exit inside the attempt):

```pyash
su name re-entry attempt fromindex num 0 toindex num 0 be ceremony def
  ; judge writes score into `su name score` (0..1)
  su name score be giant from num 0.8 then
  this fromindex num of toindex of this ret
  this ret
prah
```

---

## Single attempt (one pass)

```pyash
su name re-entry attempt to name text output be ceremony def

  su name input ob text ob of this ya

  ; draft (input -> author -> draft)
  su name draft out
  ob text input
  for name author
  to name draft out
  by num 0
  be write do

  ; review (draft -> reviewer -> criticism)
  su name criticism out
  ob text draft out
  for name reviewer
  to name criticism out
  by num 0
  be write do

  ; revise (criticism -> author -> revised)
  su name revised out
  ob text criticism out
  for name author
  to name revised out
  by num 0
  be write do

  ; judge (optional)
  su name judged out
  ob text revised out
  for name judge
  to name judged out
  be write do

prah
```

---

## Run newspaper + artifacts as source of truth (normative)

The run newspaper is the single source of truth for “what happened.” Artifacts are
stored separately, but the newspaper MUST record their IDs and provenance.

This section captures the invariants that keep representation flexible (single-file
newspaper, compressed bundles, on-demand reports, or no extra files at all) while
preserving determinism and replayability.

### Invariants (normative)

* **Single source of truth for “what happened”**  
  One append-only run newspaper that records every platform action and its result, in order.

* **Hard separation of roles**  
  * interpretation: derive meaning, bind circumstances once  
  * evaluation: decide pass or fail based on meaning  
  * recording: write what happened, with no judgement

* **Deterministic replay contract**  
  Again-mode re-verifies using recorded inputs plus recorded tool results, with no new mind calls and no re-fetching.

* **Stable identifiers and provenance**  
  Every meaningful input/output has an ID (hash or name) and provenance chain: “this sentence/result came from this invocation and these inputs”.

* **Explicit error semantics**  
  Tool failures become first-class records (`be error ya` with structured payload), never hidden in prose.

* **Artifact discipline**  
  Artifacts exist independently of the log, but the newspaper must record: artifact ID, type, origin step, and how it was derived.

* **Re-entry as a control structure**  
  The outer loop can repeat with new inputs derived from prior outputs, while preserving the previous pass as immutable history.

* **Minimal, typed envelopes**  
  Tool calls and mind calls use a consistent envelope shape, so modules and external tools plug in without special cases.

---

**Classification note:** This spec achieves **RPT-1+** because later passes incorporate feedback
from earlier passes through deliberate re-entry. Using different models for author, critic, or judge
remains valid, since recurrence is defined at the system level.

---

## Newspaper extraction helper (informative)

When you want a compact report without producing extra files, extract it from the run newspaper.
The goal is a small, stable summary suitable for dashboards or CI.

Recommended extraction fields (derive from newspaper + artifacts):

- run id, run time, run root, source filename
- reviewer status (pass/fail) and counts (passed/failed/skipped)
- quiz entries (name, file, status, duration, failure message)
- artifact references (locators for report inputs/outputs)
- notes (optional, human-readable)

Suggested CLI shape:

```
./run-newspaper-summary --run-id <id> --format pya|json --out <path>
```

Suggested default behavior:

- read `newspaper/<run-id>.pya`
- emit a `summary.pya`-shaped report to stdout (or JSON when `--format json`)
- include only surfaced (`be ... ya`) records


---
