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
actually stand, and what needs work?** It is an assessment, not a plan. Every
claim below carries the command that reproduces it.

The answer is short. The substrate is genuinely strong — stronger than most
projects get to, and unusually well covered. Multiplicity is strong. The
problem is that **the stages that make a GIOS a GIOS are the least finished
in this tree**: cumulative memory, open vocabulary, and goal formation. Two
of those three are partly built — the knowledge core's contract half ships and
is parity-tested, and the goal-formation gap is one line of code with a large
contract behind it — which is why they are tractable now. And the method for
self-improvement exists while the loop that would run it does not.

## What "GIOS foundation" means here

Seven stages, in dependency order. A stage is a prerequisite for the next, so
the ladder's value is in showing where the chain breaks, not in scoring.

| # | Stage | The question it answers |
|---|---|---|
| 1 | Deterministic substrate | Can the same program run identically, on more than one machine language? |
| 2 | Open meaning | Can the system hold meaning that was not anticipated when it was written? |
| 3 | Perception and action | Can it observe and act on a world outside itself? |
| 4 | Cumulative memory | Does what it learns outlive a session, with provenance? |
| 5 | Multiplicity | Can many roles run at once and be coordinated? |
| 6 | Goal formation | Can it choose what to work on, not only execute what a human wrote? |
| 7 | Self-improvement | Can it rewrite itself against a fitness function? |

This ladder is not imported from outside. Stages 1–3 are the "interlanguage"
and "compositional workflows" goals in `documentation/pyash.md`; stage 4 is
the knowledge core the roadmap already carries; stages 5–7 are the
"grown rather than hand-designed" and "evolutionary ecosystem" goals. The
stage boundary that matters most is between 3 and 4: a system that can act
but cannot accumulate is an automation, and a system that can accumulate but
cannot originate goals is a filing cabinet with hands.

## The measured surface

```
$ node command/measure_code_balance.mjs
  interpreter core     6396 lines  25 files
  verb layer          29694 lines  174 files
  applications       175957 lines  696 files
  core:applications = 1:27.51
  core share of measured = 3.0%
```

The GIOS-shaped part of the tree — the interpreter core plus `program/runtime`
(22,192 lines) plus `program/agent` (18,544 lines) — is **47,132 lines, 22% of
the 212,047 measured lines**. The other 78% is applications: meeting
pipelines, reporter stages, media tooling, the coding saddle. That ratio is
worth stating plainly, because the risk in a GIOS project is to spend on the
applications and call it progress.

Around that core:

```
$ git rev-list --count HEAD          # 4,755 commits
$ git rev-list --count --since="30 days ago" HEAD   # 474 in the last 30 days
$ ls quiz/*.test.mjs | wc -l          # 736 quiz files
$ cat quiz/*.test.mjs | wc -l         # 82,397 quiz lines
$ ls documentation/specifications/*.md | wc -l   # 24 specification files
$ ls examples/pyash/*.pya | wc -l     # 357 runnable examples
```

## The ladder, scored

### 1. Deterministic substrate — strong

The interpreter is small and the specification is real. `program/understand/`
(809 lines) parses, `program/bridge/` (5,167 lines) dispatches, and
`program/remember/` (420 lines) holds memory. Twenty-four specification files
sit under `documentation/specifications/`, including the VLIW ISA
(`27-pyash-vliw-isa.md`) and the criterion/reverie/nightmare evaluation
surface (`26-criterion.md`).

Compiled backends exist in three shapes: C (`program/library/compile/c/`, 37
files), JS (`js/`, 9 files) and native emit (`emit_native/`, 12 files), with
132 files in the compile layer overall. `documentation/parity-checklist.md`
tracks seven parity gates and **all seven read `Status: done`**.

**Verdict:** the most mature layer, and the one that would be hardest to
rebuild. This is a genuine foundation, not a veneer.

### 2. Open meaning — structurally strong, evidentially thin

