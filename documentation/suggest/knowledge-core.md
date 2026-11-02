# The Knowledge Core: What It Is, What We Need, What We Have, and the Road

**Status:** proposal awaiting review. It defines the term, derives requirements
from roadmap commitments and identified downstream needs, states what exists
today against that list, and proposes a sequence of tranches. It changes no
code and schedules no work.

**Direction taken by the owner:** the knowledge core's authoritative
representation is **VLIW by default**, and its processing is **Rust**. The
repository already holds most of that: a `.pyac` pack format, a `.pya` catalog
format whose contract explicitly carries semantic identity, provenance and
replay expectations, a Rust crate (`rust/pyac`) that reads both, and a
compatibility discipline that names every unsupported semantic rather than
guessing. The sections below say what the direction changes, what it costs,
and which three decisions it does not settle.

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
core": it states the definition, derives requirements from roadmap commitments
and identified downstream needs, says what is genuinely missing, and proposes
the sequence that would close the gap. The first tranche is not rewriting the
contract — it is moving it somewhere its scope is visible and updating its
index entry.

## 1. What a knowledge core is

The shortest statement that survives scrutiny:

> A knowledge core is a persistent, queryable store of canonical claim
> identities and the evidence records associated with them. It preserves
> provenance and validity, derives current views, and records adjudication
> outcomes without confusing those separate concerns.

Three properties make it a *core* rather than a store. Remove any one and it
becomes something else:

1. **Identity.** Equivalent assertion slots share a stable identity under the
   specified alias, scope, and validity rules. Repeated evidence then adds
   support to that identity instead of silently creating unrelated records.
2. **Evidence and provenance.** Evidence records retain their payload,
   source, anchor, evidential type, and confidence metadata. A claim identity
   can have multiple payloads or evidence records; the store must preserve
   those distinctions rather than collapse them.
3. **Time and adjudication.** Validity intervals, query views, and case
   dispositions are distinct. `current`, `contested`, and `provenance` are
   resolver views; `held`, `rejected`, and `promoted` are lifecycle outcomes.
   Resurrection is a transition rule, not another resolver view.

Together these properties let the system answer what evidence supports a
claim, what validity it asserts, how the claim resolves now, and what
adjudication has happened. Keeping evidence is not the same as endorsing it.

These are separate dimensions, not values of one overloaded `status` field:

| Dimension | Meaning | Current or proposed representation |
|---|---|---|
| Claim identity | The normalized assertion subject, scope, and predicate | Current claim key; includes the exact `since`/`until` pair when present |
| Evidence | A source-anchored observation supporting a payload for that identity | Current evidence sentence and normalized evidence record |
| Validity | The time interval during which the payload is asserted | Current exact date-pair fields; endpoint inclusivity is not specified |
| Resolver view | A deterministic projection over evidence | Current `current`, `contested`, and `provenance` views |
| Adjudication | A decision process and its durable outcome | Proposed case lifecycle and `promoted`, `held`, `rejected`, or `request-more-evidence` outcome |

In particular, the current `contested` view groups evidence by the exact claim
key. It is not yet a cross-window conflict detector. The conflict tranche below
proposes detecting conflicts across distinct temporal keys without changing
the existing claim-key contract.

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
- **Not truth-by-model-score.** The current contract requires a finite
  `by num` value and uses it in deterministic evidence ordering. It does not
  define that value as source reliability or as an objective probability of
  truth. The lifecycle spec must define who supplies it and what it means;
  model output alone does not establish truth.

## 2. What we need from it

Fourteen requirements, traced to roadmap commitments or identified downstream
needs. The origin column names that source; it does not imply that every
consumer is already implemented. The status column describes the current
tree, not the priority of the requirement.

