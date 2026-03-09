# Sleep, Gold, and LoRA/SFT Training (Consolidated Reference)

This document consolidates the current contract for:

- `be sleep do`
- training gold collection
- LoRA/SFT dataset preparation intent and current implementation status

## Canonical intent

`be sleep do` is not a short delay. It is the consolidation lifecycle entry.

Use:

- `be wait do` for short synchronization pause
- `be sleep do` for review, memory compaction, and optional training preparation

Primary spec source:

- `documentation/specifications/15-world.md` (`Sleep, review, learning`)

## What sleep is expected to drive

During sleep/review, the world requests:

- summary
- failures
- lessons
- next practice
- training gold (high-signal facts, mistakes, corrections)
- LoRA/SFT preparation inputs derived from reviewed artifacts

## Memory consolidation contract (normative profile)

Sleep is also the canonical memory-consolidation phase and SHOULD perform three coordinated updates:

1. **Episodic memory consolidation**
   - summarize and compact recent run/turn episodes
   - preserve links to source artifacts/newspaper for replay
   - reduce prompt-context load while keeping recoverability
2. **Semantic memory extraction**
   - extract stable facts, rules, and reusable procedures from episodes
   - store fact-like knowledge separately from narrative episode logs
   - mark confidence/provenance where available
3. **Autobiographical/identity update**
   - update long-horizon self-model fields (preferences, strengths, recurring failure modes, values/constraints)
   - retain continuity markers across sessions
   - avoid unstable identity rewrites from single noisy episodes

Minimum outputs per sleep cycle SHOULD include:

1. episodic summary/compaction artifact
2. semantic fact update artifact
3. autobiographical/identity delta artifact

## Memory governance contract (normative profile)

### Retention and forgetting

Retention SHOULD be memory-type aware:

1. episodic memory: short-to-medium horizon with compaction and expiry
2. semantic memory: long-horizon with correction/revision, not blind expiry
3. autobiographical memory: long-horizon and sparse, updated conservatively

Implementations SHOULD define explicit TTL/decay windows per memory type.

### Conflict resolution

When new semantic facts conflict with existing facts:

1. preserve both claims with provenance
2. mark the older claim as superseded/contested (not silently deleted)
3. promote one canonical fact only when confidence + provenance threshold is met

### Confidence model

Each memory record SHOULD carry confidence metadata:

1. confidence score/band
2. source class (`user`, `tool`, `benchmark`, `model-inferred`)
3. last validated timestamp

Confidence SHOULD be updatable by dream-phase benchmark evidence and user correction events.

### Provenance requirements

Memory writes SHOULD include provenance pointers:

1. run id
2. source artifact/newspaper reference
3. agent and generator identity
4. timestamp

Records without provenance SHOULD be excluded from semantic promotion.

### Retrieval policy

Recall SHOULD use a deterministic ranking blend:

1. relevance to active task
2. confidence
3. recency/freshness
4. identity alignment (for autobiographical context)

When context budget is tight, prefer high-confidence semantic items plus compact episodic summaries.

### Safety and privacy boundaries

Sleep pipelines MUST enforce redaction/denylists before memory persistence and dataset export.

At minimum:

1. do not persist secret tokens/credentials
2. redact sensitive personal/private data unless explicitly allowed by policy
3. keep policy-sensitive memory in restricted scopes where required

### Identity drift guardrails

Autobiographical updates SHOULD require repeated evidence across multiple episodes or explicit user confirmation.

Single noisy events SHOULD NOT cause major identity/value rewrites.

### Memory quality benchmarking

Dream-phase evaluation SHOULD include memory-quality metrics:

1. recall accuracy
2. contradiction rate
3. stale-fact usage rate
4. hallucinated-memory rate
5. identity-consistency score

Promotion of memory/schema updates SHOULD be gated on acceptable thresholds for these metrics.

## Gold location contract

Session gold is emitted per agent house, under:

- `world/house/<agent>/gold/accepted/`
- `world/house/<agent>/gold/rejected/`

Runtime helper and emission logic:

- `program/agent/gold.mjs`
- `program/verbs/verify_loop.mjs`

## Current implementation status (March 2026)

- Sleep verb exists and is wired as consolidation signal:
  - `program/verbs/sleep.mjs`
- Gold emission exists and is deterministic in verify loop path:
  - `quiz/review_loop.test.mjs`
- Dataset export and automated LoRA/SFT training are roadmap work:
  - `documentation/roadmap.md` (`Session gold emission/export pipeline`, `Sleep-mode pipeline`)

## Sleep-phase training assessment contract

When LoRA/SFT training runs as part of sleep-mode workflows, treat evaluation as a required phase:

1. **Non-REM phase (consolidation/training)**
   - prepare deterministic dataset export from gold + reviewed artifacts
   - run LoRA/SFT training job
