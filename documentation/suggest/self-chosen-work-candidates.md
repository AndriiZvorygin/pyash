# Self-Chosen Work Candidates

**Status:** design for review. Implementation is deferred until the review
questions at the end are answered.

## Purpose

Let the work system choose what to work on next from what it can *measure*,
instead of only from a human-written list of packages.

This is not a proposal to let the system invent goals. The proposal is that the
system ranks and selects from **detector outputs** — gaps it can already
enumerate — so that the self-chosen part is *which* gap to attack next, never
*what a good idea is*.

## The gap

One line decides everything:

```js
// program/runtime/work/curator.mjs:140
const candidates = autonomousRoadmapPackages();
```

The candidate space is human-written. Everything downstream of that line is
already automatic and reasonably sophisticated:

- dependency satisfaction and validation
  (`validateRoadmapDependencies`, `roadmapDependencyStatus`)
- classification of blocked work: retryable technical, recoverable technical,
  policy revalidation, awaiting external evidence
  (`isRetryableWorkBlock`, `findRecoverableOperationalWorkTasks`,
  `findPolicyRevalidationWorkTasks`, `isAwaitingExternalEvidence`)
- availability probes with fail-open behaviour
- stale-turn recovery, checkpointing, capacity limits, timeout policy
- materialisation into durable `WorkTask` records
- execution in worktrees, review, merge

So the machinery can already execute, recover, and re-queue work. It simply
has nothing to choose from beyond the curated list.

The supply summary already has an outside-the-roadmap input too:
`buildExecutableSupply({ tasks, roadmap, curation, durableCandidates })` at
`program/runtime/work/curator.mjs:71` accepts durable candidates from outside
the roadmap. Note what that parameter is and is not: when supplied it replaces
the task source for the summary (`curator.mjs:100-103`), so it changes what
counts as durable and runnable. It does not create tasks and does not make
anything executable.

The point where a candidate actually becomes a durable task is
`curateWorkBacklog`, which materialises each proposed candidate through
`addWorkTask` (`curator.mjs:288-312`) — carrying `promptText`,
`acceptanceText`, `contextText`, priority and provenance into a `WorkTask`.
That is the seam a detector would have to reach, and the place where the
policy checks the roadmap already applies would have to be applied too.

## Where the system should look instead

Six detectors in this repository already produce machine-readable gap lists.
None of them is a new thing to build.

| Detector | What it already emits | Candidate it suggests |
|---|---|---|
| `command/english30k_coverage.mjs` | **16,048 unresolved English30k words**, ranked by frequency | "Cover the highest-ranked unresolved word by compound; fall back to an atom only if no compound holds up" |
| `program/library/compositional_case_validation.mjs` | named unassigned cells in the canonical 12×3 grid — `quantity.way`, `quantity.destination`, three `limit` cells, three `sequence` cells (recorded in `documentation/todo.md`) | "Allocate the missing HNUC and lexicon entries for cell X" |
| `program/runtime/criterion/` | per-dimension scores for factuality, IFEval, DeepSWE, baselines | "The weakest dimension is X at score Y; propose an improvement" |
| `command/audit_examples.mjs` | 13 timeouts, 69 need input, 26 need backend | "Example E times out; diagnose and fix it" |
| `program/runtime/work/history.mjs`, `outcome.mjs`, `digest.mjs` | scheduler events, outcomes, daily digest success/failure records | "Task T failed N times for reason R; fix R" |
| the drift guards (`npm run imports:check`, `doc:prose`, `house:api:check`, `package:check`) | a failure and a diff | "The import guard now fails; repair it" |

The coverage report is the strongest of these. It is already the vocabulary
expansion work list, already ranked, and it lines up with the compound-first
direction: `compoundDeterministic 113`, `compoundVerificationCandidates 204`,
`compoundRejected 36` out of 317 compound records says exactly how much of
compound expansion is already machine-decided and how much still needs a
judgement.

The second is the cleanest in form. The compositional validator **names its own
gap** — it reports which grid cells have no authoritative HNUC. A detector that
reports its own missing work is the ideal candidate source, because the
acceptance criterion is already written down.

## The proposed shape

### 1. A candidate source

A new module beside `curator.mjs` — `program/runtime/work/proposals.mjs` — reads
detector output and emits candidates in the same shape as `ROADMAP_PACKAGES`:

