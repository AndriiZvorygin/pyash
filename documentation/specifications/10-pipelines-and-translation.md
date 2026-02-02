# `10-pipelines-and-translation.md` (merged)

Merged specification sources (legacy IDs):
- 14-refinery
- 34-re-entry-cycle
- 34-translation

---

# Refinery (v0.1)

**Status:** v0.1

---

## 1. Purpose

Define refinery execution: a runner-controlled way to execute a set of named platforms with explicit depend lists, using normal Pyash sentences as the activity for each platform.

This spec exists to make multi-step runs:

deterministic across interpreter / JS / C

verifiable to run again when again mode is enabled

compatible with duties, streams, chips, exchange, artifacts, and run newspaper

Refinery execution is a **runner policy** in v0.1: the runner may execute a refinery
after it finishes interpreting the program body. Refinery execution is not yet a
first-class sentence inside the program.


This spec defines:

- refinery declaration form
- platform declaration form
- depend rules and deterministic scheduling
- failure policy
- interaction with run newspaper and again mode
- compatibility notes for workflow files and approval gates



---

## 2. Terms

refinery — a named collection of platform declarations executed by a runner

platform — one named unit of refinery work

activity — the sentence (embedded in la … ko) that the runner evaluates for a platform

depend — a platform name that MUST complete before another platform may start

already platform — a platform whose depend list is complete

again mode — runner policy that requires recording and verification sufficient to run again (see 05-run-recording-and-artifacts.md)

runner policy — behavior controlled by the runner (CLI/config), not by in-program
sentences. Examples: selecting which refinery to run, and when to print results.

ratification — a hard approval gate that MUST halt execution until an explicit decision is provided



---

## 3. Global invariants (normative)

1. Deterministic scheduling
For the same refinery definition and inputs, the order of platform execution MUST be deterministic.


2. No hidden semantics
The runner MUST NOT rewrite platform activities. Activities are evaluated as normal Pyash sentences.


3. Definition does not execute activities
A refinery definition is declarative: activities inside ob la … ko are not executed at definition time. They are executed only when the runner runs the refinery.


4. Newspaper is optional
If run newspaper emission is disabled, refinery evaluation results MUST be the same; only recording changes.


5. Again mode is stricter
In again mode, refinery execution MUST satisfy the recording and verification rules in 05-run-recording-and-artifacts.md.

Checkpoint and retry records are emitted into the run newspaper per `05-run-recording-and-artifacts.md` when enabled.




---

## 4. Reserved verbs (normative)

The words refinery and platform are reserved for refinery declarations and MUST NOT dispatch as ordinary ceremonies.

be refinery def … prah is a declaration form.

be platform ya is a declaration entry form inside a refinery.


If an implementation supports user-defined ceremonies named refinery or platform, that support MUST be gated off while parsing refinery blocks (the declaration meaning wins inside the refinery).

The word ratification is reserved for approval gates when a refinery runner or workflow runner is active.


---

## 5. Refinery declaration (official)

A refinery is declared using a def / prah block.

### 5.1 Form

A refinery is declared as:

su name <refinery> be refinery def

followed by one or more platform declarations

ending with prah


The refinery name <refinery> is a su name identifier.

### 5.2 Multiple refineries

A file MAY declare more than one refinery. Selecting which refinery to run is a runner policy (outside this spec).

### 5.3 Runner invocation (v0.1 behavior)

In v0.1, refinery execution is **not** triggered by a Pyash sentence. The runner
is responsible for selecting a refinery (by CLI/config) and may run it **after**
the program body finishes executing.

This means:

* The program itself cannot run additional sentences after refinery completion.
* The refinery result is returned to the runner, which decides whether and how to print it.

Future revisions may add a first-class `be refinery do` sentence so refineries can
run inline and return values to the program.

---

## 5.7 Ratification (approval gate) (draft v0.1)

Ratification is the Pyash-native approval gate for deterministic workflows.

