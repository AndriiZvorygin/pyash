# Pyash as a GIOS Foundation

**Status:** analysis for review. It states where Pyash stands against the
ambition its own design document declares, what stands between it and the next
stage, and what would have to be true for the next stage to be claimed. It
proposes no code change and schedules no work.

## Purpose

`documentation/pyash.md` says Pyash is "an interlanguage between all human
languages and all computer languages", that it should be "grown rather than
hand-designed, using LLMs and evolutionary programming", and that it aims to
be "a Turing-complete, general-purpose language". That is the ambition of a
general intelligence operating system (GIOS): a substrate that can hold
arbitrary human meaning, act on a world, accumulate what it learns, decide
what to do next, and improve itself.

This document asks one question: **on that ambition, where does Pyash
actually stand, and what needs work?** It is an assessment, not a plan.
Measured claims include commands or code references for reproduction;
readiness judgments are analysis for reviewers, not measured results.

The current evidence points to a substantial language, application, and agent
runtime, alongside important gaps in persistent knowledge, vocabulary
coverage, autonomous work formation, and demonstrated self-improvement. Those
are different kinds of gaps: some are implementation work, while others need
clearer contracts and stronger evidence before their maturity can be judged.
In particular, goal formation is not a one-line code change; it needs a safe
path from detected opportunity through ranking, policy checks, durable task
creation, execution, and evaluation.

## What "GIOS foundation" means here

Seven diagnostic dimensions. The ordering is a review hypothesis, not a proven
dependency chain: persistence, vocabulary coverage, and goal formation can
reinforce one another, and the right implementation order depends on the
contracts and risks of each change. The table is a rubric, not a maturity
score.

| # | Stage | The question it answers |
|---|---|---|
| 1 | Deterministic substrate | Do the interpreter and supported compiled backends produce equivalent outcomes for the same program? |
| 2 | Vocabulary coverage | Can people express intended meaning with the current vocabulary and composition rules? |
| 3 | Perception and action | Can it observe and act on a world outside itself? |
| 4 | Cumulative memory | Does what it learns outlive a session, with provenance? |
| 5 | Multiplicity | Can many roles run at once and be coordinated? |
| 6 | Goal formation | Can it choose what to work on, not only execute what a human wrote? |
| 7 | Self-improvement | Can it rewrite itself against a fitness function? |

This rubric is not imported from outside. Stages 1–3 are the "interlanguage"
and "compositional workflows" goals in `documentation/pyash.md`; stage 4 is
the knowledge core the roadmap already carries; stages 5–7 are the
"grown rather than hand-designed" and "evolutionary ecosystem" goals.
The rubric asks how action, persistence, and goal formation connect. Their
relationship is a question for review, not proof that one must be completed
before work on the others can begin.

## The measured surface

```
$ node command/measure_code_balance.mjs
  interpreter core     6396 lines  25 files
  verb layer          29694 lines  174 files
  applications       176320 lines  696 files
  core:applications = 1:27.57
  core share of measured = 3.0%
```

The GIOS-shaped part of the tree — the interpreter core plus `program/runtime`
(22,192 lines) plus `program/agent` (18,544 lines) — is **47,132 lines, 22% of
the 212,410 measured lines**. The other 78% is applications: meeting
pipelines, reporter stages, media tooling, and the coding saddle. This is a
rough code-size snapshot, not a measure of capability, quality, or investment;
it is useful for scope, not as evidence that application work is or is not
GIOS progress.

Around that core:

```
$ git rev-list --count HEAD          # 4,760 commits
$ git rev-list --count --since="30 days ago" HEAD   # 479 in the last 30 days
$ ls quiz/*.test.mjs | wc -l          # 736 quiz files
$ cat quiz/*.test.mjs | wc -l         # 82,896 quiz lines
$ ls documentation/specifications/*.md | wc -l   # 24 specification files
$ ls examples/pyash/*.pya | wc -l     # 357 runnable examples
```

Counts were measured on **2026-11-01**. They are a reproducible snapshot and
will drift as the repository changes. File and line counts do not establish
reliability, semantic coverage, or useful autonomy.

## Evidence by Dimension

### 1. Deterministic substrate — specified and tested at selected boundaries

The interpreter is small and the specification is real. `program/understand/`
(809 lines) parses, `program/bridge/` (5,167 lines) dispatches, and
`program/remember/` (420 lines) holds memory. Twenty-four specification files
sit under `documentation/specifications/`, including the VLIW ISA
(`27-pyash-vliw-isa.md`) and the criterion/reverie/nightmare evaluation
surface (`26-criterion.md`).