The grammar is the API surface: cases, noun classes, signature-first
dispatch. That is the right shape for an open-meaning substrate — new
sentences need no new code, only new vocabulary.

But the vocabulary is not open yet. The English30k coverage report is
unambiguous:

```
$ node command/english30k_coverage.mjs
  covered 13951   unresolved 16048   coveragePercent 46.505
  compoundRecords 317   compoundDeterministic 113
  compoundVerificationCandidates 204   compoundRejected 36
```

**16,048 of 29,999 ranked English words have no representation.** Of 317
compound records, only 113 are deterministic — 204 still need verification and
36 were rejected. The compositional validator names its own unassigned cells:
`quantity.way`, `quantity.destination`, all three `limit` cells and all three
`sequence` cells.

**Verdict:** the machinery is excellent and the content is half-built. This is
the second gate, and it is a content problem, not an architecture problem —
which is why the vocabulary-parameter proposal in this folder was parked: no
refactor of the loader will add a single missing word.

### 3. Perception and action — strong and wide

174 verb modules (29,694 lines) cover the surface: `hear`, `exchange`,
`android`, `verify_platform`, `verify_loop`, `mind`, `qwen_say`. Device
bridging lives in `program/agent/android/`, ceremonies and sandpits in
`program/bridge/sandpit.mjs`, and 357 runnable examples under
`examples/pyash/` demonstrate real behaviour rather than describe it.

**Verdict:** broader than most systems ever need. This is also the part
most likely to pull effort away from stages 4 and 6, because it is the most
immediately satisfying to build.

### 4. Cumulative memory — contract shipped, storage missing

This stage is more advanced than its roadmap priority suggests, and getting it
wrong would misdirect the next tranche of work. Week 9 of
`documentation/roadmap.md` splits the knowledge core into two halves, and the
tree contains one of them.

**Shipped, and parity-tested.** `program/library/knowledge_core.mjs` (450
lines) implements the whole contract half: canonical claim keys
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

**Not shipped.** The storage half of Week 9 — entity-page format (one file
per `su`), registry files for lexicon, ontology and sources, and the held and
rejected directories keyed by `su case …` — does not exist anywhere in the
tree. Records live in memory (`resolveKnowledgeView(allRemember(), key)`),
which means they live as long as the process does.

**The roadmap package is stale in a specific, fixable way.**
`roadmap-knowledge-core` ("Implement the sentence-native knowledge core") sits
at **priority 55**, with 24 of the roadmap's 28 packages ranked above it. But
its scope bundles the shipped half with the unbuilt half, so its priority
describes the package, not the remaining work. Its own acceptance criterion —
"golden claim/evidence/resolver fixtures pass with canonical
interpreter/JavaScript/C output for the supported boundary" — is *already
satisfied* by the existing quiz.

**Verdict:** the semantic half of this stage is done. What remains is a
persistence layout, not a semantic design.

### 5. Multiplicity — strong

`program/agent/` is 18,544 lines across 51 files: agent houses with roles and
presence, sessions and session replay, channels, the scheduler and its
service control, scheduled jobs, the coding saddle, the orchestrator, and
headquarters. `program/runtime/work/` is 29 modules implementing a durable
work system — `contract`, `curator`, `runner`, `supervisor`, `queue`,
`checkpoint`, `recovery`, `preflight`, `turn_reconciliation`, `capacity`,
`timeout_policy`, `blocker_repair`.

**Verdict:** unusually well built. Most projects reach this stage by
accident, through ad-hoc concurrency and scattered state; here it is a
designed subsystem with contracts and recovery.

### 6. Goal formation — missing

The work system is executable and durable. But its candidate set is entirely
human-written. `program/runtime/work/curator.mjs:140`:

```js
const candidates = autonomousRoadmapPackages();
```

The curator selects from a list that a person wrote. When nothing is runnable
and nothing can be proposed, it stops and says so — `curator.mjs:274` and
`:319` both compute `needsDirection: runnableActive.length === 0`. The system
will execute any goal it is given, forever, and will never originate one.

