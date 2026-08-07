# Pyash Manager and Worker Audit

Audit date: 2026-08-07

This document records the repository state and the bounded Sol/Luna execution
slice implemented after the durable work queue foundation. Historical roadmaps
are evidence, not current commitments.

## Current State

The repository was fetched and fast-forwarded before implementation. The
starting branch was clean at `b50c94de`, `master` tracked both configured
remotes, and no additional worktree or local WIP was found.

The durable work lane is under `program/runtime/work/` and reuses the existing
holding spool:

```text
world/holding/work/*.pya
        |
        v
Pyash supervisor claims one task
        |
        +--> Sol App Server thread: plan and review
        +--> Luna App Server thread: implementation and tests
        |
        v
Pyash .pya checkpoint, queue ack, and final decision
```

A task envelope carries its bounded prompt, context, acceptance criteria,
retry policy, status, and work specification. The status projection now
preserves named `.pya` sections for:

- workspace: repository, base revision, detached worktree, and mode;
- roles: manager/worker models, reasoning effort, and App Server thread ids;
- plan: Sol summary, work order, and risks;
- implementation: summary, changed files, file-change events, diff, tests,
  blockers, and uncertainty;
- review: `ACCEPT`, `REVISE`, or `BLOCK`, rationale, and correction request;
- interruption: phase, timestamp, reason, and last turn;
- revision count, original `workSpec`, and original payload sentence.

This is one canonical Pyash checkpoint artifact, not a second JSON state store.
Structured values are encoded inside named Pyash map fields using the existing
artifact convention.

Task claiming remains atomic through spool rename and oldest-first. `priority`
is persisted and validated but is deliberately not used for claiming in this
first supervisor cycle. Operational priority scheduling is a follow-up.

## Reporter and Roadmap Reality

Reporter work is shared in `program/library/reporter_shared/`; Grey County and
Owen Sound houses are deployment-specific and are not present in this checkout.
Shared Stage 2/3 contracts cover canonical `.pya` artifacts, source anchors,
child/parent lineage, contiguous ranges, timing, monotonicity, motion grounding,
and quality verification. JSON and `meeting.json` paths remain boundary
compatibility debt. Live publishing, cover upload, external house imports, and
some reporter quizzes still require credentials or ignored house assets.

| Historical goal | Status | Current evidence |
| --- | --- | --- |
| Parity-first interpreter, JavaScript, and C | ACTIVE | Cross-backend examples and compiler goldens exist; higher-level parity remains incomplete. |
| Feature gates for lagging backends | PARTIAL | Targeted gates and parity quizzes exist, but no complete current status artifact exists. |
| Frozen specifications before promotion | ACTIVE | Numbered specifications remain the design source of truth. |
| Golden and replay corpus | ACTIVE | Examples, artifacts, newspapers, checkpoints, and `again` support exist. |
| Sentence-shaped, human-speakable Pyash | ACTIVE | It remains an interpreter and `.pya` design constraint. |
| Media IO and listen -> mind -> TTS | PARTIAL | `hear`, streaming, Piper, Whisper, and refinery paths exist; one default loop is unfinished. |
| MCP bridge | DONE | MCP stdio/HTTP, policy, replay, timeouts, restart, and discharge are implemented. |
| Minimal agent loop | ACTIVE | Houses, sessions, memory, channels, MCP, Codex projection, and one durable Sol/Luna cycle exist. |
| General concurrency | PARTIAL | Schedulers, leases, channels, and runtime handles exist; fair-share work scheduling remains open. |
| Newspaper-style replayable history | ACTIVE | Newspaper, artifacts, checkpoints, and Pyash-first Codex projection exist. |
| Knowledge core and adjudication | HIGH-VALUE UNSTARTED | Useful old roadmap work with no current implementation to assume. |
| Genetic/speculative packaging branches | STALE | Not the highest-value use of the current architecture. |

## Manager and Worker Foundation

### App Server adapter

`program/runtime/codex/app_server.mjs` extracts the JSONL transport that was
previously private to `command/codex_account.mjs`. It launches and initializes
`codex app-server`, supports request/notification subscriptions, persists
stderr, validates malformed JSON, and detects server errors or process exit.

The first-cycle operations are:

- `initialize` and `initialized`;
- `thread/start` with model, working directory, approval policy, and sandbox;
- `thread/resume`;
- `turn/start` with model, working directory, reasoning effort, input, and
  sandbox policy;
- streamed `item/agentMessage/delta`, `item/fileChange/patchUpdated`, and
  `turn/diff/updated` events;
- `turn/completed` success/failure classification;
- `turn/interrupt` and clean process termination.

The installed Codex was `0.146.1` during this audit. The adapter is injectable,
so ordinary tests never launch Codex. Its protocol schema was generated from
the installed binary rather than copied into Pyash.

### Roles and supervisor

Roles are configurable through supervisor options or environment variables:

```text
manager model: gpt-5.6-sol
manager effort: high
worker model: gpt-5.6-luna
worker effort: high
```