| # | Requirement | Origin | Status |
|---|---|---|---|
| R1 | Deterministic claim keys across predicate aliases and case order, with exact validity window included | Week 9 claim-key derivation | **met** |
| R2 | Evidence carries evidential type, confidence and source anchor | Week 9 evidential shell | **met** |
| R3 | Three query views: current, contested, provenance | Week 9 query views | **met** |
| R4 | Persistent indexed storage: entity pages, lexicon/ontology/source registries, held and rejected stores | Week 9 KB layout | **absent** |
| R5 | Source registration and deterministic anchoring | Week 10 source ingest and anchoring | **partial** |
| R6 | Conflict candidates across temporal keys, with payload and scope compatibility | Week 11 conflict detection; key/window reconciliation needed | **absent** |
| R7 | Case lifecycle, role tagging, judge scoring, deterministic verdict | Week 11 case protocol | **absent** |
| R8 | Outcomes: promote, hold, reject, or request more evidence, each with reasons | Week 11 promotion and archive | **absent** |
| R9 | Resurrection of a rejected claim on accumulating evidence | Week 12 resurrection triggers | **absent** |
| R10 | Answer flow with citations, contested state surfaced | Week 12 local Llama demo | **absent** |
| R11 | Interpreter / JS / C parity over the same snapshot | Week 9 and 11 parity gates | **partial** |
| R12 | Scale beyond the current C record cap, at a defined workload and latency target | Current C implementation limit; product target undecided | **open** |
| R13 | The authoritative persisted representation is the VLIW pack, with a `.pya` catalog as its semantic index | Owner direction: VLIW by default | **open** |
| R14 | Core processing — normalization, claim-key derivation, view resolution — is owned by the Rust crate | Owner direction: processed with Rust | **open** |

"met" means both implemented and specified: R1–R3 are stated normatively in
`documentation/specifications/18-pyash-agent.md` §4.1 and §4.2 and exercised
by `quiz/knowledge_core.test.mjs`.

A note on R5 and R11, because both are partial rather than absent:

- **R5.** `program/library/document_digestion.mjs` already creates stable
  `src-<hash>` source ids, source artifact records, anchored markers, artifact
  hash verification, byte-span validation, a canonical digest stream, and
  replayable digestion. What is missing is integration of those records with a
  persistent, generic source registry in the knowledge base. The program does
  not yet emit or consume the roadmap's proposed `su src …` registration
  contract; the existing digest artifact is not itself that registry.
- **R11.** Parity is proven for the contract half — `quiz/knowledge_core.test.mjs`
  asserts the same resolver view from the interpreter, compiled JavaScript and
  compiled C. It is not proven for storage, because storage does not exist to
  be compared.

### The requirements the roadmap does not state

Two needs come from consumers outside the knowledge core's own week plan, and
both will be felt before Week 9's scope is finished.

**A knowledge core that can be evaluated.** The self-chosen-work path needs
to compare a finished task against what was believed before and after. The
claim contract gives that comparison a shape: the claim key identifies an
assertion slot, evidence and provenance record what supports a payload, and
the current versus contested views expose different projections. The meaning
of the confidence number remains unspecified. Nothing yet writes a task
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

- **The claim key identifies an assertion slot, not its `ob` payload.**
  Subject, scope, predicate, and (when present) the exact validity window form
  the key. Different payloads under that key remain visible as contested.
  Duplicate evidence for the same payload is selected deterministically by
  confidence, then anchor, then canonical sentence.
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

**Second, the memory layer preserves evidence that a conflict detector can
inspect.** `program/remember/index.mjs:269-274` exempts evidence sentences from
the usual "latest fact for a subject replaces the older one" rule, and
exempts existing evidence from being displaced. This retention is a useful
input guarantee, not conflict detection: exact-key resolver behavior does not
find conflicts between different validity windows, and memory does not decide
whether two retained payloads actually conflict.

The repository also has a **holding lane** (`program/agent/holding_lane/`) — a
generic file-backed spool with named lanes, of which `work` (the durable task
queue), `gpu` and `criterion` are three users. It is *not* the knowledge
core's held store, and the shared word is a trap: Week 11's held store holds
*claims awaiting adjudication*, while the holding lane holds *queued work
items*. They are different subjects and should not be built on the same
mechanism without a decision about why.

### The VLIW and Rust stack that already exists

