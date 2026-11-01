# The Knowledge Core: What It Is, What We Need, What We Have, and the Road

**Status:** proposal awaiting review. It defines the term, derives the
requirements from the consumers that create them, states what exists today
against that list, and proposes a sequence of tranches. It changes no code and
schedules no work.

The roadmap names the destination: `documentation/roadmap.md` Week 9 calls
for "Knowledge core v0.9 (claim identity, evidence shell, KB layout)" and
lists a **Knowledge core spec v0.1** among its spec drops. But the contract
half of that is not unwritten — it is specified today, in
`documentation/specifications/18-pyash-agent.md` §4.1 and §4.2, and the spec
index points at it: "claim identity/evidence/resolver issue ->
`18-pyash-agent.md` (bounded claim core)". What does not exist is a spec for
the other half — the KB layout, the lifecycle, and the adjudication that sits
between them.

This document therefore proposes something narrower than "define the knowledge
core": it states the definition, derives the requirements from the consumers
that create them, says what is genuinely missing, and proposes the sequence
that would close the gap. The first tranche is not writing the contract down
— it is moving it somewhere it belongs.

## 1. What a knowledge core is

The shortest statement that survives scrutiny:

> A knowledge core is a persistent, queryable store in which **claims** — not
> artifacts — are the unit of record, and where every claim carries its
> evidence, its provenance, and its state over time.

Three properties make it a *core* rather than a store. Remove any one and it
becomes something else:

1. **Identity.** Two sentences that assert the same thing must be recognisably
   the same thing, so that repetition is recognised as repetition rather than
   as growth. This is what claim keys are for.
2. **Provenance.** Every claim carries where it came from and how much weight
   it carries. A claim without a source is an assertion; a claim with a
   source and a confidence is evidence.
3. **State over time.** A claim is not a boolean. It is current, contested,
   held, rejected, or eligible for resurrection. A store that only appends
   cannot answer "what do we believe now, and why".

That third property is the one that makes this a *knowledge* core rather than a
database. The purpose is not to keep everything; it is to keep what survives,
and to be able to say why.

### Why Pyash needs one, in the repository's own terms

`documentation/pyash.md` names three ambitions that a knowledge core serves
directly:

- **"LLM-friendly representation … Behaviour is encoded in small, focused
  tests that models can learn from and extend."** A model that proposes a
  claim needs somewhere to put it that can tell it apart from what is already
  believed. Without identity, every proposal is a new fact.
- **"Compositional workflows as a proving ground … Pipelines are inspectable
  and serializable."** A pipeline that emits claims can be inspected claim by
  claim, not artifact by artifact.
- **"Evolutionary ecosystem … New implementations can be proposed by LLMs or
  mutation. Only code that passes quizzes is kept."** The evolutionary loop
  needs a place where "what we believe" is a durable object that a later run
  can be measured against, or there is no fitness function to optimise.

The core is also the hinge between the repository's two halves. The verb layer
and the application layer (78% of the measured surface) produce artifacts:
reports, transcripts, digests. The core is what converts artifacts into
claims that can accumulate.

### What it is not

These boundaries matter, because each of them is a thing the project has
been tempted by:

- **Not a vector store.** Similarity search does not answer "is this the same
  claim" and cannot express "these two claims conflict".
- **Not a general key-value store.** The unit is a claim with a key derived
  from its meaning, not a record under a name.
- **Not a transcript store.** `program/remember/` and the agent house memory
  layers already hold what was said; the core holds what is *believed*.
- **Not model-dependent.** A claim's truth does not come from a model's
  confidence; the confidence field is evidence about a source, not a score
  from a scorer.

## 2. What we need from it

Twelve requirements, each traced to the consumer that creates the need. The
status column is measured: it says what the tree satisfies today, not what a
reviewer should conclude.

