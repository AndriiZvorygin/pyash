# Pyash Roadmap Reconciliation

Date: 2026-08-12

Status: authoritative audit of repository reality; generated autonomous roadmap is derived from this report

## Conclusion

The previous `needs-direction` result was wrong. It was produced after the generated candidate list was exhausted and several autonomous turns timed out. A timeout is an execution failure, not evidence that the corresponding language or runtime milestone is complete.

The repository still contains substantial unfinished work in language parity, the Pyash-native agent harness, and product-alpha validation. The four timeout-blocked packages remain valid partial work. They should be recovered or retried before unrelated roadmap packages are admitted.

Current conclusion: `ROADMAP WORK REMAINS`, with several packages temporarily blocked by execution history. `needs-direction` is not justified.

## Evidence Rules

This audit treats the following as evidence only, not as a source of completion truth:

- `world/holding/work/artifacts/autonomous-roadmap.pya`
- `world/holding/work/artifacts/autonomous-roadmap.md`
- generated autonomous task lists
- previous Sol roadmap summaries
- a task disappearing from the ready queue
- a `turn timeout`, sandbox failure, retry limit, or empty queue

Completion requires current source, a wired execution path, relevant quizzes or goldens, and current validation evidence. Product-alpha claims additionally require real environment evidence and a runbook. A fixture-only path does not prove a production capability.

## Major Milestones

### Parity-first language invariant

Classification: `PARTIAL`

Evidence:

- The dispatch model is signature-first in `program/verbs/index.mjs` and `program/bridge/signature.mjs`.
- Interpreter, generated JavaScript, and C paths have extensive parity quizzes and goldens.
- Ceremony, `this`, `ret`, register-state, HNUC, error propagation, and higher-level translation work are still represented by active TODOs or isolated unfinished worktrees.
- The current higher-level tranche explicitly defers C parity until the interpreter/JavaScript boundary is stable. Therefore the invariant is not complete for the live roadmap boundary.

### Agent harness: research and builder

Classification: `PARTIAL`

Evidence:

- Search exists in `program/verbs/search.mjs` and is covered by `quiz/search_text.test.mjs` and `quiz/web_search.test.mjs`.
- Download exists in `program/verbs/download.mjs` and related handlers, with cache and failure coverage in `quiz/download.test.mjs`.
- HTML/PDF to Markdown reading exists in `program/verbs/exchange/read.mjs` with `quiz/read_html_markdown.test.mjs` and related tests.
- Tool-calling mind paths, command policy, session state, newspaper evidence, and replay commands exist and have focused tests.
- `examples/pyash/agent-command-workflow.pya` and `quiz/agent_command_workflow.test.mjs` prove a growing Pyash-native workflow, but the durable work result was not captured by the timed-out task and the complete roadmap loop is not yet an accepted fixture-free user workflow.
- The roadmap still requires one runnable loop combining search, download, read-to-markdown, tool-calling minds, and project command execution. The individual primitives do not prove that end-to-end milestone.

### Product alpha launch

Classification: `PARTIAL`

Evidence:

- Scheduler code exists in `program/agent/scheduler.mjs` and `command/scheduler_daemon.mjs`.
- Matrix channel code exists in `program/agent/channels/matrix.mjs` and `command/channel_run.mjs`.
- Session, deduplication, checkpoint, command policy, newspaper, and replay paths exist with focused quizzes.
- The roadmap exit criteria require a seven-day soak without manual restart, three real end-to-end tasks, green scheduler/channel/agent quizzes, and a daily real-backend smoke record.
- No current repository evidence proves the complete seven-day soak and all exit criteria. Code presence and unit tests are not sufficient to mark alpha complete.

### Minimal agent loop and workload pipeline

Classification: `PARTIAL`

Evidence:

- `program/agent/session.mjs`, mind tool paths, command execution, scheduler, and newspaper/replay primitives are present.
- The manager/worker lane has completed real isolated tasks and preserves worktree/checkpoint/report state.
- The end-to-end Pyash-defined research and builder workflow, long-run context behavior, and broader follow-on pipeline remain incomplete or only locally demonstrated.

### Concurrency and workload controls

Classification: `PARTIAL`

Evidence:

- Durable work queue, claims, leases, checkpoints, priority selection, capacity pacing, one-worker background scheduling, and remote GPU workload primitives exist.
- The old roadmap still names cancellation, timeouts, backpressure, simulation, and broader concurrent workload behavior.
- The current system intentionally keeps one coding worker. That is a sensible safety boundary, but it does not complete the broader concurrency milestone.

### Packaging and human usability

Classification: `PARTIAL`

Evidence:

- CLI wrappers, `work` operator commands, reports, daily digest, email delivery, cron wrappers, doctor checks, and isolated worktrees exist.
- The CLI language UX worktree has focused passing tests but has not received a durable accepted result.
- A complete alpha runbook and broadly demonstrated user-facing packaging remain unfinished.

### Intent compiler

Classification: `UNSTARTED`

Evidence:

- The roadmap describes intent-to-plan and intent-to-program compilation as a later milestone.
- No current implementation and end-to-end test were found that satisfy that milestone as a product capability.

### Knowledge core and memory

Classification: `UNSTARTED`

Evidence:

- The repository has memory/session/newspaper primitives and document conversion helpers.
- The later roadmap knowledge graph, anchored knowledge core, and retrieval behavior are not proven as a complete language/runtime capability.

### Document digestion

Classification: `PARTIAL`

Evidence:

- HTML and PDF reading/conversion to Markdown exists and is tested.
- Reporter and artifact paths preserve durable evidence.
- Sentence-native anchored knowledge extraction, indexing, and replayable document digestion from the later roadmap are not complete.

### Conflict, adjudication, resurrection, and encyclopedia milestones

Classification: `UNSTARTED`

Evidence:

- Existing error, checkpoint, newspaper, and replay primitives are useful prerequisites.
- No current end-to-end implementation was found for the later conflict/adjudication, resurrection, or encyclopedia milestones described by `documentation/roadmap.md`.

## Complete Capabilities and Milestones

These are genuinely complete at their current scope; they must not be inflated into completion of the larger milestones that depend on them.

### MCP tool bridge v0.3

Classification: `COMPLETE`

Evidence:

- `documentation/roadmap.md` explicitly marks Week 3 remaining work as `None (Week 3 complete)`.
- MCP stdio integration, snapshots, tool hashing, schema validation, allow/deny, replay, timeouts, quickstarts, and `discharge` are implemented in the MCP/runtime paths.
- The MCP and agent-tool quizzes exercise the shipped behavior without requiring a live external service.

### Search, download, and read-to-Markdown primitives

Classification: `COMPLETE` as individual primitives, not as the Agent harness milestone.

Evidence:

- `program/verbs/search.mjs`, `program/verbs/download.mjs`, and `program/verbs/exchange/read.mjs` are wired runtime paths.
- `quiz/search_text.test.mjs`, `quiz/web_search.test.mjs`, `quiz/download.test.mjs`, and the read Markdown quizzes cover their current contracts.
- The missing work is the bounded Pyash-native composition of these primitives into the roadmap's runnable agent loop.

### Accepted single-register and higher-level JS/interpreter increments

Classification: `COMPLETE` for the accepted task scopes; `PARTIAL` for the broader TODO/parity goals.

Evidence:

- `language-ret-register-live` is accepted with task commit `c58f9b1a0d8a25d35c8db99610f5d9f5abcf691c`.
- `roadmap-translation-parity-tranche` is accepted with task commit `75ee904b332c298cba6fdce79b6d577eeeb813a7`.
- Current focused interpreter/JavaScript/C tests pass for the accepted boundaries, but the TODO still defers C higher-level parity and retains adjacent semantics work.

No current audit item is classified `BLOCKED-ARCHITECTURE`. The real external prerequisites for alpha evidence, such as Matrix credentials and a sustained backend environment, are recorded as prerequisites rather than mistaken for completed product behavior.

### Genetic programming and evolutionary work

Classification: `UNSTARTED`

Evidence:

- The later roadmap section describes this as future work.
- No current runtime, specification, or end-to-end quiz establishes the capability.

## TODO Reconciliation

### Higher-level translation paths parity

Classification: `PARTIAL`

The interpreter and JavaScript ceremony boundary has real implementation and tests, including signature binding, isolated frames, `this`, and `ret` work. The accepted translation task and its automation history cover only part of the intended boundary, while C parity is explicitly deferred. The timeout-blocked tranche remains valid.

The TODO bullet is therefore `PARTIAL`, even though the narrower accepted task package is `COMPLETE`.

### Mind streaming and richer reply envelopes

Classification: `PARTIAL`

`program/verbs/mind/stream.mjs`, Ollama streaming tests, and the reply envelope worktree exist. The focused WIP run still has a delayed-terminal streaming failure and the richer envelope path has not been Sol-accepted. This is retryable implementation work.

### Stale `tloh` documentation cleanup

Classification: `PARTIAL`

The current source uses newer loop/register terminology in many places, but stale references remain in documentation and compatibility/history surfaces. This should be folded into a meaningful language documentation/spec tranche rather than treated as a standalone roadmap completion claim.

### Additional standard verbs and noun classes

Classification: `PARTIAL`

The standard verb registry and many IO verbs are real and tested. The filename mutation worktree adds a bounded family but its focused parity run still has three failures involving interpreter/JS/C behavior and generated JavaScript. It is not complete.

### HNUC/code compositional validation

Classification: `PARTIAL`

The isolated worktree contains a validator and its focused compositional tests pass. The validator has not been integrated and reviewed as the current canonical contract. It remains valid retryable work.

### Ceremony and sandpit error handling

Classification: `PARTIAL`

The isolated worktree has focused error propagation tests passing, including ceremony-local and sandpit paths. The package has no durable accepted result after the timeout, so it remains retryable and must not be treated as completed.

### CLI language UX

Classification: `PARTIAL`