### 5.7.1 Sentence form

```
ob text "<prompt>" be ratification do
```

Optional storage of a decision:

```
ob text "<prompt>" to name text <decision> be ratification do
```

### 5.7.2 Required behavior

* A ratification gate MUST halt execution when evaluated in a runner workflow or refinery runner.
* The runner MUST emit a structured approval request that includes:
  - prompt text
  - a resume token
  - the decision field name (if provided)
* Execution MUST NOT continue until a resume action supplies an explicit decision.

### 5.7.3 Resume (draft)

Resume is a runner command (not an in-language verb) that accepts a resume token and decision.
Implementations MAY expose an inline verb, but the runner command is the compatibility target.

Minimal contract:

* decision values: `yes` / `no`
* resume continues at the next stage after the ratification gate

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
2. Convert each step into a platform activity sentence:
   * `command` is parsed into a sentence and embedded in `ob la ... ko`.
   * `approval: required` injects a `ob text "<prompt>" be ratification do` activity.
3. `stdin` and `env` are expanded as subordinate clauses on the activity sentence.
4. `condition` determines whether the platform is scheduled (runner policy).

This conversion is deterministic and reversible via the json map representation.

---

## 5.4 Inline refinery execution (draft v0.2)

An implementation MAY support running a refinery inside the program as a normal
verb. This enables post-refinery logic and programmatic access to the result.

### Sentence form (draft)

```
ob text "<task>" to name text <output> be refinery do
```

Optional refinery selector:

```
ob text "<task>" from name <refinery> to name text <output> be refinery do
```

If `from name <refinery>` is omitted, the runtime SHOULD read the refinery name
from memory (`su name refinery name ob text "<name>" be text ya`).

### Task binding

If `ob` is provided, the runtime SHOULD bind the task into memory as:

```
su name task ob text "<task>" be text ya
```

so platform activities can read `task` normally. The binding MAY be temporary;
implementations SHOULD restore a prior `task` value if it existed.

### Result

The inline call behaves like a normal verb:

* it stores the final refinery result into the `to` target
* it writes the `result` fact
* errors surface normally and terminate execution unless handled

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

- CLI (`node program/command/extract_report.mjs --run-id <id>`)
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
exists su name reduce
  ob la
    ob name source to name output be error sieve do
  ko
  be platform ya