| # | Requirement | Created by | Status |
|---|---|---|---|
| R1 | Stable claim identity across aliases, case order and time windows | Week 9 claim-key derivation | **met** |
| R2 | Evidence carries evidential type, confidence and source anchor | Week 9 evidential shell | **met** |
| R3 | Three query views: current, contested, provenance | Week 9 query views | **met** |
| R4 | Persistent indexed storage: entity pages, lexicon/ontology/source registries, held and rejected stores | Week 9 KB layout | **absent** |
| R5 | Source registration and deterministic anchoring | Week 10 source ingest and anchoring | **partial** |
| R6 | Conflict detection: same key, different value, overlapping validity | Week 11 conflict detection | **absent** |
| R7 | Case lifecycle, role tagging, judge scoring, deterministic verdict | Week 11 case protocol | **absent** |
| R8 | Dispositions: promote, hold, reject with reasons | Week 11 promotion and archive | **absent** |
| R9 | Resurrection of a rejected claim on accumulating evidence | Week 12 resurrection triggers | **absent** |
| R10 | Answer flow with citations, contested state surfaced | Week 12 local Llama demo | **absent** |
| R11 | Interpreter / JS / C parity over the same snapshot | Week 9 and 11 parity gates | **partial** |
| R12 | Scale beyond a fixed record cap | the compiled backend's own limit | **absent** |

"met" means both implemented and specified: R1–R3 are stated normatively in
`documentation/specifications/18-pyash-agent.md` §4.1 and §4.2 and exercised
by `quiz/knowledge_core.test.mjs`.

A note on R5 and R11, because both are partial rather than absent:

- **R5.** `program/library/document_digestion.mjs` (537 lines) already does
  source ids, artifact hash verification, byte-span validation, a canonical
  digest stream and replayable digestion. What it does not do is register
  sources as claims. `su src` appears in the repository only in
  `documentation/roadmap.md:797`; it appears nowhere in `program/`.
- **R11.** Parity is proven for the contract half — `quiz/knowledge_core.test.mjs`
  asserts the same resolver view from the interpreter, compiled JavaScript and
  compiled C. It is not proven for storage, because storage does not exist to
  be compared.

### The requirements the roadmap does not state

Two needs come from consumers outside the knowledge core's own week plan, and
both will be felt before Week 9's scope is finished.

**A knowledge core that can be evaluated.** The self-chosen-work path needs
to compare a finished task against what was believed before and after. The
claim contract already gives that a shape: the claim key identifies *what*,
the confidence and provenance identify *how well supported*, and the current
versus contested views give the comparison. But nothing yet writes a task
outcome back as a claim, so the loop cannot close.

**A knowledge core that holds more than a demo.** The compiled C backend
carries a fixed capacity:

```
program/library/compile/transpile_program/c_helpers_knowledge_core.mjs:2
#define PYA_KNOWLEDGE_MAX 256
```

and `pya_knowledge_fail("record count")` on overflow — the compiled path
reports the overflow rather than silently dropping evidence, which is the
right behaviour and also a hard ceiling. A knowledge base that must hold a
corpus will not fit in 256 records. Whatever the storage turns out to be, the
compiled path needs a way to read from it rather than to hold it.

## 3. What we have so far

### The contract — implemented, tested, and specified

`program/library/knowledge_core.mjs` (450 lines) is the whole contract half.
It is not an undocumented implementation: `documentation/specifications/18-pyash-agent.md`
§4.1 ("Bounded sentence-native claim core") and §4.2 ("Linked claim bundles")
state it normatively, and `00-index.md:55` routes claim questions there. The
spec fixes the identity fields, the three required provenance fields, the
supported evidential names, the `source#anchor` normalisation, the `0..1`
confidence range, the public `claim identify` / `claim choose` calls, the view
semantics, and the single locale-independent UTF-8 comparison rule. It even
draws its own boundary: *"This slice does not define hashing or entity
aliases."*

That boundary is the whole of the gap. Everything the spec covers exists in
code and in tests; everything the spec defers is the subject of this
document.

Its exports, and what each one is for:

| Export | Responsibility |
|---|---|
| `compareUtf8Bytes`, `canonicalJson` | locale-independent canonical ordering |
| `normalizeTimeWindow` | `since`/`until` date pairs, or timeless; rejects `during` and half-open windows |
| `normalizeClaimSentence` | canonicalises subject, predicate (through `resolveVerbAlias`), scope and window |
| `deriveClaimKey` / `claimKey` / `deriveClaimIdentity` | the claim identity: `su`, window, `as` scope, `be` predicate |
| `isEvidenceSentence` | recognises `accordingto name <kind>-evidential` |
| `normalizeEvidence` | key, payload, evidential, confidence, source, anchor, `anchorId`, canonical sentence |
| `evidentialName` | `direct` / `reported` / `inferential` |
| `normalizeLinkedClaimBundle`, `deriveLinkedClaimSubjectKey` | entity bundles grouped by facet |
| `resolveLinkedClaimBundle` | per-facet resolution; a facet with several keys projects a `claims` view rather than merging |
| `resolveCurrentView`, `resolveContestedView`, `resolveProvenanceView`, `resolveKnowledgeView` | the three views and their dispatcher |

The design decisions embedded in it are worth stating, because they are the
parts a reviewer would otherwise have to reverse-engineer:

- **The claim key is the identity of the *assertion*, not the evidence.**
  Evidence about the same assertion carries the same key and is selected among
  by anchor, then confidence, then canonical sentence.
- **A facet with more than one key is never merged.** `resolveLinkedClaimBundle`
  exposes a `claims` projection and says `status: "multiple"`. Conflicts are
  surfaced, never adjudicated silently.
- **Confidence is bounded and required.** `by num` must be present and within
  0..1; a missing confidence is a defect, not a default.
- **A time window is a pair or nothing.** `since` without `until`, or `during`,
  is rejected.
- **Ordering is by UTF-8 bytes, not by locale.** Everything canonical is
  compared byte-wise so that a snapshot is identical across machines.

### The surface — small, real, and exercised

`program/verbs/claim.mjs` (26 lines) exposes two verbs:

```
su name claim ob la su name weather as name public since date 2026-01-01 until date 2026-01-31 be text ya ko be claim identify do
su name claim ob la su name weather as name public since date 2026-01-01 until date 2026-01-31 be text ya ko be claim choose do
```

`claim identify` derives the key; `claim choose` resolves the view over
`allRemember()`.

Evidence enters through the bridge. `program/bridge/index.mjs:370-374`
recognises an evidence sentence on the `ya` mood, normalises it, and records
it into memory:

```
exists su name weather ob text "clear" as name public since date 2026-01-01 until date 2026-01-31 \
  fromtext la su name weather-report-a ob text "paragraph-1" be text ya ko \
  accordingto name reported-evidential by num 0.4 be text ya
```

### The verification — real and cross-backend

Four quizzes cover the knowledge core directly:

- `quiz/knowledge_core.test.mjs` pins claim-key equality across predicate
  aliases and case order, timeless versus windowed claims, UTF-8 ordering, the
  evidential fixture, conflict selection by confidence, and the same resolver
  view rendered by the interpreter, compiled JavaScript and compiled C.
- `quiz/claim_core_public.test.mjs` pins the public surface, the malformed
  cases, and that the golden output is byte-identical across `run`, `runjs`
  and `runc`.
- `quiz/headquarters_knowledge_alignment.test.mjs` pins the domain projection
  against the shared contract.
- `quiz/document_digestion.test.mjs` pins the source side, including replay.

`examples/pyash/claim-core-golden.pya` with `quiz/fixtures/claim-core-golden.txt`
is the golden corpus, including the contested, the multi-key and the
duplicate-anchor cases. `program/library/compile/emit_claim.mjs` and
`emit_knowledge.mjs` carry the contract into the compiled backends, with C
helpers in
`program/library/compile/transpile_program/c_helpers_knowledge_core.mjs`.

Two further quizzes — `article_claims_verifier.test.mjs` and
`financial_claim_audit.test.mjs` — check claims *in application text*, and do
not use the knowledge core. They are a different subject and are not counted
here.

### It is already load-bearing

The most consequential thing in the tree is not in the knowledge core's own
directory. **Fourteen modules import `program/library/knowledge_core.mjs`:**