Compiled backends exist in three shapes: C (`program/library/compile/c/`, 37
files), JS (`js/`, 9 files) and native emit (`emit_native/`, 12 files), with
132 files in the compile layer overall. `documentation/parity-checklist.md`
has seven gates marked done, but only its filename-mutation gate directly
verifies interpreter/compiled-JS/compiled-C result parity. The other six gates
concern scheduler, channel, observability, or checklist coverage; they should
not be read as seven compiler-parity gates. Compile-family counts and verb
module counts are unlike units, not a direct coverage ratio.

**Verdict:** this is one of the better-specified and tested parts of the
system, especially at documented and tested boundaries. The evidence here
does not establish parity or determinism for every verb and backend.

### 2. Vocabulary coverage — broad mechanisms, incomplete measured coverage

The grammar is the API surface: cases, noun classes, signature-first
dispatch. This supports composition: some new sentences can be expressed by
combining existing words and constructions. It does not establish that
arbitrary new meanings can be represented without new vocabulary or grammar.

The English30k coverage report gives a useful but bounded lexical signal:

```
$ node command/english30k_coverage.mjs
  covered 13951   unresolved 16048   coveragePercent 46.505
  compoundRecords 317   compoundDeterministic 113
  compoundVerificationCandidates 204   compoundRejected 36
```

The report classifies 16,048 of 29,999 ranked English words as unresolved by
its lexical coverage method. That is not a test of whether those meanings can
be paraphrased compositionally. Of 317 compound records, 113 are marked
deterministic, 204 are verification candidates, and 36 were rejected. The
compositional validator names unassigned cells:
`quantity.way`, `quantity.destination`, all three `limit` cells and all three
`sequence` cells.

**Verdict:** the mechanisms are measurable, while vocabulary and composition
coverage remain incomplete. The coverage report does not establish whether
the main limitation is content, grammar, or both. The separate
`vocabulary-runtime-parameter.md` proposal is marked parked because it has no
current deliverable; that status does not settle the broader vocabulary
coverage question.

### 3. Perception and action — broad implemented surface

174 verb modules (29,694 lines) cover the surface: `hear`, `exchange`,
`android`, `verify_platform`, `verify_loop`, `mind`, `qwen_say`. Device
bridging lives in `program/agent/android/`, ceremonies and sandpits in
`program/bridge/sandpit.mjs`, and 357 runnable examples under
`examples/pyash/` demonstrate real behaviour rather than describe it.

**Verdict:** this is a broad and visible part of the implemented system. Its
size can attract attention, but breadth alone does not establish reliability
or capability across all integrations.

### 4. Cumulative memory — Knowledge Core contract implemented, indexed storage missing

This stage is narrower than the phrase "cumulative memory" suggests. Pyash
already has sessions and other durable agent/work artifacts; the gap described
here is specifically persistent storage and retrieval for the Knowledge Core.
Week 9 of `documentation/roadmap.md` groups claim/evidence/query contracts and
storage work. This proposal analytically separates those concerns; the roadmap
does not itself present them as two separately completed halves.

**Implemented for the current in-memory boundary, and tested.**
`program/library/knowledge_core.mjs` (450 lines) implements the current
contract surface: canonical claim keys
(`deriveClaimKey`, `deriveClaimIdentity`), canonical ordering
(`canonicalJson`, `compareUtf8Bytes`), the evidential shell
(`normalizeEvidence`, `evidentialName`, confidence), source and anchor
identity (`validateSourceAnchor`, stable `anchorId`), and the three query
views (`resolveCurrentView`, `resolveContestedView`,
`resolveProvenanceView`). It is wired into the language surface —
`program/verbs/claim.mjs` exposes `claim identify` and `claim choose`, and
`program/bridge/index.mjs:372` normalises and records evidence sentences as
they enter memory. `quiz/knowledge_core.test.mjs` pins claim-key equality
across predicate aliases and case order, timeless and windowed claims,
UTF-8 ordering, the evidential fixture, conflict selection by confidence, and
**the same resolver view rendered by the interpreter, by compiled JavaScript,
and by compiled C**.

**Not present in this Knowledge Core implementation.** Persistent indexed
storage — entity-page format (one file
per `su`), registry files for lexicon, ontology and sources, and the held and
rejected directories keyed by `su case …` — is not implemented here.
`claim choose` resolves from `allRemember()` in process memory. This does not
mean Pyash has no persistent memory elsewhere; it means this Knowledge Core
query path does not yet use a persistent indexed store.

