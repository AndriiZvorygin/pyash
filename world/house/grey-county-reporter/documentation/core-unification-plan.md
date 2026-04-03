# Core Unification Plan

## Goal
Build one reusable article-generation system in core `pyash/program` that supports:
- wise chips
- section summaries
- whole-summary synthesis
- hook generation
- payload/render/publish handoff

with source-specific adapters (escribe and non-escribe) instead of duplicated house pipelines.

## Execution Rule
Work this plan in order until:
1. all phases are complete, or
2. a hard block requires user input/decision.

When blocked, stop at the smallest blocking question and record it in **Blockers**.

## Scope Boundary
- Reuse existing Grey/Owen behavior first.
- No prompt redesign unless required for parity.
- No compatibility layers unless explicitly requested.
- Keep source-specific logic out of core modules.

## Target Architecture
1. Core pipeline modules in `/home/htaf/pyash/program`.
2. House/source adapters in `world/house/*/program`.
3. Stable artifact contracts between adapter and core.
4. Thin house entry scripts that pass config to core.

## Artifact Contracts (v1)
Required artifacts:
- `source.bundle.json`
- `wise.chips.json`
- `section.summaries.json`
- `whole.summary.md`
- `hook.txt`
- `article.payload.json`
- `run.report.pya`

Each artifact includes:
- `schema_version`
- `writer_id`
- `meeting_id` (or source item id)
- `generated_at_utc`

## Phases

### Phase 0: Baseline and Parity Lock
Deliverables:
- Document current Grey/Owen stage parity matrix.
- Define immutable parity fixtures (at least 1 Grey + 1 Owen meeting).

Acceptance:
- Fixture runs reproducible.
- Stage outputs archived for diffing.

Status: `pending`

### Phase 1: Contracts + Stage Runner in Core
Deliverables:
- Core contract helpers (read/write/validate).
- Shared stage runner with checkpoint semantics:
  - `--force-stage`
  - `--skip-stage`
  - resume from checkpoint

Acceptance:
- Existing Grey runner can call stage runner without behavior change.

Status: `pending`

### Phase 2: Extract Wise Chips + Section Summaries to Core
Deliverables:
- Core-wise chunk module (source-agnostic).
- Core section summary module.
- Core whole-summary module.

Acceptance:
- Grey/Owen fixtures produce equivalent outputs vs baseline (allowing normal model variance).

Status: `pending`

### Phase 3: Extract Hook + Payload Generation to Core
Deliverables:
- Core hook generation.
- Core article payload generation.
- Shared verifier checks:
  - required sections present
  - tense check
  - no truncation artifacts (`...`)

Acceptance:
- Grey/Owen payload schema and required fields match expected format.

Status: `pending`

### Phase 4: Adapter Interface and Grey/Owen Adapters
Deliverables:
- Adapter interface:
  - `discover`
  - `prepare_workspace`
  - `fetch_inputs`
  - `normalize_to_source_bundle`
- Grey adapter and Owen adapter ported.

Acceptance:
- House scripts become thin wrappers around core pipeline + adapter config.

Status: `pending`

### Phase 5: Publisher Interface
Deliverables:
- Shared publish client interface:
  - `create`
  - `update`
  - idempotency handling
- Identity scoping per writer (prevent Owen/Grey crossover).

Acceptance:
- Posting identity and community are config-driven and deterministic.

Status: `pending`

### Phase 6: Unified CLI
Deliverables:
- Common commands:
  - `list`
  - `run`
  - `rerun-stage`
  - `publish`
- Keep `run-next-story.sh` as wrapper only.

Acceptance:
- Same stage controls for all writers.

Status: `pending`

### Phase 7: First Non-escribe Writer
Deliverables:
- Implement one non-escribe adapter using same core stages.

Acceptance:
- End-to-end article generation without source-specific changes in core.

Status: `pending`

## Progress Tracker
- [ ] Phase 0 complete
- [ ] Phase 1 complete
- [ ] Phase 2 complete
- [ ] Phase 3 complete
- [ ] Phase 4 complete
- [ ] Phase 5 complete
- [ ] Phase 6 complete
- [ ] Phase 7 complete

## Blockers
Use this format:
- Date:
- Phase:
- Block:
- Needed from user:

Currently: none.

## Immediate Next Actions
1. Build Phase 0 parity matrix and freeze baseline fixtures.
2. Create core contract files in `pyash/program`.
3. Wire Grey pipeline to read/write contract artifacts with no behavior changes.