The owner's direction is not greenfield. The repository already holds the
container format, the catalog contract, and a Rust crate that reads both.

**The pack.** A `.pyac` file is a fixed-width binary projection: magic
`PYACVLIW`, 16-bit words, sixteen words per codelet, a 32-byte header,
little-endian per word (`documentation/reference/pyac-vliw-database.md` §2).
It is content-addressed — the catalog carries a `pack hash`, and each record
carries its own `codeletHash`.

**The catalog.** The same reference document states the relationship exactly:

```text
canonical Pyash `.pya` sentences
  -> searchable `.pya` catalog
  -> executable `.pyac` codelet pack
```

> The catalog carries semantic identity, provenance, compatibility status,
> source text references, codelet hashes, and replay expectations. The `.pyac`
> pack carries exact legacy VLIW words. The catalog is the searchable semantic
> index; the pack is the executable byte projection.

That is the shape a knowledge core wants, already written down: provenance
and identity live in the catalog, meaning lives in the pack.

**The Rust crate.** `rust/pyac` is 930 lines — `lib.rs` (pack codec, numeric
codelet execution), `catalog.rs` (`parse_catalog_pya`), `semantic.rs`
(numeric arithmetic and plus), plus a shared fixture at
`rust/pyac/tests/fixture_catalog.pya`. It is `#![forbid(unsafe_code)]`,
edition 2024, and its only dependency is `serde_json`. It has been developed
in eight commits, the most recent on 2026-10-23.

**The JavaScript reference path.** `command/pyac_database.mjs` exposes
`build`, `build-translation`, `query` and `replay` over the same contracts,
and `program/library/vliw/` (3,334 lines) is the broader semantic facade.

**The compatibility discipline.** `27-pyash-vliw-isa.md` §4.3 requires an
auditable compatibility table, and the database reference records unsupported
semantics with explicit reasons rather than silent fallbacks:
`unsupported-vector`, `unsupported-date`, `unsupported-invert`,
`unsupported-exponential`, `unsupported-remains`
(`documentation/reference/pyac-vliw-database.md` §7). This is the pattern the
knowledge core should adopt for claims it cannot encode.

**Three things the direction does not get for free.**