**The roadmap package deserves a scope review.**
`roadmap-knowledge-core` ("Implement the sentence-native knowledge core") sits
at **priority 55**, with 24 of the roadmap's 28 packages ranked above it. Its
acceptance criterion — "golden claim/evidence/resolver fixtures pass with
canonical interpreter/JavaScript/C output for the supported boundary" —
appears satisfied for the implemented boundary by the existing quiz. That
does not demonstrate that the broader Week 9 storage scope is complete. If the
roadmap intends the criterion to cover that storage work too, the acceptance
criterion needs clarification rather than declaring the package stale.

**Verdict:** a useful claim/evidence/query contract exists and is tested at its
current boundary. Persistent indexed storage and its acceptance criteria
remain to be specified and implemented.

### 5. Multiplicity — substantial coordination infrastructure

`program/agent/` is 18,544 lines across 51 files: agent houses with roles and
presence, sessions and session replay, channels, the scheduler and its
service control, scheduled jobs, the coding saddle, the orchestrator, and
headquarters. `program/runtime/work/` is 29 modules implementing a durable
work system — `contract`, `curator`, `runner`, `supervisor`, `queue`,
`checkpoint`, `recovery`, `preflight`, `turn_reconciliation`, `capacity`,
`timeout_policy`, `blocker_repair`.

**Verdict:** the repository has substantial durable work, session, role, and
scheduling infrastructure. This demonstrates coordination and recovery for
the supported workflows, not arbitrary parallel execution by independent
agents; the latter remains a separate capability to evaluate.

### 6. Goal formation — not demonstrated from system findings

The work system is executable and durable, and its roadmap packages are
human-authored. The curator also reconciles existing durable tasks and
operational recovery; that is not the same as generating new goals from
detector output. For example, its roadmap-package source is:

```js
const candidates = autonomousRoadmapPackages();
```

`needsDirection` is computed only after checking more than runnable backlog:
proposed and credible candidates, retryable technical work, and work awaiting
external evidence also affect it. The current code does not provide a direct
path that turns a vocabulary/composition detector result into a ranked,
policy-checked, durable task candidate.

**Verdict:** goal formation is a real capability gap, but not a one-line code
gap. The English30k report and compositional validator expose candidate
signals; they are not yet a prioritized goal backlog. A safe implementation
needs provenance, deduplication, ranking, policy and dependency checks,
durable task creation, and measurable acceptance criteria.

### 7. Self-improvement — evaluation machinery present, improvement loop unproven

`documentation/pyash.md` goal 7 describes proposing implementations by LLM or
mutation and retaining code that passes quizzes.

The supporting machinery is real — 736 quiz files and 82,896 quiz lines, the
`again`/refinery/artifact/verify/golden conventions, the `criterion`,
`nightmare` and `reverie` verbs, `program/runtime/criterion/`. What is
missing is the *loop*: nothing schedules mutation → evaluate → select → keep.
The quiz suite is a regression/acceptance gate, not by itself a fitness
function that measures general improvement. A credible loop needs an explicit
objective, held-out evaluations, safeguards against optimizing to the tests,
and traceable selection decisions.

**Verdict:** the repository has useful evaluation and verification machinery,
but a self-improvement loop and a defensible improvement signal remain
unproven.

**Stage-7 acceptance criterion (proposal):** demonstrate a full mutation →
evaluate → select → keep cycle against a stated objective and held-out
evaluation. Retain a rejected candidate and the evidence for rejection, plus
an accepted change traceable to a documented baseline deficiency, with diffs
and evaluation results. A green regression suite is necessary for safety but
does not, by itself, show improvement.

## Five Review Gates

These are proposed areas for review, not a demonstrated dependency chain.
Their order is provisional; a reviewer may recommend a different sequence or
split a gate further.

### Gate 1 — Cumulative memory (persistence, not semantics)

**Measured:** a claim/evidence/query contract exists and is tested at its
implemented boundary —
`program/library/knowledge_core.mjs` (450 lines), `program/verbs/claim.mjs`
(`claim identify` / `claim choose`), evidence normalised at
`program/bridge/index.mjs:372`, and `quiz/knowledge_core.test.mjs` asserting
the same resolver view from interpreter, compiled JavaScript and compiled C.
The Knowledge Core does not yet use a persistent indexed store with entity
pages, lexicon/ontology/source registries, and held/rejected stores. This is a
specific gap in that query path, not a claim that Pyash lacks all durable
memory. The roadmap package `roadmap-knowledge-core` is priority 55; clarify
whether its acceptance criterion covers this storage scope.