The role names are architectural. Model names are configuration defaults, not
provider assumptions.

`runWorkSupervisorOnce` claims one ready task, prepares a task-specific
detached Git worktree, transitions `ready -> planning`, starts or resumes Sol,
persists the work order, starts or resumes Luna, persists implementation and
Git evidence, then resumes Sol for review. It maps decisions as follows:

```text
ACCEPT -> accepted
REVISE -> one revision loop, then implement/review again
BLOCK  -> blocked
```

`accepted` means Sol judged the bounded implementation satisfactory. It does
not mean Pyash automatically merged or pushed it. The worktree and diff remain
available for human inspection.

### Recovery

The claimed spool file stays in `world/holding/work/runtime/` until the
supervisor reaches `accepted` or `blocked` and acknowledges success. A process
restart can claim an existing runtime item, read the `.pya` checkpoint, resume
the persisted Sol/Luna threads, and continue from `planning`, `implementing`,
`reviewing`, or `revision`.

`usage-limited` is distinct from `failed`: it leaves the runtime item in place
and records the interruption checkpoint for later resumption. Ordinary remote
failure is acknowledged through the existing retry policy. A crash between a
remote turn and its evidence write can still repeat that turn; turn-level
idempotency and stronger stale-runtime ownership are follow-up work.

## Proof

### Implemented

- durable named `.pya` checkpoint sections;
- extracted shared App Server JSONL transport;
- configurable manager/worker roles and reasoning effort;
- one Sol plan -> Luna implementation -> Sol review cycle;
- one revision loop with a revision cap;
- task-specific detached Git worktrees;
- runtime recovery for persisted checkpoints and usage limits;
- explicit supervisor and smoke commands.

### Proven by fake tests

`quiz/runtime/codex_app_server.test.mjs` covers initialization, thread start,
thread resume, streamed assistant output, diff/file-change events, server
errors, malformed responses, and process exit. `quiz/runtime/work_queue.test.mjs`
and `quiz/runtime/work_supervisor.test.mjs` cover checkpoint round trips,
ACCEPT, REVISE, BLOCK, usage-limited recovery, queue acknowledgement, and
role/workspace evidence.

### Proven by real Codex smoke

`npm run work:smoke` created a temporary Git repository and ran the complete
real cycle with the installed App Server models. The successful run produced a
real Sol work order, a real Luna file and test result in the isolated worktree,
real Git evidence, a real Sol `ACCEPT`, and an acknowledged empty queue.

The smoke command uses `danger-full-access` only for its disposable fixture
because this host's nested workspace-write sandbox failed with
`bwrap: loopback: Failed RTM_NEWADDR`. The normal supervisor default remains
`workspace-write` with the task worktree as its writable root.

## Options and Trade-offs

Codex App Server is the execution adapter because it supplies persistent
threads, streamed turns, model selection, interruption, and resumption while
Pyash retains task state, acceptance, retry, and evidence ownership. CAO-style
MCP orchestration and CCB/tmux bridges remain useful prior art for visible
sessions, handoff, callbacks, and human intervention, but they should wrap
Pyash records rather than replace the holding spool.

## Deferred Work

- priority-aware or fair-share scheduling beyond oldest-first;
- quota-aware background admission and spare-capacity consumption;
- turn idempotency, stale runtime ownership, and stronger crash recovery;
- formal machine-readable Sol plan/review schema beyond bounded headings;
- automatic merge, push, or cleanup of accepted worktrees;
- multi-host Codex execution, CAO/CCB replacement, and tmux dashboard work;
- generalized multi-worker concurrency;
- unrelated reporter parity and external house repairs;
- GPU peer routing and residency-aware forwarding.

## Next Highest-Value Slice

1. Add explicit turn checkpoints/idempotency keys and stale-runtime recovery so
   a worker crash cannot unknowingly repeat a remote turn.
2. Add a human-facing inspect/accept handoff for accepted worktrees, without
   giving Pyash automatic push authority.
3. Add deterministic priority/quota admission after the first cycle has been
   operated on real backlog items.

## Sources

- `program/runtime/work/contract.mjs`
- `program/runtime/work/queue.mjs`
- `program/runtime/work/checkpoint.mjs`
- `program/runtime/work/supervisor.mjs`
- `program/runtime/codex/app_server.mjs`
- `documentation/specifications/04-runtime-primitives.md`
- `documentation/specifications/18-pyash-agent.md`
- `documentation/reference/gpu-housekeeper-architecture.md`
- `documentation/runbooks/reporter-refinery-recovery.md`
- `documentation/roadmap.md`
- `documentation/todo.md`
- [Codex App Server manual](https://learn.chatgpt.com/docs/app-server.md)
- [AWS CLI Agent Orchestrator](https://github.com/awslabs/cli-agent-orchestrator)
- [Claude Codex Bridge](https://github.com/SeemSeam/claude_codex_bridge)