**Verdict:** the third gate. This is a *one-line* gap in code and a large gap
in contract: any replacement must rank machine-derived candidates rather than
invent them, and the ranked candidates already exist — the English30k gap list
is a frequency-ordered list of 16,048 unrealised concepts, and the
compositional validator names its own holes.

### 7. Self-improvement — method present, loop absent

`documentation/pyash.md` goal 7 states the method exactly: "The quiz suite
defines what each verb + case + noun-class pattern must do. New
implementations can be proposed by LLMs or mutation. Only code that passes
quizzes is kept."

The supporting machinery is real — 736 quiz files and 82,397 quiz lines, the
`again`/refinery/artifact/verify/golden conventions, the `criterion`,
`nightmare` and `reverie` verbs, `program/runtime/criterion/`. What is
missing is the *loop*: nothing schedules mutation → evaluate → select → keep
against a fitness function. The fitness function exists (the quiz suite). The
selection exists (the quizzes gate what lands). The scheduler that would run
the cycle does not.

**Verdict:** the most interesting stage and the least built. The gap is not
conceptual — it is a missing driver, and the pieces it would drive are
already in place.

## The four gates

These are the four places where the chain breaks. They are ordered by how
much of the ladder each one holds up.

### Gate 1 — Cumulative memory (persistence, not semantics)

**Measured:** the contract half exists and is parity-tested —
`program/library/knowledge_core.mjs` (450 lines), `program/verbs/claim.mjs`
(`claim identify` / `claim choose`), evidence normalised at
`program/bridge/index.mjs:372`, and `quiz/knowledge_core.test.mjs` asserting
the same resolver view from interpreter, compiled JavaScript and compiled C.
The storage half does not exist: no entity pages, no lexicon/ontology/source
registries, no held or rejected stores; records live in memory. The roadmap
package `roadmap-knowledge-core` bundles both halves at priority 55 of 28.

**What closing it looks like:** the Week 9 storage layout — entity pages
keyed by `su`, three registry files, and held/rejected directories keyed by
`su case …` — on top of the resolvers that already exist. This is a layout
and persistence tranche, not a semantic one, and it should not re-litigate
claim keys, evidence shape or view semantics: those are frozen and pinned.

**Why it is first:** every later stage assumes knowledge persists past the
process. Goal formation over an in-memory store will originate goals it can
neither keep nor check.

### Gate 2 — Open vocabulary

**Measured:** 46.505% English30k coverage; 16,048 unresolved; 204 compound
records awaiting verification; 36 rejected; unassigned compositional cells
`quantity.way`, `quantity.destination`, three `limit`, three `sequence`.

**What closing it looks like:** not new atoms — compound-first expansion of
the existing 7,841, with a deterministic verification path for each record, so
that coverage rises by measurement rather than by assertion. The 204
verification candidates are a bounded, already-ranked tranche. The
compositional grid's own holes are a bounded second tranche.

**Why it matters:** an open-meaning substrate is only open if the meaning
that arrives unanticipated can be expressed. At 46.5%, most unanticipated
meaning cannot.

### Gate 3 — Goal formation

**Measured:** `curator.mjs:140` reads candidates only from the human-written
roadmap; `needsDirection` fires whenever nothing is runnable.

**What closing it looks like:** candidates ranked from detector output —
the coverage gap list, the compositional grid's unassigned cells — and
selected by the same durability rules the curated roadmap uses. The candidate
space stays machine-derived; a curated package always wins; every candidate
still needs a prompt and an acceptance criterion. The injection point is
`buildExecutableSupply({ durableCandidates })` in `curator.mjs:71`.

**Why it is third:** it is downstream of the other two. A system that
originates goals over an in-memory store will originate goals it cannot keep
or check, and over a half-open vocabulary will originate goals it cannot
express.

### Gate 4 — Backend parity