prah
```

This spec defines the reducer loop at a high level; an implementation may
introduce an inline `be error sieve do` verb or a runner policy in a future revision.


---

## 6. Platform declaration (official)

Each platform is declared by a single sentence inside the refinery block.

### 6.1 Platform sentence form

A platform declaration is a sentence with:

su name <platform> (required)

from ve name <dep0> <dep1> ... (optional depend list)

ob la <activity sentence> ko (required activity)

be platform ya


Rules:

<platform> is the platform name (unique within the refinery).

The depend list is carried in from ve name ... as a vector of platform names.

The activity is embedded using subordinate clauses (01-sentence-and-grammar.md) in ob la … ko.

The embedded activity MAY include an embedded mood token per subordinate clause policy. The runner MUST preserve the embedded structure when recording.


### 6.2 Uniqueness

Platform names within a refinery MUST be unique. Duplicate platform names are an error.

### 6.3 Examples

Platform with no depend list:
su name parse ob la su name src ob text "data/input.csv" be load ya ko be platform ya

Platform that depends on parse:
su name compile from ve name parse ob la su name ast vyah eval be compile ya ko be platform ya


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

parses platform declarations with su name, optional from ve name ..., and ob la … ko

treats refinery and platform as reserved declaration verbs inside refinery declarations

executes platforms in deterministic order using the official tie-breaker (§7.2)

applies the v0.1 fail-fast policy (§8)

integrates with run newspaper and again mode requirements (§9–§10)


---

# Re-entry cycle (draft v0.1)

## Re-entry Cycle — Why, How, What

### Why (RPT motivation)

Autoregressive LLMs process inputs in a single forward sweep per token. That limits correction,
global coherence, and error recovery. **Recurrent Processing Theory (RPT)** highlights that refinement
comes from *re-entering* the same task with feedback before accepting an outcome. The goal here is
**RPT-1+**: system-level recurrence achieved through orchestration, without changing model weights.

| System pattern          | Recurrence locus              | Approx RPT |
| ----------------------- | ----------------------------- | ---------- |
| Single-pass AR LLM      | token sequence only           | ~0.5       |
| AR LLM + re-entry       | external task re-entry        | ~1.0–1.2   |
| Diffusion LLM           | intrinsic latent refinement   | ~1.5       |
| Human perceptual cortex | intrinsic multi-area feedback | ~2         |

The Re-entry Cycle delivers the first meaningful jump using existing models and tooling.

---

### How (mechanism)

The system intentionally **re-enters the same task** multiple times. Each pass produces a draft,
receives reviewer criticism, and only applies revisions when the reviewer reports failure. A pass can
skip revision entirely. Feedback from earlier passes shapes later ones.
The recurrence lives in **control flow** (`fromindex … toindex … do`), not inside the model.
One mind or multiple minds may be used; both qualify as RPT-1 because the task itself is what is re-entered.

---

### What (the spec)

A **Re-entry Cycle** is a bounded, deterministic outer cycle implemented as a ceremony (or refinery)
that repeats a fixed attempt ceremony. Each attempt follows the same stages and then loops back to the
supervisor, which advances the index and invokes the next attempt. The **revised output of each attempt**
becomes the **next task input**, so the cycle is a pipeline rather than parallel drafts.

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
  ; evoker provides ob text <task>, fromindex <start>, toindex <limit>

  to name text latest
  be re-entry attempt do
  su name task ob text of latest be text ya
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
exists su name author prompt ob text "Draft: be concise and follow the task." be text ya
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

  su name task ob text ob of this ya

  ; draft (task -> author -> draft)
  su name draft out
  ob text task
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

# Translation (draft v0.1)

**Status:** draft v0.1

## 1. Purpose

Define the translation pipeline for Pyash text ↔ natural language, including:
- the `translation` verb behavior,
- exact and template translation pairs,
- placeholder rules,
- fallback language detection during parsing.

This spec documents current behavior so future changes remain consistent and low-churn.

---

## 2. Translation verb (normative)

### 2.1 Source/target

`be translation do` operates on text input and emits translated text.

Common forms:
- Pyash → English:
  ```
  from text quoted.pyash.<pyash>.pyash.quoted from state pyash to state english to name output be translation do
  ```
- English → Pyash:
  ```
  from text quoted.pyash.<english>.pyash.quoted from state english to state pyash to name output be translation do
  ```

The result is stored under `to name <output>` with:
```
su name <output> be <language> ob text "<translated>" ya
```

### 2.2 File translation (pattern)

When translating from a file, first read the file into a named value, then translate:
```
su name input from filename "<path>" be read do
from name input fromstate name pyash to state english to name output be translation do
```

See `examples/pyash/translate-pyash-file-to-english.pya`.

---

## 3. Exact translation pairs (normative)

Exact pairs provide direct Pyash ↔ natural language mappings.

Files:
- `program/verbs/exchange/translation/pairs_english.pya`
- `program/verbs/exchange/translation/pairs_russian.pya`
- `program/verbs/exchange/translation/pairs_french.pya`
- `program/verbs/exchange/translation/pairs_chinese.pya`
- `program/verbs/exchange/translation/pairs_interlingua.pya`
- `program/verbs/exchange/translation/pairs_hindi.pya`

Shape:
```
su name translation_pairs_<lang> be map def
su text "<pyash sentence>" ob text "<gloss>" ya
prah
```

Lookup order: exact pairs are checked before templates and formatters.

---

## 4. Template translation pairs (normative)

Templates allow variable inputs using placeholders that are **case-based** rather than positional.

Files:
- `program/verbs/exchange/translation/pairs_english_templates.pya`
- `program/verbs/exchange/translation/pairs_russian_templates.pya`
- `program/verbs/exchange/translation/pairs_french_templates.pya`
- `program/verbs/exchange/translation/pairs_chinese_templates.pya`
- `program/verbs/exchange/translation/pairs_interlingua_templates.pya`
- `program/verbs/exchange/translation/pairs_hindi_templates.pya`

Shape:
```
su name translation_pairs_<lang>_templates be map def
su text "<pyash template>" ob text "<gloss template>" ya
prah
```

### 4.1 Placeholder syntax

Placeholders are bracketed and use genitive form:
```
[<field> of <role>]
```

Examples:
- `[name of su]`
  → `su.name`
- `[num of ob]`
  → `ob.num`
- `[text of ob]`
  → `ob.text`
- `[gloss of consequence]`
  → uses the formatter on the nested `then` sentence
- `[pyash of consequence]`
  → uses the Pyash surface form of the nested `then` sentence

Allowed roles:
`su`, `ob`, `to`, `from`, `with`, `via`, `by`, `consequence`.

Allowed fields:
`name`, `num`, `text`, `bool`, `date`, `filename`, `wo`, `vec`, `pyash`, `gloss`.

### 4.2 Matching rules

Given a Pyash sentence:
1. Template placeholders are substituted with Pyash surface forms.
2. The resulting Pyash string must match the sentence exactly.
3. If it matches, the gloss template is rendered using the same placeholders.

Output substitution is language-aware for booleans:
- English: `true` / `false`
- Russian: `истина` / `ложь`
- French: `vrai` / `faux`
- Chinese: `真相` / `谎言`
- Interlingua: `veritate` / `false`
- Hindi: `सच` / `झूठ`

---

## 5. Parsing fallback (normative)

When `parse()` does not produce a valid Pyash mood, the parser attempts a **translation fallback**:
1. Try exact reverse pairs (gloss → Pyash).
2. Try reverse templates (gloss → Pyash).
3. If a Pyash match is found, re-parse it as Pyash and return that sentence.

This allows lines like:
```
collector is number 5.
ajoute 2 a collector.
прибавь 3 к collector.
```
to be interpreted as Pyash without explicit `be translation do`.

See `examples/pyash/translation-fallback-mixed.pya`.

---

## 6. Tests that define truth

- `quiz/translation.test.mjs`
- `quiz/translation_anchor_words.test.mjs`
- `quiz/translation_pairs_english.test.mjs`
- `quiz/translation_pairs_russian.test.mjs`
- `quiz/translation_pairs_french.test.mjs`
- `quiz/translation_pairs_chinese.test.mjs`
- `quiz/translation_pairs_interlingua.test.mjs`
- `quiz/translation_pairs_hindi.test.mjs`
- `quiz/translation_pairs_templates.test.mjs`
- `quiz/translation_pairs_conditionals_templates.test.mjs`
- `quiz/translation_pairs_vector_remains_templates.test.mjs`
- `quiz/translation_parse_fallback.test.mjs`
- `quiz/translation_chinese_adapter.test.mjs`
- `quiz/translation_chinese_roundtrip.test.mjs`
- `quiz/translation_interlingua_adapter.test.mjs`
- `quiz/translation_interlingua_roundtrip.test.mjs`
- `quiz/translation_hindi_adapter.test.mjs`
- `quiz/translation_hindi_roundtrip.test.mjs`

---

## 7. Examples

- `examples/pyash/translate-pyash-sentence-to-english.pya`
- `examples/pyash/translate-pyash-file-to-english.pya`
- `examples/pyash/translation-fallback-mixed.pya`
- `examples/pyash/translate-pyash-map-ceremony-to-chinese.pya`
- `examples/pyash/translate-pyash-map-ceremony-to-interlingua.pya`
- `examples/pyash/translate-pyash-map-ceremony-to-hindi.pya`

---

## 8. Translation parity checklist

## 8a. Current coverage and gaps

The translation adapters and pairs are usable for core REPL-style sentences and the
example set, but they do not yet cover the full Pyash language surface. The items
below apply across all languages unless noted.

### Covered today
- Core imperative verbs in examples (write/read/plus/subtract/multiply/divide/remains).
- Simple declarative assignments for `text`, `number`, `bool`, `date`, `vector`.
- Basic map and ceremony open and close markers in the translation examples.
- Parser fallback to pairs/templates for Pyash glosses.

### Common gaps to close
- Nested maps and nested ceremonies.
- Rich ceremony bodies that use multiple arguments and outputs.
- Full compositional case coverage beyond the current templates.
- Conditional and comparative sentences beyond the current templates.
- Broader verb coverage for the standard library.
- More robust name handling and quoting for multiword identifiers.

### Language specific notes
- English, French, Russian, Chinese, Interlingua, Hindi: templates exist and roundtrip
  for the current example coverage only. Expand pairs and templates to match new
  verbs and data structures as they land.
- Chinese: vector uses the single character alias `量`, but `向量` is also accepted.
- Interlingua: Spanish is currently an alias to Interlingua forms.

### English
- [x] Adapter: `english.mjs` (to/from Pyash).
- [x] Exact pairs: `pairs_english.pya`.
- [x] Templates: `pairs_english_templates.pya`.
- [x] Parser fallback from gloss → Pyash.

### Russian
- [x] Adapter: `russian.mjs` (to/from Pyash).
- [x] Exact pairs: `pairs_russian.pya`.
- [x] Templates: `pairs_russian_templates.pya`.
- [x] Parser fallback from gloss → Pyash.

### French
- [x] Adapter: `french.mjs` (to/from Pyash).
- [x] Exact pairs: `pairs_french.pya`.
- [x] Templates: `pairs_french_templates.pya`.
- [x] Parser fallback from gloss → Pyash.

### Chinese
- [x] Adapter: `chinese.mjs` (to/from Pyash).
- [x] Exact pairs: `pairs_chinese.pya`.
- [x] Templates: `pairs_chinese_templates.pya`.
- [x] Parser fallback from gloss → Pyash.

### Interlingua
- [x] Adapter: `interlingua.mjs` (to/from Pyash).
- [x] Exact pairs: `pairs_interlingua.pya`.
- [x] Templates: `pairs_interlingua_templates.pya`.
- [x] Parser fallback from gloss → Pyash.

### Hindi
- [x] Adapter: `hindi.mjs` (to/from Pyash).
- [x] Exact pairs: `pairs_hindi.pya`.
- [x] Templates: `pairs_hindi_templates.pya`.
- [x] Parser fallback from gloss → Pyash.

### Upcoming languages
- [ ] Spanish (adapter + pairs + templates + fallback coverage).
- [ ] Portuguese (adapter + pairs + templates + fallback coverage).

---

## 9. Vocabulary normalization (pending)

Translation examples should prefer **root dictionary words** instead of conjugated English variants
(`actively` vs `active`, etc.). The tooling for automatic normalization and replacement is not yet
implemented; for now, prefer dictionary-root tokens when authoring examples and pairs.

---

## 10. Anchor word forms (draft)

Some vocabulary entries need explicit surface forms (noun/adverb/etc.) while keeping a single
**anchor word** for Pyash. This is expressed as a small Pyash map:

```
su name translation_anchor_words be map def
su name actively ob text "active" as wo noun ya
su name actively ob text "actively" as wo adverb ya
prah
```

Interpretation:
- `su name <anchor>` is the canonical Pyash word.
- `ob text "<form>"` is a surface form.
- `as wo <role>` tags the form (noun/adverb/etc.).

Implementations MAY normalize incoming text by mapping known forms back to the anchor word.