2. **Dream phase (assessment/benchmark)**
   - evaluate post-training model on task-relevant criteria/benchmarks
   - compare against pre-training baseline
   - record category-level deltas (improved / neutral / regressed)
3. **Wake outcome (promotion gate)**
   - only promote trained adapter/profile when dream-phase metrics show meaningful improvement in target categories without unacceptable regressions

Recommended persisted artifacts per sleep cycle:

- baseline benchmark report (before training)
- post-training benchmark report
- comparison summary with per-category deltas
- promotion decision record and rationale

## Practical guidance

If you are building runtime flows:

1. Do not use `sleep` as a timing primitive.
2. Use `wait` for pauses.
3. Treat `sleep` outputs as training/review inputs and archive them under agent house artifacts and gold roots.

If you are planning training jobs:

1. Source accepted/rejected examples from `world/house/<agent>/gold/`.
2. Keep export deterministic (dedup + stable ordering) before LoRA/SFT conversion.
3. Run export/training as explicit background jobs (roadmap), not inline with active turn timing.

## Gold selection policy (normative profile)

This profile defines what should become gold when building sleep-phase datasets.

### Inclusion signals

Include candidate records when at least one signal is present:

1. verification success/failure outcome
2. tool-call success/failure outcome
3. explicit user feedback (approve/reject/edit-correct)
4. benchmark-labeled outcome from dream-phase assessment

### Labels

Use canonical labels:

1. `gold_positive`
2. `gold_negative`
3. `gold_pairwise` (winner/loser comparison unit)

### Priority order for label assignment

1. explicit user feedback (highest authority)
2. benchmark/regression outcome
3. verification outcome
4. tool/runtime outcome

### Negative gold categories

When `gold_negative`, include at least one category tag:

1. `factual`
2. `reasoning`
3. `instruction_following`
4. `format_contract`
5. `tool_selection`
6. `tool_execution`
7. `safety_policy`
8. `latency_or_budget`

## Pairwise gold contract

Pairwise records are first-class and SHOULD be preserved as winner/loser pairs.

Required fields:

1. task/context id
2. winner output
3. loser output
4. ranking rationale
5. source signal (`user`, `benchmark`, `verifier`, or mixed)

Pairwise records SHOULD be exportable as:

1. direct-preference pairs (DPO/IPO style)
2. scalarized examples (winner positive + loser negative), with linkage retained

## Tool-calling and use-feedback ingestion

Tool episodes SHOULD be converted to training-relevant examples when they affect outcome quality.

Minimum tool episode fields:

1. requested intent
2. selected tool name
3. tool arguments (redacted where needed)
4. tool result summary (success/fail)
5. final answer quality outcome (pass/fail/user feedback)

User feedback mapping:

1. explicit acceptance -> `gold_positive`
2. explicit rejection with correction -> `gold_negative` plus corrected positive candidate
3. edit distance + correction note SHOULD be preserved for supervised correction sets

## Data retention and balancing policy

To avoid collapse from skewed labels, exports SHOULD enforce:

1. stable dedup by content hash
2. category-aware balancing across positive/negative
3. per-generator caps to avoid single-source dominance
4. time-windowed sampling for freshness

Suggested default ratio (starting point):

1. 50% positive
2. 30% negative
3. 20% pairwise (in addition to or intersecting with above, depending on trainer)

## Export contract (normative shape)

Each export row SHOULD contain:

1. stable record id
2. label
3. task/prompt
4. response text
5. review/verdict text
6. category tags
7. provenance (agent, generator, run id, timestamp)
8. pairwise linkage id (when applicable)

Deterministic ordering key:

1. label
2. category
3. timestamp day
4. stable hash

## Benchmark and promotion gate (normative thresholds)

Dream-phase assessment MUST compare baseline and trained candidate on the same benchmark slice.

Promotion policy:

1. require measurable improvement in target categories
2. reject promotion on critical-category regressions (safety/policy/format-contract)
3. record promote/reject decision with metric deltas and threshold references

Minimum benchmark report fields:

1. benchmark suite id and version
2. baseline model id
3. trained adapter/model id
4. per-category metrics
5. aggregate metrics
6. pass/fail promotion decision

## Canonical `.pya` record sketches

Positive/negative gold sketch:

```text
su name gold record be map def
su name id ob text "<hash>" ya
su name label ob text "gold_positive" ya
su name category ob text "instruction_following" ya
su name task ob text "<task>" ya
su name response ob text "<response>" ya
su name review ob text "<review>" ya
su name provenance ob text "<agent>/<generator>/<run-id>" ya
prah
```

Pairwise gold sketch:

```text
su name gold pair be map def
su name id ob text "<pair-hash>" ya
su name label ob text "gold_pairwise" ya
su name task ob text "<task>" ya
su name winner ob text "<winner-response>" ya
su name loser ob text "<loser-response>" ya
su name rationale ob text "<why winner>" ya
su name source ob text "user" ya
prah
```