**Measured:** all seven `documentation/parity-checklist.md` gates are `done`,
but the compiled surface is 18 `emit_*` families plus four `emit_*` directories
(math, mind, native, write) against 174 verb modules, and 132 compile-layer
files against 212,047 measured lines of runtime.

**What closing it looks like:** a stated rule for which verb families are
obligated to ship interpreted + JS + C together, and which ship interpreted
only behind a declared gate. The roadmap's own invariant already says
"parity-first: interpreter + JS + C ship together by default" and "feature
gates allowed when a backend lags; quizzes declare the gate" — what is
missing is the list.

**Why it is fourth and not higher:** parity is a multiplication cost, not a
capability. It bites hardest exactly where the surface grows fastest, which
is the verb layer.

## What needs work

Ordered by what unblocks the most.

1. **The knowledge core's storage half.** Not the semantics — claim keys,
   evidence shape and the three views are shipped and parity-tested. What is
   missing is the Week 9 layout: entity pages keyed by `su`, the lexicon,
   ontology and source registries, and the held and rejected stores. The
   roadmap package bundles both halves at priority 55; that package should be
   re-scoped so its priority describes the work that is actually left.
2. **Deterministic compound verification.** 204 records are already
   identified as verification candidates. Closing them with a repeatable
   procedure moves coverage by measurement. This is the largest single
   available win against gate 2 and it needs no new atoms.
3. **Ranking-based goal formation.** Close `curator.mjs:140` by adding a
   ranked candidate source, not a free-form generator. The proposal in
   `documentation/suggest/self-chosen-work-candidates.md` spells out the
   contract.
4. **The fill in the compositional grid.** Six named cells. Small, bounded,
   checkable by the validator that already names them.
5. **A declared parity rule.** A list, not a refactor.
6. **A mutation-and-selection driver.** The fitness function exists. The
   driver does not. This is the stage-7 work, and it is worth doing only
   after 1–3, because a self-improving system over an in-memory store and a
   half-open vocabulary will faithfully improve the wrong things.

## What not to do

- **Do not chase a second vocabulary.** The repository has no set concept, and
  the eight `kwon_*.json` tables are per-language name tables, not alternative
  vocabularies. The parameter proposal in this folder was parked for exactly
  this reason. The coverage gap is a content problem; a loader refactor
  cannot close it.
- **Do not add a parallel agent framework.** Agent houses, sessions, channels,
  the scheduler, the duty lifecycle and the coding saddle already exist.
  Another framework beside them is duplication without a capability.
- **Do not treat the application layer as foundation.** 78% of the measured
  tree is applications. Meeting pipelines and reporter stages are the visible
  work; the ladder is decided by stages 4–7.
- **Do not widen the verb surface yet.** 174 verb modules against 18 compiled
  emit families is already a wide parity gap; the next useful verb is rarely
  the next useful capability.
- **Do not build a general memory store.** The knowledge core wants claims
  with evidence and provenance, not a general key-value store that claims
  then have to be projected out of.

## Review questions

1. Is the seven-stage ladder the right cut for this repository, or does it
   flatter the parts that are already built? Stages 1, 3 and 5 score well and
   stages 4, 6 and 7 score badly; a ladder tilted the other way would change
   the conclusion.
2. Is the knowledge core really first? The roadmap puts the whole package at
   priority 55, behind 24 others — but the package bundles a shipped contract
   half with an unbuilt storage half, and its own acceptance criterion is
   already met. If the package is re-scoped, does the storage half still come
   first, or does something above it in the queue deserve the slot?
3. Should goal formation be attempted before the vocabulary is opened? The
   dependency argument says no; a counter-argument is that goal formation is
   what produces the pressure that finds the vocabulary gaps, so the ordering
   may be circular in the other direction.
4. Is the parity obligation list the right fourth gate, or is it a tax that
   should be paid differently — for example by narrowing the interpreted-only
   surface rather than by widening the compiled one?
5. What would count as evidence that stage 7 is real? A mutation-and-
   selection driver is the mechanism, but the acceptance is the hard part.

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