1. **The Rust side is not built anywhere.** `rust/pyac` is not compiled by
   any workflow, no npm script invokes it, and there is no `cargo` on this
   machine. Nothing currently proves the crate still compiles. The reference
   document's own instruction — `cargo fmt --manifest-path rust/pyac/Cargo.toml
   -- --check` and `cargo test --manifest-path rust/pyac/Cargo.toml` — is
   written down but never executed by CI.
2. **The direction of travel is currently the opposite.** Today JavaScript
   produces and Rust consumes: the JS semantic facade is "the broader
   reference executor", and Rust's coverage is "deliberately limited to
   proven adapters". "Processed with Rust" inverts that, which means the
   knowledge core's Rust implementation becomes the authority and the
   JavaScript one becomes the parity reference for the fourteen modules that
   depend on it.
3. **The VLIW layer resolves against a static vocabulary at import time.**
   `program/library/vliw/phrase.mjs:26-32` builds `entriesByPya` and
   `grammarPya` when the module loads, from the fixed atom table. If the
   knowledge core's representation is VLIW, that layer becomes the knowledge
   core's storage vocabulary, and its coupling grows rather than shrinks. The
   vocabulary-parameter proposal in this folder was parked because no second
   vocabulary existed to justify the refactor; this direction does not change
   that, but it does raise the cost of leaving the coupling in place.

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

Seven tranches. The order is a proposal, not a dependency proof — the same
discipline as the foundation analysis — and a reviewer may reorder it. What is
proposed is that each tranche be independently accepted, because each one
leaves the repository in a state that is better than the one before it.

One tranche carries a direction the owner has already taken: **the knowledge
core's authoritative representation is VLIW, and its processing is Rust.** T1
and T6 are where that lands. It does not run through the whole sequence —
T0 through T5 are mostly independent of it — but it is not optional either,
and the two things it needs (a build story, and a decision about compiled C)
are named rather than assumed.

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
across unchanged. Update `documentation/specifications/00-index.md` so its
quick lookup routes claim identity/evidence/resolver questions to the new spec,
and remove stale pointers to the moved section. The existing quizzes continue
to pass unchanged, which is what makes the move safe.

Two notes that make the move cheaper than it looks, and one that makes it
need care. No document references §4.1 or §4.2 by section number — every
pointer in the tree names the file `18-pyash-agent.md` as a whole — so only
`00-index.md:55` actually routes claim traffic. And
`documentation/recipes/spec-archive/18-pyash-agent.full.md` is **not** a
mirror of the live spec: it is an archived full text with its own section
numbering (its §4.1 is "Bootstrap files"), so it does not need to change.
The care is that `documentation/recipes/spec-archive/23-configure.full.md:363-364`
already points at `documentation/specifications/18-pyash-agent.md` sections
`13.1` and `13.2` — sections the live spec does not have, since it ends at
§9. That pointer is broken today and is unrelated to this move, but T0 is
touching this file's indexing and should notice it rather than inherit it.
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

**Recommended format policy (revised by the owner's direction):** the
authoritative persisted state is the **VLIW pack**, with a `.pya` catalog as
its searchable semantic index — the same pair
`documentation/reference/pyac-vliw-database.md` already specifies for the Pyac
database, not a new `.pya` segment/manifest design. The pack is content-
addressed, so a snapshot's identity is its hash rather than a manifest's
version number, and each record carries its own `codeletHash`.

The commit rule follows from that pair. Write new codelets into a new pack
segment, flush it, then atomically replace the catalog under a single-writer
lock; a crash before the catalog swap leaves an unreferenced segment, a crash
after it leaves the complete new state. Concurrent writers must serialize or
use an equivalent transaction rule so no committed segment is lost. Derived
indexes may use an optimized, implementation-managed format, but they are
disposable, deterministically rebuildable caches, never a second source of
truth.

**What this means for the claim contract.** A codelet carries the *meaning* of
a sentence — its words, its case and verb markers, its mood — not the
metadata a claim also needs. Scope (`as`), validity window (`since`/`until`),
evidential type (`accordingto`), confidence (`by num`) and the source anchor
(`source#anchor`) therefore belong in the catalog row, alongside the semantic
identity and provenance the catalog contract already names. That makes the
catalog row's schema the knowledge core's schema, and it is the first thing
the KB layout spec has to specify.

**The expressibility constraint has to be stated, not assumed.** The VLIW
backend supports a *proven subset*: numeric plus, quote descriptors, generic
fixed-slot decoding, typed literals, named scalar facts, and the database and
facade slices. Dates are explicitly `unsupported-date`, vectors
`unsupported-vector`. A claim with a validity window carries two dates. So
"VLIW by default" cannot mean "every claim is a codelet"; it means the claim's
identity and payload are carried in VLIW where the semantics are proven, and
the remainder rides in the catalog row with an explicit compatibility status —
the same discipline the ISA already applies to sentences, with the same
explicit unsupported reasons. The layout spec must decide whether a claim that
cannot be encoded at all is stored as a catalog-only record, and what its
status is.

Keep the corpus separate from the KB. `know/` is the repository's dataset
area, is git-ignored, and currently contains about 2.3 GB of data. Source
registration should store stable source IDs, content hashes, locators, and
anchor metadata; it should not copy corpus bytes into the persistent KB or
commit them to Git. A missing or changed external source must be detectable by
hash verification, while already-ingested evidence remains inspectable.