| Consumer | What it takes | Why it matters |
|---|---|---|
| `program/remember/index.mjs` | `isEvidenceSentence` | the memory layer decides what may be garbage-collected |
| `program/runtime/work/queue.mjs`, `status.mjs` | `compareUtf8Bytes` | the durable work system's canonical ordering |
| `program/agent/channel_core/queue.mjs` | `compareUtf8Bytes` | the channel queue's canonical ordering |
| `program/agent/headquarters/layout.mjs`, `state.mjs`, `briefing.mjs` | `canonicalJson`, `compareUtf8Bytes`, resolvers | headquarters state and briefing |
| `program/verbs/claim.mjs` | key derivation, view resolution | the public surface |
| `program/bridge/index.mjs` | `isEvidenceSentence`, `normalizeClaimSentence`, `normalizeEvidence` | evidence normalisation on entry |
| `program/library/compile/emit_claim.mjs`, `emit_knowledge.mjs`, C/JS preludes | the whole contract | compiled parity |

Two consequences follow, and they should shape the whole road.

**First, the contract is infrastructure, not a proposal.** The work system's
queue ordering, the channel queue's ordering and the headquarters briefing
all depend on the knowledge core's canonical ordering. Changing the contract
is a repository-wide change, not a change to one subsystem.

**Second, the memory layer already preserves what conflict detection will
need.** `program/remember/index.mjs:269-274` exempts evidence sentences from
the usual "latest fact for a subject replaces the older one" rule, and
exempts existing evidence from being displaced. Two conflicting claims about
the same `su` therefore both survive in memory. That is precisely the
condition Week 11's conflict detector requires, and it is already in place —
untested as a conflict surface, but in place.

The repository also has a **holding lane** (`program/agent/holding_lane/`) — a
generic file-backed spool with named lanes, of which `work` (the durable task
queue), `gpu` and `criterion` are three users. It is *not* the knowledge
core's held store, and the shared word is a trap: Week 11's held store holds
*claims awaiting adjudication*, while the holding lane holds *queued work
items*. They are different subjects and should not be built on the same
mechanism without a decision about why.

### Adjacent work that is not the core

Four things in the tree look like the knowledge core and are not. They matter
because each is a piece of the eventual system that already exists and should
not be rebuilt.

- **`program/library/document_digestion.mjs`** — source ids, artifact hashes,
  byte spans, a canonical digest stream and replay. This is the *source*
  side of Week 10, not the claim side.
- **`program/agent/headquarters/knowledge.mjs` with
  `module/headquarters-knowledge.pya`** — a domain schema declaring which
  fields each entity kind requires (`bet`, `person`, `company`, `contacting`,
  `relations`, `duty`, `deadline`), a projection over resolved bundles, and
  cross-reference validation against entities and work-task ids. This is a
  working prototype of the ontology/registry idea Week 9 asks for, scoped to
  one domain. It is the most valuable thing to learn from when the generic
  registry is designed, and it should not be thrown away.
- **`know/`** — roughly 2.3 GB: `input` (source material), `produce`
  (generated artifacts), `wordnet` (lexical data). This is a corpus, not a
  knowledge base.
- **Agent memory** (`documentation/agent-memory.md`) — the in-memory runtime
  layer plus the file-backed agent house (`session/`, `memory/SUMMARY.md`,
  `memory/MEMORY.md`, daily notes). Durable, but it holds *what was said*, not
  *what is believed*.

### The honest summary

**The contract exists. The core does not.** The distinction is not semantic.
A contract answers "what does a claim mean?"; a core answers "what do we
believe, where did it come from, and what happened to it since?" The first is
specified, implemented, tested and byte-stable across three backends. The
second has no storage, no registry, no lifecycle and no scale.

The spec makes the same cut from the other side. `18-pyash-agent.md` §4.1
ends with "This slice does not define hashing or entity aliases" — the
contract knows its own edge, and the edge is exactly where the core begins.

## 4. The road from here to there

Six tranches. The order is a proposal, not a dependency proof — the same
discipline as the foundation analysis — and a reviewer may reorder it. What is
proposed is that each tranche be independently accepted, because each one
leaves the repository in a state that is better than the one before it.

### T0 — Separate the knowledge core from the agent spec