**What closing it looks like:** the Week 9 storage layout — entity pages
keyed by `su`, three registry files, and held/rejected directories keyed by
`su case …` — on top of the resolvers that already exist. This is a layout
and persistence tranche, not a semantic one, and it should not re-litigate
claim keys, evidence shape or view semantics unless storage requirements or
tests reveal a gap in the existing contracts.

**Why it matters:** persistent, queryable evidence could support long-lived
work and evaluation. Whether it must precede detector-driven task creation is
an open sequencing question; existing durable task infrastructure may support
a bounded first experiment.

### Gate 2 — Vocabulary and composition coverage

**Measured:** 46.505% English30k lexical coverage; 16,048 unresolved by that
method; 204 compound records awaiting verification; 36 rejected; unassigned
compositional cells
`quantity.way`, `quantity.destination`, three `limit`, three `sequence`.

**What closing it looks like:** use the coverage and composition reports to
prioritize experiments, then measure lexical and compositional outcomes
separately. The 7,841 entries in `program/library/pyashWords.json` provide a
current vocabulary baseline; the 204 compound-verification candidates are an
identified, bounded set. Define deterministic verification and expansion
procedures so coverage rises by measurement rather than assertion. The
compositional grid's own holes are a bounded second tranche.

**Why it matters:** a lexical coverage score alone cannot say whether a new
meaning is expressible compositionally. Define and measure that capability
before drawing conclusions from the 46.5% lexical figure.

### Gate 3 — Goal formation

**Measured:** the roadmap package source is human-authored
(`autonomousRoadmapPackages()` in `curator.mjs`). The curator also reconciles
durable tasks and operational recovery. Its `needsDirection` result considers
proposed and credible candidates, retryable work, and external-evidence
blockers in addition to runnable backlog; it is not simply a test for an empty
queue.

**What closing it could look like:** define a bounded adapter from detector
findings (for example, vocabulary coverage or composition gaps) to candidate
records with provenance, deduplication, ranking, policy/dependency checks,
and explicit acceptance criteria. Only then should approved candidates enter
the existing durable-task lifecycle. `buildExecutableSupply()` summarizes
already durable or materialized work; it is not itself the detector-to-task
injection point.

**Sequencing question:** a small detector-driven task experiment might be
possible before the Knowledge Core has persistent indexed storage. Whether
that is safe and useful depends on provenance, deduplication, rollback, and
what state the experiment must retain; the dependency order needs evidence.

### Gate 4 — Backend parity

**Measured:** all seven `documentation/parity-checklist.md` items are marked
done, but only item 7 directly checks interpreter/compiled-JS/compiled-C
result parity. The compile tree has 18 `emit_*` families and four `emit_*`
directories (math, mind, native, write), while the repository has 174 verb
modules and 212,410 measured lines in the measured surface.

**What closing it looks like:** a stated rule for which verb families are
obligated to ship interpreted + JS + C together, and which ship interpreted
only behind a declared gate. The roadmap's own invariant already says
"parity-first: interpreter + JS + C ship together by default" and "feature
gates allowed when a backend lags; quizzes declare the gate" — what is
missing is the list.

**Review question:** what parity contract is needed for the capabilities this
proposal considers foundational? The existing checklist is not enough to
answer that for the full verb surface.

### Gate 5 — Demonstrated self-improvement

**Measured:** tests, verification verbs, and artifact conventions exist; a
mutation/evaluation/selection loop with an explicit improvement objective and
held-out evidence has not been demonstrated.

**What closing it looks like:** specify an objective that is broader than
passing the regression suite, preserve held-out evaluations, and retain
mutation diffs plus accept/reject evidence. The stage-7 acceptance criterion
above is a starting proposal, not an established repository contract.

## What needs work

Candidate work areas, not a committed priority order. The order should be
revisited after review of dependencies, risk, and measurable outcomes.

1. **Persistent Knowledge Core storage.** The existing claim/evidence/query
   contract is tested at its current boundary. Decide whether Week 9 requires
   entity pages keyed by `su`, lexicon/ontology/source registries, and held
   and rejected stores; then align the roadmap package's scope and acceptance
   criterion with that decision.
2. **Deterministic compound verification.** 204 records are already
   identified as verification candidates. Closing them with a repeatable
   procedure moves lexical coverage by measurement. This is a bounded
   candidate tranche; its value relative to other work still needs evaluation.