This is a proposed default, not an assumption that the pack-plus-catalog
design meets every scale target. If measurements show it cannot meet the
agreed workload, an alternative authoritative backend needs an explicit
spec-approved exception, lossless deterministic `.pya` export/replay, and the
same atomicity, concurrency, versioning, migration, and cross-backend parity
guarantees.
**Exit criterion:** the KB layout spec defines the storage medium, entity-page
format, registries, held/rejected stores, snapshot versioning, and write/recovery
semantics. A snapshot round-trips byte-for-byte; a concurrent append cannot
silently lose either evidence record under a specified single-writer/locking or
transaction rule; and interruption during commit leaves either the last valid
snapshot or the complete next snapshot, never a partial one. Unknown snapshot
versions fail clearly, and supported migrations are deterministic. The three
resolver views operate over the persisted snapshot rather than `allRemember()`,
with interpreter, compiled JavaScript, and compiled C returning the same view
for the same snapshot.
**Explicitly out of scope:** adjudication, resurrection, and any change to how
a claim is identified or resolved.
**Decision for the layout spec:** adopt the pack-plus-catalog policy as the
default and test it against the agreed workload. The review question is
whether evidence justifies an exception, not which format to choose without a
benchmark. The exact configured KB root and any derived-index format remain
layout details; neither changes which representation is authoritative.

### T2 — Sources and anchors

**What exists:** digestion emits stable source ids, source artifact records,
byte spans, anchor markers, and replayable digest artifacts.
**What is needed:** a specified `su src …` registration contract that places
those source records in the generic persistent source registry, and a
claim-ready promotion contract for digest candidates. It must preserve their
existing anchors while supplying the required `ya` mood, claim identity fields
(including an explicit scope and validity policy), and a defined confidence
meaning before candidates enter normal evidence resolution.

The second half is closer than it looks, and the remaining distance is worth
naming precisely. `candidateSentence` in `program/library/document_digestion.mjs:377-386`
already emits `fromtext: { la: { su: { name: sourceId }, ob: { text: anchorId } } }`,
which is exactly the shape `normalizeEvidence` accepts, together with
`accordingto name reported-evidential` and a `by num`. Three things are still
missing before a digest candidate is a claim:

- **The mood.** Candidates are emitted on `pi7`, and the bridge only
  normalises evidence on the `ya` mood (`program/bridge/index.mjs:368-374`),
  so a candidate never enters the knowledge core as it stands.
- **The claim-identity fields.** A candidate carries no `as` scope and no
  `since`/`until` window, so it has no claim key and cannot be resolved
  against anything.
- **The meaning of the confidence.** `candidateSentence` hardcodes
  `by: { num: 1 }` — every extracted candidate is currently given *maximum*
  confidence. That is a live semantic wart, not a hypothetical one, and it is
  the same question review question 7 asks about `by num`: source
  reliability, evidence strength, or submitter confidence. The digestion spec
  has to answer it before the number is carried into a claim.

**Exit criterion:** a digested document produces registered sources and
anchored evidence sentences, and replaying the digestion produces identical
anchors — the replay property `document_digestion.mjs` already provides at the
digest level, applied at the claim level.
**Dependency:** source-id and anchor derivation can be specified and tested
independently of T1. Persisting registrations and evidence in the KB depends on
T1's layout and commit contract. This separates parallel design work from the
integration dependency.

### T3 — Conflicts

**What exists:** the `contested` view retains distinct payloads for one exact
claim key, and the linked-bundle `multiple` projection surfaces multiple keys
for a facet. Neither detects conflicts across different time-window keys.
**What is needed:** a conflict-candidate index that groups by normalized
subject and predicate, then compares scope, distinct `ob` payloads, and
validity. Same-scope, different-payload records with overlapping validity are
conflict candidates. Scope or unit mismatches are separately classified
review candidates, not automatically contradictions. This detector must
consider evidence whose exact claim keys differ because their date windows
differ; it must not broaden or silently alter `deriveClaimKey` or the current
resolver views. The Week 11 wording "same claim key" and its scope/unit
examples must be reconciled in the adjudication spec before implementation.
Timeless claims, date-window endpoint inclusivity, and adjacent-window behavior
must be explicitly defined there. Emit `su conflict …` summaries for
inspection.
**Exit criterion:** golden tests cover distinct overlapping windows, disjoint
windows, identical payloads, mismatched scopes/units, predicate mismatch,
timeless versus dated claims, and the chosen endpoint behavior. Results are
deterministic under replay. Detection only: no case, no verdict.

### T4 — Cases and adjudication