**What exists:** the contract, specified in
`documentation/specifications/18-pyash-agent.md` §4.1 and §4.2, implemented in
`program/library/knowledge_core.mjs`, covered by four directly exercising
quizzes, and — as section 3 showed — load-bearing across seven subsystems
including the work system, the channel queue and the compiled backends.
**What is needed:** a home for the contract that reflects what it has become.
§4.1 and §4.2 are filed under "Pyash Agent" because that is where they were
written, not because they are an agent concern; fourteen modules import the
contract, and the work system's durable queue ordering *is* this contract's
canonical ordering. The roadmap's named **Knowledge core spec v0.1** drop is
best read as the spec for what the agent spec explicitly defers.
**Exit criterion:** `documentation/specifications/28-knowledge-core.md` carries
the claim identity rule, the canonical ordering rule, the evidential shell
schema and the source/anchor identity rules — the four items Week 9 lists
under "Spec drops" — with the agent spec pointing at it, and the boundary the
agent spec already draws ("does not define hashing or entity aliases") carried
across unchanged. The existing quizzes continue to pass unchanged, which is
what makes the move safe.
**Why first:** every later tranche cites the contract, and citing it through
a chapter titled "Memory" inside the agent spec will keep producing the
mistake this document exists to correct. A spec written after the storage
exists will describe the storage and quietly redefine the contract that seven
subsystems already depend on.
**Out of scope:** changing claim keys, evidence shape or view semantics. This
tranche moves text and adds a pointer. It must not restate the rules
differently, because a second wording of the same rule is how a contract
splits.

### T1 — The KB layout

**What exists:** the three resolvers, over records held in process memory, and
the contract that already says what it does not cover: *"This slice does not
define hashing or entity aliases."*
**What is needed:** Week 9's storage half — entity pages keyed by `su`, the
lexicon, ontology and source registries, and the held and rejected stores
keyed by `su case …` — and the **KB layout spec v0.1** that specifies them.
That spec is the one genuinely unwritten document in the sequence. The
`module/headquarters-knowledge.pya` schema is the closest existing model for
the registry layer and should be generalised rather than replaced.
**Exit criterion:** the KB layout spec exists and names the storage medium,
the entity-page format, the three registries and the two stores; a KB snapshot
can then be written, read back and compared byte-for-byte; the three views
resolve from the snapshot rather than from `allRemember()`; and the
interpreter, compiled JavaScript and compiled C produce the same view over the
same snapshot.
**Explicitly out of scope:** adjudication, resurrection, and any change to how
a claim is identified or resolved.
**Open question for review:** is the KB a directory of Pyash sentence files, a
set of JSON artefacts, or something else? The repository's habits point at
Pyash sentence files (`module/headquarters-knowledge.pya`, `know/produce/*.metadata.pya`),
but the choice belongs in the KB layout spec, not in an implementation.

### T2 — Sources and anchors

**What exists:** digestion with source ids and byte spans.
**What is needed:** `su src …` registration for each source artifact, and the
mapping from document offsets to the anchor ids that `normalizeEvidence`
already accepts in `fromtext`.
**Exit criterion:** a digested document produces registered sources and
anchored evidence sentences, and replaying the digestion produces identical
anchors — the replay property `document_digestion.mjs` already provides at the
digest level, applied at the claim level.
**Dependency:** T1, because anchored evidence has to land somewhere.

### T3 — Conflicts

**What exists:** the `contested` view and the `multiple` facet projection.
**What is needed:** Week 11's conflict rule — same claim key, different value,
overlapping validity — and `su conflict …` summaries.
**Exit criterion:** a seeded conflict pair is detected and reported, and the
detector is deterministic under replay. Detection only: no case, no verdict.

### T4 — Cases and adjudication

**What exists:** nothing.
**What is needed:** the `su case <id>` lifecycle, role tagging via `as`,
reason codes, deterministic scoring and verdict, and the three dispositions.
**Exit criterion:** a golden conflict pack — scope mismatch, unit mismatch,
window overlap, alias-induced — produces identical case files and verdicts
across interpreter, JS and C. This is the largest tranche in the sequence and
the one most likely to need its own spec drop (**Adjudication spec v0.1**).
**Out of scope:** resurrection, which is the next tranche.

### T5 — Resurrection and the seed pack