```
taskId, title, whyMatters, scope, nonGoals, acceptance, priority, prompt
```

Those are exactly the fields a `WorkTask` consumes: `promptText` and
`acceptanceText` are first-class in the task contract
(`program/runtime/work/contract.mjs:206-207`), and `workSpec` carries the
provenance key. A candidate that cannot state a prompt and an acceptance
criterion is not a candidate.

### 2. The attachment point

`curateWorkBacklog` already computes a `needsDirection` result at lines 274
and 319 — the system already knows how to say *"I have nothing to run; I need
a human."* It is a conjunction, not an empty-queue test: `needsDirection` is
true only when the runnable backlog **and** proposed candidates **and**
credible roadmap candidates **and** retryable technical work **and** work
awaiting external evidence are all empty. That is where a self-chosen source
attaches: **when the curated backlog is genuinely exhausted, ask the detectors
for the highest-ranked gap instead of idling.**

The curated roadmap keeps precedence at all times. A self-chosen candidate is
only considered when there is no curated work available, so it can never
displace work a human queued.

### 3. Selection, not proposal

The detectors enumerate; the curator ranks. A candidate's priority comes from
the detector's own ordering — frequency rank for coverage, official level for
the compositional grid, score deficit for criterion — not from a model
estimate.

## Safety

This is the part a reviewer should press hardest on, so it is stated plainly.

- **The candidate space stays bounded and machine-derived.** Every candidate
  names a specific detected gap. No candidate may be produced by free-form
  generation of a goal.
- **A candidate still needs a prompt and an acceptance criterion.** The
  executor and reviewer contracts do not change. A detector that cannot state
  what "done" means does not produce a candidate.
- **The curated roadmap always wins.** Self-chosen candidates fill an empty
  backlog, nothing more.
- **The review gate is unchanged.** `solThreadId` / `lunaThreadId` and the
  acceptance check still apply to every task, proposed or curated.
- **Failure is visible.** If no detector yields a candidate, the system reports
  `needsDirection` as it does today.

## Scope

In scope: one new module in `program/runtime/work/`, a change to the candidate
line in `curator.mjs`, and quizzes covering selection, precedence and the
empty-backlog path.

Out of scope: changing the work executor, the reviewer, the task contract, the
roadmap package format, and the `needsDirection` semantics.

## Acceptance

- `program/runtime/work/proposals.mjs` exposes a function that returns
  candidates derived from detector output, and a quiz shows at least one
  candidate whose title and acceptance criterion name a detected gap.
- A quiz shows that a self-chosen candidate is **not** offered while a curated
  package is runnable.
- A quiz shows that with an empty curated backlog, a self-chosen candidate is
  offered and carries a prompt and an acceptance criterion.
- A quiz shows that the candidate list is empty, and `needsDirection` is
  reported, when no detector yields anything.
- The full suite passes.

## Open questions for the reviewer

1. **How many candidates at a time?** One highest-ranked gap, or a small batch
   that can be worked in parallel? The work layer already reasons about
   independent candidates (`selectIndependentWorkCandidates`), which suggests a
   batch is the intended shape.
2. **Which detector leads?** Coverage is the biggest list but also the longest
   tail; the compositional grid is the smallest and the most precise. A single
   leading detector, or an interleaving policy?
3. **Does a self-chosen candidate need human approval before it runs?** The
   curated path does not require one, and the acceptance criterion is supposed
   to be the gate. If the answer is yes, this is a much smaller change than
   proposed here.
4. **Should the coverage detector prefer compounds over atoms explicitly?** The
   direction is compound-first, and the detector currently reports both without
   a preference.
5. **How is a rejected candidate recorded?** 36 compound records were already
   rejected; a rejected *task* should not silently reappear.

## Reproducing the measurements

```bash
# the candidate line
grep -n "autonomousRoadmapPackages()" program/runtime/work/curator.mjs

# the injection point and the empty-backlog path
grep -n "durableCandidates\|needsDirection" program/runtime/work/curator.mjs

# the coverage gap list
node command/english30k_coverage.mjs

# the compositional grid's own report
node --test quiz/compositional_validation.test.mjs
grep -n "UNASSIGNED_HNUC\|status !== \"unassigned\"" \
  program/library/compositional_case_validation.mjs

# the task contract fields a candidate must fill
grep -n "acceptanceText\|promptText\|contextText" program/runtime/work/contract.mjs | head
```