The isolated CLI worktree has a command helper and eight focused tests passing. The acceptance result is not durable, and clean-checkout operator behavior still needs review.

### Graph/IR lowering and broader specification features

Classification: `UNSTARTED`

No current implementation and acceptance evidence satisfy the later graph/IR lowering and broader spec expansion goals.

### Per-command result tracking

Classification: `PARTIAL`

Command audit records already carry request IDs and newspapers carry event evidence. A stable sentence-native result identity linking repeated commands to surfaced results and replay is not yet implemented.

### Separate register-fact reliance

Classification: `PARTIAL`

The register-state worktree contains the cleanup and focused interpreter/JavaScript/C loop regressions pass. The durable autonomous task timed out before review/integration, so the TODO remains active.

No current TODO bullet is `COMPLETE` as written: the accepted work closes narrower scopes, while each remaining bullet retains an adjacent parity, documentation, integration, or validation boundary.

## Timeout-Blocked Packages

All four packages listed by the daily digest remain valid. None is complete solely because its Codex turn timed out.

| Package | Classification | Evidence and disposition |
| --- | --- | --- |
| `roadmap-mind-reply-envelope-streaming` | `PARTIAL` | Reply implementation and focused tests exist; one delayed-terminal streaming test fails. Retry after the execution path is healthy. |
| `roadmap-ceremony-error-propagation` | `PARTIAL` | Focused ceremony/sandpit tests pass in the isolated worktree. Preserve the worktree and review it; do not re-plan. |
| `roadmap-hnuc-compositional-validation` | `PARTIAL` | Validator and 28 focused compositional tests exist in the worktree. Review/integrate after operational recovery. |
| `roadmap-register-state-ground-truth` | `PARTIAL` | Loop/register-focused tests pass in the worktree. Review/integrate after operational recovery. |

The same audit found additional timeout-affected or unaccepted work in the standard verb, CLI, and Pyash-native agent workflow worktrees. Those are included in the rebuilt roadmap rather than silently discarded.

## Recommended Package Sequence

The ordering favors user-visible language correctness, dependency leverage, Pyash dogfooding, and reliability per Sol cycle.

### Retryable and first queued

1. Complete HNUC compositional-case validation. It is a small but high-leverage validator with existing implementation evidence.
2. Complete ceremony and sandpit error propagation. Truthful errors are required by the agent and product-alpha workflows.
3. Complete the register-state ground-truth cleanup. It removes stale state from long-running loops and has broad parity value.

These remain operationally blocked in durable task history, so the scheduler must recover them rather than start a fresh package while the shared execution issue persists.

### Next substantial packages

4. Complete mind reply envelopes and streaming parity.
5. Strengthen the Pyash-native agent workflow.
6. Complete one end-to-end Pyash agent research tool chain: search, download, read-to-Markdown, mind/tool use, command execution, and durable evidence.
7. Complete standard filename verb coverage across supported backends.
8. Strengthen CLI language UX and clean-checkout examples.
9. Harden long-run session replay and context compaction.
10. Prove the product-alpha scheduler and Matrix runtime with real traces and a seven-day soak record.
11. Complete review-loop context compaction and the library refinement cache before broadening document workflows.
12. Build deterministic concurrency simulation without changing the one-worker unattended policy.
13. Implement the sentence-native knowledge core, then anchored document digestion.

The rebuilt autonomous roadmap keeps a small ready-worthy set and leaves later packages as candidates. It does not turn every old TODO into a task.

## Pyash-First Policy

Every proposed package asks whether the workflow can reasonably be expressed in Pyash. Pyash programs, modules, sentence-native state, and examples are preferred for workflow logic. JavaScript, C, shell, and OS APIs remain appropriate for interpreter/compiler substrate, backend parity, process/network boundaries, and capabilities Pyash cannot yet express. The reason for a host-language-heavy choice belongs in the package scope and evidence.

## Exhaustion Semantics

`needs-direction` is now reserved for a stronger condition:

- a fresh repository reconciliation found no credible unfinished roadmap work;
- no retryable or operationally blocked technical work exists;
- no eligible package remains;
- and any remaining choices genuinely require human product or architecture direction.

The following are not exhaustion:

- turn timeout;
- sandbox or App Server failure;
- usage limit or weekly pacing;
- temporary provider/infrastructure failure;
- retry limit reached;
- empty ready queue;
- a stale or undersized generated candidate list.

Those conditions are reported as operational blockage, pacing deferral, or reconciliation required. The daily digest must say `ROADMAP WORK TEMPORARILY BLOCKED` when retryable technical failures remain, and `READY QUEUE EMPTY - RECONCILIATION REQUIRED` when the generated queue is empty while the authoritative roadmap still has work.

## Human Decisions

No immediate product decision is required to continue. The real decisions that may eventually need explicit input are the scope/order of C parity after the interpreter/JavaScript boundary, Matrix credentials/environment for alpha evidence, and the acceptable definition of a seven-day real-backend soak. These are not reasons to declare the roadmap exhausted.