**What exists:** nothing.
**What is needed:** Week 12's resurrection triggers — reopen a rejected claim
when independent evidence accumulates past a threshold, with a fresh case id
linked back to the earlier rejection — and the encyclopedia seed pack that
exercises the whole loop: lexicon, ontology, sources, entity pages, held,
rejected, cases.
**Exit criterion:** initial ingestion produces held and rejected items; later
ingestion triggers resurrection and promotion; the final KB snapshot matches
across backends. The four golden demos Week 12 names are the acceptance.

### T6 — Scale and hardening

**What exists:** a 256-record ceiling in the compiled backend.
**What is needed:** a way for the compiled path to resolve from the KB rather
than to hold it, so that the ceiling stops being the size of the knowledge
base. Alongside it, the replay guarantees at KB scale: the same seed and the
same evidence set produce the same snapshot.
**Exit criterion:** the golden end-to-end demos run at a scale that would
exceed the current cap, on all three backends.

### The tranche that is not in this list

**Scaling the claim contract into the work system** — writing a task outcome
back as a claim, so that finished work updates what the system believes. It
is deliberately absent, because it couples the knowledge core to the work
system's contracts, and because it is the piece most likely to be wrong. The
foundation analysis treats ranking-based goal formation as a gate whose
sequencing is still open. It should be added when the KB layout is decided,
not before, because the shape of a recorded outcome depends on where the
outcome is stored.

## 5. Review questions

1. Is the definition in section 1 the right one? In particular: is
   *identity, provenance, and state over time* the right set of properties, and
   is anything missing that would make the core more than a well-organised
   log?
2. Are the twelve requirements complete, and are the four boundaries
   ("not a vector store", "not a key-value store", "not a transcript store",
   "not model-dependent") the right exclusions?
3. Does T0 come first? Moving the contract out of the agent spec is a
   mechanical move, and it is arguable that it should wait until the KB layout
   gives it a section worth being the first part of. The argument for doing
   it first is that seven subsystems already depend on it and the next person
   to read it will look for it under "Pyash Agent".
4. Should T2 (sources) precede T1 (layout)? Anchored evidence that has
   nowhere to land is not useful, but a layout with no anchored evidence in it
   is an empty shell.
5. What is the right storage medium — Pyash sentence files, JSON artefacts,
   or something else — and does that choice belong in the KB layout spec or
   ahead of it?
6. Is the compiled 256-record ceiling a real constraint on the design, or an
   artifact of the C backend that T6 should simply replace?
7. What would show that the knowledge core is earning its place? A
   measurement, not a feature list.

## 6. Reproducing the measurements

```bash
# the contract, in full
wc -l program/library/knowledge_core.mjs
grep -n "^export" program/library/knowledge_core.mjs

# the surface
cat program/verbs/claim.mjs
cat examples/pyash/claim-core-golden.pya

# the wiring
sed -n '368,376p' program/bridge/index.mjs

# the verification
ls quiz/ | grep -E "claim|knowledge|digest"
node --test quiz/knowledge_core.test.mjs quiz/claim_core_public.test.mjs

# who already depends on the contract
grep -rl "knowledge_core.mjs" --include=*.mjs program/ | sort
grep -rl "knowledge_core.mjs" --include=*.mjs program/ | wc -l   # 14

# the memory layer protects evidence from collection
sed -n '266,278p' program/remember/index.mjs

# the compiled path and its ceiling
grep -rn "PYA_KNOWLEDGE_MAX" program/library/compile/transpile_program/c_helpers_knowledge_core.mjs

# the holding lane is a spool with named lanes, not the held store
grep -rn "lane: \"" --include=*.mjs program/ | head

# what exists and what does not
ls documentation/specifications/ | grep -iE "knowledge|claim|kb"    # empty: no standalone spec
grep -n "Bounded sentence-native claim core" documentation/specifications/18-pyash-agent.md
grep -n "claim identity/evidence/resolver" documentation/specifications/00-index.md
grep -rn "su src" --include=*.mjs --include=*.pya program/            # empty: not registered
grep -rn "su conflict\|su case" --include=*.mjs program/              # empty: not implemented

# the adjacent pieces
wc -l program/library/document_digestion.mjs
cat module/headquarters-knowledge.pya
du -sh know/*

# the roadmap this document proposes to follow
sed -n '730,790p' documentation/roadmap.md
```