3. **Ranking-based goal formation.** Review the candidate contract in
   `documentation/suggest/self-chosen-work-candidates.md`. A detector output
   is only an input signal; candidate validation, ranking, authorization, and
   durable task materialization still need a defined end-to-end path.
4. **The fill in the compositional grid.** Eight named cells: `quantity.way`,
   `quantity.destination`, three `limit` cells, and three `sequence` cells.
   They are bounded by the validator, but size alone does not establish their
   relative priority.
5. **A declared parity rule.** A list, not a refactor.
6. **A mutation-and-selection driver.** A driver is not enough: first define
   an improvement objective, held-out evaluation, and safeguards against
   optimizing only for the quiz suite. Then test whether a traceable
   mutation/evaluate/select loop improves that objective without regressions.

## What not to do

- **Do not build a second vocabulary without a use case.** The eight
  `kwon_*.json` tables are per-language name tables, not alternative
  vocabularies. `vocabulary-runtime-parameter.md` is marked parked because it
  has no current deliverable. A loader refactor alone will not improve the
  measured coverage, but the report does not prove that every gap is content
  rather than grammar or composition.
- **Do not add a parallel agent framework.** Agent houses, sessions, channels,
  the scheduler, the duty lifecycle and the coding saddle already exist.
  Another framework beside them is duplication without a capability.
- **Do not treat code volume as a capability score.** Applications are 78% of
  this measured snapshot. That ratio is context for scope, not a verdict on
  which application work advances the foundation.
- **Do not widen the verb surface without a parity target.** Verb-module and
  compile-family counts are unlike units and do not establish a coverage
  ratio. Define the foundational capabilities and their required backend
  parity before choosing what to expand. The next useful verb is rarely the
  next useful capability.
- **Do not build a general memory store.** The knowledge core wants claims
  with evidence and provenance, not a general key-value store that claims
  then have to be projected out of.

## Review questions

1. Are these seven dimensions a useful rubric for Pyash, and which important
   capability or risk is missing? Do they need different boundaries or
   evidence standards?
2. What should the `roadmap-knowledge-core` acceptance criterion cover? Does
   the persistent indexed-store scope belong in that package, and how should
   its priority compare with the other 24 higher-ranked packages?
3. Can a bounded detector-to-durable-task experiment safely precede
   persistent Knowledge Core storage, or do provenance and recovery needs make
   that storage a prerequisite?
4. What parity obligation is appropriate for foundational capabilities?
   Should the project expand compiled coverage, declare explicit feature
   gates, or narrow the supported surface?
5. What objective and held-out evaluation would demonstrate useful
   self-improvement without merely optimizing for the quiz suite?
6. Which evidence in this review is too weak to support its conclusion? In
   particular, what end-to-end examples should be measured before deciding
   which work unblocks the most capability?

## Reproducing the measurements

```bash
# the measured surface
node command/measure_code_balance.mjs

# repository velocity and size
git rev-list --count HEAD
git rev-list --count --since="30 days ago" HEAD
ls quiz/*.test.mjs | wc -l
cat quiz/*.test.mjs | wc -l
ls documentation/specifications/*.md | wc -l
ls examples/pyash/*.pya | wc -l

# the vocabulary gap
node command/english30k_coverage.mjs
node -e 'const fs=require("node:fs"); console.log(JSON.parse(fs.readFileSync("program/library/pyashWords.json", "utf8")).length)'

# the knowledge core's place in the roadmap
grep -n "taskId: \"roadmap-knowledge-core\"" -A 20 program/runtime/work/roadmap.mjs
grep -o "priority: [0-9]*" program/runtime/work/roadmap.mjs | grep -o "[0-9]*" | sort -n

# what the knowledge core already implements, and what it does not
grep -n "^export" program/library/knowledge_core.mjs
ls program/verbs/claim.mjs
grep -n "isEvidenceSentence" program/bridge/index.mjs

# the goal-formation gap
sed -n '138,142p' program/runtime/work/curator.mjs
sed -n '272,280p' program/runtime/work/curator.mjs
sed -n '317,323p' program/runtime/work/curator.mjs

# the compiled parity surface
ls program/library/compile/ | grep "^emit_"        # 22 entries: 18 modules + 4 directories
find program/library/compile -name "*.mjs" -o -name "*.c" -o -name "*.h" | wc -l   # 132
find program/verbs -name "*.mjs" | wc -l          # 174 verb modules

# parity gates
grep -n "^Status:" documentation/parity-checklist.md
```