**What exists:** no persistent case lifecycle or adjudicator.
**What is needed:** the `su case <id>` lifecycle, role tagging via `as`,
reason codes, deterministic scoring and verdict, and the four Week 11 outcomes:
promote, hold, reject, and request more evidence.
The spec must state what each score measures, who supplies it, and how it
affects a verdict. In particular, it must not assign an unstated meaning to
the current evidence `by num` field.
**Exit criterion:** a golden conflict pack — scope mismatch, unit mismatch,
window overlap, and alias-induced candidate — produces identical case files
and verdicts across interpreter, JS, and C. Mismatch cases must be surfaced
with explicit reasons and must not be treated as contradictions unless the
specified compatibility rules establish that. This is the largest tranche in
the sequence and the one most likely to need its own spec drop (**Adjudication
spec v0.1**).
**Out of scope:** resurrection, which is the next tranche.

### T5 — Resurrection and the seed pack

**What exists:** nothing.
**What is needed:** Week 12's resurrection triggers — reopen a rejected claim
when independent evidence accumulates past a threshold, with a fresh case id
linked back to the earlier rejection — and the encyclopedia seed pack that
exercises the whole loop: lexicon, ontology, sources, entity pages, held,
rejected, cases. The adjudication spec must define what counts as independent
evidence, the threshold, and whether reopening is event-triggered or
re-evaluated during ingestion.
**Exit criterion:** paired tests prove that evidence below the defined
threshold does not reopen a case and evidence meeting it does, with the new
case linked to the prior rejection. Replay produces the same transitions and
final KB snapshot across backends. The four golden demos Week 12 names are
included in acceptance.

### T6 — Rust processing and the toolchain

**What exists:** `rust/pyac` (930 lines) with the pack codec, the catalog
reader and the proven numeric slices; a `#![forbid(unsafe_code)]` crate on
edition 2024 with one dependency; a shared fixture. The JavaScript facade
remains the broader reference executor.

**What is needed, in two parts.**

*First, a build story.* The crate is currently compiled by nothing. There is
no `cargo` in this environment, no GitHub workflow runs `cargo fmt --check` or
`cargo test`, and no npm script invokes the crate. The reference document
states the two commands a developer should run, and CI runs neither. Until a
workflow builds and tests `rust/pyac` on every push, nothing proves the crate
compiles, and the direction rests on code that no pipeline has touched since
2026-10-23. This is the cheapest tranche in the sequence and it gates the
rest: it needs a toolchain pin, a CI job, and a decision on whether the crate
is built on every push or only on the paths that need it.

*Second, the knowledge core itself in Rust.* R14 asks for the core's
normalization, claim-key derivation and view resolution to be owned by the
crate. That is roughly the 450 lines of `program/library/knowledge_core.mjs`,
reimplemented against the pack and catalog contracts, with the crate as the
authority and the JavaScript module as the parity reference for the fourteen
modules that depend on it — including the memory layer's garbage-collection
rule and the work system's queue ordering. Parity is the hard part: claim
keys must be byte-identical across the two implementations, and the ISA's
ordering rule (one locale-independent UTF-8 comparison) has to hold in Rust
exactly as it does in JavaScript.

**Exit criterion:** CI builds and tests the crate; the Rust and JavaScript
implementations produce byte-identical claim keys, evidence records and
resolver views over the same catalog and pack; and the compiled C path is
either brought to parity with them or explicitly retired.
**Open decision:** does compiled C remain a knowledge-core backend at all? The
repository's invariant is "interpreter + JS + C ship together by default", and
the C knowledge core is a hand-written port with a fixed record array. Under
this direction C is the implementation being replaced, not one being scaled.
That is a parity-contract change, and it should be decided here rather than
discovered later.

### T7 — Scale and hardening

**What exists:** an implementation ceiling of 256 records in the compiled C
backend; whether that cap is a product requirement is undecided (R12).
**What is needed:** a way for the compiled path to resolve from the KB rather
than to hold it, so that the ceiling stops being the size of the knowledge
base. Alongside it, the replay guarantees at KB scale: the same seed and the
same evidence set produce the same snapshot. First agree on a representative
corpus size, query workload, latency target, and memory budget; then measure
all backends against those criteria rather than treating an arbitrary
record count as a product goal.
**Exit criterion:** the golden end-to-end demos and the agreed workload pass
on every supported backend, with correctness parity and recorded latency/memory
measurements at the target scale.
**Note:** if compiled C is retired for the knowledge core in T6, the 256-record
cap disappears with it, and this tranche becomes a measurement of the Rust
path rather than a redesign of the C one.

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

1. Is the separation between claim identity, evidence, validity, resolver
   views, and adjudication the right model, and is anything missing that would
   make the core more than a well-organised log?
2. Are the fourteen requirements complete, and are the four boundaries
   ("not a vector store", "not a key-value store", "not a transcript store",
   "not truth-by-model-score") the right exclusions?
3. Does T0 come first? It is a documentation and index move, with no contract
   changes. It could wait until the KB layout spec exists; the case for doing
   it first is that several subsystems already depend on the contract and its
   current location under "Pyash Agent" obscures that status.
4. Should source-id/anchor design and fixtures proceed before T1, with only
   persistent source registration waiting on the layout? This distinguishes
   parallel specification work from the storage integration dependency.
5. Does the proposed pack-plus-catalog format meet the target workload? If
   not, what benchmark demonstrates the need for an exception, and how will
   that backend preserve lossless `.pya` export/replay and the same durability
   guarantees?
6. What representative corpus size, query workload, latency target, and memory
   budget should determine whether the C record cap is a product constraint or
   merely an implementation limit?
7. What semantics should `by num` have, and who supplies it: source
   reliability, evidence strength, submitter confidence, or another explicitly
   defined quantity?
8. **Under "VLIW by default", what happens to a claim that has no proven
   VLIW encoding?** A claim with a validity window carries two dates, and
   dates are explicitly `unsupported-date`. Is such a claim stored as a
   catalog-only record, and what compatibility status does it carry? The
   answer changes what "the representation is VLIW" means.
9. **Does compiled C remain a knowledge-core backend?** The repository's
   invariant is "interpreter + JS + C ship together by default", and the C
   knowledge core is a hand-written port with a fixed 256-record array. If
   Rust replaces it, the parity contract changes and the roadmap's invariant
   has to change with it.
10. **`27-pyash-vliw-isa.md` §8 lists "connect codelet execution to
    WorkTask/review/integration machinery" as a non-goal.** The knowledge
    core *is* connected to that machinery — fourteen modules import the
    contract, including the work system's queue. Does the knowledge core need
    its own spec boundary, or does that non-goal need revisiting?
11. What would show that the knowledge core is earning its place? A
    measurement against the agreed workload, not a feature list.

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
grep -rn "su src" --include=*.mjs --include=*.pya program/            # no literal registration contract yet
grep -rn "su conflict\|su case" --include=*.mjs program/              # empty: not implemented

# the adjacent pieces
wc -l program/library/document_digestion.mjs
cat module/headquarters-knowledge.pya
du -sh know/*

# the VLIW and Rust stack
grep -rn "PYACVLIW" documentation/reference/pyac-vliw-database.md | head -3
grep -n "The catalog carries semantic identity" -A 3 documentation/reference/pyac-vliw-database.md
wc -l rust/pyac/src/*.rs rust/pyac/tests/*.rs
git log --oneline -8 -- rust/

# the Rust crate is not built by anything
grep -rn "cargo" package.json .github/workflows/ ; echo "(empty: no cargo in scripts or CI)"
grep -n "cargo test" documentation/reference/pyac-vliw-database.md

# the ISA's compatibility discipline and its non-goal
grep -n "unsupported-date\|unsupported-vector" documentation/reference/pyac-vliw-database.md | head -3
grep -n "does not .*connect codelet execution" documentation/specifications/27-pyash-vliw-isa.md

# the roadmap this document proposes to follow
sed -n '730,790p' documentation/roadmap.md
```
